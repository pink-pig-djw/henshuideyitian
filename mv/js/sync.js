/*
 * MV.SyncEditor — tap-to-sync lyric timing editor (DOM overlay, styles in
 * css/sync.css, class prefix `sync-`).
 *
 *   const ed = new MV.SyncEditor({
 *     engine,              // MV.AudioEngine-like: currentTime, playing, play(from?), pause(), seek(t), setRate(r)
 *     preset,              // preset object (or null) → offset storage key 'mv.offset.<id|custom>'
 *     getTrack,            // () → current LyricTrack (assumed to already include the stored offset)
 *     getText,             // () → pasted lyric text (parsed when getTrack() returns nothing)
 *     onApply(track),      // receives the edited LyricTrack (MV.Lyrics shape, offset baked in)
 *     onClose(),           // after the panel closed
 *     onPreview?(track),   // optional: called (throttled) after every edit for live preview
 *   });
 *   ed.open(); ed.close(); ed.isOpen;
 *   ed.reload()            re-read getTrack()/getText() while open (new paste)
 *   ed.setPreset(p)        new song matched → new offset key, reload
 *   ed.getWorkingTrack()   edited track with the offset change baked in (what Apply sends)
 *   ed.destroy()           remove the DOM
 *   actions (also used by tests): tap(), tapPhrase(), undo(), select(i), nudge(dt),
 *   setRate(r), restartFromLine(), togglePlay(), setOffset(v), setLatency(v),
 *   resetEdits(), exportLRC() → lrc string, apply() → track
 *   MV.SyncEditor.loadOffset(presetOrId) / saveOffset(presetOrId, v) / offsetKey(presetOrId)
 *
 * Keys while open (captured before the app's own shortcuts):
 *   Space      stamp the selected line's start at engine.currentTime − latency, select next line
 *   P          stamp the next phrase of the line being sung (or of the selected line)
 *   Backspace  undo            ↑ / ↓  select line            ← / →  nudge selected line ±0.05 s (Shift ±0.01)
 *   Enter      play / pause    R      restart a little before the selected line    Esc  close
 *
 * Global offset (slider ±2 s) is persisted in localStorage 'mv.offset.<presetId|custom>'
 * (MV.SyncEditor.loadOffset(id) lets the app apply it when parsing). The track
 * handed over by getTrack() is assumed to already contain the stored offset;
 * the editor only applies the difference when the slider moves.
 * Latency compensation (default 0.08 s) is persisted in 'mv.sync.latency'.
 * Every storage / clipboard / download call is wrapped and never throws.
 */
(function () {
  'use strict';

  const MV = (window.MV = window.MV || {});

  const DEFAULT_LATENCY = 0.08;
  const OFFSET_RANGE = 2.0;
  const PREROLL = 2.0;
  const MAX_UNDO = 300;
  const RATES = [0.5, 0.75, 1.0];

  /* ------------------------------------------------------------------ */
  /* Safe wrappers                                                       */
  /* ------------------------------------------------------------------ */
  const store = {
    get(k) {
      try {
        const ls = window.localStorage;
        return ls ? ls.getItem(k) : null;
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        const ls = window.localStorage;
        if (ls) ls.setItem(k, String(v));
        return true;
      } catch (e) {
        return false;
      }
    },
  };
  const num = (v, d) => {
    const x = parseFloat(v);
    return isFinite(x) ? x : d;
  };
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const round3 = (x) => Math.round(x * 1000) / 1000;

  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand ? document.execCommand('copy') : false;
      ta.remove();
      return !!ok;
    } catch (e) {
      return false;
    }
  }
  function copyText(text) {
    return new Promise((resolve) => {
      try {
        const cb = navigator.clipboard;
        if (cb && cb.writeText) {
          cb.writeText(text).then(
            () => resolve(true),
            () => resolve(legacyCopy(text))
          );
          return;
        }
      } catch (e) {
        /* fall through */
      }
      resolve(legacyCopy(text));
    });
  }
  function downloadText(name, text) {
    try {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {
          /* ignore */
        }
      }, 5000);
      return true;
    } catch (e) {
      return false;
    }
  }

  function fmt(t) {
    if (!isFinite(t)) return '--:--.--';
    const neg = t < 0;
    const s = MV.fmtTime ? MV.fmtTime(Math.abs(t)) : Math.abs(t).toFixed(2);
    return (neg ? '-' : '') + s;
  }
  const signed = (v, d = 2) => (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(d);

  // Tiny DOM builder: el('div', 'sync-a sync-b', { title: 'x' }, [children | 'text'])
  function el(tag, cls, attrs, kids) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) {
      for (const k in attrs) {
        if (attrs[k] == null) continue;
        if (k === 'text') n.textContent = attrs[k];
        else n.setAttribute(k, attrs[k]);
      }
    }
    (kids || []).forEach((c) => n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  }
  // Skewed button with an un-skewed label.
  function btn(cls, label, title) {
    const b = el('button', 'sync-btn ' + (cls || ''), { type: 'button', title: title || null });
    const s = el('span', 'sync-btn-l');
    s.innerHTML = label; // static, trusted markup only (never lyric text)
    b.appendChild(s);
    // Keep keyboard focus on the page so Space never "clicks" a focused button.
    b.addEventListener('mousedown', (e) => e.preventDefault());
    return b;
  }

  /* ------------------------------------------------------------------ */
  /* Editor                                                              */
  /* ------------------------------------------------------------------ */
  class SyncEditor {
    /**
     * @param {{engine?: object, preset?: object, getTrack?: function, getText?: function,
     *          onApply?: function, onClose?: function, onPreview?: function}} opts
     */
    constructor(opts) {
      opts = opts || {};
      this.engine = opts.engine || null;
      this.preset = opts.preset || null;
      this.getTrack = typeof opts.getTrack === 'function' ? opts.getTrack : () => null;
      this.getText = typeof opts.getText === 'function' ? opts.getText : () => '';
      this.onApply = typeof opts.onApply === 'function' ? opts.onApply : () => {};
      this.onClose = typeof opts.onClose === 'function' ? opts.onClose : () => {};
      this.onPreview = typeof opts.onPreview === 'function' ? opts.onPreview : null;
      this.latency = clamp(num(store.get('mv.sync.latency'), DEFAULT_LATENCY), 0, 0.5);
      this.offset = SyncEditor.loadOffset(this.preset);
      this.offset0 = this.offset;
      this.rate = 1;
      this.work = null;
      this.initial = null;
      this.sel = 0;
      this.active = -1;
      this.pc = 1;
      this.stamps = new Map(); // line index → Set(phrase k) stamped this session
      this.undoStack = [];
      this.root = null;
      this.rows = [];
      this._open = false;
      this._raf = 0;
      this._playIdx = -1;
      this._userScrollAt = -1e9;
      this._toastTimer = 0;
      this._previewTimer = 0;
      this._onKey = this._onKey.bind(this);
      this._onKeyUp = this._onKeyUp.bind(this);
      this._loop = this._loop.bind(this);
    }

    /** localStorage key for the global offset of a preset (or 'custom'). */
    static offsetKey(preset) {
      const id = typeof preset === 'string' ? preset : preset && preset.id;
      return 'mv.offset.' + (id || 'custom');
    }
    /** Stored global offset (s) for a preset / id, 0 when none or storage is unavailable. */
    static loadOffset(preset) {
      return clamp(num(store.get(SyncEditor.offsetKey(preset)), 0), -OFFSET_RANGE, OFFSET_RANGE);
    }
    /** Persist a global offset (s). Never throws. */
    static saveOffset(preset, v) {
      return store.set(SyncEditor.offsetKey(preset), round3(clamp(num(v, 0), -OFFSET_RANGE, OFFSET_RANGE)));
    }

    get isOpen() {
      return this._open;
    }

    /** Re-read getTrack()/getText() (e.g. the user pasted new lyrics while the panel is open). */
    reload() {
      this.offset = this.offset0 = SyncEditor.loadOffset(this.preset);
      if (this._open) this._reload();
    }

    /** Switch preset (e.g. after a new song matched); reloads the stored offset. */
    setPreset(p) {
      this.preset = p || null;
      this.offset = this.offset0 = SyncEditor.loadOffset(this.preset);
      if (this._open) this._reload();
    }

    /** Show the panel and start the UI loop. */
    open() {
      if (this._open) return;
      if (typeof document === 'undefined') return;
      this._build();
      this.offset = this.offset0 = SyncEditor.loadOffset(this.preset);
      const r0 = this.engine && typeof this.engine.rate === 'number' ? this.engine.rate : 1;
      this.rate = this.rate0 = isFinite(r0) && r0 > 0 ? r0 : 1;
      this._reload();
      this._open = true;
      this.root.classList.add('is-open');
      this.root.setAttribute('aria-hidden', 'false');
      window.addEventListener('keydown', this._onKey, true);
      window.addEventListener('keyup', this._onKeyUp, true);
      this._raf = requestAnimationFrame(this._loop);
    }

    /** Hide the panel, restore the playback rate it had at open(), call onClose(). */
    close() {
      if (!this._open) return;
      this._open = false;
      window.removeEventListener('keydown', this._onKey, true);
      window.removeEventListener('keyup', this._onKeyUp, true);
      cancelAnimationFrame(this._raf);
      if (this.rate !== (this.rate0 || 1)) this.setRate(this.rate0 || 1);
      if (this.root) {
        this.root.classList.remove('is-open');
        this.root.setAttribute('aria-hidden', 'true');
      }
      try {
        this.onClose();
      } catch (e) {
        console.error('[SyncEditor] onClose', e);
      }
    }

    /** Remove the DOM entirely. */
    destroy() {
      this.close();
      if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
      this.root = null;
    }

    /* --------------------------- data ------------------------------- */
    _reload() {
      let tr = null;
      try {
        tr = this.getTrack();
      } catch (e) {
        tr = null;
      }
      if (!tr || !tr.lines || !tr.lines.length) {
        try {
          const text = this.getText();
          if (text && MV.Lyrics) tr = MV.Lyrics.parse(text, { preset: this.preset, offset: this.offset0 });
        } catch (e) {
          tr = null;
        }
      }
      this.work = tr && MV.Lyrics ? MV.Lyrics.clone(tr) : { source: 'none', lines: [], meta: {}, unmatched: [], warnings: [], matched: {} };
      this.initial = this._snapshot();
      this.undoStack = [];
      this.stamps = new Map();
      this.active = -1;
      this.pc = 1;
      const t = this._now() - this._delta();
      const lines = this.work.lines;
      let s = lines.findIndex((l) => l.end > t);
      this.sel = s < 0 ? Math.max(0, lines.length - 1) : s;
      this._renderList();
      this._syncControls();
      this._update(true);
    }

    _delta() {
      return this.offset - this.offset0;
    }
    _now() {
      try {
        const t = this.engine ? Number(this.engine.currentTime) : 0;
        return isFinite(t) ? t : 0;
      } catch (e) {
        return 0;
      }
    }
    _snapshot() {
      return {
        times: this.work.lines.map((l) => [l.phrases.map((p) => p.start), l.end]),
        sel: this.sel, active: this.active, pc: this.pc,
        stamps: Array.from(this.stamps.entries()).map(([k, v]) => [k, Array.from(v)]),
      };
    }
    _restore(s) {
      this.work.lines.forEach((l, i) => {
        const rec = s.times[i];
        if (!rec) return;
        l.phrases.forEach((p, k) => (p.start = rec[0][k]));
        l.end = rec[1];
      });
      MV.Lyrics.refresh(this.work);
      this.sel = s.sel;
      this.active = s.active;
      this.pc = s.pc;
      this.stamps = new Map(s.stamps.map(([k, v]) => [k, new Set(v)]));
    }
    _pushUndo() {
      this.undoStack.push(this._snapshot());
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    }
    _mark(i, k) {
      if (!this.stamps.has(i)) this.stamps.set(i, new Set());
      this.stamps.get(i).add(k);
    }
    _edited(i, flash) {
      MV.Lyrics.refresh(this.work);
      this._update(true);
      if (flash != null) this._flashRow(i);
      this._schedulePreview();
    }

    /** The edited track with the global offset change baked in (what Apply sends). */
    getWorkingTrack() {
      if (!this.work || !MV.Lyrics) return null;
      const d = this._delta();
      const out = MV.Lyrics.withTimes(this.work, (t) => t + d);
      out.userOffset = this.offset;
      out.edited = true;
      return out;
    }

    /* -------------------------- actions ----------------------------- */
    /** Space / TAP: stamp the selected line start at now − latency, then select the next line. */
    tap() {
      const lines = this.work && this.work.lines;
      if (!lines || !lines.length) return;
      const i = clamp(this.sel, 0, lines.length - 1);
      // Base-time stamp; never earlier than output time 0.
      const T = Math.max(-this._delta(), this._now() - this.latency - this._delta());
      this._pushUndo();
      const line = lines[i];
      const d = T - line.phrases[0].start;
      line.phrases.forEach((p) => (p.start += d));
      line.end += d;
      // The previous line must end before this one starts; pull back any of
      // its phrases that now start too late.
      const prev = lines[i - 1];
      if (prev && prev.end > T - 0.02) {
        const ph = prev.phrases;
        const lim = T - 0.1;
        for (let k = 1; k < ph.length; k++) {
          if (ph[k].start > lim) {
            const a = ph[k - 1].start;
            ph[k].start = Math.min(ph[k].start, a + Math.max(0.05, (lim - a) / (ph.length - k + 1)));
          }
        }
        prev.end = Math.max(ph[ph.length - 1].start + 0.2, T - 0.02);
      }
      // Keep this line from running into the next one.
      const next = lines[i + 1];
      if (next && line.end > next.phrases[0].start - 0.02 && next.phrases[0].start > T) {
        line.end = Math.max(line.phrases[line.phrases.length - 1].start + 0.2, next.phrases[0].start - 0.02);
      }
      this._mark(i, 0);
      this.active = i;
      this.pc = 1;
      this.sel = Math.min(i + 1, lines.length - 1);
      this._edited(i, true);
      this._hit('tap');
      this._ensureVisible(this.sel, false);
    }

    /** P: stamp the next phrase of the line being sung (or of the selected line). */
    tapPhrase() {
      const lines = this.work && this.work.lines;
      if (!lines || !lines.length) return;
      const i = this.active >= 0 ? this.active : clamp(this.sel, 0, lines.length - 1);
      const k = this.active === i ? this.pc : 1;
      const line = lines[i];
      if (k >= line.phrases.length) {
        this._toast('本行短句已全部标记 · all phrases stamped');
        return;
      }
      const T0 = Math.max(-this._delta(), this._now() - this.latency - this._delta());
      this._pushUndo();
      const T = Math.max(T0, line.phrases[k - 1].start + 0.05);
      const d = T - line.phrases[k].start;
      for (let j = k; j < line.phrases.length; j++) line.phrases[j].start += d;
      line.end += d;
      const next = lines[i + 1];
      if (next && line.end > next.phrases[0].start - 0.02 && next.phrases[0].start > T) {
        line.end = Math.max(line.phrases[line.phrases.length - 1].start + 0.2, next.phrases[0].start - 0.02);
      }
      this._mark(i, k);
      this.active = i;
      this.pc = k + 1;
      this._edited(i, true);
      this._hit('phrase');
    }

    /** Backspace: undo the last timing edit. */
    undo() {
      const s = this.undoStack.pop();
      if (!s) {
        this._toast('没有可撤销的操作 · nothing to undo');
        return;
      }
      this._restore(s);
      this._update(true);
      this._ensureVisible(this.sel, false);
      this._schedulePreview();
    }

    /** Select line i (clamped). */
    select(i) {
      const n = this.work ? this.work.lines.length : 0;
      if (!n) return;
      this.sel = clamp(i | 0, 0, n - 1);
      this.active = -1;
      this.pc = 1;
      this._update(false);
      this._ensureVisible(this.sel, false);
    }

    /** ←/→: shift the selected line by dt seconds. */
    nudge(dt) {
      const lines = this.work && this.work.lines;
      if (!lines || !lines.length) return;
      const line = lines[this.sel];
      this._pushUndo();
      line.phrases.forEach((p) => (p.start += dt));
      line.end += dt;
      this._edited(this.sel, true);
    }

    /** Playback rate (0.5 / 0.75 / 1.0) through engine.setRate. */
    setRate(r) {
      this.rate = r;
      try {
        if (this.engine && typeof this.engine.setRate === 'function') this.engine.setRate(r);
      } catch (e) {
        /* ignore */
      }
      this._syncControls();
    }

    /** Seek a little before the selected line and play. */
    restartFromLine() {
      const lines = this.work && this.work.lines;
      if (!lines || !lines.length || !this.engine) return;
      const t = Math.max(0, lines[this.sel].start + this._delta() - PREROLL);
      this.active = -1;
      this.pc = 1;
      try {
        if (typeof this.engine.play === 'function') this.engine.play(t);
        else if (typeof this.engine.seek === 'function') this.engine.seek(t);
      } catch (e) {
        /* ignore */
      }
      this._update(false);
    }

    /** Play / pause the engine. */
    togglePlay() {
      const e = this.engine;
      if (!e) return;
      try {
        if (e.playing) e.pause();
        else if (typeof e.play === 'function') e.play();
      } catch (err) {
        /* ignore */
      }
    }

    /** Global offset (s, ±2) — persisted per preset. */
    setOffset(v) {
      this.offset = round3(clamp(num(v, 0), -OFFSET_RANGE, OFFSET_RANGE));
      SyncEditor.saveOffset(this.preset, this.offset);
      this._syncControls();
      this._update(true);
      this._schedulePreview();
    }

    /** Tap latency compensation (s, 0..0.5) — persisted. */
    setLatency(v) {
      this.latency = round3(clamp(num(v, DEFAULT_LATENCY), 0, 0.5));
      store.set('mv.sync.latency', this.latency);
      this._syncControls();
    }

    /** Discard all edits made since open(). */
    resetEdits() {
      if (!this.initial) return;
      this._pushUndo();
      this._restore(this.initial);
      this.stamps = new Map();
      this._update(true);
      this._schedulePreview();
      this._toast('已恢复打开时的时间 · reset');
    }

    /** Download + copy the edited timing as enhanced LRC. Returns the LRC text. */
    exportLRC() {
      const tr = this.getWorkingTrack();
      if (!tr || !tr.lines.length) {
        this._toast('没有歌词可导出 · nothing to export');
        return '';
      }
      const lrc = MV.Lyrics.toLRC(tr);
      // ASCII-only file name: some platforms/locales turn non-ASCII names into "download".
      const ascii = (s) => String(s || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
      const name = (ascii(this.preset && this.preset.id) || ascii(tr.meta && tr.meta.title) || 'lyrics') + '.lrc';
      const dl = downloadText(name, lrc);
      this.lastExport = lrc;
      copyText(lrc).then((ok) => {
        this._toast((dl ? '已导出 LRC' : '导出失败') + (ok ? ' · 已复制到剪贴板 copied' : ' · 复制失败 copy failed'));
      });
      return lrc;
    }

    /** Send the edited track to onApply(). */
    apply() {
      const tr = this.getWorkingTrack();
      if (!tr) return null;
      SyncEditor.saveOffset(this.preset, this.offset);
      try {
        this.onApply(tr);
        this._toast('已应用 · applied');
      } catch (e) {
        console.error('[SyncEditor] onApply', e);
        this._toast('应用失败 · apply failed');
      }
      return tr;
    }

    _schedulePreview() {
      if (!this.onPreview) return;
      clearTimeout(this._previewTimer);
      this._previewTimer = setTimeout(() => {
        try {
          this.onPreview(this.getWorkingTrack());
        } catch (e) {
          console.error('[SyncEditor] onPreview', e);
        }
      }, 120);
    }

    /* -------------------------- keyboard ---------------------------- */
    _onKey(e) {
      if (!this._open) return;
      const tg = e.target;
      const tag = tg && tg.tagName ? tg.tagName.toUpperCase() : '';
      const type = tg && tg.type ? String(tg.type).toLowerCase() : '';
      const typing = (tag === 'INPUT' && type !== 'range' && type !== 'button' && type !== 'checkbox') || tag === 'TEXTAREA' || tag === 'SELECT' || (tg && tg.isContentEditable);
      if (e.key === 'Escape') {
        if (typing && tg.blur) tg.blur();
        else this.close();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (tag === 'INPUT' && type === 'range' && /^Arrow/.test(e.key)) return; // slider keeps its arrows
      let handled = true;
      const code = e.code || '';
      const key = e.key || '';
      if (code === 'Space' || key === ' ' || key === 'Spacebar') {
        if (!e.repeat) this.tap();
      } else if (code === 'KeyP' || key === 'p' || key === 'P') {
        if (!e.repeat) this.tapPhrase();
      } else if (key === 'Backspace') this.undo();
      else if (key === 'ArrowUp') this.select(this.sel - 1);
      else if (key === 'ArrowDown') this.select(this.sel + 1);
      else if (key === 'ArrowLeft') this.nudge(e.shiftKey ? -0.01 : -0.05);
      else if (key === 'ArrowRight') this.nudge(e.shiftKey ? 0.01 : 0.05);
      else if (key === 'Enter') this.togglePlay();
      else if (code === 'KeyR' || key === 'r' || key === 'R') this.restartFromLine();
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    _onKeyUp(e) {
      if (!this._open) return;
      if (e.code === 'Space' || e.key === ' ') {
        const tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : '';
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    }

    /* ---------------------------- DOM ------------------------------- */
    _build() {
      if (this.root) {
        if (!this.root.parentNode) document.body.appendChild(this.root);
        return;
      }
      const R = (this.root = el('div', 'sync-root', { role: 'dialog', 'aria-label': '歌词同步 Lyric sync', 'aria-hidden': 'true' }));
      const panel = el('div', 'sync-panel');
      R.appendChild(panel);

      // Header
      const head = el('header', 'sync-head');
      const title = el('div', 'sync-title', null, [
        el('span', 'sync-title-zh', { text: '歌词同步' }),
        el('span', 'sync-title-en', { text: 'LYRIC SYNC' }),
      ]);
      this.$stat = el('div', 'sync-stat');
      const close = el('button', 'sync-close', { type: 'button', title: '关闭 Close (Esc)', 'aria-label': '关闭 Close' });
      close.addEventListener('mousedown', (e) => e.preventDefault());
      close.addEventListener('click', () => this.close());
      head.appendChild(title);
      head.appendChild(this.$stat);
      head.appendChild(close);
      panel.appendChild(head);

      // Transport
      const tr = el('section', 'sync-transport');
      this.$clock = el('div', 'sync-clock', { text: '0:00.00' });
      this.$play = btn('sync-play', '▶ 播放', '播放 / 暂停 Play / pause (Enter)');
      this.$play.addEventListener('click', () => this.togglePlay());
      const rates = el('div', 'sync-rates', { role: 'group', 'aria-label': '播放速度 Rate' });
      this.$rates = RATES.map((r) => {
        const b = btn('sync-rate', (r === 1 ? '1.0' : String(r)) + '<i class="sync-x">×</i>', '播放速度 Rate ' + r);
        b.dataset.rate = String(r);
        b.addEventListener('click', () => this.setRate(r));
        rates.appendChild(b);
        return b;
      });
      this.$from = btn('sync-from', '↺ 从本行播放 <em>FROM LINE</em>', '从选中行前 2 秒开始播放 Restart before the selected line (R)');
      this.$from.addEventListener('click', () => this.restartFromLine());
      tr.appendChild(el('div', 'sync-transport-row', null, [this.$clock, this.$play]));
      tr.appendChild(el('div', 'sync-transport-row', null, [rates, this.$from]));
      panel.appendChild(tr);

      // Offset + latency
      const tune = el('section', 'sync-tune');
      this.$offset = el('input', 'sync-range', { type: 'range', min: String(-OFFSET_RANGE), max: String(OFFSET_RANGE), step: '0.01', value: '0', 'aria-label': '全局偏移 Offset' });
      this.$offsetOut = el('output', 'sync-offset-val', { text: '+0.00 s' });
      this.$offset.addEventListener('input', () => this.setOffset(this.$offset.value));
      this.$offset.addEventListener('change', () => this.$offset.blur());
      const zero = btn('sync-mini', '归零', '偏移归零 Reset offset');
      zero.addEventListener('click', () => this.setOffset(0));
      this.$latency = el('input', 'sync-num', { type: 'number', min: '0', max: '0.5', step: '0.01', value: String(this.latency), 'aria-label': '延迟补偿 Latency' });
      this.$latency.addEventListener('change', () => {
        this.setLatency(this.$latency.value);
        this.$latency.blur();
      });
      tune.appendChild(el('div', 'sync-tune-row', null, [
        el('label', 'sync-label', null, ['全局偏移 ', el('b', null, { text: 'OFFSET' })]),
        this.$offset, this.$offsetOut, zero,
      ]));
      tune.appendChild(el('div', 'sync-tune-row', null, [
        el('label', 'sync-label', null, ['延迟补偿 ', el('b', null, { text: 'LATENCY' })]),
        this.$latency, el('span', 'sync-unit', { text: 's · 打点时间 = 当前时间 − 补偿' }),
      ]));
      panel.appendChild(tune);

      // Line list
      this.$list = el('ol', 'sync-list', { 'aria-label': '歌词行 Lines' });
      const markScroll = () => (this._userScrollAt = performance.now());
      this.$list.addEventListener('wheel', markScroll, { passive: true });
      this.$list.addEventListener('touchmove', markScroll, { passive: true });
      this.$list.addEventListener('click', (e) => {
        const li = e.target.closest ? e.target.closest('.sync-row') : null;
        if (li) this.select(+li.dataset.i);
      });
      this.$list.addEventListener('dblclick', (e) => {
        const li = e.target.closest ? e.target.closest('.sync-row') : null;
        if (li) {
          this.select(+li.dataset.i);
          this.restartFromLine();
        }
      });
      panel.appendChild(this.$list);

      // Tap zone
      const taps = el('section', 'sync-taps');
      this.$tap = el('button', 'sync-tap', { type: 'button', title: '标记选中行的开始 Stamp line start (Space)' }, [
        el('span', 'sync-tap-big', { text: 'TAP' }),
        el('span', 'sync-tap-sub', null, [el('b', null, { text: '空格 SPACE' }), el('br'), '标记本行开始 · 自动跳到下一行']),
      ]);
      this.$tap.addEventListener('mousedown', (e) => e.preventDefault());
      this.$tap.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        this.tap();
      });
      this.$tap.addEventListener('keydown', (e) => e.preventDefault());
      this.$phrase = btn('sync-phrase', '<b>P</b> 下一短句 <em>PHRASE</em>', '标记正在唱的行的下一个短句 Stamp next phrase (P)');
      this.$phrase.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        this.tapPhrase();
      });
      this.$undo = btn('sync-undo', '⌫ 撤销 <em>UNDO</em>', '撤销 Undo (Backspace)');
      this.$undo.addEventListener('click', () => this.undo());
      this.$toast = el('div', 'sync-toast', { role: 'status', 'aria-live': 'polite' });
      taps.appendChild(this.$toast);
      taps.appendChild(this.$tap);
      taps.appendChild(el('div', 'sync-tap-row', null, [this.$phrase, this.$undo]));
      const hint = (k, t) => el('span', 'sync-hint', null, [el('kbd', null, { text: k }), t]);
      taps.appendChild(el('div', 'sync-help', null, [
        hint('↑↓', '选择'), hint('←→', '微调 ±0.05s（Shift ±0.01）'), hint('⌫', '撤销'),
        hint('Enter', '播放/暂停'), hint('R', '从本行'), hint('Esc', '关闭'),
      ]));
      panel.appendChild(taps);

      // Footer
      const foot = el('footer', 'sync-foot');
      const reset = btn('sync-ghost', '重置 <em>RESET</em>', '恢复打开编辑器时的时间 Discard edits');
      reset.addEventListener('click', () => this.resetEdits());
      const exp = btn('sync-export', '导出 LRC <em>EXPORT</em>', '下载 .lrc 并复制到剪贴板 Download + copy');
      exp.addEventListener('click', () => this.exportLRC());
      const apply = btn('sync-apply', '应用 <em>APPLY</em>', '把新的时间应用到 MV Apply');
      apply.addEventListener('click', () => this.apply());
      foot.appendChild(reset);
      foot.appendChild(exp);
      foot.appendChild(apply);
      panel.appendChild(foot);

      document.body.appendChild(R);
    }

    _renderList() {
      const list = this.$list;
      while (list.firstChild) list.removeChild(list.firstChild);
      this.rows = [];
      this._playIdx = -1; // rows are new: let the loop re-mark the sung line
      this._wasPlaying = undefined;
      const lines = this.work.lines;
      if (!lines.length) {
        list.appendChild(el('li', 'sync-empty', null, [
          el('b', null, { text: '没有歌词' }), el('br'), '请先粘贴歌词，再打开同步编辑器 · paste lyrics first',
        ]));
        return;
      }
      lines.forEach((line, i) => {
        const li = el('li', 'sync-row', { 'data-i': String(i) });
        const no = el('span', 'sync-no', { text: String(i + 1).padStart(2, '0') });
        const time = el('span', 'sync-time');
        const text = el('span', 'sync-text', { lang: 'ja' });
        const phs = [];
        let pos = 0;
        line.phrases.forEach((p) => {
          if (p.charStart > pos) text.appendChild(document.createTextNode(line.chars.slice(pos, p.charStart).join('')));
          const s = el('span', 'sync-ph' + (p.latin ? ' is-latin' : ''), { text: line.chars.slice(p.charStart, p.charEnd).join('') });
          text.appendChild(s);
          phs.push(s);
          pos = p.charEnd;
        });
        const ticks = el('span', 'sync-ticks', { 'aria-hidden': 'true' });
        const tk = line.phrases.map(() => {
          const t = el('i', 'sync-tick');
          ticks.appendChild(t);
          return t;
        });
        const badge = el('span', 'sync-badge', { text: line.style ? String(line.style).toUpperCase() : '' });
        li.appendChild(no);
        li.appendChild(time);
        li.appendChild(text);
        li.appendChild(el('span', 'sync-meta', null, [ticks, badge]));
        list.appendChild(li);
        this.rows.push({ li, time, phs, tk });
      });
    }

    _syncControls() {
      if (!this.root) return;
      this.$offset.value = String(this.offset);
      this.$offsetOut.textContent = signed(this.offset) + ' s';
      if (document.activeElement !== this.$latency) this.$latency.value = this.latency.toFixed(2);
      this.$rates.forEach((b) => b.classList.toggle('is-on', Math.abs(+b.dataset.rate - this.rate) < 1e-6));
      const hasRate = !!(this.engine && typeof this.engine.setRate === 'function');
      this.$rates.forEach((b) => (b.disabled = !hasRate));
    }

    // Row texts / classes. `times`: also refresh the time labels.
    _update(times) {
      if (!this.root || !this.work) return;
      const d = this._delta();
      const lines = this.work.lines;
      this.rows.forEach((r, i) => {
        const line = lines[i];
        if (times) r.time.textContent = fmt(line.start + d);
        r.li.classList.toggle('is-sel', i === this.sel);
        r.li.classList.toggle('is-active', i === this.active);
        const st = this.stamps.get(i);
        r.li.classList.toggle('is-stamped', !!(st && st.has(0)));
        r.tk.forEach((t, k) => {
          t.classList.toggle('is-on', !!(st && st.has(k)));
          t.classList.toggle('is-next', i === this.active && k === this.pc);
        });
      });
      let n = 0;
      this.stamps.forEach((s) => s.has(0) && n++);
      this.$stat.textContent = lines.length
        ? lines.length + ' 行 · 已打点 ' + n + ' · 偏移 ' + signed(this.offset) + 's · 补偿 ' + this.latency.toFixed(2) + 's'
        : '无歌词 · no lyrics';
    }

    _flashRow(i) {
      const r = this.rows[i];
      if (!r) return;
      r.li.classList.remove('is-flash');
      void r.li.offsetWidth; // restart the CSS animation
      r.li.classList.add('is-flash');
    }
    _hit(which) {
      const b = which === 'tap' ? this.$tap : this.$phrase;
      if (!b) return;
      b.classList.remove('is-hit');
      void b.offsetWidth;
      b.classList.add('is-hit');
      clearTimeout(b._hitT);
      b._hitT = setTimeout(() => b.classList.remove('is-hit'), 140);
    }
    _toast(msg) {
      if (!this.$toast) return;
      this.$toast.textContent = msg;
      this.$toast.classList.add('is-on');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => this.$toast && this.$toast.classList.remove('is-on'), 1800);
    }
    _ensureVisible(i, center) {
      const r = this.rows[i];
      if (!r || !this.$list) return;
      const list = this.$list;
      const top = r.li.offsetTop;
      const h = r.li.offsetHeight;
      const vt = list.scrollTop;
      const vh = list.clientHeight;
      const max = Math.max(0, list.scrollHeight - vh);
      if (center) {
        if (top < vt || top + h > vt + vh) list.scrollTop = clamp(top - vh / 2 + h / 2, 0, max);
        return;
      }
      // Keep about one row of context around the selection (the line just
      // stamped above it, the upcoming ones below).
      const margin = Math.min(vh * 0.3, h * 1.2);
      if (top < vt + margin || top + h > vt + vh - margin) list.scrollTop = clamp(top - vh * 0.34, 0, max);
    }

    // UI loop (not a render path of the MV: wall clock use is fine here).
    _loop() {
      if (!this._open) return;
      this._raf = requestAnimationFrame(this._loop);
      const t = this._now();
      if (this.$clock) this.$clock.textContent = fmt(t);
      const playing = !!(this.engine && this.engine.playing);
      if (this._wasPlaying !== playing) {
        this._wasPlaying = playing;
        this.$play.firstChild.textContent = playing ? '❚❚ 暂停' : '▶ 播放';
        this.$play.classList.toggle('is-on', playing);
      }
      const lines = this.work ? this.work.lines : [];
      if (!lines.length) return;
      const tb = t - this._delta();
      // Line being sung: last line started, until the next starts (or +1.2 s after its end).
      let pi = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].start <= tb) pi = i;
        else break;
      }
      if (pi >= 0 && tb > lines[pi].end + 1.2 && !(lines[pi + 1] && lines[pi + 1].start <= tb)) pi = -1;
      if (pi !== this._playIdx) {
        if (this.rows[this._playIdx]) this.rows[this._playIdx].li.classList.remove('is-play');
        if (this.rows[pi]) {
          this.rows[pi].li.classList.add('is-play');
          if (playing && performance.now() - this._userScrollAt > 2500) this._ensureVisible(pi, true);
        }
        this._playIdx = pi;
      }
      const r = this.rows[pi];
      if (r) {
        const ph = lines[pi].phrases;
        for (let k = 0; k < ph.length; k++) r.phs[k].classList.toggle('is-sung', ph[k].start <= tb);
      }
    }
  }

  MV.SyncEditor = SyncEditor;
})();

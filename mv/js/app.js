/*
 * MV.app — UI wiring for index.html (docs/ARCHITECTURE.md §3.11).
 *
 * Owns: the start / pause menu, the player bar (seek bar with section
 * segments + lyric ticks), the lyrics / settings / export panels, toasts,
 * drag-and-drop, keyboard shortcuts, the render loop and the auto-load flow:
 *
 *   audio  : ?audio=<url>  →  assets/song.(mp3|m4a|wav|ogg) (http only)  →  IndexedDB cache
 *   lyrics : ?lyrics=<url|text>  →  assets/lyrics.(txt|lrc) (http only)  →  localStorage
 *            'mv.lyrics.<presetId>' / 'mv.lyrics.last'
 *   audio → MV.Analysis.compute → matchPreset → applyPreset → MV.Lyrics.parse
 *         → MV.Director → stage.setDirector → stage.prepare → render loop
 *
 * Without audio the canvas shows a silent "attract" reel (preset timeline with
 * synthetic, deterministic envelopes). Rendering stays a pure function of t:
 * the wall clock / audio clock only choose which t is rendered.
 *
 * URL params: ?t=<s> (render that frame, paused)  ?autoplay=1  ?quality=auto|1|0.75|0.5
 *             ?hud=0  ?debug=1  ?test=1 (no idle hide, static attract frame, 1 ms UI motion)
 *             ?audio=<url>|none  ?lyrics=<url|text>|none  ?autoload=0 (no assets / cache probing)
 *             ?assets=0 (skip assets/ probing only; the IndexedDB cache is still used)
 *
 * Test API (always present, methods wait for init):
 *   MV.app.ready                     Promise, resolves after init + auto-loads
 *   MV.app.loadAudioURL(url)         → Promise<state>
 *   MV.app.loadAudioFile(file)       → Promise<state>
 *   MV.app.setLyricsText(text)       → state.lyrics
 *   MV.app.renderAt(t)               → Promise<{ t, ms }> (fonts + layouts ensured, resolves after paint)
 *   MV.app.play() / pause() / seek(t)
 *   MV.app.getState()                → { audio, preset, offset, confidence, lyrics:{matched,skipped,lines}, t, playing, fps, … }
 *   MV.app.exportVideo(opts)         → Promise<MV.Exporter result>  opts: { width|height|resolution, fps, range:[t0,t1], method, … }
 *   MV.app.openMenu()/closeMenu()/openPanel(name)/closePanel()/setSetting(k, v)/setLyricOffset(v)
 */
(function () {
  'use strict';

  const MV = (window.MV = window.MV || {});
  if (MV.app && MV.app._booted) return;

  /* ------------------------------------------------------------------ */
  /* Fallbacks (the app must survive a missing core.js)                  */
  /* ------------------------------------------------------------------ */
  const C = MV.C || {
    red: '#E60012', redHot: '#FF1E32', redDeep: '#A3000E', blood: '#4A0006', black: '#0A0A0A', ink: '#000000',
    white: '#FFFFFF', paper: '#F3EFE6', gray: '#1D1D1F', night: '#060A1C', navy: '#101A45', star: '#FFF4D6',
  };
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const fin = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
  const $ = (id) => document.getElementById(id);
  const wallNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : 0);
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const isHttp = /^https?:$/.test(location.protocol);

  const store = {
    get(k) {
      try {
        return window.localStorage ? window.localStorage.getItem(k) : null;
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        window.localStorage.setItem(k, v);
        return true;
      } catch (e) {
        return false;
      }
    },
    del(k) {
      try {
        window.localStorage.removeItem(k);
      } catch (e) {
        /* ignore */
      }
    },
    keys() {
      try {
        const out = [];
        for (let i = 0; i < window.localStorage.length; i++) out.push(window.localStorage.key(i));
        return out;
      } catch (e) {
        return [];
      }
    },
  };

  let Q;
  try {
    Q = new URLSearchParams(location.search);
  } catch (e) {
    Q = { get: () => null, has: () => false };
  }
  const qget = (k) => Q.get(k);
  const TEST = qget('test') === '1';
  const AUTOLOAD = qget('autoload') !== '0';
  const ASSETS = AUTOLOAD && qget('assets') !== '0';

  /** m:ss (or m:ss.cc with `precise`). */
  function fmtClock(sec, precise) {
    sec = Math.max(0, fin(sec, 0));
    let m = Math.floor(sec / 60);
    let s = sec - m * 60;
    if (precise) {
      let str = s.toFixed(2);
      if (str === '60.00') {
        m++;
        str = '0.00';
      }
      return m + ':' + (parseFloat(str) < 10 ? '0' : '') + str;
    }
    s = Math.floor(s);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  /** "83.5" | "1:23.5" | "1:02:03" → seconds (NaN when invalid). */
  function parseClock(str) {
    const s = String(str == null ? '' : str).trim().replace(/[：]/g, ':').replace(/s$/i, '');
    if (!s) return NaN;
    if (!/^\d+(?::\d{1,2}){0,2}(?:[.,]\d+)?$/.test(s)) return NaN;
    const parts = s.replace(',', '.').split(':');
    let v = 0;
    for (const p of parts) v = v * 60 + parseFloat(p);
    return isFinite(v) ? v : NaN;
  }
  const fmtOffset = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + ' s';
  const fmtMB = (b) => (b / (1024 * 1024)).toFixed(b > 100 * 1024 * 1024 ? 0 : 1) + ' MB';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const textKey = (text) => (MV.fnv1a ? MV.fnv1a(String(text || '')) : String((text || '').length));

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */
  const SETTINGS_KEY = 'mv.settings';
  const LYRICS_LAST = 'mv.lyrics.last';
  const lyricsKey = (id) => 'mv.lyrics.' + (id || 'custom');
  const syncedKey = (id) => 'mv.synced.' + (id || 'custom');
  const AUDIO_CANDS = ['song.mp3', 'song.m4a', 'song.wav', 'song.ogg'];
  const LYRIC_CANDS = ['lyrics.txt', 'lyrics.lrc'];
  const AUDIO_RE = /\.(mp3|m4a|m4b|aac|mp4|wav|wave|ogg|oga|opus|flac|webm|weba|aif|aiff|caf)$/i;
  const TEXT_RE = /\.(txt|lrc|text)$/i;
  const IDLE_MS = 2500;
  const ATTRACT_FPS = 30;
  const OFFSET_MAX = 2;
  // Silent attract reel (preset timeline seconds, [start, length]).
  const REEL = [[0.9, 8.4], [46.35, 7.2], [112.2, 7.4], [66.55, 5.6], [142.35, 7.0], [190.35, 8.0], [96.2, 6.2], [212.1, 7.6]];
  const TEST_ATTRACT_T = 48.2;
  // Seek-bar look per section kind (MV.C tokens only).
  const KIND_STYLE = {
    intro: { fill: C.paper, stripes: true }, interlude: { fill: C.paper, stripes: true }, outro: { fill: C.paper, stripes: true },
    verse: { fill: C.star }, bridge: { fill: C.navy, stars: true }, pre: { fill: C.redDeep }, build: { fill: C.redDeep },
    chorus: { fill: C.red }, hook: { fill: C.redHot }, climax: { fill: C.redHot },
  };
  const KIND_ZH = {
    intro: '前奏', verse: '主歌', pre: '导歌', chorus: '副歌', hook: '记忆点', interlude: '间奏',
    bridge: '桥段', build: '推进', climax: '高潮', outro: '尾奏',
  };
  const MODULES = [
    ['AudioEngine', '音频引擎'], ['Analysis', '音频分析'], ['Lyrics', '歌词解析'], ['Director', '导演时间线'],
    ['Stage', '渲染舞台'], ['Exporter', '视频导出'], ['SyncEditor', '对轴编辑器'], ['Post', '后期'],
    ['HUD', 'HUD'], ['LyricFX', '歌词特效'],
  ];

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  const S = {
    booted: false,
    engine: null,
    stage: null,
    stageReady: false,
    fallbackCtx: null,
    director: null,
    basePreset: null, //   preset used for the attract reel / before a song is matched
    preset: null, //       preset matched to the loaded audio
    match: null,
    features: null,
    attractFeatures: null,
    audio: null, //        { name, duration, source }
    mode: 'attract', //    'attract' (no audio) | 'song'
    hasPlayed: false,
    lyricsText: '',
    lyricsSource: 'none',
    track: null,
    synced: null,
    lyricOffset: 0,
    settings: { hud: true, credits: true, quality: 'auto', debug: false, volume: 1 },
    override: {}, //       URL overrides (not persisted)
    t: 0,
    dirty: true,
    seekDirty: true,
    frozen: false,
    attractT0: 0,
    lastAttract: -1e9,
    lastUi: -1e9,
    lastDebug: -1e9,
    lastRender: null,
    renderErr: false,
    menuOpen: false,
    panel: null,
    uiHidden: false,
    idle: false,
    idleTimer: 0,
    overBar: false,
    scrub: null,
    hoverX: -1,
    busy: null,
    loadToken: 0,
    loading: null,
    exporter: null,
    exportResult: null,
    exportURL: null,
    exportOpts: { res: '1080', fps: '30', range: 'all', from: 0, to: 10 },
    caps: null,
    sync: null,
    missing: [],
    toasts: new Map(),
    bannerDismissed: false,
    assetList: undefined,
  };

  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));

  /* ------------------------------------------------------------------ */
  /* DOM refs                                                            */
  /* ------------------------------------------------------------------ */
  const D = {};
  function grabDom() {
    [
      'app', 'stage', 'stageWrap', 'attractTag', 'menu', 'menuTitle', 'menuLatin', 'menuCredit', 'menuList', 'miPlayZh', 'miPlayEn',
      'stAudio', 'stAudioRow', 'stPreset', 'stPresetRow', 'stLyrics', 'stLyricsRow',
      'panelLyrics', 'panelSettings', 'panelExport', 'lyricsText', 'btnLyricsApply', 'btnLyricsFile', 'btnLyricsClear',
      'lyricsResult', 'lyricsWarn', 'setHud', 'setCredits', 'setQuality', 'setOffset', 'offMinus', 'offPlus', 'offsetOut',
      'offReset', 'setVolume', 'setDebug', 'btnClearCache', 'exRes', 'exFps', 'exRange', 'exCustom', 'exFrom', 'exTo',
      'exSummary', 'exCaps', 'btnExportStart', 'btnExportCancel', 'exProgress', 'exBarFill', 'exPct', 'exInfo', 'exResult',
      'bar', 'btnPlay', 'btnPlayIcon', 'tCur', 'tDur', 'seek', 'seekCanvas', 'seekTip', 'bSection',
      'lyricsBanner', 'bannerClose', 'bigPlay', 'busy', 'busyTitle', 'busyFill', 'busyPct', 'drop', 'osd', 'toasts',
      'debugBox', 'fileAudio', 'fileLyrics',
    ].forEach((id) => (D[id] = $(id)));
    D.panels = { lyrics: D.panelLyrics, settings: D.panelSettings, export: D.panelExport };
    D.menuEmblem = document.querySelector('.menu-emblem');
  }

  /* ------------------------------------------------------------------ */
  /* Toasts & OSD                                                        */
  /* ------------------------------------------------------------------ */
  /**
   * Show a toast. kind: 'info' | 'ok' | 'error'. opts: { key (dedupe), ms }.
   * Never throws.
   */
  function toast(msg, kind = 'info', opts = {}) {
    try {
      if (!D.toasts) return null;
      const key = opts.key || kind + ':' + msg;
      const old = S.toasts.get(key);
      if (old) {
        clearTimeout(old.timer);
        old.timer = setTimeout(() => dismissToast(key), opts.ms || (kind === 'error' ? 7000 : 4200));
        return old.el;
      }
      const el = document.createElement('div');
      el.className = 'toast' + (kind === 'error' ? ' is-error' : kind === 'ok' ? ' is-ok' : '');
      el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
      el.innerHTML = msg;
      el.addEventListener('click', () => dismissToast(key));
      D.toasts.appendChild(el);
      while (D.toasts.children.length > 5) {
        const first = D.toasts.firstElementChild;
        for (const [k, v] of S.toasts) if (v.el === first) S.toasts.delete(k);
        first.remove();
      }
      const rec = { el, timer: setTimeout(() => dismissToast(key), opts.ms || (kind === 'error' ? 7000 : 4200)) };
      S.toasts.set(key, rec);
      return el;
    } catch (e) {
      return null;
    }
  }
  function dismissToast(key) {
    const rec = S.toasts.get(key);
    if (!rec) return;
    S.toasts.delete(key);
    clearTimeout(rec.timer);
    rec.el.classList.add('is-leaving');
    setTimeout(() => rec.el.remove(), 200);
  }
  function osd(label, value) {
    if (!D.osd) return;
    D.osd.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'osd-item';
    el.innerHTML = esc(label) + (value != null ? '<b>' + esc(value) + '</b>' : '');
    D.osd.appendChild(el);
    clearTimeout(S.osdTimer);
    S.osdTimer = setTimeout(() => el.remove(), 1150);
  }
  const errMsg = (e) => esc((e && e.message) || String(e || 'unknown error'));

  /* ------------------------------------------------------------------ */
  /* Busy indicator                                                      */
  /* ------------------------------------------------------------------ */
  function setBusy(zh, en, p, audio = true) {
    if (!D.busy) return;
    D.busy.hidden = false;
    D.busyTitle.innerHTML = esc(zh) + ' <span>' + esc(en) + '</span>';
    setBusyProgress(p);
    if (audio) setStatusRow('audio', 'busy');
  }
  function setBusyProgress(p) {
    if (!D.busy) return;
    const ind = p == null;
    D.busy.classList.toggle('is-indeterminate', ind);
    D.busyFill.style.width = ind ? '' : Math.round(clamp(p) * 100) + '%';
    D.busyPct.textContent = ind ? '…' : Math.round(clamp(p) * 100) + '%';
  }
  function hideBusy() {
    if (D.busy) D.busy.hidden = true;
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */
  function loadSettings() {
    try {
      const raw = store.get(SETTINGS_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        if (o && typeof o === 'object') {
          if (typeof o.hud === 'boolean') S.settings.hud = o.hud;
          if (typeof o.credits === 'boolean') S.settings.credits = o.credits;
          if (['auto', '1', '0.75', '0.5'].includes(String(o.quality))) S.settings.quality = String(o.quality);
          if (typeof o.debug === 'boolean') S.settings.debug = o.debug;
          if (typeof o.volume === 'number') S.settings.volume = clamp(o.volume);
        }
      }
    } catch (e) {
      /* ignore corrupt settings */
    }
    const q = qget('quality');
    if (q && ['auto', '1', '1.0', '0.75', '0.5'].includes(q)) S.override.quality = q === '1.0' ? '1' : q;
    if (qget('hud') === '0') S.override.hud = false;
    if (qget('hud') === '1') S.override.hud = true;
    if (qget('debug') === '1') S.override.debug = true;
    if (qget('debug') === '0') S.override.debug = false;
  }
  function saveSettings() {
    store.set(SETTINGS_KEY, JSON.stringify(S.settings));
  }
  /** Effective setting (URL override wins until the user changes it). */
  function setting(k) {
    return Object.prototype.hasOwnProperty.call(S.override, k) ? S.override[k] : S.settings[k];
  }
  function dirOptions() {
    return { hud: !!setting('hud'), credits: !!setting('credits') };
  }
  /**
   * Change a setting (persisted). k: 'hud' | 'credits' | 'quality' | 'debug' | 'volume'.
   */
  function setSetting(k, v) {
    if (k === 'quality') v = String(v) === '1.0' ? '1' : String(v);
    S.settings[k] = v;
    delete S.override[k];
    saveSettings();
    if (k === 'hud' || k === 'credits') {
      if (S.director && S.director.setOptions) {
        try {
          S.director.setOptions(dirOptions());
        } catch (e) {
          reportError('director.setOptions', e);
        }
      }
    } else if (k === 'quality') applyQuality();
    else if (k === 'debug') applyDebug();
    else if (k === 'volume' && S.engine && S.engine.setVolume) S.engine.setVolume(clamp(+v));
    S.dirty = true;
    syncSettingsUI();
  }

  function autoScale() {
    const r = D.stage ? D.stage.getBoundingClientRect() : { width: 1920 };
    const dpr = window.devicePixelRatio || 1;
    const need = (Math.max(1, r.width) * dpr) / 1920;
    if (need <= 0.55) return 0.5;
    if (need <= 0.8) return 0.75;
    return 1;
  }
  function applyQuality() {
    if (!S.stage) return;
    const q = setting('quality');
    try {
      if (q === 'auto') {
        const sc = autoScale();
        if (Math.abs(S.stage.baseScale - sc) > 1e-3 || !S.stage.adaptive) S.stage.resize(sc);
        S.stage.setAdaptive(true);
      } else {
        const sc = clamp(parseFloat(q) || 1, 0.25, 1);
        S.stage.setAdaptive(false);
        if (Math.abs(S.stage.baseScale - sc) > 1e-3 || S.stage.scale !== sc) S.stage.resize(sc);
      }
    } catch (e) {
      reportError('stage.resize', e);
    }
    S.dirty = true;
  }
  function applyDebug() {
    const on = !!setting('debug');
    if (S.stage && S.stage.setDebug) S.stage.setDebug(on);
    if (D.debugBox) D.debugBox.hidden = !on;
    S.dirty = true;
  }

  /* ------------------------------------------------------------------ */
  /* Lyric offset (shared with the sync editor: 'mv.offset.<presetId>')  */
  /* ------------------------------------------------------------------ */
  function activePreset() {
    return S.mode === 'song' ? S.preset : S.basePreset;
  }
  function loadOffset(p) {
    if (MV.SyncEditor && MV.SyncEditor.loadOffset) return fin(MV.SyncEditor.loadOffset(p), 0);
    const v = parseFloat(store.get('mv.offset.' + ((p && p.id) || 'custom')));
    return isFinite(v) ? clamp(v, -OFFSET_MAX, OFFSET_MAX) : 0;
  }
  function saveOffset(p, v) {
    if (MV.SyncEditor && MV.SyncEditor.saveOffset) return MV.SyncEditor.saveOffset(p, v);
    return store.set('mv.offset.' + ((p && p.id) || 'custom'), String(Math.round(v * 1000) / 1000));
  }
  /** Set the global lyric offset (s, ±2, persisted per preset) and re-time the track. */
  function setLyricOffset(v, opts = {}) {
    v = Math.round(clamp(fin(+v, 0), -OFFSET_MAX, OFFSET_MAX) * 1000) / 1000;
    if (Math.abs(v) < 1e-6) v = 0;
    S.lyricOffset = v;
    saveOffset(activePreset(), v);
    if (S.lyricsText) applyTrack({ keepFonts: true });
    syncSettingsUI();
    if (opts.osd) osd('歌词偏移 OFFSET', fmtOffset(v));
    return v;
  }

  /* ------------------------------------------------------------------ */
  /* Module check                                                        */
  /* ------------------------------------------------------------------ */
  function checkModules() {
    const missing = [];
    if (!MV.W || !MV.draw) missing.push('core.js');
    for (const [name, zh] of MODULES) if (!MV[name]) missing.push('MV.' + name + '（' + zh + '）');
    const regs = [['scenes', '场景'], ['lyricStyles', '歌词样式'], ['transitions', '转场'], ['effects', '特效']];
    for (const [r, zh] of regs) if (!MV[r] || !MV[r].list || !MV[r].list().length) missing.push('MV.' + r + '（' + zh + '）');
    if (!window.Mp4Muxer) missing.push('mp4-muxer');
    if (!MV.presets || !MV.presets.length) missing.push('preset（时间轴预设）');
    S.missing = missing;
    if (missing.length) {
      toast('<b>部分模块未载入，已降级运行</b><br>Missing: ' + esc(missing.join(' · ')), 'error', { key: 'missing', ms: 12000 });
      console.warn('[MV.app] missing modules:', missing.join(', '));
    }
  }
  const reported = new Set();
  function reportError(where, e) {
    const key = where + ':' + ((e && e.message) || e);
    if (reported.has(key)) return;
    reported.add(key);
    console.warn('[MV.app] ' + where, e);
    toast('<b>出错了</b> · ' + esc(where) + '<br>' + errMsg(e), 'error', { key });
  }

  /* ------------------------------------------------------------------ */
  /* Synthetic (preset-derived) features for the attract reel            */
  /* ------------------------------------------------------------------ */
  function presetDuration(p) {
    return (p && p.match && fin(p.match.duration, 0)) || (p && p.sections && p.sections.length ? p.sections[p.sections.length - 1].end : 0) || 180;
  }
  /**
   * Deterministic features from a preset: preset grid and sections plus
   * synthetic envelopes shaped by section intensity and beat pulses.
   */
  function syntheticFeatures(p, duration) {
    const dur = fin(duration, 0) || presetDuration(p);
    const fps = 100;
    const n = Math.max(1, Math.ceil(dur * fps));
    const mk = () => new Float32Array(n);
    const rms = mk(), low = mk(), mid = mk(), high = mk(), flux = mk();
    const beats = (p && p.beats && p.beats.length ? p.beats : []).filter((b) => b <= dur);
    const secs = (p && p.sections) || [{ kind: 'verse', start: 0, end: dur, intensity: 0.5 }];
    const rnd = MV.rand || ((s, i, j) => (((Math.sin(s * 12.9898 + i * 78.233 + (j || 0) * 37.719) * 43758.5453) % 1) + 1) % 1);
    const low2 = MV.lowerIndex || ((arr, x) => {
      let k = -1;
      for (let i = 0; i < arr.length && arr[i] <= x; i++) k = i;
      return k;
    });
    let si = 0;
    for (let i = 0; i < n; i++) {
      const t = i / fps;
      while (si + 1 < secs.length && t >= secs[si].end) si++;
      const I = clamp(fin(secs[si].intensity, 0.5));
      const bi = low2(beats, t);
      const ph = bi >= 0 ? Math.exp((-(t - beats[bi]) * 4.6) / 0.25) : 0;
      const nz = rnd(77, i) * 0.08;
      rms[i] = clamp(I * (0.65 + 0.3 * ph) + nz);
      low[i] = clamp(I * (0.4 + 0.6 * ph) + nz);
      mid[i] = clamp(I * 0.8 + nz);
      high[i] = clamp(I * (0.5 + 0.4 * rnd(78, i)));
      flux[i] = clamp(ph * I + nz);
    }
    const onsets = beats.map((b, k) => {
      const s = secs.find((x) => b >= x.start && b < x.end) || secs[secs.length - 1];
      return { t: b, s: clamp((k % 4 === 0 ? 0.75 : 0.45) + 0.35 * fin(s.intensity, 0.5) * rnd(91, k)) };
    });
    const f = {
      duration: dur, sampleRate: 22050, fps, length: n, rms, low, mid, high, flux, onsets, kicks: [],
      bpm: (p && p.bpm) || 120, beatsPerBar: (p && p.beatsPerBar) || 4, beats: beats.slice(),
      downbeats: beats.filter((_, k) => k % 4 === 0),
      sections: secs.map((s) => Object.assign({}, s)), novelty: new Float32Array(0),
      source: 'computed', presetId: null, presetOffset: 0, presetConfidence: 0, synthetic: true,
    };
    if (p && MV.Analysis && MV.Analysis.applyPreset) {
      try {
        MV.Analysis.applyPreset(f, p, 0, 0);
      } catch (e) {
        /* keep the raw copy */
      }
    }
    f.synthetic = true;
    return f;
  }

  /* ------------------------------------------------------------------ */
  /* Director / stage                                                    */
  /* ------------------------------------------------------------------ */
  function currentFeatures() {
    return S.mode === 'song' ? S.features : S.attractFeatures;
  }
  /**
   * Minimal stand-in used only when MV.Director is missing: a pure function
   * of t (preset / feature grid, one scene per section, active lyric lines),
   * so the stage never goes blank.
   */
  function FallbackDirector(cfg) {
    const f = cfg.features || {};
    const p = cfg.preset || {};
    this.version = 1;
    this.track = cfg.track || null;
    this.options = cfg.options || {};
    this.duration = fin(f.duration, 0) || presetDuration(p);
    const src = (f.sections && f.sections.length ? f.sections : p.sections) || [{ kind: 'verse', name: 'VERSE', start: 0, end: this.duration }];
    this.sections = src.map((x, i) => ({ index: i, kind: x.kind || 'verse', name: x.name || String(x.kind || 'verse').toUpperCase(), start: x.start, end: x.end, intensity: fin(x.intensity, 0.5) }));
    this.beats = (f.beats && f.beats.length ? f.beats : p.beats) || [];
    this.bpm = fin(f.bpm, 0) || fin(p.bpm, 0) || 120;
    this.meta = p.meta || {};
  }
  FallbackDirector.prototype.sectionAt = function (t) {
    let s = this.sections[0];
    for (const x of this.sections) if (x.start <= t) s = x;
    return s;
  };
  FallbackDirector.prototype.setTrack = function (tr) {
    this.track = tr || null;
    this.version++;
    return this;
  };
  FallbackDirector.prototype.setOptions = function (o) {
    Object.assign(this.options, o || {});
    this.version++;
    return this;
  };
  FallbackDirector.prototype.fontText = function () {
    return (this.track && this.track.lines ? this.track.lines.map((l) => l.text).join('') : '') + (this.meta.title || '');
  };
  FallbackDirector.prototype.evaluate = function (t) {
    const sec = this.sectionAt(t);
    const period = 60 / this.bpm;
    let bi = -1;
    for (let i = 0; i < this.beats.length && this.beats[i] <= t; i++) bi = i;
    const bt = bi >= 0 ? this.beats[bi] : 0;
    const since = Math.max(0, t - bt);
    const pulse = Math.exp((-since * 4.6) / 0.35);
    const inBar = ((bi % 4) + 4) % 4;
    const I = clamp(sec.intensity);
    const quiet = { intro: 1, verse: 1, bridge: 1, outro: 1, build: 1 };
    const scenes = { bridge: 'starfield', outro: 'starfield', build: 'starfield', verse: 'night-city', intro: 'sunburst' };
    const env = {
      t, dt: 1 / 60, duration: this.duration, energy: I, low: I * (0.6 + 0.4 * pulse), mid: I * 0.8, high: I * 0.6, flux: pulse * I, onsetPulse: pulse * I,
      beat: { index: bi, phase: clamp(since / period), period, bar: Math.floor(bi / 4), barPhase: (inBar + clamp(since / period)) / 4, beatInBar: inBar, sinceBeat: since, sinceDownbeat: since + inBar * period, pulse, barPulse: inBar === 0 ? pulse : 0 },
      section: { kind: sec.kind, name: sec.name, start: sec.start, end: sec.end, index: sec.index, progress: clamp((t - sec.start) / Math.max(0.01, sec.end - sec.start)), intensity: I },
      intensity: I, quality: 1, seed: 1 + sec.index,
    };
    const lyrics = [];
    for (const l of (this.track && this.track.lines) || []) {
      if (t >= l.showStart && t < l.showEnd && lyrics.length < 2) {
        lyrics.push({ line: l, style: l.style || 'dialog', lt: { t: t - l.start, in: clamp((t - l.showStart) / 0.25), out: clamp((t - (l.showEnd - 0.2)) / 0.2), showStart: l.showStart, showEnd: l.showEnd } });
      }
    }
    return {
      t, env,
      scene: { from: { name: scenes[sec.kind] || (quiet[sec.kind] ? 'starfield' : 'sunburst'), p: { seed: 7 + sec.index, lt: t - sec.start, dur: sec.end - sec.start, variant: 0, speed: 1, intensity: I } }, to: null, transition: null },
      lyrics, accents: [], camera: { x: 0, y: 0, zoom: 1 + 0.015 * pulse * I, rot: 0 },
      post: { rgbShift: 0, glitch: 0, glitchSeed: 0, grain: 0.06, vignette: 0.35, flash: 0, redFlash: 0, invert: 0, scanlines: 0, time: t },
      hud: { title: this.meta.title || '', artist: this.meta.artist || '', duration: this.duration, visible: false, sectionName: sec.name },
    };
  };

  function buildDirector() {
    if (!MV.Director) {
      try {
        S.director = new FallbackDirector({ features: currentFeatures(), track: S.track, preset: S.mode === 'song' ? S.preset : S.basePreset, options: dirOptions() });
      } catch (e) {
        S.director = null;
      }
      if (S.stage) S.stage.setDirector(S.director);
      S.dirty = true;
      S.seekDirty = true;
      return S.director;
    }
    try {
      S.director = new MV.Director({
        features: currentFeatures(),
        track: S.track,
        preset: S.mode === 'song' ? S.preset : S.basePreset,
        options: dirOptions(),
      });
    } catch (e) {
      reportError('Director', e);
      S.director = null;
    }
    if (S.stage) S.stage.setDirector(S.director);
    S.dirty = true;
    S.seekDirty = true;
    return S.director;
  }
  function duration() {
    if (S.mode === 'song' && S.audio) return S.audio.duration;
    if (S.director && S.director.duration) return S.director.duration;
    return presetDuration(S.basePreset);
  }
  function sectionAt(t) {
    if (!S.director || !S.director.sectionAt) return null;
    try {
      return S.director.sectionAt(t) || null;
    } catch (e) {
      return null;
    }
  }
  /**
   * Run scene / effect prepare hooks once, start rendering right away, and
   * load the web-font glyphs in the background (layouts are invalidated when
   * they arrive). In test mode the fonts are awaited so frames are final.
   */
  async function prepareStage() {
    if (!S.stage) return;
    try {
      await S.stage.prepare({ fontTimeout: 80 });
    } catch (e) {
      reportError('stage.prepare', e);
    }
    S.stageReady = true;
    S.dirty = true;
    const fonts = refreshFonts();
    if (TEST) await fonts;
  }
  /** Load web-font glyphs for every drawable string, then re-layout. */
  function refreshFonts() {
    if (!MV.fonts || !MV.fonts.ensure) return Promise.resolve();
    let sample = '';
    try {
      sample = (S.director && S.director.fontText ? S.director.fontText() : '') + ((MV.LyricFX && MV.LyricFX.fontSample) || '');
    } catch (e) {
      sample = '';
    }
    const p = MV.fonts.ensure(sample, 8000).then(() => {
      if (S.stage) S.stage.invalidateLayouts();
      S.dirty = true;
    });
    S.fontsPromise = p;
    return p;
  }

  /** Render the frame at song time t into the visible canvas. */
  function renderNow(t) {
    S.t = t;
    S.dirty = false;
    if (S.stage) {
      if (!S.stageReady) return null;
      try {
        const r = S.stage.renderFrame(t);
        S.lastRender = r;
        if (r && r.state && r.state.env && S.menuOpen && D.menuEmblem) {
          // Emblem bumps on the beat (scoped to one element: no menu-wide style recalc).
          const b = r.state.env.beat;
          const v = b ? clamp(fin(b.pulse, 0)).toFixed(2) : '0';
          if (v !== S.beatVar) D.menuEmblem.style.setProperty('--beat', (S.beatVar = v));
        }
        return r;
      } catch (e) {
        if (!S.renderErr) reportError('renderFrame', e);
        S.renderErr = true;
        return null;
      }
    }
    fallbackPaint(t);
    return null;
  }
  // Minimal painter when MV.Stage is missing (the page must never look empty).
  function fallbackPaint(t) {
    try {
      if (!S.fallbackCtx) {
        D.stage.width = 960;
        D.stage.height = 540;
        S.fallbackCtx = D.stage.getContext('2d');
      }
      const ctx = S.fallbackCtx;
      if (!ctx) return;
      const w = 960, h = 540;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = C.black;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = C.red;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w * 0.55, 0);
      ctx.lineTo(w * 0.42, h);
      ctx.lineTo(0, h);
      ctx.fill();
      ctx.fillStyle = C.white;
      ctx.font = '400 64px "Dela Gothic One", sans-serif';
      const m = (S.basePreset && S.basePreset.meta) || {};
      ctx.fillText(m.title || 'MV', 48, h / 2);
      ctx.font = '400 28px Anton, Impact, sans-serif';
      ctx.fillText(fmtClock(t, true), 48, h / 2 + 50);
    } catch (e) {
      /* ignore */
    }
  }

  function attractTime(now) {
    if (!S.attractT0) S.attractT0 = now;
    const dur = duration();
    const scale = S.basePreset ? dur / presetDuration(S.basePreset) : 1;
    let total = 0;
    for (const r of REEL) total += r[1];
    let e = ((now - S.attractT0) / 1000) % total;
    for (const r of REEL) {
      if (e < r[1]) return clamp(r[0] * scale + e, 0, Math.max(0, dur - 0.02));
      e -= r[1];
    }
    return 0;
  }
  function attractActive() {
    if (S.frozen || S.exporter) return false;
    if (S.mode === 'attract') return true;
    // Song loaded but never played: keep the start screen alive behind the menu.
    return S.menuOpen && !S.hasPlayed && !(S.engine && S.engine.playing) && !S.scrub;
  }
  function currentT() {
    if (S.mode === 'song' && S.engine && S.engine.buffer && !attractActive()) return S.scrub ? S.t : S.engine.currentTime;
    return S.t;
  }

  /* ------------------------------------------------------------------ */
  /* Render loop                                                         */
  /* ------------------------------------------------------------------ */
  function loop(now) {
    requestAnimationFrame(loop);
    let t = null;
    const playing = !!(S.mode === 'song' && S.engine && S.engine.playing);
    if (playing) {
      if (!S.exporter) t = S.engine.currentTime;
    } else if (attractActive() && !TEST) {
      if (!document.hidden && now - S.lastAttract >= 1000 / ATTRACT_FPS - 2) {
        t = attractTime(now);
        S.lastAttract = now;
      }
    }
    if (t == null && S.dirty) t = currentT();
    if (t != null) renderNow(t);
    uiTick(now);
  }

  /* ------------------------------------------------------------------ */
  /* UI updates                                                          */
  /* ------------------------------------------------------------------ */
  function uiTick(now) {
    const t = S.t;
    if (now - S.lastUi >= 66 || S.seekDirty) {
      S.lastUi = now;
      const dur = duration();
      const showT = attractActive() && S.mode === 'song' ? currentT() : t;
      const txt = fmtClock(showT);
      if (D.tCur && D.tCur.textContent !== txt) D.tCur.textContent = txt;
      const dtxt = S.mode === 'song' || S.director ? fmtClock(dur) : '0:00';
      if (D.tDur && D.tDur.textContent !== dtxt) D.tDur.textContent = dtxt;
      drawSeek(showT);
      const sec = sectionAt(t);
      const name = sec ? sec.name || String(sec.kind || '').toUpperCase() : '—';
      if (D.bSection && D.bSection.textContent !== name) {
        D.bSection.textContent = name;
        D.bSection.dataset.kind = (sec && sec.kind) || '';
        D.bSection.title = sec ? (KIND_ZH[sec.kind] || sec.kind) : '';
      }
      if (D.seek) {
        D.seek.setAttribute('aria-valuemax', dur.toFixed(1));
        D.seek.setAttribute('aria-valuenow', showT.toFixed(1));
        D.seek.setAttribute('aria-valuetext', fmtClock(showT) + (sec ? ' ' + name : ''));
      }
    }
    if (setting('debug') && now - S.lastDebug >= 250) {
      S.lastDebug = now;
      updateDebug();
    }
  }

  function updateDebug() {
    if (!D.debugBox) return;
    const st = S.stage ? S.stage.stats : null;
    const sec = sectionAt(S.t);
    const f = S.features;
    const lines = [
      't ' + S.t.toFixed(3) + '  ' + (sec ? sec.name : '-') + '  mode ' + S.mode + (attractActive() ? ' (attract)' : '') + (S.frozen ? ' frozen' : ''),
      st ? 'fps ' + (st.fps || 0).toFixed(1) + '  frame ' + (st.renderMs || 0).toFixed(1) + ' ms (avg ' + (st.avgMs || 0).toFixed(1) + ')  eval ' + (st.evalMs || 0).toFixed(2) + ' ms' : 'no stage',
      st ? 'scale ' + st.scale + ' (' + setting('quality') + (S.stage.adaptive ? ', adaptive' : '') + ')  post ' + st.post + '  downgrades ' + st.downgrades : '',
      'preset ' + (S.preset ? S.preset.id : S.mode === 'attract' && S.basePreset ? S.basePreset.id + ' (attract)' : '-') +
        (f ? '  offset ' + fin(f.presetOffset, 0).toFixed(3) + '  conf ' + fin(f.presetConfidence, 0).toFixed(2) + '  ' + f.source : ''),
      'lyrics ' + (S.track ? S.track.lines.length + ' (' + S.track.source + (S.track.synced ? ', synced' : '') + ')' : 'none') + '  offset ' + fmtOffset(S.lyricOffset),
      'errors ' + (S.stage && S.stage.errors ? S.stage.errors.size : 0) + (S.missing.length ? '  missing ' + S.missing.length : ''),
    ];
    D.debugBox.textContent = lines.filter(Boolean).join('\n');
  }

  /* ---------------- seek bar ---------------- */
  function sizeSeek() {
    if (!D.seekCanvas) return;
    const r = D.seek.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(10, Math.round(r.width * dpr));
    const h = Math.max(10, Math.round(r.height * dpr));
    if (D.seekCanvas.width !== w || D.seekCanvas.height !== h) {
      D.seekCanvas.width = w;
      D.seekCanvas.height = h;
    }
    S.seekDirty = true;
  }
  function drawSeek(t) {
    const cv = D.seekCanvas;
    if (!cv) return;
    const key = [cv.width, cv.height, t.toFixed(2), S.hoverX, S.director ? S.director.version : -1, S.mode].join('|');
    if (!S.seekDirty && key === S.seekKey) return;
    S.seekKey = key;
    S.seekDirty = false;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const w = cv.width, h = cv.height;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const dur = duration();
    if (!(dur > 0)) return;
    const pad = 6 * dpr;
    const x0 = pad, x1 = w - pad, span = x1 - x0;
    const X = (tt) => x0 + clamp(tt / dur) * span;
    const top = 9 * dpr, bottom = h - 3 * dpr, fullH = bottom - top;
    const skew = 5 * dpr;
    const px = X(t);
    const secs = (S.director && S.director.sections) || [];
    const drawSegs = (alpha) => {
      for (const s of secs) {
        const a = X(s.start) + 1.5 * dpr, b = X(s.end) - 1.5 * dpr;
        if (b - a < 1) continue;
        const st = KIND_STYLE[s.kind] || { fill: C.paper };
        const hh = fullH * (0.42 + 0.58 * clamp(fin(s.intensity, 0.5)));
        const y = bottom - hh;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(a + skew, y);
        ctx.lineTo(b + skew, y);
        ctx.lineTo(b, bottom);
        ctx.lineTo(a, bottom);
        ctx.closePath();
        ctx.fillStyle = st.fill;
        ctx.fill();
        if (st.stripes || st.stars) {
          ctx.save();
          ctx.clip();
          if (st.stripes) {
            ctx.strokeStyle = C.black;
            ctx.lineWidth = 2 * dpr;
            ctx.beginPath();
            for (let k = a - hh; k < b + skew; k += 7 * dpr) {
              ctx.moveTo(k, bottom);
              ctx.lineTo(k + hh, y);
            }
            ctx.stroke();
          } else {
            ctx.fillStyle = C.star;
            for (let k = 0; k * 9 * dpr < b - a; k++) {
              const sx = a + 4 * dpr + k * 9 * dpr + ((k * 7) % 5) * dpr * 0.6;
              const sy = y + 3 * dpr + ((k * 5) % 3) * (hh - 6 * dpr) / 2;
              ctx.fillRect(sx, sy, 1.6 * dpr, 1.6 * dpr);
            }
          }
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
    };
    drawSegs(0.3);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, px, h);
    ctx.clip();
    drawSegs(1);
    ctx.restore();
    // Lyric line ticks.
    const lines = S.track && S.track.lines ? S.track.lines : [];
    for (const l of lines) {
      const lx = X(l.start);
      ctx.fillStyle = l.start <= t ? C.white : 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.moveTo(lx - 2.5 * dpr, 0);
      ctx.lineTo(lx + 2.5 * dpr, 0);
      ctx.lineTo(lx, 6 * dpr);
      ctx.closePath();
      ctx.fill();
    }
    // Hover guide.
    if (S.hoverX >= 0 && !S.scrub) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(Math.round(S.hoverX * dpr) - dpr * 0.5, top - 2 * dpr, dpr, bottom - top + 2 * dpr);
    }
    // Playhead: skewed white bar with a hard red offset.
    const ph = (x, col) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x - 2 * dpr + 4 * dpr, 1 * dpr);
      ctx.lineTo(x + 3 * dpr + 4 * dpr, 1 * dpr);
      ctx.lineTo(x + 3 * dpr - 2 * dpr, h);
      ctx.lineTo(x - 2 * dpr - 2 * dpr, h);
      ctx.closePath();
      ctx.fill();
    };
    ph(px + 3 * dpr, C.red);
    ph(px, C.white);
  }
  function seekFromEvent(e) {
    const r = D.seek.getBoundingClientRect();
    const pad = 6;
    const f = clamp((e.clientX - r.left - pad) / Math.max(1, r.width - 2 * pad));
    return f * duration();
  }
  function canSeek() {
    return S.mode === 'song' && !!(S.engine && S.engine.buffer);
  }

  /* ---------------- status block ---------------- */
  function setStatusRow(which, state) {
    const row = { audio: D.stAudioRow, preset: D.stPresetRow, lyrics: D.stLyricsRow }[which];
    if (row) row.dataset.state = state;
  }
  function lyricsSummary() {
    const tr = S.track;
    if (!S.lyricsText || !tr) return { text: '未粘贴歌词 · 点「歌词」粘贴', state: 'off' };
    const m = tr.matched || {};
    const n = tr.lines ? tr.lines.length : 0;
    if (!n) return { text: '歌词未能对应到任何一句 · 请检查粘贴内容', state: 'warn' };
    const skipped = fin(m.skipped, 0);
    let text;
    let state = 'ok';
    if (tr.synced) {
      text = '已对轴 ' + n + ' 句（手动对轴）';
      if (skipped) text += '，' + skipped + ' 句本录音未演唱';
    } else if (tr.source === 'preset') {
      text = '已匹配 ' + fin(m.displayed, n) + ' 句，' + skipped + ' 句本录音未演唱';
      if (m.fallback) {
        text += '（' + m.fallback + ' 句按顺序对应）';
        state = 'warn';
      }
      if (m.missing) {
        text += '，' + m.missing + ' 句缺失';
        state = 'warn';
      }
    } else if (tr.source === 'lrc') {
      text = '已载入 ' + n + ' 句（LRC 时间轴）';
    } else {
      text = '已载入 ' + n + ' 句 · 自动分配时间（未匹配预设）';
      state = 'warn';
    }
    return { text, state };
  }
  function updateStatus() {
    // Audio.
    if (D.stAudio) {
      if (S.audio) {
        D.stAudio.innerHTML = '<b>' + esc(S.audio.name) + '</b> · <span class="num">' + fmtClock(S.audio.duration, false) + '</span>';
        setStatusRow('audio', 'ok');
      } else if (S.loading) {
        D.stAudio.textContent = '载入中…';
        setStatusRow('audio', 'busy');
      } else {
        D.stAudio.textContent = MV.AudioEngine ? '未载入 · 拖放或点击「载入音频」' : '音频模块缺失';
        setStatusRow('audio', MV.AudioEngine ? 'off' : 'warn');
      }
    }
    // Preset.
    if (D.stPreset) {
      if (S.mode === 'song') {
        const f = S.features || {};
        if (S.preset) {
          const conf = fin(f.presetConfidence, fin(S.match && S.match.confidence, 0));
          D.stPreset.innerHTML = '已匹配 · 置信度 <span class="num">' + conf.toFixed(2) + '</span> · 偏移 <span class="num">' + fmtOffset(fin(f.presetOffset, 0)) + '</span>';
          setStatusRow('preset', conf >= 0.5 ? 'ok' : 'warn');
        } else {
          D.stPreset.textContent = S.features ? '未匹配预设 · 使用自动分析的节拍与段落' : '未分析';
          setStatusRow('preset', 'warn');
        }
      } else {
        D.stPreset.textContent = S.basePreset ? '等待音频 · 预设「' + ((S.basePreset.meta && S.basePreset.meta.title) || S.basePreset.id) + '」' : '无预设';
        setStatusRow('preset', 'off');
      }
    }
    // Lyrics.
    const ls = lyricsSummary();
    if (D.stLyrics) {
      D.stLyrics.textContent = ls.text;
      setStatusRow('lyrics', ls.state);
    }
    // Menu labels.
    const noAudio = !S.audio;
    document.body.classList.toggle('no-audio', noAudio);
    if (D.miPlayZh) {
      const playing = !noAudio && S.engine && S.engine.playing;
      const atEnd = !noAudio && !playing && S.engine.currentTime >= S.engine.duration - 0.05;
      const resume = !noAudio && S.hasPlayed && !playing && !atEnd && S.engine.currentTime > 0.05;
      D.miPlayZh.textContent = playing ? '返回' : atEnd ? '重播' : resume ? '继续' : '播放';
      D.miPlayEn.textContent = playing ? 'RESUME' : atEnd ? 'REPLAY' : resume ? 'CONTINUE' : 'PLAY';
    }
    if (D.menuList) {
      const mark = (act, dis) => {
        const b = D.menuList.querySelector('[data-act="' + act + '"]');
        if (b) b.setAttribute('aria-disabled', dis ? 'true' : 'false');
      };
      mark('sync', noAudio || !MV.SyncEditor);
      mark('export', !MV.Exporter);
      mark('audio', !MV.AudioEngine);
    }
    // Stage tag / banner / bar state.
    if (D.attractTag) D.attractTag.hidden = S.mode !== 'attract' || S.uiHidden;
    updateBanner();
    if (D.seek) D.seek.classList.toggle('is-disabled', !canSeek());
    if (D.lyricsResult && S.panel === 'lyrics') renderLyricsResult();
  }
  function updateBanner() {
    if (!D.lyricsBanner) return;
    const show = !S.lyricsText && !S.bannerDismissed && !S.uiHidden && S.booted;
    D.lyricsBanner.hidden = !show;
  }
  function updatePlayButton() {
    const playing = !!(S.engine && S.engine.playing);
    document.body.classList.toggle('is-playing', playing);
    if (D.btnPlayIcon) D.btnPlayIcon.setAttribute('href', playing ? '#i-pause' : '#i-play');
    if (D.btnPlay) D.btnPlay.setAttribute('aria-label', playing ? '暂停 Pause' : '播放 Play');
  }

  /* ------------------------------------------------------------------ */
  /* Transport                                                           */
  /* ------------------------------------------------------------------ */
  function play() {
    if (!S.engine || !S.engine.buffer) {
      toast('请先载入音频 · Load audio first', 'info', { key: 'need-audio' });
      pickAudio();
      return false;
    }
    S.hasPlayed = true;
    S.frozen = false;
    if (D.bigPlay) D.bigPlay.hidden = true;
    const ok = S.engine.play();
    if (S.engine.setVolume) S.engine.setVolume(clamp(+setting('volume')));
    updatePlayButton();
    updateStatus();
    poke();
    return ok;
  }
  function pause() {
    if (S.engine && S.engine.playing) S.engine.pause();
    S.dirty = true;
    updatePlayButton();
    updateStatus();
    wake();
  }
  function togglePlay() {
    if (S.engine && S.engine.playing) pause();
    else play();
  }
  function seek(t) {
    t = clamp(fin(+t, 0), 0, duration());
    S.hasPlayed = S.hasPlayed || S.mode === 'song';
    if (S.mode === 'song' && S.engine && S.engine.buffer) S.engine.seek(t);
    else S.frozen = true;
    S.t = t;
    S.dirty = true;
    S.seekDirty = true;
    return t;
  }
  function seekBy(dt) {
    if (!canSeek()) {
      toast('请先载入音频 · Load audio first', 'info', { key: 'need-audio' });
      return;
    }
    const t = seek(S.engine.currentTime + dt);
    osd(dt > 0 ? '快进' : '快退', (dt > 0 ? '+' : '−') + Math.abs(dt) + ' s · ' + fmtClock(t));
  }

  /* ------------------------------------------------------------------ */
  /* Menu, panels, UI visibility                                         */
  /* ------------------------------------------------------------------ */
  function openMenu(focus) {
    S.menuOpen = true;
    document.body.classList.add('menu-open');
    D.menu.setAttribute('aria-hidden', 'false');
    updateStatus();
    wake();
    if (focus) {
      const first = D.menuList.querySelector('.mi');
      if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
    }
    S.dirty = true;
  }
  function closeMenu() {
    S.menuOpen = false;
    document.body.classList.remove('menu-open');
    D.menu.setAttribute('aria-hidden', 'true');
    if (document.activeElement && D.menu.contains(document.activeElement)) document.activeElement.blur();
    S.dirty = true;
    poke();
  }
  function toggleMenu() {
    if (S.menuOpen) closeMenu();
    else openMenu(true);
  }

  function openPanel(name) {
    const el = D.panels[name];
    if (!el) return;
    if (S.sync && S.sync.isOpen) S.sync.close();
    for (const k in D.panels) if (k !== name && !D.panels[k].hidden) hidePanelEl(D.panels[k], true);
    clearTimeout(el._hideTimer);
    el.classList.remove('is-leaving');
    el.hidden = false;
    S.panel = name;
    document.body.classList.add('panel-open');
    if (S.uiHidden) setUIHidden(false);
    if (name === 'lyrics') onOpenLyrics();
    else if (name === 'settings') syncSettingsUI();
    else if (name === 'export') onOpenExport();
    wake();
    const f = name === 'lyrics' ? D.lyricsText : el.querySelector('button, input, textarea');
    if (f) setTimeout(() => f.focus({ preventScroll: true }), 40);
  }
  function hidePanelEl(el, instant) {
    if (!el || el.hidden) return;
    if (instant || TEST) {
      el.hidden = true;
      el.classList.remove('is-leaving');
      return;
    }
    el.classList.add('is-leaving');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => {
      el.hidden = true;
      el.classList.remove('is-leaving');
    }, 160);
  }
  function closePanel() {
    if (!S.panel) return;
    const el = D.panels[S.panel];
    if (el && document.activeElement && el.contains(document.activeElement)) document.activeElement.blur();
    hidePanelEl(el);
    S.panel = null;
    document.body.classList.remove('panel-open');
    poke();
  }
  function togglePanel(name) {
    if (S.panel === name) closePanel();
    else openPanel(name);
  }

  function setUIHidden(on) {
    S.uiHidden = !!on;
    document.body.classList.toggle('ui-hidden', S.uiHidden);
    if (S.uiHidden) {
      if (S.menuOpen) closeMenu();
      if (S.panel) closePanel();
    }
    updateStatus();
  }

  function toggleFullscreen() {
    const d = document;
    const el = d.documentElement;
    try {
      const fs = d.fullscreenElement || d.webkitFullscreenElement;
      if (fs) {
        const exit = d.exitFullscreen || d.webkitExitFullscreen;
        if (exit) {
          const p = exit.call(d);
          if (p && p.catch) p.catch(() => {});
        }
        return;
      }
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!req) {
        toast('此浏览器不支持全屏 · Fullscreen unavailable', 'info', { key: 'fs' });
        return;
      }
      const p = req.call(el);
      if (p && p.catch) p.catch(() => toast('无法进入全屏 · Fullscreen was blocked', 'info', { key: 'fs' }));
    } catch (e) {
      toast('无法进入全屏 · Fullscreen failed', 'info', { key: 'fs' });
    }
  }

  // Idle auto-hide of the bar while playing.
  function canIdle() {
    return !TEST && !!(S.engine && S.engine.playing) && !S.menuOpen && !S.panel && !(S.sync && S.sync.isOpen) && !S.overBar && !S.scrub;
  }
  function wake() {
    clearTimeout(S.idleTimer);
    if (S.idle) {
      S.idle = false;
      document.body.classList.remove('is-idle');
    }
  }
  function poke() {
    wake();
    if (canIdle()) {
      S.idleTimer = setTimeout(() => {
        if (canIdle()) {
          S.idle = true;
          document.body.classList.add('is-idle');
        }
      }, IDLE_MS);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Audio loading & analysis                                            */
  /* ------------------------------------------------------------------ */
  function pickAudio() {
    if (!MV.AudioEngine) {
      toast('音频模块缺失，无法载入 · MV.AudioEngine missing', 'error', { key: 'no-engine' });
      return;
    }
    if (D.fileAudio) {
      D.fileAudio.value = '';
      D.fileAudio.click();
    }
  }
  function presetByDuration(dur) {
    for (const p of MV.presets || []) {
      const m = p.match || {};
      if (m.duration && Math.abs(m.duration - dur) <= fin(m.tolerance, 2)) return p;
    }
    return null;
  }

  /**
   * Load audio from { file } | { url, name } | { arrayBuffer, name }, analyse it,
   * match a preset and rebuild the director. Resolves true on success.
   */
  function loadAudio(src, opts = {}) {
    const job = loadAudioJob(src, opts);
    S.loading = job;
    job.then(() => {
      if (S.loading === job) S.loading = null;
      updateStatus();
    });
    return job;
  }
  async function loadAudioJob(src, opts) {
    if (!S.engine) {
      toast('音频模块缺失，无法载入 · MV.AudioEngine missing', 'error', { key: 'no-engine' });
      return false;
    }
    const token = ++S.loadToken;
    const wasPlaying = S.engine.playing;
    if (wasPlaying) S.engine.pause();
    setBusy('解码音频', 'DECODING', null);
    updateStatus();
    let buffer;
    try {
      if (src.file) buffer = await S.engine.loadFile(src.file);
      else if (src.url) buffer = await S.engine.loadURL(src.url, src.name);
      else if (src.arrayBuffer) buffer = await S.engine.loadArrayBuffer(src.arrayBuffer, src.name || 'audio');
      else throw new Error('没有音频来源 (no audio source)');
    } catch (e) {
      if (token === S.loadToken) {
        hideBusy();
        if (!opts.quiet) toast('<b>音频载入失败</b><br>' + errMsg(e), 'error', { key: 'audio-fail' });
        updateStatus();
      }
      return false;
    }
    if (token !== S.loadToken) return false;
    if (src.file && opts.cache !== false && MV.AudioEngine.cacheSave && S.engine.arrayBuffer) {
      MV.AudioEngine.cacheSave(S.engine.name, S.engine.arrayBuffer).catch(() => false);
    }
    // Analysis.
    let f = null;
    let match = null;
    if (MV.Analysis && MV.Analysis.compute) {
      setBusy('分析音频', 'ANALYZING', 0);
      try {
        f = await MV.Analysis.compute(buffer, { onProgress: (p) => token === S.loadToken && setBusyProgress(p) });
      } catch (e) {
        reportError('Analysis.compute', e);
        f = null;
      }
      if (token !== S.loadToken) return false;
      if (f) {
        try {
          match = MV.Analysis.matchPreset(f, MV.presets || []);
        } catch (e) {
          match = null;
        }
        if (match && match.preset) {
          try {
            MV.Analysis.applyPreset(f, match.preset, match.offset, match.confidence);
          } catch (e) {
            reportError('Analysis.applyPreset', e);
          }
        } else match = null;
      }
    }
    if (!f) {
      const p = presetByDuration(buffer.duration);
      f = p ? syntheticFeatures(p, buffer.duration) : null;
      if (f) {
        f.presetId = p.id;
        f.source = 'preset';
      }
      match = p ? { preset: p, offset: 0, confidence: 0 } : null;
    }
    S.features = f;
    S.match = match;
    S.preset = match ? match.preset : null;
    S.audio = { name: S.engine.name || 'audio', duration: buffer.duration, source: src.file ? 'file' : src.url ? 'url' : 'cache' };
    S.mode = 'song';
    S.hasPlayed = false;
    S.frozen = false;
    S.t = 0;
    S.lyricOffset = loadOffset(S.preset);
    if (S.sync && S.sync.setPreset) S.sync.setPreset(S.preset);
    // Prefer lyrics stored for the matched preset when the text came from storage.
    if ((S.lyricsSource === 'storage' || S.lyricsSource === 'none') && S.preset) {
      const txt = store.get(lyricsKey(S.preset.id));
      if (txt && txt !== S.lyricsText) {
        S.lyricsText = txt;
        S.lyricsSource = 'storage';
      }
    }
    S.synced = loadSynced();
    S.track = buildTrack();
    buildDirector();
    setBusy('准备画面', 'PREPARING', null);
    await prepareStage();
    if (token !== S.loadToken) return false;
    hideBusy();
    if (S.engine.setVolume) S.engine.setVolume(clamp(+setting('volume')));
    updateStatus();
    updatePlayButton();
    syncSettingsUI();
    S.dirty = true;
    S.seekDirty = true;
    if (!opts.quiet) {
      const pm = S.preset ? ' · 已匹配预设' : ' · 未匹配预设（自动分析）';
      toast('<b>音频就绪</b> · ' + esc(S.audio.name) + pm, 'ok', { key: 'audio-ok' });
    }
    if (opts.autoplay || wasPlaying) play();
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Lyrics                                                              */
  /* ------------------------------------------------------------------ */
  function loadSynced() {
    const p = activePreset();
    const raw = store.get(syncedKey(p && p.id));
    if (!raw || !S.lyricsText) return null;
    try {
      const o = JSON.parse(raw);
      if (!o || typeof o.lrc !== 'string' || o.key !== textKey(S.lyricsText)) return null;
      return o;
    } catch (e) {
      return null;
    }
  }
  function saveSynced(track) {
    if (!MV.Lyrics || !MV.Lyrics.toLRC || !track) return;
    try {
      const p = activePreset();
      const f = currentFeatures();
      const o = {
        v: 1, key: textKey(S.lyricsText), lrc: MV.Lyrics.toLRC(track),
        baked: S.lyricOffset, presetOffset: fin(f && f.presetOffset, 0),
      };
      store.set(syncedKey(p && p.id), JSON.stringify(o));
      S.synced = o;
    } catch (e) {
      reportError('sync.save', e);
    }
  }
  /** Parse S.lyricsText into a LyricTrack for the current song / preset / offset. */
  function buildTrack() {
    const text = S.lyricsText;
    if (!text || !text.trim()) return null;
    if (!MV.Lyrics || !MV.Lyrics.parse) {
      toast('歌词模块缺失，无法显示歌词 · MV.Lyrics missing', 'error', { key: 'no-lyrics-mod' });
      return null;
    }
    const f = currentFeatures();
    const preset = activePreset();
    const po = fin(f && f.presetOffset, 0);
    let track = null;
    try {
      const syn = S.synced && S.synced.key === textKey(text) ? S.synced : null;
      if (syn) {
        track = MV.Lyrics.parse(syn.lrc, { preset, features: f, offset: S.lyricOffset - fin(syn.baked, 0) + (po - fin(syn.presetOffset, 0)) });
        if (track && track.lines && track.lines.length) {
          track.synced = true;
          if (preset && preset.lines) track.matched = Object.assign({}, track.matched, { skipped: preset.lines.filter((l) => l.skip).length });
        } else track = null;
      }
      if (!track) {
        const mode = MV.Lyrics.detectMode ? MV.Lyrics.detectMode(text) : 'plain';
        const off = S.lyricOffset + (mode === 'plain' && preset ? po : 0);
        track = MV.Lyrics.parse(text, { preset, features: f, offset: off });
      }
      if (track && MV.Lyrics.assignStyles) MV.Lyrics.assignStyles(track, f);
    } catch (e) {
      reportError('Lyrics.parse', e);
      track = null;
    }
    return track;
  }
  /** Rebuild the track and hand it to the director. */
  function applyTrack(opts = {}) {
    S.track = buildTrack();
    if (S.director && S.director.setTrack) {
      try {
        S.director.setTrack(S.track);
      } catch (e) {
        reportError('Director.setTrack', e);
      }
    }
    if (!opts.keepFonts) refreshFonts();
    else if (S.stage) S.stage.invalidateLayouts();
    S.dirty = true;
    S.seekDirty = true;
    updateStatus();
  }
  function persistLyrics(text) {
    const p = activePreset();
    if (!text) {
      store.del(LYRICS_LAST);
      if (p) store.del(lyricsKey(p.id));
      store.del(syncedKey(p && p.id));
      return;
    }
    store.set(LYRICS_LAST, text);
    if (p) store.set(lyricsKey(p.id), text);
  }
  /**
   * Set the lyric text (paste / file / API). Returns the lyric status.
   * opts: { source: 'paste'|'file'|'url'|'assets'|'storage'|'api', persist: true }
   */
  function setLyricsText(text, opts = {}) {
    text = String(text == null ? '' : text).replace(/^﻿/, '');
    const changed = text !== S.lyricsText;
    S.lyricsText = text;
    S.lyricsSource = text ? opts.source || 'paste' : 'none';
    if (opts.persist !== false) persistLyrics(text);
    if (changed) {
      const p = activePreset();
      if (!text) store.del(syncedKey(p && p.id));
    }
    S.synced = loadSynced();
    applyTrack();
    if (D.lyricsText && document.activeElement !== D.lyricsText) D.lyricsText.value = text;
    if (S.sync && S.sync.isOpen && S.sync.reload) S.sync.reload();
    renderLyricsResult();
    return lyricsState();
  }
  function lyricsState() {
    const tr = S.track;
    const m = (tr && tr.matched) || {};
    return {
      matched: tr ? fin(m.matched, tr.lines.length) : 0,
      skipped: tr ? fin(m.skipped, 0) : 0,
      lines: tr && tr.lines ? tr.lines.length : 0,
      source: tr ? tr.source : 'none',
      synced: !!(tr && tr.synced),
      fallback: fin(m.fallback, 0),
      missing: fin(m.missing, 0),
      total: fin(m.total, 0),
      warnings: tr && tr.warnings ? tr.warnings.length : 0,
    };
  }
  function renderLyricsResult() {
    if (!D.lyricsResult) return;
    if (!S.lyricsText) {
      D.lyricsResult.textContent = '';
      D.lyricsResult.className = 'lyrics-result';
      D.lyricsWarn.innerHTML = '';
      return;
    }
    const ls = lyricsSummary();
    D.lyricsResult.textContent = ls.text;
    D.lyricsResult.className = 'lyrics-result ' + (ls.state === 'ok' ? 'is-ok' : 'is-warn');
    const w = (S.track && S.track.warnings) || [];
    D.lyricsWarn.innerHTML = w.slice(0, 6).map((x) => '<li>' + esc(x) + '</li>').join('') + (w.length > 6 ? '<li>… +' + (w.length - 6) + '</li>' : '');
  }
  function onOpenLyrics() {
    if (D.lyricsText && D.lyricsText.value !== S.lyricsText && !D.lyricsText._dirty) D.lyricsText.value = S.lyricsText;
    renderLyricsResult();
  }
  function applyLyricsFromPanel() {
    const txt = D.lyricsText.value;
    D.lyricsText._dirty = false;
    const st = setLyricsText(txt, { source: 'paste' });
    if (!txt.trim()) toast('歌词已清空 · Lyrics cleared', 'info');
    else if (st.lines) toast('<b>歌词已应用</b> · ' + esc(lyricsSummary().text), 'ok', { key: 'lyrics-ok' });
    else toast('没有可显示的歌词行 · No displayable lines', 'error', { key: 'lyrics-none' });
  }

  /** Decode a text file (UTF-8, UTF-16 BOM, GB18030, Shift_JIS fallbacks). */
  async function readTextFile(file) {
    const buf = await (file.arrayBuffer ? file.arrayBuffer() : new Response(file).arrayBuffer());
    return decodeText(buf);
  }
  function decodeText(buf) {
    const u8 = new Uint8Array(buf);
    if (typeof TextDecoder === 'undefined') return String.fromCharCode.apply(null, u8.slice(0, 65536));
    if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8);
    if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8);
    for (const enc of ['utf-8', 'gb18030', 'shift_jis']) {
      try {
        return new TextDecoder(enc, { fatal: true }).decode(u8);
      } catch (e) {
        /* try next */
      }
    }
    return new TextDecoder('utf-8').decode(u8);
  }

  /* ------------------------------------------------------------------ */
  /* Files: drag & drop, inputs                                          */
  /* ------------------------------------------------------------------ */
  const isAudioFile = (f) => (f.type && /^audio\//.test(f.type)) || AUDIO_RE.test(f.name || '') || (f.type === 'video/mp4' || f.type === 'video/webm');
  const isTextFile = (f) => (f.type && /^text\//.test(f.type)) || TEXT_RE.test(f.name || '');
  /** Handle dropped / picked files: audio → load, .txt/.lrc → lyrics. */
  async function handleFiles(list) {
    const files = Array.from(list || []);
    if (!files.length) return;
    let used = false;
    const text = files.find(isTextFile);
    const audio = files.find((f) => isAudioFile(f) && !isTextFile(f));
    if (text) {
      used = true;
      try {
        const txt = await readTextFile(text);
        const st = setLyricsText(txt, { source: 'file' });
        if (D.lyricsText) D.lyricsText.value = txt;
        toast('<b>歌词文件已载入</b> · ' + esc(text.name) + (st.lines ? '<br>' + esc(lyricsSummary().text) : ''), st.lines ? 'ok' : 'error', { key: 'lyrics-file' });
      } catch (e) {
        toast('<b>歌词文件读取失败</b><br>' + errMsg(e), 'error');
      }
    }
    if (audio) {
      used = true;
      await loadAudio({ file: audio });
    }
    if (!used) toast('不支持的文件类型 · Unsupported file: ' + esc(files[0].name || files[0].type || '?'), 'error', { key: 'bad-file' });
  }
  function bindDrop() {
    let depth = 0;
    const hasFiles = (e) => {
      const dt = e.dataTransfer;
      if (!dt) return false;
      if (dt.types && Array.from(dt.types).indexOf('Files') >= 0) return true;
      return !!(dt.files && dt.files.length);
    };
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      D.drop.hidden = false;
      document.body.classList.add('is-dragging');
    });
    window.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      try {
        e.dataTransfer.dropEffect = 'copy';
      } catch (err) {
        /* ignore */
      }
    });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) {
        D.drop.hidden = true;
        document.body.classList.remove('is-dragging');
      }
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return; // plain text drags (e.g. into the textarea) behave natively
      e.preventDefault();
      depth = 0;
      D.drop.hidden = true;
      document.body.classList.remove('is-dragging');
      handleFiles(e.dataTransfer.files);
    });
    D.fileAudio.addEventListener('change', () => {
      const f = D.fileAudio.files && D.fileAudio.files[0];
      if (f) handleFiles([f]);
    });
    D.fileLyrics.addEventListener('change', () => {
      const f = D.fileLyrics.files && D.fileLyrics.files[0];
      if (f) handleFiles([f]);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Auto-load                                                           */
  /* ------------------------------------------------------------------ */
  /** Names in assets/ (directory listing when the server provides one), or null. */
  async function assetListing() {
    if (S.assetList !== undefined) return S.assetList;
    S.assetList = null;
    if (!isHttp || !ASSETS) return null;
    try {
      const r = await fetch('assets/', { cache: 'no-store' });
      if (r.ok && /html/i.test(r.headers.get('content-type') || '')) {
        const html = await r.text();
        const names = [];
        const re = /href\s*=\s*["']([^"'?#]+)["']/gi;
        let m;
        while ((m = re.exec(html))) {
          try {
            names.push(decodeURIComponent(m[1]).replace(/\/$/, '').split('/').pop());
          } catch (e) {
            /* ignore */
          }
        }
        // Only trust real directory listings (assets/README.md is always there).
        if (names.indexOf('README.md') >= 0) S.assetList = names;
      }
    } catch (e) {
      S.assetList = null;
    }
    return S.assetList;
  }
  /** First existing candidate in assets/ (listing first, HEAD probes otherwise). */
  async function findAsset(cands) {
    if (!isHttp || !ASSETS) return null;
    const list = await assetListing();
    if (list) {
      for (const c of cands) if (list.indexOf(c) >= 0) return 'assets/' + c;
      return null;
    }
    for (const c of cands) {
      try {
        const r = await fetch('assets/' + c, { method: 'HEAD', cache: 'no-store' });
        if (r.ok) return 'assets/' + c;
      } catch (e) {
        /* next */
      }
    }
    return null;
  }
  async function fetchText(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return decodeText(await r.arrayBuffer());
  }
  async function autoLoadLyrics() {
    const q = qget('lyrics');
    if (q != null && q !== '') {
      if (/^(0|none|off)$/i.test(q)) return;
      const looksUrl = /^(https?:|blob:|data:|\.{0,2}\/)/i.test(q) || /\.(txt|lrc)([?#].*)?$/i.test(q);
      if (looksUrl) {
        try {
          setLyricsText(await fetchText(q), { source: 'url', persist: false });
          return;
        } catch (e) {
          toast('<b>歌词 URL 载入失败</b><br>' + errMsg(e), 'error');
        }
      } else {
        setLyricsText(q, { source: 'url', persist: false });
        return;
      }
    }
    const url = await findAsset(LYRIC_CANDS);
    if (url) {
      try {
        setLyricsText(await fetchText(url), { source: 'assets', persist: false });
        return;
      } catch (e) {
        /* fall through to storage */
      }
    }
    const p = activePreset();
    const txt = (p && store.get(lyricsKey(p.id))) || store.get(LYRICS_LAST);
    if (txt) setLyricsText(txt, { source: 'storage', persist: false });
  }
  async function autoLoadAudio() {
    if (!S.engine) return false;
    const q = qget('audio');
    if (q != null && q !== '') {
      if (/^(0|none|off)$/i.test(q)) return false;
      return loadAudio({ url: q }, { quiet: false });
    }
    const url = await findAsset(AUDIO_CANDS);
    if (url) {
      const ok = await loadAudio({ url }, { quiet: true });
      if (ok) {
        toast('<b>已自动载入</b> · ' + esc(url), 'ok', { key: 'audio-ok' });
        return true;
      }
    }
    if (!AUTOLOAD || !MV.AudioEngine.cacheLoad) return false;
    let cached = null;
    try {
      cached = await MV.AudioEngine.cacheLoad();
    } catch (e) {
      cached = null;
    }
    if (cached && cached.arrayBuffer) {
      const ok = await loadAudio({ arrayBuffer: cached.arrayBuffer, name: cached.name }, { quiet: true, cache: false });
      if (ok) toast('<b>已从本地缓存载入</b> · ' + esc(cached.name), 'ok', { key: 'audio-ok' });
      return ok;
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Sync editor                                                         */
  /* ------------------------------------------------------------------ */
  function openSync() {
    if (!MV.SyncEditor) {
      toast('对轴模块缺失 · MV.SyncEditor missing', 'error', { key: 'no-sync' });
      return;
    }
    if (!S.audio) {
      toast('请先载入音频再对轴 · Load audio first', 'info', { key: 'need-audio' });
      return;
    }
    if (!S.lyricsText) {
      toast('请先粘贴歌词再对轴 · Paste lyrics first', 'info', { key: 'need-lyrics' });
      openPanel('lyrics');
      return;
    }
    if (S.menuOpen) closeMenu();
    if (S.panel) closePanel();
    if (S.uiHidden) setUIHidden(false);
    try {
      if (!S.sync) {
        S.sync = new MV.SyncEditor({
          engine: S.engine,
          preset: S.preset,
          getTrack: () => S.track,
          getText: () => S.lyricsText,
          onPreview: (tr) => {
            if (S.director && tr) {
              S.director.setTrack(tr);
              S.dirty = true;
              S.seekDirty = true;
            }
          },
          onApply: (tr) => {
            S.lyricOffset = loadOffset(S.preset);
            if (tr) {
              saveSynced(tr);
              S.track = buildTrack() || tr;
              if (S.director) S.director.setTrack(S.track);
            }
            syncSettingsUI();
            updateStatus();
            S.dirty = true;
            S.seekDirty = true;
          },
          onClose: () => {
            if (S.director && S.director.track !== S.track) S.director.setTrack(S.track);
            S.dirty = true;
            S.seekDirty = true;
            wake();
            poke();
          },
        });
      } else if (S.sync.setPreset) S.sync.setPreset(S.preset);
      S.sync.open();
      wake();
    } catch (e) {
      reportError('SyncEditor', e);
    }
  }
  function toggleSync() {
    if (S.sync && S.sync.isOpen) S.sync.close();
    else openSync();
  }

  /* ------------------------------------------------------------------ */
  /* Export                                                              */
  /* ------------------------------------------------------------------ */
  function exportRange() {
    const o = S.exportOpts;
    const dur = duration();
    if (o.range === 'section') {
      const sec = sectionAt(currentT());
      if (sec) return [sec.start, Math.min(dur, sec.end)];
    }
    if (o.range === 'custom') {
      const a = clamp(fin(o.from, 0), 0, dur);
      const b = clamp(fin(o.to, dur), 0, dur);
      return b > a ? [a, b] : [a, Math.min(dur, a + 1)];
    }
    return [0, dur];
  }
  function exportDims() {
    return S.exportOpts.res === '720' ? [1280, 720] : [1920, 1080];
  }
  function updateExportSummary() {
    if (!D.exSummary) return;
    const [a, b] = exportRange();
    const [w, h] = exportDims();
    const fps = +S.exportOpts.fps;
    const len = Math.max(0, b - a);
    const frames = Math.round(len * fps);
    const br = MV.Exporter && MV.Exporter.defaultBitrate ? MV.Exporter.defaultBitrate(w, h, fps) : 8e6;
    const bytes = (len * (br + 192000)) / 8;
    D.exSummary.innerHTML = '范围 <b>' + fmtClock(a, true) + '</b> → <b>' + fmtClock(b, true) + '</b> · <b>' + len.toFixed(1) + '</b> s · <b>' + frames + '</b> 帧 · ' +
      w + '×' + h + ' · 预计约 <b>' + fmtMB(bytes) + '</b>' + (S.audio ? '' : '<br>未载入音频：将导出无声视频 · no audio loaded');
  }
  function syncExportUI() {
    const o = S.exportOpts;
    setSeg(D.exRes, o.res);
    setSeg(D.exFps, o.fps);
    setSeg(D.exRange, o.range);
    D.exCustom.hidden = o.range !== 'custom';
    updateExportSummary();
    const busy = !!S.exporter;
    D.btnExportStart.disabled = busy || !MV.Exporter;
    D.btnExportCancel.disabled = !busy;
    D.panelExport.classList.toggle('is-busy', busy);
  }
  function onOpenExport() {
    if (S.exportOpts.range === 'custom' && !D.exFrom._touched) {
      const t = Math.floor(currentT());
      S.exportOpts.from = t;
      S.exportOpts.to = Math.min(duration(), t + 10);
      D.exFrom.value = fmtClock(S.exportOpts.from, true);
      D.exTo.value = fmtClock(S.exportOpts.to, true);
    }
    syncExportUI();
    if (!MV.Exporter) {
      D.exCaps.innerHTML = '<span class="cap">导出模块缺失 · MV.Exporter missing</span>';
      return;
    }
    probeCaps();
  }
  function probeCaps() {
    if (!MV.Exporter || !MV.Exporter.capabilities) return Promise.resolve(null);
    return MV.Exporter.capabilities()
      .then((caps) => {
        S.caps = caps;
        const chip = (on, label) => '<span class="cap' + (on ? ' is-on' : '') + '">' + label + '</span>';
        const path = caps.preferred && caps.preferred !== 'none'
          ? (caps.preferred.indexOf('webcodecs') === 0 ? '将使用 WebCodecs 离线逐帧渲染（不丢帧，比实时更快或更慢取决于机器）' : '将使用实时录制 (MediaRecorder)，导出期间请保持此页可见')
          : '此浏览器无法导出视频';
        D.exCaps.innerHTML = chip(caps.webcodecs, 'WebCodecs') + chip(caps.h264, 'H.264') + chip(caps.vp9, 'VP9') + chip(caps.aac, 'AAC') +
          chip(caps.opus, 'Opus') + chip(caps.mediaRecorder, 'MediaRecorder') +
          '<span class="cap-path">' + esc(path) + (caps.preferred ? ' · <code>' + esc(caps.preferred) + '</code>' : '') + '</span>';
        return caps;
      })
      .catch((e) => {
        D.exCaps.innerHTML = '<span class="cap">检测失败 · ' + errMsg(e) + '</span>';
        return null;
      });
  }
  function exportTitle() {
    const p = activePreset();
    const m = (p && p.meta) || {};
    return m.titleLatin || m.title || (S.audio && S.audio.name ? S.audio.name.replace(/\.[^.]+$/, '') : 'mv');
  }
  /**
   * Run an export. opts: { width, height, resolution: 1080|720, fps, range:[t0,t1], method, videoCodec, audioCodec }.
   * Resolves with the MV.Exporter result (blob, filename, mime, codec, container, …).
   */
  async function exportVideo(opts = {}) {
    if (!MV.Exporter) throw new Error('MV.Exporter 缺失 (export module missing)');
    if (S.exporter) throw new Error('已有导出任务在进行 (an export is already running)');
    let w = fin(opts.width, 0), h = fin(opts.height, 0);
    if (!w || !h) [w, h] = String(opts.resolution || S.exportOpts.res) === '720' ? [1280, 720] : [1920, 1080];
    const fps = fin(+opts.fps, +S.exportOpts.fps) || 30;
    const range = Array.isArray(opts.range) ? opts.range.slice(0, 2) : exportRange();
    if (S.engine && S.engine.playing) pause();
    const dcfg = {
      features: currentFeatures(),
      track: S.track,
      preset: S.mode === 'song' ? S.preset : S.basePreset,
      options: Object.assign(dirOptions(), { fps }),
    };
    let dir, ex;
    try {
      dir = MV.Director ? new MV.Director(dcfg) : new FallbackDirector(dcfg);
      ex = new MV.Exporter(Object.assign({}, opts.extra || {}, {
        director: dir,
        audioBuffer: S.mode === 'song' && S.engine ? S.engine.buffer : null,
        width: w, height: h, fps, range,
        title: opts.title || exportTitle(),
        method: opts.method || 'auto',
        videoCodec: opts.videoCodec || 'auto',
        audioCodec: opts.audioCodec || (S.mode === 'song' ? 'auto' : 'none'),
        onProgress: (p, info) => {
          showExportProgress(p, info);
          if (typeof opts.onProgress === 'function') {
            try {
              opts.onProgress(p, info);
            } catch (e) {
              /* ignore */
            }
          }
        },
      }));
    } catch (e) {
      showExportError(e);
      throw e;
    }
    S.exporter = ex;
    S.exportStarted = wallNow();
    D.exResult.hidden = true;
    D.exProgress.hidden = false;
    showExportProgress(0, { phase: 'prepare' });
    syncExportUI();
    try {
      const res = await ex.run();
      showExportResult(res);
      return res;
    } catch (e) {
      showExportError(e);
      throw e;
    } finally {
      S.exporter = null;
      syncExportUI();
      S.dirty = true;
    }
  }
  function showExportProgress(p, info) {
    if (!D.exBarFill) return;
    info = info || {};
    const pct = Math.round(clamp(fin(p, 0)) * 100);
    D.exBarFill.style.width = 'calc(' + pct + '% - ' + (pct ? 6 : 0) + 'px)';
    D.exPct.textContent = pct + '%';
    const phase = {
      prepare: '准备中', render: '渲染中', encode: '编码中', audio: '编码音频', mux: '封装中', finalize: '封装中', record: '实时录制中',
    }[info.phase] || info.phase || '进行中';
    let s = phase;
    if (info.frames) s += ' · ' + (info.frame || 0) + ' / ' + info.frames + ' 帧';
    if (info.fpsRendered) s += ' · ' + info.fpsRendered.toFixed(1) + ' fps';
    if (info.etaSeconds != null && isFinite(info.etaSeconds)) s += ' · 剩余 ' + fmtClock(info.etaSeconds);
    D.exInfo.textContent = s;
  }
  function showExportResult(res) {
    S.exportResult = res;
    if (S.exportURL) {
      try {
        URL.revokeObjectURL(S.exportURL);
      } catch (e) {
        /* ignore */
      }
    }
    S.exportURL = URL.createObjectURL(res.blob);
    D.exProgress.hidden = true;
    D.exResult.hidden = false;
    D.exResult.classList.remove('is-error');
    const webm = res.container === 'webm' || /webm/i.test(res.mime || '');
    const warn = (res.warnings || []).slice(0, 4);
    D.exResult.innerHTML =
      '<a class="btn btn-red" id="exDownload" href="' + S.exportURL + '" download="' + esc(res.filename) + '">下载 <span>DOWNLOAD</span></a>' +
      '<p><b>' + esc(res.filename) + '</b> · ' + fmtMB(res.bytes || res.blob.size) + ' · ' + esc(res.codec || res.mime || '') +
      (res.elapsed ? ' · 用时 ' + fmtClock(res.elapsed) : '') + '</p>' +
      (webm ? '<p class="ex-note">此浏览器无法编码 MP4，已改为导出 WebM（可用 VLC / Chrome 播放，或再转码为 MP4）。Fell back to WebM.</p>' : '') +
      warn.map((w) => '<p class="ex-note">' + esc(w) + '</p>').join('');
    toast('<b>导出完成</b> · ' + esc(res.filename), 'ok', { key: 'export-done' });
  }
  function showExportError(e) {
    D.exProgress.hidden = true;
    D.exResult.hidden = false;
    const aborted = e && e.name === 'AbortError';
    D.exResult.classList.toggle('is-error', !aborted);
    D.exResult.innerHTML = aborted ? '<p>导出已取消 · Export cancelled</p>' : '<p><b>导出失败</b> · ' + errMsg(e) + '</p>';
    if (!aborted) toast('<b>导出失败</b><br>' + errMsg(e), 'error', { key: 'export-fail' });
  }

  /* ------------------------------------------------------------------ */
  /* Settings UI                                                         */
  /* ------------------------------------------------------------------ */
  function setSeg(el, v) {
    if (!el) return;
    el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', b.dataset.v === String(v) ? 'true' : 'false'));
  }
  function syncSettingsUI() {
    if (!D.setHud) return;
    D.setHud.checked = !!setting('hud');
    D.setCredits.checked = !!setting('credits');
    D.setDebug.checked = !!setting('debug');
    setSeg(D.setQuality, setting('quality'));
    if (document.activeElement !== D.setOffset) D.setOffset.value = String(S.lyricOffset);
    D.offsetOut.textContent = fmtOffset(S.lyricOffset);
    if (document.activeElement !== D.setVolume) D.setVolume.value = String(setting('volume'));
  }

  /* ------------------------------------------------------------------ */
  /* Keyboard                                                            */
  /* ------------------------------------------------------------------ */
  function isTyping(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toUpperCase();
    const type = String(el.type || '').toLowerCase();
    return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable || (tag === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'file'].includes(type));
  }
  function onKey(e) {
    if (e.defaultPrevented) return;
    const tg = e.target;
    if (isTyping(tg)) {
      if (e.key === 'Escape') tg.blur();
      else if (tg === D.lyricsText && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        applyLyricsFromPanel();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key || '';
    const code = e.code || '';
    const onButton = tg && tg.tagName && /^(BUTTON|A|SUMMARY)$/i.test(tg.tagName);
    let handled = true;
    if (code === 'Space' || key === ' ' || key === 'Spacebar') {
      if (onButton) return; // native activation
      if (!e.repeat) togglePlay();
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (tg && tg.type === 'range') return;
      seekBy(key === 'ArrowLeft' ? -5 : 5);
    } else if ((key === 'ArrowUp' || key === 'ArrowDown') && S.menuOpen) {
      const items = Array.from(D.menuList.querySelectorAll('.mi'));
      let i = items.indexOf(document.activeElement);
      i = i < 0 ? 0 : (i + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[i].focus();
    } else if (key === 'Home' && tg === D.seek) seek(0);
    else if (key === 'End' && tg === D.seek) seek(duration() - 0.05);
    else if (code === 'KeyF' || key === 'f' || key === 'F') toggleFullscreen();
    else if (code === 'KeyH' || key === 'h' || key === 'H') {
      setUIHidden(!S.uiHidden);
      osd(S.uiHidden ? '界面已隐藏' : '界面已显示', 'H');
    } else if (code === 'KeyM' || key === 'm' || key === 'M') toggleMenu();
    else if (code === 'KeyL' || key === 'l' || key === 'L') togglePanel('lyrics');
    else if (code === 'KeyS' || key === 's' || key === 'S') toggleSync();
    else if (code === 'KeyE' || key === 'e' || key === 'E') togglePanel('export');
    else if (code === 'KeyO' || key === 'o' || key === 'O') pickAudio();
    else if (key === ',' || code === 'Comma') togglePanel('settings');
    else if (key === '[' || code === 'BracketLeft') setLyricOffset(S.lyricOffset - 0.05, { osd: true });
    else if (key === ']' || code === 'BracketRight') setLyricOffset(S.lyricOffset + 0.05, { osd: true });
    else if (code === 'KeyD' || key === 'd' || key === 'D') {
      setSetting('debug', !setting('debug'));
      osd('调试 DEBUG', setting('debug') ? 'ON' : 'OFF');
    } else if (key === 'Escape') {
      if (S.panel) closePanel();
      else if (S.uiHidden) setUIHidden(false);
      else if (S.menuOpen && S.audio) closeMenu();
      else if (!S.menuOpen) openMenu(true);
    } else handled = false;
    if (handled) {
      e.preventDefault();
      poke();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Bindings                                                            */
  /* ------------------------------------------------------------------ */
  function doAction(act) {
    switch (act) {
      case 'play':
        if (!S.audio) {
          pickAudio();
          return;
        }
        closeMenu();
        if (!(S.engine && S.engine.playing)) play();
        return;
      case 'audio':
        pickAudio();
        return;
      case 'lyrics':
        togglePanel('lyrics');
        return;
      case 'sync':
        toggleSync();
        return;
      case 'export':
        togglePanel('export');
        return;
      case 'settings':
        togglePanel('settings');
        return;
      case 'fullscreen':
        toggleFullscreen();
        return;
      case 'menu':
        toggleMenu();
        return;
      default:
    }
  }
  function bindUI() {
    // Star cursors on menu items.
    D.menuList.querySelectorAll('.mi').forEach((b) => {
      const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      s.setAttribute('class', 'mi-star');
      s.setAttribute('aria-hidden', 'true');
      const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      u.setAttribute('href', '#i-star');
      s.appendChild(u);
      b.insertBefore(s, b.firstChild);
    });
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (a) {
        e.preventDefault();
        doAction(a.dataset.act);
        return;
      }
      const c = e.target && e.target.closest ? e.target.closest('[data-close]') : null;
      if (c) closePanel();
    });
    D.btnPlay.addEventListener('click', () => togglePlay());
    D.bigPlay.addEventListener('click', () => {
      D.bigPlay.hidden = true;
      const go = () => play();
      if (S.engine && S.engine.unlock) S.engine.unlock().then(go, go);
      else go();
    });
    D.bannerClose.addEventListener('click', () => {
      S.bannerDismissed = true;
      updateBanner();
    });

    // Stage: click toggles playback (mouse), tap wakes the UI (touch), double click → fullscreen.
    D.stageWrap.addEventListener('pointerup', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (e.pointerType !== 'mouse' && S.idle) {
        poke();
        return;
      }
      if (S.mode === 'song' && S.audio) togglePlay();
      else if (!S.menuOpen) openMenu(false);
    });
    D.stageWrap.addEventListener('dblclick', (e) => {
      e.preventDefault();
      toggleFullscreen();
    });

    // Lyrics panel.
    D.btnLyricsApply.addEventListener('click', applyLyricsFromPanel);
    D.btnLyricsFile.addEventListener('click', () => {
      D.fileLyrics.value = '';
      D.fileLyrics.click();
    });
    D.btnLyricsClear.addEventListener('click', () => {
      D.lyricsText.value = '';
      D.lyricsText._dirty = false;
      setLyricsText('', { source: 'paste' });
      toast('歌词已清空 · Lyrics cleared', 'info', { key: 'lyrics-cleared' });
      D.lyricsText.focus();
    });
    D.lyricsText.addEventListener('input', () => (D.lyricsText._dirty = true));

    // Settings.
    D.setHud.addEventListener('change', () => setSetting('hud', D.setHud.checked));
    D.setCredits.addEventListener('change', () => setSetting('credits', D.setCredits.checked));
    D.setDebug.addEventListener('change', () => setSetting('debug', D.setDebug.checked));
    D.setQuality.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (b) setSetting('quality', b.dataset.v);
    });
    D.setOffset.addEventListener('input', () => setLyricOffset(parseFloat(D.setOffset.value)));
    D.offMinus.addEventListener('click', () => setLyricOffset(S.lyricOffset - 0.05));
    D.offPlus.addEventListener('click', () => setLyricOffset(S.lyricOffset + 0.05));
    D.offReset.addEventListener('click', () => setLyricOffset(0));
    D.setVolume.addEventListener('input', () => setSetting('volume', clamp(parseFloat(D.setVolume.value))));
    D.btnClearCache.addEventListener('click', async () => {
      let ok = false;
      try {
        ok = MV.AudioEngine && MV.AudioEngine.cacheClear ? await MV.AudioEngine.cacheClear() : false;
      } catch (e) {
        ok = false;
      }
      store.keys().filter((k) => k && (k.indexOf('mv.lyrics.') === 0 || k.indexOf('mv.synced.') === 0)).forEach((k) => store.del(k));
      toast('已清除本地缓存的音频与歌词' + (ok ? '' : '（音频缓存不可用）') + ' · Cache cleared', 'ok', { key: 'cache' });
    });

    // Export.
    const segPick = (el, k) =>
      el.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-v]');
        if (!b || S.exporter) return;
        S.exportOpts[k] = b.dataset.v;
        if (k === 'range' && b.dataset.v === 'custom') {
          D.exFrom.value = fmtClock(S.exportOpts.from, true);
          D.exTo.value = fmtClock(S.exportOpts.to, true);
        }
        syncExportUI();
      });
    segPick(D.exRes, 'res');
    segPick(D.exFps, 'fps');
    segPick(D.exRange, 'range');
    const rangeInput = (el, k) =>
      el.addEventListener('input', () => {
        el._touched = true;
        const v = parseClock(el.value);
        el.classList.toggle('is-bad', !isFinite(v));
        if (isFinite(v)) {
          S.exportOpts[k] = v;
          updateExportSummary();
        }
      });
    rangeInput(D.exFrom, 'from');
    rangeInput(D.exTo, 'to');
    D.btnExportStart.addEventListener('click', () => {
      exportVideo({}).catch(() => {});
    });
    D.btnExportCancel.addEventListener('click', () => {
      if (S.exporter) S.exporter.cancel();
    });

    // Seek bar.
    D.seek.addEventListener('pointerdown', (e) => {
      if (!canSeek() || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      try {
        D.seek.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
      const wasPlaying = S.engine.playing;
      if (wasPlaying) S.engine.pause();
      S.scrub = { wasPlaying };
      S.hasPlayed = true;
      const t = seekFromEvent(e);
      S.engine.seek(t);
      S.t = t;
      S.dirty = true;
      S.seekDirty = true;
      wake();
    });
    D.seek.addEventListener('pointermove', (e) => {
      const r = D.seek.getBoundingClientRect();
      S.hoverX = clamp(e.clientX - r.left, 0, r.width);
      const t = seekFromEvent(e);
      if (S.scrub) {
        S.engine.seek(t);
        S.t = t;
        S.dirty = true;
      }
      const sec = sectionAt(t);
      D.seekTip.hidden = !canSeek();
      D.seekTip.style.left = S.hoverX + 'px';
      D.seekTip.innerHTML = fmtClock(t, true) + (sec ? '<small>' + esc(sec.name || '') + ' ' + esc(KIND_ZH[sec.kind] || '') + '</small>' : '');
      S.seekDirty = true;
    });
    const endScrub = () => {
      if (!S.scrub) return;
      const sc = S.scrub;
      S.scrub = null;
      if (sc.wasPlaying) play();
      S.dirty = true;
      S.seekDirty = true;
      updateStatus();
    };
    D.seek.addEventListener('pointerup', endScrub);
    D.seek.addEventListener('pointercancel', endScrub);
    D.seek.addEventListener('pointerleave', () => {
      S.hoverX = -1;
      D.seekTip.hidden = true;
      S.seekDirty = true;
    });
    D.bar.addEventListener('pointerenter', () => {
      S.overBar = true;
      wake();
    });
    D.bar.addEventListener('pointerleave', () => {
      S.overBar = false;
      poke();
    });

    // Global.
    window.addEventListener('keydown', onKey);
    ['pointermove', 'pointerdown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, poke, { passive: true }));
    let rz = 0;
    const onResize = () => {
      clearTimeout(rz);
      rz = setTimeout(() => {
        sizeSeek();
        if (setting('quality') === 'auto') applyQuality();
        S.dirty = true;
      }, 120);
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onResize);
    document.addEventListener('webkitfullscreenchange', onResize);
    document.addEventListener('visibilitychange', () => {
      S.dirty = true;
    });
    if (typeof ResizeObserver === 'function') {
      try {
        new ResizeObserver(() => sizeSeek()).observe(D.seek);
      } catch (e) {
        /* ignore */
      }
    }
    window.addEventListener('error', (e) => {
      if (!e || !e.message) return;
      reportError('脚本错误 script', { message: e.message + (e.filename ? ' @ ' + String(e.filename).split('/').pop() + ':' + e.lineno : '') });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const r = e && e.reason;
      if (r && r.name === 'AbortError') return;
      reportError('未处理的异常 promise', r);
    });
  }

  function bindEngine() {
    if (!S.engine) return;
    S.engine.on('play', () => {
      S.hasPlayed = true;
      updatePlayButton();
      updateStatus();
      poke();
    });
    S.engine.on('pause', () => {
      S.dirty = true;
      updatePlayButton();
      updateStatus();
      wake();
    });
    S.engine.on('seek', () => {
      S.dirty = true;
      S.seekDirty = true;
    });
    S.engine.on('ended', () => {
      S.dirty = true;
      updatePlayButton();
      updateStatus();
      wake();
      // Back to the menu after the end card had a moment on screen.
      if (!TEST) {
        clearTimeout(S.endTimer);
        S.endTimer = setTimeout(() => {
          if (S.engine && !S.engine.playing && !S.menuOpen && !S.panel && !(S.sync && S.sync.isOpen) && !S.exporter) openMenu(false);
        }, 1800);
      }
    });
    S.engine.on('blocked', () => {
      if (D.bigPlay && S.engine.playing) D.bigPlay.hidden = false;
    });
    S.engine.on('statechange', (e) => {
      if (e && e.state === 'running' && D.bigPlay) D.bigPlay.hidden = true;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Decoration (halftones, meta)                                        */
  /* ------------------------------------------------------------------ */
  function decorate() {
    const p = S.basePreset;
    const m = (p && p.meta) || {};
    if (m.title && D.menuTitle) D.menuTitle.textContent = m.title;
    if (D.menuLatin) D.menuLatin.innerHTML = esc(String(m.titleLatin || 'MUSIC VIDEO').toUpperCase()) + '<span class="ransom" aria-hidden="true"><b>M</b><b>V</b></span>';
    if (D.menuCredit) {
      const parts = [];
      if (m.artist) parts.push('歌 ' + m.artist);
      if (m.lyricist) parts.push('作詞 ' + m.lyricist);
      if (m.composer) parts.push('作曲 ' + m.composer);
      D.menuCredit.textContent = parts.join(' · ');
    }
    // Halftone-dot gradients (dot size encodes tone) for the menu slab and the drop overlay.
    if (MV.makeCanvas && MV.draw && MV.draw.halftone) {
      try {
        const a = MV.makeCanvas(400, 640);
        MV.draw.halftone(a.ctx, 0, 0, 400, 640, {
          cell: 12, angle: -0.21, color: 'rgba(0,0,0,0.85)',
          fn: (u, v) => clamp(Math.pow(clamp(v * 1.15 - 0.2 + u * 0.15), 1.4)),
        });
        document.documentElement.style.setProperty('--ht', 'url(' + a.canvas.toDataURL('image/png') + ')');
        document.documentElement.style.setProperty('--ht-size', 'cover');
        const b = MV.makeCanvas(480, 480);
        MV.draw.halftone(b.ctx, 0, 0, 480, 480, {
          cell: 16, angle: 0.6, color: 'rgba(0,0,0,0.6)',
          fn: (u, v) => clamp(Math.hypot(u - 0.5, v - 0.5) * 1.6),
        });
        document.documentElement.style.setProperty('--ht2', 'url(' + b.canvas.toDataURL('image/png') + ')');
        document.documentElement.style.setProperty('--ht2-size', 'cover');
      } catch (e) {
        /* CSS fallback dots */
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Init                                                                */
  /* ------------------------------------------------------------------ */
  async function init() {
    if (S.booted) return;
    grabDom();
    if (!D.stage) return;
    if (TEST) document.body.classList.add('is-test');
    loadSettings();
    checkModules();
    S.basePreset = (MV.presets && MV.presets[0]) || null;
    decorate();
    bindUI();
    bindDrop();

    // Engine.
    if (MV.AudioEngine) {
      try {
        S.engine = new MV.AudioEngine({ volume: clamp(+setting('volume')) });
        bindEngine();
      } catch (e) {
        reportError('AudioEngine', e);
        S.engine = null;
      }
    }
    // Stage.
    if (MV.Stage) {
      try {
        S.stage = new MV.Stage({ canvas: D.stage, scale: setting('quality') === 'auto' ? autoScale() : clamp(parseFloat(setting('quality')) || 1, 0.25, 1), adaptive: setting('quality') === 'auto' });
      } catch (e) {
        reportError('Stage', e);
        S.stage = null;
      }
    }
    applyDebug();

    // Attract reel: preset timeline, synthetic envelopes, no audio.
    S.mode = 'attract';
    S.attractFeatures = S.basePreset ? syntheticFeatures(S.basePreset) : null;
    S.lyricOffset = loadOffset(S.basePreset);
    buildDirector();

    D.bar.hidden = false;
    sizeSeek();
    syncSettingsUI();
    const startT = parseFloat(qget('t'));
    const hasT = isFinite(startT);
    const autoplay = qget('autoplay') === '1';
    if (!hasT && !autoplay) openMenu(false);
    document.body.classList.remove('is-booting');
    S.booted = true;
    updateStatus();
    updatePlayButton();
    requestAnimationFrame(loop);

    setBusy('准备画面', 'PREPARING', null, false);
    await prepareStage();
    if (!S.loading) hideBusy();
    if (TEST) {
      S.t = TEST_ATTRACT_T;
      S.dirty = true;
    }
    try {
      await autoLoadLyrics();
    } catch (e) {
      reportError('lyrics autoload', e);
    }
    try {
      await autoLoadAudio();
    } catch (e) {
      reportError('audio autoload', e);
    }
    if (hasT) {
      S.frozen = true;
      if (S.menuOpen) closeMenu();
      seek(startT);
      await refreshFonts();
      renderNow(S.t);
    }
    if (autoplay && S.audio) {
      closeMenu();
      play();
    }
    updateStatus();
    resolveReady(getState());
  }

  /* ------------------------------------------------------------------ */
  /* Public / test API                                                   */
  /* ------------------------------------------------------------------ */
  function getState() {
    const f = S.features;
    const st = S.stage ? S.stage.stats : null;
    const sec = sectionAt(S.t);
    return {
      ready: S.booted,
      mode: S.mode,
      audio: S.audio ? { name: S.audio.name, duration: S.audio.duration, source: S.audio.source } : null,
      preset: S.mode === 'song' ? (S.preset ? S.preset.id : null) : null,
      offset: S.mode === 'song' && f ? fin(f.presetOffset, 0) : 0,
      confidence: S.mode === 'song' && f ? fin(f.presetConfidence, 0) : 0,
      analysis: f ? f.source : null,
      lyricOffset: S.lyricOffset,
      lyrics: lyricsState(),
      t: S.mode === 'song' && S.engine && S.engine.buffer && !attractActive() ? S.engine.currentTime : S.t,
      playing: !!(S.engine && S.engine.playing),
      fps: st ? Math.round((st.fps || 0) * 10) / 10 : 0,
      frameMs: st ? Math.round((st.avgMs || 0) * 10) / 10 : 0,
      scale: S.stage ? S.stage.scale : null,
      post: st ? st.post : null,
      section: sec ? sec.name : null,
      menu: S.menuOpen,
      panel: S.panel,
      sync: !!(S.sync && S.sync.isOpen),
      uiHidden: S.uiHidden,
      idle: S.idle,
      settings: { hud: !!setting('hud'), credits: !!setting('credits'), quality: setting('quality'), debug: !!setting('debug'), volume: setting('volume') },
      exporting: !!S.exporter,
      missing: S.missing.slice(),
      stageErrors: S.stage && S.stage.errors ? Array.from(S.stage.errors.keys()) : [],
    };
  }
  async function apiRenderAt(t) {
    await ready;
    S.frozen = true;
    if (S.engine && S.engine.playing) S.engine.pause();
    t = clamp(fin(+t, 0), 0, duration());
    if (S.mode === 'song' && S.engine && S.engine.buffer) {
      S.hasPlayed = true;
      S.engine.seek(t);
    }
    if (S.fontsPromise) await S.fontsPromise;
    await refreshFonts();
    const r = renderNow(t);
    S.seekDirty = true;
    uiTick(wallNow() + 1000);
    await nextFrame();
    await nextFrame();
    return { t, ms: r ? r.ms : 0 };
  }

  MV.app = {
    _booted: true,
    ready,
    /** Load audio from a URL (relative to the page). Resolves with getState(). */
    async loadAudioURL(url) {
      await ready;
      await loadAudio({ url: String(url) });
      return getState();
    },
    /** Load audio from a File / Blob. */
    async loadAudioFile(file) {
      await ready;
      await loadAudio({ file });
      return getState();
    },
    /** Set lyric text (not persisted when called through the API unless opts.persist). */
    setLyricsText(text, opts) {
      return setLyricsText(text, Object.assign({ source: 'api', persist: false }, opts || {}));
    },
    renderAt: apiRenderAt,
    play() {
      S.frozen = false;
      return play();
    },
    pause,
    seek(t) {
      return seek(t);
    },
    getState,
    exportVideo,
    openMenu: () => openMenu(false),
    closeMenu,
    openPanel,
    closePanel,
    openSync,
    setSetting,
    setLyricOffset: (v) => setLyricOffset(v),
    handleFiles,
    get director() {
      return S.director;
    },
    get stage() {
      return S.stage;
    },
    get engine() {
      return S.engine;
    },
    get track() {
      return S.track;
    },
    get features() {
      return S.features;
    },
    _state: S,
    _util: { parseClock, fmtClock, decodeText, syntheticFeatures },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

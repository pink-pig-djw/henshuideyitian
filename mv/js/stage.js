/*
 * MV.Stage — owns the render buffers and composites one frame
 * (docs/ARCHITECTURE.md §3.9).
 *
 *   const stage = new MV.Stage({ canvas, scale: 1, adaptive: false, debug: false });
 *   stage.setDirector(dir);
 *   await stage.prepare();               // scene.prepare(stage) once each + web fonts
 *   stage.renderFrame(t) → { ms, evalMs, state }
 *   stage.resize(scale); stage.invalidateLayouts(); stage.setDebug(on); stage.dispose();
 *
 * Frame order: scene(s) with the camera (+ overscan) → transition composite →
 * 'under' effects → lyrics (camera × 0.35 parallax) → 'over' effects → HUD →
 * [debug overlay] → MV.Post into the visible canvas (plain drawImage when
 * MV.Post is missing).
 *
 * Buffers (backing size = 1920×1080 × scale; everything draws in logical
 * MV.W × MV.H space through a base transform): sceneA, sceneB (transition
 * sources) and comp (the composite handed to MV.Post). Without a transition
 * the scene paints straight into comp.
 *
 * Every external draw (scene / transition / effect / lyric style / HUD / post)
 * is isolated: try/catch, state reset before each call, one console warning
 * per (kind, name), and a fallback drawing so a broken module never kills the
 * frame. Rendering output is a pure function of t (Director.evaluate) —
 * performance.now is only used to *measure* frame times (stats, debug overlay
 * and the optional adaptive scale of the live preview).
 */
(function () {
  'use strict';

  const MV = (window.MV = window.MV || {});
  const W = MV.W || 1920;
  const H = MV.H || 1080;
  const C = MV.C || { black: '#0A0A0A', red: '#E60012', white: '#FFFFFF', blood: '#4A0006' };
  // Captured once: frame-time measurement only (never feeds a draw call).
  const clock = typeof performance !== 'undefined' && performance.now ? performance.now.bind(performance) : () => 0;
  const LEVELS = [1, 0.75, 0.5];
  const ADAPT_WINDOW = 60;
  const ADAPT_MS = 22;

  function makeBuffer(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    let ctx = null;
    try {
      ctx = canvas.getContext('2d', { alpha: false });
    } catch (e) {
      ctx = null;
    }
    if (!ctx) ctx = canvas.getContext('2d');
    return { canvas, ctx };
  }

  // Smallest zoom at which a frame shifted by (x, y) and rotated by rot still
  // covers the viewport (so shakes / drift never reveal an edge).
  function coverZoom(cam) {
    const c = Math.cos(-cam.rot || 0), s = Math.sin(-cam.rot || 0);
    const x = cam.x || 0, y = cam.y || 0;
    let z = 1;
    for (let k = 0; k < 4; k++) {
      const dx = (k & 1 ? 1 : -1) * (W / 2) - x;
      const dy = (k & 2 ? 1 : -1) * (H / 2) - y;
      const rx = dx * c - dy * s, ry = dx * s + dy * c;
      z = Math.max(z, Math.abs(rx) / (W / 2), Math.abs(ry) / (H / 2));
    }
    return z;
  }

  const fin = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
  const NO_CAM = { x: 0, y: 0, zoom: 1, rot: 0 };

  /**
   * @param {object} [opts]
   * @param {HTMLCanvasElement} [opts.canvas] visible output canvas (created if absent)
   * @param {number} [opts.scale=1] render resolution factor (backing = 1920×1080 × scale)
   * @param {boolean} [opts.adaptive=false] live preview only: drop to 0.75 / 0.5 scale when slow
   * @param {boolean} [opts.debug=false] draw the debug overlay
   * @param {boolean} [opts.post=true] use MV.Post when available
   * @param {boolean} [opts.preserveDrawingBuffer=true] keep the WebGL canvas readable (export / screenshots)
   * @param {string} [opts.postPrefer] 'auto' | 'webgl1' | '2d'
   * @param {number} [opts.parallax=0.35] camera factor applied to lyrics
   * @param {number} [opts.overscan=1.02] minimum scene overscan zoom
   */
  function Stage(opts) {
    opts = opts || {};
    this.canvas = opts.canvas || document.createElement('canvas');
    this.W = W;
    this.H = H;
    this.baseScale = Math.max(0.1, fin(opts.scale, 1));
    this.scale = this.baseScale;
    this.adaptive = !!opts.adaptive;
    this.debug = !!opts.debug;
    this.parallax = fin(opts.parallax, 0.35);
    this.overscan = Math.max(1, fin(opts.overscan, 1.02));
    this.usePost = opts.post !== false;
    this.postOptions = { preserveDrawingBuffer: opts.preserveDrawingBuffer !== false, prefer: opts.postPrefer || 'auto' };
    this.director = null;
    this.errors = new Map(); //  'kind:name' → { count, message }
    this._layouts = new Map();
    this._lineKeys = new WeakMap();
    this._layoutGen = 0;
    this._prepared = new Set();
    this._dirVersion = -1;
    this._adapt = [];
    this._stamps = [];
    this.stats = { frames: 0, evalMs: 0, renderMs: 0, avgMs: 0, avgEvalMs: 0, fps: 0, scale: this.scale, quality: 1, post: 'none', downgrades: 0 };
    this._alloc();
    this._initPost();
  }

  /* ------------------------------------------------------------------ */
  /* Setup                                                               */
  /* ------------------------------------------------------------------ */
  Stage.prototype._alloc = function () {
    const w = Math.max(1, Math.round(W * this.scale));
    const h = Math.max(1, Math.round(H * this.scale));
    this.pixelW = w;
    this.pixelH = h;
    const fit = (b) => {
      if (!b) return makeBuffer(w, h);
      if (b.canvas.width !== w) b.canvas.width = w;
      if (b.canvas.height !== h) b.canvas.height = h;
      return b;
    };
    this.sceneA = fit(this.sceneA);
    this.sceneB = fit(this.sceneB);
    this.comp = fit(this.comp);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    if (this.post && this.post.resize) this._try('post', 'resize', () => this.post.resize(w, h));
    this.stats.scale = this.scale;
    this.quality = Math.max(0.5, Math.min(1, this.scale / this.baseScale));
    this.stats.quality = this.quality;
  };

  Stage.prototype._initPost = function () {
    this.post = null;
    this.outCtx = null;
    if (this.usePost && typeof MV.Post === 'function') {
      try {
        this.post = new MV.Post(this.canvas, this.postOptions);
        if (this.post.mode === 'none') this.post = null;
        else this.post.resize(this.pixelW, this.pixelH);
      } catch (e) {
        this._err('post', 'init', e);
        this.post = null;
      }
    }
    if (!this.post) {
      try {
        this.outCtx = this.canvas.getContext('2d');
      } catch (e) {
        this.outCtx = null;
      }
    }
    this.stats.post = this.post ? this.post.mode : this.outCtx ? '2d-direct' : 'none';
  };

  /** Attach a Director (clears the lyric layout cache). */
  Stage.prototype.setDirector = function (dir) {
    this.director = dir || null;
    this._dirVersion = dir ? dir.version : -1;
    this.invalidateLayouts();
    return this;
  };

  /** Change the render resolution factor (buffers + output canvas). */
  Stage.prototype.resize = function (scale) {
    this.baseScale = Math.max(0.1, fin(scale, this.baseScale));
    this.scale = this.baseScale;
    this._adapt.length = 0;
    this._alloc();
    return this;
  };

  /** Drop every cached lyric layout (text, style or font metrics changed). */
  Stage.prototype.invalidateLayouts = function () {
    this._layouts.clear();
    this._layoutGen++;
    return this;
  };

  Stage.prototype.setDebug = function (on) {
    this.debug = !!on;
    return this;
  };

  Stage.prototype.setAdaptive = function (on) {
    this.adaptive = !!on;
    this._adapt.length = 0;
    if (!on && this.scale !== this.baseScale) {
      this.scale = this.baseScale;
      this._alloc();
    }
    return this;
  };

  /**
   * Run scene.prepare(stage) once per registered scene (and optional prepare
   * hooks of transitions / effects / lyric styles), then wait for the web
   * fonts covering every lyric / meta string and invalidate the layouts.
   * @param {object} [opts] { fontTimeout: ms passed to MV.fonts.ensure (default 8000;
   *   an exporter may pass more so no early frame uses a fallback face) }
   * @returns {Promise<Stage>}
   */
  Stage.prototype.prepare = async function (opts) {
    const fontTimeout = fin(opts && opts.fontTimeout, 8000);
    const yieldNow = () => new Promise((r) => setTimeout(r, 0));
    const regs = [['scene', MV.scenes], ['transition', MV.transitions], ['effect', MV.effects], ['lyric', MV.lyricStyles]];
    for (const [kind, reg] of regs) {
      if (!reg || !reg.list) continue;
      for (const name of reg.list()) {
        const key = kind + ':' + name;
        if (this._prepared.has(key)) continue;
        this._prepared.add(key);
        const impl = reg.get(name);
        if (impl && typeof impl.prepare === 'function') {
          this._try(kind, name + '.prepare', () => impl.prepare(this));
          if (kind === 'scene') await yieldNow();
        }
      }
    }
    try {
      let sample = this.director && this.director.fontText ? this.director.fontText() : '';
      if (MV.LyricFX && MV.LyricFX.fontSample) sample += MV.LyricFX.fontSample;
      if (MV.fonts && MV.fonts.ensure) await MV.fonts.ensure(sample, fontTimeout);
    } catch (e) {
      this._err('fonts', 'ensure', e);
    }
    this.invalidateLayouts();
    return this;
  };

  Stage.prototype.dispose = function () {
    if (this.post && this.post.dispose) this._try('post', 'dispose', () => this.post.dispose());
    this.post = null;
    for (const b of [this.sceneA, this.sceneB, this.comp]) if (b) b.canvas.width = b.canvas.height = 1;
    this._layouts.clear();
  };

  /* ------------------------------------------------------------------ */
  /* Error isolation                                                     */
  /* ------------------------------------------------------------------ */
  Stage.prototype._err = function (kind, name, e) {
    const key = kind + ':' + name;
    const rec = this.errors.get(key);
    if (rec) {
      rec.count++;
      return;
    }
    const message = e ? String((e && e.message) || e) : 'missing';
    this.errors.set(key, { count: 1, message });
    if (typeof console !== 'undefined') console.warn('[MV.Stage] ' + key + ' — ' + message);
  };
  // Run fn(); on throw log once and run fallback(). Returns fn's result or false.
  Stage.prototype._try = function (kind, name, fn, fallback) {
    try {
      const r = fn();
      return r === undefined ? true : r;
    } catch (e) {
      this._err(kind, name, e);
      if (fallback) {
        try {
          fallback();
        } catch (e2) {
          this._err(kind, name + '.fallback', e2);
        }
      }
      return false;
    }
  };

  // Reset a buffer context to the logical base transform + default state.
  Stage.prototype._begin = function (ctx) {
    const s = this.scale;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    if (ctx.setLineDash) ctx.setLineDash([]);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    return ctx;
  };

  /* ------------------------------------------------------------------ */
  /* Frame                                                               */
  /* ------------------------------------------------------------------ */
  /**
   * Render the frame at song time t into the visible canvas.
   * @param {number} t seconds
   * @returns {{ms:number, evalMs:number, state:object|null}}
   */
  Stage.prototype.renderFrame = function (t) {
    const t0 = clock();
    const dir = this.director;
    if (dir && dir.version !== this._dirVersion) {
      this._dirVersion = dir.version;
      this.invalidateLayouts();
    }
    let st = null;
    if (dir) {
      try {
        st = dir.evaluate(t, { quality: this.quality });
      } catch (e) {
        this._err('director', 'evaluate', e);
        st = null;
      }
    }
    const t1 = clock();
    const ctx = this._begin(this.comp.ctx);
    if (!st) {
      ctx.fillStyle = C.black;
      ctx.fillRect(0, 0, W, H);
    } else {
      this._drawScene(st);
      this._drawEffects(st, 'under');
      this._drawLyrics(st);
      this._drawEffects(st, 'over');
      this._drawHUD(st);
    }
    const evalMs = t1 - t0;
    if (this.debug) this._drawDebug(st, t);
    this._present(st);
    const ms = clock() - t0;
    this._account(ms, evalMs);
    return { ms, evalMs, state: st };
  };

  /* ---------------- scenes & transitions ---------------- */
  Stage.prototype._drawScene = function (st) {
    const sc = st.scene || {};
    const tr = sc.transition;
    if (tr && sc.to) {
      this._sceneInto(this.sceneA.ctx, sc.from, st);
      this._sceneInto(this.sceneB.ctx, sc.to, st);
      const ctx = this._begin(this.comp.ctx);
      const T = MV.transitions && MV.transitions.get(tr.name);
      const A = this.sceneA.canvas, B = this.sceneB.canvas;
      const cutAt = fin(tr.cutP, 0.6);
      const hardCut = () => {
        this._begin(ctx);
        ctx.drawImage(tr.p < cutAt ? A : B, 0, 0, W, H);
      };
      if (!T) {
        this._err('transition-missing', tr.name);
        hardCut();
        return;
      }
      ctx.save();
      this._try('transition', tr.name, () => T.draw(ctx, A, B, tr.p, st.env, tr.seed), hardCut);
      ctx.restore();
    } else if (sc.from) {
      this._sceneInto(this.comp.ctx, sc.from, st);
    }
  };

  Stage.prototype._sceneInto = function (ctx, spec, st) {
    this._begin(ctx);
    const cam = st.camera || NO_CAM;
    const z = fin(cam.zoom, 1) * Math.max(this.overscan, coverZoom(cam));
    ctx.translate(W / 2 + fin(cam.x, 0), H / 2 + fin(cam.y, 0));
    ctx.rotate(fin(cam.rot, 0));
    ctx.scale(z, z);
    ctx.translate(-W / 2, -H / 2);
    const impl = spec && MV.scenes && MV.scenes.get(spec.name);
    const fallback = () => {
      this._begin(ctx);
      this._fallbackScene(ctx, st.env, spec);
    };
    if (!impl) {
      this._err('scene-missing', spec ? spec.name : '?');
      fallback();
      return;
    }
    ctx.save();
    this._try('scene', spec.name, () => impl.draw(ctx, st.env, spec.p), fallback);
    ctx.restore();
  };

  // Opaque stand-in for a missing / throwing scene: black, a red slash band.
  Stage.prototype._fallbackScene = function (ctx, env, spec) {
    ctx.fillStyle = C.black;
    ctx.fillRect(-40, -40, W + 80, H + 80);
    const seed = (spec && spec.p && spec.p.seed) || 1;
    const t = (env && env.t) || 0;
    const y = H * 0.5 + 120 * MV.srand(seed, 1);
    ctx.save();
    ctx.translate(W / 2, y);
    ctx.rotate(-12 * Math.PI / 180);
    ctx.fillStyle = C.red;
    ctx.fillRect(-W, -70 - 20 * ((env && env.beat && env.beat.pulse) || 0), W * 2, 140);
    ctx.fillStyle = C.black;
    for (let i = -12; i < 12; i++) ctx.fillRect(i * 160 + ((t * 120) % 160), -70, 18, 140);
    ctx.restore();
  };

  /* ---------------- effects ---------------- */
  Stage.prototype._drawEffects = function (st, layer) {
    const list = st.accents;
    if (!list || !list.length || !MV.effects) return;
    const ctx = this.comp.ctx;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const impl = MV.effects.get(a.kind);
      if (!impl) {
        if (layer === 'under') this._err('effect-missing', a.kind);
        continue;
      }
      if ((impl.layer || 'over') !== layer) continue;
      this._begin(ctx);
      ctx.save();
      this._try('effect', a.kind, () => impl.draw(ctx, st.env, a));
      ctx.restore();
    }
  };

  /* ---------------- lyrics ---------------- */
  Stage.prototype._lineKey = function (line) {
    let k = this._lineKeys.get(line);
    if (!k) {
      k = (line.id || 'L?') + '#' + (MV.fnv1a ? MV.fnv1a(String(line.text || '')) : String(line.text || '').length) + '#' + (line.seed >>> 0);
      this._lineKeys.set(line, k);
    }
    return k;
  };

  // Cached layout (null when layout() threw — the fallback is drawn then).
  Stage.prototype._layout = function (impl, name, line, ctx) {
    const key = this._lineKey(line) + '|' + name + '|' + this._layoutGen;
    if (this._layouts.has(key)) return this._layouts.get(key);
    let L = null;
    try {
      L = impl.layout(line, ctx);
    } catch (e) {
      this._err('lyric', name + '.layout', e);
      L = null;
    }
    this._layouts.set(key, L);
    if (this._layouts.size > 256) this._layouts.delete(this._layouts.keys().next().value);
    return L;
  };

  Stage.prototype._drawLyrics = function (st) {
    const list = st.lyrics;
    if (!list || !list.length) return;
    const ctx = this.comp.ctx;
    const cam = st.camera || NO_CAM;
    const k = this.parallax;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const line = item.line;
      if (!line) continue;
      let name = item.style || line.style || 'ransom';
      let impl = MV.lyricStyles && MV.lyricStyles.get(name);
      if (!impl) {
        this._err('style-missing', name);
        name = 'ransom';
        impl = MV.lyricStyles && MV.lyricStyles.get(name);
      }
      this._begin(ctx);
      const z = 1 + (fin(cam.zoom, 1) - 1) * k;
      ctx.translate(W / 2 + fin(cam.x, 0) * k, H / 2 + fin(cam.y, 0) * k);
      ctx.rotate(fin(cam.rot, 0) * k);
      ctx.scale(z, z);
      ctx.translate(-W / 2, -H / 2);
      const fallback = () => this._fallbackLyric(ctx, item, st.env, cam, k);
      if (!impl) {
        fallback();
        continue;
      }
      const layout = this._layout(impl, name, line, ctx);
      if (layout == null) {
        fallback();
        continue;
      }
      ctx.save();
      this._try('lyric', name, () => impl.draw(ctx, line, layout, item.lt, st.env), () => {
        ctx.restore();
        ctx.save();
        fallback();
      });
      ctx.restore();
    }
  };

  // Plain but on-brand stand-in: revealed glyphs, white on a black skewed plate.
  Stage.prototype._fallbackLyric = function (ctx, item, env, cam, k) {
    const line = item.line, lt = item.lt || {};
    const t = env ? env.t : 0;
    const a = Math.max(0, Math.min(1, fin(lt.in, 1))) * (1 - Math.max(0, Math.min(1, fin(lt.out, 0))));
    if (a <= 0.01) return;
    const chars = line.chars || Array.from(line.text || '');
    let shown = '';
    for (let i = 0; i < chars.length; i++) {
      const ct = line.charTimes ? line.charTimes[i] : line.start;
      if (t >= ct - 0.04) shown += chars[i];
    }
    if (!shown.trim()) return;
    const fam = MV.FONTS ? MV.FONTS.jpHeavy : 'sans-serif';
    const size = MV.text ? MV.text.fitSize(line.text || shown, fam, 400, 1500, 110, 28) : 64;
    this._begin(ctx);
    const z = 1 + (fin(cam.zoom, 1) - 1) * k;
    ctx.translate(W / 2 + fin(cam.x, 0) * k, H / 2 + fin(cam.y, 0) * k);
    ctx.rotate(fin(cam.rot, 0) * k);
    ctx.scale(z, z);
    ctx.translate(-W / 2, -H / 2);
    ctx.globalAlpha = a;
    ctx.font = MV.text ? MV.text.font(size, fam, 400) : size + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const y = H * 0.76;
    const w = Math.min(1700, ctx.measureText(line.text || shown).width + 80);
    ctx.fillStyle = C.red;
    MV.draw.skewRect(ctx, W / 2 - w / 2 + 10, y - size * 0.75 + 10, w, size * 1.5, 24);
    ctx.fill();
    ctx.fillStyle = C.black;
    MV.draw.skewRect(ctx, W / 2 - w / 2, y - size * 0.75, w, size * 1.5, 24);
    ctx.fill();
    ctx.textAlign = 'left';
    const full = ctx.measureText(line.text || shown).width;
    ctx.fillStyle = C.white;
    ctx.fillText(shown, W / 2 - full / 2, y);
  };

  /* ---------------- HUD / debug / present ---------------- */
  Stage.prototype._drawHUD = function (st) {
    if (!MV.HUD || !st.hud || st.hud.visible === false) return;
    const ctx = this._begin(this.comp.ctx);
    ctx.save();
    this._try('hud', 'HUD', () => MV.HUD.draw(ctx, st.env, st.hud));
    ctx.restore();
  };

  Stage.prototype._drawDebug = function (st, t) {
    const ctx = this._begin(this.comp.ctx);
    const S = this.stats;
    const f2 = (x) => (fin(x, 0)).toFixed(2);
    const rows = [];
    rows.push(`FPS ${S.fps.toFixed(1)}  frame ${f2(S.renderMs)} ms (avg ${f2(S.avgMs)})  eval ${fin(S.avgEvalMs, 0).toFixed(3)} ms  scale ${f2(this.scale)}  ${S.post}`);
    if (st) {
      const e = st.env, s = e.section;
      rows.push(`t ${MV.fmtTime ? MV.fmtTime(t) : f2(t)}  ${s.name} #${s.index} ${(s.progress * 100).toFixed(0)}%  I ${f2(e.intensity)}  beat ${e.beat.index}.${e.beat.beatInBar}  E ${f2(e.energy)}  on ${f2(e.onsetPulse)}`);
      const sc = st.scene;
      let sl = `scene ${sc.from.name}#${sc.from.index} v${sc.from.p.variant}`;
      if (sc.to) sl += ` → ${sc.to.name}#${sc.to.index} v${sc.to.p.variant}`;
      if (sc.transition) sl += `  [${sc.transition.name} ${f2(sc.transition.p)}]`;
      rows.push(sl);
      rows.push('lyrics ' + (st.lyrics.length ? st.lyrics.map((l) => `${l.line.id}:${l.style} in${f2(l.lt.in)} out${f2(l.lt.out)}`).join('  ') : '—'));
      rows.push('accents ' + (st.accents.length ? st.accents.map((a) => a.kind).join(' ') : '—'));
      const c = st.camera, p = st.post;
      rows.push(`cam ${f2(c.x)},${f2(c.y)} z${c.zoom.toFixed(3)} r${(c.rot * 57.3).toFixed(2)}°  post rgb${f2(p.rgbShift)} gl${f2(p.glitch)} fl${f2(p.flash)}/${f2(p.redFlash)}`);
    } else rows.push('no director');
    if (this.errors.size) rows.push('errors ' + Array.from(this.errors.keys()).join(', '));
    const x = 24, y = 24, lh = 26;
    ctx.font = '600 19px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
    let w = 0;
    for (const r of rows) w = Math.max(w, ctx.measureText(r).width);
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 12, y - 8, w + 24, rows.length * lh + 16);
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.red;
    ctx.fillRect(x - 12, y - 8, 6, rows.length * lh + 16);
    ctx.textBaseline = 'top';
    rows.forEach((r, i) => {
      ctx.fillStyle = i === 0 ? '#FFE14D' : '#FFFFFF';
      ctx.fillText(r, x, y + i * lh);
    });
  };

  Stage.prototype._present = function (st) {
    const params = st ? st.post : { grain: 0, vignette: 0 };
    if (this.post) {
      this._try('post', 'render', () => this.post.render(this.comp.canvas, params));
      return;
    }
    if (this.outCtx) {
      const o = this.outCtx;
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.globalAlpha = 1;
      o.globalCompositeOperation = 'source-over';
      o.drawImage(this.comp.canvas, 0, 0, this.canvas.width, this.canvas.height);
    }
  };

  /* ---------------- stats & adaptive quality ---------------- */
  Stage.prototype._account = function (ms, evalMs) {
    const S = this.stats;
    S.frames++;
    S.renderMs = ms;
    S.evalMs = evalMs;
    S.avgMs = S.frames === 1 ? ms : S.avgMs * 0.95 + ms * 0.05;
    S.avgEvalMs = S.frames === 1 ? evalMs : S.avgEvalMs * 0.95 + evalMs * 0.05;
    const now = clock();
    const st = this._stamps;
    st.push(now);
    while (st.length > 2 && now - st[0] > 1000) st.shift();
    if (st.length > 1) S.fps = ((st.length - 1) * 1000) / Math.max(1, now - st[0]);
    if (!this.adaptive) return;
    const a = this._adapt;
    a.push(ms);
    if (a.length < ADAPT_WINDOW) return;
    let sum = 0;
    for (const v of a) sum += v;
    a.length = 0;
    if (sum / ADAPT_WINDOW <= ADAPT_MS) return;
    const next = LEVELS.find((l) => l < this.scale - 1e-3);
    if (next == null) return;
    this.scale = next;
    S.downgrades++;
    this._alloc();
    if (typeof console !== 'undefined') console.info('[MV.Stage] adaptive quality → scale ' + next);
  };

  MV.Stage = Stage;
})();

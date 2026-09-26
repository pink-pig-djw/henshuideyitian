/*
 * MV scenes — the ten full-frame background scenes (docs/ARCHITECTURE.md §3.4).
 *
 *   night-city · train · crowd · tunnel · stripes · sunburst · sky-red · shards · starfield · void
 *
 * Contract per scene:
 *   prepare(stage)       builds the static caches once (vector display lists for
 *                        skylines / rooftops / the train interior, tight sprites
 *                        for halftones, moons and figures). Also run lazily on
 *                        first draw.
 *   draw(ctx, env, p)    paints the WHOLE frame opaquely in logical 1920×1080 space,
 *                        with overscan so camera zoom-out / rotation never shows an edge.
 *   p = { seed, lt, dur, variant, speed, intensity }
 *
 * Rendering is a pure function of (env, p) and the pre-rendered sprites:
 * no Math.random / Date.now / performance.now anywhere in this file. Motion comes
 * from p.lt (cue-local, seeded offset so repeated cues differ) and env.beat.
 * Scenes never call setTransform/resetTransform (the Stage owns the base transform).
 *
 * Original artwork only: faceless silhouettes, generic crows, an original
 * star-slash emblem. No franchise characters, masks, logos or UI.
 *
 * Cultural rule: no sun-like compositions. Never red/white (or red/light) rays
 * or wedges radiating from a centre or disc, no striped sun discs. Big round
 * lights are always a shaded, cratered cream moon (MV.C.star); energy comes from
 * red/black focus lines, concentric rings, halftone waves and star bursts.
 * tools/shot-scenes.cjs checks every scene with a radial-wedge detector.
 *
 * Memory: large flat layers are recorded as vector ops (Recorder) and shared
 * sprites (moons, radial halftone quadrants) are built once; MV.sceneStats()
 * reports what the caches hold.
 */
(function () {
  'use strict';

  const MV = window.MV;
  if (!MV || !MV.scenes) {
    if (typeof console !== 'undefined') console.error('[MV scenes] core.js must be loaded first');
    return;
  }

  const C = MV.C;
  const W = MV.W;
  const H = MV.H;
  const TAU = MV.TAU;
  const DEG = Math.PI / 180;
  const OV = 160; // overscan (px) around the frame for sprites / geometry
  const OVF = 520; // overscan for flat full-frame fills (tilted scenes + camera)
  const clamp = MV.clamp;
  const lerp = MV.lerp;
  const fract = MV.fract;
  const mod = MV.mod;
  const rand = MV.rand;
  const srand = MV.srand;
  const E = MV.ease;
  const D = MV.draw;

  /* ================================================================== */
  /* Shared private helpers                                              */
  /* ================================================================== */

  function rgbOf(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // Blend of two palette tokens (still "palette": a tint between tokens).
  function mix(a, b, t) {
    const A = rgbOf(a), B = rgbOf(b);
    const h = (v) => ('0' + Math.round(v).toString(16)).slice(-2);
    return '#' + h(A[0] + (B[0] - A[0]) * t) + h(A[1] + (B[1] - A[1]) * t) + h(A[2] + (B[2] - A[2]) * t);
  }
  function rgba(hex, a) {
    const A = rgbOf(hex);
    return 'rgba(' + A[0] + ',' + A[1] + ',' + A[2] + ',' + a + ')';
  }
  // Memory accounting (dev/test only): bytes of every pre-rendered sprite and
  // the number of recorded vector segments, per scene that built them.
  const MEM = { bytes: {}, segs: {} };
  let building = 'shared';
  function account(kind, n) {
    MEM[kind][building] = (MEM[kind][building] || 0) + n;
  }
  // Runs fn with memory attributed to `who` (shared caches built lazily).
  function attributed(who, fn) {
    const prev = building;
    building = who;
    try {
      return fn();
    } finally {
      building = prev;
    }
  }
  function sprite(w, h, paint) {
    const s = MV.makeCanvas(w, h);
    account('bytes', s.canvas.width * s.canvas.height * 4);
    paint(s.ctx, s.canvas.width, s.canvas.height);
    // Force rasterisation now. Chrome keeps a never-read canvas as a recorded
    // display list and would replay every path (thousands of halftone dots) on
    // each drawImage — measured 7.6 ms → 1.5 ms per full-frame blit.
    try {
      s.ctx.getImageData(0, 0, 1, 1);
    } catch (e) {
      /* tainted / unavailable: fine, just slower */
    }
    return s.canvas;
  }
  // CPU-backed sprite (willReadFrequently) for pattern tiles: in Chrome a pattern
  // made from a GPU-backed canvas rasterises its first use on a software context
  // differently from later uses; a CPU tile keeps every frame identical.
  function cpuSprite(w, h, paint) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w));
    cv.height = Math.max(1, Math.round(h));
    let c = null;
    try {
      c = cv.getContext('2d', { willReadFrequently: true });
    } catch (e) {
      c = null;
    }
    if (!c) return sprite(w, h, paint);
    account('bytes', cv.width * cv.height * 4);
    paint(c, cv.width, cv.height);
    return cv;
  }
  function fillAll(ctx, color) {
    ctx.fillStyle = color;
    ctx.fillRect(-OVF, -OVF, W + OVF * 2, H + OVF * 2);
  }
  function roundRectPath(c, x, y, w, h, r, keepPath) {
    r = Math.min(r, w / 2, h / 2);
    if (!keepPath) c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }
  // Adds the outline band of a stroked round rect (width lw) as two subpaths;
  // fill with 'evenodd'. Filling is cheaper than stroking a recorded path.
  function roundRectRing(c, x, y, w, h, r, lw) {
    const d = lw / 2;
    roundRectPath(c, x - d, y - d, w + lw, h + lw, r + d, true);
    roundRectPath(c, x + d, y + d, w - lw, h - lw, Math.max(0, r - d), true);
  }
  function circle(c, x, y, r) {
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
  }
  function pickW(list, u) {
    let sum = 0;
    for (let i = 0; i < list.length; i++) sum += list[i][1];
    let a = u * sum;
    for (let i = 0; i < list.length; i++) {
      a -= list[i][1];
      if (a < 0) return list[i][0];
    }
    return list[list.length - 1][0];
  }
  // Horizontally tiling strips: strip coordinate X is at screen X − off (mod width).
  const OVS = 420; // horizontal reach of tiled strips
  function stripX0(off, sw) {
    let x = -mod(off, sw);
    while (x > -OVS) x -= sw;
    return Math.round(x);
  }
  function drawStrip(ctx, img, off, y) {
    const sw = img.width;
    for (let x = stripX0(off, sw); x < W + OVS; x += sw) ctx.drawImage(img, x, y);
  }

  /* ================================================================== */
  /* Vector display lists                                                */
  /* ================================================================== */
  // Big flat-colour layers (skylines, rooftops, the train interior…) used to be
  // pre-rendered into multi-megabyte sprites. They are now *recorded* once into
  // a few Path2D objects (one per colour / layer) and replayed every frame:
  // near-zero memory, crisp at any camera zoom / rotation, and solid-colour
  // path fills are as cheap as a sprite blit in software raster.
  //
  // A subpath is { x, y, s: [segments], z: closed }; a segment is [x, y] (line),
  // [cx, cy, x, y] (quadratic) or [c1x, c1y, c2x, c2y, x, y] (cubic), all in
  // recording space (the painter's transform is already applied).
  function subArea(sp) {
    let a = 0, px = sp.x, py = sp.y;
    for (let k = 0; k < sp.s.length; k++) {
      const s = sp.s[k];
      for (let i = 0; i < s.length; i += 2) {
        a += px * s[i + 1] - s[i] * py;
        px = s[i];
        py = s[i + 1];
      }
    }
    return (a + px * sp.y - sp.x * py) / 2;
  }
  function subReverse(sp) {
    const n = sp.s.length;
    const last = sp.s[n - 1];
    const out = { x: last[last.length - 2], y: last[last.length - 1], s: [], z: sp.z };
    for (let k = n - 1; k >= 0; k--) {
      const s = sp.s[k], pv = k > 0 ? sp.s[k - 1] : null;
      const px = pv ? pv[pv.length - 2] : sp.x, py = pv ? pv[pv.length - 1] : sp.y;
      if (s.length === 2) out.s.push([px, py]);
      else if (s.length === 4) out.s.push([s[0], s[1], px, py]);
      else out.s.push([s[2], s[3], s[0], s[1], px, py]);
    }
    return out;
  }
  function subEmit(path, sp, close) {
    path.moveTo(sp.x, sp.y);
    for (let k = 0; k < sp.s.length; k++) {
      const s = sp.s[k];
      if (s.length === 2) path.lineTo(s[0], s[1]);
      else if (s.length === 4) path.quadraticCurveTo(s[0], s[1], s[2], s[3]);
      else path.bezierCurveTo(s[0], s[1], s[2], s[3], s[4], s[5]);
    }
    if (close || sp.z) path.closePath();
    account('segs', sp.s.length + 1);
  }

  /**
   * Canvas-like recorder for the subset of the 2D API the painters use.
   * Fills of one colour merge into one Path2D. Every nonzero subpath is
   * normalised to the same winding, so merged overlapping shapes union
   * (never cancel into holes). `rec.layer = n` groups ops by layer and colour
   * regardless of call order (the painter guarantees that different colours in
   * one layer never overlap); with `layer = null` only consecutive same-style
   * ops merge, so the paint order is kept exactly.
   */
  function Recorder() {
    this.m = [1, 0, 0, 1, 0, 0];
    this.stack = [];
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.lineWidth = 1;
    this.lineCap = 'butt';
    this.lineJoin = 'miter';
    this.layer = null;
    this.path = [];
    this.cur = null;
    this.ops = [];
    this.byKey = new Map();
    this.uid = 0;
  }
  const RP = Recorder.prototype;
  RP.save = function () {
    this.stack.push([this.m.slice(), this.fillStyle, this.strokeStyle, this.lineWidth, this.lineCap, this.lineJoin, this.layer]);
  };
  RP.restore = function () {
    const s = this.stack.pop();
    if (s) [this.m, this.fillStyle, this.strokeStyle, this.lineWidth, this.lineCap, this.lineJoin, this.layer] = s;
  };
  RP.transform = function (a, b, c, d, e, f) {
    const m = this.m;
    this.m = [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d, m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]];
  };
  RP.translate = function (x, y) {
    this.transform(1, 0, 0, 1, x, y);
  };
  RP.scale = function (x, y) {
    this.transform(x, 0, 0, y, 0, 0);
  };
  RP.rotate = function (a) {
    const c = Math.cos(a), s = Math.sin(a);
    this.transform(c, s, -s, c, 0, 0);
  };
  RP.tx = function (x, y) {
    const m = this.m;
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  };
  RP.beginPath = function () {
    this.path = [];
    this.cur = null;
  };
  RP.moveTo = function (x, y) {
    const p = this.tx(x, y);
    this.cur = { x: p[0], y: p[1], s: [], z: false };
    this.path.push(this.cur);
  };
  RP.lineTo = function (x, y) {
    if (!this.cur) this.moveTo(x, y);
    else this.cur.s.push(this.tx(x, y));
  };
  RP.quadraticCurveTo = function (cx, cy, x, y) {
    if (!this.cur) this.moveTo(cx, cy);
    this.cur.s.push(this.tx(cx, cy).concat(this.tx(x, y)));
  };
  RP.bezierCurveTo = function (ax, ay, bx, by, x, y) {
    if (!this.cur) this.moveTo(ax, ay);
    this.cur.s.push(this.tx(ax, ay).concat(this.tx(bx, by), this.tx(x, y)));
  };
  RP.closePath = function () {
    const c = this.cur;
    if (!c) return;
    c.z = true;
    this.cur = { x: c.x, y: c.y, s: [], z: false };
    this.path.push(this.cur);
  };
  // Arcs become cubic Béziers (≤ 90° each), so any affine transform is exact.
  RP.arc = function (x, y, r, a0, a1, ccw) {
    let sw = a1 - a0;
    if (!ccw) sw = sw >= TAU ? TAU : mod(sw, TAU);
    else sw = -sw >= TAU ? -TAU : -mod(-sw, TAU);
    const sx = x + Math.cos(a0) * r, sy = y + Math.sin(a0) * r;
    if (this.cur) this.lineTo(sx, sy);
    else this.moveTo(sx, sy);
    if (!sw) return;
    const n = Math.max(1, Math.ceil(Math.abs(sw) / (Math.PI / 2) - 1e-9));
    const d = sw / n, k = (4 / 3) * Math.tan(d / 4);
    let a = a0;
    for (let i = 0; i < n; i++) {
      const b = a + d;
      const c0 = Math.cos(a), s0 = Math.sin(a), c1 = Math.cos(b), s1 = Math.sin(b);
      this.cur.s.push(this.tx(x + r * (c0 - k * s0), y + r * (s0 + k * c0)).concat(this.tx(x + r * (c1 + k * s1), y + r * (s1 - k * c1)), this.tx(x + r * c1, y + r * s1)));
      a = b;
    }
  };
  RP.ellipse = function (x, y, rx, ry, rot, a0, a1, ccw) {
    this.save();
    this.translate(x, y);
    this.rotate(rot || 0);
    this.scale(rx, ry);
    this.arc(0, 0, 1, a0, a1, ccw);
    this.restore();
  };
  RP.rect = function (x, y, w, h) {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  };
  RP.op = function (kind, key, init) {
    const L = this.layer;
    let op = null;
    if (L != null) op = this.byKey.get(L + '#' + key) || null;
    else {
      const last = this.ops[this.ops.length - 1];
      if (last && last.layer == null && last.key === key) op = last;
    }
    if (!op) {
      op = { k: kind, key, layer: L, n: this.ops.length, p: new Path2D() };
      init(op);
      this.ops.push(op);
      if (L != null) this.byKey.set(L + '#' + key, op);
    }
    return op;
  };
  RP.fill = function (rule) {
    const eo = rule === 'evenodd';
    const style = this.fillStyle;
    // even-odd fills never merge (overlaps between separate fills would cancel)
    const op = this.op(0, 'f|' + style + (eo ? '|eo' + this.uid++ : ''), (o) => {
      o.s = style;
      o.r = eo ? 'evenodd' : 'nonzero';
    });
    for (const sp of this.path) {
      if (!sp.s.length) continue;
      subEmit(op.p, !eo && subArea(sp) < 0 ? subReverse(sp) : sp, true);
    }
  };
  RP.stroke = function () {
    const m = this.m;
    const w = this.lineWidth * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    const st = [this.strokeStyle, w, this.lineCap, this.lineJoin];
    const op = this.op(1, 's|' + st.join('|'), (o) => {
      o.s = st[0];
      o.w = st[1];
      o.cap = st[2];
      o.join = st[3];
    });
    for (const sp of this.path) if (sp.s.length) subEmit(op.p, sp, false);
  };
  RP.fillRect = function (x, y, w, h) {
    const keep = [this.path, this.cur];
    this.beginPath();
    this.rect(x, y, w, h);
    this.fill();
    [this.path, this.cur] = keep;
  };
  RP.strokeRect = function (x, y, w, h) {
    const keep = [this.path, this.cur];
    this.beginPath();
    this.rect(x, y, w, h);
    this.stroke();
    [this.path, this.cur] = keep;
  };
  // Translation-only transforms (small pre-rendered details such as ads).
  RP.drawImage = function (img, x, y) {
    const p = this.tx(x, y);
    this.ops.push({ k: 2, key: null, layer: this.layer, n: this.ops.length, img, x: Math.round(p[0]), y: Math.round(p[1]) });
  };
  RP.finish = function () {
    return this.ops.slice().sort((a, b) => (a.layer || 0) - (b.layer || 0) || a.n - b.n);
  };
  /** Records `paint(rec)` and returns the op list. */
  function record(paint) {
    const rec = new Recorder();
    paint(rec);
    return rec.finish();
  }
  /**
   * Replays recorded ops. Colours starting with '@' are palette slots looked
   * up in `pal` (one recording serves every palette of a scene); a slot the
   * palette leaves out is skipped (e.g. a distant skyline without windows).
   */
  function playOps(ctx, ops, pal) {
    let stroked = false;
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const col = op.k < 2 && pal && op.s.charCodeAt(0) === 64 ? pal[op.s] : op.s;
      if (op.k < 2 && !col) continue;
      if (op.k === 0) {
        ctx.fillStyle = col;
        ctx.fill(op.p, op.r);
      } else if (op.k === 1) {
        ctx.strokeStyle = col;
        ctx.lineWidth = op.w;
        ctx.lineCap = op.cap;
        ctx.lineJoin = op.join;
        ctx.stroke(op.p);
        stroked = true;
      } else {
        ctx.drawImage(op.img, op.x, op.y);
      }
    }
    if (stroked) {
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
    }
  }
  // Rasterises a recorded, horizontally tiling strip into a seamless sprite
  // (for dense strips, e.g. thousands of tiny windows, a blit is cheaper).
  // k scales the strip (k·L.w must be an integer for a seamless tile).
  function stripSprite(L, h, pal, k) {
    k = k || 1;
    return sprite(Math.round(L.w * k), Math.round(h * k), (c) => {
      c.scale(k, k);
      c.translate(-L.w, 0);
      playOps(c, L.ops, pal);
      c.translate(L.w, 0);
      playOps(c, L.ops, pal);
    });
  }
  // Horizontally tiling recorded strip (L = { ops, w, over }): same placement as
  // drawStrip; the previous tile is included when its overhang is on screen.
  // k: the caller has scaled the context by k (screen bounds are divided by k).
  function drawStripOps(ctx, L, off, y, pal, k) {
    const sw = L.w, lo = -OVS / (k || 1), hi = (W + OVS) / (k || 1);
    let x = -mod(off, sw);
    while (x > lo) x -= sw;
    x = Math.round(x);
    if (x + (L.over || 0) > lo) x -= sw;
    for (; x < hi; x += sw) {
      ctx.translate(x, y);
      playOps(ctx, L.ops, pal);
      ctx.translate(-x, -y);
    }
  }

  const BEAT0 = {
    index: 0, phase: 0, period: 60 / 99.38, bar: 0, barPhase: 0, beatInBar: 0,
    sinceBeat: 9, sinceDownbeat: 9, pulse: 0, barPulse: 0,
  };
  function beatOf(env) {
    const b = env && env.beat;
    if (!b) return BEAT0;
    if (!(b.period > 0)) return Object.assign({}, BEAT0, b, { period: BEAT0.period });
    return b;
  }
  function num(x, d) {
    return typeof x === 'number' && isFinite(x) ? x : d;
  }
  function normP(p, env) {
    p = p || {};
    return {
      seed: (num(p.seed, 1) >>> 0) || 1,
      lt: num(p.lt, num(env.t, 0)),
      dur: num(p.dur, 0) > 0 ? p.dur : 8,
      variant: Math.abs(num(p.variant, 0) | 0),
      speed: num(p.speed, 1),
      intensity: clamp(num(p.intensity, num(env.intensity, 0.5))),
    };
  }

  /**
   * Registers a scene. `spec.build()` returns the sprite cache (run once);
   * `spec.draw(ctx, env, p, cache)` paints the frame. State is isolated with
   * save/restore so a scene can never leak alpha / composite / transform.
   */
  function defineScene(name, spec) {
    const scene = {
      name,
      cache: null,
      prepare(stage) {
        if (!scene.cache) scene.cache = attributed(name, () => (spec.build ? spec.build(stage || null) : {}));
        return scene.cache;
      },
      draw(ctx, env, p) {
        env = env || { t: 0 };
        const cache = scene.cache || scene.prepare(null);
        const q = normP(p, env);
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
        ctx.setLineDash([]);
        try {
          spec.draw(ctx, env, q, cache);
        } finally {
          ctx.restore();
        }
      },
    };
    MV.scenes.register(name, scene);
    return scene;
  }

  /* ---------------- Original emblem: 5-point star pierced by a slash ---- */
  function drawEmblem(ctx, cx, cy, r, rot, o) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.lineJoin = 'miter';
    if (o.shadow) {
      ctx.fillStyle = o.shadow;
      D.star(ctx, r * 0.1, r * 0.1, r, r * 0.46);
      ctx.fill();
    }
    ctx.fillStyle = o.star;
    D.star(ctx, 0, 0, r, r * 0.46);
    ctx.fill();
    ctx.lineWidth = o.lw || r * 0.07;
    ctx.strokeStyle = o.outline;
    ctx.stroke();
    // blade at −35°, with a cut gap in the background colour
    ctx.rotate(-35 * DEG);
    const L = r * 1.45, th = r * 0.15;
    const blade = [[-L, th * 0.5], [-L + th * 1.4, -th * 0.5], [L, -th * 0.5], [L - th * 1.4, th * 0.5]];
    ctx.lineJoin = 'round';
    D.polygon(ctx, blade);
    ctx.lineWidth = th * 1.1;
    ctx.strokeStyle = o.gap;
    ctx.stroke();
    ctx.fillStyle = o.slash;
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.035);
    ctx.strokeStyle = o.outline;
    ctx.stroke();
    ctx.restore();
  }

  /* ---------------- Skylines (pre-rendered, horizontally tileable) ------ */
  function mast(c, x, y, h, out, beacon) {
    c.fillRect(Math.round(x - 1.5), y - h, 3, h + 1);
    c.fillRect(Math.round(x - 7), y - h * 0.55, 14, 2);
    c.fillRect(Math.round(x - 4), y - h * 0.8, 8, 2);
    if (beacon && out) out.beacons.push({ x, y: y - h - 2 });
  }
  function roofBoxes(c, x, w, top, R) {
    const n = 1 + Math.floor(R(81) * 3);
    for (let i = 0; i < n; i++) {
      const bw = 8 + R(82 + i) * Math.min(40, w * 0.3), bh = 5 + R(90 + i) * 14;
      const bx = x + 4 + R(95 + i) * Math.max(1, w - bw - 8);
      c.fillRect(Math.round(bx), Math.round(top - bh), Math.round(bw), Math.round(bh) + 1);
    }
  }
  function paintBuilding(c, b, x, o, out) {
    const R = (i, j) => rand(b.seed, i, j || 0);
    const bottom = o.h, w = b.w, top = b.top;
    const cx = x + w / 2;
    c.layer = 0; // bodies · 1 boards · 2 board art · 3 windows (see Recorder)
    c.fillStyle = o.color;
    c.fillRect(x, top, w, bottom - top);
    switch (b.type) {
      case 1: { // set-back tiers + antenna
        const w2 = Math.round(w * (0.4 + R(1) * 0.35)), h2 = Math.round(16 + R(2) * 44);
        const x2 = Math.round(x + (w - w2) * (0.2 + 0.6 * R(3)));
        c.fillRect(x2, top - h2, w2, h2 + 1);
        let crown = top - h2;
        if (R(4) < 0.5) {
          const w3 = Math.round(w2 * 0.5), h3 = Math.round(h2 * 0.7);
          c.fillRect(x2 + Math.round((w2 - w3) / 2), crown - h3, w3, h3 + 1);
          crown -= h3;
        }
        mast(c, x2 + w2 / 2, crown, 20 + R(5) * 55, out, R(6) < 0.6);
        break;
      }
      case 2: { // water tank on legs
        const tw = Math.max(14, Math.round(Math.min(46, w * 0.28))), th = Math.round(tw * 0.85);
        const tx = Math.round(x + (w - tw) * (0.15 + R(1) * 0.7));
        const legs = Math.round(tw * 0.55);
        c.fillRect(tx + 2, top - legs, 3, legs + 1);
        c.fillRect(tx + tw - 5, top - legs, 3, legs + 1);
        c.fillRect(tx, Math.round(top - legs * 0.5), tw, 2);
        c.beginPath();
        c.moveTo(tx, top - legs);
        c.lineTo(tx, top - legs - th);
        c.lineTo(tx + tw / 2, top - legs - th - tw * 0.3);
        c.lineTo(tx + tw, top - legs - th);
        c.lineTo(tx + tw, top - legs);
        c.closePath();
        c.fill();
        roofBoxes(c, x, w, top, R);
        break;
      }
      case 3: { // sloped / gabled roof
        const hh = Math.min(90, w * (0.18 + R(1) * 0.3));
        c.beginPath();
        if (R(2) < 0.5) {
          c.moveTo(x, top + 1);
          c.lineTo(x + w, top + 1);
          c.lineTo(R(3) < 0.5 ? x + w : x, top - hh);
        } else {
          c.moveTo(x - 3, top + 1);
          c.lineTo(x + w * (0.3 + R(3) * 0.4), top - hh);
          c.lineTo(x + w + 3, top + 1);
        }
        c.closePath();
        c.fill();
        break;
      }
      case 4: { // spire tower with a blinking beacon
        const sw = Math.max(10, w * 0.34), sh = 60 + R(1) * 130;
        c.beginPath();
        c.moveTo(cx - sw / 2, top + 1);
        c.lineTo(cx - sw * 0.14, top - sh);
        c.lineTo(cx + sw * 0.14, top - sh);
        c.lineTo(cx + sw / 2, top + 1);
        c.closePath();
        c.fill();
        c.fillRect(Math.round(cx - sw * 0.35), Math.round(top - sh * 0.35), Math.round(sw * 0.7), 5);
        mast(c, cx, top - sh, 40 + R(2) * 60, out, true);
        break;
      }
      case 5: { // billboard frame on the roof
        const bw2 = Math.round(w * (0.6 + R(1) * 0.3)), bh = Math.round(22 + R(2) * 36), post = 12;
        const bx = Math.round(x + (w - bw2) * R(3));
        c.fillRect(bx + 6, top - post, 4, post + 1);
        c.fillRect(bx + bw2 - 10, top - post, 4, post + 1);
        c.fillRect(bx, top - post - bh, bw2, bh);
        if (o.board) {
          // abstract ad: star + two bars (no text, no logos)
          const by = top - post - bh;
          c.layer = 1;
          c.fillStyle = o.board;
          c.fillRect(bx + 4, by + 4, bw2 - 8, bh - 8);
          c.layer = 2;
          c.fillStyle = o.color;
          D.star(c, bx + 4 + bh * 0.5, by + bh / 2, bh * 0.32, bh * 0.14);
          c.fill();
          const bl = Math.max(8, bw2 - bh * 1.2);
          c.fillRect(Math.round(bx + bh), Math.round(by + bh * 0.3), Math.round(bl * 0.85), Math.max(2, Math.round(bh * 0.14)));
          c.fillRect(Math.round(bx + bh), Math.round(by + bh * 0.56), Math.round(bl * 0.55), Math.max(2, Math.round(bh * 0.14)));
          c.layer = 0;
        }
        break;
      }
      case 6: { // stepped crown
        let tw = w, ty = top;
        for (let k = 0; k < 3; k++) {
          tw = Math.round(tw * (0.62 + R(10 + k) * 0.15));
          const th = Math.round(10 + R(20 + k) * 22);
          c.fillRect(Math.round(cx - tw / 2), ty - th, tw, th + 1);
          ty -= th;
        }
        mast(c, cx, ty, 18 + R(7) * 30, out, R(8) < 0.5);
        break;
      }
      default:
        roofBoxes(c, x, w, top, R);
    }
    // windows
    const wn = o.win;
    if (!wn) return;
    c.layer = 3;
    const cw = wn.w + wn.gx, ch = wn.h + wn.gy;
    const cols = Math.max(1, Math.floor((w - 2 * wn.m + wn.gx) / cw));
    const x0 = Math.round(x + (w - (cols * cw - wn.gx)) / 2);
    for (let row = 0; ; row++) {
      const y = top + wn.m + row * ch;
      if (y > bottom - wn.h) break;
      const rowBoost = R(row, 91) < 0.08 ? 0.75 : 0;
      for (let col = 0; col < cols; col++) {
        const h = R(row * 131 + col, 5);
        const wx = x0 + col * cw;
        if (h < b.lit + rowBoost) {
          c.fillStyle = pickW(wn.colors, R(row, col + 500));
          c.fillRect(wx, y, wn.w, wn.h);
        } else if (out && h > 1 - (wn.flicker || 0.025)) {
          out.flicker.push({ x: wx, y, w: wn.w, h: wn.h, c: pickW(wn.colors, R(row, col + 700)), rate: 0.4 + R(row, col + 900) * 1.8, ph: R(row, col + 1100) * 10 });
        }
      }
    }
  }
  function makeSkyline(o) {
    const r = MV.rng(o.seed);
    const list = [];
    let x = 0, i = 0;
    while (x < o.w) {
      const bw = Math.round(r.range(o.bw[0], o.bw[1]));
      let top = r.range(o.top[0], o.top[1]);
      const type = o.types[Math.floor(r.next() * o.types.length)];
      if (r.chance(o.tower || 0)) top -= r.range(40, 140);
      list.push({ x: Math.round(x), w: bw, top: Math.round(Math.max(24, top)), type, seed: MV.hash32(o.seed, i++), lit: r.range(o.lit[0], o.lit[1]) });
      x += bw + Math.round(r.range(o.gap[0], o.gap[1]));
    }
    // Recorded once as vector ops (one tile; drawStripOps repeats it). Colours
    // are palette slots ('@body', '@board', '@w0'…), resolved when drawn.
    const out = { beacons: [], flicker: [] };
    let over = 0;
    const ops = record((c) => {
      for (const b of list) {
        paintBuilding(c, b, b.x, o, out);
        over = Math.max(over, b.x + b.w + 40 - o.w);
      }
    });
    out.flicker.forEach((f) => (f.x = mod(f.x, o.w)));
    out.beacons.forEach((f) => (f.x = mod(f.x, o.w)));
    return { ops, beacons: out.beacons, flicker: out.flicker, w: o.w, over };
  }
  // Skyline window slots with fixed weights (shared by every palette).
  const WIN3 = [['@w0', 3], ['@w1', 2], ['@w2', 1]];
  const WIN2 = [['@w0', 3], ['@w1', 1]];
  function drawFlicker(ctx, L, off, y0, t, seed, B, I, pal) {
    const list = L.flicker, sw = L.w;
    const x0 = stripX0(off, sw);
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const x = mod(f.x + x0 + OV, sw) - OV;
      if (x > W + OV) continue;
      const on = rand(seed, i, Math.floor(t * f.rate + f.ph)) < 0.42 || (B.pulse > 0.35 && rand(seed, i, B.index) < 0.1 + 0.2 * I);
      if (!on) continue;
      ctx.fillStyle = pal && f.c.charCodeAt(0) === 64 ? pal[f.c] : f.c;
      ctx.fillRect(x, y0 + f.y, f.w, f.h);
    }
  }
  function drawBeacons(ctx, L, off, y0, t, color) {
    const x0 = stripX0(off, L.w);
    ctx.fillStyle = color;
    for (let i = 0; i < L.beacons.length; i++) {
      const b = L.beacons[i];
      if (fract(t * 0.55 + i * 0.37) > 0.45) continue;
      const x = mod(b.x + x0 + OV, L.w) - OV;
      if (x > W + OV) continue;
      ctx.fillRect(x - 3, y0 + b.y - 3, 6, 6);
    }
  }

  /* ---------------- Utility poles, wires, birds ------------------------- */
  // Wire attach points: [dx, dy, sagFactor, lineWidth]
  const POLE_ATTACH = [
    [-138, 16, 1.0, 3], [-62, 16, 1.05, 3], [62, 16, 1.0, 3], [138, 16, 0.95, 3],
    [-112, 76, 1.2, 3], [112, 76, 1.25, 3], [26, 250, 1.7, 7],
  ];
  function poleShape(ctx, x, top, bottom, s) {
    const pw = 22 * s;
    ctx.fillRect(x - pw / 2, top, pw, bottom - top);
    ctx.fillRect(x - pw * 0.35, top - 10 * s, pw * 0.7, 12 * s);
    ctx.fillRect(x - 152 * s, top + 30 * s, 304 * s, 11 * s);
    ctx.fillRect(x - 124 * s, top + 90 * s, 248 * s, 10 * s);
    // braces
    ctx.beginPath();
    ctx.moveTo(x - 70 * s, top + 41 * s); ctx.lineTo(x - 62 * s, top + 41 * s); ctx.lineTo(x, top + 78 * s); ctx.lineTo(x, top + 86 * s); ctx.closePath();
    ctx.moveTo(x + 70 * s, top + 41 * s); ctx.lineTo(x + 62 * s, top + 41 * s); ctx.lineTo(x, top + 78 * s); ctx.lineTo(x, top + 86 * s); ctx.closePath();
    ctx.fill();
    for (let k = 0; k < 4; k++) {
      const dx = POLE_ATTACH[k][0] * s;
      ctx.fillRect(x + dx - 5 * s, top + 14 * s, 10 * s, 16 * s);
    }
    for (let k = 4; k < 6; k++) {
      const dx = POLE_ATTACH[k][0] * s;
      ctx.fillRect(x + dx - 5 * s, top + 74 * s, 10 * s, 16 * s);
    }
    // transformer drum
    roundRectPath(ctx, x + pw / 2 + 2 * s, top + 140 * s, 48 * s, 78 * s, 8 * s);
    ctx.fill();
    ctx.fillRect(x + pw / 2 + 8 * s, top + 128 * s, 6 * s, 14 * s);
    ctx.fillRect(x + pw / 2 + 34 * s, top + 128 * s, 6 * s, 14 * s);
    // cable box + sign plate + step bolts
    ctx.fillRect(x - pw / 2 - 30 * s, top + 262 * s, 30 * s, 44 * s);
    ctx.fillRect(x - pw / 2 - 5 * s, top + 360 * s, pw + 10 * s, 64 * s);
    for (let k = 0, y = top + 440 * s; y < bottom; k++, y += 46 * s) {
      ctx.fillRect(k % 2 ? x + pw / 2 : x - pw / 2 - 12 * s, y, 12 * s, 5 * s);
    }
  }
  // Adds one flying-crow subpath (caller fills). flap −1 (wings up) … 1 (down).
  function birdPath(ctx, x, y, s, flap, dir) {
    const X = (u) => x + u * s * dir, Y = (v) => y + v * s;
    // body: beak → head → back → wedge tail → belly
    ctx.moveTo(X(1.3), Y(0.02));
    ctx.lineTo(X(1.02), Y(-0.1));
    ctx.quadraticCurveTo(X(0.9), Y(-0.26), X(0.62), Y(-0.2));
    ctx.quadraticCurveTo(X(0.1), Y(-0.24), X(-0.55), Y(-0.1));
    ctx.lineTo(X(-1.25), Y(-0.24));
    ctx.lineTo(X(-1.1), Y(0.02));
    ctx.lineTo(X(-1.25), Y(0.26));
    ctx.lineTo(X(-0.55), Y(0.13));
    ctx.quadraticCurveTo(X(0.2), Y(0.28), X(0.95), Y(0.12));
    ctx.closePath();
    // wing with fingered primaries; up-stroke reaches higher than the down-stroke
    const th = flap < 0 ? flap * 1.35 : flap * 0.9;
    const L = 1.7;
    const ty = Math.sin(th) * L, tx = -0.15 - 0.35 * Math.abs(Math.sin(th));
    const k = ty >= 0 ? 1 : -1;
    ctx.moveTo(X(0.36), Y(-0.08));
    ctx.quadraticCurveTo(X(0.32), Y(ty * 0.6), X(tx + 0.12), Y(ty));
    ctx.lineTo(X(tx - 0.02), Y(ty + k * 0.02));
    ctx.lineTo(X(tx - 0.02), Y(ty * 0.86));
    ctx.lineTo(X(tx - 0.16), Y(ty * 0.9));
    ctx.lineTo(X(tx - 0.1), Y(ty * 0.74));
    ctx.lineTo(X(tx - 0.26), Y(ty * 0.76));
    ctx.lineTo(X(tx - 0.18), Y(ty * 0.6));
    ctx.quadraticCurveTo(X(-0.3), Y(ty * 0.3), X(-0.32), Y(0.02));
    ctx.closePath();
  }
  // Perched crow on a wire (feet at x,y).
  function perchPath(ctx, x, y, s, dir) {
    const X = (u) => x + u * s * dir, Y = (v) => y + v * s;
    ctx.moveTo(X(0.52), Y(-1.02));
    ctx.lineTo(X(0.95), Y(-1.12));
    ctx.lineTo(X(0.56), Y(-1.22));
    ctx.quadraticCurveTo(X(0.35), Y(-1.58), X(0.08), Y(-1.28));
    ctx.quadraticCurveTo(X(-0.28), Y(-0.9), X(-0.4), Y(-0.45));
    ctx.lineTo(X(-0.95), Y(0.28));
    ctx.lineTo(X(-0.78), Y(0.34));
    ctx.lineTo(X(-0.2), Y(-0.1));
    ctx.quadraticCurveTo(X(0.3), Y(-0.05), X(0.45), Y(-0.55));
    ctx.closePath();
    ctx.rect(X(dir > 0 ? -0.02 : -0.06), Y(-0.12), 0.08 * s, 0.14 * s);
  }
  function drawPoles(ctx, off, seed, o, B) {
    const sp = o.spacing, s = o.scale || 1;
    const j0 = Math.floor((off - OV - 500) / sp) - 1, j1 = Math.ceil((off + W + OV + 500) / sp) + 1;
    const poles = [];
    for (let j = j0; j <= j1; j++) {
      poles.push({ j, x: j * sp + srand(seed, j, 31) * sp * 0.15 - off, top: o.top + rand(seed, j, 32) * 70 });
    }
    ctx.strokeStyle = o.color;
    const perches = [];
    for (let lw = 3; lw <= 7; lw += 4) {
      ctx.lineWidth = lw * s;
      ctx.beginPath();
      for (let k = 0; k < poles.length - 1; k++) {
        const a = poles[k], b = poles[k + 1];
        if (b.x < -OV - 400 || a.x > W + OV + 400) continue;
        for (let n = 0; n < POLE_ATTACH.length; n++) {
          const at = POLE_ATTACH[n];
          if (at[3] !== lw) continue;
          const x0 = a.x + at[0] * s, y0 = a.top + at[1] * s, x1 = b.x + at[0] * s, y1 = b.top + at[1] * s;
          const sag = (50 + rand(seed, a.j, 40) * 45) * at[2] * s;
          const qx = (x0 + x1) / 2, qy = (y0 + y1) / 2 + sag * 2;
          ctx.moveTo(x0, y0);
          ctx.quadraticCurveTo(qx, qy, x1, y1);
          if (o.birds && n < 4) {
            const cnt = Math.floor(rand(seed, a.j * 7 + n, 50) * 2.4);
            for (let m = 0; m < cnt; m++) {
              const u = 0.18 + 0.64 * rand(seed, a.j * 7 + n, 60 + m);
              const px = (1 - u) * (1 - u) * x0 + 2 * u * (1 - u) * qx + u * u * x1;
              const py = (1 - u) * (1 - u) * y0 + 2 * u * (1 - u) * qy + u * u * y1;
              perches.push([px, py, rand(seed, a.j * 13 + n * 3 + m, B.bar) < 0.5 ? -1 : 1, 13 + 5 * rand(seed, a.j, 70 + m)]);
            }
          }
        }
      }
      ctx.stroke();
    }
    ctx.fillStyle = o.color;
    for (const pl of poles) if (pl.x > -OV - 200 && pl.x < W + OV + 200) poleShape(ctx, pl.x, pl.top, H + OV, s);
    if (perches.length) {
      ctx.beginPath();
      for (const pc of perches) perchPath(ctx, pc[0], pc[1] - 1, pc[3] * s, pc[2]);
      ctx.fill();
    }
  }
  function drawFlocks(ctx, tau, seed, I, color, yr, sr, q) {
    const Ls = 5.5;
    const k0 = Math.floor(tau / Ls);
    ctx.fillStyle = color;
    for (let k = k0 - 2; k <= k0; k++) {
      if (rand(seed, k, 11) > 0.3 + 0.5 * I) continue;
      const t0 = k * Ls + rand(seed, k, 12) * Ls * 0.6;
      const dt = tau - t0;
      if (dt < 0) continue;
      const dir = rand(seed, k, 13) < 0.5 ? -1 : 1;
      const v = 230 + rand(seed, k, 14) * 240;
      const n = Math.max(2, Math.round((3 + Math.floor(rand(seed, k, 15) * 6)) * (q || 1)));
      const y0 = lerp(yr[0], yr[1], rand(seed, k, 16));
      const s0 = lerp(sr[0], sr[1], rand(seed, k, 17));
      const lead = dir > 0 ? -220 + v * dt : W + 220 - v * dt;
      if ((dir > 0 && lead - 900 > W + OV) || (dir < 0 && lead + 900 < -OV)) continue;
      ctx.beginPath();
      for (let b = 0; b < n; b++) {
        const bx = lead - dir * (b * s0 * 3.6 + rand(seed, k, b + 20) * s0 * 4);
        const by = y0 + srand(seed, k, b + 40) * 70 + Math.sin(tau * 1.3 + b) * 8 - dir * (bx - lead) * 0.08;
        const s = s0 * (0.75 + 0.5 * rand(seed, k, b + 60));
        birdPath(ctx, bx, by, s, Math.sin(tau * (8 + b * 0.7) + b * 1.7), dir);
      }
      ctx.fill();
    }
  }

  /* ---------------- Halftone texture helper ----------------------------- */
  // One quadrant of a radial halftone (45° screen anchored on the centre, so
  // it mirrors seamlessly), dots shrinking to nothing at QUAD.R — a quarter of
  // the memory of a full disc. (sx, sy) bakes the direction the quadrant points
  // to (the centre sits in the matching corner), so corner halftones are plain
  // blits; the full radial halftone mirrors the (+, +) one. Shared by shards,
  // stripes and void.
  const QUAD = { R: 842, cell: 24 };
  const quadCache = new Map();
  function radialQuad(color, sx, sy) {
    sx = sx < 0 ? -1 : 1;
    sy = sy < 0 ? -1 : 1;
    const key = color + '|' + sx + '|' + sy;
    if (!quadCache.has(key)) {
      const R = QUAD.R;
      const cv = attributed('shared', () => sprite(R, R, (c) => {
        const h = QUAD.cell / Math.SQRT2;
        c.fillStyle = color;
        c.beginPath();
        for (let m = 0; m * h < R + QUAD.cell; m++) {
          for (let n = m & 1; n * h < R + QUAD.cell; n += 2) {
            const x = m * h, y = n * h;
            const r = 1.05 * clamp(1 - Math.hypot(x, y) / R) * QUAD.cell * 0.62;
            if (r < 0.4) continue;
            const px = sx > 0 ? x : R - x, py = sy > 0 ? y : R - y;
            c.moveTo(px + r, py);
            c.arc(px, py, r, 0, TAU);
          }
        }
        c.fill();
      }));
      cv.qsx = sx;
      cv.qsy = sy;
      quadCache.set(key, cv);
    }
    return quadCache.get(key);
  }
  // A baked quadrant with its centre at (x, y): a plain blit.
  function drawCorner(ctx, img, x, y) {
    ctx.drawImage(img, Math.round(x) - (img.qsx < 0 ? QUAD.R : 0), Math.round(y) - (img.qsy < 0 ? QUAD.R : 0));
  }
  // Draws the (+, +) quadrant with its centre at (x, y), mirrored to point
  // along (sx, sy) = ±1.
  function drawQuad(ctx, img, x, y, sx, sy) {
    x = Math.round(x);
    y = Math.round(y);
    if (sx > 0 && sy > 0) {
      ctx.drawImage(img, x, y);
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, sy);
    // With an unscaled, unrotated target a mirror at integer offsets is an
    // exact pixel copy: skip filtering (much cheaper in software raster). Any
    // camera zoom / rotation keeps normal smoothing.
    try {
      const m = ctx.getTransform();
      if (!m.b && !m.c && Math.abs(m.a) === 1 && Math.abs(m.d) === 1 && m.e === Math.round(m.e) && m.f === Math.round(m.f)) ctx.imageSmoothingEnabled = false;
    } catch (e) {
      /* getTransform unsupported: keep smoothing */
    }
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }
  function drawRadialHalftone(ctx, img, x, y) {
    drawQuad(ctx, img, x, y, 1, 1);
    drawQuad(ctx, img, x, y, -1, 1);
    drawQuad(ctx, img, x, y, 1, -1);
    drawQuad(ctx, img, x, y, -1, -1);
  }
  // Vertical halftone ramps as repeating patterns: a 45° screen repeats every
  // cell·√2 horizontally, so a narrow tile replaces a full-width sprite
  // (a few KB instead of ~8 MB, and an axis-aligned pattern fill is cheap).
  // spec: [cell, height, color, fnV(v) → 0..1 dot size, v = 0 top … 1 bottom]
  const RAMPS = {
    'nc-sky-red': [22, 900, C.black, (v) => 1.08 * Math.pow(clamp(1 - v * 1.3), 1.7)],
    'nc-sky-navy': [22, 900, C.night, (v) => 1.08 * Math.pow(clamp(1 - v * 1.3), 1.7)],
    'crowd-red': [22, 640, C.black, (v) => 1.05 * Math.pow(clamp(1 - v * 1.2), 1.6)],
    'crowd-night': [20, 700, C.night, (v) => 1.05 * Math.pow(clamp(1 - v * 1.2), 1.5)],
    'skyred-top': [24, 700, C.black, (v) => 1.1 * Math.pow(clamp(1 - v * 1.15), 1.5)],
    'skyred-hz': [14, 300, C.redHot, (v) => 0.9 * v],
    'train-sky': [14, 560, C.navy, (v) => 0.25 + 0.85 * v],
  };
  const rampTiles = new Map();
  const rampPats = new WeakMap();
  function rampTile(key) {
    let tile = rampTiles.get(key);
    if (tile) return tile;
    const [cell, h, color, fnV] = RAMPS[key];
    const P = Math.round(cell * Math.SQRT2), half = P / 2;
    tile = cpuSprite(P, h, (c) => {
      c.fillStyle = color;
      c.beginPath();
      for (let y = 0, row = 0; y < h + half; y += half, row++) {
        const r = clamp(fnV(y / h)) * cell * 0.62;
        if (r < 0.4) continue;
        const xs = row % 2 ? [half] : [0, P];
        for (const x of xs) {
          c.moveTo(x + r, y);
          c.arc(x, y, r, 0, TAU);
        }
      }
      c.fill();
    });
    rampTiles.set(key, tile);
    return tile;
  }
  function rampPattern(ctx, key) {
    let m = rampPats.get(ctx);
    if (!m) rampPats.set(ctx, (m = new Map()));
    let pat = m.get(key);
    if (!pat) {
      // 'repeat' (not 'repeat-x'): fills are exactly one tile tall, and Skia's
      // mixed repeat/clamp path is ~8× slower in software raster.
      pat = ctx.createPattern(rampTile(key), 'repeat');
      m.set(key, pat);
    }
    return pat;
  }
  function fillRamp(ctx, key, y) {
    ctx.save();
    ctx.translate(-OVS, y);
    ctx.fillStyle = rampPattern(ctx, key);
    ctx.fillRect(0, 0, W + OVS * 2, RAMPS[key][1]);
    ctx.restore();
  }
  // Static star dust drawn per frame as one path (positions from a seed).
  const dustCache = new Map();
  function dustList(seed, n, x0, x1, y0, y1, s0, s1) {
    const key = [seed, n, x0, x1, y0, y1, s0, s1].join('|');
    let l = dustCache.get(key);
    if (!l) {
      const r = MV.rng(seed);
      l = [];
      for (let i = 0; i < n; i++) l.push([r.range(x0, x1), r.range(y0, y1), r.range(s0, s1)]);
      dustCache.set(key, l);
    }
    return l;
  }
  function drawDust(ctx, list, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      ctx.rect(d[0], d[1], d[2], d[2]);
    }
    ctx.fill();
  }
  function starDust(c, seed, w, h, n, color, sizes, yMax) {
    const r = MV.rng(seed);
    c.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const x = r.range(0, w), y = r.range(0, h * (yMax || 1));
      const s = r.range(sizes[0], sizes[1]);
      c.globalAlpha = r.range(0.3, 1);
      c.fillRect(x, y, s, s);
    }
    c.globalAlpha = 1;
  }

  /* ================================================================== */
  /* 1. NIGHT-CITY                                                       */
  /* ================================================================== */
  const NC = { SW: 2880, farY: 250, farH: 620, midY: 470, midH: 480, nearY: 650, nearH: 440 };
  // Skyline geometry (one recording per layer, shared by both palettes).
  const NC_LAYERS = {
    far: { seed: 4101, w: NC.SW, h: NC.farH, top: [120, 400], bw: [50, 170], gap: [-6, 10], tower: 0.1, lit: [0.03, 0.16], types: [0, 1, 1, 2, 3, 4, 5, 6], color: '@body', win: { w: 5, h: 7, gx: 6, gy: 8, m: 9, colors: WIN2, flicker: 0 }, board: null },
    mid: { seed: 4102, w: NC.SW, h: NC.midH, top: [110, 330], bw: [70, 210], gap: [-4, 14], tower: 0.06, lit: [0.05, 0.28], types: [0, 1, 2, 3, 5, 6, 0], color: '@body', win: { w: 8, h: 10, gx: 8, gy: 10, m: 10, colors: WIN3, flicker: 0.02 }, board: '@board' },
    near: { seed: 4103, w: NC.SW, h: NC.nearH, top: [90, 290], bw: [110, 280], gap: [-2, 30], tower: 0, lit: [0.04, 0.22], types: [0, 2, 3, 5, 0, 2], color: '@body', win: { w: 14, h: 16, gx: 12, gy: 16, m: 16, colors: WIN3, flicker: 0.03 }, board: '@board' },
  };
  const skylineCache = new Map();
  function sharedSkyline(key) {
    if (!skylineCache.has(key)) skylineCache.set(key, attributed('shared', () => makeSkyline(NC_LAYERS[key])));
    return skylineCache.get(key);
  }
  const NC_PALS = {
    red: {
      sky: C.red, skyKey: 'nc-sky-red', moon: 'red', orbit: C.black, rings: C.redDeep, pulse: C.star, beacon: C.white,
      far: { '@body': C.redDeep, '@w0': C.redHot, '@w1': C.white },
      mid: { '@body': C.blood, '@board': C.white, '@w0': C.white, '@w1': C.star, '@w2': C.yellow },
      near: { '@body': C.black, '@board': C.white, '@w0': C.white, '@w1': C.red, '@w2': C.yellow },
    },
    navy: {
      sky: C.navy, skyKey: 'nc-sky-navy', moon: 'navy', orbit: C.red, rings: mix(C.navy, C.star, 0.1), pulse: C.star, beacon: C.red,
      far: { '@body': mix(C.navy, C.night, 0.55), '@w0': C.star, '@w1': C.cyan },
      mid: { '@body': C.night, '@board': C.red, '@w0': C.star, '@w1': C.yellow, '@w2': C.red },
      near: { '@body': C.black, '@board': C.red, '@w0': C.star, '@w1': C.red, '@w2': C.yellow },
    },
  };
  function buildNightCity() {
    rampTile('nc-sky-red');
    rampTile('nc-sky-navy');
    return {
      far: sharedSkyline('far'), mid: sharedSkyline('mid'), near: sharedSkyline('near'),
      moon: { red: moonSprite('red'), navy: moonSprite('navy') },
    };
  }
  // Cream halftone moons, shared by night-city / crowd / sky-red. Always a
  // shaded, cratered moon — never a plain disc (no sun imagery anywhere).
  const MOONS = {
    red: { disc: C.star, dots: C.black, ring: C.black, shadow: C.black },
    navy: { disc: C.star, dots: C.navy, ring: null, shadow: C.red },
  };
  const MOON_R = 280; // one size for every scene: two sprites in total
  const moonCache = new Map();
  function moonSprite(kind) {
    if (!moonCache.has(kind)) moonCache.set(kind, attributed('shared', () => makeMoon(MOON_R, MOONS[kind])));
    return moonCache.get(kind);
  }
  function makeMoon(r, P) {
    const pad = 22, S = 2 * r + 2 * pad;
    return sprite(S, S, (c) => {
      const cx = S / 2 - 6, cy = S / 2 - 6;
      c.fillStyle = P.shadow;
      circle(c, cx + 14, cy + 14, r);
      c.fill();
      c.fillStyle = P.disc;
      circle(c, cx, cy, r);
      c.fill();
      c.save();
      circle(c, cx, cy, r);
      c.clip();
      D.halftone(c, cx - r, cy - r, 2 * r, 2 * r, {
        cell: 15, angle: 35 * DEG, color: P.dots,
        fn: (u, v) => clamp((Math.hypot(u - 0.82, v - 0.2) - 0.52) * 2.1),
      });
      // flat craters
      c.fillStyle = rgba(P.dots, 0.22);
      const cr = [[0.35, 0.4, 0.13], [0.55, 0.62, 0.08], [0.62, 0.3, 0.06], [0.3, 0.7, 0.07], [0.72, 0.5, 0.05]];
      for (const k of cr) {
        circle(c, cx - r + k[0] * 2 * r, cy - r + k[1] * 2 * r, k[2] * 2 * r);
        c.fill();
      }
      c.restore();
      if (P.ring) {
        c.lineWidth = 10;
        c.strokeStyle = P.ring;
        circle(c, cx, cy, r - 5);
        c.stroke();
      }
    });
  }
  // Moon sprites are centred on (S/2 − 6, S/2 − 6) (room for the drop shadow).
  function drawMoon(ctx, img, x, y) {
    ctx.drawImage(img, Math.round(x - img.width / 2 + 6), Math.round(y - img.height / 2 + 6));
  }
  // Concentric jagged rings around (cx, cy) — the replacement for the old
  // radial rays: rings, never wedges. Fixed radii (r0 + j·gap), slowly counter-
  // rotating, kicking outward on the beat and fading with distance.
  function shockRings(ctx, cx, cy, B, seed, o) {
    const n = o.n || 3;
    ctx.fillStyle = o.color;
    for (let j = 0; j < n; j++) {
      const r = o.r0 + j * o.gap + o.kick * (j + 1) * B.pulse;
      const a = o.alpha * (1 - j / (n + 0.5));
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      const hw = (o.lw * (1 - 0.25 * j)) / 2;
      const spikes = Math.round((TAU * (o.r0 + j * o.gap)) / o.tooth);
      const rot = (j & 1 ? -1 : 1) * o.rot * (1 + 0.3 * j);
      // the jagged line as an even-odd band (two offset outlines): cheaper than a stroke
      const path = new Path2D();
      for (const d of [-hw, hw]) {
        const rr = r + d;
        const pts = [];
        for (let i = 0; i < spikes * 2; i++) {
          const rad = (i % 2 ? rr - o.amp : rr + o.amp) + srand(seed + j, i) * o.amp * 0.5;
          const ang = rot + (i / (spikes * 2)) * TAU + srand(seed + j, i, 7) * (Math.PI / spikes) * 0.35;
          pts.push(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
        }
        path.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);
        path.closePath();
      }
      ctx.fill(path, 'evenodd');
    }
    ctx.globalAlpha = 1;
  }
  // Smooth, broken orbit arcs around a moon (a lunar halo, never a corona or
  // rays): three concentric segments turning at different speeds, kicking out
  // on the beat.
  function haloArcs(ctx, cx, cy, r0, gap, B, tau, color, alpha, lw) {
    ctx.strokeStyle = color;
    ctx.lineCap = 'butt';
    for (let j = 0; j < 3; j++) {
      const r = r0 + j * gap + (6 + 6 * j) * B.pulse;
      const a0 = tau * (0.07 + 0.05 * j) * (j & 1 ? -1 : 1) + j * 2.1;
      ctx.globalAlpha = alpha * (1 - j * 0.25);
      ctx.lineWidth = lw * (1 - j * 0.25);
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a0 + 2.2 + 0.5 * j);
      ctx.moveTo(cx + Math.cos(a0 + 3.2) * r, cy + Math.sin(a0 + 3.2) * r);
      ctx.arc(cx, cy, r, a0 + 3.2, a0 + 4.1 + 0.4 * j);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function drawNightCity(ctx, env, p, K) {
    const B = beatOf(env), I = p.intensity, v = p.variant, q = env.quality || 1;
    const redSky = I >= 0.5 ? v % 3 !== 2 : v % 3 === 2;
    const P = redSky ? NC_PALS.red : NC_PALS.navy;
    const tau = p.lt * p.speed + rand(p.seed, 1) * 400;
    const pan = tau * (16 + 34 * I);
    fillAll(ctx, P.sky);
    fillRamp(ctx, P.skyKey, -OV);
    if (!redSky) {
      drawDust(ctx, dustList(71, 260, -OV, W + OV, -OV, 560, 1, 2.6), C.star);
      ctx.fillStyle = C.star;
      ctx.beginPath();
      for (const d of dustList(72, 16, 0, W, 20, 480, 5, 12)) D.sparkle(ctx, d[0], d[1], d[2], 0.2, 0);
      ctx.fill();
    }
    const mx = Math.round(1100 + rand(p.seed, 2) * 460), my = Math.round(230 + rand(p.seed, 3) * 110);
    if (I > 0.4) {
      haloArcs(ctx, mx, my, MOON_R + 130, 70, B, tau, P.rings, clamp((I - 0.4) * 2.5) * (redSky ? 0.9 : 0.7), 10);
    }
    // orbit arcs around the moon (rotating slowly, kick on the downbeat)
    ctx.strokeStyle = P.orbit;
    const orb = tau * 0.12 + 0.25 * E.outBack(clamp(B.sinceDownbeat / 0.3));
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(mx, my, MOON_R + 50 + 10 * B.barPulse, orb, orb + 4.1);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(mx, my, MOON_R + 82 + 16 * B.barPulse, -orb * 1.3 + 1, -orb * 1.3 + 3.6);
    ctx.stroke();
    drawMoon(ctx, K.moon[P.moon], mx, my);
    if (B.barPulse > 0.02) {
      ctx.globalAlpha = B.barPulse * 0.7;
      ctx.strokeStyle = P.pulse;
      ctx.lineWidth = 6;
      circle(ctx, mx, my, MOON_R + 12 + (1 - B.barPulse) * 150);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // parallax skyline layers (vector); each is backed by a solid fill below it
    drawStripOps(ctx, K.far, pan * 0.18, NC.farY, P.far);
    ctx.fillStyle = P.far['@body'];
    ctx.fillRect(-OVF, NC.farY + NC.farH - 1, W + OVF * 2, OVF);
    drawBeacons(ctx, K.far, pan * 0.18, NC.farY, env.t, P.beacon);
    drawFlocks(ctx, tau, p.seed, I, C.black, [110, 460], [16, 30], q);
    drawStripOps(ctx, K.mid, pan * 0.4, NC.midY, P.mid);
    ctx.fillStyle = P.mid['@body'];
    ctx.fillRect(-OVF, NC.midY + NC.midH - 1, W + OVF * 2, OVF);
    drawBeacons(ctx, K.mid, pan * 0.4, NC.midY, env.t + 0.4, P.beacon);
    drawFlicker(ctx, K.mid, pan * 0.4, NC.midY, env.t, p.seed, B, I, P.mid);
    drawStripOps(ctx, K.near, pan * 0.75, NC.nearY, P.near);
    drawFlicker(ctx, K.near, pan * 0.75, NC.nearY, env.t, p.seed + 1, B, I, P.near);
    ctx.fillStyle = P.near['@body'];
    ctx.fillRect(-OVF, NC.nearY + NC.nearH - 1, W + OVF * 2, OVF);
    drawPoles(ctx, pan * 1.3, p.seed, { spacing: 1250, top: 70, color: C.black, birds: true, scale: 1 }, B);
  }

  /* ================================================================== */
  /* 2. TRAIN                                                            */
  /* ================================================================== */
  const TR = { U: 1000, units: 2, wx0: 140, wx1: 860, wy0: 282, wy1: 640, rodY: 150, strap: 125, adW: 290, adH: 76 };
  function buildTrain() {
    const K = {};
    // dense, fast-scrolling distant city (seen through the windows): a sprite
    K.city = makeSkyline({ seed: 5201, w: 2880, h: 380, top: [70, 250], bw: [40, 150], gap: [-4, 12], tower: 0.1, lit: [0.12, 0.35], types: [0, 1, 2, 4, 5, 6], color: mix(C.navy, C.night, 0.35), win: { w: 5, h: 6, gx: 5, gy: 7, m: 6, colors: [[C.star, 3], [C.yellow, 1], [C.red, 1]], flicker: 0 }, board: C.red });
    K.cityImg = stripSprite(K.city, 380);
    rampTile('train-sky');
    // the four ad cards are small sprites shared by both interiors
    K.ads = [0, 1, 2, 3].map((kind) => sprite(TR.adW, TR.adH, (c) => trainAd(c, 0, 0, TR.adW, TR.adH, kind)));
    K.intRed = paintInterior({ wall: C.red, trim: C.black, ceil: C.black, lamp: C.paper, seat: C.black, seatHi: C.redDeep, rim: null, strapBelt: C.black, seed: 11, ads: K.ads });
    K.intBlack = paintInterior({ wall: C.black, trim: C.red, ceil: C.gray, lamp: C.star, seat: C.redDeep, seatHi: C.red, rim: C.red, strapBelt: C.gray, seed: 12, ads: K.ads });
    return K;
  }
  // Ad card art (no text, no logos); the frame is stroked by the interior.
  function trainAd(c, x, y, w, h, kind) {
    c.fillStyle = C.paper;
    c.fillRect(x, y, w, h);
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    if (kind === 0) {
      c.fillStyle = C.red;
      D.skewRect(c, x + w * 0.06, y + h * 0.12, w * 0.36, h * 0.76, h * 0.3);
      c.fill();
      c.fillStyle = C.black;
      D.star(c, x + w * 0.27, y + h * 0.5, h * 0.26, h * 0.11);
      c.fill();
      for (let i = 0; i < 4; i++) c.fillRect(x + w * 0.55, y + 14 + i * 15, w * (0.35 - i * 0.05), 7);
    } else if (kind === 1) {
      c.fillStyle = C.black;
      c.fillRect(x, y, w * 0.45, h);
      c.fillStyle = C.red;
      D.star(c, x + w * 0.22, y + h * 0.52, h * 0.36, h * 0.16);
      c.fill();
      c.fillStyle = C.black;
      for (let i = 0; i < 3; i++) c.fillRect(x + w * 0.52, y + 16 + i * 18, w * 0.4, 8);
    } else if (kind === 2) {
      c.fillStyle = C.red;
      c.beginPath();
      c.moveTo(x, y + h);
      c.lineTo(x + w * 0.62, y);
      c.lineTo(x + w, y);
      c.lineTo(x + w, y + h * 0.3);
      c.lineTo(x + w * 0.3, y + h);
      c.closePath();
      c.fill();
      D.halftone(c, x, y, w * 0.6, h, { cell: 9, color: C.black, fn: (u) => 0.9 - u });
    } else {
      drawEmblem(c, x + w * 0.2, y + h * 0.5, h * 0.36, 0, { star: C.red, slash: C.white, outline: C.black, gap: C.paper, lw: 3 });
      c.fillStyle = C.black;
      c.fillRect(x + w * 0.42, y + 18, w * 0.5, 14);
      c.fillRect(x + w * 0.42, y + 42, w * 0.34, 8);
    }
    c.restore();
  }
  // Seated, faceless passenger (front view). Cushion top at y=800.
  function seatedFigure(c, x, kind, fill) {
    c.fillStyle = fill;
    c.strokeStyle = fill;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const sleep = kind === 1;
    circle(c, x + (sleep ? 16 : 0), sleep ? 536 : kind === 0 ? 532 : 522, 36);
    c.fill();
    c.fillRect(x - 14, 548, 28, 34);
    roundRectPath(c, x - 80, 572, 160, 96, 34);
    c.fill();
    D.polygon(c, [[x - 74, 620], [x + 74, 620], [x + 64, 796], [x - 64, 796]]);
    c.fill();
    roundRectPath(c, x - 74, 784, 148, 66, 18);
    c.fill();
    circle(c, x - 38, 848, 26);
    c.fill();
    circle(c, x + 38, 848, 26);
    c.fill();
    c.fillRect(x - 62, 846, 48, 94);
    c.fillRect(x + 14, 846, 48, 94);
    roundRectPath(c, x - 68, 928, 60, 24, 9);
    c.fill();
    roundRectPath(c, x + 8, 928, 60, 24, 9);
    c.fill();
    c.lineWidth = 30;
    c.beginPath();
    if (kind === 0) {
      // holding a phone at the chest
      c.moveTo(x - 64, 600); c.lineTo(x - 70, 744); c.lineTo(x - 18, 724);
      c.moveTo(x + 64, 600); c.lineTo(x + 70, 744); c.lineTo(x + 18, 724);
    } else {
      c.moveTo(x - 66, 600); c.lineTo(x - 74, 730); c.lineTo(x - 40, 800);
      c.moveTo(x + 66, 600); c.lineTo(x + 74, 730); c.lineTo(x + 40, 800);
    }
    c.stroke();
    if (kind === 2) {
      roundRectPath(c, x - 60, 736, 120, 78, 10);
      c.fill();
      c.lineWidth = 8;
      c.beginPath();
      c.arc(x, 736, 30, Math.PI, 0);
      c.stroke();
    }
  }
  // Seated passengers are small detail sprites (cheaper to blit than to fill
  // their many overlapping round shapes every frame). Figure x = 0 ↦ sprite x 100.
  const passengerCache = new Map();
  function passengerSprite(kind, rim) {
    const key = kind + '|' + (rim || '');
    if (!passengerCache.has(key)) {
      passengerCache.set(key, sprite(200, 480, (c) => {
        c.translate(100, -480);
        if (rim) seatedFigure(c, 5, kind, rim);
        seatedFigure(c, 0, kind, C.black);
        if (kind === 0) {
          c.fillStyle = C.white;
          c.fillRect(-11, 700, 22, 30);
        }
      }));
    }
    return passengerCache.get(key);
  }
  // Train interior, recorded as vector ops per window bay (unit): only the
  // bays on screen are replayed. Elements are grouped into layers (bays never
  // overlap themselves, so one layer per element keeps the paint order).
  function paintInterior(o) {
    const U = TR.U, NU = TR.units;
    const winW = TR.wx1 - TR.wx0, winH = TR.wy1 - TR.wy0;
    const units = [];
    for (let u = 0; u < NU; u++) {
      const ops = record((c) => {
        let L = 0;
        // wall with the window opening (even-odd); ceiling, seat base and floor
        // cover the rest, so only the band between them is filled
        c.layer = L++;
        c.fillStyle = o.wall;
        c.beginPath();
        c.rect(0, 118, U, 862 - 118);
        roundRectPath(c, TR.wx0, TR.wy0, winW, winH, 34, true);
        c.fill('evenodd');
        c.layer = L++;
        c.fillStyle = o.trim;
        c.beginPath();
        roundRectRing(c, TR.wx0, TR.wy0, winW, winH, 34, 20);
        c.fill('evenodd');
        c.layer = L++;
        c.fillStyle = C.gray;
        c.beginPath();
        roundRectRing(c, TR.wx0 + 12, TR.wy0 + 12, winW - 24, winH - 24, 24, 5);
        c.fill('evenodd');
        c.layer = L++;
        c.fillStyle = o.trim;
        c.fillRect(TR.wx0, TR.wy0 + 84, winW, 10);
        c.fillRect(TR.wx0 - 20, TR.wy1 + 6, winW + 40, 12); // sill
        c.fillRect(0, 118, U, 8);
        c.fillRect(0, 252, U, 14); // luggage rack
        // ceiling + lamps
        c.layer = L++;
        c.fillStyle = o.ceil;
        c.fillRect(0, 0, U, 118);
        c.layer = L++;
        c.fillStyle = o.lamp;
        c.fillRect(110, 36, 780, 28);
        c.layer = L++;
        c.fillStyle = C.black;
        for (let k = 1; k < 6; k++) c.fillRect(110 + k * 130, 36, 4, 28);
        c.fillRect(0, TR.rodY - 8, U, 16); // strap rod
        c.fillRect(0, 862, U, 100); // seat base
        // ads (shared sprites) + frames
        c.layer = L++;
        c.drawImage(o.ads[(u * 2) % 4], 170, 166);
        c.drawImage(o.ads[(u * 2 + 1) % 4], 540, 166);
        c.layer = L++;
        c.fillStyle = o.trim;
        c.beginPath();
        roundRectRing(c, 170, 166, TR.adW, TR.adH, 0, 6);
        roundRectRing(c, 540, 166, TR.adW, TR.adH, 0, 6);
        c.fill('evenodd');
        c.layer = L++;
        c.fillStyle = C.gray;
        for (let x = 0; x < U; x += 18) c.fillRect(x, 255, 3, 8);
        for (let x = 20; x < U; x += 40) {
          c.fillRect(x, 890, 24, 6);
          c.fillRect(x, 912, 24, 6);
        }
        c.fillRect(0, 962, U, H - 962); // floor
        c.layer = L++;
        c.fillStyle = C.white;
        c.fillRect(0, TR.rodY - 4, U, 7);
        // seat
        c.layer = L++;
        c.fillStyle = o.seat;
        roundRectPath(c, 60, 724, U - 120, 92, 20);
        c.fill();
        c.layer = L++;
        c.fillStyle = o.seatHi;
        for (let k = 0; k < 7; k++) c.fillRect(110 + k * 118, 736, 6, 70);
        c.layer = L++;
        c.fillStyle = o.seat;
        roundRectPath(c, 40, 800, U - 80, 70, 22);
        c.fill();
        c.layer = L++;
        c.fillStyle = o.seatHi;
        c.fillRect(60, 808, U - 120, 6);
        c.layer = L++;
        c.fillStyle = o.trim;
        c.beginPath();
        roundRectRing(c, 40, 800, U - 80, 70, 22, 6);
        c.fill('evenodd');
        c.layer = L++;
        c.fillStyle = rgba(C.white, 0.12);
        c.fillRect(0, 964, U, 5);
        // passengers (small sprites)
        c.layer = L++;
        for (let s = 0; s < 2; s++) {
          if (rand(o.seed, u, s) > 0.72) continue;
          const px = 300 + s * 380 + srand(o.seed, u, s + 5) * 50;
          c.drawImage(passengerSprite(Math.floor(rand(o.seed, u, s + 9) * 3), o.rim), Math.round(px) - 100, 480);
        }
        // stanchion pole at the bay boundary
        c.layer = L++;
        c.fillStyle = C.black;
        c.fillRect(-13, 118, 26, 846);
        c.layer = L++;
        c.fillStyle = C.white;
        c.fillRect(-7, 118, 12, 846);
      });
      units.push(ops);
    }
    return units;
  }
  // Bays placed like drawStrip (bay k at screen x = k·U − off), culled.
  function drawBays(ctx, units, off, y) {
    const U = TR.U, n = units.length;
    for (let k = Math.floor((off - OVS - 20) / U); k * U - off < W + OVS + 20; k++) {
      const x = Math.round(k * U - off);
      ctx.translate(x, y);
      playOps(ctx, units[mod(k, n)]);
      ctx.translate(-x, -y);
    }
  }
  function drawStraps(ctx, off, tau, B, I, o) {
    const sp = TR.strap;
    const i0 = Math.floor((off - OV - 120) / sp), i1 = Math.ceil((off + W + OV + 120) / sp);
    const amp = 0.05 + 0.08 * I;
    for (let i = i0; i <= i1; i++) {
      const X = i * sp + sp / 2;
      const m = mod(X, TR.U);
      if (m < 45 || m > TR.U - 45) continue;
      const x = X - off;
      const th = amp * Math.sin(tau * 2.3 - i * 0.33) + 0.16 * B.pulse * (0.35 + I) * Math.sin(i * 1.7 + 1.2);
      ctx.save();
      ctx.translate(x, TR.rodY);
      ctx.rotate(th);
      ctx.fillStyle = C.black;
      ctx.fillRect(-8, -6, 16, 110);
      ctx.fillStyle = o.belt;
      ctx.fillRect(-4, -2, 8, 104);
      ctx.beginPath();
      if (mod(i, 3) === 0) {
        ctx.arc(0, 132, 30, 0, TAU);
        ctx.moveTo(18, 132);
        ctx.arc(0, 132, 18, 0, TAU, true);
      } else {
        ctx.moveTo(0, 98); ctx.lineTo(36, 160); ctx.lineTo(-36, 160); ctx.closePath();
        ctx.moveTo(0, 118); ctx.lineTo(-20, 150); ctx.lineTo(20, 150); ctx.closePath();
      }
      ctx.fillStyle = C.white;
      ctx.fill('evenodd');
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = C.black;
      ctx.stroke();
      ctx.restore();
    }
  }
  function drawTrain(ctx, env, p, K) {
    const B = beatOf(env), I = p.intensity, v = p.variant, q = env.quality || 1;
    const dark = I < 0.45 ? v % 2 === 0 : v % 2 === 1;
    const tau = p.lt * p.speed + rand(p.seed, 1) * 300;
    // ---- outside
    fillAll(ctx, C.night);
    fillRamp(ctx, 'train-sky', 120);
    drawDust(ctx, dustList(5202, 90, -OV, W + OV, 250, 460, 1, 2.2), C.star);
    drawStrip(ctx, K.cityImg, tau * (120 + 120 * I), 320);
    drawBeacons(ctx, K.city, tau * (120 + 120 * I), 320, env.t, C.red);
    // light streaks
    const nS = Math.round((20 + 30 * I) * q);
    const cols = [C.white, C.star, C.red, C.yellow];
    for (let ci = 0; ci < cols.length; ci++) {
      ctx.fillStyle = cols[ci];
      ctx.beginPath();
      for (let k = ci; k < nS; k += cols.length) {
        const y = 430 + rand(p.seed, k, 1) * 220;
        const vel = (1600 + rand(p.seed, k, 2) * 2800) * (0.6 + 0.7 * I) * p.speed;
        const len = 60 + Math.pow(rand(p.seed, k, 3), 2) * 700;
        const th = 2 + Math.round(rand(p.seed, k, 4) * 5);
        const span = W + 2 * OV + 900;
        const x = mod(rand(p.seed, k, 5) * span - vel * tau, span) - OV - 900;
        ctx.rect(x, y, len, th);
      }
      ctx.fill();
    }
    // catenary wire + masts passing on the beat
    ctx.fillStyle = C.black;
    ctx.fillRect(-OV, 312, W + 2 * OV, 4);
    const two = I < 0.5;
    const ph = two ? ((B.index & 1) + B.phase) / 2 : B.phase;
    const mxp = lerp(W + 400, -400, ph);
    for (let g = 2; g >= 0; g--) {
      ctx.globalAlpha = g === 0 ? 1 : 0.22 / g;
      const gx = mxp + g * 90;
      ctx.fillRect(gx - 18, 150, 36, 700);
      ctx.fillRect(gx - 18, 300, 150, 12);
    }
    ctx.globalAlpha = 1;
    // tunnel darkness (occasional, bar-aligned, wipes in from the right)
    const isT = (b) => rand(p.seed, b, 91) < 0.1 + 0.12 * I;
    const tNow = isT(B.bar), tPrev = isT(B.bar - 1);
    let dL = null, dR = null;
    if (tNow) {
      dL = tPrev ? -OV : lerp(W + OV, -OV, E.outQuad(clamp(B.sinceDownbeat / 0.3)));
      dR = W + OV;
    } else if (tPrev && B.sinceDownbeat < 0.3) {
      dL = -OV;
      dR = lerp(W + OV, -OV, E.outQuad(clamp(B.sinceDownbeat / 0.3)));
    }
    if (dL !== null && dR > dL) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(dL, -OV, dR - dL, H + 2 * OV);
      ctx.clip();
      fillAll(ctx, C.black);
      ctx.fillStyle = C.gray;
      const rib = mod(tau * 3200, 240);
      for (let x = -OV - rib + 240; x < W + OV; x += 240) ctx.fillRect(x, 260, 10, 420);
      // tunnel lamps sweeping past on every beat (with short motion trails)
      const lp = lerp(W + 400, -700, B.phase);
      for (let g = 0; g < 3; g++) {
        ctx.globalAlpha = 1 - g * 0.3;
        ctx.fillStyle = C.yellow;
        ctx.fillRect(lp + g * 170, 372 - g, 150, 14 - g * 3);
        ctx.fillStyle = C.red;
        ctx.fillRect(lp + 420 + g * 140, 566, 120, 8 - g * 2);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    // ---- interior
    const off = tau * (70 + 80 * I);
    const img = dark ? K.intBlack : K.intRed;
    ctx.fillStyle = dark ? C.gray : C.black;
    ctx.fillRect(-OVF, -OVF, W + 2 * OVF, OVF);
    ctx.fillStyle = C.gray;
    ctx.fillRect(-OVF, H - 1, W + 2 * OVF, OVF);
    drawBays(ctx, img, off, 0);
    drawStraps(ctx, off, tau, B, I, { belt: dark ? C.gray : C.black });
    // lights flicker when the tunnel swallows the car
    if (tNow && !tPrev && B.sinceDownbeat < 0.35) {
      const f = rand(p.seed, Math.floor(env.t * 20), 5) < 0.5 ? 0.35 : 0.1;
      ctx.fillStyle = rgba(C.ink, f);
      ctx.fillRect(-OV, -OV, W + 2 * OV, H + 2 * OV);
    }
  }

  /* ================================================================== */
  /* 3. CROWD                                                            */
  /* ================================================================== */
  // Figure kit: organic silhouettes as Path2D in unit space (feet y = 0, head
  // top ≈ −1). A shape is a control polygon drawn as a smooth outline
  // (quadratic curves through the edge midpoints; a point [x, y, 1] stays a
  // sharp corner); limbs are tapered capsules. Every subpath is wound the same
  // way, so one nonzero fill paints the union of all parts.
  function polyArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }
  // Bounds of everything added by the kit since the last kitBounds() reset
  // (control points bound the curves), used to size sprites tightly.
  let KB = null;
  function kitBounds(reset) {
    const b = KB;
    if (reset) KB = [1e9, 1e9, -1e9, -1e9];
    return b;
  }
  function grow(x, y, r) {
    if (!KB) return;
    r = r || 0;
    if (x - r < KB[0]) KB[0] = x - r;
    if (y - r < KB[1]) KB[1] = y - r;
    if (x + r > KB[2]) KB[2] = x + r;
    if (y + r > KB[3]) KB[3] = y + r;
  }
  function blob(path, pts) {
    for (const p of pts) grow(p[0], p[1]);
    if (polyArea(pts) < 0) pts = pts.slice().reverse();
    const n = pts.length;
    const mid = (i) => {
      const a = pts[mod(i, n)], b = pts[mod(i + 1, n)];
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    };
    const m0 = mid(-1);
    path.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) {
      const p = pts[i], m = mid(i);
      if (p[2]) {
        path.lineTo(p[0], p[1]);
        path.lineTo(m[0], m[1]);
      } else path.quadraticCurveTo(p[0], p[1], m[0], m[1]);
    }
    path.closePath();
  }
  function disc(path, x, y, r) {
    grow(x, y, r);
    path.moveTo(x + r, y);
    path.arc(x, y, r, 0, TAU);
    path.closePath();
  }
  // Tapered limb through joints [[x, y, r], …]: round joints + tangent quads.
  function limb(path, js) {
    for (let i = 0; i < js.length; i++) disc(path, js[i][0], js[i][1], js[i][2]);
    for (let i = 0; i < js.length - 1; i++) {
      const a = js[i], b = js[i + 1];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
      let q = [[a[0] + nx * a[2], a[1] + ny * a[2]], [b[0] + nx * b[2], b[1] + ny * b[2]], [b[0] - nx * b[2], b[1] - ny * b[2]], [a[0] - nx * a[2], a[1] - ny * a[2]]];
      if (polyArea(q) < 0) q = q.reverse();
      path.moveTo(q[0][0], q[0][1]);
      for (let k = 1; k < 4; k++) path.lineTo(q[k][0], q[k][1]);
      path.closePath();
    }
  }
  // Shoe at ankle (ax, ay) rotated by ang (+ = toe down / heel lifted).
  function shoe(path, ax, ay, ang, len) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const P = (u, v, s) => [ax + u * ca - v * sa, ay + u * sa + v * ca, s];
    blob(path, [P(-0.03, -0.012), P(-0.034, 0.042, 1), P(len, 0.042, 1), P(len + 0.016, 0.026), P(len - 0.012, 0.008), P(0.03, -0.012)]);
  }

  // Side-view walkers, facing +x. Two poses (stride / passing) swap on the beat.
  const WALK_POSES = [
    {
      legA: [[0.0, -0.49, 0.05], [0.085, -0.268, 0.035], [0.152, -0.058, 0.023]], footA: -0.32,
      legB: [[-0.012, -0.49, 0.05], [-0.045, -0.262, 0.035], [-0.15, -0.09, 0.023]], footB: 0.62,
      armA: [[-0.004, -0.795, 0.034], [-0.052, -0.655, 0.026], [-0.098, -0.53, 0.02]], handA: [-0.108, -0.505],
      armB: [[0.004, -0.795, 0.034], [0.05, -0.66, 0.026], [0.112, -0.548, 0.02]], handB: [0.126, -0.525],
      flare: 1,
    },
    {
      legA: [[0.0, -0.49, 0.05], [0.018, -0.268, 0.035], [0.004, -0.05, 0.023]], footA: 0,
      legB: [[-0.008, -0.49, 0.05], [0.07, -0.3, 0.035], [0.0, -0.148, 0.023]], footB: 0.72,
      armA: [[-0.004, -0.795, 0.034], [-0.012, -0.65, 0.026], [-0.022, -0.515, 0.02]], handA: [-0.024, -0.49],
      armB: [[0.004, -0.795, 0.034], [0.014, -0.652, 0.026], [0.03, -0.52, 0.02]], handB: [0.034, -0.495],
      flare: 0.3,
    },
  ];
  const WALK_HEAD = [[0.0, -0.99], [0.045, -0.978], [0.068, -0.94], [0.077, -0.918], [0.064, -0.902], [0.06, -0.878], [0.036, -0.86], [-0.004, -0.872], [-0.042, -0.9], [-0.05, -0.95]];
  const WALK_TORSO = [[-0.056, -0.842], [0.012, -0.852], [0.058, -0.808], [0.064, -0.722], [0.048, -0.625], [0.056, -0.54], [0.044, -0.47], [-0.032, -0.462], [-0.07, -0.51], [-0.058, -0.625], [-0.074, -0.752]];
  function walkerPath(type, pose) {
    const P = WALK_POSES[pose], path = new Path2D();
    const slim = type === 1 ? 0.86 : 1;
    const L = (js) => js.map((j) => [j[0], j[1], j[2] * slim]);
    blob(path, WALK_HEAD);
    limb(path, [[0.0, -0.878, 0.021], [0.004, -0.83, 0.026]]);
    blob(path, WALK_TORSO);
    for (const [leg, fa] of [[P.legA, P.footA], [P.legB, P.footB]]) {
      limb(path, L(leg));
      shoe(path, leg[2][0], leg[2][1], fa, type === 1 ? 0.075 : 0.088);
    }
    let armA = P.armA, handA = P.handA;
    let armB = P.armB, handB = P.handB;
    if (type === 3) { // umbrella held up and forward
      armB = [[0.004, -0.795, 0.034], [0.07, -0.715, 0.026], [0.104, -0.8, 0.02]];
      handB = [0.106, -0.82];
    }
    if (type === 4) { // hands in the hoodie pocket
      armA = [[-0.004, -0.795, 0.036], [-0.016, -0.65, 0.028], [0.034, -0.575, 0.022]];
      armB = [[0.004, -0.795, 0.036], [0.01, -0.652, 0.028], [0.05, -0.58, 0.022]];
      handA = handB = null;
    }
    limb(path, armA);
    limb(path, armB);
    if (handA) disc(path, handA[0], handA[1], 0.026);
    if (handB) disc(path, handB[0], handB[1], 0.026);
    const fl = P.flare;
    switch (type) {
      case 0: // long coat + briefcase
      case 5: // long coat + hat
        blob(path, [[-0.066, -0.842], [0.016, -0.852], [0.066, -0.8], [0.07, -0.62], [0.082 + 0.03 * fl, -0.31], [0.03, -0.29, 1], [-0.1 - 0.05 * fl, -0.3, 1], [-0.082, -0.6], [-0.086, -0.76]]);
        if (type === 0) {
          const hx = handA[0], hy = handA[1];
          blob(path, [[hx - 0.075, hy + 0.012, 1], [hx + 0.075, hy + 0.012, 1], [hx + 0.075, hy + 0.118, 1], [hx - 0.075, hy + 0.118, 1]]);
          blob(path, [[hx - 0.02, hy - 0.006, 1], [hx + 0.02, hy - 0.006, 1], [hx + 0.02, hy + 0.016, 1], [hx - 0.02, hy + 0.016, 1]]);
        } else {
          blob(path, [[-0.048, -0.962], [-0.042, -1.045], [0.0, -1.058], [0.05, -1.04], [0.054, -0.962]]);
          blob(path, [[-0.092, -0.968, 1], [0.108, -0.972, 1], [0.1, -0.952], [-0.086, -0.95]]);
        }
        break;
      case 1: // long hair, skirt, shoulder bag
        blob(path, [[0.03, -0.998], [-0.035, -0.998], [-0.072, -0.95], [-0.084, -0.85], [-0.094, -0.752], [-0.052, -0.762], [-0.026, -0.86], [0.02, -0.935]]);
        blob(path, [[-0.066, -0.632], [0.056, -0.632], [0.104 + 0.02 * fl, -0.37, 1], [-0.112 - 0.02 * fl, -0.372, 1]]);
        limb(path, [[0.03, -0.815, 0.009], [-0.08, -0.6, 0.009]]);
        blob(path, [[-0.138, -0.625], [-0.05, -0.632], [-0.044, -0.52], [-0.14, -0.512]]);
        break;
      case 2: // backpack + cap
        blob(path, [[-0.058, -0.832], [-0.158, -0.818], [-0.192, -0.7], [-0.178, -0.57], [-0.06, -0.562]]);
        blob(path, [[-0.054, -0.935], [-0.046, -0.99], [0.018, -1.008], [0.062, -0.978], [0.068, -0.945]]);
        blob(path, [[0.04, -0.952, 1], [0.148, -0.946, 1], [0.14, -0.932], [0.04, -0.934, 1]]);
        break;
      case 3: { // open umbrella
        limb(path, [[0.106, -0.79, 0.008], [0.086, -1.43, 0.008]]);
        blob(path, [[0.086, -1.4], [0.3, -1.33], [0.42, -1.13, 1], [0.335, -1.155], [0.255, -1.112, 1], [0.172, -1.14], [0.086, -1.1, 1], [0.0, -1.14], [-0.083, -1.112, 1], [-0.163, -1.155], [-0.248, -1.13, 1], [-0.128, -1.33]]);
        break;
      }
      case 4: // hoodie: hood + baggy top
        blob(path, [[-0.058, -0.862], [-0.066, -0.945], [-0.04, -0.996], [0.016, -1.004], [0.058, -0.975], [0.07, -0.935], [0.03, -0.905]]);
        blob(path, [[-0.07, -0.845], [0.02, -0.855], [0.07, -0.79], [0.074, -0.6], [0.06, -0.49, 1], [-0.078, -0.49, 1], [-0.082, -0.62], [-0.088, -0.77]]);
        break;
      default:
    }
    return path;
  }
  const walkerCache = new Map();
  // { path, b: [x0, y0, x1, y1] } in unit space
  function walkerShape(type, pose) {
    const key = type * 2 + pose;
    if (!walkerCache.has(key)) {
      kitBounds(true);
      const path = walkerPath(type, pose);
      walkerCache.set(key, { path, b: kitBounds(false) });
      KB = null;
    }
    return walkerCache.get(key);
  }
  /**
   * Walker sprite at height h facing dir (±1): rim pass (offset +rim, −0.6·rim
   * in screen space) and body pass, tightly cropped. Returns { cv, ax, ay }
   * (feet at ax, ay).
   */
  function walkerSprite(type, pose, h, dir, rim, body, rimCol) {
    const sh = walkerShape(type, pose), b = sh.b;
    const pad = 3;
    const bx0 = dir > 0 ? b[0] : -b[2], bx1 = dir > 0 ? b[2] : -b[0];
    const x0 = Math.floor(bx0 * h) - pad, x1 = Math.ceil(bx1 * h + rim) + pad;
    const y0 = Math.floor(b[1] * h - rim * 0.6) - pad, y1 = Math.ceil(b[3] * h) + pad;
    const ax = -x0, ay = -y0;
    const cv = sprite(x1 - x0, y1 - y0, (c) => {
      for (const ps of [[rimCol, rim, -rim * 0.6], [body, 0, 0]]) {
        c.save();
        c.translate(ax + ps[1], ay + ps[2]);
        c.scale(h * dir, h);
        c.fillStyle = ps[0];
        c.fill(sh.path);
        c.restore();
      }
    });
    return { cv, ax, ay };
  }

  // The lone protagonist: an original, generic high-school student seen from
  // the front, faceless (solid silhouette, no mask): soft messy hair, school
  // blazer with lapels, one hand in the trouser pocket, messenger bag on a
  // diagonal strap, scarf ends streaming in the wind, red rim light.
  const STU = {
    hair: [[-0.061, -0.874], [-0.068, -0.93], [-0.076, -0.957, 1], [-0.06, -0.972], [-0.052, -0.998], [-0.022, -1.012], [-0.006, -1.024, 1], [0.014, -1.01], [0.042, -1.007], [0.062, -0.99], [0.079, -0.967, 1], [0.068, -0.944], [0.069, -0.9], [0.06, -0.872], [0.05, -0.905], [0.046, -0.94], [0.0, -0.952], [-0.046, -0.94], [-0.052, -0.905]],
    head: [[0.0, -0.988], [0.05, -0.975], [0.06, -0.93], [0.056, -0.888], [0.036, -0.856], [0.0, -0.846], [-0.036, -0.856], [-0.056, -0.888], [-0.06, -0.93], [-0.05, -0.975]],
    neck: [[-0.024, -0.87], [0.024, -0.87], [0.026, -0.8, 1], [-0.026, -0.8, 1]],
    blazer: [[-0.03, -0.842], [-0.09, -0.828], [-0.13, -0.81], [-0.15, -0.778], [-0.144, -0.7], [-0.128, -0.62], [-0.124, -0.52], [-0.132, -0.448, 1], [0.0, -0.438], [0.132, -0.448, 1], [0.124, -0.52], [0.128, -0.62], [0.144, -0.7], [0.15, -0.778], [0.13, -0.81], [0.09, -0.828], [0.03, -0.842]],
    legL: [[-0.124, -0.462, 1], [-0.004, -0.462], [-0.008, -0.415, 1], [-0.028, -0.25], [-0.034, -0.05, 1], [-0.094, -0.05, 1], [-0.1, -0.25], [-0.118, -0.4]],
    legR: [[0.124, -0.462, 1], [0.004, -0.462], [0.008, -0.415, 1], [0.03, -0.25], [0.044, -0.05, 1], [0.104, -0.05, 1], [0.104, -0.25], [0.118, -0.4]],
    shoeL: [[-0.104, -0.002, 1], [-0.108, -0.035], [-0.09, -0.058], [-0.038, -0.058], [-0.022, -0.03], [-0.02, -0.002, 1]],
    shoeR: [[0.03, -0.002, 1], [0.028, -0.03], [0.044, -0.058], [0.098, -0.058], [0.116, -0.035], [0.114, -0.002, 1]],
    armL: [[-0.134, -0.772, 0.042], [-0.166, -0.618, 0.034], [-0.162, -0.484, 0.028]],
    handL: [[-0.182, -0.49], [-0.142, -0.49], [-0.144, -0.432], [-0.16, -0.408], [-0.178, -0.43]],
    armR: [[0.134, -0.772, 0.042], [0.186, -0.632, 0.034], [0.122, -0.518, 0.028]],
    bag: [[-0.236, -0.53], [-0.112, -0.534], [-0.104, -0.46], [-0.11, -0.388], [-0.234, -0.386], [-0.244, -0.46]],
    // red detail strokes (lapels, opening, buttons, cuffs, pocket, strap, bag flap, hair)
    lines: [
      [[-0.028, -0.836], [-0.058, -0.77], [-0.03, -0.742], [0.0, -0.622]],
      [[0.028, -0.836], [0.058, -0.77], [0.03, -0.742], [0.0, -0.622]],
      [[0.0, -0.622], [-0.012, -0.52], [-0.05, -0.446]],
      [[0.0, -0.622], [0.012, -0.52], [0.05, -0.446]],
      [[-0.112, -0.68], [-0.07, -0.684]],
      [[-0.182, -0.512], [-0.142, -0.51]],
      [[0.106, -0.5], [0.138, -0.532]],
      [[0.098, -0.83], [0.084, -0.802], [-0.172, -0.532]],
      [[0.12, -0.816], [0.106, -0.786], [-0.146, -0.53]],
      [[-0.238, -0.505], [-0.228, -0.462], [-0.114, -0.462], [-0.108, -0.508]],
    ],
    dots: [[0.004, -0.588], [0.004, -0.522]],
    wrap: [[-0.046, -0.85], [0.046, -0.85], [0.07, -0.826], [0.066, -0.796], [0.0, -0.788], [-0.066, -0.796], [-0.07, -0.826]],
  };
  let studentCache = null;
  function studentShapes() {
    if (studentCache) return studentCache;
    const body = new Path2D();
    kitBounds(true);
    for (const k of ['hair', 'head', 'neck', 'blazer', 'legL', 'legR', 'shoeL', 'shoeR', 'handL', 'bag']) blob(body, STU[k]);
    limb(body, STU.armL);
    limb(body, STU.armR);
    const bounds = kitBounds(false);
    KB = null;
    const lines = new Path2D();
    for (const l of STU.lines) {
      lines.moveTo(l[0][0], l[0][1]);
      for (let i = 1; i < l.length; i++) lines.lineTo(l[i][0], l[i][1]);
    }
    const dots = new Path2D();
    for (const d of STU.dots) disc(dots, d[0], d[1], 0.007);
    const wrap = new Path2D();
    blob(wrap, STU.wrap);
    studentCache = { body, lines, dots, wrap, bounds };
    return studentCache;
  }
  // The static part of the student (rim light, silhouette, red tailoring
  // details) as one sprite at height h; dir = −1 is the mirror image (used
  // when the wind blows the other way). Feet centre at (ax, ay).
  function studentSprite(h, rimCol, dir) {
    const S = studentShapes(), b = S.bounds;
    const pad = 14;
    const bx0 = dir > 0 ? b[0] : -b[2], bx1 = dir > 0 ? b[2] : -b[0];
    const x0 = Math.floor(bx0 * h) - pad - 8, x1 = Math.ceil(bx1 * h) + pad + 8;
    const y0 = Math.floor(b[1] * h) - pad - 4, y1 = Math.ceil(b[3] * h) + pad;
    const ax = -x0, ay = -y0, px = 1 / h;
    const cv = sprite(x1 - x0, y1 - y0, (c) => {
      c.translate(ax, ay);
      c.scale(h * dir, h);
      c.lineJoin = 'round';
      c.lineCap = 'round';
      // red rim light: a thin outline all round (backlit by the moon) plus a
      // stronger offset rim on the lit side
      c.strokeStyle = rimCol;
      c.lineWidth = 7 * px;
      c.stroke(S.body);
      c.fillStyle = rimCol;
      c.translate(-8 * px, -4 * px);
      c.fill(S.body);
      c.translate(8 * px, 4 * px);
      c.fillStyle = C.black;
      c.fill(S.body);
      // tailoring details in red
      c.strokeStyle = rimCol;
      c.lineWidth = 3.2 * px;
      c.stroke(S.lines);
      c.fillStyle = rimCol;
      c.fill(S.dots);
    });
    return { cv, ax, ay };
  }
  // One scarf tail: a long ribbon streaming down-wind with a travelling wave and
  // a swallow-tail tip (reads as cloth, not as a limb). Unit space.
  function scarfTail(ctx, tau, len, ph, x0, y0, wind, droop, w0, amp) {
    const n = 12, up = [], lo = [];
    const ca = Math.cos(droop), sa = Math.sin(droop);
    const A = amp == null ? 1 : amp;
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const wave = A * ((0.006 + 0.04 * s) * Math.sin(tau * 7 - s * 9 + ph) + 0.005 * Math.sin(tau * 15 + s * 16 + ph));
      const x = x0 + s * len * ca - wave * sa;
      const y = y0 + s * len * sa + wave * ca;
      const w = w0 * (1 - s * 0.3);
      up.push([x + (sa * w) / 2, y - (ca * w) / 2]);
      lo.push([x - (sa * w) / 2, y + (ca * w) / 2]);
    }
    const tu = up[n], tl = lo[n];
    const fx = ca * 0.018, fy = sa * 0.018;
    const mid = [(tu[0] + tl[0]) / 2 - fx * 0.4, (tu[1] + tl[1]) / 2 - fy * 0.4];
    const pts = up.concat([[tu[0] + fx, tu[1] + fy], mid, [tl[0] + fx, tl[1] + fy]], lo.reverse());
    for (const q of pts) q[0] *= wind;
    D.polygon(ctx, pts);
  }
  // Draws the student with feet at (x, footY): scarf tails (behind), the body
  // sprite, then the scarf wrap and its short front end (animated per frame).
  function drawStudent(ctx, spr, x, footY, h, tau, wind, B) {
    const S = studentShapes();
    const px = 1 / h;
    ctx.save();
    ctx.translate(x, footY);
    ctx.scale(h, h);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // scarf tails behind the body (knot on the down-wind side of the neck)
    const tails = [
      [0.44, 0.0, -0.846, 0.2 + 0.05 * Math.sin(tau * 0.9), 0.046],
      [0.3, 2.2, -0.826, 0.46 + 0.06 * Math.sin(tau * 1.1 + 1), 0.038],
    ];
    ctx.fillStyle = C.red;
    ctx.strokeStyle = C.black;
    ctx.lineWidth = 4 * px;
    for (const tl of tails) {
      scarfTail(ctx, tau + tl[1] * 0.2, tl[0], tl[1], 0.05, tl[2], wind, tl[3], tl[4]);
      ctx.fill();
      ctx.stroke();
    }
    const sp = spr[wind > 0 ? 0 : 1];
    ctx.save();
    ctx.scale(px, px);
    ctx.drawImage(sp.cv, -sp.ax, -sp.ay);
    ctx.restore();
    // scarf wrap + short front end swinging on the beat
    ctx.save();
    ctx.scale(wind, 1);
    scarfTail(ctx, tau * 0.6, 0.13, 1.3, 0.03, -0.806, 1, 1.45 + 0.06 * Math.sin(tau * 2.3) - 0.08 * B.pulse, 0.036, 0.25);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.fill(S.wrap);
    ctx.stroke(S.wrap);
    ctx.beginPath();
    ctx.moveTo(-0.058, -0.818);
    ctx.lineTo(0.058, -0.818);
    ctx.stroke();
    ctx.restore();
  }

  // Crowd rows (back → front): depth tint, height, foot line, speed, direction.
  const CROWD_ROWS = [
    { h: 230, foot: 772, v: 34, dir: 1, n: 12, rim: 3, tint: true },
    { h: 370, foot: 862, v: 62, dir: -1, n: 9, rim: 4 },
    { h: 540, foot: 972, v: 100, dir: 1, n: 7, rim: 6 },
    { h: 1060, foot: 1420, v: 420, dir: -1, n: 2, rim: 10, margin: 1400 },
  ];
  const CROWD_SKY = { k: 0.45, red: { '@body': C.blood }, night: { '@body': mix(C.navy, C.night, 0.6) } };
  function buildCrowd() {
    rampTile('crowd-red');
    rampTile('crowd-night');
    // distant city behind the crossing: the shared far-skyline geometry at 0.45
    // scale, silhouettes only (its palettes leave out the window slots)
    const K = { moon: { red: moonSprite('red'), navy: moonSprite('navy') }, far: sharedSkyline('far') };
    // walker sprites: one shared set (black / red rim) for rows 1–2 and the far
    // row in two depth tints; row 3 (huge, ≤ 2 walkers) is drawn as vector paths
    // every row gets sprites at its exact size and direction (plain blits);
    // row 3 (huge, ≤ 2 walkers) is drawn as vector paths
    K.rows = [];
    K.farNight = [];
    for (let ri = 0; ri < 3; ri++) {
      const row = CROWD_ROWS[ri];
      K.rows[ri] = [];
      if (ri === 0) K.farNight = [];
      for (let type = 0; type < 6; type++) {
        K.rows[ri][type] = [0, 1].map((pose) => walkerSprite(type, pose, row.h, row.dir, row.rim, row.tint ? C.blood : C.black, row.tint ? C.redHot : C.red));
        if (ri === 0) K.farNight[type] = [0, 1].map((pose) => walkerSprite(type, pose, row.h, row.dir, row.rim, C.night, C.redDeep));
      }
    }
    K.student = [studentSprite(660, C.red, 1), studentSprite(660, C.red, -1)];
    return K;
  }
  function drawCrowdRow(ctx, K, ri, tau, p, B, I, q, speedK, night) {
    const row = CROWD_ROWS[ri];
    const M = row.margin || 320;
    const span = W + 2 * M;
    const n = ri === 3 ? (I > 0.6 ? 2 : 1) : Math.max(1, Math.round(row.n * (0.55 + 0.6 * I) * (ri < 2 ? q : 1)));
    const set = ri === 0 && night ? K.farNight : K.rows[ri];
    for (let k = 0; k < n; k++) {
      const x0 = (k / n) * span + srand(p.seed, ri * 50 + k, 1) * (span / n) * 0.35;
      const x = Math.round(mod(x0 + row.dir * row.v * speedK * tau, span) - M);
      const type = Math.floor(rand(p.seed, ri * 50 + k, 2) * 6);
      const pose = (B.index + k + ri) & 1;
      const bob = pose === 1 ? -Math.round(row.h * 0.012) : 0;
      if (x < -0.5 * row.h - OV || x > W + OV + 0.5 * row.h) continue;
      if (ri === 3) {
        // huge foreground passers-by: vector (crisp at 1000+ px)
        const sh = walkerShape(type, pose).path;
        for (let pass = 0; pass < 2; pass++) {
          ctx.save();
          ctx.translate(x + (pass ? 0 : row.rim), row.foot + bob - (pass ? 0 : row.rim * 0.6));
          ctx.scale(row.h * row.dir, row.h);
          ctx.fillStyle = pass ? C.black : C.red;
          ctx.fill(sh);
          ctx.restore();
        }
        continue;
      }
      const spr = set[type][pose];
      ctx.drawImage(spr.cv, x - spr.ax, row.foot + bob - spr.ay);
    }
  }
  function drawCrowd(ctx, env, p, K) {
    const B = beatOf(env), I = p.intensity, v = p.variant, q = env.quality || 1;
    const night = I < 0.5 ? v % 2 === 0 : v % 2 === 1;
    const tau = p.lt * p.speed + rand(p.seed, 1) * 200;
    const px = Math.round(W * 0.5 + srand(p.seed, 5) * 240);
    const discY = 470, dr = MOON_R;
    fillAll(ctx, night ? C.navy : C.red);
    if (night) {
      fillRamp(ctx, 'crowd-night', -OV);
      drawDust(ctx, dustList(3301, 200, -OV, W + OV, -OV, 620, 1, 2.4), C.star);
    } else {
      fillRamp(ctx, 'crowd-red', -OV);
    }
    // broken halo arcs turning around the moon (rings, never rays)
    haloArcs(ctx, px, discY, dr + 110, 64, B, tau, night ? C.red : C.black, 0.45 + 0.4 * I, 9);
    // cream halftone moon behind the lone figure, ringed on the bar
    ctx.lineWidth = 12;
    ctx.strokeStyle = night ? C.red : C.black;
    circle(ctx, px, discY, dr + 30 + 16 * B.barPulse);
    ctx.stroke();
    ctx.lineWidth = 4;
    circle(ctx, px, discY, dr + 58 + 30 * B.barPulse);
    ctx.stroke();
    drawMoon(ctx, K.moon[night ? 'navy' : 'red'], px, discY);
    // distant city skyline (slow drift)
    const kS = CROWD_SKY.k;
    ctx.save();
    ctx.translate(0, Math.round(716 - NC.farH * kS));
    ctx.scale(kS, kS);
    drawStripOps(ctx, K.far, tau * 12, 0, night ? CROWD_SKY.night : CROWD_SKY.red, kS);
    ctx.restore();
    // ground + zebra crossing in gentle perspective
    ctx.fillStyle = C.black;
    D.polygon(ctx, [[-OVF, 700], [W + OVF, 716], [W + OVF, H + OVF], [-OVF, H + OVF]]);
    ctx.fill();
    ctx.fillStyle = night ? C.gray : C.paper;
    ctx.beginPath();
    const vx = px + 160, vy = -1400;
    const yT = 742, yB = H + OV;
    const f = (yT - vy) / (yB - vy);
    for (let k = -8; k <= 8; k++) {
      const xb0 = px + k * 250 - 60, xb1 = xb0 + 130;
      ctx.moveTo(lerp(vx, xb0, f), yT);
      ctx.lineTo(lerp(vx, xb1, f), yT);
      ctx.lineTo(xb1, yB);
      ctx.lineTo(xb0, yB);
      ctx.closePath();
    }
    ctx.fill();
    const speedK = 0.6 + 0.8 * I;
    drawCrowdRow(ctx, K, 0, tau, p, B, I, q, speedK, night);
    drawCrowdRow(ctx, K, 1, tau, p, B, I, q, speedK, night);
    drawCrowdRow(ctx, K, 2, tau, p, B, I, q, speedK, night);
    drawStudent(ctx, K.student, px, 996, 660, tau, srand(p.seed, 8) < 0 ? -1 : 1, B);
    drawCrowdRow(ctx, K, 3, tau, p, B, I, q, speedK, night);
  }

  /* ================================================================== */
  /* 4. TUNNEL                                                           */
  /* ================================================================== */
  function tunnelShape(ctx, kind, cx, cy, R, rot) {
    if (kind === 1) {
      const n = 10;
      for (let i = 0; i <= n; i++) {
        const r = i % 2 === 0 ? R : R * 0.5;
        const a = rot - Math.PI / 2 + (i * Math.PI) / 5;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      return;
    }
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const px = (pts[i][0] + pts[i][1] * 0.22) * R * 0.78, py = pts[i][1] * R * 0.62;
      const x = cx + px * ca - py * sa, y = cy + px * sa + py * ca;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  function drawTunnel(ctx, env, p) {
    const B = beatOf(env), I = p.intensity, v = p.variant, q = env.quality || 1;
    const night = I < 0.45 ? v % 2 === 0 : v % 3 === 2;
    const kind = night ? 1 : v % 2;
    const pal = night ? [C.night, C.navy, C.night, C.redDeep] : kind === 1 ? [C.black, C.red, C.black, C.white] : [C.red, C.black, C.white, C.black];
    const line = night ? C.star : kind === 1 ? C.white : C.black;
    const period = B.period;
    const prog = clamp(p.lt / p.dur);
    const rpb = I > 0.55 ? 2 : 1;
    const zPhase = (p.lt / period) * rpb * p.speed * (1 + 0.9 * I * prog) + rand(p.seed, 3) * 7;
    const base = Math.floor(zPhase), f = zPhase - base;
    const tau = p.lt * p.speed + rand(p.seed, 1) * 100;
    const cx = W / 2 + 170 * MV.noise1(tau * 0.22, p.seed), cy = H / 2 + 90 * MV.noise1(tau * 0.27, p.seed + 1);
    const N = 22, F = 1150;
    const twist = (kind === 1 ? 9 : 5) * DEG * (v % 2 ? -1 : 1);
    const spin = tau * 0.18 * (1 + I);
    const shiftCol = I > 0.6 && B.sinceDownbeat < 0.09 ? 1 : 0;
    const colOf = (id) => pal[mod(id + shiftCol, pal.length)];
    const reach = Math.hypot(Math.max(cx, W - cx) + OV, Math.max(cy, H - cy) + OV);
    const inscr = kind === 1 ? 0.4 : 0.42;
    const rad = [], rot = [];
    for (let k = 0; k < N; k++) {
      const z = k + 1 - f;
      rad[k] = F / z;
      rot[k] = (base + k) * twist + spin - 12 * DEG;
    }
    let k0 = 0;
    while (k0 < N - 2 && rad[k0 + 1] * inscr > reach) k0++;
    fillAll(ctx, colOf(base + k0 - (rad[k0] * inscr > reach ? 0 : 1)));
    for (let k = k0; k < N - 1; k++) {
      ctx.beginPath();
      tunnelShape(ctx, kind, cx, cy, rad[k], rot[k]);
      tunnelShape(ctx, kind, cx, cy, rad[k + 1], rot[k + 1]);
      ctx.fillStyle = colOf(base + k);
      ctx.fill('evenodd');
    }
    ctx.beginPath();
    tunnelShape(ctx, kind, cx, cy, rad[N - 1], rot[N - 1]);
    ctx.fillStyle = colOf(base + N - 1);
    ctx.fill();
    // ring outlines
    ctx.strokeStyle = line;
    ctx.lineJoin = 'miter';
    for (let k = k0; k < N; k += 1) {
      const lw = clamp(rad[k] * 0.012, 1, 16);
      if ((base + k) % 2 !== 0 || rad[k] < 70) continue;
      ctx.lineWidth = lw;
      ctx.beginPath();
      tunnelShape(ctx, kind, cx, cy, rad[k], rot[k]);
      ctx.stroke();
    }
    // speed lines: black + dark red (cream on the night palette) — never
    // light streaks radiating over red
    const nL = Math.round((26 + 40 * I) * q);
    const sp = 2.2 + 3 * I;
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass ? (night ? C.star : C.blood) : C.black;
      ctx.beginPath();
      for (let j = pass; j < nL; j += 2) {
        const u0 = tau * sp + rand(p.seed, j, 1);
        const ep = Math.floor(u0), u = u0 - ep;
        const a = rand(p.seed, j, ep + 7) * TAU;
        const r0 = lerp(90, 1500, u * u), len = 120 + 520 * u, wd = (1 + 9 * u) * DEG * 0.35;
        const ca = Math.cos(a), sa = Math.sin(a);
        ctx.moveTo(cx + ca * r0, cy + sa * r0);
        ctx.lineTo(cx + Math.cos(a - wd) * (r0 + len), cy + Math.sin(a - wd) * (r0 + len));
        ctx.lineTo(cx + Math.cos(a + wd) * (r0 + len), cy + Math.sin(a + wd) * (r0 + len));
        ctx.closePath();
      }
      ctx.fill();
    }
    // core
    const cs = 40 + 70 * B.pulse * (0.5 + I);
    ctx.fillStyle = night ? C.star : C.white;
    D.sparkle(ctx, cx, cy, cs * 1.8, 0.16, tau * 0.5);
    ctx.fill();
    ctx.fillStyle = C.red;
    D.star(ctx, cx, cy, cs * 0.55, cs * 0.25, 5, -Math.PI / 2 + tau);
    ctx.fill();
  }

  /* ================================================================== */
  /* 5. STRIPES                                                          */
  /* ================================================================== */
  function stripeSeq(seed) {
    const r = MV.rng(seed * 7 + 3);
    const cols = [C.red, C.black, C.white];
    const widths = [220, 36, 110, 22, 160, 60, 300, 44, 90];
    const seq = [];
    let last = -1, period = 0;
    for (let i = 0; i < 12; i++) {
      let ci = r.int(0, 2);
      if (ci === last) ci = (ci + 1) % 3;
      if (i === 11 && ci === seq[0].ci) ci = (ci + 1) % 3 === last ? (ci + 2) % 3 : (ci + 1) % 3;
      last = ci;
      const w = widths[r.int(0, widths.length - 1)];
      seq.push({ w, c: cols[ci], ci });
      period += w;
    }
    return { seq, period };
  }
  function buildStripes() {
    const K = {};
    K.seqs = [0, 1, 2, 3].map((i) => stripeSeq(i + 1));
    K.htBL = radialQuad(C.black, 1, -1);
    K.htTR = radialQuad(C.white, -1, 1);
    return K;
  }
  function chainPath(ctx, x0, y0, x1, y1, link, lw, phase) {
    const len = Math.hypot(x1 - x0, y1 - y0), a = Math.atan2(y1 - y0, x1 - x0);
    ctx.save();
    ctx.translate(x0, y0);
    ctx.rotate(a);
    ctx.lineWidth = lw;
    const n = Math.ceil(len / (link * 0.78)) + 2;
    const sh = mod(phase, 2 * link * 0.78);
    for (let i = -2; i < n; i++) {
      const x = i * link * 0.78 + sh;
      if (i % 2 === 0) {
        roundRectPath(ctx, x - link / 2, -link * 0.3, link, link * 0.6, link * 0.3);
        ctx.stroke();
      } else {
        ctx.fillRect(x - link / 2, -lw / 2, link, lw);
      }
    }
    ctx.restore();
  }
  const BAND_SCHEMES = [
    { fill: C.white, line: C.black, shadow: C.red, ink: C.black, acc: C.red },
    { fill: C.black, line: C.white, shadow: C.red, ink: C.white, acc: C.red },
    { fill: C.red, line: C.black, shadow: C.black, ink: C.black, acc: C.white },
  ];
  function bandSpec(seed, b) {
    const R = (k) => rand(seed, b, k);
    const side = R(2) < 0.5 ? -1 : 1;
    return {
      side,
      y: 170 + R(3) * 740,
      h: 150 + R(4) * 180,
      w: 1500 + R(5) * 600,
      end: side < 0 ? W * (0.6 + 0.25 * R(6)) : W * (0.15 + 0.25 * R(6)),
      scheme: Math.floor(R(1) * 3),
      content: Math.floor(R(7) * 5),
      rot: (R(8) < 0.5 ? -12 : 8) * DEG,
    };
  }
  // Long skewed cut-in band. Local x runs along the band; the "inner" end is the
  // visible one (the other end bleeds off-screen).
  function drawBand(ctx, K, P, shift, tau, B, seed) {
    const S = BAND_SCHEMES[P.scheme];
    const skew = P.h * 0.35;
    const x0 = P.side < 0 ? P.end - P.w : P.end;
    const inner = P.side < 0 ? P.w : 0; // local x of the visible end
    ctx.save();
    ctx.translate(x0 + shift, P.y);
    ctx.rotate(P.rot);
    ctx.translate(0, -P.h / 2);
    // accent band (thin, offset, contrasting)
    ctx.fillStyle = S.acc === C.white ? C.white : C.red;
    D.skewRect(ctx, P.side < 0 ? -40 : 90, P.h + 18, P.w - 50, P.h * 0.16, skew * 0.16);
    ctx.fill();
    ctx.fillStyle = S.shadow;
    D.skewRect(ctx, 18, 18, P.w, P.h, skew);
    ctx.fill();
    ctx.fillStyle = S.fill;
    D.skewRect(ctx, 0, 0, P.w, P.h, skew);
    ctx.fill();
    ctx.save();
    ctx.clip();
    const beatJ = E.outBack(clamp(B.sinceBeat / 0.2)) * (1 - clamp((B.sinceBeat - 0.2) / 0.3));
    if (P.content === 0) {
      // hatching: parallel slanted bars (polygons; rotated pattern fills are slow)
      ctx.fillStyle = S.ink;
      ctx.beginPath();
      const o = mod(tau * 60, 34);
      for (let hx = -P.h - 34 + o; hx < P.w + 34; hx += 34) {
        ctx.moveTo(hx, P.h);
        ctx.lineTo(hx + P.h * 0.6, 0);
        ctx.lineTo(hx + P.h * 0.6 + 15, 0);
        ctx.lineTo(hx + 15, P.h);
        ctx.closePath();
      }
      ctx.fill();
      ctx.fillStyle = S.acc;
      const sx = inner + (P.side < 0 ? -P.h * 0.9 : P.h * 0.9);
      D.star(ctx, sx, P.h * 0.5, P.h * 0.62 * (1 + 0.12 * beatJ), P.h * 0.27, 5, -Math.PI / 2 + tau * 0.5);
      ctx.fill();
      ctx.lineWidth = 9;
      ctx.strokeStyle = S.line;
      ctx.stroke();
    } else if (P.content === 1) {
      // line-screen halftone ramp: bar width encodes tone, dense at the inner end
      ctx.fillStyle = S.ink;
      ctx.beginPath();
      const pitch = 26;
      for (let hx = 0; hx < P.w; hx += pitch) {
        const u = P.side < 0 ? hx / P.w : 1 - hx / P.w;
        const bw = pitch * 0.9 * Math.pow(u, 1.3);
        if (bw < 1) continue;
        ctx.rect(hx + (pitch - bw) / 2, 0, bw, P.h);
      }
      ctx.fill();
    } else if (P.content === 2) {
      ctx.fillStyle = S.acc;
      ctx.strokeStyle = S.line;
      ctx.lineWidth = 7;
      const n = 7;
      for (let k = 0; k < n; k++) {
        const u = P.side < 0 ? P.w - (k + 0.7) * P.h * 1.05 : (k + 0.7) * P.h * 1.05;
        const jig = (k + B.index) % 2 === 0 ? beatJ : 0;
        D.star(ctx, u, P.h * 0.52, P.h * 0.36 * (1 + 0.25 * jig), P.h * 0.15, 5, -Math.PI / 2 + (k % 2 ? 0.25 : -0.25) + jig * 0.5);
        ctx.fill();
        ctx.stroke();
      }
    } else if (P.content === 3) {
      ctx.strokeStyle = S.ink;
      ctx.fillStyle = S.ink;
      chainPath(ctx, -40, P.h * 0.5, P.w + 40, P.h * 0.5, P.h * 0.42, 12, tau * 80 * -P.side);
    } else {
      // coarse dot grid shrinking away from the emblem
      ctx.fillStyle = S.ink;
      ctx.beginPath();
      const cell = 30;
      for (let gy = cell / 2; gy < P.h; gy += cell) {
        for (let gx = cell / 2 + ((gy / cell) & 1) * cell * 0.5; gx < P.w; gx += cell) {
          const u = P.side < 0 ? gx / P.w : 1 - gx / P.w;
          const rr = cell * 0.4 * u;
          if (rr < 1.2) continue;
          ctx.moveTo(gx + rr, gy);
          ctx.arc(gx, gy, rr, 0, TAU);
        }
      }
      ctx.fill();
      const ex = inner + (P.side < 0 ? -P.h * 0.85 : P.h * 0.85);
      ctx.fillStyle = S.fill;
      circle(ctx, ex, P.h * 0.5, P.h * 0.5);
      ctx.fill();
      drawEmblem(ctx, ex, P.h * 0.52, P.h * 0.4 * (1 + 0.1 * beatJ), -0.1, { star: C.red, slash: C.white, outline: C.black, gap: S.fill, lw: 6 });
    }
    ctx.restore();
    ctx.lineWidth = 11;
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = S.line;
    D.skewRect(ctx, 0, 0, P.w, P.h, skew);
    ctx.stroke();
    ctx.restore();
  }
  function drawStripes(ctx, env, p, K) {
    const B = beatOf(env), I = p.intensity, v = p.variant;
    const ang = [-35, 78, 55][v % 3] * DEG;
    const S = K.seqs[p.seed % K.seqs.length];
    const tau = p.lt * p.speed + rand(p.seed, 1) * 200;
    const jump = I > 0.3 ? 70 : 0;
    const off = tau * (70 + 170 * I) + (B.index + E.outExpo(clamp(B.sinceBeat / 0.16))) * jump;
    fillAll(ctx, C.black);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(ang);
    const R = Math.hypot(W, H) / 2 + OV + 60;
    let x = -R - mod(off, S.period);
    let i = 0;
    while (x < R) {
      const st = S.seq[i % S.seq.length];
      ctx.fillStyle = st.c;
      ctx.fillRect(x, -R, st.w + 1.2, 2 * R);
      x += st.w;
      i++;
    }
    ctx.restore();
    // halftone gradients (corners)
    const drift = Math.round(20 * Math.sin(tau * 0.4));
    drawCorner(ctx, K.htBL, -OV + 60 + drift, H + OV - 40);
    drawCorner(ctx, K.htTR, W + OV - 60 - drift, -OV + 40);
    // chain across the frame
    if (v % 2 === 0) {
      ctx.strokeStyle = C.black;
      ctx.fillStyle = C.black;
      const cy0 = 200 + rand(p.seed, 9) * 300;
      chainPath(ctx, -OV, cy0 + 520, W + OV, cy0 - 80, 64, 14, tau * 90);
    }
    // cut-in bands: a new one slams in on every downbeat, the previous one
    // leaves during the first 0.2 s of the next bar (≤ 2 on screen)
    const bl = B.period * 4;
    for (let b = B.bar - 1; b <= B.bar; b++) {
      const P = bandSpec(p.seed, b);
      const age = B.sinceDownbeat + (B.bar - b) * bl;
      const kIn = E.outBack(clamp(age / 0.24), 1.3);
      const out = clamp((age - bl) / 0.2);
      if (out >= 1) continue;
      const shift = P.side * (1 - kIn) * (W * 0.9) - P.side * E.inQuad(out) * (W * 1.2);
      drawBand(ctx, K, P, shift, tau, B, p.seed + b);
    }
  }

  /* ================================================================== */
  /* 6. SUNBURST — "impact burst"                                        */
  /* ================================================================== */
  // Registered as 'sunburst' (contract name) but deliberately NOT a sun: no
  // disc, no evenly spaced wedges and never red/white rays. It is a manga
  // impact panel: irregular red/black focus lines converging on an off-centre
  // point, concentric jagged shock rings, a halftone shock wave on the downbeat
  // and a black star-burst carrying the emblem. White only as thin outlines and
  // small particles.
  const SB_SCHEMES = [
    // bg, focus lines, deep lines, rings, halftone wave, outer burst, burst outline, inner burst, emblem
    { bg: C.red, line: C.black, deep: C.redDeep, ring: C.black, wave: C.black, outer: C.black, edge: C.white, shadow: C.blood, inner: C.redHot, em: { star: C.black, slash: C.white, outline: C.black, gap: C.redHot, lw: 10 }, spark: C.star },
    { bg: C.black, line: C.red, deep: C.blood, ring: C.red, wave: C.red, outer: C.red, edge: C.star, shadow: C.blood, inner: C.black, em: { star: C.red, slash: C.white, outline: C.black, gap: C.black, lw: 10 }, spark: C.star },
    { bg: C.blood, line: C.black, deep: C.red, ring: C.red, wave: C.black, outer: C.black, edge: C.red, shadow: C.ink, inner: C.red, em: { star: C.black, slash: C.white, outline: C.black, gap: C.red, lw: 10 }, spark: C.star },
  ];
  function buildSunburst() {
    return {};
  }
  // Tapered focus lines: thin triangles from far outside the frame towards
  // (cx, cy), stopping at an irregular inner radius (a clear zone around the
  // focal point). Angles, lengths and widths are all irregular.
  function focusLines(ctx, cx, cy, n, seed, epoch, rot, rIn, wMax, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let j = 0; j < n; j++) {
      const e = epoch + (j % 3); // staggered re-draw like hand-inked action lines
      const a = rot + (j + 0.9 * srand(seed, j, e)) * (TAU / n);
      const r0 = rIn * (0.85 + 0.9 * Math.pow(rand(seed, j, e + 50), 2));
      const wd = (2 + wMax * Math.pow(rand(seed, j, e + 90), 1.5)) / 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      // end just outside the overscan box (same taper as a 2300 px line)
      const tx = ca > 1e-6 ? (W + OV + 40 - cx) / ca : ca < -1e-6 ? (-OV - 40 - cx) / ca : 1e9;
      const ty = sa > 1e-6 ? (H + OV + 40 - cy) / sa : sa < -1e-6 ? (-OV - 40 - cy) / sa : 1e9;
      const R = Math.min(2300, tx, ty);
      if (R <= r0) continue;
      const hw = wd * 3 * ((R - r0) / (2300 - r0));
      ctx.moveTo(cx + ca * r0, cy + sa * r0);
      ctx.lineTo(cx + ca * R - sa * hw, cy + sa * R + ca * hw);
      ctx.lineTo(cx + ca * R + sa * hw, cy + sa * R - ca * hw);
      ctx.closePath();
    }
    ctx.fill();
  }
  // A ring of halftone dots expanding from (cx, cy): three staggered circles.
  function halftoneWave(ctx, cx, cy, r, band, size, color) {
    if (size < 0.8) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let k = -1; k <= 1; k++) {
      const rr = r + k * band;
      const s = size * (1 - 0.45 * Math.abs(k));
      const n = Math.min(120, Math.max(12, Math.round((TAU * rr) / (band * 1.1))));
      const off = (k & 1) * 0.5;
      for (let i = 0; i < n; i++) {
        const a = ((i + off) / n) * TAU;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        ctx.moveTo(x + s, y);
        ctx.arc(x, y, s, 0, TAU);
      }
    }
    ctx.fill();
  }
  function drawSunburst(ctx, env, p) {
    const B = beatOf(env), I = p.intensity, v = p.variant, q = env.quality || 1;
    const S = SB_SCHEMES[v % 3];
    const tau = p.lt * p.speed + rand(p.seed, 1) * 100;
    const side = rand(p.seed, 2) < 0.5 ? -1 : 1;
    const cx = Math.round(W * (0.5 + side * (0.17 + 0.1 * rand(p.seed, 7)))), cy = Math.round(H * (0.4 + 0.18 * rand(p.seed, 3)));
    fillAll(ctx, S.bg);
    // focus lines: a deep-tone layer and the main layer; they re-ink per beat
    // (per bar when calm) and the clear zone breathes with the pulse
    const epoch = I > 0.6 ? B.index : B.bar;
    const breathe = 1 - 0.14 * B.pulse * (0.4 + I);
    const rot = tau * 0.03 * side;
    focusLines(ctx, cx, cy, Math.round((10 + 6 * I) * q), p.seed + 5, epoch, rot + 0.07, 540 * breathe, 30, S.deep);
    focusLines(ctx, cx, cy, Math.round((42 + 34 * I) * q), p.seed, epoch, rot, 430 * breathe, 16, S.line);
    // concentric jagged shock rings drifting outward over each bar
    shockRings(ctx, cx, cy, B, p.seed + 3, { color: S.ring, r0: 500, gap: 170, n: 2, kick: 24, amp: 18, tooth: 70, lw: 11, rot: tau * 0.04, alpha: 0.5 + 0.4 * I });
    // halftone shock wave released on every downbeat
    const age = B.sinceDownbeat;
    if (age < 0.9) {
      const k = age / 0.9;
      halftoneWave(ctx, cx, cy, 300 + E.outCubic(k) * (900 + 500 * I), 26, 11 * (1 - k) * (0.6 + 0.4 * I), S.wave);
    }
    // particles streaming out (small cream sparks + black chips)
    if (I > 0.35) {
      const n = Math.round((18 + 36 * I) * q);
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass ? C.ink : S.spark;
        ctx.beginPath();
        for (let j = pass; j < n; j += 2) {
          const u0 = tau * (0.35 + 0.5 * rand(p.seed, j, 2)) + rand(p.seed, j, 1);
          const ep = Math.floor(u0), u = u0 - ep;
          const a = rand(p.seed, j, ep + 3) * TAU;
          const r = 300 + u * 1400;
          const s = 4 + 14 * u * rand(p.seed, j, 5);
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          if (pass === 0 && j % 4 === 0) {
            D.sparkle(ctx, x, y, s * 1.4, 0.2, a);
          } else if (pass === 0) {
            ctx.moveTo(x + s * 0.45, y);
            ctx.arc(x, y, s * 0.45, 0, TAU);
          } else {
            ctx.moveTo(x + Math.cos(a) * s, y + Math.sin(a) * s);
            ctx.lineTo(x + Math.cos(a + 2.4) * s * 0.6, y + Math.sin(a + 2.4) * s * 0.6);
            ctx.lineTo(x + Math.cos(a + 4) * s * 0.7, y + Math.sin(a + 4) * s * 0.7);
            ctx.closePath();
          }
        }
        ctx.fill();
      }
    }
    // star-burst + emblem (snaps on the downbeat)
    const bp = E.outBack(clamp(B.sinceDownbeat / 0.25));
    const bs = (0.92 + 0.08 * bp) * (1 + 0.05 * B.pulse * I);
    const br = -tau * 0.2;
    ctx.lineJoin = 'miter';
    ctx.fillStyle = S.shadow;
    D.burst(ctx, cx + 16, cy + 16, 250 * bs, 420 * bs, 16, p.seed + 11, 0.3, br);
    ctx.fill();
    ctx.fillStyle = S.outer;
    D.burst(ctx, cx, cy, 250 * bs, 420 * bs, 16, p.seed + 11, 0.3, br);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = S.edge;
    ctx.stroke();
    ctx.fillStyle = S.inner;
    D.burst(ctx, cx, cy, 185 * bs, 300 * bs, 12, p.seed + 12, 0.35, tau * 0.25);
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = S.outer === C.black ? C.black : C.ink;
    ctx.stroke();
    drawEmblem(ctx, cx, cy, 150 * bs, srand(p.seed, 6) * 0.25 + 0.06 * Math.sin(tau * 2), S.em);
  }

  /* ================================================================== */
  /* 7. SKY-RED                                                          */
  /* ================================================================== */
  // Cumulus made of overlapping domes on a flat base (unit: sprite pixels).
  function cloudDomes(w, h, seed) {
    const r = MV.rng(seed);
    const base = h * 0.8;
    const n = 5 + r.int(0, 2);
    const domes = [];
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const bell = Math.sin(u * Math.PI);
      const rr = h * (0.17 + 0.34 * bell * r.range(0.8, 1.15));
      domes.push([w * (0.1 + 0.8 * u) + r.range(-0.03, 0.03) * w, base - rr * r.range(0.35, 0.7), rr]);
    }
    return { domes, base, x0: w * 0.06, x1: w * 0.94 };
  }
  function cloudUnionPath(c, cl, dx, dy) {
    c.beginPath();
    for (const d of cl.domes) {
      c.moveTo(d[0] + dx + d[2], d[1] + dy);
      c.arc(d[0] + dx, d[1] + dy, d[2], 0, TAU);
    }
    c.rect(cl.x0 + dx, cl.base - 40 + dy, cl.x1 - cl.x0, 40);
  }
  function makeCloud(w, h, seed, lw) {
    const cl = cloudDomes(w, h, seed);
    const pad = 30;
    return sprite(w + pad * 2, h + pad * 2, (c) => {
      c.translate(pad, pad);
      const clipAboveBase = (extra) => {
        c.beginPath();
        c.rect(-pad, -pad, w + pad * 2, cl.base + pad + extra);
        c.clip();
      };
      // hard offset shadow
      c.save();
      clipAboveBase(14);
      c.fillStyle = C.black;
      cloudUnionPath(c, cl, 14, 14);
      c.fill();
      c.restore();
      c.save();
      clipAboveBase(0);
      // outline: stroke every dome, then fill the union over it
      c.strokeStyle = C.black;
      c.lineWidth = lw * 2;
      for (const d of cl.domes) {
        circle(c, d[0], d[1], d[2]);
        c.stroke();
      }
      c.fillStyle = C.redHot;
      cloudUnionPath(c, cl, 0, 0);
      c.fill();
      c.clip();
      // body offset down-right leaves a hot rim on the upper-left of each dome
      c.fillStyle = C.blood;
      c.beginPath();
      for (const d of cl.domes) {
        c.moveTo(d[0] + d[2] * 0.1 + d[2], d[1] + d[2] * 0.14);
        c.arc(d[0] + d[2] * 0.1, d[1] + d[2] * 0.14, d[2], 0, TAU);
      }
      c.rect(cl.x0, cl.base - 60, cl.x1 - cl.x0, 80);
      c.fill();
      D.halftone(c, 0, 0, w, cl.base, { cell: Math.max(9, Math.round(h / 22)), angle: 30 * DEG, color: C.black, fn: (u, v) => clamp((v - 0.45) * 2.2) });
      c.restore();
      c.fillStyle = C.black;
      c.fillRect(cl.x0 - lw * 0.5, cl.base - lw * 0.5, cl.x1 - cl.x0 + lw, lw);
    });
  }
  function buildSkyRed() {
    const K = {};
    rampTile('skyred-top');
    rampTile('skyred-hz');
    K.cloudsBig = [0, 1, 2].map((i) => makeCloud(880 + i * 60, 330, 900 + i, 9));
    K.cloudsSmall = [0, 1].map((i) => makeCloud(460 + i * 40, 170, 950 + i, 6));
    K.moon = moonSprite('red');
    K.roofs = makeSkyline({ seed: 7301, w: 2880, h: 360, top: [150, 280], bw: [60, 200], gap: [-4, 6], tower: 0.05, lit: [0.02, 0.1], types: [0, 2, 3, 3, 5, 1], color: C.black, win: { w: 10, h: 12, gx: 12, gy: 14, m: 12, colors: [[C.white, 2], [C.red, 1]], flicker: 0.02 }, board: C.red });
    return K;
  }
  function drawSkyRed(ctx, env, p, K) {
    const B = beatOf(env), I = p.intensity, v = p.variant, q = env.quality || 1;
    const tau = p.lt * p.speed + rand(p.seed, 1) * 300;
    fillAll(ctx, C.red);
    fillRamp(ctx, 'skyred-top', -OV);
    fillRamp(ctx, 'skyred-hz', 640);
    // cream halftone moon rising slowly over the rooftops (variants 1/2):
    // shaded and cratered, with a black orbit arc — a moon, never a sun disc
    if (v % 3 !== 0) {
      const sx = Math.round(W * (0.25 + 0.5 * rand(p.seed, 3))), sy = Math.round(610 - 50 * clamp(p.lt / p.dur));
      const orb = tau * 0.1 + 0.2 * E.outBack(clamp(B.sinceDownbeat / 0.3));
      ctx.strokeStyle = C.black;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(sx, sy, MOON_R + 22 + 10 * B.barPulse, orb, orb + 3.4);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(sx, sy, MOON_R + 48 + 16 * B.barPulse, -orb + 2, -orb + 4.4);
      ctx.stroke();
      drawMoon(ctx, K.moon, sx, sy);
    }
    // clouds: small/far ones slow, big/near ones faster
    const layers = [[K.cloudsSmall, 3, 12, [40, 260]], [K.cloudsBig, 3, 34, [60, 420]]];
    let idx = 0;
    for (const L of layers) {
      for (let k = 0; k < L[1]; k++, idx++) {
        const img = L[0][(k + idx) % L[0].length];
        const span = W + 2 * OV + img.width;
        const x = mod(rand(p.seed, idx, 1) * span + tau * L[2] * (0.6 + I), span) - OV - img.width;
        const y = lerp(L[3][0], L[3][1], rand(p.seed, idx, 2)) + 30 * Math.sin(tau * 0.2 + idx);
        ctx.drawImage(img, Math.round(x), Math.round(y));
      }
    }
    // stars popping on beats
    const nS = Math.round(34 * (0.7 + 0.3 * q));
    ctx.fillStyle = C.white;
    ctx.strokeStyle = C.black;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'miter';
    for (let k = 0; k < nS; k++) {
      const x = rand(p.seed, k, 3) * (W + 200) - 100, y = rand(p.seed, k, 4) * 620;
      const sel = mod(k + B.index * 3, 7) < 1 + Math.round(2 * I);
      const pop = sel ? E.outBack(clamp(B.sinceBeat / 0.2)) * (1 - clamp((B.sinceBeat - 0.2) / 0.4)) : 0;
      const base = 6 + 16 * rand(p.seed, k, 5);
      const s = base * (0.8 + 0.2 * Math.sin(tau * 3 + k)) * (1 + 1.1 * pop);
      if (k % 3 === 0) D.star(ctx, x, y, s * 1.2, s * 0.5, 5, -Math.PI / 2 + pop * 0.6);
      else D.sparkle(ctx, x, y, s * 1.3, 0.2, pop * 0.8);
      ctx.fill();
      if (s > 16) ctx.stroke();
    }
    drawFlocks(ctx, tau, p.seed + 5, I, C.black, [160, 540], [16, 30], q);
    const off = tau * (20 + 30 * I);
    drawStripOps(ctx, K.roofs, off, 720);
    drawFlicker(ctx, K.roofs, off, 720, env.t, p.seed, B, I);
    ctx.fillStyle = C.black;
    ctx.fillRect(-OVF, 1079, W + 2 * OVF, OVF);
    drawPoles(ctx, tau * (60 + 60 * I), p.seed + 2, { spacing: 1500, top: 330, color: C.black, birds: true, scale: 0.9 }, B);
  }

  /* ================================================================== */
  /* 8. SHARDS                                                           */
  /* ================================================================== */
  function polyPath(ctx, a, m) {
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    for (let k = 1; k < m; k++) ctx.lineTo(a[k * 2], a[k * 2 + 1]);
    ctx.closePath();
  }
  // Miter offset of a convex polygon (flat array x0,y0,x1,y1…) by d, either winding;
  // miter length limited to 3·d so sliver tips stay tidy.
  function offsetPoly(a, m, d, out) {
    let area = 0;
    for (let k = 0; k < m; k++) {
      const j = (k + 1) % m;
      area += a[k * 2] * a[j * 2 + 1] - a[j * 2] * a[k * 2 + 1];
    }
    const sg = area >= 0 ? 1 : -1;
    for (let k = 0; k < m; k++) {
      const i = (k + m - 1) % m, j = (k + 1) % m;
      let e1x = a[k * 2] - a[i * 2], e1y = a[k * 2 + 1] - a[i * 2 + 1];
      let e2x = a[j * 2] - a[k * 2], e2y = a[j * 2 + 1] - a[k * 2 + 1];
      const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
      e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
      const n1x = sg * e1y, n1y = -sg * e1x, n2x = sg * e2y, n2y = -sg * e2x;
      let mx = n1x + n2x, my = n1y + n2y;
      const kk = 1 + n1x * n2x + n1y * n2y;
      let f = kk > 1e-3 ? d / kk : d * 3;
      const ml = Math.hypot(mx, my) * f;
      if (ml > d * 3) f *= (d * 3) / ml;
      out[k * 2] = a[k * 2] + mx * f;
      out[k * 2 + 1] = a[k * 2 + 1] + my * f;
    }
  }
  function fracture(seed) {
    const r = MV.rng(seed * 13 + 5);
    const nA = 13 + r.int(0, 4);
    const angles = [];
    for (let i = 0; i < nA; i++) angles.push(((i + r.range(-0.32, 0.32)) / nA) * TAU);
    const radii = [0, 80, 190, 340, 540, 800, 1120, 1520];
    const rad = angles.map(() => radii.map((R, j) => (j === 0 ? 0 : R * r.range(0.8, 1.2))));
    const shards = [];
    // Colours by ring: the impact core is dark (black / red), light panes only
    // further out — the web must never read as red/white wedges around a centre.
    const cols = [[C.red, 0.42], [C.white, 0.24], [C.black, 0.34]];
    const colsCore = [[C.black, 0.55], [C.red, 0.45]];
    let ring = 0;
    const push = (pts) => {
      let gx = 0, gy = 0;
      for (const q of pts) { gx += q[0]; gy += q[1]; }
      gx /= pts.length; gy /= pts.length;
      const loc = pts.map((q) => [(q[0] - gx) * 0.93, (q[1] - gy) * 0.93]);
      const i = shards.length;
      shards.push({
        gx, gy, d: Math.hypot(gx, gy), pts: loc,
        col: ring === 0 ? (r.next(), C.black) : pickW(ring < 3 ? colsCore : cols, r.next()),
        k1: r.next(), k2: r.next(), k3: r.next(), k4: r.next(), k5: r.next(), i,
      });
    };
    for (let a = 0; a < nA; a++) {
      const b = (a + 1) % nA;
      const a0 = angles[a], a1 = a === nA - 1 ? angles[0] + TAU : angles[b];
      const P = (ang, rr) => [Math.cos(ang) * rr, Math.sin(ang) * rr];
      for (let j = 0; j < radii.length - 1; j++) {
        ring = j;
        const q0 = P(a0, rad[a][j]), q1 = P(a1, rad[b][j]), q2 = P(a1, rad[b][j + 1]), q3 = P(a0, rad[a][j + 1]);
        if (j === 0) push([[0, 0], q2, q3]);
        else if (r.chance(0.35)) {
          push([q0, q1, q2]);
          push([q0, q2, q3]);
        } else push([q0, q1, q2, q3]);
      }
    }
    return shards;
  }
  function buildShards() {
    const K = { fr: [1, 2, 3].map(fracture) };
    K.htRed = radialQuad(C.redDeep);
    K.htBlack = radialQuad(C.black);
    K.buf = [];
    return K;
  }
  function drawShards(ctx, env, p, K) {
    const B = beatOf(env), I = p.intensity, v = p.variant, q = env.quality || 1;
    const scheme = v % 3;
    const bg = [C.black, C.white, C.red][scheme];
    const tau = p.lt * p.speed + rand(p.seed, 1) * 100;
    const ix = W * (0.3 + 0.4 * rand(p.seed, 2)), iy = H * (0.35 + 0.3 * rand(p.seed, 3));
    const shards = K.fr[p.seed % K.fr.length];
    fillAll(ctx, bg);
    drawRadialHalftone(ctx, scheme === 0 ? K.htRed : K.htBlack, ix, iy);
    const amt = (b) => (mod(b, 4) === 0 ? 0.14 : 0.4 + 0.6 * rand(p.seed, b, 3)) * (0.35 + 0.65 * I);
    const kSnap = E.outBack(clamp(B.sinceDownbeat / 0.28), 1.4);
    const A = lerp(amt(B.bar - 1), amt(B.bar), kSnap) + 0.1 * B.barPhase * (0.3 + I);
    const list = K.buf;
    list.length = 0;
    const colFlip = { [C.red]: C.blood, [C.white]: C.red, [C.black]: C.gray };
    for (let n = 0; n < shards.length; n++) {
      const s = shards[n];
      const dx = s.d > 0 ? s.gx / s.d : 0, dy = s.d > 0 ? s.gy / s.d : 0;
      const push = A * (140 + s.d * 0.55) * (0.6 + 0.8 * s.k1);
      const side = A * 90 * (s.k2 - 0.5);
      const z = 1 + A * (s.k3 * 1.1 - 0.25);
      const wob = Math.sin(tau * (0.6 + s.k4) + s.i) * A;
      const px = ix + (s.gx + dx * push - dy * side) * z + wob * 20;
      const py = iy + (s.gy + dy * push + dx * side) * z + wob * 14;
      const rz = A * (s.k4 - 0.5) * 3 + wob * 0.3;
      // tumble: bounded oscillation scaled by A (a regrouped pane stays flat)
      const ry = A * (s.k5 * 3.2 + 1.6 * Math.sin(tau * (0.5 + s.k1) + s.i));
      const rx = A * (s.k2 * 2.4 + 1.3 * Math.sin(tau * (0.4 + s.k3) + s.i * 1.7));
      list.push({ s, px, py, z, rz, cy: Math.cos(ry), cx: Math.cos(rx) });
    }
    list.sort((a, b) => a.z - b.z);
    // Each shard: outline = fill of its miter-offset polygon, then the face on
    // top (two fills are ~3× cheaper than fill + thick stroke in software raster).
    const px = K.px || (K.px = new Float64Array(16)), ox = K.ox || (K.ox = new Float64Array(16));
    for (let n = 0; n < list.length; n++) {
      const e = list[n], s = e.s;
      const m = s.pts.length;
      const ca = Math.cos(e.rz), sa = Math.sin(e.rz);
      const kx = e.cy * e.z, ky = e.cx * e.z;
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (let k = 0; k < m; k++) {
        const lx = s.pts[k][0], ly = s.pts[k][1];
        const x = e.px + (lx * ca - ly * sa) * kx, y = e.py + (lx * sa + ly * ca) * ky;
        px[k * 2] = x;
        px[k * 2 + 1] = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const lw = 3.5 + 3.5 * Math.min(1.6, e.z);
      if (maxX + lw * 3 < -OV || minX - lw * 3 > W + OV || maxY + lw * 3 < -OV || minY - lw * 3 > H + OV) continue;
      const face = e.cy * e.cx;
      let col = face >= 0 ? s.col : colFlip[s.col];
      if (Math.abs(face) < 0.12 && A > 0.2) col = C.white;
      offsetPoly(px, m, lw, ox);
      ctx.fillStyle = col === C.black || col === C.gray ? (scheme === 0 ? C.white : C.red) : C.black;
      polyPath(ctx, ox, m);
      ctx.fill();
      ctx.fillStyle = col;
      polyPath(ctx, px, m);
      ctx.fill();
      // glass glint on bigger light shards: a red sliver between two edge midpoints
      if (col === C.white && maxX - minX > 90 && face > 0 && m >= 3) {
        let gx = 0, gy = 0;
        for (let k = 0; k < m; k++) {
          gx += px[k * 2];
          gy += px[k * 2 + 1];
        }
        gx /= m;
        gy /= m;
        const k2 = m === 3 ? 1 : 2;
        const ax = (px[0] + px[2]) / 2, ay = (px[1] + px[3]) / 2;
        const bx = (px[k2 * 2] + px[((k2 + 1) % m) * 2]) / 2, by = (px[k2 * 2 + 1] + px[((k2 + 1) % m) * 2 + 1]) / 2;
        ctx.strokeStyle = C.red;
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(gx + (ax - gx) * 0.8, gy + (ay - gy) * 0.8);
        ctx.lineTo(gx + (bx - gx) * 0.8, gy + (by - gy) * 0.8);
        ctx.stroke();
      }
    }
    // fragments bursting out on every downbeat
    const age = B.sinceDownbeat;
    if (age < 0.9 && I > 0.3) {
      const nF = Math.round((18 + 30 * I) * q);
      ctx.fillStyle = scheme === 1 ? C.black : C.white;
      ctx.beginPath();
      for (let j = 0; j < nF; j++) {
        const a = rand(p.seed, B.bar, j) * TAU;
        const d = (80 + 900 * rand(p.seed, B.bar, j + 99)) * E.outExpo(clamp(age / 0.6));
        const x = ix + Math.cos(a) * d, y = iy + Math.sin(a) * d;
        const sz = (6 + 18 * rand(p.seed, j, 7)) * (1 - age / 0.9);
        const ra = a + age * 6;
        ctx.moveTo(x + Math.cos(ra) * sz, y + Math.sin(ra) * sz);
        ctx.lineTo(x + Math.cos(ra + 2.3) * sz * 0.6, y + Math.sin(ra + 2.3) * sz * 0.6);
        ctx.lineTo(x + Math.cos(ra + 4.1) * sz * 0.8, y + Math.sin(ra + 4.1) * sz * 0.8);
        ctx.closePath();
      }
      ctx.fill();
    }
  }

  /* ================================================================== */
  /* 9. STARFIELD                                                        */
  /* ================================================================== */
  function yagi(c, x, y, h, r) {
    c.fillRect(Math.round(x - 1.5), y - h, 3, h);
    const L = 40 + r.range(0, 34);
    c.fillRect(Math.round(x - L * 0.3), y - h, Math.round(L), 3);
    const n = 5 + r.int(0, 3);
    for (let i = 0; i < n; i++) {
      const ex = x - L * 0.3 + (i / (n - 1)) * L;
      const eh = 8 + (1 - i / n) * 12;
      c.fillRect(Math.round(ex - 1), Math.round(y - h - eh / 2), 2, Math.round(eh));
    }
    if (r.chance(0.5)) {
      const y2 = y - h * 0.62, L2 = L * 0.6;
      c.fillRect(Math.round(x - L2 * 0.3), y2, Math.round(L2), 2);
      for (let i = 0; i < 4; i++) c.fillRect(Math.round(x - L2 * 0.3 + i * L2 / 3 - 1), y2 - 5, 2, 10);
    }
  }
  // Sitting faceless figure (side view, looking up at the sky). Hip at (x,y),
  // s ≈ standing height. kind 0: legs dangling over the edge, 1: hugging knees.
  function sitter(c, x, y, s, dir, lean, kind) {
    c.save();
    c.translate(x, y);
    c.scale(s * dir, s);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const sx = -0.05 - lean * 0.1, sy = -0.36;
    const stroke = (pts, w) => {
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
      c.stroke();
    };
    stroke([[0.02, -0.05], [sx, sy]], 0.22);
    stroke([[sx, sy - 0.02], [sx - 0.01 - lean * 0.03, sy - 0.08]], 0.08);
    circle(c, sx - 0.02 - lean * 0.06, sy - 0.15, 0.092);
    c.fill();
    if (kind === 1) {
      stroke([[0.0, -0.03], [0.2, -0.2], [0.27, 0.0]], 0.13);
      stroke([[sx + 0.02, sy + 0.06], [0.17, -0.18]], 0.08);
    } else {
      stroke([[sx - 0.01, sy + 0.04], [-0.19, -0.13], [-0.23, 0.0]], 0.08);
      stroke([[0.0, -0.03], [0.27, -0.04], [0.3, 0.3]], 0.13);
    }
    c.restore();
  }
  const SF = { roofH: 700, sky: 600 }; // rooftop strip height; per-frame sky elements stay above y = sky
  function buildStarfield() {
    const K = {};
    const SW = W + OV * 2, SH = H + OV * 2;
    K.sky = sprite(SW, SH, (c, w, h) => {
      c.fillStyle = C.night;
      c.fillRect(0, 0, w, h);
      // navy halftone deepening toward the horizon
      D.halftone(c, 0, 0, w, h, { cell: 18, angle: 20 * DEG, color: C.navy, fn: (u, v) => 1.08 * Math.pow(clamp((v - 0.12) / 0.8), 1.25) });
      // milky-way band at −35°
      c.save();
      c.translate(w * 0.52, h * 0.42);
      c.rotate(-35 * DEG);
      D.halftone(c, -w, -230, 2 * w, 460, { cell: 16, angle: 0, color: C.navy, fn: (u, v) => 0.95 * Math.pow(1 - Math.abs(v - 0.5) * 2, 0.8) * (0.7 + 0.3 * MV.noise1(u * 30, 3)) });
      D.halftone(c, -w, -130, 2 * w, 260, { cell: 10, angle: 0, color: rgba(C.cyan, 0.28), fn: (u, v) => 0.85 * (1 - Math.abs(v - 0.5) * 2) * (0.5 + 0.5 * MV.noise1(u * 55, 5)) });
      const r = MV.rng(9101);
      c.fillStyle = C.star;
      for (let i = 0; i < 1400; i++) {
        const x = r.range(-w, w), y = (r.next() + r.next() + r.next() - 1.5) * 170;
        const s = r.range(0.8, 2.4);
        c.globalAlpha = r.range(0.3, 1);
        c.fillRect(x, y, s, s);
      }
      c.restore();
      c.globalAlpha = 1;
      // red horizon glow (halftone: dot size encodes tone)
      D.halftone(c, 0, h * 0.5, w, h * 0.42, { cell: 16, angle: 20 * DEG, color: C.redDeep, fn: (u, v) => 1.05 * Math.pow(clamp((v - 0.18) / 0.62), 1.4) * (0.8 + 0.2 * Math.sin(u * 7 + 1)) });
      D.halftone(c, 0, h * 0.56, w, h * 0.3, { cell: 12, angle: 20 * DEG, color: C.red, fn: (u, v) => 0.95 * Math.pow(clamp((v - 0.15) / 0.75), 1.5) });
      starDust(c, 9102, w, h, 1300, C.star, [0.8, 2.2], 0.72);
      starDust(c, 9103, w, h, 160, C.white, [2, 3.4], 0.66);
      const r2 = MV.rng(9104);
      c.fillStyle = C.star;
      for (let i = 0; i < 26; i++) {
        D.sparkle(c, r2.range(0, w), r2.range(0, h * 0.62), r2.range(5, 10), 0.18, 0);
        c.fill();
      }
      c.save();
      c.translate(0, h - SF.roofH);
      paintRooftops(c, w, SF.roofH, 9201);
      c.restore();
    });
    // The static rooftop silhouette is baked into the sky sprite (one blit per
    // frame, no second full-width layer); per-frame sky elements stay above it.
    K.constellations = new Map();
    return K;
  }
  // Residential rooftops (black), TV antennas, a utility pole with wires and three
  // faceless friends sitting on a flat roof looking up. Strip bottom = screen
  // bottom + OV; screen y = strip y + (H + OV − h).
  function paintRooftops(c, w, h, seed) {
    const r = MV.rng(seed);
    const y0 = H + OV - h;
    const Y = (screenY) => screenY - y0;
    c.fillStyle = C.black;
    const peopleX = w * 0.57;
    const wins = [];
    let x = -30, people = false;
    while (x < w + 30) {
      const u = r.next();
      if (!people && x > peopleX - 300) {
        const bw = 380, top = Y(900);
        c.fillRect(x, top, bw, h - top);
        c.fillRect(x - 8, top - 8, bw + 16, 10);
        for (let k = 0; k < 8; k++) c.fillRect(x + 4 + k * 53, top - 30, 4, 24);
        c.fillRect(x, top - 32, bw, 4);
        sitter(c, x + 140, top - 12, 140, -1, 0.8, 0);
        sitter(c, x + 214, top - 12, 128, -1, 0.35, 1);
        sitter(c, x + 292, top - 12, 136, 1, 0.6, 0);
        wins.push([x + 40, top + 70], [x + 250, top + 120]);
        x += bw + 14;
        people = true;
        continue;
      }
      if (u < 0.5) {
        // house: wall + gable roof (+ sometimes a second, lower gable) + TV antenna
        const hw = r.range(150, 260), wallTop = Y(r.range(915, 975)), roofH = r.range(46, 84);
        c.fillRect(x, wallTop, hw, h - wallTop);
        const peak = x + hw * r.range(0.35, 0.65);
        c.beginPath();
        c.moveTo(x - 18, wallTop + 8);
        c.lineTo(peak, wallTop - roofH);
        c.lineTo(x + hw + 18, wallTop + 8);
        c.closePath();
        c.fill();
        if (r.chance(0.4)) {
          const x2 = x + hw * 0.62, w2 = hw * 0.55, t2 = wallTop + 26;
          c.beginPath();
          c.moveTo(x2 - 12, t2 + 6);
          c.lineTo(x2 + w2 / 2, t2 - roofH * 0.6);
          c.lineTo(x2 + w2 + 12, t2 + 6);
          c.closePath();
          c.fill();
          c.fillRect(x2, t2, w2, h - t2);
        }
        if (r.chance(0.85)) yagi(c, peak + r.range(-40, 40), wallTop - roofH * 0.55, r.range(56, 100), r);
        if (r.chance(0.55)) wins.push([x + r.range(20, hw - 40), wallTop + r.range(26, 60)]);
        x += hw + r.range(-10, 18);
      } else if (u < 0.72) {
        // apartment block with railing, water tank and a few lit windows
        const bw = r.range(200, 320), top = Y(r.range(800, 870));
        c.fillRect(x, top, bw, h - top);
        c.fillRect(x - 4, top - 6, bw + 8, 8);
        for (let k = 0; k <= bw / 40; k++) c.fillRect(x + k * 40, top - 22, 3, 18);
        c.fillRect(x, top - 24, bw, 3);
        if (r.chance(0.7)) {
          const tw = 44, tx = x + r.range(20, bw - 64);
          c.fillRect(tx + 5, top - 30, 4, 30);
          c.fillRect(tx + tw - 9, top - 30, 4, 30);
          c.fillRect(tx, top - 30 - 40, tw, 40);
          c.beginPath();
          c.moveTo(tx, top - 70);
          c.lineTo(tx + tw / 2, top - 84);
          c.lineTo(tx + tw, top - 70);
          c.fill();
        }
        yagi(c, x + r.range(20, bw - 20), top - 22, r.range(40, 70), r);
        const rows = 3, cols = Math.floor(bw / 60);
        for (let ry = 0; ry < rows; ry++) for (let cx = 0; cx < cols; cx++) if (r.chance(0.18)) wins.push([x + 22 + cx * 60, top + 40 + ry * 70]);
        x += bw + r.range(0, 14);
      } else if (u < 0.86) {
        // low shop with a lit sign
        const bw = r.range(160, 240), top = Y(r.range(950, 990));
        c.fillRect(x, top, bw, h - top);
        c.fillStyle = r.chance(0.5) ? C.red : C.star;
        c.fillRect(x + 20, top + 16, bw - 40, 22);
        c.fillStyle = C.black;
        c.fillRect(x + 30 + (bw - 60) * 0.3, top + 16, 6, 22);
        x += bw + r.range(0, 16);
      } else {
        // tree clump
        const tr = r.range(50, 80), base = Y(r.range(930, 970));
        for (let k = 0; k < 6; k++) {
          circle(c, x + tr + r.range(-tr, tr), base - r.range(0, tr * 1.3), tr * r.range(0.55, 0.95));
          c.fill();
        }
        c.fillRect(x + tr * 0.4, base, tr * 1.2, h - base);
        x += tr * 2.2;
      }
    }
    for (const wv of wins) {
      c.fillStyle = r.chance(0.2) ? C.red : r.chance(0.5) ? C.yellow : C.star;
      c.fillRect(Math.round(wv[0]), Math.round(wv[1]), 18, 22);
      c.fillStyle = C.black;
      c.fillRect(Math.round(wv[0]) + 8, Math.round(wv[1]), 2, 22);
    }
    // utility pole + sagging wires across the frame
    c.fillStyle = C.black;
    const px = w * 0.17, ptop = Y(620);
    poleShape(c, px, ptop, h, 0.85);
    c.strokeStyle = C.black;
    c.lineWidth = 3;
    c.beginPath();
    for (let k = 0; k < 4; k++) {
      const ax = px + POLE_ATTACH[k][0] * 0.85, ay = ptop + POLE_ATTACH[k][1] * 0.85;
      c.moveTo(-20, ay + 70 + k * 6);
      c.quadraticCurveTo(ax / 2, ay + 120 + k * 8, ax, ay);
      c.quadraticCurveTo(ax + (w - ax) / 2, ay + 230 + k * 16, w + 20, ay + 70 + k * 12);
    }
    c.stroke();
  }
  function constellationsFor(K, seed) {
    const key = seed % 16;
    if (K.constellations.has(key)) return K.constellations.get(key);
    const r = MV.rng(seed * 31 + 7);
    const list = [];
    // a big five-point star constellation (pentagram order) – the song's motif
    const sx = r.range(560, 1360), sy = r.range(230, 360), sr = r.range(140, 190), rot = r.range(-0.3, 0.3);
    const pts = [];
    for (let i = 0; i < 5; i++) {
      const a = rot - Math.PI / 2 + (i * TAU) / 5;
      pts.push([sx + Math.cos(a) * sr * r.range(0.85, 1.1), sy + Math.sin(a) * sr * r.range(0.85, 1.1)]);
    }
    list.push({ pts: [pts[0], pts[2], pts[4], pts[1], pts[3], pts[0]], big: true });
    for (let n = 0; n < 2; n++) {
      const ox = n === 0 ? r.range(120, 460) : r.range(1450, 1780), oy = r.range(120, 420);
      const cp = [[ox, oy]];
      let a = r.range(0, TAU);
      for (let i = 0; i < 4 + r.int(0, 2); i++) {
        a += r.range(-1.2, 1.2);
        const l = r.range(60, 130);
        const last = cp[cp.length - 1];
        cp.push([last[0] + Math.cos(a) * l, clamp(last[1] + Math.sin(a) * l, 60, 600)]);
      }
      list.push({ pts: cp, big: false });
    }
    K.constellations.set(key, list);
    return list;
  }
  function drawStarfield(ctx, env, p, K) {
    const B = beatOf(env), I = p.intensity, q = env.quality || 1;
    const tau = p.lt * p.speed + rand(p.seed, 1) * 100;
    // sky + rooftops, with a very slow sideways drift
    const sx = -OV + Math.round(10 * Math.sin(tau * 0.05)), sr = sx + K.sky.width;
    ctx.drawImage(K.sky, sx, -OV);
    ctx.fillStyle = C.night;
    ctx.fillRect(-OVF, -OVF, W + 2 * OVF, OVF - OV);
    ctx.fillRect(-OVF, -OV, sx + OVF, 1000 + OV);
    ctx.fillRect(sr, -OV, W + OVF - sr, 1000 + OV);
    ctx.fillStyle = C.black;
    ctx.fillRect(-OVF, 1000, sx + OVF, H + OVF);
    ctx.fillRect(sr, 1000, W + OVF - sr, H + OVF);
    ctx.fillRect(-OVF, H + OV - 1, W + 2 * OVF, OVF);
    // mid-layer stars drifting slowly (parallax), twinkling
    const drift = tau * 5;
    const nM = Math.round(170 * q);
    ctx.fillStyle = C.star;
    ctx.beginPath();
    for (let k = 0; k < nM; k++) {
      const x = mod(rand(9301, k, 1) * (W + 400) - drift, W + 400) - 200;
      const y = rand(9301, k, 2) * (SF.sky + 60) - 60;
      const tw = 0.6 + 0.4 * Math.sin(tau * (1 + 2 * rand(9301, k, 3)) + k);
      const s = (1.6 + 2.4 * rand(9301, k, 4)) * tw;
      ctx.rect(x - s / 2, y - s / 2, s, s);
    }
    ctx.fill();
    // twinkling 4-point sparkles with a flat halo; a few red ones
    const nSp = Math.round(28 * (0.7 + 0.3 * q));
    const sp = [];
    for (let k = 0; k < nSp; k++) {
      const x = rand(p.seed + 3, k, 1) * W, y = 30 + rand(p.seed + 3, k, 2) * (SF.sky - 40);
      const tw = 0.5 + 0.5 * Math.sin(tau * (0.8 + 1.6 * rand(p.seed, k, 3)) + k * 2.1);
      const pop = mod(k + B.index, 6) === 0 ? B.pulse * (0.25 + 0.9 * I) : 0;
      const s = (7 + 20 * Math.pow(rand(p.seed + 3, k, 4), 2)) * (0.45 + 0.55 * tw + pop);
      sp.push([x, y, s, k % 9 === 4]);
    }
    ctx.fillStyle = rgba(C.cyan, 0.22);
    ctx.beginPath();
    for (const e of sp) if (e[2] > 12) D.sparkle(ctx, e[0], e[1], e[2] * 1.7, 0.08, 0);
    ctx.fill();
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass ? C.red : C.star;
      ctx.beginPath();
      for (const e of sp) if (e[3] === !!pass) D.sparkle(ctx, e[0], e[1], e[2], 0.13, 0);
      ctx.fill();
    }
    // constellations slowly connecting over the cue (all joined at high intensity)
    const cons = constellationsFor(K, p.seed);
    const prog = clamp((p.lt + 0.5) / Math.max(2, p.dur * 0.85));
    const total = cons.reduce((sum, cn) => sum + cn.pts.length - 1, 0);
    let rem = prog * total + (I > 0.8 ? total : 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const cn of cons) {
      const segs = cn.pts.length - 1;
      const show = clamp(rem, 0, segs);
      rem -= segs;
      if (show <= 0) continue;
      ctx.beginPath();
      let tip = cn.pts[0];
      for (let k = 0; k < Math.ceil(show); k++) {
        const a = cn.pts[k], b = cn.pts[k + 1];
        const f = Math.min(1, show - k);
        tip = [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(tip[0], tip[1]);
      }
      if (cn.big) {
        ctx.strokeStyle = rgba(C.cyan, 0.26);
        ctx.lineWidth = 16 + 10 * B.barPulse * I;
        ctx.stroke();
      }
      ctx.strokeStyle = cn.big ? C.star : rgba(C.star, 0.6);
      ctx.lineWidth = cn.big ? 3.5 + 2 * B.barPulse * I : 2;
      if (!cn.big) ctx.setLineDash([10, 9]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.star;
      ctx.beginPath();
      for (let k = 0; k <= Math.floor(show) && k < cn.pts.length; k++) D.sparkle(ctx, cn.pts[k][0], cn.pts[k][1], cn.big ? 16 : 10, 0.18, 0);
      ctx.fill();
      if (show < segs) {
        ctx.fillStyle = C.white;
        D.sparkle(ctx, tip[0], tip[1], 22 + 8 * Math.sin(tau * 9), 0.14, tau);
        ctx.fill();
      }
    }
    // shooting stars / meteor shower (intensity)
    const Ls = 2.4 / (1 + 2.5 * I);
    const s0 = Math.floor(tau / Ls);
    const per = 1 + Math.floor(I * I * 5);
    for (let sl = s0 - 3; sl <= s0; sl++) {
      for (let m = 0; m < per; m++) {
        const id = m * 7;
        if (rand(p.seed, sl, id + 1) > 0.4 + 0.6 * I) continue;
        const t0 = sl * Ls + rand(p.seed, sl, id + 2) * Ls;
        const life = 0.7 + 0.5 * rand(p.seed, sl, id + 3);
        const age = (tau - t0) / life;
        if (age < 0 || age > 1) continue;
        const ang = (145 + 20 * srand(p.seed, sl, id + 4)) * DEG;
        const x0 = 300 + rand(p.seed, sl, id + 5) * (W + 200), y0 = -40 + rand(p.seed, sl, id + 6) * 360;
        const dist = 700 + 500 * I;
        const hx = x0 + Math.cos(ang) * dist * age, hy = y0 + Math.sin(ang) * dist * age;
        // burns out before reaching the rooftops (they are baked into the sky)
        const fade = clamp((SF.sky + 10 - hy) / 150);
        if (fade <= 0) continue;
        const tail = (200 + 280 * I) * Math.min(1, age * 3) * (1 - age * 0.6);
        const nx = -Math.sin(ang), ny = Math.cos(ang);
        const wd = 4;
        // stepped (flat) tail: three segments of falling opacity
        for (let seg = 0; seg < 3; seg++) {
          const f0 = seg / 3, f1 = (seg + 1) / 3;
          const ax = hx - Math.cos(ang) * tail * f0, ay = hy - Math.sin(ang) * tail * f0;
          const bx = hx - Math.cos(ang) * tail * f1, by = hy - Math.sin(ang) * tail * f1;
          const w0 = wd * (1 - f0), w1 = wd * (1 - f1);
          ctx.fillStyle = rgba(C.star, (0.95 - seg * 0.3) * (1 - age * 0.6) * fade);
          ctx.beginPath();
          ctx.moveTo(ax + nx * w0, ay + ny * w0);
          ctx.lineTo(ax - nx * w0, ay - ny * w0);
          ctx.lineTo(bx - nx * w1, by - ny * w1);
          ctx.lineTo(bx + nx * w1, by + ny * w1);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillStyle = C.white;
        ctx.globalAlpha = fade;
        D.sparkle(ctx, hx, hy, 14 * (1 - age * 0.5), 0.18, 0);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  /* ================================================================== */
  /* 10. VOID                                                            */
  /* ================================================================== */
  // Ink blot at (cx,cy): halftone fog around a noisy flat core, plus droplets.
  function paintInk(c, cx, cy, R, seed, color, dot) {
    const S = R * 2.6;
    D.halftone(c, cx - S / 2, cy - S / 2, S, S, {
      cell: 16, angle: 30 * DEG, color: dot,
      fn: (u, v) => clamp(1.1 - Math.hypot(u - 0.5, v - 0.5) * 2.5 + 0.4 * MV.noise2(u * 5, v * 5, seed)),
    });
    c.fillStyle = color;
    for (let lobe = 0; lobe < 4; lobe++) {
      const lx = cx + srand(seed, lobe, 1) * R * 0.35, ly = cy + srand(seed, lobe, 2) * R * 0.35;
      const rr0 = R * (0.2 + 0.16 * rand(seed, lobe, 3));
      c.beginPath();
      for (let k = 0; k <= 90; k++) {
        const a = (k / 90) * TAU;
        const rr = rr0 * (1 + 0.34 * MV.noise1(a * 2.5 + lobe * 10, seed) + 0.12 * MV.noise1(a * 9 + lobe * 3, seed + 1));
        const x = lx + Math.cos(a) * rr, y = ly + Math.sin(a) * rr;
        if (k === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.closePath();
      c.fill();
    }
    for (let k = 0; k < 7; k++) {
      const a = rand(seed, k, 5) * TAU, d = R * (0.6 + 0.5 * rand(seed, k, 6));
      circle(c, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 3 + 11 * rand(seed, k, 7));
      c.fill();
    }
  }
  function scrapSprite(kind, seed) {
    const r = MV.rng(seed);
    const w = Math.round(kind === 6 ? 220 : r.range(80, 200)), h = Math.round(kind === 6 ? 150 : r.range(60, 160));
    const pad = 16;
    return sprite(w + pad * 2, h + pad * 2, (c) => {
      c.translate(pad, pad);
      c.fillStyle = rgba(C.ink, 0.85);
      D.roughRect(c, 7, 7, w - 6, h - 6, seed, 4, 16);
      c.fill();
      const fill = [C.paper, C.paper, C.red, C.paper, C.black, C.white, C.red, C.paper][kind];
      c.fillStyle = fill;
      D.roughRect(c, 0, 0, w - 6, h - 6, seed, 4, 16);
      c.fill();
      c.save();
      c.clip();
      if (kind === 1) {
        c.fillStyle = C.gray;
        for (let y = 14; y < h; y += 13) c.fillRect(8, y, w * r.range(0.5, 0.9), 4);
      } else if (kind === 3) {
        D.halftone(c, 0, 0, w, h, { cell: 10, color: C.red, fn: (u, v) => 0.9 * (1 - u) });
      } else if (kind === 4) {
        c.strokeStyle = C.white;
        c.lineWidth = 5;
        c.strokeRect(8, 8, w - 22, h - 22);
      } else if (kind === 6) {
        drawEmblem(c, w * 0.5, h * 0.5, h * 0.38, -0.1, { star: C.white, slash: C.black, outline: C.black, gap: C.red, lw: 5 });
      } else if (kind === 7) {
        c.fillStyle = MV.patterns.stripes(c, { width: 12, colors: [C.black, C.paper] });
        c.fillRect(0, 0, w, h);
      } else if (kind === 5) {
        c.fillStyle = C.black;
        D.star(c, w * 0.5, h * 0.5, h * 0.35, h * 0.15);
        c.fill();
      }
      c.restore();
    });
  }
  function buildVoid() {
    const K = {};
    const ink = (R, seed, col, dot) => sprite(Math.ceil(R * 2.7), Math.ceil(R * 2.7), (c, w, h) => paintInk(c, w / 2, h / 2, R, seed, col, dot));
    K.fog = [ink(270, 6101, C.blood, C.blood), ink(330, 6102, C.blood, C.redDeep), ink(210, 6103, C.redDeep, C.blood)];
    K.fogAt = [[0.2, 0.3], [0.78, 0.68], [0.5, 0.98]];
    K.blobs = [0, 1].map((i) => sprite(400, 400, (c) => paintInk(c, 200, 200, 150, 6110 + i, i ? C.redDeep : C.blood, C.blood)));
    K.scraps = [];
    for (let k = 0; k < 8; k++) K.scraps.push(scrapSprite(k, 6200 + k));
    K.dots = radialQuad(C.white, -1, 1); // shared with stripes; drawn faint (≈ C.gray on black)
    return K;
  }
  function drawVoid(ctx, env, p, K) {
    const B = beatOf(env), I = p.intensity, q = env.quality || 1;
    const tau = p.lt * p.speed + rand(p.seed, 1) * 300;
    fillAll(ctx, C.black);
    ctx.globalAlpha = 0.1;
    drawCorner(ctx, K.dots, W + OV, -OV);
    ctx.globalAlpha = 1;
    // drifting ink fog (integer blits, no rotation: cheap in software raster too)
    ctx.globalAlpha = 0.62 + 0.18 * I + 0.1 * B.barPulse;
    const fx = -OV - 380 + Math.round(170 * (1 + Math.sin(tau * 0.045 + p.seed)) + 40 * rand(p.seed, 9));
    const fy = -OV - 280 + Math.round(120 * (1 + Math.sin(tau * 0.03 + 1)) + 40 * rand(p.seed, 10));
    const FW = W + OV * 2 + 400, FH = H + OV * 2 + 300;
    for (let k = 0; k < K.fog.length; k++) {
      const img = K.fog[k];
      ctx.drawImage(img, fx + Math.round(K.fogAt[k][0] * FW - img.width / 2), fy + Math.round(K.fogAt[k][1] * FH - img.height / 2));
    }
    for (let k = 0; k < 2; k++) {
      const img = K.blobs[k];
      const x = Math.round(W * (0.25 + 0.5 * rand(p.seed, k, 2)) + 320 * MV.noise1(tau * 0.05 + k * 3, p.seed) - img.width / 2);
      const y = Math.round(H * (0.25 + 0.5 * rand(p.seed, k, 3)) + 200 * MV.noise1(tau * 0.04 + k * 5, p.seed + 1) - img.height / 2);
      ctx.drawImage(img, x, y);
    }
    ctx.globalAlpha = 1;
    // a faint red slash on each downbeat
    if (B.sinceDownbeat < 0.5) {
      const k = B.sinceDownbeat / 0.5;
      const y = 200 + rand(p.seed, B.bar, 1) * 680;
      ctx.save();
      ctx.globalAlpha = (1 - k) * (0.35 + 0.5 * I);
      ctx.translate(W / 2, y);
      ctx.rotate(-12 * DEG);
      ctx.fillStyle = C.red;
      const L = 900 + 800 * E.outExpo(k);
      D.skewRect(ctx, -L / 2, -6, L, 12, 30);
      ctx.fill();
      ctx.restore();
    }
    // floating paper scraps (one is the red card with the emblem)
    const nS = Math.round(11 * (0.6 + 0.4 * q));
    for (let k = 0; k < nS; k++) {
      // k = 0 is the single red card with the emblem; the rest are plain scraps
      const pick = Math.floor(rand(p.seed, k, 1) * (K.scraps.length - 1));
      const img = k === 0 ? K.scraps[6] : K.scraps[pick >= 6 ? pick + 1 : pick];
      const depth = 0.55 + 0.7 * rand(p.seed, k, 2);
      const spanX = W + 2 * OV + 300, spanY = H + 2 * OV + 300;
      const x = mod(rand(p.seed, k, 3) * spanX + tau * 18 * depth, spanX) - OV - 150 + 40 * Math.sin(tau * 0.7 + k);
      const y = mod(rand(p.seed, k, 4) * spanY + tau * (26 + 30 * I) * depth, spanY) - OV - 150;
      const a = rand(p.seed, k, 5) * TAU + tau * (0.3 + 0.5 * rand(p.seed, k, 6)) * (k % 2 ? 1 : -1);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.scale(depth, depth * (0.75 + 0.25 * Math.cos(tau * 1.3 + k)));
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
    }
  }

  /* ================================================================== */
  /* Registration                                                        */
  /* ================================================================== */
  /**
   * Dev/test hook: memory held by the prepared scene caches — sprite bytes and
   * recorded vector segments per scene ('shared' = caches used by several).
   * @returns {{ bytes: object, segs: object, totalBytes: number }}
   */
  MV.sceneStats = function () {
    let total = 0;
    for (const k in MEM.bytes) total += MEM.bytes[k];
    return { bytes: Object.assign({}, MEM.bytes), segs: Object.assign({}, MEM.segs), totalBytes: total };
  };

  defineScene('night-city', { build: buildNightCity, draw: drawNightCity });
  defineScene('train', { build: buildTrain, draw: drawTrain });
  defineScene('crowd', { build: buildCrowd, draw: drawCrowd });
  defineScene('tunnel', { build: () => ({}), draw: drawTunnel });
  defineScene('stripes', { build: buildStripes, draw: drawStripes });
  defineScene('sunburst', { build: buildSunburst, draw: drawSunburst });
  defineScene('sky-red', { build: buildSkyRed, draw: drawSkyRed });
  defineScene('shards', { build: buildShards, draw: drawShards });
  defineScene('starfield', { build: buildStarfield, draw: drawStarfield });
  defineScene('void', { build: buildVoid, draw: drawVoid });
})();

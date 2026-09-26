/*
 * MV core — shared namespace, constants, math, deterministic randomness,
 * canvas/text helpers and registries. Every other module depends on this file
 * and must only use the contracts documented here (see mv/docs/ARCHITECTURE.md).
 *
 * Classic script (no ES modules) so the page also works from file://.
 */
(function () {
  'use strict';

  const MV = (window.MV = window.MV || {});
  MV.VERSION = '1.0.0';

  /* ------------------------------------------------------------------ */
  /* Stage constants                                                     */
  /* ------------------------------------------------------------------ */
  // All drawing code works in this logical space; Stage scales it.
  MV.W = 1920;
  MV.H = 1080;

  // Palette. P5-inspired triad (red / black / white) plus a night palette
  // for the star-themed sections. Use these tokens, never ad-hoc colours.
  MV.C = {
    red: '#E60012',
    redHot: '#FF1E32',
    redDeep: '#A3000E',
    blood: '#4A0006',
    black: '#0A0A0A',
    ink: '#000000',
    white: '#FFFFFF',
    paper: '#F3EFE6',
    gray: '#1D1D1F',
    night: '#060A1C',
    navy: '#101A45',
    star: '#FFF4D6',
    cyan: '#8EDBFF',
    yellow: '#FFE14D',
  };

  // Font stacks (loaded from Google Fonts in index.html; system fallbacks follow).
  const JP_FALLBACK = '"Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo","Noto Sans CJK JP","Noto Sans SC","Microsoft YaHei",sans-serif';
  const JP_SERIF_FALLBACK = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif CJK JP","Noto Serif SC","SimSun",serif';
  MV.FONTS = {
    jpHeavy: '"Dela Gothic One","Noto Sans JP",' + JP_FALLBACK,
    jpSans: '"Noto Sans JP",' + JP_FALLBACK,
    jpSerif: '"Shippori Mincho B1","Noto Serif JP",' + JP_SERIF_FALLBACK,
    jpRound: '"RocknRoll One","Noto Sans JP",' + JP_FALLBACK,
    jpPop: '"Reggae One","Dela Gothic One",' + JP_FALLBACK,
    jpDot: '"DotGothic16","Noto Sans JP",' + JP_FALLBACK,
    jpAntique: '"Zen Antique","Shippori Mincho B1",' + JP_SERIF_FALLBACK,
    jpOutline: '"Rampart One","Dela Gothic One",' + JP_FALLBACK,
    jpDecol: '"Kaisei Decol","Noto Serif JP",' + JP_SERIF_FALLBACK,
    jpPotta: '"Potta One","Dela Gothic One",' + JP_FALLBACK,
    zhHeavy: '"Noto Sans SC","Noto Sans JP",' + JP_FALLBACK,
    latinCond: '"Anton","Bebas Neue","Impact","Arial Narrow",sans-serif',
    latinBebas: '"Bebas Neue","Anton","Impact",sans-serif',
    latinBlack: '"Archivo Black","Arial Black","Helvetica Neue",sans-serif',
    latinMarker: '"Permanent Marker","Anton",cursive',
  };
  // Families (and weights) used for the ransom-note collage. Each entry:
  // { family: css font-family stack, weight, style, scale } — scale evens out
  // optical size differences between faces.
  MV.FONTS.ransom = [
    { family: MV.FONTS.jpHeavy, weight: 400, style: 'normal', scale: 1.0 },
    { family: MV.FONTS.jpSerif, weight: 800, style: 'normal', scale: 1.05 },
    { family: MV.FONTS.jpSans, weight: 900, style: 'normal', scale: 1.0 },
    { family: MV.FONTS.jpRound, weight: 400, style: 'normal', scale: 1.0 },
    { family: MV.FONTS.jpPop, weight: 400, style: 'normal', scale: 1.0 },
    { family: MV.FONTS.jpAntique, weight: 400, style: 'normal', scale: 1.05 },
    { family: MV.FONTS.jpPotta, weight: 400, style: 'normal', scale: 0.95 },
    { family: MV.FONTS.jpDot, weight: 400, style: 'normal', scale: 1.0 },
    { family: MV.FONTS.jpDecol, weight: 700, style: 'normal', scale: 1.05 },
  ];
  MV.FONTS.ransomLatin = [
    { family: MV.FONTS.latinCond, weight: 400, style: 'normal', scale: 1.1 },
    { family: MV.FONTS.latinBlack, weight: 400, style: 'normal', scale: 0.9 },
    { family: MV.FONTS.latinBebas, weight: 400, style: 'normal', scale: 1.15 },
    { family: MV.FONTS.latinMarker, weight: 400, style: 'normal', scale: 0.95 },
    { family: '"Times New Roman",serif', weight: 700, style: 'italic', scale: 1.0 },
  ];
  // First family name of every stack we rely on (for document.fonts.load).
  MV.FONTS.webFamilies = [
    ['Dela Gothic One', 400], ['Noto Sans JP', 900], ['Noto Sans JP', 500], ['Noto Serif JP', 900],
    ['Shippori Mincho B1', 800], ['RocknRoll One', 400], ['Reggae One', 400], ['DotGothic16', 400],
    ['Zen Antique', 400], ['Rampart One', 400], ['Kaisei Decol', 700], ['Potta One', 400],
    ['Noto Sans SC', 900], ['Anton', 400], ['Bebas Neue', 400], ['Archivo Black', 400], ['Permanent Marker', 400],
  ];

  /* ------------------------------------------------------------------ */
  /* Math                                                                */
  /* ------------------------------------------------------------------ */
  const TAU = Math.PI * 2;
  MV.TAU = TAU;
  MV.clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  MV.lerp = (a, b, t) => a + (b - a) * t;
  MV.invLerp = (a, b, x) => (b === a ? 0 : (x - a) / (b - a));
  MV.remap = (x, a, b, c, d, clampIt = true) => {
    let t = MV.invLerp(a, b, x);
    if (clampIt) t = MV.clamp(t);
    return c + (d - c) * t;
  };
  MV.smoothstep = (a, b, x) => {
    const t = MV.clamp((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  MV.fract = (x) => x - Math.floor(x);
  MV.mod = (x, m) => ((x % m) + m) % m;
  // 0..1 window: rises over [a, a+fadeIn], stays 1, falls over [b-fadeOut, b].
  MV.window = (t, a, b, fadeIn, fadeOut = fadeIn) => {
    if (t <= a || t >= b) return 0;
    const i = fadeIn > 0 ? MV.clamp((t - a) / fadeIn) : 1;
    const o = fadeOut > 0 ? MV.clamp((b - t) / fadeOut) : 1;
    return Math.min(i, o);
  };
  // Exponential decay pulse: 1 at dt=0, ~0 after `len` seconds. dt<0 → 0.
  MV.pulse = (dt, len = 0.25) => (dt < 0 ? 0 : Math.exp((-dt * 4.6) / Math.max(1e-4, len)));

  MV.ease = {
    linear: (t) => t,
    inQuad: (t) => t * t,
    outQuad: (t) => 1 - (1 - t) * (1 - t),
    inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    inCubic: (t) => t * t * t,
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    inQuart: (t) => t * t * t * t,
    outQuart: (t) => 1 - Math.pow(1 - t, 4),
    inExpo: (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
    outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    inOutExpo: (t) =>
      t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
    outBack: (t, k = 1.70158) => 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2),
    inBack: (t, k = 1.70158) => (k + 1) * t * t * t - k * t * t,
    outElastic: (t) =>
      t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
    steps: (t, n = 4) => Math.floor(MV.clamp(t) * n) / n,
  };

  /* ------------------------------------------------------------------ */
  /* Deterministic randomness — rendering must be a pure function of t.  */
  /* NEVER use Math.random() in any draw/evaluate path.                  */
  /* ------------------------------------------------------------------ */
  function hashInt(h, x) {
    h ^= x;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    return h >>> 0;
  }
  // hash32(...args): args may be numbers (any real) or strings.
  MV.hash32 = function () {
    let h = 0x811c9dc5;
    for (let i = 0; i < arguments.length; i++) {
      const a = arguments[i];
      if (typeof a === 'string') {
        for (let j = 0; j < a.length; j++) h = hashInt(h, a.charCodeAt(j));
      } else {
        const v = Number(a) || 0;
        h = hashInt(h, Math.floor(v) | 0);
        h = hashInt(h, Math.floor((v - Math.floor(v)) * 1e6) | 0);
      }
    }
    return h >>> 0;
  };
  // Stateless uniform [0,1) from (seed, i, j).
  MV.rand = (seed, i = 0, j = 0) => MV.hash32(seed, i, j) / 4294967296;
  // Stateless signed [-1,1).
  MV.srand = (seed, i = 0, j = 0) => MV.rand(seed, i, j) * 2 - 1;
  // Stateful mulberry32 generator.
  MV.rng = function (seed) {
    let a = MV.hash32(seed) || 1;
    const next = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next,
      range: (lo, hi) => lo + (hi - lo) * next(),
      int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
      pick: (arr) => arr[Math.floor(next() * arr.length) % arr.length],
      sign: () => (next() < 0.5 ? -1 : 1),
      chance: (p) => next() < p,
    };
  };
  // Smooth value noise in [-1, 1].
  MV.noise1 = function (x, seed = 0) {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return MV.lerp(MV.srand(seed, i), MV.srand(seed, i + 1), u);
  };
  MV.noise2 = function (x, y, seed = 0) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = MV.srand(seed, ix, iy), b = MV.srand(seed, ix + 1, iy);
    const c = MV.srand(seed, ix, iy + 1), d = MV.srand(seed, ix + 1, iy + 1);
    return MV.lerp(MV.lerp(a, b, ux), MV.lerp(c, d, ux), uy);
  };

  /* ------------------------------------------------------------------ */
  /* Canvas helpers                                                      */
  /* ------------------------------------------------------------------ */
  MV.makeCanvas = function (w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    const ctx = canvas.getContext('2d');
    return { canvas, ctx };
  };

  const draw = (MV.draw = {});
  // All path helpers call beginPath() and leave the path open for fill/stroke.
  draw.polygon = function (ctx, pts) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (i === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath();
  };
  draw.star = function (ctx, cx, cy, rOuter, rInner, n = 5, rot = -Math.PI / 2) {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 === 0 ? rOuter : rInner;
      const a = rot + (i * Math.PI) / n;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  // 4-point sparkle (twinkle star).
  draw.sparkle = function (ctx, cx, cy, r, thin = 0.18, rot = 0) {
    draw.star(ctx, cx, cy, r, r * thin, 4, rot - Math.PI / 2);
  };
  // Jagged explosion outline. `seed` makes the spikes deterministic.
  draw.burst = function (ctx, cx, cy, rInner, rOuter, spikes, seed = 1, jitter = 0.35, rot = 0) {
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const outer = i % 2 === 0;
      const base = outer ? rOuter : rInner;
      const r = base * (1 + MV.srand(seed, i) * jitter * (outer ? 1 : 0.5));
      const a = rot + (i / (spikes * 2)) * TAU + MV.srand(seed, i, 7) * (Math.PI / spikes) * 0.35;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  // Parallelogram: top edge shifted by +skew, bottom edge by 0.
  draw.skewRect = function (ctx, x, y, w, h, skew) {
    ctx.beginPath();
    ctx.moveTo(x + skew, y);
    ctx.lineTo(x + w + skew, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
  };
  // Torn-paper rectangle (deterministic).
  draw.roughRect = function (ctx, x, y, w, h, seed = 1, amp = 6, step = 22) {
    ctx.beginPath();
    let i = 0;
    const edge = (x0, y0, x1, y1) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.round(len / step));
      const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const o = MV.srand(seed, i++) * amp;
        const px = x0 + (x1 - x0) * t + nx * o, py = y0 + (y1 - y0) * t + ny * o;
        if (i === 1) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
    };
    edge(x, y, x + w, y);
    edge(x + w, y, x + w, y + h);
    edge(x + w, y + h, x, y + h);
    edge(x, y + h, x, y);
    ctx.closePath();
  };
  // Sunburst wedges (fills alternate wedges with `color`; caller fills bg).
  draw.rays = function (ctx, cx, cy, count, radius, rot, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    const step = TAU / count;
    for (let i = 0; i < count; i += 2) {
      const a0 = rot + i * step, a1 = a0 + step;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius);
      ctx.lineTo(cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius);
      ctx.closePath();
    }
    ctx.fill();
  };
  // Halftone dot field drawn directly. fn(u,v) → 0..1 dot radius factor
  // (u,v in 0..1 across the rect). Use for pre-rendered textures; it is not cheap.
  draw.halftone = function (ctx, x, y, w, h, opts) {
    const cell = opts.cell || 16;
    const angle = opts.angle || 0;
    const fn = opts.fn || (() => 0.5);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = opts.color || '#000';
    const cx = x + w / 2, cy = y + h / 2;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const R = Math.hypot(w, h) / 2 + cell;
    ctx.beginPath();
    for (let gy = -R; gy <= R; gy += cell) {
      for (let gx = -R; gx <= R; gx += cell) {
        const px = cx + gx * ca - gy * sa, py = cy + gx * sa + gy * ca;
        if (px < x - cell || px > x + w + cell || py < y - cell || py > y + h + cell) continue;
        const r = MV.clamp(fn((px - x) / w, (py - y) / h)) * cell * 0.62;
        if (r < 0.4) continue;
        ctx.moveTo(px + r, py);
        ctx.arc(px, py, r, 0, TAU);
      }
    }
    ctx.fill();
    ctx.restore();
  };

  /* Pattern cache (CanvasPattern per context). */
  const patternCache = new WeakMap();
  const tileCache = new Map();
  function cachedTile(key, w, h, paint) {
    let t = tileCache.get(key);
    if (!t) {
      t = MV.makeCanvas(w, h);
      paint(t.ctx, w, h);
      tileCache.set(key, t);
    }
    return t.canvas;
  }
  function cachedPattern(ctx, key, tileFn) {
    let m = patternCache.get(ctx);
    if (!m) patternCache.set(ctx, (m = new Map()));
    let p = m.get(key);
    if (!p) {
      p = ctx.createPattern(tileFn(), 'repeat');
      m.set(key, p);
    }
    return p;
  }
  MV.patterns = {
    // Regular dot grid. opts: { cell=14, radius=0.3 (fraction of cell), color, bg=null }
    dots(ctx, opts = {}) {
      const cell = opts.cell || 14, rad = opts.radius == null ? 0.3 : opts.radius;
      const color = opts.color || '#000', bg = opts.bg || null;
      const key = `dots|${cell}|${rad}|${color}|${bg}`;
      return cachedPattern(ctx, key, () =>
        cachedTile(key, cell, cell, (c, w) => {
          if (bg) { c.fillStyle = bg; c.fillRect(0, 0, w, w); }
          c.fillStyle = color;
          c.beginPath();
          c.arc(w / 2, w / 2, w * rad, 0, TAU);
          c.fill();
        })
      );
    },
    // Diagonal stripes. opts: { width=24, colors=['#000','#E60012'] }
    stripes(ctx, opts = {}) {
      const w = opts.width || 24, colors = opts.colors || ['#000', MV.C.red];
      const key = `stripes|${w}|${colors.join(',')}`;
      const size = w * colors.length;
      return cachedPattern(ctx, key, () =>
        cachedTile(key, size, size, (c, s) => {
          for (let i = -colors.length; i < colors.length * 2; i++) {
            c.fillStyle = colors[MV.mod(i, colors.length)];
            c.beginPath();
            c.moveTo(i * w, 0);
            c.lineTo(i * w + w, 0);
            c.lineTo(i * w + w - s, s);
            c.lineTo(i * w - s, s);
            c.closePath();
            c.fill();
          }
        })
      );
    },
    // Film-grain-ish noise tile (deterministic per variant 0..7).
    grain(ctx, variant = 0, alpha = 0.12) {
      const key = `grain|${variant}|${alpha}`;
      return cachedPattern(ctx, key, () =>
        cachedTile(key, 256, 256, (c, w, h) => {
          const img = c.createImageData(w, h);
          for (let i = 0; i < w * h; i++) {
            const v = MV.rand(911 + variant, i) * 255;
            img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
            img.data[i * 4 + 3] = alpha * 255;
          }
          c.putImageData(img, 0, 0);
        })
      );
    },
  };

  /* ------------------------------------------------------------------ */
  /* Text helpers                                                        */
  /* ------------------------------------------------------------------ */
  const measureCtx = MV.makeCanvas(8, 8).ctx;
  MV.text = {
    font(size, family, weight = 900, style = 'normal') {
      return `${style} ${weight} ${Math.max(1, Math.round(size))}px ${family}`;
    },
    chars: (s) => Array.from(s || ''),
    isLatin: (s) => /^[\x00-\x7F‘’“”]+$/.test(s || ''),
    isLatinChar: (ch) => /[A-Za-z0-9'’.,!?&-]/.test(ch),
    // Width of `str` with letter spacing (px, added between glyphs).
    measure(str, font, letterSpacing = 0, ctx = measureCtx) {
      ctx.font = font;
      const chars = MV.text.chars(str);
      if (!letterSpacing) return ctx.measureText(str).width;
      let w = 0;
      for (const ch of chars) w += ctx.measureText(ch).width;
      return w + letterSpacing * Math.max(0, chars.length - 1);
    },
    // Largest integer size (≤max, ≥min) at which `str` fits in maxW.
    fitSize(str, family, weight, maxW, maxSize, minSize = 8, letterSpacingEm = 0) {
      let lo = minSize, hi = maxSize;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const w = MV.text.measure(str, MV.text.font(mid, family, weight), mid * letterSpacingEm);
        if (w <= maxW) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
    // Draw `str` glyph by glyph with letter spacing; returns advance width.
    drawSpaced(ctx, str, x, y, letterSpacing, mode = 'fill') {
      let cx = x;
      for (const ch of MV.text.chars(str)) {
        if (mode === 'fill' || mode === 'both') ctx.fillText(ch, cx, y);
        if (mode === 'stroke' || mode === 'both') ctx.strokeText(ch, cx, y);
        cx += ctx.measureText(ch).width + letterSpacing;
      }
      return cx - x - letterSpacing;
    },
  };

  /* Web font readiness. Resolves when the families have loaded the glyphs
   * for `sample` (or after `timeoutMs`, whichever first). Never rejects. */
  MV.fonts = {
    ensure(sample = '', timeoutMs = 8000) {
      if (!document.fonts || !document.fonts.load) return Promise.resolve();
      const text = (sample || '') + 'ABCabc0123あア星';
      const jobs = MV.FONTS.webFamilies.map(([fam, w]) =>
        document.fonts.load(`${w} 64px "${fam}"`, text).catch(() => null)
      );
      const timeout = new Promise((r) => setTimeout(r, timeoutMs));
      return Promise.race([Promise.all(jobs), timeout]).then(() => undefined);
    },
  };

  /* ------------------------------------------------------------------ */
  /* Lyric text canonicalisation (must match mv/tools/gen_preset.py).    */
  /* ------------------------------------------------------------------ */
  // Display form: whitespace (incl. U+3000) collapsed, trimmed. Offsets in
  // presets are code-point indices into this string.
  MV.canonDisplay = (s) => String(s || '').replace(/\s+/gu, ' ').trim();
  // Matching key: NFKC, lower-case, without whitespace/punctuation/symbols.
  MV.canonKey = (s) =>
    String(s || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]/gu, '');
  const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  MV.fnv1a = function (s) {
    let h = 0x811c9dc5;
    const bytes = enc ? enc.encode(s) : unescape(encodeURIComponent(s)).split('').map((c) => c.charCodeAt(0));
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  };
  MV.lyricKey = (line) => MV.fnv1a(MV.canonKey(line));

  /* ------------------------------------------------------------------ */
  /* Registries & presets                                                */
  /* ------------------------------------------------------------------ */
  MV.registry = function (kind) {
    const items = new Map();
    return {
      kind,
      register(name, impl) {
        items.set(name, impl);
        return impl;
      },
      get(name) {
        return items.get(name) || null;
      },
      has: (name) => items.has(name),
      list: () => Array.from(items.keys()),
    };
  };
  MV.scenes = MV.registry('scene'); //       name → { draw(ctx, env, p) , prepare?(stage) }
  MV.lyricStyles = MV.registry('lyric'); //  name → { layout(line, opts) , draw(ctx, line, layout, lt, env) }
  MV.transitions = MV.registry('transition'); // name → { draw(ctx, fromCanvas, toCanvas, p, env, seed) }
  MV.effects = MV.registry('effect'); //     name → { draw(ctx, env, a) } (accent / overlay effects)

  MV.presets = [];
  MV.registerPreset = function (p) {
    if (!p || !p.id) return;
    MV.presets = MV.presets.filter((q) => q.id !== p.id);
    MV.presets.push(p);
  };
  MV.getPreset = (id) => MV.presets.find((p) => p.id === id) || null;
  // Presets that were loaded before core.js (script order safety).
  if (Array.isArray(MV._pendingPresets)) {
    MV._pendingPresets.forEach((p) => MV.registerPreset(p));
    MV._pendingPresets = [];
  }

  /* ------------------------------------------------------------------ */
  /* Tiny event bus + misc                                               */
  /* ------------------------------------------------------------------ */
  const listeners = new Map();
  MV.bus = {
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
      return () => listeners.get(ev).delete(fn);
    },
    off(ev, fn) {
      if (listeners.has(ev)) listeners.get(ev).delete(fn);
    },
    emit(ev, data) {
      if (!listeners.has(ev)) return;
      listeners.get(ev).forEach((fn) => {
        try {
          fn(data);
        } catch (e) {
          console.error('[MV.bus]', ev, e);
        }
      });
    },
  };

  MV.fmtTime = function (sec) {
    sec = Math.max(0, sec || 0);
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
  };

  // Binary search: index of last element with arr[i] <= x (or -1).
  MV.lowerIndex = function (arr, x, key) {
    let lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = key ? key(arr[mid]) : arr[mid];
      if (v <= x) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  };

  MV.log = (...a) => console.log('%c[MV]', 'color:#E60012;font-weight:bold', ...a);
})();

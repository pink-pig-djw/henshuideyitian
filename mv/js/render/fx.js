/*
 * MV render/fx — scene transitions, accent effects and the HUD.
 * Contract: mv/docs/ARCHITECTURE.md §3.6.
 *
 *   MV.transitions.register(name, { duration, draw(ctx, fromCanvas, toCanvas, p, env, seed) })
 *   MV.effects.register(name, { layer: 'under' | 'over', duration, draw(ctx, env, a) })
 *   MV.HUD.draw(ctx, env, info)
 *
 * Everything draws in logical MV.W × MV.H space (the caller's transform maps it
 * to the backing store). fromCanvas / toCanvas may have any pixel size — they
 * are always stretched over the full logical frame; a missing one reads as
 * black. Transitions paint the whole frame and clamp p to 0..1 (p ≤ 0 is
 * exactly `from`, p ≥ 1 exactly `to`). Effects draw nothing outside
 * 0 ≤ env.t − a.t ≤ a.dur.
 *
 * Determinism: pure functions of (p | env.t − a.t, seed, env). No Math.random,
 * Date.now or performance.now. Geometry that depends only on the seed is cached
 * (a cache hit returns identical data, so frames stay reproducible).
 *
 * Accent fields read by effects (a = { kind, t, dur, strength, seed, x?, y?, text?, data? }):
 *   flash      data.color 'white' | 'red' (also a.color)
 *   speedlines x, y = focus (default centre); data.color 'white' | 'black' | 'red'
 *   ink        x, y (default seeded); data.color 'black' | 'red'; data.size (×)
 *   stars      x, y (default centre)
 *   shards     data.dir ±1 (default seeded)
 *   ring       x, y (default centre); data.color 'red' | 'white' | 'black'
 *   frame      –
 *   confetti   x, y → burst from a point, otherwise rain from the top
 *   caption    text; x, y (top-left anchor, default 96, 104); data.sub (small Latin label)
 *   credits    data { title, titleLatin, artist, lyricist, composer, presetId } → else preset meta
 *   title      same meta source; intended to hold ~8 s with beat jiggle
 *   endcard    same meta source; ends on black
 * `strength` (default 1) scales size / count / opacity where it makes sense.
 *
 * Also exported: MV.FX = { emblem, ransom, meta, dotField } (small shared helpers).
 */
(function () {
  'use strict';
  const MV = window.MV;
  if (!MV || !MV.transitions || !MV.effects) return;

  const C = MV.C;
  const W = MV.W, H = MV.H;
  const TAU = MV.TAU;
  const E = MV.ease;
  const clamp = MV.clamp, lerp = MV.lerp;
  const DEG = Math.PI / 180;
  const DIAG = Math.hypot(W, H);
  const ZERO_BEAT = { index: 0, phase: 0, period: 0.6, bar: 0, barPhase: 0, beatInBar: 0, sinceBeat: 9, sinceDownbeat: 9, pulse: 0, barPulse: 0 };

  /* ------------------------------------------------------------------ */
  /* Small private helpers                                              */
  /* ------------------------------------------------------------------ */
  const seg = (x, a, b) => clamp((x - a) / (b - a));
  const beatOf = (env) => (env && env.beat) || ZERO_BEAT;
  const rnd = MV.rand, srnd = MV.srand;
  const isLatinStr = (s) => /^[\x00-\x7F‘’“”—–]*$/.test(s || '');

  /** Draw a frame canvas over the full logical frame (black if missing). */
  function paint(ctx, c) {
    if (c && c.width > 0 && c.height > 0) ctx.drawImage(c, 0, 0, W, H);
    else {
      ctx.fillStyle = C.black;
      ctx.fillRect(-40, -40, W + 80, H + 80);
    }
  }
  function fillAll(ctx, color) {
    ctx.fillStyle = color;
    ctx.fillRect(-60, -60, W + 120, H + 120);
  }
  function polyPath(ctx, pts) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
      else ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.closePath();
  }
  // Add a star outline as a sub-path (no beginPath) — for even-odd holes.
  function starSub(ctx, cx, cy, r, ratio, rot) {
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 === 0 ? r : r * ratio;
      const a = rot + (i * Math.PI) / 5;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  // Seamless wobbly radius around a circle (periodic value noise).
  const ringNoise = (a, f, seed) => MV.noise2(Math.cos(a) * f + 7.3, Math.sin(a) * f - 3.1, seed);

  /**
   * Halftone dot field over the whole frame. tone(x, y) → 0..1 dot radius
   * factor (1 = cells fully covered). Dots on a grid rotated by `ang`.
   */
  function dotField(ctx, cell, ang, color, tone) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const cx = W / 2, cy = H / 2;
    const R = DIAG / 2 + cell;
    const rMax = cell * 0.75;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let gy = -R; gy <= R; gy += cell) {
      for (let gx = -R; gx <= R; gx += cell) {
        const x = cx + gx * ca - gy * sa, y = cy + gx * sa + gy * ca;
        if (x < -cell || x > W + cell || y < -cell || y > H + cell) continue;
        const r = tone(x, y) * rMax;
        if (r < 0.7) continue;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      }
    }
    ctx.fill();
  }

  /* ---- Fast halftone: pattern-filled tone bands ----------------------
   * A dot lattice rotated 45° lives in an axis-aligned tile (dots at the
   * corners + centre), so filling with it never needs a rotated pattern
   * (slow on CPU canvases). A tone field is split into bands of equal
   * quantised tone; each band is one polygon / annulus filled with the tile of
   * that dot size — a handful of fills instead of thousands of arcs. */
  const TONE_LEVELS = 14;
  const toneTiles = new Map();
  const tonePats = new WeakMap();
  function tonePattern(ctx, cell, level, color) {
    const key = cell + '|' + level + '|' + color;
    let m = tonePats.get(ctx);
    if (!m) tonePats.set(ctx, (m = new Map()));
    let p = m.get(key);
    if (p) return p;
    let tile = toneTiles.get(key);
    if (!tile) {
      const t = MV.makeCanvas(cell, cell);
      const r = (level / TONE_LEVELS) * cell * 0.53;
      t.ctx.fillStyle = color;
      t.ctx.beginPath();
      [[0, 0], [cell, 0], [0, cell], [cell, cell], [cell / 2, cell / 2]].forEach((q) => {
        t.ctx.moveTo(q[0] + r, q[1]);
        t.ctx.arc(q[0], q[1], r, 0, TAU);
      });
      t.ctx.fill();
      tile = t.canvas;
      toneTiles.set(key, tile);
    }
    p = ctx.createPattern(tile, 'repeat');
    m.set(key, p);
    return p;
  }
  const FRAME_PTS = [[-60, -60], [W + 60, -60], [-60, H + 60], [W + 60, H + 60]];
  /** Linear axis helper: s(x, y) = x·cosθ + y·sinθ, with its range over the frame. */
  function linAxis(ang) {
    const c = Math.cos(ang), sn = Math.sin(ang);
    const vals = FRAME_PTS.map((q) => q[0] * c + q[1] * sn);
    const lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    return { ang, lo, hi, norm: (s) => (s - lo) / (hi - lo) };
  }
  /**
   * Halftone tone field. o = { color, cell=28 (integer), tone(s) → 0..1 (≥1 = solid),
   *   kind: 'linear' → s = x·cosθ + y·sinθ with θ = o.ang (odd multiples of 45° keep dots whole)
   *   kind: 'radial' → s = hypot(x − cx, (y − cy) / aspect) around (o.cx, o.cy) }
   * Must be called with the caller's base transform (no rotation) for speed.
   */
  function toneField(ctx, o) {
    const cell = o.cell || 28;
    const step = cell / Math.SQRT2;
    const radial = o.kind === 'radial';
    // quantised tone levels (radial bands are pricier on CPU rasterisers → fewer)
    const K = Math.max(2, Math.min(TONE_LEVELS, o.levels || (radial ? 10 : TONE_LEVELS)));
    const lvl = (q) => Math.round((q * TONE_LEVELS) / K); // map to a tile level
    const asp = o.aspect || 1;
    let s0, s1;
    if (radial) {
      s0 = 0;
      s1 = Math.max.apply(null, FRAME_PTS.map((q) => Math.hypot(q[0] - o.cx, (q[1] - o.cy) / asp)));
    } else {
      const ax = linAxis(o.ang);
      s0 = ax.lo;
      s1 = ax.hi;
    }
    const c = Math.cos(o.ang || 0), sn = Math.sin(o.ang || 0);
    const band = (sa, sb, level) => {
      // overlap neighbours by ~1 px so anti-aliased edges never leave a seam
      sa -= 1;
      sb += 1;
      if (radial) {
        sa = Math.max(0, sa);
        if (sb <= 0) return;
      }
      ctx.fillStyle = level >= K ? o.color : tonePattern(ctx, cell, lvl(level), o.color);
      ctx.beginPath();
      if (radial) {
        ctx.ellipse(o.cx, o.cy, sb, sb * asp, 0, 0, TAU);
        if (sa > 0.5) {
          ctx.moveTo(o.cx + sa, o.cy);
          ctx.ellipse(o.cx, o.cy, sa, sa * asp, 0, 0, TAU, true);
        }
      } else {
        const D = DIAG;
        ctx.moveTo(sa * c + D * sn, sa * sn - D * c);
        ctx.lineTo(sb * c + D * sn, sb * sn - D * c);
        ctx.lineTo(sb * c - D * sn, sb * sn + D * c);
        ctx.lineTo(sa * c - D * sn, sa * sn + D * c);
        ctx.closePath();
      }
      ctx.fill();
    };
    const k0 = Math.floor(s0 / step) - 1, k1 = Math.ceil(s1 / step) + 1;
    let runStart = k0, runLevel = -1;
    for (let k = k0; k <= k1 + 1; k++) {
      const level = k > k1 ? -2 : Math.round(clamp(+o.tone(k * step) || 0) * K);
      if (level !== runLevel) {
        if (runLevel > 0) band((runStart - 0.5) * step, (k - 0.5) * step, runLevel);
        runStart = k;
        runLevel = level;
      }
    }
  }
  // Halftone vignette (static shape) rendered once per centre and reused.
  const vignetteCache = new Map();
  function vignetteSprite(cx, cy) {
    const key = Math.round(cx) + ',' + Math.round(cy);
    let c = vignetteCache.get(key);
    if (!c) {
      const t = MV.makeCanvas(W, H);
      toneField(t.ctx, { kind: 'radial', cx, cy, aspect: H / W, cell: 26, color: C.ink, levels: 14, tone: (d) => (d / (W * 0.62) - 0.62) * 2.4 });
      c = t.canvas;
      if (vignetteCache.size > 4) vignetteCache.clear();
      vignetteCache.set(key, c);
    }
    return c;
  }
  /** Map local points through translate(tx, ty) · rotate(rot) · scale(s). */
  function xf(pts, tx, ty, rot, s) {
    s = s == null ? 1 : s;
    const c = Math.cos(rot) * s, sn = Math.sin(rot) * s;
    return pts.map((q) => [tx + q[0] * c - q[1] * sn, ty + q[0] * sn + q[1] * c]);
  }
  const skewPts = (x, y, w, h, skew) => [[x + skew, y], [x + w + skew, y], [x + w, y + h], [x, y + h]];
  /** Fill a polygon (logical coords, caller at base transform) with a fill style. */
  function fillPoly(ctx, pts, style) {
    polyPath(ctx, pts);
    ctx.fillStyle = style;
    ctx.fill();
  }

  function textFont(size, str, latinFamily, jpFamily, weight) {
    return isLatinStr(str)
      ? MV.text.font(size, latinFamily || MV.FONTS.latinCond, 400)
      : MV.text.font(size, jpFamily || MV.FONTS.jpHeavy, weight || 400);
  }
  // Shrink `size` until `str` fits `maxW` (cheap linear steps; strings are short).
  function fitFont(ctx, str, size, maxW, fontFn) {
    let s = size;
    for (let i = 0; i < 14; i++) {
      ctx.font = fontFn(s);
      if (ctx.measureText(str).width <= maxW) break;
      s *= 0.9;
    }
    ctx.font = fontFn(s);
    return s;
  }
  // Vertical offset to optically centre a string drawn with the alphabetic baseline.
  function vCenter(ctx, str) {
    const m = ctx.measureText(str);
    if (m.actualBoundingBoxAscent == null) return parseFloat(ctx.font.match(/(\d+)px/)[1]) * 0.35;
    return (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  }
  // Text with black outline + hard (unblurred) offset shadow.
  function hardText(ctx, str, x, y, o) {
    ctx.lineJoin = 'round';
    if (o.shadow) {
      ctx.fillStyle = o.shadow;
      if (o.lw) {
        ctx.lineWidth = o.lw;
        ctx.strokeStyle = o.shadow;
        ctx.strokeText(str, x + o.sx, y + o.sy);
      }
      ctx.fillText(str, x + o.sx, y + o.sy);
    }
    if (o.lw) {
      ctx.lineWidth = o.lw;
      ctx.strokeStyle = o.stroke || C.black;
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = o.fill || C.white;
    ctx.fillText(str, x, y);
  }

  /* ------------------------------------------------------------------ */
  /* Original emblem: a 5-point star pierced by a diagonal slash.       */
  /* ------------------------------------------------------------------ */
  /**
   * Draw the original star-slash emblem centred at (x, y), outer radius r.
   * o = { fill, stroke, shadow, blade, rot }
   */
  function emblem(ctx, x, y, r, o = {}) {
    if (!(r > 1)) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(o.rot || 0);
    const lw = Math.max(2, r * 0.085);
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 4;
    // hard shadow
    ctx.fillStyle = o.shadow || C.red;
    MV.draw.star(ctx, r * 0.13, r * 0.11, r, r * 0.45);
    ctx.fill();
    // star body
    MV.draw.star(ctx, 0, 0, r, r * 0.45);
    ctx.fillStyle = o.fill || C.black;
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = o.stroke || C.white;
    ctx.stroke();
    // the slash — a pointed blade at −35°, with a knock-out gap where it cuts
    ctx.rotate(-35 * DEG);
    const L = r * 1.42, w = r * 0.2;
    const blade = () => {
      ctx.beginPath();
      ctx.moveTo(-L, w * 0.18);
      ctx.lineTo(-L * 0.15, -w);
      ctx.lineTo(L, -w * 0.12);
      ctx.lineTo(L * 0.1, w * 0.72);
      ctx.closePath();
    };
    blade();
    ctx.lineWidth = lw * 2.4;
    ctx.strokeStyle = o.gap || o.stroke || C.white;
    ctx.stroke();
    ctx.fillStyle = o.blade || C.red;
    ctx.fill();
    ctx.lineWidth = lw * 0.7;
    ctx.strokeStyle = C.black;
    ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Ransom-note collage: every glyph on its own cut-paper tile.        */
  /* ------------------------------------------------------------------ */
  const TILE_STYLES = [
    { bg: C.white, fg: C.black },
    { bg: C.black, fg: C.white },
    { bg: C.red, fg: C.white },
    { bg: C.paper, fg: C.red },
    { bg: C.white, fg: C.red },
    { bg: C.black, fg: C.red },
  ];
  const TILE_STYLES_ON_RED = [TILE_STYLES[0], TILE_STYLES[1], TILE_STYLES[3], TILE_STYLES[1], TILE_STYLES[4], TILE_STYLES[0]];

  function ransomLayout(ctx, text, size, seed, o) {
    const chars = Array.from(text || '');
    const items = [];
    let total = 0;
    const gap = size * (o.gap == null ? 0.02 : o.gap);
    const styles = o.onRed ? TILE_STYLES_ON_RED : TILE_STYLES;
    chars.forEach((ch, i) => {
      if (/\s/.test(ch)) {
        items.push({ space: true, w: size * 0.3 });
        total += size * 0.3;
        return;
      }
      const latin = MV.text.isLatinChar(ch);
      const faces = latin ? MV.FONTS.ransomLatin : MV.FONTS.ransom;
      const f = faces[Math.floor(rnd(seed, i, 1) * faces.length) % faces.length];
      const sz = size * f.scale * (0.82 + 0.3 * rnd(seed, i, 2));
      const font = MV.text.font(sz, f.family, f.weight, f.style);
      ctx.font = font;
      const gw = ctx.measureText(ch).width;
      const tw = Math.max(gw, sz * (latin ? 0.5 : 0.8)) + sz * 0.24;
      const th = sz * 1.16;
      const st = styles[Math.floor(rnd(seed, i, 5) * styles.length) % styles.length];
      items.push({
        ch, font, sz, tw, th, gw,
        rot: srnd(seed, i, 3) * 12 * DEG,
        dy: srnd(seed, i, 4) * size * 0.09,
        st, i,
        outline: rnd(seed, i, 6) < 0.25,
      });
      total += tw + gap;
    });
    return { items, total: Math.max(0, total - gap), gap };
  }

  /**
   * Ransom-note text centred at (cx, cy). o = { onRed, lt (s since start),
   * stagger (s per glyph), pop (s), jiggle (0..1), beat, shadow, maxW, gap }.
   * Glyphs appear one by one when o.lt is given. Returns the drawn width.
   */
  function ransom(ctx, text, cx, cy, size, seed, o = {}) {
    let lay = ransomLayout(ctx, text, size, seed, o);
    if (o.maxW && lay.total > o.maxW) {
      size *= o.maxW / lay.total;
      lay = ransomLayout(ctx, text, size, seed, o);
    }
    const beat = o.beat || ZERO_BEAT;
    let x = cx - lay.total / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    const shadow = o.shadow === undefined ? C.black : o.shadow;
    let n = 0;
    for (const it of lay.items) {
      if (it.space) {
        x += it.w;
        continue;
      }
      const k = n++;
      const gx = x + it.tw / 2;
      x += it.tw + lay.gap;
      let sc = 1, extraRot = 0;
      if (o.lt != null) {
        const u = (o.lt - k * (o.stagger || 0.07)) / (o.pop || 0.22);
        if (u <= 0) continue;
        const e = E.outBack(clamp(u), 2.2);
        sc = lerp(2.1, 1, e);
        extraRot = (1 - clamp(u)) * srnd(seed, it.i, 9) * 0.6;
      }
      const jig = (o.jiggle || 0) * beat.pulse;
      const jr = jig * srnd(seed, it.i, beat.index + 31) * 0.14;
      const jy = jig * (k % 2 ? 1 : -1) * size * 0.05;
      ctx.save();
      ctx.translate(gx, cy + it.dy + jy);
      ctx.rotate(it.rot + extraRot + jr);
      ctx.scale(sc, sc);
      const tw = it.tw, th = it.th;
      // hard shadow + torn tile
      if (shadow) {
        ctx.fillStyle = shadow;
        MV.draw.roughRect(ctx, -tw / 2 + size * 0.06, -th / 2 + size * 0.06, tw, th, seed + it.i * 7, size * 0.018, size * 0.16);
        ctx.fill();
      }
      ctx.fillStyle = it.st.bg;
      MV.draw.roughRect(ctx, -tw / 2, -th / 2, tw, th, seed + it.i * 7 + 3, size * 0.018, size * 0.16);
      ctx.fill();
      ctx.font = it.font;
      const vy = vCenter(ctx, it.ch);
      if (it.outline) {
        ctx.lineWidth = Math.max(2, it.sz * 0.07);
        ctx.strokeStyle = it.st.fg === C.black ? C.red : C.black;
        ctx.strokeText(it.ch, 0, vy);
      }
      ctx.fillStyle = it.st.fg;
      ctx.fillText(it.ch, 0, vy);
      ctx.restore();
    }
    return lay.total;
  }

  /* ------------------------------------------------------------------ */
  /* Song meta for credits / title / endcard                            */
  /* ------------------------------------------------------------------ */
  /** Resolve { title, titleLatin, artist, lyricist, composer } from a.data or the preset meta. */
  function meta(a) {
    const d = (a && a.data) || {};
    let m = null;
    try {
      if (d.presetId && MV.getPreset) m = (MV.getPreset(d.presetId) || {}).meta || null;
      if (!m && MV.presets && MV.presets.length) m = MV.presets[0].meta || null;
    } catch (e) {
      m = null;
    }
    m = m || {};
    const pick = (k) => (d[k] != null && d[k] !== '' ? String(d[k]) : m[k] != null ? String(m[k]) : '');
    return { title: pick('title'), titleLatin: pick('titleLatin'), artist: pick('artist'), lyricist: pick('lyricist'), composer: pick('composer') };
  }

  /* ================================================================== */
  /* TRANSITIONS                                                        */
  /* ================================================================== */
  function regT(name, duration, fn) {
    MV.transitions.register(name, {
      duration,
      draw(ctx, from, to, p, env, seed) {
        p = clamp(+p || 0);
        seed = +seed || 0;
        ctx.save();
        try {
          if (p <= 0) paint(ctx, from);
          else if (p >= 1) paint(ctx, to);
          else fn(ctx, from, to, p, env || {}, seed);
        } finally {
          ctx.restore();
        }
      },
    });
  }

  /* ---- slash-wipe: skewed black/red panels sweep, new scene between them */
  regT('slash-wipe', 0.5, (ctx, from, to, p, env, seed) => {
    const dir = rnd(seed, 1) < 0.5 ? 1 : -1;
    const k = rnd(seed, 2) < 0.5 ? Math.tan(24 * DEG) : Math.tan(36 * DEG);
    const bands = [
      { w: 170 + 70 * rnd(seed, 3), d: 0, c: C.black, sh: C.red },
      { w: 250 + 90 * rnd(seed, 4), d: 0.075, c: C.red, sh: C.black },
      { w: 26, d: 0.11, c: C.white, sh: C.black },
      { w: 110 + 50 * rnd(seed, 5), d: 0.15, c: C.black, sh: C.red },
      { w: 44, d: 0.2, c: C.red, sh: C.black },
      { w: 14, d: 0.225, c: C.white, sh: null },
    ];
    const dMax = 0.225;
    const x0 = -(H + 20) * k - 30, x1 = W + 380;
    // fast in, slight settle: the lead panel is on screen from the first frames
    const ease = (u) => 0.55 * E.outCubic(u) + 0.45 * E.inOutQuad(u);
    const X = (u) => lerp(x0, x1, ease(clamp(u / (1 - dMax))));
    const mx = (x) => (dir > 0 ? x : W - x);
    const bot = H + 20, top = -20;
    const quad = (b, f) => [
      [mx(b + 20 * -k), bot], [mx(f + 20 * -k), bot], [mx(f + (H + 20) * k), top], [mx(b + (H + 20) * k), top],
    ];
    paint(ctx, to);
    // old frame ahead of the leading panel
    const front = X(p);
    ctx.save();
    polyPath(ctx, quad(front, W + (H + 40) * k + 400));
    ctx.clip();
    paint(ctx, from);
    // speed streaks shooting off the leading edge (only while moving fast)
    const speed = 1 - clamp(p / (1 - dMax));
    if (speed > 0.2) {
      ctx.fillStyle = C.white;
      for (let i = 0; i < 6; i++) {
        const y = 80 + rnd(seed, i, 11) * (H - 160);
        const fx = front + (H - y) * k;
        const len = (120 + 360 * rnd(seed, i, 12)) * speed;
        const hgt = 3 + 7 * rnd(seed, i, 14);
        const xa = mx(fx - 10), xb = mx(fx + len);
        ctx.fillRect(Math.min(xa, xb), y, Math.abs(xb - xa), hgt);
      }
    }
    ctx.restore();
    // panels, trailing first
    for (let j = bands.length - 1; j >= 0; j--) {
      const b = bands[j];
      const f = X(p - b.d);
      if (b.sh) {
        ctx.fillStyle = b.sh;
        polyPath(ctx, quad(f - b.w - 16, f - 16));
        ctx.fill();
      }
      ctx.fillStyle = b.c;
      polyPath(ctx, quad(f - b.w, f));
      ctx.fill();
      if (j === 1) fillPoly(ctx, quad(f - b.w, f), tonePattern(ctx, 18, 7, C.redDeep)); // halftone on the big red panel
    }
  });

  /* ---- red-flash: hard red frame, halftone in / out ------------------- */
  regT('red-flash', 0.4, (ctx, from, to, p, env, seed) => {
    const ax = linAxis((rnd(seed, 2) < 0.5 ? 45 : 225) * DEG);
    const P1 = 0.2, P2 = 0.42;
    if (p < P1) {
      paint(ctx, from);
      const a = E.inQuad(p / P1);
      toneField(ctx, { kind: 'linear', ang: ax.ang, cell: 34, color: C.red, tone: (s) => (a * 1.8 - ax.norm(s) * 0.8) * 1.02 });
      return;
    }
    if (p < P2) {
      fillAll(ctx, C.red);
      const u = seg(p, P1, P2);
      // black halftone tone rising into one lower corner (dot size encodes tone)
      const cor = linAxis((rnd(seed, 3) < 0.5 ? 45 : 135) * DEG);
      toneField(ctx, { kind: 'linear', ang: cor.ang, cell: 26, color: C.black, tone: (s) => (cor.norm(s) - 0.42) * 1.5 });
      // a blade slash drawn across the frame at −35° (tapered, black + white core)
      ctx.save();
      ctx.translate(W / 2 + srnd(seed, 4) * 160, H / 2);
      ctx.rotate(-35 * DEG);
      const L = DIAG * 0.62;
      const head = lerp(-L, L, E.outExpo(clamp(u * 1.6)));
      const tail = lerp(-L, L, E.inQuad(clamp(u * 1.3 - 0.3)));
      const blade = (hw) => {
        ctx.beginPath();
        ctx.moveTo(tail, 0);
        ctx.lineTo(lerp(tail, head, 0.35), -hw);
        ctx.lineTo(head, 0);
        ctx.lineTo(lerp(tail, head, 0.6), hw * 0.7);
        ctx.closePath();
        ctx.fill();
      };
      if (head - tail > 4) {
        ctx.fillStyle = C.black;
        blade(58);
        ctx.fillStyle = C.white;
        blade(22);
      }
      ctx.restore();
      return;
    }
    paint(ctx, to);
    const a = E.outQuad(seg(p, P2, 1));
    toneField(ctx, { kind: 'linear', ang: ax.ang, cell: 34, color: C.red, tone: (s) => (1 - (a * 1.8 - ax.norm(s) * 0.8)) * 1.02 });
  });

  /* ---- shatter: glass polygons fly away revealing the new frame ------- */
  const shatterCache = new Map();
  function shatterGeom(seed) {
    let g = shatterCache.get(seed);
    if (g) return g;
    const R = MV.rng(MV.hash32(seed, 'shatter'));
    const cx = W * R.range(0.36, 0.64), cy = H * R.range(0.36, 0.6);
    const nRay = 10 + R.int(0, 2);
    const a0 = R.range(0, TAU);
    const angs = [];
    for (let i = 0; i < nRay; i++) angs.push(a0 + ((i + R.range(-0.28, 0.28)) * TAU) / nRay);
    const rings = [R.range(80, 130), R.range(250, 330), R.range(500, 620), R.range(840, 980), 2400];
    const pts = rings.map((rr, k) =>
      angs.map((a) => {
        const last = k === rings.length - 1;
        const r = rr * (1 + (last ? 0 : R.range(-0.16, 0.16)));
        const aa = a + (last ? 0 : R.range(-0.05, 0.05));
        return [cx + Math.cos(aa) * r, cy + Math.sin(aa) * r];
      })
    );
    const shards = [];
    const add = (poly, k) => {
      let mx = 0, my = 0;
      poly.forEach((q) => { mx += q[0]; my += q[1]; });
      mx /= poly.length;
      my /= poly.length;
      const dx = mx - cx, dy = my - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const i = shards.length;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, rad = 0;
      poly.forEach((q) => {
        x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]);
        x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]);
        rad = Math.max(rad, Math.hypot(q[0] - mx, q[1] - my));
      });
      // source region of the old frame this shard carries (clamped to the frame)
      const bx = clamp(Math.floor(x0) - 2, 0, W), by = clamp(Math.floor(y0) - 2, 0, H);
      const bx1 = clamp(Math.ceil(x1) + 2, 0, W), by1 = clamp(Math.ceil(y1) + 2, 0, H);
      shards.push({
        poly, cx: mx, cy: my, rad, box: [bx, by, bx1 - bx, by1 - by],
        ux: dx / dist, uy: dy / dist,
        delay: 0.1 + Math.min(1, dist / 1400) * 0.26 + R.range(0, 0.07),
        speed: R.range(700, 1300) * (k >= 3 ? 1.3 : 1),
        spin: R.range(0.8, 2.6) * R.sign(),
        tint: R.chance(0.16) ? (R.chance(0.6) ? 'red' : 'dark') : null,
        k, i,
      });
    };
    for (let k = 0; k < rings.length; k++) {
      for (let i = 0; i < nRay; i++) {
        const i2 = (i + 1) % nRay;
        if (k === 0) add([[cx, cy], pts[0][i], pts[0][i2]], 0);
        else {
          const q = [pts[k - 1][i], pts[k - 1][i2], pts[k][i2], pts[k][i]];
          if (k >= 2 && k < rings.length - 1 && R.chance(0.4)) {
            if (R.chance(0.5)) {
              add([q[0], q[1], q[2]], k);
              add([q[0], q[2], q[3]], k);
            } else {
              add([q[0], q[1], q[3]], k);
              add([q[1], q[2], q[3]], k);
            }
          } else add(q, k);
        }
      }
    }
    g = { cx, cy, shards };
    if (shatterCache.size > 24) shatterCache.delete(shatterCache.keys().next().value);
    shatterCache.set(seed, g);
    return g;
  }
  regT('shatter', 0.8, (ctx, from, to, p, env, seed) => {
    const g = shatterGeom(seed);
    const CRACK = 0.1;
    if (p < CRACK) {
      // impact: cracks race out from the hit point over the intact old frame
      paint(ctx, from);
      const u = E.outExpo(p / CRACK);
      const reach = u * 1600;
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      for (const s of g.shards) {
        if (Math.hypot(s.cx - g.cx, s.cy - g.cy) > reach) continue;
        const q = s.poly;
        ctx.moveTo(q[0][0], q[0][1]);
        for (let i = 1; i < q.length; i++) ctx.lineTo(q[i][0], q[i][1]);
        ctx.closePath();
      }
      ctx.lineWidth = 7;
      ctx.strokeStyle = C.black;
      ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = C.white;
      ctx.stroke();
      ctx.fillStyle = C.white;
      MV.draw.burst(ctx, g.cx, g.cy, 30 + 50 * u, 90 + 150 * (1 - u), 11, seed, 0.4);
      ctx.fill();
      return;
    }
    const span = 0.52;
    const addPoly = (q) => {
      ctx.moveTo(q[0][0], q[0][1]);
      for (let i = 1; i < q.length; i++) ctx.lineTo(q[i][0], q[i][1]);
      ctx.closePath();
    };
    const tint = (sh) => {
      if (sh.tint === 'red') {
        ctx.globalCompositeOperation = 'multiply';
        fillPoly(ctx, sh.poly, C.red);
        ctx.globalCompositeOperation = 'source-over';
      } else if (sh.tint === 'dark') {
        ctx.globalAlpha = 0.55;
        fillPoly(ctx, sh.poly, C.black);
        ctx.globalAlpha = 1;
      }
    };
    const intact = [], moving = [], holes = [];
    for (const sh of g.shards) {
      const u = (p - sh.delay) / span;
      if (u <= 0) intact.push(sh);
      else {
        holes.push(sh);
        if (u < 1) moving.push(sh);
      }
    }
    // a quick white flash on the revealed frame, dying out
    const flash = () => {
      const fl = 1 - seg(p, CRACK, CRACK + 0.14);
      if (fl > 0) {
        ctx.globalAlpha = fl * 0.85;
        fillAll(ctx, C.white);
        ctx.globalAlpha = 1;
      }
    };
    // Old frame where the glass is still intact, new frame in the holes. Clip
    // with whichever set has the smaller bounds (clip masks cost ∝ their area).
    const area = (list) => {
      let x0 = W, y0 = H, x1 = 0, y1 = 0;
      list.forEach((sh) => {
        const b = sh.box;
        x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]);
        x1 = Math.max(x1, b[0] + b[2]); y1 = Math.max(y1, b[1] + b[3]);
      });
      return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    };
    if (!intact.length) {
      paint(ctx, to);
      flash();
    } else if (area(holes) < area(intact)) {
      paint(ctx, from);
      intact.forEach(tint);
      ctx.save();
      ctx.beginPath();
      holes.forEach((sh) => addPoly(sh.poly));
      ctx.clip();
      paint(ctx, to);
      flash();
      ctx.restore();
    } else {
      paint(ctx, to);
      flash();
      ctx.save();
      ctx.beginPath();
      intact.forEach((sh) => addPoly(sh.poly));
      ctx.clip();
      paint(ctx, from);
      intact.forEach(tint);
      ctx.restore();
    }
    if (intact.length) {
      ctx.beginPath();
      intact.forEach((sh) => addPoly(sh.poly));
      ctx.lineJoin = 'miter';
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.white;
      ctx.stroke();
    }
    // Flying shards go into a half-resolution layer: rotated texture sampling
    // is the dominant cost on CPU canvases and motion hides the softness.
    if (!moving.length) return;
    const layer = getShardLayer();
    const lctx = layer.ctx;
    const outer = ctx;
    ctx = lctx;
    const lk = layer.canvas.width / W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    ctx.setTransform(lk, 0, 0, lk, 0, 0);
    let bx0 = W, by0 = H, bx1 = 0, by1 = 0; // bounds of what was drawn (logical px)
    // flying shards, far (outer) first so inner ones fly over them
    for (let n = moving.length - 1; n >= 0; n--) {
      const sh = moving[n];
      const v = (p - sh.delay) / span;
      const ev = v * v;
      const dx = sh.ux * sh.speed * ev + srnd(seed, sh.i, 3) * 120 * ev;
      const dy = sh.uy * sh.speed * ev + 900 * ev;
      const sc = 1 - 0.55 * ev;
      const px = sh.cx + dx, py = sh.cy + dy, rr = sh.rad * sc + 30;
      if (px + rr < 0 || px - rr > W || py + rr < 0 || py - rr > H) continue;
      const rot = sh.spin * ev * 1.4;
      bx0 = Math.min(bx0, px - rr);
      by0 = Math.min(by0, py - rr);
      bx1 = Math.max(bx1, px + rr + 20);
      by1 = Math.max(by1, py + rr + 24);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      ctx.scale(sc, sc);
      ctx.translate(-sh.cx, -sh.cy);
      // hard drop shadow (the shard lifts off the glass)
      ctx.save();
      ctx.translate(14 * v + 4, 18 * v + 4);
      fillPoly(ctx, sh.poly, C.black);
      ctx.restore();
      ctx.save();
      polyPath(ctx, sh.poly);
      ctx.clip();
      const b = sh.box;
      if (from && from.width && b[2] > 0 && b[3] > 0) {
        const kx = from.width / W, ky = from.height / H;
        ctx.drawImage(from, b[0] * kx, b[1] * ky, b[2] * kx, b[3] * ky, b[0], b[1], b[2], b[3]);
      } else fillAll(ctx, C.black);
      tint(sh);
      ctx.restore();
      ctx.lineJoin = 'miter';
      ctx.lineWidth = 3 / sc;
      ctx.strokeStyle = C.white;
      polyPath(ctx, sh.poly);
      ctx.stroke();
      ctx.restore();
    }
    // composite only the touched region of the layer
    bx0 = Math.max(0, Math.floor(bx0 * lk) / lk);
    by0 = Math.max(0, Math.floor(by0 * lk) / lk);
    bx1 = Math.min(W, Math.ceil(bx1 * lk) / lk);
    by1 = Math.min(H, Math.ceil(by1 * lk) / lk);
    if (bx1 > bx0 && by1 > by0) {
      outer.drawImage(layer.canvas, bx0 * lk, by0 * lk, (bx1 - bx0) * lk, (by1 - by0) * lk, bx0, by0, bx1 - bx0, by1 - by0);
    }
  });
  let shardLayer = null;
  function getShardLayer() {
    if (!shardLayer) shardLayer = MV.makeCanvas(W / 2, H / 2);
    return shardLayer;
  }

  /* ---- ink-wipe: an ink blot swallows the frame, the new one blooms out */
  /**
   * Ink splat as sub-paths of the current path (caller: beginPath → inkSplat → fill).
   * Body blob + tapered splash arms with beads + elongated droplets. Every sub-path
   * winds clockwise, so a nonzero fill is their union.
   * o = { arms, drops, reach (0..1 how far arms/drops have flown), body (radius ×) }
   */
  function inkSplat(ctx, x, y, r, seed, o) {
    const arms = o.arms == null ? 14 : o.arms;
    const drops = o.drops == null ? 30 : o.drops;
    const reach = o.reach == null ? 1 : o.reach;
    const n = 110;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const k = 1 + 0.17 * ringNoise(a, 1.2, seed) + 0.08 * ringNoise(a, 3.7, seed + 1) + 0.035 * ringNoise(a, 10, seed + 2);
      const px = x + Math.cos(a) * r * k, py = y + Math.sin(a) * r * k;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    for (let m = 0; m < arms; m++) {
      const a = rnd(seed, m, 21) * TAU;
      const w = 0.035 + 0.09 * rnd(seed, m, 22);
      const L = r * (0.2 + 0.85 * Math.pow(rnd(seed, m, 23), 1.4)) * reach;
      const b = r * 0.82;
      const tx = x + Math.cos(a) * (r + L), ty = y + Math.sin(a) * (r + L);
      ctx.moveTo(x + Math.cos(a - w) * b, y + Math.sin(a - w) * b);
      ctx.lineTo(tx, ty);
      ctx.lineTo(x + Math.cos(a + w) * b, y + Math.sin(a + w) * b);
      ctx.closePath();
      const br = r * (0.025 + 0.045 * rnd(seed, m, 24));
      ctx.moveTo(tx + br, ty);
      ctx.arc(tx, ty, br, 0, TAU);
    }
    for (let m = 0; m < drops; m++) {
      const a = rnd(seed, m, 31) * TAU;
      const d = r * (1.15 + 1.0 * rnd(seed, m, 32)) * (0.35 + 0.65 * reach);
      const s = Math.max(2, r * (0.01 + 0.045 * Math.pow(rnd(seed, m, 33), 2)));
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      ctx.moveTo(px + Math.cos(a) * s * 1.7, py + Math.sin(a) * s * 1.7);
      ctx.ellipse(px, py, s * 1.7, s, a, 0, TAU);
    }
  }
  regT('ink-wipe', 0.9, (ctx, from, to, p, env, seed) => {
    const x = W * (0.3 + 0.4 * rnd(seed, 1)), y = H * (0.35 + 0.3 * rnd(seed, 2));
    const far = Math.max(Math.hypot(x, y), Math.hypot(W - x, y), Math.hypot(x, H - y), Math.hypot(W - x, H - y));
    const Rmax = far / 0.76;
    const grow = (u) => Rmax * (0.26 * E.outExpo(u) + 0.74 * E.inCubic(u));
    const MID = 0.46;
    if (p < MID) {
      paint(ctx, from);
      const u = p / MID;
      const r = grow(u);
      const reach = E.outExpo(clamp(u * 3));
      // red echo then the black blot
      ctx.fillStyle = C.red;
      ctx.beginPath();
      inkSplat(ctx, x + 18, y + 14, r, seed, { reach });
      ctx.fill();
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      inkSplat(ctx, x, y, r, seed, { reach });
      ctx.fill();
      return;
    }
    fillAll(ctx, C.ink);
    const v = seg(p, MID, 1);
    const r = grow(v);
    const s2 = seed + 101;
    const reach = E.outExpo(clamp(v * 3));
    // red splash just ahead of the reveal, then the new frame inside the blot
    ctx.fillStyle = C.red;
    ctx.beginPath();
    inkSplat(ctx, x, y, r * 1.08 + 20, s2, { reach, drops: 24 });
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    inkSplat(ctx, x, y, r, s2, { reach, drops: 0, arms: 10 });
    ctx.clip();
    paint(ctx, to);
    ctx.restore();
  });

  /* ---- star-iris: a star iris closes on the old frame, opens on the new */
  regT('star-iris', 0.9, (ctx, from, to, p, env, seed) => {
    const cx = W / 2 + srnd(seed, 1) * 140, cy = H / 2 + srnd(seed, 2) * 70;
    const far = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy));
    const ratio = 0.5;
    const R0 = (far / ratio) * 1.04;
    const CLOSE = 0.44, OPEN = 0.56;
    const spin = srnd(seed, 3) < 0 ? -1 : 1;
    let R, rot, src;
    if (p < CLOSE) {
      const u = p / CLOSE;
      R = u < 0.8 ? lerp(R0, 150, E.outCubic(u / 0.8)) : lerp(150, 0, E.inBack((u - 0.8) / 0.2, 2.2));
      rot = -Math.PI / 2 + spin * u * 0.9;
      src = from;
    } else if (p > OPEN) {
      const v = seg(p, OPEN, 1);
      R = lerp(0, R0, E.inOutCubic(v));
      rot = -Math.PI / 2 - spin * (1 - v) * 0.9;
      src = to;
    } else {
      R = 0;
      rot = -Math.PI / 2;
    }
    fillAll(ctx, C.black);
    // subtle halftone texture on the black surround
    ctx.fillStyle = MV.patterns.dots(ctx, { cell: 18, radius: 0.3, color: C.gray });
    ctx.fillRect(-60, -60, W + 120, H + 120);
    if (src && R > 1) {
      ctx.save();
      ctx.beginPath();
      starSub(ctx, cx, cy, R, ratio, rot);
      ctx.clip();
      paint(ctx, src);
      ctx.restore();
    }
    if (R > 1) {
      // echo rings outside the iris
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      starSub(ctx, cx, cy, R * 1.14 + 30, ratio, rot);
      ctx.lineWidth = 6;
      ctx.strokeStyle = C.red;
      ctx.stroke();
      ctx.beginPath();
      starSub(ctx, cx, cy, R * 1.3 + 60, ratio, rot);
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.redDeep;
      ctx.stroke();
      // the iris edge: thick red + white keyline
      ctx.beginPath();
      starSub(ctx, cx, cy, R + 8, ratio, rot);
      ctx.lineWidth = 22;
      ctx.strokeStyle = C.red;
      ctx.stroke();
      ctx.beginPath();
      starSub(ctx, cx, cy, R, ratio, rot);
      ctx.lineWidth = 6;
      ctx.strokeStyle = C.white;
      ctx.stroke();
    }
    // pin-point star blink at the closed moment
    const mid = 1 - Math.abs(p - 0.5) / 0.12;
    if (mid > 0) {
      const s = E.outBack(clamp(mid * 1.6)) * 70;
      ctx.fillStyle = C.red;
      MV.draw.star(ctx, cx, cy, s, s * 0.45);
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = C.white;
      ctx.stroke();
      ctx.fillStyle = C.white;
      for (let i = 0; i < 4; i++) {
        const a = i * (TAU / 4) + 0.4;
        MV.draw.sparkle(ctx, cx + Math.cos(a) * s * 2.1, cy + Math.sin(a) * s * 1.7, s * 0.32);
        ctx.fill();
      }
    }
  });

  /* ---- stripe-wipe: diagonal stripes grow to cover, then shrink away -- */
  regT('stripe-wipe', 0.6, (ctx, from, to, p, env, seed) => {
    const ang = (rnd(seed, 1) < 0.5 ? -35 : 35) * DEG;
    const P = 96 + 40 * rnd(seed, 2);
    const L = DIAG / 2 + 80;
    const n = Math.ceil((2 * L) / P) + 1;
    const flip = rnd(seed, 3) < 0.5;
    const MID = 0.5;
    const phase1 = p < MID;
    paint(ctx, phase1 ? from : to);
    const u = phase1 ? E.inOutQuad(p / MID) : E.inOutQuad(seg(p, MID, 1));
    const spread = 0.9;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(ang);
    for (let i = 0; i < n; i++) {
      const s0 = -L + i * P;
      const g = flip ? 1 - i / (n - 1) : i / (n - 1);
      const f = clamp(u * (1 + spread) - g * spread);
      if (f <= 0 && phase1) continue;
      if (f >= 1 && !phase1) continue;
      const th = phase1 ? f * P : (1 - f) * P;
      const y0 = phase1 ? s0 : s0 + P - th;
      const red = i % 2 === 0;
      ctx.fillStyle = red ? C.red : C.black;
      ctx.fillRect(-L, y0 - 0.5, 2 * L, th + 1);
      // white keyline on the moving edge
      if (th > 6 && th < P - 1) {
        ctx.fillStyle = red ? C.white : C.red;
        ctx.fillRect(-L, phase1 ? y0 + th - 6 : y0, 2 * L, 6);
      }
    }
    ctx.restore();
    // fully covered frame reads as a bold stripe pattern with halftone dots
    const cover = 1 - Math.abs(p - MID) / 0.12;
    if (cover > 0) {
      ctx.globalAlpha = clamp(cover);
      ctx.fillStyle = tonePattern(ctx, 22, 6, C.blood);
      ctx.fillRect(-60, -60, W + 120, H + 120);
      ctx.globalAlpha = 1;
    }
  });

  /* ---- glitch-cut: slice displacement + channel split between frames -- */
  let scratch = null;
  function getScratch() {
    if (!scratch) scratch = MV.makeCanvas(W, 240);
    return scratch;
  }
  function sliceFrom(ctx, src, y, h, dx) {
    if (!src || !src.width) {
      ctx.fillStyle = C.black;
      ctx.fillRect(dx, y, W, h);
      return;
    }
    const ky = src.height / H;
    ctx.drawImage(src, 0, y * ky, src.width, h * ky, dx, y, W, h);
    if (dx > 0) ctx.drawImage(src, 0, y * ky, src.width, h * ky, dx - W, y, W, h);
    else if (dx < 0) ctx.drawImage(src, 0, y * ky, src.width, h * ky, dx + W, y, W, h);
  }
  // Red channel shifted by dx, green/blue in place (for a band of height h ≤ 240).
  function channelSplit(ctx, src, y, h, dx) {
    if (!src || !src.width) return;
    const s = getScratch();
    const ky = src.height / H;
    h = Math.min(h, 240);
    const pass = (color, off, op) => {
      s.ctx.globalCompositeOperation = 'copy';
      s.ctx.drawImage(src, 0, y * ky, src.width, h * ky, 0, 0, W, h);
      s.ctx.globalCompositeOperation = 'multiply';
      s.ctx.fillStyle = color;
      s.ctx.fillRect(0, 0, W, h);
      ctx.globalCompositeOperation = op;
      ctx.drawImage(s.canvas, 0, 0, W, h, off, y, W, h);
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, W, h);
    ctx.clip();
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, y, W, h);
    pass('#00FFFF', 0, 'lighter');
    pass('#FF0000', dx, 'lighter');
    ctx.restore();
    s.ctx.globalCompositeOperation = 'source-over';
  }
  regT('glitch-cut', 0.3, (ctx, from, to, p, env, seed) => {
    const steps = 9;
    const step = Math.min(steps - 1, Math.floor(p * steps));
    const amp = Math.pow(Math.sin(Math.PI * p), 0.6);
    const base = p < 0.5 ? from : to;
    const other = p < 0.5 ? to : from;
    paint(ctx, base);
    const ss = MV.hash32(seed, step);
    const n = 4 + Math.floor(rnd(ss, 1) * 4 * amp);
    let splits = 0;
    for (let i = 0; i < n; i++) {
      const h = 10 + rnd(ss, i, 2) * 150 * (0.4 + amp);
      const y = rnd(ss, i, 3) * (H - h);
      const dx = srnd(ss, i, 4) * (40 + 300 * amp);
      const useOther = rnd(ss, i, 5) < 0.45 + 0.3 * amp;
      const src = useOther ? other : base;
      const mode = rnd(ss, i, 6);
      if (mode < 0.22 * amp + 0.08 && splits++ < 1) channelSplit(ctx, src, y, Math.min(h, 110), dx * 0.25 + 18);
      else sliceFrom(ctx, src, y, h, dx);
      if (mode > 0.86) {
        // inverted slice
        ctx.save();
        ctx.globalCompositeOperation = 'difference';
        ctx.fillStyle = C.white;
        ctx.fillRect(0, y, W, h);
        ctx.restore();
      }
    }
    // solid glitch blocks and thin tear lines
    const nb = Math.floor(3 + 7 * amp);
    for (let i = 0; i < nb; i++) {
      const bw = 40 + rnd(ss, i, 7) * 420, bh = 6 + rnd(ss, i, 8) * 34;
      const bx = rnd(ss, i, 9) * (W - bw), by = rnd(ss, i, 10) * (H - bh);
      const c = rnd(ss, i, 11);
      ctx.fillStyle = c < 0.45 ? C.red : c < 0.75 ? C.black : C.white;
      ctx.fillRect(bx, by, bw, bh);
    }
    ctx.fillStyle = C.white;
    for (let i = 0; i < 3; i++) ctx.fillRect(0, rnd(ss, i, 12) * H, W, 2);
  });

  /* ---- zoom-punch: old frame punches in and whites out --------------- */
  function speedWedges(ctx, fx, fy, inner, count, seed, color, width) {
    ctx.fillStyle = color;
    ctx.beginPath();
    const outer = DIAG;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + srnd(seed, i, 1) * (TAU / count) * 0.45;
      const w = (width || 0.012) * (0.4 + rnd(seed, i, 2));
      const r0 = inner * (0.85 + 0.5 * rnd(seed, i, 3));
      ctx.moveTo(fx + Math.cos(a) * r0, fy + Math.sin(a) * r0);
      ctx.lineTo(fx + Math.cos(a - w) * outer, fy + Math.sin(a - w) * outer);
      ctx.lineTo(fx + Math.cos(a + w) * outer, fy + Math.sin(a + w) * outer);
      ctx.closePath();
    }
    ctx.fill();
  }
  regT('zoom-punch', 0.45, (ctx, from, to, p, env, seed) => {
    const fx = W / 2 + srnd(seed, 1) * 260, fy = H / 2 + srnd(seed, 2) * 120;
    const SW = 0.55;
    const zoomed = (src, s) => {
      ctx.save();
      ctx.translate(fx, fy);
      ctx.scale(s, s);
      ctx.translate(-fx, -fy);
      paint(ctx, src);
      ctx.restore();
    };
    const dmax = Math.max(Math.hypot(fx, fy), Math.hypot(W - fx, fy), Math.hypot(fx, H - fy), Math.hypot(W - fx, H - fy));
    const radial = (cell, color, tone) => toneField(ctx, { kind: 'radial', cx: fx, cy: fy, cell, color, tone, levels: 8 });
    if (p < SW) {
      const u = p / SW;
      const s = 1 + 0.75 * E.inCubic(u);
      zoomed(from, s);
      if (u > 0.35 && u < 0.85) {
        // zoom-blur ghost
        ctx.globalAlpha = 0.32 * Math.sin(Math.PI * seg(u, 0.35, 0.85));
        zoomed(from, s * 1.1);
        ctx.globalAlpha = 1;
      }
      speedWedges(ctx, fx, fy, lerp(DIAG * 0.7, 180, E.outCubic(u)), 70, seed + Math.floor(u * 8), C.white, 0.012);
      // white-out as halftone: dots swell in from the edges until the frame is white
      const a = E.inQuad(seg(u, 0.25, 1));
      if (a > 0) radial(30, C.white, (d) => (a * 2.1 - (1 - d / dmax) * 1.1) * 1.02);
      return;
    }
    const v = seg(p, SW, 1);
    zoomed(to, 1 + 0.16 * (1 - E.outCubic(v)));
    // red halftone shock ring from the focus
    dotRing(ctx, fx, fy, lerp(60, dmax * 1.05, E.outCubic(v)), 200 * (1 - v) + 40, 24, C.red, 1 - v * 0.5);
    // white dots shrink away from the focus outwards
    const b = E.outQuad(v);
    if (b < 1) radial(30, C.white, (d) => (1 - (b * 2.1 - (d / dmax) * 1.1)) * 1.02);
  });

  /* ================================================================== */
  /* EFFECTS                                                            */
  /* ================================================================== */
  /**
   * Register an effect. fn(ctx, env, a, lt, dur, q, s, seed) where lt = local
   * seconds, q = lt / dur, s = strength.
   */
  function regE(name, layer, duration, fn) {
    MV.effects.register(name, {
      layer,
      duration,
      draw(ctx, env, a) {
        if (!env || !a) return;
        const dur = a.dur > 0 ? +a.dur : duration;
        const lt = env.t - (+a.t || 0);
        if (!(lt >= 0 && lt <= dur)) return;
        const s = a.strength == null ? 1 : clamp(+a.strength || 0, 0, 2);
        if (s <= 0) return;
        const seed = a.seed != null ? +a.seed || 0 : MV.hash32(name, +a.t || 0);
        ctx.save();
        try {
          fn(ctx, env, a, lt, dur, lt / dur, s, seed);
        } finally {
          ctx.restore();
        }
      },
    });
  }
  // Entrance / exit envelopes: ein 0→1 over [0, tin], eout 0→1 over [dur−tout, dur].
  const ein = (lt, tin) => clamp(lt / tin);
  const eout = (lt, dur, tout) => clamp((lt - (dur - tout)) / tout);
  const colorOf = (a, def) => {
    const c = (a.data && a.data.color) || a.color || def;
    return C[c] || (typeof c === 'string' && c[0] === '#' ? c : C[def] || def);
  };

  /* ---- flash: hard white/red frame, halftone dissolve ----------------- */
  regE('flash', 'over', 0.3, (ctx, env, a, lt, dur, q, s, seed) => {
    const col = colorOf(a, 'white');
    const hold = Math.min(0.05, dur * 0.2);
    if (lt < hold) {
      ctx.globalAlpha = clamp(0.95 * s);
      fillAll(ctx, col);
      return;
    }
    const u = E.outQuad(seg(lt, hold, dur));
    const ax = linAxis((rnd(seed, 1) < 0.5 ? 45 : 225) * DEG);
    ctx.globalAlpha = clamp(0.95 * s);
    toneField(ctx, { kind: 'linear', ang: ax.ang, cell: 30, color: col, tone: (v) => (1 - (u * 1.7 - ax.norm(v) * 0.7)) * 1.02 });
  });

  /* ---- speedlines: manga radial lines around a focus point ------------ */
  regE('speedlines', 'under', 0.6, (ctx, env, a, lt, dur, q, s, seed) => {
    const fx = a.x != null ? +a.x : W / 2, fy = a.y != null ? +a.y : H / 2;
    const col = colorOf(a, 'white');
    const i = E.outExpo(ein(lt, 0.12));
    const o = eout(lt, dur, 0.18);
    const frame = Math.floor(lt * 24); // lines re-roll 24× per second
    const inner = lerp(DIAG * 0.6, 330, i) + 380 * E.inQuad(o);
    const count = Math.round(90 * Math.min(1.4, s));
    ctx.globalAlpha = clamp(s) * (1 - o * 0.6);
    speedWedges(ctx, fx, fy, inner, count, MV.hash32(seed, frame), col, 0.009);
    // a few heavier accent lines in red
    speedWedges(ctx, fx, fy, inner * 1.15, 10, MV.hash32(seed, frame, 7), col === C.red ? C.black : C.red, 0.016);
  });

  /* ---- ink: splat that blooms, then drips ----------------------------- */
  regE('ink', 'under', 1.6, (ctx, env, a, lt, dur, q, s, seed) => {
    const x = a.x != null ? +a.x : 260 + rnd(seed, 1) * (W - 520);
    const y = a.y != null ? +a.y : 200 + rnd(seed, 2) * (H - 460);
    const R = 230 * s * (a.data && a.data.size ? +a.data.size : 1);
    const col = colorOf(a, 'ink');
    const sh = col === C.red ? C.ink : C.red;
    const bloom = E.outExpo(ein(lt, 0.18));
    const out = E.inBack(eout(lt, dur, 0.22), 1.6);
    const r = R * lerp(0.15, 1, bloom) * (1 + 0.05 * E.outQuad(seg(lt, 0.18, dur)));
    const shape = (dx, dy) => {
      ctx.beginPath();
      inkSplat(ctx, x + dx, y + dy, r, seed, { reach: bloom, arms: 13, drops: 26 });
      // drips: rounded runs growing down from the lower rim
      for (let m = 0; m < 6; m++) {
        const ax = x + dx + srnd(seed, m, 41) * r * 0.7;
        const w = r * (0.045 + 0.06 * rnd(seed, m, 42));
        const d0 = 0.16 + 0.25 * rnd(seed, m, 43);
        const len = R * (0.4 + 1.1 * rnd(seed, m, 44)) * E.outCubic(seg(lt, d0, d0 + 1.1));
        if (len < 2) continue;
        const top = y + dy + Math.sqrt(Math.max(0, 1 - Math.pow((ax - x - dx) / (r * 1.05), 2))) * r * 0.8;
        ctx.rect(ax - w / 2, top - w, w, len + w);
        ctx.moveTo(ax + w * 0.85, top + len);
        ctx.arc(ax, top + len, w * 0.85, 0, TAU);
      }
      ctx.fill();
    };
    // exit: the splat snaps shut (scale to nothing along the house angle)
    if (out > 0) {
      const k = Math.max(0, 1 - out);
      ctx.translate(x, y);
      ctx.rotate(-12 * DEG);
      ctx.scale(1, k);
      ctx.rotate(12 * DEG);
      ctx.translate(-x, -y);
    }
    ctx.fillStyle = sh;
    shape(16, 12);
    ctx.fillStyle = col;
    shape(0, 0);
  });

  /* ---- stars: burst of 5-point stars and sparkles --------------------- */
  regE('stars', 'over', 1.2, (ctx, env, a, lt, dur, q, s, seed) => {
    const x = a.x != null ? +a.x : W / 2, y = a.y != null ? +a.y : H / 2;
    const n = Math.round(24 * Math.min(1.5, s));
    const fly = E.outExpo(clamp(lt / (dur * 0.55)));
    const out = eout(lt, dur, dur * 0.3);
    const beat = beatOf(env);
    // central pop
    if (lt < 0.16) {
      const u = lt / 0.16;
      ctx.fillStyle = C.white;
      MV.draw.burst(ctx, x, y, 50 + 60 * u, 140 + 120 * u, 12, seed, 0.35, u * 0.5);
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = C.red;
      ctx.stroke();
    }
    const cols = [C.white, C.red, C.star, C.white, C.yellow];
    ctx.lineJoin = 'miter';
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + srnd(seed, i, 1) * 0.3;
      const dist = (220 + 520 * rnd(seed, i, 2)) * (0.7 + 0.3 * s);
      const px = x + Math.cos(ang) * dist * fly;
      const py = y + Math.sin(ang) * dist * fly * 0.8 + 140 * lt * lt;
      const pop = E.outBack(clamp((lt - rnd(seed, i, 3) * 0.08) / 0.18), 2.4);
      const size = (16 + 44 * rnd(seed, i, 4)) * pop * (1 - E.inQuad(out)) * (1 + 0.15 * beat.pulse);
      if (size < 1) continue;
      const rot = srnd(seed, i, 5) * 3 * lt + srnd(seed, i, 6);
      const sparkle = rnd(seed, i, 7) < 0.4;
      const col = cols[Math.floor(rnd(seed, i, 8) * cols.length)];
      if (sparkle) {
        ctx.fillStyle = col === C.red ? C.white : col;
        MV.draw.sparkle(ctx, px, py, size * 1.3, 0.16, rot * 0.3);
        ctx.fill();
      } else {
        ctx.fillStyle = C.black;
        MV.draw.star(ctx, px + size * 0.14, py + size * 0.14, size, size * 0.45, 5, rot - Math.PI / 2);
        ctx.fill();
        MV.draw.star(ctx, px, py, size, size * 0.45, 5, rot - Math.PI / 2);
        ctx.fillStyle = col;
        ctx.fill();
        ctx.lineWidth = Math.max(2, size * 0.1);
        ctx.strokeStyle = col === C.red ? C.white : C.black;
        ctx.stroke();
      }
    }
  });

  /* ---- shards: glass bits flying across ------------------------------- */
  regE('shards', 'over', 1.0, (ctx, env, a, lt, dur, q, s, seed) => {
    const dir = a.data && a.data.dir ? Math.sign(+a.data.dir) || 1 : rnd(seed, 1) < 0.5 ? 1 : -1;
    const n = Math.round(24 * Math.min(1.6, s));
    const ang = -12 * DEG * dir;
    ctx.lineJoin = 'miter';
    for (let i = 0; i < n; i++) {
      const d0 = rnd(seed, i, 1) * dur * 0.35;
      const travel = dur * (0.45 + 0.3 * rnd(seed, i, 2));
      const u = (lt - d0) / travel;
      if (u <= 0 || u >= 1) continue;
      const along = lerp(-300, W + 300, E.inOutQuad(u) * 0.3 + u * 0.7);
      const px = dir > 0 ? along : W - along;
      const py0 = 80 + rnd(seed, i, 3) * (H - 160);
      const py = py0 + Math.tan(ang) * (px - W / 2) * dir;
      const size = (26 + 90 * Math.pow(rnd(seed, i, 4), 1.5)) * (0.7 + 0.3 * s);
      const rot = srnd(seed, i, 5) * 0.4 + srnd(seed, i, 6) * 9 * u;
      // streak behind
      ctx.fillStyle = C.white;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.fillRect(-dir * size * 3.6 - (dir > 0 ? 0 : 0), -1.5, dir * size * 3.2, 3);
      ctx.restore();
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      const pts = [];
      const nv = rnd(seed, i, 7) < 0.6 ? 3 : 4;
      for (let v = 0; v < nv; v++) {
        const aa = (v / nv) * TAU + srnd(seed, i, 10 + v) * 0.6;
        const rr = size * (0.5 + 0.6 * rnd(seed, i, 20 + v)) * (v === 0 ? 1.5 : 1);
        pts.push([Math.cos(aa) * rr, Math.sin(aa) * rr * 0.7]);
      }
      const kind = rnd(seed, i, 8);
      ctx.save();
      ctx.translate(size * 0.12, size * 0.12);
      polyPath(ctx, pts);
      ctx.fillStyle = kind < 0.6 ? C.black : kind < 0.85 ? C.black : C.red;
      ctx.fill();
      ctx.restore();
      polyPath(ctx, pts);
      if (kind < 0.6) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = C.white;
        ctx.stroke();
        // glint
        ctx.beginPath();
        ctx.moveTo(pts[0][0] * 0.5, pts[0][1] * 0.5);
        ctx.lineTo(pts[1][0] * 0.35, pts[1][1] * 0.35);
        ctx.lineWidth = 3;
        ctx.stroke();
      } else if (kind < 0.85) {
        ctx.fillStyle = C.red;
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = C.black;
        ctx.stroke();
      } else {
        ctx.fillStyle = C.black;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = C.white;
        ctx.stroke();
      }
      ctx.restore();
    }
  });

  /* ---- ring: halftone shock ring ------------------------------------- */
  /** Halftone ring: rows of dots inside [r − bw, r], biggest at the leading edge. */
  function dotRing(ctx, x, y, r, bw, cell, color, fade) {
    const rows = Math.max(2, Math.floor(bw / cell) + 1);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let k = 0; k < rows; k++) {
      const rr = r - k * cell;
      if (rr <= 4) break;
      const dr = cell * 0.62 * (1 - k / rows) * fade;
      if (dr < 0.8) continue;
      const cnt = Math.min(420, Math.max(8, Math.floor((TAU * rr) / cell)));
      const off = (k % 2) * 0.5;
      for (let i = 0; i < cnt; i++) {
        const aa = ((i + off) / cnt) * TAU;
        const px = x + Math.cos(aa) * rr, py = y + Math.sin(aa) * rr;
        if (px < -cell || px > W + cell || py < -cell || py > H + cell) continue;
        ctx.moveTo(px + dr, py);
        ctx.arc(px, py, dr, 0, TAU);
      }
    }
    ctx.fill();
  }
  regE('ring', 'under', 0.7, (ctx, env, a, lt, dur, q, s, seed) => {
    const x = a.x != null ? +a.x : W / 2, y = a.y != null ? +a.y : H / 2;
    const col = colorOf(a, 'red');
    const e = E.outQuart(q);
    const r = lerp(40, 1250 * (0.6 + 0.4 * Math.min(1.5, s)), e);
    const bw = lerp(170, 40, q);
    const fade = 1 - E.inQuad(seg(q, 0.55, 1));
    dotRing(ctx, x, y, r, bw, 22, col, fade);
    // leading solid edge
    ctx.beginPath();
    ctx.arc(x, y, r + 22 * 0.8, 0, TAU);
    ctx.lineWidth = Math.max(2, 16 * fade);
    ctx.strokeStyle = col === C.white ? C.red : C.white;
    ctx.stroke();
  });

  /* ---- frame: red/black border slam with corner triangles ------------ */
  regE('frame', 'over', 1.0, (ctx, env, a, lt, dur, q, s, seed) => {
    const i = E.outBack(ein(lt, 0.2), 1.9);
    const o = E.inCubic(eout(lt, dur, 0.2));
    const k = i * (1 - o);
    if (k <= 0.001) return;
    const beat = beatOf(env);
    const bh = 64 * Math.min(1.3, s), bw = 44 * Math.min(1.3, s);
    ctx.save();
    // top / bottom bars slam vertically, side bars horizontally
    const ty = -bh + bh * k, by = H - bh * k;
    ctx.fillStyle = C.black;
    ctx.fillRect(-40, ty - 40, W + 80, bh + 40);
    ctx.fillRect(-40, by, W + 80, bh + 40);
    ctx.fillStyle = C.red;
    ctx.fillRect(-40, ty + bh - 14, W + 80, 14);
    ctx.fillRect(-40, by, W + 80, 14);
    const lx = -bw + bw * k, rx = W - bw * k;
    ctx.fillStyle = C.black;
    ctx.fillRect(lx - 40, -40, bw + 40, H + 80);
    ctx.fillRect(rx, -40, bw + 40, H + 80);
    ctx.fillStyle = C.white;
    ctx.fillRect(lx + bw - 6, -40, 6, H + 80);
    ctx.fillRect(rx, -40, 6, H + 80);
    ctx.restore();
    // corner triangles
    const T = 250 * Math.min(1.3, s) * (1 + 0.07 * beat.pulse);
    const corners = [[0, 0, 1, 1], [W, 0, -1, 1], [W, H, -1, -1], [0, H, 1, -1]];
    corners.forEach((c, n) => {
      const kk = E.outBack(clamp((lt - 0.04 - n * 0.03) / 0.2), 2.2) * (1 - o);
      if (kk <= 0.001) return;
      const sz = T * kk * (0.85 + 0.3 * rnd(seed, n));
      const tri = [[c[0], c[1]], [c[0] + c[2] * sz * 1.35, c[1]], [c[0], c[1] + c[3] * sz]];
      ctx.save();
      ctx.translate(c[2] * 12, c[3] * 12);
      polyPath(ctx, tri);
      ctx.fillStyle = C.black;
      ctx.fill();
      ctx.restore();
      fillPoly(ctx, tri, C.red);
      fillPoly(ctx, tri, tonePattern(ctx, 16, 6, C.black));
      ctx.lineJoin = 'miter';
      ctx.lineWidth = 10;
      ctx.strokeStyle = C.black;
      polyPath(ctx, tri);
      ctx.stroke();
      // white keyline parallel to the hypotenuse
      ctx.beginPath();
      ctx.moveTo(c[0] + c[2] * sz * 1.35 * 0.62, c[1] + c[3] * 6);
      ctx.lineTo(c[0] + c[2] * 6, c[1] + c[3] * sz * 0.62);
      ctx.lineWidth = 7;
      ctx.strokeStyle = C.white;
      ctx.stroke();
    });
  });

  /* ---- confetti: paper scraps tumbling -------------------------------- */
  regE('confetti', 'over', 2.6, (ctx, env, a, lt, dur, q, s, seed) => {
    const n = Math.round(110 * Math.min(1.6, s));
    const burst = a.x != null || a.y != null;
    const bx = a.x != null ? +a.x : W / 2, by = a.y != null ? +a.y : H * 0.6;
    const out = eout(lt, dur, 0.35);
    const cols = [C.red, C.white, C.black, C.paper, C.white, C.black];
    for (let i = 0; i < n; i++) {
      let px, py;
      if (burst) {
        const ang = -Math.PI / 2 + srnd(seed, i, 1) * 1.25;
        const v0 = 900 + 900 * rnd(seed, i, 2);
        const tt = Math.max(0, lt - rnd(seed, i, 3) * 0.06);
        const drag = (1 - Math.exp(-2.2 * tt)) / 2.2;
        px = bx + Math.cos(ang) * v0 * drag + Math.sin(tt * (2 + rnd(seed, i, 4) * 2) + i) * 30;
        py = by + Math.sin(ang) * v0 * drag + 520 * tt * tt;
      } else {
        const d0 = rnd(seed, i, 3) * dur * 0.3;
        const tt = lt - d0;
        if (tt < 0) continue;
        const v = 380 + 380 * rnd(seed, i, 2);
        const sway = 40 + 90 * rnd(seed, i, 4);
        px = rnd(seed, i, 1) * (W + 200) - 100 + Math.sin(tt * (1.4 + rnd(seed, i, 5) * 1.6) + i) * sway;
        py = -60 - 420 * rnd(seed, i, 13) + v * (tt + 0.35);
      }
      if (py > H + 80 || py < -120) continue;
      const w = 24 + 34 * rnd(seed, i, 6), h = 13 + 17 * rnd(seed, i, 7);
      const flip = Math.cos(lt * (5 + 8 * rnd(seed, i, 8)) + i * 1.7);
      const rot = srnd(seed, i, 9) * 3 + lt * srnd(seed, i, 10) * 6;
      const col = cols[Math.floor(rnd(seed, i, 11) * cols.length)];
      ctx.save();
      ctx.globalAlpha = 1 - E.inQuad(out);
      ctx.translate(px, py);
      ctx.rotate(rot);
      ctx.scale(1, flip);
      ctx.beginPath();
      if (rnd(seed, i, 12) < 0.3) {
        ctx.moveTo(-w / 2, h / 2);
        ctx.lineTo(w / 2, h / 2);
        ctx.lineTo(0, -h);
        ctx.closePath();
      } else ctx.rect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = col === C.black ? C.white : C.black;
      ctx.stroke();
      ctx.restore();
    }
  });

  /* ---- caption: small skewed black plate + red tab -------------------- */
  regE('caption', 'over', 3.0, (ctx, env, a, lt, dur, q, s, seed) => {
    const text = String(a.text == null ? '' : a.text).trim();
    if (!text) return;
    const x = a.x != null ? +a.x : 96, y = a.y != null ? +a.y : 104;
    const sub = a.data && a.data.sub ? String(a.data.sub) : '';
    const i = E.outExpo(ein(lt, 0.22));
    const o = E.inCubic(eout(lt, dur, 0.2));
    const beat = beatOf(env);
    const size = 40 * clamp(s, 0.7, 1.4);
    const fontFn = (sz) => textFont(sz, text, MV.FONTS.latinCond, MV.FONTS.jpHeavy);
    ctx.font = fontFn(size);
    const fs = fitFont(ctx, text, size, 900, fontFn);
    const tw = ctx.measureText(text).width;
    const ph = fs * 1.55, pw = tw + fs * 1.4;
    const skew = ph * 0.22;
    const tab = ph * 0.7;
    const k = i * (1 - o);
    if (k <= 0.001) return;
    ctx.save();
    ctx.translate(x - (1 - i) * 80 - o * 160, y - 5 * beat.pulse);
    ctx.rotate(-4 * DEG - 0.012 * beat.pulse);
    // plate grows from the tab
    ctx.fillStyle = C.red;
    MV.draw.skewRect(ctx, tab * 0.35 + 7, 7, (pw) * k, ph, skew);
    ctx.fill();
    ctx.fillStyle = C.black;
    MV.draw.skewRect(ctx, tab * 0.35, 0, pw * k, ph, skew);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.white;
    ctx.stroke();
    // red tab with a mini star
    ctx.fillStyle = C.red;
    MV.draw.skewRect(ctx, -tab * 0.5, -6, tab, ph + 12, skew);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = C.black;
    ctx.stroke();
    ctx.fillStyle = C.white;
    const sr = tab * 0.3 * (1 + 0.25 * beat.pulse);
    MV.draw.star(ctx, skew * 0.5, ph / 2, sr, sr * 0.43, 5, -Math.PI / 2 + 0.3 * beat.pulse);
    ctx.fill();
    // text (clipped to the plate while it grows)
    ctx.save();
    MV.draw.skewRect(ctx, tab * 0.35, 0, pw * k, ph, skew);
    ctx.clip();
    ctx.font = MV.text.font(fs, isLatinStr(text) ? MV.FONTS.latinCond : MV.FONTS.jpHeavy, 400);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.white;
    ctx.fillText(text, tab * 0.35 + fs * 0.75 + (1 - i) * 40, ph / 2 + vCenter(ctx, text));
    ctx.restore();
    if (sub) {
      ctx.font = MV.text.font(fs * 0.55, MV.FONTS.latinCond, 400);
      ctx.fillStyle = C.red;
      ctx.textAlign = 'left';
      ctx.transform(1, 0, -0.2, 1, 0, 0);
      hardText(ctx, sub.toUpperCase(), tab * 0.7 + 10, -10, { fill: C.white, shadow: C.red, sx: 3, sy: 3, lw: 5 });
    }
    ctx.restore();
  });

  /* ---- credits: P5-UI-flavoured stacked credit card ------------------- */
  const CREDIT_ROWS = [
    { key: 'title', label: 'SONG', jp: '曲' },
    { key: 'artist', label: 'VOCAL', jp: '歌' },
    { key: 'lyricist', label: 'LYRICS', jp: '作詞' },
    { key: 'composer', label: 'MUSIC', jp: '作曲' },
  ];
  regE('credits', 'over', 9.0, (ctx, env, a, lt, dur, q, s, seed) => {
    const m = meta(a);
    const rows = CREDIT_ROWS.filter((r) => m[r.key]);
    if (!rows.length) return;
    const beat = beatOf(env);
    const x0 = a.x != null ? +a.x : 130, y0 = a.y != null ? +a.y : 250;
    const rowH = 112, gap = 24;
    const outStart = dur - 0.6;
    const blockH = 40 + rows.length * (rowH + gap);
    // backdrop: a big black skewed panel that slams in first and leaves last
    const pi = E.outExpo(ein(lt, 0.22));
    const po = E.inCubic(seg(lt, dur - 0.22, dur));
    if (pi * (1 - po) > 0.001) {
      const bw = 1180, bh = blockH + 230, sk = 110;
      const tx = x0 - 120 - (1 - pi) * 1500 - po * 1800, ty = y0 - 170, rot = -5 * DEG;
      fillPoly(ctx, xf(skewPts(22, 22, bw, bh, sk), tx, ty, rot), C.red);
      const panel = xf(skewPts(0, 0, bw, bh, sk), tx, ty, rot);
      fillPoly(ctx, panel, C.black);
      fillPoly(ctx, panel, tonePattern(ctx, 16, 5, C.gray)); // unrotated pattern: fast
      // diagonal red slash through the panel's lower right (points on the panel edges)
      const rx = (y) => bw + sk * (1 - y / bh);
      fillPoly(ctx, xf([[bw * 0.72, bh], [rx(bh * 0.42), bh * 0.42], [rx(bh * 0.58), bh * 0.58], [bw * 0.86, bh]], tx, ty, rot), C.redDeep);
      polyPath(ctx, xf(skewPts(14, 14, bw - 40, bh - 28, sk - 6), tx, ty, rot));
      ctx.lineWidth = 5;
      ctx.strokeStyle = C.white;
      ctx.stroke();
    }
    // header
    const hi = E.outBack(ein(lt - 0.08, 0.26), 1.8);
    const ho = E.inCubic(seg(lt, outStart + 0.25, dur - 0.1));
    if (hi * (1 - ho) > 0.001) {
      ctx.save();
      ctx.translate(x0 - (1 - hi) * 700 - ho * 900, y0);
      ctx.rotate(-6 * DEG);
      ctx.fillStyle = C.red;
      MV.draw.skewRect(ctx, -30, -20, 600, 34, 28);
      ctx.fill();
      ctx.font = MV.text.font(132, MV.FONTS.latinCond, 400);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.save();
      ctx.transform(1, 0, -0.22, 1, 0, 0);
      hardText(ctx, 'CREDITS', 0, -28, { fill: C.white, shadow: C.red, sx: 10, sy: 8, lw: 12 });
      ctx.restore();
      emblem(ctx, 548, -88, 54, { rot: 0.1 * beat.pulse });
      ctx.restore();
    }
    const cursor = MV.mod(Math.floor(beat.bar || 0), rows.length);
    rows.forEach((row, n) => {
      const tIn = 0.22 + n * 0.13;
      const tOut = outStart + (rows.length - 1 - n) * 0.07;
      const ri = E.outBack(clamp((lt - tIn) / 0.3), 1.7);
      const ro = E.inCubic(clamp((lt - tOut) / 0.28));
      if (ri <= 0.001 || ro >= 0.999) return;
      const indent = [0, 52, 16, 70][n % 4];
      const y = y0 + 64 + n * (rowH + gap);
      const isCur = cursor === n;
      const slide = (1 - ri) * -1200 - ro * 1500;
      const val = m[row.key];
      ctx.save();
      ctx.translate(x0 + indent + slide + (isCur ? 22 + 10 * beat.pulse : 0), y);
      ctx.rotate((n % 2 ? -3 : -5) * DEG);
      if (isCur) ctx.scale(1.04, 1.04);
      const valFont = (sz) => textFont(sz, val, MV.FONTS.latinCond, MV.FONTS.jpHeavy);
      const vs = fitFont(ctx, val, 68, 700, valFont);
      const vw = ctx.measureText(val).width;
      const extra = row.key === 'title' && m.titleLatin ? m.titleLatin.toUpperCase() : '';
      ctx.font = MV.text.font(32, MV.FONTS.latinCond, 400);
      const ew = extra ? ctx.measureText(extra).width + 40 : 0;
      const tabW = 190;
      const pw = tabW + vw + ew + 100;
      // value plate (hard shadow, keyline)
      ctx.fillStyle = isCur ? C.red : C.redDeep;
      MV.draw.skewRect(ctx, 12, 12, pw, rowH, 32);
      ctx.fill();
      ctx.fillStyle = isCur ? C.white : C.ink;
      MV.draw.skewRect(ctx, 0, 0, pw, rowH, 32);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = isCur ? C.black : C.white;
      ctx.stroke();
      // label tab
      ctx.fillStyle = C.red;
      MV.draw.skewRect(ctx, -16, 14, tabW, rowH - 28, 26);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = C.black;
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.save();
      ctx.transform(1, 0, -0.18, 1, 0, 0);
      ctx.font = MV.text.font(50, MV.FONTS.latinCond, 400);
      ctx.fillStyle = C.white;
      ctx.fillText(row.label, 24, rowH / 2 + 12);
      ctx.restore();
      ctx.font = MV.text.font(20, MV.FONTS.jpHeavy, 400);
      ctx.fillStyle = C.black;
      ctx.fillText(row.jp, 22, rowH / 2 + 38);
      // value
      ctx.font = valFont(vs);
      ctx.fillStyle = isCur ? C.black : C.white;
      ctx.fillText(val, tabW + 36, rowH / 2 + vCenter(ctx, val));
      if (extra) {
        ctx.save();
        ctx.font = MV.text.font(32, MV.FONTS.latinCond, 400);
        ctx.translate(tabW + 36 + vw + 30, rowH / 2 + 28);
        ctx.transform(1, 0, -0.2, 1, 0, 0);
        ctx.fillStyle = C.red;
        ctx.fillText(extra, 0, 0);
        ctx.restore();
      }
      // cursor arrow
      if (isCur) {
        ctx.fillStyle = C.red;
        ctx.beginPath();
        ctx.moveTo(-84, rowH / 2 - 30);
        ctx.lineTo(-30, rowH / 2);
        ctx.lineTo(-84, rowH / 2 + 30);
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 5;
        ctx.strokeStyle = C.white;
        ctx.stroke();
      }
      ctx.restore();
    });
  });

  /* ---- title: big song-title card for the intro ----------------------- */
  regE('title', 'over', 8.6, (ctx, env, a, lt, dur, q, s, seed) => {
    const m = meta(a);
    const title = m.title || m.titleLatin;
    if (!title) return;
    const beat = beatOf(env);
    const cx = a.x != null ? +a.x : W / 2, cy = a.y != null ? +a.y : H * 0.45;
    const o = eout(lt, dur, 0.32);
    const oe = E.inExpo(o);
    const pulse = beat.pulse;
    const lean = -7 * DEG;
    // calm the scene: flat dim + halftone vignette (dot size encodes tone)
    const vin = E.outQuad(ein(lt, 0.35)) * (1 - oe);
    if (vin > 0.001) {
      ctx.globalAlpha = 0.34 * vin;
      fillAll(ctx, C.ink);
      ctx.globalAlpha = 1;
      ctx.globalAlpha = vin;
      ctx.drawImage(vignetteSprite(cx, cy), 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    ctx.save();
    ctx.translate(oe * 2600, 0);
    // black title band across the frame (slides in from the right)
    const bi = E.outExpo(ein(lt, 0.24));
    if (bi > 0.001) {
      const tx = cx + (1 - bi) * 2400, ty = cy + 30;
      const rect = (y, h) => xf([[-1500, y], [1500, y], [1500, y + h], [-1500, y + h]], tx, ty, lean);
      fillPoly(ctx, rect(-262 + 16, 540), C.red);
      const band = rect(-262, 540);
      fillPoly(ctx, band, C.ink);
      fillPoly(ctx, band, tonePattern(ctx, 16, 6, C.gray));
      fillPoly(ctx, rect(-262 + 18, 6), C.white);
      fillPoly(ctx, rect(278 - 24, 6), C.white);
    }
    // starburst behind the card (white core, black keyline), slowly turning
    const si = E.outBack(ein(lt - 0.1, 0.3), 1.8);
    if (si > 0.001) {
      const rot = lt * 0.06;
      const sc = si * (1 + 0.04 * pulse);
      ctx.save();
      ctx.translate(cx + 40, cy - 24);
      ctx.scale(sc, sc * 0.84);
      ctx.fillStyle = C.red;
      MV.draw.burst(ctx, 18, 16, 330, 560, 20, seed + 2, 0.34, -rot * 0.7 + 0.2);
      ctx.fill();
      ctx.fillStyle = C.white;
      MV.draw.burst(ctx, 0, 0, 330, 560, 20, seed + 2, 0.34, -rot * 0.7 + 0.2);
      ctx.fill();
      ctx.lineWidth = 12;
      ctx.strokeStyle = C.black;
      ctx.stroke();
      ctx.restore();
    }
    // the red card slams in from the left
    const ci = E.outExpo(ein(lt - 0.12, 0.32));
    const cw = 1260, ch = 340;
    if (ci > 0.001) {
      const tx = cx - (1 - ci) * 1800, ty = cy, rot = lean + (1 - ci) * -0.25;
      const cs = 1 + 0.018 * pulse;
      const sk = 90;
      fillPoly(ctx, xf(skewPts(-cw / 2 + 22, -ch / 2 + 24, cw, ch, sk), tx, ty, rot, cs), C.black);
      const card = xf(skewPts(-cw / 2, -ch / 2, cw, ch, sk), tx, ty, rot, cs);
      fillPoly(ctx, card, C.red);
      fillPoly(ctx, card, tonePattern(ctx, 20, 5, C.redDeep)); // unrotated pattern: fast
      // stripe texture on the card's lower third
      const lx = (y) => -cw / 2 + sk * (1 - (y + ch / 2) / ch);
      const yA = ch * 0.2, yB = ch / 2;
      fillPoly(ctx, xf([[lx(yA), yA], [lx(yA) + cw, yA], [lx(yB) + cw, yB], [lx(yB), yB]], tx, ty, rot, cs),
        MV.patterns.stripes(ctx, { width: 14, colors: ['rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', C.redDeep] }));
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(rot);
      ctx.scale(cs, cs);
      ctx.lineWidth = 12;
      ctx.strokeStyle = C.black;
      MV.draw.skewRect(ctx, -cw / 2, -ch / 2, cw, ch, 90);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.strokeStyle = C.white;
      MV.draw.skewRect(ctx, -cw / 2 + 16, -ch / 2 + 14, cw - 40, ch - 28, 86);
      ctx.stroke();
      ransom(ctx, title, 40, 4, 215, seed + 7, {
        onRed: true, lt: lt - 0.24, stagger: 0.085, pop: 0.24, jiggle: 1, beat, maxW: cw - 260,
      });
      ctx.restore();
    }
    // emblem pinned on the card's upper-left corner
    const ei = E.outBack(clamp((lt - 0.62) / 0.26), 2.6);
    if (ei > 0.001) {
      emblem(ctx, cx - 575, cy - 175, 122 * ei * (1 + 0.06 * pulse), { rot: -0.18 + 0.08 * Math.sin(lt * 1.3) });
    }
    // Latin title strip (left, under the card)
    const li = E.outExpo(clamp((lt - 0.75) / 0.3));
    if (li > 0.001 && m.titleLatin) {
      const lat = m.titleLatin.toUpperCase();
      ctx.font = MV.text.font(60, MV.FONTS.latinCond, 400);
      const lw = MV.text.measure(lat, ctx.font, 8) + 90;
      ctx.save();
      ctx.translate(cx - 580 + lw / 2 - (1 - li) * 1600, cy + 250);
      ctx.rotate(lean);
      ctx.fillStyle = C.red;
      MV.draw.skewRect(ctx, -lw / 2 + 12, -42 + 10, lw, 84, 30);
      ctx.fill();
      ctx.fillStyle = C.white;
      MV.draw.skewRect(ctx, -lw / 2, -42, lw, 84, 30);
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = C.black;
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.transform(1, 0, -0.2, 1, 0, 0);
      ctx.fillStyle = C.black;
      MV.text.drawSpaced(ctx, lat, -lw / 2 + 52, 22, 8);
      ctx.restore();
    }
    // artist in huge condensed Latin (right, under the card)
    const ai = E.outBack(clamp((lt - 1.0) / 0.28), 2.2);
    if (ai > 0.001 && m.artist) {
      const art = isLatinStr(m.artist) ? m.artist.toUpperCase() : m.artist;
      ctx.save();
      ctx.translate(cx + 430, cy + 300);
      ctx.rotate(6 * DEG + srnd(seed, beat.index, 3) * 0.035 * pulse);
      ctx.scale(ai, ai);
      // small red tag
      ctx.fillStyle = C.red;
      MV.draw.skewRect(ctx, -170, -150, 150, 42, 12);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = C.black;
      ctx.stroke();
      ctx.save();
      ctx.translate(-150, -118);
      ctx.transform(1, 0, -0.2, 1, 0, 0);
      ctx.font = MV.text.font(30, MV.FONTS.latinCond, 400);
      ctx.textAlign = 'left';
      ctx.fillStyle = C.white;
      ctx.fillText('VOCAL', 0, 0);
      ctx.restore();
      ctx.font = isLatinStr(art) ? MV.text.font(200, MV.FONTS.latinCond, 400) : MV.text.font(120, MV.FONTS.jpHeavy, 400);
      const aw = Math.min(900, ctx.measureText(art).width);
      // black backing plate so the name reads over anything
      ctx.fillStyle = C.red;
      MV.draw.skewRect(ctx, 40 - aw / 2 - 30 + 14, -108 + 14, aw + 70, 196, 44);
      ctx.fill();
      ctx.fillStyle = C.ink;
      MV.draw.skewRect(ctx, 40 - aw / 2 - 30, -108, aw + 70, 196, 44);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.transform(1, 0, -0.2, 1, 0, 0);
      hardText(ctx, art, 40 + 16, 70, { fill: C.white, shadow: C.red, sx: 10, sy: 8, lw: 0 });
      ctx.restore();
    }
    // twinkling sparkles round the card
    for (let i = 0; i < 10; i++) {
      const tw = clamp((lt - 0.6 - i * 0.07) / 0.2);
      if (tw <= 0) continue;
      const ph = Math.sin(lt * (2.2 + rnd(seed, i, 51)) + i * 1.9);
      const r = (16 + 30 * rnd(seed, i, 52)) * tw * (0.65 + 0.35 * ph) * (1 + 0.3 * pulse);
      const ang = (i / 10) * TAU + 0.3;
      const px = cx + Math.cos(ang) * (760 + 90 * rnd(seed, i, 53));
      const py = cy + Math.sin(ang) * (400 + 50 * rnd(seed, i, 54));
      ctx.fillStyle = i % 3 === 0 ? C.red : C.white;
      MV.draw.sparkle(ctx, px, py, r, 0.16);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.black;
      ctx.stroke();
    }
    ctx.restore();
    // exit: a white slash crosses as the card leaves
    if (o > 0 && o < 1) {
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(-35 * DEG);
      const sx = lerp(-DIAG, DIAG, E.inOutCubic(o));
      ctx.fillStyle = C.black;
      MV.draw.skewRect(ctx, sx - 1200, -44, 2400, 88, 40);
      ctx.fill();
      ctx.fillStyle = C.white;
      MV.draw.skewRect(ctx, sx - 1200, -24, 2400, 48, 40);
      ctx.fill();
      ctx.restore();
    }
  });

  /* ---- endcard: closing card, ends on black --------------------------- */
  regE('endcard', 'over', 9.0, (ctx, env, a, lt, dur, q, s, seed) => {
    const m = meta(a);
    const beat = beatOf(env);
    const cx = W / 2, cy = H * 0.47;
    const irisA = dur * 0.66, irisB = dur * 0.9;
    // dim the scene a little so the card reads
    const dim = E.outQuad(ein(lt, 0.8));
    ctx.globalAlpha = 0.35 * dim;
    fillAll(ctx, C.night);
    ctx.globalAlpha = 1;
    // stars field (twinkling, deterministic)
    for (let i = 0; i < 26; i++) {
      const tIn = 0.2 + rnd(seed, i, 61) * 1.4;
      const k = E.outBack(clamp((lt - tIn) / 0.3), 2.2);
      if (k <= 0) continue;
      const ang = rnd(seed, i, 62) * TAU;
      const rr = 380 + rnd(seed, i, 63) * 560;
      const px = cx + Math.cos(ang) * rr * 1.25, py = cy + Math.sin(ang) * rr * 0.62;
      const tw = 0.7 + 0.3 * Math.sin(lt * (1.5 + rnd(seed, i, 64) * 2) + i);
      const sz = (8 + 26 * rnd(seed, i, 65)) * k * tw;
      if (rnd(seed, i, 66) < 0.45) {
        ctx.fillStyle = C.star;
        MV.draw.sparkle(ctx, px, py, sz * 1.3, 0.14);
        ctx.fill();
      } else {
        ctx.fillStyle = i % 4 === 0 ? C.red : C.star;
        MV.draw.star(ctx, px, py, sz, sz * 0.45, 5, -Math.PI / 2 + lt * 0.2 * srnd(seed, i, 67));
        ctx.fill();
      }
    }
    // red flourish stroke drawn across under the title
    const fl = E.outExpo(clamp((lt - 0.3) / 0.7));
    if (fl > 0) {
      ctx.save();
      ctx.translate(cx, cy + 20);
      ctx.rotate(-12 * DEG);
      const len = 1500 * fl;
      ctx.fillStyle = C.black;
      MV.draw.skewRect(ctx, -750 + 14, -58 + 12, len, 116, 40);
      ctx.fill();
      ctx.fillStyle = C.red;
      MV.draw.skewRect(ctx, -750, -58, len, 116, 40);
      ctx.fill();
      // tapered tail
      ctx.beginPath();
      ctx.moveTo(-750 + len, -58);
      ctx.lineTo(-750 + len + 160 * fl, -20);
      ctx.lineTo(-750 + len - 40, 58);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // title (smaller ransom) + emblem + meta line
    const title = m.title || m.titleLatin;
    if (title) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-5 * DEG);
      ransom(ctx, title, 0, 0, 132, seed + 11, { lt: lt - 0.5, stagger: 0.09, pop: 0.26, jiggle: 0.6, beat, maxW: 1100 });
      ctx.restore();
    }
    const ei = E.outBack(clamp((lt - 1.1) / 0.3), 2.4);
    if (ei > 0) emblem(ctx, cx, cy - 210, 74 * ei, { rot: 0.12 + 0.05 * Math.sin(lt) });
    const li = E.outExpo(clamp((lt - 1.4) / 0.4));
    if (li > 0) {
      const line = [m.titleLatin ? m.titleLatin.toUpperCase() : '', m.artist ? (isLatinStr(m.artist) ? m.artist.toUpperCase() : m.artist) : '']
        .filter(Boolean)
        .join('  /  ');
      if (line) {
        ctx.save();
        ctx.translate(cx + (1 - li) * 400, cy + 190);
        ctx.rotate(-5 * DEG);
        ctx.font = textFont(46, line, MV.FONTS.latinCond, MV.FONTS.jpHeavy);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        const lw = ctx.measureText(line).width + 70;
        ctx.fillStyle = C.black;
        MV.draw.skewRect(ctx, -lw / 2, -44, lw, 64, 22);
        ctx.fill();
        ctx.fillStyle = C.white;
        ctx.fillText(line, 0, 4);
        ctx.restore();
      }
      ctx.save();
      ctx.translate(cx + 520, cy + 290);
      ctx.rotate(-5 * DEG);
      ctx.font = MV.text.font(64, MV.FONTS.latinCond, 400);
      ctx.textAlign = 'center';
      ctx.transform(1, 0, -0.2, 1, 0, 0);
      ctx.globalAlpha = li;
      hardText(ctx, 'THE END', 0, 0, { fill: C.white, shadow: C.red, sx: 6, sy: 5, lw: 9 });
      ctx.restore();
    }
    // closing star iris → black
    if (lt > irisA) {
      const u = seg(lt, irisA, irisB);
      const far = DIAG * 0.62;
      const R = lerp(far / 0.5, 0, E.inOutCubic(u));
      ctx.fillStyle = C.black;
      ctx.beginPath();
      ctx.rect(-60, -60, W + 120, H + 120);
      if (R > 1) starSub(ctx, cx, cy, R, 0.5, -Math.PI / 2 + u * 0.8);
      ctx.fill('evenodd');
      if (R > 1) {
        ctx.beginPath();
        starSub(ctx, cx, cy, R + 6, 0.5, -Math.PI / 2 + u * 0.8);
        ctx.lineWidth = 12;
        ctx.strokeStyle = C.red;
        ctx.lineJoin = 'miter';
        ctx.stroke();
      }
    }
  });

  /* ================================================================== */
  /* HUD                                                                */
  /* ================================================================== */
  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  MV.HUD = {
    /** Zones the HUD may paint into (logical px). */
    zones: { bottomLeft: { x: 0, y: H - 110, w: 620, h: 110 }, topRight: { x: W - 360, y: 0, w: 360, h: 90 } },
    /**
     * Persistent overlay. info = { title, artist, duration, visible, sectionName }.
     * Bottom-left: skewed black plate with red tab (title / artist).
     * Top-right: skewed time code (m:ss) + 4-dot beat indicator.
     */
    draw(ctx, env, info) {
      if (!ctx || !env || !info || info.visible === false) return;
      const beat = beatOf(env);
      ctx.save();
      try {
        const z = MV.HUD.zones;
        // ---- bottom-left title plate (inside 0..620 × 970..1080)
        const title = String(info.title || '');
        const artist = String(info.artist || '');
        if (title || artist) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(z.bottomLeft.x, z.bottomLeft.y, z.bottomLeft.w, z.bottomLeft.h);
          ctx.clip();
          const px = 40, py = H - 88, ph = 60, skew = 16;
          const tFont = (sz) => textFont(sz, title, MV.FONTS.latinCond, MV.FONTS.jpHeavy);
          const ts = fitFont(ctx, title, 30, 300, tFont);
          const tw = title ? ctx.measureText(title).width : 0;
          ctx.font = textFont(24, artist, MV.FONTS.latinCond, MV.FONTS.jpHeavy);
          const aw = artist ? ctx.measureText(artist.toUpperCase()).width : 0;
          const pw = Math.min(540, 74 + tw + (artist ? aw + 44 : 0) + 30);
          ctx.fillStyle = C.red;
          MV.draw.skewRect(ctx, px + 6, py + 6, pw, ph, skew);
          ctx.fill();
          ctx.fillStyle = C.black;
          MV.draw.skewRect(ctx, px, py, pw, ph, skew);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.lineWidth = 2;
          ctx.strokeStyle = C.white;
          ctx.stroke();
          // red tab + mini emblem (pulses on the beat)
          ctx.fillStyle = C.red;
          MV.draw.skewRect(ctx, px - 14, py - 6, 58, ph + 12, skew);
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = C.black;
          ctx.stroke();
          ctx.fillStyle = C.white;
          const sr = 15 * (1 + 0.18 * beat.pulse);
          MV.draw.star(ctx, px + 23, py + ph / 2, sr, sr * 0.45);
          ctx.fill();
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          ctx.font = tFont(ts);
          ctx.fillStyle = C.white;
          ctx.fillText(title, px + 62, py + ph / 2 + vCenter(ctx, title));
          if (artist) {
            const a2 = isLatinStr(artist) ? artist.toUpperCase() : artist;
            ctx.font = textFont(24, a2, MV.FONTS.latinCond, MV.FONTS.jpHeavy);
            ctx.fillStyle = C.red;
            ctx.fillRect(px + 62 + tw + 16, py + 16, 3, ph - 32);
            ctx.fillStyle = C.white;
            ctx.fillText(a2, px + 62 + tw + 30, py + ph / 2 + vCenter(ctx, a2));
          }
          ctx.restore();
        }
        // ---- top-right time code + beat dots (inside 1560..1920 × 0..90)
        ctx.save();
        ctx.beginPath();
        ctx.rect(z.topRight.x, z.topRight.y, z.topRight.w, z.topRight.h);
        ctx.clip();
        const bx = W - 332, by = 18, bw = 290, bh = 50, sk = 14;
        ctx.fillStyle = C.red;
        MV.draw.skewRect(ctx, bx + 5, by + 5, bw, bh, sk);
        ctx.fill();
        ctx.fillStyle = C.black;
        MV.draw.skewRect(ctx, bx, by, bw, bh, sk);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.strokeStyle = C.white;
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.save();
        ctx.translate(bx + 22, by + 40);
        ctx.transform(1, 0, -0.2, 1, 0, 0);
        ctx.font = MV.text.font(38, MV.FONTS.latinCond, 400);
        ctx.fillStyle = C.white;
        const tc = fmtClock(env.t);
        ctx.fillText(tc, 0, 0);
        const tcw = ctx.measureText(tc).width;
        if (info.duration > 0) {
          ctx.font = MV.text.font(20, MV.FONTS.latinCond, 400);
          ctx.fillStyle = C.red;
          ctx.fillText('/ ' + fmtClock(info.duration), tcw + 8, 0);
        }
        ctx.restore();
        // 4 beat dots — current beat lit red with a pop
        const bib = MV.mod(beat.beatInBar || 0, 4);
        for (let i = 0; i < 4; i++) {
          const dx = bx + 196 + i * 22, dy = by + bh / 2;
          const lit = i === bib;
          const r = lit ? 7 + 3 * beat.pulse : 5;
          ctx.beginPath();
          ctx.arc(dx, dy, r, 0, TAU);
          if (lit) {
            ctx.fillStyle = C.red;
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = C.white;
            ctx.stroke();
          } else {
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.stroke();
          }
        }
        if (info.sectionName) {
          ctx.save();
          ctx.translate(bx + bw - 6, by + bh + 17);
          ctx.transform(1, 0, -0.2, 1, 0, 0);
          ctx.font = MV.text.font(17, MV.FONTS.latinCond, 400);
          ctx.textAlign = 'right';
          ctx.lineWidth = 4;
          ctx.strokeStyle = C.black;
          const sn = String(info.sectionName).toUpperCase();
          ctx.strokeText(sn, 0, 0);
          ctx.fillStyle = C.white;
          ctx.fillText(sn, 0, 0);
          ctx.restore();
        }
        ctx.restore();
      } finally {
        ctx.restore();
      }
    },
  };

  /* Shared helpers (read-only use by other modules is fine). */
  MV.FX = Object.assign(MV.FX || {}, { emblem, ransom, meta, dotField, toneField, tonePattern });
})();

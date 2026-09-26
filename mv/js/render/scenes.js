/*
 * MV scenes — the ten full-frame background scenes (docs/ARCHITECTURE.md §3.4).
 *
 *   night-city · train · crowd · tunnel · stripes · sunburst · sky-red · shards · starfield · void
 *
 * Contract per scene:
 *   prepare(stage)       pre-renders static sprites once (skylines, windows, crowd
 *                        figures, halftone textures…). Also run lazily on first draw.
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
  function sprite(w, h, paint) {
    const s = MV.makeCanvas(w, h);
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
  function fillAll(ctx, color) {
    ctx.fillStyle = color;
    ctx.fillRect(-OVF, -OVF, W + OVF * 2, H + OVF * 2);
  }
  function roundRectPath(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
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
        if (!scene.cache) scene.cache = spec.build ? spec.build(stage || null) : {};
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
          c.fillStyle = o.board;
          c.fillRect(bx + 4, by + 4, bw2 - 8, bh - 8);
          c.fillStyle = o.color;
          D.star(c, bx + 4 + bh * 0.5, by + bh / 2, bh * 0.32, bh * 0.14);
          c.fill();
          const bl = Math.max(8, bw2 - bh * 1.2);
          c.fillRect(Math.round(bx + bh), Math.round(by + bh * 0.3), Math.round(bl * 0.85), Math.max(2, Math.round(bh * 0.14)));
          c.fillRect(Math.round(bx + bh), Math.round(by + bh * 0.56), Math.round(bl * 0.55), Math.max(2, Math.round(bh * 0.14)));
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
    const out = { beacons: [], flicker: [] };
    const canvas = sprite(o.w, o.h, (c) => {
      for (const b of list) {
        for (const sh of [-o.w, 0, o.w]) {
          const bx = b.x + sh;
          if (bx > o.w + 120 || bx + b.w < -120) continue;
          paintBuilding(c, b, bx, o, sh === 0 ? out : null);
        }
      }
    });
    out.flicker.forEach((f) => (f.x = mod(f.x, o.w)));
    out.beacons.forEach((f) => (f.x = mod(f.x, o.w)));
    return { canvas, beacons: out.beacons, flicker: out.flicker, w: o.w };
  }
  function drawFlicker(ctx, L, off, y0, t, seed, B, I) {
    const list = L.flicker, sw = L.w;
    const x0 = stripX0(off, sw);
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const x = mod(f.x + x0 + OV, sw) - OV;
      if (x > W + OV) continue;
      const on = rand(seed, i, Math.floor(t * f.rate + f.ph)) < 0.42 || (B.pulse > 0.35 && rand(seed, i, B.index) < 0.1 + 0.2 * I);
      if (!on) continue;
      ctx.fillStyle = f.c;
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
  function halftoneSprite(w, h, o) {
    return sprite(w, h, (c) => D.halftone(c, 0, 0, w, h, o));
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
    tile = sprite(P, h, (c) => {
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
  function buildNightCity() {
    const pals = {
      red: {
        sky: C.red, skyDots: C.black, far: C.redDeep, mid: C.blood, near: C.black,
        winFar: [[C.redHot, 3], [C.white, 1]], winMid: [[C.white, 3], [C.star, 2], [C.yellow, 1]],
        winNear: [[C.white, 3], [C.red, 2], [C.yellow, 1]],
        moonDisc: C.white, moonDots: C.black, moonRing: C.black, moonShadow: C.black, orbit: C.black,
        rays: C.redHot, board: C.white, beacon: C.white,
      },
      navy: {
        sky: C.navy, skyDots: C.night, far: mix(C.navy, C.night, 0.55), mid: C.night, near: C.black,
        winFar: [[C.star, 2], [C.cyan, 1]], winMid: [[C.star, 3], [C.yellow, 1], [C.red, 1]],
        winNear: [[C.star, 2], [C.red, 2], [C.yellow, 1]],
        moonDisc: C.star, moonDots: C.navy, moonRing: null, moonShadow: C.red, orbit: C.red,
        rays: mix(C.navy, C.star, 0.07), board: C.red, beacon: C.red,
      },
    };
    const K = {};
    for (const key of ['red', 'navy']) {
      const P = pals[key];
      const L = { P };
      L.skyKey = 'nc-sky-' + key;
      rampTile(L.skyKey);
      L.moon = makeMoon(250, P);
      L.far = makeSkyline({ seed: 4101, w: NC.SW, h: NC.farH, top: [120, 400], bw: [50, 170], gap: [-6, 10], tower: 0.1, lit: [0.03, 0.16], types: [0, 1, 1, 2, 3, 4, 5, 6], color: P.far, win: { w: 5, h: 7, gx: 6, gy: 8, m: 9, colors: P.winFar, flicker: 0 }, board: null });
      L.mid = makeSkyline({ seed: 4102, w: NC.SW, h: NC.midH, top: [110, 330], bw: [70, 210], gap: [-4, 14], tower: 0.06, lit: [0.05, 0.28], types: [0, 1, 2, 3, 5, 6, 0], color: P.mid, win: { w: 8, h: 10, gx: 8, gy: 10, m: 10, colors: P.winMid, flicker: 0.02 }, board: P.board });
      L.near = makeSkyline({ seed: 4103, w: NC.SW, h: NC.nearH, top: [90, 290], bw: [110, 280], gap: [-2, 30], tower: 0, lit: [0.04, 0.22], types: [0, 2, 3, 5, 0, 2], color: P.near, win: { w: 14, h: 16, gx: 12, gy: 16, m: 16, colors: P.winNear, flicker: 0.03 }, board: P.board });
      K[key] = L;
    }
    return K;
  }
  function makeMoon(r, P) {
    const pad = 40, S = 2 * r + 2 * pad;
    return sprite(S, S, (c) => {
      const cx = S / 2 - 6, cy = S / 2 - 6;
      c.fillStyle = P.moonShadow;
      circle(c, cx + 16, cy + 16, r);
      c.fill();
      c.fillStyle = P.moonDisc;
      circle(c, cx, cy, r);
      c.fill();
      c.save();
      circle(c, cx, cy, r);
      c.clip();
      D.halftone(c, cx - r, cy - r, 2 * r, 2 * r, {
        cell: 15, angle: 35 * DEG, color: P.moonDots,
        fn: (u, v) => clamp((Math.hypot(u - 0.82, v - 0.2) - 0.52) * 2.1),
      });
      // flat craters
      c.fillStyle = rgba(P.moonDots, 0.16);
      const cr = [[0.35, 0.4, 0.13], [0.55, 0.62, 0.08], [0.62, 0.3, 0.06], [0.3, 0.7, 0.07], [0.72, 0.5, 0.05]];
      for (const k of cr) {
        circle(c, cx - r + k[0] * 2 * r, cy - r + k[1] * 2 * r, k[2] * 2 * r);
        c.fill();
      }
      c.restore();
      if (P.moonRing) {
        c.lineWidth = 10;
        c.strokeStyle = P.moonRing;
        circle(c, cx, cy, r - 5);
        c.stroke();
      }
    });
  }
  function drawNightCity(ctx, env, p, K) {
    const B = beatOf(env), I = p.intensity, v = p.variant, q = env.quality || 1;
    const redSky = I >= 0.5 ? v % 3 !== 2 : v % 3 === 2;
    const L = redSky ? K.red : K.navy, P = L.P;
    const tau = p.lt * p.speed + rand(p.seed, 1) * 400;
    const pan = tau * (16 + 34 * I);
    fillAll(ctx, P.sky);
    fillRamp(ctx, L.skyKey, -OV);
    if (!redSky) {
      drawDust(ctx, dustList(71, 260, -OV, W + OV, -OV, 560, 1, 2.6), C.star);
      ctx.fillStyle = C.star;
      ctx.beginPath();
      for (const d of dustList(72, 16, 0, W, 20, 480, 5, 12)) D.sparkle(ctx, d[0], d[1], d[2], 0.2, 0);
      ctx.fill();
    }
    const mx = Math.round(1100 + rand(p.seed, 2) * 460), my = Math.round(230 + rand(p.seed, 3) * 110);
    if (I > 0.4) {
      ctx.globalAlpha = clamp((I - 0.4) * 2.5) * (redSky ? 1 : 0.6);
      D.rays(ctx, mx, my, 36, 2600, tau * 0.03 + B.barPulse * 0.03, P.rays);
      ctx.globalAlpha = 1;
    }
    // orbit arcs around the moon (rotating slowly, kick on the downbeat)
    ctx.strokeStyle = P.orbit;
    const orb = tau * 0.12 + 0.25 * E.outBack(clamp(B.sinceDownbeat / 0.3));
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(mx, my, 318 + 10 * B.barPulse, orb, orb + 4.1);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(mx, my, 350 + 16 * B.barPulse, -orb * 1.3 + 1, -orb * 1.3 + 3.6);
    ctx.stroke();
    ctx.drawImage(L.moon, mx - (L.moon.width >> 1), my - (L.moon.height >> 1));
    if (B.barPulse > 0.02) {
      ctx.globalAlpha = B.barPulse * 0.7;
      ctx.strokeStyle = redSky ? C.white : C.star;
      ctx.lineWidth = 6;
      circle(ctx, mx, my, 262 + (1 - B.barPulse) * 150);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // parallax skyline layers; each is backed by a solid fill below its strip
    drawStrip(ctx, L.far.canvas, pan * 0.18, NC.farY);
    ctx.fillStyle = P.far;
    ctx.fillRect(-OVF, NC.farY + NC.farH - 1, W + OVF * 2, OVF);
    drawBeacons(ctx, L.far, pan * 0.18, NC.farY, env.t, P.beacon);
    drawFlocks(ctx, tau, p.seed, I, C.black, [110, 460], [16, 30], q);
    drawStrip(ctx, L.mid.canvas, pan * 0.4, NC.midY);
    ctx.fillStyle = P.mid;
    ctx.fillRect(-OVF, NC.midY + NC.midH - 1, W + OVF * 2, OVF);
    drawBeacons(ctx, L.mid, pan * 0.4, NC.midY, env.t + 0.4, P.beacon);
    drawFlicker(ctx, L.mid, pan * 0.4, NC.midY, env.t, p.seed, B, I);
    drawStrip(ctx, L.near.canvas, pan * 0.75, NC.nearY);
    drawFlicker(ctx, L.near, pan * 0.75, NC.nearY, env.t, p.seed + 1, B, I);
    ctx.fillStyle = P.near;
    ctx.fillRect(-OVF, NC.nearY + NC.nearH - 1, W + OVF * 2, OVF);
    drawPoles(ctx, pan * 1.3, p.seed, { spacing: 1250, top: 70, color: C.black, birds: true, scale: 1 }, B);
  }

  /* ================================================================== */
  /* 2. TRAIN                                                            */
  /* ================================================================== */
  const TR = { U: 1000, units: 2, wx0: 140, wx1: 860, wy0: 282, wy1: 640, rodY: 150, strap: 125 };
  function buildTrain() {
    const K = {};
    K.city = makeSkyline({ seed: 5201, w: 2880, h: 380, top: [70, 250], bw: [40, 150], gap: [-4, 12], tower: 0.1, lit: [0.12, 0.35], types: [0, 1, 2, 4, 5, 6], color: mix(C.navy, C.night, 0.35), win: { w: 5, h: 6, gx: 5, gy: 7, m: 6, colors: [[C.star, 3], [C.yellow, 1], [C.red, 1]], flicker: 0 }, board: C.red });
    rampTile('train-sky');
    K.intRed = paintInterior({ wall: C.red, trim: C.black, ceil: C.black, lamp: C.paper, seat: C.black, seatHi: C.redDeep, rim: null, strapBelt: C.black, seed: 11 });
    K.intBlack = paintInterior({ wall: C.black, trim: C.red, ceil: C.gray, lamp: C.star, seat: C.redDeep, seatHi: C.red, rim: C.red, strapBelt: C.gray, seed: 12 });
    return K;
  }
  function trainAd(c, x, y, w, h, kind, o) {
    c.fillStyle = C.paper;
    c.fillRect(x, y, w, h);
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    if (kind === 0) {
      c.fillStyle = C.red;
      circle(c, x + w * 0.3, y + h * 0.55, h * 0.42);
      c.fill();
      c.fillStyle = C.black;
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
    c.lineWidth = 6;
    c.strokeStyle = o.trim;
    c.strokeRect(x, y, w, h);
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
  function paintInterior(o) {
    const U = TR.U, SW = U * TR.units;
    return sprite(SW, H, (c) => {
      c.fillStyle = o.wall;
      c.fillRect(0, 0, SW, H);
      // cut the windows
      c.globalCompositeOperation = 'destination-out';
      for (let u = 0; u < TR.units; u++) {
        roundRectPath(c, u * U + TR.wx0, TR.wy0, TR.wx1 - TR.wx0, TR.wy1 - TR.wy0, 34);
        c.fill();
      }
      c.globalCompositeOperation = 'source-over';
      for (let u = 0; u < TR.units; u++) {
        const x0 = u * U;
        c.lineWidth = 20;
        c.strokeStyle = o.trim;
        roundRectPath(c, x0 + TR.wx0, TR.wy0, TR.wx1 - TR.wx0, TR.wy1 - TR.wy0, 34);
        c.stroke();
        c.lineWidth = 5;
        c.strokeStyle = C.gray;
        roundRectPath(c, x0 + TR.wx0 + 12, TR.wy0 + 12, TR.wx1 - TR.wx0 - 24, TR.wy1 - TR.wy0 - 24, 24);
        c.stroke();
        c.fillStyle = o.trim;
        c.fillRect(x0 + TR.wx0, TR.wy0 + 84, TR.wx1 - TR.wx0, 10);
        // sill
        c.fillRect(x0 + TR.wx0 - 20, TR.wy1 + 6, TR.wx1 - TR.wx0 + 40, 12);
      }
      // ceiling + lamps
      c.fillStyle = o.ceil;
      c.fillRect(0, 0, SW, 118);
      for (let u = 0; u < TR.units; u++) {
        c.fillStyle = o.lamp;
        c.fillRect(u * U + 110, 36, 780, 28);
        c.fillStyle = C.black;
        for (let k = 1; k < 6; k++) c.fillRect(u * U + 110 + k * 130, 36, 4, 28);
      }
      c.fillStyle = o.trim;
      c.fillRect(0, 118, SW, 8);
      // ads
      for (let u = 0; u < TR.units; u++) {
        trainAd(c, u * U + 170, 166, 290, 76, (u * 2) % 4, o);
        trainAd(c, u * U + 540, 166, 290, 76, (u * 2 + 1) % 4, o);
      }
      // luggage rack
      c.fillStyle = o.trim;
      c.fillRect(0, 252, SW, 14);
      c.fillStyle = C.gray;
      for (let x = 0; x < SW; x += 18) c.fillRect(x, 255, 3, 8);
      // strap rod
      c.fillStyle = C.black;
      c.fillRect(0, TR.rodY - 8, SW, 16);
      c.fillStyle = C.white;
      c.fillRect(0, TR.rodY - 4, SW, 7);
      // seat
      c.fillStyle = C.black;
      c.fillRect(0, 862, SW, 100);
      c.fillStyle = C.gray;
      for (let x = 20; x < SW; x += 40) c.fillRect(x, 890, 24, 6);
      for (let x = 20; x < SW; x += 40) c.fillRect(x, 912, 24, 6);
      for (let u = 0; u < TR.units; u++) {
        const x0 = u * U;
        c.fillStyle = o.seat;
        roundRectPath(c, x0 + 60, 724, U - 120, 92, 20);
        c.fill();
        c.fillStyle = o.seatHi;
        for (let k = 0; k < 7; k++) c.fillRect(x0 + 110 + k * 118, 736, 6, 70);
        c.fillStyle = o.seat;
        roundRectPath(c, x0 + 40, 800, U - 80, 70, 22);
        c.fill();
        c.fillStyle = o.seatHi;
        c.fillRect(x0 + 60, 808, U - 120, 6);
        c.lineWidth = 6;
        c.strokeStyle = o.trim;
        roundRectPath(c, x0 + 40, 800, U - 80, 70, 22);
        c.stroke();
      }
      // floor
      c.fillStyle = C.gray;
      c.fillRect(0, 962, SW, H - 962);
      c.fillStyle = rgba(C.white, 0.12);
      c.fillRect(0, 964, SW, 5);
      // passengers
      for (let u = 0; u < TR.units; u++) {
        for (let s = 0; s < 2; s++) {
          if (rand(o.seed, u, s) > 0.72) continue;
          const px = u * U + 300 + s * 380 + srand(o.seed, u, s + 5) * 50;
          const kind = Math.floor(rand(o.seed, u, s + 9) * 3);
          if (o.rim) seatedFigure(c, px + 5, kind, o.rim);
          seatedFigure(c, px, kind, C.black);
          if (kind === 0) {
            c.fillStyle = C.white;
            c.fillRect(px - 11, 700, 22, 30);
          }
        }
      }
      // stanchion poles at the unit boundaries (drawn at 0 and SW for a seamless tile)
      for (let u = 0; u <= TR.units; u++) {
        const x = u * U;
        c.fillStyle = C.black;
        c.fillRect(x - 13, 118, 26, 846);
        c.fillStyle = C.white;
        c.fillRect(x - 7, 118, 12, 846);
      }
    });
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
    drawStrip(ctx, K.city.canvas, tau * (120 + 120 * I), 320);
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
    drawStrip(ctx, img, off, 0);
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
  // Side-view walking silhouette in unit space (feet y=0, head top ≈ −1, facing +x).
  function walker(c, type, pose) {
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const limb = (pts, w) => {
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
      c.stroke();
    };
    const poly = (pts) => {
      D.polygon(c, pts);
      c.fill();
    };
    const dot = (x, y, r) => {
      circle(c, x, y, r);
      c.fill();
    };
    const coat = type === 0 || type === 5;
    let hf, hb;
    if (pose === 0) {
      limb([[0.01, -0.48], [0.08, -0.25], [0.15, -0.04]], 0.088);
      limb([[-0.01, -0.48], [-0.06, -0.26], [-0.14, -0.07]], 0.088);
      poly([[0.11, -0.07], [0.23, -0.035], [0.23, 0], [0.1, 0]]);
      poly([[-0.19, -0.1], [-0.1, -0.055], [-0.115, -0.015], [-0.2, -0.055]]);
      hf = [0.14, -0.53];
      hb = [-0.12, -0.51];
    } else {
      limb([[0.0, -0.48], [0.01, -0.25], [0.0, -0.04]], 0.088);
      limb([[-0.01, -0.48], [0.085, -0.3], [-0.015, -0.13]], 0.088);
      poly([[-0.04, -0.07], [0.085, -0.035], [0.085, 0], [-0.05, 0]]);
      poly([[-0.05, -0.17], [0.05, -0.14], [0.04, -0.1], [-0.06, -0.12]]);
      hf = [0.035, -0.49];
      hb = [-0.02, -0.5];
    }
    if (type !== 4) limb([[-0.02, -0.79], [-0.06, -0.64], hb], 0.064);
    const torso = coat
      ? [[-0.1, -0.835], [0.07, -0.84], [0.11, -0.6], [0.14, -0.3], [-0.14, -0.3], [-0.125, -0.62]]
      : [[-0.1, -0.835], [0.07, -0.84], [0.1, -0.62], [0.085, -0.46], [-0.09, -0.46], [-0.115, -0.64]];
    D.polygon(c, torso);
    c.fill();
    c.lineWidth = 0.05;
    c.stroke();
    if (type === 1) poly([[-0.1, -0.52], [0.085, -0.52], [0.15, -0.3], [-0.16, -0.3]]);
    poly([[-0.03, -0.885], [0.035, -0.885], [0.032, -0.8], [-0.035, -0.8]]);
    dot(0.014, -0.93, 0.062);
    if (type === 4) limb([[0.0, -0.79], [0.03, -0.64], [0.07, -0.56]], 0.068);
    else if (type !== 3) limb([[0.0, -0.79], [0.05, -0.65], hf], 0.064);
    switch (type) {
      case 0: // briefcase
        poly([[hb[0] - 0.075, hb[1] + 0.02], [hb[0] + 0.075, hb[1] + 0.02], [hb[0] + 0.075, hb[1] + 0.13], [hb[0] - 0.075, hb[1] + 0.13]]);
        break;
      case 1: // long hair + shoulder bag
        poly([[-0.065, -0.965], [0.04, -0.99], [0.03, -0.9], [-0.02, -0.8], [-0.1, -0.74], [-0.09, -0.9]]);
        poly([[-0.15, -0.63], [-0.04, -0.64], [-0.035, -0.5], [-0.16, -0.5]]);
        break;
      case 2: // backpack + cap
        poly([[-0.215, -0.82], [-0.075, -0.83], [-0.075, -0.55], [-0.2, -0.555], [-0.235, -0.7]]);
        dot(0.014, -0.94, 0.068);
        poly([[0.0, -0.97], [0.14, -0.958], [0.14, -0.938], [0.0, -0.938]]);
        break;
      case 3: { // open umbrella
        limb([[0.0, -0.79], [0.07, -0.7], [0.1, -0.78]], 0.058);
        limb([[0.1, -0.76], [0.07, -1.2]], 0.018);
        c.beginPath();
        c.moveTo(-0.26, -1.1);
        c.quadraticCurveTo(0.07, -1.5, 0.4, -1.1);
        for (let k = 0; k < 6; k++) {
          const xa = 0.4 - (k + 1) * (0.66 / 6);
          c.quadraticCurveTo(xa + 0.055, -1.14, xa, -1.1);
        }
        c.closePath();
        c.fill();
        break;
      }
      case 4: // hoodie
        dot(-0.028, -0.92, 0.076);
        break;
      case 5: // hat
        poly([[-0.09, -0.972], [0.125, -0.972], [0.125, -0.952], [-0.09, -0.952]]);
        poly([[-0.05, -1.05], [0.07, -1.05], [0.075, -0.968], [-0.055, -0.968]]);
        break;
      default:
    }
  }
  // Original generic student (front view, faceless): messy hair, school
  // jacket with standing collar, shoulder bag, scarf fluttering in the wind.
  const STUDENT_PARTS = [
    ['c', 0, -0.905, 0.078],
    ['p', [[-0.08, -0.872], [-0.092, -0.922], [-0.08, -0.93], [-0.084, -0.965], [-0.05, -0.968], [-0.038, -0.994], [-0.006, -0.982], [0.018, -1.0], [0.042, -0.978], [0.076, -0.978], [0.076, -0.948], [0.093, -0.93], [0.08, -0.9], [0.086, -0.87], [0.066, -0.883], [0.058, -0.93], [0, -0.946], [-0.058, -0.93], [-0.066, -0.883]]],
    ['p', [[-0.036, -0.85], [0.036, -0.85], [0.038, -0.79], [-0.038, -0.79]]],
    ['p', [[-0.152, -0.805], [0.152, -0.805], [0.182, -0.765], [0.165, -0.6], [0.158, -0.435], [-0.158, -0.435], [-0.165, -0.6], [-0.182, -0.765]]],
    ['p', [[-0.18, -0.782], [-0.132, -0.765], [-0.152, -0.47], [-0.2, -0.448], [-0.212, -0.62]]],
    ['p', [[0.18, -0.782], [0.132, -0.765], [0.152, -0.47], [0.2, -0.448], [0.212, -0.62]]],
    ['p', [[-0.112, -0.445], [-0.008, -0.445], [-0.02, -0.03], [-0.092, -0.03]]],
    ['p', [[0.112, -0.445], [0.008, -0.445], [0.02, -0.03], [0.092, -0.03]]],
    ['p', [[-0.1, -0.042], [-0.014, -0.042], [-0.01, 0], [-0.118, 0]]],
    ['p', [[0.1, -0.042], [0.014, -0.042], [0.01, 0], [0.118, 0]]],
    ['p', [[0.168, -0.565], [0.292, -0.57], [0.3, -0.395], [0.16, -0.39]]],
  ];
  function partPath(ctx, pt) {
    if (pt[0] === 'c') circle(ctx, pt[1], pt[2], pt[3]);
    else D.polygon(ctx, pt[1]);
  }
  // One scarf tail: a long, thin ribbon streaming down-wind with a travelling
  // wave and a swallow-tail tip (reads as cloth, not as a limb).
  function scarfTail(ctx, tau, len, ph, y0, wind, droop) {
    const n = 12, up = [], lo = [];
    const ca = Math.cos(droop), sa = Math.sin(droop);
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const wave = (0.01 + 0.06 * s) * Math.sin(tau * 7 - s * 10 + ph) + 0.008 * Math.sin(tau * 15 + s * 16 + ph);
      const x = 0.06 + s * len * ca - wave * sa;
      const y = y0 + s * len * sa + wave * ca;
      const w = 0.04 * (1 - s * 0.3);
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
  const SCARF_WRAP = [[-0.09, -0.848], [0.09, -0.848], [0.102, -0.77], [-0.102, -0.77]];
  // Static body (outlines + fill + details) → sprite; the scarf is animated per frame.
  function studentBody(c, h, o) {
    c.save();
    c.scale(h, h);
    c.lineJoin = 'round';
    for (const ol of o.outlines) {
      c.strokeStyle = ol[0];
      c.lineWidth = (ol[1] * 2) / h;
      for (const pt of STUDENT_PARTS) {
        partPath(c, pt);
        c.stroke();
      }
    }
    c.fillStyle = o.fill;
    for (const pt of STUDENT_PARTS) {
      partPath(c, pt);
      c.fill();
    }
    c.strokeStyle = o.detail;
    c.lineWidth = 0.012;
    c.beginPath();
    c.moveTo(-0.13, -0.79);
    c.lineTo(0.215, -0.56);
    c.moveTo(0, -0.77);
    c.lineTo(0, -0.44);
    c.stroke();
    c.restore();
  }
  function makeStudentSprite(h, o) {
    const pad = 40;
    const x0 = -0.25 * h - pad, x1 = 0.33 * h + pad, y0 = -1.06 * h - pad, y1 = 0.02 * h + pad;
    const w = Math.ceil(x1 - x0), hh = Math.ceil(y1 - y0);
    const ax = Math.round(-x0), ay = Math.round(-y0);
    const cv = sprite(w, hh, (c) => {
      c.translate(ax, ay);
      studentBody(c, h, o);
    });
    return { cv, ax, ay };
  }
  // pass 'tails': streaming tails (drawn behind the body); pass 'wrap': the knot
  // around the neck (drawn over the body).
  function drawScarf(ctx, x, footY, h, tau, o, pass) {
    ctx.save();
    ctx.translate(x, footY);
    ctx.scale(h, h);
    ctx.lineJoin = 'round';
    const wind = o.wind || 1;
    if (pass === 'tails') {
      const paths = [
        () => scarfTail(ctx, tau, 0.5, 0, -0.815, wind, 0.14),
        () => scarfTail(ctx, tau + 0.4, 0.34, 2.2, -0.79, wind, 0.38),
      ];
      ctx.strokeStyle = C.white;
      ctx.lineWidth = 10 / h;
      for (const f of paths) {
        f();
        ctx.stroke();
      }
      ctx.fillStyle = o.scarf;
      for (const f of paths) {
        f();
        ctx.fill();
      }
    } else {
      ctx.fillStyle = o.scarf;
      D.polygon(ctx, SCARF_WRAP);
      ctx.fill();
      ctx.strokeStyle = o.fill;
      ctx.lineWidth = 0.008;
      ctx.beginPath();
      ctx.moveTo(-0.07, -0.81);
      ctx.lineTo(0.07, -0.81);
      ctx.stroke();
    }
    ctx.restore();
  }
  const STUDENT_STYLE = { fill: C.black, detail: C.red, scarf: C.red, outlines: [[C.white, 21], [C.red, 11]] };

  // Crowd rows (back → front). Rows 0–2 are pre-rendered at their exact
  // on-screen size (unscaled integer blits); row 3 (huge, few) is drawn as paths.
  const CROWD_ROWS = [
    { h: 230, foot: 772, v: 34, dir: 1, n: 12, rim: 3, tint: true },
    { h: 370, foot: 862, v: 62, dir: -1, n: 9, rim: 4 },
    { h: 540, foot: 972, v: 100, dir: 1, n: 7, rim: 6 },
    { h: 1060, foot: 1420, v: 420, dir: -1, n: 2, rim: 10, margin: 1400 },
  ];
  function crowdSprite(h, type, pose, dir, rim, body, rimCol) {
    const um = type === 3;
    const x0 = um ? -0.3 : -0.27, x1 = um ? 0.44 : 0.27, y0 = um ? -1.56 : -1.1, y1 = 0.03;
    const bx0 = dir > 0 ? x0 : -x1, bx1 = dir > 0 ? x1 : -x0;
    const pad = rim + 3;
    const w = Math.ceil((bx1 - bx0) * h + pad * 2), hh = Math.ceil((y1 - y0) * h + pad * 2);
    const ax = Math.round(-bx0 * h + pad), ay = Math.round(-y0 * h + pad);
    const cv = sprite(w, hh, (c) => {
      const passes = [[rimCol || C.red, rim, -rim * 0.6], [body || C.black, 0, 0]];
      for (const ps of passes) {
        c.save();
        c.translate(ax + ps[1], ay + ps[2]);
        c.scale(h * dir, h);
        c.fillStyle = ps[0];
        c.strokeStyle = ps[0];
        walker(c, type, pose);
        c.restore();
      }
    });
    return { cv, ax, ay };
  }
  function buildCrowd() {
    const K = { rows: [] };
    for (let r = 1; r < 3; r++) {
      const row = CROWD_ROWS[r];
      K.rows[r] = [];
      for (let type = 0; type < 6; type++) K.rows[r][type] = [0, 1].map((pose) => crowdSprite(row.h, type, pose, row.dir, row.rim));
    }
    // far row in solid depth tints (red scheme / night scheme)
    const row0 = CROWD_ROWS[0];
    K.farRed = [];
    K.farNight = [];
    for (let type = 0; type < 6; type++) {
      K.farRed[type] = [0, 1].map((pose) => crowdSprite(row0.h, type, pose, row0.dir, row0.rim, C.blood, C.redHot));
      K.farNight[type] = [0, 1].map((pose) => crowdSprite(row0.h, type, pose, row0.dir, row0.rim, C.night, C.redDeep));
    }
    K.moon = makeMoon(330, { moonDisc: C.star, moonDots: C.navy, moonRing: null, moonShadow: C.red });
    K.student = makeStudentSprite(660, STUDENT_STYLE);
    rampTile('crowd-red');
    rampTile('crowd-night');
    return K;
  }
  function drawCrowdRow(ctx, K, ri, tau, p, B, I, q, speedK, night) {
    const row = CROWD_ROWS[ri];
    const M = row.margin || 320;
    const span = W + 2 * M;
    const n = ri === 3 ? (I > 0.6 ? 2 : 1) : Math.max(1, Math.round(row.n * (0.55 + 0.6 * I) * (ri < 2 ? q : 1)));
    const set = row.tint ? (night ? K.farNight : K.farRed) : K.rows[ri];
    for (let k = 0; k < n; k++) {
      const x0 = (k / n) * span + srand(p.seed, ri * 50 + k, 1) * (span / n) * 0.35;
      const x = mod(x0 + row.dir * row.v * speedK * tau, span) - M;
      const type = Math.floor(rand(p.seed, ri * 50 + k, 2) * 6);
      const pose = (B.index + k + ri) & 1;
      const bob = pose === 1 ? -Math.round(row.h * 0.012) : 0;
      if (ri < 3) {
        const spr = set[type][pose];
        ctx.drawImage(spr.cv, Math.round(x - spr.ax), Math.round(row.foot + bob - spr.ay));
      } else {
        const hh = row.h * (0.92 + 0.16 * rand(p.seed, ri * 50 + k, 3));
        for (let pass = 0; pass < 2; pass++) {
          ctx.save();
          ctx.translate(x + (pass === 0 ? row.rim : 0), row.foot + bob - (pass === 0 ? row.rim * 0.6 : 0));
          ctx.scale(hh * row.dir, hh);
          ctx.fillStyle = ctx.strokeStyle = pass === 0 ? C.red : C.black;
          walker(ctx, type, pose);
          ctx.restore();
        }
      }
    }
  }
  function drawCrowd(ctx, env, p, K) {
    const B = beatOf(env), I = p.intensity, v = p.variant, q = env.quality || 1;
    const night = I < 0.5 ? v % 2 === 0 : v % 2 === 1;
    const tau = p.lt * p.speed + rand(p.seed, 1) * 200;
    const px = Math.round(W * 0.5 + srand(p.seed, 5) * 240);
    const discY = 470;
    fillAll(ctx, night ? C.navy : C.red);
    if (!night) {
      ctx.globalAlpha = 0.9;
      D.rays(ctx, px, discY, 30, 2400, tau * 0.05, C.redHot);
      ctx.globalAlpha = 1;
    }
    if (night) {
      fillRamp(ctx, 'crowd-night', -OV);
      drawDust(ctx, dustList(3301, 200, -OV, W + OV, -OV, 620, 1, 2.4), C.star);
    } else {
      fillRamp(ctx, 'crowd-red', -OV);
    }
    // spotlight disc (or moon) behind the lone figure
    const dr = 330;
    if (night) {
      ctx.drawImage(K.moon, px - (K.moon.width >> 1), discY - (K.moon.height >> 1));
    } else {
      ctx.fillStyle = C.white;
      circle(ctx, px, discY, dr);
      ctx.fill();
    }
    ctx.lineWidth = 12;
    ctx.strokeStyle = night ? C.red : C.black;
    circle(ctx, px, discY, dr + 30 + 16 * B.barPulse);
    ctx.stroke();
    ctx.lineWidth = 4;
    circle(ctx, px, discY, dr + 58 + 30 * B.barPulse);
    ctx.stroke();
    // ground + zebra crossing converging to a vanishing point above the figure
    ctx.fillStyle = C.black;
    D.polygon(ctx, [[-OVF, 700], [W + OVF, 716], [W + OVF, H + OVF], [-OVF, H + OVF]]);
    ctx.fill();
    ctx.fillStyle = night ? C.gray : C.white;
    ctx.beginPath();
    const vx = px, vy = 180;
    const yT = 740, yB = H + OV;
    for (let k = -9; k <= 9; k++) {
      const xb0 = px + k * 280 - 80, xb1 = xb0 + 150;
      const f = (yT - vy) / (yB - vy);
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
    const so = Object.assign({ wind: srand(p.seed, 8) < 0 ? -1 : 1 }, STUDENT_STYLE);
    drawScarf(ctx, px, 996, 660, tau, so, 'tails');
    ctx.drawImage(K.student.cv, px - K.student.ax, 996 - K.student.ay);
    drawScarf(ctx, px, 996, 660, tau, so, 'wrap');
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
    // speed lines
    const nL = Math.round((26 + 40 * I) * q);
    const sp = 2.2 + 3 * I;
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass ? (night ? C.star : C.white) : C.black;
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
    K.htBL = halftoneSprite(1300, 900, { cell: 20, angle: 25 * DEG, color: C.black, fn: (u, v) => 1.15 * clamp(1 - Math.hypot(u, 1 - v) * 1.05) });
    K.htTR = halftoneSprite(1100, 800, { cell: 18, angle: 25 * DEG, color: C.white, fn: (u, v) => 1.1 * clamp(1 - Math.hypot(1 - u, v) * 1.1) });
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
      for (let k = 0, hx = 0; hx < P.w; k++, hx += pitch) {
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
    ctx.drawImage(K.htBL, -OV + drift, H + OV - K.htBL.height);
    ctx.drawImage(K.htTR, W + OV - K.htTR.width - drift, -OV);
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
  /* 6. SUNBURST                                                         */
  /* ================================================================== */
  function buildSunburst() {
    const K = {};
    const S = 1200;
    const radial = (color) => halftoneSprite(S, S, { cell: 22, angle: 0, color, fn: (u, v) => 1.1 * clamp(1 - Math.hypot(u - 0.5, v - 0.5) * 2) });
    K.coreWhite = radial(C.white);
    K.coreBlack = radial(C.black);
    K.coreRed = radial(C.red);
    return K;
  }
  function drawSunburst(ctx, env, p, K) {
    const B = beatOf(env), I = p.intensity, v = p.variant, q = env.quality || 1;
    const scheme = v % 3;
    const bg = [C.red, C.black, C.white][scheme];
    const rayCol = [C.black, C.red, C.red][scheme];
    const ray2 = [C.redHot, C.blood, C.redDeep][scheme];
    const core = [K.coreWhite, K.coreRed, K.coreBlack][scheme];
    const tau = p.lt * p.speed + rand(p.seed, 1) * 100;
    const side = rand(p.seed, 2) < 0.5 ? -1 : 1;
    const cx = Math.round(W * (0.5 + side * (0.2 + 0.08 * rand(p.seed, 7)))), cy = Math.round(H * (0.42 + 0.16 * rand(p.seed, 3)));
    const nR = 2 * (10 + Math.floor(rand(p.seed, 4) * 6));
    const step = TAU / nR;
    const tick = I > 0.45 ? (B.index + E.outBack(clamp(B.sinceBeat / 0.18))) * step * 0.5 : 0;
    const rot = tau * (0.05 + 0.1 * I) + tick;
    fillAll(ctx, bg);
    D.rays(ctx, cx, cy, nR, 2800, rot, rayCol);
    D.rays(ctx, cx, cy, nR * 3, 2800, -rot * 0.6 + step * 0.25, ray2);
    // halftone core
    ctx.drawImage(core, cx - (core.width >> 1), cy - (core.height >> 1));
    // shock rings (one per beat)
    ctx.lineJoin = 'miter';
    for (let k = 0; k < 3; k++) {
      const age = B.sinceBeat + k * B.period;
      if (age > 1.3) continue;
      const r = 240 + age * (1500 + 900 * I);
      ctx.lineWidth = Math.max(2, 34 * (1 - age / 1.3));
      ctx.strokeStyle = (B.index - k) % 2 === 0 ? (scheme === 2 ? C.black : C.white) : scheme === 0 ? C.black : C.red;
      circle(ctx, cx, cy, r);
      ctx.stroke();
    }
    // particles streaming out
    if (I > 0.35) {
      const n = Math.round((20 + 40 * I) * q);
      ctx.fillStyle = scheme === 2 ? C.black : C.white;
      ctx.beginPath();
      for (let j = 0; j < n; j++) {
        const u0 = tau * (0.35 + 0.5 * rand(p.seed, j, 2)) + rand(p.seed, j, 1);
        const ep = Math.floor(u0), u = u0 - ep;
        const a = rand(p.seed, j, ep + 3) * TAU;
        const r = 260 + u * 1400;
        const s = 5 + 16 * u * rand(p.seed, j, 5);
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (j % 3 === 0) {
          D.star(ctx, x, y, s, s * 0.45, 5, a);
        } else {
          ctx.moveTo(x + s, y);
          ctx.arc(x, y, s * 0.5, 0, TAU);
        }
      }
      ctx.fill();
    }
    // jagged bursts + emblem
    const bp = E.outBack(clamp(B.sinceDownbeat / 0.25));
    const bs = (0.92 + 0.08 * bp) * (1 + 0.05 * B.pulse * I);
    ctx.fillStyle = scheme === 2 ? C.red : C.black;
    D.burst(ctx, cx + 14, cy + 14, 250 * bs, 420 * bs, 16, p.seed + 11, 0.3, -tau * 0.2);
    ctx.fill();
    ctx.fillStyle = scheme === 2 ? C.black : C.black;
    D.burst(ctx, cx, cy, 250 * bs, 420 * bs, 16, p.seed + 11, 0.3, -tau * 0.2);
    ctx.fill();
    ctx.fillStyle = C.white;
    D.burst(ctx, cx, cy, 190 * bs, 320 * bs, 13, p.seed + 12, 0.35, tau * 0.25);
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = C.black;
    ctx.stroke();
    drawEmblem(ctx, cx, cy, 150 * bs, srand(p.seed, 6) * 0.25 + 0.06 * Math.sin(tau * 2), { star: C.red, slash: C.white, outline: C.black, gap: C.white, shadow: C.black, lw: 12 });
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
    K.roofs = makeSkyline({ seed: 7301, w: 2880, h: 360, top: [150, 280], bw: [60, 200], gap: [-4, 6], tower: 0.05, lit: [0.02, 0.1], types: [0, 2, 3, 3, 5, 1], color: C.black, win: { w: 10, h: 12, gx: 12, gy: 14, m: 12, colors: [[C.white, 2], [C.red, 1]], flicker: 0.02 }, board: C.red });
    return K;
  }
  function drawSkyRed(ctx, env, p, K) {
    const B = beatOf(env), I = p.intensity, v = p.variant, q = env.quality || 1;
    const tau = p.lt * p.speed + rand(p.seed, 1) * 300;
    fillAll(ctx, C.red);
    fillRamp(ctx, 'skyred-top', -OV);
    fillRamp(ctx, 'skyred-hz', 640);
    // big sun disc cut by horizontal slits (variants 1/2)
    if (v % 3 !== 0) {
      const sx = Math.round(W * (0.25 + 0.5 * rand(p.seed, 3))), sy = 700;
      ctx.fillStyle = C.white;
      circle(ctx, sx, sy, 300 + 8 * B.barPulse);
      ctx.fill();
      ctx.fillStyle = C.red;
      for (let k = 0; k < 6; k++) {
        const y = sy - 40 + k * 44, th = 6 + k * 4;
        ctx.fillRect(sx - 320, y, 640, th);
      }
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
    drawStrip(ctx, K.roofs.canvas, off, 720);
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
    const cols = [[C.red, 0.42], [C.white, 0.24], [C.black, 0.34]];
    const push = (pts) => {
      let gx = 0, gy = 0;
      for (const q of pts) { gx += q[0]; gy += q[1]; }
      gx /= pts.length; gy /= pts.length;
      const loc = pts.map((q) => [(q[0] - gx) * 0.93, (q[1] - gy) * 0.93]);
      const i = shards.length;
      shards.push({
        gx, gy, d: Math.hypot(gx, gy), pts: loc,
        col: pickW(cols, r.next()),
        k1: r.next(), k2: r.next(), k3: r.next(), k4: r.next(), k5: r.next(), i,
      });
    };
    for (let a = 0; a < nA; a++) {
      const b = (a + 1) % nA;
      const a0 = angles[a], a1 = a === nA - 1 ? angles[0] + TAU : angles[b];
      const P = (ang, rr) => [Math.cos(ang) * rr, Math.sin(ang) * rr];
      for (let j = 0; j < radii.length - 1; j++) {
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
    K.htRed = halftoneSprite(1600, 1600, { cell: 24, angle: 0, color: C.redDeep, fn: (u, v) => 1.05 * clamp(1 - Math.hypot(u - 0.5, v - 0.5) * 1.9) });
    K.htBlack = halftoneSprite(1600, 1600, { cell: 24, angle: 0, color: C.black, fn: (u, v) => 1.05 * clamp(1 - Math.hypot(u - 0.5, v - 0.5) * 1.9) });
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
    const ht = scheme === 0 ? K.htRed : K.htBlack;
    ctx.drawImage(ht, Math.round(ix - ht.width / 2), Math.round(iy - ht.height / 2));
    const amt = (b) => (mod(b, 4) === 0 ? 0.05 : 0.4 + 0.6 * rand(p.seed, b, 3)) * (0.35 + 0.65 * I);
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
    });
    K.roofs = sprite(SW, 700, (c, w, h) => paintRooftops(c, w, h, 9201));
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
    ctx.drawImage(K.sky, -OV, -OV);
    ctx.fillStyle = C.night;
    ctx.fillRect(-OVF, -OVF, W + 2 * OVF, OVF - OV);
    ctx.fillRect(-OVF, -OV, OVF - OV, H + 2 * OV);
    ctx.fillRect(W + OV, -OV, OVF - OV, H + 2 * OV);
    // mid-layer stars drifting slowly (parallax), twinkling
    const drift = tau * 5;
    const nM = Math.round(170 * q);
    ctx.fillStyle = C.star;
    ctx.beginPath();
    for (let k = 0; k < nM; k++) {
      const x = mod(rand(9301, k, 1) * (W + 400) - drift, W + 400) - 200;
      const y = rand(9301, k, 2) * 760 - 60;
      const tw = 0.6 + 0.4 * Math.sin(tau * (1 + 2 * rand(9301, k, 3)) + k);
      const s = (1.6 + 2.4 * rand(9301, k, 4)) * tw;
      ctx.rect(x - s / 2, y - s / 2, s, s);
    }
    ctx.fill();
    // twinkling 4-point sparkles with a flat halo; a few red ones
    const nSp = Math.round(28 * (0.7 + 0.3 * q));
    const sp = [];
    for (let k = 0; k < nSp; k++) {
      const x = rand(p.seed + 3, k, 1) * W, y = 30 + rand(p.seed + 3, k, 2) * 640;
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
        const tail = (200 + 280 * I) * Math.min(1, age * 3) * (1 - age * 0.6);
        const nx = -Math.sin(ang), ny = Math.cos(ang);
        const wd = 4;
        // stepped (flat) tail: three segments of falling opacity
        for (let seg = 0; seg < 3; seg++) {
          const f0 = seg / 3, f1 = (seg + 1) / 3;
          const ax = hx - Math.cos(ang) * tail * f0, ay = hy - Math.sin(ang) * tail * f0;
          const bx = hx - Math.cos(ang) * tail * f1, by = hy - Math.sin(ang) * tail * f1;
          const w0 = wd * (1 - f0), w1 = wd * (1 - f1);
          ctx.fillStyle = rgba(C.star, (0.95 - seg * 0.3) * (1 - age * 0.6));
          ctx.beginPath();
          ctx.moveTo(ax + nx * w0, ay + ny * w0);
          ctx.lineTo(ax - nx * w0, ay - ny * w0);
          ctx.lineTo(bx - nx * w1, by - ny * w1);
          ctx.lineTo(bx + nx * w1, by + ny * w1);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillStyle = C.white;
        D.sparkle(ctx, hx, hy, 14 * (1 - age * 0.5), 0.18, 0);
        ctx.fill();
      }
    }
    // rooftops (very slow drift)
    ctx.drawImage(K.roofs, -OV + Math.round(10 * Math.sin(tau * 0.05)), H + OV - K.roofs.height);
    ctx.fillStyle = C.black;
    ctx.fillRect(-OVF, H + OV - 1, W + 2 * OVF, OVF);
    ctx.fillRect(-OVF, 1000, OVF - OV + 12, H + OV);
    ctx.fillRect(W + OV - 12, 1000, OVF - OV + 12, H + OV);
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
    K.blobs = [0, 1].map((i) => sprite(620, 620, (c) => paintInk(c, 310, 310, 150, 6110 + i, i ? C.redDeep : C.blood, C.blood)));
    K.scraps = [];
    for (let k = 0; k < 8; k++) K.scraps.push(scrapSprite(k, 6200 + k));
    K.dots = halftoneSprite(1100, 800, { cell: 14, angle: 20 * DEG, color: C.gray, fn: (u, v) => 0.9 * clamp(1 - Math.hypot(1 - u, 1 - v) * 1.1) });
    return K;
  }
  function drawVoid(ctx, env, p, K) {
    const B = beatOf(env), I = p.intensity, q = env.quality || 1;
    const tau = p.lt * p.speed + rand(p.seed, 1) * 300;
    fillAll(ctx, C.black);
    ctx.drawImage(K.dots, W + OV - K.dots.width, H + OV - K.dots.height);
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

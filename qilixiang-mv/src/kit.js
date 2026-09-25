// kit.js — hand-drawn rendering primitives: noise, easing, ink/pencil strokes,
// watercolor washes, paper textures. Everything is deterministic in time.
'use strict';
const W = 1920, H = 1080, TAU = Math.PI * 2;

// ---------- math ----------
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const lerp = (a, b, t) => a + (b - a) * t;
const inv = (a, b, x) => clamp((x - a) / (b - a));
const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const smoother = t => { t = clamp(t); return t * t * t * (t * (t * 6 - 15) + 10); };
const easeInOut = t => { t = clamp(t); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const easeOut = t => { t = clamp(t); return 1 - Math.pow(1 - t, 3); };
const easeIn = t => { t = clamp(t); return t * t * t; };
const easeOutBack = t => { t = clamp(t); const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const easeInOutSine = t => -(Math.cos(Math.PI * clamp(t)) - 1) / 2;
// envelope: 0 before a, ramps up over fi, holds, ramps down over fo ending at b
const env = (t, a, b, fi = .5, fo = .5) => Math.min(smooth((t - a) / fi), smooth((b - t) / fo));
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// ---------- hashing / randomness ----------
function hash(n) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
const hash2 = (i, j) => hash((Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263)) | 0);
function rng(seed) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return function () {
    a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * r()); }
const rrange = (r, a, b) => a + (b - a) * r();
function noise1(x, s = 0) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash2(i, s * 7919), hash2(i + 1, s * 7919), u) * 2 - 1;
}
function noise2(x, y, s = 0) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), o = s * 1013;
  const a = hash2(i + o, j), b = hash2(i + 1 + o, j), c = hash2(i + o, j + 1), d = hash2(i + 1 + o, j + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
function fbm2(x, y, oct = 4, s = 0) {
  let v = 0, a = .5, f = 1;
  for (let k = 0; k < oct; k++) { v += a * noise2(x * f, y * f, s + k * 17); f *= 2.03; a *= .5; }
  return v;
}

// ---------- boil (hand-drawn line jitter on twos) ----------
const K = { t: 0, boil: 0, bv: 0 };
function setTime(t) { K.t = t; K.boil = Math.floor(t * 12 + 1e-6); K.bv = K.boil % 3; }
const bseed = (s = 0) => s * 131 + K.bv * 7919;

// ---------- colors ----------
const _col = {};
function hexRGB(h) {
  if (_col[h]) return _col[h];
  let s = h.replace('#', ''); if (s.length === 3) s = s.split('').map(c => c + c).join('');
  return (_col[h] = [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]);
}
function rgba(h, a = 1) { const c = hexRGB(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
function mix(h1, h2, t) {
  const a = hexRGB(h1), b = hexRGB(h2);
  const c = a.map((v, i) => Math.round(lerp(v, b[i], clamp(t))));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

// ---------- canvases ----------
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function freeCanvas(c) { if (c) { c.width = 1; c.height = 1; } }

// ---------- geometry helpers ----------
function ellipsePts(cx, cy, rx, ry, n = 28, rot = 0, a0 = 0, a1 = TAU) {
  const out = [], cr = Math.cos(rot), sr = Math.sin(rot), full = Math.abs(a1 - a0 - TAU) < 1e-6;
  const m = full ? n : n + 1;
  for (let i = 0; i < m; i++) {
    const a = a0 + (a1 - a0) * i / n, x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    out.push([cx + x * cr - y * sr, cy + x * sr + y * cr]);
  }
  return out;
}
function bez(p0, p1, p2, p3, n = 16) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return out;
}
// chain of cubic segments: [p0, c1, c2, p1, c3, c4, p2, ...]
function bezPath(arr, n = 12) {
  let out = [];
  for (let i = 0; i + 3 < arr.length; i += 3) { const seg = bez(arr[i], arr[i + 1], arr[i + 2], arr[i + 3], n); out = out.concat(i ? seg.slice(1) : seg); }
  return out;
}
function catmull(pts, closed = false, step = 6) {
  const n = pts.length; if (n < 3) return densify(pts, step);
  const out = [];
  const get = i => closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const m = Math.max(1, Math.ceil(dist(p1, p2) / step));
    for (let k = 0; k < m; k++) {
      const t = k / m, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(d => .5 * ((2 * p1[d]) + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
    }
  }
  if (!closed) out.push(pts[n - 1].slice());
  return out;
}
function densify(pts, step = 6) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], m = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 0; k < m; k++) out.push([lerp(a[0], b[0], k / m), lerp(a[1], b[1], k / m)]);
  }
  if (pts.length) out.push(pts[pts.length - 1].slice());
  return out;
}
function xform(pts, x = 0, y = 0, s = 1, rot = 0, sy = s) {
  const c = Math.cos(rot), sn = Math.sin(rot);
  return pts.map(p => [x + (p[0] * s) * c - (p[1] * sy) * sn, y + (p[0] * s) * sn + (p[1] * sy) * c]);
}
function polyPath(ctx, pts, close = true) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
}
function smoothPath(ctx, pts, closed = true) {
  const n = pts.length; ctx.beginPath();
  if (n < 3) { polyPath(ctx, pts, closed); return; }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (closed) {
    let m = mid(pts[n - 1], pts[0]); ctx.moveTo(m[0], m[1]);
    for (let i = 0; i < n; i++) { const p = pts[i], q = mid(p, pts[(i + 1) % n]); ctx.quadraticCurveTo(p[0], p[1], q[0], q[1]); }
    ctx.closePath();
  } else {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n - 1; i++) { const q = mid(pts[i], pts[i + 1]); ctx.quadraticCurveTo(pts[i][0], pts[i][1], q[0], q[1]); }
    ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
  }
}
function bbox(pts) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; }
  return [x0, y0, x1, y1];
}

// ---------- ink: tapered, pressure-varying line with boil ----------
// pts: control points (smoothed with Catmull-Rom). opts:
//  w width, col color, amp jitter px, seed, taper [in,out] fraction, closed, still (no boil),
//  progress (0..1 draw-on), alpha, minW fraction
function ink(ctx, pts, o = {}) {
  if (!pts || pts.length < 2) return;
  const w = o.w ?? 3.2, amp = o.amp ?? 1.1, closed = !!o.closed;
  const seed = (o.seed ?? 0) * 31 + (o.still ? 0 : K.bv * 977);
  let P = (o.sharp ?? pts.sharp) ? densify(closed ? pts.concat([pts[0]]) : pts, o.step ?? 5) : catmull(pts, closed, o.step ?? 5);
  if (closed && !(o.sharp ?? pts.sharp)) P.push(P[0].slice());
  const n = P.length; if (n < 2) return;
  const L = new Float32Array(n);
  for (let i = 1; i < n; i++) L[i] = L[i - 1] + dist(P[i - 1], P[i]);
  const tot = L[n - 1] || 1;
  let end = n;
  const prog = o.progress ?? 1;
  if (prog < 1) { if (prog <= 0) return; const lim = tot * prog; end = 1; while (end < n && L[end] <= lim) end++; if (end < 2) return; }
  const ti = o.taper ? o.taper[0] : (closed ? .04 : .18), to = o.taper ? o.taper[1] : (closed ? .04 : .28);
  const minW = o.minW ?? .12;
  const left = [], right = [];
  for (let i = 0; i < end; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    const u = L[i] / tot, lu = L[i];
    const j = noise1(lu * .011 + seed * .173, seed) * amp + noise1(lu * .05 + 3.1, seed + 1) * amp * .35;
    let prof = 1;
    if (!closed || o.taper) {
      prof = Math.min(1, Math.pow(clamp(u / Math.max(ti, 1e-3)), .55), Math.pow(clamp((1 - u) / Math.max(to, 1e-3)), .55));
      prof = minW + (1 - minW) * prof;
    }
    const ww = w * prof * (.78 + .44 * (noise1(lu * .018 + seed * .31, seed + 2) * .5 + .5)) * .5;
    const cx = P[i][0] - dy * j, cy = P[i][1] + dx * j;
    left.push([cx - dy * ww, cy + dx * ww]); right.push([cx + dy * ww, cy - dx * ww]);
  }
  ctx.save();
  ctx.fillStyle = o.col ?? '#2b2521';
  if (o.alpha != null) ctx.globalAlpha *= o.alpha;
  ctx.beginPath(); ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}
// closed outline drawn as one hand stroke with a small gap/overshoot
function inkShape(ctx, pts, o = {}) {
  const r = hash((o.seed ?? 0) * 17 + 5);
  const n = pts.length, s = Math.floor(r * n);
  const over = Math.max(1, Math.round(n * (o.over ?? .06)));
  const seq = [];
  for (let i = 0; i <= n + over; i++) seq.push(pts[(s + i) % n]);
  ink(ctx, seq, Object.assign({ taper: [.03, .05], minW: .25, sharp: o.sharp ?? pts.sharp }, o, { closed: false }));
}
// pencil: several thin grainy passes
function pencil(ctx, pts, o = {}) {
  if (!pts || pts.length < 2) return;
  const passes = o.passes ?? 2, col = o.col ?? '#3d3b43', lw = o.w ?? 1.6, amp = o.amp ?? 1.2;
  const seed = (o.seed ?? 0) * 29 + (o.still ? 0 : K.bv * 613);
  const sharp = o.sharp ?? pts.sharp;
  let P = sharp ? densify(o.closed ? pts.concat([pts[0]]) : pts, o.step ?? 6) : catmull(pts, !!o.closed, o.step ?? 6);
  if (o.closed && !sharp) P.push(P[0].slice());
  const prog = o.progress ?? 1;
  if (prog < 1) P = P.slice(0, Math.max(2, Math.floor(P.length * clamp(prog))));
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = col;
  for (let k = 0; k < passes; k++) {
    ctx.globalAlpha = (o.alpha ?? .55) * (k ? .6 : 1);
    ctx.lineWidth = lw * (k ? .7 : 1);
    ctx.beginPath();
    let lu = 0;
    for (let i = 0; i < P.length; i++) {
      if (i) lu += dist(P[i - 1], P[i]);
      const jx = noise1(lu * .02 + k * 7.7, seed + k) * amp, jy = noise1(lu * .02 + k * 3.3 + 50, seed + k) * amp;
      if (i) ctx.lineTo(P[i][0] + jx, P[i][1] + jy); else ctx.moveTo(P[i][0] + jx, P[i][1] + jy);
    }
    ctx.stroke();
  }
  ctx.restore();
}
// pencil hatching clipped to a polygon
function hatch(ctx, poly, o = {}) {
  const [x0, y0, x1, y1] = bbox(poly);
  const ang = o.angle ?? -.9, sp = o.spacing ?? 9, r = rng((o.seed ?? 1) + (o.still ? 0 : K.bv * 11));
  ctx.save(); polyPath(ctx, poly); ctx.clip();
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2 + 10;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  ctx.strokeStyle = o.col ?? '#3d3b43'; ctx.lineCap = 'round';
  for (let s = -R; s < R; s += sp) {
    const ox = cx - dy * s, oy = cy + dx * s;
    ctx.globalAlpha = (o.alpha ?? .35) * (.6 + .6 * r());
    ctx.lineWidth = (o.w ?? 1.3) * (.7 + .6 * r());
    ctx.beginPath();
    ctx.moveTo(ox - dx * R + gauss(r) * 2, oy - dy * R + gauss(r) * 2);
    ctx.lineTo(ox + dx * R + gauss(r) * 2, oy + dy * R + gauss(r) * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- watercolor ----------
function deform(poly, depth, spread, r) {
  let P = poly;
  for (let d = 0; d < depth; d++) {
    const Q = [], n = P.length;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      Q.push(a);
      const len = dist(a, b) || 1, t = clamp(.5 + gauss(r) * .12, .2, .8);
      const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
      const off = gauss(r) * spread * Math.min(1, Math.sqrt(len / 60));
      Q.push([lerp(a[0], b[0], t) + nx * off, lerp(a[1], b[1], t) + ny * off]);
    }
    P = Q; spread *= .55;
  }
  return P;
}
// layered transparent polygons with ragged edges (Hobbs-style)
function wash(ctx, poly, col, o = {}) {
  const r = rng(o.seed ?? 1), layers = o.layers ?? 12, spread = o.spread ?? 16, alpha = o.alpha ?? .075;
  const base = deform(poly, o.depth ?? 2, spread, r);
  ctx.save();
  ctx.globalCompositeOperation = o.op ?? 'multiply';
  ctx.fillStyle = col;
  for (let k = 0; k < layers; k++) {
    ctx.globalAlpha = alpha * (.55 + .9 * r());
    polyPath(ctx, deform(base, 3, spread * .5, r)); ctx.fill();
  }
  if ((o.edge ?? .16) > 0) {
    ctx.globalAlpha = o.edge ?? .16; ctx.lineWidth = o.edgeW ?? 1.4; ctx.strokeStyle = o.edgeCol ?? col;
    polyPath(ctx, deform(base, 1, spread * .15, r)); ctx.stroke();
  }
  ctx.restore();
}
// soft round blotch (used for skies, blooms, light)
function blot(ctx, x, y, rad, col, a = .1, op = 'source-over') {
  const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
  g.addColorStop(0, rgba(col, a)); g.addColorStop(.6, rgba(col, a * .55)); g.addColorStop(1, rgba(col, 0));
  ctx.save(); ctx.globalCompositeOperation = op; ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); ctx.restore();
}

// ---------- textures (built once) ----------
const TEX = {};
function buildTextures() {
  // paper color with mottling + fibers
  TEX.paper = makePaperCanvas(W, H, 3, [246, 240, 228]);
  // multiply grain: mostly white with soft tooth and specks
  const g = makeCanvas(W, H), gx = g.getContext('2d'), id = gx.createImageData(W, H), d = id.data;
  const r = rng(99);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const m = fbm2(x / 260, y / 260, 3, 5) * 5 + noise2(x / 3.1, y / 3.1, 8) * 5 + (r() - .5) * 9;
    let v = 247 + m; if (r() < .0015) v -= 40 * r();
    d[i] = v; d[i + 1] = v - 1; d[i + 2] = v - 4; d[i + 3] = 255;
  }
  gx.putImageData(id, 0, 0);
  fibers(gx, 900, 7, 'rgba(120,100,80,0.05)');
  TEX.grain = g;
  // wash granulation for runtime fills (alpha texture)
  const w = makeCanvas(1024, 1024), wx = w.getContext('2d'), wd = wx.createImageData(1024, 1024), dd = wd.data;
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
    const i = (y * 1024 + x) * 4;
    const v = fbm2(x / 90, y / 90, 4, 21) * .5 + .5, s = noise2(x / 6, y / 6, 3) * .5 + .5;
    dd[i] = dd[i + 1] = dd[i + 2] = 60; dd[i + 3] = clamp(v * .8 + s * .25 - .25) * 255;
  }
  wx.putImageData(wd, 0, 0);
  TEX.gran = w;
}
function makePaperCanvas(w, h, seed, base) {
  const c = makeCanvas(w, h), x = c.getContext('2d'), id = x.createImageData(w, h), d = id.data, r = rng(seed);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const i = (yy * w + xx) * 4;
    const m = fbm2(xx / 300, yy / 300, 4, seed) * 7 + noise2(xx / 2.5, yy / 2.5, seed + 3) * 3 + (r() - .5) * 5;
    d[i] = base[0] + m; d[i + 1] = base[1] + m; d[i + 2] = base[2] + m * 1.1; d[i + 3] = 255;
  }
  x.putImageData(id, 0, 0);
  fibers(x, Math.round(w * h / 2600), seed, 'rgba(140,120,95,0.06)');
  return c;
}
function fibers(ctx, n, seed, col) {
  const r = rng(seed + 77); ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = .8;
  for (let i = 0; i < n; i++) {
    const x = r() * ctx.canvas.width, y = r() * ctx.canvas.height, a = r() * TAU, l = 6 + r() * 26;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a + .6) * l * .5, y + Math.sin(a + .6) * l * .5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  ctx.restore();
}
// fill a path with flat color + granulation + darker edge (cheap runtime watercolor)
function wcFill(ctx, pts, col, o = {}) {
  const sharp = o.sharp ?? pts.sharp;
  const path = () => sharp ? polyPath(ctx, pts, true) : smoothPath(ctx, pts, true);
  ctx.save();
  path();
  ctx.fillStyle = col; ctx.globalAlpha *= (o.alpha ?? 1); ctx.fill();
  if (o.gran !== 0) {
    ctx.clip();
    const [x0, y0, x1, y1] = bbox(pts);
    ctx.globalAlpha = (o.gran ?? .22);
    ctx.globalCompositeOperation = 'multiply';
    const ox = ((o.seed ?? 0) * 137) % 600, oy = ((o.seed ?? 0) * 71) % 600;
    const bw = Math.min(1024, x1 - x0 + 2), bh = Math.min(1024, y1 - y0 + 2);
    if (bw > 0 && bh > 0) ctx.drawImage(TEX.gran, ox % (1024 - bw + 1), oy % (1024 - bh + 1), bw, bh, x0 - 1, y0 - 1, bw, bh);
  }
  ctx.restore();
  if (o.edge !== 0) {
    ctx.save(); path();
    ctx.strokeStyle = o.edgeCol ?? mix(col, '#3a2a20', .35); ctx.globalAlpha *= (o.edge ?? .35); ctx.lineWidth = o.edgeW ?? 2;
    ctx.stroke(); ctx.restore();
  }
}
// fill + ink outline in one call
function shape(ctx, pts, col, o = {}) {
  if (col) wcFill(ctx, pts, col, o);
  if (o.line !== false) inkShape(ctx, pts, { w: o.lw ?? 3, col: o.lc, seed: o.seed ?? 0, amp: o.amp ?? 1, still: o.still, alpha: o.la, sharp: o.sharp ?? pts.sharp });
}
// polygon helpers that keep their corners (no smoothing)
function SH(pts) { pts.sharp = true; return pts; }
function RECT(x, y, w, h) { return SH([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]); }

// ---------- camera ----------
function camera(ctx, x, y, zoom = 1, rot = 0) {
  ctx.translate(W / 2, H / 2); ctx.rotate(rot); ctx.scale(zoom, zoom); ctx.translate(-x, -y);
}
// cached layers keyed by name; builders are run lazily
const CACHE = new Map();
function cached(key, w, h, build) {
  let c = CACHE.get(key);
  if (!c) { c = makeCanvas(w, h); build(c.getContext('2d'), c); CACHE.set(key, c); }
  return c;
}
function dropCache(prefix) {
  for (const k of [...CACHE.keys()]) if (k.startsWith(prefix)) { freeCanvas(CACHE.get(k)); CACHE.delete(k); }
}

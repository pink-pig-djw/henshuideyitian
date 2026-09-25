// paint.js — reusable hand-painted props & environments (all original artwork in code).
'use strict';
const PAL = {
  paper: '#f4eee2', ink: '#2b2521', graphite: '#3d3b43',
  sky: '#8ec5e6', skyDeep: '#5d9bd0', skyLow: '#d4e9ef', cloudShade: '#b8b2cf',
  leaf: '#78ab62', leafDark: '#3f7545', leafLight: '#a9cc6b',
  bloom: '#fffdf4', bloomEye: '#f0cf6a',
  roof: '#c26a4c', roofDark: '#8f4a38', wall: '#efe2c6', wallShade: '#d8c7a4', concrete: '#b9b6ad',
  wood: '#b98a5e', woodDark: '#7d5238',
  hair: '#2a2530', skin: '#f7dcc8', blush: '#f09a8e', blouse: '#fbf8f1', skirt: '#7eb0d8',
  boyShirt: '#f5f2ea', boyPants: '#3f4b66', boyHair: '#2b2622',
  straw: '#e0463f', tomato: '#e2553a', night: '#1d2a47', night2: '#2c3f68', lamp: '#ffc56b',
  rice: '#e8b64c', riceDeep: '#c98f2b', dusk1: '#f7a25c', dusk2: '#ef6b5e', dusk3: '#7b5aa6',
};

// ---------- small doodles (also used by lyrics) ----------
function drawSparrowDoodle(ctx, x, y, s, t, col) {
  ctx.save(); ctx.translate(x, y);
  const body = ellipsePts(0, 0, s * .55, s * .38, 16);
  pencil(ctx, body, { closed: true, col, w: 2.2, alpha: .9, seed: 3 });
  pencil(ctx, [[s * .35, -s * .25], [s * .62, -s * .1], [s * .38, -s * .02]], { col, w: 2.2, alpha: .9, seed: 4 });
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(s * .28, -s * .12, s * .05, 0, TAU); ctx.fill();
  pencil(ctx, [[-s * .5, -s * .05], [-s * .95, -s * .25]], { col, w: 2.2, alpha: .9, seed: 5 });
  pencil(ctx, [[-s * .05, s * .36], [-s * .08, s * .6]], { col, w: 1.8, alpha: .9, seed: 6 });
  pencil(ctx, [[s * .12, s * .36], [s * .12, s * .6]], { col, w: 1.8, alpha: .9, seed: 7 });
  ctx.restore();
}
function drawStrawberry(ctx, x, y, s, t = 0, o = {}) {
  if (s <= 0) return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(o.rot ?? Math.sin(t * 2) * .08);
  const body = [];
  for (let i = 0; i < 26; i++) {
    const a = i / 26 * TAU, c = Math.cos(a), sn = Math.sin(a);
    const w = s * (0.92 - 0.42 * Math.max(0, sn)) * (1 + .06 * Math.cos(3 * a));
    body.push([c * w, sn * s * 1.08 + s * .12]);
  }
  wcFill(ctx, body, o.col ?? PAL.straw, { seed: 11, gran: .3, edge: .5 });
  // highlight
  ctx.globalAlpha = .35; ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(-s * .35, -s * .05, s * .12, s * .26, .4, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  // seeds
  const r = rng(5);
  ctx.fillStyle = '#f6e27a';
  for (let i = 0; i < 16; i++) {
    const a = r() * TAU, rr = Math.sqrt(r()) * .75;
    const sx = Math.cos(a) * rr * s * .75, sy = Math.sin(a) * rr * s * .85 + s * .15;
    ctx.beginPath(); ctx.ellipse(sx, sy, s * .035, s * .06, a, 0, TAU); ctx.fill();
  }
  // leaves
  const lv = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i - 2) * .55;
    lv.push([Math.cos(a - .25) * s * .15, -s * .72 + Math.sin(a - .25) * s * .1], [Math.cos(a) * s * .55, -s * .72 + Math.sin(a) * s * .28 + s * .18]);
  }
  wcFill(ctx, SH(lv), PAL.leaf, { seed: 3, gran: .2, edge: .5 });
  if (o.line !== false) inkShape(ctx, body, { w: 2.6, seed: 8, amp: .8 });
  ink(ctx, [[0, -s * .8], [s * .06, -s * 1.05], [s * .14, -s * 1.18]], { w: 3, col: PAL.leafDark, seed: 9 });
  ctx.restore();
}
function drawTomato(ctx, x, y, s, t = 0) {
  if (s <= 0) return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 1.7) * .06);
  const b = []; for (let i = 0; i < 28; i++) { const a = i / 28 * TAU; b.push([Math.cos(a) * s * (1 + .05 * Math.cos(5 * a)), Math.sin(a) * s * .86]); }
  wcFill(ctx, b, PAL.tomato, { seed: 21, gran: .3, edge: .5 });
  ctx.globalAlpha = .35; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(-s * .4, -s * .3, s * .18, s * .1, -.5, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  inkShape(ctx, b, { w: 2.4, seed: 22, amp: .8 });
  const st = []; for (let i = 0; i < 10; i++) { const a = i / 10 * TAU, r = i % 2 ? s * .12 : s * .42; st.push([Math.cos(a) * r, -s * .8 + Math.sin(a) * r * .4]); }
  wcFill(ctx, SH(st), PAL.leafDark, { seed: 23, edge: .4 });
  ctx.restore();
}
function drop(ctx, x, y, s, col) {
  ctx.save(); ctx.fillStyle = col; ctx.beginPath();
  ctx.moveTo(x, y - s * 1.8); ctx.quadraticCurveTo(x + s, y - s * .2, x + s, y + s * .2);
  ctx.arc(x, y + s * .2, s, 0, Math.PI); ctx.quadraticCurveTo(x - s, y - s * .2, x, y - s * 1.8); ctx.fill(); ctx.restore();
}
function drawLeaf(ctx, x, y, s, rot, col, o = {}) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  const flip = o.flip ?? Math.cos(rot * 1.7);
  ctx.scale(1, flip);
  const pts = [[-s, 0], [-s * .4, -s * .45], [s * .4, -s * .4], [s, 0], [s * .4, s * .38], [-s * .4, s * .42]];
  wcFill(ctx, pts, col, { seed: o.seed ?? 4, gran: .25, edge: .5, edgeW: 1.4 });
  if (o.line !== false) ink(ctx, [[-s * .9, 0], [s * .8, 0]], { w: 1.6, col: mix(col, '#3a2a20', .5), seed: o.seed ?? 4, amp: .4 });
  ctx.restore();
}
function drawButterfly(ctx, x, y, s, t, c1 = '#f2b8c6', c2 = '#e9d36f', o = {}) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(o.rot ?? (-.3 + Math.sin(t * 1.3) * .2));
  const flap = o.flap ?? Math.abs(Math.cos(t * 13));
  for (const sgn of [-1, 1]) {
    ctx.save(); ctx.scale(sgn * (.18 + .82 * flap), 1);
    const up = [[0, 0], [s * .35, -s * .65], [s * .85, -s * .72], [s * .9, -s * .3], [s * .4, 0]];
    const lo = [[0, 0], [s * .5, s * .1], [s * .65, s * .45], [s * .35, s * .6], [s * .08, s * .3]];
    wcFill(ctx, up, c1, { seed: 31, gran: .3, edge: .5 }); wcFill(ctx, lo, c2, { seed: 32, gran: .3, edge: .5 });
    if (o.line !== false) { inkShape(ctx, up, { w: 1.8, seed: 33, amp: .5 }); inkShape(ctx, lo, { w: 1.8, seed: 34, amp: .5 }); }
    ctx.fillStyle = 'rgba(60,40,50,.5)'; ctx.beginPath(); ctx.arc(s * .62, -s * .42, s * .07, 0, TAU); ctx.fill();
    ctx.restore();
  }
  ink(ctx, [[0, -s * .25], [0, s * .45]], { w: s * .12, col: '#3b2f2f', seed: 35, amp: .3 });
  ink(ctx, [[0, -s * .25], [-s * .18, -s * .6]], { w: 1.4, col: '#3b2f2f', seed: 36 });
  ink(ctx, [[0, -s * .25], [s * .18, -s * .6]], { w: 1.4, col: '#3b2f2f', seed: 37 });
  ctx.restore();
}
// 七里香 (orange jasmine) blossom: five white petals, yellow eye
function drawBlossom(ctx, x, y, s, rot = 0, o = {}) {
  if (s <= 0) return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * TAU;
    ctx.save(); ctx.rotate(a);
    ctx.beginPath(); ctx.ellipse(0, -s * .62, s * .36, s * .6, 0, 0, TAU);
    ctx.fillStyle = o.col ?? PAL.bloom; ctx.fill();
    ctx.strokeStyle = o.lc ?? 'rgba(120,110,90,.6)'; ctx.lineWidth = Math.max(1, s * .08); ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = PAL.bloomEye; ctx.beginPath(); ctx.arc(0, 0, s * .22, 0, TAU); ctx.fill();
  ctx.restore();
}

// ---------- skies & clouds (cached paintings) ----------
function paintSky(ctx, w, h, o = {}) {
  const top = o.top ?? PAL.skyDeep, mid = o.mid ?? PAL.sky, low = o.low ?? PAL.skyLow;
  ctx.drawImage(TEX.paper, 0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top); g.addColorStop(.55, mid); g.addColorStop(1, low);
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = o.alpha ?? .85; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
  // blotchy wet-in-wet variation
  const r = rng(o.seed ?? 5);
  for (let i = 0; i < (o.blots ?? 70); i++) {
    const x = r() * w, y = r() * h * .9, rad = 80 + r() * 260;
    blot(ctx, x, y, rad, r() < .5 ? top : mix(mid, '#ffffff', .4), .07 + r() * .05, r() < .6 ? 'multiply' : 'screen');
  }
}
function paintCloud(ctx, cx, cy, s, seed, o = {}) {
  const r = rng(seed);
  const puffs = [];
  const n = o.n ?? 7;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1) - .5;
    puffs.push([cx + u * s * 2.1 + gauss(r) * s * .08, cy - Math.cos(u * Math.PI) * s * .45 * (0.7 + r() * .6), s * (.32 + .3 * Math.cos(u * Math.PI)) * (0.8 + r() * .4)]);
  }
  // shade underneath
  ctx.save();
  for (const [x, y, rad] of puffs) {
    wash(ctx, deform(ellipsePts(x, y + rad * .35, rad * 1.05, rad * .75, 12), 1, 4, r), o.shade ?? PAL.cloudShade, { seed: seed + x, layers: 6, alpha: .05, spread: rad * .2, edge: .05 });
  }
  // white body (lift paint) + soft top
  for (const [x, y, rad] of puffs) {
    ctx.globalCompositeOperation = 'source-over';
    const poly = deform(ellipsePts(x, y, rad, rad * .82, 14), 2, rad * .12, r);
    ctx.globalAlpha = .82; ctx.fillStyle = o.col ?? '#fbf8f1'; smoothPath(ctx, poly, true); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // gentle bottom line
  ctx.globalCompositeOperation = 'multiply';
  const base = [[cx - s * 1.1, cy + s * .22], [cx - s * .3, cy + s * .3], [cx + s * .4, cy + s * .26], [cx + s * 1.1, cy + s * .2]];
  pencil(ctx, base, { col: '#8f8aa8', w: 1.6, alpha: .35, still: true, seed });
  ctx.restore();
}

// ---------- power lines & poles ----------
function drawPole(ctx, x, yTop, yBot, s = 1, seed = 1) {
  const w = 16 * s;
  const pts = SH([[x - w * .5, yTop], [x + w * .5, yTop], [x + w * .65, yBot], [x - w * .65, yBot]]);
  shape(ctx, pts, '#8d8479', { seed, lw: 2.6 * s, gran: .3 });
  // cross arms
  for (let k = 0; k < 2; k++) {
    const y = yTop + (28 + k * 34) * s, aw = (k ? 70 : 90) * s;
    const arm = RECT(x - aw, y - 5 * s, aw * 2, 10 * s);
    shape(ctx, arm, '#6f675e', { seed: seed + k + 3, lw: 2.2 * s });
    for (let j = -1; j <= 1; j += 2) {
      ctx.fillStyle = '#e8e2d6'; ctx.beginPath(); ctx.arc(x + j * aw * .85, y - 9 * s, 5 * s, 0, TAU); ctx.fill();
      ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }
}
// catenary wire between two points
function wirePts(x0, y0, x1, y1, sag, n = 30, sway = 0) {
  const out = [];
  for (let i = 0; i <= n; i++) { const u = i / n; out.push([lerp(x0, x1, u), lerp(y0, y1, u) + sag * 4 * u * (1 - u) + sway * Math.sin(u * Math.PI)]); }
  return out;
}
function wireY(x0, y0, x1, y1, sag, x) { const u = clamp((x - x0) / (x1 - x0)); return lerp(y0, y1, u) + sag * 4 * u * (1 - u); }

// ---------- sparrow (painted) ----------
// pose: {look -1..1, beak 0..1 open, hop px, wing 0..1 flap (flying), fly bool, scale}
function drawSparrow(ctx, x, y, s, t, o = {}) {
  ctx.save(); ctx.translate(x, y - (o.hop ?? 0)); ctx.scale(o.flip ? -s : s, s);
  const bob = o.fly ? 0 : Math.sin(t * 5 + (o.seed ?? 0)) * .8;
  const seed = o.seed ?? 1;
  if (o.fly) {
    const f = Math.sin(t * 22 + seed);
    ctx.rotate(-.1 + f * .05);
    // wings
    const wy = -f * 30;
    const wing = [[-6, -6], [-24, -18 + wy * .6], [-4, -34 + wy], [14, -8]];
    wcFill(ctx, wing, '#9b6b47', { seed, edge: .4, gran: .3 }); inkShape(ctx, wing, { w: 2, seed: seed + 1 });
  }
  const body = [[-26, 4], [-14, -12], [8, -16], [22, -10], [26, 2], [16, 14], [-6, 16]];
  wcFill(ctx, body, '#b58660', { seed, gran: .35, edge: .5 });
  // belly
  wcFill(ctx, [[-10, 6], [8, 2], [20, 6], [12, 15], [-6, 15]], '#eadcc4', { seed: seed + 2, gran: .2, edge: 0 });
  // tail
  const tail = [[-24, 0], [-46, -4 + bob], [-44, 6 + bob], [-22, 8]];
  wcFill(ctx, tail, '#7a553c', { seed: seed + 3, edge: .4 }); inkShape(ctx, tail, { w: 2, seed: seed + 4 });
  // head
  ctx.save(); ctx.translate(18, -14 + bob); ctx.rotate((o.look ?? 0) * .35);
  const head = ellipsePts(0, 0, 13, 12, 14);
  wcFill(ctx, head, '#8a5a3b', { seed: seed + 5, gran: .3, edge: .4 });
  wcFill(ctx, [[-6, 4], [6, 2], [10, 9], [-2, 12]], '#f1e7d4', { seed: seed + 6, edge: 0, gran: 0 });
  ctx.fillStyle = '#2b2320'; ctx.beginPath(); ctx.arc(6, 5, 3.4, 0, TAU); ctx.fill(); // cheek spot
  ctx.fillStyle = '#1c1715'; ctx.beginPath(); ctx.arc(4, -2, 2.6, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(4.8, -2.8, .9, 0, TAU); ctx.fill();
  const bo = (o.beak ?? 0) * 5;
  ctx.fillStyle = '#4a3a30';
  ctx.beginPath(); ctx.moveTo(11, -3); ctx.lineTo(20, -1 - bo * .3); ctx.lineTo(11, 1); ctx.fill();
  ctx.beginPath(); ctx.moveTo(11, 1); ctx.lineTo(18, 2 + bo); ctx.lineTo(11, 3); ctx.fill();
  inkShape(ctx, head, { w: 2, seed: seed + 7 });
  ctx.restore();
  // wing on body
  const wg = [[-16, -6], [4, -12], [14, -4], [-4, 6]];
  wcFill(ctx, wg, '#7d5237', { seed: seed + 8, edge: .5, gran: .35 });
  for (let k = 0; k < 3; k++) ink(ctx, [[-12 + k * 6, 0 - k], [-2 + k * 6, -6 - k]], { w: 1.4, col: '#3a2a20', seed: seed + 9 + k });
  inkShape(ctx, body, { w: 2.2, seed: seed + 12 });
  if (!o.fly) { // legs
    ink(ctx, [[-2, 14], [-4, 24]], { w: 1.8, seed: seed + 13 }); ink(ctx, [[6, 14], [6, 24]], { w: 1.8, seed: seed + 14 });
  }
  ctx.restore();
}

// ---------- foliage ----------
// clump of glossy small leaves; returns nothing, paints into ctx (use in caches)
function paintLeafClump(ctx, cx, cy, rx, ry, seed, o = {}) {
  const r = rng(seed);
  wash(ctx, deform(ellipsePts(cx, cy, rx, ry, 16), 2, rx * .1, r), o.base ?? PAL.leafDark, { seed, layers: 9, alpha: .09, spread: rx * .08 });
  const n = o.n ?? Math.round(rx * ry / 260);
  for (let i = 0; i < n; i++) {
    const a = r() * TAU, rr = Math.sqrt(r());
    const x = cx + Math.cos(a) * rx * rr, y = cy + Math.sin(a) * ry * rr;
    const col = mix(o.dark ?? PAL.leafDark, o.light ?? PAL.leafLight, clamp(.25 + (cy - y) / ry * .45 + r() * .35));
    drawLeaf(ctx, x, y, (o.leaf ?? 11) * (.7 + r() * .6), r() * TAU, col, { seed: i, line: r() < .35, flip: 1 });
  }
}
function paintBlossomsOn(ctx, cx, cy, rx, ry, seed, count, size = 7) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const a = r() * TAU, rr = Math.sqrt(r()) * .9;
    const x = cx + Math.cos(a) * rx * rr, y = cy + Math.sin(a) * ry * rr;
    const k = 2 + Math.floor(r() * 4);
    for (let j = 0; j < k; j++) drawBlossom(ctx, x + gauss(r) * size * 1.2, y + gauss(r) * size, size * (.7 + r() * .5), r() * TAU);
  }
}

// ---------- rain ----------
function drawRain(ctx, t, o = {}) {
  const n = o.n ?? 260, ang = o.ang ?? .18, sp = o.speed ?? 1500, len = o.len ?? 60, col = o.col ?? 'rgba(210,225,245,0.45)';
  const r = rng(o.seed ?? 3);
  ctx.save(); ctx.strokeStyle = col; ctx.lineCap = 'round';
  const w = o.w ?? W, h = o.h ?? H, x0 = o.x ?? 0, y0 = o.y ?? 0;
  for (let i = 0; i < n; i++) {
    const px = r() * (w + 300) - 150, ph = r(), v = sp * (.75 + r() * .5), l = len * (.6 + r() * .8);
    const tt = (Math.floor(t * 24) / 24) * v / (h + 200) + ph; // rain on ones, crisp
    const y = y0 + ((tt % 1) * (h + 200)) - 100;
    const x = x0 + px + (y - y0) * ang;
    ctx.lineWidth = (o.lw ?? 1.6) * (.6 + r() * .8);
    ctx.globalAlpha = .4 + r() * .6;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - ang * l, y - l); ctx.stroke();
  }
  ctx.restore();
}
// droplets running on glass
function drawGlassDrops(ctx, t, o = {}) {
  const r = rng(o.seed ?? 8), n = o.n ?? 60;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const x = (o.x ?? 0) + r() * (o.w ?? W), y0 = (o.y ?? 0) + r() * (o.h ?? H), s = 3 + r() * 9;
    const slide = r() < .35;
    const ph = r() * 10, spd = 40 + r() * 140;
    let y = y0;
    if (slide) { const c = ((t + ph) * spd) % ((o.h ?? H) + 100); y = (o.y ?? 0) + c - 50; }
    if (slide) { ctx.strokeStyle = 'rgba(230,240,255,.18)'; ctx.lineWidth = s * .6; ctx.beginPath(); ctx.moveTo(x, y - 80); ctx.lineTo(x + Math.sin(y * .05) * 2, y); ctx.stroke(); }
    ctx.fillStyle = o.dark ? 'rgba(20,30,50,.35)' : 'rgba(40,60,90,.18)';
    ctx.beginPath(); ctx.ellipse(x + 1, y + 1.5, s * .8, s, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = o.tint ?? 'rgba(235,242,255,.55)';
    ctx.beginPath(); ctx.ellipse(x, y, s * .75, s * .95, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(x - s * .25, y - s * .35, s * .22, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

// ---------- falling things ----------
function fallers(ctx, t, o) {
  const r = rng(o.seed ?? 12);
  for (let i = 0; i < o.n; i++) {
    const x0 = r() * (o.w ?? W), ph = r(), v = (o.v ?? 60) * (.6 + r() * .8), sw = (o.sway ?? 40) * (.5 + r());
    const h = (o.h ?? H) + 100;
    const y = (((t * v) / h + ph) % 1) * h - 50 + (o.y ?? 0);
    const x = x0 + Math.sin(t * (1 + r()) + ph * 9) * sw + (o.x ?? 0) + (o.wind ?? 0) * (y / h) * 200;
    o.draw(ctx, x, y, i, r(), t);
  }
}

// ---------- paper sheet / notebook ----------
function paperSheet(ctx, x, y, w, h, o = {}) {
  ctx.save();
  ctx.shadowColor = 'rgba(40,28,18,.28)'; ctx.shadowBlur = o.shadow ?? 24; ctx.shadowOffsetY = 8;
  ctx.fillStyle = o.col ?? '#f7f2e8'; ctx.fillRect(x, y, w, h);
  ctx.shadowColor = 'transparent';
  ctx.globalAlpha = .9; ctx.drawImage(TEX.paper, (x % 600 + 600) % 600, (y % 300 + 300) % 300, Math.min(w, W - 600), Math.min(h, H - 300), x, y, w, h);
  ctx.globalAlpha = 1;
  if (o.lines) {
    ctx.strokeStyle = 'rgba(120,160,200,.28)'; ctx.lineWidth = 1.2;
    for (let yy = y + (o.top ?? 90); yy < y + h - 30; yy += o.lines) { ctx.beginPath(); ctx.moveTo(x + 30, yy); ctx.lineTo(x + w - 30, yy); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(210,90,90,.3)'; ctx.beginPath(); ctx.moveTo(x + 90, y); ctx.lineTo(x + 90, y + h); ctx.stroke();
  }
  ctx.restore();
}
// wooden desk surface (cached)
function paintDesk(ctx, w, h, seed = 2, tone = PAL.wood) {
  ctx.fillStyle = tone; ctx.fillRect(0, 0, w, h);
  ctx.save(); ctx.globalCompositeOperation = 'multiply';
  const r = rng(seed);
  for (let i = 0; i < 90; i++) {
    const y = r() * h, a = .04 + r() * .08;
    ctx.strokeStyle = rgba(PAL.woodDark, a); ctx.lineWidth = 1 + r() * 5;
    ctx.beginPath(); ctx.moveTo(-20, y);
    for (let x = 0; x <= w + 40; x += 40) ctx.lineTo(x, y + noise1(x * .004 + i, seed) * 18 + Math.sin(x * .002 + i) * 6);
    ctx.stroke();
  }
  ctx.globalAlpha = .5; ctx.drawImage(TEX.grain, 0, 0, w, h);
  ctx.restore();
}

// ---------- cat (original tabby) ----------
// sitting side view facing right; o: sniff 0..1, paw 0..1 reach, eyes 'open'|'happy', look
function drawCat(ctx, x, y, s, t, o = {}) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s * (o.flip ? -1 : 1), s);
  const base = '#e9b777', stripe = '#b8743b', light = '#fbecd2';
  // tail
  const tw = Math.sin(t * 2.2) * 26;
  const tail = [[-60, -10], [-120, -20], [-150, -70 + tw * .4], [-130 - tw * .3, -130 + tw], [-110 - tw * .2, -128 + tw], [-128, -70], [-104, -34], [-56, -30]];
  shape(ctx, tail, base, { seed: 801, lw: 2.8, gran: .3 });
  // body
  const body = [[-80, 0], [-92, -60], [-60, -130], [10, -150], [60, -120], [74, -50], [70, 0]];
  shape(ctx, body, base, { seed: 802, lw: 3, gran: .3 });
  for (let k = 0; k < 4; k++) ink(ctx, [[-70 + k * 22, -120 + k * 4], [-58 + k * 22, -90 + k * 6], [-66 + k * 22, -60]], { w: 5, col: stripe, seed: 803 + k, alpha: .8 });
  wcFill(ctx, [[20, -100], [60, -110], [66, -40], [40, -10], [16, -40]], light, { seed: 808, edge: 0, gran: .1 });
  // front legs & paw
  const reach = easeInOut(o.paw ?? 0);
  shape(ctx, capsule([30, -40], [40 + reach * 40, -4 - reach * 26], 30, 26), base, { seed: 809, lw: 2.6 });
  shape(ctx, capsule([58, -40], [62, -4], 30, 26), base, { seed: 810, lw: 2.6 });
  shape(ctx, ellipsePts(66, -2, 20, 11, 10), light, { seed: 811, lw: 2.4 });
  shape(ctx, ellipsePts(46 + reach * 40, -4 - reach * 26, 20, 11, 10, -reach * .4), light, { seed: 812, lw: 2.4 });
  // head
  const sniff = o.sniff ?? 0;
  ctx.save(); ctx.translate(58 + sniff * 26, -160 + sniff * 30); ctx.rotate(sniff * .35 + Math.sin(t * 7) * .03 * sniff);
  const earTw = Math.max(0, Math.sin(t * 3.1)) > .96 ? .15 : 0;
  shape(ctx, SH([[-48, -30], [-38, -86], [-8, -46]]), base, { seed: 813, lw: 2.8 });
  shape(ctx, SH([[10, -48], [40, -88 - earTw * 40], [52, -26]]), base, { seed: 814, lw: 2.8 });
  wcFill(ctx, SH([[-38, -38], [-34, -70], [-16, -46]]), '#f2a7a0', { seed: 815, edge: 0 });
  const head = [[-58, 0], [-52, -40], [-10, -58], [34, -52], [60, -20], [62, 14], [36, 40], [-20, 42], [-52, 26]];
  shape(ctx, head, base, { seed: 816, lw: 3, gran: .3 });
  for (let k = 0; k < 3; k++) ink(ctx, [[-20 + k * 14, -54], [-16 + k * 14, -34]], { w: 4, col: stripe, seed: 817 + k, alpha: .8 });
  wcFill(ctx, [[10, 6], [40, 0], [56, 16], [36, 36], [10, 30]], light, { seed: 820, edge: 0, gran: .1 });
  if ((o.eyes ?? 'open') === 'happy') {
    ink(ctx, [[-4, -8], [6, -16], [16, -8]], { w: 3.4, seed: 821 }); ink(ctx, [[30, -10], [38, -17], [46, -10]], { w: 3.4, seed: 822 });
  } else {
    for (const ex of [8, 38]) {
      ctx.fillStyle = '#c7d46a'; ctx.beginPath(); ctx.ellipse(ex, -10, 8, 10, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2a2320'; ctx.beginPath(); ctx.ellipse(ex + 2 + (o.look ?? 0) * 2, -10, 3.2, 8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + 3, -14, 2, 0, TAU); ctx.fill();
      inkShape(ctx, ellipsePts(ex, -10, 8, 10, 10), { w: 2, seed: 823 + ex });
    }
  }
  ctx.fillStyle = '#e07b7b'; ctx.beginPath(); ctx.moveTo(52, 8); ctx.lineTo(60, 6); ctx.lineTo(56, 14); ctx.fill();
  ink(ctx, [[56, 14], [54, 22], [46, 24]], { w: 2, seed: 825 });
  for (let k = -1; k <= 1; k++) ink(ctx, [[58, 18 + k * 6], [96, 12 + k * 14]], { w: 1.4, seed: 826 + k, alpha: .8 });
  ctx.restore();
  ctx.restore();
}
function drawFishPlate(ctx, x, y, s, o = {}) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  shape(ctx, ellipsePts(0, 0, 120, 30, 20), '#f3f1ea', { seed: 831, lw: 2.8 });
  shape(ctx, ellipsePts(0, -2, 90, 18, 18), '#dfe9ee', { seed: 832, lw: 1.8, la: .6 });
  // grilled saury: long slim fish
  const f = [[-100, -10], [-60, -24], [40, -26], [80, -18], [96, -30], [104, -8], [96, 8], [80, -4], [40, 2], [-60, 0]];
  shape(ctx, f, '#a9b3b8', { seed: 833, lw: 2.6, gran: .35 });
  wcFill(ctx, [[-90, -12], [40, -16], [80, -12], [40, -4], [-60, -4]], '#e6e2d6', { seed: 834, edge: 0 });
  for (let k = 0; k < 5; k++) ink(ctx, [[-60 + k * 24, -22], [-50 + k * 24, -6]], { w: 3, col: '#5b4636', seed: 835 + k, alpha: .8 }); // grill marks
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(-84, -14, 3.4, 0, TAU); ctx.fill();
  if (o.steam) for (let k = 0; k < 3; k++) {
    const ph = (K.t * .6 + k / 3) % 1;
    ctx.globalAlpha = Math.sin(ph * Math.PI) * .6;
    pencil(ctx, [[-30 + k * 30, -40 - ph * 60], [-40 + k * 30, -70 - ph * 60], [-26 + k * 30, -100 - ph * 60]], { col: '#9a9a9a', w: 2.4, seed: k });
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ---------- night room props ----------
function drawLamp(ctx, x, y, s, on = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  shape(ctx, ellipsePts(0, 0, 70, 16, 16), '#3f4a5a', { seed: 901, lw: 2.6 });
  ink(ctx, [[0, -6], [-40, -150], [30, -260]], { w: 10, col: '#3f4a5a', seed: 902 });
  ctx.save(); ctx.translate(30, -260); ctx.rotate(.5);
  const shade = SH([[-50, 0], [50, 0], [80, 80], [-80, 80]]);
  shape(ctx, shade, '#4f6b5e', { seed: 903, lw: 2.8, gran: .3 });
  if (on) { ctx.fillStyle = rgba('#fff2c0', on); ctx.beginPath(); ctx.ellipse(0, 82, 76, 14, 0, 0, TAU); ctx.fill(); }
  ctx.restore();
  ctx.restore();
}
function drawMug(ctx, x, y, s, t) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  shape(ctx, SH([[-40, -90], [40, -90], [36, 0], [-36, 0]]), '#e9e3d6', { seed: 911, lw: 2.6 });
  ink(ctx, [[40, -70], [66, -60], [64, -30], [38, -24]], { w: 5, seed: 912 });
  shape(ctx, ellipsePts(0, -90, 40, 9, 14), '#7a4a30', { seed: 913, lw: 2 });
  for (let k = 0; k < 2; k++) {
    const ph = (t * .5 + k * .5) % 1; ctx.globalAlpha = Math.sin(ph * Math.PI) * .6;
    pencil(ctx, [[-10 + k * 20, -100 - ph * 40], [-20 + k * 20, -130 - ph * 50], [-6 + k * 20, -160 - ph * 60]], { col: '#e8e0d0', w: 3, seed: k });
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
function drawPaperPlane(ctx, x, y, s, rot, o = {}) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  const bank = o.bank ?? 0;
  const top = SH([[60, 0], [-50, -34 - bank * 10], [-36, 0]]), bot = SH([[60, 0], [-36, 0], [-50, 22 + bank * 10]]);
  shape(ctx, top, '#fbf8f0', { seed: 921, lw: 2.4, gran: .1 });
  shape(ctx, bot, '#e6e0d2', { seed: 922, lw: 2.4, gran: .1 });
  ink(ctx, [[60, 0], [-44, 4]], { w: 1.6, seed: 923, alpha: .6 });
  // pencil writing visible on the paper
  for (let k = 0; k < 3; k++) pencil(ctx, [[-30 + k * 4, -8 - k * 7], [10 + k * 6, -6 - k * 5]], { col: '#6a6670', w: 1.4, alpha: .5, seed: k });
  ctx.restore();
}
// ---------- bicycle (side view) ----------
function drawBike(ctx, x, y, s, t, spin) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  const R = 70, wl = [-120, -R], wr = [120, -R];
  for (const w of [wl, wr]) {
    ctx.save(); ctx.translate(w[0], w[1]);
    inkShape(ctx, ellipsePts(0, 0, R, R, 30), { w: 5, seed: 931 + w[0] });
    inkShape(ctx, ellipsePts(0, 0, R - 8, R - 8, 30), { w: 1.6, seed: 932 + w[0], alpha: .6 });
    ctx.strokeStyle = 'rgba(43,37,33,.6)'; ctx.lineWidth = 1.4;
    for (let k = 0; k < 12; k++) { const a = spin + k / 12 * TAU; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * (R - 6), Math.sin(a) * (R - 6)); ctx.stroke(); }
    ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
    ctx.restore();
  }
  const frame = '#3b6f8f', bb = [0, -R + 6], seat = [-40, -190], head = [96, -200];
  const fr = (a, b) => ink(ctx, [a, b], { w: 8, col: frame, seed: 940 + a[0] + b[1], taper: [.02, .02], minW: .9 });
  fr(wl, bb); fr(bb, seat); fr(seat, wl); fr(bb, [90, -176]); fr(seat, [90, -176]); fr(head, wr);
  // rear rack
  ink(ctx, [[-176, -150], [-30, -150]], { w: 6, col: '#555', seed: 950 });
  ink(ctx, [[-150, -150], [-120, -R]], { w: 4, col: '#555', seed: 951 });
  // saddle, handlebar
  shape(ctx, SH([[-70, -196], [-10, -200], [-16, -186], [-66, -184]]), '#4a3a30', { seed: 952, lw: 2 });
  ink(ctx, [[96, -200], [80, -236], [110, -244], [130, -236]], { w: 6, col: '#3a3a3a', seed: 953 });
  // basket
  shape(ctx, SH([[110, -196], [190, -196], [182, -136], [118, -136]]), '#c9a46a', { seed: 954, lw: 2.4, gran: .3 });
  for (let k = 1; k < 4; k++) ink(ctx, [[110 + k * 20, -196], [118 + k * 16, -136]], { w: 1.4, seed: 955 + k, alpha: .6 });
  // pedal crank
  const cx = bb[0] + Math.cos(spin * .6) * 28, cy = bb[1] + Math.sin(spin * .6) * 28;
  ink(ctx, [bb, [cx, cy]], { w: 6, col: '#333', seed: 960 });
  ctx.restore();
  return { seat: [x + seat[0] * s, y + seat[1] * s], bb: [x + bb[0] * s, y + bb[1] * s], crank: spin * .6, rack: [x - 110 * s, y - 150 * s], bar: [x + 100 * s, y - 238 * s] };
}

// ---------- umbrella (seen from behind / front) ----------
function drawUmbrella(ctx, x, y, s, tilt, col = '#6f9fcf', o = {}) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(tilt); ctx.scale(s, s);
  const R = 230, ribs = 8, canopy = [];
  for (let i = 0; i <= ribs; i++) {
    const a = Math.PI + i / ribs * Math.PI;
    canopy.push([Math.cos(a) * R, Math.sin(a) * R * .62]);
    if (i < ribs) { const am = Math.PI + (i + .5) / ribs * Math.PI; canopy.push([Math.cos(am) * R * .96, Math.sin(am) * R * .6 + 16]); }
  }
  canopy.push([R, 0]);
  const edge = [];
  for (let i = 0; i < ribs; i++) { const u = -R + 2 * R * i / ribs; edge.push([u, 0], [u + R / ribs, 12]); }
  edge.push([R, 0]);
  const poly = canopy.slice(0, -1).concat(edge.reverse());
  shape(ctx, poly, col, { seed: 981, lw: 3, gran: .35 });
  for (let i = 1; i < ribs; i++) { const a = Math.PI + i / ribs * Math.PI; ink(ctx, [[0, -R * .62], [Math.cos(a) * R, Math.sin(a) * R * .62 + 8]], { w: 1.8, seed: 982 + i, alpha: .6 }); }
  ink(ctx, [[0, -R * .62 - 20], [0, -R * .62]], { w: 5, seed: 990 });
  const sh = o.shaft ?? 200;
  ink(ctx, [[0, -R * .62], [0, sh], [16, sh + 22], [30, sh + 6]], { w: 5, seed: 991, col: '#4a3a30' });
  if (o.drips) for (let i = 0; i <= ribs; i++) { const u = -R + 2 * R * i / ribs, ph = (K.t * 1.4 + i * .37) % 1; drop(ctx, u, 18 + ph * 120, 4, 'rgba(210,225,245,.8)'); }
  ctx.restore();
}
// ---------- bus (side view, original design) ----------
function drawBus(ctx, x, y, s, t, o = {}) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  const body = SH([[-520, -40], [-520, -330], [-480, -370], [470, -370], [520, -320], [520, -40]]);
  shape(ctx, body, '#efe6cf', { seed: 1001, lw: 3.4, gran: .3 });
  wcFill(ctx, SH([[-520, -130], [520, -130], [520, -90], [-520, -90]]), '#4f8f7a', { seed: 1002, edge: 0 });
  wcFill(ctx, SH([[-520, -80], [520, -80], [520, -64], [-520, -64]]), '#c9574a', { seed: 1003, edge: 0 });
  for (let k = 0; k < 6; k++) {
    const wx = -470 + k * 150, lit = o.lit ?? 0;
    shape(ctx, RECT(wx, -330, 120, 150), lit ? '#f3d9a0' : '#6f8ea8', { seed: 1004 + k, lw: 2.6 });
    if (o.face && k === (o.faceWin ?? 3)) { ctx.save(); ctx.beginPath(); ctx.rect(wx, -330, 120, 150); ctx.clip(); o.face(ctx, wx + 60, -250); ctx.restore(); inkShape(ctx, RECT(wx, -330, 120, 150), { w: 2.6, seed: 1020 }); }
  }
  shape(ctx, RECT(430, -330, 70, 290), '#9fb6c6', { seed: 1011, lw: 2.6 }); // door
  for (const wx of [-330, 340]) {
    ctx.save(); ctx.translate(wx, -40);
    shape(ctx, ellipsePts(0, 0, 66, 66, 20), '#2f2c2c', { seed: 1012 + wx, lw: 3 });
    ctx.rotate(o.spin ?? 0); shape(ctx, ellipsePts(0, 0, 30, 30, 12), '#b9b4aa', { seed: 1014 + wx, lw: 2 });
    ink(ctx, [[-24, 0], [24, 0]], { w: 3, seed: 1016 + wx });
    ctx.restore();
  }
  ctx.fillStyle = '#ffd98a'; ctx.beginPath(); ctx.arc(505, -90, 14, 0, TAU); ctx.fill();
  ctx.fillStyle = '#e8584a'; ctx.fillRect(-528, -110, 14, 30);
  ctx.restore();
}

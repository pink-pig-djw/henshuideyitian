// scenes.js — the shot list. Story: a boy's sketchbook of one summer.
// Present day he opens the book; we fall into the drawings; the summer plays out;
// rain washes the pages; he writes the last page as an adult.
'use strict';
const SHOTS = [];
function SHOT(id, t0, t1, def) { SHOTS.push(Object.assign({ id, t0, t1 }, def)); }

// ------------------------------------------------------------------
// 0. Present day — the old sketchbook on a sunlit desk, title written.
// ------------------------------------------------------------------
function paintDeskScene(ctx, o = {}) {
  const w = 2400, h = 1400;
  paintDesk(ctx, w, h, 4, o.tone ?? '#b58a60');
  // photo corner peeking out under the book
  ctx.save(); ctx.translate(560, 1080); ctx.rotate(-.22);
  paperSheet(ctx, -170, -120, 340, 260, { col: '#fbf7ef', shadow: 14 });
  const g = ctx.createLinearGradient(0, -100, 0, 100); g.addColorStop(0, '#9fcbe6'); g.addColorStop(1, '#e9dcb8');
  ctx.fillStyle = g; ctx.fillRect(-150, -100, 300, 190);
  paintLeafClump(ctx, -40, 40, 120, 60, 91, { leaf: 8, n: 60 });
  paintBlossomsOn(ctx, -40, 30, 110, 45, 92, 9, 5);
  ctx.restore();
  // the sketchbook
  ctx.save(); ctx.translate(1200, 700); ctx.rotate(-.045);
  ctx.shadowColor = 'rgba(40,24,12,.45)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18;
  ctx.fillStyle = '#6d4a3a'; ctx.fillRect(-800, -520, 1600, 1040); // cover
  ctx.shadowColor = 'transparent';
  for (let k = 0; k < 6; k++) { ctx.fillStyle = k % 2 ? '#e9e1d0' : '#f3ecdd'; ctx.fillRect(-780 + k * .6, -505 + k * 3, 1560 - k * 1.2, 1010); }
  paperSheet(ctx, -770, -500, 760, 990, { col: '#f6f0e3', shadow: 0 });
  paperSheet(ctx, 10, -500, 760, 990, { col: '#f6f0e3', shadow: 0 });
  const sg = ctx.createLinearGradient(-80, 0, 80, 0);
  sg.addColorStop(0, 'rgba(60,40,25,0)'); sg.addColorStop(.5, 'rgba(60,40,25,.32)'); sg.addColorStop(1, 'rgba(60,40,25,0)');
  ctx.fillStyle = sg; ctx.fillRect(-80, -500, 160, 990);
  // stitched spine
  for (let y = -470; y < 480; y += 60) pencil(ctx, [[0, y], [0, y + 24]], { col: '#a08f7a', w: 2, still: true, seed: y });
  // left page: pressed 七里香 sprig under washi tape
  ctx.save(); ctx.translate(-390, 20); ctx.rotate(.18);
  ink(ctx, [[-10, 320], [0, 150], [20, -40], [30, -250]], { w: 5, col: '#6f5a3e', still: true, seed: 3 });
  const r = rng(12);
  for (let i = 0; i < 9; i++) {
    const yy = 260 - i * 60, side = i % 2 ? 1 : -1;
    const x0 = lerp(-6, 28, i / 9);
    drawLeaf(ctx, x0 + side * 50, yy - 16, 36 + r() * 10, side > 0 ? -.4 : Math.PI + .4, mix('#8f8a55', '#a0875a', r()), { seed: i, flip: 1 });
  }
  for (let i = 0; i < 7; i++) drawBlossom(ctx, 30 + gauss(r) * 30, -250 + gauss(r) * 30, 13 + r() * 4, r() * TAU, { col: '#efe6cf', lc: 'rgba(140,120,90,.5)' });
  ctx.restore();
  for (const [x, y, a] of [[-520, -120, -.5], [-260, 300, .35]]) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.globalAlpha = .55; ctx.fillStyle = '#e8a9a0'; ctx.fillRect(-90, -24, 180, 48);
    ctx.globalAlpha = .25; ctx.fillStyle = '#fff'; for (let k = -80; k < 90; k += 26) ctx.fillRect(k, -24, 10, 48);
    ctx.restore();
  }
  ctx.font = '38px LongCang'; ctx.fillStyle = 'rgba(70,60,50,.75)';
  ctx.fillText('七里香 · 那年夏天在院子里摘的', -700, 440);
  // right page faint guide lines
  ctx.strokeStyle = 'rgba(120,150,190,.18)'; ctx.lineWidth = 1.4;
  for (let y = -420; y < 460; y += 62) { ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(720, y); ctx.stroke(); }
  ctx.restore();
  // pencil + eraser on the desk
  ctx.save(); ctx.translate(2020, 1090); ctx.rotate(-1.1);
  ctx.shadowColor = 'rgba(30,20,10,.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#f2c14e'; ctx.fillRect(-12, -200, 24, 330); ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#e88d8d'; ctx.fillRect(-12, 130, 24, 30); ctx.fillStyle = '#c9c4bb'; ctx.fillRect(-12, 118, 24, 14);
  ctx.beginPath(); ctx.moveTo(-12, -200); ctx.lineTo(0, -250); ctx.lineTo(12, -200); ctx.fillStyle = '#f0d3a6'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(-4, -240); ctx.lineTo(0, -250); ctx.lineTo(4, -240); ctx.fillStyle = '#333'; ctx.fill();
  ctx.restore();
  ctx.save(); ctx.translate(1990, 300); ctx.rotate(.3);
  shape(ctx, RECT(-60, -30, 120, 60), '#f2ece0', { seed: 5, still: true });
  shape(ctx, RECT(-60, -30, 50, 60), '#6d9fcf', { seed: 6, still: true });
  ctx.restore();
}
function dappled(ctx, t, w, h, amt = .22) {
  // moving leaf-shadow light on the desk
  const c = cached('dapple', 1024, 640, (x) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, 1024, 640);
    const r = rng(33);
    for (let i = 0; i < 110; i++) blot(x, r() * 1024, r() * 640, 30 + r() * 70, '#fff3d6', .55, 'lighter');
  });
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = amt;
  const ox = noise1(t * .15, 3) * 60, oy = noise1(t * .12, 4) * 40;
  ctx.drawImage(c, -200 + ox, -120 + oy, w + 400, h + 240);
  ctx.restore();
}
function dust(ctx, t, n = 70, box = [0, 0, W, H], col = '#fff6dc') {
  const r = rng(51);
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < n; i++) {
    const x = box[0] + ((r() * box[2] + t * (8 + r() * 14) + Math.sin(t * .7 + i) * 20) % box[2]);
    const y = box[1] + ((r() * box[3] - t * (4 + r() * 8) + 4 * box[3]) % box[3]);
    const s = 1 + r() * 3.2, a = (.3 + .7 * r()) * (.5 + .5 * Math.sin(t * (1 + r()) + i));
    ctx.fillStyle = rgba(col, a * .8); ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill();
  }
  ctx.restore();
}
function writeText(ctx, str, x, y, font, size, t0, per, t, o = {}) {
  ctx.save(); ctx.font = `${size}px ${font}`; ctx.textBaseline = 'alphabetic';
  let cx = x;
  const chars = [...str];
  if (o.align === 'center') { const tw = chars.reduce((a, c) => a + ctx.measureText(c).width + (o.gap ?? 0), 0); cx = x - tw / 2; }
  chars.forEach((c, k) => {
    const cw = ctx.measureText(c).width;
    const p = clamp((t - t0 - k * per) / (o.dur ?? per * 1.4));
    if (p > 0) {
      ctx.save();
      if (p < 1) { ctx.beginPath(); ctx.rect(cx - 10, y - size * 1.1, (cw + 20) * easeOut(p), size * 1.5); ctx.clip(); }
      ctx.globalAlpha = (o.alpha ?? 1) * (0.2 + .8 * smooth(p * 1.5));
      ctx.fillStyle = o.col ?? '#2c2a30';
      ctx.fillText(c, cx, y + (o.jitter ? noise1(K.boil + k * 3, 9) * o.jitter : 0));
      if (o.double) { ctx.globalAlpha *= .35; ctx.fillText(c, cx + 1, y - .8); }
      ctx.restore();
    }
    cx += cw + (o.gap ?? 0);
  });
  ctx.restore();
}

SHOT('desk', 0, 15.3, {
  grade: { tint: '#ffb561', amt: .25, vig: .7, glow: [260, 90, 900, '#ffcf8a', .35] },
  init() { this.bg = cached('desk:bg', 2400, 1400, c => paintDeskScene(c)); },
  draw(ctx, lt, t) {
    const push = easeInOutSine(inv(0, 13.2, lt)), dive = easeIn(inv(12.6, 15.8, lt));
    const zoom = lerp(.84, 1.2, push) * (1 + dive * 1.4);
    const cx = lerp(1150, 1380, push) + dive * 60, cy = lerp(730, 640, push);
    ctx.fillStyle = '#6d4a30'; ctx.fillRect(0, 0, W, H);
    ctx.save(); camera(ctx, cx, cy, zoom, lerp(.03, 0, push));
    ctx.drawImage(this.bg, 0, 0);
    // title on the right page (in book space)
    ctx.save(); ctx.translate(1200, 700); ctx.rotate(-.045);
    writeText(ctx, META.title, 390, -60, 'MaShan', Math.min(210, 640 / Math.max(1, [...META.title].length)), 2.9, .9, lt, { align: 'center', col: '#2d2a2e', dur: 1.1, double: true });
    // little blossoms bloom under the title
    for (let k = 0; k < 7; k++) { const q = clamp((lt - 6 - k * .12) / .5); if (q > 0) drawBlossom(ctx, 180 + k * 70, 10 + Math.sin(k * 1.7) * 14, 14 * easeOutBack(q), k); }
    if (META.credits[0]) writeText(ctx, META.credits[0], 390, 140, 'LongCang', 58, 7.0, .13, lt, { align: 'center', col: '#4a4540' });
    if (META.credits[1]) writeText(ctx, META.credits[1], 390, 220, 'LongCang', 58, 7.9, .13, lt, { align: 'center', col: '#4a4540' });
    if (META.tagline) writeText(ctx, `— ${META.tagline} —`, 390, 330, 'LongCang', 40, 9.3, .07, lt, { align: 'center', col: '#8a7f73' });
    ctx.restore();
    dappled(ctx, t, 2400, 1400, .2);
    ctx.restore();
    dust(ctx, t, 80);
    // the adult's hand rests near the book at first, then slides away
    const hx = lerp(1620, 2250, easeInOut(inv(3.5, 7, lt))), hy = lerp(900, 1220, easeInOut(inv(3.5, 7, lt)));
    if (lt < 7.5) {
      ctx.save(); camera(ctx, cx, cy, zoom, lerp(.03, 0, push));
      drawPencilHand(ctx, hx - 250, hy - 60, 1.15, { watch: true, sleeveCol: '#6b7f99', ang: -.4, seed: 780 });
      ctx.restore();
    }
  },
});

// ------------------------------------------------------------------
// 1. That summer — sky, wires, rooftops; sparrows arrive on the beat.
// ------------------------------------------------------------------
const TOWN = { w: 2600, h: 1700, poleL: [430, 230], poleR: [2330, 470] };
function townWires() {
  const L = TOWN.poleL, R = TOWN.poleR, out = [];
  for (let k = 0; k < 3; k++) {
    const y0 = L[1] + 28 + (k === 2 ? 34 : 0) - 9, y1 = R[1] + (28 + (k === 2 ? 34 : 0)) * .7 - 6;
    const x0 = L[0] + (k === 0 ? -76 : k === 1 ? 76 : -60), x1 = R[0] + (k === 0 ? -55 : k === 1 ? 55 : -42);
    out.push({ x0, y0, x1, y1, sag: 120 + k * 18 });
  }
  return out;
}
function paintTown(ctx) {
  const { w, h } = TOWN;
  paintSky(ctx, w, h * .75, { seed: 8 });
  // distant hills
  wash(ctx, [[0, 1080], [300, 1010], [700, 1040], [1100, 980], [1600, 1030], [2100, 990], [2600, 1030], [2600, 1200], [0, 1200]], '#9cb8a8', { seed: 4, layers: 10, alpha: .07, spread: 14 });
  wash(ctx, [[0, 1110], [500, 1070], [1000, 1090], [1500, 1060], [2000, 1100], [2600, 1070], [2600, 1200], [0, 1200]], '#7fa393', { seed: 5, layers: 10, alpha: .07, spread: 12 });
  // rooftops row
  const r = rng(21);
  let x = -60;
  while (x < w + 60) {
    const bw = 220 + r() * 220, top = 1090 + r() * 90, roofH = 60 + r() * 50;
    const flat = r() < .45;
    const wallC = mix(PAL.wall, r() < .5 ? '#d6d0c2' : '#f3dcc0', r() * .6);
    shape(ctx, RECT(x, top, bw, h - top), wallC, { seed: Math.floor(x), lw: 2.6, still: true, gran: .25 });
    if (flat) {
      shape(ctx, RECT(x - 8, top - 10, bw + 16, 18), '#b9b4aa', { seed: Math.floor(x) + 1, lw: 2.2, still: true });
      if (r() < .8) { // rooftop water tank on legs
        const tx = x + bw * (.25 + r() * .5), ty = top - 20;
        for (const lx of [-26, 26]) ink(ctx, [[tx + lx, ty], [tx + lx, ty - 50]], { w: 3, still: true, seed: tx + lx });
        shape(ctx, RECT(tx - 42, ty - 120, 84, 70), r() < .5 ? '#c9d6de' : '#e7dcc7', { seed: Math.floor(tx), lw: 2.4, still: true });
        shape(ctx, ellipsePts(tx, ty - 120, 42, 10, 16), '#aebcc6', { seed: Math.floor(tx) + 3, lw: 2, still: true });
      }
    } else {
      const roof = SH([[x - 20, top + 10], [x + bw * .5, top - roofH], [x + bw + 20, top + 10]]);
      shape(ctx, roof, mix(PAL.roof, PAL.roofDark, r() * .5), { seed: Math.floor(x) + 2, lw: 2.8, still: true, gran: .35 });
      for (let k = 1; k < 7; k++) pencil(ctx, [[lerp(roof[0][0], roof[1][0], k / 7), lerp(roof[0][1], roof[1][1], k / 7)], [lerp(roof[2][0], roof[1][0], k / 7), lerp(roof[2][1], roof[1][1], k / 7)]], { col: '#6d3a2c', w: 1.4, alpha: .4, still: true, seed: k + x });
    }
    // windows with iron grilles
    const nwin = Math.floor(bw / 110);
    for (let k = 0; k < nwin; k++) {
      const wx = x + 40 + k * (bw - 60) / Math.max(1, nwin), wy = top + 60 + r() * 30;
      shape(ctx, RECT(wx, wy, 64, 80), '#6f8da3', { seed: Math.floor(wx), lw: 2.2, still: true, gran: .3 });
      for (let g = 1; g < 4; g++) ink(ctx, [[wx + g * 16, wy + 2], [wx + g * 16, wy + 78]], { w: 1.6, still: true, seed: wx + g });
      ink(ctx, [[wx + 2, wy + 40], [wx + 62, wy + 40]], { w: 1.6, still: true, seed: wx + 9 });
      if (r() < .5) paintLeafClump(ctx, wx + 32, wy + 86, 44, 16, Math.floor(wx) + 5, { leaf: 7, n: 16 }); // potted plants
    }
    x += bw + 10 + r() * 30;
  }
  // courtyard wall + 七里香 hedge in front
  shape(ctx, SH([[-20, 1450], [w + 20, 1430], [w + 20, h + 20], [-20, h + 20]]), '#c9c2b4', { seed: 77, lw: 3, still: true, gran: .3 });
  for (let k = 0; k < 26; k++) pencil(ctx, [[k * 100, 1440], [k * 100 + 4, h]], { col: '#8b8478', w: 1.6, alpha: .35, still: true, seed: k });
  paintLeafClump(ctx, 330, 1480, 420, 170, 3, { leaf: 16 });
  paintBlossomsOn(ctx, 330, 1470, 390, 150, 4, 60, 9);
  paintLeafClump(ctx, 2250, 1520, 420, 140, 5, { leaf: 15 });
  paintBlossomsOn(ctx, 2250, 1510, 380, 120, 6, 40, 8);
  // poles
  drawPole(ctx, TOWN.poleL[0], TOWN.poleL[1], h, 1.25, 11);
  drawPole(ctx, TOWN.poleR[0], TOWN.poleR[1], h, .9, 12);
}
function drawTownClouds(ctx, t) {
  const c1 = cached('town:c1', 1200, 600, c => paintCloud(c, 600, 380, 330, 41));
  const c2 = cached('town:c2', 1000, 520, c => paintCloud(c, 500, 330, 260, 42, { n: 6 }));
  const c3 = cached('town:c3', 900, 460, c => paintCloud(c, 450, 300, 210, 43, { n: 5 }));
  ctx.drawImage(c1, 200 + t * 6, 130);
  ctx.drawImage(c2, 1350 + t * 4, 40);
  ctx.drawImage(c3, 1850 + t * 7, 520);
}
const SPARROWS = [ // landing time (song time), x position on wire 1
  { land: 18.2, x: 980, seed: 1 }, { land: 20.6, x: 1130, seed: 2 }, { land: 22.3, x: 1240, seed: 3 },
  { land: 24.1, x: 1480, seed: 4 }, { land: 25.9, x: 1560, seed: 5 },
];
function drawWiresAndBirds(ctx, t, wires, birds, scale = 1) {
  for (const [k, wr] of wires.entries()) {
    const sway = Math.sin(t * 1.3 + k) * 3;
    ink(ctx, wirePts(wr.x0, wr.y0, wr.x1, wr.y1, wr.sag, 36, sway), { w: 3.2 * scale, col: '#2f2a28', seed: 90 + k, amp: .6, taper: [.01, .01], minW: .8 });
  }
  const wr = wires[1];
  for (const b of birds) {
    const y = wireY(wr.x0, wr.y0, wr.x1, wr.y1, wr.sag, b.x) + Math.sin(t * 1.3 + 1) * 3 * Math.sin(Math.PI * clamp((b.x - wr.x0) / (wr.x1 - wr.x0)));
    const f = inv(b.land - 1.6, b.land, t);
    if (f <= 0) continue;
    if (f < 1) { // flying in from the right, arcing down
      const e = easeOut(f);
      const fx = lerp(b.x + 900, b.x, e), fy = lerp(y - 420, y - 26 * scale, e) - Math.sin(e * Math.PI) * 80;
      drawSparrow(ctx, fx, fy, 1.5 * scale, t, { fly: true, flip: true, seed: b.seed });
    } else {
      const lt = t - b.land;
      const bi = beatIndex(t);
      const hop = Math.max(0, Math.sin(lt * 9)) * (lt < .4 ? 10 : 0) * scale;
      drawSparrow(ctx, b.x, y - 26 * 1.5 * scale, 1.5 * scale, t, { flip: b.seed % 2 === 0, look: Math.sin(bi * 1.7 + b.seed) * .6, beak: (bi + b.seed) % 3 === 0 ? beatPulse(t) : 0, hop, seed: b.seed });
    }
  }
}
SHOT('summer', 15.3, 29.0, {
  tin: { type: 'page', dur: 1.0 },
  grade: { tint: '#ffd08a', amt: .18, vig: .45, glow: [1700, 60, 800, '#fff1c9', .45] },
  init() { this.bg = cached('summer:bg', TOWN.w, TOWN.h, c => paintTown(c)); this.wires = townWires(); },
  draw(ctx, lt, t) {
    const e = easeInOutSine(inv(0, 13.2, lt));
    const cy = lerp(620, 1020, e), cx = lerp(1180, 1330, e), zoom = lerp(1.08, 1.0, e);
    ctx.save(); camera(ctx, cx, cy, zoom);
    ctx.drawImage(this.bg, 0, 0, TOWN.w, TOWN.h * .75, 0, 0, TOWN.w, TOWN.h * .75);
    drawTownClouds(ctx, t);
    ctx.drawImage(this.bg, 0, TOWN.h * .6, TOWN.w, TOWN.h * .4, 0, TOWN.h * .6, TOWN.w, TOWN.h * .4);
    drawWiresAndBirds(ctx, t, this.wires, SPARROWS, 1);
    ctx.restore();
    // handwritten caption
    ctx.save();
    writeText(ctx, '那 年 夏 天', 1260, 420, 'LongCang', 110, 16.4, .28, t, { col: '#fdfaf2', alpha: env(t, 16.2, 27.4, .3, 1.2), double: true });
    ctx.restore();
  },
});

// ------------------------------------------------------------------
// 2. Sparrows gossiping on the wire (seen past the window frame).
// ------------------------------------------------------------------
function paintWindowSky(ctx, o = {}) {
  paintSky(ctx, W, H, { seed: o.seed ?? 14, blots: 40 });
  paintCloud(ctx, 1400, 380, 300, 61);
  paintCloud(ctx, 300, 700, 200, 62, { n: 5 });
  // blurry leaves of the courtyard tree at the top corner
  paintLeafClump(ctx, 1750, 60, 380, 170, 63, { leaf: 20 });
  paintBlossomsOn(ctx, 1750, 90, 340, 120, 64, 18, 10);
}
function drawWindowFrame(ctx, t, o = {}) {
  const woodC = o.wood ?? '#7b5a44';
  // left & right frame posts, sill at bottom
  shape(ctx, SH([[-20, -20], [150, -20], [140, H + 20], [-20, H + 20]]), woodC, { seed: 71, lw: 3.4, gran: .4 });
  shape(ctx, SH([[W - 130, -20], [W + 20, -20], [W + 20, H + 20], [W - 140, H + 20]]), woodC, { seed: 72, lw: 3.4, gran: .4 });
  ink(ctx, [[120, 0], [112, H]], { w: 2, seed: 73, alpha: .5 });
  if (o.sill !== false) shape(ctx, SH([[-20, H - 90], [W + 20, H - 110], [W + 20, H + 20], [-20, H + 20]]), mix(woodC, '#ffffff', .15), { seed: 74, lw: 3.4, gran: .4 });
  // curtain on the left, swaying
  const sw = Math.sin(t * 1.1) * 30 + noise1(t * .6, 2) * 25;
  const cur = [[-20, -20], [300, -20]];
  for (let y = 40; y <= H - 110; y += 60) cur.push([300 + Math.sin(y * .012 + t * 1.3) * 14 + sw * (y / H) * 1.6, y]);
  for (let x = 300 + sw * 1.4; x > -20; x -= 50) cur.push([x, H - 108 + Math.sin(x * .05 + t) * 8]);
  cur.push([-20, H - 100]); SH(cur);
  wcFill(ctx, cur, '#f4f0e6', { alpha: .88, seed: 75, gran: .15, edge: .3 });
  for (let k = 1; k < 5; k++) ink(ctx, [[k * 60, -10], [k * 58 + sw * .5 * k / 4, 500], [k * 62 + sw * k / 4, H - 110]], { w: 1.8, seed: 76 + k, alpha: .5 });
  inkShape(ctx, cur, { w: 2.6, seed: 80 });
}
SHOT('sparrows', 29.0, 35.8, {
  tin: { type: 'wash', dur: 1.0 },
  grade: { tint: '#ffe0a6', amt: .15, vig: .45 },
  lyr: { y: 960 },
  init() { this.bg = cached('sparrows:bg', W, H, c => paintWindowSky(c)); },
  draw(ctx, lt, t) {
    const z = 1 + lt * .012;
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
    ctx.drawImage(this.bg, 0, 0);
    const wy = x => 470 + x * .08 + Math.sin(t * 1.4) * 4 * Math.sin(Math.PI * x / W);
    ink(ctx, [[-50, wy(-50)], [W / 2, wy(W / 2) + 30], [W + 50, wy(W + 50)]], { w: 5, col: '#2f2a28', seed: 91, amp: .5, taper: [.01, .01], minW: .8 });
    ink(ctx, [[-50, wy(-50) + 160], [W / 2, wy(W / 2) + 200], [W + 50, wy(W + 50) + 150]], { w: 4, col: '#2f2a28', seed: 92, amp: .5, taper: [.01, .01], minW: .8, alpha: .8 });
    const birds = [[620, 1, 0], [900, 2, 1.2], [1210, 3, 2.1], [1450, 4, 3.4]];
    for (const [bx, sd, arrive] of birds) {
      const y = wy(bx) + 28 * (1 - Math.pow(Math.abs(bx - W / 2) / (W / 2), 2)) - 78;
      if (lt < arrive) continue;
      const a = clamp((lt - arrive) / .5);
      const talk = (Math.floor(t * 6 + sd * 1.3) % 4 === 0) ? 1 : 0;
      const beak = talk * (.5 + .5 * Math.sin(t * 40));
      drawSparrow(ctx, bx, y - (1 - easeOut(a)) * 120, 3.1, t, { flip: sd % 2 === 1, look: Math.sin(t * 1.3 + sd * 2) * .7, beak, seed: sd, hop: Math.max(0, Math.sin((t + sd) * 3.1)) > .97 ? 16 : 0 });
      if (talk) { // chatter marks
        const dir = sd % 2 === 1 ? -1 : 1;
        for (let k = 0; k < 3; k++) pencil(ctx, [[bx + dir * (80 + k * 4), y - 70 - k * 22 + 18], [bx + dir * (112 + k * 10), y - 84 - k * 30 + 18]], { col: '#3d3b43', w: 3, seed: k + sd, alpha: .8 });
      }
    }
    ctx.restore();
    drawWindowFrame(ctx, t, { sill: false });
  },
});

// ------------------------------------------------------------------
// 3. "It feels like summer" — the girl at her window.
// ------------------------------------------------------------------
function paintGirlRoom(ctx) {
  ctx.drawImage(TEX.paper, 0, 0);
  wash(ctx, [[-50, -50], [W + 50, -50], [W + 50, H + 50], [-50, H + 50]], '#e9dcc4', { seed: 1, layers: 8, alpha: .12, spread: 30 });
  // window opening on the left
  ctx.save();
  ctx.beginPath(); ctx.rect(120, 60, 760, 740); ctx.clip();
  paintSky(ctx, W, H, { seed: 31, blots: 40 });
  paintCloud(ctx, 520, 360, 220, 81, { n: 6 });
  paintLeafClump(ctx, 180, 760, 300, 140, 82, { leaf: 14 });
  paintBlossomsOn(ctx, 180, 760, 260, 110, 83, 16, 8);
  ctx.restore();
  shape(ctx, RECT(100, 40, 800, 780), null, { seed: 84, lw: 5, still: true });
  shape(ctx, RECT(480, 40, 40, 780), '#8a6a52', { seed: 85, lw: 3, still: true });
  shape(ctx, RECT(100, 400, 800, 30), '#8a6a52', { seed: 86, lw: 3, still: true });
  // wall calendar and a poster of a sparrow (her own drawing)
  paperSheet(ctx, 1560, 90, 230, 300, { col: '#fbf7ee', shadow: 10 });
  ctx.font = '40px LongCang'; ctx.fillStyle = '#c8454a'; ctx.fillText('七月', 1620, 150);
  ctx.strokeStyle = 'rgba(80,70,60,.4)'; ctx.lineWidth = 1.2;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) ctx.strokeRect(1580 + c * 32, 180 + r * 38, 32, 38);
}
SHOT('girlwindow', 35.8, 42.6, {
  tin: { type: 'cut', dur: 0 },
  grade: { tint: '#ffd08a', amt: .2, vig: .5, glow: [300, 200, 900, '#fff0c8', .5] },
  lyr: { x: 1340, y: 990, size: 64 },
  init() { this.bg = cached('girlwindow:bg', W, H, c => paintGirlRoom(c)); },
  draw(ctx, lt, t) {
    const z = 1.02 + lt * .01;
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
    ctx.drawImage(this.bg, 0, 0);
    // tiny sparrows outside
    drawSparrow(ctx, 330, 300, .9, t, { seed: 2, beak: Math.sin(t * 30) > .6 ? 1 : 0 });
    drawSparrow(ctx, 420, 312, .9, t, { seed: 3, flip: true });
    ink(ctx, [[120, 330], [500, 350], [880, 336]], { w: 2.4, col: '#2f2a28', seed: 5, taper: [.01, .01], minW: .8 });
    // the girl
    const turnT = easeInOut(inv(1.4, 2.4, lt));
    const turn = lerp(-.62, -.12, turnT);
    const talking = t > 36.0 && t < 41.7;
    drawPortrait(ctx, 1180, 520, 1.55, {
      who: 'girl', turn, tilt: lerp(-.08, .06, turnT) + Math.sin(t * 1.2) * .015, wind: .6,
      eyes: lt > 5.6 ? 'smile' : 'open', look: [lerp(-1, 0, turnT), lerp(-.5, 0, turnT)],
      mouth: talking && lt < 5.6 ? 'talk' : 'smile', blush: .55,
    });
    // windowsill in front of her & resting forearm
    shape(ctx, SH([[-20, 900], [W + 20, 890], [W + 20, H + 20], [-20, H + 20]]), '#9a785d', { seed: 90, lw: 3.2, gran: .35 });
    ink(ctx, [[-20, 912], [W + 20, 902]], { w: 2, seed: 91, alpha: .6 });
    // hands resting on the sill edge
    for (const [hx, sd] of [[1040, 96], [1330, 98]]) {
      shape(ctx, [[hx - 40, 902], [hx - 36, 876], [hx - 10, 866], [hx + 24, 868], [hx + 42, 884], [hx + 40, 910], [hx + 10, 922], [hx - 24, 920]], PAL.skin, { seed: sd, lw: 2.6 });
      for (let k = 0; k < 3; k++) ink(ctx, [[hx - 18 + k * 18, 900], [hx - 16 + k * 18, 918]], { w: 1.8, seed: sd + k, alpha: .6 });
    }
    ctx.restore();
  },
});

// helper: draw with boil frozen (for cached sketches)
function frozen(fn) { const bv = K.bv; K.bv = 0; try { fn(); } finally { K.bv = bv; } }
// cursive-looking scribble "handwriting" (unreadable), words separated by gaps
function scribbleLine(x0, y0, len, seed) {
  const r = rng(seed), pts = [], words = [];
  let x = x0;
  while (x < x0 + len) {
    const wl = 60 + r() * 110, w = [];
    for (let u = 0; u <= wl; u += 3) {
      const ph = u * .19 + seed;
      w.push([x + u + Math.sin(ph) * 7, y0 - Math.abs(Math.cos(ph * .5)) * (10 + 8 * noise1(u * .05, seed)) + noise1(u * .03, seed + 1) * 4]);
    }
    words.push(w); x += wl + 22 + r() * 14;
  }
  return words;
}
function drawWordsProgress(ctx, words, p, o = {}) {
  const tot = words.reduce((a, w) => a + w.length, 0);
  let left = p * tot, tip = null;
  for (const w of words) {
    if (left <= 0) break;
    const n = Math.min(w.length, Math.ceil(left));
    pencil(ctx, w.slice(0, Math.max(2, n)), { col: o.col ?? '#34323a', w: o.w ?? 2.6, alpha: .85, still: true, seed: o.seed ?? 1, passes: 2 });
    tip = w[Math.max(0, n - 1)];
    left -= w.length;
  }
  return tip;
}

// ------------------------------------------------------------------
// 4. The pencil going back and forth: he sketches her, then writes.
// ------------------------------------------------------------------
const SKETCH_PATH = (() => { // zig-zag raster over the portrait area
  const pts = [];
  for (let row = 0; row < 16; row++) {
    const y = 250 + row * 38, xa = row % 2 ? 960 : 560, xb = row % 2 ? 560 : 960;
    pts.push([xa, y], [xb, y + 19]);
  }
  return pts;
})();
function pathAt(pts, u) {
  const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + dist(pts[i - 1], pts[i]));
  const d = clamp(u) * L[L.length - 1];
  let i = 1; while (i < L.length - 1 && L[i] < d) i++;
  const q = (d - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]);
  return { p: [lerp(pts[i - 1][0], pts[i][0], q), lerp(pts[i - 1][1], pts[i][1], q)], i, L, d };
}
SHOT('pencil', 42.6, 55.5, {
  tin: { type: 'sketch', dur: .9 },
  grade: { tint: '#ffcf8f', amt: .2, vig: .6 },
  lyr: { x: 640, y: 210, size: 110, rot: -.04, halo: false },
  init() {
    this.desk = cached('pencil:desk', W, H, c => paintDesk(c, W, H, 9, '#a97c55'));
    this.sketch = cached('pencil:sketch', W, H, c => frozen(() => {
      drawPortrait(c, 760, 470, 1.2, { who: 'girl', sketch: true, turn: -.2, eyes: 'smile', mouth: 'smile', wind: .4, t: 3 });
      hatch(c, [[610, 700], [920, 700], [960, 900], [560, 900]], { angle: -.8, spacing: 10, alpha: .22, still: true });
    }));
    this.words = [0, 1, 2, 3].map(k => scribbleLine(1080, 420 + k * 95, 420 - (k === 3 ? 180 : 0), 50 + k));
  },
  draw(ctx, lt, t) {
    ctx.drawImage(this.desk, 0, 0);
    ctx.save();
    const drift = lt * 4;
    ctx.translate(W / 2, H / 2); ctx.rotate(-.025 + lt * .0015); ctx.scale(1.02 + lt * .004, 1.02 + lt * .004); ctx.translate(-W / 2 + drift * .3, -H / 2);
    paperSheet(ctx, 330, 70, 1320, 960, { col: '#f8f3e8', shadow: 30 });
    // portrait sketch revealed where the pencil has travelled
    const pd = inv(0.15, 5.9, lt);
    const M = MASK.getContext('2d');
    M.setTransform(1, 0, 0, 1, 0, 0); M.clearRect(0, 0, W, H);
    const cur = pathAt(SKETCH_PATH, pd);
    M.lineCap = 'round'; M.lineJoin = 'round'; M.lineWidth = 64; M.strokeStyle = '#000';
    M.beginPath(); M.moveTo(SKETCH_PATH[0][0], SKETCH_PATH[0][1]);
    for (let i = 1; i < cur.i; i++) M.lineTo(SKETCH_PATH[i][0], SKETCH_PATH[i][1]);
    M.lineTo(cur.p[0], cur.p[1]); M.stroke();
    if (pd >= 1) M.fillRect(0, 0, W, H);
    M.globalCompositeOperation = 'source-in'; M.drawImage(this.sketch, 0, 0); M.globalCompositeOperation = 'source-over';
    ctx.drawImage(MASK, 0, 0);
    // writing lines to the right
    const wp = inv(6.3, 11.6, lt);
    let tip = null;
    if (wp > 0) {
      for (let k = 0; k < 4; k++) {
        const q = clamp(wp * 4 - k);
        if (q > 0) { const tp = drawWordsProgress(ctx, this.words[k], q, { seed: k + 3 }); if (q < 1) tip = tp; }
      }
      // cross out the third line, then a small heart
      const xo = inv(11.7, 12.1, lt);
      if (xo > 0) pencil(ctx, [[1070, 612], [1300, 598], [1500, 606]], { w: 4, progress: xo, col: '#34323a', still: true, seed: 9 });
      const hp = inv(12.2, 12.8, lt);
      if (hp > 0) {
        const hx = 1340, hy = 690, hs = 22;
        const heart = []; for (let k = 0; k <= 40; k++) { const a = k / 40 * TAU; heart.push([hx + hs * 16 * Math.pow(Math.sin(a), 3) / 16, hy - hs * (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 16]); }
        pencil(ctx, heart, { w: 3.4, progress: hp, col: '#c8454a', still: true, seed: 11 });
        if (hp >= 1) tip = [hx + 40, hy + 30]; else tip = heart[Math.floor(hp * 40)];
      }
    }
    // the hand follows the pencil tip
    let hx, hy;
    if (pd < 1 && lt < 6.1) { hx = cur.p[0]; hy = cur.p[1]; }
    else if (tip) { hx = tip[0]; hy = tip[1]; }
    else { const q = easeInOut(inv(5.9, 6.3, lt)); hx = lerp(560, 1080, q); hy = lerp(860, 420, q); }
    if (lt > 12.9) { const q = easeIn(inv(12.9, 13.6, lt)); hx = lerp(1380, 1900, q); hy = lerp(720, 900, q); }
    this._h = this._h || [hx, hy];
    drawPencilHand(ctx, hx, hy + Math.sin(t * 25) * 1.5, 1.05, { ang: -.55, seed: 700 });
    ctx.restore();
  },
});

// ------------------------------------------------------------------
// 5. The cat wants to know the taste of the grilled fish.
// ------------------------------------------------------------------
function paintCourtyard(ctx) {
  paintSky(ctx, W, H * .6, { seed: 17, blots: 30, top: '#8cc3e4', mid: '#b5dcec' });
  ctx.drawImage(TEX.paper, 0, H * .55, W, H * .45, 0, H * .55, W, H * .45);
  // back wall of the house, sliding door, potted plants
  shape(ctx, RECT(-20, 250, W + 40, 620), '#efe3c9', { seed: 51, still: true, gran: .25 });
  shape(ctx, RECT(1180, 330, 520, 540), '#c7d7dc', { seed: 52, still: true, gran: .3 });
  for (let k = 1; k < 4; k++) ink(ctx, [[1180 + k * 130, 330], [1180 + k * 130, 870]], { w: 3, still: true, seed: 53 + k });
  ink(ctx, [[1180, 600], [1700, 600]], { w: 3, still: true, seed: 57 });
  // eaves shadow
  wash(ctx, [[-20, 250], [W + 20, 250], [W + 20, 330], [-20, 310]], '#b9a58a', { seed: 58, layers: 8, alpha: .08, spread: 10 });
  shape(ctx, SH([[-40, 200], [W + 40, 200], [W + 40, 262], [-40, 262]]), '#8f4a38', { seed: 59, still: true, gran: .35 });
  // step / low wall the cat sits on
  shape(ctx, RECT(-20, 800, W + 40, 90), '#c9c2b4', { seed: 60, still: true, gran: .3 });
  shape(ctx, RECT(-20, 880, W + 40, 220), '#a79f92', { seed: 61, still: true, gran: .3 });
  for (let k = 0; k < 12; k++) pencil(ctx, [[k * 170, 885], [k * 170 + 6, 1080]], { col: '#6f685e', alpha: .35, still: true, seed: k });
  // 七里香 pots
  for (const [px, sd] of [[180, 1], [1880, 2]]) {
    shape(ctx, SH([[px - 90, 800], [px + 90, 800], [px + 70, 690], [px - 70, 690]].reverse()), '#b86a4c', { seed: 62 + sd, still: true });
    paintLeafClump(ctx, px, 560, 190, 150, 70 + sd, { leaf: 14 });
    paintBlossomsOn(ctx, px, 560, 170, 130, 80 + sd, 20, 8);
  }
}
SHOT('cat', 55.5, 62.8, {
  tin: { type: 'wash', dur: .9 },
  grade: { tint: '#ffd49a', amt: .2, vig: .5 },
  lyr: { x: 1340, y: 190, size: 112, rot: .03 },
  init() { this.bg = cached('cat:bg', W, H, c => paintCourtyard(c)); },
  draw(ctx, lt, t) {
    const z = 1.04 + lt * .01;
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
    ctx.drawImage(this.bg, 0, 0);
    drawFishPlate(ctx, 1260, 812, 1.2, { steam: true });
    const sniff = easeInOut(inv(1.2, 3.2, lt)) * (1 - easeInOut(inv(5.8, 6.6, lt)) * .5);
    const paw = easeInOut(inv(4.2, 5.2, lt)) * (1 - easeInOut(inv(5.4, 5.9, lt)));
    drawCat(ctx, 880 + easeInOut(inv(.2, 1.8, lt)) * 120, 808, 1.5, t, { sniff, paw, eyes: lt > 6 ? 'happy' : 'open', look: 1 });
    // the girl crouching nearby, watching, amused
    drawPortrait(ctx, 380, 540, 1.05, { who: 'girl', turn: .55, eyes: lt > 5 ? 'smile' : 'open', mouth: lt > 5 ? 'laugh' : 'smile', look: [1, .4], blush: .6, tilt: .08 + Math.sin(t) * .02 });
    ctx.drawImage(this.bg, 0, 790, 820, 290, 0, 790, 820, 290);
    ctx.restore();
  },
});

// ------------------------------------------------------------------
// 6. Walking home together along the hedge — the theme of first love.
// ------------------------------------------------------------------
function paintLane(ctx, w, h) {
  paintSky(ctx, w, h, { seed: 23, top: '#8ab8dc', mid: '#f3d3a6', low: '#f7e2bf', blots: 60 });
  const r = rng(24);
  // far houses (flat washes)
  for (let x = -40; x < w; x += 180 + r() * 120) {
    const top = 520 + r() * 80;
    wash(ctx, SH([[x, h], [x, top], [x + 90, top - 50 - r() * 40], [x + 180, top], [x + 180, h]]), '#c9b6a1', { seed: x, layers: 7, alpha: .08, spread: 6 });
  }
  // poles and a long wire along the lane
  for (let x = 200; x < w; x += 900) drawPole(ctx, x, 180, 760, .8, x);
  for (let k = 0; k < 2; k++) for (let x = 200; x < w - 900; x += 900) ink(ctx, wirePts(x - 55 + k * 110, 205, x + 900 - 55 + k * 110, 205, 90), { w: 2.4, still: true, seed: x + k, taper: [.01, .01], minW: .8 });
  // wall and hedge
  shape(ctx, RECT(-20, 640, w + 40, 200), '#d9d1c1', { seed: 25, still: true, gran: .3 });
  for (let x = 0; x < w; x += 120) pencil(ctx, [[x, 645], [x + 4, 835]], { col: '#8b8478', alpha: .3, still: true, seed: x });
  for (let x = 0; x < w; x += 330) { paintLeafClump(ctx, x + 160, 600, 220, 110, x + 5, { leaf: 13 }); paintBlossomsOn(ctx, x + 160, 600, 200, 90, x + 6, 12, 7); }
  // lane
  wash(ctx, RECT(-20, 830, w + 40, 260), '#cdb99a', { seed: 26, layers: 10, alpha: .08, spread: 8 });
}
SHOT('walk', 62.8, 69.2, {
  tin: { type: 'whip', dur: .6 },
  grade: { tint: '#ffb870', amt: .28, vig: .5, glow: [1700, 200, 900, '#ffd9a0', .45] },
  lyr: { x: 960, y: 250, size: 116 },
  init() { this.bg = cached('walk:bg', 3600, H, c => paintLane(c, 3600, H)); },
  draw(ctx, lt, t) {
    const scroll = lt * 190 + 200;
    ctx.drawImage(this.bg, -scroll, 0);
    // long shadows on the lane
    const ph = t * 5.2;
    for (const [who, x, off] of [['girl', 820, 0], ['boy', 1080, Math.PI * .5]]) {
      ctx.save(); ctx.globalAlpha = .18; ctx.fillStyle = '#5b4a60';
      ctx.beginPath(); ctx.ellipse(x - 150, 1000, 230, 26, -.05, 0, TAU); ctx.fill(); ctx.restore();
    }
    const glance = Math.sin(lt * 1.3) > .4;
    drawBody(ctx, 820, 1010, .98, Object.assign(walkPose(ph), { headTilt: glance ? .12 : 0 }), { who: 'girl', t, wind: .6, skirtWind: Math.sin(t * 3) * 6 });
    drawBody(ctx, 1080, 1010, 1.02, Object.assign(walkPose(ph + Math.PI * .5), { headTilt: -.05 }), { who: 'boy', t, bag: true });
    // hedge leaves in the foreground drifting by
    fallers(ctx, t, { n: 10, seed: 62, v: 50, sway: 60, draw: (c, x, y, i) => drawBlossom(c, x - scroll * .3 % W, y, 7, t + i) });
  },
});

// ------------------------------------------------------------------
// 7. Warm sunlight — like a freshly picked strawberry.
// ------------------------------------------------------------------
SHOT('strawsun', 69.2, 75.6, {
  tin: { type: 'dip', dur: .6 },
  grade: { tint: '#ff9f6b', amt: .25, vig: .55 },
  lyr: { x: 960, y: 1000, size: 110, style: 'light' },
  init() {
    this.bg = cached('strawsun:bg', W, H, c => {
      paintSky(c, W, H, { seed: 29, top: '#f59e7a', mid: '#fbc98a', low: '#fde6b8', blots: 50 });
      wash(c, [[-50, 820], [400, 760], [900, 800], [1400, 740], [1970, 790], [1970, 1130], [-50, 1130]], '#8fae6a', { seed: 30, layers: 12, alpha: .08, spread: 14 });
      wash(c, [[-50, 900], [600, 860], [1300, 890], [1970, 860], [1970, 1130], [-50, 1130]], '#6f9455', { seed: 31, layers: 12, alpha: .08, spread: 12 });
      // strawberry field rows
      for (let k = 0; k < 7; k++) { const y = 920 + k * 26; pencil(c, [[-20, y], [W + 20, y - 10]], { col: '#4f7040', w: 2, alpha: .35, still: true, seed: k }); }
    });
  },
  draw(ctx, lt, t) {
    ctx.drawImage(this.bg, 0, 0);
    const sx = 960, sy = lerp(470, 430, lt / 6.4);
    // sun glow and hand-drawn rays
    blot(ctx, sx, sy, 520, '#fff3c4', .7, 'screen');
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * TAU + t * .08, r0 = 130, r1 = 190 + Math.sin(t * 2 + k) * 20 + beatPulse(t) * 25;
      pencil(ctx, [[sx + Math.cos(a) * r0, sy + Math.sin(a) * r0], [sx + Math.cos(a) * r1, sy + Math.sin(a) * r1]], { col: '#f7b046', w: 5, alpha: .9, seed: k });
    }
    const morph = easeInOut(inv(3.2, 4.4, lt));
    if (morph < 1) {
      ctx.save(); ctx.globalAlpha = 1 - morph;
      shape(ctx, ellipsePts(sx, sy, 110, 110, 24), '#ffd66b', { seed: 3, lw: 3.4, gran: .2 });
      ctx.restore();
    }
    if (morph > 0) drawStrawberry(ctx, sx, sy + 10, 118 * easeOutBack(morph), t * .5, { rot: Math.sin(t * 1.5) * .05 });
    // the girl's hand rises from below, lining up a real strawberry with the sun
    const rise = 0;
    if (rise > 0) {
      const hy = lerp(1300, 900, rise);
      ctx.save(); ctx.globalAlpha = .96;
      limb(ctx, [1180, hy + 420], [1120, hy + 60], 90, 70, '#c9876a', 41);
      shape(ctx, ellipsePts(1110, hy + 30, 50, 44, 14), '#d8977a', { seed: 42, lw: 3 });
      drawStrawberry(ctx, 1100, hy - 36, 44, t, { rot: -.2 });
      ctx.restore();
    }
    // sparkles
    fallers(ctx, t, { n: 24, seed: 71, v: -30, sway: 20, draw: (c, x, y, i, r) => { c.save(); c.globalAlpha = .5 + .5 * Math.sin(t * 4 + i); c.fillStyle = '#fff8dc'; c.beginPath(); c.arc(x, y, 2 + r * 3, 0, TAU); c.fill(); c.restore(); } });
  },
});

// ------------------------------------------------------------------
// 8. She can't bear to eat it — savouring the feeling.
// ------------------------------------------------------------------
SHOT('savor', 75.6, 82.2, {
  tin: { type: 'cut', dur: 0 },
  grade: { tint: '#ffb58a', amt: .22, vig: .55, glow: [1600, 150, 800, '#ffe0b0', .5] },
  lyr: { x: 1450, y: 900, size: 110, rot: -.03 },
  init() {
    this.bg = cached('savor:bg', W, H, c => {
      paintSky(c, W, H, { seed: 35, top: '#f7b38a', mid: '#fbd7a6', low: '#fdebc8', blots: 60 });
      paintLeafClump(c, 150, 950, 420, 220, 36, { leaf: 18 });
      paintBlossomsOn(c, 150, 950, 380, 180, 37, 26, 10);
      paintLeafClump(c, 1850, 180, 320, 200, 38, { leaf: 18 });
      paintBlossomsOn(c, 1850, 180, 300, 170, 39, 18, 10);
    });
  },
  draw(ctx, lt, t) {
    ctx.drawImage(this.bg, 0, 0);
    const shake = Math.sin(Math.max(0, lt - 2.2) * 6) * .06 * env(lt, 2.2, 4.4, .3, .5);
    drawPortrait(ctx, 900, 470, 1.75, { who: 'girl', turn: .12 + shake, tilt: -.06 + shake * .8, eyes: lt > 1.2 ? 'closed' : 'open', mouth: lt > 2.2 ? 'smile' : 'small', blush: .75 + .25 * env(lt, 1, 6, .6, .6), wind: .5, look: [0, -.5] });
    // hand holding the strawberry near her chin
    const hx = 1040, hy = 800 + Math.sin(t * 1.6) * 4;
    limbStroke(ctx, [[1120, 1160], [hx + 12, hy + 40]], 62, PAL.skin, { seed: 43, lw: 6 });
    shape(ctx, capsule([1130, 1180], [1118, 1060], 96, 90), PAL.blouse, { seed: 45, lw: 3 });
    shape(ctx, [[hx - 40, hy + 10], [hx - 20, hy - 20], [hx + 30, hy - 26], [hx + 56, hy + 6], [hx + 44, hy + 50], [hx - 10, hy + 58]], PAL.skin, { seed: 44, lw: 3 });
    drawStrawberry(ctx, hx - 2, hy - 64, 52, t, { rot: .15 });
    // little hearts / sparkles rising
    fallers(ctx, t, { n: 10, seed: 77, v: -45, sway: 30, draw: (c, x, y, i) => { if (i % 2) drawBlossom(c, x, y, 8, t + i); else { c.save(); c.globalAlpha = .7; c.fillStyle = '#f39c9c'; c.font = '34px LongCang'; c.fillText('♡', x, y); c.restore(); } } });
  },
});

// ------------------------------------------------------------------
// 9. It rains all night — his room, the lamp, the window.
// ------------------------------------------------------------------
function paintNightExterior(ctx, w, h, o = {}) {
  ctx.fillStyle = '#1a2440'; ctx.fillRect(0, 0, w, h);
  ctx.save(); ctx.globalAlpha = .35; ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(TEX.paper, 0, 0, w, h); ctx.restore();
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#22335a'); g.addColorStop(1, '#101a30');
  ctx.save(); ctx.globalAlpha = .8; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
  const r = rng(o.seed ?? 5);
  for (let i = 0; i < 40; i++) blot(ctx, r() * w, r() * h, 60 + r() * 200, '#3a5288', .08, 'screen');
  // house silhouettes and a lit window across the courtyard
  wash(ctx, SH([[0, h * .45], [w * .3, h * .45], [w * .3, h * .3], [w * .6, h * .3], [w * .6, h * .5], [w, h * .5], [w, h], [0, h]]), '#0c1222', { seed: 6, layers: 8, alpha: .12, spread: 6 });
  if (o.bush !== false) {
    paintLeafClump(ctx, w * .3, h * .82, w * .28, h * .2, 7, { leaf: 16 * (o.leafScale ?? 1), dark: '#0f2a26', light: '#2f5a4a', base: '#0d1f1c' });
    paintBlossomsOn(ctx, w * .3, h * .8, w * .25, h * .16, 8, 20, 7 * (o.leafScale ?? 1));
  }
}
SHOT('rainroom', 82.2, 89.0, {
  tin: { type: 'dipblack', dur: .8 },
  grade: { tint: '#4a6aa8', amt: .25, vig: .75 },
  lyr: { x: 1300, y: 300, size: 118, style: 'light' },
  init() {
    this.ext = cached('rainroom:ext', 760, 700, c => paintNightExterior(c, 760, 700));
    this.room = cached('rainroom:room', W, H, c => {
      c.fillStyle = '#2a3150'; c.fillRect(0, 0, W, H);
      c.save(); c.globalCompositeOperation = 'multiply'; c.globalAlpha = .5; c.drawImage(TEX.paper, 0, 0); c.restore();
      wash(c, RECT(-40, -40, W + 80, H + 80), '#3a4570', { seed: 3, layers: 8, alpha: .1, spread: 30 });
      // shelf with books
      shape(c, RECT(1350, 180, 460, 18), '#5a4636', { seed: 4, still: true });
      const r = rng(9); let bx = 1370;
      while (bx < 1780) { const bw = 20 + r() * 26, bh = 90 + r() * 60; shape(c, RECT(bx, 180 - bh, bw, bh), mix('#7a5a6a', '#4a6a8a', r()), { seed: bx, still: true, lw: 2 }); bx += bw + 4; }
    });
  },
  draw(ctx, lt, t) {
    const z = 1.0 + lt * .012;
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
    ctx.drawImage(this.room, 0, 0);
    // window with the rainy courtyard
    ctx.save(); ctx.beginPath(); ctx.rect(170, 90, 720, 640); ctx.clip();
    ctx.drawImage(this.ext, 150, 70);
    drawRain(ctx, t, { x: 150, y: 70, w: 760, h: 700, n: 160, col: 'rgba(170,195,235,.5)', len: 50, speed: 1300 });
    drawGlassDrops(ctx, t, { x: 170, y: 90, w: 720, h: 640, n: 45, dark: true, tint: 'rgba(200,215,245,.35)' });
    ctx.restore();
    shape(ctx, RECT(160, 80, 740, 660), null, { seed: 21, lw: 6 });
    shape(ctx, RECT(520, 80, 20, 660), '#4a3e3a', { seed: 22, lw: 3 });
    shape(ctx, RECT(160, 400, 740, 20), '#4a3e3a', { seed: 23, lw: 3 });
    // lamp light cone
    blot(ctx, 700, 740, 700, '#ffc56b', .5, 'screen');
    // boy at the desk, facing the window
    const write = Math.sin(t * 9) * .05;
    drawBody(ctx, 1100, 1075, 1.25, { hip: [0, -150], thighA: 1.5, shinA: .08, thighB: 1.42, shinB: 0, armA: .9 + write, foreA: 1.7, armB: .8, foreB: 1.62, lean: .22, headTilt: .25 }, { who: 'boy', facing: -1, t });
    // desk in front
    shape(ctx, RECT(300, 776, 1100, 34), '#6b4a36', { seed: 31, lw: 3 });
    shape(ctx, RECT(340, 810, 30, 300), '#5a3e2e', { seed: 32, lw: 3 });
    shape(ctx, RECT(1330, 810, 30, 300), '#5a3e2e', { seed: 33, lw: 3 });
    // paper stack grows
    const nPages = 2 + Math.floor(lt * 1.4);
    for (let k = 0; k < nPages; k++) { const r = rng(k); ctx.save(); ctx.translate(1180 + r() * 12, 768 - k * 5); ctx.rotate((r() - .5) * .08); ctx.fillStyle = k % 2 ? '#f3eee2' : '#e9e3d4'; ctx.fillRect(-90, -4, 180, 6); ctx.restore(); }
    drawLamp(ctx, 520, 776, 1.1);
    drawMug(ctx, 1290, 772, .7, t);
    ctx.restore();
  },
});

SHOT('leaves', 89.0, 95.6, {
  tin: { type: 'fade', dur: .6 },
  grade: { tint: '#3d5a94', amt: .25, vig: .7 },
  lyr: { x: 560, y: 260, size: 118, style: 'light' },
  init() {
    this.bg = cached('leaves:bg', W, H, c => {
      paintNightExterior(c, W, H, { bush: false, seed: 11 });
      // his window, lit, far across the yard
      c.fillStyle = '#ffcf7a'; c.fillRect(1380, 240, 300, 230);
      blot(c, 1530, 355, 420, '#ffb85a', .35, 'screen');
      shape(c, RECT(1380, 240, 300, 230), null, { seed: 41, lw: 5, still: true });
      shape(c, RECT(1520, 240, 12, 230), '#3a2f2a', { seed: 42, still: true });
      // boy silhouette at the desk inside
      c.fillStyle = '#3a2a22'; c.beginPath(); c.ellipse(1600, 380, 34, 38, 0, 0, TAU); c.fill(); c.fillRect(1560, 410, 90, 60);
      // tree trunk & canopy
      shape(c, SH([[380, 1100], [460, 1100], [450, 520], [520, 300], [470, 290], [420, 470], [330, 300], [300, 320], [390, 540]]), '#2a2220', { seed: 43, still: true, gran: .4 });
      paintLeafClump(c, 430, 230, 460, 250, 44, { leaf: 20, dark: '#0f2a26', light: '#39684f', base: '#0d1f1c' });
      // ground
      wash(c, RECT(-40, 900, W + 80, 220), '#0b1426', { seed: 45, layers: 10, alpha: .12, spread: 10 });
    });
  },
  draw(ctx, lt, t) {
    ctx.drawImage(this.bg, 0, 0);
    // puddle ripples
    const r0 = rng(7);
    ctx.save(); ctx.strokeStyle = 'rgba(160,190,235,.35)'; ctx.lineWidth = 1.6;
    for (let i = 0; i < 26; i++) { const x = r0() * W, y = 930 + r0() * 140, ph = ((t * .9 + r0()) % 1); ctx.globalAlpha = 1 - ph; ctx.beginPath(); ctx.ellipse(x, y, 6 + ph * 40, 2 + ph * 9, 0, 0, TAU); ctx.stroke(); }
    ctx.restore();
    // falling leaves that settle into a growing pile
    const settled = Math.floor(lt * 9);
    const pr = rng(19);
    for (let i = 0; i < settled; i++) {
      const a = pr() * Math.PI, rr = Math.sqrt(pr());
      const x = 700 + Math.cos(a) * 520 * rr * (pr() < .5 ? -1 : 1) * .9, y = 1010 - Math.sin(a) * 60 * rr - i * .5;
      drawLeaf(ctx, x, y, 22, pr() * TAU, mix('#8a6a3a', '#c9873a', pr()), { seed: i, flip: 1, line: pr() < .5 });
    }
    fallers(ctx, t, { n: 16, seed: 23, v: 110, sway: 70, y: -50, draw: (c, x, y, i, r) => drawLeaf(c, x, y, 20, t * 2 + i, mix('#7a8a4a', '#d0903a', r), { seed: i }) });
    drawRain(ctx, t, { n: 320, col: 'rgba(170,195,235,.45)', len: 70, speed: 1600, ang: .15 });
  },
});

// ------------------------------------------------------------------
// 10. The lamp's warmth vs. the cold rain — his fervour won't cool.
// ------------------------------------------------------------------
SHOT('lamp', 95.6, 103.0, {
  tin: { type: 'cut', dur: 0 },
  grade: { tint: '#ff9c4a', amt: .2, vig: .75 },
  lyr: { x: 1450, y: 330, size: 124, style: 'light', rot: -.03 },
  lyrL: { x: 1480, y: 170, rot: 0 },
  init() {
    this.bg = cached('lamp:bg', W, H, c => {
      c.fillStyle = '#233052'; c.fillRect(0, 0, W, H);
      c.save(); c.globalCompositeOperation = 'multiply'; c.globalAlpha = .5; c.drawImage(TEX.paper, 0, 0); c.restore();
      wash(c, RECT(1100, -40, 900, 1200), '#16203a', { seed: 51, layers: 10, alpha: .1, spread: 30 });
    });
  },
  draw(ctx, lt, t) {
    ctx.drawImage(this.bg, 0, 0);
    // warm light expands on his "fervour"
    const warm = .45 + .35 * smooth(inv(1.5, 6, lt)) + beatPulse(t) * .06;
    blot(ctx, 260, 540, 1100, '#ffbf66', warm, 'screen');
    // rain shadows sliding on the right side
    ctx.save(); ctx.globalCompositeOperation = 'multiply';
    const r = rng(31);
    for (let i = 0; i < 18; i++) { const x = 1150 + r() * 780, y = ((t * (80 + r() * 90) + r() * 1200) % 1300) - 150; ctx.globalAlpha = .25; ctx.fillStyle = '#1c2744'; ctx.beginPath(); ctx.ellipse(x, y, 5 + r() * 6, 30 + r() * 40, 0, 0, TAU); ctx.fill(); }
    ctx.restore();
    const blink = Math.sin(lt * .8) > .95;
    drawPortrait(ctx, 820, 420, 1.7, { who: 'boy', turn: -.5, tilt: .1 + Math.sin(t * .7) * .02, eyes: lt > 4.5 ? 'smile' : (blink ? 'closed' : 'open'), look: [-.6, .9], mouth: lt > 4.5 ? 'smile' : 'small', blush: .45, pencilEar: true, noBlink: true });
    // rim light from the lamp
    ctx.save(); ctx.globalCompositeOperation = 'screen'; blot(ctx, 470, 420, 260, '#ffd38a', .25, 'screen'); ctx.restore();
    shape(ctx, SH([[-20, 880], [W + 20, 860], [W + 20, H + 20], [-20, H + 20]]), '#5a3e2e', { seed: 55, lw: 3, gran: .3 });
    ctx.save(); ctx.translate(700, 960); ctx.rotate(-.06); paperSheet(ctx, -300, -60, 600, 200, { col: '#f6efe0', shadow: 12 });
    for (let k = 0; k < 3; k++) pencil(ctx, [[-260, -20 + k * 40], [lerp(-260, 240, clamp(lt / 6 - k * .25 + .3)), -22 + k * 40]], { w: 2.4, col: '#4a4650', still: true, seed: k }); ctx.restore();
    blot(ctx, 600, 960, 500, '#ffcf80', .35, 'screen');
    drawPencilHand(ctx, 560 + ((lt * 60) % 440) + Math.sin(t * 8) * 10, 960 + Math.cos(t * 8) * 4, .75, { ang: -.35, seed: 710 });
  },
});

// ------------------------------------------------------------------
// 11. You appear on every page — a flip-book of sketches of her.
// ------------------------------------------------------------------
const SKETCH_POSES = [
  { turn: -.2, eyes: 'smile', mouth: 'smile' }, { turn: .45, eyes: 'open', mouth: 'o', look: [1, 0] },
  { turn: -.5, eyes: 'closed', mouth: 'smile', wind: 1 }, { turn: .1, eyes: 'smile', mouth: 'laugh' },
  { turn: .6, eyes: 'open', mouth: 'small', look: [1, -.5], tilt: .15 }, { turn: -.1, eyes: 'wide', mouth: 'o' },
  { turn: .3, eyes: 'closed', mouth: 'pout', tilt: -.12 }, { turn: 0, eyes: 'smile', mouth: 'smile', wind: .6 },
];
SHOT('flip', 103.0, 109.4, {
  tin: { type: 'cut', dur: 0 },
  grade: { tint: '#ffb56a', amt: .25, vig: .7 },
  lyr: { x: 1500, y: 980, size: 108, halo: true },
  init() {
    this.desk = cached('flip:desk', W, H, c => { paintDesk(c, W, H, 13, '#8a6446'); });
    this.pages = SKETCH_POSES.map((p, k) => cached('flip:p' + k, 700, 900, c => frozen(() => {
      paperSheet(c, 0, 0, 700, 900, { col: '#f7f2e7', shadow: 0 });
      drawPortrait(c, 350, 360, 1.15, Object.assign({ who: 'girl', sketch: true, t: k * 1.3 + .5 }, p));
      pencil(c, [[80, 820], [300, 812], [620, 824]], { still: true, w: 1.6, alpha: .4 });
      c.font = '44px LongCang'; c.fillStyle = 'rgba(60,55,60,.7)'; c.fillText(`No.${k + 1}`, 520, 870);
    })));
  },
  draw(ctx, lt, t) {
    ctx.drawImage(this.desk, 0, 0);
    blot(ctx, 500, 300, 900, '#ffcf80', .35, 'screen');
    ctx.save(); ctx.translate(W / 2 + 40, H / 2); ctx.rotate(-.03); ctx.scale(1.05, 1.05);
    // left page (previous), right page (current), flipping page on beats
    const per = 60 / 143.55 * 2, u = lt / per, k = Math.floor(u), f = u - k;
    const N = this.pages.length;
    const cur = this.pages[(k + 1) % N], prev = this.pages[k % N], next = this.pages[(k + 2) % N];
    ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 40; ctx.fillStyle = '#5a3d2e'; ctx.fillRect(-730, -470, 1460, 940); ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#efe8d8'; ctx.fillRect(-710, -450, 700, 900);
    ctx.save(); ctx.globalAlpha = .12; ctx.translate(-10, 0); ctx.scale(-1, 1); ctx.drawImage(prev, 0, -450, 700, 900); ctx.restore(); // show-through
    ctx.globalAlpha = .45; ctx.drawImage(TEX.paper, 0, 0, 700, 900, -710, -450, 700, 900); ctx.globalAlpha = 1;
    ctx.drawImage(next, 10, -450, 700, 900);
    const e = easeInOut(clamp(f / .55));
    if (e < 1) {
      const sx = Math.cos(e * Math.PI);
      ctx.save();
      if (sx > 0) { ctx.translate(10, 0); ctx.scale(sx, 1); ctx.drawImage(cur, 0, -450, 700, 900); }
      else { ctx.translate(-10, 0); ctx.scale(sx, 1); ctx.fillStyle = '#efe8d8'; ctx.fillRect(0, -450, 700, 900); ctx.globalAlpha = .5; ctx.drawImage(TEX.paper, 0, 0, 700, 900, 0, -450, 700, 900); }
      ctx.restore();
      ctx.fillStyle = `rgba(40,25,15,${.25 * Math.sin(e * Math.PI)})`; ctx.fillRect(-10, -450, 20, 900);
    }
    const sg = ctx.createLinearGradient(-60, 0, 60, 0); sg.addColorStop(0, 'rgba(50,30,20,0)'); sg.addColorStop(.5, 'rgba(50,30,20,.3)'); sg.addColorStop(1, 'rgba(50,30,20,0)');
    ctx.fillStyle = sg; ctx.fillRect(-60, -450, 120, 900);
    ctx.restore();
  },
});

// ------------------------------------------------------------------
// 12. Rain on the glass until dawn; he fell asleep on his drawings.
// ------------------------------------------------------------------
SHOT('dawn', 109.4, 116.2, {
  tin: { type: 'fade', dur: .8 },
  grade: { tint: '#c9a0c8', amt: .2, vig: .6 },
  lyr: { x: 1400, y: 300, size: 118, style: 'light' },
  init() {
    this.bgN = cached('dawn:n', W, H, c => paintNightExterior(c, W, H, { seed: 14, leafScale: 1.6 }));
    this.bgD = cached('dawn:d', W, H, c => {
      paintSky(c, W, H, { seed: 15, top: '#8ea6d6', mid: '#e9b8c4', low: '#fbd9a8', blots: 50 });
      wash(c, SH([[0, 480], [580, 480], [580, 330], [1150, 330], [1150, 540], [W, 540], [W, H], [0, H]]), '#6a6a8a', { seed: 16, layers: 8, alpha: .1, spread: 6 });
      paintLeafClump(c, 576, 885, 540, 216, 7, { leaf: 26 }); paintBlossomsOn(c, 576, 864, 480, 170, 8, 24, 11);
    });
  },
  draw(ctx, lt, t) {
    const d = smooth(inv(.5, 6.2, lt));
    ctx.drawImage(this.bgN, 0, 0);
    ctx.globalAlpha = d; ctx.drawImage(this.bgD, 0, 0); ctx.globalAlpha = 1;
    // background out of focus behind the glass: soften with a paper haze
    ctx.save(); ctx.globalAlpha = .18; ctx.fillStyle = '#f4eee2'; ctx.fillRect(0, 0, W, H); ctx.restore();
    drawRain(ctx, t, { n: Math.round(lerp(220, 30, d)), col: `rgba(200,215,240,${lerp(.45, .25, d)})`, len: 60, speed: 1400 });
    drawGlassDrops(ctx, t, { n: 90, dark: d < .5, tint: `rgba(245,240,250,${lerp(.35, .6, d)})`, seed: 9 });
    // sleeping boy silhouette in the foreground (head on crossed arms)
    ctx.save();
    const br = Math.sin(t * 1.2) * 3;
    shape(ctx, SH([[860, H + 20], [900, 1000], [1780, 990], [1820, H + 20]]), '#3a2e2a', { seed: 60, lw: 3, gran: .3 }); // desk edge
    shape(ctx, [[1010, 1010], [1040, 930], [1320, 900 + br], [1600, 930], [1640, 1010]], '#4a4f66', { seed: 61, lw: 3, gran: .2 }); // shoulders
    shape(ctx, [[950, 990], [1000, 940], [1320, 930], [1660, 940], [1700, 990], [1320, 1010]], '#6d7390', { seed: 65, lw: 3, gran: .2 }); // folded arms
    shape(ctx, [[1200, 950 + br], [1180, 870 + br], [1230, 800 + br], [1320, 780 + br], [1410, 800 + br], [1460, 870 + br], [1440, 950 + br]], '#231d22', { seed: 62, lw: 3, gran: .3 });
    for (let k = 0; k < 4; k++) ink(ctx, [[1250 + k * 40, 820 + br], [1262 + k * 40, 860 + br]], { w: 2.4, seed: 63 + k, col: '#4a3f48' });
    ink(ctx, [[1300, 784 + br], [1320, 756 + br], [1340, 770 + br]], { w: 4, seed: 67, col: '#231d22' });
    // "zzz"
    ctx.globalAlpha = .7 * (1 - d); ctx.fillStyle = '#e9e4f4'; ctx.font = '60px LongCang';
    for (let k = 0; k < 3; k++) { const ph = (t * .5 + k / 3) % 1; ctx.globalAlpha = (1 - d) * Math.sin(ph * Math.PI); ctx.fillText('z', 1440 + ph * 80 + k * 10, 760 - ph * 140); }
    ctx.restore();
  },
});

// ------------------------------------------------------------------
// 13. A butterfly on the windowsill — pages like fluttering chapters.
// ------------------------------------------------------------------
SHOT('butterfly', 116.2, 122.8, {
  tin: { type: 'wash', dur: .9 },
  grade: { tint: '#ffe3a8', amt: .2, vig: .5, glow: [300, 100, 900, '#fff6d8', .5] },
  lyr: { x: 1050, y: 230, size: 118 },
  init() { this.bg = cached('butterfly:bg', W, H, c => paintWindowSky(c, { seed: 44 })); },
  draw(ctx, lt, t) {
    const z = 1.04 - lt * .004;
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
    ctx.drawImage(this.bg, 0, 0);
    drawWindowFrame(ctx, t, {});
    // open sketchbook on the sill (in perspective), pages riffling in the breeze
    const bx = 1150, by = 930;
    const P = (u, v) => [bx + u * lerp(1, .82, v), by - v * 150 + u * .02]; // u: -1..1 across, v: 0 near .. 1 far
    shape(ctx, SH([P(-470, -.05), P(470, -.05), P(470, 1.05), P(-470, 1.05)]), '#6d4a3a', { seed: 81, lw: 3 });
    shape(ctx, SH([P(-445, 0), P(-6, 0), P(-6, 1), P(-445, 1)]), '#f6f0e3', { seed: 82, lw: 2.4, gran: .1 });
    shape(ctx, SH([P(6, 0), P(445, 0), P(445, 1), P(6, 1)]), '#f6f0e3', { seed: 83, lw: 2.4, gran: .1 });
    for (let k = 0; k < 3; k++) {
      const ph = ((lt * .8 + k * .33) % 1.3), a = easeInOut(clamp(ph)) * Math.PI;
      const u = Math.cos(a) * 440, lift = Math.sin(a) * 260;
      const pg = SH([[P(0, 0)[0], P(0, 0)[1]], [P(u, 0)[0], P(u, 0)[1] - lift], [P(u, 1)[0], P(u, 1)[1] - lift * .9], [P(0, 1)[0], P(0, 1)[1]]]);
      shape(ctx, pg, Math.cos(a) > 0 ? '#faf6ec' : '#ece5d6', { seed: 84 + k, lw: 2.2, gran: .08 });
    }
    // the butterfly lands, then paper butterflies peel off the pages and fly away
    const land = easeOut(inv(0, 2.2, lt));
    const fx = lerp(1700, 1320, land) + Math.sin(t * 2) * (1 - land) * 60, fy = lerp(420, 800, land) + Math.cos(t * 3) * (1 - land) * 50;
    drawButterfly(ctx, fx, fy, 110, t, '#f2b8c6', '#e9d36f', { flap: land >= 1 ? .55 + .45 * Math.sin(t * 2.4) : undefined, rot: land >= 1 ? -.1 : undefined });
    const fly = inv(2.8, 6.6, lt);
    if (fly > 0) for (let i = 0; i < 9; i++) {
      const q = clamp(fly * 1.6 - i * .08); if (q <= 0) continue;
      const r = rng(i + 3), sx = 1000 + r() * 320, sy = 880;
      const x = sx + (r() - .6) * 900 * q + Math.sin(t * 2 + i) * 40, y = sy - 900 * q * (0.6 + r() * .5);
      drawButterfly(ctx, x, y, 34 + r() * 18, t + i, '#fbf8f0', '#efe7d6', { flap: Math.abs(Math.cos(t * 10 + i)) });
    }
    ctx.restore();
  },
});

// ------------------------------------------------------------------
// 14. Writing "forever" at the end — then folding it into a plane.
// ------------------------------------------------------------------
SHOT('forever', 122.8, 130.2, {
  tin: { type: 'page', dur: .9 },
  grade: { tint: '#ffd49a', amt: .2, vig: .6 },
  lyr: { x: 1450, y: 250, size: 116, rot: -.04, halo: false },
  init() {
    this.desk = cached('forever:desk', W, H, c => paintDesk(c, W, H, 17, '#b08560'));
    this.words = [0, 1, 2, 3, 4].map(k => scribbleLine(560, 330 + k * 90, 700 - (k === 4 ? 380 : 0), 80 + k));
  },
  draw(ctx, lt, t) {
    ctx.drawImage(this.desk, 0, 0);
    blot(ctx, 300, 150, 900, '#fff0c8', .4, 'screen');
    const fold = inv(3.9, 5.8, lt), fly = inv(5.8, 7.4, lt);
    if (fold <= 0) {
      paperSheet(ctx, 480, 220, 960, 680, { col: '#f8f3e8', shadow: 26, lines: 90, top: 110 });
      const wp = inv(0, 3.3, lt); let tip = null;
      for (let k = 0; k < 5; k++) { const q = clamp(wp * 5 - k); if (q > 0) { const tp = drawWordsProgress(ctx, this.words[k], q, { seed: k + 20 }); if (q < 1) tip = tp; } }
      const hx = tip ? tip[0] : lerp(900, 1500, inv(3.3, 3.9, lt)), hy = tip ? tip[1] : lerp(690, 900, inv(3.3, 3.9, lt));
      drawPencilHand(ctx, hx, hy + Math.sin(t * 24) * 1.5, 1.0, { ang: -.55, seed: 700 });
    } else if (fly <= 0) {
      // three folds: page -> triangle top -> narrow -> plane
      const st = Math.min(2, Math.floor(fold * 3)), q = easeInOut(fold * 3 - st);
      const cx = 960, cy = 560;
      ctx.save(); ctx.translate(cx, cy);
      const sc = lerp(1, .55, easeInOut(fold));
      ctx.scale(sc, sc);
      ctx.shadowColor = 'rgba(40,28,18,.3)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 8;
      if (st === 0) {
        const f = q; // corners fold down to the center line
        ctx.fillStyle = '#f8f3e8'; ctx.fillRect(-480, -340, 960, 680); ctx.shadowColor = 'transparent';
        for (const sg of [-1, 1]) { const flap = SH([[sg * 480, -340], [0, -340], [sg * 480 * (1 - f), -340 + 480 * f]]); shape(ctx, flap, '#ece5d6', { seed: 971 + sg, lw: 2.6 }); }
      } else if (st === 1) {
        const body = SH([[0, -340], [480, 140], [480, 340], [-480, 340], [-480, 140]]);
        ctx.save(); ctx.scale(lerp(1, .5, q), 1); shape(ctx, body, '#f8f3e8', { seed: 973, lw: 2.6 }); ctx.restore();
        ctx.shadowColor = 'transparent';
        ink(ctx, [[0, -340], [0, 340]], { w: 2, seed: 974, alpha: .6 });
      } else {
        ctx.shadowColor = 'transparent';
        drawPaperPlane(ctx, 0, 0, lerp(3, 4.2, q), lerp(-Math.PI / 2, -.25, q), {});
      }
      ctx.restore();
      // the boy's hands at the edges while folding
      if (st < 2) { drawPencilHand(ctx, 480, 820, .9, { ang: -1.2, seed: 720, pencilCol: '#f8f3e8' }); }
    } else {
      const e = easeIn(fly);
      drawPaperPlane(ctx, lerp(960, 2300, e), lerp(560, -200, e) + Math.sin(e * 6) * 40, lerp(2.3, 1.2, e), -.25 - e * .3, { bank: Math.sin(t * 4) });
      pencil(ctx, [[960, 560], [lerp(960, 2300, e * .9), lerp(560, -200, e * .9)]], { col: '#ffffff', w: 2, alpha: .35 * (1 - e) });
    }
  },
});

// ------------------------------------------------------------------
// 15. The plane crosses the courtyard to her window: understood.
// ------------------------------------------------------------------
function paintTwoWindows(ctx) {
  paintSky(ctx, W, H, { seed: 47, blots: 40 });
  paintCloud(ctx, 960, 200, 260, 48, { n: 6 });
  // two facing houses
  shape(ctx, SH([[-20, 260], [520, 260], [520, H + 20], [-20, H + 20]]), '#efe2c6', { seed: 49, still: true, gran: .3 });
  shape(ctx, SH([[1400, 300], [W + 20, 300], [W + 20, H + 20], [1400, H + 20]]), '#f2dcc0', { seed: 50, still: true, gran: .3 });
  shape(ctx, SH([[-40, 270], [260, 170], [560, 270]]), PAL.roof, { seed: 51, still: true, gran: .35 });
  shape(ctx, SH([[1370, 310], [1660, 200], [W + 40, 310]]), PAL.roofDark, { seed: 52, still: true, gran: .35 });
  // windows
  shape(ctx, RECT(170, 420, 260, 250), '#26344f', { seed: 53, still: true });
  shape(ctx, RECT(1510, 460, 260, 250), '#26344f', { seed: 54, still: true });
  // courtyard with the big 七里香 bush
  wash(ctx, RECT(500, 860, 920, 260), '#b9a88a', { seed: 55, layers: 10, alpha: .09, spread: 10 });
  paintLeafClump(ctx, 960, 900, 380, 170, 56, { leaf: 18 });
  paintBlossomsOn(ctx, 960, 890, 350, 140, 57, 40, 9);
  ink(ctx, wirePts(520, 330, 1400, 360, 90), { w: 2.6, still: true, seed: 58, taper: [.01, .01], minW: .8 });
}
SHOT('plane', 130.2, 137.6, {
  tin: { type: 'whip', dur: .5 },
  grade: { tint: '#ffd690', amt: .2, vig: .5 },
  lyr: { x: 1640, y: 900, size: 116 },
  init() { this.bg = cached('plane:bg', W, H, c => paintTwoWindows(c)); },
  draw(ctx, lt, t) {
    ctx.drawImage(this.bg, 0, 0);
    // him waving at his window (left), her at hers (right)
    ctx.save(); ctx.beginPath(); ctx.rect(170, 420, 260, 250); ctx.clip();
    drawPortrait(ctx, 300, 560, .62, { who: 'boy', turn: .5, eyes: lt > 4 ? 'smile' : 'open', mouth: 'smile', look: [1, 0] });
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(1510, 460, 260, 250); ctx.clip();
    const read = inv(2.4, 3.2, lt);
    drawPortrait(ctx, 1640, 600, .62, { who: 'girl', turn: lerp(-.5, -.1, read), eyes: lt > 3.6 ? 'smile' : 'open', mouth: lt > 3.6 ? 'laugh' : 'o', look: [-1, lt > 2.4 ? .8 : 0], blush: .5 + read * .4 });
    ctx.restore();
    shape(ctx, RECT(170, 420, 260, 250), null, { seed: 60, lw: 5 });
    shape(ctx, RECT(1510, 460, 260, 250), null, { seed: 61, lw: 5 });
    shape(ctx, RECT(150, 668, 300, 22), '#8a6a52', { seed: 62, lw: 3 });
    shape(ctx, RECT(1490, 708, 300, 22), '#8a6a52', { seed: 63, lw: 3 });
    // the plane's flight
    const f = inv(0, 2.4, lt);
    if (f < 1) {
      const x = lerp(380, 1560, easeInOut(f)), y = lerp(560, 620, f) - Math.sin(f * Math.PI) * 260;
      const dx = 1180, dy = -Math.cos(f * Math.PI) * 820;
      drawPaperPlane(ctx, x, y, 1.1, Math.atan2(dy, dx) * .8, { bank: Math.sin(t * 5) * .5 });
      // dotted flight trail
      ctx.save(); ctx.setLineDash([6, 14]); ctx.strokeStyle = 'rgba(60,55,65,.45)'; ctx.lineWidth = 2.4; ctx.beginPath();
      for (let k = 0; k <= 30; k++) { const u = k / 30 * f; const xx = lerp(380, 1560, easeInOut(u)), yy = lerp(560, 620, u) - Math.sin(u * Math.PI) * 260; k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
      ctx.stroke(); ctx.restore();
    } else {
      // unfolded note in her hands
      const q = easeOut(inv(2.4, 3.0, lt));
      ctx.save(); ctx.translate(1640, 780); ctx.rotate(-.05); ctx.scale(q * .8, q * .8);
      paperSheet(ctx, -80, -60, 160, 110, { col: '#f8f3e8', shadow: 10 });
      for (let k = 0; k < 3; k++) pencil(ctx, [[-60, -30 + k * 26], [60, -32 + k * 26]], { col: '#6a6670', w: 1.8, alpha: .6, seed: k });
      ctx.restore();
      // a heart pops above her window
      const hq = easeOutBack(inv(3.6, 4.2, lt));
      if (hq > 0) { ctx.save(); ctx.fillStyle = '#e8606a'; ctx.font = `${Math.round(90 * hq)}px LongCang`; ctx.fillText('♡', 1610, 430); ctx.restore(); }
    }
    fallers(ctx, t, { n: 12, seed: 88, v: 40, sway: 50, draw: (c, x, y, i) => drawBlossom(c, x, y, 7, t + i) });
  },
});

// ------------------------------------------------------------------
// 16. Interlude — sitting on the courtyard wall at dusk.
// ------------------------------------------------------------------
function paintDusk(ctx, w, h) {
  paintSky(ctx, w, h, { seed: 61, top: '#6f6aa8', mid: '#f19a74', low: '#fcd9a0', blots: 70 });
  blot(ctx, w * .62, h * .66, 300, '#fff1c2', .8, 'screen');
  ctx.fillStyle = '#ffe9b8'; ctx.beginPath(); ctx.arc(w * .62, h * .66, 70, 0, TAU); ctx.fill();
  // distant town silhouettes
  wash(ctx, SH([[0, h * .7], [w * .1, h * .7], [w * .1, h * .62], [w * .22, h * .62], [w * .22, h * .68], [w * .4, h * .68], [w * .4, h * .6], [w * .5, h * .6], [w * .5, h * .7], [w * .75, h * .7], [w * .75, h * .63], [w * .86, h * .63], [w * .86, h * .7], [w, h * .7], [w, h], [0, h]]), '#5a4a6a', { seed: 62, layers: 9, alpha: .12, spread: 5 });
  for (let x = 250; x < w; x += 1000) drawPole(ctx, x, h * .25, h * .75, .8, x);
  for (let x = 250; x < w - 1000; x += 1000) for (let k = 0; k < 2; k++) ink(ctx, wirePts(x - 55 + k * 110, h * .25 + 20, x + 945 + k * 110, h * .25 + 20, 110), { w: 2.4, still: true, seed: x + k, taper: [.01, .01], minW: .8 });
  // the wall they sit on
  shape(ctx, SH([[-20, h * .8], [w + 20, h * .8], [w + 20, h + 20], [-20, h + 20]]), '#8f7f86', { seed: 63, still: true, gran: .3 });
  for (let x = 0; x < w; x += 140) pencil(ctx, [[x, h * .8], [x + 6, h]], { col: '#5a4c55', alpha: .35, still: true, seed: x });
}
SHOT('dusk', 137.6, 150.6, {
  tin: { type: 'dip', dur: 1.2 },
  grade: { tint: '#ff9a70', amt: .25, vig: .6 },
  init() { this.bg = cached('dusk:bg', 2400, H, c => paintDusk(c, 2400, H)); },
  draw(ctx, lt, t) {
    const pan = easeInOutSine(inv(0, 13, lt));
    ctx.save(); ctx.translate(-lerp(0, 420, pan), 0);
    ctx.drawImage(this.bg, 0, 0);
    // sparrow silhouettes on the wire
    for (let k = 0; k < 5; k++) { const x = 700 + k * 90 + (k > 2 ? 200 : 0), y = wireY(195, 290, 1195, 290, 110, x) - 16; ctx.save(); ctx.globalAlpha = .85; drawSparrow(ctx, x, y, .8, t, { seed: k + 10, look: Math.sin(t + k) * .5 }); ctx.restore(); }
    ctx.restore();
    // the two from behind, sitting on the wall; she leans on his shoulder
    const lean = easeInOut(inv(7.5, 9.5, lt));
    const wy = H * .8;
    ctx.save(); ctx.translate(-lerp(0, 120, pan), 0);
    drawBackView(ctx, 1085, wy + 8 + 146 * 1.35, 1.35, { who: 'boy', armL: [[-62, -262], [-76, -150]], armR: [[62, -262], [74, -150]] });
    ctx.save(); ctx.translate(905 + lean * 22, wy + 30 + 150 * 1.3); ctx.rotate(lean * .16);
    drawBackView(ctx, 0, 0, 1.3, { who: 'girl', armL: [[-56, -250], [-70, -130]], armR: [[56, -250], [76, -140]] });
    ctx.restore();
    // wall top covers their lower bodies
    shape(ctx, SH([[500, wy], [1500, wy], [1500, H + 20], [500, H + 20]]), '#8f7f86', { seed: 64, lw: 3, gran: .3 });

    ctx.restore();
    fallers(ctx, t, { n: 14, seed: 91, v: 25, sway: 60, draw: (c, x, y, i) => drawBlossom(c, x, y, 6, t * .5 + i) });
  },
});

// ------------------------------------------------------------------
// 17. Riding the bicycle through the fields, she sits on the back.
// ------------------------------------------------------------------
function paintFields(ctx, w, h) {
  paintSky(ctx, w, h, { seed: 71, top: '#6fa9da', mid: '#a9d4ea', low: '#e6f1ea', blots: 60 });
  for (let k = 0; k < 5; k++) paintCloud(ctx, 400 + k * 900, 180 + (k % 2) * 90, 180 + (k % 3) * 50, 72 + k, { n: 5 });
  wash(ctx, [[0, 600], [600, 560], [1400, 590], [2200, 550], [3000, 590], [3800, 560], [3800, 700], [0, 700]], '#8fb6a0', { seed: 73, layers: 10, alpha: .08, spread: 12 });
  // paddies
  wash(ctx, RECT(-40, 640, w + 80, 480), '#9cc26a', { seed: 74, layers: 12, alpha: .08, spread: 16 });
  for (let y = 660; y < h; y += 26 + (y - 660) * .08) pencil(ctx, [[-20, y], [w + 20, y + 4]], { col: '#5f8a3a', w: 1.8, alpha: .35, still: true, seed: y });
  const r = rng(75);
  for (let i = 0; i < 700; i++) { const x = r() * w, y = 660 + Math.pow(r(), 1.5) * 420, s = 3 + (y - 640) / 30; ink(ctx, [[x, y], [x + s * .3, y - s * 2]], { w: 1.6 + s * .12, col: mix('#5f8a3a', '#b9d46a', r()), still: true, seed: i }); }
  // the raised road they ride on
  shape(ctx, SH([[-20, 900], [w + 20, 900], [w + 20, 960], [-20, 960]]), '#cdb99a', { seed: 76, still: true, gran: .3 });
}
SHOT('bike', 150.6, 163.4, {
  tin: { type: 'flash', dur: .5 },
  grade: { tint: '#ffe0a0', amt: .18, vig: .45, glow: [1800, 80, 800, '#fff6d8', .5] },
  init() { this.bg = cached('bike:bg', 3800, H, c => paintFields(c, 3800, H)); },
  draw(ctx, lt, t) {
    const scroll = (lt * 260) % (3800 - W);
    // parallax: far layer slower
    ctx.drawImage(this.bg, scroll * .35, 0, W, 640, 0, 0, W, 640);
    ctx.drawImage(this.bg, scroll, 640, W, H - 640, 0, 640, W, H - 640);
    // poles whizzing past in the foreground
    for (let k = 0; k < 3; k++) { const x = ((k * 900 - lt * 520) % 2700 + 2700) % 2700 - 300; drawPole(ctx, x, 60, 1000, 1.1, 300 + k); }
    const bob = Math.abs(Math.sin(t * 7)) * 4;
    const bx = 940, by = 940 - bob;
    const spin = t * 9;
    const b = drawBike(ctx, bx, by, 1.15, t, spin);
    // boy pedalling
    const c = b.crank;
    drawBody(ctx, b.seat[0] + 10, b.seat[1] + 176, 1.0, { hip: [0, -176], thighA: 1.0 + Math.sin(c) * .35, shinA: -.1 + Math.sin(c) * .3, thighB: 1.0 - Math.sin(c) * .35, shinB: -.1 - Math.sin(c) * .3, armA: 1.2, foreA: 1.5, armB: 1.15, foreB: 1.45, lean: .22, headTilt: -.05 }, { who: 'boy', t });
    // girl sitting side-saddle on the rack, legs dangling, hair in the wind
    drawBody(ctx, b.rack[0] - 6, b.rack[1] + 150, .95, { hip: [0, -150], thighA: .1, shinA: .15 + Math.sin(t * 3) * .1, thighB: .05, shinB: .1 + Math.sin(t * 3 + 1) * .1, armA: 1.35, foreA: 1.6, armB: .3, foreB: .1, lean: -.05, headTilt: -.1 }, { who: 'girl', t, wind: 1.4, skirtWind: -18 + Math.sin(t * 6) * 6, facing: 1 });
    // sparrows flying alongside
    for (let k = 0; k < 4; k++) drawSparrow(ctx, 300 + k * 330 + Math.sin(t * 1.5 + k) * 60, 260 + Math.sin(t * 2 + k * 2) * 50 + k * 30, 1.1, t + k, { fly: true, seed: k + 20 });
    // speed lines
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineCap = 'round';
    const r = rng(Math.floor(t * 12));
    for (let i = 0; i < 8; i++) { const y = 600 + r() * 380, x = r() * W; ctx.lineWidth = 2 + r() * 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 120 + r() * 120, y); ctx.stroke(); }
    ctx.restore();
  },
});

// ------------------------------------------------------------------
// 18. Rain again — sharing one umbrella; his shoulder gets soaked.
// ------------------------------------------------------------------
function paintRainStreet(ctx, w, h) {
  paintSky(ctx, w, h, { seed: 81, top: '#7d8fa8', mid: '#a9b6c4', low: '#c9cfd3', blots: 60 });
  const r = rng(82);
  // houses along the street receding
  for (let k = 0; k < 7; k++) {
    const x = k * 300 - 40, top = 300 + k * 18;
    shape(ctx, RECT(x, top, 280, h - top), mix('#d9d2c2', '#bfc6c9', r()), { seed: 83 + k, still: true, gran: .3 });
    for (let j = 0; j < 2; j++) shape(ctx, RECT(x + 40 + j * 120, top + 80, 80, 90), '#6f8599', { seed: 90 + k * 3 + j, still: true, gran: .3 });
  }
  shape(ctx, RECT(-20, 640, w + 40, 60), '#c9c2b4', { seed: 101, still: true, gran: .3 });
  for (let x = 0; x < w; x += 330) { paintLeafClump(ctx, x + 160, 610, 200, 90, x + 7, { leaf: 12 }); paintBlossomsOn(ctx, x + 160, 610, 180, 70, x + 8, 10, 7); }
  // wet road with reflections
  const g = ctx.createLinearGradient(0, 700, 0, h); g.addColorStop(0, '#8f969c'); g.addColorStop(1, '#5f676f');
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = g; ctx.fillRect(0, 700, w, h - 700); ctx.restore();
  for (let i = 0; i < 40; i++) { const x = r() * w, y = 720 + r() * 360; ctx.save(); ctx.globalAlpha = .25; ctx.fillStyle = '#dfe6ec'; ctx.beginPath(); ctx.ellipse(x, y, 40 + r() * 120, 4 + r() * 6, 0, 0, TAU); ctx.fill(); ctx.restore(); }
}
SHOT('umbrella', 163.4, 176.6, {
  tin: { type: 'dipblack', dur: .6 },
  grade: { tint: '#7090b8', amt: .2, vig: .6 },
  lyr: { x: 1500, y: 240, size: 116 },
  init() { this.bg = cached('umbrella:bg', W, H, c => paintRainStreet(c, W, H)); },
  draw(ctx, lt, t) {
    const z = 1 + lt * .01;
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
    ctx.drawImage(this.bg, 0, 0);
    const walk = t * 5, x0 = 960 - lt * 6, yb = 1000 - lt * 8, sc = 1.25 - lt * .012;
    // reflections in the wet road
    ctx.save(); ctx.globalAlpha = .22; ctx.translate(0, yb * 2 + 20); ctx.scale(1, -1);
    drawBackView(ctx, x0 - 90 * sc, yb, sc, { who: 'girl', walk });
    drawBackView(ctx, x0 + 90 * sc, yb, sc * 1.05, { who: 'boy', walk: walk + Math.PI });
    ctx.restore();
    drawBackView(ctx, x0 - 90 * sc, yb, sc, { who: 'girl', walk, armR: [[56, -250], [80, -190]] });
    const bs = sc * 1.05, hx = x0 + 90 * sc - 72 * bs, hy = yb - 340 * bs;
    drawBackView(ctx, x0 + 90 * sc, yb, bs, { who: 'boy', walk: walk + Math.PI, wetShoulder: smooth(inv(1, 10, lt)) * .8, wetSide: 1, armL: [[-62, -262], [-72, -340]] });
    drawUmbrella(ctx, hx + 14 * sc, hy - 130 * sc, sc * .95, -.12, '#6f9fcf', { drips: true, shaft: 130 });
    ctx.restore();
    drawRain(ctx, t, { n: 300, col: 'rgba(225,235,245,.5)', len: 60, speed: 1500, ang: .1 });
  },
});
SHOT('shoulder', 176.6, 184.2, {
  tin: { type: 'cut', dur: 0 },
  grade: { tint: '#8aa6c8', amt: .18, vig: .6 },
  lyr: { x: 960, y: 1010, size: 110, style: 'light' },
  lyrL: { x: 960, y: 1030, style: 'ink', halo: true },
  init() { this.bg = cached('shoulder:bg', W, H, c => { paintRainStreet(c, W, H); c.save(); c.globalAlpha = .35; c.fillStyle = '#e9edf0'; c.fillRect(0, 0, W, H); c.restore(); }); },
  draw(ctx, lt, t) {
    ctx.drawImage(this.bg, 0, 0);
    const close = easeInOut(inv(2.2, 4.2, lt));
    drawRain(ctx, t, { n: 200, col: 'rgba(235,240,248,.45)', len: 50, speed: 1300 });
    drawPortrait(ctx, 1180, 560, 1.25, { who: 'boy', turn: lerp(-.15, -.45, close), eyes: lt > 4.5 ? 'smile' : 'open', look: [lerp(0, -1, close), 0], mouth: lt > 4.5 ? 'smile' : 'small', blush: .5 + close * .4 });
    // wet shoulder patch on the boy
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = .45; ctx.fillStyle = '#9fb3c9'; ctx.beginPath(); ctx.ellipse(1400, 780, 90, 70, .3, 0, TAU); ctx.fill(); ctx.restore();
    drawPortrait(ctx, 760 + close * 60, 600, 1.12, { who: 'girl', turn: .5, tilt: close * .08, eyes: lt > 1.2 ? 'open' : 'open', look: [1, lt > 1.2 && lt < 2.2 ? .8 : 0], mouth: lt > 4.5 ? 'smile' : 'o', blush: .6 + close * .3, browUp: lt > 1.2 && lt < 2.4 ? 4 : 0 });
    drawUmbrella(ctx, 960 + close * 60, 250, 1.55, lerp(.12, -.02, close), '#6f9fcf', { drips: true });
  },
});
SHOT('puddle', 184.2, 189.4, {
  tin: { type: 'cut', dur: 0 },
  grade: { tint: '#7fa0c8', amt: .2, vig: .65 },
  lyr: { x: 960, y: 560, size: 150, style: 'light' },
  lyrL: { x: 960, y: 1052, size: 62 },
  init() {
    this.ref = cached('puddle:ref', W, H, c => {
      // paint the scene upright, then flip it: feet meet the puddle's far edge
      c.save(); c.translate(0, H); c.scale(1, -1);
      paintSky(c, W, H, { seed: 91, top: '#9fb0c6', mid: '#c4ceda', low: '#dfe4ea', blots: 40 });
      drawBackView(c, W / 2 - 100, 960, 1.35, { who: 'girl', armR: [[56, -250], [80, -190]] });
      drawBackView(c, W / 2 + 100, 960, 1.42, { who: 'boy', wetShoulder: .7, wetSide: 1, armL: [[-62, -262], [-72, -340]] });
      drawUmbrella(c, W / 2 + 10, 960 - 340 * 1.42 - 130 * 1.3, 1.3, -.08, '#6f9fcf', { shaft: 130 });
      c.restore();
    });
  },
  draw(ctx, lt, t) {
    ctx.fillStyle = '#4f575f'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.beginPath(); ctx.ellipse(W / 2, H / 2, 900, 470, 0, 0, TAU); ctx.clip();
    // shimmering reflection: horizontal strips displaced
    for (let y = 0; y < H; y += 8) { const dx = Math.sin(y * .05 + t * 6) * 6 * (1 + beatPulse(t)); ctx.drawImage(this.ref, 0, y, W, 8, dx, y, W, 8); }
    // ripples
    const r = rng(5);
    ctx.strokeStyle = 'rgba(240,245,250,.55)'; ctx.lineWidth = 2.4;
    for (let i = 0; i < 12; i++) { const x = 300 + r() * 1300, y = 250 + r() * 600, ph = (t * .8 + r()) % 1; ctx.globalAlpha = 1 - ph; ctx.beginPath(); ctx.ellipse(x, y, 20 + ph * 160, 8 + ph * 60, 0, 0, TAU); ctx.stroke(); }
    ctx.restore();
    inkShape(ctx, ellipsePts(W / 2, H / 2, 900, 470, 40), { w: 4 });
    // a big drop falls at the end -> ripple swallows the frame
    const d = inv(4.2, 5.2, lt);
    if (d > 0) { ctx.save(); ctx.globalAlpha = smooth(d); ctx.fillStyle = '#f4eee2'; ctx.beginPath(); ctx.arc(W / 2, H / 2, easeIn(d) * 1200, 0, TAU); ctx.fill(); ctx.restore(); }
  },
});

// ------------------------------------------------------------------
// 19–22. Golden rice, a tomato-red face, the name 七里香, a sunset kiss.
// ------------------------------------------------------------------
function paintRiceRow(ctx, w, h, seed, n, scale, colA, colB) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * w, base = h, ht = (h * .7) * (.7 + r() * .3), bend = 10 + r() * 30;
    const col = mix(colA, colB, r());
    ink(ctx, [[x, base], [x + bend * .2, base - ht * .5], [x + bend, base - ht]], { w: 2.4 * scale, col: mix(col, '#7a6a2a', .3), still: true, seed: i });
    for (let j = 0; j < 7; j++) { const u = .72 + j * .045; const px = x + bend * (u - .1) + 6 * scale, py = base - ht * u; ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(px + bend * .3 * (j / 7), py + j * 6 * scale, 5 * scale, 10 * scale, .6, 0, TAU); ctx.fill(); }
  }
}
function drawRiceRows(ctx, t, rows) {
  for (const [c, y, amp, ph] of rows) {
    ctx.save(); ctx.translate(0, y);
    const sk = Math.sin(t * 1.2 + ph) * amp;
    ctx.transform(1, 0, sk, 1, -sk * c.height, 0);
    ctx.drawImage(c, -40, 0);
    ctx.restore();
  }
}
SHOT('rice', 189.4, 197.4, {
  tin: { type: 'wash', dur: 1.0 },
  grade: { tint: '#ffc060', amt: .25, vig: .5, glow: [1500, 100, 900, '#fff0c0', .5] },
  lyr: { x: 620, y: 260, size: 120 },
  init() {
    this.sky = cached('rice:sky', W, H, c => { paintSky(c, W, H, { seed: 95, top: '#7aa9d6', mid: '#f2d9a2', low: '#f8e7bc', blots: 50 }); paintCloud(c, 1400, 220, 240, 96, { n: 6 }); wash(c, [[0, 560], [700, 520], [1300, 560], [1920, 520], [1920, 700], [0, 700]], '#b9a86a', { seed: 97, layers: 10, alpha: .08, spread: 10 }); });
    this.far = cached('rice:far', W + 80, 260, c => paintRiceRow(c, W + 80, 260, 1, 900, .5, '#e8c05c', '#d49a2f'));
    this.mid = cached('rice:mid', W + 80, 420, c => paintRiceRow(c, W + 80, 420, 2, 520, .9, '#f0c65a', '#c98f2b'));
    this.near = cached('rice:near', W + 80, 600, c => paintRiceRow(c, W + 80, 600, 3, 160, 1.8, '#f3cc62', '#c98f2b'));
  },
  draw(ctx, lt, t) {
    ctx.drawImage(this.sky, 0, 0);
    drawRiceRows(ctx, t, [[this.far, 540, .03, 0]]);
    // two small figures running along the ridge
    const run = t * 9, x = 300 + lt * 150;
    drawBody(ctx, x, 720, .38, walkPose(run, 1.4), { who: 'girl', t, wind: 1 });
    drawBody(ctx, x + 80, 720, .4, walkPose(run + 1.5, 1.4), { who: 'boy', t });
    drawRiceRows(ctx, t, [[this.mid, 640, .06, 1], [this.near, 520, .1, 2]]);
    // dragonflies
    for (let k = 0; k < 3; k++) {
      const dx = 400 + k * 500 + Math.sin(t * .8 + k) * 120, dy = 380 + Math.sin(t * 1.7 + k * 2) * 60;
      ctx.save(); ctx.translate(dx, dy); ctx.rotate(Math.sin(t + k) * .2);
      ink(ctx, [[-30, 0], [30, 0]], { w: 5, col: '#c8454a', seed: k });
      ctx.globalAlpha = .6; ctx.fillStyle = '#eef6ff';
      for (const sg of [-1, 1]) { ctx.beginPath(); ctx.ellipse(8, sg * 16 * Math.abs(Math.cos(t * 30 + k)), 22, 7, sg * .3, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
  },
});
SHOT('tomato', 197.4, 204.0, {
  tin: { type: 'cut', dur: 0 },
  grade: { tint: '#ffb070', amt: .22, vig: .55 },
  lyr: { x: 1500, y: 300, size: 120, rot: .03 },
  init() { this.bg = cached('tomato:bg', W, H, c => { paintSky(c, W, H, { seed: 99, top: '#f2c88a', mid: '#f7dca8', low: '#fbeac4', blots: 50 }); c.save(); c.translate(0, 600); paintRiceRow(c, W, 480, 7, 420, 1, '#f0c65a', '#c98f2b'); c.restore(); }); },
  draw(ctx, lt, t) {
    ctx.drawImage(this.bg, 0, 0);
    const red = smooth(inv(.8, 5.6, lt));
    drawPortrait(ctx, 900, 500, 1.6, { who: 'girl', turn: -.2 + Math.sin(t * 1.3) * .04, tilt: -.08, eyes: red > .6 ? 'closed' : 'wide', mouth: red > .6 ? 'pout' : 'o', blush: .6 + red * 1.4, look: [-.5, .5], wind: .4 });
    // steam puffs of embarrassment
    if (red > .7) for (let k = 0; k < 3; k++) { const ph = (t * .9 + k / 3) % 1; ctx.save(); ctx.globalAlpha = Math.sin(ph * Math.PI) * .8; pencil(ctx, ellipsePts(900 + (k - 1) * 90, 230 - ph * 120, 22 + ph * 20, 16 + ph * 12, 12), { closed: true, col: '#ffffff', w: 3.4, seed: k }); ctx.restore(); }
    // tomato vines in the foreground
    for (const [x, y, s, sd] of [[260, 900, 1, 1], [1650, 960, 1.2, 2], [1450, 1040, .8, 3]]) {
      ink(ctx, [[x - 100 * s, H + 20], [x - 40 * s, y + 60 * s], [x + 20 * s, y - 60 * s]], { w: 6, col: PAL.leafDark, seed: sd });
      for (let k = 0; k < 4; k++) drawLeaf(ctx, x + (k - 2) * 60 * s, y + (k % 2) * 50 * s, 40 * s, k * 1.3 + sd, PAL.leaf, { seed: k + sd, flip: 1 });
      drawTomato(ctx, x, y, 60 * s, t + sd); drawTomato(ctx, x + 80 * s, y + 70 * s, 46 * s, t + sd + 1);
    }
  },
});
SHOT('sprig', 204.0, 210.6, {
  tin: { type: 'cut', dur: 0 },
  grade: { tint: '#ffc680', amt: .22, vig: .55, glow: [300, 150, 800, '#fff0c8', .5] },
  lyr: { x: 1420, y: 870, size: 130 },
  init() {
    this.bg = cached('sprig:bg', W, H, c => { paintSky(c, W, H, { seed: 101, top: '#9fc4e0', mid: '#f7e3b4', low: '#fbeccb', blots: 50 }); paintLeafClump(c, 1750, 300, 420, 300, 102, { leaf: 20 }); paintBlossomsOn(c, 1750, 300, 380, 260, 103, 40, 12); });
  },
  draw(ctx, lt, t) {
    ctx.drawImage(this.bg, 0, 0);
    const talking = t > 204.2 && t < 209.9;
    drawPortrait(ctx, 760, 500, 1.55, { who: 'girl', turn: .25, tilt: .05 + Math.sin(t * 1.1) * .03, eyes: talking ? 'open' : 'smile', mouth: talking ? 'talk' : 'smile', blush: .8, look: [1, -.3], wind: .7 });
    // she holds up a sprig of 七里香 beside her face
    const up = easeOutBack(inv(.2, 1.2, lt));
    const sx = 1130, sy = lerp(1200, 520, up);
    limbStroke(ctx, [[990, 800], [1070, lerp(1150, 990, up)], [sx - 10, sy + 180]], 54, PAL.skin, { seed: 104, lw: 6 });
    limbStroke(ctx, [[985, 790], [1010, 850]], 76, PAL.blouse, { seed: 107, lw: 6 });
    shape(ctx, [[sx - 44, sy + 190], [sx - 30, sy + 150], [sx + 20, sy + 140], [sx + 44, sy + 170], [sx + 30, sy + 214], [sx - 20, sy + 220]], PAL.skin, { seed: 105, lw: 3 });
    ink(ctx, [[sx, sy + 170], [sx + 6, sy + 60], [sx + 20, sy - 60]], { w: 5, col: '#5a6a3a', seed: 106 });
    for (let k = 0; k < 6; k++) drawLeaf(ctx, sx + (k % 2 ? 40 : -34), sy + 120 - k * 34, 28, k % 2 ? -.5 : Math.PI + .5, PAL.leafDark, { seed: k, flip: 1 });
    const r = rng(7); for (let k = 0; k < 9; k++) drawBlossom(ctx, sx + 20 + gauss(r) * 26, sy - 70 + gauss(r) * 24, 12 + r() * 3, r() * TAU + t * .1);
    // botanical annotation, like a naturalist's sketchbook
    const ann = inv(3.4, 4.4, lt);
    if (ann > 0) {
      pencil(ctx, [[sx + 60, sy - 80], [sx + 170, sy - 150], [sx + 250, sy - 150]], { col: '#4a4650', w: 2, progress: ann, alpha: .8 });
      ctx.save(); ctx.globalAlpha = smooth(ann); ctx.font = '40px LongCang'; ctx.fillStyle = '#4a4650'; ctx.fillText('Murraya paniculata', sx + 190, sy - 166); ctx.restore();
    }
    fallers(ctx, t, { n: 16, seed: 55, v: 40, sway: 60, draw: (c, x, y, i) => drawBlossom(c, x, y, 8, t * .6 + i) });
  },
});
function silhouette(ctx, who, x, y, s, f, col, rim) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  const head = profileHead(who, f);
  const body = SH([[f * 10, 100], [f * 40, 130], [f * 70, 160], [f * 90, 400], [-f * 150, 400], [-f * 120, 170], [-f * 60, 110]]);
  wcFill(ctx, body, col, { gran: .15, edge: 0 }); wcFill(ctx, head, col, { gran: .15, edge: 0 });
  if (who === 'girl') { wcFill(ctx, [[-f * 70, -40], [-f * 50, -70], [-f * 10, -72], [f * 30, -58], [f * 10, -50], [-f * 20, -20], [-f * 40, 40], [-f * 76, 70], [-f * 84, 20]], col, { gran: .1, edge: 0 }); drawBlossom(ctx, -f * 30, -56, 9, .3, { col: '#ffe9c0', lc: 'rgba(0,0,0,0)' }); }
  ctx.strokeStyle = rim; ctx.lineWidth = 3; ctx.globalAlpha = .6; smoothPath(ctx, head, true); ctx.stroke();
  ctx.restore();
}
SHOT('kiss', 210.6, 217.3, {
  tin: { type: 'fade', dur: .7 },
  grade: { tint: '#ff8a5a', amt: .28, vig: .6 },
  lyr: { x: 960, y: 250, size: 124, style: 'light' },
  init() {
    this.bg = cached('kiss:bg', W, H, c => {
      paintSky(c, W, H, { seed: 111, top: '#6e5aa0', mid: '#f08a6a', low: '#fbc98a', blots: 70 });
      blot(c, 960, 700, 560, '#fff0c0', .9, 'screen'); c.fillStyle = '#ffe7b0'; c.beginPath(); c.arc(960, 700, 170, 0, TAU); c.fill();
      wash(c, [[-40, 820], [600, 790], [1300, 810], [1960, 780], [1960, 1120], [-40, 1120]], '#5a3a4a', { seed: 112, layers: 10, alpha: .14, spread: 10 });
      c.save(); c.translate(0, 760); paintRiceRow(c, W, 340, 9, 500, .9, '#6a3a3a', '#4a2a3a'); c.restore();
    });
  },
  draw(ctx, lt, t) {
    ctx.drawImage(this.bg, 0, 0);
    const lean = easeInOut(inv(1.2, 3.2, lt));
    silhouette(ctx, 'girl', 820 + lean * 38, 690 - lean * 6, 1.25, 1, '#2b1b2b', '#ffb070');
    silhouette(ctx, 'boy', 1100 - lean * 44, 670, 1.32, -1, '#24161f', '#ffb070');
    // a flock of sparrows lifts off the field and crosses the sun
    const fly = inv(3.0, 6.4, lt);
    if (fly > 0) for (let k = 0; k < 16; k++) {
      const r = rng(k + 40), q = clamp(fly * 1.4 - r() * .4);
      if (q <= 0) continue;
      const x = lerp(200 + r() * 700, 1300 + r() * 800, q), y = lerp(1000, 300 + r() * 400, easeOut(q)) + Math.sin(t * 3 + k) * 20;
      const s = 1 + r() * .7, f = Math.sin(t * 16 + k * 1.3);
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = '#2a1a26';
      ctx.beginPath(); ctx.moveTo(-26, -f * 18); ctx.quadraticCurveTo(-12, -6, 0, 0); ctx.quadraticCurveTo(12, -6, 26, -f * 18); ctx.quadraticCurveTo(12, 2, 0, 6); ctx.quadraticCurveTo(-12, 2, -26, -f * 18); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, 3, 9, 5, 0, 0, TAU); ctx.fill(); ctx.restore();
    }
    fallers(ctx, t, { n: 18, seed: 66, v: 30, sway: 50, draw: (c, x, y, i) => { c.save(); c.globalAlpha = .8; drawBlossom(c, x, y, 7, t * .5 + i, { col: '#ffe6c8' }); c.restore(); } });
  },
});

// ------------------------------------------------------------------
// 23–25. Summer's end: the bus stop in the rain. She leaves.
// ------------------------------------------------------------------
function paintBusStop(ctx) {
  paintSky(ctx, W, H, { seed: 121, top: '#6f7f98', mid: '#98a6b6', low: '#b9c2cb', blots: 60 });
  wash(ctx, [[-40, 640], [500, 600], [1100, 630], [1960, 590], [1960, 760], [-40, 760]], '#6f8a86', { seed: 122, layers: 10, alpha: .1, spread: 10 });
  const g = ctx.createLinearGradient(0, 760, 0, H); g.addColorStop(0, '#7d858c'); g.addColorStop(1, '#565e66');
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = g; ctx.fillRect(0, 740, W, H - 740); ctx.restore();
  // shelter
  shape(ctx, SH([[200, 330], [900, 300], [920, 350], [190, 380]]), '#5f7f8f', { seed: 123, still: true, gran: .3 });
  for (const x of [240, 860]) shape(ctx, RECT(x - 10, 360, 20, 480), '#4a4a4a', { seed: 124 + x, still: true });
  shape(ctx, RECT(300, 690, 500, 26), '#8a6a52', { seed: 126, still: true });
  // bus stop sign
  ink(ctx, [[1080, 850], [1080, 380]], { w: 7, still: true, seed: 127, col: '#555' });
  shape(ctx, ellipsePts(1080, 360, 56, 56, 20), '#e9e3d6', { seed: 128, still: true });
  inkShape(ctx, ellipsePts(1080, 360, 44, 44, 20), { w: 3, still: true, seed: 129, col: '#3f7f6a' });
  ctx.font = '44px LongCang'; ctx.fillStyle = '#3f7f6a'; ctx.fillText('站', 1058, 376);
  paintLeafClump(ctx, 1650, 640, 330, 170, 130, { leaf: 14 }); paintBlossomsOn(ctx, 1650, 630, 300, 140, 131, 20, 8);
}
SHOT('busstop', 217.3, 224.0, {
  tin: { type: 'dipblack', dur: .7 },
  grade: { tint: '#6f88aa', amt: .22, vig: .65 },
  lyr: { x: 1420, y: 230, size: 124, style: 'light' },
  init() { this.bg = cached('busstop:bg', W, H, c => paintBusStop(c)); },
  draw(ctx, lt, t) {
    ctx.drawImage(this.bg, 0, 0);
    // suitcase
    shape(ctx, RECT(430, 800, 120, 145), '#9a5a4a', { seed: 141, lw: 3 });
    ink(ctx, [[460, 800], [465, 772], [510, 772], [515, 800]], { w: 5, seed: 142 });
    // the two, side by side, facing each other a little
    const give = easeInOut(inv(2.0, 3.6, lt));
    const gp = { thighA: 0, shinA: 0, thighB: .05, shinB: .05, armA: .5 + give * .5, foreA: 1.2 + give * .5, armB: .15, foreB: -.1, headTilt: .1 };
    drawBody(ctx, 600, 950, 1.1, gp, { who: 'girl', t, facing: 1 });
    const bp = { thighA: 0, shinA: 0, thighB: -.05, shinB: -.05, armA: .2 + give * .6, foreA: .5 + give * 1.0, armB: .1, foreB: .3, headTilt: .12 };
    drawBody(ctx, 920, 950, 1.15, bp, { who: 'boy', t, facing: -1 });
    // the sprig passes from her hand to his
    const ha = gp._handAW || [660, 760], hb = bp._handAW || [800, 700];
    const sx = lerp(ha[0], hb[0], give), sy = lerp(ha[1], hb[1], give) - 10;
    ink(ctx, [[sx, sy + 30], [sx + 6, sy - 40]], { w: 3, col: '#5a6a3a', seed: 143 });
    for (let k = 0; k < 5; k++) drawBlossom(ctx, sx + 4 + (k - 2) * 9, sy - 44 - (k % 2) * 8, 7, k);
    drawRain(ctx, t, { n: 320, col: 'rgba(225,235,245,.5)', len: 60, speed: 1500, ang: .12 });
  },
});
SHOT('busleave', 224.0, 230.6, {
  tin: { type: 'cut', dur: 0 },
  grade: { tint: '#6f88aa', amt: .22, vig: .65 },
  lyr: { x: 1500, y: 230, size: 120, style: 'light' },
  init() { this.bg = cached('busleave:bg', W, H, c => paintBusStop(c)); },
  draw(ctx, lt, t) {
    ctx.drawImage(this.bg, 0, 0);
    const arrive = easeOut(inv(0, 2.2, lt)), depart = easeIn(inv(4.0, 6.6, lt));
    const bx = lerp(2600, 1100, arrive) - depart * 2200;
    drawBus(ctx, bx, 900, 1.05, t, { spin: -(bx / 66), lit: 1, face: (c, x, y) => { if (lt > 2.6) drawPortrait(c, x, y + 20, .42, { who: 'girl', turn: .4, eyes: 'open', mouth: 'small', look: [1, 0], blush: .4 }); }, faceWin: 2 });
    // the boy stays at the stop, in front of the bus
    drawBody(ctx, 860 + (depart > 0 ? -depart * 60 : 0), 1010, 1.15, Object.assign(depart > 0 ? walkPose(t * 6, .6) : { armA: .6, foreA: 1.6, armB: .1, foreB: .4 }, { headTilt: -.08 }), { who: 'boy', t, facing: 1 });
    // leaves blown by the passing bus
    fallers(ctx, t, { n: 14, seed: 77, v: 90, sway: 90, wind: depart * 2, draw: (c, x, y, i, r) => drawLeaf(c, x, y, 18, t * 3 + i, mix('#b98a3a', '#e0a040', r), { seed: i }) });
    drawRain(ctx, t, { n: 300, col: 'rgba(225,235,245,.5)', len: 60, speed: 1500, ang: .12 });
  },
});
SHOT('buswindow', 230.6, 238.2, {
  tin: { type: 'cut', dur: 0 },
  grade: { tint: '#7a8fb2', amt: .22, vig: .7 },
  lyr: { x: 1450, y: 900, size: 124, style: 'light' },
  lyrL: { x: 1420, y: 990, style: 'ink', halo: true },
  init() { this.bg = cached('buswindow:bg', 3800, H, c => { paintRainStreet(c, 1900, H); c.drawImage(c.canvas, 0, 0, 1900, H, 1900, 0, 1900, H); }); },
  draw(ctx, lt, t) {
    // outside world sliding past the bus window
    const sp = easeIn(inv(0, 3, lt)) * 1 + inv(3, 7.6, lt);
    const off = (sp * 900) % 1900;
    ctx.drawImage(this.bg, off, 0, W, H, 0, 0, W, H);
    ctx.save(); ctx.globalAlpha = .3; ctx.fillStyle = '#dfe6ee'; ctx.fillRect(0, 0, W, H); ctx.restore();
    // the tiny boy outside, left behind
    const bx = 1500 - sp * 1300;
    if (bx > -100) { ctx.save(); ctx.globalAlpha = .8; drawBackView(ctx, bx, 900, .45, { who: 'boy', armR: [[54, -250], [90, -330]] }); ctx.restore(); }
    // her reflection-close portrait on the inside of the glass
    drawPortrait(ctx, 900, 560, 1.45, { who: 'girl', turn: -.55, tilt: -.06, eyes: lt > 4.5 ? 'closed' : 'open', look: [-1, 0], mouth: 'small', blush: .5 });
    // tears: a single glint
    if (lt > 4.5) { ctx.save(); ctx.globalAlpha = .8; drop(ctx, 830, 620 + (lt - 4.5) * 60, 6, '#e6f0ff'); ctx.restore(); }
    // her hand on the glass and a heart drawn in the fog

    ctx.save(); ctx.globalAlpha = .28; ctx.fillStyle = '#e9eef4'; ctx.fillRect(0, 0, W, H); ctx.restore(); // fogged glass
    const hp = inv(1.0, 2.6, lt);
    if (hp > 0) {
      const cx = 420, cy = 420, hs = 70, heart = [];
      for (let k = 0; k <= 40; k++) { const a = k / 40 * TAU; heart.push([cx + hs * Math.pow(Math.sin(a), 3), cy - hs * (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 16]); }
      ctx.save(); ctx.globalCompositeOperation = 'screen'; pencil(ctx, heart, { col: '#b8c8da', w: 14, progress: hp, alpha: .9, still: true }); ctx.restore();
    }
    drawGlassDrops(ctx, t, { n: 90, seed: 21, tint: 'rgba(240,245,252,.55)' });
    // streaks from the motion
    ctx.save(); ctx.strokeStyle = 'rgba(230,240,250,.35)'; ctx.lineWidth = 2; const r = rng(3);
    for (let i = 0; i < 40; i++) { const y = r() * H, x = (r() * W + t * 400 * sp) % W; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 80 - r() * 60, y + 10); ctx.stroke(); }
    ctx.restore();
  },
});
SHOT('alone', 238.2, 243.6, {
  tin: { type: 'fade', dur: .6 },
  grade: { tint: '#5f7aa0', amt: .25, vig: .75 },
  lyr: { x: 1420, y: 240, size: 124, style: 'light' },
  init() { this.bg = cached('alone:bg', W, H, c => paintRainStreet(c, W, H)); },
  draw(ctx, lt, t) {
    ctx.drawImage(this.bg, 0, 0);
    // bus taillights far away
    const f = 1 - inv(0, 5, lt);
    blot(ctx, 1500, 640, 60, '#ff6a50', .8 * f, 'screen'); blot(ctx, 1530, 640, 60, '#ff6a50', .8 * f, 'screen');
    // him alone from behind, holding the sketchbook against his chest (the sprig in hand)
    drawBackView(ctx, 900, 1010, 1.5, { who: 'boy', wetShoulder: .9, wetSide: 1, armL: [[-62, -262], [-40, -190]], armR: [[62, -262], [40, -190]] });
    ctx.save(); ctx.globalAlpha = .22; ctx.translate(0, 2040); ctx.scale(1, -1); drawBackView(ctx, 900, 1010, 1.5, { who: 'boy' }); ctx.restore();
    drawRain(ctx, t, { n: 360, col: 'rgba(225,235,245,.55)', len: 70, speed: 1600, ang: .1 });
  },
});

// ------------------------------------------------------------------
// 26. "All night... my love drains away like the rain": the painting melts.
// ------------------------------------------------------------------
SHOT('melt', 243.6, 252.0, {
  tin: { type: 'cut', dur: 0 },
  grade: { tint: '#6a86ad', amt: .18, vig: .7 },
  lyr: { x: 960, y: 560, size: 140, style: 'ink', halo: false },
  init() {
    const alone = SHOTS.find(s => s.id === 'alone');
    if (!alone._init) { alone.init(); alone._init = true; }
    this.src = cached('melt:src', W, H, c => { frozen(() => alone.draw(c.getContext ? c : c, 5.3, 243.5)); });
  },
  draw(ctx, lt, t) {
    ctx.drawImage(TEX.paper, 0, 0);
    const p = inv(0.3, 7.2, lt);
    // vertical strips slide down at different speeds, fading as pigment runs off the page
    const sw = 4;
    for (let x = 0; x < W; x += sw) {
      const n = noise1(x * .0035, 3) * .5 + .5, n2 = noise1(x * .02, 4) * .5 + .5;
      const d = Math.pow(p, 1.5) * (380 + 950 * n) + p * 30 * n2;
      const a = clamp(1 - p * (0.55 + n * .75));
      if (a <= 0) continue;
      ctx.globalAlpha = a * .55; ctx.drawImage(this.src, x, 0, sw, H, x, d * .82, sw, H);
      ctx.globalAlpha = a; ctx.drawImage(this.src, x, 0, sw, H, x, d, sw, H);
      if (p > .05) { ctx.globalAlpha = a * .35; ctx.drawImage(this.src, x, 0, sw, 6, x, 0, sw, d); } // pigment trail
    }
    ctx.globalAlpha = 1;
    // watery blooms where the pigment pools at the bottom
    for (let k = 0; k < 8; k++) blot(ctx, 120 + k * 240, H - 40, 200 * p, k % 2 ? '#7f95b5' : '#9aa7b8', .25 * p * (1 - inv(5, 8, lt)), 'multiply');
  },
});

// ------------------------------------------------------------------
// 27. On the blank page a butterfly is sketched — pages fly like chapters.
// ------------------------------------------------------------------
SHOT('paperfly', 252.0, 258.0, {
  tin: { type: 'cut', dur: 0 },
  grade: { tint: '#ffe0b0', amt: .15, vig: .55 },
  lyr: { x: 960, y: 900, size: 116 },
  draw(ctx, lt, t) {
    ctx.drawImage(TEX.paper, 0, 0);
    // a pencil butterfly draws itself, then takes colour and flies
    const drawP = inv(0, 1.8, lt), colP = inv(1.8, 2.6, lt), flyP = inv(2.6, 6, lt);
    const bx = 960 + Math.sin(flyP * 4) * 200 * flyP, by = 480 - flyP * 300 + Math.sin(t * 3) * 10 * flyP;
    if (colP < 1) {
      ctx.save(); ctx.translate(960, 480);
      for (const sg of [-1, 1]) {
        ctx.save(); ctx.scale(sg, 1);
        pencil(ctx, [[0, 0], [60, -120], [160, -130], [165, -50], [70, 0]], { closed: true, w: 3, progress: drawP, col: '#3d3b43', still: true });
        pencil(ctx, [[0, 0], [90, 20], [120, 80], [60, 110], [14, 55]], { closed: true, w: 3, progress: drawP, col: '#3d3b43', still: true });
        ctx.restore();
      }
      pencil(ctx, [[0, -45], [0, 80]], { w: 6, progress: drawP, still: true });
      ctx.restore();
    }
    if (colP > 0) { ctx.save(); ctx.globalAlpha = colP; drawButterfly(ctx, bx, by, 180, t, '#f2b8c6', '#e9d36f', { flap: flyP > 0 ? undefined : .9, rot: flyP > 0 ? undefined : 0 }); ctx.restore(); }
    // many paper butterflies rise from the bottom
    if (flyP > 0) for (let i = 0; i < 22; i++) {
      const r = rng(i + 90), q = clamp(flyP * 1.5 - r() * .5);
      if (q <= 0) continue;
      const x = r() * W + Math.sin(t * 2 + i) * 50, y = H + 100 - q * (H + 300) * (0.6 + r() * .6);
      drawButterfly(ctx, x, y, 30 + r() * 30, t + i, i % 3 ? '#fbf8f0' : '#f6d6de', i % 3 ? '#efe7d6' : '#f4e7a8');
    }
  },
});

// ------------------------------------------------------------------
// 28–29. Present day: the adult continues the poem and paints the last page.
// ------------------------------------------------------------------
function paintLastPage(c) {
  paperSheet(c, 0, 0, 760, 990, { col: '#f6f0e3', shadow: 0 });
  c.save(); c.beginPath(); c.rect(40, 60, 680, 700); c.clip();
  paintSky(c, 760, 760, { seed: 141, top: '#8ec5e6', mid: '#bfe0ee', low: '#f3e6c6', blots: 30 });
  paintCloud(c, 480, 160, 140, 142, { n: 5 });
  ink(c, wirePts(20, 150, 740, 170, 60), { w: 2.4, still: true, seed: 143, taper: [.01, .01], minW: .8 });
  drawSparrow(c, 300, 190, .7, 0, { seed: 3 }); drawSparrow(c, 360, 194, .7, 0, { seed: 4, flip: true });
  paintLeafClump(c, 380, 640, 330, 170, 144, { leaf: 13 }); paintBlossomsOn(c, 380, 630, 300, 140, 145, 30, 8);
  wash(c, RECT(0, 690, 760, 100), '#cdb99a', { seed: 146, layers: 8, alpha: .08, spread: 6 });
  drawBackView(c, 330, 760, .62, { who: 'girl', armR: [[56, -250], [80, -170]] });
  drawBackView(c, 430, 760, .65, { who: 'boy', armL: [[-62, -262], [-84, -176]] });
  c.restore();
  inkShape(c, RECT(40, 60, 680, 700), { w: 3, still: true, seed: 147 });
  c.font = '46px LongCang'; c.fillStyle = 'rgba(60,55,60,.8)'; c.fillText('那年夏天 · 院子里的七里香', 150, 850);
}
SHOT('present', 258.0, 265.4, {
  tin: { type: 'wash', dur: 1.0 },
  grade: { tint: '#ffb561', amt: .25, vig: .65, glow: [260, 90, 900, '#ffcf8a', .35] },
  lyr: { x: 1250, y: 250, size: 116, halo: false },
  init() { this.bg = cached('present:desk', 2400, 1400, c => paintDeskScene(c)); this.words = [0, 1, 2, 3].map(k => scribbleLine(1320, 480 + k * 90, 560 - (k === 3 ? 260 : 0), 120 + k)); },
  draw(ctx, lt, t) {
    ctx.fillStyle = '#6d4a30'; ctx.fillRect(0, 0, W, H);
    ctx.save(); camera(ctx, 1500 - lt * 8, 650, 1.35, 0);
    ctx.drawImage(this.bg, 0, 0);
    dappled(ctx, t, 2400, 1400, .2);
    const wp = inv(0.2, 6.6, lt); let tip = null;
    for (let k = 0; k < 4; k++) { const q = clamp(wp * 4 - k); if (q > 0) { const tp = drawWordsProgress(ctx, this.words[k], q, { seed: k + 40 }); if (q < 1) tip = tp; } }
    if (tip) drawPencilHand(ctx, tip[0], tip[1] + Math.sin(t * 24) * 1.5, 1.05, { ang: -.5, seed: 780, watch: true, sleeveCol: '#6b7f99' });
    ctx.restore();
    dust(ctx, t, 60);
  },
});
SHOT('lastpage', 265.4, 272.0, {
  tin: { type: 'page', dur: .9 },
  grade: { tint: '#ffb561', amt: .22, vig: .6, glow: [260, 90, 900, '#ffcf8a', .35] },
  lyr: { x: 1560, y: 980, size: 118, halo: false },
  init() { this.bg = cached('lastpage:desk', 2400, 1400, c => paintDeskScene(c)); this.page = cached('lastpage:pg', 760, 990, c => paintLastPage(c)); },
  draw(ctx, lt, t) {
    ctx.fillStyle = '#6d4a30'; ctx.fillRect(0, 0, W, H);
    ctx.save(); camera(ctx, lerp(1250, 1200, lt / 6.6), 700, lerp(1.0, .92, lt / 6.6), 0);
    ctx.drawImage(this.bg, 0, 0);
    // painting revealed on the right page like watercolour blooming
    ctx.save(); ctx.translate(1200, 700); ctx.rotate(-.045);
    const M = MASK.getContext('2d'); M.setTransform(1, 0, 0, 1, 0, 0); M.clearRect(0, 0, 760, 990);
    const p = inv(0, 3.2, lt), r = rng(9);
    for (let k = 0; k < 9; k++) { const x = r() * 760, y = r() * 990, rad = easeOut(clamp(p * 1.4 - k * .05)) * 700; if (rad > 1) { polyPath(M, deform(ellipsePts(x, y, rad, rad, 14), 3, rad * .1, rng(k))); M.fill(); } }
    M.globalCompositeOperation = 'source-in'; M.drawImage(this.page, 0, 0); M.globalCompositeOperation = 'source-over';
    ctx.drawImage(MASK, 0, 0, 760, 990, 10, -500, 760, 990);
    ctx.restore();
    dappled(ctx, t, 2400, 1400, .2);
    ctx.restore();
    dust(ctx, t, 60);
  },
});

// ------------------------------------------------------------------
// 30. Outro: out of the window, sparrows on the wire again. End card.
// ------------------------------------------------------------------
SHOT('outro', 272.0, 284.0, {
  tin: { type: 'fade', dur: 1.4 },
  grade: { tint: '#ffd08a', amt: .2, vig: .5, glow: [300, 100, 900, '#fff0c8', .5] },
  init() { this.bg = cached('outro:bg', W, H, c => paintWindowSky(c, { seed: 151 })); },
  draw(ctx, lt, t) {
    const z = 1.12 - lt * .008;
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
    ctx.drawImage(this.bg, 0, 0);
    const wy = x => 470 + x * .08;
    ink(ctx, [[-50, wy(-50)], [W / 2, wy(W / 2) + 30], [W + 50, wy(W + 50)]], { w: 5, col: '#2f2a28', seed: 91, amp: .5, taper: [.01, .01], minW: .8 });
    for (const [bx, sd, arrive] of [[760, 11, .5], [1040, 12, 2.2], [1300, 13, 4]]) {
      const y = wy(bx) + 28 * (1 - Math.pow(Math.abs(bx - W / 2) / (W / 2), 2)) - 78;
      const a = easeOut(clamp((lt - arrive) / .8));
      if (a <= 0) continue;
      drawSparrow(ctx, bx + (1 - a) * 500, y - (1 - a) * 200, 3.0, t, { fly: a < 1, flip: sd % 2 === 1, look: Math.sin(t + sd) * .6, seed: sd, beak: a >= 1 && Math.sin(t * 3 + sd) > .8 ? 1 : 0 });
    }
    ctx.restore();
    drawWindowFrame(ctx, t, {});
    fallers(ctx, t, { n: 20, seed: 101, v: 35, sway: 70, draw: (c, x, y, i) => drawBlossom(c, x, y, 9, t * .5 + i) });
  },
});
SHOT('endcard', 284.0, 297.2, {
  tin: { type: 'dip', dur: 1.6 },
  grade: { tint: '#ffd08a', amt: .15, vig: .6 },
  draw(ctx, lt, t) {
    ctx.drawImage(TEX.paper, 0, 0);
    writeText(ctx, META.title, 960, 500, 'MaShan', Math.min(230, 1100 / Math.max(1, [...META.title].length)), .6, .7, lt, { align: 'center', col: '#2d2a2e', dur: .9, double: true });
    for (let k = 0; k < 9; k++) { const q = clamp((lt - 2.8 - k * .1) / .5); if (q > 0) drawBlossom(ctx, 700 + k * 65, 580 + Math.sin(k * 1.7) * 14, 15 * easeOutBack(q), k + t * .1); }
    writeText(ctx, META.credits.filter(Boolean).join('　　'), 960, 700, 'LongCang', 56, 3.6, .07, lt, { align: 'center', col: '#4a4540' });
    writeText(ctx, [META.tagline, '纸上的那年夏天'].filter(Boolean).join(' · '), 960, 790, 'LongCang', 42, 5.2, .05, lt, { align: 'center', col: '#8a7f73' });
    drawSparrowDoodle(ctx, 1320, 420 + Math.abs(Math.sin(t * 5)) * -8, 50, t, '#3a3740');
  },
});

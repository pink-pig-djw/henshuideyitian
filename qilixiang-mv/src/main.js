// main.js — timeline, transitions, grading, post-processing, preview & render API.
'use strict';
const CANVAS = document.getElementById('c');
const OUT = CANVAS.getContext('2d');
const LAYER_A = makeCanvas(W, H), LAYER_B = makeCanvas(W, H), MASK = makeCanvas(W, H);
const LA = LAYER_A.getContext('2d'), LB = LAYER_B.getContext('2d'), MK = MASK.getContext('2d');
const DURATION = 297.2;
let BEATS = [];

async function loadFonts() {
  const faces = [
    new FontFace('WenKai', 'url(assets/fonts/LXGWWenKai-Medium.ttf)'),
    new FontFace('MaShan', 'url(assets/fonts/MaShanZheng-Regular.ttf)'),
    new FontFace('LongCang', 'url(assets/fonts/LongCang-Regular.ttf)'),
  ];
  for (const f of faces) { await f.load(); document.fonts.add(f); }
  await document.fonts.ready;
}

// beat pulse: 1 on a beat, decays quickly
function beatPulse(t, decay = 7) {
  let lo = 0, hi = BEATS.length - 1;
  if (!BEATS.length || t < BEATS[0]) return 0;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (BEATS[m] <= t) lo = m; else hi = m - 1; }
  return Math.exp(-(t - BEATS[lo]) * decay);
}
function beatIndex(t) {
  let n = 0; for (const b of BEATS) { if (b <= t) n++; else break; } return n;
}

function shotAt(t) {
  for (let i = 0; i < SHOTS.length; i++) if (t < SHOTS[i].t1) return i;
  return SHOTS.length - 1;
}

function drawShot(i, ctx, t) {
  const s = SHOTS[i];
  if (!s._init) { s.init && s.init(); s._init = true; }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  s.draw(ctx, t - s.t0, t, s);
  ctx.restore();
  s._last = t;
}

// release caches of shots that are well behind the playhead
function housekeeping(t) {
  for (const s of SHOTS) {
    if (s._init && (t > s.t1 + 3 || t < s.t0 - 3)) {
      s.dispose && s.dispose(); dropCache(s.id + ':'); s._init = false;
    }
  }
}

// ---------- transitions ----------
function transMask(type, p, seed) {
  MK.setTransform(1, 0, 0, 1, 0, 0);
  MK.globalCompositeOperation = 'source-over';
  MK.clearRect(0, 0, W, H);
  MK.fillStyle = '#000';
  if (type === 'wash') {
    // watercolor bloom: ragged blobs growing from a few seeds
    const r = rng(seed);
    const n = 7;
    for (let k = 0; k < n; k++) {
      const x = r() * W, y = r() * H, d = r() * .35;
      const rad = easeInOut(inv(d, d + .65, p)) * 1300 * (0.8 + r() * .5);
      if (rad <= 1) continue;
      const poly = deform(ellipsePts(x, y, rad, rad * (0.8 + r() * .4), 14), 3, rad * .12, rng(seed + k));
      polyPath(MK, poly); MK.fill();
    }
  } else if (type === 'sketch') {
    // pencil scribbles accumulate until the frame is covered
    const r = rng(seed); const n = 90;
    MK.lineCap = 'round'; MK.strokeStyle = '#000';
    for (let k = 0; k < n; k++) {
      const d = k / n * .75, q = inv(d, d + .25, p);
      if (q <= 0) continue;
      const y = r() * H, x = r() * W, a = -.5 + r() * .3, l = 900 + r() * 900;
      MK.lineWidth = 60 + r() * 120;
      MK.beginPath(); MK.moveTo(x - Math.cos(a) * l / 2, y - Math.sin(a) * l / 2);
      MK.lineTo(x - Math.cos(a) * l / 2 + Math.cos(a) * l * q, y - Math.sin(a) * l / 2 + Math.sin(a) * l * q);
      MK.stroke();
    }
    if (p > .9) { MK.globalAlpha = inv(.9, 1, p); MK.fillRect(0, 0, W, H); MK.globalAlpha = 1; }
  } else if (type === 'iris') {
    const rad = easeInOut(p) * 1200;
    const poly = deform(ellipsePts(W / 2, H / 2, rad, rad, 16), 2, rad * .08, rng(seed));
    polyPath(MK, poly); MK.fill();
  }
}

function composite(type, p, A, B, seed) {
  OUT.save();
  OUT.setTransform(1, 0, 0, 1, 0, 0);
  if (type === 'fade') {
    OUT.drawImage(A, 0, 0); OUT.globalAlpha = smooth(p); OUT.drawImage(B, 0, 0);
  } else if (type === 'dip' || type === 'dipblack' || type === 'flash') {
    const col = type === 'dipblack' ? '#0b0a09' : type === 'flash' ? '#fffaf0' : '#f4eee2';
    if (p < .5) { OUT.drawImage(A, 0, 0); OUT.globalAlpha = smooth(p * 2); }
    else { OUT.drawImage(B, 0, 0); OUT.globalAlpha = smooth((1 - p) * 2); }
    OUT.fillStyle = col; OUT.fillRect(0, 0, W, H);
  } else if (type === 'page') {
    // page turn from right to left: old page lifts, curls, reveals new page
    const e = easeInOut(p), edge = W * (1 - e) + 40 * Math.sin(Math.PI * e);
    const curl = Math.min(edge, 220 * Math.sin(Math.PI * e) + 20);
    OUT.drawImage(B, 0, 0);
    // shadow of the lifting page onto the new page
    const sg = OUT.createLinearGradient(edge, 0, edge + 160, 0);
    sg.addColorStop(0, 'rgba(40,28,18,0.35)'); sg.addColorStop(1, 'rgba(40,28,18,0)');
    OUT.fillStyle = sg; OUT.fillRect(edge, 0, 160, H);
    OUT.save(); OUT.beginPath(); OUT.rect(0, 0, Math.max(0, edge - curl), H); OUT.clip(); OUT.drawImage(A, 0, 0); OUT.restore();
    // back of the page (curl)
    const cg = OUT.createLinearGradient(edge - curl, 0, edge, 0);
    cg.addColorStop(0, '#d9cfbd'); cg.addColorStop(.55, '#f7f1e6'); cg.addColorStop(1, '#e6dccb');
    OUT.fillStyle = cg; OUT.fillRect(edge - curl, 0, curl, H);
    OUT.globalAlpha = .5; OUT.drawImage(TEX.paper, edge - curl, 0, curl, H, edge - curl, 0, curl, H); OUT.globalAlpha = 1;
    OUT.strokeStyle = 'rgba(60,45,30,.35)'; OUT.lineWidth = 2;
    OUT.beginPath(); OUT.moveTo(edge, 0); OUT.lineTo(edge, H); OUT.stroke();
  } else if (type === 'whip') {
    const e = easeInOut(p);
    OUT.globalAlpha = 1;
    OUT.drawImage(A, -e * W, 0);
    OUT.drawImage(B, W - e * W, 0);
    // motion streaks
    OUT.globalAlpha = Math.sin(Math.PI * p) * .5; OUT.fillStyle = '#f4eee2';
    const r = rng(seed + Math.floor(p * 20));
    for (let k = 0; k < 40; k++) OUT.fillRect(0, r() * H, W, 1 + r() * 3);
  } else if (type === 'wash' || type === 'sketch' || type === 'iris') {
    OUT.drawImage(A, 0, 0);
    transMask(type, p, seed);
    // B through the mask
    const tmp = LAYER_B.getContext('2d');
    tmp.save(); tmp.setTransform(1, 0, 0, 1, 0, 0); tmp.globalCompositeOperation = 'destination-in'; tmp.drawImage(MASK, 0, 0); tmp.restore();
    OUT.drawImage(LAYER_B, 0, 0);
  } else { // cut
    OUT.drawImage(p < .5 ? A : B, 0, 0);
  }
  OUT.restore();
}

// ---------- grading / post ----------
let VIGNETTE;
function buildPost() {
  VIGNETTE = makeCanvas(W, H);
  const v = VIGNETTE.getContext('2d');
  const g = v.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, H * 1.05);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(120,100,85,1)');
  v.fillStyle = g; v.fillRect(0, 0, W, H);
}
function grade(ctx, g, t) {
  if (!g) g = {};
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (g.tint) { ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = g.amt ?? .25; ctx.fillStyle = g.tint; ctx.fillRect(0, 0, W, H); }
  if (g.mul) { ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = g.mulAmt ?? .2; ctx.fillStyle = g.mul; ctx.fillRect(0, 0, W, H); }
  if (g.glow) { // warm light leak from a corner
    ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 1;
    const [gx, gy, gr, gc, ga] = g.glow;
    blot(ctx, gx, gy, gr, gc, ga * (0.85 + 0.15 * Math.sin(t * 1.3)), 'screen');
  }
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = g.vig ?? .55; ctx.drawImage(VIGNETTE, 0, 0);
  ctx.restore();
}

function render(t) {
  setTime(t);
  housekeeping(t);
  const i = shotAt(t), s = SHOTS[i];
  let A = -1, B = -1, p = 0, type = 'cut';
  const next = SHOTS[i + 1], prev = SHOTS[i - 1];
  if (next && next.tin && next.tin.type !== 'cut' && t > next.t0 - next.tin.dur / 2) {
    A = i; B = i + 1; type = next.tin.type; p = (t - (next.t0 - next.tin.dur / 2)) / next.tin.dur;
  } else if (prev && s.tin && s.tin.type !== 'cut' && t < s.t0 + s.tin.dur / 2) {
    A = i - 1; B = i; type = s.tin.type; p = (t - (s.t0 - s.tin.dur / 2)) / s.tin.dur;
  }
  OUT.setTransform(1, 0, 0, 1, 0, 0);
  if (A < 0) {
    drawShot(i, OUT, t);
  } else {
    drawShot(A, LA, t); drawShot(B, LB, t);
    composite(type, clamp(p), LAYER_A, LAYER_B, B * 31 + 7);
  }
  // grade blends between shots during transitions
  const gs = A < 0 ? s : (p < .5 ? SHOTS[A] : SHOTS[B]);
  grade(OUT, gs.grade, t);
  LYR.draw(OUT, t);
  // paper grain over everything, like ink and paint on the same sheet
  OUT.save(); OUT.setTransform(1, 0, 0, 1, 0, 0);
  OUT.globalCompositeOperation = 'multiply'; OUT.globalAlpha = .85; OUT.drawImage(TEX.grain, 0, 0);
  // subtle projector flicker on twos
  const fl = (hash(K.boil * 7 + 1) - .5) * .025;
  if (fl > 0) { OUT.globalCompositeOperation = 'screen'; OUT.globalAlpha = fl; OUT.fillStyle = '#fff4e0'; OUT.fillRect(0, 0, W, H); }
  // global fades
  const fin = inv(0.6, 2.6, t), fout = inv(DURATION - 0.2, DURATION - 3.2, t);
  const f = Math.min(fin, fout);
  if (f < 1) { OUT.globalCompositeOperation = 'source-over'; OUT.globalAlpha = 1 - f; OUT.fillStyle = '#0b0a09'; OUT.fillRect(0, 0, W, H); }
  OUT.restore();
}

// ---------- API ----------
const MV = window.MV = { duration: DURATION };
MV.ready = (async () => {
  await loadFonts();
  const [timing, keywords, analysis] = await Promise.all([
    fetch('input/timing.json').then(r => r.json()),
    fetch('input/keywords.json').then(r => r.json()).catch(() => ({})),
    fetch('input/analysis.json').then(r => r.json()).catch(() => ({ beats: [] })),
  ]);
  BEATS = analysis.beats || [];
  buildTextures(); buildPost();
  LYR.init(timing, keywords);
  return true;
})();
MV.render = render;
MV.frame = t => { render(t); return CANVAS.toDataURL('image/jpeg', 0.94).split(',')[1]; };
MV.still = t => { render(t); return CANVAS.toDataURL('image/png').split(',')[1]; };

// ---------- interactive preview ----------
(function preview() {
  const params = new URLSearchParams(location.search);
  if (params.has('render')) { document.body.classList.add('render'); return; }
  const audio = document.getElementById('audio'), play = document.getElementById('play');
  const seek = document.getElementById('seek'), time = document.getElementById('time');
  let dragging = false;
  play.onclick = () => { if (audio.paused) { audio.play(); play.textContent = '暂停'; } else { audio.pause(); play.textContent = '播放'; } };
  seek.oninput = () => { dragging = true; audio.currentTime = +seek.value; };
  seek.onchange = () => { dragging = false; };
  MV.ready.then(() => {
    if (params.has('t')) audio.currentTime = +params.get('t');
    const loop = () => {
      const t = audio.currentTime;
      render(t);
      if (!dragging) seek.value = t;
      time.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      requestAnimationFrame(loop);
    };
    loop();
  });
})();

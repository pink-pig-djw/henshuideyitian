// lyrics.js — handwritten lyric typography, timed per character to the vocal.
// Two display modes:
//   lines     every sung line is written on screen, character by character
//   keywords  only marked words of each line are written, like notes in a sketchbook
// Lines come from the studio (user-imported lyrics) or from input/*.json in the CLI.
'use strict';
const LYR = (() => {
  let lines = [], items = [];
  const OPT = { reveal: 'line', mode: 'lines', position: 'scene', doodles: true, pencil: false, scale: 1, font: 'WenKai', offset: 0 };
  const DEF = { x: W / 2, y: 940, align: 'center', size: 104, style: 'ink', track: 0.05, rot: 0 };
  const MARGIN = 110, LINE_H = 1.24;
  const MC = makeCanvas(8, 8).getContext('2d');
  const blank = c => !c || c.trim() === '';

  function init(ls) { lines = Array.isArray(ls) ? ls : []; build(); }
  function setOptions(o) { Object.assign(OPT, o || {}); build(); }
  function fontFamily() { return `${OPT.font}, WenKai, "LXGW WenKai TC", "Kaiti SC", STKaiti, KaiTi, serif`; }

  function build() {
    items = [];
    const anyKw = lines.some(l => l && l.kw && l.kw.length);
    const mode = OPT.mode === 'keywords' && anyKw ? 'keywords' : 'lines';
    const off = OPT.offset || 0;
    lines.forEach((l, i) => {
      if (!l || !l.chars || !l.chars.length) return;
      let chars = [];
      if (mode === 'keywords') {
        if (!l.kw || !l.kw.length) return;
        l.kw.forEach(([a, n], k) => {
          const part = l.chars.slice(a, a + n);
          if (!part.length) return;
          if (k && chars.length) chars.push({ c: ' ', t: part[0].t });
          chars.push(...part);
        });
      } else chars = l.chars.slice();
      chars = chars.map(c => ({ c: c.c, t: c.t + off }));
      while (chars.length && blank(chars[0].c)) chars.shift();
      while (chars.length && blank(chars[chars.length - 1].c)) chars.pop();
      if (!chars.length) return;
      const vis = chars.filter(c => !blank(c.c));
      const lineVis = l.chars.filter(c => !blank(c.c));
      items.push({ i, mode, text: chars.map(c => c.c).join(''), chars, first: vis[0].t, last: vis[vis.length - 1].t,
        lineLast: (lineVis.length ? lineVis[lineVis.length - 1].t : vis[vis.length - 1].t - off) + off });
    });
    items.sort((a, b) => a.first - b.first);
    items.forEach((f, k) => {
      const nx = items[k + 1];
      f.in = f.first - 0.42;
      f.push = null;
      if (f.mode === 'keywords') {
        const natural = Math.max(f.lineLast + 1.2, f.last + 1.6);
        f.out = nx ? Math.min(natural, nx.first - 0.3) : natural + 1.5;
        f.out = Math.max(f.out, f.last + 0.6);
      } else {
        const natural = Math.max(f.last + 1.2, Math.min(f.last + 3.2, nx ? nx.first - 0.25 : 1e9));
        if (nx && nx.first - 0.42 < natural) f.push = nx.first - 0.42;
        f.out = f.push != null ? Math.max(f.last + 0.35, f.push + 0.45) : (nx ? Math.min(natural, nx.first - 0.42 + 0.2) : natural + 1.5);
      }
      f.rnd = f.chars.map((c, j) => { const r = rng(f.i * 100 + j + 7); return { rot: (r() - .5) * .08, dy: (r() - .5) * 8, ds: (r() - .5) * .07 }; });
      f.L = null;
    });
  }

  function styleFor(f) {
    const s = SHOTS[shotAt(f.first + 0.05)];
    const st = Object.assign({}, DEF, s.lyr || {});
    if (f.mode === 'lines') {
      Object.assign(st, s.lyrL || {});
      if (!(s.lyrL && s.lyrL.size)) st.size = clamp(st.size * .68, 66, 82);
      if (OPT.position === 'bottom') Object.assign(st, { x: W / 2, y: 1000, align: 'center', rot: 0 });
    }
    st.size *= OPT.scale || 1;
    return st;
  }

  // positions for every character, wrapped into at most two rows and kept inside the frame
  function layout(f) {
    if (f.L) return f.L;
    const st = styleFor(f), fam = fontFamily(), maxW = W - MARGIN * 2;
    const measure = sz => {
      MC.font = `${sz}px ${fam}`;
      const gap = sz * st.track;
      return f.chars.map(c => blank(c.c) ? sz * .5 : MC.measureText(c.c).width + gap);
    };
    const rowWidth = (w, a, b) => w.slice(a, b).reduce((x, y) => x + y, 0);
    let size = st.size, w = measure(size), n = f.chars.length;
    let rows = [[0, n]];
    if (rowWidth(w, 0, n) > maxW && n > 4) {
      // break at the space nearest the middle, otherwise at the middle character
      const mid = rowWidth(w, 0, n) / 2;
      let best = -1, bestD = 1e9, acc = 0;
      for (let k = 1; k < n; k++) { acc += w[k - 1]; if (blank(f.chars[k].c) && Math.abs(acc - mid) < bestD) { bestD = Math.abs(acc - mid); best = k; } }
      if (best < 0) { acc = 0; for (let k = 1; k < n; k++) { acc += w[k - 1]; if (Math.abs(acc - mid) < bestD) { bestD = Math.abs(acc - mid); best = k; } } }
      let b2 = best; while (b2 < n && blank(f.chars[b2].c)) b2++;
      rows = [[0, best], [b2, n]];
    }
    const widest = Math.max(...rows.map(([a, b]) => rowWidth(w, a, b)));
    if (widest > maxW) { size *= maxW / widest; w = measure(size); }
    const lh = size * LINE_H;
    // rows grow upward when the anchor sits in the lower half of the frame
    const y0 = st.y > H * .55 ? st.y - (rows.length - 1) * lh : st.y;
    const xs = new Array(n).fill(0), ys = new Array(n).fill(0), R = [];
    rows.forEach(([a, b], r) => {
      const rw = rowWidth(w, a, b) - size * st.track;
      let x = st.align === 'center' ? st.x - rw / 2 : st.align === 'right' ? st.x - rw : st.x;
      x = clamp(x, MARGIN, Math.max(MARGIN, W - MARGIN - rw));
      const y = clamp(y0 + r * lh, size * 1.1, H - size * .35);
      R.push({ a, b, y, x0: x });
      for (let k = a; k < b; k++) { xs[k] = x; ys[k] = y; x += w[k]; }
    });
    f.L = { st, size, w, xs, ys, rows: R, fam, cx: st.x, cy: y0 };
    return f.L;
  }

  function drawPencil(ctx, x, y, size, t, a) {
    ctx.save(); ctx.globalAlpha *= a;
    ctx.translate(x, y); ctx.rotate(-0.62 + noise1(t * 3, 4) * .06);
    const L = size * 1.9, R = size * .12;
    ctx.fillStyle = 'rgba(40,30,20,.18)'; ctx.fillRect(R * .6, R * .4 + 6, L, R * 2);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R * 2.2, -R); ctx.lineTo(R * 2.2, R); ctx.closePath();
    ctx.fillStyle = '#f0d3a6'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R * .8, -R * .36); ctx.lineTo(R * .8, R * .36); ctx.closePath();
    ctx.fillStyle = '#3a3840'; ctx.fill();
    ctx.fillStyle = '#f2c14e'; ctx.fillRect(R * 2.2, -R, L, R * 2);
    ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(R * 2.2, R * .25, L, R * .75);
    ctx.fillStyle = '#c9c4bb'; ctx.fillRect(R * 2.2 + L, -R, R * 1.2, R * 2);
    ctx.fillStyle = '#e88d8d'; ctx.fillRect(R * 3.4 + L, -R, R * 1.4, R * 2);
    ctx.strokeStyle = 'rgba(43,37,33,.8)'; ctx.lineWidth = 1.6;
    ctx.strokeRect(R * 2.2, -R, L + R * 2.6, R * 2);
    ctx.restore();
  }

  function draw(ctx, t) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const f of items) {
      if (t < f.in - 0.05 || t > f.out + 1.2) continue;
      const L = layout(f), st = L.st, size = L.size;
      let oy = 0;
      if (f.push != null && t > f.push) oy = -easeOut((t - f.push) / .5) * size * LINE_H * L.rows.length;
      ctx.save();
      if (st.rot) { ctx.translate(L.cx, L.cy); ctx.rotate(st.rot); ctx.translate(-L.cx, -L.cy); }
      ctx.translate(0, oy);
      ctx.font = `${size}px ${L.fam}`;
      ctx.textBaseline = 'alphabetic';
      const light = st.style === 'light';
      const col = light ? '#fbf6ea' : st.col || '#2c2a30';
      let writing = null;
      for (let k = 0; k < f.chars.length; k++) {
        const c = f.chars[k]; if (blank(c.c)) continue;
        // 'line' (default): the whole line inks in at once; 'char': written character by character
        const byLine = OPT.reveal !== 'char';
        const p = byLine ? clamp((t - (f.first - 0.32)) / 0.45) : clamp((t - (c.t - 0.12)) / 0.34);
        if (p <= 0) continue;
        const ex = clamp((t - f.out - k * (f.mode === 'lines' ? .03 : .06)) / 0.6);
        const a = smooth(p) * (1 - smooth(ex));
        if (a <= 0.003) continue;
        if (p < 1 && !byLine) writing = { x: L.xs[k] + L.w[k] * easeOut(p), y: L.ys[k] };
        const r = f.rnd[k];
        const bx = noise1(K.boil * .9 + k * 3.7, 11) * .9, by = noise1(K.boil * .9 + k * 5.1, 12) * .9;
        const x = L.xs[k] + bx, y = L.ys[k] + r.dy * (size / 104) + by - ex * 18 + (1 - easeOut(p)) * 6;
        ctx.save();
        ctx.translate(x + L.w[k] / 2, y - size * .35);
        ctx.rotate(r.rot); ctx.scale(1 + r.ds, 1 + r.ds);
        ctx.translate(-L.w[k] / 2, size * .35);
        if (p < 1 && !byLine) { ctx.beginPath(); ctx.rect(-6, -size * 1.2, (L.w[k] + 12) * easeOut(p), size * 1.6); ctx.clip(); }
        ctx.globalAlpha = a;
        if (light) {
          ctx.shadowColor = 'rgba(10,14,30,.6)'; ctx.shadowBlur = size * .17; ctx.shadowOffsetY = 3;
          ctx.fillStyle = col; ctx.fillText(c.c, 0, 0);
          ctx.shadowColor = 'transparent';
          ctx.globalAlpha = a * .3; ctx.fillText(c.c, 1, -1);
        } else {
          if (st.halo !== false || OPT.position === 'bottom') {
            ctx.shadowColor = st.haloCol || 'rgba(250,246,236,.95)'; ctx.shadowBlur = size * .21;
            ctx.fillStyle = st.haloCol || 'rgba(250,246,236,.9)'; ctx.fillText(c.c, 0, 0);
            ctx.shadowColor = 'transparent';
          }
          ctx.fillStyle = col; ctx.fillText(c.c, 0, 0);
          ctx.globalAlpha = a * .35; ctx.fillText(c.c, 1, -.8); // uneven graphite pressure
        }
        ctx.restore();
      }
      if (OPT.doodles) {
        for (const row of L.rows) {
          const frag = { text: f.text.slice(row.a, row.b), chars: f.chars.slice(row.a, row.b), w: L.w.slice(row.a, row.b), out: f.out };
          if (!frag.chars.length) continue;
          ctx.save(); ctx.translate(0, row.y);
          DOODLE.draw(ctx, frag, L.xs.slice(row.a, row.b), Object.assign({}, st, { size }), t);
          ctx.restore();
        }
      }
      if ((OPT.pencil || st.pencil) && OPT.reveal === 'char') {
        const pa = env(t, f.first - .5, f.last + .9, .35, .5);
        if (pa > 0) {
          let px, py;
          if (writing) { px = writing.x; py = writing.y; }
          else {
            const nk = f.chars.findIndex(c => !blank(c.c) && c.t - .12 > t);
            const lastK = f.chars.length - 1;
            if (nk < 0) { px = L.xs[lastK] + L.w[lastK] + (t - f.last - .2) * 260; py = L.ys[lastK]; }
            else { px = L.xs[nk]; py = L.ys[nk]; }
          }
          drawPencil(ctx, px, py - size * .12 + Math.sin(t * 20) * 2 - (writing ? 0 : 8), size, t, pa);
        }
      }
      ctx.restore();
    }
    ctx.restore();
  }
  return { init, setOptions, draw, get items() { return items; }, get options() { return Object.assign({}, OPT); } };
})();

// keyword doodles that grow out of the handwriting (drawn in the fragment's local space)
const DOODLE = (() => {
  const R = [];
  function reg(word, fn) { R.push({ word, fn }); }
  function draw(ctx, f, xs, st, t) {
    for (const d of R) {
      let idx = f.text.indexOf(d.word);
      while (idx >= 0) {
        const endK = idx + d.word.length - 1;
        const t0 = f.chars[endK].t + .1, t1 = f.out;
        if (t > t0 && t < t1 + .7) {
          const x0 = xs[idx], x1 = xs[endK] + f.w[endK];
          const p = clamp((t - t0) / .5), fade = 1 - smooth((t - t1) / .6);
          ctx.save(); ctx.globalAlpha *= fade;
          d.fn({ c: ctx, x0, x1, y: 0, s: st.size, p, lt: t - t0, t, light: st.style === 'light' });
          ctx.restore();
        }
        idx = f.text.indexOf(d.word, idx + 1);
      }
    }
  }
  const pc = o => o.light ? '#fbf6ea' : '#3a3740';
  reg('麻雀', o => { const x = lerp(o.x0, o.x1, .5) + Math.sin(o.lt * 3) * 8, hop = Math.abs(Math.sin(o.lt * 7)) * 12 * o.p;
    drawSparrowDoodle(o.c, x, o.y - o.s * 1.05 - hop, o.s * .5, o.lt, pc(o)); });
  reg('夏天', o => { const cx = o.x1 + o.s * .42, cy = o.y - o.s * .9, c = o.c, R0 = o.s * .16;
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU + o.lt * .4; pencil(c, [[cx + Math.cos(a) * R0 * 1.4, cy + Math.sin(a) * R0 * 1.4], [cx + Math.cos(a) * R0 * (1.4 + 1.1 * o.p), cy + Math.sin(a) * R0 * (1.4 + 1.1 * o.p)]], { col: '#e0902f', w: 3, seed: k, alpha: .9 }); }
    pencil(c, ellipsePts(cx, cy, R0, R0, 12), { closed: true, col: '#e0902f', w: 3, alpha: .9, progress: o.p }); });
  reg('铅笔', o => { pencil(o.c, [[o.x0, o.y + 16], [lerp(o.x0, o.x1, .3), o.y + 10], [lerp(o.x0, o.x1, .6), o.y + 18], [o.x1, o.y + 12]], { col: pc(o), w: 3, progress: o.p, alpha: .8 }); });
  reg('猫咪', o => { const c = o.c, s = o.s, pop = easeOutBack(o.p);
    const cw = (o.x1 - o.x0) / 2;
    for (const [xx, sgn] of [[o.x0 + cw * .45, -1], [o.x0 + cw * 1.55, 1]]) {
      const y = o.y - s * .84;
      polyPath(c, [[xx - s * .15, y], [xx + sgn * s * .03, y - s * .28 * pop], [xx + s * .15, y]], false);
      c.strokeStyle = pc(o); c.lineWidth = 3.4; c.lineJoin = 'round'; c.stroke();
    }
    // whiskers
    for (const sg of [-1, 1]) for (let k = -1; k <= 1; k++) pencil(c, [[sg < 0 ? o.x0 - 8 : o.x1 + 8, o.y - s * .35 + k * 10], [sg < 0 ? o.x0 - 8 - 40 * o.p : o.x1 + 8 + 40 * o.p, o.y - s * .38 + k * 16]], { col: pc(o), w: 2.2, seed: k + sg * 3, alpha: .8 }); });
  reg('草莓', o => drawStrawberry(o.c, o.x1 + o.s * .5, o.y - o.s * .45 - Math.sin(o.lt * 2.5) * 5, o.s * .36 * easeOutBack(o.p), o.lt));
  reg('雨', o => { const c = o.c, x = lerp(o.x0, o.x0 + o.s, .5);
    for (let k = 0; k < 4; k++) { const q = ((o.lt * .8 + k / 4) % 1); const yy = o.y + 10 + q * o.s * 1.0;
      c.globalAlpha = (1 - q) * .85 * o.p; drop(c, x + (k - 1.5) * o.s * .2, yy, o.s * .07, o.light ? '#d6e7f7' : '#6f9fcc'); }
    c.globalAlpha = 1; });
  reg('落叶', o => { const c = o.c;
    for (let k = 0; k < 2; k++) { const q = ((o.lt * .45 + k * .5) % 1);
      c.globalAlpha = Math.min(1, (1 - q) * 3) * o.p;
      drawLeaf(c, o.x1 + o.s * (.3 + k * .3) + Math.sin(o.lt * 2.6 + k) * 26, o.y - o.s * 1.2 + q * o.s * 1.6, o.s * .22, o.lt * 2 + k, k ? '#c9772e' : '#e0a040'); }
    c.globalAlpha = 1; });
  reg('蝴蝶', o => { const q = o.lt; drawButterfly(o.c, lerp(o.x0, o.x1, .5) + q * 80 + Math.sin(q * 2) * 30, o.y - o.s * 1.1 - q * 60, o.s * .42, q, '#f2b8c6', '#e9d36f'); });
  reg('番茄', o => drawTomato(o.c, o.x1 + o.s * .5, o.y - o.s * .4, o.s * .32 * easeOutBack(o.p), o.lt));
  reg('七里香', o => { const c = o.c;
    for (let k = 0; k < 7; k++) { const q = clamp(o.p * 1.8 - k * .12); if (q <= 0) continue;
      const x = lerp(o.x0, o.x1, k / 6) + (k % 2 ? 10 : -6), y = o.y - o.s * (1.02 + (k % 2) * .2);
      drawBlossom(c, x, y, o.s * .1 * easeOutBack(q), k + o.lt * .2); } });
  reg('永远', o => { const c = o.c, pts = [];
    for (let k = 0; k <= 24; k++) { const u = k / 24; pts.push([lerp(o.x0, o.x1, u), o.y + 18 + Math.sin(u * TAU * 2) * 5]); }
    pencil(c, pts, { col: '#c8454a', w: 3.4, progress: o.p, alpha: .85 }); });
  reg('了解', o => { const c = o.c, cx = (o.x0 + o.x1) / 2, cy = o.y - o.s * .36;
    const pts = []; for (let k = 0; k <= 30; k++) { const a = -2.2 + k / 30 * (TAU + .5); pts.push([cx + Math.cos(a) * (o.x1 - o.x0) * .68, cy + Math.sin(a) * o.s * .74]); }
    pencil(c, pts, { col: '#c8454a', w: 3.6, progress: easeOut(o.p * .8), alpha: .85 }); });
  reg('每一页', o => { const c = o.c; // dog-eared page corner
    const x = o.x1 + o.s * .25, y = o.y - o.s * .9, s = o.s * .5 * easeOutBack(o.p);
    pencil(c, [[x, y], [x + s, y], [x + s, y + s * .7], [x + s * .7, y + s], [x, y + s], [x, y]], { col: pc(o), w: 2.6, alpha: .8 });
    pencil(c, [[x + s, y + s * .7], [x + s * .7, y + s * .7], [x + s * .7, y + s]], { col: pc(o), w: 2.2, alpha: .8 }); });
  reg('稻穗', o => { const c = o.c;
    for (let k = 0; k < 3; k++) { const x = o.x1 + o.s * (.25 + k * .18), h = o.s * (.9 + k * .1) * o.p;
      pencil(c, [[x, o.y], [x + 4, o.y - h * .6], [x + 16, o.y - h]], { col: '#c98f2b', w: 2.6, seed: k, alpha: .9 });
      for (let j = 0; j < 4; j++) { const yy = o.y - h * (.55 + j * .12); c.fillStyle = '#e8b64c'; c.beginPath(); c.ellipse(x + 8 + j * 3, yy, 5, 9, .5, 0, TAU); c.fill(); } } });
  return { draw };
})();

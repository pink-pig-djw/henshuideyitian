// people.js — the two (original) characters: a girl with a bob and a white blossom hairpin,
// a boy who draws. Portrait rig, side-view body rig, back views, silhouettes, hands.
'use strict';

// limb capsule between two points
function capsule(p0, p1, w0, w1, n = 8) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], a = Math.atan2(dy, dx);
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = a + Math.PI / 2 + i / n * Math.PI; pts.push([p1[0] + Math.cos(t) * w1 / 2, p1[1] + Math.sin(t) * w1 / 2]); }
  for (let i = 0; i <= n; i++) { const t = a - Math.PI / 2 + i / n * Math.PI; pts.push([p0[0] + Math.cos(t) * w0 / 2, p0[1] + Math.sin(t) * w0 / 2]); }
  return pts;
}
function limbStroke(ctx, pts, w, col, o = {}) {
  const P = pts.map((p, i) => [p[0] + noise1(K.boil * .7 + i * 3.1, (o.seed ?? 0) + 5) * .8, p[1] + noise1(K.boil * .7 + i * 4.3, (o.seed ?? 0) + 6) * .8]);
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]);
  ctx.strokeStyle = o.lc ?? PAL.ink; ctx.lineWidth = w + (o.lw ?? 5); ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
  ctx.restore();
}
function limb(ctx, p0, p1, w0, w1, col, seed, o = {}) {
  const pts = capsule(p0, p1, w0, w1);
  shape(ctx, pts, col, { seed, lw: o.lw ?? 2.4, gran: o.gran ?? .15, edge: .25, lc: o.lc });
}
const pAt = (p, a, l) => [p[0] + Math.sin(a) * l, p[1] + Math.cos(a) * l]; // angle from vertical (down)

// ---------------- portrait ----------------
// o: who 'girl'|'boy', turn, tilt, eyes, look, mouth, blush, wind, bust, t, sketch, hairCol, clip
function drawPortrait(ctx, x, y, s, o = {}) {
  const t = o.t ?? K.t, who = o.who ?? 'girl', turn = o.turn ?? 0, dx = turn * 22;
  const sk = !!o.sketch, seed = who === 'girl' ? 100 : 200;
  const skin = o.skin ?? PAL.skin, hairC = o.hairCol ?? (who === 'girl' ? PAL.hair : PAL.boyHair);
  const F = (pts, col, sd, extra = {}) => {
    if (sk) pencil(ctx, pts, { closed: true, w: 2.2, seed: sd, alpha: .75, col: o.pencilCol });
    else shape(ctx, pts, col, Object.assign({ seed: sd, lw: 3.2 }, extra));
  };
  ctx.save(); ctx.translate(x, y); ctx.rotate(o.tilt ?? 0); ctx.scale(s, s);
  const wind = o.wind ?? 0;
  const sway = (yy, k = 1) => wind * k * (Math.sin(t * 2.4 + yy * .03) * .6 + .4) * clamp((yy + 30) / 120) * 16;

  // ----- back hair -----
  let back;
  if (who === 'girl') {
    back = [[0, -124], [62, -114], [100, -76], [112, -20], [114, 34], [120, 72], [104, 92], [70, 88], [40, 70], [-40, 70], [-72, 88], [-106, 92], [-122, 72], [-114, 34], [-112, -20], [-100, -76], [-62, -114]];
    back = back.map(p => [p[0] + sway(p[1]) + dx * .25, p[1]]);
  } else {
    back = [[0, -122], [60, -112], [96, -76], [104, -28], [98, 10], [80, 20], [-80, 20], [-98, 10], [-104, -28], [-96, -76], [-60, -112]];
    back = back.map(p => [p[0] + dx * .25, p[1]]);
  }
  F(back, hairC, seed + 1, { gran: .35 });

  // ----- bust -----
  if (o.bust !== false) {
    const neck = [[-18 + dx * .3, 70], [18 + dx * .3, 70], [20 + dx * .3, 128], [-20 + dx * .3, 128]];
    F(neck, mix(skin, '#d9a88c', .25), seed + 2, { lw: 2.6 });
    const shirt = who === 'girl' ? PAL.blouse : PAL.boyShirt;
    const sh = bez([34, 118], [90, 124], [140, 140], [156, 214], 8);
    const bodyPts = SH([...sh.map(p => [-p[0] + dx * .15, p[1]]), [-172 + dx * .15, 480], [172 + dx * .15, 480], ...sh.map(p => [p[0] + dx * .15, p[1]]).reverse()]);
    F(bodyPts, shirt, seed + 3, { gran: .12 });
    if (!sk) {
      // folds
      ink(ctx, [[-80 + dx * .15, 200], [-70 + dx * .15, 260], [-74 + dx * .15, 298]], { w: 2, seed: seed + 4, alpha: .6 });
      ink(ctx, [[86 + dx * .15, 210], [80 + dx * .15, 296]], { w: 2, seed: seed + 5, alpha: .6 });
    }
    if (who === 'girl') {
      // round collar + small navy ribbon
      for (const sg of [-1, 1]) {
        const col = [[sg * 4 + dx * .2, 124], [sg * 60 + dx * .2, 128], [sg * 66 + dx * .2, 156], [sg * 34 + dx * .2, 168], [sg * 8 + dx * .2, 150]];
        F(col, '#ffffff', seed + 6 + sg, { gran: .05 });
      }
      const bx = dx * .2;
      F([[bx, 146], [bx - 26, 134], [bx - 28, 160]], '#3d5a8a', seed + 9, { lw: 2 });
      F([[bx, 146], [bx + 26, 134], [bx + 28, 160]], '#3d5a8a', seed + 10, { lw: 2 });
      F(ellipsePts(bx, 147, 7, 7, 8), '#3d5a8a', seed + 11, { lw: 2 });
    } else {
      for (const sg of [-1, 1]) {
        const col = [[dx * .2, 150], [sg * 38 + dx * .2, 116], [sg * 64 + dx * .2, 126], [sg * 30 + dx * .2, 176]];
        F(col, '#ffffff', seed + 6 + sg, { gran: .05 });
      }
    }
  }

  // ----- face -----
  const face = [];
  for (let i = 0; i < 30; i++) {
    const a = i / 30 * TAU, c = Math.cos(a), sn = Math.sin(a);
    const rx = who === 'girl' ? 80 : 84, ry = who === 'girl' ? 92 : 96;
    let px = c * rx * (1 - .2 * Math.max(0, sn) * Math.max(0, sn)), py = sn * ry + 4;
    px += dx * .35 * (1 - Math.abs(c)) * .6 - Math.max(0, -c * turn) * 6 + Math.max(0, c * -turn) * 6;
    face.push([px, py]);
  }
  F(face, skin, seed + 12, { gran: .12, edge: .3 });
  if (!sk) {
    // soft shading on the far side
    ctx.save(); smoothPath(ctx, face, true); ctx.clip();
    ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = .09;
    ctx.fillStyle = '#e9b39c'; ctx.beginPath(); ctx.ellipse(-turn * 70 + (turn >= 0 ? -60 : 60), 20, 40, 100, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // ears (only when mostly frontal)
  if (Math.abs(turn) < .7) {
    for (const sg of [-1, 1]) {
      if (sg * turn > .35) continue;
      const ex = sg * (80 - Math.max(0, sg * turn) * 10) + dx * .3;
      const ear = ellipsePts(ex + sg * 4, 26, 12, 17, 10);
      if (who === 'boy' || o.showEars) F(ear, skin, seed + 13 + sg, { lw: 2.4 });
    }
  }
  // blush
  const blush = o.blush ?? .5;
  if (!sk && blush > 0) {
    ctx.save(); smoothPath(ctx, face, true); ctx.clip();
    for (const sg of [-1, 1]) {
      const bx = sg * 46 + dx * (sg * turn > 0 ? .7 : 1.1);
      const g = ctx.createRadialGradient(bx, 46, 0, bx, 46, 26);
      g.addColorStop(0, rgba(PAL.blush, .75 * Math.min(1, blush)));
      g.addColorStop(1, rgba(PAL.blush, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(bx, 46, 28, 18, 0, 0, TAU); ctx.fill();
      // little hatch marks on the cheek
      if (blush > .4) for (let k = 0; k < 3; k++) ink(ctx, [[bx - 10 + k * 8, 50], [bx - 4 + k * 8, 40]], { w: 1.6, col: '#d86f66', seed: seed + 20 + k, alpha: .7 });
    }
    if (blush > 1) { // tomato: the whole face floods red like wet pigment
      ctx.save(); smoothPath(ctx, face, true); ctx.clip();
      ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = clamp(blush - 1) * .7;
      const g2 = ctx.createRadialGradient(dx, 40, 10, dx, 30, 120);
      g2.addColorStop(0, '#f0645a'); g2.addColorStop(1, '#f7a08f');
      ctx.fillStyle = g2; ctx.fillRect(-100, -100, 200, 220);
      ctx.restore();
    }
    ctx.restore();
  }

  // ----- eyes -----
  const blinkPh = (t + (who === 'girl' ? .7 : 2.1)) % 3.9;
  let eyes = o.eyes ?? 'open';
  if (eyes === 'open' && blinkPh < .13 && !o.noBlink) eyes = 'closed';
  const look = o.look ?? [0, 0];
  const lineC = sk ? (o.pencilCol ?? PAL.graphite) : PAL.ink;
  for (const sg of [-1, 1]) {
    const far = sg * turn > 0 ? 1 - .28 * Math.abs(turn) : 1;
    const ex = sg * 33 * (sg * turn > 0 ? .88 : 1) + dx * 1.05, ey = 20;
    ctx.save(); ctx.translate(ex, ey); ctx.scale(far, 1);
    if (eyes === 'open') {
      ctx.fillStyle = sk ? rgba(lineC, .8) : '#2a2230';
      ctx.beginPath(); ctx.ellipse(look[0] * 3, look[1] * 3 + 2, 7.5, 10.5, 0, 0, TAU); ctx.fill();
      if (!sk) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(look[0] * 3 + 2.5, look[1] * 3 - 2, 2.8, 0, TAU); ctx.fill(); }
      ink(ctx, [[-13, -8], [0, -12], [13, -8], [sg * 17, -12]].map(p => [p[0] * (sg < 0 ? -1 : 1) * -1 * -1, p[1]]), { w: 3.6, col: lineC, seed: seed + 30 + sg, taper: [.1, .4] });
    } else if (eyes === 'smile') {
      ink(ctx, [[-12, 4], [0, -7], [12, 4]], { w: 3.8, col: lineC, seed: seed + 32 + sg });
    } else if (eyes === 'closed') {
      ink(ctx, [[-12, -1], [0, 6], [12, -1]], { w: 3.4, col: lineC, seed: seed + 34 + sg });
      if (who === 'girl') ink(ctx, [[10, 0], [16, 5]], { w: 2, col: lineC, seed: seed + 36 + sg });
    } else if (eyes === 'wide') {
      ctx.fillStyle = '#2a2230'; ctx.beginPath(); ctx.ellipse(look[0] * 3, look[1] * 3 + 1, 8, 11.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(look[0] * 3 + 2.5, look[1] * 3 - 3, 3.2, 0, TAU); ctx.fill();
      ink(ctx, [[-13, -11], [0, -15], [13, -11]], { w: 3, col: lineC, seed: seed + 38 + sg });
    }
    ctx.restore();
    // brows
    const by = who === 'girl' ? -8 : -10;
    ink(ctx, [[ex - 11 * far, by + 2 - (o.browUp ?? 0)], [ex, by - 1 - (o.browUp ?? 0)], [ex + 11 * far, by + 1 - (o.browUp ?? 0)]], { w: who === 'girl' ? 2.4 : 3.6, col: lineC, seed: seed + 40 + sg, alpha: .85 });
  }
  // nose
  ink(ctx, [[dx * 1.35 - 1, 36], [dx * 1.35 + 3 + turn * 3, 44], [dx * 1.35 - 2, 46]], { w: 2.2, col: lineC, seed: seed + 44, alpha: .7 });
  // mouth
  let mouth = o.mouth ?? 'smile';
  if (mouth === 'talk') mouth = (Math.sin(t * 17) > .1) ? 'open' : 'small';
  const mx = dx * 1.25, my = 62;
  if (mouth === 'smile') ink(ctx, [[mx - 11, my - 2], [mx, my + 5], [mx + 11, my - 2]], { w: 2.8, col: lineC, seed: seed + 46 });
  else if (mouth === 'small') ink(ctx, [[mx - 6, my], [mx + 6, my]], { w: 2.6, col: lineC, seed: seed + 47 });
  else if (mouth === 'open' || mouth === 'laugh') {
    const hh = mouth === 'laugh' ? 11 : 7;
    const m = [[mx - 11, my - 3], [mx + 11, my - 3], [mx + 7, my + hh], [mx - 7, my + hh]];
    if (sk) pencil(ctx, m, { closed: true, w: 2, seed: seed + 48 });
    else { shape(ctx, m, '#c9555a', { seed: seed + 48, lw: 2.4 }); ctx.fillStyle = '#f28d8d'; ctx.beginPath(); ctx.ellipse(mx, my + hh - 3, 5, 2.5, 0, 0, TAU); ctx.fill(); }
  } else if (mouth === 'o') {
    const m = ellipsePts(mx, my + 2, 6, 7, 10);
    if (sk) pencil(ctx, m, { closed: true, w: 2 }); else shape(ctx, m, '#c9555a', { seed: seed + 49, lw: 2.4 });
  } else if (mouth === 'pout') {
    ink(ctx, [[mx - 8, my + 2], [mx - 2, my - 2], [mx + 2, my + 1], [mx + 8, my - 1]], { w: 2.6, col: lineC, seed: seed + 50 });
  }

  // ----- front hair -----
  if (who === 'girl') {
    let bang = [[-96, -8], [-104, -60], [-72, -106], [-10, -122], [56, -112], [98, -72], [102, -14], [86, -24], [74, -44], [58, -28], [44, -48], [26, -26], [10, -46], [-8, -28], [-26, -48], [-44, -28], [-60, -46], [-76, -22]];
    bang = bang.map(p => [p[0] + dx * .55 + (p[1] > -40 ? sway(p[1] + 60, .25) : 0), p[1]]);
    F(bang, hairC, seed + 60, { gran: .35 });
    // side locks framing the face
    for (const sg of [-1, 1]) {
      const bx = sg * 92 + dx * .3;
      let lock = [[bx, -40], [bx + sg * 18, 10], [bx + sg * 16, 60], [bx + sg * 6, 88], [bx - sg * 6, 60], [bx - sg * 10, 10]];
      lock = lock.map(p => [p[0] + sway(p[1]), p[1]]);
      F(lock, hairC, seed + 62 + sg, { gran: .35 });
    }
    if (!sk) { // hair shine strands
      ctx.save(); ctx.globalAlpha = .5;
      ink(ctx, [[-50 + dx * .5, -96], [-20 + dx * .5, -104], [14 + dx * .5, -102]], { w: 3, col: '#6c6178', seed: seed + 65 });
      ctx.restore();
    }
    // blossom hairpin (七里香)
    if (o.clip !== false) {
      const cx = -64 + dx * .5, cy = -70;
      if (sk) pencil(ctx, ellipsePts(cx, cy, 12, 12, 10), { closed: true, w: 2 });
      else { drawBlossom(ctx, cx, cy, 13, .3); drawBlossom(ctx, cx + 16, cy + 10, 9, 1.1); }
    }
  } else {
    let fr = [[-100, -30], [-96, -84], [-50, -118], [10, -126], [66, -110], [100, -66], [102, -26], [88, -40], [80, -18], [64, -46], [52, -28], [34, -54], [18, -30], [0, -58], [-18, -34], [-36, -58], [-52, -32], [-70, -52], [-84, -24]];
    fr = fr.map(p => [p[0] + dx * .55, p[1]]);
    F(fr, hairC, seed + 60, { gran: .35 });
    // cowlick
    ink(ctx, [[10 + dx * .5, -124], [26 + dx * .5, -146], [38 + dx * .5, -138]], { w: 3.4, col: sk ? PAL.graphite : PAL.ink, seed: seed + 61 });
    if (o.pencilEar) { // pencil tucked behind the ear
      ctx.save(); ctx.translate(86 + dx * .3, -6); ctx.rotate(-.9);
      ctx.fillStyle = '#f2c14e'; ctx.fillRect(-4, -60, 9, 80); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.6; ctx.strokeRect(-4, -60, 9, 80);
      ctx.restore();
    }
  }
  ctx.restore();
}

// ---------------- side-view body rig ----------------
// pose angles (radians from vertical-down); o.who, o.facing (1 right, -1 left), o.t
// pose: {hipA, kneeA (thigh), shinA, hipB, shinB, armA, foreA, armB, foreB, lean, headTilt, sit}
function walkPose(ph, amt = 1) {
  const s = Math.sin(ph), c = Math.cos(ph);
  return {
    thighA: .42 * s * amt, shinA: .42 * s * amt - Math.max(0, -c) * .6 * amt,
    thighB: -.42 * s * amt, shinB: -.42 * s * amt - Math.max(0, c) * .6 * amt,
    armA: -.38 * s * amt, foreA: -.38 * s * amt - .35, armB: .38 * s * amt, foreB: .38 * s * amt - .35,
    bob: Math.abs(c) * 6 * amt, lean: .05,
  };
}
function drawBody(ctx, x, y, s, pose, o = {}) {
  const who = o.who ?? 'girl', f = o.facing ?? 1, t = o.t ?? K.t;
  const seed = (who === 'girl' ? 300 : 400) + (o.seed ?? 0);
  const skin = PAL.skin, hairC = who === 'girl' ? PAL.hair : PAL.boyHair;
  ctx.save(); ctx.translate(x, y); ctx.scale(s * f, s);
  const legL = who === 'girl' ? 150 : 162, bob = pose.bob ?? 0;
  const hip = pose.hip ?? [0, -legL - 8 + bob * .5];
  ctx.rotate(pose.lean ?? 0);
  const torsoH = who === 'girl' ? 120 : 132;
  const shoulder = [hip[0] + 6, hip[1] - torsoH];
  const drawLeg = (ta, sa, far) => {
    const knee = pAt(hip, ta, legL * .5), foot = pAt(knee, sa, legL * .5);
    const c = far ? mix(who === 'girl' ? skin : PAL.boyPants, '#6b5a50', .18) : (who === 'girl' ? skin : PAL.boyPants);
    limbStroke(ctx, [hip, knee, foot], who === 'girl' ? 20 : 30, c, { seed: seed + (far ? 1 : 2), lw: 4.5 });
    // shoe
    const sh = [[foot[0] - 10, foot[1] - 8], [foot[0] + 22, foot[1] - 6], [foot[0] + 26, foot[1] + 5], [foot[0] - 12, foot[1] + 6]];
    shape(ctx, sh, who === 'girl' ? '#5b4a6b' : '#f2efe7', { seed: seed + (far ? 5 : 6), lw: 2.2 });
    if (who === 'girl') ink(ctx, [[foot[0] - 12, foot[1] - 20], [foot[0] + 18, foot[1] - 20]], { w: 6, col: '#ffffff', seed: seed + 7 }); // socks
  };
  const drawArm = (aa, fa, far) => {
    const el = pAt(shoulder, aa, 62), hand = pAt(el, fa, 58);
    const sleeve = who === 'girl' ? PAL.blouse : PAL.boyShirt;
    const c = far ? mix(skin, '#b08a78', .2) : skin;
    limbStroke(ctx, [shoulder, el, hand], 16, c, { seed: seed + (far ? 8 : 9), lw: 4.5 });
    limbStroke(ctx, [shoulder, pAt(shoulder, aa, 26)], 30, far ? mix(sleeve, '#8a8078', .15) : sleeve, { seed: seed + (far ? 12 : 13), lw: 4.5 });
    shape(ctx, ellipsePts(hand[0], hand[1], 11, 12, 10), c, { seed: seed + (far ? 14 : 15), lw: 2.2 });
    const m = ctx.getTransform(), wp = m.transformPoint(new DOMPoint(hand[0], hand[1]));
    pose[far ? '_handBW' : '_handAW'] = [wp.x, wp.y];
    return hand;
  };
  if (!o.noFarArm) pose._handB = drawArm(pose.armB ?? .1, pose.foreB ?? -.2, true);
  drawLeg(pose.thighB ?? 0, pose.shinB ?? 0, true);
  drawLeg(pose.thighA ?? 0, pose.shinA ?? 0, false);
  // torso
  if (who === 'girl') {
    const skirt = [[hip[0] - 34, hip[1] - 28], [hip[0] + 38, hip[1] - 28], [hip[0] + 62 + (o.skirtWind ?? 0), hip[1] + 40], [hip[0] - 58 + (o.skirtWind ?? 0) * .6, hip[1] + 44]];
    shape(ctx, skirt, PAL.skirt, { seed: seed + 16, lw: 2.6, gran: .25 });
    for (let k = 1; k < 4; k++) ink(ctx, [[lerp(skirt[0][0], skirt[1][0], k / 4), hip[1] - 22], [lerp(skirt[3][0], skirt[2][0], k / 4), hip[1] + 40]], { w: 1.6, seed: seed + 17 + k, alpha: .55 });
    const top = [[hip[0] - 30, hip[1] - 26], [shoulder[0] - 34, shoulder[1] + 10], [shoulder[0] - 10, shoulder[1] - 4], [shoulder[0] + 26, shoulder[1] + 4], [hip[0] + 32, hip[1] - 26]];
    shape(ctx, top, PAL.blouse, { seed: seed + 21, lw: 2.6, gran: .1 });
  } else {
    const top = [[hip[0] - 36, hip[1] + 6], [shoulder[0] - 38, shoulder[1] + 12], [shoulder[0] - 10, shoulder[1] - 6], [shoulder[0] + 32, shoulder[1] + 6], [hip[0] + 36, hip[1] + 6]];
    shape(ctx, top, PAL.boyShirt, { seed: seed + 21, lw: 2.6, gran: .1 });
    if (o.bag) { ink(ctx, [[shoulder[0] + 20, shoulder[1]], [hip[0] - 30, hip[1] - 10]], { w: 7, col: '#8a5a3b', seed: seed + 22 }); }
  }
  // neck + head (side view)
  const head = [shoulder[0] + 10, shoulder[1] - 56];
  ctx.save(); ctx.translate(head[0], head[1]); ctx.rotate(pose.headTilt ?? 0);
  limbSimple(ctx, [0, 30], [-4, 58], 20, skin, seed + 23);
  const hs = who === 'girl' ? 1 : 1.05;
  // back hair
  if (who === 'girl') {
    const w = (o.wind ?? 0) * (Math.sin(t * 2.6) * .5 + .5);
    shape(ctx, [[-50, -10], [-44, -44], [0, -58], [40, -42], [48, -10], [44, 10], [30, 34], [-20 - w * 14, 44 + w * 4], [-54 - w * 20, 40 + w * 6], [-58 - w * 12, 10]], hairC, { seed: seed + 24, lw: 2.6, gran: .35 });
  }
  const hp = []; for (let i = 0; i < 20; i++) { const a = i / 20 * TAU; hp.push([Math.cos(a) * 44 * hs, Math.sin(a) * 48 * hs]); }
  hp[0][0] += 6; hp[1][0] += 8; hp[2][0] += 4; // nose bump side
  shape(ctx, hp, skin, { seed: seed + 25, lw: 2.8, gran: .1 });
  // face details facing right
  ctx.fillStyle = '#2a2230'; ctx.beginPath(); ctx.ellipse(24, -2, 4.5, 6.5, 0, 0, TAU); ctx.fill();
  const gb = ctx.createRadialGradient(20, 20, 0, 20, 20, 16); gb.addColorStop(0, rgba(PAL.blush, .7)); gb.addColorStop(1, rgba(PAL.blush, 0));
  ctx.fillStyle = gb; ctx.beginPath(); ctx.arc(20, 20, 16, 0, TAU); ctx.fill();
  ink(ctx, [[30, 30], [37, 29]], { w: 2.2, seed: seed + 26 });
  // front hair
  if (who === 'girl') {
    shape(ctx, [[-48, -6], [-42, -44], [-6, -60], [34, -50], [50, -22], [40, -16], [30, -30], [12, -20], [0, -36], [-24, -12], [-30, 10], [-44, 20]], hairC, { seed: seed + 27, lw: 2.6, gran: .35 });
    drawBlossom(ctx, -18, -40, 9, .4);
  } else {
    shape(ctx, [[-50, 4], [-48, -36], [-12, -60], [30, -54], [52, -30], [46, -18], [34, -26], [26, -12], [14, -30], [-6, -14], [-20, -26], [-30, 4]], hairC, { seed: seed + 27, lw: 2.6, gran: .35 });
  }
  ctx.restore();
  pose._handA = drawArm(pose.armA ?? -.1, pose.foreA ?? -.3, false);
  ctx.restore();
}
function limbSimple(ctx, p0, p1, w, col, seed) { shape(ctx, capsule(p0, p1, w, w), col, { seed, lw: 2.2 }); }

// ---------------- back view (umbrella, bus stop) ----------------
function drawBackView(ctx, x, y, s, o = {}) {
  const who = o.who ?? 'boy', seed = (who === 'girl' ? 500 : 600) + (o.seed ?? 0), ph = o.walk ?? 0;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  const hairC = who === 'girl' ? PAL.hair : PAL.boyHair;
  // legs
  const lift = Math.sin(ph) * 10;
  const legC = who === 'girl' ? PAL.skin : PAL.boyPants;
  limbStroke(ctx, [[-18, -150], [-20, -10 - Math.max(0, lift)]], who === 'girl' ? 20 : 30, legC, { seed: seed + 1 });
  limbStroke(ctx, [[18, -150], [20, -10 - Math.max(0, -lift)]], who === 'girl' ? 20 : 30, legC, { seed: seed + 2 });
  shape(ctx, ellipsePts(-20, -6 - Math.max(0, lift), 14, 8, 10), who === 'girl' ? '#5b4a6b' : '#f2efe7', { seed: seed + 3, lw: 2 });
  shape(ctx, ellipsePts(20, -6 - Math.max(0, -lift), 14, 8, 10), who === 'girl' ? '#5b4a6b' : '#f2efe7', { seed: seed + 4, lw: 2 });
  if (who === 'girl') shape(ctx, [[-44, -200], [44, -200], [66, -120], [-66, -120]], PAL.skirt, { seed: seed + 5, gran: .25 });
  // arms
  const armL = o.armL ?? [[-54, -250], [-66, -170]], armR = o.armR ?? [[54, -250], [66, -170]];
  limbStroke(ctx, armL, 18, PAL.skin, { seed: seed + 6 });
  limbStroke(ctx, armR, 18, PAL.skin, { seed: seed + 7 });
  // torso
  const shirt = who === 'girl' ? PAL.blouse : PAL.boyShirt;
  const torso = who === 'girl'
    ? SH([...bez([-20, -280], [-50, -276], [-62, -268], [-62, -240], 5), [-52, -192], [52, -192], ...bez([62, -240], [62, -268], [50, -276], [20, -280], 5)])
    : SH([...bez([-22, -290], [-56, -286], [-70, -276], [-70, -244], 5), [-58, -146], [58, -146], ...bez([70, -244], [70, -276], [56, -286], [22, -290], 5)]);
  shape(ctx, torso, o.wetShoulder ? shirt : shirt, { seed: seed + 8, gran: .1 });
  if (o.wetShoulder) { // rain-soaked shoulder, darker patch
    ctx.save(); smoothPath(ctx, torso, true); ctx.clip();
    ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = o.wetShoulder;
    ctx.fillStyle = '#9fb3c9'; ctx.beginPath(); ctx.ellipse(o.wetSide * 58, -250, 40, 60, 0, 0, TAU); ctx.fill(); ctx.restore();
  }
  if (o.bag) shape(ctx, [[-40, -250], [40, -250], [44, -170], [-44, -170]], o.bag, { seed: seed + 9, gran: .3 });
  // neck & head
  limbSimple(ctx, [0, -290], [0, -262], 22, PAL.skin, seed + 10);
  const hp = ellipsePts(0, -326, 46, 50, 20);
  shape(ctx, hp, hairC, { seed: seed + 11, gran: .35 });
  if (who === 'girl') shape(ctx, [[-48, -330], [48, -330], [52, -276], [30, -282], [-30, -282], [-52, -276]], hairC, { seed: seed + 12, gran: .35 });
  if (who === 'girl') drawBlossom(ctx, -30, -350, 9, .3);
  ctx.restore();
}

// ---------------- profile silhouettes (sunset) ----------------
function profileHead(who, f = 1) {
  // right-facing profile outline, head center ~ (0,0), radius ~ 60
  const P = who === 'girl'
    ? [[-58, -10], [-52, -52], [-10, -70], [34, -58], [52, -28], [56, -6], [66, 10], [58, 16], [60, 26], [56, 32], [58, 40], [48, 50], [36, 60], [20, 64], [16, 96], [-30, 104], [-60, 96], [-70, 60], [-72, 20]]
    : [[-60, -14], [-50, -60], [-8, -76], [38, -62], [58, -30], [60, -4], [72, 14], [62, 20], [64, 30], [60, 36], [62, 44], [52, 54], [40, 66], [22, 70], [20, 104], [-40, 110], [-64, 80], [-66, 30]];
  return P.map(p => [p[0] * f, p[1]]);
}

// ---------------- hands ----------------
// right hand holding a pencil, pencil tip at (x,y), pencil pointing up-right at angle ang
function drawPencilHand(ctx, x, y, s, o = {}) {
  const ang = o.ang ?? -.62, seed = o.seed ?? 700, skin = o.skin ?? PAL.skin;
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(s, s);
  // pencil
  const pl = 360;
  ctx.save();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(34, -9); ctx.lineTo(34, 9); ctx.closePath(); ctx.fillStyle = '#f0d3a6'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(12, -3.2); ctx.lineTo(12, 3.2); ctx.closePath(); ctx.fillStyle = '#3a3840'; ctx.fill();
  ctx.restore();
  shape(ctx, RECT(34, -9, pl - 34, 18), o.pencilCol ?? '#f2c14e', { seed: seed + 1, lw: 2.2, gran: .2 });
  ink(ctx, [[36, 3], [pl - 4, 3]], { w: 1.6, col: '#c8952a', seed: seed + 2, alpha: .8 });
  // back of hand
  const back = [[112, -40], [176, -84], [262, -86], [330, -40], [346, 20], [320, 74], [246, 96], [170, 70], [128, 34]];
  shape(ctx, back, skin, { seed: seed + 3, lw: 3, gran: .12 });
  // knuckle marks
  for (let k = 0; k < 3; k++) ink(ctx, [[190 + k * 30, -60 + k * 6], [200 + k * 30, -52 + k * 6]], { w: 2, seed: seed + 4 + k, alpha: .5 });
  // curled fingers under
  for (let k = 0; k < 3; k++) {
    const fx = 150 + k * 40, fy = 56 + k * 16;
    shape(ctx, ellipsePts(fx, fy, 26, 20, 12, .3), skin, { seed: seed + 8 + k, lw: 2.6, gran: .1 });
  }
  // index finger along the pencil
  shape(ctx, capsule([66, -14], [176, -40], 30, 36), skin, { seed: seed + 12, lw: 3, gran: .1 });
  ink(ctx, [[100, -30], [106, -18]], { w: 1.8, seed: seed + 13, alpha: .5 });
  // nail
  shape(ctx, ellipsePts(76, -20, 10, 7, 10, -.25), '#f9e6dc', { seed: seed + 14, lw: 1.6 });
  // thumb
  shape(ctx, capsule([84, 18], [190, 46], 32, 40), skin, { seed: seed + 15, lw: 3, gran: .1 });
  // sleeve cuff
  if (o.sleeve !== false) {
    const sc = o.sleeveCol ?? '#dfe6ee';
    const sl = SH([[318, -92], [420, -104], [620, -118], [900, -132], [900, 160], [620, 146], [420, 132], [322, 106], [306, 6]]);
    shape(ctx, sl, sc, { seed: seed + 16, lw: 3, gran: .15 });
    ink(ctx, [[330, -88], [314, 8], [332, 100]], { w: 2.4, seed: seed + 19, alpha: .7 });
    ink(ctx, [[372, -100], [356, 10], [376, 118]], { w: 2, seed: seed + 20, alpha: .5 });
    for (let k = 0; k < 2; k++) ink(ctx, [[470 + k * 90, -100 - k * 6], [520 + k * 90, -30], [500 + k * 90, 40]], { w: 1.8, seed: seed + 21 + k, alpha: .45 });
    if (o.watch) {
      shape(ctx, SH([[300, -70], [336, -78], [350, 90], [312, 96]]), '#3b3a3f', { seed: seed + 17, lw: 2 });
      shape(ctx, ellipsePts(330, 8, 30, 36, 18), '#e9e3d6', { seed: seed + 18, lw: 2.4 });
    }
  }
  ctx.restore();
}

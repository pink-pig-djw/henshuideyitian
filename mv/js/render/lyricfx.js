/*
 * MV lyric typography — registers MV.lyricStyles.* and exposes shared helpers
 * on MV.LyricFX (see docs/ARCHITECTURE.md §3.5).
 *
 *   MV.lyricStyles.get(name) → { layout(line, ctxOrOpts) → layout, draw(ctx, line, layout, lt, env) }
 *   styles: ransom, slash, impact, dialog, vertical, card, split, glitch
 *
 * Design language: P5-inspired (original artwork only) — ransom-note tiles,
 * skewed bands with hard red offset shadows, starbursts, halftone rings,
 * thick black outlines, snappy outBack/outExpo entrances.
 *
 * Rules honoured here:
 *  - layout() is pure: a function of the Line (text, phrases, seed) and the
 *    font metrics. CJK advances are fixed at 1 em so a layout computed before
 *    web fonts arrive is already close; when fonts finish loading the metric
 *    cache is flushed and draw() refreshes a stale layout in place.
 *  - draw() is a pure function of env.t, line.charTimes and the layout. No
 *    Math.random / Date.now / performance.now anywhere in this file.
 *  - Glyph i is revealed when env.t >= line.charTimes[i] - LEAD (0.04 s) with a
 *    0.12–0.25 s pop. Latin phrases use Latin faces (charTimes are per word).
 *  - All text stays inside BOX = x 110..1810, y 104..952, which lies inside the
 *    safe area (80..1840 × 60..1020) and clear of both HUD zones.
 *
 * Layout objects (opaque to callers) always carry:
 *   { name, size (main type size, px), bounds (world AABB of the text), epoch, ... }
 * Styles read line.charTimes / showStart / showEnd at draw time, so timing
 * edits (sync editor, offsets) need no re-layout; text / phrase changes do.
 * lt.in / lt.out drive the container entrance / exit (tuned for ~0.3 s ramps);
 * when absent they are derived from line.showStart / showEnd.
 *
 * MV.LyricFX (shared helpers):
 *   drawLatin(ctx, text, x, y, size, progress, env, seed) → advance width
 *       huge skewed Anton, black outline, hard red shadow; words pop in as
 *       progress 0→1; (x, y) = left end of the baseline.
 *   measureLatin(text, size) → width of drawLatin's text
 *   drawEmblem(ctx, x, y, r, rot, {star, edge, slash, gap, shadow})
 *       the original star-pierced-by-a-slash emblem
 *   ransomSpecs(info, seed, combos) / placeTiles(...) / drawTile(ctx, tile, ...)
 *       cut-paper ransom tiles (used by ransom and card)
 *   glyphText(ctx, ch, font, x, y, fill, stroke, strokeW, shadow, sx, sy)
 *   charInfo(line), tokens(line), planRows(line, info, advances, opts), splitTok(...)
 *   reveal(line, i, t, dur) → 0..1 pop progress of glyph i
 *   timing(line, lt, env) → { t, inP, outP, showStart, showEnd }
 *   check(layout) → { ok, safe, hud, bounds }   (tests)
 *   fontSample   extra glyphs styles draw (glitch scramble set, ★) — append to
 *                the MV.fonts.ensure sample
 *   speaker      optional name for the dialog plate (else preset artist, else ★)
 *   SAFE, BOX, HUD_ZONES, LEAD, FACE, epoch()
 */
(function () {
  'use strict';

  const MV = (window.MV = window.MV || {});
  if (!MV.lyricStyles || !MV.text) return; // core.js missing

  const C = MV.C;
  const F = MV.FONTS;
  const clamp = MV.clamp;
  const lerp = MV.lerp;
  const E = MV.ease;
  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;
  const W = MV.W, H = MV.H;

  /** Safe area for lyric text (ARCHITECTURE §0.5). */
  const SAFE = { x0: 80, y0: 60, x1: 1840, y1: 1020 };
  /** HUD zones that must stay clear of lyric text. */
  const HUD_ZONES = [
    { x0: 0, y0: H - 110, x1: 620, y1: H },
    { x0: W - 360, y0: 0, x1: W, y1: 90 },
  ];
  /** Box every style fits its text into (inside SAFE, clear of both HUD zones). */
  const BOX = { x0: 110, y0: 104, x1: 1810, y1: 952 };
  const LEAD = 0.04; // seconds a glyph may appear before its charTime
  const MS = 100; //    measuring size (px)

  /* ================================================================== */
  /* Faces & metrics                                                     */
  /* ================================================================== */
  const face = (family, weight, style, scale) => ({ family, weight, style: style || 'normal', scale: scale || 1 });
  const FACE = {
    heavy: face(F.jpHeavy, 400),
    sans: face(F.jpSans, 900),
    serif: face(F.jpSerif, 800),
    dot: face(F.jpDot, 400),
    anton: face(F.latinCond, 400),
    bebas: face(F.latinBebas, 400),
    black: face(F.latinBlack, 400),
  };

  const mctx = MV.makeCanvas(8, 8).ctx;
  const mcache = new Map();
  let epoch = 0;
  try {
    if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
      document.fonts.addEventListener('loadingdone', () => {
        mcache.clear();
        epoch++;
      });
    }
  } catch (e) {
    /* metrics simply stay as measured */
  }

  const fontStr = (fc, px) => MV.text.font(px * (fc.scale || 1), fc.family, fc.weight, fc.style);

  // Metrics of one glyph in em units (measured at MS px; face.scale excluded).
  function met(ch, fc) {
    const font = MV.text.font(MS, fc.family, fc.weight, fc.style);
    const k = font + '\u0001' + ch;
    let m = mcache.get(k);
    if (!m) {
      let r = null;
      try {
        mctx.font = font;
        r = mctx.measureText(ch);
      } catch (e) {
        r = null;
      }
      const w = r ? r.width : MS * 0.6;
      m = {
        w: w / MS,
        asc: r && r.actualBoundingBoxAscent != null ? r.actualBoundingBoxAscent / MS : 0.72,
        desc: r && r.actualBoundingBoxDescent != null ? r.actualBoundingBoxDescent / MS : 0.0,
        l: r && r.actualBoundingBoxLeft != null ? r.actualBoundingBoxLeft / MS : 0,
        r: r && r.actualBoundingBoxRight != null ? r.actualBoundingBoxRight / MS : w / MS,
      };
      mcache.set(k, m);
    }
    return m;
  }
  // Baseline offset (em) that vertically centres a row of this face on y.
  function vcenter(fc, latin) {
    const m = met(latin ? 'H' : '国', fc);
    const v = (m.asc - m.desc) / 2;
    return v > 0.05 && v < 1 ? v : latin ? 0.36 : 0.38;
  }

  /* ================================================================== */
  /* Character classes                                                   */
  /* ================================================================== */
  function isWide(ch) {
    const c = ch.codePointAt(0);
    return (
      (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x2600 && c <= 0x27bf) || c >= 0x1f000
    );
  }
  const isSpace = (ch) => /\s/.test(ch);
  const isHira = (ch) => { const c = ch.codePointAt(0); return c >= 0x3041 && c <= 0x309f; };
  const NO_START = 'ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶーｰ〜～、。，．・：；！？!?,.)）」』】〕〉》…‥ゝゞヽヾ々';
  const NO_END = '(（「『【〔〈《';
  const SMALL_KANA = 'ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ';
  const ROTATE_V = 'ー〜～…‥—―－-‐(（)）「」『』【】〔〕〈〉《》［］[]｛｝{}<>＜＞=＝~:：;；|｜';
  const PUNCT_V = '、。，．';

  /* ================================================================== */
  /* Line analysis: per-char info, tokens (phrases), rows                */
  /* ================================================================== */
  const finite = (x) => typeof x === 'number' && isFinite(x);
  const iclamp = (x, a, b) => Math.max(a, Math.min(b, Math.round(finite(x) ? x : a)));

  /**
   * Per-character info for a Line.
   * @returns {{chars:string[], n:number, lat:Uint8Array, sp:Uint8Array, ph:Int16Array, t0:number}}
   */
  function charInfo(line) {
    const chars = line && Array.isArray(line.chars) && line.chars.length ? line.chars : MV.text.chars(line && line.text);
    const n = chars.length;
    const lat = new Uint8Array(n), sp = new Uint8Array(n), ph = new Int16Array(n).fill(-1);
    const phrases = line && Array.isArray(line.phrases) ? line.phrases : [];
    phrases.forEach((p, k) => {
      const a = iclamp(p.charStart, 0, n), b = iclamp(p.charEnd, a, n);
      for (let i = a; i < b; i++) {
        ph[i] = k;
        if (p.latin) lat[i] = 1;
      }
    });
    for (let i = 0; i < n; i++) {
      if (isSpace(chars[i])) sp[i] = 1;
      else if (!isWide(chars[i])) lat[i] = 1;
    }
    return { chars, n, lat, sp, ph, t0: line && finite(line.start) ? line.start : 0 };
  }

  /**
   * Timed chunks of a line (one per phrase; falls back to space-separated
   * segments when phrases do not cover every visible char).
   * @returns {Array<{cs:number, ce:number, latin:boolean}>}
   */
  function tokens(line, I) {
    I = I || charInfo(line);
    const out = [];
    const phrases = line && Array.isArray(line.phrases) ? line.phrases : [];
    let ok = phrases.length > 0;
    for (let i = 0; ok && i < I.n; i++) if (!I.sp[i] && I.ph[i] < 0) ok = false;
    if (ok) {
      phrases.forEach((p) => {
        let a = iclamp(p.charStart, 0, I.n), b = iclamp(p.charEnd, a, I.n);
        while (a < b && I.sp[a]) a++;
        while (b > a && I.sp[b - 1]) b--;
        if (b > a) out.push({ cs: a, ce: b, latin: !!p.latin });
      });
      out.sort((x, y) => x.cs - y.cs);
      for (let k = 1; k < out.length; k++) if (out[k].cs < out[k - 1].ce) out[k].cs = out[k - 1].ce;
      for (let k = out.length - 1; k >= 0; k--) if (out[k].ce <= out[k].cs) out.splice(k, 1);
    } else {
      let i = 0;
      while (i < I.n) {
        while (i < I.n && I.sp[i]) i++;
        const a = i;
        let allLat = true;
        while (i < I.n && !I.sp[i]) { if (!I.lat[i]) allLat = false; i++; }
        if (i > a) out.push({ cs: a, ce: i, latin: allLat });
      }
    }
    return out;
  }

  // Width (em) of chars [a, b) using the advance array.
  function spanW(aw, a, b) {
    let w = 0;
    for (let i = a; i < b; i++) w += aw[i];
    return w;
  }
  function trimTok(I, a, b, latin) {
    while (a < b && I.sp[a]) a++;
    while (b > a && I.sp[b - 1]) b--;
    return { cs: a, ce: b, latin };
  }

  // Split a token wider than maxEm at the best break (recursively).
  function splitTok(tok, I, aw, maxEm, depth) {
    const w = spanW(aw, tok.cs, tok.ce);
    if (w <= maxEm || tok.ce - tok.cs < 2 || (depth || 0) > 6) return [tok];
    let best = null;
    const tryAt = (j, pen) => {
      const L = trimTok(I, tok.cs, j, tok.latin), R = trimTok(I, j, tok.ce, tok.latin);
      if (L.ce <= L.cs || R.ce <= R.cs) return;
      const cost = Math.max(spanW(aw, L.cs, L.ce), spanW(aw, R.cs, R.ce)) + pen;
      if (!best || cost < best.cost) best = { cost, L, R };
    };
    for (let j = tok.cs + 1; j < tok.ce; j++) {
      const a = I.chars[j - 1], b = I.chars[j];
      const latinPair = I.lat[j - 1] && I.lat[j];
      if (I.sp[j] || I.sp[j - 1]) { tryAt(j, -0.9); continue; }
      if (latinPair) continue; // never split inside a Latin word
      if (NO_START.indexOf(b) >= 0 || NO_END.indexOf(a) >= 0) continue;
      let pen = 0;
      if ('、。，．！？!?'.indexOf(a) >= 0) pen = -0.8;
      else if (I.lat[j - 1] !== I.lat[j]) pen = -0.7;
      else if (isHira(a) && !isHira(b)) pen = -0.45;
      else if (isHira(a) && isHira(b)) pen = 0.35;
      tryAt(j, pen);
    }
    if (!best) {
      // Unbreakable by the rules (e.g. one long Latin word): cut near the middle.
      const mid = Math.max(tok.cs + 1, Math.min(tok.ce - 1, Math.round((tok.cs + tok.ce) / 2)));
      tryAt(mid, 0);
      if (!best) return [tok];
    }
    return splitTok(best.L, I, aw, maxEm, (depth || 0) + 1).concat(splitTok(best.R, I, aw, maxEm, (depth || 0) + 1));
  }

  // Partition token widths into R contiguous rows minimising the widest row.
  function minMaxPartition(tw, gap, R) {
    const n = tw.length;
    const pre = [0];
    for (let k = 0; k < n; k++) pre.push(pre[k] + tw[k] + (k < n - 1 ? gap[k] : 0));
    const width = (a, b) => pre[b + 1] - pre[a] - (b < n - 1 ? gap[b] : 0);
    const dp = [], cut = [];
    for (let r = 0; r <= R; r++) { dp.push(new Array(n + 1).fill(Infinity)); cut.push(new Array(n + 1).fill(0)); }
    dp[0][0] = 0;
    for (let r = 1; r <= R; r++) {
      for (let j = r; j <= n; j++) {
        for (let i = r - 1; i < j; i++) {
          const v = Math.max(dp[r - 1][i], width(i, j - 1));
          // Tie-break towards more balanced rows (later cut when equal).
          if (v < dp[r][j] - 1e-9 || (Math.abs(v - dp[r][j]) < 1e-9 && i > cut[r][j])) { dp[r][j] = v; cut[r][j] = i; }
        }
      }
    }
    const parts = [];
    let j = n;
    for (let r = R; r >= 1; r--) {
      const i = cut[r][j];
      parts.unshift([i, j - 1]);
      j = i;
    }
    return { maxW: dp[R][n], parts, width };
  }

  /**
   * Wrap a line into rows by phrases: merges adjacent short phrases, splits
   * long ones at phrase/segment/script boundaries, and picks the row count
   * that gives the largest type.
   * @param {object} line
   * @param {object} I   charInfo(line)
   * @param {number[]} aw per-char advance (em)
   * @param {{maxW:number,maxH:number,lh:number,maxRows:number,maxSize:number,minSize:number,prefSize:number,rowPenalty?:number}} o
   * @returns {{rows:Array<{cs:number,ce:number,w:number}>, size:number}}
   */
  function planRows(line, I, aw, o) {
    let toks = tokens(line, I);
    if (!toks.length) return { rows: [], size: o.maxSize };
    const maxEm = o.maxW / Math.max(o.minSize, o.prefSize || o.maxSize * 0.66);
    let split = [];
    toks.forEach((t) => (split = split.concat(splitTok(t, I, aw, maxEm, 0))));
    const rp = o.rowPenalty == null ? 0.06 : o.rowPenalty;
    const planWith = (tk, splits) => {
      const tw = tk.map((t) => spanW(aw, t.cs, t.ce));
      const gap = [];
      for (let k = 0; k < tk.length - 1; k++) gap.push(Math.max(0.2, spanW(aw, tk[k].ce, tk[k + 1].cs)));
      let best = null;
      const maxR = Math.max(1, Math.min(o.maxRows, tk.length));
      for (let R = 1; R <= maxR; R++) {
        const part = minMaxPartition(tw, gap, R);
        const size = Math.min(o.maxSize, o.maxW / Math.max(0.01, part.maxW), o.maxH / (R * o.lh));
        const score = size * (1 - rp * (R - 1)) * (1 - splits);
        if (!best || score > best.score + 1e-6) best = { score, size, part, toks: tk, splits };
      }
      return best;
    };
    let best = planWith(split, 0);
    // Split the widest single-chunk row while that buys clearly bigger type
    // (Latin tails split at words cheaply; Japanese phrases cost more).
    for (let it = 0; it < 5; it++) {
      let wi = -1, ww = -1;
      best.part.parts.forEach(([a, b]) => {
        const w = best.part.width(a, b);
        if (w > ww) { ww = w; wi = a === b ? a : -1; }
      });
      if (wi < 0) break;
      const tk = best.toks[wi];
      const halves = splitTok(tk, I, aw, spanW(aw, tk.cs, tk.ce) * 0.62, 5);
      if (halves.length < 2) break;
      const nt = best.toks.slice(0, wi).concat(halves, best.toks.slice(wi + 1));
      const cand = planWith(nt, best.splits + (tk.latin ? 0.015 : 0.1));
      if (cand.score > best.score * 1.02) best = cand;
      else break;
    }
    const rows = best.part.parts.map(([a, b]) => {
      const cs = best.toks[a].cs, ce = best.toks[b].ce;
      return { cs, ce, w: spanW(aw, cs, ce) };
    });
    return { rows, size: Math.max(o.minSize, best.size) };
  }

  /* ================================================================== */
  /* Geometry / bounds                                                   */
  /* ================================================================== */
  const emptyB = () => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  function addB(B, x0, y0, x1, y1) {
    if (x0 < B.x0) B.x0 = x0;
    if (y0 < B.y0) B.y0 = y0;
    if (x1 > B.x1) B.x1 = x1;
    if (y1 > B.y1) B.y1 = y1;
    return B;
  }
  // Add a rect (centre cx,cy in local group space, own rotation rot) to world
  // bounds of a group placed at (gx, gy) with rotation grot.
  function addRect(B, gx, gy, grot, cx, cy, w, h, rot) {
    const c = Math.cos(grot), s = Math.sin(grot);
    const wx = gx + cx * c - cy * s, wy = gy + cx * s + cy * c;
    const a = (rot || 0) + grot;
    const ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
    const hw = (w * ca + h * sa) / 2, hh = (w * sa + h * ca) / 2;
    return addB(B, wx - hw, wy - hh, wx + hw, wy + hh);
  }
  // Scale factor (≤1) and shift that put B inside box.
  function fitInfo(B, box) {
    const bw = B.x1 - B.x0, bh = B.y1 - B.y0;
    const k = Math.min(1, (box.x1 - box.x0) / Math.max(1, bw), (box.y1 - box.y0) / Math.max(1, bh));
    let dx = 0, dy = 0;
    if (B.x0 < box.x0) dx = box.x0 - B.x0;
    else if (B.x1 > box.x1) dx = box.x1 - B.x1;
    if (B.y0 < box.y0) dy = box.y0 - B.y0;
    else if (B.y1 > box.y1) dy = box.y1 - B.y1;
    return { k, dx, dy };
  }
  // Repeatedly build at shrinking sizes until the text bounds fit `box`,
  // then shift into place. build(size) → { L, B } (L.cx/L.cy = group origin).
  function fitLoop(size, box, build) {
    let res = build(size);
    for (let it = 0; it < 6; it++) {
      const f = fitInfo(res.B, box);
      if (f.k >= 0.999) break;
      size *= f.k * 0.985;
      res = build(size);
    }
    const f = fitInfo(res.B, box);
    res.L.cx += f.dx;
    res.L.cy += f.dy;
    res.B.x0 += f.dx; res.B.x1 += f.dx; res.B.y0 += f.dy; res.B.y1 += f.dy;
    res.L.bounds = res.B;
    res.L.size = size;
    return res.L;
  }
  function polyPath(ctx, pts, dx, dy) {
    ctx.beginPath();
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      if (k === 0) ctx.moveTo(p[0] + (dx || 0), p[1] + (dy || 0));
      else ctx.lineTo(p[0] + (dx || 0), p[1] + (dy || 0));
    }
    ctx.closePath();
  }
  function skewQuad(x0, x1, y0, y1, skew) {
    return [[x0 + skew, y0], [x1 + skew, y0], [x1, y1], [x0, y1]];
  }

  /* ================================================================== */
  /* Timing helpers                                                      */
  /* ================================================================== */
  function charT(line, i) {
    const ct = line.charTimes;
    const v = ct && i < ct.length ? ct[i] : NaN;
    return finite(v) ? v : finite(line.start) ? line.start : 0;
  }
  /** 0 before the glyph is due, then ramps to 1 over `dur` seconds. */
  function reveal(line, i, t, dur) {
    return clamp((t - (charT(line, i) - LEAD)) / (dur || 0.18));
  }
  // Normalised timing for a draw call (tolerates partial lt / env).
  function timing(line, lt, env) {
    const showStart = lt && finite(lt.showStart) ? lt.showStart : finite(line.showStart) ? line.showStart : (line.start || 0) - 0.3;
    const showEnd = lt && finite(lt.showEnd) ? lt.showEnd : finite(line.showEnd) ? line.showEnd : (line.end || 0) + 0.6;
    const t = env && finite(env.t) ? env.t : (line.start || 0) + (lt && finite(lt.t) ? lt.t : 0);
    const inP = lt && finite(lt.in) ? clamp(lt.in) : clamp((t - showStart) / 0.3);
    const outP = lt && finite(lt.out) ? clamp(lt.out) : clamp((t - (showEnd - 0.3)) / 0.3);
    return { t, inP, outP, showStart, showEnd };
  }
  function beatOf(env) {
    const b = (env && env.beat) || {};
    return {
      pulse: finite(b.pulse) ? b.pulse : 0,
      index: finite(b.index) ? b.index : 0,
      phase: finite(b.phase) ? b.phase : 0,
      barPulse: finite(b.barPulse) ? b.barPulse : 0,
      intensity: env && finite(env.intensity) ? env.intensity : 0.6,
    };
  }
  // Per-glyph beat jiggle (deterministic from the beat index).
  function jig(bt, seed, i, amt) {
    const p = bt.pulse * (0.35 + 0.65 * bt.intensity) * (amt == null ? 1 : amt);
    if (p < 0.01) return { x: 0, y: 0, r: 0, s: 1 };
    return {
      x: MV.srand(seed, i, bt.index) * 6 * p,
      y: MV.srand(seed, i + 101, bt.index) * 6 * p,
      r: MV.srand(seed, i + 211, bt.index) * 4 * DEG * p,
      s: 1 + 0.04 * p,
    };
  }

  /* ================================================================== */
  /* Drawing primitives                                                  */
  /* ================================================================== */
  /**
   * Draw one glyph with optional hard offset shadow and outline.
   * @param {CanvasRenderingContext2D} ctx
   */
  function glyphText(ctx, ch, font, x, y, fill, stroke, sw, shadow, sx, sy) {
    ctx.font = font;
    if (shadow) {
      ctx.fillStyle = shadow;
      if (stroke && sw) {
        ctx.lineWidth = sw;
        ctx.strokeStyle = shadow;
        ctx.strokeText(ch, x + sx, y + sy);
      }
      ctx.fillText(ch, x + sx, y + sy);
    }
    if (stroke && sw) {
      ctx.lineWidth = sw;
      ctx.strokeStyle = stroke;
      ctx.strokeText(ch, x, y);
    }
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillText(ch, x, y);
    }
  }

  /**
   * Original emblem: a 5-point star pierced by a diagonal slash.
   * @param {CanvasRenderingContext2D} ctx
   * @param {{star?:string, edge?:string, slash?:string, gap?:string, shadow?:string}} [o]
   */
  function drawEmblem(ctx, x, y, r, rot, o) {
    o = o || {};
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot || 0);
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 3;
    if (o.shadow) {
      MV.draw.star(ctx, r * 0.12, r * 0.14, r, r * 0.44, 5);
      ctx.fillStyle = o.shadow;
      ctx.fill();
    }
    MV.draw.star(ctx, 0, 0, r, r * 0.44, 5);
    ctx.fillStyle = o.star || C.white;
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.strokeStyle = o.edge || C.ink;
    ctx.stroke();
    ctx.rotate(-35 * DEG);
    const bw = r * 2.5, bh = Math.max(3, r * 0.26);
    ctx.fillStyle = o.gap || C.white;
    ctx.fillRect(-bw / 2 - r * 0.04, -bh / 2 - r * 0.08, bw + r * 0.08, bh + r * 0.16);
    ctx.fillStyle = o.slash || C.ink;
    MV.draw.skewRect(ctx, -bw / 2, -bh / 2, bw, bh, bh * 0.8);
    ctx.fill();
    ctx.restore();
  }

  // Tile colour combos for ransom tiles. w = weight.
  const COMBOS = [
    { tile: C.white, glyph: C.ink, edge: C.ink, shadow: C.ink, w: 0.29 },
    { tile: C.black, glyph: C.white, edge: C.white, shadow: C.red, w: 0.26 },
    { tile: C.red, glyph: C.white, edge: C.ink, shadow: C.ink, w: 0.18 },
    { tile: C.red, glyph: C.ink, edge: C.ink, shadow: C.ink, w: 0.09 },
    { tile: C.paper, glyph: C.red, edge: C.ink, shadow: C.ink, w: 0.12 },
    { tile: C.black, glyph: C.red, edge: C.white, shadow: C.white, w: 0.06 },
  ];
  const CARD_COMBOS = [
    { tile: C.white, glyph: C.ink, edge: C.ink, shadow: C.ink, w: 0.42 },
    { tile: C.black, glyph: C.white, edge: C.white, shadow: C.ink, w: 0.36 },
    { tile: C.paper, glyph: C.red, edge: C.ink, shadow: C.ink, w: 0.14 },
    { tile: C.ink, glyph: C.red, edge: C.white, shadow: C.ink, w: 0.08 },
  ];
  function pickW(list, u) {
    let s = 0;
    for (const x of list) s += x.w;
    let a = u * s;
    for (const x of list) {
      a -= x.w;
      if (a <= 0) return x;
    }
    return list[list.length - 1];
  }

  /**
   * Build ransom tiles (cut-paper glyphs) for chars of a line. Returns per-char
   * tile specs in em units (w, h, rot, dy, face, combo, jit) plus advances.
   */
  function ransomSpecs(I, seed, combos) {
    const aw = new Array(I.n).fill(0);
    const spec = new Array(I.n).fill(null);
    let prev = -1, prev2 = -1, prevFace = -1;
    for (let i = 0; i < I.n; i++) {
      const ch = I.chars[i];
      if (I.sp[i]) { aw[i] = I.lat[i - 1] && I.lat[i + 1] ? 0.36 : 0.3; continue; }
      const latin = !!I.lat[i];
      const faces = latin ? F.ransomLatin : F.ransom;
      let fi = Math.floor(MV.rand(seed, i, 11) * faces.length) % faces.length;
      if (fi === prevFace) fi = (fi + 1 + Math.floor(MV.rand(seed, i, 12) * (faces.length - 1))) % faces.length;
      prevFace = fi;
      const fc = faces[fi];
      let combo = pickW(combos, MV.rand(seed, i, 13));
      let ci = combos.indexOf(combo);
      if (ci === prev || (ci === prev2 && MV.rand(seed, i, 14) < 0.5)) {
        ci = (ci + 1 + Math.floor(MV.rand(seed, i, 15) * (combos.length - 1))) % combos.length;
        combo = combos[ci];
      }
      prev2 = prev;
      prev = ci;
      const jit = 0.86 + 0.3 * MV.rand(seed, i, 16) + (latin ? 0.04 : 0);
      const fsEm = 0.74 * jit * (fc.scale || 1);
      const m = met(ch, fc);
      const glyphW = latin ? Math.max(0.3, m.l + m.r) : 1;
      const w = latin ? Math.max(0.5, glyphW * fsEm + 0.2) : fsEm + 0.22 + 0.06 * MV.rand(seed, i, 17);
      const h = fsEm * (latin ? 1.0 : 1.0) + 0.26 + 0.08 * MV.rand(seed, i, 18);
      // Irregular cut-paper quad (+ occasional clipped corner).
      const jx = (k) => MV.srand(seed, i, 30 + k) * 0.07;
      const pts = [[-w / 2 + jx(0), -h / 2 + jx(1)], [w / 2 + jx(2), -h / 2 + jx(3)], [w / 2 + jx(4), h / 2 + jx(5)], [-w / 2 + jx(6), h / 2 + jx(7)]];
      if (MV.rand(seed, i, 40) < 0.28) {
        const k = Math.floor(MV.rand(seed, i, 41) * 4);
        const a = pts[k], b = pts[(k + 1) % 4], z = pts[(k + 3) % 4];
        const f = 0.18 + 0.12 * MV.rand(seed, i, 42);
        pts.splice(k, 1, [lerp(a[0], z[0], f), lerp(a[1], z[1], f)], [lerp(a[0], b[0], f), lerp(a[1], b[1], f)]);
      }
      spec[i] = {
        ch, latin, fc, combo, jit, fsEm, w, h, pts,
        rot: MV.srand(seed, i, 19) * 11 * DEG,
        dy: MV.srand(seed, i, 20) * 0.07,
        spin: MV.srand(seed, i, 21) < 0 ? -1 : 1,
        inkX: -(m.r - m.l) / 2, inkY: (m.asc - m.desc) / 2,
      };
      aw[i] = w * (latin ? 0.95 : 0.9);
    }
    return { aw, spec };
  }

  // Place ransom tiles for rows (group-local px). Returns glyph list.
  function placeTiles(I, rows, spec, aw, size, o) {
    const glyphs = [];
    const R = rows.length;
    const pitch = size * o.pitch;
    rows.forEach((row, r) => {
      const rw = row.w * size;
      let x = -rw / 2 + (r - (R - 1) / 2) * o.stagger * size;
      const y0 = (r - (R - 1) / 2) * pitch;
      for (let i = row.cs; i < row.ce; i++) {
        const a = aw[i] * size;
        const s = spec[i];
        if (s) {
          const cx = x + a / 2;
          const fs = s.fsEm * size;
          const sh = size * 0.07;
          glyphs.push({
            i, r, ch: s.ch, x: cx, y: y0 + s.dy * size + cx * o.rowSlope, w: s.w * size, h: s.h * size,
            rot: s.rot, spin: s.spin, combo: s.combo, latin: s.latin,
            font: MV.text.font(fs, s.fc.family, s.fc.weight, s.fc.style),
            pts: s.pts.map((p) => [p[0] * size, p[1] * size]),
            gx: s.inkX * fs, gy: s.inkY * fs,
            edge: Math.max(2.5, size * 0.028),
            shx: sh * 0.9, shy: sh * 1.15,
          });
        }
        x += a;
      }
    });
    return glyphs;
  }

  /**
   * Draw one ransom tile (group-local coordinates already applied).
   * @param {number} s scale (pop), @param {number} rotAdd extra rotation
   */
  function drawTile(ctx, g, s, rotAdd, dx, dy, alpha, grot) {
    if (s <= 0.01 || alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(g.x + dx, g.y + dy);
    // Hard drop shadow in world direction (independent of tile rotation).
    const rr = g.rot + rotAdd;
    const c = Math.cos(-(rr + (grot || 0))), sn = Math.sin(-(rr + (grot || 0)));
    const sx = g.shx * c - g.shy * sn, sy = g.shx * sn + g.shy * c;
    ctx.rotate(rr);
    ctx.scale(s, s);
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 4;
    polyPath(ctx, g.pts, sx, sy);
    ctx.fillStyle = g.combo.shadow;
    ctx.fill();
    polyPath(ctx, g.pts, 0, 0);
    ctx.fillStyle = g.combo.tile;
    ctx.fill();
    ctx.lineWidth = g.edge;
    ctx.strokeStyle = g.combo.edge;
    ctx.stroke();
    ctx.font = g.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = g.combo.glyph;
    ctx.fillText(g.ch, g.gx, g.gy);
    ctx.restore();
  }

  /**
   * Huge condensed Latin text (Anton, skewed italic) with a hard red offset
   * shadow and thick black outline; words pop in as `progress` goes 0→1.
   * (x, y) = left end of the baseline. Returns the advance width.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} text
   * @param {number} progress 0..1 (≥1 = all words shown)
   * @param {object} [env] frame env (beat jiggle)
   * @param {number} [seed]
   */
  function drawLatin(ctx, text, x, y, size, progress, env, seed) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return 0;
    seed = seed || 1;
    const fc = FACE.anton;
    const font = fontStr(fc, size);
    const spaceW = met(' ', fc).w * size * 1.2;
    const bt = beatOf(env);
    const n = words.length;
    const pr = progress == null ? 1 : progress;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    let cx = x;
    for (let k = 0; k < n; k++) {
      const w = words[k];
      let ww = 0;
      for (const ch of MV.text.chars(w)) ww += met(ch, fc).w * size;
      const p = clamp(pr * n - k);
      if (p > 0) {
        const s = E.outBack(clamp(p / 0.6), 2.2);
        const j = jig(bt, seed, k, 0.8);
        ctx.save();
        ctx.translate(cx + ww / 2 + j.x, y - size * 0.35 + j.y);
        ctx.rotate(j.r);
        ctx.scale(s * j.s, s * j.s);
        ctx.transform(1, 0, -0.21, 1, 0, 0);
        glyphText(ctx, w, font, -ww / 2, size * 0.35, C.white, C.ink, size * 0.1, C.red, size * 0.07, size * 0.07);
        ctx.restore();
      }
      cx += ww + spaceW;
    }
    ctx.restore();
    return cx - spaceW - x;
  }

  // Radial halftone sprite (dots grow toward the rim), rendered once per colour.
  const discCache = new Map();
  function halftoneDisc(color) {
    let c = discCache.get(color);
    if (!c) {
      const N = 640, R = N / 2 / 1.1, cell = R * 0.1;
      const m = MV.makeCanvas(N, N);
      m.ctx.fillStyle = color;
      m.ctx.beginPath();
      for (let gy = -N / 2; gy <= N / 2; gy += cell) {
        for (let gx = -N / 2; gx <= N / 2; gx += cell) {
          const rad = clamp((Math.hypot(gx, gy) / R - 0.5) / 0.55) * cell * 0.52;
          if (rad < 0.6) continue;
          m.ctx.moveTo(N / 2 + gx + rad, N / 2 + gy);
          m.ctx.arc(N / 2 + gx, N / 2 + gy, rad, 0, TAU);
        }
      }
      m.ctx.fill();
      c = m.canvas;
      discCache.set(color, c);
    }
    return c;
  }

  /** Width (px) of `text` as drawLatin renders it at `size`. */
  function measureLatin(text, size) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    let w = 0;
    for (const wd of words) for (const ch of MV.text.chars(wd)) w += met(ch, FACE.anton).w * size;
    return w + Math.max(0, words.length - 1) * met(' ', FACE.anton).w * size * 1.2;
  }

  // Cached horizontal scanline pattern (per context).
  const scanCache = new WeakMap();
  function scanPattern(ctx) {
    let p = scanCache.get(ctx);
    if (!p) {
      const t = MV.makeCanvas(4, 6);
      t.ctx.fillStyle = 'rgba(255,255,255,0.07)';
      t.ctx.fillRect(0, 0, 4, 2);
      p = ctx.createPattern(t.canvas, 'repeat');
      scanCache.set(ctx, p);
    }
    return p;
  }

  // Speaker for the dialog name plate: explicit fields, then the preset that
  // contains this line's key, else null (→ star symbol).
  function speakerOf(line) {
    if (MV.LyricFX && MV.LyricFX.speaker) return String(MV.LyricFX.speaker);
    const c = [line.speaker, line.artist, line.meta && line.meta.artist];
    for (const x of c) if (x) return String(x);
    try {
      if (line.key && Array.isArray(MV.presets)) {
        for (const p of MV.presets) {
          if (p && p.meta && p.meta.artist && Array.isArray(p.lines) && p.lines.some((l) => l.key === line.key)) return String(p.meta.artist);
        }
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  // Common advance array for row-text styles (heavy JP face + Latin face).
  function rowAdvances(I, jpFace, laFace, track) {
    const aw = new Array(I.n).fill(0);
    for (let i = 0; i < I.n; i++) {
      const ch = I.chars[i];
      if (I.sp[i]) aw[i] = I.lat[i - 1] && I.lat[i + 1] ? met(' ', laFace).w * 1.1 : 0.42;
      else if (!I.lat[i]) aw[i] = 1 + (track || 0);
      else aw[i] = met(ch, laFace).w * (laFace.scale || 1) + 0.02;
    }
    return aw;
  }
  // Row glyph placement (left-aligned from x0, centred on y); returns glyphs.
  function placeRow(I, row, aw, size, x0, y, jpFace, laFace, extra) {
    const out = [];
    let x = x0;
    const vcJ = vcenter(jpFace, false), vcL = vcenter(laFace, true);
    for (let i = row.cs; i < row.ce; i++) {
      const a = aw[i] * size;
      if (!I.sp[i]) {
        const latin = !!I.lat[i];
        const fc = latin ? laFace : jpFace;
        const g = {
          i, ch: I.chars[i], latin, x, y, w: a, cx: x + a / 2,
          by: y + (latin ? vcL : vcJ) * size,
          font: fontStr(fc, size),
        };
        if (extra) Object.assign(g, extra(i, g));
        out.push(g);
      }
      x += a;
    }
    return out;
  }
  function rowTimes(line, rows) {
    return rows.map((r) => {
      let t = Infinity;
      for (let i = r.cs; i < r.ce; i++) t = Math.min(t, charT(line, i));
      return finite(t) ? t : charT(line, r.cs);
    });
  }

  // Refresh a layout in place when web-font metrics changed since it was made.
  function fresh(name, line, L) {
    if (L && L.epoch !== epoch && L.name === name) {
      const style = MV.lyricStyles.get(name);
      try {
        const nl = style.layout(line, L.opts);
        for (const k of Object.keys(L)) delete L[k];
        Object.assign(L, nl);
      } catch (e) {
        L.epoch = epoch;
      }
    }
    return L;
  }
  const optsOf = (x) => (x && typeof x === 'object' && typeof x.measureText !== 'function' ? x : null);
  const seedOf = (line) => (finite(line.seed) ? line.seed >>> 0 : MV.hash32(line.text || '', 7));
  const EMPTY = (name, opts) => ({ name, epoch, opts, empty: true, size: 0, cx: W / 2, cy: H / 2, rows: [], glyphs: [], bounds: { x0: W / 2, y0: H / 2, x1: W / 2, y1: H / 2 } });

  /* ================================================================== */
  /* Style: ransom — cut-paper collage                                   */
  /* ================================================================== */
  MV.lyricStyles.register('ransom', {
    layout(line, ctxOrOpts) {
      const opts = optsOf(ctxOrOpts);
      const I = charInfo(line);
      if (!I.n) return EMPTY('ransom', opts);
      const seed = seedOf(line);
      const { aw, spec } = ransomSpecs(I, seed, COMBOS);
      const long = I.n > 30;
      const plan = planRows(line, I, aw, { maxW: 1500, maxH: 700, lh: 1.3, maxRows: long ? 4 : 3, maxSize: 236, minSize: 60, prefSize: long ? 118 : 138, rowPenalty: 0.07 });
      const dir = MV.rand(seed, 3) < 0.5 ? 1 : -1;
      const grot = (dir > 0 ? -1 : 1) * (3 + 2.5 * MV.rand(seed, 4)) * DEG;
      const o = { pitch: 1.3, stagger: 0.42 * dir, rowSlope: 0 };
      const cx0 = 960 + MV.srand(seed, 5) * 50, cy0 = 520 + MV.srand(seed, 6) * 40;
      const L = fitLoop(plan.size, BOX, (size) => {
        const glyphs = placeTiles(I, plan.rows, spec, aw, size, o);
        const B = emptyB();
        for (const g of glyphs) addRect(B, cx0, cy0, grot, g.x + g.shx / 2, g.y + g.shy / 2, g.w + g.shx + 8, g.h + g.shy + 8, g.rot);
        return { L: { cx: cx0, cy: cy0, rot: grot, glyphs, rows: plan.rows }, B };
      });
      // Underline slashes (one per row) drawn during the entrance.
      L.slashes = plan.rows.map((row, r) => {
        const gs = L.glyphs.filter((g) => g.r === r);
        if (!gs.length) return null;
        let x0 = Infinity, x1 = -Infinity, y = -Infinity;
        for (const g of gs) { x0 = Math.min(x0, g.x - g.w / 2); x1 = Math.max(x1, g.x + g.w / 2); y = Math.max(y, g.y + g.h / 2); }
        return { x0: x0 - L.size * 0.4, x1: x1 + L.size * 0.4, y: y + L.size * 0.02, first: gs[0].i };
      }).filter(Boolean);
      return Object.assign(L, { name: 'ransom', epoch, opts, seed });
    },
    draw(ctx, line, L, lt, env) {
      L = fresh('ransom', line, L);
      if (!L || L.empty) return;
      const T = timing(line, lt, env);
      const bt = beatOf(env);
      const n = L.glyphs.length;
      const eIn = E.outExpo(T.inP);
      ctx.save();
      ctx.translate(L.cx, L.cy);
      ctx.rotate(L.rot);
      // Entrance/underline: a red slash + thin black one under each row.
      for (let r = 0; r < L.slashes.length; r++) {
        const s = L.slashes[r];
        const tr = r === 0 ? T.showStart : charT(line, s.first) - 0.2;
        const p = E.outExpo(clamp((T.t - tr) / 0.3)) * (1 - E.inQuad(T.outP));
        if (p <= 0) continue;
        const h = L.size * 0.16;
        const x1 = lerp(s.x0, s.x1, p);
        ctx.fillStyle = C.red;
        MV.draw.skewRect(ctx, s.x0, s.y - h / 2, x1 - s.x0, h, h * 1.4);
        ctx.fill();
        ctx.fillStyle = C.ink;
        MV.draw.skewRect(ctx, s.x0 + L.size * 0.25, s.y + h * 0.75, (x1 - s.x0) * 0.8, h * 0.35, h * 0.6);
        ctx.fill();
      }
      for (let k = 0; k < n; k++) {
        const g = L.glyphs[k];
        const p = reveal(line, g.i, T.t, 0.2);
        if (p <= 0) continue;
        let s = E.outBack(p, 2.6) * lerp(0.9, 1, eIn);
        let rot = (1 - p) * g.spin * 28 * DEG;
        let dx = 0, dy = 0, a = clamp(p * 5);
        const j = jig(bt, L.seed, g.i);
        s *= j.s; rot += j.r; dx += j.x; dy += j.y;
        if (T.outP > 0) {
          const q = clamp(T.outP * 1.5 - (k / Math.max(1, n)) * 0.5);
          const e = E.inQuad(q);
          const ang = -35 * DEG + MV.srand(L.seed, g.i, 50) * 0.9;
          const dist = e * (700 + 400 * MV.rand(L.seed, g.i, 51));
          dx += Math.cos(ang) * dist * (g.x < 0 ? -1 : 1);
          dy += Math.sin(ang) * dist * (g.x < 0 ? -1 : 1) + e * e * 300;
          rot += e * g.spin * 160 * DEG;
          s *= 1 - 0.4 * e;
          a *= 1 - E.inQuad(q);
        }
        drawTile(ctx, g, s, rot, dx, dy, a, L.rot);
      }
      ctx.restore();
    },
  });

  /* ================================================================== */
  /* Style: slash — rows on long skewed black bands with red under-bands */
  /* ================================================================== */
  function slashLayout(line, opts) {
    const I = charInfo(line);
    if (!I.n) return EMPTY('slash', opts);
    const seed = seedOf(line);
    const jp = FACE.heavy, la = FACE.anton;
    const aw = rowAdvances(I, jp, la, 0.02);
    const plan = planRows(line, I, aw, { maxW: 1340, maxH: 660, lh: 1.58, maxRows: 3, maxSize: 184, minSize: 54, prefSize: 118, rowPenalty: 0.05 });
    const grot = -(6 + 2 * MV.rand(seed, 2)) * DEG;
    const cx0 = 960 + MV.srand(seed, 3) * 40, cy0 = 510 + MV.srand(seed, 4) * 40;
    const first = MV.rand(seed, 5) < 0.5 ? -1 : 1; // side of first row
    return Object.assign(fitLoop(plan.size, BOX, (size) => {
      const R = plan.rows.length;
      const pitch = size * 1.58;
      const bh = size * 1.26;
      const pad = size * 0.5;
      const rows = [];
      const B = emptyB();
      plan.rows.forEach((row, r) => {
        const tw = row.w * size;
        const off = (r - (R - 1) / 2) * size * 0.85 * -first;
        const x0 = -tw / 2 + off;
        const y = (r - (R - 1) / 2) * pitch;
        const side = r % 2 === 0 ? first : -first;
        const glyphs = placeRow(I, row, aw, size, x0, y, jp, la);
        for (const g of glyphs) addRect(B, cx0, cy0, grot, g.cx, y, g.w + size * 0.18, size * 1.15, 0);
        rows.push({
          cs: row.cs, ce: row.ce, y, x0, x1: x0 + tw, side, glyphs, bh, pad,
          // Band runs off-screen on the side it slams in from.
          bx0: side < 0 ? -1500 : x0 - pad, bx1: side < 0 ? x0 + tw + pad : 1500,
        });
      });
      return { L: { cx: cx0, cy: cy0, rot: grot, rows, glyphs: [].concat(...rows.map((r) => r.glyphs)) }, B };
    }), { name: 'slash', epoch, opts, seed });
  }
  function drawSlashRows(ctx, line, L, T, bt) {
    const size = L.size;
    for (let r = 0; r < L.rows.length; r++) {
      const row = L.rows[r];
      const tr = r === 0 ? Math.min(T.showStart, charT(line, row.cs) - 0.26) : charT(line, row.cs) - 0.26;
      const e = T.t - tr;
      if (e < 0) continue;
      const p = clamp(e / 0.24), pu = clamp((e - 0.07) / 0.26);
      const slide = (1 - E.outExpo(p)) * 2300 * row.side;
      const slideU = (1 - E.outExpo(pu)) * 2300 * row.side;
      const bump = e > 0.24 && e < 0.44 ? Math.sin(((e - 0.24) / 0.2) * Math.PI) * -row.side * size * 0.06 : 0;
      const bh = row.bh, sk = bh * 0.42;
      // Red under-band (offset, a bit longer on the text end).
      if (pu > 0) {
        ctx.fillStyle = C.red;
        const ux0 = row.side < 0 ? row.bx0 : row.bx0 - size * 0.35;
        const ux1 = row.side < 0 ? row.bx1 + size * 0.35 : row.bx1;
        polyPath(ctx, skewQuad(ux0 + slideU + size * 0.12, ux1 + slideU + size * 0.12, row.y - bh / 2 + bh * 0.3, row.y + bh / 2 + bh * 0.24, sk));
        ctx.fill();
      }
      // Black band with a white hairline.
      ctx.fillStyle = C.black;
      polyPath(ctx, skewQuad(row.bx0 + slide + bump, row.bx1 + slide + bump, row.y - bh / 2, row.y + bh / 2, sk));
      ctx.fill();
      ctx.fillStyle = C.white;
      polyPath(ctx, skewQuad(row.bx0 + slide + bump, row.bx1 + slide + bump, row.y + bh / 2 - bh * 0.1, row.y + bh / 2 - bh * 0.065, sk * 0.1));
      ctx.fill();
      // Glyphs.
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.lineJoin = 'round';
      for (const g of row.glyphs) {
        const q = reveal(line, g.i, T.t, 0.16);
        if (q <= 0) continue;
        const s = lerp(1.85, 1, E.outExpo(q));
        const j = jig(bt, L.seed, g.i, 0.7);
        ctx.save();
        ctx.translate(g.cx + slide + bump + j.x, g.y + j.y);
        ctx.rotate(j.r);
        ctx.scale(s * j.s, s * j.s);
        ctx.transform(1, 0, -0.2, 1, 0, 0);
        ctx.globalAlpha *= clamp(q * 3);
        const fill = q < 0.45 ? C.redHot : C.white;
        glyphText(ctx, g.ch, g.font, -g.w / 2, g.by - g.y, fill, null, 0, C.red, size * 0.05, size * 0.05);
        ctx.restore();
      }
    }
  }
  MV.lyricStyles.register('slash', {
    layout: (line, o) => slashLayout(line, optsOf(o)),
    draw(ctx, line, L, lt, env) {
      L = fresh('slash', line, L);
      if (!L || L.empty) return;
      const T = timing(line, lt, env);
      const bt = beatOf(env);
      ctx.save();
      ctx.translate(L.cx, L.cy);
      ctx.rotate(L.rot);
      if (T.outP <= 0) {
        drawSlashRows(ctx, line, L, T, bt);
      } else {
        // Exit: slice diagonally; halves slide apart along the cut.
        const o = T.outP;
        const ang = -62 * DEG;
        const dxC = Math.cos(ang), dyC = Math.sin(ang);
        const nx = -dyC, ny = dxC;
        const d = E.inQuad(o) * 900, sep = E.outExpo(o) * L.size * 0.35;
        const big = 4000;
        for (let side = -1; side <= 1; side += 2) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(-dxC * big, -dyC * big);
          ctx.lineTo(dxC * big, dyC * big);
          ctx.lineTo(dxC * big + nx * big * side, dyC * big + ny * big * side);
          ctx.lineTo(-dxC * big + nx * big * side, -dyC * big + ny * big * side);
          ctx.closePath();
          ctx.clip();
          ctx.translate(dxC * d * side + nx * sep * side, dyC * d * side + ny * sep * side);
          ctx.globalAlpha *= 1 - E.inCubic(o);
          drawSlashRows(ctx, line, L, T, bt);
          ctx.restore();
        }
        if (o < 0.4) {
          const w = (1 - o / 0.4) * L.size * 0.12;
          ctx.fillStyle = C.white;
          ctx.beginPath();
          ctx.moveTo(-dxC * 1400 + nx * w, -dyC * 1400 + ny * w);
          ctx.lineTo(dxC * 1400, dyC * 1400);
          ctx.lineTo(-dxC * 1400 - nx * w, -dyC * 1400 - ny * w);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    },
  });

  /* ================================================================== */
  /* Style: impact — one giant word per phrase, burst, shock ring        */
  /* ================================================================== */
  MV.lyricStyles.register('impact', {
    layout(line, ctxOrOpts) {
      const opts = optsOf(ctxOrOpts);
      const I = charInfo(line);
      if (!I.n) return EMPTY('impact', opts);
      const seed = seedOf(line);
      const jp = FACE.heavy, la = FACE.anton;
      const aw = rowAdvances(I, jp, la, 0);
      // Words: phrases, long ones split, then merged down to ≤ 6.
      let toks = [];
      tokens(line, I).forEach((t) => (toks = toks.concat(splitTok(t, I, aw, 7.2, 0))));
      while (toks.length > 6) {
        let bi = 0, bw = Infinity;
        for (let k = 0; k < toks.length - 1; k++) {
          const w = spanW(aw, toks[k].cs, toks[k + 1].ce);
          if (w < bw) { bw = w; bi = k; }
        }
        toks.splice(bi, 2, { cs: toks[bi].cs, ce: toks[bi + 1].ce, latin: toks[bi].latin && toks[bi + 1].latin });
      }
      const multi = toks.length > 1;
      const cxG = multi ? 790 : 960, cyG = 510 + MV.srand(seed, 2) * 25;
      const maxW = multi ? 1160 : 1480;
      const box = multi ? { x0: BOX.x0, y0: BOX.y0, x1: 1400, y1: BOX.y1 } : BOX;
      const words = toks.map((tk, k) => {
        const w1 = spanW(aw, tk.cs, tk.ce);
        let rows = [{ cs: tk.cs, ce: tk.ce, w: w1 }];
        let size = Math.min(420, maxW / w1);
        if (size < 210 && tk.ce - tk.cs > 3) {
          // Too long for one giant row: two rows.
          const parts = splitTok(tk, I, aw, w1 / 2 + 0.6, 0);
          if (parts.length >= 2) {
            const h = Math.ceil(parts.length / 2);
            const a = parts.slice(0, h), b = parts.slice(h);
            rows = [{ cs: a[0].cs, ce: a[a.length - 1].ce }, { cs: b[0].cs, ce: b[b.length - 1].ce }];
            rows.forEach((r) => (r.w = spanW(aw, r.cs, r.ce)));
            size = Math.min(360, maxW / Math.max(rows[0].w, rows[1].w), 680 / (2 * 1.06));
          }
        }
        size = Math.max(80, size);
        const rot = (k % 2 === 0 ? -7 : 5) * DEG + MV.srand(seed, k, 3) * 2 * DEG;
        const Lw = fitLoop(size, box, (sz) => {
          const R = rows.length, pitch = sz * 1.06;
          const gl = [];
          const B = emptyB();
          rows.forEach((row, r) => {
            const tw = row.w * sz;
            const y = (r - (R - 1) / 2) * pitch;
            const x0 = -tw / 2 + (r - (R - 1) / 2) * sz * 0.3;
            const g = placeRow(I, row, aw, sz, x0, y, jp, la);
            for (const q of g) addRect(B, cxG, cyG, rot, q.cx, y, q.w + sz * 0.2, sz * 1.2, 0);
            gl.push(...g);
          });
          return { L: { cx: cxG, cy: cyG, rot, glyphs: gl, rows }, B };
        });
        let wx = Infinity, wX = -Infinity, wy = Infinity, wY = -Infinity;
        for (const g of Lw.glyphs) { wx = Math.min(wx, g.x); wX = Math.max(wX, g.x + g.w); wy = Math.min(wy, g.y - Lw.size / 2); wY = Math.max(wY, g.y + Lw.size / 2); }
        const tw = wX - wx, th = wY - wy;
        return {
          cs: tk.cs, ce: tk.ce, w1, cx: Lw.cx, cy: Lw.cy, rot, size: Lw.size, glyphs: Lw.glyphs, bounds: Lw.bounds,
          ox: (wx + wX) / 2, oy: (wy + wY) / 2, tw, th,
          br: clamp(Math.max(tw * 0.43, th * 0.56) + Lw.size * 0.16, 160, 390),
        };
      });
      // Cluster slots: earlier words stack as single-row labels at the right.
      const B = emptyB();
      let y = 150;
      const slotW = 330;
      words.forEach((wd, k) => {
        const ls = clamp(slotW / Math.max(0.5, wd.w1), 34, 92);
        const lw = wd.w1 * ls, lh = ls * 1.32;
        const x = 1800 - lw / 2 - ls * 0.42 - (k % 2) * 24;
        wd.slot = { x, y: y + lh / 2, size: ls, w: lw, h: lh, rot: (k % 2 === 0 ? -5 : 3) * DEG };
        // Label-local glyph centres (single row, centred on the slot).
        let lx = -lw / 2;
        for (let i = wd.cs; i < wd.ce; i++) {
          const g = wd.glyphs.find((q) => q.i === i);
          const a = aw[i] * ls;
          if (g) g.lx = lx + a / 2;
          lx += a;
        }
        y += lh + 18;
      });
      if (y > BOX.y1 && words.length > 1) {
        const k = (BOX.y1 - 150) / (y - 150);
        words.forEach((wd) => {
          const s = wd.slot;
          s.y = 150 + (s.y - 150) * k;
          s.size *= k; s.w *= k; s.h *= k;
          s.x = 1800 - s.w / 2 - s.size * 0.42;
          wd.glyphs.forEach((g) => (g.lx *= k));
        });
      }
      words.forEach((wd, k) => {
        if (k < words.length - 1) addRect(B, wd.slot.x, wd.slot.y, 0, 0, 0, wd.slot.w + wd.slot.size, wd.slot.h, wd.slot.rot);
        addB(B, wd.bounds.x0, wd.bounds.y0, wd.bounds.x1, wd.bounds.y1);
      });
      const size = Math.max.apply(null, words.map((w) => w.size));
      return { name: 'impact', epoch, opts, seed, words, size, glyphs: [].concat(...words.map((w) => w.glyphs)), bounds: B, cx: 0, cy: 0 };
    },
    draw(ctx, line, L, lt, env) {
      L = fresh('impact', line, L);
      if (!L || L.empty) return;
      const T = timing(line, lt, env);
      const bt = beatOf(env);
      const words = L.words;
      const starts = words.map((w) => {
        let t = Infinity;
        for (let i = w.cs; i < w.ce; i++) t = Math.min(t, charT(line, i));
        return t - LEAD;
      });
      let cur = -1;
      for (let k = 0; k < words.length; k++) if (T.t >= starts[k]) cur = k;
      const outE = E.inQuad(T.outP);
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      // Lead-in anticipation: a small spinning burst.
      if (cur < 0) {
        const w = words[0];
        const s = E.outBack(T.inP) * 0.28;
        if (s > 0.01) {
          ctx.save();
          ctx.translate(w.cx + w.ox, w.cy + w.oy);
          ctx.rotate(T.t * 2.4);
          MV.draw.burst(ctx, 0, 0, w.br * s * 0.55, w.br * s, 12, L.seed, 0.3);
          ctx.fillStyle = C.red;
          ctx.fill();
          ctx.lineWidth = 7;
          ctx.strokeStyle = C.ink;
          ctx.stroke();
          ctx.restore();
        }
      }
      // Earlier words fly glyph by glyph into the stacked cluster.
      for (let k = 0; k < cur; k++) {
        const w = words[k], sl = w.slot;
        const t1 = T.t - starts[k + 1];
        const pp = E.outExpo(clamp(t1 / 0.3));
        const ex = outE * 760;
        // Label plate.
        if (pp > 0.45) {
          const q = E.outBack(clamp((pp - 0.45) / 0.55), 1.6);
          ctx.save();
          ctx.translate(sl.x + ex, sl.y);
          ctx.rotate(sl.rot);
          ctx.globalAlpha *= 1 - outE;
          const bw = (sl.w + sl.size * 0.8) * q, bh = sl.h;
          ctx.fillStyle = C.red;
          MV.draw.skewRect(ctx, -bw / 2 + sl.size * 0.14, -bh / 2 + sl.size * 0.16, bw, bh, bh * 0.3);
          ctx.fill();
          ctx.fillStyle = C.black;
          MV.draw.skewRect(ctx, -bw / 2, -bh / 2, bw, bh, bh * 0.3);
          ctx.fill();
          ctx.restore();
        }
        const cg = Math.cos(w.rot), sg = Math.sin(w.rot), cs = Math.cos(sl.rot), ss = Math.sin(sl.rot);
        const k2 = sl.size / w.size;
        w.glyphs.forEach((g, n) => {
          if (reveal(line, g.i, T.t, 0.1) <= 0) return;
          const p = E.outExpo(clamp((t1 - n * 0.018) / 0.3));
          const gx = w.cx + g.cx * cg - g.y * sg, gy = w.cy + g.cx * sg + g.y * cg;
          const lx = sl.x + g.lx * cs, ly = sl.y + g.lx * ss;
          ctx.save();
          ctx.globalAlpha *= 1 - outE;
          ctx.translate(lerp(gx, lx, p) + ex, lerp(gy, ly, p));
          ctx.rotate(lerp(w.rot, sl.rot, p) + Math.sin(p * Math.PI) * 0.5 * (n % 2 ? 1 : -1));
          const s = lerp(1, k2, p);
          ctx.scale(s, s);
          glyphText(ctx, g.ch, g.font, -g.w / 2, g.by - g.y, C.white, p < 0.9 ? C.ink : null, w.size * 0.07, null);
          ctx.restore();
        });
      }
      // Current word.
      if (cur >= 0) {
        const w = words[cur];
        const e = T.t - starts[cur];
        const inv = cur % 2 === 1; // white burst, black type
        const cxw = w.cx + w.ox, cyw = w.cy + w.oy;
        // Exit: a quick swell, then a spinning collapse (no muddy alpha fade).
        const exitS = Math.max(0, 1 - E.inBack(T.outP, 2.2));
        if (exitS <= 0.01) { ctx.restore(); return; }
        ctx.save();
        ctx.translate(cxw, cyw);
        ctx.rotate(E.inQuad(T.outP) * 0.6 * (cur % 2 ? 1 : -1));
        ctx.scale(exitS, exitS);
        // Starburst: black hard shadow, burst, halftone rim.
        const bp = E.outBack(clamp(e / 0.2), 1.8) * (1 + 0.07 * bt.pulse);
        if (bp > 0.01) {
          const r = w.br * bp;
          const rr = cur * 0.7 + e * 0.22 + 0.04 * bt.pulse;
          ctx.save();
          ctx.rotate(rr);
          MV.draw.burst(ctx, 18, 20, r * 0.7, r * 1.05, 15, L.seed + cur, 0.3);
          ctx.fillStyle = C.ink;
          ctx.fill();
          MV.draw.burst(ctx, 0, 0, r * 0.7, r * 1.05, 15, L.seed + cur, 0.3);
          ctx.fillStyle = inv ? C.white : C.red;
          ctx.fill();
          ctx.lineWidth = 12;
          ctx.strokeStyle = C.ink;
          ctx.stroke();
          ctx.clip();
          ctx.drawImage(halftoneDisc(inv ? 'rgba(0,0,0,0.16)' : C.redDeep), -r * 1.1, -r * 1.1, r * 2.2, r * 2.2);
          ctx.restore();
        }
        // Halftone shock ring.
        const rp = clamp(e / 0.55);
        if (rp < 1) {
          const R = w.br * (0.8 + 1.4 * E.outCubic(rp));
          const dotR = 15 * (1 - rp) + 2;
          ctx.fillStyle = inv ? C.ink : C.white;
          ctx.beginPath();
          for (let ring = 0; ring < 3; ring++) {
            const rr = R * (1 - ring * 0.08);
            const cnt = Math.floor(30 + rr * 0.07);
            const dr = dotR * (1 - ring * 0.3);
            for (let q = 0; q < cnt; q++) {
              const a = (q / cnt) * TAU + ring * 0.2;
              const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.84;
              ctx.moveTo(x + dr, y);
              ctx.arc(x, y, dr, 0, TAU);
            }
          }
          ctx.fill();
        }
        // Slam from the camera with motion-trail copies.
        const slam = (tt) => lerp(3, 1, E.outExpo(clamp(tt / 0.17)));
        const j = jig(bt, L.seed, cur, 1);
        const trail = e < 0.16 ? 2 : 0;
        ctx.rotate(w.rot + j.r);
        const fill = inv ? C.ink : C.white, stroke = inv ? C.white : C.ink, shadow = inv ? C.red : C.ink;
        for (let c = trail; c >= 0; c--) {
          const s = slam(e - c * 0.035) * j.s;
          if (c > 0 && Math.abs(s - slam(e) * j.s) < 0.02) continue;
          ctx.save();
          ctx.scale(s, s);
          ctx.translate(-w.ox + j.x, -w.oy + j.y);
          if (c > 0) {
            // Motion trail: hard red outlines of the word at earlier scales.
            ctx.globalAlpha *= 0.9 / c;
            ctx.lineWidth = (w.size * 0.06) / s;
            ctx.strokeStyle = C.red;
            for (const g of w.glyphs) {
              if (reveal(line, g.i, T.t, 0.12) <= 0) continue;
              ctx.font = g.font;
              ctx.strokeText(g.ch, g.x, g.by);
            }
            ctx.restore();
            continue;
          }
          for (const g of w.glyphs) {
            const q = reveal(line, g.i, T.t, 0.12);
            if (q <= 0) continue;
            const pop = g.i === w.cs ? 1 : E.outBack(q, 2);
            ctx.save();
            ctx.translate(g.cx, g.y);
            ctx.scale(pop, pop);
            ctx.translate(-g.cx, -g.y);
            glyphText(ctx, g.ch, g.font, g.x, g.by, fill, stroke, w.size * 0.075, shadow, w.size * 0.055, w.size * 0.06);
            ctx.restore();
          }
          ctx.restore();
        }
        ctx.restore();
      }
      ctx.restore();
    },
  });

  /* ================================================================== */
  /* Style: dialog — original P5-flavoured dialogue box (lower third)   */
  /* ================================================================== */
  MV.lyricStyles.register('dialog', {
    layout(line, ctxOrOpts) {
      const opts = optsOf(ctxOrOpts);
      const I = charInfo(line);
      if (!I.n) return EMPTY('dialog', opts);
      const seed = seedOf(line);
      const jp = FACE.sans, la = FACE.black;
      const aw = rowAdvances(I, jp, la, 0.03);
      const padX = 100, padY = 58;
      const plan = planRows(line, I, aw, { maxW: 1300, maxH: 300, lh: 1.34, maxRows: 3, maxSize: 104, minSize: 44, prefSize: 80, rowPenalty: 0.03 });
      const maxRow = Math.max.apply(null, plan.rows.map((r) => r.w));
      const size = Math.min(plan.size, 1300 / maxRow);
      const R = plan.rows.length;
      const boxW = clamp(maxRow * size + padX * 2, 980, 1500);
      const boxH = R * size * 1.34 + padY * 2;
      const bottom = 936;
      const cx = 960 + MV.srand(seed, 2) * 40, cy = bottom - boxH / 2;
      const rot = -(1.5 + 1.5 * MV.rand(seed, 3)) * DEG;
      const hw = boxW / 2, hh = boxH / 2;
      const glyphs = [];
      plan.rows.forEach((row, r) => {
        const y = -hh + padY + (r + 0.5) * size * 1.34;
        glyphs.push(...placeRow(I, row, aw, size, -hw + padX, y, jp, la));
      });
      // Irregular, sharp-cornered box outline (deterministic per line).
      const j = (k, a) => MV.srand(seed, k, 60) * a;
      const pts = [
        [-hw - 16 + j(0, 6), -hh + 20 + j(1, 6)],
        [-hw * 0.35 + j(2, 30), -hh - 8 + j(3, 5)],
        [hw * 0.55 + j(4, 30), -hh + 4 + j(5, 5)],
        [hw + 30, -hh - 24],
        [hw - 10 + j(6, 5), -hh + boxH * 0.45],
        [hw + 14 + j(7, 5), hh + 8],
        [hw * 0.34 + j(8, 20), hh + 2 + j(9, 4)],
        [hw * 0.25, hh + 36],
        [hw * 0.15 + j(10, 12), hh - 2],
        [-hw + 30 + j(11, 8), hh + 12 + j(12, 4)],
        [-hw - 12 + j(13, 6), hh * 0.1 + j(14, 8)],
      ];
      const inset = pts.map(([x, y]) => [x * (1 - 24 / hw), y * (1 - 21 / hh)]);
      // Halftone corner dots (bottom-right) in local coords.
      const dots = [];
      const cell = 20;
      for (let gy = hh - 28, row = 0; gy > hh - 28 - cell * 6; gy -= cell, row++) {
        for (let gx = hw - 40; gx > hw - 40 - cell * 16; gx -= cell) {
          const u = 1 - ((hw - 40 - gx) / (cell * 16)) * 0.8 - ((hh - 28 - gy) / (cell * 6)) * 0.55;
          if (u > 0.08) dots.push([gx + (row % 2 ? cell / 2 : 0), gy, u * cell * 0.4]);
        }
      }
      const name = speakerOf(line);
      const nameSize = 54;
      let nameW = 0;
      if (name) for (const ch of MV.text.chars(name.toUpperCase())) nameW += met(ch, isWide(ch) ? FACE.heavy : FACE.anton).w * nameSize * (isWide(ch) ? 1 : 1.04);
      const plate = { x: -hw + 70 + (name ? nameW / 2 : 0), y: -hh - 16, w: name ? nameW + 86 : 120, h: 80, name: name ? name.toUpperCase() : null, size: nameSize };
      // Exact rotated extents of box + red shadow + back plate + name plate;
      // lift the box so its low corner clears the bottom-left HUD zone.
      const bounds = emptyB();
      const addPts = (list, rr, ox, oy) => {
        for (const [x, y] of list) {
          const c = Math.cos(rr), s = Math.sin(rr);
          const px = x * c - y * s + ox, py = x * s + y * c + oy;
          const wc = Math.cos(rot), ws = Math.sin(rot);
          addB(bounds, cx + px * wc - py * ws, cy + px * ws + py * wc, cx + px * wc - py * ws, cy + px * ws + py * wc);
        }
      };
      addPts(pts, 0, 0, 0);
      addPts(pts, 0, 14, 14);
      addPts(pts, 3.2 * DEG, -16, 14);
      addPts([[plate.x - plate.w / 2 - 20, plate.y - plate.h / 2 - 8], [plate.x + plate.w / 2 + 34, plate.y + plate.h / 2 + 14]], 0, 0, 0);
      let cyF = cy;
      const lift = Math.min(0, 958 - bounds.y1);
      cyF += lift;
      bounds.y0 += lift;
      bounds.y1 += lift;
      return {
        name: 'dialog', epoch, opts, seed, cx, cy: cyF, rot, size, boxW, boxH, pts, inset, dots, plate, glyphs,
        rows: plan.rows, bounds,
        cursor: { x: hw - 64, y: hh - 42 },
      };
    },
    draw(ctx, line, L, lt, env) {
      L = fresh('dialog', line, L);
      if (!L || L.empty) return;
      const T = timing(line, lt, env);
      const bt = beatOf(env);
      const pin = T.inP, po = T.outP;
      if (pin <= 0 || po >= 1) return;
      const sy = Math.max(0.03, E.outBack(clamp(pin / 0.85), 1.6)) * (1 - E.inQuad(po) * 0.97);
      const sx = lerp(0.6, 1, E.outExpo(pin)) * (1 + E.inQuad(po) * 0.12);
      const shift = (1 - E.outExpo(pin)) * -180 + E.inQuad(po) * 300;
      ctx.save();
      ctx.translate(L.cx + shift, L.cy);
      ctx.rotate(L.rot + (1 - E.outExpo(pin)) * -6 * DEG);
      ctx.save();
      ctx.scale(sx, Math.max(0.02, sy));
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 6;
      // Layered back plate (black, counter-rotated), red hard shadow, white box.
      const back = E.outExpo(clamp((pin - 0.12) / 0.6));
      if (back > 0) {
        ctx.save();
        ctx.rotate(3.2 * DEG * back);
        ctx.translate(-16, 14);
        polyPath(ctx, L.pts, 0, 0);
        ctx.fillStyle = C.black;
        ctx.fill();
        ctx.lineWidth = 5;
        ctx.strokeStyle = C.white;
        ctx.stroke();
        ctx.restore();
      }
      polyPath(ctx, L.pts, 14, 14);
      ctx.fillStyle = C.red;
      ctx.fill();
      polyPath(ctx, L.pts, 0, 0);
      ctx.fillStyle = C.white;
      ctx.fill();
      ctx.lineWidth = 12;
      ctx.strokeStyle = C.ink;
      ctx.stroke();
      polyPath(ctx, L.inset, 0, 0);
      ctx.lineWidth = 6;
      ctx.strokeStyle = C.red;
      ctx.stroke();
      ctx.fillStyle = 'rgba(230,0,18,0.5)';
      ctx.beginPath();
      for (const d of L.dots) { ctx.moveTo(d[0] + d[2], d[1]); ctx.arc(d[0], d[1], d[2], 0, TAU); }
      ctx.fill();
      // Typewriter text.
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      let any = false;
      for (const g of L.glyphs) {
        const q = reveal(line, g.i, T.t, 0.12);
        if (q <= 0) continue;
        any = true;
        const s = lerp(1.4, 1, E.outQuad(q));
        ctx.save();
        ctx.translate(g.cx, g.y);
        ctx.scale(s, s);
        ctx.fillStyle = q < 0.5 ? C.red : C.ink;
        ctx.font = g.font;
        ctx.fillText(g.ch, -g.w / 2, g.by - g.y);
        ctx.restore();
      }
      // Bouncing triangle cursor.
      if (any) {
        const b = Math.abs(Math.sin(bt.phase * Math.PI)) * 12;
        const cx = L.cursor.x, cy = L.cursor.y - b;
        ctx.beginPath();
        ctx.moveTo(cx - 22, cy - 15);
        ctx.lineTo(cx + 22, cy - 15);
        ctx.lineTo(cx, cy + 17);
        ctx.closePath();
        ctx.fillStyle = C.red;
        ctx.fill();
        ctx.lineWidth = 5;
        ctx.strokeStyle = C.ink;
        ctx.stroke();
      }
      ctx.restore();
      // Name plate (slams in slightly after the box).
      const pp = clamp((pin - 0.3) / 0.7);
      if (pp > 0) {
        const P = L.plate;
        const s = E.outBack(pp, 2.2) * (1 - E.inQuad(po));
        ctx.save();
        ctx.translate(P.x - E.inQuad(po) * 220, P.y);
        ctx.rotate(-6 * DEG);
        ctx.scale(s, s);
        ctx.lineJoin = 'miter';
        ctx.fillStyle = C.red;
        MV.draw.skewRect(ctx, -P.w / 2 + 12, -P.h / 2 + 12, P.w, P.h, 22);
        ctx.fill();
        ctx.fillStyle = C.ink;
        MV.draw.skewRect(ctx, -P.w / 2, -P.h / 2, P.w, P.h, 22);
        ctx.fill();
        ctx.lineWidth = 5;
        ctx.strokeStyle = C.white;
        ctx.stroke();
        if (P.name) {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.save();
          ctx.transform(1, 0, -0.2, 1, 0, 0);
          glyphText(ctx, P.name, fontStr(FACE.anton, P.size), 10, P.size * 0.37, C.white, null, 0, C.red, 4, 4);
          ctx.restore();
        } else {
          MV.draw.star(ctx, 10, 2, 30, 12.5, 5);
          ctx.fillStyle = C.white;
          ctx.fill();
          ctx.fillStyle = C.red;
          ctx.fillRect(-40, 22, 22, 6);
          ctx.fillRect(40, -28, 22, 6);
        }
        ctx.restore();
      }
      ctx.restore();
    },
  });

  /* ================================================================== */
  /* Style: vertical — tategaki columns in Mincho, calm and starry       */
  /* ================================================================== */
  MV.lyricStyles.register('vertical', {
    layout(line, ctxOrOpts) {
      const opts = optsOf(ctxOrOpts);
      const I = charInfo(line);
      if (!I.n) return EMPTY('vertical', opts);
      const seed = seedOf(line);
      const jp = FACE.serif, la = FACE.bebas;
      // Vertical advances: wide chars 1 em (+tracking), Latin measured (runs
      // sideways), spaces 0.5 between phrases.
      const aw = new Array(I.n).fill(0);
      for (let i = 0; i < I.n; i++) {
        if (I.sp[i]) aw[i] = I.lat[i - 1] && I.lat[i + 1] ? 0.3 : 0.5;
        else if (I.lat[i]) aw[i] = met(I.chars[i], la).w * 0.95 + 0.01;
        else aw[i] = 1.06;
      }
      const plan = planRows(line, I, aw, { maxW: 700, maxH: 1300, lh: 1.72, maxRows: 5, maxSize: 124, minSize: 46, prefSize: 92, rowPenalty: 0.02 });
      const cx0 = 1010 + MV.srand(seed, 2) * 70;
      const top0 = 176;
      return Object.assign(fitLoop(plan.size, { x0: BOX.x0, y0: 118, x1: BOX.x1, y1: BOX.y1 }, (size) => {
        const R = plan.rows.length;
        const pitch = size * 1.72;
        const glyphs = [];
        const cols = [];
        const B = emptyB();
        plan.rows.forEach((row, c) => {
          const x = ((R - 1) / 2 - c) * pitch; // right-to-left
          const stag = (c % 2) * size * 0.9;
          let y = stag;
          const colG = [];
          for (let i = row.cs; i < row.ce; i++) {
            const a = aw[i] * size;
            if (!I.sp[i]) {
              const ch = I.chars[i];
              const latin = !!I.lat[i];
              const g = { i, ch, latin, x, y, h: a, font: fontStr(latin ? la : jp, latin ? size * 0.9 : size) };
              if (latin) g.rot = 90 * DEG;
              else if (ROTATE_V.indexOf(ch) >= 0) g.rot = 90 * DEG;
              else if (SMALL_KANA.indexOf(ch) >= 0) { g.dx = size * 0.1; g.dy = -size * 0.1; }
              else if (PUNCT_V.indexOf(ch) >= 0) { g.dx = size * 0.58; g.dy = -size * 0.6; }
              g.vc = vcenter(jp, false) * size;
              g.lvc = vcenter(la, true) * size * 0.9;
              colG.push(g);
              glyphs.push(g);
            }
            y += a;
          }
          // Tanzaku strip behind the column.
          const strip = { x0: x - size * 0.74, x1: x + size * 0.74, y0: stag - size * 0.5, y1: y + size * 0.42 };
          addB(B, cx0 + strip.x0 - 10, top0 + strip.y0 - 4, cx0 + strip.x1 + 12, top0 + strip.y1 + 12);
          cols.push({ x, y0: stag, y1: y, glyphs: colG, strip, cs: row.cs });
        });
        // Red rule right of the first strip; the seal stamps its lower end.
        const first = cols[0];
        const rule = { x: first.strip.x1 + size * 0.28, y0: first.strip.y0 + size * 0.2, y1: Math.max.apply(null, cols.map((c) => c.strip.y1)) - size * 0.1 };
        const sealS = Math.max(40, size * 0.72);
        const seal = { x: rule.x + sealS * 0.12, y: rule.y1 + sealS * 0.62, s: sealS };
        addB(B, cx0 + rule.x - 4, top0 + rule.y0, cx0 + rule.x + 16, top0 + rule.y1);
        addRect(B, cx0, top0, 0, seal.x, seal.y, seal.s * 1.25, seal.s * 1.25, 0);
        return { L: { cx: cx0, cy: top0, rot: 0, glyphs, cols, rule, seal, rows: plan.rows }, B };
      }), { name: 'vertical', epoch, opts, seed });
    },
    draw(ctx, line, L, lt, env) {
      L = fresh('vertical', line, L);
      if (!L || L.empty) return;
      const T = timing(line, lt, env);
      const bt = beatOf(env);
      const size = L.size;
      const po = T.outP;
      const nc = L.cols.length;
      ctx.save();
      ctx.translate(L.cx, L.cy);
      // Tanzaku strips unroll downward (column 0 on entrance, later columns
      // just before their first character); they roll back up on exit.
      L.cols.forEach((col, c) => {
        const t0 = c === 0 ? T.showStart : charT(line, col.cs) - 0.4;
        const p = E.outExpo(clamp((T.t - t0) / 0.45));
        const qo = E.inCubic(clamp(po * 1.4 - ((nc - 1 - c) / Math.max(1, nc)) * 0.4));
        const k = p * (1 - qo);
        if (k <= 0.002) return;
        const s = col.strip;
        const h = (s.y1 - s.y0) * k;
        ctx.fillStyle = C.redDeep;
        ctx.fillRect(s.x0 + 9, s.y0 + 9, s.x1 - s.x0, h);
        ctx.fillStyle = C.black;
        ctx.fillRect(s.x0, s.y0, s.x1 - s.x0, h);
        ctx.strokeStyle = 'rgba(255,244,214,0.55)';
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x0 + 7, s.y0 + 7, s.x1 - s.x0 - 14, Math.max(0, h - 14));
      });
      // Red vertical rule.
      const rp = E.outExpo(T.inP) * (1 - E.inCubic(po));
      if (rp > 0) {
        ctx.fillStyle = C.red;
        const len = (L.rule.y1 - L.rule.y0) * rp;
        ctx.fillRect(L.rule.x - 3, L.rule.y0, 6, len);
        ctx.fillRect(L.rule.x + 9, L.rule.y0 + len * 0.08, 2, len * 0.55);
      }
      // Seal: red square with the original star-slash emblem.
      const sp = clamp((T.inP - 0.4) / 0.6);
      if (sp > 0 && po < 1) {
        const s = E.outBack(sp, 2.2) * (1 - E.inQuad(po));
        ctx.save();
        ctx.translate(L.seal.x, L.seal.y);
        ctx.rotate(-4 * DEG);
        ctx.scale(s, s);
        const q = L.seal.s;
        ctx.fillStyle = C.red;
        ctx.fillRect(-q / 2, -q / 2, q, q);
        ctx.lineWidth = Math.max(2, q * 0.05);
        ctx.strokeStyle = C.star;
        ctx.strokeRect(-q / 2 + q * 0.1, -q / 2 + q * 0.1, q * 0.8, q * 0.8);
        drawEmblem(ctx, 0, 0, q * 0.27, 0, { star: C.star, edge: C.redDeep, slash: C.redDeep, gap: C.red });
        ctx.restore();
      }
      // Characters: fade + drop in, with star sparkles near new ones.
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      const n = L.glyphs.length;
      for (let k = 0; k < n; k++) {
        const g = L.glyphs[k];
        const q = reveal(line, g.i, T.t, 0.42);
        if (q <= 0) continue;
        const e = E.outCubic(q);
        let a = e;
        let dy = -(1 - e) * size * 0.45;
        if (po > 0) {
          const qo = clamp(po * 1.6 - (k / Math.max(1, n)) * 0.6);
          a *= 1 - E.inQuad(qo);
          dy -= E.inQuad(qo) * 60;
        }
        if (a <= 0.01) continue;
        ctx.save();
        ctx.globalAlpha *= a;
        ctx.translate(g.x, g.y + g.h / 2 + dy);
        if (g.latin) {
          ctx.rotate(90 * DEG);
          ctx.fillStyle = C.star;
          ctx.font = g.font;
          ctx.fillText(g.ch, 0, g.lvc);
        } else {
          if (g.rot) ctx.rotate(g.rot);
          const x = g.dx || 0, y = (g.dy || 0) + g.vc;
          ctx.font = g.font;
          ctx.fillStyle = q < 1 ? C.star : C.white;
          ctx.fillText(g.ch, x, y);
        }
        ctx.restore();
        // Sparkles for ~1 s after the reveal.
        const age = T.t - (charT(line, g.i) - LEAD);
        if (age >= 0 && age < 1.1 && a > 0.2) {
          for (let s = 0; s < 2; s++) {
            const life = 0.8 + 0.3 * MV.rand(L.seed, g.i, 70 + s);
            const u = age / life;
            if (u >= 1) continue;
            const side = s === 0 ? 1 : -1;
            const sx = g.x + side * size * (0.95 + 0.2 * MV.rand(L.seed, g.i, 72 + s));
            const sy = g.y + g.h * (0.2 + 0.6 * MV.rand(L.seed, g.i, 74 + s)) - u * size * 0.3;
            const r = size * (0.15 + 0.12 * MV.rand(L.seed, g.i, 76 + s)) * Math.sin(Math.PI * u) * (1 + 0.3 * bt.pulse);
            MV.draw.sparkle(ctx, sx, sy, r, 0.16, u * 1.2);
            ctx.fillStyle = s === 1 && MV.rand(L.seed, g.i, 78) < 0.35 ? C.redHot : C.star;
            ctx.fill();
          }
        }
      }
      ctx.restore();
    },
  });

  /* ================================================================== */
  /* Style: card — tilted red torn card, emblem, ransom tiles inside    */
  /* ================================================================== */
  MV.lyricStyles.register('card', {
    layout(line, ctxOrOpts) {
      const opts = optsOf(ctxOrOpts);
      const I = charInfo(line);
      if (!I.n) return EMPTY('card', opts);
      const seed = seedOf(line);
      const { aw, spec } = ransomSpecs(I, seed ^ 0x5a5a, CARD_COMBOS);
      const plan = planRows(line, I, aw, { maxW: 1320, maxH: 560, lh: 1.26, maxRows: I.n > 26 ? 4 : 3, maxSize: 180, minSize: 52, prefSize: 112, rowPenalty: 0.04 });
      const rot = (MV.rand(seed, 2) < 0.75 ? -1 : 1) * (4 + 2.5 * MV.rand(seed, 3)) * DEG;
      const cx0 = 960 + MV.srand(seed, 4) * 40, cy0 = 520 + MV.srand(seed, 5) * 24;
      return Object.assign(fitLoop(plan.size, BOX, (size) => {
        const glyphs = placeTiles(I, plan.rows, spec, aw, size, { pitch: 1.26, stagger: 0.22, rowSlope: 0 });
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const g of glyphs) { x0 = Math.min(x0, g.x - g.w / 2); x1 = Math.max(x1, g.x + g.w / 2); y0 = Math.min(y0, g.y - g.h / 2); y1 = Math.max(y1, g.y + g.h / 2); }
        const padX = Math.max(100, size * 0.62), padY = Math.max(78, size * 0.5);
        const cw = Math.max(720, x1 - x0 + padX * 2), ch = Math.max(380, y1 - y0 + padY * 2);
        const ox = (x0 + x1) / 2, oy = (y0 + y1) / 2;
        for (const g of glyphs) { g.x -= ox; g.y -= oy; }
        // Torn outline.
        const pts = [];
        const edge = (ax, ay, bx, by, k0) => {
          const len = Math.hypot(bx - ax, by - ay), n = Math.max(2, Math.round(len / 26));
          const nx = -(by - ay) / len, ny = (bx - ax) / len;
          for (let k = 0; k < n; k++) {
            const t = k / n, o = MV.srand(seed, k0 + k, 90) * 7 + (k % 2 ? 3 : -3);
            pts.push([ax + (bx - ax) * t + nx * o, ay + (by - ay) * t + ny * o]);
          }
        };
        const hw = cw / 2, hh = ch / 2;
        edge(-hw, -hh, hw, -hh, 0);
        edge(hw, -hh, hw, hh, 200);
        edge(hw, hh, -hw, hh, 400);
        edge(-hw, hh, -hw, -hh, 600);
        const dots = [];
        const cell = 24;
        for (let gy = hh - 16; gy > hh - cell * 8; gy -= cell) {
          for (let gx = hw - 16; gx > hw - cell * 16; gx -= cell) {
            const u = 1 - ((hw - gx) / (cell * 16)) * 0.6 - ((hh - gy) / (cell * 8)) * 0.6;
            if (u > 0.06) dots.push([gx + (Math.round(gy / cell) % 2 ? cell / 2 : 0), gy, u * cell * 0.42]);
          }
        }
        const B = emptyB();
        const er = clamp(size * 0.58, 56, 88);
        const emblem = { x: -hw + er * 0.55, y: -hh + er * 0.4, r: er };
        addRect(B, cx0, cy0, rot, 10, 10, cw + 40, ch + 40, 0);
        addRect(B, cx0, cy0, rot, emblem.x, emblem.y, er * 2.4, er * 2.4, 0);
        return {
          L: { cx: cx0, cy: cy0, rot, glyphs, cw, ch, pts, dots, rows: plan.rows, emblem },
          B,
        };
      }), { name: 'card', epoch, opts, seed });
    },
    draw(ctx, line, L, lt, env) {
      L = fresh('card', line, L);
      if (!L || L.empty) return;
      const T = timing(line, lt, env);
      const bt = beatOf(env);
      const pin = T.inP, po = T.outP;
      if (pin <= 0) return;
      // Flip in (edge-on → face) while sliding from the right; flip away on exit.
      const flipIn = (1 - E.outBack(pin, 1.3)) * 95 * DEG;
      const flipOut = E.inQuad(po) * 90 * DEG;
      const sxRaw = Math.cos(flipIn + flipOut);
      const sx = Math.max(0.015, Math.abs(sxRaw));
      const back = sxRaw < 0 || (flipIn > 80 * DEG && pin < 0.5);
      const slide = (1 - E.outExpo(pin)) * 520 - E.inQuad(po) * 560;
      const rot = L.rot + (1 - E.outExpo(pin)) * 14 * DEG - E.inQuad(po) * 16 * DEG;
      ctx.save();
      ctx.translate(L.cx + slide, L.cy + E.inQuad(po) * 120);
      ctx.rotate(rot);
      ctx.scale(sx * (1 + 0.012 * bt.barPulse), 1 + 0.012 * bt.barPulse);
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 4;
      polyPath(ctx, L.pts, 20, 22);
      ctx.fillStyle = C.ink;
      ctx.fill();
      polyPath(ctx, L.pts, 0, 0);
      ctx.fillStyle = back ? C.black : C.red;
      ctx.fill();
      ctx.lineWidth = 11;
      ctx.strokeStyle = back ? C.red : C.ink;
      ctx.stroke();
      if (back) {
        drawEmblem(ctx, 0, 0, Math.min(L.ch, L.cw) * 0.28, 0, { star: C.red, edge: C.ink, slash: C.ink, gap: C.white });
        ctx.restore();
        return;
      }
      // Inner hairline, halftone corner, emblem.
      ctx.save();
      polyPath(ctx, L.pts, 0, 0);
      ctx.clip();
      // Watermark star (clipped by the card) and halftone corner.
      MV.draw.star(ctx, L.cw * 0.3, L.ch * 0.12, L.ch * 0.62, L.ch * 0.27, 5, -Math.PI / 2 + 0.25);
      ctx.fillStyle = C.redDeep;
      ctx.fill();
      ctx.beginPath();
      for (const d of L.dots) { ctx.moveTo(d[0] + d[2], d[1]); ctx.arc(d[0], d[1], d[2], 0, TAU); }
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.9)';
      ctx.beginPath();
      ctx.moveTo(-L.cw / 2 - 20, L.ch / 2 - 60);
      ctx.lineTo(-L.cw / 2 + 160, L.ch / 2 + 20);
      ctx.lineTo(-L.cw / 2 - 20, L.ch / 2 + 20);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.ink;
      ctx.strokeRect(-L.cw / 2 + 22, -L.ch / 2 + 22, L.cw - 44, L.ch - 44);
      const em = L.emblem;
      drawEmblem(ctx, em.x, em.y, em.r * (1 + 0.08 * bt.pulse), -12 * DEG, { star: C.white, edge: C.ink, slash: C.ink, gap: C.white, shadow: C.ink });
      // Ransom tiles.
      const n = L.glyphs.length;
      for (let k = 0; k < n; k++) {
        const g = L.glyphs[k];
        const p = reveal(line, g.i, T.t, 0.2);
        if (p <= 0) continue;
        const j = jig(bt, L.seed, g.i, 0.7);
        drawTile(ctx, g, E.outBack(p, 2.4) * j.s, (1 - p) * g.spin * 24 * DEG + j.r, j.x, j.y, clamp(p * 5), rot);
      }
      ctx.restore();
    },
  });

  /* ================================================================== */
  /* Style: split — alternating bands revealed by colliding diagonal cuts */
  /* ================================================================== */
  MV.lyricStyles.register('split', {
    layout(line, ctxOrOpts) {
      const opts = optsOf(ctxOrOpts);
      const I = charInfo(line);
      if (!I.n) return EMPTY('split', opts);
      const seed = seedOf(line);
      const jp = FACE.heavy, la = FACE.anton;
      const aw = rowAdvances(I, jp, la, 0.02);
      const plan = planRows(line, I, aw, { maxW: 1400, maxH: 690, lh: 1.46, maxRows: 3, maxSize: 196, minSize: 54, prefSize: 124, rowPenalty: 0.05 });
      const grot = -(4 + 2 * MV.rand(seed, 2)) * DEG;
      const cx0 = 960 + MV.srand(seed, 3) * 30, cy0 = 515 + MV.srand(seed, 4) * 30;
      const firstRed = MV.rand(seed, 5) < 0.4;
      return Object.assign(fitLoop(plan.size, BOX, (size) => {
        const R = plan.rows.length;
        const pitch = size * 1.46;
        const B = emptyB();
        const rows = plan.rows.map((row, r) => {
          const tw = row.w * size;
          const off = (r % 2 === 0 ? -1 : 1) * (R > 1 ? size * 0.35 : 0);
          const x0 = -tw / 2 + off, y = (r - (R - 1) / 2) * pitch;
          const red = (r % 2 === 1) !== firstRed;
          const glyphs = placeRow(I, row, aw, size, x0, y, jp, la);
          for (const g of glyphs) addRect(B, cx0, cy0, grot, g.cx, y, g.w + size * 0.2, size * 1.2, 0);
          const bh = size * 1.22, pad = size * 0.55;
          // Diagonal cut through the band (mirrored on alternate rows).
          const cutX = x0 + tw * (r % 2 === 0 ? 0.38 : 0.62);
          const slant = (r % 2 === 0 ? 1 : -1) * bh * 0.55;
          return { cs: row.cs, ce: row.ce, y, x0, x1: x0 + tw, bh, pad, red, glyphs, cutX, slant, dir: r % 2 === 0 ? 1 : -1 };
        });
        return { L: { cx: cx0, cy: cy0, rot: grot, rows, glyphs: [].concat(...rows.map((r) => r.glyphs)) }, B };
      }), { name: 'split', epoch, opts, seed });
    },
    draw(ctx, line, L, lt, env) {
      L = fresh('split', line, L);
      if (!L || L.empty) return;
      const T = timing(line, lt, env);
      const bt = beatOf(env);
      const size = L.size;
      const po = T.outP;
      ctx.save();
      ctx.translate(L.cx, L.cy);
      ctx.rotate(L.rot);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.lineJoin = 'round';
      L.rows.forEach((row, r) => {
        const t0 = charT(line, row.cs);
        const tr = r === 0 ? Math.min(T.showStart, t0 - 0.24) : t0 - 0.24;
        const e = T.t - tr;
        if (e < 0) return;
        const hit = e - 0.27; // time since the pieces collide
        const shake = hit > 0 && hit < 0.16 ? Math.sin(hit * 90) * (1 - hit / 0.16) * size * 0.05 : 0;
        const exitD = E.inExpo(clamp(po * 1.25 - r * 0.1)) * 1500;
        const bx0 = row.x0 - row.pad, bx1 = row.x1 + row.pad;
        const bh = row.bh, sk = bh * 0.34;
        const ytop = row.y - bh / 2, ybot = row.y + bh / 2;
        const cutTop = row.cutX + row.slant / 2, cutBot = row.cutX - row.slant / 2;
        for (let half = 0; half < 2; half++) {
          // half 0 = piece left of the cut (enters from the left), half 1 from
          // the right; on mirrored rows the other piece leads.
          const from = half === 0 ? -1 : 1;
          const lag = (half === 1) === row.dir > 0 ? 0.05 : 0;
          const p = E.outExpo(clamp((e - lag) / 0.22));
          const off = (1 - p) * 1500 * from + exitD * from + shake;
          ctx.save();
          ctx.translate(off, 0);
          ctx.beginPath();
          if (half === 0) {
            ctx.moveTo(bx0 - 400, ytop - 200); ctx.lineTo(cutTop + (cutTop - cutBot) * (200 / bh), ytop - 200);
            ctx.lineTo(cutBot - (cutTop - cutBot) * (200 / bh), ybot + 200); ctx.lineTo(bx0 - 400, ybot + 200);
          } else {
            ctx.moveTo(bx1 + 400, ytop - 200); ctx.lineTo(cutTop + (cutTop - cutBot) * (200 / bh), ytop - 200);
            ctx.lineTo(cutBot - (cutTop - cutBot) * (200 / bh), ybot + 200); ctx.lineTo(bx1 + 400, ybot + 200);
          }
          ctx.closePath();
          ctx.clip();
          // Band with a hard contrasting shadow.
          polyPath(ctx, skewQuad(bx0, bx1, ytop, ybot, sk), size * 0.09, size * 0.1);
          ctx.fillStyle = row.red ? C.ink : C.red;
          ctx.fill();
          polyPath(ctx, skewQuad(bx0, bx1, ytop, ybot, sk));
          ctx.fillStyle = row.red ? C.red : C.black;
          ctx.fill();
          if (row.red) { ctx.lineWidth = 6; ctx.strokeStyle = C.ink; ctx.stroke(); }
          for (const g of row.glyphs) {
            const q = reveal(line, g.i, T.t, 0.16);
            if (q <= 0) continue;
            const s = E.outBack(q, 2.2);
            const j = jig(bt, L.seed, g.i, 0.6);
            ctx.save();
            ctx.translate(g.cx + j.x, g.y + j.y);
            ctx.rotate(j.r);
            ctx.scale(s * j.s, s * j.s);
            ctx.transform(1, 0, -0.14, 1, 0, 0);
            if (row.red) glyphText(ctx, g.ch, g.font, -g.w / 2, g.by - g.y, C.ink, null, 0, C.white, size * 0.045, size * 0.045);
            else glyphText(ctx, g.ch, g.font, -g.w / 2, g.by - g.y, C.white, null, 0, C.red, size * 0.05, size * 0.05);
            ctx.restore();
          }
          ctx.restore();
        }
        // Collision flash along the cut + spark shards.
        const fl = hit >= 0 && hit < 0.22 ? 1 - hit / 0.22 : po > 0 && po < 0.3 ? 1 - po / 0.3 : 0;
        if (fl > 0) {
          ctx.save();
          ctx.translate(shake, 0);
          const wv = size * 0.09 * fl;
          ctx.fillStyle = C.white;
          ctx.beginPath();
          const ext = bh * 0.3;
          const dxs = (cutTop - cutBot) / bh;
          ctx.moveTo(cutTop + dxs * ext - wv, ytop - ext);
          ctx.lineTo(cutTop + dxs * ext + wv, ytop - ext);
          ctx.lineTo(cutBot - dxs * ext + wv, ybot + ext);
          ctx.lineTo(cutBot - dxs * ext - wv, ybot + ext);
          ctx.closePath();
          ctx.fill();
          for (let s = 0; s < 5; s++) {
            const a = MV.srand(L.seed, r, 80 + s) * Math.PI;
            const d = (1 - fl) * size * (0.8 + 0.8 * MV.rand(L.seed, r, 90 + s));
            const px = row.cutX + Math.cos(a) * d * (s % 2 ? 1 : -1), py = row.y + Math.sin(a) * d * 0.6;
            const rr = size * 0.12 * fl;
            ctx.fillStyle = s % 2 ? C.white : C.redHot;
            MV.draw.polygon(ctx, [[px, py - rr], [px + rr * 0.5, py + rr * 0.6], [px - rr * 0.6, py + rr * 0.3]]);
            ctx.fill();
          }
          ctx.restore();
        }
      });
      ctx.restore();
    },
  });

  /* ================================================================== */
  /* Style: glitch — decode scramble, RGB split, slice jitter            */
  /* ================================================================== */
  const SCRAMBLE = MV.text.chars('アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン#%&@*+=?!<>/01X');
  MV.lyricStyles.register('glitch', {
    layout(line, ctxOrOpts) {
      const opts = optsOf(ctxOrOpts);
      const I = charInfo(line);
      if (!I.n) return EMPTY('glitch', opts);
      const seed = seedOf(line);
      const jp = FACE.heavy, la = FACE.anton;
      const aw = rowAdvances(I, jp, la, 0.04);
      const plan = planRows(line, I, aw, { maxW: 1440, maxH: 640, lh: 1.46, maxRows: 3, maxSize: 176, minSize: 52, prefSize: 118, rowPenalty: 0.05 });
      const cx0 = 960, cy0 = 505 + MV.srand(seed, 2) * 30;
      const scr = FACE.dot;
      return Object.assign(fitLoop(plan.size, BOX, (size) => {
        const R = plan.rows.length;
        const pitch = size * 1.46;
        const B = emptyB();
        const rows = plan.rows.map((row, r) => {
          const tw = row.w * size;
          const x0 = -tw / 2 + (r - (R - 1) / 2) * size * 0.3;
          const y = (r - (R - 1) / 2) * pitch;
          const glyphs = placeRow(I, row, aw, size, x0, y, jp, la, () => ({ row: r, sfont: fontStr(scr, size * 0.95), sby: y + vcenter(scr, false) * size * 0.95 }));
          for (const g of glyphs) addRect(B, cx0, cy0, 0, g.cx, y, g.w + size * 0.3, size * 1.25, 0);
          return { cs: row.cs, ce: row.ce, y, x0, x1: x0 + tw, glyphs, ph: size * 1.22, pad: size * 0.34 };
        });
        let x0 = Infinity, x1 = -Infinity;
        rows.forEach((r) => { x0 = Math.min(x0, r.x0 - r.pad); x1 = Math.max(x1, r.x1 + r.pad); });
        const y0 = rows[0].y - rows[0].ph / 2 - 10, y1 = rows[rows.length - 1].y + rows[rows.length - 1].ph / 2 + 10;
        return { L: { cx: cx0, cy: cy0, rot: 0, rows, glyphs: [].concat(...rows.map((r) => r.glyphs)), box: { x0: x0 - 40, x1: x1 + 40, y0: y0 - 20, y1: y1 + 20 } }, B };
      }), { name: 'glitch', epoch, opts, seed });
    },
    draw(ctx, line, L, lt, env) {
      L = fresh('glitch', line, L);
      if (!L || L.empty) return;
      const T = timing(line, lt, env);
      const bt = beatOf(env);
      const size = L.size;
      const t = T.t;
      const fr = Math.floor(t * 30);
      const pin = T.inP, po = T.outP;
      if (pin <= 0) return;
      // Glitch amount: entrance flicker, recent reveals, onsets, exit.
      let recent = 0;
      for (const g of L.glyphs) {
        const a = t - (charT(line, g.i) - LEAD);
        if (a >= 0 && a < 0.14) recent = Math.max(recent, 1 - a / 0.14);
      }
      const onset = env && finite(env.onsetPulse) ? env.onsetPulse : 0;
      const amt = clamp(Math.max((1 - pin) * 1.2, recent * 0.8, onset * 0.35 + bt.pulse * 0.15, po * 1.5));
      // Entrance flicker: skip some frames while pin < 1.
      if (pin < 1 && MV.rand(L.seed, fr, 5) > pin * 1.4) return;
      const sy = po > 0 ? Math.max(0.02, 1 - E.inExpo(clamp(po * 1.1))) : 1;
      const sx = 1 + po * 0.25;
      ctx.save();
      ctx.translate(L.cx, L.cy);
      ctx.scale(sx, sy);
      // Panels: black skewed plates with scanlines and a red edge tick.
      L.rows.forEach((row, r) => {
        const x0 = row.x0 - row.pad, x1 = row.x1 + row.pad;
        const y0 = row.y - row.ph / 2, y1 = row.y + row.ph / 2;
        const off = amt > 0.2 && MV.rand(L.seed, r, fr) < amt * 0.6 ? MV.srand(L.seed, r + 9, fr) * size * 0.4 * amt : 0;
        ctx.fillStyle = C.red;
        MV.draw.skewRect(ctx, x0 + off + size * 0.1, y0 + size * 0.1, x1 - x0, y1 - y0, size * 0.18);
        ctx.fill();
        ctx.fillStyle = C.black;
        MV.draw.skewRect(ctx, x0 + off, y0, x1 - x0, y1 - y0, size * 0.18);
        ctx.fill();
        ctx.fillStyle = scanPattern(ctx);
        ctx.fill();
        ctx.fillStyle = C.red;
        ctx.fillRect(x0 + off - size * 0.02, y0 + (y1 - y0) * 0.18, size * 0.1, (y1 - y0) * 0.64);
        ctx.fillStyle = C.white;
        ctx.fillRect(x1 + off - size * 0.34, y1 - size * 0.12, size * 0.26, size * 0.05);
      });
      // Text: red / cyan split copies, then the main pass. Displaced slices
      // are redrawn clipped over an erased strip (no full-size offscreen).
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const rgb = size * (0.02 + 0.12 * amt);
      let nextCursor = null;
      for (const g of L.glyphs) if (t < charT(line, g.i) - LEAD && (!nextCursor || g.i < nextCursor.i)) nextCursor = g;
      const drawText = (rowSel) => {
        for (let pass = 0; pass < 3; pass++) {
          for (const g of L.glyphs) {
            if (rowSel != null && g.row !== rowSel) continue;
            const a = t - (charT(line, g.i) - LEAD);
            if (a < 0) continue;
            const scram = a < 0.2;
            const ch = scram ? SCRAMBLE[Math.floor(MV.rand(L.seed, g.i, fr) * SCRAMBLE.length)] : g.ch;
            const by = scram ? g.sby : g.by;
            const x = g.x + (scram ? (g.w - size * 0.95) / 2 : 0);
            ctx.font = scram ? g.sfont : g.font;
            if (pass === 0) { ctx.fillStyle = C.red; ctx.fillText(ch, x + rgb, by + rgb * 0.25); }
            else if (pass === 1) { ctx.fillStyle = C.cyan; ctx.globalAlpha *= 0.85; ctx.fillText(ch, x - rgb, by - rgb * 0.2); ctx.globalAlpha /= 0.85; }
            else { ctx.fillStyle = scram ? (MV.rand(L.seed, g.i, fr + 3) < 0.5 ? C.redHot : C.white) : C.white; ctx.fillText(ch, x, by); }
          }
        }
      };
      drawText(null);
      // Blinking block cursor at the next glyph to decode.
      if (nextCursor && Math.floor(t * 5) % 2 === 0 && po <= 0) {
        ctx.fillStyle = C.red;
        ctx.fillRect(nextCursor.x + size * 0.1, nextCursor.y - size * 0.42, size * 0.5, size * 0.84);
      }
      // Horizontal slice jitter (at most 5 slices a frame).
      if (amt > 0.12 && (!env || env.quality == null || env.quality > 0.55)) {
        let n = 0;
        L.rows.forEach((row, r) => {
          const K = 4, sh = row.ph / K;
          const x0 = row.x0 - row.pad, x1 = row.x1 + row.pad;
          for (let k = 0; k < K && n < 5; k++) {
            const id = r * 8 + k;
            if (MV.rand(L.seed, id, fr + 11) >= amt * 0.45) continue;
            const off = MV.srand(L.seed, id, fr + 12) * size * 0.6 * amt;
            if (Math.abs(off) < 2) continue;
            n++;
            const y0 = row.y - row.ph / 2 + k * sh;
            ctx.save();
            ctx.beginPath();
            ctx.rect(x0 - size * 0.8, y0, x1 - x0 + size * 1.6, sh);
            ctx.clip();
            ctx.fillStyle = C.black;
            ctx.fillRect(x0 + size * 0.1, y0, x1 - x0, sh);
            ctx.translate(off, 0);
            ctx.fillRect(x0 + size * 0.1, y0, x1 - x0, sh);
            drawText(r);
            ctx.restore();
          }
        });
      }
      const bx = L.box;
      // Exit: bright collapse line.
      if (po > 0.55) {
        ctx.fillStyle = C.white;
        const q = (po - 0.55) / 0.45;
        ctx.fillRect(bx.x0 * (1 - q), -4 / sy, (bx.x1 - bx.x0) * (1 - q), 8 / sy);
      }
      ctx.restore();
    },
  });

  /* ================================================================== */
  /* Public helpers                                                      */
  /* ================================================================== */
  /**
   * Check a layout's text bounds: inside SAFE and clear of the HUD zones.
   * @returns {{ok:boolean, safe:boolean, hud:boolean, bounds:object}}
   */
  function check(L) {
    const b = L && L.bounds;
    if (!b || !isFinite(b.x0)) return { ok: true, safe: true, hud: false, bounds: b };
    const safe = b.x0 >= SAFE.x0 - 0.5 && b.x1 <= SAFE.x1 + 0.5 && b.y0 >= SAFE.y0 - 0.5 && b.y1 <= SAFE.y1 + 0.5;
    const hud = HUD_ZONES.some((z) => b.x0 < z.x1 && b.x1 > z.x0 && b.y0 < z.y1 && b.y1 > z.y0);
    return { ok: safe && !hud, safe, hud, bounds: b };
  }

  MV.LyricFX = Object.assign(MV.LyricFX || {}, {
    SAFE, BOX, HUD_ZONES, LEAD,
    FACE,
    /** Extra glyphs styles draw (glitch scramble set) — pass to MV.fonts.ensure. */
    fontSample: SCRAMBLE.join('') + '★',
    /** Optional name for the dialog name plate (else preset artist, else ★). */
    speaker: MV.LyricFX && MV.LyricFX.speaker ? MV.LyricFX.speaker : null,
    drawLatin,
    measureLatin,
    drawEmblem,
    drawTile,
    glyphText,
    ransomSpecs,
    placeTiles,
    charInfo,
    tokens,
    planRows,
    splitTok,
    reveal,
    timing,
    check,
    metrics: met,
    isWide,
    /** Font-metric epoch (bumps when web fonts finish loading). */
    epoch: () => epoch,
  });
})();

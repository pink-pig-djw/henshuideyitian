#!/usr/bin/env node
/*
 * Node tests for mv/js/director.js (MV.Director).
 *
 *   node mv/tools/test-director.cjs
 *   MV_SONG_WAV=/path/song.wav MV_LYRICS=/path/lyrics.txt MV_LYRICS_PASTE=/path/paste.txt node mv/tools/test-director.cjs
 *
 * Uses the real timing preset, synthetic features built from the preset beats /
 * sections (synthetic envelopes and onsets) and a synthetic LyricTrack built
 * from the preset line timing with PLACEHOLDER text (■ glyphs, "Xxxx" for
 * Latin tails) — never real lyrics. The optional WAV / lyric files live outside
 * the repository; their content is never printed (counts / ids / numbers only).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
global.window = globalThis;
{
  const fakeCtx = { measureText: () => ({ width: 0 }), font: '' };
  global.document = { createElement: () => ({ width: 8, height: 8, getContext: () => fakeCtx }) };
}
const load = (rel) => vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel });
const has = (rel) => fs.existsSync(path.join(ROOT, rel));
load('js/core.js');
load('data/hoshi-to-bokura-to.js');
const MV = global.MV;
(MV._pendingPresets || []).forEach((p) => MV.registerPreset(p));
const HAS_ANALYSIS = has('js/analysis.js');
if (HAS_ANALYSIS) load('js/analysis.js');
const HAS_LYRICS = has('js/lyrics.js');
if (HAS_LYRICS) load('js/lyrics.js');
load('js/director.js');
const preset = MV.getPreset('hoshi-to-bokura-to');

/* ------------------------------------------------------------------ */
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(name + (detail != null ? ' :: ' + detail : ''));
  }
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail != null ? '  [' + detail + ']' : ''));
}
const f3 = (x) => (typeof x === 'number' ? x.toFixed(3) : String(x));
const hr = () => process.hrtime.bigint();
const msSince = (a) => Number(hr() - a) / 1e6;

/* ------------------------------------------------------------------ */
/* Synthetic features (preset grid + synthetic envelopes / onsets)     */
/* ------------------------------------------------------------------ */
function syntheticFeatures() {
  const dur = preset.match.duration;
  const fps = 100;
  const n = Math.ceil(dur * fps);
  const rms = new Float32Array(n), low = new Float32Array(n), mid = new Float32Array(n), high = new Float32Array(n), flux = new Float32Array(n);
  const secAt = (t) => preset.sections.find((s) => t >= s.start && t < s.end) || preset.sections[preset.sections.length - 1];
  const beats = preset.beats;
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const I = secAt(t).intensity;
    const bi = Math.max(0, MV.lowerIndex(beats, t));
    const since = t - beats[bi];
    const p = since >= 0 ? MV.pulse(since, 0.25) : 0;
    const nz = MV.rand(77, i) * 0.08;
    rms[i] = MV.clamp(I * (0.65 + 0.3 * p) + nz);
    low[i] = MV.clamp(I * (0.4 + 0.6 * p) + nz);
    mid[i] = MV.clamp(I * 0.8 + nz);
    high[i] = MV.clamp(I * (0.5 + 0.4 * MV.rand(78, i)));
    flux[i] = MV.clamp(p * I + nz);
  }
  const phase = MV.mod(preset.downbeatPhase | 0, 4); // true downbeats = beats[phase::4]
  const onsets = [];
  beats.forEach((b, k) => {
    const I = secAt(b).intensity;
    const down = MV.mod(k - phase, 4) === 0;
    onsets.push({ t: b, s: MV.clamp((down ? 0.75 : 0.45) + 0.35 * I * MV.rand(91, k)) });
    onsets.push({ t: b + 0.3, s: 0.2 + 0.2 * MV.rand(92, k) });
  });
  const f = {
    duration: dur, sampleRate: 22050, fps, length: n, rms, low, mid, high, flux,
    onsets, kicks: beats.filter((_, k) => k % 2 === 0),
    bpm: preset.bpm, beatsPerBar: 4, beats: beats.slice(), downbeats: beats.filter((_, k) => MV.mod(k - phase, 4) === 0), downbeatPhase: phase,
    sections: preset.sections.map((s) => Object.assign({}, s, { scenes: s.scenes && s.scenes.slice() })),
    novelty: new Float32Array(0), source: 'computed', presetId: null, presetOffset: 0, presetConfidence: 0,
  };
  if (HAS_ANALYSIS) MV.Analysis.applyPreset(f, preset, 0, 1);
  return f;
}

/* ------------------------------------------------------------------ */
/* Synthetic LyricTrack from preset timing (placeholder glyphs only)   */
/* ------------------------------------------------------------------ */
function syntheticTrack() {
  const lines = [];
  preset.lines.forEach((pl) => {
    if (pl.skip || !pl.phrases) return;
    const chars = new Array(pl.len).fill('■');
    const latinTail = pl.len >= 38; // the two long chorus lines end with a Latin tail
    pl.phrases.forEach((ph, k) => {
      if (k > 0 && ph.at - 1 > pl.phrases[k - 1].at) chars[ph.at - 1] = ' ';
    });
    if (latinTail) {
      const last = pl.phrases[pl.phrases.length - 1];
      const pat = 'Xxxx xx xxxxx xxx xxxxx xx';
      for (let i = last.at; i < pl.len; i++) chars[i] = pat[(i - last.at) % pat.length];
      if (chars[pl.len - 1] === ' ') chars[pl.len - 1] = 'x';
    }
    const text = chars.join('');
    const phrases = pl.phrases.map((ph, k) => {
      const nx = pl.phrases[k + 1];
      let ce = nx ? nx.at : pl.len;
      while (ce > ph.at && chars[ce - 1] === ' ') ce--;
      const ptext = chars.slice(ph.at, ce).join('');
      return { text: ptext, start: ph.t, end: nx ? nx.t : pl.end, charStart: ph.at, charEnd: ce, latin: MV.text.isLatin(ptext) };
    });
    const charTimes = new Float32Array(chars.length);
    phrases.forEach((p) => {
      const nC = p.charEnd - p.charStart;
      const span = Math.max(0.06 * nC, (p.end - p.start) * 0.55);
      for (let c = 0; c < nC; c++) charTimes[p.charStart + c] = p.start + (span * c) / Math.max(1, nC);
    });
    let last = phrases[0].start;
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === ' ') charTimes[i] = last;
      else last = charTimes[i];
    }
    const segments = [];
    let cs = 0;
    text.split(' ').forEach((s) => {
      segments.push({ text: s, charStart: cs, charEnd: cs + Array.from(s).length });
      cs += Array.from(s).length + 1;
    });
    const sec = preset.sections.find((s) => phrases[0].start >= s.start && phrases[0].start < s.end);
    lines.push({
      id: 'L' + pl.n, n: pl.n, index: lines.length, text, chars, start: phrases[0].start, end: pl.end,
      showStart: phrases[0].start - 0.3, showEnd: pl.end + 1.2, phrases, segments, charTimes,
      style: pl.style, styleSource: 'preset', emphasis: 0.5, isHook: pl.len <= 15, seed: MV.hash32(pl.key, pl.n),
      sectionKind: sec ? sec.kind : 'verse',
    });
  });
  return { source: 'preset', meta: {}, lines, unmatched: [], warnings: [], matched: { total: lines.length, matched: lines.length, skipped: 5 } };
}

/* ------------------------------------------------------------------ */
/* Invariant suite for one Director                                    */
/* ------------------------------------------------------------------ */
function suite(label, dir, o = {}) {
  const S = dir.sections;
  const cues = dir.cues;
  const sc = cues.scenes;
  const T = MV.Director.TRANSITIONS;
  const dur = dir.duration;

  // ---- scene cues
  let sorted = true, contiguous = true, inList = true, dupes = 0;
  for (let i = 0; i < sc.length; i++) {
    const c = sc[i];
    if (i > 0 && !(c.cut > sc[i - 1].cut)) sorted = false;
    if (i > 0 && Math.abs(sc[i - 1].end - (c.transition ? c.transition.end : c.cut)) > 1e-9) contiguous = false;
    if (S[c.section].scenes.indexOf(c.name) < 0) inList = false;
    if (i > 0 && c.name === sc[i - 1].name && c.variant === sc[i - 1].variant) dupes++;
  }
  check(`${label}: scene cues sorted / contiguous / from section lists`, sorted && contiguous && inList && sc[0].cut === 0 && sc[0].start === 0, `${sc.length} cues`);
  check(`${label}: no consecutive identical scene+variant`, dupes === 0, `dupes=${dupes}`);
  // A section opens with a cut at its start, or — when it starts on a pickup
  // (lyric-aligned) — on the next downbeat, less than half a bar later.
  let secFirst = true, delayed = [];
  S.forEach((s) => {
    const first = sc.find((c) => c.section === s.index);
    if (!first || Math.abs(first.cut - s.cut) > 1e-9) secFirst = false;
    else if (Math.abs(s.cut - s.start) > 1e-9) {
      const di = MV.lowerIndex(dir.downbeats, s.cut + 1e-6);
      if (!(s.cut > s.start && s.cut - s.start <= dir.barLen * 0.5 && di >= 0 && Math.abs(dir.downbeats[di] - s.cut) < 1e-9)) secFirst = false;
      delayed.push(`${s.name}@${f3(s.start)}→${f3(s.cut)}`);
    }
  });
  check(`${label}: every section opens with a cut at its start (pickup starts: next downbeat)`, secFirst, delayed.join(' ') || undefined);

  // bar-mode cuts on downbeats, spaced switchBars bars
  let barOk = true, barDetail = '';
  const D = dir.downbeats;
  for (const c of sc) {
    const s = S[c.section];
    if (c.k === 0 || s.switchOn === 'phrase') continue;
    const di = MV.lowerIndex(D, c.cut + 1e-6);
    if (di < 0 || Math.abs(D[di] - c.cut) > 1e-6) {
      barOk = false;
      barDetail = `cue ${c.index} @${f3(c.cut)} not a downbeat`;
    }
  }
  check(`${label}: bar-mode cuts land on downbeats`, barOk, barDetail || undefined);
  // cut spacing = switchBars bars
  let spaceOk = true, spaceDetail = '';
  for (let i = 1; i < sc.length; i++) {
    const c = sc[i], s = S[c.section];
    if (c.k === 0 || s.switchOn === 'phrase') continue;
    const bars = (c.cut - sc[i - 1].cut) / dir.barLen;
    if (Math.abs(bars - s.switchBars) > 0.2 && sc[i - 1].k !== 0) {
      spaceOk = false;
      spaceDetail = `cue ${i}: ${f3(bars)} bars vs ${s.switchBars}`;
    }
  }
  check(`${label}: in-section cuts every switchBars bars`, spaceOk, spaceDetail || undefined);

  // ---- true downbeats (preset downbeatPhase 3 → beats[3::4])
  if (o.downbeats) {
    const R = o.downbeats;
    const nearest = (t) => {
      const i = MV.lowerIndex(R, t);
      let d = Infinity;
      for (const k of [i, i + 1]) if (k >= 0 && k < R.length) d = Math.min(d, Math.abs(R[k] - t));
      return d;
    };
    let same = D.length === R.length;
    for (let i = 0; same && i < R.length; i++) if (Math.abs(D[i] - R[i]) > 1e-3) same = false;
    check(`${label}: director bars = true downbeats`, same, `${D.length} vs ${R.length}, first ${f3(D[0])} vs ${f3(R[0])}`);
    let worstCut = 0, worstEnd = 0, n = 0, endDetail = '';
    for (let i = 1; i < sc.length; i++) {
      const c = sc[i];
      if (c.k !== 0) continue;
      n++;
      worstCut = Math.max(worstCut, nearest(c.cut));
      if (c.transition) {
        const e = nearest(c.transition.end);
        if (e > worstEnd) {
          worstEnd = e;
          endDetail = `${S[c.section].name}@${f3(c.cut)} ${c.transition.name} ends ${f3(c.transition.end)}`;
        }
      }
    }
    check(`${label}: section cuts on true downbeats`, n > 0 && worstCut < 1e-3, `${n} section starts, worst |cut − downbeat| ${f3(worstCut)} s`);
    check(`${label}: section-start transitions end within ±0.2 s of a downbeat`, worstEnd <= 0.2, `worst ${f3(worstEnd)} s ${endDetail}`);
    const wrong = sc.filter((c) => c.k > 0 && S[c.section].switchOn !== 'phrase' && nearest(c.cut) > 1e-3).length;
    check(`${label}: bar-mode switches on true downbeats`, wrong === 0, `off-bar=${wrong}`);
  }

  // transitions
  let trOk = true, trDetail = '';
  let overl = 0;
  const counts = { strong: 0, light: 0, soft: 0, none: 0 };
  for (let i = 1; i < sc.length; i++) {
    const c = sc[i], s = S[c.section];
    const tr = c.transition;
    if (!tr) {
      counts.none++;
      if (c.k === 0 || s.intensity >= 0.35) {
        trOk = false;
        trDetail = `cue ${i} (${s.kind}, k=${c.k}) has no transition`;
      }
      continue;
    }
    if (!(tr.start < c.cut && tr.end > c.cut)) {
      trOk = false;
      trDetail = `cue ${i}: window ${f3(tr.start)}..${f3(tr.end)} vs cut ${f3(c.cut)}`;
    }
    const lead = c.cut - tr.start, tail = tr.end - c.cut;
    if (lead > 0.75 || tail > 0.45) {
      trOk = false;
      trDetail = `cue ${i}: lead ${f3(lead)} tail ${f3(tail)}`;
    }
    if (s.intensity < 0.35) {
      if (T.soft.indexOf(tr.name) < 0) {
        trOk = false;
        trDetail = `cue ${i}: quiet section uses ${tr.name}`;
      }
      counts.soft++;
    } else if (c.k === 0) {
      if (T.strong.indexOf(tr.name) < 0) {
        trOk = false;
        trDetail = `cue ${i}: section boundary uses ${tr.name}`;
      }
      counts.strong++;
    } else {
      if (T.light.indexOf(tr.name) < 0) {
        trOk = false;
        trDetail = `cue ${i}: in-section switch uses ${tr.name}`;
      }
      counts.light++;
    }
    const prev = sc[i - 1].transition;
    if (prev && prev.end > tr.start) overl++;
  }
  check(`${label}: transitions by boundary type / quietness, windows around the cut`, trOk, trDetail || JSON.stringify(counts));
  check(`${label}: transitions never overlap`, overl === 0, `overlaps=${overl}`);

  // ---- accents
  const acc = cues.accents;
  let accSorted = true;
  for (let i = 1; i < acc.length; i++) if (acc[i].t < acc[i - 1].t) accSorted = false;
  check(`${label}: accents sorted, finite, strengths 0..2`, accSorted && acc.every((a) => isFinite(a.t) && a.dur > 0 && a.strength >= 0 && a.strength <= 2), `${acc.length} accents ${JSON.stringify(dir.summary().accents)}`);
  const secOf = (t) => dir.sectionAt(t);
  const byKind = (k) => acc.filter((a) => a.kind === k);
  check(`${label}: confetti only in the climax`, byKind('confetti').length > 0 && byKind('confetti').every((a) => secOf(a.t).kind === 'climax'), `${byKind('confetti').length}`);
  check(`${label}: glitch spikes only in pre/build/climax`, cues.glitches.every((g) => /pre|build|climax/.test(secOf(g.t).kind)), `${cues.glitches.length} spikes`);
  check(`${label}: frame / flash accents only in choruses`, byKind('frame').concat(byKind('flash')).every((a) => /chorus|climax/.test(secOf(a.t).kind)), `frame=${byKind('frame').length} flash=${byKind('flash').length}`);
  check(`${label}: speedlines only at intensity ≥ 0.7`, byKind('speedlines').every((a) => dir.intensityAt(a.t) >= 0.7), `${byKind('speedlines').length}`);
  const secStarts = acc.filter((a) => (a.kind === 'ink' || a.kind === 'shards') && S.some((s) => Math.abs(s.cut - a.t) < 0.1));
  check(`${label}: ink / shards at section starts`, secStarts.length >= S.length - 2, `${secStarts.length} of ${S.length - 1}`);
  if (o.lyrics) {
    const lat = [];
    cues.lyrics.forEach((c) => c.line.phrases.forEach((p) => p.latin && lat.push(p.start)));
    const ok = lat.every((t) => acc.some((a) => a.kind === 'stars' && Math.abs(a.t - t) < 1e-6) && acc.some((a) => a.kind === 'ring' && Math.abs(a.t - t) < 1e-6));
    check(`${label}: stars + ring at every Latin phrase`, lat.length > 0 && ok, `${lat.length} Latin phrases`);
  }
  {
    const L = cues.lyrics;
    const vis = (a) => L.filter((c) => Math.min(a.t + a.dur, c.showEnd) - Math.max(a.t, c.showStart) > 0.05);
    const big = acc.filter((a) => a.kind === 'stars' || a.kind === 'speedlines');
    const bad = big.filter((a) => {
      const v = vis(a);
      if (!v.length) return !!a.avoid;
      if (!a.avoid || a.avoid.mode !== (a.kind === 'stars' ? 'away' : 'focus')) return true;
      return !a.avoid.lines.length || a.avoid.lines.length > 2 || !a.avoid.lines.every((x) => v.some((c) => c.line === x.line && c.style === x.style));
    });
    const withAvoid = big.filter((a) => a.avoid).length;
    check(`${label}: stars / speedlines over lyrics carry avoid info`, bad.length === 0, `${withAvoid}/${big.length} with avoid, bad=${bad.length}`);
  }
  const title = byKind('title')[0];
  if (o.title !== false) {
    const first = cues.lyrics[0];
    check(`${label}: title from the first beat until ~0.5 s before the first lyric`, !!title && Math.abs(title.t - dir.beats[0]) < 0.01 && (!first || (title.t + title.dur <= first.start - 0.45 && title.t + title.dur <= first.showStart)), title ? `${f3(title.t)}..${f3(title.t + title.dur)} first=${first ? f3(first.start) : '-'}` : 'none');
  }
  const cred = byKind('credits')[0];
  const inter = S.find((s) => s.credits);
  if (inter && o.credits !== false) {
    const cover = cred ? cred.dur / (inter.end - inter.start) : 0;
    check(`${label}: credits span most of the interlude`, !!cred && cred.t >= inter.start && cred.t + cred.dur <= inter.end && cover >= 0.7, `cover=${f3(cover)}`);
  }
  const outro = S.find((s) => s.endCard);
  const ec = byKind('endcard')[0];
  if (outro) check(`${label}: endcard in the outro until the end`, !!ec && ec.t >= outro.start && Math.abs(ec.t + ec.dur - dur) < 0.01, ec ? `${f3(ec.t)}..${f3(ec.t + ec.dur)}` : 'none');

  // ---- evaluate sweep
  let maxLyr = 0, maxOverlap = 0, badLt = 0, badEnv = '', badCam = '', badPost = '', trP = true, hudBad = 0;
  const step = 0.01;
  let prevIds = [];
  let overlapStart = null;
  for (let t = -0.5; t <= dur + 0.5; t += step) {
    const st = dir.evaluate(t);
    const e = st.env;
    if (st.lyrics.length > maxLyr) maxLyr = st.lyrics.length;
    if (st.lyrics.length === 2) {
      if (overlapStart == null) overlapStart = t;
      maxOverlap = Math.max(maxOverlap, t - overlapStart + step);
    } else overlapStart = null;
    for (const l of st.lyrics) {
      if (!(l.lt.in >= 0 && l.lt.in <= 1 && l.lt.out >= 0 && l.lt.out <= 1) || !(t >= l.lt.showStart && t < l.lt.showEnd)) badLt++;
    }
    if (!badEnv) {
      for (const k of ['energy', 'low', 'mid', 'high', 'flux', 'onsetPulse', 'intensity']) {
        if (!(e[k] >= 0 && e[k] <= 1)) badEnv = `${k}=${e[k]} @${f3(t)}`;
      }
      if (!(e.beat && e.beat.pulse >= 0 && e.beat.pulse <= 1 && e.beat.barPulse >= 0 && e.beat.period > 0)) badEnv = `beat @${f3(t)}`;
      if (!(e.section.progress >= 0 && e.section.progress <= 1)) badEnv = `progress @${f3(t)}`;
    }
    const c = st.camera;
    if (!badCam && !(Math.abs(c.x) < 45 && Math.abs(c.y) < 40 && c.zoom > 0.99 && c.zoom < 1.12 && Math.abs(c.rot) < 0.03)) badCam = `@${f3(t)} ${JSON.stringify(c)}`;
    const p = st.post;
    if (!badPost && !(p.rgbShift >= 0 && p.rgbShift <= 6 && p.glitch >= 0 && p.glitch <= 1 && p.flash >= 0 && p.flash <= 1 && p.grain >= 0.07 && p.vignette >= 0.35)) badPost = `@${f3(t)} ${JSON.stringify(p)}`;
    const tr = st.scene.transition;
    if (tr && !(tr.p >= 0 && tr.p <= 1 && st.scene.to)) trP = false;
    if (!tr && st.scene.to) trP = false;
    // hidden inside the title / endcard windows (± 0.2 s margin), visible elsewhere
    const near = (w) => !!w && t >= w[0] - 0.2 && t <= w[1] + 0.2;
    const edge = (w) => !!w && (Math.abs(t - w[0]) < 0.25 || Math.abs(t - w[1]) < 0.25);
    const hidden = near(dir.titleWindow) || near(dir.endWindow);
    if (o.hud !== false && !edge(dir.titleWindow) && !edge(dir.endWindow) && hidden === st.hud.visible) hudBad++;
    prevIds = st.lyrics.map((l) => l.line.id);
  }
  void prevIds;
  check(`${label}: ≤ 2 lyric lines at once, overlap ≤ 0.35 s`, maxLyr <= 2 && maxOverlap <= 0.36, `max=${maxLyr} overlap=${f3(maxOverlap)}`);
  check(`${label}: lt in/out in 0..1 and inside the show window`, badLt === 0, `bad=${badLt}`);
  check(`${label}: env fields in range`, !badEnv, badEnv || undefined);
  check(`${label}: camera bounded (|x|<45, |y|<40, zoom 0.99..1.12)`, !badCam, badCam || undefined);
  check(`${label}: post params in range (rgbShift ≤ 6 px)`, !badPost, badPost || undefined);
  check(`${label}: transition state consistent`, trP);
  if (o.hud !== false) check(`${label}: HUD hidden during title / endcard only`, hudBad === 0, `bad frames=${hudBad}`);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */
(async () => {
  console.log(`analysis.js: ${HAS_ANALYSIS ? 'yes' : 'no (fallbacks)'}  lyrics.js: ${HAS_LYRICS ? 'yes' : 'no'}`);
  const features = syntheticFeatures();
  const track = syntheticTrack();
  check('synthetic track: 12 displayed lines, placeholder glyphs only', track.lines.length === 12 && track.lines.every((l) => /^[■Xx ]+$/.test(l.text)), `${track.lines.length}`);

  let t0 = hr();
  const dir = new MV.Director({ features, track, preset, options: { hud: true, credits: true } });
  const buildMs = msSince(t0);
  const sum = dir.summary();
  check('build < 50 ms', buildMs < 50, `${f3(buildMs)} ms ${JSON.stringify(sum)}`);
  const trueDown = preset.beats.filter((_, k) => MV.mod(k - (preset.downbeatPhase | 0), 4) === 0);
  check('preset: true downbeats = beats[downbeatPhase::4]', (preset.downbeatPhase | 0) === 3 && features.downbeats.length === trueDown.length && features.downbeats.every((d, i) => Math.abs(d - trueDown[i]) < 1e-3), `phase=${preset.downbeatPhase} first=${f3(features.downbeats[0])}`);
  suite('synthetic', dir, { lyrics: true, downbeats: features.downbeats });

  // ---- specific timing expectations on the real preset
  const sc = dir.cues.scenes;
  const hookCuts = sc.filter((c) => dir.sections[c.section].kind === 'hook' && dir.sections[c.section].name === 'HOOK' && c.k > 0).map((c) => c.cut);
  const wantHook = [71.48, 76.28, 81.06];
  check('hook switches on phrase starts (snapped to beat within 80 ms)', hookCuts.length === 3 && hookCuts.every((c, i) => Math.abs(c - wantHook[i]) < 0.09), hookCuts.map(f3).join(','));
  const introCues = sc.filter((c) => dir.sections[c.section].kind === 'intro');
  // the intro opens with a pickup (beats 0–2); bars start on beats[3::4] → cut 2 bars after the first true downbeat
  check('intro: 2-bar switching (cut 2 bars after the first true downbeat)', introCues.length === 2 && Math.abs(introCues[1].cut - trueDown[2]) < 1e-6, introCues.map((c) => `${c.name}@${f3(c.cut)}`).join(' '));
  const outroCues = sc.filter((c) => dir.sections[c.section].kind === 'outro');
  check('outro: single scene cue (one-scene list)', outroCues.length === 1 && outroCues[0].name === 'starfield');
  const secStart = (kind) => preset.sections.find((x) => x.kind === kind).start;
  const chorusIn = sc.find((c) => Math.abs(c.cut - secStart('chorus')) < 1e-3);
  check('chorus entrance: strong transition landing just after the downbeat', chorusIn && chorusIn.transition && MV.Director.TRANSITIONS.strong.includes(chorusIn.transition.name) && chorusIn.transition.end - chorusIn.cut <= 0.2 && chorusIn.cut - chorusIn.transition.start >= 0.2, chorusIn && chorusIn.transition ? `${chorusIn.transition.name} ${f3(chorusIn.transition.start)}..${f3(chorusIn.transition.end)} cut ${f3(chorusIn.cut)}` : 'none');
  const bridgeIn = sc.find((c) => Math.abs(c.cut - secStart('bridge')) < 1e-3);
  check('bridge entrance (quiet) is a soft transition', bridgeIn && bridgeIn.transition && MV.Director.TRANSITIONS.soft.includes(bridgeIn.transition.name), bridgeIn && bridgeIn.transition ? bridgeIn.transition.name : 'none');
  const showers = dir.cues.accents.filter((a) => a.kind === 'stars' && a.data && a.data.shower);
  const inHeld = showers.filter((a) => a.t >= 187.7 && a.t <= 196.6).length;
  const inClimaxTail = showers.filter((a) => a.t >= 200 && a.t <= 212).length;
  check('star showers during the held final-hook note and the climax tail', inHeld >= 8 && inClimaxTail >= 6, `held=${inHeld} tail=${inClimaxTail}`);

  // lyric windows: gap > 3 s → end + 1.4 ; otherwise next.showStart − 0.05
  const L = dir.cues.lyrics;
  let winOk = true, winDetail = '';
  for (let i = 0; i < L.length; i++) {
    const c = L[i], nx = L[i + 1];
    const want = !nx || nx.showStart - c.end > 3 ? c.end + 1.4 : nx.showStart - 0.05;
    const w2 = Math.min(Math.max(want, c.start + 0.3, c.showStart + 0.5), nx ? nx.showStart + 0.35 : Infinity, dir.duration + 0.5);
    if (Math.abs(c.showEnd - w2) > 1e-6) {
      winOk = false;
      winDetail = `${c.id}: ${f3(c.showEnd)} vs ${f3(w2)}`;
    }
  }
  check('lyric showEnd refinement (hold / +1.4 s after long gaps)', winOk, winDetail || `${L.length} lines, L5 end=${f3(L[4].showEnd)} (line end ${f3(L[4].end)})`);
  const st1 = dir.evaluate(L[2].showStart + 0.15);
  const l1 = st1.lyrics.find((l) => l.line.id === L[2].id);
  check('lt.in ramps over 0.3 s, lt.t relative to line.start', l1 && Math.abs(l1.lt.in - 0.5) < 1e-6 && Math.abs(l1.lt.t - (L[2].showStart + 0.15 - L[2].start)) < 1e-9, l1 ? `in=${f3(l1.lt.in)} t=${f3(l1.lt.t)}` : 'none');
  const st2 = dir.evaluate(L[2].showEnd - 0.175);
  const l2 = st2.lyrics.find((l) => l.line.id === L[2].id);
  check('lt.out ramps over the last 0.35 s', l2 && Math.abs(l2.lt.out - 0.5) < 1e-6, l2 ? `out=${f3(l2.lt.out)}` : 'none');
  check('line style passed through', st1.lyrics.every((l) => l.style === l.line.style), st1.lyrics.map((l) => l.style).join(','));

  // intensity cross-fade at a boundary (pre → chorus)
  const ci = preset.sections.findIndex((x) => x.kind === 'chorus');
  const b = preset.sections[ci].start, Ia = preset.sections[ci - 1].intensity, Ib = preset.sections[ci].intensity;
  const iMid = dir.intensityAt(b), iA = dir.intensityAt(b - 0.5), iB = dir.intensityAt(b + 0.5);
  check('intensity cross-fades ±0.5 s at boundaries', Math.abs(iA - Ia) < 1e-9 && Math.abs(iB - Ib) < 1e-9 && Math.abs(iMid - (Ia + Ib) / 2) < 1e-6, `${f3(iA)} → ${f3(iMid)} → ${f3(iB)}`);
  // env.section / beat
  const cs = preset.sections[ci];
  const e1 = dir.evaluate(50).env;
  check('env.section + beat info at 50 s', e1.section.kind === 'chorus' && e1.section.index === ci && Math.abs(e1.section.progress - (50 - cs.start) / (cs.end - cs.start)) < 1e-6 && e1.beat.period > 0.55 && e1.beat.period < 0.65, `beat ${e1.beat.index}.${e1.beat.beatInBar} pulse=${f3(e1.beat.pulse)}`);
  const e2 = dir.evaluate(trueDown[12]).env; // a true downbeat
  check('true downbeat → beatInBar 0, barPulse 1', e2.beat.beatInBar === 0 && e2.beat.barPulse > 0.99, `bib=${e2.beat.beatInBar} bp=${f3(e2.beat.barPulse)}`);
  const e3 = dir.evaluate(preset.beats[48]).env; // beats[0::4] is beat 2 of the bar with phase 3
  check('beats[0::4] are not bar starts (phase 3)', e3.beat.beatInBar === MV.mod(48 - 3, 4) && e3.beat.barPulse < 0.5, `bib=${e3.beat.beatInBar}`);
  const e4 = dir.evaluate(preset.beats[1] + 0.05).env; // pickup before the first bar
  check('pickup beats before the first true downbeat: beatInBar 2', e4.beat.beatInBar === 2 && Math.abs(e4.beat.downbeatTime - (preset.beats[0] - (preset.beats[1] - preset.beats[0]))) < 1e-6, `bib=${e4.beat.beatInBar} down=${f3(e4.beat.downbeatTime)}`);

  // ---- determinism: same t → same state regardless of call order
  const ser = (st) => JSON.stringify(st, (k, v) => (k === 'line' ? v.id : v));
  const ts = [];
  for (let i = 0; i < 400; i++) ts.push(MV.rand(5, i) * 221.27);
  const first = ts.map((t) => ser(dir.evaluate(t)));
  const rev = ts.slice().reverse().map((t) => ser(dir.evaluate(t))).reverse();
  const dir2 = new MV.Director({ features, track, preset, options: { hud: true, credits: true } });
  const other = ts.map((t) => ser(dir2.evaluate(t)));
  check('evaluate deterministic (order-independent, instance-independent)', first.every((s, i) => s === rev[i] && s === other[i]));

  // no clocks / randomness while evaluating
  const saved = { r: Math.random, d: Date.now, p: global.performance && global.performance.now };
  let bad = 0;
  Math.random = () => (bad++, 0.5);
  Date.now = () => (bad++, 0);
  if (global.performance) global.performance.now = () => (bad++, 0);
  for (let i = 0; i < 2000; i++) dir.evaluate(i * 0.11);
  Math.random = saved.r;
  Date.now = saved.d;
  if (global.performance) global.performance.now = saved.p;
  check('evaluate uses no Math.random / Date.now / performance.now', bad === 0, `calls=${bad}`);

  // ---- timing
  const N = 50000;
  const times = new Float64Array(N);
  for (let i = 0; i < 2000; i++) dir.evaluate(MV.rand(9, i) * 221);
  let tot = hr();
  for (let i = 0; i < N; i++) {
    const a = hr();
    dir.evaluate(MV.rand(11, i) * 221.27);
    times[i] = Number(hr() - a) / 1e6;
  }
  const totMs = msSince(tot);
  const sortedT = Array.from(times).sort((a, b2) => a - b2);
  const avg = totMs / N, p50 = sortedT[N >> 1], p99 = sortedT[Math.floor(N * 0.99)];
  check('evaluate() fast (avg < 0.05 ms, p99 < 0.5 ms)', avg < 0.05 && p99 < 0.5, `avg=${(avg * 1000).toFixed(1)} µs p50=${(p50 * 1000).toFixed(1)} µs p99=${(p99 * 1000).toFixed(1)} µs`);
  // sequential playback (60 fps sweep)
  tot = hr();
  let frames = 0;
  for (let t = 0; t < 221.27; t += 1 / 60, frames++) dir.evaluate(t);
  check('evaluate() 60 fps sweep of the whole song', true, `${frames} frames in ${f3(msSince(tot))} ms → ${((msSince(tot) / frames) * 1000).toFixed(1)} µs/frame`);

  // ---- options
  const dNoCred = new MV.Director({ features, track, preset, options: { credits: false, hud: false } });
  check('options.credits=false removes the credits accent', !dNoCred.cues.accents.some((a) => a.kind === 'credits'));
  check('options.hud=false hides the HUD', [5, 50, 150].every((t) => dNoCred.evaluate(t).hud.visible === false));
  const hud = dir.evaluate(50).hud;
  check('HUD info from preset meta', hud.title === preset.meta.title && hud.artist === preset.meta.artist && hud.visible === true && hud.duration > 221 && hud.sectionName === 'CHORUS');
  const v0 = dir.version;
  dir.setOptions({ credits: false });
  check('setOptions rebuilds (version bump, credits gone)', dir.version === v0 + 1 && !dir.cues.accents.some((a) => a.kind === 'credits'));
  dir.setOptions({ credits: true });
  dir.setTrack(null);
  check('setTrack(null) → no lyric cues, hook falls back to bar switching', dir.cues.lyrics.length === 0 && dir.evaluate(50).lyrics.length === 0 && dir.cues.scenes.filter((c) => dir.sections[c.section].name === 'HOOK').length >= 3);
  dir.setTrack(track);

  // ---- robustness: missing inputs
  const variants = [
    ['preset only', { preset }],
    ['features only', { features }],
    ['track + preset (no features)', { track, preset }],
    ['nothing', {}],
    ['preset id string', { preset: 'hoshi-to-bokura-to', track }],
  ];
  for (const [name, cfg] of variants) {
    let ok = true, info = '';
    try {
      const d = new MV.Director(cfg);
      for (let t = 0; t < d.duration; t += 0.37) {
        const st = d.evaluate(t);
        if (!st.scene.from || !st.env || !st.camera) ok = false;
      }
      info = JSON.stringify(d.summary().transitions).slice(0, 80);
      if (name === 'preset id string') ok = ok && d.preset === preset && d.cues.lyrics.length === 12;
    } catch (e) {
      ok = false;
      info = e.message;
    }
    check(`robust: ${name}`, ok, info);
  }
  suite('preset-only', new MV.Director({ preset, track }), { lyrics: true, downbeats: trueDown });
  // off-grid section starts (≤ 0.15 s) snap onto the downbeat
  {
    const onBar = (t) => trueDown.some((d) => Math.abs(d - t) < 1e-6);
    const f2 = Object.assign({}, features, { sections: features.sections.map((x, i) => Object.assign({}, x, { start: i && onBar(x.start) ? x.start + (i % 2 ? 0.09 : -0.07) : x.start })) });
    const d2 = new MV.Director({ features: f2, track, preset });
    const moved = features.sections.filter((x, i) => i > 0 && onBar(x.start)).length;
    const off = d2.sections.filter((x, i) => i > 0 && Math.abs(x.start - features.sections[i].start) > 1e-6).length;
    check('section starts ≤ 0.15 s off the grid snap onto the true downbeat', moved >= 8 && off === 0 && d2.sections.length === features.sections.length, `perturbed=${moved} unsnapped=${off}`);
  }
  // phase / downbeat disagreement: the explicit downbeat list wins
  {
    const f3b = Object.assign({}, features, { downbeatPhase: 0 });
    const d3 = new MV.Director({ features: f3b, track, preset });
    check('explicit downbeats win over a disagreeing downbeatPhase', d3.F.downbeatPhase === 3 && d3.evaluate(trueDown[20] + 0.01).env.beat.beatInBar === 0, `phase=${d3.F.downbeatPhase}`);
  }

  // ---- registered subsets: unknown scene / transition names are dropped
  {
    ['sunburst', 'starfield', 'crowd'].forEach((n) => MV.scenes.register(n, { draw() {} }));
    ['shatter', 'glitch-cut', 'star-iris'].forEach((n) => MV.transitions.register(n, { duration: 0.6, draw() {} }));
    const d = new MV.Director({ features, track, preset });
    const names = new Set(d.cues.scenes.map((c) => c.name));
    const trs = new Set(d.cues.scenes.filter((c) => c.transition).map((c) => c.transition.name));
    const durOk = d.cues.scenes.every((c) => !c.transition || Math.abs(c.transition.end - c.transition.start - 0.6) < 1e-6 || c.transition.end - c.transition.start < 0.6);
    check('only registered scenes / transitions are cued (registry durations used)', [...names].every((n) => MV.scenes.has(n)) && [...trs].every((n) => MV.transitions.has(n)) && durOk, `${[...names].join(',')} | ${[...trs].join(',')}`);
    // reset registries for the remaining tests
    MV.scenes = MV.registry('scene');
    MV.transitions = MV.registry('transition');
  }

  // ---- fallback lookups agree with MV.Analysis
  if (HAS_ANALYSIS) {
    const savedA = MV.Analysis;
    const withA = [];
    for (let i = 0; i < 500; i++) withA.push(dir.evaluate(i * 0.4417).env);
    MV.Analysis = undefined;
    let mism = 0, maxE = 0;
    for (let i = 0; i < 500; i++) {
      const e = dir.evaluate(i * 0.4417).env;
      const a = withA[i];
      if (e.beat.index !== a.beat.index || e.beat.beatInBar !== a.beat.beatInBar || Math.abs(e.beat.sinceDownbeat - a.beat.sinceDownbeat) > 1e-6) mism++;
      maxE = Math.max(maxE, Math.abs(e.energy - a.energy));
    }
    MV.Analysis = savedA;
    check('internal fallbacks match MV.Analysis (beat grid exact, envelopes close)', mism === 0 && maxE < 0.08, `beat mismatches=${mism} max |Δenergy|=${f3(maxE)}`);
  }

  // ---- lyrics.js integration with placeholder text (order-based mapping)
  if (HAS_LYRICS) {
    const placeholder = [
      '夜明けの駅で 君を待つ 足音だけが響く',
      '古い地図を 閉じたまま 窓の外を 見ていた',
      '光る街角 走り出す 風の中へ',
      '遠い約束 胸に抱いて Keep moving on tonight',
      '夢 いま ここ ある',
      '消えない灯り 今夜も 探して ひとり 歩いた 夜空の 下で 笑う',
      '手を伸ばせば 届く気がした 星の 欠片',
      '光る街角 走り出す 風の中へ',
      '遠い約束 胸に抱いて Keep moving on tonight',
      '明日の扉を 叩く音 いつか また',
      '振り返らずに 進むだけ Keep moving on again',
      '空 いつも 同じ 色',
    ].join('\n');
    try {
      const tr = MV.Lyrics.parse(placeholder, { preset, features });
      const d = new MV.Director({ features, track: tr, preset });
      check('lyrics.js placeholder track → director lyric cues', d.cues.lyrics.length === tr.lines.length && tr.lines.length >= 10, `${tr.source} lines=${tr.lines.length}`);
      suite('lyrics.js-placeholder', d, { lyrics: true, downbeats: features.downbeats });
    } catch (e) {
      check('lyrics.js placeholder integration', false, e.message);
    }
  }

  // ---- real features from the local WAV (optional)
  const wav = process.env.MV_SONG_WAV;
  let realFeatures = null;
  if (HAS_ANALYSIS && wav && fs.existsSync(wav)) {
    const w = readWav(wav);
    const buf = { sampleRate: w.sampleRate, length: w.channels[0].length, duration: w.channels[0].length / w.sampleRate, numberOfChannels: w.channels.length, getChannelData: (i) => w.channels[i] };
    t0 = hr();
    realFeatures = await MV.Analysis.compute(buf, {});
    const m = MV.Analysis.matchPreset(realFeatures, [preset]);
    if (m) MV.Analysis.applyPreset(realFeatures, m.preset, m.offset, m.confidence);
    check('real WAV: analysis + preset match', !!m && realFeatures.source === 'preset', `${f3(msSince(t0))} ms, offset=${m ? f3(m.offset) : '-'} conf=${m ? f3(m.confidence) : '-'} onsets=${realFeatures.onsets.length}`);
    const dR = new MV.Director({ features: realFeatures, track, preset });
    const sR = dR.summary();
    check('real WAV: glitch spikes from strong onsets exist', sR.glitches > 3, `glitches=${sR.glitches}`);
    suite('real-wav', dR, { lyrics: true, downbeats: realFeatures.downbeats });
    // evaluate timing with real envelopes
    const n2 = 20000;
    const a2 = hr();
    for (let i = 0; i < n2; i++) dR.evaluate(MV.rand(13, i) * 221.27);
    check('real WAV: evaluate() avg time', true, `${((msSince(a2) / n2) * 1000).toFixed(1)} µs`);
    const ons = [];
    for (let t = 0; t < 221; t += 0.05) ons.push(dR.evaluate(t).env.onsetPulse);
    const mean = ons.reduce((a, b2) => a + b2, 0) / ons.length;
    check('real WAV: onsetPulse is lively (mean 0.05..0.6)', mean > 0.05 && mean < 0.6, `mean=${f3(mean)}`);
  } else console.log('SKIP  real-WAV tests (set MV_SONG_WAV)');

  // ---- real lyrics (optional; content never printed)
  if (HAS_LYRICS) {
    for (const env of ['MV_LYRICS', 'MV_LYRICS_PASTE']) {
      const file = process.env[env];
      if (!file || !fs.existsSync(file)) {
        console.log(`SKIP  ${env} not set`);
        continue;
      }
      if (path.resolve(file).startsWith(path.resolve(ROOT, '..') + path.sep)) {
        check(`${env} lives outside the repository`, false);
        continue;
      }
      const text = fs.readFileSync(file, 'utf8');
      const tr = MV.Lyrics.parse(text, { preset, features: realFeatures || features });
      const d = new MV.Director({ features: realFeatures || features, track: tr, preset });
      const ids = d.cues.lyrics.map((c) => c.line.n);
      check(`${env}: 12 displayed lines (1-5, 11-17), none of 6-10`, ids.length === 12 && !ids.some((n) => n >= 6 && n <= 10), `n=${ids.join(',')} source=${tr.source}`);
      suite(env, d, { lyrics: true, downbeats: (realFeatures || features).downbeats });
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('Failures:\n  ' + failures.join('\n  '));
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

/* tiny WAV reader (PCM 16-bit / float) */
function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV');
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    else if (id === 'data') data = { off: body, size: Math.min(size, buf.length - body) };
    off = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('missing fmt/data');
  const bps = fmt.bits / 8;
  const frames = Math.floor(data.size / (bps * fmt.channels));
  const chans = [];
  for (let c = 0; c < fmt.channels; c++) chans.push(new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const p = data.off + (i * fmt.channels + c) * bps;
      chans[c][i] = fmt.format === 3 ? buf.readFloatLE(p) : fmt.bits === 16 ? buf.readInt16LE(p) / 32768 : buf.readInt32LE(p) / 2147483648;
    }
  }
  return { sampleRate: fmt.sampleRate, channels: chans };
}

/*
 * Node test for MV.Analysis (js/analysis.js).
 *
 *   node mv/tools/test-analysis.cjs [path/to/song.wav]
 *
 * WAV path defaults to $MV_SONG_WAV. The WAV is the user's own recording and
 * stays outside the repo. Without a WAV only the synthetic tests run.
 * Prints numbers only (no lyric text is ever read here).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

/* ---------- minimal browser shims so core.js can load in Node ---------- */
global.window = global;
if (!global.document) {
  const fakeCtx = { measureText: () => ({ width: 0 }), font: '' };
  global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx }) };
}
function load(rel) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel });
}
load('js/core.js');
load('data/hoshi-to-bokura-to.js');
load('js/analysis.js');
const MV = global.MV;
const A = MV.Analysis;

/* ---------- tiny WAV reader (PCM 8/16/24/32-bit int, 32-bit float) ---------- */
function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV');
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
      if (fmt.format === 0xfffe && size >= 26) fmt.format = buf.readUInt16LE(body + 24);
    } else if (id === 'data') {
      data = { off: body, size: Math.min(size, buf.length - body) };
    }
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
      let v;
      if (fmt.format === 3 && fmt.bits === 32) v = buf.readFloatLE(p);
      else if (fmt.bits === 16) v = buf.readInt16LE(p) / 32768;
      else if (fmt.bits === 24) v = buf.readIntLE(p, 3) / 8388608;
      else if (fmt.bits === 32) v = buf.readInt32LE(p) / 2147483648;
      else if (fmt.bits === 8) v = (buf.readUInt8(p) - 128) / 128;
      else throw new Error('unsupported bits ' + fmt.bits);
      chans[c][i] = v;
    }
  }
  return { sampleRate: fmt.sampleRate, channels: chans };
}

// AudioBuffer-like shim.
function shim(channels, sampleRate) {
  const length = channels[0].length;
  return {
    sampleRate,
    length,
    duration: length / sampleRate,
    numberOfChannels: channels.length,
    getChannelData: (i) => channels[i],
  };
}

/* ---------- metrics ---------- */
// One-to-one greedy matching within ±tol.
function fmeasure(est, ref, tol) {
  const used = new Uint8Array(ref.length);
  let hit = 0, j0 = 0;
  const errs = [];
  for (const t of est) {
    while (j0 < ref.length && ref[j0] < t - tol) j0++;
    let best = -1, bd = Infinity;
    for (let j = j0; j < ref.length && ref[j] <= t + tol; j++) {
      if (used[j]) continue;
      const d = Math.abs(ref[j] - t);
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    if (best >= 0) {
      used[best] = 1;
      hit++;
      errs.push(t - ref[best]);
    }
  }
  const P = est.length ? hit / est.length : 0;
  const R = ref.length ? hit / ref.length : 0;
  const F = P + R > 0 ? (2 * P * R) / (P + R) : 0;
  const meanErr = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 0;
  return { P, R, F, hit, meanErr };
}
function fracWithin(est, ref, tol) {
  if (!est.length) return 0;
  let ok = 0;
  for (const t of est) {
    const i = MV.lowerIndex(ref, t);
    const d = Math.min(i >= 0 ? t - ref[i] : Infinity, i + 1 < ref.length ? ref[i + 1] - t : Infinity);
    if (d <= tol) ok++;
  }
  return ok / est.length;
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const f3 = (x) => (typeof x === 'number' ? x.toFixed(3) : String(x));

async function timed(buf) {
  let calls = 0, last = -1, mono = true;
  const t0 = process.hrtime.bigint();
  const feats = await A.compute(buf, {
    onProgress: (p) => {
      calls++;
      if (p < last) mono = false;
      last = p;
    },
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { feats, ms, calls, last, mono };
}

function clickTrack(seconds, bpm, sr) {
  const x = new Float32Array(Math.round(seconds * sr));
  const period = 60 / bpm;
  for (let k = 0; k * period < seconds; k++) {
    const s0 = Math.round(k * period * sr);
    const accent = k % 4 === 0 ? 1 : 0.6;
    for (let i = 0; i < Math.round(0.03 * sr) && s0 + i < x.length; i++) {
      const env = Math.exp(-i / (0.004 * sr));
      x[s0 + i] += accent * 0.8 * env * Math.sin((2 * Math.PI * 1000 * i) / sr) + accent * 0.5 * env * Math.sin((2 * Math.PI * 60 * i) / sr);
    }
  }
  return x;
}

(async function main() {
  const preset = MV.getPreset('hoshi-to-bokura-to') || (MV._pendingPresets || [])[0];
  check('preset registered in MV.presets (load-order drain)', MV.presets.some((p) => p.id === 'hoshi-to-bokura-to'), `MV.presets=${MV.presets.length}`);

  /* ---------- pure helpers ---------- */
  {
    const fft = A._internal.makeFFT(8);
    const re = Float64Array.from([1, 2, 3, 4, 0, 0, 0, 0]), im = new Float64Array(8);
    fft(re, im);
    // DFT reference
    const x = [1, 2, 3, 4, 0, 0, 0, 0];
    let maxErr = 0;
    for (let k = 0; k < 8; k++) {
      let r = 0, i = 0;
      for (let n = 0; n < 8; n++) {
        r += x[n] * Math.cos((2 * Math.PI * k * n) / 8);
        i -= x[n] * Math.sin((2 * Math.PI * k * n) / 8);
      }
      maxErr = Math.max(maxErr, Math.abs(r - re[k]), Math.abs(i - im[k]));
    }
    check('FFT matches DFT', maxErr < 1e-9, `maxErr=${maxErr.toExponential(2)}`);
    const bytes = A._internal.b64decode(preset.refEnvelope.data);
    check('base64 decode length', bytes.length === Math.round(preset.match.duration / 0.05 - 1) || bytes.length > 4000, `len=${bytes.length}`);
  }

  /* ---------- synthetic click track (always runs) ---------- */
  {
    const sr = 22050;
    const x = clickTrack(200, 120, sr);
    const { feats, ms } = await timed(shim([x], sr));
    const ideal = [];
    for (let t = 0; t < 200; t += 0.5) ideal.push(t);
    const fm = fmeasure(feats.beats, ideal, 0.07);
    check('click track: bpm = 120 ± 1', Math.abs(feats.bpm - 120) <= 1, `bpm=${feats.bpm} (${ms.toFixed(0)} ms)`);
    check('click track: beat F ≥ 0.95', fm.F >= 0.95, `F=${f3(fm.F)} meanErr=${(fm.meanErr * 1000).toFixed(1)} ms`);
    const dbOk = fracWithin(feats.downbeats, ideal.filter((_, i) => i % 4 === 0), 0.07);
    check('click track: accented downbeats found', dbOk >= 0.9, `frac=${f3(dbOk)}`);
    const raw = A.correlatePreset(feats, preset);
    const m = A.matchPreset(feats, [preset]);
    check('click track: matchPreset null or conf < 0.3', !m || m.confidence < 0.3, `match=${m ? f3(m.confidence) : 'null'} rawNCC=${f3(raw && raw.confidence)}`);
    check('click track: kicks detected', feats.kicks.length > 300, `kicks=${feats.kicks.length} onsets=${feats.onsets.length}`);
  }

  /* ---------- silence / tiny input robustness ---------- */
  {
    const sr = 22050;
    const { feats } = await timed(shim([new Float32Array(sr * 3)], sr));
    const finite = ['rms', 'low', 'mid', 'high', 'flux'].every((k) => feats[k].every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
    check('silence: finite envelopes, sections cover', finite && feats.sections.length >= 1 && feats.sections[0].start === 0, `beats=${feats.beats.length} sections=${feats.sections.length}`);
    const empty = await A.compute(shim([new Float32Array(0)], sr));
    check('empty buffer: no throw', !!empty && empty.length >= 1, `len=${empty.length}`);
    const st = new Float32Array(sr * 4), st2 = new Float32Array(sr * 4);
    for (let i = 0; i < st.length; i++) {
      st[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr);
      st2[i] = -st[i];
    }
    const nov = A.novelty(shim([st, st2], sr));
    check('stereo downmix (mean of channels) in novelty', nov.every((v) => v === 0), `n=${nov.length}`);
  }

  /* ---------- the real song ---------- */
  const wav = process.argv[2] || process.env.MV_SONG_WAV;
  if (!wav || !fs.existsSync(wav)) {
    console.log('SKIP  real-song tests (pass a WAV path or set MV_SONG_WAV)');
  } else {
    const w = readWav(wav);
    const buf = shim(w.channels, w.sampleRate);
    console.log(`song: sr=${w.sampleRate} ch=${w.channels.length} dur=${buf.duration.toFixed(2)} s`);
    const { feats, ms, calls, last, mono } = await timed(buf);
    check('compute runtime (Node) < 3 s', ms < 3000, `${ms.toFixed(0)} ms, progress calls=${calls}, last=${last}, monotonic=${mono}`);
    check('progress reported 0..1 monotonic', calls >= 10 && last === 1 && mono);
    check('bpm within 99.38 ± 1', Math.abs(feats.bpm - 99.38) <= 1, `bpm=${feats.bpm} (ACF period ${feats.debug.tempoPeriodFrames} frames)`);
    const fm = fmeasure(feats.beats, preset.beats, 0.07);
    check('beat F-measure ≥ 0.85 (±70 ms)', fm.F >= 0.85, `F=${f3(fm.F)} P=${f3(fm.P)} R=${f3(fm.R)} est=${feats.beats.length} ref=${preset.beats.length} meanErr=${(fm.meanErr * 1000).toFixed(1)} ms`);
    const pPhase = (preset.downbeatPhase | 0) % 4;
    const bars = preset.beats.filter((_, i) => i % 4 === pPhase);
    const dbf = fracWithin(feats.downbeats, bars, 0.07);
    const alt = [0, 1, 2, 3].map((ph) => fracWithin(feats.downbeats, preset.beats.filter((_, i) => i % 4 === ph), 0.07));
    check(`downbeats within ±70 ms of preset bars (beats[${pPhase}::4]) ≥ 80%`, dbf >= 0.8, `frac=${f3(dbf)} n=${feats.downbeats.length}; vs beats[k::4] for k=0..3: ${alt.map(f3).join(' / ')}`);
    if (dbf < 0.8 && Math.max(...alt) >= 0.8) {
      const k = alt.indexOf(Math.max(...alt));
      console.log(`  NOTE  computed bars start at preset beats[${k}::4]. Harmonic change (chroma, bass), low-band energy and`);
      console.log('        kick onsets all peak on that beat, and high-band accents fall on the preset beats 1 and 3');
      console.log('        (a backbeat if those are beats 2 and 4). The preset bar phase is likely one beat late;');
      console.log(`        setting preset.downbeatPhase = ${k} (supported by applyPreset) would align it. Needs a human listen.`);
    }
    // Envelope sanity.
    const envStats = ['rms', 'low', 'mid', 'high', 'flux'].map((k) => {
      const a = feats[k];
      let mn = 1, mx = 0, s = 0;
      for (const v of a) {
        mn = Math.min(mn, v);
        mx = Math.max(mx, v);
        s += v;
      }
      return `${k}: mean=${(s / a.length).toFixed(2)} max=${mx.toFixed(2)}`;
    });
    console.log('  envelopes  ' + envStats.join(' | '));
    const q = (a, b) => A.avg(feats, 'rms', a, b).toFixed(2);
    console.log(`  rms avg: intro ${q(0, 10.3)} verse ${q(10.3, 29.5)} chorus ${q(46.3, 66.5)} bridge ${q(106.3, 130.3)} chorus3 ${q(162.6, 181.8)} climax ${q(190.3, 211.9)} outro ${q(212, 221)}`);
    check('envelopes: bridge quieter than chorus', A.avg(feats, 'rms', 106.3, 130.3) + 0.1 < A.avg(feats, 'rms', 162.6, 181.8));
    console.log(`  onsets=${feats.onsets.length} kicks=${feats.kicks.length} (kicks in bridge 106-130: ${feats.kicks.filter((t) => t > 106.3 && t < 130.3).length}, in chorus 162-181: ${feats.kicks.filter((t) => t > 162.6 && t < 181.8).length})`);
    // Sections.
    console.log('  computed sections:');
    feats.sections.forEach((s) => console.log(`    ${s.start.toFixed(2).padStart(7)} – ${s.end.toFixed(2).padStart(7)}  ${s.kind.padEnd(9)} int=${s.intensity.toFixed(2)} energy=${s.energy.toFixed(2)} scenes=${s.scenes.join(',')} sw=${s.switchBars}${s.credits ? ' credits' : ''}${s.endCard ? ' endCard' : ''}`));
    console.log('  preset sections:');
    preset.sections.forEach((s) => console.log(`    ${s.start.toFixed(2).padStart(7)} – ${s.end.toFixed(2).padStart(7)}  ${s.kind}`));
    const pb = preset.sections.map((s) => s.start).slice(1);
    const cb = feats.sections.map((s) => s.start).slice(1);
    const bHit = cb.filter((t) => pb.some((p) => Math.abs(p - t) <= 2.5)).length;
    console.log(`  boundary agreement (±2.5 s): ${bHit}/${cb.length} computed boundaries hit a preset boundary (preset has ${pb.length})`);
    const cover = feats.sections.every((s, i) => i === 0 ? s.start === 0 : Math.abs(s.start - feats.sections[i - 1].end) < 1e-6);
    check('sections contiguous from 0 to duration', cover && Math.abs(feats.sections[feats.sections.length - 1].end - feats.duration) < 0.01);
    // Novelty vs preset reference.
    const r0 = A.correlatePreset(feats, preset);
    const m = A.matchPreset(feats);
    check('matchPreset(full): |offset| < 0.1 and conf ≥ 0.6', m && Math.abs(m.offset) < 0.1 && m.confidence >= 0.6, m ? `offset=${f3(m.offset)} conf=${f3(m.confidence)} durMatch=${m.durationMatch}` : `null (raw ${JSON.stringify(r0)})`);
    // Pure lookups.
    const bi = A.beatInfo(feats, 50.0);
    check('beatInfo shape', ['index', 'phase', 'period', 'bar', 'barPhase', 'beatInBar', 'sinceBeat', 'sinceDownbeat', 'pulse', 'barPulse'].every((k) => typeof bi[k] === 'number' && Number.isFinite(bi[k])), `t=50 index=${bi.index} beatInBar=${bi.beatInBar} phase=${bi.phase.toFixed(2)} period=${bi.period.toFixed(3)}`);
    const biPre = A.beatInfo(feats, 0.05), biPost = A.beatInfo(feats, 221.2);
    check('beatInfo extrapolates outside grid', Number.isFinite(biPre.index) && biPre.phase >= 0 && biPost.phase >= 0 && biPost.phase < 1, `pre idx=${biPre.index} post idx=${biPost.index}`);
    check('sample(): 0 outside, in range inside', A.sample(feats, 'rms', -1) === 0 && A.sample(feats, 'rms', 1e6) === 0 && A.sample(feats, 'rms', 60) > 0);
    const aw = A.avg(feats, 'low', 50, 60);
    let s = 0;
    for (let i = 5000; i <= 6000; i++) s += feats.low[i];
    check('avg() ≈ brute-force mean', Math.abs(aw - s / 1001) < 0.01, `${aw.toFixed(4)} vs ${(s / 1001).toFixed(4)}`);
    const sa = A.sectionAt(feats, 100);
    check('sectionAt', sa && sa.section.start <= 100 && sa.section.end > 100, sa ? `${sa.index} ${sa.section.kind}` : 'null');

    // Novelty exactness: reproduce the formula independently.
    {
      const x = w.channels[0];
      const hopS = Math.floor(w.sampleRate * 0.05);
      const nF = Math.floor(x.length / hopS);
      const e = new Float64Array(nF);
      let emax = 0;
      for (let f = 0; f < nF; f++) {
        let acc = 0;
        for (let i = f * hopS; i < (f + 1) * hopS; i++) acc += x[i] * x[i];
        e[f] = Math.log1p(100 * Math.sqrt(acc / hopS));
        emax = Math.max(emax, e[f]);
      }
      const d = new Float64Array(nF);
      let dmax = 0;
      for (let f = 1; f < nF; f++) {
        d[f] = Math.max(0, e[f] / emax - e[f - 1] / emax);
        dmax = Math.max(dmax, d[f]);
      }
      let err = 0;
      for (let f = 0; f < nF; f++) err = Math.max(err, Math.abs(d[f] / dmax - feats.novelty[f]));
      check('novelty == refEnvelope formula', err < 1e-5 && feats.novelty.length === nF, `maxErr=${err.toExponential(2)} n=${nF}`);
    }

    // First 3.0 s removed → offset −3.0.
    {
      const cut = Math.round(3.0 * w.sampleRate);
      const chs = w.channels.map((c) => c.subarray(cut));
      const { feats: f2, ms: ms2 } = await timed(shim(chs, w.sampleRate));
      const m2 = A.matchPreset(f2);
      check('matchPreset(cut 3.0 s): offset = −3.0 ± 0.1', m2 && Math.abs(m2.offset + 3.0) <= 0.1, m2 ? `offset=${f3(m2.offset)} conf=${f3(m2.confidence)} (${ms2.toFixed(0)} ms)` : 'null');
      if (m2) {
        A.applyPreset(f2, m2.preset, m2.offset, m2.confidence);
        const expFirstDown = preset.beats[4] - 3.0;
        check('applyPreset(cut): shifted grid, downbeats keep bar phase', f2.source === 'preset' && Math.abs(f2.downbeats[0] - expFirstDown) < 0.002 && f2.downbeatPhase === 0 && Math.abs(f2.presetOffset + 3.0) <= 0.1, `firstDown=${f3(f2.downbeats[0])} exp=${f3(expFirstDown)} phase=${f2.downbeatPhase} beats=${f2.beats.length}`);
        const secOk = f2.sections[0].start === 0 && Math.abs(f2.sections[1].start - (preset.sections[1].start + m2.offset)) < 0.01 && Math.abs(f2.sections[f2.sections.length - 1].end - f2.duration) < 0.01;
        check('applyPreset(cut): sections shifted, cover [0,dur]', secOk, `s1=${f3(f2.sections[1].start)} last.end=${f3(f2.sections[f2.sections.length - 1].end)}`);
        const bi2 = A.beatInfo(f2, f2.downbeats[3] + 0.01);
        check('beatInfo on preset grid: downbeat → beatInBar 0', bi2.beatInBar === 0 && bi2.sinceDownbeat < 0.02, `beatInBar=${bi2.beatInBar} sinceDown=${f3(bi2.sinceDownbeat)}`);
        const bi3 = A.beatInfo(f2, 0.0);
        check('beatInfo before first preset beat', Number.isFinite(bi3.index) && bi3.index < 0 && bi3.phase >= 0, `index=${bi3.index} beatInBar=${bi3.beatInBar}`);
        A.restoreComputed(f2);
        check('restoreComputed', f2.source === 'computed' && f2.presetId === null && f2.beats.length > 100);
      }
    }

    // Optional preset.downbeatPhase (bar phase override) is honoured by applyPreset.
    {
      const computedDown = feats.downbeats.slice();
      const shifted = Object.assign({}, preset, { downbeatPhase: 3 });
      const f3p = Object.assign({}, feats, { computed: null, source: 'computed' });
      A.applyPreset(f3p, shifted, m ? m.offset : 0);
      const agree = fracWithin(computedDown, f3p.downbeats, 0.07);
      const bi = A.beatInfo(f3p, f3p.downbeats[5] + 0.01);
      check('applyPreset honours preset.downbeatPhase', agree >= 0.95 && bi.beatInBar === 0 && f3p.downbeatPhase === 3, `computed downbeats vs preset beats[3::4]: ${f3(agree)} phase=${f3p.downbeatPhase}`);
    }

    // applyPreset on the full song, default confidence.
    {
      const before = feats.beats.length;
      A.applyPreset(feats, preset, m ? m.offset : 0);
      const fm2 = fmeasure(feats.beats, preset.beats, 0.001 + Math.abs(m ? m.offset : 0));
      check('applyPreset(full): preset grid, confidence computed', feats.source === 'preset' && feats.presetId === preset.id && feats.presetConfidence >= 0.6 && fm2.F > 0.99 && feats.bpm === preset.bpm, `conf=${f3(feats.presetConfidence)} beats ${before}→${feats.beats.length} downbeats=${feats.downbeats.length}`);
      const kinds = feats.sections.map((s) => s.kind).join(',');
      check('applyPreset keeps scenes/flags and energy', feats.sections.some((s) => s.credits) && feats.sections.some((s) => s.endCard) && feats.sections.every((s) => typeof s.energy === 'number'), kinds);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

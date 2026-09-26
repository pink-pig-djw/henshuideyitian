/*
 * Dev helper: a synthetic, deterministic `env` (see docs/ARCHITECTURE.md §2.4)
 * so scenes / lyric styles / effects can be rendered in isolation without audio.
 *
 *   const env = MV.devEnv(t, { bpm: 99.38, kind: 'chorus', intensity: 0.9 });
 *
 * Also provides MV.devLine(text, opts) → a Line object with synthetic timing,
 * for lyric-style galleries. Use invented placeholder text only.
 */
(function () {
  'use strict';
  const MV = window.MV;

  MV.devEnv = function (t, o = {}) {
    const bpm = o.bpm || 99.38;
    const period = 60 / bpm;
    const first = o.firstBeat == null ? 0.72 : o.firstBeat;
    const k = (t - first) / period;
    const index = Math.floor(k);
    const phase = MV.fract(k);
    const beatInBar = MV.mod(index, 4);
    const bar = Math.floor(index / 4);
    const sinceBeat = phase * period;
    const sinceDownbeat = (beatInBar + phase) * period;
    const intensity = o.intensity == null ? 0.8 : o.intensity;
    const wobble = 0.5 + 0.5 * Math.sin(t * 0.7);
    const energy = MV.clamp(intensity * (0.7 + 0.3 * wobble) * (0.85 + 0.15 * MV.pulse(sinceBeat, 0.3)));
    const dur = o.duration || 221.27;
    return {
      t,
      dt: o.dt || 1 / 60,
      duration: dur,
      energy,
      low: MV.clamp(energy * (0.6 + 0.4 * MV.pulse(sinceBeat, 0.2))),
      mid: MV.clamp(energy * 0.8),
      high: MV.clamp(energy * (0.5 + 0.5 * MV.pulse(MV.fract(k * 2) * period / 2, 0.1))),
      flux: MV.clamp(MV.pulse(sinceBeat, 0.15) * intensity),
      onsetPulse: MV.pulse(sinceBeat, 0.25) * intensity,
      beat: {
        index, phase, period, bar,
        barPhase: (beatInBar + phase) / 4,
        beatInBar, sinceBeat, sinceDownbeat,
        pulse: MV.pulse(sinceBeat, 0.35),
        barPulse: MV.pulse(sinceDownbeat, 0.6),
        nextBeat: first + (index + 1) * period,
      },
      section: {
        kind: o.kind || 'chorus', name: (o.kind || 'chorus').toUpperCase(),
        start: o.sectionStart || 0, end: o.sectionEnd || dur, index: 0,
        progress: MV.clamp((t - (o.sectionStart || 0)) / ((o.sectionEnd || dur) - (o.sectionStart || 0))),
        intensity,
      },
      intensity,
      quality: o.quality || 1,
      seed: o.seed || 1234,
    };
  };

  // Build a Line with synthetic phrase timing. `phrases` = array of strings
  // (placeholder text!). Each phrase starts `gap` seconds after the previous.
  MV.devLine = function (phrases, o = {}) {
    const start = o.start || 0;
    const gap = o.gap || 1.6;
    let text = '';
    const ph = [];
    phrases.forEach((p, i) => {
      if (i > 0) text += o.joiner == null ? ' ' : o.joiner;
      const charStart = Array.from(text).length;
      text += p;
      const charEnd = Array.from(text).length;
      ph.push({ text: p, start: start + i * gap, end: start + (i + 1) * gap, charStart, charEnd, latin: MV.text.isLatin(p) });
    });
    const chars = Array.from(text);
    const charTimes = new Float32Array(chars.length);
    let last = start;
    ph.forEach((p) => {
      const n = p.charEnd - p.charStart;
      const span = Math.max(0.06 * n, (p.end - p.start) * 0.55);
      for (let c = 0; c < n; c++) charTimes[p.charStart + c] = p.start + (span * c) / Math.max(1, n);
    });
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === ' ') charTimes[i] = last;
      else last = charTimes[i];
    }
    const segs = [];
    let cs = 0;
    text.split(' ').forEach((s) => {
      segs.push({ text: s, charStart: cs, charEnd: cs + Array.from(s).length });
      cs += Array.from(s).length + 1;
    });
    const end = start + ph.length * gap;
    return {
      id: o.id || 'L0', n: 1, index: 0, text, chars, start, end,
      showStart: start - 0.3, showEnd: end + 0.6,
      phrases: ph, segments: segs, charTimes,
      style: o.style || 'ransom', styleSource: 'tag', emphasis: o.emphasis || 0.5,
      isHook: !!o.isHook, seed: MV.hash32(text, o.seed || 7), sectionKind: o.kind || 'chorus',
    };
  };
})();

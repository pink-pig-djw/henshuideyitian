/*
 * MV.Director — turns (features, lyric track, preset) into a precomputed cue
 * timeline and evaluates it into a FrameState at any song time
 * (docs/ARCHITECTURE.md §2.4, §3.8).
 *
 *   const dir = new MV.Director({ features, track, preset, options: { hud: true, credits: true } });
 *   const st = dir.evaluate(t);            // pure: same t → same FrameState
 *   dir.cues → { scenes, accents, lyrics, camera, glitches }
 *   dir.setTrack(track); dir.setFeatures(features); dir.setOptions(o); dir.setPreset(p)
 *
 * FrameState = {
 *   t, env,
 *   scene: { from: { name, p, index }, to: { name, p, index } | null, transition: { name, p, seed } | null },
 *   lyrics: [{ line, lt, style }],          // ≤ 2 at once
 *   accents: [accent],                      // active only, oldest first
 *   camera: { x, y, zoom, rot },
 *   post: { rgbShift, glitch, glitchSeed, grain, vignette, flash, redFlash, invert, scanlines, time },
 *   hud: { title, artist, duration, visible, sectionName }
 * }
 *
 * Everything that depends on the song is computed once in rebuild() and stored
 * in time-sorted arrays; evaluate(t) only does binary searches (MV.lowerIndex)
 * and a handful of arithmetic, so it is a pure function of t (plus the
 * optional { dt, quality } it is given) and runs in well under 0.5 ms.
 * No Math.random / Date.now / performance.now anywhere in this file.
 *
 * Works without MV.Analysis (small internal fallbacks), without features
 * (preset grid + synthetic envelopes) and without a track (no lyrics).
 * The track's Line objects are never mutated: refined visibility windows are
 * passed to the styles through `lt`.
 */
(function () {
  'use strict';

  const MV = (window.MV = window.MV || {});

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */
  const W = MV.W || 1920;
  const H = MV.H || 1080;
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const mod = (x, m) => ((x % m) + m) % m;
  const pulse = (dt, len) => (dt < 0 ? 0 : Math.exp((-dt * 4.6) / Math.max(1e-4, len)));
  const smooth = (a, b, x) => {
    const u = clamp((x - a) / (b - a));
    return u * u * (3 - 2 * u);
  };
  const fin = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
  const hash = (...a) => MV.hash32(...a);
  const rnd = (seed, i = 0, j = 0) => MV.rand(seed, i, j);
  const lowerIndex = (arr, x, key) => MV.lowerIndex(arr, x, key);

  /** Scene rotation per section kind when a section has no `scenes`. */
  const DEFAULT_SCENES = {
    intro: ['sunburst', 'stripes', 'night-city'],
    verse: ['night-city', 'train', 'crowd'],
    pre: ['tunnel', 'stripes'],
    chorus: ['sunburst', 'sky-red', 'shards', 'crowd'],
    hook: ['sunburst', 'starfield', 'sky-red'],
    interlude: ['stripes', 'crowd', 'train', 'shards'],
    bridge: ['starfield', 'void'],
    build: ['starfield', 'tunnel'],
    climax: ['starfield', 'sunburst', 'sky-red', 'shards'],
    outro: ['starfield'],
  };
  const DEFAULT_SWITCH_BARS = { verse: 4, bridge: 4, outro: 8 };
  const DEFAULT_INTENSITY = {
    intro: 0.55, verse: 0.3, pre: 0.6, chorus: 0.85, hook: 0.75, interlude: 0.7,
    bridge: 0.2, build: 0.55, climax: 1.0, outro: 0.3,
  };
  /** Lyric style when a line has none (mirrors MV.Lyrics' auto heuristics). */
  const DEFAULT_STYLE = {
    intro: 'dialog', verse: 'dialog', pre: 'glitch', chorus: 'ransom', hook: 'impact',
    interlude: 'slash', bridge: 'vertical', build: 'slash', climax: 'split', outro: 'card',
  };

  // Transition pools. Durations mirror fx.js defaults (used when the
  // transition is not registered, e.g. in Node tests).
  const T_DUR = {
    'slash-wipe': 0.5, 'red-flash': 0.4, shatter: 0.8, 'ink-wipe': 0.9,
    'star-iris': 0.9, 'stripe-wipe': 0.6, 'glitch-cut': 0.3, 'zoom-punch': 0.45,
  };
  const STRONG = ['slash-wipe', 'shatter', 'ink-wipe', 'star-iris'];
  const LIGHT = ['glitch-cut', 'zoom-punch', 'stripe-wipe', 'red-flash'];
  const SOFT = ['ink-wipe', 'star-iris'];
  const T_LEAD = 0.25, T_TAIL = 0.15; // nominal split of a transition around its cut
  const QUIET = 0.35; //                intensity below which sections cut softly

  /** Default effect durations (fx.js). */
  const E_DUR = {
    flash: 0.3, speedlines: 0.6, ink: 1.6, stars: 1.2, shards: 1.0, ring: 0.7, frame: 1.0,
    confetti: 2.6, caption: 3.0, credits: 9.0, title: 8.6, endcard: 9.0,
  };
  const LONG_ACCENT = 3.5; // accents longer than this live in a small linear list

  // Scenes whose palette is mostly red / white (speedlines turn black there).
  const BRIGHT_SCENES = new Set(['sunburst', 'sky-red', 'stripes']);
  const STAR_SCENES = new Set(['starfield', 'void']);

  const LYRIC_IN = 0.3, LYRIC_OUT = 0.35, LYRIC_GAP = 0.05, LYRIC_LONG_GAP = 3.0, LYRIC_TAIL = 1.4;
  const MAX_LYRIC_OVERLAP = 0.35;

  const ZERO_BEAT = {
    index: 0, phase: 0, period: 0.6, bar: 0, barPhase: 0, beatInBar: 0,
    sinceBeat: 9, sinceDownbeat: 9, pulse: 0, barPulse: 0, beatTime: 0, nextBeat: 0.6, downbeatTime: 0,
  };

  /* ------------------------------------------------------------------ */
  /* Feature lookups: MV.Analysis when present, else small fallbacks.    */
  /* ------------------------------------------------------------------ */
  const FB = {
    sample(f, name, t) {
      const arr = f && f[name];
      if (!arr || !arr.length) return 0;
      const rate = name === 'novelty' ? 1 / (f.noveltyHop || 0.05) : f.fps || 100;
      const x = t * rate;
      if (!(x >= 0) || x > arr.length - 1) return 0;
      const i = Math.floor(x), u = x - i;
      return i + 1 < arr.length ? arr[i] + (arr[i + 1] - arr[i]) * u : arr[i];
    },
    avg(f, name, t0, t1) {
      // 5-tap box average (cheap, good enough for a fallback).
      let s = 0;
      for (let k = 0; k < 5; k++) s += FB.sample(f, name, t0 + ((t1 - t0) * k) / 4);
      return s / 5;
    },
    beatInfo(f, t) {
      const beats = (f && f.beats) || [];
      const bpb = (f && f.beatsPerBar) || 4;
      const def = 60 / ((f && f.bpm) || 120);
      const n = beats.length;
      let index, t0, period;
      if (n < 2) {
        const base = n ? beats[0] : 0;
        period = def;
        index = Math.floor((t - base) / period);
        t0 = base + index * period;
      } else {
        const i = lowerIndex(beats, t);
        if (i < 0) {
          period = beats[1] - beats[0];
          index = Math.floor((t - beats[0]) / period);
          t0 = beats[0] + index * period;
        } else if (i >= n - 1) {
          period = beats[n - 1] - beats[n - 2];
          const k = Math.floor((t - beats[n - 1]) / period);
          index = n - 1 + k;
          t0 = beats[n - 1] + k * period;
        } else {
          index = i;
          t0 = beats[i];
          period = beats[i + 1] - beats[i];
        }
      }
      if (!(period > 1e-3)) period = def;
      const dbp = fin(f && f.downbeatPhase, 0);
      const sinceBeat = Math.max(0, t - t0);
      const beatInBar = mod(index - dbp, bpb);
      const kd = index - beatInBar;
      const tDown = n >= 2 && kd >= 0 && kd < n ? beats[kd] : n >= 2 && kd >= n ? beats[n - 1] + (kd - n + 1) * (beats[n - 1] - beats[n - 2]) : t0 - beatInBar * period;
      const sinceDownbeat = Math.max(0, t - tDown);
      const phase = clamp(sinceBeat / period, 0, 0.999999);
      return {
        index, phase, period, bar: Math.floor((index - dbp) / bpb),
        barPhase: (beatInBar + phase) / bpb, beatInBar, sinceBeat, sinceDownbeat,
        pulse: pulse(sinceBeat, 0.35), barPulse: pulse(sinceDownbeat, 0.6),
        beatTime: t0, nextBeat: t0 + period, downbeatTime: tDown,
      };
    },
    sectionAt(f, t) {
      const S = f && f.sections;
      if (!S || !S.length) return null;
      let i = lowerIndex(S, t, (s) => s.start);
      if (i < 0) i = 0;
      return { section: S[i], index: i };
    },
  };
  const A = () => (MV.Analysis && typeof MV.Analysis.beatInfo === 'function' ? MV.Analysis : FB);

  function findPreset(p, features) {
    if (p && typeof p === 'object') return p;
    const id = typeof p === 'string' ? p : features && features.presetId;
    if (!id) return null;
    const all = (MV.presets || []).concat(MV._pendingPresets || []);
    return all.find((q) => q && q.id === id) || null;
  }

  // Weighted deterministic pick. items = [[name, weight], ...], u ∈ [0,1).
  function pickWeighted(items, u) {
    let sum = 0;
    for (const it of items) sum += Math.max(0, it[1]);
    if (sum <= 0) return items.length ? items[0][0] : null;
    let a = u * sum;
    for (const it of items) {
      a -= Math.max(0, it[1]);
      if (a < 0) return it[0];
    }
    return items[items.length - 1][0];
  }

  /* ================================================================== */
  /* Director                                                           */
  /* ================================================================== */
  /**
   * @param {object} cfg
   * @param {object} [cfg.features] Features (§2.2); may be null (preset grid + synthetic envelopes)
   * @param {object} [cfg.track]    LyricTrack (§2.3); may be null
   * @param {object|string} [cfg.preset] preset object or id (meta for HUD / credits)
   * @param {object} [cfg.options]  { hud, credits, title, endCard, accents, lyrics, seed, fps, quality, duration }
   */
  function Director(cfg) {
    cfg = cfg || {};
    this.features = cfg.features || null;
    this.track = cfg.track || null;
    this.preset = findPreset(cfg.preset, this.features);
    this.options = Object.assign(
      { hud: true, credits: true, title: true, endCard: true, accents: true, lyrics: true, seed: 1, fps: 60, quality: 1 },
      cfg.options || {}
    );
    this.version = 0;
    this.rebuild();
  }

  Director.prototype.setTrack = function (track) {
    this.track = track || null;
    return this.rebuild();
  };
  Director.prototype.setFeatures = function (features) {
    this.features = features || null;
    if (!this.preset) this.preset = findPreset(null, this.features);
    return this.rebuild();
  };
  Director.prototype.setPreset = function (preset) {
    this.preset = findPreset(preset, this.features);
    return this.rebuild();
  };
  Director.prototype.setOptions = function (o) {
    Object.assign(this.options, o || {});
    return this.rebuild();
  };

  /* ------------------------------------------------------------------ */
  /* Build                                                               */
  /* ------------------------------------------------------------------ */
  /** Recompute every cue from the current features / track / options. */
  Director.prototype.rebuild = function () {
    const o = this.options;
    this.seed = hash('mv-director', fin(o.seed, 1));
    this._buildTimeline();
    this._buildLyrics();
    this._buildScenes();
    this._buildAccents();
    this._buildMeta();
    this.version++;
    return this;
  };

  // Grid, sections, envelopes → this.F (a features-like object for lookups).
  Director.prototype._buildTimeline = function () {
    const f = this.features;
    const p = this.preset;
    const o = this.options;
    let duration = fin(o.duration, 0) || fin(f && f.duration, 0) || fin(p && p.match && p.match.duration, 0);
    const srcSecs = (f && f.sections && f.sections.length && f.sections) || (p && p.sections) || null;
    if (!duration && srcSecs && srcSecs.length) duration = srcSecs[srcSecs.length - 1].end;
    if (!duration && this.track && this.track.lines && this.track.lines.length) {
      duration = Math.max(...this.track.lines.map((l) => fin(l.end, 0))) + 8;
    }
    if (!(duration > 0)) duration = 180;
    this.duration = duration;

    // Beat grid.
    let bpm = fin(f && f.bpm, 0) || fin(p && p.bpm, 0) || 120;
    const bpb = (f && f.beatsPerBar) || (p && p.beatsPerBar) || 4;
    let beats = (f && f.beats && f.beats.length >= 2 && f.beats) || null;
    let downbeatPhase = f && typeof f.downbeatPhase === 'number' ? f.downbeatPhase : null;
    let downbeats = (f && f.downbeats && f.downbeats.length && f.downbeats) || null;
    if (!beats && p && p.beats && p.beats.length >= 2) {
      beats = p.beats.filter((b) => b >= 0 && b <= duration);
      downbeatPhase = mod(fin(p.downbeatPhase, 0), bpb);
      downbeats = null;
    }
    if (!beats) {
      const per = 60 / bpm;
      beats = [];
      for (let t = 0; t <= duration + 1e-6; t += per) beats.push(+t.toFixed(4));
      downbeatPhase = 0;
      downbeats = null;
    }
    if (downbeatPhase == null) {
      downbeatPhase = 0;
      if (downbeats && downbeats.length) {
        let i = lowerIndex(beats, downbeats[0] + 0.02);
        if (i < 0) i = 0;
        downbeatPhase = mod(i, bpb);
      }
    }
    if (!downbeats) {
      downbeats = [];
      for (let k = 0; k < beats.length; k++) if (mod(k - downbeatPhase, bpb) === 0) downbeats.push(beats[k]);
    }
    this.bpm = bpm;
    this.beats = Float64Array.from(beats);
    this.downbeats = Float64Array.from(downbeats);
    this.barLen = (60 / bpm) * bpb;

    // Sections (normalised copies, contiguous, covering [0, duration]).
    let secs = (srcSecs || [{ kind: 'verse', name: 'VERSE', start: 0, end: duration }]).map((s, i) => {
      const kind = s.kind || 'verse';
      return {
        index: i, kind, name: s.name || String(kind).toUpperCase(),
        start: fin(s.start, 0), end: fin(s.end, duration),
        intensity: clamp(fin(s.intensity, DEFAULT_INTENSITY[kind] != null ? DEFAULT_INTENSITY[kind] : 0.5)),
        scenes: Array.isArray(s.scenes) && s.scenes.length ? s.scenes.slice() : (DEFAULT_SCENES[kind] || DEFAULT_SCENES.verse).slice(),
        switchBars: Math.max(1, fin(s.switchBars, DEFAULT_SWITCH_BARS[kind] || 2)),
        switchOn: s.switchOn || null,
        credits: !!s.credits, endCard: !!s.endCard,
      };
    });
    secs.sort((a, b) => a.start - b.start);
    secs = secs.filter((s) => s.end > s.start + 0.01 && s.start < duration);
    if (!secs.length) secs = [{ index: 0, kind: 'verse', name: 'VERSE', start: 0, end: duration, intensity: 0.5, scenes: DEFAULT_SCENES.verse.slice(), switchBars: 2, switchOn: null, credits: false, endCard: false }];
    secs.forEach((s, i) => {
      s.index = i;
      if (i > 0) secs[i - 1].end = s.start;
      s.seed = hash(this.seed, 'section', i, s.kind);
    });
    secs[0].start = 0;
    secs[secs.length - 1].end = Math.max(secs[secs.length - 1].end, duration);
    this.sections = secs;
    this._secStarts = Float64Array.from(secs.map((s) => s.start));

    // Features-like object handed to MV.Analysis lookups.
    const hasEnv = !!(f && f.rms && f.rms.length);
    this.F = {
      duration, fps: (f && f.fps) || 100, bpm, beatsPerBar: bpb,
      beats: this.beats, downbeats: this.downbeats, downbeatPhase, sections: secs,
      rms: hasEnv ? f.rms : null, low: hasEnv ? f.low : null, mid: hasEnv ? f.mid : null,
      high: hasEnv ? f.high : null, flux: hasEnv ? f.flux : null,
    };
    this.hasEnvelopes = hasEnv;

    // Onsets (strong enough to matter), as parallel typed arrays.
    const on = ((f && f.onsets) || []).filter((x) => x && x.s >= 0.25 && x.t >= 0).sort((a, b) => a.t - b.t);
    this._onT = Float64Array.from(on.map((x) => x.t));
    this._onS = Float64Array.from(on.map((x) => clamp(x.s)));
    this.onsets = on;
  };

  /** Section index at t (clamped). */
  Director.prototype.sectionIndexAt = function (t) {
    const i = lowerIndex(this._secStarts, t);
    return i < 0 ? 0 : i;
  };
  /** Section object at t. */
  Director.prototype.sectionAt = function (t) {
    return this.sections[this.sectionIndexAt(t)];
  };
  /** Intensity at t, cross-faded ±0.5 s around section boundaries. */
  Director.prototype.intensityAt = function (t) {
    const S = this.sections;
    const i = this.sectionIndexAt(t);
    const s = S[i];
    let v = s.intensity;
    if (i > 0 && t < s.start + 0.5) v = lerp(S[i - 1].intensity, s.intensity, smooth(s.start - 0.5, s.start + 0.5, t));
    else if (i < S.length - 1 && t > s.end - 0.5) v = lerp(s.intensity, S[i + 1].intensity, smooth(s.end - 0.5, s.end + 0.5, t));
    return v;
  };
  // Index of the nearest beat to t, and its time.
  Director.prototype._nearestBeat = function (t) {
    const B = this.beats;
    let i = lowerIndex(B, t);
    if (i < 0) i = 0;
    if (i + 1 < B.length && Math.abs(B[i + 1] - t) < Math.abs(B[i] - t)) i++;
    return B.length ? B[i] : t;
  };

  /* ---------------- Lyrics ---------------- */
  Director.prototype._buildLyrics = function () {
    const tr = this.track;
    const lead = fin(tr && tr.leadIn, fin(this.preset && this.preset.leadIn, 0.3));
    const lines = ((tr && tr.lines) || [])
      .filter((l) => l && !l.skip && isFinite(l.start) && l.chars && l.chars.length && l.phrases && l.phrases.length)
      .slice()
      .sort((a, b) => a.start - b.start || (a.index || 0) - (b.index || 0));
    const cues = lines.map((line, i) => {
      const showStart = fin(line.showStart, line.start - lead);
      const end = fin(line.end, line.start + 2);
      const sec = this.sectionAt(line.start);
      return {
        index: i, id: line.id, line, start: line.start, end,
        showStart: Math.min(showStart, line.start), showEnd: end + LYRIC_TAIL,
        style: line.style || DEFAULT_STYLE[line.sectionKind || sec.kind] || 'ransom',
        section: sec.index,
      };
    });
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i], nx = cues[i + 1];
      let se;
      if (!nx) se = c.end + LYRIC_TAIL;
      else if (nx.showStart - c.end > LYRIC_LONG_GAP) se = c.end + LYRIC_TAIL;
      else se = nx.showStart - LYRIC_GAP;
      se = Math.max(se, c.start + 0.3, c.showStart + 0.5);
      if (nx) se = Math.min(se, nx.showStart + MAX_LYRIC_OVERLAP);
      c.showEnd = Math.min(se, this.duration + 0.5);
    }
    this.lyricCues = cues;
    this._lyrStarts = Float64Array.from(cues.map((c) => c.showStart));
  };

  // Phrase starts (absolute) inside [a, b), sorted, with the phrase / line.
  Director.prototype._phrasesIn = function (a, b) {
    const out = [];
    for (const c of this.lyricCues) {
      if (c.end < a - 1 || c.start > b) continue;
      c.line.phrases.forEach((p, k) => {
        if (p.start >= a && p.start < b) out.push({ t: p.start, phrase: p, k, cue: c, latin: p.latin != null ? !!p.latin : MV.text && MV.text.isLatin(p.text) });
      });
    }
    return out.sort((x, y) => x.t - y.t);
  };

  /* ---------------- Scenes & transitions ---------------- */
  Director.prototype._buildScenes = function () {
    const S = this.sections;
    const cues = [];
    const minCue = 1.5;
    for (const sec of S) {
      // Cut points (absolute), first = section start.
      const cuts = [sec.start];
      const list = sec.scenes;
      if (list.length > 1) {
        let cand = [];
        if (sec.switchOn === 'phrase' && this.lyricCues.length) {
          cand = this._phrasesIn(sec.start, sec.end).map((x) => {
            const b = this._nearestBeat(x.t);
            return Math.abs(b - x.t) < 0.08 ? b : x.t;
          });
        }
        if (!cand.length) {
          const D = this.downbeats;
          let i0 = lowerIndex(D, sec.start - 0.05);
          if (i0 < 0 || D[i0] < sec.start - 0.05) i0++;
          for (let k = i0 + sec.switchBars; k < D.length && D[k] < sec.end; k += sec.switchBars) cand.push(D[k]);
        }
        for (const c of cand) {
          if (c - cuts[cuts.length - 1] >= minCue && sec.end - c >= minCue * 0.8) cuts.push(c);
        }
      }
      const prevName = cues.length ? cues[cues.length - 1].name : null;
      const rot = list.length > 1 && list[0] === prevName ? 1 : 0;
      cuts.forEach((cut, k) => {
        const name = list[(k + rot) % list.length];
        const idx = cues.length;
        const seed = hash(this.seed, 'scene', idx, name);
        // Quiet sections keep the mood-matching variants (0 / 4: the scenes
        // pick their night palette at low intensity); elsewhere any of 0..5.
        const quietVar = sec.intensity < 0.45;
        let variant = quietVar ? (rnd(seed, 3) < 0.5 ? 0 : 4) : Math.floor(rnd(seed, 3) * 6);
        const prev = cues[idx - 1];
        if (prev && prev.name === name && prev.variant === variant) variant = quietVar ? 4 - variant : (variant + 1) % 6;
        cues.push({
          index: idx, name, section: sec.index, k, cut, start: cut, end: 0, seed, variant,
          speed: +(0.85 + 0.3 * sec.intensity).toFixed(3), intensity: sec.intensity, transition: null,
        });
      });
    }
    // Transitions into every cue but the first.
    let prevT = null;
    for (let i = 1; i < cues.length; i++) {
      const c = cues[i], pc = cues[i - 1];
      const sec = S[c.section];
      const secStart = c.k === 0;
      const I = sec.intensity;
      const quietBoth = I < QUIET;
      const seed = hash(this.seed, 'transition', sec.index, i);
      const u = rnd(seed, 1);
      let items;
      if (secStart) {
        if (quietBoth) items = SOFT.map((n) => [n, n === 'star-iris' && STAR_SCENES.has(c.name) ? 3 : 1]);
        else {
          const loud = I >= 0.6;
          items = STRONG.map((n) => [n, SOFT.indexOf(n) >= 0 ? (loud ? 0.6 : 1) * (n === 'star-iris' && STAR_SCENES.has(c.name) ? 2.5 : 1) : loud ? 3 : 1.5]);
        }
      } else if (quietBoth) {
        items = u < 0.2 ? null : SOFT.map((n) => [n, n === 'star-iris' && STAR_SCENES.has(c.name) ? 2 : 1]);
      } else {
        items = LIGHT.map((n) => [n, n === 'glitch-cut' && (sec.kind === 'pre' || sec.kind === 'build') ? 2.5 : n === 'red-flash' && I < 0.6 ? 0.5 : 1]);
      }
      if (!items) {
        prevT = null;
        continue;
      }
      if (prevT && items.length > 1) items = items.map((it) => [it[0], it[0] === prevT ? 0 : it[1]]);
      const name = pickWeighted(items, rnd(seed, 2));
      const reg = MV.transitions && MV.transitions.get && MV.transitions.get(name);
      const dur = clamp(fin(reg && reg.duration, T_DUR[name] || 0.4), 0.15, 1.6);
      let lead = (dur * T_LEAD) / (T_LEAD + T_TAIL);
      // Never start before the outgoing cue is fully in (or its own transition ended).
      const floor = Math.max(pc.cut + 0.1, pc.transition ? pc.transition.end + 0.02 : -Infinity);
      if (c.cut - lead < floor) lead = Math.max(0, c.cut - floor);
      const start = c.cut - lead;
      const end = Math.min(start + dur, cues[i + 1] ? cues[i + 1].cut - 0.3 : this.duration);
      if (end - start < 0.12) {
        prevT = null;
        continue;
      }
      c.transition = { name, start, end, seed, strong: secStart };
      c.start = start;
      prevT = name;
    }
    for (let i = 0; i < cues.length; i++) {
      const nx = cues[i + 1];
      cues[i].end = nx ? (nx.transition ? nx.transition.end : nx.cut) : this.duration;
    }
    cues[0].start = 0;
    this.sceneCues = cues;
    this._cutTimes = Float64Array.from(cues.map((c) => c.cut));
  };

  /** Scene cue active (as the main scene) at t. */
  Director.prototype.sceneCueAt = function (t) {
    const i = lowerIndex(this._cutTimes, t);
    return this.sceneCues[i < 0 ? 0 : i];
  };

  /* ---------------- Accents ---------------- */
  Director.prototype._buildAccents = function () {
    const o = this.options;
    const S = this.sections;
    const acc = [];
    const cam = [];
    const glitches = [];
    const meta = this._metaData();
    const add = (kind, t, fields) => {
      if (!(t >= -0.01) || t > this.duration) return null;
      const a = Object.assign({ kind, t, dur: E_DUR[kind] || 1, strength: 1, seed: hash(this.seed, 'accent', kind, t) }, fields || {});
      a.strength = +clamp(a.strength, 0, 2).toFixed(3);
      acc.push(a);
      return a;
    };
    const shake = (t, amp, dur) => cam.push({ kind: 'shake', t, amp, dur: dur || 0.3, seed: hash(this.seed, 'shake', t) });
    const sceneAt = (t) => this.sceneCueAt(t);

    if (o.accents !== false) {
      // Section starts: shards (loud) or ink (quiet), plus a camera kick.
      for (const sec of S) {
        if (sec.index === 0) continue;
        const I = sec.intensity;
        if (sec.endCard && o.endCard !== false) continue;
        if (I >= 0.6) {
          add('shards', sec.start, { strength: 0.6 + 0.5 * I, data: { dir: rnd(sec.seed, 1) < 0.5 ? -1 : 1 } });
          shake(sec.start, 16 * I, 0.45);
        } else {
          add('ink', sec.start + 0.05, {
            strength: 0.55 + 0.5 * I,
            data: { color: I < QUIET ? 'red' : 'black', size: I < QUIET ? 0.8 : 1 },
          });
        }
      }

      // Chorus / climax downbeats: light flash between cuts, a frame every 4 bars.
      const cutSet = this._cutTimes;
      const isCut = (t) => {
        const i = lowerIndex(cutSet, t + 0.02);
        return i >= 0 && Math.abs(cutSet[i] - t) < 0.03;
      };
      for (const sec of S) {
        if (sec.kind !== 'chorus' && sec.kind !== 'climax') continue;
        const I = sec.intensity;
        const D = this.downbeats;
        let i0 = lowerIndex(D, sec.start - 0.05);
        if (i0 < 0 || D[i0] < sec.start - 0.05) i0++;
        for (let k = i0, m = 0; k < D.length && D[k] < sec.end - 0.3; k++, m++) {
          const d = D[k];
          if (m === 0) continue;
          if (m % 4 === 2) add('frame', d, { strength: 0.7 + 0.4 * I, dur: Math.min(1.0, this.barLen * 0.5) });
          else if (m % 2 === 1 && !isCut(d)) {
            add('flash', d, { strength: 0.18 + 0.15 * I, dur: 0.22, data: { color: m % 4 === 1 ? 'white' : 'red' } });
          }
        }
      }

      // Lyric phrase starts: speedlines + shake when loud; stars + ring on Latin.
      const latinTimes = [];
      for (const c of this.lyricCues) {
        c.line.phrases.forEach((p, k) => {
          const t = p.start;
          if (!(t >= 0) || t > this.duration) return;
          const I = this.intensityAt(t);
          const latin = p.latin != null ? !!p.latin : MV.text && MV.text.isLatin(p.text);
          const sd = hash(this.seed, 'phrase', c.index, k);
          if (latin) {
            latinTimes.push(t);
            // burst from an upper corner so the pop never sits on the text
            const side = rnd(sd, 1) < 0.5 ? 0.2 : 0.8;
            add('stars', t, { strength: 0.55 + 0.35 * I, x: W * (side + 0.05 * MV.srand(sd, 2)), y: H * (0.26 + 0.06 * MV.srand(sd, 5)) });
            const bright = BRIGHT_SCENES.has(sceneAt(t).name);
            add('ring', t, { strength: 0.6 + 0.5 * I, x: W / 2, y: H * 0.5, data: { color: bright ? 'white' : 'red' } });
            shake(t, 7 * I, 0.3);
          } else if (I >= 0.7) {
            const bright = BRIGHT_SCENES.has(sceneAt(t).name);
            add('speedlines', t, {
              strength: 0.55 + 0.45 * I,
              x: W / 2 + 160 * MV.srand(sd, 3), y: H * 0.48 + 70 * MV.srand(sd, 4),
              data: { color: bright ? 'black' : 'white' },
            });
            shake(t, 8 * I, 0.28);
          }
        });
      }

      // Glitch spikes on strong onsets in pre / build / climax.
      let lastG = -9;
      for (let i = 0; i < this.onsets.length; i++) {
        const on = this.onsets[i];
        if (on.s <= 0.8) continue;
        const sec = this.sectionAt(on.t);
        if (sec.kind !== 'pre' && sec.kind !== 'build' && sec.kind !== 'climax') continue;
        if (on.t - lastG < 0.35) continue;
        lastG = on.t;
        const I = this.intensityAt(on.t);
        glitches.push({ t: on.t, dur: 0.16, amount: clamp((0.3 + 1.5 * (on.s - 0.8)) * (0.5 + 0.5 * I), 0, 0.75), seed: hash(this.seed, 'glitch', i) });
      }

      // Climax confetti: rain one bar in, then bursts every 4 bars.
      for (const sec of S) {
        if (sec.kind !== 'climax') continue;
        const D = this.downbeats;
        let i0 = lowerIndex(D, sec.start - 0.05);
        if (i0 < 0 || D[i0] < sec.start - 0.05) i0++;
        for (let k = i0 + 1, m = 1; k < D.length && D[k] < sec.end - 1.5; k += 4, m += 4) {
          const sd = hash(sec.seed, 'confetti', m);
          const burst = m > 1;
          add('confetti', D[k], Object.assign({ strength: 0.6 + 0.5 * sec.intensity, dur: 2.6 }, burst ? { x: W * (0.25 + 0.5 * rnd(sd, 1)), y: H * (0.35 + 0.3 * rnd(sd, 2)) } : {}));
        }
      }

      // Lyric-free downbeats of the climax (ad-lib runs): alternate
      // speedlines / halftone ring so the peak never goes flat.
      const visibleAt = (t) => this.lyricCues.some((c) => t >= c.showStart - 0.2 && t <= c.showEnd + 0.2);
      for (const sec of S) {
        if (sec.kind !== 'climax') continue;
        const D = this.downbeats;
        let i0 = lowerIndex(D, sec.start + 0.05);
        let m = 0;
        for (let k = i0 + 1; k < D.length && D[k] < sec.end - 0.5; k++) {
          const d = D[k];
          if (visibleAt(d)) continue;
          const sd = hash(sec.seed, 'adlib', k);
          const bright = BRIGHT_SCENES.has(sceneAt(d).name);
          if (m++ % 2 === 0) {
            add('speedlines', d, { strength: 0.55 + 0.35 * sec.intensity, x: W / 2 + 200 * MV.srand(sd, 1), y: H * 0.5 + 90 * MV.srand(sd, 2), data: { color: bright ? 'black' : 'white' } });
            shake(d, 7 * sec.intensity, 0.25);
          } else {
            add('ring', d, { strength: 0.6 + 0.4 * sec.intensity, x: W * (0.3 + 0.4 * rnd(sd, 3)), y: H * (0.35 + 0.3 * rnd(sd, 4)), data: { color: bright ? 'white' : 'red' } });
          }
        }
      }

      // Star showers during held notes of hook / climax, the climax tail and
      // star-themed scene cues of loud sections.
      const windows = [];
      for (const c of this.lyricCues) {
        const sec = S[c.section];
        const endSec = this.sectionAt(Math.max(c.start, c.end - 0.1));
        if (!/hook|climax/.test(sec.kind) && !/climax/.test(endSec.kind)) continue;
        const ph = c.line.phrases;
        const last = ph[ph.length - 1];
        const a = last.start + 0.6, b = c.end;
        if (b - a >= 2.0) windows.push([a, b]);
      }
      for (const sec of S) {
        if (sec.kind === 'climax') windows.push([sec.start + (sec.end - sec.start) * 0.72, sec.end - 0.2]);
      }
      for (const c of this.sceneCues) {
        if (STAR_SCENES.has(c.name) && S[c.section].intensity >= 0.8 && S[c.section].kind !== 'outro') windows.push([c.cut + 0.3, c.end - 0.3]);
      }
      const showered = new Set();
      windows.forEach(([a, b], w) => {
        const B = this.beats;
        let i = lowerIndex(B, a);
        if (i < 0) i = 0;
        let n = 0;
        for (; i < B.length && B[i] <= b; i++) {
          const t = B[i];
          if (t < a || showered.has(i)) continue;
          showered.add(i);
          if (latinTimes.some((x) => Math.abs(x - t) < 0.4)) continue;
          const sd = hash(this.seed, 'shower', w, n++);
          const I = this.intensityAt(t);
          add('stars', t, {
            strength: 0.4 + 0.35 * I,
            x: W * (0.14 + 0.72 * rnd(sd, 1)), y: H * (0.16 + 0.5 * rnd(sd, 2)),
            data: { shower: true },
          });
        }
      });
    }

    // Title card: from the first beat until ~0.5 s before the first lyric.
    this.titleWindow = null;
    if (o.title !== false && (meta.title || meta.titleLatin)) {
      const s0 = S[0];
      const t0 = this.beats.length && this.beats[0] < 4 ? Math.max(0.05, this.beats[0]) : 0.3;
      let t1 = s0.kind === 'intro' ? s0.end - 0.3 : t0 + 8.6;
      const first = this.lyricCues[0];
      if (first) t1 = Math.min(t1, first.start - 0.5, first.showStart - 0.1);
      t1 = Math.min(t1, t0 + 14);
      if (t1 - t0 >= 2.5) {
        add('title', t0, { dur: t1 - t0, strength: 1, data: meta });
        this.titleWindow = [t0, t1];
      }
    }
    // Credits: most of the interlude.
    this.creditsWindow = null;
    if (o.credits !== false) {
      const sec = S.find((s) => s.credits);
      if (sec) {
        const D = this.downbeats;
        let i0 = lowerIndex(D, sec.start + 1.0);
        const cs = i0 >= 0 && i0 + 1 < D.length && D[i0 + 1] < sec.start + 3.5 ? D[i0 + 1] : sec.start + 1.2;
        const ce = sec.end - 1.4;
        if (ce - cs >= 4) {
          add('credits', cs, { dur: ce - cs, strength: 1, data: meta });
          this.creditsWindow = [cs, ce];
        }
      }
    }
    // End card: the outro (ends on black at the song end).
    this.endWindow = null;
    if (o.endCard !== false) {
      const sec = S.find((s) => s.endCard);
      if (sec) {
        const es = sec.start + 0.4;
        const ee = Math.max(es + 3, this.duration);
        add('endcard', es, { dur: ee - es, strength: 1, data: meta });
        this.endWindow = [es, ee];
      }
    }

    acc.sort((a, b) => a.t - b.t || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
    this.accents = acc;
    this._accShort = acc.filter((a) => a.dur <= LONG_ACCENT);
    this._accShortT = Float64Array.from(this._accShort.map((a) => a.t));
    this._accLong = acc.filter((a) => a.dur > LONG_ACCENT);
    cam.sort((a, b) => a.t - b.t);
    this.cameraEvents = cam;
    this._camT = Float64Array.from(cam.map((c) => c.t));
    glitches.sort((a, b) => a.t - b.t);
    this.glitches = glitches;
    this._glT = Float64Array.from(glitches.map((g) => g.t));
    this._flashes = acc.filter((a) => a.kind === 'flash');
    this._flashT = Float64Array.from(this._flashes.map((a) => a.t));
  };

  Director.prototype._metaData = function () {
    const pm = (this.preset && this.preset.meta) || {};
    const tm = (this.track && this.track.meta) || {};
    const pick = (k) => (pm[k] != null && pm[k] !== '' ? String(pm[k]) : tm[k] != null ? String(tm[k]) : '');
    return {
      title: pick('title'), titleLatin: pick('titleLatin'), artist: pick('artist'),
      lyricist: pick('lyricist'), composer: pick('composer'), presetId: (this.preset && this.preset.id) || null,
    };
  };

  Director.prototype._buildMeta = function () {
    const m = this._metaData();
    this.meta = m;
    this.hudInfo = { title: m.title || m.titleLatin || '', artist: m.artist || '', duration: this.duration };
  };

  /** Every string that may be drawn (lyrics + meta), for MV.fonts.ensure. */
  Director.prototype.fontText = function () {
    const m = this.meta || {};
    let s = [m.title, m.titleLatin, m.artist, m.lyricist, m.composer].filter(Boolean).join('');
    for (const c of this.lyricCues || []) s += c.line.text;
    return s;
  };

  /** Precomputed cue arrays (read-only). */
  Object.defineProperty(Director.prototype, 'cues', {
    get() {
      return {
        scenes: this.sceneCues,
        accents: this.accents,
        lyrics: this.lyricCues,
        camera: this.cameraEvents,
        glitches: this.glitches,
      };
    },
  });

  /* ------------------------------------------------------------------ */
  /* Evaluate                                                            */
  /* ------------------------------------------------------------------ */
  /** Frame environment at t (§2.4). */
  Director.prototype.env = function (t, opts) {
    const F = this.F;
    const an = A();
    const beat = an.beatInfo(F, t) || ZERO_BEAT;
    const si = this.sectionIndexAt(t);
    const sec = this.sections[si];
    const intensity = this.intensityAt(t);
    let energy, low, mid, high, flux;
    if (this.hasEnvelopes) {
      const a0 = t - 0.06, a1 = t + 0.02;
      energy = an.avg(F, 'rms', a0, a1);
      low = an.avg(F, 'low', a0, a1);
      mid = an.avg(F, 'mid', a0, a1);
      high = an.avg(F, 'high', a0, a1);
      flux = an.avg(F, 'flux', a0, a1);
    } else {
      // Synthetic envelopes from intensity and the beat clock.
      const wob = 0.5 + 0.5 * Math.sin(t * 0.7);
      energy = clamp(intensity * (0.7 + 0.3 * wob) * (0.85 + 0.15 * beat.pulse));
      low = clamp(energy * (0.6 + 0.4 * pulse(beat.sinceBeat, 0.2)));
      mid = clamp(energy * 0.8);
      high = clamp(energy * (0.5 + 0.5 * pulse(beat.sinceBeat, 0.1)));
      flux = clamp(pulse(beat.sinceBeat, 0.15) * intensity);
    }
    // Onset pulse: strongest recent onset, decaying.
    let onsetPulse = 0;
    const OT = this._onT;
    if (OT.length) {
      for (let i = lowerIndex(OT, t); i >= 0 && t - OT[i] < 0.6; i--) {
        const v = this._onS[i] * pulse(t - OT[i], 0.3);
        if (v > onsetPulse) onsetPulse = v;
      }
    } else onsetPulse = clamp(pulse(beat.sinceBeat, 0.25) * intensity);
    const dur = sec.end - sec.start;
    return {
      t,
      dt: fin(opts && opts.dt, 1 / (this.options.fps || 60)),
      duration: this.duration,
      energy: clamp(energy), low: clamp(low), mid: clamp(mid), high: clamp(high), flux: clamp(flux),
      onsetPulse: clamp(onsetPulse),
      beat,
      section: {
        kind: sec.kind, name: sec.name, start: sec.start, end: sec.end, index: si,
        progress: dur > 0 ? clamp((t - sec.start) / dur) : 0, intensity: sec.intensity,
      },
      intensity,
      quality: clamp(fin(opts && opts.quality, fin(this.options.quality, 1)), 0.5, 1),
      seed: sec.seed,
    };
  };

  function sceneP(c, t) {
    return { seed: c.seed, lt: t - c.start, dur: c.end - c.start, variant: c.variant, speed: c.speed, intensity: c.intensity };
  }

  /**
   * Evaluate the timeline at song time t. Pure: depends only on t, the
   * precomputed cues and `opts` ({ dt, quality }).
   * @param {number} t seconds
   * @param {object} [opts] { dt, quality }
   * @returns {object} FrameState
   */
  Director.prototype.evaluate = function (t, opts) {
    t = fin(+t, 0);
    const env = this.env(t, opts);

    // ---- scene / transition
    const cues = this.sceneCues;
    let i = lowerIndex(this._cutTimes, t);
    if (i < 0) i = 0;
    let fromC = cues[i], toC = null, tr = null;
    const nx = cues[i + 1];
    if (nx && nx.transition && t >= nx.transition.start) {
      toC = nx;
    } else if (fromC.transition && t < fromC.transition.end && i > 0) {
      toC = fromC;
      fromC = cues[i - 1];
    }
    if (toC) {
      const T = toC.transition;
      const span = Math.max(1e-3, T.end - T.start);
      tr = { name: T.name, p: clamp((t - T.start) / span), seed: T.seed, cut: toC.cut, cutP: clamp((toC.cut - T.start) / span), strong: T.strong };
    }
    const scene = {
      from: { name: fromC.name, p: sceneP(fromC, t), index: fromC.index },
      to: toC ? { name: toC.name, p: sceneP(toC, t), index: toC.index } : null,
      transition: tr,
    };

    // ---- lyrics (≤ 2)
    const lyrics = [];
    if (this.options.lyrics !== false && this.lyricCues.length) {
      const L = this.lyricCues;
      const j0 = lowerIndex(this._lyrStarts, t);
      for (let j = j0; j >= 0 && lyrics.length < 2 && j >= j0 - 4; j--) {
        const c = L[j];
        if (t < c.showStart || t >= c.showEnd) continue;
        lyrics.unshift({
          line: c.line,
          lt: {
            t: t - c.start,
            in: clamp((t - c.showStart) / LYRIC_IN),
            out: clamp((t - (c.showEnd - LYRIC_OUT)) / LYRIC_OUT),
            showStart: c.showStart,
            showEnd: c.showEnd,
          },
          style: c.style,
          index: c.index,
        });
      }
    }

    // ---- accents (active only)
    const accents = [];
    for (const a of this._accLong) if (t >= a.t && t <= a.t + a.dur) accents.push(a);
    const AS = this._accShort;
    let k = lowerIndex(this._accShortT, t);
    const shortFrom = [];
    for (; k >= 0 && t - AS[k].t <= LONG_ACCENT; k--) if (t <= AS[k].t + AS[k].dur) shortFrom.push(AS[k]);
    for (let q = shortFrom.length - 1; q >= 0; q--) accents.push(shortFrom[q]);
    if (this._accLong.length && shortFrom.length) accents.sort((a, b) => a.t - b.t);

    // ---- camera
    const I = env.intensity;
    const s0 = this.seed;
    const drift = 0.6 + 0.4 * (1 - I);
    let cx = 16 * drift * MV.noise1(t * 0.11, s0 + 1);
    let cy = 10 * drift * MV.noise1(t * 0.09, s0 + 2);
    let rot = 0.0045 * MV.noise1(t * 0.07, s0 + 3);
    let zoom = 1 + 0.012 * env.beat.pulse * I;
    if (I >= 0.6) {
      // beat punch, heavier on the downbeat
      const db = env.beat.beatInBar === 0 ? 1.6 : 1;
      zoom += 0.014 * db * I * pulse(env.beat.sinceBeat, 0.22);
    } else {
      // slow push-in through quiet sections
      zoom += 0.025 * (1 - I / 0.6) * smooth(0, 1, env.section.progress);
    }
    const CT = this._camT;
    for (let c = lowerIndex(CT, t); c >= 0 && t - CT[c] < 1.0; c--) {
      const ev = this.cameraEvents[c];
      const lt = t - ev.t;
      if (lt > ev.dur) continue;
      const k2 = ev.amp * Math.pow(1 - lt / ev.dur, 2);
      cx += k2 * MV.noise1(t * 38, ev.seed);
      cy += k2 * 0.75 * MV.noise1(t * 38 + 17.3, ev.seed + 1);
      rot += k2 * 0.0007 * MV.noise1(t * 30, ev.seed + 2);
      zoom += k2 * 0.0012;
    }
    const camera = { x: cx, y: cy, zoom, rot };

    // ---- post
    let glitch = 0, glitchSeed = 0;
    const GT = this._glT;
    for (let g = lowerIndex(GT, t); g >= 0 && t - GT[g] < 0.5; g--) {
      const ev = this.glitches[g];
      const lt = t - ev.t;
      if (lt > ev.dur) continue;
      const v = ev.amount * (1 - lt / ev.dur);
      if (v > glitch) {
        glitch = v;
        glitchSeed = hash(ev.seed, Math.floor(lt * 24));
      }
    }
    let flash = 0, redFlash = 0;
    const FT = this._flashT;
    for (let f = lowerIndex(FT, t); f >= 0 && t - FT[f] < 0.6; f--) {
      const a = this._flashes[f];
      const lt = t - a.t;
      if (lt > a.dur) continue;
      const v = 0.35 * a.strength * Math.pow(1 - lt / a.dur, 2);
      if (a.data && a.data.color === 'red') redFlash = Math.max(redFlash, v);
      else flash = Math.max(flash, v);
    }
    const quiet = I < QUIET;
    const post = {
      rgbShift: Math.min(6, 3.2 * env.beat.pulse * I + 1.2 * env.onsetPulse * I + 8 * glitch),
      glitch,
      glitchSeed,
      grain: 0.07 + (quiet ? 0.02 : 0),
      vignette: 0.35 + (quiet ? 0.1 : 0),
      flash,
      redFlash,
      invert: 0,
      scanlines: 0,
      time: t,
    };

    // ---- HUD
    const inWin = (w) => !!w && t >= w[0] - 0.2 && t <= w[1] + 0.2;
    const hud = {
      title: this.hudInfo.title,
      artist: this.hudInfo.artist,
      duration: this.duration,
      visible: this.options.hud !== false && !inWin(this.titleWindow) && !inWin(this.endWindow),
      sectionName: env.section.name,
    };

    return { t, env, scene, lyrics, accents, camera, post, hud };
  };

  /** Short human-readable summary (debug / tests). */
  Director.prototype.summary = function () {
    const count = {};
    for (const a of this.accents) count[a.kind] = (count[a.kind] || 0) + 1;
    const tr = {};
    for (const c of this.sceneCues) if (c.transition) tr[c.transition.name] = (tr[c.transition.name] || 0) + 1;
    return {
      duration: this.duration, sections: this.sections.length, scenes: this.sceneCues.length,
      transitions: tr, accents: count, lyrics: this.lyricCues.length,
      camera: this.cameraEvents.length, glitches: this.glitches.length,
    };
  };

  Director.DEFAULT_SCENES = DEFAULT_SCENES;
  Director.DEFAULT_STYLE = DEFAULT_STYLE;
  Director.TRANSITIONS = { strong: STRONG, light: LIGHT, soft: SOFT, durations: T_DUR };
  MV.Director = Director;
})();

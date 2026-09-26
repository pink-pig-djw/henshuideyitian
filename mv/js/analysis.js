/*
 * MV.Analysis — offline audio analysis (docs/ARCHITECTURE.md §2.2, §3.1).
 *
 *   const features = await MV.Analysis.compute(audioBuffer, { onProgress });
 *   const m = MV.Analysis.matchPreset(features);            // → { preset, offset, confidence } | null
 *   if (m) MV.Analysis.applyPreset(features, m.preset, m.offset, m.confidence);
 *
 * compute() extracts, from a mono downmix decimated to ~22 kHz:
 *   - 100 fps perceptual envelopes rms / low / mid / high / flux (0..1):
 *     amplitude normalised by its 98th percentile, log-compressed
 *     (log1p(10·a)/log1p(10)), fast-attack / short-release smoothed;
 *   - onsets (SuperFlux-style log spectral flux + adaptive threshold) and
 *     kicks (low-band flux);
 *   - tempo (autocorrelation of the onset curve, log-normal prior at 110 BPM),
 *     beats (Ellis dynamic programming, 2 passes), downbeats (bar phase from
 *     low-band energy, kick strength and harmonic change);
 *   - sections (checkerboard novelty on a bar-synchronous self-similarity
 *     matrix, min 8 bars, labelled by energy / position, default scenes);
 *   - `novelty`: exactly the preset refEnvelope formula (hop 0.05 s) so a
 *     timing preset can be aligned by normalised cross-correlation.
 *
 * No DOM usage: this file also runs in Node (tests pass an AudioBuffer-like
 * object { sampleRate, length, duration, numberOfChannels, getChannelData }).
 * Everything here is offline. The lookup helpers (sample / avg / beatInfo /
 * sectionAt) are pure functions of (features, t) and safe in render paths.
 */
(function () {
  'use strict';

  const G = typeof window !== 'undefined' ? window : globalThis;
  const MV = (G.MV = G.MV || {});

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */
  const FPS = 100; //                 envelope frame rate
  const NFFT = 2048; //               STFT size at ~22 kHz (≈ 93 ms Hann)
  const TARGET_SR = 22050; //         analysis rate (integer decimation)
  const NOVELTY_HOP = 0.05; //        refEnvelope hop
  const ENV_PCT = 0.98; //            envelope normalisation percentile
  const ENV_RANGE_MIN = 15, ENV_RANGE_MAX = 42; // dB span mapped onto 0..1
  const FLUX_LAG = 2; //              frames (20 ms) for spectral flux
  const FLUX_GAMMA = 0.1; //          log1p(γ·|X|) compression for flux (gain-normalised input)
  // Spectral flux of a centred 93 ms window peaks before the physical onset
  // (the note enters the window's leading edge). Calibrated on synthetic
  // clicks / plucks: shifting flux 2 frames later puts onsets within ±10 ms.
  const ONSET_LATENCY_FRAMES = 2;
  const BAND_HZ = { low: [20, 150], mid: [250, 3000], high: [4000, 11000] };
  const TEMPO_PRIOR_BPM = 110;
  const TEMPO_MIN = 60, TEMPO_MAX = 200;
  const DP_TIGHTNESS = 300;
  const MATCH_MIN_OVERLAP = 20; //    s of overlap required for preset alignment
  const MATCH_MIN_MARGIN = 0.1; //    best NCC − best NCC ≥ 1 s away

  /** Default scene rotation per section kind (used when no preset is applied). */
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
  const DEFAULT_SWITCH_BARS = { verse: 4, bridge: 4 };

  /* ------------------------------------------------------------------ */
  /* Small private helpers                                               */
  /* ------------------------------------------------------------------ */
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const mod = (x, m) => ((x % m) + m) % m;
  const pulse = (dt, len) => (dt < 0 ? 0 : Math.exp((-dt * 4.6) / Math.max(1e-4, len)));
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const r4 = (x) => Math.round(x * 10000) / 10000;

  // Index of the last element with key(arr[i]) <= x, or -1.
  function lowerIndex(arr, x, key) {
    let lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = key ? key(arr[mid]) : arr[mid];
      if (v <= x) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  function percentile(arr, p, from = 0, to = arr.length) {
    const n = to - from;
    if (n <= 0) return 0;
    const tmp = new Float32Array(n);
    for (let i = 0; i < n; i++) tmp[i] = arr[from + i];
    tmp.sort();
    const idx = clamp(p) * (n - 1);
    const i0 = Math.floor(idx), i1 = Math.min(n - 1, i0 + 1);
    return tmp[i0] + (tmp[i1] - tmp[i0]) * (idx - i0);
  }

  function median(arr) {
    return percentile(arr, 0.5);
  }

  function meanStd(arr) {
    let s = 0, ss = 0;
    const n = arr.length || 1;
    for (let i = 0; i < arr.length; i++) {
      s += arr[i];
      ss += arr[i] * arr[i];
    }
    const m = s / n;
    return { mean: m, std: Math.sqrt(Math.max(0, ss / n - m * m)) };
  }

  // Centred moving average (window 2*half+1, shrinks at the edges).
  function movingAverage(x, half) {
    const n = x.length;
    const P = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) P[i + 1] = P[i] + x[i];
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - half), b = Math.min(n, i + half + 1);
      out[i] = (P[b] - P[a]) / (b - a);
    }
    return out;
  }

  // One-pole envelope follower (attack / release time constants in seconds).
  function follow(x, attack, release, fps) {
    const n = x.length;
    const out = new Float32Array(n);
    const aA = attack > 0 ? 1 - Math.exp(-1 / (attack * fps)) : 1;
    const aR = release > 0 ? 1 - Math.exp(-1 / (release * fps)) : 1;
    let y = n ? x[0] : 0;
    for (let i = 0; i < n; i++) {
      const v = x[i];
      y += (v - y) * (v > y ? aA : aR);
      out[i] = y;
    }
    return out;
  }

  // Event-loop yield: setImmediate (Node) → MessageChannel (browser, not
  // clamped like setTimeout) → setTimeout.
  const yieldNow = (function () {
    if (typeof setImmediate === 'function') return () => new Promise((r) => setImmediate(r));
    if (typeof MessageChannel === 'function') {
      try {
        const ch = new MessageChannel();
        const queue = [];
        ch.port1.onmessage = () => {
          const r = queue.shift();
          if (r) r();
        };
        return () =>
          new Promise((r) => {
            queue.push(r);
            ch.port2.postMessage(0);
          });
      } catch (e) {
        /* fall through */
      }
    }
    return () => new Promise((r) => setTimeout(r, 0));
  })();

  /* ------------------------------------------------------------------ */
  /* FFT (iterative radix-2, in place, forward)                          */
  /* ------------------------------------------------------------------ */
  function makeFFT(N) {
    const levels = Math.round(Math.log2(N));
    const rev = new Uint32Array(N);
    for (let i = 0; i < N; i++) {
      let x = i, y = 0;
      for (let b = 0; b < levels; b++) {
        y = (y << 1) | (x & 1);
        x >>= 1;
      }
      rev[i] = y;
    }
    const cosT = new Float64Array(N / 2), sinT = new Float64Array(N / 2);
    for (let i = 0; i < N / 2; i++) {
      cosT[i] = Math.cos((2 * Math.PI * i) / N);
      sinT[i] = Math.sin((2 * Math.PI * i) / N);
    }
    return function fft(re, im) {
      for (let i = 0; i < N; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i];
          re[i] = re[j];
          re[j] = t;
          t = im[i];
          im[i] = im[j];
          im[j] = t;
        }
      }
      for (let size = 2; size <= N; size <<= 1) {
        const half = size >> 1, step = N / size;
        for (let k = 0, tw = 0; k < half; k++, tw += step) {
          const c = cosT[tw], s = sinT[tw];
          for (let i = k; i < N; i += size) {
            const l = i + half;
            const xr = re[l], xi = im[l];
            const tr = xr * c + xi * s;
            const ti = xi * c - xr * s;
            re[l] = re[i] - tr;
            im[l] = im[i] - ti;
            re[i] += tr;
            im[i] += ti;
          }
        }
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Signal preparation                                                  */
  /* ------------------------------------------------------------------ */
  function channelsOf(buf) {
    const nch = Math.max(1, buf.numberOfChannels | 0);
    const chs = [];
    for (let c = 0; c < nch; c++) chs.push(buf.getChannelData(c));
    return chs;
  }

  // Mono downmix (mean of channels) + integer decimation with a
  // Blackman-windowed sinc low-pass (zero phase). Works in blocks and yields
  // so a long 48 kHz stereo file never blocks the main thread for long.
  async function monoDecimated(chs, len, factor, onStep) {
    const nch = chs.length;
    const BLOCK = 1 << 19;
    let mono;
    if (nch === 1) mono = chs[0];
    else {
      mono = new Float32Array(len);
      const g = 1 / nch;
      for (let a = 0; a < len; a += BLOCK) {
        const b = Math.min(len, a + BLOCK);
        for (let c = 0; c < nch; c++) {
          const ch = chs[c];
          const e = Math.min(b, ch.length);
          for (let i = a; i < e; i++) mono[i] += ch[i] * g;
        }
        if (onStep) onStep((0.3 * b) / len);
        await yieldNow();
      }
    }
    if (factor <= 1) return mono;
    const taps = 8 * factor + 1;
    const half = (taps - 1) / 2;
    const fc = (0.5 / factor) * 0.92;
    const h = new Float64Array(taps);
    let sum = 0;
    for (let i = 0; i < taps; i++) {
      const m = i - half;
      const sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
      h[i] = sinc * w;
      sum += h[i];
    }
    for (let i = 0; i < taps; i++) h[i] /= sum;
    const n = mono.length;
    const outLen = Math.floor(n / factor);
    const y = new Float32Array(outLen);
    const OB = Math.max(1, Math.floor(BLOCK / factor));
    for (let o0 = 0; o0 < outLen; o0 += OB) {
      const o1 = Math.min(outLen, o0 + OB);
      for (let o = o0; o < o1; o++) {
        const s0 = o * factor - half;
        let acc = 0;
        if (s0 >= 0 && s0 + taps <= n) {
          // symmetric taps: h[k] == h[taps-1-k]
          for (let k = 0; k < half; k++) acc += h[k] * (mono[s0 + k] + mono[s0 + taps - 1 - k]);
          acc += h[half] * mono[s0 + half];
        } else {
          for (let k = 0; k < taps; k++) {
            const idx = s0 + k;
            if (idx >= 0 && idx < n) acc += h[k] * mono[idx];
          }
        }
        y[o] = acc;
      }
      if (onStep) onStep(0.3 + (0.7 * o1) / outLen);
      await yieldNow();
    }
    return y;
  }

  /* ------------------------------------------------------------------ */
  /* refEnvelope-compatible novelty (ARCHITECTURE §2.1)                  */
  /* ------------------------------------------------------------------ */
  // mono = mean of channels; hopSamples = floor(sr*hop); n = floor(len/hop);
  // e = log1p(100*rms); e /= max(e); d = max(0, e[i]-e[i-1]) (d[0]=0); d /= max(d).
  function noveltyFrom(chs, sr, len) {
    const hopS = Math.max(1, Math.floor(sr * NOVELTY_HOP));
    const n = Math.max(0, Math.floor(len / hopS));
    const e = new Float64Array(n);
    const nch = chs.length;
    const g = 1 / nch;
    let emax = 0;
    for (let f = 0; f < n; f++) {
      const a = f * hopS, b = a + hopS;
      let acc = 0;
      if (nch === 1) {
        const c0 = chs[0];
        for (let i = a; i < b; i++) acc += c0[i] * c0[i];
      } else if (nch === 2) {
        const c0 = chs[0], c1 = chs[1];
        for (let i = a; i < b; i++) {
          const v = (c0[i] + c1[i]) * 0.5;
          acc += v * v;
        }
      } else {
        for (let i = a; i < b; i++) {
          let v = 0;
          for (let c = 0; c < nch; c++) v += chs[c][i];
          v *= g;
          acc += v * v;
        }
      }
      const v = Math.log1p(100 * Math.sqrt(acc / hopS));
      e[f] = v;
      if (v > emax) emax = v;
    }
    const d = new Float32Array(n);
    if (emax > 0 && n > 1) {
      let dmax = 0;
      const tmp = new Float64Array(n);
      for (let f = 1; f < n; f++) {
        const v = (e[f] - e[f - 1]) / emax;
        tmp[f] = v > 0 ? v : 0;
        if (tmp[f] > dmax) dmax = tmp[f];
      }
      if (dmax > 0) for (let f = 0; f < n; f++) d[f] = tmp[f] / dmax;
    }
    return { data: d, hop: hopS / sr };
  }

  /* ------------------------------------------------------------------ */
  /* Filterbanks                                                         */
  /* ------------------------------------------------------------------ */
  // Log-spaced bands as [k0, k1) bin ranges, each at least one bin wide.
  function logBands(sr, N, fmin, fmax, perOct) {
    const binHz = sr / N, half = N / 2;
    const bands = [];
    let prev = Math.max(1, Math.round(fmin / binHz));
    const ratio = Math.pow(2, 1 / perOct);
    for (let f = fmin * ratio; f <= fmax * 1.0001; f *= ratio) {
      const k = Math.min(half, Math.round(f / binHz));
      if (k <= prev) continue;
      bands.push([prev, k]);
      prev = k;
    }
    return bands;
  }

  function binRange(sr, N, lo, hi) {
    const binHz = sr / N;
    const k0 = Math.max(1, Math.round(lo / binHz));
    const k1 = Math.min(N / 2 + 1, Math.max(k0 + 1, Math.round(hi / binHz)));
    return [k0, k1];
  }

  /* ------------------------------------------------------------------ */
  /* Peak picking                                                        */
  /* ------------------------------------------------------------------ */
  // Local-max + adaptive (local mean + delta) threshold, minimum gap `wait`.
  function pickPeaks(o, o2) {
    const n = o.length;
    const { preMax, postMax, preAvg, postAvg, delta, wait, minAbs } = o2;
    const P = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) P[i + 1] = P[i] + o[i];
    const out = [];
    let last = -Infinity;
    for (let i = 1; i < n - 1; i++) {
      const v = o[i];
      if (v < minAbs) continue;
      let isMax = true;
      const a = Math.max(0, i - preMax), b = Math.min(n - 1, i + postMax);
      for (let j = a; j <= b; j++) {
        if (o[j] > v || (o[j] === v && j < i)) {
          isMax = false;
          break;
        }
      }
      if (!isMax) continue;
      const a2 = Math.max(0, i - preAvg), b2 = Math.min(n, i + postAvg + 1);
      const avgV = (P[b2] - P[a2]) / (b2 - a2);
      if (v < avgV + delta) continue;
      if (i - last < wait) continue;
      out.push(i);
      last = i;
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Tempo & beats                                                       */
  /* ------------------------------------------------------------------ */
  // Onset curve for tempo / beat tracking: flux minus its local mean, rectified.
  function beatCurve(flux, fps) {
    const loc = movingAverage(flux, Math.round(0.1 * fps));
    const o = new Float32Array(flux.length);
    for (let i = 0; i < o.length; i++) o[i] = Math.max(0, flux[i] - loc[i]);
    return o;
  }

  function shiftFrames(a, k) {
    if (!k) return a;
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) {
      const j = i - k;
      out[i] = j >= 0 && j < a.length ? a[j] : 0;
    }
    return out;
  }

  // Global autocorrelation tempo with a log-normal prior. Returns period (frames).
  function estimatePeriod(o, fps) {
    const n = o.length;
    const { mean } = meanStd(o);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = o[i] - mean;
    const minLag = Math.floor((60 * fps) / TEMPO_MAX);
    const maxLag = Math.ceil((60 * fps) / TEMPO_MIN);
    const r = new Float64Array(maxLag + 2);
    for (let L = Math.max(1, minLag - 1); L <= maxLag + 1; L++) {
      let s = 0;
      for (let i = 0; i + L < n; i++) s += x[i] * x[i + L];
      r[L] = s / Math.max(1, n - L);
    }
    let best = -Infinity, bestL = Math.round((60 * fps) / TEMPO_PRIOR_BPM);
    const score = new Float64Array(maxLag + 2);
    for (let L = minLag; L <= maxLag; L++) {
      const bpm = (60 * fps) / L;
      const z = Math.log2(bpm / TEMPO_PRIOR_BPM);
      const w = Math.exp(-0.5 * z * z);
      score[L] = r[L] * w;
      if (score[L] > best) {
        best = score[L];
        bestL = L;
      }
    }
    // Parabolic refinement on the raw autocorrelation.
    let p = bestL;
    if (bestL > minLag && bestL < maxLag) {
      const y0 = r[bestL - 1], y1 = r[bestL], y2 = r[bestL + 1];
      const den = y0 - 2 * y1 + y2;
      if (den < 0) p = bestL + clamp((0.5 * (y0 - y2)) / den, -0.5, 0.5);
    }
    const r0 = r[1] > 0 ? r[bestL] / Math.max(1e-12, r[Math.max(1, minLag - 1)]) : 0;
    return { period: p, strength: r0 };
  }

  // Ellis (2007) dynamic-programming beat tracker. Returns frame indices.
  function dpBeats(o, period, tightness) {
    const n = o.length;
    if (n < 4 || !(period > 1)) return [];
    const { std } = meanStd(o);
    const inv = std > 0 ? 1 / std : 1;
    // Local score: onset curve smoothed with a Gaussian of σ = period/32.
    const sig = Math.max(0.5, period / 32);
    const hw = Math.ceil(3 * sig);
    const gk = new Float64Array(2 * hw + 1);
    for (let k = -hw; k <= hw; k++) gk[k + hw] = Math.exp(-0.5 * (k / sig) * (k / sig));
    const ls = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -hw; k <= hw; k++) {
        const j = i + k;
        if (j >= 0 && j < n) s += o[j] * gk[k + hw];
      }
      ls[i] = s * inv;
    }
    const dMin = Math.max(1, Math.round(period / 2));
    const dMax = Math.max(dMin + 1, Math.round(period * 2));
    const pen = new Float64Array(dMax + 1);
    for (let d = dMin; d <= dMax; d++) {
      const l = Math.log(d / period);
      pen[d] = -tightness * l * l;
    }
    const cum = new Float64Array(n);
    const back = new Int32Array(n).fill(-1);
    let lsMax = 0;
    for (let i = 0; i < n; i++) if (ls[i] > lsMax) lsMax = ls[i];
    const thresh = 0.01 * lsMax;
    let first = true;
    for (let i = 0; i < n; i++) {
      let best = -Infinity, bj = -1;
      for (let d = dMin; d <= dMax; d++) {
        const j = i - d;
        const v = (j >= 0 ? cum[j] : 0) + pen[d];
        if (v > best) {
          best = v;
          bj = j;
        }
      }
      cum[i] = ls[i] + best;
      if (first && ls[i] < thresh) back[i] = -1;
      else {
        back[i] = bj;
        first = false;
      }
    }
    // Last beat: last local max of cum above half the median local-max score.
    const maxes = [];
    for (let i = 1; i < n - 1; i++) if (cum[i] > cum[i - 1] && cum[i] >= cum[i + 1]) maxes.push(cum[i]);
    const med = maxes.length ? median(Float32Array.from(maxes)) : 0;
    let lastI = n - 1;
    for (let i = n - 2; i > 0; i--) {
      if (cum[i] > cum[i - 1] && cum[i] >= cum[i + 1] && cum[i] >= 0.5 * med) {
        lastI = i;
        break;
      }
    }
    const beats = [];
    for (let i = lastI; i >= 0; i = back[i]) {
      beats.push(i);
      if (back[i] >= i) break;
    }
    beats.reverse();
    // Trim weak leading / trailing beats (librosa-style).
    if (beats.length > 4) {
      const vals = beats.map((b) => ls[b]);
      const sm = vals.map((_, i) => {
        let s = 0, w = 0;
        for (let k = -2; k <= 2; k++) {
          const j = i + k;
          if (j < 0 || j >= vals.length) continue;
          const wk = 0.5 - 0.5 * Math.cos((2 * Math.PI * (k + 3)) / 6);
          s += vals[j] * wk;
          w += wk;
        }
        return s / w;
      });
      let ms = 0;
      for (const v of sm) ms += v * v;
      const th = 0.5 * Math.sqrt(ms / sm.length);
      let a = 0, b = beats.length;
      while (a < b && sm[a] <= th) a++;
      while (b > a && sm[b - 1] <= th) b--;
      return beats.slice(a, b);
    }
    return beats;
  }

  // Robust constant-tempo estimate from beat times: unwrap indices by the
  // median interval, then least squares t = t0 + k·T.
  function fitGrid(times) {
    if (times.length < 4) return null;
    const ibis = [];
    for (let i = 1; i < times.length; i++) ibis.push(times[i] - times[i - 1]);
    const m = median(Float32Array.from(ibis));
    if (!(m > 0)) return null;
    const ks = [0];
    for (let i = 1; i < times.length; i++) ks.push(ks[i - 1] + Math.max(1, Math.round((times[i] - times[i - 1]) / m)));
    let sk = 0, st = 0, skk = 0, skt = 0;
    const n = times.length;
    for (let i = 0; i < n; i++) {
      sk += ks[i];
      st += times[i];
      skk += ks[i] * ks[i];
      skt += ks[i] * times[i];
    }
    const den = n * skk - sk * sk;
    if (!(den > 0)) return { period: m, t0: times[0] };
    const T = (n * skt - sk * st) / den;
    const t0 = (st - T * sk) / n;
    return { period: T, t0, median: m };
  }

  /* ------------------------------------------------------------------ */
  /* Downbeat phase                                                      */
  /* ------------------------------------------------------------------ */
  function zscore(a) {
    const { mean, std } = meanStd(a);
    const out = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = std > 1e-9 ? (a[i] - mean) / std : 0;
    return out;
  }

  function chromaMean(chroma, fps, n, t0, t1, out) {
    out.fill(0);
    const a = clamp(Math.round(t0 * fps), 0, n - 1), b = clamp(Math.round(t1 * fps), a + 1, n);
    for (let f = a; f < b; f++) for (let c = 0; c < 12; c++) out[c] += chroma[f * 12 + c];
    let s = 0;
    for (let c = 0; c < 12; c++) s += out[c] * out[c];
    s = Math.sqrt(s) || 1;
    for (let c = 0; c < 12; c++) out[c] /= s;
    return out;
  }

  function cosDist(a, b) {
    let s = 0;
    for (let c = 0; c < 12; c++) s += a[c] * b[c];
    return 1 - s;
  }

  // Which beat index (mod bpb) starts a bar. Combines low-band energy at the
  // beat, low-band onset strength, and harmonic (chroma) change into / across
  // the beat — chords and bass notes tend to change on the downbeat.
  function findDownbeatPhase(beats, bpb, d) {
    const nb = beats.length;
    if (nb < bpb * 3) return { phase: 0, scores: [] };
    const { fps, n, lowLog, lowFlux, flux, chroma } = d;
    const fr = (t) => clamp(Math.round(t * fps), 0, n - 1);
    const A = new Float64Array(nb), K = new Float64Array(nb), O = new Float64Array(nb);
    const C1 = new Float64Array(nb), C4 = new Float64Array(nb);
    for (let b = 0; b < nb; b++) {
      const f = fr(beats[b]);
      let s = 0, c = 0, km = 0, om = 0;
      for (let j = f; j <= Math.min(n - 1, f + 10); j++) {
        s += lowLog[j];
        c++;
      }
      for (let j = Math.max(0, f - 4); j <= Math.min(n - 1, f + 6); j++) {
        if (lowFlux[j] > km) km = lowFlux[j];
        if (flux[j] > om) om = flux[j];
      }
      A[b] = s / Math.max(1, c);
      K[b] = km;
      O[b] = om;
    }
    const ca = new Float64Array(12), cb = new Float64Array(12);
    const bt = (k) => (k < 0 ? beats[0] + k * (beats[1] - beats[0]) : k >= nb ? beats[nb - 1] + (k - nb + 1) * (beats[nb - 1] - beats[nb - 2]) : beats[k]);
    for (let b = 0; b < nb; b++) {
      chromaMean(chroma, fps, n, bt(b - 1), bt(b), ca);
      chromaMean(chroma, fps, n, bt(b), bt(b + 1), cb);
      C1[b] = cosDist(ca, cb);
      chromaMean(chroma, fps, n, bt(b - bpb), bt(b), ca);
      chromaMean(chroma, fps, n, bt(b), bt(b + bpb), cb);
      C4[b] = cosDist(ca, cb);
    }
    const zA = zscore(A), zK = zscore(K), zO = zscore(O), zC1 = zscore(C1), zC4 = zscore(C4);
    const W = { A: 0.5, K: 0.5, O: 0.25, C1: 0.75, C4: 1.0 };
    const scores = [];
    const parts = [];
    for (let ph = 0; ph < bpb; ph++) {
      let s = 0, cnt = 0;
      const p = { A: 0, K: 0, O: 0, C1: 0, C4: 0 };
      for (let b = ph; b < nb; b += bpb) {
        p.A += zA[b];
        p.K += zK[b];
        p.O += zO[b];
        p.C1 += zC1[b];
        p.C4 += zC4[b];
        cnt++;
      }
      for (const k in p) p[k] /= Math.max(1, cnt);
      s = W.A * p.A + W.K * p.K + W.O * p.O + W.C1 * p.C1 + W.C4 * p.C4;
      scores.push(s);
      parts.push(p);
    }
    let best = 0;
    for (let ph = 1; ph < bpb; ph++) if (scores[ph] > scores[best]) best = ph;
    return { phase: best, scores, parts };
  }

  /* ------------------------------------------------------------------ */
  /* Sections                                                            */
  /* ------------------------------------------------------------------ */
  function makeSection(kind, start, end, extra) {
    const s = {
      kind,
      name: kind.toUpperCase(),
      start: r3(start),
      end: r3(end),
      intensity: 0.5,
      energy: 0,
      scenes: (DEFAULT_SCENES[kind] || DEFAULT_SCENES.verse).slice(),
      switchBars: DEFAULT_SWITCH_BARS[kind] || 2,
    };
    return Object.assign(s, extra || {});
  }

  // Normalise by the 95th percentile (robust to one dominant peak).
  function robustNorm(a) {
    const ref = percentile(a, 0.95) || Math.max.apply(null, Array.from(a)) || 1;
    const out = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = a[i] / ref;
    return out;
  }

  // Checkerboard-kernel novelty along the diagonal of an m×m SSM. Value j
  // scores a boundary between bar j-1 and bar j (half width K bars).
  function checkerboard(S, m, K) {
    const nov = new Float64Array(m + 1);
    const g = new Float64Array(2 * K);
    for (let a = -K; a < K; a++) g[a + K] = Math.exp(-0.5 * Math.pow((a + 0.5) / (K * 0.6), 2));
    for (let j = 1; j < m; j++) {
      let acc = 0, wsum = 0;
      for (let a = -K; a < K; a++) {
        const ia = j + a;
        if (ia < 0 || ia >= m) continue;
        for (let b = -K; b < K; b++) {
          const ib = j + b;
          if (ib < 0 || ib >= m) continue;
          const w = g[a + K] * g[b + K];
          acc += ((a < 0) === (b < 0) ? w : -w) * S[ia * m + ib];
          wsum += w;
        }
      }
      nov[j] = wsum > 0 ? Math.max(0, acc / wsum) : 0;
    }
    return nov;
  }

  // Bar-synchronous features → self-similarity → checkerboard novelty (K = 4
  // and 8 bars) + multi-band energy step → greedy peak picking with a minimum
  // section length of 8 bars (4 for the first / last section).
  function segmentBars(barTimes, d) {
    const { fps, n, chroma, timbre, nTimbre, env } = d;
    const m = barTimes.length - 1;
    const nE = env.length;
    const fr = (t) => clamp(Math.round(t * fps), 0, n);
    const dim = 12 + nTimbre + nE;
    const X = [], E = [], Cq = [];
    for (let j = 0; j < m; j++) {
      const a = Math.min(fr(barTimes[j]), n - 1), b = Math.min(n, Math.max(a + 1, fr(barTimes[j + 1])));
      const v = new Float64Array(dim);
      for (let f = a; f < b; f++) {
        for (let c = 0; c < 12; c++) v[c] += chroma[f * 12 + c];
        for (let c = 0; c < nTimbre; c++) v[12 + c] += timbre[f * nTimbre + c];
        for (let c = 0; c < nE; c++) v[12 + nTimbre + c] += env[c][f];
      }
      const cnt = b - a;
      for (let c = 0; c < dim; c++) v[c] /= cnt;
      let s = 0;
      for (let c = 0; c < 12; c++) s += v[c] * v[c];
      s = Math.sqrt(s) || 1;
      for (let c = 0; c < 12; c++) v[c] /= s;
      E.push(v.slice(12 + nTimbre));
      Cq.push(v.slice(0, 12));
      X.push(v);
    }
    // Standardise each dimension, then weight the groups equally-ish.
    for (let c = 0; c < dim; c++) {
      let s = 0, ss = 0;
      for (let j = 0; j < m; j++) {
        s += X[j][c];
        ss += X[j][c] * X[j][c];
      }
      const mu = s / m, sd = Math.sqrt(Math.max(1e-12, ss / m - mu * mu));
      for (let j = 0; j < m; j++) X[j][c] = (X[j][c] - mu) / sd;
    }
    const wC = 1 / Math.sqrt(12), wT = 1 / Math.sqrt(nTimbre), wE = 1.2 / Math.sqrt(nE);
    for (let j = 0; j < m; j++) {
      const v = X[j];
      let s = 0;
      for (let c = 0; c < dim; c++) {
        v[c] *= c < 12 ? wC : c < 12 + nTimbre ? wT : wE;
        s += v[c] * v[c];
      }
      s = Math.sqrt(s) || 1;
      for (let c = 0; c < dim; c++) v[c] /= s;
    }
    const S = new Float64Array(m * m);
    for (let i = 0; i < m; i++) {
      for (let j = i; j < m; j++) {
        let s = 0;
        const a = X[i], b = X[j];
        for (let c = 0; c < dim; c++) s += a[c] * b[c];
        S[i * m + j] = S[j * m + i] = s;
      }
    }
    // Chroma-only similarity (mean-centred cosine) for repetition tests.
    const cm = new Float64Array(12);
    for (let j = 0; j < m; j++) for (let c = 0; c < 12; c++) cm[c] += Cq[j][c] / m;
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let c = 0; c < 12; c++) {
        Cq[j][c] -= cm[c];
        s += Cq[j][c] * Cq[j][c];
      }
      s = Math.sqrt(s) || 1;
      for (let c = 0; c < 12; c++) Cq[j][c] /= s;
    }
    const SC = new Float64Array(m * m);
    for (let i = 0; i < m; i++) {
      for (let j = i; j < m; j++) {
        let s = 0;
        for (let c = 0; c < 12; c++) s += Cq[i][c] * Cq[j][c];
        SC[i * m + j] = SC[j * m + i] = s;
      }
    }
    const n4 = robustNorm(checkerboard(S, m, 4));
    const n8 = robustNorm(checkerboard(S, m, 8));
    // Multi-band energy step: |mean(next 4 bars) − mean(previous 4 bars)|.
    const step = new Float64Array(m + 1);
    for (let j = 1; j < m; j++) {
      const s0 = new Float64Array(nE), s1 = new Float64Array(nE);
      let c0 = 0, c1 = 0;
      for (let k = 1; k <= 4; k++) {
        if (j - k >= 0) {
          for (let c = 0; c < nE; c++) s0[c] += E[j - k][c];
          c0++;
        }
        if (j + k - 1 < m) {
          for (let c = 0; c < nE; c++) s1[c] += E[j + k - 1][c];
          c1++;
        }
      }
      let dd = 0;
      for (let c = 0; c < nE; c++) {
        const diff = s1[c] / Math.max(1, c1) - s0[c] / Math.max(1, c0);
        dd += diff * diff;
      }
      step[j] = Math.sqrt(dd);
    }
    const stepN = robustNorm(step);
    const score = new Float64Array(m + 1);
    for (let j = 1; j < m; j++) score[j] = 0.35 * n4[j] + 0.35 * n8[j] + 0.5 * stepN[j];
    const cands = [];
    for (let j = 1; j < m; j++) if (score[j] > 0 && score[j] >= score[j - 1] && score[j] >= score[j + 1]) cands.push(j);
    cands.sort((a, b) => score[b] - score[a]);
    const thr = 0.2 * (percentile(score, 0.95) || 1);
    const MIN = 8, EDGE = 3;
    const chosen = [];
    const maxCount = Math.max(0, Math.floor(m / MIN));
    for (const j of cands) {
      if (score[j] < thr || chosen.length >= maxCount) break;
      if (j < EDGE || m - j < EDGE) continue;
      let ok = true;
      for (const c of chosen) if (Math.abs(c - j) < MIN) ok = false;
      if (ok) chosen.push(j);
    }
    chosen.sort((a, b) => a - b);
    // Sections of ≥ 2·MIN bars (usually repeated material such as two
    // choruses in a row) are split at their strongest internal novelty.
    for (let guard = 0; guard < 32; guard++) {
      const edges = [0].concat(chosen, [m]);
      let split = -1;
      for (let i = 0; i < edges.length - 1 && split < 0; i++) {
        const a = edges[i], b = edges[i + 1];
        if (b - a < 2 * MIN) continue;
        let best = -1;
        for (let j = a + MIN; j <= b - MIN; j++) if (best < 0 || score[j] > score[best]) best = j;
        split = best;
      }
      if (split < 0) break;
      chosen.push(split);
      chosen.sort((a, b) => a - b);
    }
    return { bounds: chosen, score, S, SC, m };
  }

  // Mean bar-SSM similarity between two bar ranges.
  function blockSim(S, m, a0, a1, b0, b1) {
    let s = 0, c = 0;
    for (let i = a0; i < a1; i++) for (let j = b0; j < b1; j++) {
      s += S[i * m + j];
      c++;
    }
    return c ? s / c : 0;
  }

  // Label sections by energy (0..1 composite), position and repetition
  // (a loud mid-song section that repeats the intro material = interlude).
  function labelSections(secs, duration, sim) {
    const m = secs.length;
    if (!m) return secs;
    const E = secs.map((s) => s.energy);
    const eMin = Math.min.apply(null, E), eMax = Math.max.apply(null, E);
    const span = Math.max(1e-6, eMax - eMin);
    const u = E.map((e) => (e - eMin) / span);
    const kinds = new Array(m).fill(null);
    const HI = 0.7, LO = 0.35;
    if (m === 1) kinds[0] = 'verse';
    // Edges: a short (≤ 8 bars) or quiet first / last section is intro / outro.
    if (m > 1 && ((secs[0].bars || 8) <= 8 || u[0] < HI)) kinds[0] = 'intro';
    if (m > 2 && ((secs[m - 1].bars || 8) <= 8 || u[m - 1] < HI)) kinds[m - 1] = 'outro';
    for (let i = 0; i < m && m > 2; i++) if (!kinds[i] && u[i] >= HI) kinds[i] = 'chorus';
    // The loud mid-song section that most clearly repeats the intro's
    // harmony (chroma) rather than the choruses' → instrumental interlude.
    if (sim && kinds[0] === 'intro') {
      const ch = [];
      for (let i = 1; i < m - 1; i++) if (kinds[i] === 'chorus') ch.push(i);
      if (ch.length >= 3) {
        let best = -1, bestMargin = 0.08;
        for (const i of ch) {
          if (secs[i].start < 0.25 * duration) continue;
          const toIntro = sim(i, 0);
          let toChorus = -Infinity;
          for (const k of ch) if (k !== i) toChorus = Math.max(toChorus, sim(i, k));
          if (toIntro >= 0.15 && toIntro - toChorus > bestMargin) {
            bestMargin = toIntro - toChorus;
            best = i;
          }
        }
        if (best >= 0) kinds[best] = 'interlude';
      }
    }
    // Climax: last chorus-like section starting in the final 40 % (≥ 2 choruses).
    const ch = [];
    for (let i = 0; i < m; i++) if (kinds[i] === 'chorus') ch.push(i);
    if (ch.length >= 2 && secs[ch[ch.length - 1]].start >= 0.6 * duration) kinds[ch[ch.length - 1]] = 'climax';
    let seenChorus = false;
    for (let i = 0; i < m; i++) {
      if (kinds[i] === 'chorus' || kinds[i] === 'climax') {
        seenChorus = true;
        continue;
      }
      if (kinds[i]) continue;
      const next = i + 1 < m ? kinds[i + 1] : null;
      const beforeChorus = next === 'chorus' || next === 'climax';
      const rising = i > 0 && u[i] > u[i - 1] + 0.05;
      const bars = secs[i].bars || 8;
      if (u[i] <= LO && seenChorus) kinds[i] = 'bridge';
      else if (beforeChorus && rising && bars <= 12) kinds[i] = seenChorus ? 'build' : 'pre';
      else if (!seenChorus) kinds[i] = 'verse';
      else if (beforeChorus && secs[i].start > 0.5 * duration) kinds[i] = 'build';
      else if (secs[i].start < 0.45 * duration && u[i] < 0.5) kinds[i] = 'verse';
      else kinds[i] = 'interlude';
    }
    // A chorus right after a chorus, clearly weaker, is a hook (post-chorus).
    for (let i = 1; i < m; i++) if (kinds[i] === 'chorus' && kinds[i - 1] === 'chorus' && u[i] < u[i - 1] - 0.1) kinds[i] = 'hook';
    let credits = false;
    const out = secs.map((s, i) => {
      const k = kinds[i];
      const sec = makeSection(k, s.start, s.end, { energy: r3(s.energy), intensity: r3(clamp(0.15 + 0.85 * u[i])) });
      if (k === 'interlude' && !credits) {
        sec.credits = true;
        credits = true;
      }
      if (k === 'outro' && i === m - 1) sec.endCard = true;
      return sec;
    });
    if (!credits) {
      const b = out.find((s) => s.kind === 'bridge');
      if (b) b.credits = true;
    }
    return out;
  }

  function computeSections(grid, duration, d) {
    const { fps, n, energy } = d;
    const barLen = grid.barLen;
    const secEnergy = (a, b) => {
      const fa = clamp(Math.round(a * fps), 0, n - 1), fb = clamp(Math.round(b * fps), fa + 1, n);
      let s = 0;
      for (let f = fa; f < fb; f++) s += energy[f];
      return s / Math.max(1, fb - fa);
    };
    const down = grid.downbeats.filter((t) => t >= 0 && t < duration - 0.25 * barLen);
    if (down.length < 12 || !(duration > 0)) {
      return labelSections([{ start: 0, end: duration, energy: secEnergy(0, duration), bars: down.length }], duration);
    }
    const barTimes = down.slice();
    barTimes.push(Math.min(duration, down[down.length - 1] + barLen));
    const seg = segmentBars(barTimes, d);
    const edges = [0].concat(seg.bounds.map((j) => barTimes[j]), [duration]);
    const bIdx = [0].concat(seg.bounds, [barTimes.length - 1]);
    const secs = [];
    for (let i = 0; i < edges.length - 1; i++) {
      secs.push({ start: edges[i], end: edges[i + 1], energy: secEnergy(edges[i], edges[i + 1]), bars: bIdx[i + 1] - bIdx[i] });
    }
    const sim = (i, k) => blockSim(seg.SC, seg.m, bIdx[i], Math.min(seg.m, bIdx[i + 1]), bIdx[k], Math.min(seg.m, bIdx[k + 1]));
    if (d.debug) {
      d.debug.barTimes = barTimes.map(r3);
      d.debug.barScore = Array.from(seg.score, r3);
      d.debug.bounds = seg.bounds.slice();
    }
    return labelSections(secs, duration, sim);
  }

  /* ------------------------------------------------------------------ */
  /* compute()                                                           */
  /* ------------------------------------------------------------------ */
  /**
   * Analyse an AudioBuffer (or AudioBuffer-like object).
   * @param {AudioBuffer|{sampleRate:number,length:number,duration?:number,numberOfChannels:number,getChannelData:(i:number)=>Float32Array}} buffer
   * @param {{onProgress?:(p:number)=>void, debug?:boolean}} [opts] debug adds segmentation diagnostics to features.debug
   * @returns {Promise<object>} Features (ARCHITECTURE §2.2)
   */
  async function compute(buffer, opts = {}) {
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const report = (p) => {
      if (!onProgress) return;
      try {
        onProgress(clamp(p));
      } catch (e) {
        /* ignore listener errors */
      }
    };
    const clock = typeof performance !== 'undefined' && performance.now ? () => performance.now() : () => 0;
    const t0 = clock();
    const stageMs = {};
    let lapT = t0;
    const lap = (name) => {
      const now = clock();
      stageMs[name] = Math.round(now - lapT);
      lapT = now;
    };
    report(0);

    const sr0 = buffer.sampleRate || 44100;
    const len0 = buffer.length || 0;
    const duration = buffer.duration || len0 / sr0;
    const chs = channelsOf(buffer);

    // 1. refEnvelope-compatible novelty at the native rate.
    const nov = noveltyFrom(chs, sr0, len0);
    lap('novelty');
    report(0.03);
    await yieldNow();

    // 2. Mono downmix, integer decimation to ~22 kHz.
    const factor = Math.max(1, Math.round(sr0 / TARGET_SR));
    const x = await monoDecimated(chs, len0, factor, (q) => report(0.03 + 0.05 * q));
    const sr = sr0 / factor;
    lap('decimate');
    report(0.08);
    await yieldNow();

    // Level reference (98th pct of 50 ms RMS) so spectral log compression is gain independent.
    const lvlHop = Math.max(1, Math.round(sr * 0.05));
    const nLvl = Math.max(1, Math.floor(x.length / lvlHop));
    const lvl = new Float32Array(nLvl);
    for (let f = 0; f < nLvl; f++) {
      let s = 0;
      const a = f * lvlHop, b = Math.min(x.length, a + lvlHop);
      for (let i = a; i < b; i++) s += x[i] * x[i];
      lvl[f] = Math.sqrt(s / Math.max(1, b - a));
    }
    const lvlRef = Math.max(1e-5, percentile(lvl, 0.98));
    const gain = 1 / lvlRef;

    // 3. STFT at 100 fps (two real frames per complex FFT).
    const N = NFFT, H = N / 2;
    const hop = sr / FPS;
    const n = Math.max(1, Math.ceil(duration * FPS));
    const win = new Float64Array(N);
    let sumW2 = 0;
    for (let i = 0; i < N; i++) {
      win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
      sumW2 += win[i] * win[i];
    }
    const powNorm = 1 / (N * sumW2); // → mean square of the (gain-scaled) signal
    const fft = makeFFT(N);
    const re = new Float64Array(N), im = new Float64Array(N);
    const PA = new Float64Array(H + 1), PB = new Float64Array(H + 1);

    const fmax = Math.min(11000, 0.95 * (sr / 2));
    const fluxBands = logBands(sr, N, 30, fmax, 12);
    const nB = fluxBands.length;
    let nLowBands = 0;
    for (let b = 0; b < nB; b++) if ((fluxBands[b][1] * sr) / N <= 160) nLowBands = b + 1;
    const timbreBands = logBands(sr, N, 40, fmax, 1.4);
    const nT = timbreBands.length;
    const kLow = binRange(sr, N, BAND_HZ.low[0], BAND_HZ.low[1]);
    const kMid = binRange(sr, N, BAND_HZ.mid[0], BAND_HZ.mid[1]);
    const kHigh = binRange(sr, N, Math.min(BAND_HZ.high[0], fmax * 0.6), Math.min(BAND_HZ.high[1], fmax));
    const pcOf = new Int8Array(H + 1).fill(-1);
    for (let k = 1; k <= H; k++) {
      const f = (k * sr) / N;
      if (f >= 60 && f <= 2100) pcOf[k] = mod(Math.round(12 * Math.log2(f / 440)) + 9, 12);
    }
    let kc0 = H, kc1 = 0;
    for (let k = 1; k <= H; k++)
      if (pcOf[k] >= 0) {
        kc0 = Math.min(kc0, k);
        kc1 = Math.max(kc1, k);
      }

    const pRms = new Float32Array(n), pLow = new Float32Array(n), pMid = new Float32Array(n), pHigh = new Float32Array(n);
    const flux = new Float32Array(n), lowFlux = new Float32Array(n);
    const chroma = new Float32Array(n * 12);
    const timbre = new Float32Array(n * nT);
    const ring = [new Float64Array(nB), new Float64Array(nB), new Float64Array(nB)];
    const fluxGamma = FLUX_GAMMA;
    const refMax = new Float64Array(nB);

    const fill = (buf, f) => {
      if (f >= n) {
        buf.fill(0);
        return;
      }
      const c = Math.round(f * hop);
      const s0 = c - H;
      if (s0 >= 0 && s0 + N <= x.length) {
        for (let i = 0; i < N; i++) buf[i] = x[s0 + i] * win[i] * gain;
      } else {
        for (let i = 0; i < N; i++) {
          const idx = s0 + i;
          buf[i] = idx >= 0 && idx < x.length ? x[idx] * win[i] * gain : 0;
        }
      }
    };

    const frame = (f, P) => {
      // Band powers (one-sided, ×2 except DC/Nyquist) → mean-square units.
      let tot = P[0] + P[H];
      for (let k = 1; k < H; k++) tot += 2 * P[k];
      pRms[f] = tot * powNorm;
      let s = 0;
      for (let k = kLow[0]; k < kLow[1]; k++) s += P[k];
      pLow[f] = 2 * s * powNorm;
      s = 0;
      for (let k = kMid[0]; k < kMid[1]; k++) s += P[k];
      pMid[f] = 2 * s * powNorm;
      s = 0;
      for (let k = kHigh[0]; k < kHigh[1]; k++) s += P[k];
      pHigh[f] = 2 * s * powNorm;
      // Log filterbank + SuperFlux (max-filtered reference, lag 2).
      const L = ring[f % 3];
      for (let b = 0; b < nB; b++) {
        const r = fluxBands[b];
        let e = 0;
        for (let k = r[0]; k < r[1]; k++) e += P[k];
        L[b] = Math.log1p(fluxGamma * Math.sqrt(e));
      }
      if (f >= FLUX_LAG) {
        const R = ring[(f - FLUX_LAG) % 3];
        for (let b = 0; b < nB; b++) {
          let v = R[b];
          if (b > 0 && R[b - 1] > v) v = R[b - 1];
          if (b + 1 < nB && R[b + 1] > v) v = R[b + 1];
          refMax[b] = v;
        }
        let fl = 0, lf = 0;
        for (let b = 0; b < nB; b++) {
          const dlt = L[b] - refMax[b];
          if (dlt > 0) fl += dlt;
          if (b < nLowBands) {
            const dl = L[b] - R[b];
            if (dl > 0) lf += dl;
          }
        }
        flux[f] = fl;
        lowFlux[f] = lf;
      }
      // Chroma (magnitude).
      const co = f * 12;
      for (let k = kc0; k <= kc1; k++) {
        const pc = pcOf[k];
        if (pc >= 0) chroma[co + pc] += Math.sqrt(P[k]);
      }
      // Coarse log-band timbre.
      const to = f * nT;
      for (let b = 0; b < nT; b++) {
        const r = timbreBands[b];
        let e = 0;
        for (let k = r[0]; k < r[1]; k++) e += P[k];
        timbre[to + b] = Math.log(e * powNorm + 1e-9);
      }
    };

    const YIELD_EVERY = 800;
    for (let f = 0; f < n; f += 2) {
      fill(re, f);
      fill(im, f + 1);
      fft(re, im);
      for (let k = 0; k <= H; k++) {
        const k2 = (N - k) & (N - 1);
        const xr = re[k], xi = im[k], yr = re[k2], yi = im[k2];
        const ar = xr + yr, ai = xi - yi, br = xi + yi, bi = xr - yr;
        PA[k] = 0.25 * (ar * ar + ai * ai);
        PB[k] = 0.25 * (br * br + bi * bi);
      }
      frame(f, PA);
      if (f + 1 < n) frame(f + 1, PB);
      if (f % YIELD_EVERY === 0 && f > 0) {
        report(0.08 + 0.72 * (f / n));
        await yieldNow();
      }
    }
    lap('stft');
    report(0.8);
    await yieldNow();
    {
      const sh = ONSET_LATENCY_FRAMES;
      flux.set(shiftFrames(flux, sh));
      lowFlux.set(shiftFrames(lowFlux, sh));
    }

    // 4. Perceptual envelopes.
    // dB relative to the 98th percentile, over a range of (p98 − p5) dB
    // clamped to [ENV_RANGE_MIN, ENV_RANGE_MAX]: log-compressed, contrast
    // adapted to the song's own dynamics (heavily mastered songs still move).
    const toEnv = (pw, attack, release) => {
      const db = new Float32Array(n);
      for (let i = 0; i < n; i++) db[i] = 10 * Math.log10(Math.max(0, pw[i]) + 1e-12);
      const hi = percentile(db, ENV_PCT);
      const range = clamp(hi - percentile(db, 0.05), ENV_RANGE_MIN, ENV_RANGE_MAX);
      for (let i = 0; i < n; i++) db[i] = clamp(1 + (db[i] - hi) / range);
      return follow(db, attack, release, FPS);
    };
    const rms = toEnv(pRms, 0.01, 0.08);
    const low = toEnv(pLow, 0.005, 0.07);
    const mid = toEnv(pMid, 0.01, 0.08);
    const high = toEnv(pHigh, 0.005, 0.05);
    const fluxP98 = Math.max(1e-9, percentile(flux, ENV_PCT));
    const fluxP30 = percentile(flux, 0.3);
    const fluxN = new Float32Array(n);
    for (let i = 0; i < n; i++) fluxN[i] = clamp((flux[i] - fluxP30) / Math.max(1e-9, fluxP98 - fluxP30));
    const fluxEnv = follow(fluxN, 0, 0.06, FPS);
    const lowLog = new Float32Array(n);
    for (let i = 0; i < n; i++) lowLog[i] = Math.log(pLow[i] + 1e-7);

    // Onsets & kicks.
    const onsetIdx = pickPeaks(flux, {
      preMax: 3, postMax: 3, preAvg: 10, postAvg: 10,
      delta: 0.07 * fluxP98, wait: 5, minAbs: 0.1 * fluxP98,
    });
    const onsets = onsetIdx.map((i) => ({ t: r3(i / FPS), s: r3(clamp(flux[i] / fluxP98)) }));
    const lfP98 = Math.max(1e-9, percentile(lowFlux, ENV_PCT));
    const kickIdx = pickPeaks(lowFlux, {
      preMax: 5, postMax: 5, preAvg: 30, postAvg: 30,
      delta: 0.15 * lfP98, wait: 12, minAbs: 0.25 * lfP98,
    });
    const kicks = kickIdx.map((i) => r3(i / FPS));
    lap('envelopes');
    report(0.84);
    await yieldNow();

    // 5. Tempo & beats (two DP passes: ACF period, then fitted period).
    const oc = beatCurve(flux, FPS);
    const est = n >= 3 * FPS ? estimatePeriod(oc, FPS) : { period: (60 * FPS) / 120, strength: 0 };
    let beatFrames = dpBeats(oc, est.period, DP_TIGHTNESS);
    let grid = fitGrid(beatFrames.map((f) => f / FPS));
    let period = est.period;
    report(0.87);
    await yieldNow();
    if (grid && Math.abs(grid.period * FPS - est.period) / est.period < 0.08) {
      period = grid.period * FPS;
      beatFrames = dpBeats(oc, period, DP_TIGHTNESS);
      grid = fitGrid(beatFrames.map((f) => f / FPS)) || grid;
    }
    const bpm = grid ? 60 / grid.period : (60 * FPS) / period;
    let beats = beatFrames.map((f) => f / FPS);
    // Drop irregular beats at the edges (e.g. a pickup note taken as beat 0).
    {
      const P = grid ? grid.period : period / FPS;
      while (beats.length > 4 && Math.abs(beats[1] - beats[0] - P) > 0.15 * P) beats.shift();
      while (beats.length > 4 && Math.abs(beats[beats.length - 1] - beats[beats.length - 2] - P) > 0.15 * P) beats.pop();
    }
    // Extend the grid through audible regions the tracker trimmed.
    const periodS = grid ? grid.period : period / FPS;
    // "Audible" = within 40 dB of the 98th-percentile frame power.
    const audible = percentile(pRms, ENV_PCT) * 1e-4;
    let tOn = 0, tOff = duration;
    for (let i = 0; i < n; i++)
      if (pRms[i] > audible) {
        tOn = i / FPS;
        break;
      }
    for (let i = n - 1; i >= 0; i--)
      if (pRms[i] > audible) {
        tOff = i / FPS;
        break;
      }
    if (beats.length) {
      const pre = [];
      for (let t = beats[0] - periodS; t >= Math.max(0, tOn - 0.05); t -= periodS) pre.push(t);
      const post = [];
      for (let t = beats[beats.length - 1] + periodS; t <= Math.min(duration, tOff); t += periodS) post.push(t);
      beats = pre.reverse().concat(beats, post);
    }
    beats = beats.map(r3);
    lap('beats');
    report(0.9);
    await yieldNow();

    // 6. Downbeats.
    const bpb = 4;
    const dbInfo = findDownbeatPhase(beats, bpb, { fps: FPS, n, lowLog, lowFlux, flux, chroma });
    const downbeatPhase = dbInfo.phase;
    const downbeats = beats.filter((_, i) => mod(i - downbeatPhase, bpb) === 0);
    lap('downbeats');
    report(0.93);
    await yieldNow();

    // 7. Sections.
    const energy = new Float32Array(n);
    for (let i = 0; i < n; i++) energy[i] = 0.4 * rms[i] + 0.2 * low[i] + 0.2 * mid[i] + 0.2 * high[i];
    const segDebug = opts.debug ? {} : null;
    const sections = computeSections({ downbeats, barLen: periodS * bpb }, duration, {
      fps: FPS, n, chroma, timbre, nTimbre: nT, energy, env: [rms, low, mid, high, fluxEnv], debug: segDebug,
    });

    lap('sections');
    const features = {
      duration,
      sampleRate: sr0,
      fps: FPS,
      length: n,
      rms, low, mid, high, flux: fluxEnv,
      onsets, kicks,
      bpm: Math.round(bpm * 100) / 100,
      beatsPerBar: bpb,
      beats, downbeats,
      downbeatPhase,
      sections,
      novelty: nov.data,
      noveltyHop: nov.hop,
      source: 'computed',
      presetId: null,
      presetOffset: 0,
      presetConfidence: 0,
      analysisMs: Math.round(clock() - t0),
      // Diagnostics (not part of the contract; may change).
      debug: {
        stageMs,
        analysisRate: sr,
        tempoPeriodFrames: r3(est.period),
        downbeatScores: dbInfo.scores.map(r3),
        downbeatParts: opts.debug ? dbInfo.parts : undefined,
        segmentation: segDebug || undefined,
      },
    };
    report(1);
    return features;
  }

  /* ------------------------------------------------------------------ */
  /* Lookups (pure; safe in render paths)                                */
  /* ------------------------------------------------------------------ */
  function rateOf(features, name) {
    return name === 'novelty' ? 1 / (features.noveltyHop || NOVELTY_HOP) : features.fps || FPS;
  }

  /**
   * Linearly interpolated envelope value at time t (0 outside the signal).
   * @param {object} features @param {string} name 'rms'|'low'|'mid'|'high'|'flux'|'novelty' @param {number} t seconds
   */
  function sample(features, name, t) {
    if (!features) return 0;
    const arr = features[name];
    if (!arr || !arr.length) return 0;
    const x = t * rateOf(features, name);
    if (!(x >= 0) || x > arr.length - 1) return 0;
    const i = Math.floor(x), f = x - i;
    return i + 1 < arr.length ? arr[i] + (arr[i + 1] - arr[i]) * f : arr[i];
  }

  const prefixCache = new WeakMap();
  function prefixOf(arr) {
    let p = prefixCache.get(arr);
    if (!p) {
      p = new Float64Array(arr.length + 1);
      for (let i = 0; i < arr.length; i++) p[i + 1] = p[i] + arr[i];
      prefixCache.set(arr, p);
    }
    return p;
  }

  /**
   * Mean of an envelope over [t0, t1] (prefix sums; frames outside count as 0).
   */
  function avg(features, name, t0, t1) {
    if (!features) return 0;
    const arr = features[name];
    if (!arr || !arr.length) return 0;
    if (t1 < t0) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    const rate = rateOf(features, name);
    if ((t1 - t0) * rate < 1e-3) return sample(features, name, t0);
    const P = prefixOf(arr), n = arr.length;
    // Frame i covers [i-0.5, i+0.5) in frame units.
    const C = (x) => {
      x += 0.5;
      if (x <= 0) return 0;
      if (x >= n) return P[n];
      const i = Math.floor(x);
      return P[i] + (x - i) * arr[i];
    };
    return (C(t1 * rate) - C(t0 * rate)) / ((t1 - t0) * rate);
  }

  const phaseCache = new WeakMap();
  function downbeatPhaseOf(features) {
    if (typeof features.downbeatPhase === 'number') return features.downbeatPhase;
    const beats = features.beats || [], down = features.downbeats || [];
    if (!beats.length || !down.length) return 0;
    const key = beats;
    let ph = phaseCache.get(key);
    if (ph == null) {
      let i = lowerIndex(beats, down[0] + 0.02);
      if (i < 0) i = 0;
      ph = mod(i, features.beatsPerBar || 4);
      phaseCache.set(key, ph);
    }
    return ph;
  }

  function beatTime(beats, k, defPeriod) {
    const n = beats.length;
    if (n === 0) return k * defPeriod;
    if (n === 1) return beats[0] + k * defPeriod;
    if (k < 0) return beats[0] + k * (beats[1] - beats[0]);
    if (k >= n) return beats[n - 1] + (k - n + 1) * (beats[n - 1] - beats[n - 2]);
    return beats[k];
  }

  /**
   * Beat clock at time t (env.beat shape). Extrapolates the grid before the
   * first and after the last beat.
   */
  function beatInfo(features, t) {
    const f = features || {};
    const beats = f.beats || [];
    const bpb = f.beatsPerBar || 4;
    const defPeriod = 60 / (f.bpm || 120);
    const n = beats.length;
    let index, t0, period;
    if (n < 2) {
      const base = n ? beats[0] : 0;
      period = defPeriod;
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
    if (!(period > 1e-3)) period = defPeriod;
    const dbp = downbeatPhaseOf(f);
    const sinceBeat = Math.max(0, t - t0);
    const phase = clamp(sinceBeat / period, 0, 0.999999);
    const beatInBar = mod(index - dbp, bpb);
    const bar = Math.floor((index - dbp) / bpb);
    const tDown = beatTime(beats, index - beatInBar, defPeriod);
    const sinceDownbeat = Math.max(0, t - tDown);
    return {
      index,
      phase,
      period,
      bar,
      barPhase: (beatInBar + phase) / bpb,
      beatInBar,
      sinceBeat,
      sinceDownbeat,
      pulse: pulse(sinceBeat, 0.35),
      barPulse: pulse(sinceDownbeat, 0.6),
      beatTime: t0,
      nextBeat: t0 + period,
      downbeatTime: tDown,
    };
  }

  /**
   * Section containing t (clamped to the first / last section).
   * @returns {{section:object,index:number}|null}
   */
  function sectionAt(features, t) {
    const S = features && features.sections;
    if (!S || !S.length) return null;
    let i = lowerIndex(S, t, (s) => s.start);
    if (i < 0) i = 0;
    return { section: S[i], index: i };
  }

  /* ------------------------------------------------------------------ */
  /* Presets                                                             */
  /* ------------------------------------------------------------------ */
  /**
   * refEnvelope-compatible novelty curve of an AudioBuffer (hop 0.05 s).
   * @returns {Float32Array}
   */
  function novelty(buffer) {
    const sr = buffer.sampleRate || 44100;
    return noveltyFrom(channelsOf(buffer), sr, buffer.length || 0).data;
  }

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const B64L = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) B64L[B64.charCodeAt(i)] = i;
  function b64decode(s) {
    s = String(s || '').replace(/[^A-Za-z0-9+/]/g, '');
    const out = new Uint8Array(Math.floor((s.length * 3) / 4));
    let o = 0, acc = 0, bits = 0;
    for (let i = 0; i < s.length; i++) {
      acc = (acc << 6) | B64L[s.charCodeAt(i)];
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[o++] = (acc >> bits) & 255;
      }
    }
    return out.subarray(0, o);
  }

  const refCache = new WeakMap();
  function refOf(preset) {
    if (!preset || !preset.refEnvelope || !preset.refEnvelope.data) return null;
    let r = refCache.get(preset);
    if (!r) {
      const bytes = b64decode(preset.refEnvelope.data);
      r = new Float32Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) r[i] = bytes[i] / 255;
      refCache.set(preset, r);
    }
    return r;
  }

  function resample(a, fromHop, toHop) {
    if (!(fromHop > 0) || Math.abs(fromHop - toHop) / toHop < 1e-6) return a;
    const dur = a.length * fromHop;
    const m = Math.floor(dur / toHop);
    const out = new Float32Array(m);
    for (let j = 0; j < m; j++) {
      const x = (j * toHop) / fromHop;
      const i = Math.floor(x), f = x - i;
      out[j] = i + 1 < a.length ? a[i] + (a[i + 1] - a[i]) * f : a[Math.min(i, a.length - 1)];
    }
    return out;
  }

  // Normalised cross-correlation of pairs (a[i+lag], r[i]).
  function nccAt(a, r, lag, minOverlap) {
    const i0 = Math.max(0, -lag), i1 = Math.min(r.length, a.length - lag);
    const cnt = i1 - i0;
    if (cnt < minOverlap || cnt < 8) return 0;
    let sa = 0, sr = 0, saa = 0, srr = 0, sar = 0;
    for (let i = i0; i < i1; i++) {
      const x = a[i + lag], y = r[i];
      sa += x;
      sr += y;
      saa += x * x;
      srr += y * y;
      sar += x * y;
    }
    const cov = sar - (sa * sr) / cnt, va = saa - (sa * sa) / cnt, vr = srr - (sr * sr) / cnt;
    return va > 1e-12 && vr > 1e-12 ? cov / Math.sqrt(va * vr) : 0;
  }

  /**
   * Raw alignment of features.novelty against one preset's refEnvelope over
   * offsets ±20 s (no acceptance test). audioTime = presetTime + offset.
   * @returns {{offset:number,confidence:number,durationMatch:boolean}|null}
   */
  function correlatePreset(features, preset, opts = {}) {
    const r = refOf(preset);
    if (!features || !features.novelty || !features.novelty.length || !r) return null;
    const hop = preset.refEnvelope.hop || NOVELTY_HOP;
    const a = resample(features.novelty, features.noveltyHop || hop, hop);
    const maxLag = Math.round((opts.range || 20) / hop);
    // Require ≥ 20 s of overlap (short clips cannot be aligned reliably).
    const minOverlap = Math.round(MATCH_MIN_OVERLAP / hop);
    if (a.length < minOverlap || r.length < minOverlap) return null;
    const cs = new Float64Array(2 * maxLag + 1);
    let bestK = maxLag, bestC = -Infinity;
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      const c = nccAt(a, r, lag, minOverlap);
      cs[lag + maxLag] = c;
      if (c > bestC) {
        bestC = c;
        bestK = lag + maxLag;
      }
    }
    // Peak margin: best NCC minus the best value farther than 1 s away.
    const excl = Math.round(1 / hop);
    let second = 0;
    for (let k = 0; k < cs.length; k++) if (Math.abs(k - bestK) > excl && cs[k] > second) second = cs[k];
    let frac = 0;
    if (bestK > 0 && bestK < cs.length - 1) {
      const y0 = cs[bestK - 1], y1 = cs[bestK], y2 = cs[bestK + 1];
      const den = y0 - 2 * y1 + y2;
      if (den < 0) frac = clamp((0.5 * (y0 - y2)) / den, -0.5, 0.5);
    }
    const offset = (bestK - maxLag + frac) * hop;
    const m = preset.match || {};
    const durationMatch = m.duration != null && Math.abs((features.duration || 0) - m.duration) <= (m.tolerance == null ? 2 : m.tolerance);
    return { offset: r3(offset), confidence: r3(Math.max(0, bestC)), durationMatch, margin: r3(Math.max(0, bestC) - second) };
  }

  function allPresets() {
    const list = (MV.presets || []).slice();
    (MV._pendingPresets || []).forEach((p) => {
      if (p && p.id && !list.some((q) => q.id === p.id)) list.push(p);
    });
    return list;
  }

  /**
   * Find the preset whose refEnvelope matches this audio.
   * Accept when NCC ≥ 0.5, or when the duration matches and NCC ≥ 0.3.
   * @param {object} features @param {object[]} [presets] defaults to MV.presets
   * @returns {{preset:object,offset:number,confidence:number,durationMatch:boolean}|null}
   */
  function matchPreset(features, presets) {
    const list = Array.isArray(presets) ? presets : allPresets();
    let best = null;
    for (const p of list) {
      let res = null;
      try {
        res = correlatePreset(features, p);
      } catch (e) {
        res = null;
      }
      if (!res) continue;
      // Contract thresholds, plus a distinct peak (repeated sections in a
      // short excerpt can otherwise produce a plausible-looking wrong lag).
      const ok = (res.confidence >= 0.5 || (res.durationMatch && res.confidence >= 0.3)) && res.margin >= MATCH_MIN_MARGIN;
      if (ok && (!best || res.confidence > best.confidence)) best = Object.assign({ preset: p }, res);
    }
    return best;
  }

  /**
   * Replace the computed beat grid / sections with a preset's, shifted by
   * `offset` (audioTime = presetTime + offset). Envelopes, onsets, kicks and
   * novelty are kept. Mutates and returns `features`; the computed grid is
   * kept in features.computed (see restoreComputed).
   * @param {object} features @param {object} preset @param {number} [offset=0]
   * @param {number} [confidence] defaults to the NCC at that offset
   */
  function applyPreset(features, preset, offset = 0, confidence) {
    if (!features || !preset) return features;
    offset = Number(offset) || 0;
    const dur = features.duration || 0;
    if (!features.computed && features.source !== 'preset') {
      features.computed = {
        bpm: features.bpm, beatsPerBar: features.beatsPerBar, beats: features.beats,
        downbeats: features.downbeats, downbeatPhase: features.downbeatPhase, sections: features.sections,
      };
    }
    const bpb = preset.beatsPerBar || 4;
    // Optional preset.downbeatPhase: index (mod beatsPerBar) of the preset
    // beat that starts a bar. Default 0 → downbeats = beats[0::4].
    const pPhase = mod(preset.downbeatPhase | 0, bpb);
    const beats = [], downbeats = [];
    let firstK = -1;
    const pb = preset.beats || [];
    for (let k = 0; k < pb.length; k++) {
      const t = pb[k] + offset;
      if (t < 0 || t > dur) continue;
      if (firstK < 0) firstK = k;
      beats.push(r4(t));
      if (k % bpb === pPhase) downbeats.push(r4(t));
    }
    // Sections: shift, clip to [0, dur], make contiguous and covering.
    let secs = (preset.sections || [])
      .map((s) => {
        const c = Object.assign({}, s);
        if (Array.isArray(s.scenes)) c.scenes = s.scenes.slice();
        c.start = s.start + offset;
        c.end = s.end + offset;
        return c;
      })
      .filter((s) => s.end > 0.01 && s.start < dur - 0.01)
      .sort((a, b) => a.start - b.start);
    secs.forEach((s, i) => {
      s.start = r3(clamp(s.start, 0, dur));
      s.end = r3(clamp(s.end, 0, dur));
      if (i > 0) secs[i - 1].end = s.start;
    });
    secs = secs.filter((s) => s.end - s.start > 0.01);
    if (secs.length) {
      secs[0].start = 0;
      secs[secs.length - 1].end = r3(dur);
    } else {
      secs = [makeSection('verse', 0, dur)];
    }
    secs.forEach((s) => {
      if (!s.name) s.name = String(s.kind || 'verse').toUpperCase();
      if (!Array.isArray(s.scenes) || !s.scenes.length) s.scenes = (DEFAULT_SCENES[s.kind] || DEFAULT_SCENES.verse).slice();
      if (s.intensity == null) s.intensity = 0.5;
      s.energy = r3(energyAvg(features, s.start, s.end));
    });
    if (confidence == null) {
      const r = refOf(preset);
      if (r && features.novelty) {
        const hop = preset.refEnvelope.hop || NOVELTY_HOP;
        const a = resample(features.novelty, features.noveltyHop || hop, hop);
        confidence = Math.max(0, nccAt(a, r, Math.round(offset / hop), 1));
      } else confidence = 0;
    }
    features.bpm = preset.bpm || features.bpm;
    features.beatsPerBar = bpb;
    features.beats = beats;
    features.downbeats = downbeats;
    features.downbeatPhase = firstK < 0 ? 0 : mod(pPhase - firstK, bpb);
    features.sections = secs;
    features.source = 'preset';
    features.presetId = preset.id || null;
    features.presetOffset = r3(offset);
    features.presetConfidence = r3(confidence);
    return features;
  }

  // Section energy (same composite as computed sections).
  function energyAvg(features, a, b) {
    return 0.4 * avg(features, 'rms', a, b) + 0.2 * avg(features, 'low', a, b) + 0.2 * avg(features, 'mid', a, b) + 0.2 * avg(features, 'high', a, b);
  }

  /** Undo applyPreset: restore the computed grid / sections. Returns features. */
  function restoreComputed(features) {
    if (!features || !features.computed) return features;
    Object.assign(features, features.computed);
    features.source = 'computed';
    features.presetId = null;
    features.presetOffset = 0;
    features.presetConfidence = 0;
    return features;
  }

  // Load-order safety: data/*.js presets loaded after core.js only land in
  // MV._pendingPresets; register them so MV.presets is complete.
  if (typeof MV.registerPreset === 'function' && Array.isArray(MV._pendingPresets)) {
    MV._pendingPresets.forEach((p) => {
      if (p && p.id && !(MV.presets || []).some((q) => q.id === p.id)) MV.registerPreset(p);
    });
  }

  MV.Analysis = {
    compute,
    sample,
    avg,
    beatInfo,
    sectionAt,
    novelty,
    matchPreset,
    correlatePreset,
    applyPreset,
    restoreComputed,
    DEFAULT_SCENES,
    FPS,
    // exposed for tests / tools
    _internal: { findDownbeatPhase, makeFFT, noveltyFrom, dpBeats, fitGrid, estimatePeriod, percentile, b64decode, nccAt },
  };
})();

/*
 * MV.Exporter — offline MP4 export (docs/ARCHITECTURE.md §3.10).
 *
 *   const caps = await MV.Exporter.capabilities();
 *   // → { webcodecs, h264, vp9, av1, aac, opus, mediaRecorder, muxer, audioEncoder,
 *   //     codecs: { h264, vp9, av1, aac, opus }, mediaRecorderMime, preferred }
 *   const ex = new MV.Exporter({
 *     director, audioBuffer, width: 1920, height: 1080, fps: 30,
 *     range: [t0, t1],            // song seconds (default: whole song); frames = round((t1-t0)·fps)
 *     videoBitrate,               // default: 12 Mbps @1080p30, 16 @1080p60, 6 @720p30 (scaled by pixels)
 *     onProgress(p, info) {},     // p 0..1; info = { frame, frames, fpsRendered, etaSeconds, phase, elapsed, codec }
 *                                 // phase: prepare → audio → render → finalize → done ('record' when realtime)
 *     stageFactory(canvas, o) {}, // optional (may be async): Stage-like { canvas?, setDirector?, prepare?, renderFrame, dispose? }
 *                                 // o = { width, height, fps, scale }
 *     title,                      // filename stem (default: director title, else 'mv')
 *     method: 'auto',             // 'auto' | 'webcodecs' | 'mediarecorder'
 *     videoCodec: 'auto',         // 'auto' | 'h264' | 'vp9' | 'av1'
 *     audioCodec: 'auto',         // 'auto' | 'aac' | 'opus' | 'none'
 *     mux: 'auto',                // 'auto' | 'in-memory' | 'stream'
 *     keyframeInterval: 2,        // seconds
 *     monitor: false,             // realtime fallback only: also play the audio aloud
 *   });
 *   const res = await ex.run();   // call run() from the click handler (see below)
 *   // res = { blob, filename, mime, codec, videoCodec, audioCodec, method, container, mux,
 *   //         width, height, fps, frames, duration, range, bytes, elapsed, fpsRendered,
 *   //         videoChunks, audioChunks, keyFrames, colorSpace, warnings[], stageErrors[] }
 *   ex.cancel();                  // run() rejects with an AbortError (DOMException)
 *   MV.Exporter.download(res);    // convenience: save the blob via <a download>
 *   MV.Exporter.filename(title, w, h, fps, ext) / MV.Exporter.defaultBitrate(w, h, fps)
 *
 * WebCodecs path (preferred): renders every frame on its OWN offscreen Stage
 * (the live preview is never touched), frame i at song time t0 + i / fps, so
 * the output is a pure function of the Director + range (deterministic, no
 * frame drops). Frames → VideoEncoder (key frame every 2 s, back-pressure on
 * encodeQueueSize), audio slice → AudioEncoder in 4096-frame f32-planar
 * chunks (Opus always at 48 kHz; AAC at 44.1/48 kHz; resampled with an
 * OfflineAudioContext when needed), both muxed by vendor/mp4-muxer.js into a
 * fast-start MP4 (moov before mdat). Codec order: H.264 + AAC → H.264 + Opus
 * → VP9 + Opus (→ AV1 + Opus as a last resort). Short clips mux 'in-memory';
 * long ones (> ~128 MB estimated) stream into a list of parts with the moov
 * space reserved up front (same fast-start layout, about half the peak RAM).
 * Encoder setup failures (reported asynchronously by WebCodecs) before the
 * first encoded chunk walk a retry ladder: same codec software-only, next
 * profile, next codec (at most 2 attempts per codec), then — in 'auto' mode —
 * realtime capture. A Web Lock is held while exporting so Chrome does not
 * freeze the tab in the background; frames are yielded with MessageChannel
 * (not throttled in background tabs).
 *
 * Fallback (no WebCodecs / no usable encoder / no audio encoder, or method:
 * 'mediarecorder'): realtime capture — own AudioContext +
 * AudioBufferSourceNode → MediaStreamAudioDestinationNode, a 2D copy of the
 * stage canvas → captureStream(fps), rendering driven by requestAnimationFrame
 * on the audio clock (wall clock if the AudioContext stalls). Output is MP4
 * when the browser can record H.264 + AAC, otherwise WebM (Duration element
 * patched in so players can seek). The tab must stay visible. run() creates
 * that AudioContext synchronously when this path is likely, so call run()
 * directly inside the user's click handler (Safari's autoplay rule).
 *
 * Wall-clock reads (performance.now) are used only to measure progress / ETA
 * and to drive the realtime fallback; every rendered frame is still
 * stage.renderFrame(t) with t derived from the frame index or audio clock.
 */
(function () {
  'use strict';

  const MV = (window.MV = window.MV || {});
  const LW = MV.W || 1920;
  const LH = MV.H || 1080;

  // Measurement only (progress fps / ETA, realtime fallback clock).
  const clock = typeof performance !== 'undefined' && performance.now ? performance.now.bind(performance) : () => 0;

  const AUDIO_CHUNK = 4096; //          frames per AudioData
  const MAX_VIDEO_QUEUE = 6; //         VideoEncoder back-pressure threshold
  const MAX_AUDIO_QUEUE = 48;
  const STREAM_THRESHOLD = 128 * 1024 * 1024; // estimated bytes above which we stream-mux
  const PROGRESS_MS = 90; //            onProgress throttle (wall clock)

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */
  const fin = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const even = (x) => Math.max(2, Math.round(x / 2) * 2);
  const uniq = (arr) => arr.filter((x, i) => arr.indexOf(x) === i);
  const hex2 = (n) => ('0' + n.toString(16)).slice(-2);

  function abortError() {
    const msg = '导出已取消 Export cancelled';
    try {
      return new DOMException(msg, 'AbortError');
    } catch (e) {
      const err = new Error(msg);
      err.name = 'AbortError';
      return err;
    }
  }
  const isAbort = (e) => !!e && e.name === 'AbortError';
  const asError = (e) => (e instanceof Error ? e : new Error(String((e && e.message) || e || 'unknown error')));

  // Macrotask yield that is not throttled in background tabs (unlike
  // setTimeout), so a long export keeps going when the user switches tabs.
  const yieldNow = (function () {
    if (typeof MessageChannel === 'undefined') return () => new Promise((r) => setTimeout(r, 0));
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
  })();

  // Resolve on the encoder's next 'dequeue' event (or after `ms`).
  function waitDequeue(enc, ms) {
    return new Promise((resolve) => {
      let done = false;
      let timer = 0;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          enc.removeEventListener('dequeue', finish);
        } catch (e) { /* old implementation */ }
        resolve();
      };
      try {
        enc.addEventListener('dequeue', finish);
      } catch (e) { /* no EventTarget: timeout only */ }
      timer = setTimeout(finish, ms || 25);
    });
  }

  // Hold a Web Lock for the duration of an export: Chrome does not freeze
  // background tabs that hold one, so a long export survives a tab switch.
  // Resolves to a release function (a no-op when Web Locks are unavailable).
  let lockSeq = 0;
  function holdWebLock() {
    const locks = typeof navigator !== 'undefined' && navigator.locks;
    if (!locks || typeof locks.request !== 'function') return Promise.resolve(() => {});
    return new Promise((resolve) => {
      let release = null;
      const held = new Promise((r) => (release = r));
      const done = (fn) => resolve(fn);
      const timer = setTimeout(() => done(() => release && release()), 250);
      try {
        locks
          .request('mv-export-' + ++lockSeq, () => {
            clearTimeout(timer);
            done(() => release());
            return held;
          })
          .catch(() => done(() => {}));
      } catch (e) {
        clearTimeout(timer);
        done(() => {});
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Codec candidates                                                    */
  /* ------------------------------------------------------------------ */
  // H.264 levels: [level_idc, MaxFS (macroblocks), MaxMBPS].
  const AVC_LEVELS = [
    [0x1e, 1620, 40500], [0x1f, 3600, 108000], [0x20, 5120, 216000], [0x28, 8192, 245760],
    [0x2a, 8704, 522240], [0x32, 22080, 589824], [0x33, 36864, 983040], [0x34, 36864, 2073600],
  ];
  function avcLevel(w, h, fps) {
    const mbw = Math.ceil(w / 16), mbh = Math.ceil(h / 16), fs = mbw * mbh;
    for (const [lv, maxFs, maxMbps] of AVC_LEVELS) {
      if (fs <= maxFs && fs * fps <= maxMbps && Math.max(mbw, mbh) ** 2 <= 8 * maxFs) return Math.max(lv, 0x28);
    }
    return 0x34;
  }
  function codecCandidates(kind, w, h, fps) {
    if (kind === 'h264') {
      const lv = hex2(avcLevel(w, h, fps));
      // High → Main → Constrained Baseline at the needed level, then the common 4.0 strings.
      return uniq(['avc1.6400' + lv, 'avc1.4d00' + lv, 'avc1.42e0' + lv, 'avc1.640028', 'avc1.4d0028', 'avc1.42e028']);
    }
    const px = w * h, rate = px * fps;
    if (kind === 'vp9') {
      const lv = px <= 2228224 && rate <= 83558400 ? '40' : px <= 2228224 && rate <= 160432128 ? '41'
        : px <= 8912896 && rate <= 311951360 ? '50' : px <= 8912896 && rate <= 588251136 ? '51' : '61';
      return uniq(['vp09.00.' + lv + '.08', 'vp09.00.40.08', 'vp09.00.10.08']);
    }
    if (kind === 'av1') {
      const lv = px <= 2228224 && rate <= 133693440 ? '08' : px <= 8912896 && rate <= 267386880 ? '12' : '13';
      return uniq(['av01.0.' + lv + 'M.08', 'av01.0.08M.08', 'av01.0.04M.08']);
    }
    return [];
  }
  const MUX_VIDEO = { h264: 'avc', vp9: 'vp9', av1: 'av1' };

  // Config variants per codec: any encoder (hardware first), software only,
  // then the bare config for UAs that reject the optional members.
  function videoConfigs(codec, w, h, fps, bitrate) {
    const base = { codec, width: w, height: h, bitrate: Math.round(bitrate), framerate: fps };
    if (codec.startsWith('avc1')) base.avc = { format: 'avc' };
    const q = { latencyMode: 'quality', bitrateMode: 'variable' };
    return [
      Object.assign({}, base, q, { hardwareAcceleration: 'no-preference' }),
      Object.assign({}, base, q, { hardwareAcceleration: 'prefer-software' }),
      base,
    ];
  }
  // Identity of a config for the retry-exclusion set.
  const videoKey = (cfg) => 'v:' + cfg.codec + '|' + (cfg.hardwareAcceleration || 'no-preference');
  const audioKey = (cfg) => 'a:' + cfg.codec + '|' + cfg.sampleRate;

  async function probeVideo(kind, w, h, fps, bitrate, exclude) {
    if (typeof VideoEncoder === 'undefined' || !VideoEncoder.isConfigSupported) return null;
    for (const codec of codecCandidates(kind, w, h, fps)) {
      for (const cfg of videoConfigs(codec, w, h, fps, bitrate)) {
        const key = videoKey(cfg);
        if (exclude && exclude.has(key)) continue;
        try {
          const s = await VideoEncoder.isConfigSupported(cfg);
          if (s && s.supported) return { kind, codec, mux: MUX_VIDEO[kind], config: cfg, key };
        } catch (e) { /* invalid for this UA — next */ }
      }
    }
    return null;
  }

  function audioConfigs(kind, sampleRate, channels, bitrate) {
    const base = { codec: kind === 'aac' ? 'mp4a.40.2' : 'opus', sampleRate, numberOfChannels: channels, bitrate: Math.round(bitrate) };
    const extra = kind === 'aac' ? { aac: { format: 'aac' } } : { opus: { format: 'opus', frameDuration: 20000 } };
    return [Object.assign({}, base, extra), base];
  }

  async function probeAudio(kind, sampleRate, channels, bitrate, exclude) {
    if (typeof AudioEncoder === 'undefined' || !AudioEncoder.isConfigSupported) return null;
    for (const cfg of audioConfigs(kind, sampleRate, channels, bitrate)) {
      const key = audioKey(cfg);
      if (exclude && exclude.has(key)) continue;
      try {
        const s = await AudioEncoder.isConfigSupported(cfg);
        if (s && s.supported) return { kind, codec: cfg.codec, mux: kind, sampleRate, channels, bitrate: cfg.bitrate, config: cfg, key };
      } catch (e) { /* next */ }
    }
    return null;
  }

  function audioBitrate(kind, channels) {
    if (kind === 'aac') return channels > 1 ? 192000 : 128000;
    return channels > 1 ? 160000 : 96000;
  }

  // Pick the audio encoder: AAC at the source rate when it is 44.1/48 kHz,
  // else 48 kHz; Opus always at 48 kHz (its native rate).
  async function pickAudio(pref, videoKind, srcRate, channels, exclude) {
    const order = pref === 'aac' ? ['aac'] : pref === 'opus' ? ['opus']
      : videoKind === 'h264' ? ['aac', 'opus'] : ['opus', 'aac'];
    for (const kind of order) {
      const rates = kind === 'aac' && (srcRate === 44100 || srcRate === 48000) ? uniq([srcRate, 48000]) : [48000];
      for (const rate of rates) {
        const a = await probeAudio(kind, rate, channels, audioBitrate(kind, channels), exclude);
        if (a) return a;
      }
    }
    return null;
  }

  async function pickVideo(pref, w, h, fps, bitrate, exclude) {
    const order = pref === 'h264' || pref === 'vp9' || pref === 'av1' ? [pref] : ['h264', 'vp9', 'av1'];
    for (const kind of order) {
      if (exclude && exclude.has('k:' + kind)) continue;
      const v = await probeVideo(kind, w, h, fps, bitrate, exclude);
      if (v) return v;
    }
    return null;
  }

  const REC_MIMES = [
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  function pickRecorderMime() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    for (const m of REC_MIMES) {
      try {
        if (MediaRecorder.isTypeSupported(m)) return m;
      } catch (e) { /* next */ }
    }
    return '';
  }

  // AudioContext for the realtime fallback. Created synchronously inside the
  // caller's user gesture when possible (Safari only starts it then).
  function makeAudioContext() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC();
      if (ctx.state !== 'running' && ctx.resume) ctx.resume().catch(() => null);
      return ctx;
    } catch (e) {
      return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Audio preparation                                                   */
  /* ------------------------------------------------------------------ */
  /**
   * Slice [t0, t0+dur) of `buffer` at `rate` Hz / `channels` channels.
   * Returns { sampleRate, channels, length, read(c, pos, n, out) } — reads
   * past the source are zero-filled. No copy when the rate/channels match.
   */
  async function preparePcm(buffer, t0, dur, rate, channels) {
    const length = Math.max(1, Math.round(dur * rate));
    let planes = [];
    let offset = 0;
    const srcCh = buffer.numberOfChannels;
    if (buffer.sampleRate === rate && srcCh === channels) {
      for (let c = 0; c < channels; c++) planes.push(buffer.getChannelData(c));
      offset = Math.round(t0 * rate);
    } else if (t0 < buffer.duration) {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OAC) throw new Error('OfflineAudioContext unavailable — cannot resample audio');
      const oac = new OAC(channels, length, rate);
      const src = oac.createBufferSource();
      src.buffer = buffer;
      src.connect(oac.destination);
      src.start(0, t0, Math.max(0, Math.min(dur, buffer.duration - t0)));
      const out = await oac.startRendering();
      for (let c = 0; c < channels; c++) planes.push(out.getChannelData(c));
    } else {
      planes = [];
    }
    return {
      sampleRate: rate,
      channels,
      length,
      read(c, pos, n, out) {
        const plane = planes[c] || planes[0];
        out.fill(0);
        if (!plane) return;
        const s0 = offset + pos;
        const a = Math.max(0, s0), b = Math.min(plane.length, s0 + n);
        if (b > a) out.set(plane.subarray(a, b), a - s0);
      },
    };
  }

  // Encode PCM frames [pos, upTo) in AUDIO_CHUNK pieces (only whole chunks
  // unless upTo is the end). Returns the new position.
  function feedAudio(enc, pcm, pos, upTo) {
    const ch = pcm.channels;
    while (pos < upTo) {
      const n = Math.min(AUDIO_CHUNK, pcm.length - pos);
      if (n <= 0 || (pos + n > upTo && upTo < pcm.length)) break;
      const data = new Float32Array(n * ch);
      for (let c = 0; c < ch; c++) pcm.read(c, pos, n, data.subarray(c * n, (c + 1) * n));
      const ad = new AudioData({
        format: 'f32-planar', sampleRate: pcm.sampleRate, numberOfFrames: n, numberOfChannels: ch,
        timestamp: Math.round((pos * 1e6) / pcm.sampleRate), data,
      });
      try {
        enc.encode(ad);
      } finally {
        ad.close();
      }
      pos += n;
    }
    return pos;
  }

  /* ------------------------------------------------------------------ */
  /* Mux output sink for streaming mode                                  */
  /* ------------------------------------------------------------------ */
  // Collects (data, position) writes from Mp4Muxer.StreamTarget. Parts never
  // overlap: a later write into an existing range patches it in place.
  function makeSink() {
    const parts = [];
    let size = 0;
    return {
      write(data, pos) {
        const end = pos + data.byteLength;
        if (pos >= size) {
          parts.push({ pos, data });
          size = end;
          return;
        }
        const covered = [];
        for (const p of parts) {
          const a = Math.max(pos, p.pos), b = Math.min(end, p.pos + p.data.byteLength);
          if (a < b) {
            p.data.set(data.subarray(a - pos, b - pos), a - p.pos);
            covered.push([a, b]);
          }
        }
        covered.sort((x, y) => x[0] - y[0]);
        let at = pos;
        for (const [a, b] of covered) {
          if (a > at) parts.push({ pos: at, data: data.slice(at - pos, a - pos) });
          at = Math.max(at, b);
        }
        if (at < end) parts.push({ pos: at, data: data.slice(at - pos) });
        size = Math.max(size, end);
      },
      toBlob(type) {
        parts.sort((a, b) => a.pos - b.pos);
        const out = [];
        let at = 0;
        for (const p of parts) {
          if (p.pos > at) out.push(new Uint8Array(p.pos - at));
          out.push(p.data);
          at = p.pos + p.data.byteLength;
        }
        parts.length = 0;
        return new Blob(out, { type });
      },
      get size() {
        return size;
      },
    };
  }

  // Mp4Muxer requires colorSpace for VP9 and only maps a few enum values.
  const COLR_OK = {
    primaries: ['bt709', 'bt470bg', 'smpte170m'],
    transfer: ['bt709', 'smpte170m', 'iec61966-2-1'],
    matrix: ['rgb', 'bt709', 'bt470bg', 'smpte170m'],
  };
  function fixVideoMeta(meta) {
    if (!meta || !meta.decoderConfig) return meta;
    const dc = Object.assign({}, meta.decoderConfig);
    const cs = Object.assign({}, dc.colorSpace || {});
    for (const k of Object.keys(COLR_OK)) if (COLR_OK[k].indexOf(cs[k]) < 0) cs[k] = 'bt709';
    cs.fullRange = !!cs.fullRange;
    dc.colorSpace = cs;
    return Object.assign({}, meta, { decoderConfig: dc });
  }

  /* ------------------------------------------------------------------ */
  /* WebM duration patch (MediaRecorder output has no Duration element)  */
  /* ------------------------------------------------------------------ */
  function readVint(b, p, isId) {
    const first = b[p];
    if (first === undefined || first === 0) return null;
    let len = 1;
    while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
    if (len > 8 || p + len > b.length) return null;
    let value = isId ? first : first & (0xff >> len);
    let allOnes = value === 0xff >> len;
    for (let i = 1; i < len; i++) {
      value = value * 256 + b[p + i];
      if (b[p + i] !== 0xff) allOnes = false;
    }
    return { len, value, unknown: !isId && allOnes };
  }

  /**
   * Insert/overwrite Segment › Info › Duration in a WebM blob.
   * Returns the original blob when the layout is not recognised.
   */
  async function fixWebmDuration(blob, durationMs) {
    try {
      const head = new Uint8Array(await blob.slice(0, Math.min(blob.size, 256 * 1024)).arrayBuffer());
      const ebml = readVint(head, 0, true);
      if (!ebml || ebml.value !== 0x1a45dfa3) return blob;
      const ebmlSize = readVint(head, ebml.len, false);
      let p = ebml.len + ebmlSize.len + ebmlSize.value;
      const seg = readVint(head, p, true);
      if (!seg || seg.value !== 0x18538067) return blob;
      const segSize = readVint(head, p + seg.len, false);
      const segSizePos = p + seg.len;
      let q = segSizePos + segSize.len;
      while (q < head.length - 8) {
        const id = readVint(head, q, true);
        const sz = id && readVint(head, q + id.len, false);
        if (!id || !sz || sz.unknown) return blob;
        const dataStart = q + id.len + sz.len, dataEnd = dataStart + sz.value;
        if (id.value !== 0x1549a966) {
          q = dataEnd;
          continue;
        }
        if (dataEnd > head.length) return blob;
        let scale = 1e6;
        let r = dataStart;
        let durAt = -1, durLen = 0;
        while (r < dataEnd) {
          const cid = readVint(head, r, true);
          const cs = cid && readVint(head, r + cid.len, false);
          if (!cid || !cs) return blob;
          const cd = r + cid.len + cs.len;
          if (cid.value === 0x2ad7b1) {
            scale = 0;
            for (let i = 0; i < cs.value; i++) scale = scale * 256 + head[cd + i];
            scale = scale || 1e6;
          } else if (cid.value === 0x4489) {
            durAt = cd;
            durLen = cs.value;
          }
          r = cd + cs.value;
        }
        const durVal = (durationMs * 1e6) / scale;
        if (durAt >= 0 && (durLen === 8 || durLen === 4)) {
          const patched = head.slice(0, dataEnd);
          const dv = new DataView(patched.buffer);
          if (durLen === 8) dv.setFloat64(durAt, durVal);
          else dv.setFloat32(durAt, durVal);
          return new Blob([patched, blob.slice(dataEnd)], { type: blob.type });
        }
        const durEl = new Uint8Array(11);
        durEl[0] = 0x44;
        durEl[1] = 0x89;
        durEl[2] = 0x88;
        new DataView(durEl.buffer).setFloat64(3, durVal);
        const newSize = sz.value + durEl.length;
        const sizeBytes = new Uint8Array(8);
        sizeBytes[0] = 0x01;
        let v = newSize;
        for (let i = 7; i >= 1; i--) {
          sizeBytes[i] = v % 256;
          v = Math.floor(v / 256);
        }
        const pre = head.slice(0, q + id.len);
        if (!segSize.unknown) {
          // Grow the known Segment size by the bytes we add (same vint width).
          const delta = sizeBytes.length - sz.len + durEl.length;
          let nv = segSize.value + delta;
          if (nv >= Math.pow(2, 7 * segSize.len) - 1) return blob;
          for (let i = segSize.len - 1; i >= 0; i--) {
            pre[segSizePos + i] = nv % 256;
            nv = Math.floor(nv / 256);
          }
          pre[segSizePos] |= 0x80 >> (segSize.len - 1);
        }
        return new Blob([pre, sizeBytes, head.slice(dataStart, dataEnd), durEl, blob.slice(dataEnd)], { type: blob.type });
      }
    } catch (e) {
      return blob;
    }
    return blob;
  }

  /* ------------------------------------------------------------------ */
  /* Exporter                                                            */
  /* ------------------------------------------------------------------ */
  function songDuration(director, buffer) {
    if (buffer && buffer.duration > 0) return buffer.duration;
    if (director) {
      if (fin(director.duration, 0) > 0) return director.duration;
      if (director.features && fin(director.features.duration, 0) > 0) return director.features.duration;
      if (director.hudInfo && fin(director.hudInfo.duration, 0) > 0) return director.hudInfo.duration;
    }
    return 10;
  }

  function directorTitle(director) {
    if (!director) return '';
    try {
      if (director.hudInfo && director.hudInfo.title) return director.hudInfo.title;
      if (director.preset && director.preset.meta) return director.preset.meta.title || director.preset.meta.titleLatin || '';
    } catch (e) { /* ignore */ }
    return '';
  }

  /**
   * @param {object} opts see file header
   */
  function Exporter(opts) {
    opts = opts || {};
    this.opts = opts;
    this.director = opts.director || null;
    this.audioBuffer = opts.audioBuffer || null;
    this.width = even(clamp(fin(opts.width, 1920), 2, 7680));
    this.height = even(clamp(fin(opts.height, Math.round((this.width * 9) / 16)), 2, 4320));
    this.fps = clamp(Math.round(fin(opts.fps, 30)), 1, 120);
    const total = songDuration(this.director, this.audioBuffer);
    const r = Array.isArray(opts.range) ? opts.range : [0, total];
    const t0 = Math.max(0, fin(r[0], 0));
    let t1 = fin(r[1], total);
    if (!(t1 > t0)) t1 = t0 + 1 / this.fps;
    this.frames = Math.max(1, Math.round((t1 - t0) * this.fps));
    this.range = [t0, t0 + this.frames / this.fps];
    this.videoBitrate = fin(opts.videoBitrate, 0) > 0 ? opts.videoBitrate : Exporter.defaultBitrate(this.width, this.height, this.fps);
    this.onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    this.stageFactory = typeof opts.stageFactory === 'function' ? opts.stageFactory : null;
    this.method = opts.method || 'auto';
    this.videoCodec = opts.videoCodec || 'auto';
    this.audioCodec = opts.audioCodec || 'auto';
    this.keyframeInterval = Math.max(0.1, fin(opts.keyframeInterval, 2));
    this.mux = opts.mux || 'auto'; // 'auto' | 'in-memory' | 'stream'
    this.title = opts.title != null ? String(opts.title) : directorTitle(this.director) || 'mv';
    this.state = 'idle'; //  idle | running | done | cancelled | error
    this.warnings = [];
    this.frame = 0;
    this._cancelled = false;
    this._run = null;
    this._stage = null;
    this._canvas = null;
    this._fit = null;
    this._venc = null;
    this._aenc = null;
    this._rec = null;
    this._lastReport = -1e9;
    this._renderStart = 0;
    this._phaseName = 'idle';
    this._codec = '';
  }

  /**
   * Default video bitrate: 12 Mbps @1080p30, 16 Mbps @1080p60, 6 Mbps @720p30,
   * scaled by pixel count elsewhere.
   */
  Exporter.defaultBitrate = function (w, h, fps) {
    const px = w * h, hi = fps > 40;
    let b;
    if (px >= 1920 * 1080 * 0.9) b = (hi ? 16e6 : 12e6) * (px / (1920 * 1080));
    else if (px >= 1280 * 720 * 0.9) b = (hi ? 9e6 : 6e6) * (px / (1280 * 720));
    else b = 6e6 * (px / (1280 * 720)) * (hi ? 1.5 : 1);
    return Math.round(clamp(b, 1e6, 80e6) / 1000) * 1000;
  };

  const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
  /** Sanitised download name: <title>_<w>x<h>_<fps>fps.<ext>. */
  Exporter.filename = function (title, w, h, fps, ext) {
    let s = String(title == null ? '' : title);
    if (s.normalize) s = s.normalize('NFC');
    s = s.replace(/[\u0000-\u001f\u007f<>:"/\\|?*#%&{}$!'`@+=^~[\]]+/g, ' ')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/^[._-]+|[._-]+$/g, '');
    s = Array.from(s).slice(0, 80).join('');
    if (!s) s = 'mv';
    if (RESERVED.test(s)) s = '_' + s;
    return `${s}_${w}x${h}_${fps}fps.${ext || 'mp4'}`;
  };

  let capsPromise = null;
  /**
   * What this browser can export. Cached; pass { refresh: true } to re-probe.
   * @returns {Promise<{webcodecs:boolean,h264:boolean,vp9:boolean,av1:boolean,aac:boolean,opus:boolean,
   *   mediaRecorder:boolean, muxer:boolean, codecs:object, mediaRecorderMime:string, preferred:string}>}
   */
  Exporter.capabilities = function (o) {
    if (capsPromise && !(o && o.refresh)) return capsPromise;
    capsPromise = (async () => {
      const muxer = !!(window.Mp4Muxer && window.Mp4Muxer.Muxer);
      const ve = typeof VideoEncoder === 'function' && typeof VideoFrame === 'function';
      const ae = typeof AudioEncoder === 'function' && typeof AudioData === 'function';
      const probeAll = async (kind) => (ve ? probeVideo(kind, 1920, 1080, 30, 12e6) : null);
      const [h, v, a1, aac, opus] = await Promise.all([
        probeAll('h264'), probeAll('vp9'), probeAll('av1'),
        ae ? probeAudio('aac', 48000, 2, 192000) : null,
        ae ? probeAudio('opus', 48000, 2, 160000) : null,
      ]);
      const canvasCapture = typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
      const mediaRecorderMime = pickRecorderMime();
      const mediaRecorder = typeof MediaRecorder === 'function' && canvasCapture && !!(window.AudioContext || window.webkitAudioContext);
      const webcodecs = ve && muxer;
      const vk = h ? 'h264' : v ? 'vp9' : a1 ? 'av1' : '';
      const ak = vk === 'h264' ? (aac ? 'aac' : opus ? 'opus' : '') : opus ? 'opus' : aac ? 'aac' : '';
      return {
        webcodecs,
        h264: !!h, vp9: !!v, av1: !!a1, aac: !!aac, opus: !!opus,
        mediaRecorder,
        muxer,
        audioEncoder: ae,
        codecs: { h264: h ? h.codec : null, vp9: v ? v.codec : null, av1: a1 ? a1.codec : null, aac: aac ? aac.codec : null, opus: opus ? opus.codec : null },
        mediaRecorderMime,
        preferred: webcodecs && vk ? `webcodecs:${vk}+${ak || 'none'}` : mediaRecorder ? `mediarecorder:${mediaRecorderMime || 'default'}` : 'none',
      };
    })();
    return capsPromise;
  };

  /**
   * Save an export result through a temporary <a download> link.
   * @param {{blob:Blob, filename:string}} result
   */
  Exporter.download = function (result) {
    if (!result || !result.blob) return false;
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename || 'mv.mp4';
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 60000);
    return true;
  };

  Exporter.fixWebmDuration = fixWebmDuration;

  /**
   * Run the export (idempotent: a second call returns the same promise).
   * @returns {Promise<{blob:Blob, filename:string, mime:string, codec:string, method:string, container:string,
   *   width:number, height:number, fps:number, frames:number, duration:number, range:number[], bytes:number,
   *   elapsed:number, fpsRendered:number, mux?:string, warnings:string[], stageErrors:string[]}>}
   */
  Exporter.prototype.run = function () {
    if (!this._run) {
      // The realtime fallback needs a running AudioContext: create it now,
      // synchronously inside the caller's click, when that path is likely.
      const likelyRealtime = this.method === 'mediarecorder' || (this.method === 'auto' &&
        (typeof VideoEncoder !== 'function' || typeof AudioEncoder !== 'function' || !(window.Mp4Muxer && window.Mp4Muxer.Muxer)));
      if (likelyRealtime && this.audioBuffer && this.audioCodec !== 'none') this._actx = makeAudioContext();
      this._run = this._execute();
    }
    return this._run;
  };

  /**
   * Stop the export. run() rejects with an AbortError; encoders are closed and
   * the offscreen stage disposed. Returns false when nothing was running.
   */
  Exporter.prototype.cancel = function () {
    if (this.state === 'done' || this.state === 'error' || this.state === 'cancelled') return false;
    this._cancelled = true;
    for (const enc of [this._venc, this._aenc]) {
      try {
        if (enc && enc.state !== 'closed') enc.close();
      } catch (e) { /* ignore */ }
    }
    if (this._rec && this._rec.abort) this._rec.abort();
    return true;
  };

  Exporter.prototype._checkCancel = function () {
    if (this._cancelled) throw abortError();
  };

  Exporter.prototype._report = function (phase, p, force) {
    this._phaseName = phase;
    if (!this.onProgress) return;
    const now = clock();
    if (!force && now - this._lastReport < PROGRESS_MS) return;
    this._lastReport = now;
    const el = this._renderStart ? (now - this._renderStart) / 1000 : 0;
    const fpsRendered = this.frame > 0 && el > 0 ? this.frame / el : 0;
    const etaSeconds = fpsRendered > 0 ? (this.frames - this.frame) / fpsRendered : null;
    try {
      this.onProgress(clamp(fin(p, 0), 0, 1), {
        frame: this.frame, frames: this.frames, fpsRendered, etaSeconds, phase, elapsed: el, codec: this._codec,
      });
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[MV.Exporter] onProgress threw', e);
    }
  };

  Exporter.prototype._execute = async function () {
    this.state = 'running';
    this._t0 = clock();
    const releaseLock = await holdWebLock();
    try {
      this._checkCancel();
      this._report('prepare', 0, true);
      if (!this.director && !this.stageFactory) throw new Error('需要 Director (director is required)');
      const caps = await Exporter.capabilities();
      this._checkCancel();
      let method = this.method;
      if (method === 'auto') method = caps.webcodecs && (caps.h264 || caps.vp9 || caps.av1) ? 'webcodecs' : 'mediarecorder';
      let res;
      if (method === 'webcodecs') {
        // Setup failures (configure errors arrive asynchronously) before the
        // first encoded chunk: exclude that encoder config and try the next
        // one (software variant, next codec); when none is left, fall back to
        // realtime capture in 'auto' mode.
        const excluded = (this._excluded = new Set());
        const kindFails = {};
        let firstErr = null;
        for (;;) {
          try {
            res = await this._runWebCodecs(caps);
            break;
          } catch (e) {
            if (isAbort(e) || this._cancelled || this._started) throw e;
            this._closeEncoders();
            this._disposeStage();
            const key = this._failKey;
            this._failKey = null;
            if (key && !excluded.has(key)) {
              if (!firstErr) firstErr = asError(e);
              excluded.add(key);
              // Two failed configs of one codec kind: skip the rest of that kind.
              const kind = key.charAt(0) === 'v' ? this._vkind : null;
              if (kind && (kindFails[kind] = (kindFails[kind] || 0) + 1) >= 2) excluded.add('k:' + kind);
              this.warnings.push(`编码器初始化失败，换用下一个 (encoder setup failed: ${key.slice(2)} — ${asError(e).message})`);
              continue;
            }
            const err = firstErr || asError(e);
            if (this.method !== 'auto' || !caps.mediaRecorder) throw err;
            this.warnings.push('WebCodecs 失败，改用实时录制 (WebCodecs failed, realtime fallback): ' + err.message);
            res = await this._runRecorder();
            break;
          }
        }
      } else if (method === 'mediarecorder') {
        res = await this._runRecorder();
      } else throw new Error('Unknown export method: ' + method);
      this.state = 'done';
      this._report('done', 1, true);
      return res;
    } catch (e) {
      const err = this._cancelled ? abortError() : asError(e);
      this.state = isAbort(err) ? 'cancelled' : 'error';
      throw err;
    } finally {
      this._closeEncoders();
      this._disposeStage();
      if (this._actx) {
        try {
          this._actx.close();
        } catch (e) { /* ignore */ }
        this._actx = null;
      }
      releaseLock();
    }
  };

  /* ---------------- stage ---------------- */
  Exporter.prototype._makeStage = async function () {
    const canvas = document.createElement('canvas');
    const scale = Math.max(this.width / LW, this.height / LH);
    canvas.width = Math.round(LW * scale);
    canvas.height = Math.round(LH * scale);
    let stage;
    if (this.stageFactory) stage = await this.stageFactory(canvas, { width: this.width, height: this.height, fps: this.fps, scale });
    else if (typeof MV.Stage === 'function') stage = new MV.Stage({ canvas, scale, adaptive: false, debug: false });
    else throw new Error('MV.Stage 缺失 (MV.Stage missing)');
    if (!stage || typeof stage.renderFrame !== 'function') throw new Error('stageFactory must return a Stage-like object');
    this._stage = stage;
    this._canvas = stage.canvas || canvas;
    if (this.director && typeof stage.setDirector === 'function') stage.setDirector(this.director);
    if (typeof stage.prepare === 'function') await stage.prepare();
    this._checkCancel();
    return stage;
  };

  // The canvas holding the current frame at exactly width × height.
  Exporter.prototype._frameSource = function (forceCopy) {
    const c = this._canvas;
    if (!forceCopy && c.width === this.width && c.height === this.height) return c;
    if (!this._fit) {
      const f = document.createElement('canvas');
      f.width = this.width;
      f.height = this.height;
      this._fit = { canvas: f, ctx: f.getContext('2d', { alpha: false }) || f.getContext('2d') };
    }
    const ctx = this._fit.ctx;
    const s = Math.max(this.width / c.width, this.height / c.height);
    const dw = c.width * s, dh = c.height * s;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, (this.width - dw) / 2, (this.height - dh) / 2, dw, dh);
    return this._fit.canvas;
  };

  Exporter.prototype._stageErrors = function () {
    const st = this._stage;
    const out = [];
    if (st && st.errors && typeof st.errors.forEach === 'function') {
      st.errors.forEach((v, k) => out.push(k + (v && v.message ? ' — ' + v.message : '') + (v && v.count > 1 ? ' ×' + v.count : '')));
    }
    return out;
  };

  Exporter.prototype._disposeStage = function () {
    const st = this._stage;
    if (!st) return;
    this._stageErrorList = this._stageErrors();
    const gl = st.post && st.post.gl;
    try {
      if (typeof st.dispose === 'function') st.dispose();
    } catch (e) { /* ignore */ }
    // Release the export WebGL context now instead of waiting for GC, so
    // repeated exports never push the preview's context over the UA limit.
    try {
      const ext = gl && !gl.isContextLost() && gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    } catch (e) { /* ignore */ }
    if (this._canvas) {
      this._canvas.width = 1;
      this._canvas.height = 1;
    }
    if (this._fit) {
      this._fit.canvas.width = 1;
      this._fit.canvas.height = 1;
    }
    this._stage = null;
    this._canvas = null;
    this._fit = null;
  };

  Exporter.prototype._closeEncoders = function () {
    for (const k of ['_venc', '_aenc']) {
      const enc = this[k];
      try {
        if (enc && enc.state !== 'closed') enc.close();
      } catch (e) { /* ignore */ }
      this[k] = null;
    }
  };

  /* ---------------- WebCodecs path ---------------- */
  Exporter.prototype._runWebCodecs = async function (caps) {
    const Mux = window.Mp4Muxer;
    if (!Mux || !Mux.Muxer) throw new Error('Mp4Muxer 缺失 (vendor/mp4-muxer.js not loaded)');
    if (typeof VideoEncoder === 'undefined') throw new Error('WebCodecs 不可用 (VideoEncoder unavailable)');
    const w = this.width, h = this.height, fps = this.fps, N = this.frames;
    const t0 = this.range[0];
    const dur = N / fps;

    // 1. Codecs.
    const excluded = this._excluded || null;
    const vpick = await pickVideo(this.videoCodec, w, h, fps, this.videoBitrate, excluded);
    if (!vpick) throw new Error(`没有可用的视频编码器 (no supported video encoder for ${w}x${h}@${fps})`);
    this._vkind = vpick.kind;
    // Only encoder failures (configure / error callback / muxing its output)
    // set _failKey, which lets _execute retry with the next config.
    this._failKey = null;
    let apick = null;
    const buf = this.audioBuffer;
    if (buf && this.audioCodec !== 'none') {
      const ch = clamp(buf.numberOfChannels | 0, 1, 2);
      apick = await pickAudio(this.audioCodec, vpick.kind, buf.sampleRate, ch, excluded);
      if (!apick) {
        if (this.method === 'auto' && caps && caps.mediaRecorder) throw new Error('没有可用的音频编码器 (no supported audio encoder)');
        this.warnings.push('没有可用的音频编码器，仅导出视频 (no audio encoder — video only)');
      }
    }
    this._codec = vpick.codec + (apick ? '+' + apick.codec : '');
    this._checkCancel();

    // 2. Offscreen stage + audio slice.
    await this._makeStage();
    let pcm = null;
    if (apick) {
      this._report('audio', 0, true);
      pcm = await preparePcm(buf, t0, dur, apick.sampleRate, apick.channels);
      this._checkCancel();
    }

    // 3. Muxer.
    const estBytes = ((this.videoBitrate + (apick ? apick.bitrate : 0)) * dur) / 8;
    const streaming = this.mux === 'stream' || (this.mux === 'auto' && estBytes > STREAM_THRESHOLD);
    const sink = streaming ? makeSink() : null;
    const target = streaming ? new Mux.StreamTarget({ onData: (data, position) => sink.write(data, position) }) : new Mux.ArrayBufferTarget();
    const muxOpts = {
      target,
      video: { codec: vpick.mux, width: w, height: h, frameRate: fps },
      fastStart: streaming
        ? { expectedVideoChunks: N + 8, expectedAudioChunks: pcm ? Math.ceil(pcm.length / 480) + 64 : 0 }
        : 'in-memory',
      firstTimestampBehavior: 'offset',
    };
    if (apick) muxOpts.audio = { codec: apick.mux, numberOfChannels: apick.channels, sampleRate: apick.sampleRate };
    const muxer = new Mux.Muxer(muxOpts);

    // 4. Encoders.
    let failure = null;
    const fail = (e, key) => {
      if (failure) return;
      failure = asError(e);
      if (key) this._failKey = key;
    };
    let videoChunks = 0, audioChunks = 0, keyFrames = 0;
    let colorSpace = null; // as reported by the encoder (diagnostics)
    const venc = (this._venc = new VideoEncoder({
      output: (chunk, meta) => {
        try {
          if (!colorSpace && meta && meta.decoderConfig && meta.decoderConfig.colorSpace) {
            const cs = meta.decoderConfig.colorSpace;
            colorSpace = { primaries: cs.primaries, transfer: cs.transfer, matrix: cs.matrix, fullRange: cs.fullRange };
          }
          muxer.addVideoChunk(chunk, fixVideoMeta(meta));
          videoChunks++;
          this._started = true; // first real output: no silent fallback after this
          if (chunk.type === 'key') keyFrames++;
        } catch (e) {
          fail(e, vpick.key);
        }
      },
      error: (e) => fail(e, vpick.key),
    }));
    try {
      venc.configure(vpick.config);
    } catch (e) {
      this._failKey = vpick.key;
      throw e;
    }
    let aenc = null;
    if (apick) {
      aenc = this._aenc = new AudioEncoder({
        output: (chunk, meta) => {
          try {
            muxer.addAudioChunk(chunk, meta);
            audioChunks++;
          } catch (e) {
            fail(e, apick.key);
          }
        },
        error: (e) => fail(e, apick.key),
      });
      try {
        aenc.configure(apick.config);
      } catch (e) {
        this._failKey = apick.key;
        throw e;
      }
    }

    // 5. Frames.
    const kfEvery = Math.max(1, Math.round(this.keyframeInterval * fps));
    const frameUs = Math.round(1e6 / fps);
    const stage = this._stage;
    let aPos = 0;
    this._renderStart = clock();
    this._report('render', 0, true);
    for (let i = 0; i < N; i++) {
      this._checkCancel();
      if (failure) throw failure;
      stage.renderFrame(t0 + i / fps);
      const frame = new VideoFrame(this._frameSource(), { timestamp: Math.round((i * 1e6) / fps), duration: frameUs });
      try {
        venc.encode(frame, { keyFrame: i % kfEvery === 0 });
      } catch (e) {
        if (venc.state === 'closed' && !this._cancelled) this._failKey = this._failKey || vpick.key;
        throw failure || e;
      } finally {
        frame.close();
      }
      if (aenc) {
        try {
          aPos = feedAudio(aenc, pcm, aPos, Math.min(pcm.length, Math.ceil(((i + 1) / fps) * pcm.sampleRate)));
        } catch (e) {
          if (aenc.state === 'closed' && !this._cancelled) this._failKey = this._failKey || apick.key;
          throw failure || e;
        }
      }
      while (!failure && !this._cancelled && venc.encodeQueueSize > MAX_VIDEO_QUEUE) await waitDequeue(venc, 25);
      while (!failure && !this._cancelled && aenc && aenc.encodeQueueSize > MAX_AUDIO_QUEUE) await waitDequeue(aenc, 25);
      this.frame = i + 1;
      this._report('render', (0.97 * (i + 1)) / N, i === N - 1);
      await yieldNow();
    }
    this._checkCancel();
    if (aenc && aPos < pcm.length) feedAudio(aenc, pcm, aPos, pcm.length);

    // 6. Flush + finalize.
    this._report('finalize', 0.975, true);
    await venc.flush();
    if (aenc) await aenc.flush();
    this._checkCancel();
    if (failure) throw failure;
    if (videoChunks < N) this.warnings.push(`编码帧数不足 (encoded ${videoChunks}/${N} frames)`);
    muxer.finalize();
    this._closeEncoders();
    const mimeType = 'video/mp4';
    const blob = streaming ? sink.toBlob(mimeType) : new Blob([target.buffer], { type: mimeType });
    const elapsed = (clock() - this._t0) / 1000;
    const renderElapsed = (clock() - this._renderStart) / 1000;
    this._disposeStage();
    return {
      blob,
      filename: Exporter.filename(this.title, w, h, fps, 'mp4'),
      mime: `video/mp4; codecs="${vpick.codec}${apick ? ',' + apick.codec : ''}"`,
      codec: this._codec,
      videoCodec: vpick.codec,
      audioCodec: apick ? apick.codec : null,
      audioSampleRate: apick ? apick.sampleRate : null,
      colorSpace,
      method: 'webcodecs',
      container: 'mp4',
      mux: streaming ? 'stream' : 'in-memory',
      width: w, height: h, fps, frames: N, duration: dur, range: this.range.slice(),
      bytes: blob.size,
      videoChunks, audioChunks, keyFrames,
      bitrate: this.videoBitrate,
      elapsed,
      fpsRendered: renderElapsed > 0 ? N / renderElapsed : 0,
      warnings: this.warnings.slice(),
      stageErrors: this._stageErrorList || [],
    };
  };

  /* ---------------- MediaRecorder (realtime) fallback ---------------- */
  Exporter.prototype._runRecorder = async function () {
    if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder 不可用 (MediaRecorder unavailable)');
    const fps = this.fps, N = this.frames;
    const t0 = this.range[0];
    const dur = N / fps;
    await this._makeStage();
    const stage = this._stage;
    stage.renderFrame(t0);
    // Always capture a 2D copy: exact output size, and capture of detached
    // WebGL canvases is less reliable across browsers.
    const capCanvas = this._frameSource(true);
    if (typeof capCanvas.captureStream !== 'function') throw new Error('canvas.captureStream 不可用 (unavailable)');
    const vstream = capCanvas.captureStream(fps);

    let actx = null, src = null, dest = null;
    const cleanup = [];
    const stopAll = () => {
      while (cleanup.length) {
        try {
          cleanup.pop()();
        } catch (e) { /* ignore */ }
      }
    };
    cleanup.push(() => vstream.getTracks().forEach((t) => t.stop()));
    try {
      if (this.audioBuffer && this.audioCodec !== 'none') {
        actx = this._actx || makeAudioContext();
        this._actx = null;
        if (!actx) throw new Error('AudioContext 不可用 (unavailable)');
        cleanup.push(() => actx.close());
        dest = actx.createMediaStreamDestination();
        src = actx.createBufferSource();
        src.buffer = this.audioBuffer;
        src.connect(dest);
        if (this.opts.monitor) src.connect(actx.destination);
        cleanup.push(() => src.disconnect());
        if (actx.state !== 'running') {
          await Promise.race([actx.resume().catch(() => null), new Promise((r) => setTimeout(r, 1000))]);
        }
        if (actx.state !== 'running') this.warnings.push('AudioContext 未运行，音频可能无声 (AudioContext not running — needs a user gesture; audio may be silent)');
      }
      const tracks = vstream.getVideoTracks().slice();
      if (dest) tracks.push(...dest.stream.getAudioTracks());
      const stream = new MediaStream(tracks);
      const mimeType = pickRecorderMime();
      const recOpts = { videoBitsPerSecond: Math.round(this.videoBitrate) };
      if (dest) recOpts.audioBitsPerSecond = 192000;
      if (mimeType) recOpts.mimeType = mimeType;
      const rec = new MediaRecorder(stream, recOpts);
      const chunks = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      const stopped = new Promise((resolve, reject) => {
        rec.onstop = () => resolve();
        rec.onerror = (e) => reject(asError((e && e.error) || 'MediaRecorder error'));
      });
      stopped.catch(() => null); // awaited below; avoid an unhandled rejection when cancelled
      cleanup.push(() => {
        if (rec.state !== 'inactive') rec.stop();
      });
      this._codec = rec.mimeType || mimeType || 'default';

      // Recorder and song start together (no scheduling lead, so the file does
      // not open with a stretch of frozen frame t0). Chrome's 'start' event
      // only fires once frames flow, so it cannot be awaited here. The song
      // clock is the AudioContext.
      rec.start(1000);
      const startCtx = actx ? actx.currentTime : 0;
      if (src) src.start(startCtx, Math.min(t0, this.audioBuffer.duration), dur);
      const startWall = clock();
      // Song clock = the AudioContext; if it is not running or stalls (device
      // change, autoplay block) switch to the wall clock instead of hanging.
      let useWall = !actx || actx.state !== 'running';
      const elapsedSong = () => {
        const wall = (clock() - startWall) / 1000;
        if (useWall) return wall;
        const a = actx.currentTime - startCtx;
        if (wall - a > 1) {
          useWall = true;
          this.warnings.push('音频时钟停滞，改用系统时钟 (audio clock stalled — using the wall clock)');
          return wall;
        }
        return a;
      };
      this._renderStart = clock();
      let hiddenSeen = false;
      await new Promise((resolve) => {
        let last = -1, raf = 0, timer = 0, done = false;
        const finish = () => {
          if (done) return;
          done = true;
          if (raf) cancelAnimationFrame(raf);
          clearTimeout(timer);
          resolve();
        };
        this._rec = { abort: finish };
        const tick = () => {
          raf = 0;
          if (this._cancelled) return finish();
          const el = elapsedSong();
          const fi = clamp(Math.floor(el * fps), 0, N - 1);
          if (fi !== last) {
            last = fi;
            stage.renderFrame(t0 + fi / fps);
            this._frameSource(true);
            this.frame = fi + 1;
            this._report('record', clamp(el / dur, 0, 1) * 0.97);
          }
          if (el >= dur) return finish();
          if (typeof document !== 'undefined' && document.hidden) {
            hiddenSeen = true;
            timer = setTimeout(tick, 1000 / fps);
          } else raf = requestAnimationFrame(tick);
        };
        tick();
      });
      if (hiddenSeen) this.warnings.push('录制期间标签页被隐藏，可能掉帧 (tab hidden during realtime capture — frames may drop)');
      this._checkCancel();
      this._report('finalize', 0.98, true);
      await new Promise((r) => setTimeout(r, 120));
      if (rec.state !== 'inactive') rec.stop();
      await stopped;
      this._checkCancel();
      const type = (rec.mimeType || mimeType || 'video/webm').split(';')[0];
      const container = type.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
      let blob = new Blob(chunks, { type });
      if (container === 'webm') blob = await fixWebmDuration(blob, dur * 1000);
      const elapsed = (clock() - this._t0) / 1000;
      const renderElapsed = (clock() - this._renderStart) / 1000;
      stopAll();
      return {
        blob,
        filename: Exporter.filename(this.title, this.width, this.height, fps, container),
        mime: rec.mimeType || type,
        codec: this._codec,
        videoCodec: null,
        audioCodec: null,
        method: 'mediarecorder',
        container,
        width: this.width, height: this.height, fps, frames: N, duration: dur, range: this.range.slice(),
        bytes: blob.size,
        elapsed,
        fpsRendered: renderElapsed > 0 ? this.frame / renderElapsed : 0,
        warnings: this.warnings.concat(['实时录制：帧率取决于本机性能 (realtime capture — frame pacing depends on this machine)']),
        stageErrors: this._stageErrors(),
      };
    } finally {
      this._rec = null;
      stopAll();
    }
  };

  MV.Exporter = Exporter;
})();

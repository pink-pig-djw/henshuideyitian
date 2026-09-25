// export.js — render the MV frame by frame in the browser and encode an MP4
// with WebCodecs (H.264 + AAC where available) muxed by mp4-muxer.
'use strict';
const EXPORTER = (() => {
  const VIDEO = [
    { codec: 'avc1.640028', mux: 'avc' }, { codec: 'avc1.4d0028', mux: 'avc' }, { codec: 'avc1.42002a', mux: 'avc' },
    { codec: 'vp09.00.40.08', mux: 'vp9' }, { codec: 'av01.0.08M.08', mux: 'av1' },
  ];
  const AUDIO = [{ codec: 'mp4a.40.2', mux: 'aac' }, { codec: 'opus', mux: 'opus' }];

  function supported() { return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && typeof Mp4Muxer !== 'undefined'; }

  async function pickVideo(width, height, fps) {
    for (const c of VIDEO) {
      const cfg = { codec: c.codec, width, height, framerate: fps, bitrate: width >= 1920 ? 9_000_000 : 5_000_000, latencyMode: 'quality' };
      if (c.mux === 'avc') cfg.avc = { format: 'avc' };
      try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) return { cfg, mux: c.mux, codec: c.codec }; } catch (e) { /* next */ }
    }
    return null;
  }
  async function pickAudio(sampleRate, channels) {
    if (typeof AudioEncoder === 'undefined') return null;
    for (const c of AUDIO) {
      const rate = c.mux === 'opus' ? 48000 : sampleRate;
      const cfg = { codec: c.codec, sampleRate: rate, numberOfChannels: channels, bitrate: 192_000 };
      try { const r = await AudioEncoder.isConfigSupported(cfg); if (r.supported) return { cfg, mux: c.mux, codec: c.codec, rate }; } catch (e) { /* next */ }
    }
    return null;
  }
  // Opus needs 48 kHz; resample through an OfflineAudioContext when the source differs
  async function resample(buf, rate) {
    if (buf.sampleRate === rate) return buf;
    const oc = new OfflineAudioContext(buf.numberOfChannels, Math.ceil(buf.duration * rate), rate);
    const s = oc.createBufferSource(); s.buffer = buf; s.connect(oc.destination); s.start();
    return oc.startRendering();
  }

  // opts: {audio: AudioBuffer|null, width, height, fps, from, to, onProgress(p, info), signal}
  async function run(opts) {
    const fps = opts.fps || 24, width = opts.width || 1920, height = opts.height || 1080;
    const from = Math.max(0, opts.from || 0), to = Math.min(MV.duration, opts.to ?? MV.duration);
    const v = await pickVideo(width, height, fps);
    if (!v) throw new Error('这个浏览器不支持视频编码（WebCodecs）。请用电脑版 Chrome、Edge 或 Safari 17 以上。');
    let audio = opts.audio || null, a = null;
    const ch = 2;
    if (audio) { a = await pickAudio(audio.sampleRate, ch); if (a) audio = await resample(audio, a.rate); }
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({
      target, fastStart: 'in-memory', firstTimestampBehavior: 'offset',
      video: { codec: v.mux, width, height, frameRate: fps },
      audio: a ? { codec: a.mux, numberOfChannels: ch, sampleRate: a.rate } : undefined,
    });
    let failure = null;
    const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { failure = e; } });
    venc.configure(v.cfg);

    // audio: encode the chosen range in 0.1 s blocks
    if (a) {
      const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: e => { failure = e; } });
      aenc.configure(a.cfg);
      const sr = a.rate, s0 = Math.floor(from * sr), s1 = Math.min(audio.length, Math.floor(to * sr)), block = Math.round(sr / 10);
      for (let s = s0; s < s1; s += block) {
        const n = Math.min(block, s1 - s), data = new Float32Array(n * ch);
        for (let c = 0; c < ch; c++) data.set(audio.getChannelData(Math.min(c, audio.numberOfChannels - 1)).subarray(s, s + n), c * n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round((s - s0) / sr * 1e6), data });
        aenc.encode(ad); ad.close();
        if (failure) throw failure;
      }
      await aenc.flush(); aenc.close();
    }

    // video: deterministic frame-by-frame rendering
    const scaled = width !== MV.canvas.width ? Object.assign(document.createElement('canvas'), { width, height }) : null;
    const sctx = scaled && scaled.getContext('2d');
    const total = Math.max(1, Math.round((to - from) * fps)), t0 = performance.now();
    for (let f = 0; f < total; f++) {
      if (opts.signal && opts.signal.aborted) { try { venc.close(); } catch (e) { /* closed */ } throw new DOMException('已取消', 'AbortError'); }
      if (failure) throw failure;
      MV.render(from + f / fps);
      let img = MV.canvas;
      if (sctx) { sctx.drawImage(MV.canvas, 0, 0, width, height); img = scaled; }
      const frame = new VideoFrame(img, { timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: f % (fps * 2) === 0 });
      frame.close();
      while (venc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 1));
      if (f % 4 === 0 || f === total - 1) {
        const el = (performance.now() - t0) / 1000, rate = (f + 1) / el;
        opts.onProgress && opts.onProgress((f + 1) / total, { frame: f + 1, total, eta: (total - f - 1) / rate, fps: rate });
        await new Promise(r => setTimeout(r, 0));
      }
    }
    await venc.flush(); venc.close();
    if (failure) throw failure;
    muxer.finalize();
    return { blob: new Blob([target.buffer], { type: 'video/mp4' }), video: v.codec, audio: a ? a.codec : null };
  }
  return { supported, run, pickVideo, pickAudio };
})();

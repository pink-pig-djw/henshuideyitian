/*
 * MV.Exporter test harness (Playwright + headless Chromium).
 *
 *   python3 -m http.server 8707 --directory mv &
 *   NODE_PATH=/opt/node22/lib/node_modules node mv/tools/test-export.cjs
 *
 * Env: PORT (default 8707), MV_LYRICS=<path> (optional, local lyrics file used
 * only for the real-director render — its text is never printed), SKIP_REAL=1,
 * SKIP_RECORDER=1. Outputs (MP4/WebM/PNG) go to mv/out/export/ (git-ignored).
 *
 * Covers: capabilities; stub-stage export 5 s @640x360/30 of range [60, 65]
 * with the real song (box structure, durations, key frames, <video> decode +
 * seek + frame barcode, audio NCC vs the source slice); streaming mux; 22.05 kHz
 * resample path; video-only; odd / square sizes; forced codecs; cancel()
 * (mid-run, before run, during prepare, reuse afterwards); MediaRecorder
 * fallback (+ WebM duration patch); real Director + Stage export (contact
 * sheet, export-vs-preview pixel match) and render-speed timings.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const PORT = +(process.env.PORT || 8707);
const BASE = `http://localhost:${PORT}/tools/dev-export.html`;
const OUT = path.join(__dirname, '..', 'out', 'export');
fs.mkdirSync(OUT, { recursive: true });
const LYRICS = process.env.MV_LYRICS && fs.existsSync(process.env.MV_LYRICS) ? fs.readFileSync(process.env.MV_LYRICS, 'utf8') : null;

let pass = 0, fail = 0;
const report = [];
function check(name, cond, detail) {
  const ok = !!cond;
  ok ? pass++ : fail++;
  const d = detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail));
  report.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d}`);
}
const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol;
const saveDataURL = (file, url) => fs.writeFileSync(path.join(OUT, file), Buffer.from(url.split(',')[1], 'base64'));

async function saveBlob(page, file) {
  const b64 = await page.evaluate(async () => {
    const buf = new Uint8Array(await DX.last.blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  fs.writeFileSync(path.join(OUT, file), Buffer.from(b64, 'base64'));
}

// Is the static server up? (started here when it is not)
function ping() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/tools/dev-export.html`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

let server = null;
(async () => {
  if (!(await ping())) {
    server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', path.join(__dirname, '..')], { stdio: 'ignore' });
    for (let i = 0; i < 50 && !(await ping()); i++) await new Promise((r) => setTimeout(r, 100));
  }
  // A launch-level proxy ignores the localhost bypass in this sandbox (the
  // page comes back 405 from the proxy), so the proxy is set per context.
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
  const browser = await chromium.launch({
    proxy: proxy ? { server: 'per-context' } : undefined,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, proxy, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(m.type() + ': ' + m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  await page.goto(BASE);
  await page.waitForFunction(() => window.DX && window.DX.ready === true, null, { timeout: 30000 });

  /* ---------------- capabilities ---------------- */
  const caps = await page.evaluate(() => DX.caps());
  console.log('capabilities:', JSON.stringify(caps));
  check('capabilities() shape', ['webcodecs', 'h264', 'vp9', 'aac', 'opus', 'mediaRecorder'].every((k) => typeof caps[k] === 'boolean'), caps.preferred);
  check('webcodecs available (secure context)', caps.webcodecs);

  /* ---------------- song ---------------- */
  const song = await page.evaluate(() => DX.loadSong());
  console.log('song:', JSON.stringify(song));
  check('song decoded', song.duration > 220 && song.duration < 223, song);
  const song22 = await page.evaluate(() => DX.loadSong(undefined, { sampleRate: 22050 }));
  check('22.05 kHz copy decoded', song22.sampleRate === 22050, song22);
  await page.evaluate(() => DX.buildDirector({ mode: 'stub' }));

  /* ---------------- A: stub stage, [60, 65] @ 640x360/30 ---------------- */
  const A = await page.evaluate(() => DX.exportClip({ width: 640, height: 360, fps: 30, range: [60, 65] }));
  console.log('A export:', JSON.stringify(A));
  check('A: blob non-empty', A.bytes > 10000, A.bytes);
  check('A: method webcodecs', A.method === 'webcodecs', A.codec);
  check('A: 150 frames encoded, key frame every 2 s', A.frames === 150 && A.videoChunks === 150 && A.keyFrames === 3, { videoChunks: A.videoChunks, keyFrames: A.keyFrames });
  check('A: audio chunks produced', A.audioChunks > 100, A.audioChunks);
  check('A: filename sanitised', /^Dev_Stub_星_Export_640x360_30fps\.mp4$/.test(A.filename), A.filename);
  check('A: progress monotonic, ends at 1, phases', A.progressMonotonic && A.lastP === 1 && ['prepare', 'render', 'finalize', 'done'].every((p) => A.progressPhases.includes(p)), { calls: A.progressCalls, phases: A.progressPhases });
  const Ai = await page.evaluate(() => DX.inspectLast());
  console.log('A boxes:', Ai.order.join(' '), 'mvhd', JSON.stringify(Ai.mvhd));
  Ai.tracks.forEach((t) => console.log('  track', JSON.stringify(Object.assign({}, t, { stts: t.stts && t.stts.slice(0, 3) }))));
  check('A: ftyp, moov, mdat present; moov first (fast start)', Ai.order[0] === 'ftyp' && Ai.fastStart && Ai.order.includes('mdat') && !Ai.errors.length, Ai.order);
  check('A: mvhd duration ≈ 5 s', near(Ai.mvhd && Ai.mvhd.seconds, 5, 0.1), Ai.mvhd && Ai.mvhd.seconds);
  check('A: two tracks (vide + soun)', Ai.tracks.length === 2 && Ai.tracks.some((t) => t.handler === 'vide') && Ai.tracks.some((t) => t.handler === 'soun'), Ai.tracks.map((t) => t.handler + ':' + t.format));
  const Av = Ai.tracks.find((t) => t.handler === 'vide') || {};
  const Aa = Ai.tracks.find((t) => t.handler === 'soun') || {};
  check('A: video track 640x360, 150 samples, keyframes [1,61,121]', Av.width === 640 && Av.height === 360 && Av.samples === 150 && JSON.stringify(Av.keyframes) === '[1,61,121]', { w: Av.width, h: Av.height, samples: Av.samples, keys: Av.keyframes });
  check('A: video mdhd ≈ 5 s', near(Av.mdhd && Av.mdhd.seconds, 5, 0.05), Av.mdhd);
  check('A: audio track 48 kHz, ≈ 5 s', Aa.sampleRate === 48000 && near(Aa.mdhd && Aa.mdhd.seconds, 5, 0.1), { sr: Aa.sampleRate, ch: Aa.channels, dur: Aa.mdhd && Aa.mdhd.seconds, fmt: Aa.format });
  check('A: chunk offsets inside mdat', Ai.offsetsInMdat);
  await saveBlob(page, 'A-stub-640x360.mp4');
  const AvV = await page.evaluate(() => DX.verifyVideo(DX.lastBlob(), { times: [0.5 / 30, 2.5 + 0.5 / 30, 4.95], barcode: true }));
  console.log('A <video>:', JSON.stringify(AvV));
  check('A: <video> loads, duration ≈ 5 s', !AvV.error && near(AvV.duration, 5, 0.1), AvV.error || AvV.duration);
  check('A: decoded frames not black', AvV.frames.every((f) => f.stats.nonBlack > 0.3), AvV.frames.map((f) => f.stats.nonBlack));
  check('A: seek 2.5 s shows song frame 1875 (t = 62.5)', AvV.frames[1] && AvV.frames[1].barcode.n === 1875, AvV.frames.map((f) => f.barcode));
  check('A: first / last frames 1800 / 1948', AvV.frames[0].barcode.n === 1800 && AvV.frames[2].barcode.n === 1948, AvV.frames.map((f) => f.barcode.n));
  check('A: playback advances', AvV.playAdvanced, AvV.playedTo);
  const Acol = await page.evaluate(() => DX.verifyVideo(DX.lastBlob(), { times: [1], swatches: true }));
  const sw = Acol.frames[0].colour;
  console.log('A colour: encoder colorSpace', JSON.stringify(A.colorSpace), 'swatches', JSON.stringify(Object.fromEntries(Object.entries(sw.swatches).map(([k, v]) => [k, v.got.join(',') + ' (±' + v.err + ')']))));
  check('A: palette survives encode (max channel error ≤ 12)', sw.maxErr <= 12, sw.maxErr);
  const AvA = await page.evaluate(() => DX.verifyAudio(DX.lastBlob(), { ref: DX.buffers.song, t0: 60 }));
  console.log('A audio:', JSON.stringify(AvA));
  check('A: audio decodes, ≈ 5 s, matches song[60…] (NCC)', !AvA.error && near(AvA.duration, 5, 0.1) && AvA.ncc > 0.8, AvA);
  check('A: audio aligned (|lag| < 12 ms)', Math.abs(AvA.lagMs) < 12, AvA.lagMs);

  /* ---------------- B: streaming mux ---------------- */
  const B = await page.evaluate(() => DX.exportClip({ width: 640, height: 360, fps: 30, range: [100, 104], mux: 'stream' }));
  const Bi = await page.evaluate(() => DX.inspectLast());
  console.log('B export:', B.mux, B.bytes, 'boxes', Bi.order.join(' '));
  check('B: stream mux → fast-start MP4 (ftyp moov free mdat)', B.mux === 'stream' && Bi.fastStart && Bi.offsetsInMdat && !Bi.errors.length && near(Bi.mvhd.seconds, 4, 0.1), Bi.order);
  const BvV = await page.evaluate(() => DX.verifyVideo(DX.lastBlob(), { times: [2 + 0.5 / 30], barcode: true }));
  const BvA = await page.evaluate(() => DX.verifyAudio(DX.lastBlob(), { ref: DX.buffers.song, t0: 100 }));
  check('B: plays, frame 3060 at 2 s, audio matches', near(BvV.duration, 4, 0.1) && BvV.frames[0].barcode.n === 3060 && BvA.ncc > 0.8, { dur: BvV.duration, n: BvV.frames[0].barcode.n, ncc: BvA.ncc, lag: BvA.lagMs });
  await saveBlob(page, 'B-stream-640x360.mp4');

  /* ---------------- C: 22.05 kHz source → resampled ---------------- */
  const Cx = await page.evaluate(() => DX.exportClip({ width: 640, height: 360, fps: 30, range: [60, 63], audioKey: 'sr22050' }));
  const Ci = await page.evaluate(() => DX.inspectLast());
  const CvA = await page.evaluate(() => DX.verifyAudio(DX.lastBlob(), { ref: DX.buffers.song, t0: 60 }));
  const Ca = Ci.tracks.find((t) => t.handler === 'soun') || {};
  check('C: 22.05 kHz input resampled to 48 kHz', Cx.audioSampleRate === 48000 && Ca.sampleRate === 48000, { enc: Cx.audioSampleRate, box: Ca.sampleRate });
  check('C: resampled audio matches song[60…]', CvA.ncc > 0.7 && Math.abs(CvA.lagMs) < 12, CvA);

  /* ---------------- D: video only ---------------- */
  const D = await page.evaluate(() => DX.exportClip({ width: 640, height: 360, fps: 24, range: [10, 12], audio: false }));
  const Di = await page.evaluate(() => DX.inspectLast());
  check('D: no audio → one video track, 48 frames @24', Di.tracks.length === 1 && Di.tracks[0].handler === 'vide' && Di.tracks[0].samples === 48 && D.filename.endsWith('_640x360_24fps.mp4'), { tracks: Di.tracks.length, samples: Di.tracks[0].samples, f: D.filename });

  /* ---------------- E: odd / square sizes ---------------- */
  const E1 = await page.evaluate(() => DX.exportClip({ width: 853, height: 481, fps: 30, range: [60, 61] }));
  const E1v = await page.evaluate(() => DX.verifyVideo(DX.lastBlob(), { times: [0.5] }));
  check('E: odd size rounded to even (854x482) and decodes', E1.width === 854 && E1.height === 482 && E1v.videoWidth === 854 && E1v.videoHeight === 482 && E1v.frames[0].stats.nonBlack > 0.3, { w: E1v.videoWidth, h: E1v.videoHeight });
  const E2 = await page.evaluate(() => DX.exportClip({ width: 720, height: 720, fps: 30, range: [60, 61] }));
  const E2v = await page.evaluate(() => DX.verifyVideo(DX.lastBlob(), { times: [0.5], png: true }));
  check('E: square 720x720 (cover crop) decodes', E2v.videoWidth === 720 && E2v.videoHeight === 720 && E2v.frames[0].stats.nonBlack > 0.3, E2v.frames[0].stats);
  saveDataURL('E-square-720.png', E2v.frames[0].png);

  /* ---------------- F: forced codecs ---------------- */
  for (const vc of ['vp9', 'av1']) {
    if (!caps[vc]) { console.log(`skip ${vc}: unsupported`); continue; }
    const r = await page.evaluate((vc) => DX.exportClip({ width: 640, height: 360, fps: 30, range: [60, 62], videoCodec: vc, method: 'webcodecs' }), vc);
    const i = await page.evaluate(() => DX.inspectLast());
    const v = await page.evaluate(() => DX.verifyVideo(DX.lastBlob(), { times: [1 + 0.5 / 30], barcode: true }));
    const vt = i.tracks.find((t) => t.handler === 'vide') || {};
    check(`F: forced ${vc} → ${vt.format}, plays, frame 1830`, !v.error && v.frames[0].barcode.n === 1830, { codec: r.codec, fmt: vt.format, cfg: vt.config, colr: vt.colr, n: v.frames[0] && v.frames[0].barcode.n, err: v.error });
    await saveBlob(page, `F-${vc}.mp4`);
  }
  if (!caps.h264) {
    const err = await page.evaluate(() => DX.exportClip({ width: 640, height: 360, range: [60, 61], videoCodec: 'h264', method: 'webcodecs' }).then(() => null, (e) => e.message));
    check('F: forced h264 unsupported → clear error', err && /no supported video encoder/.test(err), err);
  }

  /* ---------------- G: cancel ---------------- */
  const G1 = await page.evaluate(async () => {
    let cancelAt = 0;
    let ex = null;
    const p = DX.exportClip({
      width: 640, height: 360, fps: 30, range: [30, 50],
      onProgress: (pp, info) => { if (!cancelAt && info.frame >= 20) { cancelAt = performance.now(); DX.exporter.cancel(); } },
    });
    try {
      await p;
      return { resolved: true };
    } catch (e) {
      ex = DX.exporter;
      return { name: e.name, message: e.message, ms: Math.round(performance.now() - cancelAt), state: ex.state, frame: ex.frame, frames: ex.frames, vencClosed: ex._venc === null, stageReleased: ex._stage === null };
    }
  });
  console.log('G cancel mid-run:', JSON.stringify(G1));
  check('G: cancel() mid-run rejects with AbortError', G1.name === 'AbortError' && G1.state === 'cancelled', G1);
  check('G: cancel is prompt (< 500 ms) and releases encoders/stage', G1.ms < 500 && G1.vencClosed && G1.stageReleased && G1.frame < 40, { ms: G1.ms, frame: G1.frame });
  const G2 = await page.evaluate(async () => {
    const ex = new MV.Exporter({ director: DX.stubDirector, stageFactory: (c, o) => new DX.StubStage({ canvas: c, scale: o.scale }), width: 320, height: 180, range: [0, 1] });
    const r1 = ex.cancel();
    const e = await ex.run().then(() => null, (err) => err.name);
    const ex2 = new MV.Exporter({ director: DX.stubDirector, stageFactory: (c, o) => new DX.StubStage({ canvas: c, scale: o.scale }), width: 320, height: 180, range: [0, 1] });
    const p2 = ex2.run();
    setTimeout(() => ex2.cancel(), 0);
    const e2 = await p2.then(() => null, (err) => err.name);
    return { before: e, cancelReturned: r1, duringPrepare: e2, again: ex.cancel() };
  });
  check('G: cancel before run / during prepare → AbortError', G2.before === 'AbortError' && G2.duringPrepare === 'AbortError' && G2.again === false, G2);
  const G3 = await page.evaluate(() => DX.exportClip({ width: 320, height: 180, fps: 30, range: [60, 61] }));
  check('G: a fresh export works after cancellations', G3.frames === 30 && G3.videoChunks === 30, { frames: G3.frames, chunks: G3.videoChunks });

  /* ---------------- W: WebM duration patch (synthetic EBML) ---------------- */
  const W = await page.evaluate(async () => {
    // EBML header, Segment (known 8-byte size | unknown size), Info{TimecodeScale 1e6, MuxingApp}, Void payload.
    const bytes = (...a) => Uint8Array.from(a.map((x) => (ArrayBuffer.isView(x) ? Array.from(x) : x)).flat());
    const el = (id, payload) => bytes(id, 0x80 | payload.length, Array.from(payload));
    const ebml = bytes([0x1a, 0x45, 0xdf, 0xa3], 0x80 | 4, [0x42, 0x86, 0x81, 0x01]);
    const info = el([0x15, 0x49, 0xa9, 0x66], bytes(el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]), el([0x4d, 0x80], [0x61, 0x62])));
    const tail = el([0xec], new Array(20).fill(0));
    const body = bytes(Array.from(info), Array.from(tail));
    const seg = (known) => {
      const size = known ? [0x01, 0, 0, 0, 0, 0, 0, body.length] : [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
      return new Blob([ebml, bytes([0x18, 0x53, 0x80, 0x67], size), body], { type: 'video/webm' });
    };
    const parse = async (blob) => {
      const b = new Uint8Array(await blob.arrayBuffer());
      const vint = (p) => { let len = 1; if (!b[p]) throw new Error('bad vint @' + p); while (!(b[p] & (0x80 >> (len - 1)))) len++; let v = b[p] & (0xff >> len); for (let i = 1; i < len; i++) v = v * 256 + b[p + i]; return { len, v }; };
      let p = 4 + 1 + 4; // past EBML header
      p += 4; const ss = vint(p); p += ss.len;
      const segDataStart = p;
      p += 4; const is = vint(p); p += is.len; const infoEnd = p + is.v;
      let dur = null;
      while (p < infoEnd) {
        const idLen = b[p] >= 0x80 ? 1 : b[p] >= 0x40 ? 2 : b[p] >= 0x20 ? 3 : 4;
        const id = Array.from(b.subarray(p, p + idLen)).map((x) => x.toString(16)).join('');
        const sz = vint(p + idLen);
        if (id === '4489') dur = new DataView(b.buffer, p + idLen + sz.len, 8).getFloat64(0);
        p += idLen + sz.len + sz.v;
      }
      return { dur, segSize: ss.v, segActual: b.length - segDataStart, unknown: ss.v === 72057594037927935 };
    };
    const known = await parse(await MV.Exporter.fixWebmDuration(seg(true), 3210.5));
    const unknown = await parse(await MV.Exporter.fixWebmDuration(seg(false), 1234));
    const twice = await parse(await MV.Exporter.fixWebmDuration(await MV.Exporter.fixWebmDuration(seg(true), 1000), 2000));
    const garbage = (await MV.Exporter.fixWebmDuration(new Blob([new Uint8Array([1, 2, 3, 4, 5])]), 1000)).size;
    return { known, unknown, twice, garbage };
  });
  check('W: WebM duration patch (known / unknown segment size, re-patch, garbage passthrough)',
    W.known.dur === 3210.5 && W.known.segSize === W.known.segActual && W.unknown.dur === 1234 && W.twice.dur === 2000 && W.twice.segSize === W.twice.segActual && W.garbage === 5, W);

  /* ---------------- I: encoder setup failures → retry ladder → realtime ---------------- */
  // (a) A fake H.264 (isConfigSupported says yes, configure() then fails
  //     asynchronously): two H.264 attempts, then VP9 via WebCodecs.
  // (b) VP9 fails only with hardwareAcceleration 'no-preference': the
  //     software variant of the same codec is used.
  // (c) every WebCodecs config fails: 'auto' falls back to realtime capture.
  const I = await page.evaluate(async () => {
    const origSup = VideoEncoder.isConfigSupported;
    const origCfg = VideoEncoder.prototype.configure;
    const breakCfg = (cfg) => Object.assign({}, cfg, { hardwareAcceleration: 'prefer-hardware' }); // no HW encoder here → async error
    const out = {};
    try {
      VideoEncoder.isConfigSupported = (cfg) => (/^avc1/.test(cfg.codec) ? Promise.resolve({ supported: true, config: cfg }) : origSup.call(VideoEncoder, cfg));
      const a = await DX.exportClip({ width: 320, height: 180, fps: 30, range: [60, 61.5] });
      out.a = { method: a.method, codec: a.videoCodec, retries: a.warnings.filter((w) => /setup failed/.test(w)).length };
      VideoEncoder.isConfigSupported = origSup;
      VideoEncoder.prototype.configure = function (cfg) {
        return origCfg.call(this, /^vp09/.test(cfg.codec) && cfg.hardwareAcceleration === 'no-preference' ? breakCfg(cfg) : cfg);
      };
      const b = await DX.exportClip({ width: 320, height: 180, fps: 30, range: [60, 61.5] });
      out.b = { method: b.method, codec: b.videoCodec, frames: b.videoChunks, retries: b.warnings.filter((w) => /setup failed/.test(w)).length, w: b.warnings.map((x) => x.slice(0, 80)) };
      VideoEncoder.prototype.configure = function (cfg) { return origCfg.call(this, breakCfg(cfg)); };
      const c = await DX.exportClip({ width: 320, height: 180, fps: 30, range: [60, 61.5] });
      out.c = { method: c.method, bytes: c.bytes, retries: c.warnings.filter((w) => /setup failed/.test(w)).length, fellBack: c.warnings.some((w) => /WebCodecs failed/.test(w)) };
      const d = await DX.exportClip({ width: 320, height: 180, fps: 30, range: [60, 61.5], method: 'webcodecs' }).then(() => 'resolved', (e) => e.message);
      out.d = d.slice(0, 120);
    } finally {
      VideoEncoder.isConfigSupported = origSup;
      VideoEncoder.prototype.configure = origCfg;
    }
    return out;
  });
  console.log('I retry ladder:', JSON.stringify(I));
  check('I(a): fake H.264 fails async → 2 retries → VP9 via WebCodecs', I.a.method === 'webcodecs' && /^vp09/.test(I.a.codec) && I.a.retries === 2, I.a);
  check('I(b): VP9 hw/any config fails → software VP9 used', I.b.method === 'webcodecs' && /^vp09/.test(I.b.codec) && I.b.retries === 1 && I.b.frames === 45, I.b);
  check('I(c): all WebCodecs configs fail → realtime fallback', I.c.method === 'mediarecorder' && I.c.bytes > 1000 && I.c.fellBack && I.c.retries >= 4, I.c);
  check('I(d): explicit webcodecs + all failing → rejects with the encoder error', I.d !== 'resolved' && I.d.length > 0, I.d);

  /* ---------------- J: no audio encoder (Safari-like) + Web Lock ---------------- */
  const J = await page.evaluate(async () => {
    const orig = AudioEncoder.isConfigSupported;
    AudioEncoder.isConfigSupported = () => Promise.resolve({ supported: false });
    let locksDuring = null;
    try {
      const auto = await DX.exportClip({
        width: 320, height: 180, fps: 30, range: [60, 61],
        onProgress: async (p, info) => {
          if (locksDuring === null && (info.phase === 'render' || info.phase === 'record') && navigator.locks) {
            locksDuring = -1;
            const q = await navigator.locks.query();
            locksDuring = q.held.filter((l) => /^mv-export-/.test(l.name)).length;
          }
        },
      });
      const wc = await DX.exportClip({ width: 320, height: 180, fps: 30, range: [60, 61], method: 'webcodecs' });
      const wci = await DX.inspectLast();
      const after = navigator.locks ? (await navigator.locks.query()).held.filter((l) => /^mv-export-/.test(l.name)).length : 0;
      return { autoMethod: auto.method, wcMethod: wc.method, wcTracks: wci.tracks.length, wcWarn: wc.warnings, locksDuring, locksAfter: after };
    } finally {
      AudioEncoder.isConfigSupported = orig;
    }
  });
  check('J: no AudioEncoder → auto uses realtime capture (keeps audio); webcodecs → video-only + warning', J.autoMethod === 'mediarecorder' && J.wcMethod === 'webcodecs' && J.wcTracks === 1 && J.wcWarn.some((w) => /video only/.test(w)), J);
  check('J: Web Lock held during export, released after', J.locksDuring === 1 && J.locksAfter === 0, { during: J.locksDuring, after: J.locksAfter });

  /* ---------------- H: MediaRecorder fallback ---------------- */
  if (!process.env.SKIP_RECORDER && caps.mediaRecorder) {
    const H = await page.evaluate(() => DX.exportClip({ width: 640, height: 360, fps: 30, range: [60, 63], method: 'mediarecorder' }));
    console.log('H recorder:', JSON.stringify(H));
    await saveBlob(page, 'H-recorder.' + H.container);
    const Hv = await page.evaluate(() => DX.verifyVideo(DX.lastBlob(), { times: [1.5], barcode: true, swatches: true }));
    const HvA = await page.evaluate(() => DX.verifyAudio(DX.lastBlob(), { ref: DX.buffers.song, t0: 60 }));
    console.log('H <video>:', JSON.stringify(Hv), 'audio', JSON.stringify(HvA));
    check('H: realtime MediaRecorder export produced ' + H.container, H.method === 'mediarecorder' && H.bytes > 10000 && H.filename.endsWith('.' + H.container), { mime: H.mime, bytes: H.bytes });
    check('H: duration known (WebM duration patch) ≈ 3 s', near(Hv.duration, 3, 0.35), Hv.duration);
    check('H: frame near 1845 at 1.5 s, not black', Hv.frames[0] && Math.abs(Hv.frames[0].barcode.n - 1845) <= 6 && Hv.frames[0].stats.nonBlack > 0.3, Hv.frames[0] && Hv.frames[0].barcode.n);
    check('H: recorded audio matches song[60…]', HvA.ncc > 0.6, HvA);
    check('H: palette survives encode (max channel error ≤ 12)', Hv.frames[0].colour.maxErr <= 12, Hv.frames[0].colour.maxErr);
    // frame vs audio offset: both should be near zero after the start-event sync
    const vOff = (Hv.frames[0].barcode.n - 1845) / 30 * 1000;
    console.log(`H: video offset ${vOff.toFixed(0)} ms, audio lag ${HvA.lagMs} ms, A/V skew ${(vOff - HvA.lagMs).toFixed(0)} ms`);
    check('H: A/V skew within ±2 frames', Math.abs(vOff - HvA.lagMs) <= 70, { vOff, aLag: HvA.lagMs });
    const Hc = await page.evaluate(async () => {
      const ex = new MV.Exporter({ director: DX.stubDirector, stageFactory: (c, o) => new DX.StubStage({ canvas: c, scale: o.scale }), audioBuffer: DX.buffers.song, width: 320, height: 180, range: [60, 70], method: 'mediarecorder' });
      const p = ex.run();
      await new Promise((r) => setTimeout(r, 800));
      const t = performance.now();
      ex.cancel();
      const name = await p.then(() => null, (e) => e.name);
      return { name, ms: Math.round(performance.now() - t), state: ex.state };
    });
    check('H: cancel() during realtime capture → AbortError', Hc.name === 'AbortError' && Hc.ms < 500, Hc);
  }

  /* ---------------- L: full song (LONG=1) ---------------- */
  if (process.env.LONG) {
    await page.evaluate(() => DX.buildDirector({ mode: 'stub' }));
    const L = await page.evaluate(() => DX.exportClip({ width: 320, height: 180, fps: 30, range: [0, 221.27], mux: 'stream' }));
    console.log('L full song:', JSON.stringify({ frames: L.frames, bytes: L.bytes, elapsed: L.elapsed, fps: L.fpsRendered, audioChunks: L.audioChunks, keyFrames: L.keyFrames, mux: L.mux }));
    await saveBlob(page, 'L-full-song-320x180.mp4');
    const Li = await page.evaluate(() => DX.inspectLast());
    const Lv = await page.evaluate(() => DX.verifyVideo(DX.lastBlob(), { times: [200 + 0.5 / 30, 221.2], barcode: true }));
    const LvA = await page.evaluate(() => DX.verifyAudio(DX.lastBlob(), { ref: DX.buffers.song, t0: 0, at: 200 }));
    check('L: full song 6638 frames, fast start, ≈ 221.27 s', L.frames === 6638 && L.videoChunks === 6638 && Li.fastStart && near(Li.mvhd.seconds, 221.27, 0.1) && L.keyFrames === 111, { frames: L.frames, dur: Li.mvhd.seconds, keys: L.keyFrames, order: Li.order });
    check('L: seek 200 s → frame 6000; audio at 200 s matches', Lv.frames[0].barcode.n === 6000 && LvA.ncc > 0.8 && Math.abs(LvA.lagMs) < 12, { n: Lv.frames.map((f) => f.barcode.n), ncc: LvA.ncc, lag: LvA.lagMs });
  }

  /* ---------------- R: real Director + Stage ---------------- */
  if (!process.env.SKIP_REAL) {
    const info = await page.evaluate((lyr) => DX.buildDirector({ mode: 'real', lyrics: lyr || undefined }), LYRICS);
    console.log('real director:', JSON.stringify(info));
    const R = await page.evaluate(() => DX.exportClip({ width: 640, height: 360, fps: 30, range: [60, 65] }));
    console.log('R export:', JSON.stringify(Object.assign({}, R, { stageErrors: R.stageErrors.length })));
    if (R.stageErrors.length && !LYRICS) console.log('R stage errors:', R.stageErrors.join(' | '));
    await saveBlob(page, 'R-real-640x360.mp4');
    const Ri = await page.evaluate(() => DX.inspectLast());
    check('R: real export structure', Ri.fastStart && Ri.tracks.length === 2 && near(Ri.mvhd.seconds, 5, 0.1) && R.videoChunks === 150, { order: Ri.order, dur: Ri.mvhd.seconds });
    const times = [0.5, 1.5, 2.5 + 0.5 / 30, 3.5, 4.5];
    const Rv = await page.evaluate((times) => DX.verifyVideo(DX.lastBlob(), { times, png: true }), times);
    check('R: <video> decodes real frames (not black)', !Rv.error && near(Rv.duration, 5, 0.1) && Rv.frames.every((f) => f.stats.nonBlack > 0.05), Rv.frames.map((f) => f.stats));
    // contact sheet
    const sheet = await page.evaluate(async (urls) => {
      const imgs = await Promise.all(urls.map((u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; })));
      const c = document.createElement('canvas');
      c.width = 640 * 3 + 16; c.height = 360 * 2 + 8;
      const x = c.getContext('2d');
      x.fillStyle = '#E60012'; x.fillRect(0, 0, c.width, c.height);
      imgs.forEach((im, k) => x.drawImage(im, (k % 3) * 648, Math.floor(k / 3) * 368, 640, 360));
      return c.toDataURL('image/png');
    }, Rv.frames.map((f) => f.png));
    saveDataURL('R-real-sheet.png', sheet);
    // export frame vs a fresh preview Stage at the same t (and ±1 frame)
    const cmp = await page.evaluate(async (frameUrl) => {
      const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = frameUrl; });
      const a = document.createElement('canvas'); a.width = 640; a.height = 360;
      const ax = a.getContext('2d', { willReadFrequently: true }); ax.drawImage(img, 0, 0);
      const A = ax.getImageData(0, 0, 640, 360).data;
      const canvas = document.createElement('canvas');
      const st = new MV.Stage({ canvas, scale: 1 / 3, adaptive: false });
      st.setDirector(DX.director);
      await st.prepare();
      const b = document.createElement('canvas'); b.width = 640; b.height = 360;
      const bx = b.getContext('2d', { willReadFrequently: true });
      const out = {};
      for (const dt of [-2, -1, 0, 1, 2]) {
        st.renderFrame(62.5 + dt / 30);
        bx.drawImage(canvas, 0, 0, 640, 360);
        const B = bx.getImageData(0, 0, 640, 360).data;
        let s = 0;
        for (let i = 0; i < A.length; i += 4) s += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
        out[dt] = +(s / (A.length / 4) / 3).toFixed(2);
      }
      st.dispose();
      return out;
    }, Rv.frames[2].png);
    console.log('R export-vs-preview mean abs diff by frame offset:', JSON.stringify(cmp));
    check('R: exported frame at 2.5 s matches preview render of t = 62.5 best', cmp[0] <= Math.min(cmp[-1], cmp[1], cmp[-2], cmp[2]) && cmp[0] < 12, cmp);
    // speed at 720p / 1080p (chorus)
    for (const [w, h, range] of [[1280, 720, [46.5, 48.5]], [1920, 1080, [142.5, 143.5]]]) {
      const S = await page.evaluate((a) => DX.exportClip({ width: a[0], height: a[1], fps: 30, range: a[2] }), [w, h, range]);
      console.log(`speed ${w}x${h}: ${S.frames} frames, render ${S.fpsRendered.toFixed(2)} fps, total ${S.elapsed.toFixed(2)} s, ${(S.bytes / 1e6).toFixed(2)} MB, ${S.codec}, ${S.bitrate / 1e6} Mbps`);
      check(`R: ${w}x${h} export ok`, S.videoChunks === S.frames, { fps: +S.fpsRendered.toFixed(2), s: +S.elapsed.toFixed(2) });
      if (h === 1080) {
        await saveBlob(page, 'R-real-1080p.mp4');
        const v = await page.evaluate(() => DX.verifyVideo(DX.lastBlob(), { times: [0.5], png: true }));
        saveDataURL('R-real-1080p-frame.png', v.frames[0].png);
        check('R: 1080p decodes 1920x1080', v.videoWidth === 1920 && v.videoHeight === 1080 && v.frames[0].stats.nonBlack > 0.05, v.frames[0].stats);
      }
    }
  }

  // page console (suppressed when real lyrics were used: messages could quote text)
  const relevant = consoleErrors.filter((m) => /Exporter|export\.js|mp4|Mp4Muxer|VideoEncoder|AudioEncoder/i.test(m));
  console.log(`page console warnings/errors: ${consoleErrors.length} (exporter-related: ${relevant.length})`);
  if (!LYRICS) relevant.slice(0, 10).forEach((m) => console.log('  ' + m.slice(0, 240)));
  console.log(`\n${pass} passed, ${fail} failed`);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ caps, pass, fail, report }, null, 1));
  await browser.close();
  if (server) server.kill();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('harness error:', e);
  if (server) server.kill();
  process.exit(2);
});

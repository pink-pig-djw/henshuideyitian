/*
 * App shell test (index.html + js/app.js + css/app.css), Playwright.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node mv/tools/test-app.cjs [--only=name,name] [--port=8708]
 *
 * Env:
 *   MV_LYRICS        optional path to a local lyric file OUTSIDE the repo (real lyrics are
 *                    only read at test time and never printed — counts only)
 *   MV_LYRICS_CLEAN  optional second lyric file (clean line-per-line variant)
 *   MV_PORT          server port (default 8708; a python http.server is started if needed)
 *
 * Screenshots go to mv/out/app-ui/ (git-ignored); frames showing user lyrics go to
 * mv/out/app-ui/real/. Google Fonts are served through an on-disk cache
 * (mv/out/app-ui/.fontcache) filled with curl, because hundreds of unicode-range
 * requests through the sandbox proxy are very slow in Chromium.
 *
 * Placeholder lyrics below are invented for this test (not from any song).
 */
'use strict';
const { chromium } = require('playwright');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'out', 'app-ui');
const REAL = path.join(OUT, 'real');
const CACHE = path.join(OUT, '.fontcache');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const PORT = +(args.port || process.env.MV_PORT || 8708);
const BASE = `http://localhost:${PORT}/index.html`;
const ONLY = args.only ? String(args.only).split(',') : null;
const SCRATCH = '/tmp/claude-0/-home-user-henshuideyitian/fa2047da-052a-571c-86e1-0c494fa37d08/scratchpad';
const LYRICS = process.env.MV_LYRICS || path.join(SCRATCH, 'lyrics_user_paste.txt');
const LYRICS_CLEAN = process.env.MV_LYRICS_CLEAN || path.join(SCRATCH, 'lyrics_user.txt');
const HAS_SONG = fs.existsSync(path.join(ROOT, 'assets', 'song.mp3'));

// Invented placeholder lines (original, not from any song).
const PLACEHOLDER = [
  '夜明けの駅で 君を待つ',
  '遠い街の灯り ひとつずつ消えて',
  '振り返らずに 進むだけ Keep moving on',
  '空 いつも 同じ 色',
  '明日の扉を 叩く音',
].join('\n');

fs.mkdirSync(REAL, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail != null ? '  — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}
function curl(url, ua) {
  return new Promise((res, rej) =>
    execFile('curl', ['-sS', '-L', '--max-time', '40', '-A', ua || 'Mozilla/5.0 Chrome/124', '-D', '-', '-o', '-', url],
      { encoding: 'buffer', maxBuffer: 64 << 20 }, (e, out) => (e ? rej(e) : res(out))));
}
async function fontRoute(route) {
  const req = route.request();
  const url = req.url();
  const f = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex'));
  try {
    if (!fs.existsSync(f)) {
      const raw = await curl(url, req.headers()['user-agent']);
      let idx = 0;
      let pos;
      while ((pos = raw.indexOf('\r\n\r\n', idx)) >= 0 && /^HTTP\//.test(raw.slice(pos + 4, pos + 9).toString())) idx = pos + 4;
      pos = raw.indexOf('\r\n\r\n', idx);
      const head = raw.slice(idx, pos).toString();
      if (!/ 200/.test(head.split('\r\n')[0])) throw new Error(head.split('\r\n')[0]);
      fs.writeFileSync(f, raw.slice(pos + 4));
      fs.writeFileSync(f + '.ct', (head.match(/content-type:\s*([^\r\n]+)/i) || [])[1] || 'application/octet-stream');
    }
    await route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': fs.readFileSync(f + '.ct', 'utf8'), 'access-control-allow-origin': '*' } });
  } catch (e) {
    await route.abort();
  }
}
function ping() {
  return new Promise((res) => {
    const r = http.get(BASE, (x) => {
      x.resume();
      res(x.statusCode === 200);
    });
    r.on('error', () => res(false));
    r.setTimeout(2000, () => {
      r.destroy();
      res(false);
    });
  });
}
async function ensureServer() {
  if (await ping()) return null;
  const p = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' });
  for (let i = 0; i < 40 && !(await ping()); i++) await new Promise((r) => setTimeout(r, 150));
  return p;
}

let browser;
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
/** New context + page; collects console errors / page errors. */
async function openPage(query, opts = {}) {
  const ctx = opts.context || (await browser.newContext(Object.assign({
    viewport: { width: opts.w || 1440, height: opts.h || 900 },
    deviceScaleFactor: opts.dpr || 1,
    proxy, ignoreHTTPSErrors: true,
  }, opts.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {})));
  if (!opts.context) await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, fontRoute);
  if (opts.block) await ctx.route(opts.block, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  const warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200));
    else if (m.type() === 'warning') warnings.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));
  await page.goto(BASE + (query || ''), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => MV.app.ready);
  return { ctx, page, errors, warnings };
}
const state = (page) => page.evaluate(() => MV.app.getState());
const shot = (page, name, dir = OUT) => page.screenshot({ path: path.join(dir, name + '.png') });
const readLyrics = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const want = (name) => !ONLY || ONLY.includes(name);

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */
async function testBootMenu() {
  console.log('\n[boot + menu] no audio, 1440x900');
  const { ctx, page, errors } = await openPage('?test=1&autoload=0');
  const st = await state(page);
  check('boots in attract mode', st.mode === 'attract' && !st.audio && st.menu, { mode: st.mode, menu: st.menu });
  check('no missing modules', st.missing.length === 0, st.missing);
  const menuVis = await page.evaluate(() => getComputedStyle(document.getElementById('menu')).visibility);
  check('menu visible', menuVis === 'visible');
  const items = await page.$$eval('.mi', (els) => els.map((e) => e.dataset.act));
  check('menu items', JSON.stringify(items) === JSON.stringify(['play', 'audio', 'lyrics', 'sync', 'export', 'settings']), items);
  const status = await page.evaluate(() => ['stAudioRow', 'stPresetRow', 'stLyricsRow'].map((id) => document.getElementById(id).dataset.state));
  check('status rows (off/off/off)', status.join() === 'off,off,off', status);
  // Hover jiggle: plate turns white, red shadow plate shifts.
  await page.hover('.mi[data-act="lyrics"]');
  await page.waitForTimeout(400);
  const hov = await page.evaluate(() => {
    const b = document.querySelector('.mi[data-act="lyrics"]');
    return { after: getComputedStyle(b, '::after').backgroundColor, before: getComputedStyle(b, '::before').transform, anim: getComputedStyle(b).animationName };
  });
  check('menu hover state (white plate + shifted red shadow + jiggle)', hov.after === 'rgb(255, 255, 255)' && hov.before !== 'none' && hov.anim === 'mi-jiggle', hov);
  await shot(page, 'desktop-menu-noaudio');
  // Canvas actually painted (attract frame).
  const px = await page.evaluate(() => {
    const c = document.getElementById('stage');
    const t = document.createElement('canvas');
    t.width = 64;
    t.height = 36;
    const x = t.getContext('2d');
    x.drawImage(c, 0, 0, 64, 36);
    const d = x.getImageData(0, 0, 64, 36).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
    return lit / (64 * 36);
  });
  check('attract frame painted', px > 0.2, { litFraction: +px.toFixed(3) });
  // Menu → lyrics panel by click.
  await page.click('.mi[data-act="lyrics"]');
  await page.waitForTimeout(100);
  check('menu LYRICS opens the lyrics panel', (await state(page)).panel === 'lyrics');
  await page.keyboard.press('Escape'); // blur textarea
  await page.keyboard.press('Escape'); // close panel
  check('Escape closes the panel', (await state(page)).panel === null);
  // PLAY without audio → toast + file picker (file chooser event).
  const chooser = page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null);
  await page.click('.mi[data-act="play"]');
  check('PLAY without audio opens the audio picker', !!(await chooser));
  check('zero console errors (boot/menu)', errors.length === 0, errors);
  await ctx.close();
}

async function testKeyboard() {
  console.log('\n[keyboard]');
  const { ctx, page, errors } = await openPage('?test=1&autoload=0');
  await page.evaluate(() => MV.app.closeMenu());
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  const press = async (k) => {
    await page.keyboard.press(k);
    await page.waitForTimeout(60);
    return state(page);
  };
  let st = await state(page);
  const menu0 = st.menu;
  st = await press('m');
  check('M toggles menu', st.menu !== menu0, { before: menu0, after: st.menu });
  if (st.menu) st = await press('m');
  st = await press('l');
  check('L opens lyrics', st.panel === 'lyrics');
  await page.keyboard.press('Escape');
  st = await press('l');
  check('L toggles lyrics closed (after blur)', st.panel === null, st.panel);
  st = await press(',');
  check(', opens settings', st.panel === 'settings');
  st = await press('e');
  check('E opens export', st.panel === 'export');
  st = await press('e');
  check('E closes export', st.panel === null);
  const off0 = st.lyricOffset;
  st = await press(']');
  st = await press(']');
  st = await press('[');
  check('] ] [ → offset +0.05', Math.abs(st.lyricOffset - off0 - 0.05) < 1e-6, { from: off0, to: st.lyricOffset });
  await page.evaluate(() => MV.app.setLyricOffset(0));
  st = await press('d');
  const dbgVis = await page.evaluate(() => !document.getElementById('debugBox').hidden);
  check('D toggles debug', st.settings.debug && dbgVis);
  st = await press('d');
  st = await press('h');
  check('H hides UI', st.uiHidden && (await page.evaluate(() => document.body.classList.contains('ui-hidden'))));
  st = await press('h');
  check('H shows UI again', !st.uiHidden);
  st = await press('s');
  const toastTxt = await page.evaluate(() => document.getElementById('toasts').textContent);
  check('S without audio → toast', /音频/.test(toastTxt) && !st.sync);
  await press('f'); // fullscreen may be refused headless — must not throw
  check('keyboard: zero console errors', errors.length === 0, errors);
  await ctx.close();
}

async function testDragDrop() {
  console.log('\n[drag & drop] DataTransfer: lyrics .txt, then a synthetic .wav');
  const { ctx, page, errors } = await openPage('?test=1&autoload=0');
  // Lyrics text file.
  await page.evaluate((txt) => {
    const dt = new DataTransfer();
    dt.items.add(new File([txt], 'placeholder.txt', { type: 'text/plain' }));
    const fire = (type) => window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    fire('dragenter');
    fire('dragover');
    window.__dropVisible = !document.getElementById('drop').hidden;
  }, PLACEHOLDER);
  await page.waitForTimeout(350);
  await shot(page, 'desktop-drop-overlay');
  check('drop overlay shows on dragenter', await page.evaluate(() => window.__dropVisible));
  await page.evaluate((txt) => {
    const dt = new DataTransfer();
    dt.items.add(new File([txt], 'placeholder.txt', { type: 'text/plain' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, PLACEHOLDER);
  await page.waitForTimeout(300);
  let st = await state(page);
  check('dropped .txt → lyrics applied', st.lyrics.lines > 0, st.lyrics);
  check('drop overlay hidden after drop', await page.evaluate(() => document.getElementById('drop').hidden));
  const stored = await page.evaluate(() => localStorage.getItem('mv.lyrics.last'));
  check('lyrics persisted to localStorage', stored && stored.length === PLACEHOLDER.length);
  // Synthetic audio file (4 s, 120 BPM clicks over a tone) → decode + analysis.
  await page.evaluate(() => {
    const sr = 22050, sec = 4, n = sr * sec;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const t = i / sr, ph = t % 0.5;
      const s = 0.25 * Math.sin(2 * Math.PI * 220 * t) + (ph < 0.03 ? 0.7 * Math.sin(2 * Math.PI * 60 * t) * (1 - ph / 0.03) : 0);
      v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32000, true);
    }
    const dt = new DataTransfer();
    dt.items.add(new File([buf], 'placeholder-beat.wav', { type: 'audio/wav' }));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => MV.app.getState().audio && !MV.app._state.loading, null, { timeout: 60000 });
  st = await state(page);
  check('dropped .wav → audio loaded + analysed', st.audio && st.audio.name === 'placeholder-beat.wav' && Math.abs(st.audio.duration - 4) < 0.05 && st.mode === 'song', { audio: st.audio, analysis: st.analysis, preset: st.preset });
  check('unknown song → no preset match', st.preset === null);
  check('lyrics re-timed for the new song', st.lyrics.lines > 0, st.lyrics);
  // IndexedDB cache got the dropped file.
  const cached = await page.evaluate(() => MV.AudioEngine.cacheLoad().then((c) => (c ? c.name : null)));
  check('dropped audio saved to IndexedDB cache', cached === 'placeholder-beat.wav', cached);
  check('drag & drop: zero console errors', errors.length === 0, errors);
  // Reload in the same browser profile, assets/ probing off → audio restored from the cache,
  // lyrics restored from localStorage.
  const again = await openPage('?test=1&assets=0', { context: ctx });
  st = await state(again.page);
  check('reload → audio restored from IndexedDB cache', st.audio && st.audio.name === 'placeholder-beat.wav' && st.audio.source === 'cache', st.audio);
  check('reload → lyrics restored', st.lyrics.lines > 0);
  check('cache reload: zero console errors', again.errors.length === 0, again.errors);
  await ctx.close();
}

async function testRealSong() {
  if (!HAS_SONG) {
    console.log('\n[real song] skipped (mv/assets/song.mp3 missing)');
    return;
  }
  console.log('\n[real song] auto-load assets/song.mp3, lyrics from local file (never printed)');
  const t0 = Date.now();
  const { ctx, page, errors } = await openPage('?test=1');
  let st = await state(page);
  check('auto-loaded assets/song.mp3', st.audio && st.audio.source === 'url', { audio: st.audio, ms: Date.now() - t0 });
  check('preset matched (confidence ≥ 0.5)', st.preset === 'hoshi-to-bokura-to' && st.confidence >= 0.5, { preset: st.preset, confidence: st.confidence, offset: st.offset });
  const status = await page.evaluate(() => ['stAudioRow', 'stPresetRow'].map((id) => document.getElementById(id).dataset.state));
  check('status rows audio/preset ok', status.join() === 'ok,ok', status);
  const txt = readLyrics(LYRICS);
  if (txt) {
    const ls = await page.evaluate((t) => MV.app.setLyricsText(t), txt);
    check('raw paste: 12 displayed, 5 skipped (not sung)', ls.lines === 12 && ls.skipped === 5 && ls.source === 'preset', { lines: ls.lines, matched: ls.matched, skipped: ls.skipped, fallback: ls.fallback, missing: ls.missing });
    const sl = await page.evaluate(() => document.getElementById('stLyrics').textContent);
    check('status line says 已匹配 12 句，5 句本录音未演唱', sl.indexOf('已匹配 12 句，5 句本录音未演唱') === 0);
  }
  const clean = readLyrics(LYRICS_CLEAN);
  if (clean) {
    const ls = await page.evaluate((t) => MV.app.setLyricsText(t), clean);
    check('clean file: 12 displayed, 5 skipped', ls.lines === 12 && ls.skipped === 5, { lines: ls.lines, skipped: ls.skipped });
  }
  if (!txt && !clean) {
    const ls = await page.evaluate((t) => MV.app.setLyricsText(t), PLACEHOLDER);
    check('placeholder lyrics applied (order fallback)', ls.lines > 0, ls);
  }
  await page.evaluate(() => MV.app.openMenu());
  await page.waitForTimeout(50);
  await shot(page, 'desktop-menu-ready', txt || clean ? REAL : OUT);
  await page.evaluate(() => MV.app.closeMenu());
  const times = [5.0, 16.8, 47.5, 71.6, 96.0, 112.0, 150.0, 200.0, 216.0];
  const ms = [];
  for (const t of times) {
    const r = await page.evaluate((x) => MV.app.renderAt(x), t);
    ms.push(Math.round(r.ms));
    await shot(page, 'frame-' + t.toFixed(1), txt || clean ? REAL : OUT);
  }
  st = await state(page);
  check('renderAt(t) renders requested frame, paused', Math.abs(st.t - 216) < 0.01 && !st.playing, { t: st.t, frameMs: ms });
  // Offset re-times the track (±2 s clamp).
  const lt0 = await page.evaluate(() => MV.app.track.lines[0].start);
  await page.evaluate(() => MV.app.setLyricOffset(0.5));
  const lt1 = await page.evaluate(() => MV.app.track.lines[0].start);
  check('lyric offset +0.5 s shifts line starts', Math.abs(lt1 - lt0 - 0.5) < 1e-3, { d: +(lt1 - lt0).toFixed(3) });
  await page.evaluate(() => MV.app.setLyricOffset(9));
  check('offset clamps to +2 s', (await state(page)).lyricOffset === 2);
  await page.evaluate(() => MV.app.setLyricOffset(0));
  // Playback.
  await page.evaluate(() => {
    MV.app.seek(46.3);
    MV.app.play();
  });
  await page.waitForTimeout(2500);
  st = await state(page);
  check('play: clock advances, frames render', st.playing && st.t > 47.5 && st.fps > 0, { t: +st.t.toFixed(2), fps: st.fps, frameMs: st.frameMs, scale: st.scale });
  await shot(page, 'desktop-playing', txt || clean ? REAL : OUT);
  await page.keyboard.press('Space');
  st = await state(page);
  check('Space pauses', !st.playing);
  const tA = st.t;
  await page.keyboard.press('ArrowRight');
  st = await state(page);
  check('→ seeks +5 s', Math.abs(st.t - tA - 5) < 0.1, { from: +tA.toFixed(2), to: +st.t.toFixed(2) });
  // Seek bar click.
  const box = await page.locator('#seek').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  st = await state(page);
  check('seek bar click → middle of the song', Math.abs(st.t - st.audio.duration * 0.5) < 3, { t: +st.t.toFixed(2) });
  // Sync editor opens / closes.
  await page.keyboard.press('s');
  await page.waitForTimeout(150);
  check('S opens the sync editor', (await state(page)).sync);
  await shot(page, 'desktop-sync', txt || clean ? REAL : OUT);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Esc closes the sync editor', !(await state(page)).sync);
  // Export via the API: 1 s at 720p30.
  const ex = await page.evaluate(async () => {
    const r = await MV.app.exportVideo({ resolution: 720, fps: 30, range: [46.3, 47.3] });
    return { bytes: r.bytes || r.blob.size, container: r.container, frames: r.frames, codec: r.codec, method: r.method, w: r.width, h: r.height };
  });
  check('exportVideo (API) 1 s @ 720p30', ex.bytes > 10000 && ex.frames === 30 && ex.w === 1280, ex);
  // Export via the UI: custom range, 1 s.
  await page.keyboard.press('e');
  await page.click('#exRange button[data-v="custom"]');
  await page.fill('#exFrom', '1:06.5');
  await page.fill('#exTo', '1:07.5');
  await page.click('#exRes button[data-v="720"]');
  const summary = await page.evaluate(() => document.getElementById('exSummary').textContent);
  check('export summary reflects custom range', /1:06\.50/.test(summary) && /30 帧/.test(summary), summary);
  await page.click('#btnExportStart');
  await page.waitForSelector('#exDownload', { timeout: 120000 });
  const href = await page.getAttribute('#exDownload', 'href');
  const dl = await page.getAttribute('#exDownload', 'download');
  check('export UI → download link (object URL)', /^blob:/.test(href) && /\.(mp4|webm)$/.test(dl), { dl });
  await shot(page, 'desktop-export-done', txt || clean ? REAL : OUT);
  // Cancel: whole song at 1080p, cancel as soon as frames are rendering.
  await page.click('#exRange button[data-v="all"]');
  await page.click('#exRes button[data-v="1080"]');
  await page.click('#btnExportStart');
  await page.waitForFunction(() => /帧/.test(document.getElementById('exInfo').textContent) && parseInt(document.getElementById('exPct').textContent, 10) >= 0 && MV.app.getState().exporting, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const prog = await page.evaluate(() => ({ pct: document.getElementById('exPct').textContent, info: document.getElementById('exInfo').textContent.replace(/[^\x00-\x7F帧剩余渲染中编码]/g, '') }));
  await shot(page, 'desktop-export-progress', txt || clean ? REAL : OUT);
  await page.click('#btnExportCancel');
  await page.waitForFunction(() => !MV.app.getState().exporting, null, { timeout: 30000 });
  const cancelTxt = await page.evaluate(() => document.getElementById('exResult').textContent);
  check('export progress shows frames/ETA, cancel works', /已取消/.test(cancelTxt) && /帧/.test(prog.info), prog);
  check('real song: zero console errors', errors.length === 0, errors);
  await ctx.close();
}

async function testMobile() {
  console.log('\n[mobile] 390x844');
  const { ctx, page, errors } = await openPage('?test=1&autoload=0', { w: 390, h: 844, mobile: true });
  await shot(page, 'mobile-menu');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.getElementById('menu').scrollWidth > window.innerWidth + 1);
  check('mobile: no horizontal overflow', !overflow);
  await page.evaluate((t) => MV.app.setLyricsText(t), PLACEHOLDER);
  await page.evaluate(() => MV.app.closeMenu());
  await page.evaluate(() => MV.app.renderAt(48.2));
  await shot(page, 'mobile-stage');
  const cw = await page.evaluate(() => document.getElementById('stage').getBoundingClientRect().width);
  check('mobile: canvas fits the width', Math.abs(cw - 390) < 1, cw);
  const bar = await page.locator('#bar').boundingBox();
  check('mobile: bar within viewport', bar && bar.y + bar.height <= 844 + 1 && bar.width <= 391, bar);
  await page.evaluate(() => MV.app.openPanel('lyrics'));
  await page.waitForTimeout(100);
  await shot(page, 'mobile-lyrics');
  const pb = await page.locator('#panelLyrics').boundingBox();
  check('mobile: lyrics sheet inside viewport', pb && pb.x >= 0 && pb.x + pb.width <= 390 && pb.y >= 0, pb);
  await page.evaluate(() => MV.app.openPanel('settings'));
  await page.waitForTimeout(100);
  await shot(page, 'mobile-settings');
  check('mobile: zero console errors', errors.length === 0, errors);
  await ctx.close();
}

async function testParams() {
  console.log('\n[url params]');
  const q = HAS_SONG ? '?test=1&t=112&hud=0&quality=0.5&debug=1' : '?test=1&autoload=0&t=112&hud=0&quality=0.5&debug=1';
  const { ctx, page, errors } = await openPage(q);
  const st = await state(page);
  check('?t=112 → paused at 112, menu closed', Math.abs(st.t - 112) < 0.01 && !st.playing && !st.menu, { t: st.t, menu: st.menu });
  check('?hud=0', st.settings.hud === false);
  check('?quality=0.5 → scale 0.5, not adaptive', st.scale === 0.5 && st.settings.quality === '0.5', { scale: st.scale });
  check('?debug=1 → debug overlay', st.settings.debug && (await page.evaluate(() => !document.getElementById('debugBox').hidden)));
  await page.waitForTimeout(400);
  await shot(page, 'desktop-params-debug');
  check('params: zero console errors', errors.length === 0, errors);
  await ctx.close();
  // ?lyrics=<text> (URL-encoded placeholder) and ?autoplay=1.
  const q2 = '?test=1&lyrics=' + encodeURIComponent(PLACEHOLDER) + (HAS_SONG ? '&autoplay=1' : '&autoload=0');
  const p2 = await openPage(q2);
  await p2.page.waitForTimeout(800);
  const s2 = await state(p2.page);
  check('?lyrics=<text> → lyrics loaded (not persisted)', s2.lyrics.lines > 0 && !(await p2.page.evaluate(() => localStorage.getItem('mv.lyrics.last'))), s2.lyrics.lines);
  if (HAS_SONG) check('?autoplay=1 → playing, menu closed', s2.playing && !s2.menu, { playing: s2.playing, t: +s2.t.toFixed(2) });
  check('params 2: zero console errors', p2.errors.length === 0, p2.errors);
  await p2.ctx.close();
}

async function testPersistence() {
  console.log('\n[persistence] paste in the panel, reload');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, proxy, ignoreHTTPSErrors: true });
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, fontRoute);
  let { page, errors } = await openPage('?test=1&autoload=0', { context: ctx });
  await page.evaluate(() => MV.app.openPanel('lyrics'));
  await page.fill('#lyricsText', PLACEHOLDER);
  await page.click('#btnLyricsApply');
  let st = await state(page);
  check('panel APPLY → lyrics', st.lyrics.lines > 0, st.lyrics);
  await page.evaluate(() => MV.app.setSetting('credits', false));
  await page.close();
  ({ page, errors } = await openPage('?test=1&autoload=0', { context: ctx }));
  st = await state(page);
  check('reload → lyrics restored from localStorage', st.lyrics.lines > 0);
  check('reload → settings restored', st.settings.credits === false);
  await page.click('.mi[data-act="lyrics"]');
  await page.click('#btnLyricsClear');
  st = await state(page);
  check('CLEAR removes lyrics (and storage)', st.lyrics.lines === 0 && !(await page.evaluate(() => localStorage.getItem('mv.lyrics.last'))));
  check('persistence: zero console errors', errors.length === 0, errors);
  await ctx.close();
}

async function testMissingModules() {
  console.log('\n[missing modules] analysis / director / scenes / export / sync blocked');
  const block = /\/js\/(analysis|director|export|sync)\.js$|\/js\/render\/scenes\.js$/;
  const { ctx, page, errors } = await openPage('?test=1&autoload=0', { block });
  const st = await state(page);
  const pageErrors = errors.filter((e) => /^pageerror/.test(e));
  const other = errors.filter((e) => !/^pageerror/.test(e) && !/Failed to load resource/.test(e));
  check('no uncaught page errors', pageErrors.length === 0, pageErrors);
  check('only the blocked-resource errors in the console', other.length === 0, other);
  check('missing modules detected', st.missing.some((m) => /Analysis/.test(m)) && st.missing.some((m) => /Director/.test(m)), st.missing.length);
  const toast = await page.evaluate(() => document.getElementById('toasts').textContent);
  check('missing-module toast shown', /部分模块未载入/.test(toast));
  await page.evaluate((t) => MV.app.setLyricsText(t), PLACEHOLDER);
  await page.keyboard.press('e');
  await page.keyboard.press('s');
  await page.evaluate(() => MV.app.renderAt(20));
  await shot(page, 'desktop-missing-modules');
  check('UI still usable', (await state(page)).panel === 'export');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
(async () => {
  const server = await ensureServer();
  browser = await chromium.launch({
    proxy: proxy ? { server: 'per-context' } : undefined,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const t0 = Date.now();
  const tests = [
    ['boot', testBootMenu], ['keys', testKeyboard], ['drop', testDragDrop], ['mobile', testMobile],
    ['params', testParams], ['persist', testPersistence], ['missing', testMissingModules], ['real', testRealSong],
  ];
  for (const [name, fn] of tests) {
    if (!want(name)) continue;
    try {
      await fn();
    } catch (e) {
      check(name + ' crashed', false, e.message.split('\n')[0]);
    }
  }
  await browser.close();
  if (server) server.kill();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(1)} s` + (failed.length ? ' — FAILED: ' + failed.map((f) => f.name).join('; ') : ''));
  process.exit(failed.length ? 1 : 0);
})();

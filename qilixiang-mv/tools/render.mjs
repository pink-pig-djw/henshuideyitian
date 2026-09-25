// Frame-accurate offline renderer: drives index.html in headless Chromium,
// captures every frame as JPEG, then muxes the frames with the song via ffmpeg.
//
//   node tools/render.mjs                    full render -> out/七里香-MV.mp4
//   node tools/render.mjs --stills 30,95.5   single PNG stills -> build/stills/
//   node tools/render.mjs --from 80 --to 96  partial render (frames only, plus a preview clip)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));

const FPS = +(args.fps || 24);
const WORKERS = +(args.workers || 4);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const EXE = process.env.CHROMIUM || findChromium();

function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const d of fs.readdirSync(base).sort().reverse()) {
    const p = path.join(base, d, 'chrome-linux', 'chrome');
    if (d.startsWith('chromium-') && fs.existsSync(p)) return p;
  }
  return undefined;
}

async function openPage(url) {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-web-security', '--autoplay-policy=no-user-gesture-required', '--js-flags=--max-old-space-size=4096'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error' || args.verbose) console.log('[page]', m.text()); });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto(url);
  await page.evaluate(() => window.MV.ready);
  return { browser, page };
}

async function main() {
  const server = await startServer(0);
  const url = `http://127.0.0.1:${server.address().port}/index.html?render=1`;
  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });

  if (args.stills) {
    const dir = path.join(ROOT, 'build', 'stills');
    fs.mkdirSync(dir, { recursive: true });
    const { browser, page } = await openPage(url);
    for (const s of String(args.stills).split(',')) {
      const t = +s;
      const t0 = Date.now();
      const b64 = await page.evaluate(t => window.MV.still(t), t);
      const file = path.join(dir, `t${t.toFixed(2).padStart(7, '0')}.png`);
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      console.log(`still ${t}s -> ${path.relative(ROOT, file)} (${Date.now() - t0} ms)`);
    }
    await browser.close(); server.close();
    return;
  }

  const probe = await openPage(url);
  const duration = await probe.page.evaluate(() => window.MV.duration);
  await probe.browser.close();
  const fromF = Math.round((+(args.from || 0)) * FPS);
  const toF = Math.min(Math.ceil((+(args.to || duration)) * FPS), Math.ceil(duration * FPS));
  const frameDir = path.join(ROOT, 'build', 'frames');
  fs.mkdirSync(frameDir, { recursive: true });

  const total = toF - fromF;
  const chunk = Math.ceil(total / WORKERS);
  let done = 0; const tStart = Date.now();
  const work = Array.from({ length: WORKERS }, (_, w) => (async () => {
    const a = fromF + w * chunk, b = Math.min(toF, a + chunk);
    if (a >= b) return;
    const { browser, page } = await openPage(url);
    for (let f = a; f < b; f++) {
      const b64 = await page.evaluate(([f, fps]) => window.MV.frame(f / fps), [f, FPS]);
      fs.writeFileSync(path.join(frameDir, `f${String(f).padStart(6, '0')}.jpg`), Buffer.from(b64, 'base64'));
      done++;
      if (done % 48 === 0) {
        const el = (Date.now() - tStart) / 1000;
        process.stdout.write(`\r${done}/${total} frames  ${(done / el).toFixed(1)} fps  eta ${((total - done) / (done / el) / 60).toFixed(1)} min   `);
      }
    }
    await browser.close();
  })());
  await Promise.all(work);
  console.log(`\nrendered ${total} frames in ${((Date.now() - tStart) / 1000).toFixed(0)} s`);
  server.close();

  const full = fromF === 0 && toF >= Math.floor(duration * FPS) - 1;
  const outDir = path.join(ROOT, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const out = args.out ? path.resolve(args.out) : path.join(outDir, full ? '七里香-MV.mp4' : `preview-${fromF}-${toF}.mp4`);
  const crf = args.crf || (full ? '19' : '23');
  const ff = [
    '-y', '-hide_banner', '-loglevel', 'error', '-stats',
    '-framerate', String(FPS), '-start_number', String(fromF), '-i', path.join(frameDir, 'f%06d.jpg'),
    '-ss', String(fromF / FPS), '-t', String(total / FPS), '-i', path.join(ROOT, 'input', 'song.mp3'),
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', full ? 'slow' : 'veryfast', '-tune', 'animation', '-crf', crf,
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
    '-movflags', '+faststart',
    '-metadata', 'title=七里香 · 手绘动画 MV',
    '-shortest', out,
  ];
  await new Promise((res, rej) => {
    const p = spawn(FFMPEG, ff, { stdio: 'inherit' });
    p.on('exit', c => c === 0 ? res() : rej(new Error('ffmpeg failed ' + c)));
  });
  console.log('wrote', path.relative(ROOT, out));
}

main().catch(e => { console.error(e); process.exit(1); });

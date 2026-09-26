/*
 * Lyric-style screenshot + check harness (Playwright, Chromium).
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node mv/tools/shot-lyrics.cjs [--check] [--all] [--style=ransom,slash] [--sheets-only]
 *
 * Writes PNGs to mv/out/lyrics/ (git-ignored):
 *   <style>/<fixture>-<moment>.png   full 1920x1080 frames (lead-in, mid-reveal, fully revealed, exit)
 *   sheet-<style>.png                contact sheet (all fixtures x moments)
 * --check  layout fit (safe area / HUD) for every style x fixture x synthetic
 *          lengths 1..42, determinism (frame hashes), draw cost.
 *          With MV_LYRICS=<path to a local lyrics file outside the repo> it also
 *          parses that file with the preset (js/lyrics.js) and checks every
 *          displayed line in every style. Only counts / ids are printed.
 * Uses its own static server on PORT (default 8704) if none is running.
 */
'use strict';
// Playwright appends "<-loopback>" to Chromium's proxy bypass list, which would
// route http://localhost through the HTTPS-only proxy (→ 405). Keep loopback direct.
process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK = '1';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8704);
const OUT = path.join(ROOT, 'out', 'lyrics');
const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n) => { const a = args.find((x) => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : null; };

function ping() {
  return new Promise((res) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/tools/dev-lyrics.html', timeout: 1500 }, (r) => { r.resume(); res(r.statusCode === 200); });
    req.on('error', () => res(false));
    req.on('timeout', () => { req.destroy(); res(false); });
  });
}
async function ensureServer() {
  if (await ping()) return null;
  const p = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 150)); if (await ping()) return p; }
  throw new Error('server did not start');
}
async function savePng(page, file) {
  const data = await page.evaluate(() => document.getElementById('cv').toDataURL('image/png'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
}

(async () => {
  const server = await ensureServer();
  const browser = await chromium.launch({
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1200 }, ignoreHTTPSErrors: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // The proxy occasionally drops a font request (a failed face silently falls
  // back to a system font), so verify every face is 'loaded' and retry.
  let faces = [];
  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.goto(`http://localhost:${PORT}/tools/dev-lyrics.html?shot=1`, { waitUntil: 'load', timeout: 120000 });
    await page.evaluate(() => window.LyricDev.ready);
    faces = await page.evaluate(async () => {
      await Promise.all(Array.from(document.fonts).map((f) => f.load().catch(() => null)));
      return Array.from(document.fonts).map((f) => [f.family + ' ' + f.weight, f.status]);
    });
    const want = await page.evaluate(() => window.LYRIC_FONT_FAMILIES || 0);
    const bad = faces.filter((f) => f[1] !== 'loaded');
    const ok = faces.length - bad.length;
    console.log(`fonts (attempt ${attempt}): ${ok}/${want} loaded` + (bad.length ? ' — missing ' + bad.map((f) => f[0]).join(', ') : ''));
    if (ok >= want) break;
    errors.length = 0;
  }
  await page.evaluate(() => window.LyricDev.render({ style: 'ransom', fx: 'jp3', moment: 'full' }));

  const styles = (opt('style') || 'ransom,slash,impact,dialog,vertical,card,split,glitch').split(',');
  const allFx = await page.evaluate(() => window.LyricDev.fixtures);
  const fxs = flag('all') ? allFx : ['jp3', 'tail', 'hook', 'max', 'one'];
  const moments = ['lead', 'mid', 'full', 'exit'];
  const bgFor = (style, k) => (style === 'vertical' || style === 'dialog' ? ['night', 'city', 'red', 'black'][k % 4] : ['red', 'black', 'city', 'night'][k % 4]);

  if (!flag('check') || flag('shots')) {
    for (const style of styles) {
      await page.evaluate((o) => window.LyricDev.sheet(o), { style, cw: 480 });
      await savePng(page, path.join(OUT, `sheet-${style}.png`));
      if (flag('sheets-only')) continue;
      let k = 0;
      for (const fx of fxs) {
        for (const m of moments) {
          await page.evaluate((o) => { const c = document.getElementById('cv'); c.width = 1920; c.height = 1080; return window.LyricDev.render(o); }, { style, fx, moment: m, bg: bgFor(style, k) });
          await savePng(page, path.join(OUT, style, `${fx}-${m}.png`));
        }
        k++;
      }
      console.log('shots:', style, flag('sheets-only') ? 'sheet' : fxs.length * moments.length + ' frames + sheet');
    }
  }

  if (flag('check')) {
    let fails = 0, total = 0;
    // Fixtures.
    for (const style of styles) {
      for (const fx of allFx) {
        const r = await page.evaluate((o) => window.LyricDev.check(o), { style, fx });
        total++;
        if (!r.ok) { fails++; console.log('FAIL fit', style, fx, JSON.stringify(r.bounds)); }
      }
    }
    // Synthetic lengths 1..42 (invented kana/kanji mixes, phrases of 2-9 chars, optional Latin tail).
    const synth = await page.evaluate(() => {
      const pool = Array.from('あいうえおかきくけこさしすせそたちつてとなにぬねの星空夜明街光風線路駅窓遠近走止歌声');
      const out = [];
      for (let n = 1; n <= 42; n++) {
        for (const tail of [false, true]) {
          if (tail && n < 16) continue;
          const phrases = [];
          let left = tail ? n - 16 : n, k = 0;
          while (left > 0) { const m = Math.min(left, 2 + ((n * 7 + k * 5) % 8)); let s = ''; for (let c = 0; c < m; c++) s += pool[(n * 13 + k * 7 + c * 3) % pool.length]; phrases.push(s); left -= m + 1; k++; }
          if (tail) phrases.push('Hold on to the light'.slice(0, 15));
          out.push(phrases.join('|'));
        }
      }
      return out;
    });
    for (const style of styles) {
      for (const text of synth) {
        const r = await page.evaluate((o) => window.LyricDev.check(o), { style, text });
        total++;
        if (!r.ok || !(r.size > 20)) { fails++; console.log('FAIL fit', style, 'len', r.chars, JSON.stringify(r.bounds), 'size', r.size); }
      }
    }
    console.log(`fit: ${total - fails}/${total} layouts inside safe area & clear of HUD`);

    // Minimum type sizes per style over the synthetic set (legibility).
    for (const style of styles) {
      const sizes = [];
      for (const text of synth) sizes.push((await page.evaluate((o) => window.LyricDev.check(o), { style, text })).size);
      console.log(`size ${style}: min ${Math.min(...sizes).toFixed(0)} px, median ${sizes.sort((a, b) => a - b)[sizes.length >> 1].toFixed(0)} px`);
    }

    // Determinism: same frame rendered twice (with other frames between) hashes identically.
    let det = 0, detN = 0;
    for (const style of styles) {
      for (const m of ['mid', 'full', 'exit']) {
        const o = { style, fx: 'tail', moment: m, bg: 'red' };
        const a = await page.evaluate((x) => window.LyricDev.hash(x), o);
        await page.evaluate((x) => window.LyricDev.hash(x), { style, fx: 'max', moment: 'mid', bg: 'black' });
        const b = await page.evaluate((x) => window.LyricDev.hash(x), o);
        detN++;
        if (a === b) det++; else console.log('FAIL determinism', style, m);
      }
    }
    console.log(`determinism: ${det}/${detN} identical`);

    // Draw cost.
    for (const style of styles) {
      const r = await page.evaluate((o) => window.LyricDev.perf(o), { style, fx: 'max', n: 80 });
      console.log(`perf ${style}: avg ${r.avg.toFixed(2)} ms, max ${r.max.toFixed(2)} ms (40-char line, headless CPU)`);
    }

    // Optional: real lyrics from a local file outside the repo (never printed).
    if (process.env.MV_LYRICS && fs.existsSync(process.env.MV_LYRICS)) {
      const text = fs.readFileSync(process.env.MV_LYRICS, 'utf8');
      await page.addScriptTag({ url: `http://localhost:${PORT}/js/lyrics.js` });
      const res = await page.evaluate(async ({ text, styles }) => {
        const preset = window.MV.getPreset('hoshi-to-bokura-to');
        const track = window.MV.Lyrics.parse(text, { preset });
        await window.MV.fonts.ensure(track.lines.map((l) => l.text).join(''), 15000);
        const out = { lines: track.lines.length, source: track.source, fails: [], checked: 0, minSize: {}, chars: [] };
        for (const l of track.lines) {
          out.chars.push(l.chars.length);
          for (const s of styles) {
            const r = window.LyricDev.checkLine(s, l);
            out.checked++;
            out.minSize[s] = Math.min(out.minSize[s] || 1e9, r.size);
            if (!r.ok) out.fails.push(s + ':' + l.id);
          }
        }
        return out;
      }, { text, styles });
      console.log(`real lyrics: ${res.lines} lines (${res.source}), char counts [${res.chars.join(',')}], ${res.checked - res.fails.length}/${res.checked} layouts fit`);
      console.log('real lyrics min size:', Object.entries(res.minSize).map(([k, v]) => k + ' ' + Math.round(v)).join(', '));
      if (res.fails.length) console.log('real lyrics FAIL:', res.fails.join(' '));
      if (process.env.MV_LYRICS_SHOTS) {
        // Local-only frames of the real lines (written to out/, git-ignored).
        const n = await page.evaluate(() => 0);
        void n;
      }
    }
  }

  console.log(errors.length ? 'page errors:\n  ' + errors.slice(0, 10).join('\n  ') : 'page errors: none');
  await browser.close();
  if (server) server.kill();
})().catch((e) => { console.error(e); process.exit(1); });

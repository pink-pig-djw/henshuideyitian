#!/usr/bin/env node
/*
 * Playwright check of MV.SyncEditor on tools/dev-sync.html (stub engine,
 * invented placeholder lyrics). Screenshots → mv/out/lyrics-sync/.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node mv/tools/test-sync-ui.cjs [port]
 *
 * Starts `python3 -m http.server <port>` on mv/ when nothing answers there.
 */
'use strict';
// Playwright ≥1.5x appends "<-loopback>" to the Chromium bypass list, which
// routes http://localhost through the HTTPS proxy (→ 405). Keep loopback direct.
process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK = '1';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = +(process.argv[2] || process.env.PORT || 8702);
const BASE = 'http://localhost:' + PORT;
const OUT = path.join(ROOT, 'out', 'lyrics-sync');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(name + (detail != null ? ' :: ' + detail : ''));
  }
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail != null ? '  [' + detail + ']' : ''));
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ping() {
  return new Promise((resolve) => {
    const req = http.get(BASE + '/tools/dev-sync.html', (res) => {
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

(async () => {
  let server = null;
  if (!(await ping())) {
    server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' });
    for (let i = 0; i < 50 && !(await ping()); i++) await sleep(100);
  }
  const browser = await chromium.launch({
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    /* ---------------------------------------------------------------- */
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true, ignoreHTTPSErrors: true });
    try {
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    } catch (e) {
      /* older playwright */
    }
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text()) && errors.push('console: ' + m.text()));
    await page.goto(BASE + '/tools/dev-sync.html');
    await page.waitForFunction(() => window.devSync && window.devSync.ready);
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.evaluate(() => localStorage.clear());

    await page.click('#open-sync');
    await page.waitForSelector('.sync-root.is-open');
    await page.evaluate(() => Promise.all(['400 20px Anton', '900 16px "Noto Sans SC"', '700 16px "Noto Sans JP"', '400 20px "Dela Gothic One"']
      .map((f) => document.fonts.load(f, '歌词同步あ星A').catch(() => null))));
    await sleep(350); // slide-in transition
    const rows = await page.$$eval('.sync-row', (r) => r.length);
    check('editor opens with 8 displayed lines', rows === 8, rows);
    check('isOpen', await page.evaluate(() => devSync.editor.isOpen));

    const base = await page.evaluate(() => devSync.track.lines.map((l) => ({ s: l.phrases.map((p) => p.start), e: l.end })));
    const W = () => page.evaluate(() => ({
      lines: devSync.editor.work.lines.map((l) => ({ s: l.phrases.map((p) => p.start), e: l.end })),
      sel: devSync.editor.sel, active: devSync.editor.active, pc: devSync.editor.pc,
    }));
    const freeze = (t) => page.evaluate((x) => devSync.engine.freeze(x), t);

    // Tap line 1 (index 0) at 4.5 → 4.42 (latency 0.08); phrase 2 at 6.0 → 5.92.
    await freeze(4.5);
    await page.keyboard.press('Space');
    let w = await W();
    check('Space stamps line start at t − 0.08', near(w.lines[0].s[0], 4.42, 1e-9), w.lines[0].s[0]);
    check('Space keeps phrase spacing', near(w.lines[0].s[1] - w.lines[0].s[0], base[0].s[1] - base[0].s[0], 1e-9));
    check('Space selects next line', w.sel === 1 && w.active === 0, w.sel + '/' + w.active);
    await freeze(6.0);
    await page.keyboard.press('p');
    w = await W();
    check('P stamps next phrase of the sung line', near(w.lines[0].s[1], 5.92, 1e-9), w.lines[0].s[1]);
    // Line 2: start + two phrases.
    await freeze(9.3);
    await page.keyboard.press('Space');
    await freeze(11.0);
    await page.keyboard.press('p');
    await freeze(12.9);
    await page.keyboard.press('P');
    w = await W();
    check('line 2 start + 2 phrases', near(w.lines[1].s[0], 9.22) && near(w.lines[1].s[1], 10.92) && near(w.lines[1].s[2], 12.82), w.lines[1].s.map((x) => x.toFixed(2)).join(','));
    await page.keyboard.press('p'); // no more phrases → toast only
    w = await W();
    check('extra P is a no-op', near(w.lines[1].s[2], 12.82));
    // Line 3, then undo, then re-tap with the big button.
    await freeze(16.6);
    await page.keyboard.press('Space');
    w = await W();
    check('line 3 stamped', near(w.lines[2].s[0], 16.52), w.lines[2].s[0]);
    await page.keyboard.press('Backspace');
    w = await W();
    check('Backspace undoes last stamp', near(w.lines[2].s[0], base[2].s[0]) && w.sel === 2, w.lines[2].s[0] + ' sel ' + w.sel);
    await freeze(16.3);
    await page.dispatchEvent('.sync-tap', 'pointerdown', { button: 0 });
    w = await W();
    check('TAP button stamps', near(w.lines[2].s[0], 16.22) && w.sel === 3, w.lines[2].s[0]);
    // Select back, nudge +0.05 and −0.01.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowLeft');
    w = await W();
    check('↑ selects, → +0.05, Shift+← −0.01', w.sel === 2 && near(w.lines[2].s[0], 16.26, 1e-9) && near(w.lines[2].s[1] - w.lines[2].s[0], base[2].s[1] - base[2].s[0], 1e-9), w.lines[2].s[0]);
    const label = await page.$eval('.sync-row[data-i="2"] .sync-time', (e) => e.textContent);
    check('row time label updated', label.indexOf('0:16.26') === 0, label);
    await page.keyboard.press('ArrowDown');

    // Rate buttons.
    await page.click('.sync-rate[data-rate="0.75"]');
    check('rate 0.75 → engine.setRate', await page.evaluate(() => devSync.engine.rate === 0.75));
    check('rate button highlighted', await page.$eval('.sync-rate[data-rate="0.75"]', (b) => b.classList.contains('is-on')));

    // Global offset slider +0.25 (persisted) and latency 0.10 (persisted).
    await page.$eval('.sync-range', (r) => {
      r.value = '0.25';
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
    });
    check('offset persisted in localStorage', (await page.evaluate(() => localStorage.getItem('mv.offset.dev-paper-stars'))) === '0.25');
    check('offset shown', (await page.$eval('.sync-offset-val', (e) => e.textContent)).indexOf('+0.25') === 0);
    const label2 = await page.$eval('.sync-row[data-i="0"] .sync-time', (e) => e.textContent);
    check('row labels include offset', label2.indexOf('0:04.67') === 0, label2);
    await page.fill('.sync-num', '0.10');
    await page.press('.sync-num', 'Enter');
    await page.$eval('.sync-num', (n) => n.dispatchEvent(new Event('change', { bubbles: true })));
    check('latency persisted', (await page.evaluate(() => localStorage.getItem('mv.sync.latency'))) === '0.1');
    // Tap line 4 at 21.0 → base 21.0 − 0.10 − 0.25 = 20.65, output 20.90.
    await freeze(21.0);
    await page.keyboard.press('Space');
    w = await W();
    check('tap with latency 0.10 + offset 0.25', near(w.lines[3].s[0], 20.65, 1e-9), w.lines[3].s[0]);
    check('app Space handler never fired', (await page.evaluate(() => devSync.appSpaceCount)) === 0);

    // Screenshot: line 4 being sung.
    await freeze(22.6);
    await sleep(250);
    await page.screenshot({ path: path.join(OUT, 'sync-editor.png') });

    // Apply.
    await page.click('.sync-apply');
    const ap = await page.evaluate(() => {
      const t = devSync.applied[devSync.applied.length - 1];
      let mono = true;
      t.lines.forEach((l) => {
        for (let i = 1; i < l.charTimes.length; i++) if (l.charTimes[i] < l.charTimes[i - 1]) mono = false;
      });
      return { n: devSync.applied.length, lines: t.lines.map((l) => ({ s: l.phrases.map((p) => p.start), e: l.end, ss: l.showStart })), mono, source: t.source, userOffset: t.userOffset };
    });
    check('onApply called once', ap.n === 1, ap.n);
    const A = ap.lines;
    check('applied: line 1 = 4.42 + 0.25', near(A[0].s[0], 4.67, 1e-6) && near(A[0].s[1], 6.17, 1e-6), A[0].s.map((x) => x.toFixed(3)).join(','));
    check('applied: line 2 phrases', near(A[1].s[0], 9.47) && near(A[1].s[1], 11.17) && near(A[1].s[2], 13.07), A[1].s.map((x) => x.toFixed(3)).join(','));
    check('applied: line 3 nudged', near(A[2].s[0], 16.51, 1e-6), A[2].s[0].toFixed(3));
    check('applied: line 4 tapped', near(A[3].s[0], 20.9, 1e-6), A[3].s[0].toFixed(3));
    check('applied: untouched line keeps preset + offset', near(A[5].s[0], base[5].s[0] + 0.25, 1e-6) && near(A[7].e, base[7].e + 0.25, 1e-6), A[5].s[0].toFixed(3));
    check('applied: showStart = start − leadIn', A.every((l) => near(l.ss, l.s[0] - 0.3, 1e-6)));
    check('applied: charTimes monotonic', ap.mono);
    check('applied: userOffset', ap.userOffset === 0.25);
    const previewTxt = await page.evaluate(() => devSync.editor.getWorkingTrack().lines.length);
    check('getWorkingTrack', previewTxt === 8);

    // Export LRC: download + clipboard, parse back.
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('.sync-export')]);
    const dlPath = path.join(OUT, 'export-test.lrc');
    await dl.saveAs(dlPath);
    const lrc = fs.readFileSync(dlPath, 'utf8');
    await sleep(200);
    let clip = '';
    try {
      clip = await page.evaluate(() => navigator.clipboard.readText());
    } catch (e) {
      clip = '';
    }
    check('export: download named .lrc', /\.lrc$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    check('export: clipboard has the same LRC', clip === lrc, clip.length + '/' + lrc.length);
    const rt = await page.evaluate((text) => {
      const back = MV.Lyrics.parse(text, {});
      const ref = devSync.applied[0];
      let e = 0;
      back.lines.forEach((l, i) => {
        const o = ref.lines[i];
        e = Math.max(e, Math.abs(l.start - o.start), Math.abs(l.end - o.end));
        l.phrases.forEach((p, k) => (e = Math.max(e, Math.abs(p.start - o.phrases[k].start))));
      });
      return { n: back.lines.length, err: e, text: back.lines.every((l, i) => l.text === ref.lines[i].text), style: back.lines.every((l, i) => l.style === ref.lines[i].style) };
    }, lrc);
    check('export: LRC parses back (≤10 ms)', rt.n === 8 && rt.text && rt.style && rt.err <= 0.01, (rt.err * 1000).toFixed(1) + ' ms');
    fs.unlinkSync(dlPath);

    // Restart-from-line + play button (engine calls).
    await page.click('.sync-from');
    const calls = await page.evaluate(() => devSync.engine.calls.slice(-1)[0]);
    const selStart = await page.evaluate(() => devSync.editor.work.lines[devSync.editor.sel].start + 0.25);
    check('restart-from-line seeks 2 s before the line', calls[0] === 'play' && near(calls[1], Math.max(0, selStart - 2), 1e-6), JSON.stringify(calls));
    await sleep(300);
    const playing = await page.$eval('.sync-play', (b) => b.classList.contains('is-on'));
    check('play button reflects engine state', playing);
    await page.keyboard.press('Enter');
    check('Enter toggles play/pause', !(await page.evaluate(() => devSync.engine.playing)));

    // Reset button restores the times from open().
    await page.click('.sync-ghost');
    w = await W();
    check('reset restores initial times', w.lines.every((l, i) => near(l.s[0], base[i].s[0])), w.lines[0].s[0]);
    await page.keyboard.press('Backspace');
    w = await W();
    check('reset is undoable', near(w.lines[0].s[0], 4.42, 1e-9), w.lines[0].s[0]);

    // Escape closes, restores rate 1.
    await page.keyboard.press('Escape');
    await sleep(300);
    const closed = await page.evaluate(() => ({ open: devSync.editor.isOpen, closed: devSync.closed, rate: devSync.engine.rate, vis: getComputedStyle(document.querySelector('.sync-root')).visibility }));
    check('Esc closes (onClose, rate restored, hidden)', !closed.open && closed.closed === 1 && closed.rate === 1 && closed.vis === 'hidden', JSON.stringify(closed));
    await page.keyboard.press('Space');
    check('Space reaches the app after close', (await page.evaluate(() => devSync.appSpaceCount)) === 1);

    // Reopen: stored offset (0.25) is assumed already in the applied track → no double shift.
    await page.evaluate(() => devSync.engine.freeze(0));
    await page.click('#open-sync');
    await sleep(350);
    const re = await page.evaluate(() => ({ off: devSync.editor.offset, d: devSync.editor._delta(), s0: devSync.editor.getWorkingTrack().lines[0].start }));
    check('reopen: offset restored, no double shift', re.off === 0.25 && re.d === 0 && near(re.s0, 4.67, 1e-6), JSON.stringify(re));
    check('no page errors (desktop)', errors.length === 0, errors.slice(0, 3).join(' | '));

    // Mid-song screenshot with the playing row highlighted (fresh state).
    await page.evaluate(() => devSync.engine.freeze(36.9));
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await sleep(250);
    await page.screenshot({ path: path.join(OUT, 'sync-editor-2.png') });
    await ctx.close();

    /* ---------------- mobile viewport ---------------- */
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
    const mp = await mctx.newPage();
    const merr = [];
    mp.on('pageerror', (e) => merr.push(e.message));
    await mp.goto(BASE + '/tools/dev-sync.html');
    await mp.waitForFunction(() => window.devSync && window.devSync.ready);
    await mp.evaluate(() => document.fonts && document.fonts.ready);
    await mp.evaluate(() => {
      devSync.engine.freeze(10.2);
      devSync.editor.open();
      return Promise.all(['400 20px Anton', '900 16px "Noto Sans SC"', '700 16px "Noto Sans JP"'].map((f) => document.fonts.load(f, '歌词同步あA').catch(() => null)));
    });
    await sleep(400);
    const box = await mp.$eval('.sync-panel', (p) => {
      const r = p.getBoundingClientRect();
      return { w: r.width, sw: document.documentElement.scrollWidth, tap: document.querySelector('.sync-tap').getBoundingClientRect().bottom };
    });
    check('mobile: panel fits width, TAP visible', box.w <= 390 && box.sw <= 390 && box.tap < 844, JSON.stringify(box));
    await mp.screenshot({ path: path.join(OUT, 'sync-editor-mobile.png') });
    check('mobile: no page errors', merr.length === 0, merr.join(' | '));
    await mctx.close();

    /* ---------------- no localStorage / no clipboard ---------------- */
    const bctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, ignoreHTTPSErrors: true });
    await bctx.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('storage disabled'); } });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, get() { return undefined; } });
      document.execCommand = () => { throw new Error('execCommand disabled'); };
    });
    const bp = await bctx.newPage();
    const berr = [];
    bp.on('pageerror', (e) => berr.push(e.message));
    await bp.goto(BASE + '/tools/dev-sync.html');
    await bp.waitForFunction(() => window.devSync && window.devSync.ready);
    const res = await bp.evaluate(async () => {
      const ed = devSync.editor;
      ed.open();
      devSync.engine.freeze(5);
      ed.tap();
      ed.setOffset(0.5);
      ed.setLatency(0.12);
      const lrc = ed.exportLRC();
      await new Promise((r) => setTimeout(r, 200));
      const tr = ed.apply();
      ed.close();
      return { lrc: lrc.length, applied: devSync.applied.length, s0: tr.lines[0].start, off: MV.SyncEditor.loadOffset(devSync.preset) };
    });
    check('no storage/clipboard: still works', res.applied === 1 && res.lrc > 50 && near(res.s0, 5 - 0.08 + 0.5, 1e-6) && res.off === 0, JSON.stringify(res));
    check('no storage/clipboard: no page errors', berr.length === 0, berr.join(' | '));
    await bctx.close();

    /* ---------------- empty track ---------------- */
    const ectx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
    const ep = await ectx.newPage();
    const eerr = [];
    ep.on('pageerror', (e) => eerr.push(e.message));
    await ep.goto(BASE + '/tools/dev-sync.html');
    await ep.waitForFunction(() => window.devSync && window.devSync.ready);
    const er = await ep.evaluate(() => {
      const ed = new MV.SyncEditor({ engine: devSync.engine, getTrack: () => null, getText: () => '' });
      ed.open();
      ed.tap();
      ed.tapPhrase();
      ed.undo();
      ed.nudge(0.05);
      ed.exportLRC();
      const tr = ed.apply();
      const n = document.querySelectorAll('.sync-empty').length;
      ed.destroy();
      return { n, tr: tr ? tr.lines.length : -1 };
    });
    check('empty track: shows empty state, actions are safe', er.n === 1 && er.tr === 0 && eerr.length === 0, JSON.stringify(er) + ' ' + eerr.join('|'));
    await ectx.close();

    /* ---------------- real engine + real preset (optional, local files) ---------------- */
    const lyrFile = [process.env.MV_LYRICS_PASTE, process.env.MV_LYRICS].find((f) => f && fs.existsSync(f));
    const song = path.join(ROOT, 'assets', 'song.mp3');
    if (!lyrFile || !fs.existsSync(song)) {
      console.log('SKIP real-engine test (needs MV_LYRICS[_PASTE] and assets/song.mp3)');
    } else {
      const rctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
      const rp = await rctx.newPage();
      const rerr = [];
      rp.on('pageerror', (e) => rerr.push(e.message));
      await rp.goto(BASE + '/tools/dev-sync.html?real=1');
      await rp.waitForFunction(() => window.devSync && (devSync.realReady || devSync.error), null, { timeout: 60000 });
      const rerror = await rp.evaluate(() => devSync.error || null);
      check('real: AudioEngine loaded song', !rerror, rerror);
      if (!rerror) {
        // Lyric text goes straight into the page; never printed.
        await rp.evaluate((text) => devSync.setLyrics(text), fs.readFileSync(lyrFile, 'utf8'));
        const info = await rp.evaluate(() => {
          devSync.editor.open();
          const P = devSync.preset;
          const rows = document.querySelectorAll('.sync-row').length;
          const phOK = devSync.editor.work.lines.every((l) => l.phrases.length === P.lines.find((x) => x.n === l.n).phrases.length);
          const ticks = document.querySelectorAll('.sync-tick').length;
          return { rows, phOK, ticks, dur: devSync.engine.duration };
        });
        check('real: 12 rows, phrase ticks match preset', info.rows === 12 && info.phOK && info.ticks === 45, JSON.stringify(info));
        await rp.evaluate(() => devSync.engine.play(9.0));
        await rp.waitForFunction(() => devSync.engine.currentTime >= 10.6, null, { timeout: 10000 });
        const tb = await rp.evaluate(() => devSync.engine.currentTime);
        await rp.keyboard.press('Space');
        const ta = await rp.evaluate(() => devSync.engine.currentTime);
        const s0 = await rp.evaluate(() => devSync.editor.work.lines[0].start);
        check('real: Space stamps engine.currentTime − latency', s0 >= tb - 0.08 - 0.02 && s0 <= ta - 0.08 + 0.02, 'stamp ' + s0.toFixed(3) + ' in [' + (tb - 0.08).toFixed(3) + ', ' + (ta - 0.08).toFixed(3) + ']');
        // Rate 0.5 through the real engine.
        await rp.click('.sync-rate[data-rate="0.5"]');
        const r0 = await rp.evaluate(() => ({ t: devSync.engine.currentTime, w: performance.now() }));
        await sleep(1200);
        const r1 = await rp.evaluate(() => ({ t: devSync.engine.currentTime, w: performance.now(), rate: devSync.engine.rate }));
        const speed = (r1.t - r0.t) / ((r1.w - r0.w) / 1000);
        check('real: rate 0.5 slows the clock', r1.rate === 0.5 && speed > 0.35 && speed < 0.65, 'speed ' + speed.toFixed(2));
        await rp.waitForTimeout(300);
        if (process.env.MV_PRIVATE_OUT) {
          // Contains real lyric text → only written outside the repo when asked.
          await rp.screenshot({ path: path.join(process.env.MV_PRIVATE_OUT, 'sync-editor-real.png') });
        }
        await rp.click('.sync-apply');
        const ap = await rp.evaluate(() => {
          const t = devSync.applied[0];
          return { n: t.lines.length, ph: t.lines.reduce((a, l) => a + l.phrases.length, 0), s0: t.lines[0].start, s1: t.lines[1].start };
        });
        check('real: applied track (12 lines, 45 phrases, stamp kept)', ap.n === 12 && ap.ph === 45 && near(ap.s0, s0, 1e-9), JSON.stringify({ n: ap.n, ph: ap.ph }));
        await rp.keyboard.press('Escape');
        const after = await rp.evaluate(() => ({ rate: devSync.engine.rate, open: devSync.editor.isOpen }));
        check('real: close restores rate 1', after.rate === 1 && !after.open, JSON.stringify(after));
        await rp.evaluate(() => devSync.engine.pause());
      }
      check('real: no page errors', rerr.length === 0, rerr.join(' | '));
      await rctx.close();
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) {
    console.log('Failures:\n  ' + failures.join('\n  '));
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

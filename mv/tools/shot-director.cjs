#!/usr/bin/env node
/*
 * Playwright harness for js/director.js + js/stage.js (via tools/dev-director.html):
 * renders the full pipeline (scenes → transitions → effects → lyrics → HUD →
 * post) at many song times.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node mv/tools/shot-director.cjs [--port=8706] [--audio] [--no-perf] [--frames=180]
 *   MV_LYRICS=/path/outside/repo.txt …  → additionally renders with those lyrics into out/director/real/
 *
 * Writes to mv/out/director/ (git-ignored):
 *   sheet-<n>.png         labelled contact sheets covering every section
 *   strip-<name>.png      short filmstrips through key transitions / accents
 *   full/<t>.png          full-resolution frames at key moments
 *   perf.json             renderFrame / evaluate timings
 * Checks: no page errors, stubs not needed, determinism (same t → same pixels,
 * also on a fresh Stage), no Math.random / Date.now / performance.now inside
 * renderFrame (the Stage's own frame clock is captured at load), error
 * isolation (throwing scene / transition / effect / lyric style), adaptive
 * scale, resize, lyric layout cache.
 * Default run uses synthetic features + invented placeholder lyrics; --audio
 * analyses the local assets/song.mp3 (git-ignored) in the page.
 */
'use strict';
process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK = '1';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith('--' + k + '='));
  if (a) return a.slice(k.length + 3);
  return process.argv.includes('--' + k) ? true : d;
};
const ROOT = path.resolve(__dirname, '..');
const PORT = +arg('port', 8706);
const BASE = 'http://localhost:' + PORT;
const OUT = path.join(ROOT, 'out', 'director');
fs.mkdirSync(path.join(OUT, 'full'), { recursive: true });
const FRAMES = +arg('frames', 180);

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(name + (detail != null ? ' :: ' + detail : ''));
  }
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail != null ? '  [' + detail + ']' : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ping() {
  return new Promise((resolve) => {
    const req = http.get(BASE + '/tools/dev-director.html', (res) => {
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
function saveDataURL(file, url) {
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
}

(async () => {
  let server = null;
  if (!(await ping())) {
    server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' });
    for (let i = 0; i < 40 && !(await ping()); i++) await sleep(150);
  }
  const browser = await chromium.launch({
    proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' },
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1180 }, ignoreHTTPSErrors: true });
  const pageErrors = [];
  const warnings = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push('console: ' + m.text());
    if (m.type() === 'warning') warnings.push(m.text());
  });
  try {
    await page.goto(BASE + '/tools/dev-director.html?manual', { waitUntil: 'load' });
    const useAudio = !!arg('audio', false) && fs.existsSync(path.join(ROOT, 'assets', 'song.mp3'));
    const init = await page.evaluate((o) => window.DD.init(o), { debug: false, audio: useAudio ? '../assets/song.mp3' : undefined });
    check('init: full pipeline, no stubs', init.stubs === 0, `features=${init.source} track=${init.trackSource}/${init.lines} post=${init.post} prepare=${init.prepMs.toFixed(0)} ms analysis=${init.analysisMs.toFixed(0)} ms`);
    console.log('      summary', JSON.stringify(init.summary));
    // Web fonts stream in through the proxy as hundreds of unicode-range
    // slices; wait for them so frames (and determinism checks) are final.
    const fontWait = await page.evaluate(async () => {
      const a = performance.now();
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 120000))]);
      window.DD.stage.invalidateLayouts();
      let loading = 0;
      document.fonts.forEach((f) => (loading += f.status === 'loading' ? 1 : 0));
      return { ms: Math.round(performance.now() - a), loading, status: document.fonts.status };
    });
    console.log('      fonts', JSON.stringify(fontWait));
    const fontsOk = await page.evaluate(() => {
      const fams = window.MV.FONTS.webFamilies;
      const miss = fams.filter(([f, w]) => !document.fonts.check(`${w} 64px "${f}"`, /Anton|Bebas|Archivo|Marker/.test(f) ? 'AB' : '星と'));
      return { ok: fams.length - miss.length, total: fams.length, missing: miss.map(([f, w]) => f + ' ' + w) };
    });
    // informational: font delivery depends on the network, not on this module
    console.log(`INFO  web fonts available ${fontsOk.ok}/${fontsOk.total}` + (fontsOk.missing.length ? ` (missing: ${fontsOk.missing.join(', ')})` : ''));

    /* ---------------- contact sheets over the whole song ---------------- */
    const T = [
      [2.0, 5.3, 8.2, 10.5, 13.0, 16.8, 21.2, 25.5, 29.4, 31.5, 36.2, 40.0, 43.6, 46.2, 46.6, 48.9, 51.4, 55.6],
      [58.3, 61.0, 64.8, 66.9, 71.55, 76.4, 81.3, 84.0, 87.5, 90.0, 96.0, 102.0, 106.3, 108.0, 112.0, 117.5, 121.5, 126.0],
      [130.3, 133.5, 137.0, 140.5, 143.5, 150.0, 156.7, 160.8, 162.6, 166.0, 172.0, 176.0, 179.6, 182.0, 184.0, 188.5, 190.4, 193.0],
      [196.0, 199.5, 201.0, 203.8, 206.0, 208.5, 210.5, 212.1, 213.0, 215.0, 217.5, 219.5, 220.8],
    ];
    for (let i = 0; i < T.length; i++) {
      const url = await page.evaluate(([ts]) => window.DD.sheet(ts, 3, 640), [T[i]]);
      saveDataURL(path.join(OUT, `sheet-${i + 1}.png`), url);
    }
    check('contact sheets written', true, `${T.length} sheets, ${T.flat().length} frames`);

    /* ---------------- filmstrips through key moments ---------------- */
    const strips = {
      'chorus-in': [45.75, 45.9, 46.05, 46.2, 46.35, 46.5, 46.7, 47.0, 47.4],
      'hook-cut': [71.25, 71.35, 71.45, 71.55, 71.65, 71.8, 72.0, 72.3, 72.8],
      'bridge-in': [105.6, 105.8, 106.0, 106.2, 106.4, 106.6, 106.9, 107.3, 108.0],
      'latin-tail': [64.5, 64.62, 64.75, 64.9, 65.1, 65.35, 65.6, 65.9, 66.3],
      'climax-in': [189.9, 190.05, 190.2, 190.35, 190.5, 190.7, 191.0, 191.5, 192.0],
      'endcard': [211.9, 212.4, 213.0, 214.0, 216.0, 218.0, 219.5, 220.5, 221.2],
    };
    for (const [name, ts] of Object.entries(strips)) {
      const url = await page.evaluate(([ts]) => window.DD.sheet(ts, 3, 640), [ts]);
      saveDataURL(path.join(OUT, `strip-${name}.png`), url);
    }
    const fulls = [5.0, 16.8, 46.6, 64.9, 71.6, 96.0, 112.0, 150.0, 188.5, 200.0, 216.0];
    for (const t of fulls) {
      const url = await page.evaluate((t) => {
        window.DD.stage.renderFrame(t);
        return window.DD.frameURL();
      }, t);
      saveDataURL(path.join(OUT, 'full', `${t.toFixed(2)}.png`), url);
    }
    check('filmstrips + full frames written', true, `${Object.keys(strips).length} strips, ${fulls.length} full frames`);

    /* ---------------- determinism ---------------- */
    const det = await page.evaluate(async () => {
      const DD = window.DD, MV = window.MV;
      const h = (s) => MV.fnv1a(s);
      const probe = [50.13, 71.52, 112.4, 190.2, 5.5];
      const first = probe.map((t) => (DD.stage.renderFrame(t), h(DD.frameURL())));
      for (let i = 0; i < 25; i++) DD.stage.renderFrame(i * 8.3);
      const again = probe.map((t) => (DD.stage.renderFrame(t), h(DD.frameURL())));
      // fresh stage on its own canvas, same director
      const c2 = document.createElement('canvas');
      const s2 = new MV.Stage({ canvas: c2, scale: 1 });
      s2.setDirector(DD.director);
      await s2.prepare();
      const fresh = probe.map((t) => (s2.renderFrame(t), h(c2.toDataURL('image/png'))));
      s2.dispose();
      return { first, again, fresh };
    });
    check('same t → identical pixels after unrelated frames', det.first.every((x, i) => x === det.again[i]), det.first.join(','));
    check('fresh Stage renders identical pixels', det.first.every((x, i) => x === det.fresh[i]), det.fresh.join(','));

    /* ---------------- no clocks / randomness in renderFrame ---------------- */
    const clocks = await page.evaluate(() => {
      const DD = window.DD;
      const saved = { r: Math.random, d: Date.now, p: performance.now };
      const calls = { random: 0, date: 0, perf: 0 };
      Math.random = function () { calls.random++; return saved.r.call(Math); };
      Date.now = function () { calls.date++; return saved.d.call(Date); };
      performance.now = function () { calls.perf++; return saved.p.call(performance); };
      try {
        for (let i = 0; i < 60; i++) DD.stage.renderFrame(3 + i * 3.61);
      } finally {
        Math.random = saved.r;
        Date.now = saved.d;
        performance.now = saved.p;
      }
      return calls;
    });
    check('renderFrame: no Math.random / Date.now / performance.now in draw paths', clocks.random === 0 && clocks.date === 0 && clocks.perf === 0, JSON.stringify(clocks));

    /* ---------------- layout cache ---------------- */
    const cache = await page.evaluate(() => {
      const DD = window.DD;
      DD.stage.invalidateLayouts();
      let calls = 0;
      const wrapped = [];
      window.MV.lyricStyles.list().forEach((n) => {
        const s = window.MV.lyricStyles.get(n);
        const orig = s.layout;
        s.layout = function () { calls++; return orig.apply(this, arguments); };
        wrapped.push([s, orig]);
      });
      for (let t = 46; t < 57.5; t += 1 / 30) DD.stage.renderFrame(t);
      const c1 = calls;
      DD.stage.invalidateLayouts();
      DD.stage.renderFrame(50);
      const c2 = calls - c1;
      wrapped.forEach(([s, orig]) => (s.layout = orig));
      return { c1, c2, size: DD.stage._layouts.size };
    });
    check('lyric layout cached per line (1 layout for 345 frames), invalidate re-lays', cache.c1 === 1 && cache.c2 === 1, JSON.stringify(cache));

    /* ---------------- error isolation ---------------- */
    const iso = await page.evaluate(() => {
      const MV = window.MV, DD = window.DD;
      MV.scenes.register('boom-scene', { draw() { throw new Error('scene boom'); } });
      MV.transitions.register('boom-tr', { duration: 0.5, draw() { throw new Error('transition boom'); } });
      MV.effects.register('boom-fx', { layer: 'over', draw() { throw new Error('effect boom'); } });
      MV.lyricStyles.register('boom-style', { layout: () => ({}), draw() { throw new Error('style boom'); } });
      MV.lyricStyles.register('boom-layout', { layout() { throw new Error('layout boom'); }, draw() {} });
      const real = DD.director;
      const base = real.evaluate(50.5);
      const line = base.lyrics[0] ? base.lyrics[0].line : DD.track.lines[2];
      const fake = {
        version: 999,
        fontText: () => '',
        evaluate(t) {
          const st = real.evaluate(t);
          st.scene = { from: { name: 'boom-scene', p: st.scene.from.p }, to: { name: 'sunburst', p: st.scene.from.p }, transition: { name: 'boom-tr', p: 0.3, seed: 1, cutP: 0.6 } };
          st.accents = st.accents.concat([{ kind: 'boom-fx', t: t - 0.1, dur: 1, strength: 1, seed: 1 }, { kind: 'no-such-effect', t, dur: 1, strength: 1, seed: 2 }]);
          st.lyrics = [{ line, lt: { t: 1, in: 1, out: 0, showStart: t - 1, showEnd: t + 1 }, style: 'boom-style' }, { line, lt: { t: 1, in: 1, out: 0, showStart: t - 1, showEnd: t + 1 }, style: 'boom-layout' }];
          return st;
        },
      };
      const c = document.createElement('canvas');
      const s = new MV.Stage({ canvas: c, scale: 0.5, post: false });
      s.setDirector(fake);
      let threw = null;
      try {
        for (let i = 0; i < 5; i++) s.renderFrame(50.5 + i * 0.1);
      } catch (e) {
        threw = String(e);
      }
      const ctx = c.getContext('2d');
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 0; i < px.length; i += 16) if (px[i] > 60) lit++;
      const errs = Array.from(s.errors.entries()).map(([k, v]) => k + '×' + v.count);
      s.dispose();
      return { threw, errs, lit };
    });
    const want = ['scene:boom-scene', 'transition:boom-tr', 'effect:boom-fx', 'lyric:boom-style', 'lyric:boom-layout.layout', 'effect-missing:no-such-effect'];
    check('error isolation: throwing modules never kill the frame', !iso.threw && want.every((k) => iso.errs.some((e) => e.startsWith(k + '×'))) && iso.lit > 1000, `${iso.threw || 'no throw'} errs=${iso.errs.join(' ')} lit=${iso.lit}`);
    check('error isolation: logged once per (kind,name)', warnings.filter((w) => w.includes('boom-scene')).length === 1, `${warnings.filter((w) => w.includes('boom')).length} boom warnings`);

    /* ---------------- missing MV.Post → plain blit ---------------- */
    const noPost = await page.evaluate(async () => {
      const MV = window.MV, DD = window.DD;
      const c = document.createElement('canvas');
      const s = new MV.Stage({ canvas: c, scale: 0.25, post: false });
      s.setDirector(DD.director);
      s.renderFrame(50);
      const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 60) lit++;
      const r = { mode: s.stats.post, w: c.width, h: c.height, lit };
      s.dispose();
      return r;
    });
    check('post disabled/missing → direct 2D blit at scale', noPost.mode === '2d-direct' && noPost.w === 480 && noPost.h === 270 && noPost.lit > 5000, JSON.stringify(noPost));

    /* ---------------- resize + adaptive quality ---------------- */
    const adapt = await page.evaluate(() => {
      const MV = window.MV, DD = window.DD;
      const c = document.createElement('canvas');
      const s = new MV.Stage({ canvas: c, scale: 1, adaptive: true });
      s.setDirector(DD.director);
      // a deliberately slow effect so the test does not depend on machine speed
      const pn = performance.now.bind(performance);
      MV.effects.register('slow-test', { layer: 'over', draw() { const a = pn(); while (pn() - a < 24); } });
      const fake = Object.create(DD.director);
      fake.evaluate = function (t, o) { const st = DD.director.evaluate(t, o); st.accents = st.accents.concat([{ kind: 'slow-test', t, dur: 1 }]); return st; };
      s.setDirector(fake);
      const scales = [];
      for (let i = 0; i < 130; i++) {
        s.renderFrame(40 + i / 60);
        if (i % 10 === 9) scales.push(s.scale);
      }
      const q = s.director.evaluate(41, { quality: s.quality }).env.quality;
      const r = { scales, w: c.width, h: c.height, quality: s.quality, envQ: q, downgrades: s.stats.downgrades };
      s.setAdaptive(false);
      r.after = [c.width, c.height];
      s.dispose();
      return r;
    });
    check('adaptive: slow frames → scale 0.75 then 0.5, env.quality follows', adapt.scales.includes(0.75) && adapt.scales[adapt.scales.length - 1] === 0.5 && adapt.w === 960 && adapt.envQ === 0.5 && adapt.after[0] === 1920, JSON.stringify(adapt));
    const rs = await page.evaluate(() => {
      const DD = window.DD;
      DD.stage.resize(0.5);
      DD.stage.renderFrame(60);
      const a = [DD.stage.canvas.width, DD.stage.canvas.height, DD.stage.sceneA.canvas.width];
      DD.stage.resize(1);
      DD.stage.renderFrame(60);
      return a.concat([DD.stage.canvas.width, DD.stage.canvas.height]);
    });
    check('resize(scale) resizes output + buffers', rs.join(',') === '960,540,960,1920,1080', rs.join(','));

    /* ---------------- debug overlay ---------------- */
    await page.evaluate(() => {
      window.DD.stage.setDebug(true);
      window.DD.stage.renderFrame(46.3);
    });
    saveDataURL(path.join(OUT, 'debug-overlay.png'), await page.evaluate(() => window.DD.frameURL()));
    await page.evaluate(() => window.DD.stage.setDebug(false));

    /* ---------------- perf ---------------- */
    if (!arg('no-perf', false)) {
      const perf = await page.evaluate((N) => {
        const DD = window.DD;
        // Each frame is followed by a 1-px readback of the composite so the
        // (otherwise deferred) canvas raster is included in the wall time.
        // Headless Chrome demotes read-back canvases to CPU raster, so these
        // are CPU-raster numbers — relative, a GPU laptop is much faster.
        const comp = DD.stage.comp.ctx;
        const run = (t0, label) => {
          const ms = [], ev = [], wall = [];
          for (let i = 0; i < 20; i++) (DD.stage.renderFrame(t0 - 0.5 + i / 60), comp.getImageData(0, 0, 1, 1));
          for (let i = 0; i < N; i++) {
            const a = performance.now();
            const r = DD.stage.renderFrame(t0 + i / 60);
            comp.getImageData(0, 0, 1, 1);
            wall.push(performance.now() - a);
            ms.push(r.ms);
            ev.push(r.evalMs);
          }
          const srt = (x) => x.slice().sort((a, b) => a - b);
          const avg = (x) => x.reduce((p, c) => p + c, 0) / x.length;
          const w = srt(wall), e = srt(ev);
          return { label, frames: N, wallAvgMs: +avg(wall).toFixed(2), wallP50: +w[N >> 1].toFixed(2), wallP95: +w[Math.floor(N * 0.95)].toFixed(2), submitAvgMs: +avg(ms).toFixed(2), evalAvgMs: +avg(ev).toFixed(4), evalP95Ms: +e[Math.floor(N * 0.95)].toFixed(4) };
        };
        const out = [run(46.2, 'chorus (transition + accents)'), run(108, 'bridge (quiet)'), run(196, 'climax (showers)'), run(88, 'interlude (credits)')];
        // MV.Post alone (texture upload + shader) on the current composite
        let a = performance.now();
        const st = DD.director.evaluate(50);
        for (let i = 0; i < 20; i++) DD.stage.post.render(DD.stage.comp.canvas, st.post);
        DD.stage.canvas.toDataURL('image/jpeg', 0.05);
        const postMs = (performance.now() - a) / 20;
        // same frames through a Stage without MV.Post (pure Canvas2D path)
        const c2 = document.createElement('canvas');
        const s2 = new window.MV.Stage({ canvas: c2, scale: 1, post: false });
        s2.setDirector(DD.director);
        const saved = DD.stage;
        DD.stage = s2;
        const comp2 = s2.comp.ctx;
        const runs2d = [46.2, 108, 196, 88].map((t0) => {
          for (let i = 0; i < 20; i++) (s2.renderFrame(t0 - 0.5 + i / 60), comp2.getImageData(0, 0, 1, 1));
          const w = [];
          for (let i = 0; i < N; i++) {
            const b = performance.now();
            s2.renderFrame(t0 + i / 60);
            comp2.getImageData(0, 0, 1, 1);
            w.push(performance.now() - b);
          }
          w.sort((x, y) => x - y);
          return { t0, avg: +(w.reduce((p, c) => p + c, 0) / N).toFixed(2), p95: +w[Math.floor(N * 0.95)].toFixed(2) };
        });
        DD.stage = saved;
        s2.dispose();
        return { post: DD.stage.stats.post, runs: out, postOnlyMs: +postMs.toFixed(2), canvas2dOnly: runs2d };
      }, FRAMES);
      fs.writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify(perf, null, 2));
      for (const r of perf.runs) console.log(`      perf ${r.label.padEnd(30)} frame (raster incl.) avg ${r.wallAvgMs} ms p50 ${r.wallP50} p95 ${r.wallP95} | renderFrame submit ${r.submitAvgMs} ms | evaluate avg ${r.evalAvgMs} ms p95 ${r.evalP95Ms} (${perf.post})`);
      console.log(`      perf MV.Post alone ${perf.postOnlyMs} ms/frame; Canvas2D-only Stage (no post): ` + perf.canvas2dOnly.map((r) => `t${r.t0}: avg ${r.avg} p95 ${r.p95}`).join(' | '));
      check('evaluate() inside the page < 0.5 ms (p95)', perf.runs.every((r) => r.evalP95Ms < 0.5), perf.runs.map((r) => r.evalP95Ms).join(' / '));
    }

    /* ---------------- optional: real lyrics (never printed) ---------------- */
    const lyrFile = process.env.MV_LYRICS;
    if (lyrFile && fs.existsSync(lyrFile)) {
      if (path.resolve(lyrFile).startsWith(path.resolve(ROOT, '..') + path.sep)) throw new Error('MV_LYRICS must live outside the repository');
      const text = fs.readFileSync(lyrFile, 'utf8');
      fs.mkdirSync(path.join(OUT, 'real'), { recursive: true });
      // real text needs the full unicode-range sheets → fresh page with ?fonts=full
      await page.goto(BASE + '/tools/dev-director.html?manual&fonts=full', { waitUntil: 'load' });
      const r = await page.evaluate(async (o) => {
        const r = await window.DD.init(o);
        await Promise.race([document.fonts.ready, new Promise((res) => setTimeout(res, 300000))]);
        window.DD.stage.invalidateLayouts();
        let loading = 0;
        document.fonts.forEach((f) => (loading += f.status === 'loading' ? 1 : 0));
        r.fontsLoading = loading;
        return r;
      }, { lyrics: text, audio: useAudio ? '../assets/song.mp3' : undefined });
      check('real lyrics: 12 displayed lines', r.lines === 12, `lines=${r.lines} source=${r.trackSource} fontsStillLoading=${r.fontsLoading}`);
      for (let i = 0; i < T.length; i++) {
        const url = await page.evaluate(([ts]) => window.DD.sheet(ts, 3, 640), [T[i]]);
        saveDataURL(path.join(OUT, 'real', `sheet-${i + 1}.png`), url);
      }
      for (const t of fulls) {
        const url = await page.evaluate((t) => (window.DD.stage.renderFrame(t), window.DD.frameURL()), t);
        saveDataURL(path.join(OUT, 'real', `${t.toFixed(2)}.png`), url);
      }
      check('real lyrics: sheets rendered (out/director/real, git-ignored)', true);
    }

    // network hiccups on individual font slices are not engine errors
    const errs = pageErrors.filter((e) => !/boom/.test(e) && !/Failed to load resource/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 5).join(' | ') || undefined);
  } catch (e) {
    check('harness', false, e.stack || String(e));
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('Failures:\n  ' + failures.join('\n  '));
    process.exitCode = 1;
  }
})();

#!/usr/bin/env node
/*
 * Playwright harness for js/render/scenes.js (via tools/dev-scenes.html).
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node mv/tools/shot-scenes.cjs [--port=8703] [--only=a,b] [--no-full] [--no-perf] [--frames=120] [--gpu-canvas] [--story]
 *     [--no-flags] [--page=<file path or URL of a dev-scenes.html, e.g. an older copy to compare>] [--out=<dir>]
 *
 * Writes to mv/out/scenes/:
 *   sheet-<scene>.png      3×2 contact sheet (intensities 0.25 … 1.0, variants, beat phases)
 *   strip-<scene>.png      6 frames around a downbeat (−0.12 … +0.62 s) at intensity 0.9
 *   full/<scene>-<tag>.png full-resolution 1920×1080 frames (low / mid / high-on-downbeat)
 *   perf.json              avg / p95 ms per frame over N frames (chorus-like and verse-like settings),
 *                          identity transform and a Stage-like camera (zoom 1.02, slight rotation —
 *                          the Stage always draws scenes with overscan zoom, so sprites are filtered)
 *   mem.json               prepared cache memory per scene (MV.sceneStats + unique canvases)
 *   story-<n>.png          (--story) every cue of the preset section map, env from MV.Analysis
 *                          on the local assets/song.mp3 (git-ignored; skipped if absent)
 * and runs checks: every scene registered, opaque with camera zoom-out/rotation,
 * deterministic (same pixels for the same t after unrelated renders), no
 * Math.random / Date.now / performance.now calls while drawing, no page errors,
 * prepared sprite memory < 70 MB, and no Rising-Sun-like composition: every
 * scene × variant 0–5 × several intensities / beat phases is scanned by
 * devScenes.flagScan (radial red/light wedges around a centre; see
 * dev-scenes.html) and must score < 6 (the old sun-ray designs scored 9–24).
 * Starts `python3 -m http.server <port>` on mv/ if nothing answers there.
 */
'use strict';
// Playwright ≥1.5x appends "<-loopback>" to the Chromium bypass list, which
// routes http://localhost through the HTTPS proxy. Keep loopback direct.
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
const PORT = +arg('port', process.env.PORT || 8703);
const BASE = 'http://localhost:' + PORT;
const PAGE = arg('page', '') ? String(arg('page')) : '';
const PAGE_URL = !PAGE ? BASE + '/tools/dev-scenes.html?ui=0' : /^[a-z]+:\/\//.test(PAGE) ? PAGE : 'file://' + path.resolve(PAGE) + '?ui=0';
const OUT = arg('out', '') ? path.resolve(String(arg('out'))) : path.join(ROOT, 'out', 'scenes');
const FULL = path.join(OUT, 'full');
fs.mkdirSync(FULL, { recursive: true });
const ONLY = arg('only', '') ? String(arg('only')).split(',') : null;
const FRAMES = +arg('frames', 120);
const SCENES = ['night-city', 'train', 'crowd', 'tunnel', 'stripes', 'sunburst', 'sky-red', 'shards', 'starfield', 'void'];

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
    const req = http.get(BASE + '/tools/dev-scenes.html', (res) => {
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
// Downbeat k of the preset grid (bpm and the first TRUE downbeat,
// beats[downbeatPhase], read from the page) + a small offset.
let GRID = { bar: (4 * 60) / 99.99, down0: 2.531 };
const down = (k, d = 0.04) => +(GRID.down0 + k * GRID.bar + d).toFixed(3);
let SHEET = [], FULLSHOTS = [];
function makeShots() {
  SHEET = [
    { t: 14.3, i: 0.25, v: 0, seed: 7 },
    { t: 33.3, i: 0.35, v: 1, seed: 11 },
    { t: down(17, 0.1), i: 0.6, v: 2, seed: 3 },
    { t: down(20, 0.03), i: 0.85, v: 0, seed: 5 },
    { t: down(60, 0.3), i: 0.95, v: 1, seed: 9 },
    { t: down(80, 0.02), i: 1.0, v: 2, seed: 13 },
  ];
  FULLSHOTS = [
    { tag: 'low', t: 20.2, i: 0.25, v: 0, seed: 7 },
    { tag: 'mid', t: 41.5, i: 0.6, v: 1, seed: 4 },
    { tag: 'high', t: down(21, 0.05), i: 0.95, v: 0, seed: 5 },
  ];
}
// Rising-Sun check: every variant (the Director uses 0–5) at calm / mid / loud
// intensity, on and between downbeats, two seeds.
function flagCells(name) {
  const cells = [];
  for (let v = 0; v < 6; v++) {
    for (const i of [0.25, 0.55, 0.95]) {
      for (const [k, d] of [[12, 0.03], [37, 0.9]]) cells.push({ scene: name, t: down(k + v, d), i, v, seed: 3 + v * 7 + Math.round(i * 10) + k });
    }
  }
  return cells;
}
const FLAG_MAX = 6;
const STAGE_CAM = { zoom: 1.02, x: 3, y: -2, rot: 0.004 };

(async () => {
  let server = null;
  if (!PAGE && !(await ping())) {
    server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' });
    for (let i = 0; i < 50 && !(await ping()); i++) await sleep(100);
  }
  const browser = await chromium.launch({
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
    // Default: software (Skia CPU) 2D canvas. With SwiftShader-backed GPU canvas
    // every blit goes through GL emulation (~50× slower here) and the numbers
    // say nothing about a real laptop. Pass --gpu-canvas to measure that path.
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required']
      .concat(arg('gpu-canvas', false) ? [] : ['--disable-accelerated-2d-canvas']),
  });
  const summary = { perf: {}, prepMs: {}, flags: {} };
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push('console: ' + m.text()));
    await page.goto(PAGE_URL);
    await page.waitForFunction(() => window.devScenes && window.devScenes.ready);
    const g = await page.evaluate(() => window.devScenes.grid || null);
    if (g) GRID = g;
    makeShots();
    console.log('beat grid: bar ' + GRID.bar.toFixed(4) + ' s, first downbeat ' + GRID.down0 + ' s');

    const names = await page.evaluate(() => window.devScenes.names);
    check('all 10 scenes registered', SCENES.every((n) => names.includes(n)), names.join(','));
    const todo = SCENES.filter((n) => !ONLY || ONLY.includes(n));

    const savePNG = async (file) => {
      const url = await page.evaluate(() => document.getElementById('cv').toDataURL('image/png'));
      fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    };

    for (const name of todo) {
      // contact sheet
      await page.evaluate((o) => window.devScenes.sheet(o), { cols: 3, rows: 2, cells: SHEET.map((c) => Object.assign({ scene: name }, c)) });
      await savePNG(path.join(OUT, 'sheet-' + name + '.png'));
      // film strip around a downbeat (beat reactions: snaps, slams, pulses)
      const d0 = down(40, 0);
      const STRIP = [-0.12, 0.02, 0.1, 0.2, 0.35, 0.62].map((dt) => ({ scene: name, t: +(d0 + dt).toFixed(3), i: 0.9, v: 0, seed: 5, lt: +(4 + dt).toFixed(3), label: name + '  downbeat ' + (dt >= 0 ? '+' : '') + dt.toFixed(2) + ' s' }));
      await page.evaluate((o) => window.devScenes.sheet(o), { cols: 3, rows: 2, cells: STRIP });
      await savePNG(path.join(OUT, 'strip-' + name + '.png'));
      // full-resolution frames
      if (!arg('no-full', false)) {
        for (const s of FULLSHOTS) {
          await page.evaluate((o) => window.devScenes.render(o), Object.assign({ scene: name }, s));
          await savePNG(path.join(FULL, name + '-' + s.tag + '.png'));
        }
      }
      // opacity (identity camera and a zoomed-out, rotated camera)
      const a0 = await page.evaluate((n) => window.devScenes.alphaCheck({ scene: n, t: 50.2, i: 0.8 }), name);
      const a1 = await page.evaluate((n) => window.devScenes.alphaCheck({ scene: n, t: 120.7, i: 0.3, v: 1, cam: { zoom: 0.93, rot: 0.035, x: 30, y: -20 } }), name);
      const a2 = await page.evaluate((n) => window.devScenes.alphaCheck({ scene: n, t: 190.9, i: 1, v: 2, cam: { zoom: 0.95, rot: -0.035, x: -30, y: 20 } }), name);
      check(name + ': paints the whole frame opaquely (incl. camera zoom 0.93 / ±2°)', a0 === 0 && a1 === 0 && a2 === 0, a0 + '/' + a1 + '/' + a2);
      // determinism + forbidden clock/random calls while drawing
      const det = await page.evaluate((n) => {
        const ds = window.devScenes;
        const o = { scene: n, t: 77.77, i: 0.8, v: 1, seed: 21 };
        const calls = { random: 0, now: 0, perf: 0 };
        const R = Math.random, DN = Date.now, PN = performance.now.bind(performance);
        Math.random = () => { calls.random++; return R(); };
        Date.now = () => { calls.now++; return DN(); };
        performance.now = () => { calls.perf++; return PN(); };
        let h1, h2, h3;
        try {
          h1 = ds.hash(o);
          ds.hash({ scene: n, t: 12.3, i: 0.2, v: 0, seed: 3 });
          ds.hash({ scene: n, t: 150.1, i: 1, v: 2, seed: 99 });
          h2 = ds.hash(o);
          h3 = ds.hash(Object.assign({}, o, { t: 78.9 }));
        } finally {
          Math.random = R;
          Date.now = DN;
          performance.now = PN;
        }
        return { h1, h2, h3, calls };
      }, name);
      check(name + ': deterministic (same t → same pixels after unrelated renders)', det.h1 === det.h2, det.h1 + ' vs ' + det.h2);
      check(name + ': animates (t+1.1 s differs)', det.h1 !== det.h3);
      check(name + ': no Math.random/Date.now/performance.now while drawing', det.calls.random + det.calls.now + det.calls.perf === 0, JSON.stringify(det.calls));
      // cultural check: no radial red/light wedges (Rising-Sun-like) anywhere
      if (!arg('no-flags', false)) {
        const has = await page.evaluate(() => typeof window.devScenes.flagScan === 'function');
        if (has) {
          let worst = { score: -1 };
          for (const cell of flagCells(name)) {
            const r = await page.evaluate((o) => window.devScenes.flagScan(o), cell);
            if (r.score > worst.score) worst = Object.assign({ cell }, r);
          }
          summary.flags[name] = worst;
          check(name + ': no Rising-Sun-like radial red/light wedges (36 frames, variants 0–5)', worst.score < FLAG_MAX,
            'worst score ' + worst.score + ' (rays ' + worst.rays + ', sectors ' + worst.sectors + ') at t=' + worst.cell.t + ' I=' + worst.cell.i + ' v=' + worst.cell.v + ' centre ' + worst.x + ',' + worst.y);
        } else console.log('SKIP flag scan: page has no devScenes.flagScan');
      }
    }
    if (Object.keys(summary.flags).length) fs.writeFileSync(path.join(OUT, 'flags.json'), JSON.stringify(summary.flags, null, 2));

    // prepared cache memory
    const memInfo = await page.evaluate(() => (window.devScenes.mem ? window.devScenes.mem() : null));
    if (memInfo) {
      const MB = (b) => +(b / 1048576).toFixed(1);
      console.log('memory: unique sprite canvases ' + MB(memInfo.uniqueBytes) + ' MB in ' + memInfo.canvases + ' canvases');
      if (memInfo.stats) console.log('memory by builder (MB): ' + JSON.stringify(Object.fromEntries(Object.entries(memInfo.stats.bytes).map(([k, b]) => [k, MB(b)]))) + '  vector segments: ' + JSON.stringify(memInfo.stats.segs));
      fs.writeFileSync(path.join(OUT, 'mem.json'), JSON.stringify(memInfo, null, 2));
      check('prepared scene sprites < 70 MB', memInfo.uniqueBytes < 70 * 1048576, MB(memInfo.uniqueBytes) + ' MB');
    }

    // whole-song storyboard: every cue of the preset section map with a real env
    if (arg('story', false)) {
      const info = await page.evaluate(() => window.devScenes.realEnvSetup().catch((e) => ({ error: String(e) })));
      console.log('storyboard env:', JSON.stringify(info));
      check('real env from MV.Analysis + preset', !info.error && info.beats > 100, JSON.stringify(info));
      if (!info.error) {
        const cells = await page.evaluate(() => {
          const P = MV.getPreset('hoshi-to-bokura-to');
          const out = [];
          P.sections.forEach((s, si) => {
            const list = s.scenes || [];
            list.forEach((name, k) => {
              const len = (s.end - s.start) / list.length;
              const t = s.start + len * k + Math.min(len * 0.55, 1.3 + ((si + k) % 3) * 0.4);
              out.push({ scene: name, t: +t.toFixed(3), real: true, seed: MV.hash32(si, k, 'cue') % 100000, v: (si + k) % 3, lt: +(t - (s.start + len * k)).toFixed(3), dur: len, label: s.name + ' · ' + name + ' · ' + MV.fmtTime(t) });
            });
          });
          return out;
        });
        for (let page0 = 0; page0 * 16 < cells.length; page0++) {
          await page.evaluate((o) => window.devScenes.sheet(o), { cols: 4, rows: 4, cells: cells.slice(page0 * 16, page0 * 16 + 16) });
          await savePNG(path.join(OUT, 'story-' + (page0 + 1) + '.png'));
        }
        console.log('storyboard cells:', cells.length);
      }
    }

    // performance
    if (!arg('no-perf', false)) {
      for (const name of todo) {
        const hi = await page.evaluate((o) => window.devScenes.perf(o), { scene: name, t: 49.0, i: 0.9, v: 0, seed: 5, frames: FRAMES });
        const lo = await page.evaluate((o) => window.devScenes.perf(o), { scene: name, t: 15.0, i: 0.25, v: 1, seed: 7, frames: FRAMES });
        const n2 = Math.max(20, Math.round(FRAMES / 3));
        const hiC = await page.evaluate((o) => window.devScenes.perf(o), { scene: name, t: 49.0, i: 0.9, v: 0, seed: 5, frames: n2, cam: STAGE_CAM });
        const loC = await page.evaluate((o) => window.devScenes.perf(o), { scene: name, t: 15.0, i: 0.25, v: 1, seed: 7, frames: n2, cam: STAGE_CAM });
        summary.perf[name] = { high: +hi.avg.toFixed(2), highP95: +hi.p95.toFixed(2), low: +lo.avg.toFixed(2), lowP95: +lo.p95.toFixed(2), camHigh: +hiC.avg.toFixed(2), camLow: +loC.avg.toFixed(2), prepMs: +hi.prepMs.toFixed(0) };
        console.log(`perf ${name.padEnd(11)} avg ${hi.avg.toFixed(2)} ms (I=.9, p95 ${hi.p95.toFixed(2)}) | avg ${lo.avg.toFixed(2)} ms (I=.25) | stage cam ${hiC.avg.toFixed(2)} / ${loC.avg.toFixed(2)} ms | prepare ${hi.prepMs.toFixed(0)} ms`);
      }
      fs.writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify(summary.perf, null, 2));
    }
    check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  } catch (e) {
    check('harness ran', false, e && e.stack);
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) console.log('Failures:\n  ' + failures.join('\n  '));
  process.exit(fail ? 1 : 0);
})();

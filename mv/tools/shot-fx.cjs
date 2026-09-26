#!/usr/bin/env node
/*
 * Playwright harness for js/render/fx.js + js/render/post.js (via tools/dev-fx.html).
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node mv/tools/shot-fx.cjs [--port=8705] [--only=a,b] [--no-full] [--no-perf] [--no-post]
 *
 * Writes to mv/out/fx/:
 *   trans-<name>.png        3×2 sheet: p = 0.1 0.2 0.35 0.5 0.65 0.8
 *   full/trans-<name>-p20|50|80.png   full-resolution frames at p = 0.2 / 0.5 / 0.8
 *   fx-<name>.png           3×2 sheet of the effect at several local times
 *   full/fx-<name>-<k>.png  a full-resolution frame at the effect's key moment
 *   hud.png, hud-zones.png  HUD on a scene (on/off beat), and with zone outlines
 *   post-sheet.png          Post variants (WebGL2), post-tiers.png (webgl2 / webgl1 / 2d)
 *   full/post-<variant>.png full-resolution Post outputs
 *   perf.json               ms per draw (1920×1080) for every transition / effect / HUD / Post tier
 * and checks: registry complete, layers/durations sane, deterministic, no
 * Math.random / Date.now / performance.now inside draws, p edge cases / bad input
 * don't throw, HUD stays inside its zones, Post works on every tier, no page errors.
 * Starts `python3 -m http.server <port>` on mv/ if nothing answers there.
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
const PORT = +arg('port', process.env.PORT || 8705);
const BASE = 'http://localhost:' + PORT;
const OUT = path.join(ROOT, 'out', 'fx');
const FULL = path.join(OUT, 'full');
fs.mkdirSync(FULL, { recursive: true });
const ONLY = arg('only', '') ? String(arg('only')).split(',') : null;
const want = (n) => !ONLY || ONLY.includes(n);

const TRANSITIONS = ['slash-wipe', 'red-flash', 'shatter', 'ink-wipe', 'star-iris', 'stripe-wipe', 'glitch-cut', 'zoom-punch'];
const EFFECTS = ['flash', 'speedlines', 'ink', 'stars', 'shards', 'ring', 'frame', 'confetti', 'caption', 'credits', 'title', 'endcard'];

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
// Google Fonts through a flaky proxy: retry each request and keep a disk cache
// (mv/out/fx/.fontcache, git-ignored) so repeated runs render with the real faces.
const FONT_CACHE = path.join(OUT, '.fontcache');
async function routeFonts(page) {
  fs.mkdirSync(FONT_CACHE, { recursive: true });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
    const url = route.request().url();
    const key = require('crypto').createHash('sha1').update(url.replace(/&r=[^&]*/, '')).digest('hex');
    const file = path.join(FONT_CACHE, key);
    if (fs.existsSync(file) && fs.existsSync(file + '.json')) {
      const meta = JSON.parse(fs.readFileSync(file + '.json', 'utf8'));
      return route.fulfill({ status: 200, headers: meta.headers, body: fs.readFileSync(file) });
    }
    for (let i = 0; i < 6; i++) {
      try {
        const resp = await route.fetch({ timeout: 20000 });
        if (resp.ok()) {
          const body = await resp.body();
          const h = resp.headers();
          const headers = { 'content-type': h['content-type'] || 'application/octet-stream', 'access-control-allow-origin': '*' };
          fs.writeFileSync(file, body);
          fs.writeFileSync(file + '.json', JSON.stringify({ url, headers }));
          return route.fulfill({ status: 200, headers, body });
        }
      } catch (e) { /* retry */ }
      await sleep(300 * (i + 1));
    }
    return route.abort();
  });
}
function ping() {
  return new Promise((resolve) => {
    const req = http.get(BASE + '/tools/dev-fx.html', (res) => {
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

// Local times (s) per effect for the contact sheets; last entry doubles as the full-res "key" frame index.
function effectTimes(name, dur) {
  const f = (arr) => arr.map((x) => +(x * dur).toFixed(3));
  switch (name) {
    case 'title': return { times: [0.12, 0.3, 0.6, 1.4, 4.0, dur - 0.12], key: 3 };
    case 'credits': return { times: [0.2, 0.45, 0.8, 2.5, 5.2, dur - 0.3], key: 3 };
    case 'endcard': return { times: [0.4, 0.9, 1.9, 4.5, dur * 0.8, dur * 0.93], key: 3 };
    case 'caption': return { times: [0.05, 0.12, 0.3, 1.5, dur - 0.12, dur - 0.04], key: 3 };
    default: return { times: f([0.02, 0.1, 0.25, 0.45, 0.7, 0.92]), key: 2 };
  }
}
// Background + extra accent fields per effect (placeholder caption text only).
const EFFECT_OPTS = {
  flash: { bg: 'scene:night-city@20' },
  speedlines: { bg: 'scene:sky-red@50', x: 1100, y: 480 },
  ink: { bg: 'scene:sky-red@50', x: 760, y: 420 },
  stars: { bg: 'scene:starfield@115', x: 960, y: 520 },
  shards: { bg: 'scene:crowd@60' },
  ring: { bg: 'scene:night-city@20', x: 960, y: 560 },
  frame: { bg: 'scene:sunburst@4' },
  confetti: { bg: 'scene:sky-red@50' },
  caption: { bg: 'scene:night-city@20', text: '夜明けの駅で', data: { sub: 'next stop' } },
  credits: { bg: 'scene:stripes@90' },
  title: { bg: 'scene:sunburst@4' },
  endcard: { bg: 'scene:starfield@115' },
};

(async () => {
  let server = null;
  if (!(await ping())) {
    server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' });
    for (let i = 0; i < 50 && !(await ping()); i++) await sleep(100);
  }
  const browser = await chromium.launch({
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required']
      .concat(arg('gpu-canvas', false) ? [] : ['--disable-accelerated-2d-canvas']),
  });
  const summary = { transitions: {}, effects: {}, hud: null, post: {} };
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
    await routeFonts(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push('console: ' + m.text()));
    await page.goto(BASE + '/tools/dev-fx.html?ui=0');
    await page.waitForFunction(() => window.devFx && window.devFx.ready, null, { timeout: 60000 });
    const info = await page.evaluate(() => ({ tr: devFx.transitions, fx: devFx.effects, scenes: devFx.scenes, fonts: devFx.fontsOK, layers: devFx.layers() }));
    console.log('scenes available for backgrounds:', info.scenes.length, '| web fonts:', info.fonts);
    check('all 8 transitions registered', TRANSITIONS.every((n) => info.tr.includes(n)), info.tr.join(','));
    check('all 12 effects registered', EFFECTS.every((n) => info.fx.includes(n)), info.fx.join(','));
    check('effect layers are under/over', Object.values(info.layers).every((l) => l === 'under' || l === 'over'), JSON.stringify(info.layers));
    const durs = await page.evaluate(() => ({
      t: Object.fromEntries(devFx.transitions.map((n) => [n, devFx.transitionDuration(n)])),
      e: Object.fromEntries(devFx.effects.map((n) => [n, devFx.effectDuration(n)])),
    }));
    check('transition durations 0.2–1.2 s', Object.values(durs.t).every((d) => d >= 0.2 && d <= 1.2), JSON.stringify(durs.t));
    check('effect durations > 0', Object.values(durs.e).every((d) => d > 0), JSON.stringify(durs.e));
    const bgOK = (b) => (info.scenes.includes(b.replace(/^scene:/, '').split('@')[0]) ? b : undefined);

    const savePNG = async (file) => {
      const url = await page.evaluate(() => document.getElementById('cv').toDataURL('image/png'));
      fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    };

    /* ---------------- transitions ---------------- */
    for (const name of TRANSITIONS.filter(want)) {
      const P = [0.1, 0.2, 0.35, 0.5, 0.65, 0.8];
      await page.evaluate((o) => devFx.sheet(o), { cols: 3, rows: 2, cells: P.map((p) => ({ type: 'transition', name, p, seed: 7, label: name + '  p=' + p })) });
      await savePNG(path.join(OUT, 'trans-' + name + '.png'));
      if (!arg('no-full', false)) {
        for (const p of [0.2, 0.5, 0.8]) {
          await page.evaluate((o) => devFx.renderTransition(o), { name, p, seed: 7 });
          await savePNG(path.join(FULL, 'trans-' + name + '-p' + Math.round(p * 100) + '.png'));
        }
      }
      // determinism + forbidden calls
      const det = await page.evaluate((n) => {
        const calls = { random: 0, now: 0, perf: 0 };
        const R = Math.random, DN = Date.now, PN = performance.now.bind(performance);
        Math.random = () => { calls.random++; return R(); };
        Date.now = () => { calls.now++; return DN(); };
        performance.now = () => { calls.perf++; return PN(); };
        let h1, h2, h3, h0, h1f, hto;
        try {
          h1 = devFx.hash({ type: 'transition', name: n, p: 0.37, seed: 11 });
          devFx.hash({ type: 'transition', name: n, p: 0.81, seed: 5 });
          devFx.hash({ type: 'effect', name: 'stars', lt: 0.3, seed: 2 });
          h2 = devFx.hash({ type: 'transition', name: n, p: 0.37, seed: 11 });
          h3 = devFx.hash({ type: 'transition', name: n, p: 0.62, seed: 11 });
          h0 = devFx.hash({ type: 'transition', name: n, p: 0, seed: 11 });
          h1f = devFx.hash({ type: 'transition', name: n, p: 1, seed: 11 });
          hto = devFx.hash({ type: 'bg', bg: devFx.DEF_TO });
        } finally {
          Math.random = R;
          Date.now = DN;
          performance.now = PN;
        }
        const hfrom = devFx.hash({ type: 'bg', bg: devFx.DEF_FROM });
        return { h1, h2, h3, h0, h1f, hto, hfrom, calls };
      }, name);
      check(name + ': deterministic', det.h1 === det.h2, det.h1 + ' vs ' + det.h2);
      check(name + ': animates (p .37 ≠ .62)', det.h1 !== det.h3);
      check(name + ': p=0 is exactly from, p=1 exactly to', det.h0 === det.hfrom && det.h1f === det.hto);
      check(name + ': no Math.random/Date.now/performance.now', det.calls.random + det.calls.now + det.calls.perf === 0, JSON.stringify(det.calls));
      const robust = await page.evaluate((n) => {
        const errs = [];
        const tr = MV.transitions.get(n);
        const c = document.createElement('canvas');
        c.width = 480;
        c.height = 270;
        const x = c.getContext('2d');
        x.setTransform(0.25, 0, 0, 0.25, 0, 0);
        const small = document.createElement('canvas');
        small.width = 320;
        small.height = 180;
        small.getContext('2d').fillStyle = '#E60012';
        small.getContext('2d').fillRect(0, 0, 320, 180);
        for (const p of [-1, 0, 0.001, 0.25, 0.5, 0.75, 0.999, 1, 2, NaN]) {
          for (const pair of [[null, null], [small, null], [null, small], [small, small]]) {
            try { tr.draw(x, pair[0], pair[1], p, undefined, undefined); } catch (e) { errs.push(p + ':' + e.message); }
          }
        }
        // ctx state must be restored
        const leaked = x.globalAlpha !== 1 || x.globalCompositeOperation !== 'source-over' || x.getTransform().a !== 0.25;
        return { errs, leaked };
      }, name);
      check(name + ': edge p / missing canvases / small canvases never throw', robust.errs.length === 0, robust.errs.slice(0, 3).join(' | '));
      check(name + ': restores ctx state', !robust.leaked);
    }

    /* ---------------- effects ---------------- */
    for (const name of EFFECTS.filter(want)) {
      const dur = durs.e[name];
      const et = effectTimes(name, dur);
      const o = EFFECT_OPTS[name] || {};
      const base = { type: 'effect', name, seed: 7, bg: bgOK(o.bg || ''), x: o.x, y: o.y, text: o.text, data: o.data };
      await page.evaluate((c) => devFx.sheet(c), { cols: 3, rows: 2, cells: et.times.map((lt) => Object.assign({}, base, { lt, label: name + '  +' + lt.toFixed(2) + ' s' })) });
      await savePNG(path.join(OUT, 'fx-' + name + '.png'));
      if (!arg('no-full', false)) {
        await page.evaluate((c) => devFx.frame(c), Object.assign({}, base, { lt: et.times[et.key], hud: true }));
        await savePNG(path.join(FULL, 'fx-' + name + '.png'));
      }
      const det = await page.evaluate((b) => {
        const calls = { random: 0, now: 0, perf: 0 };
        const R = Math.random, DN = Date.now, PN = performance.now.bind(performance);
        Math.random = () => { calls.random++; return R(); };
        Date.now = () => { calls.now++; return DN(); };
        performance.now = () => { calls.perf++; return PN(); };
        let h1, h2, h3, hb, hEnd;
        const d = devFx.effectDuration(b.name);
        try {
          h1 = devFx.hash(Object.assign({}, b, { lt: d * 0.4 }));
          devFx.hash(Object.assign({}, b, { lt: d * 0.9, seed: 3 }));
          h2 = devFx.hash(Object.assign({}, b, { lt: d * 0.4 }));
          h3 = devFx.hash(Object.assign({}, b, { lt: d * 0.4 + 0.25 }));
          hb = devFx.hash({ type: 'bg', bg: b.bg || devFx.DEF_FROM });
          hEnd = devFx.hash(Object.assign({}, b, { lt: d + 0.01 }));
        } finally {
          Math.random = R;
          Date.now = DN;
          performance.now = PN;
        }
        return { h1, h2, h3, hb, hEnd, calls };
      }, base);
      check(name + ': deterministic', det.h1 === det.h2, det.h1 + ' vs ' + det.h2);
      check(name + ': visible + animates', det.h1 !== det.hb && det.h1 !== det.h3);
      check(name + ': draws nothing after a.dur', det.hEnd === det.hb);
      check(name + ': no Math.random/Date.now/performance.now', det.calls.random + det.calls.now + det.calls.perf === 0, JSON.stringify(det.calls));
      const robust = await page.evaluate((n) => {
        const errs = [];
        const fx = MV.effects.get(n);
        const c = document.createElement('canvas');
        c.width = 480;
        c.height = 270;
        const x = c.getContext('2d');
        x.setTransform(0.25, 0, 0, 0.25, 0, 0);
        const env = MV.devEnv(12.3);
        const bare = { t: 12.3 }; // env without beat/section
        const accents = [
          { kind: n, t: 12 }, { kind: n, t: 12, dur: 0.01 }, { kind: n, t: 12, dur: 30, strength: 3, seed: 'x', x: -500, y: 99999, text: '', data: {} },
          { kind: n, t: 12, dur: 2, strength: 0 }, { kind: n, t: 12, dur: 2, text: 'A very long placeholder caption that keeps going and going beyond any sane width', data: { title: 'T', artist: 'アーティスト', lyricist: '', composer: 'X' } },
          { kind: n, t: 13, dur: 1 }, { kind: n, t: 12, dur: 2, data: { color: 'red', dir: -1, size: 2 } },
        ];
        for (const a of accents) {
          for (const e of [env, bare]) {
            try { fx.draw(x, e, a); } catch (err) { errs.push(JSON.stringify(a).slice(0, 60) + ':' + err.message); }
          }
        }
        try { fx.draw(x, null, null); } catch (err) { errs.push('null:' + err.message); }
        const leaked = x.globalAlpha !== 1 || x.globalCompositeOperation !== 'source-over' || x.getTransform().a !== 0.25;
        return { errs, leaked };
      }, name);
      check(name + ': bad / partial accents never throw', robust.errs.length === 0, robust.errs.slice(0, 3).join(' | '));
      check(name + ': restores ctx state', !robust.leaked);
    }

    /* ---------------- HUD ---------------- */
    if (want('hud')) {
      await page.evaluate(() => devFx.sheet({
        cols: 2, rows: 2,
        cells: [
          { type: 'hud', t: 47.0, label: 'HUD on beat (chorus)' },
          { type: 'hud', t: 47.3, bg: 'stub-b', label: 'HUD between beats' },
          { type: 'hud', t: 115.2, bg: devFx.BGS.find((b) => /starfield/.test(b)) || 'stub-a', label: 'HUD bridge' },
          { type: 'hud', t: 200.1, zones: true, label: 'HUD zones (green = allowed)' },
        ],
      }));
      await savePNG(path.join(OUT, 'hud.png'));
      await page.evaluate(() => devFx.renderHUD({ t: 47.0 }));
      await savePNG(path.join(FULL, 'hud.png'));
      const b1 = await page.evaluate(() => devFx.hudBounds({ t: 47.0 }));
      const b2 = await page.evaluate(() => devFx.hudBounds({ t: 219.9, info: { title: '長い長いタイトルがここに入ります長い長いタイトル', artist: 'SOME VERY LONG ARTIST NAME HERE', sectionName: 'FINAL HOOK' } }));
      check('HUD paints only inside bottom-left 620×110 and top-right 360×90', b1.outside === 0 && b2.outside === 0 && b1.inside > 1000, JSON.stringify([b1, b2]));
      const hid = await page.evaluate(() => devFx.hudBounds({ t: 47, info: { visible: false } }));
      check('HUD info.visible=false draws nothing', hid.inside + hid.outside === 0, JSON.stringify(hid));
      const beatDiff = await page.evaluate(() => devFx.hash({ type: 'hud', t: 47.0, transparent: true }) !== devFx.hash({ type: 'hud', t: 47.3, transparent: true }));
      check('HUD beat indicator changes with the beat', beatDiff);
    }

    /* ---------------- Post ---------------- */
    if (!arg('no-post', false) && want('post')) {
      const src = bgOK('scene:sky-red@50') || 'stub-b';
      const src2 = bgOK('scene:night-city@20') || 'stub-a';
      const V = [
        { label: 'none', params: {} },
        { label: 'rgbShift 10', params: { rgbShift: 10 } },
        { label: 'glitch .6 seed 3', params: { glitch: 0.6, glitchSeed: 3 } },
        { label: 'glitch 1 seed 8', params: { glitch: 1, glitchSeed: 8 } },
        { label: 'grain .5 + scan .6', params: { grain: 0.5, scanlines: 0.6, time: 3.2 } },
        { label: 'vignette .8', params: { vignette: 0.8 } },
        { label: 'flash .5', params: { flash: 0.5 } },
        { label: 'redFlash .6', params: { redFlash: 0.6 } },
        { label: 'invert 1', params: { invert: 1 } },
      ];
      await page.evaluate((o) => devFx.postSheet(o), { cols: 3, rows: 3, cells: V.map((v, i) => Object.assign({ tier: 'webgl2', bg: i % 2 ? src2 : src }, v)) });
      await savePNG(path.join(OUT, 'post-sheet.png'));
      const combo = { rgbShift: 6, glitch: 0.35, glitchSeed: 5, grain: 0.35, vignette: 0.6, scanlines: 0.3, redFlash: 0.15, time: 7.7 };
      await page.evaluate((o) => devFx.postSheet(o), {
        cols: 3, rows: 2,
        cells: [
          { tier: 'webgl2', bg: src, params: combo, label: 'combo' },
          { tier: 'webgl1', bg: src, params: combo, label: 'combo' },
          { tier: '2d', bg: src, params: combo, label: 'combo' },
          { tier: 'webgl2', bg: src2, params: { glitch: 0.8, glitchSeed: 21, rgbShift: 4, vignette: 0.5 }, label: 'glitch' },
          { tier: 'webgl1', bg: src2, params: { glitch: 0.8, glitchSeed: 21, rgbShift: 4, vignette: 0.5 }, label: 'glitch' },
          { tier: '2d', bg: src2, params: { glitch: 0.8, glitchSeed: 21, rgbShift: 4, vignette: 0.5 }, label: 'glitch' },
        ],
      });
      await savePNG(path.join(OUT, 'post-tiers.png'));
      if (!arg('no-full', false)) {
        for (const v of [V[2], V[4], { label: 'combo', params: combo }]) {
          await page.evaluate((o) => devFx.postRender(o), { tier: 'webgl2', bg: src, params: v.params });
          const url = await page.evaluate(() => devFx.postShot('webgl2'));
          fs.writeFileSync(path.join(FULL, 'post-' + v.label.replace(/[^\w]+/g, '_') + '.png'), Buffer.from(url.split(',')[1], 'base64'));
        }
      }
      const tiers = await page.evaluate((b) => ['webgl2', 'webgl1', '2d'].map((t) => devFx.postRender({ tier: t, bg: b, params: {} })), src);
      check('Post tiers: webgl2 / webgl / 2d', tiers[0].mode === 'webgl2' && tiers[1].mode === 'webgl' && tiers[2].mode === '2d' && tiers.every((t) => t.ok), JSON.stringify(tiers));
      // neutral params ≈ identity (sample pixels)
      const ident = await page.evaluate((b) => {
        const out = {};
        for (const tier of ['webgl2', '2d']) {
          devFx.postRender({ tier, bg: b, params: {} });
          const c = document.createElement('canvas');
          c.width = 1920;
          c.height = 1080;
          const x = c.getContext('2d', { willReadFrequently: true });
          x.drawImage(document.querySelector('canvas[data-tier="' + tier + '"]'), 0, 0);
          const a = x.getImageData(0, 0, 1920, 1080).data;
          const s = document.createElement('canvas');
          s.width = 1920;
          s.height = 1080;
          const y = s.getContext('2d', { willReadFrequently: true });
          y.drawImage(devFx.__bg ? devFx.__bg : document.createElement('canvas'), 0, 0);
          out[tier] = a;
        }
        return true;
      }, src);
      check('Post neutral render runs on webgl2 + 2d', ident === true);
      const detP = await page.evaluate((b) => {
        const get = () => {
          const c = document.createElement('canvas');
          c.width = 480;
          c.height = 270;
          const x = c.getContext('2d', { willReadFrequently: true });
          x.drawImage(document.querySelector('canvas[data-tier="webgl2"]'), 0, 0, 480, 270);
          const d = x.getImageData(0, 0, 480, 270).data;
          let h = 0x811c9dc5;
          for (let i = 0; i < d.length; i += 4) { h ^= d[i] | (d[i + 1] << 8) | (d[i + 2] << 16); h = Math.imul(h, 0x01000193) >>> 0; }
          return h;
        };
        const p = { glitch: 0.7, glitchSeed: 4, grain: 0.4, time: 2.5, rgbShift: 5 };
        devFx.postRender({ tier: 'webgl2', bg: b, params: p });
        const a = get();
        devFx.postRender({ tier: 'webgl2', bg: b, params: { invert: 1 } });
        devFx.postRender({ tier: 'webgl2', bg: b, params: p });
        const a2 = get();
        devFx.postRender({ tier: 'webgl2', bg: b, params: Object.assign({}, p, { glitchSeed: 5 }) });
        const c = get();
        return { same: a === a2, reroll: a !== c };
      }, src);
      check('Post deterministic for same params; glitchSeed re-rolls', detP.same && detP.reroll, JSON.stringify(detP));
      // context loss / restore + dispose + resize
      const loss = await page.evaluate(async (b) => {
        const c = document.createElement('canvas');
        c.width = 640;
        c.height = 360;
        const post = new MV.Post(c);
        const src = document.createElement('canvas');
        src.width = 1920;
        src.height = 1080;
        src.getContext('2d').fillRect(0, 0, 10, 10);
        const r0 = post.render(src, { vignette: 0.5 });
        const ext = post.gl && post.gl.getExtension('WEBGL_lose_context');
        if (!ext) return { skipped: true, r0 };
        ext.loseContext();
        await new Promise((r) => setTimeout(r, 50));
        const rLost = post.render(src, {});
        ext.restoreContext();
        await new Promise((r) => setTimeout(r, 100));
        const rBack = post.render(src, { grain: 0.3 });
        post.resize(1280, 720);
        const rResized = post.render(src, {});
        const sz = [c.width, c.height];
        post.dispose();
        const rDisposed = post.render(src, {});
        const rNull = new MV.Post(document.createElement('canvas')).render(null, {});
        return { r0, rLost, rBack, rResized, sz, rDisposed, rNull, lostFlag: post.lost };
      });
      check('Post context loss → render false, restore → renders again; resize; dispose', loss.skipped || (loss.r0 && !loss.rLost && loss.rBack && loss.rResized && loss.sz[0] === 1280 && !loss.rDisposed && !loss.rNull), JSON.stringify(loss));
      const on2d = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.getContext('2d');
        const p = new MV.Post(c);
        const s = document.createElement('canvas');
        s.width = 64;
        s.height = 36;
        return { mode: p.mode, ok: p.render(s, { glitch: 1, grain: 1, vignette: 1, scanlines: 1, flash: 0.2, redFlash: 0.2, invert: 0.5, rgbShift: 12, time: 3 }) };
      });
      check('Post on a canvas that already has a 2D context → 2D fallback', on2d.mode === '2d' && on2d.ok, JSON.stringify(on2d));
      if (!arg('no-perf', false)) {
        for (const tier of ['webgl2', 'webgl1', '2d']) {
          const neutral = await page.evaluate((o) => devFx.perfPost(o), { tier, bg: src, frames: 40, params: {} });
          const full = await page.evaluate((o) => devFx.perfPost(o), { tier, bg: src, frames: 40, params: combo });
          summary.post[tier] = { neutral: +neutral.avg.toFixed(2), neutralP95: +neutral.p95.toFixed(2), combo: +full.avg.toFixed(2), comboP95: +full.p95.toFixed(2), mode: full.mode };
          console.log(`perf post ${tier.padEnd(7)} neutral ${neutral.avg.toFixed(2)} ms (p95 ${neutral.p95.toFixed(2)}) | combo ${full.avg.toFixed(2)} ms (p95 ${full.p95.toFixed(2)})  [${full.mode}]`);
        }
      }
    }

    /* ---------------- perf: transitions / effects / HUD ---------------- */
    if (!arg('no-perf', false)) {
      for (const name of TRANSITIONS.filter(want)) {
        const r = await page.evaluate((n) => devFx.perf({ type: 'transition', name: n, seed: 7, frames: 30 }), name);
        summary.transitions[name] = { avg: +r.avg.toFixed(2), p95: +r.p95.toFixed(2), max: +r.max.toFixed(2), base: +r.base.toFixed(2), net: +(r.avg - r.base).toFixed(2) };
        console.log(`perf trans ${name.padEnd(12)} avg ${r.avg.toFixed(2)} ms  p95 ${r.p95.toFixed(2)}  (2 bg blits ${r.base.toFixed(2)} → net ${(r.avg - r.base).toFixed(2)})`);
      }
      for (const name of EFFECTS.filter(want)) {
        const o = EFFECT_OPTS[name] || {};
        const r = await page.evaluate((c) => devFx.perf(c), { type: 'effect', name, seed: 7, frames: 30, bg: bgOK(o.bg || ''), x: o.x, y: o.y, text: o.text, data: o.data });
        summary.effects[name] = { avg: +r.avg.toFixed(2), p95: +r.p95.toFixed(2), net: +(r.avg - r.base).toFixed(2) };
        console.log(`perf fx    ${name.padEnd(12)} avg ${r.avg.toFixed(2)} ms  p95 ${r.p95.toFixed(2)}  (net ${(r.avg - r.base).toFixed(2)})`);
      }
      if (want('hud')) {
        const r = await page.evaluate(() => devFx.perf({ type: 'hud', frames: 60 }));
        summary.hud = { avg: +r.avg.toFixed(2), net: +(r.avg - r.base).toFixed(2) };
        console.log(`perf HUD avg ${r.avg.toFixed(2)} ms (net ${(r.avg - r.base).toFixed(2)})`);
      }
      fs.writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify(summary, null, 2));
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

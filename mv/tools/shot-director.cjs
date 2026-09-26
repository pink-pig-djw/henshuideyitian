#!/usr/bin/env node
/*
 * Playwright harness for js/director.js + js/stage.js (via tools/dev-director.html):
 * renders the full pipeline (scenes → transitions → camera → effects → lyrics →
 * HUD → post) at many song times.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node mv/tools/shot-director.cjs [--port=8706] [--audio] [--no-perf] [--frames=180]
 *     --only=perf            init + fonts + perf only
 *     --no-sheets            skip contact sheets / filmstrips / full frames
 *     --stage-src=<file>     serve this file as js/stage.js (before/after perf of another Stage)
 *     --shim-shard-layer     emulate the proposed fx.js fix (CPU-backed shatter shard layer,
 *                            getContext('2d', { willReadFrequently: true })) — see the
 *                            determinism checks: without it, `shatter` frames depend on history
 *   MV_LYRICS=/path/outside/repo.txt …  → additionally renders with those lyrics into out/director/real/
 *
 * Writes to mv/out/director/ (git-ignored):
 *   sheet-<n>.png         labelled contact sheets covering every section
 *   strip-<name>.png      short filmstrips through key transitions / accents
 *   full/<t>.png          full-resolution frames at key moments
 *   camera-ab-<t>.png     composite-once vs legacy per-scene camera (crops)
 *   avoid-<t>.png         debug overlay: lyric boxes + placed stars / speedlines
 *   perf.json             renderFrame / evaluate timings (both camera modes)
 * Checks: no page errors, stubs not needed, determinism (same t → same pixels
 * after unrelated frames, on a fresh Stage, on an export-style Stage vs the
 * adaptive preview Stage, and with a dirty composite buffer), camera applied
 * once (legacy path visually equivalent), accents placed off the lyric boxes,
 * neutral post params blitted directly, no Math.random / Date.now /
 * performance.now inside renderFrame (the Stage's own frame clock is captured
 * at load), error isolation (throwing scene / transition / effect / lyric
 * style), adaptive scale, resize, lyric layout cache.
 * Default run uses synthetic features + invented placeholder lyrics; --audio
 * analyses the local assets/song.mp3 (git-ignored) in the page. Google Fonts
 * are served from an on-disk cache (out/director/.fontcache, filled with curl:
 * many small requests through the sandbox proxy are slow in Chromium).
 */
'use strict';
process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK = '1';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
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
const CACHE = path.join(OUT, '.fontcache');
fs.mkdirSync(path.join(OUT, 'full'), { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });
const FRAMES = +arg('frames', 180);
const ONLY = String(arg('only', '') || '');
const STAGE_SRC = arg('stage-src', null);
const SHIM = !!arg('shim-shard-layer', false);

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
function curl(url, ua) {
  return new Promise((res, rej) =>
    execFile('curl', ['-sS', '-L', '--max-time', '40', '-A', ua || 'Mozilla/5.0 Chrome/124', '-D', '-', '-o', '-', url],
      { encoding: 'buffer', maxBuffer: 64 << 20 }, (e, out) => (e ? rej(e) : res(out))));
}
// Google Fonts through a disk cache (retrying curl on a miss).
async function fontRoute(route) {
  const req = route.request();
  const url = req.url();
  const f = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex'));
  try {
    if (!fs.existsSync(f)) {
      let lastErr = null;
      for (let i = 0; i < 4 && !fs.existsSync(f); i++) {
        try {
          const raw = await curl(url, req.headers()['user-agent']);
          let idx = 0;
          let pos;
          while ((pos = raw.indexOf('\r\n\r\n', idx)) >= 0 && /^HTTP\//.test(raw.slice(pos + 4, pos + 9).toString())) idx = pos + 4;
          pos = raw.indexOf('\r\n\r\n', idx);
          const head = raw.slice(idx, pos).toString();
          if (!/ 200/.test(head.split('\r\n')[0])) throw new Error(head.split('\r\n')[0]);
          fs.writeFileSync(f + '.ct', (head.match(/content-type:\s*([^\r\n]+)/i) || [])[1] || 'application/octet-stream');
          fs.writeFileSync(f, raw.slice(pos + 4));
        } catch (e) {
          lastErr = e;
          await sleep(400 * (i + 1));
        }
      }
      if (!fs.existsSync(f)) throw lastErr || new Error('font fetch failed');
    }
    await route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': fs.readFileSync(f + '.ct', 'utf8'), 'access-control-allow-origin': '*' } });
  } catch (e) {
    await route.abort();
  }
}

(async () => {
  let server = null;
  if (!(await ping())) {
    server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' });
    for (let i = 0; i < 40 && !(await ping()); i++) await sleep(150);
  }
  const browser = await chromium.launch({
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1180 }, ignoreHTTPSErrors: true });
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, fontRoute);
  if (STAGE_SRC) {
    const body = fs.readFileSync(path.resolve(STAGE_SRC));
    await context.route(/\/js\/stage\.js(\?.*)?$/, (r) => r.fulfill({ status: 200, body, headers: { 'content-type': 'text/javascript' } }));
    console.log('INFO  js/stage.js served from ' + STAGE_SRC);
  }
  if (SHIM) {
    // fx.js allocates its half-res shatter layer (960×540, alpha) with MV.makeCanvas;
    // back exactly that canvas with a CPU context (the proposed one-line fx.js fix).
    await context.addInitScript(() => {
      const g = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, opts) {
        if (type === '2d' && this.width === 960 && this.height === 540 && !(opts && opts.alpha === false)) opts = Object.assign({}, opts || {}, { willReadFrequently: true });
        return g.call(this, type, opts);
      };
    });
    console.log('INFO  --shim-shard-layer: fx.js shatter layer CPU-backed');
  }
  const page = await context.newPage();
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
    // Wait for the web fonts so frames (and determinism checks) are final.
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

    // Frames where lyrics are on screen and a stars / speedlines accent is live.
    const avoidTimes = await page.evaluate(() => {
      const dir = window.DD.director;
      const out = [];
      for (const a of dir.cues.accents) {
        if (!a.avoid) continue;
        out.push({ t: +(a.t + Math.min(0.12, a.dur * 0.2)).toFixed(3), kind: a.kind, mode: a.avoid.mode });
      }
      return out;
    });

    // Runs first, on the fresh page: the fx.js layer problem below depends on the
    // GPU canvas state, which the other checks' renders change.
    if (ONLY !== 'perf') {
    // fx.js shatter: its flying shards go through a reused module-level layer.
    // After a long render history Chrome's GPU canvas keeps showing the previous
    // frame's shards (a full-canvas clearRect on the reused layer is lost), so
    // the same frame renders differently depending on what was rendered before.
    // Fix proposed for fx.js: back that layer with getContext('2d', { willReadFrequently: true })
    // (emulated by --shim-shard-layer).
    const shat = await page.evaluate(() => {
      const DD = window.DD, S = DD.stage, MV = window.MV;
      const sh = DD.director.cues.scenes.filter((c) => c.transition && c.transition.name === 'shatter');
      const k = document.createElement('canvas');
      k.width = S.canvas.width;
      k.height = S.canvas.height;
      const kx = k.getContext('2d', { willReadFrequently: true });
      const px = () => (kx.drawImage(S.canvas, 0, 0), kx.getImageData(0, 0, k.width, k.height).data);
      const at = (c, f) => c.transition.start + (c.transition.end - c.transition.start) * f;
      const clean = sh.map((c) => (S.renderFrame(at(c, 0.95)), px()));
      for (let i = 0; i < 160; i++) S.renderFrame((i * 1.3831) % 221);
      return sh.map((c, j) => {
        S.renderFrame(at(c, 0.95)); // shards gone: only the frame itself should matter
        const after = px(), ref = clean[j];
        let big = 0;
        for (let q = 0; q < ref.length; q += 4) if (Math.max(Math.abs(ref[q] - after[q]), Math.abs(ref[q + 1] - after[q + 1]), Math.abs(ref[q + 2] - after[q + 2])) > 24) big++;
        return { cut: +c.cut.toFixed(2), big };
      });
    });
    check('shatter frames independent of render history (fx.js reused shard layer)', shat.every((r) => r.big <= 200),
      shat.map((r) => `@${r.cut}: ${r.big} px differ`).join(' ') + (SHIM ? ' [--shim-shard-layer]' : ''));

    }

    if (ONLY !== 'perf' && !arg('no-sheets', false)) {
      /* ---------------- contact sheets over the whole song ---------------- */
      const T = [
        [2.0, 5.3, 8.2, 10.5, 13.0, 16.8, 21.2, 25.5, 29.4, 31.5, 36.2, 40.0, 43.6, 45.8, 46.6, 48.9, 51.4, 55.6],
        [58.3, 61.0, 64.8, 66.9, 67.5, 71.55, 76.4, 81.3, 84.0, 87.5, 90.0, 96.0, 102.0, 105.8, 108.0, 112.0, 117.5, 121.5],
        [126.0, 130.3, 133.5, 137.0, 140.5, 143.5, 150.0, 156.7, 160.8, 163.4, 166.0, 172.0, 176.0, 179.6, 182.6, 184.0, 188.5, 190.4],
        [193.0, 196.0, 199.5, 201.0, 203.8, 206.0, 208.5, 210.5, 212.1, 213.0, 215.0, 217.5, 219.5, 220.8],
      ];
      for (let i = 0; i < T.length; i++) {
        const url = await page.evaluate(([ts]) => window.DD.sheet(ts, 3, 640), [T[i]]);
        saveDataURL(path.join(OUT, `sheet-${i + 1}.png`), url);
      }
      check('contact sheets written', true, `${T.length} sheets, ${T.flat().length} frames`);

      /* ---------------- filmstrips through key moments ---------------- */
      const strips = {
        'chorus-in': [45.05, 45.2, 45.35, 45.5, 45.65, 45.72, 45.8, 45.9, 46.2],
        'hook-in': [66.5, 66.62, 66.75, 66.9, 67.05, 67.2, 67.34, 67.5, 67.9],
        'hook-cut': [70.8, 70.95, 71.1, 71.25, 71.4, 71.52, 71.6, 71.8, 72.2],
        'bridge-in': [104.9, 105.1, 105.3, 105.5, 105.65, 105.72, 105.8, 106.0, 106.4],
        'latin-tail': [64.5, 64.62, 64.75, 64.9, 65.1, 65.35, 65.6, 65.9, 66.3],
        'chorus3-in': [162.5, 162.65, 162.8, 162.95, 163.1, 163.25, 163.33, 163.45, 163.8],
        'climax-in': [189.0, 189.15, 189.3, 189.45, 189.6, 189.73, 189.8, 190.0, 190.5],
        'endcard': [211.9, 212.4, 213.0, 214.0, 216.0, 218.0, 219.5, 220.5, 221.2],
      };
      for (const [name, ts] of Object.entries(strips)) {
        const url = await page.evaluate(([ts]) => window.DD.sheet(ts, 3, 640), [ts]);
        saveDataURL(path.join(OUT, `strip-${name}.png`), url);
      }
      const fulls = [5.0, 16.8, 45.9, 64.9, 67.4, 71.6, 96.0, 112.0, 150.0, 163.4, 188.5, 200.0, 216.0];
      for (const t of fulls) {
        const url = await page.evaluate((t) => {
          window.DD.stage.renderFrame(t);
          return window.DD.frameURL();
        }, t);
        saveDataURL(path.join(OUT, 'full', `${t.toFixed(2)}.png`), url);
      }
      check('filmstrips + full frames written', true, `${Object.keys(strips).length} strips, ${fulls.length} full frames`);
    }

    if (ONLY !== 'perf') {
      /* ---------------- determinism ---------------- */
      // Pixel diffs (count, max channel delta) of the final output against the
      // first render: identical, raster noise (GPU canvas rounding: max ≤ 4 on
      // < 0.1 % of the pixels) or a content difference (a real bug).
      const det = await page.evaluate(async () => {
        const DD = window.DD, MV = window.MV;
        const probe = [50.13, 67.3, 71.52, 112.4, 163.3, 190.2, 5.5];
        const pix = (c) => {
          const k = document.createElement('canvas');
          k.width = c.width;
          k.height = c.height;
          const x = k.getContext('2d', { willReadFrequently: true });
          x.drawImage(c, 0, 0);
          return x.getImageData(0, 0, k.width, k.height).data;
        };
        const cmp = (a, b) => {
          let n = 0, mx = 0, big = 0;
          for (let i = 0; i < a.length; i += 4) {
            const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
            if (d) {
              n++;
              if (d > mx) mx = d;
              if (d > 24) big++;
            }
          }
          return { n, mx, big, pct: +((100 * n) / (a.length / 4)).toFixed(3) };
        };
        const first = probe.map((t) => (DD.stage.renderFrame(t), pix(DD.stage.canvas)));
        for (let i = 0; i < 25; i++) DD.stage.renderFrame(i * 8.3);
        const again = probe.map((t, i) => (DD.stage.renderFrame(t), cmp(first[i], pix(DD.stage.canvas))));
        // Export-style Stage (exactly as MV.Exporter builds its own) on its own canvas.
        const c2 = document.createElement('canvas');
        c2.width = 1920;
        c2.height = 1080;
        const s2 = new MV.Stage({ canvas: c2, scale: 1, adaptive: false, debug: false });
        s2.setDirector(DD.director);
        await s2.prepare();
        const fresh = probe.map((t, i) => (s2.renderFrame(t), cmp(first[i], pix(c2))));
        // Adaptive preview-style Stage (no downgrade at this frame count), interleaved with s2.
        const c3 = document.createElement('canvas');
        const s3 = new MV.Stage({ canvas: c3, scale: 1, adaptive: true });
        s3.setDirector(DD.director);
        await s3.prepare();
        const inter = probe.map((t, i) => {
          s2.renderFrame(probe[(i + 3) % probe.length]);
          s3.renderFrame(t);
          return cmp(first[i], pix(c3));
        });
        // Dirty buffers: scribble over every buffer, the next frame must not care.
        for (const b of [DD.stage.sceneA, DD.stage.sceneB, DD.stage.mix, DD.stage.comp]) {
          if (!b) continue;
          b.ctx.setTransform(1, 0, 0, 1, 0, 0);
          b.ctx.fillStyle = '#00FF00';
          b.ctx.fillRect(0, 0, b.canvas.width, b.canvas.height);
        }
        const dirty = probe.map((t, i) => (DD.stage.renderFrame(t), cmp(first[i], pix(DD.stage.canvas))));
        const what = probe.map((t) => {
          const st = DD.director.evaluate(t);
          return (st.scene.transition ? 'transition:' + st.scene.transition.name : 'scene:' + st.scene.from.name) + ' fx:' + (st.accents.map((a) => a.kind).join('+') || '-') + ' lyric:' + (st.lyrics.map((l) => l.style).join('+') || '-');
        });
        const posts = [DD.stage.stats.post, s2.stats.post, s3.stats.post];
        s2.dispose();
        s3.dispose();
        return { probe, again, fresh, inter, dirty, what, posts };
      });
      // raster noise = anti-aliasing / rounding at edges: few strongly changed pixels
      const cls = (d) => (d.n === 0 ? 'identical' : d.big <= 200 ? 'noise' : 'CONTENT');
      const detCheck = (label, list) => {
        const bad = list.map((d, i) => [d, i]).filter(([d]) => cls(d) === 'CONTENT');
        const noise = list.filter((d) => cls(d) === 'noise').length;
        const same = list.filter((d) => cls(d) === 'identical').length;
        check(label, bad.length === 0, `${same} identical, ${noise} raster-noise` + (bad.length ? '; content diffs: ' + bad.map(([d, i]) => `t=${det.probe[i]} ${d.pct}% px (${d.big} with Δ>24, max Δ${d.mx}) (${det.what[i]})`).join(' | ') : ''));
      };
      detCheck('same t → same pixels after unrelated frames', det.again);
      detCheck(`export-style Stage renders the same pixels (post ${det.posts.join('/')})`, det.fresh);
      detCheck('adaptive preview Stage (interleaved with another Stage) renders the same pixels', det.inter);
      detCheck('dirty buffers do not leak into the next frame (camera blit rewrites comp)', det.dirty);

      // Export renders sequentially, the preview seeks: every frame through each
      // transition type, played in order at 24 fps, must equal the same frame
      // rendered right after an unrelated one.
      const seq = await page.evaluate(() => {
        const DD = window.DD, S = DD.stage;
        const k = document.createElement('canvas');
        k.width = S.canvas.width;
        k.height = S.canvas.height;
        const kx = k.getContext('2d', { willReadFrequently: true });
        const hashPix = () => {
          kx.drawImage(S.canvas, 0, 0);
          const d = new Uint32Array(kx.getImageData(0, 0, k.width, k.height).data.buffer);
          let h = 0x811c9dc5;
          for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 0x01000193) >>> 0;
          return h;
        };
        // one cue per transition type, plus every shatter (its flying shards go
        // through a module-level layer that is reused from frame to frame)
        const picks = [];
        const seen = new Set();
        for (const c of DD.director.cues.scenes) {
          if (!c.transition) continue;
          if (!seen.has(c.transition.name) || c.transition.name === 'shatter') picks.push([c.transition.name + '@' + c.cut.toFixed(1), c.transition]);
          seen.add(c.transition.name);
        }
        const res = [];
        for (const [name, tr] of picks) {
          const ts = [];
          for (let t = tr.start + 1 / 48; t < tr.end; t += 1 / 24) ts.push(+t.toFixed(4));
          const played = ts.map((t) => (S.renderFrame(t), hashPix()));
          const bad = [];
          // seek: visit the same frames backwards, each after an unrelated frame
          for (let i = ts.length - 1; i >= 0; i--) {
            S.renderFrame(10.0);
            S.renderFrame(ts[i]);
            if (hashPix() !== played[i]) bad.push(i);
          }
          bad.reverse();
          // Size of each mismatch: frame after its sequential predecessor vs after a seek.
          const px = () => {
            kx.drawImage(S.canvas, 0, 0);
            return kx.getImageData(0, 0, k.width, k.height).data;
          };
          const diffs = bad.map((i) => {
            // replay: the played sequence up to i vs the frame after its successor (seek order)
            for (let q = Math.max(0, i - 3); q <= i; q++) S.renderFrame(ts[q]);
            const a = px();
            if (i + 1 < ts.length) S.renderFrame(ts[i + 1]);
            S.renderFrame(10.0);
            S.renderFrame(ts[i]);
            const b = px();
            let n = 0, mx = 0, big = 0;
            for (let q = 0; q < a.length; q += 4) {
              const d = Math.max(Math.abs(a[q] - b[q]), Math.abs(a[q + 1] - b[q + 1]), Math.abs(a[q + 2] - b[q + 2]));
              if (d) {
                n++;
                if (d > mx) mx = d;
                if (d > 24) big++;
              }
            }
            return { t: ts[i], pct: +((100 * n) / (a.length / 4)).toFixed(3), mx, big };
          });
          res.push({ name, frames: ts.length, diffs });
        }
        return res;
      });
      const content = (d) => d.big > 200;
      const seqBad = seq.filter((r) => r.diffs.some(content));
      check('sequential playback (export) = seeking (preview) through every transition (raster noise allowed)', seqBad.length === 0,
        seq.map((r) => {
          const c = r.diffs.filter(content);
          return `${r.name}:${r.frames}f` + (r.diffs.length ? ` (${r.diffs.length - c.length} noise)` : '') + (c.length ? ` CONTENT[` + c.map((d) => `t=${d.t} ${d.pct}% ${d.big}px>24`).join(', ') + ']' : '');
        }).join(' '));

      /* ---------------- camera composited once vs legacy ---------------- */
      const cam = await page.evaluate(() => {
        const DD = window.DD, MV = window.MV;
        const ts = [16.8, 45.9, 67.3, 150.0, 190.2, 108.0];
        const px = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const grab = () => {
          const c = document.createElement('canvas');
          c.width = DD.stage.canvas.width;
          c.height = DD.stage.canvas.height;
          c.getContext('2d').drawImage(DD.stage.canvas, 0, 0);
          return c;
        };
        const res = [];
        const crops = [];
        for (const t of ts) {
          DD.stage.setCameraMode('composite');
          DD.stage.renderFrame(t);
          const a = grab();
          DD.stage.setCameraMode('scene');
          DD.stage.renderFrame(t);
          const b = grab();
          DD.stage.setCameraMode('composite');
          const A = px(a), B = px(b);
          let se = 0;
          for (let i = 0; i < A.length; i += 4) for (let k = 0; k < 3; k++) se += (A[i + k] - B[i + k]) * (A[i + k] - B[i + k]);
          const mse = se / ((A.length / 4) * 3);
          res.push({ t, psnr: +(mse > 0 ? 10 * Math.log10((255 * 255) / mse) : 99).toFixed(2), transition: !!DD.director.evaluate(t).scene.transition });
          // 600×300 crops side by side (composite | legacy) around the frame centre
          const s = MV.makeCanvas(1210, 300);
          s.ctx.fillStyle = '#111';
          s.ctx.fillRect(0, 0, 1210, 300);
          s.ctx.drawImage(a, 660, 390, 600, 300, 0, 0, 600, 300);
          s.ctx.drawImage(b, 660, 390, 600, 300, 610, 0, 600, 300);
          crops.push([t, s.canvas.toDataURL('image/png')]);
        }
        return { res, crops };
      });
      for (const [t, url] of cam.crops) saveDataURL(path.join(OUT, `camera-ab-${t.toFixed(2)}.png`), url);
      // Plain frames must match the legacy path closely (only resampling differs);
      // mid-transition the wipe geometry now moves with the camera too (info only).
      const plain = cam.res.filter((r) => !r.transition);
      check('camera applied once: composite ≈ legacy per-scene camera on plain frames (PSNR ≥ 30 dB)', plain.length >= 3 && plain.every((r) => r.psnr >= 30), cam.res.map((r) => `${r.t}${r.transition ? '(tr)' : ''}:${r.psnr}dB`).join(' '));

      /* ---------------- lyric bounds + accent placement ---------------- */
      const avoid = await page.evaluate((times) => {
        const DD = window.DD, W = window.MV.W, H = window.MV.H;
        const out = { frames: 0, bounds: 0, away: 0, keptClear: 0, movedClear: 0, improved: 0, worse: 0, fullyClear: 0, nearHud: 0, reduced: 0, badKept: 0, focus: 0, focusIn: 0 };
        const dist = (B, x, y) => {
          const dx = Math.max(B.x0 - x, 0, x - B.x1), dy = Math.max(B.y0 - y, 0, y - B.y1);
          return dx > 0 || dy > 0 ? Math.hypot(dx, dy) : -Math.min(x - B.x0, B.x1 - x, y - B.y0, B.y1 - y);
        };
        const HUD = [{ x0: 0, y0: H - 110, x1: 620, y1: H }, { x0: W - 360, y0: 0, x1: W, y1: 90 }];
        const seen = new Set();
        for (const it of times) {
          const r = DD.stage.renderFrame(it.t);
          const st = r.state;
          if (!st) continue;
          out.frames++;
          if ((st.env.lyricBounds || []).length) out.bounds++;
          for (const a of st.accents) {
            if (!a.avoid || seen.has(a)) continue;
            seen.add(a);
            const p = DD.stage._placeAccent(a);
            if (a.avoid.mode === 'away') {
              out.away++;
              let U = null;
              for (const l of a.avoid.lines) {
                const b = DD.stage._lineBox(l.line, l.style);
                U = U ? { x0: Math.min(U.x0, b.x0), y0: Math.min(U.y0, b.y0), x1: Math.max(U.x1, b.x1), y1: Math.max(U.y1, b.y1) } : Object.assign({}, b);
              }
              const x0 = a.x != null ? a.x : W / 2, y0 = a.y != null ? a.y : H / 2;
              const before = dist(U, x0, y0), after = dist(U, p.x, p.y);
              const moved = p.x !== x0 || p.y !== y0;
              if (before >= 170) {
                out.keptClear++;
                if (moved) out.badKept++;
              } else if (after > before + 1e-6) out.improved++;
              else out.worse++;
              if (after >= 169.9) out.fullyClear++;
              if (moved && Math.min(dist(HUD[0], p.x, p.y), dist(HUD[1], p.x, p.y)) < 40) out.nearHud++;
              if (p.strength < a.strength) out.reduced++;
            } else {
              out.focus++;
              const b = DD.stage._lineBox(a.avoid.lines[0].line, a.avoid.lines[0].style);
              if (p.x >= b.x0 - 1 && p.x <= b.x1 + 1 && p.y >= b.y0 - 1 && p.y <= b.y1 + 1) out.focusIn++;
            }
          }
        }
        return out;
      }, avoidTimes);
      check('env.lyricBounds set while lyrics are on screen', avoid.bounds >= avoid.frames * 0.9, `${avoid.bounds}/${avoid.frames} frames`);
      check('stars bursts: already-clear ones untouched, others moved further off the text, never onto the HUD', avoid.away > 0 && avoid.badKept === 0 && avoid.worse === 0 && avoid.nearHud === 0,
        `${avoid.away} bursts: ${avoid.keptClear} already clear, ${avoid.improved} moved further off, ${avoid.worse} worse; ${avoid.fullyClear} ≥ 170 px clear, ${avoid.reduced} shrunk (text fills the frame), near HUD ${avoid.nearHud}`);
      check('speedlines focus inside the sung line box', avoid.focus > 0 && avoid.focusIn === avoid.focus, `${avoid.focusIn}/${avoid.focus}`);
      // a few debug-overlay frames (boxes + placed positions)
      const avoidShots = avoidTimes.filter((x, i) => i % Math.max(1, Math.floor(avoidTimes.length / 6)) === 0).slice(0, 6);
      for (const it of avoidShots) {
        const url = await page.evaluate((t) => {
          window.DD.stage.setDebug(true);
          window.DD.stage.renderFrame(t);
          const u = window.DD.frameURL();
          window.DD.stage.setDebug(false);
          return u;
        }, it.t);
        saveDataURL(path.join(OUT, `avoid-${it.t.toFixed(2)}.png`), url);
      }

      /* ---------------- neutral post params → direct blit ---------------- */
      const neutral = await page.evaluate(() => {
        const MV = window.MV, DD = window.DD;
        const mk = (P) => {
          const d = Object.create(DD.director);
          d.evaluate = function (t, o) {
            const st = DD.director.evaluate(t, o);
            st.post = Object.assign({}, st.post, P);
            return st;
          };
          return d;
        };
        const off = { rgbShift: 0, glitch: 0, grain: 0, vignette: 0, flash: 0, redFlash: 0, invert: 0, scanlines: 0 };
        const run = (prefer, P) => {
          const c = document.createElement('canvas');
          const s = new MV.Stage({ canvas: c, scale: 0.5, postPrefer: prefer });
          s.setDirector(mk(P));
          s.renderFrame(50);
          const r = { mode: s.stats.post, direct: s.stats.postDirect, same: null };
          if (c.getContext('2d')) {
            const a = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            const b = s.comp.ctx.getImageData(0, 0, c.width, c.height).data;
            let diff = 0;
            for (let i = 0; i < a.length; i += 4) diff += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
            r.same = diff === 0;
          }
          s.dispose();
          return r;
        };
        return {
          api: !!(MV.Post && MV.Post.isNeutral),
          d2neutral: run('2d', off),
          d2live: run('2d', { grain: 0.07, vignette: 0.35 }),
          glNeutral: run('auto', off),
        };
      });
      check('neutral post params on a 2D output: MV.Post skipped, direct blit', neutral.d2neutral.mode === '2d' && neutral.d2neutral.direct === 1 && neutral.d2neutral.same === true, JSON.stringify(neutral));
      check('live post params still go through MV.Post', neutral.d2live.direct === 0 && neutral.glNeutral.direct === 0, `2d live direct=${neutral.d2live.direct} gl(${neutral.glNeutral.mode}) direct=${neutral.glNeutral.direct}`);

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
        for (let t = 46.3; t < 57.5; t += 1 / 30) DD.stage.renderFrame(t);
        const c1 = calls;
        DD.stage.invalidateLayouts();
        DD.stage.renderFrame(50);
        const c2 = calls - c1;
        wrapped.forEach(([s, orig]) => (s.layout = orig));
        return { c1, c2, size: DD.stage._layouts.size };
      });
      check('lyric layout cached per line (1 layout for ~336 frames), invalidate re-lays', cache.c1 === 1 && cache.c2 === 1, JSON.stringify(cache));

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
        const a = [DD.stage.canvas.width, DD.stage.canvas.height, DD.stage.sceneA.canvas.width, DD.stage.mix.canvas.width];
        DD.stage.resize(1);
        DD.stage.renderFrame(60);
        return a.concat([DD.stage.canvas.width, DD.stage.canvas.height]);
      });
      check('resize(scale) resizes output + buffers', rs.join(',') === '960,540,960,960,1920,1080', rs.join(','));

      /* ---------------- debug overlay ---------------- */
      await page.evaluate(() => {
        window.DD.stage.setDebug(true);
        window.DD.stage.renderFrame(45.8);
      });
      saveDataURL(path.join(OUT, 'debug-overlay.png'), await page.evaluate(() => window.DD.frameURL()));
      await page.evaluate(() => window.DD.stage.setDebug(false));
    }

    /* ---------------- perf ---------------- */
    if (!arg('no-perf', false)) {
      const perf = await page.evaluate((N) => {
        const DD = window.DD;
        // Each frame is followed by a 1-px readback of the composite so the
        // (otherwise deferred) canvas raster is included in the wall time.
        // Headless Chrome demotes read-back canvases to CPU raster, so these
        // are CPU-raster numbers — relative, a GPU laptop is much faster.
        const hasModes = typeof DD.stage.setCameraMode === 'function';
        const windows = [[16.8, 'verse (city)'], [46.2, 'chorus (transition + accents)'], [108, 'bridge (quiet)'], [150, 'chorus 2'], [196, 'climax (showers)'], [88, 'interlude (credits)']];
        const run = (t0, label) => {
          const comp = DD.stage.comp.ctx;
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
          return { label, t0, frames: N, wallAvgMs: +avg(wall).toFixed(2), wallP50: +w[N >> 1].toFixed(2), wallP95: +w[Math.floor(N * 0.95)].toFixed(2), submitAvgMs: +avg(ms).toFixed(2), evalAvgMs: +avg(ev).toFixed(4), evalP95Ms: +e[Math.floor(N * 0.95)].toFixed(4) };
        };
        const modes = hasModes ? ['composite', 'scene'] : ['(this stage.js)'];
        const byMode = {};
        // A B A B: two passes per mode, alternating, so drift hits both equally.
        for (let pass = 0; pass < 2; pass++) {
          for (const m of modes) {
            if (hasModes) DD.stage.setCameraMode(m);
            const rows = windows.map(([t0, label]) => run(t0, label));
            if (!byMode[m]) byMode[m] = rows;
            else byMode[m] = byMode[m].map((r, i) => Object.assign({}, r, {
              wallAvgMs: +((r.wallAvgMs + rows[i].wallAvgMs) / 2).toFixed(2),
              wallP50: +((r.wallP50 + rows[i].wallP50) / 2).toFixed(2),
              wallP95: +((r.wallP95 + rows[i].wallP95) / 2).toFixed(2),
              submitAvgMs: +((r.submitAvgMs + rows[i].submitAvgMs) / 2).toFixed(2),
            }));
          }
        }
        if (hasModes) DD.stage.setCameraMode('composite');
        // MV.Post alone (texture upload + shader) on the current composite
        let a = performance.now();
        const st = DD.director.evaluate(50);
        for (let i = 0; i < 20; i++) DD.stage.post.render(DD.stage.comp.canvas, st.post);
        DD.stage.canvas.toDataURL('image/jpeg', 0.05);
        const postMs = (performance.now() - a) / 20;
        return { post: DD.stage.stats.post, byMode, postOnlyMs: +postMs.toFixed(2) };
      }, FRAMES);
      fs.writeFileSync(path.join(OUT, STAGE_SRC ? 'perf-stage-src.json' : 'perf.json'), JSON.stringify(perf, null, 2));
      for (const [m, rows] of Object.entries(perf.byMode)) {
        for (const r of rows) console.log(`      perf [${m}] ${r.label.padEnd(30)} frame (raster incl.) avg ${r.wallAvgMs} ms p50 ${r.wallP50} p95 ${r.wallP95} | submit ${r.submitAvgMs} ms | eval p95 ${r.evalP95Ms} ms`);
      }
      const modes = Object.keys(perf.byMode);
      if (modes.length === 2) {
        const tot = (m) => perf.byMode[m].reduce((p, r) => p + r.wallAvgMs, 0) / perf.byMode[m].length;
        console.log(`      perf mean over windows: composite ${tot('composite').toFixed(2)} ms vs legacy scene-camera ${tot('scene').toFixed(2)} ms (${(((tot('composite') - tot('scene')) / tot('scene')) * 100).toFixed(1)} %)`);
      }
      console.log(`      perf MV.Post alone ${perf.postOnlyMs} ms/frame (${perf.post})`);
      check('evaluate() inside the page < 0.5 ms (p95)', Object.values(perf.byMode).every((rows) => rows.every((r) => r.evalP95Ms < 0.5)), Object.values(perf.byMode).map((rows) => rows.map((r) => r.evalP95Ms).join(' / ')).join(' | '));
    }

    /* ---------------- optional: real lyrics (never printed) ---------------- */
    const lyrFile = process.env.MV_LYRICS;
    if (ONLY !== 'perf' && lyrFile && fs.existsSync(lyrFile)) {
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
      const T = [
        [10.5, 16.8, 21.2, 29.8, 36.2, 43.6, 46.6, 51.4, 55.6],
        [58.3, 61.0, 64.8, 67.4, 71.6, 76.4, 81.3, 108.0, 112.0],
        [117.5, 121.5, 126.0, 133.5, 143.5, 150.0, 156.7, 160.8, 163.4],
        [166.0, 172.0, 176.0, 179.6, 182.6, 184.0, 188.5, 190.4, 193.0],
      ];
      for (let i = 0; i < T.length; i++) {
        const url = await page.evaluate(([ts]) => window.DD.sheet(ts, 3, 640), [T[i]]);
        saveDataURL(path.join(OUT, 'real', `sheet-${i + 1}.png`), url);
      }
      const fulls = [16.8, 46.6, 64.9, 67.4, 71.6, 112.0, 150.0, 163.4, 188.5];
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

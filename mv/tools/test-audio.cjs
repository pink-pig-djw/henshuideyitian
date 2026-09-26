/*
 * Browser test for MV.AudioEngine + MV.Analysis (Playwright / Chromium).
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node mv/tools/test-audio.cjs
 *
 * Serves mv/ on http://localhost:8701 (starts `python3 -m http.server` if the
 * port is free), opens tools/analysis-dev.html and drives the engine through
 * page.evaluate. Needs the user's own assets/song.mp3 (git-ignored).
 * Screenshot → mv/out/analysis-audio/. Prints numbers only.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = +(process.env.MV_PORT || 8701);
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(ROOT, 'out', 'analysis-audio');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

function ping() {
  return new Promise((resolve) => {
    const req = http.get(BASE + '/tools/analysis-dev.html', (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureServer() {
  if (await ping()) return null;
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await ping()) return srv;
  }
  throw new Error('could not start http server on ' + PORT);
}

function launch(extraArgs) {
  const opts = {
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'].concat(extraArgs || []),
  };
  // Playwright appends '<-loopback>' to Chromium's bypass list and later rules
  // win, so 'localhost' alone is still proxied (→ 405). Put it first.
  if (process.env.HTTPS_PROXY) opts.proxy = { server: process.env.HTTPS_PROXY, bypass: '<-loopback>,localhost,127.0.0.1' };
  return chromium.launch(opts);
}

function watchConsole(page, bucket) {
  page.on('console', (m) => {
    if (m.type() === 'error') bucket.push(m.text());
  });
  page.on('pageerror', (e) => bucket.push('pageerror: ' + e.message));
}

(async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await ensureServer();
  const hasSong = fs.existsSync(path.join(ROOT, 'assets', 'song.mp3'));
  let browser = null;
  try {
    /* ------------------------------------------------------------------ */
    /* 1. Autoplay allowed: load, analyse, clock, seek, rate, ended, cache  */
    /* ------------------------------------------------------------------ */
    browser = await launch(['--autoplay-policy=no-user-gesture-required']);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    watchConsole(page, errors);
    await page.goto(BASE + '/tools/analysis-dev.html?preset=0');
    await page.waitForFunction(() => window.MV && window.MV.AudioEngine && window.MV.Analysis && window.AA);

    if (!hasSong) {
      console.log('SKIP  assets/song.mp3 not present — only API smoke tests run');
    } else {
      const load = await page.evaluate(async () => {
        const t0 = performance.now();
        const buf = await window.AA.eng.loadURL('../assets/song.mp3');
        return { ms: performance.now() - t0, duration: buf.duration, sr: buf.sampleRate, ch: buf.numberOfChannels, name: window.AA.eng.name, abBytes: window.AA.eng.arrayBuffer.byteLength };
      });
      check('loadURL decodes assets/song.mp3', Math.abs(load.duration - 221.27) < 0.2, `duration=${load.duration.toFixed(3)} sr=${load.sr} ch=${load.ch} decode=${load.ms.toFixed(0)} ms name=${load.name} bytes=${load.abBytes}`);

      const an = await page.evaluate(async () => {
        const eng = window.AA.eng, A = window.MV.Analysis;
        let calls = 0, last = -1, mono = true, maxGap = 0, lastT = performance.now();
        const t0 = performance.now();
        const f = await A.compute(eng.buffer, {
          onProgress: (p) => {
            const now = performance.now();
            maxGap = Math.max(maxGap, now - lastT);
            lastT = now;
            calls++;
            if (p < last) mono = false;
            last = p;
          },
        });
        const ms = performance.now() - t0;
        const P = window.MV.getPreset('hoshi-to-bokura-to');
        const m = A.matchPreset(f);
        // beat F-measure vs preset (±70 ms)
        const ref = P.beats;
        const used = new Uint8Array(ref.length);
        let hit = 0;
        for (const t of f.beats) {
          let best = -1, bd = 1e9;
          for (let j = 0; j < ref.length; j++) {
            if (used[j]) continue;
            const d = Math.abs(ref[j] - t);
            if (d < bd && d <= 0.07) {
              bd = d;
              best = j;
            }
          }
          if (best >= 0) {
            used[best] = 1;
            hit++;
          }
        }
        const Pr = hit / f.beats.length, R = hit / ref.length;
        return {
          ms, calls, last, mono, maxGap, bpm: f.bpm, F: (2 * Pr * R) / (Pr + R), nBeats: f.beats.length, sections: f.sections.length,
          match: m && { offset: m.offset, conf: m.confidence, id: m.preset.id },
        };
      });
      check('Analysis.compute in page < 3 s (headless CPU)', an.ms < 3000, `${an.ms.toFixed(0)} ms, progress calls=${an.calls}, max gap between progress callbacks=${an.maxGap.toFixed(0)} ms`);
      check('Analysis yields & reports progress', an.calls >= 10 && an.last === 1 && an.mono);
      check('in-page (48k/44.1k decode) bpm & beats', Math.abs(an.bpm - 99.38) <= 1 && an.F >= 0.85, `bpm=${an.bpm} F=${an.F.toFixed(3)} beats=${an.nBeats} sections=${an.sections}`);
      check('in-page matchPreset', an.match && Math.abs(an.match.offset) < 0.1 && an.match.conf >= 0.6, JSON.stringify(an.match));

      // Render the inspector with the analysed song (visual check).
      await page.evaluate(async () => {
        await window.AA.analyze(window.AA.eng.buffer);
        window.AA.applyPreset();
      });

      // Playback clock.
      const clock = await page.evaluate(async () => {
        const eng = window.AA.eng;
        const events = [];
        ['play', 'pause', 'seek', 'ended', 'blocked', 'rate'].forEach((e) => eng.on(e, (d) => events.push(e + ':' + (d && d.t != null ? d.t.toFixed(2) : ''))));
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const out = { state0: eng.state, latency: eng.latency };
        eng.play(30);
        await sleep(150); // let the context warm up
        const a = eng.currentTime, pa = performance.now();
        await sleep(1000);
        const b = eng.currentTime, pb = performance.now();
        out.adv1 = b - a;
        out.wall1 = (pb - pa) / 1000;
        out.state1 = eng.state;
        out.playing = eng.playing;
        // monotonic sampling
        let prev = eng.currentTime, backwards = 0;
        for (let i = 0; i < 40; i++) {
          await sleep(10);
          const c = eng.currentTime;
          if (c < prev - 1e-6) backwards++;
          prev = c;
        }
        out.backwards = backwards;
        // Per-frame smoothness: engine clock vs raw ctx.currentTime deltas
        // compared with the rAF frame deltas (ms).
        const rows = [];
        await new Promise((res) => {
          let k = 0;
          const step = (ts) => {
            const pn = performance.now();
            rows.push([pn, eng.currentTime, eng.ctx.currentTime, ts, eng.timeAt(ts)]);
            if (++k < 90) requestAnimationFrame(step);
            else res();
          };
          requestAnimationFrame(step);
        });
        const dev = (col, ref) => {
          let s = 0, mx = 0;
          for (let i = 1; i < rows.length; i++) {
            const e = (rows[i][col] - rows[i - 1][col]) * 1000 - (rows[i][ref] - rows[i - 1][ref]);
            s += e * e;
            mx = Math.max(mx, Math.abs(e));
          }
          return { rms: Math.sqrt(s / (rows.length - 1)), max: mx };
        };
        out.smoothEng = dev(1, 0);
        out.smoothRaw = dev(2, 0);
        out.smoothTimeAt = dev(4, 3);
        // seek while playing
        eng.seek(100);
        out.afterSeek = eng.currentTime;
        await sleep(500);
        out.afterSeek500 = eng.currentTime;
        // pause holds
        eng.pause();
        const p0 = eng.currentTime;
        await sleep(300);
        out.pauseDrift = eng.currentTime - p0;
        out.pausedAt = p0;
        // seek while paused, resume
        eng.seek(150);
        out.pausedSeek = eng.currentTime;
        eng.play();
        await sleep(400);
        out.resume400 = eng.currentTime - 150;
        // rate 2x
        eng.setRate(2);
        const r0 = eng.currentTime;
        await sleep(600);
        out.rate2adv = eng.currentTime - r0;
        eng.setRate(1);
        // toggle
        out.toggle1 = eng.toggle();
        out.toggle2 = eng.toggle();
        // ended
        eng.seek(eng.duration - 0.4);
        await sleep(900);
        out.endedPlaying = eng.playing;
        out.endTime = eng.currentTime;
        out.duration = eng.duration;
        // stream destination
        const ms = eng.streamDestination();
        out.streamTracks = ms ? ms.getAudioTracks().length : -1;
        eng.setVolume(0.5);
        out.volume = eng.volume;
        out.events = events;
        return out;
      });
      check('context running with autoplay allowed', clock.state1 === 'running', `state0=${clock.state0} state1=${clock.state1} latency=${(clock.latency * 1000).toFixed(1)} ms`);
      check('play(): ~1 s wall → ~1 s song time', Math.abs(clock.adv1 - clock.wall1) < 0.06 && clock.playing, `advanced ${clock.adv1.toFixed(3)} s over ${clock.wall1.toFixed(3)} s wall`);
      check('clock monotonic while playing', clock.backwards === 0, `backwards steps=${clock.backwards}`);
      check('clock smooth per frame (vs raw ctx.currentTime)', clock.smoothEng.rms < 0.6 * clock.smoothRaw.rms, `per-frame delta error vs wall clock rms/max: currentTime ${clock.smoothEng.rms.toFixed(2)}/${clock.smoothEng.max.toFixed(1)} ms, raw ctx.currentTime ${clock.smoothRaw.rms.toFixed(2)}/${clock.smoothRaw.max.toFixed(1)} ms, timeAt(rAF ts) vs rAF ts ${clock.smoothTimeAt.rms.toFixed(2)}/${clock.smoothTimeAt.max.toFixed(1)} ms`);
      check('seek while playing', Math.abs(clock.afterSeek - 100) < 0.02 && Math.abs(clock.afterSeek500 - 100.5) < 0.1, `after=${clock.afterSeek.toFixed(3)} +500ms=${clock.afterSeek500.toFixed(3)}`);
      check('pause holds the clock', Math.abs(clock.pauseDrift) < 1e-6, `drift=${clock.pauseDrift} at ${clock.pausedAt.toFixed(3)}`);
      check('seek while paused + resume', Math.abs(clock.pausedSeek - 150) < 1e-6 && Math.abs(clock.resume400 - 0.4) < 0.1, `resume +400ms → +${clock.resume400.toFixed(3)} s`);
      check('setRate(2) doubles the clock', Math.abs(clock.rate2adv - 1.2) < 0.12, `+${clock.rate2adv.toFixed(3)} s in 600 ms`);
      check('toggle()', clock.toggle1 === false && clock.toggle2 === true);
      check("'ended' at the end, clock clamped", !clock.endedPlaying && Math.abs(clock.endTime - clock.duration) < 1e-6 && clock.events.some((e) => e.startsWith('ended')), `t=${clock.endTime.toFixed(3)} / ${clock.duration.toFixed(3)}`);
      check('events emitted', ['play', 'pause', 'seek', 'rate', 'ended'].every((e) => clock.events.some((x) => x.startsWith(e))), clock.events.join(' '));
      check('streamDestination() → MediaStream with audio', clock.streamTracks === 1, `tracks=${clock.streamTracks}`);

      // IndexedDB cache.
      const cache = await page.evaluate(async () => {
        const AE = window.MV.AudioEngine, eng = window.AA.eng;
        const saved = await AE.cacheSave(eng.name, eng.arrayBuffer);
        const loaded = await AE.cacheLoad();
        const buf = loaded ? await new AE().loadArrayBuffer(loaded.arrayBuffer, loaded.name) : null;
        const cleared = await AE.cacheClear();
        const after = await AE.cacheLoad();
        const bad = await AE.cacheSave('x', null);
        return { saved, name: loaded && loaded.name, bytes: loaded && loaded.arrayBuffer.byteLength, orig: eng.arrayBuffer.byteLength, dur: buf && buf.duration, cleared, after, bad };
      });
      check('cacheSave / cacheLoad round trip', cache.saved && cache.bytes === cache.orig && Math.abs(cache.dur - 221.27) < 0.2, `saved=${cache.saved} bytes=${cache.bytes} name=${cache.name}`);
      check('cacheClear / empty load / bad input never throw', cache.cleared && cache.after === null && cache.bad === false);

      // Visual check of the inspector.
      await page.evaluate(() => window.AA.eng.seek(47.5));
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, 'inspector.png') });
    }

    // API robustness without audio.
    const robust = await page.evaluate(async () => {
      const e = new window.MV.AudioEngine();
      const r = { playNoBuf: e.play(), t: e.currentTime, dur: e.duration };
      e.pause();
      e.seek(10);
      e.setRate(3);
      e.setVolume(2);
      let err = null;
      try {
        await e.loadURL('../assets/does-not-exist.mp3');
      } catch (x) {
        err = x.message;
      }
      r.err = err;
      r.vol = e.volume;
      let err2 = null;
      try {
        await e.loadArrayBuffer(new Uint8Array([1, 2, 3, 4, 5]).buffer, 'junk');
      } catch (x) {
        err2 = x.message;
      }
      r.err2 = err2;
      const off = e.on('play', () => {});
      r.unsub = typeof off === 'function';
      off();
      e.dispose();
      return r;
    });
    check('engine without audio: no throw, clean errors', robust.playNoBuf === false && robust.t === 0 && !!robust.err && !!robust.err2 && robust.vol === 1 && robust.unsub, `loadURL err="${(robust.err || '').slice(0, 40)}…" decode err="${(robust.err2 || '').slice(0, 30)}…"`);
    // The 404 of the missing file is an expected resource error; everything else counts.
    const unexpected = errors.filter((e) => !/404|does-not-exist|Failed to load resource/i.test(e));
    check('no console errors (page 1)', unexpected.length === 0, unexpected.slice(0, 3).join(' | ') || `${errors.length} expected 404 message(s) ignored`);
    await browser.close();
    browser = null;

    /* ------------------------------------------------------------------ */
    /* 2. Default autoplay policy: suspended context, 'blocked', unlock     */
    /* ------------------------------------------------------------------ */
    if (hasSong) {
      browser = await launch(['--autoplay-policy=user-gesture-required']);
      const p2 = await browser.newPage();
      const errors2 = [];
      watchConsole(p2, errors2);
      await p2.goto(BASE + '/tools/analysis-dev.html?preset=0');
      await p2.waitForFunction(() => window.AA);
      await p2.evaluate(async () => {
        await window.AA.eng.loadURL('../assets/song.mp3');
      });
      // Headless Chromium may run the context even under the default policy;
      // then simulate the autoplay block: suspend the context and make
      // resume() hang until a real click calls eng.unlock().
      const s1 = await p2.evaluate(async () => {
        const eng = window.AA.eng;
        const ctx = eng.ctx;
        let simulated = false;
        if (ctx.state === 'running') {
          await ctx.suspend();
          simulated = true;
          const realResume = ctx.resume.bind(ctx);
          ctx.resume = () => new Promise(() => {}); // blocked: never resolves
          window.__realResume = realResume;
        }
        let blocked = false;
        eng.on('blocked', () => (blocked = true));
        eng.play(20);
        await new Promise((r) => setTimeout(r, 700));
        return { simulated, state: eng.state, t: eng.currentTime, blocked, playing: eng.playing };
      });
      check('autoplay-blocked: clock holds at 20 s, playing=true, blocked event', s1.state === 'suspended' && s1.blocked && Math.abs(s1.t - 20) < 1e-6 && s1.playing, `simulated=${s1.simulated} state=${s1.state} t=${s1.t}`);
      // A real user gesture → unlock.
      await p2.evaluate(() => {
        const b = document.createElement('button');
        b.id = 'unlockTest';
        b.textContent = 'unlock';
        b.style.cssText = 'position:fixed;left:0;top:0;z-index:99';
        b.onclick = () => {
          if (window.__realResume) window.AA.eng.ctx.resume = window.__realResume;
          window.AA.eng.unlock();
        };
        document.body.appendChild(b);
      });
      await p2.click('#unlockTest');
      await p2.waitForTimeout(800);
      const s2 = await p2.evaluate(() => ({ state: window.AA.eng.state, t: window.AA.eng.currentTime }));
      check('after a click: context runs, clock advances from 20 s', s2.state === 'running' && s2.t > 20.4 && s2.t < 21.0, `state=${s2.state} t=${s2.t.toFixed(3)}`);
      check('no console errors (page 2)', errors2.length === 0, errors2.slice(0, 3).join(' | '));
      await browser.close();
      browser = null;
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (srv) srv.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

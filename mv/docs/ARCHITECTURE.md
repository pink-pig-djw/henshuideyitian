# MV engine — architecture & module contracts

A browser-only, audio-reactive music-video renderer with a Persona-5-inspired
graphic language (original artwork only). It plays a user-supplied song, shows
user-supplied lyrics with per-phrase timing, and can export an MP4.

This document is the **contract** between modules. `js/core.js` is the only
shared dependency; everything else talks through the objects defined here.

---

## 0. Hard rules (apply to every file)

1. **No lyric text in the repository.** Lyrics are pasted/dropped by the user at
   runtime (cached in `localStorage`). Presets store only timing, character
   offsets and a hash per line (`MV.lyricKey`). Tests, fixtures, comments and
   docs must never contain real song lyrics — use invented placeholder lines.
   (For local visual testing a lyrics file may be passed from outside the repo
   via the `MV_LYRICS` env var; never copy its content into the repo.)
2. **Original artwork only.** P5-*inspired* design language (red/black/white,
   halftone, skewed UI, ransom-note type, starbursts, silhouettes) — but no
   characters, masks, logos, emblems, UI screenshots or other assets from
   Persona or any other franchise. People are faceless silhouettes; an optional
   original protagonist is a generic student silhouette (no domino mask, no
   top-hat logo). Birds are generic.
3. **Deterministic rendering.** Every draw/evaluate path is a pure function of
   song time `t` plus precomputed data. Never call `Math.random()`, `Date.now()`
   or `performance.now()` inside rendering; use `MV.rand(seed, i, j)`,
   `MV.rng(seed)` (seeded per cue/line), `MV.noise1/2`. Offline export and live
   preview must render identical frames.
4. **Classic scripts.** No ES modules, no build step, no bundler. Each file is an
   IIFE with `'use strict'` that attaches to `window.MV`. The page must work
   from `file://` (drag-and-drop) and from any static server.
5. **Logical canvas 1920×1080.** All drawing uses `MV.W × MV.H` coordinates; the
   Stage scales. Safe area for text: x ∈ [80, 1840], y ∈ [60, 1020]. Keep the
   HUD zones (bottom-left 620×110, top-right 360×90) clear of lyric text.
6. **Robustness.** Every external call (fonts, IndexedDB, WebGL, WebCodecs,
   fetch) is wrapped so a failure degrades gracefully. A throwing scene / style /
   effect must never kill the frame (Stage isolates and logs once).
7. **Performance.** Target ≥ 50 fps at 1920×1080 on a mid laptop in Chrome.
   Pre-render static sprites once (`prepare(stage)`), use cached patterns
   (`MV.patterns.*`), avoid `getImageData` per frame, avoid `shadowBlur` > 20,
   keep per-frame path counts modest (< ~3000 primitives per scene).
8. Style: 2-space indent, single quotes, semicolons, JSDoc on public functions,
   comments in English, UI strings in Simplified Chinese (+ short English).

---

## 1. Files & load order (`index.html`)

```
vendor/mp4-muxer.js          window.Mp4Muxer (MIT, v5.2.2)
js/core.js                   MV namespace, constants, math, rng, draw/text helpers, registries
data/hoshi-to-bokura-to.js   timing preset (no lyric text) → MV.registerPreset
js/analysis.js               MV.Analysis  — offline DSP features, beat grid, sections, preset alignment
js/audio.js                  MV.AudioEngine — decode, playback clock, IndexedDB cache
js/lyrics.js                 MV.Lyrics — parse pasted text / LRC / preset timing, style assignment
js/render/scenes.js          registers MV.scenes.*        (full-frame backgrounds)
js/render/lyricfx.js         registers MV.lyricStyles.*   (lyric typography)
js/render/fx.js              registers MV.transitions.*, MV.effects.*, defines MV.HUD
js/render/post.js            MV.Post — WebGL post-processing (2D fallback)
js/director.js               MV.Director — cue timeline, evaluate(t) → FrameState
js/stage.js                  MV.Stage — buffers, compositing, renderFrame(t)
js/export.js                 MV.Exporter — WebCodecs + mp4-muxer, MediaRecorder fallback
js/sync.js                   MV.SyncEditor — tap-to-sync lyric timing editor
js/app.js                    MV.app — UI wiring, auto-load, keyboard, test API
css/app.css
tools/*.mjs|*.sh             dev harness (Playwright snapshots, perf, export test)
assets/                      user's own song/lyrics (git-ignored)
out/                         harness output (git-ignored)
```

---

## 2. Data model

### 2.1 Preset (`MV.registerPreset(p)`)
```js
{
  id: 'hoshi-to-bokura-to',
  meta: { title, titleLatin, artist, lyricist, composer, source, note },
  match: { duration: 221.27, tolerance: 2.0 },      // seconds
  bpm: 99.38, beatsPerBar: 4,
  beats: [0.72, 1.324, ...],                         // seconds, preset timeline
  sections: [{ kind, name, start, end, intensity, scenes:[...], switchBars?, switchOn?:'phrase', credits?, endCard? }],
  lines: [{ n, key, len, style?, phrases?:[{at, t}], end?, skip? }],
  leadIn: 0.3,                                        // seconds a line appears before it is sung
  refEnvelope: { hop: 0.05, data: '<base64 uint8>' } // novelty curve for offset alignment
}
```
* `lines[i].key` = `MV.lyricKey(lineText)`; `len` = code points of
  `MV.canonDisplay(lineText)`; `phrases[k].at` = code-point offset into that
  display string where timed chunk k starts; `t` = absolute seconds.
* `skip: true` → line exists in the published lyrics but is **not sung** in this
  recording (it must not be displayed).
* Section `kind` ∈ `intro | verse | pre | chorus | hook | interlude | bridge | build | climax | outro`.
* `refEnvelope`: mono signal; frames of `hop` seconds (non-overlapping,
  `hopSamples = floor(sr*hop)`); `e = log1p(100*rms)`, `e /= max(e)`;
  `d = max(0, e[i]-e[i-1])` (d[0]=0); `d /= max(d)`; quantised to uint8.

### 2.2 Features (`MV.Analysis.compute`)
```js
{
  duration, sampleRate,
  fps: 100, length: n,                       // envelope frame rate/count
  rms, low, mid, high, flux: Float32Array(n) // all normalised to 0..1
  onsets: [{ t, s }],                        // s = strength 0..1
  kicks: [t],                                // low-band onsets
  bpm, beatsPerBar: 4, beats: [t], downbeats: [t],
  sections: [{ kind, name, start, end, intensity, energy, scenes?, switchBars?, switchOn?, credits?, endCard? }],
  novelty: Float32Array,                     // refEnvelope-compatible curve (hop 0.05 s)
  source: 'computed' | 'preset',
  presetId: null | string, presetOffset: 0, presetConfidence: 0
}
```

### 2.3 LyricTrack (`MV.Lyrics.parse`)
```js
{
  source: 'preset' | 'lrc' | 'auto' | 'none',
  meta: { title?, artist? },
  lines: [Line], unmatched: [string], warnings: [string],
  matched: { total, matched, skipped }        // for the UI status line
}
Line = {
  id: 'L3', n: 3, index,                      // n = 1-based line number in the source; index = display order
  text,                                       // MV.canonDisplay(original)
  chars: [..],                                // Array.from(text)
  start, end,                                 // first sung phrase start / singing end (abs s)
  showStart, showEnd,                         // visible window (director may adjust)
  phrases: [{ text, start, end, charStart, charEnd, latin }],   // cover every non-space char, in order
  segments: [{ text, charStart, charEnd }],   // split on spaces
  charTimes: Float32Array(chars.length),      // reveal time per char (spaces = previous char time)
  style, styleSource: 'preset' | 'tag' | 'auto',
  emphasis: 0..1, isHook: bool, seed: uint32, sectionKind
}
```
`charTimes`: inside a phrase, chars are revealed across the first 55 % of the
phrase duration (min 0.06 s per char, first char exactly at `phrase.start`);
Latin phrases reveal per word.

### 2.4 Frame environment `env` (built by the Director, passed to every draw)
```js
env = {
  t, dt, duration,
  energy, low, mid, high, flux,              // 0..1, smoothed (~80 ms)
  onsetPulse,                                // 0..1 decaying pulse from recent strong onsets
  beat: { index, phase, period, bar, barPhase, beatInBar, sinceBeat, sinceDownbeat, pulse, barPulse },
  section: { kind, name, start, end, index, progress, intensity },
  intensity,                                 // 0..1, cross-faded ±0.5 s at section boundaries
  quality,                                   // 0.5..1 (Stage adaptive)
  seed                                       // section seed
}
```
`beat.pulse = MV.pulse(sinceBeat, 0.35)`, `barPulse = MV.pulse(sinceDownbeat, 0.6)`.

---

## 3. Module APIs

### 3.1 `MV.Analysis` (`js/analysis.js`)
```js
MV.Analysis.compute(audioBuffer, { onProgress }) → Promise<Features>   // yields to the event loop; < 3 s for 4 min
MV.Analysis.sample(features, name, t) → number                         // linear interpolation, 0 outside
MV.Analysis.avg(features, name, t0, t1) → number                        // mean over window (prefix sums)
MV.Analysis.beatInfo(features, t) → env.beat-shaped object
MV.Analysis.sectionAt(features, t) → { section, index } | null
MV.Analysis.novelty(audioBuffer) → Float32Array                         // exactly the refEnvelope formula
MV.Analysis.matchPreset(features, presets) → { preset, offset, confidence } | null
MV.Analysis.applyPreset(features, preset, offset) → features            // copies beats/sections (+offset), source='preset'
```
Algorithms: STFT (radix-2 FFT, Hann, 2048 @ 22.05 kHz mono downmix, hop → 100 fps);
band energies; log-compressed spectral flux; adaptive-threshold peak picking;
tempo by autocorrelation of flux with a log-normal prior around 110 BPM
(60–200); Ellis-style dynamic-programming beat tracking; downbeat phase by
low-band energy + novelty; sections by checkerboard novelty on bar-synchronous
features (min 8 bars), labelled by energy/position. `matchPreset`: duration
within tolerance **or** normalised cross-correlation of `novelty` vs the
preset `refEnvelope` over offsets ±20 s (confidence = peak NCC); accept if
confidence ≥ 0.5 (or duration match and confidence ≥ 0.3).

### 3.2 `MV.AudioEngine` (`js/audio.js`)
```js
const eng = new MV.AudioEngine();
await eng.loadFile(file) | eng.loadArrayBuffer(ab, name) | eng.loadURL(url)  // → AudioBuffer
eng.buffer, eng.name, eng.duration, eng.ctx
eng.play(from?) ; eng.pause() ; eng.toggle() ; eng.seek(t) ; eng.setVolume(v) ; eng.setRate(r)
eng.currentTime   // getter: precise clock from AudioContext, minus output latency, clamped
eng.playing       // getter
eng.on(event, fn) // 'loaded' | 'play' | 'pause' | 'seek' | 'ended' → returns unsubscribe
eng.streamDestination() → MediaStream   // lazily created; audio also goes to speakers
MV.AudioEngine.cacheSave(name, arrayBuffer) / MV.AudioEngine.cacheLoad() → {name, arrayBuffer}|null   // IndexedDB, never throws
```

### 3.3 `MV.Lyrics` (`js/lyrics.js`)
```js
MV.Lyrics.parse(text, { preset, features, offset=0 }) → LyricTrack
MV.Lyrics.assignStyles(track, features)          // fills style for lines without one
MV.Lyrics.toLRC(track) → string                  // line + enhanced phrase stamps
MV.Lyrics.isMetaLine(str) → bool                 // credits/title/bracket lines
MV.Lyrics.activeLines(track, t) → [Line]
MV.Lyrics.withTimes(track, fn) → LyricTrack      // clone with remapped times (sync editor / offset)
```
Preset mode: match by `key`; unmatched preset lines fall back to order-based
mapping of the remaining non-meta pasted lines (offsets by ratio, snapped to
the nearest space/char). LRC mode: `[mm:ss.xx]` (multi-stamp), `[offset:±ms]`,
`[ti:]`, `[ar:]`, enhanced `<mm:ss.xx>`, blank stamped line = end marker,
leading `{style}` tag. Auto mode (plain text, no preset): distribute lines by
character count across vocal sections, snapped to downbeats, warning emitted.

Style heuristics (auto): ≤ 6 chars → `impact`; Latin tail in chorus →
`ransom`/`split`; verse → alternate `dialog`/`slash`; pre → `glitch`; chorus →
cycle `ransom`,`split`,`slash`; hook → `impact`; bridge → `vertical` (no Latin)
else `dialog`; outro → `card`. A repeated line reuses the style of its first
occurrence.

### 3.4 Scenes (`js/render/scenes.js`)
```js
MV.scenes.register(name, {
  prepare?(stage),            // once; pre-render sprites (stage.W/H known)
  draw(ctx, env, p)           // must paint the whole frame opaquely
});
// p = { seed, lt /*s since cue start*/, dur, variant, speed, intensity }
```
Required names: `night-city`, `train`, `crowd`, `tunnel`, `stripes`,
`sunburst`, `sky-red`, `shards`, `starfield`, `void`.

### 3.5 Lyric styles (`js/render/lyricfx.js`)
```js
MV.lyricStyles.register(name, {
  layout(line, ctx) → layout,                 // pure; cached per line by Stage
  draw(ctx, line, layout, lt, env)
});
// lt = { t /*env.t - line.start*/, in /*0..1 entrance*/, out /*0..1 exit*/, showStart, showEnd }
MV.LyricFX = { drawLatin(ctx, text, x, y, size, progress, env, seed), ... }   // shared helpers
```
Required names: `ransom`, `slash`, `impact`, `dialog`, `vertical`, `card`,
`split`, `glitch`. Every style: reveals glyphs by `line.charTimes`, renders
Latin phrases with Latin faces, handles 1–40 chars (auto-wrap by phrases /
segments), stays in the safe area, animates `in` and `out`.

### 3.6 Transitions, effects, HUD (`js/render/fx.js`)
```js
MV.transitions.register(name, { duration, draw(ctx, fromCanvas, toCanvas, p, env, seed) });
MV.effects.register(name, { layer: 'under' | 'over', duration, draw(ctx, env, a) });
// a = accent { kind, t, dur, strength, seed, x?, y?, text?, data? } ; local time = env.t - a.t
MV.HUD.draw(ctx, env, info)   // info = { title, artist, duration, visible, sectionName }
```
Transitions: `slash-wipe`, `red-flash`, `shatter`, `ink-wipe`, `star-iris`,
`stripe-wipe`, `glitch-cut`, `zoom-punch`.
Effects: `flash`, `speedlines`, `ink`, `stars`, `shards`, `ring`, `frame`,
`confetti`, `caption`, `credits`, `title`, `endcard`.

### 3.7 `MV.Post` (`js/render/post.js`)
```js
const post = new MV.Post(outputCanvas);  // WebGL2 → WebGL1 → 2D fallback
post.resize(w, h);
post.render(sourceCanvas, { rgbShift, glitch, glitchSeed, grain, vignette, flash, redFlash, invert, scanlines, time });
post.isWebGL; post.dispose();
```

### 3.8 `MV.Director` (`js/director.js`)
```js
const dir = new MV.Director({ features, track, preset, options: { hud: true, credits: true } });
dir.evaluate(t) → FrameState
dir.cues        → { scenes: [...], accents: [...], lyrics: [...] }
dir.setTrack(track); dir.setFeatures(features); dir.setOptions(o)
FrameState = {
  t, env,
  scene: { from: { name, p }, to: { name, p } | null, transition: { name, p, seed } | null },
  lyrics: [{ line, lt }],                     // ≤ 2 at once
  accents: [accent],                          // active only
  camera: { x, y, zoom, rot },
  post: { ...MV.Post params }, hud: { ...MV.HUD info }
}
```

### 3.9 `MV.Stage` (`js/stage.js`)
```js
const stage = new MV.Stage({ canvas, scale: 1 });  // scale = render resolution factor
stage.setDirector(dir); stage.prepare();           // runs scene.prepare once
stage.renderFrame(t) → { ms }                      // full composite into `canvas`
stage.resize(scale); stage.invalidateLayouts();
```
Order: scene (camera) → transition composite → `under` effects → lyrics
(camera × 0.35 parallax) → `over` effects → HUD → Post.

### 3.10 `MV.Exporter` (`js/export.js`)
```js
MV.Exporter.capabilities() → Promise<{ webcodecs, h264, vp9, aac, opus, mediaRecorder }>
const ex = new MV.Exporter({ director, audioBuffer, width, height, fps, range?: [t0, t1], onProgress });
await ex.run() → { blob, filename, mime, codec }
ex.cancel()
```
WebCodecs path renders on its own offscreen Stage (never touches the preview),
muxes with `Mp4Muxer` (`fastStart: 'in-memory'`), H.264 → VP9 fallback, AAC →
Opus fallback, backpressure on `encodeQueueSize`. Fallback: realtime
`MediaRecorder` capture.

### 3.11 `MV.SyncEditor` (`js/sync.js`) and `MV.app` (`js/app.js`)
See those files' headers. Test API exposed as
`window.MV.app = { loadAudioURL, setLyricsText, renderAt, play, pause, seek, getState, exportVideo }`.

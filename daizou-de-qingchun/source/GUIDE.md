# 《「贷」走的青春》— film style bible & engine guide

You are building one or two scenes of a ~25–30 minute Chinese short film, rendered entirely
in code (Python + skia-python + procedural audio + ZipVoice TTS). The screenplay is in
`/opt/film/script.txt` (read your scenes there, word for word). Two finished example scenes
are the reference for quality and idiom — READ THEM FIRST:

- `scenes/s01_loop.py` — an A-line (loop) scene
- `scenes/s02_d62.py`  — a B-line (countdown) scene

Everything runs with the wrapper `./run` from `/opt/film` (it sets LD_LIBRARY_PATH for skia).

## 1. The concept (the director's intent — keep to it)

The film is shot by **a bystander camera**: it sees everything and never intervenes. We never
show a face. People are objects, silhouettes, positions on a floor plan, voices. Zhang Chaoyang
is present through his things: the washed-out sneakers with tight laces, the sketchbook and the
half-drawn plane tree (梧桐), the desk lamp, the cracked phone, his diary.

Two visual systems, so the audience always knows where it is without reading a caption:

| | A line【循环】5月9日 | B line【倒计时】62 days |
|---|---|---|
| frame | full 16:9 (1920×1080) | **4:3** inside black pillarbox (local canvas 1440×1080) |
| look | cold evidence room: pale blue-grey grid, precise vector ink, floor plan of the dorm | Zhang's **pencil sketchbook**: warm paper, graphite strokes that draw themselves |
| camera | **fixed**. Every loop opens with the same images (alarm → bed-board crack → phone → floor plan master). Nothing moves except dots on the plan and text | loose, observational; shots are "pages" (crossfade between drawings) |
| text | right-column **event log** (timestamped action, `O.event_log`) + **transcript** subtitles (笔录 style, typed on) | film subtitles (serif) + sparing narration + quiet captions |
| colour | only accent is **RED** — reserved for 「贷」 in the title and the hidden 「月」 character (and evidence numbers) | paper goes warm→grey as the countdown falls (`O.b_paper(day)`); saturated colour only for Li's RGB gaming glow; warm lamp light; the milk-tea shop's warm yellow |
| sound | quiet room tone, the alarm melody (identical every loop), the siren, paper | loud world (game gunfire, video chatter, keyboard) vs Zhang's quiet (pencil, breath) |

The final moment of the film (scene 14) is the first time the A-line "camera" moves.

Director's rules:
1. **Never depict the suicide.** No falling, no body, no edge-of-roof POV. The script already cuts
   away; stay behind the door frame. (WHO guidance for screen media.)
2. **No faces.** Silhouettes from behind at most (see Li's backlit silhouette in s02).
3. **Restraint.** No melodramatic music. The alarm melody is the only musical motif; low drones
   are allowed sparingly for dread. Silence is a tool: hold it.
4. **Hold the silences the script asks for in real time** (the 15 seconds, the 5-second pauses).
5. Every line of dialogue in the script must be spoken by the right voice. Stage directions may
   become: images, sound, the A-line event log, silent on-screen captions (`sc.caption`), or
   narration (`sc.narr`) — use narration mainly for the script's *authorial commentary* sentences
   (e.g. 「他们都没有意识到，这十五秒……」). Don't narrate what the picture/sound already shows.
   Nothing important in the script may be dropped; small trims of pure blocking are fine.
6. Pacing: let scenes breathe (0.4–1.5 s between lines, longer after blows), but no dead air
   without purpose. Typical scene length 1.5–3.5 min.

## 2. Continuity facts (shared across scenes — do not contradict)

- Loop counter (`O.loop_counter`): s01=11, s03=12, s05=13, s08=14, s12=15. In s12, Li's line
  「十一次了」 is changed to 「十五次了」 for consistency.
- Every A-line scene opens at **5月9日 08:30** with the same alarm (`sfx.alarm(n)`), a short beat on
  the bed-board crack (`O.bed_board`) — keep it SHORT in later loops (1.5–3 s: the audience knows),
  then the floor-plan master (`O.floorplan`, same placement as s01: PX,PY,PS = 200,120,1.0 and
  right column at x=1010). The clock card shows the latest event-log stamp (as in s01).
- Floor-plan spots: `O.PLAN_SPOTS` (li_bed, chen_bed, window, zhang_desk, trash, door, li_desk,
  chen_desk, center). People are `O.person_dot(c, x, y, '李'/'陈')`.
- B-line countdown card at the start of each B scene: `O.countdown_card(c, day, t)` on
  `O.b_background(c, day)`. Days: s02=62, s04=60, s06=42, s07=35, s09=14, s10=3, s11=1,
  s13 shows the date card 「5月8日 23:47」 instead.
- The plane tree: `O.sketchbook_page(c, progress, day=..)`; progress reached 0.44 in s02; it is
  never finished — `O.TREE_FINAL = 0.62` is how far it ever gets (s14 shows it at that value).
- Contract: 借款人：张朝阳 / 借款金额：陆仟元整 / 利率：百分之十五 + the tiny 「月」 at the extreme
  right edge of line 4, one font size smaller. Money: 6000 → monthly interest 900 (not 450) →
  arrears 9300 → new loan 12000 (0 yuan received) → later 27000.
- Diary dates: 3月18日 signed; 3月28日 found 月; 4月2日; 4月10日; 4月17日; 5月8日.
- The card: `O.card(...)` 「急速借 · 肖强」. Xiao Qiang: clean polo shirt, rimless glasses, laptop,
  milk tea — show him only through objects (glasses on the table, the cup, the laptop, his hand
  pushing papers).

## 3. Engine API (what you write)

A scene is `scenes/<key>.py` with `build()` returning a finished `Scene`:

```python
from film.config import *          # W,H,BW,FPS,SR, palettes: A_BG A_INK A_MID A_FAINT RED GRAPHITE NIGHT LAMP TEA RGB_M RGB_C WHITE
from film.gfx import *             # text, text_block, vtext, wrap, paint, col, glow, vignette, rect, line, smooth, ease_*, ramp, clamp, fade, mix, paper
from film.timeline import Scene
from film.sketch import Drawing, smudge, pen_point
from film import objects as O, sfx
import skia, math, functools, numpy as np

def build():
    sc = Scene('s03_loop', kind='A')           # kind 'A' (16:9) or 'B' (4:3). kind='X' + frame='16:9' for title/epilogue
    ...
    sc.finish(tail=0.5)
    return sc
```

Clock: `sc.t` is the cursor (seconds, scene-local). `sc.wait(s)` / `sc.hold(s)` advance it,
`sc.at(t)` sets it, `sc.mark(name)`.

Voice: `sc.say(who, text, *, speed=1.0, fx='room', gain=0, pan=0, post=0.45, sub=True,
sub_text=None, note='', tts=None, variant=0, at=None, advance=True)` → `(start, end)`, cursor moves
to `end + post`.
- `who`: `zhang` 张朝阳 (quiet, soft), `li` 李浩然 (loud, fast), `chen` 陈杰辉 (calm), `xiao` 肖强
  (soft, smooth), `cuishou` 催收员 (curt), `father` 父亲, `narr` narrator (female, calm).
- `speed` is a **multiplier** on the character's calibrated pace (0.85 = slower, 1.1 = faster).
- `fx`: `'room'` (default, dorm), `'dry'`, `'phone'` (telephone line — also auto-labels subtitle
  「电话」), `'vo'` (voice-over / narration), `'far'`, `'inner'` (voice in the head, reverberant),
  `'stair'`, `'hall'`.
- `note`: small label next to the speaker name (e.g. `'画外音'`, `'电话'`, `'声音很小'`).
- `sub_text`: what the subtitle shows if different from spoken text (keep the script's punctuation
  like —— and …… on screen; the TTS strips them automatically). `tts`: spoken text override to
  fix a mispronounced polyphone (e.g. write a homophone).
- Keep each `say` ≤ ~45 characters; split long speeches into consecutive `say` calls
  (`post=0.25` between halves) for natural prosody.
- `sc.narr(text, ...)` = narrator with `fx='vo'`, centred narration subtitle.
- `sc.caption(text, start=None, dur=3.0)` = silent on-screen text (serif, centred bottom).
- Subtitle look: `sc.sub_color = WHITE` on dark pages; `sc.sub_y = ...` to move the baseline.

Sound: `sc.sfx(array, at=None, gain=dB, pan=-1..1, fin=s, fout=s, bus='fx'|'amb'|'music')`,
`sc.amb(array, start, end=None, gain=dB)` (looped to fit; end=None → scene end),
`sc.music(array, start, gain, end=None)`. Ambience and music are ducked under dialogue
automatically. Typical gains: room tone −2…−6, footsteps −10…−14, game −9, drones −10…−16.
Library `film/sfx.py` (read it): `alarm(loops)`, `alarm_elegy()`, `room_tone(d)`, `wind(d,strength)`,
`campus(d)`, `cafe(d)`, `machinery(d)`, `drone(d, root)`, `siren(d)`, `phone_ring(d)`,
`vibrate(d)`, `busy_tone(n)`, `click()`, `keyboard(d)`, `gunfire(d)`, `chatter(d)`, `pencil(d)`,
`paper_tear()`, `paper_rustle()`, `door('open'|'close')`, `footsteps(n, interval)`, `heartbeat(d)`,
`hum(d, f)`, `printer(d)`, `scream_far()`, `thump_low()`, `swell(d)`, `victory()`,
`pen_on_paper(d)`, `water_pour(d)`, `rain(d)`, `musicbox/marimba/piano(f)`, `sequence(notes)`.
Vary `seed` arguments so repeated sounds are not identical (except the alarm, which must be).
You may write new small procedural sounds inside your scene file.

Visuals: `sc.layer(fn, start, end=None, z=0, fin=0, fout=0, name='')`; `fn(c, t, L)` draws on the
skia canvas `c` at layer-local time `t`; `L.T` = scene time, `L.w/L.h` = canvas size
(1440×1080 for B, 1920×1080 for A), `L.dur`. Layers are drawn in z order; fades are handled for
you. For a crossfade, overlap the next layer's start with the previous one's end and give both
fades. Every moment of the scene must be covered by some layer (no accidental black), unless a
black beat is intended.

Drawing helpers:
- `text(c, s, x, y, font, size, rgb, a, align, tracking)` (y = baseline). Fonts: `serif`,
  `serif-light`, `serif-xlight`, `serif-medium`, `serif-bold`, `serif-heavy`, `sans`, `sans-xlight`,
  `sans-light`, `sans-medium`, `sans-bold`, `sans-heavy`, `hand` (LXGW WenKai — use for Zhang's
  handwriting/diary). `text_block(...)` wraps; `vtext` vertical.
- `Drawing(seed)` pencil strokes: `.line .poly .curve .rect(x,y,w,h) .ellipse .hatch(poly, angle,
  spacing) .scribble .fill(poly, rgb, a)` (opaque fill e.g. silhouettes) `.extend(other)`;
  `.draw(c, progress=0..1, alpha)` — progress animates the drawing being drawn. Build drawings
  ONCE (module-level function with `functools.lru_cache`), draw every frame. `smudge(c, poly, rgb, a,
  blur)` for soft graphite tone.
- Objects (`film/objects.py`, read it): A: `a_background, floorplan, person_dot, plan_xy,
  event_log, clock_card, loop_counter, evidence_tag, phone_screen, bed_board, ink`. B:
  `b_background, b_paper, countdown_card, sketchbook_page, draw_pencil, tree, window_frame,
  desk_set, cracked_phone, shoes, card`.
- **The contract** (use it everywhere it appears, A or B line):
  `L = O.contract_page(c, x, y, s=1.0, a=1.0, amount='陆仟元整', date='3月18日', yue_red=0..1,
  highlight=('amount','rate','term'), sign=0..1, sign_shaky=0..1, paper_rgb, ink_rgb, shadow=True)`.
  Page is `O.CONTRACT_W×O.CONTRACT_H` (620×877) × s. Returns layout dict: `L['yue']` = (x, y) of the
  tiny 「月」 relative to the page origin (scaled) — use it to zoom/push in on the 月; also
  `L['rate_y']`, `L['amount_y']`, `L['term_y']`, `L['sign_y']`, `L['mx']` (left margin).
  To push in: `c.save(); c.translate(cx, cy); c.scale(k, k); c.translate(-fx, -fy)` around the 月.
- Light: `glow(c, x, y, r, rgb, a)` (screen blend), `vignette(c, w, h, strength)`.

Performance budget: a frame must render in < 60 ms. Don't rebuild Drawings or paper textures per
frame; cache them. Avoid huge blur filters on full frames every frame.

## 4. Your loop

1. Read the two example scenes, `film/objects.py`, `film/sfx.py`, and your scenes in the script.
2. Write `scenes/<key>.py`.
3. `./run build.py preview <key> --n 16 --t 12.5,40` → contact sheet `out/preview/<key>_sheet.png`,
   full frames at the given scene times, audio `out/preview/<key>.wav`, the subtitle timeline,
   and an ASR check of every voiced line. **Look at the sheet and frames with the Read tool.**
4. Iterate until: every script beat is present and in order; composition is clean (nothing
   overlapping subtitles, text inside the frame, no accidental black, no clutter); ASR
   mismatches are only harmless homophones (fix real mispronunciations with `tts=` or
   `variant=1..3`); pacing feels right from the timeline.
5. Do NOT edit shared files under `film/` (other agents are using them in parallel). Put new
   helpers/drawings in your own scene file. If you find a real engine bug, work around it locally
   and report it in your final answer.

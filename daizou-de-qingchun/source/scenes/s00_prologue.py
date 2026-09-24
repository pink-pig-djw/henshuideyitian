"""序幕  外景 宿舍楼天台 夜.

Content note -> black, wind -> a cracked phone lights up in the dark: a call to 「爸」 ->
his voice-over; through the line, a construction site and his father shouting -> he hangs up
at 00:41 -> the phone is laid face-down on the concrete, its light goes out -> low angle:
the washed-out sneakers, laces tied tight, step up onto the parapet -> wind -> CUT TO BLACK
before anything moves -> far away, a scream -> title.

The prologue belongs to neither visual system: it is their negative. The phone is drawn with
the A line's clean vector precision, the shoes with the B line's graphite — both inverted,
pale lines on black, as if seen only where a little light touches them."""
import math, functools
import numpy as np
from film.config import *
from film.gfx import *
from film.timeline import Scene
from film.sketch import Drawing
from film.audio import phone as phone_fx, lowpass, bandpass, highpass
from film import objects as O, sfx

CHALK = (200, 200, 195)
SHOE_FILL = (50, 50, 48)        # washed-out canvas: the shoes are the palest thing on the roof
GREY = (150, 150, 146)

# =====================================================================
# small procedural sounds
# =====================================================================
def _t(d):
    return np.arange(int(d * SR)) / SR

def phone_down(seed=301):
    """A phone laid face-down on concrete: soft knock, a little grit, a tiny rattle."""
    rng = np.random.default_rng(seed)
    d = 0.35; t = _t(d)
    knock = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 40) * 0.5 + np.sin(2 * np.pi * 410 * t) * np.exp(-t * 60) * 0.25
    grit = bandpass(rng.normal(0, 1, len(t)).astype(np.float32), 1800, 6000) * np.exp(-t * 55) * 0.25
    x = knock + grit
    k = int(0.055 * SR)             # second, smaller contact (the other edge settles)
    x[k:] += (np.sin(2 * np.pi * 230 * t[:-k]) * np.exp(-t[:-k] * 55) * 0.18)
    return lowpass(x.astype(np.float32), 5000)

def gust_roar(d, seed=8):
    """The wind suddenly getting up: wide stereo wind plus a low buffeting rumble. Stereo."""
    w = sfx.wind(d, seed, 3.2)
    rng = np.random.default_rng(seed)
    n = len(w)
    rum = lowpass(np.cumsum(rng.normal(0, 1, n)).astype(np.float32), 90)
    rum = rum - lowpass(rum, 12)
    rum = rum / (np.abs(rum).max() + 1e-9) * 0.12
    buf = 0.6 + 0.4 * np.sin(2 * np.pi * 0.7 * _t(d)[:n]) * np.sin(2 * np.pi * 1.9 * _t(d)[:n] + 1)
    return (w + np.stack([rum * buf, rum * buf], 1)).astype(np.float32)

def sole_step(seed=311, a=1.0):
    """Rubber sole set down on concrete: a soft thud with a short scuff."""
    rng = np.random.default_rng(seed)
    d = 0.4; t = _t(d)
    thud = lowpass(rng.normal(0, 1, len(t)).astype(np.float32), 500) * np.exp(-t * 30) * 0.9
    body = np.sin(2 * np.pi * 88 * t) * np.exp(-t * 26) * 0.5
    scuff = bandpass(rng.normal(0, 1, len(t)).astype(np.float32), 1500, 5000) * np.exp(-((t - 0.03) / 0.035) ** 2) * 0.18
    return ((thud + body + scuff) * a).astype(np.float32)

# =====================================================================
# the phone: a clean call UI, drawn in pale lines on black
# =====================================================================
SX, SY, SWD, SHT = 780, 104, 360, 760          # screen rect
SCX = SX + SWD / 2

@functools.lru_cache(maxsize=1)
def crack_paths():
    """The spider-web crack of his phone (same origin as O.cracked_phone: 66% across, 30% down)."""
    rng = np.random.default_rng(41)
    ox, oy = SX + SWD * 0.66, SY + SHT * 0.30
    paths = []
    for k in range(10):
        ang = rng.uniform(0, 2 * math.pi)
        L = rng.uniform(90, 330)
        p = skia.Path(); p.moveTo(ox, oy)
        cx, cy = ox, oy
        for j in range(6):
            cx += math.cos(ang) * L / 6 + rng.normal(0, 5); cy += math.sin(ang) * L / 6 + rng.normal(0, 5)
            p.lineTo(cx, cy)
        paths.append(p)
    for rr in (18, 44, 78):
        a0 = rng.uniform(0, 360)
        p = skia.Path(); p.addArc(skia.Rect.MakeXYWH(ox - rr, oy - rr * 0.9, 2 * rr, 1.8 * rr), a0, rng.uniform(140, 250))
        paths.append(p)
    return paths

def _handset(c, cx, cy, rgb, a, s=1.0):
    """Hang-up glyph: a horizontal handset."""
    p = paint(rgb, a, 5.0 * s)
    path = skia.Path()
    path.addArc(skia.Rect.MakeXYWH(cx - 17 * s, cy - 7 * s, 34 * s, 26 * s), 200, 140)
    c.drawPath(path, p)
    for sx in (-1, 1):
        c.drawRoundRect(skia.Rect.MakeXYWH(cx + sx * 14 * s - 5 * s, cy + 1 * s, 10 * s, 6 * s), 3 * s, 3 * s, paint(rgb, a))

def _icon_mic(c, cx, cy, rgb, a):
    c.drawRoundRect(skia.Rect.MakeXYWH(cx - 5, cy - 12, 10, 16), 5, 5, paint(rgb, a, 1.4))
    arc = skia.Path(); arc.addArc(skia.Rect.MakeXYWH(cx - 9, cy - 8, 18, 16), 0, 180)
    c.drawPath(arc, paint(rgb, a, 1.4))
    line(c, cx, cy + 8, cx, cy + 12, rgb, a, 1.4)

def _icon_keypad(c, cx, cy, rgb, a):
    for i in range(3):
        for j in range(3):
            c.drawCircle(cx - 8 + 8 * i, cy - 8 + 8 * j, 1.8, paint(rgb, a))

def _icon_speaker(c, cx, cy, rgb, a):
    p = skia.Path()
    p.moveTo(cx - 10, cy - 4); p.lineTo(cx - 5, cy - 4); p.lineTo(cx + 1, cy - 9); p.lineTo(cx + 1, cy + 9)
    p.lineTo(cx - 5, cy + 4); p.lineTo(cx - 10, cy + 4); p.close()
    c.drawPath(p, paint(rgb, a, 1.4))
    for r in (6, 11):
        arc = skia.Path(); arc.addArc(skia.Rect.MakeXYWH(cx + 1 - r, cy - r, 2 * r, 2 * r), -45, 90)
        c.drawPath(arc, paint(rgb, a, 1.3))

def call_screen(c, lit, timer_s, ended, press, T, draw_timer=True):
    """The call UI. lit 0..1, timer in seconds, ended 0..1 (after hang-up), press 0..1 (button flash)."""
    if lit <= 0:
        return
    glow(c, SCX, SY + SHT * 0.45, 560, (150, 168, 196), 0.05 * lit)
    rr = skia.RRect.MakeRectXY(skia.Rect.MakeXYWH(SX, SY, SWD, SHT), 46, 46)
    # the glass: dark UI, a faint cool light toward the top
    shader = skia.GradientShader.MakeLinear([(SCX, SY), (SCX, SY + SHT)],
                                            [col((34, 37, 43), lit), col((17, 18, 21), lit), col((12, 12, 14), lit)], [0, 0.45, 1])
    c.drawRRect(rr, skia.Paint(Shader=shader, AntiAlias=True))
    c.drawRRect(rr, paint((88, 91, 98), 0.9 * lit, 1.3))
    ui = lit * (1 - 0.0 * ended)
    # status bar: signal and a low battery
    for i in range(4):
        hgt = 5 + 3 * i
        c.drawRect(skia.Rect.MakeXYWH(SX + 34 + i * 7, SY + 42 - hgt, 4, hgt), paint(GREY, ui * (0.9 if i < 2 else 0.3)))
    c.drawRoundRect(skia.Rect.MakeXYWH(SX + SWD - 64, SY + 30, 26, 13), 3, 3, paint(GREY, ui * 0.9, 1.2))
    c.drawRect(skia.Rect.MakeXYWH(SX + SWD - 37, SY + 34, 2.5, 5), paint(GREY, ui * 0.9))
    c.drawRect(skia.Rect.MakeXYWH(SX + SWD - 61.5, SY + 32.5, 4, 8), paint(GREY, ui * 0.9))
    # name + timer
    text(c, '爸', SCX, SY + 262, 'sans-light', 84, WHITE, ui, 'center')
    if draw_timer:
        draw_timer_text(c, timer_s, ui)
    if ended > 0:
        text(c, '通话结束', SCX, SY + 364, 'sans-light', 20, (140, 140, 136), ui * ended, 'center', tracking=0.3)
    # function buttons fade once the call has ended
    fa = ui * (1 - 0.75 * ended)
    for i, (lab, icon) in enumerate((('静音', _icon_mic), ('键盘', _icon_keypad), ('免提', _icon_speaker))):
        bx, by = SCX + (i - 1) * 104, SY + 528
        c.drawCircle(bx, by, 33, paint((120, 122, 126), fa * 0.9, 1.2))
        icon(c, bx, by, (205, 205, 200), fa * 0.9)
        text(c, lab, bx, by + 60, 'sans-light', 15, (130, 130, 126), fa, 'center', tracking=0.2)
    hx, hy = SCX, SY + 668
    if press > 0:
        c.drawCircle(hx, hy, 38, paint(WHITE, 0.85 * press * ui))
    c.drawCircle(hx, hy, 38, paint(WHITE, fa * 0.95, 1.5))
    _handset(c, hx, hy - 3, mix(WHITE, (20, 20, 20), press), fa)
    # the crack across the glass
    c.save(); c.clipRRect(rr, True)
    cp = paint(WHITE, 0.15 * lit, 0.9)
    for p in crack_paths():
        c.drawPath(p, cp)
    c.restore()

def draw_timer_text(c, timer_s, a):
    mm, ss = divmod(int(timer_s), 60)
    text(c, f'{mm:02d}:{ss:02d}', SCX, SY + 322, 'sans-light', 30, (178, 178, 174), a, 'center', tracking=0.06)

@functools.lru_cache(maxsize=2)
def call_plate(ended):
    """The lit call screen without its running timer (ended=0), or the frozen end state (ended=1)."""
    surf = skia.Surface(W, H)
    c = surf.getCanvas(); c.clear(col((0, 0, 0)))
    call_screen(c, 1.0, 41, float(ended), 0.0, 0.0, draw_timer=bool(ended))
    return surf.makeImageSnapshot()

# =====================================================================
# textures
# =====================================================================
@functools.lru_cache(maxsize=4)
def concrete(w, h, seed=7, lo=150, hi=255):
    """Bright speckled concrete, used with multiply so it only shows where light falls."""
    rng = np.random.default_rng(seed)
    g = rng.normal(0, 1, (h, w)).astype(np.float32)
    g = (g + np.roll(g, 1, 0) + np.roll(g, 1, 1)) / 3
    big = rng.normal(0, 1, (h // 16 + 2, w // 16 + 2)).astype(np.float32)
    big = np.kron(big, np.ones((16, 16), np.float32))[:h, :w]
    v = 205 + g * 22 + big * 10
    pits = rng.random((h, w)) < 0.004
    v[pits] -= 80
    v = np.clip(v, lo, hi).astype(np.uint8)
    arr = np.dstack([v, v, v, np.full_like(v, 255)])
    return skia.Image.fromarray(np.ascontiguousarray(arr), colorType=skia.kRGBA_8888_ColorType)

# =====================================================================
# the sneakers (side view, facing right; local origin = heel on the ground, y up is negative)
# =====================================================================
def _S(pts, s):
    return [(x * s, y * s) for x, y in pts]

SOLE = [(7, 0), (284, 0), (300, -5), (309, -16), (309, -26), (300, -31), (8, -30), (1, -21), (1, -8)]
HEEL = [(3, -30), (0, -56), (2, -84), (10, -106)]
COLLAR = [(10, -106), (30, -101), (52, -93), (74, -95), (90, -104)]
TONGUE = [(90, -104), (93, -116), (103, -122), (116, -119), (126, -109)]
INSTEP = [(126, -107), (150, -95), (180, -81), (210, -67), (238, -55), (262, -49)]
TOECAP = [(240, -31), (256, -45), (280, -50), (300, -44), (308, -32)]
STAY = [(92, -97), (120, -87), (150, -76), (180, -64), (205, -54), (216, -43), (222, -31)]
SILHOUETTE = (SOLE[:5] + [(306, -34), (300, -44), (280, -50), (262, -49), (238, -55), (210, -67), (180, -81), (150, -95),
                          (126, -109), (116, -119), (103, -122), (93, -116), (90, -104), (74, -95), (52, -93),
                          (30, -101), (10, -106), (2, -84), (0, -56), (3, -30), (1, -8)])
EYELETS = [(101, -94), (122, -86), (143, -78), (164, -70), (185, -61)]
KNOT = (106, -110)

def _interp(poly, x):
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    return float(np.interp(x, xs, ys))

@functools.lru_cache(maxsize=4)
def sneaker(seed=51, s=1.0, rgb=CHALK, simple=False):
    """One washed-out canvas sneaker, laces tied tight, drawn in chalk.
    simple=True: outline only (the far shoe of the pair, mostly hidden)."""
    d = Drawing(seed=seed, rgb=rgb, width=1.8 * s, alpha=0.86, wobble=0.9 * s)
    S = lambda pts: _S(pts, s)
    d.poly(S(SOLE), closed=True)
    d.curve(S(HEEL)); d.curve(S(COLLAR)); d.curve(S(TONGUE))
    d.curve(S(INSTEP)); d.curve(S(TOECAP))
    if simple:
        return d
    # foxing stripe and a worn tread edge
    d.line(6 * s, -15 * s, 306 * s, -15 * s, w=1.0 * s, a=0.55, passes=1)
    for k in range(17):
        x = 18 + k * 16
        d.line(x * s, -4 * s, (x + 6) * s, -4 * s, w=0.8 * s, a=0.3, passes=1)
    # eyelet stay down to the vamp seam; heel stripe; one quarter seam
    d.curve(S(STAY), w=1.3 * s, a=0.8)
    d.curve(S([(12, -32), (15, -66), (18, -100)]), w=1.0 * s, a=0.45, passes=1)
    d.curve(S([(40, -31), (66, -52), (98, -60), (128, -57)]), w=0.9 * s, a=0.22, passes=1)
    d.curve(S([(248, -39), (272, -43), (296, -39)]), w=0.8 * s, a=0.3, passes=1)
    # eyelets and the laces: short, even, parallel bars pulled tight over the instep
    for (x, y) in EYELETS:
        d.ellipse(x * s, y * s, 3.0 * s, 2.4 * s, w=0.9 * s, a=0.75, passes=1)
    for (x, y) in EYELETS[1:]:
        xt = x + 12
        d.line(x * s, (y - 2) * s, xt * s, (_interp(INSTEP, xt) + 1) * s, w=1.5 * s, a=0.95, wobble=0.25 * s, passes=1)
        d.line((x - 9) * s, (_interp(INSTEP, x - 9) + 1) * s, (x + 1) * s, (y - 2) * s, w=1.1 * s, a=0.55, wobble=0.25 * s, passes=1)
    # the bow, small and pulled tight: two flat loops lying along the instep
    kx, ky = KNOT
    d.ellipse(kx * s, ky * s, 3.6 * s, 3.0 * s, w=1.4 * s, a=0.95, passes=1)
    d.curve(S([(kx - 3, ky - 1), (kx - 11, ky - 6), (kx - 20, ky - 5), (kx - 13, ky), (kx - 3, ky + 1)]), w=1.4 * s)
    d.curve(S([(kx + 3, ky - 1), (kx + 12, ky - 7), (kx + 22, ky - 6), (kx + 14, ky - 1), (kx + 3, ky + 1)]), w=1.4 * s)
    # washed-out canvas: a few faint weave marks
    rng = np.random.default_rng(seed)
    for k in range(9):
        x = rng.uniform(24, 225)
        top = min(_interp(STAY, x) if x > 92 else _interp(COLLAR, x), -40)
        if top + 14 > -40:
            continue
        y = rng.uniform(top + 12, -38)
        d.line(x * s, y * s, (x + rng.uniform(5, 11)) * s, (y + rng.uniform(-0.8, 0.8)) * s, w=0.7 * s, a=0.2, passes=1, wobble=0.15 * s)
    d.hatch(S([(262, -36), (292, -41), (303, -34), (266, -32)]), angle=-30, spacing=5 * s, a=0.3)
    return d

def lace_ends(c, s, T, flutter, a=1.0, rgb=CHALK):
    """The two loose ends of the bow; they tremble in the wind."""
    p = paint(rgb, 0.8 * a, 1.3 * s)
    kx, ky = KNOT
    for (dx, tip, ph) in ((-2, (kx - 7, ky + 19), 0.0), (2, (kx + 10, ky + 17), 1.7)):
        wob = flutter * (2.6 * math.sin(T * 9.1 + ph) + 1.4 * math.sin(T * 15.3 + ph * 2))
        path = skia.Path()
        path.moveTo((kx + dx) * s, (ky + 2) * s)
        path.quadTo((kx + dx * 2 + wob * 0.4) * s, (ky + 11) * s, (tip[0] + wob) * s, (tip[1] - abs(wob) * 0.3) * s)
        c.drawPath(path, p)

@functools.lru_cache(maxsize=4)
def _silhouette_path(s):
    """Opaque silhouette of the near shoe (it hides whatever is behind it)."""
    path = skia.Path()
    pts = _S(SILHOUETTE, s)
    path.moveTo(*pts[0])
    for q in pts[1:]:
        path.lineTo(*q)
    path.close()
    return path

# ---------------------------------------------------------------------
# rooftop geometry (world space, side elevation; the camera frames it differently per shot)
# ---------------------------------------------------------------------
SHOE_S = 1.25
SHOE_L = 310 * SHOE_S
FLOOR_Y = 860                          # roof floor
PAR_X0, PAR_X1, PAR_TOP = 1300, 1730, 220   # parapet inner face, outer face, top of the coping
COPING = 26
SLAB = 130
NEAR_FLOOR = (PAR_X0 - 22 - SHOE_L, FLOOR_Y)
NEAR_TOP = (PAR_X0 + 16, PAR_TOP)
FAR_OFF = (-40, -13)

@functools.lru_cache(maxsize=1)
def rooftop():
    d = Drawing(seed=77, rgb=CHALK, width=1.7, alpha=0.7, wobble=1.3)
    d.line(-600, FLOOR_Y, PAR_X0, FLOOR_Y, w=1.6, a=0.55)                                   # the roof floor
    d.rect(PAR_X0 - 16, PAR_TOP, PAR_X1 - PAR_X0 + 32, COPING, w=1.6, a=0.75)               # coping slab
    d.line(PAR_X0, PAR_TOP + COPING, PAR_X0, FLOOR_Y, w=1.6, a=0.6)                         # inner face
    d.line(PAR_X1, PAR_TOP + COPING, PAR_X1, FLOOR_Y + 900, w=1.6, a=0.55)                  # outer face: it keeps going down
    d.hatch([(PAR_X0 + 2, PAR_TOP + COPING + 2), (PAR_X1 - 2, PAR_TOP + COPING + 2), (PAR_X1 - 2, FLOOR_Y),
             (PAR_X0 + 2, FLOOR_Y)], angle=62, spacing=17, a=0.13, w=1.0)
    # the roof slab: parapet and roof are one mass; the outer wall keeps going down, the roof does not
    d.line(-600, FLOOR_Y + SLAB, PAR_X0 - 2, FLOOR_Y + SLAB, w=1.2, a=0.3)
    d.hatch([(-600, FLOOR_Y + 2), (PAR_X1 - 2, FLOOR_Y + 2), (PAR_X1 - 2, FLOOR_Y + SLAB), (-600, FLOOR_Y + SLAB)],
            angle=62, spacing=17, a=0.09, w=0.9)
    # the phone, face-down on the concrete where he left it
    d.rect(420, FLOOR_Y - 13, 230, 13, w=1.3, a=0.45)
    d.line(440, FLOOR_Y - 16, 474, FLOOR_Y - 16, w=1.0, a=0.35, passes=1)
    return d

def cam(c, shot, L):
    """Two fixed camera set-ups. A: floor level, close on the shoes and the wall they face.
    B: wider and lower, the whole parapet in section, the drop on the right."""
    if shot == 'A':
        px, py, k = 1100, 800, 1.3
        c.translate(px, py); c.scale(k, k); c.translate(-px, -py)
    else:
        k = 0.8
        c.translate(720, 440); c.scale(k, k); c.translate(-(PAR_X0 + PAR_X1) / 2, -PAR_TOP)

def night_sky(c, L, horizon=452):
    """The faintest city glow along the horizon: the dark on the right is distance, not a wall."""
    sh = skia.GradientShader.MakeLinear([(0, horizon - 330), (0, horizon + 420)],
                                        [col((16, 20, 30), 0.0), col((16, 20, 30), 1.0), col((16, 20, 30), 0.0)], [0, 0.44, 1])
    c.drawRect(skia.Rect(0, 0, L.w, L.h), skia.Paint(Shader=sh))

def building_mass(c):
    """Parapet and roof are solid: they hide the sky behind them (world coords)."""
    p = paint((3, 3, 4), 1.0)
    c.drawRect(skia.Rect(PAR_X0 - 16, PAR_TOP, PAR_X1 + 16, FLOOR_Y + 2000), p)
    c.drawRect(skia.Rect(-2000, FLOOR_Y, PAR_X1, FLOOR_Y + 2000), p)

# ---------------------------------------------------------------------
# cached plates and sprites (Drawing.draw costs two full-frame layers; do it once, not per frame)
# ---------------------------------------------------------------------
CAM = {'A': (1100, 800, 1.3, 1100, 800), 'B': (720, 440, 0.8, (PAR_X0 + PAR_X1) / 2, PAR_TOP)}
HORIZON = {'A': 700, 'B': 452}

def cam_pt(shot, x, y):
    sx, sy, k, wx, wy = CAM[shot]
    return sx + (x - wx) * k, sy + (y - wy) * k

class _Full:
    w, h = W, H

@functools.lru_cache(maxsize=2)
def bg_plate(shot):
    """Night sky, the building mass and the chalk rooftop for one camera set-up."""
    surf = skia.Surface(W, H)
    c = surf.getCanvas(); c.clear(col((0, 0, 0)))
    night_sky(c, _Full, HORIZON[shot])
    c.save(); cam(c, shot, _Full)
    building_mass(c)
    rooftop().draw(c, 1.0)
    c.restore()
    return surf.makeImageSnapshot()

SPR_PAD = 16

@functools.lru_cache(maxsize=8)
def shoe_sprite(ts, far):
    """One shoe (without its lace ends) rendered at total screen scale ts; heel at (SPR_PAD, py)."""
    wpx = int(318 * ts + 2 * SPR_PAD); hpx = int(142 * ts + 2 * SPR_PAD)
    surf = skia.Surface(wpx, hpx)
    c = surf.getCanvas(); c.clear(skia.ColorTRANSPARENT)
    py = SPR_PAD + 136 * ts
    c.translate(SPR_PAD, py)
    if far:
        sneaker(52, ts, CHALK, True).draw(c, 1.0, 0.34)
    else:
        c.drawPath(_silhouette_path(ts), paint(SHOE_FILL))
        sneaker(51, ts).draw(c, 1.0)
    return surf.makeImageSnapshot(), py

def shoe_at(c, shot, wx, wy, rot, T, flutter, far=False):
    """Place a shoe (heel at world wx, wy) in screen space for the given camera set-up."""
    sx, sy = cam_pt(shot, wx, wy)
    ts = round(SHOE_S * CAM[shot][2], 4)
    img, py = shoe_sprite(ts, far)
    c.save(); c.translate(sx, sy)
    if rot:
        c.rotate(rot, 300 * ts, -8 * ts)
    c.drawImage(img, -SPR_PAD, -py, skia.SamplingOptions(skia.FilterMode.kLinear))
    if not far:
        lace_ends(c, ts, T, flutter)
    c.restore()

# =====================================================================
# build
# =====================================================================
def build():
    sc = Scene('s00_prologue', kind='X', frame='16:9', title='序幕')
    sc.sub_color = WHITE

    # ---------------- content note ----------------
    sc.wait(0.8)
    t_note = sc.t
    NOTE = 9.2
    def note(c, t, L):
        k1 = smooth((t - 0.0) / 1.2)
        k2 = smooth((t - 1.4) / 1.2)
        text(c, '本作涉及校园贷、暴力催收与自杀议题。', L.w / 2, 452, 'serif-light', 40, WHITE, 0.94 * k1, 'center', tracking=0.08)
        text(c, '全片不呈现自杀过程。', L.w / 2, 526, 'serif-light', 40, WHITE, 0.94 * k1, 'center', tracking=0.08)
        line(c, L.w / 2 - 28, 604, L.w / 2 + 28, 604, (120, 120, 118), 0.8 * k2, 1.0)
        text(c, '如果你正在经历困难，请拨打　全国统一心理援助热线　12356', L.w / 2, 676, 'serif-light', 27,
             (184, 184, 180), k2, 'center', tracking=0.08)
    sc.layer(note, t_note, t_note + NOTE, fin=0.9, fout=1.3)
    sc.wait(NOTE)

    # ---------------- black. wind. ----------------
    sc.wait(1.0)
    t_wind = sc.t
    sc.wait(3.4)

    # ---------------- the phone lights up: a call to 爸 ----------------
    t_lit = sc.t
    sc.wait(2.2)
    sc.say('zhang', '爸。', sub_text='爸……', fx='vo', speed=0.75, variant=1, gain=4, note='画外音', post=0.45)
    sc.say('zhang', '对不起。又让你们失望了。', fx='vo', speed=0.85, note='画外音', post=0.75)
    # his father, shouting over a construction site; the hang-up cuts the last 喂 short
    s_, e_ = sc.say('father', '喂？儿子？喂——', tts='喂？儿子？喂，喂——', fx='phone', speed=0.85, gain=3, post=0.0)
    at, y, g, pan, bus, fi, fo = sc.audio[-1]
    n = max(int(0.5 * SR), len(y) - int(0.11 * SR))
    y = np.array(y[:n], np.float32, copy=True)
    k = int(0.008 * SR)
    y[-k:] = (y[-k:].T * np.linspace(1, 0, k)).T
    sc.audio[-1] = (at, y, g, pan, bus, fi, 0.0)
    t_hang = at + n / SR
    sc.subs[-1].end = t_hang
    sc.at(t_hang)
    # the line: a construction site, until he hangs up
    line_len = t_hang - t_lit
    mach = phone_fx(sfx.machinery(line_len + 0.5, 305))[:int(line_len * SR)]
    sc.sfx(mach, at=t_lit, gain=15, pan=0.05, fin=0.35, fout=0.01)
    sc.sfx(sfx.click(302, 2600, 0.03, 0.6), at=t_hang, gain=-4)
    sc.sfx(sfx.click(303, 1400, 0.02, 0.4), at=t_hang + 0.035, gain=-8)
    T_END_SCREEN = t_hang + 2.4

    def screen(c, t, L):
        T = L.T
        lit = smooth(t / 0.45)
        timer = 41 - (t_hang - T) if T < t_hang else 41
        ended = smooth((T - t_hang - 0.12) / 0.35)
        press = max(0.0, 1 - abs(T - t_hang) / 0.2) if T > t_hang - 0.2 else 0.0
        k = 1 + 0.03 * ease_in_out(t / (T_END_SCREEN - t_lit))
        c.save(); c.translate(SCX, 480); c.scale(k, k); c.translate(-SCX, -480)
        if lit >= 1 and press <= 0 and ended in (0.0, 1.0):
            c.drawImage(call_plate(int(ended)), 0, 0, skia.SamplingOptions(skia.FilterMode.kLinear))
            if not ended:
                draw_timer_text(c, max(0, timer), 1.0)
        else:
            call_screen(c, lit, max(0, timer), ended, press, T)
        c.restore()
    sc.layer(screen, t_lit, T_END_SCREEN)
    sc.at(T_END_SCREEN)

    # ---------------- face-down on the concrete; the light goes out ----------------
    t_down = sc.t
    LAND, OFF = 2.3, 3.9
    PX, PFY, PLEN, PTH = 960, 640, 440, 22
    sc.sfx(phone_down(), at=t_down + LAND, gain=-7)
    def facedown(c, t, L):
        c.drawRect(skia.Rect(0, 0, L.w, L.h), paint((0, 0, 0)))    # the multiply below needs a black ground
        k = ease_out(clamp(t / LAND))
        hgt = 230 * (1 - k)
        ang = -6.5 * (1 - k) ** 1.5
        lit = 1.0 if t < OFF else max(0.0, 1 - (t - OFF) / 0.9) ** 1.5
        # the screen's light on the concrete: a pool that shrinks and brightens as it comes down
        if hgt > 0.5:
            rx = PLEN * 0.62 + hgt * 1.5
            inten = 0.52 * (0.35 + 0.65 * (1 - hgt / 230))
            c.save(); c.translate(PX, PFY + 3); c.scale(1, 0.13)
            glow(c, 0, 0, rx, (190, 202, 222), inten * lit)
            c.restore()
        else:
            for ex in (-1, 1):                     # light escaping at the two ends
                c.save(); c.translate(PX + ex * (PLEN / 2 + 4), PFY + 2); c.scale(1, 0.18)
                glow(c, 0, 0, 90, (190, 202, 222), 0.45 * lit)
                c.restore()
            c.save(); c.translate(PX, PFY + 1); c.scale(1, 0.03)
            glow(c, 0, 0, PLEN * 0.62, (200, 210, 228), 0.5 * lit)
            c.restore()
        # concrete grain where the light falls (multiply: invisible in the dark)
        mp = skia.Paint(BlendMode=skia.BlendMode.kMultiply)
        c.drawImage(concrete(1920, 260, 7), 0, PFY - 40, skia.SamplingOptions(), mp)
        # the phone, in profile
        c.save()
        c.translate(PX, PFY - PTH / 2 - hgt); c.rotate(ang)
        r = skia.RRect.MakeRectXY(skia.Rect.MakeXYWH(-PLEN / 2, -PTH / 2, PLEN, PTH), 9, 9)
        c.drawRRect(r, paint((6, 6, 8), 1.0))
        edge = 0.55 + 0.35 * lit
        c.drawRRect(r, paint((120, 124, 132), edge, 1.4))
        c.drawRoundRect(skia.Rect.MakeXYWH(-PLEN / 2 + 26, -PTH / 2 - 5, 70, 6), 3, 3, paint((110, 114, 120), 0.8 * edge, 1.1))
        line(c, -PLEN / 2 + 10, PTH / 2 - 1.5, PLEN / 2 - 10, PTH / 2 - 1.5, (200, 210, 228), 0.55 * lit, 1.4)
        c.restore()
    sc.layer(facedown, t_down, t_down + 6.4, fout=1.2)
    sc.at(t_down + 6.4)
    sc.wait(0.7)

    # ---------------- A: floor level. The shoes, laces tied tight, facing the wall. ----------------
    t_a = sc.t
    A_LEN, LIFT0 = 6.4, 5.7
    def shot_a(c, t, L):
        T = L.T
        c.drawImage(bg_plate('A'), 0, 0)
        rot = 7 * ease_in_out((t - LIFT0) / 0.6)
        shoe_at(c, 'A', NEAR_FLOOR[0] + FAR_OFF[0], FLOOR_Y + FAR_OFF[1], 0.0, T, 0.3, far=True)
        shoe_at(c, 'A', NEAR_FLOOR[0], FLOOR_Y, rot, T, 0.3)
    sc.layer(shot_a, t_a, t_a + A_LEN, fin=1.5)
    sc.sfx(sole_step(313, 0.4), at=t_a + LIFT0 + 0.1, gain=-18, pan=0.1)      # the heel peels off the concrete

    # ---------------- B: the parapet in section. He is already up; the other foot follows. ----------------
    t_b = t_a + A_LEN
    LAND2, SWELL, CUT = 0.8, 4.6, 8.8
    def shot_b(c, t, L):
        T = L.T
        c.drawImage(bg_plate('B'), 0, 0)
        flutter = 0.3 + 0.7 * smooth((t - SWELL) / 2.6)
        k = ease_out(clamp((t - 0.1) / (LAND2 - 0.1)))
        shoe_at(c, 'B', NEAR_TOP[0] + FAR_OFF[0], PAR_TOP + FAR_OFF[1] - 70 * (1 - k), 5 * (1 - k), T, flutter, far=True)
        shoe_at(c, 'B', NEAR_TOP[0], PAR_TOP, 0.0, T, flutter)
    sc.layer(shot_b, t_b, t_b + CUT)
    sc.sfx(sole_step(311, 1.0), at=t_b - 0.02, gain=-11, pan=0.15)
    sc.sfx(sole_step(312, 0.85), at=t_b + LAND2, gain=-12, pan=0.1)
    t_cut = t_b + CUT

    # wind: from the black after the note, through everything, to the cut. Then nothing.
    sc.amb(sfx.wind(40, 3, 1.0), t_wind, t_cut, gain=10, fin=3.0, fout=0.01)
    gust = gust_roar(CUT - SWELL, 8)
    n = len(gust)
    env = (np.clip(np.arange(n) / (n * 0.62), 0, 1) ** 1.8)[:, None].astype(np.float32)
    sc.sfx(gust * env, at=t_b + SWELL, gain=5, fout=0.01)
    sc.sfx(sfx.swell(2.6, 24), at=t_cut - 2.6, gain=-12, fout=0.01)

    # ---------------- black. silence. far away, a scream. ----------------
    sc.at(t_cut)
    sc.wait(2.8)
    sc.sfx(sfx.scream_far(22), gain=-16, pan=-0.2)
    # the night goes on, barely: far air under the title so the silence is a room, not a dropout
    t_air = sc.t + 2.0
    sc.wait(6.4)

    # ---------------- title ----------------
    t_title = sc.t
    TITLE = 11.5
    def title(c, t, L):
        a = smooth(t / 3.2)
        kr = smooth((t - 2.6) / 2.8)
        size = 128
        parts = [('「', WHITE), ('贷', mix(WHITE, RED, kr)), ('」走的青春', WHITE)]
        tr = 0.06
        ws = [text_width(s, 'serif-heavy', size, tr) for s, _ in parts]
        total = sum(ws) + tr * size * (len(parts) - 1)
        x = L.w / 2 - total / 2
        for (s, rgb), w_ in zip(parts, ws):
            text(c, s, x, 584, 'serif-heavy', size, rgb, a, tracking=tr)
            x += w_ + tr * size
    sc.layer(title, t_title, t_title + TITLE, fout=2.4)
    sc.at(t_title + TITLE)
    sc.sfx(sfx.wind(sc.t - t_air, 11, 0.35), at=t_air, gain=-4, fin=5.0, fout=3.0, bus='amb')
    sc.finish(tail=1.2)
    return sc

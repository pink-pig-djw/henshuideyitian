"""第十一场【倒计时】 内景 宿舍 日 — 距自杀还有 1 天.

Afternoon. Curtains drawn; only Li in the room, headset on, the game loud, in high spirits. The
camera sits behind Li (the backlit silhouette of s02) and looks past him at the door. The door
opens on a rectangle of corridor light: Zhang, thin, one hand on the frame. 「哥……」 Li does not
turn. 「我……」 and his own voice stops; another voice, in his head. Five seconds. Half a step.
Five seconds. The door closes softly. 「帮我带份饭。」 Outside, the sun lies along the corridor
floor and his shadow runs a long way ahead of him; he walks into it and does not look back.
Inside, the game says Victory."""
import math, functools
import numpy as np
import skia
from film.config import *
from film.gfx import *
from film.timeline import Scene, FX
from film.sketch import Drawing, smudge, _tooth, _tooth_soft, _catmull
from film.audio import reverb, lowpass, highpass, bandpass, env_fade, to_stereo, normalize
from film import objects as O, sfx
from scenes.s10_d03 import outline, _walk_legs, path_of, blurred

DAY = 1
PAPER = tuple(int(v) for v in O.b_paper(DAY))
DOORLIGHT = (252, 246, 232)          # the corridor, seen from the dim room
SUN = (250, 234, 200)                # afternoon sun on the corridor floor
SIL = (34, 32, 31)                   # backlit silhouettes
SCREEN = (196, 214, 238)


def _t(d):
    return np.arange(int(d * SR)) / SR


# =====================================================================
# baking
# =====================================================================
_BAKED = {}


def baked(key, fn, transparent=False):
    img = _BAKED.get(key)
    if img is None:
        surf = skia.Surface(BW, H)
        cc = surf.getCanvas()
        cc.clear(skia.ColorTRANSPARENT if transparent else col((0, 0, 0)))
        fn(cc)
        img = _BAKED[key] = surf.makeImageSnapshot()
    return img


def blit(c, img, a=1.0):
    if a >= 0.999:
        c.drawImage(img, 0, 0)
    elif a > 0:
        p = skia.Paint()
        p.setAlphaf(a)
        c.drawImage(img, 0, 0, skia.SamplingOptions(), p)


# =====================================================================
# the dorm, afternoon, curtains drawn: seen from behind Li toward the door
# =====================================================================
VP = (780.0, 480.0)
DOOR = (930.0, 330.0, 1120.0, 770.0)       # x0, y0, x1, y1 of the doorway in the far wall
FLOOR_Y = 770.0


def away(p, t):
    """Move point p away from the vanishing point by factor t (t>1: toward the camera)."""
    return (VP[0] + (p[0] - VP[0]) * t, VP[1] + (p[1] - VP[1]) * t)


@functools.lru_cache(maxsize=1)
def room():
    d = Drawing(seed=1101, width=1.7, alpha=0.8)
    # far wall, floor and ceiling lines
    d.line(300, 170, 1260, 170, w=1.2, a=0.5)
    d.line(300, FLOOR_Y, 1260, FLOOR_Y, w=1.4)
    d.line(300, 170, 300, FLOOR_Y, w=1.1, a=0.6)
    d.line(1260, 170, 1260, FLOOR_Y, w=1.1, a=0.6)
    for (p, t) in (((300, FLOOR_Y), 2.2), ((1260, FLOOR_Y), 1.6), ((300, 170), 2.2), ((1260, 170), 1.6)):
        d.line(p[0], p[1], *away(p, t), w=1.3, a=0.6)
    # floor tiles
    for k in range(1, 7):
        t = 1 + k * 0.11
        a_, b_ = away((300, FLOOR_Y), t), away((1260, FLOOR_Y), t)
        d.line(a_[0], a_[1], b_[0], b_[1], w=0.7, a=0.22, passes=1)
    for k in range(1, 8):
        x = 300 + k * 120
        d.line(x, FLOOR_Y, *away((x, FLOOR_Y), 1.9), w=0.6, a=0.18, passes=1)
    # the doorway: frame (architrave) and the threshold
    x0, y0, x1, y1 = DOOR
    d.rect(x0 - 16, y0 - 16, (x1 - x0) + 32, (y1 - y0) + 16, w=1.5)
    d.line(x0, y0, x0, y1, w=1.2, a=0.7)
    d.line(x1, y0, x1, y1, w=1.2, a=0.7)
    d.line(x0, y0, x1, y0, w=1.2, a=0.7)
    # a wardrobe against the far wall (left of the door) and a poster
    d.rect(560, 240, 250, 530, w=1.3, a=0.7)
    d.line(685, 250, 685, 760, w=0.9, a=0.5)
    d.ellipse(672, 500, 3, 8, w=1, a=0.6, passes=1)
    d.ellipse(698, 500, 3, 8, w=1, a=0.6, passes=1)
    # the right wall: Zhang's desk, his lamp (off), his chair pushed in
    d.poly([(1260, 580), (1440, 610)], w=1.4)
    d.poly([(1262, 600), (1440, 640)], w=1.0, a=0.6)
    d.line(1270, 600, 1272, 770, w=1.1, a=0.6)
    d.curve([(1330, 585), (1322, 520), (1350, 470), (1390, 452)], w=1.3)
    d.poly([(1376, 432), (1428, 442), (1418, 478), (1370, 468)], closed=True, w=1.2)
    d.ellipse(1330, 590, 22, 5, w=1.0, a=0.7)
    d.rect(1300, 548, 70, 34, w=1.0, a=0.6)                  # the sketchbook, shut
    d.curve([(1290, 900), (1300, 700), (1352, 666), (1410, 690), (1420, 900)], w=1.2, a=0.55)
    # the bunk post in the right foreground
    d.line(1352, -20, 1356, 1100, w=2.0)
    d.line(1374, -20, 1378, 1100, w=1.2, a=0.6)
    d.line(1352, 300, 1440, 300, w=1.6)
    d.line(1352, 330, 1440, 330, w=1.0, a=0.6)
    # Li's desk along the left wall, the keyboard, the monitor's back edge and stand
    d.poly([(0, 760), (250, 700), (430, 690)], w=1.6)
    d.poly([(0, 800), (250, 738), (430, 726)], w=1.1, a=0.6)
    d.poly([(40, 280), (330, 370), (330, 585), (40, 660)], closed=True, w=1.8)
    d.poly([(52, 296), (318, 378), (318, 576), (52, 646)], closed=True, w=0.9, a=0.5)
    d.line(190, 620, 196, 700, w=1.4)
    d.poly([(150, 712), (190, 690), (250, 690), (230, 712)], w=1.2)
    return d


def screen_quad():
    return [(52, 296), (318, 378), (318, 576), (52, 646)]


def screen_matrix(W_=400.0, H_=240.0):
    m = skia.Matrix()
    q = screen_quad()
    m.setPolyToPoly([skia.Point(0, 0), skia.Point(W_, 0), skia.Point(W_, H_), skia.Point(0, H_)],
                    [skia.Point(*q[0]), skia.Point(*q[1]), skia.Point(*q[2]), skia.Point(*q[3])])
    return m


def draw_screen(c, T, victory=0.0):
    """The game on Li's monitor, seen at a slant: moving colour, flashes; then VICTORY."""
    c.save()
    c.concat(screen_matrix())
    c.clipRect(skia.Rect(0, 0, 400, 240))
    fl = 0.5 + 0.5 * math.sin(T * 9.1) * math.sin(T * 3.3)
    c.drawRect(skia.Rect(0, 0, 400, 240), paint(mix((40, 52, 74), (70, 60, 96), fl), 1.0))
    # terrain and muzzle flashes, all abstract
    c.drawRect(skia.Rect(0, 150, 400, 240), paint((58, 66, 60), 0.9))
    for k in range(5):
        x = (k * 97 + T * 70) % 440 - 20
        c.drawCircle(x, 150 + 18 * math.sin(k + T), 4, paint((255, 255, 255), 0.5))
    if int(T * 7) % 5 == 0:
        c.drawCircle(200 + 60 * math.sin(T), 120, 26, paint((255, 236, 180), 0.55))
    c.drawCircle(200, 120, 6, paint((255, 255, 255), 0.7, 1.4))               # crosshair
    if victory > 0:
        c.drawRect(skia.Rect(0, 0, 400, 240), paint((255, 244, 214), victory))
        text(c, 'VICTORY', 168, 138, 'sans-heavy', 50, (196, 146, 40), victory, 'center', tracking=0.1)
    c.restore()


# ---------------- Li from behind, backlit by the screen ----------------
LI_HEAD = (392.0, 486.0, 62.0, 72.0)


@functools.lru_cache(maxsize=1)
def li_drawing():
    """Li from behind, leaning in to the screen: head, headset, shoulders (like s02), a plain chair."""
    hx, hy, rx, ry = LI_HEAD
    d = Drawing(seed=1130, width=2.0)
    body = [(204, 1100), (214, 900), (232, 760), (262, 660), (306, 604), (360, 568), (412, 566), (458, 590),
            (500, 646), (526, 760), (538, 900), (544, 1100)]
    d.fill(body, GRAPHITE, 0.9, smooth=True)
    d.fill([(hx + rx * math.cos(a), hy + ry * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 48)], GRAPHITE, 0.9)
    d.ellipse(hx, hy, rx, ry, w=2.0)
    d.curve(body[1:-1], w=2.0)
    # headset: band, the near ear cup, the mic boom
    d.curve([(hx - rx + 4, hy + 10), (hx - rx + 10, hy - ry + 6), (hx, hy - ry - 12), (hx + rx - 6, hy - ry + 10), (hx + rx + 2, hy - 4)], w=3.0)
    d.fill([(hx + rx - 20 + 18 * math.cos(a), hy + 14 + 30 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 30)], GRAPHITE, 0.95)
    d.ellipse(hx + rx - 20, hy + 14, 18, 30, w=2.0)
    d.curve([(hx - rx + 12, hy + 34), (hx - rx - 8, hy + 60), (hx - rx - 34, hy + 66)], w=3.0)
    # the chair: just its back, in front of his lower back (as in s02)
    d.rect(250, 830, 330, 280, w=1.8, a=0.75)
    d.line(250, 862, 580, 862, w=1.0, a=0.5)
    return d


def draw_li(c, T, lean=0.0, bob=0.0, rim=1.0, jolt=0.0):
    """Li, backlit by the screen; he rocks with the game."""
    hx, hy, rx, ry = LI_HEAD
    c.save()
    c.translate(0, bob)
    c.rotate(-lean - jolt * 4, 400, 1000)
    c.save()
    c.clipRect(skia.Rect(140, 380, 640, 1110))       # keeps the drawing's layer small
    li_drawing().draw(c, 1.0)
    c.restore()
    # rim light from the screen along the edge of his head and shoulder
    fl = 0.75 + 0.25 * math.sin(T * 17) * math.sin(T * 5.3)
    rimc = mix(RGB_C, RGB_M, 0.5 + 0.5 * math.sin(T * 1.7))
    arc = skia.Path()
    arc.addArc(skia.Rect.MakeXYWH(hx - rx, hy - ry, 2 * rx, 2 * ry), 150, 100)
    p = paint(rimc, 0.5 * min(1.0, rim) * fl, 3.0)
    p.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 2.5))
    c.drawPath(arc, p)
    sh = skia.Path()
    sh.moveTo(232, 740); sh.cubicTo(246, 670, 290, 604, 350, 572)
    c.drawPath(sh, p)
    c.restore()


# ---------------- Zhang in the doorway (backlit, facing in) ----------------
ZD = [(-9, -238), (-22, -232), (-38, -226), (-50, -232), (-62, -242), (-70, -240), (-72, -230), (-64, -224),
      (-50, -214), (-44, -204), (-44, -180), (-43, -150), (-42, -120), (-40, -108), (-27, -104), (-26, -70),
      (-25, -30), (-24, -6), (-30, 0), (-8, 2), (-8, -40), (-5, -96), (0, -100), (5, -96), (8, -40), (8, 2),
      (30, 0), (24, -6), (25, -30), (26, -70), (27, -104), (40, -108), (44, -114), (48, -118), (50, -140),
      (51, -170), (50, -200), (46, -218), (38, -226), (22, -232), (9, -238)]
ZD_DOWN = [(-9, -238), (-22, -232), (-30, -229), (-38, -226), (-46, -218), (-50, -200), (-51, -185), (-51, -165),
           (-50, -140), (-48, -120), (-45, -110), (-41, -112), (-41, -118), (-40, -108), (-27, -104), (-26, -70), (-25, -30), (-24, -6),
           (-30, 0), (-8, 2), (-8, -40), (-5, -96), (0, -100), (5, -96), (8, -40), (8, 2), (30, 0), (24, -6),
           (25, -30), (26, -70), (27, -104), (40, -108), (44, -114), (48, -118), (50, -140), (51, -170), (50, -200),
           (46, -218), (38, -226), (22, -232), (9, -238)]
ZD_FEET = (1016.0, 772.0)
ZD_SCALE = 390.0 / 300.0


def _zd_pts(arm_down):
    A = np.asarray(ZD, float)
    B = np.asarray(ZD_DOWN, float)
    # resample to match by index (same count by construction)
    return A * (1 - arm_down) + B * arm_down


def draw_zhang_door(c, step=0.0, arm_down=0.0, a=1.0, lean=-3.0):
    """His thin silhouette in the bright doorway; step 0..1 = half a step toward the room."""
    k = 1.0 + 0.09 * step
    fx, fy = away(ZD_FEET, k)
    s = ZD_SCALE * k
    c.saveLayer(skia.Rect(fx - 160, fy - 470, fx + 160, fy + 20), None)
    c.translate(fx, fy)
    c.rotate(lean * (1 - 0.6 * step))
    c.scale(s * 0.92, s)
    pts = _zd_pts(arm_down)
    c.drawPath(path_of(_catmull(list(map(tuple, pts)) + [tuple(pts[0])], per=3)), paint(GRAPHITE, 0.95 * a))
    c.drawOval(skia.Rect.MakeXYWH(-19, -281, 38, 46), paint(GRAPHITE, 0.95 * a))
    c.drawPaint(skia.Paint(Shader=_tooth_soft(), BlendMode=skia.BlendMode.kDstIn))
    c.restore()


def _door_panel(theta):
    """The door, hinged on the right jamb, swung into the room by theta (radians)."""
    x0, y0, x1, y1 = DOOR
    W_ = x1 - x0
    # free edge: moves left along the wall and toward the camera
    lat = x1 - W_ * math.cos(theta)
    t = 1.0 + 0.62 * math.sin(theta)            # toward the camera (away from VP)
    top = away((lat, y0), t)
    bot = away((lat, y1), t)
    return [(x1, y0), top, bot, (x1, y1)]


def _spill(cc):
    x0, y0, x1, y1 = DOOR
    spill = [(x0, y1), (x1, y1), away((x1, y1), 1.9), away((x0, y1), 1.9)]
    cc.drawPath(path_of(spill), blurred(DOORLIGHT, 0.20, 18))
    glow(cc, (x0 + x1) / 2, (y0 + y1) / 2, 420, DOORLIGHT, 0.30)


def draw_doorway(c, T, theta, zh=None, glow_k=1.0):
    """The corridor light in the doorway, its spill on the floor, the door panel, Zhang and his shadow."""
    x0, y0, x1, y1 = DOOR
    if theta > 0.01:
        panel = _door_panel(theta)
        # the bright opening: between the left jamb and the panel's free edge
        free_x = min(panel[1][0], panel[2][0])
        open_poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        c.save()
        c.clipPath(path_of(open_poly))
        c.drawRect(skia.Rect(x0, y0, x1, y1), paint(DOORLIGHT, 1.0))
        # the corridor beyond: the opposite wall, faint
        c.drawLine(x0, y1 - 40, x1, y1 - 40, paint((200, 196, 186), 0.6, 1.2))
        c.drawRect(skia.Rect.MakeXYWH(x0 + 40, y0 + 60, 70, 300), paint((226, 222, 212), 0.8, 1.2))
        c.restore()
        opening = clamp(math.sin(theta) * 1.4)
        # light spilling into the room across the floor (baked once)
        blit(c, baked(('spill',), _spill, transparent=True), opening * glow_k)
        if zh is not None:
            step, arm_down, za = zh
            k = 1.0 + 0.09 * step
            fx, fy = away(ZD_FEET, k)
            # his shadow thrown into the room along the spill
            tip = away((fx, fy), 1.75)
            sh = [(fx - 22 * k, fy), (fx + 22 * k, fy), (tip[0] + 40, tip[1] + 30), (tip[0] - 26, tip[1] + 34)]
            c.drawPath(path_of(sh), blurred(SIL, 0.55 * za * opening, 10))
            c.drawOval(skia.Rect.MakeXYWH(tip[0] - 40, tip[1] + 8, 80, 50), blurred(SIL, 0.45 * za * opening, 12))
            draw_zhang_door(c, step, arm_down, za)
            # the light eats into the edges of the silhouette
            glow(c, (x0 + x1) / 2, y0 + 180, 150, DOORLIGHT, 0.22 * opening)
        # the door panel, dark: its inside faces us
        c.drawPath(path_of(panel), paint(mix(PAPER, NIGHT, 0.55), 1.0))
        c.drawPath(path_of(panel + [panel[0]], False), paint(GRAPHITE, 0.8, 1.6))
        hx_, hy_ = (panel[1][0] + panel[2][0]) / 2 - 10, (panel[1][1] + panel[2][1]) / 2 + 6
        c.drawRoundRect(skia.Rect.MakeXYWH(hx_ - 4, hy_, 18, 6), 3, 3, paint(GRAPHITE, 0.8))
    else:
        c.drawRect(skia.Rect(x0, y0, x1, y1), paint(mix(PAPER, NIGHT, 0.5), 1.0))
        c.drawRoundRect(skia.Rect.MakeXYWH(x0 + 22, (y0 + y1) / 2 + 6, 26, 7), 3, 3, paint(GRAPHITE, 0.8))
        # the line of corridor light under the door
        c.drawRect(skia.Rect(x0 + 4, y1 - 4, x1 - 4, y1), paint(DOORLIGHT, 0.85))
        c.drawRect(skia.Rect(x0 - 10, y1 - 2, x1 + 10, y1 + 18), blurred(DOORLIGHT, 0.25, 8))


def _room_bg(cc, dim=0.56):
    O.b_background(cc, DAY)
    cc.drawRect(skia.Rect(0, 0, BW, H), paint(NIGHT, dim))
    # the afternoon outside the drawn curtains: only a faint warmth on the ceiling
    glow(cc, 900, 60, 700, SUN, 0.06)
    room().draw(cc, 1.0, 0.95)


def room_bg(c):
    blit(c, baked(('room',), _room_bg))


def _vbloom(cc):
    glow(cc, 200, 470, 900, (255, 240, 205), 0.75)
    glow(cc, 200, 470, 1500, (255, 236, 196), 0.45)
    cc.drawRect(skia.Rect(0, 0, BW, H), paint((255, 246, 222), 0.34))


def screen_glow(c, T, k=1.0, victory=0.0):
    fl = 0.75 + 0.25 * math.sin(T * 17) * math.sin(T * 5.3)
    glow(c, 190, 470, 460, RGB_M, 0.26 * fl * k)
    glow(c, 230, 460, 360, RGB_C, 0.22 * (1.6 - fl) * k)
    glow(c, 180, 470, 300, SCREEN, 0.25 * k)
    # RGB strip under the desk edge
    for i in range(7):
        hue = (i / 7 + T * 0.25) % 1.0
        rgbv = RGB_M if hue < 0.5 else RGB_C
        x = 20 + i * 24
        y = 800 - i * 3.9
        c.drawCircle(x, y, 3.0, paint(rgbv, 0.7 * fl * k))
    if victory > 0:
        blit(c, baked(('vbloom',), _vbloom, transparent=True), victory)


# =====================================================================
# the corridor: sun from the window behind us, laid along the floor
# =====================================================================
CVP = (720.0, 430.0)
CF = 900.0
CEYE = 1.5
CW = 1.2             # half width (m)
CEND = 13.0          # the end wall with the window


def cproj(X, Y, z):
    s = CF / z
    return CVP[0] + X * s, CVP[1] + (CEYE - Y) * s, s


@functools.lru_cache(maxsize=1)
def corridor():
    d = Drawing(seed=1150, width=1.6, alpha=0.8)
    for X in (-CW, CW):
        for Y in (0.0, 3.0):
            d.poly([cproj(X, Y, z)[:2] for z in (1.4, 2.5, 5, 9, CEND)], w=1.3 if Y == 0 else 1.0, a=0.7)
    x0, y0, _ = cproj(-CW, 3.0, CEND)
    x1, y1, _ = cproj(CW, 0.0, CEND)
    d.rect(x0, y0, x1 - x0, y1 - y0, w=1.1, a=0.7)
    # the window at the end: frame and cross-bars
    wx0, wy0, _ = cproj(-0.95, 2.7, CEND)
    wx1, wy1, _ = cproj(0.95, 0.8, CEND)
    d.rect(wx0, wy0, wx1 - wx0, wy1 - wy0, w=1.5)
    d.line((wx0 + wx1) / 2, wy0, (wx0 + wx1) / 2, wy1, w=1.3)
    d.line(wx0, wy0 + (wy1 - wy0) * 0.38, wx1, wy0 + (wy1 - wy0) * 0.38, w=1.2)
    # doors down both walls (his dorm is the second on the left), the ceiling lamps (off)
    for side in (-1, 1):
        for zd in (2.6, 5.9, 9.2):
            pts = [cproj(side * CW, 0.0, zd), cproj(side * CW, 2.1, zd), cproj(side * CW, 2.1, zd + 0.95), cproj(side * CW, 0.0, zd + 0.95)]
            d.poly([p[:2] for p in pts], w=1.1, a=0.6)
            hx, hy, _ = cproj(side * CW, 1.0, zd + 0.83)
            d.line(hx, hy, hx + 5, hy, w=1.6, a=0.7)
    for zl in (3.0, 6.0, 9.0, 12.0):
        a_, b_ = cproj(-0.3, 3.0, zl)[:2], cproj(0.3, 3.0, zl + 0.3)[:2]
        d.rect(a_[0], a_[1], b_[0] - a_[0], max(2, b_[1] - a_[1]), w=0.9, a=0.45)
    z = 1.6
    while z < CEND:
        a_, b_ = cproj(-CW, 0, z)[:2], cproj(CW, 0, z)[:2]
        d.line(a_[0], a_[1], b_[0], b_[1], w=0.6, a=0.18, passes=1)
        z *= 1.1
    return d


SUN_PATCH = [(-0.95, CEND - 0.2), (0.95, CEND - 0.2), (1.05, 3.2), (-1.05, 3.2)]


def _floor_pts(pts):
    return [cproj(X, 0.0, z)[:2] for (X, z) in pts]


def _corridor_bg(cc):
    O.b_background(cc, DAY)
    cc.drawRect(skia.Rect(0, 0, BW, H), paint(NIGHT, 0.46))
    # the window at the end, full of afternoon
    wx0, wy0, _ = cproj(-0.95, 2.7, CEND)
    wx1, wy1, _ = cproj(0.95, 0.8, CEND)
    cc.drawRect(skia.Rect(wx0, wy0, wx1, wy1), paint(SUN, 1.0))
    cc.drawRect(skia.Rect(wx0, wy0, wx1, wy1), paint((255, 252, 240), 0.7))
    # the sun lying down the floor toward us, fading as it comes
    fl = _floor_pts(SUN_PATCH)
    grad = skia.GradientShader.MakeLinear([skia.Point(720, fl[0][1]), skia.Point(720, fl[2][1])],
                                          [col(SUN, 0.85), col(SUN, 0.45), col(SUN, 0.0)], [0.0, 0.45, 1.0])
    p = skia.Paint(Shader=grad, AntiAlias=True)
    p.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 4))
    cc.drawPath(path_of(fl), p)
    # the window's cross lying in it
    for (X, z0, z1) in ((0.0, 3.4, CEND - 0.3),):
        bar = _floor_pts([(X - 0.03, z1), (X + 0.03, z1), (X + 0.04, z0), (X - 0.04, z0)])
        cc.drawPath(path_of(bar), blurred(GRAPHITE, 0.14, 2))
    bz = 8.2
    bar = _floor_pts([(-0.97, bz), (0.97, bz), (1.0, bz - 0.5), (-1.0, bz - 0.5)])
    cc.drawPath(path_of(bar), blurred(GRAPHITE, 0.12, 3))
    # light on the side walls near the window
    for side in (-1, 1):
        wp = [cproj(side * CW, 0.0, CEND)[:2], cproj(side * CW, 2.6, CEND)[:2], cproj(side * CW, 2.2, 7.5)[:2], cproj(side * CW, 0.0, 7.5)[:2]]
        cc.drawPath(path_of(wp), blurred(SUN, 0.12, 20))
    corridor().draw(cc, 1.0, 0.8)
    glow(cc, (wx0 + wx1) / 2, (wy0 + wy1) / 2, 520, SUN, 0.55)
    glow(cc, (wx0 + wx1) / 2, (wy0 + wy1) / 2, 180, (255, 252, 240), 0.6)


def corridor_bg(c):
    blit(c, baked(('corr3',), _corridor_bg))


# a standing figure, front or back (the same thin outline); legs split for walking
def draw_corridor_walk(c, T, t_turn, t_walk, t_exit):
    """Against the window: he stands with his back to us, looking at the light; turns his back on it
    and walks toward us, past us. His shadow runs ahead of him down the lit floor."""
    X0, Z0 = 0.25, 8.6
    if T < t_walk:
        X, z, ph, walking = X0, Z0, 0.0, False
    else:
        u = (T - t_walk) / (t_exit - t_walk)
        z = Z0 + (1.2 - Z0) * u
        X = X0 + (-0.55 - X0) * smooth(u)
        ph = (Z0 - z) / 0.6 * math.pi
        walking = True
    if z < 0.9:
        return
    x, y, s = cproj(X, 0, z)
    # his shadow: from his feet toward us, long, widening, fading
    if z > 1.6:
        L = 6.0
        zt = max(1.2, z - L)
        w0, w1 = 0.2, 0.42
        sp = [(X - w0, z), (X + w0, z), (X * 0.6 + w1, zt), (X * 0.6 - w1, zt)]
        pts = _floor_pts(sp)
        grad = skia.GradientShader.MakeLinear([skia.Point(0, pts[0][1]), skia.Point(0, pts[2][1])],
                                              [col(SIL, 0.62), col(SIL, 0.35), col(SIL, 0.0)], [0.0, 0.6, 1.0])
        p = skia.Paint(Shader=grad, AntiAlias=True)
        p.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 3 + 0.015 * s))
        c.drawPath(path_of(pts), p)
    # the figure, backlit: dark, grained like the doorway silhouette
    turn = ramp(T, t_turn, t_turn + 0.9)
    sx = 1.0 - 0.7 * math.sin(math.pi * turn)
    spx = s * 1.7 / 300.0
    pts = outline('stand')
    if walking:
        pts = _walk_legs(pts, ph, 9.0)
    bob = -2.0 * abs(math.sin(ph)) if walking else 0.0
    c.saveLayer(skia.Rect(x - 0.7 * s, y - 2.0 * s, x + 0.7 * s, y + 0.1 * s), None)
    c.translate(x, y)
    c.scale(spx * sx, spx)
    c.translate(0, bob)
    c.drawPath(path_of(pts), paint(GRAPHITE, 0.95))
    c.drawOval(skia.Rect.MakeXYWH(-21, -286, 42, 50), paint(GRAPHITE, 0.95))
    c.drawPaint(skia.Paint(Shader=_tooth_soft(), BlendMode=skia.BlendMode.kDstIn))
    c.restore()
    # the window light wraps round his edges
    glow(c, x, y - 1.0 * s, 0.5 * s, SUN, 0.10)


# =====================================================================
# sounds
# =====================================================================
def whisper(y, seed=7):
    """Turn a voice into a breathy whisper (noise vocoder), keeping a little of the voice."""
    y = np.asarray(y, np.float32)
    n = sfx.noise(len(y) / SR + 0.1, seed)[:len(y)]
    if len(n) < len(y):
        n = np.pad(n, (0, len(y) - len(n)))
    edges = np.geomspace(140, 7200, 19)
    out = np.zeros_like(y)
    for lo, hi in zip(edges[:-1], edges[1:]):
        yb = bandpass(y, lo, hi)
        env = lowpass(np.abs(yb), 50)
        nb = bandpass(n, lo, hi)
        nb = nb / (np.sqrt(np.mean(nb ** 2)) + 1e-9)
        out += nb * env
    out = out / (np.abs(out).max() + 1e-9) * np.abs(y).max()
    return (0.78 * out + 0.32 * y).astype(np.float32)


def inner_whisper(y):
    return FX['inner'](whisper(y))


def mouse_clicks(d, seed=3, rate=5.0):
    rng = np.random.default_rng(seed)
    out = np.zeros(int(d * SR), np.float32)
    tp = 0.1
    while tp < d - 0.1:
        c_ = sfx.click(int(rng.integers(0, 1e6)), rng.uniform(1600, 2400), 0.02, rng.uniform(0.3, 0.5))
        s = int(tp * SR)
        out[s:s + len(c_)] += c_[:len(out) - s]
        tp += rng.exponential(1 / rate) + 0.04
    return out


def latch_soft(seed=1):
    x = sfx.click(seed, 2000, 0.04, 0.35)
    x2 = sfx.click(seed + 1, 1400, 0.03, 0.25)
    out = np.zeros(int(0.3 * SR), np.float32)
    out[:len(x)] += x
    s = int(0.09 * SR)
    out[s:s + len(x2)] += x2
    return out


# =====================================================================
# the scene
# =====================================================================
def build():
    sc = Scene('s11_d01', kind='B', title='第十一场【倒计时】')

    # ---------------- countdown card ----------------
    sc.wait(0.4)
    t0 = sc.t

    def card(c, t, L):
        blit(c, baked(('paper',), lambda cc: O.b_background(cc, DAY)))
        O.countdown_card(c, DAY, t)
    sc.layer(card, t0, t0 + 4.6, fin=0.8, fout=0.25)
    sc.wait(4.6)

    # ---------------- the room: Li alone, the game ----------------
    t_room = sc.t
    t_door = t_room + 6.5              # the door opens
    DOOR_OPEN = 1.4
    events = {}

    def theta_at(T):
        th = 1.25 * ease_out(ramp(T, t_door, t_door + DOOR_OPEN))
        if 'close0' in events:
            th *= 1 - ease_in_out(ramp(T, events['close0'], events['close1']))
        return th

    def zh_state(T):
        if T < t_door + 0.25:
            return None
        step = 0.0
        if 'step0' in events:
            step = ease_in_out(ramp(T, events['step0'], events['step0'] + 1.1))
            step *= 1 - ease_in_out(ramp(T, events['back0'], events['back0'] + 1.3))
        arm = 0.0
        if 'step0' in events:
            arm = smooth(ramp(T, events['step0'] - 0.1, events['step0'] + 0.6))
            arm *= 1 - smooth(ramp(T, events['back0'] + 0.6, events['back0'] + 1.3))
        a = 1.0
        if 'close0' in events:
            a = 1 - smooth(ramp(T, events['close0'] + 0.9, events['close1']))
        return (step, arm, a)

    def li_motion(T):
        bob = 3.0 * math.sin(T * 5.1) * math.sin(T * 1.3)
        lean = 1.2 + 1.0 * math.sin(T * 0.7)
        for (ts, amp) in events.get('shouts', []):
            k = math.exp(-((T - ts) / 0.5) ** 2)
            bob += 8 * k * math.sin(T * 14)
            lean += 2.0 * k
        return lean, bob

    push_ref = {}

    def dorm(c, t, L):
        T = L.T
        c.save()
        pk = 0.0
        if 'push0' in push_ref:
            pk = ease_in_out(ramp(T, push_ref['push0'], push_ref['push1'])) * (1 - ease_in_out(ramp(T, push_ref['push2'], push_ref['push2'] + 2.0)))
        z = 1.0 + 0.12 * pk
        c.translate(1010, 560)
        c.scale(z, z)
        c.translate(-1010, -560)
        room_bg(c)
        th = theta_at(T)
        draw_doorway(c, T, th, zh_state(T))
        vict = 0.0
        if 'victory' in events:
            vict = smooth((T - events['victory'] - 0.35) / 0.25) * (1 - smooth((T - events['victory'] - 2.6) / 0.6))
        draw_screen(c, T, vict)
        screen_glow(c, T, 1.0, vict)
        lean, bob = li_motion(T)
        jolt = 0.0
        if 'victory' in events:
            jolt = smooth((T - events['victory'] - 0.4) / 0.3) * (1 - smooth((T - events['victory'] - 1.6) / 0.8))
        draw_li(c, T, lean, bob, 1.0 + 2.0 * vict, jolt)
        c.restore()
        L.scene.sub_color = WHITE
        # five seconds, twice: the same marks as the fifteen seconds of scene 2
        for i, key in enumerate(('hold1', 'hold2')):
            if key in events and T >= events[key] + 4.95:
                gone = 1 - smooth((T - events.get('close1', 1e9)) / 1.2)
                vtext(c, '五秒', 104, 70 + i * 120, 'serif-light', 30, WHITE, 0.7 * gone * smooth((T - events[key] - 4.95) / 0.5))
    sc.layer(dorm, t_room, None, name='dorm')

    # the game, loud; on the ambience bus so dialogue sits over it
    GAME_LEN = 140
    game = sfx.gunfire(GAME_LEN, 1111, 1.5)
    keys = sfx.keyboard(GAME_LEN, 8.5, 1112)
    clicks = mouse_clicks(GAME_LEN, 1113, 5.5)
    chat = sfx.chatter(GAME_LEN, 1114)
    tt_ = np.arange(int(GAME_LEN * SR)) / SR
    bed = (lowpass(sfx.noise(GAME_LEN, 1125, 'brown'), 260) * 1.6 * (0.7 + 0.3 * np.sin(2 * np.pi * 0.09 * tt_))
           + bandpass(sfx.noise(GAME_LEN, 1126, 'pink'), 300, 1800) * 0.012).astype(np.float32)
    sc.sfx(lowpass(game[: int(1.6 * SR)], 400) * 0.8, at=t_room - 1.6, gain=-12, fin=1.0, bus='amb')
    sc.amb(sfx.room_tone(60, 1115), t_room, None, gain=-6)

    sc.wait(2.2)
    events['shouts'] = []
    sc.wait(t_door - sc.t)
    sc.sfx(sfx.door('open', 1116), at=t_door - 0.15, gain=-9, pan=0.45)
    sc.wait(DOOR_OPEN + 0.5)
    sc.caption('他的嘴唇很干，嘴角有一道裂口。', dur=3.4)
    sc.wait(4.0)
    sc.say('zhang', '哥……我想跟你说个事。', fx='room', speed=0.88, gain=-3, post=0.55)
    s1, e1 = sc.say('li', '你走哪呢！', fx='room', speed=1.0, gain=3, note='冲麦克风喊', post=0.12, variant=2)
    events['shouts'].append((s1 + 0.3, 1))
    sc.say('li', '没看到我正忙着？等会儿说。', sub_text='——没看到我正忙着？等会儿说。', fx='room', speed=1.02, gain=1, note='头也不回', post=1.1)
    sc.say('zhang', '我……', tts='我，', fx='room', speed=0.8, gain=-5, post=1.9)
    t_i0 = sc.t
    push_ref['push0'] = sc.t - 1.5
    sc.narr('他的声音在“我”之后断掉了。不是被打断的，是自己断掉的。', post=0.5)
    sc.narr('他准备了很久的话，到了嘴边，被另一个声音盖住了——', post=0.25)
    sc.narr('不是李浩然的游戏声。是他自己脑子里的声音。', post=0.9)
    t_w0 = sc.t - 0.3
    sc.say('zhang', '他不会在意的。', fx=inner_whisper, speed=0.8, gain=0, note='脑子里的声音', post=-1.5)
    sc.say('zhang', '没有人会在意的。', fx=inner_whisper, speed=0.84, gain=0, note='脑子里的声音', post=-1.2, variant=1)
    sc.say('zhang', '你不值得被在意。', fx=inner_whisper, speed=0.74, gain=1, note='脑子里的声音', post=-0.6, variant=2)
    t_w1 = sc.t + 1.2
    push_ref['push1'] = t_w1
    sc.wait(0.8)

    # ---------------- five seconds; half a step; five seconds ----------------
    events['hold1'] = sc.t
    sc.wait(5.0)
    events['step0'] = sc.t
    sc.sfx(sfx.footstep(1117, 0.5), at=sc.t + 0.5, gain=-16, pan=0.4)
    sc.wait(1.4)
    events['hold2'] = sc.t
    sc.wait(5.0)
    events['back0'] = sc.t
    push_ref['push2'] = sc.t
    sc.sfx(sfx.footstep(1118, 0.45), at=sc.t + 0.4, gain=-18, pan=0.45)
    sc.sfx(sfx.footstep(1119, 0.4), at=sc.t + 1.0, gain=-19, pan=0.45)
    sc.wait(1.5)
    events['close0'] = sc.t
    events['close1'] = sc.t + 2.2
    sc.sfx(sfx.door('open', 1120)[: int(0.9 * SR)] * 0.5, at=sc.t + 0.3, gain=-16, pan=0.45, fout=0.3)
    sc.sfx(latch_soft(1121), at=sc.t + 2.15, gain=-10, pan=0.45)
    sc.wait(3.0)
    sc.say('li', '诶——帮我带份饭。', fx='room', speed=1.0, gain=1, note='对着已经关上的门', post=1.6)
    t_out = sc.t

    # the game bed: normal, then muffled while the voice in his head speaks, then back
    def gseg(a, b, muffle=False, gain=-7):
        n0, n1 = int((a - t_room) * SR), int((b - t_room) * SR)
        mix_ = game[n0:n1] + 0.35 * keys[n0:n1] + 0.45 * clicks[n0:n1] + 0.22 * chat[n0:n1] + bed[n0:n1]
        if muffle:
            mix_ = lowpass(mix_, 380) * 1.3
        sc.sfx(mix_, at=a, gain=gain, fin=0.4, fout=0.5, bus='amb')
    gseg(t_room, t_w0 + 0.2, gain=-6)
    gseg(t_w0 - 0.3, t_w1 + 0.3, muffle=True, gain=-8)
    gseg(t_w1 - 0.2, t_out + 0.4, gain=-6)

    # ---------------- the corridor ----------------
    t_c = t_out
    t_turn = t_c + 5.2
    t_walk = t_turn + 0.7
    t_exit = t_walk + 8.8
    t_cend = t_exit + 5.0

    def corr(c, t, L):
        T = L.T
        corridor_bg(c)
        draw_corridor_walk(c, T, t_turn, t_walk, t_exit)
        L.scene.sub_color = WHITE
    sc.layer(corr, t_c - 0.2, t_cend, z=3, fin=0.2, fout=0.25)
    sc.amb(sfx.hum(40, 50, 1122, 0.006), t_c, t_cend, gain=-4)
    # the game behind the door he just closed
    sc.sfx(lowpass(game[int((t_c - t_room) * SR): int((t_cend - t_room) * SR)], 500) * 1.4, at=t_c, gain=-17, fin=0.3, fout=1.0, bus='amb')
    sc.amb(lowpass(sfx.campus(30, 1123), 2500), t_c, t_cend, gain=2)
    # his steps: coming toward us, passing, going down the stairs behind us
    n_st = 15
    st = sfx.footsteps(n_st, 0.62, 1124, a=0.8)
    st = reverb(st, wet=0.4, decay=1.5, size='hall')
    tt = np.arange(len(st)) / SR
    gain_env = np.clip(0.18 + 0.82 * (tt / (t_exit - t_walk)) ** 1.6, 0, 1)
    gain_env = np.where(tt > (t_exit - t_walk), np.exp(-(tt - (t_exit - t_walk)) * 0.9), gain_env)
    pan_env = np.clip(-0.35 * (tt / (t_exit - t_walk)) ** 2, -1, 1)
    L_ = st[:, 0] * gain_env * np.cos((pan_env + 1) * np.pi / 4) * 1.414
    R_ = st[:, 1] * gain_env * np.sin((pan_env + 1) * np.pi / 4) * 1.414
    sc.sfx(np.stack([L_, R_], 1).astype(np.float32), at=t_walk + 0.15, gain=-9)
    sc.caption('没有回头。', start=t_exit + 0.6, dur=3.8)
    sc.at(t_cend)

    # ---------------- inside: Victory ----------------
    t_v = sc.t
    events['victory'] = t_v
    sc.sfx(game[int((t_v - 1.0 - t_room) * SR): int((t_v + 0.25 - t_room) * SR)], at=t_v - 0.05, gain=-5, fout=0.2, bus='fx')
    sc.sfx(sfx.victory(), at=t_v + 0.3, gain=-1)
    sc.at(t_v + 3.1)
    for ly in sc.layers:
        if ly.name == 'dorm':
            ly.end = sc.t
    sc.sub_color = WHITE
    sc.finish(tail=1.6)
    return sc

"""第四场【倒计时】 内景 奶茶店角落 日 — 距自杀还有 60 天.
A completely normal, pleasant place. The sum he does in his head. The contract he believes he
has read. And, at the very edge of line four, one character a size smaller: 「月」.

Shared with s07_d35 (same booth, same lamp): booth(), hand(), draw_pen(), envelope(),
table_top(), shoes_split(), the little procedural sounds."""
import math, functools
import numpy as np
import skia
from film.config import *
from film.gfx import *
from film.timeline import Scene
from film.sketch import Drawing, smudge, pen_point
from film import objects as O, sfx
from film.audio import lowpass, highpass, bandpass, env_fade, reverb

DAY = 60
POSTER_INK = (196, 116, 58)          # the discount poster's print: warm tea-orange (never red)
KRAFT = (214, 184, 138)

def paper_rgb(day):
    return tuple(int(v) for v in O.b_paper(day))

# ---------------- baking: static pages are rendered once into images ----------------
_BAKED = {}
LINEAR = skia.SamplingOptions(skia.FilterMode.kLinear)

class _Dims:
    w, h = BW, H

def baked(key, fn):
    """Render fn(canvas) once into a 1440x1080 image, cached by key (per process)."""
    img = _BAKED.get(key)
    if img is None:
        surf = skia.Surface(BW, H)
        surf.getCanvas().clear(col((0, 0, 0)))
        fn(surf.getCanvas())
        img = _BAKED[key] = surf.makeImageSnapshot()
    return img

def blit(c, img, linear=False):
    if linear:
        c.drawImage(img, 0, 0, LINEAR)
    else:
        c.drawImage(img, 0, 0)

def paper_bg(c, day):
    """O.b_background, baked (drawing the numpy-backed paper image directly is ~30x slower)."""
    blit(c, baked(('paper', day), lambda cc: O.b_background(cc, day)))

def paper_glow(c, day, glows=()):
    """Paper with fixed glows on top, baked. glows: ((x, y, r, rgb, a), ...)"""
    def fn(cc):
        O.b_background(cc, day)
        for g in glows:
            glow(cc, *g)
    blit(c, baked(('pglow', day, glows), fn))

# =====================================================================
# geometry helpers
# =====================================================================
def _xf(pts, x, y, s=1.0, ang=0.0, flip=False):
    ca, sa = math.cos(ang), math.sin(ang)
    out = []
    for (px, py) in pts:
        px = -px * s if flip else px * s
        py = py * s
        out.append((x + px * ca - py * sa, y + px * sa + py * ca))
    return out

def hand(d, x, y, s=1.0, ang=0.0, flip=False, arm='bare', arm_len=230, w=1.5, a=None, tendons=True):
    """A hand seen from above, palm down, fingers together (pointing 'up' at ang=0; ang in radians,
    +pi/2 points right). Wrist at (x, y). flip mirrors (thumb on the other side).
    arm: 'bare' (forearm), 'cuff' (Zhang's old jacket sleeve), None."""
    T = lambda pts: _xf(pts, x, y, s, ang, flip)
    y0 = -86
    for cx, L in ((-30, 46), (-10, 60), (10, 66), (30, 58)):
        hw = 9.6
        d.curve(T([(cx - hw, y0 + 6), (cx - hw - 0.4, y0 - L * 0.55), (cx - hw + 2.5, y0 - L + 6), (cx, y0 - L),
                   (cx + hw - 2.5, y0 - L + 6), (cx + hw + 0.4, y0 - L * 0.55), (cx + hw, y0 + 6)]), w=w, a=a)
        d.curve(T([(cx - 5, y0 - L * 0.42), (cx, y0 - L * 0.42 - 2), (cx + 5, y0 - L * 0.42)]), w=w * 0.6, a=0.3, passes=1)
        d.curve(T([(cx - 5, y0 - L + 13), (cx, y0 - L + 10), (cx + 5, y0 - L + 13)]), w=w * 0.5, a=0.25, passes=1)
    d.curve(T([(-33, 0), (-38, -38), (-39.6, -80)]), w=w, a=a)                     # little-finger side
    d.curve(T([(33, -2), (45, -22), (60, -46), (70, -70), (68, -86), (61, -88), (54, -76), (44, -56), (40.5, -64), (39.6, -80)]), w=w, a=a)  # thumb
    d.curve(T([(52, -80), (57, -83), (62, -80)]), w=w * 0.5, a=0.25, passes=1)
    if tendons:
        for (p, q) in (((-16, -12), (-20, -72)), ((1, -10), (0, -74)), ((16, -12), (20, -72))):
            d.line(*T([p])[0], *T([q])[0], w=w * 0.55, a=0.18, passes=1)
    if arm == 'bare':
        d.curve(T([(-33, 0), (-37, arm_len * 0.5), (-40, arm_len)]), w=w, a=a)
        d.curve(T([(33, -2), (39, arm_len * 0.5), (43, arm_len)]), w=w, a=a)
    elif arm == 'cuff':
        d.curve(T([(-44, 10), (0, 16), (46, 8)]), w=w, a=a)
        d.curve(T([(-47, 34), (0, 40), (48, 32)]), w=w * 0.8, a=0.5)
        d.curve(T([(-44, 10), (-49, arm_len * 0.5), (-53, arm_len)]), w=w, a=a)
        d.curve(T([(46, 8), (51, arm_len * 0.5), (55, arm_len)]), w=w, a=a)
        d.hatch(T([(-44, 12), (46, 10), (55, arm_len), (-53, arm_len)]), angle=math.degrees(ang) + 70, spacing=8 * s, w=w * 0.6, a=0.28)
        for k in range(5):     # a worn, fraying cuff edge
            u = -40 + k * 20
            d.line(*T([(u, 12)])[0], *T([(u + 4, 20)])[0], w=w * 0.5, a=0.35, passes=1)
    return d

def hand_poly(x, y, s=1.0, ang=0.0, flip=False, arm_len=0):
    """Rough outline polygon of hand() (for occluding fills)."""
    pts = [(-33, 0), (-39, -80), (-40, -118), (-30, -134), (-10, -148), (10, -154), (30, -146), (40, -120),
           (44, -56), (54, -76), (61, -88), (70, -70), (60, -46), (45, -22), (33, -2)]
    if arm_len:
        pts = [(-40, arm_len)] + pts + [(43, arm_len)]
    return _xf(pts, x, y, s, ang, flip)

def hline(d, y0, y1, x0, x1, gaps=(), **kw):
    """A straight line from (x0,y0) to (x1,y1) skipping x-intervals in gaps (occluders)."""
    segs = [(x0, x1)]
    for g0, g1 in gaps:
        out = []
        for a_, b_ in segs:
            if g1 <= a_ or g0 >= b_:
                out.append((a_, b_))
            else:
                if g0 > a_:
                    out.append((a_, g0))
                if g1 < b_:
                    out.append((g1, b_))
        segs = out
    for a_, b_ in segs:
        if b_ - a_ < 6:
            continue
        ya = y0 + (y1 - y0) * (a_ - x0) / (x1 - x0); yb = y0 + (y1 - y0) * (b_ - x0) / (x1 - x0)
        d.line(a_, ya, b_, yb, **kw)

# =====================================================================
# THE BOOTH (wide): camera at the table, across from Xiao; the frame cuts him at the collar.
# =====================================================================
LAMP_X, LAMP_Y = 522, 150            # centre of the shade's bottom opening
TABLE_Y = 612                        # far edge of the table
CUP = (520, 455, 705)                # cup centre x, rim y, base y
XC = 930                             # Xiao's centre line

def _wall(d, clasped=False):
    # backrest of the booth (upholstered, vertical channels) and the wall above it
    hline(d, 332, 327, 0, 1440, gaps=[(668, 1198)], w=1.8)
    hline(d, 346, 342, 0, 1440, gaps=[(668, 1198)], w=1.0, a=0.45)
    for x in (60, 180, 300, 400):
        d.line(x, 350, x + 2, TABLE_Y - 4, w=1.0, a=0.35, passes=1)
    for x in (1300, 1410):
        d.line(x, 348, x + 1, 368 if not clasped else TABLE_Y - 8, w=1.0, a=0.35, passes=1)
    # the table: far edge, left end
    gaps = [(454, 588), (668, 740)] if not clasped else [(454, 588), (668, 740), (1122, 1196), (1214, 1440)]
    hline(d, TABLE_Y, TABLE_Y - 3, 40, 1440, gaps=gaps, w=1.8)
    d.line(40, TABLE_Y, -70, 1080, w=1.6)
    d.line(40, TABLE_Y + 16, -52, 1080, w=0.9, a=0.35, passes=1)
    for x0, x1, a in ((150, -20, 0.22), (300, 190, 0.18), (1250, 1400, 0.2), (1360, 1560, 0.16)):
        d.curve([(x0, TABLE_Y + 40), ((x0 + x1) / 2 + 8, (TABLE_Y + 1080) / 2), (x1, 1080)], w=0.8, a=a, passes=1)

PX0, PY0, PX1, PY1 = 50, 60, 380, 292     # the poster

def _poster(d):
    x0, y0, x1, y1 = PX0, PY0, PX1, PY1
    d.rect(x0, y0, x1 - x0, y1 - y0, w=1.6)
    for (tx, ty, r) in ((x0, y0, -0.6), (x1, y0, 0.6), (x0, y1, 0.6), (x1, y1, -0.6)):
        pts = _xf([(-22, -8), (22, -8), (22, 8), (-22, 8)], tx, ty, 1.0, r)
        d.poly(pts, closed=True, w=0.9, a=0.55, passes=1)
        d.hatch(pts, angle=math.degrees(r) + 90, spacing=4, w=0.6, a=0.3)
    # two little cups on the poster
    for cx in ((x0 + x1) / 2 - 50, (x0 + x1) / 2 + 50):
        d.poly([(cx - 22, 226), (cx - 17, 276), (cx + 17, 276), (cx + 22, 226)], w=1.1, a=0.6, passes=1)
        d.curve([(cx - 24, 226), (cx, 212), (cx + 24, 226)], w=1.0, a=0.6, passes=1)
        d.line(cx + 4, 214, cx + 12, 192, w=1.0, a=0.6, passes=1)
        for k in range(3):
            d.ellipse(cx - 9 + k * 9, 268, 3.2, 3.2, w=0.8, a=0.5, passes=1)

def _lamp(d):
    X, Y = LAMP_X, LAMP_Y
    d.line(X, -10, X, 40, w=1.3)
    d.ellipse(X, 42, 24, 5, w=1.2)
    d.curve([(X - 24, 43), (X - 58, 68), (X - 92, 112), (X - 110, Y)], w=1.7)
    d.curve([(X + 24, 43), (X + 58, 68), (X + 92, 112), (X + 110, Y)], w=1.7)
    d.ellipse(X, Y, 110, 13, 0, math.pi, w=1.5)
    d.ellipse(X, Y, 110, 13, math.pi, 2 * math.pi, w=0.9, a=0.4)
    d.hatch([(X - 24, 46), (X - 58, 70), (X - 92, 114), (X - 104, Y - 4), (X - 36, Y - 6), (X - 10, 48)],
            angle=62, spacing=7, w=0.8, a=0.4)

def _xiao_torso(d, clasped=False, paper=None):
    """Polo shirt, cut by the frame at the collar. Left forearm (our left) resting on the table."""
    cx = XC
    # collar flaps + placket + buttons
    d.poly([(cx - 44, -10), (cx - 104, 12), (cx - 82, 86), (cx - 12, 58)], w=1.5)
    d.poly([(cx + 44, -10), (cx + 104, 12), (cx + 82, 86), (cx + 12, 58)], w=1.5)
    d.curve([(cx - 44, -10), (cx - 26, 30), (cx - 12, 58)], w=1.0, a=0.5)
    d.curve([(cx + 44, -10), (cx + 26, 30), (cx + 12, 58)], w=1.0, a=0.5)
    d.line(cx - 13, 58, cx - 13, 222, w=1.2); d.line(cx + 13, 58, cx + 13, 222, w=1.2)
    d.line(cx - 13, 222, cx + 13, 222, w=1.1)
    for by in (104, 164):
        d.ellipse(cx, by, 5, 5, w=1.0, passes=1)
    for sgn in (-1, 1):
        X = lambda u: cx + sgn * u
        d.curve([(X(104), 12), (X(170), 20), (X(232), 32)], w=1.3)                      # shoulder seam
        d.curve([(X(232), 32), (X(250), 120), (X(262), 222)], w=1.6)                    # sleeve outer
        d.curve([(X(262), 222), (X(230), 234), (X(196), 238)], w=1.4)                   # sleeve hem
        d.curve([(X(196), 238), (X(204), 140), (X(220), 40)], w=1.0, a=0.5)            # armpit seam
        low = TABLE_Y - 22 if (sgn < 0 or clasped) else 376
        d.curve([(X(256), 230), (X(254), 420), (X(252), low)], w=1.4)                   # upper arm outer
        d.curve([(X(202), 242), (X(204), 420), (X(206), low - 8)], w=1.2)               # upper arm inner
        d.curve([(X(190), 250), (X(186), 430), (X(182), TABLE_Y if (sgn < 0 or clasped) else 376)], w=1.0, a=0.45)
    d.curve([(cx - 150, 520), (cx - 60, 548), (cx + 40, 544)], w=0.8, a=0.28, passes=1)
    d.curve([(cx - 150, 70), (cx - 170, 150), (cx - 176, 210)], w=0.8, a=0.28, passes=1)
    d.hatch([(cx + 120, 250), (cx + 182, 250), (cx + 182, 376), (cx + 128, 376)], angle=70, spacing=9, w=0.7, a=0.3)
    if not clasped:
        # left forearm on the table, the hand resting flat
        d.curve([(cx - 252, TABLE_Y - 22), (cx - 248, TABLE_Y + 4), (cx - 200, TABLE_Y + 50), (cx - 102, 730)], w=1.5)
        d.curve([(cx - 206, TABLE_Y - 30), (cx - 180, TABLE_Y + 2), (cx - 110, 660), (cx - 60, 690)], w=1.5)
        hand(d, cx - 84, 712, 0.9, math.radians(124), flip=False, arm=None)
    else:
        # both forearms in, the hands folded in the middle of the table
        for sgn in (-1, 1):
            X = lambda u: cx + sgn * u
            d.curve([(X(252), TABLE_Y - 22), (X(248), TABLE_Y + 10), (X(180), 690), (X(84), 736)], w=1.5)
            d.curve([(X(206), TABLE_Y - 30), (X(184), TABLE_Y + 2), (X(120), 650), (X(66), 676)], w=1.5)
        _clasped(d, cx, 712, paper)

CLASP = (XC, 712)

def _clasped(d, x, y, paper=None):
    """Two hands folded on the table, the right one over the left (bottom hand only; see top_hand())."""
    hand(d, x - 70, y + 10, 0.86, math.radians(98), flip=False, arm=None, tendons=False)

@functools.lru_cache(maxsize=2)
def top_hand():
    d = Drawing(seed=607, width=1.7)
    hand(d, CLASP[0] + 62, CLASP[1] + 2, 0.86, math.radians(-104), flip=True, arm=None, tendons=False)
    return d

def draw_top_hand(c, day, progress=1.0):
    path = skia.Path(); pts = hand_poly(CLASP[0] + 62, CLASP[1] + 2, 0.86, math.radians(-104), flip=True)
    path.moveTo(*pts[0])
    for q in pts[1:]:
        path.lineTo(*q)
    path.close()
    c.drawPath(path, paint(O.b_paper(day), smooth((progress - 0.8) / 0.15)))
    top_hand().draw(c, clamp((progress - 0.8) / 0.2))

def _cup(d, cx=CUP[0], ry=CUP[1], by=CUP[2], straw=True, level=0.0):
    tw, bw = 64, 50
    d.line(cx - tw, ry, cx - bw, by, w=1.5); d.line(cx + tw, ry, cx + bw, by, w=1.5)
    d.ellipse(cx, by, bw, 9, 0, math.pi, w=1.4)
    d.ellipse(cx, ry, tw, 11, w=1.3)
    d.curve([(cx - tw - 3, ry - 2), (cx - 40, ry - 36), (cx, ry - 47), (cx + 40, ry - 36), (cx + tw + 3, ry - 2)], w=1.3)   # dome lid
    lv = ry + 48 + level
    d.ellipse(cx, lv, tw - 4 - (lv - ry) * 0.05, 8, 0, math.pi, w=0.9, a=0.5, passes=1)                          # tea level
    for k, (px, py) in enumerate([(-30, -14), (-12, -12), (6, -15), (24, -12), (38, -16), (-22, -28), (-4, -27), (14, -29), (30, -27)]):
        d.ellipse(cx + px * 0.95, by + py, 6.5, 6, w=0.9, a=0.55, passes=1)                                      # pearls
    for k in range(7):
        yy = ry + 70 + k * 27; xx = cx - tw + 12 + (k * 37) % 90
        d.line(xx, yy, xx + 1, yy + 6, w=0.8, a=0.35, passes=1)                                                   # condensation
    if straw:
        d.line(cx + 2, ry - 44, cx + 36, ry - 160, w=1.3); d.line(cx + 14, ry - 42, cx + 48, ry - 158, w=1.3)
        d.ellipse(cx + 42, ry - 159, 6, 3, w=1.0, passes=1)
    else:
        # straw still in its paper wrapper, lying on the table
        d.poly([(cx - 150, by + 42), (cx + 80, by + 16), (cx + 82, by + 26), (cx - 148, by + 52)], closed=True, w=1.1)
        d.line(cx - 140, by + 46, cx + 70, by + 22, w=0.7, a=0.35, passes=1)

def _laptop(d, closed=False):
    if not closed:
        d.poly([(1062, 378), (1400, 356), (1410, 642), (1076, 656)], closed=True, w=1.6)
        d.poly([(1076, 656), (1410, 642), (1428, 660), (1062, 676)], w=1.3)
        d.ellipse(1238, 508, 17, 18, w=1.0, a=0.45, passes=1)
        d.hatch([(1064, 380), (1398, 358), (1408, 640), (1078, 654)], angle=84, spacing=11, w=0.7, a=0.22)
    else:
        d.poly([(1226, 616), (1470, 610), (1490, 664), (1214, 674)], closed=True, w=1.5)
        d.line(1214, 674, 1216, 686, w=1.1)
        d.line(1216, 686, 1490, 676, w=1.2)
        d.hatch([(1228, 618), (1468, 612), (1486, 662), (1216, 672)], angle=4, spacing=9, w=0.6, a=0.2)

def _glasses(d, x=1096, y=806):
    for dx in (-44, 44):
        d.ellipse(x + dx, y, 37, 21, w=0.9, a=0.55, passes=1)
        d.ellipse(x + dx - 8, y - 6, 14, 6, math.radians(200), math.radians(290), w=0.8, a=0.45, passes=1)   # glint
    d.curve([(x - 8, y - 8), (x, y - 13), (x + 8, y - 8)], w=1.2)
    d.ellipse(x - 12, y + 4, 4, 6, w=0.8, a=0.6, passes=1); d.ellipse(x + 12, y + 4, 4, 6, w=0.8, a=0.6, passes=1)
    d.curve([(x - 81, y - 4), (x - 20, y + 18), (x + 60, y + 24), (x + 96, y + 20)], w=1.0, a=0.7)          # folded temples
    d.curve([(x + 81, y - 6), (x + 20, y + 14), (x - 50, y + 26), (x - 92, y + 22)], w=1.0, a=0.7)

def _phone_down(d, x=1226, y=716):
    d.poly([(x, y), (x + 128, y - 6), (x + 138, y + 38), (x + 6, y + 46)], closed=True, w=1.3)
    d.hatch([(x, y), (x + 128, y - 6), (x + 138, y + 38), (x + 6, y + 46)], angle=20, spacing=5, w=0.7, a=0.5)

@functools.lru_cache(maxsize=8)
def booth(day=DAY, variant='d60'):
    """The booth drawing. variant 'd60': laptop open, glasses on the table, straw in the cup.
    'd35': laptop closed, no glasses (he wears them), untouched cup, hands clasped. 'empty': Xiao gone."""
    d = Drawing(seed=604, width=1.7)
    _wall(d, clasped=(variant == 'd35'))
    _lamp(d)
    _poster(d)
    if variant != 'empty':
        _xiao_torso(d, clasped=(variant == 'd35'), paper=paper_rgb(day))
    _cup(d, straw=(variant != 'd35'))
    _laptop(d, closed=(variant == 'd35'))
    if variant == 'd60':
        _glasses(d)
        _phone_down(d)
    return d

@functools.lru_cache(maxsize=8)
def booth_xiao(clasped=False, day=DAY):
    """Xiao alone (for moving him: lean back / lean in)."""
    d = Drawing(seed=605, width=1.7)
    _xiao_torso(d, clasped=clasped, paper=paper_rgb(day))
    return d

@functools.lru_cache(maxsize=8)
def booth_set(day=DAY, variant='d60'):
    """Everything but Xiao."""
    d = Drawing(seed=606, width=1.7)
    _wall(d, clasped=(variant == 'd35')); _lamp(d); _poster(d)
    _cup(d, straw=(variant != 'd35'))
    _laptop(d, closed=(variant == 'd35'))
    if variant == 'd60':
        _glasses(d); _phone_down(d)
    return d

def poster_print(c, a=1.0):
    x = (PX0 + PX1) / 2
    text(c, '本 周 限 定', x, 106, 'sans-medium', 20, POSTER_INK, 0.75 * a, 'center', tracking=0.2)
    text(c, '第二杯半价', x, 178, 'sans-heavy', 54, POSTER_INK, 0.82 * a, 'center', tracking=0.04)

def tea_tint(c, cx=CUP[0], ry=CUP[1], by=CUP[2], level=0.0, a=1.0):
    """The milk tea itself: the one warm colour on the page."""
    lv = ry + 48 + level
    k0 = (lv - ry) / (by - ry)
    tw, bw = 64, 50
    xl0 = cx - (tw + (bw - tw) * k0); xr0 = cx + (tw + (bw - tw) * k0)
    smudge(c, [(xl0 + 4, lv), (xr0 - 4, lv), (cx + bw - 3, by), (cx - bw + 3, by)], (201, 150, 96), 0.30 * a, 4)

def booth_light(c, w, h, k=1.0, lamp=1.0):
    """Warm tea-coloured light: the bulb, the pool on the table, a general warmth."""
    glow(c, 720, 560, 1100, TEA, 0.13 * k)
    glow(c, LAMP_X, TABLE_Y + 90, 720, TEA, 0.30 * k * lamp)
    glow(c, LAMP_X, LAMP_Y + 6, 170, (255, 238, 205), 0.62 * k * lamp)
    glow(c, LAMP_X, LAMP_Y + 2, 60, (255, 250, 235), 0.55 * k * lamp)
    glow(c, CUP[0], CUP[1] + 100, 160, (255, 236, 200), 0.18 * k * lamp)

def draw_booth(c, L, day=DAY, variant='d60', progress=1.0, light=1.0, lamp=1.0, xiao_dy=0.0, xiao_s=1.0,
               level=0.0, dim=0.0, laptop_glow=1.0, bg=True, static=False, linear=False):
    """The wide. xiao_dy/xiao_s move Xiao (lean back: dy<0, s<1; lean in: dy>0, s>1).
    static=True: the caller promises these parameters hold for a while -> baked image."""
    if static and progress >= 1.0 and bg:
        key = ('booth', day, variant, round(light, 3), round(lamp, 3), round(xiao_dy, 2), round(xiao_s, 4),
               round(level, 2), round(dim, 3), round(laptop_glow, 3))
        blit(c, baked(key, lambda cc: draw_booth(cc, _Dims, day, variant, 1.0, light, lamp, xiao_dy, xiao_s,
                                                 level, dim, laptop_glow, True, False)), linear)
        return
    if bg:
        paper_bg(c, day)
    tea_tint(c, level=level, a=min(1.0, progress * 1.6))
    if variant != 'empty':
        c.save()
        if xiao_dy != 0.0 or xiao_s != 1.0:
            c.translate(XC, TABLE_Y + 140); c.scale(xiao_s, xiao_s); c.translate(-XC, -(TABLE_Y + 140) + xiao_dy)
        ka = smooth((progress - 0.5) / 0.4)
        smudge(c, [(XC + 110, 250), (XC + 186, 250), (XC + 184, TABLE_Y), (XC + 120, TABLE_Y)], GRAPHITE, 0.07 * ka, 26)
        smudge(c, [(XC - 186, 250), (XC - 160, 250), (XC - 168, TABLE_Y), (XC - 184, TABLE_Y)], GRAPHITE, 0.05 * ka, 16)
        smudge(c, [(XC - 90, 70), (XC + 90, 70), (XC + 60, 100), (XC - 60, 100)], GRAPHITE, 0.05 * ka, 12)
        c.restore()
    moving = (xiao_dy != 0.0 or xiao_s != 1.0) and variant != 'empty'
    if not moving:
        booth(day, variant).draw(c, progress)
        if variant == 'd35':
            draw_top_hand(c, day, progress)
    else:
        booth_set(day, variant).draw(c, progress)
        c.save()
        c.translate(XC, TABLE_Y + 140); c.scale(xiao_s, xiao_s); c.translate(-XC, -(TABLE_Y + 140) + xiao_dy)
        booth_xiao(variant == 'd35', day).draw(c, progress)
        if variant == 'd35':
            draw_top_hand(c, day, progress)
        c.restore()
    poster_print(c, smooth((progress - 0.35) / 0.3))
    if dim > 0:
        c.drawRect(skia.Rect(0, 0, L.w, L.h), paint((60, 58, 56), dim))
    if variant == 'd60' and laptop_glow > 0:
        glow(c, 1070, 430, 160, (200, 218, 240), 0.22 * laptop_glow * smooth((progress - 0.6) / 0.3))
    booth_light(c, L.w, L.h, light * smooth(progress / 0.5 + 0.2), lamp)

# =====================================================================
# other pages
# =====================================================================
@functools.lru_cache(maxsize=4)
def table_top(variant='d60'):
    """Top-down: the table between them. Wood grain; Xiao's cup top-left, the laptop's corner top-right."""
    d = Drawing(seed=611, width=1.4)
    rng = np.random.default_rng(611)
    for k in range(12):
        y = 30 + k * 88 + rng.normal(0, 8)
        pts = [(x, y + 7 * math.sin(x / rng.uniform(160, 320) + k) + rng.normal(0, 1)) for x in range(-40, 1500, 60)]
        d.curve(pts, w=0.9, a=rng.uniform(0.16, 0.28), passes=1)
    d.ellipse(260, 640, 30, 9, w=0.8, a=0.25, passes=1); d.ellipse(260, 640, 16, 4, w=0.8, a=0.25, passes=1)
    d.ellipse(1210, 880, 26, 8, w=0.8, a=0.22, passes=1)
    d.line(-20, 1046, 1460, 1040, w=1.8)
    d.hatch([(-20, 1050), (1460, 1044), (1460, 1100), (-20, 1100)], angle=0, spacing=6, w=0.8, a=0.4)
    # the cup from above
    d.ellipse(170, 150, 74, 74, w=1.5); d.ellipse(170, 150, 60, 60, w=1.0, a=0.6)
    if variant == 'd60':
        d.ellipse(186, 138, 9, 9, w=1.2); d.ellipse(186, 138, 5, 5, w=0.8, a=0.6, passes=1)
    else:
        d.poly([(40, 300), (300, 262), (302, 274), (42, 312)], closed=True, w=1.0)
    # laptop corner
    d.poly([(1180, -20), (1196, 196), (1480, 214)], w=1.5)
    for r in range(4):
        for q in range(6):
            x0 = 1220 + q * 40 + r * 2; y0 = 10 + r * 40 + q * 3
            d.rect(x0, y0, 30, 28, w=0.7, a=0.35, passes=1)
    return d

def draw_table_top(c, L, day=DAY, variant='d60', light=1.0, bg=True, linear=False, _inner=False):
    if bg and not _inner:
        blit(c, baked(('table', day, variant, round(light, 3)), lambda cc: draw_table_top(cc, _Dims, day, variant, light, True, False, True)), linear)
        return
    if bg:
        paper_bg(c, day)
    smudge(c, [(110, 90), (230, 90), (240, 210), (100, 210)], (201, 150, 96), 0.22 * light, 30)
    table_top(variant).draw(c, 1.0)
    glow(c, 620, 420, 900, TEA, 0.20 * light)

def draw_pen(c, x, y, a=1.0, ang=-32, L=330):
    """A cheap ballpoint (Xiao's), tip at (x, y)."""
    if a <= 0:
        return
    c.save(); c.translate(x, y); c.rotate(ang)
    sh = paint((0, 0, 0), 0.18 * a); sh.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 6))
    c.drawRect(skia.Rect.MakeXYWH(20, 10, L, 16), sh)
    p = skia.Path(); p.moveTo(0, 0); p.lineTo(26, -6); p.lineTo(26, 6); p.close()
    c.drawPath(p, paint((150, 150, 150), a))
    c.drawCircle(1.5, 0, 1.6, paint((30, 30, 30), a))
    c.drawRect(skia.Rect.MakeXYWH(26, -7, L, 14), paint((32, 36, 48), a))
    c.drawRect(skia.Rect.MakeXYWH(26, -7, L, 4), paint((70, 76, 92), a))
    c.drawRect(skia.Rect.MakeXYWH(L - 60, -10, 70, 5), paint((160, 162, 166), a))
    c.restore()

def envelope(c, x, y, a=1.0, rot=0.0, w=400, h=214):
    """A plain kraft envelope with cash in it. Crisp, like the contract: an object from outside the sketchbook."""
    if a <= 0:
        return
    c.save(); c.translate(x + w / 2, y + h / 2); c.rotate(math.degrees(rot)); c.translate(-w / 2, -h / 2)
    sh = paint((0, 0, 0), 0.22 * a); sh.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 12))
    c.drawRect(skia.Rect.MakeXYWH(8, 12, w, h), sh)
    c.drawRect(skia.Rect.MakeXYWH(0, 0, w, h), paint(KRAFT, a))
    fl = skia.Path(); fl.moveTo(0, 0); fl.lineTo(w / 2, h * 0.52); fl.lineTo(w, 0); fl.close()
    c.drawPath(fl, paint((200, 168, 120), a))
    c.drawPath(fl, paint((150, 120, 80), a * 0.6, 1.2))
    c.drawRect(skia.Rect.MakeXYWH(0, 0, w, h), paint((150, 120, 80), a * 0.7, 1.2))
    # the thickness of the notes inside, a faint bulge line
    c.drawLine(24, h - 22, w - 24, h - 22, paint((170, 138, 96), a * 0.5, 1.0))
    c.restore()

def contract_mark(c, x, y, s, key, k, amount='陆仟元整', a=1.0):
    """Animated marker highlight (multiply) over a clause of the contract drawn at (x, y, s)."""
    if k <= 0:
        return
    Lc = O.contract_layout(s, amount)
    idx = {'amount': 5, 'term': 6, 'rate': 8}[key]
    tx = O.CONTRACT_LINES[idx][1].replace('{amount}', amount)
    yy = Lc['ys'][idx]; mx = Lc['mx']
    if key == 'term':
        tx = tx[:tx.index('，')] if '，' in tx else tx
    full = text_width(tx, 'serif', 16 * s) + 8 * s
    p = paint((250, 214, 90), 0.62 * a, blend=skia.BlendMode.kMultiply)
    c.drawRect(skia.Rect.MakeXYWH(x + mx - 4 * s, y + yy - 18 * s, full * clamp(k), 24 * s), p)

def sign_tip(s, sign, mx=None):
    """Where the pen is while contract_page draws the borrower signature (page-local, scaled)."""
    Lc = O.contract_layout(s)
    mx = Lc['mx']
    sx = mx + 450 * s
    name = '张朝阳'; n = len(name)
    i = min(n - 1, int(sign * n)); k = sign * n - i
    for j in range(i):
        sx += text_width(name[j], 'hand', 24 * s) + 1 * s
    wch = text_width(name[i], 'hand', 24 * s)
    return sx + wch * clamp(k), Lc['sign_y'] - 8 * s + 5 * s * math.sin(k * 9)

SNEAKER = [(6, 0), (296, 0), (306, -8), (308, -20), (300, -32), (286, -40), (262, -48), (232, -58), (200, -70),
           (168, -82), (140, -92), (128, -112), (112, -116), (100, -104), (92, -92), (60, -86), (30, -92), (12, -86),
           (4, -60), (0, -30), (2, -10)]

@functools.lru_cache(maxsize=2)
def sneaker():
    """His washed-out canvas sneaker, side view, facing right; sole bottom at y=0, heel at x=0."""
    d = Drawing(seed=670, width=1.7)
    d.curve(SNEAKER + [SNEAKER[0]], w=1.8)
    d.curve([(3, -16), (150, -17), (300, -18)], w=1.3)                                  # top of the sole
    d.curve([(236, -18), (262, -34), (298, -34)], w=1.2)                                 # toe cap
    d.hatch([(4, -2), (296, -2), (304, -16), (3, -15)], angle=0, spacing=4, w=0.6, a=0.35)
    for k in range(22):                                                                   # stitching
        x = 10 + k * 12
        d.line(x, -24, x + 6, -24, w=0.6, a=0.4, passes=1)
    d.curve([(60, -86), (84, -52), (108, -20)], w=1.0, a=0.6)                           # side seam
    for k in range(5):                                                                   # eyelets + tight laces
        ex, ey = 142 + 20 * k, -84 + 6 * k
        d.ellipse(ex, ey, 3.2, 3.2, w=0.8, passes=1)
        if k < 4:
            d.line(ex, ey, ex + 20, ey + 1, w=1.1, a=0.8, passes=1)
            d.line(ex + 2, ey + 5, ex + 18, ey - 4, w=0.9, a=0.6, passes=1)
    d.ellipse(132, -100, 10, 6, w=1.1, passes=1); d.ellipse(150, -100, 9, 6, w=1.1, passes=1)   # the knot, pulled tight
    d.curve([(140, -96), (132, -80), (126, -62)], w=0.9, a=0.8, passes=1)
    d.curve([(142, -96), (150, -78), (148, -58)], w=0.9, a=0.8, passes=1)
    d.rect(4, -90, 10, 18, w=0.8, a=0.6, passes=1)                                       # heel tab
    d.curve([(20, -80), (60, -76), (92, -84)], w=0.8, a=0.4, passes=1)                   # collar padding
    return d

def sneaker_at(c, x, floor_y, face=1, lift=0.0, s=1.3, day=DAY, a=1.0):
    """One sneaker centred at x standing on floor_y (face=+1 toe right). Paper fill occludes what is behind."""
    c.save()
    c.translate(x, floor_y - lift); c.scale(s * face, s); c.translate(-154, 0)
    if lift < 1:
        smudge(c, [(0, -4), (300, -4), (300, 6), (0, 6)], GRAPHITE, 0.10 * a, 8)
    path = skia.Path(); path.moveTo(*SNEAKER[0])
    for q in SNEAKER[1:]:
        path.lineTo(*q)
    path.close()
    c.drawPath(path, paint(O.b_paper(day), a))
    sneaker().draw(c, 1.0, a)
    c.restore()

@functools.lru_cache(maxsize=2)
def under_table():
    """Floor level: the booth's bench base, the table's pedestal, the floor tiles."""
    d = Drawing(seed=612, width=1.5)
    d.line(-20, 170, 1460, 160, w=1.6)                        # underside of the table
    d.hatch([(-20, 0), (1460, 0), (1460, 162), (-20, 172)], angle=4, spacing=8, w=0.8, a=0.35)
    d.rect(930, 172, 70, 560, w=1.4)                         # pedestal
    d.poly([(840, 740), (1090, 740)], w=1.6); d.ellipse(965, 740, 125, 14, math.pi, 2 * math.pi, w=1.0, a=0.5)
    d.poly([(1120, 300), (1460, 296)], w=1.4)                # bench front (Xiao's side)
    d.hatch([(1120, 302), (1460, 298), (1460, 760), (1120, 760)], angle=90, spacing=10, w=0.7, a=0.25)
    d.line(-20, 760, 1460, 752, w=1.4)                       # floor line
    for k in range(9):                                        # tiles in perspective
        x0 = -300 + k * 260
        d.line(x0 + 180, 760, x0 - 120, 1080, w=0.8, a=0.25, passes=1)
    d.line(-20, 880, 1460, 872, w=0.8, a=0.22, passes=1)
    return d

@functools.lru_cache(maxsize=2)
def arithmetic_lines():
    return [('6000 × 15% = 900', '（一年）'), ('900 ÷ 2 = 450', '（半年）'), ('6000 + 450 = 6450', '')]

def draw_arithmetic(c, t, L, day=DAY, cps=6.5, x0=300, y0=380, size=66, lh=150):
    """His sum, written by hand on the sketchbook page, character by character. Returns pen tip."""
    paper_glow(c, day, ((720, 470, 900, LAMP, 0.16),))
    tip = None
    tt = t
    for i, (s, note) in enumerate(arithmetic_lines()):
        y = y0 + i * lh
        n = len(s)
        shown = clamp(tt * cps / n) * n
        full = int(shown)
        xs = x0
        for j, ch in enumerate(s):
            if j > full:
                break
            aa = 1.0 if j < full else (shown - full)
            text(c, ch, xs, y, 'hand', size, GRAPHITE, 0.9 * aa)
            wch = text_width(ch, 'hand', size)
            if j == full or (j == n - 1 and shown >= n):
                tip = (xs + wch * min(1.0, aa), y - size * 0.25)
            xs += wch
        tt -= n / cps + 0.7
        if note and shown >= n:
            k = clamp((tt + 0.55) / 0.5)
            text(c, note, xs + 24, y - 4, 'hand', size * 0.5, GRAPHITE, 0.55 * k)
        if tt < 0:
            break
        if i == 2 and shown >= n:
            k = clamp(tt / 0.6)
            wv = text_width('6450', 'hand', size)
            xe = x0 + text_width('6000 + 450 = ', 'hand', size)
            c.drawLine(xe - 4, y + 20, xe - 4 + (wv + 10) * k, y + 18, paint(GRAPHITE, 0.75, 2.4))
            k2 = clamp((tt - 0.5) / 0.5)
            if k2 > 0:
                c.drawLine(xe, y + 32, xe + (wv + 4) * k2, y + 31, paint(GRAPHITE, 0.6, 2.0))
            tip = (xe - 4 + (wv + 10) * k, y + 20) if k < 1 else ((xe + (wv + 4) * k2, y + 31) if k2 > 0 else tip)
    return tip

def phone_note(c, t, L, lines, cps=5.0, gaps=None):
    """Xiao's phone, a notes app: what he writes after Zhang leaves."""
    paper_glow(c, DAY, ((720, 540, 900, TEA, 0.16),))
    x, y, w, h = 470, 120, 500, 900
    d = phone_outline()
    d.draw(c, 1.0)
    # screen
    c.drawRoundRect(skia.Rect.MakeXYWH(x + 22, y + 60, w - 44, h - 120), 10, 10, paint((250, 250, 247), 0.97))
    glow(c, x + w / 2, y + h / 2, 520, (235, 240, 250), 0.25)
    text(c, '备忘录', x + 48, y + 118, 'sans-medium', 26, (40, 40, 40), 0.85)
    text(c, '3月18日', x + w - 48, y + 118, 'sans-light', 22, (130, 130, 130), 0.9, 'right')
    c.drawLine(x + 48, y + 140, x + w - 48, y + 140, paint((200, 200, 200), 1.0, 1.0))
    tt = t
    yy = y + 210
    for i, s in enumerate(lines):
        n = len(s)
        k = int(clamp(tt * cps / n) * n)
        text(c, s[:k], x + 48, yy, 'sans', 34, (30, 30, 30), 0.95)
        if 0 < tt and k < n and int(t * 2.2) % 2 == 0:
            cx = x + 48 + text_width(s[:k], 'sans', 34) + 3
            c.drawRect(skia.Rect.MakeXYWH(cx, yy - 32, 2.5, 40), paint((60, 120, 220), 0.9))
        tt -= n / cps + (gaps[i] if gaps else 0.8)
        yy += 64
        if tt < 0:
            if k >= n and int(t * 2.2) % 2 == 0:
                c.drawRect(skia.Rect.MakeXYWH(x + 48, yy - 32, 2.5, 40), paint((60, 120, 220), 0.9))
            break
    # his thumb at the lower right
    thumb().draw(c, 1.0)

@functools.lru_cache(maxsize=1)
def phone_outline():
    d = Drawing(seed=620, width=1.8)
    x, y, w, h = 470, 120, 500, 900
    r = 50
    pts = []
    for (cx, cy, a0) in [(x + w - r, y + r, -90), (x + w - r, y + h - r, 0), (x + r, y + h - r, 90), (x + r, y + r, 180)]:
        for k in range(8):
            th = math.radians(a0 + k * 90 / 7)
            pts.append((cx + r * math.cos(th), cy + r * math.sin(th)))
    d.poly(pts, closed=True)
    # fingers of the left hand holding it (behind, at the left edge)
    for k in range(3):
        yy = 520 + k * 92
        d.curve([(470, yy), (440, yy + 8), (428, yy + 40), (446, yy + 70), (470, yy + 74)], w=1.4)
    d.curve([(470, 330), (430, 380), (400, 520), (398, 900), (420, 1090)], w=1.4)
    return d

@functools.lru_cache(maxsize=1)
def thumb():
    d = Drawing(seed=621, width=1.6)
    d.curve([(1110, 1090), (1040, 960), (960, 880), (905, 842), (878, 858), (884, 890), (930, 950), (980, 1040), (1000, 1090)], w=1.6)
    d.curve([(900, 850), (890, 862), (896, 876)], w=0.9, a=0.4, passes=1)
    return d

HEAD = (720, 362)
BODY = [(420, 1100), (428, 900), (440, 760), (474, 678), (548, 624), (632, 588), (660, 550), (666, 450),
        (774, 450), (780, 550), (808, 588), (892, 624), (966, 678), (1000, 760), (1012, 900), (1020, 1100)]

def _head_pts():
    hx, hy = HEAD
    return [(hx + 92 * math.cos(a), hy + 114 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 56, endpoint=False)]

def _ear_pts(ex):
    hx, hy = HEAD
    return [(hx + ex * 90 + ex * 13 * math.cos(a), hy + 26 + 28 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 20)]

@functools.lru_cache(maxsize=2)
def silhouette(part='body'):
    """Zhang from behind, standing: pencil outline + graphite grain (a solid tone is laid under it)."""
    d = Drawing(seed=630 if part == 'body' else 632, width=2.0)
    if part == 'body':
        d.curve(BODY[1:-1], w=2.2)
        d.hatch(BODY, angle=68, spacing=6, w=0.9, a=0.3)
        d.curve([(560, 780), (590, 900), (600, 1080)], w=1.2, a=0.3, passes=1)
        d.curve([(880, 780), (850, 900), (840, 1080)], w=1.2, a=0.3, passes=1)
    else:
        for ex in (-1, 1):
            d.ellipse(HEAD[0] + ex * 90, HEAD[1] + 26, 13, 28, w=1.8)
        d.ellipse(HEAD[0], HEAD[1], 92, 114, w=2.2)
        d.hatch(_head_pts(), angle=62, spacing=5, w=0.9, a=0.35)
    return d

@functools.lru_cache(maxsize=2)
def _sil_path(part):
    from film.sketch import _catmull
    p = skia.Path()
    if part == 'body':
        pts = _catmull(BODY)
        p.moveTo(*pts[0])
        for q in pts[1:]:
            p.lineTo(*q)
        p.close()
    else:
        for poly in (_head_pts(), _ear_pts(-1), _ear_pts(1)):
            sub = skia.Path(); sub.moveTo(*poly[0])
            for q in poly[1:]:
                sub.lineTo(*q)
            sub.close()
            p = skia.Op(p, sub, skia.PathOp.kUnion_PathOp) if not p.isEmpty() else sub
    return p

SIL_TONE = (58, 54, 50)

def draw_silhouette(c, bow=0.0, a=1.0, x=0.0, pivot=1600.0):
    """bow 0..1: the upper body tilts away from the camera: shoulders foreshorten a little,
    the head drops forward (it comes down over the neck)."""
    hx, hy = HEAD
    def body_t():
        c.translate(x, pivot); c.scale(1.0, 1.0 - 0.10 * bow); c.translate(0, -pivot)
    def head_t():
        c.translate(x, 150 * bow)
        c.translate(hx, hy); c.scale(1.0, 1.0 - 0.10 * bow); c.translate(-hx, -hy)
    # one solid tone for the whole figure (no darker seams where head and body overlap) ...
    lp = skia.Paint(); lp.setAlphaf(0.9 * a)
    c.saveLayer(None, lp)
    c.save(); body_t(); c.drawPath(_sil_path('body'), paint(SIL_TONE, 1.0)); c.restore()
    c.save(); head_t(); c.drawPath(_sil_path('head'), paint(SIL_TONE, 1.0)); c.restore()
    c.restore()
    # ... and the pencil on top of it
    c.save(); body_t(); silhouette('body').draw(c, 1.0, a); c.restore()
    c.save(); head_t(); silhouette('head').draw(c, 1.0, a); c.restore()

@functools.lru_cache(maxsize=4)
def bow_background(day=DAY):
    """The booth seen from behind the standing boy: soft (pre-blurred once), Xiao centred behind him."""
    surf = skia.Surface(BW, H); c = surf.getCanvas()
    class _L: pass
    Lx = _L(); Lx.w, Lx.h = BW, H
    paper_bg(c, day)
    c.save(); c.translate(720 - XC * 1.1, 60); c.scale(1.1, 1.1)
    draw_booth(c, Lx, day, 'd60', bg=False)
    c.restore()
    img = surf.makeImageSnapshot()
    surf2 = skia.Surface(BW, H); c2 = surf2.getCanvas()
    paper_bg(c2, day)
    p = blur_paint(2.6); p.setAlphaf(0.62)
    c2.drawImage(img, 0, 0, skia.SamplingOptions(), p)
    return surf2.makeImageSnapshot()

EDGE_Y = 650                          # near edge of the table in the reverse shot

@functools.lru_cache(maxsize=4)
def edge_table(day=DAY):
    """Looking down at his side of the table: wood grain, the near edge, the shadow of his lap below."""
    d = Drawing(seed=641, width=1.4)
    rng = np.random.default_rng(641)
    for k in range(7):
        y = 60 + k * 86 + rng.normal(0, 6)
        pts = [(x, y + 6 * math.sin(x / rng.uniform(170, 330) + k)) for x in range(-40, 1500, 60)]
        d.curve(pts, w=0.9, a=rng.uniform(0.16, 0.26), passes=1)
    d.ellipse(1120, 250, 34, 9, w=0.8, a=0.22, passes=1)
    d.line(-20, EDGE_Y, 1460, EDGE_Y - 6, w=2.0)
    d.line(-20, EDGE_Y + 26, 1460, EDGE_Y + 20, w=1.3, a=0.6)
    d.hatch([(-20, EDGE_Y + 2), (1460, EDGE_Y - 4), (1460, EDGE_Y + 20), (-20, EDGE_Y + 26)], angle=0, spacing=5, w=0.8, a=0.4)
    return d

@functools.lru_cache(maxsize=4)
def zhang_hands(pose=0, day=DAY):
    """His two hands resting at the table edge, the frayed cuffs of the old jacket."""
    d = Drawing(seed=640 + pose, width=1.6)
    if pose == 0:     # resting, a little apart
        hand(d, 500, 720, 1.15, math.radians(16), flip=False, arm='cuff', arm_len=420)
        hand(d, 960, 730, 1.15, math.radians(-14), flip=True, arm='cuff', arm_len=420)
    else:             # drawn back toward the edge, closer together
        hand(d, 590, 772, 1.15, math.radians(26), flip=False, arm='cuff', arm_len=420)
        hand(d, 860, 784, 1.15, math.radians(-24), flip=True, arm='cuff', arm_len=420)
    return d

def _edge_base(cc, day):
    O.b_background(cc, day)
    smudge(cc, [(-40, EDGE_Y + 26), (1480, EDGE_Y + 20), (1480, 1120), (-40, 1120)], GRAPHITE, 0.10, 40)
    edge_table(day).draw(cc, 1.0)
    glow(cc, 700, 300, 900, TEA, 0.16)

def draw_zhang_hands(c, L, pose=0, day=DAY, card=None, dx=0.0):
    blit(c, baked(('edge', day), lambda cc: _edge_base(cc, day)))
    if card is not None:
        cx, cy, ca = card
        c.save(); c.translate(cx, cy); c.scale(0.66, 0.66)
        O.card(c, 0, 0, a=ca, rot=-0.08, worn=1.0)
        c.restore()
    c.save(); c.translate(dx, 0)
    zhang_hands(pose, day).draw(c, 1.0)
    c.restore()

@functools.lru_cache(maxsize=2)
def cup_insert():
    """The cup, big: dome lid, wide straw, pearls at the bottom."""
    d = Drawing(seed=650, width=2.2)
    cx, ry, by = 720, 300, 980
    tw, bw = 190, 150
    d.line(cx - tw, ry, cx - bw, by, w=2.2); d.line(cx + tw, ry, cx + bw, by, w=2.2)
    d.ellipse(cx, by, bw, 24, 0, math.pi, w=2.0)
    d.ellipse(cx, ry, tw, 30, w=2.0)
    d.curve([(cx - tw - 8, ry - 4), (cx - 120, ry - 100), (cx, ry - 132), (cx + 120, ry - 100), (cx + tw + 8, ry - 4)], w=2.0)
    d.line(cx + 6, ry - 126, cx + 60, -20, w=2.0); d.line(cx + 40, ry - 122, cx + 94, -20, w=2.0)
    d.line(cx + 6, ry - 126, cx - 20, by - 60, w=1.4, a=0.45); d.line(cx + 40, ry - 122, cx + 14, by - 60, w=1.4, a=0.45)
    rng = np.random.default_rng(651)
    for k in range(22):
        px = cx + rng.uniform(-bw + 24, bw - 24); py = by - rng.uniform(14, 90)
        d.ellipse(px, py, 17, 16, w=1.3, a=0.6, passes=1)
    for k in range(12):
        yy = ry + 90 + k * 50; xx = cx - tw + 30 + (k * 61) % 300
        d.line(xx, yy, xx + 1, yy + 14, w=1.0, a=0.3, passes=1)
    return d

def draw_cup_insert(c, L, sip=0.0, t=0.0, day=DAY):
    """sip 0..1: tea level drops, tea rises in the straw, a pearl travels up."""
    paper_bg(c, day)
    cx, ry, by = 720, 300, 980
    tw, bw = 190, 150
    lv = ry + 120 + 150 * sip
    k0 = (lv - ry) / (by - ry)
    xl = cx - (tw + (bw - tw) * k0); xr = cx + (tw + (bw - tw) * k0)
    smudge(c, [(xl + 8, lv), (xr - 8, lv), (cx + bw - 6, by), (cx - bw + 6, by)], (201, 150, 96), 0.32, 6)
    sucking = clamp(sip * 6) * clamp((1 - sip) * 6)
    if sucking > 0:     # tea in the straw
        smudge(c, [(cx + 8, ry - 124), (cx + 38, ry - 120), (cx + 14, by - 60), (cx - 18, by - 60)], (190, 140, 88), 0.35 * sucking, 3)
        u = (t * 0.9) % 1.0
        px = cx - 2 + (cx + 70 - (cx - 2)) * u; py = by - 70 + (-10 - (by - 70)) * u
        c.drawCircle(px, py, 11, paint((90, 62, 40), 0.55 * sucking))
    cup_insert().draw(c, 1.0)
    glow(c, 520, 200, 800, TEA, 0.22)

# =====================================================================
# small procedural sounds
# =====================================================================
def _tt(d):
    return np.arange(int(d * SR)) / SR

def slide(seed=0, d=0.6, a=1.0, lo=700, hi=4800):
    rng = np.random.default_rng(seed)
    t = _tt(d)
    x = bandpass(sfx.noise(d, seed), lo, hi) * np.sin(np.pi * t / d) ** 1.3
    x *= 0.75 + 0.25 * np.sin(2 * np.pi * rng.uniform(9, 21) * t)
    return (x * 0.22 * a).astype(np.float32)

def chime(seed=0):
    """The shop door's electronic 'ding-dong'."""
    out = np.zeros(int(2.6 * SR), np.float32)
    for k, (f, t0) in enumerate(((1318.5, 0.0), (1046.5, 0.42))):
        t = _tt(2.0)
        x = (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 6)) * np.exp(-t * 2.4)
        x *= np.minimum(1, t / 0.004)
        s = int(t0 * SR); out[s:s + len(x)] += x.astype(np.float32) * 0.18
    return reverb(out, wet=0.3, decay=0.9, size='room')

def breath(seed=0, d=1.5, a=1.0):
    """A soft exhale."""
    t = _tt(d)
    env = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 2 * np.exp(-t * 0.8)
    x = bandpass(sfx.noise(d, seed, 'pink'), 250, 1800) * env
    return (x * 0.5 * a).astype(np.float32)

def slurp(seed=0, d=1.3):
    """A sip through a wide straw, pearls knocking."""
    rng = np.random.default_rng(seed)
    t = _tt(d)
    gate = (np.sin(2 * np.pi * 13 * t + rng.uniform(0, 6)) > -0.2).astype(np.float32)
    x = bandpass(sfx.noise(d, seed), 900, 3800) * env_fade(np.ones(len(t), np.float32), 0.15, 0.3) * (0.5 + 0.5 * gate)
    for k in range(6):
        s = int(rng.uniform(0.1, d - 0.2) * SR); tt = _tt(0.05)
        pop = np.sin(2 * np.pi * rng.uniform(300, 600) * tt) * np.exp(-tt * 80)
        x[s:s + len(pop)] += pop.astype(np.float32) * 0.2
    return (x * 0.18).astype(np.float32)

def taps(times, seed=0):
    """Phone keyboard taps at the given offsets (s)."""
    rng = np.random.default_rng(seed)
    d = (max(times) if times else 0) + 0.2
    out = np.zeros(int(d * SR), np.float32)
    for tt in times:
        c_ = sfx.click(int(rng.integers(0, 1e6)), rng.uniform(1400, 2200), 0.025, rng.uniform(0.12, 0.2))
        s = int(tt * SR); out[s:s + len(c_)] += c_[:len(out) - s]
    return out

def creak(seed=0, d=0.7):
    """Vinyl booth seat as someone sits / stands."""
    rng = np.random.default_rng(seed)
    t = _tt(d)
    f = 140 + 60 * np.sin(np.pi * t / d)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * (rng.random(len(t)) < 0.35)
    x = lowpass(tone, 1200) * np.sin(np.pi * t / d) + bandpass(sfx.noise(d, seed), 300, 2500) * 0.2 * np.sin(np.pi * t / d)
    return (x * 0.25).astype(np.float32)

def tinnitus(d=2.5, f=4100):
    t = _tt(d)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t * 1.3) * np.minimum(1, t / 0.01)
    return (x * 0.05).astype(np.float32)

def muffle(x, f=600):
    return lowpass(lowpass(x, f), f)

# =====================================================================
# staging helpers
# =====================================================================
def cam(c, k, fx, fy, w=BW, h=H):
    """Camera: scale k about the focus point (fx, fy), which lands at the frame centre."""
    c.translate(w / 2, h / 2); c.scale(k, k); c.translate(-fx, -fy)

def camkeys(keys, T, k0=1.0, f0=(BW / 2, H / 2)):
    """keys: [(t_start, dur, k, fx, fy)] — from t_start the camera eases over dur to (k, fx, fy)."""
    k, fx, fy = k0, f0[0], f0[1]
    for (ts, du, k1, x1, y1) in sorted(keys):
        if T <= ts:
            break
        u = ease_in_out((T - ts) / du) if du > 0 else 1.0
        k, fx, fy = k + (k1 - k) * u, fx + (x1 - fx) * u, fy + (y1 - fy) * u
    return k, fx, fy

class Shots:
    """Consecutive pages. Each fades in over `xf` on top of the previous one, which stays opaque
    underneath until the new page is fully in (a clean crossfade, no dip to black)."""
    def __init__(self, sc):
        self.sc, self.items = sc, []

    def add(self, fn, start, xf=0.6, name=''):
        self.items.append((fn, start, xf, name))
        return start

    def commit(self, end_fade=1.2):
        items = sorted(self.items, key=lambda x: x[1])
        for i, (fn, st, xf, name) in enumerate(items):
            if i + 1 < len(items):
                nst, nxf = items[i + 1][1], items[i + 1][2]
                self.sc.layer(fn, st, nst + nxf + 0.04, fin=xf, fout=0.0, name=name)
            else:
                self.sc.layer(fn, st, None, fin=xf, fout=end_fade, name=name)

def keyed(keys, T):
    """keys: [(t, x, face)] — piecewise moves with a lifted arc; returns (x, face, lift)."""
    if T <= keys[0][0]:
        return keys[0][1], keys[0][2], 0.0
    for (t0, x0, f0), (t1, x1, f1) in zip(keys, keys[1:]):
        if t0 <= T < t1:
            if x0 == x1 and f0 == f1:
                return x0, f0, 0.0
            u = ease_in_out((T - t0) / (t1 - t0))
            return x0 + (x1 - x0) * u, (f0 if u < 0.5 else f1), 34 * math.sin(math.pi * u)
    return keys[-1][1], keys[-1][2], 0.0

def draw_hand_filled(c, drawing, poly, x, y, a=1.0, day=DAY, rot=0.0):
    """Hands belong to the pencil world: fill them with sketchbook paper so they hide what is under."""
    c.save(); c.translate(x, y)
    if rot:
        c.rotate(rot)
    path = skia.Path(); path.moveTo(*poly[0])
    for q in poly[1:]:
        path.lineTo(*q)
    path.close()
    c.drawPath(path, paint(O.b_paper(day), a))
    drawing.draw(c, 1.0, a)
    c.restore()

@functools.lru_cache(maxsize=4)
def hand_fill_poly(kind):
    if kind == 'push':
        return hand_poly(0, 0, 1.0, math.pi, flip=True, arm_len=420)
    if kind == 'hold':
        return hand_poly(0, 0, 1.0, math.radians(32), flip=False, arm_len=320)
    return hand_poly(0, 0, 1.0, 0.0, flip=False, arm_len=420)

@functools.lru_cache(maxsize=2)
def xiao_push_hand():
    d = Drawing(seed=660, width=1.6)
    hand(d, 0, 0, 1.0, math.pi, flip=True, arm='bare', arm_len=420)
    return d

@functools.lru_cache(maxsize=2)
def zhang_hold_hand():
    d = Drawing(seed=661, width=1.6)
    hand(d, 0, 0, 1.0, math.radians(32), flip=False, arm='cuff', arm_len=320)
    return d

@functools.lru_cache(maxsize=1)
def copy_tooth():
    """A faint photocopy-paper texture for the contract copy (multiplied over it in close-up)."""
    src = paper(O.CONTRACT_W, O.CONTRACT_H, (252, 251, 248), 77, 0.5, 0.35)
    surf = skia.Surface(O.CONTRACT_W, O.CONTRACT_H)
    surf.getCanvas().drawImage(src, 0, 0)
    return surf.makeImageSnapshot()

def _table_lines(cc):
    cc.clear(col((0, 0, 0), 0.0))
    smudge(cc, [(110, 90), (230, 90), (240, 210), (100, 210)], (201, 150, 96), 0.22, 30)
    table_top('d60').draw(cc, 1.0)

def _vignette_img(cc):
    cc.clear(col((0, 0, 0), 0.0))
    vignette(cc, BW, H, 1.0)

YUE_CAPTION = [('字号比正文小了整整一号。', 0.0), ('不是疏忽。', 2.3), ('是设计。', 4.0)]

def segmented_caption(c, t, w, h, segs, rgb=GRAPHITE, size=40, y=None):
    """One caption line built up segment by segment (positions fixed from the full line)."""
    full = ''.join(sg for sg, _ in segs)
    tr = 0.1
    x = w / 2 - text_width(full, 'serif-light', size, tr) / 2
    y = h - 110 if y is None else y
    for sg, t0 in segs:
        a = smooth((t - t0) / 0.7)
        text(c, sg, x, y, 'serif-light', size, rgb, a, tracking=tr)
        x += text_width(sg, 'serif-light', size, tr) + tr * size

def _alpha_paint(a):
    p = skia.Paint(); p.setAlphaf(max(0.0, min(1.0, a)))
    return p

def say_at_word(start, end, text, word):
    """Approximate time a word is spoken inside a line (by character position)."""
    clean = text.replace('——', '').replace('……', '')
    i = clean.find(word)
    return start + (end - start) * (i / max(1, len(clean)))

# =====================================================================
# the scene
# =====================================================================
def build():
    sc = Scene('s04_d60', kind='B', title='第四场【倒计时】')
    shots = Shots(sc)

    # ---------- countdown card ----------
    sc.wait(0.4)
    t0 = sc.t
    def card(c, t, L):
        paper_bg(c, DAY)
        O.countdown_card(c, DAY, t)
    shots.add(card, t0, 0.8)
    sc.sfx(sfx.pencil(3.0, 45), at=t0 + 0.6, gain=-9)
    sc.wait(4.6)

    # ---------- the booth ----------
    t_w1 = sc.t
    def w1(c, t, L):
        T = L.T
        u = smooth((T - t_w1) / 70.0)
        paper_bg(c, DAY)
        c.save(); cam(c, 1.0 + 0.05 * u, 720 + 30 * u, 540 - 22 * u)
        pr = ease_out((T - t_w1) / 3.0)
        draw_booth(c, L, progress=pr, static=(pr >= 1.0), linear=True)
        c.restore()
    shots.add(w1, t_w1, 0.9)
    cafe = sfx.cafe(120, 46)
    sc.wait(3.4)
    sc.narr('这不是什么阴暗的地下室。这是一个看起来完全正常的地方。',
            sub_text='这不是什么阴暗的地下室——这是一个看起来完全正常的地方。', post=0.6)
    sc.caption('肖强，二十三岁。干净的 Polo 衫，无框眼镜。看起来像一个在自习的研究生。', dur=4.8)
    sc.wait(5.2)
    sc.say('xiao', '坐坐坐，别站着。', post=0.1)
    sc.sfx(creak(47, 0.8), at=sc.t, gain=-8, pan=0.1)
    sc.sfx(sfx.paper_rustle(48, 0.6), at=sc.t + 0.3, gain=-16)
    sc.wait(0.35)
    sc.say('xiao', '你是看到传单过来的吧？', post=0.5)

    # ---------- reverse: his hands, the card ----------
    t_z1 = sc.t - 0.2
    t_card = t_z1 + 0.9
    def z1(c, t, L):
        T = L.T
        u = ease_out(ramp(T, t_card, t_card + 1.0))
        cx = 720 + (600 - 720) * u; cy = 520 + (330 - 520) * u
        draw_zhang_hands(c, L, 0, card=(cx, cy, 1.0))
    shots.add(z1, t_z1, 0.5)
    sc.sfx(slide(49, 0.8, 0.8), at=t_card, gain=-10)
    sc.wait(0.6)
    sc.say('zhang', '嗯……是名片。', tts='嗯，是名片。', note='小声', speed=0.9, gain=-4, post=0.6)

    shots.add(w1, sc.t - 0.2, 0.4)
    sc.say('xiao', '一样一样。', post=0.3)
    sc.say('xiao', '什么情况，说说看？', post=0.45)
    sc.say('xiao', '放心，就咱俩，你说什么都不会有第三个人知道。', post=0.8)

    def z1b(c, t, L):
        draw_zhang_hands(c, L, 0, card=(600, 330, 1.0), dx=4 * math.sin(L.T * 0.9))
    shots.add(z1b, sc.t - 0.3, 0.4)
    sc.say('zhang', '就是……最近手头紧，想借点钱。', tts='就是，最近手头紧，想借点钱。', speed=0.92, gain=-3, post=0.4, variant=1)
    sc.say('zhang', '四千就够了。', speed=0.9, gain=-3, post=0.7)

    shots.add(w1, sc.t - 0.3, 0.4)
    sc.say('xiao', '四千太少了，', note='带笑', post=0.15)
    sc.say('xiao', '我们这边操作有成本的，六千起步。', post=0.35)
    sc.say('xiao', '你就借六千呗，多出来的留着应急。', post=0.3)
    sc.say('xiao', '大学生嘛，用钱的地方多。', post=0.9)

    def z1c(c, t, L):
        draw_zhang_hands(c, L, 1, card=(600, 330, 1.0))
    shots.add(z1c, sc.t - 0.3, 0.5)
    sc.wait(0.3)
    sc.say('zhang', '……那六千。', tts='那，六千。', speed=0.88, gain=-3, post=0.45)
    sc.say('zhang', '借半年行吗？', speed=0.9, gain=-3, post=0.6)

    shots.add(w1, sc.t - 0.3, 0.4)
    sc.say('xiao', '没问题。利息百分之十五。', post=0.35)
    sc.say('xiao', '很低了，你去外面问问，比这低的没有。', post=0.7)

    # ---------- the sum he does in his head ----------
    t_ar = sc.t
    ar_len = 10.2
    def arith(c, t, L):
        tip = draw_arithmetic(c, t - 0.6, L, cps=8.0)
        if tip is not None and t < ar_len - 1.2:
            O.draw_pencil(c, tip[0], tip[1], smooth((t - 0.2) / 0.4) * smooth((ar_len - 1.2 - t) / 0.4))
    shots.add(arith, t_ar, 0.7)
    sc.amb(cafe, t_w1 - 0.6, t_ar + 0.6, gain=3, fin=1.2, fout=0.8)
    sc.amb(muffle(cafe[:, 0] if cafe.ndim == 2 else cafe, 500), t_ar, t_ar + ar_len, gain=-2, fin=0.6, fout=0.8)
    sc.sfx(sfx.pencil(7.6, 50, rate=2.2), at=t_ar + 0.6, gain=-8)
    sc.wait(ar_len)

    # ---------- the contract ----------
    t_w1d = sc.t - 0.3
    shots.add(w1, t_w1d, 0.5)
    sc.say('xiao', '合同我打好了，你看看没问题就签字。', post=0.2)

    t_ct = sc.t
    PXc, PYc, Sc = 416, 46, 0.98
    Lc = O.contract_layout(Sc)
    marks = {}
    zoom = {}
    env = {}
    sign_t = {}
    camk = []
    SIGN_F = (PXc + (58 + 450) * Sc + 40, PYc + Lc['sign_y'] - 14)
    CLAUSE_F = (PXc + 250 * Sc, PYc + (Lc['ys'][5] + Lc['ys'][8]) / 2 - 6)
    def ct(c, t, L):
        T = L.T
        # camera: in to the signature line and back
        c.save()
        cam(c, *camkeys(camk, T))
        draw_table_top(c, L, DAY, 'd60', linear=True)
        u = ease_out(ramp(T, t_ct, t_ct + 1.5))
        py = -1000 + (PYc + 1000) * u
        rot = -3.2 + 2.4 * u
        c.save(); c.rotate(rot, PXc + 310 * Sc, py + 440 * Sc)
        sg = ramp(T, sign_t.get('s', 1e9), sign_t.get('s', 1e9) + 3.0)
        O.contract_page(c, PXc, py, s=Sc, sign=sg)
        for key, tk in marks.items():
            contract_mark(c, PXc, py, Sc, key, ease_out((T - tk) / 0.55))
        # his left hand holding the page while he signs
        ha = smooth((T - sign_t.get('s', 1e9) + 0.9) / 0.5) * smooth((sign_t.get('s', 1e9) + 4.0 - T) / 0.5)
        if ha > 0:
            draw_hand_filled(c, zhang_hold_hand(), hand_fill_poly('hold'), PXc + 60, PYc + Lc['sign_y'] + 150 - 20 * ha, ha)
        pa = smooth((T - sign_t.get('s', 1e9) + 0.6) / 0.4) * smooth((sign_t.get('s', 1e9) + 3.7 - T) / 0.4)
        if pa > 0:
            tx, ty = sign_tip(Sc, clamp(sg))
            draw_pen(c, PXc + tx, py + ty, pa, ang=-38)
        c.restore()
        # Xiao's hand pushing the page across
        lift = ease_in_out(ramp(T, t_ct + 1.6, t_ct + 2.5))
        if T < t_ct + 2.6:
            draw_hand_filled(c, xiao_push_hand(), hand_fill_poly('push'), PXc + 430, py + 10 - 640 * lift)
        # the envelope: pushed over, then taken
        if 'in' in env and T > env['in']:
            ue = ease_out(ramp(T, env['in'], env['in'] + 1.2))
            ut = ease_in_out(ramp(T, env['take'], env['take'] + 0.9))
            ey = -330 + (560 + 330) * ue + 700 * ut
            envelope(c, 760, ey, 1.0, 0.04 - 0.05 * ut)
            lift2 = ease_in_out(ramp(T, env['in'] + 1.3, env['in'] + 2.1))
            if T < env['in'] + 2.2:
                draw_hand_filled(c, xiao_push_hand(), hand_fill_poly('push'), 980, ey - 40 - 640 * lift2)
        c.restore()
        glow(c, 620, 420, 900, TEA, 0.12)
        # while the camera is close on the clauses, a soft wash of paper under the narration
        kk, _, _ = camkeys(camk, T)
        wa = 0.82 * clamp((kk - 1.05) / 0.4) * (1 - smooth((T - (zoom.get('in', 1e9) + 0.3)) / 0.8))
        if wa > 0:
            sh = skia.GradientShader.MakeLinear([(0, L.h - 250), (0, L.h - 60)], [col(O.b_paper(DAY), 0), col(O.b_paper(DAY), wa)])
            c.drawRect(skia.Rect(0, L.h - 250, L.w, L.h), skia.Paint(Shader=sh))
    shots.add(ct, t_ct - 0.2, 0.45)
    sc.sfx(slide(51, 1.4, 1.0, 500, 3800), at=t_ct + 0.1, gain=-6)
    sc.wait(2.6)
    sc.narr('他不是没有看——他看了。', tts='他不是没有看，他看了。', post=0.5)
    line = '但他看到了他以为自己应该看到的东西：金额，利率，期限。'
    camk.append((sc.t - 0.2, 2.2, 1.55, CLAUSE_F[0], CLAUSE_F[1]))
    s0, s1 = sc.narr(line, post=0.9)
    marks['amount'] = say_at_word(s0, s1, line, '金额') - 0.05
    marks['rate'] = say_at_word(s0, s1, line, '利率') - 0.05
    marks['term'] = say_at_word(s0, s1, line, '期限') - 0.05
    for k_, tk in marks.items():
        sc.sfx(sfx.pencil(0.5, 52 + len(k_), rate=4), at=tk, gain=-18)
    sc.narr('数字和肖强说的一致。', post=0.2)
    sc.sfx(breath(53, 1.6), at=sc.t, gain=-12)
    sc.wait(1.8)
    zoom['in'] = sc.t
    camk.append((sc.t, 1.4, 1.95, SIGN_F[0], SIGN_F[1]))
    sc.wait(1.5)
    sign_t['s'] = sc.t
    sc.sfx(sfx.pen_on_paper(3.0, 54), at=sc.t, gain=-6)
    sc.wait(3.6)
    zoom['out'] = sc.t
    camk.append((sc.t, 1.3, 1.0, BW / 2, H / 2))
    sc.wait(1.1)
    env['in'] = sc.t
    sc.sfx(slide(55, 1.1, 0.9, 400, 2600), at=sc.t + 0.05, gain=-8)
    sc.say('xiao', '六千，你数数。', post=0.35)
    sc.say('xiao', '以后缺钱尽管找我。', post=0.5)
    env['take'] = sc.t
    sc.sfx(slide(56, 0.9, 0.9, 500, 3000), at=sc.t, gain=-9)
    sc.wait(1.1)

    # ---------- he stands, bows ----------
    t_b = sc.t - 0.2
    bow = {}
    def bowshot(c, t, L):
        T = L.T
        c.drawImage(bow_background(DAY), 0, 0)
        glow(c, 720 - (XC - LAMP_X) * 1.1, 60 + LAMP_Y * 1.1, 520, TEA, 0.25)
        k = 0.0
        if 'at' in bow:
            k = ease_in_out(ramp(T, bow['at'], bow['at'] + 0.8)) - ease_in_out(ramp(T, bow['at'] + 1.5, bow['at'] + 2.4))
        draw_silhouette(c, k, 1.0, 0)
    shots.add(bowshot, t_b, 0.35)
    sc.sfx(creak(57, 0.9), at=t_b, gain=-7)
    sc.sfx(sfx.paper_rustle(58, 0.7), at=t_b + 0.3, gain=-14)
    sc.wait(1.3)
    bs, be = sc.say('zhang', '谢谢强哥。', speed=0.92, gain=-2, post=1.2)
    bow['at'] = bs + 0.15
    sc.say('xiao', '别客气。帮你们忙嘛。', post=0.4)

    # ---------- his shoes: 对了—— ----------
    t_s = sc.t - 0.1
    FL = 820
    shoe_keys = {}
    def shoes_shot(c, t, L):
        T = L.T - t_s
        paper_bg(c, DAY)
        under_table().draw(c, 1.0)
        glow(c, 900, 300, 700, TEA, 0.18)
        xf, ff, lf = keyed(shoe_keys['far'], T)
        xn, fn_, ln = keyed(shoe_keys['near'], T)
        sneaker_at(c, xf, FL - 20, ff, lf, 1.42)
        sneaker_at(c, xn, FL + 10, fn_, ln, 1.5)
    shots.add(shoes_shot, t_s, 0.4)
    shoe_keys['near'] = [(0.0, 780, 1), (0.7, 780, 1), (1.25, 640, -1)]
    shoe_keys['far'] = [(0.0, 560, 1)]
    sc.sfx(sfx.footsteps(1, 0.5, 59, a=0.7), at=t_s + 1.2, gain=-12)
    sc.at(t_s + 1.35)
    sc.say('xiao', '对了——', tts='对了。', post=1.3)
    sc.say('xiao', '这事你就别跟室友说了。', note='语气不变，带着微笑', post=0.35)
    sc.say('xiao', '借钱嘛，说出去不好听。', post=0.45)
    sc.say('xiao', '换个手机、买两件衣服，就说家里给的。', post=0.3)
    sc.say('xiao', '谁也不用知道。', post=1.4)
    sc.say('zhang', '……嗯。', tts='嗯。', gain=-5, speed=0.9, post=1.0)
    tg = sc.t - t_s
    shoe_keys['far'] += [(tg, 560, 1), (tg + 0.55, 300, -1), (tg + 1.2, 300, -1), (tg + 1.75, -120, -1), (tg + 2.4, -120, -1), (tg + 2.95, -600, -1)]
    shoe_keys['near'] += [(tg + 0.6, 640, -1), (tg + 1.15, 80, -1), (tg + 1.8, 80, -1), (tg + 2.35, -400, -1)]
    for k, dt in enumerate((0.55, 1.15, 1.75, 2.35, 2.95)):
        sc.sfx(sfx.footstep(60 + k, 0.8), at=t_s + tg + dt, gain=-11)
    sc.sfx(sfx.footsteps(3, 0.6, 66, a=0.4), at=t_s + tg + 3.5, gain=-18, fout=0.8)
    sc.wait(4.2)
    sc.sfx(chime(67), at=sc.t - 0.4, gain=-12, pan=-0.4)

    # ---------- Xiao alone: leans back, a sip, the phone ----------
    t_w2 = sc.t
    def w2(c, t, L):
        T = L.T
        u = ease_in_out(ramp(T, t_w2 + 0.4, t_w2 + 1.8))
        draw_booth(c, L, progress=1.0, xiao_s=1.0 - 0.035 * u, xiao_dy=-26 * u, static=(u <= 0.0 or u >= 1.0))
    shots.add(w2, t_w2, 0.5)
    sc.sfx(creak(68, 1.0), at=t_w2 + 0.4, gain=-9)
    sc.wait(3.2)
    t_sip = sc.t
    def sip(c, t, L):
        draw_cup_insert(c, L, ease_in_out(ramp(L.T, t_sip + 0.6, t_sip + 2.6)), t)
    shots.add(sip, t_sip, 0.4)
    sc.sfx(slurp(69, 1.8), at=t_sip + 0.7, gain=-8)
    sc.wait(3.6)

    t_ph = sc.t
    lines_ = ['张朝阳　大一　6000', '家里条件差。', '不想让室友知道。']
    cps, gaps = 5.0, [1.0, 1.8, 0.0]
    def ph(c, t, L):
        phone_note(c, t - 0.7, L, lines_, cps, gaps)
    shots.add(ph, t_ph, 0.5)
    tt, times = 0.7, []
    for s_, g in zip(lines_, gaps):
        for k in range(len(s_)):
            times.append(tt + k / cps + 0.03 * math.sin(k * 3.1))
        tt += len(s_) / cps + g
    sc.sfx(taps(times, 70), at=t_ph, gain=-10)
    sc.wait(tt + 1.6)

    # ---------- the copy left on the table: push in along line four ----------
    t_p = sc.t
    PX2, PY2, S2 = 410, 90, 1.0
    L2 = O.contract_layout(S2)
    ly = PY2 + L2['rate_y'] - 6
    x_start = PX2 + L2['mx'] + 70
    x_yue = PX2 + L2['yue'][0] - 6
    P_LEN = 27.2
    t_red = 22.8
    def push(c, t, L):
        a1 = ease_in_out(ramp(t, 2.2, 6.4))
        a2 = ease_in_out(ramp(t, 6.4, 15.0))
        a3 = ease_in_out(ramp(t, 15.0, 18.0))
        fx = (PX2 + 310) + (x_start - PX2 - 310) * a1 + (x_yue - x_start) * a2
        fy = (PY2 + 438) + (ly - PY2 - 438) * a1
        k = 1.0 + 2.3 * a1 + 1.1 * a2 + 3.6 * a3
        paper_glow(c, DAY, ((620, 420, 900, TEA, 0.20),))
        c.save(); cam(c, k, fx, fy)
        la = clamp(1.0 - (k - 2.0) / 2.5)
        if la > 0:
            c.drawImage(baked(('tablelines',), _table_lines), 0, 0, LINEAR, _alpha_paint(la))
        O.contract_page(c, PX2, PY2, s=S2, sign=1.0, yue_red=smooth((t - t_red) / 0.9))
        pp = skia.Paint(BlendMode=skia.BlendMode.kMultiply); pp.setAlphaf(0.5)
        c.save(); c.clipRect(skia.Rect.MakeXYWH(PX2, PY2, O.CONTRACT_W * S2, O.CONTRACT_H * S2))
        c.drawImage(copy_tooth(), PX2, PY2, skia.SamplingOptions(skia.FilterMode.kLinear), pp)
        c.restore()
        c.restore()
        if a3 > 0:
            c.drawImage(baked(('vig',), _vignette_img), 0, 0, skia.SamplingOptions(), _alpha_paint(0.25 * a3))
        segmented_caption(c, t - 18.6, L.w, L.h, YUE_CAPTION)
    shots.add(push, t_p, 0.8)
    sc.amb(cafe, t_ar + ar_len - 0.6, t_p + 9.0, gain=3, fin=1.0, fout=6.0)
    sc.amb(sfx.drone(P_LEN - 3, 49.0, 71), t_p + 4.0, t_p + t_red + 0.4, gain=-17, fin=4.0, fout=0.5)
    sc.sfx(sfx.paper_rustle(72, 1.2), at=t_p + t_red, gain=-24)
    sc.at(t_p + P_LEN)
    shots.commit(end_fade=1.4)
    def ctl(c, t, L):
        L.scene.sub_color = WHITE if (t_b + 0.2 <= L.T < t_s + 0.2) else None
    sc.layer(ctl, 0, None, z=-100, name='ctl')
    sc.finish(tail=0.2)
    return sc

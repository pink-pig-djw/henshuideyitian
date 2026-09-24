"""第六场【倒计时】 外景 校园 ／ 内景 宿舍 日 — 距自杀还有 42 天.

New phone, new hoodie: on the plane-tree avenue he is one back among many backs. A stranger's
number. The one who stops walking is him. The contract from the bottom of the cabinet; a finger
along line four; 「月」. The call back, the busy tone, and the shadow on the wall that does not
move. The camera pulls back out through the window: nobody is going to come to this room."""
import math, functools
import numpy as np
import skia
from film.config import *
from film.gfx import *
from film.timeline import Scene
from film.sketch import Drawing, smudge
from film.audio import reverb, lowpass, highpass, bandpass, env_fade, phone as phone_fx
from film import objects as O, sfx

DAY = 42
PAPER = O.b_paper(DAY)
BRIGHT = mix(PAPER, (255, 253, 247), 0.30)
SAMP = skia.SamplingOptions(skia.FilterMode.kLinear, skia.MipmapMode.kLinear)


def solid(c, pts, rgb, a=1.0):
    """Opaque underlay (Drawing fills are grained by the paper tooth, so they let lines through)."""
    path = skia.Path(); path.moveTo(*pts[0])
    for q in pts[1:]:
        path.lineTo(*q)
    path.close()
    c.drawPath(path, paint(rgb, a))


def _smooth_poly(pts, n=3):
    P = np.asarray(pts, np.float64)
    for _ in range(n):
        Q = []
        for i in range(len(P)):
            a, b = P[i], P[(i + 1) % len(P)]
            Q += [0.75 * a + 0.25 * b, 0.25 * a + 0.75 * b]
        P = np.array(Q)
    return [tuple(q) for q in P]


def bright_page(c, k=0.30):
    O.b_background(c, DAY)
    c.drawRect(skia.Rect(0, 0, BW, H), paint((255, 253, 247), k))


# =====================================================================
# THE AVENUE — plane trees, a stream of backs in the same hoodie
# =====================================================================
VPX, VPY = 720.0, 430.0
GROUND = 640.0          # feet y = VPY + GROUND * f   (f = 1 / distance)
PATH = 640.0            # path half-width at f = 1


def gp(u, f):
    return VPX + u * PATH * f, VPY + GROUND * f


@functools.lru_cache(maxsize=1)
def avenue():
    d = Drawing(seed=4201, width=1.4, alpha=0.7)
    # far building closing the avenue (the teaching block)
    bx0, bx1, by0 = VPX - 330, VPX + 330, VPY - 120
    d.line(bx0, VPY + 4, bx1, VPY + 4, w=1.0, a=0.45)
    d.rect(bx0, by0, bx1 - bx0, VPY + 4 - by0, w=1.0, a=0.42)
    for r in range(3):
        for k in range(12):
            d.rect(bx0 + 22 + k * 53, by0 + 18 + r * 32, 30, 18, w=0.7, a=0.28, passes=1)
    # path edges and kerbs
    for u, a in ((-1.0, 0.55), (1.0, 0.55), (-1.1, 0.3), (1.1, 0.3)):
        x0, y0 = gp(u, 1.5); x1, y1 = gp(u, 0.03)
        d.line(x0, y0, x1, y1, w=1.3, a=a)
    # paving joints, fading into the distance
    for f in (0.95, 0.72, 0.56, 0.44, 0.35, 0.28, 0.22, 0.17, 0.13):
        x0, y = gp(-1.0, f); x1, _ = gp(1.0, f)
        d.line(x0, y, x1, y, w=0.7, a=0.18 + 0.1 * f, passes=1)
    # plane trees on both sides (drawn nearer first so they read as a canopy)
    for side in (-1, 1):
        for j, f in enumerate((0.92, 0.60, 0.42, 0.30, 0.215, 0.155, 0.11)):
            x, y = gp(side * 1.42, f)
            t = O.tree(seed=430 + j * 2 + (side > 0), x=x, y=y, s=2.1 * f, leaves=True, depth=6)
            d.extend(t)
    return d


@functools.lru_cache(maxsize=1)
def avenue_img():
    """The avenue is static: render its thousands of strokes once."""
    surf = skia.Surface(BW, H)
    c = surf.getCanvas(); c.clear(skia.ColorTRANSPARENT)
    avenue().draw(c, 1.0, 0.55)
    return surf.makeImageSnapshot()


def _fig_polys(pose):
    """Silhouette of a student from behind (feet at 0,0; height 440)."""
    head = [(27 * math.cos(a), -395 + 31 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 30)]
    torso = [(-62, -176), (-66, -300), (-72, -334), (-40, -350), (40, -350), (72, -334), (66, -300), (62, -176)]
    legs = [(-54, -178), (-48, -10), (-8, -10), (0, -150), (8, -10), (48, -10), (54, -178)]
    arms = [[(-72, -334), (-86, -290), (-88, -200), (-82, -150), (-64, -152), (-64, -300)],
            [(72, -334), (86, -290), (88, -200), (82, -150), (64, -152), (64, -300)]]
    return head, torso, legs, arms


def _sleeve(d, side, raised=False):
    """Arm hanging at the side (or raised to the ear with a phone), seen from behind."""
    k = side
    if not raised:
        d.curve([(72 * k, -334), (84 * k, -300), (88 * k, -230), (84 * k, -178)], w=2.0)
        d.curve([(64 * k, -300), (66 * k, -240), (66 * k, -178)], w=1.4, a=0.7)
        d.line(84 * k, -180, 66 * k, -178, w=1.3, a=0.8)
        d.curve([(83 * k, -178), (82 * k, -160), (74 * k, -152), (67 * k, -160), (67 * k, -178)], w=1.4)
    else:
        d.curve([(72 * k, -334), (98 * k, -306), (110 * k, -262)], w=2.0)
        d.curve([(64 * k, -306), (82 * k, -286), (92 * k, -262)], w=1.3, a=0.7)
        d.curve([(110 * k, -262), (86 * k, -318), (50 * k, -378)], w=2.0)
        d.curve([(92 * k, -262), (74 * k, -306), (40 * k, -366)], w=1.3, a=0.7)
        d.ellipse(36 * k, -386, 12, 15, w=1.6)


@functools.lru_cache(maxsize=16)
def walker_img(seed, pose='walk', backpack=False):
    """A back in a hoodie, drawn once into an image (feet at bottom centre)."""
    d = Drawing(seed=seed, width=2.2, alpha=0.85, wobble=1.1)
    head, torso, legs, arms = _fig_polys(pose)
    fillc = BRIGHT
    d.fill(legs, fillc, 0.97); d.fill(torso, fillc, 0.97); d.fill(head, fillc, 0.97)
    for i, a in enumerate(arms):
        if pose == 'phone' and i == 1:
            d.fill([(72, -334), (100, -306), (112, -262), (90, -258), (70, -300), (44, -372), (28, -392), (50, -380)], fillc, 0.97)
        else:
            d.fill(a, fillc, 0.97)
    # legs and shoes
    d.line(-54, -176, -46, -16); d.line(-8, -170, -12, -16)
    d.line(8, -170, 12, -16); d.line(54, -176, 46, -16)
    d.ellipse(-29, -9, 23, 9); d.ellipse(29, -9, 23, 9)
    # hoodie body
    d.curve([(-40, -350), (-66, -338), (-66, -300), (-64, -240), (-62, -180)])
    d.curve([(40, -350), (66, -338), (66, -300), (64, -240), (62, -180)])
    d.line(-62, -184, 62, -184, w=1.5); d.line(-62, -176, 62, -176, w=1.2, a=0.6)
    d.hatch([(-60, -326), (60, -326), (62, -188), (-62, -188)], angle=62, spacing=10, a=0.32)
    # the hood lying on the back
    d.curve([(-34, -352), (-38, -326), (-17, -304), (17, -304), (38, -326), (34, -352)], w=1.8)
    d.curve([(-24, -346), (-13, -320), (13, -320), (24, -346)], w=1.0, a=0.5)
    # head from behind: hair
    d.ellipse(0, -395, 27, 31, w=2.0)
    d.hatch([(-26, -410), (0, -427), (26, -410), (24, -375), (0, -366), (-24, -375)], angle=80, spacing=4.5, a=0.7)
    _sleeve(d, -1)
    _sleeve(d, 1, raised=(pose == 'phone'))
    if backpack:
        bp = [(-44, -322), (44, -322), (50, -300), (50, -214), (40, -206), (-40, -206), (-50, -214), (-50, -300)]
        d.fill(bp, fillc, 0.98)
        d.poly(bp, closed=True, w=1.8)
        d.curve([(-40, -262), (0, -270), (40, -262)], w=1.0, a=0.6)
        d.curve([(-12, -322), (0, -334), (12, -322)], w=1.3)
        d.curve([(-40, -322), (-50, -340), (-40, -350)], w=1.4)
        d.curve([(40, -322), (50, -340), (40, -350)], w=1.4)
        d.hatch([(-46, -258), (46, -258), (48, -214), (-48, -214)], angle=-20, spacing=7, a=0.35)
    surf = skia.Surface(300, 480)
    c = surf.getCanvas(); c.clear(skia.ColorTRANSPARENT)
    c.translate(150, 468)
    for poly in (legs, torso, head) + tuple(arms if pose != 'phone' else arms[:1]):
        solid(c, poly, BRIGHT)
    if pose == 'phone':
        solid(c, [(72, -334), (100, -306), (112, -262), (90, -258), (70, -300), (44, -372), (28, -392), (50, -380)], BRIGHT)
    if backpack:
        solid(c, [(-44, -322), (44, -322), (50, -300), (50, -214), (40, -206), (-40, -206), (-50, -214), (-50, -300)], BRIGHT)
    d.draw(c, 1.0)
    return surf.makeImageSnapshot().withDefaultMipmaps()


def draw_walker(c, img, f, u, bob=0.0, tilt=0.0, a=1.0):
    x, y = gp(u, f)
    s = 420 * f / 440
    c.save()
    c.translate(x, y - bob * s)
    if tilt:
        c.rotate(tilt)
    p = None
    if a < 0.999:
        p = skia.Paint(); p.setAlphaf(max(0.0, a))
    c.drawImageRect(img, skia.Rect(-150 * s, -468 * s, 150 * s, 12 * s), SAMP, p)
    c.restore()


def travelled(t, a, b):
    """Integral of a speed profile that is 1 before a and eases to 0 between a and b."""
    if t <= a:
        return t
    if t >= b:
        return a + (b - a) / 2
    return a + (t - a) - (t - a) ** 2 / (2 * (b - a))


# =====================================================================
# THE NEW PHONE (in his hand)
# =====================================================================
PHX, PHY, PHW, PHH = 575, 170, 290, 600


@functools.lru_cache(maxsize=1)
def hand_phone():
    d = Drawing(seed=4260, width=2.0, alpha=0.85)
    x, y, w, h = PHX, PHY, PHW, PHH
    # palm & wrist behind the phone
    palm = [(x + 10, y + h - 150), (x - 30, y + h - 40), (x - 10, y + h + 90), (x + 90, y + h + 330),
            (x + 330, y + h + 330), (x + w + 40, y + h + 60), (x + w + 30, y + h - 200)]
    d.fill(palm, BRIGHT, 1.0, smooth=True)
    d.curve([(x + 8, y + h - 140), (x - 30, y + h - 40), (x - 8, y + h + 90), (x + 90, y + h + 330)])
    d.curve([(x + w + 28, y + h - 210), (x + w + 44, y + h + 40), (x + w + 10, y + h + 200), (x + 330, y + h + 330)])
    # phone body: thin bezel, rounded
    r = 38
    pts = []
    for (cx, cy, a0) in [(x + w - r, y + r, -90), (x + w - r, y + h - r, 0), (x + r, y + h - r, 90), (x + r, y + r, 180)]:
        for k in range(9):
            th = math.radians(a0 + k * 90 / 8)
            pts.append((cx + r * math.cos(th), cy + r * math.sin(th)))
    d.fill(pts, (238, 238, 234), 1.0)
    d.poly(pts, closed=True, w=2.2)
    d.poly([(x + 12, y + 40), (x + w - 12, y + 40), (x + w - 12, y + h - 30), (x + 12, y + h - 30)], closed=True, w=1.0, a=0.5)
    d.ellipse(x + w / 2, y + 22, 7, 7, w=1.0, a=0.6)
    # four finger tips peeking round the right edge
    for k, fy in enumerate((y + 262, y + 322, y + 382, y + 440)):
        rx_, ry_ = 22 - k * 1.5, 27
        bump = [(x + w - 6 + rx_ * math.cos(a), fy + ry_ * math.sin(a)) for a in np.linspace(-math.pi / 2, math.pi / 2, 14)]
        d.fill(bump + [(x + w - 6, fy + ry_)], BRIGHT, 1.0)
        d.poly(bump, w=1.8)
        d.curve([(x + w + rx_ - 8, fy - 6), (x + w + rx_ - 4, fy + 4)], w=0.9, a=0.4, passes=1)
    # the thumb lying across the lower-left of the glass
    th = [(x - 26, y + h - 70), (x - 18, y + 520), (x + 12, y + 478), (x + 44, y + 470), (x + 58, y + 486),
          (x + 48, y + 512), (x + 16, y + 560), (x + 10, y + h - 80)]
    d.fill(th, BRIGHT, 1.0, smooth=True)
    d.curve(th, w=1.9)
    d.curve([(x + 30, y + 478), (x + 42, y + 490), (x + 38, y + 504)], w=1.0, a=0.5)
    return d


def screen_ui(c, mode, T, t_mode, a=1.0):
    """Crisp phone UI (printed light, not pencil). mode: 'ring' | 'call' | 'ended'."""
    x, y, w, h = PHX + 14, PHY + 42, PHW - 28, PHH - 74
    lit = 1.0
    glow(c, x + w / 2, y + h / 2, 520, (215, 225, 240), 0.35 * a * lit)
    c.drawRect(skia.Rect.MakeXYWH(x, y, w, h), paint((243, 246, 250), 0.96 * a))
    ink = (48, 50, 56)
    cx = x + w / 2
    if mode == 'ring':
        text(c, '来电', cx, y + 92, 'sans-light', 20, ink, a * 0.65, 'center', tracking=0.4)
        text(c, '171 3392 0576', cx, y + 150, 'sans-light', 30, ink, a, 'center', tracking=0.05)
        text(c, '未知号码', cx, y + 190, 'sans-light', 18, ink, a * 0.6, 'center', tracking=0.3)
        for k, lab in ((-1, '拒绝'), (1, '接听')):
            px = cx + k * 70
            c.drawCircle(px, y + h - 90, 28, paint(ink, a * 0.7, 1.4))
            text(c, lab, px, y + h - 40, 'sans-light', 15, ink, a * 0.6, 'center', tracking=0.2)
    elif mode == 'call':
        s = max(0, int(T - t_mode))
        text(c, '171 3392 0576', cx, y + 150, 'sans-light', 30, ink, a, 'center', tracking=0.05)
        text(c, f'00:{s:02d}', cx, y + 192, 'sans-light', 20, ink, a * 0.6, 'center', tracking=0.2)
    else:
        text(c, '171 3392 0576', cx, y + 150, 'sans-light', 30, ink, a * 0.55, 'center', tracking=0.05)
        text(c, '通话结束', cx, y + 196, 'sans-light', 20, ink, a * 0.8, 'center', tracking=0.3)
        text(c, '00:34', cx, y + 228, 'sans-light', 17, ink, a * 0.5, 'center', tracking=0.2)


def buzz_marks(c, T, a):
    """Pencil vibration marks either side of the ringing phone."""
    k = 0.5 + 0.5 * math.sin(T * 30)
    for side in (-1, 1):
        for j in range(3):
            r = 60 + j * 26
            cx = PHX + PHW / 2 + side * (PHW / 2 - 30)
            p = skia.Path()
            p.addArc(skia.Rect(cx - r, PHY + 60 - r, cx + r, PHY + 60 + r), -90 + side * 60 - 25, 50)
            c.drawPath(p, paint(GRAPHITE, a * (0.25 + 0.45 * k) * (1 - j * 0.25), 2.0))


# =====================================================================
# THE CABINET — bottom shelf
# =====================================================================
@functools.lru_cache(maxsize=1)
def cabinet():
    d = Drawing(seed=4270, width=1.9, alpha=0.8)
    # carcass
    d.line(330, -10, 330, 990); d.line(1130, -10, 1130, 990)
    d.line(310, 990, 1150, 990, w=2.2); d.line(310, 1030, 1150, 1030, w=1.4, a=0.6)
    d.line(330, 440, 1130, 440, w=2.0); d.line(338, 458, 1122, 458, w=1.0, a=0.5)
    d.line(730, -10, 730, 440, w=1.4, a=0.6)
    # the open door, swung towards us
    door = [(330, -10), (100, -60), (100, 1080), (330, 990)]
    d.poly(door, w=1.8)
    d.hatch([(330, 0), (110, -40), (110, 1060), (330, 980)], angle=84, spacing=12, a=0.3)
    d.ellipse(140, 520, 8, 22, w=1.4)
    # upper shelf: folded clothes
    for k in range(5):
        d.rect(390 + k * 3, 410 - k * 34, 250 - k * 4, 32, w=1.4)
    for k in range(3):
        d.rect(790 - k * 2, 410 - k * 38, 270, 36, w=1.4)
    d.hatch([(790, 300), (1060, 300), (1060, 440), (790, 440)], angle=0, spacing=9, a=0.25)
    # bottom shelf: dark depth, a shoebox, an old pile of clothes
    d.rect(780, 780, 300, 200, w=1.6); d.poly([(780, 780), (820, 740), (1110, 740), (1080, 780)], w=1.4)
    d.line(1110, 740, 1110, 950, w=1.2, a=0.6)
    return d


PILE_MOUND = [(356, 986), (360, 930), (388, 884), (440, 872), (470, 842), (540, 836), (590, 856), (640, 846),
              (700, 872), (730, 912), (744, 950), (748, 986)]


@functools.lru_cache(maxsize=1)
def pile():
    """Old clothes stuffed in the bottom of the cabinet: lumpy, a sleeve hanging out."""
    d = Drawing(seed=4271, width=1.9, alpha=0.8)
    mound = PILE_MOUND
    d.fill(mound, BRIGHT, 1.0, smooth=True)
    d.curve(mound)
    d.curve([(392, 930), (440, 905), (500, 915), (560, 890), (620, 900)], w=1.2, a=0.55)
    d.curve([(470, 846), (480, 880), (470, 910)], w=1.0, a=0.5)
    d.curve([(592, 858), (600, 890), (636, 912), (690, 920)], w=1.0, a=0.5)
    d.curve([(430, 960), (500, 948), (580, 962), (660, 950), (720, 962)], w=1.0, a=0.45)
    # a sleeve hanging over the front edge
    d.fill([(610, 960), (660, 958), (672, 1010), (626, 1016)], BRIGHT, 1.0)
    d.curve([(610, 958), (616, 990), (626, 1016)], w=1.6); d.curve([(660, 956), (666, 986), (672, 1010)], w=1.6)
    d.line(626, 1016, 672, 1010, w=1.4)
    d.hatch([(372, 960), (392, 900), (470, 860), (560, 856), (700, 890), (736, 960)], angle=30, spacing=11, a=0.18)
    return d


def folded_contract(c, x, y, rot, a=1.0):
    """The contract folded in three: crisp paper, faint print showing through."""
    c.save(); c.translate(x, y); c.rotate(rot)
    w, h = 250, 170
    sh = paint((0, 0, 0), 0.2 * a); sh.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 8))
    c.drawRect(skia.Rect.MakeXYWH(-w / 2 + 5, -h / 2 + 8, w, h), sh)
    c.drawRect(skia.Rect.MakeXYWH(-w / 2, -h / 2, w, h), paint((247, 246, 242), a))
    c.drawRect(skia.Rect.MakeXYWH(-w / 2, -h / 2, w, h), paint((180, 176, 168), a, 1.0))
    line(c, -w / 2, -h / 2 + h / 3, w / 2, -h / 2 + h / 3, (200, 196, 188), a, 1.0)
    text(c, '借款协议', 0, -h / 2 + 38, 'serif-bold', 18, (70, 70, 72), a * 0.8, 'center', tracking=0.4)
    for k in range(5):
        c.drawRect(skia.Rect.MakeXYWH(-w / 2 + 22, -h / 2 + 76 + k * 16, w - 44 - (k % 3) * 30, 3), paint((150, 150, 150), a * 0.35))
    c.restore()


# =====================================================================
# THE DESK — the contract spread out, a finger along the lines
# =====================================================================
CS = 0.9
CX0 = (BW - O.CONTRACT_W * CS) / 2
CY0 = 112
CL = O.contract_layout(CS)
LINES = [tx.replace('{amount}', '陆仟元整') for _, tx in O.CONTRACT_LINES]


def char_cx(idx, k):
    """Page-local x of the centre of character k of clause line idx."""
    s = LINES[idx]
    mx = CL['mx']
    x0 = mx + text_width(s[:k], 'serif', 16 * CS)
    return x0 + text_width(s[k], 'serif', 16 * CS) / 2


@functools.lru_cache(maxsize=1)
def finger():
    """An index finger seen from above, pointing up-left; tip at (0, 0)."""
    d = Drawing(seed=4280, width=2.0, alpha=0.85, wobble=0.9)
    ax = np.array([0.52, 1.0]); ax /= np.linalg.norm(ax)
    nx = np.array([-ax[1], ax[0]])
    def P(l, o):
        q = ax * l + nx * o
        return (float(q[0]), float(q[1]))
    left, right = [], []
    for l in np.linspace(18, 520, 30):
        hw = 21 + 3 * min(1, l / 300)
        left.append(P(l, -hw)); right.append(P(l, hw))
    tip = [P(18 - 18 * math.sin(a), 21 * math.cos(a)) for a in np.linspace(0, math.pi, 12)]
    outline = right[::-1] + tip[::-1][1:-1] + left
    # the curled fingers of the hand (a soft mass on the right side)
    hand = [P(300, 20), P(310, 70), P(360, 118), P(460, 140), P(560, 130), P(600, 60), P(560, 10)]
    d.fill(hand, (240, 233, 220), 1.0, smooth=True)
    d.curve([P(300, 24), P(312, 70), P(360, 118), P(460, 140), P(580, 128)], w=1.8)
    d.curve([P(372, 60), P(392, 104), P(432, 124)], w=1.1, a=0.5)
    d.fill(outline, (240, 233, 220), 1.0)
    d.outline = [outline, _smooth_poly(hand)]
    d.poly(right[::-1] + tip[::-1][1:-1], w=2.0)
    d.poly(left, w=2.0)
    d.curve([P(0, 0)] + [P(18 - 18 * math.sin(a), 21 * math.cos(a)) for a in np.linspace(0, math.pi, 7)], w=0.1, a=0.0)
    # nail
    nail = [P(8, -10), P(12, -13), P(50, -13), P(54, 0), P(50, 13), P(12, 13), P(8, 10)]
    d.poly(nail, closed=True, w=1.3, a=0.7)
    # knuckle creases
    for l in (150, 164, 272):
        d.curve([P(l, -14), P(l + 4, 0), P(l, 14)], w=1.0, a=0.45, passes=1)
    return d


def reading_keys():
    """Keyframes (t, x, y) of the fingertip, page-local; the finger reads word by word."""
    keys, taps = [], []
    t = 0.0
    def run(idx, n, dur, k0=0):
        nonlocal t
        y = CL['ys'][idx] + 11 * CS
        for k in range(k0, k0 + n):
            keys.append((t, char_cx(idx, k) - 3, y)); taps.append(t)
            t += dur / n
        t -= dur / n
    run(5, 11, 2.6); t += 0.55
    run(6, 9, 1.5); t += 0.45
    run(7, 7, 1.0); t += 0.5
    run(8, 10, 3.4)
    t_line_end = t
    # across the empty rest of the line, slowing, to the right edge: the tiny 月
    yx, yy = CL['yue']
    keys.append((t + 1.7, yx - 6 * CS, yy + 11 * CS))
    t_stop = t + 1.7
    return keys, taps, t_line_end, t_stop


def key_at(keys, t):
    if t <= keys[0][0]:
        return keys[0][1], keys[0][2]
    for (t0, x0, y0), (t1, x1, y1) in zip(keys, keys[1:]):
        if t <= t1:
            k = (t - t0) / max(1e-6, t1 - t0)
            k = ease_out(k) if (t1 - t0) > 1.0 else ease_in_out(k)
            return x0 + (x1 - x0) * k, y0 + (y1 - y0) * k
    return keys[-1][1], keys[-1][2]


@functools.lru_cache(maxsize=1)
def desk_drawing():
    d = Drawing(seed=4290, width=1.8, alpha=0.75)
    # lamp base and arm from above (top-left)
    d.ellipse(150, 150, 84, 80); d.ellipse(150, 150, 66, 62, w=1.0, a=0.5)
    d.ellipse(150, 150, 10, 10, w=1.2)
    d.curve([(150, 150), (190, 60), (240, -20)], w=1.8)
    d.curve([(160, 156), (202, 64), (252, -16)], w=1.1, a=0.5)
    # the new phone, face down, to the right of the page
    x, y = 1130, 610
    d.poly([(x, y), (x + 150, y - 14), (x + 176, y + 296), (x + 26, y + 310)], closed=True, w=1.8)
    d.ellipse(x + 40, y + 34, 16, 16, w=1.2); d.ellipse(x + 40, y + 74, 16, 16, w=1.2)
    return d


# =====================================================================
# THE FLOOR — the contract where it fell; his shoes
# =====================================================================
@functools.lru_cache(maxsize=1)
def floor():
    d = Drawing(seed=4300, width=1.4, alpha=0.55)
    rot = math.radians(7)
    cr, sr = math.cos(rot), math.sin(rot)
    step = 250
    for k in range(-3, 9):
        a0 = (-400, k * step); a1 = (1900, k * step)
        b0 = (k * step, -400); b1 = (k * step, 1500)
        for (p, q) in ((a0, a1), (b0, b1)):
            P = (p[0] * cr - p[1] * sr, p[0] * sr + p[1] * cr)
            Q = (q[0] * cr - q[1] * sr, q[0] * sr + q[1] * cr)
            d.line(P[0], P[1], Q[0], Q[1], w=1.1, a=0.45, passes=1)
    # his shoes from above, toes towards the page (top right)
    for (ox, oy, ang) in ((1010, 150, 128), (1175, 205, 118)):
        d.extend(shoe_top(ox, oy, ang))
    return d


def shoe_top(ox, oy, ang):
    """A washed-out canvas sneaker seen from above, laces tied tight; toe points along `ang` deg."""
    d = Drawing(seed=int(ox), width=1.8, alpha=0.85)
    th = math.radians(ang)
    ux, uy = math.cos(th), math.sin(th)
    vx, vy = -uy, ux
    def P(a, b):
        return (ox + ux * a + vx * b, oy + uy * a + vy * b)
    # outline: heel at a=-150, toe at a=+150
    pts = []
    for a_ in np.linspace(0, 2 * math.pi, 40):
        a = 150 * math.cos(a_)
        wdt = 56 if a > 0 else 48
        b = wdt * math.sin(a_) * (1 - 0.18 * (a / 150) ** 4)
        pts.append(P(a, b))
    d.fill(pts, BRIGHT, 1.0)
    d.poly(pts, closed=True, w=2.0)
    d.curve([P(135, -44), P(150, 0), P(135, 44)], w=1.0, a=0.5)   # toe cap
    d.curve([P(110, -52), P(120, 0), P(110, 52)], w=1.0, a=0.5)
    # tongue & tight laces
    d.poly([P(-20, -20), P(90, -18), P(92, 18), P(-20, 20)], closed=True, w=1.1, a=0.6)
    for k in range(6):
        a = -10 + k * 17
        d.line(*P(a, -24), *P(a + 12, 24), w=1.2, a=0.8, passes=1)
        d.line(*P(a, 24), *P(a + 12, -24), w=1.2, a=0.8, passes=1)
    # the trouser leg going up to the knee (out of frame), its hem resting on the heel
    hem = [P(-420, -72), P(-60, -70), P(-38, -30), P(-34, 0), P(-38, 30), P(-60, 70), P(-420, 74)]
    d.fill(hem, mix(BRIGHT, GRAPHITE, 0.10), 1.0, smooth=True)
    d.curve([P(-420, -72), P(-62, -68), P(-40, -34), P(-34, 0), P(-40, 34), P(-62, 68), P(-420, 74)], w=1.9)
    d.curve([P(-60, -40), P(-110, -20), P(-170, -30)], w=1.0, a=0.45)
    d.curve([P(-70, 30), P(-140, 44), P(-230, 36)], w=1.0, a=0.4)
    d.hatch([P(-400, -66), P(-80, -64), P(-60, 0), P(-80, 66), P(-400, 68)], angle=ang + 75, spacing=13, a=0.18)
    return d


# =====================================================================
# THE WALL — his shadow; then the window, from outside
# =====================================================================
LAMP_XY = (120.0, 1020.0)


@functools.lru_cache(maxsize=1)
def wall_drawing():
    d = Drawing(seed=4310, width=1.6, alpha=0.7)
    # corner of the room (right) and the ceiling line
    d.line(1210, -10, 1225, 1090, w=1.4)
    d.hatch([(1216, 0), (1450, 0), (1450, 1080), (1232, 1080)], angle=86, spacing=11, a=0.28)
    d.line(-10, 64, 1212, 70, w=1.1, a=0.45)
    # a timetable taped to the wall
    x, y, w, h = 190, 190, 330, 240
    d.rect(x, y, w, h, w=1.4)
    for k in range(1, 6):
        d.line(x + k * w / 6, y + 30, x + k * w / 6, y + h, w=0.8, a=0.4, passes=1)
    d.line(x, y + 30, x + w, y + 30, w=1.0, a=0.6)
    for k in range(1, 5):
        d.line(x, y + 30 + k * (h - 30) / 5, x + w, y + 30 + k * (h - 30) / 5, w=0.8, a=0.4, passes=1)
    for (tx, ty) in ((x - 8, y - 6), (x + w - 22, y - 8)):
        d.rect(tx, ty, 32, 14, w=0.9, a=0.5, passes=1)
    # the light switch by the corner
    d.rect(1110, 520, 52, 76, w=1.3); d.rect(1124, 540, 24, 36, w=0.9, a=0.6)
    # the edge of the desk, lit from below the frame
    d.line(-10, 1010, 700, 1004, w=1.3, a=0.5)
    return d


def _chaikin(pts, n=3, closed=True):
    P = np.asarray(pts, np.float64)
    for _ in range(n):
        Q = []
        m = len(P)
        for i in range(m if closed else m - 1):
            a, b = P[i], P[(i + 1) % m]
            Q += [0.75 * a + 0.25 * b, 0.25 * a + 0.75 * b]
        P = np.array(Q)
    return P


@functools.lru_cache(maxsize=1)
def shadow_path_pts():
    """His shadow on the wall: head bowed into the hood, shoulders slumped, one lower
    (the hand clutching the phone), stretched and sheared by the low lamp."""
    rot = math.radians(13)
    head = [(800 + 118 * math.cos(a) * math.cos(rot) - 140 * math.sin(a) * math.sin(rot),
             500 + 118 * math.cos(a) * math.sin(rot) + 140 * math.sin(a) * math.cos(rot)) for a in np.linspace(0, 2 * math.pi, 40, endpoint=False)]
    body = [(400, 1120), (420, 980), (470, 880), (560, 800), (650, 770), (690, 730), (705, 670), (740, 628),
            (800, 640), (880, 628), (925, 668), (948, 720), (1010, 742), (1100, 760), (1170, 820), (1215, 930),
            (1240, 1120)]
    def shear(P):
        return [(x + 0.16 * (1120 - y), y) for (x, y) in P]
    return _chaikin(shear(head), 2), _chaikin(shear(body), 3)


def draw_shadow(c, a=1.0):
    head, body = shadow_path_pts()
    for blur, aa in ((46, 0.16), (16, 0.30), (6, 0.22)):
        smudge(c, [tuple(p) for p in body], GRAPHITE, aa * a, blur)
        smudge(c, [tuple(p) for p in head], GRAPHITE, aa * a, blur)


@functools.lru_cache(maxsize=1)
def room_img():
    """The static part of the wall shot (paper, lamp light, drawing, shadow), rendered once."""
    surf = skia.Surface(BW, H)
    c = surf.getCanvas()
    O.b_background(c, DAY)
    lx, ly = LAMP_XY
    g = skia.GradientShader.MakeRadial((lx, ly), 1500, [col(LAMP, 0.42), col(LAMP, 0.16), col(LAMP, 0)], [0, 0.55, 1])
    c.drawRect(skia.Rect(0, 0, BW, H), skia.Paint(Shader=g, BlendMode=skia.BlendMode.kMultiply))
    wall_drawing().draw(c, 1.0)
    draw_shadow(c, 0.95)
    return surf.makeImageSnapshot().withDefaultMipmaps()


def draw_room(c, T, dark):
    """The wall with the shadow (room coords 1440x1080). `dark` 0..1 = daylight draining."""
    lx, ly = LAMP_XY
    c.drawImage(room_img(), 0, 0, SAMP)
    # daylight draining away: everything outside the lamp's reach goes dim
    if dark > 0:
        sh = skia.GradientShader.MakeRadial((lx + 200, ly - 150), 1600,
                                            [col(NIGHT, 0), col(NIGHT, 0.35 * dark), col(NIGHT, 0.8 * dark)], [0.0, 0.5, 1.0])
        c.drawRect(skia.Rect(0, 0, BW, H), skia.Paint(Shader=sh))
    glow(c, lx + 60, ly - 40, 520, LAMP, 0.30 + 0.12 * dark)


# facade (final framing): windows 300x225, his is (col 2, row 2)
WW, WH = 300, 225
COLS = [-230, 180, 590, 1000, 1410]
ROWS = [-150, 175, 500, 825]
HIS = (590, 500)
Z0 = BW / WW


@functools.lru_cache(maxsize=1)
def facade():
    d = Drawing(seed=4320, width=1.7, alpha=0.75)
    rng = np.random.default_rng(4321)
    for ry in ROWS:
        d.line(-300, ry - 58, 1760, ry - 58, w=1.1, a=0.4, passes=1)
    for cx in COLS:
        for ry in ROWS:
            his = (cx, ry) == HIS
            d.rect(cx - 12, ry - 12, WW + 24, WH + 24, w=1.6)
            d.line(cx - 26, ry + WH + 22, cx + WW + 26, ry + WH + 22, w=1.8)
            if his:
                continue
            d.rect(cx, ry, WW, WH, w=1.0, a=0.6)
            d.line(cx + WW / 2, ry, cx + WW / 2, ry + WH, w=1.2, a=0.7)
            d.hatch([(cx + 3, ry + 3), (cx + WW - 3, ry + 3), (cx + WW - 3, ry + WH - 3), (cx + 3, ry + WH - 3)],
                    angle=rng.uniform(55, 70), spacing=7, a=0.5)
            if rng.random() < 0.45:     # an air-conditioner box under the window
                ax = cx + rng.uniform(20, WW - 110)
                d.rect(ax, ry + WH + 34, 96, 58, w=1.2, a=0.7)
                d.ellipse(ax + 30, ry + WH + 63, 18, 18, w=0.9, a=0.6)
    # the one window's frame, drawn last
    cx, ry = HIS
    d.rect(cx - 3, ry - 3, WW + 6, WH + 6, w=1.4)
    return d


@functools.lru_cache(maxsize=1)
def street_tree():
    return O.tree(seed=442, x=90, y=1250, s=2.3, leaves=True, depth=6)


def draw_pullback(c, T, u, dark):
    """u = 0: inside (window fills the frame) ... u = 1: the facade at dusk."""
    Z = Z0 ** (1 - u)
    lam = (Z - 1) / (Z0 - 1)
    wcx, wcy = HIS[0] + WW / 2, HIS[1] + WH / 2
    sx, sy = wcx + lam * (BW / 2 - wcx), wcy + lam * (H / 2 - wcy)
    O.b_background(c, 30)
    c.save()
    c.translate(sx, sy); c.scale(Z, Z); c.translate(-wcx, -wcy)
    if u > 0.001:
        fa = smooth((u - 0.12) / 0.40)          # the building draws itself in as we back away
        facade().draw(c, 1.0, 0.9 * fa)
        street_tree().draw(c, 1.0, 0.8 * fa)
        # dusk on the outside of the building
        c.save()
        c.clipRect(skia.Rect.MakeXYWH(HIS[0], HIS[1], WW, WH), skia.ClipOp.kDifference)
        c.drawRect(skia.Rect(-2000, -2000, 4000, 4000), paint(NIGHT, 0.30 + 0.14 * fa))
        c.restore()
        glow(c, wcx, wcy + 30, WW * 1.3, LAMP, 0.30 * clamp(u * 2))
    c.save()
    c.clipRect(skia.Rect.MakeXYWH(HIS[0], HIS[1], WW, WH))
    c.translate(HIS[0], HIS[1]); c.scale(WW / BW, WW / BW)
    draw_room(c, T, dark)
    c.restore()
    c.restore()


# =====================================================================
# RUNNING — his old washed-out sneakers (the one thing he did not replace)
# =====================================================================
@functools.lru_cache(maxsize=2)
def sneaker_side(seed=51):
    """One washed-out canvas sneaker (as O.shoes), toe to the right, heel at x=0, sole bottom at y=0."""
    d = Drawing(seed=seed, width=2.0, alpha=0.85)
    X, y = 0, -150
    body = [(X, y + 132), (X + 10, y + 70), (X + 60, y + 40), (X + 120, y + 55), (X + 200, y + 90), (X + 280, y + 105),
            (X + 302, y + 132)]
    d.fill(body + [(X + 305, y + 150), (X - 5, y + 150)], BRIGHT, 1.0, smooth=False)
    sole = [(X, y + 150), (X + 300, y + 150), (X + 305, y + 132), (X - 5, y + 132)]
    d.poly(sole, closed=True)
    d.curve(body)
    d.curve([(X + 70, y + 42), (X + 90, y + 10), (X + 140, y + 8), (X + 150, y + 60)])
    for j in range(5):
        lx = X + 95 + j * 18
        d.line(lx, y + 40 + j * 7, lx + 16, y + 46 + j * 7, w=1.2)
    d.curve([(X + 150, y + 38), (X + 175, y + 20), (X + 190, y + 34), (X + 160, y + 45)], w=1.1)
    d.hatch(sole, angle=0, spacing=6)
    return d


@functools.lru_cache(maxsize=2)
def trouser_leg(seed=52):
    """A trouser leg from the ankle (0,0) up out of frame."""
    d = Drawing(seed=seed, width=2.0, alpha=0.85)
    poly = [(-58, 6), (-74, -900), (86, -900), (62, 4)]
    d.fill(poly, mix(BRIGHT, GRAPHITE, 0.07), 1.0)
    d.line(-58, 6, -74, -900); d.line(62, 4, 86, -900)
    d.curve([(-58, 6), (0, 14), (62, 4)], w=1.6)
    d.curve([(-40, -120), (10, -150), (50, -230)], w=1.0, a=0.4)
    d.hatch(poly, angle=78, spacing=14, a=0.15)
    return d


def draw_running(c, t):
    """Side view of his feet running to the right across paving; the ground streams left."""
    G = 860.0
    speed = 1250.0
    # paving joints streaming past
    c.drawLine(-10, G, BW + 10, G, paint(GRAPHITE, 0.45, 1.4))
    off = (t * speed) % 300
    for k in range(-1, 7):
        x = k * 300 - off
        c.drawLine(x, G, x - 90, H, paint(GRAPHITE, 0.25, 1.2))
    om = 2 * math.pi * 1.65
    # trouser legs fade out upwards (an unfinished sketch), so only the shins read
    c.saveLayer(None, None)
    for side, ph0, a in ((1, math.pi, 0.55), (0, 0.0, 1.0)):
        ph = om * t + ph0
        fx, yy, rot = _foot(ph, side, G)
        c.save()
        c.translate(fx, yy); c.rotate(rot, 90, -40)
        c.translate(100, -112); c.rotate(-8 + 20 * math.sin(ph))
        trouser_leg(52 + side).draw(c, 1.0, a)
        c.restore()
    mask = skia.GradientShader.MakeLinear([(0, G - 560), (0, G - 300)], [col(BLACK, 0), col(BLACK, 1)], [0, 1])
    c.drawRect(skia.Rect(0, 0, BW, H), skia.Paint(Shader=mask, BlendMode=skia.BlendMode.kDstIn))
    c.restore()
    for side, ph0, a in ((1, math.pi, 0.55), (0, 0.0, 1.0)):
        ph = om * t + ph0
        fx, yy, rot = _foot(ph, side, G)
        lift = G - 12 * side - yy
        sh = paint(GRAPHITE, 0.12 * a * max(0.0, 1 - lift / 160)); sh.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 10))
        c.drawOval(skia.Rect(fx - 10, G - 8, fx + 300, G + 10), sh)
        c.save()
        c.translate(fx, yy); c.rotate(rot, 90, -40)
        sneaker_side(51 + side).draw(c, 1.0, a)
        c.restore()


def _foot(ph, side, G):
    fx = 560 + 170 * math.sin(ph)
    cph = math.cos(ph)
    lift = 105 * max(0.0, cph) ** 1.3
    if cph > 0:                 # in the air: toe up
        rot = -13 * cph
    else:                       # pushing off: the heel rises (pivot at the toe, faked by a lift)
        rot = 9 * (-cph) ** 2
        lift += 300 * math.sin(math.radians(rot)) * 0.5
    return fx, G - 12 * side - lift, rot


# =====================================================================
# sounds
# =====================================================================
def _tt(d):
    return np.arange(int(d * SR)) / SR


def cloth(seed, d, a=0.1):
    x = lowpass(bandpass(sfx.noise(d, seed), 250, 3500), 2600)
    return (x * np.sin(np.pi * _tt(d) / d) ** 1.5 * a).astype(np.float32)


def rummage(d=3.4, seed=600):
    rng = np.random.default_rng(seed)
    out = np.zeros(int(d * SR), np.float32)
    t = 0.05
    while t < d - 0.5:
        dd = rng.uniform(0.18, 0.5)
        x = cloth(int(rng.integers(0, 1e6)), dd, rng.uniform(0.05, 0.12))
        s = int(t * SR); n = min(len(x), len(out) - s)
        out[s:s + n] += x[:n]
        t += dd * rng.uniform(0.45, 1.0)
    return out


def paper_slide(seed, d=0.5, a=1.0):
    x = bandpass(sfx.noise(d, seed), 1500, 7000) * np.sin(np.pi * _tt(d) / d) ** 2 * 0.07 * a
    return x.astype(np.float32)


def paper_drop(seed=610):
    """A sheet slipping off the desk: a short flutter, then a soft slap on the floor tiles."""
    d1 = 0.6
    t1 = _tt(d1)
    fl = bandpass(sfx.noise(d1, seed), 1200, 6500) * (0.55 + 0.45 * np.sin(2 * np.pi * 12 * t1)) * np.sin(np.pi * t1 / d1) * 0.06
    d2 = 0.35; t2 = _tt(d2)
    slap = lowpass(sfx.noise(d2, seed + 1), 1600) * np.exp(-t2 * 32) * 0.4 + bandpass(sfx.noise(d2, seed + 2), 2000, 9000) * np.exp(-t2 * 50) * 0.08
    out = np.zeros(int((d1 + d2) * SR), np.float32)
    out[:len(fl)] += fl
    k = int((d1 - 0.08) * SR); out[k:k + len(slap)] += slap[:len(out) - k]
    return out


def paper_rattle(d, seed=620):
    """A sheet in shaking hands."""
    t = _tt(d)
    grow = np.clip(t / d, 0, 1) ** 1.3
    trem = (0.5 + 0.5 * np.sin(2 * np.pi * 8.5 * t + 3 * np.sin(2 * np.pi * 1.1 * t))) ** 2
    x = bandpass(sfx.noise(d, seed), 2500, 9000) * trem * grow * 0.06
    return env_fade(x.astype(np.float32), 0.05, 0.08)


def finger_audio(taps, d, seed=630):
    rng = np.random.default_rng(seed)
    out = bandpass(sfx.noise(d, seed), 1200, 4500).astype(np.float32) * 0.010
    for k, t in enumerate(taps):
        dd = 0.035
        tap = bandpass(sfx.noise(dd, seed + k + 1), 1800, 6500) * np.exp(-_tt(dd) * 120) * rng.uniform(0.08, 0.13)
        s = int(t * SR)
        if 0 <= s and s + len(tap) < len(out):
            out[s:s + len(tap)] += tap.astype(np.float32)
    return env_fade(out, 0.15, 0.25)


def lamp_click(seed=640):
    x = sfx.click(seed, 1400, 0.05, 0.7)
    y = sfx.click(seed + 1, 2600, 0.02, 0.3)
    out = np.zeros(int(0.12 * SR), np.float32)
    out[:len(x)] += x; out[int(0.03 * SR):int(0.03 * SR) + len(y)] += y
    return out


def ringback(seed=650):
    """China ring-back tone heard in the handset: 450 Hz, 1 s."""
    x = np.sin(2 * np.pi * 450 * _tt(1.0)).astype(np.float32) * 0.28
    return phone_fx(env_fade(x, 0.01, 0.02))


def handset_click(seed=660):
    return phone_fx(sfx.click(seed, 1200, 0.04, 0.9))


def shaky(y):
    """His voice shaking: a slow uneven tremor, then the room."""
    y = np.asarray(y, np.float32)
    t = np.arange(len(y)) / SR
    m = 1.0 + 0.17 * np.sin(2 * np.pi * 6.3 * t + 0.9 * np.sin(2 * np.pi * 0.8 * t))
    if y.ndim == 2:
        m = m[:, None]
    return reverb((y * m).astype(np.float32), wet=0.16, decay=0.5, size='room')


# =====================================================================
def build():
    sc = Scene('s06_d42', kind='B', title='第六场【倒计时】')
    def reset(c, t, L):
        L.scene.sub_color = None
    sc.layer(reset, 0.0, None, z=-10)

    # ---------------- countdown card ----------------
    sc.wait(0.4)
    t0 = sc.t
    def card(c, t, L):
        bright_page(c, 0.12)
        O.countdown_card(c, DAY, t)
    sc.layer(card, t0, t0 + 4.6, fin=0.8, fout=0.6)
    sc.sfx(sfx.pencil(3.0, 61), at=t0 + 0.6, gain=-8)
    sc.wait(4.6)

    # ---------------- the avenue: one back among many ----------------
    t_av = sc.t - 0.5
    V = 0.052                                  # walking speed in distance units / s
    crowd = [  # (u, D0, seed, backpack, t_enter)
        (-0.50, 1.40, 1, True, 0.0), (0.42, 1.55, 2, False, 0.0), (0.70, 1.95, 4, True, 0.0),
        (-0.40, 2.15, 5, True, 0.0), (0.16, 2.55, 6, False, 0.0), (-0.72, 2.9, 7, True, 0.0),
        (0.46, 3.4, 8, False, 0.0), (-0.12, 3.9, 9, True, 0.0),
    ]
    ZU, ZD0 = -0.06, 1.50                      # him
    sc.wait(1.8)
    sc.caption('他换了新手机，穿了一件新的卫衣。', dur=3.6)
    sc.wait(4.3)
    sc.caption('看起来和身边的同学没什么区别了。', dur=3.8)
    sc.wait(4.6)
    t_ring = sc.t
    t_stop = t_ring + 1.0
    late = [(0.30, 0.95, 10, True, t_ring + 5.0), (-0.46, 0.95, 11, False, t_ring + 11.0)]
    V_LATE = 0.10                              # passers-by overtaking him, hurrying to class

    def zhang_D(T):
        return ZD0 + V * travelled(T - t_av, t_stop - 0.5 - t_av, t_stop + 0.5 - t_av)

    def avenue_draw(c, T, zpose, run_t0=None):
        bright_page(c)
        k_draw = ease_out((T - t_av) / 2.6)
        p_ = skia.Paint(); p_.setAlphaf(clamp(k_draw * 1.2))
        c.drawImage(avenue_img(), 0, 0, skia.SamplingOptions(), p_)
        figs = []
        for (u, D0, seed, bp, te) in crowd + late:
            if T < te:
                continue
            D = D0 + (V * (T - t_av) if te == 0.0 else V_LATE * (T - te))
            figs.append((D, u, walker_img(seed, 'walk', bp), seed, 1.0))
        D = zhang_D(T)
        if run_t0 is not None and T > run_t0:
            D += 0.9 * (T - run_t0) ** 1.3
        figs.append((D, ZU, walker_img(3, zpose, False), 3, 0.0))
        figs.sort(key=lambda q: -q[0])
        for D, u, img, seed, moving in figs:
            f = 1.0 / D
            if seed == 3:
                walking = T < t_stop or (run_t0 is not None and T > run_t0)
                rate = 5.2 if (run_t0 is not None and T > run_t0) else 1.8
                amp = 9 if rate > 3 else 4
                bob = abs(math.sin((T - t_av) * math.pi * rate + 0.7)) * amp if walking else 0.0
            else:
                bob = abs(math.sin((T - t_av) * math.pi * 1.8 + seed * 1.3)) * 4
            a = clamp((D - 0.9) / 0.25) * clamp((6.5 - D) / 1.5)
            draw_walker(c, img, f, u, bob, a=a * min(1.0, k_draw * 1.5))
        vignette(c, BW, H, 0.12)

    def av1(c, t, L):
        avenue_draw(c, L.T, 'walk')
    t_ins = t_ring + 1.9
    sc.layer(av1, t_av, t_ins + 0.5, fin=0.9, fout=0.5)

    # ---------------- insert: the new phone, a stranger's number ----------------
    t_ans = t_ins + 3.0
    def ins(c, t, L):
        T = L.T
        bright_page(c, 0.18)
        c.save()
        jx = math.sin(T * 61) * 1.6 if T < t_ans else 0
        c.translate(jx, 0); c.rotate(-3, PHX + PHW / 2, PHY + PHH / 2)
        hand_phone().draw(c, 1.0)
        screen_ui(c, 'ring' if T < t_ans else 'call', T, t_ans)
        if T < t_ans:
            buzz_marks(c, T, 0.9)
        c.restore()
    sc.layer(ins, t_ins, t_ans + 1.0, fin=0.35, fout=0.5)
    sc.sfx(sfx.phone_ring(t_ans - t_ring + 0.02), at=t_ring, gain=-15, pan=-0.05, fout=0.05)
    sc.sfx(sfx.vibrate(t_ans - t_ring, 62), at=t_ring, gain=-20, fout=0.05)
    sc.sfx(sfx.click(63, 1800, 0.04, 0.5), at=t_ans, gain=-10)

    # ---------------- the call, standing in the middle of the road ----------------
    t_call = t_ans + 0.5
    def av2(c, t, L):
        avenue_draw(c, L.T, 'phone')
    sc.at(t_call + 0.5)
    sc.say('cuishou', '张朝阳同学，温馨提醒，本月利息九百元已逾期。', fx='phone', post=0.5)
    sc.say('zhang', '什么？不是半年后一起还吗？', fx='dry', speed=0.95, gain=-2, post=0.45)
    sc.say('cuishou', '合同第六条，利息按月结算，逾期未付视为违约。', fx='phone', post=0.3)
    sc.say('cuishou', '你自己签的合同，回去翻翻。', fx='phone', post=0.35)
    sc.say('cuishou', '限你三天把利息和违约金结清。', fx='phone', post=0.05)
    t_hang = sc.t
    sc.sfx(handset_click(), at=t_hang, gain=-6)
    sc.sfx(sfx.busy_tone(2), at=t_hang + 0.25, gain=-12)
    sc.wait(3.2)
    t_trem = sc.t
    sc.layer(av2, t_call, t_trem + 0.5, fin=0.5, fout=0.5)

    # ---------------- insert: the hand holding the phone begins to shake ----------------
    def trem(c, t, L):
        T = L.T
        bright_page(c, 0.18)
        k = smooth((T - t_trem - 0.6) / 2.8)
        jx = (math.sin(T * 47) + 0.6 * math.sin(T * 83 + 1)) * 3.2 * k
        jy = (math.cos(T * 53) + 0.5 * math.sin(T * 71)) * 2.4 * k
        c.save()
        c.translate(jx, jy); c.rotate(-3 + 0.5 * k * math.sin(T * 39), PHX + PHW / 2, PHY + PHH / 2)
        hand_phone().draw(c, 1.0)
        screen_ui(c, 'ended', T, t_trem)
        c.restore()
    sc.layer(trem, t_trem, t_trem + 4.6, fin=0.5, fout=0.4)
    sc.at(t_trem + 4.4)

    # ---------------- he runs ----------------
    t_run = sc.t
    def run(c, t, L):
        bright_page(c, 0.2)
        draw_running(c, L.T - t_run)
    sc.layer(run, t_run, t_run + 3.3, fin=0.3, fout=0.4)
    sc.sfx(sfx.footsteps(10, 0.30, 64, jitter=0.015, a=1.0), at=t_run + 0.1, gain=-9, fout=0.8)
    sc.amb(sfx.campus(60, 65), t_av, t_run + 3.0, gain=4, fin=1.0, fout=1.0)
    sc.wait(3.1)

    # ---------------- the bottom of the cabinet ----------------
    t_cab = sc.t
    sc.amb(sfx.room_tone(140, 66), t_cab - 0.2, None, gain=-5)
    sc.sfx(sfx.door('open', 67), at=t_cab - 0.3, gain=-6, pan=0.4)
    sc.sfx(sfx.footsteps(3, 0.3, 68, a=0.8), at=t_cab + 0.3, gain=-12)
    t_pull = t_cab + 3.4
    def cab(c, t, L):
        T = L.T
        bright_page(c, 0.05)
        smudge(c, [(340, 460), (1120, 460), (1120, 985), (340, 985)], GRAPHITE, 0.10, 20)
        cabinet().draw(c, ease_out(t / 1.8))
        k = ease_in_out((T - t_pull) / 1.4)
        fx_, fy_ = 560 + 380 * k, 905 - 330 * k
        if k <= 0:
            folded_contract(c, fx_, fy_, -4)
            solid(c, _smooth_poly(PILE_MOUND), BRIGHT, ease_out((t - 0.4) / 1.2))
            pile().draw(c, ease_out((t - 0.4) / 1.2))
        else:
            solid(c, _smooth_poly(PILE_MOUND), BRIGHT)
            pile().draw(c, 1.0)
            folded_contract(c, fx_, fy_, -4 + 10 * k)
    sc.layer(cab, t_cab - 0.1, t_cab + 5.6, fin=0.5, fout=0.6)
    sc.sfx(rummage(3.2, 69), at=t_cab + 0.4, gain=-4)
    sc.sfx(paper_slide(70, 0.7, 1.0), at=t_pull, gain=-4)
    sc.wait(5.3)

    # ---------------- the desk: the contract, one character at a time ----------------
    t_desk = sc.t
    keys, taps, t_le, t_st = reading_keys()
    t_lamp = t_desk + 1.3
    t_read = t_desk + 2.6
    t_stop_f = t_read + t_st                 # the finger stops under the 月
    t_away = t_stop_f + 1.4                  # the finger withdraws
    t_zoom = t_away + 0.5
    t_zoom_end = t_zoom + 3.2
    t_red = t_zoom_end - 0.6
    t_desk_end = t_zoom_end + 3.4
    fx_, fy_ = CX0 + CL['yue'][0] - 5 * CS, CY0 + CL['yue'][1] - 5 * CS     # centre of the 月

    def desk(c, t, L):
        T = L.T
        bright_page(c, 0.05)
        kz = ease_in_out(ramp(T, t_zoom, t_zoom_end))
        k = 1.0 + 4.6 * kz
        c.save()
        tx = fx_ + (880 - fx_) * kz; ty = fy_ + (680 - fy_) * kz
        c.translate(tx, ty); c.scale(k, k); c.translate(-fx_, -fy_)
        lamp = smooth((T - t_lamp) / 0.4)
        # the page is spread flat: it slides in and settles
        ks = ease_out((T - t_desk - 0.2) / 0.9)
        py = CY0 + 50 * (1 - ks)
        desk_drawing().draw(c, 1.0, 0.8)
        red = smooth((T - t_red) / 0.8)
        O.contract_page(c, CX0, py, s=CS, a=ks, yue_red=red)
        # the finger
        if t_read - 0.6 < T < t_away + 1.0:
            tt = T - t_read
            px, pyy = key_at(keys, tt)
            kin = ease_out((T - (t_read - 0.6)) / 0.6)
            kout = ease_in_out((T - t_away) / 0.9)
            ox = (1 - kin) * 260 + kout * 420; oy = (1 - kin) * 420 + kout * 640
            c.save(); c.translate(CX0 + px + ox, py + pyy + oy)
            for poly in finger().outline:
                solid(c, poly, (240, 233, 220))
            finger().draw(c, 1.0)
            c.restore()
        c.restore()
        if lamp > 0:
            glow(c, 250, 260, 1100, LAMP, 0.26 * lamp * (1 - kz))
    sc.layer(desk, t_desk, t_desk_end, fin=0.5, fout=0.5)
    sc.sfx(paper_slide(71, 0.8, 1.2), at=t_desk + 0.2, gain=-6)
    sc.sfx(lamp_click(72), at=t_lamp, gain=-6)
    sc.sfx(finger_audio([q + 0.6 for q in taps], t_st + 1.2, 73), at=t_read - 0.6, gain=-2)
    sc.caption('一个字。', start=t_red + 0.2, dur=3.4)
    drone_at = t_stop_f - 0.3

    # ---------------- his hands shake; the contract slips to the floor ----------------
    t_sh = t_desk_end - 0.5
    t_drop = t_sh + 3.2
    def shake(c, t, L):
        T = L.T
        bright_page(c, 0.05)
        desk_drawing().draw(c, 1.0, 0.8)
        k = smooth((T - t_sh) / 2.6)
        jx = (math.sin(T * 43) + 0.7 * math.sin(T * 91 + 2)) * 5.0 * k
        jy = (math.cos(T * 57) + 0.6 * math.sin(T * 77)) * 4.0 * k
        rot = (math.sin(T * 36) * 0.6) * k
        u = ramp(T, t_drop, t_drop + 0.95)
        if u < 1:
            fall = u * u
            cx, cy = CX0 + O.CONTRACT_W * CS / 2, CY0 + O.CONTRACT_H * CS / 2
            c.save()
            c.translate(cx + jx * (1 - u) + 60 * fall, cy + jy * (1 - u) + 1250 * fall)
            c.rotate(rot + 11 * fall)
            sc_ = 1.03 - 0.1 * fall
            c.scale(sc_, sc_)
            sh = paint((0, 0, 0), 0.16); sh.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 22))
            c.drawRect(skia.Rect.MakeXYWH(-O.CONTRACT_W * CS / 2 + 20, -O.CONTRACT_H * CS / 2 + 30,
                                          O.CONTRACT_W * CS, O.CONTRACT_H * CS), sh)
            O.contract_page(c, -O.CONTRACT_W * CS / 2, -O.CONTRACT_H * CS / 2, s=CS, yue_red=1.0, shadow=False)
            c.restore()
        glow(c, 250, 260, 1100, LAMP, 0.26)
    sc.layer(shake, t_sh, t_drop + 2.6, fin=0.5, fout=0.6)
    sc.sfx(paper_rattle(3.3, 75), at=t_sh + 0.2, gain=-2)
    sc.sfx(paper_drop(76), at=t_drop + 0.1, gain=-2)

    # ---------------- the floor: he calls back ----------------
    t_fl = t_drop + 2.0
    def flr(c, t, L):
        T = L.T
        bright_page(c, 0.0)
        c.drawRect(skia.Rect(0, 0, BW, H), paint(GRAPHITE, 0.05))
        floor().draw(c, 1.0)
        k = 1.0 + 0.05 * ramp(T, t_fl, t_fl + 30)
        c.save(); c.translate(720, 540); c.scale(k, k); c.translate(-720, -540)
        c.save(); c.translate(360, 170); c.rotate(-13)
        O.contract_page(c, 0, 0, s=0.62, yue_red=1.0)
        c.restore(); c.restore()
        glow(c, 1100, 0, 900, LAMP, 0.16)
        vignette(c, BW, H, 0.25)
    sc.at(t_fl + 1.8)
    sc.sfx(sfx.click(77, 2600, 0.02, 0.4), gain=-12)
    sc.sfx(ringback(78), at=sc.t + 0.5, gain=-12)
    sc.sfx(handset_click(79), at=sc.t + 2.7, gain=-8)
    sc.wait(3.0)
    sc.say('zhang', '你们合同上做了手脚。', fx=shaky, note='声音发抖', speed=0.95, gain=-1, post=0.3)
    s_, e_ = sc.say('zhang', '那个字根本看不到——', fx=shaky, note='声音发抖', speed=0.97, gain=-1, post=0.0)
    sc.at(e_ - 0.3)
    sc.say('cuishou', '什么看不到看得到的，白纸黑字你自己签的。', fx='phone', post=0.35)
    sc.say('cuishou', '你爱去哪告去哪告。', fx='phone', post=0.55)
    sc.say('cuishou', '对了，逾期不还，违约金可是按天算的。', fx='phone', speed=0.96, post=0.1)
    t_hang2 = sc.t
    sc.sfx(handset_click(80), at=t_hang2, gain=-6)
    sc.sfx(sfx.busy_tone(7), at=t_hang2 + 0.3, gain=-11)
    t_wall = t_hang2 + 1.2
    sc.sfx(sfx.drone(t_wall + 2.0 - drone_at, 49.0, 74), at=drone_at, gain=-15, fin=3.0, fout=3.0)
    sc.layer(flr, t_fl, t_wall + 0.8, fin=0.8, fout=0.8)

    # ---------------- the shadow on the wall; the pull-back ----------------
    t_pb = t_wall + 10.0
    PB = 19.0
    def wall(c, t, L):
        T = L.T
        dark = 0.12 + 0.55 * smooth((T - t_wall) / (t_pb + PB * 0.6 - t_wall))
        u = ease_in_out(ramp(T, t_pb, t_pb + PB))
        L.scene.sub_color = WHITE if u > 0.25 else None
        draw_pullback(c, T, u, dark)
    sc.layer(wall, t_wall, None, fin=0.9, fout=2.0)
    sc.amb(sfx.wind(40, 81, 0.35), t_pb + 4, None, gain=-8, fin=4.0)
    sc.at(t_pb + PB * 0.52)
    sc.narr('后来他又坐了多久，没有人知道。', post=0.5)
    sc.narr('因为不会有人来这间宿舍找他。', post=3.5)
    sc.at(max(sc.t, t_pb + PB + 2.5))
    sc.finish(tail=0.5)
    return sc

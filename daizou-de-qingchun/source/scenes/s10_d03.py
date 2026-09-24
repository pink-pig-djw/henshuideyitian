"""第十场【倒计时】 外景 校园 日 ／ 内景 某处 日 — 距自杀还有 3 天.

Noon, and the page is almost white. He walks with his head down in the hoodie he has worn for two
weeks; it hangs off him. The phone: Xiao Qiang, calm, smiling. His own voice is barely there. The
busy tone. He stops in the middle of the path and crouches, and the camera goes down to the ground
with him: his sneakers do not move while other people's feet and wheels go through the frame. One
pair of feet stops beside him for two seconds, then walks on. He stays in the sun a long time.

The campus is one fixed wide (a bystander parked on a bench), used three times: he walks in; he
stands, then sinks; much later, the shade has moved and he has not."""
import math, functools
import numpy as np
import skia
from film.config import *
from film.gfx import *
from film.timeline import Scene
from film.sketch import Drawing, smudge, _tooth, _catmull
from film.audio import reverb, lowpass, highpass, bandpass, env_fade, to_stereo, normalize
from film import objects as O, sfx

DAY = 3
PAPER = tuple(int(v) for v in O.b_paper(DAY))
HOT = (255, 254, 249)                    # noon glare
HOODIE = mix(PAPER, GRAPHITE, 0.25)      # the washed-out grey hoodie
HAIR = mix(PAPER, GRAPHITE, 0.60)
SKIN = mix(PAPER, (255, 255, 255), 0.18)
FIG = (72, 68, 64)                       # figures in the glare
DENIM = mix(PAPER, GRAPHITE, 0.20)


def _t(d):
    return np.arange(int(d * SR)) / SR


# =====================================================================
# baking & small drawing utilities
# =====================================================================
_BAKED = {}


def baked(key, fn, transparent=False):
    """Render fn(canvas) once into a 1440x1080 image (per process)."""
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


HEAD_RECT = skia.Rect(560, 230, 900, 560)
BODY_RECT = skia.Rect(440, 430, 1000, 1080)


def blit_rect(c, img, r, a=1.0):
    """Draw only the part of a baked full-frame image that holds anything (cheaper)."""
    p = None
    if a < 0.999:
        p = skia.Paint()
        p.setAlphaf(max(0.0, a))
    c.drawImageRect(img, r, r, skia.SamplingOptions(), p)


def paper_bg(c):
    blit(c, baked(('paper', DAY), lambda cc: O.b_background(cc, DAY)))


def tooth_layer(c):
    """Call after drawing into a saveLayer: gives the layer the graphite paper tooth."""
    c.drawPaint(skia.Paint(Shader=_tooth(), BlendMode=skia.BlendMode.kDstIn))


def path_of(pts, closed=True):
    p = skia.Path()
    p.moveTo(float(pts[0][0]), float(pts[0][1]))
    for q in pts[1:]:
        p.lineTo(float(q[0]), float(q[1]))
    if closed:
        p.close()
    return p


def blurred(rgb, a, sigma):
    p = paint(rgb, a)
    if sigma > 0:
        p.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, sigma))
    return p


# =====================================================================
# the campus wide: a plane-tree avenue at noon, one-point perspective
# =====================================================================
HZ, VPX, FOC, CAMH = 500, 720.0, 1000.0, 1.6
TREE_Z = (5.0, 8.5, 13.0, 20.0, 32.0, 55.0)
TREE_X = 3.35


def proj(X, z):
    s = FOC / z
    return VPX + X * s, HZ + CAMH * s, s


def _trunk(d, xb, yb, wpx, top, seed, fork=None):
    """A near plane-tree trunk rising out of frame: two edges, root flare, mottled bark."""
    rng = np.random.default_rng(seed)
    lean = rng.uniform(-0.06, 0.06) * wpx
    hw = wpx / 2
    ys = np.linspace(yb, top, 7)
    L = [(xb - hw * 1.35, yb + 2)] + [(xb - hw * (1.0 - 0.12 * k / 6) + lean * k / 6 + rng.normal(0, 1.5), y) for k, y in enumerate(ys[1:], 1)]
    R = [(xb + hw * 1.35, yb + 2)] + [(xb + hw * (1.0 - 0.12 * k / 6) + lean * k / 6 + rng.normal(0, 1.5), y) for k, y in enumerate(ys[1:], 1)]
    d.curve(L, w=1.7)
    d.curve(R, w=1.7)
    # plane-tree bark: flakes of lighter and darker patches
    n = int((yb - top) / max(8, wpx * 0.35))
    for k in range(n):
        u = rng.uniform(0.05, 0.95)
        y = yb + (top - yb) * u
        x = xb + lean * u + rng.uniform(-0.62, 0.62) * hw * (1 - 0.12 * u)
        rx, ry = rng.uniform(0.10, 0.26) * wpx, rng.uniform(0.07, 0.2) * wpx
        pts = [(x + rx * math.cos(a) * rng.uniform(0.8, 1.15), y + ry * math.sin(a) * rng.uniform(0.8, 1.15))
               for a in np.linspace(0, 2 * math.pi, 9)]
        d.poly(pts, closed=True, w=0.8, a=0.42, passes=1, wobble=0.6)
        if rng.random() < 0.35:
            d.hatch(pts, angle=rng.uniform(40, 80), spacing=max(3.0, wpx * 0.045), w=0.6, a=0.28)
    if fork:
        # the first fork: limbs leaving the top of the frame
        fy = top
        for (dx, ang) in fork:
            x0 = xb + lean + dx * hw
            for sg in (-1, 1):
                pts = []
                for k in range(6):
                    L = k * 110
                    a_ = ang + 0.10 * math.sin(k * 0.9 + dx * 5)
                    pts.append((x0 + sg * hw * (0.36 - 0.03 * k) + math.cos(a_) * L, fy + 4 - math.sin(a_) * L))
                d.curve(pts, w=1.5)


@functools.lru_cache(maxsize=1)
def campus_wide():
    d = Drawing(seed=1001, width=1.5, alpha=0.72)
    rng = np.random.default_rng(1001)
    # far end: a teaching building across the avenue, low and pale
    d.rect(548, 392, 344, 108, w=1.0, a=0.35)
    for k in range(1, 4):
        d.line(552, 392 + k * 27, 888, 392 + k * 27, w=0.6, a=0.18, passes=1)
    for k in range(1, 12):
        d.line(548 + k * 28.7, 396, 548 + k * 28.7, 498, w=0.5, a=0.13, passes=1)
    d.line(-20, HZ + 1, 1460, HZ - 3, w=0.8, a=0.28)
    # the path: curbs (double line), paving joints
    for side in (-1, 1):
        d.poly([proj(side * 2.2, z)[:2] for z in (2.3, 3, 4.5, 7, 11, 18, 30, 60)], w=1.4)
        d.poly([proj(side * 2.4, z)[:2] for z in (2.3, 3, 4.5, 7, 11, 18, 30)], w=0.8, a=0.4, passes=1)
    z = 2.45
    while z < 34:
        x0, y0, _ = proj(-2.2, z)
        x1, y1, _ = proj(2.2, z)
        d.line(x0, y0, x1, y1, w=0.7, a=0.24, passes=1)
        z *= 1.13
    for X in (-1.1, 0.0, 1.1):
        d.poly([proj(X, z)[:2] for z in (2.3, 4, 8, 16, 40)], w=0.6, a=0.17, passes=1)
    # lawn beyond the curbs: sparse grass ticks
    for k in range(260):
        side = -1 if k % 2 else 1
        X = side * rng.uniform(2.6, 9.0)
        zz = math.exp(rng.uniform(math.log(2.4), math.log(40)))
        x, y, s = proj(X, zz)
        if -10 < x < 1450 and y < 1090:
            h = max(2.0, 0.08 * s)
            d.line(x, y, x + rng.uniform(-0.3, 0.3) * h, y - h, w=0.6, a=0.3, passes=1, overshoot=0)
    # a bench in the right-hand shade (the two who eat their lunch sit on it)
    bx0, by0, bs0 = proj(3.9, 7.4)
    bx1, by1, bs1 = proj(3.9, 9.6)
    d.line(bx0, by0 - 0.45 * bs0, bx1, by1 - 0.45 * bs1, w=1.3)
    d.line(bx0, by0 - 0.9 * bs0, bx1, by1 - 0.9 * bs1, w=1.1, a=0.6)
    for (bx, by, bs) in ((bx0, by0, bs0), (bx1, by1, bs1)):
        d.line(bx, by, bx, by - 0.9 * bs, w=1.1)
    # trees: near trunks framing the shot, then real plane trees going down the avenue
    for i, z in enumerate(TREE_Z):
        for side in (-1, 1):
            x, y, s = proj(side * TREE_X, z)
            seed = 1100 + i * 7 + (side > 0)
            if z > 9:
                d.extend(O.tree(**_tree_args(i, z, side)))
    return d


def _shade_pools(c, shift=0.0, a=1.0):
    """Noon shade under the plane trees, with light dappled through the leaves.
    shift (metres): later, the sun has moved; the pools stretch along the avenue, but never
    reach the middle of the path where he is."""
    rng = np.random.default_rng(1200)
    for z in TREE_Z:
        for side in (-1, 1):
            X0 = side * TREE_X
            r = 2.3 if z > 6 else 2.5
            zc = z - shift * 0.7
            rz = r * 0.8 * (1 + 0.35 * shift)
            pts = []
            for th in np.linspace(0, 2 * math.pi, 40):
                zz = max(2.35, zc + rz * math.sin(th))
                pts.append(proj(X0 + r * math.cos(th), zz)[:2])
            smudge(c, pts, GRAPHITE, 0.085 * a, 26)
            # dapples
            for k in range(int(26 if z < 10 else 10)):
                th = rng.uniform(0, 2 * math.pi)
                rr = r * math.sqrt(rng.random()) * 0.9
                x, y, s = proj(X0 + rr * math.cos(th), max(2.4, zc + rr * (rz / r) * math.sin(th)))
                w_ = rng.uniform(0.12, 0.3) * s
                c.drawOval(skia.Rect.MakeXYWH(x - w_, y - w_ * 0.28, 2 * w_, w_ * 0.56), blurred(HOT, 0.30 * a, 3))


def _tree_args(i, z, side):
    x, y, s = proj(side * TREE_X, z)
    seed = 1100 + i * 7 + (side > 0)
    return dict(seed=seed % 97 + 3, x=round(x, 1), y=round(y, 1), s=round(9.0 * s / 627.0, 3), depth=6 if z < 25 else 5)


def _canopies(c, a=1.0):
    """Leaf masses: soft graphite clouds where each plane tree's twigs are, and the near trees'
    crowns hanging into the top of the frame."""
    rng = np.random.default_rng(1300)
    for i, z in enumerate(TREE_Z):
        for side in (-1, 1):
            x, y, s = proj(side * TREE_X, z)
            Hc = 9.0 * s
            if z > 9:
                t = O.tree(**_tree_args(i, z, side))
                tips = [p[-1] for (p, w, al) in t.strokes if w > 0 and len(p) > 2]
                tips = [tp for tp in tips if tp[1] < y - 0.35 * Hc]
                for tp in tips[::3]:
                    r = rng.uniform(0.035, 0.07) * Hc
                    c.drawOval(skia.Rect.MakeXYWH(tp[0] - r, tp[1] - r * 0.7, 2 * r, 1.4 * r),
                               blurred(GRAPHITE, 0.045 * a, max(3.0, r * 0.5)))
            else:
                for k in range(26):
                    ex = x + side * rng.uniform(-0.25, 0.1) * Hc * (0.5 if z < 6 else 0.4) - side * rng.uniform(0, 0.12) * Hc
                    ey = rng.uniform(-120, 170 if z < 6 else 260)
                    r = rng.uniform(40, 110)
                    c.drawOval(skia.Rect.MakeXYWH(ex - r, ey - r * 0.6, 2 * r, 1.2 * r), blurred(GRAPHITE, 0.05 * a, r * 0.4))


@functools.lru_cache(maxsize=1)
def near_trunks():
    d = Drawing(seed=1301, width=1.8, alpha=0.8)
    rng = np.random.default_rng(1302)
    for i, z in enumerate(TREE_Z[:2]):
        for side in (-1, 1):
            x, y, s = proj(side * TREE_X, z)
            top = -20 if z < 6 else 330
            fork = None if z < 6 else ((-0.3, math.pi / 2 + 0.45 * side), (0.25, math.pi / 2 - 0.35 * side))
            _trunk(d, x, y, 0.5 * s, top, 1100 + i * 7 + (side > 0), fork)
    # leaves hanging into the top of the frame from the near crowns
    for k in range(70):
        side = -1 if k % 2 else 1
        lx = 720 + side * rng.uniform(260, 800)
        ly = rng.uniform(-20, 150) * (1.0 if abs(lx - 720) > 420 else 0.5)
        r = rng.uniform(9, 17)
        rot = rng.uniform(0, 2 * math.pi)
        pts = []
        for j in range(26):
            th = rot + 2 * math.pi * j / 25
            rr = r * (0.62 + 0.38 * abs(math.cos(2.5 * (th - rot))))
            pts.append((lx + rr * math.cos(th), ly + rr * math.sin(th)))
        d.poly(pts, w=0.9, a=0.5, passes=1, wobble=0.5)
    return d


def _near_fill(c, a=1.0):
    """Nearer things keep more of their tone in the glare: the near trunks' bark."""
    rng = np.random.default_rng(1303)
    for i, z in enumerate(TREE_Z[:2]):
        for side in (-1, 1):
            x, y, s = proj(side * TREE_X, z)
            hw = 0.25 * s
            top = -20 if z < 6 else 330
            c.drawPath(path_of([(x - hw * 1.3, y), (x - hw * 0.9, top), (x + hw * 0.9, top), (x + hw * 1.3, y)]),
                       paint(mix(PAPER, GRAPHITE, 0.07), a))
            for k in range(int((y - top) / 22)):
                py = rng.uniform(top, y)
                px = x + rng.uniform(-0.8, 0.8) * hw
                rx, ry = rng.uniform(0.15, 0.4) * hw, rng.uniform(0.1, 0.3) * hw
                c.drawOval(skia.Rect.MakeXYWH(px - rx, py - ry, 2 * rx, 2 * ry), blurred(GRAPHITE, rng.uniform(0.04, 0.10) * a, 2))


def _wide_bg(cc, shift=0.0, wash=0.40):
    O.b_background(cc, DAY)
    _canopies(cc)
    _shade_pools(cc, shift)
    campus_wide().draw(cc, 1.0, 0.62)
    cc.drawRect(skia.Rect(0, 0, BW, H), paint(HOT, wash))
    glow(cc, 720, 60, 1250, HOT, 0.70)
    glow(cc, 720, 640, 760, HOT, 0.28)
    _near_fill(cc, 1.0 - 0.6 * shift / 1.6)
    near_trunks().draw(cc, 1.0, 0.7 - 0.25 * shift / 1.6)


def wide_bg(c, shift=0.0, wash=0.40):
    blit(c, baked(('wide', shift, wash), lambda cc: _wide_bg(cc, shift, wash)))


# =====================================================================
# people in the wide (silhouettes; unit height ~300 = 1.7 m, feet at y=0)
# =====================================================================
ZH_STAND = [(0, -234), (-12, -236), (-24, -231), (-36, -224), (-45, -214), (-51, -200), (-54, -180), (-55, -156),
            (-55, -134), (-54, -116), (-52, -106), (-48, -102), (-45, -107), (-45, -113), (-38, -113), (-30, -104),
            (-25, -80), (-23, -50), (-21, -20), (-21, -8), (-28, -3), (-26, 2), (-10, 2), (-8, -8), (-6, -50),
            (-3, -96), (0, -100)]
ZH_CROUCH = [(0, -156), (-13, -159), (-27, -155), (-40, -146), (-50, -132), (-56, -112), (-59, -90), (-60, -68),
             (-58, -46), (-54, -28), (-48, -16), (-44, -8), (-40, 3), (-20, 3), (-14, -6), (-7, -12), (0, -14)]
PERSON = [(0, -244), (-12, -246), (-26, -242), (-42, -236), (-52, -226), (-57, -208), (-59, -180), (-59, -150),
          (-58, -122), (-56, -104), (-50, -98), (-46, -106), (-46, -120), (-40, -118), (-36, -100), (-34, -70),
          (-32, -40), (-30, -12), (-31, -4), (-37, 0), (-35, 4), (-12, 4), (-10, -6), (-8, -50), (-4, -100), (0, -104)]
SKIRT = [(0, -238), (-12, -240), (-24, -236), (-38, -230), (-47, -220), (-52, -202), (-54, -176), (-54, -146),
         (-52, -122), (-50, -106), (-45, -100), (-41, -108), (-42, -124), (-46, -110), (-54, -80), (-58, -62),
         (-26, -60), (-24, -34), (-22, -10), (-23, -3), (-29, 0), (-27, 4), (-10, 4), (-9, -6), (-8, -40),
         (-4, -60), (0, -60)]
NPTS = 180


def _full(half):
    h = _catmull(half, per=4)
    right = [(-x, y) for (x, y) in reversed(h[1:-1])]
    return np.vstack([h, right])


def _resample_closed(pts, n=NPTS):
    pts = np.asarray(pts, np.float64)
    P = np.vstack([pts, pts[:1]])
    seg = np.hypot(*(P[1:] - P[:-1]).T)
    Lc = np.concatenate([[0], np.cumsum(seg)])
    s = np.linspace(0, Lc[-1], n, endpoint=False)
    return np.stack([np.interp(s, Lc, P[:, 0]), np.interp(s, Lc, P[:, 1])], 1)


@functools.lru_cache(maxsize=8)
def outline(name):
    return _resample_closed(_full({'stand': ZH_STAND, 'crouch': ZH_CROUCH, 'person': PERSON, 'skirt': SKIRT}[name]))


def _walk_legs(pts, phase, amp=9.0):
    """Back/front view walking: the lifting foot rises, that leg shortens."""
    out = pts.copy()
    for side, ph in ((-1, phase), (1, phase + math.pi)):
        lift = max(0.0, math.sin(ph)) * amp
        m = (out[:, 1] > -70) & (np.sign(out[:, 0]) == side)
        out[m, 1] -= lift * ((out[m, 1] + 70) / 70.0)
    return out


def draw_person(c, x, y, spx, kind='person', phase=0.0, walking=True, a=0.35, tone=FIG, sx=1.0, bob=True, amp=9.0):
    """A small figure in the glare. spx = px per unit (unit height 300)."""
    pts = outline(kind)
    if walking:
        pts = _walk_legs(pts, phase, amp)
    by = -2.0 * abs(math.sin(phase)) if (walking and bob) else 0.0
    c.save()
    c.translate(x, y)
    c.scale(spx * sx, spx)
    c.translate(0, by)
    c.drawPath(path_of(pts), paint(tone, a))
    hy = -272 if kind == 'person' else -266
    c.drawOval(skia.Rect.MakeXYWH(-21, hy - 25, 42, 50), paint(tone, a))
    c.restore()


def draw_zhang(c, x, y, spx, k_crouch=0.0, phase=0.0, walking=False, a=0.66):
    """Zhang in the wide, from behind: bowed head, loose hoodie; k_crouch morphs him down."""
    e = ease_in_out(k_crouch)
    P = outline('stand') * (1 - e) + outline('crouch') * e
    if walking and e == 0:
        P = _walk_legs(P, phase, 7.0)
    by = -1.6 * abs(math.sin(phase)) if walking else 0.0
    c.save()
    c.translate(x, y)
    c.scale(spx, spx)
    c.translate(0, by)
    # head: bowed; in the crouch it sinks between the arms
    hx, hy = 0.0, -258 * (1 - e) + -150 * e
    hr = (22 * (1 - e) + 18 * e, 26 * (1 - e) + 18 * e)
    body = path_of(P)
    c.drawPath(body, paint(HOODIE, a * 0.95))
    c.drawPath(body, paint(FIG, a * 0.55))
    c.drawOval(skia.Rect.MakeXYWH(hx - hr[0], hy - hr[1], 2 * hr[0], 2 * hr[1]), paint(mix(FIG, GRAPHITE, 0.4), a * 0.9 * (1 - 0.55 * e)))
    c.drawPath(body, paint(GRAPHITE, a * 0.5, 1.3 / spx))
    # the hood lying on the back, the dropped shoulder seams (fade out as he sinks)
    k = a * (1 - e) * 0.8
    if k > 0.02:
        hood = skia.Path()
        hood.moveTo(-30, -236); hood.cubicTo(-30, -214, -14, -204, 0, -203); hood.cubicTo(14, -204, 30, -214, 30, -236)
        c.drawPath(hood, paint(GRAPHITE, k, 1.6 / spx))
        for sd in (-1, 1):
            c.drawLine(sd * 46, -206, sd * 50, -184, paint(GRAPHITE, k * 0.5, 1.1 / spx))
            c.drawLine(sd * 44, -176, sd * 45, -116, paint(GRAPHITE, k * 0.45, 1.0 / spx))
    if e > 0.3:
        kk = a * smooth((e - 0.3) / 0.7)
        # the hood on his rounded back, the spine under the cloth, and his heels showing below
        hood = skia.Path()
        hood.moveTo(-32, -146); hood.cubicTo(-30, -122, -12, -108, 0, -106); hood.cubicTo(12, -108, 30, -122, 32, -146)
        c.drawPath(hood, paint(GRAPHITE, kk * 0.7, 1.6 / spx))
        c.drawLine(-2, -100, -5, -30, paint(GRAPHITE, kk * 0.35, 1.2 / spx))
        for sd in (-1, 1):
            c.drawLine(sd * 50, -120, sd * 56, -60, paint(GRAPHITE, kk * 0.4, 1.1 / spx))    # elbows under the cloth
            c.drawRoundRect(skia.Rect.MakeXYWH(sd * 30 - 10, -6, 20, 11), 4, 4, paint(mix(PAPER, (255, 255, 255), 0.4), kk))
            c.drawRoundRect(skia.Rect.MakeXYWH(sd * 30 - 10, -6, 20, 11), 4, 4, paint(GRAPHITE, kk * 0.7, 1.2 / spx))
    c.restore()


def draw_cyclist_side(c, x, y, s, facing=1, crank=0.0, a=0.3, tone=FIG):
    """Side view, small: s = px per metre; (x, y) = ground point under the bottom bracket."""
    c.save()
    c.translate(x, y)
    c.scale(s * facing, s)
    r = 0.33
    p = paint(tone, a, 0.035)
    for wx in (-0.52, 0.52):
        c.drawCircle(wx, -r, r, p)
    c.drawLine(-0.52, -r, 0.0, -0.3, p)            # chain stay
    c.drawLine(0.0, -0.3, 0.42, -0.85, p)           # down tube
    c.drawLine(-0.1, -0.85, 0.42, -0.85, p)         # top tube
    c.drawLine(0.0, -0.3, -0.12, -0.9, p)           # seat tube
    c.drawLine(0.42, -0.85, 0.52, -r, p)            # fork
    # rider
    px, py = 0.17 * math.cos(crank), -0.3 + 0.17 * math.sin(crank)
    qx, qy = 0.17 * math.cos(crank + math.pi), -0.3 + 0.17 * math.sin(crank + math.pi)
    fill = paint(tone, a)
    c.drawPath(path_of([(-0.2, -0.95), (-0.05, -0.98), (0.3, -1.42), (0.18, -1.52), (-0.16, -1.1)]), fill)
    c.drawCircle(0.27, -1.62, 0.11, fill)
    leg = paint(tone, a, 0.09)
    c.drawLine(-0.1, -0.98, (px - 0.1) * 0.5 + 0.12, (py - 0.98) * 0.5 - 0.15, leg)
    c.drawLine((px - 0.1) * 0.5 + 0.12, (py - 0.98) * 0.5 - 0.15, px, py, leg)
    c.drawLine(-0.1, -0.98, (qx - 0.1) * 0.5 + 0.12, (qy - 0.98) * 0.5 - 0.15, leg)
    c.drawLine((qx - 0.1) * 0.5 + 0.12, (qy - 0.98) * 0.5 - 0.15, qx, qy, leg)
    c.drawLine(0.25, -1.36, 0.46, -0.98, paint(tone, a, 0.06))
    c.restore()


def draw_seated(c, x, y, s, eat=0.0, a=0.3, tone=FIG, facing=-1, lean=0.0):
    """Someone on the bench eating from a lunch box (side view, facing the path)."""
    c.save()
    c.translate(x, y)
    c.scale(s * facing, s)
    fill = blurred(tone, a, 0.012)
    c.save(); c.rotate(-lean * 12, 0, -0.45)
    c.drawPath(path_of(_catmull([(-0.12, -0.45), (0.12, -0.45), (0.17, -0.78), (0.12, -1.02), (-0.06, -1.08), (-0.17, -0.8), (-0.12, -0.45)], per=4)), fill)
    c.drawCircle(0.1, -1.18, 0.1, fill)
    c.drawLine(0.1, -0.95, 0.3 - 0.06 * eat, -0.66 - 0.36 * eat, paint(tone, a, 0.06))
    c.restore()
    c.drawPath(path_of([(-0.1, -0.52), (0.36, -0.5), (0.4, -0.02), (0.3, 0.0), (0.28, -0.42), (-0.1, -0.4)]), fill)
    c.drawRect(skia.Rect.MakeXYWH(0.2, -0.64, 0.2, 0.08), paint(tone, a * 0.8))
    c.restore()


# ---------------- choreography of the wide ----------------
class Walker:
    """Someone moving through the wide: world X, depth z, over [t0, t1] (scene time)."""
    def __init__(self, t0, t1, X0, z0, X1, z1, kind='person', a=0.3, sx=1.0, hs=1.0, avoid=None, bike=False):
        self.t0, self.t1, self.X0, self.z0, self.X1, self.z1 = t0, t1, X0, z0, X1, z1
        self.kind, self.a, self.sx, self.hs, self.avoid, self.bike = kind, a, sx, hs, avoid, bike

    def pos(self, T):
        u = (T - self.t0) / (self.t1 - self.t0)
        X = self.X0 + (self.X1 - self.X0) * u
        z = self.z0 + (self.z1 - self.z0) * u
        if self.avoid is not None:
            # route around someone standing in the path
            aX, az, side, since = self.avoid
            if T > since:
                k = math.exp(-((z - az) / 1.8) ** 2)
                X += side * 0.9 * k * max(0.0, 1.0 - abs(X - aX) / 2.2) + side * 0.25 * k
        return X, z, u

    def dist(self, T):
        u = (T - self.t0) / (self.t1 - self.t0)
        return u * math.hypot(self.X1 - self.X0, self.z1 - self.z0)


def walker(t0, X0, z0, X1, z1, speed=1.25, **kw):
    """A Walker defined by its speed, so paths can start/end off frame without popping."""
    d = math.hypot(X1 - X0, z1 - z0)
    return Walker(t0, t0 + d / speed, X0, z0, X1, z1, **kw)


def _crowd_alpha(a, z):
    """Far figures melt into the glare; near ones keep more tone (and are not see-through)."""
    far = clamp((52.0 - z) / 20.0)
    near = clamp((7.5 - z) / 4.5)
    return a * far + (0.62 - a) * near


def draw_crowd(c, T, walkers, zhang=None, seated=True):
    """All small figures of the wide, far to near, grained like pencil."""
    items = []
    for w in walkers:
        if w.t0 <= T <= w.t1:
            X, z, u = w.pos(T)
            items.append((z, 'w', w, X))
    if zhang is not None:
        items.append((zhang['z'], 'z', zhang, None))
    items.sort(key=lambda it: -it[0])
    if seated:
        for k, (zz, ph) in enumerate(((8.0, 0.0), (8.9, 1.7))):
            x, y, s = proj(3.75, zz)
            eat = max(0.0, math.sin(T * 1.3 + ph)) ** 3 if k == 0 else 0.0
            lean = (max(0.0, math.sin(T * 0.7 + 2.0)) ** 8) if k == 1 else 0.0     # the one who laughs
            draw_seated(c, x, y, s, eat, a=0.28, lean=lean)
    for (z, kind, obj, X) in items:
        if kind == 'w':
            x, y, s = proj(X, z)
            aa = _crowd_alpha(obj.a, z)
            if obj.bike:
                draw_cyclist_side(c, x, y, s, facing=1 if obj.X1 > obj.X0 else -1, crank=obj.dist(T) / 0.33 * 0.5, a=aa)
            else:
                ph = obj.dist(T) / 0.55 * math.pi
                draw_person(c, x, y, s * 1.7 * obj.hs / 300.0, obj.kind, ph, True, aa, sx=obj.sx)
        else:
            x, y, s = proj(obj['X'], z)
            draw_zhang(c, x, y, s * 1.7 / 300.0, obj.get('crouch', 0.0), obj.get('phase', 0.0), obj.get('walking', False))


# =====================================================================
# the medium shot: his back, the hoodie hanging off him
# =====================================================================
CX = 720


def _mirror(pts):
    return [(2 * CX - x, y) for (x, y) in pts]


MID_HOOD = mix(PAPER, GRAPHITE, 0.16)
MID_JEANS = mix(PAPER, GRAPHITE, 0.30)


def baked_rgba(key, fn):
    """Like baked(), on a transparent canvas (figures)."""
    img = _BAKED.get(key)
    if img is None:
        surf = skia.Surface(BW, H)
        cc = surf.getCanvas()
        cc.clear(skia.ColorTRANSPARENT)
        fn(cc)
        img = _BAKED[key] = surf.makeImageSnapshot()
    return img


def _X(pts, sd=1):
    return [(CX + sd * x, y) for (x, y) in pts]


# his back, right half (x relative to CX): shoulders narrow, the hoodie a size too big
R_SLEEVE = [(36, 470), (92, 486), (144, 506), (184, 526), (210, 556), (226, 600), (234, 660), (240, 770),
            (243, 876), (242, 950), (236, 988)]
R_PHONE = [(36, 470), (92, 486), (144, 506), (184, 526), (210, 556), (226, 602), (232, 656), (232, 706),
           (222, 742), (204, 758), (194, 752), (198, 820), (203, 900), (205, 960), (204, 986)]
HOOD_RIM = [(-104, 488), (-56, 502), (0, 508), (56, 502), (104, 488)]
HOOD_RIM2 = [(-124, 500), (-64, 516), (0, 522), (64, 516), (124, 500)]
HOOD_FLAP = [(-124, 500), (-150, 548), (-146, 612), (-100, 668), (0, 708), (100, 668), (146, 612), (150, 548), (124, 500)]


def _body_poly(pose):
    R = R_PHONE if pose == 'phone' else R_SLEEVE
    Lh = [(-x, y) for (x, y) in R_SLEEVE]
    right_bottom = [(236, 992), (200, 996), (190, 986)] if pose != 'phone' else [(196, 988)]
    return _X(Lh[::-1][:-1] + R) + _X(right_bottom) + _X([(0, 990)]) + _X([(-190, 986), (-200, 996), (-236, 992)])


def _mid_body_img(pose):
    def fn(cc):
        body = _body_poly(pose)
        # jeans under the hem: narrower than the hoodie
        jeans = _X([(-152, 960), (152, 960), (146, 1040), (142, 1100), (-142, 1100), (-146, 1040)])
        cc.drawPath(path_of(jeans), paint(MID_JEANS, 1.0))
        cc.drawPath(path_of([(float(x), float(y)) for (x, y) in _catmull(body, per=5)]), paint(MID_HOOD, 1.0))
        # soft graphite shading: the sides, under the hood, the inner sleeves
        for sd in (-1, 1):
            if pose == 'phone' and sd > 0:
                smudge(cc, _X([(150, 600), (200, 760), (204, 980), (150, 984)], sd), GRAPHITE, 0.10, 16)
            else:
                smudge(cc, _X([(150, 590), (186, 600), (194, 980), (160, 984)], sd), GRAPHITE, 0.11, 14)
                smudge(cc, _X([(228, 640), (242, 660), (244, 970), (232, 980)], sd), GRAPHITE, 0.07, 8)
        smudge(cc, _X([(-150, 606), (-104, 668), (0, 712), (104, 668), (150, 606), (104, 690), (0, 736), (-104, 690)]),
               GRAPHITE, 0.09, 10)
        smudge(cc, _X([(-188, 984), (188, 984), (150, 1010), (-150, 1010)]), GRAPHITE, 0.14, 7)
        smudge(cc, _X([(-100, 494), (100, 494), (56, 512), (-56, 512)]), GRAPHITE, 0.10, 6)
        for sd in (-1, 1):   # the cloth sagging over the ribbed hem
            smudge(cc, _X([(60, 930), (180, 926), (184, 948), (64, 952)], sd), GRAPHITE, 0.08, 8)
        mid_body_lines(pose).draw(cc, 1.0)
    return fn


@functools.lru_cache(maxsize=2)
def mid_body_lines(pose='walk'):
    d = Drawing(seed=1020 + (pose == 'phone'), width=2.0, alpha=0.84)
    R = R_PHONE if pose == 'phone' else R_SLEEVE
    d.curve(_X(R), w=2.2)
    d.curve(_X([(-x, y) for (x, y) in R_SLEEVE]), w=2.2)
    # the hood: rolled rim around the back of the neck, the flap lying on his back, its seam
    d.curve(_X(HOOD_RIM), w=1.8)
    d.curve(_X(HOOD_RIM2), w=1.6)
    d.curve(_X(HOOD_FLAP), w=1.7)
    d.curve(_X([(0, 522), (3, 610), (0, 706)]), w=1.1, a=0.6)
    for pts in ([(-88, 534), (-60, 568), (-28, 582)], [(52, 540), (86, 580)], [(-120, 606), (-84, 648)], [(112, 612), (78, 650)]):
        d.curve(_X(pts), w=0.9, a=0.45, passes=1)
    for sd in (-1, 1):
        d.curve(_X([(198, 530), (214, 572), (224, 624)], sd), w=1.2, a=0.6)                  # dropped seam
        d.curve(_X([(188, 562), (176, 612), (180, 650)], sd), w=0.8, a=0.4, passes=1)
        if not (pose == 'phone' and sd > 0):
            d.curve(_X([(178, 600), (186, 760), (192, 962)], sd), w=1.0, a=0.5)               # arm against the body
            for y0 in (690, 800, 905):
                d.curve(_X([(196, y0), (218, y0 + 12), (240, y0 + 6)], sd), w=0.8, a=0.4, passes=1)
            d.curve(_X([(200, 960), (238, 958)], sd), w=0.9, a=0.5, passes=1)                 # cuff
            # fingers just out of the too-long sleeve
            for j in range(3):
                d.curve(_X([(206 + j * 10, 994), (208 + j * 10, 1010), (212 + j * 10, 1016)], sd), w=0.9, a=0.55, passes=1)
    if pose == 'phone':
        d.curve(_X([(206, 700), (222, 724), (226, 740)]), w=0.8, a=0.45, passes=1)
        d.curve(_X([(194, 752), (200, 860), (205, 984)]), w=1.4, a=0.7)
    # the cloth hangs straight down off the shoulder blades
    for pts, a_ in (([(-62, 712), (-72, 840), (-64, 970)], 0.4), ([(82, 706), (94, 836), (88, 972)], 0.4),
                    ([(18, 724), (12, 900)], 0.25), ([(-128, 680), (-140, 820)], 0.3)):
        d.curve(_X(pts), w=0.9, a=a_)
    for sd in (-1, 1):
        d.curve(_X([(70, 930), (120, 942), (176, 936)], sd), w=0.8, a=0.4, passes=1)
        d.curve(_X([(30, 912), (80, 924)], sd), w=0.7, a=0.3, passes=1)
    # ribbed hem, hanging loose around narrow hips
    d.curve(_X([(-188, 950), (0, 955), (188, 950)]), w=1.0, a=0.55)
    d.curve(_X([(-190, 986), (0, 991), (190, 986)]), w=1.6)
    for k in range(-15, 16):
        d.line(CX + k * 12, 953, CX + k * 12 + 0.5, 986, w=0.6, a=0.25, passes=1, overshoot=0)
    # jeans
    d.curve(_X([(-152, 990), (-146, 1040), (-142, 1100)]), w=1.6)
    d.curve(_X([(152, 990), (146, 1040), (142, 1100)]), w=1.6)
    d.line(CX, 994, CX + 1, 1100, w=1.1, a=0.6)
    for sd in (-1, 1):
        d.poly(_X([(120, 1014), (32, 1016), (36, 1080), (78, 1094), (116, 1080)], sd), closed=True, w=1.0, a=0.55)
    return d


HEAD = (CX, 372, 82, 92)


def _hair_poly():
    hx, hy, rx, ry = HEAD
    hair = [(hx + rx * math.cos(a), hy + ry * math.sin(a)) for a in np.linspace(math.radians(165), math.radians(375), 40)]
    return hair + _X([(76, 414), (52, 432), (30, 428), (10, 440), (-12, 432), (-36, 440), (-62, 428), (-78, 410)])


WRIST = [(92, 432), (111, 437), (84, 500), (66, 495)]
HAND = [(82, 350), (98, 338), (116, 340), (128, 354), (130, 384), (124, 414), (112, 438), (92, 440), (84, 414)]
PHONE_EDGE = [(92, 318), (104, 316), (114, 400), (102, 402)]


def _mid_head_img(pose):
    def fn(cc):
        hx, hy, rx, ry = HEAD
        # the nape: thin, bent forward
        nape = _X([(-36, 420), (36, 420), (40, 468), (56, 494), (0, 520), (-56, 494), (-40, 468)])
        cc.drawPath(path_of(nape), paint(SKIN, 1.0))
        smudge(cc, _X([(-36, 430), (36, 430), (32, 452), (-32, 452)]), GRAPHITE, 0.12, 6)
        cc.drawOval(skia.Rect.MakeXYWH(hx - rx, hy - ry, 2 * rx, 2 * ry), paint(SKIN, 1.0))
        cc.drawPath(path_of(_hair_poly()), paint(HAIR, 0.8))
        smudge(cc, [(hx - 60, hy - 60), (hx + 70, hy - 50), (hx + 60, hy + 40), (hx - 60, hy + 40)], GRAPHITE, 0.12, 20)
        if pose == 'phone':
            cc.drawPath(path_of(_X(WRIST)), paint(SKIN, 1.0))
            cc.drawPath(path_of(_X(PHONE_EDGE)), paint(mix(PAPER, GRAPHITE, 0.55), 1.0))
            cc.drawPath(path_of([(float(x), float(y)) for (x, y) in _catmull(_X(HAND) + _X(HAND[:1]), per=4)]), paint(SKIN, 1.0))
            smudge(cc, _X([(92, 432), (116, 438), (86, 496), (60, 490)]), GRAPHITE, 0.09, 5)
        mid_head_lines(pose).draw(cc, 1.0)
    return fn


@functools.lru_cache(maxsize=2)
def mid_head_lines(pose='walk'):
    d = Drawing(seed=1030 + (pose == 'phone'), width=1.9, alpha=0.86)
    rng = np.random.default_rng(1031)
    hx, hy, rx, ry = HEAD
    d.curve(_X([(-38, 430), (-41, 470), (-56, 494)]), w=1.5)
    d.curve(_X([(38, 430), (41, 470), (56, 494)]), w=1.5)
    d.curve(_X([(-9, 490), (0, 484), (9, 490)]), w=1.2, a=0.65)                       # the knob of the spine
    d.curve(_X([(-8, 452), (-6, 476)]), w=0.8, a=0.3, passes=1)
    for sd in (-1, 1):                                                                   # ears
        d.curve(_X([(76, 362), (92, 368), (94, 396), (82, 414)], sd), w=1.4)
    top = [(hx + rx * math.cos(a), hy + ry * math.sin(a)) for a in np.linspace(math.radians(160), math.radians(380), 44)]
    d.poly(top, w=1.9)
    cxw, cyw = hx + 12, 312
    for k in range(120):
        a0 = rng.uniform(0, 2 * math.pi)
        r0 = rng.uniform(2, 20)
        sx, sy = cxw + r0 * math.cos(a0), cyw + r0 * math.sin(a0) * 0.6
        tx = hx + rx * 0.97 * math.cos(a0) * rng.uniform(0.6, 1.0)
        ty = min(hy + ry * 0.97 * math.sin(a0) * rng.uniform(0.6, 1.0), 430 + rng.uniform(-8, 6))
        mx, my = (sx + tx) / 2 + rng.normal(0, 5), (sy + ty) / 2 + rng.normal(0, 5)
        d.curve([(sx, sy), (mx, my), (tx, ty)], w=rng.uniform(0.6, 1.1), a=rng.uniform(0.2, 0.5), passes=1, wobble=0.7)
    for k in range(26):                                                                  # the nape hairline: short strands
        x0 = rng.uniform(-70, 70)
        y0 = 426 + 10 * math.cos(x0 / 40) + rng.normal(0, 3)
        d.line(CX + x0, y0 - 12, CX + x0 + rng.normal(0, 2), y0 + rng.uniform(2, 8), w=0.7, a=0.4, passes=1, overshoot=0)
    for k in range(8):                                                                   # strays: he hasn't washed it
        a0 = math.radians(rng.uniform(195, 345))
        x0, y0 = hx + rx * math.cos(a0), hy + ry * math.sin(a0)
        d.curve([(x0, y0), (x0 + math.cos(a0) * 9 + rng.normal(0, 3), y0 + math.sin(a0) * 11),
                 (x0 + math.cos(a0) * 16 + rng.normal(0, 5), y0 + math.sin(a0) * 18)], w=0.8, a=0.5, passes=1)
    if pose == 'phone':
        d.line(*_X([WRIST[0]])[0], *_X([WRIST[3]])[0], w=1.3)
        d.line(*_X([WRIST[1]])[0], *_X([WRIST[2]])[0], w=1.3)
        d.poly(_X(PHONE_EDGE), closed=True, w=1.4)
        d.curve(_X(HAND) + _X(HAND[:1]), w=1.5)
        for k in range(3):                     # knuckles of the fingers curled round the phone
            d.curve(_X([(100, 352 + k * 18), (114, 350 + k * 18), (126, 358 + k * 18)]), w=0.8, a=0.5, passes=1)
        d.curve(_X([(96, 424), (104, 432), (112, 434)]), w=0.8, a=0.45, passes=1)
    return d


def mid_body_img(pose):
    return baked_rgba(('midbody', pose), _mid_body_img(pose))


def mid_head_img(pose):
    return baked_rgba(('midhead', pose), _mid_head_img(pose))


@functools.lru_cache(maxsize=1)
def mid_bg_campus():
    """The avenue behind him, closer and out of focus."""
    def fn(cc):
        O.b_background(cc, DAY)
        cc.save()
        cc.saveLayer(None, skia.Paint(ImageFilter=skia.ImageFilters.Blur(9, 9)))
        cc.translate(720, 330)
        cc.scale(1.9, 1.9)
        cc.translate(-720, -HZ)
        _canopies(cc, 1.2)
        _shade_pools(cc, 0.0, 1.2)
        campus_wide().draw(cc, 1.0, 0.75)
        cc.restore()
        cc.restore()
        cc.drawRect(skia.Rect(0, 0, BW, H), paint(HOT, 0.36))
        glow(cc, 720, 40, 1300, HOT, 0.75)
    return baked(('midbg',), fn)


def side_walker(c, x, y, s, phase, facing=1, a=0.2, tone=FIG, blur=7):
    """A soft passer-by behind him (side view, out of focus). s = px per metre."""
    p = blurred(tone, a, blur / s)            # blur is in pixels; the canvas is in metres here
    c.save()
    c.translate(x, y)
    c.scale(s * facing, s)
    c.drawPath(path_of([(-0.16, -0.9), (0.14, -0.9), (0.16, -1.2), (0.12, -1.42), (-0.12, -1.44), (-0.18, -1.2)]), p)
    c.drawCircle(0.02, -1.56, 0.11, p)
    lp = blurred(tone, a, blur / s)
    lp.setStyle(skia.Paint.kStroke_Style)
    lp.setStrokeWidth(0.12)
    lp.setStrokeCap(skia.Paint.kRound_Cap)
    sw = math.sin(phase) * 0.28
    c.drawLine(0, -0.9, sw, -0.04, lp)
    c.drawLine(0, -0.9, -sw, -0.04, lp)
    lp.setStrokeWidth(0.08)
    c.drawLine(0, -1.38, -sw * 0.6, -0.95, lp)
    c.restore()


# =====================================================================
# 内景 某处: the other end of the line, seen from above
# =====================================================================
CUP_XY = (330, 250)
GLASSES_XY = (700, 170)


@functools.lru_cache(maxsize=1)
def xiao_table():
    d = Drawing(seed=1040, width=1.7, alpha=0.8)
    rng = np.random.default_rng(1040)
    # wood grain
    for k in range(16):
        y0 = 40 + k * 68 + rng.normal(0, 6)
        pts = [(x, y0 + 7 * math.sin(x / rng.uniform(150, 320) + k) + rng.normal(0, 0.5)) for x in range(-20, 1480, 60)]
        d.poly(pts, w=0.7, a=rng.uniform(0.10, 0.2), passes=1)
    # the milk tea from above: clear dome lid, the wide straw, a wet ring on the table
    cx, cy = CUP_XY
    d.ellipse(cx + 10, cy + 14, 124, 120, w=0.9, a=0.28, passes=1)
    d.ellipse(cx, cy, 120, 118, w=2.0)
    d.ellipse(cx, cy, 108, 106, w=1.1, a=0.55)
    d.ellipse(cx, cy, 56, 55, w=0.9, a=0.35, passes=1)
    rs = np.random.default_rng(1041)
    for k in range(26):
        r_ = 90 * math.sqrt(rs.random())
        th = rs.uniform(0, 2 * math.pi)
        d.ellipse(cx + r_ * math.cos(th), cy + r_ * math.sin(th), 9, 8.5, w=0.9, a=0.55, passes=1)
    sx0, sy0, sx1, sy1 = cx + 6, cy - 4, cx + 150, cy - 190
    for off in (-11, 11):
        d.line(sx0 + off, sy0 + off * 0.6, sx1 + off, sy1 + off * 0.6, w=1.4)
    d.ellipse(sx1, sy1, 13, 8, rot=math.atan2(sy1 - sy0, sx1 - sx0) + math.pi / 2, w=1.3)
    for k in range(9):
        th = rs.uniform(0, 2 * math.pi)
        d.ellipse(cx + 132 * math.cos(th), cy + 130 * math.sin(th), 3, 3, w=0.8, a=0.4, passes=1)
    # rimless glasses, folded, at the top of the table
    gx_, gy_ = GLASSES_XY
    for dx in (-54, 54):
        d.ellipse(gx_ + dx, gy_, 46, 28, w=1.0, a=0.6, passes=1)
        d.ellipse(gx_ + dx - 10, gy_ - 8, 16, 7, math.radians(200), math.radians(290), w=0.8, a=0.45, passes=1)
    d.curve([(gx_ - 10, gy_ - 10), (gx_, gy_ - 16), (gx_ + 10, gy_ - 10)], w=1.3)
    d.curve([(gx_ - 100, gy_ - 6), (gx_ - 30, gy_ + 24), (gx_ + 66, gy_ + 32), (gx_ + 112, gy_ + 24)], w=1.1, a=0.7)
    d.curve([(gx_ + 100, gy_ - 8), (gx_ + 30, gy_ + 18), (gx_ - 56, gy_ + 34), (gx_ - 108, gy_ + 28)], w=1.1, a=0.7)
    return d


def _xiao_bg(cc):
    O.b_background(cc, DAY)
    cc.drawRect(skia.Rect(0, 0, BW, H), paint(TEA, 0.13))
    glow(cc, 520, 380, 1100, TEA, 0.42)
    glow(cc, 1100, 900, 700, TEA, 0.2)
    cx, cy = CUP_XY
    cc.drawCircle(cx, cy, 104, paint((198, 150, 100), 0.30))          # the tea under the lid
    for k in range(26):
        rs = np.random.default_rng(1041 + k)
    rs = np.random.default_rng(1041)
    for k in range(26):
        r_ = 90 * math.sqrt(rs.random())
        th = rs.uniform(0, 2 * math.pi)
        cc.drawCircle(cx + r_ * math.cos(th), cy + r_ * math.sin(th), 8, paint((70, 48, 34), 0.45))


def xiao_insert(c, t, call_t, T):
    """Top-down: the milk tea, the glasses, a printed sheet with his family on it, the phone face up
    (all baked once); only the call timer runs."""
    blit(c, baked(('xiao_static',), _xiao_static))
    c.save()
    c.translate(930, 250)
    c.rotate(-7)
    secs = max(0, int(call_t))
    text(c, f'通话中  {secs // 60:02d}:{secs % 60:02d}', 130, 194, 'sans-light', 18, (236, 236, 232), 0.75, 'center', tracking=0.12)
    c.restore()


def _xiao_static(c):
    _xiao_page(c, None)


def _xiao_page(c, call_t):
    blit(c, baked(('xiaobg',), _xiao_bg))
    # the printed sheet (crisp print, like the card: an intruder on the page)
    c.save()
    c.translate(250, 400)
    c.rotate(-3.5)
    sh = paint((0, 0, 0), 0.14)
    sh.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 10))
    SW, SH = 520, 450
    c.drawRect(skia.Rect.MakeXYWH(6, 10, SW, SH), sh)
    c.drawRect(skia.Rect.MakeXYWH(0, 0, SW, SH), paint((249, 248, 244)))
    ink = (40, 40, 44)
    text(c, '客户资料', 40, 66, 'sans-medium', 27, ink, 0.9, tracking=0.3)
    c.drawLine(40, 86, SW - 40, 86, paint(ink, 0.5, 1.2))
    rows = [('姓名', '张朝阳'), ('学校', '· · · 大学  · · · 学院'), ('父亲', '建筑工地  · · · · · ·'),
            ('母亲', '在家养病'), ('家庭住址', '· · 省 · · 市 · · 县 · · ·'), ('联系电话', '1 3 · · · · · · · · ·')]
    for i, (k_, v_) in enumerate(rows):
        y = 140 + i * 54
        text(c, k_, 40, y, 'sans-light', 19, (110, 110, 110), 0.95, tracking=0.2)
        text(c, v_, 160, y, 'sans', 20, ink, 0.9, tracking=0.08)
        c.drawLine(160, y + 13, SW - 40, y + 13, paint(ink, 0.16, 1))
    c.restore()
    xiao_table().draw(c, 1.0)
    # his phone, face up, on speaker; the call timer runs
    c.save()
    c.translate(930, 250)
    c.rotate(-7)
    sh = paint((0, 0, 0), 0.22)
    sh.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 12))
    c.drawRoundRect(skia.Rect.MakeXYWH(8, 12, 260, 540), 34, 34, sh)
    c.drawRoundRect(skia.Rect.MakeXYWH(0, 0, 260, 540), 34, 34, paint((28, 28, 30)))
    c.drawRoundRect(skia.Rect.MakeXYWH(10, 10, 240, 520), 26, 26, paint((52, 54, 58)))
    wt = (236, 236, 232)
    text(c, '张朝阳', 130, 150, 'sans-light', 38, wt, 0.95, 'center', tracking=0.15)
    if call_t is not None:
        secs = max(0, int(call_t))
        text(c, f'通话中  {secs // 60:02d}:{secs % 60:02d}', 130, 194, 'sans-light', 18, wt, 0.75, 'center', tracking=0.12)
    for i, lab in enumerate(('静音', '免提', '挂断')):
        bx = 55 + i * 75
        on = (i == 1)
        c.drawCircle(bx, 424, 25, paint(wt, 0.9) if on else paint(wt, 0.5, 1.4))
        text(c, lab, bx, 478, 'sans-light', 14, wt, 0.6, 'center')
    c.restore()
    glow(c, 1050, 520, 380, (205, 214, 232), 0.10)


# =====================================================================
# ground level: his sneakers, and everyone else's feet
# =====================================================================
HG, GF, GH = 440, 1100.0, 0.24          # horizon, focal, camera height (m) for the ground shot


def gproj(z):
    s = GF / z
    return HG + GH * s, s


@functools.lru_cache(maxsize=1)
def ground_page():
    d = Drawing(seed=1050, width=1.3, alpha=0.6)
    # paving: joints running away from us, and across
    for k in range(-9, 10):
        xb = 720 + k * 330
        d.line(720 + (xb - 720) * 0.02, HG + 4, xb, 1100, w=0.8, a=0.3, passes=1)
    z = 0.28
    while z < 6:
        y, s = gproj(z)
        d.line(-20, y, 1460, y, w=0.8 if z < 1.5 else 0.6, a=0.3 if z < 1.5 else 0.18, passes=1)
        z += 0.3 if z < 1.2 else 0.6
    d.line(-20, HG, 1460, HG - 2, w=0.7, a=0.3)
    return d


def _ground_bg(cc):
    O.b_background(cc, DAY)
    # the far world at shoe height, out of focus: tree bases, a bench's legs, far feet
    cc.saveLayer(None, skia.Paint(ImageFilter=skia.ImageFilters.Blur(8, 8)))
    for (x, w_, h_) in ((150, 150, 520), (1210, 120, 480), (560, 60, 300), (980, 48, 240)):
        cc.drawRect(skia.Rect.MakeXYWH(x - w_ / 2, HG - h_, w_, h_ + 6), paint(GRAPHITE, 0.10))
    for x in (720, 760, 870, 905):
        cc.drawRect(skia.Rect.MakeXYWH(x, HG - 60, 8, 62), paint(GRAPHITE, 0.14))
    cc.restore()
    ground_page().draw(cc, 1.0, 0.8)
    cc.drawRect(skia.Rect(0, 0, BW, H), paint(HOT, 0.34))
    glow(cc, 720, 200, 1100, HOT, 0.7)
    # the sun on the paving where he is
    glow(cc, 700, 760, 700, HOT, 0.25)


@functools.lru_cache(maxsize=8)
def shoe(kind):
    """Side-view shoe, heel at x=0, toe at +L, sole bottom y=0; units = metres * 1000 (1 = 1 mm)."""
    d = Drawing(seed=1060 + hash(kind) % 50, width=4.0, alpha=0.85, wobble=2.5)
    if kind == 'leather':
        sole = [(0, 0), (262, 0), (275, -8), (270, -18), (0, -22)]
        d.poly(sole, closed=True)
        d.fill([(0, -22), (0, -70), (30, -84), (120, -78), (200, -52), (262, -34), (272, -18)], mix(PAPER, GRAPHITE, 0.55), 0.9)
        d.curve([(0, -22), (-4, -70), (30, -84), (120, -78), (200, -52), (262, -34), (274, -16)])
        d.curve([(40, -80), (120, -66), (180, -58)], w=2.4, a=0.5)
        d.rect(-6, -22, 60, 22, w=3.0)
    elif kind == 'runner':
        sole = [(0, 0), (280, 0), (292, -14), (286, -32), (0, -38), (-8, -18)]
        d.fill(sole, mix(PAPER, (255, 255, 255), 0.4), 1.0)
        d.poly(sole, closed=True)
        d.curve([(0, -38), (6, -96), (40, -118), (110, -108), (190, -74), (262, -54), (288, -32)])
        d.curve([(20, -60), (90, -80), (160, -56), (230, -48)], w=3.0, a=0.6)
        for j in range(5):
            d.line(96 + j * 20, -104 + j * 7, 112 + j * 20, -96 + j * 7, w=2.4)
        d.hatch(sole, angle=0, spacing=9, w=2, a=0.4)
    elif kind == 'girl':
        sole = [(0, 0), (224, 0), (232, -8), (226, -16), (0, -18)]
        d.fill([(0, -16), (0, -56), (24, -70), (60, -60), (150, -46), (210, -34), (228, -16)], mix(PAPER, (255, 255, 255), 0.5), 1.0)
        d.poly(sole, closed=True, w=3.2)
        d.curve([(0, -18), (-2, -56), (22, -70), (60, -62), (150, -48), (212, -34), (230, -14)], w=3.4)
        d.curve([(40, -62), (70, -86), (96, -64)], w=2.8)                         # the little strap
        d.ellipse(58, -72, 6, 6, w=2, a=0.7, passes=1)
    else:   # 'canvas' — a plain canvas shoe (not his)
        sole = [(0, 0), (270, 0), (280, -12), (272, -30), (0, -32)]
        d.fill(sole, mix(PAPER, (255, 255, 255), 0.35), 1.0)
        d.poly(sole, closed=True)
        d.curve([(0, -32), (4, -84), (44, -104), (116, -98), (200, -66), (262, -48), (276, -30)])
        for j in range(4):
            d.line(100 + j * 22, -96 + j * 8, 116 + j * 22, -88 + j * 8, w=2.4)
        d.hatch(sole, angle=0, spacing=8, w=2, a=0.35)
    return d


SHOE_LEN = {'leather': 0.275, 'runner': 0.29, 'girl': 0.23, 'canvas': 0.28}


class Feet:
    """A pair of walking feet seen from the side at ground level, from footstep keyframes.
    steps: [(t_lift, foot, x_from, x_to)] in metres along the ground (+x = right); swing 0.42 s."""
    def __init__(self, z, kind, steps, x0, leg='trousers', tone=None, swing=0.42, ghost=0.0, a=1.0):
        self.z, self.kind, self.steps, self.x0, self.leg, self.swing, self.ghost, self.a = z, kind, steps, list(x0), leg, swing, ghost, a
        self.tone = tone
        self.facing = 1 if steps and steps[-1][3] >= steps[0][2] else -1

    @staticmethod
    def walk(z, kind, t0, xa, xb, speed=1.3, stride=0.7, **kw):
        """Constant walk from xa to xb (metres), starting at scene time t0."""
        sgn = 1 if xb > xa else -1
        dt = stride / speed
        steps = []
        pos = [xa - sgn * stride * 0.5, xa]
        i = 0
        while min(p_ * sgn for p_ in pos) < xb * sgn:
            f = i % 2
            new = pos[1 - f] + sgn * stride
            steps.append((t0 + i * dt, f, pos[f], new))
            pos[f] = new
            i += 1
        return Feet(z, kind, steps, [xa - sgn * stride * 0.5, xa], swing=min(0.42, dt * 0.8), **kw)

    def foot(self, f, T):
        x = self.x0[f]
        for (tl, ff, xa, xb) in self.steps:
            if ff != f or tl > T:
                continue
            k = (T - tl) / self.swing
            if k >= 1:
                x = xb
                continue
            e = ease_in_out(k)
            lift = math.sin(math.pi * k) * 0.055
            ang = 26 * (1 - k) ** 2 * math.sin(math.pi * min(1, k * 1.6)) - 14 * math.sin(math.pi * k) * k
            return xa + (xb - xa) * e, lift, ang
        # pre-swing heel rise (just before the next lift of this foot)
        nxt = [tl for (tl, ff, _, _) in self.steps if ff == f and tl > T]
        if nxt and nxt[0] - T < 0.16:
            return x, 0.0, 22 * (1 - (nxt[0] - T) / 0.16)
        return x, 0.0, 0.0

    def active(self, T):
        return self.steps[0][0] - 3 < T < self.steps[-1][0] + self.swing + 0.1

    def plants(self):
        return [(tl + self.swing, xb) for (tl, ff, xa, xb) in self.steps]


def gx(xm, z):
    """Ground metres -> screen x at depth z (0 = screen centre)."""
    return 720 + xm * GF / z


def draw_feet(c, F, T, extra_ang=0.0, lift_heel=0.0, turn=0.0):
    _draw_feet(c, F, T, extra_ang, lift_heel, turn)


def _draw_feet(c, F, T, extra_ang=0.0, lift_heel=0.0, turn=0.0):
    yg, s = gproj(F.z)
    L = SHOE_LEN[F.kind]
    fac = F.facing
    sm = s / 1000.0                                  # shoe drawing units are mm
    feet = []
    for f in (0, 1):
        x, lift, ang = F.foot(f, T)
        feet.append((x, lift, ang))
    hip = (feet[0][0] + feet[1][0]) / 2 + fac * 0.05
    tone = F.tone or mix(PAPER, GRAPHITE, 0.12)
    for gi in ([2, 1, 0] if F.ghost > 0 else [0]):
        dt = gi * F.ghost
        ga = F.a * (1.0 if gi == 0 else 0.22 / gi)
        if dt:
            fe = [F.foot(f, T - dt) for f in (0, 1)]
            hp = (fe[0][0] + fe[1][0]) / 2 + fac * 0.05
        else:
            fe, hp = feet, hip
        # draw the back foot first
        order = sorted((0, 1), key=lambda f: fe[f][0] * fac)
        for f in order:
            x, lift, ang = fe[f]
            if f == 1 and extra_ang:
                ang += extra_ang
            if f == 0 and lift_heel:
                ang += lift_heel
            # heel x in metres: x is the foot centre
            hx = x - fac * L * 0.45
            sx = gx(hx, F.z)
            sy = yg - lift * s
            # the leg: ankle -> knee -> off the top
            ank = (gx(hx + fac * L * 0.2, F.z), sy - 0.085 * s)
            knee = (gx(hp + fac * 0.08 + (x - hp) * 0.35, F.z), yg - 0.5 * s)
            hipp = (gx(hp, F.z), yg - 0.95 * s)
            lw = (0.13 if F.leg != 'bare' else 0.075) * s
            if gi == 0 and lift < 0.03:
                shw = L * s * 1.05
                c.drawOval(skia.Rect.MakeXYWH(min(sx, sx + fac * L * s) - 0.03 * shw, yg - 0.012 * s, shw * 1.06, 0.026 * s),
                           blurred(GRAPHITE, 0.16 * ga * (1 - lift / 0.03), max(2.0, 0.006 * s)))
            path = skia.Path()
            path.moveTo(*ank); path.lineTo(*knee); path.lineTo(*hipp)
            pp = paint(GRAPHITE, 0.55 * ga, lw + max(2.2, 0.0032 * s))
            c.drawPath(path, pp)
            c.drawPath(path, paint(tone if F.leg != 'bare' else mix(PAPER, (255, 255, 255), 0.3), ga, lw))
            if F.leg == 'trousers':
                c.drawLine(ank[0] - lw * 0.5, ank[1] + 4, ank[0] + lw * 0.5, ank[1] + 2, paint(GRAPHITE, 0.6 * ga, 2.0))
            elif F.leg == 'track':
                c.drawOval(skia.Rect.MakeXYWH(ank[0] - lw * 0.55, ank[1] - lw * 0.1, lw * 1.1, lw * 0.4), paint(GRAPHITE, 0.5 * ga, 1.8))
            elif F.leg == 'bare':
                c.drawLine(ank[0] - lw * 0.55, ank[1] + 2, ank[0] + lw * 0.55, ank[1], paint(GRAPHITE, 0.5 * ga, 1.6))  # ankle sock
            c.save()
            c.translate(sx, sy)
            c.rotate(ang * fac, fac * L * 0.72 * s, 0)
            c.scale(fac * sm * (1 - 0.42 * turn), sm)
            c.clipRect(skia.Rect(-30, -150, 330, 30))          # keeps the drawing's layer small
            shoe(F.kind).draw(c, 1.0, ga)
            c.restore()
    if F.leg == 'skirt':
        pass


def draw_skirt(c, F, T, sway=0.0):
    yg, s = gproj(F.z)
    fe = [F.foot(f, T) for f in (0, 1)]
    hp = (fe[0][0] + fe[1][0]) / 2
    hem_y = yg - 0.44 * s
    x0 = gx(hp - 0.22 - 0.03 * sway, F.z)
    x1 = gx(hp + 0.22 - 0.03 * sway, F.z)
    pts = []
    for k in range(13):
        u = k / 12
        pts.append((x0 + (x1 - x0) * u, hem_y + 10 * math.sin(u * math.pi * 6 + sway * 2)))
    body = pts + [(x1 - 20, -10), (x0 + 20, -10)]
    c.drawPath(path_of(body), paint(mix(PAPER, (255, 255, 255), 0.25), 0.97))
    c.drawPath(path_of(pts, False), paint(GRAPHITE, 0.75, 2.4))
    for k in range(1, 12, 2):
        u = k / 12
        c.drawLine(x0 + (x1 - x0) * u, hem_y + 8, x0 + (x1 - x0) * u + 12 * (u - 0.5), -10, paint(GRAPHITE, 0.25, 1.4))


def draw_wheel(c, xc, yg, s, ang, a=1.0, ghost=0.0, v=0.0):
    """A bicycle wheel (r = 0.33 m) passing at ground level, spokes turning."""
    r = 0.33 * s
    for gi in ([3, 2, 1, 0] if ghost else [0]):
        x = xc - gi * ghost * v
        ga = a * (1.0 if gi == 0 else 0.25 / gi)
        yc = yg - r
        c.drawCircle(x, yc, r, paint(GRAPHITE, 0.8 * ga, max(2.0, 0.035 * s)))
        c.drawCircle(x, yc, r * 0.9, paint(GRAPHITE, 0.55 * ga, max(1.2, 0.012 * s)))
        c.drawCircle(x, yc, 0.03 * s, paint(GRAPHITE, 0.8 * ga, 2.0))
        for k in range(18):
            th = ang + k * 2 * math.pi / 18
            c.drawLine(x, yc, x + math.cos(th) * r * 0.9, yc + math.sin(th) * r * 0.9, paint(GRAPHITE, 0.35 * ga, max(0.8, 0.004 * s)))


def draw_bike_side(c, xb, z, T, t0, v, direction=1, ghost=True, a=1.0):
    """The lower half of a bicycle passing at ground level: two wheels, the chain stay, a crank with
    the rider's shoe on the pedal. xb = rear-hub x (metres) at time t0; v = m/s."""
    yg, s = gproj(z)
    dx = direction * v * (T - t0)
    rear = xb + dx
    front = rear + direction * 1.02
    ang = dx / 0.33
    for (hx) in (rear, front):
        draw_wheel(c, gx(hx, z), yg, s, ang, a, ghost=0.03 * s if ghost else 0.0, v=direction * v * 0.35)
    bb = rear + direction * 0.42
    bbx, bby = gx(bb, z), yg - 0.28 * s
    p = paint(GRAPHITE, 0.75 * a, max(2.0, 0.03 * s))
    c.drawLine(gx(rear, z), yg - 0.33 * s, bbx, bby, p)
    c.drawLine(bbx, bby, gx(bb + direction * 0.5, z), yg - 0.9 * s, p)
    c.drawLine(gx(front, z), yg - 0.33 * s, gx(front - direction * 0.08, z), yg - 0.95 * s, p)
    c.drawCircle(bbx, bby, 0.09 * s, paint(GRAPHITE, 0.6 * a, max(1.5, 0.012 * s)))
    cr = ang * 0.55
    px, py = bbx + math.cos(cr) * 0.17 * s, bby + math.sin(cr) * 0.17 * s
    c.drawLine(bbx, bby, px, py, paint(GRAPHITE, 0.8 * a, max(2.0, 0.025 * s)))
    c.save()
    c.translate(px - 0.12 * s * direction, py - 0.03 * s)
    c.scale(direction * s / 1000.0, s / 1000.0)
    c.clipRect(skia.Rect(-30, -150, 330, 30))
    shoe('runner').draw(c, 1.0, a * 0.9)
    c.restore()


HIS_Z = 0.72
SHOE_FILL = [(-5, 150), (305, 150), (305, 132), (280, 105), (200, 90), (150, 60), (140, 8), (90, 10), (70, 42),
             (60, 40), (10, 70), (0, 132)]


HIS_FEET = ((-0.16, -0.024, 0.86), (-0.28, 0.0, 1.0))      # (heel x m, lift m, tone) far foot, then near foot


def _shin_geom(hx, oy):
    """One crouching leg of his jeans: the hem sits on the shoe collar, the shin rises to the knee."""
    z = HIS_Z
    yg, s = gproj(z)
    A = np.array([gx(hx + 0.078, z), yg - 0.108 * s + oy])
    K = np.array([gx(hx + 0.40, z), yg - 0.60 * s + oy])
    u = (K - A) / np.linalg.norm(K - A)
    n = np.array([u[1], -u[0]])            # points to the upper-left (the calf side)
    w0, w1 = 0.052 * s, 0.058 * s
    Bb, Bf = A + n * w0, A - n * w0
    Kb, Kf = K + n * w1, K - n * w1
    calf = Bb + (Kb - Bb) * 0.40 + n * 0.010 * s
    return dict(Bb=Bb, Bf=Bf, A=A, K=K, u=u, n=n, s=s, Kb=Kb, Kf=Kf, calf=calf)


@functools.lru_cache(maxsize=2)
def his_shin(i):
    """His jeans, crouching: shin rising from the sneaker toward the knee (pencil, airy)."""
    hx, dy, k = HIS_FEET[i]
    g = _shin_geom(hx, dy * s_of(HIS_Z))
    Bb, Bf, A, K, u, n, s = g['Bb'], g['Bf'], g['A'], g['K'], g['u'], g['n'], g['s']
    d = Drawing(seed=1080 + i, width=2.1, alpha=0.8 * k)
    d.curve([tuple(Bf), tuple(g['Kf'])], w=2.0)
    d.curve([tuple(Bb), tuple(g['calf']), tuple(g['Kb'])], w=2.0)
    # hem: bunched, a soft wave across the ankle; folds stacked above it
    d.curve([tuple(Bb + u * 4), tuple(A + u * 12 + n * 10), tuple(A + u * 2 - n * 12), tuple(Bf + u * 6)], w=1.8)
    for off in (0.04, 0.075, 0.11):
        c0 = A + u * off * s
        d.curve([tuple(c0 + n * 0.048 * s), tuple(c0 + n * 0.012 * s + u * 8), tuple(c0 - n * 0.02 * s + u * 2)], w=0.9, a=0.42)
    # denim tone only on the calf side, along the leg
    hp = [tuple(p) for p in (A + n * w * 0 + u * 20 for w in (0,))] if False else None
    shade = [tuple(Bb + u * 30 - n * 0.01 * s), tuple(g['Kb'] - n * 0.018 * s), tuple(g['Kb']), tuple(g['calf']), tuple(Bb + u * 20)]
    d.hatch(shade, angle=math.degrees(math.atan2(u[1], u[0])) + 10, spacing=6, w=0.65, a=0.3 * k)
    d.curve([tuple(A - n * 0.022 * s + u * 0.05 * s), tuple(K - n * 0.022 * s)], w=0.8, a=0.25)     # outer seam
    return d


def s_of(z):
    return GF / z


def _his_group(cc):
    z = HIS_Z
    yg, s = gproj(z)
    sc_ = s * 0.28 / 300.0
    # his shadow: noon, pooled right under him
    cc.drawOval(skia.Rect.MakeXYWH(gx(-0.55, z), yg - 0.026 * s, 1.02 * s, 0.062 * s), blurred(GRAPHITE, 0.16, 16))
    cc.drawOval(skia.Rect.MakeXYWH(gx(-0.32, z), yg - 0.010 * s, 0.56 * s, 0.024 * s), blurred(GRAPHITE, 0.2, 5))
    for i, (hx, dy, k) in enumerate(HIS_FEET):
        oy = dy * s
        g = _shin_geom(hx, oy)
        cc.save()
        cc.translate(gx(hx, z), yg - 150 * sc_ + oy)
        cc.scale(sc_, sc_)
        cc.drawPath(path_of(SHOE_FILL), paint(mix(PAPER, (255, 255, 255), 0.35 - 0.2 * (1 - k)), 1.0))
        cc.clipRect(skia.Rect.MakeXYWH(-40, -20, 360, 200))
        O.shoes(51, 0, 0, 1.0).draw(cc, 1.0, k)
        cc.restore()
        poly = [tuple(g['Bb']), tuple(g['Bf']), tuple(g['Kf']), tuple(g['Kb']), tuple(g['calf'])]
        cc.drawPath(path_of(poly), paint(mix(PAPER, (255, 255, 255), 0.25), 1.0))
        smudge(cc, [tuple(p) for p in (g['Bb'] + g['u'] * 30, g['K'] + g['n'] * 0.02 * g['s'], g['Kb'], g['calf'])], GRAPHITE, 0.05 * k, 10)
        his_shin(i).draw(cc, 1.0)


def his_feet(c, a=1.0):
    """His washed-out sneakers (the shared O.shoes drawing), one a little behind the other, the
    jeans rising from them toward the knees (he is crouching, facing right). Nothing here moves."""
    blit(c, baked_rgba(('hisfeet', HIS_Z), _his_group), a)


# =====================================================================
# sounds
# =====================================================================
def bike_bell(seed=1, far=True):
    rng = np.random.default_rng(seed)
    f0 = rng.uniform(2150, 2400)
    tt = _t(1.6)
    out = np.zeros(int(2.0 * SR), np.float32)
    for k, off in enumerate((0.0, 0.19)):
        x = np.zeros_like(tt)
        for (m, a, dec) in ((1.0, 1.0, 2.4), (1.0031, 0.8, 2.6), (2.72, 0.42, 4.5), (5.08, 0.18, 8.0)):
            x += a * np.sin(2 * np.pi * f0 * m * tt + rng.uniform(0, 6)) * np.exp(-tt * dec)
        x *= np.minimum(1, tt / 0.0015) * (1.0 if k == 0 else 0.8)
        s = int(off * SR)
        out[s:s + len(x)] += x[:len(out) - s].astype(np.float32)
    y = out * 0.22
    if far:
        y = reverb(lowpass(y, 4200), wet=0.55, decay=1.3, size='hall')
    return y.astype(np.float32)


def moving_pan(x, p):
    p = np.clip(p, -1, 1)
    return np.stack([x * np.cos((p + 1) * np.pi / 4) * 1.4142, x * np.sin((p + 1) * np.pi / 4) * 1.4142], 1).astype(np.float32)


def bike_pass(d=2.4, seed=3, pan0=-0.9, pan1=0.9, width=0.35, tick=True):
    t = _t(d)
    tc = d * 0.5
    env = 1.0 / (1.0 + ((t - tc) / width) ** 2)
    hiss = bandpass(sfx.noise(d, seed), 350, 3200) * env * 0.22
    x = hiss
    if tick:
        ticks = np.zeros_like(t)
        for k in range(int(d * 22)):
            s = int(k / 22 * SR)
            c_ = sfx.click(seed + k, 5200, 0.006, 0.25)
            ticks[s:s + len(c_)] += c_[:len(ticks) - s]
        x = x + ticks * (0.35 + 0.65 * env)
    p = pan0 + (pan1 - pan0) * np.clip((t - (tc - width * 2)) / (width * 4), 0, 1)
    return moving_pan(x.astype(np.float32), p)


def laugh_far(seed=5, n=6, f0=250.0):
    rng = np.random.default_rng(seed)
    out = np.zeros(int((n * 0.22 + 0.6) * SR), np.float32)
    pos = 0.0
    for i in range(n):
        d = rng.uniform(0.08, 0.12)
        tt = _t(d)
        f = f0 * (1 - 0.2 * i / n) * (1 + 0.05 * np.sin(np.pi * tt / d))
        ph = 2 * np.pi * np.cumsum(f) / SR
        src = sum(np.sin(k * ph) / k ** 1.1 for k in range(1, 22))
        v = bandpass(src, 650, 1150) + 0.5 * bandpass(src, 1150, 1500) + 0.22 * bandpass(src, 2400, 3100)
        v = v * np.sin(np.pi * tt / d) ** 1.4
        hn = int(0.045 * SR)
        h = bandpass(sfx.noise(0.045, seed + i), 700, 4200) * np.linspace(0, 1, hn) ** 2 * 0.25
        seg = np.concatenate([h, v]).astype(np.float32) * (1 - 0.1 * i)
        s = int(pos * SR)
        out[s:s + len(seg)] += seg[:len(out) - s]
        pos += rng.uniform(0.17, 0.21)
    return reverb(lowpass(out * 0.2, 3000), wet=0.6, decay=1.2, size='hall').astype(np.float32)


def step_sound(kind, seed):
    f = sfx.footstep(seed, 1.0)
    if kind == 'leather':
        f = f * 0.8
        f[:len(f)] += np.concatenate([sfx.click(seed, 3600, 0.025, 0.5), np.zeros(len(f) - int(0.025 * SR), np.float32)])[:len(f)]
    elif kind == 'girl':
        f = highpass(f, 260) * 0.7
    elif kind == 'runner':
        f = lowpass(f, 1200) * 0.9
    return f


def ring_in_pocket(d):
    x = sfx.phone_ring(d)
    return lowpass(x, 1600) * 0.9


def cloth(seed=1, d=0.9):
    tt = _t(d)
    x = bandpass(sfx.noise(d, seed), 300, 2400) * np.sin(np.pi * tt / d) ** 1.5 * (0.6 + 0.4 * np.sin(2 * np.pi * 5 * tt))
    return (x * 0.18).astype(np.float32)


# =====================================================================
# the scene
# =====================================================================
def build():
    sc = Scene('s10_d03', kind='B', title='第十场【倒计时】')

    campus = sfx.campus(60, 1003)
    campus_m = lowpass(campus, 650) * 1.6

    # ---------------- countdown card ----------------
    sc.wait(0.4)
    t0 = sc.t

    def card(c, t, L):
        paper_bg(c)
        O.countdown_card(c, DAY, t)
    sc.layer(card, t0, t0 + 4.9, fin=0.8, fout=0.8)
    sc.sfx(sfx.pencil(1.6, 1004), at=t0 + 0.8, gain=-16)
    sc.wait(4.4)

    # ---------------- wide 1: noon; he walks into the avenue, head down ----------------
    t_w1 = sc.t
    W1 = 11.0
    ZA, ZB = 2.35, 6.9

    def zh_w1(T):
        u = clamp((T - t_w1) / W1)
        z = ZA + (ZB - ZA) * u
        return dict(X=0.12, z=z, phase=(z - ZA) / 0.5 * math.pi, walking=True)
    w1_walkers = [
        walker(t_w1 - 5, -1.5, 26, -1.9, 1.8, 1.3, a=0.26),
        walker(t_w1 - 4, 1.6, 6.0, 1.4, 50, 1.2, a=0.24),
        walker(t_w1 - 1, 0.9, 34, 0.7, 13, 1.1, kind='skirt', a=0.2),
        walker(t_w1 - 1, 1.25, 34.5, 1.05, 13.5, 1.1, kind='person', a=0.2, sx=0.95),
        walker(t_w1 + 1.0, -22, 24, 22, 24, 4.2, a=0.22, bike=True),
    ]

    def wide1(c, t, L):
        wide_bg(c)
        draw_crowd(c, L.T, w1_walkers, zh_w1(L.T))
    sc.layer(wide1, t_w1, t_w1 + W1 + 0.4, fin=1.0, fout=0.35)
    sc.sfx(sfx.footsteps(16, 0.66, 1005, a=0.5), at=t_w1 + 0.3, gain=-22, fout=3.0)
    sc.sfx(bike_pass(8.0, 1006, -0.8, 0.8, 1.2), at=t_w1 + 1.0, gain=-20)
    sc.wait(W1)

    # ---------------- medium: his back ----------------
    t_m = sc.t
    t_ring = t_m + 6.0
    t_stop = t_m + 6.6
    t_ans = t_m + 11.6

    def bob(T):
        k = 1.0 - smooth((T - t_stop) / 0.8)
        ph = (T - t_m) * 2.9
        return 6.0 * abs(math.sin(ph)) * k, 0.5 * math.sin(ph) * k

    t_hang_ref = [t_ans + 40.0]
    bows = []                                   # (t, deg): the head sinks further during the plea

    def head_bow(T):
        b = 0.0
        for (tb, deg, dur) in bows:
            b += deg * smooth((T - tb) / dur)
        return b

    def glare(T):
        return smooth((T - (t_ans + 2.0)) / 18.0)

    mid_walkers = [(t_m + 1.5, 330, 5.6, 1, 150), (t_m + 3.2, 1460, 4.8, -1, 120), (t_m + 9.0, -100, 6.2, 1, 480),
                   (t_ans + 4.0, 1480, 5.0, -1, 140), (t_ans + 13.0, -120, 5.4, 1, 130), (t_ans + 24.0, 1500, 5.0, -1, 150),
                   (t_ans + 31.0, -100, 6.0, 1, 520)]

    def medium(c, t, L):
        T = L.T
        push = 1.0 + 0.10 * smooth((T - t_ans) / max(1.0, t_hang_ref[0] - t_ans))
        c.save()
        c.translate(CX, 400)
        c.scale(push, push)
        c.translate(-CX, -400)
        blit(c, mid_bg_campus())
        for (ts, x0, sm, fac, v) in mid_walkers:
            if ts <= T <= ts + 16:
                x = x0 + fac * v * (T - ts)
                if -200 < x < 1650:
                    sp = 150 * sm / 5.6
                    side_walker(c, x, 330 + 1.6 * sp, sp, (T - ts) * 7.0 * (v / 150) ** 0.4, fac, 0.16, blur=8)
        g = glare(T)
        if g > 0:
            blit(c, baked(('glare_a',), lambda cc: cc.drawRect(skia.Rect(0, 0, BW, H), paint(HOT, 0.30)), transparent=True), g)
        dy, rot = bob(T)
        phone_k = smooth((T - t_ans + 0.6) / 0.7)
        bw = head_bow(T)
        c.save()
        c.translate(0, dy + 20)
        c.rotate(rot, CX, 1080)
        for pose, k in (('walk', 1 - phone_k), ('phone', phone_k)):
            if k <= 0.01:
                continue
            c.save()
            c.rotate(bw, CX, 500)
            c.translate(0, bw * 1.8)
            blit_rect(c, mid_head_img(pose), HEAD_RECT, k)
            c.restore()
            blit_rect(c, mid_body_img(pose), BODY_RECT, k)
        c.restore()
        c.restore()
        # the world keeps going white around him while the voice talks
        if g > 0:
            blit(c, baked(('glare_b',), lambda cc: glow(cc, 720, 0, 1300, HOT, 0.55), transparent=True), g)
    sc.layer(medium, t_m - 0.35, None, fin=0.35, name='medium')

    sc.caption('他瘦了一圈。', start=t_m + 1.0, dur=2.6)
    sc.caption('同一件卫衣，穿了快两周。', start=t_m + 3.9, dur=3.6)
    sc.sfx(sfx.footsteps(10, 0.54, 1007, a=0.6), at=t_m + 0.1, gain=-17, fout=0.4)
    # the phone, in the front pocket of the hoodie
    sc.sfx(ring_in_pocket(t_ans - t_ring - 0.2), at=t_ring, gain=-19, fout=0.1)
    sc.sfx(sfx.vibrate(t_ans - t_ring - 0.2, 1008), at=t_ring, gain=-28, fout=0.1)
    sc.sfx(cloth(1009, 0.8), at=t_ans - 0.9, gain=-14)
    sc.sfx(sfx.click(1010, 2400, 0.03, 0.4), at=t_ans - 0.05, gain=-14)
    sc.at(t_ans + 1.0)

    # the other end's room, heard through the line
    cafe_line = sfx.cafe(60, 1011)
    cafe_line = np.asarray(bandpass(cafe_line[:, 0], 320, 3300, 3), np.float32) * 1.4

    # ---------------- the call ----------------
    sc.say('xiao', '张朝阳同学。最后一次。', fx='phone', speed=0.93, post=0.9)
    t_ins = sc.t - 0.35
    sc.say('xiao', '你爸工地上班，你妈在家养病。他们的地址我都有。', fx='phone', speed=0.95, post=0.5)
    sc.say('xiao', '你要是还不上，我不介意亲自去找他们聊聊。', tts='你要是环不上，我不介意亲自去找他们聊聊。',
           fx='phone', speed=0.95, post=0.6)
    t_ins_end = sc.t - 0.2

    def insert(c, t, L):
        xiao_insert(c, t, L.T - t_ans, L.T)
    sc.layer(insert, t_ins, t_ins_end, z=2, fin=0.25, fout=0.3)

    sc.say('xiao', '让他们看看他们的好儿子在学校干了什么——', fx='phone', speed=0.95, post=0.25)
    sc.say('xiao', '借高利贷，还不上钱，连电话都不敢接。', tts='借高利贷，环不上钱，连电话都不敢接。', fx='phone', speed=0.95, post=1.6)
    bows.append((sc.t - 0.9, 3.5, 1.6))
    sc.say('zhang', '求你……不要找他们……', fx='dry', gain=-8, speed=0.8, note='声音几乎听不到', post=1.1)
    sc.say('xiao', '那你说怎么办。', fx='phone', speed=0.95, post=1.4)
    sc.say('zhang', '给我一点时间……', fx='dry', gain=-8, speed=0.8, note='声音几乎听不到', post=0.9)
    bows.append((sc.t - 1.8, 2.5, 2.0))
    sc.say('xiao', '我给了你多少时间了？', fx='phone', speed=0.93, post=0.7)
    sc.say('xiao', '你要时间，我可以给。', fx='phone', speed=0.93, post=0.55)
    sc.say('xiao', '违约金照算。', fx='phone', speed=0.9, post=0.15)
    t_hang = sc.t + 0.1
    t_hang_ref[0] = t_hang
    sc.sfx(cafe_line[: int((t_hang - t_ans) * SR)], at=t_ans, gain=-19, fin=0.3, fout=0.1, bus='amb')
    sc.sfx(sfx.click(1012, 1800, 0.02, 0.5), at=t_hang, gain=-12)
    sc.sfx(sfx.busy_tone(5), at=t_hang + 0.25, gain=-13, fout=0.5)
    sc.at(t_hang + 3.4)
    # the campus goes dull while the voice is in his ear
    sc.amb(campus, t_w1 - 1.5, t_ans + 0.5, gain=5, fin=2.0, fout=0.8)

    # ---------------- wide 2: he stands in the middle of the path; then he sinks ----------------
    t_w2 = sc.t
    ZS = 7.6
    t_crouch = t_w2 + 6.4
    CR = 1.7
    W2 = 10.6
    for ly in sc.layers:
        if ly.name == 'medium':
            ly.end = t_w2 + 0.1
    w2_walkers = [
        walker(t_w2 - 6, -0.7, 16, -1.9, 1.8, 1.3, a=0.26, avoid=(0.12, ZS, -1, t_w2 - 8)),
        walker(t_w2 - 3, 1.3, 3.5, 0.9, 40, 1.2, kind='skirt', a=0.24, avoid=(0.12, ZS, 1, t_w2 - 5)),
        walker(t_w2 + 3.5, 1.9, 1.8, 0.5, 40, 1.3, a=0.28, avoid=(0.12, ZS, 1, t_w2 - 5)),
        walker(t_w2 + 1.5, -23, 28, 23, 28, 4.5, a=0.2, bike=True),
        walker(t_w2 + 2.0, -1.6, 45, -1.4, 10, 1.2, a=0.2),
    ]

    def zh_w2(T):
        return dict(X=0.12, z=ZS, crouch=ramp(T, t_crouch, t_crouch + CR))

    def wide2(c, t, L):
        wide_bg(c)
        draw_crowd(c, L.T, w2_walkers, zh_w2(L.T))
    sc.layer(wide2, t_w2, t_w2 + W2, fin=0.2, fout=0.3)
    sc.amb(campus, t_hang + 0.4, None, gain=6, fin=2.5, fout=5.0)
    sc.amb(campus_m, t_ans + 0.3, t_hang + 1.6, gain=1, fin=0.8, fout=1.6)
    sc.sfx(laugh_far(1013, 6, 250.0), at=t_w2 + 2.2, gain=-15, pan=0.6)
    sc.sfx(laugh_far(1014, 4, 205.0), at=t_w2 + 2.5, gain=-18, pan=0.7)
    sc.sfx(bike_bell(1015, far=True), at=t_w2 + 1.4, gain=-20, pan=-0.4)
    sc.sfx(bike_pass(7.0, 1016, -0.8, 0.8, 1.4), at=t_w2 + 2.0, gain=-22)
    sc.sfx(cloth(1017, 1.3), at=t_crouch + 0.1, gain=-12)
    sc.at(t_w2 + W2)

    # ---------------- ground level: his sneakers do not move ----------------
    t_g = sc.t
    G = 27.0
    feet = [
        Feet.walk(1.5, 'leather', t_g + 0.6, -1.3, 1.4, speed=1.25, stride=0.68, leg='trousers', tone=mix(PAPER, GRAPHITE, 0.3)),
        Feet.walk(0.42, 'runner', t_g + 2.6, 0.9, -0.9, speed=1.6, stride=0.8, leg='track', ghost=0.035),
        Feet.walk(1.9, 'canvas', t_g + 5.2, 1.7, -1.8, speed=1.35, stride=0.66, leg='jeans'),
        Feet.walk(2.05, 'canvas', t_g + 5.45, 1.75, -1.8, speed=1.35, stride=0.64, leg='bare'),
        Feet.walk(1.35, 'runner', t_g + 17.4, 1.5, -1.5, speed=1.5, stride=0.74, leg='track'),
        Feet.walk(0.5, 'leather', t_g + 20.2, -0.9, 0.9, speed=1.4, stride=0.72, leg='trousers', ghost=0.03,
                  tone=mix(PAPER, GRAPHITE, 0.3)),
    ]
    # the girl: walks in from the left, a last small step to bring her feet together, two seconds, on
    GZ = 1.08
    tg0 = t_g + 8.2
    gs = []
    x = -1.55
    pos = [x - 0.3, x]
    tt = tg0
    for i in range(3):
        f = i % 2
        new = pos[1 - f] + 0.62
        gs.append((tt, f, pos[f], new))
        pos[f] = new
        tt += 0.52
    tt += 0.08
    gs.append((tt, 1, pos[1], pos[0] + 0.12))               # hesitates: feet together
    pos[1] = pos[0] + 0.12
    t_girl_stop = tt + 0.42
    t_girl_go = t_girl_stop + 2.0
    tt = t_girl_go
    for i in range(4):
        f = i % 2
        new = pos[1 - f] + 0.62
        gs.append((tt, f, pos[f], new))
        pos[f] = new
        tt += 0.5
    girl = Feet(GZ, 'girl', gs, [x - 0.3, x], leg='bare', swing=0.4)

    wheel_passes = [(t_g + 4.1, -2.6, 1.45, 5.2, 1), (t_g + 13.6, 1.9, 0.52, 6.0, -1)]
    def ground(c, t, L):
        T = L.T
        blit(c, baked(('ground',), _ground_bg))
        # far things first: people behind him, the far bicycle, the girl, then him, then the near ones
        for F in sorted(feet + [girl], key=lambda f: -f.z):
            if F.z > HIS_Z and F.active(T):
                if F is girl:
                    sway = math.sin(T * 2.4) * (0.3 if t_girl_stop < T < t_girl_go else 1.0)
                    heel = 9 * smooth((T - (t_girl_stop + 0.55)) / 0.3) * (1 - smooth((T - (t_girl_stop + 1.35)) / 0.3))
                    turn = smooth((T - (t_girl_stop + 0.1)) / 0.45) * (1 - smooth((T - (t_girl_go - 0.35)) / 0.35))
                    draw_feet(c, F, T, lift_heel=heel, turn=turn)
                    draw_skirt(c, F, T, sway)
                else:
                    draw_feet(c, F, T)
        for (tw, xb, z, v, dr) in wheel_passes:
            if z > HIS_Z and tw - 0.2 < T < tw + 3.0:
                draw_bike_side(c, xb, z, T, tw, v, dr)
        his_feet(c)
        for F in feet:
            if F.z <= HIS_Z and F.active(T):
                draw_feet(c, F, T)
        for (tw, xb, z, v, dr) in wheel_passes:
            if z <= HIS_Z and tw - 0.2 < T < tw + 2.0:
                draw_bike_side(c, xb, z, T, tw, v, dr)
    sc.layer(ground, t_g, t_g + G, fin=0.15, fout=0.9)
    # sound of the ground shot: each planted step, panned where it lands
    for F in feet + [girl]:
        for k, (tp, xm) in enumerate(F.plants()):
            if t_g < tp < t_g + G:
                pan = clamp(xm * 1.0 / F.z * 0.9, -1, 1) if False else max(-1.0, min(1.0, (gx(xm, F.z) - 720) / 800))
                g = -13 - 12 * (F.z - 0.4) / 1.8
                if F is girl:
                    g = -16
                sc.sfx(step_sound(F.kind, int(tp * 100) + k), at=tp - 0.02, gain=g, pan=pan)
    for (tw, xb, z, v, dr) in wheel_passes:
        near = z < HIS_Z
        w_ = 0.12 if near else 0.3
        sc.sfx(bike_pass(2.4, int(tw * 10), -0.9 * dr, 0.9 * dr, w_), at=tw + (abs(xb) / v) - 1.2, gain=-12 if near else -17)
    sc.sfx(bike_bell(1018, far=True), at=t_g + 1.8, gain=-22, pan=0.5)
    sc.sfx(bike_bell(1019, far=True), at=t_g + 21.5, gain=-25, pan=-0.6)
    sc.sfx(laugh_far(1020, 5, 270.0), at=t_g + 11.0, gain=-24, pan=-0.5)
    sc.at(t_g + G - 0.9)

    # ---------------- the final wide: a long time in the sun ----------------
    t_f = sc.t
    F_LEN = 21.0
    f_walkers = [
        walker(t_f - 4, 1.5, 3.0, 1.2, 48, 1.15, kind='person', a=0.2, avoid=(0.12, ZS, 1, t_f - 6)),
        walker(t_f + 3.0, -20, 20, 20, 20, 4.3, a=0.16, bike=True),
        walker(t_f + 5.0, -1.5, 40, -1.9, 1.8, 1.2, kind='skirt', a=0.18, avoid=(0.12, ZS, -1, t_f - 5)),
    ]

    def final(c, t, L):
        T = L.T
        k = smooth(t / F_LEN)
        blit(c, baked(('wide', 0.0, 0.40), lambda cc: _wide_bg(cc, 0.0, 0.40)))
        blit(c, baked(('wide', 1.6, 0.46), lambda cc: _wide_bg(cc, 1.6, 0.46)), k)
        draw_crowd(c, T, f_walkers, dict(X=0.12, z=ZS, crouch=1.0))
        # the noon light keeps rising until the page is almost empty
        c.drawRect(skia.Rect(0, 0, L.w, L.h), paint(HOT, 0.55 * smooth((t - 8) / (F_LEN - 8)) ** 1.3))
    sc.layer(final, t_f, t_f + F_LEN, fin=0.9, fout=2.4)
    sc.wait(3.2)
    sc.narr('他一个人蹲在阳光里，很久。', post=0.5, speed=0.9)
    sc.sfx(bike_bell(1021, far=True), at=t_f + 9.5, gain=-27, pan=0.7)
    sc.at(t_f + F_LEN)
    # the campus thins away at the very end
    sc.finish(tail=0.2)
    return sc

"""第十三场【倒计时 → 终点】 内景 宿舍楼楼道 ／ 天台 夜 — 5月8日 23:47.

No countdown any more: a date card. The sketchbook page is shaded almost black; graphite only
catches the light where the emergency lamps touch it. One page per floor, always the same
framing (the same stairwell, again and again): the solid parapet in the foreground, the flight
rising to the upper left into the dark, the floor number painted on the wall. He passes each
landing — only his upper body shows above the parapet. 4F: a door ajar at the end of the
corridor, light, voices. 5F: the vending machine's green light on the wall. Top: the iron door.
His voice-over. The camera never goes out: the door frame from the inside, the deep blue sky,
his back getting smaller. Then down to the threshold: a crack in the concrete (the same crack
Li wakes up to on the bed board). Wind. Black."""
import math, functools
import numpy as np
import skia
from film.config import *
from film.gfx import *
from film.timeline import Scene
from film.sketch import Drawing, smudge, _catmull
from film import objects as O, sfx
from film.audio import reverb, lowpass, highpass, bandpass, env_fade, normalize

PAGE = (31, 30, 29)            # the sketchbook page, shaded almost black with graphite
INK = (176, 170, 160)          # graphite catching the light
EMER = (228, 188, 100)         # emergency lamps: dim yellow
GREEN = (70, 214, 130)         # vending machine
WARM = (252, 228, 176)         # a lit room behind a door
SIL = (6, 6, 8)                # him
SKY0 = (8, 15, 38)
SKY1 = (30, 52, 104)
ROOF0 = (26, 32, 48)
ROOF1 = (12, 14, 20)
SUBC = (218, 212, 200)

# =====================================================================
# the page
# =====================================================================
def page(c, w=BW, h=H):
    c.drawImage(paper(w, h, PAGE, 13, 0.7, 1.5), 0, 0)

def page_tall(c):
    c.drawImage(paper(BW + 400, H + 700, PAGE, 14, 0.7, 1.5), -200, -150)

_BAKED = {}
def baked(key, fn, clear=None):
    """Render a static part of a page once (fn(c)) and keep it as an image."""
    if key not in _BAKED:
        surf = skia.Surface(BW, H)
        c = surf.getCanvas()
        c.clear(skia.ColorTRANSPARENT if clear is None else col(clear))
        fn(c)
        _BAKED[key] = surf.makeImageSnapshot()
    return _BAKED[key]

def light_map(c, x, y, r, w=BW, h=H, dark=0.9, pow_=1.0):
    """Everything the lamp doesn't reach sinks back into the page."""
    sh = skia.GradientShader.MakeRadial((x, y), r, [col(BLACK, 0), col(BLACK, 0.18 * dark), col(BLACK, dark)],
                                        [0.0, 0.45, 1.0])
    c.drawRect(skia.Rect(-(w - BW) / 2, -150, w - (w - BW) / 2, h), skia.Paint(Shader=sh))

def lamp_box(d, x, y):
    """Wall-mounted emergency light: a small box with two round heads."""
    d.rect(x - 48, y - 16, 96, 32, w=1.4)
    d.ellipse(x - 26, y + 26, 13, 9, w=1.2)
    d.ellipse(x + 26, y + 26, 13, 9, w=1.2)
    d.line(x - 26, y + 16, x - 26, y + 18, w=1.0)
    d.line(x + 26, y + 16, x + 26, y + 18, w=1.0)

# =====================================================================
# one floor: the same framing every time
# =====================================================================
LAMP_XY = (905, 150)
PAR_Y = 700                    # the foreground parapet (handrail) — his legs are behind it
FEET_Y = 905                   # the landing he walks on (hidden)
FL_X0 = 585                    # the flight starts here and rises to the upper left
SLOPE = 0.76
CORR = (628, 848, 262)         # corridor opening x0, x1, top

def flight_top(x):
    """The flight's parapet top (screen y) at x."""
    return PAR_Y - (FL_X0 - x) * SLOPE

def parapet_poly():
    x_end = -60
    return [(1500, PAR_Y), (FL_X0, PAR_Y), (x_end, flight_top(x_end)), (x_end, H + 20), (1500, H + 20)]

@functools.lru_cache(maxsize=8)
def floor_bg(n):
    d = Drawing(seed=1300 + n, rgb=INK, width=1.5, alpha=0.62, wobble=1.3)
    # the wall corner and the ceiling line
    d.line(1180, -10, 1196, PAR_Y + 10, w=1.2, a=0.45)
    d.line(-20, 60, 1180, 40, w=1.0, a=0.35)
    # the corridor opening
    x0, x1, top = CORR
    d.line(x0, top, x0, PAR_Y + 10, w=1.6); d.line(x1, top, x1, PAR_Y + 10, w=1.6)
    d.line(x0 - 6, top, x1 + 6, top, w=1.6)
    vx, vy = (x0 + x1) / 2 + 8, 470
    # corridor in perspective: ceiling / wall edges run to the far end
    fx0, fx1, fy0, fy1 = vx - 34, vx + 34, vy - 42, vy + 44
    for (ax, ay, bx, by) in [(x0, top, fx0, fy0), (x1, top, fx1, fy0), (x0, PAR_Y, fx0, fy1), (x1, PAR_Y, fx1, fy1)]:
        d.line(ax, ay, bx, by, w=0.9, a=0.38, passes=1)
    d.rect(fx0, fy0, fx1 - fx0, fy1 - fy0, w=0.9, a=0.4, passes=1)
    # room doors along the corridor walls (receding)
    for k, f in enumerate((0.34, 0.58, 0.76)):
        xl = x0 + (fx0 - x0) * f; xr = x1 + (fx1 - x1) * f
        yt = top + (fy0 - top) * f + 30 * (1 - f); yb = PAR_Y + (fy1 - PAR_Y) * f
        d.line(xl, yt, xl, yb, w=0.8, a=0.3, passes=1)
        d.line(xr, yt, xr, yb, w=0.8, a=0.3, passes=1)
    if n == 4:
        # the door at the far end, ajar
        d.line(fx0 + 16, fy0 + 6, fx0 + 16, fy1, w=1.0, a=0.55, passes=1)
        d.line(fx0 + 16, fy0 + 6, fx1 - 14, fy0 + 6, w=1.0, a=0.55, passes=1)
        d.line(fx1 - 14, fy0 + 6, fx1 - 14, fy1, w=1.0, a=0.55, passes=1)
    if n == 5:
        # the vending machine, just inside the corridor on the left: its lit edge
        d.poly([(x0 + 10, 330), (x0 + 50, 352), (x0 + 50, PAR_Y), (x0 + 10, PAR_Y)], closed=True, w=1.2, a=0.55)
        d.line(x0 + 18, 380, x0 + 44, 394, w=0.8, a=0.4, passes=1)
    # the painted dado on the wall: its top edge steps up with the stairs
    sk = [(1186, PAR_Y - 44), (FL_X0, PAR_Y - 44)]
    x, y = FL_X0, PAR_Y - 44
    while x > -60:
        y -= 64 * SLOPE; sk.append((x, y))
        x -= 64; sk.append((x, y))
    d.poly(sk, w=1.1, a=0.42, wobble=0.6)
    # emergency lamp
    lamp_box(d, *LAMP_XY)
    # wall stains / old hatching near the corner
    d.hatch([(1000, 120), (1170, 110), (1180, 330), (1010, 360)], angle=78, spacing=11, a=0.16)
    d.hatch([(40, 110), (330, 100), (300, 250), (60, 300)], angle=-20, spacing=13, a=0.10)
    # the handrail of the flight above, far up in the dark
    d.line(-40, 30, 380, 330, w=1.0, a=0.25, passes=1)
    return d

@functools.lru_cache(maxsize=1)
def floor_fg():
    d = Drawing(seed=1391, rgb=INK, width=1.8, alpha=0.7, wobble=1.2)
    x_end = -60
    # handrail: two lines riding on the parapet
    d.line(1500, PAR_Y - 14, FL_X0 + 4, PAR_Y - 14, w=1.8)
    d.line(1500, PAR_Y - 2, FL_X0, PAR_Y - 2, w=1.2, a=0.5)
    d.line(FL_X0 + 4, PAR_Y - 14, x_end, flight_top(x_end) - 14, w=1.8)
    d.line(FL_X0, PAR_Y - 2, x_end, flight_top(x_end) - 2, w=1.2, a=0.5)
    # the turn post
    d.line(FL_X0, PAR_Y - 20, FL_X0, H + 10, w=1.3, a=0.5)
    # the parapet face: vertical board-marks (poured concrete), faint
    for k, x in enumerate(range(660, 1460, 120)):
        d.line(x + (k % 2) * 6, PAR_Y + 30, x + 3, H + 10, w=0.8, a=0.18, passes=1)
    d.hatch([(FL_X0, PAR_Y + 4), (1460, PAR_Y + 4), (1460, H), (FL_X0, H)], angle=-8, spacing=16, a=0.12)
    d.hatch([(FL_X0 - 4, PAR_Y + 6), (x_end, flight_top(x_end) + 6), (x_end, H), (FL_X0 - 4, H)], angle=30, spacing=14, a=0.12)
    return d

def draw_parapet(c, T, lit=1.0):
    path = skia.Path()
    pts = parapet_poly()
    path.moveTo(*pts[0])
    for q in pts[1:]:
        path.lineTo(*q)
    path.close()
    c.save()
    c.clipPath(path, skia.ClipOp.kIntersect, True)
    page(c)
    c.drawRect(skia.Rect(0, 0, BW, H), paint(BLACK, 0.30))
    c.restore()
    floor_fg().draw(c, 1.0, 0.9)

# ---------------- him: upper body, seen from behind-left ----------------
@functools.lru_cache(maxsize=2)
def body_path(facing=-1):
    """His right side, walking left, hips at (0,0): head bowed a little, the hood lying on his back,
    a loose hoodie. The legs run on down behind the parapet."""
    pts = [(-22, 330), (-24, 120), (-24, 20), (-27, -40), (-30, -100), (-31, -150), (-27, -178), (-18, -196),
           (-12, -206), (6, -208), (16, -212), (27, -208), (32, -194), (33, -170), (34, -130), (31, -70), (27, 0),
           (26, 120), (24, 330)]
    sm = _catmull(np.array(pts, float), 8)
    p = skia.Path()
    p.moveTo(*sm[0])
    for q in sm[1:]:
        p.lineTo(*q)
    p.close()
    # head, bowed forward
    hp = skia.Path(); hp.addOval(skia.Rect.MakeXYWH(-30, -262, 46, 56))
    m = skia.Matrix(); m.setRotate(-14, -7, -234)
    hp.transform(m)
    p.addPath(hp)
    # the forearm, a little ahead of the body, hand hanging
    ap = skia.Path(); ap.addRoundRect(skia.Rect.MakeXYWH(-14, -176, 20, 128), 10, 10)
    m2 = skia.Matrix(); m2.setRotate(8, -4, -176)
    ap.transform(m2)
    p.addPath(ap)
    return p

def draw_body(c, x, y, a=1.0, lean=0.0, rim=0.0, k=1.0):
    c.save()
    c.translate(x, y); c.rotate(lean); c.scale(k, k)
    p = body_path(-1)
    c.drawPath(p, paint(SIL, 0.97 * a))
    if rim > 0:
        # the lamp is above: a thin warm rim along the top of the head and shoulders
        sh = skia.GradientShader.MakeLinear([(0, -264), (0, -150)], [col(EMER, 0.55 * rim * a), col(EMER, 0)], [0, 1])
        pp = skia.Paint(Shader=sh, AntiAlias=True, Style=skia.Paint.kStroke_Style, StrokeWidth=2.2)
        c.drawPath(p, pp)
    c.restore()

class Walk:
    """He crosses the landing (right -> left), then climbs the flight to the upper left.
    Returns hip position, lean, and the list of footfalls (page-local times)."""
    def __init__(self, t0=0.0, x_in=1560.0, flat_iv=0.74, stair_iv=0.9, stride=138.0, tread=64.0, n_stairs=9):
        self.t0 = t0
        self.x_in = x_in
        self.flat_iv, self.stair_iv = flat_iv, stair_iv
        self.stride, self.tread = stride, tread
        self.n_flat = max(1, int(round((x_in - FL_X0) / stride)))
        self.t_flat = self.n_flat * flat_iv
        self.n_stairs = n_stairs
        self.dur = self.t_flat + n_stairs * stair_iv
        self.steps = [t0 + i * flat_iv for i in range(self.n_flat)] + \
                     [t0 + self.t_flat + i * stair_iv for i in range(n_stairs)]

    def pose(self, t):
        t = t - self.t0
        hip_h = 212
        if t < self.t_flat:
            u = t / self.flat_iv
            x = self.x_in - (self.x_in - FL_X0) * (t / self.t_flat)
            bob = -5 * abs(math.sin(math.pi * u))
            return x, FEET_Y - hip_h + bob, -2.0
        u = (t - self.t_flat) / self.stair_iv
        i = min(int(u), self.n_stairs)
        f = u - int(u)
        # each step: a slow push up, then settle (tired)
        rise = i + smooth(f / 0.55) if u < self.n_stairs else self.n_stairs
        x = FL_X0 - self.tread * rise
        y = FEET_Y - hip_h - self.tread * SLOPE * rise
        return x, y, -5.0 - 1.5 * math.sin(math.pi * f)

# =====================================================================
# the top: the iron door, from the inside
# =====================================================================
DX0, DX1, DY0, DY1 = 500, 940, 236, 860          # door leaf (hinge on the left)
FRX0, FRX1, FRY0 = 462, 978, 200                  # concrete frame
HOR = 590                                          # the horizon, seen through the doorway
VP = (722, HOR)

@functools.lru_cache(maxsize=1)
def top_bg():
    d = Drawing(seed=1310, rgb=INK, width=1.6, alpha=0.62, wobble=1.2)
    # side walls, ceiling, floor of the top landing (a small box)
    d.line(FRX0, FRY0, 120, -20, w=1.1, a=0.4); d.line(FRX1, FRY0, 1320, -20, w=1.1, a=0.4)
    d.line(FRX0 - 10, DY1 + 6, 110, 1100, w=1.1, a=0.4); d.line(FRX1 + 10, DY1 + 6, 1330, 1100, w=1.1, a=0.4)
    d.line(FRX0 - 10, DY1 + 6, FRX1 + 10, DY1 + 6, w=1.5, a=0.6)
    # the concrete door frame
    d.line(FRX0, FRY0, FRX1, FRY0, w=1.6); d.line(FRX0, FRY0, FRX0, DY1 + 4, w=1.6); d.line(FRX1, FRY0, FRX1, DY1 + 4, w=1.6)
    d.line(DX0 - 4, DY0 - 4, DX1 + 4, DY0 - 4, w=1.0, a=0.5)
    d.line(DX0 - 4, DY0 - 4, DX0 - 4, DY1, w=1.0, a=0.5); d.line(DX1 + 4, DY0 - 4, DX1 + 4, DY1, w=1.0, a=0.5)
    # the threshold: a raised concrete sill
    d.line(FRX0 - 6, DY1 + 22, FRX1 + 6, DY1 + 22, w=1.3, a=0.55)
    # emergency lamp above the door
    lamp_box(d, 720, 128)
    # 顶层: painted on the wall — drawn as text elsewhere; old stains here
    d.hatch([(1010, 190), (1200, 150), (1210, 420), (1015, 440)], angle=80, spacing=12, a=0.14)
    d.hatch([(200, 200), (430, 230), (430, 520), (220, 560)], angle=-12, spacing=13, a=0.10)
    return d

@functools.lru_cache(maxsize=1)
def step_lines():
    """The last steps down towards us (they leave the picture when the camera lowers)."""
    d = Drawing(seed=1312, rgb=INK, width=1.2, alpha=0.62, wobble=1.2)
    d.line(60, 985, 1380, 985, a=0.45); d.line(0, 1060, 1440, 1060, a=0.4)
    return d

@functools.lru_cache(maxsize=1)
def door_marks():
    """Panel lines, rivets, scratches: drawn in the leaf's own (closed) coordinates."""
    d = Drawing(seed=1311, rgb=INK, width=1.3, alpha=0.55, wobble=0.8)
    w, h = DX1 - DX0, DY1 - DY0
    d.rect(34, 40, w - 68, h * 0.40, w=1.1, a=0.45)
    d.rect(34, 60 + h * 0.40, w - 68, h * 0.46, w=1.1, a=0.45)
    for k in range(9):
        y = 22 + k * (h - 40) / 8
        d.ellipse(14, y, 2.4, 2.4, w=1.0, a=0.5, passes=1)
    # the lever handle and the hasp — no padlock on it
    d.rect(w - 64, h * 0.47, 16, 58, w=1.3, a=0.7)
    d.line(w - 56, h * 0.47 + 10, w - 104, h * 0.47 + 10, w=2.2, a=0.75)
    d.rect(w - 30, h * 0.43, 22, 40, w=1.1, a=0.55)
    d.ellipse(w - 19, h * 0.43 + 50, 9, 11, w=1.0, a=0.45, passes=1)
    d.hatch([(40, h * 0.62), (w - 60, h * 0.60), (w - 50, h * 0.80), (50, h * 0.84)], angle=12, spacing=15, a=0.10)
    d.scribble(w * 0.3, h * 0.2, 16, 5, w=0.7, a=0.18)
    return d

@functools.lru_cache(maxsize=1)
def crack_drawing():
    """The crack in the threshold concrete — the same crack as the bed board's (O._crack_pts)."""
    main, br = O._crack_pts(5, 1920)
    d = Drawing(seed=1320, rgb=INK, width=1.6, alpha=0.9, wobble=0.35, overshoot=0.0)
    sx = (FRX1 + 110 - (FRX0 - 110)) / 1960.0
    def m(p):
        return (FRX0 - 110 + (p[0] + 20) * sx, CRACK_Y + p[1] * 0.42)
    d.poly([m(p) for p in main], w=1.6)
    for b in br:
        d.poly([m(p) for p in b], w=0.8, a=0.6, passes=1)
    return d

CRACK_Y = DY1 + 80

@functools.lru_cache(maxsize=1)
def back_path():
    """Him from behind, standing (feet at (0,0), 400 tall): the hood lying on his back, shoulders
    down, arms hanging close, a loose hoodie, trousers, canvas shoes."""
    R = [(0, -400), (13, -397), (22, -388), (26, -374), (26, -360), (23, -350), (17, -342), (15, -334),
         (27, -333), (41, -330), (54, -326), (66, -320), (76, -312), (82, -300), (85, -284), (86, -262),
         (87, -240), (86, -218), (84, -200), (85, -186), (83, -170), (78, -163), (73, -168), (72, -184),
         (70, -198), (66, -194), (64, -186), (59, -182), (58, -150), (55, -110), (52, -62), (51, -22),
         (58, -12), (60, -2), (32, 2), (27, -10), (25, -50), (21, -110), (13, -168), (5, -181), (0, -183)]
    L = [(-x, y) for (x, y) in reversed(R[1:-1])]
    pts = R + L
    sm = _catmull(np.array(pts, float), 5)
    p = skia.Path(); p.moveTo(*sm[0])
    for q in sm[1:]:
        p.lineTo(*q)
    p.close()
    return p

def draw_back(c, x, y, k, a=1.0, rim=0.0, lean=0.0):
    c.save(); c.translate(x, y); c.rotate(lean); c.scale(k, k)
    p = back_path()
    c.drawPath(p, paint(SIL, 0.98 * a))
    if rim > 0:
        pp = paint((110, 140, 200), 0.45 * rim * a, 1.6 / max(k, 0.3))
        c.drawPath(p, pp)
    c.restore()

def sky(c, a=1.0):
    """What the doorway shows: deep blue, no stars; the roof surface running away into the dark."""
    r = skia.Rect.MakeLTRB(DX0, DY0, DX1, DY1)
    sh = skia.GradientShader.MakeLinear([(0, DY0), (0, HOR)], [col(SKY0, a), col(SKY1, a)], [0, 1])
    c.drawRect(skia.Rect.MakeLTRB(DX0, DY0, DX1, HOR + 1), skia.Paint(Shader=sh))
    sh2 = skia.GradientShader.MakeLinear([(0, HOR), (0, DY1)], [col(ROOF0, a), col(ROOF1, a)], [0, 1])
    c.drawRect(skia.Rect.MakeLTRB(DX0, HOR, DX1, DY1), skia.Paint(Shader=sh2))
    # a faint haze on the horizon, and the roof joints running to it
    glow(c, VP[0], HOR, 300, (60, 84, 140), 0.18 * a)
    c.save(); c.clipRect(r)
    for k in range(-6, 7):
        c.drawLine(VP[0] + k * 22, HOR + 1, VP[0] + k * 190, DY1 + 40, paint((70, 84, 110), 0.16 * a, 1.0))
    for j in range(1, 6):
        yy = HOR + (DY1 - HOR) * (j / 6) ** 1.8
        c.drawLine(DX0, yy, DX1, yy, paint((70, 84, 110), 0.10 * a, 1.0))
    c.restore()

def leaf_poly(theta):
    """The door leaf opening outward (away from us), hinge on the left, in rough perspective."""
    f = 1.0 / (1.0 + 0.95 * math.sin(theta))
    xr = DX0 + (DX1 - DX0) * math.cos(theta)
    xr = VP[0] + (xr - VP[0]) * f if theta > 0 else DX1
    xr = DX0 + (xr - DX0)
    ytop = VP[1] + (DY0 - VP[1]) * f
    ybot = VP[1] + (DY1 - VP[1]) * f
    return [(DX0, DY0), (xr, ytop), (xr, ybot), (DX0, DY1)], f

def door_leaf(c, theta, gap=0.0, a=1.0):
    q, f = leaf_poly(theta)
    path = skia.Path(); path.moveTo(*q[0])
    for p in q[1:]:
        path.lineTo(*p)
    path.close()
    c.save(); c.clipPath(path, skia.ClipOp.kIntersect, True)
    page(c)
    c.drawRect(skia.Rect(0, 0, BW, H), paint((20, 22, 26), 0.35))
    c.restore()
    if theta < 0.02:
        c.save(); c.translate(DX0, DY0); door_marks().draw(c, 1.0, 0.9 * a); c.restore()
    else:
        # the leaf edge-on-ish: just its outline and a few panel lines, foreshortened
        m = skia.Matrix()
        src = [skia.Point(0, 0), skia.Point(DX1 - DX0, 0), skia.Point(DX1 - DX0, DY1 - DY0), skia.Point(0, DY1 - DY0)]
        dst = [skia.Point(*p) for p in q]
        m.setPolyToPoly(src, dst)
        c.save(); c.concat(m); door_marks().draw(c, 1.0, 0.7 * a); c.restore()
    c.drawPath(path, paint(INK, 0.55 * a, 1.4))

# ---------------- his shoes at the threshold ----------------
JAMB_X, SILL_Y0, SILL_Y1 = 720, 628, 712
SHOE_X, SHOE_S = 262, 1.45
SHOE_Y = SILL_Y1 - 4 - 150 * SHOE_S

@functools.lru_cache(maxsize=1)
def sill_drawing():
    d = Drawing(seed=1330, rgb=INK, width=1.5, alpha=0.6, wobble=1.0)
    d.line(-20, SILL_Y0, 1460, SILL_Y0 - 6, w=1.3, a=0.55)
    d.line(-20, SILL_Y1, 1460, SILL_Y1 - 4, w=1.6, a=0.7)
    d.line(JAMB_X, -20, JAMB_X, SILL_Y0, w=1.6, a=0.7)
    d.line(JAMB_X - 26, -20, JAMB_X - 26, SILL_Y0, w=1.0, a=0.4)
    d.hatch([(-20, SILL_Y1 + 4), (1460, SILL_Y1), (1460, SILL_Y1 + 60), (-20, SILL_Y1 + 64)], angle=80, spacing=10, a=0.18)
    d.hatch([(0, 60), (JAMB_X - 30, 60), (JAMB_X - 30, SILL_Y0 - 8), (0, SILL_Y0 - 8)], angle=-70, spacing=14, a=0.10)
    return d

@functools.lru_cache(maxsize=1)
def shoe_drawing():
    return O.shoes(52, SHOE_X, SHOE_Y, SHOE_S)

@functools.lru_cache(maxsize=1)
def shoe_fill_path():
    """Solid silhouettes under the pencil lines (same geometry as O.shoes)."""
    s_, y = SHOE_S, SHOE_Y
    p = skia.Path()
    for ox in (0, 330 * s_):
        X = SHOE_X + ox
        up = [(X, y + 132 * s_), (X + 10 * s_, y + 70 * s_), (X + 60 * s_, y + 40 * s_), (X + 120 * s_, y + 55 * s_),
              (X + 200 * s_, y + 90 * s_), (X + 280 * s_, y + 105 * s_), (X + 302 * s_, y + 132 * s_)]
        sm = _catmull(np.array(up, float), 8)
        q = skia.Path(); q.moveTo(*sm[0])
        for pt in sm[1:]:
            q.lineTo(*pt)
        q.lineTo(X + 305 * s_, y + 150 * s_); q.lineTo(X - 5 * s_, y + 150 * s_); q.close()
        p.addPath(q)
        col_ = [(X + 58 * s_, y + 42 * s_), (X + 70 * s_, y + 42 * s_), (X + 90 * s_, y + 10 * s_), (X + 140 * s_, y + 8 * s_),
                (X + 150 * s_, y + 60 * s_), (X + 120 * s_, y + 55 * s_)]
        sm = _catmull(np.array(col_, float), 6)
        q = skia.Path(); q.moveTo(*sm[0])
        for pt in sm[1:]:
            q.lineTo(*pt)
        q.close()
        p.addPath(q)
    return p

def shoes_page(c, t, L):
    if t > 3.4:
        c.drawImage(baked('shoes', lambda cc: _shoes(cc, 10.0)), 0, 0)
        return
    _shoes(c, t)

def _shoes(c, t):
    page(c)
    # the opening: the roof running away into the dark, the deep blue above
    c.save(); c.clipRect(skia.Rect.MakeLTRB(JAMB_X, 0, BW, SILL_Y0))
    hz = 300
    sh = skia.GradientShader.MakeLinear([(0, 0), (0, hz)], [col(SKY0), col(SKY1)], [0, 1])
    c.drawRect(skia.Rect.MakeLTRB(JAMB_X, 0, BW, hz + 1), skia.Paint(Shader=sh))
    sh2 = skia.GradientShader.MakeLinear([(0, hz), (0, SILL_Y0)], [col(ROOF0), col(ROOF1)], [0, 1])
    c.drawRect(skia.Rect.MakeLTRB(JAMB_X, hz, BW, SILL_Y0), skia.Paint(Shader=sh2))
    glow(c, 1150, hz, 320, (60, 84, 140), 0.16)
    c.restore()
    # warm from the stairwell behind him, cold from outside
    glow(c, 160, 260, 760, EMER, 0.20)
    glow(c, 1260, 520, 820, (70, 100, 170), 0.20)
    sill_drawing().draw(c, 1.0, 1.0)
    # his shoes: washed-out canvas, laces tied tight
    k = ease_out(t / 3.2)
    # a soft shadow on the sill, then the washed-out canvas, then the pencil (twice, for weight)
    sh = paint(BLACK, 0.45 * smooth((t - 0.6) / 1.6)); sh.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 10))
    c.drawOval(skia.Rect.MakeLTRB(SHOE_X - 10, SILL_Y1 - 16, SHOE_X + 640 * SHOE_S, SILL_Y1 + 8), sh)
    c.drawPath(shoe_fill_path(), paint((70, 68, 63), 0.96 * smooth((t - 0.6) / 1.6)))
    shoe_drawing().draw(c, k, 1.0, tint=(214, 208, 196))
    shoe_drawing().draw(c, k, 0.6, tint=(214, 208, 196))
    # the cold light from outside catches the front shoe, the stairwell's warm light the other
    glow(c, SHOE_X + 330 * SHOE_S + 250, SILL_Y1 - 120, 300, (80, 110, 180), 0.22)
    glow(c, SHOE_X + 60, SILL_Y1 - 140, 260, EMER, 0.12)
    light_map(c, 720, 520, 1100, dark=0.75)

# =====================================================================
# sounds
# =====================================================================
def _tt(d):
    return np.arange(int(d * SR)) / SR

def stair_tone(d, seed=1330):
    """Empty stairwell at night: a concrete hush, the lamps' faint 50 Hz buzz."""
    x = lowpass(sfx.noise(d, seed, 'pink'), 700) * 0.016
    t = _tt(d)
    x += (0.0035 * np.sin(2 * np.pi * 50 * t) + 0.0022 * np.sin(2 * np.pi * 100 * t)
          + 0.0008 * np.sin(2 * np.pi * 150 * t)).astype(np.float32)
    return reverb(x, wet=0.35, decay=1.6, size='stair')[:len(x)]

def steps_track(times, d, seed=1340, a=1.0, heavy=()):
    """Footfalls at the given times, each slightly different, in the stairwell's reverb."""
    rng = np.random.default_rng(seed)
    out = np.zeros(int((d + 2.5) * SR), np.float32)
    for i, t in enumerate(times):
        f = sfx.footstep(int(rng.integers(0, 1e6)), a * rng.uniform(0.75, 1.0) * (1.12 if i in heavy else 1.0))
        # a soft scuff of the sole just before some footfalls (tired feet)
        if rng.random() < 0.35:
            sc_ = bandpass(sfx.noise(0.12, int(rng.integers(0, 1e6))), 900, 4000) * np.sin(np.pi * _tt(0.12) / 0.12) * 0.05
            s0 = int(max(0, t - 0.1) * SR); out[s0:s0 + len(sc_)] += sc_[:len(out) - s0]
        s = int(t * SR)
        out[s:s + len(f)] += f[:len(out) - s]
    return reverb(out, wet=0.35, decay=1.6, size='stair')

def murmur(d, seed=1350):
    """Voices behind a door at the end of a corridor: two speakers, a laugh-like swell, muffled."""
    a = sfx.chatter(d, seed)
    b = sfx.chatter(d, seed + 7)
    t = _tt(d)
    b = np.roll(b, int(0.9 * SR)) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.21 * t))
    x = lowpass(a + 0.8 * b, 1400)
    x = reverb(x, wet=0.55, decay=1.4, size='hall')[:len(x)]
    return x

def vending(d, seed=1360):
    """Vending machine: compressor hum (50 Hz and harmonics), a fan, a small rattle."""
    t = _tt(d)
    x = (np.sin(2 * np.pi * 50 * t) * 0.5 + np.sin(2 * np.pi * 100 * t) * 0.8 + np.sin(2 * np.pi * 150 * t) * 0.25
         + np.sin(2 * np.pi * 200 * t) * 0.12).astype(np.float32) * 0.02
    x *= (1 + 0.08 * np.sin(2 * np.pi * 0.7 * t)).astype(np.float32)
    fan = bandpass(sfx.noise(d, seed), 300, 1400) * 0.006
    return reverb(x + fan, wet=0.3, decay=1.2, size='stair')[:len(x)]

def metal_clunk(seed=1370):
    """He pushes: the bar gives, steel on steel. Not locked."""
    rng = np.random.default_rng(seed)
    d = 1.4; t = _tt(d)
    thud = lowpass(sfx.noise(d, seed, 'brown'), 160) * np.exp(-t * 14) * 6
    ring = sum(a * np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) * np.exp(-t * dk)
               for f, a, dk in [(212, 0.30, 5), (517, 0.22, 7), (893, 0.14, 9), (1391, 0.08, 12), (2270, 0.05, 16)])
    click = np.zeros_like(t); click[:int(0.012 * SR)] = sfx.noise(0.012, seed + 1)[:int(0.012 * SR)] * 0.4
    x = (thud + ring + click).astype(np.float32)
    return reverb(x * 0.6, wet=0.4, decay=1.6, size='stair')

def metal_creak(d=2.6, seed=1380):
    """A heavy iron door on dry hinges: stick-slip squeal gliding down, and the leaf's hollow boom."""
    rng = np.random.default_rng(seed)
    t = _tt(d)
    f0 = 520 + 240 * np.sin(np.pi * np.clip(t / d, 0, 1) * 0.9) - 160 * (t / d)
    f0 = f0 * (1 + 0.012 * np.sin(2 * np.pi * 7.5 * t))
    ph = 2 * np.pi * np.cumsum(f0) / SR
    tone = sum(np.sin(k * ph) / k ** 1.3 for k in range(1, 7))
    slip = (np.clip(np.sin(2 * np.pi * 23 * t + 3 * np.sin(2 * np.pi * 1.3 * t)), 0, 1) ** 3)
    env = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 0.6
    x = bandpass(tone * (0.35 + 0.65 * slip), 300, 3200) * env * 0.16
    boom = lowpass(sfx.noise(d, seed, 'brown'), 120) * env * 2.0
    x = (x + boom).astype(np.float32)
    return reverb(x, wet=0.45, decay=1.8, size='stair')

def wind_env(d, seed, strength, pts):
    """sfx.wind shaped by an envelope given as [(t, gain), ...] (linear gains)."""
    w = sfx.wind(d, seed, strength)
    t = _tt(d)[:len(w)]
    ts = [p[0] for p in pts]; gs = [p[1] for p in pts]
    g = np.interp(t, ts, gs).astype(np.float32)
    return (w * g[:, None]).astype(np.float32)

def gust_in(d=4.0, seed=1390):
    """The door opens: outside air rushes into the stairwell."""
    t = _tt(d)
    n = bandpass(sfx.noise(d, seed, 'pink'), 120, 2600)
    env = (np.clip(t / 0.9, 0, 1) ** 2) * np.exp(-np.clip(t - 0.9, 0, None) * 0.7)
    return (n * env * 0.22).astype(np.float32)

# =====================================================================
# build
# =====================================================================
FLOOR_PAGES = [2, 3, 4, 5]

def build():
    sc = Scene('s13_end', kind='B', title='第十三场【倒计时 → 终点】')
    sc.sub_color = SUBC

    # ---------------- date card (not a countdown) ----------------
    sc.wait(0.6)
    t_card = sc.t
    def card(c, t, L):
        page(c)
        k1 = smooth(t / 0.9); k2 = smooth((t - 0.6) / 1.2)
        text(c, '5月8日', 110, 150, 'serif-light', 30, SUBC, 0.85 * k1, tracking=0.3)
        text(c, '23:47', 104, 300, 'serif-xlight', 150, SUBC, 0.9 * k2)
    sc.layer(card, t_card, t_card + 5.4, fin=1.0, fout=0.9)
    sc.wait(5.0)

    # ---------------- the stairwell: one page per floor ----------------
    t_stair = sc.t
    pages = []                    # (n, t_start, t_end, walk)
    tt = t_stair
    for i, n in enumerate(FLOOR_PAGES):
        lead = 3.6 if n == 2 else 0.2          # 2F: the empty stairwell first
        x_in = 1560.0
        w = Walk(t0=tt + lead, x_in=x_in, n_stairs=6 if n < 5 else 7)
        dur = lead + w.dur + 0.9
        if n == 4:
            w = Walk(t0=tt + lead, x_in=x_in, flat_iv=0.78, n_stairs=6)
            dur = lead + w.dur + 0.9
        pages.append((n, tt, tt + dur, w))
        tt = tt + dur - 1.3                     # crossfade into the next floor
    t_stair_end = pages[-1][2]

    steps = []
    for (n, a_, b_, w) in pages:
        steps += [s for s in w.steps if a_ + 0.2 <= s <= b_ - 0.5]
    steps.sort()
    # drop footfalls that fall inside a crossfade overlap twice
    clean = []
    for s in steps:
        if not clean or s - clean[-1] > 0.45:
            clean.append(s)
    steps = clean

    def floor_static(n):
        def fn(c):
            page(c)
            lx, ly = LAMP_XY
            glow(c, lx, ly + 40, 640, EMER, 0.26)
            glow(c, lx, ly + 20, 170, EMER, 0.35)
            x0, x1, top = CORR
            # the corridor: dark, or lit, or green
            cp = skia.Path(); cp.addRect(skia.Rect.MakeLTRB(x0, top, x1, PAR_Y + 10))
            c.save(); c.clipPath(cp, skia.ClipOp.kIntersect, True)
            c.drawRect(skia.Rect.MakeLTRB(x0, top, x1, PAR_Y + 10), paint(BLACK, 0.45))
            if n == 4:
                vx = (x0 + x1) / 2 + 8
                # the light spilling out of the gap, along the corridor floor
                sp = skia.Path(); sp.moveTo(vx - 18, 514); sp.lineTo(vx - 4, 514); sp.lineTo(x0 + 150, PAR_Y + 10); sp.lineTo(x0 + 40, PAR_Y + 10); sp.close()
                shp = skia.GradientShader.MakeLinear([(0, 514), (0, PAR_Y)], [col(WARM, 0.42), col(WARM, 0.05)], [0, 1])
                c.drawPath(sp, skia.Paint(Shader=shp, AntiAlias=True))
            if n == 5:
                glow(c, x0 + 30, 520, 260, GREEN, 0.34)
                c.drawRect(skia.Rect.MakeLTRB(x0 + 12, 352, x0 + 48, PAR_Y), paint(GREEN, 0.20))
            c.restore()
            if n == 5:
                # the green light on the wall beside the opening
                glow(c, x0 - 60, 470, 300, GREEN, 0.22)
            floor_bg(n).draw(c, 1.0, 1.0)
            # the floor number, painted on the wall
            num = str(n)
            text(c, num, 1010, 560, 'sans-bold', 230, INK, 0.30)
            text(c, 'F', 1010 + text_width(num, 'sans-bold', 230) + 8, 560, 'sans-bold', 80, INK, 0.26)
        return baked(('floor', n), fn)

    def floor_front():
        def fn(c):
            draw_parapet(c, 0.0)
        return baked('parapet', fn, clear=None)

    def floor_light():
        lx, ly = LAMP_XY
        return baked('floor_light', lambda c: light_map(c, lx - 60, ly + 260, 1180, dark=0.93))

    def floor_layer(n, w, t0, t1):
        def fn(c, t, L):
            T = L.T
            c.drawImage(floor_static(n), 0, 0)
            lx, ly = LAMP_XY
            if n == 4:
                # a room with the light on, a door not quite shut: the light breathes a little
                x0, x1, top = CORR
                vx = (x0 + x1) / 2 + 8
                fl = 0.92 + 0.08 * math.sin(T * 3.1) * math.sin(T * 1.7)
                glow(c, vx - 12, 470, 90, WARM, 0.55 * fl)
                c.drawRect(skia.Rect.MakeLTRB(vx - 18, 432, vx - 8, 514), paint(WARM, 0.85 * fl))
            # him
            if w.t0 - 0.1 <= T <= w.t0 + w.dur + 2.0:
                x, y, lean = w.pose(T)
                d_l = math.hypot(x - lx, y - 260 - ly)
                rim = clamp(1.2 - d_l / 700)
                draw_body(c, x, y, 1.0, lean, rim)
            c.drawImage(floor_front(), 0, 0)
            c.drawImage(floor_light(), 0, 0)
        return fn

    for (n, a_, b_, w) in pages:
        sc.layer(floor_layer(n, w, a_, b_), a_, b_, fin=1.3 if n != 2 else 1.6, fout=1.3)

    # sound of the stairwell
    sc.amb(stair_tone(30, 1331), t_stair - 0.8, None, gain=-3, fin=2.0)
    amb_idx = len(sc.audio) - 1
    sc.sfx(steps_track([s - t_stair for s in steps], t_stair_end - t_stair, 1341, 0.85), at=t_stair, gain=-1)
    p4 = [p for p in pages if p[0] == 4][0]
    p5 = [p for p in pages if p[0] == 5][0]
    sc.sfx(murmur(p4[2] - p4[1] + 2.0, 1351), at=p4[1] - 0.6, gain=-9, pan=-0.1, fin=2.2, fout=2.4)
    sc.sfx(vending(p5[2] - p5[1] + 2.0, 1361), at=p5[1] - 0.6, gain=-6, pan=-0.2, fin=2.0, fout=2.6)

    # captions: the script's own commentary, silent
    p2 = pages[0]; p3 = pages[1]
    sc.caption('每一步都很慢。', start=p2[3].t0 + 2.2, dur=3.2)
    sc.caption('不是因为犹豫，是因为累。累了很久了。', start=p2[3].t0 + 6.2, dur=4.6)
    sc.caption('他没有停下来。', start=p4[3].t0 + 3.2, dur=3.2)
    sc.caption('他没有看。', start=p5[3].t0 + 3.4, dur=2.8)

    # ---------------- the top: the iron door ----------------
    t_top = t_stair_end - 1.3
    arr0 = t_top + 0.8                 # he comes up the last steps
    arr1 = arr0 + 3.8
    top_steps = [arr0 + 0.2 + i * 0.92 for i in range(4)] + [arr1 + 0.25]
    sc.sfx(steps_track([s - t_top for s in top_steps], 8, 1342, 0.85, heavy=(4,)), at=t_top, gain=-1)
    t_push = arr1 + 2.0
    sc.sfx(metal_clunk(1371), at=t_push, gain=-4)
    sc.at(t_push + 2.2)
    # 1
    sc.say('zhang', '我承认，我有虚荣心。', fx='vo', note='画外音', speed=0.85, post=1.4, variant=1)
    t_open = sc.t
    t_open1 = t_open + 3.0
    sc.sfx(metal_creak(3.0, 1381), at=t_open - 0.1, gain=-5)
    sc.sfx(gust_in(4.5, 1391), at=t_open + 0.4, gain=-3)
    t_door = t_open1 + 0.8              # he stands in the doorway
    sc.sfx(steps_track([0.0, 0.8], 2, 1343, 0.7), at=t_open1 + 0.1, gain=-5)
    sc.at(t_open1 + 1.4)
    # 2
    sc.say('zhang', '但更多的是，我只是想活得有尊严。', fx='vo', note='画外音', speed=0.85, post=0.7)
    t_shoes = sc.t - 0.6
    sc.say('zhang', '我想跟身边的人一样，吃一样的饭，穿一样的鞋，用一样的手机。', fx='vo', note='画外音', speed=0.85, post=0.8)
    sc.say('zhang', '我只是不想再被人看不起。', fx='vo', note='画外音', speed=0.83, post=2.6)
    t_shoes1 = sc.t - 1.0
    sc.layer(shoes_page, t_shoes, t_shoes1, fin=1.2, fout=1.2, z=2)
    # 3
    sc.say('zhang', '难道这也有错吗？', fx='vo', note='画外音', speed=0.83, post=1.8)
    t_step = sc.t
    sc.sfx(steps_track([0.0], 1.5, 1344, 0.6), at=t_step + 0.2, gain=-9)
    sc.wait(2.4)
    # 4
    sc.say('zhang', '我唯一对不起的，是我爸妈。', fx='vo', note='画外音', speed=0.85, post=0.8)
    sc.say('zhang', '他们供我上大学，是指望我过上好日子的。', fx='vo', note='画外音', speed=0.85, post=0.8)
    sc.say('zhang', '我辜负了他们。', fx='vo', note='画外音', speed=0.8, post=3.0)
    # 5
    sc.say('zhang', '最后我想说一句。', fx='vo', note='画外音', speed=0.85, post=1.0)
    sc.say('zhang', '校园贷借不得。', fx='vo', note='画外音', speed=0.82, post=1.0)
    sc.say('zhang', '那些人不是来帮你的。他们靠你的羞耻心赚钱。', fx='vo', note='画外音', speed=0.85, post=0.8, variant=1)
    sc.say('zhang', '你越怕丢人，他们就越有把握把你吃干净。', fx='vo', note='画外音', speed=0.85, post=2.2)
    t_away = sc.t                        # 风声渐大。他的背影在门框里变得越来越小。
    t_away1 = t_away + 10.0
    t_tilt = t_away1 - 1.0               # 镜头缓缓低下去——落在门槛上
    t_tilt1 = t_tilt + 8.0
    t_black = t_tilt1 + 6.0              # 风声。黑场。
    sc.at(t_black)

    def he_is(T):
        """(x, feet_y, scale, alpha) of him at the top."""
        if T < arr1:
            u = ease_out(ramp(T, arr0, arr1))
            stepb = 10 * abs(math.sin(math.pi * 4 * ramp(T, arr0, arr1)))
            return 700, 1540 - (1540 - 980) * u - stepb, 1.12 - 0.12 * u
        k = 1.0; y = 980.0; x = 700.0
        # into the doorway
        u = ease_in_out(ramp(T, t_open1 + 0.1, t_door + 0.6))
        k = 1.0 - 0.10 * u; y = 980 - 96 * u
        # one step out
        u2 = ease_in_out(ramp(T, t_step + 0.1, t_step + 1.1))
        k -= 0.12 * u2; y -= 36 * u2
        # walking away: smaller and smaller in the frame
        u3 = ramp(T, t_away + 1.5, t_away1 + 6)
        if u3 > 0:
            f = 1.0 / (1.0 + 5.5 * u3)
            k0, y0 = k, y
            k = k0 * f
            y = HOR + (y0 - HOR) * f
            y += -2.5 * abs(math.sin(math.pi * (T - t_away - 1.5) / 0.95)) * f
        return x, y, k

    def top_static(which):
        """Baked layers of the door shot while the camera is still: 'closed', 'open' (no leaf), 'final'."""
        def fn(c):
            page_tall(c)
            glow(c, 720, 170, 700, EMER, 0.22)
            glow(c, 720, 150, 160, EMER, 0.30)
            if which != 'closed':
                c.save(); c.clipRect(skia.Rect.MakeLTRB(DX0, DY0, DX1, DY1)); sky(c); c.restore()
            top_bg().draw(c, 1.0, 1.0)
            step_lines().draw(c, 1.0, 1.0)
            text(c, '顶层', 1060, 380, 'sans-bold', 88, INK, 0.26, tracking=0.1)
            if which == 'final':
                spill(c, 1.0)
            if which == 'closed':
                door_leaf(c, 0.0)
            if which == 'final':
                door_leaf(c, math.radians(80))
            if which != 'open':
                crack_drawing().draw(c, 1.0, 0.28)
        return baked(('top', which), fn)

    def top_light():
        return baked('top_light', lambda c: light_map(c, 720, 420, 1050, w=BW + 400, h=H + 800, dark=0.9))

    def spill(c, blue):
        sp = skia.Path(); sp.moveTo(DX0, DY1 + 6); sp.lineTo(DX1, DY1 + 6); sp.lineTo(DX1 + 260, 1090); sp.lineTo(DX0 - 260, 1090); sp.close()
        shp = skia.GradientShader.MakeLinear([(0, DY1), (0, 1090)], [col((70, 96, 160), 0.22 * blue), col((70, 96, 160), 0.0)], [0, 1])
        c.drawPath(sp, skia.Paint(Shader=shp, AntiAlias=True))

    def top_fast(c, T):
        """The camera is still: mostly baked images."""
        if T < t_push:
            c.drawImage(top_static('closed'), 0, 0)
        elif T < t_open1 + 2.6:
            c.drawImage(top_static('open'), 0, 0)
            blue = smooth((T - t_open) / 2.5) if T >= t_open else 0.0
            if blue > 0:
                spill(c, blue)
            if T < t_open:
                door_leaf(c, 0.0)
                gap = 5.0 * smooth((T - t_push) / 0.25) * (1 - 0.6 * smooth((T - t_push - 0.6) / 0.8))
                if gap > 0.1:
                    c.drawRect(skia.Rect.MakeLTRB(DX1 - gap, DY0 + 4, DX1, DY1 - 4), paint(SKY1, 0.9))
            else:
                door_leaf(c, math.radians(80) * ease_in_out(ramp(T, t_open, t_open1)))
            crack_drawing().draw(c, 1.0, 0.28)
        else:
            c.drawImage(top_static('final'), 0, 0)
        x, y, k = he_is(T)
        if T >= arr0 - 0.2:
            blue = smooth((T - t_open) / 2.5) if T >= t_open else 0.0
            draw_back(c, x, y, k, 1.0, blue)
        if T >= t_open:
            wind_specks(c, T, smooth((T - t_open) / 2.0) * (1 + 0.8 * ramp(T, t_away, t_away + 8)))
        if T < arr1 + 0.5:
            c.save(); c.clipRect(skia.Rect.MakeLTRB(0, 985, BW, H + 400))
            page_tall(c); c.drawRect(skia.Rect(0, 0, BW, H + 400), paint(BLACK, 0.2))
            c.restore()
            step_lines().draw(c, 1.0, 1.0)
        c.drawImage(top_light(), 0, 0)

    def wind_specks(c, T, a):
        """Grit blown in over the sill: the only thing in the picture the wind can move."""
        if a <= 0:
            return
        rng = np.random.default_rng(1399)
        n = 26
        for i in range(n):
            ph = rng.uniform(0, 1); per = rng.uniform(1.4, 2.6)
            y0 = rng.uniform(HOR + 40, DY1 + 60); x0 = rng.uniform(DX0, DX1)     # never in the sky: no stars
            u = ((T / per) + ph) % 1.0
            # from outside (the opening) towards us and down, drifting sideways
            x = x0 + (rng.uniform(-1, 1) * 260) * u
            y = y0 + 160 * u * u + 12 * math.sin(6 * u + i)
            al = a * 0.30 * math.sin(math.pi * u) * rng.uniform(0.4, 1.0)
            c.drawCircle(x, y, rng.uniform(0.8, 1.7), paint((150, 170, 205), min(0.5, al)))

    def top(c, t, L):
        T = L.T
        if t_shoes + 1.25 < T < t_shoes1 - 1.25:
            return                           # hidden under the shoes page
        if T < t_tilt:
            top_fast(c, T)
            return
        # the tilt down to the threshold
        u = ease_in_out(ramp(T, t_tilt, t_tilt1))
        zoom = 1.0 + 1.6 * u
        fx_, fy_ = 720, CRACK_Y
        c.save()
        c.translate(720, fy_ + (600 - fy_) * u)
        c.scale(zoom, zoom)
        c.translate(-fx_, -fy_)
        page_tall(c)
        lamp_a = 1.0
        glow(c, 720, 170, 700, EMER, 0.22)
        glow(c, 720, 150, 160, EMER, 0.30)
        # the opening
        theta = 0.0
        gap = 0.0
        if T >= t_push and T < t_open:
            gap = 5.0 * smooth((T - t_push) / 0.25) * (1 - 0.6 * smooth((T - t_push - 0.6) / 0.8))
        if T >= t_open:
            theta = math.radians(80) * ease_in_out(ramp(T, t_open, t_open1))
        blue = 0.0
        if T >= t_push:
            c.save(); c.clipRect(skia.Rect.MakeLTRB(DX0, DY0, DX1, DY1))
            sky(c)
            c.restore()
            blue = smooth((T - t_open) / 2.5) if T >= t_open else 0.0
        top_bg().draw(c, 1.0, 1.0)
        step_lines().draw(c, 1.0, 1.0 - u)
        text(c, '顶层', 1060, 380, 'sans-bold', 88, INK, 0.26, tracking=0.1)
        # the cold light from outside spills over the sill onto the landing
        if blue > 0:
            sp = skia.Path(); sp.moveTo(DX0, DY1 + 6); sp.lineTo(DX1, DY1 + 6); sp.lineTo(DX1 + 260, 1090); sp.lineTo(DX0 - 260, 1090); sp.close()
            shp = skia.GradientShader.MakeLinear([(0, DY1), (0, 1090)], [col((70, 96, 160), 0.22 * blue), col((70, 96, 160), 0.0)], [0, 1])
            c.drawPath(sp, skia.Paint(Shader=shp, AntiAlias=True))
        # the leaf
        if theta < 0.001:
            c.save(); c.translate(-gap * 0.2, 0)
            door_leaf(c, 0.0)
            c.restore()
            if gap > 0.1:
                c.drawRect(skia.Rect.MakeLTRB(DX1 - gap, DY0 + 4, DX1, DY1 - 4), paint(SKY1, 0.9))
        else:
            door_leaf(c, theta)
        # the crack in the threshold: always there; noticed only at the end
        crack_drawing().draw(c, 1.0, 0.28)
        ck = ramp(T, t_tilt1 - 2.5, t_tilt1 + 2.5)
        if ck > 0:
            crack_drawing().draw(c, ease_in_out(ck), 0.95)
        # him
        x, y, k = he_is(T)
        if T >= arr0 - 0.2:
            rim = blue
            draw_back(c, x, y, k, 1.0, rim)
        # the step edge in front of us hides his legs while he climbs
        if T < arr1 + 0.5:
            c.save(); c.clipRect(skia.Rect.MakeLTRB(0, 985, BW, H + 400))
            page_tall(c); c.drawRect(skia.Rect(0, 0, BW, H + 400), paint(BLACK, 0.2))
            c.restore()
            step_lines().draw(c, 1.0, 1.0)
        light_map(c, 720, 420, 1050, w=BW + 400, h=H + 800, dark=0.9)
        c.restore()
    sc.layer(top, t_top, t_black, fin=1.3, fout=2.6)

    # the wind: from the door opening, under the voice; rising after the last words; then nothing
    d_w = t_black + 1.0 - t_open
    wind_pts = [(0, 0.0), (0.8, 1.2), (4.0, 0.7), (t_away - t_open, 0.9), (t_away - t_open + 6, 2.0),
                (t_tilt1 - t_open, 3.0), (t_black - t_open - 1.6, 3.0), (d_w, 0.0)]
    sc.sfx(wind_env(d_w, 1392, 1.0, wind_pts), at=t_open, gain=4, bus='amb')   # ducks under the voice-over
    # the stairwell tone ends with the picture
    at_, (tag, x_, _e), g_, p_, b_, fi_, fo_ = sc.audio[amb_idx]
    sc.audio[amb_idx] = (at_, (tag, x_, t_black + 0.4), g_, p_, b_, fi_, 2.5)
    sc.finish(tail=2.2)
    return sc

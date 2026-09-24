"""第八场【循环】 内景 宿舍 日 — the fourteenth morning of 5月9日.
Chen at Zhang's computer. Three deleted files and a folder come back from the disk, and for the
first time we hear Zhang's own voice: reading what he never said out loud.
The cold evidence screen; his handwriting laid over it; the warm paper of his sketches inside it."""
import math, functools
import numpy as np
import skia
from film.config import *
from film.gfx import *
from film.timeline import Scene
from film.sketch import Drawing, smudge
from film import objects as O, sfx
from film.audio import reverb, lowpass, bandpass, highpass, env_fade

LOOP = 14
PX, PY, PS = 200, 120, 1.0          # floor-plan placement (the fixed camera of the A line)
RX = 1010                           # right column
SAMP = skia.SamplingOptions(skia.FilterMode.kLinear, skia.MipmapMode.kLinear)
HAND_INK = (50, 46, 42)             # his graphite, laid over the cold screen
SCREEN = (241, 243, 244)

# the monitor, as the insert frames it
SX, SY, SW, SH = 110, 58, 1330, 742
CY0 = SY + 52                       # content top (below the title bar)
MLX = 1500                          # mini-log column in the insert

# =====================================================================
# cached backgrounds
# =====================================================================
@functools.lru_cache(maxsize=1)
def _bg_image():
    surf = skia.Surface(W, H)
    O.a_background(surf.getCanvas(), W, H)
    return surf.makeImageSnapshot().withDefaultMipmaps()

def a_bg(c):
    c.drawImage(_bg_image(), 0, 0, SAMP)

@functools.lru_cache(maxsize=1)
def _plan_image():
    surf = skia.Surface(W, H)
    c = surf.getCanvas()
    O.a_background(c, W, H)
    O.floorplan(c, PX, PY, PS, empty_alpha=0.55)
    return surf.makeImageSnapshot().withDefaultMipmaps()

def dot(c, x, y, label, a=1.0, rgb=A_INK, r=9, left=False, ring=0.0):
    c.drawCircle(x, y, r, paint(rgb, a))
    if ring > 0:
        c.drawCircle(x, y, r + 10 + 18 * ring, paint(rgb, a * (1 - ring) * 0.6, 1.2))
    if left:
        text(c, label, x - r - 8, y + 7, 'sans-medium', 18, rgb, a, 'right', tracking=0.1)
    else:
        text(c, label, x + r + 8, y + 7, 'sans-medium', 18, rgb, a, tracking=0.1)

# =====================================================================
# the event log, scrolling inside a fixed region (O.event_log look)
# =====================================================================
def _entry_h(s, size, maxw):
    return len(wrap(s, 'sans-light', size, maxw - 110 * size / 25)) * size * 1.5 + size * 0.7

def scroll_log(c, x, y, entries, T, maxy, maxw=780, size=25, cps=22.0, a=1.0):
    shown = [e for e in entries if e[0] <= T]
    if not shown:
        return
    avail = maxy - y
    hs = [_entry_h(e[2], size, maxw) for e in shown]
    off_now = max(0.0, sum(hs) - avail)
    off_prev = max(0.0, sum(hs[:-1]) - avail)
    off = off_prev + (off_now - off_prev) * ease_in_out((T - shown[-1][0]) / 0.8)
    gx = 110 * size / 25
    c.save()
    c.clipRect(skia.Rect(x - 10, y - size * 1.3, x + maxw + 60, maxy + size * 0.4))
    yy = y - off
    n = len(shown)
    for i, (ta, stamp, s) in enumerate(shown):
        age = n - 1 - i
        k = 1.0 if age == 0 else max(0.35, 0.75 - 0.12 * age)
        lines = wrap(s, 'sans-light', size, maxw - gx)
        top = clamp((yy - (y - size * 1.4)) / (size * 1.4))
        if top > 0:
            chars = int((T - ta) * cps)
            text(c, stamp, x, yy, 'sans-medium', size * 0.72, A_MID, a * top * k * smooth((T - ta) / 0.3), tracking=0.15)
            used = 0
            for j, ln in enumerate(lines):
                vis = ln[:max(0, chars - used)]; used += len(ln)
                ly = yy + j * size * 1.5
                aa = clamp((ly - (y - size * 1.4)) / (size * 1.4))
                text(c, vis, x + gx, ly, 'sans-light', size, A_INK, a * k * aa)
        yy += len(lines) * size * 1.5 + size * 0.7
    c.restore()

# =====================================================================
# the master: floor plan + clock + counter + log
# =====================================================================
class Master:
    def __init__(self, loop, home):
        self.loop = loop
        self.log = []                   # (t, stamp, text, where)  where: 'm' master, 'i' insert, 'b' both
        self.home = dict(home)
        self.moves = []
        self.t_siren = None
        self.counter_from = None
        self.left = {}
        self.chair_taken = None         # Chen sits in Zhang's chair
        self.screen_on = None
        self.screen_off = None

    def add(self, t, stamp, s, where='m'):
        self.log.append((t, stamp, s, where))

    def entries(self, where):
        return [(t, st, s) for (t, st, s, w) in self.log if w in (where, 'b')]

    def stamp(self, T):
        st = [e[1] for e in self.log if e[0] <= T]
        return st[-1] if st else '08:30'

    def spot_at(self, who, t):
        xy = O.plan_xy(PX, PY, PS, self.home[who])
        for (t0, t1, w, a_, b_) in self.moves:
            if w != who or t < t0:
                continue
            A = O.plan_xy(PX, PY, PS, a_); B = O.plan_xy(PX, PY, PS, b_)
            k = ease_in_out(ramp(t, t0, t1))
            xy = (A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k)
        return xy

    def draw(self, c, T, w, h):
        c.drawImage(_plan_image(), 0, 0, SAMP)
        # Zhang's monitor, seen from above: a thin bar against the wall, and its cold light
        if self.screen_on is not None and T > self.screen_on:
            k = smooth((T - self.screen_on) / 0.4)
            if self.screen_off is not None:
                k *= 1 - smooth((T - self.screen_off) / 0.25)
            mx, my = PX + 3.84 * 100, PY + 4.12 * 100
            if k > 0:
                g = skia.GradientShader.MakeRadial((mx - 30, my), 150, [col((250, 252, 255), 0.85 * k), col((236, 242, 248), 0.35 * k), col((236, 242, 248), 0)], [0, 0.45, 1])
                c.drawCircle(mx - 30, my, 150, skia.Paint(Shader=g))
            line(c, mx, my - 30, mx, my + 30, A_INK, 0.85, 3.0)
        # the chair nobody sits in — until Chen does
        zx, zy = O.plan_xy(PX, PY, PS, 'zhang_desk')
        ea = 1.0 if self.chair_taken is None else 1 - smooth((T - self.chair_taken) / 0.4)
        text(c, '空', zx - 8, zy + 7, 'sans-light', 16, A_MID, 0.8 * ea)
        # siren marker (identical every loop)
        if self.t_siren is not None and T > self.t_siren:
            k = T - self.t_siren
            wx, wy = O.plan_xy(PX, PY, PS, 'window')
            ring = (k * 0.8) % 1.0
            aa = min(1.0, k / 1.5) * (1.0 if k < 9 else max(0.25, 1 - (k - 9) / 3))
            c.drawCircle(wx + 120, wy - 60, 6, paint(A_INK, aa))
            c.drawCircle(wx + 120, wy - 60, 6 + 30 * ring, paint(A_INK, aa * (1 - ring) * 0.5, 1.2))
            text(c, '楼下 · 警车', wx + 140, wy - 54, 'sans-light', 17, A_MID, aa, tracking=0.2)
        for who in ('李', '陈'):
            x, y = self.spot_at(who, T)
            dot(c, x, y, who, left=self.left.get(who, lambda T: False)(T))
        O.clock_card(c, RX, 210, 1.0, time=self.stamp(T))
        if self.counter_from is not None:
            k = smooth((T - self.counter_from) / 0.5)
            if k < 1:
                O.loop_counter(c, 1620, 150, self.loop - 1, 1 - k)
            if k > 0:
                O.loop_counter(c, 1620, 150, self.loop, k)
        else:
            O.loop_counter(c, 1620, 150, self.loop, 1.0)
        scroll_log(c, RX, 420, self.entries('m'), T, 800, maxw=780)

# =====================================================================
# Zhang's handwriting (LXGW WenKai), laid over the cold screen
# =====================================================================
@functools.lru_cache(maxsize=512)
def hand_layout(s, maxw, size, lh):
    """(ch, x, y) for every character of s, wrapped; (0, 0) = first baseline."""
    lines = wrap(s, 'hand', size, maxw)
    f = font('hand', size)
    out = []
    for j, ln in enumerate(lines):
        x = 0.0
        for ch in ln:
            out.append((ch, x, j * size * lh))
            x += f.measureText(ch)
    return tuple(out)

def _h(i, seed, k):
    v = ((i + 1) * 2654435761 + seed * 97531 + k * 40503) & 0xffffffff
    v ^= v >> 13; v = (v * 1274126177) & 0xffffffff
    return ((v >> 8) & 0xffff) / 65535.0 - 0.5

def hand_draw(c, lay, x0, y0, size, times, T, a=1.0, rgb=HAND_INK, jit=1.0, seed=0, red=(), alphas=None, fin=0.16):
    """Draw laid-out handwriting; char i appears at times[i] (None = already there)."""
    f = font('hand', size)
    for i, (ch, x, y) in enumerate(lay):
        k = 1.0 if times is None else clamp((T - times[i]) / fin)
        if k <= 0:
            continue
        aa = a * k * (0.84 + 0.16 * (_h(i, seed, 4) + 0.5))
        if alphas is not None:
            aa *= alphas[i]
        if aa <= 0.003:
            continue
        dx = _h(i, seed, 1) * 1.8 * jit; dy = _h(i, seed, 2) * 2.4 * jit; rot = _h(i, seed, 3) * 3.2 * jit
        c.save()
        c.translate(x0 + x + dx, y0 + y + dy)
        if rot:
            c.rotate(rot)
        c.drawString(ch, 0, 0, f, paint(RED if i in red else rgb, aa))
        c.restore()

def reveal_times(n_chars_list, spans):
    """Each group of characters is written while its line is spoken."""
    out = []
    for n, (s, e) in zip(n_chars_list, spans):
        d = max(0.2, e - s)
        out += [s + d * (k / max(1, n)) for k in range(n)]
    return out

# =====================================================================
# the screen: window chrome, icons, cursor
# =====================================================================
def icon_doc(c, x, y, s=1.0, a=1.0):
    w, h, fo = 22 * s, 28 * s, 7 * s
    p = skia.Path(); p.moveTo(x, y); p.lineTo(x + w - fo, y); p.lineTo(x + w, y + fo); p.lineTo(x + w, y + h); p.lineTo(x, y + h); p.close()
    c.drawPath(p, paint(A_INK, a, 1.2))
    q = skia.Path(); q.moveTo(x + w - fo, y); q.lineTo(x + w - fo, y + fo); q.lineTo(x + w, y + fo)
    c.drawPath(q, paint(A_INK, a * 0.7, 1.0))
    for k in range(3):
        line(c, x + 5 * s, y + (12 + 5 * k) * s, x + w - 5 * s, y + (12 + 5 * k) * s, A_MID, a * 0.8, 1.0)

def icon_folder(c, x, y, s=1.0, a=1.0):
    w, h = 30 * s, 23 * s
    p = skia.Path(); p.moveTo(x, y + 3 * s); p.lineTo(x + 11 * s, y + 3 * s); p.lineTo(x + 14 * s, y + 7 * s)
    p.lineTo(x + w, y + 7 * s); p.lineTo(x + w, y + h + 3 * s); p.lineTo(x, y + h + 3 * s); p.close()
    c.drawPath(p, paint(A_INK, a, 1.2))
    line(c, x, y + 11 * s, x + w, y + 11 * s, A_INK, a * 0.5, 1.0)

def cursor(c, x, y, a=1.0):
    pts = [(0, 0), (0, 27), (7, 21), (12, 32), (16.5, 30), (11.5, 19.5), (20, 19.5)]
    p = skia.Path(); p.moveTo(x + pts[0][0], y + pts[0][1])
    for q in pts[1:]:
        p.lineTo(x + q[0], y + q[1])
    p.close()
    sh = paint((0, 0, 0), 0.15 * a); sh.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 2.5))
    c.save(); c.translate(1.5, 2.5); c.drawPath(p, sh); c.restore()
    c.drawPath(p, paint((252, 252, 252), a))
    c.drawPath(p, paint(A_INK, a, 1.3))

def chrome(c, path_txt, a=1.0):
    """The monitor as a cold window: thin frame, title bar, breadcrumb."""
    sh = paint((10, 16, 24), 0.10 * a); sh.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 14))
    c.drawRect(skia.Rect.MakeXYWH(SX + 6, SY + 10, SW, SH), sh)
    c.drawRect(skia.Rect.MakeXYWH(SX, SY, SW, SH), paint(SCREEN, a))
    c.drawRect(skia.Rect.MakeXYWH(SX, SY, SW, SH), paint(A_INK, a * 0.9, 1.4))
    line(c, SX, CY0, SX + SW, CY0, A_INK, a * 0.35, 1.0)
    text(c, '数据恢复', SX + 28, SY + 34, 'sans', 19, A_INK, a, tracking=0.2)
    text(c, path_txt, SX + 150, SY + 34, 'sans-light', 17, A_MID, a, tracking=0.05)
    bx = SX + SW - 36
    line(c, bx - 88, SY + 27, bx - 74, SY + 27, A_MID, a, 1.2)
    c.drawRect(skia.Rect.MakeXYWH(bx - 47, SY + 20, 13, 13), paint(A_MID, a, 1.2))
    line(c, bx - 6, SY + 20, bx + 7, SY + 33, A_MID, a, 1.2); line(c, bx + 7, SY + 20, bx - 6, SY + 33, A_MID, a, 1.2)

# =====================================================================
# the recovered sketches: phone photos of pencil drawings (warm paper inside the cold UI)
# =====================================================================
def _xf(s, ox, oy):
    return lambda pts: [(ox + x * s, oy + y * s) for (x, y) in pts]

@functools.lru_cache(maxsize=1)
def cat_drawing():
    """校门口趴着的橘猫: a tabby lying in a loaf, eyes shut, tail along the front. Observed, not cartoon."""
    d = Drawing(seed=801, width=2.0, alpha=0.85)
    s = 0.74
    P = _xf(s, 14, 18)
    L = lambda pts, **kw: d.poly(P(pts), **kw)
    C = lambda pts, **kw: d.curve(P(pts), **kw)
    L([(40, 474), (760, 470)], w=0.9, a=0.3)
    # head, a little turned towards us
    C([(262, 300), (250, 284), (214, 276), (178, 286), (160, 312), (158, 346), (176, 372), (212, 384), (246, 376), (266, 352), (270, 322), (262, 300)], w=2.0)
    L([(170, 296), (176, 240), (206, 280)], w=1.9)
    L([(232, 280), (258, 240), (266, 300)], w=1.9)
    C([(186, 330), (194, 335), (203, 331)], w=1.4, a=0.8)
    C([(228, 331), (237, 335), (246, 330)], w=1.4, a=0.8)
    L([(212, 350), (218, 350), (215, 354)], w=1.1, a=0.7)
    for k in range(3):
        L([(206 + k * 6, 288), (207 + k * 5, 304)], w=1.0, a=0.45, passes=1)
    # body: the loaf, chest, tucked paw
    C([(264, 304), (340, 284), (450, 282), (540, 300), (600, 344), (616, 404), (600, 456)], w=2.1)
    C([(196, 380), (186, 420), (198, 462)], w=1.8)
    d.ellipse(14 + 208 * s, 18 + 466 * s, 28 * s, 9 * s, w=1.5)
    # tail along the front
    C([(604, 448), (584, 478), (500, 488), (400, 484), (312, 474), (262, 466)], w=1.9)
    C([(598, 440), (572, 470), (500, 478), (404, 476), (330, 466)], w=1.0, a=0.45)
    # tabby stripes on the back, a few on the flank
    for k, x in enumerate((330, 378, 426, 474, 522, 566)):
        C([(x, 286 + (k % 2) * 3), (x + 9, 312), (x + 3, 340 - (k % 3) * 6)], w=1.4, a=0.62)
    for x in (380, 450, 520):
        C([(x, 390), (x + 12, 418), (x + 6, 444)], w=1.1, a=0.42)
    # a little tone under the belly
    d.hatch(P([(240, 440), (596, 440), (600, 462), (232, 464)]), angle=-32, spacing=6, a=0.32)
    d.hatch(P([(300, 480), (600, 476), (610, 490), (290, 494)]), angle=-32, spacing=7, a=0.22)
    return d

@functools.lru_cache(maxsize=1)
def auntie_drawing():
    """食堂打饭的阿姨: a profile line, a hairnet cap, a white collar. No detailed face."""
    d = Drawing(seed=802, width=2.0, alpha=0.85)
    P = _xf(1.0, 10, 20)
    C = lambda pts, **kw: d.curve(P(pts), **kw)
    cap = [(314, 240), (296, 204), (256, 182), (206, 182), (166, 208), (146, 256), (150, 318), (172, 372),
           (196, 360), (226, 330), (262, 296), (296, 262), (314, 240)]
    C(cap, w=1.9)
    d.hatch(P(cap), angle=38, spacing=10, cross=True, a=0.30)
    C([(172, 372), (204, 350), (240, 318), (276, 286), (312, 246)], w=1.2, a=0.55)          # the elastic edge
    # the profile, one line: forehead, nose, lips, chin, throat
    C([(314, 244), (326, 276), (332, 300), (338, 318), (356, 350), (340, 360), (346, 372), (338, 380),
       (343, 390), (338, 410), (318, 426), (298, 434), (294, 490)], w=2.0)
    C([(172, 372), (180, 420), (186, 490)], w=1.8)                                          # nape
    C([(232, 344), (220, 352), (222, 372), (236, 380)], w=1.3, a=0.6)                       # ear
    d.line(*P([(322, 314), (310, 316)])[0], *P([(322, 314), (310, 316)])[1], w=1.2, a=0.5)   # an eyelid, one stroke
    # white uniform: collar and shoulders
    C([(186, 490), (236, 516), (294, 490)], w=1.5)
    C([(184, 498), (120, 540), (40, 572)], w=1.7)
    C([(296, 498), (360, 540), (430, 570)], w=1.7)
    C([(236, 518), (238, 590)], w=1.0, a=0.45)
    # steam from the trays below, out of frame
    for k in range(3):
        x = 360 + k * 26
        C([(x, 556), (x - 8, 530), (x + 5, 505), (x - 3, 482)], w=0.9, a=0.3, passes=1)
    return d

def _tree_window(w, h):
    d = Drawing(seed=0)
    fr = O.window_frame(int(w * 0.09), int(h * 0.08), int(w * 0.82), int(h * 0.80), seed=811)
    t = O.tree(seed=7, x=w * 0.5, y=h * 0.95, s=0.6)
    d.strokes = list(fr.strokes) + list(t.strokes)
    return d

def _tree_road(w, h):
    d = Drawing(seed=812, width=1.4, alpha=0.7)
    d.line(0, h * 0.84, w, h * 0.83, w=1.0, a=0.45)
    d.line(w * 0.56, h * 0.84, w * 0.72, h * 1.0, w=1.0, a=0.4)
    d.line(w * 0.70, h * 0.84, w * 0.80, h * 0.86, w=0.8, a=0.3)
    d.line(w * 0.08, h * 0.60, w * 0.08, h * 0.84, w=1.0, a=0.4)          # a lamp post
    d.line(w * 0.08, h * 0.60, w * 0.14, h * 0.60, w=1.0, a=0.4)
    t = O.tree(seed=14, x=w * 0.45, y=h * 0.86, s=0.6, leaves=False)
    out = Drawing(seed=0)
    out.strokes = list(d.strokes) + list(t.strokes)
    return out

PHOTOS = [
    # key, w, h, label, date, builder
    ('cat', 620, 470, '校门口的橘猫', '3.9', lambda w, h: cat_drawing()),
    ('auntie', 450, 600, '食堂的阿姨', '3.12', lambda w, h: auntie_drawing()),
    ('window', 620, 520, '窗外 · 梧桐', '3.15', _tree_window),
    ('bark', 450, 600, '梧桐 · 树皮', '3.21', lambda w, h: O.tree(seed=12, x=w * 0.48, y=h * 1.18, s=2.1, leaves=False, depth=3)),
    ('below', 450, 600, '梧桐 · 从树下看', '4.4', lambda w, h: O.tree(seed=15, x=w * 0.36, y=h * 1.02, s=0.8)),
    ('winter', 620, 470, '梧桐 · 路口', '4.19', lambda w, h: _tree_road(w, h)),
    ('late', 450, 600, '梧桐', '4.30', lambda w, h: O.tree(seed=11, x=w * 0.46, y=h * 0.95, s=0.74)),
]

@functools.lru_cache(maxsize=16)
def photo(i):
    key, w, h, label, date, fn = PHOTOS[i]
    surf = skia.Surface(w, h)
    c = surf.getCanvas()
    rgb = tuple(int(v) for v in mix(B_PAPER_WARM, B_PAPER_GREY, 0.08 + 0.05 * i))
    c.drawImage(paper(w, h, rgb, 30 + i, 0.8, 0.8), 0, 0)
    fn(w, h).draw(c, 1.0)
    text(c, label, w - 28, h - 34, 'hand', 22, GRAPHITE, 0.72, 'right')
    text(c, date, w - 28, h - 10, 'hand', 17, GRAPHITE, 0.5, 'right')
    # a phone photo of a page on a desk: warm lamp fall-off, one edge of the desk showing
    g = skia.GradientShader.MakeRadial((w * 0.3, h * 0.2), max(w, h) * 1.1, [col(LAMP, 0.0), col((60, 50, 40), 0.20)], [0.35, 1.0])
    c.drawRect(skia.Rect(0, 0, w, h), skia.Paint(Shader=g))
    edge = [(0, h), (w, h), (w, h - 7 - 5 * (i % 3)), (0, h - 3 - 3 * (i % 2))]
    pth = skia.Path(); pth.moveTo(*edge[0])
    for q in edge[1:]:
        pth.lineTo(*q)
    pth.close()
    c.drawPath(pth, paint((92, 74, 58), 0.55))
    return surf.makeImageSnapshot().withDefaultMipmaps()

# =====================================================================
# the text of the files (verbatim)
# =====================================================================
# each entry: date shown, list of (shown piece, spoken text); the first spoken text carries the date
DIARY = [
    ('3月18日', [('签了合同。六千块。', '三月十八日。签了合同。六千块。'),
                ('半年后还六千四百五，应该没问题。', '半年后环六千四百五，应该没问题。'),
                ('买了新手机，跟他们说家里寄的钱。浩然没怀疑。', None),
                ('我不喜欢说谎，但他说的对，借钱不好听。', None)]),
    ('3月28日', [('反复看了三遍才发现。', '三月二十八日。反复看了三遍才发现。'),
                ('那个“月”字。藏在最右边。', None),
                ('月利率百分之十五。', None),
                ('六千块一个月光利息就是九百。', '六千块一个月，光利息就是九百。')]),
    ('4月2日', [('第一次逃课。', '四月二日。第一次逃课。'),
               ('不想动。', None)]),
    ('4月10日', [('打了三次电话给学校的心理咨询中心。', '四月十日。打了三次电话给学校的心理咨询中心。'),
                ('第一次占线，第二次挂了，第三次走到了门口。', None),
                ('站了五分钟。进不去。说不出口。', None),
                ('一个大男人，走进去说“我好像不太对劲”——', '一个大男人，走进去说，我好像不太对劲。'),
                ('说不出口。', None)]),
    ('4月17日', [('他们打电话来说我逾期了。', '四月十七日。他们打电话来说我逾期了。'),
                ('合同第六条。我又看了一遍。真的写着。', None)]),
    ('5月8日', [('签了新合同。一万二。', '五月八日。签了新合同。一万二。'),
               ('钱在桌上放了三十秒就被他收走了。', None),
               ('一分钱都没拿到。', None)]),
]
# pause after each piece (seconds), per entry
DIARY_POST = [[0.45, 0.5, 0.55, 0.3], [0.6, 0.55, 0.4, 0.3], [0.9, 0.3], [0.45, 0.6, 0.6, 1.0, 0.3], [0.55, 0.3], [0.6, 0.6, 0.3]]

FILE2 = [   # stanzas of broken lines
    ['两万七千。', '让我去哪里找。'],
    ['他说他知道我家住哪。', '他说他知道我妈吃什么药。', '他说他不介意找他们聊聊。'],
    ['我每天都在想这件事。', '从早上醒来想到晚上睡着，', '又从梦里想到醒过来。', '有时候分不清哪些是在想，', '哪些是在梦。'],
    ['我的精神快崩溃了。'],
]
FILE2_VAR = {'让我去哪里找。': 1, '我的精神快崩溃了。': 1}
FILE2_POST = [[1.3, 1.9], [1.1, 1.2, 2.0], [0.9, 0.45, 1.1, 0.5, 2.2], [2.4]]

FILE3 = ['今天想找李浩然说。他连头都没回。', '也对。我就是个蹭他饭的穷鬼。', '在他们眼里，我不配跟他们做室友。']

FILES = [('日记.txt', '6 KB', '5月8日 23:31'), ('未命名.txt', '1 KB', '5月8日 23:31'),
         ('新建文本文档.txt', '1 KB', '5月8日 23:32')]
FOLDER = ('速写', '7 项', '5月8日 23:33')

# =====================================================================
# the screen insert
# =====================================================================
@functools.lru_cache(maxsize=1)
def _offscreen():
    return skia.Surface(W, H)

class Screen:
    ROW0, ROWH = CY0 + 196, 74

    def __init__(self):
        self.views = []                 # (t0, t1, name, arg)
        self.keys = []                  # cursor keyframes (t, x, y)
        self.clicks = []                # double-click times
        self.cur_vis = []               # (t0, t1) cursor visible
        self.scan = (0, 1)
        self.rows_at = []               # float-up time per file row
        self.folder_at = None
        self.select = []                # (t0, t1, row)
        self.diary = []                 # per entry: dict(t0, t1, times_date, times_body)
        self.emph = None                # (t0, t1) the 4月10日 entry recalled
        self.f2 = []                    # per stanza: dict(t0, t1, times)
        self.f3 = None
        self.grid_at = None
        self.enlarge = None             # (t0, t1)
        self.off = None
        self.log = None                 # Master (for the mini log)
        self.pushes = []                # (t0, t1, t_release, amount): a slow push-in on the handwriting

    def zoom(self, T):
        z = 1.0
        for (t0, t1, tr, k) in self.pushes:
            if T <= t0:
                continue
            u = ease_in_out((T - t0) / (t1 - t0)) if T < t1 else 1.0
            if T > tr:
                u *= 1 - ease_in_out((T - tr) / 1.4)
            z += k * u
        return z

    def view(self, t0, t1, name, arg=None):
        self.views.append((t0, t1, name, arg))

    def row_xy(self, r):
        return SX + (330 if r != 3 else 190), self.row_y(r) - 10

    def cursor_to(self, t0, t1, xy):
        if not self.keys:
            self.keys.append((t0, *xy))
        self.keys.append((t0, *self.keys[-1][1:]))
        self.keys.append((t1, *xy))

    def cursor_xy(self, T):
        ks = self.keys
        if not ks:
            return None
        if T <= ks[0][0]:
            return ks[0][1:]
        for k in range(len(ks) - 1):
            ta, xa, ya = ks[k]; tb, xb, yb = ks[k + 1]
            if T < tb:
                u = ease_in_out(ramp(T, ta, tb))
                return xa + (xb - xa) * u, ya + (yb - ya) * u
        return ks[-1][1:]

    # ---------------- drawing ----------------
    def draw(self, c, T, w, h):
        z = self.zoom(T)
        if z > 1.0001:
            # a slow push-in: render the shot flat once, then scale the picture (a continuously changing
            # canvas scale would re-rasterise every glyph each frame)
            surf = _offscreen()
            oc = surf.getCanvas()
            self.draw_flat(oc, T)
            img = surf.makeImageSnapshot()
            fx, fy = SX + 1040, CY0 + 420
            c.save()
            c.translate(fx, fy); c.scale(z, z); c.translate(-fx, -fy)
            c.drawImage(img, 0, 0, skia.SamplingOptions(skia.FilterMode.kLinear))
            c.restore()
        else:
            self.draw_flat(c, T)
        self.draw_log(c, T)

    def draw_flat(self, c, T):
        a_bg(c)
        path = '本地磁盘 (D:)  ›  已删除的文件'
        cur = [v for v in self.views if v[0] <= T < v[1] + 0.35]
        if cur and cur[-1][2] in ('diary', 'emph'):
            path += '  ›  日记.txt'
        elif cur and cur[-1][2] == 'f2':
            path += '  ›  未命名.txt'
        elif cur and cur[-1][2] == 'f3':
            path += '  ›  新建文本文档.txt'
        elif cur and cur[-1][2] in ('grid',):
            path += '  ›  速写'
        chrome(c, path)
        c.save()
        c.clipRect(skia.Rect.MakeXYWH(SX + 1, CY0 + 1, SW - 2, SH - (CY0 - SY) - 2))
        for (t0, t1, name, arg) in self.views:
            a = min(smooth((T - t0) / 0.35), smooth((t1 - T) / 0.35))
            if a <= 0:
                continue
            getattr(self, 'v_' + name)(c, T, a, arg)
        # the cursor
        xy = self.cursor_xy(T)
        ca = max([min(smooth((T - a_) / 0.3), smooth((b_ - T) / 0.3)) for (a_, b_) in self.cur_vis] or [0])
        if xy and ca > 0:
            for tc in self.clicks:
                for dt in (0.0, 0.16):
                    k = (T - tc - dt) / 0.35
                    if 0 < k < 1:
                        c.drawCircle(xy[0], xy[1], 6 + 16 * k, paint(A_INK, ca * 0.5 * (1 - k), 1.2))
            cursor(c, xy[0], xy[1], ca)
        # the monitor switched off
        if self.off is not None and T > self.off:
            k = smooth((T - self.off) / 0.18)
            c.drawRect(skia.Rect.MakeXYWH(SX, CY0, SW, SH), paint((26, 30, 35), 0.94 * k))
        c.restore()
        if self.off is not None and T > self.off:
            k = smooth((T - self.off) / 0.18)
            c.drawRect(skia.Rect.MakeXYWH(SX, SY, SW, CY0 - SY), paint((26, 30, 35), 0.94 * k))

    def draw_log(self, c, T):
        # the mini log (right column): an overlay, not part of the shot
        if self.log is not None:
            text(c, '记录', MLX, SY + 34, 'sans-light', 16, A_MID, 0.9, tracking=0.4)
            line(c, MLX, SY + 50, MLX + 330, SY + 50, A_MID, 0.4, 1.0)
            scroll_log(c, MLX, SY + 100, self.log.entries('i'), T, SY + SH - 10, maxw=380, size=19, cps=20)

    # -- scanning: a progress bar standing in for two minutes --
    def v_scan(self, c, T, a, arg):
        t0, t1 = self.scan
        p = ramp(T, t0, t1)
        p = p ** 0.9
        x0, x1 = SX + 70, SX + SW - 70
        head = '正在扫描已删除的文件' if p < 1 else '扫描完成'
        text(c, head, x0, CY0 + 118, 'sans-light', 30, A_INK, a, tracking=0.08)
        text(c, '本地磁盘 (D:)  ·  用户：张朝阳', x0, CY0 + 160, 'sans-light', 18, A_MID, a, tracking=0.1)
        text(c, f'{int(round(p * 100))}%', x1, CY0 + 234, 'sans-xlight', 56, A_INK, a, 'right')
        yb = CY0 + 262
        c.drawRect(skia.Rect.MakeLTRB(x0, yb, x1, yb + 4), paint(A_FAINT, a))
        c.drawRect(skia.Rect.MakeLTRB(x0, yb, x0 + (x1 - x0) * p, yb + 4), paint(A_INK, a))
        el = int(round(120 * p))
        found = sum(1 for q in (0.58, 0.77, 0.94, 0.99) if p >= q)
        stats = [('已扫描扇区', f'{int(49152 * p):,} / 49,152'.replace(',', ' ')), ('已用时', f'{el // 60:02d}:{el % 60:02d}'),
                 ('已发现', f'{min(3, found)} 个文件' + (' · 1 个文件夹' if found >= 4 else ''))]
        for k, (lb, v) in enumerate(stats):
            yy = CY0 + 330 + k * 44
            text(c, lb, x0, yy, 'sans-light', 18, A_MID, a, tracking=0.2)
            text(c, v, x0 + 150, yy, 'sans-light', 20, A_INK, a, tracking=0.05)
        # the disk going past: skipped debris, dim; the three finds stay dark
        rng = np.random.default_rng(88)
        names = ['~WRL%04d.tmp' % rng.integers(1, 9999) for _ in range(40)]
        stat = ['已覆盖', '碎片', '已覆盖', '不可读', '已覆盖']
        n = int(p * 60)
        finds = {35: '\\文档\\日记.txt', 46: '\\文档\\未命名.txt', 56: '\\桌面\\新建文本文档.txt', 59: '\\图片\\速写\\'}
        lines = []
        for k in range(n):
            if k in finds:
                lines.append((f'D:{finds[k]}', '可恢复', True))
            else:
                lines.append((f'D:\\Temp\\{names[k % 40]}', stat[k % 5], False))
        lines = lines[-7:]
        for j, (pth, st, good) in enumerate(lines):
            yy = CY0 + 490 + j * 30
            aa = a * (0.95 if good else 0.32)
            text(c, pth, x0, yy, 'sans-light', 16, A_INK if good else A_MID, aa, tracking=0.03)
            text(c, st, x0 + 520, yy, 'sans-light', 16, A_INK if good else A_MID, aa, tracking=0.1)

    # -- the list of what came back --
    def v_list(self, c, T, a, arg):
        x0 = SX + 70
        kf = smooth((T - self.folder_at) / 0.6) if (self.folder_at is not None and T > self.folder_at) else 0.0
        text(c, '发现 3 个可恢复的文件  ·  1 个文件夹', x0, CY0 + 92, 'sans-light', 28, A_INK, a, tracking=0.06)
        cols = [('名称', x0 + 60), ('大小', SX + 720), ('删除时间', SX + 860), ('状态', SX + 1110)]
        for lb, x in cols:
            text(c, lb, x, CY0 + 150, 'sans-light', 17, A_MID, a, tracking=0.3)
        line(c, x0, CY0 + 166, SX + SW - 70, CY0 + 166, A_MID, a * 0.5, 1.0)
        rows = [(n, s, d, False, self.row_y(r)) for r, (n, s, d) in enumerate(FILES)]
        rows.append((FOLDER[0] + '/', FOLDER[1], FOLDER[2], True, self.row_y(4)))
        for r, (nm, sz, dt, isdir, y0) in enumerate(rows):
            ta = self.folder_at if isdir else (self.rows_at[r] if r < len(self.rows_at) else None)
            if ta is None or T < ta:
                continue
            k = smooth((T - ta) / 0.7)
            y = y0 + 26 * (1 - k)
            rr = 4 if isdir else r
            sel = 0.0
            for (s0, s1, q) in self.select:
                if q == rr:
                    sel = max(sel, min(smooth((T - s0) / 0.2), smooth((s1 - T) / 0.3)))
            if sel > 0:
                c.drawRect(skia.Rect.MakeLTRB(x0 - 12, y - 42, SX + SW - 58, y + 22), paint(A_FAINT, a * 0.95 * sel))
                c.drawRect(skia.Rect.MakeLTRB(x0 - 12, y - 42, x0 - 8, y + 22), paint(A_INK, a * sel))
            ix = x0 + 8 + (26 if isdir else 0)
            (icon_folder if isdir else icon_doc)(c, ix, y - 30, 1.2, a * k)
            text(c, nm, ix + 52, y, 'sans-light', 27, A_INK, a * k, tracking=0.03)
            text(c, sz, SX + 720, y, 'sans-light', 19, A_MID, a * k, tracking=0.05)
            text(c, dt, SX + 860, y, 'sans-light', 19, A_MID, a * k, tracking=0.05)
            text(c, '可恢复', SX + 1110, y, 'sans-light', 19, A_MID, a * k, tracking=0.2)
            line(c, x0, y + 30, SX + SW - 70, y + 30, A_FAINT, a * k, 1.0)
        # the folder group: collapsed until someone looks
        if self.rows_at and T > self.rows_at[-1] + 0.3:
            k = smooth((T - self.rows_at[-1] - 0.3) / 0.7)
            gy = self.row_y(3)
            tri = skia.Path()
            if kf < 0.5:
                tri.moveTo(x0 + 6, gy - 16); tri.lineTo(x0 + 16, gy - 10); tri.lineTo(x0 + 6, gy - 4)
            else:
                tri.moveTo(x0 + 4, gy - 14); tri.lineTo(x0 + 16, gy - 14); tri.lineTo(x0 + 10, gy - 6)
            tri.close()
            c.drawPath(tri, paint(A_MID, a * k))
            text(c, '文件夹（1）', x0 + 30, gy - 2, 'sans-light', 19, A_MID, a * k, tracking=0.2)
            if kf <= 0:
                line(c, x0, gy + 14, SX + SW - 70, gy + 14, A_FAINT, a * k, 1.0)

    def row_y(self, r):
        return self.ROW0 + [0, 1, 2][r] * self.ROWH if r < 3 else (self.ROW0 + 3 * self.ROWH - 10 if r == 3 else self.ROW0 + 3 * self.ROWH + 62)

    # -- a text file open: raw text on the left, his handwriting laid over the right --
    def _viewer_head(self, c, a, name, meta):
        x0 = SX + 60
        icon_doc(c, x0, CY0 + 34, 1.0, a)
        text(c, name, x0 + 38, CY0 + 58, 'sans', 23, A_INK, a, tracking=0.05)
        text(c, meta, x0 + 62 + text_width(name, 'sans', 23, 0.05), CY0 + 58, 'sans-light', 16, A_MID, a, tracking=0.08)
        line(c, SX + 40, CY0 + 88, SX + SW - 40, CY0 + 88, A_MID, a * 0.4, 1.0)
        line(c, SX + 500, CY0 + 118, SX + 500, SY + SH - 40, A_FAINT, a, 1.2)

    def _raw(self, c, a, paras, cur, top=None, size=16, lh=1.75):
        """The cold .txt: line numbers, sans, the passage being read highlighted."""
        x0, maxw = SX + 90, 370
        y = (CY0 + 140) if top is None else top
        ln = 1
        for i, s in enumerate(paras):
            lines = wrap(s, 'sans-light', size, maxw)
            on = (cur == i)
            if on:
                c.drawRect(skia.Rect.MakeLTRB(x0 - 10, y - size * 1.15, x0 + maxw + 12, y + (len(lines) - 1) * size * lh + size * 0.55),
                           paint(A_FAINT, a * 0.9))
            for j, l in enumerate(lines):
                if j == 0:
                    text(c, f'{ln}', x0 - 22, y, 'sans-light', 13, A_MID, a * 0.7, 'right')
                    ln += 1
                text(c, l, x0, y, 'sans-light', size, A_INK if on else A_MID, a * (0.95 if on else 0.55), tracking=0.02)
                y += size * lh
            y += size * 0.5
        return y

    def _hand_label(self, c, a, s):
        text(c, s, SX + 580, CY0 + 150, 'sans-light', 18, A_MID, a, tracking=0.35)

    def v_diary(self, c, T, a, arg):
        self._viewer_head(c, a, '日记.txt', '6 KB  ·  最后修改 5月8日 23:02  ·  已恢复')
        cur = None
        for i, e in enumerate(self.diary):
            if e['t0'] - 0.3 <= T:
                cur = i
        paras = [f'{d}。' + ''.join(p for p, _ in pieces) for d, pieces in DIARY]
        self._raw(c, a, paras, cur)
        self._hand_label(c, a, '张朝阳  ·  日记')
        for i, e in enumerate(self.diary):
            ea = a * min(smooth((T - e['t0'] + 0.5) / 0.4), smooth((e['t1'] - T) / 0.5))
            if ea <= 0:
                continue
            self._entry(c, T, ea, i, e)

    def _entry(self, c, T, a, i, e, alphas=None, times=True):
        date, pieces = DIARY[i]
        body = ''.join(p for p, _ in pieces)
        x0, y0 = SX + 580, CY0 + 222
        lay_d = hand_layout(date, 700, 34, 1.6)
        hand_draw(c, lay_d, x0, y0, 34, e['times_date'] if times else None, T, a * 0.75, seed=90 + i)
        sz = 44 if len(body) < 60 else 40
        lay = hand_layout(body, 680 if sz == 40 else 740, sz, 1.62)
        red = ()
        if '“月”' in body:
            red = (body.index('“月”') + 1,)
        hand_draw(c, lay, x0, y0 + 82, sz, e['times_body'] if times else None, T, a, seed=100 + i, red=red, alphas=alphas)

    def v_emph(self, c, T, a, arg):
        """Li: 他去过心理咨询中心？ — the 4月10日 entry comes back; only 说不出口 stays dark."""
        self._viewer_head(c, a, '日记.txt', '6 KB  ·  最后修改 5月8日 23:02  ·  已恢复')
        paras = [f'{d}。' + ''.join(p for p, _ in pieces) for d, pieces in DIARY]
        self._raw(c, a, paras, 3)
        self._hand_label(c, a, '张朝阳  ·  日记')
        date, pieces = DIARY[3]
        body = ''.join(p for p, _ in pieces)
        t0, t_dim = self.emph
        k = smooth((T - t_dim) / 1.2)
        al = [1.0] * len(body)
        for st in (i for i in range(len(body)) if body.startswith('说不出口', i)):
            for j in range(st, st + 4):
                al[j] = -1
        al = [1.0 if v < 0 else 1.0 - 0.72 * k for v in al]
        self._entry(c, T, a, 3, None, alphas=al, times=False)

    def v_f2(self, c, T, a, arg):
        self._viewer_head(c, a, '未命名.txt', '1 KB  ·  最后修改 5月3日 04:17  ·  已恢复')
        raw = [''.join(st) for st in FILE2]
        cur = None
        for i, s in enumerate(self.f2):
            if s['t0'] - 0.3 <= T:
                cur = i
        self._raw(c, a, raw, cur)
        self._hand_label(c, a, '张朝阳  ·  未命名.txt')
        for i, s in enumerate(self.f2):
            sa = a * min(smooth((T - s['t0'] + 0.5) / 0.4), smooth((s['t1'] - T) / 0.7))
            if sa <= 0:
                continue
            lines = FILE2[i]
            ys = CY0 + (250 if len(lines) > 1 else 400)
            for j, ln in enumerate(lines):
                # broken lines: ragged indents, uneven gaps
                dx = [0, 70, 18, 120, 40][(j + i) % 5]
                lay = hand_layout(ln, 740, 42, 1.6)
                hand_draw(c, lay, SX + 580 + dx, ys, 42, s['times'][j], T, sa * (0.92 - 0.05 * (j % 2)),
                          jit=1.9, seed=300 + i * 10 + j, fin=0.3)
                ys += 42 * (1.9 + 0.35 * ((j * 7 + i) % 3))

    def v_f3(self, c, T, a, arg):
        self._viewer_head(c, a, '新建文本文档.txt', '1 KB  ·  最后修改 5月8日 17:26  ·  已恢复')
        self._raw(c, a, FILE3, 0 if (self.f3 and T > self.f3['t0'] - 0.3) else None)
        if self.f3 is None:
            return
        self._hand_label(c, a, '张朝阳  ·  新建文本文档.txt')
        for j, ln in enumerate(FILE3):
            lay = hand_layout(ln, 740, 42, 1.6)
            hand_draw(c, lay, SX + 580, CY0 + 262 + j * 118, 42, self.f3['times'][j], T, a, jit=1.2, seed=400 + j)

    # -- the folder: phone photos of his sketches --
    def cell(self, i):
        cw = (SW - 140) / 4
        cx = SX + 70 + (i % 4) * cw + cw / 2
        cy = CY0 + 252 + (i // 4) * 262
        return cx, cy, 250, 196

    def v_grid(self, c, T, a, arg):
        x0 = SX + 60
        icon_folder(c, x0, CY0 + 34, 1.0, a)
        text(c, '速写/', x0 + 44, CY0 + 58, 'sans', 23, A_INK, a, tracking=0.05)
        text(c, '7 项  ·  手机照片  ·  已恢复', x0 + 120, CY0 + 58, 'sans-light', 16, A_MID, a, tracking=0.08)
        line(c, SX + 40, CY0 + 88, SX + SW - 40, CY0 + 88, A_MID, a * 0.4, 1.0)
        big = 2
        ke = 0.0
        if self.enlarge is not None:
            e0, e1 = self.enlarge
            ke = ease_in_out((T - e0) / 1.4) * (1 - ease_in_out((T - e1) / 1.0))
        order = [i for i in range(len(PHOTOS)) if i != big] + [big]
        for i in order:
            ta = self.grid_at + 0.35 + 0.28 * i
            k = smooth((T - ta) / 0.6)
            if k <= 0:
                continue
            img = photo(i)
            cx, cy, bw, bh = self.cell(i)
            s = min(bw / img.width(), bh / img.height())
            if i == big and ke > 0:
                s2 = min(760 / img.width(), 520 / img.height())
                s = s + (s2 - s) * ke
                cx = cx + ((SX + SW / 2) - cx) * ke
                cy = cy + ((CY0 + 372) - cy) * ke
            dim = 1.0 if i == big else 1 - 0.8 * ke
            iw, ih = img.width() * s, img.height() * s
            rect = skia.Rect.MakeXYWH(cx - iw / 2, cy - ih / 2, iw, ih)
            if i == big and ke > 0:
                c.drawRect(skia.Rect.MakeLTRB(SX + 1, CY0 + 90, SX + SW - 1, SY + SH - 1), paint(SCREEN, a * 0.85 * ke))
            if i != big and ke > 0.97:
                continue                     # hidden behind the enlarged photo
            for (ox, oy, sa) in ((2, 3, 0.07), (4, 7, 0.05), (7, 11, 0.03)):
                c.drawRect(rect.makeOffset(ox, oy), paint((10, 16, 24), sa * a * k * dim))
            p = skia.Paint(); p.setAlphaf(clamp(a * k * dim))
            c.drawImageRect(img, rect, SAMP, p)
            c.drawRect(rect, paint(A_INK, a * k * dim * 0.5, 1.0))
            fn = f'IMG_{2031 + i * 7:04d}.jpg'
            if i != big or ke < 0.5:
                text(c, fn, cx, cy + ih / 2 + 26, 'sans-light', 15, A_MID, a * k * dim * (1 - ke if i == big else 1), 'center', tracking=0.05)
            else:
                text(c, fn + '   ·   ' + '拍摄于 3月15日', cx, cy + ih / 2 + 32, 'sans-light', 16, A_MID, a * (ke - 0.5) * 2, 'center', tracking=0.05)

    def v_off(self, c, T, a, arg):
        pass

# =====================================================================
# small sounds
# =====================================================================
def _tt(d):
    return np.arange(int(d * SR)) / SR

def disk_seek(d, seed=850):
    """A hard disk reading: soft irregular ticks and a faint whirr."""
    rng = np.random.default_rng(seed)
    out = np.zeros(int(d * SR), np.float32)
    tpos = 0.02
    while tpos < d - 0.05:
        x = sfx.click(int(rng.integers(1e6)), rng.uniform(1800, 3800), 0.018, rng.uniform(0.08, 0.2))
        s = int(tpos * SR); out[s:s + len(x)] += x[:len(out) - s]
        tpos += rng.exponential(0.07) + 0.015
    whirr = bandpass(sfx.noise(d, seed + 1), 5200, 7400) * 0.006
    return env_fade(out + whirr.astype(np.float32), 0.3, 0.4)

def mouse_double(seed=860):
    a = sfx.click(seed, 2600, 0.018, 0.45)
    b = sfx.click(seed + 1, 2500, 0.018, 0.4)
    out = np.zeros(int(0.3 * SR), np.float32)
    out[:len(a)] += a
    s = int(0.16 * SR); out[s:s + len(b)] += b
    return out

def chair(seed=870, d=0.8):
    rng = np.random.default_rng(seed)
    t = _tt(d)
    f = 220 + 140 * np.sin(np.pi * t / d)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * (rng.random(len(t)) < 0.25) * 0.15
    x = lowpass(x.astype(np.float32), 2200) * np.sin(np.pi * t / d)
    thud = lowpass(sfx.noise(0.2, seed, 'brown'), 160) * np.exp(-_tt(0.2) * 18) * 4
    out = np.zeros(int((d + 0.3) * SR), np.float32)
    out[:len(x)] += x
    s = int(d * 0.7 * SR); out[s:s + len(thud)] += thud[:len(out) - s]
    return out

def fan(d, seed=880):
    t = _tt(d)
    x = lowpass(sfx.noise(d, seed, 'pink'), 700) * 0.012 + 0.003 * np.sin(2 * np.pi * 118 * t)
    return x.astype(np.float32)

# =====================================================================
# one-syllable lines: ZipVoice aborts (malloc) or returns ~0.1 s of noise on a single character,
# so the word is synthesised inside a short carrier phrase and the first phrase is cut out.
# =====================================================================
def _first_phrase(y, sr=SR, thr=0.035, gap=0.03, min_voiced=0.12):
    fr = int(0.01 * sr)
    env = np.array([np.abs(y[i:i + fr]).max() for i in range(0, max(1, len(y) - fr), fr)])
    on = np.where(env > thr)[0]
    if len(on) == 0:
        return y
    i = on[0] + int(min_voiced / 0.01)
    quiet = 0
    while i < len(env):
        quiet = quiet + 1 if env[i] <= thr else 0
        if quiet * 0.01 >= gap:
            break
        i += 1
    cut = min(len(y), int((i - quiet + 6) * fr))
    seg = np.array(y[:cut], np.float32)
    k = min(len(seg), int(0.04 * sr))
    seg[len(seg) - k:] *= np.linspace(1, 0, k) ** 2
    return seg

def say_word(sc, who, text, carrier, speed=1.0, fx='room', gain=0.0, pan=0.0, post=0.45, note='', sub_text=None):
    import os, soundfile as sf
    from film import voice as V
    from film.timeline import FX, Sub
    y, path = V.synth(who, carrier, speed=speed)
    out = path[:-4] + '_w.wav'
    if not os.path.exists(out):
        sf.write(out, _first_phrase(y), SR)
    seg, _sr = sf.read(out, dtype='float32')
    yfx = FX[fx](seg)
    start = sc.t
    d = len(yfx) / SR
    sc.audio.append((start, yfx, gain, pan, 'voice', 0.0, 0.02))
    sc.lines.append((who, text, out, start))
    sc.subs.append(Sub(start, start + d, who, sub_text or text, sc.sub_style, note, d))
    sc.t = start + d + post
    return start, start + d

# =====================================================================
# build
# =====================================================================
def build():
    sc = Scene('s08_loop', kind='A', title='第八场【循环】')
    M = Master(LOOP, {'李': 'li_bed', '陈': 'chen_bed'})
    S = Screen()
    S.log = M

    # ---------- the ritual, short: the audience knows it by now ----------
    sc.wait(0.4)
    t_alarm = sc.t
    al = sfx.alarm(2)
    cut = int(2.3 * SR)
    sc.sfx(env_fade(al[:cut], 0.0, 0.04), gain=-6)
    sc.wait(0.45)
    t_board = sc.t
    def board(c, t, L):
        O.bed_board(c, L.w, L.h, 1.0)
    sc.layer(board, t_board, t_board + 1.9, fin=0.3, fout=0.3)
    sc.wait(1.6)
    t_master = sc.t
    sc.sfx(sfx.click(4, 2500, 0.03, 0.4), at=t_alarm + 2.3, gain=-8)
    sc.amb(sfx.room_tone(60, 1), t_master, None, gain=-2)
    M.counter_from = t_master + 0.8
    M.add(t_master + 0.4, '08:30', '闹钟。')
    M.t_siren = t_master + 1.2
    sc.sfx(sfx.siren(9.0), at=M.t_siren, gain=-13)
    M.add(t_master + 3.0, '08:31', '警笛。同一个位置。')
    sc.wait(4.4)

    # Chen goes straight to Zhang's desk
    t = sc.t
    M.add(t, '08:32', '陈杰辉下床，坐到张朝阳的电脑前。')
    M.moves.append((t + 0.3, t + 3.4, '陈', 'chen_bed', (2.95, 4.05)))
    M.left['陈'] = lambda T, a_=t + 2.6: T > a_
    sc.sfx(sfx.footsteps(5, 0.56, 801, a=0.5), at=t + 0.3, gain=-12)
    sc.sfx(chair(802), at=t + 3.2, gain=-11, pan=0.3)
    M.chair_taken = t + 3.4
    sc.wait(4.2)
    t = sc.t
    M.screen_on = t
    sc.sfx(sfx.click(805, 1600, 0.03, 0.5), at=t, gain=-12, pan=0.3)
    sc.amb(fan(30, 806), t, None, gain=-12)
    M.add(t + 0.3, '08:32', '他已经知道怎么恢复被删除的文件了——前几次循环试过。')
    sc.wait(3.2)
    t = sc.t
    M.add(t, '08:33', '李浩然站到他身后，看屏幕。')
    M.moves.append((t + 0.2, t + 2.8, '李', 'li_bed', (2.35, 3.72)))
    sc.sfx(sfx.footsteps(4, 0.6, 807, a=0.45), at=t + 0.3, gain=-13)
    sc.wait(3.3)
    t = sc.t
    sc.sfx(sfx.keyboard(1.4, 6, 808), at=t, gain=-13, pan=0.3)
    M.add(t + 0.6, '08:34', '恢复程序开始运行。', 'b')
    sc.wait(2.6)

    # ---------- the insert: the screen ----------
    t_ins = sc.t
    t_master_end = t_ins + 0.6
    S.scan = (t_ins + 0.8, t_ins + 8.3)
    S.view(t_ins, t_ins + 8.9, 'scan')
    sc.sfx(disk_seek(7.8, 850), at=t_ins + 0.6, gain=-14, pan=0.25)
    M.add(t_ins + 4.6, '08:35', '程序跑了两分钟。', 'i')
    t_list = t_ins + 8.6
    S.rows_at = [t_list + 0.25, t_list + 0.6, t_list + 0.95]
    M.add(t_list + 0.4, '08:36', '三个文件浮上来。', 'i')
    sc.sfx(sfx.click(851, 3200, 0.02, 0.3), at=t_ins + 8.3, gain=-16)
    sc.at(t_list + 2.4)

    views_list = [t_list]                 # list view spans are stitched between the files

    def open_row(r, t_click):
        """The cursor goes to row r and double-clicks at t_click."""
        S.cursor_to(t_click - 1.2, t_click - 0.1, S.row_xy(r))
        S.clicks.append(t_click)
        S.select.append((t_click - 0.3, t_click + 0.9, r))
        sc.sfx(mouse_double(860 + r * 3), at=t_click, gain=-10, pan=0.25)

    # the first file: the diary
    S.keys.append((t_list, SX + SW - 260, SY + SH - 120))
    S.cur_vis.append((t_list + 0.5, t_list + 3.8))
    open_row(0, t_list + 2.9)
    t_open = t_list + 3.5
    S.view(t_list, t_open + 0.1, 'list')
    M.add(t_list + 2.9, '08:36', '第一个是日记。陈杰辉打开它，开始读。', 'i')
    sc.at(t_open + 1.3)
    t_d0 = t_open
    for i, (date, pieces) in enumerate(DIARY):
        spans = []
        t_e = sc.t
        for j, (shown, spoken) in enumerate(pieces):
            st, en = sc.say('zhang', shown, tts=spoken, fx='vo', speed=0.9, sub=False, note='日记',
                            post=DIARY_POST[i][j])
            spans.append((st, en))
        n0 = len(date) + len(pieces[0][0])
        times = reveal_times([n0] + [len(p) for p, _ in pieces[1:]], spans)
        S.diary.append(dict(t0=t_e, t1=None, times_date=times[:len(date)], times_body=times[len(date):]))
        if i == 3:
            push_410 = (t_e, sc.t)
        sc.wait(1.25 if i < len(DIARY) - 1 else 1.6)
        S.diary[-1]['t1'] = sc.t - 0.1
    t_d1 = sc.t
    S.view(t_d0, t_d1 + 0.3, 'diary')
    S.pushes.append((push_410[0] - 0.5, push_410[1], push_410[1] + 0.2, 0.06))

    # 他去过心理咨询中心？ — the 4月10日 entry comes back
    S.emph = (t_d1, t_d1 + 1.4)
    S.view(t_d1, None, 'emph')
    sc.wait(0.3)
    sc.say('li', '他去过心理咨询中心？', speed=0.9, post=0.6)
    sc.say('chen', '走到门口了。没有进去。', speed=0.92, post=0.55)
    sc.say('li', '为什么？', speed=0.8, post=0.7)
    sc.say('chen', '他说，说不出口。', speed=0.88, post=1.8)
    t_e1 = sc.t
    S.views[-1] = (t_d1, t_e1 + 0.2, 'emph', None)

    # the second file: no title; the sentences start to break
    t_l2 = t_e1
    S.cur_vis.append((t_l2 + 0.3, t_l2 + 2.6))
    open_row(1, t_l2 + 1.7)
    S.view(t_l2, t_l2 + 2.3, 'list')
    M.add(t_l2 + 0.4, '08:41', '他们又打开了第二个文件。没有标题。', 'i')
    M.add(t_l2 + 3.2, '08:41', '文字比日记短得多，语句开始断裂。', 'i')
    t_f2 = t_l2 + 2.3
    sc.at(t_f2 + 1.6)
    drone_at = t_f2 + 0.5
    for i, stanza in enumerate(FILE2):
        t_s = sc.t
        spans = []
        for j, ln in enumerate(stanza):
            st, en = sc.say('zhang', ln, fx='inner', speed=0.86, sub=False, note='未命名', post=FILE2_POST[i][j],
                            variant=FILE2_VAR.get(ln, 0))
            spans.append((st, en))
        times = [reveal_times([len(ln)], [sp]) for ln, sp in zip(stanza, spans)]
        S.f2.append(dict(t0=t_s, t1=sc.t - 0.2, times=times))
    t_f2e = sc.t
    S.view(t_f2, t_f2e + 0.3, 'f2')
    sc.sfx(sfx.drone(t_f2e - drone_at + 2.0, 49.0, 881), at=drone_at, gain=-19, fin=2.0, fout=2.5, bus='music')

    # the third file: three lines; neither of them says anything
    t_l3 = t_f2e
    S.cur_vis.append((t_l3 + 0.3, t_l3 + 2.6))
    open_row(2, t_l3 + 1.7)
    S.view(t_l3, t_l3 + 2.3, 'list')
    M.add(t_l3 + 0.4, '08:43', '第三个文件只有三行。', 'i')
    t_f3 = t_l3 + 2.3
    M.add(t_f3 + 0.8, '08:43', '打开的时候，两个人都没有说话。', 'i')
    sc.at(t_f3 + 3.6)
    spans = []
    for j, ln in enumerate(FILE3):
        st, en = sc.say('zhang', ln, fx='vo', speed=0.88, sub=False, note='', post=[1.5, 1.6, 2.6][j])
        spans.append((st, en))
    S.f3 = dict(t0=spans[0][0], times=[reveal_times([len(ln)], [sp]) for ln, sp in zip(FILE3, spans)])
    t_f3e = sc.t
    S.pushes.append((t_f3 + 0.5, t_f3e, t_f3e - 0.2, 0.07))
    S.view(t_f3, t_f3e + 0.3, 'f3')

    # the folder
    t_l4 = t_f3e
    S.view(t_l4, t_l4 + 4.6, 'list')
    S.cur_vis.append((t_l4 + 0.3, t_l4 + 4.8))
    S.cursor_to(t_l4 + 0.3, t_l4 + 1.2, S.row_xy(3))
    S.clicks.append(t_l4 + 1.35)
    sc.sfx(sfx.click(890, 2600, 0.018, 0.45), at=t_l4 + 1.35, gain=-10, pan=0.25)
    S.folder_at = t_l4 + 1.5
    M.add(t_l4 + 1.5, '08:44', '恢复列表里还有一个文件夹。', 'i')
    open_row(4, t_l4 + 3.6)
    t_grid = t_l4 + 4.4
    S.grid_at = t_grid
    M.add(t_grid + 0.8, '08:44', '里面是手机拍下来的速写照片。画了好几个角度，每一幅都很细。', 'i')
    for k in range(len(PHOTOS)):
        sc.sfx(sfx.click(900 + k, 3600, 0.012, 0.12), at=t_grid + 0.35 + 0.28 * k, gain=-20, pan=0.25)
    t_en = t_grid + 6.6
    S.enlarge = (t_en, t_en + 60)
    M.add(t_en + 0.4, '08:45', '李浩然盯着那棵梧桐树看了一会儿。他认出了那个角度——就是从他们宿舍窗户看出去的。', 'i')
    M.add(t_en + 6.8, '08:45', '他们住了大半年，他从来不知道张朝阳会画画。', 'i')
    t_off = t_en + 11.8
    # the real tree, outside the real window: a breath of wind in the leaves while Li looks
    sc.sfx(sfx.wind(t_off - t_en + 1.0, 812, 0.55), at=t_en + 0.6, gain=-17, fin=3.0, fout=1.2, bus='amb')
    S.off = t_off
    S.view(t_grid, t_off + 1.5, 'grid')
    M.add(t_off, '08:46', '陈杰辉关掉了屏幕。', 'b')
    sc.sfx(sfx.click(910, 1500, 0.03, 0.6), at=t_off, gain=-9, pan=0.25)
    M.screen_off = t_off
    t_ins_end = t_off + 1.6

    def screen(c, t, L):
        S.draw(c, L.T, L.w, L.h)
    sc.layer(screen, t_ins - 0.05, t_ins_end + 0.9, fin=0.0, fout=0.0)

    # ---------- back to the plan: the chair, the dark screen ----------
    sc.at(t_ins_end + 1.4)
    M.add(t_ins_end + 0.9, '08:46', '李浩然开口，声音很轻。')
    sc.say('li', '他想找我说。', speed=0.74, gain=-3, post=1.1, variant=1)
    say_word(sc, 'chen', '嗯。', '嗯。我知道。', speed=0.9, gain=-2, post=1.3)
    sc.say('li', '他来找过我。', speed=0.74, gain=-3, post=1.2, variant=1)
    say_word(sc, 'chen', '嗯。', '嗯。我听见了。', speed=0.88, gain=-2, post=1.8)
    sc.say('li', '我在打游戏。', speed=0.84, gain=-3, post=2.0)
    M.add(sc.t, '08:47', '陈杰辉没有回答。他不需要回答。')
    sc.wait(5.2)

    def master(c, t, L):
        M.draw(c, L.T, L.w, L.h)
    sc.layer(master, t_master, t_master_end, fin=0.5, fout=0.6)
    sc.layer(master, t_ins_end - 0.2, None, fin=1.0, fout=1.4)
    sc.finish(tail=0.6)
    return sc

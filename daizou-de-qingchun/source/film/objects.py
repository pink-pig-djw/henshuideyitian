"""Shared visual objects.

A line (cold, precise, vector ink): floorplan, crack, phone_screen, evidence_tag, clock_card.
B line (Zhang's pencil sketchbook): tree(), desk_set(), cracked_phone(), shoes(), card().
All B drawings return film.sketch.Drawing objects (build once, cache, draw with progress).
"""
import math, functools
import numpy as np
import skia
from .config import *
from .gfx import *
from .sketch import Drawing, smudge

# =====================================================================
# A LINE
# =====================================================================
def ink(c, pts, rgb=A_INK, a=1.0, w=1.6, closed=False):
    path = skia.Path()
    path.moveTo(*pts[0])
    for q in pts[1:]:
        path.lineTo(*q)
    if closed:
        path.close()
    c.drawPath(path, paint(rgb, a, w))

def evidence_tag(c, x, y, no, title, sub='', a=1.0, rgb=A_INK):
    """Small forensic label: '证物 03 ｜ 碎纸片'."""
    text(c, f'证物 {no:02d}', x, y, 'sans-medium', 18, RED, a, tracking=0.3)
    text(c, title, x + 110, y, 'sans', 18, rgb, a, tracking=0.15)
    if sub:
        text(c, sub, x, y + 28, 'sans-light', 15, A_MID, a, tracking=0.15)
    line(c, x, y + (40 if sub else 14), x + 320, y + (40 if sub else 14), A_MID, a * 0.5, 1)

def clock_card(c, x, y, a=1.0, date='5月9日', time='08:30', rgb=A_INK, size=86):
    """The recurring date/time slate of the loop."""
    text(c, date, x, y, 'sans-xlight', size * 0.55, rgb, a, tracking=0.1)
    text(c, time, x, y + size * 1.05, 'sans-xlight', size, rgb, a, tracking=0.04)

@functools.lru_cache(maxsize=4)
def _crack_pts(seed=5, w=1920):
    rng = np.random.default_rng(seed)
    xs = np.linspace(-20, w + 20, 90)
    ys = np.cumsum(rng.normal(0, 3.2, len(xs)))
    ys = ys - np.linspace(ys[0], ys[-1], len(xs)) * 0.7
    branches = []
    for k in range(6):
        i = rng.integers(5, len(xs) - 10)
        L = rng.integers(4, 9)
        bx = xs[i] + np.cumsum(rng.uniform(8, 20, L))
        by = ys[i] + np.cumsum(rng.normal(0, 5, L)) + np.sign(rng.normal()) * np.linspace(0, 30, L)
        branches.append(np.stack([np.concatenate([[xs[i]], bx]), np.concatenate([[ys[i]], by])], 1))
    return np.stack([xs, ys], 1), branches

def bed_board(c, w, h, a=1.0, y=None, seed=5, crack_progress=1.0):
    """Macro of the upper-bunk board: wood grain lines and THE crack (third from the left)."""
    y = h * 0.42 if y is None else y
    rng = np.random.default_rng(seed)
    c.drawRect(skia.Rect(0, 0, w, h), paint((214, 208, 198), a))
    # grain
    for k in range(38):
        yy = rng.uniform(0, h)
        pts = [(x, yy + 6 * math.sin(x / rng.uniform(90, 260) + k) + rng.normal(0, 0.6)) for x in range(-10, w + 20, 24)]
        ink(c, pts, (150, 140, 126), a * rng.uniform(0.15, 0.35), rng.uniform(0.7, 1.6))
    main, br = _crack_pts(seed, w)
    n = max(2, int(len(main) * crack_progress))
    pts = main[:n].copy(); pts[:, 1] += y
    ink(c, pts, (45, 40, 36), a * 0.9, 2.4)
    ink(c, pts + np.array([0, 2.2]), (255, 255, 255), a * 0.25, 1.2)
    for b in br:
        if b[0, 0] < pts[-1, 0]:
            q = b.copy(); q[:, 1] += y
            ink(c, q, (45, 40, 36), a * 0.7, 1.3)
    vignette(c, w, h, 0.55)

def floorplan(c, x, y, s=1.0, a=1.0, empty_alpha=1.0, labels=True, rgb=A_INK, show_zhang=True, highlight=None, ht=0.0):
    """Top-down plan of the dorm (7.2m x 4.0m). Origin top-left at (x,y); 100px per metre * s.
    Bunk bed (李浩然 lower / 陈杰辉 upper) on the left wall, 张朝阳's bed + desk on the right wall,
    door at the bottom, window at the top.
    highlight: None | 'zhang_desk' | 'trash' | 'door' | 'window' with ht in 0..1 for pulse."""
    m = 100 * s
    def R(x0, y0, w0, h0, ww=1.4, aa=1.0, fill=None):
        r = skia.Rect.MakeXYWH(x + x0 * m, y + y0 * m, w0 * m, h0 * m)
        if fill:
            c.drawRect(r, paint(fill[0], a * fill[1]))
        c.drawRect(r, paint(rgb, a * aa, ww))
    W_, H_ = 4.0, 7.2
    # walls
    c.drawRect(skia.Rect.MakeXYWH(x, y, W_ * m, H_ * m), paint(rgb, a, 5 * s))
    # window (top)
    c.drawRect(skia.Rect.MakeXYWH(x + 0.8 * m, y - 3 * s, 2.4 * m, 6 * s), paint(A_BG, a))
    line(c, x + 0.8 * m, y, x + 3.2 * m, y, rgb, a, 1.2)
    line(c, x + 0.8 * m, y - 3 * s, x + 3.2 * m, y - 3 * s, rgb, a, 1.0)
    line(c, x + 0.8 * m, y + 3 * s, x + 3.2 * m, y + 3 * s, rgb, a, 1.0)
    # door (bottom right) with swing arc
    dx, dw = 2.9, 0.9
    c.drawRect(skia.Rect.MakeXYWH(x + dx * m, y + H_ * m - 4 * s, dw * m, 8 * s), paint(A_BG, a))
    arc = skia.Path(); arc.addArc(skia.Rect.MakeXYWH(x + (dx + dw - dw * 2) * m + dw * m, y + (H_ - dw) * m, dw * 2 * m, dw * 2 * m), 180, 90)
    c.drawPath(arc, paint(rgb, a * 0.6, 1.0))
    line(c, x + dx * m, y + H_ * m, x + dx * m, y + (H_ - dw) * m, rgb, a * 0.8, 1.4)
    # bunk bed (left wall)
    R(0.05, 0.9, 0.95, 2.1, 1.6)
    R(0.12, 0.98, 0.8, 0.45, 1.0, 0.7)                  # pillow
    line(c, x + 0.05 * m, y + 0.9 * m, x + 1.0 * m, y + 3.0 * m, rgb, a * 0.35, 1.0)
    line(c, x + 1.0 * m, y + 0.9 * m, x + 0.05 * m, y + 3.0 * m, rgb, a * 0.35, 1.0)
    # Li desk + Chen desk (left wall, below bunk)
    R(0.05, 3.3, 0.7, 1.2, 1.4); R(0.05, 4.6, 0.7, 1.2, 1.4)
    c.drawCircle(x + 1.05 * m, y + 3.9 * m, 0.22 * m, paint(rgb, a * 0.7, 1.2))   # chairs
    c.drawCircle(x + 1.05 * m, y + 5.2 * m, 0.22 * m, paint(rgb, a * 0.7, 1.2))
    # Zhang's bed (right wall, top)
    R(3.0, 0.9, 0.95, 2.1, 1.6)
    R(3.08, 0.98, 0.8, 0.45, 1.0, 0.7)
    # Zhang's desk (right wall, middle)
    hz_ = highlight == 'zhang_desk'
    R(3.25, 3.4, 0.7, 1.3, 1.4, 1.0, ((RED, 0.10 * ht)) if hz_ else None)
    c.drawCircle(x + 2.95 * m, y + 4.05 * m, 0.22 * m, paint(rgb, a * 0.7 * empty_alpha, 1.2))
    # lamp on Zhang's desk
    c.drawCircle(x + 3.6 * m, y + 3.62 * m, 0.08 * m, paint(rgb, a * 0.8, 1.0))
    # trash bin near Zhang's desk
    ht_ = highlight == 'trash'
    c.drawCircle(x + 3.72 * m, y + 5.05 * m, 0.14 * m, paint(RED if ht_ else rgb, a * (0.6 + 0.4 * ht if ht_ else 0.8), 1.3))
    # wardrobes
    R(3.25, 5.5, 0.7, 1.55, 1.2, 0.6)
    if labels:
        ls = 15 * max(0.8, s)
        text(c, '李浩然（下铺）', x + 1.12 * m, y + 1.75 * m, 'sans-light', ls, A_MID, a * 0.9)
        text(c, '陈杰辉（上铺）', x + 1.12 * m, y + 1.75 * m + ls * 1.5, 'sans-light', ls, A_MID, a * 0.9)
        text(c, '张朝阳', x + 2.88 * m, y + 1.95 * m, 'sans-light', ls, A_MID, a * 0.9 * empty_alpha, 'right')
        text(c, '窗', x + 2.0 * m, y - 12 * s, 'sans-light', ls, A_MID, a, 'center')
        text(c, '门', x + (dx + dw / 2) * m, y + H_ * m + 26 * s, 'sans-light', ls, A_MID, a, 'center')
    # scale bar
    line(c, x, y + H_ * m + 55 * s, x + m, y + H_ * m + 55 * s, A_MID, a * 0.7, 1.2)
    text(c, '1 m', x + m + 10, y + H_ * m + 60 * s, 'sans-light', 13, A_MID, a * 0.7)

def phone_screen(c, x, y, w, h, a=1.0, rgb=A_INK, lines=(), lit=0.0, big=None, sub=None):
    """Clean line-art phone; `lines`: small status lines; `big`: large centre text."""
    r = w * 0.12
    if lit > 0:
        glow(c, x + w / 2, y + h / 2, max(w, h) * 0.9, (190, 210, 235), 0.25 * lit * a)
        c.drawRoundRect(skia.Rect.MakeXYWH(x, y, w, h), r, r, paint((236, 242, 248), a * lit))
    c.drawRoundRect(skia.Rect.MakeXYWH(x, y, w, h), r, r, paint(rgb, a, 2.2))
    c.drawRoundRect(skia.Rect.MakeXYWH(x + w * 0.38, y + h * 0.025, w * 0.24, h * 0.022), 6, 6, paint(rgb, a * 0.8))
    if big:
        text(c, big, x + w / 2, y + h * 0.42, 'sans-xlight', w * 0.24, rgb, a, 'center')
    if sub:
        text(c, sub, x + w / 2, y + h * 0.42 + w * 0.13, 'sans-light', w * 0.075, rgb, a, 'center', tracking=0.1)
    for i, s in enumerate(lines):
        text(c, s, x + w / 2, y + h * 0.62 + i * w * 0.11, 'sans-light', w * 0.065, rgb, a * 0.8, 'center')

def a_background(c, w=W, h=H, a=1.0, grid=True):
    c.drawRect(skia.Rect(0, 0, w, h), paint(A_BG, a))
    if grid:
        p = paint(A_FAINT, a * 0.55, 1.0)
        for gx in range(0, w, 60):
            c.drawLine(gx, 0, gx, h, p)
        for gy in range(0, h, 60):
            c.drawLine(0, gy, w, gy, p)
    vignette(c, w, h, 0.18)

def loop_counter(c, x, y, n, a=1.0):
    text(c, '循环', x, y, 'sans-light', 18, A_MID, a, tracking=0.4)
    text(c, f'{n:02d}', x, y + 64, 'sans-xlight', 60, A_INK, a, tracking=0.05)

# =====================================================================
# B LINE — Zhang's sketchbook
# =====================================================================
def b_paper(day):
    """Paper colour for a countdown day (62 warm ... 0 grey)."""
    k = 1 - (day / 62.0)
    return mix(B_PAPER_WARM, B_PAPER_GREY, k ** 0.8)

def b_background(c, day, w=BW, h=H, a=1.0, seed=1):
    img = paper(w, h, tuple(int(v) for v in b_paper(day)), seed)
    p = skia.Paint(); p.setAlphaf(a)
    c.drawImage(img, 0, 0, skia.SamplingOptions(), p)

def countdown_card(c, day, t, w=BW, h=H, a=1.0, x=None, y=None, rgb=GRAPHITE):
    """'距自杀还有 N 天' — restrained, top-left of the sketchbook page."""
    x = 110 if x is None else x
    y = 150 if y is None else y
    k1 = smooth(t / 0.8); k2 = smooth((t - 0.5) / 1.0)
    text(c, '距自杀还有', x, y, 'serif-light', 30, rgb, a * k1, tracking=0.3)
    text(c, f'{day}', x - 6, y + 150, 'serif-xlight', 150, rgb, a * k2)
    nw = text_width(f'{day}', 'serif-xlight', 150)
    text(c, '天', x + nw + 10, y + 150, 'serif-light', 30, rgb, a * k2, tracking=0.3)

@functools.lru_cache(maxsize=16)
def tree(seed=4, x=0.0, y=0.0, s=1.0, leaves=True, depth=6):
    """A London plane (梧桐): forked trunk, mottled bark, broad lobed leaves.
    Drawn in growth order so progress<1 reads as 'being drawn'."""
    d = Drawing(seed=seed, width=1.7 * s, alpha=0.85, wobble=1.3 * s)
    rng = np.random.default_rng(seed)
    tips = []
    def branch(x0, y0, ang, L, wdt, lvl):
        x1 = x0 + math.cos(ang) * L; y1 = y0 - math.sin(ang) * L
        mid = ((x0 + x1) / 2 + rng.normal(0, L * 0.06), (y0 + y1) / 2 + rng.normal(0, L * 0.06))
        # two edges for thick limbs, single stroke for twigs
        if wdt > 5 * s:
            nx, ny = math.sin(ang) * wdt / 2, math.cos(ang) * wdt / 2
            d.curve([(x0 - nx, y0 - ny), (mid[0] - nx * 0.8, mid[1] - ny * 0.8), (x1 - nx * 0.7, y1 - ny * 0.7)], w=1.6 * s)
            d.curve([(x0 + nx, y0 + ny), (mid[0] + nx * 0.8, mid[1] + ny * 0.8), (x1 + nx * 0.7, y1 + ny * 0.7)], w=1.6 * s)
            # plane-tree bark patches
            for k in range(int(L / (28 * s))):
                u = rng.uniform(0.15, 0.85)
                px = x0 + (x1 - x0) * u + rng.normal(0, wdt * 0.15); py = y0 + (y1 - y0) * u
                d.ellipse(px, py, rng.uniform(3, 7) * s, rng.uniform(2, 5) * s, w=0.9 * s, a=0.45, passes=1)
        else:
            d.curve([(x0, y0), mid, (x1, y1)], w=max(0.8, 1.4 * s * wdt / 5))
        if lvl <= 0:
            tips.append((x1, y1)); return
        n = 2 if rng.random() < 0.8 else 3
        for i in range(n):
            na = ang + rng.uniform(-0.62, 0.62) + (i - (n - 1) / 2) * 0.35
            branch(x1, y1, na, L * rng.uniform(0.66, 0.8), wdt * 0.62, lvl - 1)
    bx, by = x, y
    branch(bx, by, math.pi / 2 + rng.normal(0, 0.05), 190 * s, 34 * s, depth)
    if leaves:
        for (tx, ty) in tips:
            for k in range(rng.integers(1, 3)):
                lx, ly = tx + rng.normal(0, 14 * s), ty + rng.normal(0, 12 * s)
                r = rng.uniform(7, 12) * s
                # 5-lobed leaf outline
                pts = []
                rot = rng.uniform(0, 2 * math.pi)
                for j in range(26):
                    th = rot + 2 * math.pi * j / 25
                    rr = r * (0.62 + 0.38 * abs(math.cos(2.5 * (th - rot))))
                    pts.append((lx + rr * math.cos(th), ly + rr * math.sin(th)))
                d.poly(pts, w=0.9 * s, a=0.6, passes=1, wobble=0.5)
    return d

@functools.lru_cache(maxsize=8)
def window_frame(x=0, y=0, w=520, h=640, seed=21):
    d = Drawing(seed=seed, width=2.0)
    d.rect(x, y, w, h)
    d.rect(x + 14, y + 14, w - 28, h - 28, w=1.2)
    d.line(x + w / 2, y + 14, x + w / 2, y + h - 14, w=1.4)
    d.line(x + 14, y + h * 0.38, x + w - 14, y + h * 0.38, w=1.4)
    return d

@functools.lru_cache(maxsize=8)
def desk_set(seed=31, x=0, y=0, s=1.0):
    """Zhang's desk: tabletop edge, two textbooks, faded pencil case, lamp, open sketchbook."""
    d = Drawing(seed=seed, width=1.8 * s)
    # tabletop (perspective)
    d.poly([(x - 40 * s, y + 210 * s), (x + 900 * s, y + 210 * s)])
    d.poly([(x - 60 * s, y + 250 * s), (x + 930 * s, y + 250 * s)], w=1.4 * s)
    d.hatch([(x - 60 * s, y + 212 * s), (x + 930 * s, y + 212 * s), (x + 930 * s, y + 250 * s), (x - 60 * s, y + 250 * s)], angle=8, spacing=7 * s)
    # books
    d.rect(x + 20 * s, y + 150 * s, 230 * s, 30 * s); d.rect(x + 34 * s, y + 180 * s, 220 * s, 30 * s)
    d.line(x + 40 * s, y + 165 * s, x + 200 * s, y + 165 * s, w=0.8 * s, a=0.5)
    # pencil case
    d.curve([(x + 290 * s, y + 205 * s), (x + 300 * s, y + 178 * s), (x + 420 * s, y + 176 * s), (x + 432 * s, y + 204 * s)])
    d.line(x + 300 * s, y + 190 * s, x + 424 * s, y + 188 * s, w=0.9 * s, a=0.5)
    # lamp
    d.ellipse(x + 780 * s, y + 206 * s, 60 * s, 10 * s)
    d.curve([(x + 780 * s, y + 204 * s), (x + 770 * s, y + 90 * s), (x + 700 * s, y + 10 * s), (x + 640 * s, y - 10 * s)])
    d.poly([(x + 600 * s, y - 40 * s), (x + 690 * s, y - 20 * s), (x + 660 * s, y + 25 * s), (x + 580 * s, y + 5 * s)], closed=True)
    d.hatch([(x + 600 * s, y - 40 * s), (x + 690 * s, y - 20 * s), (x + 660 * s, y + 25 * s), (x + 580 * s, y + 5 * s)], angle=70, spacing=5 * s)
    # open sketchbook on the desk
    d.poly([(x + 470 * s, y + 206 * s), (x + 520 * s, y + 150 * s), (x + 700 * s, y + 150 * s), (x + 690 * s, y + 206 * s)], closed=True)
    d.line(x + 605 * s, y + 150 * s, x + 600 * s, y + 206 * s, w=1.0 * s)
    return d

@functools.lru_cache(maxsize=8)
def cracked_phone(seed=41, x=0, y=0, w=260, h=520):
    """Top-down phone with a spider-web crack."""
    d = Drawing(seed=seed, width=2.0)
    r = 34
    pts = []
    for (cx, cy, a0) in [(x + w - r, y + r, -90), (x + w - r, y + h - r, 0), (x + r, y + h - r, 90), (x + r, y + r, 180)]:
        for k in range(8):
            th = math.radians(a0 + k * 90 / 7)
            pts.append((cx + r * math.cos(th), cy + r * math.sin(th)))
    d.poly(pts, closed=True)
    d.rect(x + 14, y + 40, w - 28, h - 80, w=1.0, a=0.6)
    rng = np.random.default_rng(seed)
    ox, oy = x + w * 0.66, y + h * 0.3
    for k in range(11):
        ang = rng.uniform(0, 2 * math.pi)
        L = rng.uniform(80, 260)
        seg = [(ox, oy)]
        cx, cy = ox, oy
        for j in range(5):
            cx += math.cos(ang) * L / 5 + rng.normal(0, 6); cy += math.sin(ang) * L / 5 + rng.normal(0, 6)
            cx = min(max(cx, x + 14), x + w - 14); cy = min(max(cy, y + 40), y + h - 40)
            seg.append((cx, cy))
        d.poly(seg, w=0.9, a=0.75, passes=1, wobble=0.6)
    for rr in (22, 48, 80):
        a0 = rng.uniform(0, 6)
        d.ellipse(ox, oy, rr, rr * 0.9, a0, a0 + rng.uniform(2.5, 4.5), w=0.8, a=0.55, passes=1)
    return d

@functools.lru_cache(maxsize=8)
def shoes(seed=51, x=0, y=0, s=1.0):
    """Pair of washed-out canvas sneakers, laces tied tight (side view)."""
    d = Drawing(seed=seed, width=1.8 * s)
    for k, ox in enumerate((0, 330 * s)):
        X = x + ox
        sole = [(X, y + 150 * s), (X + 300 * s, y + 150 * s), (X + 305 * s, y + 132 * s), (X - 5 * s, y + 132 * s)]
        d.poly(sole, closed=True)
        d.curve([(X, y + 132 * s), (X + 10 * s, y + 70 * s), (X + 60 * s, y + 40 * s), (X + 120 * s, y + 55 * s),
                 (X + 200 * s, y + 90 * s), (X + 280 * s, y + 105 * s), (X + 302 * s, y + 132 * s)])
        d.curve([(X + 70 * s, y + 42 * s), (X + 90 * s, y + 10 * s), (X + 140 * s, y + 8 * s), (X + 150 * s, y + 60 * s)])
        for j in range(5):   # tight laces
            lx = X + 95 * s + j * 18 * s
            d.line(lx, y + (40 + j * 7) * s, lx + 16 * s, y + (46 + j * 7) * s, w=1.2 * s)
        d.curve([(X + 150 * s, y + 38 * s), (X + 175 * s, y + 20 * s), (X + 190 * s, y + 34 * s), (X + 160 * s, y + 45 * s)], w=1.1 * s)
        d.hatch(sole, angle=0, spacing=6 * s)
    return d

def card(c, x, y, w=420, h=240, a=1.0, rot=0.0, worn=1.0):
    """The printed business card: 急速借 · 肖强. Crisp print, not pencil — an intruder on the page."""
    c.save()
    c.translate(x + w / 2, y + h / 2); c.rotate(rot); c.translate(-w / 2, -h / 2)
    sh = paint((0, 0, 0), 0.18 * a); sh.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 10))
    c.drawRect(skia.Rect.MakeXYWH(6, 10, w, h), sh)
    c.drawRect(skia.Rect.MakeXYWH(0, 0, w, h), paint((250, 250, 247), a))
    c.drawRect(skia.Rect.MakeXYWH(0, 0, w, h), paint((200, 196, 188), a, 1.0))
    text(c, '急速借', 34, h * 0.42, 'sans-bold', h * 0.2, (30, 30, 30), a, tracking=0.2)
    text(c, '·  肖强', 34 + text_width('急速借', 'sans-bold', h * 0.2, 0.2) + 10, h * 0.42, 'sans-light', h * 0.12, (30, 30, 30), a, tracking=0.2)
    text(c, '学生周转  当天放款  无需担保', 34, h * 0.64, 'sans-light', h * 0.075, (90, 90, 90), a, tracking=0.15)
    text(c, '微信 / 电话  1 3 8 · · · · · · · ·', 34, h * 0.82, 'sans-light', h * 0.065, (120, 120, 120), a, tracking=0.1)
    # worn corners
    if worn > 0:
        for (cx, cy) in [(0, 0), (w, 0), (0, h), (w, h)]:
            p = paint((215, 210, 200), a * 0.8 * worn)
            p.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 4))
            c.drawCircle(cx, cy, 12, p)
    c.restore()

# ---------------- A-line: event log & people markers ----------------
def event_log(c, x, y, entries, t, maxw=720, a=1.0, size=25, cps=22.0, rgb=A_INK):
    """Forensic log in the right column. entries: list of (t_appear, stamp, text).
    Each entry types on at `cps` characters/second; older entries dim."""
    shown = [e for e in entries if e[0] <= t]
    yy = y
    n = len(shown)
    for i, (ta, stamp, s) in enumerate(shown):
        age = n - 1 - i
        k = 1.0 if age == 0 else max(0.35, 0.75 - 0.12 * age)
        chars = int((t - ta) * cps)
        text(c, stamp, x, yy, 'sans-medium', size * 0.72, A_MID, a * k * smooth((t - ta) / 0.3), tracking=0.15)
        lines = wrap(s, 'sans-light', size, maxw - 110)
        used = 0
        for j, ln in enumerate(lines):
            vis = ln[:max(0, chars - used)]; used += len(ln)
            text(c, vis, x + 110, yy + j * size * 1.5, 'sans-light', size, rgb, a * k)
        yy += len(lines) * size * 1.5 + size * 0.7
    return yy

def person_dot(c, x, y, label, a=1.0, rgb=A_INK, r=9, ring=0.0):
    c.drawCircle(x, y, r, paint(rgb, a))
    if ring > 0:
        c.drawCircle(x, y, r + 10 + 18 * ring, paint(rgb, a * (1 - ring) * 0.6, 1.2))
    text(c, label, x + r + 8, y + 7, 'sans-medium', 18, rgb, a, tracking=0.1)

# plan coordinates (metres) of useful spots, for person_dot placement
PLAN_SPOTS = {
    'li_bed': (0.55, 2.2), 'chen_bed': (0.55, 1.5), 'window': (2.0, 0.35), 'zhang_desk': (2.95, 4.05),
    'trash': (3.72, 5.05), 'door': (3.35, 6.8), 'li_desk': (1.05, 3.9), 'chen_desk': (1.05, 5.2),
    'center': (2.0, 3.8),
}

def plan_xy(px, py, s, spot):
    mx, my = PLAN_SPOTS[spot] if isinstance(spot, str) else spot
    return px + mx * 100 * s, py + my * 100 * s

# ---------------- Zhang's sketchbook page (the plane tree he never finishes) ----------------
SKETCH_PAGE = (250, 110, 940, 820)     # x, y, w, h of the page in 4:3 local coords

@functools.lru_cache(maxsize=2)
def zhang_tree():
    x, y, w, h = SKETCH_PAGE
    d = window_frame(x + 90, y + 70, w - 180, h - 170, seed=22)
    t = tree(seed=4, x=x + w * 0.52, y=y + h - 110, s=1.05)
    out = Drawing(seed=0)
    out.strokes = list(d.strokes) + list(t.strokes)
    return out

TREE_FINAL = 0.62          # the tree is never finished: this is where it stops (scene 14 shows it)

def sketchbook_page(c, progress, a=1.0, day=62, pencil=False, rot=-0.012):
    """Draw the sketchbook page lying on the desk, with the tree drawn up to `progress`."""
    from .sketch import pen_point
    x, y, w, h = SKETCH_PAGE
    c.save()
    c.rotate(math.degrees(rot), x + w / 2, y + h / 2)
    sh = paint((0, 0, 0), 0.22 * a); sh.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 16))
    c.drawRect(skia.Rect.MakeXYWH(x + 10, y + 16, w, h), sh)
    pg = paper(w, h, tuple(int(min(255, v + 10)) for v in b_paper(day)), 9, 0.4, 0.6)
    pp = skia.Paint(); pp.setAlphaf(a)
    c.drawImage(pg, x, y, skia.SamplingOptions(), pp)
    # spiral binding
    for k in range(18):
        c.drawCircle(x + 30 + k * (w - 60) / 17, y + 14, 6, paint(GRAPHITE, 0.55 * a, 1.4))
    d = zhang_tree()
    d.draw(c, progress, a)
    if pencil and progress > 0:
        px, py = pen_point(d, progress)
        draw_pencil(c, px, py, a)
    c.restore()

def draw_pencil(c, x, y, a=1.0, ang=-38):
    """A clean, simple pencil resting with its tip at (x, y)."""
    c.save(); c.translate(x, y); c.rotate(ang)
    L, R = 420, 13
    sh = paint((0, 0, 0), 0.2 * a); sh.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 7))
    c.drawRect(skia.Rect.MakeXYWH(30, R * 0.2 + 10, L, R * 2), sh)
    path = skia.Path(); path.moveTo(0, 0); path.lineTo(46, -R); path.lineTo(46, R); path.close()
    c.drawPath(path, paint((222, 196, 160), a))
    tip = skia.Path(); tip.moveTo(0, 0); tip.lineTo(14, -R * 0.3); tip.lineTo(14, R * 0.3); tip.close()
    c.drawPath(tip, paint((40, 40, 40), a))
    c.drawRect(skia.Rect.MakeXYWH(46, -R, L, 2 * R), paint((70, 72, 60), a))
    c.drawRect(skia.Rect.MakeXYWH(46, -R, L, R * 0.7), paint((90, 92, 78), a))
    c.drawRect(skia.Rect.MakeXYWH(46 + L, -R, 30, 2 * R), paint((170, 170, 165), a))
    c.restore()

# =====================================================================
# THE CONTRACT (shared by s03 s04 s05 s06 s07 s14)
# =====================================================================
CONTRACT_W, CONTRACT_H = 620, 877
CONTRACT_LINES = [      # (kind, text)
    ('title', '借款协议'),
    ('gap', ''),
    ('field', '出借人：肖强'),
    ('field', '借款人：张朝阳'),
    ('gap', ''),
    ('clause', '一、借款金额：{amount}'),
    ('clause', '二、借款期限：六个月，自签订之日起计算。'),
    ('clause', '三、借款用途：个人生活周转。'),
    ('clause', '四、利率：百分之十五'),                      # the tiny 月 sits at the far right edge of this line
    ('clause', '五、到期一次性归还本金及利息。'),
    ('clause', '六、利息按月结算，逾期未付视为违约，违约金按日计算。'),
    ('clause', '七、借款人逾期的，出借人有权自行或委托第三方催收，所产生费用由借款人承担。'),
    ('clause', '八、本协议自双方签字之日起生效。'),
]

def contract_layout(s=1.0, amount='陆仟元整'):
    """Key positions (page-local, scaled): baseline y of each line, the 月 position, signature y."""
    y = 110 * s
    ys = []
    mx = 58 * s
    for kind, tx in CONTRACT_LINES:
        ys.append(y)
        if kind == 'title':
            y += 70 * s
        elif kind == 'gap':
            y += 18 * s
        elif kind == 'field':
            y += 40 * s
        else:
            n = len(wrap(tx.replace('{amount}', amount), 'serif', 16 * s, CONTRACT_W * s - 2 * mx))
            y += (46 + 22 * (n - 1)) * s
    rate_y = ys[8]
    yue = (CONTRACT_W * s - 9 * s, rate_y)       # right edge, hugging the trim line
    return dict(ys=ys, yue=yue, sign_y=y + 60 * s, date_y=y + 110 * s, amount_y=ys[5], rate_y=rate_y, term_y=ys[6], mx=mx)

def contract_page(c, x, y, s=1.0, a=1.0, amount='陆仟元整', date='3月18日', yue_red=0.0, highlight=(),
                  sign=1.0, sign_shaky=0.0, paper_rgb=(247, 246, 242), ink_rgb=(35, 35, 38), shadow=True, cold=True):
    """Printed two-page loan contract, page 1. `highlight`: iterable of 'amount','rate','term'
    (a translucent marker) — what Zhang believed he read. `yue_red` 0..1 turns the tiny 月 red.
    `sign` 0..1 draws the borrower signature (LXGW WenKai hand), `sign_shaky` adds tremor."""
    L = contract_layout(s, amount)
    c.save(); c.translate(x, y)
    if shadow:
        sh = paint((0, 0, 0), 0.20 * a); sh.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 14 * s))
        c.drawRect(skia.Rect.MakeXYWH(8 * s, 12 * s, CONTRACT_W * s, CONTRACT_H * s), sh)
    c.drawRect(skia.Rect.MakeXYWH(0, 0, CONTRACT_W * s, CONTRACT_H * s), paint(paper_rgb, a))
    mx = 58 * s
    for i, ((kind, tx), yy) in enumerate(zip(CONTRACT_LINES, L['ys'])):
        tx = tx.replace('{amount}', amount)
        if kind == 'title':
            text(c, tx, CONTRACT_W * s / 2, yy, 'serif-bold', 34 * s, ink_rgb, a, 'center', tracking=0.5)
        elif kind == 'field':
            text(c, tx, mx, yy, 'serif', 19 * s, ink_rgb, a)
        elif kind == 'clause':
            key = {5: 'amount', 6: 'term', 8: 'rate'}.get(i)
            if key in highlight:
                hp = paint((250, 214, 90), 0.45 * a)
                c.drawRect(skia.Rect.MakeXYWH(mx - 4 * s, yy - 18 * s, text_width(tx, 'serif', 16 * s) + 8 * s, 24 * s), hp)
            for j, ln in enumerate(wrap(tx, 'serif', 16 * s, CONTRACT_W * s - 2 * mx)):
                text(c, ln, mx + (0 if j == 0 else 28 * s), yy + j * 22 * s, 'serif', 16 * s, ink_rgb, a)
    # the tiny 月: one size smaller, pressed against the trim line
    yx, yyy = L['yue']
    yc = mix(ink_rgb, RED, yue_red)
    text(c, '月', yx, yyy, 'serif', 12 * s, yc, a, 'right')
    # signature block
    sy = L['sign_y']
    text(c, '出借人（签字）：', mx, sy, 'serif', 17 * s, ink_rgb, a)
    text(c, '肖强', mx + 150 * s, sy, 'hand', 24 * s, (40, 50, 90), a)
    text(c, '借款人（签字）：', mx + 300 * s, sy, 'serif', 17 * s, ink_rgb, a)
    if sign > 0:
        name = '张朝阳'
        n = len(name)
        sx = mx + 450 * s
        for i, ch in enumerate(name):
            k = clamp(sign * n - i)
            if k <= 0:
                break
            jx = math.sin(i * 7.3 + sign * 40) * 3 * s * sign_shaky
            jy = math.cos(i * 5.1 + sign * 33) * 4 * s * sign_shaky
            text(c, ch, sx + jx, sy + jy, 'hand', 24 * s, (40, 50, 90), a * k)
            sx += text_width(ch, 'hand', 24 * s) + (1 + 6 * sign_shaky) * s
    text(c, f'日期：{date}', mx, L['date_y'], 'serif', 16 * s, ink_rgb, a)
    text(c, '— 1 / 2 —', CONTRACT_W * s / 2, CONTRACT_H * s - 30 * s, 'serif', 12 * s, (120, 120, 120), a, 'center')
    c.restore()
    return L

"""Pencil-sketch drawing: jittered graphite strokes that can 'draw themselves'.

Usage:
    d = Drawing(seed=3)
    d.rect(100, 100, 300, 200)
    d.hatch([(100,100),(400,100),(400,300),(100,300)], angle=40, spacing=9)
    d.draw(canvas, progress=0.7)          # 70% of total stroke length drawn
Coordinates are in the caller's canvas space. Build a Drawing once (module level
or cached) and call draw() every frame.
"""
import math, functools
import numpy as np
import skia
from .config import GRAPHITE
from .gfx import col, paint

@functools.lru_cache(maxsize=4)
def _tooth(seed=11, n=384):
    """Paper-tooth mask: most pixels opaque, specks transparent -> graphite grain."""
    rng = np.random.default_rng(seed)
    a = rng.random((n, n)).astype(np.float32)
    # a little clumping
    a = (a + np.roll(a, 1, 0) + np.roll(a, 1, 1)) / 3
    alpha = np.clip((a - 0.28) * 2.4, 0.18, 1.0)
    arr = np.zeros((n, n, 4), np.uint8)
    arr[..., 3] = (alpha * 255).astype(np.uint8)
    img = skia.Image.fromarray(arr, colorType=skia.kRGBA_8888_ColorType)
    return img.makeShader(skia.TileMode.kRepeat, skia.TileMode.kRepeat, skia.SamplingOptions())

@functools.lru_cache(maxsize=4)
def _tooth_soft(seed=12, n=384):
    """Gentle graphite grain for filled areas (silhouettes, occluders): alpha 0.82..1."""
    rng = np.random.default_rng(seed)
    a = rng.random((n, n)).astype(np.float32)
    a = (a + np.roll(a, 1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 0)) / 4
    alpha = np.clip(0.82 + (a - 0.5) * 0.5, 0.78, 1.0)
    arr = np.zeros((n, n, 4), np.uint8)
    arr[..., 3] = (alpha * 255).astype(np.uint8)
    img = skia.Image.fromarray(arr, colorType=skia.kRGBA_8888_ColorType)
    return img.makeShader(skia.TileMode.kRepeat, skia.TileMode.kRepeat, skia.SamplingOptions())

def _resample(pts, step=5.0):
    pts = np.asarray(pts, np.float64)
    if len(pts) < 2:
        return pts
    seg = np.hypot(*(pts[1:] - pts[:-1]).T)
    L = np.concatenate([[0], np.cumsum(seg)])
    total = L[-1]
    if total < 1e-6:
        return pts[:1]
    n = max(2, int(total / step) + 1)
    s = np.linspace(0, total, n)
    x = np.interp(s, L, pts[:, 0]); y = np.interp(s, L, pts[:, 1])
    return np.stack([x, y], 1)

def _catmull(pts, per=10):
    pts = np.asarray(pts, np.float64)
    if len(pts) < 3:
        return pts
    P = np.vstack([pts[0], pts, pts[-1]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for t in np.linspace(0, 1, per, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return np.array(out)

class Drawing:
    def __init__(self, seed=0, rgb=GRAPHITE, width=1.8, alpha=0.82, wobble=1.6, passes=2, overshoot=3.0):
        self.rng = np.random.default_rng(seed)
        self.rgb, self.width, self.alpha = rgb, width, alpha
        self.wobble, self.passes, self.overshoot = wobble, passes, overshoot
        self.strokes = []          # list of (pts ndarray, width, alpha); width<0 => fill (alpha=(rgb,a))
        self.fill_rgb = (238, 227, 207)
        self._lens = None
        self._pic = None

    # ---------- stroke construction ----------
    def _add(self, pts, w=None, a=None, wobble=None, passes=None, overshoot=None, smooth=False):
        w = self.width if w is None else w
        a = self.alpha if a is None else a
        wob = self.wobble if wobble is None else wobble
        ps = self.passes if passes is None else passes
        ov = self.overshoot if overshoot is None else overshoot
        pts = np.asarray(pts, np.float64)
        if smooth:
            pts = _catmull(pts)
        base = _resample(pts, 5.0)
        if len(base) < 2:
            return self
        for k in range(ps):
            p = base.copy()
            d = np.gradient(p, axis=0)
            nrm = np.stack([-d[:, 1], d[:, 0]], 1)
            nrm /= (np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9)
            s = np.linspace(0, 1, len(p))
            ph = self.rng.uniform(0, 2 * np.pi, 3)
            fr = self.rng.uniform(0.6, 2.2, 3) * max(1.0, len(p) / 40)
            off = sum(np.sin(2 * np.pi * fr[i] * s + ph[i]) / (i + 1) for i in range(3)) * wob * (0.6 + 0.4 * k)
            off += self.rng.normal(0, 0.15 * wob, len(p))
            p = p + nrm * off[:, None] + (self.rng.normal(0, 0.8 * k, 2) if k else 0)
            # overshoot / undershoot at the ends
            if ov > 0 and len(p) >= 2:
                e0 = (p[0] - p[1]); e0 /= (np.linalg.norm(e0) + 1e-9)
                e1 = (p[-1] - p[-2]); e1 /= (np.linalg.norm(e1) + 1e-9)
                p = np.vstack([p[0] + e0 * self.rng.uniform(-0.3, 1) * ov, p, p[-1] + e1 * self.rng.uniform(-0.3, 1) * ov])
            ww = w * (1.0 if k == 0 else 0.6)
            aa = a * (1.0 if k == 0 else 0.55)
            self.strokes.append((p, ww, aa))
        self._lens = None; self._pic = None
        return self

    def line(self, x0, y0, x1, y1, **kw):
        return self._add([(x0, y0), (x1, y1)], **kw)

    def poly(self, pts, closed=False, **kw):
        pts = list(pts)
        if closed:
            pts = pts + [pts[0]]
        return self._add(pts, **kw)

    def curve(self, pts, **kw):
        """Smooth curve through points."""
        return self._add(pts, smooth=True, **kw)

    def rect(self, x, y, rw, rh, **kw):
        """Rectangle as four separate strokes (reads more hand-drawn). kw w= is stroke width."""
        self.line(x, y, x + rw, y, **kw); self.line(x + rw, y, x + rw, y + rh, **kw)
        self.line(x + rw, y + rh, x, y + rh, **kw); self.line(x, y + rh, x, y, **kw)
        return self

    def ellipse(self, cx, cy, rx, ry, a0=0.0, a1=2 * math.pi, rot=0.0, **kw):
        n = max(12, int((abs(a1 - a0)) * max(rx, ry) / 6))
        t = np.linspace(a0, a1, n)
        x = rx * np.cos(t); y = ry * np.sin(t)
        cr, sr = math.cos(rot), math.sin(rot)
        pts = np.stack([cx + x * cr - y * sr, cy + x * sr + y * cr], 1)
        return self._add(pts, **kw)

    def hatch(self, poly, angle=45, spacing=8.0, cross=False, w=None, a=None, jitter=0.35, **kw):
        """Parallel hatching clipped to a polygon."""
        poly = np.asarray(poly, np.float64)
        for ang in ([angle, angle + 90] if cross else [angle]):
            th = math.radians(ang)
            d = np.array([math.cos(th), math.sin(th)]); n = np.array([-d[1], d[0]])
            proj = poly @ n
            lo, hi = proj.min(), proj.max()
            k = lo + spacing * 0.5
            while k < hi:
                ks = k + self.rng.normal(0, spacing * jitter * 0.3)
                xs = []
                m = len(poly)
                for i in range(m):
                    p, q = poly[i], poly[(i + 1) % m]
                    a_, b_ = p @ n - ks, q @ n - ks
                    if (a_ > 0) != (b_ > 0):
                        tt = a_ / (a_ - b_)
                        xs.append(p + (q - p) * tt)
                xs.sort(key=lambda v: v @ d)
                for j in range(0, len(xs) - 1, 2):
                    p0, p1 = xs[j], xs[j + 1]
                    shrink = self.rng.uniform(0, 0.06)
                    q0 = p0 + (p1 - p0) * shrink; q1 = p1 - (p1 - p0) * self.rng.uniform(0, 0.06)
                    self._add([q0, q1], w=(w or self.width * 0.6), a=(a or self.alpha * 0.55), passes=1,
                              wobble=0.5, overshoot=1.0, **kw)
                k += spacing
        return self

    def scribble(self, cx, cy, r, n=6, **kw):
        """Small loose scribble (leaves, shadows)."""
        t = np.linspace(0, 2 * np.pi * n / 3, n * 8)
        rr = r * (0.55 + 0.45 * self.rng.random(len(t)))
        pts = np.stack([cx + rr * np.cos(t * 1.7), cy + rr * np.sin(t)], 1)
        return self._add(pts, passes=1, **kw)

    def fill(self, poly, rgb=None, a=1.0, smooth=False):
        """Opaque fill (e.g. paper colour) to occlude earlier strokes: silhouettes, overlaps.
        rgb=None uses the current B paper colour passed at draw time via tint_fill."""
        pts = np.asarray(poly, np.float64)
        if smooth:
            pts = _catmull(pts)
        self.strokes.append((pts, -1.0, (rgb, a)))
        self._lens = None; self._pic = None
        return self

    def extend(self, other):
        self.strokes.extend(other.strokes); self._lens = None; self._pic = None
        return self

    # ---------- rendering ----------
    def _lengths(self):
        if self._lens is None:
            L = [float(np.sum(np.hypot(*(p[1:] - p[:-1]).T))) if (len(p) > 1 and w > 0) else 0.0 for p, w, _ in self.strokes]
            self._lens = np.cumsum(L), L
        return self._lens

    def _paint_strokes(self, c, upto_len=None, tint=None, a_mul=1.0, grain=True):
        """Strokes are drawn in groups; each group gets the coarse paper-tooth grain.
        Fills break the groups and get a much softer grain, so large silhouettes read as
        graphite tone rather than salt-and-pepper noise, while keeping draw order (occlusion)."""
        rgb = tint or self.rgb
        cum, L = self._lengths()
        open_ = False
        def close():
            if grain:
                c.drawPaint(skia.Paint(Shader=_tooth(), BlendMode=skia.BlendMode.kDstIn))
            c.restore()
        for i, (p, w, a) in enumerate(self.strokes):
            pts = p
            if w < 0:
                if upto_len is not None and (cum[i] - L[i]) > upto_len:
                    break
                if open_:
                    close(); open_ = False
                frgb, fa = a
                path = skia.Path(); path.moveTo(*p[0])
                for q in p[1:]:
                    path.lineTo(*q)
                path.close()
                c.saveLayer(path.computeTightBounds().makeOutset(4, 4), None)
                c.drawPath(path, paint(frgb or self.fill_rgb, fa * a_mul))
                if grain:
                    c.drawPaint(skia.Paint(Shader=_tooth_soft(), BlendMode=skia.BlendMode.kDstIn))
                c.restore()
                continue
            if upto_len is not None:
                start = cum[i] - L[i]
                if start >= upto_len:
                    break
                if cum[i] > upto_len and L[i] > 0:
                    frac = (upto_len - start) / L[i]
                    pts = p[:max(2, int(len(p) * frac) + 1)]
            if not open_:
                c.saveLayer(None, None); open_ = True
            path = skia.Path()
            path.moveTo(*pts[0])
            for q in pts[1:]:
                path.lineTo(*q)
            c.drawPath(path, paint(rgb, a * a_mul, w))
        if open_:
            close()

    def draw(self, c, progress=1.0, alpha=1.0, tint=None, grain=True):
        """Draw the first `progress` fraction (by stroke length) of the drawing."""
        if alpha <= 0 or progress <= 0 or not self.strokes:
            return
        cum, _ = self._lengths()
        total = cum[-1]
        lp = skia.Paint(); lp.setAlphaf(max(0.0, min(1.0, alpha)))
        if progress >= 1.0 and tint is None and grain:
            if self._pic is None:
                rec = skia.PictureRecorder()
                t = rec.beginRecording(skia.Rect(-4000, -4000, 8000, 8000))
                self._paint_strokes(t, None)
                self._pic = rec.finishRecordingAsPicture()
            c.saveLayer(None, lp); c.drawPicture(self._pic); c.restore()
            return
        c.saveLayer(None, lp)
        self._paint_strokes(c, None if progress >= 1.0 else total * progress, tint, grain=grain)
        c.restore()

def smudge(c, poly, rgb=GRAPHITE, a=0.12, blur=6.0):
    """Soft graphite smudge / tone fill for shading an area."""
    path = skia.Path()
    path.moveTo(*poly[0])
    for q in poly[1:]:
        path.lineTo(*q)
    path.close()
    p = paint(rgb, a)
    p.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, blur))
    c.drawPath(path, p)

def pen_point(d, progress):
    """Where the pencil tip is when `progress` of drawing d has been drawn."""
    cum, L = d._lengths()
    if not len(cum):
        return (0, 0)
    target = cum[-1] * max(0.0, min(1.0, progress))
    for i, (p, w, a) in enumerate(d.strokes):
        if w < 0:
            continue
        start = cum[i] - L[i]
        if cum[i] >= target:
            frac = 0 if L[i] == 0 else (target - start) / L[i]
            k = min(len(p) - 1, max(0, int(len(p) * frac)))
            return tuple(p[k])
    return tuple(d.strokes[-1][0][-1])

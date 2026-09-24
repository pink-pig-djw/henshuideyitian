"""Polished drop-in replacements for three shared drawings in film/objects.py.

    tree(seed, x, y, s, leaves, depth)      -> Drawing   (London plane / 梧桐)
    shoes(seed, x, y, s)                    -> Drawing   (washed-out canvas sneakers)
    bed_board(c, w, h, a, y, seed, crack_progress)       (upper-bunk board macro)

Signatures and cache decorators are identical to the originals, so a scene (or the
build) can simply do:  objects.tree = objects_polish.tree  etc.
objects.py itself is not modified.
"""
import math, functools
import numpy as np
import skia
from .config import *
from .gfx import *
from .sketch import Drawing, smudge
from .objects import _crack_pts, ink


# =====================================================================
# helpers
# =====================================================================
def _smooth(P, k=1):
    Q = np.array(P, np.float64)
    if len(Q) < 3:
        return Q
    for _ in range(k):
        Q[1:-1] = 0.25 * Q[:-2] + 0.5 * Q[1:-1] + 0.25 * Q[2:]
    return Q


def _frame(P):
    """Unit tangents and right-hand normals (screen coords, y down)."""
    t = np.gradient(P, axis=0)
    t /= (np.linalg.norm(t, axis=1, keepdims=True) + 1e-9)
    n = np.stack([-t[:, 1], t[:, 0]], 1)
    return t, n


def _dir(a):
    return np.array([math.cos(a), -math.sin(a)])


def _blob(rng, cx, cy, rx, ry, n=7, jag=0.25, rot=0.0):
    """Irregular, slightly angular closed shape (bark patch, shade patch)."""
    th = np.sort(rng.uniform(0, 2 * math.pi, n)) if n > 4 else np.linspace(0, 2 * math.pi, n, endpoint=False)
    th = np.linspace(0, 2 * math.pi, n, endpoint=False) + rng.uniform(-0.35, 0.35, n) * (2 * math.pi / n)
    rr = 1.0 - jag + jag * rng.random(n)
    x = rr * rx * np.cos(th); y = rr * ry * np.sin(th)
    cr, sr = math.cos(rot), math.sin(rot)
    return np.stack([cx + x * cr - y * sr, cy + x * sr + y * cr], 1)


# =====================================================================
# 1. THE PLANE TREE
# =====================================================================
# key points of the outline in polar coords around the palm centre (deg from the leaf axis,
# radius in R): 't' lobe tip, 's' sinus, 'b' base/shoulder
_LOBES5 = [(180, 0.40, 'b'), (150, 0.50, 'b'), (120, 0.76, 't'), (98, 0.52, 's'), (63, 1.06, 't'),
           (31, 0.54, 's'), (0, 1.02, 't'), (-31, 0.54, 's'), (-63, 1.06, 't'), (-98, 0.52, 's'),
           (-120, 0.76, 't'), (-150, 0.50, 'b'), (180, 0.40, 'b')]
_LOBES3 = [(180, 0.40, 'b'), (148, 0.52, 'b'), (110, 0.64, 'b'), (60, 1.06, 't'), (29, 0.54, 's'),
           (0, 1.04, 't'), (-29, 0.54, 's'), (-60, 1.06, 't'), (-110, 0.64, 'b'), (-148, 0.52, 'b'),
           (180, 0.40, 'b')]


def _leaf(rng, bx, by, ang, R, squash, teeth=True):
    """Palmate plane leaf: broad, 3-5 pointed lobes, shallow rounded sinuses, a truncate base.
    Returns (outline starting and ending at the base, midrib, side veins).
    (bx,by) = leaf base; ang = axis angle (maths convention, y up)."""
    lobes = _LOBES5 if rng.random() < 0.6 else _LOBES3
    ax = _dir(ang); pp = np.array([ax[1], -ax[0]]) * (1 if rng.random() < 0.5 else -1)
    C = 0.42 * R
    tw = rng.normal(0, 3)                      # the whole leaf a little asymmetric
    key = []
    for (deg, rr, kind) in lobes:
        th = math.radians(deg + (rng.normal(0, 3.5) + tw * (deg / 90) if abs(deg) != 180 else 0))
        r = rr * R * (1 + rng.normal(0, 0.05))
        key.append((np.array([C + r * math.cos(th), r * math.sin(th)]), kind))
    loc = [key[0][0]]
    for i in range(1, len(key)):
        (p0, k0), (p1, k1) = key[i - 1], key[i]
        seg = p1 - p0; L = np.linalg.norm(seg) + 1e-9
        mid = (p0 + p1) / 2
        out = mid - np.array([C, 0.0]); out /= (np.linalg.norm(out) + 1e-9)
        if teeth and {k0, k1} == {'t', 's'} and rng.random() < 0.7:
            # one coarse tooth on each lobe flank; the flank itself nearly straight
            tpos = 0.42 if k1 == 't' else 0.58
            q = p0 + seg * tpos
            loc.append(q + out * 0.02 * R)
            loc.append(p0 + seg * (tpos + 0.1 * (1 if k1 == 't' else -1)) + out * 0.08 * R)
            loc.append(p0 + seg * (tpos + 0.16 * (1 if k1 == 't' else -1)) + out * 0.03 * R)
        elif 's' in (k0, k1) or 't' in (k0, k1):
            loc.append(mid + out * 0.05 * R)
        else:
            loc.append(mid + out * 0.08 * R)     # rounded shoulders at the base
        if k1 == 's':                            # a rounded sinus rather than a sharp V
            loc.append(p1 - seg / L * 0.06 * R)
            loc.append(p1)
        else:
            loc.append(p1)
    # teeth were appended out of order on the flank running back from a tip: sort by position
    outpts = []
    for (u, v) in loc:
        v = v * squash
        outpts.append((bx + u * ax[0] + v * pp[0], by + u * ax[1] + v * pp[1]))
    tipu = C + 1.0 * R
    mid = [(bx, by), (bx + ax[0] * tipu * 0.9, by + ax[1] * tipu * 0.9)]
    veins = []
    for (deg, rr, kind) in lobes:
        if kind == 't' and 40 < abs(deg) < 120:
            th = math.radians(deg)
            u, v = C + rr * R * 0.8 * math.cos(th), rr * R * 0.8 * math.sin(th) * squash
            s0 = (bx + ax[0] * C * 0.85, by + ax[1] * C * 0.85)
            veins.append([s0, (bx + u * ax[0] + v * pp[0], by + u * ax[1] + v * pp[1])])
    return outpts, mid, veins


def _inside(pts, poly):
    """Vectorised even-odd point-in-polygon test: pts (N,2) against poly (M,2)."""
    x = pts[:, 0][:, None]; y = pts[:, 1][:, None]
    x0 = poly[:, 0][None, :]; y0 = poly[:, 1][None, :]
    x1 = np.roll(poly[:, 0], -1)[None, :]; y1 = np.roll(poly[:, 1], -1)[None, :]
    cond = (y0 > y) != (y1 > y)
    xin = x0 + (y - y0) * (x1 - x0) / (y1 - y0 + 1e-12)
    return (np.sum(cond & (x < xin), axis=1) % 2) == 1


def _visible_runs(P, occluders, step=2.0, minlen=3.0):
    """Hidden-line removal: the parts of polyline P outside every occluder polygon."""
    P = np.asarray(P, np.float64)
    if not occluders:
        return [P]
    seg = np.hypot(*(P[1:] - P[:-1]).T)
    S = np.concatenate([[0], np.cumsum(seg)])
    n = max(2, int(S[-1] / step) + 1)
    t = np.linspace(0, S[-1], n)
    Q = np.stack([np.interp(t, S, P[:, 0]), np.interp(t, S, P[:, 1])], 1)
    hid = np.zeros(n, bool)
    for poly in occluders:
        hid |= _inside(Q, poly)
    runs, cur = [], []
    for q, h in zip(Q, hid):
        if not h:
            cur.append(q)
        elif cur:
            runs.append(np.array(cur)); cur = []
    if cur:
        runs.append(np.array(cur))
    return [r for r in runs if len(r) >= 2 and np.hypot(*(r[-1] - r[0])) + 0.5 * len(r) * step > minlen]


def _zigzag(poly, angle, spacing, rng=None, jitter=0.25):
    """Hatching as one continuous back-and-forth pencil stroke (quick shading), clipped to a
    near-convex polygon. One stroke instead of dozens: cheaper, and it reads as scribbled tone."""
    poly = np.asarray(poly, np.float64)
    th = math.radians(angle)
    dv = np.array([math.cos(th), math.sin(th)]); nv = np.array([-dv[1], dv[0]])
    proj = poly @ nv
    lo, hi = proj.min(), proj.max()
    pts = []
    k = lo + spacing * 0.5
    flip = False
    m = len(poly)
    while k < hi:
        kk = k + (rng.normal(0, spacing * jitter * 0.3) if rng is not None else 0.0)
        xs = []
        for i in range(m):
            p_, q_ = poly[i], poly[(i + 1) % m]
            a_, b_ = p_ @ nv - kk, q_ @ nv - kk
            if (a_ > 0) != (b_ > 0):
                xs.append(p_ + (q_ - p_) * (a_ / (a_ - b_)))
        if len(xs) >= 2:
            xs.sort(key=lambda v: v @ dv)
            seg = [xs[0], xs[-1]]
            if flip:
                seg = seg[::-1]
            pts += seg
            flip = not flip
        k += spacing
    return np.array(pts) if len(pts) >= 2 else None


def _tube(P, r):
    """Cylindrical mapping on a tapered limb: (along_px, phi) -> screen point."""
    seg = np.hypot(*(P[1:] - P[:-1]).T)
    S = np.concatenate([[0], np.cumsum(seg)])
    _, nn = _frame(P)

    def f(t, phi):
        t = np.clip(t, 0, S[-1])
        x = np.interp(t, S, P[:, 0]); y = np.interp(t, S, P[:, 1])
        nx = np.interp(t, S, nn[:, 0]); ny = np.interp(t, S, nn[:, 1])
        sp = np.sin(np.clip(phi, -1.5, 1.5)) * np.interp(t, S, r) * 0.96
        return np.stack([x + nx * sp, y + ny * sp], -1)
    return f, S


@functools.lru_cache(maxsize=16)
def tree(seed=4, x=0.0, y=0.0, s=1.0, leaves=True, depth=6):
    """A London plane (梧桐) as a student would sketch it: a straight trunk with mottled,
    peeling bark; a few confident limbs; zig-zag twigs; broad lobed leaves clustered at the
    twig tips; a little hatching under the crown.
    Strokes are emitted in drawing order: trunk+limbs -> bark -> branches -> twigs (by
    generation) -> leaves (sweeping across the crown) -> shade, so progress<1 reads as
    'being drawn'."""
    rng = np.random.default_rng(seed + 7919)          # structure
    rb = np.random.default_rng(seed + 104729)         # bark
    rl = np.random.default_rng(seed + 1299709)        # leaves & shade
    lw = 1.7 * s ** 0.55                     # pencil width
    wob = 1.0 * s ** 0.75
    d = Drawing(seed=seed, width=lw, alpha=0.85, wobble=wob)
    H = 600.0 * s
    B = {k: [] for k in range(10)}           # stroke buckets, emitted in this order

    # crown envelope: a broad, slightly lumpy dome
    cxE = x + rng.normal(0, 0.025) * H
    cyE = y - 0.59 * H
    RxE, RyE = 0.47 * H * rng.uniform(0.93, 1.05), 0.34 * H * rng.uniform(0.94, 1.05)
    eph = rng.uniform(0, 6.3, 2)

    def env(px, py):
        """<=1 inside the crown dome (works on scalars or arrays)."""
        th = np.arctan2(py - cyE, px - cxE)
        k = 1 + 0.06 * np.sin(3 * th + eph[0]) + 0.04 * np.sin(5 * th + eph[1])
        ry = np.where(py < cyE, RyE, RyE * 0.8)      # a dome: round above, flatter underneath
        return ((px - cxE) / (RxE * k)) ** 2 + ((py - cyE) / (ry * k)) ** 2

    def grow(x0, y0, ang, L, n, bend=0.0, noise=0.02, up=0.0, zig=0.0, clamp=True):
        pts = [(x0, y0)]; a = ang; st = L / n
        for i in range(n):
            a += bend / n + rng.normal(0, noise) + up * (math.pi / 2 - a) / n
            if clamp:
                a = min(max(a, -0.35), math.pi + 0.35)
            aa = a + (zig * (1 if i % 2 else -1) if zig else 0)
            x0 += math.cos(aa) * st; y0 -= math.sin(aa) * st
            pts.append((x0, y0))
        return np.array(pts), a

    # ---------------- trunk: straight, a little root flare ----------------
    Ht = H * rng.uniform(0.30, 0.34)
    TP, aT = grow(x, y, math.pi / 2 + rng.normal(0, 0.025), Ht, 14, bend=rng.normal(0, 0.04), noise=0.006)
    TP = _smooth(TP, 3)
    uT = np.linspace(0, 1, len(TP))
    rT = s * 19.0 * (1 - 0.2 * uT) * (1 + 0.42 * np.exp(-uT / 0.05))
    _, nT = _frame(TP)

    # ---------------- a few confident main limbs ----------------
    n1 = int(rng.choice([2, 3, 3, 3, 4]))
    offs = {2: [-0.52, 0.5], 3: [-0.78, 0.0, 0.74], 4: [-0.9, -0.3, 0.28, 0.86]}[n1]
    limbs = []
    top = TP[-1]
    for i, off in enumerate(offs):
        off = off + rng.normal(0, 0.08)
        ang = aT - off                         # off<0 leans left (maths angle grows)
        L = H * 0.36 * (0.84 + 0.22 * abs(off)) * rng.uniform(0.9, 1.08)
        lat = max(-1.0, min(1.0, off / 0.6)) * rT[-1] * 0.45
        st = top + nT[-1] * lat
        P, aE = grow(st[0], st[1], ang, L, 12, bend=0.28 * off + rng.normal(0, 0.12), noise=0.025, up=0.1)
        P = _smooth(P, 2)
        r0 = rT[-1] * (1.0 / n1) ** 0.34 * rng.uniform(0.92, 1.04)
        r = r0 * (1 - 0.55 * np.linspace(0, 1, len(P)) ** 1.2)
        limbs.append(dict(P=P, r=r, lvl=1, L=L, a=aE))
    limbs.sort(key=lambda b: -math.atan2(-(b['P'][-1][1] - b['P'][0][1]), b['P'][-1][0] - b['P'][0][0]))
    # silhouette: each trunk edge flows into the outermost limb on its side
    for side, lb in ((-1, limbs[0]), (1, limbs[-1])):
        _, nL = _frame(lb['P'])
        e = np.vstack([TP + side * nT * rT[:, None], (lb['P'] + side * nL * lb['r'][:, None])[2:]])
        B[0].append(('poly', _smooth(e, 4), dict(w=lw * 1.1)))
    # crotches between neighbouring limbs
    for A, Bb in zip(limbs[:-1], limbs[1:]):
        _, nA = _frame(A['P']); _, nB = _frame(Bb['P'])
        eA = A['P'] + nA * A['r'][:, None]
        eB = Bb['P'] - nB * Bb['r'][:, None]
        m = min(len(eA), len(eB))
        i0 = m - 1
        for i in range(1, m):
            if np.linalg.norm(A['P'][i] - Bb['P'][i]) > (A['r'][i] + Bb['r'][i]) * 1.08:
                i0 = i; break
        cr = (eA[i0] + eB[i0]) / 2 + np.array([0, (A['r'][i0] + Bb['r'][i0]) * 0.25])
        e = np.vstack([eA[i0:][::-1], [cr], eB[i0:]])
        B[0].append(('poly', _smooth(e, 2), dict(w=lw)))

    # ---------------- bark: mottled, peeling patches wrapped round the trunk ----------------
    def bark(P, r, u0, u1, cell, frac, hatch_p=0.4):
        """Plane-tree camouflage: a jigsaw of flakes (Voronoi cells laid out on the limb's
        surface, shrunk apart), only some of them drawn, a few hatched darker. Cells near the
        silhouette are foreshortened by the cylinder."""
        from scipy.spatial import Voronoi
        f, S = _tube(P, r)
        Lt = S[-1]
        rm = float(np.mean(r))
        st = max(4.0, cell * rm)
        T0, T1 = u0 * Lt, u1 * Lt
        ts = np.arange(T0 - st, T1 + st, st * 0.95)
        ps = np.arange(-1.75 * rm, 1.75 * rm + 1e-6, st)
        g = np.array([(tt + (0.5 * st if k % 2 else 0), pp) for tt in ts for k, pp in enumerate(ps)])
        g = g + rb.uniform(-0.38, 0.38, g.shape) * st
        g = g[rb.random(len(g)) > 0.22]                  # merge some cells: flakes of mixed size
        vor = Voronoi(g)
        for pi_, ri in enumerate(vor.point_region):
            reg = vor.regions[ri]
            if not reg or -1 in reg:
                continue
            poly = vor.vertices[reg]
            ctr = poly.mean(0)
            if not (T0 < ctr[0] < T1) or abs(ctr[1]) > 1.32 * rm or rb.random() > frac:
                continue
            k = rb.uniform(0.72, 0.9)
            poly = ctr + (poly - ctr) * k
            # subdivide so long edges follow the round of the limb
            pts = []
            for a_, b_ in zip(poly, np.roll(poly, -1, 0)):
                for u in (0.0, 0.34, 0.67):
                    pts.append(a_ + (b_ - a_) * u)
            pts = np.array(pts)
            scr = f(pts[:, 0], pts[:, 1] / rm)
            n = len(scr)
            if rb.random() < 0.28:          # a peeling flake: part of the edge only
                k0 = int(rb.integers(0, n)); kk = int(rb.integers(n // 2, n - 1))
                B[1].append(('poly', np.vstack([scr[(k0 + q) % n] for q in range(kk + 1)]),
                             dict(w=lw * 0.6, a=0.55, passes=1, wobble=wob * 0.25, overshoot=0.5)))
            else:
                B[1].append(('poly_closed', scr, dict(w=lw * 0.6, a=0.52, passes=1, wobble=wob * 0.25, overshoot=0.5)))
            if rb.random() < hatch_p:
                B[1].append(('zig', scr, dict(angle=float(rb.uniform(62, 82)), spacing=max(1.8, 2.6 * s ** 0.85),
                                              w=lw * 0.42, a=0.42, wobble=wob * 0.15)))
    bark(TP, rT, 0.03, 0.97, 0.95, 0.86, hatch_p=0.42)
    for lb in limbs:
        bark(lb['P'], lb['r'], 0.08, 0.62, 1.45, 0.5, hatch_p=0.3)
    # form shading down the trunk's right side
    _, nn = _frame(TP)
    i0, i1 = 1, len(TP) - 1
    outer = TP[i0:i1] + nn[i0:i1] * rT[i0:i1, None] * 0.97
    inner = TP[i0:i1] + nn[i0:i1] * rT[i0:i1, None] * 0.55
    B[1].append(('hatch', np.vstack([outer, inner[::-1]]), dict(angle=66.0, spacing=max(2.4, 4.4 * s ** 0.8), w=lw * 0.5, a=0.3)))

    # ---------------- branches & twigs, generation by generation ----------------
    # Each branch owns a fan-shaped sector of the dome (seen from the fork); its children split
    # that sector and grow toward the dome, a little further out each generation. The crown
    # fills evenly and branches rarely cross, the way a careful sketch builds a crown.
    O = np.array([TP[-1][0], min(TP[-1][1], cyE + 0.3 * RyE)])    # fan origin, inside the dome
    _rs = np.linspace(0.0, 1.6 * H, 160)

    def rho(th):
        e = env(O[0] + math.cos(th) * _rs, O[1] - math.sin(th) * _rs)
        ins = np.nonzero(e <= 1.0)[0]
        return float(_rs[ins[-1]]) if len(ins) else 0.3 * H

    def reach(l):                                    # fraction of the way to the dome's edge
        return 0.34 + 0.66 * ((l - 1) / max(1.0, depth - 1.0)) ** 0.8

    THA, THB = -0.12, math.pi + 0.12                  # the dome as seen from the fork
    angs = [math.atan2(-(lb['P'][-1][1] - O[1]), lb['P'][-1][0] - O[0]) for lb in limbs]
    cuts = [THB] + [0.5 * (angs[q] + angs[q + 1]) for q in range(len(angs) - 1)] + [THA]
    for q, lb in enumerate(limbs):
        lb['sec'] = (cuts[q + 1], cuts[q])            # limbs are sorted left -> right
    queue = list(limbs)
    tips, nodes = [], []
    while queue:
        nxt = []
        for br in queue:
            P, r, lvl = br['P'], br['r'], br['lvl']
            if lvl >= depth:
                tips.append(br); continue
            cl = lvl + 1
            _, nn = _frame(P)
            m = len(P)
            if lvl >= 4:
                nodes.append(br)
            nk = {1: int(rng.choice([3, 3, 4])), 2: int(rng.choice([2, 3, 3])), 3: int(rng.choice([2, 2, 3]))}.get(
                lvl, 2 if rng.random() < {4: 0.85, 5: 0.6}.get(lvl, 0.4) else 1)
            a0, a1 = br['sec']
            cutp = np.sort(rng.uniform(0.2, 0.8, nk - 1)) if nk > 1 else np.array([])
            cutp = np.concatenate([[0.0], 0.55 * cutp + 0.45 * np.linspace(0, 1, nk + 1)[1:-1], [1.0]])
            side = (int(rng.integers(0, nk)) if (nk >= 3 or (lvl <= 2 and nk >= 2)) else -1)
            for q in range(nk):
                sa, sb = a0 + (a1 - a0) * cutp[q], a0 + (a1 - a0) * cutp[q + 1]
                th = 0.5 * (sa + sb) + rng.normal(0, 0.12) * (sb - sa)
                Bq = O + _dir(th) * rho(th)                      # where this sector meets the dome
                g = (reach(cl) - reach(lvl)) / max(0.05, 1.0 - reach(lvl))
                if q == side:                          # a side shoot from part-way along, reaching less far
                    u = rng.uniform(0.45, 0.75); i_ = min(m - 2, max(1, int(u * (m - 1))))
                    toB = Bq - P[i_]
                    sgn_ = 1 if (toB[0] * nn[i_][0] + toB[1] * nn[i_][1]) > 0 else -1
                    p0 = P[i_] + sgn_ * nn[i_] * r[i_] * 0.8
                    Tq = p0 + (Bq - p0) * min(1.0, g * rng.uniform(1.0, 1.3))
                    r0 = r[i_] * rng.uniform(0.55, 0.68)
                else:
                    p0 = P[-1]
                    Tq = p0 + (Bq - p0) * min(1.0, g * (rng.uniform(0.75, 1.05) if cl == depth else rng.uniform(0.9, 1.08)))
                    r0 = r[-1] * (0.82 if nk > 1 else 0.9)
                Tq = Tq + rng.normal(0, (0.012 if cl <= 3 else 0.022) * H, 2)
                v = Tq - p0
                L = float(np.hypot(*v))
                if L < 0.012 * H:
                    continue
                ang = math.atan2(-v[1], v[0])
                if cl <= 3:
                    Pc, aE = grow(p0[0], p0[1], ang - 0.08 * rng.normal(), L, 8, bend=rng.normal(0, 0.14), noise=0.025, clamp=False)
                    Pc = _smooth(Pc, 1)
                else:
                    Pc, aE = grow(p0[0], p0[1], ang, L, 3, noise=0.05, zig=0.14 * (1 if rng.random() < 0.5 else -1), clamp=False)
                rc = r0 * (1 - 0.55 * np.linspace(0, 1, len(Pc)))
                nb = dict(P=Pc, r=rc, lvl=cl, L=L, a=aE, sec=(sa, sb))
                nxt.append(nb)
                if r0 * 2 >= 6.0 and cl <= 3:
                    _, nc = _frame(Pc)
                    for sd in (-1, 1):
                        B[cl].append(('poly', _smooth(Pc + sd * nc * rc[:, None], 1), dict(w=lw * 0.85, passes=2 if cl == 2 else 1)))
                else:
                    ww = lw * min(1.0, 0.4 + r0 / (4.2 * s ** 0.45))
                    spec = ('poly', Pc, dict(w=ww, a=0.8, passes=1, wobble=wob * 0.5, overshoot=1.0 * s ** 0.5))
                    if cl == depth and leaves:
                        nb['stroke'] = spec           # the last little twig goes in with its leaves
                    else:
                        B[min(cl, 7)].append(spec)
        queue = nxt

    # ---------------- leaves ----------------
    # Broad lobed leaves clustered at the twig tips (a few also at inner forks), drawn cluster
    # by cluster sweeping across the crown, each tip's last little twig drawn with its leaves.
    if leaves:
        clusters = []
        placed = []
        lod = min(1.0, (s / 0.9) ** 0.75)       # distant (small) trees: fewer, simpler leaves
        if s > 1.3:
            lod = (1.3 / s) ** 0.6              # close-ups: fewer, bigger-looking leaves, less clutter
        for br, interior in [(b, False) for b in tips] + [(b, True) for b in nodes]:
            tip = br['P'][-1]
            twig = br.get('stroke') if not interior else None
            items = []
            if rl.random() < (0.45 if interior else 0.95) * lod:
                k = 1 if interior else int(rl.choice([1, 2, 2, 3]))
                spread = {1: [0.0], 2: [-0.55, 0.55], 3: [-0.85, 0.0, 0.85]}[k]
                for off in spread:
                    R = s * rl.uniform(16.0, 21.0)
                    a = br['a'] + off + rl.normal(0, 0.22)
                    dv = _dir(a) + np.array([0.0, rl.uniform(0.0, 0.5)])     # plane leaves hang a little
                    a = math.atan2(-dv[1], dv[0])
                    bpt = tip + _dir(a) * R * rl.uniform(0.3, 0.45)          # the long leaf stalk
                    lc = bpt + _dir(a) * R * 0.9
                    if any(np.hypot(*(lc - q)) < (R + qr) * 0.5 for (q, qr) in placed):
                        continue                                              # keep leaves legible
                    placed.append((lc, R))
                    out, mid, veins = _leaf(rl, bpt[0], bpt[1], a, R, rl.uniform(0.7, 1.0))
                    items.append((tip, out, mid, veins, R))
            if not items and twig is None:
                continue
            ctr = np.mean([np.mean(o, 0) for (_, o, _, _, _) in items], 0) if items else tip
            clusters.append((ctr, items, twig))

        def sweep(cl):                         # lower-left, over the top, to lower-right
            px, py = cl[0]
            a = math.atan2(-(py - cyE), px - cxE)
            return ((3.9 - a) % (2 * math.pi)) + rl.normal(0, 0.1)
        clusters.sort(key=sweep)
        # leaves drawn earlier sit in front: later ones are hidden where they pass behind them
        front = []                              # (centre, radius, polygon)
        detail = s >= 0.5                       # veins and hidden-line work only where they can be seen
        stp = max(1.5, 1.6 * s ** 0.5)
        for ctr, items, twig in clusters:
            if twig is not None:
                B[8].append(twig)
            for (tip, out, mid, veins, R) in items:
                o = np.array(out)
                c0 = o.mean(0)
                if detail:
                    occ = [pg for (q, qr, pg) in front if np.hypot(*(c0 - q)) < (qr + R) * 1.7]
                    runs = _visible_runs(np.vstack([[tip], o]), occ, step=stp, minlen=2.5 * s)
                else:                                   # far away: one plain stroke per leaf
                    occ, runs = [], [np.vstack([[tip], o])]
                for run in runs:
                    B[8].append(('poly', run, dict(w=lw * 0.75, a=0.76, passes=1, wobble=wob * 0.28, overshoot=0.4)))
                if rl.random() < 0.6:
                    lines = [mid] + (veins if rl.random() < 0.45 else [])
                    for j, ln in enumerate(lines if detail else []):
                        for run in _visible_runs(np.array(ln), occ, step=stp, minlen=2.5 * s):
                            B[8].append(('poly', run, dict(w=lw * (0.5 if j == 0 else 0.42), a=0.5 if j == 0 else 0.4,
                                                           passes=1, wobble=wob * 0.2, overshoot=0.0)))
                front.append((c0, R, o))

        # ---------------- a little shade under the crown ----------------
        for ctr, items, _ in clusters:
            if not items:
                continue
            dx = (ctr[0] - cxE) / RxE; dy = (ctr[1] - cyE) / RyE
            if dy * 0.9 + dx * 0.35 < -0.05:
                continue
            R = float(np.mean([it[4] for it in items]))
            poly = _blob(rl, ctr[0] + 0.2 * R, ctr[1] + 1.0 * R, 1.7 * R, 0.66 * R, n=7, jag=0.3)
            ang_ = float(rl.uniform(52, 62))
            if s >= 0.4 and rl.random() < min(1.0, 1.4 / s):   # tiny on a distant tree; lighter on a close-up
                B[9].append(('zig', poly, dict(angle=ang_, spacing=max(2.2, 3.2 * s ** 0.95), w=lw * 0.5, a=0.32,
                                               wobble=wob * 0.2)))
        # the crown's shadow across the top of the trunk and the crotch
        n_ = len(TP)
        i0 = int(n_ * 0.62)
        band = np.vstack([TP[i0:] - nT[i0:] * rT[i0:, None] * 0.95, (TP[i0:] + nT[i0:] * rT[i0:, None] * 0.95)[::-1]])
        B[9].append(('zig', band, dict(angle=58.0, spacing=max(2.2, 3.4 * s ** 0.8), w=lw * 0.5, a=0.28, wobble=wob * 0.2)))

    # ---------------- emit in drawing order ----------------
    d.stages = []                              # (bucket, first stroke, end stroke) for inspection
    for k in range(10):
        n0 = len(d.strokes)
        for kind, P, kw in B[k]:
            if kind == 'poly':
                d.poly([tuple(p) for p in P], **kw)
            elif kind == 'poly_closed':
                d.poly([tuple(p) for p in P], closed=True, **kw)
            elif kind == 'hatch':
                d.hatch([tuple(p) for p in P], **kw)
            elif kind == 'zig':
                ang, sp_ = kw.pop('angle'), kw.pop('spacing')
                z = _zigzag(P, ang, sp_, rl)
                if z is not None:
                    d.poly([tuple(p) for p in z], passes=1, overshoot=0.5 * s ** 0.5, **kw)
        d.stages.append((k, n0, len(d.strokes)))
    return d


# =====================================================================
# 2. HIS SNEAKERS
# =====================================================================
@functools.lru_cache(maxsize=8)
def shoes(seed=51, x=0, y=0, s=1.0):
    """A pair of washed-out canvas sneakers (回力 / Converse type), side view, toe to the right:
    rubber sole with a stripe and a toe bumper, rubber toe cap, eyelets, laces pulled TIGHT and
    tied in a small neat bow, the canvas soft with wear creases.
    Each shoe occupies x..x+305s, y+6s..y+150s (the second one is 330s to the right), the same
    footprint as the original drawing, so scenes that mask or clip it still line up."""
    rng = np.random.default_rng(seed)
    lw = 1.8 * s ** 0.8
    d = Drawing(seed=seed, width=lw, alpha=0.85, wobble=0.9 * s ** 0.8)
    for k, ox in enumerate((0.0, 330.0)):
        j = lambda: rng.normal(0, 1.2)              # a little hand-to-hand variation per shoe

        def T(pts, dx=0.0, dy=0.0):
            return [(x + (ox + px + dx) * s, y + (py + dy) * s) for (px, py) in pts]

        def C(pts, **kw):
            d.curve(T(pts), **kw)

        def Pl(pts, **kw):
            d.poly(T(pts), **kw)

        thin = dict(w=lw * 0.55, a=0.6, passes=1, wobble=0.4 * s, overshoot=0.6 * s)
        # ---- sole: outsole, foxing band with its stripe, toe bumper ----
        C([(-2, 128), (-4, 140), (2, 150), (60, 151), (180, 151), (286, 150), (303, 144), (307, 134), (304, 127)], w=lw * 1.05)
        C([(-2, 128), (60, 128.5), (150, 128), (226, 127), (262, 125), (292, 122), (304, 127)], w=lw * 0.9)
        C([(3, 137), (80, 137.5), (180, 137), (264, 135.5)], w=lw * 1.25, a=0.5, passes=1, wobble=0.25 * s)   # the stripe
        C([(3, 141.5), (80, 142), (180, 141.5), (264, 140)], w=lw * 0.5, a=0.6, passes=1, wobble=0.25 * s)
        C([(274, 134), (288, 133), (300, 131)], **thin)                                      # bumper ribs
        C([(274, 139), (290, 138.5), (303, 137)], **thin)
        for q in range(27):                                                                 # tread edge
            tx = 6 + q * 10.5
            Pl([(tx, 148), (tx + 3, 151)], w=lw * 0.4, a=0.4, passes=1, wobble=0.2 * s, overshoot=0.2 * s)
        # ---- upper: heel counter, collar, vamp to the toe cap ----
        C([(-2, 128), (-3, 104), (-1, 84), (5, 68), (15, 58), (28, 54)], w=lw)
        C([(28, 54), (48, 51), (68, 49), (90, 48)], w=lw * 0.95)                             # padded collar
        C([(14, 64), (30, 60), (50, 57), (70, 55), (88, 54)], w=lw * 0.45, a=0.45, passes=1)  # collar stitching
        # heel-counter overlay seam, double stitched
        C([(30, 58), (36, 80), (40, 104), (42, 127)], w=lw * 0.6, a=0.6, passes=1)
        C([(36, 60), (42, 82), (46, 105), (48, 127)], w=lw * 0.35, a=0.4, passes=1)
        C([(214, 94), (240, 104), (270, 111), (294, 116), (304, 127)], w=lw)                 # vamp down to the toe
        C([(228, 127), (236, 116), (256, 110), (284, 110), (300, 118)], w=lw * 0.85)         # rubber toe cap
        C([(237, 121), (258, 116), (284, 116), (297, 122)], w=lw * 0.4, a=0.45, passes=1)     # its stitching
        C([(4, 104), (3, 125)], **thin)                                                      # heel tab
        C([(13, 103), (13, 125)], **thin)
        # ---- tongue, just showing above the lacing ----
        C([(88, 50), (89, 34), (96, 20), (110, 13), (127, 13), (138, 20), (144, 36), (150, 58)], w=lw * 0.95)
        C([(96, 36), (100, 24), (111, 18), (126, 18), (133, 24)], w=lw * 0.4, a=0.42, passes=1)  # its padded edge
        C([(106, 32), (118, 29), (129, 31)], w=lw * 0.4, a=0.4, passes=1)                    # the woven label
        # the dark mouth of the shoe, between collar and tongue
        mouth = [(22, 56), (44, 52), (66, 50), (88, 49), (89, 54), (66, 55), (44, 57), (26, 60)]
        d.hatch(T(mouth), angle=35, spacing=2.0 * s, w=lw * 0.5, a=0.55)
        # ---- eyestay with eyelets, laces pulled tight ----
        top = np.array([(94, 47), (122, 56), (152, 67), (184, 80), (214, 93)], float)
        low = top + np.array([-5.0, 14.0])
        C([tuple(p) for p in top], w=lw * 0.8)
        C([tuple(p) for p in low] + [(222, 104)], w=lw * 0.8)
        for q in range(12):                                                                  # stitching
            u0 = 0.05 + q * 0.078
            p0 = top[0] + (top[-1] - top[0]) * u0 + np.array([-3.5, 11.0])
            p1 = p0 + (top[-1] - top[0]) * 0.035
            Pl([tuple(p0), tuple(p1)], w=lw * 0.4, a=0.45, passes=1, wobble=0.1 * s, overshoot=0.0)
        eyes = [top[0] + (top[-1] - top[0]) * u + np.array([-2.0, 6.5]) for u in np.linspace(0.16, 0.92, 5)]
        for e in eyes:
            d.ellipse(x + (ox + e[0]) * s, y + e[1] * s, 2.4 * s, 2.1 * s, w=lw * 0.6, passes=1, wobble=0.1 * s)
        # laces pulled tight: short straight bars from each eyelet up over the edge, all alike
        dv_ = (top[-1] - top[0]) / np.linalg.norm(top[-1] - top[0])
        up_ = np.array([dv_[1], -dv_[0]])
        for e in eyes[1:]:
            a0_ = e + up_ * 2.6
            a1_ = e + up_ * 15.5 + dv_ * 4.5
            Pl([tuple(a0_), tuple(a1_)], w=lw * 1.0, passes=1, wobble=0.08 * s, overshoot=0.0)
            Pl([tuple(a0_ + dv_ * 2.2), tuple(a1_ + dv_ * 2.0)], w=lw * 0.45, a=0.5, passes=1, wobble=0.08 * s, overshoot=0.0)
        # ---- the bow knot at the top eyelet: small, neat, cinched ----
        kx, ky = eyes[0] + np.array([2.0, -8.0])
        flip = 1 if k == 0 else -1
        C([(kx - 3, ky + 1), (kx - 1, ky - 3), (kx + 3, ky - 2.5), (kx + 3.5, ky + 1.5), (kx - 1, ky + 3), (kx - 3, ky + 1)],
          w=lw * 0.85, passes=1, wobble=0.1 * s)                                               # the knot
        d.hatch(T([(kx - 2.5, ky + 1), (kx - 1, ky - 2.5), (kx + 3, ky - 2), (kx + 3, ky + 1.5), (kx - 1, ky + 2.5)]),
                angle=60, spacing=1.2 * s, w=lw * 0.5, a=0.7)
        # two loops, pulled small
        C([(kx - 2, ky - 1), (kx - 10, ky - 10 - 2 * flip), (kx - 18, ky - 9), (kx - 15, ky - 2), (kx - 3, ky + 1)],
          w=lw * 0.75, passes=1, wobble=0.12 * s)
        C([(kx + 2, ky - 1), (kx + 11, ky - 12 + 2 * flip), (kx + 19, ky - 10), (kx + 16, ky - 3), (kx + 3, ky + 1)],
          w=lw * 0.75, passes=1, wobble=0.12 * s)
        # the two ends hang down over the quarter, with their aglets
        e1 = [(kx - 1, ky + 3), (kx - 7, ky + 13), (kx - 10, ky + 24), (kx - 9 + j(), ky + 33)]
        e2 = [(kx + 2, ky + 3), (kx + 3, ky + 14), (kx + 1, ky + 25), (kx + 5 + j(), ky + 31)]
        C(e1, w=lw * 0.7, passes=1, wobble=0.15 * s); C(e2, w=lw * 0.7, passes=1, wobble=0.15 * s)
        for ee in (e1, e2):
            (ax_, ay_), (bx_, by_) = ee[-2], ee[-1]
            L_ = math.hypot(bx_ - ax_, by_ - ay_) + 1e-9
            Pl([(bx_, by_), (bx_ + (bx_ - ax_) / L_ * 6, by_ + (by_ - ay_) / L_ * 6)], w=lw * 1.35, passes=1, wobble=0.0, overshoot=0.0)
        # ---- wear: soft creases where the foot flexes, a crumpled collar, washed-out tone ----
        creases = [[(196, 100), (205, 111), (209, 123)], [(210, 101), (218, 110), (222, 121)],
                   [(184, 97), (189, 106)], [(226, 106), (231, 116)]]
        if k == 1:
            creases = [[(192, 99), (202, 112), (205, 123)], [(207, 100), (216, 111)], [(222, 104), (229, 116)]]
        for cc in creases:
            cc = [(px + j() * 0.8, py + j() * 0.5) for (px, py) in cc]
            C(cc, w=lw * 0.5, a=0.5, passes=1, wobble=0.3 * s, overshoot=0.5 * s)
        C([(56, 60), (62, 68), (64, 78)], w=lw * 0.42, a=0.38, passes=1)
        C([(72, 60), (76, 67)], w=lw * 0.42, a=0.38, passes=1)
        # washed-out canvas: a couple of faint, uneven patches of tone
        for (cx_, cy_, rx_, ry_) in ((100, 96, 30, 12), (160, 108, 22, 8)):
            d.hatch(T([(cx_ + rx_ * math.cos(t_) + j(), cy_ + ry_ * math.sin(t_) + j()) for t_ in np.linspace(0, 6.28, 9)[:-1]]),
                    angle=float(rng.uniform(40, 60)), spacing=4.0 * s, w=lw * 0.35, a=0.18)
        # canvas shade: low along the upper, and down the heel
        d.hatch(T([(10, 112), (80, 118), (160, 121), (226, 124.5), (226, 127), (6, 127), (4, 116)]), angle=62,
                spacing=3.4 * s, w=lw * 0.4, a=0.3)
        d.hatch(T([(-1, 100), (1, 82), (7, 69), (16, 62), (22, 70), (24, 100), (24, 126), (0, 126)]), angle=70, spacing=3.0 * s,
                w=lw * 0.4, a=0.32)
    return d


# =====================================================================
# 3. THE BED BOARD (A line macro)
# =====================================================================
_BOARD_RGB = (204, 206, 207)
_GRAIN_RGB = (132, 135, 137)


def _path(pts):
    p = skia.Path()
    p.moveTo(float(pts[0][0]), float(pts[0][1]))
    for q in pts[1:]:
        p.lineTo(float(q[0]), float(q[1]))
    return p


@functools.lru_cache(maxsize=4)
def _board_image(w, h, y, seed):
    """The still part of the board: long, calm grain that eases round two knots and runs
    parallel to the crack (a split follows the grain), a cold light across it."""
    rng = np.random.default_rng(seed + 211)
    surf = skia.Surface(int(w), int(h))
    c = surf.getCanvas()
    # the base: board colour with a fine tooth and short pores running along the grain
    c.drawImage(paper(int(w), int(h), _BOARD_RGB, seed + 5, 0.55, 0.5), 0, 0)
    main, _ = _crack_pts(seed, w)
    dev = main[:, 1] - np.mean(main[:, 1])
    xs = np.arange(-40.0, w + 41.0, 6.0)
    cdev = np.interp(xs, main[:, 0], dev)
    # two knots, well away from the crack
    knots = [(w * rng.uniform(0.18, 0.3), y - h * rng.uniform(0.21, 0.27), rng.uniform(20, 26)),
             (w * rng.uniform(0.68, 0.8), y + h * rng.uniform(0.3, 0.36), rng.uniform(14, 18))]

    def line_y(y0, amp, lam, ph):
        yy = y0 + amp[0] * np.sin(2 * math.pi * xs / lam[0] + ph[0]) + amp[1] * np.sin(2 * math.pi * xs / lam[1] + ph[1])
        yy = yy + cdev * math.exp(-((y0 - y) / (0.16 * h)) ** 2)            # follow the split
        for (kx, ky, kr) in knots:
            dy = y0 - ky
            reach = 5.5 * kr
            push = np.sign(dy if dy != 0 else 1.0) * kr * 1.1 * np.exp(-np.abs(dy) / (2.6 * kr))
            yy = yy + push * np.exp(-((xs - kx) / reach) ** 2)
        return yy

    # broad soft figure: a few wide, faint bands of darker wood along the grain
    for k in range(7):
        y0 = rng.uniform(-0.05, 1.05) * h
        amp = (rng.uniform(4, 12), rng.uniform(1, 4)); lam = (rng.uniform(1400, 2600), rng.uniform(500, 900))
        ph = rng.uniform(0, 6.3, 2)
        p = paint((120, 118, 114), rng.uniform(0.035, 0.06), rng.uniform(30, 90))
        p.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 26))
        p.setStrokeCap(skia.Paint.kButt_Cap)
        c.drawPath(_path(np.stack([xs, line_y(y0, amp, lam, ph)], 1)), p)
    # the grain: fine lines gathered into soft bundles (growth rings seen edge-on)
    ys = []
    for (kx, ky, kr) in knots:                     # the grain crowds round a knot
        ys += list(ky + np.array([-2.6, -1.9, -1.35, 1.35, 1.9, 2.6]) * kr + rng.normal(0, 1.5, 6))
    yy0 = -30.0
    while yy0 < h + 30:
        bundle = int(rng.integers(2, 6))
        for q in range(bundle):
            ys.append(yy0 + q * rng.uniform(3.5, 7.5))
        yy0 += bundle * 6 + rng.uniform(18, 46)
    base_lam, base_ph = rng.uniform(1900, 2600), rng.uniform(0, 6.3)
    for y0 in sorted(ys):
        # neighbouring lines share the long wave, so the figure flows together
        amp = (rng.uniform(6, 13), rng.uniform(0.6, 2.0))
        lam = (base_lam * rng.uniform(0.93, 1.07), rng.uniform(420, 900))
        ph = (base_ph + 0.9 * math.sin(y0 / h * 3.1) + rng.normal(0, 0.12), rng.uniform(0, 6.3))
        yy = line_y(y0, amp, lam, ph)
        pts = np.stack([xs, yy], 1)
        # a line fades in and out along its length, as grain does
        n = len(pts)
        seg = int(rng.integers(n // 3, n))
        s0 = int(rng.integers(0, n - seg + 1))
        a = rng.uniform(0.10, 0.26)
        c.drawPath(_path(pts[s0:s0 + seg]), paint(_GRAIN_RGB, a, rng.uniform(0.6, 1.25)))
    # the knots: tight rings round a dark heart
    for (kx, ky, kr) in knots:
        hp = paint((96, 96, 96), 0.3)
        hp.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, kr * 0.3))
        c.drawOval(skia.Rect.MakeXYWH(kx - kr * 0.75, ky - kr * 0.3, kr * 1.5, kr * 0.6), hp)
        th = np.linspace(0, 2 * math.pi, 64)
        for q, f in enumerate((0.45, 0.75, 1.05)):
            wob_ = 1 + 0.06 * np.sin(3 * th + rng.uniform(0, 6)) + 0.04 * np.sin(5 * th + rng.uniform(0, 6))
            ring = np.stack([kx + kr * f * 2.1 * np.cos(th) * wob_, ky + kr * f * 0.62 * np.sin(th) * wob_], 1)
            c.drawPath(_path(ring), paint(_GRAIN_RGB, 0.42 - 0.07 * q, 1.1))
    # cold light from the upper left, falling away into the corners
    sh = skia.GradientShader.MakeLinear([(0, 0), (w, h)], [col((236, 240, 244), 0.22), col((236, 240, 244), 0.0),
                                                            col((30, 34, 40), 0.10)], [0.0, 0.5, 1.0])
    c.drawRect(skia.Rect(0, 0, w, h), skia.Paint(Shader=sh))
    # a soft, even vignette (elliptical, no hard ring)
    m = skia.Matrix(); m.setScale(1.0, h / w); m.postTranslate(0, 0)
    vg = skia.GradientShader.MakeRadial((w / 2, w / 2), w * 0.62,
                                        [col((18, 22, 28), 0.0), col((18, 22, 28), 0.0), col((18, 22, 28), 0.07),
                                         col((18, 22, 28), 0.2), col((18, 22, 28), 0.34)],
                                        [0.0, 0.42, 0.66, 0.86, 1.0], skia.TileMode.kClamp, 0, m)
    c.drawRect(skia.Rect(0, 0, w, h), skia.Paint(Shader=vg))
    return surf.makeImageSnapshot()


def bed_board(c, w, h, a=1.0, y=None, seed=5, crack_progress=1.0):
    """Macro of the upper-bunk board: calm wood grain, two knots, and THE crack (third from the
    left) — the same crack geometry as objects.bed_board (objects._crack_pts), drawn with a
    little depth: a soft shadow, the dark split, a cold highlight on its lower lip."""
    y = h * 0.42 if y is None else y
    p = skia.Paint(); p.setAlphaf(max(0.0, min(1.0, a)))
    c.drawImage(_board_image(int(w), int(h), float(y), seed), 0, 0, skia.SamplingOptions(), p)
    main, br = _crack_pts(seed, w)
    n = max(2, int(len(main) * crack_progress))
    pts = main[:n].copy(); pts[:, 1] += y
    branches = []
    for b in br:
        if b[0, 0] < pts[-1, 0]:
            q = b.copy(); q[:, 1] += y
            branches.append(q)
    sp = paint((20, 22, 26), 0.22 * a, 5.0)
    sp.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 2.5))
    c.save(); c.translate(0, 1.6)
    c.drawPath(_path(pts), sp)
    for q in branches:
        c.drawPath(_path(q), paint((20, 22, 26), 0.10 * a, 3.0))
    c.restore()
    ink(c, pts, (34, 35, 38), a * 0.92, 2.3)
    ink(c, pts + np.array([0, 2.0]), (246, 248, 250), a * 0.30, 1.0)
    for q in branches:
        ink(c, q, (40, 41, 44), a * 0.68, 1.25)
        ink(c, q + np.array([0, 1.4]), (246, 248, 250), a * 0.16, 0.8)


def install():
    """Swap the polished drawings into film.objects (call before scenes build their drawings)."""
    from . import objects as O
    O.tree = tree
    O.shoes = shoes
    O.bed_board = bed_board
    O.zhang_tree.cache_clear()

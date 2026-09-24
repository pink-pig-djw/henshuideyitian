"""第三场【循环】 内景 宿舍 日 — the twelfth morning of 5月9日.
The sound of tearing he did not care about; the trash bin; a contract that was torn, but not
torn enough. Then the night it started, reconstructed on the plan in dashed lines."""
import math, functools
import numpy as np
import skia
from film.config import *
from film.gfx import *
from film.timeline import Scene
from film import objects as O, sfx
from film.audio import reverb, lowpass, bandpass, highpass, env_fade

PX, PY, PS = 200, 120, 1.0          # floor-plan placement (fixed camera of the A line, as s01)
RX = 1010                           # right column
LOOP = 12

# =====================================================================
# The torn contract (shared with s05_loop, which imports these helpers)
# =====================================================================
TEAR_SEED = 318
XC = [0, 150, 312, 468, 620]                        # column tears (page units, s=1)
YC = [0, 140, 214, 318, 462, 598, 736, 877]         # row tears — chosen to fall between text lines
YJ = {1: (-9, 9), 2: (-5, 3), 3: (-5, 9), 4: (-6, 12), 5: (-14, 14), 6: (-14, 14)}
YAMP = {1: 2.6, 2: 1.4, 3: 1.6, 4: 2.2, 5: 3.0, 6: 3.0}
NR, NC = len(YC) - 1, len(XC) - 1
SS = 2.0                                            # supersampling of the cached page / piece images
SAMP = skia.SamplingOptions(skia.FilterMode.kLinear, skia.MipmapMode.kLinear)

def _torn(P, Q, rng, amp, step=6.5):
    P = np.asarray(P, float); Q = np.asarray(Q, float)
    L = float(np.hypot(*(Q - P)))
    n = max(3, int(L / step))
    t = np.linspace(0, 1, n + 1)
    walk = np.cumsum(rng.normal(0, 1, n + 1))
    walk -= walk[0] + (walk[-1] - walk[0]) * t
    walk = walk / (np.abs(walk).max() + 1e-6) * amp * 0.8
    jag = rng.normal(0, amp * 0.35, n + 1)
    jag[0] = jag[-1] = 0
    d = walk + jag
    nx, ny = -(Q - P)[1] / L, (Q - P)[0] / L
    pts = P[None, :] + (Q - P)[None, :] * t[:, None] + np.stack([nx * d, ny * d], 1)
    return pts

@functools.lru_cache(maxsize=1)
def tear_geometry():
    """Jittered grid of torn fragments. Returns list of dicts: poly (page units), c (centroid), key (i,j)."""
    rng = np.random.default_rng(TEAR_SEED)
    V = np.zeros((NR + 1, NC + 1, 2))
    for i in range(NR + 1):
        for j in range(NC + 1):
            x, y = XC[j], YC[i]
            if 0 < j < NC:
                x += rng.uniform(-20, 20)
            if 0 < i < NR:
                y += rng.uniform(*YJ[i])
            V[i, j] = (x, y)
    Hs = {}
    for i in range(NR + 1):
        for j in range(NC):
            if i in (0, NR):
                Hs[i, j] = np.array([V[i, j], V[i, j + 1]])
            else:
                Hs[i, j] = _torn(V[i, j], V[i, j + 1], rng, YAMP[i])
    Vs = {}
    for i in range(NR):
        for j in range(NC + 1):
            if j in (0, NC):
                Vs[i, j] = np.array([V[i, j], V[i + 1, j]])
            else:
                Vs[i, j] = _torn(V[i, j], V[i + 1, j], rng, 3.0)
    pieces = []
    for i in range(NR):
        for j in range(NC):
            poly = np.concatenate([Hs[i, j], Vs[i, j + 1][1:], Hs[i + 1, j][::-1][1:], Vs[i, j][::-1][1:-1]])
            c = poly.mean(0)
            # inset a hair towards the centroid so seams read as seams
            d = poly - c
            n = np.hypot(d[:, 0], d[:, 1])[:, None] + 1e-6
            poly = poly - d / n * 0.9
            pieces.append(dict(poly=poly, c=c, key=(i, j)))
    return pieces

@functools.lru_cache(maxsize=4)
def page_image(s, yue_red=0.0):
    w, h = int(O.CONTRACT_W * s * SS) + 2, int(O.CONTRACT_H * s * SS) + 2
    surf = skia.Surface(w, h)
    c = surf.getCanvas(); c.clear(skia.ColorTRANSPARENT)
    O.contract_page(c, 0, 0, s=s * SS, shadow=False, yue_red=yue_red)
    return surf.makeImageSnapshot()

def _path(pts, k=1.0, dx=0.0, dy=0.0):
    p = skia.Path()
    p.moveTo(pts[0][0] * k + dx, pts[0][1] * k + dy)
    for q in pts[1:]:
        p.lineTo(q[0] * k + dx, q[1] * k + dy)
    p.close()
    return p

PAD = 18

@functools.lru_cache(maxsize=128)
def piece_images(idx, s, yue_red=0.0):
    """(image, shadow_image, ox, oy): the fragment cut out of the page, and its soft silhouette.
    Both at SS x display scale; (ox, oy) = page-local display coords of the image's top-left."""
    pc = tear_geometry()[idx]
    poly = pc['poly'] * s
    x0, y0 = poly.min(0) - PAD; x1, y1 = poly.max(0) + PAD
    w, h = int((x1 - x0) * SS) + 1, int((y1 - y0) * SS) + 1
    page = page_image(s, yue_red)
    # the fragment
    surf = skia.Surface(w, h); c = surf.getCanvas(); c.clear(skia.ColorTRANSPARENT)
    path = _path(poly, SS, -x0 * SS, -y0 * SS)
    c.save(); c.clipPath(path, skia.ClipOp.kIntersect, True)
    c.drawImage(page, -x0 * SS, -y0 * SS)
    # torn fibre rim: brighter core + a faint grey lip along the edge
    c.drawPath(path, paint((255, 255, 255), 0.85, 1.7 * SS * 0.5))
    c.drawPath(path, paint((150, 150, 150), 0.30, 0.6 * SS * 0.5))
    c.restore()
    img = surf.makeImageSnapshot().withDefaultMipmaps()
    # the shadow silhouette
    surf2 = skia.Surface(w, h); c2 = surf2.getCanvas(); c2.clear(skia.ColorTRANSPARENT)
    p = paint((10, 16, 24), 1.0); p.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 3.2 * SS))
    c2.drawPath(path, p)
    sh = surf2.makeImageSnapshot().withDefaultMipmaps()
    return img, sh, x0, y0

def draw_piece(c, idx, s, x, y, rot=0.0, lift=0.0, a=1.0, yue_red=0.0):
    """Draw fragment idx with its page-origin placed at (x, y), rotated `rot` degrees about its centroid."""
    img, sh, ox, oy = piece_images(idx, s, yue_red)
    cx, cy = tear_geometry()[idx]['c'] * s
    c.save()
    c.translate(x + cx, y + cy); c.rotate(rot); c.translate(-cx, -cy)
    # shadow: fixed light from top-left, grows while the piece is lifted
    sp = skia.Paint(); sp.setAlphaf(a * (0.16 + 0.14 * lift))
    off = 1.6 + 7 * lift
    c.save(); c.translate(ox + off, oy + off * 1.3); c.scale(1 / SS, 1 / SS)
    c.drawImage(sh, 0, 0, SAMP, sp)
    c.restore()
    ip = skia.Paint(); ip.setAlphaf(a)
    c.save(); c.translate(ox, oy); c.scale(1 / SS, 1 / SS)
    c.drawImage(img, 0, 0, SAMP, ip)
    c.restore()
    c.restore()

def dot(c, x, y, label, a=1.0, rgb=A_INK, r=9, left=False):
    """O.person_dot, with the option of the name on the left (when the right side is a wall)."""
    c.drawCircle(x, y, r, paint(rgb, a))
    if left:
        text(c, label, x - r - 8, y + 7, 'sans-medium', 18, rgb, a, 'right', tracking=0.1)
    else:
        text(c, label, x + r + 8, y + 7, 'sans-medium', 18, rgb, a, tracking=0.1)

@functools.lru_cache(maxsize=1)
def _bg_image():
    surf = skia.Surface(W, H)
    O.a_background(surf.getCanvas(), W, H)
    return surf.makeImageSnapshot().withDefaultMipmaps()

def a_bg(c):
    """O.a_background, cached (its full-frame vignette costs ~40 ms a frame otherwise)."""
    c.drawImage(_bg_image(), 0, 0, SAMP)

@functools.lru_cache(maxsize=1)
def _plan_image():
    surf = skia.Surface(W, H)
    c = surf.getCanvas()
    O.a_background(c, W, H)
    O.floorplan(c, PX, PY, PS, empty_alpha=0.55)
    return surf.makeImageSnapshot().withDefaultMipmaps()

def piece_index(i, j):
    return i * NC + j

# =====================================================================
# Small procedural sounds
# =====================================================================
def _tt(d):
    return np.arange(int(d * SR)) / SR

def slide(seed=0, d=0.5, a=1.0):
    """A scrap of paper pushed across a desk."""
    rng = np.random.default_rng(seed)
    t = _tt(d)
    x = bandpass(sfx.noise(d, seed), 900, 5200) * np.sin(np.pi * t / d) ** 1.4
    x *= 0.75 + 0.25 * np.sin(2 * np.pi * rng.uniform(11, 23) * t)
    return (x * 0.22 * a).astype(np.float32)

def rummage(d=4.5, seed=300):
    """Hands in a small bin: plastic liner crinkle + paper scraps."""
    rng = np.random.default_rng(seed)
    out = np.zeros(int(d * SR), np.float32)
    tpos = 0.05
    while tpos < d - 0.4:
        dd = rng.uniform(0.12, 0.45)
        tt = _tt(dd)
        crk = (rng.random(len(tt)) < 0.035) * rng.normal(0, 1, len(tt))
        x = highpass(crk.astype(np.float32), 2500) * 0.5 + bandpass(sfx.noise(dd, int(rng.integers(1e6))), 2500, 9000) * 0.12
        x *= np.sin(np.pi * tt / dd) ** 0.6 * rng.uniform(0.4, 1.0)
        s = int(tpos * SR); e = min(len(out), s + len(x)); out[s:e] += x[:e - s]
        tpos += dd * rng.uniform(0.4, 1.1)
    for k in range(3):
        r = sfx.paper_rustle(int(rng.integers(1e6)), rng.uniform(0.4, 0.8))
        s = int(rng.uniform(0.2, d - 0.9) * SR); out[s:s + len(r)] += r * 0.8
    return env_fade(out * 0.9, 0.1, 0.4)

def remembered_tearing(seed=330):
    """What Chen heard that night and didn't care about: tearing, again and again. Distant, inside."""
    rng = np.random.default_rng(seed)
    out = np.zeros(int(3.6 * SR), np.float32)
    tpos = 0.0
    for k in range(5):
        d = rng.uniform(0.35, 0.7) * (1.0 if k < 2 else 0.8)
        x = sfx.paper_tear(int(seed + k * 7), d) * (1.0 - 0.1 * k)
        s = int(tpos * SR); out[s:s + len(x)] += x[:len(out) - s]
        tpos += d + rng.uniform(0.05, 0.25)
    y = reverb(lowpass(out, 5000), wet=0.5, decay=1.8, size='hall', bright=3800)
    return env_fade(y, 0.05, 0.8)

# =====================================================================
# The master: floor plan + clock + counter + event log (s01 idiom)
# =====================================================================
class Master:
    def __init__(self, loop, start_spots):
        self.loop = loop
        self.log = []                                  # (t, stamp, text)
        self.home = dict(start_spots)                  # who -> spot
        self.moves = []                                # (t0, t1, who, from, to)
        self.ghosts = []                               # (t_in, t_out, label, path[(t, spot)], dash)
        self.dim = []                                  # (t0, t1, amount) — dims the living dots
        self.t_siren = None
        self.lamp = None                               # time the desk lamp is switched on
        self.trash_hl = None                           # time the trash is marked as evidence location
        self.counter_from = None
        self.left = {}                                 # who -> fn(T) -> label on the left side

    def say_log(self, t, stamp, s):
        self.log.append((t, stamp, s))

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
        if self.trash_hl is not None and self.trash_hl < T < self.trash_hl + 3.2:
            ht = 0.5 - 0.5 * math.cos((T - self.trash_hl) / 3.2 * 2 * math.pi)
            a_bg(c)
            O.floorplan(c, PX, PY, PS, empty_alpha=0.55, highlight='trash', ht=ht)
        else:
            c.drawImage(_plan_image(), 0, 0, SAMP)
        # the lamp on Zhang's desk: the only warm light the A line allows
        if self.lamp is not None and T > self.lamp:
            k = smooth((T - self.lamp) / 0.35)
            lx, ly = PX + 3.6 * 100 * PS, PY + 3.62 * 100 * PS
            g = skia.GradientShader.MakeRadial((lx, ly), 170, [col(LAMP, 0.5 * k), col(LAMP, 0.18 * k), col(LAMP, 0)], [0, 0.45, 1])
            c.drawCircle(lx, ly, 170, skia.Paint(Shader=g))
            c.drawCircle(lx, ly, 8, paint(LAMP, 0.95 * k))
            c.drawCircle(lx, ly, 8, paint(A_INK, 0.8, 1.0))
        # the chair nobody sits in
        zx, zy = O.plan_xy(PX, PY, PS, 'zhang_desk')
        ghost_on = max([self._ghost_alpha(g, T) for g in self.ghosts if g[2] == '张'] or [0.0])
        text(c, '空', zx - 8, zy + 7, 'sans-light', 16, A_MID, 0.8 * (1 - ghost_on))
        # siren marker outside the window (identical every loop)
        if self.t_siren is not None and T > self.t_siren:
            k = T - self.t_siren
            wx, wy = O.plan_xy(PX, PY, PS, 'window')
            ring = (k * 0.8) % 1.0
            aa = min(1.0, k / 1.5) * (1.0 if k < 9 else max(0.25, 1 - (k - 9) / 3))
            c.drawCircle(wx + 120, wy - 60, 6, paint(A_INK, aa))
            c.drawCircle(wx + 120, wy - 60, 6 + 30 * ring, paint(A_INK, aa * (1 - ring) * 0.5, 1.2))
            text(c, '楼下 · 警车', wx + 140, wy - 54, 'sans-light', 17, A_MID, aa, tracking=0.2)
        # the reconstruction of "that night": dashed ghosts
        self._draw_ghosts(c, T)
        dimk = 1.0
        for (t0, t1, amt) in self.dim:
            dimk = min(dimk, 1 - amt * min(smooth((T - t0) / 0.8), smooth((t1 - T) / 0.8)))
        for who in ('李', '陈'):
            x, y = self.spot_at(who, T)
            dot(c, x, y, who, a=dimk, left=self.left.get(who, lambda T: False)(T))
        stamp = [e[1] for e in self.log if e[0] <= T]
        O.clock_card(c, RX, 210, 1.0, time=stamp[-1] if stamp else '08:30')
        # loop counter: ticks over from the previous loop
        if self.counter_from is not None:
            k = smooth((T - self.counter_from) / 0.5)
            if k < 1:
                O.loop_counter(c, 1620, 150, self.loop - 1, 1 - k)
            if k > 0:
                O.loop_counter(c, 1620, 150, self.loop, k)
        else:
            O.loop_counter(c, 1620, 150, self.loop, 1.0)
        O.event_log(c, RX, 420, self.log, T, maxw=780)

    # ---- ghosts ----
    def _ghost_alpha(self, g, T):
        t_in, t_out = g[0], g[1]
        return min(smooth((T - t_in) / 1.0), smooth((t_out - T) / 1.2))

    def _ghost_xy(self, path, T):
        pts = [(t, O.plan_xy(PX, PY, PS, s)) for (t, s) in path]
        if T <= pts[0][0]:
            return pts[0][1], 0
        for k in range(len(pts) - 1):
            (ta, A), (tb, B) = pts[k], pts[k + 1]
            if T < tb:
                u = ease_in_out(ramp(T, ta, tb))
                return (A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u), k
        return pts[-1][1], len(pts) - 1

    def _draw_ghosts(self, c, T):
        dash = skia.DashPathEffect.Make([5.0, 5.0], 0.0)
        legend = 0.0
        for g in self.ghosts:
            a = self._ghost_alpha(g, T)
            if a <= 0:
                continue
            legend = max(legend, a)
            label, path = g[2], g[3]
            (x, y), k = self._ghost_xy(path, T)
            # trail already walked
            if len(path) > 1 and T > path[0][0]:
                trail = skia.Path()
                P0 = O.plan_xy(PX, PY, PS, path[0][1]); trail.moveTo(*P0)
                for (tt, sp) in path[1:k + 1]:
                    trail.lineTo(*O.plan_xy(PX, PY, PS, sp))
                trail.lineTo(x, y)
                p = paint(A_INK, 0.55 * a, 1.3); p.setPathEffect(dash)
                c.drawPath(trail, p)
            p = paint(A_INK, 0.9 * a, 1.5); p.setPathEffect(skia.DashPathEffect.Make([3.0, 3.0], 0.0))
            c.drawCircle(x, y, 10, p)
            if label == '张':
                text(c, label, x, y - 20, 'sans-light', 18, A_MID, a, 'center', tracking=0.1)
            else:
                text(c, label, x + (28 if label == '李' else 17), y + 7, 'sans-light', 18, A_MID, a, tracking=0.1)
        if legend > 0:
            lx, ly = PX + 190, PY + 720 + 60
            p = paint(A_INK, 0.8 * legend, 1.3); p.setPathEffect(skia.DashPathEffect.Make([3.0, 3.0], 0.0))
            c.drawCircle(lx, ly - 5, 7, p)
            text(c, '那天晚上 · 重建', lx + 16, ly + 1, 'sans-light', 15, A_MID, legend, tracking=0.2)

# =====================================================================
# Evidence table insert
# =====================================================================
S_INS = 0.86
PX0, PY0 = 694, 58                                  # page origin on the table when assembled
MISSING = {(0, 3), (1, 0), (1, 1), (3, 0), (3, 1), (3, 3), (4, 1), (4, 3), (5, 1), (6, 2), (6, 3)}
KEYS = [(2, 0), (2, 1)]                            # 借款人 / 借款金额 — the only two lines that read
# the outline first (title, corners, the left column), then the two readable lines lock together;
# the rest keeps coming in while they talk
ORDER = [(0, 1), (0, 2), (0, 0), (6, 0), (6, 1), (5, 0), (4, 0), (2, 0), (2, 1),
         (1, 3), (5, 3), (2, 3), (4, 2), (1, 2), (5, 2), (3, 2), (2, 2)]
TITLE = [(0, 1), (0, 2)]

@functools.lru_cache(maxsize=1)
def insert_plan():
    """Scatter pose and residual (final) pose for every present piece."""
    rng = np.random.default_rng(3031)
    P = tear_geometry()
    s = S_INS
    left = [(r, j) for (r, j) in ORDER if j <= 1]
    right = [(r, j) for (r, j) in ORDER if j >= 2]
    plan = {}
    # scatter on the table, left and right of where the page will lie
    slots_l = [(150 + (k % 3) * 170 + rng.uniform(-25, 25), 310 + (k // 3) * 140 + rng.uniform(-20, 20)) for k in range(len(left))]
    slots_r = [(1330 + (k % 3) * 170 + rng.uniform(-25, 25), 520 + (k // 3) * 110 + rng.uniform(-15, 15)) for k in range(len(right))]
    rng.shuffle(slots_l); rng.shuffle(slots_r)
    for lst, slots in ((left, slots_l), (right, slots_r)):
        for key, (sx, sy) in zip(lst, slots):
            idx = piece_index(*key)
            cx, cy = P[idx]['c'] * s
            rot0 = rng.uniform(-38, 38)
            if key in KEYS:
                fin = (0.0, 0.0, 0.0)
            elif key in TITLE:
                fin = (rng.uniform(-1.5, 1.5), rng.uniform(-2.5, 2.5), rng.uniform(-0.6, 0.6))
            else:           # laid down roughly: fragments of words, never a whole line
                sg = lambda: 1 if rng.random() < 0.5 else -1
                fin = (sg() * rng.uniform(5, 13), sg() * rng.uniform(4, 11), sg() * rng.uniform(1.8, 5.0))
            plan[key] = dict(idx=idx, x0=sx - cx, y0=sy - cy, r0=rot0, fin=fin)
    return plan

def build():
    sc = Scene('s03_loop', kind='A', title='第三场【循环】')
    M = Master(LOOP, {'李': 'li_bed', '陈': 'chen_bed'})

    # ---------- the ritual, short: alarm, bed board, straight to the plan ----------
    sc.wait(0.5)
    t_alarm = sc.t
    al = sfx.alarm(2)
    cut = int(3.9 * SR)
    sc.sfx(env_fade(al[:cut], 0.0, 0.05), gain=-6)
    sc.wait(0.6)
    t_board = sc.t
    def board(c, t, L):
        O.bed_board(c, L.w, L.h, 1.0)
    sc.layer(board, t_board, t_board + 2.6, fin=0.5, fout=0.3)
    sc.wait(2.3)
    t_master = sc.t
    M.counter_from = t_master + 0.9
    sc.sfx(sfx.click(3, 2500, 0.03, 0.4), at=t_alarm + 3.9, gain=-8)          # someone kills it
    sc.amb(sfx.room_tone(60, 1), t_master, None, gain=-2)
    M.say_log(t_master + 0.5, '08:30', '闹钟。这一次，没有人等它响完。')
    sc.wait(2.2)

    sc.say('chen', '垃圾桶。', note='上铺', speed=0.85, post=0.5)
    M.t_siren = sc.t + 0.6
    sc.sfx(sfx.siren(9.0), at=M.t_siren, gain=-14)
    sc.say('chen', '他在那天晚上出去之前撕了什么东西。你记不记得？', post=0.5)
    sc.say('li', '什么？', speed=0.95, post=0.7)
    M.say_log(sc.t - 0.3, '08:31', '窗外警笛由远及近，停在楼下。同一个位置。')
    sc.say('chen', '我当时听见了撕纸的声音。', post=0.25)
    t_mem = sc.t
    sc.sfx(remembered_tearing(), at=t_mem, gain=-9)
    sc.wait(3.1)
    sc.say('chen', '没在意。', speed=0.84, post=1.2)

    # Li goes to the bin
    t = sc.t
    M.say_log(t, '08:31', '李浩然下床，走到张朝阳书桌旁的垃圾桶前，蹲下。')
    M.moves.append((t + 0.3, t + 3.0, '李', 'li_bed', (3.46, 5.05)))
    M.left['李'] = lambda T, a_=t + 2.0, b_=t + 12.5: a_ < T < b_
    sc.sfx(sfx.footsteps(4, 0.6, 303, a=0.5), at=t + 0.4, gain=-12)
    sc.wait(3.3)
    sc.sfx(rummage(5.0, 301), gain=-8, pan=0.3)
    M.say_log(sc.t + 1.2, '08:32', '翻了一阵。从底部捞出几片碎纸。')
    M.trash_hl = sc.t + 4.6
    sc.wait(5.4)
    t = sc.t
    M.say_log(t, '08:32', '两人把碎片摊在张朝阳的桌上。')
    M.moves.append((t + 0.2, t + 2.2, '李', (3.46, 5.05), (2.5, 3.5)))
    M.moves.append((t + 0.1, t + 3.0, '陈', 'chen_bed', (2.5, 4.6)))
    sc.sfx(sfx.footsteps(4, 0.55, 304, a=0.45), at=t + 0.3, gain=-13)
    sc.sfx(sfx.paper_rustle(305, 0.9), at=t + 2.6, gain=-9)
    sc.wait(3.6)
    t_ins = sc.t

    # ---------- the evidence table: the fragments come together (but not all of them) ----------
    plan = insert_plan()
    t_a0 = t_ins + 2.2                     # first piece moves
    sched = {}
    tt = t_a0
    after = False
    for n, key in enumerate(ORDER):
        d = 1.25 + 0.35 * ((n * 7) % 5) / 4
        if key in KEYS:
            d = 1.8
            tt += 0.5
        sched[key] = (tt, tt + d)
        if key == KEYS[-1]:
            tt += 1.2; after = True
        else:
            tt += 1.1 if after else (0.7 if key not in KEYS else 1.2)
    t_keys_lock = sched[KEYS[-1]][1] + 0.7
    for key in ORDER:
        a_, b_ = sched[key]
        cx = plan[key]['x0']
        pan = -0.5 if cx < 700 else 0.5
        sc.sfx(slide(hash(key) % 1000 + 400, min(0.7, b_ - a_ - 0.4)), at=a_ + 0.15, gain=-10, pan=pan)
    sc.sfx(slide(991, 0.25, 0.8), at=sched[(2, 0)][1] + 0.35, gain=-12)
    sc.sfx(slide(992, 0.25, 0.8), at=sched[(2, 1)][1] + 0.35, gain=-12)
    notes = [(t_ins + 1.0, '08:33', '碎片的边缘参差不齐。'),
             (t_ins + 4.4, '08:33', '不是随手一撕——是反复撕了很多次，像是要确保没有人能看到。'),
             (sched[KEYS[0]][0] - 1.4, '08:34', '但他没有撕干净。')]

    def pose(key, T):
        p = plan[key]
        a_, b_ = sched[key]
        fx, fy, fr = p['fin']
        k = ease_in_out(ramp(T, a_, b_))
        x = p['x0'] + (PX0 + fx - p['x0']) * k
        y = p['y0'] + (PY0 + fy - p['y0']) * k
        r = p['r0'] + (fr - p['r0']) * k
        lift = math.sin(math.pi * k) if 0 < k < 1 else 0.0
        if key in KEYS:              # arrive a hair off, then the last push into place
            nudge = 1 - ease_out(ramp(T, b_ + 0.25, b_ + 0.6))
            x += 5 * nudge * (1 if key == (2, 1) else -1); y -= 3 * nudge; r += 0.8 * nudge
        return x, y, r, lift, k

    def state(key, T):
        a_, b_ = sched[key]
        end = b_ + (0.6 if key in KEYS else 0.0)
        return 0 if T <= a_ else (2 if T >= end else 1)

    @functools.lru_cache(maxsize=2)
    def still_image(states):
        """All pieces that are not moving, pre-composited (transparent background)."""
        surf = skia.Surface(W, H); cc = surf.getCanvas(); cc.clear(skia.ColorTRANSPARENT)
        for key, st in zip(ORDER, states):
            if st == 1:
                continue
            p = plan[key]
            fx, fy, fr = p['fin']
            if st == 0:
                draw_piece(cc, p['idx'], S_INS, p['x0'], p['y0'], p['r0'], 0.0)
            else:
                draw_piece(cc, p['idx'], S_INS, PX0 + fx, PY0 + fy, fr, 0.0)
        return surf.makeImageSnapshot().withDefaultMipmaps()

    def insert(c, t, L):
        T = L.T
        a_bg(c)
        s = S_INS
        # the outline of a contract, forming as the pieces come in
        placed = sum(ramp(T, *sched[key]) for key in ORDER)
        ko = smooth((placed - 3) / 8)
        if ko > 0:
            p = paint(A_MID, 0.55 * ko, 1.0); p.setPathEffect(skia.DashPathEffect.Make([6.0, 6.0], 0.0))
            c.drawRect(skia.Rect.MakeXYWH(PX0, PY0, O.CONTRACT_W * s, O.CONTRACT_H * s), p)
        # settled and waiting pieces (cached), then the moving ones, lifted, on top
        states = tuple(state(key, T) for key in ORDER)
        c.drawImage(still_image(states), 0, 0, SAMP)
        for key, st in zip(ORDER, states):
            if st == 1:
                x, y, r, lift, k = pose(key, T)
                draw_piece(c, plan[key]['idx'], s, x, y, r, lift)
        # forensic furniture
        O.evidence_tag(c, 110, 120, 1, '碎纸片', '张朝阳书桌垃圾桶', a=smooth((t - 0.4) / 0.6))
        _ruler(c, PX0 - 30 - 5 * O.CONTRACT_W * s / 21.0, PY0 + O.CONTRACT_H * s - 4, s, smooth((t - 0.8) / 0.6))
        O.event_log(c, 1290, 200, notes, T, maxw=560)
        # the two lines that can be read, transcribed in the margin
        LY = O.contract_layout(s)
        for n, (k_, label) in enumerate(((3, '借款人：张朝阳'), (5, '借款金额：陆仟元整'))):
            ta = t_keys_lock + n * 1.1
            if T < ta:
                continue
            u = smooth((T - ta) / 0.5)
            by = PY0 + LY['ys'][k_]
            gy = by - 6 * s
            x_txt = PX0 + LY['mx'] - 10
            line(c, x_txt, gy + 9, x_txt, gy - 17, A_INK, 0.9 * u, 1.4)
            line(c, PX0 - 40 - 110 * (1 - u), gy - 4, x_txt - 6, gy - 4, A_INK, 0.6 * u, 1.0)
            chars = int((T - ta) * 16)
            text(c, label[:chars], PX0 - 52, by, 'sans-light', 27, A_INK, u, 'right', tracking=0.05)
    sc.layer(insert, t_ins - 0.25, None, fin=0.3, fout=0.4, name='insert')
    sc.at(t_keys_lock + 2.4)

    sc.say('chen', '校园贷。', speed=0.84, post=1.0)
    sc.say('li', '六千……他哪来的胆子借校园贷？', tts='六千，他哪来的胆子借校园贷？', variant=1, post=1.0)
    sc.say('chen', '你忘了吗。', speed=0.84, post=0.35)
    sc.say('chen', '他那天出去之后，第二天就换了新手机。', post=0.3)
    sc.say('chen', '你还问他哪来的钱，他说家里寄的。', post=1.1)
    sc.say('li', '他家……那条件……', tts='他家，那条件。', speed=0.9, post=1.0)
    sc.say('chen', '他家那条件你心里清楚。', post=0.35)
    sc.say('chen', '六千块对他来说不是一笔小钱。是三四个月的生活费。', post=0.8)
    t_back = sc.t - 0.2
    for ly in sc.layers:
        if ly.name == 'insert':
            ly.end = t_back + 0.4

    # ---------- back to the plan: that night ----------
    sc.say('chen', '他为什么非得在那天晚上出去借？', post=1.0)
    M.say_log(sc.t - 0.3, '08:36', '李浩然没有说话。')
    sc.wait(2.6)
    sc.say('chen', '那天晚上你说了什么？', speed=0.95, post=0.6)
    t_g = sc.t - 0.4
    # the reconstruction, dashed: Li at his desk (the game), Chen on the upper bunk, Zhang at his desk
    M.dim.append((t_g, 10 ** 6, 0.62))
    M.say_log(t_g + 0.6, '08:36', '李浩然还是没有说话。')
    sc.wait(3.4)
    sc.say('chen', '你说，天天馒头就咸菜的，要不是我们请他，还不知道过的什么日子。', speed=0.95, post=1.2)
    t_out = sc.t
    sc.say('chen', '他出去的时候手里攥着一张名片。', speed=0.95, post=0.3)
    t_walk0 = t_out + 0.3
    zpath = [(t_walk0, 'zhang_desk'), (t_walk0 + 2.2, (3.05, 5.9)), (t_walk0 + 3.6, 'door'), (t_walk0 + 4.6, (3.35, 7.45))]
    M.ghosts.append((t_g, 10 ** 6, '李', [(t_g, 'li_desk')], True))
    M.ghosts.append((t_g + 0.5, 10 ** 6, '陈', [(t_g, 'chen_bed')], True))
    M.ghosts.append((t_g + 1.0, t_walk0 + 4.9, '张', zpath, True))
    sc.sfx(sfx.door('open', 331), at=t_walk0 + 3.5, gain=-20, pan=0.5)
    sc.sfx(sfx.door('close', 332), at=t_walk0 + 4.9, gain=-20, pan=0.5)
    sc.wait(5.2)
    M.say_log(sc.t, '08:37', '长久的沉默。')
    t_sil = sc.t
    # the reconstruction fades; the two of them come back into the room
    M.ghosts = [(g[0], min(g[1], t_sil + 2.5), g[2], g[3], g[4]) for g in M.ghosts]
    M.dim = [(t_g, t_sil + 2.5, 0.62)]
    sc.wait(6.0)
    sc.say('li', '……是我逼他去的？', tts='是我逼他去的？', note='声音很低', speed=0.86, gain=-3, post=1.6)
    sc.say('chen', '我不知道。', speed=0.84, post=0.5)
    sc.say('chen', '也许不全是。', speed=0.84, post=0.7)
    sc.say('chen', '但你是最后一根稻草里的一根。', speed=0.92, post=0.4)
    sc.wait(2.6)

    def master(c, t, L):
        M.draw(c, L.T, L.w, L.h)
    sc.layer(master, t_master, t_ins + 0.3, fin=0.6, fout=0.25)
    sc.layer(master, t_back, None, fin=0.35, fout=1.4)
    sc.amb(sfx.drone(40, 48.0, 333), t_g - 1.0, sc.t + 1.5, gain=-19)
    sc.finish(tail=1.2)
    return sc

def _ruler(c, x, y, s, a):
    """Forensic photo scale: 5 cm, ticks every cm (A4 page = 21 cm)."""
    if a <= 0:
        return
    cm = O.CONTRACT_W * s / 21.0
    line(c, x, y, x + 5 * cm, y, A_INK, a * 0.8, 1.2)
    for k in range(6):
        hh = 10 if k in (0, 5) else 6
        line(c, x + k * cm, y, x + k * cm, y - hh, A_INK, a * 0.8, 1.0)
    text(c, '0', x - 3, y + 20, 'sans-light', 13, A_MID, a)
    text(c, '5 cm', x + 5 * cm - 10, y + 20, 'sans-light', 13, A_MID, a)

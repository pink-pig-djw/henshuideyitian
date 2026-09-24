"""第十二场【循环】 内景 宿舍 日 — the fifteenth morning of 5月9日.
Li doesn't look at the phone. He sits on the edge of the bed, hands clasped. The confrontation,
line by line, on the fixed plan. The siren stops. A thin line of light falls across the empty desk.
「实话。」"""
import math, functools
import numpy as np
import skia
from film.config import *
from film.gfx import *
from film.timeline import Scene
from film import objects as O, sfx
from film.audio import lowpass, bandpass, highpass, env_fade

LOOP = 15
PX, PY, PS = 200, 120, 1.0          # floor-plan placement (the fixed camera of the A line)
RX = 1010                           # right column
SAMP = skia.SamplingOptions(skia.FilterMode.kLinear, skia.MipmapMode.kLinear)
SUN = (224, 164, 84)                # the morning through the curtain gap
LI_EDGE = (0.9, 2.25)               # Li on the edge of the lower bunk

# =====================================================================
# cached backgrounds
# =====================================================================
@functools.lru_cache(maxsize=1)
def _plan_image():
    surf = skia.Surface(W, H)
    c = surf.getCanvas()
    O.a_background(c, W, H)
    O.floorplan(c, PX, PY, PS, empty_alpha=0.55)
    return surf.makeImageSnapshot().withDefaultMipmaps()

def dot(c, x, y, label, a=1.0, rgb=A_INK, r=9, ring=0.0):
    c.drawCircle(x, y, r, paint(rgb, a))
    if ring > 0:
        c.drawCircle(x, y, r + 8 + 22 * ring, paint(rgb, a * (1 - ring) * 0.6, 1.2))
    text(c, label, x + r + 8, y + 7, 'sans-medium', 18, rgb, a, tracking=0.1)

# =====================================================================
# the event log, scrolling inside a region that may shrink (O.event_log look)
# =====================================================================
def _entry_h(s, size, maxw):
    return len(wrap(s, 'sans-light', size, maxw - 110)) * size * 1.5 + size * 0.7

def scroll_log(c, x, y, entries, T, maxy, maxw=780, size=25, cps=22.0, a=1.0):
    shown = [e for e in entries if e[0] <= T]
    if not shown:
        return
    avail = maxy - y
    hs = [_entry_h(e[2], size, maxw) for e in shown]
    off_now = max(0.0, sum(hs) - avail)
    off_prev = max(0.0, sum(hs[:-1]) - avail)
    off = off_prev + (off_now - off_prev) * ease_in_out((T - shown[-1][0]) / 0.8)
    c.save()
    c.clipRect(skia.Rect(x - 10, y - size * 1.3, x + maxw + 60, maxy + size * 0.4))
    yy = y - off
    n = len(shown)
    for i, (ta, stamp, s) in enumerate(shown):
        age = n - 1 - i
        k = 1.0 if age == 0 else max(0.35, 0.75 - 0.12 * age)
        lines = wrap(s, 'sans-light', size, maxw - 110)
        if yy + len(lines) * size * 1.5 > y - size * 1.4:
            chars = int((T - ta) * cps)
            top = clamp((yy - (y - size * 1.4)) / (size * 1.4))
            text(c, stamp, x, yy, 'sans-medium', size * 0.72, A_MID, a * top * k * smooth((T - ta) / 0.3), tracking=0.15)
            used = 0
            for j, ln in enumerate(lines):
                vis = ln[:max(0, chars - used)]; used += len(ln)
                ly = yy + j * size * 1.5
                aa = clamp((ly - (y - size * 1.4)) / (size * 1.4))
                text(c, vis, x + 110, ly, 'sans-light', size, A_INK, a * k * aa)
        yy += len(lines) * size * 1.5 + size * 0.7
    c.restore()

# =====================================================================
# the master
# =====================================================================
class Master:
    def __init__(self, loop, home):
        self.loop = loop
        self.log = []
        self.home = dict(home)
        self.moves = []
        self.ghosts = []                # (t_in, t_out, label, [(t, spot)])
        self.legend = None              # (t_in, t_out, text)
        self.rings = []                 # (t, who)
        self.t_siren = None
        self.t_quiet = None             # the siren marker leaves
        self.t_light = None             # the line of light across the desk
        self.tags = []                  # (t, no, title)
        self.t_tags = None
        self.counter_from = None

    def add(self, t, stamp, s):
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

    def draw_light(self, c, T):
        """Morning through the curtain gap: a faint trace from the window, a warm line on the desk."""
        k = smooth((T - self.t_light) / 3.5)
        if k <= 0:
            return
        m = 100 * PS
        gx, gy = PX + 2.78 * m, PY + 0.03 * m               # the gap in the curtain
        d0 = (PX + 3.27 * m, PY + 3.62 * m)                 # where the line enters the desk ...
        d1 = (PX + 3.93 * m, PY + 4.52 * m)                 # ... and leaves it
        # faint wedge across the floor
        p = skia.Path(); p.moveTo(gx - 3, gy); p.lineTo(gx + 3, gy); p.lineTo(d1[0], d1[1]); p.lineTo(d0[0], d0[1]); p.close()
        sh = skia.GradientShader.MakeLinear([(gx, gy), ((d0[0] + d1[0]) / 2, (d0[1] + d1[1]) / 2)],
                                            [col(SUN, 0.02 * k), col(SUN, 0.10 * k)], [0, 1])
        c.drawPath(p, skia.Paint(Shader=sh, AntiAlias=True))
        # the line itself, on the desk
        c.save()
        c.clipRect(skia.Rect.MakeLTRB(PX + 3.25 * m, PY + 3.4 * m, PX + 3.95 * m, PY + 4.7 * m))
        glow_p = paint(SUN, 0.35 * k, 14); glow_p.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 8))
        c.drawLine(d0[0] - 30, d0[1] - 41, d1[0] + 30, d1[1] + 41, glow_p)
        c.drawLine(d0[0] - 30, d0[1] - 41, d1[0] + 30, d1[1] + 41, paint(SUN, 0.9 * k, 3.2))
        c.restore()
        # the thin trace from the window, very faint
        c.drawLine(gx, gy + 4, d0[0] + 3, d0[1] - 2, paint(SUN, 0.28 * k, 1.1))
        c.drawCircle(gx, gy - 1, 3, paint(SUN, 0.8 * k))

    def draw(self, c, T, w, h):
        c.drawImage(_plan_image(), 0, 0, SAMP)
        if self.t_light is not None:
            self.draw_light(c, T)
        zx, zy = O.plan_xy(PX, PY, PS, 'zhang_desk')
        gh = max([self._ghost_alpha(g, T) for g in self.ghosts if g[2] == '张'] or [0.0])
        text(c, '空', zx - 8, zy + 7, 'sans-light', 16, A_MID, 0.8 * (1 - 0.6 * gh))
        # siren marker: comes as every loop; later it is simply not there any more
        if self.t_siren is not None and T > self.t_siren:
            k = T - self.t_siren
            wx, wy = O.plan_xy(PX, PY, PS, 'window')
            ring = (k * 0.8) % 1.0
            aa = min(1.0, k / 1.5) * (1.0 if k < 9 else max(0.25, 1 - (k - 9) / 3))
            if self.t_quiet is not None:
                aa *= 1 - smooth((T - self.t_quiet) / 2.5)
            if aa > 0.003:
                c.drawCircle(wx + 120, wy - 60, 6, paint(A_INK, aa))
                c.drawCircle(wx + 120, wy - 60, 6 + 30 * ring, paint(A_INK, aa * (1 - ring) * 0.5, 1.2))
                text(c, '楼下 · 警车', wx + 140, wy - 54, 'sans-light', 17, A_MID, aa, tracking=0.2)
        self._draw_ghosts(c, T)
        for who in ('李', '陈'):
            x, y = self.spot_at(who, T)
            ring = 0.0
            for (tr, w_) in self.rings:
                if w_ == who and 0 < T - tr < 1.6:
                    ring = (T - tr) / 1.6
            dot(c, x, y, who, ring=ring)
        stamp = [e[1] for e in self.log if e[0] <= T]
        O.clock_card(c, RX, 210, 1.0, time=stamp[-1] if stamp else '08:30')
        if self.counter_from is not None:
            k = smooth((T - self.counter_from) / 0.5)
            if k < 1:
                O.loop_counter(c, 1620, 150, self.loop - 1, 1 - k)
            if k > 0:
                O.loop_counter(c, 1620, 150, self.loop, k)
        maxy = 800
        if self.t_tags is not None:
            maxy = 800 - 170 * smooth((T - self.t_tags + 1.0) / 0.9)
        scroll_log(c, RX, 420, self.log, T, maxy, maxw=780)
        for (tt, no, title) in self.tags:
            k = smooth((T - tt) / 0.5)
            if k > 0:
                O.evidence_tag(c, RX, 700 + (no - 1) * 48, no, title, a=k)

    # ---- ghosts: the reconstruction of 5月8日, afternoon ----
    def _ghost_alpha(self, g, T):
        return min(smooth((T - g[0]) / 1.0), smooth((g[1] - T) / 1.2))

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
        for g in self.ghosts:
            a = self._ghost_alpha(g, T)
            if a <= 0:
                continue
            (x, y), _ = self._ghost_xy(g[3], T)
            p = paint(A_INK, 0.85 * a, 1.5); p.setPathEffect(skia.DashPathEffect.Make([3.0, 3.0], 0.0))
            c.drawCircle(x, y, 10, p)
            if g[2] == '张':
                text(c, g[2], x - 26, y + 7, 'sans-light', 18, A_MID, a, 'right', tracking=0.1)
            else:
                text(c, g[2], x + 30, y + 7, 'sans-light', 18, A_MID, a, tracking=0.1)
        if self.legend is not None:
            t0, t1, s = self.legend
            a = min(smooth((T - t0) / 1.0), smooth((t1 - T) / 1.2))
            if a > 0:
                lx, ly = PX + 196, PY + 720 + 58
                p = paint(A_INK, 0.8 * a, 1.3); p.setPathEffect(skia.DashPathEffect.Make([3.0, 3.0], 0.0))
                c.drawCircle(lx, ly - 5, 7, p)
                text(c, s, lx + 16, ly + 1, 'sans-light', 15, A_MID, a, tracking=0.2)

# =====================================================================
# sounds
# =====================================================================
def _tt(d):
    return np.arange(int(d * SR)) / SR

def outside(d, seed=1201):
    """Morning outside the window once the siren is gone: far murmur, a few birds. Stereo, quiet."""
    x = sfx.campus(d, seed)
    return lowpass(x, 3800) * 0.8

def bed_creak(seed=1210, d=0.6):
    rng = np.random.default_rng(seed)
    t = _tt(d)
    f = 180 + 90 * np.sin(np.pi * t / d)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * (rng.random(len(t)) < 0.22) * 0.12
    return (lowpass(x.astype(np.float32), 1800) * np.sin(np.pi * t / d)).astype(np.float32)

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
    sc = Scene('s12_loop', kind='A', title='第十二场【循环】')
    M = Master(LOOP, {'李': 'li_bed', '陈': 'chen_bed'})

    # ---------- the ritual, short ----------
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
    M.add(t_master + 1.8, '08:30', '这一次李浩然醒过来之后，没有看手机。')
    M.t_siren = t_master + 1.2
    sc.sfx(sfx.siren(9.0), at=M.t_siren, gain=-13)
    M.moves.append((t_master + 3.6, t_master + 4.8, '李', 'li_bed', LI_EDGE))
    sc.sfx(bed_creak(1211), at=t_master + 3.7, gain=-12, pan=-0.4)
    M.add(t_master + 4.4, '08:30', '他坐在床沿上，两只手交握，低着头。')
    M.add(t_master + 7.4, '08:31', '警笛。同一个位置。')
    sc.wait(9.6)

    # ---------- 你想起来了？ ----------
    say_word(sc, 'chen', '你想起来了？', '你想起来了？是不是？', speed=0.95, pan=-0.2, post=1.1)
    t = sc.t
    sc.say('li', '我一直都记得。每一次循环我都记得。', speed=0.9, pan=-0.3, post=0.6)
    s2, e2 = sc.say('li', '他来找过我。我在打游戏。', speed=0.88, pan=-0.3, post=0.55)
    # the reconstruction: that afternoon, the door
    t_g = s2 + 0.8
    M.legend = [t_g, None, '5月8日 下午 · 重建']
    s3, e3 = sc.say('li', '他说“哥，我想跟你说个事”。我说没看到我正忙着。', tts='他说，哥，我想跟你说个事。我说没看到我正忙着。',
                    speed=0.9, pan=-0.3, post=0.9)
    say_word(sc, 'chen', '然后呢？', '然后呢？后来呢？', speed=0.95, pan=-0.2, post=0.7)
    s5, e5 = sc.say('li', '然后他走了。我让他帮我带份饭。', speed=0.88, pan=-0.3, post=0.6)
    door, step = (3.35, 7.08), (3.28, 6.52)
    M.ghosts.append((t_g, e5 + 1.2, '张', [(t_g, door), (s3 + 0.3, door), (s3 + 1.6, step), (s5 + 0.3, step), (s5 + 1.4, door)]))
    M.ghosts.append((t_g + 0.3, e5 + 2.4, '李', [(t_g, 'li_desk')]))
    M.legend[1] = e5 + 2.4
    M.legend = tuple(M.legend)
    M.add(sc.t + 0.2, '08:32', '陈杰辉没有说话。')
    sc.wait(2.6)

    sc.say('li', '那是他最后一次跟人说话。第二天早上他就死了。', speed=0.9, pan=-0.3, post=0.55)
    sc.say('li', '他最后一次开口求助，对象是我。', speed=0.88, pan=-0.3, post=0.6, variant=1)
    sc.say('li', '我让他帮我带份饭。', speed=0.84, pan=-0.3, post=0.6)
    M.add(sc.t, '08:33', '长久的沉默。')
    sc.wait(4.6)

    # ---------- the punishment ----------
    sc.say('li', '你说循环是惩罚。你说得对。', tts='你说循环是惩罚。你说的对。', speed=0.9, pan=-0.3, post=0.5)
    sc.say('li', '十五次了——每次醒过来第一件事是听到警笛。每次都是他已经死了。', speed=0.92, pan=-0.3, post=0.4)
    sc.say('li', '每次我都知道他死之前来找过我，而我连头都没有回。', speed=0.9, pan=-0.3, post=1.5)
    sc.say('chen', '不只是你。', speed=0.9, pan=-0.2, post=0.6)
    sc.say('li', '什么？', speed=0.95, pan=-0.3, post=0.7)
    sc.say('chen', '不只是门口那一次。', speed=0.95, pan=-0.2, post=0.4)
    sc.say('chen', '你想想——你说他“天天馒头就咸菜的”，他当晚就去借了校园贷。',
           tts='你想想，你说他天天馒头就咸菜的，他当晚就去借了校园贷。', speed=0.97, pan=-0.2, post=0.5, variant=2)
    sc.say('chen', '你说他“估计是玉玉了”，然后出门上课，门一关。', tts='你说他估计是玉玉了，然后出门上课，门一关。',
           speed=0.97, pan=-0.2, post=0.6)
    sc.say('chen', '他每天在我们身边，瘦了一圈，不吃饭，不上课，不洗澡，不说话——', speed=0.95, pan=-0.2, post=0.35)
    sc.say('chen', '我们看见了所有的症状，没有问过一次“你怎么了”。', tts='我们看见了所有的症状，没有问过一次，你怎么了。',
           speed=0.93, pan=-0.2, post=1.2)
    sc.say('li', '我不知道……', speed=0.8, pan=-0.3, post=0.6)
    sc.say('chen', '你知道。你不是不知道。你是觉得不关你的事。', speed=0.95, pan=-0.2, post=1.4)
    sc.say('li', '那你呢？', speed=0.9, pan=-0.3, post=0.3)
    M.rings.append((sc.t + 0.1, '陈'))
    M.add(sc.t + 0.1, '08:37', '陈杰辉愣了一下。')
    sc.wait(1.8)
    sc.say('li', '你呢？你不也在吗？', speed=1.0, pan=-0.3, post=0.45)
    sc.say('li', '你听见我说那些话的时候，你皱了皱眉，然后呢？', speed=1.0, pan=-0.3, post=0.4)
    sc.say('li', '然后你转过头去看你的视频了。', speed=0.98, pan=-0.3, post=0.6)
    sc.say('li', '你觉得你替他打过几次圆场，你就不是旁观者了？', speed=1.0, pan=-0.3, post=0.6)
    sc.say('li', '你和我的区别只是——我推了他一把，你站在旁边看着。', speed=0.9, pan=-0.3, post=0.8)
    M.add(sc.t, '08:38', '陈杰辉张了张嘴。没有反驳。因为李浩然说的是对的。')
    sc.wait(4.2)
    sc.say('li', '循环不是只惩罚我的。是惩罚我们两个的。', speed=0.9, pan=-0.3, post=0.5)
    M.add(sc.t, '08:39', '陈杰辉很久没有开口。')
    sc.wait(3.6)
    say_word(sc, 'chen', '是。', '是。我也有份。', speed=0.85, pan=-0.2, post=1.6, sub_text='……是。')

    # ---------- the one he came to ----------
    sc.say('li', '肖强该坐牢。', tts='萧强该坐牢。', speed=0.92, pan=-0.3, post=0.45)
    sc.say('li', '但他最后来求的人不是肖强，是我。', tts='但他最后来求的人不是萧强，是我。', speed=0.9, pan=-0.3, post=0.5)
    sc.say('li', '连那个逼他还钱的人他都没去求，他来求我了。', speed=0.9, pan=-0.3, post=0.6)
    sc.say('li', '我说，没看到我正忙着。', speed=0.84, pan=-0.3, post=1.0)

    # ---------- quiet: the siren is gone; light on the desk ----------
    t_q = sc.t
    M.t_quiet = t_q
    M.add(t_q, '08:41', '安静了很长时间。外面的警笛声已经停了。')
    M.t_light = t_q + 1.6
    M.add(t_q + 2.4, '08:41', '宿舍里的光从窗帘缝里透进来，照在张朝阳空荡荡的桌面上。')
    sc.amb(outside(40, 1202), t_q + 1.0, None, gain=-12, fin=4.0)
    sc.wait(6.4)

    # ---------- the evidence ----------
    s, e = sc.say('li', '东西都在。合同，日记，他的银行转账记录。', speed=0.92, pan=-0.3, post=0.45)
    d = e - s
    M.t_tags = s
    M.tags = [(s + d * 0.30, 1, '合同（拼合）'), (s + d * 0.50, 2, '日记（恢复的文件）'), (s + d * 0.78, 3, '银行转账记录')]
    for k, (tt, _, _) in enumerate(M.tags):
        sc.sfx(sfx.paper_rustle(1220 + k, 0.35), at=tt, gain=-18)
    sc.say('li', '去派出所吧。', speed=0.9, pan=-0.3, post=0.8)
    say_word(sc, 'chen', '好。', '好。我们一起去。', speed=0.95, pan=-0.2, post=1.3)
    sc.say('li', '还有一件事。如果明天真的来了——', speed=0.9, pan=-0.3, post=0.5)
    sc.say('chen', '什么？', speed=0.85, pan=-0.2, post=0.9)
    sc.say('li', '他爸还在工地上班。他妈还在吃药。', speed=0.9, pan=-0.3, post=0.6)
    sc.say('li', '我得去一趟。', tts='我总得去一趟。', speed=0.9, pan=-0.3, post=1.2)
    sc.say('chen', '你去说什么？', speed=0.92, pan=-0.2, post=1.4)
    sc.say('li', '实话。', speed=0.85, pan=-0.3, post=1.0)
    sc.wait(4.4)

    def master(c, t, L):
        M.draw(c, L.T, L.w, L.h)
    sc.layer(master, t_master, None, fin=0.5, fout=1.6)
    sc.finish(tail=0.8)
    return sc

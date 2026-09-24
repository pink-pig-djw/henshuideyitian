"""第九场【倒计时】 内景 宿舍 夜 — 距自杀还有 14 天.

Two a.m. One roommate snores, the other turns over. He is awake. The sentences other people
said come back in their own voices and write themselves on the dark wall, over and over, until
they smear into one sentence. He faces the empty wall until it grows light. Morning: the joke
about 「玉玉」, the door, the blanket that does not move. His eyes are open."""
import math, functools
import numpy as np
import skia
from film.config import *
from film.gfx import *
from film.timeline import Scene
from film.sketch import Drawing, smudge, _tooth
from film.audio import reverb, lowpass, highpass, bandpass, env_fade
from film import objects as O, sfx
from film import voice as V

DAY = 14
PAPER = O.b_paper(DAY)
STREET = (178, 196, 228)       # the cold streetlight through the window
DAWN = (226, 228, 232)
CHALK = (196, 198, 200)        # graphite catching the light on a dark wall


def _tt(d):
    return np.arange(int(d * SR)) / SR


# =====================================================================
# drawings
# =====================================================================
@functools.lru_cache(maxsize=1)
def night_room():
    """The dorm at two in the morning: bunk bed (Li below, Chen above), the window, Zhang's bed."""
    d = Drawing(seed=1401, width=1.8, alpha=0.8)
    d.line(-10, 905, 1450, 898, w=1.2, a=0.5)                      # floor line
    # bunk bed (left)
    for x in (40, 620):
        d.line(x, 110, x + 2, 905, w=2.0); d.line(x + 16, 110, x + 18, 905, w=1.2, a=0.6)
    d.line(40, 360, 636, 356, w=2.0); d.line(40, 392, 636, 388, w=1.6)
    d.line(40, 730, 636, 726, w=2.0); d.line(40, 764, 636, 760, w=1.6)
    d.line(40, 180, 636, 176, w=1.4, a=0.7)                        # upper guard rail
    for k in range(5):                                             # ladder
        d.line(560, 420 + k * 90, 620, 420 + k * 90, w=1.3, a=0.7)
    d.line(560, 400, 562, 905, w=1.4, a=0.7)
    # Li, lower bunk: a mound under the blanket
    li = [(70, 728), (110, 660), (210, 626), (330, 640), (420, 612), (520, 646), (600, 700), (612, 728)]
    d.curve(li, w=1.8)
    d.hatch([(80, 726), (120, 668), (330, 646), (520, 652), (600, 724)], angle=20, spacing=12, a=0.3)
    d.ellipse(140, 690, 44, 24, w=1.2, a=0.6)                      # pillow
    # Chen, upper bunk
    ch = [(70, 356), (130, 300), (250, 286), (360, 300), (470, 280), (560, 316), (612, 356)]
    d.curve(ch, w=1.8)
    d.hatch([(80, 354), (140, 306), (360, 306), (560, 322), (606, 354)], angle=-20, spacing=12, a=0.3)
    # the window (centre)
    d.rect(700, 90, 330, 330, w=2.0); d.rect(714, 104, 302, 302, w=1.1, a=0.6)
    d.line(865, 104, 865, 406, w=1.6); d.line(714, 230, 1016, 230, w=1.6)
    d.line(690, 432, 1040, 428, w=1.6)                             # sill
    # Zhang's bed (right) and the long shape of him, turned to the wall
    d.line(1000, 700, 1450, 694, w=2.0); d.line(1000, 740, 1450, 734, w=1.6)
    d.line(1004, 740, 1006, 905, w=1.8)
    zh = [(1030, 700), (1070, 640), (1150, 610), (1250, 628), (1330, 600), (1420, 630), (1450, 660)]
    d.curve(zh, w=1.8)
    d.hatch([(1040, 698), (1080, 648), (1250, 634), (1420, 640), (1450, 690)], angle=15, spacing=12, a=0.3)
    d.line(1400, 150, 1404, 612, w=1.2, a=0.4)                     # the corner: the wall he faces
    return d


def wall_light(c, k_dawn=0.0, a=1.0):
    """The window's light thrown on the wall: a skewed pane with the cross of the frame.
    Streetlight blue at night; at dawn a pale warm pane that slowly slides."""
    dx = -120 * k_dawn
    quad = [(250 + dx, 150), (1210 + dx, 96), (1260 + dx, 760), (210 + dx, 820)]
    rgb = mix(STREET, (250, 238, 214), k_dawn)
    smudge(c, quad, rgb, (0.12 + 0.30 * k_dawn) * a, 40 - 16 * k_dawn)
    # the window bars' shadow
    for (p, q) in (((730, 124), (735, 790)), ((230, 470), (1236, 426))):
        pth = skia.Path(); pth.moveTo(p[0] + dx, p[1]); pth.lineTo(q[0] + dx, q[1])
        pp = paint(mix(NIGHT, GRAPHITE, k_dawn), (0.20 - 0.08 * k_dawn) * a, 26 - 6 * k_dawn)
        pp.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 10 - 3 * k_dawn))
        c.drawPath(pth, pp)


@functools.lru_cache(maxsize=1)
def morning_room():
    """Morning, the same room seen low: his bed (right), the blanket over everything; his shoes
    under the bed; the bunk post (left)."""
    d = Drawing(seed=1402, width=1.8, alpha=0.8)
    d.line(-10, 900, 1450, 894, w=1.3, a=0.55)                     # floor line
    d.line(1386, -10, 1392, 900, w=1.2, a=0.45)                    # corner
    # bunk post and ladder at the far left
    d.line(96, -10, 98, 900, w=2.0); d.line(116, -10, 118, 900, w=1.2, a=0.6)
    for k in range(4):
        d.line(-10, 120 + k * 150, 96, 118 + k * 150, w=1.3, a=0.6)
    d.line(-10, 560, 96, 560, w=1.8)
    # his bed
    d.line(560, 600, 1450, 590, w=2.0)
    d.line(560, 600, 560, 720, w=1.8); d.line(560, 720, 1450, 712, w=1.8)
    d.line(580, 720, 582, 895, w=1.8); d.line(1360, 714, 1362, 892, w=1.8)
    d.hatch([(590, 724), (1350, 716), (1352, 890), (592, 892)], angle=0, spacing=10, a=0.22)
    # pillow (right end) and the blanket covering him completely, head and all
    d.curve([(1180, 600), (1200, 548), (1300, 536), (1386, 560), (1392, 600)], w=1.5, a=0.7)
    mound = [(590, 604), (640, 540), (760, 470), (880, 452), (990, 470), (1070, 430), (1170, 420),
             (1270, 450), (1350, 500), (1392, 560), (1400, 604)]
    d.fill(mound + [(1400, 606), (590, 606)], mix(PAPER, (255, 255, 255), 0.25), 1.0, smooth=False)
    d.curve(mound, w=2.0)
    # folds
    d.curve([(700, 560), (800, 510), (900, 520), (1000, 500)], w=1.1, a=0.5)
    d.curve([(1050, 470), (1120, 500), (1180, 540), (1230, 596)], w=1.1, a=0.5)
    d.curve([(1250, 470), (1300, 520), (1320, 596)], w=1.0, a=0.45)
    d.hatch([(600, 600), (650, 548), (760, 484), (880, 466), (980, 484), (1000, 600)], angle=35, spacing=11, a=0.2)
    # the blanket hanging over the side of the bed
    hang = [(560, 600), (1400, 596), (1400, 660), (1300, 672), (1180, 656), (1040, 678), (900, 662), (760, 680), (620, 664), (560, 670)]
    d.fill(hang, mix(PAPER, (255, 255, 255), 0.25), 1.0)
    d.curve([(560, 670), (620, 664), (760, 680), (900, 662), (1040, 678), (1180, 656), (1300, 672), (1400, 660)], w=1.6)
    for x in (700, 860, 1010, 1160, 1310):
        d.curve([(x, 606), (x + 6, 640), (x - 4, 668)], w=0.9, a=0.4, passes=1)
    return d


@functools.lru_cache(maxsize=1)
def aj_shoe():
    """Li's new high-tops: chunky sole, padded collar, a bold side curve (no brand)."""
    d = Drawing(seed=1403, width=2.0, alpha=0.85)
    sole = [(0, 0), (330, 0), (340, -30), (330, -46), (0, -46), (-8, -24)]
    body = [(-4, -46), (0, -150), (30, -200), (110, -205), (140, -160), (200, -118), (290, -96), (334, -70), (336, -46)]
    d.fill(sole + [(336, -46)] + body[::-1], mix(PAPER, (255, 255, 255), 0.35), 1.0)
    d.poly(sole, closed=True, w=2.2)
    d.curve(body, w=2.2)
    d.line(0, -24, 334, -24, w=1.2, a=0.6)
    d.curve([(20, -60), (110, -120), (200, -80), (300, -64)], w=2.4)          # the side curve
    d.curve([(10, -190), (50, -220), (100, -214), (120, -196)], w=1.6)        # padded collar
    for j in range(6):
        d.line(140 + j * 14, -150 + j * 7, 160 + j * 14, -140 + j * 7, w=1.2)
    d.hatch([(8, -48), (120, -48), (120, -150), (30, -190), (6, -150)], angle=60, spacing=8, a=0.35)
    return d


@functools.lru_cache(maxsize=1)
def blanket_close():
    """Close, at the head of the bed: the quilt pulled over his head, a little hair on the pillow,
    the wall he faces. Nothing moves."""
    d = Drawing(seed=1404, width=1.9, alpha=0.82)
    SHEET = mix(PAPER, (255, 255, 255), 0.28)
    # the corner of the room
    d.line(1330, -10, 1336, 760, w=1.3, a=0.5)
    # pillow
    pil = [(800, 640), (810, 540), (860, 488), (1000, 470), (1180, 468), (1300, 486), (1340, 540), (1336, 640), (1300, 668), (840, 672)]
    d.fill(pil, SHEET, 1.0, smooth=True)
    d.curve(pil + [pil[0]], w=1.7)
    d.curve([(830, 600), (1000, 586), (1180, 584), (1320, 598)], w=0.9, a=0.35)
    # mattress edge and the underside of the bed
    d.line(-10, 790, 1450, 782, w=1.8)
    d.hatch([(0, 930), (1440, 924), (1440, 1080), (0, 1080)], angle=0, spacing=9, a=0.28)
    # a little of his hair on the pillow, where the quilt ends
    rng = np.random.default_rng(14041)
    for k in range(22):
        x0 = 1146 + k * 4.2 + rng.normal(0, 2)
        y0 = 528 + rng.normal(0, 4)
        d.curve([(x0, y0), (x0 + 14 + rng.normal(0, 4), y0 - 16 + rng.normal(0, 4)), (x0 + 30 + rng.normal(0, 6), y0 - 22 + rng.normal(0, 5))],
                w=0.9, a=0.6, passes=1, wobble=0.6)
    # the quilt: over the head, the shoulder, the hip, the legs; hanging over the edge
    top = [(-10, 560), (120, 520), (260, 452), (380, 448), (500, 506), (620, 470), (740, 400), (860, 380),
           (980, 386), (1080, 420), (1150, 470), (1170, 530), (1190, 600), (1260, 660), (1330, 700)]
    hang = [(1336, 700), (1340, 800), (1300, 900), (1180, 880), (1040, 910), (880, 886), (720, 912),
            (560, 884), (400, 914), (240, 888), (80, 908), (-10, 896)]
    d.fill(top + hang, SHEET, 1.0, smooth=True)
    d.curve(top, w=2.2)
    d.curve(hang, w=1.8)
    # folds and the quilt's stitching
    d.curve([(760, 420), (860, 470), (920, 560), (930, 700), (900, 790)], w=1.2, a=0.55)
    d.curve([(400, 470), (440, 560), (430, 680), (400, 790)], w=1.1, a=0.5)
    d.curve([(1060, 440), (1080, 540), (1110, 660), (1180, 760)], w=1.0, a=0.45)
    d.curve([(160, 520), (180, 640), (150, 790)], w=1.0, a=0.45)
    for x in (140, 330, 520, 700, 880, 1060, 1230):
        d.curve([(x, 796), (x + 8, 840), (x - 4, 890)], w=0.9, a=0.4, passes=1)
    for row in range(3):
        pts = [(q[0], q[1] + 60 + row * 70) for q in top[1:-3]]
        d.curve(pts, w=0.8, a=0.28, passes=1)
    d.hatch([(620, 480), (740, 410), (860, 392), (920, 560), (930, 780), (640, 780)], angle=58, spacing=12, a=0.18)
    d.hatch([(1080, 430), (1150, 480), (1190, 610), (1260, 680), (1300, 780), (1100, 780)], angle=40, spacing=11, a=0.2)
    return d


# =====================================================================
# the sentences on the wall
# =====================================================================
S1 = '天天馒头就咸菜的。'
S2 = '你逃不掉的。'
S3 = '要不是我们请他，还不知道过的什么日子呢。'
S4 = '你不想让室友知道你借了高利贷吧？'
S5 = '你不配。'


def graphite_text(c, s, x, y, size, a, rot=0.0, smear=0.0, chars=None, font_='hand', rgb=CHALK):
    """Text 'written' on the wall: chalky graphite, can be smeared sideways and blurred."""
    if a <= 0.003:
        return
    if chars is not None:
        s = s[:max(0, int(chars))]
    if not s:
        return
    c.save()
    c.translate(x, y); c.rotate(rot)
    n = 1 + int(smear * 6)
    for k in range(n):
        p = paint(rgb, a * (1.0 if k == 0 else 0.55 * (1 - k / n)) * (1 - 0.6 * smear if k == 0 else 1))
        sig = 0.4 + smear * (3 + 5 * k)
        p.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, sig))
        text(c, s, k * smear * 26, k * smear * 3, font_, size, rgb, 1.0, p=p)
    c.restore()


# =====================================================================
# sounds
# =====================================================================
def snore(d, seed=901):
    """Li asleep: soft palate flutter on the in-breath, an airy out-breath."""
    rng = np.random.default_rng(seed)
    out = np.zeros(int(d * SR), np.float32)
    t = rng.uniform(0.3, 1.2)
    while t < d - 3.0:
        di = rng.uniform(1.0, 1.35); ti = _tt(di)
        f0 = rng.uniform(26, 34)
        flutter = lowpass((0.5 + 0.5 * np.sign(np.sin(2 * np.pi * f0 * ti))).astype(np.float32), 300)
        src = lowpass(sfx.noise(di, int(rng.integers(0, 1e6)), 'pink'), 1100)
        env = np.sin(np.pi * ti / di) ** 1.4
        x = bandpass(src * flutter * env, 80, 1400) * 0.9 + np.sin(2 * np.pi * f0 * 3 * ti) * env * 0.01
        s = int(t * SR); out[s:s + len(x)] += x[:len(out) - s]
        de = rng.uniform(0.9, 1.2); te = _tt(de)
        ex = bandpass(sfx.noise(de, int(rng.integers(0, 1e6))), 250, 1800) * np.sin(np.pi * te / de) ** 2 * 0.10
        s2 = int((t + di + 0.25) * SR); out[s2:s2 + len(ex)] += ex[:max(0, len(out) - s2)]
        t += di + 0.25 + de + rng.uniform(1.0, 1.8)
    out = reverb(out, wet=0.15, decay=0.5, size='room')
    return (out / (np.abs(out).max() + 1e-9) * 0.5).astype(np.float32)


def creak(seed=910, d=0.7, a=1.0):
    """Wooden bed frame: stick-slip creak."""
    rng = np.random.default_rng(seed)
    t = _tt(d)
    f = rng.uniform(22, 40) * (1 + 0.5 * np.sin(np.pi * t / d))
    ph = np.cumsum(f) / SR
    pulses = (np.diff(np.floor(ph), prepend=0) > 0).astype(np.float32)
    x = bandpass(pulses, 350, 2600) * np.sin(np.pi * t / d) ** 0.8
    x = x + bandpass(sfx.noise(d, seed), 500, 1500) * 0.03 * np.sin(np.pi * t / d)
    return (x * 0.6 * a).astype(np.float32)


def turn_over(seed=920, d=2.0, a=1.0):
    """Someone turning over under a quilt: fabric swish and the bed frame."""
    t = _tt(d)
    env = np.clip(np.sin(np.pi * t / d), 0, 1) ** 1.5
    cloth = lowpass(bandpass(sfx.noise(d, seed), 200, 3000), 2000) * env * 0.12
    out = cloth.astype(np.float32)
    c1 = creak(seed + 1, 0.6, 0.9); k = int(0.35 * d * SR)
    out[k:k + len(c1)] += c1[:len(out) - k]
    c2 = creak(seed + 2, 0.4, 0.5); k = int(0.7 * d * SR)
    out[k:k + len(c2)] += c2[:len(out) - k]
    return out * a


def shoe_on(seed=930):
    """A foot pushed into a sneaker: a soft thump and the laces pulled."""
    d = 0.9; t = _tt(d)
    thump = lowpass(sfx.noise(0.12, seed), 400) * np.exp(-_tt(0.12) * 30) * 0.6
    tug = bandpass(sfx.noise(0.3, seed + 1), 1500, 6000) * np.sin(np.pi * _tt(0.3) / 0.3) * 0.08
    out = np.zeros(len(t), np.float32)
    out[:len(thump)] += thump
    k = int(0.45 * SR); out[k:k + len(tug)] += tug
    return out


def inner_blur(y):
    """A remembered voice going under: darker, longer tail."""
    return reverb(lowpass(np.asarray(y, np.float32), 2600), wet=0.8, decay=3.2, size='hall', bright=2400)


# =====================================================================
def build():
    sc = Scene('s09_d14', kind='B', title='第九场【倒计时】')

    def reset(c, t, L):
        L.scene.sub_color = None
    sc.layer(reset, 0.0, None, z=-10)

    # ---------------- countdown card ----------------
    sc.wait(0.4)
    t0 = sc.t
    def card(c, t, L):
        O.b_background(c, DAY)
        O.countdown_card(c, DAY, t)
        c.drawRect(skia.Rect(0, 0, BW, H), paint(NIGHT, 0.7 * smooth((t - 3.6) / 1.4)))
    sc.layer(card, t0, t0 + 5.0, fin=0.8, fout=0.0)
    sc.sfx(sfx.pencil(3.0, 141), at=t0 + 0.6, gain=-9)
    sc.wait(5.0)

    # ---------------- two a.m. ----------------
    t_n = sc.t
    sc.amb(sfx.room_tone(200, 142, level=0.8), t_n - 0.5, None, gain=-8)
    sc.sfx(turn_over(144, 2.2), at=t_n + 5.2, gain=-8, pan=-0.3)

    sc.wait(1.6)
    sc.caption('夜里两点。', dur=3.0)
    sc.wait(6.4)
    sc.narr('张朝阳睁着眼睛。', post=1.2, speed=0.92)
    sc.narr('他已经很多天没有好好睡过了。', post=0.8)
    sc.narr('每次闭上眼睛，就会听见催收电话里的声音——', post=0.4)
    sc.narr('有时候是催收员的声音，有时候会变成另一个人的声音，说另一句话。', post=1.0)
    t_wall = sc.t

    def night(c, t, L):
        T = L.T
        L.scene.sub_color = WHITE
        O.b_background(c, DAY)
        c.drawRect(skia.Rect(0, 0, BW, H), paint(NIGHT, 0.84))
        glow(c, 865, 250, 560, STREET, 0.30)
        k = 1.0 + 0.24 * ease_in_out(ramp(T, t_n + 9, t_wall + 1))
        c.save()
        c.translate(1215, 640); c.scale(k, k); c.translate(-1215, -640)
        smudge(c, [(700, 440), (1030, 432), (1450, 905), (640, 905)], STREET, 0.10, 34)
        night_room().draw(c, 1.0, 0.62, tint=(150, 160, 176))
        c.restore()
        vignette(c, BW, H, 0.45)
    sc.layer(night, t_n, t_wall + 1.2, fin=0.2, fout=1.2)

    # ---------------- the dark wall: the sentences ----------------
    items = []          # dict(s, x, y, size, rot, t0, t1 (writing), wave)
    sc.at(t_wall + 1.2)
    t_v = sc.t
    s1 = sc.say('li', S1, fx='inner', pan=-0.35, gain=-1, sub=False, post=0.35)
    items.append(dict(s=S1, x=180, y=250, size=58, rot=-2.0, t0=s1[0], t1=s1[1]))
    s2 = sc.say('cuishou', S2, fx='inner', pan=0.35, gain=-1, sub=False, post=0.3)
    items.append(dict(s=S2, x=820, y=390, size=72, rot=1.5, t0=s2[0], t1=s2[1]))
    s3 = sc.say('li', S3, fx='inner', pan=-0.2, gain=-2, sub=False, post=-0.9)
    items.append(dict(s=S3, x=140, y=560, size=46, rot=-1.0, t0=s3[0], t1=s3[1]))
    s4 = sc.say('xiao', S4, fx='inner', pan=0.25, gain=-2, sub=False, post=0.0)
    items.append(dict(s=S4, x=300, y=770, size=52, rot=1.8, t0=s4[0], t1=s4[1]))
    # second wave: they come back, over each other, blurring
    wave = [('cuishou', S2, 0.0, -6, -0.55, (160, 420), 96, -4), ('li', S1, 0.7, -7, 0.6, (640, 640), 70, 3),
            ('xiao', S4, 1.3, -8, -0.5, (80, 915), 58, -2), ('li', S3, 1.8, -9, 0.45, (260, 140), 50, 2),
            ('cuishou', S2, 2.6, -8, 0.2, (700, 880), 84, -3), ('li', S1, 3.1, -10, -0.3, (900, 180), 62, 4),
            ('xiao', S4, 3.5, -10, 0.55, (360, 330), 44, -1)]
    t_w2 = sc.t - 1.0
    ends = []
    for who, s, dt, g, pan, (x, y), size, rot in wave:
        y_, path = V.synth(who, s)
        a_ = inner_blur(y_)
        at = t_w2 + dt
        sc.sfx(a_, at=at, gain=g, pan=pan, bus='voice')
        dur = len(y_) / SR
        items.append(dict(s=s, x=x, y=y, size=size, rot=rot, t0=at, t1=at + dur, wave=True))
        ends.append(at + dur)
    t_blur = max(ends) - 1.2
    sc.sfx(sfx.drone(16, 43.0, 145), at=t_v + 2.0, gain=-14, fin=5.0, fout=1.0)
    sc.at(t_blur + 1.4)

    # the narration: they all say the same thing
    sc.narr('这些句子来自不同的人，说在不同的时间和地点。', post=0.5)
    sc.narr('但在凌晨两点的黑暗里，它们听起来都一样。', post=0.7)
    t_same = sc.t
    sc.narr('它们说的都是同一件事：', post=1.0)
    t_ubp = sc.t
    for who, dt, g, pan in (('li', 0.0, -3, -0.3), ('cuishou', 0.05, -4, 0.3), ('xiao', 0.1, -4, 0.0)):
        sc.say(who, S5, at=t_ubp + dt, fx='inner', gain=g, pan=pan, sub=False, advance=False)
    y5, _ = V.synth('li', S5)
    t_ubp_end = t_ubp + len(y5) / SR
    sc.at(t_ubp_end + 5.0)
    t_turn = sc.t

    def wall(c, t, L):
        T = L.T
        k_dawn = smooth((T - (t_turn + 2.0)) / 16.0)
        L.scene.sub_color = WHITE if T < t_turn + 15.2 else None
        O.b_background(c, DAY)
        c.drawRect(skia.Rect(0, 0, BW, H), paint(NIGHT, 0.78 - 0.56 * k_dawn))
        wall_light(c, k_dawn, 1.0)
        # the corner of the room, and the edge of his quilt close in front of him
        line(c, 1330, -10, 1338, 900, mix(STREET, GRAPHITE, k_dawn), 0.25, 1.4)
        smudge(c, [(-40, 1100), (-40, 990), (300, 950), (700, 968), (1100, 940), (1480, 980), (1480, 1100)],
               mix((20, 22, 28), GRAPHITE, k_dawn), 0.75 - 0.35 * k_dawn, 26)
        # the sentences
        fade_all = smooth((T - t_same) / 2.5)                 # they dissolve while she speaks
        for it in items:
            if T < it['t0']:
                continue
            n = len(it['s'])
            chars = n * clamp((T - it['t0']) / max(0.3, (it['t1'] - it['t0']) * 0.9))
            w = it.get('wave', False)
            age = T - it['t1']
            smear = clamp(0.25 * w + 0.1 * max(0.0, T - t_w2) / 3 + (0.9 * smooth((T - t_blur + 1.5) / 4.0)))
            a = (0.55 if w else 0.85) * (1 - fade_all)
            a *= 1 - 0.35 * smooth(age / 6.0) if age > 0 else 1
            graphite_text(c, it['s'], it['x'], it['y'], it['size'], a, it['rot'], smear * (0.35 if not w else 0.6), chars)
        # 你不配。 alone
        if T > t_ubp - 0.1:
            k = clamp((T - t_ubp) / max(0.3, t_ubp_end - t_ubp))
            fade = 1 - smooth((T - (t_turn + 1.0)) / 3.0)
            graphite_text(c, S5, 720 - text_width(S5, 'hand', 150) / 2, 560, 150, 0.9 * fade, 0.0, 0.0, len(S5) * k)
        vignette(c, BW, H, 0.45 - 0.2 * k_dawn)
    t_dawn_end = t_turn + 19.0
    sc.layer(wall, t_wall, t_dawn_end + 0.8, fin=1.2, fout=0.9)

    # he turns to face the wall; it stays empty; it grows light
    sc.sfx(turn_over(146, 2.4, 0.8), at=t_turn + 0.2, gain=-9, pan=0.35)
    # Li snores on through the whole night; it only stops when the birds start
    sc.sfx(snore(t_turn + 15.0 - t_n, 143), at=t_n + 0.5, gain=-11, pan=-0.45, fin=2.0, fout=5.0)
    sc.sfx(turn_over(149, 2.0, 0.7), at=t_turn + 7.5, gain=-12, pan=-0.3)
    sc.caption('他侧过身，面朝墙壁。墙上什么都没有。', start=t_turn + 2.4, dur=4.4)
    sc.caption('他看着那面空墙，一直看到天亮。', start=t_turn + 9.5, dur=5.0)
    sc.amb(sfx.campus(40, 147), t_turn + 10.0, None, gain=-4, fin=6.0)

    # ---------------- morning ----------------
    t_m = t_dawn_end
    t_push0 = [0.0]
    shoes = {}
    def morning(c, t, L):
        T = L.T
        O.b_background(c, DAY)
        c.drawRect(skia.Rect(0, 0, BW, H), paint((255, 255, 255), 0.10))
        k = 1.16 * (1.0 + 0.24 * ease_in_out(ramp(T, t_push0[0], t_push0[0] + 14.0)) if t_push0[0] else 1.0)
        c.save()
        c.translate(1000, 510); c.scale(k, k); c.translate(-1000, -600)
        smudge(c, [(520, 90), (1150, 50), (1190, 470), (560, 510)], (250, 238, 214), 0.30, 26)
        for (p, q) in (((850, 72), (872, 490)), ((540, 300), (1170, 262))):
            pth = skia.Path(); pth.moveTo(*p); pth.lineTo(*q)
            pp = paint(GRAPHITE, 0.08, 18); pp.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 8))
            c.drawPath(pth, pp)
        morning_room().draw(c, 1.0)
        O.shoes(51, 860, 800, 0.42).draw(c, 1.0)
        # Li's new shoes, taken one by one as he puts them on
        for i, (x0, y0) in enumerate(((150, 944), (390, 956))):
            tl = shoes.get(i)
            u = 0.0 if tl is None else ramp(T, tl, tl + 0.55) ** 2
            if u >= 1:
                continue
            c.save(); c.translate(x0 - 700 * u, y0 - 40 * u); c.rotate(-4 + 3 * i - 6 * u); c.scale(0.8, 0.8)
            aj_shoe().draw(c, 1.0, 1.0)
            c.restore()
        c.restore()
        vignette(c, BW, H, 0.2)
    sc.layer(morning, t_m, None, fin=1.2, fout=0.0, name='morning')
    sc.at(t_m + 1.8)
    sc.sfx(sfx.paper_rustle(148, 0.9), gain=-14, pan=-0.5)
    sc.sfx(sfx.footsteps(2, 0.5, 149, a=0.6), at=sc.t + 0.6, gain=-16, pan=-0.5)
    sc.wait(1.6)
    sc.say('li', '又不去上课？', pan=-0.4, post=0.3)
    sc.say('li', '他最近怎么回事，天天待在床上。', pan=-0.4, post=0.5)
    sc.say('chen', '也许身体不舒服吧。', pan=-0.2, note='上铺', post=0.5)
    shoes[0] = sc.t + 0.1
    sc.sfx(shoe_on(150), at=sc.t + 0.5, gain=-10, pan=-0.45)
    sc.say('li', '什么不舒服，他就是懒。', pan=-0.4, note='边穿鞋边说', post=0.3)
    sc.say('li', '你看他最近那个样子，头也不洗澡也不洗，', tts='你看他最近那个样子，头也不洗，澡也不洗，', pan=-0.4, post=0.25)
    shoes[1] = sc.t - 0.4
    sc.sfx(shoe_on(151), at=sc.t, gain=-10, pan=-0.45)
    sc.say('li', '天天一副丧着脸的样子。', pan=-0.4, post=0.35)
    t_yy = sc.t
    sc.say('li', '这小子估计是玉玉了。', tts='这小子估计是郁郁了。', pan=-0.4, post=1.3)
    t_push0[0] = sc.t - 0.6
    sc.narr('“玉玉”——抑郁。网络上用来调侃的谐音梗。', post=0.5)
    sc.narr('像是只要换一个发音，一个人正在经历的痛苦，就可以变成一个笑话。', post=1.4)
    sc.say('chen', '……别这么说。', tts='别这么说。', pan=-0.2, speed=0.92, post=0.6)
    sc.say('li', '开个玩笑嘛。', pan=-0.4, post=0.3)
    sc.say('li', '走了走了，要迟到了。', pan=-0.45, post=0.2)
    t_out = sc.t
    sc.sfx(sfx.footsteps(4, 0.45, 152, a=0.8), at=t_out, gain=-12, pan=-0.2)
    sc.sfx(sfx.door('open', 153), at=t_out + 1.4, gain=-7, pan=0.1)
    sc.sfx(sfx.footsteps(3, 0.45, 154, a=0.7), at=t_out + 2.0, gain=-14, pan=0.1)
    t_shut = t_out + 3.6
    sc.sfx(sfx.door('close', 155), at=t_shut, gain=-4, pan=0.1)

    # ---------------- the blanket ----------------
    t_b = t_shut + 1.2
    for ly in sc.layers:
        if ly.name == 'morning':
            ly.end = t_b + 1.2
            ly.fout = 1.2
    def blanket(c, t, L):
        T = L.T
        O.b_background(c, DAY)
        c.drawRect(skia.Rect(0, 0, BW, H), paint((255, 255, 255), 0.06))
        blanket_close().draw(c, 1.0)
        # the morning light lying across it, moving a hair
        smudge(c, [(300 + 8 * (T - t_b), 380), (900 + 8 * (T - t_b), 260), (1100 + 8 * (T - t_b), 1080), (420 + 8 * (T - t_b), 1080)],
               DAWN, 0.10, 60)
        vignette(c, BW, H, 0.3)
    sc.layer(blanket, t_b, None, fin=1.2, fout=2.0)
    sc.at(t_b + 3.0)
    sc.narr('他的眼睛是睁着的。', post=1.0, variant=1)
    sc.narr('他听见了每一个字。', post=5.0)
    sc.finish(tail=0.5)
    return sc

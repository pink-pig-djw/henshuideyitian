"""第七场【倒计时】 内景 奶茶店角落 日 — 距自杀还有 35 天.
Same booth, same lamp, a little dimmer. Xiao is not smiling. The numbers climb as he says them.
A new contract, a shaking signature, an envelope pushed over and pushed straight back.
Outside, the sun is very bright; he is very cold."""
import math, functools
import numpy as np
import skia
from film.config import *
from film.gfx import *
from film.timeline import Scene
from film.sketch import Drawing, smudge
from film import objects as O, sfx
from film.audio import lowpass, highpass, bandpass, env_fade, reverb
from scenes.s04_d60 import (paper_bg, paper_glow, baked, blit, _Dims, draw_booth, draw_table_top, draw_zhang_hands, contract_mark, sign_tip, draw_pen, camkeys,
                            draw_hand_filled, hand_fill_poly,
                            envelope, xiao_push_hand, zhang_hold_hand, hand, cam, Shots, slide, creak, breath,
                            chime, tinnitus, muffle, XC, LAMP_X, LAMP_Y, TABLE_Y, paper_rgb)

DAY = 35
INK = (35, 35, 38)

# =====================================================================
# drawings
# =====================================================================
HEM_Y0, HEM_Y1 = 470, 562               # the hoodie's hem band in the lap shot
HL, HR = (600, 356), (842, 356)         # wrists of the two hands

@functools.lru_cache(maxsize=2)
def lap():
    """Under the table: his lap. The new hoodie (sleeves coming down, drawstrings), jeans below."""
    d = Drawing(seed=701, width=1.7)
    d.line(-20, 110, 1460, 104, w=1.8)                                      # the table's underside
    d.hatch([(-20, -10), (1460, -10), (1460, 106), (-20, 112)], angle=6, spacing=6, w=0.8, a=0.45)
    d.curve([(190, 112), (176, 300), (160, HEM_Y0)], w=1.5)                  # hoodie sides
    d.curve([(1250, 112), (1264, 300), (1280, HEM_Y0)], w=1.5)
    # the pocket, mostly hidden by the arms
    d.curve([(300, 250), (360, 360), (380, HEM_Y0 - 10)], w=1.2, a=0.7)
    d.curve([(1140, 250), (1080, 360), (1060, HEM_Y0 - 10)], w=1.2, a=0.7)
    # drawstrings hanging between the arms
    d.curve([(700, 100), (696, 220), (702, 330)], w=1.2); d.rect(695, 330, 12, 22, w=1.0, passes=1)
    d.curve([(742, 100), (748, 230), (740, 350)], w=1.2); d.rect(734, 350, 12, 22, w=1.0, passes=1)
    # sleeves from above, ribbed cuffs
    for (xa, xb, cx) in ((430, 560, HL[0]), (1010, 880, HR[0])):
        sgn = 1 if xa < xb else -1
        d.curve([(xa, 108), ((xa + cx - 60 * sgn) / 2, 220), (cx - 62 * sgn, 316)], w=1.6)
        d.curve([(xb, 108), ((xb + cx + 50 * sgn) / 2, 220), (cx + 52 * sgn, 316)], w=1.6)
        d.hatch([(xa, 110), (xb, 110), (cx + 52 * sgn, 300), (cx - 62 * sgn, 300)], angle=90 - 12 * sgn, spacing=10, w=0.6, a=0.25)
        d.curve([(cx - 64 * sgn, 300), (cx, 306), (cx + 54 * sgn, 300)], w=1.3)
        d.curve([(cx - 60 * sgn, 338), (cx, 344), (cx + 52 * sgn, 338)], w=1.3)
        for k in range(8):
            u = cx - 56 * sgn + k * 14 * sgn
            d.line(u, 304, u, 340, w=0.6, a=0.4, passes=1)
    # jeans: thighs toward the camera
    d.curve([(160, HEM_Y1 + 6), (180, 800), (200, 1090)], w=1.5)
    d.curve([(700, 600), (692, 820), (680, 1090)], w=1.3)
    d.curve([(740, 600), (748, 820), (762, 1090)], w=1.3)
    d.curve([(1280, HEM_Y1 + 6), (1262, 800), (1240, 1090)], w=1.5)
    d.curve([(440, 610), (446, 840), (452, 1090)], w=0.8, a=0.35, passes=1)
    d.curve([(1000, 610), (994, 840), (988, 1090)], w=0.8, a=0.35, passes=1)
    d.hatch([(170, 700), (694, 720), (682, 1090), (196, 1090)], angle=80, spacing=9, w=0.6, a=0.18)
    d.hatch([(746, 720), (1268, 700), (1242, 1090), (762, 1090)], angle=100, spacing=9, w=0.6, a=0.18)
    return d

@functools.lru_cache(maxsize=4)
def lap_hand(side):
    """A hand coming down from the cuff, fingers curled over the hem."""
    d = Drawing(seed=706 + side, width=1.6)
    hand(d, 0, 0, 1.08, math.pi - 0.18 * side, flip=(side > 0), arm=None)
    return d

@functools.lru_cache(maxsize=1)
def hem_band():
    d = Drawing(seed=707, width=1.6)
    d.curve([(150, HEM_Y0), (400, HEM_Y0 + 6), (HL[0] - 30, HEM_Y0 + 30)], w=1.5)
    d.curve([(HR[0] + 30, HEM_Y0 + 30), (1040, HEM_Y0 + 6), (1290, HEM_Y0)], w=1.5)
    d.curve([(150, HEM_Y1), (400, HEM_Y1 + 4), (HL[0] - 30, HEM_Y1 - 6)], w=1.5)
    d.curve([(HR[0] + 30, HEM_Y1 - 6), (1040, HEM_Y1 + 4), (1290, HEM_Y1)], w=1.5)
    for (x0, x1) in ((158, HL[0] - 40), (HR[0] + 40, 1282)):
        for k in range(int((x1 - x0) / 15)):
            x = x0 + 6 + k * 15
            d.line(x, HEM_Y0 + 6, x + 1, HEM_Y1 - 4, w=0.7, a=0.35, passes=1)
    # the fabric bunched into each hand
    for sgn, (hx, hy) in ((-1, HL), (1, HR)):
        for k in range(5):
            d.curve([(hx + sgn * (40 + k * 40), HEM_Y0 + 4 + k * 2), (hx + sgn * (20 + k * 16), HEM_Y0 + 30), (hx + sgn * 10, HEM_Y0 + 44)], w=0.8, a=0.45, passes=1)
    return d

def _lap_base(cc):
    O.b_background(cc, DAY)
    cc.save(); cc.translate(720, 330); cc.scale(1.22, 1.22); cc.translate(-720, -330)
    smudge(cc, [(-40, 110), (1480, 104), (1480, 260), (-40, 266)], GRAPHITE, 0.10, 30)
    lap().draw(cc, 1.0)
    cc.restore()
    glow(cc, 700, 600, 800, TEA, 0.08)

def draw_lap(c, L, twist=0.0, still=False):
    blit(c, baked(('lap',), _lap_base))
    c.save(); c.translate(720, 330); c.scale(1.22, 1.22); c.translate(-720, -330)
    _draw_lap(c, L, twist)
    c.restore()

def _draw_lap(c, L, twist=0.0):
    paper = O.b_paper(DAY)
    # hands: turning a little against each other as he twists
    for side, (hx, hy) in ((-1, HL), (1, HR)):
        c.save(); c.translate(hx, hy); c.rotate(side * 4.0 * math.sin(twist * 2 * math.pi))
        lap_hand(side).draw(c, 1.0)
        c.restore()
    # the hem passes in front of the finger tips (fingers curled under it)
    band = skia.Path()
    band.moveTo(HL[0] - 110, HEM_Y0 + 40); band.cubicTo(HL[0], HEM_Y0 + 30, HR[0], HEM_Y0 + 30, HR[0] + 110, HEM_Y0 + 40)
    band.lineTo(HR[0] + 110, HEM_Y1 + 12); band.lineTo(HL[0] - 110, HEM_Y1 + 12); band.close()
    c.drawPath(band, paint(paper, 1.0))
    hem_band().draw(c, 1.0)
    # the twisted part between and under the hands: diagonal folds that travel as he twists
    x0, x1 = HL[0] - 90, HR[0] + 90
    for k in range(11):
        u = ((k / 11.0) + twist) % 1.0
        x = x0 + (x1 - x0) * u
        c.drawLine(x - 14, HEM_Y0 + 44, x + 18, HEM_Y1 + 2, paint(GRAPHITE, 0.15 + 0.5 * math.sin(math.pi * u), 1.3))
    p = skia.Path()
    p.moveTo(x0 - 20, HEM_Y0 + 40); p.cubicTo(x0 + 80, HEM_Y0 + 30, x1 - 80, HEM_Y0 + 30, x1 + 20, HEM_Y0 + 40)
    p.moveTo(x0 - 20, HEM_Y1 + 4); p.cubicTo(x0 + 80, HEM_Y1 - 16, x1 - 80, HEM_Y1 - 16, x1 + 20, HEM_Y1 + 4)
    c.drawPath(p, paint(GRAPHITE, 0.75, 1.5))

@functools.lru_cache(maxsize=1)
def lamp_below():
    """The same pendant lamp, seen from underneath: looking up."""
    d = Drawing(seed=703, width=2.0)
    cx, cy = 720, 430
    d.ellipse(cx, cy, 420, 170, w=2.2)
    d.ellipse(cx, cy, 400, 158, w=1.0, a=0.4)
    d.hatch([(cx + 420 * math.cos(a), cy + 170 * math.sin(a)) for a in np.linspace(math.pi, 2 * math.pi, 30)],
            angle=20, spacing=10, w=0.7, a=0.35)
    d.ellipse(cx, cy - 40, 120, 48, w=1.2, a=0.6)
    d.ellipse(cx, cy - 46, 58, 58, w=1.6)
    d.line(cx, cy - 172, cx, -20, w=1.4)
    d.line(-20, 70, 1460, 40, w=1.0, a=0.4)                 # the ceiling beyond
    return d

@functools.lru_cache(maxsize=1)
def campus_outside():
    """Outside the shop: a path, plane trees, very far away in the glare."""
    d = Drawing(seed=704, width=1.4, alpha=0.6)
    d.line(-20, 600, 1460, 588, w=1.0, a=0.45)
    d.line(560, 600, 120, 1090, w=1.2, a=0.5); d.line(880, 598, 1330, 1090, w=1.2, a=0.5)
    for (x, s) in ((180, 0.9), (1240, 1.0), (420, 0.55), (1030, 0.6)):
        d.extend(O.tree(seed=int(x) % 97 + 3, x=x, y=610 if s < 0.8 else 700, s=s, depth=5))
    return d

_FIG_L = [(0, -104), (-4, -100), (-8, -8), (-6, 0), (-50, 0), (-48, -10), (-46, -60), (-48, -116), (-60, -120),
          (-64, -132), (-66, -94), (-78, -96), (-80, -150), (-74, -202), (-62, -232), (-40, -250), (-15, -258), (-12, -272)]

def _fig_outline():
    left = _FIG_L
    right = [(-x, y) for (x, y) in reversed(left)]
    return left + right[1:-1]

@functools.lru_cache(maxsize=1)
def small_figure_path():
    from film.sketch import _catmull
    p = skia.Path()
    pts = _catmull(_fig_outline(), per=6)
    p.moveTo(*pts[0])
    for q in pts[1:]:
        p.lineTo(*q)
    p.close()
    p.addOval(skia.Rect.MakeXYWH(-27, -326, 54, 64))
    p.setFillType(skia.PathFillType.kWinding)
    return p

@functools.lru_cache(maxsize=1)
def small_figure():
    """Zhang from behind, standing, full length: sloped shoulders, arms hanging, head a little bowed (pencil)."""
    d = Drawing(seed=705, width=1.4)
    d.curve(_fig_outline()[5:-4], w=1.2, a=0.7)
    d.ellipse(0, -294, 27, 32, w=1.2, a=0.7)
    d.hatch([(-66, -250), (66, -250), (70, -120), (-70, -120)], angle=70, spacing=5, w=0.8, a=0.3)
    return d

def draw_figure(c, x, y, s, a=1.0, tone=(58, 54, 50), sx=1.0):
    from film.sketch import _tooth_soft
    c.save(); c.translate(x, y); c.scale(s * sx, s)
    c.saveLayer(skia.Rect(-120, -360, 120, 20), None)
    fp = paint(tone, a * 0.62)
    fp.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 2.2 / max(s, 0.1)))
    c.drawPath(small_figure_path(), fp)
    c.drawPaint(skia.Paint(Shader=_tooth_soft(), BlendMode=skia.BlendMode.kDstIn))
    c.restore()
    small_figure().draw(c, 1.0, a)
    c.restore()

def passerby(c, x, y, s, a, phase):
    """A figure far off in the glare: the same pencil person, tiny and almost gone."""
    draw_figure(c, x, y + 2 * math.sin(phase), s, a)

TYPED = ['张朝阳实际到手 0 元。新债本金一万二千元，月利率百分之十五。', '此后四个月，他未能偿还任何一期利息。']

def typed_caption(c, t, w, h, lines=TYPED, cps=13.0, size=30, rgb=GRAPHITE):
    y0 = h - 150
    tt = t
    for i, s in enumerate(lines):
        n = int(clamp(tt * cps / len(s)) * len(s))
        x = w / 2 - text_width(s, 'sans-light', size, 0.08) / 2
        text(c, s[:n], x, y0 + i * size * 1.9, 'sans-light', size, rgb, 0.92, tracking=0.08)
        if 0 < tt and n < len(s) and int(t * 2.4) % 2 == 0:
            cx = x + text_width(s[:n], 'sans-light', size, 0.08) + 4
            c.drawRect(skia.Rect.MakeXYWH(cx, y0 + i * size * 1.9 - size * 0.85, 2, size), paint(rgb, 0.7))
        tt -= len(s) / cps + 0.6
        if tt < 0:
            break

def ledger(c, t, L, rows, T):
    """The numbers, printed as he says them. rows: [(t_appear, label, value, size)]"""
    paper_glow(c, DAY, ((720, 420, 900, TEA, 0.07),))
    x_lab, x_val = 300, 1140
    for i, (ta, lab, val, size) in enumerate(rows):
        if T < ta:
            continue
        a = smooth((T - ta) / 0.22)
        y = 360 + i * 200
        text(c, lab, x_lab, y, 'serif-light', 34, INK, 0.7 * a, tracking=0.2)
        text(c, val, x_val, y + 6, 'serif-light', size, INK, a, 'right', tracking=0.02)
        c.drawLine(x_lab, y + 34, x_val, y + 34, paint(INK, 0.15 * a, 1.0))

# =====================================================================
# the scene
# =====================================================================
def build():
    sc = Scene('s07_d35', kind='B', title='第七场【倒计时】')
    shots = Shots(sc)
    DIM, LIGHT, LAMP = 0.06, 0.72, 0.78

    # ---------- countdown card ----------
    sc.wait(0.4)
    t0 = sc.t
    def card(c, t, L):
        paper_bg(c, DAY)
        O.countdown_card(c, DAY, t)
    shots.add(card, t0, 0.8)
    sc.sfx(sfx.pencil(2.6, 745), at=t0 + 0.6, gain=-10)
    sc.wait(4.6)

    # ---------- same booth, same lamp ----------
    t_w = sc.t
    lean = {}
    def lean_k(T):
        k = 0.0
        if 'in' in lean:
            k += ease_in_out(ramp(T, lean['in'], lean['in'] + 1.1))
        if 'out' in lean:
            k -= ease_in_out(ramp(T, lean['out'], lean['out'] + 1.4))
        return clamp(k)
    def w(c, t, L):
        T = L.T
        k = lean_k(T)
        pr = ease_out((T - t_w) / 1.8)
        draw_booth(c, L, DAY, 'd35', progress=pr, light=LIGHT - 0.12 * k, lamp=LAMP,
                   dim=DIM + 0.03 * k, xiao_s=1.0 + 0.07 * k, xiao_dy=34 * k, static=(pr >= 1.0 and k in (0.0, 1.0)))
    shots.add(w, t_w, 0.9)
    cafe = sfx.cafe(150, 746)
    sc.wait(2.6)
    sc.narr('同一个卡座。同一盏暖黄色的灯。但这一次，肖强没有在笑。', post=1.2)

    # ---------- the debt ----------
    rows = []
    def led(c, t, L):
        ledger(c, t, L, rows, L.T)
    t_n1 = sc.t - 0.1
    shots.add(led, t_n1, 0.35)
    line = '连利息带违约金，你现在欠九千三。'
    s0, s1 = sc.say('xiao', line, post=0.35)
    rows.append((s0 + (s1 - s0) * 0.78, '这个月', '9 300', 92))
    sc.say('xiao', '你还得上吗？', tts='你环的上吗？', post=0.8)

    tw = {}
    def lapshot(c, t, L):
        T = L.T
        k = 0.0
        if 'stop' in tw and T > tw['stop']:
            k = 0.0
            draw_lap(c, L, twist=tw['frozen'])
        else:
            draw_lap(c, L, twist=0.35 * math.sin((T - tw['t0']) * 1.3) + 0.12 * (T - tw['t0']))
    tw['t0'] = sc.t
    shots.add(lapshot, sc.t - 0.2, 0.45)
    sc.caption('张朝阳摇头。手指在桌子底下，无意识地绞着衣角。', start=sc.t + 0.3, dur=4.4)
    sc.sfx(sfx.paper_rustle(747, 1.6), at=sc.t + 0.5, gain=-18)
    sc.sfx(sfx.paper_rustle(748, 1.4), at=sc.t + 2.8, gain=-19)
    sc.wait(5.0)

    shots.add(w, sc.t - 0.2, 0.4)
    sc.say('xiao', '那只有一个办法。', post=0.35)
    sc.say('xiao', '换一个渠道，借一万二出来，先把这边的窟窿堵上。', post=0.7)

    shots.add(lapshot, sc.t - 0.2, 0.4)
    sc.sfx(sfx.paper_rustle(749, 1.2), at=sc.t, gain=-19)
    sc.say('zhang', '我已经还不起了，再借……', tts='我已经环不起了，再借。', speed=0.92, gain=-3, post=0.9, variant=1)

    # he leans in; the voice drops
    t_lean = sc.t - 0.2
    shots.add(w, t_lean, 0.35)
    lean['in'] = t_lean + 0.2
    sc.sfx(creak(750, 0.8), at=t_lean + 0.2, gain=-10)
    sc.wait(1.1)
    sc.say('xiao', '你不借也行。', note='向前探身，声音压低', fx='dry', gain=-1, speed=0.92, post=0.5)

    shots.add(led, sc.t - 0.15, 0.3)
    for (txt, lab, val, size, post) in (('这个月九千三，', '这个月', '9 300', 92, 0.2),
                                        ('下个月一万出头，', '下个月', '10 000+', 112, 0.2),
                                        ('大后月一万三。', '大后月', '13 000', 136, 0.5)):
        s0, s1 = sc.say('xiao', txt, fx='dry', gain=-1, speed=0.92, post=post, variant=(2 if lab == '大后月' else 0))
        if lab != '这个月':
            rows.append((s0 + (s1 - s0) * 0.35, lab, val, size))
    sc.say('xiao', '你自己选。', fx='dry', gain=-1, speed=0.9, post=0.7)

    shots.add(w, sc.t - 0.2, 0.35)
    sc.say('xiao', '我倒是无所谓——', tts='我倒是无所谓，', fx='dry', gain=-1, speed=0.92, post=0.15)
    sc.say('xiao', '就是外面催收的人不像我这么好说话。', fx='dry', gain=-1, speed=0.92, post=0.8)

    # the long stillness
    t_still = sc.t
    tw['stop'] = t_still
    tw['frozen'] = 0.35 * math.sin((t_still - tw['t0']) * 1.3) + 0.12 * (t_still - tw['t0'])
    shots.add(lapshot, t_still - 0.2, 0.6)
    sc.caption('张朝阳低着头，很久没有动。', start=t_still + 1.2, dur=3.6)
    sc.wait(6.2)

    shots.add(w, sc.t - 0.2, 0.5)
    sc.say('xiao', '而且你想过没有——', tts='而且你想过没有，', fx='dry', gain=-1, speed=0.9, post=0.3, variant=1)
    sc.say('xiao', '你室友要是知道你借了高利贷，他们会怎么看你？', fx='dry', gain=-1, speed=0.9, post=0.1)

    # ---------- the jolt: he looks up sharply ----------
    t_j = sc.t
    J_LEN = 1.9
    def jolt(c, t, L):
        paper_bg(c, DAY)
        sh = math.exp(-t * 4.0)
        whip = 1 - ease_out(t / 0.2)
        c.save()
        c.translate(26 * sh * math.sin(t * 61), 20 * sh * math.cos(t * 47) - 420 * whip)
        c.translate(720, 540); c.scale(1.04 + 0.14 * sh, 1.04 + 0.14 * sh); c.translate(-720, -540)
        lamp_below().draw(c, 1.0)
        c.restore()
        glow(c, 720, 384 - 420 * whip, 520, (255, 246, 226), 0.9)
        glow(c, 720, 384 - 420 * whip, 170, (255, 255, 250), 0.95)
        c.drawRect(skia.Rect(0, 0, L.w, L.h), paint((255, 252, 244), 0.75 * math.exp(-t * 7)))
    shots.add(jolt, t_j, 0.0)
    sc.sfx(sfx.thump_low(751), at=t_j, gain=-4)
    sc.sfx(tinnitus(3.4, 4300), at=t_j + 0.05, gain=-8)
    sc.sfx(sfx.click(752, 1800, 0.05, 0.6), at=t_j, gain=-6)
    sc.wait(J_LEN)

    shots.add(w, sc.t, 0.0)
    lean['out'] = sc.t + 0.3
    sc.wait(0.9)
    sc.say('xiao', '不用怕，我嘴很严的。', note='平静地', speed=0.95, post=0.35)
    sc.say('xiao', '只要你配合。', speed=0.92, post=0.9)

    # ---------- the new contract ----------
    t_ct = sc.t - 0.2
    PXc, PYc, Sc = 416, 46, 0.98
    Lc = O.contract_layout(Sc, '壹万贰仟元整')
    zoom, sign_t, env = {}, {}, {}
    camk = []
    SIGN_F = (PXc + (58 + 450) * Sc + 40, PYc + Lc['sign_y'] - 14)
    AMT_F = (PXc + 200 * Sc, PYc + Lc['amount_y'] - 6)
    def ct(c, t, L):
        T = L.T
        c.save()
        cam(c, *camkeys(camk, T))
        draw_table_top(c, L, DAY, 'd35', light=0.7, linear=True)
        u = ease_out(ramp(T, t_ct, t_ct + 1.5))
        py = -1000 + (PYc + 1000) * u
        rot = 2.6 - 3.4 * u
        c.save(); c.rotate(rot, PXc + 310 * Sc, py + 440 * Sc)
        sg = ramp(T, sign_t.get('s', 1e9), sign_t.get('s', 1e9) + 3.8)
        O.contract_page(c, PXc, py, s=Sc, amount='壹万贰仟元整', date='4月3日', sign=sg, sign_shaky=1.0,
                        paper_rgb=(242, 242, 239))
        ha = smooth((T - sign_t.get('s', 1e9) + 0.9) / 0.5) * smooth((sign_t.get('s', 1e9) + 4.8 - T) / 0.5)
        if ha > 0:                                                # the hand holding the page trembles
            draw_hand_filled(c, zhang_hold_hand(), hand_fill_poly('hold'), PXc + 60, PYc + Lc['sign_y'] + 150 - 20 * ha,
                             ha, DAY, rot=1.2 * math.sin(T * 23) * ha)
        pa = smooth((T - sign_t.get('s', 1e9) + 0.6) / 0.4) * smooth((sign_t.get('s', 1e9) + 4.5 - T) / 0.4)
        if pa > 0:
            tx, ty = sign_tip(Sc, clamp(sg))
            jx = 3.0 * math.sin(T * 37) + 2.0 * math.sin(T * 53)
            jy = 3.0 * math.cos(T * 41)
            draw_pen(c, PXc + tx + jx, py + ty + jy, pa, ang=-38 + 2.5 * math.sin(T * 29))
        c.restore()
        lift = ease_in_out(ramp(T, t_ct + 1.6, t_ct + 2.5))
        if T < t_ct + 2.6:
            draw_hand_filled(c, xiao_push_hand(), hand_fill_poly('push'), PXc + 430, py + 10 - 640 * lift, 1.0, DAY)
        # the envelope: pushed over ... and pushed straight back
        if 'in' in env and T > env['in']:
            ue = ease_out(ramp(T, env['in'], env['in'] + 1.2))
            ub = ease_in_out(ramp(T, env['back'], env['back'] + 1.4))
            ey = -330 + (560 + 330) * ue - 900 * ub
            envelope(c, 760, ey, 1.0, 0.03)
            lift2 = ease_in_out(ramp(T, env['in'] + 1.3, env['in'] + 2.1))
            if T < env['in'] + 2.2:
                draw_hand_filled(c, xiao_push_hand(), hand_fill_poly('push'), 980, ey - 40 - 640 * lift2, 1.0, DAY)
            # his hand: takes it, holds it ... pushes it back
            hk = smooth((T - env['take']) / 0.5)
            hw = ease_in_out(ramp(T, env['back'] + 1.0, env['back'] + 1.9))
            if hk > 0 and hw < 1:
                draw_hand_filled(c, zhang_push_hand(), hand_fill_poly('up'), 900, ey + 300 + 620 * hw, hk, DAY)
        c.restore()
        c.drawRect(skia.Rect(0, 0, L.w, L.h), paint((60, 58, 56), 0.05))
        glow(c, 620, 420, 900, TEA, 0.07)
    shots.add(ct, t_ct, 0.45)
    sc.sfx(slide(753, 1.4, 1.0, 500, 3800), at=t_ct + 0.3, gain=-6)
    camk.append((t_ct + 1.9, 1.5, 2.3, AMT_F[0], AMT_F[1]))       # 借款金额：壹万贰仟元整
    sc.wait(5.0)
    zoom['in'] = sc.t
    camk.append((sc.t, 1.5, 1.95, SIGN_F[0], SIGN_F[1]))
    sc.wait(1.5)
    sign_t['s'] = sc.t
    sc.sfx(sfx.pen_on_paper(4.0, 754) * shaky_env(4.0, 755), at=sc.t, gain=-5)
    sc.wait(4.4)
    zoom['out'] = sc.t
    camk.append((sc.t, 1.3, 1.0, BW / 2, H / 2))
    sc.wait(1.3)
    env['in'] = sc.t
    sc.sfx(slide(756, 1.1, 0.9, 400, 2600), at=sc.t + 0.05, gain=-8)
    sc.wait(1.6)
    env['take'] = sc.t
    sc.sfx(sfx.paper_rustle(757, 0.5), at=sc.t + 0.3, gain=-16)
    sc.wait(2.2)
    env['back'] = sc.t
    sc.sfx(slide(758, 1.3, 1.0, 400, 2600), at=sc.t + 0.05, gain=-7)
    sc.wait(1.8)
    sc.narr('里面的钱刚好抵掉前面的欠款。他一分钱没有拿走。', post=0.5)
    sc.narr('但他现在欠的，是一万二。', post=1.3)

    # ---------- outside: the sun ----------
    t_x = sc.t
    sc.sfx(chime(759), at=t_x - 0.3, gain=-11, pan=0.3)
    X_LEN = 23.0
    def _glare(cc):
        O.b_background(cc, DAY)
        campus_outside().draw(cc, 1.0, 0.55)
        cc.drawRect(skia.Rect(0, 0, BW, H), paint((255, 253, 248), 0.82 * 0.55))
        glow(cc, 720, 200, 1100, (255, 255, 252), 0.75)
        glow(cc, 720, 520, 700, (255, 255, 255), 0.35)
    def outside(c, t, L):
        blit(c, baked(('glare',), _glare))
        for k in range(5):
            ph = t * 5 + k * 1.7
            x = (k * 331 + 90 + t * (16 + 6 * (k % 3)) * (1 if k % 2 else -1)) % 1640 - 100
            y = 628 + (k % 3) * 26
            passerby(c, x, y, 0.16 + 0.03 * (k % 3), 0.1, ph)
        draw_figure(c, 720, 830, 0.8, 0.62, sx=0.8)                 # he stays: a little darker than the glare
        # the white of the door opening, fading
        c.drawRect(skia.Rect(0, 0, L.w, L.h), paint((255, 255, 255), 0.9 * (1 - smooth(t / 1.6))))
        typed_caption(c, t - 9.8, L.w, L.h)
    shots.add(outside, t_x, 0.5)
    sc.amb(muffle(sfx.campus(40, 760)[:, 0], 480) * 2.2, t_x, None, gain=-4, fin=1.0, fout=2.0)
    sc.sfx(tinnitus(8.0, 5200), at=t_x + 0.8, gain=-22)
    sc.wait(3.4)
    sc.narr('他站在阳光里，觉得非常冷。', post=1.0)
    sc.at(t_x + X_LEN)
    # the shop: its sound stops at the door (a little quieter during the long stillness)
    sc.amb(cafe, t_w - 0.4, t_still, gain=0, fin=1.2, fout=0.8)
    sc.amb(cafe, t_still, t_still + 6.0, gain=-5, fin=0.8, fout=0.8)
    sc.amb(cafe, t_still + 5.2, t_j, gain=0, fin=0.8, fout=0.05)
    sc.amb(cafe, t_j + J_LEN * 0.8, t_x + 0.3, gain=0, fin=1.2, fout=0.4)
    shots.commit(end_fade=1.6)
    sc.finish(tail=0.2)
    return sc

def shaky_env(d, seed):
    t = np.arange(int(d * SR)) / SR
    rng = np.random.default_rng(seed)
    e = 0.6 + 0.4 * np.abs(np.sin(2 * np.pi * 7.3 * t + rng.uniform(0, 6))) * (0.7 + 0.3 * np.sin(2 * np.pi * 1.1 * t))
    return e.astype(np.float32)

@functools.lru_cache(maxsize=1)
def zhang_push_hand():
    d = Drawing(seed=770, width=1.6)
    hand(d, 0, 0, 1.0, 0.0, flip=False, arm='cuff', arm_len=420)
    return d

"""第二场【倒计时】 内景 宿舍 夜 — 距自杀还有 62 天.
Two loud worlds and one quiet desk. The line that lands in a gap. Fifteen seconds."""
import math, functools
import numpy as np
from film.config import *
from film.gfx import *
from film.timeline import Scene
from film.sketch import Drawing, smudge
from film import objects as O, sfx

DAY = 62

@functools.lru_cache(maxsize=1)
def dorm_wide():
    """Night dorm, wide: Li's gaming desk (left), Chen's upper bunk (top left), Zhang's desk (right)."""
    d = Drawing(seed=62, width=1.8)
    # floor / wall line
    d.line(30, 820, 1410, 800, w=1.2, a=0.5)
    # Li's desk (left)
    d.line(60, 730, 640, 726); d.line(60, 750, 650, 746, w=1.2)
    d.line(90, 750, 92, 960); d.line(610, 748, 612, 960)
    # monitor + stand
    d.rect(170, 430, 360, 230); d.rect(182, 442, 336, 206, w=1.0, a=0.5)
    d.line(350, 660, 350, 700); d.poly([(300, 726), (320, 700), (380, 700), (400, 726)])
    # keyboard
    d.poly([(210, 722), (230, 706), (470, 706), (490, 722)], closed=True, w=1.2)
    d.hatch([(212, 721), (231, 707), (469, 707), (488, 721)], angle=0, spacing=5)
    # Li from behind, backlit by the screen: a dark silhouette
    d.fill([(250, 900), (262, 760), (300, 728), (345, 715), (390, 728), (428, 760), (440, 900)], GRAPHITE, 0.88, smooth=True)
    d.fill([(345 + 62 * math.cos(a), 640 + 72 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 40)], GRAPHITE, 0.88)
    d.ellipse(345, 640, 62, 72, w=2.0)
    d.curve([(275, 630), (290, 560), (345, 548), (400, 560), (415, 630)], w=2.4)
    d.ellipse(280, 648, 16, 30, w=2.0); d.ellipse(410, 648, 16, 30, w=2.0)
    d.curve([(250, 900), (262, 760), (345, 715), (428, 760), (440, 900)], w=2.0)
    d.rect(235, 800, 220, 150, w=1.4, a=0.6)
    # upper bunk (top-left), Chen's shape under a blanket, phone glow
    d.line(20, 250, 700, 246, w=2.0); d.line(20, 300, 700, 296, w=2.0)
    d.line(700, 150, 700, 420, w=1.8); d.line(20, 150, 700, 150, w=1.4, a=0.6)
    d.curve([(80, 248), (160, 200), (330, 192), (520, 206), (640, 246)], w=1.6)
    d.ellipse(610, 220, 36, 28, w=1.6)
    d.hatch([(80, 246), (640, 246), (520, 207), (330, 193), (160, 201)], angle=-12, spacing=9)
    # Zhang's desk (right) — quiet
    d.extend(O.desk_set(31, 820, 600, 0.62))
    d.curve([(1040, 900), (1050, 780), (1120, 740), (1190, 780), (1200, 900)], w=1.2, a=0.5)  # empty chair back
    return d

@functools.lru_cache(maxsize=1)
def corridor():
    d = Drawing(seed=621, width=1.6)
    vx, vy = 720, 470
    for (x0, y0) in [(0, 0), (1440, 0), (0, 1080), (1440, 1080)]:
        d.line(x0, y0, vx + (x0 - vx) * 0.18, vy + (y0 - vy) * 0.18)
    d.rect(vx - 130, vy - 97, 260, 194, w=1.2)
    for k, f in enumerate([0.9, 0.7, 0.55, 0.42, 0.32]):
        x = vx + (0 - vx) * f; y0 = vy + (0 - vy) * f; y1 = vy + (1080 - vy) * f
        d.line(x, y0 + 30 * f, x, y1 - 20 * f, w=1.0, a=0.6)
        d.rect(x + 12 * f, y0 + 120 * f, 60 * f, (y1 - y0) * 0.55, w=0.9, a=0.5)
    for k in range(3):
        f = 0.85 - k * 0.2
        x = vx + (1440 - vx) * f
        d.line(x, vy + (0 - vy) * f + 30 * f, x, vy + (1080 - vy) * f - 20 * f, w=1.0, a=0.6)
    for k in range(6):
        y = vy + (1080 - vy) * (0.25 + k * 0.14)
        d.line(vx - (y - vy) * 1.53, y, vx + (y - vy) * 1.53, y, w=0.6, a=0.25, passes=1)
    return d

def build():
    sc = Scene('s02_d62', kind='B', title='第二场【倒计时】')
    ink = GRAPHITE

    # ---------- countdown card ----------
    sc.wait(0.4)
    t0 = sc.t
    def card(c, t, L):
        O.b_background(c, DAY)
        O.countdown_card(c, DAY, t)
    sc.layer(card, t0, t0 + 4.6, fin=0.8, fout=0.6)
    sc.sfx(sfx.pencil(3.0, 5), at=t0 + 0.6, gain=-8)
    sc.wait(4.6)

    # ---------- wide: two loud worlds, one quiet desk ----------
    t_wide = sc.t
    sc.amb(sfx.room_tone(200, 3), t_wide, None, gain=-4)
    game = sfx.gunfire(90, 11, 1.2)
    chat = sfx.chatter(90, 12)
    keys = sfx.keyboard(90, 6, 10)

    def wide(c, t, L):
        O.b_background(c, DAY)
        # night: darken the page, keep the lamp and the monitor
        c.drawRect(skia.Rect(0, 0, L.w, L.h), paint(NIGHT, 0.42))
        fl = 0.75 + 0.25 * math.sin(L.T * 17) * math.sin(L.T * 5.3)
        glow(c, 350, 545, 420, RGB_M, 0.30 * fl)
        glow(c, 420, 520, 300, RGB_C, 0.22 * (1.6 - fl))
        glow(c, 1160, 610, 360, LAMP, 0.42)
        glow(c, 600, 205, 120, (200, 225, 255), 0.35)
        dorm_wide().draw(c, ease_out(t / 3.0))
        # the RGB light strip under Li's desk: the only saturated colour on the page
        for k in range(20):
            hue = (k / 20 + L.T * 0.25) % 1.0
            rgbv = RGB_M if hue < 0.5 else RGB_C
            c.drawCircle(80 + k * 28, 757, 3.2, paint(rgbv, 0.75 * fl))
    sc.layer(wide, t_wide - 0.6, t_wide + 23.5, fin=0.8, fout=0.8)
    sc.wait(2.6)
    sc.say('li', '你往哪走啊！', fx='room', speed=1.0, gain=2, pan=-0.35, post=0.2, note='打游戏', variant=1)
    sc.say('li', '对了杰辉，那双AJ你看了没？', sub_text='——对了杰辉，那双 AJ 你看了没？', pan=-0.35, post=0.35)
    sc.say('chen', '看了。一千多呢。', pan=-0.2, post=0.4)
    t_price = sc.t
    sc.say('li', '下单了。我那双穿了一学期了，该换了。', pan=-0.35, post=0.3)
    sc.say('chen', '好家伙，一千多的鞋说买就买。不愧是浩哥。', pan=-0.2, post=0.5)

    # ---------- close: the sketchbook, the plane tree being drawn ----------
    t_book = sc.t - 0.4
    P0, P1 = 0.18, 0.44
    pause_at, pause_len = t_book + 1.2, 2.0
    def prog(T):
        # the pen stops when he hears the price, then goes on
        k = ramp(T, t_book, t_book + 30)
        if T > pause_at:
            k = ramp(min(T, pause_at) if T < pause_at + pause_len else T - pause_len, t_book, t_book + 30)
        return P0 + (P1 - P0) * k
    def book(c, t, L):
        O.b_background(c, DAY)
        glow(c, 720, 420, 900, LAMP, 0.25)
        O.sketchbook_page(c, prog(L.T), day=DAY, pencil=True)
    sc.layer(book, t_book, t_book + 17.5, fin=0.9, fout=0.9)
    sc.sfx(sfx.pencil(1.2, 31), at=t_book, gain=-12)
    sc.sfx(sfx.pencil(12.0, 32), at=pause_at + pause_len, gain=-12)
    sc.caption('张朝阳的笔停了一下。然后继续画。', start=pause_at - 0.2, dur=3.6)
    sc.wait(3.2)
    sc.say('li', '你也买呗。', pan=-0.35, post=0.35)
    sc.say('chen', '我可比不了你。', pan=-0.2, post=0.35)
    sc.say('li', '行了，快快快，去下路！', sub_text='行了——快快快，去下路！', speed=1.1, gain=2, pan=-0.35, post=1.4)

    # ---------- he goes for water; glances at the game ----------
    t_water = sc.t
    sc.sfx(sfx.door('open', 16), gain=-6, pan=0.4)
    sc.sfx(sfx.footsteps(3, 0.6, 7, a=0.6), at=t_water + 0.5, gain=-12, pan=0.5)
    sc.sfx(sfx.water_pour(2.5), at=t_water + 3.2, gain=-16, pan=0.7)
    sc.sfx(sfx.footsteps(3, 0.6, 8, a=0.6), at=t_water + 6.2, gain=-12, pan=0.2)
    def glance(c, t, L):
        O.b_background(c, DAY)
        c.drawRect(skia.Rect(0, 0, L.w, L.h), paint(NIGHT, 0.55))
        fl = 0.75 + 0.25 * math.sin(L.T * 17) * math.sin(L.T * 5.3)
        glow(c, 720, 470, 700, RGB_M, 0.30 * fl)
        glow(c, 780, 430, 500, RGB_C, 0.25 * (1.6 - fl))
        # the monitor, big: a game he doesn't play
        d = monitor_close()
        d.draw(c, 1.0)
        # tiny figures of the game — just light
        for k in range(6):
            x = 470 + (k * 97 + L.T * 60) % 500
            c.drawCircle(x, 520 + 40 * math.sin(k + L.T), 4, paint((255, 255, 255), 0.5))
    sc.layer(glance, t_water + 5.6, t_water + 14.5, fin=0.7, fout=0.8)
    sc.wait(6.4)
    sc.narr('他回来的时候路过李浩然的椅子，看了一眼屏幕上的游戏画面。李浩然没有注意到他看了一眼。', post=0.9)

    # ---------- the cracked phone ----------
    t_phone = sc.t - 0.5
    def phone(c, t, L):
        O.b_background(c, DAY)
        glow(c, 900, 300, 800, LAMP, 0.28)
        c.save(); c.translate(560, 170); c.rotate(-8, 130, 260)
        O.cracked_phone(41, 0, 0).draw(c, ease_out(t / 2.4))
        c.restore()
        text(c, '桌角', 150, 950, 'serif-light', 22, GRAPHITE, 0.5 * smooth((t - 1) / 1), tracking=0.4)
    sc.layer(phone, t_phone, None, fin=0.9, fout=0.1, name='phone')
    sc.wait(1.2)
    sc.say('chen', '你那手机怎么摔成这样？', pan=-0.2, post=0.6)
    sc.say('zhang', '出门的时候掉地上了。', speed=0.9, gain=-4, pan=0.35, note='声音很小', post=0.5)
    sc.say('chen', '嗨，碎碎平安。那手机也用好几年了吧，早该换了。', pan=-0.2, post=0.25)
    t_blow = sc.t
    sc.say('li', '得了吧。一双鞋穿两个学期的人，还舍得换手机？', pan=-0.35, post=0.15, note='头也不回')
    sc.say('li', '天天馒头就咸菜的，要不是我们隔三差五请他，还不知道过的什么日子呢。', pan=-0.35, post=0.1)
    t_gap = sc.t
    # the loud world runs right up to the sentence, then drops away: the gap
    n = int((t_gap - t_wide) * SR)
    sc.sfx(game[:n], at=t_wide, gain=-9, pan=-0.5, fin=1.0, fout=0.25, bus='amb')
    sc.sfx(chat[:n], at=t_wide, gain=-20, pan=-0.2, fin=1.0, fout=0.25, bus='amb')
    sc.sfx(keys[:n], at=t_wide, gain=-18, pan=-0.45, fout=0.25, bus='amb')
    sc.wait(1.4)

    # ---------- the gap ----------
    sc.narr('这句话落在安静的间隙里，每一个字都很清楚。', post=1.0)
    for ly in sc.layers:
        if ly.name == 'phone':
            ly.end = sc.t + 0.6
    t_still = sc.t
    sc.caption('陈杰辉皱了皱眉。他张了张嘴，最终只是转头继续看屏幕。', dur=4.2)
    sc.wait(4.6)
    sc.caption('张朝阳坐在那里没有动。笔还握在手里，但笔尖停在纸上，一直没有落下。', dur=4.6)
    sc.wait(4.8)

    # ---------- fifteen seconds, real time ----------
    t15 = sc.t
    def still(c, t, L):
        t = L.T - t15
        O.b_background(c, DAY)
        glow(c, 720, 420, 900, LAMP, 0.22)
        O.sketchbook_page(c, P1, day=DAY, pencil=True)
        # a thin line along the bottom edge fills over the fifteen seconds
        k = clamp(t / 15.0) if t > 0 else 0.0
        c.drawRect(skia.Rect.MakeXYWH(0, L.h - 6, L.w * k, 6), paint(GRAPHITE, 0.35))
        if t < 0:
            c.drawRect(skia.Rect.MakeXYWH(0, L.h - 6, 0, 6), paint(GRAPHITE, 0))
        for i, (s_, word) in enumerate(((5, '五秒'), (10, '十秒'), (15, '十五秒'))):
            if t >= s_ - 0.05:
                vtext(c, word, 150 - i * 0, 300 + i * 170, 'serif-light', 30, GRAPHITE, 0.8 * smooth((t - s_ + 0.05) / 0.5))
    sc.layer(still, t_still - 0.4, t15 + 15.6, fin=0.8, fout=0.6)
    sc.sfx(sfx.heartbeat(15, 56), at=t15, gain=-26)
    sc.wait(15.6)
    sc.narr('没有人注意到这十五秒。', post=0.6)

    # ---------- he leaves; the game comes back ----------
    t_leave = sc.t
    sc.sfx(sfx.door('open', 17), gain=-6, pan=0.5)
    sc.sfx(sfx.door('close', 18), at=t_leave + 1.6, gain=-6, pan=0.5)
    sc.sfx(sfx.gunfire(26, 13, 1.4), at=t_leave + 1.8, gain=-9, pan=-0.5, fin=0.3, fout=2.0)
    sc.sfx(sfx.chatter(26, 14), at=t_leave + 1.8, gain=-20, pan=-0.2, fout=2.0)
    def empty(c, t, L):
        O.b_background(c, DAY)
        c.drawRect(skia.Rect(0, 0, L.w, L.h), paint(NIGHT, 0.42))
        fl = 0.75 + 0.25 * math.sin(L.T * 17) * math.sin(L.T * 5.3)
        glow(c, 350, 545, 420, RGB_M, 0.30 * fl)
        glow(c, 420, 520, 300, RGB_C, 0.22 * (1.6 - fl))
        glow(c, 1160, 610, 360, LAMP, 0.42)
        glow(c, 600, 205, 120, (200, 225, 255), 0.35)
        dorm_wide().draw(c, 1.0)
    sc.layer(empty, t_leave, t_leave + 21, fin=0.5, fout=1.0)
    sc.caption('他放下笔，站起来，拉开门走了出去。', start=t_leave + 0.2, dur=3.0)
    sc.wait(3.6)
    sc.narr('李浩然继续打游戏。陈杰辉继续看视频。', post=0.4)
    sc.narr('他们都没有意识到，这十五秒，是一个人决定去做一件不可挽回的事情之前，最后的犹豫。', post=1.2)

    # ---------- corridor: the card ----------
    t_cor = sc.t
    sc.amb(sfx.hum(30, 50, 3, 0.012), t_cor, None, gain=-6)
    def cor(c, t, L):
        O.b_background(c, DAY)
        c.drawRect(skia.Rect(0, 0, L.w, L.h), paint(NIGHT, 0.30))
        corridor().draw(c, 1.0, 0.8)
        smudge(c, [(560, 360), (880, 360), (900, 1080), (540, 1080)], GRAPHITE, 0.10, 30)
        # the card, crisp print, held up then closed into a fist
        k_in = ease_out((t - 3.0) / 1.2)
        k_fist = ease_in_out((t - 10.5) / 1.5)
        if t > 3.0:
            s_ = 1.0 - 0.75 * k_fist
            c.save()
            c.translate(720, 560 + 60 * k_fist); c.scale(s_, s_ * (1 - 0.5 * k_fist))
            c.translate(-210, -120)
            O.card(c, 0, 0, a=k_in * (1 - 0.8 * k_fist), rot=-0.06, worn=1.0)
            c.restore()
    sc.layer(cor, t_cor, t_cor + 16.5, fin=0.8, fout=1.6)
    sc.caption('走廊里，张朝阳靠着墙站了一会儿。', start=t_cor + 0.3, dur=2.8)
    sc.caption('他从裤兜里摸出一张名片。名片边角已经被翻得起毛了。', start=t_cor + 3.3, dur=4.8)
    sc.sfx(sfx.paper_rustle(40, 0.6), at=t_cor + 3.0, gain=-10)
    sc.caption('他把名片攥在手心，深吸一口气，往楼梯口走去。', start=t_cor + 9.0, dur=4.6)
    sc.sfx(sfx.paper_rustle(41, 0.4), at=t_cor + 10.6, gain=-8)
    sc.sfx(sfx.footsteps(7, 0.62, 42, a=0.7), at=t_cor + 12.2, gain=-10, fout=2.5)
    sc.at(t_cor + 16.5)
    sc.finish(tail=0.4)
    return sc

@functools.lru_cache(maxsize=1)
def monitor_close():
    d = Drawing(seed=6202, width=2.2)
    d.rect(300, 250, 840, 520); d.rect(326, 276, 788, 468, w=1.2, a=0.5)
    d.line(720, 770, 720, 860); d.poly([(600, 900), (640, 860), (800, 860), (840, 900)])
    d.poly([(380, 960), (420, 920), (1020, 920), (1060, 960)], closed=True)
    return d

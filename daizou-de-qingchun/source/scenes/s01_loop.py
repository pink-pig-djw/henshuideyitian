"""第一场【循环】 内景 宿舍 日 — the eleventh morning of 5月9日."""
from film.config import *
from film.gfx import *
from film.timeline import Scene
from film import objects as O, sfx

PX, PY, PS = 200, 120, 1.0          # floor-plan placement (fixed "camera" of the A line)
RX = 1010                           # right column

def build():
    sc = Scene('s01_loop', kind='A', title='第一场【循环】')
    log = []                        # (t_appear, stamp, text)
    pos = {'李': ['li_bed'], '陈': ['chen_bed']}
    moves = []                      # (t0, t1, who, from, to)

    # ---- 0: black, the alarm melody ----
    sc.wait(0.6)
    t_alarm = sc.t
    sc.sfx(sfx.alarm(3), gain=-6)
    sc.wait(1.4)
    t_board = sc.t

    # ---- 1: macro of the bed board: the crack, third from the left ----
    def board(c, t, L):
        O.bed_board(c, L.w, L.h, 1.0)
        text(c, '上铺床板 · 从左向右第三条裂纹', 150, L.h - 150, 'sans-light', 22, A_INK, smooth((t - 1.0) / 0.8), tracking=0.2)
        text(c, '他每次醒来都看见', 150, L.h - 110, 'sans-light', 22, A_MID, smooth((t - 2.2) / 0.8), tracking=0.2)
    sc.layer(board, t_board, t_board + 5.2, fin=0.8, fout=0.6)
    sc.wait(5.2)

    # ---- 2: the phone: 5月9日 星期四 (he knows before he looks) ----
    t_phone = sc.t
    def phone(c, t, L):
        O.a_background(c, L.w, L.h)
        lit = smooth(t / 0.5)
        O.phone_screen(c, L.w / 2 - 150, 170, 300, 600, lit=lit, big='08:30', sub='5月9日 星期四')
        text(c, '不用看就知道上面写着什么。', L.w / 2, 900, 'sans-light', 26, A_MID, smooth((t - 1.2) / 0.6), 'center', tracking=0.2)
    sc.layer(phone, t_phone, t_phone + 4.6, fin=0.3, fout=0.5)
    sc.sfx(sfx.click(3, 2500, 0.03, 0.4), at=t_phone + 1.0, gain=-8)     # alarm silenced
    sc.wait(4.6)

    # ---- 3: the master shot: plan + clock + log ----
    t_master = sc.t
    sc.amb(sfx.room_tone(60, 1), t_master, None, gain=-2)
    log.append((t_master + 0.6, '08:30', '闹钟响起。同一段旋律，每一个音符都已经被听过太多遍。'))
    log.append((t_master + 3.0, '08:30', '李浩然睁开眼。没有猛然坐起，没有冷汗。'))
    sc.wait(5.0)
    t_siren = sc.t
    sc.sfx(sfx.siren(9.0), gain=-9)
    log.append((t_siren + 0.4, '08:31', '窗外警笛由远及近，停在楼下。和前几次一样，同一个位置。'))
    sc.wait(8.0)
    log.append((sc.t, '08:31', '李浩然把手机放下，翻身面朝墙壁。'))
    sc.sfx(sfx.paper_rustle(21, 0.9), gain=-10)
    sc.wait(3.2)

    sc.say('chen', '第几次了？', note='上铺', speed=0.8)
    sc.say('li', '我不数了。', speed=0.9, post=0.6)
    sc.say('chen', '我数了。第十一次。', post=0.4)
    t_count = sc.t - 1.2
    sc.say('li', '那又怎么样？十一次和一百一十一次有区别吗？每次醒过来，他都已经死了。', speed=0.98, post=1.4)

    log.append((sc.t, '08:33', '陈杰辉下了床，走到窗户前。没有拉开窗帘。'))
    moves.append((sc.t + 0.3, sc.t + 3.0, '陈', 'chen_bed', 'window'))
    sc.sfx(sfx.footsteps(4, 0.55, 3, a=0.5), at=sc.t + 0.4, gain=-12)
    sc.wait(3.6)
    sc.say('chen', '你有没有想过一个问题。')
    sc.say('li', '什么。', speed=0.9, post=0.5)
    sc.say('chen', '如果循环是一种惩罚，它惩罚的是什么？', sub_text='如果循环是一种惩罚——它惩罚的是什么？', post=1.6)
    log.append((sc.t - 1.3, '08:34', '李浩然没有回答。'))
    sc.say('chen', '我们又不是那个放贷的人。我们没有逼他还钱，没有恐吓他，没有跟踪他。我们什么都没有做。', post=0.5)
    sc.say('li', '对啊。我们什么都没做。', speed=0.95, post=1.0)
    sc.say('chen', '也许这就是答案。', sub_text='……也许这就是答案。', speed=0.9, post=2.4)
    sc.say('chen', '前面十次，我们一直在查他怎么死的。也许循环要的不是答案，是我们真的理解，他为什么活不下去。', post=0.4)
    sc.say('chen', '不是同一回事。', speed=0.92, post=1.4)
    log.append((sc.t, '08:36', '李浩然慢慢坐了起来。'))
    moves.append((sc.t + 0.2, sc.t + 1.6, '李', 'li_bed', 'li_desk'))
    sc.sfx(sfx.paper_rustle(22, 1.0), gain=-12)
    sc.wait(2.0)
    sc.say('li', '那从哪开始？', speed=0.95, post=0.5)
    sc.say('chen', '从头开始。从我们住在一起的第一天开始。', speed=0.95, post=2.2)
    t_end_master = sc.t

    def spot_at(who, t):
        spot = pos[who][0]
        xy = O.plan_xy(PX, PY, PS, spot)
        for (t0, t1, w, a_, b_) in moves:
            if w != who or t < t0:
                continue
            A = O.plan_xy(PX, PY, PS, a_); B = O.plan_xy(PX, PY, PS, b_)
            k = ease_in_out(ramp(t, t0, t1))
            xy = (A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k)
        return xy

    def master(c, t, L):
        T = L.T
        O.a_background(c, L.w, L.h)
        O.floorplan(c, PX, PY, PS, empty_alpha=0.55)
        for who in ('李', '陈'):
            x, y = spot_at(who, T)
            O.person_dot(c, x, y, who)
        # the empty chair at Zhang's desk
        zx, zy = O.plan_xy(PX, PY, PS, 'zhang_desk')
        text(c, '空', zx - 8, zy + 7, 'sans-light', 16, A_MID, 0.8)
        # siren marker outside the window
        if T > t_siren:
            k = (T - t_siren)
            wx, wy = O.plan_xy(PX, PY, PS, 'window')
            ring = (k * 0.8) % 1.0
            aa = min(1.0, k / 1.5) * (1.0 if k < 9 else max(0.25, 1 - (k - 9) / 3))
            c.drawCircle(wx + 120, wy - 60, 6, paint(A_INK, aa))
            c.drawCircle(wx + 120, wy - 60, 6 + 30 * ring, paint(A_INK, aa * (1 - ring) * 0.5, 1.2))
            text(c, '楼下 · 警车', wx + 140, wy - 54, 'sans-light', 17, A_MID, aa, tracking=0.2)
        stamp = [e[1] for e in log if e[0] <= T]
        O.clock_card(c, RX, 210, 1.0, time=stamp[-1] if stamp else '08:30')
        if T > t_count:
            O.loop_counter(c, 1620, 150, 11, smooth((T - t_count) / 0.6))
        O.event_log(c, RX, 420, log, T, maxw=780)
    sc.layer(master, t_master, None, fin=0.6, fout=1.2)
    sc.finish(tail=0.6)
    return sc

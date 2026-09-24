"""第五场【循环】 内景 宿舍 日 — the thirteenth morning of 5月9日.
The rebuilt contract under Zhang's desk lamp. Everything matches — until a finger reaches the
edge of line four. 「月」."""
import math, functools
import numpy as np
import skia
from film.config import *
from film.gfx import *
from film.timeline import Scene
from film import objects as O, sfx
from film.audio import reverb, lowpass, bandpass, highpass, env_fade
from scenes.s03_loop import (Master, tear_geometry, draw_piece, piece_index, slide, dot, a_bg, NR, NC,
                             PX, PY, PS, RX, SAMP)

LOOP = 13
S_L = 0.88                          # the contract under the lamp
LX0, LY0 = 300, 40
MS = 3.1                            # magnification of the edge insert (page units -> px)
FOCUS = (620.0, 434.0)              # page point (trim line, line-4 baseline) ...
FOCUS_AT = (1360.0, 430.0)          # ... placed here on screen in the insert
LINE4 = '四、利率：百分之十五'

@functools.lru_cache(maxsize=1)
def residuals():
    """The rebuilt contract: every piece back, each a hair off (seams show). The 月 piece is exact."""
    rng = np.random.default_rng(513)
    out = {}
    for i in range(NR):
        for j in range(NC):
            out[i, j] = (rng.uniform(-0.7, 0.7), rng.uniform(-0.7, 0.7), rng.uniform(-0.25, 0.25))
    out[3, 3] = (0.0, 0.0, 0.0)
    return out

def draw_rebuilt(c, x0, y0, s):
    for (i, j), (dx, dy, dr) in residuals().items():
        draw_piece(c, piece_index(i, j), s, x0 + dx * s, y0 + dy * s, dr)

def draw_yue(c, x0, y0, s, red, a=1.0):
    """Overdraw the tiny 月 in red (same glyph, same place as O.contract_page draws it)."""
    if red <= 0:
        return
    yx, yy = 611.0 * s, 434.0 * s
    text(c, '月', x0 + yx, y0 + yy, 'serif', 12 * s, RED, a * red, 'right')

def char_xs(s, line=LINE4):
    """Left x of every character of a clause line (page-local, scaled)."""
    mx = 58 * s
    xs = [mx]
    for k in range(1, len(line) + 1):
        xs.append(mx + text_width(line[:k], 'serif', 16 * s))
    return xs

def lamp_light(c, x, y, r, w, h, a=1.0, dark=0.10):
    """The desk lamp: a faint warm pool (the only warm light in the A line); the room a shade darker."""
    if dark > 0:
        sh = skia.GradientShader.MakeRadial((x, y), r * 2.0, [col(A_INK, 0), col(A_INK, dark * a)], [0.4, 1.0])
        c.drawRect(skia.Rect(0, 0, w, h), skia.Paint(Shader=sh))
    g = skia.GradientShader.MakeRadial((x, y), r, [col(LAMP, 0.42 * a), col(LAMP, 0.18 * a), col(LAMP, 0)], [0, 0.5, 1])
    c.drawRect(skia.Rect(0, 0, w, h), skia.Paint(Shader=g, BlendMode=skia.BlendMode.kMultiply))

@functools.lru_cache(maxsize=2)
def lamp_base(red=0):
    """The static part of the lamp shot: table, lamp, the rebuilt contract, the warm pool."""
    surf = skia.Surface(W, H); c = surf.getCanvas()
    a_bg(c)
    # the lamp (top-left, seen from above: round base, the arm reaching out of frame)
    c.drawCircle(160, 88, 66, paint(A_INK, 0.45, 1.3))
    c.drawCircle(160, 88, 52, paint(A_INK, 0.2, 1.0))
    c.drawCircle(160, 88, 7, paint(A_INK, 0.45, 1.2))
    line(c, 160, 88, 250, -10, A_INK, 0.45, 1.3)
    line(c, 166, 94, 258, -6, A_INK, 0.25, 1.0)
    draw_rebuilt(c, LX0, LY0, S_L)
    draw_yue(c, LX0, LY0, S_L, float(red))
    lamp_light(c, 520, 330, 760, W, H)
    return surf.makeImageSnapshot().withDefaultMipmaps()

def check_mark(c, x, y, size, a, rgb=A_INK):
    if a <= 0:
        return
    p = skia.Path()
    p.moveTo(x, y - size * 0.45); p.lineTo(x + size * 0.35, y - size * 0.05); p.lineTo(x + size, y - size * 0.9)
    c.drawPath(p, paint(rgb, a, 1.8))

# ---------------- the edge insert (static; cached) ----------------
@functools.lru_cache(maxsize=1)
def macro_image():
    w, h = W, H
    surf = skia.Surface(w, h)
    c = surf.getCanvas()
    O.a_background(c, w, h)
    fx, fy = FOCUS; sx, sy = FOCUS_AT
    ox, oy = sx - fx * MS, sy - fy * MS                  # page origin on screen
    # edge shadow on the table
    sh = paint((10, 16, 24), 0.22); sh.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 10))
    c.drawRect(skia.Rect.MakeXYWH(ox + 6, oy + 10, O.CONTRACT_W * MS, O.CONTRACT_H * MS), sh)
    # the page, drawn crisp at the macro scale, then cut along the same tears (seams visible)
    M_ = 24                                              # margin, so residual shifts never expose an edge
    page = skia.Surface(w + 2 * M_, h + 2 * M_); pc = page.getCanvas(); pc.clear(skia.ColorTRANSPARENT)
    O.contract_page(pc, ox + M_, oy + M_, s=MS, shadow=False)
    img = page.makeImageSnapshot()
    for (i, j), (dx, dy, dr) in residuals().items():
        poly = tear_geometry()[piece_index(i, j)]['poly']
        path = skia.Path()
        path.moveTo(ox + poly[0][0] * MS, oy + poly[0][1] * MS)
        for q in poly[1:]:
            path.lineTo(ox + q[0] * MS, oy + q[1] * MS)
        path.close()
        c.save()
        c.translate(dx * 1.3, dy * 1.3)
        c.clipPath(path, skia.ClipOp.kIntersect, True)
        c.drawImage(img, -M_, -M_)
        c.drawPath(path, paint((255, 255, 255), 0.8, 1.6))
        c.drawPath(path, paint((150, 150, 150), 0.16, 0.7))
        c.restore()
    lamp_light(c, sx - 380, sy - 40, 1100, w, h, 0.85, dark=0.06)
    sharp = surf.makeImageSnapshot()
    # shallow depth of field: only a band around line four is in focus
    out = skia.Surface(w, h); oc = out.getCanvas()
    bp = skia.Paint(); bp.setImageFilter(skia.ImageFilters.Blur(7.0, 7.0, skia.TileMode.kClamp))
    oc.drawImage(sharp, 0, 0, skia.SamplingOptions(), bp)
    oc.saveLayer(None, None)
    oc.drawImage(sharp, 0, 0)
    band = skia.GradientShader.MakeLinear(
        [(0, sy - 150), (0, sy + 120)],
        [col(BLACK, 0), col(BLACK, 1), col(BLACK, 1), col(BLACK, 0)], [0.0, 0.36, 0.7, 1.0])
    mp = skia.Paint(Shader=band, BlendMode=skia.BlendMode.kDstIn)
    oc.drawRect(skia.Rect(0, 0, w, h), mp)
    oc.restore()
    # the lower third falls out of the light (keeps the transcript clean)
    fall = skia.GradientShader.MakeLinear([(0, 600), (0, 960)], [col(A_BG, 0), col(A_BG, 0.86)], [0, 1])
    oc.drawRect(skia.Rect(0, 600, w, h), skia.Paint(Shader=fall))
    top = skia.GradientShader.MakeLinear([(0, 0), (0, 300)], [col(A_BG, 0.5), col(A_BG, 0)], [0, 1])
    oc.drawRect(skia.Rect(0, 0, w, 300), skia.Paint(Shader=top))
    return out.makeImageSnapshot().withDefaultMipmaps(), (ox, oy)

# ---------------- sounds ----------------
def _tt(d):
    return np.arange(int(d * SR)) / SR

def finger_audio(times, d, seed=520):
    """A fingertip on paper: a faint continuous rub, and a soft tap on every character."""
    rng = np.random.default_rng(seed)
    out = np.zeros(int(d * SR), np.float32)
    rub = bandpass(sfx.noise(d, seed), 1200, 4500) * 0.012
    out += rub.astype(np.float32)
    for k, t in enumerate(times):
        dd = 0.035
        tap = bandpass(sfx.noise(dd, seed + k + 1), 1800, 6500) * np.exp(-_tt(dd) * 120) * rng.uniform(0.10, 0.16)
        s = int(t * SR)
        if s + len(tap) < len(out):
            out[s:s + len(tap)] += tap.astype(np.float32)
    return env_fade(out, 0.15, 0.2)

def lamp_click(seed=521):
    x = sfx.click(seed, 1400, 0.05, 0.7)
    y = sfx.click(seed + 1, 2600, 0.02, 0.3)
    out = np.zeros(int(0.12 * SR), np.float32)
    out[:len(x)] += x; out[int(0.03 * SR):int(0.03 * SR) + len(y)] += y
    return out

def build():
    sc = Scene('s05_loop', kind='A', title='第五场【循环】')
    M = Master(LOOP, {'李': 'li_bed', '陈': 'chen_bed'})

    # ---------- the ritual, shorter still ----------
    sc.wait(0.4)
    t_alarm = sc.t
    al = sfx.alarm(2)
    cut = int(2.35 * SR)
    sc.sfx(env_fade(al[:cut], 0.0, 0.04), gain=-6)
    sc.wait(0.5)
    t_board = sc.t
    def board(c, t, L):
        O.bed_board(c, L.w, L.h, 1.0)
    sc.layer(board, t_board, t_board + 2.1, fin=0.45, fout=0.3)
    sc.wait(1.85)
    t_master = sc.t
    sc.sfx(sfx.click(4, 2500, 0.03, 0.4), at=t_alarm + 2.35, gain=-8)
    sc.amb(sfx.room_tone(60, 1), t_master, None, gain=-2)
    M.counter_from = t_master + 0.8
    M.say_log(t_master + 0.4, '08:30', '闹钟。')
    M.t_siren = t_master + 1.2
    sc.sfx(sfx.siren(9.0), at=M.t_siren, gain=-13)
    M.say_log(t_master + 3.0, '08:31', '警笛。同一个位置。')
    sc.wait(5.2)
    # they know where the pieces are now
    t = sc.t
    M.say_log(t, '08:47', '碎纸又一次从垃圾桶底部捞了出来，重新拼好。')
    M.say_log(t + 2.6, '08:47', '这一次，一片都没有少。')
    M.moves.append((t + 0.2, t + 2.4, '李', 'li_bed', (3.46, 5.05)))
    M.left['李'] = lambda T: True
    M.moves.append((t + 3.4, t + 5.0, '李', (3.46, 5.05), (2.9, 3.62)))
    M.moves.append((t + 0.6, t + 3.6, '陈', 'chen_bed', (2.55, 4.45)))
    sc.sfx(sfx.footsteps(4, 0.55, 511, a=0.5), at=t + 0.3, gain=-12)
    sc.sfx(sfx.paper_rustle(512, 0.8), at=t + 2.6, gain=-10, pan=0.3)
    sc.sfx(sfx.footsteps(3, 0.55, 513, a=0.45), at=t + 3.5, gain=-13)
    for k in range(4):
        sc.sfx(slide(530 + k, 0.35), at=t + 5.0 + k * 0.5, gain=-12, pan=0.2)
    sc.wait(6.8)
    t = sc.t
    M.say_log(t, '08:48', '陈杰辉把拼好的合同重新摊在张朝阳的台灯下。')
    M.lamp = t + 1.4
    sc.sfx(lamp_click(), at=M.lamp, gain=-6, pan=0.3)
    sc.wait(3.2)
    M.say_log(sc.t, '08:48', '李浩然凑过来，几乎把鼻子贴在纸上。')
    sc.wait(3.0)
    t_lamp = sc.t

    # ---------- under the lamp: everything matches ----------
    LYt = O.contract_layout(S_L)
    rows = [('借款金额', '陆仟元整', 5, '一、借款金额：'), ('利　　率', '百分之十五', 8, '四、利率：'),
            ('借款期限', '六个月', 6, '二、借款期限：')]
    checks = {}
    lamp_log = []
    rate_fix = [None]                      # time the table learns about 月
    ring_t = [None]; sign_t = [None]
    finger = dict(t0=None, steps=[], end=None)

    def lamp_view(c, t, L):
        T = L.T
        c.drawImage(lamp_base(1 if (rate_fix[0] is not None and T > rate_fix[0]) else 0), 0, 0, SAMP)
        # underline what was checked
        for n, (lab, val, k_, pre) in enumerate(rows):
            if n not in checks or T < checks[n]:
                continue
            u = ease_out((T - checks[n]) / 0.45)
            x0 = LX0 + 58 * S_L + text_width(pre, 'serif', 16 * S_L)
            x1 = x0 + text_width(val, 'serif', 16 * S_L)
            yb = LY0 + LYt['ys'][k_] + 5
            line(c, x0, yb, x0 + (x1 - x0) * u, yb, A_INK, 0.75, 1.3)
        # the finger: a caret stepping along the clauses
        if finger['t0'] is not None and finger['t0'] <= T and (rate_fix[0] is None or T < rate_fix[0]):
            _draw_finger(c, T, finger)
        # ring on the tiny 月; underline under the signature
        if ring_t[0] is not None and T > ring_t[0]:
            u = ease_out((T - ring_t[0]) / 0.6)
            cx, cy = LX0 + 606 * S_L, LY0 + 430 * S_L
            c.drawCircle(cx, cy, 30 - 12 * u, paint(A_INK, 0.8 * u, 1.3))
        if sign_t[0] is not None and T > sign_t[0]:
            u = ease_out((T - sign_t[0]) / 0.7)
            sx0 = LX0 + 505 * S_L; sy0 = LY0 + LYt['sign_y'] + 8
            line(c, sx0, sy0, sx0 + 84 * S_L * u, sy0, A_INK, 0.75, 1.3)
        # right column: the check, then the log
        text(c, '核对', RX, 150, 'sans-light', 18, A_MID, smooth((t - 0.5) / 0.6), tracking=0.4)
        line(c, RX, 170, RX + 520, 170, A_MID, 0.4 * smooth((t - 0.5) / 0.6), 1.0)
        for n, (lab, val, k_, pre) in enumerate(rows):
            if n not in checks or T < checks[n]:
                continue
            u = smooth((T - checks[n]) / 0.35)
            y = 222 + n * 56
            text(c, lab, RX, y, 'sans-light', 26, A_MID, u, tracking=0.05)
            wv = text(c, val, RX + 150, y, 'sans-light', 26, A_INK, u)
            ck = u
            if n == 1 and rate_fix[0] is not None and T > rate_fix[0]:
                v = smooth((T - rate_fix[0]) / 0.8)
                ck = u * (1 - 0.8 * v)
                text(c, '/ ', RX + 150 + wv + 8, y, 'sans-light', 26, A_MID, v)
                text(c, '月', RX + 150 + wv + 8 + text_width('/ ', 'sans-light', 26), y, 'sans-light', 26, RED, v)
            check_mark(c, RX + 470, y - 4, 22, ck)
        O.event_log(c, RX, 430, lamp_log, T, maxw=780)

    # the reading
    sc.wait(1.2)
    s1, e1 = sc.say('chen', '金额对得上，利率对得上，期限对得上。', tts='金额对的上，利率对的上，期限对的上。', post=0.4)
    d1 = e1 - s1
    checks[0] = s1 + d1 * 0.2; checks[1] = s1 + d1 * 0.52; checks[2] = s1 + d1 * 0.8
    sc.say('chen', '这合同看着没问题。', speed=0.92, post=0.6)
    sc.say('li', '那他为什么撕了？', speed=0.95, post=0.6)
    sc.say('chen', '人不会撕一份“没问题”的合同。', post=0.3)
    sc.say('chen', '一定有什么我们没看到。', speed=0.95, post=1.0)
    lamp_log.append((sc.t, '08:49', '两人反复看了几遍。'))
    sc.sfx(sfx.paper_rustle(540, 0.7), at=sc.t + 0.3, gain=-12)
    sc.wait(2.6)
    # the finger, character by character
    t_f = sc.t
    lamp_log.append((t_f + 0.2, '08:51', '李浩然的手指沿着条款，一个字一个字地滑过去——'))
    steps = []          # (t, line_k, x_left_scaled, width)
    tt = t_f + 0.4
    for k_, txt, dt in ((5, '一、借款金额：陆仟元整', 0.06), (6, '二、借款期限：六个月，自签订之日起计算。', 0.05),
                        (7, '三、借款用途：个人生活周转。', 0.055)):
        xs = char_xs(S_L, txt)
        for q in range(len(txt)):
            steps.append((tt, k_, xs[q], xs[q + 1] - xs[q])); tt += dt
        tt += 0.3
    xs = char_xs(S_L)
    for q in range(len(LINE4)):
        steps.append((tt, 8, xs[q], xs[q + 1] - xs[q])); tt += 0.26
    # past the end of the words: empty paper, one character-width at a time
    x = xs[-1]; cw = 16 * S_L; n_blank = 0
    x_yue = 611 * S_L - 12 * S_L
    while x + cw < x_yue:
        steps.append((tt, 8, x, cw)); x += cw; n_blank += 1
        tt += 0.085 + 0.007 * n_blank
    steps.append((tt + 0.25, 8, x_yue, 12 * S_L))
    t_stop = tt + 0.25
    finger['t0'] = t_f + 0.4; finger['steps'] = steps; finger['end'] = t_stop
    fa = finger_audio([s_[0] - t_f for s_ in steps], t_stop - t_f + 0.6)
    sc.sfx(fa, at=t_f, gain=-1, pan=0.1)
    lamp_log.append((t_stop + 0.3, '08:52', '手指停在第四行的最右边。'))
    sc.at(t_stop + 2.2)
    t_C = sc.t

    # ---------- the edge of the page ----------
    macro_notes = [(t_C + 0.7, '08:52', '纸张边缘。一个字。'),
                   (t_C + 2.5, '08:52', '比其他字小了一号。'),
                   (t_C + 4.3, '08:52', '几乎被纸的裁切线吞掉。')]
    t_red = t_C + 6.4
    def macro(c, t, L):
        T = L.T
        img, (ox, oy) = macro_image()
        c.drawImage(img, 0, 0, SAMP)
        # measure: body-text cap line and baseline carried across to the edge
        u = smooth((T - (t_C + 2.5)) / 0.8)
        if u > 0:
            p = paint(A_MID, 0.55 * u, 1.0); p.setPathEffect(skia.DashPathEffect.Make([4.0, 5.0], 0.0))
            yb = oy + 434 * MS
            x0 = ox + 186 * MS; x1 = ox + 620 * MS - 6
            top_body = yb - 0.79 * 16 * MS
            c.drawLine(x0, top_body, x0 + (x1 - x0) * u, top_body, p)
            c.drawLine(x0, yb + 2, x0 + (x1 - x0) * u, yb + 2, p)
        red = smooth((T - t_red) / 1.4)
        if red > 0:
            text(c, '月', ox + 611 * MS, oy + 434 * MS, 'serif', 12 * MS, RED, red, 'right')
        O.event_log(c, 1420, 190, macro_notes, T, maxw=470)
    sc.layer(macro, t_C - 0.12, None, fin=0.12, fout=0.3, name='macro')
    sc.at(t_red + 0.2)
    sc.say('li', '月。', speed=0.8, post=0.9)
    sc.say('chen', '什么？', speed=0.84, post=0.6)
    sc.say('li', '月。月利率。不是年利率。百分之十五是月利率。', post=0.8)
    macro_notes.append((sc.t, '08:53', '两人对视。'))
    sc.wait(2.4)
    t_D = sc.t
    for ly in sc.layers:
        if ly.name == 'macro':
            ly.end = t_D + 0.35
    rate_fix[0] = t_D

    # ---------- the arithmetic ----------
    arith = {}
    def ledger(c, t, L):
        T = L.T
        a_bg(c)
        ax, bx = 1000, 1080            # right edge of the expressions / left edge of the results
        big = 92
        def show(key, dur=0.6):
            return smooth((T - arith[key]) / dur) if key in arith and T > arith[key] else 0.0
        # line 1: 6000 × 15%  =  900 / 月
        a1 = show('lhs'); a1b = show('rhs')
        y1 = 400
        text(c, '6000 × 15%', ax, y1, 'sans-xlight', big, A_INK, a1, 'right')
        text(c, '=', (ax + bx) / 2, y1, 'sans-xlight', big * 0.8, A_MID, a1b, 'center')
        w9 = text(c, '900', bx, y1, 'sans-xlight', big, A_INK, a1b)
        text(c, '/', bx + w9 + 22, y1, 'sans-xlight', big * 0.8, A_MID, a1b)
        text(c, '月', bx + w9 + 22 + text_width('/', 'sans-xlight', big * 0.8) + 16, y1, 'sans-light', big * 0.8, RED, a1b)
        # line 2: 年化 180%
        a2 = show('ann'); y2 = 570
        text(c, '年化', ax, y2, 'sans-light', 38, A_MID, a2, 'right', tracking=0.3)
        text(c, '180%', bx, y2, 'sans-xlight', big, A_INK, a2)
        # rule
        line(c, bx - 380, 640, bx + 420, 640, A_MID, 0.35 * show('thought', 1.0), 1.0)
        # line 3: 他以为：450
        a3 = show('thought', 0.9); y3 = 740
        text(c, '他以为：', ax, y3, 'sans-light', 38, A_MID, a3, 'right', tracking=0.2)
        text(c, '450', bx, y3, 'sans-xlight', big * 0.82, A_MID, a3)
    sc.layer(ledger, t_D - 0.3, None, fin=0.4, fout=0.5, name='ledger')
    sc.wait(0.6)
    s2, e2 = sc.say('chen', '六千块，月息九百。', speed=0.92, post=0.35)
    arith['lhs'] = s2 + 0.15; arith['rhs'] = s2 + (e2 - s2) * 0.5
    s3, e3 = sc.say('chen', '年化百分之一百八十。', speed=0.92, post=1.1)
    arith['ann'] = s3 + 0.3
    s4, e4 = sc.say('li', '他签字的时候以为利息是四百五……', tts='他签字的时候以为利息是四百五。', speed=0.95, post=1.6)
    arith['thought'] = s4 + (e4 - s4) * 0.62
    t_E = sc.t
    for ly in sc.layers:
        if ly.name == 'ledger':
            ly.end = t_E + 0.4

    # ---------- back under the lamp: how small, and whose signature ----------
    sc.layer(lamp_view, t_lamp - 0.3, t_C + 0.12, fin=0.5, fout=0.12)
    sc.layer(lamp_view, t_E - 0.1, None, fin=0.5, fout=0.4, name='lamp2')
    sc.wait(0.5)
    s5, e5 = sc.say('chen', '那个字只有这么大。印在纸的最边上。', speed=0.95, post=0.4)
    ring_t[0] = s5 + 0.5
    sc.say('chen', '不一个字一个字看，根本看不到。', speed=0.95, post=1.2)
    s6, e6 = sc.say('li', '但合同是他自己签的。', speed=0.95, post=1.0)
    sign_t[0] = s6 + (e6 - s6) * 0.5
    sc.say('chen', '对。合同是他自己签的。', speed=0.92, post=0.35)
    sc.say('chen', '名片是他自己拿的。钱是他自己借的。', speed=0.92, post=0.6)
    t_F = sc.t
    for ly in sc.layers:
        if ly.name == 'lamp2':
            ly.end = t_F + 0.6

    # ---------- the plan again: the question nobody answers ----------
    M.say_log(t_F + 0.8, '08:55', '长久的沉默。')
    sc.wait(6.0)
    sc.say('chen', '可是他为什么非得借？', speed=0.9, post=0.6)
    M.say_log(sc.t, '08:56', '李浩然没有回答。他不需要回答。他们都知道。')
    sc.wait(4.2)

    def master(c, t, L):
        M.draw(c, L.T, L.w, L.h)
    sc.layer(master, t_master, t_lamp + 0.3, fin=0.6, fout=0.3)
    sc.layer(master, t_F, None, fin=0.6, fout=1.6)
    sc.amb(sfx.hum(20, 100, 542, 0.004), t_lamp, t_F + 0.6, gain=-14)
    # a low drone from the red 月 until the silence before the last question
    sc.amb(sfx.drone(40, 41.0, 541), t_red - 0.4, t_F + 3.0, gain=-15, fin=3.0, fout=4.0, bus='music')
    sc.finish(tail=1.0)
    return sc

def _draw_finger(c, T, f):
    steps = f['steps']
    cur = None
    for s_ in steps:
        if s_[0] <= T:
            cur = s_
        else:
            break
    if cur is None:
        return
    t_s, k_, x, w = cur
    LYt = O.contract_layout(S_L)
    yb = LY0 + LYt['ys'][k_]
    # a faint trail along the current line, from its start to the fingertip
    first = next(s_ for s_ in steps if s_[1] == k_)
    x_start = first[2]
    line(c, LX0 + x_start, yb + 6, LX0 + x + w, yb + 6, A_MID, 0.55, 1.0)
    # the fingertip: a caret at the character's right edge, and a soft round shadow under it
    fx = LX0 + x + w
    stopped = f['end'] is not None and T >= f['end']
    sh = paint((10, 16, 24), 0.16); sh.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 6))
    c.drawOval(skia.Rect.MakeXYWH(fx - 9, yb + 8, 26, 16), sh)
    line(c, fx + 2, yb + 5, fx + 2, yb - 17, A_INK, 0.9, 1.6)
    c.drawCircle(fx + 2, yb + 9, 3.2, paint(A_INK, 0.9))
    if stopped:
        u = (T - f['end'])
        if u < 1.2:
            r = 8 + 26 * ease_out(u / 1.2)
            c.drawCircle(fx - 4, yb - 6, r, paint(A_INK, 0.5 * (1 - u / 1.2), 1.1))

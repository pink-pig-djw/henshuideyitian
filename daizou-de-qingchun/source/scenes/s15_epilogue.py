"""尾声 — 黑场。白色字幕逐行浮现.

Facts, then help, then the five seconds, then a brief credit. No music, no voice.
Reading time: about one second per six characters, never less.
The only colour is the one the film has taught: the 月 of 「月利率」 turns red, as it did on the
contract, and the 贷 of the title in the credit."""
import math
from film.config import *
from film.gfx import *
from film.timeline import Scene
from film import sfx

COL_X, COL_W = 400, 1120             # text column
SIZE, LH = 34, 1.9
INK = WHITE
DIM = (178, 178, 174)
FONT = 'serif-light'
TR = 0.04

def read_time(s, per=6.0, floor=3.0):
    n = sum(1 for ch in s if not ch.isspace())
    return max(floor, n / per)

def _lines(s, size=SIZE, font=FONT, maxw=COL_W):
    return wrap(s, font, size, maxw, TR)

def block_x(paras, size=SIZE, extra=()):
    """Left edge that centres a left-aligned block on the frame."""
    ws = [text_width(ln, FONT, size, TR) for p in paras for ln in _lines(p, size)] + list(extra)
    return (W - max(ws)) / 2

def para_height(s, size=SIZE, lh=LH):
    return len(_lines(s, size)) * size * lh

def fade_in(t, t0, d=1.4):
    return smooth((t - t0) / d)

def draw_para(c, s, x, y, t, t0, size=SIZE, rgb=INK, a=0.93, lh=LH, font=FONT, spans=None):
    """Paragraph whose baseline starts at y; fades in (with a small rise) from t0.
    spans: {char_index: rgb} colours single characters (by index in s)."""
    k = fade_in(t, t0)
    if k <= 0:
        return
    dy = 8 * (1 - k)
    idx = 0
    for i, ln in enumerate(_lines(s, size, font)):
        yy = y + dy + i * size * lh
        if not spans or not any(idx <= j < idx + len(ln) for j in spans):
            text(c, ln, x, yy, font, size, rgb, a * k, tracking=TR)
        else:
            cx = x
            for j, ch in enumerate(ln):
                crgb = spans.get(idx + j, rgb)
                text(c, ch, cx, yy, font, size, crgb, a * k)
                cx += text_width(ch, font, size) + TR * size
        idx += len(ln)

def build():
    sc = Scene('s15_epilogue', kind='X', frame='16:9', title='尾声')
    sc.sub_color = WHITE
    sc.grain = 0.06

    sc.wait(1.6)
    t_start = sc.t

    # ------------------------------------------------------------------
    # page 1: what the police found; the arrest
    # ------------------------------------------------------------------
    P1 = ['经警方查明，肖强长期以远超法定上限的利率面向在校大学生非法放贷，\n并采用恐吓、跟踪、威胁家属等手段催收非法债务。',
          '依据《刑法》第二百九十三条之一（催收非法债务罪）\n及第二百七十四条（敲诈勒索罪），肖强已被依法批准逮捕。']
    # page 2: the law on interest; this film's rate (the 月 turns red)
    RATE = '本片中的月利率 15%，年化 180%，远超法定上限。'
    P2 = ['根据最高人民法院相关司法解释，民间借贷利率超过合同成立时\n一年期贷款市场报价利率（LPR）四倍的部分，不受法律保护。',
          RATE]
    # page 3: the father
    P3 = ['张朝阳的父亲在得知真相后，向公安机关提起刑事控告。']

    def text_page(paras, starts, spans_fn=None, gap=34):
        x0 = block_x(paras)
        hs = [para_height(p) for p in paras]
        total = sum(hs) + gap * (len(paras) - 1)
        y0 = H / 2 - total / 2 + SIZE * 0.8
        ys = []
        y = y0
        for h_ in hs:
            ys.append(y); y += h_ + gap
        def draw(c, t, L):
            T = L.T
            for i, (p, y_, t0) in enumerate(zip(paras, ys, starts)):
                spans = spans_fn(i, T) if spans_fn else None
                draw_para(c, p, x0, y_, T, t0, spans=spans)
        return draw

    def run_page(paras, lead=0.0, between=0.9, hold_after=2.0, fout=1.4, spans_fn=None, extra=0.0):
        """Paragraphs appear one after another, each given its reading time."""
        t0 = sc.t
        starts = []
        t = t0 + lead
        for p in paras:
            starts.append(t)
            t += 1.4 + read_time(p) + between
        end = t - between + hold_after + extra
        sc.layer(text_page(paras, starts, spans_fn), t0, end + fout, fin=0.0, fout=fout)
        sc.at(end + fout)
        return starts, end

    # page 1
    run_page(P1, hold_after=2.2, between=0.7)
    sc.wait(1.0)
    # page 2 — the 月 of 月利率 reddens once the line has been read
    yue_i = RATE.index('月')
    t_p2 = sc.t
    holder = {}
    def spans_p2(i, T):
        if i != 1:
            return None
        k = smooth((T - holder['t_red']) / 1.6)
        return {yue_i: mix(INK, RED, k)} if k > 0 else None
    starts, _ = run_page(P2, hold_after=3.4, between=0.7, spans_fn=spans_p2)
    holder['t_red'] = starts[1] + 1.4 + 2.2
    sc.wait(1.0)
    # page 3
    run_page(P3, lead=0.2, hold_after=2.6, fout=1.6)

    # 停顿
    sc.wait(3.6)

    # ------------------------------------------------------------------
    # page 4: help
    # ------------------------------------------------------------------
    t_help = sc.t
    LEAD = '如果你或身边的人正在经历心理困扰，请拨打：'
    LINES = [('全国统一心理援助热线', '12356', ''),
             ('希望24热线', '400-161-9995', '（24小时）')]
    POLICE = '遭遇非法放贷或暴力催收，请拨打 110 报警，\n并保留合同、转账记录与通话录音作为证据。'
    s_lead = t_help
    s_l1 = s_lead + 1.4 + read_time(LEAD) + 0.4
    s_l2 = s_l1 + 2.6
    s_pol = s_l2 + 3.2
    help_end = s_pol + 1.4 + read_time(POLICE) + 5.5       # numbers need time to be noted down
    y_lead = 360
    y_l1, y_l2 = y_lead + 118, y_lead + 196
    y_pol = y_l2 + 118
    HX = block_x([LEAD, POLICE], extra=[40 + 520 + text_width('400-161-9995', 'sans-light', 42, 0.04) + 14 + text_width('（24小时）', FONT, 28)])
    NUM_X = HX + 520
    def help_page(c, t, L):
        T = L.T
        draw_para(c, LEAD, HX, y_lead, T, s_lead)
        for (name, num, note_), yy, t0 in ((LINES[0], y_l1, s_l1), (LINES[1], y_l2, s_l2)):
            k = fade_in(T, t0)
            if k <= 0:
                continue
            dy = 8 * (1 - k)
            text(c, name, HX + 40, yy + dy, FONT, 38, INK, 0.95 * k, tracking=0.06)
            w_ = text(c, num, NUM_X, yy + dy, 'sans-light', 42, INK, 0.97 * k, tracking=0.04)
            if note_:
                text(c, note_, NUM_X + w_ + 14, yy + dy, FONT, 28, DIM, 0.9 * k)
        draw_para(c, POLICE, HX, y_pol, T, s_pol, rgb=INK, a=0.9)
    sc.layer(help_page, t_help, help_end + 1.4, fout=1.4)
    sc.at(help_end + 1.4)

    # ------------------------------------------------------------------
    # page 5: the five seconds
    # ------------------------------------------------------------------
    sc.wait(2.2)
    FIVE_A = '张朝阳走到门口的时候停了五秒。'
    FIVE_B = '五秒够你回一次头。'
    t_a = sc.t
    A_IN = 2.0
    t_b = t_a + A_IN + read_time(FIVE_A, floor=3.0) + 5.0     # read it, then five real seconds
    five_end = t_b + A_IN + 8.0
    def five(c, t, L):
        T = L.T
        ka = smooth((T - t_a) / A_IN)
        kb = smooth((T - t_b) / A_IN)
        text(c, FIVE_A, W / 2, 500, FONT, 40, INK, 0.94 * ka, 'center', tracking=0.1)
        text(c, FIVE_B, W / 2, 612, FONT, 40, INK, 0.94 * kb, 'center', tracking=0.1)
    sc.layer(five, t_a, five_end + 3.0, fout=3.0)
    # the roof door: a breath of wind while he stands there, gone before the second line
    sc.sfx(sfx.wind(t_b - t_a + 1.0, 17, 0.5), at=t_a + 0.4, gain=2, fin=2.5, fout=2.2, bus='amb')
    sc.at(five_end + 3.0)

    # ------------------------------------------------------------------
    # credit
    # ------------------------------------------------------------------
    sc.wait(2.4)
    t_cr = sc.t
    CREDITS = [('原著剧本', [('《「', None), ('贷', RED), ('」走的青春》微电影剧本（终稿）', None)]),
               ('影像与声音', [('程序生成', None)]),
               ('配音', [('ZipVoice 零样本语音合成 · Kokoro 中文音色', None)])]
    CR_LEN = 9.5
    def credit(c, t, L):
        k = smooth(t / 1.6)
        mid = W / 2 - 150
        for i, (role, parts) in enumerate(CREDITS):
            y = 488 + i * 52
            text(c, role, mid - 28, y, 'sans-light', 22, (150, 150, 146), 0.95 * k, 'right', tracking=0.3)
            x = mid + 28
            for s_, rgb in parts:
                x += text(c, s_, x, y, 'sans-light', 22, rgb or (212, 212, 208), 0.95 * k, tracking=0.06) + 0.06 * 22
    sc.layer(credit, t_cr, t_cr + CR_LEN, fout=2.2)
    sc.at(t_cr + CR_LEN)

    # the faintest room tone under everything, so the black is a room and not a dropout
    sc.amb(sfx.room_tone(30, 15, hum=False), t_start - 1.0, None, gain=-16, fin=2.0, fout=3.0)
    sc.finish(tail=3.0)
    return sc

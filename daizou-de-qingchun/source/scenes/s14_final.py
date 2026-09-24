"""第十四场【循环 → 终结】 内景 派出所 ／ 宿舍 日.

1. The police station, silent: the desk from above on the cold grid — the rebuilt contract (the
   「月」 red, as it was sixty-two days ago), the printed diary, the bank statement, a police
   notebook filling up with handwriting. Li's eyes go to the contract. Fade out.
2. Black. The alarm, once more. The bed board. The phone: 5月10日. No siren. The plan, with
   morning light on three desks. Zhang's desk from above: his warm sketchbook page, the half-drawn
   plane tree. 只是椅子空了。 Chen wakes, looks at Li, says nothing.
3. For the first time in the film the A-line camera moves: a slow continuous pull-back from the
   room to the corridor, the building, the campus, while sunrise light spreads over the grid.
   The alarm melody, slowed, on a piano: the only music in the film.
   这一天是 5 月 10 日。 这一天只会来一次。"""
import math, functools
import numpy as np
import skia
from film.config import *
from film.gfx import *
from film.timeline import Scene
from film.sketch import Drawing
from film import objects as O, sfx
from film.audio import reverb, lowpass, highpass, bandpass, env_fade, normalize, to_stereo

PX, PY, PS = 200, 120, 1.0          # floor-plan placement (the fixed camera of the A line)
RX = 1010                           # right column
SUN = (224, 164, 84)                # morning light through the curtain gap (as s12)
PEN = (40, 50, 90)                  # ballpoint
SAMP = skia.SamplingOptions(skia.FilterMode.kLinear, skia.MipmapMode.kLinear)

# =====================================================================
# cached backgrounds
# =====================================================================
@functools.lru_cache(maxsize=1)
def _bg():
    surf = skia.Surface(W, H)
    O.a_background(surf.getCanvas(), W, H)
    return surf.makeImageSnapshot().withDefaultMipmaps()

@functools.lru_cache(maxsize=1)
def _vignette():
    surf = skia.Surface(W, H)
    c = surf.getCanvas(); c.clear(skia.ColorTRANSPARENT)
    vignette(c, W, H, 0.18)
    return surf.makeImageSnapshot()

def a_bg(c):
    c.drawImage(_bg(), 0, 0, SAMP)

@functools.lru_cache(maxsize=1)
def _plan_image():
    surf = skia.Surface(W, H)
    c = surf.getCanvas()
    O.a_background(c, W, H)
    O.floorplan(c, PX, PY, PS, empty_alpha=0.55)
    return surf.makeImageSnapshot().withDefaultMipmaps()

@functools.lru_cache(maxsize=1)
def _board_image():
    surf = skia.Surface(W, H)
    O.bed_board(surf.getCanvas(), W, H, 1.0)
    return surf.makeImageSnapshot()

def label_typed(c, s, x, y, t, cps=16.0, size=24, rgb=A_INK, a=1.0, font_='sans-light', align='left'):
    if align == 'center':             # centred lines fade in whole (typing would make them slide)
        k = smooth(t / 0.9)
        if k > 0:
            text(c, s, x, y, font_, size, rgb, a * k, align, tracking=0.12)
        return
    n = int(max(0.0, t) * cps)
    if n <= 0:
        return
    text(c, s[:n], x, y, font_, size, rgb, a, align, tracking=0.12)

# =====================================================================
# 1. THE POLICE STATION — the desk from above
# =====================================================================
DESK = (150, 120, 1480, 862)                       # l, t, r, b
C_XY, C_S = (215, 196), 0.60                       # rebuilt contract (page origin, scale)
D_XY, D_WH, D_ROT = (640, 184), (372, 540), -1.2   # printed diary
N_XY, N_WH = (1062, 150), (382, 298)               # police notebook
S_XY, S_WH, S_ROT = (1060, 486), (384, 336), 0.8   # bank statement
CH_LI, CH_CHEN, CH_POL = (420, 912), (830, 912), (1253, 82)

try:
    from scenes.s03_loop import tear_geometry as _s03_tears
except Exception:                                  # keep working if s03 is being edited
    _s03_tears = None

@functools.lru_cache(maxsize=1)
def tear_polys():
    """Fragment outlines of the torn contract (page units): the same tears as s03/s05 if available."""
    if _s03_tears is not None:
        try:
            return [np.asarray(p['poly'], float) for p in _s03_tears()]
        except Exception:
            pass
    rng = np.random.default_rng(318)
    xs = [0, 150, 312, 468, 620]; ys = [0, 140, 214, 318, 462, 598, 736, 877]
    out = []
    for i in range(len(ys) - 1):
        for j in range(len(xs) - 1):
            x0, x1, y0, y1 = xs[j], xs[j + 1], ys[i], ys[i + 1]
            out.append(np.array([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], float) + rng.normal(0, 0.8, (4, 2)))
    return out

def _poly_path(poly, k, dx, dy):
    p = skia.Path(); p.moveTo(poly[0][0] * k + dx, poly[0][1] * k + dy)
    for q in poly[1:]:
        p.lineTo(q[0] * k + dx, q[1] * k + dy)
    p.close()
    return p

@functools.lru_cache(maxsize=2)
def rebuilt_contract(s, ss=2.0):
    """The contract, torn and put back together: every piece back, each a hair off; 月 in red."""
    M = 12
    w, h = int(O.CONTRACT_W * s * ss) + 2 * M, int(O.CONTRACT_H * s * ss) + 2 * M
    ps = skia.Surface(w, h); pc = ps.getCanvas(); pc.clear(skia.ColorTRANSPARENT)
    O.contract_page(pc, M, M, s=s * ss, shadow=False, yue_red=1.0)
    page = ps.makeImageSnapshot()
    out = skia.Surface(w, h); c = out.getCanvas(); c.clear(skia.ColorTRANSPARENT)
    rng = np.random.default_rng(1401)
    yx, yy = O.contract_layout(1.0)['yue']
    for poly in tear_polys():
        inside = (poly[:, 0].min() <= yx - 4 <= poly[:, 0].max()) and (poly[:, 1].min() <= yy - 4 <= poly[:, 1].max())
        dx, dy = (0.0, 0.0) if inside else (rng.uniform(-0.8, 0.8) * s * ss, rng.uniform(-0.8, 0.8) * s * ss)
        path = _poly_path(poly, s * ss, M + dx, M + dy)
        c.save(); c.clipPath(path, skia.ClipOp.kIntersect, True)
        c.drawImage(page, dx, dy)
        c.restore()
        c.drawPath(path, paint((255, 255, 255), 0.85, 1.4 * ss * max(0.6, s)))
        c.drawPath(path, paint((150, 150, 150), 0.22, 0.6 * ss * max(0.6, s)))
    return out.makeImageSnapshot().withDefaultMipmaps(), M, ss

def draw_contract(c, x, y, s):
    img, M, ss = rebuilt_contract(s)
    sh = paint((10, 16, 24), 0.18); sh.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 9))
    c.drawRect(skia.Rect.MakeXYWH(x + 5, y + 8, O.CONTRACT_W * s, O.CONTRACT_H * s), sh)
    c.save(); c.translate(x - M / ss, y - M / ss); c.scale(1 / ss, 1 / ss)
    c.drawImage(img, 0, 0, SAMP)
    c.restore()

def sheet(c, x, y, w, h, rot=0.0, rgb=(249, 249, 247)):
    """A plain sheet of paper with its soft shadow; leaves the canvas rotated about its centre."""
    c.translate(x + w / 2, y + h / 2); c.rotate(rot); c.translate(-w / 2, -h / 2)
    sh = paint((10, 16, 24), 0.16); sh.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 8))
    c.drawRect(skia.Rect.MakeXYWH(4, 7, w, h), sh)
    c.drawRect(skia.Rect.MakeXYWH(0, 0, w, h), paint(rgb))
    c.drawRect(skia.Rect.MakeXYWH(0, 0, w, h), paint((190, 194, 198), 1.0, 0.8))

DIARY = [
    '3月18日。签了合同。六千块。半年后还六千四百五，应该没问题。买了新手机，跟他们说家里寄的钱。浩然没怀疑。我不喜欢说谎，但他说的对，借钱不好听。',
    '3月28日。反复看了三遍才发现。那个“月”字。藏在最右边。月利率百分之十五。六千块一个月光利息就是九百。',
    '4月2日。第一次逃课。不想动。',
    '4月10日。打了三次电话给学校的心理咨询中心。第一次占线，第二次挂了，第三次走到了门口。站了五分钟。进不去。说不出口。一个大男人，走进去说“我好像不太对劲”——说不出口。',
    '4月17日。他们打电话来说我逾期了。合同第六条。我又看了一遍。真的写着。',
    '5月8日。签了新合同。一万二。钱在桌上放了三十秒就被他收走了。一分钱都没拿到。',
]

def draw_diary(c):
    x, y = D_XY; w, h = D_WH
    c.save()
    sheet(c, x, y, w, h, D_ROT)
    text(c, '日记.txt', 26, 34, 'sans-medium', 12, A_INK, 0.9, tracking=0.1)
    text(c, '已恢复 · 最后修改 5月8日 23:02', w - 26, 34, 'sans-light', 10, A_MID, 0.9, 'right')
    line(c, 26, 44, w - 26, 44, A_FAINT, 1.0, 1.0)
    yy = 70
    for para in DIARY:
        for ln in wrap(para, 'sans-light', 12.5, w - 52):
            text(c, ln, 26, yy, 'sans-light', 12.5, (40, 44, 50), 1.0)
            yy += 19.5
        yy += 7
    text(c, '— 1 —', w / 2, h - 18, 'sans-light', 10, A_MID, 0.8, 'center')
    c.restore()

STATEMENT = [      # date, kind, counterpart, amount
    ('03-01', '转入', '张*国', '+1,500.00'),
    ('04-01', '转入', '张*国', '+1,500.00'),
    ('04-19', '转出', '肖*', '−600.00'),
    ('05-01', '转入', '张*国', '+1,500.00'),
    ('05-03', '转出', '肖*', '−1,300.00'),
    ('05-07', '转出', '肖*', '−180.00'),
]
ST_ROW0, ST_RH = 138, 30

def draw_statement(c):
    x, y = S_XY; w, h = S_WH
    c.save()
    sheet(c, x, y, w, h, S_ROT)
    text(c, '个人账户交易明细', 24, 36, 'sans-medium', 16, A_INK, 1.0, tracking=0.15)
    text(c, '户名：张朝阳', 24, 64, 'sans-light', 12, A_INK, 0.9)
    text(c, '账号：6217 **** **** 0318', 150, 64, 'sans-light', 12, A_INK, 0.9)
    text(c, '期间：03-01 至 05-08', 24, 84, 'sans-light', 12, A_MID, 0.9)
    cols = [24, 92, 150, w - 24]
    hy = ST_ROW0 - 26
    line(c, 20, hy - 18, w - 20, hy - 18, A_INK, 0.8, 1.0)
    for i, hd in enumerate(('日期', '摘要', '对方户名')):
        text(c, hd, cols[i], hy, 'sans-medium', 12, A_INK, 0.9)
    text(c, '金额（元）', cols[3], hy, 'sans-medium', 12, A_INK, 0.9, 'right')
    line(c, 20, hy + 9, w - 20, hy + 9, A_INK, 0.6, 0.8)
    for r, (d_, k_, who, amt) in enumerate(STATEMENT):
        yy = ST_ROW0 + r * ST_RH
        text(c, d_, cols[0], yy, 'sans-light', 13, A_INK, 1.0)
        text(c, k_, cols[1], yy, 'sans-light', 13, A_INK, 1.0)
        text(c, who, cols[2], yy, 'sans-light', 13, A_INK, 1.0)
        text(c, amt, cols[3], yy, 'sans', 13, A_INK, 1.0, 'right')
        line(c, 20, yy + 10, w - 20, yy + 10, A_FAINT, 1.0, 0.8)
    text(c, '余额（05-08）', 24, ST_ROW0 + 6 * ST_RH + 12, 'sans-light', 12, A_MID, 0.9)
    text(c, '3.60', cols[3], ST_ROW0 + 6 * ST_RH + 12, 'sans', 13, A_INK, 1.0, 'right')
    c.restore()

def statement_row_xy(r):
    """Screen (desk) coords of the start and end of row r's underline (rotation ignored: 0.8°)."""
    x, y = S_XY; w, h = S_WH
    cx, cy = x + w / 2, y + h / 2
    a = math.radians(S_ROT)
    def R(px, py):
        px -= w / 2; py -= h / 2
        return (cx + px * math.cos(a) - py * math.sin(a), cy + px * math.sin(a) + py * math.cos(a))
    yy = ST_ROW0 + r * ST_RH + 5
    return R(20, yy), R(w - 20, yy)

NOTES = ['时间：5月9日 11时20分', '地点：本所', '报案人：李浩然、陈杰辉（室友）', '事由：张朝阳借贷一事',
         '材料：1. 借款协议（碎片拼合）', '　　　2. 日记打印件', '　　　3. 银行账户交易明细', '出借人：肖强　月利率15%']
NB_LINE0, NB_LH = 84, 26

def draw_notebook_static(c):
    x, y = N_XY; w, h = N_WH
    c.save()
    sheet(c, x, y, w, h, 0.0, (250, 250, 248))
    for k in range(14):
        c.drawCircle(22 + k * (w - 44) / 13, 12, 5, paint(A_INK, 0.55, 1.2))
    text(c, '询问笔录', w / 2, 46, 'sans-medium', 17, A_INK, 0.9, 'center', tracking=0.4)
    text(c, '第 1 页', w - 20, 46, 'sans-light', 10, A_MID, 0.9, 'right')
    for k in range(9):
        yy = NB_LINE0 + k * NB_LH + 6
        line(c, 18, yy, w - 18, yy, (196, 208, 222), 1.0, 0.8)
    c.restore()

class Notes:
    """Handwriting appearing line by line (the officer writing); `pauses`: {line_index: seconds before it}."""
    def __init__(self, t0, cps=5.0, gap=0.7, pauses=None):
        self.spans = []
        t = t0
        for i, s in enumerate(NOTES):
            t += (pauses or {}).get(i, 0.0)
            d = len(s.strip('　')) / cps
            self.spans.append((t, t + d))
            t += d + gap
        self.t_end = t

    def draw(self, c, T, a=1.0):
        x, y = N_XY
        tip = None
        for i, (s, (t0, t1)) in enumerate(zip(NOTES, self.spans)):
            if T < t0:
                break
            k = clamp((T - t0) / (t1 - t0))
            lead = len(s) - len(s.lstrip('　'))
            n = lead + int(round((len(s) - lead) * k))
            vis = s[:n]
            bx, by = x + 22, y + NB_LINE0 + i * NB_LH
            cx = bx
            for j, ch in enumerate(vis):
                jy = math.sin(i * 3.1 + j * 1.7) * 0.8
                text(c, ch, cx, by + jy, 'hand', 16, PEN, 0.92 * a)
                cx += text_width(ch, 'hand', 16) + 0.4
            if k < 1.0:
                tip = (cx, by)
        return tip

def draw_pen(c, tip, a=1.0):
    """A plain ballpoint in outline, its tip where the writing is."""
    if tip is None:
        return
    x, y = tip
    c.save(); c.translate(x, y); c.rotate(-58)
    c.drawPath(_pen_path(), paint((250, 250, 248), a))
    c.drawPath(_pen_path(), paint(A_INK, 0.8 * a, 1.2))
    c.drawLine(18, 0, 26, 0, paint(A_INK, 0.6 * a, 1.0))
    c.restore()

@functools.lru_cache(maxsize=1)
def _pen_path():
    p = skia.Path()
    p.moveTo(0, 0); p.lineTo(14, -4.5); p.lineTo(190, -5.5); p.lineTo(196, -2); p.lineTo(196, 2); p.lineTo(190, 5.5)
    p.lineTo(14, 4.5); p.close()
    return p

@functools.lru_cache(maxsize=1)
def desk_static():
    """Everything on the desk that doesn't move, drawn once in desk coordinates (= master screen)."""
    rec = skia.PictureRecorder()
    c = rec.beginRecording(skia.Rect(0, 0, W, H))
    l, t, r, b = DESK
    # chairs (tucked under the edges) and the desk
    for (cx, cy) in (CH_LI, CH_CHEN, CH_POL):
        c.drawCircle(cx, cy, 34, paint(A_INK, 0.7, 1.3))
    c.drawRect(skia.Rect.MakeLTRB(l, t, r, b), paint(A_BG, 1.0))
    c.drawRect(skia.Rect.MakeLTRB(l, t, r, b), paint(A_INK, 1.0, 2.2))
    c.drawRect(skia.Rect.MakeLTRB(l + 10, t + 10, r - 10, b - 10), paint(A_INK, 0.25, 1.0))
    draw_contract(c, C_XY[0], C_XY[1], C_S)
    draw_diary(c)
    draw_statement(c)
    draw_notebook_static(c)
    return rec.finishRecordingAsPicture()

def yue_xy():
    yx, yy = O.contract_layout(C_S)['yue']
    return C_XY[0] + yx - 5 * C_S, C_XY[1] + yy - 5 * C_S

def draw_desk(c, T, notes, t_gaze, t_marks, a=1.0):
    c.drawPicture(desk_static())
    tip = notes.draw(c, T)
    # the officer underlines the transfers to 肖*
    for r, (t0, t1) in t_marks:
        k = clamp((T - t0) / (t1 - t0))
        if k > 0:
            (x0, y0), (x1, y1) = statement_row_xy(r)
            c.drawLine(x0, y0, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, paint(PEN, 0.75, 1.6))
            if k < 1:
                tip = (x0 + (x1 - x0) * k, y0 + (y1 - y0) * k)
    draw_pen(c, tip if tip is not None else (N_XY[0] + N_WH[0] - 40, N_XY[1] + N_WH[1] - 40))
    return tip

def desk_people(c, T, t_gaze, a=1.0):
    O.person_dot(c, CH_LI[0], CH_LI[1], '李', a)
    O.person_dot(c, CH_CHEN[0], CH_CHEN[1], '陈', a)
    O.person_dot(c, CH_POL[0], CH_POL[1], '民警', a)
    if t_gaze is not None and T > t_gaze:
        k = ease_out((T - t_gaze) / 1.4)
        ex, ey = yue_xy()
        sx, sy = CH_LI
        dx, dy = ex - sx, ey - sy
        L_ = math.hypot(dx, dy)
        ux, uy = dx / L_, dy / L_
        x0, y0 = sx + ux * 16, sy + uy * 16
        x1, y1 = x0 + (ex - 14 * ux - x0) * k, y0 + (ey - 14 * uy - y0) * k
        p = paint(A_INK, 0.7 * a, 1.2); p.setPathEffect(skia.DashPathEffect.Make([6.0, 5.0], 0.0))
        c.drawLine(x0, y0, x1, y1, p)
        if k >= 1:
            rr = smooth((T - t_gaze - 1.4) / 0.5)
            c.drawCircle(ex, ey, 13, paint(RED, 0.8 * rr * a, 1.2))

# ---------------- the 月, close ----------------
MS = 2.6
@functools.lru_cache(maxsize=1)
def macro_image():
    """The whole of line four, 「百分之十五」 ... and the tiny red 「月」 against the trim line.
    Only a band around the line is in focus (as in the lamp-light insert of s05)."""
    L = O.contract_layout(1.0)
    fx, fy = L['yue'][0], L['rate_y']
    sx, sy = 1745, 520
    ox, oy = sx - fx * MS, sy - fy * MS
    surf = skia.Surface(W, H); c = surf.getCanvas()
    a_bg(c)
    sh = paint((10, 16, 24), 0.2); sh.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 12))
    c.drawRect(skia.Rect.MakeXYWH(ox + 8, oy + 12, O.CONTRACT_W * MS, O.CONTRACT_H * MS), sh)
    M_ = 24
    pg = skia.Surface(W + 2 * M_, H + 2 * M_); pc = pg.getCanvas(); pc.clear(skia.ColorTRANSPARENT)
    O.contract_page(pc, ox + M_, oy + M_, s=MS, shadow=False, yue_red=1.0)
    img = pg.makeImageSnapshot()
    rng = np.random.default_rng(1402)
    for poly in tear_polys():
        yx, yy = L['yue']
        inside = (poly[:, 0].min() <= yx - 4 <= poly[:, 0].max()) and (poly[:, 1].min() <= yy - 4 <= poly[:, 1].max())
        dx, dy = (0.0, 0.0) if inside else (rng.uniform(-1.2, 1.2), rng.uniform(-1.2, 1.2))
        path = _poly_path(poly, MS, ox, oy)
        c.save(); c.translate(dx, dy)
        c.clipPath(path, skia.ClipOp.kIntersect, True)
        c.drawImage(img, -M_, -M_)
        c.drawPath(path, paint((255, 255, 255), 0.85, 2.0))
        c.drawPath(path, paint((150, 150, 150), 0.2, 0.8))
        c.restore()
    sharp = surf.makeImageSnapshot()
    out = skia.Surface(W, H); oc = out.getCanvas()
    bp = skia.Paint(); bp.setImageFilter(skia.ImageFilters.Blur(6.0, 6.0, skia.TileMode.kClamp))
    oc.drawImage(sharp, 0, 0, skia.SamplingOptions(), bp)
    oc.saveLayer(None, None)
    oc.drawImage(sharp, 0, 0)
    band = skia.GradientShader.MakeLinear([(0, sy - 170), (0, sy + 130)],
                                          [col(BLACK, 0), col(BLACK, 1), col(BLACK, 1), col(BLACK, 0)], [0.0, 0.38, 0.68, 1.0])
    oc.drawRect(skia.Rect(0, 0, W, H), skia.Paint(Shader=band, BlendMode=skia.BlendMode.kDstIn))
    oc.restore()
    fall = skia.GradientShader.MakeLinear([(0, 700), (0, 960)], [col(A_BG, 0), col(A_BG, 0.9)], [0, 1])
    oc.drawRect(skia.Rect(0, 700, W, H), skia.Paint(Shader=fall))
    top = skia.GradientShader.MakeLinear([(0, 0), (0, 260)], [col(A_BG, 0.75), col(A_BG, 0)], [0, 1])
    oc.drawRect(skia.Rect(0, 0, W, 260), skia.Paint(Shader=top))
    return out.makeImageSnapshot().withDefaultMipmaps(), (sx, sy)

# =====================================================================
# 2. THE MORNING — the phone, the plan with light, Zhang's desk
# =====================================================================
def phone_shot(c, t, L, lit_fn, touch_a=0.0, sink=0.0):
    a_bg(c)
    x, y, w, h = L.w / 2 - 150, 170 + 60 * sink, 300, 600
    lit = lit_fn
    O.phone_screen(c, x, y, w, h, lit=lit)
    ink_a = 0.35 + 0.65 * lit
    text(c, '08:30', x + w / 2, y + h * 0.30, 'sans-light', 30, A_INK, ink_a, 'center', tracking=0.1)
    text(c, '5月10日', x + w / 2, y + h * 0.46, 'sans-xlight', 66, A_INK, ink_a, 'center')
    text(c, '星期五', x + w / 2, y + h * 0.46 + 44, 'sans-light', 22, A_INK, ink_a, 'center', tracking=0.2)
    if touch_a > 0:
        # a fingertip resting on the glass: a contact ring, held
        tx, ty = x + w * 0.70, y + h * 0.63
        c.drawOval(skia.Rect.MakeXYWH(tx - 24, ty - 30, 48, 60), paint(A_INK, 0.07 * touch_a))
        c.drawOval(skia.Rect.MakeXYWH(tx - 24, ty - 30, 48, 60), paint(A_INK, 0.45 * touch_a, 1.1))

def light_rays(c, m, a=1.0, k_desks=('li', 'chen', 'zhang'), ox=0.0, oy=0.0):
    """Morning through the curtain gap: faint rays from the window, a warm stripe on each desk.
    Coordinates in metres * m (px per metre), origin at the room's top-left + (ox, oy)."""
    if a <= 0:
        return
    gx, gy = ox + 2.78 * m, oy + 0.03 * m
    desks = {'li': (0.05, 3.3, 0.7, 1.2), 'chen': (0.05, 4.6, 0.7, 1.2), 'zhang': (3.25, 3.4, 0.7, 1.3)}
    for key in k_desks:
        dx, dy, dw, dh = desks[key]
        cx, cy = ox + (dx + dw / 2) * m, oy + (dy + dh / 2) * m
        vx, vy = cx - gx, cy - gy
        L_ = math.hypot(vx, vy); ux, uy = vx / L_, vy / L_
        nx, ny = -uy, ux
        wd = 0.22 * m                     # the ray widens a little on its way down
        p = skia.Path(); p.moveTo(gx - nx * 2, gy - ny * 2); p.lineTo(gx + nx * 2, gy + ny * 2)
        p.lineTo(cx + nx * wd + ux * 0.8 * m, cy + ny * wd + uy * 0.8 * m); p.lineTo(cx - nx * wd + ux * 0.8 * m, cy - ny * wd + uy * 0.8 * m); p.close()
        sh = skia.GradientShader.MakeLinear([(gx, gy), (cx, cy)], [col(SUN, 0.03 * a), col(SUN, 0.13 * a)], [0, 1])
        c.drawPath(p, skia.Paint(Shader=sh, AntiAlias=True))
        # the stripe itself, on the desk
        c.save()
        c.clipRect(skia.Rect.MakeXYWH(ox + dx * m, oy + dy * m, dw * m, dh * m))
        q = skia.Path(); q.moveTo(cx - ux * 2 * m + nx * wd, cy - uy * 2 * m + ny * wd); q.lineTo(cx + ux * 2 * m + nx * wd, cy + uy * 2 * m + ny * wd)
        q.lineTo(cx + ux * 2 * m - nx * wd, cy + uy * 2 * m - ny * wd); q.lineTo(cx - ux * 2 * m - nx * wd, cy - uy * 2 * m - ny * wd); q.close()
        gp = paint(SUN, 0.22 * a); gp.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, max(1.0, 0.06 * m)))
        c.drawPath(q, gp)
        c.drawPath(q, paint(SUN, 0.18 * a))
        c.restore()
    c.drawCircle(gx, gy - 1, max(1.2, 0.03 * m), paint(SUN, 0.8 * a))

# ---------------- Zhang's desk from above ----------------
ZD = (330, 150, 1590, 800)          # desk l, t, r, b (the wall is the top edge)
@functools.lru_cache(maxsize=1)
def zdesk_static():
    rec = skia.PictureRecorder()
    c = rec.beginRecording(skia.Rect(0, 0, W, H))
    l, t, r, b = ZD
    # the wall behind the desk
    c.drawRect(skia.Rect.MakeLTRB(0, t - 26, W, t - 20), paint(A_INK, 0.9))
    line(c, 0, t - 20, W, t - 20, A_INK, 1.0, 1.4)
    # the empty chair, pushed in a little
    c.drawRoundRect(skia.Rect.MakeXYWH(760, b - 30, 190, 170), 26, 26, paint(A_BG, 1.0))
    c.drawRoundRect(skia.Rect.MakeXYWH(760, b - 30, 190, 170), 26, 26, paint(A_INK, 0.75, 1.4))
    c.drawRoundRect(skia.Rect.MakeXYWH(772, b + 96, 166, 30), 10, 10, paint(A_INK, 0.5, 1.2))
    # desk
    c.drawRect(skia.Rect.MakeLTRB(l, t, r, b), paint(A_BG))
    c.drawRect(skia.Rect.MakeLTRB(l, t, r, b), paint(A_INK, 1.0, 2.2))
    c.drawRect(skia.Rect.MakeLTRB(l + 10, t + 10, r - 10, b - 10), paint(A_INK, 0.22, 1.0))
    # the lamp (base, arm, shade)
    c.drawCircle(470, 290, 62, paint(A_INK, 0.75, 1.4)); c.drawCircle(470, 290, 48, paint(A_INK, 0.3, 1.0))
    c.drawCircle(470, 290, 8, paint(A_INK, 0.7, 1.2))
    line(c, 470, 290, 600, 400, A_INK, 0.75, 1.5); line(c, 476, 284, 606, 394, A_INK, 0.35, 1.0)
    c.drawOval(skia.Rect.MakeXYWH(575, 372, 96, 70), paint(A_BG))
    c.drawOval(skia.Rect.MakeXYWH(575, 372, 96, 70), paint(A_INK, 0.8, 1.4))
    c.drawOval(skia.Rect.MakeXYWH(598, 390, 50, 34), paint(A_INK, 0.3, 1.0))
    # textbooks, stacked
    for k, (bx, by, bw, bh, rot, title) in enumerate([(412, 470, 300, 214, -3.0, '高等数学'), (426, 452, 290, 206, 2.0, '大学英语')]):
        c.save(); c.translate(bx + bw / 2, by + bh / 2); c.rotate(rot); c.translate(-bw / 2, -bh / 2)
        c.drawRect(skia.Rect.MakeXYWH(0, 0, bw, bh), paint((238, 240, 241)))
        c.drawRect(skia.Rect.MakeXYWH(0, 0, bw, bh), paint(A_INK, 0.85, 1.4))
        line(c, 14, 0, 14, bh, A_INK, 0.4, 1.0)
        text(c, title, bw / 2 + 8, bh * 0.42, 'serif-medium', 22, A_INK, 0.8, 'center', tracking=0.3)
        line(c, 60, bh * 0.52, bw - 44, bh * 0.52, A_INK, 0.3, 1.0)
        c.restore()
    # the pencil case, washed until the colour went
    c.save(); c.translate(560, 736); c.rotate(-4)
    c.drawRoundRect(skia.Rect.MakeXYWH(-150, -30, 300, 60), 28, 28, paint((214, 216, 214)))
    c.drawRoundRect(skia.Rect.MakeXYWH(-150, -30, 300, 60), 28, 28, paint(A_INK, 0.55, 1.2))
    line(c, -128, -6, 128, -6, A_INK, 0.35, 1.0)
    c.drawRoundRect(skia.Rect.MakeXYWH(116, -12, 22, 12), 4, 4, paint(A_INK, 0.45, 1.0))
    for k in range(14):
        c.drawLine(-120 + k * 18, -4, -114 + k * 18, -8, paint(A_INK, 0.18, 1.0))
    c.restore()
    return rec.finishRecordingAsPicture()

SK_K, SK_XY = 0.72, (880, 196)       # the sketchbook page on the desk corner
def draw_zdesk(c, T, sun=1.0):
    a_bg(c)
    c.drawPicture(zdesk_static())
    # his page: the warm paper, the half-drawn plane tree (never finished)
    x, y, w, h = O.SKETCH_PAGE
    c.save(); c.translate(SK_XY[0], SK_XY[1]); c.scale(SK_K, SK_K); c.translate(-x, -y)
    O.sketchbook_page(c, O.TREE_FINAL, a=1.0, day=48, pencil=False, rot=0.02)
    c.restore()
    # the sun across the desk, the page and the edge of the empty chair
    if sun > 0:
        c.save(); c.clipRect(skia.Rect(0, ZD[1] - 18, W, H))
        q = skia.Path(); q.moveTo(1400, 90); q.lineTo(1520, 90); q.lineTo(900, 1000); q.lineTo(760, 1000); q.close()
        gp = paint(SUN, 0.16 * sun); gp.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 18))
        gp.setBlendMode(skia.BlendMode.kMultiply)
        c.drawPath(q, gp)
        gp2 = paint(SUN, 0.10 * sun); gp2.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 30))
        c.drawPath(q, gp2)
        c.restore()

# =====================================================================
# 3. THE PULL-BACK — world in metres, room origin at (0, 0)
# =====================================================================
ROOM_W, ROOM_H = 4.0, 7.2
CORR_W = 2.4
BLD = (-28.0, 0.0, 28.0, 2 * ROOM_H + CORR_W)      # our building (with stairwells at both ends)
DORMS = [(-28, -46, 28, -46 + 16.8), (-28, 44, 28, 60.8), (48, -46, 104, -29.2), (48, 0, 104, 16.8), (48, 44, 104, 60.8)]
TEACH = [[(168, 88), (350, 88), (350, 112), (338, 112), (338, 150), (316, 150), (316, 112), (270, 112), (270, 150),
          (248, 150), (248, 112), (202, 112), (202, 150), (180, 150), (180, 112), (168, 112)]]
TRACK_C, TRACK_S, TRACK_R, TRACK_LANES = (250.0, -40.0), 84.39, 36.5, 8
ROAD_V = (128.0, -110.0, 158.0, 9.0)                # x centre, y0, y1, width
ROAD_H = (70.0, -60.0, 380.0, 9.0)                  # y centre, x0, x1, width
PB_K1 = 0.0322
CAMPUS_C = (155.0, 31.0)            # centre of the final framing (m)
P0 = (PX, PY)

@functools.lru_cache(maxsize=2)
def room_picture(labels):
    rec = skia.PictureRecorder()
    c = rec.beginRecording(skia.Rect(-100, -100, 600, 900))
    if not labels:
        c.clipRect(skia.Rect(-4, -8, ROOM_W * 100 + 4, ROOM_H * 100 + 5))
    O.floorplan(c, 0, 0, 1.0, labels=labels, empty_alpha=0.55 if labels else 1.0)
    return rec.finishRecordingAsPicture()

def track_path(c0, rs, straight):
    """Stadium outline (closed) with semicircle radius rs, centred at c0, straights along x."""
    cx, cy = c0
    p = skia.Path()
    h = straight / 2
    p.moveTo(cx - h, cy - rs); p.lineTo(cx + h, cy - rs)
    p.arcTo(skia.Rect.MakeLTRB(cx + h - rs, cy - rs, cx + h + rs, cy + rs), -90, 180, False)
    p.lineTo(cx - h, cy + rs)
    p.arcTo(skia.Rect.MakeLTRB(cx - h - rs, cy - rs, cx - h + rs, cy + rs), 90, 180, False)
    p.close()
    return p

def track_point(u, lane_r):
    """Position (m) on the track at fraction u of a lap (anticlockwise on screen)."""
    cx, cy = TRACK_C
    h = TRACK_S / 2
    per = 2 * TRACK_S + 2 * math.pi * lane_r
    s = (u % 1.0) * per
    if s < TRACK_S:
        return cx + h - s, cy + lane_r
    s -= TRACK_S
    if s < math.pi * lane_r:
        a = math.pi / 2 + s / lane_r
        return cx - h + lane_r * math.cos(a), cy + lane_r * math.sin(a)
    s -= math.pi * lane_r
    if s < TRACK_S:
        return cx - h + s, cy - lane_r
    s -= TRACK_S
    a = -math.pi / 2 + s / lane_r
    return cx + h + lane_r * math.cos(a), cy + lane_r * math.sin(a)

@functools.lru_cache(maxsize=1)
def trees():
    """Plane trees along the two roads, and a few near the track (m)."""
    rng = np.random.default_rng(1440)
    out = []
    x, y0, y1, w = ROAD_V
    for yy in np.arange(y0 + 4, y1 - 4, 12.0):
        if abs(yy - ROAD_H[0]) < 12:
            continue
        out.append((x - w / 2 - 4, yy + rng.normal(0, 0.4))); out.append((x + w / 2 + 4, yy + 4.5 + rng.normal(0, 0.4)))
    y, x0, x1, w = ROAD_H
    for xx in np.arange(x0 + 4, x1, 12.0):
        if abs(xx - ROAD_V[0]) < 12:
            continue
        out.append((xx + rng.normal(0, 0.4), y - w / 2 - 4)); out.append((xx + 4.5 + rng.normal(0, 0.4), y + w / 2 + 4))
    for k in range(9):
        out.append((168 + k * 8 + rng.normal(0, 1), -96 + rng.normal(0, 1.5)))
    return out

class Cam:
    """The pull-back. u: 0 (the master) .. 1 (the campus), in log-scale."""
    def __init__(self, t0, dur):
        self.t0, self.dur = t0, dur

    def u(self, T):
        x = ramp(T, self.t0, self.t0 + self.dur)
        # slow to start (the camera has never moved before), long settle at the end
        return ease_in_out(x) * 0.7 + smooth(x) * 0.3

    def k(self, T):
        return math.exp(math.log(PB_K1) * self.u(T))

    def xf(self, T):
        """(P, s): world (m) -> screen = P + w * s. The room's centre travels on a gentle curve from
        its place in the master to its place on the campus plan; everything else scales around it."""
        k = self.k(T)
        s = 100 * k
        u = self.u(T)
        A = (P0[0] + 200, P0[1] + 360)
        F1, Q1 = CAMPUS_C, (960.0, 450.0)
        C = (Q1[0] + (2.0 - F1[0]) * 100 * PB_K1, Q1[1] + (3.6 - F1[1]) * 100 * PB_K1)
        B = (900.0, 560.0)
        g = u
        R = tuple((1 - g) ** 2 * A[i] + 2 * (1 - g) * g * B[i] + g * g * C[i] for i in range(2))
        return (R[0] - 2.0 * s, R[1] - 3.6 * s), s, k

def grid(c, P, s):
    """The cold grid, anchored to the world: a finer grid dissolves as a coarser one takes over."""
    ug = max(0.0, math.log10(100.0 / s))
    n0 = math.floor(ug)
    fr = ug - n0
    sp = 0.6 * 10 ** n0                 # metres
    x0w, y0w = -2.0, -1.2               # the master's grid origin (screen 0,0 at the start)
    p_fine = paint(A_FAINT, 0.55 * (1 - fr), 1.0)
    p_coarse = paint(A_FAINT, 0.55, 1.0)
    for axis in (0, 1):
        lim = W if axis == 0 else H
        o = (x0w if axis == 0 else y0w)
        Pa = P[axis]
        i0 = math.floor(((0 - Pa) / s - o) / sp) - 1
        i1 = math.ceil(((lim - Pa) / s - o) / sp) + 1
        for i in range(i0, i1 + 1):
            v = Pa + (o + i * sp) * s
            if v < -1 or v > lim + 1:
                continue
            coarse = (i % 10 == 0)
            pp = p_coarse if coarse else p_fine
            if not coarse and fr > 0.995:
                continue
            if axis == 0:
                c.drawLine(v, 0, v, H, pp)
            else:
                c.drawLine(0, v, W, v, pp)

def hatch_rect(c, x0, y0, x1, y1, sp=7.0, a=0.25, ang=45):
    c.save(); c.clipRect(skia.Rect.MakeLTRB(x0, y0, x1, y1))
    p = paint(A_INK, a, 0.8)
    d = (x1 - x0) + (y1 - y0)
    k = -d
    while k < d:
        c.drawLine(x0 + k, y1, x0 + k + (y1 - y0), y0, p)
        k += sp
    c.restore()

class Campus:
    def __init__(self, cam, t_light):
        self.cam = cam
        self.t_light = t_light
        rng = np.random.default_rng(1450)
        self.runners = [(TRACK_R + 0.6 + 1.22 * rng.integers(0, 4), rng.uniform(0, 1), rng.uniform(3.4, 4.6)) for _ in range(5)]
        self.walkers = []
        for k in range(8):
            if k % 2:
                y = ROAD_H[0] + rng.choice([-2.5, 2.5]); xa, xb = rng.uniform(-40, 340), None
                self.walkers.append(('h', y, xa, rng.choice([-1, 1]) * rng.uniform(0.9, 1.4)))
            else:
                x = ROAD_V[0] + rng.choice([-2.5, 2.5]); ya = rng.uniform(-100, 180)
                self.walkers.append(('v', x, ya, rng.choice([-1, 1]) * rng.uniform(0.9, 1.4)))

    def draw(self, c, T):
        (Px, Py), s, k = self.cam.xf(T)
        def S(x, y):
            return Px + x * s, Py + y * s
        c.drawRect(skia.Rect(0, 0, W, H), paint(A_BG))
        grid(c, (Px, Py), s)
        lab = 1.0 - smooth((1.0 - k) / 0.25)            # the room's labels go first
        a_room = 1.0 - smooth((0.16 - k) / 0.10) if k < 0.16 else 1.0
        a_part = smooth((0.20 - k) / 0.10)              # simple partitions take over from the plans
        a_bld = smooth((0.55 - k) / 0.30)
        a_camp = smooth((0.24 - k) / 0.12)
        # ---- the campus ----
        if a_camp > 0:
            self.draw_campus(c, S, s, T, a_camp)
        # ---- our building ----
        if a_room > 0:
            c.save(); c.translate(Px, Py); c.scale(s / 100, s / 100)
            # the neighbours: identical rooms along the corridor, and mirrored across it
            an = a_room * smooth((1.0 - k) / 0.15)
            if an > 0.002:
                pa = skia.Paint(); pa.setAlphaf(an)
                c.saveLayer(None, pa)
                for i in range(-6, 6):
                    for mirror in (False, True):
                        if i == 0 and not mirror:
                            continue
                        c.save()
                        c.translate(i * ROOM_W * 100, 0)
                        if mirror:
                            c.translate(0, (2 * ROOM_H + CORR_W) * 100); c.scale(1, -1)
                        c.drawPicture(room_picture(False))
                        if not mirror:
                            light_rays(c, 100, 0.5 * self.sun_k(T))
                        c.restore()
                c.restore()
            # our room
            if lab > 0.001:
                pa = skia.Paint(); pa.setAlphaf(a_room * lab)
                c.saveLayer(None, pa); c.drawPicture(room_picture(True)); c.restore()
            if lab < 0.999:
                pa = skia.Paint(); pa.setAlphaf(a_room * (1 - lab))
                c.saveLayer(None, pa); c.drawPicture(room_picture(False)); c.restore()
            light_rays(c, 100, a_room)
            c.restore()
            if lab > 0:
                zx, zy = S(2.95, 4.05)
                text(c, '空', zx - 8, zy + 7, 'sans-light', 16, A_MID, 0.8 * lab)
        # our room stays warm when it's only a few pixels
        if a_room < 1:
            x0, y0 = S(0, 0); x1, y1 = S(ROOM_W, ROOM_H)
            c.drawRect(skia.Rect.MakeLTRB(x0, y0, x1, y1), paint(SUN, 0.45 * (1 - a_room)))
        if a_bld > 0:
            self.draw_building(c, S, s, a_bld, a_part)
        # the two of them, as dots, until the room is too small to hold them
        a_dots = 1.0 - smooth((0.5 - k) / 0.25) if k < 0.5 else 1.0
        if a_dots > 0:
            for who, spot in (('李', 'li_bed'), ('陈', 'chen_bed')):
                mx, my = O.PLAN_SPOTS[spot]
                x, y = S(mx, my)
                if who == '陈':
                    c.drawCircle(x, y, 9, paint(A_INK, 0.8 * a_dots, 1.4))
                O.person_dot(c, x, y, who, a_dots)
        # labels
        lk = min(smooth((0.62 - k) / 0.12), 1.0 - smooth((0.26 - k) / 0.08))
        if lk > 0:
            x, y = S(ROOM_W * 1.5, ROOM_H + CORR_W / 2)
            text(c, '走廊', x, y + 6, 'sans-light', 16, A_MID, lk, tracking=0.4)
        self.sunrise(c, T)
        c.drawImage(_vignette(), 0, 0)

    def sun_k(self, T):
        return smooth((T - self.cam.t0 - 2.0) / 40.0)

    def sunrise(self, c, T):
        w = self.sun_k(T)
        if w <= 0:
            return
        r = 700 + 1900 * w
        sh = skia.GradientShader.MakeRadial((W + 300, -350), r, [col((255, 226, 178), 0.55 * w), col((255, 226, 178), 0.30 * w), col((255, 226, 178), 0)], [0.0, 0.55, 1.0])
        c.drawRect(skia.Rect(0, 0, W, H), skia.Paint(Shader=sh, BlendMode=skia.BlendMode.kMultiply))
        glow(c, W + 100, -200, 900 + 900 * w, SUN, 0.20 * w)

    def draw_building(self, c, S, s, a, a_part):
        x0, y0, x1, y1 = BLD
        X0, Y0 = S(x0, y0); X1, Y1 = S(x1, y1)
        # partitions: our building's rooms and the corridor
        if a_part > 0:
            pp = paint(A_INK, 0.55 * a_part, 1.0)
            for i in range(-6, 7):
                X, _ = S(i * ROOM_W, 0)
                c.drawLine(X, Y0, X, S(0, ROOM_H)[1], pp)
                c.drawLine(X, S(0, ROOM_H + CORR_W)[1], X, Y1, pp)
            for yy in (ROOM_H, ROOM_H + CORR_W):
                _, Yc = S(0, yy)
                c.drawLine(X0, Yc, X1, Yc, pp)
        # stairwells at both ends
        for sx0 in (x0, x1 - 4.0):
            A_ = S(sx0, y0); B_ = S(sx0 + 4.0, y1)
            c.drawRect(skia.Rect.MakeLTRB(A_[0], A_[1], B_[0], B_[1]), paint(A_INK, 0.7 * a, 1.2))
            n = 12
            for j in range(n):
                yy = y0 + 3.0 + j * (y1 - y0 - 6.0) / (n - 1)
                P_, Q_ = S(sx0 + 0.3, yy), S(sx0 + 3.7, yy)
                c.drawLine(P_[0], P_[1], Q_[0], Q_[1], paint(A_INK, 0.4 * a, 0.8))
            M_ = S(sx0 + 2.0, y0 + 2.0); N_ = S(sx0 + 2.0, y1 - 2.0)
            c.drawLine(M_[0], M_[1], N_[0], N_[1], paint(A_INK, 0.5 * a, 0.8))
        c.drawRect(skia.Rect.MakeLTRB(X0, Y0, X1, Y1), paint(A_INK, a, 2.2))
        k = s / 100
        la = min(smooth((0.30 - k) / 0.08), 1.0 - smooth((0.07 - k) / 0.03))
        if la > 0:
            X, Y = S(x0 + 2.0, y1 + 2.0)
            text(c, '楼梯间', X, Y + 16, 'sans-light', 14, A_MID, la * a, 'center', tracking=0.3)
        lb = smooth((0.10 - k) / 0.04)
        if lb > 0:
            X, Y = S(x0, y0)
            text(c, '宿舍楼', X, Y - 10, 'sans-light', 15, A_MID, lb, tracking=0.4)

    def draw_campus(self, c, S, s, T, a):
        ink_ = paint(A_INK, 0.8 * a, 1.4)
        thin = paint(A_INK, 0.45 * a, 1.0)
        # roads
        x, y0, y1, w = ROAD_V
        for dx in (-w / 2, w / 2):
            P_, Q_ = S(x + dx, y0), S(x + dx, y1)
            c.drawLine(P_[0], P_[1], Q_[0], Q_[1], thin)
        y, x0, x1, w = ROAD_H
        for dy in (-w / 2, w / 2):
            P_, Q_ = S(x0, y + dy), S(x1, y + dy)
            c.drawLine(P_[0], P_[1], Q_[0], Q_[1], thin)
        # other dorm blocks
        for (bx0, by0, bx1, by1) in DORMS:
            A_ = S(bx0, by0); B_ = S(bx1, by1)
            c.drawRect(skia.Rect.MakeLTRB(A_[0], A_[1], B_[0], B_[1]), paint(A_BG, a))
            # the same rooms, the same corridor: every one of them someone's
            pp = paint(A_INK, 0.35 * a, 1.0)
            y_c0, y_c1 = S(0, by0 + ROOM_H)[1], S(0, by0 + ROOM_H + CORR_W)[1]
            for i in range(1, 14):
                X = S(bx0 + i * ROOM_W, 0)[0]
                c.drawLine(X, A_[1], X, y_c0, pp); c.drawLine(X, y_c1, X, B_[1], pp)
            c.drawLine(A_[0], y_c0, B_[0], y_c0, pp); c.drawLine(A_[0], y_c1, B_[0], y_c1, pp)
            c.drawRect(skia.Rect.MakeLTRB(A_[0], A_[1], B_[0], B_[1]), ink_)
        # teaching building
        for poly in TEACH:
            p = skia.Path(); p.moveTo(*S(*poly[0]))
            for q in poly[1:]:
                p.lineTo(*S(*q))
            p.close()
            c.drawPath(p, paint(A_BG, a))
            c.save(); c.clipPath(p, skia.ClipOp.kIntersect, True)
            A_ = S(168, 88); B_ = S(350, 150)
            hatch_rect(c, A_[0], A_[1], B_[0], B_[1], 7.0, 0.16 * a)
            c.restore()
            c.drawPath(p, paint(A_INK, 0.85 * a, 1.6))
        X, Y = S(259, 150)
        text(c, '教学楼', X, Y + 24, 'sans-light', 15, A_MID, a, 'center', tracking=0.4)
        # the track
        c.save(); c.translate(*S(0, 0)); c.scale(s, s)
        for j, rr in enumerate([TRACK_R, TRACK_R + 1.22 * 4, TRACK_R + 1.22 * TRACK_LANES]):
            p = track_path(TRACK_C, rr, TRACK_S)
            pp = paint(A_INK, (0.8 if j != 1 else 0.3) * a, (1.4 if j != 1 else 1.0) / s)
            c.drawPath(p, pp)
        cx, cy = TRACK_C
        c.drawRect(skia.Rect.MakeLTRB(cx - 50, cy - 32, cx + 50, cy + 32), paint(A_INK, 0.35 * a, 1.0 / s))
        c.drawLine(cx, cy - 32, cx, cy + 32, paint(A_INK, 0.35 * a, 1.0 / s))
        c.drawCircle(cx, cy, 9.15, paint(A_INK, 0.35 * a, 1.0 / s))
        c.restore()
        X, Y = S(TRACK_C[0], TRACK_C[1] - TRACK_R - 1.22 * TRACK_LANES)
        text(c, '田径场', X, Y - 12, 'sans-light', 15, A_MID, a, 'center', tracking=0.4)
        # plane trees
        tp = paint(A_INK, 0.55 * a, 1.0)
        for (tx, ty) in trees():
            X, Y = S(tx, ty)
            if -20 < X < W + 20 and -20 < Y < H + 20:
                r = clamp(3.2 * s, 2.4, 7.0)
                c.drawCircle(X, Y, r, tp)
                c.drawCircle(X, Y, 1.0, paint(A_INK, 0.6 * a))
        X, Y = S(ROAD_V[0] + 10, ROAD_V[1] + 30)
        text(c, '梧桐', X, Y, 'sans-light', 13, A_MID, 0.9 * a, tracking=0.3)
        # people: running, reading, walking a bicycle
        tt = T - self.cam.t0
        for i, (lr, ph, v) in enumerate(self.runners):
            per = 2 * TRACK_S + 2 * math.pi * lr
            X, Y = S(*track_point(ph + tt * v / per, lr))
            c.drawCircle(X, Y, 4.2, paint(A_INK, a))
            if i == 0:
                text(c, '跑步', X + 9, Y - 7, 'sans-light', 13, A_MID, 0.9 * a)
        X, Y = S(193.0, -88.0)
        c.drawCircle(X, Y, 4.2, paint(A_INK, a))
        text(c, '背单词', X + 9, Y + 5, 'sans-light', 13, A_MID, 0.9 * a)
        # the bicycle: from the dorms, along the road, towards the teaching building
        path = [(20.0, 22.0), (ROAD_V[0] - 2.2, 22.0), (ROAD_V[0] - 2.2, ROAD_H[0] - 2.0), (205.0, ROAD_H[0] - 2.0), (205, 86)]
        segs = [math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]) for i in range(len(path) - 1)]
        dist = 18 + tt * 1.35
        px, py, dxv, dyv = path[-1][0], path[-1][1], 0.0, 1.0
        for i, L_ in enumerate(segs):
            if dist <= L_:
                f = dist / L_
                px = path[i][0] + (path[i + 1][0] - path[i][0]) * f
                py = path[i][1] + (path[i + 1][1] - path[i][1]) * f
                dxv, dyv = (path[i + 1][0] - path[i][0]) / L_, (path[i + 1][1] - path[i][1]) / L_
                break
            dist -= L_
        X, Y = S(px, py)
        c.drawCircle(X, Y, 4.2, paint(A_INK, a))
        bx, by = S(px - dyv * 1.4, py + dxv * 1.4)
        c.drawLine(bx - dxv * 7, by - dyv * 7, bx + dxv * 7, by + dyv * 7, paint(A_INK, 0.8 * a, 1.6))
        text(c, '推着自行车', X + 10, Y - 8, 'sans-light', 13, A_MID, 0.9 * a)
        # others, walking
        for (kind, fixed, start, v) in self.walkers:
            pos = start + v * tt
            if kind == 'h':
                pos = -40 + ((pos + 40) % 380)
                X, Y = S(pos, fixed)
            else:
                pos = -100 + ((pos + 100) % 280)
                X, Y = S(fixed, pos)
            c.drawCircle(X, Y, 3.2, paint(A_MID, 0.8 * a))

# =====================================================================
# sounds
# =====================================================================
def _tt(d):
    return np.arange(int(d * SR)) / SR

def office_tone(d, seed=1460):
    x = lowpass(sfx.noise(d, seed, 'pink'), 1100) * 0.016
    t = _tt(d)
    x += (0.003 * np.sin(2 * np.pi * 100 * t) + 0.0015 * np.sin(2 * np.pi * 200 * t)).astype(np.float32)
    return x

def printer_far(d, seed=1461):
    x = sfx.printer(d, seed)
    return reverb(lowpass(x, 1500), wet=0.6, decay=1.4, size='hall')[:len(x)]

def outside_morning(d, seed=1470):
    """Morning outside a window: birds, far murmur. Stereo, soft."""
    return lowpass(sfx.campus(d, seed), 4200) * 0.9

def birds(d, seed=1471, density=1.0):
    """Morning birdsong: short phrases of chirps, scattered in the stereo field."""
    rng = np.random.default_rng(seed)
    out = np.zeros((int(d * SR), 2), np.float32)
    n = int(d * 0.9 * density)
    for k in range(n):
        s0 = rng.uniform(0, d - 1.5)
        f0 = rng.uniform(2600, 4600)
        pan = rng.uniform(-0.9, 0.9)
        amp = rng.uniform(0.006, 0.016)
        kind = rng.integers(0, 3)
        for j in range(rng.integers(2, 6)):
            dd = rng.uniform(0.05, 0.14); tt = _tt(dd)
            if kind == 0:
                f = f0 + rng.uniform(-300, 900) * tt / dd
            elif kind == 1:
                f = f0 * (1 + 0.25 * np.sin(np.pi * tt / dd))
            else:
                f = f0 - 600 * tt / dd
            ph = 2 * np.pi * np.cumsum(f) / SR
            ch = np.sin(ph) * np.sin(np.pi * tt / dd) ** 2 * amp
            i0 = int((s0 + j * rng.uniform(0.10, 0.2)) * SR)
            if i0 + len(ch) < len(out):
                out[i0:i0 + len(ch)] += to_stereo(ch.astype(np.float32), pan)
    return out

def runner(d, seed=1472, rate=2.75):
    """Someone running past, far off: soft footfalls on the track, passing left to right."""
    rng = np.random.default_rng(seed)
    out = np.zeros(int(d * SR), np.float32)
    t = 0.0
    while t < d - 0.3:
        f = sfx.footstep(int(rng.integers(0, 1e6)), rng.uniform(0.7, 1.0))
        f = highpass(f, 180)
        s = int(t * SR); out[s:s + len(f)] += f[:len(out) - s]
        t += 1.0 / rate + rng.normal(0, 0.01)
    tt = _tt(d)
    env = np.exp(-((tt - d * 0.5) / (d * 0.28)) ** 2)
    pan = np.clip((tt / d) * 1.6 - 0.8, -0.8, 0.8)
    x = out * env
    L = x * np.cos((pan + 1) * np.pi / 4) * 1.4142; R = x * np.sin((pan + 1) * np.pi / 4) * 1.4142
    return lowpass(np.stack([L, R], 1).astype(np.float32), 3000)

def words_far():
    """Someone reading English words aloud, far away across the campus: just a murmur."""
    from film import voice as V
    y, _ = V.synth('narr', 'abandon, abandon. ability, able, abnormal.', speed=0.8)
    y2, _ = V.synth('narr', 'abroad, absence, absolute, absorb.', speed=0.8)
    x = np.concatenate([y, np.zeros(int(1.6 * SR), np.float32), y2])
    x = lowpass(highpass(x, 300), 1800)
    return reverb(x * 0.7, wet=0.7, decay=1.8, size='hall')

def piano_held(f, d=15.0, a=1.0, sustain=0.2):
    """sfx.piano's tone, but with the pedal down: the partials die away slowly."""
    t = _tt(d)
    x = np.zeros_like(t)
    B = 0.0004
    for k in range(1, 9):
        fk = f * k * np.sqrt(1 + B * k * k)
        amp = 1 / k ** 1.4
        dec = (1.2 + 0.9 * k) * sustain
        for det in (-0.6, 0.6):
            x += amp * np.sin(2 * np.pi * (fk + det * k * 0.15) * t + k) * np.exp(-t * dec / 2.2)
    x *= np.minimum(1, t / 0.004)
    k0 = int((d - 3.5) * SR)
    x[k0:] *= np.linspace(1, 0, len(x) - k0) ** 2
    return lowpass((x * a * 0.25).astype(np.float32), 5800)

def elegy():
    """The alarm melody, slowed, low, on a piano (as sfx.alarm_elegy, but a true octave down so the
    melody keeps its shape). Twice: alone, then with a few low notes under it; the last C held."""
    def down(n):
        return n[0] + n[1:-1] + str(int(n[-1]) - 1) if n else None
    mel = [(down(n), b * 2) for n, b in sfx.ALARM_NOTES]
    bpm = 46
    beat = 60.0 / bpm
    one = sum(b for _, b in mel) * beat
    tail = 15.0
    out = np.zeros(int((2 * one + tail) * SR), np.float32)
    def put(f, t, d, a, held=False):
        x = piano_held(sfx.hz(f), d, a) if held else sfx.piano(sfx.hz(f), d, a)
        s = int(t * SR); e = min(len(out), s + len(x))
        out[s:e] += x[:e - s]
    t = 0.0
    for n, b in mel:
        if n:
            put(n, t, 4.0, 1.0)
        t += b * beat
    # second time: softer, with the left hand
    t = one
    bass_at = {0: 'C3', 4: 'A2', 8: 'G2'}
    pos = 0.0
    for i, (n, b) in enumerate(mel):
        q = int(round(pos * 2))
        if q in bass_at:
            put(bass_at[q], t, 6.0, 0.55)
        if n:
            last = (i == len(mel) - 2)
            put(n, t, 15.0 if last else 4.0, 0.8, held=last)
            if last:
                put('E3', t + 0.05, 15.0, 0.32, held=True); put('G3', t + 0.1, 15.0, 0.28, held=True)
                put('C3', t + 0.0, 15.0, 0.4, held=True)
        t += b * beat
        pos += b / 2
    x = reverb(out, wet=0.35, decay=2.6, size='hall')
    return normalize(x, 0.5), one, 28 * beat

# =====================================================================
# build
# =====================================================================
def build():
    sc = Scene('s14_final', kind='A', title='第十四场【循环 → 终结】')

    # ================= 1. the police station =================
    sc.wait(1.2)
    t_p = sc.t
    notes = Notes(t_p + 2.0, pauses={5: 3.4})
    P1 = 10.5                            # desk
    P2 = 9.5                             # insert: notebook and statement
    P3 = 6.5                             # desk: Li looks at the contract
    P4 = 8.5                             # the 月
    t_ins = t_p + P1
    t_desk2 = t_ins + P2
    t_gaze = t_desk2 + 1.2
    t_yue = t_desk2 + P3
    t_pend = t_yue + P4
    tm = notes.spans[4][1] + 0.5
    marks = [(2, (tm, tm + 0.7)), (4, (tm + 1.1, tm + 1.8)), (5, (tm + 2.2, tm + 2.8))]

    def desk(c, t, L):
        T = L.T
        a_bg(c)
        draw_desk(c, T, notes, t_gaze, marks)
        desk_people(c, T, t_gaze)
        O.clock_card(c, 1560, 190, 1.0, date='5月9日', time='11:20', size=70)
        text(c, '派出所', 1560, 360, 'sans-light', 18, A_MID, 0.9, tracking=0.4)
        for i, (no, title) in enumerate(((1, '借款协议（拼合）'), (2, '日记（打印件）'), (3, '银行账户交易明细'))):
            O.evidence_tag(c, 1560, 470 + i * 56, no, title, a=1.0)
    sc.layer(desk, t_p, t_ins, fin=2.0, fout=0.0)
    sc.layer(desk, t_desk2, t_yue, fin=0.0, fout=0.0)

    INS_K, INS_F, INS_Q = 1.55, (1250.0, 492.0), (980.0, 540.0)
    def insert(c, t, L):
        T = L.T
        a_bg(c)
        c.save()
        c.translate(INS_Q[0], INS_Q[1]); c.scale(INS_K, INS_K); c.translate(-INS_F[0], -INS_F[1])
        draw_desk(c, T, notes, None, marks)
        c.restore()
    sc.layer(insert, t_ins, t_desk2)

    def yue(c, t, L):
        img, (sx, sy) = macro_image()
        c.drawImage(img, 0, 0, SAMP)
        O.evidence_tag(c, 150, 96, 1, '借款协议（拼合）', '第 1 页 · 第四条', a=1.0)
        label_typed(c, '那个“月”字依然藏在纸的最右边，和六十二天前一模一样。', 150, H - 110, t - 1.4, cps=12)
    sc.layer(yue, t_yue, t_pend, fin=0.0, fout=2.4)

    sc.amb(office_tone(30, 1460), t_p, t_pend, gain=-4, fin=2.0, fout=2.4)
    sc.amb(printer_far(30, 1461), t_p, t_pend, gain=-11, fin=2.5, fout=2.4)
    for (t0, t1) in notes.spans:
        if t0 < t_pend - 1:
            sc.sfx(sfx.pen_on_paper(t1 - t0, int(t0 * 10)), at=t0, gain=-3, pan=0.25)
    for r, (t0, t1) in marks:
        sc.sfx(sfx.pen_on_paper(t1 - t0 + 0.1, 1480 + r), at=t0, gain=-3, pan=0.2)
    sc.sfx(sfx.paper_rustle(1462, 0.5), at=t_gaze - 0.3, gain=-20, pan=-0.3)
    sc.at(t_pend)

    # ================= 2. black. the alarm, once more =================
    sc.wait(2.0)
    t_alarm = sc.t
    al = sfx.alarm(2)
    cut = int(3.25 * SR)
    sc.sfx(env_fade(al[:cut], 0.0, 0.05), gain=-6)
    t_board = t_alarm + 1.3
    def board(c, t, L):
        c.drawImage(_board_image(), 0, 0)
    sc.layer(board, t_board, t_board + 2.4, fin=0.0, fout=0.3)
    t_phone = t_board + 2.4
    sc.sfx(sfx.click(3, 2500, 0.03, 0.4), at=t_alarm + 3.25, gain=-8)
    PH = 14.0
    t_touch = t_phone + 5.2
    t_sink = t_phone + PH - 3.2
    def phone(c, t, L):
        T = L.T
        lit = smooth(t / 0.4) * (1 - 0.85 * smooth((T - t_sink) / 2.2))
        touch = smooth((T - t_touch) / 0.8) * (1 - smooth((T - t_sink) / 1.0))
        phone_shot(c, t, L, lit, touch, ease_in_out((T - t_sink) / 2.6))
        label_typed(c, '他盯着这四个字看了很久。', L.w / 2, 900, t - 1.8, cps=10, size=26, rgb=A_MID, align='center')
        if T > t_touch + 0.6:
            a2 = 1.0
            label_typed(c, '手指在屏幕上停留着，好像怕触碰会让数字变回去。', L.w / 2, 948, T - t_touch - 0.6, cps=10, size=26, rgb=A_MID, align='center')
    sc.layer(phone, t_phone, t_phone + PH, fin=0.0, fout=1.0)
    sc.at(t_phone + PH - 0.6)

    # ================= the master: 5月10日, no siren, the light =================
    t_m = sc.t
    log = []
    log.append((t_m + 0.5, '08:30', '闹钟。同一段旋律。'))
    log.append((t_m + 2.0, '08:30', '李浩然的眼睛猛地睁开。第一个动作——已经成为肌肉记忆的动作——是去抓枕头旁的手机。'))
    log.append((t_m + 5.2, '08:30', '屏幕上是：5月10日。'))
    log.append((t_m + 7.4, '08:31', '他慢慢把手机放在胸口，闭上眼睛。'))
    t_nosiren = t_m + 10.5
    log.append((t_nosiren, '08:31', '窗外没有警笛。'))
    t_light = t_nosiren + 7.0
    log.append((t_light + 0.6, '08:32', '阳光从窗帘缝里照进来，落在三张桌子上：李浩然的，陈杰辉的，和靠墙那一张空的。'))
    t_zins = t_light + 8.0
    ZI = 17.5
    t_m2 = t_zins + ZI
    t_wake = t_m2 + 1.6
    log.append((t_wake, '08:34', '对面床上，陈杰辉醒了。他看了一眼手机，然后看了一眼李浩然。'))
    t_look = t_wake + 3.4
    log.append((t_look + 3.4, '08:34', '什么都没有说。'))
    t_pb = t_look + 9.0                    # the camera moves
    PB = 44.0
    cam = Cam(t_pb, PB)
    campus = Campus(cam, t_light)

    def master(c, t, L):
        T = L.T
        c.drawImage(_plan_image(), 0, 0, SAMP)
        # the light on the three desks
        k = smooth((T - t_light) / 4.0)
        if k > 0:
            c.save(); c.translate(PX, PY)
            light_rays(c, 100 * PS, k)
            c.restore()
        zx, zy = O.plan_xy(PX, PY, PS, 'zhang_desk')
        text(c, '空', zx - 8, zy + 7, 'sans-light', 16, A_MID, 0.8)
        # where the siren always was: nothing (an empty ring, once)
        if T > t_nosiren:
            ka = smooth((T - t_nosiren) / 1.0) * (1 - smooth((T - t_nosiren - 5.0) / 3.0))
            if ka > 0:
                wx, wy = O.plan_xy(PX, PY, PS, 'window')
                p = paint(A_MID, 0.7 * ka, 1.0); p.setPathEffect(skia.DashPathEffect.Make([3.0, 4.0], 0.0))
                c.drawCircle(wx + 120, wy - 60, 12, p)
        # Li: phone on his chest, eyes closed. Chen: asleep (a ring) until he wakes
        lx, ly = O.plan_xy(PX, PY, PS, 'li_bed')
        O.person_dot(c, lx, ly, '李')
        cx, cy = O.plan_xy(PX, PY, PS, 'chen_bed')
        wk = smooth((T - t_wake) / 0.8)
        c.drawCircle(cx, cy, 9, paint(A_INK, 0.8, 1.4))
        c.drawCircle(cx, cy, 9 * wk, paint(A_INK, wk))
        text(c, '陈', cx + 17, cy + 7, 'sans-medium', 18, A_INK, 0.55 + 0.45 * wk, tracking=0.1)
        if T > t_wake and T < t_wake + 1.6:
            rr = (T - t_wake) / 1.6
            c.drawCircle(cx, cy, 19 + 18 * rr, paint(A_INK, (1 - rr) * 0.6, 1.2))
        if T > t_look:
            ka = smooth((T - t_look) / 0.6) * (1 - smooth((T - t_look - 4.0) / 1.5))
            if ka > 0:
                p = paint(A_INK, 0.7 * ka, 1.2); p.setPathEffect(skia.DashPathEffect.Make([4.0, 4.0], 0.0))
                c.drawLine(cx - 13, cy + 4, lx - 13, ly - 4, p)
        stamp = [e[1] for e in log if e[0] <= T]
        O.clock_card(c, RX, 210, 1.0, date='5月10日', time=stamp[-1] if stamp else '08:30')
        O.event_log(c, RX, 420, log, T, maxw=780)
    sc.layer(master, t_m, t_zins, fin=0.6, fout=0.0)
    sc.layer(master, t_m2, t_pb + 0.02, fin=0.0, fout=0.0)

    # the overlay (clock card + log) leaves as the camera starts to move
    def overlay_out(c, t, L):
        T = L.T
        a = 1 - smooth((T - t_pb) / 2.5)
        if a <= 0:
            return
        stamp = [e[1] for e in log if e[0] <= T]
        O.clock_card(c, RX, 210, a, date='5月10日', time=stamp[-1])
        O.event_log(c, RX, 420, log, T, maxw=780, a=a)
    def pullback(c, t, L):
        campus.draw(c, L.T)
    pb_layer = sc.layer(pullback, t_pb, None, fin=0.0, fout=4.0, z=0)
    sc.layer(overlay_out, t_pb, t_pb + 2.6, z=1)

    # ---------------- Zhang's desk from above ----------------
    ZL1 = '台灯还在那里。教材还在那里。洗得掉色的笔袋还在那里。'
    ZL2 = '速写本还摊在桌角，上面画了半棵梧桐树。没有画完。'
    t_empty = t_zins + 11.0
    def zdesk(c, t, L):
        T = L.T
        draw_zdesk(c, T, 1.0)
        fade_l = 1 - smooth((T - t_empty + 0.8) / 0.8)
        if fade_l > 0:
            label_typed(c, ZL1, 150, H - 150 + 40, t - 1.2, cps=12, a=fade_l)
            label_typed(c, ZL2, 150, H - 110 + 50, t - 1.2 - len(ZL1) / 12 - 0.8, cps=12, a=fade_l)
        if T > t_empty:
            label_typed(c, '只是椅子空了。', L.w / 2, H - 70, T - t_empty, cps=5, size=30, align='center')
    sc.layer(zdesk, t_zins, t_m2, fin=0.0, fout=0.0)

    # ---------------- sound: the morning ----------------
    sc.amb(sfx.room_tone(60, 1), t_alarm - 0.1, t_pb + 14, gain=-2, fin=0.3, fout=8.0)
    sc.amb(outside_morning(40, 1470), t_m + 1.0, t_pb + 16, gain=-13, fin=5.0, fout=8.0)
    sc.sfx(sfx.paper_rustle(1463, 0.8), at=t_m + 5.6, gain=-14, pan=-0.4)
    sc.sfx(sfx.paper_rustle(1464, 0.9), at=t_wake - 0.3, gain=-13, pan=-0.4)

    # ---------------- sound: the pull-back ----------------
    mus, one, t_chord = elegy()
    t_mus = t_pb + 0.6
    t_c1 = t_pb + 26.5                       # 这一天是 5 月 10 日。
    t_c2 = t_mus + t_chord + 0.4             # 这一天只会来一次。 — on the last, held note
    t_end = t_c2 + 9.0 + 3.5
    mus = mus[:int((t_end + 2.0 - t_mus) * SR)]
    sc.music(mus, t_mus, gain=-3, fin=0.05, fout=3.5)
    sc.amb(sfx.campus(60, 1473), t_pb + 3.0, None, gain=-3, fin=10.0, fout=5.0)
    sc.sfx(birds(t_end - t_pb - 4.0, 1471, 1.0), at=t_pb + 4.0, gain=3, fin=6.0, fout=5.0, bus='amb')
    sc.sfx(runner(9.0, 1472), at=t_pb + 15.0, gain=-10)
    sc.sfx(runner(10.0, 1474, 2.9), at=t_pb + 30.0, gain=-13)
    sc.sfx(words_far(), at=t_pb + 20.0, gain=-19, pan=0.35, fin=1.0, fout=2.0)

    # captions
    sc.caption('这一天是 5 月 10 日。', start=t_c1, dur=7.5)
    sc.caption('这一天只会来一次。', start=t_c2, dur=9.0)
    def capback(c, t, L):
        T = L.T
        for (t0, d, txt) in ((t_c1, 7.5, '这一天是 5 月 10 日。'), (t_c2, 9.0, '这一天只会来一次。')):
            a = min(smooth((T - t0) / 0.4), smooth((t0 + d - T) / 0.5))
            if a <= 0:
                continue
            w_ = text_width(txt, 'serif-light', 40, 0.1) + 140
            p = paint((236, 229, 214), 0.72 * a); p.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 26))
            c.drawRoundRect(skia.Rect.MakeXYWH(W / 2 - w_ / 2, H - 110 - 62, w_, 92), 40, 40, p)
    sc.layer(capback, t_c1 - 0.1, t_c2 + 9.2, z=3)
    sc.at(t_end)
    for ly in sc.layers:
        if ly.fn is pullback:
            ly.end = t_end + 1.0
    sc.finish(tail=0.0)
    return sc

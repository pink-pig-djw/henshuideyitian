"""Subtitle / on-screen dialogue rendering.

Styles
  'A'  transcript (笔录) style for the loop line: left-aligned, name + line, typed on in sync.
  'B'  film subtitle inside the 4:3 sketchbook frame: small name label above a serif line.
  'N'  narration: centred, light serif, no name.
  'C'  caption: centred text card near the bottom, no name.
"""
from .config import *
from .gfx import text, text_width, wrap, font, smooth, clamp, paint, col
from . import voice as V
import skia

def _alpha(s, t, fin=0.15, fout=0.3, linger=0.35):
    end = s.end + linger
    if t < s.start or t > end:
        return 0.0
    return min(smooth((t - s.start) / fin) if fin else 1, smooth((end - t) / fout) if fout else 1)

def draw_subs(c, sc, t, w, h):
    subs = [s for s in sc.subs if s.start - 0.01 <= t <= s.end + 0.7]
    if not subs:
        return
    # when lines overlap in time, the later one wins for the main slot
    cur = subs[-1]
    style = cur.style
    if style == 'A':
        _draw_A(c, sc, t, w, h, subs)
    else:
        for s in subs[-1:]:
            if s.style == 'B':
                _draw_B(c, sc, t, w, h, s)
            elif s.style == 'N':
                _draw_N(c, sc, t, w, h, s)
            elif s.style == 'C':
                _draw_C(c, sc, t, w, h, s)

def _name(s):
    n = V.label(s.who) if s.who in V.CAST else s.who
    if s.note:
        n = f'{n} · {s.note}' if n else s.note
    return n

def _draw_B(c, sc, t, w, h, s):
    a = _alpha(s, t)
    if a <= 0:
        return
    rgb = sc.sub_color or GRAPHITE
    size = 42
    lines = wrap(s.text, 'serif', size, min(1220, w - 140))
    base = (sc.sub_y or (h - 92)) - (len(lines) - 1) * size * 1.5
    # soft backing so text reads on any drawing
    bg = (20, 20, 20) if sum(rgb) > 380 else (238, 230, 214)
    bw = max(text_width(l, 'serif', size) for l in lines) + 70
    p = paint(bg, 0.34 * a)
    p.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 22))
    c.drawRoundRect(skia.Rect.MakeXYWH(w / 2 - bw / 2, base - size * 1.9, bw, size * 1.5 * len(lines) + size * 1.6), 30, 30, p)
    nm = _name(s)
    if nm:
        text(c, nm, w / 2, base - size * 1.12, 'sans-light', 21, rgb, a * 0.66, 'center', tracking=0.35)
    for i, l in enumerate(lines):
        text(c, l, w / 2, base + i * size * 1.5, 'serif', size, rgb, a, 'center', tracking=0.02)

def _draw_N(c, sc, t, w, h, s):
    a = _alpha(s, t, 0.3, 0.5, 0.5)
    if a <= 0:
        return
    rgb = sc.sub_color or GRAPHITE
    size = 38
    lines = wrap(s.text, 'serif-light', size, min(1240, w - 160), 0.06)
    base = (sc.sub_y or (h - 96)) - (len(lines) - 1) * size * 1.6
    bg = (15, 15, 15) if sum(rgb) > 380 else (238, 230, 214)
    bw = max(text_width(l, 'serif-light', size, 0.06) for l in lines) + 80
    p = paint(bg, 0.30 * a)
    p.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 24))
    c.drawRoundRect(skia.Rect.MakeXYWH(w / 2 - bw / 2, base - size * 1.3, bw, size * 1.6 * len(lines) + size * 0.9), 30, 30, p)
    for i, l in enumerate(lines):
        text(c, l, w / 2, base + i * size * 1.6, 'serif-light', size, rgb, a * 0.92, 'center', tracking=0.06)

def _draw_C(c, sc, t, w, h, s):
    a = _alpha(s, t, 0.4, 0.5, 0.0)
    if a <= 0:
        return
    rgb = sc.sub_color or GRAPHITE
    size = 40
    lines = wrap(s.text, 'serif-light', size, w - 300, 0.1)
    base = (sc.sub_y or (h - 110)) - (len(lines) - 1) * size * 1.6
    for i, l in enumerate(lines):
        text(c, l, w / 2, base + i * size * 1.6, 'serif-light', size, rgb, a, 'center', tracking=0.1)

def _draw_A(c, sc, t, w, h, subs):
    """Transcript: current line typed on; the previous line stays above, faded."""
    rgb = sc.sub_color or A_INK
    x = 150
    y0 = sc.sub_y or (h - 118)
    size = 40
    shown = [s for s in sc.subs if s.style == 'A' and s.start <= t <= s.end + 1.2]
    shown = shown[-2:]
    y = y0
    for k, s in enumerate(reversed(shown)):
        cur = (k == 0)
        a = _alpha(s, t, 0.08, 0.5, 1.2)
        if not cur:
            a *= 0.32
        if a <= 0:
            continue
        nm = _name(s)
        # typed on, but always complete by ~55% of the spoken line so it reads as a proper subtitle
        prog = clamp((t - s.start) / max(0.25, min(1.6, s.dur_speech * 0.55))) if cur else 1.0
        lines = wrap(s.text, 'sans-light', size, w - x - 200 - 150)
        total = sum(len(l) for l in lines)
        chars = int(round(total * prog + 0.49))
        yy = y - (len(lines) - 1) * size * 1.45
        if not cur:
            yy -= 18
        text(c, nm, x, yy, 'sans-medium', 22, A_MID if sum(rgb) < 380 else (170, 176, 182), a, tracking=0.25)
        shown_n = 0
        for i, l in enumerate(lines):
            vis = l[:max(0, chars - shown_n)]
            shown_n += len(l)
            text(c, vis, x + 150, yy + i * size * 1.45, 'sans-light', size, rgb, a, tracking=0.02)
            if cur and 0 < len(vis) < len(l) and i == len([1 for _ in lines[:i]]):
                pass
        # caret
        if cur and prog < 1.0:
            pass
        y = yy - size * 1.45 - 26

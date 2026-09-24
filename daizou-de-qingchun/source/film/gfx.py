"""Drawing helpers on top of skia: colours, fonts, text, textures, easing."""
import math, functools
import numpy as np
import skia
from .config import *

# ---------------- colour / paint ----------------
def col(rgb, a=1.0):
    r, g, b = rgb[:3]
    return skia.Color(int(r), int(g), int(b), int(max(0, min(1, a)) * 255))

def paint(rgb=(0, 0, 0), a=1.0, stroke=None, aa=True, blend=None):
    p = skia.Paint(AntiAlias=aa, Color=col(rgb, a))
    if stroke is not None:
        p.setStyle(skia.Paint.kStroke_Style)
        p.setStrokeWidth(stroke)
        p.setStrokeCap(skia.Paint.kRound_Cap)
        p.setStrokeJoin(skia.Paint.kRound_Join)
    if blend is not None:
        p.setBlendMode(blend)
    return p

def mix(c1, c2, t):
    t = max(0.0, min(1.0, t))
    return tuple(c1[i] + (c2[i] - c1[i]) * t for i in range(3))

# ---------------- easing ----------------
def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x

def ramp(t, t0, t1):
    """0 before t0, 1 after t1, linear between."""
    if t1 <= t0:
        return 1.0 if t >= t1 else 0.0
    return clamp((t - t0) / (t1 - t0))

def smooth(x):
    x = clamp(x)
    return x * x * (3 - 2 * x)

def ease_out(x):
    x = clamp(x)
    return 1 - (1 - x) ** 3

def ease_in_out(x):
    x = clamp(x)
    return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2

def fade(t, dur, fin=0.6, fout=0.6):
    """Alpha for a layer of length dur at local time t with fade in/out."""
    a = 1.0
    if fin > 0:
        a = min(a, smooth(t / fin))
    if fout > 0:
        a = min(a, smooth((dur - t) / fout))
    return clamp(a)

# ---------------- fonts & text ----------------
@functools.lru_cache(maxsize=None)
def typeface(name):
    return skia.Typeface.MakeFromFile(FONTS[name])

@functools.lru_cache(maxsize=4096)
def font(name, size):
    f = skia.Font(typeface(name), size)
    f.setSubpixel(True)
    f.setEdging(skia.Font.Edging.kAntiAlias)
    return f

def text_width(s, name, size, tracking=0.0):
    f = font(name, size)
    if not s:
        return 0.0
    return f.measureText(s) + tracking * size * (len(s) - 1)

def text(c, s, x, y, name='serif', size=40, rgb=A_INK, a=1.0, align='left', tracking=0.0, p=None):
    """Draw single-line text. y is the baseline. tracking in em units."""
    if not s or a <= 0:
        return 0.0
    f = font(name, size)
    if p is None:
        p = paint(rgb, a)
    w = text_width(s, name, size, tracking)
    if align == 'center':
        x -= w / 2
    elif align == 'right':
        x -= w
    if tracking == 0:
        c.drawString(s, x, y, f, p)
    else:
        cx = x
        for ch in s:
            c.drawString(ch, cx, y, f, p)
            cx += f.measureText(ch) + tracking * size
    return w

def text_mid(c, s, x, y, **kw):
    """Draw with y as the vertical centre of CJK glyphs."""
    size = kw.get('size', 40)
    return text(c, s, x, y + size * 0.36, **kw)

def wrap(s, name, size, maxw, tracking=0.0):
    """Greedy CJK-aware line wrapping; honours explicit \n. Avoids line-leading punctuation."""
    out = []
    NOLEAD = '，。、；：？！”’）》」』…—,.;:?!)'
    for para in s.split('\n'):
        line = ''
        for ch in para:
            if text_width(line + ch, name, size, tracking) > maxw and line:
                if ch in NOLEAD:
                    line += ch
                    out.append(line); line = ''
                    continue
                out.append(line); line = ch
            else:
                line += ch
        if line or not para:
            out.append(line)
    return out

def text_block(c, s, x, y, maxw, name='serif', size=40, lh=1.7, rgb=A_INK, a=1.0, align='left', tracking=0.0, chars=None):
    """Wrapped paragraph; y is first baseline. chars limits visible characters (typewriter)."""
    lines = wrap(s, name, size, maxw, tracking)
    shown = 0
    for i, ln in enumerate(lines):
        if chars is not None:
            if shown >= chars:
                break
            vis = ln[:max(0, int(chars - shown))]
            shown += len(ln)
        else:
            vis = ln
        ax = x
        if align == 'center':
            ax = x + maxw / 2
        elif align == 'right':
            ax = x + maxw
        text(c, vis, ax, y + i * size * lh, name, size, rgb, a, align, tracking)
    return len(lines) * size * lh

def vtext(c, s, x, y, name='serif', size=40, rgb=A_INK, a=1.0, gap=0.15):
    """Vertical text, top at y, centred on x."""
    f = font(name, size)
    p = paint(rgb, a)
    cy = y
    for ch in s:
        w = f.measureText(ch)
        c.drawString(ch, x - w / 2, cy + size * 0.88, f, p)
        cy += size * (1 + gap)
    return cy - y

# ---------------- textures ----------------
def _to_image(arr):
    arr = np.ascontiguousarray(arr.astype(np.uint8))
    return skia.Image.fromarray(arr, colorType=skia.kRGBA_8888_ColorType)

def _lowfreq(rng, h, w, scale):
    sh, sw = max(2, h // scale), max(2, w // scale)
    small = rng.random((sh, sw)).astype(np.float32)
    img = skia.Image.fromarray(np.dstack([(small * 255).astype(np.uint8)] * 3 + [np.full((sh, sw), 255, np.uint8)]),
                               colorType=skia.kRGBA_8888_ColorType)
    big = img.resize(w, h, skia.SamplingOptions(skia.FilterMode.kLinear))
    return big.toarray(colorType=skia.kRGBA_8888_ColorType)[..., 0].astype(np.float32) / 255.0

@functools.lru_cache(maxsize=64)
def paper(w, h, rgb, seed=1, fibre=1.0, mottle=1.0):
    """Paper texture image: base colour, soft mottling, fine grain and faint fibres."""
    rng = np.random.default_rng(seed)
    base = np.array(rgb, np.float32)[None, None, :]
    m = (_lowfreq(rng, h, w, 180) - 0.5) * 10 * mottle + (_lowfreq(rng, h, w, 40) - 0.5) * 5 * mottle
    g = rng.normal(0, 3.2, (h, w)).astype(np.float32)
    img = base + (m + g)[..., None]
    if fibre > 0:
        n = int(w * h / 900 * fibre)
        ys = rng.integers(0, h, n); xs = rng.integers(0, w, n)
        L = rng.integers(3, 14, n)
        for k in range(n):
            y, x, l = ys[k], xs[k], L[k]
            img[y, x:x + l] -= rng.uniform(2, 7)
    # gentle vignette
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = ((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2
    img -= (d * 9)[..., None]
    img = np.clip(img, 0, 255)
    a = np.full((h, w, 1), 255, np.float32)
    return _to_image(np.concatenate([img, a], axis=2))

@functools.lru_cache(maxsize=16)
def grain_frames(w=W, h=H, n=8, strength=10, seed=7):
    """Animated film grain overlays (RGBA, mid-grey centred, use with overlay blend)."""
    rng = np.random.default_rng(seed)
    out = []
    for i in range(n):
        g = rng.normal(0, strength, (h // 2, w // 2)).astype(np.float32)
        g = np.clip(128 + g, 0, 255).astype(np.uint8)
        arr = np.dstack([g, g, g, np.full_like(g, 255)])
        img = skia.Image.fromarray(arr, colorType=skia.kRGBA_8888_ColorType)
        out.append(img.resize(w, h, skia.SamplingOptions(skia.FilterMode.kLinear)))
    return out

def draw_grain(c, t, amount=0.10, w=W, h=H):
    frames = grain_frames(w, h)
    img = frames[int(t * FPS) % len(frames)]
    p = skia.Paint(BlendMode=skia.BlendMode.kOverlay)
    p.setAlphaf(amount)
    c.drawImage(img, 0, 0, skia.SamplingOptions(), p)

def vignette(c, w, h, strength=0.5, rgb=(0, 0, 0)):
    shader = skia.GradientShader.MakeRadial(
        (w / 2, h / 2), math.hypot(w, h) * 0.55,
        [col(rgb, 0), col(rgb, 0), col(rgb, strength)], [0.0, 0.55, 1.0])
    p = skia.Paint(Shader=shader)
    c.drawRect(skia.Rect(0, 0, w, h), p)

def glow(c, x, y, r, rgb, a=0.5):
    """Soft radial light (additive-ish)."""
    shader = skia.GradientShader.MakeRadial((x, y), r, [col(rgb, a), col(rgb, a * 0.35), col(rgb, 0)], [0, 0.4, 1])
    p = skia.Paint(Shader=shader, BlendMode=skia.BlendMode.kScreen)
    c.drawCircle(x, y, r, p)

def blur_paint(sigma):
    p = skia.Paint()
    p.setImageFilter(skia.ImageFilters.Blur(sigma, sigma))
    return p

def rect(c, x, y, w, h, rgb, a=1.0, stroke=None, r=0):
    p = paint(rgb, a, stroke)
    if r:
        c.drawRoundRect(skia.Rect.MakeXYWH(x, y, w, h), r, r, p)
    else:
        c.drawRect(skia.Rect.MakeXYWH(x, y, w, h), p)

def line(c, x0, y0, x1, y1, rgb, a=1.0, w=1.0):
    c.drawLine(x0, y0, x1, y1, paint(rgb, a, w))

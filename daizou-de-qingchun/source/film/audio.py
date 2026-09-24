"""Audio clips, effects and the timeline mixer. All audio: float32, SR=48k, stereo (N,2)."""
import functools
import numpy as np
from scipy import signal
from .config import SR

def to_stereo(x, pan=0.0):
    x = np.asarray(x, np.float32)
    if x.ndim == 2:
        return x
    l = np.cos((pan + 1) * np.pi / 4); r = np.sin((pan + 1) * np.pi / 4)
    return np.stack([x * l * 1.4142, x * r * 1.4142], 1).astype(np.float32)

def db(x):
    return 10 ** (x / 20.0)

def resample(x, sr_in, sr_out=SR):
    if sr_in == sr_out:
        return np.asarray(x, np.float32)
    from math import gcd
    g = gcd(sr_in, sr_out)
    return signal.resample_poly(np.asarray(x, np.float64), sr_out // g, sr_in // g, axis=0).astype(np.float32)

def env_fade(x, fin=0.0, fout=0.0):
    x = np.array(x, np.float32, copy=True)
    n = len(x)
    if fin > 0:
        k = min(n, int(fin * SR)); r = np.linspace(0, 1, k) ** 2
        x[:k] = (x[:k].T * r).T
    if fout > 0:
        k = min(n, int(fout * SR)); r = np.linspace(1, 0, k) ** 2
        x[n - k:] = (x[n - k:].T * r).T
    return x

def fit(x, dur, xf=0.06):
    """Loop or cut clip x to exactly dur seconds, crossfading loop seams."""
    x = np.asarray(x, np.float32)
    n = int(dur * SR)
    if len(x) >= n:
        return x[:n].copy()
    k = min(int(xf * SR), len(x) // 4)
    out = np.zeros((n,) + x.shape[1:], np.float32)
    rin = np.linspace(0, 1, k, dtype=np.float32); rout = rin[::-1]
    pos, first = 0, True
    while pos < n:
        seg = x.copy()
        if not first:
            seg[:k] = (seg[:k].T * rin).T
        seg[-k:] = (seg[-k:].T * rout).T
        e = min(n, pos + len(seg))
        out[pos:e] += seg[:e - pos]
        pos += len(seg) - k
        first = False
    return out

# ---------------- filters / fx ----------------
def _sos(kind, f, order=2):
    return signal.butter(order, f, btype=kind, fs=SR, output='sos')

def lowpass(x, f, order=2):
    return signal.sosfilt(_sos('lowpass', f, order), x, axis=0).astype(np.float32)

def highpass(x, f, order=2):
    return signal.sosfilt(_sos('highpass', f, order), x, axis=0).astype(np.float32)

def bandpass(x, f0, f1, order=2):
    return signal.sosfilt(_sos('bandpass', [f0, f1], order), x, axis=0).astype(np.float32)

def peak_eq(x, f0, gain_db, q=1.0):
    A = 10 ** (gain_db / 40); w0 = 2 * np.pi * f0 / SR; al = np.sin(w0) / (2 * q)
    b = [1 + al * A, -2 * np.cos(w0), 1 - al * A]; a = [1 + al / A, -2 * np.cos(w0), 1 - al / A]
    return signal.lfilter(np.array(b) / a[0], np.array(a) / a[0], x, axis=0).astype(np.float32)

@functools.lru_cache(maxsize=32)
def impulse(decay=1.2, size='room', seed=3, predelay=0.012, bright=6000):
    """Synthetic stereo reverb impulse response."""
    rng = np.random.default_rng(seed)
    n = int(SR * decay * 1.2)
    t = np.arange(n) / SR
    ir = rng.normal(0, 1, (n, 2)).astype(np.float32) * np.exp(-6.9 * t / decay)[:, None]
    ir = lowpass(ir, bright)
    # early reflections
    refl = {'room': [0.007, 0.013, 0.021, 0.029], 'hall': [0.019, 0.031, 0.047, 0.061],
            'stair': [0.011, 0.023, 0.037, 0.052, 0.071]}[size]
    for i, d in enumerate(refl):
        k = int(d * SR)
        ir[k, i % 2] += 0.6 / (i + 1)
    pd = int(predelay * SR)
    ir = np.vstack([np.zeros((pd, 2), np.float32), ir])
    return ir / np.sqrt(np.sum(ir ** 2))

def reverb(x, wet=0.25, decay=1.0, size='room', bright=6000):
    x = to_stereo(x)
    ir = impulse(round(decay, 2), size, 3, 0.012, bright)
    y = np.stack([signal.fftconvolve(x[:, i], ir[:, i])[:len(x) + len(ir) - 1] for i in range(2)], 1).astype(np.float32)
    dry = np.vstack([x, np.zeros((len(y) - len(x), 2), np.float32)])
    return (dry * (1 - wet * 0.5) + y * wet * 0.9).astype(np.float32)

def phone(x):
    """Telephone line: band-limited, a bit of grit."""
    x = bandpass(np.asarray(x, np.float32), 320, 3300, 3)
    x = np.tanh(x * 2.2) / 2.2
    return peak_eq(x, 1500, 4, 0.8)

def radio_far(x):
    return lowpass(highpass(x, 180), 2400)

def saturate(x, drive=1.5):
    return (np.tanh(np.asarray(x) * drive) / np.tanh(drive)).astype(np.float32)

def normalize(x, peak=0.9):
    m = np.max(np.abs(x)) + 1e-9
    return (x * (peak / m)).astype(np.float32)

def rms(x):
    return float(np.sqrt(np.mean(np.square(x)) + 1e-12))

# ---------------- mixer ----------------
class Mixer:
    def __init__(self):
        self.clips = []   # (start_sec, stereo ndarray, bus)

    def add(self, x, at, gain_db=0.0, pan=0.0, fin=0.0, fout=0.0, bus='fx'):
        if x is None or len(x) == 0:
            return
        y = to_stereo(np.asarray(x, np.float32), pan) * db(gain_db)
        if fin or fout:
            y = env_fade(y, fin, fout)
        self.clips.append((float(at), y.astype(np.float32), bus))

    def render(self, dur, duck=True):
        n = int(np.ceil(dur * SR)) + SR
        buses = {}
        for at, y, bus in self.clips:
            s = int(round(at * SR))
            if s >= n:
                continue
            if s < 0:
                y = y[-s:]; s = 0
            e = min(n, s + len(y))
            b = buses.setdefault(bus, np.zeros((n, 2), np.float32))
            b[s:e] += y[:e - s]
        out = np.zeros((n, 2), np.float32)
        voice = buses.get('voice')
        if duck and voice is not None:
            # gentle ducking of ambience/music under dialogue
            envv = np.abs(voice).max(1)
            k = int(0.25 * SR)
            envv = signal.fftconvolve(envv, np.ones(k) / k, mode='same')
            g = 1.0 - 0.45 * np.clip(envv / 0.05, 0, 1)
            for name in ('amb', 'music'):
                if name in buses:
                    buses[name] *= g[:, None]
        for b in buses.values():
            out += b
        return limit(out)[:int(np.ceil(dur * SR))]

def limit(x, ceiling=0.93, release=0.08):
    """Look-ahead-free peak limiter with smoothed gain, then a gentle soft clip."""
    a = np.abs(x).max(1)
    g = np.minimum(1.0, ceiling / np.maximum(a, 1e-9))
    k = int(release * SR)
    # min-filter so gain drops before the peak and recovers smoothly
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    g = minimum_filter1d(g, size=k)
    g = uniform_filter1d(g, size=k)
    y = x * g[:, None]
    return np.clip(y, -0.99, 0.99).astype(np.float32)

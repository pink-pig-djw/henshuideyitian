"""Procedural sound library (deterministic). Every function returns float32 at SR (mono unless noted)."""
import functools
import numpy as np
from scipy import signal
from .config import SR
from .audio import lowpass, highpass, bandpass, reverb, env_fade, to_stereo, normalize, peak_eq, fit, phone as phone_fx

def _t(d):
    return np.arange(int(d * SR)) / SR

def _rng(seed):
    return np.random.default_rng(seed)

def noise(d, seed=0, color='white'):
    x = _rng(seed).normal(0, 1, int(d * SR)).astype(np.float32)
    if color == 'pink':
        b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
        a = [1, -2.494956002, 2.017265875, -0.522189400]
        x = signal.lfilter(b, a, x).astype(np.float32) * 4
    elif color == 'brown':
        x = np.cumsum(x); x = highpass(x - x.mean(), 20) * 0.02
    return x

def hz(note):
    """'A4' -> 440; supports sharps like 'C#5'."""
    names = {'C': -9, 'D': -7, 'E': -5, 'F': -4, 'G': -2, 'A': 0, 'B': 2}
    n = names[note[0]]; rest = note[1:]
    if rest.startswith('#'):
        n += 1; rest = rest[1:]
    elif rest.startswith('b'):
        n -= 1; rest = rest[1:]
    return 440.0 * 2 ** ((n + 12 * (int(rest) - 4)) / 12)

# ---------------- tonal instruments ----------------
def marimba(f, d=0.6, a=1.0):
    t = _t(d)
    x = (np.sin(2 * np.pi * f * t) * np.exp(-t * 7) + 0.35 * np.sin(2 * np.pi * f * 3.99 * t) * np.exp(-t * 22)
         + 0.12 * np.sin(2 * np.pi * f * 9.2 * t) * np.exp(-t * 45))
    atk = np.minimum(1, t / 0.002)
    return (x * atk * a).astype(np.float32)

def musicbox(f, d=1.2, a=1.0):
    t = _t(d)
    x = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 3) + 0.15 * np.sin(2 * np.pi * 5.03 * f * t) * np.exp(-t * 9))
    return (x * np.exp(-t * 3.2) * np.minimum(1, t / 0.001) * a).astype(np.float32)

def piano(f, d=3.0, a=1.0, bright=1.0):
    """Soft additive piano-ish tone with slight inharmonicity and two detuned strings."""
    t = _t(d)
    x = np.zeros_like(t)
    B = 0.0004
    for k in range(1, 9):
        fk = f * k * np.sqrt(1 + B * k * k)
        amp = (1 / k ** 1.4) * (bright if k > 2 else 1)
        dec = 1.2 + 0.9 * k
        for det in (-0.6, 0.6):
            x += amp * np.sin(2 * np.pi * (fk + det * k * 0.15) * t + k) * np.exp(-t * dec / 2.2)
    x *= np.minimum(1, t / 0.004)
    # hammer thump
    x[:int(0.02 * SR)] += noise(0.02, int(f)) * np.linspace(0.08, 0, int(0.02 * SR))
    return lowpass(x * a * 0.25, 5000 * bright + 800)

def sequence(notes, bpm=120, inst=marimba, step=0.5, gain=1.0, tail=1.5):
    """notes: list of (note_or_None, beats). Returns mono."""
    beat = 60.0 / bpm
    total = sum(b for _, b in notes) * beat + tail
    out = np.zeros(int(total * SR) + 1, np.float32)
    pos = 0.0
    for n, b in notes:
        if n:
            for nn in (n if isinstance(n, (list, tuple)) else [n]):
                x = inst(hz(nn))
                s = int(pos * SR); e = min(len(out), s + len(x))
                out[s:e] += x[:e - s] * gain
        pos += b * beat
    return out

ALARM_NOTES = [('E5', .5), ('G5', .5), ('C6', .5), ('G5', .5), ('A5', .5), ('G5', .5), ('E5', .5), ('C5', .5),
               ('D5', .5), ('E5', .5), ('G5', .5), ('E5', .5), ('C5', 1.5), (None, .5)]

@functools.lru_cache(maxsize=4)
def alarm(loops=2):
    """The cheerful phone alarm melody (identical every loop). Mono, ~3.5s per loop."""
    one = sequence(ALARM_NOTES, bpm=150, inst=marimba, tail=0.0)
    one = one[:int(len(ALARM_NOTES) and (sum(b for _, b in ALARM_NOTES) * 60 / 150) * SR)]
    x = np.concatenate([one] * loops + [np.zeros(int(0.8 * SR), np.float32)])
    x = highpass(x, 350)  # small phone speaker
    x = peak_eq(x, 2500, 3)
    return normalize(x, 0.6)

def alarm_elegy():
    """Same melody, slow, low, on piano — used once, at the very end."""
    notes = [(n.replace('6', '5').replace('5', '4') if n else None, b * 2) for n, b in ALARM_NOTES]
    return normalize(sequence(notes, bpm=52, inst=lambda f: piano(f, 4.0), tail=4.0), 0.5)

# ---------------- ambiences ----------------
def room_tone(d, seed=1, hum=True, level=1.0):
    x = lowpass(noise(d, seed, 'pink'), 900) * 0.02
    if hum:
        t = _t(d)
        x += (0.004 * np.sin(2 * np.pi * 50 * t) + 0.002 * np.sin(2 * np.pi * 100 * t)).astype(np.float32)
    return x * level

def wind(d, seed=2, strength=1.0):
    n = noise(d, seed, 'pink')
    t = _t(d)
    rng = _rng(seed)
    lfo = 0.55 + 0.45 * np.sin(2 * np.pi * 0.11 * t + rng.uniform(0, 6)) * np.sin(2 * np.pi * 0.037 * t + 1)
    gust = np.clip(signal.sosfilt(signal.butter(1, 0.4, fs=SR, output='sos'), rng.normal(0, 1, len(t))) * 30, -1, 1)
    L = bandpass(n, 150, 1400) * (lfo + 0.25 * gust)
    R = bandpass(noise(d, seed + 1, 'pink'), 150, 1400) * (lfo + 0.25 * gust)
    whistle = bandpass(noise(d, seed + 2), 900, 1100, 2) * 0.4 * lfo ** 3
    return (np.stack([L + whistle, R + whistle * 0.7], 1) * 0.08 * strength).astype(np.float32)

def campus(d, seed=3):
    """Daytime campus: distant murmur, far traffic, occasional birds. Stereo."""
    rng = _rng(seed)
    t = _t(d)
    mur = bandpass(noise(d, seed, 'pink'), 250, 1800) * (0.6 + 0.4 * np.abs(np.sin(2 * np.pi * 0.23 * t)))
    traffic = lowpass(noise(d, seed + 5, 'brown'), 300) * 2
    out = np.stack([mur * 0.018 + traffic * 0.01, np.roll(mur, 900) * 0.018 + traffic * 0.01], 1)
    for k in range(int(d / 3)):
        s = rng.uniform(0, d - 1); f0 = rng.uniform(2800, 4200)
        for j in range(rng.integers(2, 5)):
            dd = rng.uniform(0.05, 0.12); tt = _t(dd)
            ch = np.sin(2 * np.pi * (f0 + rng.uniform(-400, 600) * tt / dd) * tt) * np.sin(np.pi * tt / dd) ** 2
            i0 = int((s + j * 0.14) * SR)
            if i0 + len(ch) < len(out):
                pan = rng.uniform(-0.8, 0.8)
                out[i0:i0 + len(ch)] += to_stereo(ch.astype(np.float32) * 0.012, pan)
    return out.astype(np.float32)

def cafe(d, seed=4):
    """Milk-tea shop: soft chatter bed, cups, a fridge hum. Stereo."""
    rng = _rng(seed)
    base = campus(d, seed)[:, :] * 0.6
    t = _t(d)
    hum = (0.003 * np.sin(2 * np.pi * 120 * t)).astype(np.float32)
    base += to_stereo(hum)
    for k in range(int(d / 2.5)):
        s = int(rng.uniform(0, d - 0.3) * SR)
        f = rng.uniform(2500, 5200); dd = 0.25; tt = _t(dd)
        clink = np.sin(2 * np.pi * f * tt) * np.exp(-tt * 30) * 0.008
        base[s:s + len(clink)] += to_stereo(clink.astype(np.float32), rng.uniform(-0.7, 0.7))
    return base

def machinery(d, seed=5):
    """Construction site heard through a phone: rumble, clanks, a grinder."""
    rng = _rng(seed)
    t = _t(d)
    rumble = lowpass(noise(d, seed, 'brown'), 200) * 3 * (0.8 + 0.2 * np.sin(2 * np.pi * 7 * t))
    grind = bandpass(noise(d, seed + 1), 1800, 3200) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.3 * t)) * 0.3
    x = rumble + grind
    for k in range(int(d * 1.5)):
        s = int(rng.uniform(0, d - 0.2) * SR); tt = _t(0.2)
        clank = np.sin(2 * np.pi * rng.uniform(600, 1400) * tt) * np.exp(-tt * 25) * 0.6
        x[s:s + len(clank)] += clank
    return normalize(x, 0.5)

def drone(d, root=55.0, seed=6, dark=True):
    """Low sustained pad for tension. Stereo."""
    t = _t(d)
    rng = _rng(seed)
    x = np.zeros((len(t), 2), np.float32)
    for k, (m, a) in enumerate([(1, 1.0), (1.5, 0.35), (2, 0.4), (3, 0.12), (4.02, 0.06)]):
        for ch in range(2):
            det = rng.uniform(-0.25, 0.25)
            x[:, ch] += a * np.sin(2 * np.pi * (root * m + det) * t + rng.uniform(0, 6))
    x *= (0.75 + 0.25 * np.sin(2 * np.pi * 0.05 * t))[:, None]
    x += np.stack([lowpass(noise(d, seed), 400), lowpass(noise(d, seed + 1), 400)], 1) * 0.08
    if dark:
        x = lowpass(x, 700)
    return env_fade(normalize(x, 0.25), 2.0, 2.0)

# ---------------- events ----------------
def siren(d=9.0, seed=7, approach=True):
    """Chinese-style police siren: fast rising/falling wail, approaching then stopping. Stereo."""
    t = _t(d)
    ph = (t * 1.6) % 1.0
    f = 650 + 900 * np.where(ph < 0.5, ph * 2, 2 - ph * 2)
    phase = 2 * np.pi * np.cumsum(f) / SR
    x = np.sign(np.sin(phase)) * 0.3 + np.sin(phase) * 0.7
    x = lowpass(x, 3000)
    if approach:
        g = np.clip(t / (d * 0.75), 0, 1) ** 2
        x = x * (0.05 + 0.95 * g)
        cutoff_env = 1
    stop = int((d - 1.2) * SR)
    x[stop:] *= np.linspace(1, 0, len(x) - stop) ** 3
    x = lowpass(x, 1800)
    y = reverb(x * 0.25, wet=0.5, decay=1.8, size='hall', bright=3000)
    return y[:len(t)]

def phone_ring(d=4.0):
    notes = [('E6', .25), ('B5', .25), ('E6', .25), ('B5', .25), (None, 1.0)]
    x = sequence(notes, bpm=120, inst=lambda f: marimba(f, 0.4), tail=0.2)
    return fit(highpass(x, 400), d)

def vibrate(d=2.4, seed=8):
    """Phone buzzing on a desk: pulses of 180 Hz buzz with rattle."""
    t = _t(d)
    gate = ((t % 1.2) < 0.55).astype(np.float32)
    buzz = np.sign(np.sin(2 * np.pi * 180 * t)) * 0.4 + np.sin(2 * np.pi * 360 * t) * 0.3
    x = lowpass(buzz * gate, 1500) + bandpass(noise(d, seed), 2000, 5000) * gate * 0.15
    return (x * 0.5).astype(np.float32)

def busy_tone(n=3):
    """Hang-up / busy tone, 450 Hz 0.35 on 0.35 off."""
    on = np.sin(2 * np.pi * 450 * _t(0.35)).astype(np.float32) * 0.3
    off = np.zeros(int(0.35 * SR), np.float32)
    return phone_fx(np.concatenate([np.concatenate([on, off]) for _ in range(n)]))

def click(seed=9, f=3000, dur=0.03, a=0.5):
    x = bandpass(noise(dur, seed), f * 0.6, min(f * 1.6, 20000)) * np.exp(-_t(dur) * 180)
    return (x * a).astype(np.float32)

def keyboard(d, rate=7.0, seed=10):
    rng = _rng(seed)
    out = np.zeros(int(d * SR), np.float32)
    tpos = 0.0
    while tpos < d - 0.05:
        c = click(int(rng.integers(0, 1e6)), rng.uniform(2500, 4500), 0.03, rng.uniform(0.15, 0.35))
        s = int(tpos * SR); out[s:s + len(c)] += c
        tpos += rng.exponential(1 / rate)
    return out

def gunfire(d, seed=11, density=1.0):
    """Muffled video-game gunfire and explosions from headphones/speakers."""
    rng = _rng(seed)
    out = np.zeros(int(d * SR), np.float32)
    tpos = rng.uniform(0, 0.4)
    while tpos < d - 0.4:
        burst = rng.integers(1, 7)
        for b in range(burst):
            dd = 0.18; tt = _t(dd)
            shot = noise(dd, int(rng.integers(0, 1e6))) * np.exp(-tt * 38) + np.sin(2 * np.pi * 70 * tt) * np.exp(-tt * 25) * 1.4
            s = int((tpos + b * 0.09) * SR)
            if s + len(shot) < len(out):
                out[s:s + len(shot)] += lowpass(shot, 3500) * rng.uniform(0.3, 0.6)
        if rng.random() < 0.15:
            dd = 1.2; tt = _t(dd)
            boom = lowpass(noise(dd, int(rng.integers(0, 1e6)), 'brown'), 250) * np.exp(-tt * 3.5) * 8
            s = int(tpos * SR)
            if s + len(boom) < len(out):
                out[s:s + len(boom)] += boom
        tpos += rng.exponential(1.1 / density) + 0.25
    return np.tanh(out * 1.3) * 0.6

def chatter(d, seed=12):
    """Muffled speech-like babble (a video playing on a phone speaker)."""
    rng = _rng(seed)
    t = _t(d)
    src = np.sign(np.sin(2 * np.pi * (140 + 30 * np.sin(2 * np.pi * 0.7 * t)) * t)) * 0.3 + noise(d, seed) * 0.2
    syl = (0.5 + 0.5 * np.sin(2 * np.pi * 4.3 * t + 2 * np.sin(2 * np.pi * 0.9 * t))) ** 2
    pause = (signal.sosfilt(signal.butter(1, 0.5, fs=SR, output='sos'), rng.normal(0, 1, len(t))) * 40 > -0.3).astype(np.float32)
    f1 = bandpass(src, 500, 900); f2 = bandpass(src, 1200, 2400)
    x = (f1 + 0.6 * f2) * syl * pause
    return highpass(lowpass(x, 3000), 300) * 0.5

def pencil(d, seed=13, rate=1.6):
    """Pencil strokes on paper."""
    rng = _rng(seed)
    out = np.zeros(int(d * SR), np.float32)
    tpos = 0.0
    while tpos < d - 0.1:
        dd = rng.uniform(0.15, 0.6); tt = _t(dd)
        e = np.sin(np.pi * tt / dd) ** 0.7
        s_ = bandpass(noise(dd, int(rng.integers(0, 1e6))), 2500, 9000) * e * 0.06
        s_ *= 0.7 + 0.3 * np.sin(2 * np.pi * rng.uniform(8, 20) * tt)
        s = int(tpos * SR); out[s:s + len(s_)] += s_[:len(out) - s]
        tpos += dd + rng.exponential(1 / rate) * 0.5
    return out

def paper_tear(seed=14, d=0.7):
    rng = _rng(seed)
    tt = _t(d)
    crack = (rng.random(len(tt)) < 0.02).astype(np.float32) * rng.normal(0, 1, len(tt))
    x = bandpass(noise(d, seed), 1500, 8000) * 0.25 + highpass(crack, 1000) * 1.2
    return (x * np.sin(np.pi * tt / d) ** 0.5 * 0.5).astype(np.float32)

def paper_rustle(seed=15, d=0.8):
    tt = _t(d)
    x = bandpass(noise(d, seed), 2000, 10000) * (0.5 + 0.5 * np.sin(2 * np.pi * 9 * tt)) * np.sin(np.pi * tt / d)
    return (x * 0.12).astype(np.float32)

def door(kind='open', seed=16):
    """Dorm door: latch click + creak (open) or thud (close)."""
    rng = _rng(seed)
    latch = click(seed, 2200, 0.05, 0.6)
    if kind == 'open':
        d = 0.9; tt = _t(d)
        f = 300 + 250 * np.sin(np.pi * tt / d)
        creak = np.sin(2 * np.pi * np.cumsum(f) / SR) * (rng.random(len(tt)) < 0.3) * 0.2
        body = lowpass(creak, 2500) * np.sin(np.pi * tt / d)
        return np.concatenate([latch, body.astype(np.float32)])
    d = 0.5; tt = _t(d)
    thud = lowpass(noise(d, seed, 'brown'), 180) * np.exp(-tt * 12) * 10 + np.sin(2 * np.pi * 85 * tt) * np.exp(-tt * 14) * 0.6
    x = np.concatenate([np.zeros(int(0.02 * SR), np.float32), thud.astype(np.float32)])
    x[:len(latch)] += latch
    return x

def footstep(seed=17, a=1.0):
    d = 0.25; tt = _t(d)
    x = lowpass(noise(d, seed), 900) * np.exp(-tt * 35) + np.sin(2 * np.pi * 95 * tt) * np.exp(-tt * 30) * 0.5
    x[:int(0.01 * SR)] += bandpass(noise(0.01, seed + 1), 2000, 6000) * 0.3
    return (x * a * 0.6).astype(np.float32)

def footsteps(n, interval=0.62, seed=18, jitter=0.05, a=1.0):
    rng = _rng(seed)
    out = np.zeros(int((n * interval + 0.5) * SR), np.float32)
    for i in range(n):
        s = int((i * interval + rng.normal(0, jitter)) * SR)
        f = footstep(int(rng.integers(0, 1e6)), a * rng.uniform(0.8, 1.1))
        s = max(0, s); out[s:s + len(f)] += f[:len(out) - s]
    return out

def heartbeat(d, bpm=62, seed=19):
    out = np.zeros(int(d * SR), np.float32)
    per = 60 / bpm
    for k in range(int(d / per)):
        for off, a in ((0, 1.0), (0.28, 0.6)):
            tt = _t(0.15)
            b = np.sin(2 * np.pi * 48 * tt) * np.exp(-tt * 28) * a
            s = int((k * per + off) * SR)
            if s + len(b) < len(out):
                out[s:s + len(b)] += b
    return out * 0.7

def hum(d, f=60, seed=20, a=0.02):
    """Electrical hum: vending machine / fluorescent / printer."""
    t = _t(d)
    x = (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * 2 * f * t) + 0.25 * np.sin(2 * np.pi * 3 * f * t))
    x += bandpass(noise(d, seed), 3000, 6000) * 0.05
    return (x * a).astype(np.float32)

def printer(d, seed=21):
    t = _t(d)
    x = hum(d, 110, seed, 0.02) + bandpass(noise(d, seed), 400, 1600) * 0.03 * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 1.3 * t)))
    return x.astype(np.float32)

def scream_far(seed=22):
    """A distant human cry, suggested rather than shown: formant 'a' vowel, very far, heavily diffused."""
    d = 1.8; t = _t(d)
    f0 = 520 + 180 * np.sin(np.pi * t / d * 0.9) - 120 * (t / d) ** 2
    ph = 2 * np.pi * np.cumsum(f0 * (1 + 0.01 * np.sin(2 * np.pi * 6 * t))) / SR
    src = sum(np.sin(k * ph) / k for k in range(1, 14))
    x = bandpass(src, 700, 1300) + 0.6 * bandpass(src, 1500, 2600) + 0.2 * noise(d, seed)
    x *= np.sin(np.pi * np.clip(t / d, 0, 1)) ** 1.5
    x = lowpass(x, 2200)
    y = reverb(x * 0.2, wet=0.85, decay=2.6, size='hall', bright=2000)
    return y

def thump_low(seed=23):
    d = 1.4; tt = _t(d)
    return (np.sin(2 * np.pi * 42 * tt) * np.exp(-tt * 4) * 0.7).astype(np.float32)

def swell(d=3.0, seed=24):
    """Reverse-cymbal-like airy swell into a cut."""
    tt = _t(d)
    x = bandpass(noise(d, seed), 3000, 12000) * (tt / d) ** 3 * 0.25
    return x.astype(np.float32)

def victory(seed=25):
    """Game 'Victory' sting: bright arpeggio + fanfare chord."""
    notes = [('C5', .25), ('E5', .25), ('G5', .25), (['C6', 'E6', 'G6'], 2.0)]
    def brass(f):
        tt = _t(1.6)
        x = sum(np.sign(np.sin(2 * np.pi * f * k * tt)) / (k * 1.5) for k in (1, 2))
        return lowpass(x * np.minimum(1, tt / 0.02) * np.exp(-tt * 1.2), 4000) * 0.2
    return normalize(sequence(notes, bpm=140, inst=brass, tail=1.2), 0.5)

def pen_on_paper(d, seed=26):
    """Police notes: ballpoint writing."""
    return pencil(d, seed, rate=2.5) * 0.8

def rain(d, seed=27):
    x = np.stack([bandpass(noise(d, seed), 800, 7000), bandpass(noise(d, seed + 1), 800, 7000)], 1) * 0.03
    return x.astype(np.float32)

def water_pour(d=2.5, seed=28):
    """Filling a cup from a dispenser: gurgle with rising resonance."""
    t = _t(d)
    n = noise(d, seed)
    f = 500 + 900 * (t / d)
    out = np.zeros_like(n)
    for k in range(0, len(t), 2400):
        seg = n[k:k + 2400]
        fc = f[min(k, len(f) - 1)]
        out[k:k + 2400] = bandpass(seg, fc * 0.8, fc * 1.3)
    env = np.minimum(1, t / 0.2) * np.minimum(1, (d - t) / 0.3)
    return (out * env * 0.25).astype(np.float32)

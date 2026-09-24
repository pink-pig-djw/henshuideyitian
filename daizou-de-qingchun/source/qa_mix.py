"""Intelligibility check on the FINAL mix: ASR each voiced line cut from the mixed programme."""
import sys, json, numpy as np, soundfile as sf
import build
from film.render import Film
from film.config import SR
from film.audio import resample
from engines import transcribe, cer
from film.voice import tts_clean
keys = build.available()
film = Film([build.load(k) for k in keys])
bad = []
n = 0
levels = []
for i, (sc, off) in enumerate(zip(film.scenes, film.offsets)):
    y = film.scene_audio(i)
    mono = y.mean(1)
    levels.append((sc.key, 20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-9), np.abs(y).max()))
    for (st, en, who, txt, note) in sc.spoken:
        a, b = max(0, int((st - 0.05) * SR)), int((en + 0.1) * SR)
        seg = resample(mono[a:b], SR, 16000)
        hyp = transcribe(seg, 16000)
        e = cer(tts_clean(txt), hyp)
        n += 1
        # loudness of voice vs whole mix in that window
        if e > 0.3:
            bad.append(dict(scene=sc.key, t=round(st, 1), who=who, cer=round(e, 2), text=txt, heard=hyp))
print(f'{n} lines checked, {len(bad)} with CER>0.3 in the mix')
for b in bad:
    print(json.dumps(b, ensure_ascii=False))
for k, r, pk in levels:
    print(f'{k:14s} rms {r:6.1f} dBFS  peak {pk:.2f}')

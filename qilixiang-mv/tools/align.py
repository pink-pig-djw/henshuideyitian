"""Build per-character lyric timing and beat analysis for the MV.

Pipeline: vocal separation (UVR MDX-Net) -> voice activity detection (Silero)
-> ASR with token timestamps (SenseVoice) -> global pinyin-aware alignment of
input/lyrics.txt against the recognised characters.

Outputs input/timing.json and input/analysis.json. Optional manual fixes can be
given in input/timing_overrides.json as {"line index": [time per hanzi, ...]}.
Models are fetched from the sherpa-onnx GitHub releases into build/models/.
"""
import json
import subprocess
import tarfile
import urllib.request
from pathlib import Path

import librosa
import numpy as np
import sherpa_onnx as so
import soundfile as sf
from pypinyin import Style, lazy_pinyin

ROOT = Path(__file__).resolve().parent.parent
INP, BUILD = ROOT / "input", ROOT / "build"
MODELS = BUILD / "models"
REL = "https://github.com/k2-fsa/sherpa-onnx/releases/download"
SENSEVOICE = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"


def fetch(url, dest):
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print("downloading", url)
    urllib.request.urlretrieve(url, dest)
    return dest


def models():
    fetch(f"{REL}/source-separation-models/UVR-MDX-NET-Voc_FT.onnx", MODELS / "uvr.onnx")
    fetch(f"{REL}/asr-models/silero_vad.onnx", MODELS / "silero_vad.onnx")
    if not (MODELS / SENSEVOICE).exists():
        tar = fetch(f"{REL}/asr-models/{SENSEVOICE}.tar.bz2", MODELS / f"{SENSEVOICE}.tar.bz2")
        with tarfile.open(tar) as t:
            t.extractall(MODELS)


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def analyze(song):
    ffmpeg("-i", str(song), "-ac", "1", "-ar", "22050", str(BUILD / "song22.wav"))
    y, sr = librosa.load(BUILD / "song22.wav", sr=22050)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    rms = librosa.feature.rms(y=y)[0]
    t = librosa.frames_to_time(np.arange(len(rms)), sr=sr)
    sec = [float(rms[(t >= s) & (t < s + 1)].mean()) for s in range(int(len(y) / sr))]
    mx = max(sec) or 1
    json.dump({"dur": len(y) / sr, "tempo": float(np.atleast_1d(tempo)[0]),
               "beats": [float(b) for b in beats], "rms_sec": [v / mx for v in sec]},
              open(INP / "analysis.json", "w"))


def vocals(song):
    ffmpeg("-i", str(song), "-ac", "2", "-ar", "44100", str(BUILD / "song44.wav"))
    cfg = so.OfflineSourceSeparationConfig(model=so.OfflineSourceSeparationModelConfig(
        uvr=so.OfflineSourceSeparationUvrModelConfig(model=str(MODELS / "uvr.onnx")), num_threads=4))
    x, sr = sf.read(BUILD / "song44.wav", dtype="float32", always_2d=True)
    out = so.OfflineSourceSeparation(cfg).process(sample_rate=sr, samples=np.ascontiguousarray(x.T))
    sf.write(BUILD / "vocals.wav", np.array(out.stems[0].data).T, out.sample_rate)
    ffmpeg("-i", str(BUILD / "vocals.wav"), "-ac", "1", "-ar", "16000", str(BUILD / "vocals16.wav"))


def recognise():
    x, sr = sf.read(BUILD / "vocals16.wav", dtype="float32")
    vc = so.VadModelConfig()
    vc.silero_vad.model = str(MODELS / "silero_vad.onnx")
    vc.silero_vad.threshold, vc.silero_vad.min_silence_duration = 0.4, 0.35
    vc.silero_vad.min_speech_duration, vc.silero_vad.max_speech_duration = 0.2, 12
    vc.sample_rate = sr
    vad = so.VoiceActivityDetector(vc, buffer_size_in_seconds=len(x) / sr + 10)
    segs = []
    for i in range(0, len(x), 512):
        vad.accept_waveform(x[i:i + 512])
        while not vad.empty():
            segs.append((vad.front.start / sr, np.array(vad.front.samples)))
            vad.pop()
    vad.flush()
    while not vad.empty():
        segs.append((vad.front.start / sr, np.array(vad.front.samples)))
        vad.pop()
    d = MODELS / SENSEVOICE
    rec = so.OfflineRecognizer.from_sense_voice(model=str(d / "model.int8.onnx"), tokens=str(d / "tokens.txt"),
                                                num_threads=4, use_itn=False, language="zh")
    chars = []
    for st, smp in segs:
        s = rec.create_stream()
        s.accept_waveform(sr, smp)
        rec.decode_stream(s)
        for tok, ts in zip(s.result.tokens, s.result.timestamps):
            chars += [(c, st + ts) for c in tok if "一" <= c <= "鿿"]
    return chars


def score(a, b):
    if a == b:
        return 3.0
    if lazy_pinyin(a)[0] == lazy_pinyin(b)[0]:
        return 2.2
    s = -1.0
    if lazy_pinyin(a, style=Style.FINALS)[0] == lazy_pinyin(b, style=Style.FINALS)[0]:
        s += 1.3
    if lazy_pinyin(a, style=Style.INITIALS)[0] == lazy_pinyin(b, style=Style.INITIALS)[0]:
        s += 0.7
    return s


def align(asr):
    lines = [l.rstrip("\n") for l in open(INP / "lyrics.txt", encoding="utf-8") if l.strip()]
    L = [(li, ci, c) for li, l in enumerate(lines) for ci, c in enumerate(l) if "一" <= c <= "鿿"]
    n, m, G = len(L), len(asr), -0.9
    D = np.zeros((n + 1, m + 1))
    P = np.zeros((n + 1, m + 1), dtype=np.int8)
    D[1:, 0], D[0, 1:], P[1:, 0], P[0, 1:] = np.arange(1, n + 1) * G, np.arange(1, m + 1) * G, 1, 2
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            best, p = D[i - 1, j - 1] + score(L[i - 1][2], asr[j - 1][0]), 0
            if D[i - 1, j] + G > best:
                best, p = D[i - 1, j] + G, 1
            if D[i, j - 1] + G > best:
                best, p = D[i, j - 1] + G, 2
            D[i, j], P[i, j] = best, p
    times, i, j = [None] * n, n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and P[i, j] == 0:
            if score(L[i - 1][2], asr[j - 1][0]) > 0:
                times[i - 1] = asr[j - 1][1]
            i, j = i - 1, j - 1
        elif i > 0 and (j == 0 or P[i, j] == 1):
            i -= 1
        else:
            j -= 1
    known = [k for k, t in enumerate(times) if t is not None]
    for k in range(n):
        if times[k] is None:
            a = max((q for q in known if q < k), default=None)
            b = min((q for q in known if q > k), default=None)
            if a is not None and b is not None:
                times[k] = times[a] + (times[b] - times[a]) * (k - a) / (b - a)
            else:
                times[k] = times[a] + 0.3 * (k - a) if a is not None else times[b] - 0.3 * (b - k)
    for k in range(1, n):
        times[k] = max(times[k], times[k - 1] + 0.02)
    ov_path = INP / "timing_overrides.json"
    overrides = json.load(open(ov_path)) if ov_path.exists() else {}
    out = []
    for li, text in enumerate(lines):
        ks = [k for k in range(n) if L[k][0] == li]
        ts = overrides.get(str(li)) or [times[k] for k in ks]
        by_ci = {L[k][1]: t for k, t in zip(ks, ts)}
        chars, nxt = [], None
        for ci in reversed(range(len(text))):
            nxt = by_ci.get(ci, nxt)
            chars.append({"c": text[ci], "t": round(nxt if nxt is not None else ts[-1], 3)})
        chars.reverse()
        out.append({"text": text, "chars": chars, "first": ts[0], "last": ts[-1]})
    json.dump({"lines": out}, open(INP / "timing.json", "w"), ensure_ascii=False, indent=1)
    print(f"aligned {len(out)} lines")


if __name__ == "__main__":
    BUILD.mkdir(exist_ok=True)
    song = INP / "song.mp3"
    models()
    analyze(song)
    vocals(song)
    align(recognise())

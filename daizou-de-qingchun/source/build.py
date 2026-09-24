"""Build / preview / render the film.

  ./run build.py preview s02            contact sheet + audio + timeline + ASR check for one scene
  ./run build.py preview s02 --t 3,10   also save full-size frames at scene-local times
  ./run build.py report                 timeline of the whole film
  ./run build.py render [--out path] [--from T --to T] [--scenes s01,s02]
"""
import sys, os, importlib, argparse, json, math, time
from film.config import *
from film import objects_polish
objects_polish.install()          # polished tree / shoes / bed board (drop-in replacements)

ORDER = ['s00_prologue', 's01_loop', 's02_d62', 's03_loop', 's04_d60', 's05_loop', 's06_d42', 's07_d35',
         's08_loop', 's09_d14', 's10_d03', 's11_d01', 's12_loop', 's13_end', 's14_final', 's15_epilogue']

def load(key):
    mod = importlib.import_module(f'scenes.{key}')
    sc = mod.build()
    if sc._dur is None:
        sc.finish()
    return sc

def keys_matching(ks):
    out = []
    for k in ks:
        m = [o for o in ORDER if o == k or o.startswith(k + '_') or o.split('_')[0] == k]
        if not m:
            raise SystemExit(f'unknown scene {k}')
        out += m
    return out

def available():
    return [k for k in ORDER if os.path.exists(f'{ROOT}/scenes/{k}.py')]

def asr_check(sc, limit=0.12):
    from film.voice import verify
    bad = []
    for who, text, path, start in sc.lines:
        e, hyp = verify(path, text)
        if e > limit:
            bad.append((round(e, 2), who, text, hyp, round(start, 1)))
    return bad

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd')
    ap.add_argument('keys', nargs='*')
    ap.add_argument('--t', default='')
    ap.add_argument('--n', type=int, default=16)
    ap.add_argument('--out', default='')
    ap.add_argument('--scenes', default='')
    ap.add_argument('--from_', dest='t0', type=float, default=0.0)
    ap.add_argument('--to', dest='t1', type=float, default=None)
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--noasr', action='store_true')
    a = ap.parse_args()
    from film.render import Film, contact_sheet, render_video
    os.makedirs(f'{ROOT}/out/preview', exist_ok=True)
    if a.cmd == 'preview':
        for key in keys_matching(a.keys):
            t = time.time()
            sc = load(key)
            film = Film([sc])
            d = sc.duration
            n = a.n
            times = [d * (i + 0.5) / n for i in range(n)]
            p = contact_sheet(film, f'{ROOT}/out/preview/{key}_sheet.png', times)
            print(f'{key}: duration {d:.1f}s  built in {time.time() - t:.1f}s')
            print('sheet:', p)
            for tt in [float(x) for x in a.t.split(',') if x.strip()]:
                fp = f'{ROOT}/out/preview/{key}_t{tt:06.2f}.png'
                film.frame(tt).makeImageSnapshot().save(fp)
                print('frame:', fp)
            import soundfile as sf
            y = film.audio(f'{ROOT}/out/preview/{key}.wav')
            import numpy as np
            print(f'audio: {ROOT}/out/preview/{key}.wav  peak {np.abs(y).max():.2f}')
            print(film.timeline_report())
            if not a.noasr:
                bad = asr_check(sc)
                print('ASR: all lines OK' if not bad else 'ASR mismatches (cer, who, text, heard, t):')
                for b in bad:
                    print('   ', b)
    elif a.cmd == 'report':
        film = Film([load(k) for k in available()])
        print(film.timeline_report())
        print(f'TOTAL {film.duration / 60:.1f} min')
    elif a.cmd == 'render':
        ks = keys_matching(a.scenes.split(',')) if a.scenes else available()
        film = Film([load(k) for k in ks])
        out = a.out or f'{ROOT}/out/film.mp4'
        print(f'rendering {len(ks)} scenes, {film.duration:.1f}s -> {out}')
        render_video(film, out, workers=a.workers, t0=a.t0, t1=a.t1)
        print('done', out)
    elif a.cmd == 'asr':
        for key in keys_matching(a.keys) if a.keys else available():
            sc = load(key)
            bad = asr_check(sc)
            print(key, 'OK' if not bad else bad)

if __name__ == '__main__':
    main()

"""Frame composition, preview sheets and full-film rendering."""
import os, subprocess, math, time, json
import numpy as np
import skia
import imageio_ffmpeg
from .config import *
from .gfx import draw_grain, fade, col, paint
from .subs import draw_subs
from .timeline import Ctx
from .audio import Mixer, SR as _SR
import soundfile as sf

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

def draw_scene(c, sc, t):
    c.save()
    c.clear(col((0, 0, 0)))
    if sc.frame == '4:3':
        c.clipRect(skia.Rect.MakeXYWH(BX, 0, BW, H))
        c.translate(BX, 0)
        w, h = BW, H
    else:
        w, h = W, H
    L = Ctx()
    L.T, L.scene, L.w, L.h = t, sc, w, h
    for ly in sorted(sc.layers, key=lambda l: l.z):
        end = ly.end if ly.end is not None else sc.duration
        if ly.start <= t < end or (t >= end and end >= sc.duration - 1e-6 and ly.start <= t):
            lt = t - ly.start
            L.dur = end - ly.start
            L.start = ly.start
            L.alpha = fade(lt, L.dur, ly.fin, ly.fout)
            if L.alpha <= 0:
                continue
            if L.alpha < 0.999:
                p = skia.Paint(); p.setAlphaf(L.alpha)
                c.saveLayer(None, p)
                ly.fn(c, lt, L)
                c.restore()
            else:
                ly.fn(c, lt, L)
    draw_subs(c, sc, t, w, h)
    if sc.grain:
        draw_grain(c, t, sc.grain, W, H) if sc.frame != '4:3' else draw_grain(c, t, sc.grain, W, H)
    c.restore()

class Film:
    def __init__(self, scenes):
        self.scenes = scenes
        self.offsets = []
        t = 0.0
        for sc in scenes:
            self.offsets.append(t)
            t += sc.duration
        self.duration = t

    def locate(self, T):
        for sc, off in zip(self.scenes, self.offsets):
            if T < off + sc.duration:
                return sc, T - off
        return self.scenes[-1], T - self.offsets[-1]

    def frame(self, T, surf=None, scale=1.0):
        if surf is None:
            surf = skia.Surface(int(W * scale), int(H * scale))
        c = surf.getCanvas()
        c.save()
        if scale != 1.0:
            c.scale(scale, scale)
        sc, t = self.locate(T)
        draw_scene(c, sc, t)
        c.restore()
        return surf

    def scene_audio(self, i):
        """Mix one scene on its own (as in previews): ducking and limiter per scene."""
        sc = self.scenes[i]
        m = Mixer()
        sc.mix_into(m, 0.0)
        y = m.render(sc.duration)
        n = int(round((self.offsets[i] + sc.duration) * SR)) - int(round(self.offsets[i] * SR))
        if len(y) < n:
            y = np.vstack([y, np.zeros((n - len(y), 2), np.float32)])
        return y[:n]

    def audio(self, path=None):
        """Stream the whole programme scene by scene (memory-safe). Returns path (or array if no path)."""
        if path is None:
            return np.vstack([self.scene_audio(i) for i in range(len(self.scenes))])
        with sf.SoundFile(path, 'w', SR, 2, subtype='PCM_16') as f:
            for i in range(len(self.scenes)):
                f.write(self.scene_audio(i))
        return path

    def srt(self, path=None):
        """Chinese subtitle track for every voiced line (speaker-labelled, since no faces are shown)."""
        from . import voice as V
        from .gfx import wrap
        items = []
        for sc, off in zip(self.scenes, self.offsets):
            for (st, en, who, txt, note) in getattr(sc, 'spoken', []):
                name = V.label(who)
                if who == 'zhang' and note in ('画外音', '日记', '未命名', ''):
                    pass
                lab = ''
                if name:
                    lab = name + (f'（{note}）' if note in ('电话', '画外音', '日记', '脑子里的声音') else '') + '：'
                body = txt.replace('\n', '')
                # split long lines into timed chunks (<= 2 subtitle lines each), proportional to length
                chunks, cur = [], ''
                import re as _re
                for piece in _re.findall(r'[^，。？！；：…—]*[，。？！；：…—]*', body):
                    if not piece:
                        continue
                    if len(cur) + len(piece) > 26 and cur:
                        chunks.append(cur); cur = piece
                    else:
                        cur += piece
                if cur:
                    chunks.append(cur)
                total = sum(len(c) for c in chunks) or 1
                t = off + st
                dur = en - st
                for k, ch in enumerate(chunks):
                    d_ = dur * len(ch) / total
                    lines = wrap((lab if k == 0 else '') + ch, 'sans', 40, 24 * 40)
                    end_ = t + d_ + (0.35 if k == len(chunks) - 1 else 0.0)
                    items.append((t, max(end_, t + 1.0), '\n'.join(lines)))
                    t += d_
        items.sort()
        def ts(x):
            h = int(x // 3600); m = int(x % 3600 // 60); s_ = x % 60
            return f'{h:02d}:{m:02d}:{int(s_):02d},{int(round((s_ - int(s_)) * 1000)):03d}'.replace(',1000', ',999')
        out = []
        for i, (a, b, t) in enumerate(items, 1):
            out.append(f'{i}\n{ts(a)} --> {ts(b)}\n{t}\n')
        txt = '\n'.join(out)
        if path:
            open(path, 'w', encoding='utf-8').write(txt)
        return txt

    def timeline_report(self):
        out = []
        for sc, off in zip(self.scenes, self.offsets):
            out.append(f'[{off:7.2f}] {sc.key} ({sc.kind}, {sc.duration:.1f}s)')
            for s in sc.subs:
                out.append(f'    {off + s.start:7.2f}-{off + s.end:7.2f} {s.style} {s.who or "-"}: {s.text}')
        return '\n'.join(out)

def contact_sheet(film, path, times, cols=4, scale=0.25, labels=True):
    tw, th = int(W * scale), int(H * scale)
    rows = math.ceil(len(times) / cols)
    sheet = skia.Surface(cols * tw + (cols + 1) * 8, rows * (th + 28) + 8)
    sc_ = sheet.getCanvas(); sc_.clear(col((40, 40, 40)))
    from .gfx import text
    for i, T in enumerate(times):
        s = film.frame(T, skia.Surface(tw, th), scale)
        x = 8 + (i % cols) * (tw + 8); y = 8 + (i // cols) * (th + 28)
        sc_.drawImage(s.makeImageSnapshot(), x, y)
        if labels:
            sce, t = film.locate(T)
            text(sc_, f'{T:.1f}s  {sce.key} +{t:.1f}', x, y + th + 20, 'sans', 16, (220, 220, 220))
    sheet.makeImageSnapshot().save(path)
    return path

_FILM = None   # set before forking; workers inherit it (scenes hold closures that can't be pickled)

def _worker(args):
    f0, f1, seg_path, fps = args
    film = _FILM
    cmd = [FFMPEG, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{W}x{H}', '-r', str(fps),
           '-i', '-', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
           '-x264-params', 'threads=2:keyint=96', seg_path]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    surf = skia.Surface(W, H)
    n = 0
    for f in range(f0, f1):
        film.frame(f / fps, surf)
        arr = surf.makeImageSnapshot().toarray(colorType=skia.kRGBA_8888_ColorType)
        p.stdin.write(arr.tobytes())
        n += 1
    p.stdin.close(); rc = p.wait()
    if rc != 0 or n != f1 - f0:
        raise RuntimeError(f'segment {seg_path}: ffmpeg rc={rc}, frames {n}/{f1 - f0}')
    return seg_path

def count_frames(path):
    """Video packet count (one packet per frame for our H.264 streams), no decoding."""
    out = subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-i', path, '-map', '0:v', '-c', 'copy',
                          '-f', 'framecrc', '-'], capture_output=True, text=True).stdout
    return sum(1 for ln in out.splitlines() if ln and not ln.startswith('#'))

def render_video(film, out_path, fps=FPS, workers=4, t0=0.0, t1=None, audio=True, workdir=None):
    import multiprocessing as mp
    workdir = workdir or os.path.dirname(out_path)
    t1 = film.duration if t1 is None else t1
    F0, F1 = int(t0 * fps), int(math.ceil(t1 * fps))
    n = F1 - F0
    chunk = math.ceil(n / (workers * 4))
    jobs = []
    for i, s in enumerate(range(F0, F1, chunk)):
        jobs.append((s, min(F1, s + chunk), f'{workdir}/seg_{i:04d}.mp4', fps))
    global _FILM
    _FILM = film
    ctx = mp.get_context('fork')
    t = time.time()
    with ctx.Pool(workers) as pool:
        for k, _ in enumerate(pool.imap(_worker, jobs)):
            print(f'  segment {k + 1}/{len(jobs)}  {time.time() - t:.0f}s', flush=True)
    lst = f'{workdir}/segs.txt'
    open(lst, 'w').write(''.join(f"file '{j[2]}'\n" for j in jobs))
    vid = f'{workdir}/video_only.mp4'
    subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', vid], check=True)
    got = count_frames(vid)
    if got != F1 - F0:
        raise RuntimeError(f'concatenated video has {got} frames, expected {F1 - F0}; segments kept in {workdir}')
    for j in jobs:
        os.remove(j[2])
    if audio:
        wav = f'{workdir}/audio.wav'
        if t0 == 0 and (t1 is None or t1 >= film.duration - 0.01):
            film.audio(wav)
        else:
            y = film.audio()
            s0, s1 = int(t0 * SR), int(t1 * SR)
            sf.write(wav, y[s0:s1], SR, subtype='PCM_16')
        srt = os.path.splitext(out_path)[0] + '.zh.srt'
        if t0 == 0 and (t1 is None or t1 >= film.duration - 0.01):
            film.srt(srt)
            # subtitles are burned into the picture; the .srt is shipped beside the MP4 rather than
            # embedded (MP4 marks an embedded track default, and players would show subtitles twice)
            subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', vid, '-i', wav,
                            '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
                            '-metadata:s:a:0', 'language=chi', '-movflags', '+faststart', out_path], check=True)   # no -shortest (would cut to the shortest stream)
        else:
            subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', vid, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
                            '-movflags', '+faststart', '-shortest', out_path], check=True)
        os.remove(vid)
    else:
        os.replace(vid, out_path)
    return out_path

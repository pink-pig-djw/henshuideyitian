"""Scene builder: place voice lines, sound, and visual layers on a scene-local clock.

    sc = Scene('s03', kind='A')
    sc.amb(sfx.room_tone(30), 0, None, gain=-6)          # loops to scene end
    sc.layer(draw_room, 0, None)                           # draw_room(c, t, L)
    sc.wait(1.0)
    sc.say('chen', '垃圾桶。')                             # advances the cursor
    sc.sfx(sfx.paper_rustle(), gain=-8)                    # at the cursor
    sc.hold(3.0)                                           # silent beat
    return sc
"""
import numpy as np
from .config import *
from . import voice as V
from .audio import fit, phone as phone_fx, reverb, lowpass, highpass, peak_eq, radio_far, db

class Layer:
    __slots__ = ('fn', 'start', 'end', 'z', 'fin', 'fout', 'name')
    def __init__(self, fn, start, end, z, fin, fout, name):
        self.fn, self.start, self.end, self.z, self.fin, self.fout, self.name = fn, start, end, z, fin, fout, name

class Ctx:
    """Passed to layer draw functions."""
    __slots__ = ('dur', 'alpha', 'T', 'scene', 'w', 'h', 'start')

class Sub:
    __slots__ = ('start', 'end', 'who', 'text', 'style', 'note', 'dur_speech')
    def __init__(self, start, end, who, text, style, note='', dur_speech=0.0):
        self.start, self.end, self.who, self.text, self.style, self.note = start, end, who, text, style, note
        self.dur_speech = dur_speech

FX = {
    None: lambda x: x,
    'dry': lambda x: x,
    'room': lambda x: reverb(x, wet=0.16, decay=0.5, size='room'),
    'phone': lambda x: phone_fx(x),
    'vo': lambda x: reverb(peak_eq(x, 200, 2), wet=0.10, decay=0.9, size='hall'),
    'far': lambda x: reverb(lowpass(x, 3000), wet=0.45, decay=1.2, size='room'),
    'inner': lambda x: reverb(lowpass(x, 4200), wet=0.55, decay=2.2, size='hall', bright=3500),
    'stair': lambda x: reverb(x, wet=0.35, decay=1.6, size='stair'),
    'hall': lambda x: reverb(x, wet=0.3, decay=1.4, size='hall'),
}

class Scene:
    def __init__(self, key, kind='A', frame=None, title=''):
        self.key, self.kind, self.title = key, kind, title
        self.frame = frame or ('4:3' if kind == 'B' else '16:9')
        self.layers, self.audio, self.subs = [], [], []
        self.t = 0.0
        self.marks = {}
        self.tail = 0.0
        self.sub_style = {'A': 'A', 'B': 'B'}.get(kind, 'B')
        self.sub_color = None       # override subtitle colour (rgb)
        self.sub_y = None           # override subtitle baseline y (local coords)
        self.grain = 0.07 if kind == 'A' else 0.10
        self.lines = []             # (who, text, path) for ASR verification
        self.spoken = []            # every voiced line for the subtitle track: (start, end, who, text, note)
        self._dur = None

    # ---------- clock ----------
    def wait(self, s):
        self.t += s
        return self.t

    hold = wait

    def at(self, t):
        self.t = t
        return self

    def mark(self, name):
        self.marks[name] = self.t
        return self.t

    # ---------- voice ----------
    def say(self, who, text, at=None, speed=None, fx='room', gain=0.0, pan=0.0, post=0.45,
            sub=True, sub_text=None, note='', style=None, advance=True, tts=None, steps=8, variant=0):
        """Speak a line. Returns (start, end). `tts` overrides the spoken text (e.g. to fix a
        polyphone) while `sub_text`/`text` is what appears on screen."""
        y, path = V.synth(who, tts or text, speed=speed, steps=steps, seed_variant=variant)
        y = FX[fx](y) if fx in FX else fx(y)
        start = self.t if at is None else at
        d = len(y) / SR
        self.audio.append((start, y, gain, pan, 'voice', 0.0, 0.02))
        self.lines.append((who, tts or text, path, start))
        self.spoken.append((start, start + d, who, sub_text or text, note or ('电话' if fx == 'phone' else '')))
        if sub:
            st = style or ('N' if who == 'narr' else self.sub_style)
            if fx == 'phone' and not note:
                note = '电话'
            self.subs.append(Sub(start, start + d, who, sub_text or text, st, note, d))
        if advance and at is None:
            self.t = start + d + post
        return start, start + d

    def narr(self, text, **kw):
        kw.setdefault('fx', 'vo')
        kw.setdefault('post', 0.6)
        return self.say('narr', text, **kw)

    def caption(self, text, start=None, dur=3.0, style='C', who=''):
        """On-screen text without voice (uses subtitle renderer)."""
        s = self.t if start is None else start
        self.subs.append(Sub(s, s + dur, who, text, style))
        return s, s + dur

    # ---------- sound ----------
    def sfx(self, x, at=None, gain=0.0, pan=0.0, fin=0.0, fout=0.0, bus='fx'):
        at = self.t if at is None else at
        self.audio.append((at, np.asarray(x, np.float32), gain, pan, bus, fin, fout))
        return at + len(x) / SR

    def amb(self, x, start=0.0, end=None, gain=0.0, fin=1.0, fout=1.0, bus='amb'):
        """Ambience looped/cut to [start, end]; end=None means scene end."""
        self.audio.append((start, ('LOOP', np.asarray(x, np.float32), end), gain, 0.0, bus, fin, fout))

    def music(self, x, start=None, gain=0.0, fin=0.5, fout=1.0, end=None):
        start = self.t if start is None else start
        if end is not None:
            self.audio.append((start, ('LOOP', np.asarray(x, np.float32), end), gain, 0.0, 'music', fin, fout))
        else:
            self.audio.append((start, np.asarray(x, np.float32), gain, 0.0, 'music', fin, fout))

    # ---------- visuals ----------
    def layer(self, fn, start=0.0, end=None, z=0, fin=0.0, fout=0.0, name=''):
        """fn(c, t, L): t = seconds since layer start; L.alpha, L.dur, L.T (scene time), L.w, L.h."""
        self.layers.append(Layer(fn, start, end, z, fin, fout, name))
        return fn

    # ---------- finalise ----------
    @property
    def duration(self):
        if self._dur is None:
            ends = [self.t]
            for (at, y, *_r) in self.audio:
                if isinstance(y, tuple):
                    continue
                ends.append(at + len(y) / SR)
            for s in self.subs:
                ends.append(s.end)
            return max(ends) + self.tail
        return self._dur

    def finish(self, tail=0.0):
        """Freeze duration (cursor/audio end + tail). Call once at the end of build()."""
        self.tail = tail
        self._dur = None
        self._dur = self.duration
        for L in self.layers:
            if L.end is None:
                L.end = self._dur
        return self

    def mix_into(self, mixer, offset):
        d = self.duration
        for (at, y, gain, pan, bus, fin, fout) in self.audio:
            if isinstance(y, tuple):
                _, x, end = y
                end = d if end is None else end
                if end <= at:
                    continue
                y = fit(x, end - at)
            mixer.add(y, offset + at, gain, pan, fin, fout, bus)

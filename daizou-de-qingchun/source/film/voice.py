"""Character voices: ZipVoice (zero-shot, natural prosody) conditioned on per-character
timbre prompts rendered with Kokoro v1.1-zh speakers. Cached on disk; ASR-verified."""
import hashlib, json, os, re, threading
import numpy as np
import soundfile as sf
from .config import ROOT, SR
from .audio import resample

CACHE = ROOT + '/cache/tts'
VOICES = ROOT + '/voices'
os.makedirs(CACHE, exist_ok=True)

# name -> display label, kokoro sid, prompt speed, prompt text, default speed
CAST = {
    'zhang':   dict(label='张朝阳', sid=87, pspeed=0.88, speed=1.03,
                    prompt='我没事。就是最近有点累，想早点睡。明天的课，我会去的。'),
    'li':      dict(label='李浩然', sid=82, pspeed=1.12, speed=1.03,
                    prompt='哎你往哪走啊！快快快，来这边，跟着我，稳了稳了！'),
    'chen':    dict(label='陈杰辉', sid=93, pspeed=0.95, speed=1.16,
                    prompt='你先别急。我们把这件事从头捋一遍，一件一件地看。'),
    'xiao':    dict(label='肖强', sid=95, pspeed=0.95, speed=0.95,
                    prompt='坐坐坐，别客气。有什么困难跟学长说，能帮的我一定帮。'),
    'cuishou': dict(label='催收员', sid=68, pspeed=1.05, speed=1.06,
                    prompt='我再提醒你一遍。钱是你自己借的，合同是你自己签的。'),
    'father':  dict(label='父亲', sid=71, pspeed=0.95, speed=1.12,
                    prompt='喂？儿子？这边信号不好，你大点声，我听不清。'),
    'narr':    dict(label='', sid=57, pspeed=0.92, speed=1.12,
                    prompt='那天晚上，宿舍里很安静。窗外的梧桐树，在风里轻轻地晃。'),
}
PROMPT_VERSION = 'v1'
_lock = threading.Lock()
_prompts = {}

def label(who):
    return CAST[who]['label']

def _prompt(who):
    if who not in _prompts:
        path = f'{VOICES}/{who}_{PROMPT_VERSION}.wav'
        if not os.path.exists(path):
            from engines import kokoro
            c = CAST[who]
            a = kokoro().generate(c['prompt'], sid=c['sid'], speed=c['pspeed'])
            sf.write(path, np.array(a.samples, np.float32), a.sample_rate)
        y, sr = sf.read(path, dtype='float32')
        _prompts[who] = (y, sr)
    return _prompts[who]

def tts_clean(text):
    """Normalise script text for the TTS front end (pauses, quotes, dashes)."""
    t = text
    t = re.sub(r'[“”"「」『』《》]', '', t)
    t = t.replace('……', '，').replace('…', '，').replace('——', '，').replace('—', '，')
    t = t.replace('～', '').replace('~', '')
    t = re.sub(r'[（(][^）)]*[）)]', '', t)       # stage directions in parentheses
    t = re.sub(r'，+', '，', t)
    t = re.sub(r'^[，。、\s]+', '', t)
    t = t.strip()
    if t and t[-1] not in '。！？!?，':
        t += '。'
    return t

def _trim(y, sr, thr=0.012, pad=0.04):
    a = np.abs(y)
    idx = np.where(a > thr)[0]
    if len(idx) == 0:
        return y
    s = max(0, idx[0] - int(pad * sr)); e = min(len(y), idx[-1] + int(pad * 2 * sr))
    return y[s:e]

def synth(who, text, speed=None, steps=8, seed_variant=0):
    """Return mono float32 at SR for a character line (cached).
    `speed` is a multiplier on the character's calibrated default pace (1.0 = normal for them)."""
    c = CAST[who]
    speed = c['speed'] * (1.0 if speed is None else speed)
    t = tts_clean(text)
    key = hashlib.sha1(f'{who}|{PROMPT_VERSION}|{t}|{speed:.3f}|{steps}|{seed_variant}'.encode()).hexdigest()[:16]
    path = f'{CACHE}/{who}_{key}.wav'
    if not os.path.exists(path):
        with _lock:
            from engines import zipvoice
            py, psr = _prompt(who)
            # seed_variant: nudges prosody by padding the prompt slightly
            pad = np.zeros(int(0.05 * seed_variant * psr), np.float32)
            a = zipvoice().generate(t, c['prompt'], list(np.concatenate([py, pad])), psr, speed, steps)
            y = _trim(np.array(a.samples, np.float32), a.sample_rate)
            tmp = path + f'.{os.getpid()}.tmp.wav'
            sf.write(tmp, y, a.sample_rate)
            os.replace(tmp, path)
            meta = dict(who=who, text=t, speed=speed, steps=steps)
            json.dump(meta, open(path[:-4] + '.json', 'w'), ensure_ascii=False)
    y, sr = sf.read(path, dtype='float32')
    return resample(y, sr, SR), path

def verify(path, ref_text):
    """ASR round-trip; returns (cer, hypothesis). Cached next to the wav."""
    vp = path[:-4] + '.asr.json'
    if os.path.exists(vp):
        d = json.load(open(vp)); return d['cer'], d['hyp']
    from engines import transcribe, cer
    y, sr = sf.read(path, dtype='float32')
    with _lock:
        hyp = transcribe(y, sr)
    e = cer(tts_clean(ref_text), hyp)
    json.dump(dict(cer=e, hyp=hyp), open(vp, 'w'), ensure_ascii=False)
    return e, hyp

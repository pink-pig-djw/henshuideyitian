import sherpa_onnx, numpy as np, soundfile as sf, re
M='/opt/film/models/'
_k=_z=_asr=None
def kokoro():
    global _k
    if _k is None:
        d=M+'kokoro-multi-lang-v1_1/'
        cfg=sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
          kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(model=d+'model.onnx',voices=d+'voices.bin',tokens=d+'tokens.txt',
          lexicon=d+'lexicon-us-en.txt,'+d+'lexicon-zh.txt',data_dir=d+'espeak-ng-data',dict_dir=d+'dict'),num_threads=4),
          rule_fsts=d+'date-zh.fst,'+d+'phone-zh.fst,'+d+'number-zh.fst',max_num_sentences=1)
        _k=sherpa_onnx.OfflineTts(cfg)
    return _k
def zipvoice():
    global _z
    if _z is None:
        d=M+'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia/'
        cfg=sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
          zipvoice=sherpa_onnx.OfflineTtsZipvoiceModelConfig(tokens=d+'tokens.txt',encoder=d+'encoder.int8.onnx',decoder=d+'decoder.int8.onnx',
            vocoder=M+'vocos_24khz.onnx',data_dir=d+'espeak-ng-data',lexicon=d+'lexicon.txt'),num_threads=3))
        _z=sherpa_onnx.OfflineTts(cfg)
    return _z
def asr():
    global _asr
    if _asr is None:
        d=M+'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/'
        _asr=sherpa_onnx.OfflineRecognizer.from_sense_voice(model=d+'model.int8.onnx',tokens=d+'tokens.txt',language='zh',use_itn=False,num_threads=2)
    return _asr
def transcribe(samples,sr):
    r=asr(); s=r.create_stream(); s.accept_waveform(sr,np.asarray(samples,dtype=np.float32)); r.decode_stream(s); return s.result.text
def norm(t): return re.sub(r'[^一-鿿A-Za-z0-9]','',t)
def cer(ref,hyp):
    a,b=norm(ref),norm(hyp)
    d=list(range(len(b)+1))
    for i,ca in enumerate(a,1):
        p=d[:]; d[0]=i
        for j,cb in enumerate(b,1): d[j]=min(p[j]+1,d[j-1]+1,p[j-1]+(ca!=cb))
    return d[len(b)]/max(1,len(a))

# 「贷」走的青春

根据微电影剧本《「贷」走的青春》（终稿）制作的影片。画面、音效和配音全部由程序生成。

> 本作涉及校园贷、暴力催收与自杀议题，全片不呈现自杀过程。
> 如果你正在经历困难，请拨打**全国统一心理援助热线 12356**，或**希望24热线 400-161-9995**（24 小时）。

## 影片

| 项目 | 内容 |
|---|---|
| 时长 | 约 41 分 46 秒（序幕 + 十四场 + 尾声） |
| 画面 | 1920×1080，24 fps，H.264 |
| 声音 | 48 kHz 立体声，AAC |
| 字幕 | 中文字幕已嵌入画面；另有可开关的中文字幕轨（MP4 内）和 `film.zh.srt` |

### 两套视觉系统

| | 【循环】5月9日 | 【倒计时】62 天 |
|---|---|---|
| 画幅 | 16:9 | 4:3，两侧留黑 |
| 质感 | 冷色证物室：网格、宿舍平面图、时间戳事件日志、笔录式字幕 | 张朝阳的铅笔速写本：线条逐笔画出，纸色随天数由暖变灰 |
| 镜头 | 固定；直到最后一场才第一次移动 | 观察式，页面之间交叉溶解 |
| 颜色 | 唯一强调色红色，只用在「贷」字和那个藏起来的「月」字上 | 饱和色只出现在李浩然的游戏灯光上 |

全片不出现人脸：人物只以剪影、平面图上的圆点、物件和声音出现。

### 配音

配音用 [ZipVoice](https://github.com/k2-fsa/ZipVoice)（零样本语音合成）生成，由 [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 在本机 CPU 上运行。每个角色的音色样本取自 [Kokoro-82M v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh) 的一位中文说话人（样本在 `source/voices/`）。每句台词都用 SenseVoice 语音识别回测过发音。

| 角色 | Kokoro 说话人编号 | 处理 |
|---|---|---|
| 张朝阳 | 87 | 轻、慢 |
| 李浩然 | 82 | 响、快 |
| 陈杰辉 | 93 | 平稳 |
| 肖强 | 95 | 柔和 |
| 催收员 | 68 | 生硬 |
| 父亲 | 71 | 电话里 |
| 旁白 | 57 | 女声，克制 |

### 相对原剧本的改动

1. **求助热线**：剧本把号码和名称标反了。片中改为全国统一心理援助热线 **12356**（[国家卫生健康委通知](https://www.gov.cn/zhengce/zhengceku/202412/content_6994470.htm)），以及希望24热线 **400-161-9995**（[希望24热线](http://www.hope9995.com/about/show.php?lang=cn&id=19&pcok=pc)）。
2. **循环次数**：第十二场李浩然的「十一次了」改为「十五次了」。前面各场的循环计数依次是 11、12、13、14、15。
3. 片头增加内容提示卡，片尾增加制作说明。

## 目录

```
daizou-de-qingchun/
├── index.html        播放页：从分段文件拼出 MP4 播放
├── media/            成片 MP4 的分段（film.partNN）
├── film.zh.srt       中文字幕
└── source/           生成影片的全部代码
    ├── film/         引擎：时间线、配音、混音、音效、铅笔素描、字体排版、渲染
    ├── scenes/       16 个场景（s00_prologue … s15_epilogue）
    ├── lib/          语音模型加载（sherpa-onnx）
    ├── voices/       7 个角色的音色样本
    ├── build.py      预览 / 渲染入口
    ├── qa_mix.py     最终混音的逐句可懂度检查
    └── GUIDE.md      美术与引擎指南
```

## 本地重新生成

需要 Python 3.11，以及 `skia-python`、`sherpa-onnx`、`numpy`、`scipy`、`soundfile`、`imageio-ffmpeg`。模型从 sherpa-onnx 的 GitHub Releases 下载，放到 `/opt/film/models/`：

- `tts-models/kokoro-multi-lang-v1_1.tar.bz2`
- `tts-models/sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2`
- `vocoder-models/vocos_24khz.onnx`
- `asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2`

字体用思源宋体 SC、思源黑体 SC 和霞鹜文楷，放到 `/opt/film/fonts/`。

```
./run build.py preview s02 --n 16    # 单场预览：缩略图、音频、字幕时间线、发音检查
./run build.py render                 # 渲染全片
```

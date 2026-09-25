# 七里香 · 手绘动画 MV（代码生成）

一支完全用 JavaScript Canvas 逐帧"画"出来的手绘风格 MV：铅笔线条会抖动（每秒 12 次，逐两帧换一次笔触），水彩层层叠加，所有画面都叠在同一张纸纹上。

## 故事：《纸上的那年夏天》

成年后的他翻开一本旧素描本，镜头跌进画里：

1. **夏天**：电线上叽叽喳喳的麻雀、窗边的女孩、铅笔来回描她的样子、偷看秋刀鱼的猫、一起放学的巷子、像草莓一样的太阳。
2. **雨夜**：他在台灯下写了一整夜，院子里落叶一层层堆起来；素描本里每一页都是她；天亮时窗台停着一只蝴蝶；他把写好的纸折成纸飞机，飞过院子落进她的窗口。
3. **秋天**：黄昏一起坐在墙头，骑单车穿过稻田，雨里共撑一把伞，金黄的稻穗、番茄一样红的脸、她说七里香的名字很好听、夕阳下的剪影。
4. **离别**：夏天结束，她在雨中的公交站把一枝七里香递给他，车开走了。雨水把整幅画冲刷干净。
5. **现在**：空白的纸上重新画出一只蝴蝶；他在素描本最后一页续写，画上那年院子里的两个人。左页夹着的那枝干枯的七里香，就是当年她送的那一枝。

角色、场景、道具全部是在代码里原创绘制的。

## 歌词呈现

画面上不打整句歌词，只会在唱到的时候**手写出每句里的一两个关键词**，逐字对齐人声，写完后旁边会长出对应的小涂鸦（麻雀、草莓、雨滴、蝴蝶、七里香小花、红笔圈……）。
关键词和时间轴由 `input/keywords.json`、`input/timing.json` 提供。

## 目录

| 路径 | 作用 |
| --- | --- |
| `index.html` | 播放 / 预览页（浏览器打开即可边听边看），也是离线渲染入口 |
| `src/kit.js` | 基础笔触：噪声、墨线、铅笔、水彩晕染、纸纹、线条抖动 |
| `src/paint.js` | 道具和环境：天空云朵、电线杆、麻雀、猫、七里香、雨、公交车等 |
| `src/people.js` | 两位主角：半身像、侧身骨骼、背影、剪影、握笔的手 |
| `src/scenes.js` | 32 个镜头的分镜与动画 |
| `src/lyrics.js` | 手写关键词排版与涂鸦 |
| `src/main.js` | 时间轴、转场（翻页 / 水彩晕开 / 铅笔涂抹 / 甩镜）、调色与后期 |
| `tools/align.py` | 人声分离 + 语音识别 + 拼音对齐，生成逐字时间轴 |
| `tools/render.mjs` | 用无头 Chromium 逐帧渲染，再用 ffmpeg 合成 MP4 |

## 自己渲染

音频、歌词和字体**不在仓库里**，需要自己放进去：

```
input/song.mp3        歌曲音频
input/lyrics.txt      每行一句歌词（只用于对时）
input/keywords.json   {"行号": "要写在屏幕上的关键词"}
assets/fonts/         LXGWWenKai-Medium.ttf、MaShanZheng-Regular.ttf、LongCang-Regular.ttf
```

```bash
bash tools/fetch_fonts.sh          # 下载三款开源字体（OFL）
pip install sherpa-onnx soundfile librosa pypinyin
python tools/align.py              # 生成 input/timing.json 和 input/analysis.json
npm install
npm run render                     # 输出 out/七里香-MV.mp4（1920×1080，24fps）
npm run serve                      # 浏览器打开 http://127.0.0.1:8765/ 实时预览
```

常用参数：`--stills 30,95.5` 只出几张静帧，`--from 80 --to 96` 只渲染一段，`--workers 4` 并行进程数。

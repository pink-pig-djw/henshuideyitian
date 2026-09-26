# 星と僕らと · MV 引擎

纯浏览器端的音乐视频（MV）渲染器：载入你自己的音频、粘贴你自己的歌词，
按节拍与段落自动生成一支 **受《女神异闻录 5》平面风格启发** 的红 / 黑 / 白 MV，
可以实时播放、手动对轴，并导出 MP4。

- 不需要安装、不需要构建：普通 `<script>`，**直接双击 `index.html` 就能用**，也可以放在任何静态服务器上。
- 画面全部为原创图形（倾斜几何、网点、剪贴字、无脸剪影、被斜线贯穿的五角星），与任何游戏或品牌无关，非官方作品。
- **仓库里不包含任何歌词文本和音频。** 歌词只在运行时由你粘贴，并且只保存在你自己的浏览器里。

> 内置时间轴预设对应 Lyn《星と僕らと》（作詞：小森成雄 / 作曲：目黒将司，《ペルソナ5》ED）一个 221.27 秒的录音版本。
> 预设只记录节拍（99.99 BPM 与小节相位）、段落、每句的时间与字符偏移以及一个哈希值（`MV.lyricKey`），不含歌词。

---

## 快速开始

### 1. 打开页面

- **本地直接用（最简单）**：把项目下载到电脑，用桌面版 **Chrome / Edge** 双击 `mv/index.html`（`file://`）。
  播放、对轴、导出都可以用。此时不会自动读取 `mv/assets/` 文件夹，请把音频拖进页面或用「载入音频」选择。
- **本地服务器（可自动载入）**：在仓库根目录运行 `python3 -m http.server 8000 --directory mv`，打开 <http://localhost:8000/>。
  这样 `mv/assets/song.mp3`（或 `song.m4a` / `song.wav` / `song.ogg`）和 `mv/assets/lyrics.txt`（或 `lyrics.lrc`）会被自动载入。
- **手机**：可以播放和预览（横屏、竖屏都已适配），导出请用电脑。
- **在网页预览里打开（例如 claude.ai 的预览）**：可以播放和预览，但这类预览通常会拦截文件下载。
  需要导出视频或 LRC 时，请把项目下载到本地后用 Chrome / Edge 打开再导出。
- 页面标题和画面文字使用 Google Fonts，需要联网；离线时自动改用系统字体（会有一条提示）。

### 2. 载入音频

任选一种：

- 把音频文件（mp3 / m4a / wav / ogg / flac …）**拖到页面任意位置**；
- 菜单点「载入音频 AUDIO」（或按 <kbd>O</kbd>）选择文件；
- 通过本地服务器打开时，放在 `mv/assets/song.mp3` 会自动载入。

载入后会自动分析节拍与段落，并与内置预设比对，状态栏显示「已匹配 · 置信度 · 偏移」。
拖入或选择的音频会缓存在本机浏览器（IndexedDB），下次打开自动恢复；可在「设置 → 本地缓存」清除。
如果显示「未匹配预设」，说明你的录音版本与预设不同：画面会按自动分析的节拍与段落生成，歌词请用「对轴」重新打点。

### 3. 粘贴歌词

菜单「歌词 LYRICS」（或按 <kbd>L</kbd>）→ 粘贴 → 「应用 APPLY」（或 <kbd>Ctrl</kbd>+<kbd>Enter</kbd>）。

- **歌词只保存在你的浏览器里（localStorage），不会写入仓库，也不会上传到任何地方。**
- 直接粘贴从网上复制的整段即可：标题行、`歌手：` `作詞：` `作曲：` 等署名行、括号里的出处行和空行都会被自动忽略；
  句内用空格分隔的短句会按预设时间逐段出现。
- 也可以把 `.txt` / `.lrc` 文件拖进页面，或用面板里的「从文件 FILE」。支持标准 LRC 和逐字（增强）LRC。
- 对这首歌，匹配成功时状态显示 **「已匹配 12 句，5 句本录音未演唱」**：
  **公开歌词的第 6–10 行在这个录音版本里没有唱**，所以不会显示，这是正常的。
- 没有歌词也能播放（只有画面、标题和制作人员字幕），页面底部会提示粘贴歌词。

### 4. 播放与快捷键

菜单「播放 PLAY」、底部播放键或 <kbd>Space</kbd>。进度条按段落着色（高度 = 段落强度），上方的小三角是每句歌词的位置，可点击或拖动跳转；
播放时控制条 2.5 秒无操作自动隐藏，移动鼠标或轻点画面即可唤出。浏览器拦截自动播放时，点一下「点击播放」即可。

| 键 | 作用 | 键 | 作用 |
|---|---|---|---|
| <kbd>Space</kbd> | 播放 / 暂停 | <kbd>←</kbd> <kbd>→</kbd> | 后退 / 前进 5 秒 |
| <kbd>F</kbd> | 全屏（双击画面也可以） | <kbd>H</kbd> | 隐藏 / 显示界面 |
| <kbd>M</kbd> | 菜单 | <kbd>L</kbd> | 歌词面板 |
| <kbd>S</kbd> | 对轴编辑器 | <kbd>E</kbd> | 导出面板 |
| <kbd>[</kbd> <kbd>]</kbd> | 歌词偏移 −/+ 0.05 秒 | <kbd>D</kbd> | 调试信息 |
| <kbd>O</kbd> | 选择音频文件 | <kbd>,</kbd> | 设置 |
| <kbd>Esc</kbd> | 关闭面板 / 菜单 | | |

### 5. 对轴 SYNC（可选）

如果你的音频与预设略有差别，按 <kbd>S</kbd> 打开对轴编辑器：

- 「全局偏移」整体移动所有歌词；
- 边听边按 <kbd>Space</kbd> 给当前行打点（自动跳到下一行），<kbd>P</kbd> 给下一段短句打点；
- <kbd>↑</kbd>/<kbd>↓</kbd> 选择行，<kbd>←</kbd>/<kbd>→</kbd> 微调 ±0.05 秒（<kbd>Shift</kbd> ±0.01 秒），<kbd>Backspace</kbd> 撤销，
  <kbd>Enter</kbd> 播放 / 暂停，<kbd>R</kbd> 从本行前一点重新播放，可切换 0.5× / 0.75× 慢速；
- 「应用 APPLY」后，时间轴保存在本机浏览器；「导出 LRC」会下载一个 `.lrc` 文件并复制到剪贴板，方便备份。

### 6. 歌词偏移

只想让歌词整体提前或推后时，不用打开对轴：在「设置 → 歌词偏移」拖动滑块（±2 秒，步长 0.05 秒），
或直接按 <kbd>[</kbd> / <kbd>]</kbd>。正值 = 歌词更晚出现。偏移按歌曲保存在本机浏览器。

### 7. 导出视频 EXPORT

请使用**桌面版 Chrome / Edge**。按 <kbd>E</kbd> 打开导出面板，选择 1080p / 720p、30 / 60 fps、范围（整首 / 当前段落 / 自定义起止），点「开始导出」。

- 面板会先显示浏览器支持的编码能力。支持 WebCodecs 时离线逐帧渲染，画面与预览逐帧一致、不会丢帧：
  **能用 H.264 + AAC 时导出标准 MP4；不支持时改用 VP9 + Opus**（仍为 `.mp4` 文件，结果行会写明编码）。
- 不支持 WebCodecs 时自动改用实时录制（MediaRecorder），导出期间请让页面保持在前台；若浏览器无法录制 MP4，会导出 **WebM** 并在结果里注明。
- 导出进行中，歌词、歌词偏移、信息条 / 制作人员字幕、对轴和载入音频会暂时锁定，完成或取消后恢复（保证导出的画面前后一致）。可随时「取消」。
- 完成后点「下载 DOWNLOAD」保存文件。**如果点击后没有开始下载（例如在 claude.ai 预览中打开），请把项目下载到本地后用 Chrome / Edge 打开再导出。**
- 渲染速度取决于电脑性能；想快一点可以先用 720p / 30 fps 或较短的范围试导出。

### 设置

信息条（HUD）、制作人员字幕、预览画质（自动 / 1.0 / 0.75 / 0.5；「自动」按屏幕尺寸选择并在掉帧时降级，只影响预览，不影响导出）、
歌词偏移、音量、调试信息、清除本地缓存。设置保存在本机浏览器（localStorage）；在禁止存储的环境里也能正常使用，只是不会记住。

### URL 参数

| 参数 | 说明 |
|---|---|
| `?audio=<url>` | 从指定地址载入音频（`?audio=none` 不自动载入） |
| `?lyrics=<url 或文本>` | 从指定地址（`.txt` / `.lrc`）或直接用参数里的文本载入歌词（`none` 不载入） |
| `?t=<秒>` | 跳到该时刻并暂停显示这一帧 |
| `?autoplay=1` | 载入后自动播放（浏览器拦截时会显示「点击播放」） |
| `?quality=auto\|1\|0.75\|0.5` | 预览画质 |
| `?hud=0` | 关闭信息条 |
| `?debug=1` | 显示调试信息（含帧率、字体载入情况） |
| `?test=1` | 测试模式：静态预览帧、不自动隐藏、界面动画 1 ms |
| `?autoload=0` | 不探测 `assets/`、不读 IndexedDB 缓存 |
| `?assets=0` | 只跳过 `assets/` 探测（仍从 IndexedDB 缓存恢复上次的音频） |

---

## 常见问题

- **点「下载」没有反应 / 在 claude.ai 等网页预览中打开**：这类预览会拦截下载（也不支持弹窗）。请把项目下载到本地，用 Chrome / Edge 双击 `mv/index.html` 打开后再导出。
- **没有声音**：浏览器可能拦截了自动播放，点一下画面中央的「点击播放」；再检查设置里的音量。
- **状态显示「未匹配预设」**：你的录音与预设版本不同（剪辑、变速或不同混音）。画面照常生成，歌词请用「对轴」打点，或先试试整体偏移。
- **歌词整体早了 / 晚了**：按 <kbd>[</kbd> / <kbd>]</kbd> 或在设置里调「歌词偏移」。
- **只显示了 12 句**：第 6–10 行在这个录音里没有唱，属于正常情况。
- **字体看起来像系统字体**：画面字体来自 Google Fonts（fonts.googleapis.com / fonts.gstatic.com），需要联网；首次打开稍等片刻即可。离线或被网络拦截时会提示并使用系统字体。
- **导出很慢**：离线逐帧渲染的速度取决于电脑，可改用 720p / 30 fps 或导出较短的范围；实时录制（MediaRecorder）模式下请保持页面在前台。
- **导出的是 WebM**：浏览器无法录制 MP4，可用 VLC / Chrome 播放，或再转码为 MP4；换用最新的桌面 Chrome / Edge 一般能直接导出 MP4。
- **双击打开时没有自动载入 `assets/` 里的歌**：`file://` 下浏览器不允许页面读取文件夹，请把音频拖进页面；或者用上面的本地服务器方式打开。
- **想清空所有本地数据**：「设置 → 本地缓存 → 清除缓存的音频与歌词」。

## 隐私与版权

- **`mv/assets/` 里除 `README.md` 外的所有文件都被 git 忽略**（见 `mv/.gitignore`），你的音频和歌词不会被提交。
- 粘贴的歌词只保存在本浏览器的 localStorage（键 `mv.lyrics.*` / `mv.synced.*`），音频缓存在 IndexedDB（`mv-cache`）；都可以在「设置 → 清除缓存」删除。
- 仓库中的测试、示例、文档只使用虚构的占位歌词。
- 视觉风格受 P5 启发，但所有图形均为原创：人物是无脸剪影，标志是原创的「被斜线贯穿的五角星」，不使用任何游戏角色、面具、Logo 或界面素材。

## 文件结构

```
mv/
  index.html          页面（按固定顺序加载所有脚本；只链接界面本身用到的网页字体）
  css/app.css         界面样式（菜单、控制条、面板、提示；桌面 / 竖屏 / 横屏布局）
  css/sync.css        对轴编辑器样式
  js/core.js          公共命名空间、调色板、字体（MV.fonts 按需载入字体子集）、数学/随机、绘图工具、注册表
  data/*.js           时间轴预设（不含歌词）
  js/analysis.js      离线音频分析：节拍、段落、与预设对齐
  js/audio.js         播放时钟、解码、IndexedDB 缓存
  js/lyrics.js        歌词解析（纯文本 / LRC / 预设匹配）与样式分配
  js/render/*.js      场景、歌词字效、转场与特效、HUD、WebGL 后期
  js/director.js      时间线：把特征 + 歌词编排成每一帧的状态
  js/stage.js         合成一帧
  js/export.js        WebCodecs + mp4-muxer 导出（MediaRecorder 兜底）
  js/sync.js          对轴编辑器
  js/app.js           界面、自动载入、快捷键、渲染循环、导出锁定、测试 API
  vendor/             mp4-muxer（MIT）
  tools/              开发页面与 Playwright 测试
  assets/             你自己的音频 / 歌词（git 忽略）
  out/                测试输出（git 忽略）
```

模块之间的约定见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。渲染是时间 `t` 的纯函数，所以预览与导出逐帧一致。

## 开发与测试

```
# 界面测试（启动 / 菜单 / 快捷键 / 拖放 / 手机与桌面截图 / URL 参数 / 缓存 / 缺失模块 / 真实音频与导出）
NODE_PATH=/opt/node22/lib/node_modules node mv/tools/test-app.cjs
# 只跑一部分：--only=boot,keys,drop,mobile,params,persist,missing,sync,real
```

截图输出到 `mv/out/app-ui/`。测试可以通过环境变量 `MV_LYRICS`（及 `MV_LYRICS_CLEAN`）读取仓库外的本地歌词文件，只打印数量、不打印内容；
未提供时改用虚构的占位歌词。
页面对测试暴露 `window.MV.app`：`loadAudioURL(url)`、`setLyricsText(text)`、`renderAt(t)`、`play()`、`pause()`、`seek(t)`、`getState()`（含字体载入报告 `fonts`）、`exportVideo(opts)`。
时间轴预设的生成脚本不放在仓库里，因为它包含歌词片段；它必须使用与 `MV.canonDisplay` / `MV.canonKey` 完全相同的规则。

---

## English summary

A browser-only, audio-reactive music-video engine with an original, Persona-5-*inspired* red/black/white graphic style (faceless
silhouettes, an original star-and-blade emblem; no franchise assets).

1. **Open** `mv/index.html` by double-clicking it in desktop Chrome / Edge (works from `file://`), or serve the folder with
   `python3 -m http.server 8000 --directory mv` (then `mv/assets/song.mp3` and `lyrics.txt` load automatically).
2. **Load audio**: drop a file anywhere, or menu **AUDIO** / key <kbd>O</kbd>. It is analysed and matched to the built-in preset.
3. **Paste lyrics** in the **LYRICS** panel (<kbd>L</kbd>). They stay in your browser (localStorage) and are never stored in the repo.
   Lines 6–10 of the published lyrics are not sung in this recording and are never shown ("12 matched, 5 not sung" is expected).
4. **Play**: <kbd>Space</kbd>; ←/→ ±5 s · F fullscreen · H hide UI · M menu · S sync editor · E export · [ ] lyric offset ±0.05 s · D debug.
5. **Sync** (<kbd>S</kbd>): global offset, tap lines (Space) / phrases (P), nudge, apply, export LRC.
6. **Export** (<kbd>E</kbd>, desktop Chrome / Edge): WebCodecs frame-exact MP4 — H.264 + AAC when available, otherwise VP9 + Opus;
   realtime MediaRecorder fallback (may produce WebM). Editing is locked while an export runs. Sandboxed previews (e.g. claude.ai)
   block downloads — download the project and export locally.

Web fonts come from Google Fonts: the page links only the UI faces and requests exact-character subsets of the 17 canvas faces
for the current lyrics / title / credits (one small file per face — a few dozen requests instead of several hundred); offline it
falls back to system fonts.
Troubleshooting: see 常见问题 above (no download in previews, autoplay blocked, preset not matched, lyric offset, fonts, slow export).

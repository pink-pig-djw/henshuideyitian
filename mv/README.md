# 星と僕らと · MV 引擎

纯浏览器端的音乐视频（MV）渲染器：载入你自己的音频、粘贴你自己的歌词，
按节拍与段落自动生成一支 **受《女神异闻录 5》平面风格启发** 的红 / 黑 / 白 MV，
可以实时播放、手动对轴，并导出 MP4。

- 不需要安装、不需要构建：普通 `<script>`，静态服务器或本地文件均可打开。
- 画面全部为原创图形（倾斜几何、网点、剪贴字、剪影、星星），与任何游戏或品牌无关，非官方作品。
- **仓库里不包含任何歌词文本和音频。** 歌词只在运行时由你粘贴，并只保存在你自己的浏览器里。

> 内置时间轴预设对应 Lyn《星と僕らと》（作詞：小森成雄 / 作曲：目黒将司，《ペルソナ5》ED）一个 221.27 秒的录音版本。
> 预设只记录节拍、段落、每句的时间和字符偏移以及一个哈希值（`MV.lyricKey`），不含歌词。

---

## 快速开始

1. **打开页面**
   - 推荐：在仓库根目录运行 `python3 -m http.server 8000 --directory mv`，然后访问 <http://localhost:8000/>。
     （`http://localhost` 属于安全上下文，才能使用 WebCodecs 快速导出。）
   - 也可以直接双击 `mv/index.html`（`file://`）。此时拖放文件、播放、对轴都能用，但不会自动读取 `assets/`。
   - 推荐桌面版 Chrome / Edge（导出 H.264 MP4 最完整）。手机上可以播放和预览，画面会自动适配宽度。
2. **载入音频**：三选一
   - 把音频文件（mp3 / m4a / wav / ogg …）**拖到页面任意位置**；
   - 菜单点「载入音频 AUDIO」（或按 <kbd>O</kbd>）选择文件；
   - 把文件放进 `mv/assets/song.mp3`（或 `song.m4a` / `song.wav` / `song.ogg`），通过 http 打开时会自动载入。

   载入后会自动分析节拍与段落，并与内置预设比对（状态栏显示「已匹配 · 置信度 · 偏移」）。
   你拖入或选择的音频会缓存到本机 IndexedDB，下次打开自动恢复（设置里可清除）。
3. **粘贴歌词**：菜单「歌词 LYRICS」（或按 <kbd>L</kbd>）→ 粘贴 → 「应用 APPLY」（<kbd>Ctrl</kbd>+<kbd>Enter</kbd>）。
   - 直接粘贴从网上复制的整段即可：标题行、`歌手：` `作詞：` `作曲：` 等署名行、括号里的出处行、空行都会被自动忽略；
     句内用空格分隔的短句会按预设时间逐段出现。
   - 也可以拖入 `.txt` / `.lrc` 文件，或放在 `mv/assets/lyrics.txt`（`lyrics.lrc`）自动载入。支持标准 / 增强 LRC。
   - 对这首歌：匹配成功时状态显示 **「已匹配 12 句，5 句本录音未演唱」**——
     公开歌词的 **第 6–10 行在这个录音版本里没有唱**，所以不会显示，这是正常的。
   - 没有歌词也能播放（只有画面、标题和制作人员字幕），页面底部会提示粘贴歌词。
4. **播放**：菜单「播放 PLAY」、底部播放键或 <kbd>Space</kbd>。进度条按段落着色（高度 = 段落强度），上方的小三角是每句歌词的位置；
   播放时控制条 2.5 秒无操作自动隐藏，移动鼠标即可唤出。
5. **对轴 SYNC**（可选，<kbd>S</kbd>）：如果你的音频版本与预设略有差别，可以用「全局偏移」整体移动，
   或边听边按 <kbd>Space</kbd> 逐句打点、<kbd>P</kbd> 逐短句打点，<kbd>←</kbd>/<kbd>→</kbd> 微调，然后「应用 APPLY」。
   应用后的时间轴保存在本机浏览器，也可以「导出 LRC」备份。简单的整体偏移也可以在「设置」里调，或按 <kbd>[</kbd> / <kbd>]</kbd>（每次 ±0.05 s）。
6. **导出视频 EXPORT**（<kbd>E</kbd>）：选择 1080p / 720p、30 / 60 fps、范围（整首 / 当前段落 / 自定义起止），点「开始导出」。
   - 支持 WebCodecs 的浏览器会离线逐帧渲染并封装为 MP4（画面与预览逐帧一致、不会丢帧），面板里显示检测到的编码能力、进度和剩余时间，可随时取消；
   - 不支持时自动改用实时录制（MediaRecorder），导出期间请保持页面在前台；若浏览器无法编码 MP4，会导出 **WebM** 并在结果里注明；
   - 完成后点「下载 DOWNLOAD」保存文件。

### 快捷键

| 键 | 作用 | 键 | 作用 |
|---|---|---|---|
| <kbd>Space</kbd> | 播放 / 暂停 | <kbd>←</kbd> <kbd>→</kbd> | 后退 / 前进 5 秒 |
| <kbd>F</kbd> | 全屏 | <kbd>H</kbd> | 隐藏 / 显示界面 |
| <kbd>M</kbd> | 菜单 | <kbd>L</kbd> | 歌词面板 |
| <kbd>S</kbd> | 对轴编辑器 | <kbd>E</kbd> | 导出面板 |
| <kbd>[</kbd> <kbd>]</kbd> | 歌词偏移 −/+ 0.05 s | <kbd>D</kbd> | 调试信息 |
| <kbd>O</kbd> | 选择音频文件 | <kbd>,</kbd> | 设置 |
| <kbd>Esc</kbd> | 关闭面板 / 菜单 | | |

### 设置

信息条（HUD）开关、制作人员字幕开关、预览画质（自动 / 1.0 / 0.75 / 0.5，「自动」会按屏幕尺寸选择并在掉帧时降级；只影响预览，不影响导出）、
歌词偏移（±2 s，步长 0.05 s）、音量、调试信息、清除本地缓存。设置保存在 localStorage。

### URL 参数

| 参数 | 说明 |
|---|---|
| `?audio=<url>` | 从指定地址载入音频（`?audio=none` 不自动载入） |
| `?lyrics=<url 或文本>` | 从指定地址（`.txt` / `.lrc`）或直接用参数里的文本载入歌词（`none` 不载入） |
| `?t=<秒>` | 跳到该时刻并暂停显示这一帧 |
| `?autoplay=1` | 载入后自动播放（浏览器拦截时会显示「点击播放」） |
| `?quality=auto\|1\|0.75\|0.5` | 预览画质 |
| `?hud=0` | 关闭信息条 |
| `?debug=1` | 显示调试信息 |
| `?test=1` | 测试模式：静态预览帧、不自动隐藏、界面动画 1 ms |
| `?autoload=0` | 不探测 `assets/`、不读 IndexedDB 缓存 |
| `?assets=0` | 只跳过 `assets/` 探测（仍从 IndexedDB 缓存恢复上次的音频） |

---

## 隐私与版权

- **`mv/assets/` 里除 `README.md` 外的所有文件都被 git 忽略**（见 `mv/.gitignore`），你的音频和歌词不会被提交。
- 粘贴的歌词只保存在本浏览器的 localStorage（键 `mv.lyrics.*` / `mv.synced.*`），音频缓存在 IndexedDB（`mv-cache`）；都可以在「设置 → 清除缓存」删除。
- 仓库中的测试、示例、文档只使用虚构的占位歌词。
- 视觉风格受 P5 启发，但所有图形均为原创：人物是无脸剪影，标志是原创的「被斜线贯穿的五角星」，不使用任何游戏角色、面具、Logo 或界面素材。

## 文件结构

```
mv/
  index.html          页面（按固定顺序加载所有脚本）
  css/app.css         界面样式（菜单、控制条、面板、提示）
  css/sync.css        对轴编辑器样式
  js/core.js          公共命名空间、调色板、字体、数学/随机、绘图工具、注册表
  data/*.js           时间轴预设（不含歌词）
  js/analysis.js      离线音频分析：节拍、段落、与预设对齐
  js/audio.js         播放时钟、解码、IndexedDB 缓存
  js/lyrics.js        歌词解析（纯文本 / LRC / 预设匹配）与样式分配
  js/render/*.js      场景、歌词字效、转场与特效、HUD、WebGL 后期
  js/director.js      时间线：把特征 + 歌词编排成每一帧的状态
  js/stage.js         合成一帧
  js/export.js        WebCodecs + mp4-muxer 导出（MediaRecorder 兜底）
  js/sync.js          对轴编辑器
  js/app.js           界面、自动载入、快捷键、渲染循环、测试 API
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
# 只跑一部分：--only=boot,keys,drop,mobile,params,persist,missing,real
```

截图输出到 `mv/out/app-ui/`。测试可以通过环境变量 `MV_LYRICS` 读取仓库外的本地歌词文件，只打印数量、不打印内容。
页面对测试暴露 `window.MV.app`：`loadAudioURL(url)`、`setLyricsText(text)`、`renderAt(t)`、`play()`、`pause()`、`seek(t)`、`getState()`、`exportVideo(opts)`。

---

## English summary

A browser-only, audio-reactive music-video engine with an original, Persona-5-*inspired* red/black/white graphic style.
Open `mv/index.html` (best via `python3 -m http.server --directory mv`), drop or pick your audio file, paste lyrics in the
**LYRICS** panel, then **PLAY**, fine-tune timing with **SYNC**, and **EXPORT** an MP4 (WebCodecs; realtime MediaRecorder
fallback, WebM when MP4 can't be encoded). The built-in preset maps the 221.27 s recording of *Hoshi to Bokura to*; lines 6–10 of
the published lyrics are not sung in this recording and are never shown. No lyric text or audio is stored in the repository:
lyrics live only in your browser's localStorage, and everything in `mv/assets/` (except its README) is git-ignored.
Keys: Space play/pause · ←/→ ±5 s · F fullscreen · H hide UI · M menu · L lyrics · S sync · E export · [ ] lyric offset · D debug.

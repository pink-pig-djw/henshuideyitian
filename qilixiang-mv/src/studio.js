// studio.js — the lyric studio: import audio + lyrics, sync, style, preview, export.
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const TPL = window.MV_TEMPLATE;
  const STORE = 'qlx-studio-v1';
  const SAMPLE = [
    '# 示例歌词：下面这些句子只用来演示效果，请换成你自己的歌词',
    '# 一行一句；空行和以 # 开头的行会被忽略',
    '这是一句示例歌词',
    '把你的歌词粘贴到这里',
    '每一行对应歌里的一句',
    '唱到哪个字就写到哪个字',
    '写到{麻雀}会跳出一只小麻雀',
    '写到{夏天}会画出一个小太阳',
    '用大括号圈出{关键词}',
    '关键词模式下只写圈出的词',
    '写到{草莓}会冒出一颗草莓',
    '每行字数和原曲一样时对得最准',
    '对不准可以在对时页微调',
    '也可以边听边按空格打点',
    '写到{雨}字会有雨滴落下',
    '写到{落叶}会飘下两片叶子',
    '歌词位置会跟着画面构图变化',
    '也可以统一放在画面底部',
    '字体和字号都可以换',
    '换好以后点应用歌词',
    '预览满意了再去导出',
    '示例歌词第二十句',
    '示例歌词第二十一句',
    '写到{稻穗}会长出几根稻穗',
    '写到{番茄}会滚出一颗番茄',
    '写到{七里香}会开出小白花',
    '示例歌词第二十五句',
    '示例歌词第二十六句',
    '示例歌词第二十七句',
    '示例歌词第二十八句',
    '示例歌词第二十九句',
    '示例歌词第三十句',
    '写到{蝴蝶}会飞出一只蝴蝶',
    '示例歌词第三十二句',
    '示例歌词第三十三句',
    '示例歌词第三十四句',
    '写到{永远}会画一道红线',
    '写到{了解}会被红笔圈起来',
  ].join('\n');

  const S = {
    raw: SAMPLE, isSample: true, source: 'template', offset: 0, lines: [], parsed: null,
    options: { reveal: 'line', mode: 'lines', position: 'scene', font: 'WenKai', scale: 1, doodles: true, pencil: false },
    meta: { title: '七里香', tagline: '手绘动画 MV', credit1: '方文山', credit2: '周杰伦' },
  };
  let audio = null; // {buffer, name, duration}
  let dirty = true;

  // ---------- persistence (per-viewer convenience) ----------
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify({ raw: S.raw, isSample: S.isSample, source: S.source, offset: S.offset, lines: S.lines, options: S.options, meta: S.meta })); } catch (e) { /* storage unavailable */ }
  }
  function restore() {
    try { const d = JSON.parse(localStorage.getItem(STORE) || 'null'); if (d && typeof d.raw === 'string') { const opts = Object.assign({}, S.options, d.options || {}); Object.assign(S, d); S.options = opts; } } catch (e) { /* ignore */ }
  }

  // ---------- lyrics → timed lines ----------
  function timeLines(parsed, source) {
    if (source === 'lrc' && parsed.isLRC) return { lines: TIMING.fromLRC(parsed.lines, MV.duration), note: `按 LRC 里的时间对齐了 ${parsed.lines.length} 行。` };
    const r = TIMING.fromTemplate(parsed.lines, TPL);
    const { total, templateLines, exact } = r.report;
    let note = `识别到 ${total} 行歌词，按本曲逐字节奏对齐。`;
    if (total === templateLines && exact === total) note += '每行字数都和原曲一致，应该能对得很准。';
    else {
      note += `其中 ${exact} 行字数和原曲一致`;
      if (total !== templateLines) note += `；原曲是 ${templateLines} 行，你的歌词是 ${total} 行，多出或缺少的行可能错位`;
      note += '。对不准的地方可以在「对时」里微调或手动打点。';
    }
    return { lines: r.lines, note, warn: !(total === templateLines && exact === total) };
  }

  function metaForMV() {
    const credits = [];
    if (S.meta.credit1.trim()) credits.push(`作词：${S.meta.credit1.trim()}`);
    if (S.meta.credit2.trim()) credits.push(`作曲：${S.meta.credit2.trim()}`);
    return { title: S.meta.title.trim() || '七里香', tagline: S.meta.tagline.trim(), credits };
  }
  function pushToMV() {
    MV.setMeta(metaForMV());
    MV.setOptions(Object.assign({}, S.options, { offset: S.offset }));
    MV.setLyrics(S.lines);
    dirty = true;
    drawTimeline(); renderRows(); updateChips(); updateModeHint();
    save();
  }

  function applyLyrics(fromUser) {
    S.raw = $('lyrics').value;
    const parsed = TIMING.parse(S.raw);
    S.parsed = parsed;
    if (!parsed.lines.length) { report('没有找到歌词行。请粘贴歌词，一行一句。', true); return; }
    if (fromUser) S.isSample = S.raw === SAMPLE;
    if (parsed.meta.title) { S.meta.title = parsed.meta.title; $('title').value = parsed.meta.title; }
    for (const c of parsed.meta.credits) {
      const m = /^(作词|作曲)：(.+)$/.exec(c);
      if (m) { const k = m[1] === '作词' ? 'credit1' : 'credit2'; S.meta[k] = m[2]; $(k).value = m[2]; }
    }
    if (parsed.isLRC && S.source === 'template' && fromUser) setSource('lrc', true);
    if (!parsed.isLRC && S.source === 'lrc') setSource('template', true);
    const r = timeLines(parsed, S.source === 'tap' ? 'template' : S.source);
    S.lines = r.lines;
    report(r.note, r.warn);
    pushToMV();
  }
  function report(msg, warn) { const el = $('applyReport'); el.textContent = msg; el.className = 'note ' + (warn ? 'warn' : 'ok'); }

  // ---------- player ----------
  let actx = null, srcNode = null, playing = false, tPos = 0, clock0 = 0, t0 = 0;
  const now = () => playing ? clamp(t0 + (audio ? actx.currentTime - clock0 : performance.now() / 1000 - clock0), 0, MV.duration) : tPos;
  function startAudioAt(t) {
    if (!audio) { clock0 = performance.now() / 1000; t0 = t; return; }
    srcNode = actx.createBufferSource(); srcNode.buffer = audio.buffer; srcNode.connect(actx.destination);
    srcNode.start(0, Math.min(t, audio.buffer.duration - .01)); clock0 = actx.currentTime; t0 = t;
  }
  function stopAudio() { if (srcNode) { try { srcNode.stop(); } catch (e) { /* stopped */ } srcNode.disconnect(); srcNode = null; } }
  async function play() {
    if (playing) return;
    if (audio) { if (!actx) actx = new AudioContext(); await actx.resume(); }
    playing = true; startAudioAt(tPos); $('play').textContent = '❚❚'; $('play').setAttribute('aria-label', '暂停');
  }
  function pause() { if (!playing) return; tPos = now(); playing = false; stopAudio(); $('play').textContent = '▶'; $('play').setAttribute('aria-label', '播放'); dirty = true; }
  function seek(t) { t = clamp(t, 0, MV.duration); if (playing) { stopAudio(); startAudioAt(t); } else { tPos = t; } dirty = true; }
  $('play').onclick = () => playing ? pause() : play();

  const fmtClock = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(1).padStart(4, '0')}`;
  let exporting = false, lastRow = -1;
  function loop() {
    if (!exporting) {
      const t = now();
      if (playing || dirty) { try { MV.render(t); } catch (e) { showError(e.message); } dirty = false; }
      if (playing && t >= MV.duration - .05) pause();
      $('clock').textContent = `${fmtClock(t)} / 04:57`;
      drawPlayhead(t);
      highlightRow(t);
    }
    requestAnimationFrame(loop);
  }

  // ---------- timeline ----------
  const tl = $('timeline'); let tlBase = null;
  function tlSize() { const r = tl.getBoundingClientRect(), d = devicePixelRatio || 1; tl.width = Math.max(10, Math.round(r.width * d)); tl.height = Math.round(r.height * d); }
  function drawTimeline() {
    tlSize();
    const c = tl.getContext('2d'), w = tl.width, h = tl.height, d = devicePixelRatio || 1;
    const cs = getComputedStyle(document.documentElement);
    const ink = cs.getPropertyValue('--muted').trim() || '#666', acc = cs.getPropertyValue('--accent').trim() || '#e5b233';
    c.clearRect(0, 0, w, h);
    const X = t => t / MV.duration * w;
    c.globalAlpha = .5; c.fillStyle = ink;
    for (const s of SHOTS) c.fillRect(Math.round(X(s.t0)), 0, Math.max(1, d), h);
    c.globalAlpha = .85; c.fillStyle = acc;
    S.lines.forEach((l, i) => {
      const a = TIMING.lineStart(l) + S.offset, b = TIMING.lineEnd(l) + S.offset;
      c.fillRect(X(a), h * (i % 2 ? .52 : .3), Math.max(2 * d, X(b) - X(a)), h * .18);
    });
    c.globalAlpha = 1;
    tlBase = c.getImageData(0, 0, w, h);
  }
  function drawPlayhead(t) {
    if (!tlBase) return;
    const c = tl.getContext('2d'); c.putImageData(tlBase, 0, 0);
    const x = t / MV.duration * tl.width, d = devicePixelRatio || 1;
    c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#222';
    c.fillRect(x - d, 0, 2 * d, tl.height);
  }
  let scrubbing = false;
  const tlSeek = e => { const r = tl.getBoundingClientRect(); seek((e.clientX - r.left) / r.width * MV.duration); };
  tl.addEventListener('pointerdown', e => { scrubbing = true; tl.setPointerCapture(e.pointerId); tlSeek(e); });
  tl.addEventListener('pointermove', e => { if (scrubbing) tlSeek(e); });
  tl.addEventListener('pointerup', () => { scrubbing = false; });
  addEventListener('resize', () => drawTimeline());

  // ---------- rows (sync table) ----------
  function renderRows() {
    const tb = $('rows'); tb.textContent = '';
    S.lines.forEach((l, i) => {
      const tr = document.createElement('tr'); tr.dataset.i = i;
      const tdN = document.createElement('td'); tdN.className = 'n'; tdN.textContent = i + 1;
      const tdT = document.createElement('td'); tdT.className = 't';
      const inp = document.createElement('input'); inp.type = 'text'; inp.id = 'start-' + i; inp.value = TIMING.fmt(TIMING.lineStart(l));
      inp.setAttribute('aria-label', `第 ${i + 1} 句开始时间`);
      inp.onchange = () => {
        const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(inp.value.trim());
        const t = m ? +m[1] * 60 + +m[2] : parseFloat(inp.value);
        if (isFinite(t)) { S.lines[i] = TIMING.retimeLine(S.lines[i], t); pushToMV(); } else inp.value = TIMING.fmt(TIMING.lineStart(l));
      };
      tdT.append(inp);
      const tdA = document.createElement('td');
      const nd = document.createElement('span'); nd.className = 'nudge';
      for (const [lab, dt] of [['−0.1', -.1], ['+0.1', .1]]) {
        const b = document.createElement('button'); b.className = 'btn small'; b.textContent = lab;
        b.setAttribute('aria-label', `第 ${i + 1} 句${dt < 0 ? '提前' : '延后'} 0.1 秒`);
        b.onclick = () => { S.lines[i] = TIMING.shiftLine(S.lines[i], dt); pushToMV(); seek(TIMING.lineStart(S.lines[i]) + S.offset - 1); };
        nd.append(b);
      }
      tdA.append(nd);
      const tdX = document.createElement('td'); tdX.className = 'txt'; tdX.textContent = l.text;
      const tdP = document.createElement('td');
      const pb = document.createElement('button'); pb.className = 'btn small'; pb.textContent = '▶'; pb.setAttribute('aria-label', `从第 ${i + 1} 句播放`);
      pb.onclick = () => { seek(TIMING.lineStart(l) + S.offset - 1.2); play(); };
      tdP.append(pb);
      tr.append(tdN, tdT, tdA, tdX, tdP);
      tb.append(tr);
    });
    lastRow = -1;
  }
  function highlightRow(t) {
    let cur = -1;
    S.lines.forEach((l, i) => { if (TIMING.lineStart(l) + S.offset - .3 <= t) cur = i; });
    if (cur === lastRow) return;
    const rows = $('rows').children;
    if (rows[lastRow]) rows[lastRow].classList.remove('cur');
    if (rows[cur]) rows[cur].classList.add('cur');
    lastRow = cur;
  }

  // ---------- tap sync ----------
  let tapIdx = -1;
  function tapMark() {
    if (tapIdx < 0 || tapIdx >= S.lines.length) return;
    const t = now() - S.offset - .12;
    S.lines[tapIdx] = TIMING.retimeLine(S.lines[tapIdx], t);
    const prev = S.lines[tapIdx - 1];
    if (prev && TIMING.lineEnd(prev) > t - .15) S.lines[tapIdx - 1] = TIMING.retimeLine(prev, TIMING.lineStart(prev), Math.max(TIMING.lineStart(prev) + .3, t - .2));
    tapIdx++;
    pushToMV();
    markTapRow();
    if (tapIdx >= S.lines.length) stopTap('全部打完了。可以在表格里继续微调。');
  }
  function markTapRow() {
    for (const r of $('rows').children) r.classList.toggle('tapnext', +r.dataset.i === tapIdx);
    $('tapInfo').textContent = tapIdx >= 0 && tapIdx < S.lines.length ? `下一句：第 ${tapIdx + 1} 句` : '';
    const r = $('rows').children[tapIdx]; if (r) r.scrollIntoView({ block: 'nearest' });
  }
  function stopTap(msg) {
    tapIdx = -1; markTapRow(); $('tapBtn').disabled = true; $('tapStop').disabled = true; $('tapStart').disabled = false;
    if (msg) $('tapInfo').textContent = msg;
  }
  $('tapStart').onclick = () => {
    if (!audio) { $('tapInfo').textContent = '先在第 1 步选择音频文件，打点需要边听边按。'; return; }
    tapIdx = 0; markTapRow(); $('tapBtn').disabled = false; $('tapStop').disabled = false; $('tapStart').disabled = true;
    seek(0); play();
  };
  $('tapStop').onclick = () => { pause(); stopTap(); };
  $('tapBtn').onclick = tapMark;

  // ---------- keyboard ----------
  addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'textarea' || (tag === 'input' && e.target.type === 'text')) return;
    if (e.code === 'Space') { e.preventDefault(); if (tapIdx >= 0) tapMark(); else (playing ? pause() : play()); }
    else if (e.code === 'ArrowLeft') seek(now() - 5);
    else if (e.code === 'ArrowRight') seek(now() + 5);
  });

  // ---------- inputs ----------
  function setSource(v, silent) {
    S.source = v;
    for (const r of document.querySelectorAll('input[name="source"]')) r.checked = r.value === v;
    $('tapBox').hidden = v !== 'tap';
    $('sourceHint').textContent = v === 'template' ? '按这支 MV 参考录音（4:57）里每个字的实际唱出时间，把你的歌词逐行对上去。每行字数和原曲一致时最准。'
      : v === 'lrc' ? '使用 LRC 歌词里每行的时间标签，一行里的字按节奏均匀写出。带逐字标签的 LRC 会更准。'
        : '边听边按：每句开口时按一下，句内的字沿用原来的节奏。';
    if (!silent && S.parsed) {
      if (v === 'lrc' && !S.parsed.isLRC) { report('当前歌词里没有 LRC 时间标签，已保留原来的时间。', true); return; }
      if (v !== 'tap') { const r = timeLines(S.parsed, v); S.lines = r.lines; report(r.note, r.warn); pushToMV(); }
    }
    save();
  }
  for (const r of document.querySelectorAll('input[name="source"]')) r.onchange = () => setSource(r.value);
  $('offset').oninput = () => { S.offset = +$('offset').value; $('offsetVal').textContent = `${S.offset >= 0 ? '+' : ''}${S.offset.toFixed(2)} 秒`; pushToMV(); };
  for (const name of ['reveal', 'mode', 'position']) for (const r of document.querySelectorAll(`input[name="${name}"]`)) r.onchange = () => { S.options[name] = r.value; pushToMV(); };
  $('font').onchange = () => { S.options.font = $('font').value; pushToMV(); };
  $('scale').oninput = () => { S.options.scale = +$('scale').value; $('scaleVal').textContent = `${Math.round(S.options.scale * 100)}%`; pushToMV(); };
  $('doodles').onchange = () => { S.options.doodles = $('doodles').checked; pushToMV(); };
  $('pencil').onchange = () => { S.options.pencil = $('pencil').checked; pushToMV(); };
  for (const k of ['title', 'tagline', 'credit1', 'credit2']) $(k).oninput = () => { S.meta[k] = $(k).value; pushToMV(); };
  function updateModeHint() {
    const n = S.lines.reduce((a, l) => a + ((l.kw && l.kw.length) ? 1 : 0), 0);
    $('modeHint').textContent = n ? `有 ${n} 句圈出了关键词。` : '还没有圈出关键词。在歌词里用 {大括号} 圈出词语后，才能用「只写关键词」。';
  }

  // tabs
  const tabs = ['lyrics', 'timing', 'style', 'export'];
  function showTab(name) {
    for (const t of tabs) { $('tab-' + t).setAttribute('aria-selected', String(t === name)); $('pane-' + t).hidden = t !== name; }
    if (name === 'timing') renderRows();
  }
  for (const t of tabs) $('tab-' + t).onclick = () => showTab(t);

  // ---------- files ----------
  $('pickAudio').onclick = () => $('audioFile').click();
  $('audioFile').onchange = async () => {
    const f = $('audioFile').files[0]; if (!f) return;
    $('audioInfo').textContent = '正在解码音频……';
    try {
      if (!actx) actx = new AudioContext();
      const buffer = await actx.decodeAudioData(await f.arrayBuffer());
      pause();
      audio = { buffer, name: f.name, duration: buffer.duration };
      const d = buffer.duration, diff = Math.abs(d - TPL.duration);
      $('audioInfo').textContent = `${f.name} · ${fmtClock(d)}` + (diff > 1.5 ? ' · 时长和这支 MV 的 4:57 不同，画面会错位' : '');
      $('badge').textContent = diff > 1.5 ? '音频时长不一致，画面可能错位' : '已载入音频';
      setTimeout(() => { $('badge').hidden = true; }, 3000);
      updateChips();
    } catch (e) {
      $('audioInfo').textContent = '无法读取这个音频文件，请换成 MP3、M4A 或 WAV。';
    }
    $('audioFile').value = '';
  };
  $('pickLyrics').onclick = () => $('lyricsFile').click();
  $('lyricsFile').onchange = async () => {
    const f = $('lyricsFile').files[0]; if (!f) return;
    const text = await f.text();
    $('lyricsFile').value = '';
    if (/\.json$/i.test(f.name)) {
      try {
        const p = JSON.parse(text);
        if (!Array.isArray(p.lines)) throw new Error('bad');
        S.lines = p.lines; S.raw = p.raw || p.lines.map(l => l.text).join('\n'); S.isSample = false;
        if (p.options) Object.assign(S.options, p.options);
        if (p.offset != null) S.offset = p.offset;
        if (p.studioMeta) Object.assign(S.meta, p.studioMeta);
        syncControls(); $('lyrics').value = S.raw; S.parsed = TIMING.parse(S.raw);
        report(`已导入工程：${S.lines.length} 句歌词和它们的时间。`, false);
        pushToMV();
      } catch (e) { report('这个 .json 不是本工坊保存的工程文件。', true); }
      return;
    }
    $('lyrics').value = text; applyLyrics(true);
  };
  $('apply').onclick = () => applyLyrics(true);
  $('clearLyrics').onclick = () => { $('lyrics').value = ''; $('lyrics').focus(); };

  function updateChips() {
    const a = $('chipAudio'), l = $('chipLyrics');
    a.className = 'chip ' + (audio ? (Math.abs(audio.duration - TPL.duration) > 1.5 ? 'warn' : 'ok') : '');
    a.lastChild.textContent = audio ? `音频：${audio.name}` : '音频：未载入';
    l.className = 'chip ' + (S.isSample ? 'demo' : 'ok');
    l.lastChild.textContent = S.isSample ? '歌词：示例' : `歌词：${S.lines.length} 句`;
  }

  // ---------- saving files ----------
  let downloads = null;
  (async () => { try { downloads = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { downloads = null; } })();
  async function offer(filename, data, infoEl) {
    if (downloads) {
      try { await downloads.save({ filename, data }); if (infoEl) infoEl.textContent = '已交给浏览器保存。'; return; }
      catch (e) { if (infoEl) infoEl.textContent = e && e.code === 'declined' ? '已取消保存。' : '这里暂时不能保存文件。'; return; }
    }
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (infoEl) infoEl.textContent = '已开始下载。';
  }
  const baseName = () => (S.meta.title.trim() || 'MV').replace(/[\\/:*?"<>|]/g, '');
  $('saveProject').onclick = () => {
    const project = { version: 1, meta: metaForMV(), studioMeta: S.meta, options: Object.assign({}, S.options, { offset: S.offset }), offset: S.offset, raw: S.raw,
      lines: S.lines.map(l => ({ text: l.text, kw: l.kw || [], chars: l.chars.map(c => ({ c: c.c, t: +(c.t).toFixed(3) })) })) };
    offer(`${baseName()}-歌词工程.json`, new Blob([JSON.stringify(project, null, 1)], { type: 'application/json' }), $('saveInfo'));
  };
  $('saveLrc').onclick = () => offer(`${baseName()}-歌词时间轴.txt`, new Blob([TIMING.toLRC(S.lines.map(l => TIMING.shiftLine(l, S.offset)), metaForMV())], { type: 'text/plain' }), $('saveInfo'));

  // ---------- export ----------
  let lastBlob = null, abort = null;
  $('exportBtn').onclick = async () => {
    if (!EXPORTER.supported()) { $('exportStats').textContent = '这个浏览器不支持在网页里编码视频。请用电脑版 Chrome、Edge 或 Safari 17 以上。'; return; }
    if (!audio) $('exportStats').textContent = '提示：还没有载入音频，导出的视频会是无声的。';
    pause(); exporting = true; abort = new AbortController();
    $('exportBtn').disabled = true; $('cancelBtn').hidden = false; $('saveRow').hidden = true; $('bar').style.width = '0%';
    const res = document.querySelector('input[name="res"]:checked').value === '720' ? [1280, 720] : [1920, 1080];
    const clip = document.querySelector('input[name="range"]:checked').value === 'clip';
    const from = clip ? Math.max(0, Math.min(tPos, MV.duration - 20)) : 0, to = clip ? from + 20 : MV.duration;
    try {
      const r = await EXPORTER.run({ audio: audio && audio.buffer, width: res[0], height: res[1], from, to, signal: abort.signal,
        onProgress: (p, i) => { $('bar').style.width = `${(p * 100).toFixed(1)}%`; $('exportStats').textContent = `${(p * 100).toFixed(1)}%  ·  第 ${i.frame} / ${i.total} 帧  ·  ${i.fps.toFixed(1)} 帧/秒  ·  还需约 ${Math.ceil(i.eta / 60)} 分钟`; } });
      lastBlob = r.blob;
      $('exportStats').textContent = `完成：${(r.blob.size / 1048576).toFixed(1)} MB · 视频 ${r.video} · 音频 ${r.audio || '无'}`;
      $('saveRow').hidden = false; $('saveInfo').textContent = '';
    } catch (e) {
      $('exportStats').textContent = e && e.name === 'AbortError' ? '已取消导出。' : `导出失败：${e && e.message ? e.message : e}`;
    } finally {
      exporting = false; dirty = true; $('exportBtn').disabled = false; $('cancelBtn').hidden = true;
    }
  };
  $('cancelBtn').onclick = () => abort && abort.abort();
  $('saveMp4').onclick = () => lastBlob && offer(`${baseName()}-手绘MV-歌词版.mp4`, lastBlob, $('saveInfo'));

  // ---------- errors: show them on the preview so a blank screen explains itself ----------
  function showError(msg) { const el = $('badge'); el.hidden = false; el.textContent = `画面出错：${msg}`; el.style.background = 'rgba(160,40,30,.85)'; }
  addEventListener('error', e => showError(e.message || String(e.error)));
  addEventListener('unhandledrejection', e => showError((e.reason && e.reason.message) || String(e.reason)));

  // ---------- boot ----------
  function syncControls() {
    for (const name of ['reveal', 'mode', 'position']) for (const r of document.querySelectorAll(`input[name="${name}"]`)) r.checked = r.value === S.options[name];
    $('font').value = S.options.font; $('scale').value = S.options.scale; $('scaleVal').textContent = `${Math.round(S.options.scale * 100)}%`;
    $('doodles').checked = S.options.doodles; $('pencil').checked = S.options.pencil;
    $('offset').value = S.offset; $('offsetVal').textContent = `${S.offset >= 0 ? '+' : ''}${(+S.offset).toFixed(2)} 秒`;
    for (const k of ['title', 'tagline', 'credit1', 'credit2']) $(k).value = S.meta[k];
    setSource(S.source, true);
  }
  window.STUDIO = { state: S, apply: applyLyrics, seek, get audio() { return audio; }, set audio(a) { audio = a; updateChips(); } };
  restore();
  $('lyrics').value = S.raw;
  syncControls();
  MV.ready.catch(e => showError('初始化失败 ' + (e && e.message))).then(() => {
    S.parsed = TIMING.parse(S.raw);
    if (!S.lines || !S.lines.length) { const r = timeLines(S.parsed, S.source === 'lrc' && S.parsed.isLRC ? 'lrc' : 'template'); S.lines = r.lines; }
    if (S.isSample) report('现在显示的是示例歌词。粘贴你的歌词后点「应用歌词」。', false);
    else report(`已恢复上次的歌词：${S.lines.length} 句。`, false);
    tPos = 31; // open on a scene with lyrics on screen
    pushToMV();
    requestAnimationFrame(loop);
  });
})();

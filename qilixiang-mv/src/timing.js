// timing.js — turn imported lyrics into per-character timing.
// Accepts plain text (one line per sung line) or LRC ([mm:ss.xx] line tags, optional
// <mm:ss.xx> word tags). Words wrapped in {braces} or 【brackets】 are keywords.
// Timing sources: LRC tags, the MV's reference-recording template, or tapped line starts.
'use strict';
const TIMING = (() => {
  const TAG = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
  const WORD = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g;
  const META_RE = /^\s*(歌曲|歌名|曲名|标题|作词|词|作曲|曲|编曲|演唱|原唱)\s*[:：]\s*(.+)$/;
  const toSec = (m, s) => +m * 60 + parseFloat(String(s).replace(':', '.'));
  const isBlank = c => !c || c.trim() === '';

  // strip keyword markers, returning clean text and keyword ranges (in characters)
  function keywords(raw) {
    const out = [], kw = [];
    let open = -1;
    for (const ch of [...raw]) {
      if (ch === '{' || ch === '【') { open = out.length; continue; }
      if ((ch === '}' || ch === '】') && open >= 0) { if (out.length > open) kw.push([open, out.length - open]); open = -1; continue; }
      out.push(ch);
    }
    return { text: out.join(''), kw };
  }

  // parse pasted lyrics / LRC. Returns {lines:[{text, kw, start?, words?}], meta, isLRC}
  function parse(src) {
    const meta = { title: '', credits: [] };
    const lines = [];
    let isLRC = false;
    const rows = String(src || '').replace(/\r/g, '').split('\n');
    for (let row of rows) {
      if (/^\s*#/.test(row)) continue;                                        // comments
      const tagMeta = /^\s*\[(ti|ar|al|by|offset|length|re|ve):([^\]]*)\]\s*$/i.exec(row);
      if (tagMeta) { if (tagMeta[1].toLowerCase() === 'ti') meta.title = tagMeta[2].trim(); continue; }
      const stamps = [];
      row = row.replace(TAG, (_, m, s) => { stamps.push(toSec(m, s)); return ''; });
      if (stamps.length) isLRC = true;
      // word-level tags: remember the time at which each following character starts
      const wordTimes = [];
      let plain = '';
      let pos = 0; WORD.lastIndex = 0; let mm;
      while ((mm = WORD.exec(row))) { plain += row.slice(pos, mm.index); wordTimes.push([[...plain].length, toSec(mm[1], mm[2])]); pos = mm.index + mm[0].length; }
      plain += row.slice(pos);
      const text0 = plain.replace(/\s+/g, ' ').trim();
      if (!text0) continue;
      const m = META_RE.exec(text0);
      if (m && !stamps.length && lines.length === 0) {
        const key = m[1];
        if (/歌曲|歌名|曲名|标题/.test(key)) meta.title = m[2].trim();
        else meta.credits.push(`${/^词$/.test(key) ? '作词' : /^曲$/.test(key) ? '作曲' : key}：${m[2].trim()}`);
        continue;
      }
      if (m && stamps.length && /作词|作曲|词|曲|编曲/.test(m[1]) && lines.length < 3) { meta.credits.push(`${m[1]}：${m[2].trim()}`); continue; }
      const { text, kw } = keywords(text0);
      if (!text.trim()) continue;
      const entry = { text, kw };
      if (wordTimes.length) entry.words = wordTimes;
      if (stamps.length) for (const t of stamps) lines.push(Object.assign({}, entry, { start: t }));
      else lines.push(entry);
    }
    if (isLRC) { for (let k = lines.length - 1; k >= 0; k--) if (lines[k].start == null) lines.splice(k, 1); lines.sort((a, b) => a.start - b.start); }
    return { lines, meta, isLRC };
  }

  // spread characters of one line between start and end, following an optional rhythm
  function spread(text, start, end, rhythm) {
    const chars = [...text], n = chars.length, out = [];
    const slots = chars.map(c => !isBlank(c));
    const nv = slots.filter(Boolean).length || 1;
    let v = 0;
    for (let k = 0; k < n; k++) {
      let u = nv > 1 ? v / (nv - 1) : 0;
      if (rhythm && rhythm.length > 1) { // borrow the template's inner rhythm
        const q = u * (rhythm.length - 1), i = Math.floor(q), f = q - i;
        const r0 = rhythm[i], r1 = rhythm[Math.min(rhythm.length - 1, i + 1)];
        u = (lerp(r0, r1, f) - rhythm[0]) / Math.max(1e-6, rhythm[rhythm.length - 1] - rhythm[0]);
      }
      out.push({ c: chars[k], t: +(start + (end - start) * u).toFixed(3) });
      if (slots[k]) v++;
    }
    // blanks take the time of the next character
    for (let k = n - 2; k >= 0; k--) if (!slots[k]) out[k].t = out[k + 1].t;
    return out;
  }

  // map lines onto the reference template: line i -> template line i, characters by proportion
  function fromTemplate(lines, tpl) {
    const T = tpl.lines, res = [];
    const report = { matched: 0, total: lines.length, templateLines: T.length, exact: 0 };
    lines.forEach((l, i) => {
      const chars = [...l.text];
      if (i < T.length) {
        const slots = T[i];
        report.matched++;
        if (slots.length === chars.length) report.exact++;
        const n = chars.length, m = slots.length;
        const out = chars.map((c, k) => ({ c, t: slots[Math.round(n > 1 ? k * (m - 1) / (n - 1) : 0)] }));
        for (let k = 1; k < n; k++) if (out[k].t < out[k - 1].t) out[k].t = out[k - 1].t;
        res.push({ text: l.text, chars: out, kw: l.kw && l.kw.length ? l.kw : (slots.length === chars.length ? (tpl.kw[i] || []) : []) });
      } else {
        // beyond the template: continue after the last line at a gentle pace
        const prev = res[res.length - 1];
        const s = prev ? prev.chars[prev.chars.length - 1].t + 1.2 : 0;
        res.push({ text: l.text, chars: spread(l.text, s, s + chars.length * .35), kw: l.kw || [] });
      }
    });
    return { lines: res, report };
  }

  // LRC: line starts (and optional word tags); characters interpolated up to the next line
  function fromLRC(lines, duration) {
    const res = [];
    lines.forEach((l, i) => {
      const start = l.start ?? 0;
      const next = lines[i + 1] ? lines[i + 1].start : Math.min(duration || start + 8, start + 8);
      const n = [...l.text].filter(c => !isBlank(c)).length;
      const end = Math.max(start + .3, Math.min(next - .35, start + n * .42));
      let chars = spread(l.text, start, end);
      if (l.words && l.words.length) { // exact word starts where provided
        for (const [idx, t] of l.words) if (chars[idx]) chars[idx].t = t;
        for (let k = 1; k < chars.length; k++) if (chars[k].t < chars[k - 1].t) chars[k].t = chars[k - 1].t;
      }
      res.push({ text: l.text, chars, kw: l.kw || [] });
    });
    return res;
  }

  // retime one line to a new start (tapping / nudging), keeping its inner rhythm
  function retimeLine(line, start, end) {
    const vis = line.chars.filter(c => !isBlank(c.c));
    const rh = vis.map(c => c.t);
    const oldDur = rh.length > 1 ? rh[rh.length - 1] - rh[0] : 0;
    const e = end != null ? end : start + Math.max(.3, oldDur);
    return Object.assign({}, line, { chars: spread(line.text, start, e, rh.length > 1 ? rh : null) });
  }
  function shiftLine(line, dt) { return Object.assign({}, line, { chars: line.chars.map(c => ({ c: c.c, t: +(c.t + dt).toFixed(3) })) }); }
  const lineStart = l => { const v = l.chars.find(c => !isBlank(c.c)); return v ? v.t : 0; };
  const lineEnd = l => { const v = l.chars.filter(c => !isBlank(c.c)); return v.length ? v[v.length - 1].t : 0; };

  function fmt(t) { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`; }
  function toLRC(lines, meta) {
    const head = [];
    if (meta && meta.title) head.push(`[ti:${meta.title}]`);
    return head.concat(lines.map(l => `[${fmt(lineStart(l))}]${l.text}`)).join('\n') + '\n';
  }
  return { parse, fromTemplate, fromLRC, retimeLine, shiftLine, lineStart, lineEnd, spread, fmt, toLRC, keywords };
})();

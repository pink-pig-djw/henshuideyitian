/*
 * MV.Lyrics — turns user-pasted lyric text into a timed LyricTrack
 * (see docs/ARCHITECTURE.md §2.3 and §3.3).
 *
 *   MV.Lyrics.parse(text, { preset, features, offset }) → LyricTrack
 *   MV.Lyrics.assignStyles(track, features)             → track (fills missing styles)
 *   MV.Lyrics.toLRC(track)                              → string (line + enhanced phrase stamps + {style})
 *   MV.Lyrics.isMetaLine(str)                           → bool   (credits / title / bracket lines)
 *   MV.Lyrics.activeLines(track, t)                     → [Line]
 *   MV.Lyrics.withTimes(track, fn)                      → LyricTrack clone with remapped times
 *
 * Extensions (used by the sync editor, safe for anyone):
 *   MV.Lyrics.clone(track), MV.Lyrics.refresh(track), MV.Lyrics.detectMode(text)
 *
 * Three modes:
 *  - preset: pasted lines are matched to preset.lines by MV.lyricKey (weighted
 *    sequence alignment, so repeated chorus lines and unsung `skip` lines land
 *    on the right preset line). Preset lines without a key match fall back to
 *    order-based mapping of the remaining pasted lines (phrase offsets by ratio,
 *    snapped to spaces / script changes). A preset line whose text was pasted
 *    only once (repeat not written out) reuses that text.
 *  - lrc: [mm:ss.xx] (multi-stamp), [offset:±ms], [ti:], [ar:], enhanced
 *    <mm:ss.xx> phrase stamps (a trailing stamp = line end), blank stamped
 *    line = end marker, leading {style} tag.
 *  - auto: plain text without a usable preset: lines are spread by character
 *    count over the vocal sections and snapped to downbeats (warning emitted).
 *
 * Pure data code: no DOM access, no randomness, no clocks. Never embeds lyric
 * text (warnings reference line numbers only).
 */
(function () {
  'use strict';

  const MV = (window.MV = window.MV || {});

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */
  const LEAD_IN = 0.3; //          default seconds a line shows before it is sung
  const SHOW_TAIL = 1.2; //        provisional showEnd = end + SHOW_TAIL …
  const SHOW_GAP = 0.05; //        … but at most next.showStart - SHOW_GAP
  const REVEAL = 0.55; //          chars revealed across this fraction of a phrase
  const REVEAL_CAP = 0.9; //       never reveal later than this fraction
  const MIN_STEP = 0.06; //        preferred min seconds per revealed unit
  const MIN_LAST = 0.2; //         min duration of the last phrase of a line
  const NON_VOCAL = new Set(['intro', 'interlude', 'outro']);
  const KIND_EMPHASIS = {
    intro: 0.3, verse: 0.35, pre: 0.55, chorus: 0.8, hook: 0.95, interlude: 0.5,
    bridge: 0.3, build: 0.6, climax: 1.0, outro: 0.35,
  };

  const ZW_RE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
  const NON_KEY_RE = /[\s\p{P}\p{S}]/u;
  const LATIN_CH_RE = /[A-Za-z0-9'’]/;
  const OPENERS = '([{（［｛【〔〈《＜<〖〘';
  const CLOSERS = ')]}）］｝】〕〉》＞>〗〙';

  // Credit words that, followed by a colon (half or full width), mark a header line.
  const CREDIT_WORDS = [
    '作詞', '作词', '作曲', '編曲', '编曲', '歌手', '歌', '唄', '演唱', '原唱', '翻唱', '歌詞', '歌词',
    '詞', '词', '曲', '詞曲', '词曲', '作詞作曲', '作词作曲', '作詞・作曲', '監督', '制作', '製作',
    '制作人', '出品', '发行', '發行', '专辑', '專輯', '曲名', '歌名', '标题', '標題', 'タイトル',
    'アーティスト', 'ボーカル', '翻訳', '翻译', '翻譯', '訳', '译', '和声', '混音', '母带', '吉他', '贝斯',
    '鼓', '键盘', '弦乐', '出典', '原作', '来源', '來源',
    'vocals?', 'lyrics?', 'lyricist', 'music', 'composer', 'composition', 'composed', 'arrange',
    'arranged', 'arranger', 'arrangement', 'singer', 'artist', 'words', 'title', 'album', 'producer',
    'produced', 'mix', 'mixing', 'mastering', 'guitar', 'bass', 'drums', 'piano', 'keyboards?',
    'strings', 'source', 'translation', 'translator', 'original', 'performed', 'written',
  ].join('|');
  const CREDIT_RE = new RegExp(
    '^\\s*(?:' + CREDIT_WORDS + ')(?:\\s*(?:[・/／&＆、,，+＋]|and)\\s*(?:' + CREDIT_WORDS + '))*\\s*(?:by\\s*)?[:：]',
    'i'
  );
  const BY_RE = /^\s*(?:words|lyrics|music|composed|arranged|written|produced|performed|sung)(?:\s+and\s+\w+)?\s+by\s+\S/i;
  const SECTION_RE = /^\s*(?:intro|verse|pre-?chorus|chorus|hook|bridge|outro|interlude|refrain|break|drop|coda|solo|instrumental|间奏|間奏|副歌|主歌|前奏|尾奏|桥段|サビ|[ABC]メロ)\s*\d*\s*[:：]?\s*(?:[x×]\s*\d+)?\s*$/i;
  const LRC_TAG_RE = /^\s*\[([A-Za-z#][\w#-]*)\s*:([^\]]*)\]\s*$/;
  const LRC_STAMP_RE = /^\s*\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/;
  const ENH_LEAD_RE = /^\s*<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/;
  const ENH_RE = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g;
  const STYLE_TAG_RE = /^\s*\{([A-Za-z][\w-]*)\}/;

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const chars = (s) => Array.from(s || '');
  const isKeyChar = (ch) => !NON_KEY_RE.test(String(ch).normalize('NFKC'));
  const isLatinCh = (ch) => LATIN_CH_RE.test(ch);
  const isLatin = (s) => (MV.text && MV.text.isLatin ? MV.text.isLatin(s) : /^[\x00-\x7F‘’“”]+$/.test(s || ''));
  const nonSpaceCount = (arr) => {
    let n = 0;
    for (let i = 0; i < arr.length; i++) if (arr[i] !== ' ') n++;
    return n;
  };
  const fin = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);

  function resolvePreset(p) {
    if (!p) return null;
    if (typeof p === 'string') return MV.getPreset ? MV.getPreset(p) : null;
    return p && Array.isArray(p.lines) ? p : null;
  }

  // Strip markdown emphasis / quote / bullet markers and invisible chars.
  function cleanRaw(s) {
    let x = String(s == null ? '' : s).replace(ZW_RE, '');
    x = x.replace(/\*\*|__/g, '');
    x = x.replace(/^\s*(?:>\s*)+/, '');
    x = x.replace(/^\s*[-*+•]\s+/, '');
    x = x.replace(/^\s*\*(\S(?:.*\S)?)\*\s*$/, '$1'); // *italic line*
    x = x.replace(/\\\s*$/, ''); //                  markdown hard break
    return x;
  }

  // True when the whole string is one bracket group: "(…)", "（《…》…）", "[Chorus]".
  // Japanese quote brackets 「」『』 are deliberately not included (they can be lyrics).
  function isWrapped(s) {
    const c = chars(String(s).trim());
    if (c.length < 2) return false;
    if (OPENERS.indexOf(c[0]) < 0 || CLOSERS.indexOf(c[c.length - 1]) < 0) return false;
    let depth = 0;
    for (let i = 0; i < c.length; i++) {
      if (OPENERS.indexOf(c[i]) >= 0) depth++;
      else if (CLOSERS.indexOf(c[i]) >= 0) {
        depth--;
        if (depth <= 0 && i < c.length - 1) return false;
      }
    }
    return depth === 0;
  }

  // Remove bracket groups (ruby, inline translations): "言葉(ことば)" → "言葉".
  function stripBracketGroups(s) {
    const c = chars(s);
    let depth = 0;
    let out = '';
    for (let i = 0; i < c.length; i++) {
      if (OPENERS.indexOf(c[i]) >= 0) depth++;
      else if (CLOSERS.indexOf(c[i]) >= 0) depth = Math.max(0, depth - 1);
      else if (depth === 0) out += c[i];
    }
    return out;
  }

  function segmentsOf(arr) {
    const segs = [];
    let i = 0;
    while (i < arr.length) {
      while (i < arr.length && arr[i] === ' ') i++;
      if (i >= arr.length) break;
      let j = i;
      while (j < arr.length && arr[j] !== ' ') j++;
      segs.push({ text: arr.slice(i, j).join(''), charStart: i, charEnd: j });
      i = j;
    }
    return segs;
  }

  function toSec(m, s) {
    return (parseInt(m, 10) || 0) * 60 + (parseFloat(String(s).replace(':', '.')) || 0);
  }

  function fmtStamp(t) {
    const cs = Math.max(0, Math.round(fin(t, 0) * 100));
    const m = Math.floor(cs / 6000);
    const s = (cs % 6000) / 100;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }

  /* ------------------------------------------------------------------ */
  /* Meta / header detection                                             */
  /* ------------------------------------------------------------------ */
  /**
   * Is `str` a header / credit / annotation line rather than a sung lyric?
   * Catches: credit lines ("作詞：…", "Vocal: …", "Music by …"), lines fully
   * wrapped in brackets ("（…）", "[Chorus]"), LRC tag lines, markdown headings
   * and rules, section labels, symbol-only lines. With `ctx.first` the line is
   * also treated as a title when it is bold markdown or contains the preset
   * title; with `ctx.preset` a line naming the title + artist is meta too.
   * @param {string} str
   * @param {{first?: boolean, preset?: object, boldCommon?: boolean}} [ctx]
   * @returns {boolean}
   */
  function isMetaLine(str, ctx) {
    ctx = ctx || {};
    const raw = String(str == null ? '' : str).replace(ZW_RE, '');
    const t = raw.trim();
    if (!t) return false;
    if (/^#{1,6}\s/.test(t)) return true; //                     markdown heading
    if (/^(?:[-*_=~—–]\s*){3,}$/.test(t)) return true; //          horizontal rule
    if (LRC_TAG_RE.test(t) && !LRC_STAMP_RE.test(t)) return true; // [ti:…]
    const clean = MV.canonDisplay(cleanRaw(t));
    if (!clean) return true;
    const key = MV.canonKey(clean);
    if (!key) return true; //                                     symbols only
    if (CREDIT_RE.test(clean) || BY_RE.test(clean)) return true;
    if (SECTION_RE.test(clean)) return true;
    if (isWrapped(clean)) return true;
    const preset = resolvePreset(ctx.preset);
    const pm = preset && preset.meta ? preset.meta : null;
    if (ctx.first) {
      if (!ctx.boldCommon && /^\s*(?:\*\*|__)/.test(t)) return true; // **Title**
      if (pm) {
        const tk = MV.canonKey(pm.title || '');
        const tl = MV.canonKey(pm.titleLatin || '');
        if ((tk && key.indexOf(tk) >= 0) || (tl && key.indexOf(tl) >= 0)) return true;
      }
    }
    if (pm) {
      const tk = MV.canonKey(pm.title || '');
      const who = [pm.artist, pm.lyricist, pm.composer].map((x) => MV.canonKey(x || '')).filter(Boolean);
      if (who.indexOf(key) >= 0) return true; //                 a bare name line
      if (tk && key.indexOf(tk) >= 0 && who.some((w) => key.indexOf(w) >= 0)) return true;
    }
    return false;
  }

  // Parse plain text into entries (non-empty lines) with meta classification.
  function collectPlain(rawLines, preset) {
    const presetKeys = preset ? new Set(preset.lines.map((l) => l.key)) : null;
    const entries = [];
    let blank = false;
    let boldLines = 0;
    let nonEmpty = 0;
    rawLines.forEach((raw) => {
      if (!String(raw).trim()) return;
      nonEmpty++;
      if (/^\s*(?:\*\*|__)/.test(raw)) boldLines++;
    });
    const boldCommon = nonEmpty > 2 && boldLines / nonEmpty > 0.5;
    rawLines.forEach((raw, i) => {
      const display = MV.canonDisplay(cleanRaw(raw));
      if (!display) {
        blank = true;
        return;
      }
      const e = {
        lineNo: i + 1, raw, display, key: MV.lyricKey(display), altDisplay: null, altKey: null,
        stanzaBreak: blank && entries.length > 0, meta: false, credit: false,
      };
      blank = false;
      const stripped = MV.canonDisplay(stripBracketGroups(display));
      if (stripped && stripped !== display && MV.canonKey(stripped)) {
        e.altDisplay = stripped;
        e.altKey = MV.lyricKey(stripped);
      }
      e.keyed = !!(presetKeys && (presetKeys.has(e.key) || (e.altKey && presetKeys.has(e.altKey))));
      const clean = MV.canonDisplay(cleanRaw(raw));
      e.credit = CREDIT_RE.test(clean) || BY_RE.test(clean);
      e.meta = !e.keyed && isMetaLine(raw, { first: entries.length === 0, preset, boldCommon });
      entries.push(e);
    });
    // A short first line followed closely by credit lines is a title.
    const f = entries[0];
    if (f && !f.meta && !f.keyed && chars(f.display).length <= 40) {
      for (let k = 1; k < Math.min(entries.length, 4); k++) {
        if (entries[k].credit) {
          f.meta = true;
          break;
        }
      }
    }
    return entries;
  }

  function metaFromEntries(entries, preset) {
    const meta = {};
    if (preset && preset.meta) {
      if (preset.meta.title) meta.title = preset.meta.title;
      if (preset.meta.artist) meta.artist = preset.meta.artist;
    }
    entries.forEach((e, i) => {
      if (!e.meta) return;
      const m = /^\s*(?:歌手|歌|唄|演唱|原唱|vocals?|singer|artist|アーティスト|ボーカル)\s*[:：]\s*(.+)$/i.exec(e.display);
      if (m && !meta.artist) meta.artist = m[1].trim();
      if (i === 0 && !meta.title && !e.credit && !isWrapped(e.display)) {
        const t = MV.canonDisplay(e.display.split(/[（(\[【《〔]/)[0]);
        if (t) meta.title = t;
      }
    });
    return meta;
  }

  /* ------------------------------------------------------------------ */
  /* Line construction & timing refresh                                  */
  /* ------------------------------------------------------------------ */
  // o = { n, id, text, key, phrases:[{charStart, charEnd, start}], end, style, styleSource, match }
  function buildLine(o) {
    const text = MV.canonDisplay(o.text);
    const arr = chars(text);
    const phrases = o.phrases.map((p) => {
      const ptext = arr.slice(p.charStart, p.charEnd).join('');
      return { text: ptext, start: p.start, end: p.start, charStart: p.charStart, charEnd: p.charEnd, latin: isLatin(ptext) };
    });
    const line = {
      id: o.id || 'L' + o.n, n: o.n, index: 0, key: o.key || MV.lyricKey(text),
      text, chars: arr,
      start: phrases.length ? phrases[0].start : 0, end: o.end,
      showStart: 0, showEnd: 0,
      phrases, segments: segmentsOf(arr), charTimes: new Float32Array(arr.length),
      style: o.style || null, styleSource: o.style ? o.styleSource || 'preset' : 'auto',
      emphasis: 0.5, isHook: false, seed: MV.hash32(o.key || MV.lyricKey(text), o.n || 0), sectionKind: o.sectionKind || null,
    };
    if (o.match) line.match = o.match;
    refreshLine(line);
    return line;
  }

  // Phrase ends, line start/end sanity and charTimes (ARCHITECTURE §2.3).
  function refreshLine(line) {
    const ph = line.phrases;
    for (let k = 1; k < ph.length; k++) if (!(ph[k].start >= ph[k - 1].start)) ph[k].start = ph[k - 1].start;
    if (ph.length) line.start = ph[0].start;
    const lastStart = ph.length ? ph[ph.length - 1].start : line.start;
    if (!(line.end >= lastStart + MIN_LAST)) line.end = lastStart + MIN_LAST;
    for (let k = 0; k < ph.length; k++) ph[k].end = k + 1 < ph.length ? ph[k + 1].start : line.end;
    line.charTimes = computeCharTimes(line);
    return line;
  }

  function computeCharTimes(line) {
    const arr = line.chars;
    const out = new Float32Array(arr.length);
    const set = new Uint8Array(arr.length);
    for (const p of line.phrases) {
      const dur = Math.max(0, p.end - p.start);
      // Units: words for Latin phrases, non-space chars otherwise.
      const units = [];
      if (p.latin) {
        let i = p.charStart;
        while (i < p.charEnd) {
          while (i < p.charEnd && arr[i] === ' ') i++;
          if (i >= p.charEnd) break;
          const u = [];
          while (i < p.charEnd && arr[i] !== ' ') u.push(i++);
          units.push(u);
        }
      } else {
        for (let i = p.charStart; i < p.charEnd; i++) if (arr[i] !== ' ') units.push([i]);
      }
      const U = units.length;
      if (!U) continue;
      const span = Math.min(Math.max(MIN_STEP * U, REVEAL * dur), REVEAL_CAP * dur);
      for (let k = 0; k < U; k++) {
        const tk = p.start + (span * k) / U;
        for (const ci of units[k]) {
          out[ci] = tk;
          set[ci] = 1;
        }
      }
    }
    let last = line.phrases.length ? line.phrases[0].start : line.start;
    for (let i = 0; i < arr.length; i++) {
      if (set[i] && arr[i] !== ' ') last = out[i];
      else out[i] = last;
    }
    return out;
  }

  // Provisional visibility windows (the Director may refine them).
  function refreshWindows(track) {
    const lead = fin(track.leadIn, LEAD_IN);
    const lines = track.lines;
    lines.forEach((l) => (l.showStart = l.start - lead));
    const order = lines.slice().sort((a, b) => a.start - b.start || a.index - b.index);
    for (let i = 0; i < order.length; i++) {
      const l = order[i];
      const next = order[i + 1];
      let se = l.end + SHOW_TAIL;
      if (next) se = Math.min(se, next.showStart - SHOW_GAP);
      l.showEnd = Math.max(se, l.start + 0.3);
    }
  }

  /**
   * Recompute derived timing (phrase ends, charTimes, show windows) after
   * phrase starts / line ends were edited in place. Keeps line order.
   * @param {object} track LyricTrack
   * @returns {object} the same track
   */
  function refresh(track) {
    if (!track || !Array.isArray(track.lines)) return track;
    track.lines.forEach((l, i) => {
      l.index = i;
      refreshLine(l);
    });
    refreshWindows(track);
    return track;
  }

  function sectionsFor(opts, preset, offset) {
    const f = opts.features;
    if (f && Array.isArray(f.sections) && f.sections.length) return f.sections;
    if (preset && Array.isArray(preset.sections)) {
      return preset.sections.map((s) => Object.assign({}, s, { start: s.start + offset, end: s.end + offset }));
    }
    return [];
  }

  function sectionOf(sections, a, b) {
    if (!sections.length) return null;
    if (!(b > a)) b = a + 0.01;
    let best = null;
    let bestOv = 0;
    for (const s of sections) {
      const ov = Math.min(b, s.end) - Math.max(a, s.start);
      if (ov > bestOv) {
        bestOv = ov;
        best = s;
      }
    }
    if (best) return best;
    // Outside every section: nearest one.
    let d = Infinity;
    for (const s of sections) {
      const dd = a < s.start ? s.start - a : a - s.end;
      if (dd < d) {
        d = dd;
        best = s;
      }
    }
    return best;
  }

  // sectionKind, isHook, emphasis (+ index order).
  function annotate(track, sections) {
    const counts = new Map();
    track.lines.forEach((l) => counts.set(l.key, (counts.get(l.key) || 0) + 1));
    track.lines.forEach((l) => {
      const s = sectionOf(sections, l.start, l.end);
      if (s) l.sectionKind = s.kind;
      if (!l.sectionKind) l.sectionKind = 'verse';
      l.isHook = (counts.get(l.key) || 0) > 1 || l.sectionKind === 'hook';
      const base = KIND_EMPHASIS[l.sectionKind] != null ? KIND_EMPHASIS[l.sectionKind] : 0.5;
      const inten = s && s.intensity != null ? s.intensity : base;
      l.emphasis = clamp(0.55 * base + 0.45 * inten + (l.isHook ? 0.1 : 0), 0, 1);
    });
  }

  function finishTrack(track, sections, features) {
    track.lines.sort((a, b) => a.start - b.start);
    track.lines.forEach((l, i) => (l.index = i));
    annotate(track, sections);
    refreshWindows(track);
    assignStyles(track, features);
    return track;
  }

  function emptyTrack(source) {
    return {
      source, meta: {}, lines: [], unmatched: [], warnings: [],
      matched: { total: 0, matched: 0, skipped: 0 }, leadIn: LEAD_IN,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Phrase helpers                                                      */
  /* ------------------------------------------------------------------ */
  // Map a preset char offset `at` (into a display string of length L0) onto
  // the pasted text `arr`. keySpace: the texts share the same lyric key, so
  // map by key-char ratio (robust to extra/missing spaces or punctuation).
  function mapOffset(at, L0, arr, keySpace) {
    const L = arr.length;
    if (at <= 0 || L <= 1) return 0;
    let target;
    if (keySpace) {
      const idx = [];
      for (let i = 0; i < L; i++) if (isKeyChar(arr[i])) idx.push(i);
      const K = idx.length;
      target = K ? idx[clamp(Math.round((at * K) / Math.max(1, L0)), 0, K - 1)] : Math.round((at * L) / L0);
    } else {
      target = Math.round((at * L) / Math.max(1, L0));
    }
    target = clamp(target, 1, L - 1);
    // Near-identical text (typo): stay close to the ratio target; clearly
    // different text: snap to a word start within ±12 %.
    const dL = Math.abs(L - L0);
    const win = keySpace ? 1 : dL <= 3 ? Math.max(1, dL) : Math.max(2, Math.round(L * 0.12));
    let best = -1;
    let bestD = Infinity;
    for (let i = Math.max(1, target - win); i <= Math.min(L - 1, target + win); i++) {
      if (arr[i] === ' ') continue;
      const wordStart = arr[i - 1] === ' ';
      const scriptChange = !wordStart && isLatinCh(arr[i]) !== isLatinCh(arr[i - 1]);
      if (!wordStart && !scriptChange) continue;
      const d = Math.abs(i - target) + (wordStart ? 0 : 0.5) + (i < target ? 0.01 : 0);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) return best;
    let i = target;
    while (i < L && arr[i] === ' ') i++;
    return i < L ? i : target;
  }

  // Turn char positions + times into phrase specs covering all non-space chars.
  function phrasesFromPositions(arr, pos, times) {
    const L = arr.length;
    let first = 0;
    while (first < L && arr[first] === ' ') first++;
    const P = [];
    const T = [];
    for (let k = 0; k < pos.length; k++) {
      let p = k === 0 ? first : pos[k];
      if (k > 0) {
        if (p <= P[P.length - 1]) p = P[P.length - 1] + 1;
        while (p < L && arr[p] === ' ') p++;
        if (p >= L) break;
      }
      P.push(p);
      T.push(times[k]);
    }
    const out = [];
    for (let k = 0; k < P.length; k++) {
      let cs = P[k];
      let ce = k + 1 < P.length ? P[k + 1] : L;
      while (cs < ce && arr[cs] === ' ') cs++;
      while (ce > cs && arr[ce - 1] === ' ') ce--;
      if (ce <= cs) continue;
      out.push({ charStart: cs, charEnd: ce, start: T[k] });
    }
    return out;
  }

  // Split a line into phrase chunks (spaces; Latin words grouped; long CJK
  // runs split) and spread their starts over [start, end).
  function distributePhrases(arr, start, end) {
    const segs = segmentsOf(arr);
    const chunks = [];
    for (const s of segs) {
      const latin = isLatin(s.text);
      const prev = chunks[chunks.length - 1];
      if (latin && prev && prev.latin) {
        prev.ce = s.charEnd;
        prev.n += s.charEnd - s.charStart;
        continue;
      }
      const n = s.charEnd - s.charStart;
      if (!latin && n > 12) {
        const parts = Math.ceil(n / 8);
        for (let k = 0; k < parts; k++) {
          const a = s.charStart + Math.round((n * k) / parts);
          const b = s.charStart + Math.round((n * (k + 1)) / parts);
          chunks.push({ cs: a, ce: b, n: b - a, latin: false });
        }
      } else {
        chunks.push({ cs: s.charStart, ce: s.charEnd, n, latin });
      }
    }
    const total = chunks.reduce((a, c) => a + c.n, 0) || 1;
    const span = Math.max(0, end - start) * 0.85;
    let acc = 0;
    return chunks.map((c) => {
      const p = { charStart: c.cs, charEnd: c.ce, start: start + (span * acc) / total };
      acc += c.n;
      return p;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Preset mode                                                         */
  /* ------------------------------------------------------------------ */
  function parsePreset(entries, preset, opts, offset) {
    const track = emptyTrack('preset');
    track.leadIn = fin(preset.leadIn, LEAD_IN);
    track.presetId = preset.id;
    track.offset = offset;
    track.meta = metaFromEntries(entries, preset);
    const warnings = track.warnings;

    const Q = entries.filter((e) => !e.meta);
    const P = preset.lines;
    const m = P.length;
    const n = Q.length;
    const presetKeys = new Set(P.map((p) => p.key));
    const qKeys = new Set();
    Q.forEach((q) => {
      qKeys.add(q.key);
      if (q.altKey) qKeys.add(q.altKey);
    });
    const qLen = Q.map((q) => chars(q.display).length);
    const qOwned = Q.map((q) => presetKeys.has(q.key) || (q.altKey && presetKeys.has(q.altKey)));

    // Pair score: exact key ≫ fuzzy (order) fallback. Fuzzy pairs are only
    // allowed between a preset line whose text is not pasted anywhere and a
    // pasted line that belongs to no preset line.
    const score = new Float64Array(m * Math.max(1, n));
    for (let i = 0; i < m; i++) {
      const p = P[i];
      for (let j = 0; j < n; j++) {
        const q = Q[j];
        let s = 0;
        if (q.key === p.key) s = p.skip ? 600 : 1000;
        else if (q.altKey && q.altKey === p.key) s = p.skip ? 550 : 900;
        else if (!qKeys.has(p.key) && !qOwned[j]) {
          const L0 = p.len || qLen[j];
          const sim = 1 - Math.abs(qLen[j] - L0) / Math.max(qLen[j], L0, 1);
          s = p.skip ? 3 + 3 * sim : 10 + 10 * sim;
        }
        score[i * n + j] = s;
      }
    }
    const W = n + 1;
    const S = new Float64Array((m + 1) * W);
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        let best = Math.max(S[(i - 1) * W + j], S[i * W + j - 1]);
        const sc = score[(i - 1) * n + j - 1];
        if (sc > 0) best = Math.max(best, S[(i - 1) * W + j - 1] + sc);
        S[i * W + j] = best;
      }
    }
    const pair = new Int32Array(m).fill(-1);
    for (let i = m, j = n; i > 0 && j > 0; ) {
      const sc = score[(i - 1) * n + j - 1];
      if (sc > 0 && S[i * W + j] === S[(i - 1) * W + j - 1] + sc) {
        pair[i - 1] = j - 1;
        i--;
        j--;
      } else if (S[i * W + j] === S[(i - 1) * W + j]) i--;
      else j--;
    }

    let exact = 0;
    let fuzzy = 0;
    let skipped = 0;
    let missing = 0;
    const estimated = new Set();
    const used = new Set();
    for (let i = 0; i < m; i++) if (pair[i] >= 0) used.add(pair[i]);

    // Nothing keyed at all: order mapping only makes sense when the line
    // counts are compatible; otherwise fall back to auto timing.
    let anyKey = false;
    for (let i = 0; i < m && !anyKey; i++) if (!P[i].skip && qKeys.has(P[i].key)) anyKey = true;
    const displayCount = P.filter((p) => !p.skip).length;
    if (!Q.length) return null;
    if (!anyKey && (Q.length < displayCount * 0.75 || Q.length > m * 1.3)) return null;

    for (let i = 0; i < m; i++) {
      const p = P[i];
      if (p.skip) {
        skipped++;
        continue;
      }
      let q = pair[i] >= 0 ? Q[pair[i]] : null;
      let how = null;
      if (q) how = q.key === p.key || q.altKey === p.key ? 'key' : 'order';
      else {
        q = Q.find((x) => x.key === p.key) || Q.find((x) => x.altKey === p.key) || null;
        if (q) how = 'repeat';
      }
      if (!q) {
        missing++;
        warnings.push('预设第 ' + p.n + ' 行在粘贴的歌词中未找到，已跳过 (missing line ' + p.n + ')');
        continue;
      }
      const text = q.key !== p.key && q.altKey === p.key ? q.altDisplay : q.display;
      const arr = chars(text);
      const src = p.phrases && p.phrases.length ? p.phrases : [{ at: 0, t: fin(p.t, 0) }];
      const L0 = p.len || arr.length;
      const pos = arr.length === L0 ? src.map((s) => s.at) : src.map((s) => mapOffset(s.at, L0, arr, how !== 'order'));
      const phrases = phrasesFromPositions(arr, pos, src.map((s) => s.t + offset));
      if (!phrases.length) {
        missing++;
        continue;
      }
      let end;
      if (p.end != null) end = p.end + offset;
      else {
        const last = phrases[phrases.length - 1];
        end = last.start + clamp(0.3 * (last.charEnd - last.charStart) + 1.0, 1.2, 6);
      }
      if (how === 'key' || how === 'repeat') exact++;
      else {
        fuzzy++;
        warnings.push('第 ' + q.lineNo + ' 行歌词按顺序对应到预设第 ' + p.n + ' 行 (order fallback)');
      }
      const line = buildLine({
        n: p.n, id: 'L' + p.n, text, key: p.key, phrases, end,
        style: p.style || null, styleSource: 'preset', match: how,
      });
      if (p.end == null) estimated.add(line);
      track.lines.push(line);
    }
    // The next line's start caps estimated ends of preset lines without `end`.
    for (let k = 0; k + 1 < track.lines.length; k++) {
      const l = track.lines[k];
      const nx = track.lines[k + 1].start;
      if (estimated.has(l) && l.end > nx - 0.02) {
        l.end = Math.max(l.phrases[l.phrases.length - 1].start + MIN_LAST, nx - 0.02);
        refreshLine(l);
      }
    }
    track.unmatched = entries.filter((e) => e.meta || !used.has(Q.indexOf(e))).map((e) => e.display);
    track.matched = { total: m, matched: exact, skipped, fallback: fuzzy, missing, displayed: track.lines.length };
    if (!exact && fuzzy) warnings.push('没有任何一行与预设完全匹配，已按顺序对应 (no exact key matches)');
    return finishTrack(track, sectionsFor(opts, preset, offset), opts.features);
  }

  /* ------------------------------------------------------------------ */
  /* LRC mode                                                            */
  /* ------------------------------------------------------------------ */
  function isLRCLines(rawLines) {
    let stamped = 0;
    let other = 0;
    for (const raw of rawLines) {
      const t = String(raw).replace(ZW_RE, '').trim();
      if (!t) continue;
      if (LRC_STAMP_RE.test(t) || ENH_LEAD_RE.test(t)) stamped++;
      else if (!LRC_TAG_RE.test(t)) other++;
    }
    return stamped > 0 && stamped >= other / 2;
  }

  function splitEnhanced(body) {
    const segs = [];
    let cur = { text: '', t: null };
    let last = 0;
    let m;
    ENH_RE.lastIndex = 0;
    while ((m = ENH_RE.exec(body))) {
      cur.text += body.slice(last, m.index);
      segs.push(cur);
      cur = { text: '', t: toSec(m[1], m[2]) };
      last = ENH_RE.lastIndex;
    }
    cur.text += body.slice(last);
    segs.push(cur);
    let end = null;
    if (segs.length > 1 && !segs[segs.length - 1].text.trim() && segs[segs.length - 1].t != null) end = segs.pop().t;
    const out = [];
    for (const s of segs) {
      if (!s.text.trim()) {
        if (out.length) out[out.length - 1].text += s.text;
        continue;
      }
      out.push(s);
    }
    return { segs: out, end, enhanced: segs.length > 1 || (segs[0] && segs[0].t != null) };
  }

  // Concatenate segments into a canonical display string, tracking which
  // segment every char came from.
  function segsToDisplay(segs) {
    const arr = [];
    const owner = [];
    segs.forEach((s, si) => {
      for (const ch of chars(s.text)) {
        const c = /\s/.test(ch) ? ' ' : ch;
        if (c === ' ' && (!arr.length || arr[arr.length - 1] === ' ')) continue;
        arr.push(c);
        owner.push(si);
      }
    });
    while (arr.length && arr[arr.length - 1] === ' ') {
      arr.pop();
      owner.pop();
    }
    return { arr, owner };
  }

  function parseLRC(rawLines, preset, opts, offset) {
    const track = emptyTrack('lrc');
    const meta = {};
    let lrcOffset = 0;
    const events = [];
    let lineNo = 0;
    rawLines.forEach((raw) => {
      const s = String(raw).replace(ZW_RE, '');
      if (!s.trim()) return;
      const tag = LRC_TAG_RE.exec(s);
      if (tag && !LRC_STAMP_RE.test(s)) {
        const k = tag[1].toLowerCase();
        const v = tag[2].trim();
        if (k === 'ti' && v) meta.title = v;
        else if (k === 'ar' && v) meta.artist = v;
        else if (k === 'al' && v) meta.album = v;
        else if (k === 'offset') lrcOffset = parseFloat(v) || 0;
        return;
      }
      let rest = s;
      const stamps = [];
      let m;
      while ((m = LRC_STAMP_RE.exec(rest))) {
        stamps.push(toSec(m[1], m[2]));
        rest = rest.slice(m[0].length);
      }
      if (!stamps.length) {
        const em = ENH_LEAD_RE.exec(rest);
        if (em) stamps.push(toSec(em[1], em[2]));
        else {
          const d = MV.canonDisplay(cleanRaw(s));
          if (d) track.unmatched.push(d);
          return;
        }
      }
      let style = null;
      const st = STYLE_TAG_RE.exec(rest);
      if (st) {
        style = st[1];
        rest = rest.slice(st[0].length);
      }
      const sp = splitEnhanced(rest);
      if (!sp.segs.length) {
        stamps.forEach((t) => events.push({ t, kind: 'end' }));
        return;
      }
      lineNo++;
      stamps.forEach((t0, si) => {
        const shift = t0 - stamps[0];
        events.push({
          t: t0, kind: 'line', n: lineNo, dup: si, style, enhanced: sp.enhanced,
          segs: sp.segs.map((g) => ({ text: g.text, t: g.t == null ? null : g.t + shift })),
          end: sp.end == null ? null : sp.end + shift, nextT: null,
        });
      });
    });
    events.sort((a, b) => a.t - b.t || (a.kind === 'end' ? -1 : 0) - (b.kind === 'end' ? -1 : 0));
    let prev = null;
    for (const ev of events) {
      if (ev.kind === 'end') {
        if (prev && prev.end == null) prev.end = ev.t;
        prev = null;
        continue;
      }
      if (prev && prev.end == null && prev.nextT == null) prev.nextT = ev.t;
      prev = ev;
    }
    const shiftT = offset - lrcOffset / 1000;
    const presetByKey = new Map();
    if (preset) preset.lines.forEach((p) => !p.skip && p.style && !presetByKey.has(p.key) && presetByKey.set(p.key, p.style));
    for (const ev of events) {
      if (ev.kind !== 'line') continue;
      const { arr, owner } = segsToDisplay(ev.segs);
      if (!arr.length) continue;
      const text = arr.join('');
      let phrases = [];
      if (ev.enhanced) {
        let si = -1;
        for (let i = 0; i < arr.length; i++) {
          if (arr[i] === ' ') continue;
          if (owner[i] !== si) {
            si = owner[i];
            const g = ev.segs[si];
            phrases.push({ charStart: i, charEnd: i + 1, start: g.t == null ? ev.t : g.t });
          } else phrases[phrases.length - 1].charEnd = i + 1;
        }
      }
      const nsc = nonSpaceCount(arr);
      let end = ev.end;
      if (end == null) {
        let est;
        if (phrases.length) {
          const lp = phrases[phrases.length - 1];
          est = lp.start + clamp(0.3 * (lp.charEnd - lp.charStart) + 0.8, 1.0, 6);
        } else est = ev.t + clamp(0.38 * nsc + 1.0, 1.5, 9);
        end = ev.nextT != null ? Math.min(ev.nextT, est) : est;
      }
      if (!phrases.length) phrases = distributePhrases(arr, ev.t, end);
      phrases.forEach((p) => (p.start += shiftT));
      const key = MV.lyricKey(text);
      let style = ev.style;
      let styleSource = 'tag';
      const reg = MV.lyricStyles;
      if (style && reg && reg.list && reg.list().length && !reg.has(style)) {
        track.warnings.push('第 ' + ev.n + ' 行的样式 {' + style + '} 不存在，已自动选择 (unknown style)');
        style = null;
      }
      if (!style && presetByKey.has(key)) {
        style = presetByKey.get(key);
        styleSource = 'preset';
      }
      const line = buildLine({
        n: ev.n, id: 'L' + ev.n + (ev.dup ? '.' + (ev.dup + 1) : ''), text, key, phrases, end: end + shiftT,
        style, styleSource,
      });
      if (ev.dup) line.seed = MV.hash32(key, ev.n, ev.dup);
      track.lines.push(line);
    }
    track.meta = meta;
    if (!meta.title && preset && preset.meta && preset.meta.title) meta.title = preset.meta.title;
    if (!meta.artist && preset && preset.meta && preset.meta.artist) meta.artist = preset.meta.artist;
    if (preset) {
      track.presetId = preset.id;
      track.leadIn = fin(preset.leadIn, LEAD_IN);
    }
    track.offset = offset;
    track.matched = { total: track.lines.length, matched: track.lines.length, skipped: 0 };
    if (!track.lines.length) track.warnings.push('LRC 中没有带时间的歌词行 (no timed lines)');
    return finishTrack(track, sectionsFor(opts, preset, offset), opts.features);
  }

  /* ------------------------------------------------------------------ */
  /* Auto mode                                                           */
  /* ------------------------------------------------------------------ */
  function downbeatsFor(opts, preset, offset) {
    const f = opts.features;
    if (f && Array.isArray(f.downbeats) && f.downbeats.length) return f.downbeats;
    const bpb = (f && f.beatsPerBar) || (preset && preset.beatsPerBar) || 4;
    if (f && Array.isArray(f.beats) && f.beats.length) return f.beats.filter((_, i) => i % bpb === 0);
    if (preset && Array.isArray(preset.beats)) return preset.beats.filter((_, i) => i % bpb === 0).map((t) => t + offset);
    return [];
  }

  function parseAuto(entries, preset, opts, offset) {
    const track = emptyTrack('auto');
    track.meta = metaFromEntries(entries, null);
    track.offset = offset;
    const Q = entries.filter((e) => !e.meta);
    track.unmatched = entries.filter((e) => e.meta).map((e) => e.display);
    if (!Q.length) {
      track.source = 'none';
      track.warnings.push('没有可显示的歌词行 (no lyric lines)');
      return track;
    }
    const f = opts.features;
    const sections = sectionsFor(opts, preset, offset);
    const dur = (f && f.duration) || (preset && preset.match && preset.match.duration) || null;
    const downbeats = downbeatsFor(opts, preset, offset);
    let spans = sections.filter((s) => !NON_VOCAL.has(s.kind) && s.end - s.start >= 3).map((s) => ({ a: s.start, b: s.end }));
    if (!spans.length && dur) {
      const pad = Math.min(8, dur * 0.06);
      spans = [{ a: pad, b: dur - pad }];
    }
    const weights = Q.map((e) => nonSpaceCount(chars(e.display)) + 4);
    const slots = [];
    let x = 0;
    Q.forEach((e, i) => {
      if (i > 0 && e.stanzaBreak) x += 6;
      slots.push([x, x + weights[i]]);
      x += weights[i];
    });
    const Wt = x || 1;
    const starts = [];
    const ends = [];
    if (spans.length) {
      const Tv = spans.reduce((a, s) => a + (s.b - s.a), 0);
      const toAbs = (v) => {
        let acc = 0;
        for (let k = 0; k < spans.length; k++) {
          const L = spans[k].b - spans[k].a;
          if (v <= acc + L) return { t: spans[k].a + (v - acc), k };
          acc += L;
        }
        return { t: spans[spans.length - 1].b, k: spans.length - 1 };
      };
      const bar = downbeats.length > 1 ? (downbeats[downbeats.length - 1] - downbeats[0]) / (downbeats.length - 1) : 2.4;
      Q.forEach((e, i) => {
        const a = toAbs((slots[i][0] / Wt) * Tv);
        const b = toAbs((slots[i][1] / Wt) * Tv - 1e-6);
        let s = a.t;
        let en = b.t;
        let k = a.k;
        if (b.k !== a.k) {
          // Slot straddles an instrumental gap / section change: keep the
          // line in the span that holds most of it.
          const inA = spans[a.k].b - a.t;
          const inB = b.t - spans[b.k].a;
          if (inB > inA) {
            s = spans[b.k].a;
            k = b.k;
          } else en = spans[a.k].b;
        }
        if (downbeats.length) {
          const di = MV.lowerIndex(downbeats, s);
          const c = [downbeats[di], downbeats[di + 1]].filter((v) => v != null);
          let best = s;
          let bd = bar / 2;
          c.forEach((v) => {
            if (Math.abs(v - s) <= bd && v >= spans[k].a - 0.05 && v < spans[k].b - 0.5) {
              bd = Math.abs(v - s);
              best = v;
            }
          });
          s = best;
        }
        starts.push(s);
        ends.push(en);
      });
    } else {
      let t = 8 + offset;
      Q.forEach((e, i) => {
        if (i > 0 && e.stanzaBreak) t += 2.5;
        const d = clamp(0.35 * nonSpaceCount(chars(e.display)) + 1.4, 2, 8);
        starts.push(t);
        ends.push(t + d);
        t += d + 0.6;
      });
    }
    for (let i = 1; i < starts.length; i++) if (starts[i] < starts[i - 1] + 0.6) starts[i] = starts[i - 1] + 0.6;
    Q.forEach((e, i) => {
      const s = starts[i];
      let en = ends[i];
      if (i + 1 < starts.length) en = Math.min(en, starts[i + 1] - 0.1);
      en = Math.max(en, s + 0.8);
      const arr = chars(e.display);
      track.lines.push(buildLine({ n: i + 1, id: 'L' + (i + 1), text: e.display, key: e.key, phrases: distributePhrases(arr, s, en), end: en }));
    });
    track.matched = { total: Q.length, matched: 0, skipped: 0 };
    track.warnings.push('未匹配到时间预设：已按字数自动分配时间，建议用同步编辑器校准 (auto timing)');
    return finishTrack(track, sections, f);
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */
  /**
   * 'lrc' | 'plain' | 'empty' for a pasted text.
   * @param {string} text
   */
  function detectMode(text) {
    const src = String(text == null ? '' : text);
    if (!src.trim()) return 'empty';
    return isLRCLines(src.split(/\r\n|\r|\n|\u2028|\u2029/)) ? 'lrc' : 'plain';
  }

  /**
   * Parse pasted lyrics into a LyricTrack.
   * @param {string} text  plain text, markdown-ish paste or LRC
   * @param {{preset?: object|string, features?: object, offset?: number}} [opts]
   *   offset (s) is added to every time (preset / LRC / auto).
   * @returns {object} LyricTrack (ARCHITECTURE §2.3)
   */
  function parse(text, opts) {
    opts = opts || {};
    const offset = fin(Number(opts.offset), 0);
    const preset = resolvePreset(opts.preset);
    const src = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    const rawLines = src.split(/\r\n|\r|\n|\u2028|\u2029/);
    let track;
    try {
      if (!src.trim()) {
        track = emptyTrack('none');
        track.warnings.push('未提供歌词 (no lyrics)');
      } else if (isLRCLines(rawLines)) {
        track = parseLRC(rawLines, preset, opts, offset);
      } else {
        const entries = collectPlain(rawLines, preset);
        if (preset && preset.lines.length) track = parsePreset(entries, preset, opts, offset);
        if (!track) {
          track = parseAuto(entries, preset, opts, offset);
          if (preset && track.source === 'auto') track.warnings.unshift('歌词与预设差异过大，改用自动分配 (preset mismatch)');
        }
      }
    } catch (e) {
      // Never let a malformed paste break the app.
      if (MV.log) MV.log('Lyrics.parse failed', e);
      track = emptyTrack('none');
      track.warnings.push('歌词解析失败 (parse error): ' + (e && e.message ? e.message : e));
    }
    if (track.leadIn == null) track.leadIn = LEAD_IN;
    return track;
  }

  /**
   * Fill `style` for lines without one (ARCHITECTURE §3.3 heuristics).
   * A repeated line reuses the style of its first occurrence.
   * @param {object} track
   * @param {object} [features]
   * @returns {object} the same track
   */
  function assignStyles(track, features) {
    if (!track || !Array.isArray(track.lines)) return track;
    const sections = features && Array.isArray(features.sections) ? features.sections : [];
    const first = new Map();
    let verseAlt = 0;
    let chorusCycle = 0;
    let latinTail = 0;
    const cyc = ['ransom', 'split', 'slash'];
    track.lines.forEach((line) => {
      const key = line.key || MV.lyricKey(line.text);
      if (line.style) {
        if (!first.has(key)) first.set(key, line.style);
        return;
      }
      let kind = line.sectionKind;
      if (!kind && sections.length) {
        const s = sectionOf(sections, line.start, line.end);
        kind = s ? s.kind : null;
      }
      kind = kind || 'verse';
      let style;
      if (first.has(key)) style = first.get(key);
      else {
        const n = nonSpaceCount(line.chars || chars(line.text));
        const hasLatin = (line.phrases || []).some((p) => p.latin);
        const tail = line.phrases && line.phrases.length && line.phrases[line.phrases.length - 1].latin && !isLatin(line.text);
        if (n <= 6 || kind === 'hook') style = 'impact';
        else if (kind === 'chorus' || kind === 'climax') {
          style = tail ? (latinTail++ % 2 === 0 ? 'ransom' : 'split') : cyc[chorusCycle++ % 3];
        } else if (kind === 'verse') style = verseAlt++ % 2 === 0 ? 'dialog' : 'slash';
        else if (kind === 'pre' || kind === 'build') style = 'glitch';
        else if (kind === 'bridge') style = hasLatin ? 'dialog' : 'vertical';
        else if (kind === 'outro') style = 'card';
        else if (kind === 'interlude') style = 'slash';
        else style = 'dialog';
      }
      line.style = style;
      line.styleSource = 'auto';
      first.set(key, style);
    });
    return track;
  }

  /**
   * Serialise to enhanced LRC: `[mm:ss.xx]{style}<mm:ss.xx>phrase <mm:ss.xx>phrase<mm:ss.xx end>`.
   * Parsing the result (no preset) reproduces times within 10 ms.
   * @param {object} track
   * @param {{styles?: boolean}} [o]
   * @returns {string}
   */
  function toLRC(track, o) {
    o = o || {};
    const out = [];
    if (!track) return '';
    const meta = track.meta || {};
    if (meta.title) out.push('[ti:' + String(meta.title).replace(/[\]\r\n]/g, ' ') + ']');
    if (meta.artist) out.push('[ar:' + String(meta.artist).replace(/[\]\r\n]/g, ' ') + ']');
    out.push('[re:MV lyric sync]');
    const lines = (track.lines || []).slice().sort((a, b) => a.index - b.index);
    for (const line of lines) {
      const arr = line.chars || chars(line.text);
      let s = '[' + fmtStamp(line.start) + ']';
      if (line.style && o.styles !== false) s += '{' + line.style + '}';
      let pos = 0;
      for (const p of line.phrases) {
        s += arr.slice(pos, p.charStart).join('') + '<' + fmtStamp(p.start) + '>' + arr.slice(p.charStart, p.charEnd).join('');
        pos = p.charEnd;
      }
      s += arr.slice(pos).join('') + '<' + fmtStamp(line.end) + '>';
      out.push(s);
    }
    return out.join('\n') + '\n';
  }

  /**
   * Lines visible at time t (showStart ≤ t < showEnd), in display order.
   * @param {object} track
   * @param {number} t
   * @returns {object[]}
   */
  function activeLines(track, t) {
    if (!track || !track.lines) return [];
    const out = [];
    for (const l of track.lines) if (t >= l.showStart && t < l.showEnd) out.push(l);
    return out;
  }

  /**
   * Deep copy of a track (lines, phrases, charTimes …).
   * @param {object} track
   */
  function clone(track) {
    if (!track) return track;
    const c = Object.assign({}, track);
    c.meta = Object.assign({}, track.meta || {});
    c.matched = Object.assign({}, track.matched || {});
    c.unmatched = (track.unmatched || []).slice();
    c.warnings = (track.warnings || []).slice();
    c.lines = (track.lines || []).map((l) => {
      const n = Object.assign({}, l);
      n.chars = (l.chars || chars(l.text)).slice();
      n.phrases = (l.phrases || []).map((p) => Object.assign({}, p));
      n.segments = (l.segments || []).map((s) => Object.assign({}, s));
      n.charTimes = new Float32Array(l.charTimes || n.chars.length);
      return n;
    });
    return c;
  }

  /**
   * Clone with remapped times. fn(t, info) → t' is called for every phrase
   * start and every line end; info = { line, lineIndex, phrase (k or -1), field }.
   * Phrase ends, charTimes and show windows are recomputed.
   * @param {object} track
   * @param {function(number, object): number} fn
   * @returns {object}
   */
  function withTimes(track, fn) {
    const c = clone(track);
    if (!c || typeof fn !== 'function') return c;
    c.lines.forEach((line, li) => {
      const src = track.lines[li];
      line.phrases.forEach((p, k) => {
        p.start = fin(fn(src.phrases[k].start, { line: src, lineIndex: li, phrase: k, field: 'start' }), src.phrases[k].start);
      });
      line.end = fin(fn(src.end, { line: src, lineIndex: li, phrase: -1, field: 'end' }), src.end);
    });
    return refresh(c);
  }

  MV.Lyrics = {
    parse, assignStyles, toLRC, isMetaLine, activeLines, withTimes,
    clone, refresh, detectMode,
    // exposed for tests / tools
    _internal: { cleanRaw, isWrapped, mapOffset, computeCharTimes, fmtStamp, distributePhrases },
  };
})();

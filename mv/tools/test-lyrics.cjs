#!/usr/bin/env node
/*
 * Node tests for mv/js/lyrics.js (MV.Lyrics).
 *
 *   node mv/tools/test-lyrics.cjs
 *   MV_LYRICS=/path/clean.txt MV_LYRICS_PASTE=/path/raw-paste.txt node mv/tools/test-lyrics.cjs
 *
 * All fixtures below are INVENTED placeholder lines (no real song lyrics).
 * The optional real-lyrics files are read from outside the repo at test time
 * only; this script never prints their text (counts / ids / booleans only).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
global.window = globalThis;
global.document = { createElement: () => ({ width: 8, height: 8, getContext: () => ({}) }) };
for (const f of ['js/core.js', 'data/hoshi-to-bokura-to.js', 'tools/dev-env.js', 'js/lyrics.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const MV = global.MV;
const L = MV.Lyrics;

/* ------------------------------------------------------------------ */
let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(name + (detail != null ? ' :: ' + detail : ''));
  }
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail != null ? '  [' + detail + ']' : ''));
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
function monotonic(ct) {
  for (let i = 1; i < ct.length; i++) if (ct[i] < ct[i - 1]) return false;
  return true;
}
function coversNonSpace(line) {
  const cov = new Uint8Array(line.chars.length);
  let prevEnd = 0;
  for (const p of line.phrases) {
    if (p.charStart < prevEnd || p.charEnd <= p.charStart) return false;
    for (let i = p.charStart; i < p.charEnd; i++) cov[i] = 1;
    prevEnd = p.charEnd;
  }
  for (let i = 0; i < line.chars.length; i++) if (line.chars[i] !== ' ' && !cov[i]) return false;
  return true;
}
function lineInvariants(track) {
  const bad = [];
  track.lines.forEach((l, i) => {
    if (l.index !== i) bad.push(l.id + ':index');
    if (l.text !== MV.canonDisplay(l.text)) bad.push(l.id + ':canon');
    if (l.chars.length !== Array.from(l.text).length) bad.push(l.id + ':chars');
    if (!coversNonSpace(l)) bad.push(l.id + ':cover');
    if (!monotonic(l.charTimes)) bad.push(l.id + ':charTimes');
    if (l.charTimes.length !== l.chars.length) bad.push(l.id + ':ctlen');
    if (!near(l.start, l.phrases[0].start)) bad.push(l.id + ':start');
    for (let k = 0; k < l.phrases.length; k++) {
      const p = l.phrases[k];
      const want = k + 1 < l.phrases.length ? l.phrases[k + 1].start : l.end;
      if (!near(p.end, want)) bad.push(l.id + ':pend' + k);
      if (p.start > p.end + 1e-9) bad.push(l.id + ':porder' + k);
      if (!near(l.charTimes[p.charStart], p.start, 1e-4)) bad.push(l.id + ':firstChar' + k);
      if (p.latin !== MV.text.isLatin(p.text)) bad.push(l.id + ':latin' + k);
      if (p.text !== l.chars.slice(p.charStart, p.charEnd).join('')) bad.push(l.id + ':ptext' + k);
    }
    if (!near(l.showStart, l.start - (track.leadIn || 0.3))) bad.push(l.id + ':showStart');
    if (!(l.showEnd > l.showStart)) bad.push(l.id + ':showEnd');
    if (typeof l.seed !== 'number' || l.seed >>> 0 !== l.seed) bad.push(l.id + ':seed');
    if (!(l.emphasis >= 0 && l.emphasis <= 1)) bad.push(l.id + ':emph');
    if (!l.style) bad.push(l.id + ':style');
    const segJoin = l.segments.map((s) => s.text).join(' ');
    if (segJoin !== l.text) bad.push(l.id + ':segments');
  });
  return bad;
}
function maxTimeErr(a, b) {
  let e = 0;
  if (a.lines.length !== b.lines.length) return Infinity;
  a.lines.forEach((l, i) => {
    const o = b.lines[i];
    if (l.phrases.length !== o.phrases.length) {
      e = Infinity;
      return;
    }
    e = Math.max(e, Math.abs(l.start - o.start), Math.abs(l.end - o.end), Math.abs(l.showStart - o.showStart), Math.abs(l.showEnd - o.showEnd));
    l.phrases.forEach((p, k) => (e = Math.max(e, Math.abs(p.start - o.phrases[k].start), Math.abs(p.end - o.phrases[k].end))));
  });
  return e;
}
function sameText(a, b) {
  return a.lines.length === b.lines.length && a.lines.every((l, i) => l.text === b.lines[i].text);
}
function noTextInWarnings(track, sourceLines) {
  const texts = sourceLines.map((s) => MV.canonDisplay(s)).filter((s) => Array.from(s).length >= 4);
  return track.warnings.every((w) => texts.every((t) => w.indexOf(t) < 0));
}

/* ------------------------------------------------------------------ */
/* Invented fixture: song + preset (placeholder text only)             */
/* ------------------------------------------------------------------ */
// [text, phrase boundary offsets (null = at spaces), phrase times, end, style, skip]
const FIX = [
  ['夜明けの駅で 君を待つ', null, [8.2, 11.0], 13.5, 'dialog'],
  ['錆びた線路が 知らない街へ 続いてる', null, [14.1, 16.4, 19.0], 21.0, 'slash'],
  ['誰もいない屋上で 風を数えた', null, [0, 0], 0, null, true], //                 unsung (skip)
  ['紙の星座を 胸に抱いて', null, [30.4, 33.2], 35.8, 'ransom'],
  ['走り出すんだ 今夜 We’re paper stars', [0, 7, 10], [36.0, 38.1, 39.6], 42.0, 'split'],
  ['灯せ 遠く 高く 今', null, [50.2, 52.6, 55.0, 57.4], 59.0, 'impact'],
  ['窓に映る赤い信号 まだ消えない', [0, 5, 10], [60.5, 62.8, 65.1], 68.0, 'vertical'],
  ['紙の星座を 胸に抱いて', null, [75.3, 78.0], 80.4, 'ransom'],
  ['走り出すんだ 今夜 We’re paper stars', [0, 7, 10], [80.6, 82.7, 84.2], 87.0, 'split'],
];
function atsFor(text, given) {
  if (given) return given;
  const arr = Array.from(text);
  const out = [0];
  for (let i = 1; i < arr.length; i++) if (arr[i - 1] === ' ' && arr[i] !== ' ') out.push(i);
  return out;
}
const TEST_PRESET = {
  id: 'test-paper-stars',
  meta: { title: '紙の星座', titleLatin: 'Kami no Seiza', artist: 'Test Artist', lyricist: '作者A', composer: '作者B' },
  match: { duration: 100, tolerance: 2 },
  bpm: 100, beatsPerBar: 4,
  beats: Array.from({ length: 160 }, (_, i) => +(0.5 + i * 0.6).toFixed(3)),
  sections: [
    { kind: 'intro', name: 'INTRO', start: 0, end: 8, intensity: 0.5 },
    { kind: 'verse', name: 'VERSE', start: 8, end: 30, intensity: 0.3 },
    { kind: 'chorus', name: 'CHORUS', start: 30, end: 50, intensity: 0.85 },
    { kind: 'hook', name: 'HOOK', start: 50, end: 60, intensity: 0.75 },
    { kind: 'bridge', name: 'BRIDGE', start: 60, end: 75, intensity: 0.2 },
    { kind: 'chorus', name: 'CHORUS', start: 75, end: 95, intensity: 0.95 },
    { kind: 'outro', name: 'OUTRO', start: 95, end: 100, intensity: 0.3 },
  ],
  leadIn: 0.3,
  lines: FIX.map((f, i) => {
    const disp = MV.canonDisplay(f[0]);
    const ln = { n: i + 1, key: MV.lyricKey(disp), len: Array.from(disp).length };
    if (f[5]) {
      ln.skip = true;
      return ln;
    }
    const ats = atsFor(disp, f[1]);
    ln.style = f[4];
    ln.phrases = ats.map((a, k) => ({ at: a, t: f[2][k] }));
    ln.end = f[3];
    return ln;
  }),
};
const FIX_TEXT = FIX.map((f) => f[0]);
const DISPLAYED = TEST_PRESET.lines.filter((l) => !l.skip);
const HEADER = ['**紙の星座**（Kami no Seiza / 纸星座）', '歌手：Test Artist', '作詞：作者A', '作曲: 作者B', '（テスト用の架空の歌詞）'];
function pasteOf(lines, o = {}) {
  const body = [];
  lines.forEach((t, i) => {
    let s = o.doubleSpaces ? t.replace(/ /g, '  ') : t;
    if (o.trailing) s += '  ';
    body.push(s);
    if (o.stanzas && [1, 2, 4, 5, 6].includes(i)) body.push('');
  });
  const head = o.header ? HEADER.concat(['']) : [];
  return head.concat(body).join(o.crlf ? '\r\n' : '\n');
}

function checkPresetTrack(name, tr, preset, o = {}) {
  const shown = preset.lines.filter((l) => !l.skip);
  const expectDisplayed = o.displayed != null ? o.displayed : shown.length;
  check(name + ': source preset', tr.source === 'preset', tr.source);
  check(name + ': displayed lines', tr.lines.length === expectDisplayed, tr.lines.length + '/' + expectDisplayed);
  if (o.matched != null) check(name + ': matched.matched', tr.matched.matched === o.matched, tr.matched.matched);
  check(name + ': matched.skipped', tr.matched.skipped === preset.lines.filter((l) => l.skip).length, tr.matched.skipped);
  if (o.unmatched != null) check(name + ': unmatched count', tr.unmatched.length === o.unmatched, tr.unmatched.length);
  let phraseOK = 0;
  let p0OK = 0;
  let allTimesOK = 0;
  tr.lines.forEach((l) => {
    const pl = preset.lines.find((x) => x.n === l.n);
    if (!pl) return;
    if (l.phrases.length === pl.phrases.length) phraseOK++;
    if (l.phrases[0].start === pl.phrases[0].t + (o.offset || 0)) p0OK++;
    if (l.phrases.every((p, k) => pl.phrases[k] && near(p.start, pl.phrases[k].t + (o.offset || 0)))) allTimesOK++;
  });
  check(name + ': phrase counts == preset', phraseOK === tr.lines.length, phraseOK + '/' + tr.lines.length);
  check(name + ': phrase[0].start == preset t', p0OK === tr.lines.length, p0OK + '/' + tr.lines.length);
  check(name + ': all phrase starts == preset t', allTimesOK === tr.lines.length, allTimesOK + '/' + tr.lines.length);
  const bad = lineInvariants(tr);
  check(name + ': line invariants', bad.length === 0, bad.slice(0, 6).join(','));
  check(name + ': line ids unique', new Set(tr.lines.map((l) => l.id)).size === tr.lines.length);
  return tr;
}

/* ------------------------------------------------------------------ */
console.log('--- invented preset: exact match ---');
{
  const tr = L.parse(pasteOf(FIX_TEXT), { preset: TEST_PRESET });
  checkPresetTrack('plain', tr, TEST_PRESET, { matched: DISPLAYED.length, unmatched: 0 });
  check('plain: styles from preset', tr.lines.every((l) => l.styleSource === 'preset' && l.style === TEST_PRESET.lines.find((x) => x.n === l.n).style));
  check('plain: repeated chorus isHook', tr.lines.filter((l) => l.isHook).length === 5, tr.lines.filter((l) => l.isHook).map((l) => l.n).join(','));
  const k = (n) => tr.lines.find((l) => l.n === n).sectionKind;
  check('plain: section kinds', k(1) === 'verse' && k(4) === 'chorus' && k(6) === 'hook' && k(7) === 'bridge' && k(9) === 'chorus', [1, 4, 6, 7, 9].map(k).join(','));
  const e = (n) => tr.lines.find((l) => l.n === n).emphasis;
  check('plain: chorus/hook emphasis > verse/bridge', e(4) > e(1) + 0.3 && e(6) > e(7) + 0.3, [e(1), e(4), e(6), e(7)].map((x) => x.toFixed(2)).join(','));
  const l5 = tr.lines.find((l) => l.n === 5);
  check('plain: English tail phrase is latin', l5.phrases[2].latin && !l5.phrases[0].latin);
  // Latin phrase reveals per word: chars in the same word share a time.
  const p = l5.phrases[2];
  const words = MV.canonDisplay(p.text).split(' ');
  let ci = p.charStart;
  let perWord = true;
  const wordTimes = [];
  words.forEach((w) => {
    const n = Array.from(w).length;
    for (let j = 1; j < n; j++) if (l5.charTimes[ci + j] !== l5.charTimes[ci]) perWord = false;
    wordTimes.push(l5.charTimes[ci]);
    ci += n + 1;
  });
  check('plain: Latin reveal per word', perWord && wordTimes.every((t, i) => i === 0 || t > wordTimes[i - 1]), wordTimes.map((t) => t.toFixed(2)).join(','));
  // CJK reveal: first 55 % of the phrase, ≥ 0.06 s steps when room.
  const l1 = tr.lines.find((l) => l.n === 1);
  const ph = l1.phrases[0];
  const nChars = ph.charEnd - ph.charStart;
  const lastT = l1.charTimes[ph.charEnd - 1];
  const expectSpan = Math.min(Math.max(0.06 * nChars, 0.55 * (ph.end - ph.start)), 0.9 * (ph.end - ph.start));
  check('plain: CJK reveal span 55%', near(lastT - ph.start, (expectSpan * (nChars - 1)) / nChars, 1e-4), (lastT - ph.start).toFixed(3));
  // showEnd provisional rule.
  let rule = true;
  for (let i = 0; i < tr.lines.length; i++) {
    const l = tr.lines[i];
    const nx = tr.lines[i + 1];
    const want = Math.max(nx ? Math.min(l.end + 1.2, nx.showStart - 0.05) : l.end + 1.2, l.start + 0.3);
    if (!near(l.showEnd, want)) rule = false;
  }
  check('plain: showEnd = min(end+1.2, next.showStart-0.05)', rule);
  check('plain: seeds = hash32(key, n)', tr.lines.every((l) => l.seed === MV.hash32(l.key, l.n)));
  check('plain: activeLines(t) ≤ 2 everywhere', (() => {
    for (let t = 0; t < 100; t += 0.05) if (L.activeLines(tr, t).length > 2) return false;
    return true;
  })());
  check('plain: activeLines finds line 1 at 9.0', L.activeLines(tr, 9.0).some((l) => l.n === 1));
}

console.log('--- invented preset: realistic paste with header ---');
{
  const txt = pasteOf(FIX_TEXT, { header: true, doubleSpaces: true, trailing: true, stanzas: true });
  const tr = L.parse(txt, { preset: TEST_PRESET });
  checkPresetTrack('header', tr, TEST_PRESET, { matched: DISPLAYED.length, unmatched: HEADER.length });
  const headDisp = HEADER.map((h) => MV.canonDisplay(h.replace(/\*\*/g, '')));
  check('header: unmatched == header lines', tr.unmatched.every((u, i) => u === headDisp[i]));
  check('header: meta title/artist', tr.meta.title === '紙の星座' && tr.meta.artist === 'Test Artist');
  check('header: no warnings', tr.warnings.length === 0, tr.warnings.length);
  const variants = {
    crlf: txt.replace(/\n/g, '\r\n'),
    cr: txt.replace(/\n/g, '\r'),
    fullwidthSpaces: txt.replace(/ /g, '\u3000'),
    straightApostrophe: txt.replace(/’/g, "'"),
    noBlankLines: txt.split('\n').filter((s) => s.trim()).join('\n'),
    tabsAndNbsp: txt.replace(/ /g, (m, i) => (i % 2 ? '\t' : '\u00A0')),
    bomZeroWidth: '\uFEFF' + txt.replace(/の/g, 'の\u200B'),
    boldEverywhere: txt.split('\n').map((s) => (s.trim() && !s.startsWith('**') ? '**' + s.trim() + '**' : s)).join('\n'),
    quoteBullets: txt.split('\n').map((s) => (s.trim() ? '> ' + s : s)).join('\n'),
  };
  for (const [name, v] of Object.entries(variants)) {
    const t2 = L.parse(v, { preset: TEST_PRESET });
    checkPresetTrack('variant ' + name, t2, TEST_PRESET, { matched: DISPLAYED.length, unmatched: HEADER.length });
  }
}

console.log('--- invented preset: fallbacks ---');
{
  // One character deleted in each line (one line at a time).
  let ok = 0;
  let phraseOK = 0;
  let fb = 0;
  FIX_TEXT.forEach((_, idx) => {
    const lines = FIX_TEXT.slice();
    const arr = Array.from(lines[idx]);
    arr.splice(2, 1);
    lines[idx] = arr.join('');
    const tr = L.parse(pasteOf(lines, { header: true }), { preset: TEST_PRESET });
    const good = tr.lines.length === DISPLAYED.length && lineInvariants(tr).length === 0 && tr.matched.skipped === 1;
    if (good) ok++;
    if (tr.lines.every((l) => l.phrases.length === TEST_PRESET.lines.find((x) => x.n === l.n).phrases.length)) phraseOK++;
    fb += tr.matched.fallback || 0;
  });
  check('char-deleted variants: all lines still displayed', ok === FIX_TEXT.length, ok + '/' + FIX_TEXT.length);
  check('char-deleted variants: phrase counts kept', phraseOK === FIX_TEXT.length, phraseOK + '/' + FIX_TEXT.length);
  check('char-deleted variants: order fallback used', fb >= 3, 'fallback lines ' + fb);

  // A space removed → same key, different length: key-space offset mapping.
  const lines = FIX_TEXT.slice();
  lines[1] = lines[1].replace(' ', '');
  const tr = L.parse(pasteOf(lines), { preset: TEST_PRESET });
  const l2 = tr.lines.find((l) => l.n === 2);
  check('space removed: still key-matched', tr.matched.matched === DISPLAYED.length && l2.match === 'key');
  check('space removed: phrase boundary kept', l2.phrases.length === 3 && l2.phrases[1].charStart === 6 && l2.phrases[2].charStart === 13, l2.phrases.map((p) => p.charStart).join(','));

  // Repeats not written out: paste only the first 7 lines.
  const t3 = L.parse(pasteOf(FIX_TEXT.slice(0, 7), { header: true }), { preset: TEST_PRESET });
  checkPresetTrack('repeats not written', t3, TEST_PRESET, { matched: DISPLAYED.length, unmatched: HEADER.length });
  check('repeats not written: repeat source', t3.lines.filter((l) => l.match === 'repeat').length === 2);

  // Unsung line omitted from the paste.
  const t4 = L.parse(pasteOf(FIX_TEXT.filter((_, i) => i !== 2)), { preset: TEST_PRESET });
  checkPresetTrack('skip line omitted', t4, TEST_PRESET, { matched: DISPLAYED.length, unmatched: 0 });

  // Interleaved translation lines (invented) → unmatched, lyrics still keyed.
  const inter = [];
  FIX_TEXT.forEach((t, i) => {
    inter.push(t);
    inter.push('译文第' + (i + 1) + '行：这是一句虚构的翻译');
  });
  const t5 = L.parse(inter.join('\n'), { preset: TEST_PRESET });
  checkPresetTrack('interleaved translations', t5, TEST_PRESET, { matched: DISPLAYED.length, unmatched: FIX_TEXT.length });

  // Ruby / inline bracket annotations: "星座(せいざ)" → alt key match, annotation dropped.
  const ruby = FIX_TEXT.map((t) => t.replace('星座', '星座(せいざ)'));
  const t6 = L.parse(pasteOf(ruby), { preset: TEST_PRESET });
  checkPresetTrack('ruby annotations', t6, TEST_PRESET, { matched: DISPLAYED.length, unmatched: 0 });
  check('ruby annotations: stripped from display', t6.lines.every((l) => l.text.indexOf('せいざ') < 0));

  // Romanised paste (no key matches, same line count) → pure order mapping.
  const roma = FIX_TEXT.map((_, i) => 'romaji line number ' + (i + 1) + ' placeholder');
  const t7 = L.parse(roma.join('\n'), { preset: TEST_PRESET });
  check('romaji: order mapping keeps preset timing', t7.source === 'preset' && t7.lines.length === DISPLAYED.length && t7.matched.fallback === DISPLAYED.length, t7.lines.length + ' fb=' + t7.matched.fallback);
  check('romaji: invariants', lineInvariants(t7).length === 0, lineInvariants(t7).slice(0, 4).join(','));

  // Totally different lyric (many more lines, no keys) → auto mode.
  const other = Array.from({ length: 30 }, (_, i) => '完全に別の架空の歌詞 その' + (i + 1));
  const t8 = L.parse(other.join('\n'), { preset: TEST_PRESET });
  check('mismatch: falls back to auto', t8.source === 'auto' && t8.lines.length === 30, t8.source + ' ' + t8.lines.length);
  check('mismatch: warns', t8.warnings.length >= 1);

  // Offset option shifts everything.
  const t9 = L.parse(pasteOf(FIX_TEXT), { preset: TEST_PRESET, offset: 1.25 });
  checkPresetTrack('offset +1.25', t9, TEST_PRESET, { matched: DISPLAYED.length, offset: 1.25 });
  check('warnings never contain lyric text', [t3, t4, t5, t6, t7, t8].every((t) => noTextInWarnings(t, FIX_TEXT)));
}

console.log('--- order fallback: phrase boundaries on word / punctuation edges ---');
{
  const tok = (ch) => /[\x21-\x7E‘’“”]/.test(ch || '');
  // Index of the first boundary that cuts a Latin word ("Keep mov|ing"), or -1.
  const midWord = (line) => {
    for (let k = 1; k < line.phrases.length; k++) {
      const cs = line.phrases[k].charStart;
      if (tok(line.chars[cs - 1]) && tok(line.chars[cs])) return cs;
    }
    return -1;
  };
  // Line 5 of the invented preset (Latin tail) replaced by a different invented
  // line whose long English words straddle the ratio targets → order mapping.
  const variants = [
    '明日へ Keeepmovingonward tonight',
    '走れ Keep moving on and on tonight',
    '遠くまで 今 Foreverandever',
    '今夜こそ 走り出す Neverstopdreaming',
    'Paper stars keep shining tonight',
  ];
  let bad = 0;
  let fb = 0;
  let tailOK = 0;
  const detail = [];
  variants.forEach((v) => {
    const lines = FIX_TEXT.slice();
    lines[4] = v; // the chorus line is sung twice: replace both copies
    lines[8] = v;
    const tr = L.parse(pasteOf(lines), { preset: TEST_PRESET });
    const l5 = tr.lines.find((l) => l.n === 5);
    if (l5.match === 'order') fb++;
    const m = midWord(l5);
    if (m >= 0 || lineInvariants(tr).length) {
      bad++;
      detail.push(v.length + ':' + m);
    }
    // the mapped phrases keep preset times (merged phrases keep the earlier one)
    if (l5.phrases.every((p) => TEST_PRESET.lines[4].phrases.some((q) => near(q.t, p.start)))) tailOK++;
  });
  check('order fallback: never splits a Latin word', bad === 0 && fb === variants.length, `bad=${bad} order=${fb} ${detail.join(' ')}`);
  check('order fallback: phrase times come from the preset line', tailOK === variants.length, tailOK + '/' + variants.length);

  // Property test on the mapper itself: invented mixed lines × random offsets.
  const I = L._internal;
  const words = ['夜明け', 'の', '駅で', '君を', '待つ', '、', 'Keep', 'moving', 'on', 'tonight', 'paper', 'stars', '今夜', '走り出す', 'we’re', '「さよなら」', 'ー', 'forever'];
  const rng = MV.rng(4242);
  let invalid = 0;
  let collapsed = 0;
  let runs = 0;
  for (let it = 0; it < 400; it++) {
    const n = rng.int(2, 9);
    let s = '';
    for (let w = 0; w < n; w++) s += (w && rng.chance(0.7) ? ' ' : '') + rng.pick(words);
    const arr = Array.from(MV.canonDisplay(s));
    const L0 = Math.max(4, arr.length + rng.int(-8, 8));
    const K = rng.int(2, 5);
    const ats = [0];
    for (let k = 1; k < K; k++) ats.push(Math.min(L0 - 1, ats[k - 1] + rng.int(1, Math.max(1, Math.floor(L0 / K) + 2))));
    for (const keyed of [false, true]) {
      runs++;
      const r = I.mapPhraseStarts(ats, L0, arr, keyed);
      for (let k = 1; k < r.pos.length; k++) {
        const p = r.pos[k];
        if (!(p > r.pos[k - 1]) || arr[p] === ' ' || (tok(arr[p - 1]) && tok(arr[p]))) invalid++;
      }
      if (r.keep.some((k, i) => i && !(k > r.keep[i - 1]))) invalid++;
      if (r.pos.length < K) collapsed++;
    }
  }
  check('mapPhraseStarts: boundaries increasing, on glyphs, never inside Latin words', invalid === 0, `invalid=${invalid} runs=${runs} merged=${collapsed}`);
  // Spaces win over nearby CJK positions for a different text; the same text
  // (key match) keeps a CJK boundary that is right on target.
  const arr = Array.from('あいうえおかき くけこさしす');
  // (preset text 20 glyphs → clearly a different text; ratio target 5.2)
  check('order fallback: snaps to a space within 4 glyphs', I.mapPhraseStarts([0, 8], 20, arr, false).pos[1] === 8, I.mapPhraseStarts([0, 8], 20, arr, false).pos.join(','));
  // (typo-sized length change → same lyric: stays on target)
  check('order fallback, typo-sized change: keeps the on-target boundary', I.mapPhraseStarts([0, 5], 14, arr, false).pos[1] === 5, I.mapPhraseStarts([0, 5], 14, arr, false).pos.join(','));
  check('keyed mapping: keeps an on-target CJK boundary', I.mapPhraseStarts([0, 5], arr.length, arr, true).pos[1] === 5, I.mapPhraseStarts([0, 5], arr.length, arr, true).pos.join(','));
  check('order fallback: punctuation boundary preferred over mid-run CJK', I.mapPhraseStarts([0, 6], 12, Array.from('あいうえ、おかきくけこさ'), false).pos[1] === 5);
  // A Latin tail that cannot be split at a space merges instead of cutting a word.
  const one = I.mapPhraseStarts([0, 3, 6, 9], 12, Array.from('Keepmovingon'), false);
  check('all-Latin single word: phrases merge, no mid-word cut', one.pos.length === 1, one.pos.join(','));
  // Auto / LRC chunking of long unspaced runs never cuts a Latin word either.
  const ch = I.distributePhrases(Array.from('君と見たあの星空をいつまでもForeverandever'), 0, 10);
  const chArr = Array.from('君と見たあの星空をいつまでもForeverandever');
  check('distributePhrases: long mixed run cut at the script change, not inside the word', ch.length >= 2 && ch.every((p) => !(tok(chArr[p.charStart - 1]) && tok(chArr[p.charStart]))), ch.map((p) => p.charStart).join(','));
}

console.log('--- auto mode: offset & bar phase ---');
{
  const feats = { duration: 100, sections: TEST_PRESET.sections, downbeats: Array.from({ length: 41 }, (_, i) => i * 2.5) };
  const txt = FIX_TEXT.join('\n');
  const a0 = L.parse(txt, { features: feats });
  const a1 = L.parse(txt, { features: feats, offset: 1.5 });
  const want = L.withTimes(a0, (t) => t + 1.5);
  const err = maxTimeErr(a1, want);
  check('auto + features: offset added to every time', a1.source === 'auto' && err < 1e-6 && near(a1.lines[0].start, a0.lines[0].start + 1.5), (err * 1000).toFixed(3) + ' ms');
  check('auto + features: offset keeps sections / styles', a1.lines.every((l, i) => l.sectionKind === a0.lines[i].sectionKind && l.style === a0.lines[i].style));
  const b0 = L.parse(txt, { preset: Object.assign({}, TEST_PRESET, { lines: [] }) });
  const b1 = L.parse(txt, { preset: Object.assign({}, TEST_PRESET, { lines: [] }), offset: -0.75 });
  check('auto + preset grid: offset added to every time', maxTimeErr(b1, L.withTimes(b0, (t) => t - 0.75)) < 1e-6);
  const n0 = L.parse(txt, {});
  const n1 = L.parse(txt, { offset: 2 });
  check('auto without grid: offset added to every time', maxTimeErr(n1, L.withTimes(n0, (t) => t + 2)) < 1e-6);
  // Grids whose bars start on beats[phase::4]; section edges on those bars.
  const barGrid = (phase) => {
    const down = TEST_PRESET.beats.filter((_, i) => i % 4 === phase);
    const snap = (t) => (t <= 0 ? 0 : t >= 100 ? 100 : down.reduce((b, d) => (Math.abs(d - t) < Math.abs(b - t) ? d : b), down[0]));
    return { down, sections: TEST_PRESET.sections.map((x) => Object.assign({}, x, { start: snap(x.start), end: snap(x.end) })) };
  };
  const g3 = barGrid(3);
  const phased = Object.assign({}, TEST_PRESET, { lines: [], downbeatPhase: 3, sections: g3.sections });
  const tp = L.parse(txt, { preset: phased });
  const onBar = tp.lines.filter((l) => g3.down.some((d) => near(d, l.start, 1e-6))).length;
  const onWrong = tp.lines.filter((l) => TEST_PRESET.beats.some((b, i) => i % 4 === 0 && near(b, l.start, 1e-6))).length;
  check('auto + preset grid: snaps to true downbeats (downbeatPhase)', onBar >= tp.lines.length - 1 && onWrong === 0, `${onBar}/${tp.lines.length} on beats[3::4], ${onWrong} on beats[0::4]`);
  const g1 = barGrid(1);
  const fb = { duration: 100, sections: g1.sections, beats: TEST_PRESET.beats, beatsPerBar: 4, downbeatPhase: 1 };
  const tf = L.parse(txt, { features: fb });
  const onF = tf.lines.filter((l) => g1.down.some((d) => near(d, l.start, 1e-6))).length;
  check('auto + features without downbeats: bars from downbeatPhase', onF >= tf.lines.length - 1, `${onF}/${tf.lines.length}`);
}

console.log('--- minimal preset (no end / t-only lines) ---');
{
  const txt = ['一行目の架空の歌詞 そのさき', '二行目 まだ続く架空の言葉', '三行目の架空'];
  const mini = {
    id: 'test-mini', meta: { title: 'Mini' }, leadIn: 0.5,
    lines: [
      { n: 1, key: MV.lyricKey(txt[0]), len: Array.from(txt[0]).length, phrases: [{ at: 0, t: 5 }, { at: 10, t: 7 }] },
      { n: 2, key: MV.lyricKey(txt[1]), len: Array.from(txt[1]).length, t: 7.9 },
      { n: 3, key: MV.lyricKey(txt[2]), len: Array.from(txt[2]).length, phrases: [{ at: 0, t: 20 }] },
    ],
  };
  const tr = L.parse(txt.join('\n'), { preset: mini });
  check('mini: 3 lines, leadIn honoured', tr.lines.length === 3 && near(tr.lines[0].showStart, 4.5), tr.lines.length);
  check('mini: estimated end capped by next start', tr.lines[0].end <= tr.lines[1].start - 0.02 + 1e-9 && tr.lines[0].end > tr.lines[0].phrases[1].start, tr.lines[0].end.toFixed(2));
  check('mini: t-only line → one phrase', tr.lines[1].phrases.length === 1 && near(tr.lines[1].start, 7.9));
  check('mini: invariants', lineInvariants(tr).length === 0, lineInvariants(tr).slice(0, 4).join(','));
  check('mini: auto styles filled', tr.lines.every((l) => l.style && l.styleSource === 'auto'), tr.lines.map((l) => l.style).join(','));
  const plain = L.parse('[00:03.00]一行目の架空 二行目へ Keep it going\n[00:09.00]次の架空の行', {});
  const pl = plain.lines[0];
  check('plain LRC: phrases per segment, Latin words grouped', pl.phrases.length === 3 && pl.phrases[2].latin && near(pl.start, 3) && pl.end <= 9 + 1e-9, pl.phrases.length + ' end ' + pl.end.toFixed(2));
}

console.log('--- isMetaLine ---');
{
  const yes = ['作詞：作者A', '作曲: 作者B', '編曲：someone', '歌手：Test Artist', '歌：誰か', 'Vocal: Somebody', 'Lyrics：X', 'Music: Y',
    'Composer : Z', 'Music by Someone', '作詞・作曲：作者C', '（テスト用の架空の歌詞）', '(Instrumental)', '[Chorus]', '【MV用】',
    '# Title', '---', '[ti:Something]', '♪ ♪ ♪', 'Chorus', 'Verse 2:'];
  const no = ['夜明けの駅で 君を待つ', 'We’re paper stars', '走り出すんだ (今夜) Keep going', '「さよなら」と言えずに', 'Music is all we need tonight',
    '歌を歌おう 空の下で'];
  check('isMetaLine: credit/bracket/header lines', yes.every((s) => L.isMetaLine(s)), yes.filter((s) => !L.isMetaLine(s)).length + ' missed');
  check('isMetaLine: lyric lines kept', no.every((s) => !L.isMetaLine(s)), no.filter((s) => L.isMetaLine(s)).length + ' false positives');
  check('isMetaLine: bold first line = title', L.isMetaLine('**Some Title**', { first: true }) && !L.isMetaLine('**Some Title**'));
  check('isMetaLine: first line containing preset title', L.isMetaLine('紙の星座 - short', { first: true, preset: TEST_PRESET }));
  // First line followed by credits (no preset) is a title.
  const tr = L.parse('架空のタイトル\n作詞：A\n作曲：B\n\n夜明けの駅で 君を待つ\n錆びた線路が 知らない街へ', {});
  check('auto: title line before credits goes to unmatched', tr.unmatched.length === 3 && tr.lines.length === 2, tr.unmatched.length + '/' + tr.lines.length);
}

console.log('--- LRC ---');
{
  const lrc = [
    '[ti:架空の曲]',
    '[ar:Test Artist]',
    '[offset:+500]',
    'some header without stamp',
    '[00:10.00]夜明けの駅で 君を待つ',
    '[00:14.50]',
    '[00:20.00][01:20.00]{ransom}紙の星座を 胸に抱いて',
    '[00:25.00]<00:25.00>走り出すんだ <00:26.40>今夜 <00:27.30>We’re paper stars<00:29.90>',
    '[00:31.00]灯せ 遠く 高く 今',
  ].join('\n');
  const tr = L.parse(lrc, {});
  check('lrc: source', tr.source === 'lrc');
  check('lrc: lines (multi-stamp expanded)', tr.lines.length === 5, tr.lines.length);
  check('lrc: meta tags', tr.meta.title === '架空の曲' && tr.meta.artist === 'Test Artist');
  check('lrc: offset tag applied (+500 ms → earlier)', near(tr.lines[0].start, 9.5));
  check('lrc: blank stamped line ends previous line', near(tr.lines[0].end, 14.0), tr.lines[0].end);
  check('lrc: {style} tag', tr.lines[1].style === 'ransom' && tr.lines[1].styleSource === 'tag' && tr.lines[4].style === 'ransom');
  check('lrc: multi-stamp second copy at 79.5', near(tr.lines[4].start, 79.5), tr.lines[4].start);
  const en = tr.lines[2];
  check('lrc: enhanced phrases', en.phrases.length === 3 && near(en.phrases[1].start, 25.9) && near(en.phrases[2].start, 26.8) && near(en.end, 29.4) && en.phrases[2].latin,
    en.phrases.map((p) => p.start.toFixed(2)).join(','));
  check('lrc: unstamped lines → unmatched', tr.unmatched.length === 1);
  check('lrc: invariants', lineInvariants(tr).length === 0, lineInvariants(tr).slice(0, 4).join(','));
  const alt = L.parse('[00:05.5]一行目の架空の歌詞\n[00:08:25]二行目の架空の歌詞\n[0:12.125]三行目', {});
  check('lrc: [mm:ss.x] [mm:ss:xx] [m:ss.xxx] stamps', alt.lines.length === 3 && near(alt.lines[0].start, 5.5) && near(alt.lines[1].start, 8.25) && near(alt.lines[2].start, 12.125));
  check('lrc: offset option adds', near(L.parse('[00:05.00]架空の行', { offset: -1 }).lines[0].start, 4.0));
  // As in the app: all eight required lyric styles are registered.
  ['ransom', 'slash', 'impact', 'dialog', 'vertical', 'card', 'split', 'glitch'].forEach((n) => MV.lyricStyles.register(n, { layout() {}, draw() {} }));
  const unk = L.parse('[00:05.00]{nosuchstyle}架空の行です\n[00:08.00]{ransom}架空の次の行', {});
  check('lrc: unknown {style} → auto + warning, known kept', unk.lines[0].styleSource === 'auto' && unk.warnings.length === 1 && unk.lines[1].style === 'ransom', unk.lines[0].style);
}

console.log('--- LRC round-trip ---');
{
  const cases = {
    preset: L.parse(pasteOf(FIX_TEXT, { header: true }), { preset: TEST_PRESET, offset: 0.337 }),
    lrc: L.parse('[00:10.00]{glitch}夜明けの駅で 君を待つ\n[00:14.50]<00:14.50>Keep <00:15.00>moving <00:15.50>on<00:17.00>\n', {}),
    auto: L.parse(FIX_TEXT.join('\n'), { features: { duration: 120, sections: TEST_PRESET.sections, downbeats: [2, 4.4, 6.8, 9.2, 11.6, 14, 16.4, 18.8, 21.2, 23.6, 26, 28.4, 30.8, 33.2] } }),
  };
  for (const [name, tr] of Object.entries(cases)) {
    const s = L.toLRC(tr);
    const back = L.parse(s, {});
    const err = maxTimeErr(back, tr);
    check('round-trip ' + name + ': lines/text', sameText(back, tr), back.lines.length + '/' + tr.lines.length);
    check('round-trip ' + name + ': times within 10 ms', err <= 0.010, (err * 1000).toFixed(2) + ' ms');
    check('round-trip ' + name + ': styles', back.lines.every((l, i) => l.style === tr.lines[i].style));
    check('round-trip ' + name + ': charTimes within 10 ms', back.lines.every((l, i) => l.charTimes.every((t, j) => Math.abs(t - tr.lines[i].charTimes[j]) <= 0.0101)));
    check('round-trip ' + name + ': idempotent text', L.toLRC(back) === s);
  }
}

console.log('--- auto mode ---');
{
  // Bar-aligned sections, like the analysis produces.
  const AUTO_SECTIONS = TEST_PRESET.sections.map((s) => Object.assign({}, s, { start: Math.round(s.start / 2.5) * 2.5, end: Math.round(s.end / 2.5) * 2.5 }));
  const feats = {
    duration: 100,
    sections: AUTO_SECTIONS,
    downbeats: Array.from({ length: 41 }, (_, i) => i * 2.5),
  };
  const txt = FIX_TEXT.slice(0, 6).join('\n') + '\n\n' + FIX_TEXT.slice(6).join('\n');
  const tr = L.parse(txt, { features: feats });
  check('auto: source', tr.source === 'auto' && tr.lines.length === FIX_TEXT.length, tr.source + ' ' + tr.lines.length);
  check('auto: warning emitted', tr.warnings.length === 1);
  check('auto: starts increasing', tr.lines.every((l, i) => i === 0 || l.start > tr.lines[i - 1].start));
  const onBeat = tr.lines.filter((l) => feats.downbeats.some((d) => near(d, l.start, 1e-6))).length;
  check('auto: snapped to downbeats', onBeat >= tr.lines.length - 1, onBeat + '/' + tr.lines.length);
  const inVocal = tr.lines.filter((l) => {
    const s = AUTO_SECTIONS.find((x) => l.start >= x.start && l.start < x.end);
    return s && !['intro', 'interlude', 'outro'].includes(s.kind);
  }).length;
  check('auto: inside vocal sections', inVocal === tr.lines.length, inVocal + '/' + tr.lines.length);
  check('auto: invariants', lineInvariants(tr).length === 0, lineInvariants(tr).slice(0, 4).join(','));
  const t2 = L.parse(FIX_TEXT.join('\n'), {});
  check('auto without features', t2.source === 'auto' && t2.lines.length === FIX_TEXT.length && lineInvariants(t2).length === 0);
  const long = L.parse('あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ', {});
  check('auto: long unspaced line split into phrases', long.lines[0].phrases.length >= 3, long.lines[0].phrases.length);
  check('none: empty input', ['', '   \n \r\n', null, undefined].every((x) => L.parse(x, {}).source === 'none'));
  check('none: header only', L.parse(HEADER.join('\n'), { preset: TEST_PRESET }).source === 'none');
  check('detectMode', L.detectMode('[00:01.00]x') === 'lrc' && L.detectMode('abc') === 'plain' && L.detectMode(' ') === 'empty');
}

console.log('--- assignStyles ---');
{
  const mk = (text, kind, phrases) => {
    const line = MV.devLine(phrases || [text], { start: 0 });
    line.style = null;
    line.sectionKind = kind;
    line.key = MV.lyricKey(line.text);
    return line;
  };
  const tr = {
    lines: [
      mk('', 'verse', ['夜明けの駅で', '君を待つ']),
      mk('', 'verse', ['錆びた線路が', '続いてる']),
      mk('', 'pre', ['窓に映る', '赤い信号が']),
      mk('', 'chorus', ['紙の星座を', '胸に抱いて']),
      mk('', 'chorus', ['走り出す今夜', 'Keep moving on']),
      mk('', 'hook', ['灯せ遠く高く今よ']),
      mk('', 'verse', ['短い']),
      mk('', 'bridge', ['静かな夜の', '屋上で']),
      mk('', 'bridge', ['静かな', 'Paper stars']),
      mk('', 'outro', ['またいつか', '会える日まで']),
      mk('', 'chorus', ['紙の星座を', '胸に抱いて']),
    ],
  };
  tr.lines.forEach((l, i) => (l.index = i));
  L.assignStyles(tr, null);
  const st = tr.lines.map((l) => l.style);
  const want = ['dialog', 'slash', 'glitch', 'ransom', 'ransom', 'impact', 'impact', 'vertical', 'dialog', 'card', 'ransom'];
  check('assignStyles heuristics', st.every((s, i) => s === want[i]), st.join(','));
  check('assignStyles styleSource auto', tr.lines.every((l) => l.styleSource === 'auto'));
  const pre = { lines: [mk('', 'chorus', ['紙の星座を', '胸に抱いて']), mk('', 'chorus', ['紙の星座を', '胸に抱いて'])] };
  pre.lines[0].style = 'glitch';
  pre.lines[0].styleSource = 'tag';
  L.assignStyles(pre);
  check('assignStyles: repeat reuses first style', pre.lines[1].style === 'glitch');
}

console.log('--- withTimes / clone ---');
{
  const tr = L.parse(pasteOf(FIX_TEXT), { preset: TEST_PRESET });
  const sh = L.withTimes(tr, (t) => t + 2);
  check('withTimes: shifts everything', maxTimeErr(sh, L.withTimes(tr, (t) => t)) > 1.99 && sh.lines.every((l, i) => near(l.start, tr.lines[i].start + 2) && near(l.showStart, tr.lines[i].showStart + 2)));
  check('withTimes: charTimes shifted', sh.lines.every((l, i) => l.charTimes.every((c, j) => Math.abs(c - tr.lines[i].charTimes[j] - 2) < 1e-3)));
  check('withTimes: original untouched', near(tr.lines[0].start, 8.2));
  const one = L.withTimes(tr, (t, info) => (info.lineIndex === 1 && info.phrase >= 1 ? t + 0.5 : t));
  check('withTimes: per-phrase remap', near(one.lines[1].phrases[1].start, tr.lines[1].phrases[1].start + 0.5) && near(one.lines[1].phrases[0].end, one.lines[1].phrases[1].start) && near(one.lines[0].start, tr.lines[0].start));
  check('withTimes: invariants', lineInvariants(one).length === 0);
  const c = L.clone(tr);
  c.lines[0].phrases[0].start = 99;
  check('clone: deep', tr.lines[0].phrases[0].start === 8.2 && c.lines[0].charTimes !== tr.lines[0].charTimes);
}

/* ------------------------------------------------------------------ */
/* Real preset + local lyrics files (read at test time, never printed) */
/* ------------------------------------------------------------------ */
console.log('--- real preset (local files) ---');
{
  const REAL = MV.getPreset('hoshi-to-bokura-to');
  const files = [process.env.MV_LYRICS_PASTE, process.env.MV_LYRICS, path.join(ROOT, 'assets/lyrics.txt')].filter((f) => f && fs.existsSync(f));
  if (!files.length) console.log('SKIP real-lyrics tests (set MV_LYRICS / MV_LYRICS_PASTE)');
  const shownN = REAL.lines.filter((l) => !l.skip).length;
  const skipN = REAL.lines.filter((l) => l.skip).length;
  for (const f of Array.from(new Set(files))) {
    const tag = 'real[' + path.basename(f).replace(/\.[^.]+$/, '') + ']';
    const txt = fs.readFileSync(f, 'utf8');
    const rawNonEmpty = txt.split(/\r\n|\r|\n/).filter((s) => s.trim());
    // Header = leading non-empty raw lines whose key matches no preset line.
    const keys = new Set(REAL.lines.map((l) => l.key));
    let headerN = 0;
    while (headerN < rawNonEmpty.length && !keys.has(MV.lyricKey(MV.canonDisplay(rawNonEmpty[headerN].replace(/\*\*/g, ''))))) headerN++;
    const t0 = Date.now();
    const tr = L.parse(txt, { preset: REAL });
    const ms = Date.now() - t0;
    checkPresetTrack(tag, tr, REAL, { matched: shownN, unmatched: headerN });
    check(tag + ': matched 12 / skipped 5', tr.matched.matched === 12 && tr.matched.skipped === 5 && skipN === 5, tr.matched.matched + '/' + tr.matched.skipped);
    const headDisp = rawNonEmpty.slice(0, headerN).map((h) => MV.canonDisplay(h.replace(/\*\*/g, '')));
    check(tag + ': unmatched == header lines only', tr.unmatched.length === headerN && tr.unmatched.every((u, i) => u === headDisp[i]), 'header lines ' + headerN);
    check(tag + ': no warnings', tr.warnings.length === 0, tr.warnings.length);
    check(tag + ': styles/sections', tr.lines.every((l) => l.style && l.sectionKind), tr.lines.map((l) => l.sectionKind[0]).join(''));
    console.log('      ' + tag + ' parse ms ' + ms + ', lines ' + tr.lines.length + ', phrases ' + tr.lines.reduce((a, l) => a + l.phrases.length, 0) +
      ', latin phrases ' + tr.lines.reduce((a, l) => a + l.phrases.filter((p) => p.latin).length, 0) + ', hooks ' + tr.lines.filter((l) => l.isHook).length);

    const variants = {
      crlf: txt.replace(/\r?\n/g, '\r\n'),
      fullwidthSpaces: txt.replace(/ /g, '\u3000'),
      doubleFullwidth: txt.replace(/ +/g, '\u3000\u3000'),
      straightApostrophes: txt.replace(/[’‘]/g, "'"),
      curlyApostrophes: txt.replace(/'/g, '’'),
      noBlankLines: txt.split(/\r?\n/).filter((s) => s.trim()).join('\n'),
      trailingSpaces: txt.split(/\r?\n/).map((s) => s + (s.trim() ? '  ' : '')).join('\n'),
    };
    for (const [name, v] of Object.entries(variants)) {
      const t2 = L.parse(v, { preset: REAL });
      const bad = lineInvariants(t2);
      const pc = t2.lines.every((l) => l.phrases.length === REAL.lines.find((x) => x.n === l.n).phrases.length);
      const p0 = t2.lines.every((l) => l.phrases[0].start === REAL.lines.find((x) => x.n === l.n).phrases[0].t);
      check(tag + ' variant ' + name, t2.matched.matched === 12 && t2.matched.skipped === 5 && t2.lines.length === 12 && t2.unmatched.length === headerN && pc && p0 && !bad.length,
        t2.matched.matched + '/' + t2.matched.skipped + '/' + t2.unmatched.length + (bad.length ? ' ' + bad[0] : ''));
    }
    // One character deleted in every non-header line, one line at a time.
    const lines = txt.split(/\r?\n/);
    const lyricIdx = [];
    lines.forEach((s, i) => {
      if (s.trim() && keys.has(MV.lyricKey(MV.canonDisplay(s)))) lyricIdx.push(i);
    });
    let displayed = 0;
    let phrasesKept = 0;
    let timesKept = 0;
    let fbTotal = 0;
    lyricIdx.forEach((li) => {
      const copy = lines.slice();
      const arr = Array.from(copy[li]);
      const firstNon = arr.findIndex((c) => c.trim());
      arr.splice(firstNon + 1, 1); // drop the 2nd char of the line
      copy[li] = arr.join('');
      const t2 = L.parse(copy.join('\n'), { preset: REAL });
      if (t2.lines.length === 12 && lineInvariants(t2).length === 0 && t2.matched.skipped === 5) displayed++;
      if (t2.lines.every((l) => l.phrases.length === REAL.lines.find((x) => x.n === l.n).phrases.length)) phrasesKept++;
      if (t2.lines.every((l) => l.phrases.every((p, k) => near(p.start, REAL.lines.find((x) => x.n === l.n).phrases[k].t)))) timesKept++;
      fbTotal += t2.matched.fallback;
    });
    check(tag + ' char-deleted: 12 lines displayed in every variant', displayed === lyricIdx.length, displayed + '/' + lyricIdx.length);
    check(tag + ' char-deleted: phrase counts kept', phrasesKept === lyricIdx.length, phrasesKept + '/' + lyricIdx.length);
    check(tag + ' char-deleted: phrase times kept', timesKept === lyricIdx.length, timesKept + '/' + lyricIdx.length + ', fallback lines ' + fbTotal);
    // Space deleted inside the long bridge line (same key, shorter text).
    const bridge = REAL.lines.find((l) => l.phrases && l.phrases.length === 8);
    const bi = lines.findIndex((s) => s.trim() && MV.lyricKey(MV.canonDisplay(s)) === bridge.key);
    if (bi >= 0) {
      const copy = lines.slice();
      copy[bi] = MV.canonDisplay(copy[bi]).replace(' ', '');
      const t2 = L.parse(copy.join('\n'), { preset: REAL });
      const bl = t2.lines.find((l) => l.n === bridge.n);
      check(tag + ' space-deleted bridge line: 8 phrases, key match', bl && bl.phrases.length === 8 && bl.match === 'key' && lineInvariants(t2).length === 0);
    }
    // LRC round trip on the real track.
    const s = L.toLRC(tr);
    const back = L.parse(s, {});
    const err = maxTimeErr(back, tr);
    check(tag + ' LRC round-trip', sameText(back, tr) && err <= 0.01 && back.lines.every((l, i) => l.style === tr.lines[i].style), (err * 1000).toFixed(2) + ' ms');
    const withOff = L.parse(txt, { preset: REAL, offset: -0.42 });
    const e2 = maxTimeErr(L.parse(L.toLRC(withOff), {}), withOff);
    check(tag + ' LRC round-trip with offset', e2 <= 0.01, (e2 * 1000).toFixed(2) + ' ms');
    // Perf.
    const N = 200;
    const tp = Date.now();
    for (let i = 0; i < N; i++) L.parse(txt, { preset: REAL });
    console.log('      ' + tag + ' parse avg ' + ((Date.now() - tp) / N).toFixed(2) + ' ms');
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}

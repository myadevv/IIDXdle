/* 譜面当て: 画面に依存しない中核ロジック(Node でもテストできる) */
(function (root) {
  'use strict';
  var CONFIG = { MAX_TRIES: 5, MIN_NOTES: 1, MIN_HEIGHT: 64, MIN_GAP: 8, SHORT_CHART: 50, MIN_GAP_SHORT: 4, SALT: 'iidx-bpl-s6-quiz', TZ: 'Asia/Tokyo' };
  var JST_OFFSET_MS = 9 * 3600 * 1000;                 // 日本は夏時間なし

  /** 日本時間(JST)の日付 'YYYY-MM-DD'。0時で切り替わる */
  function jstDate(now) {
    var d = new Date((now || new Date()).getTime() + JST_OFFSET_MS);
    return d.toISOString().slice(0, 10);
  }
  /** 次の0時(JST)までのミリ秒 */
  function msUntilNextJstMidnight(now) {
    var t = (now || new Date()).getTime() + JST_OFFSET_MS;
    return (Math.floor(t / 86400000) + 1) * 86400000 - t;
  }

  /* 文字列 → 乱数(再現性あり) */
  function xmur3(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return function () { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
  }
  function mulberry32(a) {
    return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function rngFor(label) { return mulberry32(xmur3(CONFIG.SALT + '|' + label)()); }

  /** 今日の曲。puzzles は id 順に並べてから選ぶので、配列の並びに依存しない */
  function pickPuzzle(date, puzzles) {
    if (!puzzles.length) return null;
    var sorted = puzzles.slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    return sorted[Math.floor(rngFor('song|' + date)() * sorted.length)];
  }

  /** 出題に使える小節(空の小節・極端に短い端数小節は除く) */
  function eligibleMeasures(chart) {
    return chart.measures.filter(function (m) { return m.notes.length + (m.c ? m.c.length : 0) >= CONFIG.MIN_NOTES && m.h >= CONFIG.MIN_HEIGHT; });
  }
  /** 今日の小節(最初の1つ + 不正解ごとに1つ。重複なし、最大 MAX_TRIES)。
      どの2小節も小節番号が離れるように選ぶ: 50小節以下の譜面は4小節以上、50小節を超える譜面は8小節以上。離せない譜面だけ、足りない分を近い小節で補う */
  function minGap(chart) { return chart.measures.length <= CONFIG.SHORT_CHART ? CONFIG.MIN_GAP_SHORT : CONFIG.MIN_GAP; }
  function pickMeasures(chart, date) {
    var pool = eligibleMeasures(chart).slice().sort(function (a, b) { return a.n - b.n; });
    var rng = rngFor('measures|' + date + '|' + chart.id), need = Math.min(CONFIG.MAX_TRIES, pool.length), gap = minGap(chart), best = [], order;
    function far(m, chosen) { return chosen.every(function (c) { return Math.abs(c.n - m.n) >= gap; }); }
    for (var attempt = 0; attempt < 400 && best.length < need; attempt++) {
      order = pool.slice();
      for (var i = order.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; }
      var chosen = [];
      for (var k = 0; k < order.length && chosen.length < need; k++) if (far(order[k], chosen)) chosen.push(order[k]);
      if (chosen.length > best.length) best = chosen;
    }
    if (best.length < need) {                    // 離しきれない譜面: 残りは他の小節から、できるだけ離れたものを足す
      var rest = pool.filter(function (m) { return best.indexOf(m) < 0; });
      while (best.length < need && rest.length) {
        var bi = 0, bd = -1;
        rest.forEach(function (m, idx) { var d = Math.min.apply(null, best.map(function (c) { return Math.abs(c.n - m.n); }).concat([999])); if (d > bd) { bd = d; bi = idx; } });
        best.push(rest.splice(bi, 1)[0]);
      }
    }
    return best;
  }

  /** 検索用の正規化(全角半角・大小文字・記号を無視)。記号だけの曲名は記号を残す */
  function normalize(s) {
    var n = String(s).normalize('NFKC').toLowerCase();
    var stripped = n.replace(/[\s\p{P}\p{S}]+/gu, '');
    return stripped || n.replace(/\s+/g, '');
  }
  /* 検索用: 見た目が似ている特殊文字を英字に読み替える(絵文字・記号は対象外)。
     読みが複数ありうる文字は候補をすべて試す(例: Λ は VIBRΛ では a、ΕΛΠΙΣ では l) */
  var LOOK = {
    'æ': ['ae'], 'ø': ['o'], 'ə': ['e'], 'ә': ['e'], 'ʞ': ['k'], 'Ʇ': ['k'], 'Ʞ': ['k'], 'ꓘ': ['k'],
    'χ': ['x'], 'х': ['x'], 'ξ': ['e', 'x'], 'λ': ['y', 'l', 'a'], 'α': ['a'], 'β': ['b'], 'ε': ['e'],
    'ι': ['i'], 'ο': ['o'], 'π': ['n', 'p'], 'σ': ['s'], 'ς': ['s'], 'τ': ['t'], 'φ': ['o', 'f'],
    'и': ['n', 'i'], '0': ['0', 'o'], 'я': ['r'], '∀': ['a'], '∞': ['o'], 'ŧ': ['t']
  };
  function stripMarks(str) { return str.normalize('NFD').replace(/\p{M}+/gu, ''); }
  /** 検索キーの一覧。先頭は通常の正規化、以降は特殊文字を英字に読み替えたもの */
  function searchKeys(s) {
    var base = stripMarks(String(s).normalize('NFKC').toLowerCase());
    var keys = [normalize(base)], parts = [''], changed = false;
    var chars = Array.from(base);                // サロゲートペアも1文字として扱う
    function wordy(c) { return !!c && (/[\p{L}\p{N}]/u.test(c)); }
    for (var ci = 0; ci < chars.length; ci++) {
      var ch = chars[ci], alts = LOOK[ch];
      if (ch === '!' && wordy(chars[ci - 1]) && wordy(chars[ci + 1])) alts = ['', 'i'];   // S!ck, PØT!0И の ! は i
      if (!alts) { parts = parts.map(function (p) { return p + ch; }); continue; }
      changed = true;
      var next = [];
      parts.forEach(function (p) { alts.forEach(function (a) { next.push(p + a); }); });
      parts = next.slice(0, 64);                 // 組み合わせが増えすぎないように上限
    }
    if (changed) parts.forEach(function (p) { var k = normalize(p); if (keys.indexOf(k) < 0) keys.push(k); });
    return keys;
  }
  /** 回答欄の候補: 完全一致 → 前方一致 → 部分一致。すでに回答した曲は除く */
  function suggest(titles, query, exclude, limit) {
    var q = normalize(stripMarks(String(query).normalize('NFKC').toLowerCase())); if (!q) return [];
    var ex = {}; (exclude || []).forEach(function (t) { ex[t] = 1; });
    var exact = [], starts = [], inc = [];
    for (var i = 0; i < titles.length; i++) {
      var t = titles[i]; if (ex[t]) continue;
      var keys = searchKeys(t), rank = 3;
      for (var j = 0; j < keys.length; j++) {
        var n = keys[j];
        if (n === q) { rank = 0; break; }
        if (n.indexOf(q) === 0) rank = Math.min(rank, 1); else if (n.indexOf(q) > 0) rank = Math.min(rank, 2);
      }
      if (rank === 0) exact.push(t); else if (rank === 1) starts.push(t); else if (rank === 2) inc.push(t);
    }
    return exact.concat(starts, inc).slice(0, limit || 8);
  }
  /** 入力が候補のどれかと(表記ゆれを除いて)ただ1つに一致するなら、その曲名 */
  function resolveTitle(titles, text) {
    if (titles.indexOf(text) >= 0) return text;
    var q = normalize(text); if (!q) return null;
    var hit = titles.filter(function (t) { return normalize(t) === q; });
    return hit.length === 1 ? hit[0] : null;
  }


  /** 追加ヒント。2回目=カテゴリ、3回目=レベル、4回目=BPM、5回目=作曲家名 の順に1つずつ(固定)。
      戻り値は4枠の配列で、その曲が持っていない項目は null(枠はずらさない) */
  function pickHints(puzzle) {
    return [
      puzzle.cats && puzzle.cats.length ? { label: 'カテゴリ', text: puzzle.cats.join(' / ') } : null,
      puzzle.level != null ? { label: 'レベル', text: '☆' + puzzle.level } : null,
      puzzle.bpm ? { label: 'BPM', text: puzzle.bpm } : null,
      puzzle.artist ? { label: '作曲家', text: puzzle.artist } : null
    ];
  }
  /** いま見せる枠の数: 1回目0 → 2回目1 → 3回目2 → 4回目3 → 5回目4。終了後は全部 */
  function hintCount(st) { return st.over ? 4 : Math.max(0, Math.min(4, st.revealed - 1)); }

  function isCorrect(puzzle, title) { return title === puzzle.title; }
  /** 回答履歴から状態を求める。tries = この日に使える回数(小節が足りない譜面は5未満) */
  function gameState(puzzle, guesses, tries) {
    var solvedAt = -1;
    for (var i = 0; i < guesses.length; i++) if (isCorrect(puzzle, guesses[i])) { solvedAt = i; break; }
    var over = solvedAt >= 0 || guesses.length >= tries;
    return { solved: solvedAt >= 0, solvedAt: solvedAt, over: over, revealed: Math.min(over ? tries : guesses.length + 1, tries) };
  }

  function shareText(date, puzzle, guesses, tries) {
    var st = gameState(puzzle, guesses, tries), row = '';
    for (var i = 0; i < tries; i++) row += i < guesses.length ? (i === st.solvedAt ? '🟩' : '🟥') : '⬜';
    return 'IIDXdle ' + date + ' ' + (st.solved ? (st.solvedAt + 1) : 'X') + '/' + tries + '\n' + row;
  }

  /** 1小節を描くSVG文字列(数値だけから組み立てる)。縦はmeasure.h、横は134px(皿36 + 鍵盤7×14) */
  function measureSvg(m) {
    var W = 134, h = m.h, s = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + h + '" width="' + W + '" height="' + h + '" shape-rendering="crispEdges" role="img" aria-label="譜面の1小節">'];
    s.push('<rect class="bg" width="' + W + '" height="' + h + '"/>');
    s.push('<rect class="lane-s" x="0" y="0" width="36" height="' + h + '"/>');
    for (var k = 0; k < 7; k++) s.push('<rect class="lane-' + (k % 2 ? 'b' : 'w') + '" x="' + (37 + 14 * k) + '" y="0" width="13" height="' + h + '"/>');
    for (var b = 1; b < 4; b++) s.push('<rect class="beat" x="0" y="' + Math.round(h * b / 4) + '" width="' + W + '" height="1"/>');
    var cs = m.c || [];                           // CN/HCN の本体(ノーツより下に描く)
    for (var j = 0; j < cs.length; j++) {
      var c = cs[j], y0 = Math.max(0, c[2]), y1 = Math.min(h, c[2] + c[3]);
      if (y1 > y0) s.push('<rect class="c-' + c[0] + (c[4] ? ' hcn' : '') + '" x="' + c[1] + '" y="' + y0 + '" width="' + (c[0] === 's' ? 32 : 11) + '" height="' + (y1 - y0) + '"/>');
    }
    for (var i = 0; i < m.notes.length; i++) {
      var n = m.notes[i];
      s.push('<rect class="n-' + n[0] + '" x="' + n[1] + '" y="' + Math.max(0, n[2]) + '" width="' + (n[0] === 's' || n[0] === 'r' ? 36 : 13) + '" height="4"/>');
    }
    return s.join('') + '</svg>';
  }

  var api = { CONFIG: CONFIG, jstDate: jstDate, msUntilNextJstMidnight: msUntilNextJstMidnight, rngFor: rngFor, pickPuzzle: pickPuzzle,
    eligibleMeasures: eligibleMeasures, pickMeasures: pickMeasures, minGap: minGap, pickHints: pickHints, hintCount: hintCount, normalize: normalize, searchKeys: searchKeys, suggest: suggest, resolveTitle: resolveTitle,
    isCorrect: isCorrect, gameState: gameState, shareText: shareText, measureSvg: measureSvg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QuizCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

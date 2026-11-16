(function () {
  'use strict';
  var C = window.QuizCore, $ = function (id) { return document.getElementById(id); };
  var qs = new URLSearchParams(location.search);
  var debugDate = /^\d{4}-\d{2}-\d{2}$/.test(qs.get('date') || '') ? qs.get('date') : null;
  var date = debugDate || C.jstDate();
  var KEY = 'bplquiz:v1:' + date;

  var testMode = false, seedKey = date, manifest, puzzle, picked, tries, guesses = [], selected = null, active = -1, shown = [];

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function save() { if (testMode) return; try { localStorage.setItem(KEY, JSON.stringify(guesses)); } catch (e) { /* 保存できなくても遊べる */ } }
  function fail(msg) { var e = $('error'); e.hidden = false; e.textContent = msg; }
  function getJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(url + ' (' + r.status + ')'); return r.json(); });
  }

  function init() {
    // config.json が無い・壊れている場合は通常モード
    getJson('config.json').catch(function () { return {}; }).then(function (cfg) {
      testMode = !!(cfg && cfg.testMode);
      if (testMode) seedKey = 'test-' + Date.now().toString(36) + Math.random().toString(36).slice(2);   // 読み込むたびに別の問題
      $('datebadge').textContent = testMode ? 'テストモード: 更新するたびに別の問題になります(回答は保存されません)'
        : debugDate ? '出題日(デバッグ): ' + date : '出題日: ' + date + '(毎日0時に更新)';
      if (qs.get('reset')) { try { localStorage.removeItem(KEY); } catch (e) {} }
      return getJson('data/manifest.json');
    }).then(function (m) {
      manifest = m; puzzle = C.pickPuzzle(seedKey, m.puzzles);
      if (!puzzle) throw new Error('出題できる譜面データがありません。fetch_charts.py → build_site_data.py を実行してください。');
      return getJson('data/charts/' + puzzle.id + '.json');
    }).then(function (chart) {
      chart.id = puzzle.id; picked = C.pickMeasures(chart, seedKey); tries = picked.length;
      if (!tries) throw new Error('この譜面には出題できる小節がありません: ' + puzzle.id);
      guesses = testMode ? [] : load().slice(0, tries); bind(); render(false);
    }).catch(function (e) {
      var local = location.protocol === 'file:';
      fail((e && e.message || e) + (local ? '  ※ file:// では読み込めません。site フォルダで `python3 -m http.server 8000` を実行し、http://localhost:8000/ を開いてください。' : ''));
      $('play').hidden = true;
    });
  }

  function render(animate) {
    var st = C.gameState(puzzle, guesses, tries);
    // ヒント: 公開済みの小節だけを描く(未公開の小節はDOMにも出さない)
    var box = $('measures'), prev = shown.length;
    for (var i = prev; i < st.revealed; i++) {
      var d = document.createElement('div'); d.className = 'mcard' + (animate ? ' new' : '');
      d.innerHTML = '<b>ヒント ' + (i + 1) + '</b><div class="mrow">' + C.measureSvg(picked[i]) + '<div class="mno">' + picked[i].n + '</div></div>'; box.appendChild(d); shown.push(i);
    }
    // 回数表示
    var pips = $('pips'); pips.innerHTML = '';
    for (var k = 0; k < tries; k++) {
      var li = document.createElement('li');
      if (k < guesses.length) li.className = k === st.solvedAt ? 'ok' : 'ng'; else if (!st.over && k === guesses.length) li.className = 'now';
      pips.appendChild(li);
    }
    // 履歴
    var h = $('history'); h.innerHTML = '';
    guesses.forEach(function (g, idx) {
      if (idx === st.solvedAt) return;
      var li = document.createElement('li'); if (g === '') li.className = 'skip'; li.textContent = g === '' ? 'スキップ' : g; h.appendChild(li);
    });
    $('answer').disabled = st.over; $('skip').disabled = st.over; $('submit').disabled = st.over || !selected;
    if (st.over) { $('hint').textContent = ''; closeSugg(); showResult(st); }
  }

  function showResult(st) {
    var r = $('result'); r.hidden = false; r.className = 'result ' + (st.solved ? 'win' : 'lose');
    var diff = 'SP ' + puzzle.difficulty + ' ☆' + puzzle.level;
    r.innerHTML = '<h2></h2><div class="ans"></div><p class="meta"></p><p><a target="_blank" rel="noopener">TexTage で譜面を見る</a></p>' +
      '<pre></pre><div class="row"><button type="button" id="copy">結果をコピー</button>' + (testMode ? '<button type="button" id="again" class="ghost">別の問題で遊ぶ</button>' : '') + '</div><p class="countdown" id="cd"></p>';
    r.querySelector('h2').textContent = st.solved ? '正解!(' + (st.solvedAt + 1) + '/' + tries + ')' : '残念…';
    r.querySelector('.ans').textContent = puzzle.title;
    r.querySelector('.meta').textContent = puzzle.artist + ' / ' + puzzle.genre + ' / ' + diff;
    var a = r.querySelector('a'); a.href = puzzle.url;
    // 答えの譜面を全ヒント分見せる(未公開だった小節も公開)
    for (var i = shown.length; i < tries; i++) {
      var d = document.createElement('div'); d.className = 'mcard'; d.innerHTML = '<b>ヒント ' + (i + 1) + '</b><div class="mrow">' + C.measureSvg(picked[i]) + '<div class="mno">' + picked[i].n + '</div></div>'; $('measures').appendChild(d); shown.push(i);
    }
    var text = C.shareText(testMode ? 'TEST' : date, puzzle, guesses, tries); r.querySelector('pre').textContent = text;
    $('copy').onclick = function () {
      var b = this, done = function () { b.textContent = 'コピーしました'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { b.textContent = '手動でコピーしてください'; });
      else b.textContent = '手動でコピーしてください';
    };
    if ($('again')) $('again').onclick = function () { location.reload(); };
    tick();
  }
  var timer;
  function tick() {
    var cd = $('cd'); if (!cd) return;
    function fmt(n) { return (n < 10 ? '0' : '') + n; }
    function upd() {
      if (testMode) { cd.textContent = ''; return; }
      var ms = C.msUntilNextJstMidnight(); if (ms <= 1000 && !debugDate) { location.reload(); return; }
      var s = Math.floor(ms / 1000);
      cd.textContent = debugDate ? '' : '次の問題まで ' + fmt(Math.floor(s / 3600)) + ':' + fmt(Math.floor(s / 60) % 60) + ':' + fmt(s % 60);
    }
    clearInterval(timer); upd(); timer = setInterval(upd, 1000);
  }

  /* ---- 回答欄(オートコンプリート) ---- */
  var input, list;
  function closeSugg() { list.hidden = true; list.innerHTML = ''; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
  function openSugg(items) {
    list.innerHTML = '';
    items.forEach(function (t, i) {
      var li = document.createElement('li'); li.id = 'opt' + i; li.setAttribute('role', 'option'); li.textContent = t;
      li.addEventListener('mousedown', function (ev) { ev.preventDefault(); choose(t); });
      list.appendChild(li);
    });
    list.hidden = !items.length; input.setAttribute('aria-expanded', items.length ? 'true' : 'false'); active = -1;
  }
  function setActive(i) {
    var opts = list.children; if (!opts.length) return;
    active = (i + opts.length) % opts.length;
    for (var k = 0; k < opts.length; k++) opts[k].setAttribute('aria-selected', k === active ? 'true' : 'false');
    input.setAttribute('aria-activedescendant', opts[active].id); opts[active].scrollIntoView({ block: 'nearest' });
  }
  function choose(t) { input.value = t; selected = t; closeSugg(); $('hint').textContent = ''; $('submit').disabled = false; }
  function onInput() {
    var v = input.value; selected = C.resolveTitle(manifest.titles, v);
    openSugg(C.suggest(manifest.titles, v, guesses, 8));
    $('submit').disabled = !selected;
    $('hint').textContent = v && !selected ? '候補から曲名を選んでください' : '';
  }
  function submit(title) {
    var st = C.gameState(puzzle, guesses, tries); if (st.over) return;
    guesses.push(title); save(); input.value = ''; selected = null;
    var s2 = C.gameState(puzzle, guesses, tries);
    render(true);
    if (!s2.over) { $('hint').textContent = title === '' ? 'スキップしました。次のヒントです' : '不正解。次のヒントです'; input.focus(); }
  }
  function bind() {
    input = $('answer'); list = $('sugg');
    input.addEventListener('input', onInput);
    input.addEventListener('blur', function () { setTimeout(closeSugg, 100); });
    input.addEventListener('keydown', function (e) {
      if (e.isComposing) return;                         // 日本語入力の変換確定のEnterは無視
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) onInput(); else setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Escape') closeSugg();
      else if (e.key === 'Enter') { e.preventDefault(); if (!list.hidden && active >= 0) choose(list.children[active].textContent); else if (selected) submit(selected); }
    });
    $('form').addEventListener('submit', function (e) { e.preventDefault(); if (selected) submit(selected); });
    $('skip').addEventListener('click', function () { submit(''); });
  }
  init();
})();

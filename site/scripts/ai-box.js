// ai-box.js — 「AIへの指示」ブロックを実行時に差し込む共通スクリプト。
//
// なぜこの方式か:
//   AI向けの指示文（対応する手順書のパス・実行コマンド）を各ページのHTMLに
//   直書きしていると、手順書のパスが変わる・新しい手順書が増えるたびに
//   複数ページを手作業で直すことになる。ここで正本を
//   assets/data/ai-instructions.json の1箇所に集約し、ページ側は
//   「どの機能の指示文を出すか」を data-ai-key で指定するだけにする。
//
// 使い方（個別ブロック）:
//   <div class="ai-box-slot" data-ai-key="diagnostics"></div>
//   を置き、このスクリプトを読み込む（site-chrome.js と同様、パスの深さに
//   合わせて data-ai-data-path でJSONの場所を上書きできる。省略時は
//   ルート相対 /assets/data/ai-instructions.json を使う）。
//
// 1ページに複数機能が乗る場合（例: features/health-check/ は
// 診断・重い時の対処・進化台帳の3つ）は、data-ai-key の異なるスロットを
// 並べるだけでよい。
//
// 使い方（サイト全体の一覧・導線）:
//   <div class="ai-index-slot" data-ai-data-path="..."></div>
//   を置くと、JSON内の全キーを order 順に並べたリンク一覧を出す
//   （「このキットにある、AIに任せられること」の総覧。site-chrome.js の
//   共通フッターの直前に置く想定）。

(function () {
  var DEFAULT_DATA_PATH = '/assets/data/ai-instructions.json';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderBox(slot, entry, index) {
    var copyId = 'ai-copy-text-' + index;
    slot.classList.remove('ai-box-slot');
    slot.classList.add('ai-box');
    slot.innerHTML =
      '<h2>' + entry.title + '</h2>\n' +
      '<div class="ai-sub">このURLをAIに貼って、下の指示をそのままコピペしてください</div>\n' +
      '<div class="ai-copy" id="' + copyId + '">' + escapeHtml(entry.text) + '</div>\n' +
      '<button class="ai-copy-btn" type="button">コピー</button>' +
      (entry.note ? '\n<div class="ai-note">' + entry.note + '</div>' : '');

    var btn = slot.querySelector('.ai-copy-btn');
    var copyEl = document.getElementById(copyId);
    btn.addEventListener('click', function () {
      navigator.clipboard.writeText(copyEl.textContent).then(function () {
        btn.textContent = 'コピーしました';
        setTimeout(function () { btn.textContent = 'コピー'; }, 1500);
      }, function () {
        // クリップボード権限が無い環境（一部ブラウザ設定・自動テスト等）。
        // 失敗をユーザーに偽って伝えない。
        btn.textContent = 'コピーできません（手動で選択してください）';
        setTimeout(function () { btn.textContent = 'コピー'; }, 2500);
      });
    });
  }

  function renderError(slot, key) {
    slot.classList.remove('ai-box-slot');
    slot.classList.add('ai-box');
    slot.innerHTML =
      '<h2>🤖 このページをAIに実装させたい方へ</h2>' +
      '<div class="ai-sub">指示文の読み込みに失敗しました（キー: ' + escapeHtml(key) + '）。' +
      'ページを再読み込みしてください。</div>';
  }

  // JSON内の全キーを order 順に並べたリンク一覧（重複するpageは1回にまとめる）。
  function renderIndex(slot, data) {
    var seenPages = {};
    var rows = Object.keys(data)
      .filter(function (k) { return k.charAt(0) !== '_' && data[k] && data[k].page; })
      .map(function (k) { return { key: k, entry: data[k] }; })
      .sort(function (a, b) { return (a.entry.order || 0) - (b.entry.order || 0); })
      .filter(function (row) {
        // 同じページに複数キーが載っていても（health-checkの3機能等）、
        // 一覧では代表1件だけをそのページへのリンクとして出す。
        if (seenPages[row.entry.page]) return false;
        seenPages[row.entry.page] = true;
        return true;
      });

    if (rows.length === 0) { slot.remove(); return; }

    slot.classList.remove('ai-index-slot');
    slot.classList.add('ai-index');
    slot.innerHTML =
      '<div class="ai-index-title">🤖 このキットで、AIに任せられること</div>\n' +
      '<div class="ai-index-links">\n' +
      rows.map(function (row) {
        var label = row.entry.indexLabel || row.entry.title.replace(/^🤖\s*/, '');
        return '  <a href="' + row.entry.page + '#ai-instructions">' + escapeHtml(label) + '</a>';
      }).join('\n') +
      '\n</div>';
  }

  function loadAndRender(dataPath, onData) {
    fetch(dataPath).then(function (res) { return res.json(); }).then(onData).catch(function () { onData(null); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var boxSlots = document.querySelectorAll('.ai-box-slot');
    var indexSlots = document.querySelectorAll('.ai-index-slot');

    if (boxSlots.length > 0) {
      var boxDataPath = boxSlots[0].getAttribute('data-ai-data-path') || DEFAULT_DATA_PATH;
      loadAndRender(boxDataPath, function (data) {
        boxSlots.forEach(function (slot, i) {
          var key = slot.getAttribute('data-ai-key');
          var entry = data && data[key];
          if (entry) {
            renderBox(slot, entry, i);
          } else {
            renderError(slot, key);
          }
        });
      });
    }

    if (indexSlots.length > 0) {
      var indexDataPath = indexSlots[0].getAttribute('data-ai-data-path') || DEFAULT_DATA_PATH;
      loadAndRender(indexDataPath, function (data) {
        indexSlots.forEach(function (slot) {
          if (data) {
            renderIndex(slot, data);
          } else {
            slot.remove();
          }
        });
      });
    }
  });
})();

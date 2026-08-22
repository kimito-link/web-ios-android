// ai-box.js — 「AIへの指示」ブロックを実行時に差し込む共通スクリプト。
//
// なぜこの方式か:
//   AI向けの指示文（対応する手順書のパス・実行コマンド）を各ページのHTMLに
//   直書きしていると、手順書のパスが変わる・新しい手順書が増えるたびに
//   複数ページを手作業で直すことになる。ここで正本を
//   assets/data/ai-instructions.json の1箇所に集約し、ページ側は
//   「どの機能の指示文を出すか」を data-ai-key で指定するだけにする。
//
// 使い方:
//   <div class="ai-box-slot" data-ai-key="diagnostics"></div>
//   を置き、このスクリプトを読み込む（site-chrome.js と同様、パスの深さに
//   合わせて data-ai-data-path でJSONの場所を上書きできる。省略時は
//   ルート相対 /assets/data/ai-instructions.json を使う）。
//
// 1ページに複数機能が乗る場合（例: features/health-check/ は
// 診断・重い時の対処・進化台帳の3つ）は、data-ai-key の異なるスロットを
// 並べるだけでよい。

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

  document.addEventListener('DOMContentLoaded', function () {
    var slots = document.querySelectorAll('.ai-box-slot');
    if (slots.length === 0) return;

    var dataPath = (slots[0].getAttribute('data-ai-data-path')) || DEFAULT_DATA_PATH;

    fetch(dataPath)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        slots.forEach(function (slot, i) {
          var key = slot.getAttribute('data-ai-key');
          var entry = data[key];
          if (entry) {
            renderBox(slot, entry, i);
          } else {
            renderError(slot, key);
          }
        });
      })
      .catch(function () {
        slots.forEach(function (slot, i) {
          renderError(slot, slot.getAttribute('data-ai-key') || '?');
        });
      });
  });
})();

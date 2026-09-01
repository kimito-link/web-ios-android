// steps.js — トップページの手順カード（①〜④必須／⑤〜⑧おまけ）を実行時に差し込む。
//
// なぜこの方式か:
//   showcase.js と同じ理由。手順カードは「丸数字+キャラ画像+タイトル+説明+詳細トグル」
//   というほぼ同一の構造を持つブロックが10個、以前はHTMLに1個ずつベタ書きされていた
//   （2026-09-01指摘：「全体設計として同じパーツは同じ個所で使うのが常識」）。
//   正本を assets/data/steps.json の1箇所に集約し、ページ側はスロットだけを持つ。
//
// illustHtml/detailHtml はこのキット自身が書いた固定文言のみを許可する構造化データで、
// 外部入力やユーザー投稿は流し込まない前提のため、そのまま innerHTML に差し込む。
//
// 使い方:
//   <div class="steps-slot" data-steps-group="required"></div>
//   <div class="steps-slot" data-steps-group="bonus"></div>

(function () {
  var DEFAULT_DATA_PATH = 'assets/data/steps.json';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  function renderStep(step, isBonus) {
    var titleAttr = step.titleId ? ' id="' + escapeAttr(step.titleId) + '"' : '';
    var bonusBadge = isBonus ? '<span class="badge-bonus">🎁 おまけ・安心材料</span>' : '';
    var illustStyle = step.illustStyle ? ' style="' + escapeAttr(step.illustStyle) + '"' : '';
    var comment = step.beforeToggleComment ? '<!-- ' + step.beforeToggleComment + ' -->' : '';

    var toggleAndDetail = '';
    if (!step.noToggle) {
      toggleAndDetail =
        '<button class="toggle-btn" onclick="toggle(this)">▼ くわしく見る</button>' +
        comment +
        '<div class="step-detail">' + (step.detailHtml || '') + '</div>';
    }
    var afterIllust = step.afterIllustHtml || '';

    return (
      '<div class="step' + (isBonus ? ' step-bonus' : '') + '">' +
        '<div class="step-top">' +
          '<div class="step-circle">' + escapeHtml(step.circle) + '</div>' +
          '<div class="step-main">' +
            '<h3' + titleAttr + '>' + escapeHtml(step.title) + bonusBadge + '</h3>' +
            '<p class="one-line">' + escapeHtml(step.oneLine) + '</p>' +
          '</div>' +
          '<div class="step-char">' +
            '<img src="images/' + escapeAttr(step.char) + '" alt="' + escapeAttr(step.charName) + '">' +
            '<span>' + escapeHtml(step.charName) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="illust"' + illustStyle + '>' + (step.illustHtml || '') + '</div>' +
        afterIllust +
        toggleAndDetail +
      '</div>'
    );
  }

  function render(slot, data) {
    if (!data) {
      slot.innerHTML = '<p class="showcase-error">手順の読み込みに失敗しました。ページを再読み込みしてください。</p>';
      return;
    }
    var group = slot.getAttribute('data-steps-group') || 'required';
    var isBonus = group === 'bonus';
    var list = Array.isArray(data[group]) ? data[group] : [];
    slot.innerHTML = list.map(function (step) { return renderStep(step, isBonus); }).join('\n');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var slots = document.querySelectorAll('.steps-slot');
    if (slots.length === 0) return;
    var dataPath = slots[0].getAttribute('data-steps-data-path') || DEFAULT_DATA_PATH;
    fetch(dataPath)
      .then(function (res) { return res.json(); })
      .then(function (data) { slots.forEach(function (slot) { render(slot, data); }); })
      .catch(function () { slots.forEach(function (slot) { render(slot, null); }); });
  });
})();

// auto-list.js — トップページ「🤖 自動でやってくれること一覧」を実行時に差し込む。
//
// なぜこの方式か: steps.js・more-links.js・showcase.js と同じ理由。バッジ種別
// （auto/once/wait）が違うだけの行がHTMLにベタ書きされていた（2026-09-01指摘）。
// 正本を assets/data/auto-list.json の1箇所に集約する。

(function () {
  var DEFAULT_DATA_PATH = 'assets/data/auto-list.json';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  function renderRow(item, badgeText) {
    var text = badgeText[item.badge] || item.badge;
    return (
      '<div class="auto-row">' +
        '<span class="badge badge-' + escapeAttr(item.badge) + '">' + escapeHtml(text) + '</span>' +
        '<span class="auto-label">' + escapeHtml(item.label) + '</span>' +
      '</div>'
    );
  }

  function render(slot, data) {
    if (!data || !Array.isArray(data.items)) {
      slot.innerHTML = '<p class="showcase-error">一覧の読み込みに失敗しました。ページを再読み込みしてください。</p>';
      return;
    }
    var badgeText = data.badgeText || {};
    slot.innerHTML = data.items.map(function (item) { return renderRow(item, badgeText); }).join('\n');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var slots = document.querySelectorAll('.auto-list-slot');
    if (slots.length === 0) return;
    var dataPath = slots[0].getAttribute('data-auto-list-data-path') || DEFAULT_DATA_PATH;
    fetch(dataPath)
      .then(function (res) { return res.json(); })
      .then(function (data) { slots.forEach(function (slot) { render(slot, data); }); })
      .catch(function () { slots.forEach(function (slot) { render(slot, null); }); });
  });
})();

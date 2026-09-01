// more-links.js — トップページ下段「📚 もっと知りたい方へ」のリンク集を実行時に差し込む。
//
// なぜこの方式か: steps.js・showcase.js と同じ理由。グループ見出し＋カードの
// 繰り返しがHTMLにベタ書きされていた（2026-09-01指摘）。正本を
// assets/data/more-links.json の1箇所に集約する。

(function () {
  var DEFAULT_DATA_PATH = 'assets/data/more-links.json';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  function renderItem(item) {
    var targetAttr = item.external ? ' target="_blank" rel="noopener"' : '';
    return (
      '<a href="' + escapeAttr(item.href) + '" class="more-card"' + targetAttr + '>' +
        '<div class="mc-icon">' + escapeHtml(item.icon) + '</div>' +
        '<div><h4>' + escapeHtml(item.title) + '</h4><p>' + item.desc + '</p></div>' +
      '</a>'
    );
  }

  function renderGroup(group) {
    var head = '<div class="more-group-head" style="font-size:0.78rem; font-weight:800; color:#999; margin:4px 2px 2px;">' + escapeHtml(group.head) + '</div>';
    var items = (group.items || []).map(renderItem).join('\n');
    return head + '\n' + items;
  }

  function render(slot, data) {
    if (!data || !Array.isArray(data.groups)) {
      slot.innerHTML = '<p class="showcase-error">一覧の読み込みに失敗しました。ページを再読み込みしてください。</p>';
      return;
    }
    slot.innerHTML = data.groups.map(renderGroup).join('\n');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var slots = document.querySelectorAll('.more-links-slot');
    if (slots.length === 0) return;
    var dataPath = slots[0].getAttribute('data-more-links-data-path') || DEFAULT_DATA_PATH;
    fetch(dataPath)
      .then(function (res) { return res.json(); })
      .then(function (data) { slots.forEach(function (slot) { render(slot, data); }); })
      .catch(function () { slots.forEach(function (slot) { render(slot, null); }); });
  });
})();

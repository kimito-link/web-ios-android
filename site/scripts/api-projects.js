// api-projects.js — 「管理体制・API導線」ページ用の描画スクリプト。
//
// なぜこの方式か:
//   showcase.js と同じ理由。公開してよいプロジェクトの一覧を
//   assets/data/api-projects.json の1箇所に正本を置き、ページ側は
//   「どんな見た目で出すか」の枠(スロット)だけを持つ（新しいプロジェクトを
//   公開したらJSONに1件追記するだけでよい）。
//
// 使い方:
//   <div class="api-projects-slot"></div>
//   <div class="api-integrations-slot"></div>
//   data-api-projects-data-path でJSONの場所をページの深さに合わせて
//   上書きできる（省略時はルート相対 /assets/data/api-projects.json）。

(function () {
  var DEFAULT_DATA_PATH = '/assets/data/api-projects.json';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  function renderProjectCard(p) {
    var links = [];
    if (p.webUrl) links.push('<a href="' + escapeAttr(p.webUrl) + '" class="ap-link ap-link-web" target="_blank" rel="noopener">🌐 サイトを見る</a>');
    if (p.githubUrl) links.push('<a href="' + escapeAttr(p.githubUrl) + '" class="ap-link ap-link-gh" target="_blank" rel="noopener">GitHub</a>');
    var apis = (p.apiIntegrations || []).map(function (a) {
      return '<span class="ap-api-chip">' + escapeHtml(a) + '</span>';
    }).join('');
    return (
      '<article class="ap-card">' +
      '<h3>' + escapeHtml(p.name) + '</h3>' +
      '<p>' + escapeHtml(p.description) + '</p>' +
      (apis ? '<div class="ap-apis">' + apis + '</div>' : '') +
      '<div class="ap-links">' + links.join('') + '</div>' +
      '</article>'
    );
  }

  function renderIntegrationsSummary(projects) {
    var counts = {};
    projects.forEach(function (p) {
      (p.apiIntegrations || []).forEach(function (a) {
        counts[a] = (counts[a] || 0) + 1;
      });
    });
    var names = Object.keys(counts).sort();
    if (names.length === 0) {
      return '<p class="ap-integrations-empty">連携先の情報は準備中です。</p>';
    }
    return '<ul class="ap-integrations-list">' + names.map(function (name) {
      return '<li><span class="ap-integration-name">' + escapeHtml(name) + '</span>' +
        '<span class="ap-integration-count">' + counts[name] + '件のプロジェクトで利用</span></li>';
    }).join('') + '</ul>';
  }

  function renderError(el) {
    el.innerHTML = '<p class="ap-error">一覧の読み込みに失敗しました。ページを再読み込みしてください。</p>';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var projectSlots = document.querySelectorAll('.api-projects-slot');
    var integrationSlots = document.querySelectorAll('.api-integrations-slot');
    if (projectSlots.length === 0 && integrationSlots.length === 0) return;

    var pathSource = projectSlots[0] || integrationSlots[0];
    var dataPath = pathSource.getAttribute('data-api-projects-data-path') || DEFAULT_DATA_PATH;

    fetch(dataPath)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data || !Array.isArray(data.projects)) throw new Error('invalid data');
        projectSlots.forEach(function (slot) {
          slot.innerHTML = data.projects.map(renderProjectCard).join('\n');
        });
        integrationSlots.forEach(function (slot) {
          slot.innerHTML = renderIntegrationsSummary(data.projects);
        });
      })
      .catch(function () {
        projectSlots.forEach(renderError);
        integrationSlots.forEach(renderError);
      });
  });
})();

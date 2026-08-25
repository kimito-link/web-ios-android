// showcase.js — 「実際に使った例」を実行時に差し込む共通スクリプト。
//
// なぜこの方式か:
//   公開したアプリの一覧をLP(index.html)とshowcase/index.htmlの両方にHTML直書き
//   していると、新しいアプリを公開するたびに複数ページを手作業で直すことになり、
//   増えたアプリが漏れる（2026-08-25、公開済みアプリが複数ページに未反映のまま
//   だったのを実際に指摘された）。正本を assets/data/showcase.json の1箇所に
//   集約し、ページ側は「どんな見た目で出すか」の枠(スロット)だけを持つ。
//
// ★status は誇張しない: 'live'（却下履歴なく現在ダウンロード可能）だけを
//   目立たせ、'in_review'（審査待ち）は控えめな表示にする。'rejected'は
//   showcase.json 側に載せない運用（却下済みを実績として掲示しない）。
//
// 使い方:
//   <div class="showcase-slot" data-variant="lp"></div>       … LP用の簡易カード
//   <div class="showcase-slot" data-variant="full"></div>     … showcase/用の詳細カード
//   data-showcase-data-path でJSONの場所をページの深さに合わせて上書きできる
//   （省略時はルート相対 /assets/data/showcase.json）。

(function () {
  var DEFAULT_DATA_PATH = '/assets/data/showcase.json';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  function iconHtml(app, fallbackClass) {
    if (app.icon) {
      return '<img src="' + escapeAttr(app.icon) + '" alt="' + escapeAttr(app.name) + '">';
    }
    return '<div class="' + fallbackClass + '" aria-hidden="true">' + escapeHtml(app.iconEmoji || '📱') + '</div>';
  }

  function statusBadge(app, variant) {
    if (app.status === 'in_review') {
      return variant === 'full'
        ? '<span class="lk-pend">▶ 審査待ち（未公開）</span>'
        : '<span class="mini-pend">審査待ち</span>';
    }
    return '';
  }

  // LP用: mini-links形式の簡易カード（既存 .example-card と同じクラスを使う）
  function renderLpCard(app) {
    var links = [];
    if (app.webUrl) links.push('<a href="' + escapeAttr(app.webUrl) + '" target="_blank" rel="noopener">' + (app.extraLinks ? '製品を見る' : 'Webを見る') + '</a>');
    if (app.iosUrl) links.push('<a href="' + escapeAttr(app.iosUrl) + '" target="_blank" rel="noopener">App Store</a>');
    if (app.androidUrl) links.push('<a href="' + escapeAttr(app.androidUrl) + '" target="_blank" rel="noopener">Google Play</a>');
    if (app.extraLinks) {
      app.extraLinks.forEach(function (l) {
        links.push('<a href="' + escapeAttr(l.url) + '" target="_blank" rel="noopener">' + escapeHtml(l.label) + '</a>');
      });
    }
    var badge = statusBadge(app, 'lp');
    return (
      '<article class="example-card">' +
      '<div class="example-top">' + iconHtml(app, 'example-icon') + '<h3>' + escapeHtml(app.name) + '</h3></div>' +
      '<p>' + escapeHtml(app.description) + (badge ? ' ' + badge : '') + '</p>' +
      '<div class="mini-links">' + links.join('') + '</div>' +
      '</article>'
    );
  }

  // showcase/用: sc-card形式の詳細カード（既存 .sc-card と同じクラスを使う）
  function renderFullCard(app) {
    var links = [];
    if (app.webUrl) links.push('<a href="' + escapeAttr(app.webUrl) + '" class="lk-web" target="_blank" rel="noopener">🌐 Web</a>');
    if (app.iosUrl) links.push('<a href="' + escapeAttr(app.iosUrl) + '" class="lk-ios" target="_blank" rel="noopener">🍎 App Store</a>');
    if (app.androidUrl) links.push('<a href="' + escapeAttr(app.androidUrl) + '" class="lk-android" target="_blank" rel="noopener">▶ Google Play</a>');
    if (app.extraLinks) {
      app.extraLinks.forEach(function (l) {
        links.push('<span class="lk-pend">📊 <a href="' + escapeAttr(l.url) + '" target="_blank" rel="noopener" style="color:inherit;">' + escapeHtml(l.label) + '</a></span>');
      });
    }
    var badge = statusBadge(app, 'full');
    if (badge) links.push(badge);
    return (
      '<div class="sc-card">' +
      iconHtml(app, 'sc-icon-fallback') +
      '<div><h3>' + escapeHtml(app.name) + '</h3>' +
      '<p>' + escapeHtml(app.description) + '</p>' +
      '<div class="sc-links">' + links.join('') + '</div>' +
      '</div></div>'
    );
  }

  function render(slot, data) {
    if (!data || !Array.isArray(data.apps)) {
      slot.innerHTML = '<p class="showcase-error">一覧の読み込みに失敗しました。ページを再読み込みしてください。</p>';
      return;
    }
    // ★rejected は showcase.json 側に載せない運用だが、万一混入していたら
    //   ここでも二重に弾く（却下済みを実績として出さない、を仕組みで担保する）。
    var apps = data.apps.filter(function (a) { return a.status !== 'rejected'; });
    var variant = slot.getAttribute('data-variant') || 'lp';
    var render = variant === 'full' ? renderFullCard : renderLpCard;
    slot.innerHTML = apps.map(render).join('\n');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var slots = document.querySelectorAll('.showcase-slot');
    if (slots.length === 0) return;
    var dataPath = slots[0].getAttribute('data-showcase-data-path') || DEFAULT_DATA_PATH;
    fetch(dataPath)
      .then(function (res) { return res.json(); })
      .then(function (data) { slots.forEach(function (slot) { render(slot, data); }); })
      .catch(function () { slots.forEach(function (slot) { render(slot, null); }); });
  });
})();

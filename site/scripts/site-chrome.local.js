// site-chrome.local.js — web-ios-android固有のsite-chrome拡張（Local Extension）。
//
// ★rolloutのCanonical freshness判定対象外。このファイルの中身は各consumerが自由に
//   持ってよい／持たなくてよい（component.jsonのadoption.localExtensionFilesに列挙されるが、
//   hash比較はしない）。
//
// ★Coreとの依存関係は "site-chrome:mounted" イベント購読のみ（2026-09-03、GPT相談での設計）。
//   plugin frameworkではなく最小限の1イベントフック。Coreはこのファイルの存在を知らない。
//
// 機能: 「🤖 AIに共有」ボタン（このページURLをAI貼付用テキストでコピー）と
//   ai-index-slot（フッター直前、ai-box.jsが描画する「AIへの指示 一覧」の差し込み先）。
//   従来 site/scripts/site-chrome.js に直接書かれていた web-ios-android固有部分を
//   Core/Config分離に伴いこのファイルへ切り出した。

(function () {
  function mountShareToAiButton() {
    var logoLink = document.querySelector('header .logo-link');
    var navToggle = document.querySelector('header .nav-toggle');
    if (!logoLink || !navToggle) return;

    var btn = document.createElement('button');
    btn.className = 'share-to-ai-btn';
    btn.type = 'button';
    btn.title = 'このページのURLをAIに貼る用にコピー';
    btn.textContent = '🤖 AIに共有';
    logoLink.parentNode.insertBefore(btn, navToggle);

    btn.addEventListener('click', function () {
      var url = window.location.origin + window.location.pathname;
      var text = 'このページを読んで、書かれている通りに進めて。\n' + url;
      navigator.clipboard.writeText(text).then(function () {
        var original = btn.textContent;
        btn.textContent = '✅ コピーしました';
        setTimeout(function () { btn.textContent = original; }, 1500);
      }, function () {
        var original = btn.textContent;
        btn.textContent = 'コピーできません（手動で選択してください）';
        setTimeout(function () { btn.textContent = original; }, 2500);
      });
    });
  }

  function mountAiIndexSlot() {
    var footer = document.querySelector('footer.site-footer');
    if (!footer) return;
    var indexSlot = document.createElement('div');
    indexSlot.className = 'ai-index-slot';
    indexSlot.setAttribute('data-ai-data-path', '/assets/data/ai-instructions.json');
    footer.parentNode.insertBefore(indexSlot, footer);
  }

  document.addEventListener('site-chrome:mounted', function () {
    mountShareToAiButton();
    mountAiIndexSlot();
  });
})();

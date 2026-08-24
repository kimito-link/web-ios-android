// site-chrome.js — サイト共通のヘッダー・フッターを実行時に差し込む。
//
// なぜこの方式か:
//   このサイトはビルドツールなしの静的HTMLで、24ページすべてにヘッダー/フッターの
//   生HTMLがコピペされていた。相対パス（../ の深さ）がページの階層ごとに違うため、
//   同じ内容のはずが1文字も揃わずコピペのズレに気づけない状態だった。
//   ここでリンクを「サイトルート相対の絶対パス」に統一し、1箇所の変更が
//   全ページに反映されるようにする。
//
// 使い方: 各ページの <body> 直後に <div id="site-header"></div>、
//   </body> 直前に <div id="site-footer"></div> を置き、このスクリプトを読み込む。
//   現在ページに対応する nav リンクには自動で class="active" が付く。

(function () {
  var NAV_ITEMS = [
    { href: '/guide/', label: '📋 はじめる準備' },
    { href: '/showcase/', label: '📱 公開・導入事例' },
    { href: '/troubleshooting/', label: '🩹 つまずいたら' },
    // 起動画面（スプラッシュ）の作り方はこのページ配下にある。
    // メニューに無かったため「その他の説明」を開かないと辿り着けなかった（2026-08-25 追加）。
    { href: '/features/health-check/', label: '🎬 起動画面と動作確認' },
    { href: '/check-shindan-version/', label: '✅ 更新・動作状況' },
    { href: '/ai-guide/', label: '🤖 AI向けガイド' },
    { href: '/sitemap/', label: '🗺️ その他の説明' }
  ];

  // 現在地の判定は「そのnavリンクのパスが今のURLの先頭と一致するか」で行う。
  // walkthrough配下の子ページ（/walkthrough/chrome/ 等）でも「📷 追体験」が光るように、
  // 完全一致ではなく前方一致にしている。
  function isActive(href) {
    var path = window.location.pathname;
    if (href === '/') return path === '/' || path === '/index.html';
    return path.indexOf(href) === 0;
  }

  function buildHeader() {
    var nav = NAV_ITEMS.map(function (item) {
      var cls = isActive(item.href) ? ' class="active"' : '';
      return '<a href="' + item.href + '"' + cls + '>' + item.label + '</a>';
    }).join('\n    ');

    return (
      '<header>\n' +
      '  <a class="logo-link" href="/"><img class="logo" src="/images/logo.png" alt="Kimito-Link"></a>\n' +
      '  <button class="share-to-ai-btn" type="button" title="このページのURLをAIに貼る用にコピー">🤖 AIに共有</button>\n' +
      '  <button class="nav-toggle" aria-expanded="false" aria-controls="site-nav" aria-label="メニューを開く"><span></span></button>\n' +
      '  <nav id="site-nav">\n' +
      '    <a href="/"' + (isActive('/') ? ' class="active"' : '') + '>🏠 トップ</a>\n' +
      '    ' + nav + '\n' +
      '  </nav>\n' +
      '</header>'
    );
  }

  // ヘッダーの「🤖 AIに共有」ボタン: このページのURLを、AIに貼ってそのまま
  // 使える定型文つきでクリップボードにコピーする（ai-box.js のコピーボタンと
  // 同じ「失敗を偽らない」方針）。
  function mountShareToAi() {
    var btn = document.querySelector('.share-to-ai-btn');
    if (!btn) return;
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

  function buildFooter() {
    var links = ['<a href="/">🏠 トップ</a>']
      .concat(NAV_ITEMS.map(function (item) {
        return '<a href="' + item.href + '">' + item.label + '</a>';
      }))
      .join('\n    ');

    return (
      '<footer class="site-footer">\n' +
      '  <div class="site-footer-links">\n' +
      '    ' + links + '\n' +
      '  </div>\n' +
      '  <div class="site-footer-copy">Kimito Link — クリエイター支援テンプレート</div>\n' +
      '</footer>'
    );
  }

  function mountToggle() {
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.getElementById('site-nav');
    if (!toggle || !nav) return;

    toggle.addEventListener('click', function () {
      var isOpen = nav.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        nav.classList.remove('nav-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var headerSlot = document.getElementById('site-header');
    var footerSlot = document.getElementById('site-footer');
    if (headerSlot) headerSlot.outerHTML = buildHeader();
    if (footerSlot) {
      // フッター直前に「AIへの指示 一覧」のスロットを自動で差し込む。
      // ai-box.js（このスクリプトの後に読み込まれる想定）がこれを見つけて描画する。
      // ai-box.js を読み込んでいないページでは空の div のまま残るだけで実害はない。
      var indexSlot = document.createElement('div');
      indexSlot.className = 'ai-index-slot';
      indexSlot.setAttribute('data-ai-data-path', '/assets/data/ai-instructions.json');
      footerSlot.parentNode.insertBefore(indexSlot, footerSlot);
      footerSlot.outerHTML = buildFooter();
    }
    mountToggle();
    mountShareToAi();
  });
})();

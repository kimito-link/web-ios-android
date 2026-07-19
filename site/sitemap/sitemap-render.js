// サイトマップ — sitemap-manifest.json を読み #sitemap-mount に描画
// sections[].links に対応（kimito-link の sitemap-render.js を移植・簡素化）
(function () {
  'use strict';

  function isExternalHref(href) {
    return /^https?:\/\//i.test(String(href || ''));
  }

  function buildLinkItem(item) {
    var li = document.createElement('li');
    li.className = 'sitemap-page__item';
    var a = document.createElement('a');
    a.href = item.href;
    a.textContent = item.label;
    var ext = item.external === true || isExternalHref(item.href);
    if (ext) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.classList.add('sitemap-page__link--external');
      a.setAttribute('aria-label', item.label + '（外部サイト、新しいタブで開きます）');
    }
    li.appendChild(a);
    return li;
  }

  function appendLinkList(sectionEl, items) {
    var links = items || [];
    if (links.length === 0) return;
    var ul = document.createElement('ul');
    ul.className = 'sitemap-page__list';
    for (var j = 0; j < links.length; j++) {
      ul.appendChild(buildLinkItem(links[j]));
    }
    sectionEl.appendChild(ul);
  }

  function render(data, mount) {
    mount.textContent = '';
    var nav = document.createElement('nav');
    nav.className = 'sitemap-page__nav';
    nav.setAttribute('aria-label', 'サイト内のページ一覧');

    var sections = data.sections || [];
    for (var i = 0; i < sections.length; i++) {
      var sec = sections[i];
      var section = document.createElement('section');
      section.className = 'sitemap-page__section';
      if (sec.slug) section.id = sec.slug;

      var h2 = document.createElement('h2');
      h2.className = 'sitemap-page__section-title';
      h2.textContent = sec.title || '';
      section.appendChild(h2);

      appendLinkList(section, sec.links || []);
      nav.appendChild(section);
    }
    mount.appendChild(nav);
  }

  function run() {
    var mount = document.getElementById('sitemap-mount');
    if (!mount) return;
    fetch('sitemap-manifest.json', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('manifest HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        render(data, mount);
      })
      .catch(function () {
        mount.innerHTML =
          '<p class="sitemap-page__error" role="alert">サイトマップデータの読み込みに失敗しました。しばらくしてから再度お試しください。</p>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();

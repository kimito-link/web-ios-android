/**
 * kimito.link 系サービス共通の「LP 用フッター」（素の JS・依存なし）。
 *
 * 出す中身（全サービスで同じ順序・同じ文言）:
 *   1行目: 「<サービス名>は、kimito-link.com（Kimito-Link Project）と同じ運営による公式サービスです。」
 *   2行目: 利用規約 ・ プライバシーポリシー ・ 特定商取引法に基づく表記 ・ お問い合わせ
 *          （★各サイトに実在するページだけを data 属性で渡す。無い項目は出さない）
 *
 * 使い方（各ページの </body> 直前に1行）:
 *   <script src="/js/kimito-legal-footer.js"
 *           data-service-name="君斗りんくのすれ違ひ通信"
 *           data-terms="/terms/" data-privacy="/privacy/"></script>
 *   - data-tokusho / data-support は任意。
 *   - <div id="kimito-legal-footer"></div> を置けば、その場所に出す（無ければ body の末尾）。
 *
 * ★設計の判断（2026-10-04）:
 *   - 色は既定で継承する（単色背景のLPならそのまま馴染む）。独自の背景色は持たない。
 *     ★背後が写真・グラデーション等で文字が読めなくなるLPは、LP側のCSSで差し替える:
 *       :root { --klf-bg: #efe7d6; --klf-fg: #3a352c; --klf-z: 5; }   （surechigai の実例。部品は書き換えない）
 *     ★背景の写真が position:fixed（z-index 付き）で全面に敷かれているLPでは、重なり順（--klf-z）も要る。
 *       既定は position:relative + z-index:1（後ろから描かれる固定レイヤーに隠れないため）。
 *   - 何度読み込まれても1つだけ（冪等）。失敗してもページ本体は壊さない（fail-safe）。
 *   - javascript: 等の危険な URL は描画しない（相対パスと https:// だけ許可）。
 *   - 全部のサイトに kimito.link 本体と同じ「ヘッダー」を強制はしない。アプリ型の画面に合わないため。
 *     共通にするのは「運営表記＋法務への導線」という最低ライン（ストア審査・利用者の安心の両方に効く）。
 *
 * ★このファイルは各サイトへ無改変でコピーする（web-ios-android/_docs/instruments/check-drift.mjs の
 *   PAIRS で同期を見張る）。サービス固有の値は data 属性で渡し、このファイルは書き換えない。
 */
(function () {
    'use strict';

    var STYLE_ID = 'kimito-legal-footer-style';
    var ROOT_ID = 'kimito-legal-footer';
    var OFFICIAL_URL = 'https://kimito-link.com/';

    var CSS =
        '#' + ROOT_ID + '{position:relative;z-index:var(--klf-z,1);box-sizing:border-box;width:100%;margin:0;padding:28px 16px 36px;' +
        'text-align:center;font-size:12px;line-height:1.8;color:var(--klf-fg,inherit);background:var(--klf-bg,transparent);' +
        'border-top:1px solid rgba(127,127,127,.35);}' +
        '#' + ROOT_ID + ' p{margin:0 0 10px;opacity:.85;}' +
        '#' + ROOT_ID + ' ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;' +
        'justify-content:center;gap:2px 6px;}' +
        '#' + ROOT_ID + ' a{color:inherit;text-decoration:underline;text-underline-offset:2px;' +
        'padding:6px 8px;display:inline-block;}' +
        '#' + ROOT_ID + ' a:hover{opacity:.7;}';

    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // 相対パス（/ 始まり）と https:// だけ許可する。javascript: / data: / // などは落とす。
    function safeUrl(u) {
        if (typeof u !== 'string') return '';
        var v = u.trim();
        if (/^\/(?!\/)/.test(v)) return v;
        if (/^https:\/\/[^\s]+$/.test(v)) return v;
        return '';
    }

    /** フッターの HTML を作る（純関数。テストはここを見る）。 */
    function buildHtml(o) {
        o = o || {};
        var name = esc(o.serviceName || 'このサービス');
        var items = [
            ['利用規約', safeUrl(o.terms)],
            ['プライバシーポリシー', safeUrl(o.privacy)],
            ['特定商取引法に基づく表記', safeUrl(o.tokusho)],
            ['お問い合わせ', safeUrl(o.support)]
        ].filter(function (it) { return it[1]; });

        var list = items.length
            ? '<ul>' + items.map(function (it) {
                return '<li><a href="' + esc(it[1]) + '">' + it[0] + '</a></li>';
            }).join('') + '</ul>'
            : '';

        return '<p>' + name + 'は、<a href="' + OFFICIAL_URL + '" rel="noopener">kimito-link.com</a>' +
            '（Kimito-Link Project）と同じ運営による公式サービスです。</p>' + list;
    }

    function mount(o) {
        if (typeof document === 'undefined') return false;
        if (document.getElementById(STYLE_ID) === null) {
            var st = document.createElement('style');
            st.id = STYLE_ID;
            st.textContent = CSS;
            document.head.appendChild(st);
        }
        var host = document.getElementById(ROOT_ID);
        if (host && host.getAttribute('data-rendered') === '1') return true; // 冪等
        if (!host) {
            // ★<footer> タグは使わない。各LPの `footer { … }` のCSSを意図せず拾うため。
            host = document.createElement('div');
            host.id = ROOT_ID;
            document.body.appendChild(host);
        }
        host.setAttribute('role', 'group');
        host.setAttribute('aria-label', '運営情報と規約');
        host.innerHTML = buildHtml(o);
        host.setAttribute('data-rendered', '1');
        return true;
    }

    var api = { buildHtml: buildHtml, safeUrl: safeUrl, mount: mount };
    if (typeof window !== 'undefined') window.KimitoLegalFooter = api;

    var script = (typeof document !== 'undefined' && document.currentScript) || null;
    if (!script) return;
    var d = script.dataset || {};
    var opts = {
        serviceName: d.serviceName,
        terms: d.terms,
        privacy: d.privacy,
        tokusho: d.tokusho,
        support: d.support
    };
    function run() {
        try { mount(opts); } catch (e) { /* ページ本体を壊さない */ }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
})();

/**
 * kimito.link 共通アカウント: 本家マイページ（https://kimito.link/dashboard/）への導線（Vanilla JS 版）。
 *
 * ★なぜ要るか（2026-10-05）:
 *   本家 kimitolink-linktree のダッシュボードは共通アカウントの拠点で、姉妹サービスごとの
 *   利用状況カード（app/(auth)/dashboard/SiblingServiceCard.tsx）を持つ。姉妹4サービスは
 *   利用状況の書き込み（/api/hub/summary）まで実装済みなのに、見に行く入口が1つも無かった
 *   （`kimito.link/dashboard` を含むリンクは4リポとも0件）。本家の共通ヘッダーが
 *   ログイン中だけ「マイページ」→ /dashboard/ を出す（components/HeaderNav.tsx）のを写し、
 *   姉妹側では https:// から始まる完全なURLにして出す。
 *
 * ★設計（本家 HeaderNav / HeaderNavAuth と同じ原則）:
 *   1. 判定は純関数 resolveKimitoDashboardLink に分離（契約テスト対象）。
 *      Clerk 読み込み前は何もしない（"wait"）／未ログインは描かない（"clear"）／
 *      ログイン中だけ描く（"render"）。
 *   2. 描くのは <a href rel="noopener"> 1本だけ。innerHTML は使わず createElement で組む
 *      （文言は data 属性から来るので、HTML として解釈させない）。
 *   3. 行き先は固定URL（既定 https://kimito.link/dashboard/）。data 属性で上書きできるが、
 *      https: 以外・クエリ付きは既定に戻す（オープンリダイレクトや追跡パラメータの混入を防ぐ）。
 *   4. Clerk の addListener でログイン状態の変化に追従する（ログアウトしたら消す）。
 *   5. 本家の sign-in へは送らない。本家は signInForceRedirectUrl=/dashboard/ のため、
 *      姉妹から送客するとログイン後に姉妹へ戻れない（nextjs/README.md 地雷4）。
 *      だからこの部品は「ログイン中だけ」出し、未ログイン時は何も描かない。
 *
 * 使い方:
 *   <span data-kimito-dashboard-link></span>                      ← 既定の文言・URL
 *   <span data-kimito-dashboard-link
 *         data-kimito-dashboard-label="本家のマイページ"
 *         data-kimito-dashboard-href="https://kimito.link/dashboard/"
 *         data-kimito-dashboard-class="btn btn-outline"></span>    ← 上書き
 *   <script src="/js/kimito-dashboard-link.js"></script>
 *
 *   自動で window.Clerk を待って attach する。auth.js 側で Clerk.load() の直後に
 *   window.KimitoDashboardLink.attach(window.Clerk) を呼んでもよい（二重 attach は無視）。
 *
 * ★置き場所: ログイン後の画面（マイページ・ヘッダー右上）。LP には置かない。
 */
(function () {
    'use strict';

    var DEFAULT_HREF = 'https://kimito.link/dashboard/';
    var DEFAULT_LABEL = 'kimito.link マイページ';
    var CONTAINER_SELECTOR = '[data-kimito-dashboard-link]';
    var WAIT_POLL_MS = 200;
    var WAIT_TIMEOUT_MS = 20000;

    /**
     * href として受け入れてよいか。https のみ・クエリ/フラグメント無し。
     * ★姉妹の利用状況カードは本家の /dashboard/ 直下に出るので、クエリは要らない。
     */
    function isAcceptableHref(href) {
        if (typeof href !== 'string' || href === '') return false;
        if (!/^https:\/\//.test(href)) return false;
        if (href.indexOf('?') !== -1 || href.indexOf('#') !== -1) return false;
        return true;
    }

    /**
     * 純関数: 状態と設定から「何をするか」を決める。副作用なし。
     *
     * @param {{isLoaded: boolean, isSignedIn: boolean|undefined}} state
     * @param {{href?: string, label?: string}} [opts]
     * @returns {{action: 'wait'} | {action: 'clear'} | {action: 'render', href: string, label: string}}
     */
    function resolveKimitoDashboardLink(state, opts) {
        opts = opts || {};
        if (!state || !state.isLoaded) return { action: 'wait' };
        if (!state.isSignedIn) return { action: 'clear' };
        var href = isAcceptableHref(opts.href) ? opts.href : DEFAULT_HREF;
        var label = (typeof opts.label === 'string' && opts.label.trim() !== '') ? opts.label.trim() : DEFAULT_LABEL;
        return { action: 'render', href: href, label: label };
    }

    function readOptions(container) {
        var get = function (name) {
            return container.getAttribute ? container.getAttribute(name) : null;
        };
        return {
            href: get('data-kimito-dashboard-href') || undefined,
            label: get('data-kimito-dashboard-label') || undefined,
            className: get('data-kimito-dashboard-class') || undefined
        };
    }

    function clearContainer(container) {
        while (container.firstChild) container.removeChild(container.firstChild);
    }

    /**
     * 判定結果をコンテナへ反映する。"wait" は触らない（前の表示を保つ）。
     */
    function applyDecision(container, decision, className, doc) {
        if (decision.action === 'wait') return;
        clearContainer(container);
        if (decision.action !== 'render') return;
        var a = doc.createElement('a');
        a.setAttribute('href', decision.href);
        a.setAttribute('rel', 'noopener');
        a.setAttribute('data-kimito-dashboard-anchor', '');
        if (className) a.setAttribute('class', className);
        a.textContent = decision.label;
        container.appendChild(a);
    }

    function readClerkState(clerk) {
        if (!clerk) return { isLoaded: false, isSignedIn: undefined };
        // clerk-js: loaded フラグが無い世代もあるので、user が undefined かどうかも見る。
        var loaded = clerk.loaded === true || typeof clerk.user !== 'undefined';
        if (!loaded) return { isLoaded: false, isSignedIn: undefined };
        return { isLoaded: true, isSignedIn: !!clerk.user };
    }

    /**
     * 今の Clerk 状態で、ページ内の全コンテナを描き直す。
     * @param {object} clerk window.Clerk 相当
     * @param {Document} [doc] テスト差し替え用
     */
    function render(clerk, doc) {
        doc = doc || document;
        var state = readClerkState(clerk);
        var containers = doc.querySelectorAll(CONTAINER_SELECTOR);
        for (var i = 0; i < containers.length; i++) {
            var opts = readOptions(containers[i]);
            var decision = resolveKimitoDashboardLink(state, opts);
            applyDecision(containers[i], decision, opts.className, doc);
        }
        return state;
    }

    var attached = null;

    /**
     * Clerk に追従を登録する。1回だけ。
     * @returns {boolean} 登録したら true（既に登録済み・clerk 無しは false）
     */
    function attach(clerk, doc) {
        if (!clerk || attached === clerk) return false;
        attached = clerk;
        render(clerk, doc);
        if (typeof clerk.addListener === 'function') {
            clerk.addListener(function () { render(clerk, doc); });
        }
        return true;
    }

    /**
     * window.Clerk が現れるのを待って attach する（auth.js が先に attach 済みなら何もしない）。
     * 待ち切れなければ諦める＝何も描かない（壊れ方の上限を「導線が出ないだけ」に固定）。
     */
    function waitForClerk(win, doc) {
        win = win || window;
        doc = doc || document;
        if (win.Clerk) { attach(win.Clerk, doc); return; }
        var waited = 0;
        var id = setInterval(function () {
            waited += WAIT_POLL_MS;
            if (win.Clerk) {
                clearInterval(id);
                attach(win.Clerk, doc);
            } else if (waited >= WAIT_TIMEOUT_MS) {
                clearInterval(id);
            }
        }, WAIT_POLL_MS);
    }

    window.KimitoDashboardLink = {
        DEFAULT_HREF: DEFAULT_HREF,
        DEFAULT_LABEL: DEFAULT_LABEL,
        resolve: resolveKimitoDashboardLink,
        render: render,
        attach: attach,
        _isAcceptableHref: isAcceptableHref // テスト用に公開
    };

    // 自動起動。テスト（KIMITO_DASHBOARD_LINK_MANUAL=true）や、auth.js から attach する構成では止められる。
    if (!window.KIMITO_DASHBOARD_LINK_MANUAL && typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { waitForClerk(window, document); });
        } else {
            waitForClerk(window, document);
        }
    }
})();

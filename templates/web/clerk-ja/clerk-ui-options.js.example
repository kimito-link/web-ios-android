/**
 * Clerk ログインモーダルの「日本語化＋見た目」の設定（kimito.link 系の素の clerk-js サイト共通）。
 *
 * 使い方（Clerk SDK を読み込む前に）:
 *   1. window.KimitoClerkUiConfig = { serviceName: 'サービス名' };   ← サイト固有の値はこれだけ
 *   2. clerk-ja-JP.generated.js（日本語の土台）→ このファイル の順に読み込む
 *   3. Clerk.load(window.KimitoClerkUiOptions.buildClerkLoadOptions())
 *
 * ★共有 Clerk の Application 名「kimitolink-linktree」が見出しに出てしまうため、
 *   サービスごとの見出しはここの localization 側で上書きする
 *   （Dashboard で直すと kimito.link 本体と姉妹全サービスの見出しが変わる）。
 * ★素の clerk-js なので、公式の `Clerk.load({ localization, appearance })` で渡せる。
 *   （Expo 版 doin は @clerk/expo が localization を渡さず、内部 API の
 *    `__internal_updateProps({ options: { localization } })` が要った。ai-hub の KB 参照）
 * ★Apple/Google/X の3ボタンは消さず同寸法（App Store 4.8）。主役化は色と順序だけ。
 * ★日本語の土台 window.KimitoClerkJaJP は clerk-ja-JP.generated.js（自動生成）が先に定義する。
 *   無い場合は日本語化せず標準の画面のまま（fail-safe。ログインは動く）。
 * ★このファイルは各サイトへ無改変でコピーする（web-ios-android/_docs/instruments/check-drift.mjs の
 *   PAIRS で同期を見張る）。サービス固有の値は KimitoClerkUiConfig で渡し、書き換えない。
 */
(function () {
    'use strict';

    function serviceName() {
        var cfg = window.KimitoClerkUiConfig || {};
        return typeof cfg.serviceName === 'string' && cfg.serviceName ? cfg.serviceName : 'このサービス';
    }

    function buildLocalization(ja) {
        var name = serviceName();
        var base = ja || {};
        var signIn = base.signIn || {};
        var signUp = base.signUp || {};
        var errors = base.unstable__errors || {};
        var out = {};
        Object.keys(base).forEach(function (k) { out[k] = base[k]; });
        // Google のブランド規約は "Google" 単独表記を認めない。「◯◯で続ける」を両方のキーに明示する。
        out.socialButtonsBlockButton = '{{provider|titleize}}で続ける';
        out.socialButtonsBlockButtonManyInView = '{{provider|titleize}}で続ける';
        out.signIn = Object.assign({}, signIn, {
            start: Object.assign({}, signIn.start, {
                title: name + 'にログイン',
                subtitle: 'X（旧 Twitter）のアカウントで続けます。'
            })
        });
        out.signUp = Object.assign({}, signUp, {
            start: Object.assign({}, signUp.start, {
                title: 'はじめての方（新規登録）',
                subtitle: 'X（旧 Twitter）で登録すると、' + name + 'をはじめられます。'
            })
        });
        out.unstable__errors = Object.assign({}, errors, {
            external_account_not_found: 'X のアカウント連携を確認できませんでした。もう一度「X で続ける」からお試しください。',
            captcha_invalid: '確認に失敗しました。お手数ですが、もう一度お試しください。',
            captcha_unavailable: '確認画面を表示できませんでした。ページを再読み込みして、もう一度お試しください。'
        });
        return out;
    }

    var X_BLACK = '#0f1419';
    var X_BLACK_HOVER = '#000000';

    // 3プロバイダで同一の寸法（規約の "same size" を満たす）。
    var sharedButtonSize = { minHeight: '3rem', fontSize: '0.9375rem', fontWeight: 600, borderRadius: '0.875rem' };
    var sharedIconButtonSize = { minWidth: '3.5rem', height: '3rem', borderRadius: '0.875rem' };

    function merge(a, b) { return Object.assign({}, a, b); }

    var heroButton = merge(sharedButtonSize, {
        backgroundColor: X_BLACK, color: '#ffffff', border: 'none',
        boxShadow: '0 6px 16px rgba(15,20,25,0.22)',
        '&:hover': { backgroundColor: X_BLACK_HOVER }, '&:focus': { backgroundColor: X_BLACK_HOVER }
    });
    var secondaryButton = merge(sharedButtonSize, {
        backgroundColor: '#ffffff', color: '#0f172a', border: '1px solid rgba(15,23,42,0.18)',
        boxShadow: '0 1px 2px rgba(15,23,42,0.06)', '&:hover': { backgroundColor: 'rgba(15,23,42,0.04)' }
    });
    var heroIconButton = merge(sharedIconButtonSize, {
        backgroundColor: X_BLACK, border: 'none', boxShadow: '0 6px 16px rgba(15,20,25,0.22)',
        '&:hover': { backgroundColor: X_BLACK_HOVER }, '&:focus': { backgroundColor: X_BLACK_HOVER }
    });
    var secondaryIconButton = merge(sharedIconButtonSize, {
        backgroundColor: '#ffffff', border: '1px solid rgba(15,23,42,0.18)',
        boxShadow: '0 1px 2px rgba(15,23,42,0.06)', '&:hover': { backgroundColor: 'rgba(15,23,42,0.04)' }
    });
    var xGlyph = { filter: 'brightness(0) invert(1)' };

    var appearance = {
        variables: { colorPrimary: X_BLACK },
        options: { socialButtonsVariant: 'blockButton' },
        elements: {
            socialButtons: { display: 'flex', flexDirection: 'column', gap: '0.625rem' },
            socialButtonsBlockButton: secondaryButton,
            socialButtonsBlockButton__x: merge(heroButton, { order: -1 }),
            socialButtonsBlockButton__twitter: merge(heroButton, { order: -1 }),
            socialButtonsBlockButton__apple: secondaryButton,
            socialButtonsBlockButton__google: secondaryButton,
            socialButtonsIconButton: secondaryIconButton,
            socialButtonsIconButton__x: merge(heroIconButton, { order: -1 }),
            socialButtonsIconButton__twitter: merge(heroIconButton, { order: -1 }),
            socialButtonsIconButton__apple: secondaryIconButton,
            socialButtonsIconButton__google: secondaryIconButton,
            socialButtonsProviderIcon__x: xGlyph,
            socialButtonsProviderIcon__twitter: xGlyph
        }
    };

    /** Clerk.load() に渡すオプションを返す。日本語の土台が無くても落ちない。 */
    function buildClerkLoadOptions() {
        return {
            localization: buildLocalization(window.KimitoClerkJaJP),
            appearance: appearance
        };
    }

    window.KimitoClerkUiOptions = {
        buildClerkLoadOptions: buildClerkLoadOptions,
        buildLocalization: buildLocalization,
        appearance: appearance
    };
})();

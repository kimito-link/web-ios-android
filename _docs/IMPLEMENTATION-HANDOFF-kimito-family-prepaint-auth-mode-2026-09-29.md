# 実装ハンドオフ: kimito-link姉妹サービス「ちらつきゼロ」認証モード切替（exosome MVP）

> **状態: 設計完了・実装未着手。この1枚で着手できる粒度。**
> 設計書（読む順の1番目）: [`DESIGN-kimito-family-prepaint-auth-mode-2026-09-29.md`](./DESIGN-kimito-family-prepaint-auth-mode-2026-09-29.md)
> 対象リポ: `yukkuri-exosome.link`（MVP）。他2サービス（surechigai・voice）は本MVP確定後の横展開（設計書B-2/B-3参照）。

## スコープ（今回やること・やらないこと）

**やる**: exosomeの「未ログインなら`/lp/`へ強制送還」を廃止し、「全ページ公開・記録操作の直前だけログインを求める」方式へ変更。ちらつき（判定→隠す→遷移）を構造的に消す。

**やらない**: Clerk接続方式の変更（satellite化等）・surechigai/voiceの改修・LP自体の削除（外部流入用に残す）・ログイン必須という業務要件の撤回。

## 着手手順

1. ブランチを切る: `git checkout -b feat/exosome-prepaint-auth-mode`
2. TDD: まず契約テスト（下記「機械的な完了判定」のPlaywright 4基準・`check-auth-head-snippet.mjs`相当）を書き、red確認してから実装する
3. 読む順（すべて実在確認済み）:
   - `yukkuri-exosome.link/src/js/auth-gate.js`（改修対象の中心）
   - `yukkuri-exosome.link/src/js/auth.js`（`YEAuth`、`openSignIn()`, `ensureSession()`）
   - `yukkuri-exosome.link/src/js/common.js`（`YEStorage`、関所を入れる場所）
   - `yukkuri-exosome.link/src/index.html`（`<head>`/`<body>`の現在の読み込み順）
   - `yukkuri-exosome.link/src/lp/index.html`（残すが「強制送還先」から「任意リンク」へ格下げ）
   - `yukkuri-exosome.link/app.config.json`（`demoAccountUsernameSecret`/`PasswordSecret`）

## 実装ステップ

### 1. ヘッド・スニペットを追加（全19+ページ共通、`<head>`の最初の子）

```html
<head>
  <script>
  (function(){
    var m = document.cookie.match(/(?:^|;\s*)__client_uat[^=]*=([^;]*)/);
    document.documentElement.setAttribute('data-auth', (m && m[1] && m[1] !== '0') ? 'member' : 'guest');
  })();
  </script>
  <!-- 既存の <link rel="stylesheet"> 等はこの後 -->
</head>
```

- 外部ファイル化しない（ダウンロード待ちでペイント前に間に合わない可能性があるため、設計書C-1）。
- 全ページに手で入れるとドリフトする→後述の`check-auth-head-snippet.mjs`で検査。

### 2. CSS契約を追加（`common.css`等の共通スタイルに1箇所）

```css
html[data-auth="guest"] .member-only { display: none !important; }
html[data-auth="member"] .guest-only { display: none !important; }
```

- `body > *` を対象にするセレクタは禁止（Clerkが`body`直下にモーダルを追加するため。設計書G-12）。

### 3. `auth-gate.js` → `auth-mode.js`へ役割変更

- `location.replace` / `PUBLIC_PATHS` / `hideApp()` / `goToLp()` を削除。
- 残す役割: memberモードのとき`YEAuth.ensureSession()`で裏取りし、
  - 成功 → 何もしない（すでにmemberレイアウトが見えている）
  - 失敗 → トースト表示 + `document.documentElement.setAttribute('data-auth', 'guest')`（唯一許される事後遷移、設計書C-5-3）

### 4. 各ページのHTMLに`.guest-only`/`.member-only`を配置

- 既存コンテンツのうち「記録・個人データ」表示部分を`.member-only`、「サンプル・説明」部分を`.guest-only`として両方をDOMに置く。
- memberの中身がClerk待ちの間は、同じ寸法のスケルトンを表示（CLS対策、設計書C-3）。

### 5. 関所を`YEStorage.set`に実装（`common.js`）

```js
var GUEST_ALLOWED_KEYS = ['auth_signed_in', /* onboarding既読キー, 表示設定キー, notify設定キー を実ファイルで確認して列挙 */];

YEStorage.set = function(key, value) {
  if (document.documentElement.getAttribute('data-auth') !== 'member' && GUEST_ALLOWED_KEYS.indexOf(key) === -1) {
    YEAuth.requireSignIn(); // openSignIn()を呼ぶラッパー、実ファイルで既存有無を確認
    return false;
  }
  // 既存の保存処理
};
```

- `GUEST_ALLOWED_KEYS`の正確な一覧は実ファイル（`auth.js:115`付近、onboarding既読キー等）を読んで確定させる。ここでの例示を鵜呑みにしない。
- `YEAuth.requireSignIn()`相当の関数が無ければ`YEAuth.openSignIn()`を直接呼ぶ形で可（設計書D「ログインを開く関数を1つに限定」に従う）。

### 6. `/lp/`の扱い変更

- `/`等からの強制送還先ではなくす。ゲストのヘッダー等に「くわしく」的な任意リンクとして残す。

## 機械的な完了判定（すべて緑になるまで完了扱いにしない）

- [ ] Playwright: `page.on('framenavigated')`発火回数 = 1（`/`と`/me/`で、cookie無し/`=0`/有効な3フィクスチャ）
- [ ] Playwright: 0/100/300/1000msのスクリーンショットで主要レイアウト要素のbounding boxが同一
- [ ] Playwright: `documentElement.dataset.auth`が`DOMContentLoaded`前に確定している
- [ ] `check-auth-head-snippet.mjs`（新規、`templates/diagnostics/`候補）: 全対象HTMLで「headの最初の子」「stylesheetより前」「金型と同一ハッシュ」
- [ ] grep契約: 認証系JS（`auth-mode.js`等）に`location.replace(`が存在しない
- [ ] ゲストで全主要操作 → `ye_`記録キーが増えない・Clerkシートが開く（手動またはPlaywright）
- [ ] サインイン成立 → `auth_signed_in`等の許可キーが書ける（オンボーディングが無限ループしない）
- [ ] Android エミュレータ実機確認（`docs/ai-workflows/EMULATOR-VERIFY-HOWTO.md`手順）: 起動→ゲスト閲覧→関所→Clerkシート→ログイン→同一画面でデータ表示、を録画
- [ ] Android エミュレータ: ログイン→アプリ完全終了→再起動→member判定が保持される（設計書G-10、Capacitor冷起動時のcookie可用性の未確認事項）
- [ ] Clerk Dashboardでパスワード（メール）サインインが有効であること確認（設計書G-11、2.1(a)のデモアカウント運用に必須）

## 地雷（設計書Gから抜粋、実装時に必ず見る）

1. スニペットを`<body>`末尾や外部ファイルに置くと、ちらつきが戻る
2. `YEStorage.set`を無差別に止めるとサインイン自体が成立しなくなる（許可リスト必須）
3. Clerkが読めない時に黙ってguestへ落とすと「ログインしていたのに記録が消えた」体験になる（member骨格のまま「再試行」を出す）
4. `body > *`を隠すCSSはClerkモーダルごと隠す（2026-09-16に実際に踏んだ事故）

## 未確認事項（実装前または提出前に必ず確認）

- Clerk側でパスワード/メールサインインが有効か（審査デモアカウントが使えるかに直結）
- Capacitor冷起動時、WebViewがcookieストア復元前にページを評価するか（member/guestの誤判定リスク）

## この後（MVP確定後）

- 金型化: `web-ios-android/templates/web/auth-mode/`へスニペット・CSS契約・`check-auth-head-snippet.mjs`を格上げ
- voice: 保留中のフロントPRの中で同じ設計を最初から適用（設計書B-3）
- surechigai: 既存ゲストシェルの判定シグナルを`__client_uat`に統一 + `_layout.tsx`の再マウント解消（過去の審査却下領域のため、先にPlaywrightトレースで遷移回数を計測してから着手。設計書B-2・G-5）

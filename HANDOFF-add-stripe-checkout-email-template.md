# 引き継ぎ: Stripe決済→購入完了メール送信テンプレートをキットに追加

## 背景・目的
`soushin-suggest.link`（¥980買い切りツールのLP）で「Stripe Payment Link決済 → Cloudflare Pages FunctionsでWebhook受信 → Resend経由で購入完了メール送信」という一連の仕組みを実装・本番稼働させた。買い切り課金の物販/ツール系アプリは今後も出す可能性が高いため、この仕組みを `web-ios-android` キットに汎用テンプレートとして追加してほしい。

事前調査済み: このキットには決済・メール送信の前例が一切ない（同梱の `kimitolink-line/` にサブスク課金のStripe実装はあるが別物・無関係）。つまり `templates/` 配下に**完全新規のテンプレートカテゴリ**を作ることになる。

## 参照実装（コピー元）
`C:\Users\info\OneDrive\デスクトップ\Resilio\github\soushin-suggest.link` の以下のファイルが実装の現物：
- [`functions/api/stripe-webhook.ts`](../soushin-suggest.link/functions/api/stripe-webhook.ts) — 本体。Stripe署名検証→`checkout.session.completed`のみ処理→Resend APIをfetch直叩きでメール送信
- [`_routes.json`](../soushin-suggest.link/_routes.json) — Cloudflare Pagesで`/api/*`だけをFunctionsに委譲する設定
- [`package.json`](../soushin-suggest.link/package.json) — 依存は`stripe`のみ（Resendは`fetch`直叩きでSDK不使用）
- [`tsconfig.json`](../soushin-suggest.link/tsconfig.json) — `@cloudflare/workers-types`を使う設定

必要な環境変数（Cloudflare Pagesダッシュボードで設定、リポにファイルなし）:
- `STRIPE_SECRET_KEY` — Payment Link作成に使ったキー
- `STRIPE_WEBHOOK_SECRET` — Stripeダッシュボードのwebhookエンドポイント設定から取得
- `RESEND_API_KEY` — 送信権限のあるResend APIキー
- `MAIL_FROM` — 検証済み送信元（例: `"君斗りんくの送信サジェスト <noreply@best-trust.biz>"`）

## やってほしいこと

### 1. `templates/stripe-checkout-email/` を新設
既存の`templates/`の設計思想（`app.config.json`駆動、`{{...}}`プレースホルダー、無改変で使える部分と要置換部分を分ける）に倣うこと。`templates/README.md`の表の書き方・粒度を参考にする。

構成案:
```
templates/stripe-checkout-email/
  functions/api/stripe-webhook.ts.template   ← コピー元から汎用化
  _routes.json                                ← 無改変で使える
  README.md                                   ← セットアップ手順・env変数一覧・Stripeダッシュボード側の設定手順
```

### 2. `stripe-webhook.ts` の汎用化（プレースホルダー化）
現物には以下のプロダクト固有値がハードコードされている。これを`{{...}}`プレースホルダーに置き換える:
- `DOWNLOAD_URL`（GitHub Releasesのzip URL）
- `SITE_URL`
- `KIMITO_LINK_COM_URL`（→ より汎用的に `{{BRAND_HUB_URL}}` 等の名前を検討）
- `BRAND_LOGO_URL` / `PRODUCT_ICON_URL`
- メール件名・本文中の商品名（「君斗りんくの送信サジェスト」）、会社名（株式会社ベストトラスト）
- 本文末尾のクロスセル導線（reply-suggest.link等の姉妹サービス一覧）— これはプロダクト固有の宣伝ブロックなので、テンプレでは**コメントアウト付きのオプションブロック**として残すか、丸ごと削って「ここに関連サービス導線を入れられる」という説明コメントだけ残すか、判断して決めてよい

置換方式は`next-app/`や`capacitor.config.template.ts`が採用している`{{変数名}}`をそのまま踏襲する（キット内で置換方式を統一するため）。

### 3. メール本文HTMLのレイアウトは汎用テンプレートとして残す
`renderEmailHtml()`のテーブルレイアウト（ロゴ→挨拶文→DLボタン→導入手順ボックス→本文→区切り線→クロスセル→サービス一覧→フッター）自体は、Gmail/Outlook耐性のあるレスポンシブ不要のtable-basedレイアウトとして汎用的に使えるので、構造は維持しつつ中身の文言をプレースホルダー化する。「3ステップ導入手順」のような商品固有の手順テキストも `{{INSTALL_STEPS_HTML}}` のような差し込み用プレースホルダーにするか、実装しやすい形を判断して決めてよい。

### 4. README.mdに手順を書く
以下を含めること（`soushin-suggest.link`側で実際に踏んだ設定手順ベース）:
- Stripeダッシュボードでの Payment Link 作成 → Webhookエンドポイント登録（`checkout.session.completed`イベント）の手順
- Cloudflare Pages側で4つの環境変数を設定する手順
- ビルドコマンドが空だと`npm install`が走らずFunctionsがビルド失敗する、という既知の地雷（`soushin-suggest.link`の`HANDOFF`に記載あり、下記参照）
- Webhook疎通確認の方法: `curl -X POST https://<domain>/api/stripe-webhook` で400（署名エラー）が返ればOK
- Resend送信元ドメインの検証が必要な点

### 5. `templates/README.md` の一覧表に追記
既存の表（41行目以降のテーブル）に1行追加し、新カテゴリの存在を発見可能にする。

### 6. 踏んだ地雷の申し送り（README.mdかコメントに反映）
`soushin-suggest.link`側で実際に遭遇した罠:
- Cloudflare Pages Functionsは`_routes.json`が無いと`/api/*`が静的アセット（index.html）にフォールバックしてしまう
- Cloudflare Pagesのビルドコマンドが空だと`npm install`が走らず`node_modules`依存のFunctionsがビルド失敗する
- Stripe/Cloudflareのシークレットを`setx`経由でGit Bash実行すると末尾に改行が混入することがある（PowerShellの`Trim()`で対処）

## 注意事項
- Stripe/Resendの実際のAPIキーやシークレットは絶対にファイルやコミットに含めない（プレースホルダーのみ）
- `templates/README.md`の「リリースCI/スクリプト本体はキットに置かず現物からコピーする」という運用方針とは別カテゴリの追加である点に注意。これはNext.js/Capacitorのアプリ側とは独立した「Web決済導線」の金型なので、既存のiOS/Android提出パイプラインとは混同しない
- 既存の`templates/`ファイルは変更しない（新規追加のみ）

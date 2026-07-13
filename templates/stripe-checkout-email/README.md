# templates/stripe-checkout-email/ — Stripe決済→購入完了メール送信の金型

Stripe Payment Link決済 → Cloudflare Pages FunctionsでWebhook受信 → Resend経由で購入完了メール送信、
という買い切り課金導線の金型。`soushin-suggest.link`（¥980買い切りツールのLP）で実装・本番稼働済み。

このキットの既定Webデプロイ手段はVercelだが、本テンプレートは**Cloudflare Pages Functionsを前提**とする
（Stripe Webhookの受信先として使う。既存の`templates/next-app/`等とは独立したWeb決済導線の金型であり、
iOS/Android提出パイプラインとは無関係）。

## 中身

| ファイル | 役割 | プロダクト固有値の扱い |
| --- | --- | --- |
| `functions/api/stripe-webhook.ts.template` | 本体。Stripe署名検証→`checkout.session.completed`のみ処理→Resend APIをfetch直叩きでメール送信 | `{{downloadUrl}}` / `{{siteUrl}}` / `{{brandHubUrl}}` / `{{brandLogoUrl}}` / `{{productIconUrl}}` / `{{productName}}` / `{{brandName}}` / `{{welcomeMessage}}` / `{{installStepsHtml}}` / `{{brandDescription}}` / `{{companyName}}` を置換。クロスセル導線・関連サービス一覧はコメントアウトされたオプションブロック（無ければ削除、あれば`{{crossSellLabel}}`等を埋めて有効化） |
| `_routes.json` | Cloudflare Pagesで`/api/*`だけをFunctionsに委譲する設定 | **無改変で使える** |

依存パッケージ（アプリ側の`package.json`に追加）:
```json
{
  "dependencies": { "stripe": "^18.0.0" },
  "devDependencies": {
    "@cloudflare/workers-types": "^5.20260713.1",
    "typescript": "^7.0.2"
  }
}
```

`tsconfig.json`は`@cloudflare/workers-types`を使う設定にする（`types: ["@cloudflare/workers-types"]`、
`include: ["functions/**/*.ts"]`）。

## 使い方

1. `functions/api/stripe-webhook.ts.template` をアプリのリポジトリの `functions/api/stripe-webhook.ts` に
   コピーし、`{{...}}` を埋める。
2. `_routes.json` をリポジトリ直下にコピー（無改変）。
3. Stripeダッシュボードで Payment Link を作成 → Webhookエンドポイント（`https://<domain>/api/stripe-webhook`）を
   `checkout.session.completed` イベントで登録。
4. Cloudflare Pagesプロジェクト設定で環境変数を4つ設定する（Cloudflare Pagesダッシュボードのみ、
   リポにファイルは置かない）:
   - `STRIPE_SECRET_KEY` — Payment Link作成に使ったキー
   - `STRIPE_WEBHOOK_SECRET` — Stripeダッシュボードのwebhookエンドポイント設定から取得
   - `RESEND_API_KEY` — 送信権限のあるResend APIキー
   - `MAIL_FROM` — 検証済み送信元（例: `"{{productName}} <noreply@example.com>"`）
5. Resendの送信元ドメインを検証済みにしておく（未検証だと送信が拒否される）。
6. デプロイ後、Webhook疎通確認: `curl -X POST https://<domain>/api/stripe-webhook` を実行し、
   **400（署名エラー）が返ればFunctionsまで到達している**ことの確認になる（200/404が返る場合は後述の
   既知の罠を疑う）。

## 既知の罠（`soushin-suggest.link`で実際に踏んだもの）

- **`_routes.json`が無いと`/api/*`が静的アセット（index.html）にフォールバックする。** Functionsに
  到達せず200やHTMLが返ってくる場合はこれを疑う。
- **Cloudflare Pagesのビルドコマンドが空だと`npm install`が走らず、`node_modules`依存のFunctionsが
  ビルド失敗する。** プロジェクト設定でビルドコマンドを明示すること（空欄のまま放置しない）。
- **Stripe/Cloudflareのシークレットを`setx`経由でGit Bash実行すると末尾に改行が混入することがある。**
  値の比較・検証で失敗する場合はこれを疑い、PowerShell側の`Trim()`等で対処する。

## 守ること

- Stripe/Resendの実際のAPIキー・シークレットは絶対にファイル・コミット・ログに含めない（環境変数
  経由のみ）。トークンなど認証情報の安全な扱い方は
  [`../../docs/ai-rules/01_CORE_RULES.md`](../../docs/ai-rules/01_CORE_RULES.md) §5を参照。
- 本テンプレートは`templates/`の既存ファイルとは独立した新規カテゴリ。既存のiOS/Android提出
  パイプライン（`templates/scripts/`, `templates/workflows/`）とは混同しない。

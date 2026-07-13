# Cloudflare Workers（wrangler）トークン失効の症状・再発行手順・account_id不一致確認

> 実戦記録。姉妹プロジェクト `ai-shain.link`（Cloudflare Workers運用）で、デプロイ用の
> `CLOUDFLARE_API_TOKEN` が期限切れになり `wrangler deploy` が失敗した際に踏んだ手順を一般化したもの。
> このキットの既定Webデプロイ手段は**Vercel**（[`CLAUDE.md`](../CLAUDE.md)参照）だが、Cloudflare Workers/Pages
> をWebデプロイ手段に使う案件でも同じ症状が出るため、次にAIがこのエラーを見たときに検索で当てられるよう
> 症状文言をそのまま残す。

## 症状（そのまま検索に引っかかる文言）

- `wrangler deploy` / `wrangler whoami` が失敗し、`Failed to automatically retrieve account IDs for this Login. In a moment, you will be prompted to select an account...` のようなメッセージ、
  もしくはトークン失効特有のエラーで止まる
- `wrangler login` を試すと **`You are logged in with an API Token. Unset the CLOUDFLARE_API_TOKEN in the environment to log in via OAuth`** というエラーで詰まる
  - これは「環境変数`CLOUDFLARE_API_TOKEN`がセットされている限り、Wranglerは常にトークン認証を優先し、OAuthログインには進めない」という仕様。トークンが切れているのにOAuthで逃げようとしても、環境変数を先にunsetしない限り同じ壁に当たる

## 原因

- Cloudflare APIトークンには有効期限・失効設定があり、期限切れ/失効すると`wrangler`の全コマンドが認証エラーになる
- ローカル環境変数に古いトークンが残ったままだと、`wrangler login`によるOAuth方式（[`DESIGN-lp-first-domain-connect-2026-07-13.md`](./DESIGN-lp-first-domain-connect-2026-07-13.md)で採用した方式）を試みても、環境変数のトークンが優先されて弾かれる

## 再発行手順（人間が行う。AIはガイドのみ）

1. `https://dash.cloudflare.com/profile/api-tokens` を開く
2. 該当トークンの「ロールオーバー（Roll）」＝**既存トークンの値だけを再発行し、権限設定はそのまま引き継ぐ**操作を行う。新規トークンを一から作り直す必要はない
   - ロールオーバーが使えない/見当たらない場合は、同じ権限セット（アカウント → Workers スクリプト → 編集、等）で新規トークンを作成する
3. 発行された新しいトークン値を、AIには**渡さず**、環境変数に人間が直接セットする（下記「安全な扱い方」参照）
4. `wrangler whoami` で認証が通ることを確認 → `wrangler deploy` を実行

## account_id 不一致の確認

- `wrangler.jsonc`（または`wrangler.toml`）の`account_id`が、**新しく発行したトークンが属するCloudflareアカウント**と一致しているかを必ず確認する
- 複数アカウントを使い分けている場合、トークンだけ更新して`account_id`が古いままだと、認証は通るのに別アカウントのリソースを操作しようとして別のエラーになる
- 確認方法: `wrangler whoami`の出力に表示されるアカウント名・IDと、`wrangler.jsonc`の`account_id`を突き合わせる

## 安全な扱い方（AIの行動規範）

- **AIはトークンの値を絶対に見ない・出力しない。** `grep`/`cat`で環境変数の中身を直接確認しようとする行為は、Claude Codeのauto mode分類器に「Credential Materialization（認証情報の露出）」として拒否される設計になっており、これは意図した挙動。回避しようとしない
- 環境変数の**存在確認だけ**が必要な場合は、値を出力しない形（例: シェルで `${VAR:+yes}` 形式や、値をマスクした状態でのフラグ確認）に留める
- 新しいトークン値はユーザーが直接環境変数にセットする（AIが代わりに`export`コマンドの引数として値を受け取り実行するのは、コマンド履歴やログに値が残るため避ける。ユーザーに「ご自身の端末でこのコマンドを実行してください」と案内する）
- この安全ルールはCloudflareに限らず、Vercel/GitHub/Stripe等どの認証トークンにも共通する。詳細は
  [`docs/ai-rules/01_CORE_RULES.md`](../docs/ai-rules/01_CORE_RULES.md) §5（セキュリティ原則）を参照

## このキットでの位置づけ

- 既定のWebデプロイ手段はVercel（Git連携の自動デプロイ）であり、Cloudflare Workers/Pagesは**現時点では
  正式なテンプレート化はしていない**（`templates/`にCloudflare版の雛形は無い）
- Cloudflare Workers/PagesをWebデプロイ手段として選ぶ案件では、この文書の内容が唯一の実戦知見となる
- 将来的にCloudflare版のデプロイテンプレート（`wrangler.jsonc`雛形、GitHub Actionsでの`wrangler deploy`実行例）
  を`templates/`に追加する場合は、この文書のトークン失効対応を手順に含めること

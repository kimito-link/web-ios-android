# templates/line-bot/ — LINE公式アカウントAI社員bot の金型

新しいアプリに「LINEで会話できるAI社員」を追加するための実証済みテンプレート。
出典: `line-harness-oss`（ai-shain.link で実運用中の GROQ AI応答パイプライン。CRM機能・マルチアカウント対応は除去し、単一アプリ用に最小化した）。

## これは何をするものか

ユーザーがLINE公式アカウントにメッセージを送ると、GROQ（Llama 3.3）がキャラクターの人格で応答する。
キャッシュ→定型応答→RAG検索→LLM生成の4段構成で、無料枠内に収まるようコスト最適化されている。
エラー・予算超過時は必ず固定の詫び文言を返す**fail-closed設計**（無言化を防ぐ）。

## 中身

| パス | 役割 | アプリ固有値の扱い |
| --- | --- | --- |
| `worker/src/` | Cloudflare Workers本体（Hono）。webhook受信→署名検証→GROQパイプライン→LINE返信 | 無改変 |
| `migrations/001_init.sql` | 最小スキーマ（friends/messages_log/llm_response_cache/kb_articles/groq_usage_daily） | 無改変 |
| `bot.config.json` | モデル名・日次予算・キャッシュ設定 | アプリごとに調整可（`dailyCallBudget`等） |
| `knowledge-pack/persona.md` | キャラの人格・トーン | **アプリ固有**。`{{botCharacterName}}`/`{{appDisplayName}}`を置換し、導入手順等を書き足す |
| `knowledge-pack/guardrails.md` | 禁止事項・エスカレーション条件 | **アプリ固有**。未対応機能を書き足す |
| `knowledge-pack/canned/*.txt` | キーワード完全一致の定型応答 | **アプリ固有** |
| `wrangler.toml.template` | Cloudflare Workers設定 | `{{shortName}}`/`{{cloudflareAccountId}}`/`{{cloudflareD1DatabaseId}}`を置換 |
| `workflow.yml.template` | GitHub Actionsデプロイワークフロー | `{{shortName}}`を置換。`.github/workflows/`にコピー |
| `package.json.template` | 依存関係・スクリプト | `{{shortName}}`を置換 |

## 使い方（新しいアプリにLINE botを追加する）

1. `app.config.json` の `lineBot` セクションを埋める（`enabled: true`にする。下記スキーマ参照）。
2. このディレクトリ一式を新リポの `line-bot/` にコピーし、`{{...}}` を `app.config.json` の値に置換する
   （`.template`拡張子のファイルは拡張子を外してコピー: `wrangler.toml.template` → `wrangler.toml`）。
3. `knowledge-pack/persona.md` と `guardrails.md` を、アプリのキャラクター・導入手順に合わせて書き換える。
4. LINE Developersコンソールで新規チャネル（Messaging API）を作成し、Channel Secret / Access Tokenを控える。
5. Cloudflareで D1データベースを作成: `npx wrangler d1 create {{shortName}}-line-db`。IDを`wrangler.toml`に反映。
6. Secretsを投入: `wrangler secret put LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` / `GROQ_API_KEY`。
   GitHub Secretsに`CLOUDFLARE_API_TOKEN`も登録する。
7. `workflow.yml.template`を`.github/workflows/deploy-line-bot.yml`としてコピーし、pushしてデプロイ。
8. LINE Developersコンソールで Webhook URL を `https://{{shortName}}-line.<account>.workers.dev/webhook` に設定し「検証」。

## ⚠️ 必ず守ること（実障害から得た地雷）

1. **手動 `wrangler deploy` は禁止。** `wrangler.toml`に`[vars]`を書くと、手動デプロイのたびに
   本番の環境変数が開発用プレースホルダーで上書きされる実障害が起きた。デプロイは必ずGitHub Actions経由にする。
2. **LINE公式アカウント管理画面（manager.line.biz）で「応答メッセージ」「AIチャットボット(β)」を必ずOFFにする。**
   ONのままだとLINE標準の定型文がwebhookより先に割り込み、bot返信が届かない（原因特定に丸1日かかった実障害）。
3. **例外時は必ず固定文言を返す。** `console.error`だけで返信しないと「何を送っても無反応」になる
   （ユーザーには「壊れている」としか見えない、最も気づきにくい無言化バグ）。このテンプレの`webhook.ts`は
   try/catchの全パスで返信するよう実装済み。改変時もこの性質を崩さないこと。
4. **`friends.ai_reply_mode`が`'human'`のまま放置されると無言に見える。** GROQがエスカレーション判定すると
   自動的に`human`に切り替わる仕様（担当者が手動対応する想定）。運用中「返信が来ない」と言われたら、
   まずこのカラムを疑う。
5. **`knowledge-pack/*.md`とWorkersの読み込み方法が二重管理にならないようにする。** このテンプレは
   `import personaMd from '../knowledge-pack/persona.md'`という静的importで直接読む設計にしており
   （line-harness-ossにあった手動同期必須のTS焼き込み版は採用していない）、書き換えたら再デプロイのみで反映される。

## 移植元との違い（意図的な簡素化）

- マルチLINEアカウント対応・`entry_routes`によるマルチプロダクト解決は削除（1キット=1アプリ=1LINE公式アカウント前提）。
- シナリオ配信・リッチメニュー・タグ管理などCRM機能は含まない（bot応答のみ）。
- 将来これらが必要になったら、出典の `line-harness-oss` を参照する（このテンプレへの逆輸入はしない — 複雑化を避ける）。

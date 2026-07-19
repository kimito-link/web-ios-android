# templates/line-bot/ — LINE公式アカウントAI社員bot の金型

新しいアプリに「LINEで会話できるAI社員」を追加するための実証済みテンプレート。
出典: `line-harness-oss`（ai-shain.link で実運用中の GROQ AI応答パイプライン。CRM機能・マルチアカウント対応は除去し、単一アプリ用に最小化した）。

## これは何をするものか

ユーザーがLINE公式アカウントにメッセージを送ると、LLMがキャラクターの人格で応答する。
キャッシュ→定型応答→RAG検索→LLM生成チェーンの4段構成で、無料枠内に収まるようコスト最適化されている。
LLM生成段は**Groq→Gemini→Cloudflare Workers AIの3プロバイダをフォールバックするチェーン**
（無応答ゼロ化アーキテクチャ、2026-07-17 Fable設計）になっており、1社が落ちても止まらない。
エラー・予算超過時は必ず固定の詫び文言を返す**fail-closed設計**（無言化を防ぐ）。

## 中身

| パス | 役割 | アプリ固有値の扱い |
| --- | --- | --- |
| `worker/src/` | Cloudflare Workers本体（Hono）。webhook受信→署名検証→LLMチェーン→LINE返信 | 無改変 |
| `worker/src/services/llm-providers.ts` | Groq/Gemini/Workers AI 3プロバイダの共通呼び出し層＋vision/video/audio呼び出し | 無改変 |
| `worker/src/services/llm-chain.ts` | 3プロバイダを順に試すフォールバックチェーン（残り時間駆動） | 無改変 |
| `worker/src/services/vision-describe.ts` | 画像→客観描写（Groq/Geminiのvisionチェーン） | 無改変 |
| `worker/src/services/media-describe.ts` | 動画・音声→客観描写（Geminiのみ対応） | 無改変 |
| `worker/src/services/incoming-image.ts` / `incoming-media.ts` | LINE Content APIから受信メディアを取得しR2に保存 | 無改変 |
| `worker/src/routes/images.ts` | 保存済みメディアの配信ルート（`GET /images/:key`） | 無改変 |
| `migrations/001_init.sql` | 最小スキーマ（friends/messages_log/llm_response_cache/kb_articles/groq_usage_daily） | 無改変 |
| `bot.config.json` | モデル名・チェーン構成・日次予算・キャッシュ設定 | アプリごとに調整可（`dailyCallBudget`・`llm.chain`等） |
| `knowledge-pack/persona.md` | キャラの人格・トーン | **アプリ固有**。`{{botCharacterName}}`/`{{appDisplayName}}`を置換し、導入手順等を書き足す |
| `knowledge-pack/guardrails.md` | 禁止事項・エスカレーション条件 | **アプリ固有**。未対応機能を書き足す |
| `knowledge-pack/canned/*.txt` | キーワード完全一致の定型応答 | **アプリ固有** |
| `wrangler.toml.template` | Cloudflare Workers設定（`[ai]`バインディング含む） | `{{shortName}}`/`{{cloudflareAccountId}}`/`{{cloudflareD1DatabaseId}}`を置換 |
| `workflow.yml.template` | GitHub Actionsデプロイワークフロー | `{{shortName}}`を置換。`.github/workflows/`にコピー |
| `package.json.template` | 依存関係・スクリプト | `{{shortName}}`を置換 |

## 無応答ゼロ化チェーン（LLM生成段の3段フォールバック）

`bot.config.json` の `llm.chain` に定義された順（既定: Groq → Gemini → Cloudflare Workers AI）で試し、
最初に成功した段の応答を採用する。全滅時のみ定型お詫び文言まで落ちる。

- **1番手 Groq** `llama-3.3-70b-versatile`（最速。既存キャラプロンプトの調律先）
- **2番手 Gemini** `gemini-2.5-flash-lite`（無料枠が寛大・安定性が高い。`GEMINI_API_KEY`未設定なら自動スキップ）
- **3番手 Cloudflare Workers AI** `@cf/meta/llama-3.3-70b-instruct-fp8-fast`（Worker内バインディングで外部egressが無く、Groq/Google両方の障害から独立）

各段には個別のタイムアウトがあり（既定8〜10秒）、LINEの`replyToken`失効（発行から約60秒）に対して
「残り時間が足りない段は丸ごとスキップして次へ」という設計になっている。送信側にも保険があり、
`replyMessage`が失敗（トークン失効等）した場合は自動で`pushMessage`に切り替えて必ず届ける。

**コストは既定¥0/月**。Gemini・Workers AIはGroq障害時にしか呼ばれないため、無料枠の範囲で収まる想定。
Gemini無料枠を使うには`GEMINI_API_KEY`（Google AI Studioで無料発行）を設定するだけでよい。
未設定でもGroq→Workers AIの2段チェーンとして動く（Geminiだけ静かにスキップされる）。

## 画像・動画・音声認識（2026-07-17/19追加、line-harness-oss本体からの移植）

ユーザーが画像・動画・音声を送ると、①客観的な説明文（describe）を生成 → ②その説明文を
「あなたらしく反応してください」という指示付きでテキストパイプラインに渡し、キャラクターの
人格で反応する、という2段構成で動く。

| 種類 | 使うモデル | 方式 |
| --- | --- | --- |
| 画像 | Groq (`qwen/qwen3.6-27b`) → Gemini (`gemini-2.5-flash-lite`) の2段フォールバック | OpenAI互換`chat/completions`の`image_url` content type |
| 動画 | Gemini (`gemini-2.5-flash-lite`) のみ | ネイティブ`generateContent` APIの`inline_data`（**OpenAI互換の`video_url`は実機検証でGemini側に拒否されることを確認済み**なので使えない） |
| 音声 | Gemini (`gemini-2.5-flash-lite`) のみ | OpenAI互換`chat/completions`の`input_audio` content type |

動画・音声がGeminiのみなのは、Groq/Cloudflare Workers AIがこれらの入力形式に対応していないため
（画像のみ複数プロバイダでフォールバックできる）。`GEMINI_API_KEY`が未設定の場合、動画・音声認識は
静かにスキップされる（テキスト・画像のAI応答には影響しない）。

**サイズ上限は既定15MB**（`bot.config.json`の`llm.video.maxInputBytes`/`llm.audio.maxInputBytes`で調整可）。
超過した動画・音声は説明文を諦め、`[動画]`/`[音声]`ラベルのみを記録して**無言のまま**終わる
（fail-closed設計。返信が来ないこと自体は「未対応」の正常な挙動）。

セットアップに必要な追加作業:
1. `npx wrangler r2 bucket create {{shortName}}-line-images` でR2バケットを作成
2. `wrangler.toml`の`[[r2_buckets]]`が正しいバケット名を指しているか確認（プレースホルダー置換で自動的に揃うはず）
3. `GEMINI_API_KEY`を設定（Groq→Gemini→Workers AIチェーンの2番手と共用。Google AI Studioで無料発行）

**実機検証で判明した罠**（動画・音声固有。画像には無い）:
- LINEの動画・音声メッセージには「トランスコード準備状態」があり、webhook受信直後はまだ
  `processing`（未完了）で`getMessageContent`が失敗することがある。`incoming-media.ts`は
  `/content/transcoding`で状態を確認してから本体取得する（最大約9秒ポーリング）。
- LINEアプリの音声メッセージは実測で`audio/x-m4a`というcontent-typeを返す（`audio/mp4`ではない）。
  これが未対応だと全件`unsupported content-type`でfail-closedし、**音声にだけ一切反応しない**という
  分かりにくい不具合になる（`media-describe.ts`の`CONTENT_TYPE_TO_AUDIO_FORMAT`で対応済み）。

## 使い方（新しいアプリにLINE botを追加する）

1. `app.config.json` の `lineBot` セクションを埋める（`enabled: true`にする。下記スキーマ参照）。
2. このディレクトリ一式を新リポの `line-bot/` にコピーし、`{{...}}` を `app.config.json` の値に置換する
   （`.template`拡張子のファイルは拡張子を外してコピー: `wrangler.toml.template` → `wrangler.toml`）。
3. `knowledge-pack/persona.md` と `guardrails.md` を、アプリのキャラクター・導入手順に合わせて書き換える。
4. LINE Developersコンソールで新規チャネル（Messaging API）を作成し、Channel Secret / Access Tokenを控える。
5. Cloudflareで D1データベースを作成: `npx wrangler d1 create {{shortName}}-line-db`。IDを`wrangler.toml`に反映。
6. Secretsを投入: `wrangler secret put LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` / `GROQ_API_KEY` /
   `GEMINI_API_KEY`（無応答ゼロ化チェーンの2番手。任意だが強く推奨。Google AI Studioで無料発行）。
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
   - 2026-07-16 実障害（line-harness-oss/ai-shain.linkで発生・本テンプレも同じ構造だったため同時修正）:
     エスカレーション時、GROQが返す`[ESCALATE]`除去後の本文が空だと**何も返信せず`human`に切り替わるだけ**
     というパスがあり、ユーザーには「既読無視」に見えた。`webhook.ts`のescalate分岐は本文が空でも
     必ず「ちょっと待っててね、中の人につなぐね。」を返すよう修正済み（改変時もこの性質を崩さないこと）。
   - あわせて`guardrails.md`のエスカレーション条件も、「専門的だから」というだけでは発動しないよう
     最小限（命の危険・契約交渉・個人情報等の本当に人間でないと無理なものだけ）に絞ってある。
     AIはまず自分で調べて答え切ることを優先する設計（安易なエスカレーションはユーザーの二度手間になる）。
5. **`knowledge-pack/*.md`とWorkersの読み込み方法が二重管理にならないようにする。** このテンプレは
   `import personaMd from '../knowledge-pack/persona.md'`という静的importで直接読む設計にしており
   （line-harness-ossにあった手動同期必須のTS焼き込み版は採用していない）、書き換えたら再デプロイのみで反映される。

## 移植元との違い（意図的な簡素化）

- マルチLINEアカウント対応・`entry_routes`によるマルチプロダクト解決は削除（1キット=1アプリ=1LINE公式アカウント前提）。
- シナリオ配信・リッチメニュー・タグ管理などCRM機能は含まない（bot応答のみ）。
- 将来これらが必要になったら、出典の `line-harness-oss` を参照する（このテンプレへの逆輸入はしない — 複雑化を避ける）。

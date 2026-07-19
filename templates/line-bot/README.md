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

## 使い方（新しいアプリにLINE botを追加する） — やることこれだけ

前提知識ゼロでもこの順番通りに進めれば完走できます。Cloudflare・LINE Developers・GitHubの
アカウントを触ったことがなくても、各ステップにリンクと具体的な操作を書いています。

### STEP 0. 前提アカウントを用意する（初回のみ）

- **[Cloudflareアカウント](https://dash.cloudflare.com/sign-up)**（無料）を作る。
- ローカルに [Node.js](https://nodejs.org/)（v18以上）が入っていること。
- ターミナルで次を実行し、ブラウザが開いたらCloudflareアカウントでログインする（Wrangler CLIはこのテンプレの
  `package.json.template` に依存として入っているので別途インストール不要。初回だけログインが必要）:
  ```
  npx wrangler login
  ```
- **[LINE Developersコンソール](https://developers.line.biz/console/)** にLINEアカウントでログインし、
  プロバイダー（無ければ「作成」で新規に1つ作る。会社名や個人名でよい）を作っておく。

### STEP 1. `app.config.json` を埋める

リポジトリ直下の `app.config.json` の `lineBot` セクションを開き、`enabled: true` にして
`botCharacterName`（キャラクター名。例: `りんく`）を書く。`cloudflareAccountId` と
`cloudflareD1DatabaseId` は後のSTEPで値が分かってから埋めるので、今は `null` のままでよい。
（スキーマの全項目は `app.config.schema.json` の `lineBot` を参照。`llmProvider` と
`dailyCallBudget` は既定値のままで通常問題ない）

### STEP 2. テンプレートをコピーして変数を置換する

1. このディレクトリ（`templates/line-bot/`）一式を新リポジトリの `line-bot/` にコピーする。
2. `.template` 拡張子のファイルは拡張子を外してコピーする: `wrangler.toml.template` → `wrangler.toml`、
   `package.json.template` → `package.json`、`workflow.yml.template` は後述STEP6で使う。
3. コピーしたファイル内の `{{...}}` を、下の対応表の通りに実際の値へ置換する（テキストエディタの
   「検索して置換」機能で1つずつでよい。自動置換スクリプトは無いので手作業）。

   | 変数 | 置換する値 | 出てくるファイル |
   | --- | --- | --- |
   | `{{shortName}}` | `app.config.json` の `identity.shortName`（例: `NekoDiary`） | `wrangler.toml`, `workflow.yml`, `package.json` |
   | `{{cloudflareAccountId}}` | STEP4で作るD1データベースのコマンド実行時に表示されるアカウントID（[Cloudflareダッシュボード](https://dash.cloudflare.com/)右側にも表示） | `wrangler.toml` |
   | `{{cloudflareD1DatabaseId}}` | STEP4で `wrangler d1 create` 実行後に表示されるID | `wrangler.toml` |
   | `{{botCharacterName}}` | `app.config.json` の `lineBot.botCharacterName`（例: `りんく`） | `knowledge-pack/persona.md`, `knowledge-pack/canned/greeting.txt` |
   | `{{appDisplayName}}` | `app.config.json` の `identity.displayName`（例: `ねこ日記`） | `knowledge-pack/persona.md` |

### STEP 3. 人格（`persona.md`）を書く

`knowledge-pack/persona.md` を開き、STEP2の変数置換をした後、11行目のコメント
`<!-- ここにアプリ固有の導入手順・よくある質問への案内を書き足す -->` の場所に、
そのアプリ特有の使い方・よくある質問の案内文を書き足す。**この人格説明の書き方の詳しい事例・
コツ、および画像・動画・音声にも同じ人格が反映される仕組みは、下記「[人格を作る・調整する](#人格を作る調整する)」を参照。**

### STEP 4. LINE公式アカウントを作る

1. [LINE Developersコンソール](https://developers.line.biz/console/) で、STEP0で作ったプロバイダーを開き、
   「チャネルを作成」→「Messaging API」を選ぶ。チャネル名・説明・カテゴリを入力して作成する
   （チャネル名がLINE上でのbotの表示名になる）。
2. 作成したチャネルの「Messaging API設定」タブで「チャネルアクセストークン（長期）」を発行し控える。
3. 「チャネル基本設定」タブで「チャネルシークレット」を控える。
4. **⚠️ この時点で必ず「LINE Official Account Manager」（[manager.line.biz](https://manager.line.biz/)）
   を開き、対象アカウントの「応答設定」で「応答メッセージ」と「AIチャットボット(β)」を両方OFFにする。**
   ONのままだとLINE標準の定型文がwebhookより先に割り込み、bot側の返信が届かない
   （後述「⚠️ 必ず守ること」2番の実障害。ここで設定を忘れるのが最も気づきにくいトラブルの原因）。

### STEP 5. Cloudflareのデータベースを作る

1. `line-bot/` ディレクトリ内で次を実行しD1データベースを作る:
   ```
   npx wrangler d1 create {{shortName}}-line-db
   ```
   実行結果に表示される `database_id` の値をSTEP2の `{{cloudflareD1DatabaseId}}` として `wrangler.toml`
   に反映する（まだ反映していなければ今ここで書く）。
2. マイグレーションを適用する:
   ```
   npx wrangler d1 execute {{shortName}}-line-db --remote --file=migrations/001_init.sql
   ```

### STEP 6. APIキーとSecretsを投入する

必要なAPIキーを発行する:

- **Groq API Key**（1番手・必須）: [console.groq.com/keys](https://console.groq.com/keys) でログインし
  「Create API Key」。
- **Gemini API Key**（2番手・強く推奨。無応答ゼロ化と画像・動画・音声認識の両方で使う）:
  [Google AI Studio](https://aistudio.google.com/apikey) で「Create API key」。未設定でも動くが、
  Gemini関連の機能（2番手フォールバック、動画・音声認識）だけ静かにスキップされる。

`line-bot/` ディレクトリで、Cloudflare Workersに直接Secretsを投入する（値を聞かれたら貼り付けてEnter）:
```
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put GEMINI_API_KEY
```

さらに、GitHub Actions経由でデプロイするために、GitHubリポジトリの
「Settings → Secrets and variables → Actions」で `CLOUDFLARE_API_TOKEN` を登録する
（Cloudflareダッシュボードの「My Profile → API Tokens → Create Token」で
「Edit Cloudflare Workers」テンプレートを選んで発行した値を貼る）。

### STEP 7. デプロイする

1. `workflow.yml.template` を `.github/workflows/deploy-line-bot.yml` としてコピーする
   （このファイルがpush時に自動でCloudflare Workersへデプロイする）。
2. **⚠️ `wrangler deploy` をローカルから手動実行しない。** 必ずこのGitHub Actionsワークフロー経由で
   デプロイする（理由は後述「⚠️ 必ず守ること」1番）。
3. 変更をコミットしてpushする。GitHubの「Actions」タブでワークフローが成功したことを確認する。

### STEP 8. Webhookを設定して疎通確認する

1. [LINE Developersコンソール](https://developers.line.biz/console/) のチャネル設定「Messaging API設定」タブで、
   Webhook URLに `https://{{shortName}}-line.<account>.workers.dev/webhook` を入力し「検証」を押す
   （`<account>`はCloudflareのアカウント名。STEP7のデプロイ結果に表示されるURLをそのまま使うのが確実）。
   「成功」と表示されればOK。
2. 「Webhookの利用」がONになっていることを確認する。
3. 実際にそのLINE公式アカウントを友だち追加し、メッセージを送って返信が来ることを確認する。

### STEP 9（任意）. 画像・動画・音声認識を有効にする

テキストでの応答ができたら、必要に応じて画像・動画・音声への対応を追加する
（詳しい仕組みは前述「[画像・動画・音声認識](#画像動画音声認識2026-07-1719追加line-harness-oss本体からの移植)」を参照）。

1. `npx wrangler r2 bucket create {{shortName}}-line-images` でR2バケットを作成する。
2. `wrangler.toml` の `[[r2_buckets]]` が正しいバケット名を指しているか確認する
   （STEP2の変数置換で自動的に揃っているはず）。
3. STEP6で `GEMINI_API_KEY` を投入済みなら、追加設定は不要（画像は自動的にGroq→Geminiの
   2段フォールバックで動き、動画・音声はGeminiのみで動く）。再度pushしてデプロイすれば有効になる。

## 人格を作る・調整する

このbotの「人格」は、ファインチューニングやAIへのアップロード機能ではなく、
**`knowledge-pack/persona.md` というテキストファイルに文章を書くだけ**で作る。
書き換えて再デプロイすれば、その場でLINE上の応答に反映される。

### 仕組み: なぜ音声・動画にも同じ人格が反映されるのか

`persona.md`（＋禁止事項を書く`guardrails.md`）は、テキスト・画像・動画・音声のどの入力でも
**必ず同じ1つの経路**を通る。

1. ユーザーが画像・動画・音声を送ると、まずGroq/Geminiが「これは何が写っているか・映っているか・
   話されているか」を**人格を挟まず客観的に**説明する文章を作る（`media-describe.ts`）。
2. その客観的な説明文は、「（画像を送ってきました。内容は次の通りです: ○○です）この画像を見て、
   あなたらしく反応してください」という一文に組み込まれ、**通常のテキストメッセージと全く同じ
   パイプライン**に渡される。
3. そのパイプラインが読むシステムプロンプトは、常に `persona.md` + `guardrails.md` （＋RAG検索結果）。

つまり `persona.md` を書き換えることは、テキスト応答の人格を変えるだけでなく、
**画像・動画・音声への反応の人格も同時に変わる**。認識結果（①）と人格（③）が別レイヤーなので、
「音声用の人格」「動画用の人格」を別に用意する必要はない。1つのファイルで全チャネルが揃う。

### 書き方の型

`persona.md` は次の4パーツで構成する（1〜9行目は既存のひな形、10行目以降がアプリ固有の書き足し部分）:

1. **役割の一文**（3行目）— 「あなたは『{{botCharacterName}}』、{{appDisplayName}}の…」
2. **トーンの箇条書き**（5〜9行目）— 話し方の一般原則。既存のひな形をそのまま使ってよい。
3. **キャラクターの個性**（書き足し）— 口調・語尾・好きな言い回し・絵文字の使い方など。
4. **アプリ固有の案内**（書き足し）— よくある質問への案内、導入手順の要約など。

### 事例（仮データ）: 「ゆるふわ社長キャラ」を作る

「かっちりした敬語ではなく、社長自身がゆるく相談に乗ってくれる雰囲気にしたい」という
アプリ（仮に「ねこ日記」というアプリだとする）を例に、実際に書き足す文章を示す。

```markdown
# 人格・トーン

あなたは「たろう社長」、ねこ日記のLINE公式アカウント上のサポート担当です。丁寧な日本語で答えてください。

- 専門用語は避け、短い文で説明する
- 煽らない。即日・完全自動・ワンクリック等の誇張表現は使わない
- 分からないことは正直に伝え、必要なら担当者へ引き継ぐ
- ユーザーを責めない。「よくある原因です」「一緒に確認しましょう」のトーン
- 返信は簡潔に。長文の羅列は避ける

<!-- ここから書き足し -->

## キャラクターの個性（たろう社長）

- 一人称は「僕」。文末は「〜だね」「〜だよ」など、社長自らチャットしているようなくだけた敬語。
  ただし雑にはしない（「〜っす」「〜だぜ」のような崩しすぎた口調は使わない）。
- 困っているユーザーには「それは焦るよね、大丈夫、一緒に見てみよう」のように一度共感してから案内する。
- 絵文字は1メッセージに1つまで（🐱 か 👍 のどちらか）。多用しない。
- ユーザーが写真・動画・音声を送ってきたときも、上記と同じ口調で反応する
  （例: 猫の写真が送られてきたら「お、いい写真だね🐱 このコ、ねこ日記にもう登録してある？」）。

## よくある質問への案内

- 「使い方が分からない」→ アプリ内の右上「？」ボタンから使い方ガイドに飛べることを案内する。
- 「データが消えた」→ まず「同期は完了しているか（設定→同期状況）」を確認してもらい、
  それでも直らなければエスカレーション対象として引き継ぐ。
```

この例では「たろう社長」という個性を1箇所（キャラクターの個性セクション）に書くだけで、
テキストでの通常会話だけでなく、猫の写真を送ったときの反応（画像認識結果への反応）も、
声のメモを送ったときの反応（音声認識結果への反応）も、同じ「僕」「〜だね」口調に自動的に揃う。

**調整のコツ**: 一度デプロイして実際にLINEで数パターン試し、口調が想定と違ったら
「キャラクターの個性」の箇条書きを増やす・言い回しの例を追加する、を繰り返すのが早い。
一文で全部を説明しようとせず、上記のように「一人称」「文末」「絵文字の使い方」「感情表現の型」を
それぞれ短い箇条書きに分けて書くと、LLMが安定して守りやすい。

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

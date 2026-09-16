# 無料〜安価 LLM コーディング調査レポート（最終版）

- **調査日**: 2026-09-16（JST / Asia/Tokyo）
- **方法論**: 公式 pricing / docs / ToS・FAQ および本調査の要約メモのみを根拠とする。数値はメモ内に出典 URL があるものに限り記載。不明は **未確認**。推測や未出典のクォータ・ベンチは書かない。
- **参照メモ**: `/workspace/subscription-llm-coding-2026-09.md` および本依頼に添付された候補要約。
- **目標前提**: 思考は本物 Claude、実装・リファクタ・テスト等の「手」は無料〜安価な脳に振る。

---

## 冒頭まとめ：A 評価の候補と、組み込みの推奨順

1. **Gemini CLI（Google ログイン）** — 日次 1000 req 級の無料エージェント主軸。  
2. **Google AI Studio Gemini Flash API** — 無料 API の主軸（Flash 系）。  
3. **Groq Free** — カード不要の高速 OpenAI 互換スペア脳。  
4. **Kilo（kilo-auto/free）または OpenCode Zen 無料モデル** — 非機密コード限定でエージェント拡張。  
5. **GitHub Copilot Free + Jules Free + Amazon Q Developer Free** — 軽いバックアップ層。  
6. **二次枠**: OpenRouter `:free` / Z.AI Flash / Cloudflare Workers AI / Vercel AI Gateway / SambaNova / Mistral Free。  
7. **無料目標では見送り**: Qwen Code OAuth（終了）、GitHub Models（退役）、Together、Cerebras の長期無料期待、Kimi / DeepSeek / xAI の「無料枠で十分」期待。

---

## 大比較表（全候補）

| 候補 | 何が無料か（要約） | 最上位モデル（無料枠） | 接続方法 | 評価 |
|------|-------------------|------------------------|----------|------|
| Gemini CLI | Google ログイン 1000 req/日・60/min；API key unpaid Flash 250/日 | CLI 枠の現行 Flash/Pro 系（詳細名は製品依存） | 独自 CLI（`@google/gemini-cli`）；`GEMINI_API_KEY` | **A** |
| Qwen Code OAuth free | 無料 OAuth は **2026-04-15 終了** | — | 独自（終了） | **C** |
| Codex CLI Free | Free/Go で Limited Codex；正確なメッセージ数は未確認 | フラッグシップ GPT-5.6 系は Limited | 独自 CLI（curl インストール）；ANTHROPIC 置換不可 | **B** |
| Kimi Code CLI | 無料目標では実質なし（有料会員のみ） | 有料時の Kimi コーディング枠 | Anthropic 互換 `https://api.kimi.com/coding/` | **C**（無料目標） |
| GitHub Copilot Free | $0・カード不要；2000 completions + 50 chat/月；CLI 含む | Free 向け提供モデル（Haiku 4.5 / GPT-5 mini 等） | Copilot CLI；OpenCode に GitHub Copilot プロバイダ | **B**（プラン単体は A 寄り） |
| Cline / Roo / Kilo | Kilo kilo-auto/free；Cline+OpenRouter free；Roo は未確認 | プロバイダ依存 | 各 IDE/拡張；OpenRouter 等 | **Kilo A** / **Cline B** / **Roo C寄り** |
| Trae Free | $3 Basic Usage/月相当・5000 autocomplete；SOLO は Free 外 | Free 向けモデル（詳細名は未確認） | Trae IDE | **B〜C** |
| OpenCode Zen free | Zen ページ掲載の無料モデル；課金詳細登録が必要なことあり | Zen 無料カタログ掲載モデル | OpenCode | **A/B** |
| Google AI Studio Gemini | Free Flash 例: gemini-3.8-flash 無料；Pro は多くが有料 | Flash 系（無料） | Gemini API / AI Studio | **A** |
| Groq | Free・カード不要；例: openai/gpt-oss-120b 等の Limits | Free プラン掲載モデル | OpenAI 互換 `api.groq.com/openai/v1`；`GROQ_API_KEY` | **A** |
| Cerebras | $5 trial・30日・カード必須 | トライアル枠内モデル | Cerebras Inference API | **C** |
| SambaNova | Free 一部モデル RPM20 / RPD20 / TPD200k | Free 対象モデル | SambaNova API | **B** |
| Mistral Free mode | カード不要の Free mode | Free mode モデル | Mistral API | **B** |
| OpenRouter `:free` | RPM20；RPD は生涯クレジット条件で 50 または 1000 | `:free` バリアント | OpenRouter（OpenAI 互換等） | **B** |
| GitHub Models | **2026-07-30 退役** | — | — | **C** |
| Cloudflare Workers AI | 10000 Neurons/日（UTC 深夜リセット）；一部 frontier は Paid | Neurons 対象モデル | Workers AI | **B** |
| Alibaba Model Studio | 新規（SG/intl）モデルあたり約 1M tokens・90日 | 新規無料クォータ対象モデル | Model Studio API | **B** |
| Together | 無料なし・最低 $5 | — | Together API | **C** |
| HF Inference | 月 $0.10 相当の無料クレジット | クレジット内モデル | HF Inference | **C** |
| NVIDIA NIM Catalog | 無料枠の一次出典が不十分 | 未確認 | NIM | **C** |
| DeepSeek | 無料枠は未確認（なし寄り）；有料時は強い | 有料時 DeepSeek | Anthropic 互換 `https://api.deepseek.com/anthropic` | **C**（無料） |
| Moonshot Kimi API | 無料枠なし寄り；有料時 Anthropic Messages 互換 | 有料時 Kimi | Anthropic Messages 互換（有料） | **C**（無料） |
| Zhipu / Z.AI | GLM Flash 系が Free | GLM Flash | Z.AI API | **B** |
| xAI API | 現行 docs に無料クレジットなし | — | `https://api.x.ai/v1`（OpenAI 互換可） | **C** |
| Cohere Trial | 1000 calls/月・非商用・評価用 | Trial モデル | Cohere API | **B**（評価専用） |
| Amazon Bedrock | 専用無料トークン枠なし | — | Bedrock | **C** |
| Azure AI Foundry | 専用無料推論枠なし | — | Azure AI | **C** |
| Vercel AI Gateway | 月次無料クレジット額は未確認；free-tier モデルのみ | free-tier モデル | Gateway；Anthropic SDK 置換可 | **B** |
| SuperGrok / Grok Build | Free $0 で Build 比較表チェック；有料 $30 / $100 | Grok 4.6（有料寄り；Free 実効枠数値は未確認） | `grok` CLI；`XAI_API_KEY` | **B** |
| ChatGPT Plus/Pro Codex | Free Limited；Plus $20 / Pro from $100 | GPT-5.6 Sol 等（プラン依存） | Codex CLI | **Plus B** / **Pro B−〜C** |
| Google AI Plus/Pro/Ultra JP | Free CLI A−；Plus ¥725 / Pro ¥2900 / Ultra ¥14500・¥32000 | Jules/CLI はプランで枠拡大 | Gemini CLI / Jules | **Free A−** / **Pro B** / **Ultra C** |
| Amazon Q Developer Free | 50 agentic requests/月 | Free 向けエージェント | Q Developer IDE/CLI | **A−** |

---

## 詳細：Coding agent CLIs

### 1. Gemini CLI — 評価 **A**

1. **何が無料か**  
   Google ログイン（Code Assist Individual）で **1000 model requests / user / day**、**60/min**。API key の unpaid は Flash **250/day**。日本は利用可（available-regions）。出典: https://google-gemini.github.io/gemini-cli/docs/quota-and-pricing.html 、https://ai.google.dev/gemini-api/docs/available-regions?hl=ja 。個人利用では学習利用の可能性あり（tos-privacy）。

2. **使える最上位モデルと公開ベンチ**  
   無料枠で到達可能な最上位の公式ベンチ数値は本メモに固定なし → **未確認**（モデル名は製品時点の Flash/Pro 系）。数値の捏造はしない。

3. **接続方法**  
   独自 CLI。`npm` パッケージ `@google/gemini-cli`。`GEMINI_API_KEY`。**ANTHROPIC_BASE_URL 置換ではない**。OpenCode 連携の詳細は本メモ範囲外 → 未確認。

4. **組み込み案**  
   `npm install -g @google/gemini-cli` のあと `export GEMINI_API_KEY=...`（値は書かない）→ `gemini`。Google ログインでも可。

5. **罠**  
   Individual データ学習の可能性。API key 枠と Google ログイン枠は別。AI Studio のサブスク特典と API 枠の混同に注意。

6. **総合評価**  
   **A** — 追加課金なしで日次コーディング枠が大きく、無料エージェントの第一候補。

---

### 2. Qwen Code OAuth free — 評価 **C**

1. **何が無料か**  
   OAuth 無料経路は **2026-04-15 に終了**。出典: https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/

2. **使える最上位モデルと公開ベンチ**  
   現行無料枠なし → **未確認 / 該当なし**。

3. **接続方法**  
   終了した OAuth 経路。現行の有料/代替認証は本無料調査の対象外。

4. **組み込み案**  
   無料目標では組み込まない。

5. **罠**  
   過去の「無料 OAuth」記事を信じると現行では動かない。退役先例として監視価値あり。

6. **総合評価**  
   **C** — 無料目標では採用不可（終了済み）。

---

### 3. Codex CLI Free — 評価 **B**

1. **何が無料か**  
   Free/Go で Limited Codex。フラッグシップ GPT-5.6 も Limited。**正確な Free メッセージ数は未確認**。出典: https://developers.openai.com/codex/pricing 、https://chatgpt.com/codex/pricing/

2. **使える最上位モデルと公開ベンチ**  
   有料寄りだが製品側発表例（GPT-5.6 Sol）: DeepSWE **72.7%**、SWE-Bench Pro **64.6%** — https://openai.com/index/gpt-5-6/ 。Free 枠でどのモデルがどの頻度か、正確カウントは未確認。

3. **接続方法**  
   独自 CLI（curl インストール）。**ANTHROPIC_BASE_URL スワップではない**。

4. **組み込み案**  
   `curl -fsSL https://chatgpt.com/codex/install.sh | sh` → `codex`（ChatGPT ログイン）。

5. **罠**  
   Free は Limited。個人プランの学習設定は Codex にも影響し得る。週次上限の数値は未公開の記載あり。

6. **総合評価**  
   **B** — 無料で触れるが主力枠としては限定的。Plus 併用時の価値は別項。

---

### 4. Kimi Code CLI — 評価 **C**（無料目標）

1. **何が無料か**  
   有料会員のみ（例: Andante ¥49/月相当の CNY 等）。出典: https://www.kimi.com/code/docs/en/kimi-code/membership.html 。無料目標では実質不可。

2. **使える最上位モデルと公開ベンチ**  
   無料枠のベンチ → **未確認**。

3. **接続方法**  
   Anthropic 互換 `https://api.kimi.com/coding/`。Claude Code 置換は公式案内あり。

4. **組み込み案**  
   有料時のみ: `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` 系で公式互換エンドポイントを指す（値は書かない）。無料目標ではスキップ。

5. **罠**  
   「Claude Code 互換」と「無料」は別問題。会員価格は CNY 表記中心。

6. **総合評価**  
   **C**（無料目標）— 有料なら Claude Code 置換候補だが、無料ファームには不適。

---

### 5. GitHub Copilot Free — 評価 **B**（プラン単体は A 寄り）

1. **何が無料か**  
   **$0・カード不要**。**2000 completions / 月** + **50 chat/月**（Edits 含む）。Copilot CLI 含む。出典: https://github.com/features/copilot/plans 。サブスク調査メモでは Free プラン自体を **A** と評価。

2. **使える最上位モデルと公開ベンチ**  
   Free 向け例として Haiku 4.5 / GPT-5 mini 等（plans ページ）。公開コーディングベンチ数値の一次固定は本メモになし → **未確認**。

3. **接続方法**  
   Copilot CLI。OpenCode に GitHub Copilot プロバイダあり。ANTHROPIC_BASE_URL 置換ではない。

4. **組み込み案**  
   GitHub アカウントで Copilot Free 有効化 → Copilot CLI / IDE。OpenCode では GitHub Copilot プロバイダを選択。

5. **罠**  
   個人データは学習の可能性（オプトアウト可）。非英語品質が落ちる可能性。月 50 chat はエージェント連打には小さい。

6. **総合評価**  
   **B**（エージェント・ファーム用途）／プラン単体の「無料の手」としては **A** 寄り — 軽バックアップとして推奨順に含める。

---

### 6. Cline / Roo / Kilo — 評価 **Kilo A** / **Cline+OpenRouter free B** / **Roo C寄り**

1. **何が無料か**  
   Kilo の kilo-auto/free。Cline は OpenRouter free と組み合わせ。Roo のメンテ状況は **未確認**。Kilo free はログ/学習の可能性 — https://kilo.ai/docs/getting-started/using-kilo-for-free

2. **使える最上位モデルと公開ベンチ**  
   バックエンド依存。固定ベンチ → **未確認**。

3. **接続方法**  
   各 VS Code 系拡張。OpenRouter / 各 API。OpenCode とは別系統。

4. **組み込み案**  
   Kilo: free/kilo-auto 設定。Cline: OpenRouter の `:free` モデル + 対応 env（例: `OPENROUTER_API_KEY` 名のみ）。Roo: 現状は様子見。

5. **罠**  
   Kilo free のログ/学習。OpenRouter RPD 制限。Roo の継続性未確認。

6. **総合評価**  
   **Kilo A**（非機密のみ）、**Cline B**、**Roo は C 寄り**。

---

### 7. Trae Free — 評価 **B〜C**

1. **何が無料か**  
   **$3 Basic Usage/月**相当、**5000 autocomplete**。SOLO は Free に含まれない。日本は掲載あり。出典: https://docs.trae.ai/ide/new-plans-and-billing

2. **使える最上位モデルと公開ベンチ**  
   Free の最上位モデル名・ベンチ → **未確認**。

3. **接続方法**  
   Trae IDE。OpenAI/Anthropic 互換の詳細は本メモになし → 未確認。

4. **組み込み案**  
   Trae IDE をインストールし Free プランで利用。エージェント SOLO は期待しない。

5. **罠**  
   SOLO 非対応。Basic Usage $3 の消費感は用途次第。

6. **総合評価**  
   **B〜C** — 補完中心なら可、本格エージェント無料枠としては弱い。

---

### 8. OpenCode Zen free promos — 評価 **A/B**

1. **何が無料か**  
   https://opencode.ai/docs/zen/ 掲載の無料モデル。課金詳細（billing details）登録が必要な場合あり。無料モデルは学習利用の可能性。

2. **使える最上位モデルと公開ベンチ**  
   カタログ時点の無料モデル。固定ベンチ数値 → **未確認**（ページ掲載に従う）。

3. **接続方法**  
   OpenCode。Zen プロバイダ。

4. **組み込み案**  
   OpenCode で Zen free モデルを選択。シークレットコードは避ける。

5. **罠**  
   プロモ変更が早い。billing 登録。学習ポリシー。

6. **総合評価**  
   **A/B** — 非機密の実験・ボイラープレート向け。推奨順の第4候補層。

---

## 詳細：API free tiers

### 9. Google AI Studio Gemini — 評価 **A**

1. **何が無料か**  
   Free Flash 例: **gemini-3.8-flash** が free of charge。Pro は多くが無料対象外。日本可。Free は製品改善に利用され得る。出典: https://ai.google.dev/gemini-api/docs/pricing

2. **使える最上位モデルと公開ベンチ**  
   無料の主軸は Flash 系。Pro 無料可否はモデルごと。公開ベンチ数値の固定一次 → 本メモでは **未確認**（価格ページの無料表記を優先）。

3. **接続方法**  
   Gemini API / AI Studio。OpenAI 互換の有無は製品ドキュメント依存 → 詳細未確認。`GEMINI_API_KEY`。

4. **組み込み案**  
   `export GEMINI_API_KEY=...` → 公式 SDK または互換クライアントで Flash を指定。

5. **罠**  
   Free データの改善利用。Pro を無料と思い込むミス。CLI 枠と API 枠の混同。

6. **総合評価**  
   **A** — 無料 API の第一候補。

---

### 10. Groq — 評価 **A**

1. **何が無料か**  
   Free plan・**カード不要**。例: `openai/gpt-oss-120b` で RPM **30** / RPD **1K** / TPM **8K** / TPD **200K**（**組織 Limits ページが権威**）。出典: https://console.groq.com/docs/rate-limits

2. **使える最上位モデルと公開ベンチ**  
   Free 掲載モデル。固定コーディングベンチ数値 → **未確認**。

3. **接続方法**  
   OpenAI 互換 `https://api.groq.com/openai/v1`。`GROQ_API_KEY`。ANTHROPIC_BASE_URL ではない。

4. **組み込み案**  
   `export GROQ_API_KEY=...` → OpenAI SDK の `base_url=https://api.groq.com/openai/v1`。

5. **罠**  
   モデルごとの Limits が変わる。TPM/TPD がタイトなモデルあり。Limits ページを正とする。

6. **総合評価**  
   **A** — 高速スペア脳として推奨順第3。

---

### 11. Cerebras — 評価 **C**

1. **何が無料か**  
   **$5 trial・30日・カード必須**。長期無料ではない。出典: https://inference-docs.cerebras.ai/support/rate-limits

2. **使える最上位モデルと公開ベンチ**  
   トライアル内 → ベンチ固定値 **未確認**。

3. **接続方法**  
   Cerebras Inference API（詳細互換は docs）。

4. **組み込み案**  
   トライアル検証用途のみ。長期無料ファームには入れない。

5. **罠**  
   カード必須・期限付きを「無料枠」と誤認しやすい。

6. **総合評価**  
   **C** — 長期無料目標では見送り。

---

### 12. SambaNova — 評価 **B**

1. **何が無料か**  
   一部モデルで Free **RPM20 / RPD20 / TPD200k**。出典: https://docs.sambanova.ai/docs/en/models/rate-limits

2. **使える最上位モデルと公開ベンチ**  
   Free 対象モデル名の網羅とベンチ → **未確認**（rate-limits ページの対象に従う）。

3. **接続方法**  
   SambaNova API（OpenAI 互換の詳細は docs 依存）。

4. **組み込み案**  
   API キー環境変数（製品ドキュメントの変数名）を設定し Free 対象モデルのみ使用。

5. **罠**  
   RPD20 は日次が小さい。モデルごとに Free 可否が違う。

6. **総合評価**  
   **B** — 二次枠として監視・併用可。

---

### 13. Mistral Free mode — 評価 **B**

1. **何が無料か**  
   Free mode・**カード不要**。**正確な RPM は未確認**。

2. **使える最上位モデルと公開ベンチ**  
   Free mode モデル。ベンチ数値 → **未確認**。

3. **接続方法**  
   Mistral API。

4. **組み込み案**  
   `MISTRAL_API_KEY`（名のみ）で Free mode モデルを指定。

5. **罠**  
   レートの一次数値がメモ上未確認のため過信しない。

6. **総合評価**  
   **B** — 二次枠。

---

### 14. OpenRouter `:free` — 評価 **B**

1. **何が無料か**  
   **RPM20**。RPD は生涯で **$10 未満のクレジット購入なら 50**、そうでなければ **1000**。出典: https://openrouter.ai/docs/guides/routing/model-variants/free および limits docs。

2. **使える最上位モデルと公開ベンチ**  
   `:free` カタログ掲載モデル。個別ベンチ → **未確認**。

3. **接続方法**  
   OpenRouter（OpenAI 互換等）。Cline 等と相性良。

4. **組み込み案**  
   `export OPENROUTER_API_KEY=...` → モデル ID に `:free` を指定。

5. **罠**  
   RPD 50 条件の見落とし。無料モデルの品質・可用性変動。学習ポリシーはモデル提供者依存。

6. **総合評価**  
   **B** — 二次枠の中核。日課監視対象。

---

### 15. GitHub Models — 評価 **C**

1. **何が無料か**  
   **2026-07-30 退役**。現行無料枠なし。

2. **使える最上位モデルと公開ベンチ**  
   該当なし。

3. **接続方法**  
   退役。

4. **組み込み案**  
   組み込まない。

5. **罠**  
   古いチュートリアルが残っている。サンセット先例。

6. **総合評価**  
   **C** — 見送り。

---

### 16. Cloudflare Workers AI — 評価 **B**

1. **何が無料か**  
   **10000 Neurons/day**（UTC 深夜リセット）。一部 frontier は Paid 必須。出典: https://developers.cloudflare.com/workers-ai/platform/pricing/

2. **使える最上位モデルと公開ベンチ**  
   Neurons 対象の無料到達モデル。frontier の無料可否はモデルごと。ベンチ → **未確認**。

3. **接続方法**  
   Workers AI（Workers / API）。

4. **組み込み案**  
   Cloudflare アカウントの Workers AI バインディングまたは API トークン（値は書かない）。

5. **罠**  
   Neuron 消費の見積もりミス。frontier の Paid ゲート。

6. **総合評価**  
   **B** — 二次枠。レート docs を日課監視。

---

### 17. Alibaba Model Studio — 評価 **B**

1. **何が無料か**  
   新規ユーザー（SG/intl）でモデルあたり約 **1M tokens・90日**。出典: https://www.alibabacloud.com/help/en/model-studio/new-free-quota

2. **使える最上位モデルと公開ベンチ**  
   新規無料クォータ対象。ベンチ → **未確認**。

3. **接続方法**  
   Model Studio API。

4. **組み込み案**  
   新規アカウントの無料クォータ期間内に評価。恒久無料とは扱わない。

5. **罠**  
   90日・新規限定。地域（SG/intl）条件。

6. **総合評価**  
   **B** — 期限付き二次枠。

---

### 18. Together — 評価 **C**

1. **何が無料か**  
   無料なし。最低 **$5**。

2. **使える最上位モデルと公開ベンチ**  
   無料該当なし。

3. **接続方法**  
   Together API（有料）。

4. **組み込み案**  
   無料目標ではスキップ。

5. **罠**  
   「クレジットがある」情報の古い記事。

6. **総合評価**  
   **C** — 見送り。

---

### 19. HF Inference — 評価 **C**

1. **何が無料か**  
   月 **$0.10** 相当の無料クレジット。

2. **使える最上位モデルと公開ベンチ**  
   クレジット内。ベンチ → **未確認**。

3. **接続方法**  
   Hugging Face Inference。

4. **組み込み案**  
   極小クレジットの検証用途のみ。

5. **罠**  
   金額が小さすぎてエージェント運用に不足。

6. **総合評価**  
   **C**。

---

### 20. NVIDIA NIM Catalog — 評価 **C**

1. **何が無料か**  
   無料クォータの一次出典が不十分 → **未確認**。

2. **使える最上位モデルと公開ベンチ**  
   **未確認**。

3. **接続方法**  
   NIM Catalog（詳細は公式）。

4. **組み込み案**  
   一次出典が揃うまで採用しない。

5. **罠**  
   ブログ伝聞の「無料」に依存しやすい。

6. **総合評価**  
   **C**。

---

### 21. DeepSeek — 評価 **C**（無料枠）

1. **何が無料か**  
   無料枠は確認できず（なし寄り）。

2. **使える最上位モデルと公開ベンチ**  
   有料時のコーディング力は評判上強いが、本メモの固定ベンチ数値 → **未確認**。

3. **接続方法**  
   Anthropic 互換 `https://api.deepseek.com/anthropic` — 有料時の Claude Code 置換に強い。

4. **組み込み案**  
   有料時: `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` で公式互換を指す。無料目標ではスキップ。

5. **罠**  
   「互換＝無料」ではない。

6. **総合評価**  
   **C**（無料）— 有料置換候補としては別評価。

---

### 22. Moonshot Kimi API — 評価 **C**（無料）

1. **何が無料か**  
   無料枠なし寄り。

2. **使える最上位モデルと公開ベンチ**  
   **未確認**。

3. **接続方法**  
   有料時 Anthropic Messages 互換。

4. **組み込み案**  
   無料目標ではスキップ。有料時のみ Messages 互換で接続。

5. **罠**  
   Kimi Code CLI 会員と API 課金の混同。

6. **総合評価**  
   **C**（無料）。

---

### 23. Zhipu / Z.AI — 評価 **B**

1. **何が無料か**  
   GLM Flash 系が Free。出典: https://docs.z.ai/guides/overview/pricing

2. **使える最上位モデルと公開ベンチ**  
   Free の GLM Flash。公開ベンチ数値 → **未確認**。

3. **接続方法**  
   Z.AI API。

4. **組み込み案**  
   Z.AI の API キー環境変数（ドキュメント名）で Flash を指定。

5. **罠**  
   Free 対象が Flash に限定されやすい。地域・アカウント条件は docs を要確認。

6. **総合評価**  
   **B** — 二次枠。

---

### 24. xAI API — 評価 **C**

1. **何が無料か**  
   現行 docs pricing に無料クレジットなし。

2. **使える最上位モデルと公開ベンチ**  
   API 有料。Grok 4.6 の発表例はサブスク項参照。

3. **接続方法**  
   `https://api.x.ai/v1`（OpenAI 互換クライアント可）。`XAI_API_KEY`。

4. **組み込み案**  
   無料目標では API 課金を前提にしない。Build/Free サブスク導線は別項。

5. **罠**  
   サブスク Build 枠と API 従量は別体系。

6. **総合評価**  
   **C**（API 無料期待）。

---

### 25. Cohere Trial — 評価 **B**（評価専用）

1. **何が無料か**  
   **1000 calls/月**・**非商用**。出典: https://docs.cohere.com/docs/rate-limits

2. **使える最上位モデルと公開ベンチ**  
   Trial モデル。コーディングベンチ → **未確認**。

3. **接続方法**  
   Cohere API。

4. **組み込み案**  
   評価・学習目的のみ。`COHERE_API_KEY`（名のみ）。

5. **罠**  
   非商用制限。本番エージェント不可。

6. **総合評価**  
   **B**（eval-only）— 商用コーディングファームには不適。

---

### 26. Amazon Bedrock — 評価 **C**

1. **何が無料か**  
   専用無料トークン枠なし。

2. **使える最上位モデルと公開ベンチ**  
   該当なし（無料推論専用）。

3. **接続方法**  
   Bedrock（AWS 認証）。

4. **組み込み案**  
   無料目標ではスキップ。

5. **罠**  
   Free Tier の他サービスと混同しやすい。

6. **総合評価**  
   **C**。

---

### 27. Azure AI Foundry — 評価 **C**

1. **何が無料か**  
   専用無料推論枠なし。

2. **使える最上位モデルと公開ベンチ**  
   該当なし。

3. **接続方法**  
   Azure AI。

4. **組み込み案**  
   無料目標ではスキップ。

5. **罠**  
   クレジットキャンペーンの期限切れ情報。

6. **総合評価**  
   **C**。

---

### 28. Vercel AI Gateway — 評価 **B**

1. **何が無料か**  
   月次無料クレジットの**金額は未確認**。free-tier モデルのみ。出典: https://vercel.com/docs/ai-gateway/pricing

2. **使える最上位モデルと公開ベンチ**  
   free-tier モデル。ベンチ → **未確認**。

3. **接続方法**  
   AI Gateway。**Anthropic SDK スワップ可能**（公式記載の範囲）。

4. **組み込み案**  
   Vercel の Gateway 用環境変数（ドキュメント名）を設定し、free-tier モデルのみ。Anthropic SDK の base URL 差し替えは公式手順に従う。

5. **罠**  
   クレジット額未確認のため枠の大きさは過信しない。free-tier 以外を叩くと課金。

6. **総合評価**  
   **B** — 二次枠・Claude SDK 慣れユーザー向け。

---

## 詳細：Subscriptions / 同梱コーディング

### 29. SuperGrok / Grok Build — 評価 **B**

1. **何が無料か**  
   Free **$0**。比較表上 **Grok Build に Free もチェック**。SuperGrok **$30**/月、Plus **$100**/月。Build のプラン別数値クォータは **未確認**。出典: https://x.ai/pricing 、サブスクメモ。

2. **使える最上位モデルと公開ベンチ**  
   **Grok 4.6**（発表例）: AA Index **61**、DeepSWE **65.9%**、CursorBench **69.9%** — https://x.ai/news/grok-4-6

3. **接続方法**  
   `grok` CLI。API `https://api.x.ai/v1`。`XAI_API_KEY`。公式 Anthropic 互換は **未確認**。

4. **組み込み案**  
   `curl -fsSL https://x.ai/cli/install.sh | bash` → `grok`。または `export XAI_API_KEY=...` → `grok -p "..."`。

5. **罠**  
   Free Build の実効枠が非公開。Consumer 学習オプトアウト要確認。JP 円価格 **未確認**。

6. **総合評価**  
   **B** — Free 導線ありだが枠不明。有料 $30 は「手」候補。

---

### 30. ChatGPT Plus / Pro — Codex — 評価 **Plus B** / **Pro B−〜C**

1. **何が無料か**  
   Free/Go Limited。Plus **$20**/月、Pro **from $100**/月。ローカル messages 目安は https://developers.openai.com/codex/pricing の表（固定上限ではない）。JP 円表示額は抽出できず **未確認**。

2. **使える最上位モデルと公開ベンチ**  
   GPT-5.6 Sol 等。発表例: DeepSWE **72.7%**、SWE-Bench Pro **64.6%** — https://openai.com/index/gpt-5-6/

3. **接続方法**  
   Codex CLI（curl インストール）。ANTHROPIC_BASE_URL 公式記載は **未確認**。

4. **組み込み案**  
   `curl -fsSL https://chatgpt.com/codex/install.sh | sh` → `codex`。`/status` で残枠確認。

5. **罠**  
   学習設定が Codex にも影響。週次上限の数値未公開。Pro 固定費は Claude 併用だと重い。

6. **総合評価**  
   **Plus: B** / **Pro: B−〜C**。

---

### 31. Google AI Plus / Pro / Ultra（JP）— 評価 **Free CLI A−** / **Pro B** / **Ultra C**

1. **何が無料か**  
   無料 Gemini CLI Individual **1000**/日。Jules Free **15**/日・同時3。有料 JP: Plus **¥725**、Pro **¥2,900**、Ultra **¥14,500（5x）** / **¥32,000（20x）** — https://gemini.google/jp/subscriptions/?hl=ja 。Jules Pro **100** / Ultra **300** — https://jules.google/docs/usage-limits/ 。CLI Pro **1500** / Ultra **2000**。**AI Plus は CLI 有料枠バンプ対象外**（gemini-cli quota docs）。

2. **使える最上位モデルと公開ベンチ**  
   Jules Free は Gemini 2.5 Pro；Pro/Ultra は Gemini 3 Pro 起点。Google 自社の最新コーディングベンチ一次ページは **未確認**。競合発表表の引用値はサブスクメモ参照（自社一次ではないため主根拠にしない）。

3. **接続方法**  
   Gemini CLI、Jules（GitHub）、Antigravity。API は別課金体系の可能性。

4. **組み込み案**  
   `npm install -g @google/gemini-cli` → `gemini`（Google ログイン）。Jules: https://jules.google/ 。有料は Google One / AI プラン。

5. **罠**  
   Plus（¥725）では CLI 有料枠が増えない。Jules は英語公式・18+・容量非保証。CLI と API 枠の混同。

6. **総合評価**  
   **無料 CLI+Jules: A−**、**Pro: B**、**Ultra: C**（大量並列なら例外的に再考）。

---

### 32. Amazon Q Developer Free — 評価 **A−**

1. **何が無料か**  
   **50 agentic requests / 月**。出典: https://aws.amazon.com/q/developer/pricing/

2. **使える最上位モデルと公開ベンチ**  
   Free エージェントの固定ベンチ → **未確認**。

3. **接続方法**  
   Amazon Q Developer（IDE / CLI）。Builder ID で Free。

4. **組み込み案**  
   AWS Builder ID で Free 有効化 → IDE/CLI からエージェント。月 50 を超えない運用。

5. **罠**  
   月 50 は小さい。Pro $19 との差を見誤らない。

6. **総合評価**  
   **A−** — 軽いバックアップとして推奨順に含める。

---

## 組み込みの実務メモ（env 名のみ）

| 用途 | 主な env / コマンド（値は書かない） |
|------|-------------------------------------|
| Gemini CLI / API | `GEMINI_API_KEY`；`npm i -g @google/gemini-cli` → `gemini` |
| Groq | `GROQ_API_KEY`；base `https://api.groq.com/openai/v1` |
| OpenRouter | `OPENROUTER_API_KEY`；モデルに `:free` |
| xAI / Grok Build | `XAI_API_KEY`；`curl -fsSL https://x.ai/cli/install.sh \| bash` → `grok` |
| Codex | インストールスクリプト → `codex`（ChatGPT ログイン） |
| Kimi / DeepSeek（有料時） | `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY`（公式互換 URL） |
| Vercel AI Gateway | Gateway 用公式 env；Anthropic SDK の base 差し替え可 |

---

## 日課にする価値がある監視対象

1. **Gemini CLI / Google AI Studio** のクォータページとプライバシー（学習）記載の更新  
2. **OpenRouter `:free`** カタログと RPD（50 / 1000）ルールの変更  
3. **OpenCode Zen** の無料プロモ一覧の出入り  
4. **Groq / SambaNova / Cloudflare** の rate-limit・Neurons ドキュメント  
5. **新規無料コーディングエージェント**および退役（GitHub Models 型サンセット、Qwen OAuth 終了の先例）

---

## 出典インデックス（本レポートで参照した主要 URL）

- https://google-gemini.github.io/gemini-cli/docs/quota-and-pricing.html  
- https://ai.google.dev/gemini-api/docs/available-regions?hl=ja  
- https://ai.google.dev/gemini-api/docs/pricing  
- https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/  
- https://developers.openai.com/codex/pricing  
- https://chatgpt.com/codex/pricing/  
- https://openai.com/index/gpt-5-6/  
- https://www.kimi.com/code/docs/en/kimi-code/membership.html  
- https://github.com/features/copilot/plans  
- https://kilo.ai/docs/getting-started/using-kilo-for-free  
- https://docs.trae.ai/ide/new-plans-and-billing  
- https://opencode.ai/docs/zen/  
- https://console.groq.com/docs/rate-limits  
- https://inference-docs.cerebras.ai/support/rate-limits  
- https://docs.sambanova.ai/docs/en/models/rate-limits  
- https://openrouter.ai/docs/guides/routing/model-variants/free  
- https://developers.cloudflare.com/workers-ai/platform/pricing/  
- https://www.alibabacloud.com/help/en/model-studio/new-free-quota  
- https://docs.z.ai/guides/overview/pricing  
- https://docs.cohere.com/docs/rate-limits  
- https://vercel.com/docs/ai-gateway/pricing  
- https://x.ai/pricing · https://x.ai/news/grok-4-6 · https://x.ai/cli  
- https://gemini.google/jp/subscriptions/?hl=ja  
- https://jules.google/docs/usage-limits/  
- https://aws.amazon.com/q/developer/pricing/  
- 追加詳細: `/workspace/subscription-llm-coding-2026-09.md`

---

*本ファイルは 2026-09-16 JST 時点の調査要約に基づく最終 Markdown です。数値は必ず上記出典で再確認すること。*

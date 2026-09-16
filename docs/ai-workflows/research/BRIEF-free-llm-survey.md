# 調査指示書: 無料（または月数百円以下）で使える高性能 LLM・コーディングエージェントの総ざらい

目的: 本物の Claude を「考える」だけに温存し、手を動かす仕事を無料の頭脳に振る運用（MULTI-BRAIN-HOWTO.md）のために、
2026年9月時点で**無料枠が大きく・賢い**選択肢を漏れなく洗い出し、dispatch.py に組み込む優先順位を決める。

## 必ず確認する候補（既知のものは現状を再確認。未知のものは追加する）
- コーディングエージェント CLI の無料枠: Gemini CLI（Google アカウントで無料枠）、Qwen Code（Qwen OAuth の無料枠）、
  Codex CLI、Kimi Code CLI、Copilot CLI / GitHub Copilot Free、Cline / Roo Code / Kilo Code の無料モデル、Trae、OpenCode Zen
- API の無料枠: Google AI Studio (Gemini)、Groq、Cerebras、SambaNova、Mistral (free tier)、OpenRouter (:free)、GitHub Models、
  Cloudflare Workers AI、Alibaba Model Studio、Together、Hugging Face Inference、NVIDIA NIM、DeepSeek Platform、Moonshot (Kimi)、
  Zhipu (GLM)、xAI API 無料クレジット、Cohere trial、Amazon Bedrock / Azure AI Foundry / Vercel AI Gateway の無料枠
- サブスクに付いてくる分: SuperGrok（Grok Build）、ChatGPT Plus/Pro（Codex）、Google AI Pro（Gemini CLI/Jules）、Claude 以外で本人が契約済みのもの

## 各候補について書くこと（表の列）
1. 何が無料か（回数/トークン/日 or 月、期限、クレカ要否、日本から使えるか）
2. 使える最上位モデルと、Coding Agent Index 等の公開ベンチでの位置（出典URL必須。数字は出典なしに書かない）
3. 接続方法: OpenAI互換 / Anthropic互換 / 独自CLI。Claude Code の `ANTHROPIC_BASE_URL` 差し替えで使えるか、OpenCode の provider で使えるか
4. dispatch.py への組み込み案（brain 名、必要な環境変数名、コマンド1行）。鍵の値は書かない
5. 罠: 内容審査、レート制限、データ学習への利用、規約でエージェント利用が禁止されていないか、日本語の質
6. 総合評価: A（今すぐ組み込む）/ B（枠切れ時の控え）/ C（見送り）と理由

## 進め方
- Web で一次情報（公式の料金・利用規約ページ）を必ず開いて確認する。ブログの又聞きだけで書かない
- 古い情報（2025年以前）は「当時の情報」と明記し、現時点の確認結果を優先する
- 分からないことは「未確認」と書く。推測で埋めない
- 出力は `free-llm-survey-2026-09-16.md` に Markdown で保存する（このフォルダ）。冒頭に「A 評価の候補と、組み込みの推奨順」を10行以内で要約する
- 最後に「日課にする価値がある監視対象」（新しい無料枠が出やすいところ、枠が変わりやすいところ）を5つ挙げる

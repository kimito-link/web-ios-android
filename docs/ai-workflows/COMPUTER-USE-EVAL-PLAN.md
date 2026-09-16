# ローカル Computer Use 検証計画（着手条件付き・正本）

> 2026-09-16 確立。GPT調査＋本人の修正2点＋司令塔の実測を統合。実装は別チャット/別モデル。
> 着手条件: **動画制作係とマルウェア導線係が一段落してから**。今すぐ並行しない（理由: 9BをGPUに載せると
> 動画処理と VRAM・速度の測定が汚れる／Computer Use は実マウス・キーボードを使い他作業に干渉する）。

## 目的
「無料ローカルLLMを常駐させ、人のようにPCを操作する作業員」を1台作れるか、実測で判定する。
土台=ローカル9B（回数無制限）／難所だけ無料API（Groq→Gemini）へエスカレーション。無料枠が切れても止まらない構造。

## 実測済みの前提（司令塔・2026-09-16）
- このPC: i7-13700F / RAM 80GB / RTX 4070 Ti / 専用VRAM 12GB（共有63.8GBはRAM退避で速くない）。12GBに収まる9Bが主力
- qwen3.5:9b は導入済み（Ollama 6.6GB・Vision/Tools対応）
- **27B(17GB)はこのPCで実測 3 tok/s = Computer Use には遅すぎる**（RAMオフロードで「動く」だけでは不採用の実データ）
- 判定基準は「動く/動かない」ではなく **完走率 × 所要時間 × 1タスク当たりコスト**

## ★評価軸（本人修正1・重要）
「9Bに座標クリックさせるテスト」ではない。Windows-Use は `use_vision=False` で Windows UI Automation /
Accessibility Tree を読む設計（公式README）。測るのは **9BがAccessibility情報を読んで、正しいツール・対象UI・
次の行動を連続して選び続けられるか**。1回成功で合格にしない（1手95%でも20手で約36%）。

## フェーズ（順番を守る。Windows-Use → Browser Use → Qwen Code $computer-use）
- CU-0: Windows-Use インストール確認（github.com/Jeomon/Windows-Use・Ollama正式対応）
- CU-1: qwen3.5:9b + use_vision=False で「メモ帳を開く→1行入力→名前を付けて保存→閉じる→保存ファイル確認」。テスト専用フォルダのみ。**同じタスクを5回**
- CU-2: 集計（成功率・所要時間・総step数・Tool Call失敗数・再試行数・VRAM・生成速度）。**5/5=次へ / 4/5=補助作業員用途 / 3/5以下=常駐にしない**
- CU-3: Browser Use ×5（Ollamaローカル正式サポート・公式に8Bローカル例あり。ただし小型は Tool Calling で苦戦しうると公式が注記）
- CU-4: dispatch を local→Groq→Gemini の **STATE RESYNC付き** に拡張（下記）
- CU-5: 長い実務タスク（例「LINE公式アカウントをN件作る」）で完走率を測る

## ★dispatch の STATE RESYNC ルール（本人修正2・Computer Use専用）
文章生成の即フォールバックとは別扱い。Computer Use で local が失敗したら、その画面状態のまま上位へ渡さない:
```
LOCAL失敗 → STOP → 現在UIを再取得 → STATE RESYNC
→ Groq に「元タスク + ここまでの操作 + 現在UI」を渡して続行
```
理由: 9Bが誤クリック→画面が変化→古い前提のままGroqが続行→さらに壊れる、の連鎖を断つ。常駐化で必須。
Groq `qwen/qwen3.8-27b` は Vision+Tool Use対応・無料枠 30 RPM/1,000 RPD/200K TPD（難所エスカレーション向き）。

## 保留・後回し（理由付き）
- Qwen Code `$computer-use`: Windows の UIAccess worker が **unsigned**（最新リリースでも要署名・信頼）。第2段階
- UI-TARS-1.5-7B: 公式チェックポイント33.2GB→12GBに載らない。量子化前提。優先度低
- Agent-S3: 強力なGroundingモデル前提。無料・大量処理を第一目的にするなら最初の選択にしない

## 常駐構成（検証を通ったら）
依頼 → Router → [Groq 27B 高難度 / Gemini Flash 高難度・Vision / ローカル9B 無制限] → Windows-Use（Windows全体）/ Browser Use（Web）

## 追記（2026-09-16・GPT調査＋司令裁定）: ブラウザ検証は OpenCode + Playwright を第一候補に
Browser Use より先に OpenCode + Playwright を試す（GPT提案・核は妥当）。理由:
- Playwright は Accessibility Tree の要素ID（ref=e12）で操作＝9Bに座標を推測させない（Windows-Use の use_vision=False と同じ発想）
- OpenCode を共通実行基盤にすると、今日の dispatch の local→Groq→Gemini を頭脳だけ差し替えて再利用できる（opencode run --model で切替）
- このPCに Playwright 環境が既にある。追加が最小
- Playwright CLI は MCP より token-efficient（短いコマンド click/fill/snapshot）で、小型9Bはコンテキストを食わせるほど判断が鈍るため有利（Microsoft公式の位置づけ）

ブラウザ検証の順（CU-3 を差し替え）:
- CU-3a: OpenCode + qwen3.5:9b + Playwright CLI ← ブラウザ第一候補
- CU-3b: OpenCode + qwen3.5:9b + Playwright MCP
- CU-3c: Browser Use + 9B
各 同一5手タスク×5回 → 10〜20手 → 実務。完走率×所要時間で比較。1回成功で採用しない（既定ルール）

Windows操作MCP（open-computer-use / windows-computer-use-mcp）は成熟度が低く後回し。OpenCode公式はWSL推奨なので、
Windowsデスクトップ操作MCPを使う段階では「WSL側OpenCode→Windows側MCP」の繋ぎを別途設計（ブラウザ検証では不要）。

留保: 「9Bで完走できるはず」とは決めつけない。GPT自身も同旨。実測で決める。

## 追記2（2026-09-16・切り分けを先に置く）
### 地雷: 「Playwright環境がある」≠「Playwright CLI が使える」
`npx playwright test`（Playwright Test）と `@playwright/cli`（Microsoftがagent向けに推すCLI）は別物。
CLI は MCP より token-efficient（tool schema と Accessibility Tree を毎回コンテキストに載せない）。
検証の最初に存在確認する:
```
playwright-cli --help            # 無ければ:
npm install -g @playwright/cli@latest
playwright-cli install --skills  # Skill も使うなら
```

### フェーズを切り分ける（失敗の原因を 9B / OpenCode接続 / Playwright に分離）
- CU-0A: OpenCode → qwen3.5:9b で単純な tool call が成立するか（Ollama自動検出・不調なら num_ctx を16K〜32Kに上げる）
- CU-0B: OpenCode → Playwright CLI で単純なブラウザ操作（snapshot→click→fill）が成立するか
- CU-1: 5手タスク × 5回（メモ帳 or LINE作成画面まで）
- CU-2: 10〜20手
- CU-3: 実務タスク
CU-0A/0B が通らないうちに CU-1 へ進まない（原因が混ざる）。

### OpenCode は Windows では WSL 推奨（公式）
Windows でも直接動くが best experience は WSL。ブラウザの Playwright CLI/MCP は Accessibility ベースで
Windows全体の Computer Use とは切り離して検証できる（Vision モデル必須でない）。
Windowsデスクトップ操作MCPを使う段階で初めて「WSL側OpenCode→Windows側MCP」の繋ぎを設計する。

### 最終形（検証を通ったら）
Grok Bot → dispatch → OpenCode →（local qwen3.5:9b / Groq / Gemini）→ Playwright CLI / Windows操作系。
opencode run は JSON出力・モデル指定に対応（公式）＝dispatch から呼びやすい。

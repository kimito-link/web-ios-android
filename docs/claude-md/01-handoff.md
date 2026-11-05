> CLAUDE.md から移した節です。この中の backtick のパスはリポジトリ直下からの相対です。

## デスクトップ／ノートPC・複数AI共通の開発継続ルール（2026-09-16確立）

> **今の到達点: 設計・テンプレート整備完了。全プロジェクトへの`handoff.md`配布は未着手（必要時に配置）。**

きっかけ（ユーザーの言葉、要旨）: 「デスクトップPCとノートPCの間で開発を引き継ぐとき、
AI運用ルールをPCごとに別管理したくない。どちらのPCで始めても、共有フォルダの正本を見れば
続きから安全に作業できるようにしたい」。図解で明確に訂正された前提: **`github/`ディレクトリ
（`C:\Users\info\OneDrive\デスクトップ\Resilio\github\`、OneDrive同期）が共有フォルダ本体**であり、
`web-ios-android`はその中の一プロジェクト（「共有頭脳」＝AI運用ルールの正本）に過ぎない。
「web-ios-android＝共有フォルダ」ではない。

### 大前提：新しい共有機構は作らない

`github/`はOneDrive同期により、デスクトップPC・ノートPCの両方から既に同じ実体が見えている
（新規に構築する対象ではなく、既存の配置）。このキットの各プロジェクトのCLAUDE.mdが
`@../web-ios-android/CLAUDE.md`をインポートする仕組み（本ファイル最上部の知見の地図を参照）も
既に共有フォルダ経由で両PCに伝播する。**「どのAIか」「どのPCか」ではなく、共有された正本を
見れば別PC・別AIでも安全に続きから作業できる**、という状態を作ることが目的であり、
そのための土台（共有フォルダ・`@`インポート・`ai-hub`・`context-evolution.json`・
`.agent/coord.md`・マルチ頭脳運用）はすでに全部揃っている。今回追加するのは、
**作業の中身（SPEC/RESULT/進捗/テスト結果/引き継ぎ）を渡す1枚のファイル形式**だけ。

### 何を共有し、何を共有しないか

**共有する**（`github/`配下＝OneDrive同期、通常通りgit管理下に置いてよい）:
AI共通ルール（CLAUDE.md・`docs/ai-rules/`・`docs/ai-workflows/`）／IMPLEMENTATION_SPEC・
IMPLEMENTATION_RESULT（`_docs/DESIGN-*.md`・`_docs/IMPLEMENTATION-HANDOFF-*.md`）／
作業状態・テスト結果・引き継ぎ情報（下記`handoff.md`）／プロジェクト固有ルール（各リポの
CLAUDE.md固有節）／必要な証拠（`qa/evidence/`等）。

**共有しない**（PC固有・git管理外のまま）: APIキー・パスワード・トークン・PC固有の秘密情報
（`~/.claude/CLAUDE.md`「クリップボード経由」節の対象そのもの）／巨大な一時ファイル・
キャッシュ・`node_modules`・不要なビルド生成物・CrashDump等の巨大データ（本当に必要な場合のみ
個別に検討し、既定では対象外）。既存の`.gitignore`パターンがそのまま境界線になる——
新しい除外ルールを別立てで作らない。

### 引き継ぎ形式: プロジェクト直下の `handoff.md`

**単位はプロジェクトごと**（例: `line-bot/handoff.md`、`kimito-link/handoff.md`）。
`github/`直下に1本の集約ログを作るのではなく、作業対象のプロジェクト直下に置く
（そのプロジェクトの作業に閉じた情報だから）。テンプレート:
[`templates/handoff/handoff.md.example`](../../templates/handoff/handoff.md.example)。

```
STATUS:
ROOT_CAUSE:
FILES_CHANGED:
CHANGES:
TESTS_RUN:
TEST_RESULT:
REMAINING_RISKS:
NEXT_ACTION:
LAST_WORKED_ON:
WORKED_BY:
MACHINE_NOTES:
```

`MACHINE_NOTES`は、そのPC固有の環境依存の問題があるときだけ埋める（例: 「このPCではXcodeが
無いのでiOSビルド確認は未実施」）。無ければ「-」。

★**`.agent/coord.md`（並列セッション協調プロトコル、上の節）とは役割が違う。混同しないこと**:
- `.agent/coord.md` … 「今どのセッションがこのリポで動いているか」＝ロック調整用。
  意図的にgit管理外（`.gitignore`対象）。書き換え頻度が高くコミットするとノイズになるため
- `handoff.md` … 「作業の中身そのもの」＝原因・変更点・テスト結果・次の一手。
  通常通りgit管理下（履歴として残す価値がある）。書き換え頻度は区切りのよいタイミングのみ

### 再調査・再テストを避ける（両PC・全AI共通の作法）

PC・AIを切り替えるとき、まず対象プロジェクトの`handoff.md`と、既存の
[`_docs/instruments/CONTEXT-EVOLUTION.md`](../../_docs/instruments/CONTEXT-EVOLUTION.md)
（`.instrument-context.md`・`context-evolution.json`の`confirmed`/`rejected`/`pending`記録）を読む。
そこに書かれている既知の事実・確定済みの判断は再調査しない。**足りない部分だけ**追加で調べる。
リポ全体の再スキャン・全ファイルの読み直し・巨大ログの再解析・理由なき全テスト再実行はしない
（本ファイル「セッション開始時の必須アクション」「AI特有の認知の癖と対処」の思想をPC間・AI間の
引き継ぎにも適用しただけで、新しい原則を増やすものではない）。

### AI-agnostic（頭脳が変わっても止まらない）

判断は本物のClaude、実装等の手を動かす作業は他の頭脳（Grok Build／Qwen本家／Cloudflare／
ローカル）という役割分担は既に[`docs/ai-workflows/MULTI-BRAIN-HOWTO.md`](../../docs/ai-workflows/MULTI-BRAIN-HOWTO.md)
で確立済み（本ファイル「セッション開始時の必須アクション」5番）。Claudeの週間上限に達した等で
本物のClaudeが使えなくなっても、`handoff.md`を読めば他の頭脳・別セッションが続きを判断できる
状態にしておくのがこの節の目的。dispatch.pyのログ（`%LOCALAPPDATA%\llm-proxy\runs\`）はPCローカルの
実行ログに過ぎず共有対象ではない——**要点は`handoff.md`に人が読める形で書き写してから
セッションを終える**。

### 実装時の注意（このキット自身が踏まないための先出し）

- `handoff.md`は新しいプロジェクトを作るたびに自動生成する必要はない。**複数PC・複数AIを
  またいで継続する作業が実際に発生したときだけ**、そのプロジェクト直下にテンプレートから
  作成する（先回りして全プロジェクトへ一括配布しない——2026-09-15の`@`インポート一括展開と
  同じく、必要になった時点で個別対応する）
- 既存の`context-evolution.json`（判断の記録）・`.decision-receipts.json`（CANONICAL CHECKの記録）
  と役割が重ならないよう、`handoff.md`は「今の作業1件の状態」だけを持つ薄いファイルに留める。
  判断の理由・出典まで書きたくなったら、そちらは`_docs/DESIGN-*.md`やcontext-evolutionの
  `--record`に任せ、`handoff.md`からはファイル名で参照する


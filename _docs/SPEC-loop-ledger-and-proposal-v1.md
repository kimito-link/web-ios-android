# 承認台帳 と 提案書 の仕様 v1（schema 1）

> **今の到達点: 仕様と検査の実装完了（MVP の第3・第4歩）。アダプタ（第2歩）・ローカルAIによる提案書づくり（第5歩）・ランナーは未着手。**
> 親: [`DESIGN-self-improvement-loop-2026-10-18.md`](DESIGN-self-improvement-loop-2026-10-18.md)。症状カード: [`SPEC-symptom-card-v1.md`](SPEC-symptom-card-v1.md)。
> 実装: 台帳 `templates/scripts/lib/loop-ledger-core.mjs`（判定）・`record-loop-decision.mjs`（追記の唯一の入口）／提案書 `templates/scripts/lib/proposal-format-core.mjs`（判定）・`check-proposal.mjs`（CLI）。テストはそれぞれ `*.test.mjs`。

## 1. 承認台帳（`_loop/<プロジェクト>/decisions.jsonl`・追記専用・1行1件）

```json
{"schema":1,"id":"D0003","proposal":"P0001-comment-lag","decision":"approved","by":"human:link","at":"2026-10-18T05:30:00Z","reason":"観測と仮説が合う。1版1変更で進める"}
```

| キー | 規則 |
|---|---|
| `schema` | `1` |
| `id` | `D` + 4桁以上の連番（CLIが自動採番・重複不可） |
| `proposal` | 提案書の名前（`[A-Za-z0-9][A-Za-z0-9_.-]{0,95}`） |
| `decision` | `proposed` / `approved` / `rejected` / `deferred` / `no_effect` |
| `by` | `human:<名前>` または `ai:<モデル名>` |
| `at` | ISO8601 |
| `reason` | `proposed` 以外は**必須**・500字まで。秘密・メール・URLらしき形は不可 |

**守ること（コードで固定・テスト済み）**
- **AI（`ai:`）が書けるのは `proposed` まで。** `approved` / `rejected` / `deferred` / `no_effect` は `human:` だけ。
- **状態遷移**: （なし）→ `proposed` → `approved` / `rejected` / `deferred`。`deferred` は再判断できる。`approved` → `no_effect` だけ。`rejected` と `no_effect` は終端（同じ提案は復活させない。直すなら新しい提案書）。
- **追記専用**: 追記の前に、既存の台帳を**最初から再生して検査**し、壊れていれば（JSONでない行も、JSONでも中身が不正な行も）追記しない。
- **AIが走らせるシェルからは承認系を書けない**: 環境変数 `CLAUDE_CODE_SESSION_ID` があるシェルでは `approved` / `rejected` / `deferred` / `no_effect` を拒否する。**承認は、人間が自分のターミナルで打つ。**
- 限界: `by` が本当に人間かは証明できない。環境変数を意図的に外せば回避できる（意図的な回避で、コマンド履歴に残る）。AI同士の合意や、サブエージェントの報告は承認ではない（設計 §3-7）。

使い方: `node scripts/record-loop-decision.mjs --ledger _loop/<プロジェクト>/decisions.jsonl --proposal <名前> --decision <決定> --by human:<名前> --reason "<理由>"`（終了コード 0=追記 / 1=拒否 / 2=使い方の誤り）

## 2. 提案書（`_loop/<プロジェクト>/proposals/<連番>-<要約>.md`・Markdown）

先頭にヘッダー行、続けて見出しがちょうどこの順で5つ:

```markdown
schema: 1
proposal: P0001-comment-lag
project: tsuioku
cards: comment-lag
writer: ai:qwen3-local

## 症状
## 観測
## 原因仮説
- 【推測】… 確度: 中。反証: …
- 【確証】… 確度: 高。根拠: card:comment-lag。反証: …
## 版の提案
- 変更: （1行だけ）
- 触るファイル候補: …
- やらないこと: …
## 検証手順
```

| 検査 | 内容 |
|---|---|
| ヘッダー | `schema`=1・`proposal`・`project`・`cards`（1つ以上）・`writer`（`human:`/`ai:`）。未知のキーは不可。`writer` はメタ欄で処理の条件にしない |
| 見出し | ちょうど 症状 / 観測 / 原因仮説 / 版の提案 / 検証手順 の順。増減・空のセクションは不可 |
| 原因仮説 | 各項目（`- `）に `【確証】`か`【推測】`・`確度: 高/中/低`・`反証: …`。`【確証】`には `根拠:`（`card:` / `test:` / `diff:` / `実測` のいずれかを含む）。**根拠のない断定は無効** |
| 版の提案 | `変更:` がちょうど1行（**1版1変更**）・`触るファイル候補:`・`やらないこと:` |
| 観測の数字 | `--cards` を渡すと、ヘッダー `cards:` のカードを読み、観測に出る数字がそのカードの `metrics` の値だけかを照合（コード表記 `…` の中は除く） |
| 却下済み | `--ledger` を渡すと、本文の `却下済み: <id>` が台帳で本当に `rejected` かを照合 |
| 秘密 | `sk-…`・`Bearer …`・鍵の変数名・メールらしき形は不可。サイズは32KiBまで |

使い方: `node scripts/check-proposal.mjs <提案書.md> [--cards <カードのディレクトリ>] [--ledger <decisions.jsonl>]`（0=合格 / 1=違反 / 2=読めない）。違反の出力に本文は載せない。違反した提案書は人間に渡さず、台帳に `rejected(format)` を記録する（運用はランナーの仕事。まだ無い）。

## 3. 限界（過信しない）
- 仮説が**正しいか**・確度の付け方が妥当かは検査できない。形が整っていることは、内容が良いことを意味しない。
- 観測の数字の照合は「カードに無い数字」を拾うだけで、数字の**解釈**の誤りは拾えない。
- 変異テストで、AIによる承認・遷移・重複ID・理由必須・終端・秘密検査・AIシェル拒否・台帳の再生検査・確証の根拠・1版1変更・数字照合・却下済み照合・秘密検査・反証必須を壊すと赤になることを確認済み。見出しの「個数」検査だけは、後続の順序比較と重複していて壊しても結果が変わらない（冗長な防壁）。

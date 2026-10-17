# 症状カード 仕様 v1（schema 1）

> **今の到達点: 仕様と検査の実装完了（MVP の第1歩）。アダプタ・提案書の形式検査・承認台帳・ランナーは未着手。**
> 親: [`DESIGN-self-improvement-loop-2026-10-18.md`](DESIGN-self-improvement-loop-2026-10-18.md)（§4 部品2・§5）。
> 実装: 判定 `templates/scripts/lib/symptom-card-core.mjs`、CLI `templates/scripts/check-symptom-card.mjs`（exit 0=合格 / 1=違反 / 2=対象なし＝測れていない）、テスト `templates/scripts/lib/symptom-card-core.test.mjs`（16件・変異テストで確認）。

## 何のためのカードか
プロジェクト固有の「症状の入口」（診断・状態速報・ログ等）から、**AIに渡してよい情報だけ**を抜いたもの。AIへ渡す前に必ずこの検査を通す。
通らなければカードを作らせない・AIへ渡さない（fail-closed）。置き場は `_loop/<プロジェクト名>/symptoms/<日時>-<症状ID>.json`（git管理外）。

## 形（JSON・これ以外のキーは全部拒否）
```json
{
  "schema": 1,
  "id": "comment-lag",
  "project": "tsuioku",
  "source": "status-live-adapter",
  "verdict": "warn",
  "version": "1.2.3",
  "buildId": "a1b2c3d",
  "at": "2026-10-18T05:30:00+09:00",
  "metrics": { "commentCount": 120, "p95Ms": 840, "ok": true }
}
```

| キー | 必須 | 規則 |
|---|---|---|
| `schema` | ○ | 数値 `1` |
| `id`（症状ID）・`project`・`source`（アダプタ名） | ○ | `[A-Za-z][A-Za-z0-9_.-]{0,63}` |
| `verdict` | ○ | `ok` / `warn` / `fail` / `unmeasured` |
| `version` | ○ | `[0-9A-Za-z][0-9A-Za-z._+-]{0,31}` |
| `buildId` | — | `[0-9A-Za-z][0-9A-Za-z._+-]{0,63}` |
| `at` | ○ | ISO8601（`Z` かオフセット付き） |
| `metrics` | ○ | オブジェクト。**値は有限の数値か真偽値だけ**（文字列・配列・入れ子は不可）。64個まで。キーは `[a-z][A-Za-z0-9_]{0,47}` |

- ファイル全体 8KiB まで。
- 数値は絶対値 1e9 まで（数値のIDや電話番号の混入を粗く防ぐ。ヒューリスティック）。
- `metrics` のキー名が、個人・秘密を指す語で**終わる**ものは不可: `id name mail email phone tel address url uri token key secret password passwd auth cookie session avatar icon text body message comment ip device card`（camelCase / snake_case の最後の語で判定）。`userId`・`displayName`・`avatarUrl` は不可、`commentCount`・`userCount`・`p95Ms` は可。
- 文字列の値に、秘密らしき形（`sk-…`・32字以上の不透明な文字列・`…_API_KEY` のような鍵の変数名・`Bearer …`・メール・URL）は不可。
- 違反の出力には**値を載せない**（パスと規則名だけ。検査のログから漏れないため）。

## なぜこの形か（設計の理由）
- **許可リスト**: 新しいフィールドが増えても漏れない。禁止リストにしない。
- **自由記述の文字列を持てる場所が無い**: コメント本文・名前などは、入れたくても入る場所が無い。数値と短い識別子だけが通る。
- **原因候補IDは持たせない**: 仮説は提案書側に置く（カードは観測だけ）。

## 限界（過信しない）
- 形で決められるのはここまで。**集計値だけを渡す責任はアダプタ側に残る**（数値が個人に結びつくかは検査できない）。
- `metrics` のキー名の語リストは補助の防壁。アダプタが許可リスト方式で数値だけを抜く設計が主。
- 変異テストで、未知キー許可・文字列値の許可・値のログ出力・禁止語の無効化・巨大数の許可を壊すと赤になることを確認済み。メール形式の二重防壁だけは、先に形式検査が拒否するため壊しても結果が変わらない（冗長な防壁）。

## 変えるとき
`schema` の番号を上げ、古い版も読めるようにする（追記で足す）。検査のコードとテストを同時に変える。

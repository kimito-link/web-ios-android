# 「何も起きない」故障を捕まえる計器3点（CI用）

**赤いCIとして現れない故障**を検知する。止まったこと自体が通知されないため、
放置されるほど悪化する型（2026-09-01 に kimitolink-linktree で3件同時に発見）。

| スクリプト | 何を捕まえるか |
|---|---|
| `check-workflow-timeouts.mjs` | `timeout-minutes` 未設定のジョブ（ハングで6時間コース） |
| `check-dependabot-queue.mjs` | 依存更新PRが枠を使い切って**新規が作られない**状態 |
| `check-actions-usage.mjs` | 暴走ジョブ（1回20分超・1本300分超） |

## 実損の記録（なぜ要るか）

- **2026-08-06**: `timeout-minutes` 未設定ジョブのハングで Actions の予算上限に到達し
  **全リポの CI が停止**（Linux 6,801分 / 6日）。当時77件に上限を入れて回復したが
  ★**再発検知が無かった**ため、後から追加されたジョブが素通りしていた。
- **2026-09-01**: `open-pull-requests-limit: 10` に対しオープンPRがちょうど10本で、
  **17日間セキュリティ更新を含む新PRが1本も作られていなかった**。
  しかも一度もマージされておらず、放置するほど枠が埋まる**自己増悪する構造**だった。

## 使い方

```bash
node scripts/check-workflow-timeouts.mjs      # 0=全ジョブOK / 1=未設定あり / 2=測れず
node scripts/check-dependabot-queue.mjs       # gh CLI が要る
node scripts/check-actions-usage.mjs          # gh CLI が要る
node scripts/check-actions-usage.mjs --selftest   # 毒→赤 を機械で確認
```

CI へは **selftest を配線する**のが基本（実データ取得は認証が要るため）:

```yaml
- name: 計器が赤くなれることの確認
  run: |
    node scripts/check-actions-usage.mjs --selftest
    node scripts/check-dependabot-queue.mjs --selftest
- name: 全ジョブに timeout-minutes があるか
  run: node scripts/check-workflow-timeouts.mjs
```

## 設計上の約束（変更するときはここを壊さないこと）

- **3値で返す**: 0=根拠つき合格 / 1=測れた上での赤 / ★**2=測れなかった（緑ではない）**。
  2 を 0 と同じに扱わないこと。
- **緑のときも測定値を印字する。** 数字の見えない緑は「測っていない緑」と区別が付かない。
- **測っていないものを出力に書く。** 例: `check-actions-usage` は**請求額を測らない**
  （分数のみ。金額APIは `gh` の `user` スコープが要るので権限を広げない判断）。
- **閾値を件数でベタ書きしない。** `check-dependabot-queue` は必ず
  `open-pull-requests-limit` と突き合わせる（上限20なら10本は健全）。
- ★**YAMLライブラリに依存しない。** `yaml` は未宣言・`js-yaml` は推移的依存でしかなく、
  CIで解決できる保証がない（＝「緑なのに検査していない」に直結する）。

## ★移植するときの注意（実際に踏んだ）

- `check-workflow-timeouts.mjs` は `.github/workflows` を**上へ辿って探す**。
  固定の相対パスにすると、格上げ元では動くのに格上げ先で「見つかりません」になる。
  明示したいときは環境変数 `WORKFLOW_DIR` を使う。
- **ワークフローYAMLは CRLF と LF が混在する。** 編集時は `file <path>` で確認し、
  正規表現は `\r?\n` を使う。LF前提の正規表現は無言で不一致になる。
- ★**毒テストは「毒が入ったこと」を先に検証する。** 置換前後が同一なら異常終了させる。
  でないと**毒の失敗を門番の失敗と取り違える**（2026-09-01 に誤診しかけた）。

## 依存

`lib/instrument-core.mjs`（3値・selftest・fail-closed の土台）。
判定ロジックは `lib/*-core.mjs` に純関数で分離してあり、vitest のテストが同梱されている。

詳しい経緯: `kimitolink-linktree/_docs/KB-silent-stall-failures-2026-09-01.md`
（`node ai-hub/bin/hub.mjs find --sig "dependabot 更新が来ない"` で引ける）

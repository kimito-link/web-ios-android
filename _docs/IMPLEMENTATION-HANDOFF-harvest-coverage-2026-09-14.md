# 実装ハンドオフ: harvest漏れの機械検出（Decision Receipt → index 被覆検査）

**状態: 設計完了・実装未着手。** 本ファイルは着手手順の1枚まとめ。設計の背景・
判断根拠は`DESIGN-harvest-coverage-2026-09-14.md`（同じ`_docs/`配下）を参照。

- 設計: Fable（claude-fable-5-1）。裏取り: 司令塔（web-ios-androidセッション）。日付: 2026-09-14
- この1枚だけで着手できる粒度。実装は行っていない（次チャット/別モデルの仕事）
- 保存先の相互参照: 本ファイル（着手手順）← `DESIGN-harvest-coverage-2026-09-14.md`
  （設計・地雷マップ・用語説明はここに集約）

## A. 読む順

1. 本ファイル
2. `_docs/DESIGN-harvest-coverage-2026-09-14.md`（設計全文）
3. `.decision-receipts.json`（リポ直下、既存のreceipt構造を確認）
4. `templates/scripts/record-decision-receipt.mjs`（拡張対象）
5. `templates/diagnostics/check-decision-receipt.mjs`（実在パスは`templates/scripts/`側。
   ★CLAUDE.mdの記述`templates/diagnostics/check-decision-receipt.mjs`は誤り。実際は
   `templates/scripts/check-decision-receipt.mjs`にある。同じ設計パターンの参照元として読む）
6. `templates/scripts/lib/instrument-core.mjs`（3値exit・`runSelfTest`・`computeExitCode`）
7. `templates/diagnostics/run.mjs`（CHECKS配列への登録方法、`declares`機構）

## B. スコープ（MVP）

1. `templates/scripts/record-decision-receipt.mjs`に`--harvest skip|kb|index`フラグを追加
2. `templates/diagnostics/check-harvest-pending.mjs`を新設
3. `run.mjs`のCHECKS配列に登録
4. selftest 8種を実装し全てPASSさせる

**やらないこと（Phase 2以降）**: `context-engine.mjs`の`## 0.5`セクション追加、
`hub.mjs doctor`の拡張（別リポ＝別critical section、Main-Write Pauseを踏んで別途）、
Stop/SessionEndフック機構。

## C. 着手手順

### C-1. `record-decision-receipt.mjs`の拡張

既存の`--responsibility`/`--decision`/`--scope`/`--canonical-source`パーサ（ファイル冒頭の
`opt()`/`optAll()`関数）に倣い、以下を追加する:

```
--harvest skip  --reason "<理由>"   → receipt.harvest = {status:'skip', reason, at:<ISO now>}
--harvest kb    --ref "<KBパス>"    → receipt.harvest = {status:'kb', ref, at:<ISO now>}
--harvest index --ref "<index id>"  → receipt.harvest = {status:'index', ref, at:<ISO now>}
```

- `--harvest skip`のとき`--reason`が無ければexit 1（引数不正）
- `--harvest kb|index`のとき`--ref`が無ければexit 1
- 省略時は`harvest`フィールドを付けない（「未決」の意味。既存receiptとの後方互換）

### C-2. `check-harvest-pending.mjs`の新設

`templates/scripts/check-decision-receipt.mjs`を雛形にする（同じディレクトリ配置・
同じ3値exit・同じ`isMain`パターンを踏襲）。

```js
// 骨格イメージ（実装時に厳密化する）
import { EXIT, computeExitCode, runSelfTest } from './lib/instrument-core.mjs';

const HARVEST_SCOPE_DEFAULT = ['templates/**', '_docs/**', 'docs/ai-rules/**', 'scripts/{verify,check,lint}-*.mjs'];

export function judgeHarvestCoverage(receipt, { indexEntries, readKb, repoName, now, sinceDays = 30 }) {
  // 1. receipt.at が sinceDays 以内か
  // 2. scopePaths が harvestScope に一致するか（一致しなければ候補外＝評価対象から除外）
  // 3. harvest.status === 'skip' かつ reason 非空 → { verdict: 'pass', evidence: { coveredBy: 'waiver', reason } }
  // 4. index に path 一致 → verified が receipt.at 以降なら pass、それより古ければ inconclusive
  // 5. 登録済みKBエントリ本文に scopePaths の basename が出現 → readKb(entry.path) で本文取得して判定
  // 6. どれでもなければ inconclusive
}
```

- `--selftest`は`DESIGN`のD節・G節に列挙した毒（8種）をすべて含める:
  1. 正常系: indexにpath一致 → pass
  2. `.decision-receipts.json`が無い → inconclusive（fail-closed、候補なしと区別）
  3. KB本文にbasename出現・verified新しい → pass
  4. KB本文にbasename出現・verified古い → inconclusive
  5. `harvest.status='skip'`かつreason非空 → pass
  6. `harvest.status='skip'`かつreason空 → fail（引数不正相当）
  7. harvestScope外のパス（例: `scripts/revenue/lib/x.mjs`）→ 候補から除外（評価されない）
  8. index.json自体が読めない（存在しない/JSON壊れ）→ inconclusive

### C-3. `run.mjs`への登録

既存のCHECKS配列のエントリ形式（`{ name, path }`または`declares`付き）を確認し、
1行追加する。コメントに今回の実損（App Privacy自動化のharvest漏れ、2026-09-14）を
書く。

### C-4. Decision Receiptの記録（この実装自体について）

`record-decision-receipt.mjs`で、この実装自体の判断を記録する
（`--responsibility "harvest-coverage-check" --decision LOCAL --scope
templates/diagnostics/check-harvest-pending.mjs`のような形）。**新設した
`--harvest`フラグを使って、この実装自体をkbまたはindexとしてharvestするところまで
完了させる**（設計書F節「自分自身が初回に赤になる」地雷への対処）。

## 機械的な完了判定

1. `node templates/diagnostics/check-harvest-pending.mjs --selftest`が8種の毒を
   含めて全てPASSすること
2. `node templates/diagnostics/check-harvest-pending.mjs .`を実行し、意図的に
   harvest未実施のreceiptを1件作った状態でINCONCLUSIVE（exit 2）になることを確認
   （再現条件を満たすこと）
3. `node templates/scripts/record-decision-receipt.mjs --harvest skip --reason "..."`
   相当を実行し、該当receiptの評価がpassに変わることを確認
4. `templates/diagnostics/check-gates-are-wired.mjs`で配線漏れが無いことを確認
5. `templates/diagnostics/check-selftest-coverage.mjs`（存在すれば）で新規checkの
   selftest未配線が検出されないことを確認
6. 新設ファイル自体のDecision Receiptが記録され、`check-decision-receipt.mjs`が
   合格すること
7. 新設ファイル自体がai-hub/index.jsonへharvestされ、
   `node ai-hub/bin/hub.mjs find --sig "harvest"`または類似のtriggersでヒットすること
   （自己参照的だが、これを怠ると設計書G節の地雷「自分自身が初回に赤」を再演する）

## 地雷（DESIGN文書G節の要約、詳細はそちらを参照）

- 新設checkが初回に自分自身で赤になる（未登録）→ 手順C-4で対処
- doctor拡張は本ハンドオフのスコープ外（別途Main-Write Pauseを踏んで実施）
- waiverの乱用は機械で止めない（意味判断のため）。skip理由の可視化は将来のcontext-engine
  拡張（Phase 2）で対応

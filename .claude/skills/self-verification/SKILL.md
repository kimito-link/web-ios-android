---
name: self-verification
description: >-
  製品・スクリプトを「AIが人間に見てもらわずに検証できる形」で作るための型（計器の思想、
  docs/ai-rules/04_SELF_VERIFICATION.md の実行版）。次の瞬間に必ず使う:
  (1) verify-*.mjs / check-*.mjs / lint-* / gate / 診断スクリプトを新しく書く・書き直す直前
  (2) 診断ページ・デバッグ表示・status:live・ログ計測・「検知N→処理N→出力N」の数え上げを製品に足すとき
  (3) 「実機で見てきてください」「スクショを送って」「押してみて」「反映されたか確認して」と
      人間に頼む文を書きかけたとき
  (4) 「動くはず」「テストが緑」「修正完了」で報告を締めようとするとき（→末尾でreality-checkerへ渡す）
  (5) 「直したのに変わらない」「原因が特定できない」が2回目になったとき。
  対象外: 既にある差分の合否判定だけ（reality-checkerへ）、要件定義（council-fable）、
  ストア提出（store-guard）、単発のGrep/調査。手順は6段・出力は計器表1枚。
---

# self-verification — 検証可能な形で作る（6段）

正本: docs/ai-rules/04_SELF_VERIFICATION.md（思想）／_docs/instruments/HANDOFF-new-app.md（実装手順）
★内容が変わったら正本を直す。このファイルに思想をコピーしない。

## 0. 対象確認（10秒）
- いま作る/書きかけているものは「検査・計器・人間への目視依頼・完了報告」のどれか → どれでもなければ終了
- 既にある差分の合否だけ知りたい → reality-checker へ委任して終了

## 1. 既存を探す（新しく書く前に）
- `node ../ai-hub/bin/hub.mjs find --tag verify,instrument,diagnostics`（ヒット0=正常）
- Grep: 対象リポの scripts/ と templates/diagnostics/ に同名・同目的の verify-*/check-* が無いか
- 同等があれば再利用。無ければ 2 へ

## 2. 土台を借りる（自作しない）
- `import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs'`
- 無いリポなら templates/scripts/lib/instrument-core.mjs をコピーし check-drift.mjs の PAIRS に登録
- 3値exit（0/1/2）・passにはevidence必須（無いとinconclusiveに自動降格）・--selftest実装・limitation明記

## 3. 6パターン照合（該当を選ぶ・未適用は「未適用」と書く）
| # | パターン | この対象に |
|---|---|---|
| 1 | 計器（全数を段階ごとに数える・遅延ms） | 適用/未適用/対象外 |
| 2 | 嘘をつかない診断（実際に起きたものだけ・失敗は内訳・provenance） | |
| 3 | 決定論+依存注入（乱数/時刻/I/Oは引数） | |
| 4 | リモート読取（status:live型・dirty check） | |
| 5 | 工程ガード（check-tracked-imports・版焼き込み） | |
| 6 | メタ診断（静的ソーススキャンで登録漏れを物理的に不可能に） | |

## 4. 人間を検証ループから外す
- 人間に残してよいのは (a) 権限操作（最終リロード等） (b) 官能評価（音・体感）だけ
- それ以外の「見てきて」は、Browser pane／CI／status:live のどれかで自分が測る形に置き換える
- 画面を渡さざるを得ないなら docs/ai-rules/05_HANDING_SCREEN_TO_HUMAN.md の型で

## 5. 配線（作っただけは0点）
- package.json / diagnostics/run.mjs / CI のいずれかに登録
- `node templates/diagnostics/check-gates-are-wired.mjs` と `check-runner-registers-all.mjs` を実行
- 実行して赤/黄/緑を1回見る。「0件の緑」は inconclusive

## 6. 判定は自分でしない・記録して終える
- reality-checker へ「何が動いていると主張しているか」を1行で渡し、判定表を受け取る
- `context-engine.mjs --record --status confirmed|pending ...` で台帳へ
  （配布先リポの`scripts/`配下、このキット自身は`templates/scripts/`配下にある）
- 完了報告には下の計器表を必ず貼る

## 出力契約（この形以外で「できました」と言わない）
| 作った検査/計器 | exit(0/1/2) | evidence | selftest | 配線先 | 未適用パターンと理由 |
|---|---|---|---|---|---|

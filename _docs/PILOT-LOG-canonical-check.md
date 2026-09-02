# Decision Receipt パイロット運用ログ

`_docs/DESIGN-canonical-boundary-rules.md`（v1.0、正式採用）のMVP実装（commit `151e478`）後、
実際の開発案件で`SEARCH → CANONICAL CHECK → Decision Receipt → CHANGE → Gate → Proof`を
通常フローとして使った記録。3〜5件集まるまで、新しいGate・検出器は作らない
（実際に起きた問題だけを次の改善理由にする）。

## Pilot #1: findRepoRootの重複（2026-09-02）

- **responsibility**: `.git`を遡ってリポジトリルートを探す機能
- **SEARCH候補**: `check-decision-receipt.mjs`/`record-decision-receipt.mjs`の新規作成時点で、
  `findRepoRoot`は既に`scripts/lib/repo-root.mjs`（正本）と`templates/scripts/`配下4本
  （`check-instrument-proof.mjs`, `record-instrument-proof.mjs`, `check-instrument-ran.mjs`,
  他）に存在していた
- **実装時のDecisionの有無**: **無かった**。既存の`check-instrument-proof.mjs`を土台にコピーして
  新規ファイルを作った際、CANONICAL CHECKを実際には行わず、`findRepoRoot`もそのままコピーした
- **事後Decision**: 新規実装完了後、キット自身に`check-shared-parts-used --shared-dir scripts/lib
  --shared-dir templates/scripts/lib`を実行したところ、`findRepoRoot`が7箇所の重複として検出された。
  事後にCANONICAL CHECKを行い、**KEEP_SEPARATE**（配布境界があり`scripts/lib/`をimportできない
  ため、既存の兄弟ファイルと同型の意図的複製が正しい）と判定。`.decision-receipts.json`へ記録
  （commit `3d273bc`）
- **Gate結果**: `check-decision-receipt.mjs --check`は「新規source fileにreceiptがある」ことは
  確認できたが、事後に書かれたreceiptと事前に書くべきだったreceiptを区別できない
  （タイミングを見ていない）
- **根本原因（ChatGPTレビューで確定）**: **KEEP_SEPARATEという最終Decision自体は問題なかった。
  問題はDecisionを行うタイミングが遅かったこと**。「必要な情報（既存のfindRepoRoot重複候補）が、
  新しいコードを作る瞬間のクリティカルパスに存在していなかった」ため、実装が終わってから
  Gateに指摘されるまで気づかなかった
- **次の改善仮説**: 新規source fileに対するDecision Receiptを確定する前に、既存の
  `check-shared-parts-used`が持つ検出結果を使って、そのファイルに関係する既存共有部品・
  重複候補をJust-in-timeで提示する。新しい重複検出器（AST解析・類似コードAI判定等）は作らず、
  既存Gateの結果を再利用する

## 診断の要点（ChatGPTレビュー）

```
新規ファイルを作る
      ↓
既存兄弟ファイルをコピー
      ↓
findRepoRoot もコピーされる
      ↓
実装完了
      ↓
後から check-shared-parts-used
      ↓
「重複している」と発覚
      ↓
CANONICAL CHECK（事後）
      ↓
KEEP_SEPARATEと判定（結論自体は正しい）
```

「見えないから繰り返す」は半分正しいが、より正確には**「必要な情報が新しいコードを作る瞬間の
クリティカルパスに存在していないから繰り返す」**。Architecture Mapがどれだけ綺麗でも別ページを
開かなければ見えないなら実装は素通りする。コンソールだけのGateも実装後にしか走らないなら
事後検知にしかならない。

優先順位:
```
① Just-in-time  新規実装の直前に既存候補を提示
② Decision      CANONICAL CHECK
③ Gate          記録なしでは完了不可（実装済み）
④ Map           いつでも人間・AIが現在地を確認できる（将来）
```

## 次に着手する改善（設計のみ、まだ実装しない）

- スコープはこの1点だけ: 「新規source fileに対するDecision Receiptを確定する前に、
  既存の`check-shared-parts-used`が持つ情報を使って、関係する既存共有部品・重複候補を
  Just-in-timeで提示する最小設計」
- 新しいduplicate detectorは作らない。AST解析・類似コードAI判定・文字列重複判定も追加しない
- 既存`check-shared-parts-used`の検出結果を再利用することを優先する
- 将来Architecture Mapへ同じ情報を表示する場合も、別の検出ロジックを作らず、同じ
  FACT/HEURISTICデータを再利用できる構造にする（PRE-FLIGHT用検出・Map用検出・Web一覧用検出、
  と3つ作らない＝正本が3つになる事故を避ける）
- Architecture Map自体の全面改修・v2化にはまだ進まない

比喩（ChatGPT）: Mapは地図。Just-in-time提示はカーナビ。Gateはガードレール。
地図とガードレールだけでは、曲がる瞬間に道を間違えることがある。

## Phase B実装（2026-09-03、pilot #1の直接対応）

ChatGPTレビューの通り、範囲をこの1点だけに絞って実装した:

- `templates/scripts/check-decision-receipt.mjs`に`relatedSharedCandidates()`を追加。
  新規source fileにreceiptが無い（inconclusive）とき、`templates/diagnostics/
  check-shared-parts-used.mjs`の`extractDefinedFunctions`/`judgeSharedPartsUsed`
  （新規に作らずそのままimport）を使い、そのファイルが定義する関数のうち共有dirと
  同名のものを「💡 関連する既存共有部品の候補」として提示する
- **強制はしない**。判定結果（pass/fail/inconclusive）は変えない。Semantic Judgment
  の自動化はしていない
- 新しい重複検出ロジックは作っていない。既存Gateの判定関数を再利用しただけ

### 実装中に見つかった前提条件の欠落（Phase Bの検証で発覚）

毒テスト（`findRepoRoot`を含む一時ファイルを作り、候補が実際に提示されるか確認）を
行ったところ、最初は**候補が1件も表示されなかった**。原因は`diagnostics.json`の
`sharedDir`が`templates/scripts/lib`のみで、`findRepoRoot`の正本がある`scripts/lib`が
含まれていなかったため。さらに調査すると、`sharedDir`を配列化しても`run.mjs`の
`declaredArgs`生成と`check-shared-parts-used.mjs`のCLI引数パースが両方とも文字列
1つしか受け付けない実装で、配列化すると無言でフラグが渡らなくなる
（`run.mjs`経由の実行が既定値`shared/common/lib/shared`に戻り、全件unmeasuredに
なるリスク）と判明した。

「100年後楽できる設計」の方針で、対症療法（`--shared-dir`を1回渡すだけの一時しのぎ）
ではなく、`run.mjs`の`declaredArgs`と`check-shared-parts-used.mjs`のCLI引数パースを
両方とも配列（複数回の`--shared-dir`）に対応させ、`diagnostics.json`の`sharedDir`を
`["scripts/lib", "templates/scripts/lib"]`へ正しく配列化した。

### 検証結果

毒テスト（`findRepoRoot`を含む一時ファイル）で実際に候補提示が機能することを確認:
```
💡 関連する既存共有部品の候補（CANONICAL CHECKの材料。判定はしません）:
   - findRepoRoot() は scripts/lib/repo-root.mjs に既に定義されています
```

Gate全体の回帰確認: `templates/diagnostics/run.mjs`全17Gate中16 pass、1 unmeasured
（`check-timing-instrumented`、既知の事情で無関係）。`check-shared-parts-used`は
共有ファイル数が10→29に増え（`scripts/lib`が正しく合流）、`unmeasured`に落ちず`pass`
のまま。`check-decision-receipt --selftest`・`check-shared-parts-used --selftest`
ともに緑。`check-tracked-imports`・`check-gates-are-wired`も緑。

# 設計書: harvest漏れの機械検出（Decision Receipt → index 被覆検査）

> **到達点**: 設計完了・実装未着手。
> 設計=Fable（claude-fable-5-1）／裏取り=司令塔（web-ios-androidセッション）／日付=2026-09-14。
> 3段構えワークフロー（[FABLE-3STEP-HOWTO.md](../docs/ai-workflows/FABLE-3STEP-HOWTO.md)）の
> 手順2の産物。今回は素材が既に十分あったため手順1（会議ハーネス）は省略し、
> 地雷マップを直接Fableへ渡した。
> 実装ハンドオフ: [IMPLEMENTATION-HANDOFF-harvest-coverage-2026-09-14.md](IMPLEMENTATION-HANDOFF-harvest-coverage-2026-09-14.md)

## 用語（初出の言い換え）

- **harvest（収穫）**: セッションが踏んだ非自明な地雷・回避策を、ai-hub/index.jsonへ
  検索可能な形で書き戻すこと（[ai-hub/CLAUDE.md](../../ai-hub/CLAUDE.md)「harvestの掟」）
- **Decision Receipt（判断領収書）**: 新規ファイルを作るとき「なぜこの設計にしたか」を
  記録する仕組み。`.decision-receipts.json`に溜まる（`record-decision-receipt.mjs`）
- **fail-closed**: 分からない・確認できないときは「合格」ではなく「止める」に倒す設計
- **3値exit**: PASS(0)=合格 / FAIL(1)=測れた上での不合格 / INCONCLUSIVE(2)=測れなかった、
  の3状態を区別する規約（`templates/scripts/lib/instrument-core.mjs`）

## なぜこれが要るか（実測した事実）

2026-09-14、web-ios-androidセッションがdoin-challenge.comのApp Privacy 409実損対応
（`asc-readonly-checks.mjs`のfail-closed化・`asc-generate-privacy-answers.mjs`新設）を
実装完了させた直後、これらがai-hub/index.jsonに一切登録されていないことが判明した。

調査で確定した事実:
- サンプル15件を無作為抽出して照合したところ、**登録率は約7%（15件中1件）**
- 直近コミット（`check-orphan-worktrees.mjs`新設）も当日中に未登録のまま放置されていた
- **★最も重要な発見**: 今回の実損そのものについて、`.decision-receipts.json`には
  既に記録が残っていた（`ios-app-privacy-answer-generation`、LOCAL判定、scopePaths指定）。
  つまり「非自明と判断した記録」自体は存在しており、**index.jsonへの転記だけが漏れていた**
- harvestは`ai-hub/CLAUDE.md`の5行の文章のみに依存し、実行を強制する機械（hook・CI等）が
  一切ない。`.claude/settings.json`のフックはCLAUDE.md既読確認のPreToolUseのみ

結論: **記録すべきかの判断（意味理解）は既に人/AIがDecision Receiptとして行っている。
機械が新たに判断する必要はなく、「recorded の内容がindexから引けるか」という
被覆(coverage)の事実だけを機械検査すればよい**。これは`check-decision-receipt.mjs`と
同じハイブリッド型（判断そのものでなく、記録した事実だけを機械化する）のharvest版。

## A. 理想の体験フロー

```
[実装中] 新規.mjsを作る
  → check-decision-receipt.mjsがreceiptを要求（既存の仕組み・変更なし）
     record-decision-receipt.mjs --decision LOCAL --scope <path>
     ★ここに任意で harvest の意思を残せる（新設フラグ）:
        --harvest skip --reason "既存KBへの追記で足りる"
        --harvest kb    --ref "<正本KBパス>"
        --harvest index --ref "<index id>"

[commit前] npm run diagnostics（既存Gate）
  → check-harvest-pending.mjs（新設）が実行され:
     🟡 未収穫1件: templates/scripts/asc-generate-privacy-answers.mjs
        receipt記録日: 2026-09-14 / responsibility: ios-app-privacy-answer-generation
        → indexにpath一致なし・登録済みKB本文にもファイル名の言及なし
        → 直し方: harvesterエージェントに委任、または
          record-decision-receipt.mjs --harvest skip --reason "..."
     exit 2（測れたが未記録＝緑ではない、INCONCLUSIVE）

[harvest実行] harvesterエージェントに委任 → index登録 → doctor緑
  → 再実行すると✅ PASS（証拠: {indexId, coveredBy:'path'}）

[次セッション開始] npm run context
  → .instrument-context.md の先頭近くに「未収穫候補N件」が表示される
    （前セッションが中断しても、候補はreceiptとindexの差分から毎回再計算されるので消えない）
```

ユーザーが見る変化: 「実装したのにfind --tagで見つからない」という事故が、
**commit前と次セッション開始時の2箇所で同じ1行として突きつけられる**ようになる。
書くか、理由付きで見送るか、どちらかを選ばないと緑にならない。

## B. 統合アーキ（新しい基盤は作らない、既存3点の向きを揃える）

```
                 ┌──────────────────────────────────────────┐
                 │ .decision-receipts.json（既存・git追跡）     │  ← 「非自明」の記録源
                 │  receipts[].scopePaths / at / (新設)harvest │
                 └───────────────┬──────────────────────────┘
                                 │ 読むだけ
   変更側 → index 方向           ▼
 ┌─────────────────────────────────────────────┐        index 側 → 世界 方向
 │ templates/diagnostics/check-harvest-pending.mjs │      ┌────────────────────────────┐
 │ （新設）                                        │      │ ai-hub/bin/hub.mjs doctor   │
 │  ・候補 = receiptのscopePaths ∩ harvestScope     │      │ （拡張）未索引スキャンに    │
 │  ・被覆 = index.path一致 or 登録済KB本文に         │      │  templates/diagnostics/を   │
 │    basename出現 or harvest.status='skip'         │      │  追加＋baselineラチェット   │
 └───────┬───────────────────┬─────────────────┘      └────────────────────────────┘
         │                   │                                   ▲
   run.mjs CHECKS       context-engine                            │ harvest後に実行（既存運用）
   （commit前Gate）     （セッション開始時に描画）                  │
                                                               harvesterエージェント（既存・唯一の書き役）
```

役割分担（両方新設・拡張するが、方向は逆で責務は重ならない）:

| 場所 | 見る方向 | 問い |
|---|---|---|
| `templates/diagnostics/check-harvest-pending.mjs`（新設） | このリポの直近の変更 → index | 「非自明と記録した仕事が、索引から引けるか」 |
| `hub.mjs doctor`（既存を2行拡張） | index → 全リポのファイルシステム | 「索引が世界と整合しているか」 |

## C. 具体機構

### C-1. `templates/diagnostics/check-harvest-pending.mjs`（新設）

```
node templates/diagnostics/check-harvest-pending.mjs [対象リポ] [--since 30d] [--json] [--selftest]
```

処理:
1. `.decision-receipts.json`が無ければINCONCLUSIVE（「台帳が無い」≠「候補が無い」）
2. 候補抽出: `receipt.at`が`--since`（既定30日）以内、かつ`scopePaths`が`harvestScope`
   （既定: `templates/**`, `_docs/**`, `docs/ai-rules/**`, `scripts/{verify,check,lint}-*.mjs`。
   `diagnostics.json`の`harvestScope`キーで上書き可）に一致するもの
3. 被覆判定（候補ごと）:
   - index に `path`一致するエントリがある → PASS
   - 登録済みKBエントリの本文にそのファイルのbasenameが出現し、`verified`日付が
     `receipt.at`以降 → PASS（既存KBへの追記を正解として認める）
   - `receipt.harvest.status === 'skip'` かつ理由あり → PASS（見送りも証拠付きの緑）
   - どれでもない → INCONCLUSIVE
   - indexにpath一致はあるが`verified`が`receipt.at`より古い → INCONCLUSIVE
     （変更後の再検証が無い、という別の意味）
4. `--selftest`で8種の毒（正常系・indexなし・KB被覆・verified陳腐化・waiver理由あり/なし・
   スコープ外除外・receipts破損・index不存在）を検証
5. 判定関数`judgeHarvestCoverage(receipt, {indexEntries, readKb, repoName, now})`を
   exportし、CLIとselftestが同じ関数を使う

### C-2. `record-decision-receipt.mjs`への`--harvest`フラグ追加

```
--harvest skip  --reason "<なぜ索引不要か>"
--harvest kb    --ref "<KBパス>"
--harvest index --ref "<index id>"
```
省略時は「未決」＝checkが候補として拾う。新しい台帳は作らず、receiptに1フィールド
足すだけ。

### C-3. `hub.mjs doctor`の拡張（2点）

1. 未索引スキャン対象に`templates/diagnostics/`の`^check-.*\.mjs$`を追加
2. `--unindexed-baseline <n>`でラチェット化（初回の実測値を基準に、増えた分だけ赤）

### C-4. 配線

- `run.mjs`のCHECKS配列に登録
- `context-engine.mjs`の`## 0`直後に`## 0.5 未収穫の候補`セクション追加
  （判定ロジックは複製せず、checkを`--json`実行して描画するだけ）
- `package.json`に`check:harvest`スクリプト追加
- `ai-hub/CLAUDE.md`の「harvestの掟」末尾に1行、機械検査の存在を追記

## D. 偽陽性潰し（すべて客観条件）

| 段 | 絞り込み | 何を落とすか |
|---|---|---|
| 1 | 候補はreceipt由来のみ | ドキュメント修正・typo・設定変更 |
| 2 | harvestScope（`templates/**`等） | リポ固有の業務コード |
| 3 | KB本文へのbasename出現を被覆と認める | 既存KBへの追記という正当なharvest |
| 4 | 理由付きwaiverを緑と認める | 「index化するほどではない」判断 |
| 5 | `--since`窓（既定30日） | 過去の負債の一斉噴出 |
| 6 | 候補0件は証拠付きPASS | 「何も測っていない緑」の排除 |

## E. MVP

`check-harvest-pending.mjs`＋`run.mjs`登録＋`record-decision-receipt.mjs`の
`--harvest`フラグ、をセットで実装する（waiverが無い検査は初日から無視される）。
`context-engine`拡張・`doctor`拡張・フック機構は後回し（Phase 2以降）。

## F. 捨てた案

- **git新規ファイル全件を候補にする**: リポ固有コードまで拾い、doctorの
  「48件の常時警告で無視される」と同じ運命になる
- **diff行数・コミット文からの推定**: 閾値が意味判断の代用にならない
- **Stop/SessionEndフックで強制**: 途中で切れるセッションに効かない上、
  「通すための自明なエントリ」を書かせるリスクがある。3ヶ月運用して
  lag中央値が7日を超え続けたら、blockでなく「促すだけ」の形で再検討する
- **新しい台帳を作る**: receiptに1フィールドで足りる
- **LLMに「非自明か」を判定させる**: 判定の質をselftestで検査できない

## G. 主要な地雷

- 新設checkが初回に自分自身で赤になる（未登録）→ 実装時にindex登録・receipt記録まで
  セットで完了させる
- doctor拡張で未索引警告が急増する → baselineラチェットで「増えた分だけ赤」にする
- waiverの乱用（全部skip） → 機械では止めない。skip一覧を可視化し人が見る
- `.decision-receipts.json`が無いリポ（未導入）→ INCONCLUSIVEで止め、候補なしと
  読ませない

## 付記: 登録率35%という指標への回答

35%（28/79件）は分母が他リポの活動量に左右されるため評価指標として使えない。
代わりに使う指標:
- **receipt被覆率** = 被覆件数 ÷ harvestScope内のreceipt件数。目標100%
- **harvest lag** = receipt記録日から被覆(index verified)までの日数。目標中央値7日以内

## 未確認事項（実装時に確認すること）

- `judgeDecisionReceipt`が未知フィールド`harvest`を持つreceiptを弾かないか
  （コード上は問題ないと読めるが、selftestで固定するまで未確認）
- `run.mjs`の`declares`機構で`--scope`を複数回渡す場合の引数パーサの累積動作
- `check-symptom-index.mjs`との責務重複有無（対象が異なると判断したが、
  実装時にDecision Receiptとして記録すること）

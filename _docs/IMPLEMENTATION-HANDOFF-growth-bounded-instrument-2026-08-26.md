# 実装ハンドオフ: check-growth-bounded 計器の実装

> この1枚だけで着手できる。設計の全文は [`DESIGN-growth-bounded-instrument-2026-08-26.md`](DESIGN-growth-bounded-instrument-2026-08-26.md)（同ディレクトリ）を先に読むこと。

## スコープ（MVP。これ以上広げない）

1. `templates/diagnostics/check-growth-bounded.mjs`（新規）— Probe A（R1+R2、エスケープ2種）+ Probe B + Probe C（json-array kindのみ）
2. `growth-bounds.json`（新規、キットルート）— キット自身の2件を宣言
3. `templates/diagnostics/run.mjs`（1行追加）— CHECKS配列への登録
4. `templates/scripts/context-engine.mjs`（修正）— `--max-count`追加＋台帳500行cap＋アーカイブ＋レポート文言修正＋selftestケース追加

`file-bytes`/`git-history` kindのProbe Cロジックは工数次第で同時実装可（設計書C-3参照）。ブラウザ実行時の成長パターン検出（tsuioku型）は**別計器**として意図的に見送り済み——今回は着手しない。

## 読む順

1. `_docs/DESIGN-growth-bounded-instrument-2026-08-26.md`（設計全文）
2. `templates/diagnostics/check-timing-instrumented.mjs`（3値exit・SKIP_DIR・限界明記の様式見本）
3. `templates/diagnostics/check-large-tracked-files.mjs`（新計器と同じ置き場所の兄弟。ただし2値の旧様式なので**判定様式は真似しない**）
4. `templates/scripts/lib/instrument-core.mjs`（`EXIT`/`computeExitCode`/`formatProbeReport`/`runSelfTest`の実シグネチャを確認）
5. `templates/scripts/context-engine.mjs`（256行目付近の`git log --all`、384-399行目付近の`recordEvolution`、439行目付近の既存selftest、320行目付近のレポート文言）
6. `templates/diagnostics/run.mjs`（CHECKS配列の登録パターン、37行目のcheck-selftest-coverage）

## 着手手順

1. ブランチを切る（例: `feat/growth-bounded-instrument`）
2. TDD的に進める: まず`check-growth-bounded.mjs`の`--selftest`（設計書C-5の毒#1-10）を先に書き、`export function judgeGrowth(...)`のような純関数化されたjudge本体を後から実装して赤→緑にする（既存の`verify-android-signing-config.mjs`等が模範例）
3. `--selftest`が全緑になったら、`node templates/diagnostics/check-growth-bounded.mjs templates/scripts`のように**キット自身のtemplates/scripts/を対象にして実行**し、赤2件（context-engine.mjs:256のR1違反、recordEvolutionのR2違反）が出ることを確認する（設計書のQ4裁定＝正の対照）
4. `growth-bounds.json`をキットルートに作成し、2件を宣言
5. `context-engine.mjs`を設計書C-4のとおり修正（`MAX_LOG_COMMITS`定数化、`recordEvolution`のcap+アーカイブ、レポート320行目付近の「（全履歴）」表記修正、既存selftestへのケース追加）
6. 再度`check-growth-bounded.mjs`をキットに当てて緑になることを確認
7. `run.mjs`のCHECKS配列に1行追加して配線

## 機械的な完了判定

- `node templates/diagnostics/check-growth-bounded.mjs --selftest` → exit 0
- `node templates/diagnostics/check-growth-bounded.mjs templates/scripts` → 修正前は赤2件、修正後は緑（evidenceつき）
- `node templates/scripts/context-engine.mjs --selftest` → 既存ケース＋新規追加ケース全て緑
- `node templates/diagnostics/run.mjs .`（キットルートから）→ 新計器が一覧に出て緑
- `node templates/diagnostics/check-selftest-coverage.mjs templates/diagnostics` → 欠落本数が増えていないこと（新計器はselftest実装済みなので欠落にカウントされない）

## 地雷（詳細は設計書G項）

- run.mjsは stdout の`"(skip)"`文字列でskip判定する（`run.mjs:111`）。出力にこの文字列を含めない
- R2の検出パターンが自分自身のソースコードに正規表現リテラルとして写り込み、自己マッチする恐れ。selftestに「自分自身を走査して0件」ケースを足すこと
- `--max-count`を足すだけだとcontext-engine.mjsのレポート文言「（全履歴）」が嘘になる。文言・件数表示・既存selftestの期待値を同時に更新すること
- instrument-coreの`normalizeProbeResult`は根拠(evidence)なきpassをinconclusiveへ自動降格する。全passに`evidence`オブジェクトを必ず入れる
- Windows環境: シェル文字列を組まず`execFileSync('node', [path, dir])`の配列形で呼ぶ

## この設計を作った経緯（参考。実装には不要）

無料の会議ハーネス（tsuioku-no-kirameki.comの`meeting.mjs`）で素材集め→Fable(claude-fable-5)サブ
エージェントに設計を委譲→司令塔（Claude）が実ファイル引用を裏取り、という`council-fable`スキルの
3段構えで作られた。会議で最も強く出た指摘（「CI内の本番規模実測は非現実的」）をFableが検証し、
「合成負荷試験」と「実ファイルを読むだけの軽量実測」を区別して後者を採用する、という判断をしている。

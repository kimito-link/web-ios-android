# 実装ハンドオフ: 正本→配布先の伝播（Kit Drift Propagation）

**状態: 設計完了・実装未着手。** 本ファイルは着手手順の1枚まとめ。設計の背景・
判断根拠は`DESIGN-kit-drift-propagation-2026-09-14.md`（同じ`_docs/`配下）を参照。

- 設計: Fable（claude-fable-5-1）。裏取り: 司令塔（web-ios-androidセッション）。日付: 2026-09-14
- この1枚だけで着手できる粒度。実装は行っていない（次チャット/別モデルの仕事）
- 保存先の相互参照: 本ファイル（着手手順）← `DESIGN-kit-drift-propagation-2026-09-14.md`
  （設計・地雷マップ・用語説明はここに集約）

## ★重要: この実装がカバーする範囲（誤解防止）

この設計は**PAIRS登録済みファイルの伝播**だけを扱う。「web-ios-androidを読んで
バージョンアップして」と言われる原因のうち、tsuioku-no-kirameki.comの
ランキング列ベタ書きのような**型（ルール）の重複**はカバーしない
（それは`check-near-duplicates.mjs`とharvest-coverage設計の担当）。
実装後も「キットを読んで」の依頼が完全に不要になるわけではない。

## A. 読む順

1. 本ファイル
2. `_docs/DESIGN-kit-drift-propagation-2026-09-14.md`（設計全文。特に「0. 前提の訂正」
   ——調査で2段階の前提訂正が起きた経緯は、実装時に同じ誤りを繰り返さないために重要）
3. `_docs/instruments/check-drift.mjs`（PAIRS配列、727行。97行目がPAIRS定義開始、
   425行目にcodeOnly実装）
4. `_docs/instruments/check-drift-coverage.mjs`（登録漏れ検出、`watchedFileNames()`・
   `registeredPaths()`をexport済み）
5. `templates/scripts/lib/instrument-proof.mjs`（★codeOnlyのもう1つの既存実装、
   97行目。DESIGN文書はパスを明記していないが実際はここ。3箇所目を作らずここから
   importする）
6. `.github/workflows/verify.yml`（74行目に`VERIFY_SIBLING_REPOS: 'absent'`を
   渡しているが、受け側の2ファイルはこの変数を読んでいないことを確認済み）
7. `scripts/verify-all.mjs`（121行目`TASKS`配列。129行目・148行目でcheck-drift系を
   呼んでいる。★「CIに配線されていない」という直感は誤りだった。間接呼び出しを見落とすと
   同じ勘違いをする）
8. `ai-hub/bin/ci-audit.mjs`（Issue upsertパターンの参考実装）
9. `best-trust/data/repositories.json`（ディレクトリ名→GitHubリポ名の対応、正本）
10. `~/.claude/hooks/require-claude-md-read.mjs`（SessionStartフックのrelay型の参考）

## B. スコープ（MVP）

1. `_docs/instruments/check-drift.mjs`・`check-drift-coverage.mjs`に
   `VERIFY_SIBLING_REPOS`環境変数の反映（C-6、2行修正）
2. `templates/kit-manifest.json`生成スクリプト＋鮮度gate（C-1）
3. `templates/scripts/lib/kit-freshness-core.mjs`新設（C-2）
4. SessionStartフック（C-4）

**やらないこと（Phase 2以降）**: 週次Issue（C-5）、配布先diagnostics配線（C-3、
試験導入リポにのみ配布）。

## C. 着手手順

### C-1. 既存検査の穴埋め（最優先・最小・独立して価値がある）

`_docs/instruments/check-drift-coverage.mjs`と`check-drift.mjs`に、
`process.env.VERIFY_SIBLING_REPOS`を読む処理を追加する:

```js
// 走査したリポジトリ数がPAIRSの一意リポ数より少ない、または
// VERIFY_SIBLING_REPOS==='absent' の場合、隣接リポが存在しない実行環境と判断し
// INCONCLUSIVEにする（「範囲縮小した緑」を止める）
```

- selftestに「リポ数が縮んだら緑にしない」ケースを1件追加する
- これは既存ファイルへの小さな修正であり、DESIGN文書のC-1〜C-5より先に、
  単独でコミットして良い（今すぐ価値が出る）

### C-2. `templates/kit-manifest.json`の生成

`scripts/generate-kit-manifest.mjs`を新設し、`_docs/instruments/check-drift.mjs`の
`PAIRS`をimportして、DESIGN文書C-1のスキーマに従いJSONを生成する。
`compare`フィールドの既定は`codeOnly`。

鮮度gate`scripts/check-kit-manifest-fresh.mjs`は、`templates/README.md`にある
既存の`check-hub-page-freshness.mjs`（存在すれば）と同型で実装する
（実装時にこのファイルを先にReadして型を確認すること）。

### C-3. `templates/scripts/lib/kit-freshness-core.mjs`の新設

DESIGN文書C-2のシグネチャに従う。`codeOnly`は
`templates/scripts/lib/instrument-proof.mjs`（97行目）からimportする
（`_docs/instruments/check-drift.mjs`の425行目にも同名実装があるが、
DESIGN文書が指定するのはinstrument-proof.mjs側。どちらを使うか実装直前に
再確認し、Decision Receiptに記録すること——G地雷6番）。

走査は`_docs/instruments/check-drift-coverage.mjs`の`scanForInstruments()`を
importして再利用する。

### C-4. SessionStartフックの新設

`~/.claude/hooks/require-claude-md-read.mjs`と同じrelay型で実装する。
まずこのファイルの実装を読み、以下を確認してから着手する:
- `~/.claude/settings.json`の`SessionStart`フック登録方法
- `CLAUDE_PROJECT_DIR`環境変数がSessionStartフックで実際に渡されるか
  （DESIGN文書の未確認事項1番。渡されない場合`process.cwd()`で代替できるか確認する）

キット本体側の実体（`web-ios-android/.claude/hooks/kit-freshness-notice.mjs`）を
新設し、グローバル側からそれを呼ぶ薄い中継ファイルを`~/.claude/hooks/`に置く。
本体が見つからないPCでは素通しする（既存フックと同じfail-safe）。

出力は最大3行、1日1回に間引く（`~/.claude/.kit-freshness-last.json`に日付+cwdを
記録）。PASSかつ古いファイル0本なら無出力にする。

## 機械的な完了判定

1. `node _docs/instruments/check-drift-coverage.mjs --selftest`が、新規追加した
   「リポ数縮小で緑にしない」ケースを含めて全てPASSすること
2. `VERIFY_SIBLING_REPOS=absent node _docs/instruments/check-drift-coverage.mjs`を
   実行し、INCONCLUSIVE（exit 2）になることを実測で確認する（現在のCI環境を
   再現した状態）
3. `node scripts/generate-kit-manifest.mjs`を実行し、`templates/kit-manifest.json`が
   生成されること。既存PAIRSの全エントリがmanifestに反映されていることを確認する
4. `node scripts/check-kit-manifest-fresh.mjs`が、manifest生成直後はPASS、
   PAIRSの正本ファイルを1つ変更した状態ではFAILになることを実測で確認する
   （毒殺しテスト）
5. `kit-freshness-core.mjs`の`judgeKitFreshness()`単体で、DESIGN文書D節の
   9パターン（偽陽性潰し）に対応するselftestを実装し、全てPASSすること
6. SessionStartフックを実際にこのPC上の別プロジェクト（tsuioku-no-kirameki.com等、
   隣接している既知のPAIRS登録先）で発火させ、3行以内の出力が実際に表示されることを
   確認する
7. 新設ファイル・修正ファイルのDecision Receiptを記録し、
   `templates/scripts/check-decision-receipt.mjs`が合格すること
8. ai-hubへharvestし、`find --tag kit-drift`または類似のtriggersでヒットすること

## 地雷（DESIGN文書G節の要約、詳細はそちらを参照）

- 鶏と卵（配布先の古いコードは新しい検査を表示できない）→ SessionStartフックを
  最優先で実装する
- codeOnly比較ロジックの4箇所目を作らない。既存2箇所
  （`_docs/instruments/check-drift.mjs:425`、`templates/scripts/lib/instrument-proof.mjs:97`）
  のどちらを使うか実装時に確定し、Decision Receiptへ記録すること
- ディレクトリ名≠GitHubリポ名（`best-trust/data/repositories.json`を正として引く）
- 本設計はファイルの伝播に限定。型の重複はカバーしない（冒頭の「★重要」参照）

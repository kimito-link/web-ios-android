# 設計書: 正本→配布先の伝播（Kit Drift Propagation）

> **到達点**: 設計完了・実装未着手。
> 設計=Fable（claude-fable-5-1）／裏取り=司令塔（web-ios-androidセッション）／日付=2026-09-14。
> 3段構えワークフロー（[FABLE-3STEP-HOWTO.md](../docs/ai-workflows/FABLE-3STEP-HOWTO.md)）の
> 手順2の産物。[DESIGN-harvest-coverage-2026-09-14.md](DESIGN-harvest-coverage-2026-09-14.md)
> と同型の欠陥（機構はあるが実効しない）を扱う、対になる設計書。
> 実装ハンドオフ: [IMPLEMENTATION-HANDOFF-kit-drift-propagation-2026-09-14.md](IMPLEMENTATION-HANDOFF-kit-drift-propagation-2026-09-14.md)

## 用語（初出の言い換え）

- **正本（キット）**: このリポジトリ（web-ios-android）。`templates/`配下に他プロジェクトへ
  配る金型を持つ
- **PAIRS**: `_docs/instruments/check-drift.mjs`にある、正本ファイルと配布先コピーの
  対応表（手書き）
- **ドリフト**: 正本と配布先コピーの実コード（コメント除く）が一致しなくなった状態
- **codeOnly比較**: コメント・空行を除いた実コードだけで一致を見る比較方式
  （各リポが自分の事故コメントを書けるようにするため）

## なぜこれが要るか（実測した事実、2段階の訂正を経て確定）

ユーザーから「web-ios-androidを読んでバージョンアップして、と言っても伝わらない」という
繰り返しの指摘があった。実例: tsuioku-no-kirameki.comの`live/index.html`で、ランキング列
（ギフト/広告）が共通化されずベタ書きされたまま長期間放置されていた。

★**この設計自体は上記の実例（型の重複）を直接解決するものではない**（G節末尾に明記）。
調査の過程で見つかった、より広い構造的欠陥——「正本のファイルが更新されても、配布先の
コピーがそれを検知する保証がない」——を扱う。

### 調査で2段階の前提訂正が起きた（この経緯自体が教訓）

1. **司令塔の当初の調査結論**: 「PAIRS登録漏れを検出する仕組みが無い」
   → 実際には`check-drift-coverage.mjs`が既に実装済みだった（CANONICAL CHECK不足で
   見落としかけた。Fableに渡す前にファイルを実読して自己訂正）
2. **司令塔の訂正後の結論**: 「両検査ともCIワークフロー(.yml)に一切配線されていない」
   → Fableが実際に`.github/workflows/verify.yml`→`scripts/verify-all.mjs`の
   `TASKS`配列を読み、**既に毎push・週次cronで実行されている**ことを発見。
   司令塔が「配線」を`.yml`内の直接記述で探し、間接呼び出し（`npm run verify`経由）を
   見落としていたのが原因

### 確定した真の欠陥

CIには既に配線されているが、**CIランナーには配布先の隣接リポジトリが存在しないため、
検査が「範囲縮小した緑」を返している**:
- `check-drift`: 6ペア中1ペアだけ比較して「一致」と報告（残りは「未存在」でreport種別
  のため落ちない）
- `check-drift-coverage`: 走査対象がキット1リポに縮んでも、③の設計原則
  （走査0件を緑にしない）は「0件」ではなく「1件（縮小後）」を検出するため素通りし、
  pass を返す
- `verify.yml`は`VERIFY_SIBLING_REPOS: 'absent'`という環境変数を渡しているが、
  **受け側の`check-drift.mjs`・`check-drift-coverage.mjs`のどちらもこの変数を
  読んでいない**（実装が追いついていない、司令塔が実測で確認済み）

もう1点、発端の実例（tsuioku列のベタ書き）は**PAIRS登録ファイルではない**ため、
本設計の機構では検出できない。それは「型（ルール）の伝播」の問題であり、
`check-near-duplicates.mjs`（同リポ内の重複検出）とharvest-coverage設計
（知見の索引化）の担当。本設計は**「ファイルの伝播」に責務を限定する**。

## A. 理想の体験フロー

```
[正本が動く] templates/scripts/lib/instrument-core.mjs を修正・push
  → check-kit-manifest-fresh（新設gate）が「manifestが正本と一致するか」を検査
     未更新なら🔴 → npm run kit:manifest で再生成してcommit

[週次・キット側] kit-drift-audit.yml（新設）
  → PAIRSから配布先リポ一覧を導出 → github/<repo>配置でcheckout
  → 既存check-drift.mjs/check-drift-coverage.mjsを実行（隣接リポが実在する状態で）
  → Issue「kit-drift: 配布先の割れ」を1本upsert（放置が長い順）

[配布先・セッション開始](経路①、最重要)
  → SessionStartフックが、配布先の古いコピーに依存せず、
    キット側のコードで「今いるリポのキット由来ファイルは古いか」を判定し、
    最大3行だけ表示する。何もコピーし直さなくても届く

[配布先・commit前/CI](試験導入リポのみ、経路②)
  → npm run diagnostics のcheck-kit-freshnessが、公開manifestと自リポを照合
```

ユーザーが見る変化: 「読んで」と言わなくても、セッション開始時の3行・週次Issue・
commit前Gateの3箇所で同じ事実が届く。判断（取り込む・見送る）は人/AIに残る。

## B. 統合アーキ（3経路・1判定関数）

新しい重い基盤は作らない。既存のPAIRS・check-drift・check-drift-coverage・
ai-hub/ci-audit.mjsのIssue化パターンを薄く束ねる。

| 経路 | 誰が動かす | 見る方向 | 配布先の古さに依存するか |
|---|---|---|---|
| ①SessionStartフック（新設） | キット側コード | cwd → 隣接の正本 | **しない**（これが要） |
| ②配布先diagnostics（試験導入） | 配布先のrun.mjs | 自リポ → 公開manifest | する |
| ③週次Issue（新設） | キットCI | 正本 → 全配布先 | しない |

判定ロジックは1箇所（`kit-freshness-core.mjs`）に集約し、3経路すべてがそれを使う
（判定を複製しない、基準⑥の実践）。

案A（キット側で配布先checkout）単独: Issueは「読みに行く」もの＝読まれない実績あり
（`doctor`の48件常時警告と同じ運命）。
案B（配布先CI）単独: 配布先自身のコピーが古いので、新しい検査を表示する能力が無い
（鶏と卵）。
→ **最初の1ホップは、配布先のコピーに依存しない経路①③でしか届かない。両方作る。**

## C. 具体機構

### C-1. `templates/kit-manifest.json`（新設・commit対象）

PAIRSを唯一の入力として`generate-kit-manifest.mjs`（新設）が生成する。
basename・正本相対パス・比較方式(codeOnly/exact/manual)・SHA256・正本の最終commit日を
持つ。`copies`（配布先一覧）は書かない（第2の台帳を作らない。配布先一覧は経路③が
動的に見る）。

鮮度gate `check-kit-manifest-fresh.mjs`（新設）が、正本が動いたのにmanifestが古い
状態を検出する（既存`check-hub-page-freshness.mjs`と同型）。

### C-2. `templates/scripts/lib/kit-freshness-core.mjs`（新設・判定の正本）

```js
export function judgeKitFreshness({ localFiles, manifest, baseline, waivers, now })
```

- codeOnly比較は`instrument-proof.mjs`の既存実装をimportして使う（3箇所目を作らない、
  地雷G-6参照）
- 走査は`check-drift-coverage.mjs`の`scanForInstruments()`を再利用
- 判定順: manifest取得失敗→INCONCLUSIVE／走査0→INCONCLUSIVE／対象0本→PASS／
  baselineより悪化→FAIL／それ以外→PASS（古い本数はevidenceに必ず出す）

### C-3. `templates/scripts/check-kit-freshness.mjs`（新設・配布版CLI）

配布先の`run.mjs`のCHECKS配列に登録する。manifest取得は隣接ローカル優先、
無ければraw.githubusercontent経由。試験導入リポにのみ配布する。

### C-4. SessionStartフック（経路①、最重要）

既存の`~/.claude/hooks/require-claude-md-read.mjs`と同じrelay型。
グローバル設定からキット本体のコードを呼び出し、対象PCで隣接するweb-ios-androidの
manifestと照合する。1日1回に間引き、古いファイルが0本なら無言（毎回出る緑は
読まれなくなる、地雷D-8）。

### C-5. `kit-drift-audit.yml`（経路③、週次）

`ai-hub/bin/ci-audit.mjs`の月次Issue化パターンを流用。ディレクトリ名→GitHubリポ名の
対応は`best-trust/data/repositories.json`を正とする（末尾ハイフン差のような
食い違いが実在するため、黙って飛ばさない）。

### C-6. 既存検査の穴埋め（新機構ではなく2行修正）

`check-drift-coverage.mjs`・`check-drift.mjs`に、`VERIFY_SIBLING_REPOS`環境変数
（verify.ymlは既に渡しているが受け側が読んでいない）を反映し、走査リポ数が
PAIRSの一意リポ数より少なければINCONCLUSIVEにする。**これが「範囲縮小した緑」を
止める、最小の修正。**

## D. 偽陽性潰し（9段、すべて客観条件）

1. codeOnly比較が既定（各リポの事故コメントを許容）
2. CRLF/BOM正規化
3. `compare:'manual'`は判定対象外・理由必須（署名ゲート等）
4. baselineラチェット（悪化時のみFAIL、初回は提案のみで止まる）
5. 理由付きwaiver（`until`失効・件数上限固定）
6. 逆方向（正本が遅れている）は別節に出し「正本に寄せろ」と書かない
7. manifest取得失敗・走査0・リポ数未満→INCONCLUSIVE
8. 経路①はPASSかつ古い0本なら無出力・1日1回
9. 経路③のIssueは1本upsert、閉じられたら新規作成し前回番号を残す

## E. MVP

**C-1（manifest＋鮮度gate）＋ C-2（判定core）＋ C-4（SessionStartフック）＋
C-6（既存2検査の穴埋め）** をセットで実装する。経路①が最短で「読んでと言わなくても
伝わる」を実現し、配布先に何も入れずに動くため。

試験導入の選定基準: PAIRS登録本数が多い・実損の当事者・両方public（トークン設定不要）。
候補: **tsuioku-no-kirameki.com**（発端の当事者）・**surechigai-romi.link**
（PAIRS登録最多、過去に正本より進んでいた実績あり）。

## F. 捨てた案

- **templates/をnpmパッケージ/git submodule化**: 各リポが自分の事故コメントを
  書ける設計と両立せず、影響範囲が大きすぎる
- **配布先へ自動PR/自動上書き**: 逆方向（正本が遅れている）を機械が潰す事故が
  起きかけた実績がある
- **各ファイルにバージョン/ハッシュ埋め込み**: 第2の真実源になる。codeOnly比較は
  コメントを見ないので判定に寄与しない
- **PreToolUseフックで通知**: Edit/Writeごとに発火しノイズになる
- **全配布先へ一斉CI導入**: 影響範囲が大きすぎる。経路①③が先にあれば段階的に広げられる

## G. 主要な地雷

- 鶏と卵（配布先の古いコードは新しい検査を表示できない）→ 経路①③を先に出す
- CIランナーのパス配置がPAIRSの想定と食い違うと全部INCONCLUSIVEになる
- ディレクトリ名≠GitHubリポ名（末尾ハイフン等）→ リポジトリ台帳を正として引く
- codeOnly比較ロジックの4箇所目を作らない（既存3箇所からimportする）
- **本設計の境界（誤解防止のため実装ハンドオフの冒頭に明記すること）**: 発端の
  「ランキング列のベタ書き」は型の伝播でありファイルの伝播ではない。本機構が
  カバーするのは**PAIRS登録済みファイルの伝播に限る**。「キットを読んでバージョンアップ」
  依頼が完全に不要になるわけではない

## 未確認事項（実装時に確認すること）

- SessionStartフックが`CLAUDE_PROJECT_DIR`を環境変数で渡すか（PreToolUseでは
  使えているが未確認）
- `scanForInstruments()`を配布先リポ単体に対して走らせた実測時間
- `CI_AUDIT_TOKEN`の現在のスコープが配布先private repoのcheckoutに足りるか

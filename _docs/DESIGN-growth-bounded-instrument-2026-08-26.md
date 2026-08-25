# 設計: check-growth-bounded — 「増え続けるデータ」が性能を殺す前に赤くする計器

> 設計 = Fable（claude-fable-5サブエージェント） / 素材集め = 無料会議ハーネス（13体中5体召集・3体有効回答） /
> 裏取り = 司令塔（Claude、実ファイル引用を確認済み） / 日付 = 2026-08-26 / council-fableスキルの3段構え手順2の産物

## この設計に至った経緯

ユーザーから「計器に時間の経過の概念を入れたい」という依頼を受け、対話の中で以下の実体験が語られた：
tsuioku-no-kirameki.com（ニコ生コメント拡張）でコメント数が多いと重くなった、ChatGPTでも処理が重いと
PCが固まる。これを受けて3方向の調査（①tsuioku-no-kirameki.comの現状 ②web-ios-androidキット自身
③github/配下26リポジトリの横断調査）を実施し、実際に3リポジトリ・4件のインシデントと、キット自身の
`context-engine.mjs`に同型の穴を確認した。詳細な調査結果は無料会議ハーネスの素材とともに
`fable-brief.md`（司令塔のスクラッチパッドに保存、セッション限り）にまとめ、Fableに設計を依頼した。

## 確定した事実（実ファイルで裏取り済み）

- `templates/scripts/context-engine.mjs:256`: `git(root, ['log', '--all', '--date=iso-strict', ...])`に
  `--max-count`が無く、リポジトリの全コミット履歴を毎回読む
- 同ファイル399行目、`recordEvolution`関数: `ledger.rows.push(row)`のみで削除・アーカイブ経路が無い
  ＝進化台帳（`scripts/context-evolution.json`）は追記専用で無限成長する
- `templates/diagnostics/check-large-tracked-files.mjs`: 現在サイズのみを見る一回性チェック。
  増加トレンドは検出しない設計

## 会議ハーネスの素材（鵜呑みにせず司令塔が統合、Fableへ渡した）

批判役（groq/gpt-oss-120b）が最も強く指摘: 「CI環境で本番規模データを再現する実測は現実的でない」。
この指摘は妥当だが、Fableは「合成負荷試験」と「実在するファイルを読むだけの軽量実測」を区別し、
後者は採用（ミリ秒コストで、批判が指摘した問題を回避しつつ実効性を確保）。詳細はD項参照。

---

# A. 理想の体験フロー

追記専用の永続ストア（`rows.push` → `writeFileSync`）や全履歴走査（`git log --all`に上限なし）を
書くと、データが溜まるのを待たずに**その日のうちに赤**が出る。赤の3行規約（何が起きたか／直し方／
この検査が判定しないこと）に沿って報告する。上限を宣言したリソースは、以後実物の現在サイズが
毎回測られ、宣言したcapを超えたら赤になる。「静的に穴を塞ぐ」と「実データで超過を検知する」の両輪。

**Q1（対象範囲）の裁定**: 両方。ただし主従を明確にする——成果物は汎用テンプレ計器であり、
キット自身の2穴は「最初の適用先（正の対照）」。

**Q2（検知方式）の裁定**: 静的検査＋データ契約＋「実物の現在値」測定のハイブリッド。CI内での
合成負荷試験は全面的に切り捨て、実ファイルを読むだけの軽量実測（ミリ秒コスト）を採用する。

---

# B. 統合アーキ

```
templates/diagnostics/check-growth-bounded.mjs   ← 新規（計器本体・依存ゼロ）
  │  import { EXIT, computeExitCode, formatProbeReport, runSelfTest }
  │    from '../scripts/lib/instrument-core.mjs'
  │
  ├─ Probe A「未宣言の成長パターン検出」(静的・grep水準)
  ├─ Probe B「宣言と実装の整合」(growth-bounds.json の enforcedBy が実在するか)
  └─ Probe C「宣言 cap vs 実物の現在値」(実ファイルを読んで数える)

growth-bounds.json                               ← 新規（対象リポのルートに置く宣言ファイル。
                                                    diagnostics.json と同格の契約）
templates/diagnostics/run.mjs                    ← 1行追加（CHECKS 配列に登録）
templates/scripts/context-engine.mjs             ← 修正（キット自身の2穴を塞ぐ、C-4）
growth-bounds.json（キット自身の分）              ← キットルートに新規（自己適用の宣言）
```

呼び出し: `npm run diagnostics` → `run.mjs` → `check-growth-bounded.mjs <TARGET_DIR>`。
単体実行 `node templates/diagnostics/check-growth-bounded.mjs [dir]` と `--selftest` も可。

**Q4（導入順序）の裁定**: 計器を実装→キット自身に当てて赤2件を確認（正の対照）→キットを直す→
緑を確認→この直った状態をテンプレとして配る、の順。理由: selftestの毒は自作フィクスチャなので
「想定した毒に反応した」ことしか証明しない。キット自身の天然の穴が赤くならないなら、検出ルールが
現実とズレている証拠になる。

---

# C. 具体機構

## C-1. 静的検出ルール（Probe A）— 3本のみ

- **R1: 上限なし全履歴走査**。`log`と`--all`があり、`--max-count`/`-n`/`rev-list --count`のいずれも
  無い呼び出し。シェル文字列形と配列形（`git(['log', '--all'])`）の両方をマッチ。
- **R2: 追記専用の永続ストア**。同一識別子`X`について①`X.push(`/`X.unshift(`があり②`JSON.stringify(X`が
  `writeFileSync`等の引数に現れ③同ファイル内に切り詰め（`splice`/`shift`/`slice(-N)`/`length`比較）が
  1つも無い場合。識別子一致は正規表現の後方参照で実装。
- **R3: 台帳ファイルの未宣言**。R2該当かつgrowth-bounds.jsonに宣言が無い場合、R2の赤メッセージに
  「宣言が無い」旨を併記（独立ルールにしない）。

**この検査が判定しないこと（限界の明記）**: ランタイムの無制限ループ（tsuioku 3D会場型の事故）、
メモリ内のみのキャッシュ肥大、DB/IndexedDB/localStorageの成長は見ない。ファイル永続成長とgit履歴
走査のみを対象とする。

## C-2. growth-bounds.json のスキーマ

```jsonc
{
  "resources": [
    {
      "id": "context-evolution-ledger",
      "path": "scripts/context-evolution.json",
      "kind": "json-array",                      // "json-array" | "file-bytes" | "git-history"
      "temperature": "hot",                      // "hot"=毎実行で全読み → cap必須／"cold"=maxBytesのみ
      "maxRows": 500,
      "maxBytes": 262144,
      "enforcedBy": {
        "file": "templates/scripts/context-engine.mjs",
        "mustContain": "MAX_LEDGER_ROWS"
      },
      "onOverflow": "archive",                   // "archive" | "prune-oldest" | "reject-write"
      "note": "進化台帳。--check/--write/--record の毎回に全行を読む"
    }
  ]
}
```

置き場所: 対象リポのルート（`diagnostics.json`と同じ規約）。ファイル自体が無い場合、Probe Aの
違反が0件ならpass。違反があれば赤で、宣言ファイル作成を案内。「宣言ファイルが無ければ即赤」には
しない（F-7参照）。

## C-3. Probe B / Probe C の判定基準

- **Probe B**: `enforcedBy.file`が実在し、`mustContain`トークンがその中に実在するか。無ければ赤
  （宣言だけして実装しない、を防ぐ）。対象パスが未作成（まだ書かれていない台帳）は違反ではない。
- **Probe C**: `json-array`→`JSON.parse`して行数>maxRowsなら赤。`file-bytes`→`statSync().size`比較。
  `git-history`→実測せずProbe Bのみ（例: `mustContain: "--max-count"`）。80%到達はverdictを変えず
  evidenceに使用率のみ記録。JSON破損は inconclusive（exit 2系）。
- 走査ファイル0本→exit 2（`check-timing-instrumented.mjs:159`の前例どおり）。

## C-4. キット自身の2穴の直し方

1. `context-engine.mjs:256`: `const MAX_LOG_COMMITS = 2000;`を定数化し
   `['log', '--all', `--max-count=${MAX_LOG_COMMITS}`, ...]`に変更。同時に
   `git(root, ['rev-list', '--all', '--count'])`で総数を取り、レポート320行目の「（全履歴）」表記を
   「（直近M件／全N件）」に修正（N≤Mのときのみ「全履歴」表示を維持）。
2. `recordEvolution`（399行目付近）: `const MAX_LEDGER_ROWS = 500;`を定数化。push後に
   `rows.length > MAX_LEDGER_ROWS`なら、`activeRows()`（288行目に既存）の逆＝superseded済みの行を
   古い順に`scripts/context-evolution.archive.json`へ移す。活きた行だけで500超のときは書き込みを
   完了させた上で赤メッセージを出す（データを黙って捨てない）。アーカイブは`temperature: "cold"`で
   宣言し、5MB超は既存の`check-large-tracked-files`が拾う。
3. キットルートにgrowth-bounds.jsonを置き、上記2つを宣言。
4. context-engine.mjsの既存`--selftest`（439行目付近）に「501行の台帳を食わせるとアーカイブが動く／
   活きた行500超で赤メッセージが出る」ケースを追加。

## C-5. selftestの毒（instrument-coreのrunSelfTestに載せる）

すべて`mkdtempSync`の一時フィクスチャで行い、キットの現在状態に依存しない：

| # | 毒 | 期待 |
|---|---|---|
| 1 | `rows.push(r)` + `writeFileSync(JSON.stringify(rows))`、切り詰めなし | 赤（R2） |
| 2 | 同上 + `rows.splice(0, rows.length - MAX)`あり | 緑（偽陽性なし） |
| 3 | `git log --all`（文字列形/配列形）、max-countなし | 両形式とも赤（R1） |
| 4 | #3に`--max-count=200`を足す | 緑 |
| 5 | growth-bounds.jsonでmaxRows=10宣言し、12要素のJSON配列を実際に書く | 赤（Probe C） |
| 6 | 宣言のenforcedBy.mustContainが対象ファイルに存在しない | 赤（Probe B） |
| 7 | 違反行に`// growth-ok: 理由`注釈 | 緑（抑制が効く） |
| 8 | 空ディレクトリ／ソース0本 | exit 2 |
| 9 | 宣言ファイルのJSONが壊れている | exit 2 |
| 10 | 正の対照: 違反をちょうど1件置き、1件と数える | 件数一致 |

---

# D. 偽陽性潰しの具体ロジック

1. **同一識別子の突き合わせ**（R2の核）: 「pushがある」「writeFileSyncがある」の共起だけで赤にしない。
   `(\w+)\.push\(`で捕った識別子が`JSON.stringify(同名`に現れるときだけ対象。
2. **切り詰めイディオムの認知**: `splice`/`shift`/`slice(-N)`/`length`比較のいずれかが同一識別子に
   あれば有界とみなす。見逃す切り詰め方は注釈か宣言で救済（限界として明記）。
3. **注釈エスケープ `growth-ok: <理由>`**: 理由が空なら無効。件数はevidenceに出す。
4. **宣言エスケープ**: growth-bounds.jsonに宣言済みのリソースへの書き込みはR2対象外（Probe B/Cが
   より強い守りとして引き継ぐ）。
5. **ベースライン方式は使わない**: check-timing-instrumentedの「増えたときだけ赤」ラチェットは
   採らない（R1/R2は判定が鋭く誤検知母数が小さいため）。既定max=0・救済は注釈/宣言で十分。
6. **SKIP_DIR流用**: `check-timing-instrumented.mjs:131-143`の既存ロジックをそのまま使う。

---

# E. MVP

`templates/diagnostics/check-growth-bounded.mjs` 1ファイル + run.mjsへの1行登録 +
キットルートのgrowth-bounds.json。中身はProbe A（R1+R2、注釈・宣言エスケープ込み）とProbe C
（json-arrayの行数実測のみ）とselftest毒#1-5,7,8,10。Probe Bとfile-bytes/git-history kindは
工数次第で同時か直後（Probe Bは実装が数行なので同時を推奨）。C-4のキット修正はMVPの受け入れ条件に
含める（赤いままテンプレを配ると「計器はあるが手本が違反している」矛盾を配布することになる）。

---

# F. 捨てた案と理由

1. **CI内で本番規模の合成データを生成する負荷試験**: CI資源制約で崩れる（批判役の指摘どおり）。
   加えて脅威の発生頻度は中程度（26リポ中3リポ・4件）であり、フレーキーな重い検査を常設するコストに
   見合わない。実データを読むだけの軽量実測（Probe C）で置換。
2. **静的検査のみ（批判役の最終結論そのまま）**: 「実測」の定義を取り違えている。現存する実ファイルの
   行数を数えるコストはミリ秒で、grepをすり抜けた経路による実際の肥大を唯一捕れる層。切り捨てる
   理由がない。
3. **AST解析（babel/acorn導入）**: `templates/diagnostics/`の「依存ゼロ・Node標準APIのみ」規約に反する。
   頻度=中程度の脅威に対し、同一識別子regex+エスケープ2種で実効十分。精度不足が実証されてから再検討。
4. **ランタイムプロファイラ/`process.memoryUsage()`監視ハーネス**: clinic.js等の既存ツールがある領域で
   車輪の再発明（4基準の②違反）。メモリ内成長はこの計器のスコープ外。
5. **サイズ履歴のベースラインファイル（成長トレンド検出）**: 測定履歴を追記保存するファイル自体が
   追記専用台帳になる自己矛盾。cap宣言vs現在値で同じ事故を同じタイミングで捕れる。
6. **ブラウザ実行時の成長パターン（tsuioku型の事故）の検出**: 検出面が全く異なる（HTML/ブラウザAPI）。
   1計器に混ぜると両方が鈍る。**別計器の候補**として見送り。
7. **「宣言ファイルが無ければ即赤」**: 成長リソースを持たないリポに空宣言を強制する＝通すためだけの
   儀式を生む。違反検出時のみ宣言を要求する設計にした。

---

# G. 地雷と回避策

1. **run.mjsはstdoutの`(skip)`文字列でskip判定する**（`run.mjs:111`）。計器の出力に「(skip)」を含む
   文言を書くとexit 1でもskip扱いになり得る。→ この文字列を出力に使わない。測れないときはexit 2。
2. **check-large-tracked-files.mjsは「gitリポでない→exit 0」という2値の旧様式**。これを様式見本に
   しない。3値見本は`check-timing-instrumented.mjs`と`instrument-core.mjs`。
3. **check-selftest-coverageがdiagnostics/を数える**（`run.mjs:37`）。`--selftest`を後回しにすると
   新計器を足した瞬間にメタ検査が赤くなる。selftestは本体と同一コミットで実装。
4. **R2の自己マッチ**: 計器自身のソースに検出パターン文字列が正規表現リテラルとして含まれ、キット
   走査時に自分を違反として拾う恐れ。→ 検出パターンは文字列連結で組み立てるか、自ファイルパスを
   走査から除外。selftestに「自分自身を走査して0件」ケースを足す。
5. **instrument-coreのevidence規約**: passにevidenceを付け忘れるとnormalizeProbeResultが
   inconclusiveへ降格し、exit 2が常に出る。全passに`{走査: n, 違反: 0, ...}`を必ず入れる。
6. **selftestの原状復帰**: runSelfTestはfinallyでrestoreを呼ぶ契約。一時フィクスチャはmkdtempSync
   配下のみに書き、リポ内には一切書かない。
7. **context-engine修正の連鎖**: `--max-count`を足すだけだとレポートの「（全履歴）」表記が嘘になる
   （C-4-1参照）。文言・件数表示・既存selftestの期待値を同時に更新。台帳capも同様に、既存の
   `--selftest`（439行目付近）へケース追加を忘れない。
8. **Windows/日本語パス**: シェル文字列を組まず`execFileSync('node', [path, dir])`の配列形
   （`run.mjs:109`と同形）で呼ぶ。PowerShellに日本語を渡さない。
9. **アーカイブ移送のデータ喪失**: onOverflow=archiveの実装で「superseded済みのみ移す」条件を外すと、
   確定した学び（confirmed）が黙って冷蔵庫行きになる。活きた行の超過は赤メッセージで人に統合を促す。
10. **数値・実績の出典規約**: この設計が根拠にした「3リポ・4件」「キット2穴」等をLPやREADMEに書く
    ときは、出典コメント必須（`npm run claims:provenance`が拾う）。

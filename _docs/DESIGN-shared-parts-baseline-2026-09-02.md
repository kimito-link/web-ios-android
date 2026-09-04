# 設計書: web-ios-androidキットを「共有部品配置規約」の基準・見本にする

設計=Fable（model:"fable"サブエージェント） / 裏取り=司令塔（Claude） / 2026-09-02
council-fable 3段構えワークフローの手順2（Fable設計）の産物。手順1（会議ハーネス4体、
groq/gpt-oss-120b・nvidia/nemotron-3-ultra-550b・groq/qwen3.6-27b・groq/gpt-oss-20b）の
素材を統合したブリーフをFableへ渡し、この設計を得た。

## 発端

Architecture Map実装中、`findRepoRoot()`が複数ファイルに重複実装される実損が起きた
（CLAUDE.md基準⑤⑥が書かれた当日・同じ会話内でAI自身が破った）。ユーザーから
「/componentディレクトリを必ず作る構成にしたほうがいい」「web-ios-androidキット自身を
手本にすればいい」「それを計器の基準値にすれば」「1つずつ改良していけばいい」という
一連の発言があり、設計を会議に委ねた。

---

（以下、Fableの設計書全文。司令塔が実在裏取り済み: 参照ファイル7件・行番号・export状況・
`findRepoRoot`重複7箇所・`templates/scripts/*.mjs`の`./lib/`依存、いずれも実コードと一致）

## 0. 先に結論（必答論点4つへの回答）

| 論点 | 判定 |
|---|---|
| ①「/componentを必ず作る」は命名規約か原則か | **どちらでもなく「宣言義務」にする。** ディレクトリ名は固定しない（既定値は事実として既に4リポ以上で使われている `scripts/lib`）。ただし**宣言が無いリポは検査が緑にならない（exit 2＝測れなかった）**ので、事実上「必ず作る（必ず宣言する）」と同じ強制力を、文章ではなく機械が読む場所で得る。 |
| ② 存在チェックで終わらせない検査 | **「宣言→名前→内容」の3層**にし、最下層は関数単位の`codeOnly`ハッシュ一致で判定する。同名の定義が複数あるとき、ハッシュ一致＝「同一実装の重複（事実）」、不一致＝「同名別実装（人が判断）」と分けて出す。さらに`PAIRS`を「意図的複製の宣言表」として使い、宣言済み複製は`check-drift`が内容一致を保証する。 |
| ③ キット自身を「基準・見本」にする仕組み | CLAUDE.md＝**規範の文章**、`templates/`＝**配る金型**、に対して、今回足すのは**「キット自身が検査に合格し続けている状態そのものを、他リポが比較される基準値として公開する」**という第3の役割。実体は既存のArchitecture Map（事実スキャン）に「共有部品レイヤー」の事実を1種類追加し、`/hub/`上でキット自身の値が常に先頭行に出る形。 |
| ④ MVP | **`check-shared-parts-used.mjs`の`sharedDir`を複数宣言可能にし、同名定義の関数本体ハッシュ一致/不一致を出す拡張1本**（＋キットの`diagnostics.json`に2つ目の共有置き場を宣言）。新規ファイルは作らない。 |

## A. 理想の体験フロー

### A-1. AIが「2箇所目」を書こうとした瞬間

1. AIがArchitecture Map（`site/hub/architecture-map/`）または`npm run diagnostics`の結果を見る。
   そこに「共有部品レイヤー」の行があり、同名定義が複数ファイルにあるものが、事実（ハッシュ一致）・
   要判断（同名別実装）・宣言済み複製（PAIRS登録）に色分けされて並んでいる。
2. AIが新しく`findRepoRoot`を書こうとすると、PRE-FLIGHT（証明3点台帳）のSEARCH段階で
   `grep`／`ai-hub find`のreceiptが要る。検索すれば、共有レイヤーの行が「既に
   `scripts/lib/repo-root.mjs`がある」と答える。
3. それでも2箇所目を書いてコミットすると、`npm run diagnostics`の`check-shared-parts-used`が
   「同名定義が1件増えた（ラチェット超過）」で赤になる。赤の本文に「`scripts/lib/repo-root.mjs`と
   本体ハッシュ一致＝完全な重複です。importに置き換えてください」と直し方が出る。
4. 直すと緑に戻る。ベースラインを下げる（改善）のは自由。

### A-2. 別プロジェクトのAIが「見本」を見に来た場面

1. `kimito-skill.link/hub/`を開くと、先頭行が`web-ios-android`自身で、「宣言済み共有置き場: 2 ／
   未宣言の同名重複: 0 ／ 宣言済み複製: N（全て同期中）」と出ている。
2. 自リポの行と比べると、「宣言なし（測れていない）」「未宣言重複 7件」のように差が数字で見える。
3. 直し方は行ごとのリンク先（`templates/diagnostics/README.md`の`sharedDir`節）で足りる。

### A-3. 人間（ユーザー）の体験

「1つずつ改良していけばいい」を、ラチェットの数字が下がっていくこととして見られる。文章は増えない。

## B. 統合アーキ（コンポーネント4個・配線）

新規の基盤は作らない。既存4部品の役割を1行ずつ広げて接続するだけ。

```
① 宣言（各リポが置く）
   diagnostics.json … "sharedDir": "scripts/lib" または配列
   _docs/instruments/check-drift.mjs PAIRS … 意図的複製の宣言表（既存・変更なし）
        │ 読む
② 検査（既存のGate、1本を拡張）
   templates/diagnostics/check-shared-parts-used.mjs
     L1 宣言された置き場が実在するか（事実）
     L2 置き場の外に同名定義があるか（事実＝名前衝突）
     L3 同名定義の本体codeOnlyハッシュが一致するか（事実＝同一実装）← 拡張
   _docs/instruments/check-drift.mjs … PAIRS宣言済み複製の内容一致（既存・変更なし）
        │ 同じ判定関数をimport（コピーしない）
③ 地図（既存Architecture Mapに「共有部品レイヤー」の事実を1種類追加）
   scripts/lib/architecture-map-core.mjs … nodeにsharedRoleを注釈 ← 拡張
   scripts/lib/architecture-map-aggregate.mjs … repoにsharedParts集計を追加
   site/hub/architecture-map/ … 既存のprogressive disclosureに列を1つ足す
        │ 集計値だけ渡す
④ 基準値の公開（既存/hub/ダッシュボード）
   scripts/generate-hub-dashboard.mjs … 「共有部品」列を追加、
   web-ios-android自身を先頭行に固定表示 ← 拡張
   （hub-kit-matrix.mjsのEXCLUDED_PROJECTSは触らない。あちらは出荷ゲート12種の表で、
    キット除外の理由が別＝メモリ記録の教訓）
```

### 配線の要点（役割が重ならないことの確認）

| 既存部品 | 既存の役割 | 今回の関係 |
|---|---|---|
| `ai-hub/bin/hub.mjs doctor` | 横断知見(index.json)の整合性 | 触らない。完成後、harvestでKBエントリ登録するだけ |
| `hub-kit-matrix.mjs` | 出荷事故ゲート12種の導入有無 | 触らない（`walkFiles`を再利用するのみ）。共有部品は別レイヤー |
| `check-drift.mjs` / `check-drift-coverage.mjs` | **宣言済み**複製（PAIRS）の内容一致／登録漏れ | 触らない。本設計は**未宣言**の重複を見つける側。見つけた重複が「配布境界をまたぐ意図的複製」ならPAIRSへ登録させる＝入口と出口の関係 |
| `check-shared-parts-used.mjs` | 共有dirの外の同名定義を数える（名前のみ） | **本設計の主戦場。**複数dir・本体ハッシュ・分類を足す |
| Architecture Map | 今あるコードの現在地（事実/推測を分離） | 共有部品レイヤーの事実だけを注釈に足す。類似判定は入れない |

## C. 具体機構（コマンド／ファイル／スキーマ粒度）

### C-1. 宣言スキーマ（`diagnostics.json`、既存ファイルの1キー拡張）

```jsonc
{
  "sharedDir": "scripts/lib",
  // または
  "sharedDir": ["scripts/lib", "templates/scripts/lib"],
  "_sharedDir_why": "scripts/lib=キット専用 / templates/scripts/lib=配布物。配布境界で分かれる。"
}
```

- 読み手: `templates/diagnostics/run.mjs`の`declares: { sharedDir: '--shared-dir' }`。配列のときは
  `--shared-dir a --shared-dir b`と複数回渡す（`run.mjs`の`declaredArgs`生成を配列対応にする）。
- `check-shared-parts-used.mjs`側: 現状219-222行目で`process.argv.indexOf('--shared-dir')`が
  1個だけ拾う（司令塔が実コードで確認済み）。全出現を拾うよう変更。
- 既定値は変えない（`shared`/`common`/`lib/shared`）。
- キット自身の`diagnostics.json`（現状`"sharedDir": "templates/scripts/lib"`のみ、
  司令塔が実ファイルで確認済み）に`scripts/lib`を足す。

### C-2. 検査の出力スキーマ（`check-shared-parts-used.mjs`、`judgeSharedPartsUsed`の戻り値拡張）

```jsonc
{
  "verdict": "pass" | "fail" | "inconclusive",
  "sharedDirs": [{ "path": "scripts/lib", "exists": true, "files": 10 }],
  "duplicates": [
    {
      "name": "findRepoRoot",
      "sharedAt": "scripts/lib/repo-root.mjs",
      "at": "scripts/check-instrument-ran.mjs",
      "bodyMatch": "identical" | "different" | "unmeasured",
      "declaredInPairs": true | false
    }
  ],
  "limit": 5,
  "counts": { "identical": 3, "different": 1, "declared": 1 }
}
```

- `bodyMatch`の判定材料: 関数定義の本文を切り出し、`codeOnly()`（`templates/scripts/lib/instrument-proof.mjs`
  83行目に既にexport済み。司令塔が確認済み）で正規化してSHA-256。`hashSource()`も同ファイル99行目に既存。
  新しいハッシュ関数は書かない。
- 関数本文の切り出しはASTを使わない。`function name(`から始まり、中括弧の深さが0に戻るまで。
  文字列・テンプレートリテラル内の`{`で狂う可能性があるため、切り出しに失敗したら`unmeasured`
  （緑にも赤にも混ぜない。過去に中括弧カウントのバグで誤判定した実績があるため、同じ穴を踏まない）。
- ラチェットの対象は`identical`のみ。`different`は件数に含めない。

### C-3. 実行コマンド（全て既存。新しいnpm scriptは1本も増やさない）

| 目的 | コマンド | 期待する変化 |
|---|---|---|
| キット自身を測る | `npm run diagnostics` | `check-shared-parts-used`が`scripts/lib`+`templates/scripts/lib`の2置き場で測れる |
| 検知器が効くか | `node templates/diagnostics/check-shared-parts-used.mjs --selftest` | 毒テストに「本体一致は赤／本体不一致はラチェット外／切り出し失敗はunmeasured」の3件を追加 |
| 地図に載せる | `npm run hub:architecture-map` | nodeに`sharedRole`、repoに`sharedParts`集計が出る |
| 基準値を公開 | `npm run hub:page` → `npm run deploy:site` | `/hub/`にキット自身が先頭行で出る。**pushだけでは反映されない** |

### C-4. Architecture Mapへの注釈（`architecture-map-core.mjs`のnodeに2フィールド）

```jsonc
{
  "path": "scripts/check-instrument-ran.mjs",
  "sharedRole": "consumer" | "shared" | null,
  "sharedDuplicates": [
    { "name": "findRepoRoot", "sharedAt": "scripts/lib/repo-root.mjs", "bodyMatch": "identical" }
  ]
}
```

- `gateClassification: 'fact'|'heuristic'`と同じ流儀で、`bodyMatch`は事実、「統合すべき」は書かない。
- 判定関数は`check-shared-parts-used.mjs`から`judgeSharedPartsUsed`/`extractDefinedFunctions`をimportする。

### C-5. `/hub/`の表示（`generate-hub-dashboard.mjs`）

- 出荷ゲート表（hub-kit-matrix）とは別の表として「共有部品」を1表追加。列: 宣言置き場数 /
  未宣言の同一実装重複(identical) / 同名別実装(different) / PAIRS宣言済み複製 / 測定状態。
- 1行目は`web-ios-android`固定、2行目以降はArchitecture Mapの解析対象リポ。
- 「基準値」という語は使わず「見本（このキット自身）」と書く。

## D. 偽陽性潰しの具体ロジック（gpt-oss-120bの反論への回答を含む）

### D-1. 反論への直接回答

> 「検査対象が『存在』だけになる危険。内容一致を行うよう拡張しなければ、ルール文章化と
> 同等の失敗を再び招く」（会議・批判役 groq/gpt-oss-120b）

同意し、設計に3つの形で組み込む。

1. **存在（L1）は合格条件ではなく測定開始条件にする。** 宣言した置き場が無ければ`inconclusive`
   （緑にならない）。あっても、それだけでは何も緑にならない。緑の条件は「置き場の外に`identical`な
   同名定義がラチェット上限以下」＝内容を見た結果。
2. **内容一致の機構は既にあるものを関数粒度へ下ろす。** ファイル粒度の内容一致は`check-drift.mjs`
   （PAIRS×`codeOnly`）が実運用している。本設計はその`codeOnly`を関数本文に適用するだけ。
   120bの言う「マニフェスト＋ハッシュ比較」はPAIRS＋check-driftとして既に存在する。
3. **「テンプレートとの乖離」は本設計の対象外と明示する。** それは`check-drift`（PAIRS登録分）の
   既存責務。本設計が足すのは未宣言の重複の検出であり、役割を重ねない。

### D-2. 偽陽性のパターンと潰し方（実コードで確認済みの例つき）

| パターン | 実例（今のキットで実在・司令塔が確認済み） | 判定 | 根拠 |
|---|---|---|---|
| 同名・本体同一・配布境界の内側 | `scripts/check-instrument-ran.mjs:88`の`findRepoRoot`と`scripts/lib/repo-root.mjs:17` | **赤（identical・未宣言）**。importに置換すべき | 同一リポ内、`scripts/`は`scripts/lib`をimport可能 |
| 同名・本体同一・配布境界の**外側** | `templates/scripts/check-instrument-proof.mjs:46` / `record-instrument-proof.mjs:46` / `check-instrument-ran.mjs:88`の`findRepoRoot` | **赤（identical・未宣言）**。この3本は既に`./lib/instrument-core.mjs`をimportしている（司令塔が確認済み）ので、`templates/scripts/lib/repo-root.mjs`へ切り出せる。切り出した後、`scripts/lib/repo-root.mjs`はそのPAIRSコピーとして登録する | `scripts/lib/repo-root.mjs`のコメント「配布先で自己完結が必須のため意図的な重複を維持」は、templates/scripts/*が既にlib/へ依存している事実と食い違う（司令塔が実コードで矛盾を確認済み） |
| 同名・本体**不一致** | `_docs/instruments/check-drift.mjs:368`の`findRepoRoot(filePath)`（引数がファイル・見つからなければnullを返す） | **表示のみ・ラチェット外（different）** | 同名だが契約が違う。統合すべきかは機械で決めない |
| 同名・本体同一・**PAIRS宣言済み** | `templates/scripts/lib/instrument-proof.mjs:83`の`codeOnly`と`_docs/instruments/check-drift.mjs:301` | **緑（declared）**。同期はcheck-driftが保証 | 配布境界をまたぐ意図的複製。未登録なら本検査が`identical`として赤にする |
| 別の置き場同士（共有dirが2つ） | `scripts/lib/*` vs `templates/scripts/lib/*` | **数えない** | 両方が宣言済み置き場。C-1の配列化で解消 |
| 呼び出しを定義と誤読 | `escapeHtml(x)` | 数えない | 既存selftest⑦で固定済み |
| 他人のコード | node_modules等 | 数えない | 既存EXCLUDEDで固定済み |
| 名前が違う同目的関数 | `escapeHtml` vs `esc` | **拾えない（既知の限界）** | Architecture Map v1の「意図的に作らなかったもの」。v2条件（実害）が出るまで入れない |
| 本文切り出し失敗 | テンプレートリテラル内の`{` | `unmeasured`。緑にも赤にも入れない | 過去の中括弧カウントバグの再発防止 |

### D-3. 「宣言が嘘」への備え

`diagnostics.json`に実在しない`sharedDir`を書けば緑にできるか → できない。L1で`exists:false`は
`inconclusive`。宣言済み置き場の中に定義が0個ならそれも`inconclusive`（空ディレクトリを宣言して
通す穴を塞ぐ）。

## E. MVP（1つだけ作るなら）

**`templates/diagnostics/check-shared-parts-used.mjs`の拡張1本。新規ファイルなし。**

やること（この順・全部で1コミット）:

1. `--shared-dir`を複数回受け付ける。`run.mjs`の`declaredArgs`が配列宣言を複数フラグに展開する。
2. `judgeSharedPartsUsed`の`duplicates`各要素に`bodyMatch`を足す。本文切り出し＋`codeOnly`＋ハッシュ。
   `codeOnly`/`hashSource`は`../scripts/lib/instrument-proof.mjs`からimport
   （※実際のパスは司令塔が実装時に確認。設計時点では`templates/scripts/lib/instrument-proof.mjs`が
   正しい参照先）。
3. ラチェット対象を`identical`のみに変更。`different`は表示のみ。
4. selftestに毒3件追加（本体一致→赤／不一致→ラチェット外／切り出し失敗→unmeasured）。
5. キットの`diagnostics.json`の`sharedDir`を`["scripts/lib","templates/scripts/lib"]`にする。
6. `npm run diagnostics`を実行し、キット自身で`findRepoRoot`が`identical`として実際に出ることを
   確認してから完了報告。出なければ検知器が効いていないので完了扱いにしない。

これで得られるもの: 今回の実損（`findRepoRoot`重複）がキット自身の`npm run diagnostics`で赤になる状態。
Architecture Map・`/hub/`への表示（拡張点3・4）はMVPに含めない。理由: 検査が先、可視化は後。
可視化を先にすると「地図には出るが赤にならない」＝文章ルールと同じ失敗になる。

MVPの次の一歩（1つずつ）: ②`findRepoRoot`を`templates/scripts/lib/repo-root.mjs`へ切り出しPAIRS登録
→ ③Architecture Mapへ`sharedRole`注釈 → ④`/hub/`に見本行。

## F. 捨てた案と理由

| 案 | 出所 | 捨てた理由 |
|---|---|---|
| `/component`（固定名）を全リポに命名規約として強制 | 会議3体、ユーザー原文 | キット自身が`scripts/lib`と`templates/scripts/lib`の2置き場を配布境界という構造的理由で持つ。固定名1つに統合すると、配布物が配布先に無いファイルをimportする事故を作る。見本が最初の違反者になる規約は見本にならない |
| ディレクトリ名は完全に自由（原則のみ） | gpt-oss-120b | 「原則のみ」だと検査が測る場所を知れない＝今回の実損と同じ「文章ルール」に戻る。宣言義務で中間を取る |
| `@shared/*`論理エイリアス＋マニフェスト | qwen3.6-27b | エイリアス解決はバンドラ／tsconfig依存で、素のNode `.mjs`では動かない |
| 新しい「部品配置マニフェスト」ファイル | gpt-oss-120b | `diagnostics.json`＋`PAIRS`で既に2つの宣言表がある。3つ目を作ると「手で書く表は必ず書き忘れる」の表が1枚増える |
| リポ横断のハッシュ重複検出（全リポ×全関数） | nemotron・gpt-oss-20b | 未宣言の横断複製はまずリポ内で潰すのが先。横断はPAIRSが担当済み |
| 類似コード（名前が違う同目的）の自動判定 | 会議 | Architecture Map v1が「意図的に作らなかったもの」 |
| キットをhub-kit-matrixの行に載せて全緑を見せる | （自然に思いつく案） | EXCLUDED_PROJECTS除外の理由（「載せると偽の全緑になる」）を尊重。出荷ゲート表とは別表にする |
| git submodule配布 | gpt-oss-20b | templates/コピー方式と矛盾するため却下済み |
| Backstage等 | 会議 | 既に不採用と判断済み |

## G. 地雷と回避策

1. キット自身の`diagnostics.json`を先に直さないと、MVPの検査がキットで偽陽性を出したまま
   「見本」を名乗ることになる → E-5を必ずE-6の前に実行。
2. `different`をラチェットに含めると、通すためだけの嘘の統合が入る → ラチェット対象は`identical`のみ。
3. 本文切り出しの中括弧カウントは実際に誤判定した実績がある → 失敗時は`unmeasured`に倒す。
   selftestに「`function f(opts = {}) {…}`」を毒として入れる。
4. `templates/diagnostics/`→`templates/scripts/lib/`のimportが配布先で解決するか要確認
   （実装時に`check-drift-coverage.mjs`のcopiesとArchitecture Mapのedgesで確認する）。
5. `scripts/lib/repo-root.mjs`のコメント（「配布先で自己完結が必須」）は事実と食い違っている
   （司令塔が確認済み：templates/scripts/*は既に`./lib/`へ依存）→ 次の一歩②で切り出すとき、
   コメントごと直す。
6. Architecture Map・`/hub/`に載せるのはMVPの後。検査→地図の順を守る。
7. `/hub/`はgit pushでは反映されない（`npm run deploy:site`が必要）→ 拡張点4を実装した回は、
   本番URLを開いて見本行が出ていることまで確認して完了。
8. 「基準値」という言葉を表示に使わない。ゼロが正解ではない（配布境界がある限りPAIRS宣言済み複製は
   残る）。「見本（このキット自身）」と書く。
9. 完了後、`_docs/shared-parts-duplication-knowledge-base.md`「検査すべきは文章ではなく検査」節を
   実装済みへ更新し、`ai-hub/index.json`へharvestする。CLAUDE.mdには新しい基準⑦を足さない
   （文章を増やさない、が本設計の主張そのもの）。

### 参照した実ファイル（設計の根拠・司令塔が全て実在確認済み）

- `templates/diagnostics/check-shared-parts-used.mjs`（主戦場。`--shared-dir`単一・名前のみ・ラチェット）
- `templates/diagnostics/run.mjs`（`declares: { sharedDir }`、3値exit集計）
- `diagnostics.json`（キット自身の宣言。現状`sharedDir: "templates/scripts/lib"`のみ）
- `_docs/instruments/check-drift.mjs`（`PAIRS`・`codeOnly`・`compare`）／`check-drift-coverage.mjs`
- `templates/scripts/lib/instrument-proof.mjs`（`codeOnly`/`hashSource` export済み・意図的複製の明記）
- `scripts/lib/repo-root.mjs`／`scripts/lib/architecture-map-core.mjs`／`architecture-map-aggregate.mjs`／`hub-kit-matrix.mjs`
- `findRepoRoot`の定義箇所7箇所（司令塔が実際にgrepで確認）:
  `scripts/check-instrument-ran.mjs:88`、`scripts/generate-hub-dashboard.mjs:530`（別関数`findRepoRootFromRoot`）、
  `scripts/lib/repo-root.mjs:17`、`templates/scripts/check-instrument-proof.mjs:46`、
  `templates/scripts/check-instrument-ran.mjs:88`、`templates/scripts/record-instrument-proof.mjs:46`、
  `_docs/instruments/check-drift.mjs:368`（別実装、引数がファイルパス）
- `_docs/shared-parts-duplication-knowledge-base.md`

# 設計書：doc⇔code ドリフト検証（知見ドキュメントの実装反映を機械的に保証する）

> Fable が、無料LLM会議ハーネス（4体）の統合案を実コードで裏取りして採否判断のうえ作成。
> 作成日: 2026-07-04。関連: [automation-maximization-design.md](automation-maximization-design.md)（判断基準を踏襲）

---

## 0. 解いた問題

`_docs/` の知見ドキュメントが増えるほど、AI が実装時に全項目を横断的に拾いきれず、
**「ドキュメントには『CIで自動化できる・当てはまり度:高』と書いてあるのに、実装がどこにも無い」**
というドリフトが発生する。実例（2026-07-04 発見）:

- `pre-submission-compliance-checklist.md` (A) 表の「iOS プライバシーマニフェスト」（高）→ lint 未実装だった
- 同「UIWebView 残存」（中）→ lint 未実装だった
- 同「Data Safety 整合」（高）→ `play-fill-data-safety.mjs` 等で**実装済みだった**が、そのことがどこにも機械可読に紐づいておらず、さらにキットに `play-data-safety-template.json` が未同梱で生成スクリプトが必ず落ちる状態だった
- 同「非公開API使用」→ ドキュメント自身が「低（空振り）」と評価しており、**未実装が正しい判断**だが、その判断が記録されていなかった

つまり本当の問題は「全部実装されていない」ことではなく、
**「実装した/しない/別スクリプトで済み、の対応関係が機械検証できない」**こと。

---

## 1. 仕組み（採用した最小構成）

### 1-1. impl 注記（ドキュメント側・1行）

自動化を主張する項目の**行末**に HTML コメントを1個付ける（レンダリングには出ない）:

```
<!-- impl: templates/scripts/lint-pre-submission.mjs#privacy-manifest -->   実装参照(パス#チェック名)
<!-- impl: templates/scripts/play-fill-data-safety.mjs -->                  ファイル単位の参照
<!-- impl: none (IPA バイナリ解析が必要で grep では空振り) -->               自動化しない判断＋理由(必須)
<!-- impl: manual (...) --> / <!-- impl: runtime (...) -->                  手動/実機検証の明示
```

`#チェック名` は `lint-pre-submission.mjs` の check name（`fail()`/`ok()` の第1引数、
例 `privacy-manifest`）をそのまま使う。**既存 lint の素朴な CHECK N コメント形式は変えない**。
check name が既に安定IDとして機能しているため、ID駆動リファクタは不要。

### 1-2. 照合スクリプト（`scripts/verify-doc-impl-coverage.mjs`・キット直下）

`npm run lint:docs` で実行。exit 1 = ドリフト検出（fail-closed）。

- **RULE 1**: `_docs/*.md` の全 impl 注記について、参照先ファイルが実在し、`#マーカー` が
  そのファイル内に文字列として実在すること（チェックの削除・改名を検出）
- **RULE 2**: `pre-submission-compliance-checklist.md` の (A) 表で、当てはまり度セルに
  「高」を含む行は impl 注記必須（今回実際に起きた抜け漏れの形をそのまま検査化）
- **RULE 3**: `impl: none` は理由必須（次の AI が同じ検討を繰り返さないための地雷マップ）

### 1-3. AI ワークフロー（運用ルール）

会議案の「4段階ワークフロー + ai_impl_map.json」を次の2ステップに簡略化:

1. **知見ドキュメントに「CIで自動化できる・高」を書くとき**は、同じ行に impl 注記を書く。
   まだ実装していなければ書けない → その場で実装するか、`impl: none (理由)` で判断を明示するかを迫られる。
2. **実装・削除・改名したとき**は `npm run lint:docs` を回す。注記とコードがズレていれば exit 1。

AI の「実装しました」という自己申告は信用しない。**注記が指すマーカーがコードに実在すること**だけを信用する
（会議の批判「自己点検の信頼性が低い」への回答。ロジックの正しさ自体は従来どおり lint 本体の実行とfixtureテストで担保）。

---

## 2. 会議素材の採否

| 会議案 | 採否 | 理由 |
|---|---|---|
| YAML フロントマター + checks 配列 | **却下** | 表とフロントマターの二重管理になり、それ自体が新たなドリフト源。既存10 doc の一括メタデータ化は過剰プロセス化リスク（批判役の指摘どおり）。インライン注記なら該当行と同居し二重管理ゼロ |
| `lint-pre-submission.mjs` の ID 駆動オブジェクト化 | **却下** | check name 文字列が既に安定ID。照合は文字列実在確認で足りる。リファクタは差分巨大・回帰リスクのみで得るものがない |
| CI 照合スクリプト（verify-checklist.js 相当） | **採用（縮小）** | `scripts/verify-doc-impl-coverage.mjs` として実装。ただし全 doc 必須化はせず、注記はオプトイン + (A) 表「高」行のみ必須 |
| `ai_impl_map.json`（AI 自己生成マッピング） | **却下** | 注記がその役割を兼ねる。別ファイルはドキュメントと乖離する。自己申告よりコード側マーカー実在検証の方が強い |
| severity で必須/警告を分ける | **採用（形を変えて）** | severity 列を新設せず、既存の「当てはまり度」列を流用（高=注記必須、中以下=任意）。ドキュメント執筆のハードルを上げない |
| 小規模パイロットで段階導入 | **採用** | 今回は checklist 1 doc + 実際に見つかった抜け漏れのみ。他 doc への展開は次スコープ（§5） |

---

## 3. 今回解消した4つの抜け漏れ（裏取り結果つき）

| 項目 | 裏取り結果 | 実装 |
|---|---|---|
| PrivacyInfo.xcprivacy | `cap add ios` テンプレは app-level を**生成しない**（SDK 側同梱、capacitor#7321 = 6.0.0+）。単純な存在検査は false-fail | lint **CHECK 15** `privacy-manifest`: `@capacitor/ios` <6 → fail ／ ios/ コミット済み・マニフェストあり・pbxproj 未参照 → fail ／ コミット済み・無し → warn ／ CI 生成 + >=6 → ok |
| UIWebView 残存 | 当てはまり度は「中」（親タスクの「高」という前提は不正確）。templates 全体で 0 ヒット＝本当に未実装だった | lint **CHECK 16** `uiwebview-scan`: ios/ を走査。自前ソース（ios/App/App）ヒット → fail、Pods 等 → warn（コメント誤検知対策）。ios/ 無しは skip |
| 非公開API | ドキュメント自身が「低・空振り」と評価。IPA バイナリ解析が必要で grep 不可。キットに事故実績なし | **実装しない**（判断基準「実際に事故を起こした実績を最優先」）。`impl: none (理由)` として記録 |
| Data Safety 整合 | **実装済みだった**（CSV 生成 + API 送信 + workflow 組込み）。ただし①workflow が invoke をやめても CHECK 7 は素通り、②orphan key が warn 止まり、③キットに template.json 未同梱で生成スクリプトが即死、の3つの穴 | lint **CHECK 17** `data-safety-wiring`（workflow→スクリプトの配線検査）＋ `play-generate-data-safety-csv.mjs` の orphan key を exit 1 に fail-closed 化 ＋ `templates/scripts/lib/play-data-safety-template.json` を出典から同梱 |

---

## 4. 変更ファイル一覧

- `templates/scripts/lint-pre-submission.mjs` — CHECK 15/16/17 追加（既存スタイル踏襲、skip/warn/fail の fail-closed パターン維持）
- `templates/scripts/play-generate-data-safety-csv.mjs` — orphan key: warn → exit 1
- `templates/scripts/lib/play-data-safety-template.json` — 新規同梱（出典 partnership_program_website、アプリ非依存の Google 質問テンプレ 783 行）
- `scripts/verify-doc-impl-coverage.mjs` — 新規（照合スクリプト本体）
- `package.json` — `lint:docs` script 追加
- `_docs/pre-submission-compliance-checklist.md` — (A) 表に impl 注記 9 件 + プライバシーマニフェスト節に裏取り補正を追記

---

## 5. 次にやるべきこと（今回スコープ外・優先度順）

1. **キット自体の CI 新設**: キット直下に `.github/workflows` が無く、`lint:docs` は手動実行。
   push 時に `npm run lint:docs` + `node --check templates/scripts/*.mjs` を回す軽い workflow を1本置く。
2. **他 doc への注記展開**: `FIRST-SUBMISSION-blockers.md`（B1〜B8 は CHECK 10〜13 に実装済みのはず）と
   `CAPACITOR-GOLDEN-RULES.md`（CHECK 9 に実装済み）に impl 注記を付け、RULE 2 相当の必須化はしない（オプトインのまま）。
3. **fastlane precheck 相当の残り**（到達不能URL/禁止語/著作権年）: (A) 表で「高」だが部分実装。
   到達不能 URL 検査（contact.* に HEAD リクエスト）は API 不要で安い。
4. **`play-generate-data-safety-csv.mjs` の ANSWERS 汎用化**: 現状 partnership の回答がハードコード
   （金型として使う際に書き換え前提だが、app.config.json 駆動にできる余地あり）。
5. **ドキュメント総インデックス**: doc が 15 を超えたら `_docs/INDEX.md`（1行要約 + 実装状態）を検討。
   今は 11 doc で CLAUDE.md からの導線で足りている。

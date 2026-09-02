# 実装ハンドオフ: generate-architecture-map.mjs / generate-hub-dashboard.mjs のコンポーネント化

> 設計書: [`DESIGN-architecture-map-componentize-2026-09-02.md`](DESIGN-architecture-map-componentize-2026-09-02.md)
> このファイル1枚で着手できる粒度。読む順・着手手順・機械的な完了判定・地雷をまとめる。

## 目的（1文で）

`findRepoRoot`の重複を解消し、`generate-architecture-map.mjs`（746行）を責務ごとに
`scripts/lib/`へ分割する。**挙動は1バイトも変えない**（生成されるHTML/JSONの内容が
タイムスタンプ系フィールドを除き分割前後で完全に同一であること）。

## 読む順

1. このファイル
2. [`DESIGN-architecture-map-componentize-2026-09-02.md`](DESIGN-architecture-map-componentize-2026-09-02.md)（統合アーキ・判断根拠）
3. `scripts/generate-architecture-map.mjs`（現状把握、746行）
4. `scripts/generate-hub-dashboard.mjs`（現状把握、656行）
5. 既存の`scripts/lib/tree-view-component.mjs`（今日切り出したばかりの葉モジュールの実例）

## 着手手順（TDD的に、2〜3コミットに分ける）

### 事前準備: 基準値を取る（コミット前）

```bash
cd "C:\Users\info\OneDrive\デスクトップ\Resilio\github\web-ios-android"
node scripts/generate-architecture-map.mjs --skip-visibility-fetch
node scripts/generate-hub-dashboard.mjs --root . --out site/hub
```

生成される以下のファイルをscratchpad等へコピーして基準値として保持する:
- `.architecture-map-internal.json`
- `site/hub/architecture-map/map-data.json`
- `site/hub/architecture-map/index.html`
- `site/hub/index.html`
- `site/hub/matrix.json`
- `site/hub/hub-data.json`

### コミット1: `findRepoRoot`の重複解消

1. `scripts/lib/repo-root.mjs`を新規作成:
   ```js
   import { existsSync } from 'node:fs';
   import { dirname, join, resolve } from 'node:path';

   /**
    * ★.gitを遡ってリポジトリルートを探す。見つからなければ startDir の1つ上へfallback。
    * ★templates/scripts/配下の同名関数（配布物・PAIRSの正本）はここからimportしない。
    *   配布先で自己完結が必須のため、意図的な重複を維持する。
    */
   export function findRepoRoot(startDir) {
     let dir = startDir;
     for (let i = 0; i < 10; i++) {
       if (existsSync(join(dir, '.git'))) return dir;
       const parent = dirname(dir);
       if (parent === dir) break;
       dir = parent;
     }
     return resolve(startDir, '..');
   }
   ```
2. `scripts/generate-architecture-map.mjs`: L53-62の`findRepoRoot`定義を削除し、
   `import { findRepoRoot } from './lib/repo-root.mjs';`を追加
3. `scripts/generate-hub-dashboard.mjs`: 同名関数（L55前後）を削除し、同様にimport追加
   （`findRepoRootFromRoot`はこのファイル固有のラッパーなので**残す**）
4. 検証:
   ```bash
   npm run hub:architecture-map:selftest
   npm run hub:page:selftest
   node scripts/generate-architecture-map.mjs --skip-visibility-fetch
   node scripts/generate-hub-dashboard.mjs --root . --out site/hub
   ```
   基準値と再生成後のファイルをdiffし、`generatedAt`/`generationMs`/`fetchedAt`系フィールド
   以外の差分がゼロであることを確認
5. `git add`に**新規ファイルを含める**（`scripts/lib/repo-root.mjs`の追加忘れは
   `templates/scripts/check-tracked-imports.mjs`で検出できるが、まずは手動確認）
6. コミット

### コミット2: `generate-architecture-map.mjs`本体の分割

1. `scripts/lib/tree-view-component.mjs`に`buildTree`を追記:
   - 移動元: `generate-architecture-map.mjs`の`buildTree`関数（JSDocごと、L449-519付近）
   - **書き方の注意**: `export function buildTree(nodes) {...}`と書かない。
     平文で`function buildTree(nodes) { ... }`と宣言し、ファイル末尾で
     `export { TREE_VIEW_CSS, buildTree };`のようにまとめてexportする
     （`Function.prototype.toString()`の仕様への依存を避けるため）
   - 関数の中身（字下げ・改行・空行含む）は**バイト単位で変更しない**
   - ファイルヘッダのコメントを「CSS文字列と、クライアントJSへtoString()埋め込みする
     自己完結関数。このファイルは何も import しない」に更新

2. `scripts/lib/architecture-map-aggregate.mjs`を新規作成:
   - 移動元: `annotateNodes` / `loadAiHubPaths` / `loadPairs` / `buildDirectoryRollup` /
     `buildArchitectureMap`（JSDocごと、L64-202付近）
   - import: `existsSync, readFileSync`(node:fs), `join`(node:path), `pathToFileURL`(node:url),
     `gitSnapshot, gitTrackedFiles, scanRepoStructure, findPairsRole`(./architecture-map-core.mjs)
   - `buildArchitectureMap`内の`const { readdirSync } = await import('node:fs');`は
     **そのまま動的importのまま移す**（静的importへの書き換えは今回やらない）
   - 全関数を`export`する

3. `scripts/lib/architecture-map-public-view.mjs`を新規作成:
   - 移動元: `buildPublicView`（JSDocごと、L204-263付近）
   - **1文字も変更しない**。移動のみ
   - import: `isPublishable`(./architecture-map-visibility.mjs),
     `buildDirectoryRollup`(./architecture-map-aggregate.mjs)
   - このファイルは`node:fs`/`node:child_process`をimportしない
     （安全境界ロジックはI/Oを持たせない、という意図的な1関数1ファイル例外）

4. `scripts/generate-architecture-map.mjs`のimport文を更新:
   ```js
   import { mkdirSync, writeFileSync } from 'node:fs';
   import { dirname, join, resolve } from 'node:path';
   import { fileURLToPath, pathToFileURL } from 'node:url';
   import { classifyGate } from './lib/architecture-map-core.mjs';  // selftest用のみ
   import { fetchVisibilityFromGitHub, readVisibilityCache, writeVisibilityCache, isPublishable } from './lib/architecture-map-visibility.mjs';
   import { TREE_VIEW_CSS, buildTree } from './lib/tree-view-component.mjs';
   import { findRepoRoot } from './lib/repo-root.mjs';
   import { buildArchitectureMap, annotateNodes } from './lib/architecture-map-aggregate.mjs';
   import { buildPublicView } from './lib/architecture-map-public-view.mjs';
   ```
   - 削除した関数定義（`annotateNodes`〜`buildPublicView`、`buildTree`）はファイル本体から除去
   - ファイル末尾の`export { buildArchitectureMap, buildPublicView, annotateNodes, renderHtml };`
     は**そのまま残す**（importした束縛の再exportはESMで合法。既存の公開面を変えない）
   - selftestを1件追加: `buildTree.toString()`が`'function buildTree('`で始まり、
     `import`/`require(`/`TREE_VIEW_CSS`を含まないことを確認する毒テスト

5. 検証（コミット1と同じ手順）:
   ```bash
   npm run hub:architecture-map:selftest
   node scripts/generate-architecture-map.mjs --skip-visibility-fetch
   ```
   基準値とdiffし、`buildPublicView`部分は`git diff --color-moved=dimmed-zebra`で
   moved表示になることを確認（1文字も変わっていないことの裏取り）

6. `git add`で新規3ファイル（`architecture-map-aggregate.mjs`, `architecture-map-public-view.mjs`,
   `tree-view-component.mjs`の変更）を含める。`check-tracked-imports.mjs`を実行して確認

7. コミット・push

### コミット3（任意・小さい）: 出力HTML内のコメント修正

`renderHtml()`が出力するHTML内のコメント（現在「generate-architecture-map.mjsの同名関数を
そのまま文字列埋め込みしたもの」という説明文）を「lib/tree-view-component.mjsの同名関数を…」
に更新する。**これはコミット2の後、diff検証が終わってから別コミットで行う**
（先に直すとdiffゼロ検証にノイズが入る）。

## 機械的な完了判定

- [ ] `npm run hub:architecture-map:selftest` が exit 0
- [ ] `npm run hub:page:selftest` が exit 0
- [ ] 再生成した6ファイルが基準値と、タイムスタンプ系フィールドを除きバイト同一
- [ ] `templates/scripts/check-tracked-imports.mjs`（または相当のGate）で新規ファイルのadd忘れがない
- [ ] `git diff --color-moved` で`buildPublicView`がmoved表示（1文字も変更なし）
- [ ] push済み

## 地雷（踏むと分かりにくく壊れるもの）

1. **`export function buildTree`と書かない**: 平文宣言+末尾export。`toString()`仕様への依存を避ける
2. **改行コード**: 新規ファイルは既存ファイルと同じLF（`git ls-files --eol`で確認可能。
   このリポは全てLF）。CRLFで保存すると埋め込みHTMLのバイトが変わりdiff検証が落ちる
3. **`buildPublicView`を「ついでに」整えない**: 移動時にコメントや条件式を「読みやすく」
   したくなっても1文字も触らない。整えたければ別コミット・別レビュー
4. **`templates/`側の同名`findRepoRoot`を巻き込まない**: `templates/scripts/check-instrument-ran.mjs`・
   `templates/scripts/check-instrument-proof.mjs`・`_docs/instruments/check-drift.mjs`にも
   同名関数があるが、これらは他リポへ配布されるコピーかPAIRSの正本。
   `scripts/lib/`へのimportを持たせると配布先で壊れる
5. **新規ファイルの`git add`忘れ**: このキット自身が実際に踏んできた事故パターン
6. **`doctorWarningCount`系の差分は正常**: `scripts/lib/`にファイルが増えると
   `ai-hub/bin/hub.mjs doctor`の未登録ファイル警告件数が変わりうる。これはリファクタの
   挙動変化ではなくai-hub側の観測結果。差分がこれだけなら正常、他の差分と混ざっていないか確認する

## 転記元の実在パス一覧（司令塔が実地確認済み）

- `scripts/generate-architecture-map.mjs`（746行、現状）
- `scripts/generate-hub-dashboard.mjs`（656行、現状、`findRepoRoot`はL55前後）
- `scripts/lib/tree-view-component.mjs`（既存、`TREE_VIEW_CSS`のみ）
- `scripts/lib/architecture-map-core.mjs`（既存、無変更）
- `scripts/lib/architecture-map-visibility.mjs`（既存、無変更）
- `templates/scripts/check-tracked-imports.mjs`（実在確認済み、git add忘れ検出ゲート）
- `templates/scripts/check-instrument-ran.mjs` / `templates/scripts/check-instrument-proof.mjs` /
  `_docs/instruments/check-drift.mjs`（実在確認済み、同名`findRepoRoot`を持つが触らない対象）

## やらないこと（今回のスコープ外）

- `templates/scripts/`配下の`findRepoRoot`重複解消（配布物の自己完結が契約）
- `scripts/check-instrument-ran.mjs`の修正（PAIRSコピー、触るとcheck-driftが赤になる）
- hub-dashboardのレンダリング関数（`renderMatrixHtml`/`renderMatrixTree`）の分割
- `readdirSync`の動的importを静的importへ書き換え
- selftestをlibファイル内へ移設

実装後は非自明だった事実をメモリへ記録し、ai-hubへのharvestを検討する
（G-1/G-2の地雷は他プロジェクトでも起きうる非自明な知見）。

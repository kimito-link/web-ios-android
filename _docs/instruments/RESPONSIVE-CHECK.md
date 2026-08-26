# 出荷前にレスポンシブ設計を抜け漏れなくチェックする（AIが読む1枚）

> ★この1枚だけで着手できる粒度で書いてあります。
> 静的先取り: `verify-responsive-design.mjs` が崩れやすいCSSパターンをコード解析で検出。
> 最終確認: 実ブラウザでの実測（AIが `responsive-check` スキル、または Playwright を使う）。

---

## 0. 何をするものか

`web-ios-android` キットで作ったWebサイト・LPを、次の2段階で確認する。

1. **静的先取り**: CSS/HTMLを解析し、崩れやすい既知パターン（固定px幅・viewport欠如・
   メディアクエリ不在・overflow-x制御なし・極小フォント）をコードのまま検出する。
2. **実ブラウザ実測**: 375/768/1024/1440pxで実際に開き、横スクロール・要素の重なり・
   見切れを目視ではなく実測で確認する。**正式な判定はこちらが担う**。

```bash
node templates/scripts/verify-responsive-design.mjs           # 既定: ./site を解析
node templates/scripts/verify-responsive-design.mjs path/to/dir  # 対象ディレクトリを指定
node templates/scripts/verify-responsive-design.mjs --selftest   # 毒→赤を確認
```

---

## 1. 車輪の再発明をしない方針（CLAUDE.md「新しい機能・検査を作るときの4つの基準」）

★**「本物のブラウザでどう見えるかの判定」を自前で再実装しない。** ブラウザのレイアウト
エンジン（CSS計算・折返し・オーバーフロー処理）を静的解析で完全再現するのは車輪の再発明
であり、かつ必ずズレる。だから:

- **静的解析（このスクリプト）は「明らかに崩れやすいパターン」の先取りゲートに位置づけを絞る。**
  対象: 固定px幅・viewportメタタグ欠如・メディアクエリ不在・overflow-x制御なし・極小フォント。
- **正式な「実際にどう見えるか」の判定は、必ず実ブラウザに委ねる。** このキットでは:
  - このリポジトリで作業中のAIは [`responsive-check`](../../../../.claude/skills/responsive-check/) スキルを使う
    （375/768/1024/1440pxで実際にリサイズし、横スクロール・重なり・見切れ・文字サイズを実測する）。
  - 自動テストに組み込みたい場合は [Playwright](https://playwright.dev/)（Microsoft製・業界標準の
    ブラウザ自動化ツール）を使う。自前のヘッドレスブラウザや独自レイアウトエンジンは作らない。

---

## 2. 静的先取りが検出する項目

| id | 何を見るか | 典型的な症状 |
|---|---|---|
| `viewport-meta-missing` | `<meta name="viewport">` の有無 | モバイルで縮小表示・レイアウト崩れ |
| `viewport-zoom-disabled` | `user-scalable=no` / `maximum-scale=1` | 拡大禁止（アクセシビリティ違反） |
| `no-media-query` | 幅条件付き `@media` の有無 | そもそもレスポンシブ対応が無い |
| `fixed-large-width-px` | `width: 600px` 以上の固定px指定 | 画面幅より広いと横スクロールが発生 |
| `no-overflow-x-guard` | `html`/`body` への `overflow-x` 指定 | 意図しない横スクロールに気づきにくい |
| `font-size-too-small` | `font-size` が10px未満 | モバイルでの可読性低下 |

★**この検査の限界**（出力にも毎回明記される）:
- 静的解析のみ。JSで動的に注入されるスタイルは見ない。
- 「パターンが無い」ことは「実際に崩れない」ことを保証しない。**直した後は必ず実ブラウザで確認する**。
- 固定サイズのスクリーンショット撮影用キャンバス（`site/assets/captures/**` 等）は
  実際に配信されるページではないため解析対象から除外している
  （実測: 2026-08-25、除外前はこのキット自身の `site/` 実行で20件の誤検知が出た）。

---

## 3. 直し方（検出されたときの対応）

```css
/* 1. viewportメタタグ（HTML側） */
<meta name="viewport" content="width=device-width, initial-scale=1.0">

/* 2. 固定px幅をやめる */
.box { width: 900px; }              /* ✗ */
.box { width: 100%; max-width: 900px; }  /* ✓ */

/* 3. html/bodyへの横スクロール保険 */
html, body { overflow-x: hidden; max-width: 100%; }

/* 4. メディアクエリで幅に応じて調整 */
@media (max-width: 768px) { .box { flex-direction: column; } }
@media (max-width: 480px) { .box { padding: 8px; } }
```

★**このキット自身が過去に踏んだ地雷**（`.steps-grid` は2カラムgridのため、
直下要素は `grid-column: 1 / -1` を付けないと崩れる、等）は静的解析では拾えない
CSS Gridレイアウト固有の崩れ方。**こうした崩れは実ブラウザ実測でしか見つからない**
（＝§1で静的解析を「先取りゲート」に位置づけを絞っている理由そのもの）。

---

## 4. 完了の判定

```bash
node templates/scripts/verify-responsive-design.mjs --selftest ; echo "exit=$?"   # 0であること
node templates/scripts/verify-responsive-design.mjs                                # 静的先取りが0であること
```

その後、**必ず実ブラウザで375/768/1024/1440pxを実測**する（`responsive-check`スキルに従う）。
静的先取りが緑でも、実ブラウザ実測をせずに「完了」と報告しない
（静的解析はCSS Gridの2次崩れ・JS動的スタイル・フォント読み込みタイミングによる
レイアウトシフト等を検出できないため）。

★**exit 2（inconclusive）が出た場合は「崩れていない」ではなく「測れなかった」**。
対象ディレクトリにCSS/HTMLが1件も見つからなかった可能性が高い。

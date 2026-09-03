# site-chrome/ — 複数ページの静的サイト用、共通ヘッダー・フッターの金型

## これは何のためのものか

ビルドツールなし・素の静的HTML複数ページで構成されるサイト（LP＋ドキュメント群等）を作るとき、
ヘッダー・フッターを各ページに直接コピペすると、次の事故が起きる:

- ページごとに相対パス（`../` の深さ）が違うため、コピペのズレに気づけない
- 1つのリンクを直すのに全ページを手で直す必要があり、直し漏れが起きる
- 新しいページを増やすたびに、ヘッダーのnav項目を全ページに手で足す必要がある

★出典（2026-09-01実損）: web-ios-androidキット自身の`site/`では2026-08-22にこの方式へ移行済みだったが、
この金型が`templates/`へ一般化されていなかったため、他プロジェクト（line-bot/apps/lp配下の複数LP）が
新規サイトを作る際に再利用できず、結局ページごとに個別のheader/footerを書いてしまう事故が実際に起きた。

## 使い方（2026-09-03、Core/Config分離版）

★2026-09-02までは`site-chrome.template.js`（Core処理+ブランド値混在の単一ファイル）を
直接コピーしてブランド値を書き換える方式だった。この方式だと配布元と各サイトのファイルが
永久に一致せず、「最新版が入っているか」を機械的に検証できなかった。今回、Core（変更禁止・
全サイト共通）とConfig（サイト固有値、JSONから自動生成）を物理的に分離した。

1. `core/site-chrome.js` と `core/site-chrome.css` を対象サイトへ**無改変で**
   `site-chrome.js` / `site-chrome.css` としてコピーする（このファイルは編集しない）
2. `config/schema.json` を見ながら、対象サイト固有の `site-chrome.config.json`
   （ブランド名・ロゴ・NAV_ITEMS・ナビ折りたたみ幅`navCollapseAt`・アクセントカラー等）を書く
   （`config/example.json` がひな形）
3. `generator/generate-site-chrome-consumer.mjs --config <site-chrome.config.jsonのパス> --out <対象サイトのディレクトリ>`
   を実行する。`site-chrome.config.js` / `site-chrome.theme.css` / `site-chrome.layout.css` が
   config.jsonから決定論的に生成され、Coreファイル2点もコピーされる
4. 各ページの `<body>` 直後に `<div id="site-header"></div>`、`</body>` 直前に
   `<div id="site-footer"></div>` を置く
5. `<head>` に以下の順で読み込む（**順序を間違えると壊れる。詳細は次項参照**）:
   ```html
   <link rel="stylesheet" href="/site-chrome.css">
   <link rel="stylesheet" href="/site-chrome.theme.css">
   <link rel="stylesheet" href="/site-chrome.layout.css">
   <script src="/site-chrome.config.js"></script>
   <script src="/site-chrome.js"></script>
   ```
   パスはサイトルート相対の絶対パスに統一すること（相対パスの深さ違いが元々の事故原因）
6. ブランド色・ナビ折りたたみ幅を変える場合は `site-chrome.config.json` を直接編集し、
   generatorを再実行する（生成された`.theme.css`/`.layout.css`を手で編集しない）
7. web-ios-android固有のAI共有ボタン等、そのサイトだけの拡張機能が要る場合は
   `site-chrome.local.js`を任意で追加し、`"site-chrome:mounted"`イベントを購読する
   （Coreの末尾でこのイベントが1回発火される。plugin機構ではなく最小限の1フックのみ）

### ★CSS読み込み順の罠（2026-09-03、line-bot/apps/lp移行で実際に踏んだ事故）

`core/site-chrome.css`は`.nav-toggle { display:none }`を持ち、`site-chrome.layout.css`の
メディアクエリが折りたたみ幅以下でのみ`display:flex`に戻す作りになっている。**同じ詳細度の
CSSは後に読んだ方が勝つ**ため、読み込み順を `theme → layout → core` にすると、coreの
`display:none`がlayoutの指定を打ち消し、**ナビが常に縦展開したまま本文を押し下げる**（見た目上、
折りたたみが一切効かなくなる）。

正しい順序は **`site-chrome.css`（core）→ `site-chrome.theme.css` → `site-chrome.layout.css`**。
上記「使い方」5番の順序を必ずそのまま使うこと。

## 既存の独自デザインページへ後から導入する場合（新規サイトではなく既存ページへの追加導入）

新規サイトではなく、既にヘッダー/フッターを自前で持つ既存ページ（例: 法人営業向けLP等、
サイト内の他ページとターゲット・デザインが異なる独立ページ）へ後から共存導入するケースの手順:

- 既存ページ独自の `<footer>` タグと `site-chrome.css`/`common.css` 側の `footer` タグセレクタが
  衝突し、既存フッターのスタイルが上書きされることがある（背景色・リンク色等）。既存の
  `<footer>` に固有クラス（例: `class="lp-footer"`）を付与し、既存ページの `<style>` 側のセレクタも
  `footer` → `footer.lp-footer` のように限定して衝突を避ける
- 既存ページ独自のヘッダー（`.topbar`等）は削除せず残してよい。`<div id="site-header"></div>` は
  既存ヘッダーの直前（`<body>`直後）に置き、共通ヘッダー＋既存ヘッダーの2段構成にする
- `<div id="site-footer"></div>` と `<script src="…/site-chrome.js"></script>` は既存の `</footer>`
  タグの直後に置き、既存フッター＋共通フッターの2段構成にする
- 導入後は必ずモバイル幅・デスクトップ幅の両方でブラウザ確認し、ハンバーガーメニューの開閉と
  フッター2段が意図通り共存しているか確認する（目視だけでなく、コンソールエラー無しも確認する）

★出典（2026-09-02実施）: `web-ios-android/site/lp/index.html`（法人営業向け独立LP）への導入で、
上記の`footer`セレクタ衝突を実際に踏んで`.lp-footer`クラス分離で解決した（コミット `38b2703`）。

## 対応していないこと

- React/Next.js等、ビルドツールを使うプロジェクトはこの方式を使わない。フレームワーク標準の
  レイアウト/共通コンポーネント機構（Next.jsなら`layout.tsx`等）を使うこと
- この金型はビルドレスな静的HTML複数ページサイト専用

## 元になった実装・Canonical再編の実証記録

`web-ios-android/site/scripts/site-chrome.js`（旧・単一ファイル方式）から出発し、
2026-09-03のGPT相談を経てCore/Config/Local extension分離を設計・実装した
（`_docs/`配下に設計記録があれば参照）。

★実証第1号: `line-bot/apps/lp`（kimitotalk.link）を標準consumer
（Config/Layoutのみサイト固有）として移行し、`node scripts/rollout-plan.mjs`
（web-ios-android側の観測専用ツール）でCore JS/CSSのhash完全一致・配線100%を確認、
CURRENT判定を実測で得た（コミット`75d1de5`, 2026-09-03）。

導入判定・導入状況の機械計測（Applicability/Adoption/CURRENT-MISSING-DRIFTED-UNKNOWN）は
`web-ios-android/scripts/lib/component-rollout.mjs`と`scripts/rollout-plan.mjs`が持つ。
このコンポーネント自身の`component.json`がその判定条件の正本。

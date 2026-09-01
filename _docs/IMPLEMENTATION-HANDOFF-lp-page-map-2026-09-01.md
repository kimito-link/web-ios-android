# 実装ハンドオフ: kimito-skill.link トップページ改修（ヒーロー減量＋地図追加）

設計正本: [`DESIGN-lp-page-map-2026-09-01.md`](DESIGN-lp-page-map-2026-09-01.md)（必ず先に読む）
このリポ: `C:\Users\info\OneDrive\デスクトップ\Resilio\github\web-ios-android`

## 読む順

1. [`DESIGN-lp-page-map-2026-09-01.md`](DESIGN-lp-page-map-2026-09-01.md) 全文（会議の裁定・捨てた案の理由込み）
2. `site/index.html` の該当箇所（下記の目印文字列で検索。行番号は変わりうるので文字列検索を使う）

## スコープ（MVPから順に、2コミットに分ける）

### コミット1: ヒーロー整理

`site/index.html` 内、目印文字列で検索して編集:

1. `<div class="hero-badge-claude">` の中身（CLAUDE.md可視化バッジ、現状2行構成）を
   縮小して `<p class="hero-note">解凍して AI に渡すだけ...` の直後（既存hero-note行の後）へ
   1行ピルとして移設。文言: 「🧭 このサイトは `CLAUDE.md`（AI開発の総合ルール）の可視化です」のみ。
   対応する `.hero-badge-claude` のCSS（`<style>`内）も、大型バッジ用の指定
   （font-size 1.15rem・padding 14px 24px等）を1行ピル用の控えめな指定に書き換える。
2. `hero-badge-claude`内にあった協働実例リンク（`learnings/#multi-session`への「実例を見る」）は、
   既存の `<p class="hero-note">総合ルールの中身は → ...`行に統合する。例:
   「総合ルールの中身は → 実証知見まとめ ／ 複数AIの協働実例を見る ／ ルール原文は → CLAUDE.md」
   の3リンク構成にする。**リンク先URLは変更しない**（削除ではなく移設）。
3. `<div class="hero-pain">` 内、「どんなに良いものを作っても、ちゃんと届く形にしないと選ばれない」
   の一文（span要素）を削除する。1〜2行目（「お店（アプリストア）に出す手続きって〜」）は残す。
4. `<p class="sub">` の最終行「このキットはプログラムを作る総合ルールと、作業効率化のひな型の
   セットでもあります。」を削除する（縮小後のバッジと内容が重複するため）。他の文は残す。

編集後、必ず以下を実行:
```bash
node scripts/verify-internal-links.mjs
```
緑になったらコミット。メッセージ例: `refactor(site): ヒーローの訴求を1つの約束に絞り込む`

### コミット2: 「このページの地図」追加

1. `<div class="hint-box">...</div>` の閉じタグ直後、
   `<div data-shindan-version-summary data-report-url="check-shindan-version/report.json">`
   の直前に、設計書C-2のHTMLブロックをそのまま挿入する（コメント込み）。
2. 挿入したnav内の7つの `href="#xxx"` に対応する `id="xxx"` を、設計書C-3の対応表どおり
   既存要素に追加する（**中身は一切変更しない、id属性の追加のみ**）。特に `.claims-box` は
   `id="claims"` を追加するだけで、内部の `data-claim` 行・claim-badge等には触れない。
3. `<style>` 内に `.page-map` 用のCSSを追加（2カラムグリッド、900px以下で1カラム、
   デスクトップで4行分以内に収まる高さ）。既存の `.hint-box` や `.claims-box` のスタイルを
   参考に、白背景・角丸カードで既存セクションと視覚的に揃える。
4. 着地先7要素（`#steps` `#ai-start` `#claims` `#more` `#auto` `#showcase` `#faq`）に
   共通で `scroll-margin-top: 72px;` をCSSで付与。

編集後、必ず以下を全て実行し、全部緑になってからコミット:
```bash
node scripts/verify-internal-links.mjs
node scripts/verify-claims-coverage.mjs
npm run claims:provenance
```
メッセージ例: `feat(site): 「このページの地図」を新設しAIクローラーにも構造を伝える`

## 完了判定（機械的）

- [ ] `node scripts/verify-internal-links.mjs` が緑（新規7アンカー含む）
- [ ] `node scripts/verify-claims-coverage.mjs` が緑（claim 9件照合、ドリフトなし）
- [ ] `npm run claims:provenance` が緑（新規文言に数値ゼロなので該当なしのはず）
- [ ] ブラウザプレビュー（`preview_start` name="site"）でヒーローと地図を目視確認
      - ヒーローが1つの約束に絞られている（CLAUDE.mdバッジは小さいピルに縮小）
      - 地図の7リンクをクリックして各セクションに正しくジャンプする
- [ ] `git push` 後、`npm run deploy:site` を実行（Wranglerログインセッションが必要。
      `CLOUDFLARE_API_TOKEN`環境変数が残っていると認証エラーになるので `unset CLOUDFLARE_API_TOKEN`
      してから実行 — 2026-09-01に2度発生した既知の地雷）
- [ ] 本番URL `https://kimito-skill.link/` を開き、地図とヒーローが実際に反映されていることを
      未認証状態（WebFetch等）で確認してから完了と報告する

## 地雷（設計書Fから転記・特に見落としやすいもの）

- `.claims-box` はJS実行時描画に**絶対に変更しない**。`verify-claims-coverage.mjs`が
  `site/index.html`の静的HTML文字列を直接検索する設計のため、JS化すると検査が機能しなくなる
  （2026-09-01の前回セッションで判明済みの制約）。
- 地図の7リンクと7id要素は**同一コミット**で入れること。片方だけだと`verify-internal-links.mjs`が赤になる。
- `id="faq-title"`は改名・削除しない（他ファイルからの参照なしと確認済みだが、既存動作を壊さないため）。
- 地図の行文に数値（枚数・分数等）を書かない。書く必要が生じたら`<!-- 出典: ... -->`コメントを添える。

## 実装しないこと（設計書Eより）

- AI目次の折りたたみUI直訳
- ヒーロー直上への別のAI Summaryブロック新設
- JSON-LDへのセクション構造追加
- 地図のJSON駆動化（map.json等）
- 地図への個々のカードタイトル列挙
- 「品質より伝わり方」原則のLP内再配置（削除のみで再配置しない）

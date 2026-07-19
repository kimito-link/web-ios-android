# 実装ハンドオフ: サイト全体のページ分割によるAI認識性向上

> この1枚だけで着手できる。設計の背景・裏取り根拠は
> [`DESIGN-site-page-split-ai-discoverability-2026-07-17.md`](./DESIGN-site-page-split-ai-discoverability-2026-07-17.md) 参照。
> 実装は**まだ行っていない**。次チャット/別モデルでここから着手する。

## 読む順

1. このファイル（着手手順）
2. `DESIGN-site-page-split-ai-discoverability-2026-07-17.md`（設計の全体像・捨てた案の理由）

## スコープ（段階的に4フェーズで進める。1回のセッションで全部やらなくてよい）

### フェーズ1（前菜・独立コミット・すぐできる）
既存の全`site/**/index.html`に`meta description`＋OGPタグの定型8行を追加する。ページ分割ゼロで
即実施可能。descriptionはページごとに固有・80〜110字・そのページの意図を1文で書く（DESIGN.md §C参照）。

### フェーズ2（MVP・1PR）
1. ブランチ作成: `feat/site-page-split-ai-discoverability`
2. `site/assets/css/common.css`を新設（DESIGN.md §D参照。トークン・リセット・ヘッダー/フッター・
   カード系・ボタン・パンくず・レスポンシブ共通則）
3. `site/howto/github/index.html`・`vercel/index.html`・`domain/index.html`・
   `cloudflare/index.html`を新規作成（既存`howto/index.html`のSTEP1〜4の内容をそれぞれ移植。
   `common.css`を参照し固有スタイルは最小限）
4. `site/howto/index.html`を目次ハブに改修（各STEPの見出し・リード文・所要時間・リンクを
   `<nav aria-label="セットアップ手順">`で構成）。DESIGN.md §Bのクライアント側リダイレクトJS
   （7行）をハブ先頭に追加し、`#github`等の旧アンカーを新ページへ透過的にリダイレクトする。
   JS無効環境向けに同idの空アンカー＋リンクカードもハブに残す
5. 各サブページに前後STEPへのナビとハブへのパンくずを追加
6. 各サブページに自己canonicalとHowTo JSON-LD（DESIGN.md §Cのサンプルを流用・stepテキストは
   本文から転記、独自の宣伝文を書かない）
7. `scripts/verify-internal-links.mjs`を新規作成（`scripts/verify-claims-coverage.mjs`の設計
   思想を踏襲・依存ゼロのNode）。仕様:
   - `site/**/*.html`を走査
   - `href`/`src`の相対リンクを抽出、ディレクトリ参照は`index.html`に解決してファイル存在検証
   - `page/#anchor`形式は対象HTML内に`id="anchor"`が実在するか検証
   - フェーズ2で導入する4つのリダイレクト対象id（github/vercel/domain/cloudflare）を「予約id」
     リストに含め、ハブから消えたら検出できるようにする
   - 1件でも欠けたらexit 1（fail-closed）
8. `node scripts/verify-internal-links.mjs`と`node scripts/verify-claims-coverage.mjs`の両方を
   実行し、exit 0を確認する

### フェーズ3（次のセッションでよい）
- トップLP（`site/index.html`）の⑤却下対応・⑦知見蓄積・⑧LINE社員セクションを要約3行＋
  「詳しく→」リンクに縮小し、`troubleshooting/`・`learnings/`・`line-bot/`へ一本化
- `site/features/health-check/index.html`を新規作成（⑥けんこう診断セクションの内容を移植）
- `site/showcase/index.html`を新規作成（ショーケースセクションを昇格。トップには代表2件を残す）
- ①〜④ステップ、できること表、もっと知りたい、はトップに残す（DESIGN.md §Aの理由通り）

### フェーズ4（任意・急がない）
既存ページのCSSを触ったついでに`common.css`参照へ移行する。強制しない。

## 機械的な完了判定

- `node scripts/verify-internal-links.mjs`が exit 0
- `node scripts/verify-claims-coverage.mjs`が exit 0（既存スクリプト、トップの「できること表」を
  動かしていないことの確認を兼ねる）
- ブラウザで`howto/#github`にアクセスし、`howto/github/`へリダイレクトされることを確認
- 各新規ページのJSON-LDを[Google Rich Results Test](https://search.google.com/test/rich-results)
  等で構文検証（任意・ネットワークアクセスが要る）
- モバイル幅（375px）でレイアウト崩れがないこと

## 地雷（実装時に踏むと事故る）

- **リンク切れ検証は分割コミットと同じPRで導入する**（後付けにしない）。DESIGN.md §G-1参照
- トップの「できること表」（claims-box）は絶対に動かさない・削らない。
  `scripts/verify-claims-coverage.mjs`の前提を壊す
- Vercelの`redirects`設定でアンカー転送はできない（フラグメントはHTTPリクエストに乗らない）。
  クライアントJSが唯一の解
- JSON-LDのstepテキストは本文と一致させる（独自の宣伝文を書くとAIクローラーへの信号品質が下がる）
- 既存ページのインラインCSSは削らない。新規ページのみ`common.css`参照で開始する
- Windows環境: 検証スクリプトのパス結合は正規化し、日本語パス（デスクトップ配下）でも動くよう
  引用符必須。スクリプト内コメントは英語で書く（Shift-JIS誤読の既知地雷）

## 転記元の実在パス一覧（裏取り済み）

- `web-ios-android/site/howto/index.html`（実在・4つのアンカーid `#github`/`#vercel`/`#domain`/
  `#cloudflare`を実機確認済み）
- `web-ios-android/site/walkthrough/ios/`（実在・入れ子ディレクトリ運用の前例）
- `web-ios-android/site/troubleshooting/`・`site/learnings/`・`site/line-bot/`（すべて実在・
  ⑤⑦⑧の重複解消先）
- `web-ios-android/scripts/verify-claims-coverage.mjs`（実在・新設スクリプトの設計思想の参考元）
- `web-ios-android/site/claims.json`（実在・「できること表」の正本、動かさないこと）

## 次のアクション

**実装はここでは行わない。** 次チャット、または実装担当の別モデルに、このファイルのフルパスを渡して
「これを読んで、フェーズ1から順に着手して」と依頼する。フェーズ1のみでも即座に価値がある
（meta description/OGP追加だけで先行実施可能）。

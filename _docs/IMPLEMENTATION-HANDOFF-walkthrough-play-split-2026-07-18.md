# 実装ハンドオフ: walkthrough/play/ の分割見送り・強化

> このファイル1枚で着手できる。設計の全根拠は
> [`DESIGN-walkthrough-play-split-2026-07-18.md`](./DESIGN-walkthrough-play-split-2026-07-18.md) 参照。
> 結論: **分割しない。JSON-LD構造化＋パンくずのみ追加**（howto/型の新規ページ分割は不採用）。

## スコープ（これだけ）

対象は2ファイルのみ:
1. `site/walkthrough/play/index.html`
2. `scripts/verify-internal-links.mjs`

新規ページ・新規ディレクトリ・リダイレクトJSは**作らない**。

## 読む順

1. [`DESIGN-walkthrough-play-split-2026-07-18.md`](./DESIGN-walkthrough-play-split-2026-07-18.md) — なぜ分割しないかの全根拠（§B・§F）
2. `site/walkthrough/ios/index.html` の1〜31行目・253〜256行目 — コピー元の確立済みパターン（BreadcrumbList JSON-LD・common.css読込・視覚パンくず）
3. `site/walkthrough/play/index.html` の1〜20行目（head）・234行目付近（top-link）・末尾`<style>`ブロック・270〜590行目（step構造）
4. `scripts/verify-internal-links.mjs` の RULE 3ブロック（既存の予約idパターンの実装例）

## 着手手順

```
git checkout -b feat/walkthrough-play-structured-data
```

### Step 1: `site/walkthrough/play/index.html` の head にJSON-LD＋common.css追加

15行目 `<link rel="icon" ...>` の直後、`<style>` タグの前に挿入:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "HowTo",
      "name": "Google Play Console 追体験 — アプリ作成から審査送信まで",
      "description": "Google Play Console で人間がやる作業（アプリの枠作成〜本番審査送信）を、実画面キャプチャとURL付きで順番に案内する。",
      "totalTime": "PT30M",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "準備：キットが先に用意するもの（読むだけ）", "text": "署名済みAAB・assetlinks.json・ストア用スクショはキット（AI/CI）が先に用意する。人間は読むだけでよい。", "url": "https://web-ios-android.vercel.app/walkthrough/play/#step-0" },
        { "@type": "HowToStep", "position": 2, "name": "① アプリの枠を作る", "text": "Play Console の「アプリを作成」でアプリ名・パッケージ名を app.config.json からコピペして枠を作る。パッケージ名は後から変更不可。", "url": "https://web-ios-android.vercel.app/walkthrough/play/#step-1" },
        { "@type": "HowToStep", "position": 3, "name": "② ダッシュボードを確認", "text": "やることリストを確認する。0/5でもよく、先に③へ進んでよい。", "url": "https://web-ios-android.vercel.app/walkthrough/play/#step-2" },
        { "@type": "HowToStep", "position": 4, "name": "③ 中身（AAB）を載せる", "text": "内部テストにライブラリからAABを追加して保存する。黄色警告は無視してよい。本番公開にはまだならない。", "url": "https://web-ios-android.vercel.app/walkthrough/play/#step-3" },
        { "@type": "HowToStep", "position": 5, "name": "④ playAppId と SHA-256 をコピペしてAIに渡す", "text": "Console URL の playAppId と「アプリの署名」画面の SHA-256 を📋ボタンでコピーしてAIに渡す。スクショで渡すと指紋が切れるので厳禁。", "url": "https://web-ios-android.vercel.app/walkthrough/play/#step-4" },
        { "@type": "HowToStep", "position": 6, "name": "⑤ アプリのコンテンツ申告を順番どおり埋める", "text": "プライバシーポリシー→アクセス権→広告→データの安全性→レーティング→ターゲットユーザー→ニュース等→ストア設定の順で保存/送信する。", "url": "https://web-ios-android.vercel.app/walkthrough/play/#step-5" },
        { "@type": "HowToStep", "position": 7, "name": "⑥ 本番を審査に送信する", "text": "公開の概要で「○件の変更を審査に送信」を押す。押すまで審査は始まらない。", "url": "https://web-ios-android.vercel.app/walkthrough/play/#step-6" },
        { "@type": "HowToStep", "position": 8, "name": "⑦（条件付き）12人×14日テスト", "text": "2023年11月以降の新規個人開発者のみ。クローズドテストで12人×連続14日ののち本番アクセスを申請する。", "url": "https://web-ios-android.vercel.app/walkthrough/play/#step-7" }
      ]
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "ホーム", "item": "https://web-ios-android.vercel.app/" },
        { "@type": "ListItem", "position": 2, "name": "追体験ガイド", "item": "https://web-ios-android.vercel.app/walkthrough/" },
        { "@type": "ListItem", "position": 3, "name": "Google Play Console" }
      ]
    }
  ]
}
</script>
<link rel="stylesheet" href="../../assets/css/common.css?v=1">
```

**注意**: `step-help` はHowToStepに含めない（工程でなくトラブルシュートのため）。

### Step 2: 視覚パンくず追加＋top-link修正

234行目付近の `<a class="top-link" href="...">` を見つけて直後に追加:

```html
<nav class="breadcrumb" aria-label="パンくずリスト">
  <a href="../../">ホーム</a> ＞ <a href="../">追体験ガイド</a> ＞ Google Play Console
</nav>
```

top-linkのhrefが`../../`（トップ直行）になっていたら`../`（追体験トップ）に変更し、テキストも「← 追体験トップ」に揃える（ios/と同じ導線にする）。

### Step 3: footer衝突ガード（重要・忘れると本番で濃紺フッター帯が出る）

インライン`<style>`ブロックの末尾（`@media`ブロックの後）に1行追加:

```css
.wrap footer { background: transparent; color: inherit; text-align: left; padding: 18px 0 0; }
```

common.cssの`footer{background:#1a1a2e;color:#aaa;...}`とplay/のインラインfooterスタイルが衝突するため。**必ずブラウザで実際に確認すること**（下記「完了判定」参照）。

### Step 4: `scripts/verify-internal-links.mjs` にRULE 4追加

既存のRULE 3ブロック（150〜166行目付近、howto/の予約idパターン）を参考に、同型で「play予約id」ブロックを追加する。`RESERVED_PLAY_STEP_IDS`は`['step-0','step-1','step-2','step-3','step-4','step-5','step-6','step-7','step-help']`。存在しなければ`fail(...)`、存在すれば`ok(...)`。既存のヘルパー関数名（`fail`/`ok`/`getIdsFor`等）は実ファイルを開いて実際の関数名を確認してから使うこと（推測で書かない）。

## 完了判定（機械的に確認できるもの）

```
node scripts/verify-internal-links.mjs   # exit 0、RULE 4が新設idを検証していること
node scripts/verify-claims-coverage.mjs  # exit 0（触っていないので現状維持のはず）
```

ブラウザ確認（`/verify`スキルか手動）:
- [ ] `walkthrough/play/`を開き、パンくずが正しく表示される
- [ ] フッターが白背景のまま（濃紺帯が出ていない）
- [ ] 全スクリーンショット画像が正常表示（パス切れなし）
- [ ] コンソールエラーなし
- [ ] JSON-LDをGoogleリッチリザルトテスト（本番URL）に投入し構文エラーなし

## 地雷（実装時に踏んではいけないもの）

- `site/index.html`のclaims-box・`site/claims.json`には一切触れない
- 本文（step-0〜7・step-helpの中身）は一切変更しない。触るのはhead・footer・top-link/パンくずのみ
- common.css読込は必ずインライン`<style>`より前に置く
- HowToStepのurlは`https://web-ios-android.vercel.app/walkthrough/play/#step-N`で統一（相対URL・vercelプレビューURLを混ぜない）
- `common.css?v=1`のバージョン番号はそのまま（common.css自体は変更しない）

## 完了後にやること

- git commit → mainへマージ・push（ユーザー確認の上で）
- 知見の書き戻し: 「分割判断基準は『id構造の有無』でなく『読者の1訪問あたり消費単位がページより小さいか』」という視点を、次に似た判断が要るときのために`_docs/DESIGN-site-page-split-ai-discoverability-2026-07-17.md`か本ファイルへの参照コメントとして残す
- ios/にも同じfooter衝突ガードが潜在している可能性があるため、別途小修正を検討（今回のスコープ外）

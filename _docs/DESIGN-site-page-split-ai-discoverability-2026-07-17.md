# 設計: サイト全体のページ分割によるAI認識性向上

> 設計=Fable(claude-fable-5) ／ 素材収集=会議ハーネス(5体・1体障害で欠落) ＋ Explore実地調査 ／
> 裏取り=司令塔(Claude) ／ 日付=2026-07-17 ／
> [council-fable 3段構えワークフロー](../../COUNCIL-HOWTO.md)の手順2〜3の産物。
> 実装は**まだ行っていない**。次チャット/別モデルで着手する前提。

## お題と背景

ユーザーから「AIがなかなか認識しない」「コンテンツがまとまりすぎている」「全部個別のページにでき
るのはやってほしい」という要望。実地調査（Explore agent）で以下が判明：

- `site/index.html`（1157行）は①〜④ステップ、⑤⑥⑦⑧「おまけ」4項目、できること表、もっと知りたい、
  自動化リスト、ショーケースが1ページに詰め込まれ、JSON-LD/meta description/OGPは一切無い
- `howto/index.html`（1117行）は「STEP1 GitHub」〜「STEP4 Cloudflare」が既にid付きアンカーで
  区切られており、分割の受け皿が構造として存在する
- トップLPの⑤却下対応セクションは`troubleshooting/`と、⑧LINE社員セクションは`line-bot/`と
  内容が重複気味
- 各ページは独自の`<style>`ブロック（400〜560行規模）を内包、共通CSSファイルは無い

## 会議ハーネスで判明した対立点

統合役(gpt-oss-120b)は「分割＋canonical」「重複はリンク一本化」「CSS外部化」を裁定。批判役
(qwen3-32b)は静的HTMLサイトの制約を理由に分割自体に慎重な立場を示したが、ユーザーの明示的要望
「全部個別のページにしてほしい」と矛盾し、かつ「分割で壊れる」という技術的根拠は薄い（既存
`walkthrough/ios/`等で入れ子ディレクトリ運用の実績があり、Explore調査・司令塔裏取りの両方で
確認済み）。発散役(qwen3.6-27b)の「Intent Pollution（1URLに複数意図が混在）」という捉え方を
Fableが採用し、構造化データの欠如は症状であって根本原因ではない、という優先順位付けを行った。

## 採用する設計（Fable設計・裏取り済み）

### 骨子

「AIが認識しない」への対処を3層で同時に、ただし薄く行う：
1. **意図の分離** — howto/の4分割と、トップLPの「おまけ⑤〜⑧」の行き先整理（新規ページは最小限）
2. **構造マーカー** — 全ページにmeta description + OGP、意図が明確なページにJSON-LD
3. **配管** — 共通CSS外部化（新規ページから開始）とリンク切れ検証スクリプトのCI化

SSG・フレームワークは導入しない。

### A. サイト全体の新しいページ構成

```
site/
├── index.html                  … 既存・改修（①〜④＋要約群＋リンクハブに痩身、head強化）
├── assets/css/common.css       … 新規（トークン・共通部品）
├── howto/
│   ├── index.html              … 既存・改修（目次ハブ化＋アンカー互換リダイレクト）
│   ├── github/index.html       … 新規（旧STEP1 #github）
│   ├── vercel/index.html       … 新規（旧STEP2 #vercel）
│   ├── domain/index.html       … 新規（旧STEP3 #domain）
│   └── cloudflare/index.html   … 新規（旧STEP4 #cloudflare）
├── features/health-check/index.html … 新規（⑥けんこう診断。受け皿が存在しない唯一の項目）
├── showcase/index.html         … 新規（トップのショーケースを昇格）
├── troubleshooting/ line-bot/ learnings/ … 既存（⑤⑦⑧の詳細をここに一本化）
├── guide/ walkthrough/ lp/ story/ tax/ download/ … 既存のまま（headのみ強化）
```

### 必答論点1: トップLPの⑤⑥⑦⑧の判断（項目ごと）

| セクション | 判断 | 理由 |
|---|---|---|
| ①〜④ステップ | トップに残す | 一連の購買ファネル。分割すると訴求力が死ぬ |
| ⑤却下対応 | 重複解消（要約3行＋`troubleshooting/`へ） | 受け皿が既にあり内容重複 |
| ⑥けんこう診断 | 独立ページ化（`features/health-check/`） | 唯一受け皿が無い |
| ⑦知見蓄積 | 重複解消（要約＋`learnings/`へ） | `learnings/index.html`が既存 |
| ⑧LINE社員 | 重複解消（要約＋`line-bot/`へ） | 受け皿あり・内容重複 |
| できること表 | トップに残す | `claims.json`由来で`verify-claims-coverage.mjs`が監視。移動すると前提を壊す |
| もっと知りたい | トップに残す | 内部リンクグラフのハブとして最重要 |
| ショーケース | 独立ページ化（`showcase/`）＋トップに代表2件残す | LPの意図（導入）と事例集の意図（証拠）は別 |

トップの各要約カードは`<h3>`＋2〜3行＋「詳しく→」リンクの定型に統一。コンテンツの正本は必ず1ページに1つ。

### B. howto/分割のURL設計と互換性

- URL: `howto/github/`・`howto/vercel/`・`howto/domain/`・`howto/cloudflare/`（既存アンカーidと
  同名にして記憶コストゼロ）
- `howto/index.html`は目次ハブに改修（各STEPの見出し・リード文・所要時間・リンクを`<nav>`で並べる）
- アンカー互換: フラグメントはサーバーに送信されないためVercelのリダイレクトでは対応不能。ハブ
  ページ先頭に軽量なクライアントJSを置き、`#github`等の旧リンクを新ページへ透過的に着地させる
  （JS無効環境向けにハブ側にも同idの空アンカー＋リンクカードを残しfail-closed）
- 各サブページは**自己canonical**（分割後の各ページは独自コンテンツであり、ハブへのcanonical化は
  分割の意味を消すため不採用）
- 各サブページに前後STEPへのナビとハブへのパンくずを設置

### C. JSON-LD・meta・OGPの方針

`@type`割当: howtoハブ＝`HowTo`（4stepが各サブページを指す）／howtoサブページ＝`HowTo`＋
`BreadcrumbList`／`troubleshooting/`＝`FAQPage`／トップ＝`SoftwareApplication`または`WebSite`／
その他＝`WebPage`＋`BreadcrumbList`。

具体例（`howto/vercel/index.html`用）:
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "HowTo",
      "name": "STEP2: Vercelにサイトを公開する",
      "description": "GitHubに置いたテンプレートをVercelに接続し、Webサイトとして公開するまでの手順。",
      "totalTime": "PT10M",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Vercelにサインアップ",
          "text": "GitHubアカウントでVercelにサインアップする。",
          "url": "https://<domain>/howto/vercel/#signup" },
        { "@type": "HowToStep", "position": 2, "name": "リポジトリをインポート",
          "text": "Add New → Project からテンプレートのリポジトリを選ぶ。",
          "url": "https://<domain>/howto/vercel/#import" }
      ]
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "ホーム", "item": "https://<domain>/" },
        { "@type": "ListItem", "position": 2, "name": "セットアップ手順", "item": "https://<domain>/howto/" },
        { "@type": "ListItem", "position": 3, "name": "STEP2 Vercel" }
      ]
    }
  ]
}
</script>
```

meta/OGP定型（全ページ共通、descriptionのみページ固有・80〜110字・1意図1文）:
```html
<meta name="description" content="（ページ固有・1意図1文）">
<link rel="canonical" href="https://<domain>/howto/vercel/">
<meta property="og:type" content="article">
<meta property="og:title" content="STEP2: Vercelにサイトを公開する | Kimito-Link">
<meta property="og:description" content="（descriptionと同文で可）">
<meta property="og:url" content="https://<domain>/howto/vercel/">
<meta property="og:image" content="https://<domain>/assets/og-default.png">
<meta name="twitter:card" content="summary_large_image">
```

og:imageはサイト共通の静的1枚で開始。ページ別OG画像生成は不採用。JSON-LDの中身は本文と乖離させない。

### D. CSS外部化の方針

「共通は外部・固有はインラインのまま」の二層構成。ビッグバン移行はしない。

1. `assets/css/common.css`に入れるもの: CSSカスタムプロパティ、リセット、body基本、ヘッダー/
   フッター、カード系、ボタン、パンくず、レスポンシブ共通則
2. ページ固有スタイル（ヒーローのグラデーション等）はそのページの`<style>`に残す
3. 移行順序: **新規ページ（howto/4枚・features/health-check/・showcase/）は初日からcommon.css
   参照＋固有`<style>`最小**で書く。既存ページは触ったついでに移行（強制しない）
4. キャッシュ対策はクエリ文字列手動更新（`common.css?v=2`）で足りる。ビルド機構は導入しない

### E. MVP（最初の1つ）

**howto/の4分割一式（サブページ4枚＋ハブ改修＋アンカー互換JS＋各ページのhead定型＋HowTo
JSON-LD）を1コミット単位で。**

理由: (a) id付きアンカーで既に区切られており切り出しがほぼ機械的、(b) 「手順」はAI検索が最も
引用しやすいコンテンツ形、(c) common.cssの初出をここに置ける。

**前菜**: 既存全ページへのmeta description/OGP追加はページ分割ゼロで即日実施可能であり、MVPと
独立に先行してよい。

### F. 捨てた案と理由

| 捨てた案 | 理由 |
|---|---|
| サブページからハブへ`rel=canonical` | canonicalの誤用。サブページのインデックスを自ら殺し分割の目的と矛盾 |
| 分割せずnav強化のみ（批判役案） | ユーザーの明示要望と矛盾。技術的障害も実在しない。ただしnav強化はハブ設計に吸収済み |
| ①〜④ステップの個別ページ化 | 購買ファネルの分断。トップの存在意義が消える |
| ⑥⑦⑧の全項目新規ページ化 | ⑦⑧は正本が既にあり二重化は「正本1つ」原則に違反 |
| できること表の独立ページ化 | verify-claims-coverage.mjsのLP監視前提を壊す |
| ページ別OG画像自動生成／全CSS完全外部化／SSG導入 | 静的HTML・ビルドなしの運用感に対して過剰 |
| Vercel `redirects`でのアンカー転送 | フラグメントはHTTPリクエストに乗らないため原理的に不可能 |

### G. 地雷と回避策

1. **リンク切れ（最大の地雷）**: `scripts/verify-internal-links.mjs`を新設
   （`verify-claims-coverage.mjs`と同思想・依存ゼロのNode）。`site/**/*.html`を走査し、相対
   リンクの存在確認＋`page/#anchor`形式のid実在確認。1件でも欠けたらexit 1（fail-closed）。
   **分割コミットと同じPRで導入する**
2. **旧アンカー着地の取りこぼし**: 互換JSの対象4 idを検証スクリプトの「予約id」リストに含める
3. **verify-claims-coverage.mjsの前提破壊**: トップの「できること表」を動かさない。分割PRで
   同スクリプトも必ず実行
4. **JSON-LDと本文の乖離**: HowToのstepテキストは本文の見出し/リード文から転記し、独自の
   宣伝文を書かない
5. **CSS抽出時の見た目崩れ**: 既存ページのインラインCSSは削らず、新規ページのみcommon.css
   参照で開始
6. **Windows環境の罠**: 検証スクリプトはパス結合を正規化し、日本語パス（デスクトップ配下）
   でも動くよう引用符必須。スクリプト内コメントはShift-JIS誤読を避け英語で書く

## 実装順序（引き継ぎ用）

① 全既存ページへmeta/OGP追加（前菜・独立コミット）
→ ② common.css新設＋howto/4分割＋互換JS＋JSON-LD＋verify-internal-links.mjs（MVP・1PR）
→ ③ トップLPの⑤⑦⑧要約化とshowcase/・features/health-check/新設
→ ④ 既存ページのCSSを触ったついでに移行

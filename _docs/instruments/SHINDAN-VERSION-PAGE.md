# 各アプリ本体に「診断・進化の現在地」を出す

> 目的: 作ったプログラムごとに、必ず本体ドメインの
> **`/check-shindan-version/`** を持たせる。
>
> 例:
> - `https://soushin-suggest.link/check-shindan-version/`
> - `https://app.reply-suggest.link/check-shindan-version/`

## 1. 何を表示するか

同じレポートから、確認用とユーザー用を同時に作ります。

1. **ユーザー用** — メインLPの「バージョンアップ情報」。版・進捗・最近の実測を短く表示
2. **開発・確認用** — `/check-shindan-version/`。計器ごとの根拠、未計測、要対応、次の一手まで表示

進捗率は品質の点数ではありません。確認できた節目だけを分母・分子で表示します。
「測れなかった」は 0 点や合格に丸めず、黄色の**未計測**として残します。

各項目には根拠と次の一手も出ます。したがって、数字だけ見て終わらず、
どこを進めればよいかがページ上で分かります。

## 2. 新しいアプリでは自動で作られる

Next.js App Router の金型には、次の実体が同梱されています。

```text
app/check-shindan-version/page.tsx
app/check-shindan-version/shindan-version.module.css
public/check-shindan-version/report.json
scripts/update-shindan-version.mjs
```

共通生成器は `scripts/generate-shindan-version.mjs` です。
`setup-new-app.mjs` が初期ページを作り、Next.js の `prebuild` がビルド前に更新します。

```bash
# 全計器を実行し、診断ページも更新する
npm run shindan

# すでにある計器レポートと台帳から、ページだけ更新する
npm run shindan:update
```

Next.js 本体がリポ直下でも `apps/web/` 配下でも、薄い入口が位置を判定して共通生成器を呼びます。
Next.js金型のトップページには `ShindanVersionSummary` も同梱され、同じ `report.json` を読みます。

## 3. 静的サイトにも同じURLを作る

Next.js でなければ、生成器は公開ルートを `public/` → `site/` → `src/` の順で探し、
`check-shindan-version/index.html` と `report.json` を生成します。

```bash
node scripts/generate-shindan-version.mjs --measure

# 公開ルートを明示する場合
node scripts/generate-shindan-version.mjs --measure --out public/check-shindan-version
```

これで静的サイトでも `/check-shindan-version/` がそのまま開きます。
生成される `summary.js` をメインLPから読み、次のスロットを置けば、同じレポートを
ユーザー向けのバージョンアップ情報として表示できます。

```html
<div data-shindan-version-summary
     data-report-url="/check-shindan-version/report.json"></div>
<script src="/check-shindan-version/summary.js" defer></script>
```

## 4. 公開する情報の境界

公開レポートに含めるのは、アプリ名、版、短いcommit、計器の状態、件数、
公開してよい指標の値です。

次は含めません。

- `.env`、トークン、鍵、証明書の本文
- ローカルの絶対パス
- 診断コマンドの生ログ
- 会話だけに残る判断や、証拠のない推測

## 5. 完了の判定

```bash
node scripts/generate-shindan-version.mjs --selftest
npm run shindan
```

確認すること:

- 本体URLの `/check-shindan-version/` が 200 で開く
- 緑・黄・赤・未計測が視覚的に区別できる
- 進捗の分子と分母が表示される
- 未計測が「完了」に数えられていない
- 各未完了項目に「次」が表示される
- 秘密情報や絶対パスがページと `report.json` に出ていない

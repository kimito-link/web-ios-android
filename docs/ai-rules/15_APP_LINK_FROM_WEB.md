# 15_APP_LINK_FROM_WEB — アプリがある Web サービスには、必ずアプリへの導線を入れる（全プロジェクト共通）

> **今の到達点: 採用（2026-11-22）。CLAUDE.md 冒頭「★★アプリがある Web にはアプリへの導線」の正本。**
> 役割: iPhone / Android のアプリがある Web サービス（LP・サイト・Web 版アプリの画面）には、**自分のアプリの App Store と Google Play への導線**を
> 必ず置く。公開中なのに無ければ、提出前の点検と週1の見張りが止める・知らせる。
> なぜ要るか: りんくの指示（2026-11-22「web系のもので、アプリがあるものは必ずアプリへの導線を入れて欲しい」）。
> 同じ日に本番を開いて数えたら、ストアに出ているアプリ（10サービス）のうち、Web のトップに自分のアプリへのリンクがそろっていたのは3件だけだった。
> 関連: [07_GROWTH_METRICS.md](07_GROWTH_METRICS.md)（北極星 LTV÷CPA）／[10_STORE_FIELDS.md](10_STORE_FIELDS.md)（ストア側の欄）／
> 入れ方の金型 [`templates/web/`](../../templates/web/README.md)／根拠の KB [`_docs/web-to-app-install-best-practices.md`](../../_docs/web-to-app-install-best-practices.md)。

## 0. 一言でいうと

**Web に来た人を、アプリに連れて行ける形にしておく。** 公式バッジ（App Store・Google Play）を、端末に合わせて出し分けて置き、
iPhone の Safari には `<meta name="apple-itunes-app">` の1行で純正バナーを出す。

## 1. なぜ事業に効くか（07 の物差しで）

| 物差し | 効き方 |
|---|---|
| CPA（下げたい） | 検索・SNS・紹介で Web に来た人は、広告費ゼロで来た人。そこからアプリに送れれば、アプリの入手単価がそのぶん下がる |
| LTV（上げたい） | アプリはホーム画面のアイコン・通知で戻ってこられる。Web だけの人より続きやすい |
| ストア順位 | ストア外から来た入手もダウンロード数に数えられ、ストア内の順位・検索の露出につながる |
| ガードレール | Web だけで用が済む人を邪魔しない。全画面をふさぐ「アプリを入れて」は出さない（Google 検索の評価も下がる） |

## 2. 決まり

1. **対象**: iPhone か Android のアプリがストアで公開中のサービスの Web すべて（LP・本体サイト・Web 版アプリの画面）。最低でもトップページ。
   公開前のストアは問わない（リンクが 404 になる）。公開されたら、その日から入れる。
2. **置くもの**（金型 [`templates/web/`](../../templates/web/README.md) をそのまま使う）:
   - 公式バッジ（自作のボタンにしない・画像を変えない・Google を Apple より小さくしない）
   - 端末で出し分け（iPhone→App Store だけ／Android→Google Play だけ／PC→両方）
   - iPhone の Safari 用バナー `<meta name="apple-itunes-app" content="app-id=<ascAppId>, app-argument=<そのページのURL>">`
     （Next.js なら `metadata.itunes.appId`）
3. **置き場所**: ファーストビューに固執しない。機能の説明・利用者の声・プライバシーの説明のあとに置き、長いページでは同じ導線をくり返す。
   スマホでは画面下に小さく固定してもよい（全画面をふさがない）。詳しくは KB §2。
4. **アプリの中では出さない**（Capacitor・WebView で開いているときは隠す。金型がそうする）。
5. **リンクは自分のアプリの ID で**。同じ運営のほかのアプリへのリンク（相互リンク）は、自分のアプリへの導線の代わりにならない。
6. **新しいアプリを出したら**、[`templates/scripts/lib/app-links.json`](../../templates/scripts/lib/app-links.json) に1行足す
   （id・名前・直すリポ・Web の URL・ascAppId・playPackageName）。足すのも AI がやる。

## 3. 止める・知らせる仕組み（AI が自分で回す）

| いつ | 何が | 何をする |
|---|---|---|
| ストアに出す前 | `lint-pre-submission` の **CHECK 37**（`check-app-link.mjs`） | そのリポの Web のソースに、公開中のストアへの導線が無ければ **fail**。Safari バナーが無ければ warn。Web のページが無いリポは skip |
| 週1（月曜）と一覧を変えたとき | `.github/workflows/app-link-watch.yml`（`check-app-link.mjs --registry`） | 一覧の全ページを本番でブラウザで開き、導線が無いページがあれば Issue（ai-task）を立てる |
| いつでも | `npm run app-link:check`（このキット）／`node scripts/check-app-link.mjs`（各リポ） | 同じ判定をその場で見る。`--offline` は公開中かを調べない |

- 公開中かは App Store の公開検索（iTunes Lookup）と Google Play のページで AI が自分で確かめる。ネットに出られないときは warn に下げる（赤にしない）。
- **判定しないこと**: 置き場所・文言・見た目の良し悪し、押された数。導線を入れたあとは、各サービスの数字（Web→ストアへのクリック）で配置を A/B テストする（KB §2・§7）。

## 4. Issue が立ったら（AI がやる）

1. ✗ の行の「直す場所」のリポで、金型を入れる（すでに導線の部品があればそれを使う。新しく作らない＝CLAUDE.md の実装前ルール）。
2. 作業ブランチ→PR→チェックが緑ならマージ→本番に出たのを `check-app-link.mjs --registry` で確かめる。
3. Issue に結果を書いて閉じる。人に「スマホで見て」と頼まない（ブラウザで iPhone / Android の画面にして自分で見る）。

## 5. 2026-11-22 時点の状況（はじめの棚卸し）

本番を Playwright で開いて数えた結果（`check-app-link.mjs --registry`）。

| サービス | Web | 結果 |
|---|---|---|
| WEBサイト健康診断 | web-health-check.link / app.web-health-check.link | 両方あり・Safari バナーなし |
| ゆっくりエクソソーム | yukkuri-exosome.link | 両方あり・Safari バナーなし |
| リバースハック | partner.reverse-re-birth-hack.com | 両方あり・Safari バナーなし |
| サイト侵害チェック | malwarecheck.site | App Store が無い（Google Play はある） |
| Kimito Link Voice | voice.kimito.link | 両方なし |
| 動員ちゃれんじ | doin.kimito.link / doin.kimito.link/lp | 両方なし |
| kimito.link | kimito.link | 両方なし |
| すれ違ひ通信 | surechigai.kimito.link | Google Play が無い（iPhone 版は公開前） |
| 追憶のきらめき ライブビュー | tsuioku-no-kirameki.com | Google Play が無い（iPhone 版は公開前） |
| AI返信秘書 | henshin-hisho.link | Google Play が無い（iPhone 版はまだ無い） |

直すのは各リポの PR（または Issue ai-task）で進める。最新の状態は週1の見張りの出力を見る。

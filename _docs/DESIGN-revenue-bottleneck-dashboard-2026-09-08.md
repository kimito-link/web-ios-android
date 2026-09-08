# 売上・DL数ボトルネック可視化ダッシュボード 設計（2026-09-08）

> **到達点: 設計完了・実装未着手**（司令塔が実コード・実API仕様を裏取りした上で確定した設計。コードは1行も書いていない）
> **2026-09-08追記: SNSフォロワー数（§F）を「集客段階」の指標として追加**（ユーザー追加依頼、Explore調査で裏取り済み）
>
> 入口: この文書 → 実装ハンドオフ（未作成。実装着手時に `_docs/IMPLEMENTATION-HANDOFF-revenue-bottleneck-dashboard-<date>.md` を作る）
> 関連: `scripts/generate-hub-dashboard.mjs`（並存する既存の /hub/ 生成）／`_docs/DESIGN-ai-hub-consolidation-2026-08-26.md`（/hub/ の Cloudflare Access 前提）

## 0. 一言で

複数プロダクトを横に並べ、「DL数（ストア）→ 課金（Stripe / ストア内課金）」のどこで詰まっているかを
**1画面の表**で見る非公開ページを `/hub/revenue/` に足す。
データ収集は**ローカル1コマンド**（`npm run revenue:collect`）、描画は既存の `deploy:site` 連鎖に乗せる。
**新しい基盤（DB・BI・cron常駐）は作らない。**

用語（初出）:
- **fail-closed** … 測れない・認証が切れた等のときは「N/A」で流さず、**赤で止めて理由を出す**方針
- **registry** … `../best-trust.biz/data/registry.json`。製品（product）の正本。`repositories.json` の `product` はこの `id` を参照する
- **スナップショット** … 収集スクリプトが吐く1ファイルの JSON（`.revenue-snapshot.json`）。描画はこれだけを読む

## 1. 裏取りで判明した「設計を決める事実」（依頼文の前提に追加・訂正）

| # | 事実 | 出典 | 設計への影響 |
|---|---|---|---|
| F1 | **Stripe アカウントは1つ**（`best-trust.biz`, `acct_1EQWdsHJsbJBBM4n`, live）で全プロダクト共有。プロダクトは **Price ID で区別**している | Stripe MCP `list_available_accounts_or_orgs`／`../kimito-link-reply-suggest/server/license-worker/src/stripe-client.ts` L16-26 のコメント（2026-07-30 の実決済で他プロダクトの webhook が誤発火した記録） | 「アカウント→プロダクト」のマッピングは不要。要るのは **Stripe Product/Price → registry product id** の対応だけ |
| F2 | 各プロダクトの Price ID はコードにほぼ無い（環境変数・Payment Link 側）。ハードコードは1件のみ | `price_1…` の Grep 結果1件 | マッピングをファイルに書くには結局ダッシュボードで調べる作業が要る → **Stripe 側の metadata に持たせる**（§3-1） |
| F3 | **`web-ios-android` は PUBLIC リポ**。`site/hub/hub-data.json`・`matrix.json` は git 追跡されている | `../best-trust/data/repositories.json`／`git ls-files site/hub` | ★**売上数値を含む JSON/HTML はこのリポにコミットできない**。依頼文の方式(a)「JSON をリポにコミット」は**不採用確定** |
| F4 | ストアの ID は既に各リポの `app.config.json` に揃っている（`stores.ascAppId` 9件、`stores.playPackageName` 11件） | `*/app.config.json` 走査 | ストア側のマッピングは**新設不要**。`repositories.json.localPath` → `app.config.json` を辿る |
| F5 | `app.config.json` はリポ直下とは限らない（`henshin-hisho/ios-app/`, `resend.kimito-link.com-/app-shell/`） | 同上 | 探索は「直下 → 1階層下」まで見る |
| F6 | Apple の DL 数は `GET /v1/salesReports`（1日1回・**全アプリ分が1つの gzip TSV**で返る）。`Apple Identifier` 列 = `ascAppId` で結合できる | 公式仕様・[ASCAPIClient/SalesReportsAPI.md](https://github.com/hmhv/ASCAPIClient/blob/main/docs/SalesReportsAPI.md) | Apple 側は「1日=1リクエスト」。Stripe と難度がほぼ同じ。**必要な手動作業は Vendor Number の取得と鍵ロールだけ** |
| F7 | Google Play の DL 数は **Play Developer Reporting API では取れない**（vitals/crash 専用）。**Cloud Storage バケット** `pubsite_prod_rev_<id>/stats/installs/installs_<pkg>_<YYYYMM>_overview.csv`（UTF-16）を読む | [Play Console ヘルプ 6135870](https://support.google.com/googleplay/android-developer/answer/6135870)／[Reporting API reference](https://developers.google.com/play/developer/reporting/reference/rest) | 既存 `play-api.mjs` の scope は `androidpublisher` 固定 → `devstorage.read_only` を通す薄い拡張が要る |
| F8 | 既存 `asc-api.mjs` の `makeAscClient` は JSON 前提（`JSON.parse`）。sales report は gzip バイナリ | `templates/scripts/lib/asc-api.mjs` L36-54 | 生バイトを返す関数を**同ファイルに1つ足す**（新規ファイルにしない） |
| F9 | `/hub/*` は `site/_headers` で noindex、本丸は Cloudflare Access（2026-08-26 設定済・302 確認済） | `_docs/IMPLEMENTATION-HANDOFF-ai-hub-consolidation-2026-08-26.md` L95-109 | `/hub/revenue/` は同じ保護下に入る（要 curl 確認、§7） |
| F10 | `ai-hub` は PRIVATE、`hub.mjs find` で stripe/revenue/sales の既存資産は**ヒット0** | `node ../ai-hub/bin/hub.mjs find --tag stripe,revenue,…` | 重複実装の心配なし。ただし `templates/stripe-checkout-email/` に Stripe SDK 方針（`apiVersion` 固定）がある → 揃える |

## A. 理想の体験フロー（個人開発者が毎朝1回見る前提）

1. 朝、`npm run revenue:collect` を打つ（30秒。Stripe・Apple・Google に順に問い合わせ、`.revenue-snapshot.json` を更新）
   - 認証切れ・権限不足はここで**赤字で止まる**。「どの画面で何を足すか」まで出る（§D）
2. `npm run deploy:site`（既存の連鎖に `revenue:page` が入る）→ https://kimito-skill.link/hub/revenue/ を開く（Cloudflare Access ログイン）
3. 画面の最上部に **「一番弱いところ」が1行**（例: `malwarecheck-site: DL 42/30日 → 課金 0 ＝ 課金導線が詰まっている`）
4. その下に **プロダクト×段階の表**（売上降順）。各行の右端に「ボトルネック判定」の札。判定ルールは表の下に明記（ブラックボックスにしない）
5. 数字が古い（収集から3日超）なら**赤いバナー**。収集に失敗した列は数字の代わりに**赤い理由**（「N/A」禁止）

「見て→どのプロダクトのどの導線を直すか決める」までを**1画面・スクロール1回**で終える。
グラフ・ドリルダウン・期間セレクタは**作らない**（§E）。

## B. データモデルと API 連携方式

### B-1. マッピング（どこに持つか）

**結論: 新しいマッピングファイルは作らない。**

| 対応 | 正本 | 理由 |
|---|---|---|
| registry product id → ストアID（ascAppId / playPackageName） | `repositories.json`（`localPath`,`product`）→ `<localPath>/app.config.json`（`stores.*`） | F4/F5。既にある2つの正本を**実行時に結合**するだけ。コピーを作ると drift する |
| registry product id → Stripe Product | **Stripe 側の `Product.metadata.product_id`** に registry の `id` を入れる（1回だけ・ダッシュボード or Stripe MCP `stripe_api_write`。書き込みはユーザー承認を得てから） | F1/F2。Price ID はコードに無いので、どのみち Stripe を見て手で対応づける作業が1回発生する。それなら**対応表を Stripe の中に置けば2つ目の正本が生まれない**。複数 Price（月額/年額）が同じ Product に属するので Price ではなく **Product** 単位 |
| 未割当 | metadata が無い Stripe Product は **「未割当」行に赤で集計**（金額を落とさない＝fail-closed） | 設定漏れが画面に出る |

> 却下: `registry.json` に `revenue` ブロックを足す案（§E-1）。

### B-2. 収集と描画の分離（実行方式）

依頼文の (a)(b) は**どちらも不採用**。理由は F3（公開リポにコミット不可）と、(b)（ビルド毎に全 API）は
`deploy:site` を認証情報の有無に人質にするから。

```
[ローカル・秘密あり]                         [公開リポ・秘密なし]
npm run revenue:collect                      npm run revenue:page
  scripts/revenue/collect-revenue-snapshot.mjs   scripts/generate-revenue-dashboard.mjs
  ├ Stripe  → lib/stripe-revenue.mjs             読む: .revenue-snapshot.json（gitignore）
  ├ Apple   → templates/scripts/lib/asc-api.mjs  書く: site/hub/revenue/index.html（gitignore）
  │            + fetchSalesReportRaw()（薄い追加）  ↓
  ├ Google  → templates/scripts/lib/play-api.mjs  deploy:site が site/ ごと Cloudflare Pages へ
  │            + scope 引数（薄い追加）             （wrangler はディレクトリを上げるので gitignore でも配信される）
  └ 結合    → lib/product-map.mjs
  書く: .revenue-snapshot.json（gitignore）
  キャッシュ: .revenue-cache/asc/YYYY-MM-DD.tsv.gz 等（gitignore・再取得を避ける）
```

- **頻度**: 手動・日次。Stripe は即時、Apple は前日分が翌日、Play は数日遅れ（§D）。リアルタイム性は不要
- **レート制限**: Stripe 読み取り 100 req/s（30〜90日分でも数十リクエスト）、Apple は日数分の GET（キャッシュで初回のみ）、GCS は月次ファイル数枚。**問題にならない**
- **認証情報の置き場（ローカル）**: 環境変数のみ（`.env` は `.gitignore` 済）。新しい読込機構は作らない

| 環境変数 | 用途 | 備考 |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe | ★**制限付きキー（読み取り専用: Checkout Sessions / Invoices / Subscriptions / Products / Balance）を新規発行**して使う。本番の Secret key を流用しない |
| `APPSTORE_CONNECT_KEY_ID` / `_ISSUER_ID` / `_API_KEY_P8_BASE64` | Apple | 既存命名。ただし**鍵ロールが Sales report を落とせるか未確認**（§D-1） |
| `APPSTORE_CONNECT_VENDOR_NUMBER` | Apple | **新規**。ASC > Payments and Financial Reports の Vendor # |
| `GOOGLE_PLAY_SA_JSON_PATH`（既存3方式のどれか） | Google | `.secrets-local/google-play-service-account.json` が既にある |
| `GOOGLE_PLAY_REPORTS_BUCKET` | Google | **新規**。Play Console > レポートをダウンロード > 統計 > 「Cloud Storage URI をコピー」の `pubsite_prod_rev_…` |

- **CI/cron 化はしない（MVP）**。GitHub Secrets で workflow 実行する型（`line-bot/.github/workflows/cloudflare-setup.yml`）は魅力的だが、成果物（スナップショット）を置ける場所が「公開リポ以外」で、かつ `deploy:site` が丸ごと上書きする Cloudflare Pages と噛み合わない。**個人が毎朝1コマンド打つ運用で十分**。自動化したくなったら §E-4

### B-3. スナップショットの形（`.revenue-snapshot.json`）

```jsonc
{
  "generatedAt": "2026-09-08T00:00:00Z",
  "window": { "days": 30, "from": "2026-08-09", "to": "2026-09-07" },
  "sources": {                       // 列ごとの成否。失敗しても他列は出す
    "stripe": { "ok": true },
    "asc":    { "ok": false, "error": "403 … role", "howToFix": "ASC > Users and Access > Integrations で Admin/Sales ロールの鍵を作る" },
    "play":   { "ok": true, "lagDays": 2 }
  },
  "products": [
    { "id": "malwarecheck-site", "name": "…", "brand": "reverse-hack", "url": "…",
      "store": { "asc": { "appId": "6785846826", "units30d": 42, "unitsPrev30d": 51, "proceeds30d": 0 },
                 "play": { "package": "com.reversehack.malwarecheck", "installs30d": 17, "installsPrev30d": 9 } },
      "stripe": { "currency": "jpy", "gross30d": 0, "grossPrev30d": 9800, "paidCount30d": 0, "activeSubs": 0, "mrr": 0 },
      "bottleneck": { "stage": "monetize", "reason": "DL 59/30日 に対し課金 0" } }
  ],
  "unassignedStripe": [ { "productId": "prod_…", "name": "…", "gross30d": 980 } ],
  "reconcile": { "stripeNet30d": 123456, "sumOfProducts": 123456, "refunds30d": 0, "fees30d": 4321, "ok": true }
}
```

- 金額は Stripe の最小単位そのまま（JPY はゼロ小数）。**通貨換算しない**。通貨が混在したら通貨ごとに列を分ける
- `reconcile`: プロダクト別合計（gross）− 返金 − 手数料 ≒ Stripe の `balance_transactions` net 合計。**1%超ズレたら赤**（自分の集計を自分で疑う計器）

### B-4. Stripe の集計方法（1アカウント・Product で振り分け）

| 種類 | エンドポイント | 振り分けキー |
|---|---|---|
| 買い切り（Payment Link / Checkout） | `GET /v1/checkout/sessions?created[gte]&expand[]=data.line_items` → `status=complete && payment_status=paid && mode=payment` | `line_items.data[].price.product` |
| サブスク（初回＋更新） | `GET /v1/invoices?status=paid&created[gte]` | `lines.data[].pricing.price_details.product`（★API 2025-03 以降。旧 `lines.data[].price` ではない。`apiVersion` を固定する） |
| 継続本数・MRR目安 | `GET /v1/subscriptions?status=active` | `items.data[].price.product` |
| 突合用 | `GET /v1/balance_transactions?created[gte]` | `net` 合計、`type=refund` 合計、`fee` 合計 |

返金は**プロダクトに按分しない**（Charge→Session の逆引きが要り、規模に見合わない）。アカウント合計欄に出すだけ。

### B-5. Apple（`GET /v1/salesReports`）

- パラメータ: `filter[frequency]=DAILY&filter[reportType]=SALES&filter[reportSubType]=SUMMARY&filter[vendorNumber]=<VN>&filter[reportDate]=YYYY-MM-DD&filter[version]=1_1`（`version` は要実測。`1_0`/`1_1` のどちらが通るかは `revenue:check` で確かめて固定）
- 返り: `application/a-gzip` の TSV。**全アプリ分が1ファイル**
- 使う列: `Apple Identifier`（= `ascAppId`）, `Product Type Identifier`, `Units`, `Developer Proceeds`, `Currency of Proceeds`
- DL 数 = `Product Type Identifier ∈ {1,1F,1T,1E,1EP,1EU}` の `Units` 合計（7系＝アップデートは除外）
- ストア内課金 proceeds = `{3,3F,IA1,IA9,IAY,IAC}` の `Developer Proceeds`（同じ TSV から**ただで**取れるので MVP に含める。`resend`/`sakkino` の IAP がここに出る）
- 30日分 = 30 GET。`.revenue-cache/asc/<date>.tsv.gz` にキャッシュし、無い日だけ取る

### B-6. Google Play（Cloud Storage JSON API）

- 一覧: `GET https://storage.googleapis.com/storage/v1/b/<bucket>/o?prefix=stats/installs/installs_<pkg>_` 
- 取得: `GET …/o/<objectName urlencoded>?alt=media`（**UTF-16LE + BOM** → UTF-8 に変換してから CSV 解析）
- 使う列: `Date`, `Package Name`, `Daily User Installs`（端末数でなくユーザー数を採用。列名は初回実測で確定）
- 当月＋前月の2ファイル/アプリ。gsutil 不要（fetch 直叩き）
- `play-api.mjs` の変更: `makeJwt(sa, scope = SCOPE)` / `getAccessToken(sa, scope = SCOPE)` に既定値付き引数を足し、**トークンキャッシュを scope ごとに分ける**（今は単一 `_cachedToken` なので、そのまま scope を混ぜると別スコープのトークンを返す）。既存呼び出しは無改変で動く

### B-7. 画面（`site/hub/revenue/index.html`）

- 静的 HTML・JS ライブラリなし（既存 /hub/ と同じ。`site-chrome.*` を読む）
- 表: 行＝プロダクト（売上降順）、列＝`ブランド | 掲載(iOS/Android) | DL 30日 (前期比) | Play installs 30日 (前期比) | Stripe 売上 30日 (前期比) | 継続本数 | ストア内課金 | ボトルネック`
- **`.kit-matrix` の表 CSS を `scripts/lib/matrix-table-component.mjs` に切り出し**、`generate-hub-dashboard.mjs` と新スクリプトの両方から import（基準⑥。2箇所目を手で書かない。`tree-view-component.mjs` と同じ型）
- ボトルネック判定（表の下に同じ文言で掲示）:
  1. 計測できない列がある → **赤「計測不能」**（理由リンク）
  2. Stripe/IAP 売上 0 かつ DL>0 → **赤「課金導線」**
  3. ストア掲載済みで DL 30日 < 10 → **赤「集客」**（閾値は定数・画面に表示）
  4. 売上 前期比 −30% 以下 → **黄「減速」**
  5. それ以外 → 緑
- 先頭に「一番弱いところ」1行（赤の中で売上ポテンシャル＝DL数が最大のもの）
- `generate-hub-dashboard.mjs` の nav 行（L449/L459 の Architecture Map と同じ位置）に `/hub/revenue/` へのリンクを1行足す

### B-8. 配線（`package.json` / `.gitignore`）

```
"revenue:check":    "node scripts/revenue/collect-revenue-snapshot.mjs --check"     // 認証・権限・ID解決だけ。数字は取らない（line-bot の check→apply の型）
"revenue:collect":  "node scripts/revenue/collect-revenue-snapshot.mjs"
"revenue:page":     "node scripts/generate-revenue-dashboard.mjs --root . --out site/hub/revenue"
"revenue:page:selftest": "node scripts/generate-revenue-dashboard.mjs --selftest"
"deploy:site":      "npm run hub:page && npm run shindan:update && npm run revenue:page && node templates/scripts/deploy-cloudflare-pages.mjs --dir site"
```
`.gitignore` 追記: `.revenue-snapshot.json` / `.revenue-cache/` / `site/hub/revenue/`

- `revenue:page` はスナップショットが**無い/古い**とき exit 0 で**赤い状態ページ**を出す（`deploy:site` を人質にしない。ただし画面は決して緑にならない）。壊れた JSON は exit 1
- `revenue:collect` は 3値 exit（`instrument-core.mjs` 規約: 0 全列 OK / 1 いずれか失敗 / 2 測れない）。失敗列があっても**スナップショットは書く**（他列を道連れにしない）
- `--selftest`: 固定の疑似スナップショットから HTML を生成し、赤/黄/緑の判定と「未割当」行、stale バナーが出ることを検査
- `templates/scripts/lib/asc-api.mjs` / `play-api.mjs` は配布物 → `_docs/instruments/check-drift.mjs` の `PAIRS` 登録状況を確認して同期対象にする

## C. MVP スコープ

### 今回やる
| 項目 | 状態 |
|---|---|
| Stripe 売上（買い切り＋サブスク）を Product 単位で30日/前30日集計、突合、未割当検出 | 実装 |
| Apple DL 数（salesReports）＋ストア内課金 proceeds | 実装（**手動前提2つ**: Vendor Number・鍵ロール） |
| Google Play installs（GCS CSV） | 実装（**手動前提2つ**: バケットID・SA の Play Console 権限） |
| 結合（registry × repositories × app.config.json） | 実装 |
| 表＋ボトルネック判定＋stale バナー＋失敗理由表示 | 実装 |
| `revenue:check` モード | 実装 |
| Stripe Product への `metadata.product_id` 付与 | 手動1回（ユーザー承認の上 MCP で実行可） |

**「両方同時に」への回答**: コードは3ソースとも今回書く。難度差は実装ではなく**手動前提の有無**にある（Stripe は制限付きキー1本、ストア側は各2つ）。列ごとに独立して fail-closed なので、**手動前提が済んだ列から緑になる**段階リリースが自然に成立する。「取得中プレースホルダ」は**作らない**（それは N/A と同じ）。代わりに赤い「未設定: 次にやること」を出す。

### 次フェーズへ送る（今回やらない）
- **集客段階**（インプレッション・商品ページ閲覧・Web の訪問数）。Apple は `analyticsReportRequests`（ONGOING 申請→instances→segments の多段・重複インスタンスの既知不具合）、Web はアクセス解析基盤自体が無い。MVP のファネルは **DL→課金の2段**で、集客の弱さは「DL が少ない」で代理する
- Google Play **収益**（`earnings_YYYYMM.zip`。zip 解凍＋財務権限が別途要る）
- 返金のプロダクト按分
- グラフ・期間切替・CSV 出力・通貨換算
- CI/cron 自動収集（§E-4）
- `bootstrap-secrets.mjs` の SPECS 追記（CI で使うようになったら）

## D. 地雷と回避策

### D-1. Apple `salesReports`
- **鍵のロール**: CI 用 ASC キー（App Manager 想定）では 403 になる可能性が高い。Sales report は **Admin / Sales（＋レポートアクセス）／Finance** のいずれか。既存キーで `revenue:check` を通し、403 なら**この用途専用に Sales ロールの鍵を別途作る**（CI 鍵の権限を上げない）
- **Vendor Number** は API で取れない。ASC > Payments and Financial Reports 右上の Vendor # を手で写す（1回）
- **売上ゼロの日は 404**（`There were no sales for the date specified`）。これは**エラーではなく 0**。メッセージ文字列で判別し、それ以外の 4xx は赤
- **gzip**: `Content-Type: application/a-gzip` で `fetch` は自動解凍しない。先頭2バイト `1f 8b` を見て `zlib.gunzipSync`
- **前日分は翌日（太平洋時間の朝）以降**。当日を要求しない。`to` は実行日の2日前まで
- `filter[version]` の許容値はレポート種別ごとに違う（過去に 400 が多発している領域）。`--check` で実測して**定数に固定**し、以後は触らない

### D-2. Google Play
- **Reporting API に installs は無い**（F7）。「Play Developer API があるから取れるはず」で調べ直さない
- CSV は **UTF-16LE + BOM**。UTF-8 のつもりで読むと列名が化ける
- SA には Play Console 側で「アプリ情報の閲覧（一括レポートのダウンロード）」を**Play Console のユーザー招待画面から**付与する必要がある。GCP IAM だけでは 403
- 反映は**数日遅れ**。前期比は「遅れを揃えた同じ窓」で比べる（`lagDays` をスナップショットに残し、画面に「〜日前まで」と出す）
- `play-api.mjs` のトークンキャッシュは scope 非依存（§B-6）。scope 追加時に必ずキャッシュのキーを分ける

### D-3. Stripe
- **1アカウント共有**なので、webhook と同じく **Product で判定しないと他プロダクトの売上が混ざる**（F1 の webhook 誤発火と同根）
- Invoice の line item 形が API バージョンで変わる（`price` → `pricing.price_details`）。`apiVersion` を `templates/stripe-checkout-email` と揃えて固定
- 本番 Secret key を流用しない。**読み取り専用の制限付きキー**を発行（漏れても送金・返金ができない）
- `checkout.sessions` の `expand` は最大4階層・1リクエスト 100 件。`starting_after` でページング（`has_more` を見る）

### D-4. 公開リポ
- **数字入りの生成物を `site/hub/revenue/` に置いたまま `git add -A` しない**。`.gitignore` に入れるだけでなく、`templates/scripts/verify-no-secrets-in-dist.mjs` 相当で「売上らしき JSON がコミット対象に無いか」を `npm run verify` に1本足すか検討（今回は `.gitignore` ＋ `git status` 目視で可。CI 化は次フェーズ）
- `hub-data.json`（追跡中）に売上を混ぜない。新スクリプトは既存の JSON に**一切書かない**

### D-5. 認知の癖（CLAUDE.md 5類型）に対する予防線
- 「表を見て筋が通る」で終わらせない（癖3）。完了判定は**実 API を叩いた `revenue:collect` の出力と本番 URL の 302** で行う（§7）
- CSS を2箇所目に書く前に `matrix-table-component.mjs` へ（癖1・基準⑥）

## F. SNSフォロワー数（集客段階の先行指標、2026-09-08追記）

ユーザーから「X・Instagram・TikTok・YouTubeのフォロワー数も、LINEハーネスのように管理したい」と
追加依頼があった。§C「次フェーズへ送る」とした**集客段階**の代理指標として、DL数のさらに手前
（認知・フォロー）を見えるようにする要望と解釈する。

### F-1. 裏取りで判明した事実（Exploreエージェント調査）

| # | 事実 | 出典 | 設計への影響 |
|---|---|---|---|
| F11 | **X（Twitter）は`kimitolink-linktree`に本格実装が既にある**。Clerk借用トークン（`client.users.getUserOauthAccessToken(userId, "x")`、`follows.read`スコープ）で`GET /2/users/:id/followers`を叩き、Redisに24h TTLでキャッシュ・日次cronで30日分の時系列を`publicMetadata`＋Redis hashに保存 | `kimitolink-linktree/lib/server/x-followers.ts`・`lib/followers-history.ts` | **横展開できる**。ただし認証方式がClerk依存（Next.js前提）なので、web-ios-androidキット側で再利用するにはClerk無し版（アプリ本人のBearerトークン直叩き）に作り直す必要がある |
| F12 | X APIは2023年有料化以降、フォロワー数取得を含む「自分のデータ（Owned Reads）」が従量課金（$0.001〜0.010/件程度）。無制限の無料取得はできない | 一般知識＋F11実装コメント | 自分が管理する各アカウント1件のフォロワー数を月1回程度取得する分にはコスト微小。**頻繁なポーリングはしない**（Stripe/ストアと同じ日次〜週次で十分） |
| F13 | **YouTube Data APIはAPIキーのみで容易**。`channels.list`の`statistics.subscriberCount`が無料枠で取得できる | 一般知識 | 4指標中もっとも実装コストが低い。**最優先で実装する** |
| F14 | Instagram Graph APIはビジネス/クリエイターアカウント連携＋Facebookページ紐付け＋Meta審査が必要 | 一般知識 | ハードル中〜高。MVPでは「未対応」表示に留める |
| F15 | TikTok公式APIはフォロワー数を含む詳細指標の取得に審査が必須で、個人開発規模では取得が難しいケースが多い | 一般知識 | 同上。「未対応」表示 |
| F16 | line-bot「ハーネス」は実はフォロワー数ではなく**複数LINEアカウントの生存監視**（5分毎cron、`riskLevel`で200/403/429を可視化）の仕組み。ユーザーが「ハーネスみたいに」と言ったのは「複数アカウントを1画面で串刺しに見たい」という体験のイメージと解釈するのが妥当 | `line-bot/docs/wiki/18-Multi-Account-and-BAN.md` | データの性質（数値の推移）としては`kimitolink-linktree`の`followers-history.ts`（時系列スナップショット）の方が直接の参考になる |

### F-2. MVPスコープ（今回やる／次フェーズ）

既存の設計思想（§B-2「収集と描画の分離」・§C「手動前提が済んだ列から緑になる」）をそのまま適用する。

| プラットフォーム | 今回 | 理由 |
|---|---|---|
| YouTube | **実装する** | APIキー1本で完結。F13 |
| X | **実装する（横展開）** | `kimitolink-linktree`の実装をClerk非依存の形に薄く移植。各プロダクトのXアカウントごとにBearerトークン（Owned Reads用、Free/Basic tier）を発行し環境変数化 |
| Instagram | 次フェーズ | 審査必須（F14）。今回は表に「未対応」行のみ出す |
| TikTok | 次フェーズ | 審査必須（F15）。同上 |

### F-3. データモデル・配線（既存パターンを踏襲）

- **マッピング**: プロダクト → SNSアカウントの対応は、`app.config.json`に既存の`brand`セクション相当の場所へ`social`ブロックを新設するのではなく、**`.revenue-collect.env`的な環境変数一覧**（`X_BEARER_TOKEN__<product-id>`、`YOUTUBE_API_KEY`＋`YOUTUBE_CHANNEL_ID__<product-id>`）で持つ。理由は§B-1と同じ（新しい正本ファイルを増やさない・複数プロダクトが同一Xアカウントを共有するケースがあるため1:1マッピングファイルは早すぎる抽象化）
- **収集**: `scripts/revenue/collect-revenue-snapshot.mjs`に列を追加する形ではなく、**独立した`scripts/revenue/collect-social-snapshot.mjs`を新設**し、`.social-snapshot.json`（gitignore）に書く。理由: 更新頻度が売上系（日次）と異なってよく（週次で十分）、失敗しても売上ダッシュボードを道連れにしないため（fail-closedの独立性を保つ、D-5の教訓通り）
- **描画**: `site/hub/revenue/index.html`の表に新しい列を足すのではなく、**同じ「一番弱いところ」1行の思想で別の小さな表を1つ追加**する（「集客: フォロワー数（前月比）」）。既存の`matrix-table-component.mjs`を再利用（基準⑥）
- **npm script**: `"social:collect": "node scripts/revenue/collect-social-snapshot.mjs"`、`revenue:page`が`.social-snapshot.json`があれば読み込み描画に含める（無ければその節ごと非表示、fail-closedだが赤では止めない＝任意機能として扱う）

### F-4. 地雷（一般知識ベース、実装時に`--check`で必ず実測すること）

- X API: レート制限とコストの実測を先にする。無料枠だけで賄えるかは2026年時点のプラン変更を都度確認（設計時点の情報が古くなっている可能性が高い）
- YouTube: `channels.list`はチャンネルID指定が確実（ハンドル名`@xxx`からの逆引きは別エンドポイントが要る場合がある）。各プロダクトのチャンネルIDを事前に控える
- 複数プロダクトが同一Xアカウント/YouTubeチャンネルを共有するケース（企業アカウントで複数商品を告知する等）を想定し、1アカウント→複数プロダクトの多対1もマッピングできる形にする

## E. 捨てた案と理由

1. **`registry.json` に `revenue` ブロック（Stripe Product ID・ストアID）を足す** — ストアIDは `app.config.json` に既にあり二重化＝drift。Stripe 側は metadata で足りる。台帳のスキーマ変更（別リポ）まで背負う価値がない
2. **方式(a): GitHub Actions cron → JSON をリポにコミット** — F3（公開リポ）で即死。private リポにコミットしても、Pages デプロイは `site/` 丸ごとなので「読みに行く」経路を別に作る羽目になる
3. **方式(b): `deploy:site` 内で毎回全 API** — 認証の有無に deploy が人質。/hub/ 本体の更新が売上 API の機嫌で止まる
4. **Cloudflare Worker + KV/R2 に日次で置き、ページが fetch** — 「常駐する基盤」が1つ増える。個人運用で毎朝1コマンドが苦になった時に初めて検討（その時は private な `ai-hub` の workflow で `collect` → R2 に put → ページは同一オリジンで fetch、が最小）
5. **Stripe Sigma / Reporting API（Report Runs）** — 有料・非同期・CSV。List API を足す方が短い
6. **Apple `analyticsReportRequests` を MVP に入れる** — 多段・非同期・重複インスタンス問題。DL 数だけなら `salesReports` で足りる
7. **ファネル図（漏斗の SVG）** — 段が2つしか無いので表と情報量が同じ。CVR の「一目」は**赤い札＋先頭1行**で達成する
8. **プロダクトごとの閾値設定ファイル** — 設定が増えるほど「設定していないから緑」が生まれる。閾値は定数1組を画面に掲示
9. **売上プレースホルダ「取得中…」** — N/A の言い換え。fail-closed 違反

## 6. 未確認事項（実装時に `revenue:check` で最初に潰す）

- [ ] 既存 ASC キーのロールで `salesReports` が 200 になるか（403 なら Sales ロール鍵を別途発行）
- [ ] `filter[version]` の通る値（`1_0` / `1_1`）
- [ ] Play の SA が GCS バケットを list できるか（Play Console 側の権限付与が済んでいるか）／バケットIDの取得
- [ ] Play installs CSV の実列名（`Daily User Installs` を想定）
- [ ] Stripe Product の総数と、metadata 付与の対象（MCP `stripe_api_read` で products を一覧 → ユーザーに確認 → 承認後に write）
- [ ] `/hub/revenue/` が Cloudflare Access の対象に入るか（`curl -I` で 302）
- [ ] `check-drift.mjs` の `PAIRS` に `asc-api.mjs` / `play-api.mjs` が登録済みか

## 7. 機械的な完了判定（実装ハンドオフに転記する）

- [ ] `npm run revenue:check` が3ソースすべて OK（または各ソースの「次にやること」が正しく出る）
- [ ] `npm run revenue:collect` の exit 0 と `.revenue-snapshot.json` の `reconcile.ok=true`
- [ ] `npm run revenue:page:selftest` OK（赤/黄/緑・未割当・stale の4系統）
- [ ] `git status` に `.revenue-snapshot.json` / `site/hub/revenue/` が**出ない**
- [ ] `npm run deploy:site` 後、`curl -I https://kimito-skill.link/hub/revenue/` が 302（Access）
- [ ] ログイン後の実画面で、既知の実売上（Stripe ダッシュボードの30日 gross）と表の合計が一致
- [ ] `npm run verify` / `npm run diagnostics` が従来どおり緑（`check-near-duplicates` が新旧の表 CSS を重複扱いしない）

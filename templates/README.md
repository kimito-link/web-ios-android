# templates/ — Capacitor 連動型アプリの金型

このディレクトリは、`app.config.json` を埋めれば iOS/Android アプリを作れるようにするための
**金型(実証済みテンプレート)**。リバースハック(partnership)/ 富士山 / Exosome で実際に
ストア配信されている server.url リモート読込型の構成を、アプリ非依存に一般化したもの。

> ⚠️ まず [`../_docs/CAPACITOR-GOLDEN-RULES.md`](../_docs/CAPACITOR-GOLDEN-RULES.md) を読むこと。
> 黒画面を二度と起こさない6原則。これを破ると富士山の2ヶ月の轍を踏む。

## 中身

| パス | 役割 | アプリ固有値の扱い |
| --- | --- | --- |
| `scripts/setup-new-app.mjs` | **立ち上げウィザード(まずここ)**。app.config 検証→資産生成→本体の `/check-shindan-version/` 初期生成→Android初期化案内(Capacitor優先/IAP不要ならTWAも可)→Secrets/手動GUI一覧 | 無改変(app.config.json 駆動・`node scripts/setup-new-app.mjs --dry-run` 可) |
| `next-app/` | **Web アプリ本体の雛形**(Next.js 15 + React 19 + Tailwind 4 + App Router)。ClerkProvider/middleware/.env.example、SEO ヘルパ(Metadata API 版)、JsonLd、汎用 UI(Hero/Faq/CTA)、最適化済み next.config、★診断進捗ページ `/check-shindan-version/` を同梱。詳細は [`next-app/README-clerk.md`](next-app/README-clerk.md) | `{{displayName}}`/`{{productionDomain}}`/`{{primaryColor}}`/`{{accentColor}}` を app.config.json の値に置換。Clerk 不使用なら CLERK_* と .template を消すだけ |
| `capacitor/capacitor.config.template.ts` | Capacitor 設定の金型(server.url 連動型) | `{{bundleId}}` 等を app.config.json の値に置換 |
| [`expo-native/`](expo-native/README.md) | **React Native(Expo) をネイティブのまま両ストアに出す金型**(WebView 非依存)。iOS/Android のリリース CI + 署名注入 + Play グラフィック生成 + 資産名衝突テスト。**方式の選び分け(TWA/Capacitor/Expo)と地雷4件を README に集約** | `<PLAY_PACKAGE_NAME>`/`<APP_BUNDLE_ID>`/`<PRODUCTION_DOMAIN>` を置換。`*.mjs` は無改変 |
| `scripts/patch-ios-launch-dark.mjs` | iOS 起動フラッシュ対策(2点だけ・独自VC無し) | **無改変で使える**(背景色 #0A0A0F 固定) |
| `workflows/ios-shell-guardrail.yml` | 独自ネイティブ注入の再混入を CI で赤にするガード | 無改変(禁止パターンはアプリ非依存に一般化済み) |
| `scripts/lint-pre-submission.mjs` | 審査前 lint(実証済み Apple 却下ベクタを CI で検出) | **無改変**(app.config.json + env 駆動。無いファイルは skip) |
| `scripts/capture-appstore-screenshots.mjs` | App Store スクショ自動撮影(ログイン後・fail-closed) | **無改変**(撮影計画は `store-assets/screenshot-plan.json`) |
| `scripts/capture-play-screenshots.mjs` | Google Play スクショ自動撮影(Android FHD) | **無改変**(iOS と同じ screenshot-plan.json を共有) |
| `scripts/frame-appstore-screenshots.mjs` | 生スクショを仕上げ加工(キャプション帯・角丸・影) | **無改変**(キャプションは screenshot-plan.json の framedCaptions) |
| `scripts/screenshot-plan.example.json` | 撮影計画のひな形 | リポの `store-assets/screenshot-plan.json` にコピーして編集 |
| `scripts/lib/app-config.mjs` | app.config.json 取得口(`cfg()` / `productionUrl()` / `isPlaceholder()`) | 無改変 |
| `web/` | **Web→アプリDL導線**(公式バッジ取得・UA出し分け・Smart App Banner・CSS)。詳細は [`web/README.md`](web/README.md) | `{{ascAppId}}`/`{{playPackageName}}`/`{{productionUrl}}`/`{{primaryColor}}`/`{{accentColor}}` を置換 |
| `stripe-checkout-email/` | **Stripe決済→購入完了メール送信**(Cloudflare Pages Functions + Resend)。買い切り課金の物販/ツール系で使用。詳細は [`stripe-checkout-email/README.md`](stripe-checkout-email/README.md) | `{{downloadUrl}}`等多数を置換(README参照)。クロスセル導線はコメントアウトのオプションブロック |
| `line-bot/` | **LINE公式アカウントでAI社員と会話できるbot**(Cloudflare Workers + D1、GROQ AI応答、fail-closed設計)。詳細は [`line-bot/README.md`](line-bot/README.md) | `{{shortName}}`/`{{cloudflareAccountId}}`/`{{cloudflareD1DatabaseId}}`等を置換。`knowledge-pack/persona.md`はキャラごとに書き換え。`app.config.json`の`lineBot.enabled`をtrueに |
| `scripts/generate-privacy-page.mjs` | プライバシーポリシーHTML生成(健康/Play 審査で必須の公開URL)。API非依存・静的生成のため陳腐化しない | **無改変**(app.config.json 駆動) |
| `scripts/asc-create-profile.mjs` | App Store 用 Provisioning Profile を ASC API で作成(Developer Portal 手動不要)。`CERT_SERIAL` で Secret の .cer に一致する証明書を選ぶ(複数証明書の不一致=Export IPA 失敗を防ぐ)。先頭ゼロ無視のシリアル比較 | **無改変**(env 駆動。詳細は `_docs/FIRST-SUBMISSION-blockers.md` B4) |
| `scripts/asc-set-content-rights.mjs` | app の `contentRightsDeclaration` を API 設定(初回提出の必須・ASC UI では効かないことがある) | **無改変**(app.config.json `stores.contentRights` 駆動。同 B7) |
| `scripts/android-patch-signing.mjs` | build.gradle に signingConfig を冪等注入(Capacitor `android/`・TWA `android-twa/` どちらも `--gradle`/`--keystore` で指定可) | **無改変**(構造依存のみ) |
| `scripts/verify-android-signing-config.mjs` | bundleRelease 前に signingConfig を検証(未署名 AAB 出荷防止ゲート) | **無改変**(android-play-release.yml が呼ぶ) |
| `scripts/verify-ios-splash-not-default.mjs` | Capacitor デフォルトスプラッシュ出荷防止ゲート・iOS版(`--snapshot`/`--verify`) | **無改変**(ios-appstore-release.yml が呼ぶ) |
| `scripts/verify-android-splash-not-default.mjs` | Capacitor デフォルトスプラッシュ出荷防止ゲート・Android版(`--snapshot`/`--verify`。iOSと違いマニフェスト無しの固定パス群を直接ハッシュ比較) | **無改変**(android-play-release.yml が呼ぶ) |
| `scripts/verify-webdir-consistency.mjs` | capacitor.config.tsのwebDirとCIの「Prepare webDir」生成先の不一致検出(`_docs/CAPACITOR-GOLDEN-RULES.md`原則8)。2026-07-04 kimito resend実戦でwebDir不一致により7回連続Androidビルド失敗した地雷への対策 | **無改変**(ios-appstore-release.yml・android-play-release.yml 両方が呼ぶ) |
| `scripts/verify-signing-material-path.mjs` | CIが書き込む署名鍵の場所とbuild.gradleが読む場所の不一致検出(同原則9)。android-patch-signing.mjsの前段で走らせ、鍵ファイル欠落を1階層目で検出 | **無改変**(android-play-release.yml が呼ぶ) |
| `scripts/verify-app-config-schema.mjs` | app.config.json が app.config.schema.json に適合しているかの検証(ajv使用)。壊れた設定がリリーススクリプトへ素通りするのを防ぐ | **無改変**(`npm run config:schema`。`run-instruments.mjs` から自動実行) |
| `scripts/verify-no-secrets-in-dist.mjs` | ビルド成果物(dist)に秘密情報(APIキー・トークン等)が焼き込まれていないかを検査(2026-08-31、tsuioku-no-kirameki.comから逆輸入)。dist は git 追跡下＝pushで公開リポジトリに漏れる実事故を踏まえたゲート。`--field <name>`でプロジェクト固有の秘密フィールド名を追加可 | **無改変**(検査対象は引数で指定。CIには未配線・導入時に各ワークフローへ追加する) |
| `scripts/verify-hermes-unsafe-imports.mjs` | Capacitor/React Native(Hermes)がバイトコード化できない依存(動的import等)をネイティブビルド前に静的検出(2026-08-31、surechigai-romi.linkから逆輸入)。Webビルド・tsc・テストは通るのにネイティブReleaseビルドだけ落ちる盲点を埋める。`check-tracked-imports.mjs`の`blankOutComments`を再利用しコメント内の例示を誤検知しない。`--unsafe <json>`で既知の危険パターンを追加可 | **無改変**(検査対象は引数で指定。CIには未配線・導入時に各ワークフローへ追加する) |
| `scripts/verify-key-coverage.mjs` | 2ファイル(またはリポジトリ間)のキー集合を正規表現で抽出し比較する汎用ゲート(2026-08-31、web-health-check-appから逆輸入・大幅汎用化)。`--config`のJSONで比較対象パス・抽出パターンを指定。`mode:"diff"`=項目網羅性の相互比較(ドキュメントでなく実コードから機械で数える)、`mode:"wiring"`=消費側が参照するキーのうち供給側が渡していないもの(配線漏れ)を検出。`--strict`でベースラインJSON比較によるラチェット運用も可。**限界**: wiringモードは供給側が単純なobject literalの場合のみ機能する(複雑な関数呼び出し境界の括弧バランス解析は非対応、コメント冒頭に実測結果を明記) | **無改変**(config.jsonは各プロジェクトが用意) |
| `scripts/verify-root-cause-claim.mjs` | コミットメッセージの「根治した」宣言に、修正後の実機確認を示す根拠が伴っているかを検査(2026-08-31、tsuioku-no-kirameki.comから逆輸入)。移植元は90日で164回「根治」宣言・うち41回再発という実測を踏まえた開発規律ゲート。「修正前の実測値の引用」だけでは根拠と認めない(移植元が実際に踏んだ誤判定の再発防止)。`--config <json>`で語彙をプロジェクト固有に上書き可 | **無改変**(commit-msgフックやCIのコミット検査ステップから呼ぶ想定。導入時に各プロジェクトで配線) |
| `scripts/verify-doc-impl-coverage.mjs` | ドキュメント内の`<!-- impl: パス#マーカー -->`注記を全走査し、参照先ファイル・マーカー文字列が実在するか、`impl: none`に理由が書かれているかを検査(2026-08-31、sakkino.linkから逆輸入)。「ドキュメントに実装済みと書いたのに実装が無い/削除・改名された」を機械検出。移植元の実発見(2026-07-04、PrivacyInfo.xcprivacy等の記載漏れ)を踏まえる。**注**: 移植元にあった特定チェックリスト表(`pre-submission-compliance-checklist.md`固有)の検査は汎用性が無いため未移植、必要なら移植元スクリプトを直接参考にすること | **無改変**(`--docs-dir`は各プロジェクトが指定。CIには未配線) |
| `scripts/verify-claims-provenance.mjs` | 数値・実績を含む文の近傍(既定700文字以内)に出典コメント(`<!-- 出典: URL（日付） -->`)があるかを検査(2026-08-31、best-trust.bizから逆輸入)。「せっかくだから」で出典の無い実績表明(「多数の実績」等)を足す衝動を機械的に検知。`--unit`で数値単位(件/%/円等)、`--dir`で公開ディレクトリを指定可。既定で「年」は西暦・比喩表現の誤検知が多いため対象外(実測で判明)。実データ裏取りで移植元と完全一致を確認。**既存の`verify-claims-coverage.mjs`（別方式、`site/claims.json`正本）とは別物** | **無改変**(`--dir`/`--unit`は各プロジェクトが指定。CIには未配線) |
| `scripts/android-cert-expiry-check.mjs` | Android upload keystore(.jks)の有効期限をkeytoolでローカル抽出(apple-cert-expiry-check.mjsのAndroid版)。期限内に無音失効すると bundleRelease が予告なく失敗する | **無改変**(`workflows/android-cert-expiry.yml` が呼ぶ) |
| `scripts/verify-assetlinks-published.mjs` | 本番URLの `/.well-known/assetlinks.json` が実際に取得でき、`package_name` が app.config.json と一致するかをfetchで検証(TWA/App Links疎通確認)。指紋のミスは判定しない(限界を出力に明記) | **無改変**(`npm run assetlinks:check`。`run-instruments.mjs` から自動実行) |
| `scripts/verify-external-links.mjs` | site/内の外部リンク(ストアバッジ・GitHubリンク等)の到達性をlinkinatorでチェック。実測でplay.google.com/console/*等の認証必須URLを誤検知することを確認し除外リスト(AUTH_GATED_DOMAINS)化 | **無改変**(`npm run links:external`。実行に時間がかかるため`run-instruments.mjs`には含めず`scheduled-quality-check.yml`の週次のみ) |
| `scripts/check-splash-config.mjs` | Android の `androidScaleType` 未設定(既定=引き伸ばし)と、背景色の4箇所不一致(白フラッシュ)を検査。Expo prebuild 方式では自動的に対象外(🟡)になる | **無改変**(リリースCIが直接呼ぶ) |
| `scripts/check-splash-safe-circle.mjs` | Expo prebuild 方式向け。Android 12+ の円形マスクでロゴが切れないか(透過PNGか・安全円の内側か)を検査。詳細は [`SPLASH-SCREEN-PLAYBOOK.md`](../_docs/SPLASH-SCREEN-PLAYBOOK.md) | **無改変**(同上) |
| `scripts/lib/splash-manifest.mjs` | スプラッシュ検査群の配布版と対象ファイル一覧(このキットが正本) | 無改変 |
| `scripts/check-tracked-imports.mjs` | **新規ファイルの `git add` 忘れ検出ゲート**。git 追跡ファイルだけで相対 import が全解決するか静的検査= git clone 直後(CI/Vercel/ストアビルド)の実体を再現。ローカル検証は作業ツリー基準なので原理的に検出できない穴を塞ぐ。思想は [`../docs/ai-rules/04_SELF_VERIFICATION.md`](../docs/ai-rules/04_SELF_VERIFICATION.md) §5 | **無改変**(`TRACKED_IMPORT_ROOTS` env で対象限定可。CI の build 直後と pre-push に置く) |
| `scripts/lib/instrument-core.mjs`<br>★[計器のやりとりはこちら](../_docs/instruments/README.md) | **検査の共通土台(依存ゼロ)**。★終了コードを3値にする(0=合格 / 1=測れた上での赤 / ★2=測れなかった)。`normalizeProbeResult` が★**根拠(evidence)なき pass を自動で inconclusive へ降格**＝「何も測っていないのに緑」を構造的に潰す(2026-08-17 に `audit-native-cta.mjs` が引数なしで「✅0件」と出した偽の緑と同じ型)。`runSelfTest` は毒→赤→finally復帰の定型。赤のときは3行(何が/直し方/★この検査の限界)を出す | **無改変**(新しい検査を書くときに import する。見本は `audit-native-cta.mjs --selftest`) |
| `scripts/context-engine.mjs` / `scripts/context-evolution.json` / `scripts/run-instruments.mjs` | **計器の完全版入口**。全追跡・未追跡ファイル、Git全履歴、現在差分、指示書、確定/却下/未確定の判断を出典つきの1枚へ集約し、検証済みの学びだけを次回へ戻す。統合入口は途中が黄/赤でも止まらない | 3ファイルを `scripts/` へ**無改変でコピー**。`.instrument-context.md` は生成物なのでコミットしない |
| `scripts/generate-shindan-version.mjs` | **各プログラム本体の診断・進化進捗ページ生成器**。Next.jsでも静的サイトでも `/check-shindan-version/` を作り、導入・実測・履歴・公開の進み具合、4状態、根拠、次の一手を表示 | **無改変**。`npm run shindan` で計測＋更新、ビルド前はレポートから自動更新。詳しくは [`../_docs/instruments/SHINDAN-VERSION-PAGE.md`](../_docs/instruments/SHINDAN-VERSION-PAGE.md) |
| `diagnostics/`(**汎用診断キット**) | **どんなJS/TSリポにも使える出荷事故ゲート4本＋ランナー**。`node diagnostics/run.mjs <対象ディレクトリ>` で import未追跡・lockfile不一致・秘密情報の追跡漏れ・巨大ファイル追跡をまとめて検査。詳細は [`diagnostics/README.md`](diagnostics/README.md) | **無改変**(依存ゼロ。web-ios-androidキット外の任意リポにも `node <このキットのパス>/diagnostics/run.mjs .` でそのまま使える) |
| `../app.config.schema.json` | app.config.json の JSON Schema(全スクリプトの単一真実源) | 無改変(リポ直下に置く) |
| `../lighthouserc.json` | **Lighthouse CI設定**(性能/アクセシビリティ/SEO/ベストプラクティスの閾値)。`scheduled-quality-check.yml` が使う。2026-08-25新設 | リポ直下にコピー。サイト固有の閾値に調整可(既定: a11y≥0.9はerror、他はwarn) |
| `web/apple-app-site-association.example`<br>+ `web/README-universal-links.md` | **iOS Universal Links金型**。Android版`android-twa/assetlinks.json.example`の対。サーバ配信時の拡張子なし・Content-Type・リダイレクト禁止等のApple固有の注意点をREADMEに集約。2026-08-25新設 | `_README`削除の上`<appleTeamId>.<bundleId>`を埋め、`/.well-known/apple-app-site-association`として配信 |
| `scripts/setup-clerk-x-oauth.mjs` | **Clerk + X OAuth セットアップ補助**。app.config.json(+ブランドプリセット)を読んでチェックリスト表示 / `.env.local` ひな形追記 / Vercel 一括登録。`--write-env` / `--write-vercel` フラグで動作変更。`pk_test_` から開発用 Callback を自動デコード | **無改変**(app.config.json 駆動) |
| `auth/brand-preset.schema.json` | **ブランド認証プリセットの JSON Schema**。1ブランド分の Clerk + X OAuth 設定の構造定義(秘密は env 名参照のみ) | 無改変 |
| `auth/brands/kimito-link.json` | **Kimito-Link ブランドの認証プリセット**(実証済み)。Clerk ドメイン・X scope・X アプリ共有方針・env 名を集約。`auth.brandPreset: "kimito-link"` で継承 | **無改変**(値はブランド固定) |
| `auth/brands/_TEMPLATE.json` | **新ブランド用ひな形**。コピーして `<brand>.json` を作り `<...>` を埋める。クリエイターが自分のブランドで X ログインを使う入口 | `<...>` を自ブランドの値に置換 |
| `docs/clerk-x-oauth-checklist.md` | **Clerk + X OAuth ハマりポイント手順書**（kimito.link 実体験ベース）。ブランドプリセット方式・開発 Callback 登録・tweet.write 混入・Callback URL 不一致・dev 鍵の本番混入など既知の罠を集約。新アプリ追加のたびに参照する | — |

> 🚦 **新アプリの「初回提出」は** [`../_docs/FIRST-SUBMISSION-blockers.md`](../_docs/FIRST-SUBMISSION-blockers.md) を上から潰す。
> 最初の1回だけ順番に踏む iOS/Android のブロッカー8個（Team ID空・lockfile古い・splashロゴパス・
> 証明書不一致・playwright未導入・電話番号偽物・contentRights未設定・App プライバシー未公開）＋
> ASC UI 手動項目（カテゴリ/年齢/サブタイトル）を、CIログの実文言つきで集約。2回目以降は §7 の push 一発。
>
> 📚 **Apple 却下が来たら** [`../_docs/apple-reject-knowledge-base.md`](../_docs/apple-reject-knowledge-base.md) を見る。
> 「却下パターン → 原因 → **実際に通った返信文**」を集約(リバースハック partner v1.0.0〜v1.0.9 の実例、固有名は一般化)。
> `lint-pre-submission.mjs` の各チェックはこの KB のガイドライン番号に対応する。

> 🖼 **スクショ自動化の使い方**: (1) `screenshot-plan.example.json` をリポの `store-assets/screenshot-plan.json`
> にコピーして撮るページ/キャプション/ログイン手順を書く → (2) capture で生スクショ → (3) frame で仕上げ →
> (4) `lib/asc-screenshot-upload.mjs`(release CI)で **delete-then-reupload**。ログイン認証アプリは
> `IOS_REVIEW_DEMO_USERNAME`/`_PASSWORD` を CI Secret に。`authTabs` を空にすればログイン不要アプリ扱い(creds 不要)。

## 使い方(連動型アプリを新規に作る)

0. **Web 本体を作る**(まだ無ければ): `next-app/` を新リポの `apps/web/`(等)にコピーし、
   `{{...}}` を app.config.json の値で置換。Clerk を使うなら `next-app/README-clerk.md` に従い
   `@clerk/nextjs` を入れて `.template` を配置。Capacitor はこの Web を `server.url` で読む。
   ★`app/check-shindan-version/` と `scripts/update-shindan-version.mjs` も一緒にコピーする。
1. アプリのリポジトリで `app.config.json` を埋める(identity / brand / contact / businessModel / **auth**)。
2. `capacitor.config.template.ts` の `{{...}}` を app.config.json の値に置換して
   そのリポの `capacitor.config.ts` を作る。
   - `{{bundleId}}` = identity.bundleId / `{{displayName}}` = identity.displayName
   - `{{iosScheme}}` = identity.iosScheme / `{{productionDomain}}` = identity.productionDomain
   - `{{rootDomain}}` = productionDomain のルート(例: app.example.com → example.com)
   - `{{backgroundColorARGB}}` = 起動下地色 ARGB8(金型実績は `#0A0A0FFF`)
3. `node scripts/setup-new-app.mjs` を実行し、`https://<本番ドメイン>/check-shindan-version/`
   の初期ページが生成されたことを確認する。以後は `npm run shindan` で計測＋更新する。
4. `scripts/patch-ios-launch-dark.mjs` と `workflows/ios-shell-guardrail.yml` をリポにコピー。
5. `@capacitor/{cli,core,ios,android}` を devDependencies に追加。
6. `npm install` → `npx cap add ios` / `npx cap add android`(Xcode / Android SDK が要る)。
7. **リリースCI/スクリプト本体を partnership からコピー**(下記マッピング表)。
   配信前に輝度ゲートを通す → リリース CI で配信。

## リリースCI/スクリプトのコピー元マッピング(会議推奨=キットに二重保守しない)

リリースの「実体」(ストアへ送るCI・スクリプト)は**このキットに置かない**。Apple/Google が
審査要件を頻繁に変えるため、テンプレ版を抱えると古びて新規アプリだけ審査落ちする
(発明会議で「製造機化」は reject)。代わりに**動く現物 `partnership_program_website` から
コピー**する。コピー後、`app.config.json` の値で数か所書き換え + GitHub Secrets を登録。

コピー元はファイルごとに partnership / fujisan / Exosome に分かれる(実物で確認済み 2026-06-13)。
P=`partnership_program_website`、F=`fujisan-clean`、E=`Exosome`。

| コピー元 | 自リポの置き場所 | 書き換える値 |
| --- | --- | --- |
| **P** `.github/workflows/ios-appstore-release.yml` | `.github/workflows/` | `env: APP_BUNDLE_ID` / `APP_NAME` |
| `.github/workflows/android-play-release.yml`(Capacitor版・金型 templates/workflows/ が正) | `.github/workflows/` | `env: PLAY_PACKAGE_NAME` / `APP_NAME` |
| **F** `.github/workflows/ios-blackscreen-check.yml`(輝度ゲート本体・Pには無い) | `.github/workflows/` | `APP_BUNDLE_ID` + 発明B3点(下記) |
| **F** `.github/workflows/ios-shell-guardrail.yml`(or 本キットの汎用版) | `.github/workflows/` | 無改変 |
| 本キット `templates/workflows/scheduled-quality-check.yml`(公開サイトのセキュリティ・レスポンシブ・Lighthouse定期チェック。2026-08-25新設、Lighthouseは同日追加) | `.github/workflows/` | 無改変(app.config.json駆動)。既定Web(Vercel)はGit連携自動デプロイでCIを挟まないため、デプロイ手段を問わず定期実行する形にした。Lighthouseはlighthouserc.jsonが無ければステップごとskip |
| 本キット `templates/workflows/android-cert-expiry.yml`(Android upload keystoreの有効期限監視。apple-cert-expiry.ymlのAndroid版。2026-08-25新設) | `.github/workflows/` | 無改変(android-play-release.yml と同じsecretsを再利用。追加secret不要) |
| **P** `scripts/lib/asc-api.mjs` / `scripts/lib/play-api.mjs` | `scripts/lib/` | 無改変(env で制御) |
| **P** `scripts/appstore-submit.mjs` / `scripts/play-publish.mjs` | `scripts/` | 冒頭の `BUNDLE_ID`/`PACKAGE` 既定値 |
| **F** `scripts/release-bump.mjs`(版+SWキャッシュ bump・Pは別命名) | `scripts/` | SWキャッシュ regex の prefix |
| 本キット `templates/scripts/ios-sim-logscan.mjs`(発明B) | `scripts/` | 無改変 |
| **E** `scripts/play-set-listing.mjs`(Play 掲載一括設定) | `scripts/` | 無改変(app.config.json 駆動) |
| **E** `scripts/play-diagnose.mjs`(SA 403 切り分け) / `play-review-check.mjs`(本番準備チェック) | `scripts/` | 無改変 |
| **E** `scripts/asc-rejection-handle.mjs`(ASC リジェクト分類→返信テンプレ) | `scripts/` | 無改変(テンプレは `app-review-replies/`) |
| **E** `scripts/asc-inspect-listing.mjs`(**READ-ONLY** で ASC 掲載文 dump) | `scripts/` | 無改変 |
| コピー元要確認 `scripts/apple-cert-expiry-check.mjs`(証明書/プロファイル失効チェック。`apple-cert-expiry.yml` が呼ぶ) | `scripts/` | 無改変(ASC API 秘密鍵で自動列挙) |
| コピー元要確認 `scripts/asc-patch-review-detail.mjs`(審査提出前の詳細情報パッチ。`ios-pre-submission-lint.yml` が呼ぶ) | `scripts/` | 未確認 |
| コピー元要確認 `scripts/generate-app-icons.mjs`(アイコン一括生成のフォールバック。マスターアイコン未コミット時のみ到達) | `scripts/` | 未確認 |
| コピー元要確認 `scripts/generate-release-notes.mjs`(リリースノート生成。ios/android両CIとも`\|\| true`でソフトフェイル化済み) | `scripts/` | 未確認 |
| コピー元要確認 `scripts/strip-comments.mjs`(`ios-shell-guardrail.yml` が呼ぶ。無ければ素のgrepにフォールバックする設計) | `scripts/` | 未確認 |
| コピー元要確認 `scripts/verify-reviewer-account.mjs`(審査提出前ゲート。`ios-appstore-release.yml` から無条件で呼ばれる必須ステップ) | `scripts/` | 未確認 |

> ⚠️ 上記6本は2026-08-25の監査で「ワークフローYAMLから参照されているがこの表に記載が無い」
> ことが判明したもの。**実体は`templates/scripts/`に置かない設計方針そのものは正しい**（§冒頭参照）が、
> コピー元（partnership/fujisan/Exosomeのどれか）が未確認のため、実際にコピーする前に
> `partnership_program_website`等で同名ファイルの実在を確認すること。特に
> `verify-reviewer-account.mjs`はフォールバックなしの必須呼び出しのため、
> コピーを忘れると新規アプリのCIが`MODULE_NOT_FOUND`で赤落ちする。

> ⚠️ コピー元が P と F で分かれるのは、P=認証込みのリリースCI完成形 / F=黒画面ゲート+版bumpの
> 汎用版(プレイブックは F ベース)という分担のため。**コピー前に実物の存在を確認**してから cp すること
> (ファイル名は時期で変わりうる。例: P の版bumpは `appstore-release-now.mjs` で命名が違う)。

> ⚠️ **輝度ゲート(`ios-blackscreen-check.yml`)をコピーしたら、必ず発明B(`ios-sim-logscan.mjs`)を
> 組み込む**。手順は [`../_docs/INVENTION-B-blackscreen-evidence.md`](../_docs/INVENTION-B-blackscreen-evidence.md)。
> Secrets 一覧・初回セットアップ・落とし穴は [`../_docs/release-pipeline-playbook.md`](../_docs/release-pipeline-playbook.md) §5〜§8。

> 📌 **コピーしたCIは定期的に partnership と diff せよ**。partnership 側が Xcode/SDK 追従で
> 更新されたら取り込む(これがテンプレ陳腐化を防ぐ「コピー手順だけ方式」の運用条件)。

## 実証済みの参照アプリ(金型の出どころ)

- `../../partnership_program_website` — 金型本体(リバースハック)。capacitor.config.json は server.url、patch は2点だけ。
- `../../fujisan-clean` — 黒画面を2ヶ月かけて解決した記録(`_docs/POSTMORTEM-ios-blackscreen.md` / `AGENTS.md`)。**触らない**(解決済み・安定)。
- `../../Exosome` — server.url 連動型の最小実物。

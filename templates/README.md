# templates/ — Capacitor 連動型アプリの金型

このディレクトリは、`app.config.json` を埋めれば iOS/Android アプリを作れるようにするための
**金型(実証済みテンプレート)**。リバースハック(partnership)/ 富士山 / Exosome で実際に
ストア配信されている server.url リモート読込型の構成を、アプリ非依存に一般化したもの。

> ⚠️ まず [`../_docs/CAPACITOR-GOLDEN-RULES.md`](../_docs/CAPACITOR-GOLDEN-RULES.md) を読むこと。
> 黒画面を二度と起こさない6原則。これを破ると富士山の2ヶ月の轍を踏む。

## 中身

| パス | 役割 | アプリ固有値の扱い |
| --- | --- | --- |
| `scripts/setup-new-app.mjs` | **立ち上げウィザード(まずここ)**。app.config 検証→資産生成→TWA案内→Secrets/手動GUI一覧 | 無改変(app.config.json 駆動・`node scripts/setup-new-app.mjs --dry-run` 可) |
| `capacitor/capacitor.config.template.ts` | Capacitor 設定の金型(server.url 連動型) | `{{bundleId}}` 等を app.config.json の値に置換 |
| `scripts/patch-ios-launch-dark.mjs` | iOS 起動フラッシュ対策(2点だけ・独自VC無し) | **無改変で使える**(背景色 #0A0A0F 固定) |
| `workflows/ios-shell-guardrail.yml` | 独自ネイティブ注入の再混入を CI で赤にするガード | 無改変(禁止パターンはアプリ非依存に一般化済み) |
| `scripts/lint-pre-submission.mjs` | 審査前 lint(実証済み Apple 却下ベクタを CI で検出) | **無改変**(app.config.json + env 駆動。無いファイルは skip) |
| `scripts/capture-appstore-screenshots.mjs` | App Store スクショ自動撮影(ログイン後・fail-closed) | **無改変**(撮影計画は `store-assets/screenshot-plan.json`) |
| `scripts/capture-play-screenshots.mjs` | Google Play スクショ自動撮影(Android FHD) | **無改変**(iOS と同じ screenshot-plan.json を共有) |
| `scripts/frame-appstore-screenshots.mjs` | 生スクショを仕上げ加工(キャプション帯・角丸・影) | **無改変**(キャプションは screenshot-plan.json の framedCaptions) |
| `scripts/screenshot-plan.example.json` | 撮影計画のひな形 | リポの `store-assets/screenshot-plan.json` にコピーして編集 |
| `scripts/lib/app-config.mjs` | app.config.json 取得口(`cfg()` / `productionUrl()` / `isPlaceholder()`) | 無改変 |
| `web/` | **Web→アプリDL導線**(公式バッジ取得・UA出し分け・Smart App Banner・CSS)。詳細は [`web/README.md`](web/README.md) | `{{ascAppId}}`/`{{playPackageName}}`/`{{productionUrl}}`/`{{primaryColor}}`/`{{accentColor}}` を置換 |

> 📚 **Apple 却下が来たら** [`../_docs/apple-reject-knowledge-base.md`](../_docs/apple-reject-knowledge-base.md) を見る。
> 「却下パターン → 原因 → **実際に通った返信文**」を集約(リバースハック partner v1.0.0〜v1.0.9 の実例、固有名は一般化)。
> `lint-pre-submission.mjs` の各チェックはこの KB のガイドライン番号に対応する。

> 🖼 **スクショ自動化の使い方**: (1) `screenshot-plan.example.json` をリポの `store-assets/screenshot-plan.json`
> にコピーして撮るページ/キャプション/ログイン手順を書く → (2) capture で生スクショ → (3) frame で仕上げ →
> (4) `lib/asc-screenshot-upload.mjs`(release CI)で **delete-then-reupload**。ログイン認証アプリは
> `IOS_REVIEW_DEMO_USERNAME`/`_PASSWORD` を CI Secret に。`authTabs` を空にすればログイン不要アプリ扱い(creds 不要)。

## 使い方(連動型アプリを新規に作る)

1. アプリのリポジトリで `app.config.json` を埋める(identity / brand / contact / businessModel)。
2. `capacitor.config.template.ts` の `{{...}}` を app.config.json の値に置換して
   そのリポの `capacitor.config.ts` を作る。
   - `{{bundleId}}` = identity.bundleId / `{{displayName}}` = identity.displayName
   - `{{iosScheme}}` = identity.iosScheme / `{{productionDomain}}` = identity.productionDomain
   - `{{rootDomain}}` = productionDomain のルート(例: app.example.com → example.com)
   - `{{backgroundColorARGB}}` = 起動下地色 ARGB8(金型実績は `#0A0A0FFF`)
3. `scripts/patch-ios-launch-dark.mjs` と `workflows/ios-shell-guardrail.yml` をリポにコピー。
4. `@capacitor/{cli,core,ios,android}` を devDependencies に追加。
5. `npm install` → `npx cap add ios` / `npx cap add android`(Xcode / Android SDK が要る)。
6. **リリースCI/スクリプト本体を partnership からコピー**(下記マッピング表)。
   配信前に輝度ゲートを通す → リリース CI で配信。

## リリースCI/スクリプトのコピー元マッピング(会議推奨=キットに二重保守しない)

リリースの「実体」(ストアへ送るCI・スクリプト)は**このキットに置かない**。Apple/Google が
審査要件を頻繁に変えるため、テンプレ版を抱えると古びて新規アプリだけ審査落ちする
(発明会議で「製造機化」は reject)。代わりに**動く現物 `partnership_program_website` から
コピー**する。コピー後、`app.config.json` の値で数か所書き換え + GitHub Secrets を登録。

コピー元はファイルごとに partnership / fujisan に分かれる(実物で確認済み 2026-06-10)。
P=`partnership_program_website`、F=`fujisan-clean`。

| コピー元 | 自リポの置き場所 | 書き換える値 |
| --- | --- | --- |
| **P** `.github/workflows/ios-appstore-release.yml` | `.github/workflows/` | `env: APP_BUNDLE_ID` / `APP_NAME` |
| **P** `.github/workflows/android-play-release.yml` | `.github/workflows/` | `env: PLAY_PACKAGE_NAME` |
| **F** `.github/workflows/ios-blackscreen-check.yml`(輝度ゲート本体・Pには無い) | `.github/workflows/` | `APP_BUNDLE_ID` + 発明B3点(下記) |
| **F** `.github/workflows/ios-shell-guardrail.yml`(or 本キットの汎用版) | `.github/workflows/` | 無改変 |
| **P** `scripts/lib/asc-api.mjs` / `scripts/lib/play-api.mjs` | `scripts/lib/` | 無改変(env で制御) |
| **P** `scripts/appstore-submit.mjs` / `scripts/play-publish.mjs` | `scripts/` | 冒頭の `BUNDLE_ID`/`PACKAGE` 既定値 |
| **F** `scripts/release-bump.mjs`(版+SWキャッシュ bump・Pは別命名) | `scripts/` | SWキャッシュ regex の prefix |
| 本キット `templates/scripts/ios-sim-logscan.mjs`(発明B) | `scripts/` | 無改変 |

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

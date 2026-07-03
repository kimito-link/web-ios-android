# templates/android-twa — Android TWA（Bubblewrap）の金型

`app.config.json` を埋めれば、Web サイトをそのまま **Trusted Web Activity (TWA)** として
Google Play に配信できるようにする金型。リバースハック(partnership) / Exosome で実際に
Play 配信されている構成を、アプリ非依存に一般化したもの。

TWA は Capacitor とは別系統。Android は「Web をネイティブシェルで包む」のに
**Bubblewrap (TWA)** を使い、iOS は Capacitor（`../capacitor/`）を使う、という分担。

> ⚠️ **署名鍵 (`android-upload-key.jks`) はこの金型に含まれない／コピーしない。**
> 鍵はアプリごとに `../scripts/create-android-keystore.ps1` で生成し、安全にバックアップする。
> 鍵を失うと既存アプリを二度と更新できない（Play が同じ鍵での署名を要求するため）。

> ℹ️ 署名鍵の生成(`create-android-keystore.ps1`)・指紋表示(`print-android-fingerprint.ps1`)・
> 署名注入(`android-patch-signing.mjs`)の3本は **TWA/Capacitor 共用の汎用スクリプト**なので
> `templates/scripts/` 直下にある（`android-patch-signing.mjs` は `--gradle`/`--keystore` 引数で
> TWA(`android-twa/app/build.gradle`)/Capacitor(`android/app/build.gradle`)どちらも指定可）。
> このディレクトリの `scripts/` には TWA 固有の `build-android-aab.ps1` のみ残っている。

---

## 中身

| パス | 役割 | アプリ固有値の扱い |
| --- | --- | --- |
| `twa-manifest.json` | TWA manifest の見本／上書き用 | `<...>` を app.config.json の値に置換（通常は bubblewrap init が自動生成） |
| `gradle.properties` | OneDrive 非ASCII パス対策込みの Gradle 設定 | 無改変（`overridePathCheck` を必ず残す） |
| `keystore.properties.example` | 署名パスワード設定の見本 | 値を埋めるか keystore 生成スクリプトが自動生成 |
| `assetlinks.json.example` | Digital Asset Links の見本 | `package_name` / SHA256 を置換。本番サイトの `/.well-known/` に配信 |
| `bubblewrap-config.json.example` | JDK/SDK パス設定の見本 | マシンごとのパスに置換 |
| `gitignore.snippet` | 鍵・成果物を除外する .gitignore 追記分 | そのまま追記 |
| `scripts/build-android-aab.ps1` | Release AAB をビルド（**無改変**） | アプリ固有値なし |
| `../scripts/android-patch-signing.mjs` | init/update 後に署名ブロックを注入（`--gradle`/`--keystore` 引数対応） | アプリ固有値なし |
| `../scripts/create-android-keystore.ps1` | 署名鍵 + keystore.properties を `.secrets-local/` に生成 | `-DistinguishedName` を渡す |
| `../scripts/print-android-fingerprint.ps1` | SHA256 指紋を表示（assetlinks 用、**無改変**） | アプリ固有値なし |

`app/`（Java・Gradle wrapper・res/アイコン）は **`bubblewrap init` が自動生成する**ので
金型には含めない（手でコピーすると古い AGP/依存で陳腐化する）。金型が持つのは
「init では再現されない durable な入力」＝ manifest / 署名 / gradle 設定 / ps1 だけ。

---

## 前提（一度だけ用意するもの）

- **Node.js** + `@bubblewrap/cli`（`npm i -D @bubblewrap/cli`）
- **JDK 17**（bubblewrap が doctor で portable JDK を入れることもある）
- **Android SDK**（`bubblewrap doctor` の指示に従う）
- **本番サイトが PWA manifest を配信**していること
  （`https://<productionDomain>/manifest.webmanifest`。`name` / `icons`(512px) / `start_url` / `display:standalone` を含む）

JDK/SDK のパスは `bubblewrap-config.json.example` を `.bubblewrap-config.json` にコピーして
自分の環境に合わせる（ps1 が JAVA_HOME 未設定時のフォールバックに使う）。

---

## 手順（新規アプリで TWA を作る）

### 0. app.config.json を埋める
`identity.productionDomain` / `stores.playPackageName`（= `bundleId` と同じで可）/
`brand.primaryColor` / `identity.displayName`。

### 1. bubblewrap init（android-twa/ を自動生成）
```
npx @bubblewrap/cli init --manifest=https://<productionDomain>/manifest.webmanifest --directory=./android-twa
node scripts/android-patch-signing.mjs
```
- 対話で packageId / launcherName / 色などを聞かれる → app.config.json の値で答える。
- init が `android-twa/` 一式（`app/`・Gradle・アイコン）を生成する。
- 直後に **必ず** `android-patch-signing.mjs` を実行（署名ブロック注入。これを忘れると無署名 AAB → Play 拒否）。
- `gradle.properties` に `android.overridePathCheck=true` が無ければ本金型の `gradle.properties` から補う
  （OneDrive\デスクトップ など非ASCII パス配下で必須）。

### 2. 署名鍵を作る（アプリごとに一度だけ・最重要）
```
pwsh scripts/create-android-keystore.ps1 -DistinguishedName "CN=<運営者名>, O=<会社名>, L=Tokyo, C=JP"
```
- `android-twa/android-upload-key.jks` と `keystore.properties`（BOM なし UTF-8）を生成。
- **生成した jks は安全な場所にバックアップ**。`.gitignore` に入れて絶対に commit しない（`gitignore.snippet` 参照）。

### 3. SHA256 指紋を assetlinks.json に反映
```
pwsh scripts/print-android-fingerprint.ps1
```
- 表示された `SHA256` を `assetlinks.json.example` の `sha256_cert_fingerprints[0]` に入れ、
  `_README` キーを削除して**本番サイトの `/.well-known/assetlinks.json`** として配信する
  （`package_name` は `stores.playPackageName`）。
- これで TWA がアドレスバー無しのフルスクリーンで起動する（リンク検証が通る）。
- ⚠️ **Play App Signing 有効時**（初回アップロード後）は、ローカル upload key ではなく
  **Play Console「アプリの署名」→「アプリ署名鍵証明書」の SHA256** を assetlinks に使う。

### 4. Release AAB をビルド
```
pwsh scripts/build-android-aab.ps1          # 通常
pwsh scripts/build-android-aab.ps1 -Clean   # クリーンビルド（OneDrive ロック時は避ける）
```
- 生成物: `android-twa/app/build/outputs/bundle/release/app-release.aab`
- これを Play Console にアップロード（または partnership の `play-publish.mjs` で自動アップロード）。

### 5. 更新（Web に変更があったとき / バージョン上げ）
```
npx @bubblewrap/cli update --directory=./android-twa
node scripts/android-patch-signing.mjs
```
- TWA は server.url 連動型なので Web の中身だけの変更なら再ビルド不要（端末は本番サイトを読む）。
- **manifest（色・名前・アイコン）やバージョンを変えたとき**だけ update → patch-signing → build → アップロード。
- `update` は build.gradle を再生成するので patch-signing の再実行が必須（冪等なので二度打ちしても安全）。

---

## package.json への推奨スクリプト（コピペ）
```jsonc
{
  "scripts": {
    "android:twa:init": "bubblewrap init --manifest=https://<productionDomain>/manifest.webmanifest --directory=./android-twa && node scripts/android-patch-signing.mjs",
    "android:twa:update": "bubblewrap update --directory=./android-twa && node scripts/android-patch-signing.mjs",
    "android:twa:patch-signing": "node scripts/android-patch-signing.mjs",
    "android:keystore": "pwsh scripts/create-android-keystore.ps1",
    "android:fingerprint": "pwsh scripts/print-android-fingerprint.ps1",
    "android:bundle": "pwsh scripts/build-android-aab.ps1"
  }
}
```
（`<productionDomain>` を app.config.json の `identity.productionDomain` に置換）

---

## 落とし穴（実物で踏んだ教訓）

- **無署名 AAB で Play 拒否**: bubblewrap は signingConfig を生成しない。init/update の直後に
  必ず `android-patch-signing.mjs` を走らせる。`android:twa:init` のように `&&` で連結しておくと安全。
- **keystore.properties が BOM 付きだと Gradle が NPE**: 必ず BOM なし UTF-8 で書く
  （`create-android-keystore.ps1` は BOM なしで書き出す。手で編集するなら注意）。
- **OneDrive\デスクトップ 配下のビルド失敗**: `gradle.properties` に `android.overridePathCheck=true` を残す。
- **assetlinks の指紋ミスでアドレスバーが消えない**: Play App Signing 有効後はローカル鍵ではなく
  Play Console の「アプリ署名鍵証明書」SHA256 を使う。反映後、本番サイトに配信されているか
  `https://<productionDomain>/.well-known/assetlinks.json` を直接開いて確認。
- **clean が OneDrive のファイルロックで失敗**: 既定で clean はスキップ。必要時だけ `-Clean`。
- **鍵の紛失 = 詰み**: jks を失うと既存 Play アプリを更新できない。生成直後にバックアップする。

---

## 提出まで通すなら（実体験プレイブック）

このREADMEは `android-twa/` を**生成する**手順。生成後に **Play Console へ提出して審査に出す**
全工程（bubblewrap 対話CLIを winpty で突破／packageId のドメイン逆順罠／Play Console 必須申告
11項目の実値＝データセーフティ・コンテンツレーティング・対象年齢など）は
**`../../_docs/google-play-submission-playbook.md`** に追体験記録として残してある。次のアプリは
そちらを併読すると最短で通せる。

---

## 実証済みの参照アプリ（金型の出どころ）

- `../../../Exosome/android-twa` — TWA の最小実物（manifest / app build.gradle の署名注入後の姿）。
- `../../../Exosome/scripts/android-patch-signing.mjs` — 署名注入スクリプトの本体。
- `../../../partnership_program_website/scripts/{create-android-keystore,print-android-fingerprint,build-android-aab}.ps1` — Windows ビルド/署名 ps1 の本体。

> これらの稼働リポは**読み取り専用**。金型を更新するときは現物を読んで diff を取り込む
> （手でコピーした `app/` を抱えず、init 再生成 + patch 方式を保つ）。

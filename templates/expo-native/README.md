# expo-native — Expo prebuild でネイティブアプリを出す金型

**React Native (Expo) のアプリを、WebView に頼らずネイティブとして iOS / Android
の両ストアに出す**ための金型。`surechigai-romi.link` で実際に両ストアへ通した構成をそのまま型化した。

出典: `surechigai-romi-link`（iOS 2026-08-07 移行 / Android 2026-08-11 内部テスト配信）

---

## いつこれを選ぶか

キットには Android の作り方が3つある。**中身が Web か、ネイティブか**で選ぶ。

| | TWA (`../android-twa/`) | Capacitor (`../capacitor/`) | **Expo prebuild（これ）** |
|---|---|---|---|
| **起動の速さ** | **JSの実行時パースが要る** | **同左** | **Hermes の事前コンパイル済みバイトコード** |
| 画面の中身 | Web を Chrome で表示 | Web を WebView で表示 | **ネイティブUI**（DOM が無い） |
| スクロール・タップ | ブラウザ合成（DOM 再レイアウトが残る） | 同左 | **OS ネイティブの慣性・応答** |
| 元になるコード | Web サイト | Web サイト | **React Native のコード** |
| アプリ内課金 | **組み込めない** | 可能 | 可能 |
| OAuth ログイン | 制約あり（下記） | **制約あり（下記）** | `ASWebAuthenticationSession` で解決 |
| 作る手間 | 軽い | 中 | 重い（ネイティブ設定が要る） |

### 一番の理由は「軽さ」。WebView 方式では構造的に届かない

`surechigai-romi.link` がネイティブへ移った動機はこれ。
Loop Habit Tracker のような**ネイティブアプリの軽さ**を目標にしたが、
Capacitor で包む方式では**正面から応えられない**という結論だった。

差の本体は2つ:

1. **UI がネイティブビューであること**
2. **Web 資産のダウンロード / パース / レイアウトが無いこと**

WebView 方式は JS を**実行時にパース**する（設計時の調査で挙がった
「1MB で 13 秒」はこれ）。Expo prebuild は Hermes が事前コンパイルした
バイトコードを実行するので、この工程自体が存在しない。

> **Capacitor ↔ ネイティブの差は「秒」の世界。**
> ちなみに SwiftUI とのさらなる差は「ミリ秒〜数百ミリ秒」で桁が違うため、
> React Native のコードベースを持っているなら SwiftUI 移行のリターンは無い
> （`surechigai-romi.link/docs/native-ios-app-DESIGN.md` で検討し却下済み）。

### 副次的に、OAuth の制約も解ける

WebView 方式は、ソーシャルログインでも詰む場面がある。

- **Google** は WebView からの OAuth を `disallowed_useragent` で拒否する
- **Apple** は iOS 17 以降、WKWebView での Sign in with Apple を塞いだ

`surechigai-romi.link` はこれで App Store の **Guideline 4 却下**も受けている。
prebuild なら OS 標準の `ASWebAuthenticationSession` が使われるので構造的に解消する。

> これは「WebView 依存が残る」ではなく「OS の認証標準に乗る」。
> 認証シートは数秒だけ現れて消えるもので、**アプリのレンダリング面ではない**。

---

## 中身

| ファイル | 役割 | アプリ固有値の扱い |
|---|---|---|
| `android-play-release.yml` | prebuild → 署名 → AAB → Play へアップロード | `<PLAY_PACKAGE_NAME>` `<PRODUCTION_DOMAIN>` を置換 |
| `ios-appstore-release.yml` | prebuild → 署名 → IPA → App Store へアップロード | `<APP_BUNDLE_ID>` `<PRODUCTION_DOMAIN>` を置換 |
| `android-patch-signing.mjs` | release 署名を build.gradle に注入（TWA/Expo 両対応） | **無改変** |
| `generate-play-graphics.mjs` | Play 用アイコン512/フィーチャーグラフィック生成 | 文言とブランド色を編集 |
| `asset-name-collision.test.ts` | 拡張子違いの同名画像を検出（下記の地雷） | **無改変** |

`android/` `ios/` は **どちらも .gitignore する**。CI で `expo prebuild` して毎回作り直す。

---

## 踏んだ地雷（同じ失敗をしないために）

実際に本番で踏んだものだけを書く。

### 1. versionCode / CFBundleVersion が固定値になる

`expo prebuild` は毎回 `versionCode 1` / `CFBundleVersion "1"` を書く。
CI で `rm -rf android` するので、手で直しても消える。

初回は通るが、**2回目のアップロードでストアが重複を拒否**する。
両ワークフローとも `GITHUB_RUN_NUMBER` で採番するステップを持たせてある。

> ⚠️ iOS では「注入したはずの値が生成物に入らず 5 連続で提出失敗」した。
> pbxproj に書いても Info.plist はリテラル値を持っていたのが原因。
> **書き込んだ後に必ず読み返して検証**すること（両テンプレとも実装済み）。

### 2. 署名設定の判定を正規表現でやると誤検知する

`expo prebuild` が生成する `build.gradle` は **すでに `signingConfigs { debug {...} }` を持つ**。
ここで

```js
/signingConfigs\s*\{[\s\S]*?\brelease\s*\{/
```

のような正規表現を使うと、`signingConfigs` を**飛び越えて** `buildTypes` 内の
`release {` にマッチし、「release はもうある」と誤判定する。
結果 `buildTypes` だけが `signingConfigs.release` を参照する gradle ができ、

```
Could not get unknown property 'release' for SigningConfig container
```

で落ちる。**スクリプト自身は「done」と出す**ので緑のまま壊れたものが出荷される。
`android-patch-signing.mjs` は波括弧を数えてブロックを切り出す方式にしてある。

### 3. 拡張子違いの同名画像で Duplicate resources

Android は assets を drawable に変換するとき**拡張子を落として**リソース名にする。

```
assets/images/logo.webp ┐ どちらも
assets/images/logo.jpg  ┘ assets_images_logo
```

Metro は `assets/` 配下を**参照の有無に関わらず**バンドルするので、
どこからも import していない画像でも衝突する。
**Web と iOS では起きず、Play に出すまで気づけない。**
`asset-name-collision.test.ts` を CI に入れておくこと。

### 4. Play のストア言語

Play Console でアプリを作るとき、デフォルト言語が `en-US` のまま作られることがある。
`play-fill-listing.mjs` の既定は `ja-JP` なので、そのままだと投入先が食い違う。
先に `ja-JP` の掲載情報を作っておくこと。

---

## Play Console 側で、どこまで自動化できるか（2026-08-11 実測）

「API が無い」と諦める前に、`../scripts/` を見ること。手作業だと思われている項目のうち、
**データセーフティは完全自動化できる**。

| 項目 | 手段 |
|---|---|
| ストア掲載情報・グラフィック・スクショ | `play-fill-listing.mjs` |
| AAB アップロード・トラック投入 | `play-publish.mjs` |
| **データセーフティ（約50問）** | **`play-generate-data-safety-csv.mjs` → `play-fill-data-safety.mjs`** |
| コンテンツレーティング(IARC) / 対象年齢 / アプリのコンテンツ / 審査送信 | **Play Console の UI**（下記） |

`androidpublisher` の `contentRating` / `targetAudience` / `appContent` は
**実際に叩くと全て HTTP 404**。Google がエンドポイントを公開していない。
ここだけは UI で埋める（11項目の実例は `../../_docs/google-play-submission-playbook.md` §2）。

> ⚠️ `play-generate-data-safety-csv.mjs` の `ANSWERS` は**アプリごとに書き直す**。
> 移植元の回答をそのまま使うと**虚偽申告になる**。スキーマを実測して、
> 収集している列だけを TRUE にすること。

---

## 使い方

1. このディレクトリの `*.yml` を `.github/workflows/` にコピーし、`<...>` を実値に置換
2. `*.mjs` と `*.test.ts` を `scripts/` と `__tests__/` にコピー
3. `.gitignore` に `/android` `/ios` を追加
4. Secrets を登録（`../workflows/` の各テンプレ冒頭に一覧がある）
5. `workflow_dispatch` で手動実行

Play 側の初回は、ストア掲載情報の素材が揃っていないと最後の投入ステップで落ちる。
`store-assets/play/listing-copy.md`（`## 詳しい説明` の fenced block 必須）と
`app.config.json` の `identity.shortDescription` を先に用意すること。

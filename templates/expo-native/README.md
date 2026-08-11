# expo-native — Expo prebuild でネイティブアプリを出す金型

**React Native (Expo) のアプリを、WebView に頼らずネイティブとして iOS / Android
の両ストアに出す**ための金型。`surechigai-romi.link` で実際に両ストアへ通した構成をそのまま型化した。

出典: `surechigai-romi-link`（iOS 2026-08-07 移行 / Android 2026-08-11 内部テスト配信）

---

## いつこれを選ぶか

キットには Android の作り方が3つある。**中身が Web か、ネイティブか**で選ぶ。

| | TWA (`../android-twa/`) | Capacitor (`../capacitor/`) | **Expo prebuild（これ）** |
|---|---|---|---|
| 画面の中身 | Web を Chrome で表示 | Web を WebView で表示 | **ネイティブUI**（DOM が無い） |
| 元になるコード | Web サイト | Web サイト | **React Native のコード** |
| 起動の速さ | Web 資産の取得・描画が要る | 同左 | **速い**（JSバンドルのみ） |
| アプリ内課金 | **組み込めない** | 可能 | 可能 |
| OAuth ログイン | 制約あり（下記） | **制約あり（下記）** | `ASWebAuthenticationSession` で解決 |
| 作る手間 | 軽い | 中 | 重い（ネイティブ設定が要る） |

### OAuth の制約は「好み」ではなく構造的な問題

WebView 方式は、ソーシャルログインで詰む場面がある。

- **Google** は WebView からの OAuth を `disallowed_useragent` で拒否する
- **Apple** は iOS 17 以降、WKWebView での Sign in with Apple を塞いだ

`surechigai-romi.link` はこれで App Store の **Guideline 4 却下**を受け、
Capacitor から Expo prebuild へ移行した。prebuild なら OS 標準の
`ASWebAuthenticationSession` が使われるので、**構造的に解消する**。

> ログインに Google / Apple を使うなら、WebView 方式は最初から避けたほうがいい。

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

## 使い方

1. このディレクトリの `*.yml` を `.github/workflows/` にコピーし、`<...>` を実値に置換
2. `*.mjs` と `*.test.ts` を `scripts/` と `__tests__/` にコピー
3. `.gitignore` に `/android` `/ios` を追加
4. Secrets を登録（`../workflows/` の各テンプレ冒頭に一覧がある）
5. `workflow_dispatch` で手動実行

Play 側の初回は、ストア掲載情報の素材が揃っていないと最後の投入ステップで落ちる。
`store-assets/play/listing-copy.md`（`## 詳しい説明` の fenced block 必須）と
`app.config.json` の `identity.shortDescription` を先に用意すること。

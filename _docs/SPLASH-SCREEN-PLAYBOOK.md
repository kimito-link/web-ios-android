# 起動画面（スプラッシュ）を綺麗に出す

> 出どころ: `surechigai-romi.link` で 2026-08-23 に実際に踏んだ事故と、その解決。
> 同じ作者の他アプリ（`partnership_program_website` / `Exosome` / `fujisan-clean`）は
> 綺麗に出ているのに1つだけ汚い、という比較から真因を特定した。

---

## ★まず結論（これだけ守れば防げる）

1. **画像は透過PNG。背景を焼き込まない。** 背景色は設定で指定する。
2. **絵柄は安全円（画像の内側 約67%）に収める。** はみ出すと Android が切る。
3. **スプラッシュの背景色と、アプリ本体の地色を揃える。** 違うとチカつく。

---

## 実際に起きたこと

起動すると「**濃紺の円**」が出ていた。ロゴではなく、ただの色付きの円。

### 真因

`expo-splash-screen` は **288dp のキャンバスに画像を中央合成し、背景はプラグインが敷く**
（`@expo/prebuild-config/.../withAndroidSplashImages.js`）。

そこへ「**背景を焼き込んだ不透過の正方形**」を渡していた。すると:

1. 288dp キャンバス全面がその色で埋まる
2. **Android 12+ が起動画面のアイコンを円形にトリミングする**
3. → 「色の付いた円」になる

### 実測値

| | 旧（不透過） | 新（透過） |
|---|---|---|
| 絵柄の bbox | 287 × 287 dp | 103 × 91 dp |
| 半対角 | **202.9 dp** | **68.5 dp** |
| 安全円の半径 | 96.0 dp | 96.0 dp |
| 判定 | ★大幅にはみ出し | ✓ 収まる |

安全円は Android 公式の数値。**288dp キャンバスに直径 192dp**。
出典: https://developer.android.com/develop/ui/views/launch/splash-screen

---

## ★なぜ「他のアプリは綺麗」だったのか（重要）

方式が違うだけで、どちらが正しいという話ではない。

| | Capacitor 系 | Expo prebuild 系 |
|---|---|---|
| 素材 | **2732×2732 の全面1枚絵**（背景ごと絵） | **透過ロゴ**を中央配置 |
| 背景 | 画像に含まれる | 設定の `backgroundColor` |
| 円形マスク | かからない | ★**Android 12+ でかかる** |

★**Capacitor の作り方（全面絵）を Expo にそのまま持ち込むと、この事故が起きる。**
移行したリポで特に危ない。

### ★移行後は「死んだ設定」に注意

`surechigai` は Capacitor から Expo prebuild へ移行済みだったが、
`capacitor.config.json` の `SplashScreen` 設定が**そのまま残っていた**。
しかも動いている3リポとほぼ同じ内容なので、
「**同じ設定なのになぜ違う？**」と誤読しかけた。

★移行後は、**どの設定ファイルが実際に読まれているか**をワークフローで確認すること。

---

## 正しい作り方

### 1. 素材（透過PNG）

```python
# 背景は透過。絵柄は安全円の内側に収める。
canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))   # ★透過
safe_ratio = 192.0 / 288.0                                # Android 公式
target = int(size * safe_ratio / (2 ** 0.5))              # 正方形を円に内接
```

- **1024×1024**（Expo 公式の推奨）。Android xxxhdpi は **4x** なので、
  `imageWidth: 240` なら 960px 必要。1024 あればアップスケールが起きない。
- 出典: https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/

### 2. 設定

```ts
[
  "expo-splash-screen",
  {
    image: "./assets/images/splash-icon.png",  // ★透過PNG
    imageWidth: 240,                            // ★dp（px ではない）
    resizeMode: "contain",
    backgroundColor: "#E2EDF7",                 // ★本体の地色と揃える
  },
]
```

**`imageWidth` の決め方**（実測から逆算する）:

```
安全円の半径 96dp ÷ 絵柄の半対角 = 拡大できる倍率
★ぎりぎりは避け、余裕の8割程度に留める（機種で円の扱いに差がある）
```

★**不透過のままだと `imageWidth ≤ 136` が数学的上限**（192 ÷ √2）。
透過にして初めて大きくできる。

### 3. チカつき対策

起動時に色が変わると「チカッ」と見える。**次の4箇所を揃える**:

| 箇所 | 例 |
|---|---|
| ネイティブ splash の `backgroundColor` | `#E2EDF7` |
| アプリ本体のルート地色 | `#E2EDF7` |
| PWA `manifest.json` の `background_color` | `#E2EDF7` |
| Web のスプラッシュ画像の地色 | `#E2EDF7` |

★`surechigai` は**4箇所のうちネイティブだけが濃紺**で、
起動直後に濃紺→ほぼ白へ切り替わっていた。

さらに、JS 側でスプラッシュを握ると滑らかになる:

```js
SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 400, fade: true }); // fade は iOS のみ
// 準備完了後
await SplashScreen.hideAsync();
```

---

## 検査

`templates/scripts/check-splash-safe-circle.mjs` を同梱している。

```bash
node scripts/check-splash-safe-circle.mjs --selftest   # 毒→赤 を確認
node scripts/check-splash-safe-circle.mjs              # 本体
```

見ること:
1. 素材が**透過PNG**か
2. 絵柄が**安全円の内側**か

★**見ないこと**（出力にも明記している）:
- iOS 側（Storyboard には円形マスクが無い）
- 実機の見え方そのもの（色・大きさの好み）

★既存の `verify-*-splash-not-default.mjs` は「**既定画像のまま出荷していないか**」を見る。
こちらは「**素材の作り方が正しいか**」を見る。**役割が違うので両方要る。**

---

## ★Capacitor用の完全検査（2026-08-24追加）

Capacitor系は「全面1枚絵」方式ですが、画像を用意しただけでは不十分です。
このキットでは次の6ファイルを正本として配り、CIからも同じ検査を実行します。

| ファイル | 役割 |
|---|---|
| `generate-capacitor-splash.mjs` | 2732×2732の通常版・ダーク版を同じ条件で生成 |
| `check-splash-config.mjs` | Androidの引き伸ばし、背景色、プラグイン設定を確認 |
| `check-splash-dark-variant.mjs` | 通常版とダーク版が名前だけでなく実際に違うか確認 |
| `check-splash-template-drift.mjs` | 各アプリへコピーした検査が正本から古くなっていないか確認 |
| `run-splash-gates.mjs` | 赤・黄・緑をまとめ、1件でも赤なら赤として終了 |
| `lib/splash-manifest.mjs` | 正本の版と、配布対象ファイルを1か所で管理 |

```bash
npm run splash:selftest  # 検査自体が壊れていないか確認
npm run splash:generate  # 通常版・ダーク版を生成
npm run splash:check     # 設定・素材・版ずれをまとめて確認
```

Android / iOS の出荷ワークフローも `run-splash-gates.mjs --skip-drift` を実行します。
CI内では正本との差を取る場所が無い場合があるため版ずれだけ省き、設定と素材は必ず検査します。

★**限界**: 全部緑でも、実機で見える色・大きさ・切り替わりの好みまでは分かりません。
最後にiPhone・Android実機で1回ずつ目視し、未確認なら未確認のまま残します。

---

## ★測るときの落とし穴（2回間違えた）

プラグインは `backgroundColor` を**キャンバスに合成する**ので、
生成物（`drawable-*/splashscreen_logo.png`）の**アルファは 255 になる**。

これを「不透過＝未修正」と読んで、**直っているのに「はみ出し」と2回報告した**。

★**背景色を除いて、絵柄だけの bbox を測るのが正しい。**
最終的には**画像を目視して**気づいた。数字だけ見ていると逆の結論になる。

---

## 未確認

- **iOS 実機での見え方**。`ios/` は CI 生成のため手元で作れず、コード読解ベース。
  仕組み上 Storyboard には円形マスクが無いので Android より安全だが、実機未確認。
- Expo 公式 Figma テンプレートの実寸（ドキュメントに記載なし）。
- Expo 公式による `imageWidth` の推奨レンジ（記載なし。上記は Android 仕様からの導出）。

---

## 出典

- https://docs.expo.dev/versions/latest/sdk/splash-screen/
- https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/
- https://developer.android.com/develop/ui/views/launch/splash-screen
- https://github.com/expo/expo/issues/38851 （円形マスクは変更できない、とメンテナが回答）

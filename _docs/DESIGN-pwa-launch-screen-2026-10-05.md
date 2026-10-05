# PWA の起動画面は「地色1色をそろえる」

> **今の到達点: 実装・本番検証済み（surechigai）／金型の検査も反転済み（2026-10-05）／他サービスへの適用は未着手**
>
> 出典: `surechigai-romi.link`（PR #61、2026-10-05 マージ・デプロイ済み）。
> 入口はこのファイル。ai-hub 側の短い版は `../ai-hub/kb/pwa-launch-screen-one-color.md`、
> 計測の手順は [`docs/ai-workflows/EMULATOR-VERIFY-HOWTO.md`](../docs/ai-workflows/EMULATOR-VERIFY-HOWTO.md)
> の「Android 実機で PWA(WebAPK) の起動を測る」。

## 用語（初出の一言説明）

- **PWA**: ホーム画面に追加して、アプリのように開く Web アプリ。ストアを通らない。
- **manifest**: PWA の名前・アイコン・色などを書く JSON ファイル（`manifest.json`）。
- **WebAPK**: Android の Chrome が、PWA をホーム画面に追加するときに作る、アプリ本体（APK）。
  起動画面はこの APK が OS に頼んで出す。
- **ベール**: このリポが自作している、本編が読み込まれるまで全画面を覆う画面（ロゴ＋タイトル）。
- **地色**: 画面いっぱいに塗る背景の色。

## 判断

1. 起動画面は、**地色1色を3か所でそろえる**: アプリ本体の背景色／自作のベール（あれば）／
   `manifest.json` の `background_color`。
2. **`background_color` を外さない**。外すと Android(WebAPK) の OS 起動画面が白になり、
   次に出る自作ベールとの間で色が飛ぶ。
3. **iOS の起動画像（`apple-touch-startup-image`）は別の軸**として扱う。`background_color` の有無では
   説明できない（下の根拠）。

## 根拠

### 以前の説に一次情報が無かった

surechigai は 2026-08-27 に「manifest に `background_color` があると iOS 16.4+ が
`apple-touch-startup-image` を無視する」として `background_color` を削除していた。
2026-10-05 に調べ直したところ、この説に **Apple/WebKit の公式記述は見つからず**、
リポ内の根拠は次の2つだけだった:

- `kimito.link` の実機観察1件（OS のバージョンの記載なし）
- 静的検査（`check-pwa-splash.mjs`）の結果

### 説では現実を説明できなかった

`background_color` を外した状態の iPhone 実機録画（120fps）でも、起動の最初は黒で、起動画像は出なかった。
説どおりなら「外せば出る」はずだった。

### Android 実機の変更前後の実測

端末: moto g64y 5G／Android 15／Chrome 154 の WebAPK。
手順: WebAPK を入れ直し → 起動を `screenrecord` → `ffmpeg` で解析。
色は画面上部 1/5 の帯（アイコンの無い領域）の平均 RGB。

| | OS の起動画面（地色＋アイコン） | 自作のベール | 本編 | 色の飛び |
|---|---|---|---|---|
| 変更前（`background_color` なし） | #FFFEFF（白） | #E2EDF7 | 薄い青 | 白 → 薄い青 の飛びあり |
| 変更後（`#E2EDF7`） | #E3EDF8 | #E2EDF7 | 薄い青 | なし（2.6〜4.4 秒の上部帯は #E4EDF8 で一定） |

残る段差は**アイコンの大きさ**だけ（OS の起動画面は大きく、ベールは小さくタイトル付き）。
Android の OS 起動画面は `name`＋`background_color`＋`icons` から作られる（web.dev の説明）ので、
これ以上はアプリ側では触れない。

## 適用の仕方

- `manifest.background_color` ＝ アプリ本体の地色 ＝（自作ベールがあれば）ベールの色。
  surechigai の値は `#E2EDF7`。
- 検査は「あるか」ではなく「**あり、かつ本体の地色と一致**」を見る。
  surechigai は `scripts/check-pwa-splash.mjs` をこの向きに反転し、
  `__tests__/manifest-background-color.test.ts` が manifest・`app/+html.tsx` のベール・
  `BrandLoadingScreen`（`palette.kimitoBlueSoft`）の3か所の一致を見張る。
- ベールを解除する位置は「ルートのレイアウトのマウント」ではなく「最初の画面の中身のマウント後」
  にする（空白・灰色の骨組みが出る隙間を作らないため。surechigai の `lib/boot-veil.ts`）。これは色とは別の話。

## 未確認

iOS で `apple-touch-startup-image` が出ない原因は**未確定**。iPhone が手元に無く検証していない。候補:

1. iOS は**ホーム画面に追加した時点**の起動画像を使い続ける（追加し直さないと変わらない）
2. `apple-touch-startup-image` の `href` に付いている `?v=2`（`kimito.link` の href には付いていない）
3. iOS 26 の「全サイトが Web アプリとして開く」変更

認証済みで開いたときの待機画面も、契約テストでの確認のみで実測していない。

## 他の起動画面の例も手本にならない

本家 `kimito.link` は、起動画像が濃紺 #00427B の地＋ロゴ、次の本編は白っぽく、紺 → 白の飛びがある。
manifest に `background_color` は無い。

## 測り方

- Android 実機（USB 接続）: [`templates/scripts/measure-webapk-launch.sh`](../templates/scripts/measure-webapk-launch.sh)。
  使い方は EMULATOR-VERIFY-HOWTO の該当小節。前後を同じ手順で撮って比べる。
  このスクリプトは録画・タイル画像・明るさの変化点を出す。色の平均 RGB（上の表）は別途フレームから算出した。
- ブラウザ上の描画の空白: surechigai の `scripts/qa/measure-launch-timeline.mjs`（合否には入れない計測）。
- iOS: 実機が無いと測れない（Windows では iOS Simulator が使えない）。

## 関連ファイル

- surechigai: `scripts/check-pwa-splash.mjs`／`__tests__/manifest-background-color.test.ts`／
  `docs/symptoms.md` の SG-09（Android 実測の追記は PR #62）
- このキット:
  - [`site/features/health-check/index.html`](../site/features/health-check/index.html) の「起動画面は自作しない」節は
    Capacitor ネイティブ（ストア版）向けの記述で、PWA の起動画面についての記述は無い
  - 2026-10-05 に金型も反転済み: [`templates/scripts/check-pwa-splash.mjs`](../templates/scripts/check-pwa-splash.mjs)
    は「`background_color` が**あり**、`--expect-bg`（アプリ本体の地色）と一致」を合格にし、
    `--expect-bg` が無いときは「測れなかった」にする。surechigai の検査は金型の無改変コピーに戻し、
    色は `--expect-bg '#E2EDF7'` で渡す。同じ旧説を書いていた
    [`SPLASH-SCREEN-PLAYBOOK.md`](SPLASH-SCREEN-PLAYBOOK.md) の警告節と
    `site/assets/data/ai-instructions.json` の PWA の段落も、この判断に書き換えた

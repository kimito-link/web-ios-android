# PWA の起動画面は「地色1色をそろえる」

> **今の到達点: 実装・本番検証済み（5サービス: surechigai / exosome / voice / doin / kimito.link）／Android 実機で5サービスとも起動→本編の色の飛び無しを実測／iOS 実機は未測定／金型の検査も反転済み（2026-10-05）**
>
> 出典: `surechigai-romi.link`（PR #61、2026-10-05 マージ・デプロイ済み）を起点に、同日 5 サービスへ展開（PR は「適用の仕方」の表）。
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
4. **外部 CSS より前に `<style>html,body{background:<地色>}</style>` をインラインで置く**（静的 HTML のサイトの場合）。
   外部 CSS が当たる前の最初の描画は既定の白になる。exosome は共通 CSS で `html` に地色を当てていたので白は出ず、
   voice はそれが無かったので白が 1 フレーム出た（下の実測表）。
5. **起動画像は内容ハッシュ名で配り、`?v=` を使わない**。固定名だと中身を変えても CDN・ブラウザ・iOS のキャッシュに
   旧版が残る。kimito.link は固定名のまま紺 → 白に変えたため、ハッシュ名化（PR #376）で対処した。
6. **初回だけ出る画面（オンボーディング等）も、起動画面と同じ地色の源を使う**。doin は起動画面の直後に出るのが
   オンボーディングだったので、`#0A1628` の直書き 6 か所を `themeColors.background.dark` に置き換えた。

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

### 5 サービス展開後の追加実測（同じ端末 moto g64y 5G、`measure-webapk-launch.sh`）

色は**本体領域の最頻色**をフレームごとに出したもの（録画は YUV420 のため ±3 程度の圧縮ずれがある）。
上の表（画面上部 1/5 の帯の平均）とは算出方法が違うので、数値を横に並べて比べない（「測り方」参照）。

| サービス | OS の起動画面 | 切り替え直後（プレースホルダ／アプリ窓の最初） | 本編 | 判定 |
|---|---|---|---|---|
| exosome | #FDF9F0 | #FDF9F0 | #F5F0E8〜#F7F1EA（同系のクリーム） | 飛び無し |
| surechigai | #E0ECF6 | #E0ECF6 | ヒーロー #EEF4F5 | 緩やかな明度差。フラッシュ無し |
| voice（修正前） | #FCF5EC | **白 #FCFCFC が 1 フレーム（約 23ms・画面の 91%）** | #FDF6F2 | 白のフラッシュあり |
| voice（修正後、PR #58） | #FCF5EC | 最初のフレームから無地クリーム #FCF5ED | #FDF6F2 | 地色から各チャンネル差 >8 のフレーム 0 枚 |
| doin（期待 #0D1117） | #0A1016 | アプリ窓の最初のフレーム（オンボーディングの骨組み）#0B1014 | 「ようこそ！」本文 #0A1014 | 起動以降の全フレームで地色からの各チャンネル差 ≤3。白・灰のフレーム無し。初回起動でオンボーディングが出ること、その背景が起動画面と同じ濃紺黒であることをタイルで目視 |
| kimito.link（期待 #FFFFFF） | #FCFDFD | Chrome 側の起動画面 #FCFDFC（2.939s。ナビバーの色だけ黒→白） | 本文 #FCFCFC（5.212s に完成形で一度に描画） | 全フレームで差 ≤3。黒・灰の骨組みフレーム無し |

iOS 実機は未測定。

## 適用の仕方

- `manifest.background_color` ＝ アプリ本体の地色 ＝（自作ベールがあれば）ベールの色。
  surechigai の値は `#E2EDF7`。
- 2026-10-05 に展開した 5 サービスの地色と、その値の源:

  | サービス | 地色 | 値の源 | PR |
  |---|---|---|---|
  | surechigai | #E2EDF7 | `palette.kimitoBlueSoft` | #61, #64 |
  | exosome | #FFFAF3 | `style.css` の `--color-bg`（`html`/`body` がそれを使う） | #19 |
  | voice | #FFF6EE | 各ページ CSS の `--day` | #57, #58 |
  | doin | #0D1117 | `theme.config.cjs` の `themeColors.background.dark`（オンボーディング画面も同じ源） | #69 |
  | kimito.link | #FFFFFF | body の `bg-white`。起動画像は白地＋青ロゴに作り直し。`theme_color` は別定数 #00427B | #374, #376 |

- 5 サービス共通の型:
  - `manifest.background_color` ＝ 本体の地色
  - 起動画像は `<w>x<h>.<sha256 先頭12桁>.png` の内容ハッシュ名で配り、`?v=` を使わない
  - 契約テストで 3〜5 か所（manifest・本体の地色・起動画像の地色・ベール等）の一致を見張る
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

### ステータスバーの色の往復（本文の地色とは別件・未着手）

WebAPK の OS 起動画面ではステータスバーが `theme_color` で塗られる。Chrome の窓に切り替わった瞬間に一度明色になり、
ページの `theme-color` が効いてから元に戻る。exosome はピンク → 明色 → ピンク、surechigai は紺 → 明色 → 紺、
kimito.link も同じ構造。voice は `theme_color` が明色なので見えない。
`theme_color` を本体の地色に寄せれば消えるが、ブランド色のステータスバーを捨てる判断になるため未着手。

## 他の起動画面の例

本家 `kimito.link` は、以前は起動画像が濃紺 #00427B の地＋ロゴで、次の本編が白っぽく、紺 → 白の飛びがあった。
2026-10-05 に白地＋青ロゴ・`background_color` #FFFFFF に揃えた（PR #374, #376。`theme_color` は #00427B のまま）。

## 測り方

- Android 実機（USB 接続）: [`templates/scripts/measure-webapk-launch.sh`](../templates/scripts/measure-webapk-launch.sh)。
  使い方は EMULATOR-VERIFY-HOWTO の該当小節。前後を同じ手順で撮って比べる。
  このスクリプトは録画・タイル画像・明るさの変化点を出す。色の平均 RGB（上の表）は別途フレームから算出した。
- 色の取り方の注意:
  - 画面上部 1/5 の帯の平均は、ステータスバーと見出し文字が混ざるので地色の比較に向かない
    （最初の表はアイコンの無い領域として使ったが、地色の一致判定には下の方法を使う）。
  - 本体領域（ステータスバー＝上 4%・ナビバー＝下 8%・右端 16px のスクロールバーを除く）の**最頻色**を
    フレームごとに出す。
  - 右端のオーバーレイのスクロールバーの退色は、暗転と誤読しやすい。本体領域から右端を外して見る。
- ブラウザ上の描画の空白: surechigai の `scripts/qa/measure-launch-timeline.mjs`（合否には入れない計測）。
- iOS: 実機が無いと測れない（Windows では iOS Simulator が使えない）。

## 関連ファイル

- surechigai: `scripts/check-pwa-splash.mjs`／`__tests__/manifest-background-color.test.ts`／
  `docs/symptoms.md` の SG-09（Android 実測の追記は PR #62）
- このキット:
  - [`site/features/health-check/index.html`](../site/features/health-check/index.html) の「起動画面は自作しない」節は
    Capacitor ネイティブ（ストア版）向けの記述で、PWA の起動画面についての記述は無い
  - `templates/scripts/check-pwa-splash.mjs` の追加変更（2026-10-05）:
    - PWA 基礎 4 項目（manifest 配信・`theme-color` 一致・起動画像 `href` のクエリ無し・アイコン 192/512）を追加（ac44f43）
    - ロゴ判定を「中央 1 点」から「中央 60% 矩形の非地色画素割合（しきい値 0.5%）」に変更（PR #23）。
      中央 1 点は、kimito.link のワードマークの文字間と voice のマスコットの肌色で誤検知した
    - 5 サイトとも本番 URL に対して合格（根拠あり 10 件）
  - 2026-10-05 に金型も反転済み: [`templates/scripts/check-pwa-splash.mjs`](../templates/scripts/check-pwa-splash.mjs)
    は「`background_color` が**あり**、`--expect-bg`（アプリ本体の地色）と一致」を合格にし、
    `--expect-bg` が無いときは「測れなかった」にする。surechigai の検査は金型の無改変コピーに戻し、
    色は `--expect-bg '#E2EDF7'` で渡す。同じ旧説を書いていた
    [`SPLASH-SCREEN-PLAYBOOK.md`](SPLASH-SCREEN-PLAYBOOK.md) の警告節と
    `site/assets/data/ai-instructions.json` の PWA の段落も、この判断に書き換えた

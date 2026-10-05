# scripts/qa — ブラウザ上で「見た目の挙動」を数える道具

> 置き場の約束: ブラウザ（Playwright）で画面を開いて測る道具は、どのリポでも `scripts/qa/` に置く
> （実証元 `surechigai-romi.link/scripts/qa/` と同じ置き場・同じ流儀）。Android 実機で測る道具は
> `templates/scripts/measure-webapk-launch.sh`（adb）で、こちらは別物。
> この配下の道具は**合否ゲート（`npm run verify` 等）には入れない**。端末と回線で値が揺れるため、
> 「変更の前後を同じ条件で測って比べる」ために使う。

## measure-page-flicker.mjs — ページを開いた直後の「ちらつき」を数える

### 何が分かるか

| 行 | 意味 | 読み方（典型的な原因） |
|---|---|---|
| 白一色フレーム | 画面の 98% 以上が白のフレーム枚数（0.1 秒刻み） | **描画前の地色**。外部 CSS が当たる前の既定の白、またはサーバー応答待ち。長いほど「開いたのに何も出ない」時間。地色をインライン `<style>` で先に塗る（`_docs/DESIGN-pwa-launch-screen-2026-10-05.md` 判断 4） |
| フラッシュ | 前フレームとの平均輝度差が 50 を超えたフレーム枚数 | **全画面オーバーレイの疑い**。出る・消えるで 2 枚になる。到着直後に全画面を被せる演出、ベールの遅い解除、暗色→白のページ差し替え |
| 縦ずれ | 既にあった要素が縦に動いた回数（Chrome の layout-shift エントリ、CLS の元データ） | **後から挿入される要素**（通知バナー、注意書き）／**本物と寸法の違うプレースホルダ**（プレースホルダ 182px → 本物 424px のような差）。動いた要素名と top の前後が添えられる |
| 最初に画面が変わるまで | 前フレームとの差分が 8 を超えた最初の時刻 | 白一色では拾えない「ロゴだけ出て止まっている」時間も含めた地色の長さ |
| 追跡要素の移動 | `--track` で指定した要素の top が動いた回数（いつ・何 px） | 縦ずれの内訳を特定の要素で追いたいときの補助。既定は `main > *`（無ければ `body > *`） |
| 遷移 / 3xx | ページの遷移列と 3xx 応答（Location 付き） | リダイレクトの段数。CDN 側のバージョン解決（例: `clerk-js@6` → `@6.36.0` の 307）が待ち時間に乗っていないか |

終了コードは 3 値: `0`=フラッシュ 0 かつ縦ずれ 0 ／ `1`=どちらかあり ／ `2`=測れなかった（Playwright・ffmpeg が無い、ページが開けない、録画が 0 フレーム）。
**2 を 0 と同じ緑に数えない**（`_docs/instruments/HANDOFF-new-app.md`）。

### 使い方

```bash
# Playwright が入っているリポのルートで実行する（process.cwd() の node_modules から解決する）
node scripts/qa/measure-page-flicker.mjs https://example.com/ --out ./qa/evidence/2026-10-05_signin-flicker/before

# 条件を変える
node scripts/qa/measure-page-flicker.mjs https://example.com/dashboard/ --out ./out \
  --cpu 2 --network 3g --seconds 8 --device "iPhone 15 Pro Max"

# ログイン済みヒント cookie を付ける／追跡する要素を足す／PWA 起動の模倣を切る
node scripts/qa/measure-page-flicker.mjs https://example.com/ --out ./out \
  --cookie "__client_uat=1;domain=.example.com" --track ".cl-rootBox" --track "[data-testid=notice]" --no-standalone

# Playwright が別リポにしか無いとき
node scripts/qa/measure-page-flicker.mjs https://example.com/ --out ./out --playwright ../surechigai-romi.link

# 解析関数の自己検査（Playwright・ffmpeg 不要）
node scripts/qa/measure-page-flicker.mjs --selftest
```

| オプション | 既定 | 意味 |
|---|---|---|
| `--out <dir>` | （必須） | 出力先。`video.webm` / `timeline.json` / `frames.csv` / `tiles.png` / `summary.txt` |
| `--cpu <n>` | 2 | CPU を n 倍遅くする（DevTools の CPU throttling） |
| `--network 3g\|4g\|none` | 3g | 回線の見立て。`3g` は DevTools の Fast 3G 相当（150ms / 1.6Mbps / 750kbps） |
| `--seconds <n>` | 8 | 開いてから録画を止めるまでの秒数（1〜60） |
| `--device <name>` | iPhone 15 Pro Max | Playwright の `devices` の名前 |
| `--track <css>` | `main > *`（無ければ `body > *`） | frames.csv に top の列を出す要素。複数可 |
| `--cookie "name=value;domain=.x"` | なし | 開く前に入れる cookie。複数可（ログイン済みヒントの再現用） |
| `--no-standalone` | （標準で模倣する） | ホーム画面から開いた PWA の模倣（`navigator.standalone` / `display-mode: standalone`）を切る |
| `--allow-sw` | （標準で遮断） | Service Worker を許可する。既定は遮断して「初回・キャッシュ無し」を測る |
| `--playwright <path>` | `process.cwd()` | Playwright を解決する起点（リポのルート） |
| `--ffmpeg <path>` | PATH / 環境変数 `FFMPEG` | ffmpeg の場所 |

### 前提

- Playwright（`npm i -D playwright && npx playwright install chromium`）。この道具自体は依存を持たず、呼び出し元のリポのものを使う
- ffmpeg（録画をフレームに切るため）。Windows は `winget install Gyan.FFmpeg`
- 回線に出る（本番 URL を開く）。ローカルの `http://localhost:3000/` でも動く

### 出力の見方

1. まず `summary.txt`（標準出力にも同じもの）。3 行の数字と、縦ずれの要素名
2. 次に `tiles.png` を Read で見る。0.2 秒ごとのフレームが 8 列で並ぶ。白の長さ・暗転・要素の押し下げが目で追える
3. 細かく見るなら `frames.csv`（0.1 秒ごとの輝度・白画素率・差分・追跡要素の top）と `timeline.json`
   （`layoutShifts[].sources` に動いた要素と前後の top、`responses` に 3xx と Location、`final.nav` に navigation timing）

### 測っていないもの（過信しない）

- 実機の速さと色味。CPU と回線を絞った見立てで、端末ごとの実測値ではない。**同じ条件で前後を比べる**ために使う
- iOS Safari 固有の挙動（Chromium で iPhone の画面と UA を模しているだけ。iOS の起動画像も測れない）
- 同じ色のまま要素が入れ替わる変化（輝度差が小さいので「フラッシュ」にも「白」にも出ない。縦ずれには出る）
- 3px 未満の移動（Chrome の layout-shift が記録しない）
- 操作後の挙動（開いた直後だけを測る。タップ後は別途）

### 実証

- 2026-10-05、`https://kimito.link/dashboard/`（未ログイン → sign-in へ 307）: 白一色 21 枚（2.1 秒）／フラッシュ 2 枚（3.5s 輝度 236→58、4.5s 58→237 = 紺の全画面オーバーレイが 1.0 秒）／縦ずれ 2 回（注意書きの後挿入で +105px、プレースホルダの退場）→ exit 1
- 同日、`https://surechigai.kimito.link/`: 白一色 4 枚（0.4 秒）／フラッシュ 0／縦ずれ 0 → exit 0
- 判断と原因の内訳は [`_docs/DESIGN-signin-no-flicker-2026-10-05.md`](../../../_docs/DESIGN-signin-no-flicker-2026-10-05.md)

### 同じ流儀の道具

- `surechigai-romi.link/scripts/qa/measure-launch-timeline.mjs` — PWA 起動の段階（ベール／骨組み／本編）をサイト固有のラベルで並べる。こちらは汎用で、画素と layout-shift だけを見る
- [`templates/scripts/measure-webapk-launch.sh`](../measure-webapk-launch.sh) — Android 実機の WebAPK 起動（OS の起動画面はブラウザでは測れない）
- 手順の入口: [`docs/ai-workflows/EMULATOR-VERIFY-HOWTO.md`](../../../docs/ai-workflows/EMULATOR-VERIFY-HOWTO.md)

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
| 白一色フレーム（うち描画前） | 上の枚数のうち、最初に画面が変わる前の枚数 | Playwright の空白タブは白なので、暗い地色のサイトでもここに白が出る。**サイトの症状ではなく計測の都合**。この区間の変化（白 → 暗い地色）はフラッシュにも大きな切替にも数えない |
| 往復フラッシュ | 前フレームとの平均輝度差が 50 を超えて別の色になり、**1.5 秒以内に元の輝度（±25）へ戻った**回数 | **全画面オーバーレイが出て消えた**形。到着直後に全画面を被せる演出、ベールの遅い解除。赤の判定に使うのはこれだけ |
| 大きな切替 | 輝度差が 50 を超えたが戻らず、新しい定常状態へ移ったもの | **コンテンツの出現・画面遷移**（暗い地色の上にログイン画面が描かれる、別ページへ移る）。ユーザーには「読み込まれた」と見えるので赤にしない。情報として時刻と輝度を出す |
| 縦ずれ | 既にあった要素が縦に動いた回数（Chrome の layout-shift エントリ、CLS の元データ） | **後から挿入される要素**（通知バナー、注意書き）／**本物と寸法の違うプレースホルダ**（プレースホルダ 182px → 本物 424px のような差）。動いた要素名と top の前後が添えられる |
| 最初に画面が変わるまで | 前フレームとの差分が 8 を超えた最初の時刻 | 白一色では拾えない「ロゴだけ出て止まっている」時間も含めた地色の長さ |
| 追跡要素の移動 | `--track` で指定した要素の top が動いた回数（いつ・何 px） | 縦ずれの内訳を特定の要素で追いたいときの補助。既定は `main > *`（無ければ `body > *`） |
| 遷移 / 3xx | ページの遷移列と 3xx 応答（Location 付き） | リダイレクトの段数。CDN 側のバージョン解決（例: `clerk-js@6` → `@6.36.0` の 307）が待ち時間に乗っていないか |

終了コードは 3 値: `0`=往復フラッシュ 0 かつ縦ずれ 0 ／ `1`=どちらかあり ／ `2`=測れなかった（Playwright・ffmpeg が無い、ページが開けない、録画が 0 フレーム）。
白一色・大きな切替は判定に入れない（白は描画前の地色の問題として別の設計で扱う。大きな切替は読み込みの完了そのもの）。

なぜ「往復」だけを赤にするか（2026-10-06、3 サイトに当てて判定が粗かったので直した）:
- 暗い地色のサイト（doin `#0D1117`）では、空白タブ（白）→最初の描画（暗）が毎回 diff 238 で「フラッシュ」に乗っていた。これは計測の都合であってサイトの症状ではない
- 暗い地色の上にログイン画面が描かれる（16→124）のも diff は大きいが、ユーザーには「出た」と見える。戻らないものは症状ではない
- 本家の紺（236→58→237 を 1.0 秒）のように**出て消える**ものだけが「ちらつき」。1.5 秒以内に元の輝度へ戻るかで機械的に分ける
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

### `--seconds` は「読み込みが終わるまで」伸ばす

縦ずれは Clerk のような遅い部品が描かれた瞬間に起きる。Fast 3G 相当では Clerk の到着が 10 秒を超えることがあり、
既定の 8 秒では**まだ起きていないだけ**で 0 回と出る（doin の sign-in: 8 秒で縦ずれ 0 → 14 秒で 3 回。2026-10-06 実測）。
summary の「遷移」「navigation timing（DCL / load）」が録画の終わり近くなら、`--seconds 14` 等で測り直す。

### 出力の見方

1. まず `summary.txt`（標準出力にも同じもの）。3 行の数字と、縦ずれの要素名
2. 次に `tiles.png` を Read で見る。0.2 秒ごとのフレームが 8 列で並ぶ。白の長さ・暗転・要素の押し下げが目で追える
3. 細かく見るなら `frames.csv`（0.1 秒ごとの輝度・白画素率・差分・追跡要素の top）と `timeline.json`
   （`layoutShifts[].sources` に動いた要素と前後の top、`responses` に 3xx と Location、`final.nav` に navigation timing）

### 測っていないもの（過信しない）

- 実機の速さと色味。CPU と回線を絞った見立てで、端末ごとの実測値ではない。**同じ条件で前後を比べる**ために使う
- iOS Safari 固有の挙動（Chromium で iPhone の画面と UA を模しているだけ。iOS の起動画像も測れない）
- 同じ色のまま要素が入れ替わる変化（輝度差が小さいので「往復フラッシュ」にも「白」にも出ない。縦ずれには出る）
- 1.5 秒より長く出てから消えるオーバーレイ（「大きな切替」が 2 回として出る。長いオーバーレイは「ちらつき」ではなく「待たせている」問題として別に見る）
- 3px 未満の移動（Chrome の layout-shift が記録しない）
- 操作後の挙動（開いた直後だけを測る。タップ後は別途）

### 実証

- 2026-10-05、`https://kimito.link/dashboard/`（未ログイン → sign-in へ 307、本家修正前）: 白一色 21 枚（2.1 秒）／往復フラッシュ 1 回（3.5s→4.5s、輝度 236→58→237 = 紺の全画面オーバーレイが 1.0 秒）／縦ずれ 2 回（注意書きの後挿入で +105px、プレースホルダの退場）→ exit 1
- 同日、`https://surechigai.kimito.link/`: 白一色 4 枚（0.4 秒）／往復フラッシュ 0／縦ずれ 0 → exit 0
- 2026-10-06（数え方を直した版）の本家修正後・doin の結果はこの PR 本文（`fix/measure-page-flicker-flash-semantics`）に貼ってある
- 判断と原因の内訳は [`_docs/DESIGN-signin-no-flicker-2026-10-05.md`](../../../_docs/DESIGN-signin-no-flicker-2026-10-05.md)

### 同じ流儀の道具

- `surechigai-romi.link/scripts/qa/measure-launch-timeline.mjs` — PWA 起動の段階（ベール／骨組み／本編）をサイト固有のラベルで並べる。こちらは汎用で、画素と layout-shift だけを見る
- [`templates/scripts/measure-webapk-launch.sh`](../measure-webapk-launch.sh) — Android 実機の WebAPK 起動（OS の起動画面はブラウザでは測れない）
- 手順の入口: [`docs/ai-workflows/EMULATOR-VERIFY-HOWTO.md`](../../../docs/ai-workflows/EMULATOR-VERIFY-HOWTO.md)

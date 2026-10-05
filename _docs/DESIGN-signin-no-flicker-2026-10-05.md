# ログイン画面に着く瞬間を「白 → 紺 → ずれ」にしない（kimito.link sign-in の実測と判断）

> **今の到達点: 原因の特定と計測道具の金型化は完了（このキット PR）。本家 kimito.link への適用 PR は別担当が作成中（番号は後で追記）。iOS 実機・本番の適用後の再測定は未実施。**
>
> 出典: 2026-10-05、`https://kimito.link/dashboard/` を未ログインで開いたときの「白 → 紺がパッと出て消える → 中身が下にずれる」の調査。
> 計測の道具: [`templates/scripts/qa/measure-page-flicker.mjs`](../templates/scripts/qa/measure-page-flicker.mjs)（使い方と読み方は [`templates/scripts/qa/README.md`](../templates/scripts/qa/README.md)）。
> 読む順: このファイル → 計測 README → 姉妹サービス側の設計 [`DESIGN-kimito-family-prepaint-auth-mode-2026-09-29.md`](DESIGN-kimito-family-prepaint-auth-mode-2026-09-29.md)（ペイント前に認証モードを確定する考え方の正本）。

## 用語（初出の一言説明）

- **フラッシュ**: 画面全体が一瞬で別の色になること。録画の前後フレームの平均輝度差が 50 を超えた枚数で数える。
- **縦ずれ**: 既に見えていた要素が後から下（上）に動くこと。Chrome の layout-shift（CLS の元データ）で数える。
- **プレースホルダ**: 本物が読み込まれるまで、その場所に置いておく仮の箱。
- **到着 intro**: ページに着いた直後、何も押していないのに出る「準備しています」の全画面表示。
- **auth-mode 金型**: `<head>` 先頭のインラインスクリプトが cookie だけでログイン状態を決め、最初の描画から正しい側を出す仕組み（[`templates/web/auth-mode/`](../templates/web/auth-mode/README.md)）。

## 実測（2026-10-05、iPhone 15 Pro Max エミュレーション・CPU 2 倍遅・Fast 3G 相当・Service Worker 遮断）

計測は使い捨てスクリプト（Playwright 録画 ＋ ffmpeg で 10fps のフレームに分解）で行い、同じ数え方を上の金型に移した。
金型で再測定した結果（`summary.txt`）:

| 対象 | 白一色フレーム | フラッシュ | 縦ずれ | 判定 |
|---|---|---|---|---|
| `https://kimito.link/dashboard/`（未ログイン → `/sign-in/?redirect_url=%2Fdashboard%2F` へ 307） | 21 枚（0.0〜2.0 秒） | 2 枚: 3.5s（輝度 236→58）・4.5s（58→237）＝紺が 1.0 秒 | 2 回: 3.8s（`div.w-full.max-w-md` 163→268 ＝ +105px）・8.6s（プレースホルダの退場） | exit 1 |
| `https://surechigai.kimito.link/` | 4 枚（0.0〜0.3 秒） | 0 | 0 | exit 0 |

使い捨てスクリプトでの同日の複数回の実測（CPU 1〜2 倍・ログイン済みヒント cookie の有無を変えて 6 回）でも形は同じで、
白が 1.6〜2.6 秒、紺の全画面が diff 142 前後で 1.0〜1.1 秒、縦ずれが 2 回（注意書きの挿入で +105px、プレースホルダ 182px → Clerk 本体 424px の差で +242px、その後 −12px の微調整）だった。
ローカル（`localhost:3311`）でも本番と同じ 3 段が再現した。

録画のタイル画像で見ると: 白 → ヘッダーとカードが出る → 画面全体が紺（「りんくが鍵を開けています…」） → 元の画面に戻るが、
カードの上に注意書きが挟まって全体が下にずれる → 薄いプレースホルダが Clerk のボタン群に置き換わり、もう一度高さが変わる。

## 原因（本家 `kimitolink-linktree` のコード。2026-10-05 時点）

1. **到着 intro の全画面オーバーレイ** — `components/AuthHandoffOverlay.tsx`。`phase: "intro" | "handoff"` を持ち、
   マウント直後に `setPhase("intro")` で `fixed inset-0 ... bg-kimito-blue`（紺）を全画面に被せ、`INTRO_MS` のタイマーか
   Clerk の描画検知で外す。これが「紺のフラッシュ」。ボタンを押した後の `handoff` 表示は待ちを丁寧に見せる意味があるが、
   **到着直後**に出すと「白 → ページ → 紺 → ページ」の 4 段になる。
2. **注意書きの後挿入** — `components/AuthBrowserSessionNotice.tsx`。`if (!isLoaded || isSignedIn) return null;` のため、
   Clerk の読み込みが終わってから初めて現れ、その分（+105px）だけカード以下が押し下げられる。
3. **プレースホルダと本物の寸法違い** — `components/ClerkMountFallback.tsx`（`role="status"` 「ログイン画面を準備中」）の
   高さが Clerk 本体（ボタン 3 つ＋見出し）より低く、置き換わる瞬間に +242px、Clerk 側の調整でさらに −12px 動く。
4. **Clerk JS のバージョン解決が 307 を挟む** — `https://clerk.kimito.link/npm/@clerk/clerk-js@6/dist/clerk.browser.js` →
   `@6.36.0`、`@clerk/ui@1` → `@1.38.0` の 307 がそれぞれ入る（`timeline.json` の `responses`）。回線が遅いほど、
   プレースホルダが見えている時間（＝3 の寸法違いが目立つ時間）が延びる。
5. **最初の白** — `/dashboard/` の 307 とサーバー応答（`responseStart` ≈ 500ms）＋ HTML・CSS の到着まで、地色が塗られない。
   これは姉妹サービスの `DESIGN-pwa-launch-screen-2026-10-05.md` 判断 4（インラインの地色）と同じ性質の問題。

★3 つの原因（1〜3）はどれも「**最初に描いた画面を、後から別の画面に差し替える**」構造で、姉妹サービスで
`DESIGN-kimito-family-prepaint-auth-mode-2026-09-29.md` が特定した真因と同じ。本家は公開ページでは無症状だったが、
sign-in ページだけがこの型に戻っていた。

## 判断

1. **到着時に全画面を被せない。** 到着 intro は廃止し、全画面の案内はユーザーがボタンを押した後（`handoff`）だけにする。
   「待ちを丁寧に見せる」のは、ユーザーが自分で起こした待ちに対してだけ意味がある。
2. **プレースホルダは本物と同寸・同色にする。** Clerk 本体が描かれたときの外枠の高さ・角丸・背景（実測の寸法は
   `dims2.mjs` 相当の手順で本番から取る）をそのまま持ち、置き換わっても周囲が動かないようにする。
   寸法は Clerk の appearance（`lib/clerk-appearance.ts`）とボタン数から決まるので、変えたら両方を直す（契約テスト対象）。
3. **注意書きは最初から場所を取る。** 「いまブラウザの X アカウントで入ります」のような、ログイン状態で出し分ける要素は、
   ペイント前に `__client_uat` cookie で `data-auth` を確定させ（auth-mode 金型）、出す側は最初の描画から出し、
   出さない側は最初から出さない。Clerk の `isLoaded` を待って挿入しない。
4. **Clerk JS の版を固定する。** `@6` → `@6.36.0` のような解決の 307 を本番のクリティカルパスから外す
   （`ClerkProvider` の `clerkJSVersion` 相当で固定し、更新は人が PR で上げる）。版を固定すると「ある日急に挙動が変わる」も消える。
5. **地色は HTML のインラインで先に塗る。** 白の 2 秒を 0 にはできない（サーバー応答待ち）が、白ではなくページの地色にする。
   `DESIGN-pwa-launch-screen-2026-10-05.md` 判断 4 と同じ。
6. **直したかどうかは、この計測道具の数字で判定する。** 「見た感じ消えた」で閉じない。前後を同じ条件で測り、
   フラッシュ 0・縦ずれ 0（exit 0）になった `summary.txt` と `tiles.png` を `qa/evidence/` に残す。

### 捨てた案

- **オーバーレイを薄く（透過・短く）する**: 回線が遅いほど長く出るので、短さに頼ると実機で再発する。被せないのが根本。
- **プレースホルダを「大きめ」にして吸収する**: 本物より大きいと今度は縮む方向にずれる。同寸にする以外に無い。
- **目視と手持ちのスマホで確認する**: 何ミリ秒続いたか・何 px 動いたかが残らず、直したかどうかの判定ができない
  （CLAUDE.md「確認と不具合対応の共通ルール」）。

## 適用

| 対象 | 状態 |
|---|---|
| 本家 `kimito.link` sign-in（判断 1〜5） | 別担当が PR 作成中（番号は後で追記） |
| 計測道具の金型（`templates/scripts/qa/measure-page-flicker.mjs`） | このキットの PR（`feat/measure-page-flicker`） |
| 姉妹サービス（exosome / surechigai / voice / doin） | 認証モードは auth-mode 金型で適用済み。sign-in 相当の画面があるものは、同じ道具で測って 0/0 を確認する（未実施） |

## 未確認

- 本家の修正後に同じ条件で再測定し、フラッシュ 0・縦ずれ 0 になること（PR マージ後）
- iOS Safari 実機での見え方（Chromium のエミュレーションで測っている。iOS の起動画像は別軸）
- 白の 2 秒のうち、サーバー応答（約 0.5 秒）以外の内訳（HTML 配信・CSS の到着・フォント）
- ログイン済み（`__client_uat` あり）で `/dashboard/` に着いたときの挙動（使い捨てスクリプトの `INJECT_UAT=1` の回でも
  未ログインと同じ 3 段が出た＝sign-in に 307 される経路は cookie の有無で変わらなかった。本家の修正で変わるか）

## 関連ファイル

- 計測道具: [`templates/scripts/qa/measure-page-flicker.mjs`](../templates/scripts/qa/measure-page-flicker.mjs) ／ [`templates/scripts/qa/README.md`](../templates/scripts/qa/README.md)
- 手順の入口: [`docs/ai-workflows/EMULATOR-VERIFY-HOWTO.md`](../docs/ai-workflows/EMULATOR-VERIFY-HOWTO.md)「ブラウザ上でちらつきを数える」
- ペイント前の認証モード確定（判断 3 の正本）: [`DESIGN-kimito-family-prepaint-auth-mode-2026-09-29.md`](DESIGN-kimito-family-prepaint-auth-mode-2026-09-29.md) ／ 金型 [`templates/web/auth-mode/`](../templates/web/auth-mode/README.md)
- 地色のインライン（判断 5 の正本）: [`DESIGN-pwa-launch-screen-2026-10-05.md`](DESIGN-pwa-launch-screen-2026-10-05.md)
- 本家のコード（`kimitolink-linktree`）: `components/AuthHandoffOverlay.tsx` ／ `components/AuthBrowserSessionNotice.tsx` ／ `components/ClerkMountFallback.tsx` ／ `components/AuthPageShell.tsx` ／ `app/(auth)/layout.tsx`（`ClerkProvider`）／ `app/(auth)/sign-in/[[...sign-in]]/page.tsx`
- 同じ流儀の道具: `surechigai-romi.link/scripts/qa/measure-launch-timeline.mjs`（PWA 起動の段階）／ [`templates/scripts/measure-webapk-launch.sh`](../templates/scripts/measure-webapk-launch.sh)（Android 実機）

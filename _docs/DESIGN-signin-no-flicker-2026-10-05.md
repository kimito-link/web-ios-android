# ログイン画面に着く瞬間を「白 → 紺 → ずれ」にしない（kimito.link sign-in の実測と判断）

> **今の到達点: 本家・doin は本番で 往復フラッシュ 0・縦ずれ 0 を実測／surechigai は PR #73 マージ済みだが本番反映は手動デプロイ待ち（`surechigai-web` は Git 連携なし）／exosome・voice はモーダル型で該当なし。**
> （本家: `kimitolink-linktree` PR #381、本番反映 2026-10-05。doin: PR #75 → #76 → #77。）
> キット側の金型（`templates/web/auth-mode/nextjs/` の ④ 部品・`head-snippet.html.example` の自インスタンス判定）は
> ブランチ `feat/auth-mode-signin-no-flicker-templates` で配置。iOS Safari 実機での再測定は未実施。
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

## 計測道具は v2（キット PR #31）

最初の版（PR #29）は「平均輝度差 50 超」をすべてフラッシュと数えたため、暗い地色のサイトで偽の赤が出た。v2 の数え方
（読み方の表は [`templates/scripts/qa/README.md`](../templates/scripts/qa/README.md)）:

- **描画前の白は数えない**。Playwright の空白タブは白なので、最初に画面が変わる前の白と、そこから暗い地色への変化は
  サイトの症状ではなく計測の都合。白一色フレーム数は「うち描画前」を別に出す。
- **往復フラッシュ**（1.5 秒以内に元の輝度 ±25 へ戻る）だけを赤判定にする。全画面オーバーレイが出て消えた形。
- **大きな切替**（輝度差 50 超で戻らない、コンテンツの出現）は情報として時刻と輝度だけ出し、赤にしない。
- **縦ずれ**は Chrome の layout-shift。0 回が合格。

以降の「フラッシュ」は、v1 の表（下の最初の実測）では v1 の数え方、doin の after 以降は v2 の「往復フラッシュ」を指す。

## 実測（2026-10-05、iPhone 15 Pro Max エミュレーション・CPU 2 倍遅・Fast 3G 相当・Service Worker 遮断）

計測は使い捨てスクリプト（Playwright 録画 ＋ ffmpeg で 10fps のフレームに分解）で行い、同じ数え方を上の金型に移した。
金型で再測定した結果（`summary.txt`）:

| 対象 | 白一色フレーム | フラッシュ | 縦ずれ | 判定 |
|---|---|---|---|---|
| `https://kimito.link/dashboard/`（未ログイン → `/sign-in/?redirect_url=%2Fdashboard%2F` へ 307） | 21 枚（0.0〜2.0 秒） | 2 枚: 3.5s（輝度 236→58）・4.5s（58→237）＝紺が 1.0 秒 | 2 回: 3.8s（`div.w-full.max-w-md` 163→268 ＝ +105px）・8.6s（プレースホルダの退場） | exit 1 |
| `https://surechigai.kimito.link/` | 4 枚（0.0〜0.3 秒） | 0 | 0 | exit 0 |
| **after**: `https://kimito.link/dashboard/`（本家 PR #381 本番反映後、同条件・10 秒） | 16 枚（0.0〜1.5 秒） | **0 枚** | **0 回**（CLS 合計 0.0061。before は 0.2155） | exit 0 |

after の補足（同じ `summary.txt` / `timeline.json`。証拠は計測セッションの `flicker-kimito-after/` に summary.txt / tiles.png / timeline.json / frames.csv）:
3xx は `/dashboard/`→`/sign-in/` の 307 が 1 回だけ（before はこれに加えて `clerk-js@6`→`6.36.0`・`@clerk/ui@1`→`1.38.0` の 307 が 2 回）。
最初に画面が変わるまで 1.6 秒（before 2.1 秒）。console error 0・pageerror 0。
残った白 1.5 秒はサーバー応答と HTML/CSS の到着（原因 5）で、判断 5（地色のインライン）の対象。

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
7. **先出しの cookie 判定は自インスタンスの接尾辞付き cookie で行う**（2026-10-05、本家の適用で見つかった追加の判断）。
   `.kimito.link` 親ドメインで cookie を共有しているため、姉妹サービス（別の Clerk インスタンス）の `__client_uat` も見える。
   金型の従来判定（「`__client_uat*` のどれか 1 つでも 0 以外なら member」）だと、**姉妹だけにログイン中**の人が本家 `/sign-in/`
   に来たとき member と先出しし、Clerk 読込後に guest へ直る＝注意書きが 1 回切り替わる。Clerk は publishableKey から作った
   接尾辞付き `__client_uat_<suffix>` も書くので、`<html data-auth-cookie-suffix>` で自サービスの接尾辞を渡し、それだけを見る。
   接尾辞の式は Clerk 公式 SDK の実装（`@clerk/shared` `getCookieSuffix`: `base64url(sha-1(publishableKey))` の先頭 8 文字、
   [packages/shared/src/keys.ts](https://github.com/clerk/javascript/blob/main/packages/shared/src/keys.ts)）と同一にする。
   既定は後方互換（属性を付けなければ従来判定）。金型: `templates/web/auth-mode/head-snippet.html.example`、
   Next.js の読み口: `templates/web/auth-mode/nextjs/auth-mode-head-script.ts.example`（`getAuthCookieSuffix()`）。
   ★「ログイン中にしか意味の無い案内」（本家 `AddXAccountNotice`）は接尾辞があっても先出しせず、Clerk の `isSignedIn` 確定を待つ
   （誤表示を出さない側に倒す。本家 `AuthPageShell.first-paint.test.tsx` の契約）。

### 捨てた案

- **オーバーレイを薄く（透過・短く）する**: 回線が遅いほど長く出るので、短さに頼ると実機で再発する。被せないのが根本。
- **プレースホルダを「大きめ」にして吸収する**: 本物より大きいと今度は縮む方向にずれる。同寸にする以外に無い。
- **目視と手持ちのスマホで確認する**: 何ミリ秒続いたか・何 px 動いたかが残らず、直したかどうかの判定ができない
  （CLAUDE.md「確認と不具合対応の共通ルール」）。

## 適用

| 対象 | 状態 |
|---|---|
| 本家 `kimito.link` sign-in（判断 1〜5） | **実装・マージ・本番反映済み**（`kimitolink-linktree` PR #381、commit `2488b86`、2026-10-05）。本番の after 計測でフラッシュ 0・縦ずれ 0（上の実測表）。判断 7（自インスタンス判定）も PR #384 で適用済み（本番 `<html data-auth-cookie-suffix="ZGVu8CMk">` を確認。再計測も 🟢） |
| `doin-challenge.com` sign-in（Expo、判断 1・2 ＋下の追加知見 a〜d） | **実装・マージ・本番で計測済み**（PR #75 → #76 → #77、2026-10-05）。after（本番・CPU×2・3G・16 秒）で往復フラッシュ 0・縦ずれ 0。詳細は下の「doin の経緯」 |
| `surechigai-romi.link` sign-in（Next.js `apps/web` ＋ Expo） | PR #73 マージ済み。**本番反映は手動デプロイ待ち**、after 未計測（下の「次に配る先」の訂正を参照） |
| `yukkuri-exosome.link` / `kimito-Link-Voice` | モーダル型のため該当なし |
| 計測道具の金型（`templates/scripts/qa/measure-page-flicker.mjs`） | マージ済み（このキット PR #29） |
| 本家の実装の金型化（`templates/web/auth-mode/nextjs/` ④部品・`head-snippet.html.example` の判断 7） | マージ済み（このキット PR #30）。本家は PR #384 で金型版に揃え、13 本が正本とバイト一致。`_docs/instruments/check-drift.mjs` の PAIRS「…（auth-mode）」で見張る |

### doin の経緯（PR #75 → #76 → #77、2026-10-05）

- **before（本番）**: 到着 intro の明フラッシュが 1.7 秒（doin は暗地に明色の全画面を被せていた）。Clerk 既定の小カード 336px が
  doin の見た目の 474px に差し替わるとき、縦ずれが 3 回（CLS 0.1966）。
- **追加で分かった原因と直し方**:
  - (a) `vercel.json` の SPA rewrite で `/sign-in/` にも、トップを焼いた `index.html` が返り、hydration（JS が動き出す）まで
    オンボーディングが 6 秒見えた。→ `<head>` のインラインで `data-overlay-free-route` を立て、CSS で隠す（PR #76）。
  - (b) React Navigation の既定テーマ背景 #F2F2F2 が、JS 到着まで全画面に出た。→ `ThemeProvider` で暗色テーマにする（PR #76）。
  - (c) **`import("@clerk/localizations")` は全言語入りの 5.1MB（gz 909KB）の 1 チャンク**で、3G では Clerk 本体より遅れる。
    その間 Clerk が英語・既定ロゴ・小カードで先に描かれる。→ `@clerk/localizations/ja-JP`（126KB）だけを読み、
    見た目を渡し終えるまで同寸のプレースホルダを維持する（上限 4 秒、PR #77）。
  - (d) Clerk のロゴの高さは、最初に読んだ画像で決まり、差し替えても変わらない（既定ロゴなら 36px、自前の 192px なら 48px）。
    見た目を渡す前に Clerk を描くと、ロゴの高さが既定側で固まる。
- **after（本番・CPU×2・3G・16 秒）**: 往復フラッシュ 0、大きな切替 1（sign-in 画面の出現）、縦ずれ 0・CLS 0.0000、console 0。
  証拠: 計測セッションの scratchpad `flicker-doin-signin-after4/`、doin リポの `qa/evidence/2026-10-05_signin-flicker/`。

### 次に配る先（姉妹サービスの見立て。2026-10-05 に実コードを grep して確認。surechigai・doin の行は同日に訂正・更新済み）

| リポ | sign-in の形 | 該当する契約 | 見立て |
|---|---|---|---|
| `kimitolink-linktree`（本家） | Next.js `<SignIn/>` | 判断 7 | **完了（PR #384）**: `lib/auth-mode/head-snippet.html` を金型の新版に揃え、`app/layout.tsx` の `<html>` に `data-auth-cookie-suffix={getAuthCookieSuffix()}`。Playwright で「姉妹の cookie だけ」「接尾辞なし `__client_uat=1` だけ」は guest のまま、自分の接尾辞だけ member、を確認。④ 部品 13 本は PAIRS 登録済み |
| `surechigai-romi.link`（★訂正: 本番 `/sign-in/` は Expo ではなく Next.js が応答） | 本番の `/sign-in/` は `vercel.json` の rewrite で **Next.js `apps/web`（別 Vercel プロジェクト `surechigai-web`、Git 連携なし・手動 `vercel deploy --prod`）** が応答する。Expo の `app/sign-in.tsx` ではない | 判断 1・2 | **before（本番）: フラッシュ 0・縦ずれ 1（+486px。Clerk 到着までカード枠が高さ 0）。** 対処は Next 側 `<SignIn fallback={<ClerkMountFallback/>}>`（金型のコピー。箱モデルは本番 DOM 実測の 486px）＋ Expo 側にも契約を適用（PR #73、マージ済み）。★押せるボタンを出す方針（iOS 2.1(a) 却下対策、2026-08-28）は Expo 側で維持。after は手動デプロイ後に計測予定。以前ここに書いた「Expo 側が応答し、到着 intro が原因」という見立ては、本番の応答元を調べた結果と合わず訂正した |
| `doin-challenge.com`（Expo） | 同型（surechigai から 2026-09-01 移植） | 判断 1・2 | **実装・本番計測済み**（上の「doin の経緯」）。到着 intro の撤去と同寸化に加え、a〜d の 4 件が要った |
| `yukkuri-exosome.link`（静的） | `Clerk.openSignIn()` のモーダル | 該当なし | ページ到着時に sign-in カードを描かない（タップ後にモーダル）。①は全 21 ページ適用済み。判断 7 は親ドメイン共有の立場が同じなので `<html data-auth-cookie-suffix>` を 1 回計算して付けると「本家だけにログイン中」の誤先出しが消える（任意） |
| `kimito-Link-Voice`（静的） | `Clerk.openSignIn()` のモーダル | 該当なし | exosome と同じ。`/try/` に①適用済み |

## 未確認

- iOS Safari 実機での見え方（本家・doin・surechigai とも未測定。Chromium のエミュレーションで測っている。iOS の起動画像は別軸）
- 白の 1.5 秒のうち、サーバー応答（約 0.5 秒）以外の内訳（HTML 配信・CSS の到着・フォント）
- ログイン済み（`__client_uat` あり）で `/dashboard/` に着いたときの挙動（使い捨てスクリプトの `INJECT_UAT=1` の回でも
  未ログインと同じ 3 段が出た＝sign-in に 307 される経路は cookie の有無で変わらなかった。after は未ログインでのみ計測）
- 判断 7 の「姉妹だけにログイン中」での非反応は、PR #384 でローカル（`next start`）の Playwright で cookie 注入して確認済み。
  本番の実ログイン（姉妹でログイン→本家 `/dashboard/`）での確認は未実施（人の操作が要る）
- surechigai の after 計測（PR #73 の本番反映＝`surechigai-web` の手動デプロイ後に、同じ道具で往復フラッシュ 0・縦ずれ 0 になること）
- 本家の描画前の白 1.5 秒（no-store の SSR の TTFB。ちらつきとは別軸で、判断 5 の地色インラインの領分）

## 関連ファイル

- 計測道具: [`templates/scripts/qa/measure-page-flicker.mjs`](../templates/scripts/qa/measure-page-flicker.mjs) ／ [`templates/scripts/qa/README.md`](../templates/scripts/qa/README.md)
- 手順の入口: [`docs/ai-workflows/EMULATOR-VERIFY-HOWTO.md`](../docs/ai-workflows/EMULATOR-VERIFY-HOWTO.md)「ブラウザ上でちらつきを数える」
- ペイント前の認証モード確定（判断 3 の正本）: [`DESIGN-kimito-family-prepaint-auth-mode-2026-09-29.md`](DESIGN-kimito-family-prepaint-auth-mode-2026-09-29.md) ／ 金型 [`templates/web/auth-mode/`](../templates/web/auth-mode/README.md)（契約の一覧は README ④）
- 判断 1〜5・7 の Next.js 金型: [`templates/web/auth-mode/nextjs/`](../templates/web/auth-mode/nextjs/README.md)（`auth-mode-head-script.ts` / `AuthModeSync.tsx` / `ClerkMountFallback.tsx` / `AuthBrowserSessionNotice.tsx` / `clerk-script-versions.ts` / `AuthPageShell.first-paint.test.tsx` / `e2e/sign-in-no-flicker.spec.ts` の `.example`）
- 地色のインライン（判断 5 の正本）: [`DESIGN-pwa-launch-screen-2026-10-05.md`](DESIGN-pwa-launch-screen-2026-10-05.md)
- 本家のコード（`kimitolink-linktree`）: `components/AuthHandoffOverlay.tsx` ／ `components/AuthBrowserSessionNotice.tsx` ／ `components/ClerkMountFallback.tsx` ／ `components/AuthPageShell.tsx` ／ `app/(auth)/layout.tsx`（`ClerkProvider`）／ `app/(auth)/sign-in/[[...sign-in]]/page.tsx`
- 同じ流儀の道具: `surechigai-romi.link/scripts/qa/measure-launch-timeline.mjs`（PWA 起動の段階）／ [`templates/scripts/measure-webapk-launch.sh`](../templates/scripts/measure-webapk-launch.sh)（Android 実機）

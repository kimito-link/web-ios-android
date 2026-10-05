# Next.js + Clerk 認証金型（Xワンタップ／共通アカウント）

## 輸入実績

| 日付 | 輸入先 | 結果 |
|---|---|---|
| 2026-10-01 | `surechigai-romi.link/apps/web`（Phase 1 Step 1） | ✅ **6ファイルを無改変でビルド通過。** 書き換えたのは `auth-brand.config.ts` のみ（設計どおり） |
| 2026-10-02 | 同上（Step 3〜5） | ✅ 本番実機で `auto=x` が X 認可画面へ 5/5 到達。**金型に無かった穴を5件発見・修正**（下の「2件目の輸入で見つかった金型の穴」） |

### ★surechigai の輸入（2026-10-02）で見つかった金型の穴（修正済み）

1. **`localization` / `appearance` がコメントアウトのまま**だった → 見出しが英語「Sign in to ◯◯」、
   見た目も素。`clerk-localization.ts.example` / `clerk-appearance.ts.example` を追加し、
   `auth-layout` で既定有効にした。
2. **`AuthPageShell` の `intro` が null だと「寂しい」画面**になる（Clerk カードだけが中央に出る）。
   `auth-page-intro.tsx.example`（設定駆動）を追加し、`sign-in-page` が差し込むようにした。
3. **外部 rewrite 構成で `400 Invalid host`**（別 Vercel プロジェクトへ段階移行する場合のみ）。
   `ClerkProvider` に `domain` を明示する必要がある → `auth-brand.config` の
   `forceFrontendApiDomain`（既定 false）で切り替える。環境変数 `CLERK_DISABLE_AUTO_PROXY` や
   `frontendApiProxy` は**効かない／逆効果**。正本KB: `ai-hub/kb/clerk-vercel-custom-domain-auto-proxy-trap.md`
4. **ログイン案内の中継ページ `/auth/kimito-link` が無かった** → `kimito-link-redirect.ts` /
   `KimitoLinkRedirect.tsx` / `auth-guide-page.tsx` / テストを追加（ループしない設計・純関数に分離）
5. **`sign-up` ページを作る前提が誤り**だった。X OAuth だけのログインでは `<SignIn />` が初回ユーザーも
   既存ユーザーも同じ画面で扱う。サービス側が `SIGN_UP_HREF = SIGN_IN_HREF` で統一している場合、
   sign-up を新設しても到達できない（surechigai で一度作って撤回した）

### ★1件目の輸入で見つかった金型の穴（修正済み）

**すれ違い通信には「誇張表現の禁止語」を diff で弾くゲートがある**
（`scripts/diff-check.mjs`。`必ず` `確実` `保証` `絶対` 等。★コード内コメントも対象）。
金型のコメントがこれに引っかかり、**無改変では commit できなかった**。

- `auth-layout.tsx.example`: 「どの入口から来ても**必ず**着地先へ送る」→「〜着地先へ送る」
- `auth-routes.ts.example`: 「**確実**に行けず」「全CTAで**保証**する」→「行けず」「揃える」

★**金型を輸入する側のリポに表現ゲートがあることを前提にする。**
以後この金型のコメントに誇張語を書かない（意味は変わらないので実害ゼロで回避できる）。


> **今の到達点: 金型として配置済み・輸入実績 1 件（surechigai。2026-10-01 に輸入、10-02 に穴5件を修正して金型へ還流）。**
> ★還流後の金型は、surechigai の `apps/web` コピーに重ねて `tsc --noEmit` エラー 0 を確認済み。
> ★ログイン済み状態の挙動は 2026-10-02 に本番実機（ユーザー本人の Chrome）で確認済み:
>   `auto=x` 付きで来たら `auto=x` は発火せずトップへ戻り（URL の `auto=x` も消える）、
>   `auto=x` 無しの `/sign-in/` はログイン画面のまま（アカウント切り替え導線を維持）、
>   中継ページ `/auth/kimito-link/` もトップへ戻る。トップ↔sign-in のループは無し。
> 出典 `kimitolink-linktree` の本番で稼働中の実装を、設定を外出しして持ち出せる形にしたもの。
> ★この金型自体を使ったプロジェクトはまだ無い（**初回輸入時に穴が出る前提**で見てほしい）。

## これは何か

`kimito.link` 共通アカウント（Clerk を姉妹サービスで共有）に、**Next.js App Router の
プロジェクトを繋ぐ**ための金型。「X ボタンを 1 回押すだけでログインできる」導線を含む。

同じ置き場の Vanilla JS 版（`../x-one-tap-signin.js.example`）との違い:

| | Vanilla JS 版 | **この Next.js 版** |
|---|---|---|
| 対象 | 静的サイト・素の JS | Next.js App Router + `@clerk/nextjs` |
| ログイン導線 | DOM click 送信のみ | 待機画面・ClerkProvider 設定・URL 集約まで |
| 型 | なし | TypeScript（実プロジェクトで型検査済み） |

## 出典と実証状況

| 項目 | 内容 |
|---|---|
| 出典 | `kimitolink-linktree`（Next.js 16 / `@clerk/nextjs` 7 / App Router） |
| 実証 | 2026-10-01 に本番実機でコンソールエラー 0・ちらつき無しを確認 |
| 型検査 | ★この金型を実プロジェクトへ投入し `tsc --noEmit` が **エラー 0** を確認済み |
| 輸入実績 | **1 件**（surechigai-romi.link/apps/web・2026-10-01。上の「輸入実績」節を見る） |

★`surechigai-romi.link` にも同等実装があるが、あちらは `react-native` / `Platform` /
`isNativeAppShell` に依存する **Expo 専用**で、Next.js には輸入できない。
Expo で使うならそちらを見ること（`components/auth/auto-advance-to-x.tsx`）。

## ファイル一覧

| ファイル | 役割 | 丸写し可否 |
|---|---|---|
| `auth-brand.config.ts.example` | ★**ここだけ書き換える**。色・画像・パス・許可オリジン | 書き換える |
| `AutoAdvanceToX.tsx.example` | X ワンタップの本体（待機画面つき。ログイン済み＋`auto=x` はトップへ戻す） | **無改変**（drift 検査対象） |
| `signed-in-bounce.ts.example` | 「ログイン済み＋`auto=x` ならトップへ戻す」の判定（純関数。**`auto=x` 無しは戻さない**＝アカウント切り替え導線を壊さない／直近10秒に戻していたら戻さない＝ループ防止） | **無改変**（drift 検査対象） |
| `signed-in-bounce.test.ts.example` | 上の純関数のテスト | **無改変**（drift 検査対象） |
| `auth-layout.tsx.example` | `ClerkProvider` 設定（共通アカウントの心臓部） | ほぼそのまま |
| `auth-routes.ts.example` | 認証 URL を 1 か所に集約 | ほぼそのまま |
| `auth-page-shell.tsx.example` | 画面の**骨組みだけ**。カードは差し込み口 | ★骨組みのみ |
| `sign-in-page.tsx.example` | サインインページ | ほぼそのまま |
| `clerk-localization.ts.example` | 日本語見出し（`serviceName` から生成）。要 `@clerk/localizations` | ほぼそのまま |
| `clerk-appearance.ts.example` | X 主役化の見た目。★`LOGO_PATH` だけ書き換える | 1行書き換える |
| `auth-page-intro.tsx.example` | 左カラムのサービス紹介（`intro` 設定を描画） | ほぼそのまま |
| `kimito-link-redirect.ts.example` | 中継ページの行き先判定（純関数） | **無改変**（drift 検査対象） |
| `KimitoLinkRedirect.tsx.example` | 中継ページの部品 | **無改変**（drift 検査対象） |
| `auth-guide-page.tsx.example` | `/auth/kimito-link` ページ | **無改変**（drift 検査対象） |
| `kimito-link-redirect.test.ts.example` | 純関数のテスト（相対 import を自リポの配置に合わせる） | **無改変**（drift 検査対象） |
| `KimitoDashboardLink.tsx.example` | ログイン中だけ本家マイページ `https://kimito.link/dashboard/` へのリンクを出す（素の React。Clerk 状態は props で受ける。Expo でも使える。2026-10-05 追加、詳細は `../README.md` ③） | **無改変**（drift 検査対象） |
| **ログイン画面のちらつきゼロ（`../README.md` ④、2026-10-05 追加。出典: 本家 PR #381）** | | |
| `auth-mode-head-script.ts.example` | `lib/auth-mode/head-snippet.html`（`../head-snippet.html.example` のコピー）から `<script>` を取り出し `app/layout.tsx` の `<head>` へ展開（fail-closed）。`getAuthCookieSuffix()` で自インスタンス判定の接尾辞も作る | **無改変**（drift 検査対象） |
| `auth-mode-head-script.test.ts.example` | 実物のスクリプト文字列を jsdom で実行する契約テスト（従来判定・自インスタンス判定・接尾辞計算が Clerk 公式 SDK と同じ値） | **無改変**（drift 検査対象） |
| `auth-mode.ts.example` / `auth-mode.test.ts.example` | `resolveAuthMode`（Clerk の `useUser` 状態 → `data-auth` の値。純関数）とテスト | **無改変**（drift 検査対象） |
| `AuthModeSync.tsx.example` | Clerk 読込後に `<html data-auth>` を裏取りして上書き（描画無し）。`auth-layout` の `ClerkProvider` 直下 | **無改変**（drift 検査対象） |
| `ClerkMountFallback.tsx.example` | `<SignIn fallback={…}/>` に入れる**同寸**プレースホルダ。箱モデルは `CLERK_CARD_BOX_MODEL`、ボタン構成・ロゴ・文言は `auth-brand.config` / `clerk-localization` から | **無改変**（設定で変える） |
| `AuthBrowserSessionNotice.tsx.example` | 未ログイン向け注意書き。SSR で描き `.guest-only` で出し分け。文言は `auth-brand.config.browserSessionNotice` | **無改変**（設定で変える） |
| `clerk-script-versions.ts.example` / `.test.ts.example` | clerk-js / @clerk/ui の実バージョン固定（`next.config.ts` の env へ）とSDK メジャーとの整合テスト | 値は自 FAPI で取り直す（コメントのコマンド） |
| `AuthPageShell.first-paint.test.tsx.example` | 初回描画（Clerk 未読込）の契約テスト（全画面オーバーレイ無し／注意書きが SSR 時点で存在／同寸プレースホルダが最初から居る） | **無改変**（drift 検査対象） |
| `e2e/sign-in-no-flicker.spec.ts.example` | Playwright: 本物の Clerk カードとプレースホルダの高さ一致 ±1px・オーバーレイが一度も出ない。先頭の定数（本番プロバイダ数）だけ合わせる | 先頭定数のみ |

★「無改変」のファイルは `_docs/instruments/check-drift.mjs` の PAIRS に登録してある
（surechigai のコピーとバイト一致を機械検査。④の部品は本家 `kimitolink-linktree` が最初のコピー先で、
金型化（2026-10-05）の時点では本家側の実装が先に在り、金型へ揃える配布は未着手）。
**書き換えたくなったら金型側を直して配り直す。**

## 使うとき

```
1. auth-brand.config.ts.example → lib/auth-brand.config.ts にコピーして**値を書き換える**
     （serviceName・intro・forceFrontendApiDomain も忘れずに）
2. 残りを対応する場所へコピー（.example を外す）
     AutoAdvanceToX.tsx            → components/
     auth-routes.ts                → lib/
     auth-page-shell.tsx           → components/AuthPageShell.tsx
     auth-page-intro.tsx           → components/AuthPageIntro.tsx
     auth-layout.tsx               → app/(auth)/layout.tsx
     sign-in-page.tsx              → app/(auth)/sign-in/[[...sign-in]]/page.tsx
     clerk-localization.ts         → lib/
     clerk-appearance.ts           → lib/   （LOGO_PATH を実在パスに）
     kimito-link-redirect.ts       → lib/
     KimitoLinkRedirect.tsx        → components/
     auth-guide-page.tsx           → app/(auth)/auth/kimito-link/page.tsx
     kimito-link-redirect.test.ts  → __tests__/
     signed-in-bounce.ts           → lib/
     signed-in-bounce.test.ts      → __tests__/
   ── ④ ログイン画面のちらつきゼロ（../README.md ④） ──
     ../head-snippet.html          → lib/auth-mode/head-snippet.html（バイト一致コピー）
     ../auth-mode.css              → app/auth-mode.css（バイト一致コピー。globals.css から @import）
     auth-mode-head-script.ts      → lib/        （app/layout.tsx の <head> 最初の子に
                                                   <script dangerouslySetInnerHTML={{__html: getAuthModeHeadScript()}}/>、
                                                   <html data-auth-cookie-suffix={getAuthCookieSuffix()}>）
     auth-mode-head-script.test.ts → lib/
     auth-mode.ts / .test.ts       → lib/
     AuthModeSync.tsx              → components/ （auth-layout が ClerkProvider 直下に置く）
     ClerkMountFallback.tsx        → components/ （sign-in-page が <SignIn fallback> に渡す）
     AuthBrowserSessionNotice.tsx  → components/ （sign-in-page が noticesAboveCard に渡す）
     clerk-script-versions.ts      → lib/        （next.config.ts の env に CLERK_JS_VERSION / CLERK_UI_VERSION を渡す）
     clerk-script-versions.test.ts → lib/
     AuthPageShell.first-paint.test.tsx → components/
     e2e/sign-in-no-flicker.spec.ts     → e2e/   （test:e2e:smoke 等に足す）
3. `pnpm add @clerk/localizations`（リポのルートで。サブディレクトリで実行するとロックファイルが重複する）
   ★Next.js 16 以上なら middleware のファイル名は `proxy.ts`（`../../../next-app/middleware.ts.template`
   の冒頭コメント参照。中身は同じ `clerkMiddleware()` のまま）
4. LP の CTA を SIGN_IN_AUTO_X_HREF に差し替える（これで X ワンタップが発火する）
```

★`sign-up` ページは**作らない**のが既定。X OAuth だけなら `<SignIn />` が兼ねる。
メール＋パスワード等で新規登録フォームが別に要るサービスだけ、`sign-in-page` をコピーして
`<SignUp />`・`variant="sign-up"` にする（その場合 `SIGN_UP_HREF` も別パスに戻す）。

## ★ログイン画面のちらつきゼロ（2026-10-05 追加）

契約の本文・本家の数字・計測コマンドは [`../README.md` ④](../README.md) に 1 か所でまとめてある（ここへコピーしない）。
Next.js でやることは「使うとき」2 の ④ ブロックのコピーと、次の 3 点:

1. `app/layout.tsx`: `<html data-auth-cookie-suffix={getAuthCookieSuffix()}>` と `<head>` 最初の子のインラインスクリプト
   （`lib/auth-mode-head-script.ts`）。`<link rel="stylesheet">` より前に置く
2. `next.config.ts`: `env: { NEXT_PUBLIC_CLERK_JS_VERSION: CLERK_JS_VERSION, NEXT_PUBLIC_CLERK_UI_VERSION: CLERK_UI_VERSION }`
   （`@clerk/nextjs` 7.x に公開 prop は無く env 経路のみ。値は `lib/clerk-script-versions.ts`）
3. `auth-brand.config.ts` の `clerkCard.providers` を**本番 Clerk Dashboard の構成に合わせる**（数が違うと 58px ずつ縦ずれが戻る）。
   `browserSessionNotice` を自サービスの言葉にする（null で出さない）

★到着時の全画面 intro（`AuthHandoffOverlay` の `phase: "intro"` / `INTRO_MS`）を持っているリポは**撤去する**。
  押下後の handoff 表示だけ残す（本家 PR #381 の A）。Expo の surechigai / doin の
  `components/auth/sign-in-auth-handoff-overlay.tsx`（`INTRO_MS = 1100`）がこの型で、次に配る先
  （`_docs/DESIGN-signin-no-flicker-2026-10-05.md`「適用」）。
★直したら `measure-page-flicker.mjs` で前後を測り、`qa/evidence/` に `summary.txt` / `tiles.png` を残してから閉じる。

## ★別 Vercel プロジェクトへ段階移行（strangler）するとき

旧プロジェクトの `vercel.json` rewrites で移行済みパスだけ新プロジェクトへ外部プロキシする構成。
実損が3件ある（surechigai 2026-10-02）:

1. **`forceFrontendApiDomain: true` にする。** しないと「400 Invalid host」でログイン画面が出ない。
2. **付け替えの順序を守る**: 移植 → 新プロジェクト単体で 200 確認 → `vercel.json` を付け替え。
   未移植のまま付け替えると本番が 404 になる（`/auth/kimito-link` で実際に起きた）。
3. **`trailingSlash: true` だと `next/image` が `/_next/image/?…`（末尾スラッシュ付き）を生成**し、
   `/_next/:path*` だけでは旧プロジェクトの catch-all に流れて `text/html` が返ることがある。
   `vercel.json` に `/_next/image/` 専用の rewrite を足す
   （確認: `curl -D - -o /dev/null "https://<ドメイン>/_next/image/?url=…&w=128&q=75"` が `image/*`）

## ★丸写ししてはいけない場所

`auth-page-shell.tsx.example` は**骨組みだけ**にしてある。
出典の実物は 8 つの自社カード（説明文・キャラ・注意書き）に依存し **795 行**あるが、
それは kimito の文言と導線に強く結びついた UI なので、他サービスでは意味を成さない。

**移植して価値があるのは「配置の順序」**（実損に基づく）:

1. ★Clerk カードを**ファーストビュー最上部**に、遷移予告は**その下**
   （予告を上に置くとボタンが押し下げられ、体感速度が落ちる）
2. モバイルは CTA を先・説明を後。`lg` 以上で左右 2 カラム
3. 安全上の警告（アプリ内ブラウザ等）だけはカードより上に出す

## ★地雷（どれも実損の記録がある）

1. **`<SignIn />` の中身を書き換えない。** 注意書きは**外側に添える**だけ。
   自前 OAuth 化は `db0032a` で**本番ログインを壊した手法そのもの**
   （`eda1133` で標準に戻して復旧）。正本: `CLERK_X_LOGIN_PLAYBOOK.md` §1
2. **click を奪わず送る。** `authenticateWithRedirect` 直呼びは禁止。
   標準ボタンへ本物の click を 1 回送るだけなら、壊れ方の上限が
   「改善ゼロ（＝通常のモーダルが残る）」に固定される
3. ★**`allowedRedirectOrigins` に無いサービスへは沈黙して戻れない**（エラーも出ない）。
   サブドメインなら cookie 共有で動く「はず」だが未検証の理論なので、**明示列挙する**
4. ★**`signInForceRedirectUrl` は `redirect_url` より強い。**
   姉妹サービスから `kimito.link/sign-in` へ送客すると、ログイン後に
   **送客元へ戻れない**（exosome が 2026-09-16 に実測して断念）。
   → 各サービスが**自分の** sign-in を持つ設計にする
5. **satellite 設定は使わない**（同一親ドメインの場合）。`isSatellite: true` は
   verified でない限り `/v1/client/sync` が `form_param_missing` で落ちる
6. ★**Clerk Dashboard の Allowed subdomains への登録を忘れない。**
   kimito.link の Clerk は既定（全許可）から外れて **ON** になっており、
   未登録だと FAPI が拒否して**無言でログインが失敗**する

## ★この金型が判定しないこと

- `AutoAdvanceToX` が依存する Clerk の内部クラス名（`.cl-socialButtonsBlockButton__x` 等）は
  **非公開 API で将来変わりうる**。フォールバック（aria-label / textContent 総当たり）を
  内蔵し、両方外れたら `console.warn` を出すが、**自動では直らない**
- 実ログイン状態での最終確認は**この金型では測れない**（Clerk がサーバー側で cookie を
  張り替えるため）。輸入後に実機で 1 回確認すること

## 関連

- 正本KB: `ai-generic-rules/docs/policies/CLERK_X_LOGIN_PLAYBOOK.md`
- 共有アカウント設計: `kimitolink-linktree/docs/SHARED-ACCOUNT-SATELLITE-GUIDE.md`
- ちらつきゼロ（①）と Vanilla JS 版（②）: `../README.md`

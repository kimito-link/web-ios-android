# kimito.link 共通アカウント: 認証UX金型（ちらつきゼロ＋Xワンタップログイン）

> 状態: 実装済み・実証済み（ちらつきゼロ: exosome MVP確定 2026-09-29・cookie解析バグ修正
> 2026-09-29／Xワンタップログイン: Vanilla JS版正本実装 2026-09-30、Voiceへの適用は次段／
> ★④ログイン画面のちらつきゼロ契約: 本家 kimito.link で実装・本番計測済み（2026-10-05 PR #381、
> フラッシュ 0・縦ずれ 0）。Next.js 金型は `nextjs/` に配置済み、姉妹への配布は未着手）。
> 設計書（読む順の1番目）: `../../../_docs/DESIGN-kimito-family-prepaint-auth-mode-2026-09-29.md`
> ④の設計書: `../../../_docs/DESIGN-signin-no-flicker-2026-10-05.md`
> 実装ハンドオフ: `../../../_docs/IMPLEMENTATION-HANDOFF-kimito-family-prepaint-auth-mode-2026-09-29.md`
> Xワンタップログインの正本: `ai-generic-rules/docs/policies/CLERK_X_LOGIN_PLAYBOOK.md`

## これは何か

kimito.link 共通アカウント（Clerk、`.kimito.link` 親ドメインで `__client_uat` cookie を共有）を
使うサービス向けの、認証まわりの体験を統一する2つの金型を束ねている。

**① ちらつきゼロ**: 「未ログインなら強制送還する」実装が引き起こす**ちらつき**（一瞬本来の画面が
見える→隠される→別画面へ飛ぶ、という非同期判定の待ち時間）を構造的に消す。判定は各ページ
`<head>` 先頭のインラインスクリプトがペイント前・同期的に行い、`<html data-auth="member|guest">`
を確定させる。表示の出し分けは CSS に任せ、JS（`auth-mode.js` 等）は「後から裏取りする係」に
徹する。`location.replace` は使わない。

**② Xワンタップログイン**: kimito.link本体は「Xで無料ではじめる」を1回クリックするだけで、
Apple/Google/Xの選択モーダルを経由せず直接X認可画面へ遷移する。この体験を他サービスにも
揃えるための金型（`x-one-tap-signin.js.example`）。

## 実証元・適用状況

### ①ちらつきゼロ

| プロジェクト | 適用状況 |
|---|---|
| `yukkuri-exosome.link` | MVP実装済み（全21ページ）。2026-09-29に複数cookie併置バグ修正。**2026-10-04にワンタップX適用**（`src/js/auth.js`の`openSignIn()`から呼ぶ・タップ起点のみ・下記注意6）。部品は金型の無改変コピーでcheck-drift登録済み |
| `surechigai-romi.link` | 独自のゲストWebシェル判定に `__client_uat` を統合済み（`lib/clerk-public-routes.ts`）。2026-09-29に同じバグを修正 |
| `kimito-Link-Voice` | `/try/`ページに適用済み（2026-09-29、PR #44） |
| `kimitolink-linktree`（本家） | 2026-10-05 PR #381 で全ページに適用（`lib/auth-mode/head-snippet.html`＝`head-snippet.html.example` のコピーを `app/layout.tsx` の `<head>` に `lib/auth-mode-head-script.ts` でインライン展開、`app/auth-mode.css`＝`auth-mode.css.example` のコピー）。裏取りは `components/AuthModeSync.tsx`。★自インスタンス判定（`data-auth-cookie-suffix`、下記④）は金型側で 2026-10-05 に追加、本家への配布は未着手 |

### ②Xワンタップログイン

| プロジェクト | 適用状況 |
|---|---|
| `kimitolink-linktree` | 実装済み（`components/AutoAdvanceToX.tsx`）。原型・フォールバックセレクタ/ネイティブシェルガードは無し（Web専業のため不要） |
| `surechigai-romi.link` | 実装済み（`components/auth/auto-advance-to-x.tsx`）。フォールバックセレクタ・ネイティブシェル除外ガード・純判定関数分離あり（最も完成度が高い） |
| `kimito-Link-Voice` | 適用済み（2026-09-30 #45、`/try/`）。`js/modules/clerk-auth-client.js`の`openSignIn()`から呼ぶ。コピーはコメントが金型と意図的に違うためバイト一致の対象外 |

## ★Next.js + Clerk を使うなら `nextjs/` を見る（2026-10-01 追加）

このディレクトリ直下は **Vanilla JS 版**（静的サイト・素のJS向け）。
**Next.js App Router + `@clerk/nextjs`** のプロジェクトは
[`nextjs/README.md`](nextjs/README.md) に専用の金型がある
（出典: `kimitolink-linktree` 本番。ClerkProvider 設定・URL集約・待機画面つき）。

★Expo/React Native には**どちらも使えない**。`surechigai-romi.link` の
`components/auth/auto-advance-to-x.tsx` を見ること（Platform 分岐を内蔵）。

## ファイル一覧

- `head-snippet.html.example`: 各ページ `<head>` 最初の子としてインラインで埋め込むスクリプト（①）。
  `<html data-auth-cookie-suffix="…">` が付いていれば自インスタンスの `__client_uat_<suffix>` だけを見る（④、2026-10-05 追加・既定は後方互換）
- `auth-mode.css.example`: `.member-only` / `.guest-only` の表示切替CSS契約（①）
- `auth-mode-cookie-parsing.test.mjs.example`: cookie解析ロジックの契約テスト（実損再現ケース・自インスタンス判定ケースを含む。
  金型本体の `<script>` を偽の document で実行して「テストの写し」と「本番に出る文字列」の食い違いも見る、①④）
- `nextjs/`（Next.js + Clerk 専用）: ④の部品一式（`auth-mode-head-script.ts` / `AuthModeSync.tsx` / `ClerkMountFallback.tsx` /
  `AuthBrowserSessionNotice.tsx` / `clerk-script-versions.ts` と契約テスト・e2e）。一覧は `nextjs/README.md`
- `x-one-tap-signin.js.example`: XボタンへDOM clickを送るワンタップログイン（②）。
  ネイティブアプリシェル除外ガード・CSSセレクタのフォールバックを内蔵
- `kimito-dashboard-link.js.example`: ログイン中だけ本家マイページ（`https://kimito.link/dashboard/`）への
  リンクを描く部品（③、Vanilla JS 版）。依存ゼロ・IIFE・`data-kimito-dashboard-link` コンテナへ描く
- `kimito-dashboard-link.contract.test.mjs.example`: ③の契約テスト（未ログインで描かない／ログインで描く／
  URL が `https://kimito.link/dashboard/` で `?` 無し／addListener でログアウトに追従）
- `nextjs/KimitoDashboardLink.tsx.example`: ③の React 版（素の React。Clerk 状態は props で受ける＝
  `@clerk/nextjs` / `@clerk/expo` / clerk-js のどれでも使える。`nextjs/README.md` も参照）

## 使うとき

### ①ちらつきゼロ

1. `head-snippet.html.example` の中身を対象プロジェクトの全ページ `<head>` 最初の子に埋め込む
   （外部ファイル化しない。ダウンロード待ちでペイント前に間に合わない可能性があるため）
2. `auth-mode.css.example` の内容を共通CSSに追加する
3. `auth-mode-cookie-parsing.test.mjs.example` をコピーし、対象プロジェクトのテストランナー
   （`node:test` / vitest / jest）に合わせて配置する
4. 全ページにスニペットが正しく入っているかのドリフト検知テストを追加する
   （実装例: `yukkuri-exosome.link/test/auth-mode-source-drift.test.mjs`）

### ②Xワンタップログイン

1. `x-one-tap-signin.js.example` を配布先プロジェクトへコピーし、`<script>` タグで読み込む
2. Clerkのログインボタン押下ハンドラ（`openSignIn()`相当）の直後に
   `window.KimitoXOneTapSignIn.triggerAutoXClick({onOverlayShow, onOverlayHide})` を呼ぶ
3. `onOverlayShow`/`onOverlayHide` に全画面ローディング表示の出し入れを実装する
   （正本§4.1「経由ページを見せたくない」。省略すると選択モーダルが一瞬見えてから自動clickされる）
4. 配布先が既に `window.isNativePlatform()`（Capacitor判定）を持っていればそれを自動で再利用する。
   無い場合は `x-one-tap-signin.js.example` 内蔵のフォールバック判定が使われる
5. 実装後、正本§4.1.1のネイティブシェル除外ガードが機能しているか、ブリッジ注入
   （`window.Capacitor={isNativePlatform:()=>true}`）した状態で実際にクリックし、
   自動clickが発火せず通常の選択モーダルが残ることを確認する

### ③本家マイページへの導線（2026-10-05 追加）

**なぜ要るか**: 本家 `kimito.link` のダッシュボード（`/dashboard/`）は共通アカウントの拠点で、
姉妹サービスごとの利用状況カード（`kimitolink-linktree/app/(auth)/dashboard/SiblingServiceCard.tsx`）
がある。姉妹4サービス（surechigai / exosome / doin / voice）は利用状況の書き込み（`/api/hub/summary`）
まで実装済みなのに、**見に行く入口が1つも無かった**（`kimito.link/dashboard` を含むリンクは
4リポとも0件、2026-10-05 に grep で確認）。本家の共通ヘッダー（`components/HeaderNav.tsx`）が
ログイン中だけ「マイページ」→ `/dashboard/` を出すのを写し、姉妹側では `https://` から始まる完全なURLにして出す。
「本家の資産を姉妹が引き継ぐのが最初」の原則どおり、本家の挙動を金型にしたもの。

**置き方**:
1. **ログイン後の画面（マイページ／ヘッダー右上）に置く。LP には出さない**
   （未ログインの人には何も描かれないので LP に置いても意味が無く、置き場所が散るだけ）
2. Vanilla JS（exosome・voice）: `kimito-dashboard-link.js.example` をコピーして `<script>` で読み、
   ヘッダーに `<span data-kimito-dashboard-link></span>` を置く。`window.Clerk` を自動で待って
   `addListener` で追従する。`auth.js` 側で `Clerk.load()` の直後に
   `window.KimitoDashboardLink.attach(window.Clerk)` を呼んでもよい（二重 attach は無視）。
   ①ちらつきゼロを入れているサイトでは、コンテナに `member-only` クラスも付けると
   ペイント前から隠れる（JS が描くまでの空白も出ない）
3. React（surechigai Expo / doin Expo / 本家 Next）: `nextjs/KimitoDashboardLink.tsx.example` を
   コピーし、`useUser()` / `useAuth()` の `isLoaded` / `isSignedIn` を props で渡す。
   React Native では `<a>` が使えないので `as` に `Linking.openURL` する部品を渡す
4. 契約テスト `kimito-dashboard-link.contract.test.mjs.example` をコピーし、冒頭の
   `SOURCE_CANDIDATES` に自リポの配置を足す（`node --test`）。React 版は
   `resolveKimitoDashboardLink` を vitest から直接 import してテストする

**姉妹から本家の sign-in へは送らない**: 姉妹は各自の独自ドメインでログインする方式
（`nextjs/README.md` 地雷4）。本家は `signInForceRedirectUrl=/dashboard/` なので、姉妹から
`kimito.link/sign-in` へ送客するとログイン後に姉妹へ戻れない（exosome が 2026-09-16 に実測）。
だからこの部品は「ログイン中だけ出す」に限定し、未ログイン時は何も描かない。
未ログインの人の導線は各サービス自身の sign-in（②Xワンタップ）に任せる。

**まだ確認していないこと**: 姉妹でログイン済みの人が本家 `/dashboard/` を開いたとき、
本家の middleware が `__client_uat` を見て handshake し、そのまま入れるという理屈は、本家の
`docs/SHARED-ACCOUNT-SATELLITE-GUIDE.md` が「実ログイン未検証」と明記している。
配布後、姉妹でログイン→このリンクを押す→本家のダッシュボードが開く、を実機で1回見ること。

### ④ ログイン画面のちらつきゼロ契約（2026-10-05 追加）

**何が起きていたか**（本家 `kimito.link`、2026-10-05 実測。判断の正本は
[`_docs/DESIGN-signin-no-flicker-2026-10-05.md`](../../../_docs/DESIGN-signin-no-flicker-2026-10-05.md)）:
未ログインで `/dashboard/` を開くと `/sign-in/` へ 307 され、「白 → ヘッダーとカードが出る → 画面全体が紺（到着 intro）→
元に戻るが注意書きが挟まって下にずれる → 薄いプレースホルダが Clerk のボタン群に置き換わり、もう一度高さが変わる」。
①のペイント前判定を入れていても、**sign-in ページだけ**が「最初に描いた画面を後から別の画面に差し替える」型に戻っていた。

**契約**（本家 PR #381 で実装。Next.js の部品は `nextjs/`）:

| # | 契約 | 部品 | 破ると何が起きるか（本家 before の実測） |
|---|---|---|---|
| 1 | **到着時に全画面を被せない。** 全画面の案内はユーザーがボタンを押した後だけ | `AuthHandoffOverlay` 相当から到着 intro（`INTRO_MS`）を撤去 | 紺の全画面が 1.0 秒出て消える＝フラッシュ 2 枚 |
| 2 | **プレースホルダは本物と同寸・同色。** ボタン数・見出し・フッターまで本番の Clerk カードの箱モデルを写す | `nextjs/ClerkMountFallback.tsx.example`（`CLERK_CARD_BOX_MODEL`・`expectedClerkCardBoxHeight()`） | 182px → 474px の差し替えで +242px の縦ずれ |
| 3 | **注意書きは SSR 時点で描き、会員なら CSS で隠す。** `isLoaded` を待って挿入しない | `nextjs/AuthBrowserSessionNotice.tsx.example`（`.guest-only`）＋①の `data-auth` | Clerk 起動後に挿入され +105px の縦ずれ |
| 4 | **Clerk JS の版を固定する**（`@6` → `@6.36.0`） | `nextjs/clerk-script-versions.ts.example` ＋ `next.config.ts` の env | タグ→実バージョン解決の 307 が 2 本、3G で往復ぶん本物が遅れる |
| 5 | **ペイント前に `data-auth` を確定する**（①そのもの） | `head-snippet.html.example` → `nextjs/auth-mode-head-script.ts.example` で `<head>` へ展開、裏取りは `nextjs/AuthModeSync.tsx.example` | 3 が成立しない |
| 6 | **直したかどうかは数字で判定する。** 前後を同じ条件で測り「フラッシュ 0・縦ずれ 0」 | [`templates/scripts/qa/measure-page-flicker.mjs`](../../scripts/qa/README.md) | 「見た感じ消えた」で閉じて再発する |

**本家の数字**（`measure-page-flicker.mjs`、`https://kimito.link/dashboard/` 未ログイン、iPhone 15 Pro Max・CPU×2・3G 相当・10 秒。
出典: before は `_docs/DESIGN-signin-no-flicker-2026-10-05.md` の実測表、after は 2026-10-05 本家 PR #381 本番反映後の同条件の再測定）:

| 指標 | before | after |
|---|---|---|
| 白一色フレーム | 21 枚（0.0〜2.0s） | 16 枚（0.0〜1.5s） |
| フラッシュ（輝度差分 >50） | 2 枚 | **0 枚** |
| 縦ずれ（layout-shift） | 2 回（CLS 0.2155） | **0 回**（CLS 0.0061） |
| 3xx | `/dashboard/`→`/sign-in/` の 307 ＋ clerk-js / @clerk/ui の 307 ×2 | `/dashboard/`→`/sign-in/` の 307 だけ |
| 最初に画面が変わるまで | 2.1 秒 | 1.6 秒 |

白の 1.5 秒はサーバー応答と HTML/CSS の到着で、この契約の対象外（地色のインラインは
`_docs/DESIGN-pwa-launch-screen-2026-10-05.md` 判断 4）。

**計測コマンド**（Playwright が入っているリポのルートで。合否ゲートには入れない。前後比較に使う）:

```bash
node scripts/qa/measure-page-flicker.mjs https://<自サービス>/sign-in/ --out ./qa/evidence/$(date +%F)_signin-flicker/after \
  --cpu 2 --network 3g --seconds 10 --device "iPhone 15 Pro Max"
# exit 0 = フラッシュ 0 かつ縦ずれ 0。summary.txt / tiles.png を qa/evidence/ に残す
```

**契約テスト**: `nextjs/AuthPageShell.first-paint.test.tsx.example`（初回描画に `fixed inset-0` が無い／注意書きが SSR 時点で DOM にある／
同寸プレースホルダが最初から居る／ボタン数が設定と一致し箱モデルの式と整合）、`nextjs/e2e/sign-in-no-flicker.spec.ts.example`
（本物の Clerk カードとプレースホルダの高さ一致 ±1px、全画面オーバーレイが一度も出ない）。

#### 自インスタンス判定（`data-auth-cookie-suffix`）

**なぜ**: `.kimito.link` 親ドメインで cookie を共有しているため、別の Clerk インスタンス（姉妹サービス）の
`__client_uat` も `document.cookie` に見える。①の従来判定は「`__client_uat*` のどれか 1 つでも 0 以外なら member」なので、
**姉妹だけにログイン中・本家は未ログイン**の人が本家 `/sign-in/` に来ると member と先出しし、Clerk 読込後に
`AuthModeSync` が guest へ直す＝注意書きが 1 回切り替わる（本家で 2026-10-05 に観測）。

**仕組み**: Clerk は cookie 名にインスタンス固有の接尾辞を付けた `__client_uat_<suffix>` も書く。接尾辞は
publishableKey から決まる値で、公式 SDK の実装が出典（公式ドキュメントの散文には無い）:

- `@clerk/shared` `getCookieSuffix(publishableKey)` ＝ `base64(sha-1(publishableKey))` を URL-safe 化（`+`→`-`、`/`→`_`）した先頭 8 文字
  （[clerk/javascript packages/shared/src/keys.ts](https://github.com/clerk/javascript/blob/main/packages/shared/src/keys.ts)。
  インストール済み `@clerk/shared@4.33.0 dist/keys.mjs` L206-221 で同一を確認、2026-10-05）
- `getSuffixedCookieName(name, suffix)` ＝ `${name}_${suffix}`
- `@clerk/backend` は `getSuffixedCookie("__client_uat")` を優先して読む（`AuthenticateContext.usesSuffixedCookies`）
- 本番で観測した接尾辞 `ZGVu8CMk`（2026-09-29、surechigai / exosome）はこの形式（8 文字・URL-safe）に一致する

**使い方**:
- Next.js: `app/layout.tsx` で `<html lang="ja" data-auth-cookie-suffix={getAuthCookieSuffix()}>`
  （`nextjs/auth-mode-head-script.ts.example`。`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` から同じ式で計算。
  公式実装との同一性は `nextjs/auth-mode-head-script.test.ts.example` が突き合わせる）
- 静的サイト: 値を 1 回計算して `<html data-auth-cookie-suffix="…">` に書く
  `node -e "const c=require('crypto');console.log(c.createHash('sha1').update(process.env.PK).digest('base64').replace(/\+/g,'-').replace(/\//g,'_').slice(0,8))"`
- **付けなければ従来判定のまま**（既存の exosome / surechigai / voice の挙動は変わらない）。
  接尾辞付き cookie が無ければ guest（接尾辞無しの値は見ない＝姉妹の cookie に反応しない）。
  形式に合わない値（`[A-Za-z0-9_-]{1,16}` 以外）は無視して従来判定に落ちる。

## 地雷

### ①ちらつきゼロ

1. スニペットを `<body>` 末尾や外部ファイルに置くと、ちらつきが戻る
2. `body > *` を隠すCSSはClerkモーダルごと隠す（2026-09-16に実際に踏んだ事故）
3. **cookie解析は必ずグローバルフラグ+exec-loop（またはmatchAll）で全件走査する。
   `String#match`（グローバルフラグ無し）は使わない**（2026-09-29実損）。
   Clerkはドメイン接尾辞付き `__client_uat_<suffix>` を接尾辞無し `__client_uat` と
   併置することがあり、最初の1件だけ見る実装は誤判定する
4. 実ログイン状態での最終確認は、Clerkがサーバー側で `__client_uat` を毎リクエスト
   強制上書きするため、クライアントJSからの `document.cookie` 偽装によるテストは
   原理的に不可能（2026-09-29実地検証で判明）。品質保証は単体テスト（cookie解析ロジックの
   契約テスト）とドリフト検知テストで積む
5. **親ドメインを共有する姉妹の `__client_uat` に反応して member と先出しする**（2026-10-05、本家で観測）。
   「姉妹だけにログイン中」の人が本家 sign-in に来ると、注意書きが Clerk 読込後に 1 回切り替わる。
   ①を入れただけでは防げない。自サービスの publishableKey から作った接尾辞を
   `<html data-auth-cookie-suffix>` で渡す（上記④「自インスタンス判定」）。接尾辞の計算式は
   Clerk 公式 SDK（`@clerk/shared getCookieSuffix`）と同一にし、自前の推測で書かない
6. **「ログイン中にしか意味の無い案内」は先出ししない**（本家 `AddXAccountNotice` の判断、2026-10-05）。
   5 の理由で cookie だけでは「自サービスにログイン中」と断定できないため、ログイン中向けの案内は
   Clerk の `isSignedIn` 確定を待つ（誤表示を出さない側に倒す）。先出しするのは「未ログイン向け」だけ

### ②Xワンタップログイン

1. **Clerk公式のOAuth直接遷移API（`signIn.authenticateWithRedirect()`/`signIn.sso()`）を
   使わない**。一見「車輪の再発明を避ける世界標準」に見えるが、`<SignIn/>`を捨てる設計変更を
   要求し、kimito.linkで実際に本番ログインを破壊した実績（commit db0032a）がある
   （正本`CLERK_X_LOGIN_PLAYBOOK.md`§1・§4.1・§6で名指しで禁止）。DOM操作でclickを
   「送る」方式（このファイルの実装）が、公式ドキュメントより優先すべき社内実測知見
2. **ネイティブアプリシェル内では自動clickを発火させない**。2026-08-05に実際に
   App Store Guideline 4.8で却下された（Sign in with Appleは実装済みだったが、
   自動clickのせいで審査員がAppleを選ぶ機会が無く「サードパーティログインしか無い」と判定）
3. CSSセレクタ（`.cl-socialButtonsBlockButton__x`等）はClerkの非公開内部クラス名で
   将来変わりうる。セレクタ不一致時のフォールバック（aria-label等の総当たり）を必ず残す
4. 「永久ロックにするな」——1回発火したら二度と発火しない設計にすると、X認可画面で
   キャンセルして戻った人が再挑戦できなくなる。短時間クールダウン（3秒）に留める
5. モーダル型（`Clerk.openSignIn()`）でも埋め込み型（`<SignIn/>`）と同じCSSクラス体系を
   使うことを実測済み（2026-09-30、kimito-Link-Voice）。ただし3プロバイダ表示時は
   Clerkが自動でアイコンボタン化するため、`Block`版ではなく`Icon`版セレクタが一致することがある
6. **呼び出し元が「ページ読み込み時に自動でログインを開く」構成だと、ゲストがタップ無しで
   Xへ強制遷移する**（2026-10-04、`yukkuri-exosome.link`の本番で実際に起きた。PR #11→#12で修正）。
   exosomeは「記録操作の直前にログインを求める関所」(`YEStorage.set`)が`openSignIn()`を自動で
   呼ぶが、`advice.js`のように読み込み時に書き込むページでは、開いただけで関所が発火する。
   以前は閉じられるモーダルが出るだけだったので気づきにくく、ワンタップを足して初めて
   「強制遷移」という実害に変わった。
   ★対処: `triggerAutoXClick()`を呼ぶ前に`navigator.userActivation.isActive`
   （直近のタップ・クリック）を**同期で**判定し、タップ起点でなければ呼ばない（通常モーダルのまま）。
   activationは約5秒で切れ、Clerk読込がそれを超えうるので、非同期処理より前に判定する。
   非対応ブラウザは「タップ扱いにしない」側へ倒す。
   ★ワンタップを自動化する側が、呼び出し元の呼び方（タップ起点か自動か）を知らない限り
   起きる。自サイトに「読み込み時に`openSignIn()`相当が走る経路」が無いか適用前に探すこと
   （`grep -rn "openSignIn" src`で呼び出し元を全部見る）。

7. **フォールバック検索はページ全体でなく Clerk の UI の中だけにする**（2026-10-04、`yukkuri-exosome.link` の本番で実損）。
   LP の「X でかんたんログイン」を押すと、部品のフォールバック（`/twitter|x|…/` を `button, a` 全部に当てる）が、
   モーダルの描画前にページ自身の `.lp-xbtn` を拾って合成クリックし、`openSignIn()` に再入して本来の X ボタンへ進めなかった
   （`openSignIn` が2回呼ばれ、2回目は `trusted=false` のクリックから、を計測して確認）。
   ★対処: 検索範囲を `.cl-rootBox, .cl-modalBackdrop, .cl-signIn-root` の中に限定し、Clerk の UI がまだ無ければ何も返さず次のポーリングを待つ。
   ★確認の落とし穴: **モーダルが出た後にこの関数を呼ぶと Clerk 側のボタンが先に見つかり、再現しない**。モーダルが無い状態で呼ぶこと。
   ★同じ総当たりは surechigai(`auto-advance-to-x.tsx`)・doin(`auto-advance-to-x.tsx`)・Next.js 金型にもある。
   そちらは `/sign-in` 専用ページで、ページ自身の X ボタンに当たりにくいため実害は未確認（潜在リスク）。
   新しいページ（特に LP のようにページ自身が「X で…」ボタンを持つもの）へ入れるときは、検索範囲を必ず Clerk の UI に絞ること。

# kimito-link姉妹サービス「未ログインでも中身が見える／使う瞬間だけXログイン」統一設計（ちらつきゼロ）

> **状態: 設計完了・実装未着手（要本人承認）。**
> 設計＝Fable / 裏取り＝Fable自身が実ファイルで先行実施、司令塔はまだ実ファイル裏取りを重ねていない。
> 3段構えワークフロー（council-fable）の手順2（Fableへの設計委譲）の産物。日付: 2026-09-29。
> 保存判断: 司令塔（本セッション）がこのファイルへ保存。

## きっかけ・背景

ユーザーから「`yukkuri-exosome.link`にアクセスするとLPにリダイレクトされてちかちかする」という報告に始まり、
調査を進める過程で「`surechigai.kimito.link`も同じちらつきがある」「`kimito.link`本体には無い」という
本人の実地確認が得られた。本人の結論: 「なかみをみえて価値を出すのは大事、ただつかうのはXログイン」
＝ログイン必須という業務要件（2026-09-09にオーナーが確定済み）は変えず、「未ログインで何も見せない」
という**実装**だけを見直したい、という要望。`kimito.link`全体をこの方式に揃えたい、という提案を受けて
Fableに統一設計を委譲した。

## 0. 裏取りで判明した前提（依頼文の補正を含む）

| サービス | 実態（実ファイルで確認） |
|---|---|
| exosome (`yukkuri-exosome.link/src/`) | 全21ページ中19ページが `js/auth-gate.js` を **`<body>` 末尾**で読む（`src/index.html:56-58`、`<main id="today-screen">` の後）。`boot()` は `DOMContentLoaded` で走り、未ログインなら `hideApp()`→`location.replace('lp/')`。**最初のペイントが終わった後に判定して隠して飛ぶ**構造。これがちらつきの正体。`PUBLIC_PATHS` に `/terms/` があるが terms ページは存在しない（privacy と lp のみ gate 無し）。 |
| surechigai (`surechigai-romi.link`) | **すでにゲストシェルが実装済み**（`lib/clerk-public-routes.ts` `shouldUseGuestWebShell`、`components/post/post-guest-screen.tsx`、`+html.tsx` のブートベール `data-auth-boot`）。ただし ①ログイン済みヒント `hasClerkSessionHint()` は localStorage の clerk キーと `__session=` cookie しか見ず、**`.kimito.link` 共有 cookie `__client_uat` を一切読んでいない**（grep で0件）。②`app/_layout.tsx:116-125` の自己コメントどおり、認証プロバイダ chunk 解決時に「placeholder → OnboardingGate>ClerkRootProvider」へ**ラッパーが差し替わり stack 全体が再マウント**される。③ベール解除は「React マウント後 2 rAF」で、認証解決前（`isAuthReadyForUI=false`）に外れるため `ChunkFallback` スケルトンが挟まる（`app/(tabs)/index.tsx:15-23`）。→ ログイン済み利用者の体験は「ベール→スケルトン→（再マウント）→本体」の3〜4段遷移。これが「激しくちかちか」の最有力候補（未計測。④ゲスト `/` の `deferNativeWind` による FOUC の可能性も未確認）。 |
| voice (`kimito-Link-Voice`) | サーバー側 Clerk 化は main マージ済み、**フロント接続は別PR保留・Render の env 未設定**（`docs/DESIGN-clerk-migration-2026-09-26.md` 冒頭表）。`index.html:53` は `<div id="publicPage" class="public-page active">`＝**ログイン前ページが既定で表示され、`checkAuthStatus()`（`/api/user/me` fetch）の結果で後からダッシュボードへ切替える**構造。つまり voice は「価値が先に見える」点では目標形に最も近いが、**同じ「後から判定して切替」型なので、フロントPRが入った瞬間に同種のちらつきを継承する**。さらにヘッダーの `.btn-login` が `fab fa-twitter` アイコン＋「ログイン」、モーダル見出しが「Xアカウントでログイン」（`index.html:74-75, 930`）で、ASC アプリ（ascAppId 6809058070）としては 4.8 の文言リスク。 |
| kimito.link (`kimitolink-linktree`) | `app/(public)/layout.tsx` は Clerk 非依存、`public-route-clerk-independence.test.ts` で機械強制。加えて **`SoftReconnectBanner`**（非機密 cookie `kimito_me` を見て「戻る」導線だけ出す、Clerk を読まない、無ければ何も出さない fail-closed）という「公開ページ＋やさしい再入場」の完成形がある。 |

**3サービス共通の真因は1つ**: 「ログイン状態を、最初のペイントの**後**に、非同期に判定して、画面を差し替える」こと。kimito.link 本体が無症状なのは、判定を**ルーティング層（ペイント前）**に置き、公開画面は Clerk の答えを待たないから。

## A. 理想の体験フロー

3人の来訪者で定義する。**どの来訪者も「最初に描かれた画面が最終形」**（後から別画面に差し替わらない）。

**A-1. 初めての人（cookie なし）**
1. `/` を開く → 即座に**アプリ本体のトップがそのまま見える**（exosome なら今日のセルフケア画面、surechigai ならポスト/イベント/図鑑のタブ、voice ならナレーター一覧と試聴）。スピナー・ベール・LP への強制送還は無い。
2. 中身は「使うとこうなる」が伝わる状態: 空欄ではなく、**サンプル表示（「例」ラベル付き）＋ 1行のやさしい説明**。閲覧・タブ移動・試聴（voice）・用語集/基礎知識（exosome）・イベント一覧閲覧（surechigai、既存 Guest preview）は自由。
3. **「使う」操作**（記録を保存する／写真を残す／チェックインする／音声をアップする／お気に入りを残す＝**データを書く操作**）に触れた瞬間だけ、その場に Clerk 標準のサインインシート（X 主役・Apple・Google 併記）が開く。画面遷移しない。
4. ログイン成立 → **同じ画面のまま**サンプルが自分のデータに置き換わり、押しかけた操作がそのまま続く（可能なら操作の意図を保持して再実行）。

**A-2. すでに kimito.link 系のどこかでログイン済みの人（`.kimito.link` の `__client_uat` ≠ 0）**
1. 開いた瞬間から**メンバー用レイアウト**が描かれる（ゲスト用ヒーローは一度も見えない）。Clerk 読込中は**同じレイアウトの骨格（スケルトン）**か、アプリ起動と同じ意味のブランドベール（surechigai 既存 `#romi-boot-veil`）で待つ。
2. Clerk 解決 → 骨格にデータが入る（レイアウトは動かない＝ちらつきではなく「読み込み完了」）。
3. もし実セッションが切れていた場合だけ、**明示的なトースト**「ログインが切れました。もう一度サインインしてください」を出してゲスト表示へ。黙って別画面に飛ばさない。

**A-3. App Store 審査員（初回起動・ログイン無し）**
1. 起動 → 全タブ/主要ページの中身が見える（2.1(a) の「中身が見られない」が構造的に解消。デモアカウントは引き続き登録するが、依存度が下がる）。
2. 任意の「使う」操作 → Clerk シートに **X / Apple / Google が同列**で並ぶ（4.8）。
3. デモアカウント（`app.config.json` の `demoAccountUsernameSecret`/`PasswordSecret`）でパスワードログイン → データ画面。

## B. 統合アーキ（技術ごとの当て方）

共通原則は1行: **「認証モードは最初のペイントの前に、同期的に、cookie だけで決める。ページの表示はそれだけで確定させ、Clerk は"確認と実データ"のためだけに後から読む。」**

判定シグナルは3サービス共通で **`__client_uat` cookie**（`.kimito.link` 共有・非 HttpOnly・値は Unix 秒・`'0'`＝ゲスト・中間状態なし。exosome `auth-gate.js:143-151` で実測済み）。localStorage のヒントは端末・タブ・サービス単位でしかなく、初訪問時に外れるので**主シグナルにしない**。

### B-1. exosome（静的 HTML・ビルド無し・Capacitor server.url）
- **判定を `<head>` の先頭へ移す**: 全ページの `<head>` の**最初の子**（`<link rel=stylesheet>` より前）に、同一のインライン `<script>`（数行）を置き、`__client_uat` を読んで `<html data-auth="member|guest">` を付ける。DOM 構築より前に属性が決まるので、最初のペイント時点で正しいモードの CSS が効いている。
- **表示は CSS 契約で決める**: `html[data-auth="guest"] .member-only { display:none }` / `html[data-auth="member"] .guest-only { display:none }`。要素は両モード分が1つの HTML に同居し、JS 無しでも正しい側だけが見える。**`body > *` を対象にする CSS は禁止**（2026-09-16 の `#clerk-components` が隠れた地雷の再発防止）。
- **`auth-gate.js` は「ゲート」から「モード確認係」へ役割変更**（新名 `auth-mode.js` 等）: `location.replace` を持たない。member モードなら `YEAuth.ensureSession()` で裏取りし、切れていたらトースト＋`data-auth=guest` へ（唯一許される事後遷移）。`PUBLIC_PATHS` という概念自体を廃止（全ページ公開、守るのは操作）。
- **「使う」操作の関所は1箇所**: 全24モジュールに散る `YEStorage.set`（`src/js/*.js` で計49箇所）を個別に触らず、`common.js` の **`YEStorage.set` 自体**に「ゲストは記録系キーを書けない → `YEAuth.requireSignIn()` を呼んで false を返す」を入れる。**ゲストが書いてよいキーの許可リスト**（`auth_signed_in`＝auth.js:115 が使う、onboarding 既読、表示設定、notify 設定）を同ファイルに1つ持つ。新モジュールを足しても自動的に関所を通る（fail-closed）。`YESync` は member 限定のまま（既存どおり）。
- **`/lp/` は残す**（外部流入・ストアバッジ・説明用のマーケページ）。ただし `/` からの強制送還先ではなくなり、ゲストのヘッダーから任意で行ける「くわしく」リンクに格下げ。
- Capacitor は本番 Web をそのまま表示するので、**Web を直せばアプリも直る**（追加作業なし）。

### B-2. surechigai（Expo / React Native Web、既存ゲストシェルを活かす）
- 新規に作るものは少ない。**直すのは「判定シグナル」と「遷移の回数」**。
  1. `hasClerkSessionHint()`（`lib/clerk-public-routes.ts:74`）と `+html.tsx:315` のインラインスクリプトの判定条件を **`__client_uat ≠ 0` を第一条件**に統一（既存の localStorage/`__session` 条件は補助として残してよい）。両者が同じ条件であることは既存テスト `guest-shell-no-clerk-chunk.test.ts` と同型の契約テストで固定。
  2. **member ヒントがある時は stack を placeholder の下でマウントしない**。現在は `_layout.tsx:367-377` で「chunk 解決待ちの一瞬」に placeholder ラッパーの下へ stack を描き、解決後にラッパーが差し替わって stack 全体が再マウントされる（自己コメントで認めている構造的再マウント）。member モードでは「ベールのまま chunk 解決を待ち、揃った時点で初めて `OnboardingGate>ClerkRootProvider>{stack}` を一度だけマウント」に変える。stack の親が最初から最終形なので再マウントが消える。
  3. **ベール解除条件を「React マウント後 2 rAF」から「認証済み画面が描ける状態（`isAuthReadyForUI`）」へ**。ゲストにはベールを掛けない（現状どおり）。6秒の保険タイマーは維持。
- ネイティブ（iOS/Android）はゲストシェル対象外（`Platform.OS === "web"` 条件）で、起動スプラッシュ→アプリの1遷移なので構造変更なし。4.8 は D 節の単一導線契約で守る。

### B-3. voice（静的 HTML + Express/Render、フロント Clerk 接続 PR が保留中）
- **保留中のフロント PR の中で最初から正しい形にする**（後から直すと二度手間）。
  1. exosome と**同一のヘッド・インラインスクリプト**（`data-auth`）を `index.html` の `<head>` 先頭へ。`#publicPage.active` を JS で外す方式をやめ、`html[data-auth]` の CSS で `#publicPage` / ダッシュボードの初期表示を決める。
  2. `checkAuthStatus()` は「表示を切り替える係」から「member モードの裏取り＋ユーザー情報の充填係」へ（切れていたらトースト→guest）。
  3. `.btn-show-login` はカスタムモーダル `#loginModal`（「Xアカウントでログイン」）を経由せず、**直接 `openSignIn()`**（`js/modules/clerk-client.js`、Clerk 標準の X/Apple/Google 選択画面）を呼ぶ。ヘッダーの `fab fa-twitter` アイコンと「Xアカウントでログイン」文言は撤去または「X・Apple・Google でログイン」に変更。
  4. 「使う」操作の関所: 音声アップロード等の API はサーバー側で `requireClerkAuth` により既に 401 で守られている。フロントは**クリック時に `data-auth` を見て先にシートを開く**（401 を待ってから開くのは「弾いてから戻す」で遅い）。
- voice は既に「価値が先に見える公開ページ（ナレーター一覧＋試聴）」を持つので、**このパターンの見本**として最も説明しやすい。

### B-4. kimito.link 本体
- 変更なし。共有部品としての貢献は「`__client_uat` を読むヘッド・スニペット」を **`web-ios-android/templates/web/` に金型化**すること（基準⑤: 複数プロジェクトで繰り返す部品はキットへ格上げ）。exosome と voice が同じスニペットを貼り、契約チェック（C-6）でドリフトを検出する。

## C. 具体機構（ちらつきを構造的に防ぐ）

**C-1. 判定点 = ペイント前**
- 静的 HTML: `<head>` 先頭のインライン同期スクリプト（外部ファイル不可。外部だとダウンロード待ちで最初のペイントに間に合わない可能性がある）。
- Expo: `+html.tsx` の既存インラインスクリプト（既にペイント前。条件だけ直す）。
- Next.js: サーバー（既存）。

**C-2. 出力 = `html[data-auth]` 1属性**
- 値は `member` / `guest` の2つだけ。「loading」を作らない（第3状態を作ると、そこから2度目の遷移が生まれる）。

**C-3. 表示 = CSS 契約**
- `.guest-only` / `.member-only` の2クラス。両方の DOM を最初から持つ。member の中身が Clerk 待ちなら、**同じ寸法の骨格**を member 側に置く（レイアウトシフト＝CLS を出さない）。

**C-4. 関所 = 操作の直前・1箇所**
- exosome `YEStorage.set`、voice クリックハンドラ共通関数、surechigai `KimitoLoginCta`/`useLoginGuide`（既存）。ページ単位のゲートは持たない。

**C-5. 許される事後遷移は3つだけ**
1. member 骨格 → member 実データ（レイアウト固定）
2. guest → member（利用者がサインインした結果。期待どおりの変化）
3. member → guest（裏取りで切れていた時のみ・**必ずトースト付き**・リダイレクトしない）
それ以外（guest→member を自動で、hidden→visible、location.replace）は設計違反。

**C-6. 機械契約（キットの `check-*.mjs` 型、文章ルールで終わらせない）**
- `check-auth-head-snippet.mjs`（新規・templates/diagnostics 候補）: 対象 HTML 全ページで「ヘッド先頭の子が金型と同一ハッシュのインラインスクリプト」「stylesheet より前」であることを検査。exosome は19ページ×手コピーなので、これが無いとドリフトが必ず起きる。
- 「`location.replace(` が認証系 JS に存在しない」grep 契約。
- surechigai: `hasClerkSessionHint` と `+html.tsx` の両方が `__client_uat` を参照する契約テスト（既存 `guest-shell-no-clerk-chunk.test.ts` に追記で足る）。
- Playwright 受け入れ基準（3サービス共通）: (a) `page.on('framenavigated')` 発火回数 = 1、(b) 0/100/300/1000ms のスクリーンショットで主要レイアウト要素の bounding box が同一、(c) `documentElement.dataset.auth` が `DOMContentLoaded` 前に確定、(d) cookie 有り/無し/`=0` の3フィクスチャで実施。「ちらつきゼロ」はこの4つが緑であることと定義する（体感の報告で判定しない）。

## D. Guideline 4.8 / 2.1(a) が壊れないことの確認

**4.8（Sign in with Apple の同列提示）**
- 原則: **ログインを開く関数を各サービス1つに限定**し、全導線（ゲストの CTA・操作の関所・ヘッダーのボタン・LP のボタン）がそれを呼ぶ。その関数は Clerk 標準のプロバイダ選択（X 主役・Apple・Google）を出す。プロバイダ指定のショートカット（`strategy: 'oauth_x'` 等）は sign-in 画面内部以外で禁止。
  - exosome: `YEAuth.openSignIn()`（`auth.js:106` で「provider は指定しない」を既に明記）
  - voice: `openSignIn()`（`js/modules/clerk-client.js`）— ただし現状のモーダル文言・Twitter アイコンを直すこと（B-3-3）
  - surechigai: `KimitoLoginCta` → `/sign-in`（Clerk `<SignIn/>`）。`auth-providers.test.ts` が「Apple 有効時は X 単独と言い切らない」を固定済み
- 追加契約: 「ログイン導線の総数」と「単一関数を経由する数」が一致することを grep で検査（surechigai build 524 却下＝「SIWA はあるが到達経路が1本、他11画面が X へ直行」の再発防止そのもの）。今回の設計は関所が増える（＝ログイン導線が増える）ので、この契約が無いと却下リスクは**上がる**。設計と同時に入れる。
- 文言: 「Xでログイン」だけの見出し・ボタンは、Apple が出る面では使わない（surechigai の `authProvidersHeadline` と同じ考え方を exosome/voice にも）。

**2.1(a)（審査員が中身を見られる）**
- 新設計では未ログインでも全画面の中身が見えるため、2.1(a) の構造的リスクは下がる（副次的に 5.1.1(v)「不要なログイン要求」への耐性も上がる）。
- デモアカウント運用は継続。**審査シナリオ**: 起動→全タブ閲覧（ログイン無し）→「使う」操作→Clerk シート→デモアカウントで**パスワード**ログイン→データ画面→記録が保存される→サインアウト→ゲスト表示に戻る（トースト無し。自発的サインアウトは C-5 の 3 とは別）。
- **未確認（提出前に必ず確認）**: Clerk インスタンスでパスワード（またはメール）サインインが有効で、シートに入力欄が出ること。X/Apple/Google のボタンだけだと審査員はデモアカウントを使えない。surechigai の `app.config.json` には `demoAccount*` キーが見つからなかった（exosome にはある）。surechigai 側の審査ノートの所在は未確認。

## E. MVP（最初に検証する1サービス）

**exosome 1本で検証する。**

理由:
1. **真因が完全に説明でき、再現が確実**（body 末尾の `auth-gate.js` が DOMContentLoaded で `location.replace`）。直した結果を A/B で計測できる。
2. **変更範囲が最小**: ビルドツール無しの静的 HTML。ヘッド・スニペット（数行）＋ CSS 2クラス＋ `YEStorage.set` の関所＋ `auth-gate.js` の redirect 撤去。既存の Clerk 接続（`auth.js`）・LP・同期は触らない。
3. **Web を直せばアプリも直る**（Capacitor server.url 型）。1デプロイで Web/iOS/Android を同時検証でき、審査観点（4.8/2.1(a)）の確認も同じビルドで済む。
4. **voice がそのまま写経できる**: voice の保留中フロント PR は「静的 HTML＋Clerk モーダル」で exosome と同型。exosome で確定した金型（スニペット＋契約チェック）をキットに置いてから voice に貼る順番が、二重実装を防ぐ。
5. surechigai は既に 8 割できており、残りは `_layout.tsx` の再マウント構造という**過去に2度の審査却下・回帰を生んだ領域**（2026-07-11 ディープリンク転落、2026-08-19 iOS 518 却下）。先に計測（Playwright トレースで遷移回数を数える）してから触るべきで、MVP には向かない。

MVP の完了条件: C-6 の Playwright 4基準が exosome の `/` と `/me/` で緑、Android エミュレータ（`docs/ai-workflows/EMULATOR-VERIFY-HOWTO.md`）で起動→ゲスト閲覧→関所→Clerk シート→ログイン→同一画面でデータ表示、まで録画で確認。

## F. 捨てた案と理由

| 案 | 却下理由 |
|---|---|
| ゲストにもローディングスピナー/ベールを掛けて判定を隠す | 価値が見える瞬間を遅らせ FCP を悪化させる。「隠す→出す」自体が1遷移で、ちらつきの種類が変わるだけ。本体の症状（判定がペイント後）は残る。 |
| 現行の `visibility:hidden` を強める（body 全体を先に隠す） | 現行 `auth-gate.js` の方式そのもの。2026-09-16 に `#clerk-components` まで隠して「何も出ない」事故を起こした系統。hidden→visible/navigate の遷移は構造的に消えない。 |
| Cloudflare Worker / Edge で cookie を見てサーバー側リダイレクト | 静的サイトに新しいインフラ層を足す（過剰設計）。Capacitor server.url は結局ページを読み込む。リダイレクト自体が「弾いてから戻す」で、依頼の前提（インフラ不変・UI/ルーティングの設計に絞る）に反する。 |
| Clerk satellite 化・Clerk の `<SignedIn/>` 系コンポーネントに寄せる | satellite は 2026-09-05 に実測で不採用確定（`form_param_missing link_domain`）。静的 HTML では React コンポーネントが無く、しかも Clerk SDK 読込（762KB・TBT 1,780ms の実測）を全員に強いる。 |
| 全員に Clerk SDK を先読みして判定を速くする | 2026-08-17 の surechigai 実測で退けた方向（ゲストの最大 chunk）。速くなっても「ペイント後判定」は残る。 |
| sessionStorage の「一度見た」フラグで2回目以降だけ直す | 初訪問（＝審査員・新規）で効かない。タブ単位で外れる。 |
| ログイン必須要件そのものを外す（旧「すみわけ」に戻す） | 2026-09-09 のオーナー判断で確定済み。今回の対象は「未ログインで何も見せない実装」であって要件ではない。 |
| `/lp/` をゲストの正面玄関にし続ける（現行） | 中身の価値が LP のコピーでしか伝わらない（「商品の品質より伝わり方」の逆行）。LP とアプリで説明が二重管理になり、しかも到達がリダイレクト経由でちらつく。LP は外部流入用に残すだけ。 |
| 静的 HTML にビルド工程を導入してテンプレート展開する | 19ページ×手コピーのドリフト対策としては正しいが、exosome の「ビルド無し」を崩す大改修。契約チェック（C-6）で同等の安全性が得られる。 |

## G. 地雷と回避策

1. **スニペットの置き場所を間違える**: `<body>` 末尾や外部ファイルにすると、ちらつきがそのまま戻る。→ `check-auth-head-snippet.mjs` で「head の最初の子・stylesheet より前・金型と同一ハッシュ」を機械検査。
2. **`__client_uat` の複数形**: Clerk はドメイン接尾辞付き `__client_uat_<suffix>` を併置することがある。`auth-gate.js:149` の正規表現 `__client_uat[^=]*` は既に対応済み。金型でも「いずれか1つが `0` 以外なら member」とし、`=0` を「ログアウト済みの明示」と扱う。
3. **exosome の関所が内部フラグまで止める**: `YEStorage.set` を無差別に止めると、`auth_signed_in`（auth.js:115、サインイン成立時に書く）や onboarding 既読が書けず、**サインインが成立しない／オンボーディングが無限ループ**する。→ 許可リストを `common.js` に1つ持ち、Playwright で「ゲストで全主要操作→`ye_` 記録キーが増えない・シートが開く」「サインイン→フラグが書ける」を確認。
4. **member モードで Clerk が読めない**（オフライン・広告ブロッカーが `clerk.kimito.link` を遮断）: 黙って guest に落とすと「ログインしていたのに記録が消えた」体験になる。→ member レイアウトのまま「接続できません／再試行」を出す。exosome は localStorage の記録がローカルにあるので閲覧は継続できる（`ensureSession` の catch が既に「切れたとみなさない」方針、auth.js:164-169）。
5. **surechigai の `_layout.tsx` 改修が過去の回帰を呼ぶ**: 再マウントを消すと `RestoreDeepLinkAfterAuthBoot`（再マウント対策）の前提が変わる。→ 削除せず、まず `/map` 等への直リンク着地が壊れないことを Playwright で確認してから、不要と証明できた場合のみ外す。`_layout` の実コードを変えるので `CDN_CACHE_EPOCH`（`theme/tokens`）を上げる（2026-08-16 の改名地雷）。ネイティブで `window.addEventListener` を触らない（iOS 518 却下の真因）。
6. **surechigai のゲスト `/` で NativeWind を遅延**（`deferNativeWind`）: FOUC の可能性。**未確認**。トレース計測で「スタイル無し→有り」のフレームが出るかを先に見る。
7. **voice のフロント PR で `openSignIn()` が黙って死ぬ**: Render の `CLERK_PUBLISHABLE_KEY` 未設定だと `fetchPublishableKey()` が例外→ゲスト CTA が無反応。→ surechigai build 520/529 の教訓どおり「押したら見えるエラー」を出す（`_layout.tsx:196-205` と同じ考え方）。disabled にしない。
8. **voice の 4.8 文言**: `fab fa-twitter`＋「ログイン」、モーダル「Xアカウントでログイン」。Clerk シートに Apple が出ても、**入口の見た目が X 専用**だと審査員は X 直行と読む（surechigai 524 の型）。フロント PR と同時に直す。
9. **Capacitor 内でゲスト画面にストアバッジを出す**: 自分自身の DL を勧める画面になる。LP は `Capacitor.isNativePlatform()` で既に非表示（`lp/index.html:421-427`）。ゲスト用トップにバッジを置く場合も同じ判定を使う（新規実装しない）。
10. **Capacitor 冷起動時の cookie 可用性**: WebView が cookie ストア復元前にページを評価すると、member なのに guest と判定する可能性。**未確認**。Android エミュレータで「ログイン→アプリ完全終了→再起動」を録画して確認。判定が外れた場合の救済は C-5 の 2（Clerk 解決後に guest→member）で、リダイレクトではなく同一画面内の置換で吸収する。
11. **デモアカウントがパスワードで入れない**: Clerk 側でパスワード認証が無効だと 2.1(a) で詰む。**未確認**。提出前に Clerk Dashboard で確認し、審査ノートに手順を書く（exosome は `_drafts/` 配下に審査返信の記録あり、リンクはそこから）。
12. **CSS で `body > *` を隠す**: Clerk がモーダルを `body` 直下に足す（2026-09-16 実測）。→ 表示制御は `.guest-only/.member-only` の明示クラスのみ。契約チェックに「認証系 CSS に `body >` セレクタが無い」を含めてよい。
13. **`about/` のような「元 PUBLIC_PATHS」ページの扱い**: 新設計では全ページ公開なので概念ごと消える。ただし `/me/`（個人の記録）はゲスト表示に `noindex` を検討（検索に「空の Me ページ」が載らないように）。

## 実装引き継ぎ時に読ませるべき実ファイル（すべて実在確認済み）
- exosome: `yukkuri-exosome.link/src/js/auth-gate.js`, `src/js/auth.js`, `src/js/common.js`（YEStorage）, `src/js/sync.js`, `src/index.html`, `src/lp/index.html`, `app.config.json`（demoAccount*）
- surechigai: `surechigai-romi.link/app/_layout.tsx`, `app/+html.tsx`, `lib/clerk-public-routes.ts`, `app/(tabs)/index.tsx`, `components/molecules/kimito-login-cta.tsx`, `__tests__/guest-shell-no-clerk-chunk.test.ts`, `__tests__/auth-providers.test.ts`
- voice: `kimito-Link-Voice/index.html`, `js/index-main.js`, `js/modules/auth.js`, `js/modules/clerk-client.js`, `middleware/clerk-auth.js`, `docs/DESIGN-clerk-migration-2026-09-26.md`
- 見本: `kimitolink-linktree/app/(public)/layout.tsx`, `components/SoftReconnectBanner.tsx`, `app/(public)/public-route-clerk-independence.test.ts`
- 金型の置き場（新設提案）: `web-ios-android/templates/web/auth-mode/`（ヘッド・スニペット＋CSS契約＋`check-auth-head-snippet.mjs`）

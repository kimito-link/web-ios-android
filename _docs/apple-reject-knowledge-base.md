# Apple App Store 却下対応ナレッジベース — Capacitor / ハイブリッドアプリ

移植元:
- `partnership_program_website/_docs/apple-reject-knowledge-base.md`(本文・5大脅威・ガイドライン別解説)
- `partnership_program_website/_docs/apple-reject-v1-0-4-no-login-page.md` 〜 `-v1-0-8.md`(各バージョンの却下実例)
- `partnership_program_website/_docs/apple-resolution-center-reply-v1-0-1.md` / `-v1-0-4.md` / `-v1-0-5.md`(実際にAppleへ送って通った返信文)
- `partnership_program_website/_docs/store-review-automation-matrix.md`(自動化の境界線)

このキットで他アプリを立ち上げるときの**永続リファレンス**。Capacitor / Cordova /
WKWebView でWebアプリを包んだ「ハイブリッドアプリ」を Apple に出すと **何で却下されるか**、
**どう返信すれば通るか**を、リバースハック partner アプリ(`com.<...>.<...>`)の実際の
却下→再申請サイクル(v1.0.0〜v1.0.9)で得た一次情報として集約したもの。

> **固有名の一般化**: 実例の固有アプリ名 / ドメイン / 会社名は `<APP_NAME>` `<PRODUCTION_DOMAIN>`
> `<COMPANY>` 等のプレースホルダに置き換えてある。返信文を使うときは app.config.json の値
> (identity.displayName / identity.productionDomain / ownership.organization / businessModel)を
> 当てはめる。認証基盤は実例では Clerk だが、自前ユーザーテーブルでも論理は同じ。

> **使い方**: 却下が来たら (1) Apple メールの Guideline 番号を確認 → (2) 下の該当節へ →
> (3) **Reviewer message** が一致するか照合 → (4) **Fix recipes** を適用 → (5) Resolution Center
> 返信には各節の **verbatim quote**(Apple自身のガイドライン引用)を使う。Apple のレビュアーは
> 自社ガイドラインからの引用を尊重する。

---

## 目次

1. [TL;DR — ハイブリッドアプリの5大脅威](#tldr--ハイブリッドアプリの5大脅威)
2. [却下パターン早見表(原因 → 通った返信の要点)](#却下パターン早見表)
3. [§2.1 App Completeness](#21-app-completeness)
4. [§2.3 Accurate Metadata(スクショ却下の連鎖)](#23-accurate-metadata)
5. [§2.5 Software Requirements](#25-software-requirements)
6. [§3.0 / §3.1 Business model + IAP](#30--31-business-model--iap)
7. [§4.2 Minimum Functionality](#42-minimum-functionality)
8. [§4 Design — ログインで外部ブラウザに飛ぶ](#4-design--ログインで外部ブラウザに飛ぶkimito-2026-06-30-で確定した本命原因)
9. [§4.3 Spam](#43-spam)
10. [§4.7 Mini Apps / Plug-ins](#47-mini-apps--plug-ins)
11. [§4.8 Login Services / Sign in with Apple](#48-login-services--sign-in-with-apple)
12. [§5.1 Privacy / アカウント削除](#51-privacy--アカウント削除)
13. [実際に通った Resolution Center 返信文(テンプレ)](#実際に通った-resolution-center-返信文)
14. [審査前チェックリスト](#審査前チェックリスト)

---

## TL;DR — ハイブリッドアプリの5大脅威

Capacitor + Vite + 認証SaaS でWebアプリを包んだ構成で最も刺さりやすい順:

| # | Guideline | 見た目 | 最安の対処 |
|---|---|---|---|
| 1 | **4.2 Minimum Functionality** | "your app only provides a limited user experience... primarily a website bundled into an app" | ネイティブ専用機能を2つ以上(push / 生体認証 / native share / offline)+ ネイティブタブバー |
| 2 | **2.1(a) App Completeness** | "we were unable to sign in" / "no login page" / 白画面 | 2FA無効のデモ垢 + 生きたバックエンド + WebView読込失敗時のネイティブ画面 |
| 3 | **4.8 Login Services** | "uses third-party login but doesn't offer Sign in with Apple equivalent" | carve-out #1("exclusively uses your company's own account systems")を引用 OR Google等を完全非表示 OR SIWA追加 |
| 4 | **2.1(b) / §3.0 "Information Needed"** | ビジネスモデル7問 | 返信で全問先回り回答 + 3.1.3(f)(無料B2Bコンパニオン)を引用 |
| 5 | **5.1.1(v) アカウント削除** | アカウント作成があるのにアプリ内削除が無いと自動却下 | アプリ内削除フロー実装(iOS 16以降 必須) |

---

## 却下パターン早見表

実例(リバースハック partner)で**実際に起きた却下 → 真因 → 通った返信の要点**。
各行の詳細は下の該当節へ。

| 版 | Guideline | Apple の文言(要約) | 真因 | 通った対処・返信の要点 |
|---|---|---|---|---|
| v1.0.0/0.1 | 4.8 / 2.1(a) / 2.1(b) | テンプレ3点(Googleログインエラー / SIWA無し / ビジネスモデル) | 同じテンプレを使い回された(reviewer がコピペ) | **Resolution Center に直接返信** + 4.8 carve-out #1 と 3.1.3(f) を逐語引用。「テンプレ却下に対し事実で反論」 |
| v1.0.4 | 2.1(a) "no login page" + 2.1(b) 7問 | "we were unable to access the app because there was **no login page**" | server.url がマーケLPを指し、ネイティブ起動時に未ログインを `/sign-in` へ誘導していなかった | **NativeAuthGate**(ネイティブ&未認証&非allowlistなら/sign-inへ強制)。allowlistに法務+削除ページ。7問を返信で全回答 |
| v1.0.5 | 2.1 Information Needed "provide a method to sign in" | デモ資格情報が実在しなかった | デモ垢が未プロビジョニング/パスワード不一致 | **返信前にデモ垢を実在化**(provision + verify_password 自己検証)→ 同じbuild(52)で継続審査 |
| v1.0.6 | 2.1(a) Information Needed | reviewer が `apple-reviewer`(`@domain`欠落)でログインできず | submit script が ASC の stale 値を env より優先(`pick()`) | submit で **env を pick() より優先**。版固有の preamble を notes から除去 |
| v1.0.7 | 2.3.3 "screenshots only display a login screen" | スクショがログイン画面のみ | capture script が未認証 `/sign-in` を撮っていた | capture で **デモ資格でログイン → /dashboard 到達後に撮影**。creds 欠落時 exit 1(fail-closed) |
| v1.0.8 | 2.3.3(再) "screenshots only display a login screen" | 新スクショを撮ったのに slot1 が旧ログイン画面のまま | upload が filename 一致で skip(ASC slot は versionString を跨いで persist) | upload で **delete-then-reupload**(撮り直すたび全削除→再upload)。slot1(最左)を最強画面に |
| kimito 0.1.0 | **4 Design** "taken to the **default web browser** to sign in" | ログインボタンで外部Safariが開く | `capacitor.config.ts` の `server.allowNavigation` に **`appleid.apple.com` が無く**、SIWAボタンで未許可ドメイン遷移→iOSが外部Safariを開いた | **allowNavigation に `appleid.apple.com`/`*.apple.com` を追加**（1ドメイン足すだけ・ネイティブパッチ不要・追加のみで本番ログイン無傷）。Googleは WKWebView ブロックのため足さない。詳細§4 Design |
| kimito 0.1.0 | **2.1(a)** ソーシャルログインの仕方が不明 | 審査員がX専用ログイン(email/PWフォーム無し)でアクセス不可 | reviewer notes にログイン手順が無かった | `review-notes/CURRENT-en.txt` を版管理し「Continue with X→デモ垢→2FA無効」手順＋**SIWA保険経路**を明記。詳細§4 Design 末尾 |

---

## §2.1 App Completeness

> Verbatim ([Apple §2.1(a)](https://developer.apple.com/app-store/review/guidelines/#app-completeness)):
> "Submissions to App Review… should be final versions with all necessary metadata and fully
> functional URLs included… include demo account info (and turn on your back-end service!) if
> your app includes a login. If you are unable to provide a demo account due to legal or security
> obligations, you may include a built-in demo mode in lieu of a demo account with prior approval."

### Reviewer message テンプレ

- "We were unable to sign in to review your app because we were unable to verify the credentials provided."
- "the app displayed a blank white screen after launch."
- "we were unable to access the app because there was **no login page**." (v1.0.4 実例)
- "we need to have a way to verify all app features… provide a user name and password" (v1.0.6 実例)

### ハイブリッドが脆い理由

- **初回ロードのネットワーク依存**。ネイティブはskeletonを即描画するが、Capacitor は index.html + JS
  bundle をブロッキングで待つ。reviewer 回線は3G並みに絞られることがある。
- **地域ブロックAPI**。reviewer は Cupertino / Sacramento IP から叩く。CORS / region-gating で白画面。
- **セッション非永続**。ログイン→バックグラウンド→復帰で再ログイン要求 → "exhibited bugs"。
- **cleartext HTTP**。`http://` のサブリソースは ATS にブロックされ無言で壊れる。
- **デモ資格無しのログイン画面 = 即却下**。reviewer は到達できないものをテストできない。

### Fix recipes

1. **デモ資格を2箇所に**。ASC → App Information → "Sign-In Information" + reviewer-notes の両方。
   SMS/social のみは不可、安定した email/password を。
2. **デモ垢の2FAを無効化**。「コードをSMSで送る」は受理されない。
3. **デモ垢にサンプルデータを事前投入**。全機能が見える状態に。
4. **VPN/社内網の外から事前テスト**。クリーンな実機・セルラーで。
5. **WebView読込失敗をネイティブで処理**(`didFailProvisionalNavigation`)。WebKit既定の壊れたページでなく
   ネイティブ "接続エラー / 再試行" 画面を出す。
6. **submit の24h以内にデモ資格を再検証**。トークンローテ/セッション期限切れがコードバグより多い原因。
7. **ログインゲートB2Bアプリ**は reviewer notes に逐語で:
   > "This app is a partner-only dashboard; all functionality requires a partner account by design.
   > Demo credentials pre-seeded with sample partner data."
8. **「ネイティブがマーケLPに起動する」罠(v1.0.4 "no login page")**。`server.url` が公開マーケサイトを
   指すと、ネイティブ起動でそのマーケLPが開く。ログインゲートアプリは起動時にログイン画面を出すこと
   (reviewer はマーケnavの奥の"Login"を探さない)。**NativeAuthGate**: `Capacitor.isNativePlatform()` &&
   未認証 && パスが allowlist 外(sign-in / auth callback / privacy / terms / contact / account-delete)なら
   `/sign-in` へ redirect し、その間マーケ/アプリ内容を描画しない。法務+削除ルートは allowlist に残す
   (Apple/Play が未ログインでも到達可能を要求)。Web/ブラウザ挙動は不変に。静的解析テスト + lint で固定。
9. **再申請のたびに reviewer notes を新鮮に push**。submit script が前版の notes を持ち越す
   (`existing ?? default`)と、毎回 *古い*却下に答え続け "Information Needed" hold が永遠に解けない。
   notes は *現在の*build を反映し *現在の*質問に逐語で答える。
   - **同型バグの第2波(v1.0.6)**: 同じ `pick()` precedence が `demoAccountName` /
     `demoAccountPassword` でも起きた。env(secret)を `pick()` より優先させて根治。

### Built-in demo mode(法務/セキュリティで実デモ垢を共有できない時)

```ts
if (signInIdentifier === '<reviewer-email>' &&
    password === process.env.APPLE_REVIEWER_BYPASS_PASSWORD) {
  return loadDemoSession();
}
```
Resolution Center notes でこのパターンを先に説明すれば reviewer は弾かない。

---

## §2.3 Accurate Metadata

> Verbatim ([Apple §2.3.10](https://developer.apple.com/app-store/review/guidelines/#accurate-metadata)):
> "don't include names, icons, or imagery of other mobile platforms or alternative app marketplaces
> unless there is specific, approved interactive functionality."

### B2B/ダッシュボードで多い5パターン

| Sub | 何を捕まえる | 対処 |
|---|---|---|
| **2.3.3** | スクショがログイン/スプラッシュのみ | ログイン後ダッシュボードを reviewer向けデモデータで撮る |
| **2.3.7** | 汎用/キーワード詰め込みの名前(>30字 or 商標) | ≤30字・他社名なし |
| **2.3.8** | 4+レーティングでない素材 | 全表示素材を4+準拠に |
| **2.3.10** | "Android" "Google Play" "Material Design" 等 | iOS限定の表現に find/replace |
| **2.3.1(a)** | reviewer notes に無い隠し機能 | 全機能を notes に列挙 |

### 診断/測定系プロダクトの「表示と実態の乖離」— §2.3と同根の却下ベクタ(ai-health-check.link 2026-07-07)

AI健康診断系プロダクト(ai-health-check.link・PR #1・commit `059f216`)で `store-guard` が
提出前レビューで検出した blocking 3件。**Apple/Google の店頭審査には出ていないが、
§2.3(Accurate Metadata＝誇大・不正確な表示)と同じ構造の却下ベクタ**なので、測定系・診断系・
スコア表示系プロダクト全般とストア提出物のコピーに横展開する。

**共通の教訓: 測定範囲(=1モデル・1時点・今回の質問)を超える一般化/断定/未測定主張を表示に
出さない。禁句リストと件数チェックは fail-closed(不確かなら止める/控えめに言う)で設計する。**

- **症状(B-2)**: 1回の実測を「相手には〜返る」と全AI・相手一般へ拡張して断定していた。
  - 直し方: 「情報が見つからない」という答えが**返る**状態→**返りうる**状態、に言い換え(1モデル
    1時点の実測を、確定でなく可能性として表示)。`src/kenshin/findings.ts` `key: "ai-blank"`。
- **症状(B-1)**: 由来を測っていないのに「第三者由来の情報でできている状態が**観測されました**」
  と、あたかも実測したかのように表示していた。
  - 直し方: 実測は「そのまま表示を控えた文が複数あった」という事実だけ。由来(第三者かどうか)の
    断定を落とし、「そのまま見せるのを控える内容だった」「公式情報が少ないと外部材料からも
    組み立てられる」という**測った事実の範囲**の記述に修正。同ファイル `key: "external-narrative"`。
- **症状(B-3/W-4)**: 禁句(banned words)リストに効果保証・引用実測を装う表現のガードが無く、
  「改善しました」「参照されています」等が素通りしていた。件数(`negativeSuggestCount`)が
  `undefined` でも「0件提示されている」という自己矛盾文が黙って出ていた(fail-closed でない)。
  - 直し方: `src/kenshin/banned.ts` に効果保証(`改善(しま|されま)|保証(しま|され|付)`等)・
    引用実測の示唆(`引用(され|元)|参照されてい`等)・判定語・幻の統計・医療語を拡充。
    `src/kenshin/findings.ts` の所見3は `negativeSuggestCount === undefined` で `throw`
    し、詰め忘れたまま自己矛盾文を出さないようにした(fail-closed)。
  - 教訓: 禁句CIは正規表現の限界(「〜になります」等の未来助動詞・ユーザー入力の差し込み値は
    網羅できない)を持つ。CIは補助であり、**store-guard の目視レビュー(景表法観点)を置き換えない**
    と `banned.ts` 冒頭にコメントで明記した。
- 横展開先: 測定系・診断系・スコア表示系プロダクト全般、およびストア提出物のコピー。
  「1モデル1時点の実測」を「全AI・相手一般」に膨らませていないか、由来不明の主張を実測表現で
  出していないか、を store-guard の提出前レビューのチェック項目に加える。

### v1.0.7 ケーススタディ — 認証付きスクショ撮影の落とし穴

capture script は Playwright + Chromium + mobile-Safari UA で動く(**Capacitor bridge 内ではない**):

1. **`Capacitor.isNativePlatform()` ガードのUI隠しは Playwright では発火しない**。実iOSで隠れている
   social ログインボタンが capture では丸見え。`getByRole('button', {name:/continue/i})` だと
   「Continue with Google」を先にマッチ → Google OAuth へ遷移 → 認証SaaSのパスワード欄が detach →
   "element is not enabled" で timeout。**2層対処**: (a) `ctx.addInitScript()` で social ボタンを
   CSS で隠す, (b) email/password の submit は **`input.press('Enter')`**(social は非submit type=button)。
2. **workflow の path filter が修正を無言で握りつぶす**。`on.push.paths` に capture script が無いと
   修正を push しても build が再トリガされない(v1.0.8 retry #1 の silent no-op)。workflow が実行する
   全 script を path filter に入れる。
3. **認証SaaSは disabled な input を pre-render する**。email step 中 password 欄は disabled で DOM 存在。
   `waitForFunction(() => el && !el.disabled && el.offsetParent !== null)` で有効化を明示的に待つ。
4. **build-only 失敗で版を bump しない**。capture が fail-closed(exit 1)なら submit は skip される。
   同じ版 slot に修正を再 push すれば新 build number で submit。毎回 bump は ASC の版一覧を汚す。

### v1.0.8 ケーススタディ — ASC のスクショ集合は versionString を跨いで persist

新ダッシュボードスクショ6枚を撮って upload したのに **2回目も 2.3.3 で却下**。ログの煙:
```
iphone-67-1.png: already uploaded; skipping   ← 旧 v1.0.7 のログイン画面
screenshots: uploaded=4 skipped=2
```
slot1(最左・最重要)が旧ログイン画面のまま残った。教訓:
1. **ASC の App Store version slot は versionString を跨いで安定**。version bump は同じ slot の
   versionString 属性を更新するだけ。screenshots / previews / what's-new は持ち越される。
2. **filename ベースの冪等性は、slot 内で内容が変わる素材には毒**。内容が毎回権威的なら
   skip-on-name でなく **delete-then-reupload**。
3. **reviewer は最左スクショを最初に見る**。6枚中4枚が新しくても slot1 が却下理由になる。最強画面を `*-1.png` に。
4. **速い却下(~2.5h)は手がかり**。前回と同じトリガを踏んだ可能性大。「もう直した」を鵜呑みにせず
   実際に出荷された内容(peek + build log)を見る。

### kimito ケーススタディ — OAuth専用ログイン(Clerk×X)は Playwright 自動化が不可能 → 公開ページ方式で回避(2026-06-30)

v1.0.7 は「Playwright で email/password ログインして認証後画面を撮る」前提だった。だが認証が
**OAuth専用(Clerk標準 `<SignIn/>` × X/Twitter)**だと、その前提が崩れる。kimito で storageState
自動取得を**3経路すべて試して全滅**した一次記録:

1. **新規ブラウザで X OAuth を自動ログイン** → X が「ログインを一時的に制限しました」。普段の
   Chrome では同じ垢に普通にログインできるのに、Playwright 制御ブラウザ(CDP痕跡)だけ弾く。
2. **persistent context で普段の Chrome プロファイル(Xログイン済み)を流用** → X 制限は突破し
   Clerk コールバックまで到達するが、**Cloudflare の「私はロボットではありません」CAPTCHA が
   ループ**(チェック→消える→再出現)して突破不可。Playwright制御を Cloudflare が検知。
3. **CDP attach(`--remote-debugging-port`)で手動ログイン済み Chrome に後付け接続** → Chrome 新仕様
   `DevTools remote debugging requires a non-default data directory` で通常プロファイルのリモート
   デバッグが拒否される。

→ **Clerk × X × Cloudflare × Chrome の四重 bot 対策で、Playwright/CDP による認証スクショの
自動取得は事実上不可能**。さらに Clerk の `__session` は **session cookie(ブラウザを閉じると揮発)**
なので「Chrome を閉じてから Cookie DB を sqlite 読み」も無駄(閉じた瞬間に消える)。

**解 = 認証スクショを撮らない。公開ページだけでストアスクショを構成する**(partnership 方式・
`scripts/capture-public-screenshots.mjs` が原型)。リンクまとめ/プロフィール系アプリは公開
プロフィールページに成果物(AI生成bio・リンク・投稿)が実表示されるので、ログイン後ダッシュボードを
撮らなくても価値が伝わる。Apple 2.3.3 は「実アプリ画面」を求めるが、公開ページも実アプリの一部
(WebView がそのまま表示する画面)なので要件を満たす。**次アプリでも OAuth専用ログインなら最初から
公開ページ方式を採れ**(email/PW ログインが使えるアプリだけ v1.0.7 の認証スクショ方式が有効)。

#### 続報(2026-07-02) — 「公開ページ方式」でも“どの公開ページを撮るか”で再却下 → 実プロフを撮れ

6/30に「公開ページ方式」へ切替えたが、実際に撮っていたのは `/store-preview/#store-N`(=マスコット
＋キャッチコピー＋作り物グラフの**紹介モックパネル**・(bare)レイアウトでヘッダ無し)だった。これで
**2.3.3 再却下**(「大半が actual app in use でない」)。**教訓: モックは(bare)でヘッダを消せても、
"ユーザーが到達しない作り物の画面"なので 2.3.3 を満たさない。** 実ユーザーが日常的に見る本物の
画面=**実在の公開プロフィール(kimito は `/streamerfunch/`)** を撮って初めて "actual app in use"。

**実プロフを撮る時の X 露出隠し(§4.8/§2.3.1 対策)= 撮影スクリプト側の注入CSS(アプリ本体は無変更が原則):**
```css
/* ログイン誘導リンクを隠す。ヘッダCTA＋下部CTAの sign-in アンカー */
a[href*="/sign-in"],
/* 「Xでフォロー」等の外部Xリンク。★:not([href*="/status/"]) 必須★ */
a[href*="x.com"]:not([href*="/status/"]),
a[href*="twitter.com"]:not([href*="/status/"]) { display: none !important; }
```
- 🔴**最大の地雷**: `a[href*="x.com"]` を一律hideすると、実ツイートカードのアンカー
  (`x.com/<user>/status/<id>`)まで消えて**実コンテンツが全滅→空slot→2.3.3自爆**。kimito 実測で
  status リンクは11個あった。必ず `:not([href*="/status/"])` で投稿カードを守る。
- **見出し＋文言が残るプロモCTAブロックは、アンカーだけ消しても不十分**(「あなたも作れます/Xでログイン
  するだけ」の文言が残りマーケ素材と見なされうる)。→ そのブロックに `data-screenshot-hide` 属性を
  付け(実挙動不変の静的属性・2.3.1火種にならない)、`[data-screenshot-hide]{display:none}` で
  ブロックごと隠す。`section:has(a[href*="/sign-in"])` は実コンテンツを巻き込むリスクで却下、属性方式が安全。

**撮影スクリプトの実戦チューニング(遅延ハイドレート対策):**
- ツイート枠は IntersectionObserver＋画像(twimg)ロードで初めて高さを持つ。goto 後の待ちが2秒だと
  見出し＋プレースホルダだけ写る → **初期待ち~7秒＋全体スクロールで起こす＋対象内 img の complete 待ち**。
- 背の高い枠(実測857px)は `scrollIntoView({block:'start'})` だと実コンテンツがフォールド下 → `block:'center'`。
- **fail-closed**: scrollToSelector 指定があるのに要素が無ければ**エラーで中断**(silent skip で空スクショ
  提出=2.3.3再発を防ぐ)。X API制限バナー(琥珀)や「取得できません」が出てる時間帯は撮影しない。

#### 続報(2026-07-10・henshin-hisho) — email/PWログイン型の多段撮影4点

email/PWログイン型(Clerk/X OAuth不要)アプリでは前述の「公開ページ方式」を使わず、
`screenshot-plan.json` の `authTabs` でログイン後の実画面を直接撮れる。実践して踏んだ4点:

- **(a) authTabs は順次クリックで状態が引き継がれる**: 各 tab エントリはブラウザ状態(ログイン後の
  画面)を引き継いだまま次のクリックに進むため、「一覧アイテムをクリック→詳細画面が開く」の
  **多段撮影**が1本の plan で組める。詳細画面への遷移に `scrollToSelector` 対応を
  `capture-appstore-screenshots.mjs` に追加した(commit 8e2892b)。
- **(b) 課金導線が写り込んだ状態のスクショは §3.1.3(f) と矛盾して見える**: 設定画面に
  「Billing Portal準備中」のような**未実装の課金UI片鱗**が写ると、「アプリ内に課金を置かない」
  方針(§3.1.3(f)を使う場合)と自己矛盾して見え、審査官の疑念を誘発しうる。**該当画面はスクショの
  撮影対象から除外する**。
- **(c) デモアカウントに現実的な受信データをAPI投入すると一石二鳥**: 空の受信箱のままスクショを
  撮ると棚(shelf)が空写りし、審査官の実機体験でも「機能に到達できない」に見える(2.1却下の温床)。
  デモアカウントへ**現実的なメッセージをAPIで事前投入**しておくと、スクショの見栄えと審査官の
  実体験の両方が改善する。
- **(d) frame-appstore-screenshots.mjs はワークフローに配線しないと生スクショのまま上がる**: 撮影
  (`capture-appstore-screenshots.mjs`)とフレーム合成(`frame-appstore-screenshots.mjs`)は別スクリプトで、
  CIワークフローに両方を明示配線しないと**フレーム無しの生スクショ**がそのままASCにアップロードされる。
  配線時は出力先ディレクトリの向き先(例 `IOS_SCREENSHOTS_DIR=ios-screenshots-framed`)も
  忘れず切り替える。

**ASCアップロードは自動化できる／返信＋再提出は画面のみ:**
- アップロード: `node scripts/app/appstore-upload-screenshots.mjs`(ASC API `/v1/appScreenshots`)。
  認証は `APPSTORE_CONNECT_KEY_ID`/`_ISSUER_ID`/`_API_KEY_P8_BASE64`(kimito は `.secrets-local/`
  の `ASC_KEY_ID.txt`/`ASC_ISSUER_ID.txt`/`AuthKey.p8` から組む)。DRY は `IOS_SCREENSHOTS_DRY=1`。
  古いスクショは自動削除して再UPされる(kimito 実績 uploaded=12 deleted=16)。
- **返信テキストは Apple が API 公開していない → App Store Connect の App Review 画面で貼る**。
  アップロード後、審査ステータスが「却下済み」→「審査準備完了」に変わり「App Reviewに再提出」ボタンが
  押せる(この最終送信も画面のみ・[[android-final-submit-state]] と同じ構造)。返信は「差し替えた事実」
  だけ簡潔に(§下部「実際に通った返信文」の原則)。

---

## §2.5 Software Requirements

- **§2.5.2 リモートコード**: WKWebView で remote URL の HTML/CSS/JS を読むのは安全(Capacitor `server.url`)。
  UIのA/Bテストも安全。審査後にネイティブモジュール追加 / 未使用 private API 呼び出し / 実質的な
  ビジネスロジック変更は違反。
- **§2.5.6 WebKit必須**: Capacitor は既定 WKWebView で準拠。`UIWebView`(ITMS-90809、2020年自動却下)を
  古い Cordova plugin が引き込むことがある。`nm` で `.app` を確認。
- **`server.allowNavigation` の不足は §4 Design 却下に化ける**: 認証プロバイダのドメイン(特に
  `appleid.apple.com`)が抜けていると、そのボタンで未許可ドメイン遷移→iOSが外部Safariを開く＝
  「ログインで外部ブラウザに飛ぶ」却下。→ [§4 Design](#4-design--ログインで外部ブラウザに飛ぶkimito-2026-06-30-で確定した本命原因) 参照。

---

## §3.0 / §3.1 Business model + IAP

> Verbatim ([Apple §3.0](https://developer.apple.com/app-store/review/guidelines/#business)):
> "If your business model isn't obvious, make sure to explain in its metadata and App Review notes."

### §3.1.3(f) — Free Stand-alone Apps ⭐ B2Bコンパニオンに最強

> "Free apps acting as a stand-alone companion to a paid web based tool (i.e. VoIP, Cloud Storage,
> Email Services, Web Hosting) do not need to use in-app purchase, provided there is no purchasing
> inside the app, or calls to action for purchase outside of the app."

無料パートナーダッシュボードの王道免除。条件: (1) 無料 (2) アプリ内 IAP/paywall/有料機能なし
(3) **アプリ外購入への CTA("料金ページへ" "今すぐ購入" "アップグレード")なし** ← 罠条項。iOSで全upsell UIを隠す。

その他: §3.1.3(c) Enterprise Services / §3.1.3(e) Goods and Services Outside of the App。
§3.1.3(a) Reader Apps は B2B ダッシュボードには **適用されない**。

### "Information Needed" — Apple のビジネスモデル質問(実例は7問)

v1.0.4 で来た7問(community集約の5問より多い)。reviewer notes で**全問先回り回答**する:
1. Who are the users that will use the paid services in the app?
2. Where can users purchase the services that can be accessed in the app?
3. What specific types of previously purchased services can a user access in the app?
4. What paid content, subscriptions, or features are unlocked within the app that do not use IAP?
5. Are the enterprise services sold to single users, consumers, or for family use?
6. How do users obtain an account? Do users have to pay a fee to create an account?
7. Do individual customers pay for the content or services?

→ 通った回答は[返信文テンプレ節](#実際に通った-resolution-center-返信文)を参照。

---

## §4.2 Minimum Functionality

> Verbatim ([Apple §4.2](https://developer.apple.com/app-store/review/guidelines/#minimum-functionality)):
> "Your app should include features, content, and UI that elevate it beyond a repackaged website."

**ハイブリッド最大の脅威**。reviewer は1画面目・2画面目を見て、両方がブラウザ風ヘッダのWebページなら flag。

### Fix recipes(効果順)

1. **Webにできないネイティブ専用機能を2つ以上**: push(deep-link payload付き) / 生体認証
   (`LocalAuthentication`) / native share(`@capacitor/share`) / camera / haptics / offline cache。
2. **Webが再現できないネイティブ chrome**: ネイティブタブバー / pull-to-refresh / 起動スプラッシュ→onboarding。
3. **URLバー風の要素を全て隠す**。
4. **外部リンクは `SFSafariViewController`** で開く(embedded WebView でなく)。
5. **reviewer notes にネイティブ機能を画面名つきで明記**(reviewer は1アプリ~3分・見えない機能に気付かない)。
6. **catalog アプリは 4.2.2 で明示的に免除**。

---

## §4 Design — 「ログインで外部ブラウザに飛ぶ」却下（kimito 2026-06-30 で確定した本命原因）

> Verbatim 却下文 (kimito Submission 57b5895d):
> "Guideline 4 - Design: the user is taken to the **default web browser** to sign in or register,
> which provides a poor user experience. Revise the app to enable users to sign in **in the app**.
> You may implement the **Safari View Controller API** to display web content within the app."

OAuth/ソーシャルログインのハイブリッドアプリで頻出。「アプリ内でログインさせろ・外部Safariに飛ばすな」。

### ★最初に疑うのは `allowNavigation` のドメイン不足（実コードで確定した最有力原因・最軽量解）

WKWebView は **`server.allowNavigation` に無いドメインへ遷移しようとすると iOS が外部 Safari を開く**。
認証プロバイダのドメインが allowNavigation から欠けていると、**そのボタンを押した瞬間に外部ブラウザに飛ぶ**＝この却下の症状そのもの。kimito では `appleid.apple.com`(Sign in with Apple) が抜けていた。

**チェック手順（capacitor.config.ts の server.allowNavigation を見る）**:
- 自ドメイン(`kimito.link` / `*.kimito.link`)＋使う認証プロバイダのドメインが**全部**入っているか。
- X(Twitter)ログイン: `x.com` / `*.x.com` / `twitter.com` / `*.twitter.com` / `api.twitter.com`
- Clerk: `*.clerk.accounts.dev` / `<本番frontend API。例 clerk.kimito.link>`
- **Apple(SIWA): `appleid.apple.com` / `*.apple.com`** ← 抜けやすい。足すと WebView 内で完結。
- 1ドメイン足すだけ＝**ネイティブパッチ(navigationDelegate)も @capacitor/browser も不要・Web/`<SignIn/>`無改変**。
  既存ドメインを消さず**追加のみ**なので本番ログイン破壊リスク最小（[[login-winning-pattern]] の轍を踏まない）。

### ⚠️ Google は allowNavigation に足しても解決しない（足すな）

`accounts.google.com` は **embedded WebView からの OAuth を Google 側が `disallowed_useragent` でブロック**する
（§4.8「Google OAuth は WKWebView でブロックされる」参照）。allowNavigation に入れても WebView 内で成立しない。
Google を出すなら別経路(ASWebAuthenticationSession 等)が要る＝重い。Clerk Dashboard で Google を出さない判断が軽い。

### それでも飛ぶ場合の重い対処（allowNavigation で直らなかった時だけ）

プロバイダ側が `window.open`/`target=_blank`/Universal Link で能動的に外部 Safari を開いているケース。
- **4A `@capacitor/browser`**: プラグイン追加(原則1に抵触なし)。だが「いつ Browser.open を呼ぶか」を
  `<SignIn/>` を触らずに実装する必要があり、`window.open` 横取りのブートストラップが要る(Clerk が
  `location.assign` で全画面遷移する場合は横取り不可)。

  **4A-続. JSバンドルの読み込み順序（server.url連動型で @capacitor/browser 等を使う場合の見落としやすい新地雷）**
  server.url でWebをそのまま読む構成では、`@capacitor/core`・`@capacitor/browser`・`@capacitor/app` 等の
  プラグインのJS distをネイティブが自動では注入しない（ネイティブが注入するのは native-bridge のみ）。
  `Capacitor.Plugins.*` を生やす `registerPlugin`(=coreのJS)と各プラグインのJSラッパーは、
  **Web側で明示的に`<script>`読み込みしないと存在しない**。これをやらないと `Capacitor.Plugins.Browser` が
  `undefined` のままになり、Browser.open を呼ぶボタンが**エラーも出さずに無反応**になる。通常のWebブラウザ
  では問題が起きず、Capacitorアプリ内でのみ再現するため気づきにくい。
  - **出典**: resend実戦 2026-07-10・commit `ccf7615`「Googleログインが無反応になる回帰」。
    App Store 1.0.1(38) が Guideline 2.1 で再却下(iPad Air/iPadOS 26.5.2で「Googleログインを押しても
    何も起こらない」)。前回の`@capacitor/browser`導入(4A)自体は正しかったが、JSバンドルを配置・読み込み
    していなかったため、実質的に4Aの対策が無効化されていた。
  - **対処**: `@capacitor/core`・`browser`・`app` の dist を `public/assets/capacitor/` 等に配置し、
    利用側JS(app-oauth.js等)より**前**に`<script>`で読み込む(順序必須)。バンドラーでコード分割する
    場合も、実行時にこの読み込み順が保証されるか確認すること。
  - **横展開**: `@capacitor/browser` に限らず、`@capacitor/app`・`@capacitor/preferences` 等、
    利用側JSから `Capacitor.Plugins.*` を直接参照するプラグイン全般に該当する。
- **4B navigationDelegate(Swift)**: WKWebView の `decidePolicyForNavigationAction` で認可ドメインを
  `SFSafariViewController` に流す。**黒画面6原則の原則1「独自VC/AppDelegate注入しない」と正面衝突**＝
  キットの大原則を破る意思決定が要る(重い)。
- 切り分け: どのボタン(X/Apple)で飛ぶかで原因が違う。**この作業は全部 PC の WF で完結する**ので、まず
  allowNavigation を足して WF で再ビルド→`submit_for_review=true`で審査に出し、**Apple の却下/通過で答え合わせ**
  する(このプロジェクトは実機/TestFlight確認を一度もやっていない＝WFループが実ワークフロー。[[ios-workflow-is-pc-wf-only]])。

### 関連 #2.1 — 審査員がソーシャルログインの仕方が分からず詰まる(同時に来やすい)

X/Apple 専用ログイン(email/PWフォーム無し)のアプリは、審査 Notes に**ログイン手順を明記**しないと
2.1(a) "unable to access" を食らう。kimito の対処(`review-notes/CURRENT-en.txt` を版管理):
- 「① Continue with X を押す ② App Review Information のデモ垢を入力 ③ 2FAは無効」の手順を英語で明記。
- **保険経路**: 「Sign in with Apple でも同等の全機能に到達できる(審査員自身の Apple ID 可)」と書く。
  X 側の bot 検査で詰んでも審査員が必ずログインできる二重化。
- リポ側の組込み: `appstore-submit.mjs` の reviewer notes 解決順を
  env `IOS_REVIEW_NOTES`(全文上書き) → `review-notes/CURRENT-en.txt` → app.config 汎用テンプレ、にする。

---

## §4.3 Spam

> "Don't create multiple Bundle IDs of the same app."

WebView wrapper の "1コードベースで brand-B の URL を指すだけ" が 4.3(a) の標的。Apple は asset hash /
framework signature(`CAPBridgeViewController`)/ Info.plist 形状で同一開発者のアプリを clustering する。
対処: マルチテナント化 / クライアント別開発者アカウント / 機能セットを本当に差別化。

---

## §4.7 Mini Apps / Plug-ins

ビジネスモデルが「他人のHTML5/JSソフトをホスト」する場合のみ該当。2025-11-13 更新で
"may not extend or expose native platform APIs to the software without prior permission" が追加。
remote-loaded の他人JSに Capacitor bridge を晒すと該当。対処: `server.allowNavigation` /
`server.hostname` を自ドメインのみに制限、bridge plugin を whitelist。

---

## §4.8 Login Services / Sign in with Apple

> Verbatim ([Apple §4.8](https://developer.apple.com/app-store/review/guidelines/#login-services)):
> "Apps that use a third-party or social login service (such as Facebook Login, Google Sign-In…)
> to set up or authenticate the user's primary account with the app must also offer as an
> equivalent option another login service…"

### 5つの carve-out(ガイドライン本文に明記)

1. ⭐ **"Your app exclusively uses your company's own account setup and sign-in systems."** —
   最強。email/password を自前スタック(または認証SaaSをIdPとして)で処理するのは "third-party login
   service" ではない。Clerk等のmanaged email/password = first-party。
2. EUのalternative app marketplace。
3. enterprise/education/business で既存org垢が要る。
4. 政府/業界の市民ID(eID)。
5. 特定third-partyサービスのクライアント("I'm a Gmail client" carve-out)。

### 3つの対応戦略

- **A. Sign in with Apple を追加**(王道・長期的に楽。Dev Portal + 認証SaaS Dashboard で20-30分)。
- **B. iOSで全social provider を非表示**(carve-out #1 が成立 → 4.8 のトリガが false に)。
  認証SaaSの hosted UI では CSS注入 + `<style>` raw注入 + `MutationObserver`(非同期描画対策)の3層で隠す。
- **C. carve-out #1 を引用して解釈で反論**(iOSにsocialボタンが1つも見えない時のみ有効)。

### Google OAuth は WKWebView でブロックされる

症状: "Error 403: disallowed_useragent"。原因: Google の OAuth 2.0 for Native Apps が外部ブラウザを
要求し embedded WebView を UA で拒否。対処: iOSで隠す / `@capacitor/browser`(SFSafariViewController) /
`ASWebAuthenticationSession` / ネイティブ Google Sign-In SDK。
**注**: Clerk等の認証SaaSは per-platform の social-provider 設定を持たない場合が多い → UI隠し(B)が現実解。

---

## §5.1 Privacy / アカウント削除

### §5.1.1(v) — アカウント削除 ⭐ iOS 16以降 必須

> "If your app supports account creation, you must also offer account deletion within the app."

無いと**自動却下**。アプリ内削除フロー(または1クリックで起動する deep link)を実装。

### App Privacy フォーム(認証SaaS + ホスティング + DB の典型構成)

| スタック | 収集 | App Privacy 回答 |
|---|---|---|
| 認証SaaS | Email, name, phone, session JWT, IP | Contact Info → Email Address, Identifiers → User ID. Linked, not tracking |
| ホスティング | Request logs(IP, UA), Analytics有効時 | Analyticsなし=server log のみ exempt。あり=Usage Data → Product Interaction |
| DB | INSERT する全列 | persist する列を監査 |

### ATT と WebView cookie

包んだサイトが cross-site/app の analytics cookie(GA, Meta Pixel)を set するなら、その JS が走る前に
**ATTプロンプトを出す**(でないと 5.1.2(i) 却下)。hashed email / IDFV の combo は device fingerprinting として禁止。

### 他社事例: 位置情報共有アプリの開示テンプレ(2026-07-16 調査、通過済みストアページから逆算)

`GPS`(SkyPhone GPS, 開発者 ryo takahashi / 屋号 NOMUDE, iOS+Android両方でストア掲載中・審査通過済み)。
「友達とリアルタイム位置共有」系で、すれちがい通信と同じく**位置情報を継続収集・他ユーザーに共有・永続保存**する設計。
自プロダクト(位置情報を正確に保存し続ける方針)のプライバシー開示の最低ラインとして参照価値あり。

**iOS App Privacy(プライバシー栄養ラベル)の開示内容:**
- 収集データ: 位置情報 / 連絡先情報 / ユーザコンテンツ / ID → いずれも「ユーザの識別情報に関連付けられる」
- 収集のみ(トラッキングなし)扱い: 使用状況データ / 診断
- Info タブに明記: 「このアプリは開いていなくても位置情報を使用する場合があり、バッテリー駆動時間が短くなる可能性がある」
  → バックグラウンド位置取得(`UIBackgroundModes: location` 相当)を使うアプリは、この一文をストア説明文に入れるのが定石

**Google Play データセーフティフォームの開示内容:**
- 「サードパーティとデータ共有」: 位置情報, 個人情報
- 「収集するデータ」: 位置情報, 個人情報
- 定型3点: データは送信中に暗号化 / データ削除をリクエスト可能 / 詳細はデータセーフティページへリンク
- 年齢ゲート: Play側は「12歳以上・保護者の指導を推奨」+ 理由を明記(「ユーザーインタラクション、位置情報の共有」)。
  iOS側は年齢制限 13+。位置情報+ユーザー間交流があるアプリは、iOS 13+ / Play 12+保護者指導 が両ストアの相場。

**適用時の判断ポイント:** これは「通った」の直接証拠(却下→再提出の実例)ではなく、**現在ストアに掲載され続けている**という間接証拠。
KB照合の優先順位は既存の実際の却下/通過ログの方が上。ただし新規カテゴリ(すれちがい通信のような永続位置保存)で
一次情報が薄いときの補助線としては有効。

---

## 実際に通った Resolution Center 返信文

> これらは **実際に Apple へ送って審査を通過/前進させた**返信文(リバースハック partner v1.0.1〜v1.0.5)。
> 将来の却下対応の学習素材として価値が高い。固有名は `<...>` に一般化済み。使うときは:
> - `<APP_NAME>` = identity.displayName / `<COMPANY>` = ownership.organization
> - `<reviewer-email>` `<reviewer-password>` = 実在検証済みのデモ資格
> - 認証基盤名(Clerk)は自分の認証スタック名に置換、または「our own account system」のまま

### A. 短い返信の原則(playbook)

1. **短く**(front-line reviewer は大量に捌く)。
2. **Guideline 番号 + Apple自身の逐語引用で引用**(政策理解を示し、却下しにくくする)。
3. **視覚的争点なら注釈付きスクショを添付**。
4. **テンプレの後でも事実を再陳述**(bot生成 / stale screenshot 相手のことがある)。
5. **政策を論じない**("4.8は不合理")**、事実だけ論じる**("we don't trigger 4.8")。
6. **escalation**: 同テンプレ再来 → 前回返信を日付つきで引用し「該当画面を指摘してください」→
   3振目で **App Review Board appeal**(Contact Us → App Review → Submit an appeal、3-5営業日、別の人間)。

### B. テンプレ返信 — 4.8 / 2.1(a) / 2.1(b) を一度に潰す(v1.0.1 で送り前進した実文)

```
Hello App Review team,

Thank you for the review feedback. We cite Apple's own guidelines verbatim below
to make the alignment explicit.

1) GUIDELINE 2.1(a) — Login access
   When the app launches it goes directly to the sign-in screen — it is the first
   screen. This is a <our own account system>-managed email + password sign-in.
   Demo credentials are provided in App Review Information and below.

2) GUIDELINE 4.8 — Sign in with Apple equivalent
   The applicable carve-out is the FIRST one listed in Guideline 4.8 itself:
   "Your app exclusively uses your company's own account setup and sign-in systems."
   Our app uses <our own account system>-managed email + password authentication as
   our company's own account system (it is our identity-provider infrastructure,
   analogous to AWS Cognito or a self-hosted users table — not a "third-party login
   service" in the sense Guideline 4.8 enumerates). The enumerated third-party
   services in 4.8 are: Facebook Login, Google Sign-In, Sign in with Twitter, Sign
   In with LinkedIn, Login with Amazon, WeChat Login. Our iOS app exposes NONE of
   these — only managed email + password. Per the carve-out, Sign in with Apple is
   not required for this configuration.

3) GUIDELINE 2.1(b) — Business model
   The applicable IAP exemption is Guideline 3.1.3(f), Free Stand-alone Apps:
   "Free apps acting as a stand-alone companion to a paid web based tool (i.e. VoIP,
   Cloud Storage, Email Services, Web Hosting) do not need to use in-app purchase,
   provided there is no purchasing inside the app, or calls to action for purchase
   outside of the app."
   Our app is a free companion to a paid web tool (<COMPANY>'s services, sold
   off-platform via B2B contracts). There are no in-app purchases, subscriptions,
   paywalls, or upgrade prompts inside the app, and no calls to action pointing to
   external purchase pages. Per 3.1.3(f), IAP is not required.

Business model in one sentence: this app is a private B2B operational dashboard.
Money flows OUTSIDE the app, via off-platform B2B contracts and bank transfers.

If a specific screen suggested paid content, please let us know which one and we
will clarify or remove it.

Thank you for the careful review.
```

### C. テンプレ返信 — 2.1(a) "no login page" + 7問ビジネスモデル(v1.0.4→v1.0.5、通った実文)

```
Hello App Review team,

Thank you for the feedback. We have fixed the access issue and answer the
business-model questions directly below. The fix and these answers are included
in the new build, now in your queue.

### 2.1(a) — "we were unable to access the app because there was no login page"

You are right, and thank you for the precise description. The app is a login-gated,
invitation-only B2B partner dashboard. In the prior build the native app opened to
our public information homepage and did not take an unauthenticated user to the
sign-in page. That was our bug.

In the new build, when the app is launched and the user is not signed in, the app
now goes DIRECTLY to the sign-in page. There is nothing to find or tap — the login
form is the first screen. The only screens reachable without logging in are the
sign-in page itself and the legally required pages (Privacy Policy, Terms, Contact,
and Account Deletion request), per App Store requirements. Please use the demo
credentials below to sign in.

### 2.1(b) — Information Needed (business model)

The app has no paid content, no subscriptions, no in-app purchases, and no paywalls.
Direct answers to all seven questions:

1. Who are the users that will use the paid services in the app? — Nobody; the app
   has no paid services. Its users are contracted business-partner representatives
   who view their own referral activity and commission history.
2. Where can users purchase the services that can be accessed in the app? — Nowhere
   in or via the app. The app is informational about client-facing services that our
   partners refer off-platform; those are sold directly between <COMPANY> and
   enterprise clients via B2B contracts negotiated outside Apple's ecosystem.
3. What specific types of previously purchased services can a user access in the
   app? — None. It is a read-only referral-activity dashboard.
4. What paid content, subscriptions, or features are unlocked within the app that do
   not use In-App Purchase? — None. No paywalls, subscriptions, premium tiers, or
   digital content. Every feature is free to every authorized partner.
5. Are the enterprise services sold to single users, consumers, or for family use? —
   Neither. They are sold B2B to enterprise/corporate clients under offline
   contracts. The app's users are business partners, not consumers or families.
6. How do users obtain an account? Do users have to pay a fee to create an account?
   — Accounts are invitation-only, provisioned by our team after an offline B2B
   partnership contract is signed. There is no fee and no self-service sign-up.
7. Do individual customers pay for the content or services? — No. There is nothing
   to pay for inside the app. The underlying services are paid by enterprise clients
   off-platform under B2B contracts; the app itself is a free companion.

Why IAP is not required (Guideline 3.1.3(f) — Free Stand-alone Apps):
"Free apps acting as a stand-alone companion to a paid web based tool … do not need
to use in-app purchase, provided there is no purchasing inside the app, or calls to
action for purchase outside of the app."

Guideline 4.8: the applicable carve-out is the first one listed in 4.8 itself —
"Your app exclusively uses your company's own account setup and sign-in systems."
We use managed email + password as our own account system; the iOS app exposes none
of the enumerated third-party login services. Sign in with Apple is not required.

Demo credentials:
- Email: <reviewer-email>
- Password: <reviewer-password>
(Backend is live. 2FA disabled for this account.)

Thank you again for the review.
```

### D. テンプレ返信 — "provide a method to sign in"(Information Needed hold, v1.0.5、通った実文)

> ⚠️ **送信前**: デモ資格を実在化する。(1) secret に実在 email/password を入れる
> (2) provision workflow を回す(Clerk user 作成/修復 + verify_password 自己検証)
> (3) verify が ✅ になってから、**同じ** email/password でこの返信を送る。
> これは却下でなく **hold** — 動く資格を返信すれば **同じ build のまま**継続審査される(新binary不要)。

```
Hello App Review team,

Thank you — and apologies for the sign-in difficulty. Here is the sign-in method and
working credentials.

How to sign in (no steps to hunt for):
When the app launches it goes directly to the sign-in screen — it is the first
screen. Enter the email and password below and tap the sign-in button. This is a
managed email + password sign-in (our own account system).

Demo credentials (please use exactly):
- Email: <reviewer-email>
- Password: <reviewer-password>

These belong to a partner account we provisioned specifically for App Review. The
app is an invitation-only B2B partner dashboard (no public sign-up by design —
partner accounts are issued after an offline business contract), so this account is
the intended way for the review team to access the full app.

There is no in-app purchase, subscription, or paid content anywhere in the app.

If the credentials do not work for any reason, please reply here and we will respond
immediately.

Thank you for your patience.

— <APP_NAME>
```

### 投稿手順(reviewer がテンプレ却下を使い回したとき)

1. ASC のアプリ → version → **Messages**(左サイドバー)。
2. 開いている thread を見つけて上記返信を貼る。
3. 必要なら日本語版を2通目で貼る(reviewer が日本語担当の場合に親切)。
4. **投稿だけでは再申請されない**。binary は workflow の push が別途処理する。投稿は
   「reviewer notes が読まれない可能性に対し、レビュー記録に答えを残す」ための保険。

---

## 審査前チェックリスト

`templates/scripts/lint-pre-submission.mjs` がこの多くを CI で自動検査する。手動確認用:

### コード

- [ ] version bump 済み(manifest / package / capacitor.config の整合)
- [ ] `UIWebView` 参照なし(`nm app.app | grep UIWebView`)
- [ ] iOS で third-party social ログインボタンが全て隠れている(3層 hide)
- [ ] `target="_blank"` は SFSafariViewController で開く(WebView内でない)
- [ ] アカウント削除フローがアプリ内から到達可能
- [ ] WebView 読込エラーをネイティブ再試行画面で処理
- [ ] NativeAuthGate: ネイティブ未認証は /sign-in へ(法務/削除は allowlist)
- [ ] cross-site tracking cookie があるなら ATT プロンプトを先に

### メタデータ

- [ ] アプリ名 ≤30字、商標詰め込みなし
- [ ] description にネイティブ専用機能 ≥2 を記載
- [ ] **スクショはログイン後ダッシュボード**(ログイン/スプラッシュ画面でない)
- [ ] **スクショ slot1(最左)が最強の in-use 画面**(reviewer は最左を最初に見る)
- [ ] "Android" / "Google Play" / "Play Store" / "Galaxy" / "Pixel" / "Material Design" なし
- [ ] スクショに URLバー等のブラウザ chrome が見えない
- [ ] 全表示素材が 4+ 準拠

### reviewer アクセス

- [ ] デモ資格を ASC → App Information → Sign-In Info に
- [ ] デモ資格を notes にも(email は完全形 — `user@domain` の domain 欠落に注意 = v1.0.6)
- [ ] デモ垢の 2FA 無効
- [ ] **submit 24h以内にデモ垢を verify_password で再検証**(stale 資格が最多の却下原因)
- [ ] デモ垢にサンプルデータを事前投入(post-login が空でなくダッシュボードに着地)

### reviewer notes

- [ ] notes は **現在の build を反映**(前版の持ち越しでない = v1.0.4/v1.0.6)
- [ ] 3.1.3(f) 逐語引用(無料B2Bコンパニオンなら)
- [ ] 4.8 carve-out #1 逐語引用(自前 email/password のみなら)
- [ ] 5.1.1(v) アカウント削除を画面位置つきで言及
- [ ] ビジネスモデル質問(5〜7問)を全て先回り回答

### App Privacy フォーム

- [ ] Contact Info → Email Address 申告
- [ ] Identifiers → User ID 申告
- [ ] Usage Data → Product Interaction 申告(analytics があれば)
- [ ] Linked to You / Not used for Tracking
- [ ] privacy URL / support URL が 200 を返す

---

## 提出時の「必須項目」連鎖 — `reviewSubmissionItems` の 409 を1つずつ潰す

これは**却下ではなく submit 段階のブロッカー**。`appstore-submit.mjs` が
`POST /v1/reviewSubmissionItems` で `409 STATE_ERROR.ENTITY_STATE_INVALID` を返すとき、
`meta.associatedErrors` に「**次に足りない1項目だけ**」が出る。一括では出ないので
**1項目直す → WF 再実行 → 次の1項目** を繰り返すしかない。kimito.link の初回提出で
実際に出た順と、`scripts/appstore-submit.mjs` に入れた冪等な自動化（`[7c]`〜`[7f]`）:

| 出る順 | エラー | 対象 | 種別 | 入れた値 / 対処 |
|---|---|---|---|---|
| `[7c]` | `'sexualContentGraphicAndNudity'` 等が未回答 | ageRatingDeclaration | attribute | 全項目 enum→`NONE` / boolean→`false`。型は**属性名**で判定（現在値 null から推測しない）。Apple の TYPE エラーから自動修正。`ageAssurance` は `NONE` で送る（REQUIRED） |
| `[7d]` | `APP_DATA_USAGES_REQUIRED` | App Privacy（dataUsages） | — | **下記の重大注意。JWT API では不可＝ASC Web UI で手動公開**。スクリプトは GET 失敗時 fail-soft で submit に進む |
| `[7e]` | `'contentRightsDeclaration'` 未設定 | `/v1/apps/{id}` | **attribute** | リンクまとめ等は `DOES_NOT_USE_THIRD_PARTY_CONTENT` |
| `[7f]` | `'primaryCategory'` 未設定 | `/v1/appInfos/{id}` | **relationship**（appCategories への参照・id は `SOCIAL_NETWORKING` 等の文字列 enum） | SNS 性が中核なら `SOCIAL_NETWORKING` |

`contentRightsDeclaration`(attribute) と `primaryCategory`(relationship) は**型が違う**点に注意
（PATCH の body 構造が `attributes` か `relationships` かで変わる）。いずれも **app/appInfo に
一度設定すれば永続**＝2回目以降の提出は「既に設定済み（変更なし）」で素通りする。

### 🔴 最重要: App Privacy（プライバシー栄養ラベル）は JWT API では公開できない

`dataUsages` / `dataUsagePublishState`（プライバシー栄養ラベル）は **App Store Connect API
（ES256 JWT のキー）では操作できない**。実測で確定:

- `https://api.appstoreconnect.apple.com/v1/apps/{id}/dataUsages` → **404 PATH_ERROR**
- `https://appstoreconnect.apple.com/iris/v1/.../dataUsages` → **401**（iris は ASC の **web session cookie 専用**）
- `https://api.appstoreconnect.apple.com/iris/v1/...` → **404**

fastlane が App Privacy を扱えるのは Apple ID ログイン（web セッション）を使うから。
**API キーだけの CI からは原理的に公開できない。**

→ **対処は ASC Web UI で「アプリのプライバシー」を一度手動公開するだけ**（永続する）。
`appstore-submit.mjs` の `ensurePrivacy()` は、dataUsages GET が全ベースで失敗しても
**throw せず WARN を出して submit に進む（fail-soft）**設計にしてある。「API で確認できない＝
未公開」ではないため。本当に未公開なら submit が `APP_DATA_USAGES_REQUIRED` で弾くので安全。

**次のアプリでやること**: 提出前に ASC で App Privacy を手動公開しておく。これを知らないと
「API で公開しようとして 10 回ハマる」。CI 側は何もしなくてよい（fail-soft で素通りする）。

### 署名証明書の MAC 検証フレーク（一過性）

`Install signing certificate` で `security: SecKeychainItemImport: MAC verification failed
during PKCS12 import (wrong password?)` が **~4回に1回** 出ることがある。原因は
OpenSSL 3.x が `pkcs12 -export` で作る .p12 の SHA-256 MAC を macOS の `security import` が
時々検証できない相性問題（**証明書/パスワードは正しい**）。`ios-appstore-release.yml` では
`openssl pkcs12 -export` に **`-macalg sha1 -legacy`** を付けて根治し、念のため import を
**最大3回リトライ**している。それでも稀に出たら **WF を再実行すれば越える**。

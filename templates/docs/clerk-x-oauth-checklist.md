# Clerk + X(Twitter) OAuth セットアップ チェックリスト

> **実体験ベース**（kimito.link の X ログイン不具合対応で判明した落とし穴を集約）  
> 新しいアプリで X ログインを追加するたびにこれを使う。

---

## まず方式を選ぶ：A（既定・推奨） か B か

ブランド（例: Kimito-Link）の全アプリで X ログインを使い回す方法は2つ。
プリセット `templates/auth/brands/<brand>.json` の `shareInstanceAcrossApps` で切り替える。

### 方式A：Clerk インスタンス共有（既定 / `shareInstanceAcrossApps: true`）

```
1つの Clerk インスタンス（clerk.kimito.link）＋ 1つのユーザーDB
  ├─ kimito アプリ      ┐
  ├─ surechigai アプリ  ├─ 全部が同じ Clerk・同じ pk_live を使う
  └─ 次のアプリ         ┘
X Developer: Callback は https://clerk.kimito.link/v1/oauth_callback の1個だけ
```

- ◎ ファンが**1アカウントで全アプリ**を使える（kimitoでログイン→他アプリもログイン済み）
- ◎ 2個目以降のアプリは X 側・Clerk 側の設定作業ゼロ。**鍵を入れるだけ**
- △ ユーザー・MAU課金が全アプリ合算 / 設定変更は全アプリ波及 / 後でDB分離は大変
- 各アプリの env には kimito の本番鍵を入れる（`KIMITO_CLERK_PUBLISHABLE_KEY` / `KIMITO_CLERK_SECRET_KEY` 経由で配布）

### 方式B：各アプリ独立（`shareInstanceAcrossApps: false`）

```
X Developer Portal（1つのアプリで全サービス共有）
  └─ Callback URLs（複数登録可）:
       https://clerk.kimito.link/v1/oauth_callback        ← kimito.link
       https://clerk.surechigai-romi.link/v1/oauth_callback ← すれちがいロミ
       https://clerk.（次のアプリ）.link/v1/oauth_callback    ← 今後追加

各アプリが別々の Clerk インスタンス（ユーザーDBはアプリ別）
  └─ X SSO connection に同じ Client ID / Secret を登録
```

- ◎ ユーザー・課金がアプリごとに独立 / 事故が1アプリに閉じる
- △ ログインは別物（kimitoでログイン済みでも他アプリは再ログイン必要）
- X アプリは1個共有。新アプリ追加のたびに Callback URL を1行追加する

> **迷ったら**: ファン体験を最優先なら A。安全・独立を優先なら B。
> B で始めて後から A に寄せることも可能（逆=A→Bは大変）。
> `setup-clerk-x-oauth.mjs` がどちらの方式かを自動判定して手順を出し分ける。

---

## ステップ0: スクリプトを使う（推奨）

```bash
# プロジェクトルートで実行
node templates/scripts/setup-clerk-x-oauth.mjs

# .env.local にひな形を追記
node templates/scripts/setup-clerk-x-oauth.mjs --write-env
```

スクリプトが app.config.json を読んでチェックリストを出力します。

---

## ステップ1: app.config.json に auth ブロックを追加

### 方式A（推奨）: ブランドプリセットを使う

`templates/auth/brands/<brand>.json` にブランドの認証設定（Clerk ドメイン・X OAuth・scope）を
集約しておき、app.config.json では **ブランド名を1行書くだけ**にする。
kimito ブランドの全アプリで同じ X アプリ・同じ設定を使い回せる（クリエイター応援の核）。

```jsonc
"auth": {
  "provider": "clerk",
  "brandPreset": "kimito-link",          // ← これ1行でプリセットを継承
  "thirdPartyProvidersOnWeb": ["twitter"],
  "thirdPartyProvidersOnIos": ["twitter"],
  "thirdPartyProvidersOnAndroid": ["twitter"],
  "clerkCustomDomain": "clerk.YOUR-DOMAIN.link"  // アプリ固有のドメインだけ上書き
}
```

`setup-clerk-x-oauth.mjs` が `brandPreset` を読み、`templates/auth/brands/kimito-link.json`
から scope・Callback テンプレ・X アプリ共有方針・env 名を自動解決する。

**新しいブランドを作る人**は `templates/auth/brands/_TEMPLATE.json` をコピーして
`<your-brand>.json` を作り、`<...>` を埋める（手本: `kimito-link.json`）。
秘密（Client Secret）はファイルに書かず env 名だけ書く。

### 方式B: プリセットを使わず全部 app.config.json に書く

```jsonc
"auth": {
  "provider": "clerk",
  "thirdPartyProvidersOnWeb": ["twitter"],
  "thirdPartyProvidersOnIos": ["twitter"],
  "thirdPartyProvidersOnAndroid": ["twitter"],
  "siwaEnabled": false,
  "clerkCustomDomain": "clerk.YOUR-DOMAIN.link",
  "xOAuthSharedApp": true,
  "xCallbackUrl": "https://clerk.YOUR-DOMAIN.link/v1/oauth_callback",
  "requiredXScopes": ["users.read", "tweet.read", "offline.access"]
}
```

---

## ステップ2: X Developer Portal

URL: https://developer.twitter.com/en/portal/dashboard

- [ ] 共有アプリを選択（新規作成は不要——既存の kimito-link アプリを使い回す）
- [ ] Settings → User authentication settings
- [ ] **App permissions: Read のみ**（`tweet.write` は絶対つけない ← 最大の罠）
- [ ] Type of App: **Web App, Automated App or Bot**
- [ ] Callback URI / Redirect URL に **新アプリの URL を1行追加**:
  ```
  https://clerk.YOUR-DOMAIN.link/v1/oauth_callback
  ```
  ※ 半角スペース・末尾スラッシュの有無に注意。1文字でもズレると authorize ループ。
- [ ] Website URL / Terms / Privacy を入力して Save
- [ ] Client ID と Client Secret をメモ（次のステップで使う）

---

## ステップ3: Clerk Dashboard — カスタムドメイン設定

URL: https://dashboard.clerk.com → 新アプリのインスタンス

- [ ] **Domains → Add domain**: `clerk.YOUR-DOMAIN.link`
- [ ] Clerk が表示する CNAME レコードを DNS（Vercel/Cloudflare 等）に登録
- [ ] DNS 反映を確認（最大 48h かかる。焦らない）

> **なぜ必要?**  
> カスタムドメイン未設定だと Callback URL が `<開発インスタンス>.clerk.accounts.dev` になる。  
> 本番でこの開発ドメインを使い続けるのは不適切なので、本番では必ずカスタムドメインを設定する。

---

## ステップ4: Clerk Dashboard — X SSO connection 設定

- [ ] Configure → SSO connections → X(Twitter) → Enable
- [ ] **Use custom credentials: ON**
- [ ] Client ID: （ステップ2でメモした値）
- [ ] Client Secret: （ステップ2でメモした値）
- [ ] **Scopes: `users.read` `tweet.read` `offline.access` のみ**
  - `tweet.write` は絶対に追加しない
  - これを入れると X が拒否してログイン画面でループする（kimito.link で実証）
- [ ] Save

---

## ステップ5: 環境変数を設定

### .env.local（開発用）

```env
# Expo Router の場合
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Next.js の場合
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in/
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up/
NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL=/dashboard/
NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL=/dashboard/
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard/
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard/
```

### Vercel（本番用）— ここで必ず本番鍵を使う

> ⚠️ **`pk_test_` / `sk_test_` を本番 Vercel に入れると authorize がループして戻らない**  
> 本番は必ず `pk_live_` / `sk_live_` を使う（kimito.link で実証済み）

```bash
vercel env add EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY production
# → pk_live_... を貼り付け

vercel env add CLERK_SECRET_KEY production
# → sk_live_... を貼り付け
```

---

## ステップ6: 動作確認

1. `vercel --prod` でデプロイ
2. 本番 URL でログインボタンをタップ
3. X の認証画面 → ログイン → アプリに戻ること

---

## トラブルシューティング

### ❌ X の認証画面で「問題が発生しました / アプリにアクセスを許可できません」が出る

**最頻出。今回 surechigai-romi で実際に詰まったパターン。**

**原因** ローカル開発（`pk_test_`）でログインすると、Clerk は X に
`redirect_uri=https://<開発インスタンス>.clerk.accounts.dev/v1/oauth_callback` を渡す。
この開発ドメインの Callback が X Developer Portal に**登録されていない**と、X が
「アクセスを許可できません」で弾く（本番ドメインだけ登録していても開発では弾かれる）。

**確認方法** ブラウザのアドレスバーの authorize URL をコピーし、`redirect_uri=` をデコードして
登録済み Callback と突き合わせる。

**対処** X Developer Portal の Callback URI に開発用も追加する:
```
https://<開発インスタンス>.clerk.accounts.dev/v1/oauth_callback
```
開発インスタンス名は `pk_test_` をデコードすると分かる（`setup-clerk-x-oauth.mjs` が
自動デコードして【3】に表示する）。本番だけ動けばよいなら開発用 Callback は不要。

---

### ❌ X の認証画面でループする / 「Xにログインしてください」が繰り返される

**原因①** Clerk の Scopes に `tweet.write` が入っている
- 対処: Clerk Dashboard → SSO connections → X → Scopes から `tweet.write` を削除

**原因②** X Developer Portal の Callback URL が一致していない
- 対処: X Portal で Callback URL を確認。スペース・スラッシュ・`https` を一字一句確認

**原因③** 本番 Vercel に `pk_test_` 鍵が入っている
- 対処: Vercel の Environment Variables を `pk_live_` / `sk_live_` に差し替えて再デプロイ

**原因④** Clerk カスタムドメインの DNS が未反映
- 対処: DNS 設定後 24〜48h 待つ。`dig clerk.YOUR-DOMAIN.link CNAME` で確認

### ❌ ログイン後にアプリに戻らない（Next.js）

**原因** `NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL` が未設定
- 対処: FALLBACK だけでは middleware の `redirect_url` に負けて無視される。**FORCE 系も必須**

### ❌ authorize URL に `tweet.write` が含まれている

```
scope=users.read+tweet.read+offline.access+tweet.write  ← これがある場合
```
- 対処: Clerk Dashboard で Scopes を確認・修正。コードの `grep tweet.write` で混入がないか確認

---

## まとめ：新アプリ追加の作業リスト（次回から）

```
1. app.config.json に auth ブロックを追加
2. X Developer Portal → Callback URL を1行追加（既存アプリ・新規作成不要）
3. Clerk Dashboard → カスタムドメイン設定 → DNS 登録
4. Clerk Dashboard → X SSO → 同じ Client ID/Secret を登録 → Scopes 確認
5. .env.local に pk_test_ / sk_test_ を設定（開発用）
6. Vercel に pk_live_ / sk_live_ を設定（本番用）
7. デプロイ → 動作確認
```

合計所要時間の目安: **DNS 反映待ち（最大 48h）を除けば 30 分以内**

---

*作成日: 2026-06 — kimito.link の X ログイン不具合対応（HANDOFF_LOGIN.md）から知見を集約*

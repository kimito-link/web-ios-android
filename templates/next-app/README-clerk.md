# Clerk 認証を使う場合の前提と手順（next-app）

`app.config.json` の `auth.provider` を `"clerk"` にしたときに読む。使わないなら
`layout.tsx`（素の版）のまま・middleware 不要・この手順は無視してよい。

Clerk 設定情報の正典はキットの `templates/auth/`（ブランドプリセット）と
`templates/scripts/setup-clerk-x-oauth.mjs`、罠集は `templates/docs/clerk-x-oauth-checklist.md`。
ここは **Next.js アプリ側に何を置くか** をまとめる。

## 1. 依存を入れる

```bash
pnpm add @clerk/nextjs @clerk/localizations
```

`@clerk/localizations` は日本語 UI（`jaJP`）用。

## 2. テンプレを配置（.template を外す）

- `app/layout-with-clerk.tsx.template` → `app/layout.tsx`（素の layout を置き換え）
- `middleware.ts.template` → `middleware.ts`
- `.env.example` → `.env.local`（値を実物に。**`.env.local` は必ず gitignore**）

`setup-new-app.mjs` に任せる場合は `{{productionDomain}}` などのプレースホルダが
app.config.json の値で置換される。

## 3. 必須の環境変数（これが無いと起動時に落ちる）

| 変数 | 用途 |
| --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | フロント公開キー（pk_test_/pk_live_） |
| `CLERK_SECRET_KEY` | サーバ秘密キー（sk_test_/sk_live_）。**絶対に公開しない** |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `..._SIGN_UP_URL` | サインイン/アップのパス |
| `..._FORCE_REDIRECT_URL` / `..._FALLBACK_REDIRECT_URL` | 認証後の着地先 |

Vercel には `setup-clerk-x-oauth.mjs` で一括登録できる。

## 4. middleware の勘所（ストア審査の落とし穴）

`middleware.ts` の `isPublicRoute` に**未ログインで見せるページ**を列挙する。ここに無い
パスは自動的に認証必須になる。

⚠️ **スクショ自動撮影は未ログインで走る**。`capture-appstore-screenshots.mjs` /
`capture-play-screenshots.mjs` は認証なしでページを開いて撮るので、撮影対象
（トップ `/` やストア用の `/store-preview`）を public に入れ忘れると、真っ白 or
サインインへリダイレクトされて**撮影が失敗し、iOS/Play の初回提出で詰まる**。

## 5. X(Twitter) / Google / Apple SSO

- Clerk ダッシュボードで各 SSO プロバイダを有効化。
- X は `templates/docs/clerk-x-oauth-checklist.md` の罠に注意（**tweet.write を要求すると
  認可ループになる**。必要スコープは `users.read` / `tweet.read` / `offline.access` まで）。
- コールバック URL は Clerk のカスタムドメイン（例 `https://clerk.<domain>/v1/oauth_callback`）。
  ブランド共有（方式A）なら 1 個で全アプリ共通。

## 6. モバイル（Capacitor）で Clerk を使うときの注意

- Capacitor アプリは `server.url` でリモート Web を読む金型なので、**認証は Web と同じ
  Clerk セッションに乗る**（アプリ内 WebView が本番ドメインを開く）。ネイティブ SDK は不要。
- リダイレクト系: `ClerkProvider` の `allowedRedirectOrigins` に、アプリが開くオリジン
  （本番ドメイン）が入っていること。カスタムスキーム（`capacitor://`）で戻す構成にする
  場合は Clerk の allowed origins にも登録する。
- 「アプリ内ブラウザで X ログインが開けない/戻れない」ときは、外部ブラウザで開く設定
  （`@capacitor/browser`）に切り替えると通ることが多い。

## 7. 方式A（複数アプリで Clerk を共有）

`auth.shareInstanceAcrossApps === true` のとき、姉妹アプリが同じ Clerk ユーザー DB・
同じ X アプリを共有する（1 アカウントで全アプリ利用可）。`layout.tsx` の
`allowedRedirectOrigins` に姉妹アプリのオリジンを列挙する（テンプレのコメント参照）。
ブランド定義は `templates/auth/brands/<slug>.json`。

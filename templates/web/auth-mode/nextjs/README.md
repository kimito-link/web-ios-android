# Next.js + Clerk 認証金型（Xワンタップ／共通アカウント）

> **今の到達点: 金型として配置済み・輸入実績はまだ 0 件。**
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
| 輸入実績 | ★**まだ無い**（この金型経由で導入したプロジェクトは 0 件） |

★`surechigai-romi.link` にも同等実装があるが、あちらは `react-native` / `Platform` /
`isNativeAppShell` に依存する **Expo 専用**で、Next.js には輸入できない。
Expo で使うならそちらを見ること（`components/auth/auto-advance-to-x.tsx`）。

## ファイル一覧

| ファイル | 役割 | 丸写し可否 |
|---|---|---|
| `auth-brand.config.ts.example` | ★**ここだけ書き換える**。色・画像・パス・許可オリジン | 書き換える |
| `AutoAdvanceToX.tsx.example` | X ワンタップの本体（待機画面つき） | ほぼそのまま |
| `auth-layout.tsx.example` | `ClerkProvider` 設定（共通アカウントの心臓部） | ほぼそのまま |
| `auth-routes.ts.example` | 認証 URL を 1 か所に集約 | ほぼそのまま |
| `auth-page-shell.tsx.example` | 画面の**骨組みだけ**。カードは差し込み口 | ★骨組みのみ |
| `sign-in-page.tsx.example` | サインインページ | ほぼそのまま |

## 使うとき

```
1. auth-brand.config.ts.example → lib/auth-brand.config.ts にコピーして**値を書き換える**
2. 残りを対応する場所へコピー（.example を外す）
     AutoAdvanceToX.tsx    → components/
     auth-routes.ts        → lib/
     auth-page-shell.tsx   → components/AuthPageShell.tsx
     auth-layout.tsx       → app/(auth)/layout.tsx
     sign-in-page.tsx      → app/(auth)/sign-in/[[...sign-in]]/page.tsx
3. LP の CTA を SIGN_IN_AUTO_X_HREF に差し替える（これで X ワンタップが発火する）
```

★`sign-up` も作るなら、`sign-in-page` をコピーして `<SignUp />`・`variant="sign-up"` にする。

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

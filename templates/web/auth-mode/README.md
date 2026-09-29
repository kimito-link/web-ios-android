# kimito.link 共通アカウント: ペイント前・同期の認証モード金型

> 状態: 実装済み・実証済み（exosome MVP確定 2026-09-29・cookie解析バグ修正 2026-09-29）。
> 設計書（読む順の1番目）: `../../../_docs/DESIGN-kimito-family-prepaint-auth-mode-2026-09-29.md`
> 実装ハンドオフ: `../../../_docs/IMPLEMENTATION-HANDOFF-kimito-family-prepaint-auth-mode-2026-09-29.md`

## これは何か

kimito.link 共通アカウント（Clerk、`.kimito.link` 親ドメインで `__client_uat` cookie を共有）を
使うサービスで、「未ログインなら強制送還する」実装が引き起こす**ちらつき**（一瞬本来の画面が
見える→隠される→別画面へ飛ぶ、という非同期判定の待ち時間）を構造的に消すための金型。

判定は各ページ `<head>` 先頭のインラインスクリプトがペイント前・同期的に行い、
`<html data-auth="member|guest">` を確定させる。表示の出し分けは CSS に任せ、
JS（`auth-mode.js` 等）は「後から裏取りする係」に徹する。`location.replace` は使わない。

## 実証元・適用状況

| プロジェクト | 適用状況 |
|---|---|
| `yukkuri-exosome.link` | MVP実装済み（全21ページ）。2026-09-29に複数cookie併置バグ修正 |
| `surechigai-romi.link` | 独自のゲストWebシェル判定に `__client_uat` を統合済み（`lib/clerk-public-routes.ts`）。2026-09-29に同じバグを修正 |
| `kimito-Link-Voice` | 未適用（設計書B-3で横展開予定と記載されているが未着手） |

## ファイル一覧

- `head-snippet.html.example`: 各ページ `<head>` 最初の子としてインラインで埋め込むスクリプト
- `auth-mode.css.example`: `.member-only` / `.guest-only` の表示切替CSS契約
- `auth-mode-cookie-parsing.test.mjs.example`: cookie解析ロジックの契約テスト（実損再現ケース含む）

## 使うとき

1. `head-snippet.html.example` の中身を対象プロジェクトの全ページ `<head>` 最初の子に埋め込む
   （外部ファイル化しない。ダウンロード待ちでペイント前に間に合わない可能性があるため）
2. `auth-mode.css.example` の内容を共通CSSに追加する
3. `auth-mode-cookie-parsing.test.mjs.example` をコピーし、対象プロジェクトのテストランナー
   （`node:test` / vitest / jest）に合わせて配置する
4. 全ページにスニペットが正しく入っているかのドリフト検知テストを追加する
   （実装例: `yukkuri-exosome.link/test/auth-mode-source-drift.test.mjs`）

## 地雷

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

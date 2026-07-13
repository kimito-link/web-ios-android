# 実装ハンドオフ: LP先行アプローチ＋独自ドメイン接続機能（MVP）

> この1枚だけで着手できる。設計の背景・裏取り根拠は
> [`DESIGN-lp-first-domain-connect-2026-07-13.md`](./DESIGN-lp-first-domain-connect-2026-07-13.md) 参照。
> 実装は**まだ行っていない**。次チャット/別モデルでここから着手する。
>
> **改訂**: Cloudflare認証はAPIトークン手動貼り付けではなく`wrangler login`のブラウザOAuthに
> 変更済み（ローカル初回セットアップ用）。CI再デプロイのみ`CLOUDFLARE_API_TOKEN`を維持。
> 以下の手順は改訂後の内容。

## 読む順

1. このファイル（着手手順）
2. `DESIGN-lp-first-domain-connect-2026-07-13.md`（設計の全体像・捨てた案の理由）
3. 必要なら `_docs/KIT-COMPLETION-PLAN.md`（既存キットの取り込み方式の前例）

## スコープ（MVPのみ。これ以外はやらない）

「独自ドメインでWeb公開」の1コマンド化。ストア提出系のclaims整理・LP全面改修は**やらない**。

## 着手手順

1. ブランチ作成: `feat/web-domain-connect`
2. `app.config.schema.json` に `web.deploy` セクションを追加（**最初にこれをやらないと後続がスキーマ違反で落ちる**）:
   ```json
   "web": {
     "type": "object",
     "properties": {
       "deploy": {
         "type": "object",
         "properties": {
           "provider": { "type": "string", "enum": ["cloudflare-pages"] },
           "projectName": { "type": "string" },
           "customDomain": { "type": "string" }
         }
       }
     }
   }
   ```
3. `app.config.json` のサンプル/プレースホルダにも同セクションを追加
4. `templates/scripts/cloudflare-auth.mjs` を新規作成（TDD推奨）
   - `wrangler whoami` を先に実行し、既にログイン済みなら即成功で終了（冪等）
   - 未ログインなら `child_process.spawn('npx', ['wrangler', 'login'])` を起動し、ブラウザでの
     OAuth許可完了を待つ（`close`イベントでexit code 0を確認）
   - CI環境（`process.env.CI === 'true'`等で判定）では`wrangler login`を呼ばず、
     `CLOUDFLARE_API_TOKEN`環境変数の存在確認のみ行う（ローカル/CIの分岐）
5. `templates/scripts/deploy-cloudflare-pages.mjs` を新規作成
   - `npx wrangler pages deploy` をラップ。認証は4で確立済みのセッション（ローカル）または
     `CLOUDFLARE_API_TOKEN`（CI）に委ねる
6. `templates/scripts/connect-domain.mjs` を新規作成
   - Cloudflare REST API: `POST /pages/projects/:name/domains`
   - CI実行時のみ、実行冒頭で `GET /user/tokens/verify` によりトークンの有効性を確認、無効なら即失敗
   - DNS反映・SSL発行待ちはポーリング（タイムアウトしても再実行可能な冪等設計にする）
7. `templates/scripts/bootstrap-secrets.mjs` に `CLOUDFLARE_API_TOKEN` の登録項目を1行追加
   （**CI用のみ**。ローカル初回セットアップではこの手順は不要になった点に注意）
8. `templates/scripts/setup-new-app.mjs` に質問を1つ追加（独自ドメイン使用有無／ドメイン名のみ。
   トークン貼り付けの質問は不要になった＝`cloudflare-auth.mjs`が`wrangler login`を裏で呼ぶため）
9. `templates/workflows/deploy-web.yml` を新規作成（push時 or `workflow_dispatch`。既存7本と同じ
   プレースホルダ流儀を踏襲。CIでは`CLOUDFLARE_API_TOKEN`をSecretsから注入）
10. `site/claims.json` を新規作成。最低限、今回実装した機能を `level: "auto"` で1件登録
11. `scripts/verify-claims-coverage.mjs` を新規作成。既存 `scripts/verify-doc-impl-coverage.mjs`
    （ドリフト検証の設計思想）を参考にするが**コードの流用元ではない**（別物として書く）。
    `level:"auto"` のclaimに対応するスクリプトが実在し `--dry-run` が緑であることをCIで強制する
12. `site/index.html` に「できること表」セクションを新設（claims.jsonから生成 or 手動同期→11で強制）
13. `templates/scripts/verify-manual-setup-done.mjs` に、ドメイン接続が必要な場合のチェック項目を追加

## 機械的な完了判定

- `node scripts/verify-claims-coverage.mjs` が exit 0
- `node templates/scripts/cloudflare-auth.mjs --dry-run` が exit 0（CI/ローカル両方の分岐を確認）
- `node templates/scripts/deploy-cloudflare-pages.mjs --dry-run` が exit 0
- `node templates/scripts/connect-domain.mjs --dry-run` が exit 0
- `app.config.schema.json` に対して既存サンプル `app.config.json` がバリデーション成功
- `templates/workflows/deploy-web.yml` が既存の `actionlint` 相当のlintを通過

## 地雷（実装時に踏むと事故る）

- **`capacitor.config`には一切触れないこと。** 自動生成・独自VC/AppDelegate注入は禁則
  （富士山コンパスで黒画面事故を10回以上経験した教訓。[`CAPACITOR-GOLDEN-RULES.md`](./CAPACITOR-GOLDEN-RULES.md)参照）。
- `app.config.schema.json` は最上位で `additionalProperties: false`。`web`セクションを
  スキーマに定義せずに`app.config.json`側だけ書くとバリデーションで即座に弾かれる。
- Cloudflare連携の流用元は存在しない（`kimitolink-linktree`を含め裏取り済み・実在しないと確認済み）。
  ゼロから書く前提でスコープ・見積もりを立てること。
- CI用Secrets登録は**平文保存しない・スコープ最小**（`APPLE_TEAM_ID`をmacOS専用コマンドで取得し
  Windowsで空値のまま登録した過去事故と同型のミスを避ける。トークン検証を先頭で必ず行う）。
- PowerShellに日本語を直接渡さない・パスは引用符（プロジェクト共通規約）。
- **`wrangler login`はコンテナ/リモート開発環境（Codespaces, devcontainer等）でlocalhostコールバックが
  ホストブラウザから到達不能になり失敗する既知の問題がある**（Web調査で確認・GitHub issue多数）。
  通常のユーザーPCでのローカル実行では問題ないが、`cloudflare-auth.mjs`はタイムアウト時に
  「コンテナ環境の場合はCLOUDFLARE_API_TOKENを環境変数に設定して再実行してください」という
  案内メッセージを出すこと（fail-closedかつ次の一手を示す）。
- Cloudflareの認証トークンは既定で`~/.config/.wrangler/config/default.toml`に平文保存される
  （`--use-keyring`でOS資格情報ストア暗号化も選択可）。このファイルパスをログや出力に含めない。

## 転記元の実在パス一覧（裏取り済み）

- `web-ios-android/scripts/verify-doc-impl-coverage.mjs`（実在・設計思想の参考元）
- `web-ios-android/templates/scripts/setup-new-app.mjs`（実在・拡張対象）
- `web-ios-android/templates/scripts/bootstrap-secrets.mjs`（実在・拡張対象）
- `web-ios-android/templates/scripts/verify-manual-setup-done.mjs`（実在・拡張対象）
- `web-ios-android/templates/workflows/`（実在7本: `android-play-release.yml`, `apple-cert-expiry.yml`,
  `asc-review-poll.yml`, `ios-appstore-release.yml`, `ios-pre-submission-lint.yml`,
  `ios-shell-guardrail.yml`, `play-review-poll.yml`）
- `web-ios-android/site/download/web-ios-android-template.zip`（実在）
- ~~`kimitolink-line/`のCloudflareスクリプト~~ → **裏取りの結果、実在しない**
  （正しいリポジトリ名は`kimitolink-linktree`。Cloudflare操作の独自コードは見当たらず、流用不可）

## 次のアクション

**実装はここでは行わない。** 次チャット、または実装担当の別モデルに、このファイルのフルパスを渡して
「これを読んで、ブランチを切ってTDDでMVPを実装して」と依頼する。

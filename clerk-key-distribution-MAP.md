# Wayfinder: Clerk共通鍵の複数サービス配布（司令塔が実コードを読んで作成）

## お題
kimito.link共通アカウント（Clerk方式A・インスタンス共有）の鍵を、姉妹サービス
（Vercel×2・静的1・Render1=Voice）へ配るたびに人間が手作業でコピペしている。
「1コマンドで全サービスに配る」仕組みを作りたい（wayfinder-to-spec手順1: 地図作成）。

## 実在確認済みの既存資産（すべてReadで実読了）

### 1. `templates/scripts/bootstrap-secrets.mjs`
- **スコープ**: ストア申請用GitHub Secrets 12種（ASC・Play・Android keystore等）専用
- **Clerk鍵は`buildSpecs()`に一切登場しない**（grep 0件、実読了で確認）
- 良い設計として再利用できる部分:
  - 鍵ディレクトリ運用（`.secrets-local/`、`.gitignore`前提）
  - 既定ドライラン・`--apply`明示で実登録
  - 鍵の値を標準出力に出さない（`set?`/`OK`/`FAIL`のラベルのみ）
  - `gh secret set NAME --repo`は値を**標準入力**で渡す（コマンドライン引数に乗せない。
    理由: 失敗時のエラーメッセージにコマンド全体が載って秘密が露出する実損があった、
    と198-201行目コメントに明記）
- **配布先はGitHub Secretsのみ**。Vercel/Renderへの言及ゼロ

### 2. `templates/scripts/setup-clerk-x-oauth.mjs`
- **スコープ**: Clerk+X OAuthの「設定チェックリスト表示」＋`.env.local`ひな形追記＋
  **Vercel CLIでの`vercel env add`一括登録**（`--write-vercel`）
- ブランドプリセット解決ロジック（`presetName`→`templates/auth/brands/<name>.json`探索、
  3候補パス）は**再利用すべき既存ロジック**（二重実装しない、が依頼の制約）
- 方式A判定（`shareInstanceAcrossApps`）・共有鍵env名解決（`sharedPubKeyEnv`/
  `sharedSecretKeyEnv`）も同様に再利用対象
- **Renderへの配布は一切実装されていない**（grep "render" 0件）
- `--write-vercel`の実装（430行目）は`echo "${val}" | vercel env add ${key} production`と
  シェル経由——bootstrap-secrets.mjsの「標準入力で渡す」設計とは異なり、シェル文字列
  展開を経由するため特殊文字を含む値で壊れるリスクがある（既存の既知の粗さ、深追いしない）

### 3. `templates/auth/brands/kimito-link.json` + `brand-preset.schema.json`
- 方式A（`shareInstanceAcrossApps: true`）が既定
- 共有鍵のenv名: `KIMITO_CLERK_PUBLISHABLE_KEY` / `KIMITO_CLERK_SECRET_KEY`
- **秘密の実値は書かない設計が既に明記されている**（notes欄末尾、ユーザー依頼の制約と一致）

### 4. `app.config.schema.json`の`siblingServices`（173-190行目）
- 現在のプロパティ: `name`, `tagline`, `url`, `sharedAccount`, `appUrl`, `iconUrl`, `hubKey`
- **ホスティング先（Vercel/Render/静的）の情報は無い**（実読了で確認、フィールド0件）
- ユーザー依頼は「配布先を`siblingServices`から解決したい」とあるが、**現状のスキーマでは
  解決不可能**——新フィールド追加が必須（例: `hosting: {provider, serviceId}`のような形）
- `ownership`（125-137行目）にも`vercelTeamSlug`/`vercelProjectName`のみで
  Render用フィールドは無い

### 5. `templates/scripts/lib/instrument-core.mjs`
- 3値exit規約（`EXIT.PASS=0`/`FAIL=1`/`INCONCLUSIVE=2`）の実体を確認
- `normalizeProbeResult`: evidence無しのpassは自動でinconclusiveに降格
- `computeExitCode`: fail > inconclusive > pass の優先順位
- `runSelfTest(cases)`: 毒を入れて赤になるかを機械的に確認する共通形
- `withRetryOnTimeout`: タイムアウトを2回試して駄目ならinconclusive（failにしない）
- 依頼の制約5（3値exit）・6（selftest）はこの土台をそのままimportすれば満たせる

### 6. `_docs/DESIGN-canonical-boundary-rules.md`（CANONICAL CHECK正本）
- 判定: 今回はKEEP_SEPARATE（新規実装）が妥当。理由:
  - `bootstrap-secrets.mjs`はGitHub Secrets専用でClerk鍵を扱わない（責務が異なる）
  - `setup-clerk-x-oauth.mjs`はVercelのみでRenderが無い（配布範囲が狭い）
  - どちらも「複数ホスティング先へ横断的に配る」という責務を持っていない
- ただし「土台」は再利用: ブランドプリセット解決ロジック・鍵ディレクトリ運用・
  3値exit規約・selftest型はすべて既存を呼ぶ（車輪の再発明をしない）

## 未確認・実測が必要な点（依頼の「調べてほしいこと」に対応）

| # | 論点 | 現状の確度 |
|---|---|---|
| 1 | Render APIで環境変数を書けるか | ✅**確定**: Render公式MCP `update_environment_variables`が実在・接続確認済み（今回のセッションでツール定義を取得。`serviceId`+`envVars`配列+`replace`オプション、既定はmerge） |
| 2 | Vercelは CLIで足りるか | 🟡未確定: `setup-clerk-x-oauth.mjs`は`vercel env add`をシェル経由で使っているが動作未検証。Vercel公式MCPの`create_project_env`/`edit_project_env`/`get_project_env`も存在する（別セッションで確認済み、200件超のツール一覧の中）。CLIとMCPのどちらを使うかはFableの設計判断に委ねる |
| 3 | 静的サイト（exosome）は配布対象に入れるか | 🟡未確定（依頼者も未確定と明記）。公開鍵のみなので、ビルド時埋め込み等の別経路の可能性あり |
| 4 | ローテーション時に再デプロイが要るか | 🟡未確定。Vercel/Renderとも環境変数変更だけでは実行中プロセスに反映されない可能性が高い（一般的な知見だが、この2サービスでの実測は無し） |

## 制約の再確認（依頼文からの転記、実装時に見落とさないこと）

1. 鍵の値を標準出力に出さない（`bootstrap-secrets.mjs`踏襲）
2. 既定はドライラン、`--apply`明示で実書き込み
3. 鍵ファイルはコミットしない（`.gitignore`前提）
4. **「配れたか」を機械で確かめる**（登録≠効いている、を計器で分離）
5. 3値exit（`instrument-core.mjs`）
6. `--selftest`（毒テスト）

## やってはいけないこと（依頼文からの転記）

- 鍵の実値を`templates/auth/brands/*.json`に書かない
- `bootstrap-secrets.mjs`を作り直さない（拡張または兄弟実装）
- `setup-clerk-x-oauth.mjs`のブランドプリセット解決ロジックを二重実装しない

## Fableへ渡す論点（仕様設計で決めてほしいこと）

1. 兄弟実装か拡張か: `bootstrap-secrets.mjs`とは責務が違う（GitHub Secrets専用 vs
   Clerk鍵の複数サービス配布）ため、**新規スクリプト**（例:
   `templates/scripts/distribute-clerk-keys.mjs`）が妥当と司令塔は考えるが、
   最終判断はFableに委ねる
2. 配布先の抽象化: Vercel（CLI or MCP）／Render（MCP）／静的（対象外 or 別経路）を
   1つのインターフェースでどう抽象化するか
3. `app.config.schema.json`の`siblingServices`拡張案（新フィールドの形）
4. 「配れたか」を検査する具体的な方法（Voiceの`GET /api/config`のような公開
   エンドポイント契約を、どの粒度でapp.config.jsonに持たせるか）
5. 鍵の値をMCP経由で書き込む場合、`~/.claude/CLAUDE.md`「クリップボード経由」節・
   web-ios-android/CLAUDE.md「★★『認証トークン』と『投入する秘密値』は別物」節との
   整合（MCP引数に値が乗る問題をどう回避するか、または許容するか）

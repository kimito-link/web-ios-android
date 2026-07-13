# 設計: 「誰でも簡単に導入できる最適化LP」＋独自ドメイン接続機能

> 設計=Fable(claude-fable-5) ／ 素材収集=会議ハーネス(6体) ＋ Explore実地調査 ／ 裏取り=司令塔(Claude) ／
> 日付=2026-07-13（認証方式をAPIトークン方式→`wrangler login`OAuth方式に改訂・同日） ／
> [council-fable 3段構えワークフロー](../../COUNCIL-HOWTO.md)の手順2〜3の産物。
> 実装は**まだ行っていない**。次チャット/別モデルで着手する前提。
>
> **改訂履歴**: 初版はCloudflare認証を「APIトークン手動発行＋コピペ貼り付け」方式とし、
> 「OAuth連携はコールバックを受けるサーバー常駐が必要」という理由で却下していた。しかし
> ユーザーが自身のCloudflareダッシュボードで「接続済みアプリケーション: Wrangler（28件の権限）」
> という実例を提示。追加のWeb調査で**この却下理由が事実誤認だったと判明**（`wrangler login`は
> Wranglerプロセス自身がlocalhostに一時HTTPサーバーを起動してOAuthコールバックを受ける設計で、
> 外部サーバー常駐は不要）。この事実を反映し、認証方式を`wrangler login`ベースに改訂した。

## お題と背景

「誰でも簡単に導入できる最適化LP」を先に作り、その後、機能・キットの実体をLPの内容につじつまが合うように
整える、という順序で進める。既存LP（`site/index.html`）は「①ダウンロード②名前を書く③AIに頼む④送信」の
4ステップでストア公開できる体裁だが、ユーザーからの追加要望として「CloudflareでWorkers & Pagesにドメインを
ひも付ける」操作（スクリーンショット提示）も非エンジニアが自分で完結できるようにしたい、という声があった。

## 素材収集で判明した収束点（会議ハーネス6体・要約）

- LP先行（fake door/smoke test）戦術自体は需要検証として妥当。ただし「導入の簡単さ」が本プロダクトの核（USP）
  であるため、**LPの訴求と実装の実態にギャップがあると信頼が致命的に毀損する**、という点で複数モデルが一致。
- 自動化できる範囲／人手が残る範囲の切り分け：
  - 自動化できる: Vercelデプロイ、Cloudflare DNS設定（API経由）、GitHub Actions生成・Secrets注入、
    Fastlaneでの署名・提出コマンド。
  - 人手が残る: Apple Developer Program登録・2FA、Google Play Console登録、ドメイン購入（決済）、
    証明書初回発行、ストア審査そのもの。

## 地雷マップ（Explore実地調査で事実確認済み）

- `capacitor.config` は独自VC/AppDelegate注入禁止・自動生成化禁止のルールがある（富士山コンパスで
  黒画面事故を10回以上経験した教訓）。**今回の設計はこの領域に触れない**。
- 旧設計は「自動化スクリプト本体をキットに持たず毎回別リポから手コピー」方式で、参照元が変わると壊れる
  事故が頻発していた。現在は`templates/scripts`へ本体取り込み方式に是正済み＝今回もこの方式を踏襲する。
- Secrets登録ミス（`APPLE_TEAM_ID`をmacOS専用コマンドで取得しWindowsで空値登録）、証明書の複数存在に
  よるexportArchive失敗、プレースホルダ未置換のまま提出し409で弾かれた実例あり。
- CI（`templates/workflows/`）は7本存在し、いずれも`workflow_dispatch`中心の人間トリガー設計。
  App Privacy（プライバシー栄養ラベル）はASC APIで操作不可・Web UI手動必須。Android審査送信も
  最後の一押しは人間の仕様。
- **裏取りで判明した訂正**: Fableは「Cloudflare連携スクリプトは`kimitolink-line/`側に存在する」と
  参照したが、実際のリポジトリ名は`kimitolink-linktree`であり、確認の結果**Cloudflare操作の独自
  スクリプト・ワークフローは同リポジトリにも存在しない**（`wrangler`関連設定やREST API直叩きコードは
  見当たらず）。したがって今回のCloudflare自動化は**流用ではなく完全新規実装**という前提に修正する。

## 採用する設計（Fable設計を裏取り済み事実で補正）

### A. 理想の体験フロー

既存4ステップは変更せず、5ステップ目を追加する：

1. ダウンロード（既存）
2. 名前を書く（既存）
3. AIに頼む（既存）
4. 送信＝Web公開（既存、Vercel Git連携）
5. **独自ドメインを持つ（新規）** — `npm run web:domain` 相当の1コマンドで、購入済みドメインを
   Cloudflare Pages/Workersに紐付ける

ステップ5の内部体験：
- ウィザードが「Cloudflareでドメインを買う（購入は人間・3分程度）」をスクショ付きで案内
- ウィザードが`wrangler login`をバックグラウンドで起動 → ブラウザが自動で開き、Cloudflareアカウントで
  ログイン（未ログインなら）→「Allow」ボタンを1回押すだけで認可完了。**APIトークンの発行画面を探す・
  コピペする手順が丸ごと不要**（当初案からの主要な改善点）
- 以降は自動: Pagesプロジェクト作成 → デプロイ → カスタムドメイン紐付け → DNSレコード作成 →
  SSL発行待ちのポーリング → 完了報告

LP上には各機能に **自動化レベルバッジ**（auto/assisted/manual）を表示し、「どこまで機械がやり、
どこが人間の作業か」を事前に見せる。ストア提出（iOS/Android）は「フェーズ2・ベータ」として明示し、
過大な期待を持たせない。

### B. 統合アーキ（コンポーネント4個）

```
[1] site/claims.json（LPの約束の正本＝唯一の訴求ソース）
      │                              │
      ▼ 生成/参照                    ▼ 照合
[2] site/index.html              [4] scripts/verify-claims-coverage.mjs
    「できること表」セクション          （既存 scripts/verify-doc-impl-coverage.mjs の
                                      設計思想を踏襲した新規スクリプト。同名流用ではない）
                                  ▲ 実在チェック
[3] templates/scripts/cloudflare-auth.mjs（wrangler login ラップ）
    templates/scripts/deploy-cloudflare-pages.mjs
    templates/scripts/connect-domain.mjs
    templates/workflows/deploy-web.yml（8本目・CIはCLOUDFLARE_API_TOKEN方式）
```

- **[1] claims.json**: LPが約束する各機能を`{ id, 文言, level: "auto"|"assisted"|"manual", verify: "<検証手段>" }`
  で列挙。LPの訴求文言はこのファイルからのみ生成・突き合わせる。
- **[2] LP**: claims.jsonをもとにバッジ付き「できること表」セクションを追加（既存4ステップの下に新設。
  前回の改修方針＝新規セクション追加なし、とは異なり、今回は機能追加を伴うため新設を許容する）。
- **[3] Cloudflare自動化本体**: 流用元がないため**新規実装**。`templates/scripts/`に直接作成し、
  「別リポ参照で壊れた」過去の教訓を踏まえ、最初から取り込み方式で作る。
- **[4] 整合検証**: `verify-doc-impl-coverage.mjs`は「_docsのMarkdown⇔実装コードのドリフト検証」が
  目的の既存スクリプトであり、今回作る`verify-claims-coverage.mjs`は「LPの訴求⇔claims.json⇔対応スクリプトの
  実在」を検証する**別スクリプト**（設計思想と設置ディレクトリ`scripts/`は共通、実体は新規）。

### C. 具体機構

**`app.config.json`への追加セクション**（新規実装として必要）:

```json
"web": {
  "deploy": {
    "provider": "cloudflare-pages",
    "projectName": "<pages-project-name>",
    "customDomain": "<example.link または空>"
  }
}
```

裏取りで判明した通り`app.config.schema.json`は最上位に`additionalProperties: false`があるため、
**スキーマファイル自体の修正（`properties.web`定義の追加）が実装の前提条件**。これを怠るとバリデーションで
即座に弾かれる。

**新規スクリプト（3本、`templates/scripts/`に新規作成）**:
1. `cloudflare-auth.mjs` — `child_process.spawn('wrangler', ['login'])`で子プロセスを起動し、
   ブラウザでのOAuth許可完了を待つ（exit code 0で成功、stdout の完了メッセージも補助的にパース）。
   既に認証済み（`~/.config/.wrangler/config/default.toml`にトークンが存在）なら`wrangler whoami`で
   検知しスキップ（冪等）。**CI環境（GitHub Actions）ではブラウザ操作ができないため、CIでは
   従来どおり`CLOUDFLARE_API_TOKEN`環境変数方式にフォールバックする**（ローカル初回セットアップは
   OAuth、CI再デプロイはトークン、の使い分け。両対応が必要）。
2. `deploy-cloudflare-pages.mjs` — wrangler CLIラップ（`npx wrangler pages deploy`）。認証は
   1で確立済みのWranglerセッション（ローカル）または`CLOUDFLARE_API_TOKEN`（CI）を利用。
3. `connect-domain.mjs` — Cloudflare REST API直叩き（`POST /pages/projects/:name/domains`）。
   ゾーンがCloudflare管理下ならCNAMEは自動生成される。TXT検証が要る場合はポーリングで待つ。冪等設計
   （既に紐付いていれば成功終了）。

**ウィザード拡張**: `setup-new-app.mjs`に質問を1つ追加（「独自ドメインを使うか／ドメイン名」）。
Cloudflare認証はAPIトークンのコピペ入力ではなく、`cloudflare-auth.mjs`経由の`wrangler login`
ブラウザ認可フローに一本化する。CI用の`CLOUDFLARE_API_TOKEN`だけは引き続き`bootstrap-secrets.mjs`
経由でGitHub Secretsに登録する（ローカル初回セットアップとCI再デプロイで異なる認証経路を使う設計）。

**CI**: `deploy-web.yml`（push時 or workflow_dispatch）を`templates/workflows/`に8本目として追加。
既存7本と同じプレースホルダ流儀を踏襲。

**capacitor.configには一切触れない。** 今回の追加はWebデプロイ層（DNS/Pages）のみで、ネイティブ
シェル生成の禁則領域と交差しない。

### D. 「LPの訴求と実装実態の乖離」の機械的検知

文言だけの段階的保証（「現在ベータ版」等）は経年劣化するため不採用。代わりに構造で保証する：

1. claims.jsonが唯一の訴求ソース。LPへの機能記述の直接手書きを禁じ、`verify-claims-coverage.mjs`が
   LP内の機能記述とclaims.jsonの差分を検出する。
2. `level: "auto"`を名乗るclaimは、対応スクリプトが`templates/scripts/`に実在し、`--dry-run`のsmokeが
   緑でなければCIが落ちる（fail-closed）。検証不能なclaimは自動的に`assisted`へ降格。
3. 人手が構造的に残る項目（Apple登録・ドメイン購入・Play最終送信・App Privacy手動公開）は
   claims.jsonで`manual`と正直に宣言し、LP上に「あなたの作業（所要時間つき）」として明示する。

### E. MVP（最初の1つ）

**`connect-domain.mjs`＋`deploy-cloudflare-pages.mjs`のペア＝「独自ドメインでWeb公開」の1コマンド化。**

理由:
- ユーザーの直近要望（Cloudflareダッシュボードでの人力操作）に直接刺さる
- ストア提出と違い審査・証明書・2FAが絡まず、**本当に全自動を名乗れる唯一の領域**であり、LPの
  「簡単」訴求の看板として偽りがない
- ただし裏取りの結果、流用元は無いため**新規実装コストは当初想定より高い**（wrangler CLIの挙動確認、
  Cloudflare REST APIのエラーハンドリング、DNS反映待ちのポーリング設計を一から作る）

claims.jsonとLP新セクションはMVPに同梱する（機構[1][2][4]は薄いため同スプリントで可能）。
ストア提出系のclaims棚卸しはフェーズ2。

### F. 捨てた案と理由

| 案 | 判定 | 理由 |
|---|---|---|
| リードマグネットPDF＋メール登録必須化 | 捨てる | 既存の「zip即ダウンロード4ステップ」体裁と正面衝突。摩擦を足す方向はUSP（簡単さ）と逆行 |
| LP＝契約書兼コンシェルジュ受付MVP | 捨てる | 人力運用の常駐負債が生まれ「自動化キット」という製品定義が壊れる |
| Template-as-a-Service（LPがActionsをトリガーしてフォーク〜デプロイ） | 捨てる（フェーズ3候補としても保留） | ユーザーのGitHubトークンをLP側が預かる構造＝認証バックエンドが必須になり、静的LP＋zip配布のアーキを全面作り直す過剰設計 |
| Cloudflare APIトークン手動発行＋コピペ入力（初版で採用していた案） | **撤回・不採用**（改訂で判定を変更） | 初版は「OAuth連携はサーバー常駐が必要」という誤った前提で却下していたが、`wrangler login`はローカル一時HTTPサーバーで完結し外部常駐不要と判明。トークン方式は「発行画面を探す→コピペ」という非エンジニアには不親切な手順が残るため、ローカル初回セットアップでは`wrangler login`に統一。CIのみトークン方式を維持（ブラウザ操作ができないため） |
| Vercel側のOAuth連携（Vercel CLIログイン） | 保留・今回のスコープ外 | MVPはCloudflareドメイン接続に限定。VercelはGit連携デプロイで既に「簡単」が成立しているため今回は変更しない |
| ドメイン購入の自動化 | 捨てる | 決済を伴う操作は人間の作業として残すのが原則。ガイド表示（3分作業として値札付き）で十分 |

### G. 地雷と回避策

1. **別リポ参照で壊れる（既往事故）** → 流用元が実在しないと判明したため、最初から`templates/scripts/`
   への直接実装とする（参照方式は選択肢からそもそも外れた）。
2. **capacitor.config自動生成禁止（富士山コンパス10回事故）** → 本設計はWebデプロイ層のみで非接触。
   実装時のPRチェック項目に明記する。
3. **Secrets空値登録（APPLE_TEAM_ID事故の同型）** → ローカルは`wrangler login`のOAuthセッションを
   使うため空値Secrets問題自体が発生しない。CI用`CLOUDFLARE_API_TOKEN`は`connect-domain.mjs`実行冒頭で
   `GET /user/tokens/verify`により有効性を確認し、無効ならその場で失敗（fail-closed）。
4. **DNS反映待ち・SSL発行待ち** → 「待ち」はエラーではない。ポーリング＋進捗表示、タイムアウト時は
   再実行可能な冪等設計にする。
5. **Windows環境が主戦場** → wrangler/API直叩きはOS非依存だが、PowerShellに日本語を渡さない・パスは
   引用符、の既存規約に従う。PlistBuddy型のmacOS専用依存を持ち込まない。
6. **`app.config.schema.json`のadditionalProperties:false** → `web`セクション追加時はスキーマ側の
   修正が必須の前提条件（実装ハンドオフに明記）。
7. **LPの約束が実装より先に膨らむ（本件の核心リスク）** → claims.json＋CI検証（D節）で機械的に封じる。
8. **コンテナ/リモート開発環境での`wrangler login`失敗**（Web調査で判明） → `localhost:8976`への
   コールバックがホストブラウザから到達不能になる既知の問題がある（GitHub issue多数報告）。通常の
   ユーザーPCでのローカル実行では問題にならないが、Codespaces/devcontainer等での利用者向けに
   「動かない場合はCI用のトークン方式にフォールバック」の案内をエラーメッセージに含める。

## 要約

新規に書くのは実質: スクリプト3本（`cloudflare-auth.mjs`, `deploy-cloudflare-pages.mjs`,
`connect-domain.mjs`）＋`claims.json`＋LP新セクション1つ＋`verify-claims-coverage.mjs`＋workflow1本＋
`app.config.schema.json`の`web`セクション追加。残りは既存資産（`setup-new-app.mjs`ウィザード拡張、
`bootstrap-secrets.mjs`のCI用Secret名追加、`verify-doc-impl-coverage.mjs`と同じ設計思想の流用）の
延長線に置く。

**認証方式の要点（改訂で確定）**: ローカル初回セットアップは`wrangler login`のブラウザOAuth
（ワンクリック許可・トークン発行画面を探す手間なし）、CI再デプロイは`CLOUDFLARE_API_TOKEN`
Secrets方式、の二本立て。「非エンジニアに一番簡単な体験」と「CIでの無人実行」を両立させる。

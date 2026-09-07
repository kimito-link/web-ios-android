# 実装ハンドオフ: Gmail監視→自動判定→Issue起票（gmail-watch）

- 設計: 司令塔（Fable委譲なし。既存パターンの転用のみで完結する規模と判断）
- 裏取り: 司令塔が実地調査（Exploreエージェント2回）で既存workflow・スクリプト・台帳構造を確認済み
- 日付: 2026-09-08
- 前提となるユーザー方針（確定済み・変更しない）:
  1. 監視対象: Search Console・Cloudflare・GitHub・Vercel・Railway・Apple・Android・Stripeの通知メール
  2. 実行場所: **GitHub Actions（cron）**。Claude Desktopのスケジュールタスクは不採用（アプリ起動中しか動かないため）
  3. 頻度: 15分おき
  4. 自動化の範囲: **Issue起票までは自動、実装は既存の`idea-to-pr.yml`に任せる**
  5. 対応先リポジトリの判断: `best-trust`台帳（`data/repositories.json`）を使う
  6. 例外: **Stripeの支払い失敗・課金関連メールは絶対に自動Issue化せず、人に報告するだけ**

この1枚だけで着手できる粒度で書く。実装は行っていない（次チャット/別モデルの仕事）。

---

## A. 読む順

1. 本ファイル
2. `best-trust/data/repositories.json`（対象リポジトリ台帳の構造。`name`/`github.homepage`/`github.url`フィールドを使う）
3. `web-ios-android/templates/workflows/asc-review-poll.yml`（**このワークフローが最も近い先例**。「定期ポーリング→分類→Issue作成→de-dupe→条件次第で自動再トリガー」という構造をそのまま踏襲する）
4. `web-ios-android/templates/workflows/android-cert-expiry.yml`（secrets拡張が要らないパターンの参考、今回は新規secretsが要るので直接は使わないが構造は同型）
5. `web-ios-android/templates/workflows/idea-to-pr.yml`（Issue起票後にどう実装まで自動で繋がるか。特に47-48行目の「秘密情報・課金を伴う変更は実装せず報告する」という既存の安全弁が、今回のStripe除外ルールと同じ思想であることを確認する）
6. `web-ios-android/CLAUDE.md`の「★Webの独自ドメイン接続は1コマンド」節（486-520行目付近）— トークンは「用途ごとに権限が独立している」「GitHub Secretsに登録すればworkflow内で値を晒さず使える」という既存方針

## B. スコープ（MVP）

作るのは以下の3ファイルのみ。

1. `best-trust/.github/workflows/gmail-watch.yml`（新規、cronの本体）
2. `best-trust/scripts/gmail-watch-check.mjs`（新規、Gmail検索→生データ抽出）
3. `best-trust/scripts/lib/repo-lookup.mjs`（新規、メール本文の手がかり文字列→`repositories.json`の対象リポジトリを引く小さな関数。同じロジックを workflow 内 JS と Node スクリプトの両方で使うため独立ファイルにする）

**やらないこと（MVPのスコープ外）**:
- Gmail APIのOAuth初回認可フロー自体の自動化（人が1回だけ手動でリフレッシュトークンを発行する。下記D参照）
- 対象8サービス以外の汎用メール監視
- Slack/Chatwork等への通知連携（今回はGitHub Issueのみ）
- `templates/`への一般化・金型化（他プロジェクトへの配布は、実際に`best-trust`で1回動かして安定してから検討する。基準⑤「複数プロジェクトで繰り返し必要になってから格上げ」に従う。現時点では監視対象が「会社全体の外部サービス通知」という`best-trust`固有の性質が強く、他リポが同じ形で必要とするとは限らない）

## C. 配置場所の判断根拠

`web-ios-android`ではなく`best-trust`（corporate-root）に置く。理由:
- 監視対象（Search Console・Stripe等）は特定の製品・アプリに紐付かず、**会社全体の運用通知**である
- 対応先の判定に使う台帳`repositories.json`自体が`best-trust`にあり、同じリポジトリ内で完結させた方がパスの相対参照がシンプルになる
- `web-ios-android`はアプリ提出自動化キットの心臓部であり、ここに会社運営タスクを混ぜると基準⑤⑥（役割ごとの置き場所を守る）に反する

**着手前に必須**: `best-trust`は`best-trust-biz-ad`セッションが並行稼働中の可能性がある。実装着手時は`web-ios-android/CLAUDE.md`「並列セッション協調プロトコル（Main-Write Pause）」に従い、`best-trust/.agent/coord.md`（無ければテンプレ`web-ios-android/templates/.agent/coord.md.example`から作成）を読み、write_lockを取ってから着手する。

## D. 着手手順

### D-1. Gmail API認証の準備（人手・1回だけ）

OAuth2リフレッシュトークン方式を採用する（Google Apps Script経由は責務が二重化するため不採用、司令塔調査済み）。

1. Google Cloud Consoleで新規プロジェクト（または既存の個人用プロジェクト）を作り、Gmail APIを有効化
2. OAuthクライアントを「デスクトップアプリ」型で作成（`client_id`・`client_secret`を取得）
3. スコープは読み取り専用+ラベル操作のみに絞る: `https://www.googleapis.com/auth/gmail.readonly` と `https://www.googleapis.com/auth/gmail.labels`（**`gmail.modify`や`gmail.send`等の書き込み系スコープは付与しない** — このワークフローはメールを読んで判定するだけで、返信・削除・転送はしない設計のため、最小権限の原則を守る）
4. OAuth Playground（https://developers.google.com/oauthplayground）またはローカルスクリプトで初回認可を行い、リフレッシュトークンを取得
5. `client_id`・`client_secret`・`refresh_token`の3点を`best-trust`リポジトリのGitHub Secretsに登録:
   - `GMAIL_OAUTH_CLIENT_ID`
   - `GMAIL_OAUTH_CLIENT_SECRET`
   - `GMAIL_OAUTH_REFRESH_TOKEN`
6. 他リポジトリへのIssue起票用に、`repo`スコープを持つGitHub PAT（Fine-grained PATで対象リポ群への`Issues: write`権限を付与するのが望ましい）を発行し、`best-trust`のSecretsに`GH_CROSS_REPO_PAT`として登録する（同一リポ内の`GITHUB_TOKEN`は他リポへの書き込み権限を持たないため必須。司令塔調査で確認済み）

この手順はユーザー自身の手作業が必要（Google Cloud ConsoleのGUI操作・OAuth同意画面の操作は自動化できない）。実装担当のAIは、この6ステップをユーザー向けに案内し、3+1個のSecrets登録が完了したことを確認してから次に進む。

### D-2. `repo-lookup.mjs`の実装

`repositories.json`を読み、メール本文中の手がかり文字列（送信元ドメイン・件名・本文中のURL・プロジェクト名らしき文字列）と、各エントリの`name`・`github.homepage`・`github.url`を突き合わせて対象リポジトリを返す関数を書く。

**既知の制約**（司令塔調査で確認済み、実装時に踏まえること）:
- `github.homepage`が空文字のエントリが多数ある（`best-trust.biz`、`kimito-link`、`resend-app`等）→ 逆引きできないケースがあることを前提にする
- `name`がドメイン名そのもの（`ai-shain.link`等）のケースと、Vercelプロジェクト名が`name`と食い違うケース（`compass`→`compass-indol-beta.vercel.app`、`removal`→`removal-seven.vercel.app`）が両方ある→ 単純な完全一致ではなく部分一致・前方一致を使う
- 一致候補が0件、または複数件で曖昧な場合は、**推測で決め打ちしない**。人間確認用のIssueを`best-trust`自身に作る（「このメールの対応先リポジトリが特定できませんでした」という内容）。これは基準③「完膚なきまでの裏取り」およびAI認知の癖③「推論で検証を代替する」への対処と同じ考え方（曖昧なまま断定しない）

### D-3. `gmail-watch-check.mjs`の実装

`asc-review-check.mjs`と同じ「取得→JSON出力」の構造に倣う。

1. `GMAIL_OAUTH_CLIENT_ID`等からアクセストークンを取得（`https://oauth2.googleapis.com/token`にrefresh_tokenでPOST）
2. Gmail APIの`users.messages.list`で検索クエリを組み立てる。対象8サービスの送信元ドメインで`OR`検索し、かつ`-label:gmail-watch-processed`で未処理のみに絞る（例のクエリ構成、実装時に正確なfrom:ドメインを詰める）:
   - Search Console: `from:search-console-noreply@google.com`
   - Cloudflare: `from:*@notify.cloudflare.com` 等
   - GitHub: `from:notifications@github.com`
   - Vercel: `from:*@vercel.com`
   - Railway: `from:*@railway.app`
   - Apple (App Store Connect): `from:*@email.apple.com`
   - Android (Play Console): `from:*@play.google.com` / `googleplay-noreply@google.com`
   - Stripe: `from:*@stripe.com`
   （実装時に実際の送信元アドレスをGmail検索UIで確認してから確定する。想像で決め打ちしない）
3. ヒットしたメールごとに`users.messages.get`で本文を取得し、`{id, from, subject, snippet, bodyText, receivedAt}`の配列としてJSON出力
4. 処理対象に含めたメールには、次回以降の重複検出を防ぐため`gmail-watch-processed`ラベルを付与するAPI呼び出しも行う（ラベルが無ければ`users.labels.create`で作成してから付与）

### D-4. `gmail-watch.yml`の実装

`asc-review-poll.yml`の構造を踏襲。

```yaml
name: gmail-watch
on:
  schedule:
    - cron: "*/15 * * * *"
  workflow_dispatch: {}
permissions:
  issues: write
  contents: read
concurrency:
  group: gmail-watch
  cancel-in-progress: false
jobs:
  watch:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with: { node-version: "22" }
      - name: Fetch unprocessed notification emails
        run: node scripts/gmail-watch-check.mjs > mail-report.json
        env:
          GMAIL_OAUTH_CLIENT_ID: ${{ secrets.GMAIL_OAUTH_CLIENT_ID }}
          GMAIL_OAUTH_CLIENT_SECRET: ${{ secrets.GMAIL_OAUTH_CLIENT_SECRET }}
          GMAIL_OAUTH_REFRESH_TOKEN: ${{ secrets.GMAIL_OAUTH_REFRESH_TOKEN }}
      - name: AI judgement + issue triage
        if: ${{ success() }}
        uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          prompt: |
            mail-report.json を読み、各メールについて以下を判定してください。

            1. data/repositories.json（scripts/lib/repo-lookup.mjs のロジックを使ってよい）
               で対応先リポジトリを特定する。特定できなければ人間確認用として扱う。
            2. Stripeの支払い失敗・課金関連メールは絶対に自動Issue化しない。
               このリポジトリ（best-trust）自身に「[Stripe要確認] <件名>」という
               タイトルでIssueを作り、ai-taskラベルは付けず、メール概要と
               "人間の確認が必要です" という一文だけを本文にして終了する。
            3. それ以外で対応先リポジトリが特定できたものは、
               `gh api repos/kimito-link/<repo>/issues` で ai-task ラベル付きIssueを
               作成する（gh コマンドは GH_CROSS_REPO_PAT 認証済み。実装は
               このIssueをトリガーに対象リポの idea-to-pr.yml が自動で行うので、
               ここでは実装や修正コードを書かない。Issue本文に状況の要約と
               「何が起きたか」「何をしてほしいか」を書くだけでよい）。
            4. 対応先が特定できなかったメールは、best-trust自身に
               「[要確認] 対応先不明: <件名>」というIssueを作り、
               ai-taskラベルは付けない。
            5. 重複Issue化を防ぐため、作成前に既存Issueを検索し、
               同じメールIDに対応するIssueが既にあればスキップする。
          claude_args: |
            --max-turns 20
            --allowedTools "Bash,Read"
        env:
          GH_CROSS_REPO_PAT: ${{ secrets.GH_CROSS_REPO_PAT }}
```

（↑ この`claude_args`のプロンプトは初稿。実装時に実際のJSON構造・repo-lookup.mjsのインターフェースに合わせて調整すること。**`--allowedTools`を省略しない**——`idea-to-pr.yml`で既に一度踏んだ地雷そのもの、忘れるとgit/gh操作が全滅する）

### D-5. 動作確認

1. `workflow_dispatch`で手動実行し、実際に対象メールが0件でもエラーなく終わることを確認
2. テスト用に対象サービスからの実メール（例: 自分宛のGitHub通知）を1通用意し、正しく判定・Issue化されることを確認
3. Stripe関連のテストメール（実際のStripeテストモード通知、または件名に"stripe"を含む適当なメールで代用）で、**自動Issue化されず人間確認用として扱われる**ことを確認（これが今回のユーザー方針で最も重要な安全弁）
4. 同じメールに対して2回workflowを実行し、重複Issueが作られない（de-dupe）ことを確認

## E. 機械的な完了判定

- [ ] `gmail-watch.yml`が15分おきcronで登録されている（`gh workflow list`で確認）
- [ ] D-5の1〜4すべてが実際にIssue画面のスクリーンショットまたは`gh issue list`出力で確認できる
- [ ] Stripeテストで自動Issue化されず、`ai-task`ラベルが付いていないことを確認済み
- [ ] `GMAIL_OAUTH_CLIENT_ID`等3点＋`GH_CROSS_REPO_PAT`がSecretsに登録済み（値は見えないので`gh secret list`で名前の存在のみ確認）

## F. 地雷

1. **`--allowedTools`忘れ**（`idea-to-pr.yml`と同じ地雷。D-4参照）
2. **`GITHUB_TOKEN`では他リポに書き込めない**。`GH_CROSS_REPO_PAT`必須（司令塔調査で確認済み）
3. **Gmail検索の`from:`パターンは実際のヘッダーで確認してから確定する**（想像で決め打ちしない。基準③）
4. **repo-lookup.mjsの逆引きに失敗するケースがある**（`github.homepage`空文字多数）。曖昧なら人間確認Issueに倒す設計を崩さない
5. **並列セッション協調プロトコル**: `best-trust`への最初のcommit/push前に`.agent/coord.md`を確認する（本文書C節参照）
6. **OAuthスコープは`gmail.readonly`のみでよい**（`gmail.labels`は不要。理由は8参照）
7. **【実測・重要】OAuthクライアントは「デスクトップアプリ」型ではなくウェブアプリケーション型で作る**。
   OAuth Playgroundのリダイレクト先は`https://developers.google.com/oauthplayground`固定URLだが、
   「デスクトップアプリ」型はGoogle側の仕様でリダイレクトURIが`http://localhost`固定になり編集できない。
   「ウェブアプリケーション」型を選び、承認済みリダイレクトURIに上記URLを明示的に追加する必要がある
   （2026-09-08実測。`redirect_uri_mismatch`エラーで発覚）。
   また、OAuth Playgroundの設定パネル（歯車アイコン）で「Use your own OAuth credentials」に
   自分のclient_id/secretを入れ忘れる、または古いクライアントの値が残ったままだと、
   `invalid_client`（The provided client secret is invalid）で失敗する。認可のたびに
   設定パネルの中身を目視確認すること。
8. **【実測・重要】ラベル付与（`messages.modify`）は`gmail.labels`スコープだけでは403になる**。
   `gmail.modify`スコープが必要だが、これは削除・内容変更まで許可する強い権限であり、
   「読んで判定するだけ」のこのワークフローには過大な権限になる。そのためde-dupeは
   Gmail側のラベルではなく、リポジトリ内の`data/gmail-watch-processed-ids.json`
   （直近2000件のメールIDを保持）で行う設計に変更した（`scripts/gmail-watch-check.mjs`
   の`loadProcessedIds`/`saveProcessedIds`）。この方式は追加のスコープを要求しない。
9. **【実測・重要】`claude-code-action`は`id-token: write`と`actions: read`の権限が無いと
   OIDCトークン取得に失敗し起動できない**（`Could not fetch an OIDC token`）。
   `idea-to-pr.yml`には元々含まれているが、新規workflowを書くときに見落としやすい。
   `permissions:`に`issues: write`・`contents: write`（IDリストのcommit用）・
   `id-token: write`・`actions: read`の4点が必要。

## G. 関連ファイル（実在確認済み・司令塔が実測）

- `web-ios-android/templates/workflows/asc-review-poll.yml` — 最も近い先例
- `web-ios-android/templates/workflows/android-cert-expiry.yml` — de-dupeパターンの参考
- `web-ios-android/templates/workflows/idea-to-pr.yml` — Issue起票後の実装フロー（既存・変更不要）
- `web-ios-android/templates/scripts/asc-review-check.mjs` — 「取得→JSON出力」構造の参考
- `best-trust/data/repositories.json` — 対象リポジトリ台帳（44件登録済み、`bestprice`含む）
- `web-ios-android/CLAUDE.md`「並列セッション協調プロトコル」節、「★Webの独自ドメイン接続は1コマンド」節

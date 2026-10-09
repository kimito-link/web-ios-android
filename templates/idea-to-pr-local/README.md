# idea-to-pr-local — 音声で頼む → 常駐PCの Claude Code が実装 → PR → 事実を確かめて報告

> **今の到達点（2026-10-09）: 部品は完成・偽物での通し検査は済み。実際の Claude／Grok を使った通しは未検証。**
> 何が検証済みで何が未検証かは「[検証したこと／していないこと](#検証したことしていないこと)」に分けて書いた。
> 本番で動かす前に、そこの「最初の1周を安全に試す手順」を読むこと。

## 何をするものか（全体図）

```
スマホ → Grok（音声）
          │ ① Issue を作る（ラベル ai-task）            ← create-issue.sh または Grok の GitHub コネクター
          ▼
       GitHub Issue ──────────────┐
          │ ② 10分おきに worker.mjs が拾う（常駐PC）    │
          ▼                                              │
   claude -p が実装（git commit まで。push は出来ない）   │
          │ ③ worker が差分を検査 → push → PR 作成       │
          ▼                                              │
       GitHub PR ── Actions（チェック）                   │
          │ ④ worker が後でチェック結果を機械的に確認 ──────┘
          ▼                                  Issue に「機械確認」コメント＋ラベル
       Grok が Issue のコメント/ラベルを読んで報告 ← ⑤ 推測せず、書かれた事実だけを言う
```

- 「完了」と言ってよいのは、**事実で確かめられたときだけ**。PR を作った時点では完了ではない（`ai-pr-open`）。
- マージは**人**がする。自動マージはしない。

## すでにあるもの（作り直していない）との使い分け

| | [`templates/workflows/idea-to-pr.yml`](../workflows/idea-to-pr.yml)（既存） | このディレクトリ（新規） |
|---|---|---|
| 実装する場所 | GitHub Actions（クラウド） | **常駐PC**（Claude Code CLI） |
| 消費するもの | Actions の分数＋サブスク枠 | サブスク枠のみ（Actions は PR のチェック分だけ） |
| 事実確認 | なし（PR を作るまで） | **あり**（PR のチェック結果を機械確認して Issue に書く） |
| 向く場面 | PC を常時起動できない | PC が常時起動／Actions の無料枠を節約したい |

**両方を同じリポで同時に有効にしない**（同じ Issue を二重に実装する）。このディレクトリを使うなら `idea-to-pr.yml` は置かない。
Actions の消費は既存の [`check-actions-usage.mjs`](../scripts/check-actions-usage.mjs) で見る（再実装しない）。

## ファイル

| ファイル | 役目 |
|---|---|
| `create-issue.sh` | Issue を **GitHub API で確定**させる（curl＋`GH_TOKEN`）。ラベルが付かなければ終了コード3で知らせる |
| `worker.mjs` | 常駐PC側。Issue を拾い→実装→検査→push→PR→後で事実確認。`--dry-run` `--status` `--verify-only` `--selftest` |
| `verify-pr.mjs` | PR を「成功と報告してよいか」を、GitHub の事実から機械的に答える（Grok や人が報告前に使う） |
| `lib/pipeline-core.mjs` | 判断だけを集めた純関数（誰の Issue を拾うか／禁止場所／成功判定／秘密の伏せ／回数上限） |
| `lib/pr-facts.mjs` | PR とチェック結果の取得（worker と verify-pr で共有） |
| `register-task.ps1` | Windows のタスクスケジューラに10分おきで登録（既定は表示だけ。`-Apply` で登録） |
| `idea-pipeline.config.example.json` | 設定の例 |
| `*.test.mjs` / `test-fixtures/` | 単体・統合テスト（偽の gh／claude を使い、実際の GitHub・Claude にはつながない） |

## セットアップ（最初の1回）

1. **このディレクトリを使う場所へ置く**（例: 常駐PC の `C:\tools\idea-pipeline\`）。`node`（22 以上）・`git`・`gh`（`gh auth login` 済み）・`claude`（ログイン済み）が要る。
2. **ラベルを作る**（対象リポで1回。既にあれば不要）:
   ```bash
   for l in ai-task ai-working ai-pr-open ai-verified ai-check-failed ai-failed; do gh label create "$l" -R OWNER/REPO 2>/dev/null || true; done
   ```
3. **設定ファイルを作る**: `idea-pipeline.config.example.json` を `idea-pipeline.config.json` にコピーして埋める。
   - `repos.<owner/name>.path` … その常駐PCにある**クローン**（作業は別の作業ツリーで行うので、普段の作業を邪魔しない）
   - `allowedAuthors` … **自分の GitHub ログイン名だけ**。ここが空だと起動しない
   - `installCommand` / `gateCommand` … 依存の導入とテスト（任意。作業ツリーには `node_modules` が無いので、テストを回すなら `["npm","ci"]` が要る）
4. **Issue 作成用のトークン**を作る（Grok 側／スクリプト側で使う分。worker 自体は `gh` のログインを使う）:
   https://github.com/settings/personal-access-tokens/new
   - Repository access: **Only select repositories** → 対象リポを1つ
   - Permissions: **Issues: Read and write**（それ以外は付けない）
   - ★チャットに貼らない・ファイルに書かない・コミットしない。`GH_TOKEN` 環境変数か GitHub Secrets で渡す
5. **動作確認（何も書き換えない）**:
   ```bash
   node worker.mjs --selftest            # 毒入力で止まることの確認
   node worker.mjs --dry-run             # 何を拾うか／なぜ拾わないかだけ表示
   ./create-issue.sh -R OWNER/REPO -t "テスト" -b "本文" --dry-run   # 送る内容だけ表示
   ```
6. **登録**（ここで初めて常駐化。内容を確認してから）:
   ```powershell
   .\register-task.ps1            # 登録内容の表示だけ
   .\register-task.ps1 -Apply     # 登録（ログオン中だけ動く。パスワードは保存しない）
   ```

### 最初の1周を安全に試す手順

テスト用の**空のリポ**で通す（本番のリポで最初に試さない）:

1. 非公開のテスト用リポを作り、上のセットアップを通す（`gateCommand` は無しでよい）。
2. `./create-issue.sh -R OWNER/test-repo -t "README に1行足す" -b "README.md の末尾に「テスト」と書いて"` で Issue を作る。
3. `node worker.mjs --dry-run` → 拾う予定として出ることを確認。
4. `node worker.mjs --once` を**手で**1回実行。Issue に「着手します」→「PR を作りました」のコメントが付き、PR ができることを確認。
5. PR のチェックが終わったあと `node worker.mjs --verify-only` → Issue に「機械確認」のコメントが付くことを確認。
6. ここまで通ってから `register-task.ps1 -Apply`。

## Grok への指示文（コピペ用）

Grok の指示（カスタム指示やプロジェクトの指示）に、次を入れる。**ここは Grok 側の挙動を確認できていない**ので、最初は上の「テスト用リポ」で、その通りに動くか確かめること。

```
あなたは GitHub の Issue を作る役と、その結果を報告する役です。

【Issue を作るとき】
- 対象リポジトリ: OWNER/REPO
- ラベルは必ず ai-task を付ける（付いていない Issue は誰も実装しません）。
- 本文には「何をしたいか」「どこを変えるか（分かれば）」「完成の目安」を書く。
- 秘密情報（パスワード・トークン・鍵）は本文に絶対に書かない。

【結果を報告するとき（推測は禁止）】
Issue を開き、ラベルとコメントを読んでから、次の対応表の文だけを使って報告する。
- ai-task だけ → 「まだ着手されていません」
- ai-working → 「作業中です」
- ai-pr-open → 「PR を作りました。チェック結果はまだ確認できていません」
- ai-verified → 「PR のチェックが全て成功と機械確認されました。マージは人の確認待ちです」
- ai-check-failed → 「PR のチェックに失敗があります」＋ Issue の最新コメントの理由
- ai-failed → 「自動実装は止まりました」＋ Issue の最新コメントの理由
- ラベルが読めない／コメントが読めない → 「未確認です」
「完了しました」と言ってよいのは、PR がマージ済み（Issue がクローズ）で、かつ ai-verified が付いているときだけ。
読み取れなかったことを、読めたかのように言ってはいけません。
```

人間側で確かめたいときは、`node verify-pr.mjs OWNER/REPO --issue 7`（`statement` に、そのまま言ってよい文が出る。成功なら終了コード0・失敗なら1・それ以外は2）。

## 脅威モデル（なぜこの作りか）

Issue の本文は、**この PC 上の AI への命令**になる。つまり「Issue を書ける人」＝「この PC に仕事を頼める人」。

| 想定する攻撃・事故 | 防ぎ方（どれもテストで確認済み） | 防げないもの |
|---|---|---|
| 他人が Issue を作って PC を操作する | `allowedAuthors` に載った作者、かつリポの書き込み権限者（OWNER/MEMBER/COLLABORATOR）の Issue だけ拾う。ラベルを後から他人が付けても、作者が違えば拾わない | **許可した本人のアカウント（トークン）が乗っ取られた場合**。GitHub のアカウント保護（2要素認証）が前提 |
| Issue 本文に「秘密を出せ」「外へ送れ」と書く（プロンプトインジェクション） | 本文は「データ」として囲んで渡す／claude に許す道具を絞る（`git push`・`gh`・ネットワーク・任意コマンドは無し）／子プロセスの環境から `GH_TOKEN` 等を外す | 本文に従ってしまうこと自体は完全には防げない（意味の判断）。**だから道具と差分の検査で受け止める** |
| 実装が workflows・鍵・`.env`・`.claude/`・`vercel.json` に触る | 差分にあれば **push しない**（`forbiddenPaths`） | 検査の対象外の場所の、意図しない変更（人がレビューする） |
| 暴走して main を壊す | push 先は `ai/issue-N` のみ（`main` 等は拒否）・force なし・自動マージなし | — |
| 同じ Issue を二重に実装／無限に実装する | `ai-working` 等のラベルで再度拾わない／ロックファイル／**1周で1件**／24時間の上限 | — |
| API の従量課金に切り替わる | 子プロセスから `ANTHROPIC_API_KEY` を外す（環境にあると claude は従量課金に切り替わる） | PC 側のログイン方式そのもの |

★このワーカーは、`git push` を AI ではなく**決め打ちのスクリプト**が行う。これは、外向き操作のグローバルなガード
（`guard-external-actions`：AI が CLAUDE.md を読んだかを確かめる）を通らない経路になる。その代わり、行き先・ブランチ・差分の検査を
上の表のとおりコードで固定している。ガードを緩めたのではなく、**別の安全装置に置き換えた**ことを理解した上で使うこと。

## 回数とコストの監視

- **実行回数**: `node worker.mjs --status`（直近24時間・7日の着手数、結果の内訳、所要時間、ターン数）。上限は `maxRunsPer24h`（既定5）で、超えると着手しない。
- **Actions の消費**: `node templates/scripts/check-actions-usage.mjs`（既存。暴走ジョブを1回あたりの所要時間で見つける）。
- **サブスク枠の残量は測れない**（API が無い）。`claude -p` はサブスクの使用量を消費し、対話で使う枠と**取り合う**。
  Anthropic の公式ヘルプでは現状、`claude -p` はサブスクの使用量から引かれるが、課金方式の変更が一時停止中で、将来変わる可能性がある
  （https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan,）。**定期的に公式の最新を確認すること。**
- **止め方**: `<stateDir>\PAUSE` というファイルを作る（消すと再開）。タスクごと消すなら `register-task.ps1 -Remove`。

## 検証したこと／していないこと

**検証済み（2026-10-09、自動テスト 63 件）**
- 判断部品（誰の Issue を拾うか／禁止場所／秘密の伏せ／成功判定／回数上限）の単体テスト。実装をわざと壊す7通りで、テストが赤になることを確認した。
- worker の通し（本物の git＋ローカルの bare リポ＋偽の gh／claude）: 正常系、禁止場所・BLOCKED・コミット無し・異常終了で push しないこと、許可外の作者に触らないこと、上限・PAUSE・ロック・既存ブランチ、dry-run が何も書かないこと、事実確認の各判定。
- `create-issue.sh` を偽の GitHub サーバーに向けて実行: 引用符・改行・絵文字を含む本文、HTTP エラー、ラベル欠落、トークンが出力に出ないこと。
- 実物の `gh` と GitHub に対する**読み取りだけ**の `--dry-run`（Issue 一覧を取り、許可作者の `ai-task` Issue を検出できた）。

**未検証（本番で動かす前に、上の「最初の1周を安全に試す手順」で確かめること）**
- **実際の `claude -p` での通し**（許可ツールの書式 `Bash(git add:*)` が実機で効くか、グローバルの hook との相互作用、所要時間）。偽の claude でしか通していない。
- **Grok 側のすべて**: GitHub コネクターが Issue を作れるか／作成時に確認操作が要るか／ラベルを付けられるか／Issue のラベルとコメントを読めるか。公式の説明が見つからず、確認できていない（`create-issue.sh` は、確認操作が要る場合に備えた代替）。
- タスクスケジューラへの実際の登録と、ログオン状態・スリープ中の挙動。
- 課金方式が将来変わった場合の影響。

<!--
  役割: Antigravity（Google）など AGENTS.md を読むエージェントへの「橋渡し」。
  なぜ要るか: Antigravity は AGENTS.md / GEMINI.md / .agents/rules/ しか読まず、CLAUDE.md を読まない
  （https://antigravity.google/docs/rules/ 2026-10-21確認）。ルールの正本は CLAUDE.md のまま。
  ここに本文をコピーしない（Antigravity は1ファイル24KB上限。コピーはずれて事故る）。
  使い方・役割分担の正本: docs/ai-workflows/ANTIGRAVITY-HOWTO.md
-->

# AGENTS.md — このリポで作業する AI へ（橋渡しだけ）

ルールの正本は [`CLAUDE.md`](CLAUDE.md) です。このファイルは入口にすぎません。

## 作業を始める前に

1. `CLAUDE.md` を**先頭から `core:end` の行まで**読む（約430行。ここが必ず守る核）。
2. リポ直下に `handoff.md` があれば読む。書かれた事実・確定済みの判断は調べ直さない。
3. 依頼された引き継ぎ書（ハンドオフmd）を読む。そこに「原因はたぶんここ」と書いてあっても、
   **見立ては誤っている可能性がある。先に問題そのものを実コード・再現で確かめてから進める**
   （[`docs/ai-workflows/FABLE-3STEP-HOWTO.md`](docs/ai-workflows/FABLE-3STEP-HOWTO.md)「ハンドオフ契約」）。

## 絶対にしないこと（Claude Code の hook はあなたには効かないので、ここで止める）

- `git push`・`gh pr merge`・`gh secret set`・`gh workflow run`・`gh release`
- デプロイ（`vercel --prod`・`wrangler deploy`・`npm run deploy:site` など）・`npm publish`
- ストア提出・課金・アカウント作成・外部への投稿
- 他人の作業ブランチや未コミット変更を消す操作（`git reset --hard` を `git status` を見ずに打つ等）

**作業ブランチで commit したところで止める。** push・PR・マージ・デプロイは Claude Code が
差分を実際に動かして検品してから行う（[`docs/ai-workflows/ANTIGRAVITY-HOWTO.md`](docs/ai-workflows/ANTIGRAVITY-HOWTO.md)）。

## 人の手を使わない（2026-10-28）

人に「押して・貼って・画面を読んで・Enter を押して」と頼む前に、自分でやる道を全部ためす。人に渡すスクリプトは
Enter 待ちを置かず、状態をファイルに書き、何度実行しても途中から続くようにする。正本: [`docs/ai-rules/08_NO_HUMAN_HANDS.md`](docs/ai-rules/08_NO_HUMAN_HANDS.md)。

## 終わったら

`handoff.md`（無ければ [`templates/handoff/handoff.md.example`](templates/handoff/handoff.md.example) から作る）の
`STATUS`・`FILES_CHANGED`・`TESTS_RUN`・`TEST_RESULT`・`REMAINING_RISKS`・`NEXT_ACTION`・`WORKED_BY`
（例: `antigravity / Claude Opus 5.5`）を埋める。「動くはず」ではなく、実行したコマンドとその結果を書く。

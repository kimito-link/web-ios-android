# templates/vercel — Vercel のビルド代を「要るビルドだけ」にする金型

正本のルール: [`docs/ai-rules/16_VERCEL_BUILD_COST.md`](../../docs/ai-rules/16_VERCEL_BUILD_COST.md)

## 入れ方（AI がやる。各リポ 2 手）

1. このフォルダの `vercel-ignore-build.mjs` を、そのリポの `scripts/vercel-ignore-build.mjs` に写す（中身は変えない。直すときはこの正本を直して写し直す）。
2. `vercel.json` に `ignoreCommand` を足す。

| リポの形 | `ignoreCommand` |
|---|---|
| サイトだけのリポ | `node scripts/vercel-ignore-build.mjs` |
| 拡張・アプリと LP が同居（LP は `site/` など） | `node scripts/vercel-ignore-build.mjs site/ package.json` ← サイトに効くパスを並べる |
| Vercel の Root Directory を `site` などにしている | `node ../scripts/vercel-ignore-build.mjs`（引数を省くと Root Directory を見張る） |

`vercel.json` を Root Directory の中に置いている場合、スクリプトのパスはそこからの相対になる（`../scripts/...`）。
見張るパス（引数）は**いつもリポ直下から**書く（`git diff --name-only` がリポ直下からのパスを返すため）。
本番ブランチが `main`・`master` 以外なら `--base=<ブランチ名>` を足す（ブランチの最初のデプロイで比べる相手）。

★ブランチの最初のデプロイでは Vercel が前回の SHA を渡さない（docs: "It's empty on a branch's first deployment"）。
そのときは本番ブランチ（`main`/`master`。浅い clone で無ければ `git fetch --depth=1` で先頭だけ取る）との差分で決める。
2026-10-25〜11-24 の実測でプレビューの3〜6割がブランチの最初のデプロイだったため、ここを比べないと省けない。
ログの `[...]` に何と比べたかが出る（`first deploy of branch, vs origin/main (fetched) merge-base` など）。

## 何を省くか

| 場合 | 本番 | プレビュー |
|---|---|---|
| 見張るパス（引数）が1つも変わっていない | 省く | 省く |
| 引数なしで、変わったのが docs だけ（直下の `*.md`・`docs/`・`_docs/`・`.github/`・`.claude/`・`.agent/`） | 省く | 省く |
| `dependabot/`・`renovate/` のブランチ | 作る | 省く |
| 最後のコミットが14日より古いブランチ | 作る | 省く |
| `vercel.json` か、この判定そのものが変わった | 作る | 作る |
| ブランチの最初のデプロイ（前回の SHA が空） | — | 本番ブランチとの差分で上の行と同じに決める |
| 前回の SHA は来たが、浅い clone の中に無い | 作る | 作る |
| 比べる相手が見つからない・git が使えない | 作る | 作る |

「省く」は Vercel 上で `Canceled (Ignored Build Step)` と出るだけで、前の本番はそのまま残る。

★「作る」に倒れたとき、ログの理由は3つに分かれる（2026-11-24、#196）:
`no previous deploy sha`（Vercel が渡していない）／`previous deploy sha <7桁> is not in the clone`（渡されたが深さ10の clone の外。
本番を省いた後や merge commit で大きく進んだ後に起きる。origin が無いので取りにも行けない）／`git diff ... failed`。
続く `[vercel-ignore-build] facts: ...` 行（`previous_sha`・`commits_in_clone`・`head_parents` 等）で原因を追う。
以前は2つ目も1つ目と同じ文で出ていたので、古いログの「no previous deploy sha」は「来ていない」とは限らない。

## 確かめ方

```
node templates/vercel/vercel-ignore-build.mjs --selftest          # 判定の自己点検
node templates/diagnostics/check-vercel-build-skip.mjs <リポ>      # vercel.json に入っているか（diagnostics/run.mjs からも走る）
VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=claude/x VERCEL_GIT_PREVIOUS_SHA=<前のSHA> node scripts/vercel-ignore-build.mjs site/
```

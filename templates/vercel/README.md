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

`vercel.json` を Root Directory の中に置いている場合、パスはそこからの相対になる（`../scripts/...`）。

## 何を省くか

| 場合 | 本番 | プレビュー |
|---|---|---|
| 見張るパス（引数）が1つも変わっていない | 省く | 省く |
| 引数なしで、変わったのが docs だけ（直下の `*.md`・`docs/`・`_docs/`・`.github/`・`.claude/`・`.agent/`） | 省く | 省く |
| `dependabot/`・`renovate/` のブランチ | 作る | 省く |
| 最後のコミットが14日より古いブランチ | 作る | 省く |
| `vercel.json` か、この判定そのものが変わった | 作る | 作る |
| 前回の SHA が分からない・git が使えない | 作る | 作る |

「省く」は Vercel 上で `Canceled (Ignored Build Step)` と出るだけで、前の本番はそのまま残る。

## 確かめ方

```
node templates/vercel/vercel-ignore-build.mjs --selftest          # 判定の自己点検
node templates/diagnostics/check-vercel-build-skip.mjs <リポ>      # vercel.json に入っているか（diagnostics/run.mjs からも走る）
VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=claude/x VERCEL_GIT_PREVIOUS_SHA=<前のSHA> node scripts/vercel-ignore-build.mjs site/
```

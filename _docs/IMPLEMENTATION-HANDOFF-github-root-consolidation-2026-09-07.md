# 実装ハンドオフ: github直下の横断ルール・ノウハウを `web-ios-android` に集約する（Phase 0〜1＝MVP）

> 設計書: [`DESIGN-github-root-consolidation-2026-09-07.md`](DESIGN-github-root-consolidation-2026-09-07.md)（必読。この1枚だけでは判断根拠が分からない）
> このハンドオフは **Phase 0 と Phase 1（MVP）だけ**をスコープにする。Phase 2〜4は設計書のC-4に従い、Phase 1完了後に別ハンドオフを起こす。

## スコープ（これだけやる）

- **Phase 0**: `ai-hub` にGitHubリモートを作り保全する。既知の壊れた参照2箇所（`AI汎用ルール/`）を直す。
- **Phase 1（MVP）**: `templates/scripts/move-doc.mjs` を作る → それを使って `COUNCIL-HOWTO.md` / `FABLE-3STEP-HOWTO.md` / `WAYFINDER-TO-SPEC-HOWTO.md` の3本を `web-ios-android/docs/ai-workflows/` へ移す → `council-fable` / `wayfinder-to-spec` の2スキルのパスを直す → `github/CLAUDE.md` を橋渡しに痩せさせる（ロゴ節は `docs/brand/` へ、ドメイン節は削除）→ `web-ios-android/CLAUDE.md` 冒頭に「知見の地図」表を追加する。

**やらないこと**（設計書F「捨てた案」・スコープ外）: `ai-hub`の物理移動、`ai-generic-rules`の仕分け（Phase 3）、38個の残骸`*-DESIGN.md`等の整理（C分類・Phase 4）、`templates/skills/`新設と3スキル・`rules/`ページ生成（Phase 2）。

## 着手手順

### ブランチ

`web-ios-android` はgit管理下、`github/`直下は非gitなので注意。

```bash
cd "C:/Users/info/OneDrive/デスクトップ/Resilio/github/web-ios-android"
git checkout -b feat/github-root-consolidation-phase1
```

### Phase 0（30分）

1. `ai-hub` にリモートが本当に無いか再確認: `cd ../ai-hub && git remote -v`（0行のはず）
2. `gh repo create kimito-link/ai-hub --private --source=. --remote=origin` → `git push -u origin main`（ブランチ名は実際の`git branch --show-current`に合わせる）
3. 壊れた参照2箇所を直す（実体は`ai-generic-rules/`、パス文字列は存在しない`AI汎用ルール/`になっている）:
   - `web-ios-android/CLAUDE.md` L302付近: `../AI汎用ルール/docs/policies/AI_HARNESS_OPERATION.md` → `../ai-generic-rules/docs/policies/AI_HARNESS_OPERATION.md`
   - `kimitolink-linktree/CLAUDE.md` L33付近: 同様のパスを確認して修正（**他リポなので`git status --porcelain`で未コミット変更が無いことを確認してから**編集し、そのリポで`commit`はユーザー確認を挟む。web-ios-androidからの無断commitはしない）
4. `node ../ai-hub/bin/hub.mjs doctor` を実行し、既存の索引が壊れていないことを確認（Phase 0時点ではこの2箇所修正が影響するエントリは無いはずだが、念のため）

### Phase 1: `move-doc.mjs` を書く

#### 1. 既存の計器を読んでスタイルを揃える

先に読む:
- `templates/diagnostics/check-doc-rot.mjs`（3値exit・`IGNORE_MENTION`の書き方、`../`除外ロジックの実装箇所）
- `templates/diagnostics/check-shared-parts-used.mjs`（selftestの書き方）
- `ai-hub/bin/hub.mjs`（`doctor`サブコマンドの呼び出し方、index.jsonの読み書き）

#### 2. `templates/scripts/move-doc.mjs` を書く

設計書C-1の通り。TDDで進める（selftestを先に書く）。

```
node templates/scripts/move-doc.mjs --from <path> --to <path> [--apply] [--stub] [--selftest]
```

**依存ゼロ（`node:fs`, `node:path`, `node:child_process`のみ）。`rg`に頼らない。**

**4段階**:
1. **棚卸し** — 検索対象: `../`（github直下、除外: `node_modules` `.git` `_backups` `_pending-deletion-review` `dist` `build` バイナリ拡張子）＋ `~/.claude/`（`CLAUDE.md`, `skills/**/SKILL.md`, `agents/`）＋ `ai-hub/index.json`。表記ゆれ4種を検索: (a)相対パス `../<basename>` (b) Windows絶対パス（`\`と`/`両方、日本語パス含む）(c) `github/<basename>`形式 (d) ベース名のみの言及。**ヒット0件でも「0件」を出力**（黙って進まない）。除外リストとして`ai-hub/history/`・`site/learnings/`を明示（理由コメント必須、設計書D-1参照）。
2. **移動** — `mv`（github直下は非git）。`--stub`指定時は旧パスに1行ファイル「moved to `<new>`. Remove after `<30日後の日付>`.」を残し、`ai-hub/history/moves.log`に追記（無ければ新規作成）。
3. **書き換え** — 1で見つけた行を新パスに置換。`index.json`はJSONとしてparseして`path`フィールドを書き換える（テキスト置換禁止）。SKILL.mdは絶対パスのまま新パスの文字列に置換。
4. **ゼロ確認** — 1を再実行し、スタブ以外のヒットが0件か検査。続けて`node ai-hub/bin/hub.mjs doctor`を実行（exit 0必須）。両方通らなければ**赤で終了**（moveはロールバックしない。エラーメッセージで残っている参照箇所を列挙する）。

`--apply`が無ければ1段目（棚卸し結果の表示）だけで終了（既定dry-run、fail-closed）。

`--selftest`: 一時ディレクトリ（`os.tmpdir()`配下）に擬似リポ2つ・擬似`index.json`・擬似`SKILL.md`を作り、4段階の動作と表記ゆれ4種の検出を確認。既存計器規約（3値exit・selftest・fail-closed）に沿う。

#### 3. 動作確認（実際にHOWTO 3本を移す）

```bash
# まずdry-runで棚卸し結果を確認
node templates/scripts/move-doc.mjs --from ../COUNCIL-HOWTO.md --to docs/ai-workflows/COUNCIL-HOWTO.md

# 参照箇所の一覧を目視確認してから apply
node templates/scripts/move-doc.mjs --from ../COUNCIL-HOWTO.md --to docs/ai-workflows/COUNCIL-HOWTO.md --apply --stub

# 同様に FABLE-3STEP-HOWTO.md, WAYFINDER-TO-SPEC-HOWTO.md も
node templates/scripts/move-doc.mjs --from ../FABLE-3STEP-HOWTO.md --to docs/ai-workflows/FABLE-3STEP-HOWTO.md --apply --stub
node templates/scripts/move-doc.mjs --from ../WAYFINDER-TO-SPEC-HOWTO.md --to docs/ai-workflows/WAYFINDER-TO-SPEC-HOWTO.md --apply --stub
```

各実行後、ツールが「ゼロ確認」で緑を返すことを確認する。想定される書き換え対象（設計書0.1・B-2で実測済み）:
- `~/.claude/skills/council-fable/SKILL.md`（複数行）
- `~/.claude/skills/wayfinder-to-spec/SKILL.md`（複数行）
- `~/.claude/skills/audit-skills/SKILL.md`（1行）
- `github/CLAUDE.md`（この後Phase 1の別ステップで書き換えるので、ここで一旦新パスになっていればOK）
- `ai-hub/index.json`（該当エントリの`path`フィールド、各1件）

**赤が出たら「動いたはず」で終わらせない**。ツールが列挙した残存箇所を実際に開いて確認し、検索ロジックの表記ゆれ漏れなのか、本当に見つけていた新規箇所なのかを切り分ける。

#### 4. `github/CLAUDE.md` を橋渡しに痩せさせる

現在の`github/CLAUDE.md`（約140行）から:
- HOWTO 3本への言及は、移動後の新パス（`../web-ios-android/docs/ai-workflows/*.md`。github直下からの相対パス）に更新（move-docが自動で行っているはずだが、文脈が壊れていないか目視確認）
- 「★LP・自社サイトを作るときは「ロゴが主役」」節（本文まるごと）を`web-ios-android/docs/brand/LOGO-RULES.md`として新規作成し、`github/CLAUDE.md`側は1行のリンクに置換
- 「★ドメイン公開は1コマンド」節を**削除**（`web-ios-android/CLAUDE.md`の「★Webの独自ドメイン接続は1コマンド」節が既に上位互換の正本のため。設計書B-2参照）
- 最終的に`github/CLAUDE.md`は30行以内に収める。骨子: (1)まず`web-ios-android/CLAUDE.md`を読め (2)`ai-hub/bin/hub.mjs find`で横断知見を探せ (3)正本1つ・コピー散らさない等の原則3行

`web-ios-android/docs/ai-workflows/github-root-CLAUDE.md.example`として、痩せさせる**前**の`github/CLAUDE.md`全文をバックアップとして保存し、`_docs/instruments/check-drift.mjs`の`PAIRS`に「参考保存・同期不要」の注記付きで登録する（設計書G-1の地雷対策）。

#### 5. `web-ios-android/CLAUDE.md`冒頭に「知見の地図」を追加

設計書B-1の表（8行）を、現在のCLAUDE.md冒頭（「## このキットは何か」の直後あたり）に追加する。本文の他の箇所は変更しない（設計書G-9「表1つ増えて本文は増えない」を守る）。

#### 6. Gate一式を実行

```bash
npm run diagnostics
node ai-hub/bin/hub.mjs doctor
node templates/diagnostics/check-doc-rot.mjs
node templates/diagnostics/check-gates-are-wired.mjs
```

全部緑になってから完了報告。`check-doc-rot.mjs`の`--cross-repo`拡張（設計書D-1）は**このハンドオフのスコープ外**（Phase 2以降）。既存の（拡張前の）`check-doc-rot.mjs`が緑であることだけ確認する。

#### 7. コミット・push・本番確認

```bash
git add -A
git commit -m "..."
git push
```

`site/`や公開ページを変更していないので`npm run deploy:site`は不要（今回はCLAUDE.md・docs/・templates/scripts/のみ）。

## 機械的な完了判定

- [ ] `ai-hub`にGitHubリモートが存在し、pushされている
- [ ] `AI汎用ルール/`という壊れたパス参照が0件（`grep -rn "AI汎用ルール/" ../`で確認）
- [ ] `templates/scripts/move-doc.mjs`が存在し`--selftest`で全ケースpass
- [ ] `COUNCIL-HOWTO.md` / `FABLE-3STEP-HOWTO.md` / `WAYFINDER-TO-SPEC-HOWTO.md`が`docs/ai-workflows/`に存在
- [ ] 上記3本への旧パス参照が0件（`council-fable`/`wayfinder-to-spec`/`audit-skills`のSKILL.md、`ai-hub/index.json`が新パスを指している）
- [ ] `github/CLAUDE.md`が30行以内、ロゴ本文とドメイン本文を含まない
- [ ] `web-ios-android/docs/brand/LOGO-RULES.md`が存在し、ロゴ運用ルールの本文を含む
- [ ] `web-ios-android/CLAUDE.md`冒頭に知見の地図の表が追加されている
- [ ] `npm run diagnostics` / `node ai-hub/bin/hub.mjs doctor` / `check-doc-rot.mjs` / `check-gates-are-wired.mjs`が全部緑
- [ ] `git push`済み

## 地雷（設計書Gの要約、実装中に踏みやすい順）

1. **`github/`直下は非git**。`git mv`ではなく`mv`（Node `fs.renameSync`）を使う。
2. **日本語パス＋`\`区切りをシェルに渡さない**。move-doc.mjsは純Nodeでファイル読み書きし、検索も`/`と`\`両方のパターンで行う。
3. **他リポ（`kimitolink-linktree`等）への書き換え前に`git status --porcelain`を確認**。未コミット変更があればスキップして一覧に出し、そのリポでの`commit`はユーザー確認を挟む。web-ios-androidからの無断commitはしない。
4. **`--stub`の削除予定日を必ず書く**。恒久化すると「正本が2つ」に見える。
5. **`index.json`はJSONとしてparseして書き換える**。テキスト置換すると壊れる可能性がある。
6. **CLAUDE.mdの本文を増やさない**。知見の地図の表以外は追記しない。

## 非スコープ（やらない。設計書Fで却下済み、またはPhase 2以降）

- `ai-hub`の物理移動（設計書B-4で却下済み）
- `ai-generic-rules`の仕分け（Phase 3）
- `templates/skills/`新設・3スキル（`move-doc`/`deploy-site`/`domain-connect`）の追加（Phase 2）
- `rules/`ページ生成・LP導線追加（Phase 2）
- `check-doc-rot.mjs --cross-repo`拡張、`check-public-safe.mjs`、`verify-deployed.mjs`（Phase 2）
- github直下の38個の残骸`*-DESIGN.md`等の整理（C分類、Phase 4）

## 参考: 今回のお題が生まれた経緯

ユーザーから「github直下に散らばっている良いもの（ルール文書・ai-hub・ノウハウ）をweb-ios-androidに吸収し、スキル化して、kimito-skill.linkのLPにも反映したい」という依頼があり、Exploreエージェントによる棚卸し→Fableによる統合設計（council-fableワークフローの手順1簡略版＋手順2）を経て本設計に至った。設計中に「`github/CLAUDE.md`のドメイン公開節」を参照しようとしたところ、CLAUDE.md未読ガードフック（`.claude/hooks/require-claude-md-read.mjs`）が実際に発動し、ハッシュ比較の仕組みが機能していることを実地で確認した。

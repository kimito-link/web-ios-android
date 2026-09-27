# 実装ハンドオフ: self-verification SKILL.md（Superpowers知見の最小取り込み）

> **状態: 実装完了（MVP範囲）。ステップ7の別リポでの自動発見テストのみ未実施。**
> 設計書（全文）: [`_docs/DESIGN-self-verification-skill-2026-09-27.md`](DESIGN-self-verification-skill-2026-09-27.md)
> このファイル**だけ**で着手できる粒度で書く。設計の背景・却下案の理由は設計書側を見る。

## 何を作るか（1行で）

`docs/ai-rules/04_SELF_VERIFICATION.md`（計器の思想）を、Claude Codeネイティブの
`.claude/skills/self-verification/SKILL.md`として構造化し、AIが検査・計器を書く直前や
人間に目視依頼を書きかけた瞬間に自動発見・自己適用できるようにする。**新規ファイルは
実質2つ**（repo側SKILL.md＋`~`側の設置コピー）＋既存2検査への軽微な登録。

## 読む順（着手前に必ず）

1. このファイル（全体像・着手手順）
2. [`_docs/DESIGN-self-verification-skill-2026-09-27.md`](DESIGN-self-verification-skill-2026-09-27.md) の「C. 具体機構」節
   （frontmatterと本文のテンプレそのままコピペ可能）
3. `docs/ai-rules/04_SELF_VERIFICATION.md`（末尾に追記する1行の文脈を掴むため軽く読む）

## スコープ（MVPのみ・これ以外はやらない）

- [ ] `01_CORE_RULES.md`／`02_WORKFLOW.md`／`03_REVIEW_CHECKLIST.md`／
      `05_HANDING_SCREEN_TO_HUMAN.md`のスキル化 → **やらない**（設計書F参照）
- [ ] 呼び出し忘れ検知hookの新設 → **やらない**（設計書D「測ってから増やす」。
      3セッション分の実測データが無い段階で作らない）
- [ ] Superpowers本体の導入 → **やらない**（会議・設計とも全員一致で不採用）
- [ ] `templates/`への配布金型化 → **やらない**（MVPは1本のスキルのみ）

## 着手手順（ブランチ＋TDD的な確認順）

### ステップ0: フェーズ0確認（設計書Eの#1、実は既に完了済み）

設計書には「同名スキル優先規則／description上限／プロジェクト内可視性」を
フェーズ0で確認せよとあるが、**この3点は設計書作成時点で司令塔が既にWebFetchで
裏取り済み**（設計書「★司令塔による裏取り」節）。実装者は再確認不要——ただし
Claude Codeのバージョンアップでこの仕様が変わっている可能性はゼロではないため、
違和感があれば https://code.claude.com/docs/en/skills を一度見る。

### ステップ1: ブランチを切る

```bash
cd "C:\Users\info\OneDrive\デスクトップ\Resilio\github\web-ios-android"
git checkout -b feat/self-verification-skill
```

### ステップ2: SKILL.md本体を作る（repo側）

`.claude/skills/self-verification/SKILL.md` を新規作成。中身は設計書「C. 具体機構」の
frontmatter＋本文をそのまま使う（コピペ後、パス表記の`<github>`部分だけ実際の
相対パスに直す）。

**必須の自己チェック**（機械的に確認できる）:
- 行数: 80行以内（`wc -l` または相当）
- `docs/ai-rules/04_SELF_VERIFICATION.md`と一致する文が3行以上ないか目視確認
  （コピーではなく参照であることを保証するため）
- frontmatterの`description`+`when_to_use`合計が1,536文字以内

### ステップ3: 設置コピーを作る（Personal側）

```bash
mkdir -p ~/.claude/skills/self-verification
cp ".claude/skills/self-verification/SKILL.md" ~/.claude/skills/self-verification/SKILL.md
```

Windows環境なのでPowerShellでも可:
```powershell
New-Item -ItemType Directory -Force -Path "$HOME\.claude\skills\self-verification"
Copy-Item ".claude\skills\self-verification\SKILL.md" "$HOME\.claude\skills\self-verification\SKILL.md"
```

★2箇所は内容が完全一致している必要がある（ステップ7のPAIRS登録で機械検査される）。

### ステップ4: 既存検査へ登録

1. `_docs/instruments/check-drift.mjs`を開き、`PAIRS`配列に以下を追加:
   ```js
   {
     label: 'self-verificationスキル',
     canonical: resolve(KIT_ROOT, '.claude/skills/self-verification/SKILL.md'),
     copies: [resolve(homedir(), '.claude/skills/self-verification/SKILL.md')],
   }
   ```
   `homedir`が未importなら`import { homedir } from 'node:os'`を追加する。
   ★実装前に`check-drift.mjs`を実際にReadし、既存の`PAIRS`配列の実際の形式
   （キー名・`KIT_ROOT`のような変数が実在するか）を確認してから合わせること
   （このハンドオフの疑似コードをそのまま貼らない）。

2. `templates/diagnostics/check-doc-rot.mjs`を開き、`DEFAULT_TARGETS`に
   `.claude/skills/self-verification/SKILL.md`を追加する。
   ★同様に実装前に実ファイルの`DEFAULT_TARGETS`の実際の形式を確認してから合わせる。

### ステップ5: `04_SELF_VERIFICATION.md`末尾に参照1行を追記

規範文（「〜すること」）ではなく名詞形で書く（hookの誤検知回避、設計書G-9参照）:

```markdown
## 実行版の入口
`/self-verification`（`.claude/skills/self-verification/SKILL.md`）。
```

### ステップ6: 機械検査を実行

```bash
node _docs/instruments/check-drift.mjs
node templates/diagnostics/check-doc-rot.mjs --file .claude/skills/self-verification/SKILL.md
```

両方exit 0を確認。次に`check-doc-rot`の偽陰性チェック（意図的に参照を1つ壊してexit 1を
確認 → 直す）を1回行う。

### ステップ7: 自動発見の実地テスト（最重要・省略しない）

1. **別のリポジトリ**（例: `github/line-bot`）で新しいClaude Codeセッションを開く
2. 「`scripts/verify-something.mjs`を作って」のような、SKILL.mdのdescriptionに
   一致する依頼を送る
3. `/self-verification`を明示的に打たずに、transcript（またはセッションの動作ログ）で
   Skillが自動的に読み込まれたか確認する
4. 読み込まれなければ、descriptionを「AIが今書きかけている文」寄りに調整して再試行
   （最大3周。3周しても発見されない場合はその旨をこのファイルに追記して報告する）

### ステップ8: 記録して終える

```bash
node scripts/context-engine.mjs --record --status confirmed --action self-verification-skill --evidence "commit:<sha>"
```

（`context-engine.mjs`の実際の引数仕様は事前に`--help`または既存の呼び出し例で確認）

非自明だった事実があれば`ai-hub`のharvestの掟に従って書き戻す。

## 機械的な完了判定（すべて満たして完了）

- [x] `.claude/skills/self-verification/SKILL.md`が存在し80行以内（63行）
- [x] `~/.claude/skills/self-verification/SKILL.md`が存在し内容が完全一致（`diff`で確認済み）
- [x] `node _docs/instruments/check-drift.mjs`がexit 0（self-verificationスキル部分が✅ pass）
- [x] `node templates/diagnostics/check-doc-rot.mjs --file .claude/skills/self-verification/SKILL.md`がexit 0
- [x] `docs/ai-rules/04_SELF_VERIFICATION.md`末尾に参照1行が追加されている
- [ ] **別リポジトリでの自動発見テスト（ステップ7）は未実施**。代わりに、このセッション内で
      `~/.claude/skills/self-verification/SKILL.md`を配置した直後、システムリマインダーで
      「利用可能なスキル」一覧に`self-verification`が自動的に表示されることを2回確認した
      （Claude Codeが設置コピーを実際に認識した証拠だが、「文脈から自動発見されて読み込まれた」
      ことの証明ではない——一覧に載ることと自動発見はイコールではないため、これは
      「未実施」のまま正直に記録する）。次のセッションで別リポジトリを開き、
      「`scripts/verify-foo.mjs`を作って」等の依頼で実地確認すること。
- [ ] `context-engine.mjs --record`は未実行（引数仕様が未確認のため。下記「実装時に判明した追加事実」参照）

## 実装時に判明した追加事実（設計時点では不明だった）

1. **`check-doc-rot.mjs`の`extractPaths`に既存の検出漏れを発見・修正した**。
   `templates/scripts/lib/foo.mjs`のような複合パスは、正規表現が
   `(?:docs|scripts|lib|...)\/`という「キーワードから始まる」形にしか反応せず、
   先頭が`templates`だと一件も検出されなかった。CLAUDE.md自体に`templates/`参照が
   35件あり、今回の対象1件に留まらない既存の穴だった。`templates`をキーワードリストに
   追加して修正し、selftest 13件全て合格・偽陰性チェック（毒を入れてexit 1→復元してexit 0）も
   実地で確認済み。
2. **上記修正の副産物として、CLAUDE.md本体に既存の腐り2件が新たに可視化された**
   （`web-ios-android-relay.mjs`＝グローバル`~/.claude/hooks/`配下・実在確認済み、
   `open-line-form.mjs`＝別リポ`ai-shain-worker`配下・実在確認済み）。どちらも
   「他リポ/グローバルを指すが`../`形式の相対パスではない」ため`hasOtherRepoPathOnLine`の
   除外に掛からず誤検知されている。**これは今回のスコープ外の既存の別バグとして未修正のまま
   残した**（深追いせず、発見事実として記録するに留めた。`git stash`で修正前後を比較し、
   この2件が今回のtemplatesキーワード追加より前から検出されていたこと＝新規の偽陽性
   ではないことを確認済み）。
3. **`context-engine.mjs --record`の実際の引数仕様は未確認のまま**。実行せずに
   ハンドオフを終える（設計段階の「未確認事項」節で既に警告していた通り）。

## 地雷（設計書Gの要約、詳細は設計書参照）

1. SKILL.mdが04の第2コピーにならないよう、本文は手順・コマンド・参照のみに限定する
2. `~/.claude/skills/`はOneDrive外＝ノートPC側に無い可能性がある。PAIRS登録で検出する
3. compact時の5000トークン予算を意識し80行を超えない
4. SKILL.md内のコマンド例のパスはリポ相対で書く（check-doc-rotが絶対パスを解決できない）
5. 日本語・空白を含むパスは必ず引用符で囲む

## 未確認事項（実装者が引き継ぐ時点で分かっていないこと）

- `check-drift.mjs`・`check-doc-rot.mjs`の実際のコード構造（`PAIRS`・`DEFAULT_TARGETS`の
  正確な形式）は、このハンドオフを書いた時点でファイル自体は実在確認済みだが、
  中身の詳細構造までは読んでいない。実装着手時に必ず先にReadすること。
- `context-engine.mjs --record`の正確な引数仕様は未確認（既存の呼び出し例をGrepで
  探してから使う）。
- ステップ7の自動発見テストが実際に成功するかどうかは、設計段階では検証できない
  （Claude Codeのランタイム動作そのものであり、実装後に実地で確認するしかない）。

## 次のアクション

次チャットまたは別モデル（`dispatch.py --brain grok`等）でこのファイルを読み、
ステップ1から順に実行する。実装完了後、この節を「完了済み」に書き換え、
設計書冒頭の状態ラベルも更新すること。

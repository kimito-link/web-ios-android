# 設計書: github直下の横断ルール・ノウハウを `web-ios-android` に集約し「設計の心臓部」として確定する

> 設計 = Fable（claude-fable-5-1）／ 裏取り = 司令塔（実ファイル・実コマンド） ／ 日付 = 2026-09-07 ／ 3段構えワークフロー（council-fable）の手順2の産物
> 対応する実装ハンドオフ: [`IMPLEMENTATION-HANDOFF-github-root-consolidation-2026-09-07.md`](IMPLEMENTATION-HANDOFF-github-root-consolidation-2026-09-07.md)

## 0. 設計の一文要約

**「公開してよいルール・手順・金型」は `web-ios-android`（public）に1本化し、「公開できない固有知見のカタログ」は `ai-hub`（非公開）に残す。正本は必ずどちらか1つ。github直下には橋渡し1枚だけ残す。** 移動は「参照の棚卸し→移動→参照の書き換え→ゼロ確認」を1コマンドでやる道具を先に作り、その道具でHOWTO 3本を移すのを最初の一手にする。

## 0.1 設計中に確定した事実（この設計の根拠。すべて実測）

| 事実 | 確認方法 | 設計への影響 |
|---|---|---|
| `github/` 直下は **gitリポジトリではない**（`git rev-parse` → `not a git repository`） | Bash | 直下のCLAUDE.md・HOWTO 3本・評価文書は**履歴ゼロ・OneDrive頼み**。gitの下に入れること自体が保全になる |
| `ai-hub` は **remote無し**（`git remote -v` → 0行）。GitHub上に `kimito-link/ai-hub` は存在しない | Bash / `gh repo view` | エンジンが1台のPCにしか無い。移動より先に**privateリモートを作る**方が急務 |
| `ai-generic-rules` は GitHub **PRIVATE**、`web-ios-android` は **PUBLIC** | `gh repo view --json visibility` | 「全部web-ios-androidへ」＝「全部公開」。公開可否の仕分けが設計の中心になる |
| `web-ios-android/docs/ai-rules/` は `ai-generic-rules/AI汎用ルール_DeveloperPack_2525/` のコピー。`01_CORE_RULES.md` は**既に内容が食い違い**、`04_SELF_VERIFICATION.md` はキット側にしか無い | `diff -q` | 正本が2つある状態＝ドリフト実損。どちらが正本かを決めて片方を消す |
| `web-ios-android/CLAUDE.md` L302 と `kimitolink-linktree/CLAUDE.md` L33 が **存在しないパス `AI汎用ルール/`** を参照している（実体は `ai-generic-rules/`） | Grep | 過去のリネームで参照が既に壊れている。「移動だけして参照を直さない」事故が現在進行形で存在する |
| ★2026-09-07 Phase 0着手時に再調査した結果、`AI汎用ルール/`という壊れたパス参照は**2箇所ではなく約20ファイル・40箇所以上**に及ぶことが判明（`line-bot`, `kimitolink-linktree`, `partnership_program_website`, `yukkuri-exosome.link`, `resend.kimito-link.com-`, `tsuioku-no-kirameki.com`, `OKF-meeting-notes.md`等） | `grep -rn "AI汎用ルール/"`（60秒予算で全件取得） | **設計時点の実測は過小評価だった**。全件修正は`ai-generic-rules`縮退（Phase 3）と同格以上の規模になるため、Phase 0は`web-ios-android/CLAUDE.md`の1箇所修正のみに絞り、残りは新設の**Phase 0.5**として本設計に追記した（下記C-4改訂参照） |
| `templates/diagnostics/check-doc-rot.mjs` は `../other-repo/...` 形式の参照を**意図的に検証対象外**にしている | Read | 上の壊れた参照が緑のまま通る理由。横断参照の検査が空白地帯 |
| `ai-hub/index.json` は76エントリ。path先頭で web-ios-android:24 / ai-hub:13 / 他15リポ以上。`COUNCIL-HOWTO.md`・`FABLE-3STEP-HOWTO.md`・`ANTI-SLOP-ADOPTION-ASSESSMENT.md`・`HANDOFF-*.md` を github直下パスで直接指すエントリがある | Node | 直下ファイルを動かすと index.json の該当エントリも書き換え対象。`hub.mjs doctor` が path存在を検査するので検出できる |
| `~/.claude/skills/council-fable/SKILL.md` と `wayfinder-to-spec/SKILL.md` は HOWTO 3本を**Windows絶対パス**で参照。`audit-skills/SKILL.md` も `github/*.md` を参照 | Grep | 移動時はスキル側も書き換え対象。絶対パス・`\`区切りも検索しないと漏れる |
| `ai-hub` を参照するリポ: web-ios-android 26ファイル / kimitolink-linktree 9 / surechigai-romi.link 8 / tsuioku 5 / best-trust.biz 5 / 他8リポ。`ai-generic-rules` を参照するリポ: 約20リポ（kimito-link-reply-suggest 23ファイル、kimitolink-linktree 19 …） | grep（5分超の全走査） | どちらも物理移動のコストが高い。特に ai-generic-rules は global `~/.claude/CLAUDE.md` からも絶対パスで参照されている |
| `ai-hub/history/` と `ai-hub/flows/` は**空ディレクトリとして既に存在** | ls | 会議ログ・改修履歴の置き場が設計済みで未使用。新設不要 |
| `scripts/lib/architecture-map-visibility.mjs` に「`gh repo list` の一次情報でPUBLIC/PRIVATEを判定・fail-closed」の実装が既にある | Read | 公開可否フィルタは**これを再利用**する（新規の権限管理を作らない） |
| 2026-08-26 設計（`_docs/DESIGN-ai-hub-consolidation-2026-08-26.md`）で「ai-hubは移動しない」は決着済みで実装済み（`npm run hub:page` → `site/hub/`） | Read | 本設計はこれを**蒸し返さない**。前提として積む |

---

# A. 理想の体験フロー

## 「web-ios-androidを開けば全部わかる」の定義

次の4つが1つのリポの中で答えられる状態、と定義する。

1. **ルール（何を守るか）** → `CLAUDE.md`（非交渉ルール・4基準・5類型）＋ `docs/ai-rules/`（規則の本文）
2. **手順（どう進めるか）** → `docs/ai-workflows/`（council-fable / wayfinder-to-spec / handoff 等のHOWTO正本）
3. **金型（何を使うか）** → `templates/`（既存）＋ `templates/skills/`（★新設。汎用スキルの正本）
4. **証拠（なぜそのルールか）** → `site/learnings/`（既存）

そして「**このリポに無いもの**」も1箇所で分かる: `CLAUDE.md` 冒頭の**知見の地図**（下記B-1の表）に「非公開の固有知見は `../ai-hub`、そのURL窓口は `/hub/`」と明記する。「全部ある」ではなく「全部の**所在**がある」が正しいゴール。ai-hubのindex.jsonは private リポ名を含むので public なここには物理的に置けない（0.1参照）。

## 人間（ユーザー）の動線・前後比較

| 場面 | 今 | 集約後 |
|---|---|---|
| 「あの手順どこだっけ」 | github直下80項目のフラットな一覧を目で探す。HOWTOか設計書残骸か区別がつかない | `kimito-skill.link/rules/` を開く（★新設。`docs/ai-rules/`と`docs/ai-workflows/`から**生成**）。1ページに規則・手順が一覧、各項目にGitHubリンクと「生まれた事故」リンク |
| 「ルールをAIに読ませたい」 | `github/CLAUDE.md`→`ai-hub/CLAUDE.md`→`web-ios-android/CLAUDE.md` と3段 | `github/CLAUDE.md` は「まず `web-ios-android/CLAUDE.md` を読め」の橋渡しだけ。実質1段 |
| 「これ公開して大丈夫？」 | 都度判断・記憶頼み | `docs/`配下＝公開、`ai-hub/`＝非公開、の2値。`check-public-safe.mjs` が private リポ名・秘密らしき文字列を機械で止める |
| 「変えたのに本番に出てない」 | 2026-09-01に2回踏んだ | `npm run deploy:site` の最後に本番URLを実fetchしてビルド印を照合する検査が走る（D-2） |

## AI（Claude Codeセッション）の動線・前後比較

| 場面 | 今 | 集約後 |
|---|---|---|
| セッション開始 | `github/CLAUDE.md`（140行、実務ノウハウ混入）→ `ai-hub/CLAUDE.md` → `web-ios-android/CLAUDE.md` | `github/CLAUDE.md`（≤30行）→ `web-ios-android/CLAUDE.md` 冒頭の**知見の地図**で全所在を把握 → 必要な `docs/ai-workflows/*.md` を読む。ai-hubの`find`は従来通り |
| `/council-fable` を叩く | SKILL.md が github直下の絶対パスを読む（直下は git 管理外＝壊れても気づかない） | SKILL.md が `web-ios-android/docs/ai-workflows/COUNCIL-HOWTO.md` を読む。`check-doc-rot --cross-repo` と `check-skills-deployed` が参照切れを検出 |
| ドメイン公開・サイト反映 | CLAUDE.mdの長文を読んで手順を組み立てる | `/domain-connect <domain>`、`/deploy-site` の薄いスキルを叩く。中身は正本へのポインタ＋手順3行 |
| ファイルを動かす | 手作業で `grep -rn` | `/move-doc <from> <to>`（`templates/scripts/move-doc.mjs`）が棚卸し→移動→書き換え→ゼロ確認まで行う |

---

# B. 統合アーキテクチャ

## B-1. 2層モデル（3層を2層に減らす）

```
github/                                  ← gitではない。橋渡し以外を置かない
  CLAUDE.md                              ← 【薄くする】≤30行。役割: (1)web-ios-androidを読め (2)ai-hubのfindを叩け (3)原則3行
  AGENTS.md                              ← 【3行ポインタに置換】Codex向け。CLAUDE.mdのミラーをやめる
  ai-hub/                                ← 【不動・非公開】エンジン＝index.json / kb / agents / bin
    history/                             ← 【既存・空→使う】会議ログ・ハーネス改修履歴（OKF, council-upgrade-*, claude-token-saving-council.json）
    kb/                                  ← 【追記】private リポ名を含む横断評価（ANTI-SLOP-ADOPTION-ASSESSMENT.md）
    docs/                                ← 【新設・2ファイル】ai-hub-DESIGN.md / ai-hub-IMPLEMENTATION-HANDOFF.md（ai-hub自身の設計書はai-hub側に持たせる）
    bin/check_projects.sh                ← 【移動】横断死活確認スクリプト（ci-audit.mjs等と同じ棚）
  ai-generic-rules/                      ← 【Phase 3で縮退】公開可の文書はweb-ios-android/docs/へ、非公開はai-hub/kbへ。最後はポインタREADMEだけ残す
  web-ios-android/                       ← 【公開の正本＝設計の心臓部】
    CLAUDE.md                            ← 【冒頭に「知見の地図」表を追加】本文の長さは今回いじらない
    docs/
      ai-rules/                          ← 【正本に確定】00〜04。ai-generic-rulesのDeveloperPackコピーを廃止
      ai-rules/policies/                 ← 【Phase 3】AI_HARNESS_OPERATION / TOKEN_SAVING_POLICY 等、公開可と判定した運用規約
      ai-workflows/                      ← 【新設】COUNCIL-HOWTO / FABLE-3STEP-HOWTO / WAYFINDER-TO-SPEC-HOWTO
      brand/LOGO-RULES.md                ← 【新設】github/CLAUDE.mdに混入していたロゴ運用ルールの本文を切り出す
    templates/
      skills/<name>/SKILL.md             ← 【新設】汎用スキルの正本（~/.claude/skills はコピー先）
      scripts/move-doc.mjs               ← 【新設】参照安全な移動ツール（C-1）
      scripts/verify-deployed.mjs        ← 【新設】本番反映の実fetch照合（D-2）
      diagnostics/check-public-safe.mjs  ← 【新設】公開領域への非公開情報混入検査（C-3）
      diagnostics/check-skills-deployed.mjs ← 【新設】templates/skills と ~/.claude/skills のバイト一致検査
    site/
      rules/                             ← 【新設・生成物】docs/ai-rules + docs/ai-workflows を人間向けに描画
      hub/                               ← 【既存・非公開窓口】変更なし
      learnings/                         ← 【既存】変更なし
```

**知見の地図（`web-ios-android/CLAUDE.md` 冒頭に置く表の設計）** — 行は「種類 / 正本の場所 / 公開可否 / それを守る検査」の4列。全行のパスは `check-doc-rot.mjs`（`--cross-repo` 拡張後）が実在検証する。この表が「web-ios-androidを開けば全部の所在が分かる」の実体。

| 種類 | 正本 | 公開 | 検査 |
|---|---|---|---|
| 非交渉ルール・基準 | `CLAUDE.md` | 公開 | check-doc-rot |
| 規則本文 | `docs/ai-rules/` | 公開 | check-doc-rot / check-public-safe |
| 進め方HOWTO | `docs/ai-workflows/` | 公開 | 同上＋check-skills-deployed |
| 汎用スキル | `templates/skills/` | 公開 | check-skills-deployed |
| 金型・計器 | `templates/` | 公開 | 既存Gate群 |
| 事故と教訓 | `site/learnings/` | 公開 | verify-learnings-map |
| 横断資産カタログ・固有知見 | `../ai-hub/`（URL窓口 `/hub/`） | **非公開** | hub.mjs doctor |
| 会議ログ・改修履歴 | `../ai-hub/history/` | 非公開 | — |

## B-2. 移動台帳（A分類の全ファイルの行き先。「その他」を作らない）

| 元（github直下） | 行き先 | 判定 | 参照を直す先（実測） |
|---|---|---|---|
| `COUNCIL-HOWTO.md` | `web-ios-android/docs/ai-workflows/` | ESTABLISH_REHOME | `~/.claude/skills/council-fable/SKILL.md`（L9,17,18,40,63）、`audit-skills/SKILL.md` L24、`github/CLAUDE.md`、`ai-hub/index.json` 1件 |
| `FABLE-3STEP-HOWTO.md` | 同上 | 同上 | council-fable SKILL.md L17、`github/CLAUDE.md`、index.json 1件 |
| `WAYFINDER-TO-SPEC-HOWTO.md` | 同上 | 同上 | `wayfinder-to-spec/SKILL.md` L10,19、`github/CLAUDE.md` |
| `CLAUDE.md`（ロゴ運用節） | `web-ios-android/docs/brand/LOGO-RULES.md` に本文移動、CLAUDE.mdは1行リンク | ESTABLISH_REHOME | `github/CLAUDE.md` 自身のみ |
| `CLAUDE.md`（ドメイン公開節） | **削除**（`web-ios-android/CLAUDE.md` の「★Webの独自ドメイン接続は1コマンド」節が既により詳しい正本） | REUSE | なし |
| `AGENTS.md` | 3行ポインタに置換（「CLAUDE.mdを読め」） | REUSE | なし |
| `ANTI-SLOP-ADOPTION-ASSESSMENT.md` | `ai-hub/kb/` | KEEP_SEPARATE（77リポ名＝private名を含むため公開不可） | `ai-hub/index.json` 1件 |
| `OKF-meeting-notes.md` / `council-upgrade-2026-07-03-handoff.md` / `council-upgrade-decision-2026-07-01.md` / `claude-token-saving-council.json` | `ai-hub/history/` | KEEP_SEPARATE（履歴。正本ではない） | `OKF-meeting-notes.md` は ai-generic-rules 参照を含むが読み専用ログなので書き換え不要 |
| `ai-hub-DESIGN.md` / `ai-hub-IMPLEMENTATION-HANDOFF.md` | `ai-hub/docs/` | ESTABLISH_REHOME | `ai-hub/CLAUDE.md` L4、`github/CLAUDE.md`、index.json 該当があれば |
| `check_projects.sh` | `ai-hub/bin/` | ESTABLISH_REHOME | 未確認（他からの参照は grep で0件だった範囲では無し。move-docのdry-runで確定させる） |
| `HANDOFF-kioku-mcp.md` / `HANDOFF-hatsunote-mcp.md` / `HANDOFF-cloudflare-workers-ai.md` | 今回は**触らない**（C分類だが index.json が直接指している。Phase 4の残骸整理で `ai-hub/history/` へ） | — | index.json 各1件 |

C分類（38個の`*-DESIGN.md`等・zip・`_backups/`等）は本設計のスコープ外。ただし上表の HANDOFF 3本のように index.json から指されているものは「消すと doctor が赤になる」ので、残骸整理のときは必ず `hub.mjs doctor` を通す、とだけ決めておく。

## B-3. `github/CLAUDE.md` の扱い — 薄い橋渡しを残す（一本化しない）

完全一本化（削除）しない理由: Claude Code は cwd から親を遡って CLAUDE.md を読む。`github/`直下で `claude` を起動したときや、web-ios-android 以外のリポで作業しているときに「まず web-ios-android/CLAUDE.md を読め」を伝えられる唯一の場所がここ。**ただし内容は ≤30行に制限し、実務ノウハウの本文を書くことを禁止する**（書きたくなったら `web-ios-android/docs/` へ）。これを検査で守る: `check-doc-rot.mjs` の対象に `../CLAUDE.md` を加え、**行数上限（30）**を検査項目に足す（新規計器は作らない。既存計器に1ルール追加）。

## B-4. `ai-hub` は移動しない（決着済み・再確認）

2026-08-26設計の判断根拠4点に、今回さらに2点が加わる:
- **公開性**: web-ios-android は PUBLIC。index.json は private リポ名を76エントリ中の大半に含む。ネストした瞬間に全部公開になる。
- **リモート不在**: そもそも ai-hub は GitHub に存在しない。ネストより先に `gh repo create kimito-link/ai-hub --private` で保全するのが正しい順序。

「移動する場合の設計」は求められているので示す（採用しない）: `web-ios-android/engine/ai-hub/` にサブモジュールとして置き、`hub.mjs` の `GITHUB_ROOT = resolve(AIHUB_DIR, '..')` を `'../..'` に変更、index.json 76件の path を全て書き換え、13リポの参照を書き換える。得られるのは「フォルダが1つに見える」ことだけで、URL窓口（`/hub/`）は既にその見え方を実現している。**却下**。

## B-5. `ai-generic-rules` は「縮退」させる（Phase 3。物理移動ではなく中身の仕分け）

約20リポ＋global CLAUDE.md が参照しているので、ディレクトリごと動かすのは compass 事故の再来になる。代わりに**中身を1ファイルずつ仕分け**して、ディレクトリは最後にポインタREADMEだけになるまで痩せさせる。

| ai-generic-rules 内 | 判定基準 | 行き先 |
|---|---|---|
| `AI汎用ルール_DeveloperPack_2525/` | web-ios-android/docs/ai-rules が既に上位互換（04あり） | **削除**→READMEに「正本は web-ios-android/docs/ai-rules」（★実装時に `git log` で01_CORE_RULESのどちらが新しいか確認してから。決め打ちしない） |
| `docs/policies/*.md`（10本・836行） | `check-public-safe.mjs` を通し、private名・秘密が無ければ公開可 | 公開可→`web-ios-android/docs/ai-rules/policies/`。`CLERK_X_LOGIN_PLAYBOOK.md` は grep でヒットあり（未精読・要目視）→ 該当箇所を落とすか `ai-hub/kb/` へ |
| `docs/workflows/`, `docs/templates/`, `docs/enforcement/`, `docs/project-management/` | 同上 | 公開可→`web-ios-android/docs/ai-rules/` 配下の同名サブディレクトリ。`enforcement/version-check.mjs` は `templates/diagnostics/` の既存検査と重複しないか CANONICAL CHECK |
| `andrej-karpathy-skills/`（外部スナップショット）、`*.zip`、`deep-research-report*.md` | 外部物・生データ | `ai-hub/history/` または削除 |

参照の書き換え先（global `~/.claude/CLAUDE.md` の `AI_HARNESS_OPERATION.md` 絶対パス、`check-doc-rot.mjs` の `IGNORE_MENTION`、各リポの CLAUDE.md）は `move-doc.mjs` の dry-run で全件出す。**Phase 3 は Phase 1 で move-doc.mjs が HOWTO 3本で実証されてから着手する**。

---

# C. 具体的な機構

## C-1. `templates/scripts/move-doc.mjs` — 参照安全な移動（compass事故の再発防止の本体）

```
node templates/scripts/move-doc.mjs --from <path> --to <path> [--apply] [--stub]
```

**責務は4段階。`--apply` が無ければ1段目だけ（既定 dry-run。fail-closed）。**

1. **棚卸し（inventory）** — 検索対象: `github/` 配下（除外: `node_modules` `.git` `_backups` `_pending-deletion-review` `dist` `build` `*.zip` `*.png`等バイナリ）＋ `~/.claude/`（`CLAUDE.md` `skills/` `agents/`）＋ `ai-hub/index.json`。検索する**表記ゆれを全部**引く（compass事故の教訓）:
   - 相対パス `../COUNCIL-HOWTO.md` / `github/COUNCIL-HOWTO.md`
   - Windows絶対パス（`\` と `/` 両方、`デスクトップ` を含む日本語パス）
   - ベース名だけ `COUNCIL-HOWTO.md`（リンク文中の言及）
   - 出力: リポ別・ファイル別・行番号つき一覧。**ヒット0件でも「0件」を明示**（黙って進まない）
2. **移動** — `git mv`（追跡下）／`mv`（未追跡。github直下はgit外なのでこちら）。`--stub` 指定時は旧パスに「moved to <new>」の1行ファイルを残す（他セッション・古いスキルが読みに来たときの fail-soft。30日後に削除する行を `ai-hub/history/moves.log` に追記）
3. **書き換え** — 1で見つけた各行を新パスに置換。index.json は JSON として読み書き（テキスト置換しない）。SKILL.md の絶対パスは絶対パスのまま新パスに
4. **ゼロ確認** — 1をもう一度走らせ、旧パスのヒットが**スタブ以外で0件**であることを検査。続けて `node ai-hub/bin/hub.mjs doctor` と `check-doc-rot.mjs --cross-repo` を実行し、両方 exit 0 で完了。1つでも赤なら「移動は済んだが参照が残っている」と**赤で終わる**（緑にしない）

`--selftest`: 一時ディレクトリに擬似リポ2つ＋index.json＋SKILL.mdを作り、4段階が想定通り動くこと・表記ゆれ4種を全部拾うことを確認。既存計器規約（3値exit・selftest・fail-closed）に沿う。

依存ゼロ（純Node walk）。`rg` に頼らない（PATHに無い環境がある）。全走査は md/json/mjs/js/yml/txt のテキスト拡張子だけに絞れば数秒で終わる（grep全走査5分超は node_modules と zip を舐めたため）。

## C-2. スキル化の範囲と配置

**原則**: SKILL.md は「呼び出し語＋手順の骨＋正本へのポインタ」だけ（目安60行以内）。**ノウハウ本文をSKILL.mdに複製しない**（複製した瞬間に3つ目の正本になる）。正本は `web-ios-android/templates/skills/<name>/SKILL.md`、`~/.claude/skills/` は配備先。ai-hub が `agents/` でやっている「正本→コピー、doctorでバイト一致」と同じ型を `check-skills-deployed.mjs` で敷く。

| スキル | 状態 | 中身 | 正本ポインタ |
|---|---|---|---|
| `council-fable` | 既存・パス修正 | 変更なし | `docs/ai-workflows/COUNCIL-HOWTO.md`, `FABLE-3STEP-HOWTO.md` |
| `wayfinder-to-spec` | 既存・パス修正 | 変更なし | `docs/ai-workflows/WAYFINDER-TO-SPEC-HOWTO.md` |
| `move-doc` | **新規** | `move-doc.mjs` を dry-run→ユーザー確認→apply の順で回す。「移動したら参照ゼロ確認まで」を強制 | C-1 |
| `deploy-site` | **新規** | `git push` 済み確認→`npm run deploy:site`→`verify-deployed.mjs` の結果を報告。「コミットした≠反映された」実損2件を手順に焼く | `CLAUDE.md` 基準③の★節 |
| `domain-connect` | **新規** | `--check` から入る→`domain-connect.mjs`→反映待ちの注意（数分・`000`は失敗ではない）→www無し確認 | `CLAUDE.md`「★Webの独自ドメイン接続」節 |

スキル化**しない**もの（理由つき）: harvest（`harvester` エージェントが既に唯一の書き役。二重化になる）／hub find（1行コマンド。忘れ防止はスキルでなく既存のCLAUDE.md未読Gateフックの領域）／トークン節約（global CLAUDE.md からポリシーを直接参照済み）／`nicolive-*` 等プロジェクト固有スキル（各リポの `.claude/skills/` が正本であるべきで、汎用置き場に混ぜない）。

`audit-skills` スキルが「繰り返しパターン→スキル抽出」を担うので、**上記3つ以外の候補は audit-skills を回して決める**。設計で先回りして増やさない。

## C-3. 公開LPの改修と非公開情報のフィルタ

**役割分担（変えるのは1点だけ）**

| ページ | 役割 | 変更 |
|---|---|---|
| `index.html`（LP） | なぜこのキットか・CVR | 「ルールと手順を読む→`/rules/`」の導線を1ブロック追加（`site/LP-SYNC.md` の手順に従う） |
| `ai-guide/` | AIが実行する手順 | 「HOWTOの正本は `docs/ai-workflows/`」の1段落追加 |
| `learnings/` | 事故と教訓 | 変更なし。`/rules/` から逆リンク |
| `hub/` | 非公開カタログ窓口（Access保護・noindex） | 変更なし |
| **`rules/`（新設・生成物）** | `docs/ai-rules/**/*.md` と `docs/ai-workflows/*.md` を1ページに描画。各項目: 見出し・冒頭1段落・GitHubの正本リンク・関連learningsリンク | `scripts/generate-rules-page.mjs` 新設。`deploy:site` に `rules:page` を追加 |

`rules/` を**生成物**にする理由: md を手でHTML化すると md と Web が2つ目の正本になり、まさに今回直そうとしているドリフトを site 側で再生産する。`site/hub/`・`site/check-shindan-version/` と同じ「正本→生成」の型に揃える。Markdown→HTML は依存を1つ足す（`marked`、既に `ajv` を足している前例あり）か、見出し・段落・リスト・コードだけの最小変換で足りる（設計上はどちらでもよい。実装時に `hub.mjs find --tag markdown` で既存変換器が無いか先に確認）。

**フィルタ方針（2値・fail-closed）**
- 公開に出るのは `docs/` 配下**だけ**。`_docs/`（キット内部記録）・`ai-hub/`・`.instrument-*`・`.architecture-map-internal.json` は生成器の入力に取らない（allowlist方式。denylistにしない）
- `templates/diagnostics/check-public-safe.mjs`（新設）: `docs/` と `site/` 配下の全テキストを対象に、(a) `architecture-map-visibility.mjs` の `fetchVisibilityFromGitHub`／既存キャッシュから得た **PRIVATE リポ名**の出現、(b) `check-secrets-not-tracked.mjs` と同じ秘密パターンの出現、を検査。visibility が取れなければ **exit 2（測れなかった）で deploy を止める**（分からない＝公開しない）。`npm run verify` と `deploy:site` の先頭に配線。`check-gates-are-wired.mjs` で配線漏れを検査

## C-4. 段階（1人が手を動かせる粒度）

| Phase | 内容 | 完了条件 |
|---|---|---|
| **0（30分）** | `gh repo create kimito-link/ai-hub --private` → push。既知の壊れた参照2箇所（`AI汎用ルール/`）を手で直す | ai-hub がGitHubに存在。`check-doc-rot --cross-repo` が赤→緑 |
| **1（半日）＝MVP** | `move-doc.mjs` 実装＋selftest → HOWTO 3本を `docs/ai-workflows/` へ → 2スキルのパス修正 → `github/CLAUDE.md` を橋渡し化（ロゴ節は `docs/brand/`、ドメイン節は削除）→ `web-ios-android/CLAUDE.md` 冒頭に知見の地図 | 旧パス参照0件、doctor緑、`/council-fable` が新パスで動く |
| **2（半日）** | `templates/skills/` 新設＋3スキル＋`check-skills-deployed.mjs`／`verify-deployed.mjs`＋`deploy:site` 配線／`check-public-safe.mjs`／`rules/` 生成器＋LP導線 | `deploy:site` 緑＝本番で `/rules/` が見える（実fetch照合） |
| **3（1日）** | `ai-generic-rules` の仕分け（B-5）。1ファイルずつ move-doc | ai-generic-rules がポインタREADMEのみ。global CLAUDE.md の参照更新 |
| **4（任意）** | github直下の残骸整理（C分類）。index.json が指す HANDOFF 3本は `ai-hub/history/` へ | doctor緑 |

各Phaseの終わりに `git push` → `npm run deploy:site` → 本番URL確認、を必ず行う（地雷2）。

---

# D. 偽陽性・事故防止の具体ロジック

## D-1. 参照修正漏れの機械検出（`grep -rn` 手作業の置き換え）

3つの既存/新設計器で三重に張る。どれも「新しい基盤」ではない。

1. **`check-doc-rot.mjs --cross-repo`（既存計器の拡張）** — 現在「`../other-repo/...` は検証しない」としている除外を、フラグ指定時だけ**親ディレクトリ基準で実在検証**に切り替える。`IGNORE_MENTION` の `AI_HARNESS_OPERATION.md`・`TOKEN_SAVING_POLICY.md` は Phase 3 で web-ios-android 内に来た時点で除外から外す。対象に `../CLAUDE.md`（橋渡し）と `~/.claude/skills/*/SKILL.md` を加える。**誤検知の抑え**: `../` で始まるパスのうち、存在しないリポ名を指すものだけを赤にし、散文中の「〜のようなパス」例示は既存ロジック通り検証しない
2. **`hub.mjs doctor`（既存）** — index.json の path 実在検査。移動のたびに叩く。move-doc.mjs の4段目に内蔵
3. **`move-doc.mjs` のゼロ確認（新設）** — 移動直後の旧パス残存検査。表記ゆれ4種

偽陽性の扱い: 「`COUNCIL-HOWTO.md` という語が履歴ログ（`ai-hub/history/`）に残っている」のは正しい状態。move-doc の検索対象から `ai-hub/history/` と `site/learnings/`（過去の事実を書いた文章）を**除外リストとして明示**する。除外は理由コメント必須（check-doc-rot の「緩めすぎるといつも緑」の教訓）。

## D-2. デプロイ確認の徹底（「push した＝反映された」の遮断）

- 生成器（`hub:page` / `shindan:update` / `rules:page`）が出力HTMLに `<meta name="build" content="<git short sha>+<ISO時刻>">` を焼く
- `templates/scripts/verify-deployed.mjs --url https://kimito-skill.link/rules/ --expect <sha>`: 本番を実fetchし、metaの sha がローカル HEAD と一致で exit 0、不一致 exit 1、fetch 不能 exit 2。Cloudflare の反映遅延を考慮し 30秒間隔×最大6回リトライ
- `deploy:site` の**最後**に配線。これで「`deploy:site` が緑」＝「本番に出ている」が初めて同値になる。`/deploy-site` スキルはこの結果を報告して終わる
- 未pushの検出: `deploy-site` スキルの先頭で `git status -sb` の ahead を見て、未pushなら止める（deploy自体はローカルファイルから上がるので技術的には通るが、「GitHubの正本と本番が食い違う」状態を作らないため）

## D-3. 「正本が2つ」の再発検出

`docs/ai-rules/` と `ai-generic-rules/AI汎用ルール_DeveloperPack_2525/` のようなコピー関係は、Phase 3 で片方を消すまでの間、`_docs/instruments/check-drift.mjs` の `PAIRS` に登録して差分を赤にする（既存の同期契約に乗せる。消した時点で PAIRS から外す）。

---

# E. MVP（最初の1手）

**`move-doc.mjs` を作り、それで HOWTO 3本を `web-ios-android/docs/ai-workflows/` へ移し、`github/CLAUDE.md` を橋渡しに痩せさせる**（Phase 1）。

理由:
- **効果が即日見える**: ユーザーが毎日使う `/council-fable` `/wayfinder-to-spec` の正本が git 管理下（今は履歴ゼロ）に入り、web-ios-android の中に「手順」の棚ができる
- **最も安全な実証台**: 参照先が実測で確定している（スキル2本・audit-skills・github/CLAUDE.md・index.json 2件）。道具が漏らせばすぐ分かる。ここで実証された道具が Phase 3（20リポが参照する ai-generic-rules）を安全にする
- **事故時の巻き戻しが容易**: 3ファイル＋数行の書き換え。`--stub` で旧パスも一時的に生きる
- Phase 0（ai-hub のリモート作成・壊れた参照2箇所の修正）は MVP の前提作業として同じ日にやる。30分で終わり、リスクがない

「地図の表をCLAUDE.mdに書くだけ」を MVP にしない理由: 所在を書いても物理的に散らばったままでは「開けば全部わかる」にならず、書いた地図自体が次のドリフト源になる。動かす道具が先。

---

# F. 捨てた案と理由

| 案 | 捨てた理由 |
|---|---|
| `ai-hub` を `web-ios-android/` 配下にネスト | 決着済み（2026-08-26）に加え、web-ios-android は PUBLIC で index.json は private リポ名だらけ。ネスト＝全公開。しかも ai-hub はリモート不在で、先にやるべきは保全 |
| `ai-generic-rules` をディレクトリごと `web-ios-android/docs/` へ `mv` | 約20リポ＋global CLAUDE.md の参照が一斉に壊れる（compass 事故の再来）。PRIVATE の中身を未仕分けで PUBLIC に出す。中身を1ファイルずつ仕分けて縮退させる方が、同じ結果に事故なく着く |
| `github/CLAUDE.md` を完全削除して web-ios-android に一本化 | Claude Code の親ディレクトリ探索で「まずどこを読むか」を伝える唯一の場所が消える。他リポでの作業中に web-ios-android の存在に辿り着けなくなる。薄く残す（≤30行・行数検査つき） |
| `web-ios-android/rules/` 等の新トップレベルディレクトリ新設 | 既に `docs/ai-rules/` が公開ルールの置き場として存在し、site からも参照されている。トップレベルを増やすと「docs と rules のどちらが正本か」がまた生まれる。既存の `docs/` 配下にサブディレクトリを足すに留める |
| ノウハウ本文をSKILL.mdに書き込む「太いスキル」 | SKILL.md が3つ目の正本になる。`~/.claude/skills/` は git 外なので腐っても気づかない。薄いポインタ＋`check-skills-deployed` に倒す |
| `rules/` ページを手書きHTMLで作る | md と HTML の二重正本。今回直そうとしているドリフトの site 版を作ることになる |
| 公開可否を手動 allowlist（YAML等）で管理 | `architecture-map-visibility.mjs` が既に `gh repo list` の一次情報で判定している。新しい権限台帳を作れば、その台帳が古びる |
| `web-ios-android/CLAUDE.md` 本体（300行超）の分割・再構成を今回同時にやる | 効果はあるが本設計の目的（散在の解消）と独立した大工事。混ぜると事故の切り分けができない。別お題として `/refactor-brief` にかける |
| 一括スクリプトで A〜C 分類を1回で全移動 | 参照書き換えの検証が一度に80ファイル分になり、赤が出たときどれが原因か分からない。Phase 分割＋move-doc で1件ずつ |

---

# G. 地雷と回避策（設計中に新たに見つけたもの）

1. **`github/` 直下は git ではない** — 今の CLAUDE.md・HOWTO・評価文書は OneDrive 同期だけが命綱で、誤上書き・誤削除の履歴が無い。回避: Phase 1 で web-ios-android か ai-hub の git 配下に入れる。橋渡しの `github/CLAUDE.md` だけは git 外に残るので、その内容のコピーを `web-ios-android/docs/ai-workflows/github-root-CLAUDE.md.example` として保持し、`check-drift.mjs` の PAIRS に登録する（橋渡しが消えても復元できる）。
2. **`ai-hub` がリモート不在** — PC故障で index.json 76件・kb 8本・agents が消える。回避: Phase 0 で private リポ作成＋push。以後の doctor に「remote 未設定なら警告」を1行足す。
3. **壊れた参照が既に緑で通っている** — `AI汎用ルール/` 参照2箇所が現存。`check-doc-rot` の `../` 除外が原因。回避: D-1 の `--cross-repo`。**この除外を外すとき、他リポの CLAUDE.md で大量に赤が出る可能性がある**（未確認）。最初は `--cross-repo` を警告（exit 2）で走らせ、件数を見てから赤（exit 1）に上げる。
4. **スキルの絶対パスは日本語＋`\`区切り** — `デスクトップ` を含むパスは PowerShell 経由で壊れる既知の地雷。move-doc.mjs は**純Node**でファイル読み書きし、シェルに日本語パスを渡さない。検索も `/` `\` 両方で行う。
5. **`--stub` の残置忘れ** — 旧パスに残したスタブが恒久化し「正本2つ」に見える。回避: スタブ本文に削除予定日を書き、`ai-hub/history/moves.log` に記録。`check-doc-rot --cross-repo` がスタブを検出したら「期限切れスタブ」として exit 2。
6. **公開可否判定の空振り** — `gh` 未認証・オフラインで visibility が取れないと `check-public-safe` は exit 2 で deploy が止まる。これは仕様（fail-closed）だが、ユーザーには「公開できない理由」ではなく「判定できなかった理由」と分かる文言で出す（りんく口調で「今はGitHubに聞けなかったので、念のため止めたよ」）。止まった理由が分からない検査は無視される。
7. **`ai-generic-rules` が PRIVATE である理由の未確認** — 中身に公開不可の情報があるから private なのか、単に既定値なのかを本設計では確認していない（`CLERK_X_LOGIN_PLAYBOOK.md` にのみ grep ヒットあり、未精読）。Phase 3 着手前に、10本の policies を `check-public-safe` にかけ、赤が出た文書は**ユーザーが目視で判断**する（AIが「たぶん大丈夫」で公開しない）。
8. **他セッションの並行稼働** — `kimitolink-linktree/CLAUDE.md` 等、他リポの参照書き換えは別セッションの未コミット作業と衝突しうる。回避: move-doc.mjs は他リポへの書き換え前に `git status --porcelain` を見て、**未コミット変更があるリポは書き換えをスキップし一覧に出す**（後で手で当てる）。web-ios-android 以外のリポへの `git commit` は move-doc から行わない（ユーザーがそのリポで確認して commit）。
9. **CLAUDE.md の肥大化** — 知見の地図（表8行）を足す一方、ロゴ節・ドメイン節の本文を web-ios-android/CLAUDE.md 側に**足さない**（既にある／`docs/brand/` へ）。CLAUDE.md は今回「表1つ増えて本文は増えない」を守る。
10. **`rules/` の公開で LP の CVR を落とす** — ルール全文を LP に直置きすると初見の人には重い。`rules/` は独立ページとし、LP には1ブロックの導線だけ（基準「売り方の品質」）。`llms.txt` には `rules/` を Canonical pages に追記し、AI 読者には全文への入口を与える。

---

## 実装引き継ぎ時に必ず実在確認するもの（本設計で参照した実パス）

- `web-ios-android/templates/diagnostics/check-doc-rot.mjs`（`IGNORE_MENTION`・`../`除外の実装箇所）
- `web-ios-android/scripts/lib/architecture-map-visibility.mjs`（`fetchVisibilityFromGitHub` / `isPublishable`）
- `web-ios-android/_docs/instruments/check-drift.mjs`（`PAIRS`）
- `web-ios-android/package.json`（`deploy:site` = `hub:page && shindan:update && deploy-cloudflare-pages.mjs --dir site`）
- `ai-hub/CLAUDE.md` L4（`../ai-hub-DESIGN.md` 参照）、`ai-hub/index.json`（`entries[].path`）
- `~/.claude/skills/council-fable/SKILL.md`、`wayfinder-to-spec/SKILL.md`、`audit-skills/SKILL.md`（絶対パス参照行）
- 未確認: `check_projects.sh` の被参照、`ai-generic-rules/docs/policies/` 各文書の公開可否、`--cross-repo` 有効化時の他リポでの赤件数

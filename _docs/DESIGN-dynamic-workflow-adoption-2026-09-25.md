# 設計書: dynamic workflow（Workflowツール）／並列セッション運用スタイルの採用可否

> **到達点**: 設計完了・MVP実施済み（`/config`でDynamic workflowをオフ化、
> `~/.claude/settings.json`に`"enableWorkflows": false`を確認済み）。
> 残タスクは`MULTI-BRAIN-HOWTO.md`への数行追記のみ。それ以外は不採用または「既に持っている」。
> 設計=Fable（claude-fable-5-1）／会議素材=無料会議ハーネス（4体+統合）／
> 裏取り=司令塔（web-ios-androidセッション）／日付=2026-09-25。
> 3段構えワークフロー（[COUNCIL-HOWTO.md](../../COUNCIL-HOWTO.md) /
> [FABLE-3STEP-HOWTO.md](../docs/ai-workflows/FABLE-3STEP-HOWTO.md)）の手順1〜2の産物。
> 実装ハンドオフ: [IMPLEMENTATION-HANDOFF-dynamic-workflow-adoption-2026-09-25.md](IMPLEMENTATION-HANDOFF-dynamic-workflow-adoption-2026-09-25.md)

## 用語（初出の言い換え）

- **dynamic workflow / Workflowツール**: Claude Code公式のマルチエージェント編成機能。
  プロンプトに"workflow"という単語が含まれると自動発火し、依存関係のあるサブエージェントを
  複数体同時に走らせる。このセッション自身が使っているツールと同一。
- **マルチ頭脳運用**: `docs/ai-workflows/tools/dispatch.py --brain <grok|qwen|oc|cf|local>`で、
  実装・調査・テスト追加等の定型作業をClaude以外の外部AIへ委譲する仕組み
  （[MULTI-BRAIN-HOWTO.md](../docs/ai-workflows/MULTI-BRAIN-HOWTO.md)正本）。
- **並列セッション協調プロトコル（Main-Write Pause）**: 複数のClaude Codeセッションが
  同じリポジトリで同時に動くときの交通整理。`.agent/coord.md`で管理する
  （CLAUDE.md本文に正本あり）。

## きっかけ

ユーザーがX上のインフルエンサー投稿（dynamic workflowの紹介）と、Claude Code作者
ボリス・チェルニー氏のインタビュー要約を提示し、「＋になれば採用したい」と依頼。
判断基準はCLAUDE.mdの設計方針「CVR/LTV最大化×100年メンテナンスのいらない設計」。

## 確定した事実（司令塔が実際に裏取り済み）

1. **dynamic workflow（＝Workflowツール）は公式に実在する機能**。Claude Code CHANGELOG
   2.1.156以降に記述あり。プロンプトに"workflow"という単語が含まれると自動発火する。
2. **★会議の統合結論に事実誤認があった**: 無料会議ハーネスの統合役（groq/gpt-oss-120b）は
   「Workflow keyword triggerが既に誤発火防止を実装しており、opt-inがデフォルトで安全」と
   繰り返し断定し、この前提の上で「段階的標準化」を推した。しかしCHANGELOG原文
   （`Added a "Workflow keyword trigger" setting in /config to stop the word "workflow"
   in a prompt from triggering a dynamic workflow`）を読むと意味は逆——この設定を
   後から追加しなければならなかった理由は、デフォルトでは"workflow"という単語だけで
   誤発火する問題が実際に起きていたから。「デフォルトで安全」ではなく
   「危険だったので追加の設定でオプトアウトできるようにした」という経緯。
   会議の統合結論（段階的標準化）はこの誤った前提の上に組み立てられており、**棄却した**。
3. **このセッション自身に与えられているシステム指示**は「Workflowツールは、ユーザーが
   明示的にopt-inした場合のみ使う」「デフォルトのworkflowサイズガイドラインはmedium
   （10体未満）」と明記——Anthropic自身が想定する既定の使い方は抑制的。
4. **このキットには既に2つの近縁機構がある**（マルチ頭脳運用／並列セッション協調プロトコル）。
   加えてFableの調査で判明した**3つ目の隣人**: 既に日常的に使っている**Agentツールの
   並列呼び出し**（このセッションでも複数回使用）。

## A. 4機構の関係整理（Fable設計）

| 観点 | Workflowツール | `dispatch.py`（マルチ頭脳） | `.agent/coord.md` | ★Agentツール並列呼び出し（既に日常使用） |
|---|---|---|---|---|
| 実行される場所 | 1つのプロンプト実行の内側 | Claude Codeプロセスの外側（別プロダクト） | 複数の独立したセッション同士 | 1プロンプト内で複数サブエージェント |
| 誰が編成するか | Claude（スクリプト） | 司令塔Claudeがコマンドで投げる | 人間 | 司令塔Claude |
| 財布 | **Claude週間上限×体数** | SuperGrok/Alibaba無料枠/Cloudflare無料枠/ローカル（Claude上限ゼロ） | 各セッション各自のClaude上限 | Claude週間上限×体数 |
| 目的 | 依存関係のある多段タスクの自動編成・resume | Claude上限の温存 | 正本を壊さない直列化 | 独立した調査・検品の同時実行 |

**結論**: 3機構（＋Agent並列呼び出し）はレイヤーが異なり重複はない。ただしWorkflowツールの
本当の隣人は`dispatch.py`でも`coord.md`でもなく、**既に毎日使っているAgent並列呼び出し**。
Workflowが上乗せするのは「依存関係グラフ」「resume」「スクリプトとして残る」の3点のみ。

**重要な非対称**: Workflowツールは**Claude上限を体数分だけ消費する**。これは
`MULTI-BRAIN-HOWTO.md`§1b「Claudeは考える、手は他の頭脳が動かす」（2026-09-15確立）の
**真逆の方向**に財布を動かす。

## B. 会議の誤診を踏まえた結論の再判定

**統合役（groq）の「段階的標準化」は棄却する。**

1. **前提が逆**（司令塔裏取り済み）: 上記2番の通り。
2. **このPCでも裏取り**: `~/.claude/`配下のJSONを`workflowKeywordTrigger|Workflow keyword|
   dynamic workflow`で検索した結果、該当キーは0件——**当PCは誤発火防止を有効化していない
   既定状態**。
3. **このキット固有の危険**: `templates/workflows/`・`docs/ai-workflows/`という
   "workflow"を含むパスが大量にあり、「release workflowを直して」等の日常プロンプトが
   誤発火リスクに最も晒される運用の1つ。

**「積極活用すべき」と結論づける根拠は見つからなかった。** Anthropic自身のシステム指示
（明示的opt-inのみ・既定サイズmedium）はコスト・暴走のガードレールと解釈するのが妥当。
100年メンテナンス観点でも、決定的スクリプト（`run-instruments.mjs`等）をLLMがその場で
編成するWorkflowに置き換えるのは再現性を下げ、Claude Codeバージョン依存を1つ増やす。

## C. Workflowツールの使いどころ（opt-in維持のうえで「使ってよい」条件）

標準化はしないが、禁止もしない。使ってよいのは次の4条件をすべて満たすときだけ:

1. 仕事の中身が「判断・検品」である（実装・ファイル量産なら`dispatch.py`へ）
2. 3体以上のサブエージェントに依存関係がある（独立ならAgent並列呼び出しで足りる）
3. 中断→再開が実際に必要な長さ（数分で終わるものはresumeの価値がない）
4. ユーザーが今回のプロンプトで明示的に「Workflowツールで」と言った

該当例（想定・未実証）: 出荷前に`store-guard`→`reality-checker`×プラットフォーム数→統合、
を1回で回す検品パイプライン。ただし実際に手間が痛くなった実損が出るまで作らない。

## D. チェルニー氏スタイルの仕分け

| 要素 | 判定 | 理由・このキットでの実体 |
|---|---|---|
| 複数セッション同時起動 | 既に持っている・不要 | 2026-09-07に「同時1セッション」鉄則を撤回済み。`.agent/coord.md`が交通整理 |
| 10〜15タブへ増やす | 不採用 | PC負荷実損（`~/.claude/CLAUDE.md`「PCが重い」節）。財布はClaude上限1本 |
| `/loop 5m /babysit`で見張りを外注 | 既に持っている・明文化だけ足す | `loop`スキル・`mcp__ccd_pr__set_monitor`・`job-runner.py`・`templates/workflows/`のpoll系が既に実体としてある |
| 「人間がオーケストレータ」になる | 不採用（方向が逆） | このキットの方針は「人間がやる必要のない作業はAIがすべてやる」。後退になる |
| セッションごとのworktree分離 | 既存で足りる | Agentツールの`isolation: "worktree"`＋coord.mdの規約で足りる |

## E. MVP（今すぐ着手する1件）

**`/config`で「Workflow keyword trigger」をオフにし、その事実と設定キー名を
`MULTI-BRAIN-HOWTO.md`§1dに記録する。**

選定理由: 唯一「＋」が確定している項目。`templates/workflows/`・`docs/ai-workflows/`という
パス名の存在から誤発火は構造的に起きやすく、事故が起きるまで待つ理由がない。
コストは設定1つと15行程度の追記。新規ファイル・新規Gate・新規スクリプトはゼロ。

実装手順は[実装ハンドオフ](IMPLEMENTATION-HANDOFF-dynamic-workflow-adoption-2026-09-25.md)参照。

## F. 捨てた案と理由

| 案 | 捨てた理由 |
|---|---|
| 段階的標準化（会議統合結論） | 前提「opt-inが既定で安全」が事実誤認 |
| `coord.md`に`babysit`セッションを組み込む（会議のnvidia案） | 見張りの実体は既に`loop`/`set_monitor`/`job-runner.py`にある。車輪の再発明 |
| Workflowツールを`dispatch.py`の`--brain`に追加 | レイヤーが違う（A表）。Claude上限を使うWorkflowを混ぜると道具の意味が壊れる |
| 検品パイプラインを先回り実装 | 実損が無い。「後で共通化」ではなく「痛くなってから作る」 |
| Workflow誤発火検出の`check-*.mjs`新設 | 検査対象が1PCの設定1キー。Gateを増やすコストに見合わない |
| CLAUDE.md本体への追記 | 1000行超で「埋没して守られない」実損済み（[DESIGN-claude-md-decay-2026-09-24.md](DESIGN-claude-md-decay-2026-09-24.md)）。頭脳使い分けの正本である`MULTI-BRAIN-HOWTO.md`に置く方が読まれる |

## G. 地雷と回避策

| 地雷 | 回避策 |
|---|---|
| 単語"workflow"での誤発火（`templates/workflows/`・`docs/ai-workflows/`が日常プロンプトに出る） | ★解決済み（2026-09-25実測）。`/config`「ダイナミックワークフロー」トグルをオフにし、`~/.claude/settings.json`に`"enableWorkflows": false`が書き込まれたことを確認。単語トリガーだけでなく機能自体が無効化されたため、単語誤発火のリスクは構造的に消えた |
| Workflowで起動したサブエージェントがcommit/pushしてMain-Write Pauseを破る | §1dに「サブエージェントは正本を動かさない」を明記予定 |
| `--brain qwen`等の内側でもWorkflowツールが発火し得る | 未確認。`dispatch.py`の`--allowed`既定はWorkflowを含まないため通常は抑止されるはずだが断定しない |
| `/loop`を安易に使ってClaude上限が1刻みごとに削れる | 「判断が要るときだけ`/loop`、要らないなら決定的ポーラ」の1行を§1dへ |
| 会議ハーネスの統合役が前提事実を検証せず断定する（今回発生） | 司令塔が一次情報で裏取りする運用は今回機能した。新ルールは増やさない |

## 未確認事項（2026-09-25更新: 1は確定、2は前提が変わり不要、3は未確認のまま残す）

1. ✅**確定**: `/config`のUI項目は「ダイナミックワークフロー」（日本語UI表記）。実際の
   `settings.json`上のキー名は`enableWorkflows`（boolean）。当初想定していた
   「Workflow keyword trigger」という単語トリガーだけを止める設定ではなく、
   **Workflow機能自体を丸ごとON/OFFする**、より単純で確実な設定だった
   （UIのトグル説明文: 「複雑なタスクに対して、Claudeが複数のエージェントを並列で
   実行できます。ワークフローは使用量の上限をすぐに大量に消費することがあります。」
   ——これはFableの分析B節「Claude上限を体数分だけ消費する」という指摘と完全に一致する）。
2. **前提が変わり実測不要に**: 単語トリガーの発火有無を確かめる計画だったが、機能自体が
   OFFになったため、そもそも"workflow"を含むプロンプトでWorkflowツールが起動する余地が
   ない。実測の必要性が消えた。
3. **未確認のまま**: 親セッション（司令塔）のツール一覧にWorkflowツールが実在するかは
   未確認。ただし`enableWorkflows: false`が有効な今、実在しても発火しない設計のはずで、
   優先度は下がった。

★教訓: 設計書執筆時点でUIの実際の項目名・トグルの説明文を見ずに「keyword trigger」という
CHANGELOGの語彙だけから設定の粒度を推測したのは、基準③「完膚なきまでの裏取り」的には
一歩甘かった。結果的に実際の設定はより単純（機能ごとON/OFF）で、狙い通りの効果
（誤発火防止）を上回る形で得られたため実害はなかったが、次回は「設定名の推測」ではなく
「実際のUIを一度見てから設計する」を優先する。

## 関連ファイル

- [IMPLEMENTATION-HANDOFF-dynamic-workflow-adoption-2026-09-25.md](IMPLEMENTATION-HANDOFF-dynamic-workflow-adoption-2026-09-25.md)（実装ハンドオフ）
- `docs/ai-workflows/MULTI-BRAIN-HOWTO.md`（§1dとして追記予定）
- [DESIGN-claude-md-decay-2026-09-24.md](DESIGN-claude-md-decay-2026-09-24.md)（CLAUDE.md本体に追記しない理由の根拠）
- 会議生データ: `../tsuioku-no-kirameki.com/council/auto/2026-09-25_01-16-42-fact.json`

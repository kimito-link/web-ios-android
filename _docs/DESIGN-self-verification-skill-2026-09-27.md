# 設計書: `docs/ai-rules/04_SELF_VERIFICATION.md` のSKILL.md化（Superpowers知見の最小取り込み）

> **状態: 完了（設計→実装→実地検証まで）。** 設計=Fable（council-fable 3段構えワークフロー手順2）／
> 会議での素材集め=13体マルチLLM会議ハーネス（手順1）／裏取り=司令塔（本文書作成者）／
> 日付: 2026-09-27。実装・実地検証ログは実装ハンドオフ側に集約（下記リンク）。
> 実装ハンドオフ: [`_docs/IMPLEMENTATION-HANDOFF-self-verification-skill-2026-09-27.md`](IMPLEMENTATION-HANDOFF-self-verification-skill-2026-09-27.md)（これから作成）

## きっかけ

ユーザーがLINE公式アカウント経由で受け取った特典教材（「Claude Code完全ガイド」PDF）で
Claude Codeの人気プラグイン「Superpowers」(obra/superpowers、GitHub実測29.2万スター・
インストール100万件超)を知り、「TDD・デバッグ・ブレインストーミング等をSKILL.mdとして
構造化する手法」がこのキットに取り込めないか検討を依頼された。調査の結果、Superpowers
本体の丸ごと導入は既存資産（council-fable・reality-checker・hooks群）との重複が大きく
不採用と判断したが、「自然言語規範文をSKILL.md（スラッシュコマンド化・AI自動発見）に
構造化する」という手法そのものは、このキットの`docs/ai-rules/`にまだ無い層であり、
検討する価値があると判断した。

## 会議（13体マルチLLM会議ハーネス、5体召集・5/6成功）の収束点

**多数決の結論**: `04_SELF_VERIFICATION.md`（計器の思想・6パターン）を
`.claude/skills/self-verification/SKILL.md`としてスキル化するのがMVP。
Superpowers本体の丸ごと導入は不採用（全員一致）。

**判断基準**（nvidia/nemotron-3-ultra-550bの整理を採用）:
「離散的な呼び出し瞬間があり、そこで人間が『やれ』と言わずともAIが自発的に実行すべき
プロセスか」

| 規範文 | 構造化価値 | 理由 |
|---|---|---|
| 01_CORE_RULES.md | 低 | 常時制約。hookで既に機械検査済み。スキル化は「呼び忘れ」の隙間を作るだけ逆効果 |
| 02_WORKFLOW.md | 中〜低 | council-fableが上流を、reality-checkerが下流をカバー済み。全体を1スキルにすると粒度が粗い |
| 04_SELF_VERIFICATION.md | 高 | 呼び出し瞬間が明確（検査を書く直前・人間に目視依頼しかけた瞬間）。「読んで覚えておけ」止まりで事故った実績あり |

## ★司令塔による裏取り（会議の主張を鵜呑みにしなかった点）

会議の統合役は「post-tool-useフックで自動トリガーさせれば記憶依存問題が解決する」と
主張したが、Claude Code公式ドキュメント(code.claude.com/docs/en/skills)を実際に
WebFetchで2回確認した結果、この主張は**不採用**とした。裏取りで判明した事実:

1. **スキルの呼び出しは3種類**: (a)ユーザーの明示的`/skill-name` (b)**AIの自動発見が
   デフォルト**——`description`の内容がAIに渡され、文脈から自律的に読み込む
   (c)`disable-model-invocation: true`でAI自動呼び出しを禁止しユーザー専用にできる。
   → hookでの機械的トリガーは本来不要。`description`の書き方でAIの自動発見精度を
   上げる設計に置き換えた。
2. **コンテキスト圧縮への対策も公式仕様に存在**: 自動`/compact`時、直近に呼び出された
   各スキルは要約後に再アタッチされる（スキルごと先頭5000トークン、全体25000トークン予算）。
3. **同名スキルの優先順位**: Enterprise > Personal(`~/.claude/skills/`) > Project
   (`.claude/skills/`)。実装時はこの順位を前提に設計する。
4. **descriptionの文字数上限**: `description`と`when_to_use`の合計で1,536文字
   （公式ドキュメント記載、実測ではなく一次情報からの引用）。
5. **プロジェクト内`.claude/skills/`は他リポジトリのセッションから見えない**
   （「このリポジトリのセッションのみ」と明記）。これによりFableの設計
   （repo正本＋`~/.claude/skills/`への設置コピーの2箇所配置）の必要性が裏付けられた。

## Fableの設計（司令塔が実在裏取り済みのファイルパスのみ採用）

### A. 理想の体験フロー

人間は何もしない。AIが「検査を作る／人間に見てもらおうとする」瞬間に、SKILL.mdの
`description`が現在の文脈と一致し、自動的に読み込まれて型を踏む。具体的な4場面:

1. AIが`verify-foo.mjs`/`check-foo.mjs`を新しく書こうとする瞬間
2. AIが「実機で確認してもらえますか」「スクショを送ってください」と書きかける瞬間
3. AIが「テストが緑なので完了です」と書きかける瞬間（→reality-checkerへ委任）
4. 「直したのに変わらない」が2回目になった瞬間

### B. 統合アーキ

**役割分担**（既存資産と重ならない線引き）:

| 層 | 実体 | 呼ばれる瞬間 |
|---|---|---|
| 常時制約 | CLAUDE.md／`docs/ai-rules/01`／`.claude/hooks/*` | ツール呼び出しごと |
| 上流の手順 | `council-fable`／`wayfinder-to-spec`スキル | お題が出たとき |
| **★作る側の型（新設）** | `self-verification` SKILL.md | 検査スクリプト・計器を書く直前／人間の目視を設計に入れそうになった瞬間 |
| 判定側 | `reality-checker`エージェント | 実装が終わった後 |
| 思想の正本 | `docs/ai-rules/04_SELF_VERIFICATION.md`＋`_docs/instruments/HANDOFF-new-app.md` | 読み物 |

会議は呼び出し瞬間を「実装直前・PR直前・デプロイ直前・障害時」と置いたが、
PR直前・デプロイ直前はreality-checkerの領分と重複するため、本設計ではSKILL.mdの
瞬間を「**検証手段を作る側**」に限定し、手順の最後でreality-checkerへ**渡す**（橋）
ことで重複を解消する。

**配置**（正本1つ・コピー散らさない。★2026-09-27裏取りにより「Personal優先」が
確認できたため、`~/.claude/skills/`側が実際に動作する主役、repo側は配布・共有目的）:

```
web-ios-android/
  docs/ai-rules/04_SELF_VERIFICATION.md        ← 思想の正本（変更なし。末尾に「入口はSKILL」1行だけ追記）
  _docs/instruments/HANDOFF-new-app.md         ← 実装手順の正本（変更なし）
  .claude/skills/self-verification/SKILL.md    ← ★新設・git管理・OneDrive共有。手順と参照だけ
~/.claude/skills/self-verification/SKILL.md    ← 設置コピー（Personal優先のため実際に動く側）
_docs/instruments/check-drift.mjs              ← PAIRSに1エントリ追加
templates/diagnostics/check-doc-rot.mjs        ← DEFAULT_TARGETSにSKILL.mdを追加
```

「新しい基盤か」の線引き: 増えるのはSKILL.md 1本・PAIRS 1行・DEFAULT_TARGETS 1要素・
04末尾の参照1行のみ。hook・Gate・エージェント・npm script・新ディレクトリ規約は増えない。

### C. 具体機構

**frontmatter**（自動発見の心臓部。実損の文言をそのまま入れ、抽象語より
「AIが今まさに書きかけている文」を列挙することで一致率を上げる）:

```yaml
---
name: self-verification
description: >-
  製品・スクリプトを「AIが人間に見てもらわずに検証できる形」で作るための型（計器の思想、
  docs/ai-rules/04_SELF_VERIFICATION.md の実行版）。次の瞬間に必ず使う:
  (1) verify-*.mjs / check-*.mjs / lint-* / gate / 診断スクリプトを新しく書く・書き直す直前
  (2) 診断ページ・デバッグ表示・status:live・ログ計測・「検知N→処理N→出力N」の数え上げを製品に足すとき
  (3) 「実機で見てきてください」「スクショを送って」「押してみて」「反映されたか確認して」と
      人間に頼む文を書きかけたとき
  (4) 「動くはず」「テストが緑」「修正完了」で報告を締めようとするとき（→末尾でreality-checkerへ渡す）
  (5) 「直したのに変わらない」「原因が特定できない」が2回目になったとき。
  対象外: 既にある差分の合否判定だけ（reality-checkerへ）、要件定義（council-fable）、
  ストア提出（store-guard）、単発のGrep/調査。手順は6段・出力は計器表1枚。
---
```

設計上の要点: `disable-model-invocation`は書かない（既定=自動発見ON）。長さは
既存グローバルスキル18本と同水準（400〜600字）。1536字上限（description+when_to_use
合計、公式仕様確認済み）を超えない。

**本文**（≤80行・思想はコピーしない・手順6段）:

```
# self-verification — 検証可能な形で作る（6段）

正本: docs/ai-rules/04_SELF_VERIFICATION.md（思想）／_docs/instruments/HANDOFF-new-app.md（実装手順）
★内容が変わったら正本を直す。このファイルに思想をコピーしない。

## 0. 対象確認（10秒）
- いま作る/書きかけているものは「検査・計器・人間への目視依頼・完了報告」のどれか → どれでもなければ終了
- 既にある差分の合否だけ知りたい → reality-checker へ委任して終了

## 1. 既存を探す（新しく書く前に）
- node "<github>/ai-hub/bin/hub.mjs" find --tag verify,instrument,diagnostics（ヒット0=正常）
- Grep: 対象リポの scripts/ と templates/diagnostics/ に同名・同目的の verify-*/check-* が無いか
- 同等があれば再利用。無ければ 2 へ

## 2. 土台を借りる（自作しない）
- import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs'
- 無いリポなら templates/scripts/lib/instrument-core.mjs をコピーし check-drift.mjs の PAIRS に登録
- 3値exit（0/1/2）・passにはevidence必須（無いとinconclusiveに自動降格）・--selftest実装・limitation明記

## 3. 6パターン照合（該当を選ぶ・未適用は「未適用」と書く）
| # | パターン | この対象に |
| 1 | 計器（全数を段階ごとに数える・遅延ms） | 適用/未適用/対象外 |
| 2 | 嘘をつかない診断（実際に起きたものだけ・失敗は内訳・provenance） | |
| 3 | 決定論+依存注入（乱数/時刻/I/Oは引数） | |
| 4 | リモート読取（status:live型・dirty check） | |
| 5 | 工程ガード（check-tracked-imports・版焼き込み） | |
| 6 | メタ診断（静的ソーススキャンで登録漏れを物理的に不可能に） | |

## 4. 人間を検証ループから外す
- 人間に残してよいのは (a) 権限操作（最終リロード等） (b) 官能評価（音・体感）だけ
- それ以外の「見てきて」は、Browser pane／CI／status:live のどれかで自分が測る形に置き換える
- 画面を渡さざるを得ないなら docs/ai-rules/05_HANDING_SCREEN_TO_HUMAN.md の型で

## 5. 配線（作っただけは0点）
- package.json / diagnostics/run.mjs / CI のいずれかに登録
- node templates/diagnostics/check-gates-are-wired.mjs と check-runner-registers-all.mjs を実行
- 実行して赤/黄/緑を1回見る。「0件の緑」は inconclusive

## 6. 判定は自分でしない・記録して終える
- reality-checker へ「何が動いていると主張しているか」を1行で渡し、判定表を受け取る
- node scripts/context-engine.mjs --record --status confirmed|pending ... で台帳へ
- 完了報告には下の計器表を必ず貼る

## 出力契約（この形以外で「できました」と言わない）
| 作った検査/計器 | exit(0/1/2) | evidence | selftest | 配線先 | 未適用パターンと理由 |
```

**既存検査への登録**（2行）:
- `check-drift.mjs` PAIRS: `{ label: 'self-verificationスキル', canonical: resolve(KIT_ROOT, '.claude/skills/self-verification/SKILL.md'), copies: [resolve(homedir(), '.claude/skills/self-verification/SKILL.md')] }`
- `check-doc-rot.mjs` DEFAULT_TARGETS: `.claude/skills/self-verification/SKILL.md`を追加

### D. 偽陽性／呼び出し忘れ潰しの具体ロジック

**呼び出し忘れ（本命の地雷）への対処**:
1. descriptionに「書きかけている文」を入れる（自動発見は文脈一致なので第一防衛線）
2. 本文を短く保つ（≤80行≒3000トークン。compact再アタッチの5000トークン予算内に収める）
3. 出力契約で「呼んだのに読んだだけ」を可視化（計器表が報告に無い＝スキルを踏んでいない、
   と機械的に判別できる）
4. 04末尾に「入口: `/self-verification`」の参照1行を追記
5. **測ってから増やす**: 実装後、`verify-*/check-*`を新規作成したセッション3回分の
   transcriptでSkill呼び出しの有無を確認する。3回中2回以上落ちていたら、初めて
   `check-ask-preceded-by-research.mjs`と同型の非ブロッキング警告hookを検討する。
   **MVPには入れない**（「増やす前に測る」原則）。

**偽陽性（呼びすぎ）への対処**: 手順0の対象確認で10秒で早期退出。descriptionの
「対象外」列挙でreality-checker／council-fable／store-guardの領分を明示的に除外。

**名前衝突**: 2026-09-27の裏取りにより、Personal(`~/.claude/skills/`)が
Project(`.claude/skills/`)より優先されることが確認済み。同名時は`~`側のみが
実行され、二重表示等の問題は起きない設計（仕様上の優先規則で解決済み、実装フェーズでの
確認は不要になった）。

### E. MVP（成果物: SKILL.md 1本）

| # | 作業 | ファイル | 確認方法 |
|---|---|---|---|
| 1 | SKILL.md作成 | `web-ios-android/.claude/skills/self-verification/SKILL.md` | 80行以内・04と共通する文が3行以上ないこと |
| 2 | 設置コピー | `~/.claude/skills/self-verification/SKILL.md` | キット外リポ（例:`github/line-bot`）でセッションを開き`/self-verification`が解決する |
| 3 | PAIRS登録 | `_docs/instruments/check-drift.mjs` | `node _docs/instruments/check-drift.mjs`がexit 0 |
| 4 | doc-rot対象追加 | `templates/diagnostics/check-doc-rot.mjs` DEFAULT_TARGETS | `node templates/diagnostics/check-doc-rot.mjs --file .claude/skills/self-verification/SKILL.md`がexit 0、参照1つを故意に壊してexit 1になること |
| 5 | 04末尾に参照1行 | `docs/ai-rules/04_SELF_VERIFICATION.md` | 規範文ではない（hookが警告しない）ことを確認 |
| 6 | 自動発見の実地テスト | — | 新セッションで「`scripts/verify-foo.mjs`を作って」と依頼し、`/`を打たずにスキルが読まれるかtranscriptの`tool_use`で確認。読まれなければdescriptionを「書きかけの文」寄りに直して再試行（最大3周） |
| 7 | 記録 | `context-engine.mjs --record` ／ `ai-hub` harvest | 6の結果をconfirmed/pendingで台帳へ |

**機械的な完了判定**: 表の確認方法列がすべて事実（コマンド出力・transcript）で埋まる。
1つでも「たぶん」なら未完了。

**やらないこと（MVP外）**: 01/02/03/05のスキル化、警告hookの新設（D項の条件を
満たしてから）、templates/への配布金型化、複数スキルへの分割。

### F. 捨てた案と理由

| 案 | 理由 |
|---|---|
| Superpowers丸ごと導入 | 会議全員一致。既存のhook／agent／ai-hubと役割が丸ごと重なり正本が2系統になる |
| hook（PostToolUse）でスキルを機械的に発火 | 公式仕様上、descriptionによる自動発見が標準機能で同じ役割を担う |
| 01/02/03のスキル化 | 01は常時制約でhookで既に検査済み。02は上流council-fable・下流reality-checkerが既にカバー。03はreality-checkerの領分 |
| 6パターンを6本のスキルに分割 | 呼び出し瞬間は共通。分割するとdescriptionが競合し発見精度が落ちる |
| reality-checkerに統合（スキルを作らない） | agentはEdit/Write権限を持たない判定役。「作る側の型」を判定役に持たせると自己採点の分離が崩れる |
| SKILL.mdに04の本文を丸ごと転記 | コピー＝ドリフト対象。compact再アタッチの5000トークン予算にも収まらない |
| `disable-model-invocation: true`で人間専用に | 「人間が『やれ』と言わずとも実行すべきプロセス」という判断軸に反する |
| グローバルのみ配置 | AI共通ルールをgit外に置くことになり多PC共有ルールに反する。repo正本＋設置コピーで両立 |
| プラグイン／marketplace化 | 新しい配布機構。1本のためには過剰 |

### G. 地雷と回避策

1. **SKILL.mdが「04の第2コピー」になる**: 本文は手順・コマンド・参照だけに限定。
   完了判定で「04と共通する文3行以上=NG」を確認
2. **設置コピーがノートPCに無い**: PAIRS登録でcheck-driftが「repo側にあるのに
   `~`側が無い/古い」を検出する
3. **同名スキルの二重読込**: 2026-09-27裏取りで解決済み（Personal優先が公式仕様）
4. **descriptionの長さ**: 1536字上限（公式）、既存18本水準の400〜600字に収める
5. **compactで本文が切れる**: 5000トークン/スキル予算。80行を守る。出力契約は
   本文冒頭にも1行置く
6. **check-doc-rotが絶対パスを解決できない**: SKILL.md内の参照はリポ相対で書く
7. **日本語・空白パス**: コマンド例は必ず引用符付き
8. **「読んだだけ」で終わる**: 出力契約の計器表が無い報告はreality-checkerが
   inconclusiveにできる
9. **hookとの干渉**: `check-new-rule-has-machine-check.mjs`は`docs/ai-rules/`と
   `CLAUDE.md`が対象で`.claude/skills/`は対象外。ただし04末尾へ足す1行が
   「〜すること」形だと警告されるため「入口: `/self-verification`」の名詞形で書く
10. **測らずにhookを足す誘惑**: D項の「3セッション中2回以上の取りこぼし」を
    満たすまで足さない

## 関連ファイル（実在確認済み、2026-09-27）

- `docs/ai-rules/04_SELF_VERIFICATION.md`／`docs/ai-rules/05_HANDING_SCREEN_TO_HUMAN.md`
- `_docs/instruments/HANDOFF-new-app.md`／`_docs/instruments/check-drift.mjs`／`templates/scripts/lib/instrument-core.mjs`
- `templates/diagnostics/check-doc-rot.mjs`
- `.claude/hooks/check-ask-preceded-by-research.mjs`
- `~/.claude/agents/reality-checker.md`（既存の判定役エージェント）

## 出典

- 会議ハーネス生ログ: `tsuioku-no-kirameki.com/council/auto/2026-09-27_13-50-28-design.json`
- Fable設計フルテキスト: このセッションのAgentツール呼び出し結果（2026-09-27）
- Claude Code公式スキル仕様: https://code.claude.com/docs/en/skills （WebFetch 2回、2026-09-27）

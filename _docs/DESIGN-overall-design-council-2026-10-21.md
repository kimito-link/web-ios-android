<!-- 役割: web-ios-android キット「全体設計」会議の決定書。なぜ要るか=全体設計の根本問題の裁定と
     理想像を、次のAI・人間が再調査せず実装へ入れる形で1枚に残すため。使い方=実装前にこの決定と
     バックログ(§7)を読む。実装は別タスク(本人承認・guard-external-actions gate 前提)。 -->

# DESIGN: キット全体設計 会議決定書 (2026-10-21)

**状態ラベル: 設計完了・実装未着手**（会議の裁定のみ。site/CLAUDE.md の編集・デプロイは本人承認待ち・
`guard-external-actions` が外向き操作を拒否する）。

## この文書の読み方 / 入口

- これは「全体を調査→会議(council-fable式)」で得た**設計判断**の正本。実装手順書ではない。
- 関連: [`_docs/DESIGN-claude-md-decay-2026-09-24.md`](DESIGN-claude-md-decay-2026-09-24.md)（decay の先行設計）／
  [`_docs/DESIGN-self-improvement-loop-2026-10-18.md`](DESIGN-self-improvement-loop-2026-10-18.md)／
  [`docs/ai-workflows/COUNCIL-HOWTO.md`](../docs/ai-workflows/COUNCIL-HOWTO.md)・[`FABLE-3STEP-HOWTO.md`](../docs/ai-workflows/FABLE-3STEP-HOWTO.md)。
- 設計の背骨は**「100年後も安心＝根本解決」**: 文章を足さず、既存部品を境界に接続し、可逆で、外しても害が無い
  構造不変量にする（本人指示 2026-10-21）。

## 会議の構成（どう回したか）

- 方式: wayfinder 地図（司令塔が実コード裏取り）→ **4エンジニアリング・レンズ**（プロンプト/コンテキスト/
  harness/ループ）で**6役の会議**（統括・発散①②③④・批判）→ **Fable 裁定** → 司令塔が全主張を実コードで再裏取り。
- 参照設計を3つ注入: **surechigai**（優秀な実装の設計思想）・**XYEval**（悪い助言にYesと言わない）・
  **UI/UX 6観点**（LP評価ルーブリック）。
- ★**単一ベースモデルの注記**: 6役は同一ベースモデル＝**収束は弱い証拠**（同一prior）、**批判の穴と相互矛盾こそ強い信号**
  として扱い、司令塔が全ファイルパス・行を実コードで確認してから採用した。

## 観測（確定事実・ファイルパス付き・会議の観測の訂正を含む）

- `CLAUDE.md`=1,345行、`core:end` マーカーは **L431**（核≒96% of 450予算）。直後 L431-434 のコメントが**既に
  「核に足すときは実損を site/learnings/・_docs/ へ移し規範と検査の入口だけ残す」剪定規則を書いている**（＝守られていない）。
- 予算検査 [`templates/diagnostics/check-claude-md-budget.mjs`](../templates/diagnostics/check-claude-md-budget.mjs) は
  `measureCore()`(L23)・`judge()`(L30)・`DEFAULT_CORE_MAX=450`(L19) を**実装済み・selftest あり**。だが `run.mjs` 診断どまりで、
  `.claude/settings.json` の hook に**未配線**（VERIFIED: grep 0件）。
- `.claude/settings.json` に配線された hook は**8本**。**ブロッキングは3本**（司令塔の当初「2本」は誤り）:
  [`require-claude-md-read.mjs`](../.claude/hooks/require-claude-md-read.mjs)(L88 `deny`)・
  [`guard-external-actions.mjs`](../.claude/hooks/guard-external-actions.mjs)(拒否)・
  [`check-ask-preceded-by-research.mjs`](../.claude/hooks/check-ask-preceded-by-research.mjs)(**L153 `permissionDecision:'deny'`**＝理由タグ無しの AskUserQuestion を拒否)。残り5本は非ブロッキング警告。
- 判定部品は [`.claude/hooks/lib/transcript-reads.mjs`](../.claude/hooks/lib/transcript-reads.mjs)(L161-174) に1つ。`coreOnly=true` 既定で core:end まで。
- `site/index.html` L622-624 ヒーローh1=役①「アプリを作るアプリ／面倒な手続きをAIが肩代わり」。役②（横断開発基盤・4基準・5類型・decay機構）は L644 の .hero-note 3リンクへ縮小。L665-674 の hint-box は「『アプリを作るアプリ』…じゃないよ！」と否定で始め、結局ストア申請を再説明（役②は出さない）。
- **`site/lp/index.html` は独立した第3の提供物**（VERIFIED: L6「App Launch Accelerator」・description「事業者様向け…まとめて代行します」・self-canonical）。sitemap-manifest.json にも sitemap.xml にも**無い**、`index.html` からの参照**ゼロ**、vercel.json に除外なし＝配信はされる。→ 会議の観測「sitemap-manifest に載る（半孤児）」は**誤り**。実態は「配信中・未リンク・未掲載・未計測の B2B 代行LP」。
- 機能・診断レイヤーは `site/claims.json`（9主張: 3自動/3補助/3手動）＋検証スクリプト＋3実測パネルで正直に可視化（**強み**）。
- `decisions.jsonl` は実ファイルとして存在しない。[`templates/scripts/loop-run.mjs`](../templates/scripts/loop-run.mjs) L127 と `_docs/SPEC-loop-ledger-and-proposal-v1.md` で**仕様化済みの実行時パス**。
- `.claude/hooks/manifest.json` は未存在（提案物）。`web-ios-android-relay.mjs` は CLAUDE.md が言及するがリポに**実体なし**。
- `docs/ai-rules/` と `docs/ai-workflows/` は**自動ロードされない**（Claude Code は CLAUDE.md＋祖先のみ）。

## 裁定（真因と見立てA/B/C）

**真因（採用）**: 「全体設計の根本問題」は「玄関取り違え」でも「decay」でもなく——
**キットのあらゆる面が『足す』だけで、満たされないとき“何が退行して続行し／何が明瞭に止まり／何が台帳に残るか”という
故障モードを宣言・強制せずに出荷していること**（surechigai の最深原則の未適用）。Fable の鋭化: キットは
この原則を**事故ごとに3回局所発見**（2026-10-06 warn→拒否／2026-10-18 選択肢→理由タグ拒否／2026-10-19 core:end）
しているのに、**「新しい境界は故障モードを宣言して出荷する」という設計不変量にしていない**＝「故障モードを事故から学び、
設計から学ばない」。

- **見立てA（玄関取り違え）**: 症状として採用・**原因としては棄却**。LPヒーローは自助キット購買者（人間）に正しく向く。
  真の取り違えは「3提供物があるのに、どの面がどの読者に向くかを**どこも宣言していない**」こと（`site/lp/` が最も純粋な例＝
  配信中なのに掲載/非掲載を宣言していない未宣言境界）。
- **見立てB（読んだ≠守った / decay）**: **採用**。「守った」は構造的に測れないが「**悪化していない(ratchet)**」「**証跡が残った(receipt/provenance)**」は測れる、という発散③のメタ結論を正式採用。発散④の「結末台帳が無いので FP率も閾値も調整不能＝計測不能ゆえ腐る」も採用。
- **見立てC（玄関取り違え＝decay＝同じ病）**: **統一原因としては棄却・原則レベルでのみ採用**。LP＝人間CVR面（処方=証拠付きで伝える）、核＝AIコンテキスト面（処方=削る）で**処方が正反対**。1つの病に括ると治療が打ち消し合う。両者を結ぶのは §統一原則の一文だけ。

## 理想像（4レンズ・1つの一貫モデル）

前提: 批判⑤を採用——レンズは直交 regime でなく**提示グリッド**。各修正は**一度だけ実装し複数レンズにタグ付け**（二重計上を防ぐ）。

**三分法を全面に敷く**（役①/役② の二分法を廃し、各面に読者と宣言すべき故障モードを割り当てる）:

| 提供物 | 読者 | 面 | 宣言すべき故障モード |
|---|---|---|---|
| 自助キット（役①） | 人間の個人開発者 | `site/index.html`・`claims.json`・実測パネル | 証拠の無い主張は出さない（既存 provenance ゲート） |
| AI横断心臓部（役②） | `@import` で読む AI | `CLAUDE.md` 核・`site/hub/` | 核が予算超過なら Edit を拒否（ratchet） |
| B2B代行（第3） | 事業者 | `site/lp/` | 掲載/非掲載を宣言し、未宣言の配信を検査で落とす |

- **プロンプト工学**: **役②主役化は KILL**（批判が正しく、発散①の「事実宣言バンドへ格上げ」も棄却）。理由(i)役②の読者はLPに来ない（`@import`でCLAUDE.md直読）(ii)格上げしても hub/ がnoindex・公開クローンから再生成不能＝**約束を見せられない**（＝発散①自身がhub index化を棄却した論理が自案にも当たる）。**残す**: 役①ヒーロー（証拠付き）＋.hero-note の役②最小ポインタ（正しい玄関は CLAUDE.md先頭と hub/）。**変える**: L665-674 の否定形 hint-box 廃止（離脱要因・役②も出していない＝CVR純改善で両役一致）。**XYEval 一文**（「渡された原因は誤りうる。先に問題そのものを確かめよ」）を `ai-instructions.json` の `_preamble` 1キーに置き `site/scripts/ai-box.js` が全スロット先頭へ注入（**単一typed契約**。13箇所個別追記は drift で棄却）。核 L14-33 には**行数純増ゼロ**で既存文の言い換えに吸収。**数値 67.4→36.0% は使わない**（裏取り不能＝アンカー）。
- **コンテキスト工学**: 核を「**RULE / CHECK / EVIDENCE の型付きインデックス**」へ。EVIDENCE 行は日付＋`site/learnings/` リンクだけ、本文は核外へ**移設（削除でなく relocation＝対策Bの日付保全と両立）**。`docs/ai-rules/` への externalize は棄却（自動ロードされず埋没悪化）。「核へ1本入れたら実損1本退去」は**規則文でなく ratchet hook の拒否メッセージとして配達**（L431-434 が既に文章で書いて守られていない実証）。JIT注入三層（常時ロード核／着手直前の該当節注入／検索任せ）は方向採用だが**P1で核が痩せた後に設計**（先にやると「注入があるから核に足していい」の口実になる）。
- **harness工学**: **ratchet budget hook が最重要の第一手**。`PreToolUse(Edit|Write)` で対象が `CLAUDE.md` のとき、編集後テキストで `check-claude-md-budget.mjs` の `judge()` を**import（複製しない）**。`核>450 かつ pre より増` → deny（移設先を案内）、`核>450 だが減少中` → warn、`≤450` → 通す（「減らす間はwarn・増やすならblock」）。★**会議が未解決だった穴**: マーカーを上へ動かすだけで核行数が減る gaming → ratchet に「マーカーが上がった行数 > 実削除行数なら deny」を足す。commit時block は棄却（edit面fail-fastの方が迂回しにくい）。**LLM-judge conformance hook は棄却**（同一モデル自己採点・非決定flaky・XYEvalの示す9割rubber-stamp）。honesty-gap（`GATE_BYPASS_APPROVED_BY_USER`・理由タグ）は gate で真偽判定せず**durable 監査証跡＋ランダム抽出の非同期監査**（reality-checker）へ。致命/退行可を宣言: ブロッキング3本＋ratchet は fail-closed、警告系は fail-open（surechigai の sentinel）。
- **ループ工学**: **結末台帳**は新設せず `loop-run.mjs` L127＋`SPEC-loop-ledger-and-proposal-v1.md` の既定パスを唯一の台帳に。記録は**ブロッキング3本＋ratchet のみ**（8本全部は致命/退行可の区別違反）。冪等キー `(session_id, tooluse_idx)`、設計採否は `(proposal_id, build_id)`。週次少量の人手ラベル→FP率→閾値調整（Ollama 7B 自動は質不足で棄却）。**manifest-dispatcher**: `.claude/hooks/manifest.json` を正本に、settings.json は event ごと1行へ畳む（新PCが clone だけで配線復元・`web-ios-android-relay.mjs` の実体をリポへ）。council-fable 正本は新ファイルを作らず `FABLE-3STEP-HOWTO.md` にハンドオフ契約節を追記（正本散在を増やさない）。

## レンズ横断の統一原則（1文）

**キットのあらゆる面（LP・核・hook・ループ）は、新しく何かを足すとき「それが満たされないときに何が退行して続行し、
何が明瞭に止まり、何が台帳に残るか」を同時に宣言して出荷する——宣言の無い追加は、surechigai が境界で禁じた
『未定義動作』と同じである。** これが「100年後も安心＝足すたびに腐らない」設計の核。

## 順序の原則（依存ゲート・根底から積む）※本人提起 2026-10-21「根底が大事」

上の統一原則が**空間方向**（各境界が故障モードを宣言）なら、こちらはその**時間方向の双子**。
**全体設計は「何を足すか」より「どの順で足すか」で成否が決まる。** バックログ(§7)はメニューではなく
**依存チェーン**であり、順序を破ると後続が無駄になる（または害になる）。

- **根底（第一手）を最初に据える**: このキットの病は「足すだけ」。だから**ラチェット（P0）という“止める床”を先に敷かない限り、
  P1〜P10 の追加は全部その病で核へ吸収される**。会議の最重要結論は実は順序の主張だった——「根底が大事」はこの一点を指す。
- **各追加は2つを宣言して出荷する**: (1) 故障モード（満たされないとき退行/停止/記録）＝統一原則、(2) **前提と順序**
  （何が先に在るべきか・順序を破ると何が壊れるか）＝本原則。片方だけの追加は不完全。
- **surechigai も順序設計**: 安価フィルタ→高コスト geo の順（bbox 前フィルタ）、tier フォールバックの段階順＝「いきなり高コスト／
  いきなり広域」をやらない。順序そのものが設計。
- **依存ゲートを図にする**（tsuioku の §12.6「フェーズ・フロー図正本」の思想を全体設計へ）: 各項目に
  「この前提が崩れると以降が無駄」を矢印で明示し、盲目的な後続着手を止める。バックログの依存は既に P1⊃P0・P8⊃P3・P10⊃P1。

★この順序原則は機械検査にも落ちる: 後続項目（例 P1 の relocation）は**先行項目（P0 の ratchet）が配線済みであることを
前提条件として宣言**し、未配線なら着手を警告する（依存ゲートの fail-closed）。「順番を破らない」を文章でなく門にする。

## 優先度つきバックログ（実装は別タスク・本人承認・`guard-external-actions` gate 前提）

| # | 項目 | レンズ | 可逆 | 機械検査 | 工数 |
|---|---|---|---|---|---|
| **P0** ✅ | **ratchet budget hook**（`judge()` を import・Edit/Write 境界・増なら deny/減なら warn・マーカー移動 gaming 検知込み）。**完了 2026-10-21**: `.claude/hooks/check-claude-md-budget-ratchet.mjs`＋`.test.mjs`(14緑)、settings.json 配線、実 CLAUDE.md で E2E 確認(431→461増は deny) | harness+context | 可(配線1行外す) | 可 | S(半日) |
| P1 | 核の relocation（日付実損を `site/learnings/`・`_docs/` へ移設、核に RULE/CHECK/EVIDENCE 行だけ残す）。P0 後に行い痩せた核を ratchet で固定 | context | 可(git) | 可(budget判定) | M |
| ~~P2~~ ✅(方針転換) | manifest-dispatcher は**不採用**（claude-code-guide で裏取り: 公式 hook は並列実行・deny>defer>ask>allow の合成・statusMessage/source 属性/重複排除を dispatcher で再現できず、安全足場を畳むのは退行リスク）。配線ドリフト検知の**意図はリポに既存**（`templates/diagnostics/check-hooks-wired.mjs`＝孤児hook検出A＋グローバル未反映検出B・`run.mjs` 登録済み）。**完了 2026-10-21**: 不足していた npm script(`check:hooks-wired`/`:selftest`)の配線だけ追加（134ddb6）。全9本 hook 配線済み・孤児0を検証。★自己検証違反(既存未検索で新規作成→退行)を git restore で是正・報告済み | harness | — | 可 | S |
| P3 ✅ | 結末台帳（ブロッキング3本＋ratchet の deny を `_loop/hook-outcomes.jsonl` へ追記・冪等キー・schema・観測専用fail-open）。**完了 2026-10-21**: `.claude/hooks/lib/outcome-ledger-core.mjs`(純関数)＋`record-outcome.mjs`(I/O・絶対に投げない)＋`.test.mjs`(23緑)、4 hook の deny 点に配線、E2E で deny不変・冪等・fail-open 確認。★council の冪等キー `(session_id, tooluse_idx)` は**実測で訂正**: 公式仕様確認で PreToolUse はネイティブ `tool_use_id` を持ち transcript は非同期で遅れる（番号を数える方式は不安定）と判明→鍵は `(sessionId, toolUseId, hook)`。★100年設計ハードニング(2026-10-21): 冪等判定は台帳全文を読まず**末尾64KiBだけ走査**(重複は時間的に隣接＝session-local なので正しい)。追記は壊れにくい追記専用のまま、読みだけ定数コスト化＝deny が増えても安全足場に遅延 decay が溜まらない(`readLedgerTailText`・`record-outcome.test.mjs` 28緑) | loop | 可 | 可 | M |
| P4 ✅ | `site/lp/` の掲載/非掲載を宣言＋「配信中なのに未宣言の HTML」検査。**完了 2026-10-21**: manifest に `unlisted[]` を新設し `lp/`(audience:b2b・理由つき)を宣言、`scripts/verify-served-html-declared.mjs`(3値exit・pure judge・selftest・配信30ページ検査)＋`.served-html-baseline.json`(hub×3・api-projects を据え置くラチェット)、`site:served-declared:selftest` が verify-all に自動ゲート収集(31件)されることを実測確認 | prompt | 可(git) | 可 | S |
| P5 ✅ | `_preamble` 単一注入（ai-instructions.json 1キー＋ai-box.js）＋描画先頭にある test。**完了 2026-10-21**: `_preamble`(XYEval『見立ては誤りうる・先に問題を確かめよ』の1文)を追加、`ai-box.js` の `composeCopyText()` が全 ai-box の指示文先頭へ注入(DOM配線は `typeof document` guard・純関数は CJS export)、`site/scripts/ai-box.test.mjs`(6緑・実データ結合で全エントリ先頭が preamble を確認)。※核 L14-33 への一句吸収は核 churn 回避のため見送り(preamble の動作には不要) | prompt | 可 | 可 | S |
| P6 ✅ | index.html の否定形 hint-box 廃止。**完了 2026-10-21**: hero の H1(「アプリを作るアプリ」)を直下で否定する自己矛盾文「『アプリを作るアプリ』…じゃないよ！」を削除し、肯定の定義文へ(りんくの声・CSSクラス維持)。役②は主役化せず hero-note のリンクのまま | prompt | 可 | 不可(CVRは実測パネル) | XS |
| P7 ✅ | warn-long-running を「1回/セッション＋台帳記録」へ縮退。**完了 2026-10-21**: `tmpdir()/claude-hook-markers/warn-long-running/<session_id>.json` を印にし初回だけ出す(中身が「いつ・なぜ出したか」の記録=台帳。P3のブロッキング専用台帳とは混ぜない)。`sanitizeSessionId`/`markerPathFor` 純関数化＋`isMain` guard、`warn-long-running-session.test.mjs`(4緑・2回起動で二度目が黙る E2E) | harness | 可 | 可 | S |
| P8 ⏸保留 | commit-verification を product surface 限定で block 昇格。**意図的に未着手(2026-10-21)**: P3 の結末台帳は配線済みだが deny の実データがまだ0件＝FP率を出せない。block 昇格はデータ無しでは誤爆リスクが読めないため、順序原則どおり P3 のデータが数件溜まり人手ラベルが付くまで待つ(先行着手しない) | harness | 可 | 可 | M（**P3 の FP率が出るまで保留**） |
| P9 ✅ | FABLE-3STEP-HOWTO にハンドオフ契約節（事実/ゴール渡す・診断渡さない）。**完了 2026-10-21**: 「ハンドオフ契約」節を追記(渡す=事実/ゴール/制約、渡さない=未確証の診断、冒頭1文は `_preamble` と同じ)。XYEval を [arXiv 2609.23939](https://arxiv.org/pdf/2609.23939) で**一次裏取り**(相対最大46.7%低下・system指示だけでは部分的)。screenshot由来の 67.4→36.0 は未確認なので載せず | loop | 可 | 不可(文書) | S |
| P10 ✅(設計) | JIT注入三層の設計。**完了 2026-10-21**: `_docs/DESIGN-jit-injection-three-tier-2026-10-21.md`(常時核/着手直前JIT/検索任せ の三層・第2層はポインタ注入でなく本文注入しない・不変条件4点・実装は実損ドリブンで据え置く理由)。council どおり**設計のみ・実装はしない**(先に機構を建てると核肥大の口実になる) | context | — | — | L（P1 完了後） |

**第一手は P0 一択**。残りは全部「足す」（台帳・manifest・preamble）で、ratchet が無い状態で入れるとキット自身の病で核へ吸収される。P0 は既存部品（`judge()`・`core:end`・settings 配線パターン）の接続だけ＝新規基盤ゼロ・半日・可逆・外しても無害＝100年設計の見本。

## 捨てた案と理由

- **役②主役化／事実宣言バンド格上げ**: 読者がLPに来ない＋hub再生成不能で約束を見せられない＝provenance違反・CVR希釈。
- **hub/ の index 化**: 公開クローンから再生成不能（`../ai-hub` 必須・fail-close）。見せられない約束＝信頼性違反。
- **LLM-judge conformance hook**: 同一モデル自己採点・非決定flaky・XYEvalのrubber-stamp。真偽判定は gate でなく台帳＋抽出監査。
- **docs/ai-rules への externalize**: 自動ロードされず埋没悪化。減算は relocation であって externalize ではない。
- **budget を commit で block**: edit面 fail-fast＋ratchet の方が迂回しにくく net-reduction の粒度は edit にしかない。
- **新 council-fable 正本ファイル**: 正本散在を増やす。FABLE-3STEP-HOWTO へ追記。
- **XYEval の数値を根拠に使う**: 裏取り不能＝アンカー。一文だけ採る。
- 台帳を8本全hookに付与（致命/退行可の区別違反）／LLMによる核の自動要約（ドリフト）／Ollama自動ラベル（質不足）／anti-anchor の13箇所個別追記（drift）／全commit block。

## 未確認・次にやること（宣言して残す）

- ratchet の**マーカー移動 gaming** → P0 の追加条件で塞ぐ（実装時にテスト必須）。✅塞いだ（P0）。
- P8 の「product surface」の定義（`site/`・LP・公開docのパス集合）は **P3 のデータを見てから**確定。★P3 の台帳（`_loop/hook-outcomes.jsonl`）は配線済みだが、deny の実データはこれから溜まる＝**FP 率はまだ出せない**。P8 は実データが数件溜まり人手ラベルを付けてから着手（宣言して保留）。
- グローバル `~/.claude/settings.json` は**手配線が残る**（リポ側 settings しか直せない。P2 で dispatcher は不採用＝畳まない判断。新 hook/lib を他プロジェクトへ効かせるには手反映が要る）＝宣言して残す既知の穴。
- `site/lp/` の CVR 計測は claims.json 流儀の provenance が要る＝**計測せずに主張を増やさない**。
- 実装は本物Claudeが差分とチェックを確認してから（サブエージェント由来の外向き操作は `guard-external-actions` が常に拒否）。
- ★既知の pre-existing(この clone 環境の欠落・P2〜P7 と無関係): `templates/expo-native/asset-name-collision.test.ts` が `/home/user/web-ios-android/assets` を scandir できず赤(expo テンプレが期待する `assets/` が clone に無い)。full project では解消する想定。
- ★既知の pre-existing(P6 と無関係): `npm run site:links`(verify-internal-links)が `site/hub/index.html → /hub/status/` のリンク切れで赤。`/hub/status/` は `npm run status:page` が deploy 時に生成するページで、この clone には未生成(deploy が `../ai-hub` 必須なのと同類)。P6 のコミットとは別件・別ファイル。PC 側の full build では解消する見込み。要実機確認。

## プログラム全体を「プロジェクト」として管理する（本人決定: 推奨順で全部・2026-10-21）

本会議のバックログ＋`site/hub/`（作業台）＝管理基盤の素材。本人指示「おすすめ順にぜんぶ」に従い、**4手段を
推奨順で全部**敷く。順序は上の「順序の原則」どおり**既存基盤の昇格→開発追跡→文脈集約→束ねる**の依存順:

| 順 | 手段 | 何を | なぜこの順か（根底から） | 可逆/機械検査 |
|---|---|---|---|---|
| ① | **C: hub 作業台を単一正本ボードへ昇格** | `site/hub/` を「全プログラムの作業の唯一の正本ボード」にする（新規基盤ゼロ・既存の昇格） | **根底**。何の作業が在るかの正本が1つ無いと、以降の追跡・集約は分裂する。100年設計（既存を昇格・足さない） | 可/可（hub 生成の fail-close・freshness 検査が既存） |
| ② | **B: GitHub Projects ボード** | バックログ(§7)を Issue 連動で開発追跡（状態・担当・依存） | 正本(①)が在って初めて、開発面のミラーが意味を持つ。Issue=実装の結末台帳の入口 | 可/可（Issue↔項目の整合） |
| ③ | **A: claude.ai Project** | PC/クラウドの複数セッション・ファイル・指示を1つの Project に集約 | 作業(①)と追跡(②)が在って初めて、会話・文脈をその周りに束ねる価値が出る | 可/不可（運用） |
| ④ | **D: 束ねる管理設計** | ①②③に統一原則＋順序原則を適用し1つの管理系に | 最後に全体を1系へ。先にやると空箱を束ねることになる | 可/一部可 |

**管理面にも2原則を必須化**（統一原則＋順序原則の適用）: 作業台/ボードの各項目に次を必須列にする——
(a) **故障モード**（この項目が詰まったとき何が退行/停止/記録されるか）、(b) **前提・順序**（依存する先行項目・
破ると何が無駄になるか）、(c) **可逆か**、(d) **機械検査可能か**、(e) **結末台帳に残るか**。これで「管理ボード自体が
足すだけで腐る」を防ぐ（キット本体に当てた治療を管理面にも当てる）。

★実装も本バックログの一部（別タスク・本人承認済み「推奨順でぜんぶ」）。**P0（ratchet）→ P1 … の順で進める**＝
順序の原則そのものを管理の実践で示す。

## 用語ミニ辞書

- **心臓部／役②**: 全プロジェクトが従う設計の正本（CLAUDE.md 中心）。読者は `@import` で読む AI。
- **core:end**: CLAUDE.md の「必読の核」の終端マーカー（現 L431）。hook の既読判定もここまで。
- **ratchet（ラチェット）**: 「悪化（増加）なら止める・改善（減少）なら通す」可逆閾値。
- **relocation ≠ externalize**: 実損本文を learnings/_docs へ**移設**し核に EVIDENCE 行で参照を残す（relocation）。別正本ファイルへ逃がす（externalize）は自動ロードされず埋没するので禁止。
- **fail-closed / fail-open**: 判定材料が欠けたとき、止める（closed）か 1回警告して進む（open）か。境界ごとに宣言する。
- **provenance ゲート**: 主張の隣に出典・証跡が無ければ出さない規律（claims.json 流儀）。

## 一次情報の保存先

本ファイル（`_docs/DESIGN-overall-design-council-2026-10-21.md`）が決定の正本。会議の各役・裁定の生ログは
本セッションの scratchpad（`council-inputs.md`・`council-synthesis-input.md`）にあり、恒久化が要るものは
本ファイルへ引用済み。

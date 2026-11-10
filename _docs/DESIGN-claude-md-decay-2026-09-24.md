# 設計書: CLAUDE.mdの構造的形骸化への対処

> **到達点**: A/B（局所統合）/C（call-before-ask heuristic）/D（機械化理由の明示＋新規ルール
> 追記の機械検査）すべて実装・実地テスト済み。プロジェクト内はコミット待ち。グローバル
> `~/.claude/settings.json`への配線はSelf-Modificationガードで自動拒否されたため、本人の
> 手動反映待ち（手順は本文末尾）。B案の全面統合（1017行全体の重複記述の一本化）のみ、
> 実損記録を誤って削るリスクを避けるため未着手（別タスク）。
> 調査・設計・裏取り=司令塔（web-ios-androidセッション、Explore/Planサブエージェント併用）／
> 日付=2026-09-24〜25。Plan mode経由でユーザー承認済み。

## 用語（初出の言い換え）

- **CLAUDE.md**: Claude Codeがセッション開始時に自動読み込みする、プロジェクト固有の指示書ファイル。
  作業ディレクトリと**祖先ディレクトリすべて**のものが読まれる仕様
  （[Claude Code Memory公式ドキュメント](https://code.claude.com/docs/en/memory)）。
- **machine-checkable diagnostics**: `templates/diagnostics/check-*.mjs`群。「文章で書いたルール」を
  「客観的事実として検出できるか」で機械検査に格上げする、このキット既存の思想（本ファイルより
  `CLAUDE.md`「新しいルールを書いたら機械検査化を検討する」節参照）。
- **ハイブリッド型**: 判断そのもの（Semantic Judgment）は人間/AIに残し、「判断した/した記録が
  あるという事実」だけを機械検査する型。既存実装は`templates/scripts/check-decision-receipt.mjs`。
- **call-before-ask heuristic**: 本設計で検討した新規案（未実装）。「人間に確認/選択を求める前に
  調査系ツールを呼んだか」という**行為の痕跡**だけを機械検査し、「本当に調べ尽くしたか」という
  意味判断はしない、という限定付きの検査。

## きっかけ（ユーザーの言葉）

> 「なんか根本的に　この　claude.mdは　みかけだおして　形骸化しているきがするので
> 根本原因調査して」

直前のターンで、司令塔自身がCLAUDE.mdの「あらゆる調査を尽くす」ルール
（後述の最重要ルール群）に違反する行動（Cloudflareトークン操作が拒否された際、
代替手段を試さず即座に人間へ判断を投げ返した）を取った直後の指摘だった。

## 確定した事実（実ファイル読了・独立したExploreサブエージェントの調査と一致）

1. **規模**: `CLAUDE.md`は1017行・約101,346バイト・見出し45個・★マーカー69〜87個。
   人間が全部読んで保持できる規模を超えている。
2. **機械強制の限界**: `.claude/hooks/require-claude-md-read.mjs`は「セッション中に
   CLAUDE.mdを全文Readしたか」をSHA256ハッシュ比較で検査するのみ。**「読んだ内容通りに
   行動したか」は一切検査していない**（実装確認済み、全234行）。
   - 副次発見: このhookは`findRepoRoot`がカレントディレクトリから祖先の`.git`を探索する
     実装のため、`~/.claude/plans/`配下（リポジトリ外）の計画ファイル編集にまで誤爆する。
     このセッション自身が実際にこの誤爆を踏んだ。
3. **最重要ルールの埋没**: 2026-09-24追加の最重要ルール3点
   （「あらゆる調査を尽くす」／「裏取り徹底」／「MCPで実際に操作できるか確認してから
   人間に振る」）は、旧行番号で537〜626行目、全体の中盤やや後（約55%地点）に位置し、
   手前に8個の大セクション（キット定義／正本自動到達経路／セッション開始必須アクション／
   非交渉ルール10項目／並列セッション協調プロトコル／PC間引き継ぎ／認知の癖5類型／
   設計書の書き方）を経由しないと到達しない。
4. **重複追記ループ**: 「人間に確認する前に調べ尽くす」系のテーマが2026-09-01・09-23・09-24と
   複数回、微妙に異なる強度・言い回しで繰り返し追記されている。「裏取り」は10箇所以上に
   分散。統合・整理されないまま肥大化を続けている。これは単純な重複ではなく
   「09-01確立→09-23明確化→09-24三分節化」という**失敗ループの記録そのもの**。
5. **機械検査の不在**: `templates/diagnostics/`の既存20個の検査（`run.mjs`に配線確認済み）は
   いずれも客観的にファイルから検出できるもの限定。2026-09-23/24の3つの最新ルールは
   自然言語判断が絡むため機械化困難——だがCLAUDE.md自身の「機械化できないなら理由を
   明示する」基準も、この3ルールについては満たされていなかった。
6. **このセッション自身の実例**: Cloudflareトークンの「ロール」操作がauto mode権限分類器に
   拒否された際、代替手段（公式MCPのexecuteで直接叩く／workflow経由でsecretを扱う
   既存パターン`line-bot/scripts/cloudflare-setup.mjs`の応用）を1つも試さず、即座に
   人間へ判断を投げ返した。CLAUDE.mdが名指しで禁止する行動パターンを、それを読んだ
   直後に繰り返した。

## 根本原因仮説（優先順位順）

1. 機械検査が伴わない規範が最新・最重要ルールに集中している（読了は強制されるが遵守は無強制）
2. 新しい失敗のたびに同じ箇所に詳細化するが、既存ルールの統合・削減をしない
3. 量による実効希釈（1017行・87マーカーの中に最重要規範が中盤埋没）
4. hookの検査範囲が「読了」止まりで「遵守」まで踏み込めない構造的限界

## 検討した選択肢と採否

### A. 構造の分割（核と詳細） — 採用（CLAUDE.md内で完結）

CLAUDE.mdは祖先ディレクトリを自動で全文コンテキストに読み込む仕様であり、
`docs/ai-rules/`等の外部ファイルは自動読み込みされない。よって**最重要ルールを
外部ファイルへ逃がすのは逆効果**（埋没がむしろ悪化する）。分割はCLAUDE.md内で完結させ、
冒頭近くに「核」ブロックを新設し、経緯・実損エピソードは既存箇所に残してリンクする。

### B. 重複除去・統合 — 局所統合を実施、全面統合は見送り

Exploreサブエージェントに全文精査を依頼し、重複マップを作成した。結論: 「調べ尽くす」
「裏取り」の主要部分（旧行番号L14-38, L591-661, L695-725）は各々が異なる日付・異なる
実損エピソードに紐づく別々の教訓であり、統合すると証拠が失われる（**統合禁止**）。
一方、固有の経緯情報を持たず既存ルールへの参照として機能するだけの箇所は安全に圧縮できる
（**統合候補**）。

実施した局所統合（2件、いずれも固有情報の削除なし）:
1. 「確認と不具合対応ルール」節冒頭の「不具合の有無はAIが自分で確認する」文
   （旧933-935行目）を、基準③「完膚なきまでの裏取り」への参照1文に圧縮。
2. 核ブロックの「1. 調べる」説明文（旧23-25行目）を、詳細4項目が既にある
   「あらゆる調査を尽くす」節への参照に圧縮（核ブロック自身が既に「詳細は後半」と
   宣言しているため、重複部分の圧縮は設計意図と整合）。

正味2行の削減（1051→1049行）。1017行全体の主要部分を一本化する大規模統合は
実損記録を誤って削るリスクがあるため**別タスクに切り出す**。

### C. call-before-ask heuristic — 実装済み（2026-09-25）

`.claude/hooks/check-ask-preceded-by-research.mjs`として実装した。`require-claude-md-read.mjs`と
同じtranscript_path走査パターンを流用し、`AskUserQuestion`のPreToolUseで直近20回のツール呼び出しに
調査系ツール(`Grep|Glob|WebFetch|WebSearch|Agent|Task`)が無ければ`systemMessage`で警告する
非ブロッキング型（`permissionDecision: "allow"`固定、fail-open）。

実装前に`claude-code-guide`サブエージェントで公式hooks仕様を裏取りし、`statusMessage`は
スピナー表示専用でモデルのコンテキストに渡らないこと、正しいフィールドは`systemMessage`
であることを確認してから実装した（当初`statusMessage`で誤実装しかけた）。

PowerShellで2ケース（調査ツールありのtranscript／なしのtranscript）を実地テストし、
意図通りの分岐（警告あり／なし）を確認済み。Git Bash経由の同テストは改行コード・パス変換の
問題で偽陰性を出したため、Windows環境での検証はPowerShellを使うこと（`~/.claude/CLAUDE.md`
「Windowsシェル」正本の既知の地雷と同型）。

「調査ツールを呼んだ回数」しか検出できず「調査の質」は判定不可（偽陽性・偽陰性あり）という
限界は、hook本体のコメントとして明記済み。プロトタイプとして実運用に投入し、偽陽性の
体感頻度は今後観察する。

### D. 機械化検討プロセス自体の強化 — 実装済み（2026-09-25）

現行の「新しいルールを書いたら機械検査化を検討する」節は「AIの自己申告」に依存しており、
これ自体が「性善説の登録簿依存」の未対処ケースだった。まず当該節に「2026-09-24追加の
3ルールは機械化していない」旨の一文を追記（機械化できない理由の明示）。

さらに`.claude/hooks/check-new-rule-has-machine-check.mjs`を新規実装した。
huskyのpre-commit（`ai-generic-rules/docs/enforcement/husky/`に既存実装があるが、
web-ios-android自体は未導入）を新規導入する代わりに、既存の`.claude/hooks/`
PreToolUseパターンを踏襲——`CLAUDE.md`/`docs/ai-rules/**`へのEdit/Write時点で、
追加された行に規範的パターン（「〜すること」「〜しないこと」等の正規表現）があるか検出し、
あれば対応する`check-*.mjs`への言及または「機械化できない理由」のキーワードが同じ差分に
含まれるかを見る、非ブロッキング型（`permissionDecision: "allow"`固定）。

PowerShellで3ケース（規範文＋機械検査言及なし／規範文＋言及あり／対象外ファイル）を
実地テストし、意図通りの分岐を確認済み。誤魔化しの一文（キーワードだけ書いて中身が
伴わない）は検出できない限界をコード内コメントに明記。

## 実施した改善

### 2026-09-24（最小改善、追記のみ・既存文の削除なし）

1. **核ブロックの新設**: CLAUDE.md冒頭（「このキットは何か」の直後）に、
   最重要4ルール（選択肢を出さず止まらない／あらゆる調査を尽くす／裏取り徹底／
   MCP実操作確認）を1つの行動フローとして要約し、詳細は既存箇所へのリンクとした。
2. **391-424行目相当の節に一文追記**: 2026-09-24追加の3ルールが機械検査化されていない
   理由と、call-before-ask heuristic案の参照先（本ファイル）を明記した。
3. **本設計書の保存**: `_docs/DESIGN-claude-md-decay-2026-09-24.md`（本ファイル）として
   一次情報を保存した。
4. **`require-claude-md-read.mjs`の誤爆修正**: 対象パスがリポジトリ配下かどうかを
   チェックしてから発動するよう修正した。

### 2026-09-25（call-before-ask heuristicの実装、C案）

5. **`.claude/hooks/check-ask-preceded-by-research.mjs`を新規実装**（上記C参照）。
6. **`.claude/settings.json`に配線**: `AskUserQuestion`のPreToolUseとして追加。
7. **`~/.claude/hooks/web-ios-android-relay.mjs`を新規実装**: 既存の
   `require-claude-md-read.mjs`用グローバル中継ブートストラップが対象ファイル名を
   ハードコードしており、2本目のhookを追加する際に同じ中継ロジックの複製が
   必要になった。基準⑦（同じ画面が複数箇所に増えるのは共通化のサイン）に従い、
   対象ファイル名を引数で受け取る汎用版に統合した（旧・単一目的版は置き換え）。
8. **グローバル`~/.claude/settings.json`への配線は未反映**: auto modeの権限分類器が
   「Self-Modification」としてEdit操作を自動拒否した。これは正当なガードレールと
   判断し、回避策は探索していない。反映手順は本人へ提示済み（下記「本人への申し送り」）。

### 2026-09-25（局所統合とD案実装、ユーザー「ぜんぶまかせたい」指示を受けて）

9. **B案の局所統合を実施**（上記B参照、正味2行減）。
10. **`.claude/hooks/check-new-rule-has-machine-check.mjs`を新規実装**（上記D参照）。
11. **`.claude/settings.json`に配線**: 既存の`Edit|Write|NotebookEdit`matcherへ2つ目の
    hookコマンドとして追加。
12. **グローバル`~/.claude/settings.json`への配線試行は再度拒否された**: Bash経由での
    直接読み取りは通ったが、書き込み（Edit）は依然Self-Modificationガードで拒否される
    ことを確認。回避策（別ツール経由での迂回等）は探索していない——これはCLAUDE.mdの
    「あらゆる調査を尽くす」の趣旨（安全ガードレールを迂回する経路を探すことではない）
    に照らした判断。

## 未確認事項・別タスクへ切り出したもの

- 1017行全体（B案の主要部分）を精査し、重複記述を実際に一本化する作業（通読必須、
  単独セッションでの断行は避ける。局所統合2件のみ実施済み）
- call-before-ask heuristic（C案）・新規ルール機械検査（D案）双方の偽陽性率の
  実運用での観察（実装・実地テストは完了、体感頻度は未計測）

## 本人への申し送り（グローバル設定の手動反映）

`C:\Users\info\.claude\settings.json`の`hooks.PreToolUse`に以下を反映すると、
このPC上の全プロジェクトでcall-before-ask heuristicが有効になる
（`~/.claude/hooks/web-ios-android-relay.mjs`は作成済み）:

```json
"hooks": {
  "PreToolUse": [
    {
      "matcher": "Edit|Write|NotebookEdit",
      "hooks": [
        {
          "type": "command",
          "command": "node \"C:\\Users\\info\\.claude\\hooks\\web-ios-android-relay.mjs\" require-claude-md-read.mjs",
          "timeout": 10,
          "statusMessage": "CLAUDE.md既読チェック中..."
        }
      ]
    },
    {
      "matcher": "AskUserQuestion",
      "hooks": [
        {
          "type": "command",
          "command": "node \"C:\\Users\\info\\.claude\\hooks\\web-ios-android-relay.mjs\" check-ask-preceded-by-research.mjs",
          "timeout": 10,
          "statusMessage": "調査履歴チェック中..."
        }
      ]
    }
  ]
},
```

## 関連ファイル

- `CLAUDE.md`（核ブロック・機械化検討節を編集、局所統合2件）
- `.claude/hooks/require-claude-md-read.mjs`（誤爆修正）
- `.claude/hooks/check-ask-preceded-by-research.mjs`（新規、call-before-ask heuristic本体）
- `.claude/hooks/check-new-rule-has-machine-check.mjs`（新規、新規ルール機械検査チェック本体）
- `.claude/settings.json`（`AskUserQuestion`のPreToolUse配線、`Edit|Write|NotebookEdit`への
  2本目hook配線を追加）
- `~/.claude/hooks/web-ios-android-relay.mjs`（新規、グローバル汎用中継。プロジェクト外・
  git管理外）
- `templates/scripts/check-decision-receipt.mjs`（ハイブリッド型検査の既存実例、参照のみ）
- `_docs/DESIGN-harvest-coverage-2026-09-14.md`（DESIGN文書フォーマットの型）

---

## 移設: `warn-long-running-session` の実装経緯（CLAUDE.md 核から移設・2026-10-21・P1）

CLAUDE.md 核には規範（稼働中セッション検知hookの2軸判定＋「稼働中セッションは正本更新が自動反映されない→疑う」）
だけを残し、以下の日付付き実損・設計経緯はここへ移した（核の予算を守る・全体設計会議 P1）。

### 1. 26日間連続稼働セッションの実損 → hook 化（2026-09-26）
`kimitolink-linktree`セッションが 2026-08-31 から一度も再起動されず **26日間継続稼働**しており、その間に
CLAUDE.md へ追記された全ルール（「直接URLを併記する」等）を一切反映していなかった（ユーザーがスクリーンショットで
指摘して初めて発覚）。「気づいたら疑う」という人間の注意力依存から、`UserPromptSubmit` hook
（`.claude/hooks/warn-long-running-session.mjs`）による自動警告へ格上げした。transcript.jsonl の先頭行の
`timestamp` フィールド（実測で全エントリに存在と確認）からセッション開始時刻を取得し、12時間超なら
`additionalContext` で気づきを注入する。
★実装時の訂正: 当初はファイルシステムの `birthtime` で開始時刻を判定する設計を検討したが、実測で Windows の
`birthtime` は無関係な古い日付を返すことがあり信頼できないと判明。transcript の中身（`timestamp`）を正本とするのが
唯一確実。グローバル設定（`~/.claude/settings.json`）にも `web-ios-android-relay.mjs` 経由で配線済み。

### 2. 「経過時間」だけでは漏れる実損 → 正本更新時刻の判定を追加（2026-09-30）
`soushin-suggest.link`セッションが「実機で確認した」と報告後、プロダクトが新版へ更新されたのに一度も再検証せず
作業を続けた。本来 `check-commit-preceded-by-verification.mjs` が検出できる領域だが、そのセッションの
`~/.claude/settings.json` がこの hook 追加（2026-09-29）より前の状態のまま起動され続けていた可能性が高く、
hook 自体が発火していなかった。★真因は「経過時間が長い」ではなく「セッション開始時点の hook 配線が、正本
（`.claude/hooks/`・CLAUDE.md）の最新コミットより古い」こと——経過時間のしきい値判定だけでは、配線がすぐ後に
更新された短命セッションを見逃す。対処として `warn-long-running-session.mjs` に
`git log -1 --format=%cI -- .claude/hooks/ CLAUDE.md` で正本の最終更新時刻を実測し、「セッション開始時刻 <
正本更新時刻」を検出したら経過時間と独立に警告する判定を追加した。実地テスト3ケース（古い/健全/経過時間は短いが
正本更新前に開始した危険なセッション）で、旧ロジックが見逃すケースを正しく検知することを確認済み。

出典: 2026-09-26 / 2026-09-30 実損。CLAUDE.md「正本への自動到達経路」節から移設（2026-10-21・P1）。

## 移設: `check-write-preceded-by-search` の実装経緯（CLAUDE.md 核から移設・2026-10-21・P1）

CLAUDE.md 核「実装着手前の非交渉ルール」項目1には規範（既存実装を検索する／否定的な結論を出す前も同強度で検索する）
だけを残し、以下の機械検査化の経緯はここへ移した。

**実損 → hook 化（2026-09-28）**: `soushin-suggest.link` セッションが同一作業内で3回、既存実装を検索せずに新規関数を
書いた（ヘッダーバンド自作／フッター実装を2つ新規作成／自分で作った共通部品を自分で使わない、という自己不整合まで発生）。
「気づいたら疑う」という人間の注意力依存から、`PreToolUse(Write|Edit)` hook
（`.claude/hooks/check-write-preceded-by-search.mjs`）による自動警告へ格上げした。`check-ask-preceded-by-research.mjs` と
同じ設計思想（transcript走査・非ブロッキング・fail-open）で、書こうとしている内容に新規関数定義らしきパターンがあり、
かつ直近15回のツール呼び出しに Grep/Glob が無ければ `systemMessage` で気づきを注入する。「検索した形跡があるか」という
客観的事実だけを見る設計であり、「本当に重複を評価したか」までは検出できない（機械化できない理由の明示・本文書の
「新しいルールを書いたら機械検査化を検討する」の型）。グローバル設定（`~/.claude/settings.json`）にも
`web-ios-android-relay.mjs` 経由で配線済み（ただし稼働中セッションには再起動まで反映されない）。

出典: 2026-09-28 実損（`soushin-suggest.link`）。CLAUDE.md「実装着手前の非交渉ルール」項目1から移設（2026-10-21・P1）。

## 移設（2026-11-10）: CLAUDE.md 核から移した経緯・実損の原文

核を短くするため、規範だけを核に残し、経緯・実損・実装の解説をここへ原文のまま移した（PR「CLAUDE.md の核を短くする」）。
下の「上の」「本節」などの指示語は、移す前の CLAUDE.md の中での位置を指す。

### 「正本への自動到達経路」節（全文）

**個々のプロジェクトへ`@`インポート付きCLAUDE.mdを個別に作る必要はない。**
`github/CLAUDE.md`の冒頭に置いた`@web-ios-android/CLAUDE.md`という1行だけが正本経路。

きっかけ: `github/`配下の約30プロジェクトへ、このファイルの内容を届けるために
「各プロジェクトのルートへ`@../web-ios-android/CLAUDE.md`付きCLAUDE.mdを個別に手作業で
作る」という方式を一時採用したが、新規プロジェクト追加・調査漏れのたびに伝播が途切れる
事故が繰り返された（前回「14件対応完了」と報告した直後、別の11プロジェクトで未対応が
発覚。「相対パスで1つ参照すればよいと言ったばかりなのに、また個別対応が必要になっている」
という指摘で発覚）。

★**根本原因はClaude Codeの仕様誤解だった**: Claude Codeは「作業ディレクトリと**その祖先
ディレクトリすべて**のCLAUDE.mdを自動で読み込む」設計（[Claude Code Memory公式ドキュメント](https://code.claude.com/docs/en/memory)）。
つまり`github/line-bot`でセッションを開けば、`github/line-bot/CLAUDE.md`だけでなく
祖先の`github/CLAUDE.md`も自動的に読まれる。`github/CLAUDE.md`にimport構文
（`@web-ios-android/CLAUDE.md`）さえ置けば、配下の**既存・新規を問わず全プロジェクト**に
自動伝播する——個別配布は最初から不要だった。

**今後の運用**:
- 新しいプロジェクトを`github/`配下に作っても、web-ios-androidの正本を読むための
  追加作業は不要（`github/CLAUDE.md`が自動的にカバーする）
- 「web-ios-androidのルールが伝わらない」という事象が今後発生したら、まず
  `github/CLAUDE.md`の`@web-ios-android/CLAUDE.md`インポート行が消えていないか、
  初回承認ダイアログを断って以後インポートが無効になっていないかを疑う
- 既存の個々のプロジェクトに残っている`@../web-ios-android/CLAUDE.md`（`kimito-link`等
  約20件）は重複だが実害はないため、削除の必要はない（プロジェクト固有の注意点も
  併記されているものが多く、無理に触らない）

★★**この修正が効かない既知のケース: 「既に開いたまま動いているセッション」（2026-09-16追記）**。
Claude Codeは指示書（CLAUDE.md）をセッション開始時に読み込む設計であり、稼働中に
祖先ディレクトリのCLAUDE.mdが後から書き換わっても、既に開いているセッションへは
自動的に反映されない（起動時点のスナップショットのまま動き続ける）。実例:
「Mistral AI実装と会議ハーネス設計」セッションが`github/CLAUDE.md`への今回のimport追記
（2026-09-16 11:42）より前から開いたまま動いており、Cloudflareトークンの権限問題
（[`docs/claude-md/10-domain-and-cloudflare.md`](../docs/claude-md/10-domain-and-cloudflare.md)「★★Cloudflareのトークンは『用途ごとに権限が独立している』」、既に
CLAUDE.mdに解決策が書いてある地雷）を自力で再発見していた。ユーザーが手動で
「`C:\...\web-ios-android` みてください」と教えて初めて参照できた。
★**対処**: 長時間開いたままのセッションで「web-ios-androidに書いてあるはずのことが
参照されていない」と感じたら、まず新しいセッションかどうかを疑う。対処は2通り:
1. **そのセッションに直接「`web-ios-android/CLAUDE.md`を読んで」と指示する**
   （最も簡単。`Read`ツールでいつでも最新の内容を読める。効かないのはあくまで
   セッション開始時の`@`インポート自動展開だけで、明示的なReadは別物）
2. セッションを再起動する（以後も自動インポートで継続的に最新が読まれる状態にしたい場合）
「稼働中セッションには遡って効かない」＝「再起動するしかない」ではないことに注意する。

★この稼働中セッション検知は hook 化済み（[`.claude/hooks/warn-long-running-session.mjs`](../.claude/hooks/warn-long-running-session.mjs)・
`UserPromptSubmit`・非ブロッキング）。判定2軸: (1) セッション開始が12時間超、(2) セッション開始時刻 <
正本（`.claude/hooks/`・CLAUDE.md）の最終更新時刻（配線が古いまま起動した短命セッションも捕捉）。
実装経緯・26日連続稼働/soushin の実損・`birthtime` が信頼できない件の詳細:
[`_docs/DESIGN-claude-md-decay-2026-09-24.md`](DESIGN-claude-md-decay-2026-09-24.md)。

★★★★★**非ブロッキングの警告は、読まれなければ「形だけ」になる——外向きの操作の前は拒否に格上げした
（2026-10-06）**。本人の指摘「CLAUDE.md が形だけで機能していない気がします」を、そのセッション自身の
記録で実測した。上の「経過時間・正本更新」の警告は、13日続いたセッションで**毎ターン出ていたのに、
一度も CLAUDE.md を読み直す行動に繋がらなかった**。同じセッションは、①`.agent/coord.md` の
write_lock（Main-Write Pause）を取らずに3リポの main へ PR をマージし、②Gate1 の diff-check が赤の
まま（保護パスに触れたため）マージし、③ワークフローの実行を「未実行」と誤報告した（出力が空だったのを
未実行と読んだ。実際は起動していた）。①②は「CLAUDE.md に書いてある手順」を、③は「裏取り」を、
読んでいながら飛ばした——**文章と警告だけでは、外へ出す直前の1手を止められない**。
- 対処: `.claude/hooks/guard-external-actions.mjs`（PreToolUse(Bash)・**拒否**）。Bash の中の
  `git push` / `gh pr merge` / `gh workflow run|enable` / `gh secret set` / `gh release` / `gh api -X 変更系` /
  `vercel --prod` / `wrangler deploy` / `npm publish` の前で、(1) cwd のリポの CLAUDE.md を**現在の内容のまま
  全文 Read した形跡**、(2) `.agent/coord.md` に**触れた形跡**、(3) `gh pr merge` ではマージ対象PRの**チェックに
  失敗が無いこと**、を事実だけで確かめ、欠けていれば拒否する。判定部品は `.claude/hooks/lib/transcript-reads.mjs`
  に1つだけ置き、`require-claude-md-read.mjs`（Edit/Write 前）と共有する（複製しない）。
- ★チェックが赤のPRをどうしても通すなら、**ユーザーがチャットで明示承認した後に限り**、コマンドへ
  `GATE_BYPASS_APPROVED_BY_USER="<承認の中身>"` を付ける。無断で付けるのは虚偽申告で、ここを機械が見張る手段は無い
  （付けた事実がコマンド履歴に残る＝後から検査できる、までが限界）。
- ★判定しないこと: 読んだ内容に**従ったか**／引用符に隠した操作（`bash -c "..."`）／MCP・Agent 経由の外向き操作。
  「全文Read」は「見た」までの証拠で、読んでも破る可能性は残る。だから他の hook・Gate は別に残す。
- ★サブエージェント（Agent で起動した子）からの外向き操作は**常に拒否**する（2026-10-07）。公式仕様で `transcript_path` は
  親セッションの会話ログを指し、子の Read・coord 参照はそこに残らない（`agent_id` があれば子の呼び出し）ため、
  子が CLAUDE.md を全文 Read しても通らない。子は commit までで止め、push・マージ・デプロイは**親が差分とチェックを
  確かめてから代行**する。拒否メッセージもこの理由を言う（以前は「Read してください」と誤誘導していた）。
- 配線: このリポのセッションは `.claude/settings.json`、他プロジェクトのセッションは
  `~/.claude/settings.json`（`web-ios-android-relay.mjs guard-external-actions.mjs`）。後者は PC ローカルで
  git に載らないので、**新しい PC では手で足す**（設計: 本節。確認は `node .claude/hooks/guard-external-actions.test.mjs` 相当の
  `npx vitest run .claude/hooks/guard-external-actions.test.mjs`）。


### 「セッション開始時の必須アクション」0番

0. **最初の応答の冒頭で「正本を読み込み済みです」と自己申告する**（2026-09-16確立）。
   `github/CLAUDE.md`の`@web-ios-android/CLAUDE.md`インポート経由で、この正本は
   セッション開始時に自動でコンテキストに入っているはずだが、それをユーザーが
   確認する手段が無く、「web-ios-androidを読んで」と毎回言わせてしまっていた
   （実損: 複数の稼働中セッションで、CLAUDE.mdに解決策がある地雷を自力で再発見
   していた実例が繰り返し見つかった）。★このファイルの内容（非交渉ルール・4基準・
   このキットが何かの一言説明のいずれか）を、実際に**要約して**最初の発言に含める
   （「読み込み済みです」と定型文だけ書いて中身を示さないのは自己申告に過ぎず、
   本当に読めている証拠にならない——基準③「完膚なきまでの裏取り」と同じ考え方）。
   これにより、ユーザーは最初の1発言を見るだけで正本が届いているか判断できる。
   届いていない（要約できない）場合は、正直にその旨を報告し、
   `web-ios-android/CLAUDE.md`を明示的にReadしてから作業を始める。

### 「セッション開始時の必須アクション」5番

5. **本物のClaudeは「考える・判断する・検品する」だけ。手を動かす仕事は他の頭脳へ投げる**（2026-09-15
   本人指示で確定）。ファイル作成・定型修正・調査・文章量産・テスト追加は、自分でやらずに
   `python docs/ai-workflows/tools/dispatch.py --brain <grok|qwen|oc|cf|local> --cwd <dir> "<やること>"`
   で投げ、返ってきたログの要点だけ読んで検品する。頭脳の使い分けと財布（Claude週間上限／SuperGrok／
   Alibaba無料枠／Cloudflare無料枠／ローカル）は正本 [`docs/ai-workflows/MULTI-BRAIN-HOWTO.md`](../docs/ai-workflows/MULTI-BRAIN-HOWTO.md) §1b。
   スクリーンショットは文章の何倍も上限を消費するので、画面の内容は本人に文字で貼ってもらう。
   ★**「難しい判断＋実装＋テストまで一貫でやる重い仕事」は Google Antigravity（本人が有料契約済み・Claude Opus 5.5/Sonnet 5.5・Gemini 4 Argon）へ回す**
   （2026-09-16確定、2026-10-21更新）。Antigravity の Opus 5.5 は司令塔と同じ頭脳で、Claude の週間上限とは別の Google 側の枠で動く。
   ★Antigravity は CLAUDE.md を読まない（読むのは AGENTS.md）・Turbo は権限無制限で push も止まらない。橋渡しはリポ直下の
   [`AGENTS.md`](../AGENTS.md)、拒否リスト・モデル別の役割分担・引き継ぎの流れは正本 [`ANTIGRAVITY-HOWTO.md`](../docs/ai-workflows/ANTIGRAVITY-HOWTO.md)。
   予備の頭脳は AWS Kiro Free（カード不要・Sonnet 4.5・薄い）→ Ollama×Claude Code（構築済み・機密用）の順。
   ★★**Grok BuildとAntigravityの使い分け**: 今は「人手が要るか」が主軸で **Grok Build を優先**し、Antigravity は
   正本 [`MULTI-BRAIN-HOWTO.md`](../docs/ai-workflows/MULTI-BRAIN-HOWTO.md) §1c の条件（Grok 2回失敗／30分超の設計判断を伴う作業／
   対話的作業／司令塔が自分の上限で重い実装をしそうなとき）に当たるときだけ、理由とモデルを添えて本人に提案する（本人が手で投げる）。
   `agy -p`（headless）を PC で確かめたら `dispatch.py --brain agy` で司令塔が自動で投げる運用へ移る（同 HOWTO「段階2」）。

### 「実装着手前の非交渉ルール」前書き

Deep Research（大企業向けマイクロサービス基盤の調査）を検討した際、Backstage・Pact Broker・
OTel/SLO運用のような新しい基盤は**このキットの規模には過剰**と判断し不採用にした。だが1点だけ、
「AIが調べずに新しく作る→重複する→片方だけ直す→ドリフトする→別の場所が壊れる」という事故を
防ぐ**行動順序の明文化**は、新しい仕組みを増やさずに**既存の仕組みを正しい順番で使わせるだけ**
なので採用する。実装（コードを書く・ファイルを変更する）を始める前に、必ずこの順で確認する:

### 「実装着手前の非交渉ルール」1番

1. **既存実装を検索する** — `Grep`/`Glob`で対象領域の既存コードを探す
   ★**否定形で答える前ほど検索を飛ばしやすい**（2026-09-14、line-bot-e8の同日5件の実損から確立）。
   「できません」「ありません」「〜が必要です」と言いかけた瞬間こそ、この1番を踏んでいるか
   自問する。実例: 「LINEアカウント作成は代行できません」→未検索のまま2回連続で回答→
   3度目にユーザーから「web-ios-android見れば仕組み化しているはず」と言われて初めて
   検索し、`ai-shain-worker`配下に`open-line-form.mjs`（reCAPTCHA部分だけ人に渡す設計。
   [`docs/ai-rules/05_HANDING_SCREEN_TO_HUMAN.md`](../docs/ai-rules/05_HANDING_SCREEN_TO_HUMAN.md)
   の出典元）が既にあると判明。他4件も同日同型（プライバシーポリシー公開・OAuth設定・
   開発者登録・API仕様、いずれも「一般論の手順を先に語り、実環境を見ていない」）。
   ★**新しく作るときは検索するのに、「無理だ」と判断するときだけ検索を省略する**という
   非対称性が本質。否定的な結論を出す前は、肯定的な結論を出す前と同じ強度で検索する。
   ★この1番は `.claude/hooks/check-write-preceded-by-search.mjs`（`PreToolUse(Write|Edit)`・非ブロッキング）が機械検知する
   （新規関数定義らしきパターンを書く前の直近15ツールに Grep/Glob が無ければ警告）。実装経緯（soushin の自己不整合実損）・
   機械化できない部分の明示: [`_docs/DESIGN-claude-md-decay-2026-09-24.md`](DESIGN-claude-md-decay-2026-09-24.md)。

### 「実装着手前の非交渉ルール」5番

5. **変更による影響範囲を確認してから編集する** — 呼び出し元・配布先（`templates/`配下は複数プロジェクトへ配られる前提）を把握してから触る
   ★★**「設計書が指す対象ファイル」を鵜呑みにせず、実際のルーティングから到達可能か確認する**
   （2026-09-29実損、`kimito-Link-Voice`）。`index.html`（旧「声優マッチング」時代のダッシュボード）
   を設計書どおりに全面実装・本番デプロイしたが、`server.js`の実ルーティングは`/`に`lp/index.html`
   を配信しており、`index.html`はどこからもリンクされていない未使用ファイルだった。設計書
   （`../kimito-Link-Voice/docs/DESIGN-clerk-migration-2026-09-26.md`）自体が、事業ピボット（`../kimito-Link-Voice/docs/BILLING-DESIGN.md`）
   を踏まえず旧`index.html`を前提に書かれた古い設計書だった。「ファイルが存在する」ことと
   「そのファイルが実際に配信されている」ことは別の命題——複数のHTML/エントリファイルが
   存在するプロジェクトで大きな変更に着手する前は、`server.js`等（各言語のアプリ起動ファイル）のルーティング定義を
   grepするか、本番/ローカルの該当パスへ実際にアクセスして確認する。この1番目の「既存実装を
   検索する」を「対象ファイルが到達可能か」にまで広げたもの。
   ★機械化: 「HTMLファイルへの大規模書き換え直前に、ルーティング定義の検索(Grepで`app.get`等)
   または本番/ローカルへの実アクセス(WebFetch/curl)を行った形跡があるか」という客観的事実は
   検出できるが、「設計書の前提が本当に正しいか」という意味判断はできない。
   `.claude/hooks/check-target-file-reachability.mjs`（`check-write-preceded-by-search.mjs`と
   同じtranscript走査・非ブロッキング・fail-open型）で実装済み、`settings.json`に配線済み。

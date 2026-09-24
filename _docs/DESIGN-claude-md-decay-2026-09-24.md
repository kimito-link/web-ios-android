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

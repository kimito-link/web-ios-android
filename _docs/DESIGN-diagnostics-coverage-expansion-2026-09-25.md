# 設計書: キット全体の機械検査カバレッジ拡充

> **到達点**: 優先候補4件のうち2件（Gate迂回検出・hooksの配線漏れ検出）を実装・実地テスト・
> コミット済み。1件（基準②の弱いヒューリスティック）は実装→実データ検証→**不採用**まで
> 完了（理由は後述「試したが不採用にしたもの」）。残り1件（check-gates-are-wired.mjsの
> 対象範囲拡張）は未着手（別タスク）。
> 調査=司令塔（web-ios-androidセッション、Exploreサブエージェント併用）／日付=2026-09-25。
> ユーザー「どんどんつづけてやりきって」「おすすめ順に全部やる」指示を受けて着手。

## 用語（初出の言い換え）

- **機械検査（machine-checkable diagnostics）**: `templates/diagnostics/check-*.mjs`群。
  文章で書いたルールを客観的事実として検出できる形に格上げする、このキット既存の思想
  （[`_docs/DESIGN-claude-md-decay-2026-09-24.md`](DESIGN-claude-md-decay-2026-09-24.md)参照）。
- **孤児（orphan）hook**: 実体ファイルは存在するが、どこからも呼ばれない設定になっている
  `.claude/hooks/*.mjs`。「作ったのに誰も呼ばない検査」の`.claude/hooks/`版。
- **CANONICAL CHECK / Decision Receipt**: 新規ファイルを作る前に既存資産との重複を確認した
  という判断を記録する仕組み。`templates/scripts/check-decision-receipt.mjs`・
  `record-decision-receipt.mjs`が実体。

## きっかけ

[`_docs/DESIGN-claude-md-decay-2026-09-24.md`](DESIGN-claude-md-decay-2026-09-24.md)でCLAUDE.md
自体の形骸化対策（核ブロック・call-before-ask heuristic等）が完了した後、ユーザーから
「どんどんつづけてやりきって　100年後安心できる設計にして」という指示を受け、スコープを
CLAUDE.mdというドキュメント単体から**キット全体の規範のうち機械検査が伴っていない領域**へ
広げた。

## 調査結果（Exploreサブエージェント、実ファイル読了に基づく）

CLAUDE.mdが定める規範を4カテゴリで機械検査の有無を照合した:

1. **NON-NEGOTIABLE 10項目**のうち8番「Gateを無効化・迂回して成功扱いにしない」が、
   客観的事実として検出可能（`continue-on-error: true`やコメントアウトされた検証ステップの
   有無）にも関わらず機械検査が存在しなかった。
2. **基準①〜⑦**は⑤⑥⑦（共通化サイン）に機械検査があるが、①（抜け漏れなく完璧に）・
   ②（車輪の再発明をしない）・③（完膚なきまでの裏取り）・④（最高品質）は意味判断寄りで
   機械化困難。ただし②は「自前実装に公式ツール名への言及が無い」という弱いヒューリスティック
   なら実装可能と判定された。
3. `templates/diagnostics/run.mjs`の配線漏れは0件（`check-runner-registers-all.mjs`で確認）。
   ただし`check-gates-are-wired.mjs`自身が`.claude/hooks/`を対象範囲に含めていないという
   構造的な盲点があった（コード内コメントで`templates/scripts/`除外は明記されているが、
   `.claude/hooks/`除外は明記されていなかった）。
4. **プロジェクト内`.claude/settings.json`とグローバル`~/.claude/settings.json`の配線ズレ**:
   `_docs/DESIGN-claude-md-decay-2026-09-24.md`で発見した「グローバル未反映」問題が、
   一般化可能な構造的リスクだと判明。

## 実装した2件

### 1. `templates/diagnostics/check-gate-bypass.mjs`

`.github/workflows/*.yml`内の`continue-on-error: true`とコメントアウトされた検証ステップ
（`#- run: npm run verify`等）を検出する。非ブロッキングではなくfail-closed（exit 1）——
CI設定ファイルという「意図的に変更されない限り増えない」対象であり、`check-secrets-not-tracked.mjs`
と同じ強度で扱ってよいと判断した。

**実装中に発見した自作バグ**: 初版は「#で始まる行を早期に除外する」ロジックが先にあり、
「#で始まるコメントアウトされた検証ステップ」自体もこの除外に引っかかって検出できていなかった。
`--selftest`を実行して初めて発覚し（基準③「完膚なきまでの裏取り」を自分自身の実装で実践）、
判定順序を入れ替えて修正した。

### 2. `templates/diagnostics/check-hooks-wired.mjs`

2種類の問題を検出する:
- A. `.claude/hooks/*.mjs`が存在するのに、プロジェクト内`.claude/settings.json`のhooks設定から
  一度も参照されていない（孤児hook）→ fail-closed
- B. プロジェクト内では配線済みだが、グローバル`~/.claude/settings.json`には見当たらない
  → 警告のみ（非fail-closed。プロジェクト固有hookをグローバルへ強制する設計ではないため）

実行した結果、既知の問題（`check-ask-preceded-by-research.mjs`と
`check-new-rule-has-machine-check.mjs`がグローバル未反映）を正しく検出した。

## 実施した付随作業

- 両ファイルともCANONICAL CHECKを実施し、`record-decision-receipt.mjs`でLOCAL判定を記録した。
- `check-docs-match-code.mjs`が指摘した3箇所のドキュメント記載漏れ
  （`templates/diagnostics/README.md`・`DIAGNOSTICS-HANDOUT.md`・
  `site/features/health-check/index.html`）に追記し解消した。
- `templates/diagnostics/run.mjs`のCHECKSに両方を登録し、`check-runner-registers-all.mjs`・
  `check-gates-are-wired.mjs`で配線漏れが無いことを確認した。

## 試したが不採用にしたもの

### 基準②「車輪の再発明をしない」の弱いヒューリスティック（`check-reinvented-wheel.mjs`）

「メールアドレス検証・パスワードハッシュ化を自前実装している箇所に、公式ツール名や
『先取りチェック』という正当化コメントが無ければ警告する」という設計で実装し、
`--selftest`は一発で通った。

★しかし基準③「完膚なきまでの裏取り」に従い、selftestだけで満足せず実データ
（`web-ios-android`本体207ファイル・`ai-shain.link`38ファイル・`best-trust.biz`49ファイル・
`kimito-link`・`characterlive`・`compass`・`henshin-hisho`・`kimitolink-linktree`）に
対して実行したところ、以下が判明し**不採用（削除）とした**:

1. **`node_modules`を除外していなかった**: `kimito-link`で17件検出したうち全件が
   `node_modules/playwright-core/`等のライブラリ内部コード。対象外にすべきディレクトリの
   除外漏れという単純な設計ミス。
2. **正規表現が広すぎて偽陽性率が致命的に高かった**: `kimitolink-linktree`で24件検出したが、
   サンプル確認した`lib/parse-tweet-url.ts`・`lib/x-follow.ts`は`/^@+/`
   （Xのユーザー名先頭の@記号を除去する、メール検証とは無関係な文字列処理）に
   マッチしていた。「`^`と`@`を含む正規表現リテラル」という条件だけでは、
   メールアドレス検証を狙い撃ちできなかった。

★教訓: プロトタイプのselftestが通っても、対象パターンが「実際のコードに存在する具体例」で
検証されていなければ、母数ゼロ（検出0件のまま気づかれない）か、母数はあっても
桁違いの偽陽性（今回のケース）のどちらかに転びうる。設計書「今すぐ実行可能な最小改善」
段階で「プロトタイプ検証なしに本採用しない」と書いていた原則が、まさにこの検査自身の
運命を正しく言い当てていた。**同種のヒューリスティック検査を今後作るときは、
最低3つ以上の異なる実プロジェクトに対して実行し、検出結果を目視でサンプル確認してから
run.mjsへ配線すること**を教訓として残す。

## 検証したが見送ったもの

### `check-gates-are-wired.mjs`の対象範囲拡張（`templates/scripts/`を含める）

`node templates/diagnostics/check-gates-are-wired.mjs . --dirs "scripts,scripts/qa,scripts/diagnostics,templates/diagnostics,templates/scripts"`
を実際に実行し、`templates/scripts/`を対象に含めると15本が「孤児」として検出されることを
確認した。これはスクリプト自身のコメント（73-78行目）が事前に警告していた通りの結果——
`templates/scripts/`は配布先プロジェクトが自分の`scripts/`へコピーして使う金型であり、
このキット自身が呼ぶべきものではないため、素朴に有効化すると「行動に繋がらない偽陽性」に
なる。既存の`.gates-wired-baseline.json`によるラチェット方式（今の孤児数をベースラインとし、
それより増えたときだけ赤にする）を使えば技術的には実用可能と確認できたが、run.mjsからの
デフォルト呼び出しに`--dirs`を渡す仕組みは`declaresDir`パターンの拡張が必要で、既存の
枯れた検査の呼び出しインターフェースを変更する影響範囲の広い作業になる。今回は
「新規検査の追加」というスコープを超えるため、コード変更はせず検証結果の記録に留めた。
別タスクとして着手する場合は、`declaresDir`と同様に対象リポ側が`--gate-dirs-extra`を
宣言できる仕組みを追加し、ベースラインの初期値を`.gates-wired-baseline.json`へ記録する
手順から始めるとよい。

## 未着手・別タスクへ切り出したもの

1. **NON-NEGOTIABLE①②③⑤⑦⑩・基準①③④**: いずれも自然言語的な充足度判定であり、
   `check-new-rule-has-machine-check.mjs`のコメントが既に明示する通り機械化困難。

## 関連ファイル

- `templates/diagnostics/check-gate-bypass.mjs`（新規）
- `templates/diagnostics/check-hooks-wired.mjs`（新規）
- `templates/diagnostics/run.mjs`（CHECKSへの登録）
- `templates/diagnostics/README.md`・`DIAGNOSTICS-HANDOUT.md`・
  `site/features/health-check/index.html`（ドキュメント追記）
- `.decision-receipts.json`（CANONICAL CHECK記録2件）
- [`_docs/DESIGN-claude-md-decay-2026-09-24.md`](DESIGN-claude-md-decay-2026-09-24.md)
  （前段の設計書。グローバル未反映問題の初出）

# 設計書: キット全体の機械検査カバレッジ拡充

> **到達点**: 優先候補4件のうち2件（Gate迂回検出・hooksの配線漏れ検出）を実装・実地テスト・
> コミット済み。残り2件（基準②の弱いヒューリスティック、check-gates-are-wired.mjsの対象範囲
> 拡張）は未着手（別タスク）。
> 調査=司令塔（web-ios-androidセッション、Exploreサブエージェント併用）／日付=2026-09-25。
> ユーザー「どんどんつづけてやりきって」指示を受けて着手。

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

## 未着手・別タスクへ切り出したもの

1. **基準②「車輪の再発明をしない」の弱いヒューリスティック**: 自前実装内にメール/URL検証等の
   再実装らしきパターンがあるのに公式ツール名への言及が無い場合の警告。誤検知率の見積もりが
   必要なため即座には実装しなかった。
2. **`check-gates-are-wired.mjs`の対象範囲拡張**: `templates/scripts/`（配布用金型）を
   意図的に除外している設計だが、これをベースライン付きで対象に含める拡張は、
   コード内コメントで既に拡張路線が示唆されている。今回はスコープに含めなかった。
3. **NON-NEGOTIABLE①②③⑤⑦⑩・基準①③④**: いずれも自然言語的な充足度判定であり、
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

# Antigravity 活用HOWTO — 正本

**状態: 方針確定・実例2パターンから抽出済み。** 今後Antigravityに実装作業を委ねるときは
この1枚を読み、書式を流用する。コピーは作らない（散らすと同期がずれて事故る）。

- 設計: 司令塔。日付: 2026-09-08
- きっかけ: ユーザーが有料契約しているAntigravity（Google製・VSCodeベースのagentic IDE）を
  実装作業の担い手として正式にこのキットへ組み込みたいという要望。既に複数プロジェクトで
  実績があったが、書式が正本化されていなかった
- 保存先の相互参照: 本ファイル（Antigravity専用） ← [`FABLE-3STEP-HOWTO.md`](FABLE-3STEP-HOWTO.md)
  の「手順3: 実装は別モデル」から参照される（Antigravityはこの「別モデル」の選択肢の1つ）

## 用語（この文書だけで通じる略称の説明）

- **Antigravity**: Google製のVSCodeベースagentic IDE。このPCには`.antigravity-ide`として
  インストール済み（2026-09-08時点で直近使用実績あり）。対話的にファイルを見ながら
  試行錯誤できる点が、バッチ的な「次チャット」との違い
- **council-fable**: 無料マルチLLM会議→Fable(claude-fable-5-1)設計→実装ハンドオフ、の
  3段構えワークフロー（[`FABLE-3STEP-HOWTO.md`](FABLE-3STEP-HOWTO.md)が正本）。Antigravityは
  この「手順3: 実装」を担う選択肢の1つ

## Antigravityを使う場面（次チャット/別モデルとの使い分け）

| 状況 | 選ぶもの |
|---|---|
| 実装ハンドオフ1枚で完結する、バッチ的な作業 | 次チャット/別モデル（`FABLE-3STEP-HOWTO.md`のまま） |
| IDE上でファイルを見ながら試行錯誤したい、対話的な配線作業 | **Antigravity** |
| 既存キット（web-ios-android）の手順書を読み込ませて横展開する作業 | **Antigravity**（実績あり、下記参照） |

## 実例1: 依頼プロンプトの書式（`sakkino.link/ANTIGRAVITY-CI-PROMPT.md`が実例）

Antigravityに貼るプロンプトは、以下の構成にすると欠落なく伝わる:

1. **作業ディレクトリを明示**（絶対パス）。何のプロジェクトかを1〜2文で要約
2. **正本の場所を最初に読ませる**（このキットなら`_docs/release-pipeline-playbook.md`等、
   案件が依拠する既存ドキュメント一式へのパスを列挙し「必ず先に読むこと」と明記）
3. **この案件の特殊事情**（キットの標準パターンとの差分。ここを外すと壊れる、という警告付き）
4. **やること**（AIで完結できる範囲を番号付きで具体的に）
5. **絶対にやらないこと**（実行系の禁止——push・実際の外部提出・secret登録の実行等、
   人間の承認が要る操作を明記）
6. **人間にしかできない関門**（Antigravityにやらせず「手順書に落とすだけ」と明記する）
7. **検証・完了報告の基準**（何をもって完了とするか、機械的に判定できる形で）

## 実例2: 知見レポートの書式（`kimitolink-linktree/docs/AI_ANTIGRAVITY_REPORT.md`が実例）

Antigravityが実装作業中に見つけた「一般的な静的解析では検知できないアンチパターン」を、
次にこのプロジェクトを保守するAI（Cursor・GitHub Copilot・Claude Code等）向けに書き残す形式:

```markdown
## N. 見出し（テーマ名）

### ❌ アンチパターン（過去）
（具体的に何が問題だったかをコード付きで）

### ✅ アンチグラビティの解決策（現在）
（修正後のコードと、なぜそれが正しいか）

> **AIへの指示**: 以降、〇〇は絶対に使用しないでください。代わりに〜。
```

**対象読者**は冒頭に明記する（「今後このプロジェクトを保守・開発するすべてのAIアシスタント」）。

## 使うときの注意

- Antigravityへの依頼プロンプトも、実装ハンドオフと同様に**司令塔が実在パス・コマンドを
  裏取りしてから渡す**（Fableの設計と同じく、Antigravityの出力も鵜呑みにせず検証する）
- Antigravity側で見つかった知見（実例2の形式）は、案件固有のプロジェクト内`docs/`に置く。
  横断的に価値がある知見（複数プロジェクトで再発する類のもの）は、通常の「知見は書き戻す」
  運用（`../ai-hub/CLAUDE.md`のharvestの掟）に従い`ai-hub`側へharvestする

## 実績

- **2026-07-08、ai-health-check.link PR #8**: council-fableの3段構えで会議→Fable設計まで
  終えたあと、実装ハンドオフ1枚をAntigravityに渡したら完走し、Claudeが実機検証してPR化
  するところまで到達した（`FABLE-3STEP-HOWTO.md`の実績セクションに記録済み）。ハンドオフに
  「機械的な完了判定チェックリスト」を付ける形式が有効だったのはこのときの実証
- **sakkino.link**: CI配線・ストア提出フェーズの配線作業をAntigravityに委任する依頼書
  （`ANTIGRAVITY-CI-PROMPT.md`）を作成。実行系（push・提出・secret登録）は明確に除外し、
  配線とdry-runまでに限定する書き方をした
- **kimitolink-linktree**: Next.js App Router特有のHydration/SSRF系アンチパターンを
  Antigravityが修正した際、次の保守担当AI向けに知見レポート2本
  （`AI_ANTIGRAVITY_REPORT.md`・`AI_ANTIGRAVITY_REPORT_2.md`）を残した

---
*2026-09-08作成／既存2実例（sakkino.linkの依頼プロンプト、kimitolink-linktreeの知見レポート）
から書式を抽出して正本化。`FABLE-3STEP-HOWTO.md`と対の関係（設計はFable／実装の選択肢の1つがAntigravity）。*

# 実装ハンドオフ: dynamic workflow誤発火防止（MVP）

> **今の到達点**: 完了。全4手順実施済み（2026-09-25）。
> 設計書: [DESIGN-dynamic-workflow-adoption-2026-09-25.md](DESIGN-dynamic-workflow-adoption-2026-09-25.md)
> この1枚だけで着手できる。読む順: このファイル→（必要なら）設計書のB/C/D節。

## スコープ（これだけやる）

1. ✅完了: `/config`でDynamic workflowを無効化する設定を人間が1回操作した
2. ✅完了: 実際に書かれた設定キーは`enableWorkflows: false`（単語トリガーではなく
   機能自体のON/OFF。設計書「未確認事項」節参照）
3. ✅完了扱い: 機能自体がOFFのため誤発火の実測は前提が消え不要になった
4. **残タスク**: `docs/ai-workflows/MULTI-BRAIN-HOWTO.md`に§1dとして15行以内で追記する

**やらないこと**: Workflowツールの標準化、`coord.md`への`babysit`セッション追加、
`dispatch.py`への新引数追加、新規check-*.mjsの作成。設計書F節「捨てた案」参照。

## 着手手順（手順1〜3は完了済み。以下は履歴として残す）

### 手順1: 人間の操作（完了・2026-09-25）

ユーザーが`/config`→Claude Code→「ダイナミックワークフロー」トグルをOFFにした。

### 手順2: 設定キー名の確認（完了）

実測結果: `~/.claude/settings.json`に`"enableWorkflows": false`が追加された
（`grep`不要、system-reminder経由で変更差分を直接確認）。

### 手順3: 誤発火の実測（前提が変わり不要と判断）

機能自体がOFFになったため、単語"workflow"を含むプロンプトでの誤発火リスクは
構造的に消えた。実測での検証は行っていないが、設定の意味（機能ごとON/OFF）から
論理的に導かれる。

### 手順4: MULTI-BRAIN-HOWTO.mdへの追記（完了）

`docs/ai-workflows/MULTI-BRAIN-HOWTO.md`の§1c（Grok BuildとAntigravityの使い分け）の
直後に、新見出し`### 1d. Workflowツール（dynamic workflow）は使わないのが既定
（2026-09-25確定）`を追加した。使ってよい4条件・coord.mdとの関係・`/loop`使い分けを含む。

## 機械的な完了判定

- [x] `/config`でDynamic workflow（実際のUI表記）が無効化されている（人間確認、2026-09-25）
- [x] 設定キー名を確認した（`enableWorkflows: false`。設計書の未確認事項1は確定として更新済み）
- [x] 誤発火の実測は前提が変わり不要と判定（機能自体がOFFのため。設計書に理由を記録）
- [x] `MULTI-BRAIN-HOWTO.md`に§1dが追加されている（`grep -c "1d\." docs/ai-workflows/MULTI-BRAIN-HOWTO.md`で1件、実行して確認済み）
- [x] 追記が18行（本文実質15行程度）に収まっている
- [x] 設計書の「未確認事項」節を実測結果で更新済み（1は確定、2は不要、3は未確認のまま明記）

## 地雷（設計書G節と同じ、再掲）

- `/loop`を安易に使うとClaude上限が1刻みごとに削れる
- Workflowで起動したサブエージェントがcommit/pushするとMain-Write Pause違反になる
  （§1d追記時に明記すること）

## 次にやること

このハンドオフの4手順が終わったら、非自明な地雷（もしあれば）を`ai-hub`のharvestの掟に
従って書き戻す（タグ候補: `claude-code`, `dynamic-workflow`, `multi-brain`）。

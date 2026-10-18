# 自己改善ループのランナー 仕様 v1（loop-run.mjs）

> **今の到達点: 実装完了（動く）。** 入口→アダプタ→カード検査→（症状があれば）提案書→受信箱を1回分、一続きに回す。定期実行（スケジューラへの登録）は**未着手**（人間が手で、またはスケジューラに登録して回す）。
> 親: [`DESIGN-self-improvement-loop-2026-10-18.md`](DESIGN-self-improvement-loop-2026-10-18.md)。部品: [`SPEC-symptom-card-v1.md`](SPEC-symptom-card-v1.md)・[`SPEC-loop-propose-v1.md`](SPEC-loop-propose-v1.md)・[`SPEC-loop-ledger-and-proposal-v1.md`](SPEC-loop-ledger-and-proposal-v1.md)。
> 実装: `templates/scripts/loop-run.mjs`（CLI）・`templates/scripts/lib/loop-run-core.mjs`（判断の純関数）。テスト: `lib/loop-run-core.test.mjs`・`lib/loop-run.e2e.test.mjs`・共有部品 `lib/loop-test-fixtures.mjs`。

## 使い方
```
node scripts/loop-run.mjs --project <名前> --model <Ollamaのモデル名> \
  --adapter '["node","scripts/loop-adapter-status-live.mjs"]' \
  [--source '["node","scripts/status-live.mjs","--json"]'] \
  [--glossary <用語集>] [--repo <対象リポ>] [--ollama http://127.0.0.1:11434] [--timeout 秒] [--force] [--root <_loop/<project>>] [--cwd <作業ディレクトリ>]
node scripts/loop-run.mjs --config loop.config.json     # 上のキーをJSONで持てる。フラグが優先
```
- `--source` / `--adapter` は **JSON の配列（実行ファイルと引数）**。シェルは通さない。人間（または設定ファイル）が決めた固定のコマンドだけを走らせる。
- `--source` はアダプタの標準入力へ渡す文字列を出すコマンド。異常終了（診断が exit 1/2 など）でも、出力があれば先へ進む。出力が空なら止まる。
- アダプタには環境変数 `LOOP_OUT_DIR`（カードの出力先）と `LOOP_KIT_DIR`（キットの scripts）を渡す。**アダプタの契約**: 標準入力を読み、`LOOP_OUT_DIR` に症状カードを書き、成功=0 / カードが検査に通らない=1 / 測れない=2 で終わる。
- 設定例: `templates/loop.config.json.example`。

## 順序と判断
1. 送り先（`--ollama`）がローカル（127.0.0.1 / localhost / [::1]）か。**違えば何も走らせる前に exit 1**。
2. 入口 → アダプタ。アダプタ exit 1 → ランナー exit 1／それ以外の失敗 → exit 2。
3. **ランナーが症状カードを必ず再検査**（アダプタの自己検査とは別の二重の防壁）。1枚でも違反なら先へ進まない。カードが0枚も exit 2。
4. 判断（`decideAction`）:
   - 症状（verdict が `fail` / `warn`）が無い → **AIを呼ばない**（`no-symptoms`）。`unmeasured` だけの場合は「緑ではない」と明記して件数を報告。
   - 同じ症状の組み合わせ（症状IDをソートして連結した署名）の提案が、台帳で `proposed` / `approved` / `rejected` / `deferred` → **重複として止める**（`skip-duplicate`）。`no_effect`（直らなかった）なら新しく提案する。`--force` で重複でも提案。
5. 提案書づくり（`loop-propose.mjs`）。Ollama に届かない → **exit 2 で止まる（外部AIへは落とさない）**。提案書が形式検査に通らない → exit 1・`proposals/_invalid/` に隔離・台帳にも受信箱にも書かない。
6. 成功したら、`<root>/state.json`（署名→提案書）を更新し、`<root>/INBOX.md` に1件追記（提案書の場所・症状ID・**次の一手＝人間が自分のターミナルで承認/却下/保留を記録**）。
- 終了コード: 0=正常に終えた（提案／症状なし／重複で停止） / 1=検査に通らない・送り先がローカルでない / 2=測れていない。最後に `RESULT: <proposed|no-symptoms|skip-duplicate> …` を1行出す。
- 実行の記録: `<root>/runs/<時刻>/`（`symptoms/` と `run.json`＝症状IDと件数だけ。データは載せない）。

## 守っていること（テストで固定）
症状なしならAIを呼ばない／同じ症状は重複で止まる／人間が却下しても止まる／`no_effect` なら再提案／`--force` で再提案／Ollama不達で止まる／ローカル以外の送り先は先に拒否／入口が空・アダプタ失敗・カード違反で先へ進まない／形式検査に落ちた提案書は隔離／受信箱と `run.json` に診断の本文・ファイル名・メールが載らない／`--config` で動く。変異テスト（13種）で、これらを壊すとテストが赤になることを確認。

## 限界・未着手
- **署名は症状IDの集合だけ**。同じIDでも原因が違う場合は見ない（人間が `state.json` を消すか `--force`）。診断アダプタでは、全体カード（`diagnostics-summary`）も症状として署名に入る（失敗があれば必ず fail になる冗長なカード。署名は決定的なので重複判定は正しい）。
- **定期実行は未着手**。このランナーは1回分。Windows のタスクスケジューラ等への登録は、スコープの確認（誰のPCで・どの頻度で・Ollama を起動しておくか）が要るので別作業。
- ローカルAIの質は、モデルの選定（`SPEC-loop-propose-v1.md`）が先。ランナーは質を上げない。
- 受信箱は追記専用のMarkdownで、通知はしない（外へ出ない設計）。人間が読みに来る。

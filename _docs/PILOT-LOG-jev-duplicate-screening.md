# Jev（TypeSafe AI）重複クラスタスクリーニング パイロット運用ログ

`docs/ai-workflows/JEV-DUPLICATE-SCREENING-HOWTO.md`のPoC実装後、実際に
`screen-duplicate-clusters-with-jev.mjs`を使ってクラスタ判定を行った記録。
`_docs/PILOT-LOG-canonical-check.md`と同型のフォーマットを踏襲する。

`ai-hub/kb/external-decision-surface-governance.md`の段階でいうと、この文書は
**observation層**（1件の具体例と証拠）。3〜5件集まり、独立した案件で同じ機序が
再現するまでは、CLAUDE.mdへの追記・candidateへの格上げはしない。

## 記録する項目（1件ごと）

- **cluster**: 対象クラスタのファイル・行範囲
- **jev_output**: Jevが返した`should_merge`のスコア・confidence・`difference_kind`
- **final_decision**: 人間/AIが実際にCANONICAL CHECK13項目を通して下したDECLARED判定
- **jev_correct**: Jevの提示（高confidence→要確認、低confidence→握りつぶし）が
  最終判定と整合していたか
- **cost**: 実測した`usage.input_tokens`
- **notes**: 気づいたことがあれば

## Pilot #0（テンプレート、まだ実績なし）

- **cluster**: （未実施）
- **jev_output**: （未実施）
- **final_decision**: （未実施）
- **jev_correct**: （未実施）
- **cost**: （未実施）
- **notes**: 2026-09-18にPoC実装完了。実行にはTYPESAFE_API_KEYの取得（本人がウェイトリスト
  登録・APIキー発行）が必要なため、実際のスクリーニング結果はまだ記録できていない。
  `screen-duplicate-clusters-with-jev.mjs --selftest`は合格済み（純粋関数部分のみ検証、
  実際のAPI疎通は未検証）。

## 3〜5件貯まったら判断すること

- Jevの`confidence`閾値（現在: high≥0.75, low<0.5）は実測に基づいて調整が必要か
- 提示された高confidenceクラスタと、実際のDECLARED判定の一致率
- 1クラスタあたりの実測コスト（見積もりの3,000〜6,000入力トークンと合っているか）
- CANONICAL CHECK13項目のうち、今回はScore/Choice2問に絞ったが、追加すべき質問はあるか
- 常用する・候補(a)（CANONICAL CHECK全体への拡張）へ進む・打ち切る、のいずれにするか

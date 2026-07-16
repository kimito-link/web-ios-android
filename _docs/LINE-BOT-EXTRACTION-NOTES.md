# LINE Bot Kit化メモ — line-harness-oss からの移植記録

`templates/line-bot/` として移植した際の判断メモ。将来の改修・再移植時の参考。

## 出典と移植範囲

出典: `line-harness-oss`（`ai-shain.link` の LINE公式アカウント「AI社員りんく」で実運用中）。
出典側は`KIT-EXTRACTION-NOTES.md`で共通/固有を既に整理済みだったため、その分類をベースに、
**CRM機能（シナリオ配信・リッチメニュー・タグ・マルチアカウント）を完全に削ぎ落とし、
「LINE bot単体で会話できる」最小構成**に絞って移植した。

## 意図的に落とした機能

- マルチLINEアカウント対応（`line_accounts`テーブル・複数チャネル署名検証）→ 1キット=1アプリ=1公式アカウント前提に単純化
- `entry_routes`によるマルチプロダクト解決（`resolveBotProject`）→ 単一`knowledge-pack/`固定に単純化
- シナリオ配信・リッチメニュー・タグ管理・友だち一覧などの管理画面機能 → bot応答のみに特化
- `knowledge-packs/*.md` と Workers バンドル用 `*-knowledge-content.ts` の二重管理 →
  静的import（`import personaMd from '../knowledge-pack/persona.md'`）に一本化し、手動同期の罠を解消

これらが必要になったら`line-harness-oss`を直接参照する。このテンプレへの逆輸入はしない
（複雑化を避ける。CRM機能はアプリごとの要件差が大きく、汎用金型に向かない）。

## 実障害から反映した設計

- **fail-closed**: 例外・API失敗・予算超過のいずれでも、必ず固定の詫び文言を返信する
  （`console.error`のみで無言化する実障害があった。`worker/src/routes/webhook.ts`のtry/catch全パスで担保）。
- **`ai_reply_mode='human'`の放置検知**: エスカレーション後に人間対応へ切り替わったまま
  戻し忘れると無言に見える。この既知の罠をREADMEに明記。
- **`wrangler.toml`に`[vars]`を書かない**: 手動`wrangler deploy`のたびに本番環境変数が
  開発用プレースホルダーで上書きされる実障害があった。GitHub Actions経由のデプロイに統一し、
  秘密情報はすべて`wrangler secret put`で投入する設計に固定した。
- **LINE公式アカウント管理画面の「応答メッセージ」オフ必須**: ONのままだとLINE標準の
  定型応答がwebhookより先に割り込み、bot返信が届かない（原因特定に丸1日かかった実障害）。

## 実装日

2026-07-16

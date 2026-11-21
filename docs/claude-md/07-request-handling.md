> CLAUDE.md から移した節です。この中の backtick のパスはリポジトリ直下からの相対です。

## AIへの依頼の受け方

ユーザーが「このフォルダで 〇〇 というアプリを作って」と言ったら：

1. **まず [`app.config.json`](../../app.config.json) を一緒に埋める。**
   `<...>` のプレースホルダを、ユーザーに必要な情報を聞きながら埋める。
   わからない項目（ストアID等）は、まだ無ければ空のまま進めてよい。
1.5. **名前（`identity.displayName`）を決めたら、ドメイン・ロゴより先に商標を調べる。**
   J-PlatPat で第9類・第42類を調べて `store-assets/trademark-check.json` に残す（`node scripts/check-trademark.mjs --init`）。
   かぶったら名前の候補を変える。正本: [`docs/ai-rules/14_TRADEMARK_CHECK.md`](../ai-rules/14_TRADEMARK_CHECK.md)
2. **どのプラットフォームに出すか確認する。** 4つ全部か、一部か。
   - Chrome拡張を出さないなら `app.config.json` の `chrome.enabled` を false に。
3. **自動化スクリプト/CI/TWA は `templates/` に同梱済み。** そこからコピーして使う（後述）。
4. **品質ルールは「AI汎用ルール」に従う**（後述）。

---


# 実装ハンドオフ: kimito-skill.link を「CLAUDE.mdのWeb版」として成立させる

設計正本: [`DESIGN-claude-md-web-version-2026-09-01.md`](DESIGN-claude-md-web-version-2026-09-01.md)（必ず先に読む）
このリポ: `C:\Users\info\OneDrive\デスクトップ\Resilio\github\web-ios-android`

## 読む順
1. [`DESIGN-claude-md-web-version-2026-09-01.md`](DESIGN-claude-md-web-version-2026-09-01.md) 全文
2. `site/index.html`の`<nav class="page-map" id="page-map">`（669-687行付近）— 今回転用する既存パターンの実物
3. `site/learnings/index.html`（対象ファイル。h2が16個、目印文字列で検索して編集）

## スコープ（MVPから順に、2コミットに分ける）

### コミット1: learnings/に地図＋最近の更新＋全h2へid付与

1. `site/learnings/index.html`の全16個の`<h2>`にidを付与する。命名規則は設計書C-1
   （小文字英数字とハイフン、2〜4語ケバブケース、主題を表す名前）。既存の
   `id="multi-session"`はそのまま維持し、改名しない。
2. h1直下（`.sub`段落の直後）に、設計書C-2のHTML構造をそのまま挿入する：
   - `<section class="recent-updates" id="recent-updates">` — 直近の更新2〜3件を
     手動で書く（今日追加された「AIと迷路」「別プロジェクトAIとの協働実例」カードを含めてよい）
   - `<nav class="page-map" id="page-map">` — 全16件をアンカー＋役割1行で列挙
3. `<style>`内に`.page-map`系CSS（`site/index.html`の393-402行から丸ごとコピー）と、
   全対象id（`#recent-updates, #north-star, #ios-appstore, ...`全16+1個）に対する
   `scroll-margin-top: 72px;`を追加する。
4. ページ末尾にHTMLコメントで「カード追加時の運用手順」（設計書C-5の5ステップ）を埋め込む。

検証:
```bash
node scripts/verify-internal-links.mjs
```
緑になったらコミット。メッセージ例: `feat(learnings): 「このページの地図」と最近の更新を新設`

### コミット2: 検査スクリプト＋llms.txt

1. `scripts/verify-learnings-map.mjs`を新規作成（設計書C-3の4ルール）。
   既存の`scripts/verify-internal-links.mjs`や`templates/diagnostics/check-heartbeat-present.mjs`
   と同じ流儀（依存ゼロ、3値exit、`export function`で純粋関数を切り出し、`--selftest`で
   毒フィクスチャを2種類以上食わせて赤/緑の両方向を確認）で書く。
2. `package.json`に以下を追加：
   ```json
   "verify:learnings-map": "node scripts/verify-learnings-map.mjs",
   "verify:learnings-map:selftest": "node scripts/verify-learnings-map.mjs --selftest"
   ```
   （`:selftest`サフィックスをつけるだけで`scripts/verify-all.mjs`のselftestTasks()が
   自動収集する。個別登録は不要 — `scripts/verify-all.mjs:54-79`で確認済み）
3. `site/llms.txt`の`## Canonical pages`節に1行追加：
   ```
   - Verified field notes (index of all incident cards): https://kimito-skill.link/learnings/
   ```
   `## Two roles of this kit`節の直後に正本序列を3行追加（設計書C-4の文面をそのまま使う）。

検証（この順で全部緑にしてからコミット）:
```bash
node scripts/verify-learnings-map.mjs --selftest
node scripts/verify-learnings-map.mjs
node scripts/verify-internal-links.mjs
npm run verify
```
メッセージ例: `feat(diagnostics): learnings/の地図整合を検査するverify-learnings-map.mjsを追加`

## 完了判定（機械的）
- [ ] `node scripts/verify-learnings-map.mjs --selftest` が緑
- [ ] `node scripts/verify-learnings-map.mjs` が緑（16件のh2すべてが地図に載っている）
- [ ] `node scripts/verify-internal-links.mjs` が緑
- [ ] `npm run verify` が緑（verify-learnings-map:selftestが自動収集されていることを確認）
- [ ] ブラウザプレビューで「最近の更新」「このページの地図」を目視確認し、リンクが
      正しくジャンプすることを確認
- [ ] `git push`後、`npm run deploy:site`を実行（`CLOUDFLARE_API_TOKEN`環境変数が
      残っていると認証エラーになるので`unset CLOUDFLARE_API_TOKEN`してから実行）
- [ ] 本番URL `https://kimito-skill.link/learnings/` を開き、地図と最近の更新が
      実際に反映されていることを未認証状態（WebFetch等）で確認してから完了と報告する

## 地雷（設計書Fより転記・特に見落としやすいもの）
- id改名は禁止。特に既存の`multi-session`を触らないこと。
- 地図のアンカーとh2のid付与は**同一コミット**に入れる。片方だけだと
  `verify-internal-links.mjs`が正しく赤になるが、その赤に驚かないよう手順化しておく。
- 「最近の更新」は最大10行。10行を超えたら末尾（古い方）を削除する。全量索引は
  地図が担うので削除しても情報は失われない。
- learnings/のCSSは各ページ自己完結の現行流儀に従い、`site/index.html`との共通化
  （commonCSS化）はしない。今回はコピーで良い。
- `site/sitemap/`がJS描画で非JS読者に不可視という既存負債は、このタスクのスコープ外。
  触らない。

## 実装しないこと（設計書Eより）
- GitHub ActionsでのMarkdown→HTML自動ビルド
- Lunr.js等のクライアントサイド検索ライブラリ導入
- `<script type="text/markdown">`によるMarkdownのクライアント変換
- git logからの「最近の変更」自動生成
- sitemap-manifest.json方式（JSON+JS描画）の地図
- learnings/本文カードの日付順並べ替え
- llms.txtへの全カード一覧の掲載（ポインタ1行のみ）

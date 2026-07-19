# 引き継ぎ: walkthrough/play/ のSTEP分割方針を会議形式で検討する

> 前セッションでコンテキストが一杯になったため、ここで区切って引き継ぐ。
> ユーザーからの指示：「コンテキストウィンドウ一杯、引継ぎ後に会議」＝
> `/council-fable`（3段構えワークフロー：会議ハーネス→Fable設計→実装ハンドオフ）
> で分割方針を検討してから実装すること。

## 背景・進捗（済んでいること）

サイト全体のAI認識性向上プロジェクト（[`DESIGN-site-page-split-ai-discoverability-2026-07-17.md`](./DESIGN-site-page-split-ai-discoverability-2026-07-17.md)）は以下まで完了・本番反映済み：

- フェーズ1: 全13ページにmeta description・OGP追加
- フェーズ2: `howto/index.html`（旧1157行）をSTEP別4ページに分割
  （`howto/github/`, `howto/vercel/`, `howto/domain/`, `howto/cloudflare/`）。
  目次ハブ化・アンカー互換リダイレクトJS・HowTo JSON-LD・`common.css`新設。
  `scripts/verify-internal-links.mjs`新設（リンク切れCI検証）
- フェーズ3: トップLPの⑥けんこう診断を`features/health-check/`に独立ページ化、
  ショーケースを`showcase/`に一覧ページ化
- 追加対応（今回のユーザー指示「パンくずもつけて」）: 新規6ページ以外の
  既存10ページ（`guide/`, `troubleshooting/`, `tax/`, `learnings/`, `line-bot/`,
  `story/`, `walkthrough/`, `walkthrough/ios/`, `walkthrough/chrome/`, `lp/`）に
  視覚的パンくずナビ＋BreadcrumbList JSON-LDを追加済み・本番反映済み
  （コミット`41be9f7`）

## 残作業: walkthrough/play/index.html のSTEP分割

**現状**: 613行、`id="step-0"`〜`step-7"`＋`step-help`の**9つのstepブロック**を持つ
Google Play Console追体験ページ。まだパンくず・common.css参照ともに未対応。

**howto/との違い（判断が難しい理由）**:
- `howto/`のSTEP1〜4は独立した技術トピック（GitHub/Vercel/ドメイン/Cloudflare）で、
  分割してもそれぞれ単体で意味が通った
- `walkthrough/play/`の9ステップは**単一の連続ワークフロー**（Play Consoleで
  順番に進む一連の操作: 準備→①アプリの枠作成→②ダッシュボード確認→③AAB登録→
  ④2つコピペ→⑤申告を埋める→⑥本番送信→⑦条件付き→つまずいたら）。
  分割するとページ間遷移コストが増え、「今どのステップか」を見失うリスクがある
- 各stepには「今やること」「たぬ姉のURL案内」「表」等が密接に絡み合っており、
  `howto/`ほど機械的に切り出せる保証がない

**ユーザーが提示した3つの選択肢**（未決定・会議で検討すること）:
1. 9ステップを全部独立ページ化（`howto/`と同型）
2. 大きい区切り（3〜4ページ）にまとめて分割
   （例:「準備〜①枠を作る」「②〜③中身を載せる」「④〜⑥公開手続き」「⑦任意」）
3. 今回は分割せずパンくず・common.css参照のみ追加（分割は見送る）

## council-fableで検討してほしいこと

1. **Q1**: 単一連続ワークフロー型のページ（play/のような）を分割すべきか。
   `howto/`（独立トピック型）との構造的な違いを踏まえ、AI認識性向上の効果と
   ページ遷移コストのトレードオフを評価する。
2. **Q2**: 分割する場合、何ページ・どの区切りが最適か（3案を比較評価し、
   具体的なURL構造・見出し・引き継ぐべき文脈情報を提案する）。
3. **Q3**: 分割しない場合、単一ページのままでAI認識性を上げる代替手段は
   何か（例: ページ内`id`ごとのJSON-LD HowToStep化、パンくずのみ追加等）。
4. **Q4**: 同じ問題（連続ワークフロー型）を持つ他ページが無いか確認する
   （`walkthrough/ios/`530行も同様のstep構造の可能性がある。実地調査すること）。

## 実装時の地雷（設計から実装に進む場合）

- トップの「できること表」（claims-box）は絶対に動かさない
  （`scripts/verify-claims-coverage.mjs`が監視）
- `site/claims.json`とLP文言は同一コミットで同期する
- 分割する場合、`scripts/verify-internal-links.mjs`のRESERVED_HOWTO_IDS的な
  「予約id」パターンを`walkthrough/play/`にも必要なら追加する
- 新規ページ作成時は`common.css`を参照し、固有スタイルのみ`<style>`に残す
  （二層構成の方針を維持）
- 既存の`walkthrough/ios/index.html`にも同様の分割余地があるなら、
  ついでに調査だけでもしておくと次の手戻りを防げる

## 次のアクション

**実装はまだ行っていない。** 次のチャットで`/council-fable`を呼び、
このファイルのフルパスを渡して「これを読んで、会議で分割方針を検討して」
と依頼する。

# 00_START_HERE

このパッケージは、**開発者にそのまま渡せる AI 実装ルールセット**です。  
最短で使う場合は、以下 3 ステップだけ実施してください。

## 最短導入（5分）

1. `01_CORE_RULES.md` をプロジェクトの共通ルールとして採用する  
2. `templates/AI_INSTRUCTIONS_TEMPLATE.md` を `docs/AI_INSTRUCTIONS.md` として作成する  
3. AI への依頼時に「`docs/AI_INSTRUCTIONS.md` を読んでから実装」と明示する

## 必須URL/SEOルール（このパッケージの固定方針）

- URL はディレクトリ形式を優先（例: `/price/`, `/contact/`）
- `index.html` を公開URLに出さない
- `www` あり/なしを統一（推奨: `www` なし）
- `http` から `https` へ 301 リダイレクト
- 正規URLは canonical で明示

## 含まれるファイル

- `README.md` : 全体像と運用方法
- `01_CORE_RULES.md` : 人間/AI 共通の実装ルール本体
- `02_WORKFLOW.md` : 実装〜レビュー〜デプロイの標準手順
- `03_REVIEW_CHECKLIST.md` : 最終チェックリスト
- `templates/` : プロジェクトへコピーして使うテンプレート
- `examples/PROMPT_EXAMPLES.md` : AI 依頼文の実例

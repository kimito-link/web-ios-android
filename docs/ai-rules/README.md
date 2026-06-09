# AI汎用ルール Developer Pack

開発者向けに再整理した、**人間にも AI にも読みやすい運用パッケージ**です。  
既存の各ルールの思想を維持しつつ、導入順・責務・チェック観点を明確化しています。

## 目的

- 実装品質のブレを減らす
- 重複実装と手戻りを減らす
- レビューとデプロイの再現性を上げる
- URL/SEO の基本方針をチームで固定する

## 推奨フォルダ配置（導入先プロジェクト）

```text
project-root/
  DESIGN_PRINCIPLES.md
  docs/
    AI_INSTRUCTIONS.md
    COMPONENT_REGISTRY.md
    COMMON_MISTAKES.md
```

## 運用ルール（要点）

1. 実装前に `AI_INSTRUCTIONS.md` と `DESIGN_PRINCIPLES.md` を読む  
2. 新規コンポーネント追加時は `COMPONENT_REGISTRY.md` を更新  
3. 発生したミスは `COMMON_MISTAKES.md` に即時追記  
4. PR 前に `03_REVIEW_CHECKLIST.md` を全項目確認

## 固定のWebルール

- **レスポンシブ前提**: 主要ブレークポイントで崩れない設計にする
- **URL設計**: `/price/` 形式を採用し、`index.html` は公開しない
- **ホスト統一**: `www` の有無を1つに統一（推奨: 非 `www`）
- **プロトコル統一**: `http` は必ず `https` へ 301 転送

## 注意

- 本パックは「運用テンプレート」です。プロジェクト固有の値は `templates/` から展開して埋めてください。
- ルールは短く保ち、例は具体的に書くと AI の再現率が上がります。

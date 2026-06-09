# PROMPT_EXAMPLES

## 実装依頼（基本）

```text
次の機能を実装してください: [機能名]
実装前に docs/AI_INSTRUCTIONS.md と DESIGN_PRINCIPLES.md を読んでください。
既存コンポーネントを再利用し、重複実装はしないでください。
レスポンシブ対応を前提にしてください。
```

## URL要件つき依頼

```text
以下のページを追加してください。
- 正規URL: /price/
- index.html は公開URLに含めない
- wwwなしを正規ホストに統一
- httpアクセス時はhttpsへ301転送
実装後に検証手順も提示してください。
```

## レビュー依頼

```text
今回の変更をレビューしてください。
重点観点:
1) 要件準拠
2) 重複実装の有無
3) レスポンシブ崩れ
4) URL/SEO方針（/price/、index.html非表示、www統一、http→https）
5) セキュリティ
```

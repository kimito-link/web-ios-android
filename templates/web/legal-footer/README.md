# legal-footer/ — kimito.link 系サービス共通の「LP 用フッター」

## 何のためのものか
LP（ランディングページ）の末尾に、全サービスで同じ **運営表記＋法務への導線** を出す。

```
<サービス名>は、kimito-link.com（Kimito-Link Project）と同じ運営による公式サービスです。
利用規約 ・ プライバシーポリシー ・ 特定商取引法に基づく表記 ・ お問い合わせ   ← 実在するページだけ
```

★きっかけ（2026-10-04 に本番5サイトを実測）: kimito.link 本体のフッターには運営表記と法務リンクがあるのに、
姉妹サービスの LP には無い・文字だけ・プライバシーのみ、とバラバラだった。ストア審査・利用者の安心の
両面で効く最低ラインなので、ここを共通にした。**kimito.link 本体と同じ「ヘッダー」までは強制しない**
（アプリ型の画面に合わないため）。

## 使い方（静的HTMLのLP）
1. `kimito-legal-footer.js.example` を `kimito-legal-footer.js` として **無改変で** コピーする
2. LP の `</body>` 直前に1行:
   ```html
   <script src="/js/kimito-legal-footer.js"
           data-service-name="サービス名"
           data-terms="/terms/" data-privacy="/privacy/"></script>
   ```
   - `data-tokusho` / `data-support` は任意。**実在するページだけ**渡す（無い項目は出ない）
   - `<div id="kimito-legal-footer"></div>` を置けば、その場所に出る
3. `kimito-legal-footer.test.mjs.example` を tests/ にコピーし、冒頭の `FOOTER_JS` を実際の場所に直す
4. このキットの `_docs/instruments/check-drift.mjs` の PAIRS にコピー先を追記する（同期を見張る）

## Expo(React Native) など素のJSを使えない場合
同じ **文言・順序** の別実装を作る（実例: `doin-challenge.com/lib/legal-footer-content.ts` と
`components/organisms/lp-legal-footer.tsx`）。文言の一致は、そのサービス側のテストで見張る。

## 実装時に踏んだ罠
- `<footer>` タグで描画すると、各LPの `footer { … }` のCSSを拾う → `div` + `role="group"` にした
- 色は既定で継承する（単色背景のLPならそのまま馴染む）。**背後が写真・グラデーションのLPでは文字が読めなくなる**
  （2026-10-04 surechigai の本番で実測: 暗い風景の上に暗い文字）。LP側のCSSで `--klf-bg` / `--klf-fg` を渡す
  （例: `:root { --klf-bg: #efe7d6; --klf-fg: #3a352c; --klf-z: 5; }`）。部品は書き換えない。適用後は実画面で読めるか確かめる
- ★背景の写真が `position:fixed`（z-index 付き）で全面に敷かれているLPでは、**色を渡しても隠れる**
  （2026-10-04 surechigai: 計算上は紙色なのに画面では風景が上に被さっていた。`pointer-events:none` の固定レイヤーは
  `elementsFromPoint` に出ないので、要素の重なりを調べても見つからない）。部品は `position:relative; z-index:var(--klf-z,1)`
  を持つので、必要なら LP 側で `--klf-z` を上げる。**確認は `getComputedStyle` ではなく実画面のスクリーンショットで行う**
- 禁止語ゲート（diff-check）は **差分の前後3行の既存コード** も見る。既存の文の近くに挿入すると、
  自分が書いていない語で落ちる → 該当行から4行以上離れた位置に挿入する
- 共通化したのは「運営表記＋法務への導線」だけ。特定商取引法の表記が要るか（課金の有無）は事業判断
  なので、部品側では決めない（`data-tokusho` を渡したときだけ出る）

## 適用状況（2026-10-04）
| サービス | 方式 | 渡している法務ページ |
|---|---|---|
| surechigai-romi.link | 素JS（`public/lp/`） | 利用規約・プライバシー |
| yukkuri-exosome.link | 素JS（`src/js/`） | プライバシー（利用規約ページが未作成） |
| kimito-Link-Voice | 素JS（`js/modules/`） | 利用規約・プライバシー（特商法ページは未作成） |
| doin-challenge.com | RN実装（別実装） | 利用規約・プライバシー |

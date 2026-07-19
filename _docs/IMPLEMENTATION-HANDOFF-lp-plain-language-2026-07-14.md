# 実装ハンドオフ: LP平易化＋GitHub離脱リンク解消

> この1枚だけで着手できる。設計の背景・裏取り根拠は
> [`DESIGN-lp-plain-language-2026-07-14.md`](./DESIGN-lp-plain-language-2026-07-14.md) 参照。
> 実装は**まだ行っていない**。次チャット/別モデルでここから着手する。

## 読む順

1. このファイル（着手手順）
2. `DESIGN-lp-plain-language-2026-07-14.md`（設計の全体像・捨てた案の理由）

## スコープ（これ以外はやらない）

- `site/index.html`の975〜981行目（販売カード）の構造変更＋文言差し替え
- `site/index.html`のclaims表（888〜907行目付近）の文言差し替え
- `site/index.html`のChromeカード（947行目付近）の文言差し替え
- ⑥ステップtip（880行目付近）のファイルパス表記削除
- `site/claims.json`のlabel同期
- 新規ページ・新規CSS・新規JSは作らない

## 着手手順

1. ブランチ作成: `feat/lp-plain-language`（前回の`feat/web-domain-connect`はmainにマージ済みなので
   最新mainから分岐する）
2. `site/index.html`975〜981行目の`<a class="more-card">`（販売カード）を`<div class="more-card">`に
   変更（`cursor:default`を明示）。内部に`▼くわしく見る`トグル（既存`toggle-btn`/`step-detail`クラス）
   と、既存`.fbox`/`.farr`絵文字フロー図（🛒買う→💳お金が届く→📧お礼メール）を追加。GitHubリンクは
   `.tip`ボックス内に「🔧 エンジニア向け」注記＋`rel="noopener"`付きで残す。DESIGN.md §A の
   HTMLサンプルを参照
3. `site/index.html`947行目付近のChromeカード文言を「初回だけGoogleの画面でログインを許可 →
   2回目からはAIに頼むだけ」に差し替え
4. `site/index.html`のclaims表4行（`data-claim="cloudflare-domain-connect"` /
   `"cloudflare-auth"` / `"apple-developer-registration"` / `"google-play-console-registration"`）
   の`.claim-label`テキストをDESIGN.md §Bの新文言に差し替える。`data-claim`属性は絶対に消さない
5. claims表のバッジ「🤝 一緒に」を「🤝 AIと一緒に（最後のボタンだけあなた）」に差し替え
6. ⑥ステップの`.tip`内`docs/ai-rules/04_SELF_VERIFICATION.md`というファイルパス表記を
   「キットに入っている説明書（AIが読む用）」に言い換える
7. claims-boxのタイトル直下に、こん太の1行ツッコミを追加（`.step-char`で使っている
   `images/konta-smile.png`を再利用してよい。新規セクションにしない・1行に収める）
8. `site/claims.json`のlabel 4件を手順4と同じ新文言に同期する（`level`/`verify`は変更しない）
9. （任意）`site/claims.json`に`stripe-checkout-template`claim（`level: "assisted"`, `verify: null`）
   を追加し、販売カードのdivに`data-claim="stripe-checkout-template"`を付与する
10. `node scripts/verify-claims-coverage.mjs`を実行し、exit 0を確認する

## 機械的な完了判定

- `node scripts/verify-claims-coverage.mjs`が exit 0
- `site/index.html`内に`https://github.com/`を含む`<a>`タグが存在する場合、必ず`rel="noopener"`を
  持つこと（grepで確認）
- ブラウザプレビューで、販売カードをクリックしてもページ遷移しない（トグル開閉のみ）ことを確認
- モバイル幅（375px）でレイアウト崩れがないこと（`resize_window`で確認）

## 地雷（実装時に踏むと事故る）

- `<a class="more-card">`→`<div>`化でhoverスタイルが崩れないか確認する（`cursor:default`を明示）
- claims.jsonのlabel変更時、`data-claim`属性を消さないこと（消すと`verify-claims-coverage.mjs`の
  RULE 1が赤になる）
- `site/index.html`と`site/claims.json`は必ず同一コミットで変更する（正本のズレを作らない）
- 固有名詞（Cloudflare/Stripe/App Store等）を完全に消さない。初出1回は「固有名詞（ひとこと説明）」
  形式で残す（実際のセットアップ画面で利用者が迷子にならないため）
- `site/index.html`の編集はEdit等のエディタツールで行う（PowerShell経由の文字列置換はShift-JIS
  誤読の既知地雷があるため使わない）

## 次のアクション

**実装はここでは行わない。** 次チャット、または実装担当の別モデルに、このファイルのフルパスを渡して
「これを読んで、ブランチを切って実装して」と依頼する。

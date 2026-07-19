# 設計: LPを「小学生でもわかる」レベルに平易化＋GitHub離脱リンクの解消

> 設計=Fable(claude-fable-5) ／ 素材収集=会議ハーネス(5体・1体レート制限で欠落) ＋ Explore実地調査 ／
> 裏取り=司令塔(Claude) ／ 日付=2026-07-14 ／
> [council-fable 3段構えワークフロー](../../COUNCIL-HOWTO.md)の手順2〜3の産物。
> 実装は**まだ行っていない**。次チャット/別モデルで着手する前提。

## お題と背景

`site/index.html`（アプリ制作自動化キットの紹介LP）を「小学生でもわかる」レベルまで平易にし、
LPからGitHubの開発者向けページへ直接飛んでしまうリンクを解消する。

LPは既に複数回わかりやすさ改善を実施済み（見出し矛盾解消・キャラクター3人の役割固定・専門用語の
言い換え・「もっと知りたい」の3グループ化）。直近セッションで「独自ドメイン接続機能」を追加した際、
「もっと知りたい」に追加した新カード「買い切り課金＋購入完了メールの金型」のリンク先が
`https://github.com/kimito-link/web-ios-android/tree/main/templates/stripe-checkout-email`
というコード・Markdownだらけの開発者向けGitHubページであり、非エンジニアがクリックすると
理解不能な画面に飛ばされて離脱する問題が判明した（Explore実地調査で確認・サイト内リンクは全て
実在しリンク切れ無し、問題はこのGitHubリンク1箇所と残存する専門用語）。

## 会議ハーネスで判明した対立点（Fableが裁定）

- lead案「要約ページ新設＋GitHubを補助リンク化」、批判役「GitHub完全削除・技術構成に一切言及しない」、
  発散役「Simple/Developerトグルの奥に隠す」の3案が対立。
- Fableの裁定: **「カードをその場で開く解説」化＋GitHubは注記付き補助リンクに格下げ**（新規ページ・
  新規UIともにゼロ）。既存の`▼くわしく見る`トグル部品（`toggle-btn`/`step-detail`）をそのまま使う。
  完全削除は「できること・できないこと（正直に）」というLPのトーンと矛盾し証拠リンクの価値も失う。
  トグル型は過剰設計（JS状態管理・全文二重メンテ）。要約ページ新設は説明量に対して大掛かりすぎる。

## 採用する設計

### A. GitHubリンクの扱い

975〜981行目の`<a class="more-card">`カードを`<div>`カードに変更し、`▼くわしく見る`トグルの中に
既存の`.fbox`/`.farr`絵文字フロー図（🛒買う→💳お金が届く→📧お礼メール）と平易な説明文を入れる。
GitHubリンクは詳細内の`.tip`ボックスに「エンジニア向け」注記付きで残す（`rel="noopener"`を付与）。
完全に隠さず「読まなくても使えます」と期待値設定することで、好奇心クリックからの離脱を防ぐ。

### B. 専門用語の言い換え確定リスト

| 場所 | 旧 | 新 |
|---|---|---|
| 販売カード本文 | Stripe決済→Cloudflare Pages Functions→Resendでダウンロード案内メールを自動送信 | 「買ってもらう → お金を受け取る → お礼メールが自動で届く、までぜんぶ自動」（Cloudflare Pages Functions/Resendは本文から削除。Stripeのみ詳細内で「Stripe（ストライプ）という決済サービスにおまかせ」と1回だけ登場） |
| Chromeカード | OAuth 初回セットアップ → 以降 zip + publish の2コマンド | 「初回だけGoogleの画面でログインを許可 → 2回目からはAIに頼むだけ」 |
| claims表(cloudflare-domain-connect) | 独自ドメインをCloudflare Pagesへワンコマンドで接続 | 「自分だけのアドレス（独自ドメイン）をサイトにつなぐのは、指示1回だけ」 |
| claims表(cloudflare-auth) | Cloudflareへのログインはブラウザでワンクリック（トークンのコピペ不要） | 「Cloudflare（サイト置き場）へのログインはブラウザで1クリック（長い暗号みたいな文字のコピペは不要）」 |
| claims表(apple-developer-registration) | Apple Developer Program登録（年会費・2FA） | 「Appleの開発者登録（App Storeにアプリを出すための会員登録。年会費あり・本人確認あり）」 |
| claims表(google-play-console-registration) | Google Play Console登録 | 「Googleの開発者登録（Google Playにアプリを出すための会員登録）」 |
| claims表バッジ | 🤝 一緒に | 「🤝 AIと一緒に（最後のボタンだけあなた）」 |
| ⑥ステップtip | 仕組みの正体は `docs/ai-rules/04_SELF_VERIFICATION.md`（AIが読む用）にあります | 「仕組みの正体はキットに入っている説明書（AIが読む用）に書いてあります」（ファイルパスをLP本文から排除） |

判定基準: ①既存語彙「めんどくさい」「〜だけ」と地続き ②固有名詞は完全に消さず初出時に括弧で
残す（本番のセットアップ画面で実物と再会したときに迷子にならないため） ③1概念1訳語。
比喩的な言い換え（「決済の自動伝票機」等）は新しい概念を覚えさせるため不採用、フロー図で流れを
見せる方式を採用。

### C. 追加の平易化手法（既存資産の延長）

1. 既存の`.fbox`/`.farr`絵文字フロー図部品を販売カードの詳細に流用（新規CSSゼロ）
2. claims-boxのタイトル直下に、こん太（初心者の疑問代弁役）の1行ツッコミを追加：
   「こん太『で、結局ぼくがやるのはどれ？』→ ✋マークの3つだけ！」。新規セクションは作らない。

### D. claims.json / verify-claims-coverage.mjsとの整合

- RULE 1（LP⇔claims.jsonの言及チェック）は`data-claim`属性を最優先で見るため、claims表の文言を
  書き換えても属性を残す限り緑になる。ただし**claims.jsonのlabelとLPの文言をズレたままにしない**
  ため、claims.jsonのlabel 4件（cloudflare-domain-connect / cloudflare-auth /
  apple-developer-registration / google-play-console-registration）を上表Bの新文言に同期する
  （levelとverifyは変更なし）。
- 任意: 販売テンプレ機能は現在claims.jsonに無いため、`{ "id": "stripe-checkout-template", "label":
  "買ってもらう → お金を受け取る → お礼メールが自動で届く", "level": "assisted", "verify": null }`
  を追加し、カードのdivに`data-claim="stripe-checkout-template"`を付与する。assistedなので実行
  検証は走らない。
- 変更後は`node scripts/verify-claims-coverage.mjs`を実行し緑を確認する。

## 変更対象ファイル

- `site/index.html` — 販売カードの構造変更（A）、文言差し替え（B）、こん太1行＋フロー図（C）。
  新規ページ・新規CSS・新規JSなし（`toggle()`/`.fbox`/`.tip`はすべて既存で実在確認済み）。
- `site/claims.json` — label 4件同期＋（任意）stripe-checkout-template claim追加。
- 新規ファイル: なし。

## 捨てた案と理由

| 案 | 理由 |
|---|---|
| GitHubリンク完全削除 | 「正直に」というLPのトーンと矛盾。証拠リンクの価値を失う |
| Simple/Developerビュートグル | JS状態管理＋全文二重メンテの過剰設計。既存トグル部品で狙いは達成可能 |
| 要約ページ新設 | 説明量がフロー図＋2行で足りるため、ページを増やす理由がない |
| 比喩系の言い換え（決済の自動伝票機・本人確認のパスポート等） | 新しい比喩を覚えさせるのは平易化の逆。固有名詞は括弧で残す方針を採用 |

## 地雷と回避策

1. `<a class="more-card">`→`<div>`化の副作用: hoverスタイルがリンク前提の可能性があるため
   `cursor:default`を明示し、クリック領域はトグルボタンに限定する
2. claims.json label変更時のドリフト検出穴: RULE 1は`data-claim`があるとlabel不一致を検出しない。
   index.htmlとclaims.jsonは**必ず同一コミット**で変更し、直後にverifyを実行する
3. `data-claim`属性の消失に注意（消すとRULE 1が赤になる。fail-closedなので気づけるがCIを赤にしない）
4. 固有名詞の完全消去は避ける（Cloudflare/Stripe/App Storeの名前を消すと、実際のセットアップ画面で
   利用者が「聞いてない画面だ」と不安になる。初出1回は「固有名詞（ひとこと説明）」形式で残す）
5. GitHubリンクに`rel="noopener"`を付与する（現行は未指定）
6. 文字コード: index.htmlはUTF-8日本語。PowerShell経由の文字列置換はShift-JIS誤読の既知地雷が
   あるため、編集はエディタ系ツール（Edit）で行う

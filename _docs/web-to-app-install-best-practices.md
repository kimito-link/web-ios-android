# Web→アプリDL導線 ベストプラクティス ナレッジベース

ホームページ/LP から iOS・Android アプリの **インストールを最大化** するための導線設計KB。
対象: 日本市場・日本語UX中心、無料（課金なし）のセルフケア/健康習慣系アプリ。
金型は [`../templates/web/`](../templates/web/)。

> **出典の質**: バッジ規定（Apple/Google公式）・Firebase Dynamic Links停止・健康アプリ要件は
> **一次情報（Apple/Google公式）で確証**。CTA配置/反復/単一化/スティッキー/PWA摩擦は
> マーケティングブログ起点で外部A/Bテスト事例の裏付けあり（数値は方向性の根拠として扱い、
> 自サイトで必ずA/Bテストする）。調査時点 2026-06。バッジ規定は随時更新されるため実装前に再確認。

---

## TL;DR

1. **公式バッジを使う・自作ボタンで代替しない**（Apple/Google公式、確度高）。
2. **両バッジは同じ高さに揃え、Google を Apple より小さくしない**（Google公式、確度高）。
3. **Apple の "App Store" は英語のまま**。日本語化されるのは「Download on the」→「で入手」部分のみ。
4. **CTAはファーストビュー固執より、文脈を読ませた後＋反復配置**（健康系は安心材料を読んでから決める）。
5. **主要CTAは1つに絞る**（複数CTA競合は避ける）。
6. **UAでストア出し分け**（iOS→App Store / Android→Play / PC→両方）。
7. **iOS Smart App Banner はメタタグ1行**でSafariに純正バナー（SDK不要）。
8. **Firebase Dynamic Links は 2025-08-25 に完全停止**。新規採用厳禁、既存リンクは404。
9. **PWAは主役にしない**（ホーム追加操作が不明瞭で離脱）。ネイティブDLを主、PWAは補助。
10. **健康アプリは Google Play で申告フォーム＋公開URLのプライバシーポリシー必須**。

---

## 1. 公式バッジ（最重要・規約準拠）

- **Apple**: 公式バッジを使用必須。`"App Store"` は常に英語、翻訳・独自ローカライズバッジ作成は禁止。
  apple.com のアイコン/ロゴ/画像の流用も禁止。日本語バッジの表記は **「App Storeで入手」**。
  > Apple Marketing Guidelines: *"The service mark App Store always appears in English. Never translate App Store or create your own localized badge."*
  - 出典: https://developer.apple.com/app-store/marketing/guidelines/
- **Google**: ダウンロード誘導には primary logo lockup ではなく **「Get it on Google Play」バッジ**を使う。
  他ストアバッジと並べる場合、**Google バッジは同サイズか、それ以上**にする。
  > *"make sure the Google Play badge is the same size or larger than the other badges."*
  - 出典: https://partnermarketinghub.withgoogle.com/brands/google-play/visual-identity/badge-guidelines/
- **取得元URL**（`fetch-store-badges.mjs` で再現）:
  - Apple: `https://toolbox.marketingtools.apple.com/api/v2/badges/download-on-the-app-store/black/ja-jp`
  - Google: `https://play.google.com/intl/ja/badges/static/images/badges/ja_badge_web_generic.png`

## 2. CTAの配置・個数

- **ファーストビュー固執は誤り**（"主要CTAは必ず above the fold" は反証 0-3）。高意図ユーザー向けには
  上部が有効だが、**文脈・機能説明・社会的証明が必要な場合は下部CTAの方が高CVR**。
  長いページは**キー情報セクションごとに同一CTAを反復**。
  - 出典: landingpageflow.com / bitly.com（A/Bテスト事例: 下部CTA +20〜304%, Moz +52%）
- **主要CTAは1つに絞る**（"Download/Watch Demo/Subscribe" を同時に並べない）。
  Unbounce 18,639ページ分析で単一CTAページが最高CVR。
  - 出典: tyrads.com / Unbounce
- **スティッキー/フローティングCTAはモバイルで強い**（親指ゾーンに常時表示）。
  - 出典: landingpageflow.com / Online Dialogue（モバイル29%勝率）

## 3. デバイス出し分け

- UAで **iOS→App Store単独 / Android→Play単独 / PC等→両方** を出し分けると摩擦が下がる。
- iPad（iPadOS 13+ は `MacIntel` を名乗る）は `maxTouchPoints>1` で iOS 扱いにする。
- 両方並べる場合、CSSで高さを統一し Google を小さくしない（§1のGoogle要件）。

## 4. Web→ストア→初回起動の摩擦低減（技術）

- **iOS Smart App Banner**: `<meta name="apple-itunes-app" content="app-id=..., app-argument=...">` の
  1行で iOS Safari に純正バナー。SDK不要。**ただしメタタグ単体では deferred deep link は提供しない**
  （「新規ユーザーに文脈保持」主張は反証 0-3）。Safari 以外・Android では作用しない。
  - 出典: airbridge.io / branch.io
- **Firebase Dynamic Links は 2025-08-25 に完全停止**。既存リンクは HTTP 404。
  失われた3機能 = deferred deep linking / クロスプラットフォームルーティング / クリック・インストール計測。
  → **新規は絶対に使わない**。deferred deep link が要るなら **Branch / AppsFlyer(OneLink) / Airbridge** 等のMMPへ。
  （※「GoogleがOneLinkを公式推奨代替に指定」は反証 0-3。Googleは特定ベンダーを公式推奨していない。）
  - 出典: firebase.google.com/support/dynamic-links-faq / appsflyer.com / airbridge.io
- 無料アプリでも、Web上の選択を初回起動に引き継ぐ等のパーソナライズをするなら MMP 導入を検討。

## 5. PWA vs ネイティブDL の両立

- **PWAは主役にしない**。ホーム画面追加は明示操作が必要で、やり方を知らないユーザーが多く離脱要因。
  主要CTAはネイティブのストアバッジ、PWAは「ブラウザで今すぐ使う」程度の補助に留める。
  - 出典: mynavi-creator.jp ほか

## 6. 信頼性・健康アプリ要件（日本）

- **Google Play の健康アプリ**:
  (a) Play Console「アプリのコンテンツ」で **健康アプリ申告フォーム記入必須**、
  (b) プライバシーポリシーは **地理制限なし・アクセス制限なしの公開有効URL（PDF不可・編集不可）**。
  > Google Play Console ヘルプ（ja）: *"プライバシー ポリシーは必ず…一般公開の有効な URL（PDF は不可）で参照可能、かつ編集不可に…"*
  - 出典: https://support.google.com/googleplay/android-developer/answer/12261419?hl=ja
- 健康/セルフケア系は **データの扱い（端末内のみ・第三者提供なし・登録不要）を平易な日本語で明記**し、
  導線の安心材料に転用する。

## 7. 計測（未解決・要追加調査）

- ATT / 個人情報保護法下で Web→ストア遷移→インストール→初回起動を結合計測する具体手法
  （SKAdNetwork/AdAttributionKit、Google Play Install Referrer、MMPの deferred/probabilistic）は
  本KB調査では実装詳細まで未確定。導入時に各MMP一次ドキュメントを参照する。

---

## 反証された「定説」（やってはいけない/信じない）

| 定説 | 判定 | 正しい理解 |
| --- | --- | --- |
| 主要CTAは必ずファーストビューに置く | ✗ 0-3 | 文脈が要る商材は下部/反復の方が高CVR |
| Firebase Dynamic Links を使う | ✗（停止済） | 2025-08-25 完全停止・404。MMPへ移行 |
| Smart App Banner のメタだけで deep link 文脈を引き継げる | ✗ 0-3 | メタ単体では deferred deep link 不可 |
| Google は言語一致のローカライズバッジ使用を義務化 | ✗ 0-3 | 言語一致の義務は確認できず |
| Google が OneLink を公式推奨代替に指定 | ✗ 0-3 | 特定ベンダーの公式推奨はない |

---

## 適用チェックリスト（新規アプリで Web 導線を作るとき）

- [ ] `fetch-store-badges.mjs` で公式バッジを取得（改変しない）
- [ ] CSS で両バッジ 48px 統一（Google ≧ Apple）
- [ ] `<head>` に `apple-itunes-app` メタ（app-id / app-argument）
- [ ] UA 出し分け（iOS/Android/PC）＋ Capacitor内は非表示
- [ ] 主要CTAは1つ。機能/社会的証明/プライバシーの各節後に反復配置
- [ ] 健康系なら Play 申告フォーム＋公開URLプライバシーポリシー
- [ ] FDL を使っていない（使っていたら即移行）
- [ ] 公開後、実トラフィックで配置/文言をA/Bテスト

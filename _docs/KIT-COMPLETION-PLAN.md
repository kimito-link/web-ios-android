# web-ios-android キット完成化計画（5年後に楽できるレベル）

2026-06-12 策定。kimito「全部、5年後に楽できるレベル」。dns-osint アプリ化(web-health-check-app)で
得た実証知見 + partnership/Exosome/fujisan の現物を、**キット単体で完結する形**に集約する。

## 現状の核心問題 → ✅ 大半は解消(2026-06-12)

旧前提: 「iOS/Android 自動化スクリプト本体はキットに無く、毎回 partnership/Exosome から手コピー」。
これが5年後に楽できない原因だった:
- 参照元リポが改修/移動/削除されるとキットが壊れる
- コピー忘れ・置換忘れ(bundleId等のハードコード残り)
- `templates/scripts/patch-ios-launch-dark.mjs` が PlistBuddy(mac専用)依存でWindowsで動かない

**現状**: Step1〜5 完了で scripts/CI/TWA/却下KB/lint/スクショを `templates/` に同梱。
参照元への手コピーは不要(出典として残すだけ)。patch も PlistBuddy 不在フォールバック済み。
残るのは setup-new-app.mjs ワンコマンド化のみ(下記 Step6 残課題)。

## 完成の定義

**キットだけで他アプリを1本立ち上げられる**。参照元への手コピー不要。app.config.json を埋めて
スクリプトを順に叩けば Web/iOS/Android/Chrome の提出まで到達。Windows でも全工程が回る。

## 実証済みの参照元(移植元の地図)

| 役割 | リポ | 取り込むもの |
|---|---|---|
| 最上位完成形 | partnership_program_website | CI 21本, scripts/*.mjs+*.ps1, app.config.schema, 却下KB(_docs/apple-reject-*), 審査前lint |
| 最小金型 | Exosome | TWA(android-twa/), 3本CI, setup-new-app.mjs |
| 教訓 | fujisan-clean | 黒画面原則(触らない・教訓のみ) |
| 今回の実証 | web-health-check-app | Windows対応patch, PWA manifest+icon生成(sharp), docs/APP-AUTOMATION-PLAN |

## おすすめ実装順（各ステップ別ターン・最小トークン）

### Step1: Windows対応 patch を即修正【確実・低コスト】✅完了
- `templates/scripts/patch-ios-launch-dark.mjs` を PlistBuddy 不在フォールバック版に差替済み
  (hasPlistBuddy判定→無ければ Info.plist 文字列編集)。LaunchScreen側は既に node なのでOK。
- 効果: キットの patch が Windows/Linux/mac 全対応に。

### Step2: iOS/Android 自動化スクリプト本体をキットに取り込む【核心】✅完了
- partnership `scripts/` から汎用性の高いものを `templates/scripts/` へ取り込み済み:
  appstore-submit / play-publish / asc-create-app / asc-review-check / lint-pre-submission /
  generate-store-assets / release-bump / lib/{asc-api,play-api,app-config,asc-pricing,
  asc-screenshot-upload,asc-rejection-classify}.mjs
- すべて app.config.json 駆動(env 優先→config フォールバック)。実物 grep で生のアプリ固有値の
  混入なしを確認(bundleId/playPackageName/ascAppId/Team ID はプレースホルダ or config 参照)。
- 効果: 「対応表から手コピー」を廃止。キット同梱に。

### Step3: CI workflow を汎用テンプレ化して取り込む ✅完了
- partnership `.github/workflows/` の release/poll/lint/cert-expiry を `templates/workflows/` へ:
  ios-appstore-release / android-play-release / ios-pre-submission-lint / asc-review-poll /
  play-review-poll / apple-cert-expiry。
- PLAY_PACKAGE_NAME / APP_BUNDLE_ID / APPLE_TEAM_ID は `<...>` プレースホルダ or secrets 化。
  各ファイル冒頭に「app.config.json のどの値で置換するか」を明記。
- 効果: 新アプリは workflows をコピーして `<...>` を埋め Secrets を入れるだけで CI 稼働。

### Step4: TWA(Android) テンプレを取り込む ✅完了
- `templates/android-twa/` に Exosome 構成(twa-manifest / gradle.properties / 署名注入
  android-patch-signing.mjs)+ bubblewrap 手順 + Windows用 ps1
  (create-android-keystore / print-android-fingerprint / build-android-aab) を取り込み済み。
- packageId / productionDomain / assetlinks 等は `<...>` プレースホルダ or app.config 参照。
- 効果: mac 不要 Android が金型化。

### Step5: 却下対応KB + 審査前lint + スクショ自動化【Fable活用】✅完了
- `_docs/apple-reject-knowledge-base.md` を集約(実際に通った返信文=Fableの学習素材)。
- lint-pre-submission(絵文字混入・bundleId 整合等の事前検出) + capture/frame screenshots
  (capture-appstore-screenshots / capture-play-screenshots / frame-appstore-screenshots /
  screenshot-plan.example.json) を `templates/scripts/` へ取り込み済み。

### Step6: site/ 公開サイトの実態合わせ + setup-new-app ウィザード ✅実態合わせ完了
- 「全自動の魔法の箱」誇大表現を実態(提出まで自動・GUI最終操作あり)に統一。
  site/index.html のヒーロー「まるごと肩代わり」「送信して待つだけ」「ほぼナシ」等を是正。
  START-HERE / guide / howto は元から実態ベースなので整合確認のみ。
- ✅ `setup-new-app.mjs` 取り込み完了(2026-06-13): `templates/scripts/setup-new-app.mjs`。
  Exosome版をキットの実体に合わせ汎用化(Python依存を除き node の generate-store-assets.mjs を呼ぶ)。
  app.config.json 検証→資産生成→TWA初期化案内→GitHub Secrets 一覧→最後の手動GUI(ASCアプリ枠作成/
  Play権限付与/配信地域/審査送信)を表示。固有値ゼロ・lib/app-config.mjs 依存一致・構文OK・dry-run確認済。
  → **残課題なし。キット単体で他アプリ立ち上げ可能。**

## 守る原則(fujisan の血の教訓)

- capacitor.config は「作り分けない」金型を維持。独自 VC/UIWindow/AppDelegate 注入禁止。
- 設定自動生成(発明A)はやらない=config を生成物に格下げすると黒画面再発の時限爆弾。コピペ手書き方式。
- 既存稼働アプリ(partnership/fujisan/Exosome/dns-osint)は触らない。キットへ"写す"だけ。

## デプロイ

`git push origin main` で Vercel 自動デプロイ(site/ が公開される)。templates/_docs はサイトに出ない内部資産。

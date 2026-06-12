# web-ios-android キット完成化計画（5年後に楽できるレベル）

2026-06-12 策定。kimito「全部、5年後に楽できるレベル」。dns-osint アプリ化(web-health-check-app)で
得た実証知見 + partnership/Exosome/fujisan の現物を、**キット単体で完結する形**に集約する。

## 現状の核心問題

CLAUDE.md が自認: 「**iOS/Android 自動化スクリプト本体はキットに無く、毎回 partnership/Exosome から
手コピーする**」前提。これが5年後に楽できない原因:
- 参照元リポが改修/移動/削除されるとキットが壊れる
- コピー忘れ・置換忘れ(bundleId等のハードコード残り)
- 今回判明: `templates/scripts/patch-ios-launch-dark.mjs` が **PlistBuddy(mac専用)依存でWindowsで動かない**

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

### Step1: Windows対応 patch を即修正【確実・低コスト】
- `templates/scripts/patch-ios-launch-dark.mjs` を dns-osint で実証した PlistBuddy 不在フォールバック版に差替
  (hasPlistBuddy判定→無ければ Info.plist 文字列編集)。LaunchScreen側は既に node なのでOK。
- 効果: キットの patch が Windows/Linux/mac 全対応に。

### Step2: iOS/Android 自動化スクリプト本体をキットに取り込む【核心】
- partnership `scripts/` から汎用性の高いものを `templates/scripts/` へ:
  appstore-submit / play-publish / asc-create-app / asc-review-check / lint-pre-submission /
  generate-app-icons / generate-store-assets / lib/{asc-api,play-api,app-config}.mjs
- すべて app.config.json 駆動(ハードコード排除を確認しながら)。
- 効果: 「対応表から手コピー」を廃止。キット同梱に。

### Step3: CI workflow を汎用テンプレ化して取り込む
- partnership `.github/workflows/` の release/poll/lint/cert-expiry を `templates/workflows/` へ。
- PLAY_PACKAGE_NAME 等のハードコードを app.config 参照 or secrets/vars 化。
- 効果: 新アプリは workflows をコピーして Secrets 入れるだけで CI 稼働。

### Step4: TWA(Android) テンプレを取り込む
- Exosome `android-twa/` 構成 + bubblewrap 手順 + Windows用 create-android-keystore.ps1/print-fingerprint.ps1。
- 効果: mac 不要 Android が金型化。

### Step5: 却下対応KB + 審査前lint + スクショ自動化【Fable活用】
- partnership `_docs/apple-reject-knowledge-base.md` + `apple-resolution-center-reply-*.md` を
  `_docs/apple-reject-knowledge-base.md` に集約(実際に通った返信文=Fableの学習素材)。
- lint-pre-submission(絵文字混入等の事前検出) + capture/frame screenshots を templates へ。

### Step6: site/ 公開サイトの実態合わせ + setup-new-app ウィザード
- 「全自動の魔法の箱」誇大表現を実態(提出まで自動・GUI最終操作あり)に統一(START-HERE は既に是正済み)。
- setup-new-app.mjs(検証→Secrets/Console手順誘導)を取り込み、site/howto と整合。

## 守る原則(fujisan の血の教訓)

- capacitor.config は「作り分けない」金型を維持。独自 VC/UIWindow/AppDelegate 注入禁止。
- 設定自動生成(発明A)はやらない=config を生成物に格下げすると黒画面再発の時限爆弾。コピペ手書き方式。
- 既存稼働アプリ(partnership/fujisan/Exosome/dns-osint)は触らない。キットへ"写す"だけ。

## デプロイ

`git push origin main` で Vercel 自動デプロイ(site/ が公開される)。templates/_docs はサイトに出ない内部資産。

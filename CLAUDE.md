# このプロジェクトについて

Web + iOS + Android アプリを自動でリリースするためのテンプレートです。

## 新しいアプリを作るとき

1. `app.config.json` を開いてアプリ名・Bundle ID・ドメインを入力する
2. `npm run setup` を実行する（あとは自動）
3. GitHub Secrets を設定する（ウィザードが一覧を出してくれる）
4. `git push` → App Store / Google Play に自動提出

## このテンプレートの使い方（おすすめの渡し方）

このテンプレートは「**AIに丸ごと渡して設計してもらう**」前提で作られています。
いつもの進め方：

1. **このフォルダ（テンプレート）** と **作りたいアプリのイメージ** をAIに渡す
2. 「このルール（CLAUDE.md）に沿って、〇〇というアプリを作って」と伝える
3. AIが `app.config.json` の設定・アイコン生成・ストア提出までやってくれる

→ 設計の指針はこの CLAUDE.md に集約。AIはまずここを読んでから作業します。

## Claudeへのお願い

- アプリ固有の設定は必ず `app.config.json` から読むこと
- ハードコードしない。新しい値が必要なら `app.config.json` に追加する
- スクリプトは `scripts/` にある既存のものを優先して使う
- iOS/Android のビルドは GitHub Actions で自動化済み。ワークフローファイルを壊さない
- Play Console / App Store Connect でGUI操作が必要なときは、自動化できないことを明示してユーザーに手順を伝える
- **公開後・提出後にトラブルが出たら `docs/TROUBLESHOOTING.md` を参照**
  （iOS配信地域・Purpose Strings・Android審査送信・AAB署名など、実際に踏んだ罠と解決策）
- **アプリ課金の税務・銀行手続きは `docs/TAX-SETUP.md` を参照**
  （米国源泉徴収 W-8BEN/W-8BEN-E、30%→0%の正しいやり方、銀行受取の注意点。
  税務フォームの入力・提出は代行せず、ユーザーにガイドする。最終判断は税理士へ）

## ⚠️ 公開でハマりやすいポイント（実体験ベース）

`docs/TROUBLESHOOTING.md` に詳細。要点だけ：

- **iOS「承認 ≠ 公開」**：審査が通っても「配信地域」が未設定だとDLできない（最大24h反映）
- **Android「リリース作成 ≠ 審査送信」**：製品版を作っても最後の「審査用に送信」を忘れがち
- **反映には時差**：緑チェックが付いても実機DLまで数時間〜24時間
- **iOSのpurpose string**：写真・カメラの説明は「具体例」まで書かないとリジェクト

## 自動化できること・できないこと

### ✅ 自動（git push するだけ）
- Webアプリのデプロイ（Vercel）
- iOSアプリのビルド・App Store提出
- Androidアプリのビルド・Google Play提出
- アイコン・スクリーンショット生成
- ストア掲載情報の設定（テキスト・画像）
- プライバシーポリシーページの生成

### ✋ 手動（初回のみ・約15分）
- Play Console: 広告ID申告
- Play Console: 広告申告
- Play Console: ターゲットユーザー設定
- Play Console: データセーフティ
- Play Console: コンテンツレーティング（IARCアンケート）
- Play Console: 健康アプリ申告（該当する場合）

## フォルダ構成

```
app.config.json      ← ここだけ変えればOK（アプリ固有の設定）
scripts/             ← 自動化スクリプト
  setup-new-app.mjs  ← セットアップウィザード
  lib/               ← API共通ライブラリ
src/                 ← Webアプリ本体
store-assets/        ← アイコン・スクリーンショット
.github/workflows/   ← iOS/Android 自動ビルド
```

## よく使うコマンド

```bash
npm run setup              # 新規アプリのセットアップ
npm run play:set-listing   # Play Storeの掲載情報を更新
npm run release:bump       # バージョンを上げる
git push origin main       # → iOS/Android 自動ビルド開始
```

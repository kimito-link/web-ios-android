# このプロジェクトについて

Web + iOS + Android アプリを自動でリリースするためのテンプレートです。

## 新しいアプリを作るとき

1. `app.config.json` を開いてアプリ名・Bundle ID・ドメインを入力する
2. `npm run setup` を実行する（あとは自動）
3. GitHub Secrets を設定する（ウィザードが一覧を出してくれる）
4. `git push` → App Store / Google Play に自動提出

## Claudeへのお願い

- アプリ固有の設定は必ず `app.config.json` から読むこと
- ハードコードしない。新しい値が必要なら `app.config.json` に追加する
- スクリプトは `scripts/` にある既存のものを優先して使う
- iOS/Android のビルドは GitHub Actions で自動化済み。ワークフローファイルを壊さない
- Play Console / App Store Connect でGUI操作が必要なときは、自動化できないことを明示してユーザーに手順を伝える

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

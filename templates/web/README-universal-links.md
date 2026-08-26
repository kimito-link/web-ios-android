# iOS Universal Links（apple-app-site-association）

2026-08-25新設。計器の水平思考調査で「Android版 `assetlinks.json.example`（TWA/App Links用）は
`templates/android-twa/` にあるが、iOS版が1つも無い」と判明したため追加した金型。

## これは何をするものか

ユーザーが `https://<本番ドメイン>/...` のリンクをタップしたとき、Safariでページを開く代わりに
このiOSアプリを直接開く（Universal Links）。App Storeへの誘導ページとしてもリンク共有としても、
アプリが入っていればアプリで、入っていなければWebで開くという体験を実現する。

## 使い方

1. `apple-app-site-association.example` をコピーして `_README` キーを削除する。
2. `applinks.details[0].appID` を `<appleTeamId>.<identity.bundleId>` の形式で埋める。
   - `appleTeamId` は `app.config.json` の `stores.appleTeamId`（Apple Developer Portalの Team ID）。
   - `identity.bundleId` は `app.config.json` の同名フィールド。
3. できあがったファイルを、拡張子を付けずに `/.well-known/apple-app-site-association` として
   本番サイトから配信する。
4. iOS側（Xcode）で Associated Domains capability に `applinks:<本番ドメイン>` を追加する
   （Capacitorプロジェクトでは `ios/App/App/App.entitlements` を編集する）。

## サーバ配信時の注意（Appleの実際の要件）

- **拡張子を付けない**: `apple-app-site-association.json` ではなく `apple-app-site-association`
  というファイル名（拡張子なし）で配信する。多くの静的ホスティングは拡張子なしファイルの
  Content-Type推定に失敗するため、明示的に `Content-Type: application/json` を返す設定が要る
  （Vercel/Cloudflare Pagesではリライトルールや `vercel.json`/`_headers` で対応）。
- **HTTPS必須**: HTTPでは検証されない。
- **リダイレクト禁止**: `/.well-known/apple-app-site-association` へのアクセスがリダイレクトを
  挟むと検証に失敗する。
- **キャッシュ**: iOSはアプリインストール時（と時々のバックグラウンド再検証時）にこのファイルを
  取得してキャッシュする。更新してもすぐには反映されない。

## Android版（assetlinks.json）との違い

| | Android (assetlinks.json) | iOS (apple-app-site-association) |
|---|---|---|
| 金型の場所 | `templates/android-twa/assetlinks.json.example` | `templates/web/apple-app-site-association.example` |
| 形式 | JSON配列 | JSONオブジェクト（`applinks`キー） |
| 識別子 | `package_name` + `sha256_cert_fingerprints` | `appID`（TeamID.bundleId） |
| 検証方法 | Google公式の Statement List Tool | Appleの実機検証（公式CLIツールなし。Xcodeのログか実機テストで確認） |

## 検証方法（このキットには自動検証は無い。今後の検討課題）

現時点でこのキットには「本番URLで実際に取得できるか・内容が正しいか」を自動検証する計器は
無い（次回検討リストの項目8「assetlinks.jsonの公開検証」と対になる、AASA版の同種チェックが
今後の課題）。手動確認は以下のコマンドで可能:

```bash
curl -sI https://<本番ドメイン>/.well-known/apple-app-site-association
```

`Content-Type: application/json`（またはそれに準ずる）が返り、リダイレクトが挟まっていないことを確認する。

# Chrome Web Store 追体験ページ用キャプチャ

`site/walkthrough/chrome/index.html` が参照する実画面スクショ。

## 配線済み（2026-06-13）

| ファイル | 内容 |
| --- | --- |
| `01-cws-dashboard.png` | デベロッパーダッシュボード（アイテム ID） |
| `02-gcp-oauth-client.png` | OAuth クライアント「デスクトップ アプリ」 |
| `03-gcp-consent-test-users.png` | OAuth 同意画面・テストユーザー |
| `04-oauth-auth-code.png` | 認証コード（oob）表示 |
| `05-publish-success.png` | publish-cws.ps1 成功 status=OK |

## 再生成

```powershell
cd web-ios-android
node site/scripts/capture-walkthrough-screenshots.mjs
```

ソース HTML は `site/assets/captures/_sources/chrome/`。本物の CWS / GCP スクショに差し替える場合は同名 PNG を上書き。

## 公開前チェック

- Client ID / Secret / トークン / メールが写り込んでいたらモザイクしてから置く

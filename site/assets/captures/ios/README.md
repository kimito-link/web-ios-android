# App Store Connect 追体験ページ用キャプチャ

`site/walkthrough/ios/index.html` が参照する実画面スクショ。

## 配線済み（2026-06-13）

| ファイル | 内容 |
| --- | --- |
| `01-developer-cert.png` | Apple Developer › Distribution 証明書 CSR アップロード |
| `02-asc-api-keys.png` | App Store Connect API キー（Team Keys） |
| `03-apps-new-app.png` | 新規 App 作成フォーム |
| `04-app-privacy.png` | App のプライバシー「収集しない」→ 公開 |
| `05-waiting-review.png` | build · Waiting for Review |

## ⑤ 配信地域（スクショなし・API 自動）

審査提出 CI（`appstore-submit.mjs` [7g]）または軽量ジョブ `asc-set-availability` で **175/175 地域**を設定。  
追体験ページ Step ⑤ を参照。目視確認 URL 例:  
`https://appstoreconnect.apple.com/apps/6780161483/distribution/pricing`（RH）

## 再生成

```powershell
cd web-ios-android
node site/scripts/capture-walkthrough-screenshots.mjs
```

ソース HTML は `site/assets/captures/_sources/ios/`。実際の ASC スクショに差し替える場合は同名 PNG を上書き。

## 公開前チェック

- メールアドレス・Team ID・秘密情報が写り込んでいたらモザイクしてから置く
- 横幅 1000px にリサイズ済み（Play 追体験と同じ）

# AIへの指示書（このテンプレの使い方）

> 👤 人間が最初に読むのは [`START-HERE.md`](START-HERE.md)（小学生〜90歳でもわかる超やさしい版）。
> 🤖 AI（あなた）はこの CLAUDE.md を読んでから作業する。

---

## このテンプレは何をするものか

**1つのテンプレで Chrome拡張・Web・iOS・Android の4つにアプリを自動展開する。**
ユーザーは [`app.config.json`](app.config.json) に「アプリの情報（＝〇〇）」を書くだけ。
あとは自動化（GitHub Actions / 各種CLI）が、ビルド〜ストア提出までやる。

各プラットフォームとも「**提出までを自動化、合否は審査側**」という同じ構図：
- **Web** = Vercel 自動デプロイ
- **iOS** = App Store 自動リリース（配信地域の設定だけ手動）
- **Android** = Google Play 自動リリース（審査送信が最後の手動）
- **Chrome** = Chromeウェブストア API で審査提出

---

## AIへの依頼の受け方

ユーザーが「このフォルダで 〇〇 というアプリを作って」と言ったら：

1. **まず [`app.config.json`](app.config.json) を一緒に埋める。**
   `<...>` のプレースホルダを、ユーザーに必要な情報を聞きながら埋める。
   わからない項目（ストアID等）は、まだ無ければ空のまま進めてよい。
2. **どのプラットフォームに出すか確認する。** 4つ全部か、一部か。
   - Chrome拡張を出さないなら `app.config.json` の `chrome.enabled` を false に。
3. **不足している実体を、参照元プロジェクトから持ってくる（後述の対応表）。**
4. **品質ルールは「AI汎用ルール」に従う**（後述）。

---

## ⚠️ 重要：このテンプレの「実体」はまだ集約中

このフォルダには現在、**設計図（このファイル）・解説（START-HERE）・手順書（docs/）・
紹介サイト（site/）・キャラ画像・Chrome申請スクリプト（scripts/chrome/）** がある。

**iOS/Android/Web の自動化スクリプト本体は、以下の実プロジェクトに既にある。**
新しいアプリを作るときは、ここから必要なものをコピーして使う：

| 欲しい自動化 | コピー元プロジェクト | 主なファイル |
|---|---|---|
| **iOS/Android 自動リリース（フル）** | `partnership_program_website` | `.github/workflows/`（20本）, `scripts/*.mjs`, `app.config.schema.json`, `capacitor.config.json` |
| **iOS/Android 自動リリース（軽量）** | `Exosome` | `.github/workflows/`（3本）+ `app.config` |
| **Web 自動デプロイ** | `tsuioku-no-kirameki.com` / `web-health-check-app` | `vercel.json`, `scripts/` |
| **Chrome 申請自動化** | （このフォルダ内）`scripts/chrome/` | `build-zip.ps1`, `publish-cws.ps1` |

> ※ コピーするときは、アプリ固有の値（displayName / bundleId / ascAppId / ドメイン等）を
> 必ず `app.config.json` の値に置き換える。ハードコードしない。

---

## AIへのお願い（守ること）

- アプリ固有の設定は必ず [`app.config.json`](app.config.json) から読む。ハードコードしない。
- **品質ルールは「AI汎用ルール」に従う**（`../AI汎用ルール/` または同梱の `docs/ai-rules/`）。
  特に: URLはディレクトリ形式 / index.html を出さない / www統一 / http→https 301 / canonical明示。
- Chrome申請は [`docs/CHROME-WEBSTORE.md`](docs/CHROME-WEBSTORE.md) を参照（OAuthは「デスクトップアプリ」型・認証コードは短命）。
- iOS/Android/Chrome のGUI操作が必要なときは、**自動化できないことを明示**してユーザーに手順を伝える。
- トラブルは [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)、課金税務は [`docs/TAX-SETUP.md`](docs/TAX-SETUP.md)。
- **キャラ（りんく/こん太/たぬ姉）で親しみやすく。** ユーザー向けの説明は、専門用語を避け、
  小学生〜90歳でもわかる言葉で。りんく=案内役、こん太=背中を押す、たぬ姉=注意点を教える。

---

## ⚠️ 公開でハマりやすいポイント（実体験ベース）

`docs/TROUBLESHOOTING.md` に詳細。要点：

- **iOS「承認 ≠ 公開」**：審査が通っても「配信地域」が未設定だとDLできない（最大24h反映）
- **Android「リリース作成 ≠ 審査送信」**：最後の「審査用に送信」を忘れがち
- **Chrome OAuth**：クライアントは「デスクトップアプリ」型／認証コードは数分で失効
- **反映には時差**：緑チェックが付いても実機DLまで数時間〜24時間

---

## フォルダ構成（現状）

```
START-HERE.md        ← 👤 人間はまずここ（キャラ解説・超やさしい）
CLAUDE.md            ← 🤖 AIはここ（この指示書）
app.config.json      ← ⭐ アプリ情報を書く紙（〇〇を入れる）
docs/                ← 手順書・トラブル対処・税務・Chrome申請
scripts/chrome/      ← Chrome申請の自動化スクリプト
site/                ← 紹介サイト＋キャラ画像
```

> iOS/Android/Web の自動化スクリプトは、上の「対応表」の実プロジェクトから持ってくる。

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
3. **自動化スクリプト/CI/TWA は `templates/` に同梱済み。** そこからコピーして使う（後述）。
4. **品質ルールは「AI汎用ルール」に従う**（後述）。

---

## 自動化の実体はキット同梱（`templates/` から使う）

iOS/Android/Web/Chrome の自動化スクリプト・CI・TWA は **`templates/` に同梱済み**。
参照元プロジェクトへの手コピーは不要になった。新しいアプリを作るときは、`templates/` から
コピーして `app.config.json` の値に置換するだけ。詳しい手順とコピー先は
[`templates/README.md`](templates/README.md) を読む。

| 欲しい自動化 | キット内の場所 | 出典（金型の元） |
|---|---|---|
| **iOS/Android リリースCI** | `templates/workflows/`（ios/android release・poll・lint・cert-expiry） | `partnership_program_website` / `fujisan-clean` |
| **iOS/Android リリーススクリプト** | `templates/scripts/*.mjs`（appstore-submit / play-publish / asc-* / lint-pre-submission / generate-store-assets 等）＋ `templates/scripts/lib/` | `partnership_program_website`（一部 `Exosome` と同一） |
| **Android TWA（mac 不要）** | `templates/android-twa/`（twa-manifest・署名注入・Windows用 ps1） | `Exosome` / `partnership_program_website` |
| **Capacitor 設定の金型** | `templates/capacitor/capacitor.config.template.ts` | `partnership` / 富士山 / `Exosome`（server.url 連動型） |
| **Web→アプリDL導線の金型** | `templates/web/`（公式バッジ取得・出し分け・Smart App Banner・CSS） | `Exosome`（実装・ブラウザ検証済み） |
| **却下対応KB（Fable学習素材）** | `_docs/apple-reject-knowledge-base.md` | `partnership_program_website/_docs/` |
| **Web→アプリDL導線 知見KB** | `_docs/web-to-app-install-best-practices.md` | `Exosome`（ディープリサーチ確証分） |
| **Chrome 申請自動化** | （このフォルダ内）`scripts/chrome/` | `build-zip.ps1`, `publish-cws.ps1` |

> ※ 「出典」は金型の元になった実プロジェクト（読み取り専用・触らない）。
> キットを使うときは出典を見に行く必要はない。`templates/` のファイルをコピーして使う。
> ※ コピーするときは、アプリ固有の値（displayName / bundleId / ascAppId / ドメイン /
> playPackageName / Team ID 等）を必ず `app.config.json` の値に置き換える。ハードコードしない。
> 多くのスクリプトは `app.config.json` を SSOT として自動で読むので、CI の `<...>` を埋めれば足りる。

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
templates/           ← ⭐ 自動化の金型（scripts / workflows / android-twa / capacitor）
  scripts/           ←   iOS/Android リリーススクリプト＋lib/
  workflows/         ←   GitHub Actions（release / poll / lint / cert-expiry）
  android-twa/       ←   mac 不要 Android（TWA）一式
  web/               ←   Web→アプリDL導線（公式バッジ・出し分け・Smart App Banner）
  README.md          ←   コピー手順とコピー先マッピング
_docs/               ← キット内部資産（却下KB・設計メモ。サイトには出ない）
scripts/chrome/      ← Chrome申請の自動化スクリプト
site/                ← 紹介サイト＋キャラ画像
```

> iOS/Android/Web の自動化はすべて `templates/` に同梱済み。`templates/README.md` の
> マッピングに従ってコピーし、`app.config.json` の値で置換する。

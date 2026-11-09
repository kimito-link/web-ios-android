> CLAUDE.md から移した節です。この中の backtick のパスはリポジトリ直下からの相対です。

## このテンプレは何をするものか

**1つのテンプレで Chrome拡張・Web・iOS・Android の4つにアプリを自動展開する。**
ユーザーは [`app.config.json`](../../app.config.json) に「アプリの情報（＝〇〇）」を書くだけ。
あとは自動化（GitHub Actions / 各種CLI）が、ビルド〜ストア提出までやる。

各プラットフォームとも「**提出までを自動化、合否は審査側**」という同じ構図：
- **Web** = Vercel 自動デプロイ
- **iOS** = App Store 自動リリース（配信地域の設定だけ手動）
- **Android** = Google Play 自動リリース（審査送信が最後の手動）
- **Chrome** = Chromeウェブストア API で審査提出

---


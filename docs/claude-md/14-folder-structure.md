> CLAUDE.md から移した節です。この中の backtick のパスはリポジトリ直下からの相対です。

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

> 🌐 **「〈機能ページ〉の内容をLPにも反映させて」と言われたら、必ず先に
> [`site/LP-SYNC.md`](../../site/LP-SYNC.md) を読む。** 機能ページ↔LP(`site/index.html`)の
> 対応表・stepテンプレート・反映手順がまとまっている。AI指示ボックス
> （`.ai-box-slot`）は `site/assets/data/ai-instructions.json` が正本で、
> そこを直せば全ページに自動反映されLP側のHTMLは触らなくていい（詳細は同ファイル参照）。

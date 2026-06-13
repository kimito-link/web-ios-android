# templates/web/ — Web→アプリDL導線の金型

ホームページ（紹介サイト/LP）から **App Store・Google Play へのインストールを最大化** する
導線の金型。Exosome (`yukkuri-exosome.link`) で実装・ブラウザ検証済み。
設計根拠（確証された知見・反証された定説）は
[`../../_docs/web-to-app-install-best-practices.md`](../../_docs/web-to-app-install-best-practices.md)。

## 中身

| ファイル | 役割 | アプリ固有値の扱い |
| --- | --- | --- |
| `app-download-section.html` | DL導線本体（Capacitor判定・UA出し分け・公式バッジ・mountスクリプト） | `{{ascAppId}}` / `{{playPackageName}}` / `{{productionUrl}}` を置換 |
| `app-download.css` | バッジ・カードのスタイル（48px統一でGoogle要件を満たす） | `{{primaryColor}}` / `{{accentColor}}` を置換 |
| `fetch-store-badges.mjs` | 公式の日本語バッジ（Apple SVG / Google PNG）を公式ソースから取得 | 無改変（出力先だけ引数で指定可） |

## 使い方

1. **公式バッジを取得**（アプリのリポジトリ直下で実行）:
   ```
   node <このキット>/templates/web/fetch-store-badges.mjs src/images/store-badges
   ```
   → `apple-appstore-ja.svg` と `google-play-ja.png` が入る。**画像は改変しない**。

2. **CSS をコピー**して `{{primaryColor}}` `{{accentColor}}` を `app.config.json` の
   `brand.*` の値に置換し、サイトの CSS として読み込む（例: `css/app-download.css`）。

3. **`<head>` に Smart App Banner メタを追加**（iOS Safari のみ作用・他は無視・Capacitor内では無害）:
   ```html
   <meta name="apple-itunes-app" content="app-id={{ascAppId}}, app-argument={{productionUrl}}">
   ```

4. **`app-download-section.html` の中身をホームページに挿入**し、プレースホルダを置換:
   - `{{ascAppId}}` = `stores.ascAppId`
   - `{{playPackageName}}` = `stores.playPackageName`
   - `{{productionUrl}}` = `https://` + `identity.productionDomain` + `/`

   置き場所は **ファーストビュー固執より、機能説明・社会的証明・プライバシー訴求の
   各セクション後に置く / 反復する** 方がインストールに効く（健康・セルフケア系は
   特に「読んでから決める」ため）。詳細は KB 参照。

## 守ること（ガイドライン由来・破ると規約違反リスク）

- **公式バッジを使う。自作ダウンロードボタンで代替しない。** バッジ画像は無改変。
- **Google バッジを App Store バッジより小さくしない**（同寸以上）。CSS は 48px で統一済み。
- **Apple バッジの "App Store" は英語のまま**。日本語化は「で入手」部分のみ（公式アセットがそうなっている）。
- **アプリ内（Capacitorネイティブ）では非表示**。導線HTMLが自動でそうする。
- **健康/医療系アプリ**は、プライバシー（端末内のみ・第三者提供なし等）を導線の安心材料として明記する。

## 検証（Exosome での実測）

- 両バッジが 48px で正しくレンダリング（Apple 131px / Google 124px 幅）→ Google が小さくならない。
- UA 出し分け: iPhone/iPad→App Store単独 / Android→Play単独 / Windows/Mac→両方+案内文。
- コンソールエラーなし。Capacitor 実行時は非表示。

# diagnosis-shell/ — 診断アプリの結果シェル

今の到達点: テンプレート実装済み。共有リンクに載せる識別子は共有者の LINE だけ。取次店コードは出さない（Xserver の回答）。

診断アプリの Web・iOS/Android・Chrome 拡張で、同じ結果の見せ方を使うための金型。
点数とひとことを、ドメインを入れた直後に出す。次に見る日を伝え、端末の中だけで知らせるか、カレンダーに入れる。
結果の共有は、アプリなら共有シート、Web なら Web Share API、無ければリンクのコピー。

この変更が動かす数字: 店頭ビルドから勧誘の文言を外して公開到達を守り、結果がすぐ見えることと再確認・共有で継続と共有を増やす。

## 面のフラグ

`app.config.json` の `distribution.surface` は `app` / `extension` / `web`。
ビルド時は環境変数 `DISTRIBUTION_SURFACE` が設定より優先される。どちらも読めないときは `app` とみなし、人に勧める案内を出さない。

| 面 | 点数・再確認・共有 | 有料・LINE の案内 | 共有リンクの識別子 |
|---|---|---|---|
| app（iOS / Android） | 出す | 出さない | `domain` だけ |
| extension | 出す | 出さない | `domain` だけ |
| web | 出す | 出す（`web-only-copy.mjs` を渡したとき） | 共有者の LINE があるときだけ `line`。取次店コードは無い |

環境変数 `DISTRIBUTION_SURFACE` が `app` または `extension` のときは、設定の `surface` が `web` でも案内文を出さない。環境変数が `app` / `extension` / `web` のどれでもないときは、設定の `surface` を今まで通り使う。どちらも読めないときは `app`。

## 使い方

1. このディレクトリを診断アプリへコピーする。
2. アプリと拡張では `web-only-copy.mjs` と `check-page.html` を配信物に入れない。
3. 公開 URL は `/check/`。`check-page.html` というファイル名は URL に出さない。
4. 共有リンクの起点は `https` で、`www` は付けない。クエリは `domain` と、Web で共有者の LINE があるときだけ `line`。取次店コードのクエリは付けない。
5. 本番の診断関数を `diagnose` に渡す。`previewDiagnose` は通信しない見本で、本番の判定には使わない。

```html
<div data-diagnosis-shell data-surface="app" lang="ja"></div>
<script type="module">
  import { mountDiagnosisShell } from "./diagnosis-shell.js";
  mountDiagnosisShell(document.querySelector("[data-diagnosis-shell]"), {
    diagnose: (domain) => yourLocalResult(domain),
    origin: "https://example.com",
    config: { distribution: { surface: "app" } },
  });
</script>
```

Web だけ、次も渡す。

```js
import { WEB_ONLY_COPY } from "./web-only-copy.mjs";
// lineUrl, sharerLine: "@example", pricingPath: "/price/", webCopy: WEB_ONLY_COPY
```

拡張のポップアップは `extension/popup.html`。再確認のアラームは `extension/alarm-listener.js` を、既存のサービスワーカーから読む。アイコンのパスは、その拡張が既に持っているアイコンに合わせる。マニフェストの版はここでは変えない。

## 再確認と共有

- 次の確認日は、確認日から 30 日後。
- カレンダーは `.ics` のダウンロード。サーバーへ送らない。
- 端末の通知は、あるものだけ使う。アプリは Capacitor の LocalNotifications が既にあるとき。拡張は `chrome.alarms` と `chrome.notifications`。どちらも無ければ、ページを開いている間の Notification API と、端末内のメモ。
- サーバー発のプッシュはしない。ドメインを集めない。

## 読みやすさ

- 点数、状態の言葉と印、ひとこと、の順。状態は色だけで示さない。
- 文字と背景は 4.5:1 以上（`tokens.mjs` の `COLOR_PAIRS`）。
- 日本語と英語。ボタンの高さは 44px 以上。狭い幅ではボタンが折り返す。

## テスト

`npm run diagnosis-shell:selftest`

`DISTRIBUTION_SURFACE` が app または extension の描画に、紹介・有料・LINE の文言が含まれると失敗する。
Web の描画では有料と LINE が出て、取次店コードは出ないことも見る。共有リンクは共有者の LINE だけを足す。

未確認: 実機の共有シート、Capacitor のローカル通知、Chrome のアラーム。このリポジトリでは端末が無い。

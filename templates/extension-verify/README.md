# extension-verify/ — Chrome拡張を「AIが自分で読み込んで」全画面を確かめる共通検証

**全ての Chrome 拡張リポで同じ物差しを使う。** 拡張を本物の Chromium に読み込み、

1. **静的**: manifest が指す全ファイル・service worker の import 先(再帰)・各画面の script/link が実在するか。
   ★各画面に MV3 の CSP で必ず止まる書き方(インラインの `onerror=` 等・中身のある `<script>`・`javascript:`)が無いか。
   Chrome 156 以降は書いてあるだけで `console.error` になるが、古い chromium では出ないので版に頼らず静的に見る。
   ★**網羅の門**: 拡張直下と manifest の画面があるフォルダの `*.html` は、「検証する」か「検証しない理由」の
   どちらかが設定に無いと赤。新しい画面を足して検証に入れ忘れる、を機械で止める。
2. **起動**: service worker が起き、manifest の version を返すか(＝拡張が読み込まれて壊れていない)。
3. **画面と差し込み先**: 全画面を開いて未捕捉例外・`console.error`・拡張内ファイルの読み込み失敗・空白を見る。
   content_scripts の各グループは、対象 URL をネットに出さずに(fixture か空ページで)開き、
   拡張の isolated world が作られたか(＝注入されたか)と、指定した確認式を見る。

をコマンド1本で行い、スクリーンショットと `report.json` を `<リポ>/.artifacts/extension-verify/` に残す。

> **なぜ**(2026-10-25): AI が自分で確かめずに「拡張を再読み込みして開き直してください」と人に頼み続けていた。
> ルールが Claude 側の設定にしか無く、Codex(AGENTS.md しか読まない)に届いていなかった。

## 入れ方(拡張リポごとに1回)

1. リポ直下に `extension-verify.json` を置く(下の例)。まず空 `{}` で走らせると、足りない画面が赤で全部出る。
2. `package.json` に配線する:
   ```json
   "verify:extension": "node ../web-ios-android/templates/extension-verify/run.mjs ."
   ```
   playwright が無ければ `npm i -D playwright` と `npx playwright install chromium`。
3. CI でも走らせる(このキットは公開リポなので、2つ目の checkout で取れる):
   ```yaml
   - uses: actions/checkout@v6
     with: { repository: kimito-link/web-ios-android, path: .kit }
   - run: npx playwright install --with-deps chromium
   - run: node .kit/templates/extension-verify/run.mjs .
   ```
4. `AGENTS.md` に「拡張を変えたら `npm run verify:extension` を自分で走らせる。人に再読み込みを頼まない」と書く。
   ★Codex/Cursor は CLAUDE.md を読まない。AGENTS.md が無いと**ルールが届かない**。
5. `node ../web-ios-android/templates/diagnostics/check-extension-verify-wired.mjs .` が緑になれば完了
   (`npm run diagnostics` にも入っている)。

## 設定例(返信サジェストの実物を縮めたもの)

```json
{
  "extensionDir": ".",
  "pages": [
    { "path": "popup.html?context=sidepanel" },
    { "path": "status.html", "expect": "!!document.querySelector('main')" },
    { "path": "devtools/line-panel.html", "devtoolsStub": true }
  ],
  "ignorePages": [{ "path": "lp.html", "reason": "公開サイトの LP。拡張の画面ではない" }],
  "sites": [{
    "url": "https://coconala.com/mypage/direct_message/9958404",
    "fixture": "test/fixtures/dom/coconala/direct_message.html",
    "expect": "(() => { const a = window.__replyCopilot.content.services.coconala; return a.collectStructuredMessages().length > 0 || 'messages=0'; })()"
  }],
  "allowErrors": [{ "pattern": "既知の無害なメッセージ", "reason": "なぜ無害か" }],
  "copyExclude": ["android-app"]
}
```

- `expect` は **`true` だけが合格**。失敗の理由を文字列で返すと、そのまま赤の理由として出る。
  (★2026-10-25 の毒テストで、`'messages=0'` を「真」と数えて素通りさせていたのを直した)
- `sites[].expect` は **content script の isolated world** で評価される。`page.evaluate` の main world からは
  content script の変数は必ず `undefined` に見える(返信サジェスト 2026-08-14 誤診の実損)。
- manifest の `devtools_page` は `chrome.devtools` の最小の代役を入れて開き、作るパネルのファイルが実在するかまで見る。
- 日本語を含むパスは `--load-extension` で文字化けするので、自動で ASCII の一時フォルダへ写してから読む
  (`copyExclude` はその時だけ使う。拡張が読まないフォルダだけ入れる)。

## 使い方

```bash
node ../web-ios-android/templates/extension-verify/run.mjs .                # 静的+ブラウザ
node ../web-ios-android/templates/extension-verify/run.mjs . --static-only  # ブラウザなし
node ../web-ios-android/templates/extension-verify/run.mjs . --headed       # 画面を出して見る
node ../web-ios-android/templates/extension-verify/run.mjs . --extension-dir build/pkg  # 出荷パッケージを確かめる
node ../web-ios-android/templates/extension-verify/run.mjs --selftest       # 自分自身を毒で試す
```

終了コード: 0 = 合格 / 1 = 赤 / 2 = 測れなかった(playwright・chromium が無い等。合格ではない)。

## この検証がしないこと(役割の境界)

- **ログインが要る本物のサイト**での読み取り精度。fixture の DOM までを見る。本物は各リポの手動/実機の確認。
- **ボタンを押した先の個々の機能**の正しさ。各リポの e2e・単体テストの役目(追憶の `tests/e2e/` 等)。
  ここは「全部の入口が開いて、落ちずに立ち上がる」を全拡張で同じ物差しで保証する土台。
- **利用者の普段の Chrome に拡張が入ったままか**(Chrome 再起動・別プロファイルで外れる件)。
  それは各 PC 上の検査の役目(手本: 追憶 `scripts/check-chrome-load-path.mjs`)。
- **普段の Chrome で動いている拡張を新しい版に入れ替えること**。それは拡張自身が行う
  ([`../extension-self-update/`](../extension-self-update/README.md))。`--load-extension` の拡張は `runtime.reload()` 後に戻らないので、ここでは試せない。
- ★Chrome 正式版(137+)は `--load-extension` を無視する。Playwright の chromium を使う(このスクリプトは `channel: 'chromium'`)。

> CLAUDE.md から移した節です。この中の backtick のパスはリポジトリ直下からの相対です。

## 確認と不具合対応の共通ルール（2026-09-07追記）

**開発中の確認を「外の実機を手で触って、不具合をChatworkにスクショとメモで残す」流れで進めない。**
確認・再現・記録・修正・再確認はすべてAIがPC上で完結させ、**ユーザーに確認作業をさせない**。
目的は、後から見返せないメモや手元に残らない証拠で不安になる状態をなくすこと。

> ユーザーの言葉（要旨）:「実際スマホで操作すると不具合が見つかるが、その確認作業自体を
> 全部不要にしたい」「Android実機はいつでもUSBで挿せる。iOSは挿さないこともある。
> どちらでも安心できればいい」

### 最優先方針

- **不具合の有無はAIが自分で確認する。推測で「大丈夫です」と言わない。**
  基準③「完膚なきまでの裏取り」（後述「AIへのお願い」節参照）をこの場面にも適用する。
- **日常確認の主戦場はPC上のブラウザ**（本キットは`Capacitor server.url`連動型なので、
  アプリの中身はほぼ本番Webそのもの。Browser paneで直接見れば、UI不具合の大半はスマホを
  触らずに再現・確認できる）。`<preview_tools>`の`verification_workflow`をそのまま使う。
- **実機は「PC上のブラウザでは再現できない」ときだけ**使う（通知・カメラ・位置情報・
  課金・機種依存の挙動、iOS/Android固有のネイティブUI等）。実機を使うときも、外に持ち出さず
  PCに繋いだ状態で確認する（Android実機はUSB接続、iOSは接続していれば使う。無ければ
  この理由でPC確認が不可能である旨を明示し、代替手段またはCI検証に切り替える）。
- **Chatworkは共有用であり、一次情報ではない。一次情報は必ずリポジトリ内に残す。**
- 不具合を口頭やチャットだけで済ませない。再現手順・期待結果・実際の結果・スクショを
  残してから直す。
- 「見た」「直したつもり」で終わらせない。修正後は同じ手順で再確認し、比較用の証拠も残す。

### 確認環境の優先順（固定）

1. **PC上のブラウザ**（Browser pane。日常確認はここが基本）。★開くのは `http://localhost` と `https` だけ。ローカルの HTML（`file://`）は
   開かない（内蔵ブラウザから SSH 鍵・`.env` を読まれる穴、hook で拒否。[`09_AI_TOOL_BROWSER_SAFETY.md`](../ai-rules/09_AI_TOOL_BROWSER_SAFETY.md)）
2. **★PC上のエミュレータ/シミュレータをAIがadb等で操作**（Android=AVDエミュレータ、
   iOS=Xcode Simulator[要macOS]）。**実機固有のネイティブUI・出し分け・ネイティブプラグインを、
   物理端末なしでAIが端から端まで動かして目視確認できる**。人間に「実機で見て」と頼む前に必ずここを試す。
   → 手順の正本 `docs/ai-workflows/EMULATOR-VERIFY-HOWTO.md`（実証済みレシピ＋地雷集。2026-09-28 実証）。
3. **PCに繋いだ実機**（Android=USB接続、iOS=接続していれば）。エミュレータでも再現できない
   実機固有の挙動（実SIM・実カメラ・機種依存）のときだけ
4. **CI（GitHub Actions）上の検証**（Mac環境が要る確認はここに任せる。例: `ios-blackscreen-check.yml`）。
   PC上で直接は測れないが自動化はできる場合
5. **手持ち実機を人が外で操作する確認**。原則禁止

両方のOSが対象のアプリでは、片側だけで「確認完了」にしない。ブラウザ確認で足りない
プラットフォーム固有の挙動は、上記2〜4で個別に埋める。

★**「実機で見てください」と人間に頼む前に、必ず上の2（エミュレータ/シミュレータ）を試す**。
Android なら AVD を AI が起動→APKビルド→install→adb で操作→screencap で目視、まで全部PC上で完結できる
（2026-09-28 に malwarecheck の Android 端末健診で実証。物理端末を待たずに「カードの出し分け・
自作 Capacitor プラグインが実機で値を返す・弱点時の相談導線」を端から端まで確認し、ズレをゼロにした）。
これが「iOS/Android の動作確認を AI がやればズレのないものができる」の実体。

★★**Windows常駐アプリ（AutoHotkey・PowerToys連携ランチャー等、Browser paneで開けないネイティブUI）
の確認は、人間に「Ctrl+Win+Gを押してスクショを撮って」と頼むのではなく、AI自身が見る**（2026-09-27実損）。
★2026-11-01から第一手段は **`agent-desktop`**（Vercel Labs・どのAIからもコマンドで使える・マウスを奪わず裏で動く・部品一覧を読んで押して読み直す）。
部品が読めないアプリだけ `mcp__computer-use__*`（`request_access`→`screenshot`・Claude Desktopのとき）。
入れ方・安全の決まり・機械の歯止め（`.claude/hooks/guard-agent-desktop.mjs`）の正本: [`docs/ai-workflows/AGENT-DESKTOP-HOWTO.md`](../ai-workflows/AGENT-DESKTOP-HOWTO.md)。
これは上記1〜4のどれにも明示的に当てはまらない第5のケース（PC上で動くが、ブラウザでもモバイル
実機でもない常駐アプリ）であり、明文化が漏れていたため実際に人間へ何度もスクショ依頼をする
事故が起きた。★実損の核心はさらに深い: AIは「数値上は44px余っている」という**計算結果**と、
実際のスクリーンショットで**ロゴの文字が切れている**という**見た目の事実**が矛盾していたのに、
矛盾を無視して計算結果の方を報告しようとしていた（本人が後に「数字の方を信じて報告しようと
していました」と自白）。**数値計算と実際に見えているものが食い違ったら、必ず見えているものを
優先する**——これは基準③「完膚なきまでの裏取り」の「コードを読んで筋が通る、で終わらせない」
と同じ構造の誤り（今回は「計算して筋が通る」で終わらせた）。

### 禁止すること

- 開発中の不具合確認のために、ユーザーへ「実機を触ってスクショを送って」と依頼すること
- 実機を外で操作した結果だけを根拠に修正すること
- 不具合の記録をChatworkの投稿や個人メモだけに残すこと
- スクショなし・再現手順なしで「直しました」と報告すること
- 通知・カメラ・位置情報・課金・機種依存以外の理由で安易に実機へ切り替えること
- 確認環境が整っていないのに、推測だけでUI不具合を閉じること

### 証拠の置き場所

一次情報は各プロジェクトの`qa/evidence/`に残す（web-ios-androidキット自体の運用ルールとして、
新規アプリのセットアップ時にこの構成をコピーする）。

```text
qa/
  evidence/
    YYYY-MM-DD_機能名/
      ios_before.png
      ios_after.png
      android_before.png
      android_after.png
      notes.md
  bugs.md
```

### ★Chrome拡張は「AIが読み込んで自分で確かめる」（2026-10-25確立・全拡張リポ共通）

> りんくの言葉:「拡張を自動で動かして検証する仕組みを全部にいれたい」「拡張関連全体のルールにしたいのです」

- **拡張を変えたら、報告の前に `npm run verify:extension` を自分で走らせる。** 実体は共通の
  [`templates/extension-verify/run.mjs`](../../templates/extension-verify/README.md)。拡張を本物の Chromium に読み込み、
  service worker の起動・全画面（popup／options／side panel／devtools／独自ページ）・content script の
  全差し込み先を開いて、例外・`console.error`・読み込み失敗・空白・確認式を見る。結果とスクリーンショットは
  `.artifacts/extension-verify/` に残る。**「拡張を再読み込みして開き直してください」と人に頼んで確認を代行させない。**
- **全拡張リポに入れる。** `extension-verify.json`・npm script か CI への配線・**AGENTS.md への記載**が揃っていないと
  [`templates/diagnostics/check-extension-verify-wired.mjs`](../../templates/diagnostics/check-extension-verify-wired.mjs)
  （`npm run diagnostics` に登録済み）が赤にする。★Codex/Cursor は CLAUDE.md を読まないので、AGENTS.md に書かないと
  ルールが届かない（実損: Codex が毎回「再読み込みして開き直して」と頼んでいた）。
- **新しい画面を足したら設定に足す。** 足さないと「未検証の画面」で赤（網羅の門）。検証しない画面は理由つきで `ignorePages` へ。
- **人の普段の Chrome への反映**（作業ツリーを読んでいる拡張のリロード）も、手段があれば AI がやる
  （手本: 追憶 CLAUDE.md の `reload_extension`）。人に頼むのは手段が全部尽きたときだけ。
  ★既定の手段は、拡張自身が新しい版に気づいて読み込み直す [`templates/extension-self-update/`](../../templates/extension-self-update/README.md)
  （git pull して manifest の version を上げれば、2分以内に入れ替わる。初回の1回だけ人の 🔄 が要る）。
- **この検証の外にあるもの**: ログインが要る本物のサイトでの精度、利用者の Chrome から拡張が外れていないか。
  前者は各リポの実機確認、後者は各 PC 上の検査（手本: `../tsuioku-no-kirameki.com/scripts/check-chrome-load-path.mjs`）が受け持つ。

### ★★AIは人の普段の Chrome に繋がない（「リモートデバッグを許可しますか？」を出さない、2026-10-26確立・全ツール共通）

> りんくの言葉:「全体のルールとしてこれを何回ももとめられるとすとれすなのでやめてほしい」

- **原因**: `chrome-devtools-mcp --autoConnect`（Chrome 144+）は、人が普段使っている Chrome に後から繋ぐ。
  Chrome は繋がれるたびに「リモート デバッグを許可しますか？」を出す（毎回・常に許可の選択肢は無い）。
  2026-10-26 時点で出していたのは `~/.claude.json` の MCP `chrome-devtools-live`（`--autoConnect`）だった。
- **ルール**: AI が Chrome を自動操作するときは、**自動操作専用のプロフィール**を使う。人の普段の Chrome には繋がない。
  - chrome-devtools-mcp: `--autoConnect` を使わず `--userDataDir C:\Users\info\.chrome-devtools-live`（ログインを残したいとき）か
    `--isolated`（使い捨て）。専用プロフィールのログインは初回だけ人がする。以後は残る。
  - 自分で起動して繋ぐときは `--user-data-dir=<専用フォルダ> --remote-debugging-port=<番号>` で起動し `--browserUrl` で繋ぐ。
  - 人の普段のログイン状態がどうしても要る作業は、Claude in Chrome 拡張（`mcp__claude-in-chrome__*`）を使う（ダイアログは出ない）。
- **やらないこと**: 普段のプロフィールの Cookie を専用フォルダへコピーする・普段の Chrome をデバッグポート付きで起動し直す、
  といった「確認を出さないために安全を下げる」回避。`--autoConnect` を Claude Code / Codex / Cursor / Antigravity どの設定にも足さない。
- ★機械検査: 「設定ファイルに `--autoConnect` があるか」は事実として検出できるが、設定は各 PC ローカル（git 外）にあるため
  リポの Gate では見られない。新しい PC・新しい AI ツールを足したら、MCP 設定に `autoConnect` が無いことを grep で確かめる。

### ★★AIツールの内蔵ブラウザは「普通のブラウザより守りが弱いことがある」（2026-10-31・EMBRACE）

Claude Desktop・Codex・VS Code・Cursor・Copilot の内蔵ブラウザで、ローカルの HTML から SSH 鍵・`.env` を読む／隠した指示でコマンドを動かす／
アドレスバーを偽る穴が報告された（Forever Security, 2026-10-29）。**内蔵ブラウザで `file://` を開かない（hook で拒否）・知らないリポを README の通りに
丸投げしない（先に読むだけ）・内蔵ブラウザでログインしない・鍵は使い回さず漏れたら1本だけ止められる形にする**。
正本: [`docs/ai-rules/09_AI_TOOL_BROWSER_SAFETY.md`](../ai-rules/09_AI_TOOL_BROWSER_SAFETY.md)（ここへ本文をコピーしない）。

### ★「観測系そのものが壊れている」可能性を先に疑う（2026-09-11追記）

**正本**: `../ai-generic-rules/docs/policies/OBSERVATION_CHANNEL_INTEGRITY.md`
（screenshot異常≠アプリ表示異常・独立観測経路での切り分け・判定条件・回復手順5項目・
検証項目5種の混同禁止、はすべてそちらが正本。ここへ本文をコピーしない）

実損: `site/index.html`のCSS修正後、Browser paneでスクロール後にスクリーンショットを
撮ると画面全体が真っ黒になった事象があった。正本の手順（DOM/CSS/rAF実測での切り分け）に
従い、対症療法でコードを書き換える前にcapture経路側の一過性障害と判断できた。


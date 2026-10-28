# extension-self-update/ — 開発中の拡張が、新しい版に自分で入れ替わる

**「🔄 を押してください」と人に頼まずに済ませる仕組み。** 展開して読み込んだ（作業フォルダを直接読む）拡張は、
作業フォルダを新しくしても、人が chrome://extensions の 🔄 を押すまで古い版のまま動く。
AI はこのボタンを押せない（普段の Chrome にリモートデバッグでつながない決まり。画面操作でも Chrome はクリックできない）。

そこで拡張が自分で気づいて、自分で読み込み直す。PC 側のプログラムも新しい接続も要らない。
流れは **「AI が git pull する → 2分以内に拡張が自分で読み込み直す」** で終わる。

> 出典: 君斗りんくのAI返信サジェスト 7.8.121（`kimito-link-reply-suggest` PR #110 の `sw/self-update.js`）。
> キットでは前面の判定を `chrome.runtime.getContexts` に変えた（下の「確かめたこと」）。

## しくみ

1. 展開して読み込んだ拡張は、拡張のファイルを読むたびに作業フォルダの今のファイルを返す（manifest.json も同じ）。
2. service worker が2分おきのアラームで `fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })` を読む。
3. 読んだ version が動いている版（`chrome.runtime.getManifest().version`）より新しければ `chrome.runtime.reload()`（🔄 と同じ）。
4. 読み込み直した後の画面の開き直し・差し込み直しは、今まで通り拡張の `onInstalled` 側が行う。

守ること:
- **版が上がったときだけ**読み込み直す。同じ版・古い版には戻さない。manifest が書きかけで読めないときも何もしない。
- **拡張の画面（タブ・ポップアップ）を前面で使っている間は待つ**。打ちかけの入力を消さないため。次の見回りでまた見る。
- **ストアから入れた拡張**（manifest に `update_url`）では何もしない。ストアの更新に任せる。
- 入れ替わった時刻と前後の版を `chrome.storage.local` の `selfUpdateLast` に残す。

## 入れ方（拡張ごとに1回）

1. [`self-update.js`](self-update.js) を拡張の `sw/self-update.js` などへ**そのまま**写す
   （拡張は自分のフォルダの外を import できないので写す。直すときはキット側を先に直す）。
2. service worker（`"type": "module"`）で3か所つなぐ:
   ```js
   import { SELF_UPDATE_ALARM, checkForNewVersion, scheduleSelfUpdateCheck } from './self-update.js';

   chrome.runtime.onInstalled.addListener(() => { scheduleSelfUpdateCheck(); /* 既存の処理 */ });
   chrome.runtime.onStartup.addListener(() => { scheduleSelfUpdateCheck(); });
   chrome.alarms.onAlarm.addListener((alarm) => {
     if (alarm?.name === SELF_UPDATE_ALARM) {
       void checkForNewVersion().catch((e) => console.warn('[self-update]', String(e?.message || e)));
       return;
     }
     /* 既存のアラーム */
   });
   ```
3. manifest の `permissions` に `alarms` と `storage` を足す。**`tabs` 権限は要らない**（前面の判定は `getContexts` の tabId で見る）。
4. 試験 [`self-update.test.mjs`](self-update.test.mjs) を拡張の `test/` へ写し、import 先を `../sw/self-update.js` に直して
   既存の試験の列（`npm test` など）に足す。版の比較・待つ・ストア版では何もしない・読めないときは止まる、を確かめる。
5. **新しいファイルを `git add` し忘れない。** 忘れると clone した先で service worker が起きない
   （`templates/scripts/check-tracked-imports.mjs` で見つかる）。
6. `npm run verify:extension`（[`../extension-verify/`](../extension-verify/README.md)）で、service worker が起きることを確かめる。

## 注意

- **この仕組みが入った版を読み込むための 🔄 だけは、最初の1回、人の手が要る。**
- **版を上げずにファイルだけ変えても読み込み直さない。** 拡張を変えたら manifest の version を必ず上げる（もともとの決まり）。
- サイドパネルは「使っている間」に数えていない。開きっぱなしにする人が多く、数えると永遠に入れ替わらないため。
  サイドパネルで長い入力をする拡張は、入力の下書きを `chrome.storage` に残しておく。
- `chrome.runtime.getContexts` は Chrome 116 以降。古い Chrome では tab の url で見分けるが、`tabs` 権限が無いと url が見えず
  「使っていない」扱いになる（＝待たずに入れ替わる）。

## 確かめたこと（2026-10-28、使い捨ての Chromium・Playwright）

- 拡張の中から読んだ manifest が、作業フォルダで書き換えた版を返す（1.0.0 → 1.0.1 を読み、`reload` と判断し、`selfUpdateLast` を残した）。
- **`tabs` 権限なしでは、前面にある自分の拡張の画面でも `tab.url` は見えない**（`null`）。そのため元の「url で見分ける」判定は
  いつも「使っていない」になり、打ちかけでも入れ替わる。`getContexts`（自分の画面の tabId が分かる）に変えて、
  前面＝待つ・裏のタブ＝入れ替わる、を実際に確かめた。
- 確かめられないこと: `--load-extension` で読み込んだ拡張は、`runtime.reload()` の後に戻ってこない（仕組みを使わない素の reload でも同じ）。
  入れ替わりそのものは、普段の Chrome で次の版を pull し、人が何もしないまま Chrome の Preferences の
  `extensions.settings.<拡張ID>.last_update_time` と `selfUpdateLast` が新しくなるのを見て確かめる。

## まだ機械で見ていないこと

各拡張へ写したコピーがキットの正本とズレていないか、は検査していない（写す先が別リポで、キットから見えないため）。
ズレが実際に起きたら、`check-extension-verify-wired.mjs` に「写しが正本と同じか」を足す。

// self-update.test.mjs — self-update.js の試験。拡張へ写すときは import 先のパスだけ直す。
//   版の比較 / 同じ版・古い版では何もしない / 拡張の画面を前面で使っている間は待つ / ストア版では何もしない / 読めないときは止まる
//   使い方: node self-update.test.mjs   （chrome は最小の代役を入れる。ブラウザは要らない）
import assert from 'node:assert/strict';

const store = {};
let manifest = { version: '7.8.119' };
let contexts = [];
let activeTabs = [{ id: 1, url: undefined }];
globalThis.chrome = {
  runtime: {
    getManifest: () => manifest,
    getURL: (p) => 'chrome-extension://x/' + p,
    getContexts: async () => contexts,
  },
  tabs: { query: async () => activeTabs },
  storage: { local: { set: async (o) => Object.assign(store, o) } },
  alarms: { create: () => {} },
};
const { compareVersions, checkForNewVersion, extensionPageInFront } = await import('./self-update.js');

assert.ok(compareVersions('7.8.120', '7.8.119') > 0);
assert.ok(compareVersions('7.10.0', '7.9.99') > 0, '桁は文字でなく数で比べる');
assert.ok(compareVersions('1.0.0.1', '1.0.0') > 0, '4つ目の数まで見る');
assert.equal(compareVersions('7.8.119', '7.8.119'), 0);
assert.ok(compareVersions('7.8.118', '7.8.119') < 0);

let reloads = 0;
const deps = (disk, front = false) => ({ fetchManifest: async () => ({ version: disk }), inFront: async () => front, reload: () => { reloads++; } });
assert.equal((await checkForNewVersion(deps('7.8.119'))).action, 'same');
assert.equal((await checkForNewVersion(deps('7.8.118'))).action, 'same', '古い版には戻さない');
assert.equal((await checkForNewVersion(deps(''))).action, 'same', '版が読めない manifest では動かない');
assert.equal((await checkForNewVersion(deps('7.8.120', true))).action, 'busy', '拡張の画面を使っている間は待つ');
assert.equal(reloads, 0);
assert.equal((await checkForNewVersion(deps('7.8.120'))).action, 'reload');
assert.equal(reloads, 1);
assert.deepEqual([store.selfUpdateLast.from, store.selfUpdateLast.to], ['7.8.119', '7.8.120']);
assert.equal((await checkForNewVersion({ fetchManifest: async () => { throw new Error('書きかけの JSON'); }, reload: () => { reloads++; } })).action, 'error', '読めないときは読み込み直さない');
assert.equal(reloads, 1);

// 前面判定（tabs 権限なしでは tab.url が見えない前提で、getContexts の tabId で見分ける）
contexts = [];
assert.equal(await extensionPageInFront(), false, '拡張の画面が開いていない');
contexts = [{ contextType: 'TAB', tabId: 2 }];
assert.equal(await extensionPageInFront(), false, '拡張の画面は裏のタブ');
contexts = [{ contextType: 'TAB', tabId: 1 }];
assert.equal(await extensionPageInFront(), true, '拡張の画面が前面のタブ');
contexts = [{ contextType: 'POPUP' }];
assert.equal(await extensionPageInFront(), true, 'ポップアップを開いている');
delete chrome.runtime.getContexts;
activeTabs = [{ id: 1, url: 'chrome-extension://x/chat.html' }];
assert.equal(await extensionPageInFront(), true, '古い Chrome では url で見分ける');
activeTabs = [{ id: 1, url: 'https://example.com/' }];
assert.equal(await extensionPageInFront(), false);

manifest = { version: '7.8.119', update_url: 'https://clients2.google.com/service/update2/crx' };
assert.equal((await checkForNewVersion(deps('9.0.0'))).action, 'store', 'ストア版はストアの更新に任せる');
assert.equal(reloads, 1);
console.log('self-update.test: ok');

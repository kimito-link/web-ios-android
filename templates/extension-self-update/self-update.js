/**
 * self-update.js — 開発中（展開して読み込んだ）拡張が、作業フォルダの新しい版に自分で入れ替わる。
 *
 *   役割: service worker が数分おきに作業フォルダの manifest.json を読み、動いている版より新しければ
 *         chrome.runtime.reload() する（chrome://extensions の 🔄 と同じ）。
 *   使い方: このファイルを拡張の sw/ などへそのまま写し、README.md の「入れ方」どおり3か所で呼ぶ。
 *   なぜ要るか: AI は 🔄 を押せない（普段の Chrome にリモートデバッグでつながない決まり・画面操作も不可）。
 *         そのため更新のたびに人へ「🔄 を押して」と頼んでいた。git pull だけで入れ替わるようにする。
 *
 *   守ること:
 *   ・版が上がったときだけ読み込み直す（同じ版・古い版には戻さない）。
 *   ・拡張の画面（タブ・ポップアップ）を前面で使っている間は待つ（打ちかけの入力を消さない）。次の見回りでまた見る。
 *   ・ストアから入れた拡張（manifest に update_url）では何もしない（ストアの更新に任せる）。
 *   ・入れ替わった時刻と前後の版を chrome.storage.local の selfUpdateLast に残す（後から確かめるため）。
 *
 *   出典: 君斗りんくのAI返信サジェスト 7.8.121（kimito-link-reply-suggest PR #110 の sw/self-update.js）。
 *   キットで変えた点: 前面判定を chrome.runtime.getContexts（Chrome 116+）優先にした。tabs 権限が無いと
 *   tab.url が見えない場合があり、元の「url で見分ける」は普段の Chrome で未確認だったため。
 *   ★配布境界をまたぐ意図的な複製（拡張は自分のフォルダの外を import できない）。直すときはキットの正本を先に直す。
 */
export const SELF_UPDATE_ALARM = 'self-update-check';
export const SELF_UPDATE_PERIOD_MINUTES = 2;

/** '7.8.118' と '7.8.119' を比べる。a が新しければ正。 */
export function compareVersions(a, b) {
  const pa = String(a || '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** 拡張の画面を前面で使っているか（使っていれば再読み込みを待つ）。判定できないときは「使っていない」。 */
export async function extensionPageInFront() {
  try {
    const active = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    // getContexts は自分の拡張の画面だけを返し、tabs 権限が無くても tabId が分かる
    if (chrome.runtime.getContexts) {
      const ctx = await chrome.runtime.getContexts({ contextTypes: ['TAB', 'POPUP'] });
      if (ctx.some((c) => c.contextType === 'POPUP')) return true;
      const ids = new Set(active.map((t) => t.id));
      return ctx.some((c) => ids.has(c.tabId));
    }
    const origin = chrome.runtime.getURL('');
    return active.some((t) => String(t.url || t.pendingUrl || '').startsWith(origin));
  } catch (_) {
    return false;
  }
}

/**
 * 見回り1回。戻り値: { action: 'store'|'same'|'busy'|'reload'|'error', running, onDisk }。
 * deps は試験用（fetchManifest / inFront / reload）。
 */
export async function checkForNewVersion(deps = {}) {
  const running = chrome.runtime.getManifest();
  if (running.update_url) return { action: 'store', running: running.version };
  let onDisk = '';
  try {
    const read = deps.fetchManifest || (async () => {
      const res = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
      return res.json();
    });
    onDisk = String((await read()).version || '');
  } catch (e) {
    return { action: 'error', running: running.version, error: String(e?.message || e) };
  }
  if (!onDisk || compareVersions(onDisk, running.version) <= 0) return { action: 'same', running: running.version, onDisk };
  if (await (deps.inFront || extensionPageInFront)()) return { action: 'busy', running: running.version, onDisk };
  await chrome.storage.local.set({ selfUpdateLast: { at: Date.now(), from: running.version, to: onDisk } });
  (deps.reload || (() => chrome.runtime.reload()))();
  return { action: 'reload', running: running.version, onDisk };
}

export function scheduleSelfUpdateCheck() {
  chrome.alarms.create(SELF_UPDATE_ALARM, { periodInMinutes: SELF_UPDATE_PERIOD_MINUTES });
}

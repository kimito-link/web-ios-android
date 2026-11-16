// LINEシミュレーションの台本のひな型。導入先で scripts/e2e-line.mjs などにコピーして、Bot に合わせて書き換える。
// 「利用者がLINEでやること」を上から順に書き、Bot の返事を check で確かめる。
// 実例（39項目）: kimito-link/linebot scripts/e2e-bunshin.mjs
import { fileURLToPath } from 'node:url';
import { createLineSim } from './line-sim.mjs';

const sim = createLineSim();
const { say, tap, follow, sendFile, check, cleanup, report } = sim;
const fixture = (p) => fileURLToPath(new URL(`./fixtures/${p}`, import.meta.url));

// ★Bot 固有のデータ（偽の利用者の会話履歴・作ったもの）も、ここで消す。始める前にも消して前回の残りを掃除する。
const cleanupAll = () => {
  cleanup();
  sim.q(`DELETE FROM messages_log WHERE friend_id IN (SELECT id FROM friends WHERE line_user_id = '${sim.USER}')`);
};

cleanupAll();
try {
  // 1. 友だち追加 → あいさつ
  const r0 = await follow();
  check('友だち追加であいさつが届く', r0.length > 0, r0.slice(0, 80));

  // 2. 文字を送る → AI が答える（本番の LLM チェーンをそのまま通る）
  const r1 = await say('営業時間を教えてください', '質問する', 60000);
  check('質問に答える（固定のお詫び文ではない）', r1 && !r1.includes('うまく応答できませんでした'), r1.slice(0, 120));

  // 3. ボタンを押す（postback）。ボタンの文字は L:、押したときの値は PB: で確かめる
  // const r2 = await tap('menu:open', 'メニューを開く');
  // check('メニューに「予約」ボタンがある', r2.includes('L:予約') && r2.includes('PB:reserve'), r2.slice(0, 80));

  // 4. 画像・ファイルを送る（中身は fixtures から。LINE の取り出しだけ差し替わり、AI の読み取りは本番そのまま）
  // const r3 = await sendFile({ name: 'menu-jpg', path: fixture('menu.jpg'), type: 'image', contentType: 'image/jpeg' });
  // check('画像に反応する', r3.length > 0, r3.slice(0, 80));
  void fixture; void tap; void sendFile;

  // 5. お支払いは押さない。出てきたリンクに正しい印がつくかだけ見る
  // const pay = (r2.match(/URI:(https:\/\/buy\.stripe\.com\/[^ |]+)/) ?? [])[1] ?? '';
  // check('お支払いリンクに本人の印', pay.includes(`client_reference_id=${sim.USER}`), pay);
} finally {
  cleanupAll();
}
report();

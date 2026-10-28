// example.mjs — runner.mjs の最小の使い方（鍵を1つ受け取って反映する流れの形だけ）。
//   役割: 新しい「人に渡すスクリプト」を作るときの書き写し元。段を足し替えて使う。
//   なぜ要るか: 状態ファイル・途中から再開・Enter 待ちなし、を毎回ゼロから書くと抜けるため（08_NO_HUMAN_HANDS §4）。
//   使い方: node example.mjs  （start.cmd.example をダブルクリック用に写す）
import { runSteps, waitForClipboard } from './runner.mjs';

let key = null; // ★秘密は変数にだけ持つ。runSteps の戻り値・状態ファイルには入れない。

const result = await runSteps({
  name: 'example-key-rotation',
  steps: [
    {
      id: 'receive-key',
      title: '新しい鍵を受け取る',
      run: async (ctx) => {
        ctx.waitingHuman('開いたページで「発行」を押して、できた値をコピーしてください（コピーすれば自動で進みます）',
          'https://example.com/settings/api-keys');
        key = await waitForClipboard(/^sk_live_[A-Za-z0-9]{10,}$/, { acceptExisting: true });
        return { length: key.length }; // 値ではなく長さだけ残す
      },
    },
    {
      id: 'apply-key',
      title: '鍵を使う場所に入れる',
      run: async (ctx) => {
        if (!key) throw new Error('鍵がまだ手元にありません（もう一度ダブルクリックしてコピーし直してください）');
        ctx.log('  （ここで公式 API / CLI を使って反映する）');
      },
    },
    {
      id: 'verify',
      title: '本番で動くか確かめる',
      run: async () => ({ ok: true }), // ここで本番に実際にアクセスして確かめる
    },
  ],
});
process.exitCode = result.status === 'done' ? 0 : 1;

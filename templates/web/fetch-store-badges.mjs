#!/usr/bin/env node
// 公式ストアバッジ（日本語）を公式ソースから取得する。
// 自作ボタンは Apple/Google ガイドラインに抵触しうるため、必ず公式アセットを使う。
//
// 取得物（既定の出力先: src/images/store-badges/）:
//   apple-appstore-ja.svg  Apple「App Storeで入手」日本語・黒（"App Store" は英語のまま）
//   google-play-ja.png     Google「Google Playで手に入れよう」日本語
//
// 使い方:
//   node templates/web/fetch-store-badges.mjs            # 既定: src/images/store-badges/
//   node templates/web/fetch-store-badges.mjs <出力先ディレクトリ>
//
// 出典URL（2026-06 時点で確認）:
//   Apple : https://toolbox.marketingtools.apple.com/api/v2/badges/download-on-the-app-store/black/ja-jp
//           （Apple Marketing Tools が言語別に動的生成。"App Store" は翻訳不可・改変禁止）
//   Google: https://play.google.com/intl/ja/badges/static/images/badges/ja_badge_web_generic.png
//
// 注意:
//   - ダウンロード後、バッジ画像の改変（色変更・角度・アニメ・トリミング）は禁止。
//   - 高さ48px等で揃える際、Google バッジを App Store バッジより小さくしないこと。

import fs from 'node:fs';
import path from 'node:path';

const APPLE_URL = 'https://toolbox.marketingtools.apple.com/api/v2/badges/download-on-the-app-store/black/ja-jp';
const GOOGLE_URL = 'https://play.google.com/intl/ja/badges/static/images/badges/ja_badge_web_generic.png';

const outDir = process.argv[2] || path.join('src', 'images', 'store-badges');

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });

  const appleDest = path.join(outDir, 'apple-appstore-ja.svg');
  const googleDest = path.join(outDir, 'google-play-ja.png');

  const aBytes = await download(APPLE_URL, appleDest);
  console.log(`✓ Apple  : ${appleDest} (${aBytes} bytes)`);

  const gBytes = await download(GOOGLE_URL, googleDest);
  console.log(`✓ Google : ${googleDest} (${gBytes} bytes)`);

  // 軽い健全性チェック（取り違え・空ファイル検出）
  const appleHead = fs.readFileSync(appleDest, 'utf8').slice(0, 200);
  if (!appleHead.includes('<svg')) console.warn('  ⚠ Apple バッジが SVG ではない可能性。URLを確認してください。');
  if (gBytes < 1000) console.warn('  ⚠ Google バッジが小さすぎます。URLを確認してください。');

  console.log('\n完了。バッジは改変せずそのまま使ってください（Apple/Google ガイドライン）。');
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });

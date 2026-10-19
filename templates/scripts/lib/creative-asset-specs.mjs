// 役割: App Store の「商品ページヘッダー」「検索結果」素材(2.3.14)の画像が、Apple の仕様どおりかを調べる純関数。
// なぜ要るか: ヘッダー・検索結果の素材は ASC の画面で1枚ずつ上げる任意項目で、無くても審査は通るため、後回しにされて
//   「無いまま公開」になりやすい(2026-10-18 malwarecheck で本人が気づいた)。置き場(store-assets/creative-assets/)に
//   header.* と search-results.* を置く約束にし、置かれたものが仕様(比率・解像度・形式・透明度なし)に合うかを機械で見る。
// 仕様の出典: https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications (2026-10-19 確認)
//   ヘッダー: 21:9 = 3840x1646(.jpeg/.jpg/.png) または 16:9 = 5244x2950(.png)
//   検索結果: 3:2 = 最小 1920x1280〜最大 3840x2560(.jpeg/.jpg/.png) または 16:9 = 5244x2950(.png)
//   どちらも アルファチャンネル・透明度は不可。
// ★検査できるのは寸法・形式・透明度まで。画像の中身(価格・他アプリへの言及・全年齢向け・主張の事実性)は機械では読めず、人が目視する。
// fs に触らない。入力は Buffer と拡張子。

// 画像ファイルの先頭から {format, width, height, hasAlpha} を取り出す。読めなければ null。
export function readImageInfo(buf) {
  if (!buf || buf.length < 24) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR: width(4) height(4) bitDepth(1) colorType(1)
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const colorType = buf[25];
    let hasAlpha = colorType === 4 || colorType === 6;
    // 索引色(3)でも tRNS チャンクがあれば透明度を持つ
    if (colorType === 3 || colorType === 0 || colorType === 2) {
      let i = 8;
      while (i + 8 <= buf.length) {
        const len = buf.readUInt32BE(i);
        const type = buf.toString('latin1', i + 4, i + 8);
        if (type === 'tRNS') { hasAlpha = true; break; }
        if (type === 'IDAT' || type === 'IEND') break;
        i += 12 + len;
      }
    }
    return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), hasAlpha };
  }
  // JPEG: FF D8 ... SOFn(C0〜CF のうち C4,C8,CC を除く) に height(2) width(2)
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { format: 'jpeg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), hasAlpha: false };
      }
      const len = buf.readUInt16BE(i + 2);
      i += 2 + len;
    }
  }
  return null;
}

const is16by9Big = (w, h) => w === 5244 && h === 2950;

// kind: 'header' | 'search'。info: readImageInfo の結果。返り値: 問題の説明の配列(空なら仕様どおり)。
export function checkCreativeImage(kind, info) {
  if (!info) return ['画像として読めない(PNG/JPEG ではない、または壊れている)'];
  const problems = [];
  const { format, width: w, height: h, hasAlpha } = info;
  if (hasAlpha) problems.push('アルファチャンネル・透明度がある(不可)。不透明な画像で書き出し直す');
  if (kind === 'header') {
    const ok21by9 = w === 3840 && h === 1646;
    const ok16by9 = is16by9Big(w, h) && format === 'png';
    if (!ok21by9 && !ok16by9) problems.push(`寸法 ${w}x${h} が仕様外。ヘッダーは 3840x1646(21:9)、または 5244x2950(16:9・PNGのみ)`);
  } else if (kind === 'search') {
    const ok3by2 = w * 2 === h * 3 && w >= 1920 && w <= 3840 && h >= 1280 && h <= 2560;
    const ok16by9 = is16by9Big(w, h) && format === 'png';
    if (!ok3by2 && !ok16by9) problems.push(`寸法 ${w}x${h} が仕様外。検索結果は 3:2 で 1920x1280〜3840x2560、または 5244x2950(16:9・PNGのみ)`);
  } else {
    problems.push(`未知の種別 ${kind}`);
  }
  return problems;
}

// ファイル名から種別を決める: header.* → header / search-results.* または search.* → search。それ以外は null。
export function kindFromFileName(name) {
  const base = String(name).toLowerCase().replace(/\.[^.]+$/, '');
  if (base === 'header') return 'header';
  if (base === 'search-results' || base === 'search') return 'search';
  return null;
}

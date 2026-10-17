// @ts-check
/**
 * apple-guideline-checks.mjs — lint-pre-submission CHECK 31・32 の判定（純関数）。
 *
 * 役割: 2026-10-16 の App Review Guidelines 改訂（2.5.19 隠し・休眠・未申告機能 / 2.3.14 クリエイティブ
 *   アセット）で新しく明文化された禁止事項のうち、**客観的に検出できる兆候だけ**を判定する。
 * 使い方: lint 本体が fs で読んだ文字列を渡す。ここは fs に触らない（テストしやすくするため）。
 * なぜ「兆候」止まりか: 「その機能が審査メモに書いてあるか」「バナーの主張が事実か」は意味判断で、
 *   機械では決められない。ここで見るのは難読化・実行時コード取得・価格表記のような**形**だけ。
 *   緑＝問題なし、ではない（過信しない）。出典: https://developer.apple.com/news/ (2026-10-16)
 */

/** 難読化ツール特有の識別子（例: _0x1a2b）が何個以上で「難読化の疑い」とするか。 */
export const OBFUSCATION_IDENT_THRESHOLD = 20;

/**
 * 2.5.19「コードの難読化などで未申告機能を隠す」の兆候。
 * @param {string} text
 * @returns {string[]} 見つかった兆候の説明（空なら無し）
 */
export function findObfuscationSignals(text) {
  const out = [];
  const idents = text.match(/\b_0x[0-9a-f]{3,6}\b/g) ?? [];
  if (idents.length >= OBFUSCATION_IDENT_THRESHOLD) {
    out.push(`難読化ツール特有の識別子(_0x…)が${idents.length}個`);
  }
  if (/\beval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e/.test(text)) {
    out.push('Dean Edwards packer 形式の eval');
  }
  if (/\b(eval|new\s+Function)\s*\(\s*(atob|decodeURIComponent\s*\(\s*atob)\s*\(/.test(text)) {
    out.push('Base64 を復号して実行(eval/new Function + atob)');
  }
  return out;
}

/**
 * 実行時に取得した文字列をコードとして実行している兆候（審査時に存在しない機能を後から足せる経路）。
 * eval / new Function と fetch が同じファイルにあるだけで拾う＝誤検知はあり得るので呼び出し側は warn にする。
 * @param {string} text
 */
export function findRemoteCodeExecution(text) {
  const exec = /\b(eval\s*\(|new\s+Function\s*\()/.test(text);
  const net = /\b(fetch\s*\(|XMLHttpRequest|axios\.)/.test(text);
  return exec && net ? ['eval/new Function と通信が同じファイルにある（取得した文字列を実行していないか要確認）'] : [];
}

const PRICE_RES = [
  [/[¥￥$€£]\s?\d/, '通貨記号つきの金額'],
  [/\d[\d,]*\s?円/, '「〜円」の金額'],
  [/\d+\s?%\s?(off|オフ|引)/i, '「〜%OFF」'],
  [/割引|セール|半額|限定価格|特価|キャンペーン価格|\b(sale|discount)\b/i, '値引き・セールの語'],
];
const CLAIM_RES = [
  [/(^|[^a-z])(no\.?\s?1|#1|number\s?one)([^a-z]|$)/i, 'No.1 の主張'],
  [/ナンバーワン|第\s?1\s?位|世界一|日本一|業界最[高大]|最高の/, '最上級・1位の主張'],
];

/**
 * 2.3.14 クリエイティブアセットの文言検査。「特定・割引の価格情報」と「検証できない主張」を禁じている。
 * @param {string} text
 * @returns {{ price: string[], claim: string[] }}
 */
export function findCreativeAssetIssues(text) {
  const hit = (/** @type {Array<[RegExp,string]>} */ list) => list.filter(([re]) => re.test(text)).map(([, d]) => d);
  return { price: hit(PRICE_RES), claim: hit(CLAIM_RES) };
}

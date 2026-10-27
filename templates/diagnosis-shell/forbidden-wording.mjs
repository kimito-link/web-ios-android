// アプリと拡張の描画に、紹介・有料・LINEの文言が混ざっていないかを見る。
// なぜ要るか: テンプレートの出し分けが壊れても、テストが赤になって店頭ビルドに残らないようにする。
// 診断本文そのものの良否は見ない。シェルが描いた文字列だけを見る。

export const FORBIDDEN_RULES = Object.freeze([
  {
    id: 'referral',
    re: /紹介コード|紹介リンク|紹介URL|アフィリエイト|affiliate|referral|代理店コード|[?&](?:ref|af)=/i,
  },
  {
    id: 'paid',
    re: /料金|価格|有料|課金|月額|買い切り|プライシング|\bpricing\b|\bprice\b|\bsubscription\b|\bpaid\b|\/price\/|￥|¥/,
  },
  {
    id: 'line',
    re: /LINE公式|ライン公式|\bLINE\b|line\.me/i,
  },
]);

/**
 * @param {string} html
 * @returns {Array<{id: string, match: string}>}
 */
export function findForbiddenWording(html) {
  const text = String(html || '');
  const hits = [];
  for (const rule of FORBIDDEN_RULES) {
    const found = text.match(rule.re);
    if (found) hits.push({ id: rule.id, match: found[0] });
  }
  return hits;
}

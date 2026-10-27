// テンプレートを単体で開いたときの見本診断。本番の診断に差し替える前提。
// なぜ要るか: ドメインを入れた瞬間に点数とひとことが端末内で出る流れを、通信なしで確認できるようにする。
// 外部へは送らない。見本であることは要約の文に書く。

/**
 * @param {string} domain
 */
export function previewDiagnose(domain) {
  let hash = 0;
  for (const ch of domain) hash = (Math.imul(hash, 33) + ch.charCodeAt(0)) >>> 0;
  const score = 40 + (hash % 61);
  const status = score >= 80 ? 'good' : score >= 60 ? 'warn' : 'bad';
  return {
    domain,
    score,
    status,
    checkedAt: new Date().toISOString(),
    summary: {
      ja: `${domain} の見本です。端末内で計算し、外部へは送っていません。`,
      en: `Preview for ${domain}. Counted on this device and not sent anywhere.`,
    },
  };
}

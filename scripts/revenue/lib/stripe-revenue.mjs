/**
 * stripe-revenue.mjs — Stripe REST API を直叩きしてプロダクト単位の売上を集計する。
 *
 * 設計: _docs/DESIGN-revenue-bottleneck-dashboard-2026-09-08.md §B-4, D-3
 * ★依存を増やさない: 公式SDK(`stripe`パッケージ)を新規導入せず、既存の
 * asc-api.mjs/play-api.mjsと同じ「fetch直叩き」の流儀に合わせる。
 * apiVersionは templates/stripe-checkout-email と揃える(2025-08-27以降、
 * Invoice line itemの形が price → pricing.price_details に変わった。設計B-4)。
 *
 * ★1アカウント共有(設計F1)なので、振り分けキーは必ずProduct/Price。
 * webhook誤発火と同じ事故を再現しない(D-3)。
 */
const API_BASE = 'https://api.stripe.com/v1';
const API_VERSION = '2025-08-27.basil';

function authHeaders(secretKey) {
  return {
    Authorization: `Bearer ${secretKey}`,
    'Stripe-Version': API_VERSION,
  };
}

async function stripeGet(secretKey, path, params = {}) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { headers: authHeaders(secretKey) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

/** ページングしながら全件集める(最大100件/req、has_moreで継続)。 */
async function stripeListAll(secretKey, path, params = {}) {
  const items = [];
  let startingAfter;
  for (let guard = 0; guard < 200; guard++) {
    const page = await stripeGet(secretKey, path, {
      ...params,
      limit: 100,
      starting_after: startingAfter,
    });
    items.push(...(page.data || []));
    if (!page.has_more || (page.data || []).length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return items;
}

/**
 * Product.metadata.product_id → registry product id のマッピングを、
 * Stripe側から読み取る(設計B-1: 対応表をStripeの中に置く)。
 */
export async function loadStripeProductMapping(secretKey) {
  const products = await stripeListAll(secretKey, '/products', { active: true });
  const mapping = new Map(); // stripeProductId -> registryProductId
  const unassigned = []; // metadata.product_id が無いProduct
  for (const p of products) {
    const registryId = p.metadata?.product_id;
    if (registryId) {
      mapping.set(p.id, registryId);
    } else {
      unassigned.push({ id: p.id, name: p.name });
    }
  }
  return { mapping, unassigned, allProducts: products };
}

function toRegistryId(mapping, stripeProductId) {
  return mapping.get(stripeProductId) || null;
}

/**
 * 買い切り(Payment Link/Checkout)の集計。
 * status=complete && payment_status=paid && mode=payment のセッションを対象に、
 * line_items[].price.product で振り分ける。
 */
async function collectCheckoutSessions(secretKey, sinceUnix) {
  const sessions = await stripeListAll(secretKey, '/checkout/sessions', {
    created: undefined,
    'created[gte]': sinceUnix,
    'expand[]': 'data.line_items',
  });
  return sessions.filter((s) => s.status === 'complete' && s.payment_status === 'paid' && s.mode === 'payment');
}

/**
 * サブスク(初回＋更新)の集計。paid invoiceを対象に、
 * lines.data[].pricing.price_details.product で振り分ける(2025-03以降のAPI形)。
 */
async function collectPaidInvoices(secretKey, sinceUnix) {
  return stripeListAll(secretKey, '/invoices', {
    status: 'paid',
    'created[gte]': sinceUnix,
  });
}

async function collectActiveSubscriptions(secretKey) {
  return stripeListAll(secretKey, '/subscriptions', { status: 'active' });
}

async function collectBalanceTransactions(secretKey, sinceUnix) {
  return stripeListAll(secretKey, '/balance_transactions', { 'created[gte]': sinceUnix });
}

/**
 * @param {string} secretKey
 * @param {{ days: number }} window
 * @returns {Promise<{
 *   ok: true,
 *   byProduct: Map<string, { gross: number, paidCount: number, activeSubs: number, mrr: number, currency: string }>,
 *   unassignedStripe: Array<{ productId: string, name: string, gross: number }>,
 *   reconcile: { stripeNet: number, refunds: number, fees: number },
 *   currencyMismatch: boolean
 * } | { ok: false, error: string }>}
 */
export async function collectStripeRevenue(secretKey, window) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const sinceUnix = now - window.days * 86400;

    const { mapping, unassigned } = await loadStripeProductMapping(secretKey);

    const byProduct = new Map();
    const unassignedGross = new Map(); // stripeProductId -> gross
    let currencySeen = new Set();

    function addGross(registryIdOrNull, stripeProductId, amount, currency, kind) {
      currencySeen.add(currency);
      if (registryIdOrNull) {
        if (!byProduct.has(registryIdOrNull)) {
          byProduct.set(registryIdOrNull, {
            gross: 0, paidCount: 0, activeSubs: 0, mrr: 0, currency,
          });
        }
        const entry = byProduct.get(registryIdOrNull);
        entry.gross += amount;
        if (kind === 'paidCount') entry.paidCount += 1;
      } else {
        unassignedGross.set(stripeProductId, (unassignedGross.get(stripeProductId) || 0) + amount);
      }
    }

    // 買い切り
    const sessions = await collectCheckoutSessions(secretKey, sinceUnix);
    for (const s of sessions) {
      const items = s.line_items?.data || [];
      for (const item of items) {
        const stripeProductId = typeof item.price?.product === 'string' ? item.price.product : item.price?.product?.id;
        if (!stripeProductId) continue;
        const registryId = toRegistryId(mapping, stripeProductId);
        addGross(registryId, stripeProductId, item.amount_total ?? 0, s.currency, 'paidCount');
      }
    }

    // サブスク(初回+更新)
    const invoices = await collectPaidInvoices(secretKey, sinceUnix);
    for (const inv of invoices) {
      const lines = inv.lines?.data || [];
      for (const line of lines) {
        const stripeProductId = line.pricing?.price_details?.product;
        if (!stripeProductId) continue;
        const registryId = toRegistryId(mapping, stripeProductId);
        addGross(registryId, stripeProductId, line.amount ?? 0, inv.currency, 'paidCount');
      }
    }

    // 継続本数・MRR目安
    const activeSubs = await collectActiveSubscriptions(secretKey);
    for (const sub of activeSubs) {
      const items = sub.items?.data || [];
      for (const item of items) {
        const stripeProductId = typeof item.price?.product === 'string' ? item.price.product : item.price?.product?.id;
        if (!stripeProductId) continue;
        const registryId = toRegistryId(mapping, stripeProductId);
        if (!registryId) continue;
        if (!byProduct.has(registryId)) {
          byProduct.set(registryId, { gross: 0, paidCount: 0, activeSubs: 0, mrr: 0, currency: item.price?.currency || 'jpy' });
        }
        const entry = byProduct.get(registryId);
        entry.activeSubs += 1;
        // MRR目安: 月額換算(interval=monthならそのまま、yearなら/12)
        const unitAmount = item.price?.unit_amount ?? 0;
        const interval = item.price?.recurring?.interval;
        entry.mrr += interval === 'year' ? Math.round(unitAmount / 12) : unitAmount;
      }
    }

    // 突合
    const balanceTx = await collectBalanceTransactions(secretKey, sinceUnix);
    let stripeNet = 0, refunds = 0, fees = 0;
    for (const tx of balanceTx) {
      stripeNet += tx.net ?? 0;
      fees += tx.fee ?? 0;
      if (tx.type === 'refund') refunds += Math.abs(tx.amount ?? 0);
    }

    const unassignedStripe = Array.from(unassignedGross.entries()).map(([productId, gross]) => {
      const meta = unassigned.find((u) => u.id === productId);
      return { productId, name: meta?.name || productId, gross };
    });

    return {
      ok: true,
      byProduct,
      unassignedStripe,
      reconcile: { stripeNet, refunds, fees },
      currencyMismatch: currencySeen.size > 1,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

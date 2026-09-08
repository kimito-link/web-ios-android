/**
 * asc-sales.mjs — Apple salesReports(TSV gzip)を解凍・パースしてDL数/IAP proceedsを集計する。
 *
 * 設計: _docs/DESIGN-revenue-bottleneck-dashboard-2026-09-08.md §B-5, D-1
 * ★全アプリ分が1ファイルで返るので、日ごとに1回GETし、Apple Identifier列で
 * ascAppIdへ振り分ける。DLはProduct Type Identifier ∈ {1,1F,1T,1E,1EP,1EU}、
 * IAPは {3,3F,IA1,IA9,IAY,IAC} のDeveloper Proceeds。7系(アップデート)は除外。
 */
import { gunzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fetchSalesReportRaw } from '../../../templates/scripts/lib/asc-api.mjs';

const DOWNLOAD_TYPE_IDS = new Set(['1', '1F', '1T', '1E', '1EP', '1EU']);
const IAP_TYPE_IDS = new Set(['3', '3F', 'IA1', 'IA9', 'IAY', 'IAC']);

/** TSVを行→列オブジェクトの配列にパースする(タブ区切り、1行目がヘッダ)。 */
function parseTsv(text) {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cols = line.split('\t');
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i]; });
    return row;
  });
}

function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * @param {{keyId:string, issuerId:string, privateKey:string, vendorNumber:string, version?:string}} auth
 * @param {{days:number, cacheDir:string}} opts
 * @returns {Promise<{ ok: true, byAppId: Map<string, {units:number, proceeds:number, currency:string}> } | { ok:false, error:string, howToFix?:string }>}
 */
export async function collectAscSales(auth, opts) {
  const { days, cacheDir } = opts;
  const version = auth.version || '1_1';
  const byAppId = new Map();
  try {
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

    // 前日分は太平洋時間の翌朝以降に反映される(設計D-1)。当日を要求せず2日前までとする。
    const today = new Date();
    const to = new Date(today.getTime() - 2 * 86400_000);

    for (let i = 0; i < days; i++) {
      const d = new Date(to.getTime() - i * 86400_000);
      const ds = dateStr(d);
      const cachePath = join(cacheDir, `${ds}.tsv`);

      let text;
      if (existsSync(cachePath)) {
        text = readFileSync(cachePath, 'utf8');
      } else {
        const result = await fetchSalesReportRaw({
          keyId: auth.keyId,
          issuerId: auth.issuerId,
          privateKey: auth.privateKey,
          vendorNumber: auth.vendorNumber,
          reportDate: ds,
          version,
        });
        if (result.notFound) {
          text = ''; // 売上ゼロの日
        } else {
          text = gunzipSync(result.gzipBuffer).toString('utf8');
        }
        writeFileSync(cachePath, text, 'utf8');
      }

      if (!text) continue;
      const rows = parseTsv(text);
      for (const row of rows) {
        const appId = row['Apple Identifier'];
        const typeId = row['Product Type Identifier'];
        if (!appId || !typeId) continue;
        if (!byAppId.has(appId)) {
          byAppId.set(appId, { units: 0, proceeds: 0, currency: row['Currency of Proceeds'] || 'USD' });
        }
        const entry = byAppId.get(appId);
        const units = Number(row['Units'] || 0);
        const proceeds = Number(row['Developer Proceeds'] || 0);
        if (DOWNLOAD_TYPE_IDS.has(typeId)) {
          entry.units += units;
        } else if (IAP_TYPE_IDS.has(typeId)) {
          entry.proceeds += proceeds;
        }
      }
    }

    return { ok: true, byAppId };
  } catch (e) {
    const msg = String(e?.message || e);
    const howToFix = msg.includes('403')
      ? 'ASC > Users and Access > Integrations で Sales/Admin/Financeロールの鍵を別途作成してください（App Manager鍵では通りません）'
      : undefined;
    return { ok: false, error: msg, howToFix };
  }
}

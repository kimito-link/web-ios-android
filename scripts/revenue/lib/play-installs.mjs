/**
 * play-installs.mjs — Play Console が自動配置するCloud StorageのCSVから
 * インストール数を集計する(Reporting APIにinstallsは無い。設計F7/D-2)。
 */
import { listInstallReportObjects, fetchInstallReportCsv } from '../../../templates/scripts/lib/play-api.mjs';

/** UTF-16LE CSVをパースする(カンマ区切り、1行目がヘッダ)。 */
function parseCsv(text) {
  const lines = text.split('\r\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.replace(/^"|"$/g, ''));
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i]; });
    return row;
  });
}

function yyyymm(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * @param {object} sa - service account
 * @param {string} bucket
 * @param {string} packageName
 * @param {{days:number}} opts
 * @returns {Promise<{ ok:true, installs:number, lagDays:number } | { ok:false, error:string, howToFix?:string }>}
 */
export async function collectPlayInstalls(sa, bucket, packageName, opts) {
  try {
    const objects = await listInstallReportObjects(sa, bucket, packageName);
    // 当月＋前月の2ファイル/アプリ(設計B-6)。
    const now = new Date();
    const thisMonth = yyyymm(now);
    const prevMonth = yyyymm(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const targets = objects.filter((name) => name.includes(`_${thisMonth}_`) || name.includes(`_${prevMonth}_`));

    if (targets.length === 0) {
      return { ok: false, error: `installs report object not found for ${packageName} (bucket=${bucket})`, howToFix: 'Play Console側でSAへの「一括レポートのダウンロード」権限付与、またはバケットIDを確認してください' };
    }

    let installs = 0;
    let latestDate = null;
    const cutoff = new Date(Date.now() - opts.days * 86400_000);

    for (const objectName of targets) {
      const text = await fetchInstallReportCsv(sa, bucket, objectName);
      const rows = parseCsv(text);
      for (const row of rows) {
        const dateStr = row['Date'];
        const count = Number(row['Daily User Installs'] || 0);
        if (!dateStr || Number.isNaN(count)) continue;
        const d = new Date(dateStr);
        if (Number.isNaN(d.getTime())) continue;
        if (d >= cutoff) installs += count;
        if (!latestDate || d > latestDate) latestDate = d;
      }
    }

    const lagDays = latestDate ? Math.round((Date.now() - latestDate.getTime()) / 86400_000) : null;
    return { ok: true, installs, lagDays };
  } catch (e) {
    const msg = String(e?.message || e);
    const howToFix = msg.includes('403')
      ? 'Play Console > ユーザーと権限 でサービスアカウントに「アプリ情報の閲覧（一括レポートのダウンロード）」を付与してください（GCP IAMだけでは不足）'
      : undefined;
    return { ok: false, error: msg, howToFix };
  }
}

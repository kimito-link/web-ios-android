// 役割: アプリ名の商標確認の記録(store-assets/trademark-check.json)を点検する純関数(check-trademark.mjs と lint-pre-submission の CHECK 36)。
// なぜ要るか: App Store・Google Play には商標侵害の申し立て窓口があり、通ればアプリの削除や改名を求められる。
//   名前は公開後に変えるほど高くつくので、ストアに出す前に J-PlatPat で第9類・第42類(必要なら35類)を調べて記録させる。
//   りんくの指示(2026-11-21「これも全体設定に」)。ルール本文: docs/ai-rules/14_TRADEMARK_CHECK.md
// 見るのは「記録がある・名前がいまの表示名と同じ・9と42を調べた・conflictでない・古すぎない」まで。似ているかの判断はしない。
// fs に触らない。読み込みと出力は呼び出し側がする。

export const TRADEMARK_RECORD_PATH = 'store-assets/trademark-check.json';
export const REQUIRED_CLASSES = Object.freeze([9, 42]);
export const VERDICTS = Object.freeze(['clear', 'own', 'renamed', 'conflict']);
export const STALE_DAYS = 180;
export const JPLATPAT_URL = 'https://www.j-platpat.inpit.go.jp/t0100';

const norm = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();

function daysBetween(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.floor((tb - ta) / 86400000);
}

/**
 * @param {{ record: object|null|undefined, recordError?: string, displayName?: string, today?: string }} p
 * @returns {{ status: 'ok'|'warn'|'fail'|'skip', name: string, guideline: string, detail: string }}
 */
export function checkTrademarkRecord({ record, recordError, displayName, today = new Date().toISOString().slice(0, 10) }) {
  const base = { name: 'trademark', guideline: 'trademark' };
  const how = `J-PlatPat(${JPLATPAT_URL})で第9類・第42類を調べ、${TRADEMARK_RECORD_PATH} に残す(雛形: node scripts/check-trademark.mjs --init、手順: docs/ai-rules/14_TRADEMARK_CHECK.md)`;
  if (recordError) return { ...base, status: 'fail', detail: `${TRADEMARK_RECORD_PATH} が読めない(${recordError})` };
  if (!record) {
    if (!displayName) return { ...base, status: 'skip', detail: 'アプリ名(app.config.json の identity.displayName)も商標の記録も無い' };
    return { ...base, status: 'fail', detail: `「${displayName}」の商標確認の記録が無い。${how}` };
  }
  const problems = [];
  const name = String(record.name ?? '').trim();
  if (!name) problems.push('記録に name が無い');
  else if (displayName && norm(name) !== norm(displayName)) {
    problems.push(`記録の名前「${name}」がいまのアプリ名「${displayName}」と違う(改名したら新しい名前で調べ直す)`);
  }
  const classes = Array.isArray(record.classes) ? record.classes.map(Number) : [];
  const missing = REQUIRED_CLASSES.filter((c) => !classes.includes(c));
  if (missing.length) problems.push(`第${missing.join('・')}類を調べた記録が無い`);
  if (!VERDICTS.includes(record.verdict)) problems.push(`verdict は ${VERDICTS.join(' / ')} のどれか(いま: ${record.verdict ?? 'なし'})`);
  else if (record.verdict === 'conflict') problems.push('同じ・似た商標が他人にある(verdict: conflict)。名前を変えて調べ直す');
  if (!Array.isArray(record.searches) || record.searches.length === 0) problems.push('searches(実際に入れた語と件数)が空');
  const age = daysBetween(record.checkedAt, today);
  if (age === null) problems.push('checkedAt が日付(YYYY-MM-DD)でない');
  if (problems.length) return { ...base, status: 'fail', detail: problems.join(' ／ ') };
  if (age > STALE_DAYS) {
    return { ...base, status: 'warn', detail: `商標の確認が ${age} 日前(${record.checkedAt})。${STALE_DAYS}日を超えたので、提出前に J-PlatPat で調べ直して checkedAt を更新する` };
  }
  const own = record.verdict === 'own' ? '(自社の商標)' : '';
  return { ...base, status: 'ok', detail: `「${name}」第${classes.join('・')}類 ${record.verdict}${own}・${record.checkedAt} 確認` };
}

/** --init で書く雛形。検索結果は AI が J-PlatPat を見て埋める。 */
export function trademarkRecordTemplate({ displayName = '', today = new Date().toISOString().slice(0, 10) } = {}) {
  return {
    name: displayName,
    readings: [],
    checkedAt: today,
    checkedBy: '',
    classes: [9, 42],
    searches: [],
    similar: [],
    verdict: '',
    notes: '',
    filingProposal: '',
  };
}

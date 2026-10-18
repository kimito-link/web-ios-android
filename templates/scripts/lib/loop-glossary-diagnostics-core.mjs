// @ts-check
/**
 * loop-glossary-diagnostics-core.mjs — 汎用診断(check-*.mjs)の「各検査が何を見るか」を、検査スクリプトの先頭コメントから取り出す純関数。
 *
 * 役割: ローカルAIに渡す用語集（固定の知識）のうち、診断アダプタ(loop-adapter-diagnostics)のカード id＝検査名の意味を、手書きでなく機械的に作る。
 *   設計: _docs/DESIGN-self-improvement-loop-2026-10-18.md §11・SPEC-loop-propose-v1.md（用語集は知識でありデータではない）。
 * 取り出し方: 先頭のコメント（/** … *\/ または連続する // 行）の最初の意味のある文。書式は検査ごとに少し違うので、次の順で拾う:
 *   「check-xxx.mjs — ★説明」→ 「—」の後ろ／ファイル名だけの行 → 次の行／ファイル名が無い行 → その行そのもの。★・装飾は落とし、最初の「。」まで・最大 MAX_DESC 字。
 *   説明が取れない検査は「説明が書かれていない」と正直に書く（作り話をしない）。
 * 限界: 先頭コメントの質がそのまま用語集の質になる（「何を見るか」でなく「なぜ作ったか」が先に書かれた検査は、説明が的外れになる）。
 */

/** 1検査の説明の最大字数（用語集の上限 4KiB に収めるため）。 */
export const MAX_DESC = 48;

/**
 * ファイルの先頭コメントの本文行（記号を除いたもの）を返す。
 * @param {string} src
 * @returns {string[]}
 */
export function headerCommentLines(src) {
  const lines = src.replace(/^#!.*\n/, '').split('\n');
  /** @type {string[]} */
  const out = [];
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i < lines.length && lines[i].trim().startsWith('/**')) {
    for (; i < lines.length; i++) {
      const raw = lines[i].trim();
      const end = raw.includes('*/');
      const body = raw.replace(/^\/\*\*?/, '').replace(/\*\/\s*$/, '').replace(/^\*\s?/, '').trim();
      out.push(body);
      if (end) break;
    }
  } else {
    for (; i < lines.length && lines[i].trim().startsWith('//'); i++) out.push(lines[i].trim().replace(/^\/\/+\s?/, '').trim());
  }
  return out;
}

/**
 * 検査スクリプトのソースから、1行の説明を取り出す。取れなければ null。
 * @param {string} src
 * @param {string} fileName 例: check-foo.mjs
 */
export function describeCheck(src, fileName) {
  const body = headerCommentLines(src).filter((l) => l !== '');
  if (body.length === 0) return null;
  const nameRe = new RegExp('^' + fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(?:[—–-]+\\s*)?(.*)$');
  let text = body[0];
  const m = nameRe.exec(text);
  if (m) text = m[1].trim() !== '' ? m[1] : (body[1] ?? '');
  // 文が複数行にまたがるとき（// 形式の折り返し）は、最初の「。」が出るまで最大3行をつなぐ
  if (!text.includes('。')) {
    const start = m && m[1].trim() === '' ? 1 : 0;
    const rest = body.slice(start, start + 3).join('');
    const joined = m && m[1].trim() !== '' ? m[1] + body.slice(1, 3).join('') : rest;
    if (joined.includes('。')) text = joined;
  }
  text = text.replace(/^[★☆\s]+/, '').replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  const cut = text.indexOf('。');
  if (cut > 0) text = text.slice(0, cut);
  return text.length > MAX_DESC ? text.slice(0, MAX_DESC - 1) + '…' : text;
}

/**
 * 用語集の本文を組む。
 * @param {Array<{ name: string, desc: string | null }>} checks name は check-xxx（拡張子なし）
 * @param {Record<string, string>} fixed 診断カードの固定の説明（loop-adapter-diagnostics-core の CARD_GLOSSARY）
 */
export function formatDiagnosticsGlossary(checks, fixed) {
  const lines = ['【検査名（診断カードのid。失敗または測れなかった検査だけがカードになる）】'];
  for (const c of checks) lines.push(`- ${c.name}: ${c.desc ?? '（先頭コメントに説明が書かれていない）'}`);
  lines.push('', '【カードのid・指標の意味】');
  for (const [k, v] of Object.entries(fixed)) lines.push(`- ${k}: ${v}`);
  return lines.join('\n') + '\n';
}

// @ts-check
/**
 * proposal-format-core.mjs — 自己改善ループの「提案書」(Markdown)が決まった形かを検査する純関数。
 *
 * 役割: AI（または人間）が書いた提案書が、人間に渡してよい形か判定する。形が違えば人間に渡さない（台帳に rejected(format)）。
 *   設計: _docs/DESIGN-self-improvement-loop-2026-10-18.md §4 部品3・§8。
 * 何を強制するか（すべて「形」＝客観的に判定できること）:
 *   - 先頭のヘッダー行（schema / proposal / project / cards / writer）。writer は「誰が書いたか」のメタ欄で、処理の条件にしない。
 *   - 見出しがちょうど 症状 / 観測 / 原因仮説 / 版の提案 / 検証手順 の順（増減なし）
 *   - 原因仮説の各項目に 【確証】か【推測】・確度・反証方法。【確証】には根拠（card:/test:/diff:/実測）
 *   - 版の提案に「変更:」がちょうど1行（1版1変更）・触るファイル候補・やらないこと
 *   - 観測の数字は、参照したカードの metrics の値だけ（カードを渡したとき）
 *   - 秘密・メールらしき形を含まない
 * 限界（過信しない）: 仮説が**正しいか**、確度の付け方が妥当かは検査できない。形が整っていることは、内容が良いことを意味しない。
 */
import { SECRET_LIKE } from './symptom-card-core.mjs';

export const MAX_BYTES = 32 * 1024;
export const SECTIONS = Object.freeze(['症状', '観測', '原因仮説', '版の提案', '検証手順']);
const HEADER_KEYS = Object.freeze(['schema', 'proposal', 'project', 'cards', 'writer']);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const WRITER_RE = /^(human|ai):[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
/** 提案書で見るのは秘密とメールだけ（長い不透明文字列は、パスやsha短縮と区別できないので見ない）。 */
const BODY_BAD = SECRET_LIKE.filter(([, name]) => ['secret-like(sk-)', 'secret-like(bearer)', 'secret-variable-name', 'email-like'].includes(name));

/**
 * @param {string} text 提案書の本文
 * @param {{ cards?: Array<Record<string, any>>, ledger?: Array<Record<string, any>> }} [opts]
 *   cards: 参照カード（渡すと観測の数字を照合）／ledger: 台帳（渡すと「却下済み:」の参照先を照合）
 * @returns {{ ok: boolean, violations: Array<{ where: string, rule: string }> }}
 */
export function validateProposal(text, opts = {}) {
  const v = [];
  /** @param {string} where @param {string} rule */
  const bad = (where, rule) => v.push({ where, rule });
  if (typeof text !== 'string') return { ok: false, violations: [{ where: '$', rule: 'not-a-string' }] };
  if (Buffer.byteLength(text) > MAX_BYTES) bad('$', `too-large(>${MAX_BYTES}B)`);
  for (const [re, name] of BODY_BAD) if (re.test(text)) bad('$', name);

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const firstH2 = lines.findIndex((l) => /^## /.test(l));
  const headerLines = (firstH2 === -1 ? lines : lines.slice(0, firstH2)).filter((l) => l.trim() !== '');

  // ヘッダー
  /** @type {Record<string, string>} */
  const header = {};
  for (const l of headerLines) {
    const m = /^([a-z]+):\s*(.*)$/.exec(l);
    if (!m) { bad('header', 'line-not-key-value'); continue; }
    if (!HEADER_KEYS.includes(m[1])) bad('header', `unknown-key(${m[1]})`);
    else header[m[1]] = m[2].trim();
  }
  if (header.schema !== '1') bad('header.schema', 'schema-must-be-1');
  if (!header.proposal || !ID_RE.test(header.proposal)) bad('header.proposal', 'format');
  if (!header.project || !ID_RE.test(header.project)) bad('header.project', 'format');
  if (!header.writer || !WRITER_RE.test(header.writer)) bad('header.writer', 'format(human:<name> | ai:<model>)');
  const cardIds = (header.cards || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (cardIds.length === 0) bad('header.cards', 'at-least-one-card');
  for (const id of cardIds) if (!ID_RE.test(id)) bad('header.cards', 'id-format');

  // 見出し（ちょうど5つ・この順）
  const h2 = lines.filter((l) => /^## /.test(l)).map((l) => l.slice(3).trim());
  if (h2.length !== SECTIONS.length || h2.some((h, i) => h !== SECTIONS[i])) bad('sections', `must-be-exactly:${SECTIONS.join('/')}`);

  /** @param {string} name */
  const body = (name) => {
    const i = lines.findIndex((l) => l.trim() === `## ${name}`);
    if (i === -1) return null;
    const rest = lines.slice(i + 1);
    const end = rest.findIndex((l) => /^## /.test(l));
    return (end === -1 ? rest : rest.slice(0, end)).join('\n');
  };

  for (const s of SECTIONS) {
    const b = body(s);
    if (b !== null && b.trim() === '') bad(`## ${s}`, 'empty');
  }

  // 原因仮説
  const hyp = body('原因仮説');
  if (hyp !== null && hyp.trim() !== '') {
    const items = hyp.split(/\n(?=- )/).map((s) => s.trim()).filter((s) => s.startsWith('- '));
    if (items.length === 0) bad('## 原因仮説', 'no-items(- で始まる項目が要る)');
    items.forEach((it, i) => {
      const tag = `## 原因仮説 #${i + 1}`;
      const conf = /【(確証|推測)】/.exec(it);
      if (!conf) bad(tag, 'needs-【確証】or【推測】');
      if (!/確度[:：]\s*(高|中|低)/.test(it)) bad(tag, 'needs-確度(高|中|低)');
      if (!/反証[:：]\s*\S+/.test(it)) bad(tag, 'needs-反証');
      if (conf && conf[1] === '確証' && !/根拠[:：]\s*[^\n]*(card:|test:|diff:|実測)/.test(it)) bad(tag, '確証-needs-根拠(card:|test:|diff:|実測)');
    });
  }

  // 版の提案（1版1変更）
  const ver = body('版の提案');
  if (ver !== null && ver.trim() !== '') {
    const changes = ver.split('\n').filter((l) => /^\s*-?\s*変更[:：]\s*\S+/.test(l));
    if (changes.length !== 1) bad('## 版の提案', `must-have-exactly-one-変更(found ${changes.length})`);
    if (!/触るファイル候補[:：]\s*\S+/.test(ver)) bad('## 版の提案', 'needs-触るファイル候補');
    if (!/やらないこと[:：]\s*\S+/.test(ver)) bad('## 版の提案', 'needs-やらないこと');
  }

  // 観測の数字はカードの値だけ
  if (opts.cards) {
    const byId = new Map(opts.cards.map((c) => [c.id, c]));
    for (const id of cardIds) if (!byId.has(id)) bad('header.cards', 'card-not-found');
    const refs = cardIds.map((id) => byId.get(id)).filter(Boolean);
    const allowed = new Set();
    for (const c of refs) for (const val of Object.values(c.metrics || {})) if (typeof val === 'number') allowed.add(val);
    const obs = body('観測');
    if (obs) {
      const noCode = obs.replace(/`[^`]*`/g, ' '); // コード表記（キー名など）の中は数字として数えない
      for (const t of noCode.match(/(?<![A-Za-z0-9_.])-?\d+(?:\.\d+)?(?![A-Za-z0-9_])/g) || []) {
        if (!allowed.has(Number(t))) bad('## 観測', 'number-not-in-cards');
      }
    }
  }

  // 却下済みの参照先
  if (opts.ledger) {
    for (const m of text.matchAll(/却下済み[:：]\s*([A-Za-z0-9][A-Za-z0-9_.-]*)/g)) {
      const ok = opts.ledger.some((e) => (e.id === m[1] || e.proposal === m[1]) && e.decision === 'rejected');
      if (!ok) bad('却下済み', 'referenced-id-not-rejected-in-ledger');
    }
  }
  return { ok: v.length === 0, violations: v };
}

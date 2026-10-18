// @ts-check
/**
 * loop-adapter-diagnostics-core.mjs — 自己改善ループの第2のアダプタ（汎用診断 `npm run diagnostics` → 症状カード）の純関数。
 *
 * 役割: templates/diagnostics/run.mjs の「診断結果まとめ」（`<印> <検査名>: <状態>` の行）を読み、AIに渡してよい症状カードにする。
 *   どのプロジェクトでも同じ形で出る入口なので、これ1つで全プロジェクトに使える。設計: _docs/DESIGN-self-improvement-loop-2026-10-18.md §10 第6歩。
 * 意味: ループ本体（症状カード検査・提案書づくり・形式検査・承認台帳）に**手を入れずに**2つ目の入口が動くことが、共通化できている証拠。
 * 安全: 読むのは「検査名の形をした語」と状態（pass/fail/unmeasured/skip）だけ。検査名は `check-<小文字・数字・ハイフン>` の形（任意で末尾 `(英小文字)`）に
 *   限り、それ以外の行・語は捨てて件数だけを数値で残す（unparsedCount）。検査の出力本文（ファイル名・メッセージ等）には一切触れない。
 *   最終的にキット正本の許可リスト検査（symptom-card-core）を通ったカードだけを書く。
 */

/** 診断のまとめ行: `✓ check-xxx: pass` / `✗ …: fail` / `? …: unmeasured` / `- …: skip`。 */
const LINE_RE = /^([✓✗?-])\s+(check-[a-z0-9-]+(?:\([a-z]+\))?):\s+(pass|fail|unmeasured|skip)\s*$/;
const SUMMARY_MARK = '--- 診断結果まとめ ---';

/** 検査名をカードの id にできる形へ（`check-selftest-coverage(scripts)` → `check-selftest-coverage-scripts`）。 @param {string} name */
export function idOfCheck(name) {
  return name.replace(/\((.+)\)$/, '-$1');
}

/** 任意の文字列を project/version に使える形へ（英数 . _ - 以外は - に）。 @param {string} s @param {string} fallback */
export function safeToken(s, fallback) {
  const t = String(s ?? '').replace(/[^A-Za-z0-9_.-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 40);
  return t || fallback;
}

/**
 * @param {string} text run.mjs の出力全体
 * @returns {{ checks: Array<{ name: string, status: 'pass'|'fail'|'unmeasured'|'skip' }>, unparsed: number, found: boolean }}
 */
export function parseDiagnosticsSummary(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const i = lines.findIndex((l) => l.trim() === SUMMARY_MARK);
  if (i === -1) return { checks: [], unparsed: 0, found: false };
  /** @type {Array<{ name: string, status: 'pass'|'fail'|'unmeasured'|'skip' }>} */
  const checks = [];
  let unparsed = 0;
  for (const raw of lines.slice(i + 1)) {
    const l = raw.trim();
    if (l === '') {
      if (checks.length > 0 || unparsed > 0) break; // まとめの終わり（空行）
      continue;
    }
    const m = LINE_RE.exec(l);
    if (m) checks.push({ name: m[2], status: /** @type {any} */ (m[3]) });
    else unparsed++;
  }
  return { checks, unparsed, found: true };
}

/**
 * 診断の結果から症状カードを組む。fail と unmeasured の検査は、それぞれ1枚のカード（id=検査名）。加えて全体の健全性カード（diagnostics-summary）。
 * @param {string} text
 * @param {{ project: string, version: string, now?: Date, buildId?: string }} ctx
 * @returns {Array<Record<string, unknown>>} 診断のまとめが無ければ空（測れていない。呼び出し側が exit 2 にする）
 */
export function buildCardsFromDiagnostics(text, ctx) {
  const { checks, unparsed, found } = parseDiagnosticsSummary(text);
  if (!found || checks.length === 0) return [];
  const at = (ctx.now ?? new Date()).toISOString();
  const count = (/** @type {string} */ s) => checks.filter((c) => c.status === s).length;
  const base = { schema: 1, project: ctx.project, source: 'diagnostics-adapter', version: ctx.version, ...(ctx.buildId ? { buildId: ctx.buildId } : {}), at };
  const metrics = { checksTotal: checks.length, passCount: count('pass'), failCount: count('fail'), unmeasuredCount: count('unmeasured'), skipCount: count('skip'), unparsedCount: unparsed };
  const cards = checks
    .filter((c) => c.status === 'fail' || c.status === 'unmeasured')
    .map((c) => ({ ...base, id: idOfCheck(c.name), verdict: c.status, metrics: { failCount: c.status === 'fail' ? 1 : 0, unmeasuredCount: c.status === 'unmeasured' ? 1 : 0 } }));
  cards.push({
    ...base,
    id: 'diagnostics-summary',
    verdict: metrics.failCount > 0 ? 'fail' : metrics.unmeasuredCount > 0 ? 'unmeasured' : 'ok',
    metrics,
  });
  return cards;
}

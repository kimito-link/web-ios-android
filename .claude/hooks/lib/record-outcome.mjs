// @ts-check
/**
 * record-outcome.mjs — ブロッキング hook の結末(deny 等)を結末台帳へ1行追記する I/O 薄皮。
 *   判定は outcome-ledger-core.mjs(純関数)。ここはファイルの読み書きだけ。
 *
 * ★最重要の約束: この関数は絶対に例外を投げない・hook の判定を変えない(観測であって強制ではない)。
 *   記録に失敗しても hook は自分の permissionDecision をそのまま出す(fail-open)。安全足場(hook 本体)の
 *   邪魔を記録機能が決してしないため、全体を try/catch で握りつぶす。設計: council §7 / surechigai「退行して続行」。
 *
 * 台帳の場所: <repoRoot>/_loop/hook-outcomes.jsonl(`_loop/` は .gitignore 済み＝実データは commit しない)。
 * 止めたいとき: 環境変数 HOOK_OUTCOME_LEDGER_OFF=1。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { appendIfNew, makeRecord, parseLedger } from './outcome-ledger-core.mjs';

/** cwd から祖先の .git を探してリポジトリ直下を返す(無ければ null)。transcript-reads と同じ考え方だが依存を増やさない。 */
function findRepoRoot(/** @type {string} */ startDir) {
  try {
    let dir = resolve(startDir);
    for (;;) {
      if (existsSync(join(dir, '.git'))) return dir;
      const parent = resolve(dir, '..');
      if (parent === dir) return null;
      dir = parent;
    }
  } catch {
    return null;
  }
}

/**
 * hook の結末を台帳へ(冪等・fail-open)。戻り値は観測用で、呼び出し側は無視してよい。
 * @param {Record<string, any>} input hook の stdin JSON(session_id / tool_use_id / cwd を使う)
 * @param {{ hook: string, reasonCategory: string, decision?: string }} meta
 * @returns {{ recorded: boolean, reason: string }}
 */
export function recordOutcome(input, meta) {
  try {
    if (process.env.HOOK_OUTCOME_LEDGER_OFF === '1') return { recorded: false, reason: 'disabled' };
    if (!input || typeof input !== 'object') return { recorded: false, reason: 'no-input' };
    const sessionId = typeof input.session_id === 'string' ? input.session_id : '';
    const toolUseId = typeof input.tool_use_id === 'string' ? input.tool_use_id : '';
    const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
    if (!sessionId || !toolUseId) return { recorded: false, reason: 'missing-ids' };

    const repoRoot = findRepoRoot(cwd);
    if (!repoRoot) return { recorded: false, reason: 'no-repo' };

    const made = makeRecord({
      hook: meta.hook,
      decision: meta.decision || 'deny',
      sessionId,
      toolUseId,
      reasonCategory: meta.reasonCategory,
    });
    if (!made.ok || !made.record) return { recorded: false, reason: 'invalid-record' };

    const ledgerPath = join(repoRoot, '_loop', 'hook-outcomes.jsonl');
    let existing = [];
    try {
      if (existsSync(ledgerPath)) existing = parseLedger(readFileSync(ledgerPath, 'utf8'));
    } catch {
      existing = [];
    }
    const decision = appendIfNew(existing, made.record);
    if (!decision.added) return { recorded: false, reason: decision.reason };

    mkdirSync(dirname(ledgerPath), { recursive: true });
    appendFileSync(ledgerPath, JSON.stringify(made.record) + '\n', 'utf8');
    return { recorded: true, reason: 'ok' };
  } catch {
    // 記録は観測。失敗しても hook の判定は止めない。
    return { recorded: false, reason: 'error' };
  }
}

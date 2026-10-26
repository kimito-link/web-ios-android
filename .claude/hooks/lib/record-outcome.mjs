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

import { appendFileSync, existsSync, mkdirSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { appendIfNew, makeRecord, parseLedger } from './outcome-ledger-core.mjs';

// ★100年設計(hot path を無限肥大させない): 台帳は追記専用で永続に伸びるが、冪等判定は
//   「同じ session_id の同じ tool_use_id を二度数えない」だけで、重複は常に時間的に隣接する
//   (同じ呼び出しが遠く離れた過去に再出現することはない)。よって全文を読まず、末尾の一定バイト
//   だけを走査すれば十分かつ正しい。全文読み(readFileSync)のままだと、deny が増えるほど毎回の
//   ブロッキング判定が重くなる＝安全足場に静かな遅延 decay が溜まる。追記(書き込み)は壊れにくい
//   追記専用のまま保ち、読み側だけを定数コストに固定する。履歴の刈り取りが要るなら別途の明示操作で行う
//   (hot path では file を書き換えない=部分書き込みで台帳を壊さない)。
export const DEDUP_TAIL_BYTES = 64 * 1024;

/** ファイルの末尾 maxBytes だけを読み、完全な行だけを返す(先頭の欠けた行は捨てる)。巨大でも定数コスト。 */
export function readLedgerTailText(path, maxBytes = DEDUP_TAIL_BYTES) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = size > maxBytes ? size - maxBytes : 0;
    const len = size - start;
    if (len <= 0) return '';
    const buf = Buffer.allocUnsafe(len);
    readSync(fd, buf, 0, len, start);
    let text = buf.toString('utf8');
    if (start > 0) {
      // 途中から読んだので先頭行は欠けている可能性がある。最初の改行までを捨てる。
      const nl = text.indexOf('\n');
      text = nl >= 0 ? text.slice(nl + 1) : '';
    }
    return text;
  } finally {
    closeSync(fd);
  }
}

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
      // 冪等判定は末尾の一定バイトだけで足りる(重複は時間的に隣接・上のコメント参照)。全文は読まない。
      if (existsSync(ledgerPath)) existing = parseLedger(readLedgerTailText(ledgerPath));
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

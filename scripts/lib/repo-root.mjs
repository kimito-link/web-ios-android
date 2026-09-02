import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * ★.gitを遡ってリポジトリルートを探す。見つからなければ startDir の1つ上へfallback。
 *
 * ★2026-09-02、generate-architecture-map.mjs / generate-hub-dashboard.mjs に完全同一の
 * この関数を重複実装してしまった実損（CLAUDE.md基準⑥）を受けて切り出した。
 *
 * ★templates/scripts/配下の同名関数（配布物・PAIRSの正本）はここからimportしない。
 * 配布先で自己完結が必須のため、意図的な重複を維持する（templates/scripts/check-instrument-ran.mjs・
 * templates/scripts/check-instrument-proof.mjs・_docs/instruments/check-drift.mjs参照）。
 *
 * @param {string} startDir
 * @returns {string}
 */
export function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(startDir, '..');
}

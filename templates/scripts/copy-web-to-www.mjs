#!/usr/bin/env node
/**
 * Capacitor は webDir: www を見るので、src/ → www/ にミラーする。
 *
 * 「リモート読込型」(capacitor.config の server.url = https://<productionDomain>)
 * を採用している場合、www/ の中身はネイティブアプリの**フォールバック**用。
 * オフライン時や server.url が応答しない場合に最低限の画面が出るだけでよい。
 *
 * 仕組み:
 *   1. www/ をクリーンに作り直す
 *   2. src/ 配下を再帰コピー（dotfiles含む、ただし node_modules / .git は除外）
 *
 * Node 18+ の fs.cp が再帰コピーを公式サポートしているのでそれを使用。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const srcDir = path.join(projectRoot, 'src');
const wwwDir = path.join(projectRoot, 'www');

const EXCLUDE = new Set(['node_modules', '.git', '.DS_Store']);

async function rmrf(target) {
  await fs.rm(target, { recursive: true, force: true });
}

async function copyTree(from, to) {
  await fs.cp(from, to, {
    recursive: true,
    force: true,
    filter: (source) => {
      const base = path.basename(source);
      return !EXCLUDE.has(base);
    },
  });
}

async function main() {
  try {
    await fs.access(srcDir);
  } catch {
    console.error(`[copy-web-to-www] src/ が見つかりません: ${srcDir}`);
    process.exit(1);
  }
  console.log(`[copy-web-to-www] ${srcDir} -> ${wwwDir}`);
  await rmrf(wwwDir);
  await fs.mkdir(wwwDir, { recursive: true });
  await copyTree(srcDir, wwwDir);
  console.log('[copy-web-to-www] done');
}

main().catch((err) => {
  console.error('[copy-web-to-www] failed:', err);
  process.exit(1);
});

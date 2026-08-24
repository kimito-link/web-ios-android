#!/usr/bin/env node
/** Next.js 本体がリポ直下でも apps/web/ 配下でも、共通生成器へ正しい場所を渡す薄い入口。 */
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [webRoot, resolve(webRoot, '..', '..')];
const projectRoot = candidates.find((root) =>
  existsSync(join(root, 'app.config.json'))
  && existsSync(join(root, 'scripts', 'generate-shindan-version.mjs'))
);

if (!projectRoot) {
  console.error('[update-shindan-version] app.config.json と scripts/generate-shindan-version.mjs のあるリポジトリルートを見つけられません。');
  process.exit(2);
}

const generator = join(projectRoot, 'scripts', 'generate-shindan-version.mjs');
const webRootFromProject = relative(projectRoot, webRoot) || '.';
const result = spawnSync(process.execPath, [
  generator,
  '--root', projectRoot,
  '--web-root', webRootFromProject,
  ...process.argv.slice(2)
], { cwd: projectRoot, stdio: 'inherit' });

process.exit(Number.isInteger(result.status) ? result.status : 1);

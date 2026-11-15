#!/usr/bin/env node
// りんくの「人間に確認を求めない」(2026-11-16)を、Claude Code の自動の安全確認(auto mode)へ渡す。
// rules.json の文を ~/.claude/settings.json の autoMode.environment / autoMode.allow に足す。
// - 既定の決まりは "$defaults" で残す（足すだけ。お金・削除・戻せない操作の止め役は既定のまま効く）
// - 何度走らせても同じ結果（marker 付きの古い文は入れ替える）
// - 書く前に settings.json.bak-auto-mode を作る
// - auto mode はプロジェクトの .claude/settings.json の autoMode を読まない（公式 docs: auto-mode-config）ので、
//   必ずユーザーの ~/.claude/settings.json に入れる。
// 使い方: node templates/auto-mode/install.mjs [settings.json のパス]   確認: claude auto-mode config
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** settings オブジェクトに rules を入れた新しいオブジェクトを返す（純関数）。 */
export function applyRules(settings, rules) {
  const s = structuredClone(settings && typeof settings === 'object' ? settings : {});
  s.autoMode = s.autoMode && typeof s.autoMode === 'object' ? s.autoMode : {};
  for (const section of ['environment', 'allow']) {
    const add = rules[section] || [];
    if (add.length === 0) continue;
    const cur = Array.isArray(s.autoMode[section]) ? s.autoMode[section] : ['$defaults'];
    const kept = cur.filter((e) => typeof e !== 'string' || !e.startsWith(rules.marker));
    s.autoMode[section] = [...kept, ...add];
  }
  return s;
}

function main() {
  const target = process.argv[2] || join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json');
  const rules = JSON.parse(readFileSync(join(HERE, 'rules.json'), 'utf8'));
  let settings = {};
  if (existsSync(target)) {
    try {
      settings = JSON.parse(readFileSync(target, 'utf8'));
    } catch (e) {
      console.error(`[auto-mode] ${target} が JSON として読めないので触りません: ${e.message}`);
      process.exit(1);
    }
    copyFileSync(target, target + '.bak-auto-mode');
  } else {
    mkdirSync(dirname(target), { recursive: true });
  }
  const next = applyRules(settings, rules);
  writeFileSync(target, JSON.stringify(next, null, 2) + '\n');
  const n = (k) => next.autoMode[k]?.filter((e) => e.startsWith(rules.marker)).length || 0;
  console.log(`[auto-mode] OK: ${target} に environment ${n('environment')} 件・allow ${n('allow')} 件（既定 $defaults は残したまま）`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

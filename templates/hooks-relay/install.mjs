#!/usr/bin/env node
// install.mjs — web-ios-android の hook 群を、他プロジェクトのセッションにも効くよう ~/.claude/settings.json へ配線する。
//
// やること（何度走らせても同じ結果）:
//   1. web-ios-android-relay.mjs を <~/.claude>/hooks/ へ置く（上書き）。隣に web-ios-android-relay.json（この checkout の場所）を書く
//   2. このリポの .claude/settings.json に配線されている hook を、relay 経由のコマンドにして ~/.claude/settings.json の hooks に足す
//      - 既にそのファイル名を呼ぶコマンドがある（relay 経由でも、クラウドの直接コピーでも）なら足さない（二重に走らせない）
//      - 同じ matcher のまとまりがあればそこへ、無ければまとまりを新しく作る。既存の設定・autoMode などには触らない
//   3. 書く前に settings.json.bak-hooks-relay を作る
// 使い方:
//   node templates/hooks-relay/install.mjs            # 入れる
//   node templates/hooks-relay/install.mjs --dry-run  # 何を足すかだけ表示（何も書かない）
//   node templates/hooks-relay/install.mjs --claude-dir <dir>   # ~/.claude 以外へ（テスト用。CLAUDE_CONFIG_DIR も見る）
// ★PC では auto mode が「自分の設定を書き換える操作」として AI の実行を止めることがある（templates/auto-mode/README.md と同じ）。
//   そのときは本人が1回だけこの1行を走らせる。
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const RELAY_FILE = 'web-ios-android-relay.mjs';
const HOOK_IN_PROJECT_RE = /\.claude\/hooks\/([A-Za-z0-9][A-Za-z0-9._-]*\.mjs)/;

/** プロジェクトの settings から [{event, matcher, hookName, timeout, statusMessage}] を取り出す（純関数）。 */
export function projectHookEntries(projectSettings) {
  const out = [];
  const hooks = projectSettings?.hooks || {};
  for (const [event, groups] of Object.entries(hooks)) {
    for (const g of Array.isArray(groups) ? groups : []) {
      for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
        const m = typeof h?.command === 'string' ? HOOK_IN_PROJECT_RE.exec(h.command) : null;
        if (!m) continue;
        out.push({ event, matcher: g.matcher, hookName: m[1], timeout: h.timeout, statusMessage: h.statusMessage });
      }
    }
  }
  return out;
}

/** relay 経由で hookName を呼ぶコマンド。 */
export function relayCommand(relayPath, hookName) {
  return `node "${relayPath}" ${hookName}`;
}

function mentionsHook(command, hookName) {
  if (typeof command !== 'string') return false;
  const i = command.indexOf(hookName);
  if (i < 0) return false;
  const before = command[i - 1];
  return before === undefined || /[\s"'/\\]/.test(before);
}

/** user settings に entries を relay 経由で足した新しいオブジェクトと、足した/飛ばした一覧を返す（純関数）。 */
export function applyHooks(userSettings, entries, relayPath) {
  const s = structuredClone(userSettings && typeof userSettings === 'object' ? userSettings : {});
  s.hooks = s.hooks && typeof s.hooks === 'object' ? s.hooks : {};
  const added = [];
  const skipped = [];
  for (const e of entries) {
    const groups = (s.hooks[e.event] = Array.isArray(s.hooks[e.event]) ? s.hooks[e.event] : []);
    const already = groups.some((g) => (g?.hooks || []).some((h) => mentionsHook(h?.command, e.hookName)));
    if (already) {
      skipped.push(e);
      continue;
    }
    const hook = { type: 'command', command: relayCommand(relayPath, e.hookName) };
    if (e.timeout !== undefined) hook.timeout = e.timeout;
    if (e.statusMessage !== undefined) hook.statusMessage = e.statusMessage;
    let group = groups.find((g) => g && g.matcher === e.matcher && Array.isArray(g.hooks));
    if (!group) {
      group = e.matcher === undefined ? { hooks: [] } : { matcher: e.matcher, hooks: [] };
      groups.push(group);
    }
    group.hooks.push(hook);
    added.push(e);
  }
  return { settings: s, added, skipped };
}

function parseArgs(argv) {
  const o = { dryRun: false, claudeDir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') o.dryRun = true;
    else if (argv[i] === '--claude-dir') o.claudeDir = argv[++i];
  }
  return o;
}

/** 実際に入れる（テストからも呼ぶ）。戻り値は結果の要約。 */
export function install({ claudeDir, dryRun = false, repoRoot = REPO_ROOT, log = console.log } = {}) {
  const dir = resolve(claudeDir || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'));
  const hooksDir = join(dir, 'hooks');
  const relayPath = join(hooksDir, RELAY_FILE);
  const target = join(dir, 'settings.json');

  const projectSettings = JSON.parse(readFileSync(join(repoRoot, '.claude', 'settings.json'), 'utf8'));
  const entries = projectHookEntries(projectSettings);

  let userSettings = {};
  if (existsSync(target)) {
    try {
      userSettings = JSON.parse(readFileSync(target, 'utf8'));
    } catch (e) {
      throw new Error(`${target} が JSON として読めないので触りません: ${e.message}`);
    }
  }
  const { settings, added, skipped } = applyHooks(userSettings, entries, relayPath);

  for (const e of added) log(`[hooks-relay] 足す: ${e.event} ${e.matcher ?? '(全て)'} → ${e.hookName}`);
  for (const e of skipped) log(`[hooks-relay] 既にある: ${e.event} ${e.matcher ?? '(全て)'} → ${e.hookName}`);
  if (dryRun) {
    log(`[hooks-relay] --dry-run: 何も書いていません（足す ${added.length} 件・既にある ${skipped.length} 件・relay の置き場所 ${relayPath}）`);
    return { target, relayPath, added, skipped, wrote: false };
  }

  mkdirSync(hooksDir, { recursive: true });
  copyFileSync(join(HERE, RELAY_FILE), relayPath);
  writeFileSync(join(hooksDir, 'web-ios-android-relay.json'), JSON.stringify({ root: resolve(repoRoot) }, null, 2) + '\n');
  if (added.length > 0) {
    if (existsSync(target)) copyFileSync(target, target + '.bak-hooks-relay');
    writeFileSync(target, JSON.stringify(settings, null, 2) + '\n');
  }
  log(`[hooks-relay] OK: relay を ${relayPath} に置き、${target} に ${added.length} 件足しました（既にある ${skipped.length} 件はそのまま）`);
  return { target, relayPath, added, skipped, wrote: added.length > 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    install(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error(`[hooks-relay] ${e.message}`);
    process.exit(1);
  }
}

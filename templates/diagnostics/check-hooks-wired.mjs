#!/usr/bin/env node
// check-hooks-wired.mjs — .claude/hooks/配下のhookファイルが実際にsettings.jsonから
// 参照されているか、また同じhookがグローバル~/.claude/settings.jsonにも配線されているかを検出する。
//
// ★なぜ要るか(実損): check-gates-are-wired.mjsは「作ったのに誰も呼ばない検査」を
//   package.json/workflows/run.mjsの3箇所から検出するが、対象は`scripts`/`templates/diagnostics`
//   限定で、`.claude/hooks/`(Claude Code自体のPreToolUseフック)は対象外(同スクリプトの
//   コメントにもこの盲点は明記されていない・2026-09-25発見)。
//
//   さらに2026-09-25、このキット自身がCloudflareトークン操作でauto mode権限分類器に
//   拒否された実損の対処として`.claude/hooks/check-ask-preceded-by-research.mjs`と
//   `check-new-rule-has-machine-check.mjs`を新規実装しプロジェクト内`.claude/settings.json`
//   には配線したが、グローバル`~/.claude/settings.json`への配線はSelf-Modificationガードで
//   自動拒否され、本人の手動反映待ちのまま忘れられるリスクが生じた。
//   「プロジェクト内では配線したのにグローバルには反映されない」というズレそのものを
//   機械的に検出できるようにする。
//
// 検出する2種類の問題:
//   A. `.claude/hooks/*.mjs`が存在するのに、プロジェクト内`.claude/settings.json`の
//      hooks設定からファイル名として一度も参照されていない(孤児hook)。
//   B. プロジェクト内`.claude/settings.json`が参照しているhookファイル名が、
//      グローバル`~/.claude/settings.json`のhooks設定には見当たらない(グローバル未反映)。
//
// ★この検査が判定しないこと:
//   ・hookが正しく動作するかは見ない(参照されているかだけ)。
//   ・グローバル未反映が「意図的か」(このプロジェクト専用のhookで他プロジェクトには
//     要らない)は判断しない。B の検出は常に警告に留め、fail-closedにしない
//     (プロジェクト固有hookをグローバルに強制する設計ではないため)。
//   ・`${CLAUDE_PROJECT_DIR}`のような変数展開後の実際のパス解決はしない
//     (ファイル名の文字列一致だけを見る)。
//
// 使い方:
//   node diagnostics/check-hooks-wired.mjs [対象ディレクトリ]  # 省略時はcwd
//   node diagnostics/check-hooks-wired.mjs --selftest
//   exit 0 = 孤児hookなし(Bのグローバル未反映は警告のみでexit 0に含まれる) / exit 1 = 孤児hook検出 / exit 2 = 測定不能

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

const TARGET_DIR = resolve(process.argv[2] && process.argv[2] !== '--selftest' ? process.argv[2] : process.cwd());

// ---- 純ロジック(fs非依存・単体テスト可) ----------------------------------

/** @param {string} hooksJsonText settings.jsonの中身(JSON文字列) @returns {string[]} 参照されているhookファイル名一覧 */
export function extractReferencedHookFiles(hooksJsonText) {
  let parsed;
  try {
    parsed = JSON.parse(hooksJsonText);
  } catch {
    return [];
  }
  const referenced = new Set();
  const hooks = parsed && parsed.hooks;
  if (!hooks || typeof hooks !== 'object') return [];

  for (const eventName of Object.keys(hooks)) {
    const matchers = hooks[eventName];
    if (!Array.isArray(matchers)) continue;
    for (const matcher of matchers) {
      const hookList = matcher && matcher.hooks;
      if (!Array.isArray(hookList)) continue;
      for (const h of hookList) {
        const command = h && typeof h.command === 'string' ? h.command : '';
        // command文字列の中から "何らかのパス/ファイル名.mjs" を抜き出す。
        const matches = command.match(/[\w.-]+\.mjs/g) || [];
        for (const m of matches) referenced.add(m);
      }
    }
  }
  return Array.from(referenced);
}

/** @param {string[]} hookFiles 実在するhookファイル名一覧 @param {string[]} referenced 参照されているファイル名一覧 @returns {string[]} 孤児(未参照)のファイル名一覧 */
export function findOrphanHooks(hookFiles, referenced) {
  const referencedSet = new Set(referenced);
  return hookFiles.filter((f) => !referencedSet.has(f));
}

/** @param {string[]} projectReferenced プロジェクト内で参照されているhook名 @param {string[]} globalReferenced グローバルで参照されているhook名 @returns {string[]} プロジェクトにはあるがグローバルに無いhook名 */
export function findGlobalGaps(projectReferenced, globalReferenced) {
  const globalSet = new Set(globalReferenced);
  return projectReferenced.filter((f) => !globalSet.has(f));
}

// ---- I/O(直接実行時のみ) ------------------------------------------------------

function runSelftest() {
  const settingsWithHook = JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'node ".claude/hooks/foo.mjs"' }] }] },
  });
  const referenced = extractReferencedHookFiles(settingsWithHook);
  const orphans = findOrphanHooks(['foo.mjs', 'bar.mjs'], referenced);
  const globalGaps = findGlobalGaps(['foo.mjs', 'bar.mjs'], ['foo.mjs']);

  const ok =
    referenced.length === 1 &&
    referenced[0] === 'foo.mjs' &&
    orphans.length === 1 &&
    orphans[0] === 'bar.mjs' &&
    globalGaps.length === 1 &&
    globalGaps[0] === 'bar.mjs';

  if (!ok) {
    console.error('[check-hooks-wired] --selftest 失敗:', { referenced, orphans, globalGaps });
    process.exit(1);
  }
  console.log('[check-hooks-wired] --selftest OK。');
  process.exit(0);
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  if (process.argv.includes('--selftest')) {
    runSelftest();
  } else {
    const hooksDir = join(TARGET_DIR, '.claude', 'hooks');
    if (!existsSync(hooksDir)) {
      console.log('[check-hooks-wired] .claude/hooks/ が無い(skip)。');
      process.exit(0);
    }

    const hookFiles = readdirSync(hooksDir).filter((f) => f.endsWith('.mjs'));
    if (hookFiles.length === 0) {
      console.log('[check-hooks-wired] .claude/hooks/ にmjsファイルが無い(skip)。');
      process.exit(0);
    }

    const projectSettingsPath = join(TARGET_DIR, '.claude', 'settings.json');
    if (!existsSync(projectSettingsPath)) {
      console.log('[check-hooks-wired] .claude/settings.json が無い(測定不能)。');
      process.exit(2);
    }

    let projectSettingsText;
    try {
      projectSettingsText = readFileSync(projectSettingsPath, 'utf8');
    } catch {
      console.log('[check-hooks-wired] .claude/settings.json が読めない(測定不能)。');
      process.exit(2);
    }

    const projectReferenced = extractReferencedHookFiles(projectSettingsText);
    const orphans = findOrphanHooks(hookFiles, projectReferenced);

    let exitCode = 0;
    if (orphans.length > 0) {
      console.error(`[check-hooks-wired] 孤児hook(存在するが.claude/settings.jsonから参照されていない) ${orphans.length} 件:`);
      for (const o of orphans) console.error(`  - .claude/hooks/${o}`);
      exitCode = 1;
    }

    // グローバル未反映は警告のみ(fail-closedにしない。プロジェクト固有hookを
    // グローバルへ強制する設計ではないため)。
    const globalSettingsPath = join(homedir(), '.claude', 'settings.json');
    if (existsSync(globalSettingsPath)) {
      let globalSettingsText;
      try {
        globalSettingsText = readFileSync(globalSettingsPath, 'utf8');
      } catch {
        globalSettingsText = '';
      }
      if (globalSettingsText) {
        const globalReferenced = extractReferencedHookFiles(globalSettingsText);
        const globalGaps = findGlobalGaps(projectReferenced, globalReferenced);
        if (globalGaps.length > 0) {
          console.log(`[check-hooks-wired] ★警告(非fail-closed): プロジェクト内では配線済みだが`);
          console.log(`[check-hooks-wired] グローバル~/.claude/settings.jsonには見当たらないhook ${globalGaps.length} 件:`);
          for (const g of globalGaps) console.log(`  - ${g}`);
          console.log('[check-hooks-wired] このPC上の他プロジェクトでも効かせたい場合は手動反映すること。');
        }
      }
    }

    if (exitCode === 0) {
      console.log(`[check-hooks-wired] OK(hook ${hookFiles.length} 件・孤児 0 件)。`);
    }
    process.exit(exitCode);
  }
}

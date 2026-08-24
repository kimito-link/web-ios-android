#!/usr/bin/env node
/**
 * scripts/run-splash-gates.mjs
 *
 * スプラッシュ検査を全部まとめて走らせるランナー。CI から呼ぶのはこれ1本でよい。
 *
 * ★終了コードは「一番悪いもの」を返す（fail > inconclusive > pass）。
 *   ＝ 1件でも「測れなかった」があれば緑にしない（instrument-core の約束と同じ）。
 *
 * ■ ★見ないこと（限界）
 *   - 実機の見え方は一切判定しない。設定と素材の静的検査のみ。
 *   - ここが全部緑でも「起動時に何が見えるか」は端末で確認すること。
 *
 * 使い方:
 *   node scripts/run-splash-gates.mjs
 *   node scripts/run-splash-gates.mjs --allow-missing-dark
 *   node scripts/run-splash-gates.mjs --origin ../splash/templates/scripts
 *   node scripts/run-splash-gates.mjs --skip-drift
 *   node scripts/run-splash-gates.mjs --dry-run   # 検査を実行せず、配線の健全性だけ見る
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

const EXIT_LABEL = { 0: '✅ 合格', 1: '🔴 赤', 2: '🟡 測れず' };

// 終了コードの数値順は 0=緑 / 1=赤 / 2=黄だが、深刻度は 赤 > 黄 > 緑。
// Math.max を使うと黄(2)が赤(1)を上書きするため、明示的に集約する。
export function aggregateExit(current, next) {
  if (current === 1 || next === 1) return 1;
  if (current === 2 || next === 2) return 2;
  return 0;
}

function arg(flag) {
  return argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null;
}

if (argv.includes('--selftest')) {
  const failures = [];
  if (aggregateExit(0, 0) !== 0) failures.push('緑だけを緑にできない');
  if (aggregateExit(0, 2) !== 2) failures.push('黄を保持できない');
  if (aggregateExit(2, 1) !== 1 || aggregateExit(1, 2) !== 1) failures.push('赤より黄を優先した');
  if (failures.length) {
    console.error('[run-splash-gates] selftest 失敗: ' + failures.join(' / '));
    process.exit(1);
  }
  console.log('[run-splash-gates] selftest OK（赤 > 黄 > 緑の3値集約）');
  process.exit(0);
}

// ★--config / --dir は各検査へそのまま渡す。
//   受け取っておいて渡さないと「指定したのに既定を見ていた」という
//   気づきにくい嘘の結果になる（実装中に一度やらかした）。
const configArg = arg('--config');
const dirArg = arg('--dir');

const gates = [
  {
    name: 'splash config',
    script: 'check-splash-config.mjs',
    args: configArg ? ['--config', configArg] : [],
  },
  {
    name: 'dark variant',
    script: 'check-splash-dark-variant.mjs',
    args: [
      ...(argv.includes('--allow-missing-dark') ? ['--allow-missing'] : []),
      ...(dirArg ? ['--dir', dirArg] : []),
    ],
  },
];

if (!argv.includes('--skip-drift')) {
  const origin = arg('--origin');
  gates.push({
    name: 'template drift',
    script: 'check-splash-template-drift.mjs',
    args: origin ? ['--origin', origin] : [],
  });
}

// ★--dry-run: 検査自体は走らせず「配線が health か」だけを見る。
//   site/claims.json の level:"auto" を名乗る条件（verify-claims-coverage.mjs RULE 3）を満たすため。
//   ここで検査本体を走らせないのは、対象リポ（キット自身）に capacitor.config が無く、
//   実行すると常に🟡になってしまい「配線の健全性」と「対象の状態」を区別できなくなるため。
if (argv.includes('--dry-run')) {
  const missing = gates
    .map((g) => ({ ...g, path: join(HERE, g.script) }))
    .filter((g) => !existsSync(g.path));

  console.log('[run-splash-gates] --dry-run（検査は実行しない・配線のみ確認）');
  for (const gate of gates) {
    const present = existsSync(join(HERE, gate.script));
    console.log(`  ${present ? '✅' : '🔴'} ${gate.name} → ${gate.script}`);
  }

  if (missing.length) {
    console.error(
      `\n🔴 検査スクリプトが ${missing.length}件 見つからない: ${missing.map((m) => m.script).join(', ')}`,
    );
    process.exit(1);
  }
  console.log('\n✅ 配線OK（全検査スクリプトが実在する）');
  console.log('★--dry-run が見ないこと: 各検査の判定結果。実際の合否は --dry-run 無しで実行すること。');
  process.exit(0);
}

let worst = 0;
const summary = [];

for (const gate of gates) {
  const scriptPath = join(HERE, gate.script);
  if (!existsSync(scriptPath)) {
    console.error(`🟡 ${gate.name}: スクリプトが無い (${gate.script})`);
    summary.push([gate.name, 2]);
    worst = aggregateExit(worst, 2);
    continue;
  }

  console.log(`\n─── ${gate.name} ───`);
  const r = spawnSync(process.execPath, [scriptPath, ...gate.args], { stdio: 'inherit' });
  // ★spawn 自体が失敗した場合(status===null)は「測れなかった」に倒す。
  const code = r.status === null ? 2 : r.status;
  summary.push([gate.name, code]);
  worst = aggregateExit(worst, code);
}

console.log('\n═══ まとめ ═══');
for (const [name, code] of summary) {
  console.log(`  ${EXIT_LABEL[code] ?? `? (${code})`}  ${name}`);
}
console.log(
  '\n★この検査群が判定しないこと: 実機での見え方。全部緑でも起動画面は端末で目視すること。',
);

process.exit(worst);

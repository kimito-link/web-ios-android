#!/usr/bin/env node
// check-claude-md-budget.mjs — 指示書(CLAUDE.md)の「必読の核」が肥大化していないかを検査する。
//
// なぜ要るか: web-ios-android の CLAUDE.md は1300行を超え、hook が「現在の内容のまま全文読んだか」を要求するため、
//   1行足すたびに全セッションが大量に読み直す高コストになっていた(2026-10-18 実測)。そこで必ず読む核を
//   `<!-- core:end` マーカーまでに限り、hook の判定もそこまでにした。核が太ると同じ問題が戻るので、行数に上限を置く。
// 規則: 「規範と検査の入口」だけを核に残し、実損エピソードは site/learnings/ か _docs/ へ移す。
//
// 使い方:
//   node check-claude-md-budget.mjs [対象ディレクトリ] [上限行数]   (既定: cwd / 450)
//   node check-claude-md-budget.mjs --selftest
//   exit 0 = 上限内、または CLAUDE.md が無い／核の宣言(マーカー)が無い(対象外) / exit 1 = 核が上限超過・マーカーが2つ以上
// ★検査できるのは行数と、マーカーが1つだけかまで。核に入れる内容の良し悪しは意味判断で、人が決める。

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_CORE_MAX = 450;
const MARKER_RE = /^<!--\s*core:end\b/;

// 核の行数を測る。マーカーが無ければ declared=false(対象外)。
export function measureCore(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const idx = lines.map((l, i) => (MARKER_RE.test(l) ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return { declared: false, totalLines: lines.length, coreLines: lines.length, markers: 0 };
  return { declared: true, totalLines: lines.length, coreLines: idx[0] + 1, markers: idx.length };
}

export function judge(text, max = DEFAULT_CORE_MAX) {
  const m = measureCore(text);
  if (!m.declared) return { status: 'skip', detail: `核の宣言(<!-- core:end)が無い(全${m.totalLines}行・対象外)`, ...m };
  if (m.markers > 1) return { status: 'fail', detail: `core:end マーカーが ${m.markers} 個ある(1つだけにする)`, ...m };
  if (m.coreLines > max) {
    return { status: 'fail', detail: `核が ${m.coreLines} 行で上限 ${max} 行を超えている。実損エピソードを site/learnings/ か _docs/ へ移し、規範と検査の入口だけ残す`, ...m };
  }
  return { status: 'ok', detail: `核 ${m.coreLines} 行(上限 ${max}・全体 ${m.totalLines} 行)`, ...m };
}

function selftest() {
  const mk = (n, marker = true, extra = 0) => [...Array.from({ length: n }, (_, i) => `行${i}`), ...(marker ? ['<!-- core:end -->'] : []), ...Array.from({ length: extra }, () => '外')].join('\n');
  const cases = [
    ['上限内は ok', judge(mk(100, true, 900), 450).status === 'ok'],
    ['上限ちょうどは ok', judge(mk(449, true, 5), 450).status === 'ok'],
    ['上限超過は fail(毒)', judge(mk(500, true, 5), 450).status === 'fail'],
    ['マーカー無しは skip', judge(mk(900, false), 450).status === 'skip'],
    ['マーカー2つは fail', judge(`${mk(10)}\n${mk(10)}`, 450).status === 'fail'],
    ['核の外が増えても核の判定は変わらない', judge(mk(100, true, 5000), 450).status === 'ok'],
  ];
  let bad = 0;
  for (const [name, pass] of cases) {
    console.log(`${pass ? 'OK ' : 'NG '} ${name}`);
    if (!pass) bad++;
  }
  process.exit(bad ? 1 : 0);
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  if (process.argv.includes('--selftest')) selftest();
  const dir = resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : process.cwd());
  const max = Number(process.argv[3]) > 0 ? Number(process.argv[3]) : DEFAULT_CORE_MAX;
  const file = join(dir, 'CLAUDE.md');
  if (!existsSync(file)) {
    console.log('[check-claude-md-budget] CLAUDE.md が無い(対象外)。');
    process.exit(0);
  }
  const r = judge(readFileSync(file, 'utf8'), max);
  if (r.status === 'fail') {
    console.error(`[check-claude-md-budget] ${r.detail}`);
    process.exit(1);
  }
  console.log(`[check-claude-md-budget] ${r.status === 'skip' ? 'SKIP' : 'OK'}: ${r.detail}`);
}

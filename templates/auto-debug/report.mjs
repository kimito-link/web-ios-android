#!/usr/bin/env node
// 自動デバッグの「記録する係」。explore.mjs の findings.json と、既にある自動起票の Issue を突き合わせて、
// 新規なら起票・既にあれば回数を足して優先度を上げる・閉じたのに再発したら開け直す（差し戻し）・
// 閉じた Issue は残した手順をたどり直して出なければ「直ったのを自動確認」・14日出なければ自動で閉じる。
//
// 使い方（GitHub Actions から。GH_TOKEN と gh が要る）:
//   node templates/auto-debug/report.mjs --in auto-debug-out [--dry-run]
// ★人が見つけた「バグ」と分けるため、自動の起票はラベル「エラー報告(自動)」にする（記事: ひと目で区別して無駄な質問を防ぐ）。
// 決まり: docs/ai-rules/17_AUTO_DEBUG.md

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_DAYS_TO_CLOSE, planActions, readMark, writeMark } from './lib.mjs';

export const LABEL = 'エラー報告(自動)';
const SEV_JA = { high: '重要度:高', medium: '重要度:中', low: '重要度:低' };
const TYPE_JA = {
  'js-exception': '画面の JavaScript が落ちた',
  'server-5xx': 'サーバーが 500 番台を返した',
  'blank-screen': '開いたのに真っ白',
  stuck: '開くのに20秒以上かかって固まった',
  'broken-link': 'サイト内のリンク先が 404',
  'console-error': 'コンソールに error が出た',
  'request-failed': '通信が途中で切れた',
};

const DRY = process.argv.includes('--dry-run');
const dirArg = process.argv.indexOf('--in');
const IN = dirArg > 0 ? process.argv[dirArg + 1] : 'auto-debug-out';

function gh(args, input) {
  if (DRY && !['issue list', 'label list'].includes(args.slice(0, 2).join(' '))) {
    console.log('[dry-run] gh', args.join(' '));
    return '';
  }
  return execFileSync('gh', args, { encoding: 'utf8', input });
}

/** Issue 本文に残した再現手順（```json の塊）を読む。 */
export function readReplay(body) {
  const m = /### 再現手順[\s\S]*?```json\n([\s\S]*?)\n```/.exec(String(body ?? ''));
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

export function issueBody(f, mark) {
  const lines = [
    `夜の自動巡回（\`templates/auto-debug/explore.mjs\`）が、本番でこの異常を見つけました。人が見つけた「バグ」ではなく、自動の「エラー報告」です。`,
    '',
    `- 何が起きたか: ${TYPE_JA[f.type] ?? f.type}`,
    `- どこで: ${f.url}`,
    `- 中身: \`${String(f.message).slice(0, 300).replace(/`/g, "'")}\``,
    `- 入口: ${f.startUrl}（種 ${f.seed}・${f.step} 歩目）`,
    `- 自動再現: ${f.reproduced ? 'した（同じ手順でもう一度出た）' : 'しなかった（1回だけ。たまに起きる種類の可能性）'}`,
    '',
    'やること: この手順を手元でたどって原因を直し、PR で閉じる。閉じたあとは毎晩この手順を自動でたどり直し、出なければ「直ったのを確認」、出たら開け直します。',
    `たどり直す: \`node templates/auto-debug/explore.mjs --replay <下の JSON を保存したファイル>\`（0=出ない 1=再現）`,
    `${QUIET_DAYS_TO_CLOSE} 日続けて出なければ自動で閉じます。決まり: docs/ai-rules/17_AUTO_DEBUG.md`,
    '',
    ...(process.env.GITHUB_RUN_ID
      ? [`証拠（スクリーンショット・手順のファイル）: ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`, '']
      : []),
    '### 再現手順',
    '```json',
    JSON.stringify(f.replay ?? null),
    '```',
  ];
  return writeMark(lines.join('\n'), mark);
}

function ensureLabels() {
  const want = [
    [LABEL, 'd93f0b', '夜の自動巡回が見つけた異常（人のバグ報告とは別）'],
    ['ai-task', '5319e7', 'AI が受け持つ作業'],
    ['自動再現済み', 'b60205', '同じ手順でもう一度出た'],
    ['重要度:高', 'b60205', ''],
    ['重要度:中', 'fbca04', ''],
    ['重要度:低', 'c5def5', ''],
    ['優先度:P1', 'b60205', '同じ異常が10回以上'],
    ['優先度:P2', 'fbca04', '同じ異常が3回以上'],
    ['優先度:P3', 'c5def5', ''],
  ];
  for (const [name, color, desc] of want) gh(['label', 'create', name, '--color', color, '--description', desc, '--force']);
}

async function main() {
  const found = existsSync(join(IN, 'findings.json')) ? JSON.parse(readFileSync(join(IN, 'findings.json'), 'utf8')) : [];
  const issues = JSON.parse(
    gh(['issue', 'list', '--label', LABEL, '--state', 'all', '--limit', '300', '--json', 'number,state,body,closedAt']) || '[]',
  );

  // 開いている Issue と、閉じて間もない Issue の手順を今夜たどり直す（直ったかの自動確認・再発の検知）
  const replayed = new Map();
  const recent = Date.now() - QUIET_DAYS_TO_CLOSE * 86400000;
  const targets = issues.filter((is) => is.state === 'OPEN' || Date.parse(is.closedAt ?? 0) >= recent);
  if (targets.length) {
    const { walk, loadChromium } = await import('./explore.mjs');
    const chromium = await loadChromium();
    const browser = await chromium.launch();
    try {
      for (const is of targets) {
        const mark = readMark(is.body);
        const rp = readReplay(is.body);
        if (!mark?.sig || !rp?.startUrl || found.some((f) => f.signature === mark.sig)) continue;
        const r = await walk(browser, { startUrl: rp.startUrl, seed: rp.seed, replay: rp });
        const hit = r.findings.find((f) => f.signature === mark.sig);
        replayed.set(mark.sig, Boolean(hit));
        if (hit) found.push({ ...hit, count: 1, reproduced: true, replay: rp });
      }
    } finally {
      await browser.close();
    }
  }

  const actions = planActions({ issues, found, replayed });
  if (actions.length) ensureLabels();
  for (const a of actions) {
    const f = a.finding;
    if (a.op === 'create') {
      const labels = [LABEL, 'ai-task', SEV_JA[a.severity], `優先度:${a.priority}`, ...(f.reproduced ? ['自動再現済み'] : [])];
      const title = `[auto-debug:${a.mark.sig}] ${TYPE_JA[f.type] ?? f.type}: ${new URL(f.url).host}${new URL(f.url).pathname}`.slice(0, 200);
      gh(['issue', 'create', '--title', title, '--body-file', '-', ...labels.flatMap((l) => ['--label', l])], issueBody(f, a.mark));
      console.log(`起票: ${title}`);
      continue;
    }
    const is = issues.find((x) => x.number === a.number);
    const n = String(a.number);
    if (a.op === 'close') {
      gh(['issue', 'close', n, '--reason', 'completed', '--comment', `${a.quietDays} 日続けて出なかったので、もう再発しないものとして自動で閉じます。`]);
    } else if (a.op === 'verified') {
      gh(['issue', 'edit', n, '--body-file', '-'], writeMark(is.body, a.mark));
      gh(['issue', 'comment', n, '--body', '残した再現手順をたどり直しても出ませんでした。直ったのを自動で確認しました。']);
    } else {
      const drop = ['P1', 'P2', 'P3'].filter((p) => p !== a.priority).flatMap((p) => ['--remove-label', `優先度:${p}`]);
      gh(['issue', 'edit', n, '--body-file', '-', '--add-label', `優先度:${a.priority}`, ...drop, ...(f.reproduced ? ['--add-label', '自動再現済み'] : [])], writeMark(is.body, a.mark));
      if (a.op === 'reopen') gh(['issue', 'reopen', n, '--comment', `閉じたあとに同じ異常がまた出ました（差し戻し）。合計 ${a.mark.count} 回。`]);
      else gh(['issue', 'comment', n, '--body', `今夜も出ました（合計 ${a.mark.count} 回・${a.priority}）。${f.reproduced ? '同じ手順で再現します。' : ''}`]);
    }
    console.log(`${a.op}: #${n}`);
  }
  console.log(`異常 ${found.length} 件・処理 ${actions.length} 件`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
}

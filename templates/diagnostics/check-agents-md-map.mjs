#!/usr/bin/env node
// check-agents-md-map.mjs — AGENTS.md の「キットの地図」を、決まり・進め方・金型の実ファイルから作り、ずれていないかを検査する。
//
// なぜ要るか（2026-11-27 りんく「ほかのAIもちゃんとキットの仕組みが理解できるようにしておいてほしい」）:
//   Codex・Antigravity・OpenCode 系（hydrogen・さくら等）・dot は CLAUDE.md を読まず AGENTS.md だけを読む。
//   その AGENTS.md は手書きの橋渡しで、CLAUDE.md の核が指す決まり（01_CORE_RULES・07_GROWTH_METRICS・13_INFLUENCER_FIRST）や
//   金型（hooks-relay・extension-verify 等）が載っていなかった。新しい決まりや金型を足すたびに手で写す形だと、また漏れる。
//   ⟹ 地図は実ファイル（各ファイルの先頭の見出し）から機械で作り、古いままなら赤にする。正本は各ファイルの見出し1か所だけ。
// 規則: 地図に載せるのは「場所と一行の題」だけ（本文は写さない。Antigravity は1ファイル24KBまで・トークン節約）。
//
// 使い方:
//   node templates/diagnostics/check-agents-md-map.mjs [対象ディレクトリ]          # 検査（既定: cwd）
//   node templates/diagnostics/check-agents-md-map.mjs [対象ディレクトリ] --write  # 地図を書き直す
//   node templates/diagnostics/check-agents-md-map.mjs --selftest
//   exit 0 = 地図が最新、または対象外（AGENTS.md も docs/ai-rules/ も無い） / exit 1 = 地図が古い・無い・AGENTS.md が24KB超
// ★検査できるのは「載っているか・題が今の見出しと同じか・大きさ」まで。題の分かりやすさは各ファイルの見出しを直す。

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

export const BEGIN = '<!-- agents-map:begin';
export const END = '<!-- agents-map:end -->';
export const MAX_BYTES = 24 * 1024; // Antigravity のルールファイル上限（AGENTS.md 先頭コメント・ANTIGRAVITY-HOWTO.md）
const TITLE_MAX = 60;
const LABEL_ONLY = /^(?:[\s（）()・]|正本|コピペ用|まとめ|HOWTO|PoC)+$/;

const SECTIONS = [
  { title: '決まり（`docs/ai-rules/`・番号順）', list: (root) => files(join(root, 'docs/ai-rules'), /^\d\d_.+\.md$/).map((f) => `docs/ai-rules/${f}`) },
  { title: '進め方（`docs/ai-workflows/`）', list: (root) => files(join(root, 'docs/ai-workflows'), /^(?!README).+\.md$/).map((f) => `docs/ai-workflows/${f}`) },
  { title: '金型・検査（`templates/`・各 README）', list: (root) => dirs(join(root, 'templates')).filter((d) => existsSync(join(root, 'templates', d, 'README.md'))).map((d) => `templates/${d}/README.md`) },
];

function files(dir, re) {
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && re.test(e.name)).map((e) => e.name).sort() : [];
}
function dirs(dir) {
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort() : [];
}

// 先頭の「# 見出し」から題を取る。「名前 — 説明」なら説明だけ。長ければ切る。
export function titleOf(text) {
  const h = String(text ?? '').replace(/\r\n/g, '\n').split('\n').find((l) => /^#\s+\S/.test(l));
  if (!h) return '';
  let t = h.replace(/^#\s+/, '').trim();
  const dash = t.indexOf(' — ');
  // 「— 正本」「— コピペ用まとめ（正本）」のように後ろが札だけなら、前の名前の方が中身を表す。
  if (dash >= 0 && !LABEL_ONLY.test(t.slice(dash + 3).trim())) t = t.slice(dash + 3).trim();
  else if (dash >= 0) t = t.slice(0, dash).trim();
  const cps = [...t];
  return cps.length > TITLE_MAX ? `${cps.slice(0, TITLE_MAX).join('')}…` : t;
}

export function buildMap(root) {
  const out = [`${BEGIN}（自動生成。手で書き換えない。足したら: node templates/diagnostics/check-agents-md-map.mjs . --write） -->`,
    '## キットの地図（どこに何があるか・自動生成）', '',
    '決まりの本文はリンク先にある。仕事に関係する行だけ開いて読む（全部は読まない）。', ''];
  for (const s of SECTIONS) {
    const paths = s.list(root);
    if (!paths.length) continue;
    out.push(`### ${s.title}`, '');
    for (const p of paths) {
      const t = titleOf(readFileSync(join(root, p), 'utf8'));
      out.push(`- [\`${p}\`](${p})${t ? ` — ${t}` : ''}`);
    }
    out.push('');
  }
  out.push(END);
  return out.join('\n');
}

// AGENTS.md の地図部分を差し替えた全文を返す。マーカーが無ければ末尾に足す。
export function withMap(agents, map) {
  const text = String(agents ?? '').replace(/\r\n/g, '\n');
  const b = text.indexOf(BEGIN);
  const e = text.indexOf(END);
  if (b >= 0 && e > b) return text.slice(0, b) + map + text.slice(e + END.length);
  return `${text.replace(/\n*$/, '')}\n\n${map}\n`;
}

export function judge(root) {
  const file = join(root, 'AGENTS.md');
  const hasRules = existsSync(join(root, 'docs/ai-rules'));
  if (!existsSync(file)) return hasRules ? { status: 'fail', detail: 'docs/ai-rules/ があるのに AGENTS.md が無い（Codex・Antigravity 等に決まりが届かない）。--write で作る' } : { status: 'skip', detail: 'AGENTS.md も docs/ai-rules/ も無い（対象外）' };
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (!text.includes(BEGIN)) return hasRules ? { status: 'fail', detail: 'AGENTS.md に「キットの地図」が無い。--write で足す' } : { status: 'skip', detail: '地図の宣言が無い（対象外）' };
  const want = withMap(text, buildMap(root));
  if (want !== text) return { status: 'fail', detail: '地図が古い（決まり・進め方・金型が増えた／見出しが変わった）。node templates/diagnostics/check-agents-md-map.mjs . --write' };
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_BYTES) return { status: 'fail', detail: `AGENTS.md が ${bytes} バイトで上限 ${MAX_BYTES} を超えた（Antigravity が読み切れない）。本文を正本へ移し、入口だけ残す` };
  return { status: 'ok', detail: `地図は最新（AGENTS.md ${bytes} バイト／上限 ${MAX_BYTES}）` };
}

function selftest() {
  const root = mkdtempSync(join(tmpdir(), 'agents-map-'));
  const put = (p, t) => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), t); };
  const cases = [];
  try {
    cases.push(['何も無いリポは skip', judge(root).status === 'skip']);
    put('docs/ai-rules/01_A.md', '# 01_A — 一つめの決まり\n本文');
    cases.push(['決まりがあるのに AGENTS.md が無いのは fail', judge(root).status === 'fail']);
    put('AGENTS.md', '# AGENTS\n手書きの部分\n');
    cases.push(['地図が無いのは fail', judge(root).status === 'fail']);
    writeFileSync(join(root, 'AGENTS.md'), withMap(readFileSync(join(root, 'AGENTS.md'), 'utf8'), buildMap(root)));
    cases.push(['書いた直後は ok', judge(root).status === 'ok']);
    cases.push(['手書きの部分は残る', readFileSync(join(root, 'AGENTS.md'), 'utf8').includes('手書きの部分')]);
    cases.push(['題は「—」の後ろだけ', readFileSync(join(root, 'AGENTS.md'), 'utf8').includes('— 一つめの決まり')]);
    put('templates/x/README.md', '# x — 新しい金型');
    cases.push(['金型が増えたら fail(毒)', judge(root).status === 'fail']);
    writeFileSync(join(root, 'AGENTS.md'), withMap(readFileSync(join(root, 'AGENTS.md'), 'utf8'), buildMap(root)));
    cases.push(['書き直すと ok・二重にならない', judge(root).status === 'ok' && readFileSync(join(root, 'AGENTS.md'), 'utf8').split(BEGIN).length === 2]);
    put('docs/ai-rules/01_A.md', '# 01_A — 題を変えた');
    cases.push(['見出しが変わったら fail(毒)', judge(root).status === 'fail']);
    writeFileSync(join(root, 'AGENTS.md'), withMap(readFileSync(join(root, 'AGENTS.md'), 'utf8'), buildMap(root)) + 'あ'.repeat(9000));
    cases.push(['24KB を超えたら fail(毒)', judge(root).status === 'fail']);
    cases.push(['後ろが札だけなら前の名前', titleOf('# 会議ハーネス — コピペ用まとめ（正本）') === '会議ハーネス']);
    cases.push(['長い題は切る', [...titleOf(`# a — ${'長'.repeat(100)}`)].length === TITLE_MAX + 1]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const root = resolve(arg || process.cwd());
  if (process.argv.includes('--write')) {
    const file = join(root, 'AGENTS.md');
    writeFileSync(file, withMap(existsSync(file) ? readFileSync(file, 'utf8') : '# AGENTS.md\n\nルールの正本は CLAUDE.md。\n', buildMap(root)));
    console.log('[check-agents-md-map] AGENTS.md の地図を書き直した。');
  }
  const r = judge(root);
  if (r.status === 'fail') {
    console.error(`[check-agents-md-map] ${r.detail}`);
    process.exit(1);
  }
  console.log(`[check-agents-md-map] ${r.status === 'skip' ? 'SKIP' : 'OK'}: ${r.detail}`);
}

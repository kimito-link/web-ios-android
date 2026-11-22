#!/usr/bin/env node
/**
 * check-docs-no-human-steps.mjs — ★ルール・手順書の中に「人がやる手順」が理由なしで書かれていないか。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか(2026-11-22・りんく「全体の設計として、コマンドの実行をさせるのではなくて、人間の手がかかるのでやって欲しい」)
 *   08_NO_HUMAN_HANDS は「人に頼む瞬間」(チャットの返事・人に渡すスクリプト)を hook と検査で止めていた。
 *   ところが手順書・ルールの本文そのものに「本人が手で投げる」「本人が貼る」が残り、後から読んだ AI がその手順どおり
 *   人に頼んでいた(例: CLAUDE.md の Antigravity の行は、11/18 に AI が Remote Control で回せるようになった後も「本人が手で投げる」のままだった)。
 *   ⟹ 手順の主語は AI。残る人の手(鍵の発行・課金・OK の一言)は、同じ行に `人の手: <理由>` を書いて残す(正本 08 §2.5)。
 *
 * ■ 何を見るか(git 追跡中の CLAUDE.md / AGENTS.md / docs 配下の .md)
 *   「本人・りんく・人間・人 が …(実行する/貼る/押す/走らせる/コピーする/ダブルクリック/手で投げる)」と
 *   「本人・りんく・人 に …(実行/貼/押/入力/コピー) …(してもらう/させる/頼む)」の形の行。
 *   同じ行に `人の手:` (理由つき)があれば外す。コードブロックの中・引用(>)の行・`インラインコード` の中(悪い例の引用)は数えない。
 *
 * ■ ★この検査が判定しないこと
 *   言い回しを変えた人の手順(「Enter はお願いします」等)・その人の手が本当に要るか(意味判断)。
 *   過去の経緯を書いた行も拾うので、その行は書き換えるか `人の手:` で理由を残す。
 *
 * 終了コード: 0 = 合格 / 1 = ★赤 / 2 = 測れなかった(git でない等)
 * 使い方:
 *   node check-docs-no-human-steps.mjs [対象ディレクトリ]
 *   node check-docs-no-human-steps.mjs --selftest
 * ───────────────────────────────────────────────────────────────────────────
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TARGET = /^(CLAUDE\.md|AGENTS\.md|docs\/.+\.md)$/;
const SKIP_DIR = /(^|\/)(node_modules|dist|build|vendor|fixtures|test-fixtures)\//;
const OPT_OUT = /人の手[:：]\s*\S/;
const HUMAN_STEP = [
  /(本人|りんく|人間|人)が(手で|自分で)?[^。、\n]{0,12}(実行する|実行して|貼る|貼って|貼り付け|押す|押して|走らせ|コピーして|ダブルクリック|手で投げる)/,
  /(本人|りんく|人間|人)に[^。\n]{0,20}(実行|貼|押|入力|コピー)[^。\n]{0,4}(もらう|もらい|させる|させて|頼む)/,
];

/** 1ファイルを判定する(純ロジック)。@returns {{line:number, text:string}[]} */
export function inspectDoc(text) {
  const out = [];
  let fence = false;
  text.split(/\r?\n/).forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; }
    if (fence || /^\s*>/.test(l) || OPT_OUT.test(l)) return;
    const plain = l.replace(/`[^`]*`/g, '');
    const m = HUMAN_STEP.map((re) => plain.match(re)).find(Boolean);
    if (m) out.push({ line: i + 1, text: m[0] });
  });
  return out;
}

export function inspect(dir, files) {
  const out = [];
  for (const f of files) {
    if (SKIP_DIR.test(f) || !TARGET.test(f)) continue;
    let text;
    try { text = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
    for (const h of inspectDoc(text)) out.push(`${f}:${h.line}: 「${h.text}」`);
  }
  return out;
}

function main(dir) {
  let files;
  try { files = execFileSync('git', ['ls-files', '-z'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean); } catch {
    console.log('skip: git リポジトリではない'); return 2;
  }
  const n = files.filter((f) => TARGET.test(f) && !SKIP_DIR.test(f)).length;
  const bad = inspect(dir, files);
  if (!bad.length) { console.log(`pass: ルール・手順書 ${n} 本に、理由なしの「人がやる手順」は無い`); return 0; }
  console.log(`FAIL: ルール・手順書に人がやる手順が残っている(${bad.length}件・正本 docs/ai-rules/08_NO_HUMAN_HANDS.md §2.5)`);
  console.log('  → 主語を AI に書き換える(PC のコマンドは Remote Control、画面は内蔵ブラウザ)。本当に人しかできないなら同じ行に「人の手: <理由>」を書く');
  for (const b of bad) console.log('  - ' + b);
  return 1;
}

function selftest() {
  let fails = 0;
  const check = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fails++; };
  check('★「本人が手で投げる」を赤にする', inspectDoc('Antigravity は本人に提案する（本人が手で投げる）。').length === 1);
  check('★「りんくが PowerShell で実行する」を赤にする', inspectDoc('最後に りんくがPowerShellで実行する。').length === 1);
  check('★「本人に貼って実行してもらう」を赤にする', inspectDoc('コマンドは本人に貼って実行してもらう。').length === 1);
  check('「人の手: 理由」があれば外す', inspectDoc('鍵の発行は本人が押す（人の手: 鍵の発行は本人しかできない）').length === 0);
  check('理由の無い「人の手:」では外さない', inspectDoc('本人が押す 人の手:').length === 1);
  check('コードブロックの中は数えない', inspectDoc('```\n本人が貼って実行する\n```\n').length === 0);
  check('インラインコード(悪い例の引用)は数えない', inspectDoc('`本人が貼る` と書かない').length === 0);
  check('引用の行は数えない', inspectDoc('> 本人が貼る、と前は書いていた').length === 0);
  check('AI が主語の手順は通す', inspectDoc('AI が Remote Control で PC の npm を実行する。').length === 0);
  check('行番号を返す', inspectDoc('a\nb\n本人が押す\n')[0]?.line === 3);
  const r = inspect('/nonexistent', ['src/x.md', 'node_modules/docs/a.md']);
  check('対象外のパスは見ない', r.length === 0);
  console.log(fails ? `\n自己検査: ★${fails}件失敗` : '\n自己検査: 全部合格');
  return fails ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  process.exit(args.includes('--selftest') ? selftest() : main(resolve(args.find((a) => !a.startsWith('--')) || process.cwd())));
}

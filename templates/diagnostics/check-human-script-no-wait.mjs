#!/usr/bin/env node
/**
 * check-human-script-no-wait.mjs — ★人に渡すスクリプト(.cmd/.bat/.ps1)が Enter 待ちで止まらないか・.cmd が英数字だけか。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか(2026-10-28・りんく「全体設計として人間の手は使わない設計で」)
 *   黒い画面が「Enter を押して」で止まり、AI からは中身が見えず、人に「いちばん下の行を送って」
 *   「Enter を2回押して」と頼んでいた。同じ日、日本語を含む .cmd がコードページ切り替え直後に
 *   誤読され、ダブルクリックで即閉じた。正本: docs/ai-rules/08_NO_HUMAN_HANDS.md §4。
 *   ⟹ 客観的に検出できる2点だけを機械にする(CLAUDE.md「新しいルールを書いたら機械検査化を検討する」手順1)。
 *
 * ■ 何を見るか(git 追跡中の .cmd / .bat / .ps1)
 *   1. 入力待ち: pause / set /p / choice(.cmd/.bat)、Read-Host / [Console]::ReadKey / $Host.UI.ReadLine(.ps1)
 *   2. .cmd/.bat に ASCII 以外の文字がある(日本語の案内は中身の .mjs/.ps1 に出させる)
 *   ★意図して人の入力を待つもの(本人の OK の確認・パスワードの手入力など)は、ファイルのどこかに
 *     `human-wait-ok: <理由>` と書けば1の対象から外れる(理由が記録に残る＝後から検査できる)。
 *
 * ■ ★この検査が判定しないこと
 *   状態ファイルを書いているか・途中から再開できるか(書き方が多様で事実として拾えない。
 *   templates/hands-free-runner/ を使えば満たせる)。そもそも人に渡さずに済まなかったか(意味判断)。
 *
 * 終了コード: 0 = 合格(対象ファイルが無いリポも 0) / 1 = ★赤 / 2 = 測れなかった(git でない等)
 *
 * 使い方:
 *   node check-human-script-no-wait.mjs [対象ディレクトリ]
 *   node check-human-script-no-wait.mjs --selftest   ← ★自分自身を毒で試す
 * ───────────────────────────────────────────────────────────────────────────
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SKIP_DIR = /(^|\/)(node_modules|dist|build|vendor|fixtures|test-fixtures)\//;
const OPT_OUT = /human-wait-ok:\s*\S/;
const WAIT_CMD = [/^\s*@?pause\b/im, /^\s*@?set\s+\/p\b/im, /^\s*@?choice\b/im];
const WAIT_PS1 = [/\bRead-Host\b/i, /\[Console\]::ReadKey\b/i, /\$Host\.UI\.(ReadLine|RawUI\.ReadKey)\b/i];

/** 1ファイルを判定する(純ロジック)。@returns {string[]} 見つかった問題 */
export function inspectScript(path, text) {
  const p = path.replace(/\\/g, '/');
  const isCmd = /\.(cmd|bat)$/i.test(p);
  const isPs1 = /\.ps1$/i.test(p);
  if (!isCmd && !isPs1) return [];
  const problems = [];
  // コメント行は数えない(「pause を使わない」と説明している行で赤にしないため)
  const body = text.split(/\r?\n/).filter((l) => !(isCmd ? /^\s*(@?rem\b|::)/i : /^\s*#/).test(l)).join('\n');
  if (!OPT_OUT.test(text)) {
    for (const re of isCmd ? WAIT_CMD : WAIT_PS1) {
      const m = body.match(re);
      if (m) problems.push(`入力待ち(${m[0].trim()})がある。待つのは出来事(クリップボード・ファイル)にする。意図的なら human-wait-ok: <理由> を書く`);
    }
  }
  if (isCmd && /[^\x00-\x7F]/.test(text.replace(/^﻿/, ''))) {
    problems.push('.cmd/.bat に英数字以外の文字がある(chcp 直後に誤読して即閉じる)。日本語の案内は中身のスクリプトに出させる');
  }
  return problems;
}

export function inspect(dir, files) {
  const out = [];
  for (const f of files) {
    if (SKIP_DIR.test(f) || !/\.(cmd|bat|ps1)$/i.test(f)) continue;
    let text;
    try { text = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
    for (const p of inspectScript(f, text)) out.push(`${f}: ${p}`);
  }
  return out;
}

function main(dir) {
  let files;
  try { files = execFileSync('git', ['ls-files', '-z'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean); } catch {
    console.log('skip: git リポジトリではない'); return 2;
  }
  const n = files.filter((f) => /\.(cmd|bat|ps1)$/i.test(f) && !SKIP_DIR.test(f)).length;
  const bad = inspect(dir, files);
  if (!bad.length) { console.log(`pass: 人に渡すスクリプト ${n} 本に Enter 待ち・日本語入りの .cmd は無い`); return 0; }
  console.log(`FAIL: 人の手で止まるスクリプトがある(${bad.length}件・正本 docs/ai-rules/08_NO_HUMAN_HANDS.md §4)`);
  for (const b of bad) console.log('  - ' + b);
  return 1;
}

function selftest() {
  let fails = 0;
  const check = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fails++; };
  check('★pause のある .cmd を赤にする', inspectScript('a.cmd', '@echo off\nnode x.mjs\npause\n').length === 1);
  check('★set /p を赤にする', inspectScript('a.bat', 'set /p X=Enter: \n').length === 1);
  check('★Read-Host を赤にする', inspectScript('a.ps1', '$x = Read-Host "Enter"\n').length === 1);
  check('★日本語入りの .cmd を赤にする', inspectScript('a.cmd', '@echo off\necho 鍵を入れます\n').some((p) => p.includes('英数字以外')));
  check('英数字だけ・待ちなしの .cmd は合格', inspectScript('a.cmd', '@echo off\r\nchcp 65001 >nul\r\nnode "%~dp0x.mjs"\r\n').length === 0);
  check('コメント内の pause は数えない', inspectScript('a.cmd', '@echo off\nrem no pause here\n:: pause is banned\nnode x.mjs\n').length === 0);
  check('ps1 のコメント内の Read-Host は数えない', inspectScript('a.ps1', '# Read-Host を使わない\nWrite-Host ok\n').length === 0);
  check('human-wait-ok で意図的な待ちを外せる', inspectScript('a.ps1', '# human-wait-ok: 審査提出の最終確認は本人の yes が要る\n$a = Read-Host "yes?"\n').length === 0);
  check('human-wait-ok があっても .cmd の日本語は赤', inspectScript('a.cmd', 'rem human-wait-ok: x\npause\necho 日本語\n').length === 1);
  check('ps1 の日本語は許す(案内を出す側)', inspectScript('a.ps1', 'Write-Host "コピーしてください"\n').length === 0);
  const d = mkdtempSync(join(tmpdir(), 'human-wait-selftest-'));
  for (const [p, c] of Object.entries({ 'ok.cmd': '@echo off\nnode x.mjs\n', 'node_modules/x/bad.cmd': 'pause\n', 'bad.ps1': 'Read-Host x\n' })) {
    mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c);
  }
  const r = inspect(d, ['ok.cmd', 'node_modules/x/bad.cmd', 'bad.ps1']);
  check('node_modules は見ず、追跡中の bad.ps1 だけを赤にする', r.length === 1 && r[0].startsWith('bad.ps1'));
  rmSync(d, { recursive: true, force: true });
  console.log(fails ? `\n自己検査: ★${fails}件失敗` : '\n自己検査: 全部合格');
  return fails ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  process.exit(args.includes('--selftest') ? selftest() : main(resolve(args.find((a) => !a.startsWith('--')) || process.cwd())));
}

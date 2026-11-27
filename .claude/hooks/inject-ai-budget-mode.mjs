#!/usr/bin/env node
// UserPromptSubmit hook。非ブロッキング（常に exit 0・fail-open）。
//
// 役割: Claude の残り枠（usage-data ブランチの usage.json）から「いまの節約の段階」を決め、
//   仕事の振り分け先（Codex・無料API・dot・ローカル）を数行でセッションに渡す。
// なぜ要るか（2026-11-25 りんく「かなり減ってきたので、無料のものとかをバランスを使って、全体設定で」）:
//   振り分けの目安は MULTI-BRAIN-HOWTO §1e に書いてあったが、AI が自分で使用量を見に行かないと効かなかった。
//   11/25 は週75%・Fable 98% なのに、どのセッションも知らずに Claude の枠で手を動かしていた。
// トークン節約: 段階（とその元の数字の段）が変わったときだけ出す。同じ段階のあいだは何も足さない。
// クラウド（CLAUDE_CODE_REMOTE=true）では dispatch の頭脳が無いので、行き先を会社PC・dot に言い換える（2026-11-27）。
// クラウドへの配線は templates/cloud-env/setup.sh（環境の setup script がこれを取って走らせる）。
// 判定の中身は site/hub/usage/budget-mode.mjs（純関数・テスト付き）。正本 MULTI-BRAIN-HOWTO §1g。
//
// 標準入力(JSON): session_id, prompt, cwd
// 環境変数: AI_BUDGET_USAGE_FILE（テスト用。指定するとネットワークに出ずこのファイルを読む）

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { budgetMode, budgetNotice } from '../../site/hub/usage/budget-mode.mjs';

export const USAGE_URL = 'https://raw.githubusercontent.com/kimito-link/web-ios-android/usage-data/usage.json';
const CACHE_MS = 30 * 60 * 1000; // 記録は4時間ごとなので、30分は読み直さない
const DIR = join(tmpdir(), 'ai-budget-mode');

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

async function loadUsage(now) {
  if (process.env.AI_BUDGET_USAGE_FILE) return readJson(process.env.AI_BUDGET_USAGE_FILE);
  const cacheFile = join(DIR, 'usage.json');
  const cached = readJson(cacheFile);
  if (cached && now - (cached.fetchedAt || 0) < CACHE_MS) return cached.usage;
  try {
    const res = await fetch(USAGE_URL, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(String(res.status));
    const usage = await res.json();
    mkdirSync(DIR, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify({ fetchedAt: now, usage }));
    return usage;
  } catch {
    return cached ? cached.usage : undefined; // 取れないときは前回の記録。何も無ければ黙る(undefined)
  }
}

/** 同じ段階を同じセッションに二度出さないための印。 */
export function signatureOf(m) {
  return [m.stale ? 'stale' : 'fresh', m.level, m.fable].join('|');
}

export async function run(input, now = Date.now()) {
  const usage = await loadUsage(now);
  if (usage === undefined) return ''; // ネットワークも記録も無い: 何も言わない(fail-open)
  const mode = budgetMode(usage, now);
  const text = budgetNotice(mode, { cloud: process.env.CLAUDE_CODE_REMOTE === 'true' });
  const sid = String(input?.session_id || 'unknown').replace(/[^\w.-]/g, '_');
  const stateFile = join(DIR, `session-${sid}.txt`);
  const sig = signatureOf(mode);
  let last = null;
  try {
    last = existsSync(stateFile) ? readFileSync(stateFile, 'utf8') : null;
  } catch {}
  if (last === sig) return '';
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(stateFile, sig);
  } catch {}
  return text;
}

async function main() {
  let input = {};
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {}
  const text = await run(input);
  if (text) {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } }),
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(() => {}).finally(() => process.exit(0));
}

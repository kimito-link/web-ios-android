#!/usr/bin/env node
/**
 * check-hub-page-freshness.mjs
 *
 * site/hub/hub-data.json の生成時刻(generatedAt)が14日を超えていたら警告する鮮度計器。
 * 「URLはあるが中身が化石」という第二の忘却を殺す(設計 D-2)。
 *
 * 3値exit規約(instrument-core.mjs): 0=pass / 1=fail(14日超) / 2=inconclusive(測れない)
 *
 * Usage:
 *   node scripts/check-hub-page-freshness.mjs
 *   node scripts/check-hub-page-freshness.mjs --root . --data site/hub/hub-data.json
 *   node scripts/check-hub-page-freshness.mjs --max-days 14
 *   node scripts/check-hub-page-freshness.mjs --selftest
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

function option(name, fallback = null) {
  const at = argv.lastIndexOf(name);
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : fallback;
}
function has(name) { return argv.includes(name); }

const DEFAULT_MAX_DAYS = 14;

function daysSince(iso, nowMs) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (nowMs - t) / 864e5;
}

/**
 * @param {string} dataPath hub-data.json への絶対パス
 * @param {number} maxDays 何日超で赤にするか
 * @param {number} nowMs 現在時刻(テスト用に注入可能)
 */
function probe(dataPath, maxDays, nowMs) {
  if (!existsSync(dataPath)) {
    return {
      probe: 'hub-data.jsonの鮮度',
      verdict: 'inconclusive',
      evidence: null,
      detail: `${dataPath} が見つかりません（未生成）`,
      howToFix: 'npm run hub:page を実行して生成してください',
      limitation: 'このファイルが無い状態は「古い」ではなく「未生成」として区別しています',
    };
  }
  let data;
  try {
    data = JSON.parse(readFileSync(dataPath, 'utf8'));
  } catch (e) {
    return {
      probe: 'hub-data.jsonの鮮度',
      verdict: 'inconclusive',
      evidence: null,
      detail: `JSONの読み込みに失敗: ${e.message}`,
      howToFix: 'npm run hub:page で再生成してください',
      limitation: '壊れたJSONの中身までは判定していません',
    };
  }
  const days = daysSince(data.generatedAt, nowMs);
  if (days === null) {
    return {
      probe: 'hub-data.jsonの鮮度',
      verdict: 'inconclusive',
      evidence: null,
      detail: `generatedAt が読めません: ${JSON.stringify(data.generatedAt)}`,
      howToFix: 'npm run hub:page で再生成してください',
      limitation: 'generatedAtフィールドの形式異常のみを検知します',
    };
  }
  if (days > maxDays) {
    return {
      probe: 'hub-data.jsonの鮮度',
      verdict: 'fail',
      evidence: { days: Math.floor(days), maxDays },
      detail: `生成から${Math.floor(days)}日経過（上限${maxDays}日）`,
      howToFix: 'npm run hub:page で再生成してください（ai-hub/index.jsonの最新状態を反映）',
      limitation: 'ページ内容の正確さ自体は判定しません。生成時刻の古さだけを見ます',
    };
  }
  return {
    probe: 'hub-data.jsonの鮮度',
    verdict: 'pass',
    evidence: { days: Math.floor(days), maxDays },
  };
}

function main() {
  if (has('--selftest')) {
    process.exit(runSelftestSuite());
  }

  const root = resolve(option('--root', '.'));
  const dataPath = resolve(root, option('--data', 'site/hub/hub-data.json'));
  const maxDays = Number(option('--max-days', String(DEFAULT_MAX_DAYS)));

  const result = probe(dataPath, maxDays, Date.now());
  console.log(formatProbeReport([result], { label: 'hub-freshness' }));
  process.exit(computeExitCode([result]));
}

function runSelftestSuite() {
  const tmpDir = join(HERE, '__hub_freshness_selftest__');
  const tmpData = join(tmpDir, 'hub-data.json');
  mkdirSync(tmpDir, { recursive: true });

  const write = (obj) => writeFileSync(tmpData, JSON.stringify(obj), 'utf8');
  const cleanup = () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} };

  const nowMs = Date.parse('2026-08-26T00:00:00Z');
  const cases = [
    {
      name: '毒1: 15日前生成(上限14日超) → fail',
      poison: () => write({ generatedAt: '2026-08-11T00:00:00Z' }),
      restore: () => {},
      isRed: () => computeExitCode([probe(tmpData, 14, nowMs)]) === EXIT.FAIL,
    },
    {
      name: '毒2: ファイル自体が存在しない → inconclusive(赤ではないが緑でもない)',
      poison: () => { try { rmSync(tmpData, { force: true }); } catch {} },
      restore: () => {},
      isRed: () => computeExitCode([probe(tmpData, 14, nowMs)]) === EXIT.INCONCLUSIVE,
    },
    {
      name: '毒3: generatedAtが壊れた文字列 → inconclusive',
      poison: () => write({ generatedAt: 'not-a-date' }),
      restore: () => {},
      isRed: () => computeExitCode([probe(tmpData, 14, nowMs)]) === EXIT.INCONCLUSIVE,
    },
  ];

  const { ok, fails } = runSelfTest(cases);

  // 対照ケース: 正常な状態(1日前生成)ではpassになること。
  // runSelfTestのisRedは「毒が効いて赤になったか」専用の意味論なのでここでは使わず、
  // 別に素朴なアサーションとして確認する（毒がpassを壊していないことの確認）。
  write({ generatedAt: '2026-08-25T00:00:00Z' });
  const contrastOk = computeExitCode([probe(tmpData, 14, nowMs)]) === EXIT.PASS;

  cleanup();

  const allFails = [...fails];
  if (!contrastOk) allFails.push('対照: 1日前生成(上限14日以内)なのにpassにならなかった');

  if (allFails.length) {
    console.error('[check-hub-page-freshness] --selftest FAIL');
    for (const f of allFails) console.error(`  - ${f}`);
    return 1;
  }
  console.log('[check-hub-page-freshness] --selftest OK');
  return 0;
}

main();

#!/usr/bin/env node
// Android アップロード鍵（.jks）の有効期限監視。
// apple-cert-expiry-check.mjs の Android 版（ASC APIは不要・keytoolでローカル完結）。
//
// 背景（2026-08-25の計器抜け漏れ調査で確定）:
//   apple-cert-expiry.yml はiOS証明書の期限切れを30日前に検知しIssueを起票するが、
//   Android側には keystore の「使用」（署名時の読み込み）チェックはあっても
//   「期限」チェックが存在しなかった。upload鍵は数十年有効な場合が多いが、
//   組織発行のkeystoreは短い有効期限のことがあり、無音で失効すると
//   bundleRelease が予告なく失敗する。
//
// 車輪の再発明をしない: 証明書の期限抽出はJDK同梱の公式ツールkeytoolに任せ、
//   自前でX.509パーサを書かない。
//
// 使い方:
//   node scripts/android-cert-expiry-check.mjs --keystore path/to/upload-key.jks --store-password xxx [--alias upload]
//   （環境変数 ANDROID_KEYSTORE_PATH / ANDROID_KEYSTORE_STORE_PASSWORD / ANDROID_KEYSTORE_ALIAS でも指定可）
//   node scripts/android-cert-expiry-check.mjs --selftest   毒→赤を確認
//
// 出力: apple-cert-expiry-check.mjs と同じ report JSON を stdout に出す
//   { warnings: [{ kind, name, id, expirationDate, daysRemaining }], warningDays, timestamp }
// これを .github/workflows/android-cert-expiry.yml がそのまま github-script へ渡す。
//
// 終了コード: keytool呼び出しが失敗したら非ゼロ（測れなかった＝CIを止める。
//   「鍵を読めないのに緑」を避けるfail-closed）。期限内でも呼び出し自体が成功すれば0。
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function arg(name, envName, def) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (envName && process.env[envName]) return process.env[envName];
  return def;
}

/**
 * ★keytoolの `-list -v` 出力から有効期限行を抽出する（純関数・childProcessに触れない）。
 *   例: "Valid from: Mon Jan 01 00:00:00 JST 2024 until: Thu Jan 01 00:00:00 JST 2054"
 *
 * ★JS の Date は "JST"（keytool/Javaのロケール依存タイムゾーン省略形）を解釈できず
 *   Invalid Date になる（実測で確認: "GMT"は通るが"JST"は通らない）。CI実行環境の
 *   ロケールに依存させず、曜日・月名・日・時刻・年だけを自前で拾って UTC 起点で
 *   組み立てる（タイムゾーン名は「日単位の期限判定」には効かないため捨てて安全）。
 * @param {string} keytoolOutput
 * @returns {{ expirationDate: string, alias: string } | null}
 */
export function parseExpiry(keytoolOutput) {
  const aliasMatch = String(keytoolOutput).match(/Alias name:\s*(\S+)/);
  const validMatch = String(keytoolOutput).match(
    /until:\s*\w+\s+(\w+)\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+\S+\s+(\d{4})/m
  );
  if (!validMatch) return null;
  const [, monthName, day, hh, mm, ss, year] = validMatch;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = MONTHS.indexOf(monthName);
  if (month < 0) return null;
  const expirationDate = new Date(Date.UTC(Number(year), month, Number(day), Number(hh), Number(mm), Number(ss)));
  if (Number.isNaN(expirationDate.getTime())) return null;
  return { expirationDate: expirationDate.toISOString(), alias: aliasMatch ? aliasMatch[1] : 'unknown' };
}

/**
 * ★期限情報から warning レポートを組み立てる（純関数・日付計算のみ）。
 * @param {{ expirationDate: string, alias: string }} parsed
 * @param {number} warningDays
 * @param {Date} now
 * @returns {object}
 */
export function buildReport(parsed, warningDays, now) {
  const expiry = new Date(parsed.expirationDate);
  const daysRemaining = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const warnings = daysRemaining <= warningDays
    ? [{
        kind: 'android-keystore',
        name: parsed.alias,
        id: parsed.alias,
        expirationDate: parsed.expirationDate,
        daysRemaining
      }]
    : [];
  return { warnings, warningDays, timestamp: now.toISOString() };
}

function selftest() {
  const fails = [];

  // 毒1: 期限が近い(warningDays以内) → warningsに1件入る
  const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const r1 = buildReport({ expirationDate: soon, alias: 'upload' }, 30, new Date());
  if (r1.warnings.length !== 1) fails.push('★期限が近いのにwarningsが空(検知が効いていない)');

  // 毒なし: 期限が遠い → warningsは空(誤検知しない)
  const far = new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000).toISOString();
  const r2 = buildReport({ expirationDate: far, alias: 'upload' }, 30, new Date());
  if (r2.warnings.length !== 0) fails.push('★期限が遠いのに誤検知した');

  // keytool出力のパース(実際のフォーマットに近い最小例)
  const sample = [
    'Alias name: upload',
    'Creation date: Jan 1, 2024',
    'Entry type: PrivateKeyEntry',
    'Owner: CN=Example',
    'Issuer: CN=Example',
    'Valid from: Mon Jan 01 00:00:00 JST 2024 until: Wed Jan 01 00:00:00 JST 2054'
  ].join('\n');
  const parsed = parseExpiry(sample);
  if (!parsed || parsed.alias !== 'upload') fails.push('★keytool出力のalias抽出に失敗');
  if (!parsed || !parsed.expirationDate.startsWith('2053') && !parsed.expirationDate.startsWith('2054')) {
    fails.push('★keytool出力の期限日抽出に失敗: ' + JSON.stringify(parsed));
  }

  // 壊れた出力 → null(測れなかったことが分かる)
  if (parseExpiry('not a keytool output') !== null) fails.push('★壊れた出力をnullにできていない');

  if (fails.length) {
    console.error('🔴 selftest 失敗:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('✅ selftest 合格（期限接近検知・誤検知なし・keytool出力パース・壊れた入力の判別を確認）');
  process.exit(0);
}

if (process.argv.includes('--selftest')) {
  selftest();
}

const KEYSTORE = arg('--keystore', 'ANDROID_KEYSTORE_PATH');
const STORE_PASSWORD = arg('--store-password', 'ANDROID_KEYSTORE_STORE_PASSWORD');
const ALIAS = arg('--alias', 'ANDROID_KEYSTORE_ALIAS', null);
const WARNING_DAYS = Number(arg('--warning-days', 'WARNING_DAYS', '30'));

if (!KEYSTORE || !existsSync(KEYSTORE)) {
  console.error(`::error::keystoreファイルが見つかりません: ${KEYSTORE || '(未指定)'}`);
  process.exit(1);
}
if (!STORE_PASSWORD) {
  console.error('::error::--store-password（または ANDROID_KEYSTORE_STORE_PASSWORD）が必要です。');
  process.exit(1);
}

let output;
try {
  const args = ['-list', '-v', '-keystore', KEYSTORE, '-storepass', STORE_PASSWORD];
  if (ALIAS) args.push('-alias', ALIAS);
  output = execFileSync('keytool', args, { encoding: 'utf8' });
} catch (e) {
  console.error(`::error::keytoolの実行に失敗しました: ${e && e.message}`);
  process.exit(1);
}

const parsed = parseExpiry(output);
if (!parsed) {
  console.error('::error::keytoolの出力から有効期限を読み取れませんでした。');
  console.error(output);
  process.exit(1);
}

const report = buildReport(parsed, WARNING_DAYS, new Date());
console.log(JSON.stringify(report, null, 2));
process.exit(0);

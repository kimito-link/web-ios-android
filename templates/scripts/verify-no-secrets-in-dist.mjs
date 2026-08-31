#!/usr/bin/env node
// ビルド成果物(dist)に秘密情報が焼き込まれていないかを検査するゲート(fail-closed)。
//
// 移植元: tsuioku-no-kirameki.com/scripts/check-no-secrets-in-dist.mjs
//   （2026-08-31、council-fable「逆輸入候補」調査で発見・輸入）
//
// ★元の事故(2026-08-03、移植元プロジェクトで実際に起きた):
//   共有キー(書き込み認証用/閲覧トークン)を esbuild の define でビルドに埋め込んでいた。
//   dist は git 追跡下＝公開リポジトリに push され、鍵が誰でも読める状態だった。
//   鍵のローテーションでは根治しない。「二度と焼き込まれないこと」を機械で保証する
//   ため、人の注意力に頼らずこの検査を追加した。
//
// 使い方:
//   node scripts/verify-no-secrets-in-dist.mjs                    # 既定の dist/ を検査
//   node scripts/verify-no-secrets-in-dist.mjs dist www build     # 複数ディレクトリを検査
//   node scripts/verify-no-secrets-in-dist.mjs --field customKey  # プロジェクト固有の秘密フィールド名を追加
//   node scripts/verify-no-secrets-in-dist.mjs --selftest         # 毒→赤を確認
//
// 終了コード（instrument-core の3値規約）:
//   0 = 焼き込みなし / 1 = 焼き込みあり（測れた上での赤） / 2 = 測れなかった（対象dirが1つも存在しない）
import fs from 'node:fs';
import path from 'node:path';
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';

/** 既定で検査するフィールド名。プロジェクト固有の鍵名は --field で追加する。 */
const DEFAULT_FIELDS = ['apiKey', 'secret', 'accessToken', 'refreshToken', 'clientSecret', 'privateKey'];

/**
 * 値そのものが秘密に見えるパターン（フィールド名に頼らない二重の網）。
 * 実際の漏洩事例（URL-safe乱数・各社の鍵プレフィックス）に基づく。
 */
const SECRET_VALUE_RES = [
  { name: 'Google OAuth client secret', re: /GOCSPX-[A-Za-z0-9_-]{20,}/ },
  { name: 'Google API key', re: /AIza[A-Za-z0-9_-]{30,}/ },
  { name: 'Slack token', re: /xox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function argAll(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === name && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
}

/** 誤検知を避けるための許可（変数名・型名など、値でないもの）。 */
function isBenign(value) {
  const v = String(value || '');
  if (!v) return true; // 空 = 未設定 = 正常
  if (v.length < 8) return true; // 短すぎる = 鍵ではない
  if (/^[a-z][A-Za-z0-9_]*$/.test(v) && v.length < 24) return true; // 変数名らしきもの
  return false;
}

/** @param {string} dir @returns {string[]} */
function listJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/**
 * ★判定の本体（純関数・fsに触らない＝テストしやすい）。
 * @param {{ path: string, content: string }[]} files
 * @param {string[]} fieldNames
 * @param {{ dirsExist: boolean }} context
 * @returns {import('./lib/instrument-core.mjs').ProbeResult[]}
 */
export function judgeNoSecrets(files, fieldNames, context) {
  if (!context.dirsExist) {
    return [{
      probe: 'ビルド成果物の秘密焼き込み検査',
      verdict: 'inconclusive',
      detail: '検査対象ディレクトリが1つも存在しません（ビルド未実行の可能性）',
      howToFix: 'ビルドを実行してから検査するか、--dir で正しい出力先を指定してください'
    }];
  }

  const fieldPattern = new RegExp(`(${fieldNames.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*:\\s*"([^"]+)"`, 'g');
  const findings = [];

  for (const f of files) {
    fieldPattern.lastIndex = 0;
    let m;
    while ((m = fieldPattern.exec(f.content)) !== null) {
      const [, field, value] = m;
      if (isBenign(value)) continue;
      findings.push(`${f.path}: ${field} に値が焼き込まれています（${value.length}文字）`);
    }
    for (const { name, re } of SECRET_VALUE_RES) {
      if (re.test(f.content)) findings.push(`${f.path}: ${name} らしき文字列が含まれています`);
    }
  }

  if (findings.length > 0) {
    return [{
      probe: 'ビルド成果物の秘密焼き込み検査',
      verdict: 'fail',
      evidence: { 検査ファイル数: files.length, 検出件数: findings.length },
      detail: `ビルド成果物に秘密情報が含まれています: ${findings.slice(0, 5).join(' / ')}${findings.length > 5 ? ` 他${findings.length - 5}件` : ''}`,
      howToFix: 'dist は git 追跡下＝push すると公開リポジトリで誰でも読めます。秘密はビルドに焼き込まず、実行時に利用者が入力する形（localStorage等）に置いてください'
    }];
  }

  return [{
    probe: 'ビルド成果物の秘密焼き込み検査',
    verdict: 'pass',
    evidence: { 検査ファイル数: files.length }
  }];
}

// ── selftest（★毒→赤） ──────────────────────────────────────────────────
function selftest() {
  const cases = [
    {
      name: '毒1: 対象ディレクトリが1つも無い（測れなかった）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeNoSecrets([], DEFAULT_FIELDS, { dirsExist: false })) === EXIT.INCONCLUSIVE
    },
    {
      name: '毒2: apiKeyフィールドに実値が焼き込まれている（赤）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const bad = { path: 'dist/status.js', content: 'const cfg = { apiKey: "sk_live_abcdefgh12345678" };' };
        return computeExitCode(judgeNoSecrets([bad], DEFAULT_FIELDS, { dirsExist: true })) === EXIT.FAIL;
      }
    },
    {
      name: '毒3: Google API keyパターンが値ベースで検出される（フィールド名に頼らない）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const bad = { path: 'dist/app.js', content: 'window.__K = "AIzaSyD1234567890abcdefghijklmnopqrstuv";' };
        return computeExitCode(judgeNoSecrets([bad], DEFAULT_FIELDS, { dirsExist: true })) === EXIT.FAIL;
      }
    },
    {
      name: '毒4: --fieldで追加したプロジェクト固有フィールド名も検出される',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const bad = { path: 'dist/status.js', content: 'const cfg = { ingestKey: "abcdefghijklmnop12345678" };' };
        return computeExitCode(judgeNoSecrets([bad], [...DEFAULT_FIELDS, 'ingestKey'], { dirsExist: true })) === EXIT.FAIL;
      }
    },
    {
      name: '毒なし: 空文字・短い変数名は誤検知しない',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const good = { path: 'dist/status.js', content: 'const cfg = { apiKey: "", secret: "userKey" };' };
        return computeExitCode(judgeNoSecrets([good], DEFAULT_FIELDS, { dirsExist: true })) === EXIT.PASS;
      }
    }
  ];

  const { ok, fails } = runSelfTest(cases);
  if (!ok) {
    console.error('🔴 selftest 失敗:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log(`✅ selftest 合格（${cases.length}件: フィールド名検知・値パターン検知・カスタムフィールド・誤検知なしを確認）`);
  process.exit(EXIT.PASS);
}

// ── 実行 ────────────────────────────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
  selftest();
}

const positional = process.argv.slice(2).filter((a, i, arr) => !a.startsWith('--') && arr[i - 1] !== '--field');
const dirs = positional.length ? positional : ['dist'];
const extraFields = argAll('--field');
const fieldNames = [...DEFAULT_FIELDS, ...extraFields];

const existingDirs = dirs.filter((d) => fs.existsSync(d));
const files = existingDirs.flatMap((d) => listJsFiles(d)).map((p) => ({ path: p, content: fs.readFileSync(p, 'utf8') }));

const results = judgeNoSecrets(files, fieldNames, { dirsExist: existingDirs.length > 0 });
const code = computeExitCode(results);
console.log(formatProbeReport(results, { label: 'no-secrets-in-dist' }));
if (code === EXIT.FAIL) {
  for (const r of results.filter((x) => x.verdict === 'fail')) {
    console.error(`::error::${r.detail}`);
  }
}
process.exit(code);

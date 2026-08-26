#!/usr/bin/env node
// app.config.json が app.config.schema.json に適合しているかの検証ゲート。
//
// 背景（2026-08-25の計器抜け漏れ調査で確定）:
//   app.config.schema.json は整備済みだが、templates/scripts/lib/app-config.mjs の
//   loadAppConfig() は JSON.parse するだけでスキーマ照合が一切無かった。
//   壊れた設定（bundleId のパターン違反・必須フィールド欠落・想定外キー）が
//   そのまま appstore-submit.mjs 等のリリーススクリプトへ素通りしていた。
//
// 車輪の再発明をしない: JSON Schema検証はajv（事実上の標準）に任せ、
//   自前でフィールドごとの検証ロジックを書かない。
//
// 使い方:
//   node scripts/verify-app-config-schema.mjs
//   node scripts/verify-app-config-schema.mjs --config path/to/app.config.json
//   node scripts/verify-app-config-schema.mjs --selftest   毒→赤を確認
//
// 終了コード（instrument-core の3値規約）:
//   0 = 合格 / 1 = 測れた上での赤（スキーマ違反） / 2 = 測れなかった（ファイル欠落等）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/**
 * ★判定の本体（純関数・fsに触らない＝テストしやすい）。
 * @param {object} schema app.config.schema.json の中身
 * @param {object} config app.config.json の中身
 * @returns {import('./lib/instrument-core.mjs').ProbeResult[]}
 */
export function judgeSchema(schema, config) {
  const LIMIT = '★型・必須フィールド・パターンの一致だけを見ます。値の意味的な正しさ（実在するURLか等）は判定しません。';
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (e) {
    return [{
      probe: 'app.config.schema.jsonのコンパイル',
      verdict: 'inconclusive',
      detail: `スキーマ自体が不正でコンパイルできません: ${e && e.message}`,
      howToFix: 'app.config.schema.jsonのJSON Schema構文を確認してください',
      limitation: LIMIT
    }];
  }

  const valid = validate(config);
  if (valid) {
    return [{
      probe: 'app.config.jsonのスキーマ適合',
      verdict: 'pass',
      evidence: { 検証項目数: Object.keys(schema.properties || {}).length },
      limitation: LIMIT
    }];
  }

  const errors = (validate.errors || []).map((e) => `${e.instancePath || '(root)'} ${e.message}`);
  return [{
    probe: 'app.config.jsonのスキーマ適合',
    verdict: 'fail',
    evidence: { 違反件数: errors.length, 違反: errors.slice(0, 10) },
    detail: `app.config.jsonがapp.config.schema.jsonに適合していません（${errors.length}件）: ${errors.slice(0, 5).join(' / ')}`,
    howToFix: '上記の違反箇所を app.config.schema.json の定義（必須フィールド・型・pattern）に合わせて修正してください',
    limitation: LIMIT
  }];
}

// ── selftest（★毒→赤。実ファイルに触れず組み立てた最小スキーマ+設定で完結） ──
const MINI_SCHEMA = {
  type: 'object',
  required: ['identity'],
  additionalProperties: false,
  properties: {
    identity: {
      type: 'object',
      required: ['bundleId'],
      properties: {
        bundleId: { type: 'string', pattern: '^[a-z][a-z0-9]+(\\.[a-z][a-z0-9]+)+$' }
      }
    }
  }
};
const GOOD_CONFIG = { identity: { bundleId: 'com.example.app' } };

function isRed(config) {
  return computeExitCode(judgeSchema(MINI_SCHEMA, config)) === EXIT.FAIL;
}

function selftest() {
  const cases = [
    {
      name: '毒1: bundleIdがpatternに違反（大文字混入）',
      poison: () => {},
      restore: () => {},
      isRed: () => isRed({ identity: { bundleId: 'com.Example.App' } })
    },
    {
      name: '毒2: 必須フィールドidentityが欠落',
      poison: () => {},
      restore: () => {},
      isRed: () => isRed({})
    },
    {
      name: '毒3: additionalPropertiesで許可されていないキーが混入',
      poison: () => {},
      restore: () => {},
      isRed: () => isRed({ identity: { bundleId: 'com.example.app' }, unknownKey: 'x' })
    },
    {
      name: '毒なし: 正しい設定は緑のまま（誤検知しない）',
      poison: () => {},
      restore: () => {},
      isRed: () => !isRed(GOOD_CONFIG)
    }
  ];

  const { ok, fails } = runSelfTest(cases);
  if (!ok) {
    console.error('🔴 selftest 失敗:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log(`✅ selftest 合格（${cases.length}件: pattern違反・必須欠落・想定外キー・誤検知なしを確認）`);
  process.exit(EXIT.PASS);
}

// ── 実行 ────────────────────────────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
  selftest();
}

const CONFIG_PATH = arg('--config', path.join(ROOT, 'app.config.json'));
const SCHEMA_PATH = path.join(ROOT, 'app.config.schema.json');

let schema;
let config;
try {
  schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
} catch (e) {
  console.error(`::error::${SCHEMA_PATH} を読めませんでした（${e && e.message}）。`);
  process.exit(EXIT.INCONCLUSIVE);
}
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
  console.error(`::error::${CONFIG_PATH} を読めませんでした（${e && e.message}）。`);
  process.exit(EXIT.INCONCLUSIVE);
}

const results = judgeSchema(schema, config);
const code = computeExitCode(results);
console.log(formatProbeReport(results, { label: 'app-config-schema' }));
if (code === EXIT.FAIL) {
  for (const r of results.filter((x) => x.verdict === 'fail')) {
    console.error(`::error::${r.probe}: ${r.detail}`);
  }
}
process.exit(code);

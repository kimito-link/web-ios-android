#!/usr/bin/env node
/**
 * generate-site-chrome-consumer.mjs — consumer固有のsite-chrome.config.jsonから、
 * runtime成果物（site-chrome.config.js / site-chrome.theme.css / site-chrome.layout.css）を
 * 決定論的に生成する。加えてCoreファイル（site-chrome.js/css）をconsumer側へコピーする。
 *
 * ★JSON側が正本（consumer固有Config）。JSを解析するための新しいAST/parser/regexは
 *   作らない（2026-09-03、GPT相談での設計方針）。
 * ★同じconfig.jsonからは常に同じ出力バイト列が生成される（決定論的）。これにより
 *   「generated成果物がconfig.jsonから再生成した期待値と一致するか」をCURRENT判定の
 *   材料にできる。
 *
 * 使い方:
 *   node generate-site-chrome-consumer.mjs --config <site-chrome.config.jsonのパス> --out <出力先ディレクトリ>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '..', 'config', 'schema.json');
const CORE_JS_PATH = join(__dirname, '..', 'core', 'site-chrome.js');
const CORE_CSS_PATH = join(__dirname, '..', 'core', 'site-chrome.css');

const DEFAULT_COLORS = { accent: '#667eea', accentSoft: '#f0f0ff', ink: '#555', line: '#eee' };
const DEFAULT_NAV_COLLAPSE_AT = 1100;

/**
 * config.jsonをschema検証する。
 * @param {object} config
 * @returns {{valid: boolean, errors: object[]|null}}
 */
export function validateConfig(config) {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv();
  const validateFn = ajv.compile(schema);
  const valid = validateFn(config);
  return { valid, errors: valid ? null : validateFn.errors };
}

/** config.jsonから site-chrome.config.js のソースを決定論的に生成する。 */
export function generateConfigJs(config) {
  const navItems = config.navItems || [];
  const payload = {
    brandName: config.brandName,
    brandCopyright: config.brandCopyright,
    logoSrc: config.logoSrc,
    homeLabel: config.homeLabel,
    navItems,
  };
  return `// site-chrome.config.js — generated from site-chrome.config.json. Do not edit by hand.\nwindow.SITE_CHROME_CONFIG = ${JSON.stringify(payload, null, 2)};\n`;
}

/** config.jsonから site-chrome.theme.css のソースを決定論的に生成する。 */
export function generateThemeCss(config) {
  const colors = { ...DEFAULT_COLORS, ...(config.colors || {}) };
  return `/* site-chrome.theme.css — generated from site-chrome.config.json. Do not edit by hand. */\n:root {\n  --site-chrome-accent: ${colors.accent};\n  --site-chrome-accent-soft: ${colors.accentSoft};\n  --site-chrome-ink: ${colors.ink};\n  --site-chrome-line: ${colors.line};\n}\n`;
}

/** config.jsonから site-chrome.layout.css のソースを決定論的に生成する。 */
export function generateLayoutCss(config) {
  const collapseAt = config.navCollapseAt ?? DEFAULT_NAV_COLLAPSE_AT;
  return `/* site-chrome.layout.css — generated from site-chrome.config.json. Do not edit by hand. */\n@media (max-width: ${collapseAt}px) {\n  .nav-toggle { display: flex; }\n  header nav {\n    display: none;\n    position: fixed;\n    top: 60px;\n    left: 0;\n    right: 0;\n    background: white;\n    flex-direction: column;\n    gap: 2px;\n    padding: 10px 14px 18px;\n    max-height: calc(100vh - 60px);\n    overflow-y: auto;\n    box-shadow: 0 8px 16px rgba(0,0,0,0.1);\n  }\n  header nav.nav-open { display: flex; }\n  header nav a { font-size: 0.88rem; padding: 10px 12px; }\n}\n`;
}

/**
 * consumer固有config.jsonからruntime成果物一式とCoreコピーを生成する。
 * @param {string} configPath site-chrome.config.jsonのパス
 * @param {string} outDir 出力先ディレクトリ
 */
export function generateConsumer(configPath, outDir) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const { valid, errors } = validateConfig(config);
  if (!valid) {
    throw new Error(`site-chrome.config.json がschemaに適合しません: ${JSON.stringify(errors)}`);
  }

  writeFileSync(join(outDir, 'site-chrome.config.js'), generateConfigJs(config));
  writeFileSync(join(outDir, 'site-chrome.theme.css'), generateThemeCss(config));
  writeFileSync(join(outDir, 'site-chrome.layout.css'), generateLayoutCss(config));
  writeFileSync(join(outDir, 'site-chrome.js'), readFileSync(CORE_JS_PATH, 'utf8'));
  writeFileSync(join(outDir, 'site-chrome.css'), readFileSync(CORE_CSS_PATH, 'utf8'));

  return { outDir, files: ['site-chrome.config.js', 'site-chrome.theme.css', 'site-chrome.layout.css', 'site-chrome.js', 'site-chrome.css'] };
}

function main() {
  const args = process.argv.slice(2);
  const configIdx = args.indexOf('--config');
  const outIdx = args.indexOf('--out');
  if (configIdx < 0 || outIdx < 0) {
    console.error('使い方: node generate-site-chrome-consumer.mjs --config <site-chrome.config.jsonのパス> --out <出力先ディレクトリ>');
    process.exit(1);
  }
  const configPath = resolve(args[configIdx + 1]);
  const outDir = resolve(args[outIdx + 1]);
  if (!existsSync(configPath)) {
    console.error(`[generate-site-chrome-consumer] config not found: ${configPath}`);
    process.exit(1);
  }
  const result = generateConsumer(configPath, outDir);
  console.log(`[generate-site-chrome-consumer] OK ${result.outDir} に生成: ${result.files.join(', ')}`);
}

if (process.argv[1] && process.argv[1].endsWith('generate-site-chrome-consumer.mjs')) {
  main();
}

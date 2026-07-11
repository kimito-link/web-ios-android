#!/usr/bin/env node
// 「capacitor.config.ts の webDir」と「CI の Prepare webDir が実際に作る場所」の
// 不一致を防ぐゲート(_docs/CAPACITOR-GOLDEN-RULES.md 原則8をコード化)。
//
// 背景(2026-07-04 kimito resend実戦): webDir:'www' のまま7回連続でAndroidビルドが
// 失敗した。真因は `cap copy android` が `www/` を探すのに CI の「Prepare webDir」は
// `dist/public` にしか作らない不一致で、capacitor.config.json の書き込みが失敗し
// capacitor.settings.gradle が生成されずGradleが「Could not read script
// capacitor.settings.gradle」で落ちる、という3階層先のエラーとして現れた
// (根本原因から遠いエラーメッセージで出るので気づきにくい)。
//
// このスクリプトは webDir を変更する余地(cap copy/cap sync の)より前、
// 「Prepare webDir」ステップの直後に走らせ、値のズレを1階層目で機械的に検出する。
//
// 使い方:
//   node scripts/verify-webdir-consistency.mjs
//   node scripts/verify-webdir-consistency.mjs --expected dist/public
//   node scripts/verify-webdir-consistency.mjs --config capacitor.config.ts
import fs from 'node:fs';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function fail(msg) { console.error(`::error::${msg}`); process.exit(1); }
function normalize(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

const CONFIG_TS = arg('--config', 'capacitor.config.ts');
const CONFIG_JSON = 'capacitor.config.json';
const EXPECTED = arg('--expected', 'dist/public');

let source = null;
let sourceName = null;
let webDirRaw = null;

if (fs.existsSync(CONFIG_TS)) {
  source = fs.readFileSync(CONFIG_TS, 'utf8');
  sourceName = CONFIG_TS;
  webDirRaw = source.match(/\bwebDir\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? null;
} else if (fs.existsSync(CONFIG_JSON)) {
  sourceName = CONFIG_JSON;
  try {
    webDirRaw = JSON.parse(fs.readFileSync(CONFIG_JSON, 'utf8')).webDir ?? null;
  } catch (e) {
    fail(`${CONFIG_JSON} の JSON.parse に失敗しました: ${e.message}`);
  }
} else {
  fail(`${CONFIG_TS} も ${CONFIG_JSON} も存在しません(cap add 未実行、または working directory が違う?)`);
}

if (webDirRaw == null) {
  fail(`${sourceName} に webDir が見つかりません(server.url 連動型でも webDir は必須: オフライン/未応答時のフォールバックstub置き場)。`);
}

const got = normalize(webDirRaw);
const expected = normalize(EXPECTED);

if (got !== expected) {
  console.error(`::error::webDir 不一致検出: ${sourceName} の webDir="${webDirRaw}" だが CI の「Prepare webDir」は "${EXPECTED}" にしか生成しない。`);
  console.error('この不一致は cap copy が webDir を見つけられず capacitor.config.json の書き込みに失敗し、');
  console.error('capacitor.settings.gradle が生成されずGradleが「Could not read script capacitor.settings.gradle」で');
  console.error('落ちる、という3階層先のエラーとして現れる(2026-07-04 kimito resend実戦で7回連続失敗した地雷そのもの)。');
  console.error(`対処: ${sourceName} の webDir を "${EXPECTED}" に合わせるか、CI側の「Prepare webDir」の生成先を webDir と揃えてください。`);
  process.exit(1);
}

console.log(`webDir consistency check: OK（${sourceName} の webDir="${webDirRaw}" と CI 生成先が一致）`);

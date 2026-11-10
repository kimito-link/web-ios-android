#!/usr/bin/env node
// 役割: このアプリのリポで、ストアの入力欄のうち「素材がまだ無い欄」を一覧にする。
//   対応表は lib/store-fields.json（App Store・Google Play・Chrome ウェブストアの全部の欄。必須も任意も）。
// なぜ要るか: 任意の欄（ヘッダと検索結果・iPhone Duo のスクショ・Play の動画・CWS のプロモーション タイル）は無くても提出が通るので、
//   言われるまで空のまま公開されていた。りんくの指示（2026-11-09）「必要な画像は入れてほしい。入力項目が増えたら言わなくても入れて。CVR に効く」。
//   ⟹ AI は提出の前にこれを走らせ、空いている欄を自分で埋めてから提出する（docs/ai-rules/10_STORE_FIELDS.md）。
// 使い方:
//   node scripts/check-store-fields.mjs                 # 表で出す
//   node scripts/check-store-fields.mjs --strict        # 必須に加え、CVR の欄が空でも exit 1（提出前の門に使う）
//   STORE_TARGETS=appstore,play node scripts/check-store-fields.mjs   # 出すストアを指定（無ければ app.config 等から推定）
// 終了コード: 0 = 必須は全部ある（--strict では CVR の欄も全部ある） / 1 = 足りない / 2 = 出すストアが分からない
// ★見るのは「素材がリポにあるか」まで。ストアの画面に上がっているかは、提出後に画面で確かめる。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectStoreTargets, evaluateStoreFields } from './lib/store-fields.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function loadInventory() {
  return JSON.parse(fs.readFileSync(path.join(HERE, 'lib', 'store-fields.json'), 'utf8'));
}

export function makeIo(root) {
  return {
    fileNonEmpty: (rel) => {
      try { return fs.statSync(path.join(root, rel)).size > 0; } catch { return false; }
    },
    listDir: (rel) => {
      try { return fs.readdirSync(path.join(root, rel)); } catch { return null; }
    },
  };
}

export function storeFieldsReport(root, { envTargets = process.env.STORE_TARGETS } = {}) {
  let config = {};
  try { config = JSON.parse(fs.readFileSync(path.join(root, 'app.config.json'), 'utf8')); } catch { /* 無くてもよい */ }
  const targets = detectStoreTargets({ config, envTargets, hasPath: (p) => fs.existsSync(path.join(root, p)) });
  const rows = evaluateStoreFields(loadInventory(), { targets, config, io: makeIo(root) });
  return { targets, rows };
}

const LEVEL = { required: '必須', cvr: 'CVR', when: '条件つき' };

function main() {
  const root = process.cwd();
  const strict = process.argv.includes('--strict');
  const { targets, rows } = storeFieldsReport(root);
  if (!targets.length) {
    console.log('出すストアが分からない（app.config.json の stores.ascAppId / playPackageName、ios/・android/・manifest.json が無い）。STORE_TARGETS=appstore,play,cws で指定する');
    return 2;
  }
  let store = '';
  for (const r of rows) {
    if (r.store !== store) { store = r.store; console.log(`\n■ ${r.storeLabel}`); }
    const mark = r.filled ? '✓' : r.level === 'when' ? '·' : r.level === 'required' ? '✗' : '!';
    const extra = r.filled ? '' : [r.make && `作り方: ${r.make}`, r.when && `条件: ${r.when}`, r.note].filter(Boolean).join(' ／ ');
    console.log(`${mark} [${LEVEL[r.level] || r.level}] ${r.label}${r.fill === 'screen' ? '（画面で上げる）' : ''}${extra ? `\n    ${extra}` : ''}`);
  }
  const missReq = rows.filter((r) => !r.filled && r.level === 'required');
  const missCvr = rows.filter((r) => !r.filled && r.level === 'cvr');
  console.log(`\n必須の空き ${missReq.length} ／ CVR の空き ${missCvr.length}（CVR の欄は任意でも、言われなくても埋める: docs/ai-rules/10_STORE_FIELDS.md）`);
  return missReq.length || (strict && missCvr.length) ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(main());

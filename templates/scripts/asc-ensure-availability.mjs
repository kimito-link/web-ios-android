#!/usr/bin/env node
/**
 * App Store の配信地域を「すべての国と地域」にする（ビルドも提出もしない。配信設定だけ）。
 *
 * なぜ要るか: 審査に通っても配信地域が空だと「App Store の配信から削除されました」となり公開されない。
 *   提出のやり直しをせずに、ここだけ直せるようにした。何度回しても同じ結果になる。
 *
 * 使い方: node scripts/asc-ensure-availability.mjs
 */
import fs from 'node:fs';
import { makeAscClient, findApp } from './lib/asc-api.mjs';
import { ensureAllTerritoriesAvailable } from './lib/asc-availability.mjs';
import { loadAppConfig } from './lib/app-config.mjs';

const cfg = loadAppConfig();
const BUNDLE_ID = process.env.APP_BUNDLE_ID || cfg.identity.bundleId;

function resolvePrivateKey() {
  if (process.env.APPSTORE_CONNECT_API_KEY_P8) return process.env.APPSTORE_CONNECT_API_KEY_P8;
  const p = process.env.APPSTORE_CONNECT_API_KEY_P8_PATH;
  if (p && fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  if (process.env.APPSTORE_CONNECT_API_KEY_P8_BASE64) {
    return Buffer.from(process.env.APPSTORE_CONNECT_API_KEY_P8_BASE64, 'base64').toString('utf8');
  }
  throw new Error('Provide APPSTORE_CONNECT_API_KEY_P8 / _PATH / _BASE64.');
}

const keyId = (process.env.APPSTORE_CONNECT_KEY_ID || '').trim();
const issuerId = (process.env.APPSTORE_CONNECT_ISSUER_ID || '').trim();
if (!keyId || !issuerId) throw new Error('APPSTORE_CONNECT_KEY_ID / _ISSUER_ID required.');

const api = makeAscClient({ keyId, issuerId, privateKey: resolvePrivateKey() });

const app = await findApp(api, BUNDLE_ID);
if (!app) throw new Error(`App not found for bundleId=${BUNDLE_ID}`);
console.log(`[asc-availability] app id=${app.id} bundleId=${BUNDLE_ID}`);

const first = await ensureAllTerritoriesAvailable(api, app.id);
console.log(`[asc-availability] result=${JSON.stringify(first)}`);

// 裏取り: もう一度回して「何もすることが無い」になることを確かめる。
const second = await ensureAllTerritoriesAvailable(api, app.id);
console.log(`[asc-availability] verify=${JSON.stringify(second)}`);
if (second.set) {
  console.error('[asc-availability] 2回目もまだ変更が要る状態です（設定が反映されていません）。');
  process.exit(1);
}

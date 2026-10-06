#!/usr/bin/env node
// 同一 Team のアプリ名義の一覧（store-assets/team-apps.json）を作る。
// lint-pre-submission の CHECK 27（他アプリ名義が文字列リテラルに混入していないか）の入力になる。
//
// 名義の出どころ（優先順）:
//   1. 姉妹リポの app.config.json（displayName / shortName / productionDomain / bundleId）— creds 不要・オフライン
//   2. App Store Connect の GET /v1/apps（--asc を付け、APPSTORE_CONNECT_* が環境にあるときだけ）。
//      configs に無いアプリ（別リポ管理・config を持たないアプリ）の name と bundleId を足す。
//      ★ASC の name は displayName 相当だけで、shortName / productionDomain は無い。
//
// 設計: _docs/DESIGN-apple-4-3a-spam-response-2026-10-06.md §C2-①
//
// 使い方:
//   node scripts/asc-list-team-apps.mjs --configs-root <リポ群の親ディレクトリ> [--asc] [--out store-assets/team-apps.json]
//   node scripts/asc-list-team-apps.mjs --selftest
//
// 終了コード: 0=書けた / 1=入力が客観的に不正 / 2=測れなかった（0本・ASC 失敗など。★緑ではない）
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/**
 * app.config.json の中身 → 名義1件。bundleId が無ければ null。
 * @param {any} cfg
 */
export function appFromConfig(cfg) {
  const id = cfg?.identity;
  if (!id || typeof id.bundleId !== 'string' || !id.bundleId) return null;
  if (id.bundleId.startsWith('<')) return null; // キットのテンプレ（プレースホルダ）は名義ではない
  return {
    source: 'config',
    bundleId: id.bundleId,
    displayName: id.displayName ?? null,
    shortName: id.shortName ?? null,
    productionDomain: id.productionDomain ?? null,
    ascAppId: cfg?.stores?.ascAppId ?? null,
  };
}

/**
 * config 由来と ASC 由来を bundleId で束ねる。config を優先し、ASC は欠けた項目と未登録アプリを足す。
 * @param {any[]} fromConfigs
 * @param {{ bundleId: string, name?: string, id?: string }[]} fromAsc
 */
export function mergeTeamApps(fromConfigs, fromAsc = []) {
  const byBundle = new Map();
  for (const a of fromConfigs) if (a?.bundleId && !byBundle.has(a.bundleId)) byBundle.set(a.bundleId, { ...a });
  for (const s of fromAsc) {
    if (!s?.bundleId) continue;
    const cur = byBundle.get(s.bundleId);
    if (cur) {
      if (!cur.displayName && s.name) cur.displayName = s.name;
      if (!cur.ascAppId && s.id) cur.ascAppId = s.id;
    } else {
      byBundle.set(s.bundleId, {
        source: 'asc',
        bundleId: s.bundleId,
        displayName: s.name ?? null,
        shortName: null,
        productionDomain: null,
        ascAppId: s.id ?? null,
      });
    }
  }
  return [...byBundle.values()].sort((a, b) => a.bundleId.localeCompare(b.bundleId));
}

function readConfigs(root) {
  const apps = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = path.join(root, e.name);
    // app.config.json と、ブランド別の app.config.<brand>.json（例: reverse-hack）を読む
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((f) => /^app\.config(\.[a-z0-9-]+)?\.json$/i.test(f));
    } catch {
      continue;
    }
    for (const f of names) {
      try {
        const a = appFromConfig(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
        if (a) apps.push({ ...a, repo: e.name, file: f });
      } catch {
        // 読めない config は無視せず報告（測れなかったものを黙って落とさない）
        console.error(`[asc-list-team-apps] 読めない config をスキップ: ${e.name}/${f}`);
      }
    }
  }
  return apps;
}

async function fetchAscApps() {
  const { makeAscClient } = await import('./lib/asc-api.mjs');
  const { hasAscCreds, resolveAscPrivateKey } = await import('./lib/asc-readonly-checks.mjs');
  if (!hasAscCreds()) throw new Error('APPSTORE_CONNECT_KEY_ID / ISSUER_ID / API_KEY が環境に無い');
  const api = makeAscClient({
    keyId: process.env.APPSTORE_CONNECT_KEY_ID,
    issuerId: process.env.APPSTORE_CONNECT_ISSUER_ID,
    privateKey: resolveAscPrivateKey(),
  });
  const out = [];
  let next = '/v1/apps?limit=200&fields[apps]=name,bundleId';
  while (next) {
    const r = await api('GET', next);
    for (const d of r.data || []) out.push({ id: d.id, name: d.attributes?.name, bundleId: d.attributes?.bundleId });
    const link = r.links?.next;
    next = link ? link.replace(/^https:\/\/api\.appstoreconnect\.apple\.com/, '') : null;
  }
  return out;
}

function selftest() {
  const cfgA = appFromConfig({ identity: { bundleId: 'com.x.a', displayName: 'A', shortName: 'a', productionDomain: 'a.example' }, stores: { ascAppId: '1' } });
  const merged = mergeTeamApps([cfgA], [
    { id: '1', name: 'A(ASC)', bundleId: 'com.x.a' },
    { id: '2', name: 'B', bundleId: 'com.x.b' },
  ]);
  const checks = [
    ['bundleId の無い config は無視', appFromConfig({ identity: {} }) === null],
    ['config が優先され、ASC は欠けた項目だけ足す', merged.find((x) => x.bundleId === 'com.x.a')?.displayName === 'A'],
    ['config に無い ASC のアプリを足す（source=asc）', merged.find((x) => x.bundleId === 'com.x.b')?.source === 'asc'],
    ['bundleId で重複排除', merged.length === 2],
  ];
  let bad = 0;
  for (const [n, ok] of checks) {
    console.log(`${ok ? '✓' : '✗'} ${n}`);
    if (!ok) bad++;
  }
  if (bad) {
    console.error(`❌ selftest 失敗 ${bad}件`);
    process.exit(1);
  }
  console.log(`✅ selftest 合格（${checks.length}件）`);
}

async function main() {
  if (process.argv.includes('--selftest')) return selftest();
  const root = arg('--configs-root', null);
  const out = arg('--out', 'store-assets/team-apps.json');
  if (!root) {
    console.error('--configs-root <リポ群の親ディレクトリ> が必要です。');
    process.exit(1);
  }
  const fromConfigs = readConfigs(root);
  let fromAsc = [];
  if (process.argv.includes('--asc')) {
    try {
      fromAsc = await fetchAscApps();
    } catch (e) {
      console.error(`[asc-list-team-apps] 🟡 ASC から取れなかった（★緑ではありません）: ${e.message}`);
      process.exit(2);
    }
  }
  const apps = mergeTeamApps(fromConfigs, fromAsc);
  if (apps.length === 0) {
    console.error('[asc-list-team-apps] 🟡 名義が 0 件（★緑ではありません。一度も見ていません）');
    process.exit(2);
  }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(apps, null, 2) + '\n');
  console.log(`[asc-list-team-apps] ✅ ${apps.length} 件を ${out} に書きました（config ${fromConfigs.length} 件 / ASC ${fromAsc.length} 件）`);
  console.log('★この一覧が判定しないこと: Team に属するか（appleTeamId での絞り込みはしていない）。ASC の name は表示名のみ。');
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) await main();

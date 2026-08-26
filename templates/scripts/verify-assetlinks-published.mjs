#!/usr/bin/env node
// Android assetlinks.json / iOS apple-app-site-association が本番URLで
// 実際に取得できるかの検証（TWA/App Links・Universal Linksの疎通確認）。
//
// 背景（2026-08-25の計器抜け漏れ調査で確定）:
//   templates/android-twa/assetlinks.json.example は手動テンプレとして存在するが、
//   本番サイトに実際にデプロイされ、内容がapp.config.jsonのplayPackageNameと
//   一致しているかを確認する仕組みが無かった。指紋のミスや配信忘れは
//   「アドレスバーが消えない」というUIの不具合としてしか気付けず、
//   原因の切り分けに時間がかかる（templates/android-twa/README.md:134に実損記録あり）。
//
// 車輪の再発明をしない: Google公式のStatement List Tool的な検証はネットワーク越しの
//   実URLフェッチで代替する（公式APIは提供されていないため、素朴なfetch+パースで足りる）。
//
// 使い方:
//   node scripts/verify-assetlinks-published.mjs --domain example.com --package com.example.app
//   （環境変数 SCREENSHOT_URL や app.config.json の identity.productionDomain / stores.playPackageName でも指定可）
//   node scripts/verify-assetlinks-published.mjs --selftest   毒→赤を確認
//
// 終了コード（instrument-core の3値規約）:
//   0 = 合格 / 1 = 測れた上での赤（配信されていない・内容不一致） / 2 = 測れなかった（ドメイン未設定等）
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';
import { cfg } from './lib/app-config.mjs';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/**
 * ★判定の本体（純関数・fetchに触らない＝テストしやすい）。
 * @param {{status: number, contentType: string, body: string} | null} response
 *   nullはfetch自体が失敗した(ネットワークエラー/タイムアウト)ことを示す
 * @param {string} expectedPackage app.config.json の stores.playPackageName
 * @returns {import('./lib/instrument-core.mjs').ProbeResult[]}
 */
export function judgeAssetlinks(response, expectedPackage) {
  const LIMIT = '★SHA256証明書指紋が正しいかは判定しません（Play App Signing切り替え等で変わりうるため、配信の有無と package_name 一致のみを見ます）。';

  if (!response) {
    return [{
      probe: 'assetlinks.jsonの疎通',
      verdict: 'inconclusive',
      detail: 'ネットワークエラーでURLを取得できませんでした',
      howToFix: '本番ドメインが正しいか、サイトが公開済みか確認してください',
      limitation: LIMIT
    }];
  }

  if (response.status !== 200) {
    return [{
      probe: 'assetlinks.jsonの疎通',
      verdict: 'fail',
      evidence: { httpStatus: response.status },
      detail: `/.well-known/assetlinks.json が HTTP ${response.status} を返しました（200以外）`,
      howToFix: 'assetlinks.json.example をコピーして本番サイトの /.well-known/assetlinks.json として配信してください',
      limitation: LIMIT
    }];
  }

  let parsed;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return [{
      probe: 'assetlinks.jsonの疎通',
      verdict: 'fail',
      evidence: { httpStatus: 200, jsonParse: false },
      detail: '/.well-known/assetlinks.json はHTTP 200を返しましたが、正しいJSONではありません',
      howToFix: '配信されている内容がリダイレクト先の別ページ(404ページ等)になっていないか確認してください',
      limitation: LIMIT
    }];
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return [{
      probe: 'assetlinks.jsonの疎通',
      verdict: 'fail',
      evidence: { isArray: Array.isArray(parsed), length: Array.isArray(parsed) ? parsed.length : null },
      detail: 'assetlinks.jsonはJSON配列である必要がありますが、配列でないか空です',
      howToFix: 'assetlinks.json.example の形式（配列。_README キーは除去済みか確認）に合わせてください',
      limitation: LIMIT
    }];
  }

  const packageNames = parsed
    .map((entry) => entry?.target?.package_name)
    .filter(Boolean);
  const matches = packageNames.includes(expectedPackage);

  if (!matches) {
    return [{
      probe: 'assetlinks.jsonの疎通',
      verdict: 'fail',
      evidence: { 配信されているpackage_name: packageNames, 期待するpackage_name: expectedPackage },
      detail: `配信されているassetlinks.jsonのpackage_nameがapp.config.jsonのstores.playPackageName(${expectedPackage})と一致しません`,
      howToFix: 'assetlinks.jsonのtarget.package_nameをapp.config.jsonの値に合わせて再デプロイしてください',
      limitation: LIMIT
    }];
  }

  return [{
    probe: 'assetlinks.jsonの疎通',
    verdict: 'pass',
    evidence: { httpStatus: 200, package_name: expectedPackage, エントリ数: parsed.length },
    limitation: LIMIT
  }];
}

// ── selftest（★毒→赤。実ネットワークに触れず組み立てたレスポンスで完結） ──
function selftest() {
  const cases = [
    {
      name: '毒1: HTTP 404（未配信）',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeAssetlinks({ status: 404, contentType: 'text/html', body: 'Not Found' }, 'com.example.app')) === EXIT.FAIL
    },
    {
      name: '毒2: package_nameが不一致',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeAssetlinks(
        { status: 200, contentType: 'application/json', body: JSON.stringify([{ target: { package_name: 'com.other.app' } }]) },
        'com.example.app'
      )) === EXIT.FAIL
    },
    {
      name: '毒3: 配列でない（オブジェクトが返る＝_README等の混入や誤配信）',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeAssetlinks(
        { status: 200, contentType: 'application/json', body: JSON.stringify({ notAnArray: true }) },
        'com.example.app'
      )) === EXIT.FAIL
    },
    {
      name: '毒4: 壊れたJSON',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeAssetlinks({ status: 200, contentType: 'application/json', body: 'not json{' }, 'com.example.app')) === EXIT.FAIL
    },
    {
      name: '毒なし: 正しく配信されていれば緑（誤検知しない）',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeAssetlinks(
        { status: 200, contentType: 'application/json', body: JSON.stringify([{ target: { package_name: 'com.example.app' } }]) },
        'com.example.app'
      )) === EXIT.PASS
    },
    {
      name: 'ネットワークエラーは測れなかった扱い(緑にも赤にも混ぜない)',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeAssetlinks(null, 'com.example.app')) === EXIT.INCONCLUSIVE
    }
  ];

  const { ok, fails } = runSelfTest(cases);
  if (!ok) {
    console.error('🔴 selftest 失敗:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log(`✅ selftest 合格（${cases.length}件: 未配信・package不一致・非配列・壊れたJSON・誤検知なし・ネットワークエラーの区別を確認）`);
  process.exit(EXIT.PASS);
}

// ── 実行 ────────────────────────────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
  selftest();
}

const DOMAIN = arg('--domain', cfg('identity.productionDomain'));
const PACKAGE = arg('--package', cfg('stores.playPackageName'));

if (!DOMAIN) {
  console.error('::error::--domain が未指定で、app.config.json の identity.productionDomain も空です。');
  process.exit(EXIT.INCONCLUSIVE);
}
if (!PACKAGE) {
  console.error('::error::--package が未指定で、app.config.json の stores.playPackageName も空です。');
  process.exit(EXIT.INCONCLUSIVE);
}

const url = `https://${DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '')}/.well-known/assetlinks.json`;

let response;
try {
  const res = await fetch(url, { redirect: 'manual' });
  const body = await res.text();
  response = { status: res.status, contentType: res.headers.get('content-type') || '', body };
} catch (e) {
  console.error(`::error::${url} の取得に失敗しました: ${e && e.message}`);
  response = null;
}

const results = judgeAssetlinks(response, PACKAGE);
const code = computeExitCode(results);
console.log(formatProbeReport(results, { label: 'assetlinks' }));
console.log(`   対象URL: ${url}`);
if (code === EXIT.FAIL) {
  for (const r of results.filter((x) => x.verdict === 'fail')) {
    console.error(`::error::${r.probe}: ${r.detail}`);
  }
}
process.exit(code);

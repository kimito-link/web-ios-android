#!/usr/bin/env node
// site/ 内の外部リンク（http/https）が実際に到達可能かのチェック。
// scripts/verify-internal-links.mjs は設計上 http(s):// を対象外にしており
// （site内部のパス・アンカー解決に特化）、外部リンクの404は一度も検査されていなかった。
//
// 背景（2026-08-25の計器抜け漏れ調査で確定）:
//   ストアバッジや外部ドキュメントへのリンクが切れても、静的な内部リンクチェックでは
//   検出できない。実測（linkinatorを実際にsite/へ実行）で、単純な「200以外は赤」だと
//   play.google.com/console/* 等の**ログイン必須の管理画面URL**（401が返る。これは正常）を
//   大量に誤検知することが判明したため、既知の認証必須ドメインは除外する。
//
// 車輪の再発明をしない: リンククロールと到達性判定はlinkinator（公式・広く使われる
//   ツール）に任せ、自前でHTMLパーサ/クローラを書かない。
//
// 使い方:
//   node scripts/verify-external-links.mjs [対象ディレクトリ 既定: site]
//   node scripts/verify-external-links.mjs --selftest   毒→赤を確認
//
// 終了コード（instrument-core の3値規約）:
//   0 = 合格 / 1 = 測れた上での赤（本物の404等） / 2 = 測れなかった（linkinator実行失敗等）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

/**
 * ★ログイン必須で200以外を返すのが正常なドメイン(実測で確認: 2026-08-25、
 *   web-ios-androidのsite/へlinkinatorを実際に実行し、play.google.com/console/*等が
 *   401で「BROKEN」と誤検知されることを確認した)。
 *   ★ここに載っているドメインへのリンクは、到達可能性チェックの対象から除外する
 *   （＝リンク自体が生きているかはブラウザで人力確認する運用のまま）。
 */
export const AUTH_GATED_DOMAINS = [
  'play.google.com',
  'console.cloud.google.com',
  'chrome.google.com',
  'aistudio.google.com',
  'appleid.apple.com',
];

/**
 * ★判定の本体（純関数・linkinatorに触れない＝テストしやすい）。
 * @param {Array<{url: string, status: number, state: string}>} links linkinatorの結果配列
 * @returns {import('./lib/instrument-core.mjs').ProbeResult[]}
 */
export function judgeLinks(links) {
  const LIMIT = '★ログイン必須の管理画面ドメイン(AUTH_GATED_DOMAINS)は除外します。除外リスト外のドメインでも一時的なネットワーク不調で誤検知することがあります。';

  if (!Array.isArray(links)) {
    return [{
      probe: '外部リンクの到達性',
      verdict: 'inconclusive',
      detail: 'linkinatorの結果が配列ではありません(実行自体に失敗した可能性)',
      howToFix: 'linkinatorが正しくインストールされているか確認してください',
      limitation: LIMIT
    }];
  }

  const broken = links.filter((l) => {
    if (l.state !== 'BROKEN') return false;
    let hostname;
    try {
      hostname = new URL(l.url).hostname;
    } catch {
      return true;
    }
    return !AUTH_GATED_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  });

  if (broken.length > 0) {
    return [{
      probe: '外部リンクの到達性',
      verdict: 'fail',
      evidence: {
        壊れているリンク数: broken.length,
        詳細: broken.slice(0, 10).map((l) => `${l.status} ${l.url}`)
      },
      detail: `site/内の外部リンクのうち${broken.length}件が到達できません(404等)`,
      howToFix: 'リンク先URLを確認し、修正するか削除してください。ログイン必須の管理画面URLなら AUTH_GATED_DOMAINS に追加してください',
      limitation: LIMIT
    }];
  }

  return [{
    probe: '外部リンクの到達性',
    verdict: 'pass',
    evidence: { 検査リンク数: links.filter((l) => l.state !== 'SKIPPED').length },
    limitation: LIMIT
  }];
}

// ── selftest（★毒→赤。実ネットワークに触れず組み立てたlinkinator結果で完結） ──
function selftest() {
  const cases = [
    {
      name: '毒1: 通常ドメインへのリンクが404',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeLinks([
        { url: 'https://example.com/dead-page', status: 404, state: 'BROKEN' }
      ])) === EXIT.FAIL
    },
    {
      name: '毒なし: 認証必須ドメイン(play.google.com/console)の401は誤検知しない',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeLinks([
        { url: 'https://play.google.com/console/u/0/developers/app/x', status: 401, state: 'BROKEN' }
      ])) === EXIT.PASS
    },
    {
      name: '毒なし: サブドメイン(console.cloud.google.com)の除外も効く',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeLinks([
        { url: 'https://console.cloud.google.com/iam-admin', status: 401, state: 'BROKEN' }
      ])) === EXIT.PASS
    },
    {
      name: '毒なし: 全てOKなら緑（誤検知しない）',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeLinks([
        { url: 'https://example.com/ok', status: 200, state: 'OK' }
      ])) === EXIT.PASS
    },
    {
      name: '毒2: linkinatorの結果が配列でない(実行失敗)→測れなかった扱い',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeLinks(null)) === EXIT.INCONCLUSIVE
    }
  ];

  const { ok, fails } = runSelfTest(cases);
  if (!ok) {
    console.error('🔴 selftest 失敗:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log(`✅ selftest 合格（${cases.length}件: 本物の404検知・認証必須ドメインの除外・誤検知なし・実行失敗の区別を確認）`);
  process.exit(EXIT.PASS);
}

// ── 実行 ────────────────────────────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
  selftest();
}

const targetArg = process.argv.find((a, i) => i > 1 && !a.startsWith('--'));
const TARGET = path.resolve(ROOT, targetArg || 'site');

let links;
try {
  const { LinkChecker } = await import('linkinator');
  const checker = new LinkChecker();
  const result = await checker.check({ path: TARGET, recurse: true, timeout: 15000 });
  links = result.links;
} catch (e) {
  console.error(`::error::linkinatorの実行に失敗しました: ${e && e.message}`);
  process.exit(EXIT.INCONCLUSIVE);
}

const results = judgeLinks(links);
const code = computeExitCode(results);
console.log(formatProbeReport(results, { label: 'external-links' }));
console.log(`   対象: ${TARGET}`);
if (code === EXIT.FAIL) {
  for (const r of results.filter((x) => x.verdict === 'fail')) {
    console.error(`::error::${r.probe}: ${r.detail}`);
  }
}
process.exit(code);

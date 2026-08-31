#!/usr/bin/env node
// 数値・実績を含む文の近傍に出典コメントがあるかを検査するゲート。
//
// 移植元: best-trust.biz/scripts/verify-claims-provenance.mjs
//   （2026-08-31、council-fable「逆輸入候補」調査で発見・輸入・汎用化）
//
// ★何を防ぐか: 「せっかくだから」で出典の無い一文（「多数の実績」「高い評価」等）を
//   接続詞代わりに足す衝動は、コンテンツ拡充作業で最も起きやすい地雷。
//   出典（`<!-- 出典: URL（日付） -->`）が近くに無い数値主張を機械的に検出し、
//   捏造・誇張を防ぐ。
//
// ★web-ios-androidキットに既にある `verify-claims-coverage.mjs` との違い:
//   あちらは `site/claims.json` という別正本にdata-claim属性を突き合わせる方式
//   （LPのclaims 9件専用）。このゲートは「<!-- 出典: --> をHTMLに直書きする」
//   規約のプロジェクト向けの別方式で、移植元(best-trust.biz)で実際に運用されている。
//
// 使い方:
//   node scripts/verify-claims-provenance.mjs
//   node scripts/verify-claims-provenance.mjs --dir public
//   node scripts/verify-claims-provenance.mjs --unit "件,%,円,回,人,社,KW,kw"
//   node scripts/verify-claims-provenance.mjs --selftest
//
// 終了コード（instrument-core の3値規約）:
//   0 = 出典欠落なし / 1 = 出典欠落あり（測れた上での赤） / 2 = 測れなかった（対象dir不在）
import fs from 'node:fs';
import path from 'node:path';
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';

// 既定の数値実績を示唆する単位。--unit で上書き可能。
// ★「年」は既定から除外している: 西暦表記（設立年・開催年）や「100年続く」のような
//   比喩に多用され誤検知が多い（移植元での実測で判明・2026-08-31）。
const DEFAULT_UNITS = ['件', '%', '円', '回', '人', '社', 'KW', 'kw'];
// 出典コメントの探索範囲（文の前後何文字以内にあれば「近傍」とみなすか）。
const DEFAULT_WINDOW = 700;

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function listHtmlFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listHtmlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * ★判定の本体（純関数・fsに触らない＝テストしやすい）。
 * @param {{ path: string, content: string }[]} files
 * @param {{ units: string[], window: number }} opts
 * @returns {import('./lib/instrument-core.mjs').ProbeResult[]}
 */
export function judgeClaimsProvenance(files, opts = {}) {
  const units = opts.units && opts.units.length ? opts.units : DEFAULT_UNITS;
  const window = opts.window || DEFAULT_WINDOW;
  const claimPattern = new RegExp(`\\d[\\d,]*\\s*(${units.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');

  if (!Array.isArray(files) || files.length === 0) {
    return [{
      probe: 'HTMLファイル存在確認',
      verdict: 'inconclusive',
      detail: '検査対象ディレクトリにHTMLファイルが見つかりません',
      howToFix: '--dir で正しい公開ディレクトリを指定してください'
    }];
  }

  const missing = [];

  for (const f of files) {
    // <head>内（meta description等）はSEO要約文であり実績の一次表明ではないため検査対象外にする。
    const bodyStart = f.content.indexOf('<body');
    const bodyContent = bodyStart >= 0 ? f.content.slice(bodyStart) : f.content;
    const bodyOffset = bodyStart >= 0 ? bodyStart : 0;

    const sourceComments = [...bodyContent.matchAll(/<!--\s*出典[:：][\s\S]*?-->/g)].map((m) => ({
      start: m.index,
      end: m.index + m[0].length
    }));

    const claimMatches = [...bodyContent.matchAll(claimPattern)];
    for (const m of claimMatches) {
      const pos = m.index;
      const hasNearbySource = sourceComments.some(
        (c) => Math.abs(c.start - pos) <= window || (pos >= c.start && pos <= c.end)
      );
      if (!hasNearbySource) {
        const lineNo = f.content.slice(0, pos + bodyOffset).split('\n').length;
        missing.push(`${f.path}:${lineNo} 「${m[0]}」`);
      }
    }
  }

  if (missing.length > 0) {
    return [{
      probe: '数値主張の出典コメント近傍性検査',
      verdict: 'fail',
      evidence: { 検査ファイル数: files.length, 出典欠落件数: missing.length },
      detail: `出典コメントの無い数値主張が検出されました: ${missing.slice(0, 10).join(' / ')}${missing.length > 10 ? ` 他${missing.length - 10}件` : ''}`,
      howToFix: `数値・実績を含む文の${window}文字以内に <!-- 出典: URL（日付） --> を追加してください`
    }];
  }

  return [{
    probe: '数値主張の出典コメント近傍性検査',
    verdict: 'pass',
    evidence: { 検査ファイル数: files.length }
  }];
}

// ── selftest（★毒→赤） ──────────────────────────────────────────────────
function selftest() {
  const goodFile = {
    path: 'public/services/index.html',
    content: '<p class="proof">累計評価100件超（ココナラ）</p>\n<!-- 出典: https://coconala.com/example（2026-08-27時点） -->'
  };

  const cases = [
    {
      name: '毒1: ファイルが存在しない（測れなかった）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeClaimsProvenance([])) === EXIT.INCONCLUSIVE
    },
    {
      name: '毒2: 出典コメントの無い数値主張が混入（赤）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const bad = { path: 'public/dummy/index.html', content: '<p class="proof">累計評価5000件超</p>' };
        return computeExitCode(judgeClaimsProvenance([bad])) === EXIT.FAIL;
      }
    },
    {
      name: '毒なし: 出典コメントが近傍にあれば緑のまま（誤検知しない）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeClaimsProvenance([goodFile])) === EXIT.PASS
    },
    {
      name: '毒3: --unitでカスタム単位（USD等）を追加した場合も検知される',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const bad = { path: 'public/dummy/index.html', content: '<p>5,000 USD in savings</p>' };
        return computeExitCode(judgeClaimsProvenance([bad], { units: ['USD'] })) === EXIT.FAIL;
      }
    },
    {
      name: '毒なし: 既定では「年」は誤検知しない（西暦・比喩表現対策）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const ok = { path: 'public/dummy/index.html', content: '<p>設立2008年、100年続くブランドを目指す</p>' };
        return computeExitCode(judgeClaimsProvenance([ok])) === EXIT.PASS;
      }
    },
  ];

  const { ok, fails } = runSelfTest(cases);
  if (!ok) {
    console.error('🔴 selftest 失敗:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log(`✅ selftest 合格（${cases.length}件: 出典欠落の検知・カスタム単位・既定除外語の誤検知なしを確認）`);
  process.exit(EXIT.PASS);
}

// ── 実行 ────────────────────────────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
  selftest();
}

const publicDir = path.resolve(process.cwd(), arg('--dir', 'public'));
const unitArg = arg('--unit', null);
const units = unitArg ? unitArg.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_UNITS;

const files = fs.existsSync(publicDir)
  ? listHtmlFiles(publicDir).map((p) => ({ path: p, content: fs.readFileSync(p, 'utf8') }))
  : [];

const results = judgeClaimsProvenance(files, { units, window: DEFAULT_WINDOW });
const code = computeExitCode(results);
console.log(formatProbeReport(results, { label: 'claims-provenance' }));
if (code === EXIT.FAIL) {
  for (const r of results.filter((x) => x.verdict === 'fail')) {
    console.error(`::error::${r.detail}`);
  }
}
process.exit(code);

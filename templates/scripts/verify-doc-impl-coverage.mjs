#!/usr/bin/env node
// doc⇔code ドリフト検証 — 「ドキュメントに『実装済み・自動化できる』と書いたのに、
// 実装がどこにも無い（または削除・改名された）」を機械的に検出するゲート。
//
// 移植元: sakkino.link/scripts/verify-doc-impl-coverage.mjs
//   （2026-08-31、council-fable「逆輸入候補」調査で発見・輸入）
//
// ★元の発見(2026-07-04、移植元プロジェクトで実際に起きた):
//   _docs/pre-submission-compliance-checklist.md が
//   PrivacyInfo.xcprivacy / Data Safety を「高（自動化できる）」と明記していたのに、
//   lint-pre-submission.mjs には対応チェックが無かった。このゲートはその再発防止。
//
// ★このキットとの相性: web-ios-androidキット自身が「9項目のゲートのうち何割が
//   各プロジェクトに実際に導入されているか」というdoc⇔codeギャップを抱えている
//   （kimito-skill.link/hub/のマトリクスで可視化した課題そのもの）。このゲートは
//   ドキュメント側の「実装できる」という主張と実コードの一致を機械的に保証する。
//
// 仕組み（YAMLフロントマターは不採用。該当行の行末に注記1個）:
//   docs内の *.md 中のHTMLコメント注記:
//     <!-- impl: <ルート相対パス>#<マーカー文字列> (任意の補足) -->
//     <!-- impl: <ルート相対パス> -->
//     <!-- impl: none (理由必須) -->        … 自動化しない判断の明示
//     <!-- impl: manual (補足任意) -->      … 手動運用の明示
//     <!-- impl: runtime (補足任意) -->     … 実機/ランタイム検証の明示
//   を全走査し:
//     RULE 1: パス形式の注記 → 参照ファイルが実在し、#マーカーがあれば
//             そのファイル内にマーカー文字列が実在すること（無ければfail）。
//     RULE 2: impl: none は理由必須（空ならfail、次の読者が同じ検討を繰り返さないため）。
//
// ★移植元にあったRULE（表の「当てはまり度：高」行にimpl注記必須、という
//   pre-submission-compliance-checklist.md固有の検査）はこの版には含めていない
//   （特定ファイル・特定の表構造にハードコードされておりこのままでは汎用性が無い。
//   同種のチェックが必要なプロジェクトは移植元スクリプトのRULE2を直接参考にすること）。
//
// 使い方:
//   node scripts/verify-doc-impl-coverage.mjs --docs-dir _docs
//   node scripts/verify-doc-impl-coverage.mjs --selftest
//
// 終了コード（instrument-core の3値規約）:
//   0 = ドリフトなし / 1 = ドリフト検出（測れた上での赤） / 2 = 測れなかった（docsDir不在）
import fs from 'node:fs';
import path from 'node:path';
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const IMPL_RE = /<!--\s*impl:\s*(\S+)([^>]*?)-->/g;

/**
 * 1ファイル分のimpl注記を検証する（純関数・fsに触らない）。
 * @param {string} relPath ルート相対パス（表示用）
 * @param {string} content ファイル本文
 * @param {(relPath: string) => boolean} fileExists 参照先の存在確認（依存注入・テスト用）
 * @param {(relPath: string) => string|null} readFileOrNull 参照先の中身取得（依存注入・テスト用）
 * @returns {{annotationCount: number, failures: {where:string, message:string}[]}}
 */
export function checkImplAnnotations(relPath, content, fileExists, readFileOrNull) {
  const stripped = content.replace(/```[\s\S]*?```/g, ''); // フェンス内は例なので走査しない
  const failures = [];
  let annotationCount = 0;

  for (const m of stripped.matchAll(IMPL_RE)) {
    annotationCount++;
    const target = m[1];
    const remainder = (m[2] || '').trim();

    if (target === 'none') {
      if (!remainder) failures.push({ where: relPath, message: 'impl: none に理由が無い。none(理由) の形式で書くこと' });
      continue;
    }
    if (target === 'manual' || target === 'runtime') continue;

    const [refPath, marker] = target.split('#');
    if (!fileExists(refPath)) {
      failures.push({ where: relPath, message: `impl 参照先が実在しない: ${refPath}` });
      continue;
    }
    if (marker) {
      const refContent = readFileOrNull(refPath);
      if (refContent === null || !refContent.includes(marker)) {
        failures.push({ where: relPath, message: `impl 参照先 ${refPath} にマーカー "${marker}" が無い(チェックが削除/改名された?)` });
      }
    }
  }

  return { annotationCount, failures };
}

/**
 * ★判定の本体（純関数・fsに触らない＝テストしやすい）。
 * @param {{ path: string, content: string }[]} docFiles
 * @param {(relPath: string) => boolean} fileExists
 * @param {(relPath: string) => string|null} readFileOrNull
 * @param {{ docsDirExists: boolean }} context
 * @returns {import('./lib/instrument-core.mjs').ProbeResult[]}
 */
export function judgeDocImplCoverage(docFiles, fileExists, readFileOrNull, context) {
  if (!context.docsDirExists) {
    return [{
      probe: 'doc⇔code drift検査',
      verdict: 'inconclusive',
      detail: 'ドキュメントディレクトリが存在しません',
      howToFix: '--docs-dir でドキュメントディレクトリを指定してください'
    }];
  }

  let totalAnnotations = 0;
  const allFailures = [];
  for (const f of docFiles) {
    const { annotationCount, failures } = checkImplAnnotations(f.path, f.content, fileExists, readFileOrNull);
    totalAnnotations += annotationCount;
    allFailures.push(...failures);
  }

  if (allFailures.length > 0) {
    return [{
      probe: 'doc⇔code drift検査',
      verdict: 'fail',
      evidence: { 検査注記数: totalAnnotations, ドリフト件数: allFailures.length },
      detail: `ドキュメントの主張と実装がズレています: ${allFailures.slice(0, 5).map((f) => `${f.where}: ${f.message}`).join(' / ')}${allFailures.length > 5 ? ` 他${allFailures.length - 5}件` : ''}`,
      howToFix: '実装したら <!-- impl: パス#チェック名 --> を追記、しない判断なら <!-- impl: none (理由) --> を追記してください'
    }];
  }

  return [{
    probe: 'doc⇔code drift検査',
    verdict: 'pass',
    evidence: { 検査注記数: totalAnnotations }
  }];
}

// ── selftest（★毒→赤） ──────────────────────────────────────────────────
function selftest() {
  const existsAll = () => true;
  const readOk = () => 'ok(check-name)';

  const cases = [
    {
      name: '毒1: docsDirが存在しない（測れなかった）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeDocImplCoverage([], existsAll, readOk, { docsDirExists: false })) === EXIT.INCONCLUSIVE
    },
    {
      name: '毒2: impl参照先ファイルが実在しない（赤）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const doc = { path: 'docs/x.md', content: '実装済み <!-- impl: scripts/missing.mjs -->' };
        return computeExitCode(judgeDocImplCoverage([doc], () => false, readOk, { docsDirExists: true })) === EXIT.FAIL;
      }
    },
    {
      name: '毒3: マーカー文字列が参照先に無い（削除/改名の疑い、赤）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const doc = { path: 'docs/x.md', content: '実装済み <!-- impl: scripts/lint.mjs#privacy-check -->' };
        return computeExitCode(judgeDocImplCoverage([doc], existsAll, () => 'no such marker here', { docsDirExists: true })) === EXIT.FAIL;
      }
    },
    {
      name: '毒4: impl:noneに理由が無い（赤）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const doc = { path: 'docs/x.md', content: '自動化しない <!-- impl: none -->' };
        return computeExitCode(judgeDocImplCoverage([doc], existsAll, readOk, { docsDirExists: true })) === EXIT.FAIL;
      }
    },
    {
      name: '毒なし: フェンス内の例は走査しない（誤検知しない）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const doc = { path: 'docs/x.md', content: '```\n<!-- impl: scripts/missing.mjs -->\n```' };
        return computeExitCode(judgeDocImplCoverage([doc], () => false, readOk, { docsDirExists: true })) === EXIT.PASS;
      }
    },
    {
      name: '毒なし: manual/runtime/理由付きnoneは全て通る（誤検知しない）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const doc = { path: 'docs/x.md', content: '<!-- impl: manual --> <!-- impl: runtime --> <!-- impl: none (対象外のため) -->' };
        return computeExitCode(judgeDocImplCoverage([doc], existsAll, readOk, { docsDirExists: true })) === EXIT.PASS;
      }
    },
  ];

  const { ok, fails } = runSelfTest(cases);
  if (!ok) {
    console.error('🔴 selftest 失敗:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log(`✅ selftest 合格（${cases.length}件: 参照欠落・マーカー欠落・理由欠落の検知とフェンス除外・正常系の誤検知なしを確認）`);
  process.exit(EXIT.PASS);
}

// ── 実行 ────────────────────────────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
  selftest();
}

const ROOT = process.cwd();
const docsDir = path.resolve(ROOT, arg('--docs-dir', '_docs'));
const docsDirExists = fs.existsSync(docsDir);

const docFiles = docsDirExists
  ? fs.readdirSync(docsDir).filter((f) => f.endsWith('.md'))
    .map((f) => {
      const abs = path.join(docsDir, f);
      return { path: path.relative(ROOT, abs), content: fs.readFileSync(abs, 'utf8') };
    })
  : [];

const fileExists = (relPath) => fs.existsSync(path.join(ROOT, relPath));
const readFileOrNull = (relPath) => {
  try { return fs.readFileSync(path.join(ROOT, relPath), 'utf8'); } catch { return null; }
};

const results = judgeDocImplCoverage(docFiles, fileExists, readFileOrNull, { docsDirExists });
const code = computeExitCode(results);
console.log(formatProbeReport(results, { label: 'doc-impl-coverage' }));
if (code === EXIT.FAIL) {
  for (const r of results.filter((x) => x.verdict === 'fail')) {
    console.error(`::error::${r.detail}`);
  }
}
process.exit(code);

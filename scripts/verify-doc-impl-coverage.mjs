#!/usr/bin/env node
// doc⇔code ドリフト検証 — 「ドキュメントに『CIで自動化できる・当てはまり度:高』と
// 書いたのに、実装がどこにも無い」を機械的に検出する(設計: _docs/doc-code-drift-verification-design.md)。
//
// 実例(2026-07-04 発見): _docs/pre-submission-compliance-checklist.md が
// PrivacyInfo.xcprivacy / Data Safety を「高」と明記していたのに、
// lint-pre-submission.mjs には対応チェックが無かった。本スクリプトはその再発防止。
//
// 仕組み(YAML フロントマターは不採用。該当行の行末に注記1個):
//   _docs/*.md の中の HTML コメント注記
//     <!-- impl: <キットルート相対パス>#<マーカー文字列> (任意の補足) -->
//     <!-- impl: <キットルート相対パス> -->
//     <!-- impl: none (理由必須) -->        … 自動化しない判断の明示
//     <!-- impl: manual (補足任意) -->      … 手動運用の明示
//     <!-- impl: runtime (補足任意) -->     … 実機/ランタイム検証の明示
//   を全走査し、
//     RULE 1: パス形式の注記 → 参照ファイルが実在し、#マーカーがあれば
//             そのファイル内にマーカー文字列が実在すること(無ければ fail)。
//             マーカーは lint-pre-submission.mjs の check name(fail/ok の第1引数)を想定。
//     RULE 2: pre-submission-compliance-checklist.md の「(A) CIで自動化できる静的チェック」
//             表で、当てはまり度セルに「高」を含む行は impl 注記必須(無ければ fail)。
//     RULE 3: impl: none は理由必須(空なら fail)。
//
// 実行: node scripts/verify-doc-impl-coverage.mjs [--docs-dir=_docs]
// exit 0 = ドリフトなし / exit 1 = ドリフト検出(fail-closed)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const docsDirArg = process.argv.find((a) => a.startsWith('--docs-dir='));
const DOCS_DIR = path.resolve(ROOT, docsDirArg ? docsDirArg.split('=')[1] : '_docs');

const ANSI_RED = '\x1b[31m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_DIM = '\x1b[2m';
const ANSI_RESET = '\x1b[0m';

const failures = [];
function fail(where, message) {
  failures.push({ where, message });
}
function ok(msg, detail) {
  console.log(`${ANSI_GREEN}✓${ANSI_RESET} ${msg}${detail ? `  ${ANSI_DIM}${detail}${ANSI_RESET}` : ''}`);
}

if (!fs.existsSync(DOCS_DIR)) {
  console.error(`docs dir not found: ${DOCS_DIR}`);
  process.exit(1);
}

const mdFiles = fs
  .readdirSync(DOCS_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => path.join(DOCS_DIR, f));

// ---------------------------------------------------------------------------
// RULE 1 + RULE 3 — 全 _docs/*.md の impl 注記を検証
// ---------------------------------------------------------------------------
const IMPL_RE = /<!--\s*impl:\s*(\S+)([^>]*?)-->/g;
let totalAnnotations = 0;
for (const file of mdFiles) {
  const rel = path.relative(ROOT, file);
  // ``` フェンス内は説明用の例なので走査しない(仮想例が false-fail するのを防ぐ)
  const content = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const m of content.matchAll(IMPL_RE)) {
    totalAnnotations += 1;
    const target = m[1];
    const remainder = (m[2] || '').trim();
    if (target === 'none') {
      // RULE 3: 自動化しない判断には理由を残す(次の AI が同じ検討を繰り返さないため)
      if (!remainder) fail(rel, 'impl: none に理由が無い。none(理由) の形式で書くこと');
      else ok(`${rel}: impl none`, remainder.slice(0, 60));
      continue;
    }
    if (target === 'manual' || target === 'runtime') {
      ok(`${rel}: impl ${target}`, remainder.slice(0, 60));
      continue;
    }
    const [relPath, marker] = target.split('#');
    const abs = path.join(ROOT, relPath);
    if (!fs.existsSync(abs)) {
      fail(rel, `impl 参照先が実在しない: ${relPath}`);
      continue;
    }
    if (marker) {
      const implContent = fs.readFileSync(abs, 'utf8');
      if (!implContent.includes(marker)) {
        fail(rel, `impl 参照先 ${relPath} にマーカー "${marker}" が無い(チェックが削除/改名された?)`);
        continue;
      }
    }
    ok(`${rel}: impl ${relPath}${marker ? `#${marker}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// RULE 2 — pre-submission-compliance-checklist.md の (A) 表:
//   当てはまり度セルに「高」を含む行は impl 注記必須。
//   (これが 2026-07-04 に実際に起きた抜け漏れの形。)
// ---------------------------------------------------------------------------
const checklistPath = path.join(DOCS_DIR, 'pre-submission-compliance-checklist.md');
if (fs.existsSync(checklistPath)) {
  const lines = fs.readFileSync(checklistPath, 'utf8').split('\n');
  let inSectionA = false;
  let checkedRows = 0;
  for (const line of lines) {
    if (/^##\s/.test(line)) inSectionA = /^##\s*\(A\)/.test(line);
    if (!inSectionA) continue;
    if (!line.trimStart().startsWith('|')) continue;
    if (/^\|[\s:-]+\|/.test(line.trim())) continue; // 区切り行
    const cells = line.split('|').map((c) => c.trim()).filter((c, i, arr) => !(i === 0 && c === '') && !(i === arr.length - 1 && c === ''));
    if (cells.length < 4) continue;
    // 4列目 = 薄殻当てはまり度(注記コメントは split で5番目以降に落ちる)
    const applicability = cells[3];
    if (!applicability.includes('高')) continue;
    checkedRows += 1;
    if (!/<!--\s*impl:/.test(line)) {
      fail(
        path.relative(ROOT, checklistPath),
        `(A) 表の「高」行に impl 注記が無い: ${cells[0].slice(0, 40)}…  ` +
          '実装したら <!-- impl: パス#チェック名 -->、しない判断なら <!-- impl: none (理由) --> を行末に付けること',
      );
    }
  }
  ok(`(A) 表の「高」行 ${checkedRows} 件を検査`);
} else {
  console.log(`${ANSI_DIM}- pre-submission-compliance-checklist.md が無い(RULE 2 skip)${ANSI_RESET}`);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
console.log('');
if (failures.length > 0) {
  console.log(`${ANSI_RED}--- doc⇔code drift (${failures.length}) ---${ANSI_RESET}`);
  for (const f of failures) console.log(`${ANSI_RED}✗${ANSI_RESET} ${f.where}: ${f.message}`);
  console.log('');
  console.log(`${ANSI_RED}verify-doc-impl-coverage failed.${ANSI_RESET} ドキュメントの主張と実装がズレている。`);
  process.exit(1);
}
console.log(`${ANSI_GREEN}doc⇔code drift なし${ANSI_RESET} (注記 ${totalAnnotations} 件を照合)`);

#!/usr/bin/env node
/**
 * context-engine.mjs — 全文脈を「出典つきの索引」にし、検証済みの学びを次回へ渡す。
 *
 * できること:
 *   node scripts/context-engine.mjs --check
 *   node scripts/context-engine.mjs --write .instrument-context.md
 *   node scripts/context-engine.mjs --record --status confirmed \
 *     --problem "何が起きたか" --decision "何を決めたか" \
 *     --evidence "file:src/x.ts:42" --outcome "実測した結果"
 *   node scripts/context-engine.mjs --selftest
 *
 * 終了コード: 0=文脈を測れた / 1=台帳や入力が壊れている / 2=測れなかった。
 * 依存は Node 標準機能だけ。秘密ファイルの本文は、追跡済みでも絶対に読み込まない。
 */
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  statSync, writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..');
const DEFAULT_LEDGER = 'scripts/context-evolution.json';
const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });
const VALID_STATUS = new Set(['confirmed', 'rejected', 'pending']);
const argv = process.argv.slice(2);

function has(flag) { return argv.includes(flag); }
function values(name) {
  const found = [];
  for (let i = 0; i < argv.length - 1; i += 1) {
    if (argv[i] === name) found.push(argv[i + 1]);
  }
  return found;
}
function value(name, fallback = null) { return values(name).at(-1) ?? fallback; }
function positionalRoot() {
  const takesValue = new Set([
    '--write', '--ledger', '--status', '--scope', '--problem', '--decision',
    '--evidence', '--outcome', '--supersedes'
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    if (takesValue.has(argv[i])) { i += 1; continue; }
    if (!argv[i].startsWith('-')) return resolve(argv[i]);
  }
  return DEFAULT_ROOT;
}

function slash(path) { return String(path).replaceAll('\\', '/'); }
function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function shortHash(hash) { return hash ? hash.slice(0, 12) : '—'; }
function oneLine(text, max = 180) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
function escapeCell(text) { return oneLine(text, 240).replaceAll('|', '\\|'); }

function git(root, args) {
  try {
    return {
      ok: true,
      out: execFileSync('git', args, {
        cwd: root, encoding: 'utf8', timeout: 30000,
        stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024
      }).trim()
    };
  } catch (error) {
    return { ok: false, out: '', error: error && error.message ? error.message : String(error) };
  }
}

function isSensitivePath(relPath) {
  const p = '/' + slash(relPath).toLowerCase();
  const name = basename(p);
  return /(^|\/)\.env($|\.)/.test(p)
    || p.endsWith('/.claude/settings.local.json')
    || /(^|\/)(\.secrets?|secrets?)([.\/-]|$)/.test(p)
    || /\.(pem|key|p12|pfx|jks|keystore|mobileprovision)$/.test(p)
    || /(^|\/)(id_rsa|id_ed25519)(\.pub)?$/.test(p)
    || ['credentials.json', 'service-account.json', '.npmrc', '.pypirc', '.netrc'].includes(name)
    || /^(secret|credentials?)[^/]*\.json$/.test(name);
}

/** gitignore 内でも、秘密候補は本文を読まず「存在」だけを数える。生成物ディレクトリは対象外。 */
function findSensitivePaths(root) {
  const found = [];
  const excludedDirs = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.vercel']);
  function walk(abs, relDir = '') {
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const relPath = slash(join(relDir, entry.name));
      if (entry.isDirectory()) {
        if (isSensitivePath(relPath + '/')) { found.push(relPath + '/'); continue; }
        if (!excludedDirs.has(entry.name)) walk(join(abs, entry.name), relPath);
      } else if (entry.isFile() && isSensitivePath(relPath)) {
        found.push(relPath);
      }
    }
  }
  walk(root);
  return [...new Set(found)].sort();
}

function looksBinary(buffer, relPath) {
  const binaryExt = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz',
    '.mp3', '.mp4', '.mov', '.woff', '.woff2', '.ttf', '.otf', '.aab', '.apk'
  ]);
  if (binaryExt.has(extname(relPath).toLowerCase())) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

function categoryOf(relPath) {
  const p = slash(relPath).toLowerCase();
  const name = basename(p);
  if (['agents.md', 'claude.md', 'instructions.md'].includes(name)) return 'instructions';
  if (p === DEFAULT_LEDGER || p.endsWith('/context-evolution.json')) return 'evolution';
  if (/(^|\/)(test|tests|__tests__|diagnostics)(\/|$)/.test(p)
    || /(^|\/)(check|verify|audit)-/.test(p)) return 'verification';
  if (p.startsWith('.github/') || p.includes('/workflows/') || p.includes('/scripts/')) return 'automation';
  if (p.startsWith('docs/') || p.startsWith('_docs/') || name.startsWith('readme') || name.endsWith('.md')) return 'knowledge';
  if (name === 'package.json' || name === 'app.config.json' || name.endsWith('.config.json')) return 'configuration';
  if (/\.(js|mjs|cjs|ts|tsx|jsx|py|cs|java|kt|swift|html|css|scss)$/.test(p)) return 'implementation';
  if (/\.(png|jpg|jpeg|gif|webp|svg|ico|mp3|mp4|woff2?|ttf|otf)$/.test(p)) return 'asset';
  return 'other';
}

function summarizeText(text, relPath) {
  const headings = [];
  const symbols = [];
  const decisions = [];
  const lines = text.split(/\r?\n/);
  const decisionPattern = /(理由|原因|決定|却下|失敗|実損|実測|教訓|地雷|限界|未解決|なぜ|because|reason|decision|reject|incident|lesson|limitation|todo|fixme)/i;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    let m = line.match(/^#{1,4}\s+(.+)/);
    if (!m) m = line.match(/<h[1-4][^>]*>(.*?)<\/h[1-4]>/i);
    if (m && headings.length < 12) headings.push(oneLine(m[1].replace(/<[^>]+>/g, ''), 100));
    const symbol = line.match(/^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/);
    if (symbol && symbols.length < 12) symbols.push(symbol[1]);
    if (decisionPattern.test(line) && decisions.length < 8) {
      decisions.push({ line: i + 1, text: oneLine(line, 180) });
    }
  }
  let title = headings[0] || '';
  if (!title && /package\.json$/i.test(relPath)) {
    try { title = JSON.parse(text).description || JSON.parse(text).name || ''; } catch { /* shape check handles JSON elsewhere */ }
  }
  return { lines: lines.length, title, headings, symbols, decisions };
}

function inspectFile(root, relPath, tracked = true) {
  const abs = join(root, relPath);
  const base = { path: slash(relPath), category: categoryOf(relPath), tracked };
  if (!existsSync(abs)) return { ...base, kind: 'missing', bytes: null, hash: null };
  if (isSensitivePath(relPath)) {
    return { ...base, kind: 'sensitive', bytes: statSync(abs).size, hash: null };
  }
  try {
    const buffer = readFileSync(abs);
    const hash = sha256(buffer);
    if (looksBinary(buffer, relPath)) return { ...base, kind: 'binary', bytes: buffer.length, hash };
    const text = buffer.toString('utf8');
    return { ...base, kind: 'text', bytes: buffer.length, hash, ...summarizeText(text, relPath) };
  } catch (error) {
    return { ...base, kind: 'unreadable', bytes: null, hash: null, error: oneLine(error.message) };
  }
}

function parseCommits(raw) {
  if (!raw) return [];
  return raw.split('\x1e').map((record) => record.trim()).filter(Boolean).map((record) => {
    const [hash = '', date = '', subject = ''] = record.split('\x1f');
    return { hash, date, subject };
  });
}

function readLedger(root, ledgerRel = DEFAULT_LEDGER) {
  const abs = join(root, ledgerRel);
  if (!existsSync(abs)) return { exists: false, rows: [], error: null, path: slash(ledgerRel) };
  try {
    const parsed = JSON.parse(readFileSync(abs, 'utf8'));
    if (!Array.isArray(parsed)) return { exists: true, rows: [], error: '台帳の最上位は配列である必要があります', path: slash(ledgerRel) };
    return { exists: true, rows: parsed, error: null, path: slash(ledgerRel) };
  } catch (error) {
    return { exists: true, rows: [], error: 'JSONとして読めません: ' + oneLine(error.message), path: slash(ledgerRel) };
  }
}

function validateLedger(root, ledger) {
  const errors = [];
  const warnings = [];
  const ids = new Set();
  if (ledger.error) errors.push(ledger.error);
  for (let i = 0; i < ledger.rows.length; i += 1) {
    const row = ledger.rows[i];
    const at = `台帳[${i}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) { errors.push(`${at} がオブジェクトではありません`); continue; }
    if (!row.id || typeof row.id !== 'string') errors.push(`${at} に id がありません`);
    else if (ids.has(row.id)) errors.push(`${at} の id が重複しています: ${row.id}`);
    else ids.add(row.id);
    if (!VALID_STATUS.has(row.status)) errors.push(`${at} の status が不正です: ${row.status}`);
    for (const key of ['problem', 'decision', 'outcome']) {
      if (!row[key] || !String(row[key]).trim()) errors.push(`${at} に ${key} がありません`);
    }
    const evidence = Array.isArray(row.evidence) ? row.evidence : [];
    if (row.status !== 'pending' && evidence.length === 0) errors.push(`${at} は ${row.status} なのに evidence がありません`);
    for (const ev of evidence) {
      if (typeof ev !== 'string' || !ev.trim()) { errors.push(`${at} に空の evidence があります`); continue; }
      if (ev.startsWith('file:')) {
        const ref = ev.slice(5).replace(/:\d+$/, '');
        if (!existsSync(join(root, ref))) errors.push(`${at} の証拠ファイルがありません: ${ref}`);
      } else if (ev.startsWith('commit:')) {
        const sha = ev.slice(7);
        if (!git(root, ['cat-file', '-e', sha + '^{commit}']).ok) errors.push(`${at} の証拠コミットがありません: ${sha}`);
      } else if (!/^(command|measurement|url):/.test(ev)) {
        warnings.push(`${at} の evidence は種類を明示してください: ${ev}`);
      }
    }
    const supersedes = Array.isArray(row.supersedes) ? row.supersedes : [];
    for (const oldId of supersedes) if (oldId === row.id) errors.push(`${at} は自分自身を supersedes できません`);
  }
  for (const row of ledger.rows) {
    for (const oldId of Array.isArray(row.supersedes) ? row.supersedes : []) {
      if (!ids.has(oldId)) errors.push(`${row.id} が存在しない記録を supersedes しています: ${oldId}`);
    }
  }
  return { errors, warnings };
}

function collectContext(root, ledgerRel = DEFAULT_LEDGER) {
  const trackedResult = git(root, ['ls-files', '-z']);
  const tracked = trackedResult.ok ? trackedResult.out.split('\0').filter(Boolean).sort() : [];
  const untrackedResult = git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  const untracked = untrackedResult.ok ? untrackedResult.out.split('\0').filter(Boolean).sort() : [];
  const sourcePaths = new Set([...tracked, ...untracked].map(slash));
  const ignoredSensitive = findSensitivePaths(root).filter((p) => !sourcePaths.has(p));
  const files = [
    ...tracked.map((p) => inspectFile(root, p, true)),
    ...untracked.map((p) => inspectFile(root, p, false)),
    ...ignoredSensitive.map((p) => ({
      path: p, category: 'other', tracked: false, ignored: true,
      kind: 'sensitive', bytes: null, hash: null
    }))
  ].sort((a, b) => a.path.localeCompare(b.path));
  const statusResult = git(root, ['status', '--short', '--untracked-files=all']);
  const headResult = git(root, ['rev-parse', 'HEAD']);
  const branchResult = git(root, ['branch', '--show-current']);
  const commitsResult = git(root, ['log', '--all', '--date=iso-strict', '--pretty=format:%H%x1f%ad%x1f%s%x1e']);
  const diffStat = git(root, ['diff', '--stat', '--no-ext-diff']);
  const stagedStat = git(root, ['diff', '--cached', '--stat', '--no-ext-diff']);
  const ledger = readLedger(root, ledgerRel);
  const ledgerValidation = validateLedger(root, ledger);
  const kinds = Object.fromEntries(['text', 'binary', 'sensitive', 'missing', 'unreadable'].map((k) => [k, files.filter((f) => f.kind === k).length]));
  const categories = {};
  for (const file of files) categories[file.category] = (categories[file.category] || 0) + 1;
  let packageScripts = {};
  const packagePath = join(root, 'package.json');
  if (existsSync(packagePath) && !isSensitivePath('package.json')) {
    try { packageScripts = JSON.parse(readFileSync(packagePath, 'utf8')).scripts || {}; } catch { /* ledger/check output states malformed configs elsewhere */ }
  }
  const problems = [];
  const inconclusive = [];
  if (!trackedResult.ok) inconclusive.push('git ls-files を実行できず、追跡ファイルを数えられませんでした');
  if (!headResult.ok) inconclusive.push('Git HEAD を読めませんでした');
  if (!commitsResult.ok) inconclusive.push('Git履歴を読めませんでした');
  if (!ledger.exists) inconclusive.push(`${ledger.path} が無く、検証済みの学びを次回へ渡せません`);
  if (files.some((f) => f.kind === 'unreadable')) inconclusive.push('読めない追跡ファイルがあります');
  problems.push(...ledgerValidation.errors);
  return {
    generatedAt: new Date().toISOString(), root: slash(root), head: headResult.ok ? headResult.out : null,
    branch: branchResult.ok ? branchResult.out : null, status: statusResult.ok ? statusResult.out.split(/\r?\n/).filter(Boolean) : [],
    diffStat: diffStat.ok ? diffStat.out : '', stagedStat: stagedStat.ok ? stagedStat.out : '',
    files, trackedCount: tracked.length, untrackedCount: untracked.length,
    ignoredSensitiveCount: ignoredSensitive.length, kinds, categories,
    commits: parseCommits(commitsResult.out), packageScripts, ledger, ledgerValidation,
    problems, inconclusive
  };
}

function activeRows(rows) {
  const superseded = new Set(rows.flatMap((r) => Array.isArray(r.supersedes) ? r.supersedes : []));
  return rows.filter((r) => !superseded.has(r.id));
}

function renderRows(rows) {
  if (!rows.length) return '（まだありません）\n';
  return rows.map((r) => [
    `### ${r.status === 'confirmed' ? '✅' : r.status === 'rejected' ? '🛑' : '🟡'} ${r.problem}`,
    '', `- 判断: ${r.decision}`, `- 結果: ${r.outcome}`,
    `- 証拠: ${(r.evidence || []).join(' / ') || '未測定'}`,
    `- 記録: ${r.recordedAt || '—'} / ${r.version || '版不明'} / ${r.id}`, ''
  ].join('\n')).join('\n');
}

function renderReport(ctx) {
  const active = activeRows(ctx.ledger.rows);
  const priority = ctx.files.filter((f) => ['instructions', 'evolution'].includes(f.category)
    || ['package.json', 'app.config.json', '_docs/instruments/README.md'].includes(f.path));
  const decisionFiles = ctx.files.filter((f) => f.decisions && f.decisions.length);
  const lines = [
    '# 計器・全文脈パケット', '',
    `> 生成: ${ctx.generatedAt}  /  HEAD: ${ctx.head ? ctx.head.slice(0, 12) : '測定不能'}  /  branch: ${ctx.branch || '—'}`,
    '> これは「AIが全部知った」という宣言ではありません。リポジトリ内で取得可能な文脈を全件数え、出典へ戻れる索引にしたものです。', '',
    '## 1. 文脈の網羅性', '',
    `- Git追跡ファイル: **${ctx.trackedCount}件を全件計上**`,
    `- Gitが表示する未追跡ファイル（ignore対象外）: **${ctx.untrackedCount}件も計上**`,
    `- ignore対象内で見つけた秘密候補: **${ctx.ignoredSensitiveCount}件を存在だけ計上**`,
    `- 本文を読んだテキスト: ${ctx.kinds.text}件`,
    `- バイナリ（名前・ハッシュのみ）: ${ctx.kinds.binary}件`,
    `- 秘密候補（本文もハッシュも読まない）: ${ctx.kinds.sensitive}件`,
    `- 削除中: ${ctx.kinds.missing}件 / 読み取り不能: ${ctx.kinds.unreadable}件`,
    `- Gitコミット件名: ${ctx.commits.length}件（全履歴）`,
    `- 進化台帳: ${ctx.ledger.rows.length}件`, '',
    '### 最初に読む出典', ''
  ];
  if (priority.length) for (const f of priority) lines.push(`- \`${f.path}\` — ${f.title || f.category}`);
  else lines.push('- 指示書・台帳の候補は見つかりませんでした。');
  lines.push('', '## 2. いま作業中の状態', '');
  lines.push(ctx.status.length ? '```text\n' + ctx.status.join('\n') + '\n```' : '作業ツリーはクリーンです。');
  if (ctx.diffStat) lines.push('', '未ステージ差分:', '```text', ctx.diffStat, '```');
  if (ctx.stagedStat) lines.push('', 'ステージ済み差分:', '```text', ctx.stagedStat, '```');
  lines.push('', '## 3. 次回も守る、検証済みの判断', '', renderRows(active.filter((r) => r.status === 'confirmed')),
    '## 4. もう繰り返さない、実測で却下した案', '', renderRows(active.filter((r) => r.status === 'rejected')),
    '## 5. まだ結論にしない項目', '', renderRows(active.filter((r) => r.status === 'pending')),
    '## 6. 説明書・コード内の判断根拠索引', '');
  if (!decisionFiles.length) lines.push('判断根拠の語を含むテキストはありませんでした。');
  for (const file of decisionFiles) {
    lines.push(`### \`${file.path}\``);
    for (const d of file.decisions) lines.push(`- L${d.line}: ${d.text}`);
    lines.push('');
  }
  lines.push('## 7. 実行できる入口', '');
  const scripts = Object.entries(ctx.packageScripts);
  if (!scripts.length) lines.push('package.json scripts はありません。');
  else for (const [name, command] of scripts) lines.push(`- \`npm run ${name}\` → \`${command}\``);
  lines.push('', '## 8. 全ファイルの出典地図', '', '| 状態 | 分類 | 種類 | パス | hash | 内容の入口 |', '|---|---|---|---|---|---|');
  for (const f of ctx.files) {
    const entry = f.title || (f.headings || []).slice(0, 3).join(' / ') || (f.symbols || []).slice(0, 5).join(', ');
    lines.push(`| ${f.tracked ? '追跡' : f.ignored ? 'ignore内' : '未追跡'} | ${f.category} | ${f.kind} | \`${f.path}\` | ${shortHash(f.hash)} | ${escapeCell(entry)} |`);
  }
  lines.push('', '## 9. Git全履歴（コミット件名）', '');
  if (!ctx.commits.length) lines.push('履歴を測れませんでした。');
  else for (const c of ctx.commits) lines.push(`- ${c.date.slice(0, 10)} \`${c.hash.slice(0, 10)}\` ${c.subject}`);
  lines.push('', '## 10. このパケットの限界', '',
    '- 会話だけにあり、ファイル・コミット・台帳へ書かれていない判断は取得できません。重要な結果は `--record` で証拠付き台帳へ戻してください。',
    '- 外部サービスの現在値、実機の状態、秘密ファイルの本文は取得しません。取得していないものを「正常」に数えません。',
    '- ファイル地図は全件を計上しますが、本文の複製ではありません。詳しい文脈は必ず記載パスの原文へ戻って確認します。',
    '- `pending` は仮説です。証拠が付くまで確定知識として扱いません。', '');
  if (ctx.problems.length || ctx.inconclusive.length || ctx.ledgerValidation.warnings.length) {
    lines.push('## 11. 測定時の注意', '');
    for (const p of ctx.problems) lines.push(`- 🔴 ${p}`);
    for (const p of ctx.inconclusive) lines.push(`- 🟡 ${p}`);
    for (const p of ctx.ledgerValidation.warnings) lines.push(`- ⚪ ${p}`);
  }
  return lines.join('\n') + '\n';
}

function verdict(ctx) {
  if (ctx.problems.length) return EXIT.FAIL;
  if (ctx.inconclusive.length) return EXIT.INCONCLUSIVE;
  return EXIT.PASS;
}

function printCheck(ctx) {
  const code = verdict(ctx);
  const mark = code === EXIT.PASS ? '✅' : code === EXIT.FAIL ? '🔴' : '🟡';
  console.log(`[context-engine] ${mark} 文脈 ${ctx.files.length}件を計上（追跡 ${ctx.trackedCount} / 未追跡 ${ctx.untrackedCount} / ignore内秘密候補 ${ctx.ignoredSensitiveCount}）`);
  console.log(`  根拠: text=${ctx.kinds.text}, binary=${ctx.kinds.binary}, sensitive=${ctx.kinds.sensitive}, commits=${ctx.commits.length}, ledger=${ctx.ledger.rows.length}`);
  console.log(`  現在地: ${ctx.head ? ctx.head.slice(0, 12) : '測定不能'} / 変更 ${ctx.status.length}件`);
  for (const p of ctx.problems) console.log('  🔴 ' + p);
  for (const p of ctx.inconclusive) console.log('  🟡 ' + p);
  for (const p of ctx.ledgerValidation.warnings) console.log('  ⚪ ' + p);
  console.log('  → 限界: 会話だけの判断・外部サービス・実機・秘密本文は自動取得しません');
}

function recordEvolution(root, ledgerRel) {
  const status = value('--status', 'pending');
  const evidence = values('--evidence');
  const supersedes = values('--supersedes');
  const now = new Date();
  let version = null;
  try { version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version || null; } catch { /* optional */ }
  const row = {
    id: now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + createHash('sha1').update(value('--problem', '') + value('--decision', '')).digest('hex').slice(0, 8),
    recordedAt: now.toISOString(), version, scope: value('--scope', 'repository'), status,
    problem: value('--problem', ''), decision: value('--decision', ''), evidence,
    outcome: value('--outcome', ''), supersedes
  };
  const ledger = readLedger(root, ledgerRel);
  if (!ledger.exists) { ledger.exists = true; ledger.rows = []; ledger.error = null; }
  ledger.rows.push(row);
  const checked = validateLedger(root, ledger);
  if (checked.errors.length) {
    console.error('[context-engine] 記録できません:');
    for (const error of checked.errors) console.error('  - ' + error);
    return EXIT.FAIL;
  }
  const abs = join(root, ledgerRel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(ledger.rows, null, 2) + '\n');
  console.log(`[context-engine] ✅ 学びを記録: ${row.id} (${status})`);
  return EXIT.PASS;
}

function runSelfTest() {
  const root = mkdtempSync(join(tmpdir(), 'context-engine-'));
  const fails = [];
  const runGit = (args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  try {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'AGENTS.md'), '# 指示\n\n理由: 証拠を見る。\n');
    writeFileSync(join(root, 'package.json'), '{"name":"selftest","version":"1.0.0","scripts":{"test":"node x"}}\n');
    writeFileSync(join(root, 'asset.bin'), Buffer.from([0, 1, 2, 3]));
    writeFileSync(join(root, '.env.local'), 'SECRET=do-not-read\n');
    writeFileSync(join(root, DEFAULT_LEDGER), JSON.stringify([{
      id: 'rejected-old', recordedAt: '2026-01-01T00:00:00.000Z', version: '1.0.0', scope: 'test',
      status: 'rejected', problem: '古い案', decision: '使わない', evidence: ['file:AGENTS.md:1'], outcome: '毒で赤を確認', supersedes: []
    }], null, 2));
    runGit(['init']);
    runGit(['add', '-f', '.']);
    runGit([
      '-c', 'user.name=context-selftest', '-c', 'user.email=context@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '-m', 'initial'
    ]);
    const ctx = collectContext(root);
    if (ctx.files.length !== ctx.trackedCount || ctx.trackedCount !== 5) fails.push('全追跡ファイルを計上できない');
    if (ctx.kinds.binary !== 1) fails.push('バイナリを本文として読んだ');
    if (ctx.kinds.sensitive !== 1) fails.push('秘密候補を隔離できない');
    if (ctx.commits.length !== 1) fails.push('Git履歴を収集できない');
    if (!renderReport(ctx).includes('もう繰り返さない') || !renderReport(ctx).includes('古い案')) fails.push('却下した知見を次回へ渡せない');
    const poisoned = { ...ctx.ledger, rows: [{
      id: 'bad', status: 'confirmed', problem: 'p', decision: 'd', outcome: 'o', evidence: [], supersedes: []
    }] };
    if (validateLedger(root, poisoned).errors.length === 0) fails.push('証拠なしの確定知識を拒否できない');
    const missingEvidence = { ...ctx.ledger, rows: [{
      id: 'bad2', status: 'rejected', problem: 'p', decision: 'd', outcome: 'o', evidence: ['file:nope.md'], supersedes: []
    }] };
    if (!validateLedger(root, missingEvidence).errors.some((e) => e.includes('証拠ファイル'))) fails.push('存在しない証拠を拒否できない');
  } catch (error) {
    fails.push('selftest 自体が例外: ' + oneLine(error.message));
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  if (fails.length) {
    console.error('[context-engine] selftest 失敗:');
    for (const fail of fails) console.error('  - ' + fail);
    return EXIT.FAIL;
  }
  console.log('[context-engine] selftest OK（全件計上 / 秘密隔離 / 全履歴 / 証拠なし知識を拒否 / 却下案を継承）');
  return EXIT.PASS;
}

if (has('--selftest')) process.exit(runSelfTest());

const root = positionalRoot();
const ledgerRel = slash(value('--ledger', DEFAULT_LEDGER));
if (has('--record')) process.exit(recordEvolution(root, ledgerRel));

const ctx = collectContext(root, ledgerRel);
const report = renderReport(ctx);
if (has('--json')) console.log(JSON.stringify(ctx, null, 2));
const writeTarget = value('--write');
if (writeTarget) {
  const abs = resolve(root, writeTarget);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, report);
  console.log(`[context-engine] 文脈パケットを書きました: ${slash(relative(root, abs))}`);
}
if (has('--check') || (!has('--json') && !writeTarget)) printCheck(ctx);
process.exit(verdict(ctx));

#!/usr/bin/env node
/**
 * check-unrequested-removal.mjs — ★AIの修正で「頼まれていない機能」が消えるのを機械で止める（配布用）。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ なぜ要るか（2026-11-14 りんく「これがおこらないようにして」「サイト全体で」）
 *
 *   「AIにバグを直してと頼むと、自信満々で出したコードで、元々動いていた別の機能が
 *   3つ消えた（ログイン・検索・設定）」という話が広く共有されていた。
 *   AI は直す対象のファイルを丸ごと書き直しがちで、そのとき関係ない部分を落とす。
 *   本人は「直った」の報告しか見ないので、消えたことに気づくのは利用者が先になる。
 *
 *   ★「最小の変更にする」「関係ない所は触らない」を文章で書いても、書き直す瞬間には読まれない。
 *   ⟹ 差分の中から「消えたもの」を拾い、**頼まれた削除だと書いてあるものだけ**通す。
 *
 * ■ 何を「消えた」とみなすか（差分にある事実だけ）
 *   1. ファイル: コード・画面・テストのファイルが消えた（名前の変更は除く）
 *   2. テスト: it()/test()/describe() が消えた、または .skip/.only/xit で止めた
 *   3. 公開している関数・部品: export function X 等が消え、差分のどこにも出直していない
 *   4. 画面の目印: data-testid / id / 内部リンク(href="/...") / ルート(path: '/...') が消え、出直していない
 *   5. 大きな削除: 1ファイルで 80 行以上消し、足した行の 3 倍より多い（丸ごと書き直して落とした形）
 *   6. 機能台帳（features.json）に書いた目印の文字列を含む行が消えた
 *
 * ■ 通し方（頼まれた削除なら）
 *   コミットメッセージか PR 本文に、消したものの名前を1行ずつ書く:
 *     消してよい: LoginButton（理由: 新しいログイン画面に置き換えたため）
 *   `消してよい:` / `削除OK:` / `Removes:` のどれでもよい。名前・ファイル名・パスのどれかが入っていれば通る。
 *   ★まとめて全部を通す書き方は用意していない（それはただの抜け道になる）。
 *
 * ■ ★この検査が判定しないこと（過信を防ぐ）
 *   ・消した後も**動くか**は見ない。それはテスト・features.json の smoke・E2E の仕事。
 *   ・**書き換えて壊した**（消さずに中身を変えた）ものは拾えない。それもテストの仕事。
 *   ・名前の一致しか見ない。別名で出直したものは「消えた」と出る（宣言すれば通る）。
 *   ・宣言の理由が本当かは見ない。書いた事実が履歴に残る、までが限界。
 *
 * ■ 使い方
 *   node check-unrequested-removal.mjs [対象ディレクトリ]            # 既定ブランチとの差分（なければ直前のコミット）
 *   node check-unrequested-removal.mjs . --base origin/main          # 比べる相手を指定
 *   node check-unrequested-removal.mjs . --staged --message "..."    # コミット前（hook が使う）
 *   node check-unrequested-removal.mjs . --declare-env PR_BODY       # CI: PR 本文を宣言として読む
 *   node check-unrequested-removal.mjs --selftest
 *
 * ■ 終了コード
 *   0 = 消えたもの無し、または全部宣言あり / 1 = 宣言の無い削除がある / 2 = ★測れなかった（緑ではない）
 * ───────────────────────────────────────────────────────────────────────────
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });

/** 消えたら困る「コード・画面」の拡張子。文書・設定・画像は対象外（消してもアプリの機能は消えない）。 */
const CODE_EXT = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte', '.astro',
  '.html', '.htm', '.php', '.py', '.rb', '.go', '.rs', '.swift', '.kt', '.java', '.dart', '.ahk',
]);
/** 生成物・依存の置き場。ここが消えても機能は消えない。 */
const SKIP_PATH_RE = /(^|\/)(node_modules|dist|build|\.next|\.expo|coverage|vendor|\.vercel|\.turbo|out)\//;
const TEST_FILE_RE = /(\.|_)(test|spec)\.[cm]?[jt]sx?$|(^|\/)(__tests__|tests?|e2e)\//;

export const LARGE_DELETION = Object.freeze({ minDeleted: 80, ratio: 3 });

/** 宣言の行。`消してよい: 名前（理由）` */
export const DECLARE_RE = /^\s*[-*>]?\s*(消してよい|削除OK|削除ok|removes?|removed-ok)\s*[:：]\s*(.+)$/gim;

// ── 差分の読み取り ────────────────────────────────────────────────────────

/**
 * `git diff -M --unified=0` の出力をファイルごとに分ける。
 * @param {string} text
 * @returns {Array<{path:string, oldPath:string, status:'A'|'D'|'M'|'R', added:string[], removed:string[]}>}
 */
export function parseUnifiedDiff(text) {
  const files = [];
  let cur = null;
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      cur = { path: m ? m[2] : '', oldPath: m ? m[1] : '', status: 'M', added: [], removed: [] };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('new file mode')) { cur.status = 'A'; continue; }
    if (line.startsWith('deleted file mode')) { cur.status = 'D'; continue; }
    if (line.startsWith('rename from ')) { cur.status = 'R'; cur.oldPath = line.slice(12); continue; }
    if (line.startsWith('rename to ')) { cur.path = line.slice(10); continue; }
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('@@')) continue;
    if (line.startsWith('Binary files')) continue;
    if (line.startsWith('+')) cur.added.push(line.slice(1));
    else if (line.startsWith('-')) cur.removed.push(line.slice(1));
  }
  return files.filter((f) => f.path);
}

/** 宣言の行を集める（名前を探す相手）。 */
export function parseDeclarations(text) {
  const out = [];
  const s = String(text || '');
  DECLARE_RE.lastIndex = 0;
  let m;
  while ((m = DECLARE_RE.exec(s)) !== null) out.push(m[2].trim());
  return out;
}

// ── 消えたものを拾う ──────────────────────────────────────────────────────

const TEST_CASE_RE = /^\s*(?:it|test|describe|context)(?:\.\w+)?\s*\(\s*(['"`])(.+?)\1/;
const SKIPPED_RE = /^\s*(?:(?:it|test|describe|context)\.(?:skip|only|todo)|x(?:it|test|describe)|f(?:it|describe))\s*\(\s*(['"`])(.+?)\1/;
const EXPORT_RE = /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/;
const PY_DEF_RE = /^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/;
const ANCHOR_RES = [
  { kind: 'data-testid', re: /data-testid\s*=\s*\{?\s*["'`]([^"'`]+)["'`]/g },
  { kind: 'id', re: /\sid\s*=\s*["']([A-Za-z][\w:-]*)["']/g },
  { kind: '内部リンク', re: /href\s*=\s*\{?\s*["'`](\/[^"'`#?\s]*)["'`]/g },
  { kind: 'ルート', re: /\bpath\s*[:=]\s*\{?\s*["'`](\/[^"'`\s]*)["'`]/g },
];

function isCodeFile(p) {
  if (SKIP_PATH_RE.test(p)) return false;
  return CODE_EXT.has(extname(p).toLowerCase());
}

function collect(re, lines) {
  const set = new Set();
  for (const l of lines) {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = r.exec(l)) !== null) set.add(m[m.length - 1]);
  }
  return set;
}

/**
 * 差分から「消えたもの」を拾う（宣言はまだ見ない）。
 * @param {ReturnType<typeof parseUnifiedDiff>} files
 * @param {{anchors?: Array<{feature:string, contains:string}>}} [opts]
 * @returns {Array<{kind:string, name:string, file:string, keys:string[]}>}
 */
export function findRemovals(files, opts = {}) {
  const list = Array.isArray(files) ? files : [];
  const allAdded = list.flatMap((f) => f.added);
  const addedText = allAdded.join('\n');
  const items = [];
  const push = (kind, name, file, extraKeys = []) => {
    const keys = [name, file, basename(file), ...extraKeys].filter(Boolean);
    if (!items.some((i) => i.kind === kind && i.name === name && i.file === file)) items.push({ kind, name, file, keys });
  };

  for (const f of list) {
    const code = isCodeFile(f.path) || isCodeFile(f.oldPath);
    if (!code) continue;

    // 1. ファイルが消えた
    if (f.status === 'D') {
      push(TEST_FILE_RE.test(f.path) ? 'テストのファイル' : 'ファイル', f.path, f.path);
      continue; // 中身の行は「ファイルが消えた」に含める
    }

    // 2. テストが消えた / 止めた
    const addedTitles = collect(TEST_CASE_RE, f.added);
    for (const t of collect(TEST_CASE_RE, f.removed)) {
      if (!addedTitles.has(t) && !addedText.includes(t)) push('テスト', t, f.path);
    }
    for (const t of collect(SKIPPED_RE, f.added)) push('止めたテスト(.skip/.only/xit)', t, f.path);

    // 3. 公開している関数・部品
    const reRe = f.path.endsWith('.py') ? PY_DEF_RE : EXPORT_RE;
    for (const name of collect(reRe, f.removed)) {
      const back = new RegExp(`(export[^\\n]*\\b${name}\\b|\\b(def|class|function)\\s+${name}\\b|\\b${name}\\s*[,}])`);
      if (!back.test(addedText)) push('公開している関数・部品', name, f.path);
    }

    // 4. 画面の目印
    for (const { kind, re } of ANCHOR_RES) {
      const before = collect(re, f.removed);
      if (before.size === 0) continue;
      const after = collect(re, allAdded);
      for (const a of before) if (!after.has(a)) push(`画面の目印(${kind})`, a, f.path);
    }

    // 5. 大きな削除
    const d = f.removed.length;
    const a = f.added.length;
    if (d >= LARGE_DELETION.minDeleted && d > a * LARGE_DELETION.ratio) {
      push('大きな削除', `${f.path} (-${d}/+${a})`, f.path);
    }
  }

  // 6. 機能台帳の目印（拡張子を問わない）
  for (const { feature, contains } of opts.anchors || []) {
    if (!contains) continue;
    for (const f of list) {
      const gone = f.removed.some((l) => l.includes(contains)) && !allAdded.some((l) => l.includes(contains));
      if (gone) push('機能台帳の目印', `${feature}: ${contains}`, f.path, [feature, contains]);
    }
  }
  return items;
}

/**
 * 宣言と照らして、通らないものだけ返す。
 * @param {ReturnType<typeof findRemovals>} items
 * @param {string[]} declarations
 */
export function judge(items, declarations) {
  const decl = (declarations || []).map((d) => d.toLowerCase());
  const undeclared = [];
  const declared = [];
  for (const it of items || []) {
    const hit = it.keys.some((k) => {
      const key = String(k).toLowerCase();
      return key.length >= 2 && decl.some((d) => d.includes(key));
    });
    (hit ? declared : undeclared).push(it);
  }
  return { undeclared, declared, exit: undeclared.length ? EXIT.FAIL : EXIT.PASS };
}

/** 機能台帳（features.json）の目印を読む。無ければ空。 */
export function loadFeatureAnchors(root) {
  const p = join(root, 'features.json');
  if (!existsSync(p)) return [];
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    const out = [];
    for (const f of Array.isArray(j.features) ? j.features : []) {
      for (const a of Array.isArray(f.anchors) ? f.anchors : []) {
        if (a && typeof a.contains === 'string') out.push({ feature: String(f.name || ''), contains: a.contains });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** 人（AI）に向けた結果の文。 */
export function formatReport(result) {
  const lines = [];
  if (result.undeclared.length === 0) {
    lines.push(`[check-unrequested-removal] ✅ 頼まれていない削除はありません（消えたもの ${result.declared.length} 件はすべて宣言あり）`);
    return lines.join('\n');
  }
  lines.push(`[check-unrequested-removal] ❌ 宣言の無い削除が ${result.undeclared.length} 件あります（元々あった機能が消えていないか）:`);
  for (const it of result.undeclared) lines.push(`  - ${it.kind}: ${it.name}${it.file && it.file !== it.name ? `  （${it.file}）` : ''}`);
  lines.push('');
  lines.push('  ★頼まれていない削除なら、元に戻す（直す範囲だけを変える）。');
  lines.push('  ★頼まれた削除なら、コミットメッセージか PR 本文に1件ずつ書く:');
  lines.push(`    消してよい: ${result.undeclared[0].name}（理由: …）`);
  lines.push('  正本: docs/ai-rules/11_NO_REGRESSION.md');
  return lines.join('\n');
}

// ── git ───────────────────────────────────────────────────────────────────

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

/** 比べる相手を決める。既定ブランチとの分かれ目 → 無ければ直前のコミット。 */
export function resolveBase(root, explicit) {
  if (explicit) return git(root, ['merge-base', explicit, 'HEAD']).trim();
  const candidates = [];
  try {
    const head = git(root, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']).trim();
    if (head) candidates.push(head.replace('refs/remotes/', ''));
  } catch { /* 無い */ }
  candidates.push('origin/main', 'origin/master', 'main', 'master');
  for (const c of candidates) {
    try {
      const mb = git(root, ['merge-base', c, 'HEAD']).trim();
      const head = git(root, ['rev-parse', 'HEAD']).trim();
      if (mb && mb !== head) return mb;
    } catch { /* 次 */ }
  }
  return git(root, ['rev-parse', 'HEAD~1']).trim();
}

/**
 * @param {{root:string, base?:string, staged?:boolean, workingTree?:boolean, message?:string, declareEnv?:string}} o
 *   staged      … コミット前に、ステージした分だけを見る（git commit）
 *   workingTree … コミット前に、ステージしていない変更も含めて見る（git commit -a）
 */
export function run(o) {
  const root = o.root || '.';
  let diff;
  let declText = String(o.message || '');
  try {
    if (o.workingTree) {
      diff = git(root, ['diff', 'HEAD', '-M', '--unified=0', '--no-color']);
    } else if (o.staged) {
      diff = git(root, ['diff', '--cached', '-M', '--unified=0', '--no-color']);
    } else {
      const base = resolveBase(root, o.base);
      diff = git(root, ['diff', '-M', '--unified=0', '--no-color', `${base}...HEAD`]);
      declText += '\n' + git(root, ['log', '--format=%B', `${base}..HEAD`]);
    }
  } catch (e) {
    return { exit: EXIT.INCONCLUSIVE, text: `[check-unrequested-removal] 🟡 測れませんでした（git の差分が取れない: ${e.message.split('\n')[0]}）` };
  }
  if (o.declareEnv && process.env[o.declareEnv]) declText += '\n' + process.env[o.declareEnv];
  const items = findRemovals(parseUnifiedDiff(diff), { anchors: loadFeatureAnchors(root) });
  const result = judge(items, parseDeclarations(declText));
  return { exit: result.exit, text: formatReport(result), result };
}

// ── selftest（★毒→赤） ──────────────────────────────────────────────────

function mkDiff(path, removed, added, status = 'M') {
  const head = [`diff --git a/${path} b/${path}`];
  if (status === 'D') head.push('deleted file mode 100644');
  if (status === 'A') head.push('new file mode 100644');
  head.push(`--- a/${path}`, `+++ b/${path}`, '@@ -1 +1 @@');
  return [...head, ...removed.map((l) => '-' + l), ...added.map((l) => '+' + l)].join('\n');
}

export function runSelftest() {
  const big = Array.from({ length: 120 }, (_, i) => `  line${i}();`);
  const cases = [
    {
      name: '★ログイン・検索・設定のボタンが消えたら赤（あの絵の事故）',
      ok: () => {
        const d = mkDiff('src/Header.tsx',
          ['<button data-testid="login">ログイン</button>', '<a href="/search">検索</a>', '<a href="/settings">設定</a>'],
          ['<button data-testid="fix">直した</button>']);
        const r = judge(findRemovals(parseUnifiedDiff(d)), []);
        return r.exit === EXIT.FAIL && r.undeclared.length === 3;
      },
    },
    {
      name: '宣言があれば通す（名前で照合）',
      ok: () => {
        const d = mkDiff('src/Header.tsx', ['<a href="/settings">設定</a>'], []);
        return judge(findRemovals(parseUnifiedDiff(d)), parseDeclarations('fix: x\n\n消してよい: /settings（理由: 設定はメニューへ移した）')).exit === EXIT.PASS;
      },
    },
    {
      name: '★まとめて通す書き方は効かない（無関係な宣言では通らない）',
      ok: () => {
        const d = mkDiff('src/Header.tsx', ['<a href="/settings">設定</a>'], []);
        return judge(findRemovals(parseUnifiedDiff(d)), parseDeclarations('消してよい: ぜんぶ')).exit === EXIT.FAIL;
      },
    },
    {
      name: '書き直しても目印が残っていれば緑（触っていない扱い）',
      ok: () => {
        const d = mkDiff('src/Header.tsx', ['<a href="/settings" class="a">設定</a>'], ['<a class="b" href="/settings">設定</a>']);
        return findRemovals(parseUnifiedDiff(d)).length === 0;
      },
    },
    {
      name: '★公開関数が消えたら赤 / 別ファイルへ移しただけなら緑',
      ok: () => {
        const gone = findRemovals(parseUnifiedDiff(mkDiff('lib/a.ts', ['export function search(q) {'], [])));
        const moved = findRemovals(parseUnifiedDiff(
          mkDiff('lib/a.ts', ['export function search(q) {'], []) + '\n' + mkDiff('lib/b.ts', [], ['export function search(q) {'])));
        return gone.length === 1 && gone[0].name === 'search' && moved.length === 0;
      },
    },
    {
      name: '★テストを消す・.skip で止めるのは赤',
      ok: () => {
        const d = mkDiff('src/a.test.ts', ["it('ログインできる', () => {"], ["it.skip('検索できる', () => {"]);
        const kinds = findRemovals(parseUnifiedDiff(d)).map((i) => i.kind).sort();
        return kinds.length === 2 && kinds.includes('テスト') && kinds.includes('止めたテスト(.skip/.only/xit)');
      },
    },
    {
      name: '★コードのファイルが消えたら赤 / 文書が消えても対象外',
      ok: () => {
        const a = findRemovals(parseUnifiedDiff(mkDiff('app/settings/page.tsx', ['x'], [], 'D')));
        const b = findRemovals(parseUnifiedDiff(mkDiff('docs/old.md', ['x'], [], 'D')));
        return a.length === 1 && a[0].kind === 'ファイル' && b.length === 0;
      },
    },
    {
      name: '名前の変更(rename)は消えた扱いにしない',
      ok: () => {
        const d = ['diff --git a/src/a.ts b/src/b.ts', 'similarity index 100%', 'rename from src/a.ts', 'rename to src/b.ts'].join('\n');
        return findRemovals(parseUnifiedDiff(d)).length === 0;
      },
    },
    {
      name: '★丸ごと書き直して大きく減らしたら赤 / 同じくらい足していれば緑',
      ok: () => {
        const shrink = findRemovals(parseUnifiedDiff(mkDiff('src/App.tsx', big, ['  only();'])));
        const rewrite = findRemovals(parseUnifiedDiff(mkDiff('src/App.tsx', big, big.map((l) => l.replace('line', 'row')))));
        return shrink.some((i) => i.kind === '大きな削除') && !rewrite.some((i) => i.kind === '大きな削除');
      },
    },
    {
      name: '★機能台帳(features.json)の目印を含む行が消えたら赤',
      ok: () => {
        const d = mkDiff('site/index.html', ['<form class="search-box">'], ['<div>']);
        const r = findRemovals(parseUnifiedDiff(d), { anchors: [{ feature: '検索', contains: 'search-box' }] });
        return r.some((i) => i.kind === '機能台帳の目印');
      },
    },
    {
      name: '生成物(dist/node_modules)の削除は対象外',
      ok: () => findRemovals(parseUnifiedDiff(mkDiff('dist/app.js', ['export function a(){'], [], 'D'))).length === 0,
    },
    {
      name: '宣言の書き方: 消してよい／削除OK／Removes: の3種と全角コロン',
      ok: () => parseDeclarations('消してよい：a\n削除OK: b\nRemoves: c\n- removes: d').length === 4,
    },
  ];
  const failed = cases.filter((c) => { try { return !c.ok(); } catch { return true; } });
  if (failed.length) {
    console.error('[check-unrequested-removal] ★selftest 失敗（検知器が効いていません）:');
    for (const f of failed) console.error(`  - ${f.name}`);
    process.exit(EXIT.FAIL);
  }
  console.log(`[check-unrequested-removal] ✅ selftest 合格（${cases.length}件: 消えたボタン・リンク・関数・テスト・ファイル・大きな削除は赤 / 宣言・移動・名前変更は緑）`);
  process.exit(EXIT.PASS);
}

// ── 実行 ──────────────────────────────────────────────────────────────────

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) runSelftest();
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const valueFlags = new Set(['--base', '--message', '--declare-env']);
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valueFlags.has(argv[i - 1]));
  const r = run({
    root: positional[0] || '.',
    base: opt('--base'),
    staged: argv.includes('--staged'),
    message: opt('--message'),
    declareEnv: opt('--declare-env'),
  });
  (r.exit === EXIT.PASS ? console.log : console.error)(r.text);
  process.exit(r.exit);
}

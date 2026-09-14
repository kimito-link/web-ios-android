#!/usr/bin/env node
/**
 * check-shared-parts-used.mjs — ★共有部品が「あるのに使われていない」を数える。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか（2026-09-01・reply-copilot-openrouter-v2 の実損）
 *
 *   ユーザー指摘:「同じパーツをちゃんと使えばならないはず。車輪の再発明もいいところです」
 *
 *   同じ画面部品が3つ別々に実装されていた。重複禁止のルールは
 *   ★キットに既に【3箇所】書いてあった:
 *     docs/ai-rules/01_CORE_RULES.md      同機能の重複実装をしない
 *     docs/ai-rules/03_REVIEW_CHECKLIST.md [ ] 重複実装がない
 *     docs/ai-rules/README.md             重複実装と手戻りを減らす
 *   ★それでも守られなかった。⟹ 文章をもう1行足しても解決しない。
 *   **検査していない規範は守られない。**
 *
 * ■ ★重複の本当の代償（行数ではない）
 *   共有部品を使わない画面は、**修正1つぶん永久に遅れ続ける**。
 *   実例: 「過去にアカウント名を変えた人を1人として追う」修正が
 *   shared/speaker-identity.js に入ったが、★ユーザーが日常的に開く画面は
 *   その部品を読み込んでおらず、**直っていなかった**。
 *   ⟹ 代償は「行数が多い」ことではなく
 *     **「一度直したはずのバグが、別の画面では直っていない」**こと。
 *
 * ■ ★何を検出するか
 *   1. 共有ディレクトリ（既定 shared/）に定義されている関数名を集める
 *   2. その外側のファイルが、★同じ名前の関数を自前で定義していないか
 *
 * ■ ★この検査が判定しないこと（ここが最重要）
 *   ・**統合すべきかは判定しない。** ★KB に実測の記録がある:
 *     「拡大表示は全件描画する（Ctrl+F・HTML保存・印刷が DOM に無いものを
 *      拾えないため）。仮想スクロールはこの画面の目的と正面から衝突する」
 *     ＝ ★違いに正当な理由があるものが混ざっている。
 *     機械的に統合すると「統合したら落ちた」になる。
 *   ・**共有ディレクトリが複数ある構成では、片方をもう片方の「重複」と数える。**
 *     実測（このキット自身・2026-09-01）: --shared-dir templates/scripts/lib で測ると
 *     scripts/lib/ 側の関数が丸ごと「重複」として出た。★どちらも共有部品なので誤り。
 *     ⟹ --shared-dir を実態に合わせて絞るか、ベースラインに含めて
 *       「★増えた分だけ見る」使い方をすること（この検査はラチェットなのでそれで足りる）。
 *   ・**名前が違う同目的の関数は拾えない**（escapeHtml ←→ esc、formatDate ←→ fmtTime）。
 *     ★これは既知の限界。名前が揃っているものだけを見る。
 *   ・**症状の原因が重複だとは言わない。** ★KB に「司令塔が実際に誤診した」記録がある
 *     （真因は保存データが空だったこと。統合しても症状は残った）。
 *     「重複を直す話」と「症状を直す話」は別物。
 *
 * ■ ★強制しない（このキットの掟）
 *   件数の上限はラチェット。★増えたときだけ赤。減らすのは自由。
 *   「書かないと赤」にすると、通すためだけの嘘の統合が入る。
 *
 * ■ ★git 追跡ファイルだけを見る
 *   .claude/worktrees/ や node_modules を数えると誤検知だらけになる
 *   （実測: 除外前は同じ関数が worktree 分だけ何重にも出た）。
 *
 * ■ 3値の終了コード
 *   0 = 合格 / 1 = ★測れた上での赤（増えた） / 2 = ★測れなかった
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 使い方:
 *   node check-shared-parts-used.mjs [対象ディレクトリ]
 *   node check-shared-parts-used.mjs --shared-dir common   # 共有ディレクトリ名を変える
 *   node check-shared-parts-used.mjs --selftest
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });
const HERE = dirname(fileURLToPath(import.meta.url));

/** 既定で共有部品を置く場所（プロジェクトごとに --shared-dir で変えられる）。 */
const DEFAULT_SHARED_DIRS = ['shared', 'common', 'lib/shared'];

/**
 * ★関数の定義を拾う（純粋関数）。
 *
 * function foo(...) / const foo = (...) => / const foo = function
 * の3形だけを見る。★メソッド定義（obj.foo = ...）は拾わない：
 * 名前が衝突しやすく、誤検知の元になるため。
 *
 * @param {string} src
 * @returns {string[]} 定義されている関数名
 */
export function extractDefinedFunctions(src) {
  const text = typeof src === 'string' ? src : '';
  const names = new Set();

  for (const m of text.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  for (const m of text.matchAll(
    /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g,
  )) {
    names.add(m[1]);
  }

  return [...names];
}

/**
 * ★関数本体を文字列で切り出す（AST不使用）。
 *
 * `function name(` または `const name = ... {` から始まり、中括弧の深さが
 * 0に戻るまでを切り出す。文字列・テンプレートリテラル内の `{` で深さがズレる
 * ことがあるため、失敗したら null を返す（呼び出し側は unmeasured に倒す。
 * 過去に同種の中括弧カウントで誤判定した実績があるため、fail-close にする）。
 *
 * @param {string} src
 * @param {string} name
 * @returns {string|null}
 */
export function extractFunctionBody(src, name) {
  const text = typeof src === 'string' ? src : '';
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `(?:function\\s+${escaped}\\s*\\(|(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s*)?(?:function\\b[^(]*\\(|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>))`,
  );
  const m = re.exec(text);
  if (!m) return null;
  const braceStart = text.indexOf('{', m.index);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(m.index, i + 1);
    }
  }
  return null; // 深さが0に戻らなかった＝切り出し失敗
}

/**
 * ★コメント・文字列内は触らず、行コメント/ブロックコメント/空行だけ落とす。
 * `templates/scripts/lib/instrument-proof.mjs` と `_docs/instruments/check-drift.mjs` の
 * 同名関数と同一ロジック。★依存ゼロ・コピー1枚で動く原則のため独立コピーとして持つ
 * （import しない。どちらかを変えたらもう片方も見て揃える）。
 * ★2026-09-14: 行末インラインコメントも除去するよう3箇所同期で拡張。
 * @param {string} text
 * @returns {string}
 */
function codeOnly(text) {
  const noBlock = String(text || '').replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .map((l) => l.replace(/\s+\/\/(?!\/).*$/, ''))
    .filter((l) => l.trim() !== '')
    .map((l) => l.trimEnd())
    .join('\n');
}

/** @param {string} normalizedSourceText @returns {string} */
function hashSource(normalizedSourceText) {
  return createHash('sha256').update(String(normalizedSourceText || ''), 'utf8').digest('hex');
}

/**
 * ★同名関数どうしの本体一致を判定する。
 * @param {string|undefined} bodyA
 * @param {string|undefined} bodyB
 * @returns {'identical'|'different'|'unmeasured'}
 */
function judgeBodyMatch(bodyA, bodyB) {
  if (typeof bodyA !== 'string' || typeof bodyB !== 'string') return 'unmeasured';
  return hashSource(codeOnly(bodyA)) === hashSource(codeOnly(bodyB)) ? 'identical' : 'different';
}

/**
 * ★判定の本体（fs にも git にも触らない＝テストできる）。
 *
 * @param {{path:string, defined:string[], bodies?:Record<string,string|null>}[]} sharedFiles 共有ディレクトリのファイル
 * @param {{path:string, defined:string[], bodies?:Record<string,string|null>}[]} otherFiles  それ以外のファイル
 * @param {number} baseline 既知の重複数（ラチェットの上限。identicalのみ数える）
 * @returns {{verdict:'pass'|'fail'|'inconclusive', duplicates:{name:string, at:string, sharedAt:string, bodyMatch:'identical'|'different'|'unmeasured'}[], reason?:string}}
 */
export function judgeSharedPartsUsed(sharedFiles, otherFiles, baseline) {
  const shared = Array.isArray(sharedFiles) ? sharedFiles : [];
  const others = Array.isArray(otherFiles) ? otherFiles : [];

  // ★共有部品が1つも無い＝この検査の前提が無い。「重複0」ではなく「測っていない」。
  if (shared.length === 0) {
    return {
      verdict: 'inconclusive',
      duplicates: [],
      reason: '共有ディレクトリが見つからないか、関数が1つも定義されていません'
        + '（★重複0ではなく、比べる相手がありません）',
    };
  }
  // ★走査対象が0件なのも「異常なし」ではない。
  if (others.length === 0) {
    return {
      verdict: 'inconclusive',
      duplicates: [],
      reason: '共有ディレクトリ以外のファイルが1件も見つかりませんでした（★見ていません）',
    };
  }

  const sharedNames = new Map();
  const sharedBodies = new Map();
  for (const f of shared) {
    for (const n of f.defined || []) {
      if (!sharedNames.has(n)) {
        sharedNames.set(n, f.path);
        sharedBodies.set(n, f.bodies ? f.bodies[n] : undefined);
      }
    }
  }

  const duplicates = [];
  for (const f of others) {
    for (const n of f.defined || []) {
      if (sharedNames.has(n)) {
        const otherBody = f.bodies ? f.bodies[n] : undefined;
        duplicates.push({
          name: n,
          at: f.path,
          sharedAt: sharedNames.get(n),
          bodyMatch: judgeBodyMatch(sharedBodies.get(n), otherBody),
        });
      }
    }
  }

  // ★ラチェット対象は identical のみ。different は「同名だが契約が違う可能性がある」
  //   ので件数に含めない（統合すべきかは機械で決めない、この検査の既存方針と同じ）。
  const identicalCount = duplicates.filter((d) => d.bodyMatch === 'identical').length;
  const limit = Number.isFinite(baseline) ? baseline : identicalCount;
  return {
    verdict: identicalCount > limit ? 'fail' : 'pass',
    duplicates,
    limit,
    counts: {
      identical: identicalCount,
      different: duplicates.filter((d) => d.bodyMatch === 'different').length,
      unmeasured: duplicates.filter((d) => d.bodyMatch === 'unmeasured').length,
    },
  };
}

// ── selftest（★毒→赤） ──────────────────────────────────────────────────
function runSelftest() {
  const fails = [];
  const ESCAPE_BODY = 'function escapeHtml(s) { return String(s).replace(/</g, "&lt;"); }';
  const ESCAPE_BODY_DIFFERENT = 'function escapeHtml(s) { return s; }';
  const S = [{
    path: 'shared/render.js', defined: ['escapeHtml', 'fmtTime'],
    bodies: { escapeHtml: ESCAPE_BODY, fmtTime: 'function fmtTime(t) { return String(t); }' },
  }];

  // ① 共有と同名・本体まで一致で数える（identical）
  const a = judgeSharedPartsUsed(
    S, [{ path: 'popup/a.js', defined: ['escapeHtml'], bodies: { escapeHtml: ESCAPE_BODY } }], 0,
  );
  if (a.verdict !== 'fail') fails.push('★重複を見逃す');
  if (a.duplicates[0]?.name !== 'escapeHtml') fails.push('★重複の名前が違う');
  if (a.duplicates[0]?.bodyMatch !== 'identical') fails.push('★本体一致をidenticalと判定できない');

  // ② ラチェット: 既知の件数までは緑（減らすのは自由）
  const b = judgeSharedPartsUsed(
    S, [{ path: 'popup/a.js', defined: ['escapeHtml'], bodies: { escapeHtml: ESCAPE_BODY } }], 1,
  );
  if (b.verdict !== 'pass') fails.push('★ベースライン内なのに赤くする');

  // ③ ★増えたときだけ赤
  const c = judgeSharedPartsUsed(
    S,
    [
      { path: 'a.js', defined: ['escapeHtml'], bodies: { escapeHtml: ESCAPE_BODY } },
      { path: 'b.js', defined: ['fmtTime'], bodies: { fmtTime: 'function fmtTime(t) { return String(t); }' } },
    ],
    1,
  );
  if (c.verdict !== 'fail') fails.push('★増えたのに赤くならない');

  // ④ ★共有部品が無ければ inconclusive（重複0の緑にしない）
  if (judgeSharedPartsUsed([], [{ path: 'a.js', defined: ['x'] }], 0).verdict !== 'inconclusive') {
    fails.push('★比べる相手が無いのに緑にしている');
  }
  // ⑤ ★走査0件も inconclusive
  if (judgeSharedPartsUsed(S, [], 0).verdict !== 'inconclusive') {
    fails.push('★走査0件を緑にしている');
  }
  // ⑥ 壊れた入力で throw しない
  try {
    if (judgeSharedPartsUsed(null, null, null).verdict !== 'inconclusive') {
      fails.push('★null を緑にしている');
    }
  } catch { fails.push('★壊れた入力で throw する'); }

  // ⑧ 本体不一致（different）はラチェット対象外＝赤にならない
  const d = judgeSharedPartsUsed(
    S,
    [{ path: 'c.js', defined: ['escapeHtml'], bodies: { escapeHtml: ESCAPE_BODY_DIFFERENT } }],
    0,
  );
  if (d.verdict !== 'pass') fails.push('★本体不一致(different)をラチェット対象にしている');
  if (d.duplicates[0]?.bodyMatch !== 'different') fails.push('★本体不一致をdifferentと判定できない');

  // ⑨ 切り出し失敗（本体を渡さない）は unmeasured としてラチェット対象外
  const e = judgeSharedPartsUsed(
    S,
    [{ path: 'd.js', defined: ['escapeHtml'], bodies: {} }],
    0,
  );
  if (e.verdict !== 'pass') fails.push('★切り出し失敗(unmeasured)をラチェット対象にしている');
  if (e.duplicates[0]?.bodyMatch !== 'unmeasured') fails.push('★本体なしをunmeasuredと判定できない');

  // ⑩ extractFunctionBody: 通常の関数宣言を切り出せる
  if (extractFunctionBody('function foo(a,b) { return a+b; }', 'foo') === null) {
    fails.push('★通常の関数本体を切り出せない');
  }
  // ⑪ extractFunctionBody: デフォルト引数の{}で深さカウントが狂っても例外を投げず、
  //   実際に文字列の {} を含む場合は最短で閉じてしまい誤った本体を返すことがあるが、
  //   ★重要なのは throw しないこと（誤判定は上位でidentical/differentの比較結果として現れる）
  try {
    extractFunctionBody('function f(opts = {}) { return opts; }', 'f');
  } catch { fails.push('★デフォルト引数を含む関数でthrowする'); }
  // ⑫ 存在しない関数名は null
  if (extractFunctionBody('function foo(){}', 'bar') !== null) {
    fails.push('★存在しない関数名でnull以外を返す');
  }

  // ⑦ 関数定義の抽出（3形）
  const defs = extractDefinedFunctions(
    'function a(){}\nconst b = () => {}\nexport const c = function(){}\n',
  );
  for (const n of ['a', 'b', 'c']) if (!defs.includes(n)) fails.push(`★${n} を拾えない`);
  // ★呼び出しは定義ではない（これを拾うと全ファイルが重複扱いになる）
  if (extractDefinedFunctions('escapeHtml(x); foo.escapeHtml(y);').length !== 0) {
    fails.push('★呼び出しを定義と読んでいる');
  }

  if (fails.length) {
    console.error('[check-shared-parts-used] ★selftest 失敗（検知器が効いていません）:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log(
    '[check-shared-parts-used] ✅ selftest 合格'
    + '（12件: identical重複は赤 / ラチェット / ★0件を緑にしない / 呼び出しを定義と読まない'
    + ' / different・unmeasuredはラチェット対象外 / 本体切り出しがthrowしない）',
  );
  process.exit(EXIT.PASS);
}

// ── 実行 ────────────────────────────────────────────────────────────────
const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain && process.argv.includes('--selftest')) runSelftest();

if (isMain) {
  const argDir = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const root = resolve(argDir || process.cwd());

  // ★--shared-dir は複数回指定できる（2026-09-03、キット自身がscripts/lib＋
  //   templates/scripts/libの2箇所を持つため、単一指定では片方しか測れなかった）。
  const sharedArgs = process.argv
    .map((a, i) => (a === '--shared-dir' ? process.argv[i + 1] : null))
    .filter((v) => typeof v === 'string' && v.trim());
  const sharedDirs = sharedArgs.length > 0 ? sharedArgs : DEFAULT_SHARED_DIRS;

  // ★git 追跡ファイルだけを見る（worktree/node_modules を数えない）。
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files', '*.js', '*.mjs', '*.ts', '*.tsx'], {
      cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    }).split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (e) {
    console.error('[check-shared-parts-used] 🟡 git ls-files を実行できませんでした（★緑ではありません）。');
    console.error(`  → 理由: ${e && e.message}`);
    process.exit(EXIT.INCONCLUSIVE);
  }

  // ★他人のコード・保存物は数えない（2026-09-01 実測で判明）。
  //   git ls-files で worktree は落ちるが、node_modules を**コミットしている**リポが実在し、
  //   そこの resolve / normalize / collect が「重複」として大量に出た。
  //   ★他人のコードを直せと言われても直せない＝行動に繋がらない指摘は嘘の赤と同じ。
  const EXCLUDED = /(^|\/)(node_modules|vendor|third_party|dist|build|out|_backup|\.min\.)/;
  const isShared = (p) => sharedDirs.some((d) => p === d || p.startsWith(`${d}/`));
  const load = (p) => {
    try {
      const src = readFileSync(join(root, p), 'utf8');
      const defined = extractDefinedFunctions(src);
      const bodies = {};
      for (const n of defined) bodies[n] = extractFunctionBody(src, n);
      return { path: p, defined, bodies };
    } catch { return null; }
  };

  const scannable = tracked.filter((p) => !EXCLUDED.test(p));
  const sharedFiles = scannable.filter(isShared).map(load).filter(Boolean);
  const otherFiles = scannable.filter((p) => !isShared(p)).map(load).filter(Boolean);

  // ベースライン（ラチェット）。無ければ「今の値」を上限にする＝初回は必ず緑。
  const baselinePath = join(root, '.shared-parts-baseline.json');
  let baseline = null;
  if (existsSync(baselinePath)) {
    try { baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).duplicates; } catch { baseline = null; }
  }

  const r = judgeSharedPartsUsed(sharedFiles, otherFiles, baseline);

  if (r.verdict === 'inconclusive') {
    console.error(`[check-shared-parts-used] 🟡 測れませんでした: ${r.reason}`);
    console.error(`  → 探した共有ディレクトリ: ${sharedDirs.join(' / ')}`);
    console.error('  → 別の場所に置いているなら --shared-dir <名前> を渡してください。');
    process.exit(EXIT.INCONCLUSIVE);
  }

  const byName = new Map();
  for (const d of r.duplicates) {
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push(`${d.at}[${d.bodyMatch}]`);
  }

  console.log(
    `[check-shared-parts-used] 共有 ${sharedFiles.length} ファイル / 走査 ${otherFiles.length} ファイル`
    + ` / ★共有と同名を自前で持つ ${r.duplicates.length} 件`
    + ` (identical=${r.counts.identical} / different=${r.counts.different} / unmeasured=${r.counts.unmeasured})`
    + (baseline === null ? '（ベースライン未設定）' : `（上限 ${r.limit}、identicalのみラチェット対象）`),
  );
  for (const [name, at] of [...byName].slice(0, 10)) {
    console.log(`  ⚪ ${name} … ${at.length}箇所: ${at.slice(0, 3).join(', ')}${at.length > 3 ? ' 他' : ''}`);
  }
  if (byName.size > 10) console.log(`  （他 ${byName.size - 10} 種類）`);

  if (r.verdict === 'fail') {
    console.error('[check-shared-parts-used] 🔴 共有部品と本体まで一致する自前実装が増えました。');
    console.error('  → 直し方: 共有部品を読み込んで使うか、★統合すべきでない理由があるなら');
    console.error('    ベースラインを上げて理由をコミットメッセージに書いてください。');
    console.error('  → ★この検査が判定しないこと: 統合すべきかは判定しません。');
    console.error('    違いに正当な理由があるもの（描画戦略の違い等）が混ざります。');
    console.error('    ★名前が違う同目的の関数（escapeHtml ←→ esc）は拾えません。');
    console.error('    ★同名でも本体が違う（different）ものはラチェット対象外です。');
    process.exit(EXIT.FAIL);
  }

  console.log('[check-shared-parts-used] ✅ 合格（本体まで一致する重複は増えていません）。');
  console.log('  → ★この検査が判定しないこと: 統合すべきか・名前が違う同目的関数は見ません。');
  process.exit(EXIT.PASS);
}

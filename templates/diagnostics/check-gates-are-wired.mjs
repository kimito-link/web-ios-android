#!/usr/bin/env node
/**
 * check-gates-are-wired.mjs — ★「作ったのに誰も呼ばない検査」を機械で見つける。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか（実損。同じ型を3回踏んでいる）
 *
 *   ① 2026-08-21 surechigai: `check-native-unsafe-dom.mjs` は **iOS 518 却下**
 *      （Hermes に addEventListener が無く起動時に全画面エラー）を捕まえる検査
 *      だったのに、★`pnpm check` にも CI にも登録されていなかった。
 *      ＝ **却下の検出役が、誰にも実行されないまま却下を通した**。
 *
 *   ② 2026-08-23 surechigai: `check-symptom-index` は登録されていたが、
 *      置き場所の宣言が無く**毎回 skip** していた。★skip は存在しないのと同じ。
 *
 *   ③ ★2026-09-01 このキット自身: kimitolink-linktree から格上げした計器3点
 *      （check-workflow-timeouts / check-dependabot-queue / check-actions-usage）が
 *      **package.json・workflows・run.mjs のどこからも呼ばれていなかった**。
 *      ★出自リポでは workflow から呼ばれていたのに、格上げ先では0件。
 *      「templates/ へ格上げする」までは基準#5 に書いてあるが、
 *      **格上げ先で配線するところまでは誰も見ていなかった。**
 *
 *   ★どれも「検査を書いた／移した」時点で満足したのが原因。
 *   検査は**呼ばれて初めて意味を持つ**。だからそこを機械で数える。
 *
 * ■ ★何を見るか
 *   検査ファイル（check-* / verify-*）が、次のどれかから参照されているか:
 *     ・package.json の scripts
 *     ・.github/workflows/ のいずれか
 *     ・診断ランナー（run.mjs）
 *
 * ■ ★強制しない（このキットの掟）
 *   「必ず全部 CI に入れろ」にすると、重い検査まで毎回走り、
 *   通すためだけに検査を弱める動機が生まれる。
 *   ★ベースライン＋ラチェット。**孤児が増えたときだけ赤**。減らすのは自由。
 *
 * ■ ★この検査が判定しないこと
 *   ・呼ばれた検査が正しく動くかは見ない（呼ばれるかだけ）
 *   ・skip したまま緑になっていないかは見ない（それは各検査の責任）
 *   ・文字列一致なので、動的に組み立てる呼び出しは拾えない
 *   ・★**対象ディレクトリの外に置いた検査の配線が外れても気づけない。**
 *     既定では `templates/scripts/`（配布用の金型）を対象にしていないので、
 *     そこの検査を package.json から外しても緑のまま。
 *     実測（2026-09-01）: 毒テストで ci:timeouts の配線を外したのに緑だった。
 *     ★これは検査の欠陥ではなく対象範囲の話だが、**盲点として自覚しておくこと**。
 *     金型まで見たいときは `--dirs` に足す（ただし配布先で使うのが正しい金型は
 *     全部孤児として出るので、ベースラインとセットで使う）。
 *
 * ■ 3値の終了コード
 *   0 = 合格 / 1 = ★測れた上での赤（増えた） / 2 = ★測れなかった
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 使い方:
 *   node check-gates-are-wired.mjs [対象ディレクトリ]
 *   node check-gates-are-wired.mjs --dirs scripts,tools   # 検査の置き場所を指定
 *   node check-gates-are-wired.mjs --selftest
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });

/**
 * 検査とみなすファイル名。
 * ★export済み(2026-09-02): generate-architecture-map.mjsが同じ判定基準でGateを
 *   数えるためimportする。同じ正規表現を2箇所に複製しない（車輪の再発明・drift防止）。
 */
export const GATE_RE = /^(check|verify)-.*\.mjs$/;

/**
 * 既定で検査を探す場所（プロジェクトごとに --dirs で変えられる）。
 *
 * ★`templates/scripts/` は**入れない**（2026-09-01 実測で判明）。
 *   そこは「配布先が自分の scripts/ にコピーして使う金型」であって、
 *   キット自身が呼ぶものではない（README が `node scripts/check-...` と書いている）。
 *   ★金型を孤児として数えると18本が一度に赤くなり、しかも
 *   「配布先で使うのが正しい」ので直しようがない＝行動に繋がらない指摘になる。
 *
 *   ★一方 `templates/diagnostics/` は run.mjs が直接呼ぶ実体なので対象に含める。
 *   ここに置いたのに登録し忘れる事故は実際に起きている。
 */
const DEFAULT_GATE_DIRS = [
  'scripts', 'scripts/qa', 'scripts/diagnostics',
  'templates/diagnostics',
];

/**
 * ★コメント行を落とす。
 *
 * ★なぜ要るか（surechigai の実測で、この検査自身が騙されていた）:
 *   ワークフローに
 *     `# (verify-ios-splash-not-default.mjs) は不要になった（…`
 *   というコメントがあり、素の includes() がこれを拾って
 *   ★**「不要になった」と書いた文章が、そのゲートを「配線済み」に見せていた。**
 *   ＝ 弱い印は両方向に壊れる。
 *
 * ★CRLF を先に潰す（実測で踏んだ）: `.split("\n")` だけだと行末に `\r` が残り、
 *   `.*$` が `\r` の手前で止まってコメントが消えず「配線済み」と誤判定する。
 */
export function stripCommentLines(text) {
  return String(text || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, '$1').replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}

/**
 * ★呼ばれていない検査を返す（純ロジック・テスト可）。
 *
 * @param {{dir:string,name:string}[]} gates
 * @param {string[]} texts 呼び出し元になりうるファイルの中身
 * @returns {string[]} 孤児（誰にも呼ばれていない検査）
 */
export function findOrphans(gates, texts) {
  const list = Array.isArray(gates) ? gates : [];
  const code = (Array.isArray(texts) ? texts : []).map(stripCommentLines);
  return list
    .filter((g) => !code.some((t) => t.includes(g.name)))
    .map((g) => `${g.dir}/${g.name}`);
}

/**
 * ★判定（3値）。件数の上限はラチェット。
 *
 * @param {{dir:string,name:string}[]} gates
 * @param {string[]} texts
 * @param {number|null} baseline
 */
export function judgeGatesWired(gates, texts, baseline) {
  const list = Array.isArray(gates) ? gates : [];
  const t = Array.isArray(texts) ? texts : [];

  // ★検査が1本も見つからない＝合格ではない。探せていない。
  if (list.length === 0) {
    return {
      verdict: 'inconclusive', orphans: [],
      reason: '検査（check-* / verify-*）が1本も見つかりません（★孤児0ではなく、探せていません）',
    };
  }
  // ★呼び出し元が1つも読めない＝全部孤児に見えるが、それは測れていないだけ。
  if (t.length === 0) {
    return {
      verdict: 'inconclusive', orphans: [],
      reason: 'package.json も workflows も読めませんでした（★見ていません）',
    };
  }

  const orphans = findOrphans(list, t);
  const limit = Number.isFinite(baseline) ? baseline : 0;
  return { verdict: orphans.length > limit ? 'fail' : 'pass', orphans, limit };
}

// ── selftest（★毒→赤） ──────────────────────────────────────────────────
function runSelftest() {
  const fails = [];
  const G = [{ dir: 'scripts', name: 'check-x.mjs' }];

  if (findOrphans(G, ['何も書いていない']).length !== 1) fails.push('★呼ばれていない検査を見逃す');
  if (findOrphans(G, ['node scripts/check-x.mjs']).length !== 0) fails.push('★呼ばれているのに孤児にする');

  // ★コメントでの言及を「配線済み」と読まない（実際に踏んだ誤判定）
  if (findOrphans(G, ['# check-x.mjs は不要になった']).length !== 1) {
    fails.push('★コメントの言及を配線と数えている');
  }
  // ★CRLF でもコメントを落とせる（実際に踏んだ）
  if (findOrphans(G, ['# check-x.mjs は不要\r\n次の行']).length !== 1) {
    fails.push('★CRLF でコメントを落とせていない');
  }
  // ★検査0件・呼び出し元0件はどちらも inconclusive（緑にしない）
  if (judgeGatesWired([], ['何か'], 0).verdict !== 'inconclusive') fails.push('★検査0件を緑にしている');
  if (judgeGatesWired(G, [], 0).verdict !== 'inconclusive') fails.push('★呼び出し元0件を緑にしている');
  // ★ラチェット: 既知の数までは緑・増えたら赤
  if (judgeGatesWired(G, ['無関係'], 1).verdict !== 'pass') fails.push('★ベースライン内なのに赤くする');
  if (judgeGatesWired(G, ['無関係'], 0).verdict !== 'fail') fails.push('★増えたのに赤くならない');
  // 壊れた入力で throw しない
  try {
    if (judgeGatesWired(null, null, null).verdict !== 'inconclusive') fails.push('★null を緑にしている');
  } catch { fails.push('★壊れた入力で throw する'); }

  if (fails.length) {
    console.error('[check-gates-are-wired] ★selftest 失敗（検知器が効いていません）:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log(
    `[check-gates-are-wired] ✅ selftest 合格（9件: 孤児は赤 / ★コメントを配線と読まない`
    + ` / CRLF / ★0件を緑にしない / ラチェット）`,
  );
  process.exit(EXIT.PASS);
}

// ── 実行 ────────────────────────────────────────────────────────────────
const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain && process.argv.includes('--selftest')) runSelftest();

if (isMain) {
  const argDir = process.argv.slice(2).find((a, i, arr) => !a.startsWith('--') && arr[i - 1] !== '--dirs');
  const root = resolve(argDir || process.cwd());

  const dirsIdx = process.argv.indexOf('--dirs');
  const gateDirs = dirsIdx >= 0 && process.argv[dirsIdx + 1]
    ? process.argv[dirsIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_GATE_DIRS;

  // 検査ファイルを集める
  const gates = [];
  for (const d of gateDirs) {
    const abs = join(root, d);
    if (!existsSync(abs)) continue;
    try {
      for (const f of readdirSync(abs)) {
        if (GATE_RE.test(f) && statSync(join(abs, f)).isFile()) gates.push({ dir: d, name: f });
      }
    } catch { /* 読めないディレクトリは飛ばす */ }
  }

  // 呼び出し元になりうるテキストを集める
  const texts = [];
  const pkg = join(root, 'package.json');
  if (existsSync(pkg)) texts.push(readFileSync(pkg, 'utf8'));
  const wf = join(root, '.github', 'workflows');
  if (existsSync(wf)) {
    for (const f of readdirSync(wf)) {
      if (/\.ya?ml$/.test(f)) texts.push(readFileSync(join(wf, f), 'utf8'));
    }
  }
  for (const d of gateDirs) {
    const runner = join(root, d, 'run.mjs');
    if (existsSync(runner)) texts.push(readFileSync(runner, 'utf8'));
  }

  // ベースライン（ラチェット）
  const baselinePath = join(root, '.gates-wired-baseline.json');
  let baseline = 0;
  if (existsSync(baselinePath)) {
    try { baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).orphans ?? 0; } catch { baseline = 0; }
  }

  const r = judgeGatesWired(gates, texts, baseline);

  if (r.verdict === 'inconclusive') {
    console.error(`[check-gates-are-wired] 🟡 測れませんでした: ${r.reason}`);
    console.error(`  → 探した場所: ${gateDirs.join(' / ')}`);
    console.error('  → 別の場所に置いているなら --dirs <a,b> を渡してください。');
    process.exit(EXIT.INCONCLUSIVE);
  }

  console.log(
    `[check-gates-are-wired] 検査 ${gates.length} 本 / ★誰にも呼ばれない ${r.orphans.length} 本`
    + `（上限 ${r.limit}）`,
  );
  for (const o of r.orphans) console.log(`  ⚪ ${o}`);

  if (r.verdict === 'fail') {
    console.error('[check-gates-are-wired] 🔴 誰にも呼ばれない検査が増えました。');
    console.error('  → 直し方: package.json の scripts / .github/workflows / 診断ランナー');
    console.error('    のいずれかに登録する。★呼ばれない検査は、存在しない検査と同じです。');
    console.error('  → ★格上げ（templates/ へ移した）だけでは配線になりません。');
    console.error('  → ★この検査が判定しないこと: 呼ばれた検査が正しく動くかは見ません。');
    process.exit(EXIT.FAIL);
  }

  console.log('[check-gates-are-wired] ✅ 合格（増えていません）。');
  console.log('  → ★この検査が判定しないこと: 呼ばれた検査が正しく動くかは見ません。');
  process.exit(EXIT.PASS);
}

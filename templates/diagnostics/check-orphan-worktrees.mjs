#!/usr/bin/env node
/**
 * check-orphan-worktrees.mjs — ★git worktreeの「片方向だけ切れた」孤児を数える。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか（2026-09-14・kimito-link-reply-suggest改名／traffic-seo移動の実損）
 *
 *   リポジトリ改名・ディレクトリ移動のたびに、git worktreeが「片方向だけ切れた」
 *   孤児になる。実際に本キット自身の`_archive/`移動作業で`traffic-seo`の
 *   worktree3件（`.cursor/worktrees/traffic-seo/{rbu,tap,veo}`）が孤児化し、
 *   `git status`が`fatal: not a git repository`で失敗する実害が起きた。
 *
 *   ★壊れ方の正体（gitのどのコマンドでも掃除できない）:
 *     登録側: <親リポ>/.git/worktrees/<name>/gitdir → <worktreeフォルダ>/.git   ✓存在
 *     フォルダ側: <worktreeフォルダ>/.git → <親リポ>/.git/worktrees/<name>     ✗消滅
 *   片方向だけ切れているため:
 *     git worktree remove → error code 7: '.git' is not a .git file
 *     git worktree prune  → フォルダが存在するので拾わない
 *     git worktree list   → 正常なworktreeとして表示され続ける
 *   ⟹ **gitのどのコマンドでも掃除できず、しかも異常に見えない。** だから何ヶ月も溜まる。
 *
 * ■ ★何を検出するか（双方向）
 *   1. 登録→フォルダ: `git worktree list --porcelain`のパスが実在するか
 *      （既存の`git worktree prune`が拾える方向）
 *   2. フォルダ→親リポ（★既存ツールが見ていない方向）: worktreeフォルダの`.git`
 *      ファイルを読み、`gitdir: <path>`の参照先が実在するか
 *
 * ■ ★この検査が判定しないこと
 *   ・**孤児を消してよいかは判定しない。** データ消失リスクがあるため、検出だけに留める。
 *     「オブジェクトの実在」（`git cat-file -e`）まで確認できれば削除の判断材料にはなるが、
 *     この検査自体は削除を推奨しない。
 *   ・**worktreeが1つも無いことを異常とはしない。** worktreeを使わない運用は正常（PASS）。
 *
 * ■ 3値の終了コード
 *   0 = 合格（孤児なし、またはworktree自体が無い） / 1 = ★測れた上での赤（孤児あり） /
 *   2 = ★測れなかった（gitが無い等）
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 使い方:
 *   node check-orphan-worktrees.mjs [対象リポのパス]
 *   node check-orphan-worktrees.mjs --selftest
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });

/**
 * ★`git worktree list --porcelain`の出力を解析する（純関数）。
 * @param {string} porcelainOutput
 * @returns {{path:string, head:string, branch:string|null}[]} メインを含む全worktree
 */
export function parseWorktreeList(porcelainOutput) {
  const text = typeof porcelainOutput === 'string' ? porcelainOutput : '';
  const blocks = text.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  const entries = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    let path = null;
    let head = null;
    let branch = null;
    for (const line of lines) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length).trim();
      else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length).trim();
      else if (line.startsWith('branch ')) branch = line.slice('branch '.length).trim();
    }
    if (path) entries.push({ path, head, branch });
  }
  return entries;
}

/**
 * ★worktreeフォルダの`.git`ファイルを読み、`gitdir: <path>`の参照先を返す。
 * @param {string} worktreeGitFileContent
 * @returns {string|null}
 */
export function parseGitdirPointer(worktreeGitFileContent) {
  const text = typeof worktreeGitFileContent === 'string' ? worktreeGitFileContent : '';
  const m = /^gitdir:\s*(.+)\s*$/m.exec(text);
  return m ? m[1].trim() : null;
}

/**
 * ★判定の本体（fsにもgitにも触らない＝テストできる）。
 *
 * @param {{path:string, head:string, branch:string|null}[]} registered
 *   `git worktree list`が返した全worktree（メイン含む）
 * @param {Map<string, {folderExists:boolean, gitdirPointer:string|null, gitdirTargetExists:boolean|null}>} folderStates
 *   各worktreeパスについて、実際にfsを見た結果
 * @returns {{verdict:'pass'|'fail'|'inconclusive', orphans:{path:string, direction:'registered-to-folder'|'folder-to-parent', detail:string}[], reason?:string}}
 */
export function judgeOrphanWorktrees(registered, folderStates) {
  const list = Array.isArray(registered) ? registered : [];
  const states = folderStates instanceof Map ? folderStates : new Map();

  // ★worktreeがメインの1件だけ（linked worktreeが無い）は「異常なし」であって
  //   「測れなかった」ではない。この検査の対象が無いだけ。
  const linkedWorktrees = list.filter((_, i) => i > 0);
  if (linkedWorktrees.length === 0) {
    return { verdict: 'pass', orphans: [], reason: 'linked worktreeがありません（メインのみ）' };
  }

  const orphans = [];
  for (const wt of linkedWorktrees) {
    const state = states.get(wt.path);
    if (!state) {
      orphans.push({
        path: wt.path, direction: 'registered-to-folder',
        detail: 'このworktreeのfs状態が測定されていません（★測れなかった扱い）',
      });
      continue;
    }
    if (!state.folderExists) {
      // ★方向1: 登録はあるがフォルダが無い。`git worktree prune`が本来拾える方向。
      orphans.push({
        path: wt.path, direction: 'registered-to-folder',
        detail: 'フォルダが存在しません（git worktree pruneの対象）',
      });
      continue;
    }
    if (state.gitdirPointer === null) {
      orphans.push({
        path: wt.path, direction: 'folder-to-parent',
        detail: 'フォルダは存在しますが .git ファイルにgitdir参照がありません',
      });
      continue;
    }
    if (state.gitdirTargetExists === false) {
      // ★方向2（既存ツールが見ていない方向）: フォルダ側の.gitが親リポの
      //   .git/worktrees/<name>を指しているが、そこが消えている＝片方向切れ。
      orphans.push({
        path: wt.path, direction: 'folder-to-parent',
        detail: `.git の参照先が存在しません: ${state.gitdirPointer}`,
      });
    }
  }

  return {
    verdict: orphans.length > 0 ? 'fail' : 'pass',
    orphans,
  };
}

// ── selftest（★毒→赤） ──────────────────────────────────────────────────
function runSelftest() {
  const fails = [];

  // ① parseWorktreeList: porcelain出力を正しく解析できる
  const parsed = parseWorktreeList(
    'worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\n'
    + 'worktree /repo/.git/worktrees/x\nHEAD def456\nbranch refs/heads/feature\n\n',
  );
  if (parsed.length !== 2) fails.push('★worktree一覧の件数を正しく解析できない');
  if (parsed[1]?.path !== '/repo/.git/worktrees/x') fails.push('★worktreeパスの解析が誤っている');

  // ② parseGitdirPointer: gitdir参照を解析できる
  if (parseGitdirPointer('gitdir: /a/b/.git/worktrees/x\n') !== '/a/b/.git/worktrees/x') {
    fails.push('★gitdir参照の解析ができない');
  }
  if (parseGitdirPointer('not a gitdir file') !== null) {
    fails.push('★gitdir参照が無いファイルでnull以外を返す');
  }

  // ③ 毒1: 登録されているがフォルダが無い（プルーン対象）→ 検出できるか
  {
    const registered = [
      { path: '/repo', head: 'a', branch: 'main' },
      { path: '/repo/.git/worktrees/gone', head: 'b', branch: 'feature' },
    ];
    const states = new Map([
      ['/repo/.git/worktrees/gone', { folderExists: false, gitdirPointer: null, gitdirTargetExists: null }],
    ]);
    const r = judgeOrphanWorktrees(registered, states);
    if (r.verdict !== 'fail') fails.push('★毒1: フォルダ消失を見逃す');
    if (!r.orphans.some((o) => o.direction === 'registered-to-folder')) {
      fails.push('★毒1: 方向(registered-to-folder)を正しく分類できない');
    }
  }

  // ④ 毒2: フォルダはあるが.gitのgitdir参照先が存在しない（孤児）→ 検出できるか
  {
    const registered = [
      { path: '/repo', head: 'a', branch: 'main' },
      { path: '/wt/orphan', head: 'b', branch: null },
    ];
    const states = new Map([
      ['/wt/orphan', {
        folderExists: true,
        gitdirPointer: '/repo/.git/worktrees/orphan',
        gitdirTargetExists: false,
      }],
    ]);
    const r = judgeOrphanWorktrees(registered, states);
    if (r.verdict !== 'fail') fails.push('★毒2: 片方向切れ(folder-to-parent)を見逃す');
    if (!r.orphans.some((o) => o.direction === 'folder-to-parent')) {
      fails.push('★毒2: 方向(folder-to-parent)を正しく分類できない');
    }
  }

  // ⑤ 毒3: 両方生きている（正常）→ 誤検知しないか
  {
    const registered = [
      { path: '/repo', head: 'a', branch: 'main' },
      { path: '/wt/healthy', head: 'b', branch: null },
    ];
    const states = new Map([
      ['/wt/healthy', {
        folderExists: true,
        gitdirPointer: '/repo/.git/worktrees/healthy',
        gitdirTargetExists: true,
      }],
    ]);
    const r = judgeOrphanWorktrees(registered, states);
    if (r.verdict !== 'pass') fails.push('★毒3: 健全なworktreeを誤って赤にする');
  }

  // ⑥ 毒4: worktreeが1つも無い（メインのみ）→ PASS（INCONCLUSIVEにしない）
  {
    const registered = [{ path: '/repo', head: 'a', branch: 'main' }];
    const r = judgeOrphanWorktrees(registered, new Map());
    if (r.verdict !== 'pass') fails.push('★毒4: worktree皆無を緑にできない（異常なしのはず）');
  }

  // ⑦ 壊れた入力でthrowしない
  try {
    if (judgeOrphanWorktrees(null, null).verdict !== 'pass') {
      fails.push('★null入力でpass以外を返す（0件は異常なしのはず）');
    }
  } catch { fails.push('★壊れた入力でthrowする'); }

  if (fails.length) {
    console.error('[check-orphan-worktrees] ★selftest 失敗（検知器が効いていません）:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log(
    '[check-orphan-worktrees] ✅ selftest 合格'
    + '（7件: 登録→フォルダ消失を検出 / フォルダ→親リポ消失を検出'
    + ' / 健全なworktreeを誤検知しない / worktree皆無を緑にする / 壊れた入力でthrowしない）',
  );
  process.exit(EXIT.PASS);
}

// ── 実行 ────────────────────────────────────────────────────────────────
const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain && process.argv.includes('--selftest')) runSelftest();

if (isMain) {
  const argDir = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const root = resolve(argDir || process.cwd());

  if (!existsSync(join(root, '.git'))) {
    console.error('[check-orphan-worktrees] 🟡 このディレクトリはgitリポジトリではありません（★測れませんでした）。');
    process.exit(EXIT.INCONCLUSIVE);
  }

  let porcelain;
  try {
    porcelain = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    console.error('[check-orphan-worktrees] 🟡 git worktree list を実行できませんでした（★緑ではありません）。');
    console.error(`  → 理由: ${e && e.message}`);
    process.exit(EXIT.INCONCLUSIVE);
  }

  const registered = parseWorktreeList(porcelain);
  const folderStates = new Map();
  for (let i = 0; i < registered.length; i += 1) {
    if (i === 0) continue; // メイン自身はスキップ（自分自身が消えていることはない）
    const wt = registered[i];
    const folderExists = existsSync(wt.path);
    if (!folderExists) {
      folderStates.set(wt.path, { folderExists: false, gitdirPointer: null, gitdirTargetExists: null });
      continue;
    }
    const gitFilePath = join(wt.path, '.git');
    let gitdirPointer = null;
    let gitdirTargetExists = null;
    try {
      const stat = existsSync(gitFilePath);
      if (stat) {
        const content = readFileSync(gitFilePath, 'utf8');
        gitdirPointer = parseGitdirPointer(content);
        if (gitdirPointer) {
          const resolvedTarget = isAbsolute(gitdirPointer) ? gitdirPointer : resolve(wt.path, gitdirPointer);
          gitdirTargetExists = existsSync(resolvedTarget);
        }
      }
    } catch { /* 読めなければpointer/targetはnullのまま＝下でorphan扱いに倒れる */ }
    folderStates.set(wt.path, { folderExists: true, gitdirPointer, gitdirTargetExists });
  }

  const r = judgeOrphanWorktrees(registered, folderStates);

  console.log(
    `[check-orphan-worktrees] worktree ${Math.max(registered.length - 1, 0)}件（メイン除く）`
    + ` / ★孤児 ${r.orphans.length} 件`,
  );
  for (const o of r.orphans.slice(0, 20)) {
    console.log(`  🔴 [${o.direction}] ${o.path} — ${o.detail}`);
  }
  if (r.orphans.length > 20) console.log(`  （他 ${r.orphans.length - 20} 件）`);

  if (r.verdict === 'fail') {
    console.error('[check-orphan-worktrees] 🔴 片方向だけ切れたworktreeが見つかりました。');
    console.error('  → gitのどのコマンド（worktree remove / prune / list）でも自動修復されません。');
    console.error('  → ★この検査は削除の可否を判定しません。データ消失リスクがあるため、');
    console.error('    まずオブジェクトの実在（git cat-file -e <sha>）を確認してから対処してください。');
    process.exit(EXIT.FAIL);
  }

  console.log('[check-orphan-worktrees] ✅ 合格（片方向だけ切れたworktreeはありません）。');
  console.log(r.reason ? `  → ${r.reason}` : '');
  process.exit(EXIT.PASS);
}

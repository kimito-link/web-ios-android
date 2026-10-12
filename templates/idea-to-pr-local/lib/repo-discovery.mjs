// @ts-check
/**
 * repo-discovery.mjs — 「このフォルダの配下の全部のプログラム」を、作業の対象として自動で見つける。
 *
 * ■ なぜ
 *   対象を1つずつ設定ファイルに書く方式だと、新しいリポを作るたびに人が設定を足すことになる
 *   （「配下の全部が対象なのに」という指摘）。フォルダの中身（git のリポ）が正本なので、それを読む。
 *
 * ■ 守る線
 *   - 直下の子フォルダだけを見る（深く潜らない）。
 *   - git のリポで、origin が GitHub のものだけ。owner が許可リストに入っているものだけ（他人のリポの clone を巻き込まない）。
 *   - 同じ owner/name が複数のフォルダにあれば、本体（.git がフォルダ）を優先する（worktree や複製を選ばない）。
 *   - 作業は worker が `git worktree add ... origin/<base>` で別の場所に作った作業ツリーでやる。ここで見つけたフォルダの
 *     作業ツリー（未コミットの変更・.env など追跡されていないファイル）は、claude には見えない。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * git の remote URL から owner/name を取り出す。GitHub 以外・壊れた入力は null。
 * @param {unknown} url
 * @returns {string|null}
 */
export function parseGitHubRemote(url) {
  const s = String(url ?? '').trim();
  const m = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(s);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * @param {string} root 例: C:/.../github
 * @param {{allowedOwners:string[], gitCommand?:string[], exclude?:string[]}} opts
 * @returns {{repos: Record<string,{path:string}>, skipped: Array<{dir:string, reason:string}>}}
 */
export function discoverRepos(root, opts) {
  const git = opts.gitCommand && opts.gitCommand.length ? opts.gitCommand : ['git'];
  const owners = new Set((opts.allowedOwners || []).map((o) => String(o).toLowerCase()));
  const exclude = new Set((opts.exclude || []).map((e) => String(e).toLowerCase()));
  /** @type {Record<string,{path:string, isDir:boolean}>} */
  const found = {};
  /** @type {Array<{dir:string, reason:string}>} */
  const skipped = [];
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { repos: {}, skipped: [{ dir: root, reason: '読めない' }] };
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const dir = path.join(root, e.name);
    const dotGit = path.join(dir, '.git');
    if (!fs.existsSync(dotGit)) continue;
    const r = spawnSync(git[0], [...git.slice(1), '-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) {
      skipped.push({ dir, reason: 'origin が無い' });
      continue;
    }
    const full = parseGitHubRemote(r.stdout);
    if (!full) {
      skipped.push({ dir, reason: 'origin が GitHub ではない' });
      continue;
    }
    if (!owners.has(full.split('/')[0].toLowerCase())) {
      skipped.push({ dir, reason: `owner が許可リストに無い（${full}）` });
      continue;
    }
    if (exclude.has(full.toLowerCase())) {
      skipped.push({ dir, reason: '除外指定' });
      continue;
    }
    const isDir = fs.statSync(dotGit).isDirectory();
    const prev = found[full];
    if (!prev || (!prev.isDir && isDir)) found[full] = { path: dir, isDir };
  }
  return { repos: Object.fromEntries(Object.entries(found).map(([k, v]) => [k, { path: v.path }])), skipped };
}

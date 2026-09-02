/**
 * architecture-map-visibility.mjs — 「解析対象」と「公開対象」を分離するための公開可否判定。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか
 *   Architecture Mapの解析自体はgithub/配下の全リポジトリ（private含む）を対象にしてよい。
 *   だがkimito-skill.linkは公開サイトであり、解析結果をそのまま出すとクライアント名・
 *   非公開リポジトリ名・内部ディレクトリ構造が漏れる。「解析対象＝公開対象」にしない。
 *
 * ■ ★どう判定するか（新しい権限管理機構を作らない）
 *   package.json の "private" フラグは npm公開設定であり、GitHub上の公開/非公開とは
 *   別の意味（web-ios-android自体がprivate:trueでもGitHubではpublicリポジトリ、という
 *   実例がある）。これを公開判定の代理指標にすると誤る。
 *   代わりに `gh repo list <org> --json name,visibility` というGitHub側の一次情報を
 *   そのまま使う。新しいallowlist管理UIやDBは作らず、取得結果をJSONにキャッシュするだけ。
 *
 * ■ ★fail-closed
 *   visibilityが確認できないリポジトリ（gh未認証・組織不明・ネットワーク不通等）は
 *   公開対象に含めない（分からない＝非公開扱い。逆にすると事故になる）。
 * ───────────────────────────────────────────────────────────────────────────
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * ★ghコマンドでorgのリポジトリ一覧とvisibilityを取得する。失敗すればnull。
 * @param {string} org
 * @returns {Record<string, 'PUBLIC'|'PRIVATE'>|null}
 */
export function fetchVisibilityFromGitHub(org) {
  try {
    const out = execFileSync('gh', ['repo', 'list', org, '--limit', '200', '--json', 'name,visibility'], {
      encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore']
    });
    const list = JSON.parse(out);
    const map = {};
    for (const r of list) map[r.name] = r.visibility;
    return map;
  } catch {
    return null;
  }
}

/**
 * ★キャッシュファイルを読む。壊れている/無い場合は空オブジェクト。
 * @param {string} cachePath
 * @returns {Record<string, 'PUBLIC'|'PRIVATE'>}
 */
export function readVisibilityCache(cachePath) {
  if (!existsSync(cachePath)) return {};
  try {
    const j = JSON.parse(readFileSync(cachePath, 'utf8'));
    return j && typeof j === 'object' && j.visibility && typeof j.visibility === 'object' ? j.visibility : {};
  } catch {
    return {};
  }
}

/**
 * ★キャッシュを書く。
 * @param {string} cachePath
 * @param {Record<string, 'PUBLIC'|'PRIVATE'>} visibility
 */
export function writeVisibilityCache(cachePath, visibility) {
  writeFileSync(cachePath, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    visibility
  }, null, 2) + '\n');
}

/**
 * ★リポジトリ名から「公開してよいか」を判定する（純関数・fsに触らない）。
 * fail-closed: マップに存在しない・PUBLICでなければ非公開扱い。
 * @param {Record<string, 'PUBLIC'|'PRIVATE'>} visibilityMap
 * @param {string} repoName
 * @returns {boolean}
 */
export function isPublishable(visibilityMap, repoName) {
  return visibilityMap[repoName] === 'PUBLIC';
}

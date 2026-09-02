/**
 * architecture-map-aggregate.mjs — github/配下を解析して内部データ（internal-map-data）を組み立てる。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ 何をするか
 *   1リポジトリごとの解析結果（architecture-map-core.mjsのscanRepoStructure/gitSnapshot/
 *   gitTrackedFiles）に、PAIRS（正本/コピー）とai-hub登録の情報を注釈し、github/配下
 *   全体の内部データを1つのオブジェクトへ組み立てる。
 *
 * ■ ★2026-09-02、コンポーネント化で切り出し（/componentizeスキル・council-fable設計）
 *   generate-architecture-map.mjs（当時746行）から移動。挙動は1文字も変えない。
 *   設計書: _docs/DESIGN-architecture-map-componentize-2026-09-02.md
 *
 * ■ ★解析対象＝全リポ（privateを含む）。公開可否はここでは判定しない
 *   （公開可否はarchitecture-map-public-view.mjsの責務。「解析対象」と「公開対象」を
 *   混ぜない、というv1からの設計思想を維持する）。
 * ───────────────────────────────────────────────────────────────────────────
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gitSnapshot, gitTrackedFiles, scanRepoStructure, findPairsRole } from './architecture-map-core.mjs';

/**
 * ★1リポジトリの解析結果に、PAIRS/ai-hub登録の情報を突き合わせて注釈する。
 * @param {{nodes:object[], edges:object[], errors:string[]}} scan
 * @param {string} repoDir
 * @param {Array<{label:string, canonical:string, copies:string[]}>} pairs PAIRS（ai-hub不在ならnull）
 * @param {Set<string>} aiHubPaths ai-hub/index.jsonに登録済みの `repo/relpath` 集合（ai-hub不在ならnull）
 * @param {string} repoName
 */
export function annotateNodes(scan, repoDir, pairs, aiHubPaths, repoName) {
  return scan.nodes.map((n) => {
    // ★n.pathはscanRepoStructure内で既にPOSIX区切り('/')に正規化済み。
    //   joinはPOSIX文字列を渡してもWindows上で正しく絶対パスへ復元できる。
    const abs = join(repoDir, ...n.path.split('/'));
    const pairsRole = pairs ? findPairsRole(pairs, abs) : null;
    const aiHubKey = `${repoName}/${n.path}`;
    return {
      ...n,
      pairs: pairsRole, // {role:'canonical'|'copy', label} または null
      aiHubRegistered: aiHubPaths ? aiHubPaths.has(aiHubKey) : null // null=測っていない(ai-hub不在)
    };
  });
}

/**
 * ★ai-hub/index.jsonから `repo/relpath` 形式のpath集合を作る。ai-hub不在ならnull。
 * @param {string} githubRoot
 * @returns {Set<string>|null}
 */
export function loadAiHubPaths(githubRoot) {
  const indexPath = join(githubRoot, 'ai-hub', 'index.json');
  if (!existsSync(indexPath)) return null;
  try {
    const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
    return new Set((idx.entries || []).map((e) => String(e.path || '').split('\\').join('/')));
  } catch {
    return null;
  }
}

/**
 * ★check-drift.mjsのPAIRSをimportする。ai-hub/web-ios-androidの配置に依存するファイルなので、
 * 存在しない・importできない場合はnull（fail-closedというよりinconclusive: 測れなかった扱い）。
 * @param {string} githubRoot
 * @returns {Promise<Array<{label:string, canonical:string, copies:string[]}>|null>}
 */
export async function loadPairs(githubRoot) {
  const p = join(githubRoot, 'web-ios-android', '_docs', 'instruments', 'check-drift.mjs');
  if (!existsSync(p)) return null;
  try {
    const mod = await import(pathToFileURL(p).href);
    return Array.isArray(mod.PAIRS) ? mod.PAIRS : null;
  } catch {
    return null;
  }
}

/**
 * ★1リポジトリをLevel2(ディレクトリ)/Level3(ファイル)の集約ビューへ畳む。
 * @param {object[]} nodes annotateNodes()の出力
 */
export function buildDirectoryRollup(nodes) {
  const dirs = new Map();
  for (const n of nodes) {
    const parts = n.path.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '(root)';
    if (!dirs.has(dir)) dirs.set(dir, { path: dir, fileCount: 0, gateCount: 0, gateCandidateCount: 0, pairsCount: 0 });
    const d = dirs.get(dir);
    d.fileCount++;
    if (n.isGate) d.gateCount++; // ★事実（正本GATE_REに一致）
    if (n.gateCandidate) d.gateCandidateCount++; // ★推測（.js命名規則のみ、heuristic）
    if (n.pairs) d.pairsCount++;
  }
  return [...dirs.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * ★全体を集計する（メイン入口・純関数寄り。fsアクセスはscanRepoStructure等に委譲）。
 * @param {string} githubRoot
 * @param {{fetchVisibility: boolean}} opts
 */
export async function buildArchitectureMap(githubRoot, opts = {}) {
  // ★hub-kit-matrix.mjsのdiscoverProjects/EXCLUDED_PROJECTSは意図的に使わない。
  //   あちらは「出荷ゲート導入マトリクスに載せるプロジェクトか」というmatrix固有の判定
  //   （Capacitor/TWA/Expo等のkit対象判定で絞る・web-ios-android/ai-hub自身を除外する理由も
  //   「載せると全ゲート導入済に見える偽の全緑になる」というmatrix特有の事情）であり、
  //   Architecture Mapの目的（github/配下の現在地を俯瞰する）とは一致しない。
  //   ★特にweb-ios-android自身は今回の仕組みの中心であり、除外する理由が無い
  //   （2026-09-02指摘: 既存部品の再利用が「意味」まで誤って引き継いでいた）。
  //   ここでは「隠しディレクトリでないこと」だけを条件にする独自の対象選定を行う。
  //
  // ★シンボリックリンク/ディレクトリジャンクションは対象外にする（hub-kit-matrix.mjsの
  //   walkFilesと同じ方針＝ループ防止）。Dirent.isDirectory()はreparse point（Windowsの
  //   ジャンクション含む）でfalseを返すため、素の.isDirectory()フィルタだけだと該当ディレクトリが
  //   ★無言で欠落する（実測: tsuioku-no-kirameki.comがジャンクションで、これにより発覚）。
  //   fail-closedの原則(README掟)に従い、無言で欠けさせず skippedReparsePoints として記録する。
  const { readdirSync } = await import('node:fs');
  const rawEntries = readdirSync(githubRoot, { withFileTypes: true });
  const skippedReparsePoints = rawEntries
    .filter((e) => e.isSymbolicLink() && !e.name.startsWith('.'))
    .map((e) => e.name);
  const allDirs = rawEntries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  const pairs = await loadPairs(githubRoot);
  const aiHubPaths = loadAiHubPaths(githubRoot);

  const repos = [];
  for (const name of allDirs) {
    const dir = join(githubRoot, name);
    const snapshot = gitSnapshot(dir);
    const scan = scanRepoStructure(dir, name);
    const nodes = annotateNodes(scan, dir, pairs, aiHubPaths, name);
    // ★trackedFiles: 公開View構築時に「Git管理下＝pushされた可能性のあるファイル」だけへ
    //   絞り込むための材料。内部データにも保持しておき、公開View側で再度gitを呼ばない。
    const trackedFiles = gitTrackedFiles(dir);
    repos.push({
      name,
      head: snapshot?.head || null,
      dirty: snapshot?.dirty ?? null, // null=git管理外・測れなかった
      fileCount: nodes.length,
      gateCount: nodes.filter((n) => n.isGate).length, // ★事実（正本GATE_REに一致）
      gateCandidateCount: nodes.filter((n) => n.gateCandidate).length, // ★推測（heuristic）
      directories: buildDirectoryRollup(nodes),
      nodes,
      edges: scan.edges,
      trackedFiles: trackedFiles ? [...trackedFiles] : null,
      scanErrors: scan.errors
    });
  }

  return {
    repos,
    skippedReparsePoints,
    pairsAvailable: pairs !== null,
    aiHubAvailable: aiHubPaths !== null
  };
}

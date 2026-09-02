#!/usr/bin/env node
/**
 * generate-architecture-map.mjs — 「今あるコードの現在地」をgithub/配下から機械生成する。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ 何をするか
 *   github/ 配下の全リポジトリ（隠しディレクトリを除く）を解析し、
 *   ①各リポのgit snapshot（HEAD/dirty） ②templates/scripts/等のimport関係
 *   ③PAIRS（正本/コピー） ④ai-hub登録有無 ⑤Gate（check-系/verify-系ファイル）の有無
 *   を集めた internal-map-data.json（全リポジトリ・非公開）を書く。
 *
 *   さらに、GitHub上でPUBLICと確認できたリポジトリだけに絞った
 *   site/hub/architecture-map/map-data.json（公開・kimito-skill.link用）を書く。
 *
 * ■ ★v1の思想（README/CLAUDE.mdの議論を踏まえた設計判断）
 *   - 解析対象と公開対象を分離する（internal-map-data.jsonは全リポ、公開データはallowlistのみ）
 *   - 類似コード・共通化候補の自動判定はしない（import構造が似ているだけを「類似」と
 *     表示すると誤判定で人間・AIを迷わせる）
 *   - PAIRSのcanonicalは「正本」であって「共通コンポーネント」とは呼ばない
 *   - github/配下全体を1枚の依存グラフにしない。progressive disclosure用に
 *     Level1(リポ一覧)/Level2(ディレクトリ)/Level3(ファイル詳細)へ集約したビューも書き出す
 *   - ai-hubはローカル専用（remote無し）のため、Architecture Map生成自体を
 *     deploy:siteの必須依存にしない。npm run hub:architecture-map で明示的に実行する
 *
 * ■ 車輪の再発明をしない
 *   1リポジトリ内のfs walk・除外ディレクトリ: scripts/lib/hub-kit-matrix.mjs（walkFiles/EXCLUDED_DIRS）
 *   Gate判定: templates/diagnostics/check-gates-are-wired.mjs（GATE_RE、そのままimport）
 *   ファイル収集・import解析: scripts/lib/architecture-map-core.mjs（今回新規）
 *   公開可否判定: scripts/lib/architecture-map-visibility.mjs（今回新規、ghのvisibilityをそのまま使う）
 *   ★github/直下のプロジェクト一覧選定（EXCLUDED_PROJECTS等）は再利用しない。
 *   hub-kit-matrix.mjs側の除外は出荷ゲートマトリクス固有の事情であり、Architecture Mapの
 *   目的（github/配下全体の俯瞰）とは意味が異なるため（2026-09-02、web-ios-android自身が
 *   誤って除外されていた反省を踏まえた設計判断）。
 *
 * ■ 使い方
 *   node scripts/generate-architecture-map.mjs
 *   node scripts/generate-architecture-map.mjs --skip-visibility-fetch   # ghを呼ばずキャッシュのみ使う
 *   node scripts/generate-architecture-map.mjs --selftest
 * ───────────────────────────────────────────────────────────────────────────
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gitSnapshot, gitTrackedFiles, scanRepoStructure, findPairsRole, classifyGate } from './lib/architecture-map-core.mjs';
import { fetchVisibilityFromGitHub, readVisibilityCache, writeVisibilityCache, isPublishable } from './lib/architecture-map-visibility.mjs';
import { TREE_VIEW_CSS } from './lib/tree-view-component.mjs';
import { findRepoRoot } from './lib/repo-root.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
const argv = process.argv.slice(2);
const SKIP_VISIBILITY_FETCH = argv.includes('--skip-visibility-fetch');

/**
 * ★1リポジトリの解析結果に、PAIRS/ai-hub登録の情報を突き合わせて注釈する。
 * @param {{nodes:object[], edges:object[], errors:string[]}} scan
 * @param {string} repoDir
 * @param {Array<{label:string, canonical:string, copies:string[]}>} pairs PAIRS（ai-hub不在ならnull）
 * @param {Set<string>} aiHubPaths ai-hub/index.jsonに登録済みの `repo/relpath` 集合（ai-hub不在ならnull）
 * @param {string} repoName
 */
function annotateNodes(scan, repoDir, pairs, aiHubPaths, repoName) {
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
function loadAiHubPaths(githubRoot) {
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
async function loadPairs(githubRoot) {
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
function buildDirectoryRollup(nodes) {
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
async function buildArchitectureMap(githubRoot, opts = {}) {
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

/**
 * ★内部データから公開データを切り出す。allowlist(visibilityMap経由)に無いリポは
 * 名前もパスも一切含めない（存在自体を伏せる。「非公開」と明示するのではなく丸ごと省く）。
 *
 * ★公開Mapのソースはローカル作業ツリーではなく「Git管理下のファイル」に限定する
 * （2026-09-02、実損の指摘を受けて修正）。GitHub visibility=PUBLICは「pushされた内容が
 * 公開されている」ことしか意味しない。untrackedファイル・gitignore対象の一時ファイルは
 * GitHub上では公開されていないため、ローカルfs walkの結果をそのまま公開Mapへ出すと
 * 実際には公開されていない情報まで漏れる。v1では複雑な仕組み（HEADのblobを直接読む等）を
 * 避け、次の2条件だけで安全側に倒す:
 *   1. `git ls-files` に含まれるファイルだけを対象にする
 *   2. working treeがdirty(未コミット変更あり)なリポは丸ごと公開Mapから除外する
 *      （dirtyだと「どのファイルが安全か」の境界がuntracked/変更差分の混在で複雑になるため、
 *      v1では個別ファイル単位の精査はせずリポ単位で除外する）
 * dirty判定が測れなかった(null)リポも安全側に倒し、除外する。
 *
 * @param {{repos:object[]}} internalData
 * @param {Record<string,'PUBLIC'|'PRIVATE'>} visibilityMap
 */
function buildPublicView(internalData, visibilityMap) {
  let excludedNotPublic = 0;
  let excludedDirtyTrue = 0;
  let excludedDirtyUnknown = 0;
  const publicRepos = [];

  for (const r of internalData.repos) {
    if (!isPublishable(visibilityMap, r.name)) { excludedNotPublic++; continue; }
    // ★除外理由を区別する（2026-09-02指摘: dirty=trueとdirty=null/測定不能は意味が違う）。
    if (r.dirty === true) { excludedDirtyTrue++; continue; }
    if (r.dirty !== false) { excludedDirtyUnknown++; continue; } // ★dirty===null（測れなかった）
    if (!Array.isArray(r.trackedFiles)) { excludedDirtyUnknown++; continue; } // ★tracked一覧が取れなければ同じ「測れなかった」扱い

    const trackedSet = new Set(r.trackedFiles);
    const nodes = r.nodes.filter((n) => trackedSet.has(n.path));
    const edges = r.edges.filter((e) => trackedSet.has(e.from) && trackedSet.has(e.to));
    const directories = buildDirectoryRollup(nodes);

    publicRepos.push({
      name: r.name,
      head: r.head,
      dirty: r.dirty, // 常にfalse（フィルタ済み）だが、スキーマの一貫性のため残す
      fileCount: nodes.length,
      gateCount: nodes.filter((n) => n.isGate).length, // ★事実
      gateCandidateCount: nodes.filter((n) => n.gateCandidate).length, // ★推測（heuristic）
      directories,
      nodes,
      edges
    });
  }

  const publicCandidateCount = publicRepos.length + excludedDirtyTrue + excludedDirtyUnknown; // ★visibility=PUBLICだった総数（dirty判定前）
  return {
    repos: publicRepos,
    excludedCount: internalData.repos.length - publicRepos.length, // 後方互換（非公開理由の総計）
    publicCandidateCount,
    excludedNotPublicCount: excludedNotPublic,
    excludedDirtyTrueCount: excludedDirtyTrue,     // ★working treeに未コミット変更ありで除外
    excludedDirtyUnknownCount: excludedDirtyUnknown // ★dirty判定・tracked一覧のいずれかが測れず除外
  };
}

/* ── --selftest ─────────────────────────────────────────────── */
if (isMain && argv.includes('--selftest')) {
  const fails = [];
  // isPublishable: allowlistに無ければfalse(fail-closed)
  if (isPublishable({ a: 'PUBLIC' }, 'b') !== false) fails.push('未知リポを公開扱いにした');
  if (isPublishable({ a: 'PUBLIC' }, 'a') !== true) fails.push('PUBLICなリポを公開扱いにできない');
  if (isPublishable({ a: 'PRIVATE' }, 'a') !== false) fails.push('PRIVATEなリポを公開扱いにした');
  // buildPublicView: allowlist外のリポの名前が公開データに一切現れない
  {
    const internal = {
      repos: [{
        name: 'secret-client', head: 'a', dirty: false, fileCount: 1, gateCount: 0,
        directories: [], nodes: [], edges: [], trackedFiles: []
      }]
    };
    const pub = buildPublicView(internal, {});
    if (JSON.stringify(pub).includes('secret-client')) fails.push('非公開リポ名が公開データに漏れた');
    if (pub.excludedCount !== 1) fails.push('除外件数が正しく数えられていない');
  }
  // buildPublicView: dirtyなリポは(visibilityがPUBLICでも)公開しない
  {
    const internal = {
      repos: [{
        name: 'public-but-dirty', head: 'a', dirty: true, fileCount: 1, gateCount: 0,
        directories: [], nodes: [{ path: 'a.mjs', name: 'a.mjs', isGate: false }], edges: [],
        trackedFiles: ['a.mjs']
      }]
    };
    const pub = buildPublicView(internal, { 'public-but-dirty': 'PUBLIC' });
    if (pub.repos.length !== 0) fails.push('★dirtyなリポを公開してしまった');
    if (pub.excludedDirtyTrueCount !== 1) fails.push('dirty=true除外件数が正しく数えられていない');
    if (pub.excludedDirtyUnknownCount !== 0) fails.push('dirty=trueをdirty不明として数えてしまった');
  }
  // buildPublicView: untrackedファイルは公開データのnodes/edgesに一切現れない
  {
    const internal = {
      repos: [{
        name: 'clean-repo', head: 'a', dirty: false, fileCount: 2, gateCount: 0,
        directories: [],
        nodes: [
          { path: 'tracked.mjs', name: 'tracked.mjs', isGate: false },
          { path: 'secret-untracked.mjs', name: 'secret-untracked.mjs', isGate: false }
        ],
        edges: [{ from: 'tracked.mjs', to: 'secret-untracked.mjs' }],
        trackedFiles: ['tracked.mjs'] // ★secret-untracked.mjsはtrackedFilesに含まれない=untracked
      }]
    };
    const pub = buildPublicView(internal, { 'clean-repo': 'PUBLIC' });
    const asStr = JSON.stringify(pub);
    if (asStr.includes('secret-untracked')) fails.push('★untrackedファイル名が公開データに漏れた');
    if (pub.repos[0]?.nodes.length !== 1) fails.push('trackedFilesでの絞り込みが効いていない');
    if (pub.repos[0]?.edges.length !== 0) fails.push('untrackedファイルを含む辺が公開データに残った');
  }
  // buildPublicView: dirty判定が測れなかった(null)リポも安全側に倒して除外する
  {
    const internal = {
      repos: [{
        name: 'unknown-dirty', head: null, dirty: null, fileCount: 1, gateCount: 0,
        directories: [], nodes: [], edges: [], trackedFiles: null
      }]
    };
    const pub = buildPublicView(internal, { 'unknown-dirty': 'PUBLIC' });
    if (pub.repos.length !== 0) fails.push('★dirty不明(null)のリポを公開してしまった');
    if (pub.excludedDirtyUnknownCount !== 1) fails.push('dirty不明の除外件数が正しく数えられていない（dirty=trueと混同した可能性）');
  }
  // classifyGate: 正本GATE_RE一致(事実)とファイル名heuristic一致(推測)を混同しない
  {
    const fact = classifyGate('check-improvement.mjs');
    if (!fact.isGate || fact.gateCandidate || fact.classification !== 'fact') {
      fails.push('★正本GATE_RE一致(.mjs)をisGate:true/factとして扱えていない');
    }
    const heuristic = classifyGate('check-improvement.js');
    if (heuristic.isGate || !heuristic.gateCandidate || heuristic.classification !== 'heuristic') {
      fails.push('★.js命名規則一致をisGate:trueに昇格させてしまっている（事実と推測の混同）');
    }
    const neither = classifyGate('random-utils.mjs');
    if (neither.isGate || neither.gateCandidate || neither.classification !== null) {
      fails.push('★Gateでもcandidateでもないファイルを誤検知した');
    }
  }
  // buildTree: 中間ディレクトリの欠落を検知する（実データでapp/apiがdirectoriesから
  // 欠けていた実損の再発防止。directoriesではなくnodesから組む設計の根拠）。
  {
    const nodes = [
      { path: 'app/api/lookup/route.ts', name: 'route.ts', isGate: false, gateCandidate: false, pairs: null, aiHubRegistered: null },
      { path: 'app/page.tsx', name: 'page.tsx', isGate: false, gateCandidate: false, pairs: null, aiHubRegistered: null },
      { path: 'next.config.mjs', name: 'next.config.mjs', isGate: false, gateCandidate: false, pairs: null, aiHubRegistered: null }
    ];
    const tree = buildTree(nodes);
    const app = tree.dirs.get('app');
    const api = app && app.dirs.get('api');
    const lookup = api && api.dirs.get('lookup');
    if (!app) fails.push('★buildTree: appディレクトリが組み立てられていない');
    else if (!api) fails.push('★buildTree: 中間ディレクトリ(app/api)が欠落した(実損の再発)');
    else if (!lookup) fails.push('★buildTree: app/api/lookupが欠落した');
    if (tree.files.length !== 1) fails.push('★buildTree: ルート直下ファイル(next.config.mjs)の数が正しくない');
    if (tree.agg.files !== 3) fails.push('★buildTree: ルートの集計files数が3件になっていない（集計の合算漏れ）');
  }
  // buildTree: 事実(isGate)と推測(gateCandidate)の集計を混同しない
  {
    const nodes = [
      { path: 'src/check-a.mjs', name: 'check-a.mjs', isGate: true, gateCandidate: false, pairs: null, aiHubRegistered: null },
      { path: 'src/check-b.js', name: 'check-b.js', isGate: false, gateCandidate: true, pairs: null, aiHubRegistered: null }
    ];
    const tree = buildTree(nodes);
    const src = tree.dirs.get('src');
    if (!src || src.agg.gate !== 1) fails.push('★buildTree: Gate(事実)の集計が正しくない');
    if (!src || src.agg.gateCandidate !== 1) fails.push('★buildTree: Gate候補(推測)の集計が正しくない');
  }

  if (fails.length) {
    console.error('[generate-architecture-map] ★selftest 失敗:');
    for (const f of fails) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('[generate-architecture-map] selftest OK（未知リポ・PRIVATE・dirty・dirty不明のリポを公開しない / untrackedファイルを漏らさない / 中間ディレクトリを欠落させない / 事実推測の集計を混同しない）');
  process.exit(0);
}

/* ── 実行 ────────────────────────────────────────────────────── */
if (isMain && !argv.includes('--selftest')) {
  const githubRoot = resolve(findRepoRoot(HERE), '..');
  console.log(`[generate-architecture-map] 解析対象: ${githubRoot}`);

  const t0 = Date.now();
  const internalData = await buildArchitectureMap(githubRoot);
  const elapsedMs = Date.now() - t0;

  const webIosAndroidRoot = join(githubRoot, 'web-ios-android');
  const internalOutPath = join(webIosAndroidRoot, '.architecture-map-internal.json');
  writeFileSync(internalOutPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generationMs: elapsedMs,
    pairsAvailable: internalData.pairsAvailable,
    aiHubAvailable: internalData.aiHubAvailable,
    skippedReparsePoints: internalData.skippedReparsePoints,
    repos: internalData.repos
  }, null, 2) + '\n');
  console.log(`[generate-architecture-map] 内部データ(全${internalData.repos.length}リポ): ${internalOutPath}`);
  if (internalData.skippedReparsePoints.length) {
    console.log(`[generate-architecture-map] 🟡 シンボリックリンク/ジャンクションのため未解析: ${internalData.skippedReparsePoints.join(', ')}`);
  }

  // ★visibility取得: --skip-visibility-fetchなら既存キャッシュのみ使う(gh未認証環境向け)。
  const visibilityCachePath = join(webIosAndroidRoot, '.architecture-map-visibility-cache.json');
  let visibilityMap = readVisibilityCache(visibilityCachePath);
  if (!SKIP_VISIBILITY_FETCH) {
    const fetched = fetchVisibilityFromGitHub('kimito-link');
    if (fetched) {
      visibilityMap = fetched;
      writeVisibilityCache(visibilityCachePath, visibilityMap);
    } else {
      console.log('[generate-architecture-map] 🟡 GitHub visibility取得に失敗。既存キャッシュを使います（無ければ全リポ非公開扱い）');
    }
  }

  const publicView = buildPublicView(internalData, visibilityMap);
  const publicOutDir = join(webIosAndroidRoot, 'site', 'hub', 'architecture-map');
  mkdirSync(publicOutDir, { recursive: true });
  const publicOutPath = join(publicOutDir, 'map-data.json');
  writeFileSync(publicOutPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generationMs: elapsedMs,
    note: '解析対象はgithub/配下の全リポジトリだが、ここにはGitHub上でPUBLICと確認できたリポジトリのうち、'
      + 'working treeがdirtyでないものだけを、git ls-files で追跡されているファイルのみに絞って含む',
    ...publicView
  }, null, 2) + '\n');

  const publicHtmlPath = join(publicOutDir, 'index.html');
  writeFileSync(publicHtmlPath, renderHtml());

  console.log(
    `[generate-architecture-map] 公開データ: PUBLIC候補${publicView.publicCandidateCount}件`
    + ` → 公開${publicView.repos.length}件`
    + `（PUBLICでないため除外${publicView.excludedNotPublicCount}件`
    + ` / dirty=trueで除外${publicView.excludedDirtyTrueCount}件`
    + ` / dirty不明で除外${publicView.excludedDirtyUnknownCount}件）: ${publicOutPath}`
  );
  console.log(`[generate-architecture-map] 公開ページ: ${publicHtmlPath}`);
  console.log(`[generate-architecture-map] 生成時間: ${elapsedMs}ms`);
}

/**
 * ★フラットなファイルパス配列から、ネストしたディレクトリツリーを組み立てる（純関数）。
 *
 * ★2026-09-02、Fable設計により追加。「コードの図がぱっとわからない」というフィードバックを
 * 受け、progressive disclosure（1階層ずつクリックで掘る）から、フォルダアイコン＋接続線の
 * 視覚的なツリー表示へ作り替える際の中核ロジック。
 *
 * ★これは「表示用データ整形」であり、新しい解析ロジックではない。既存の真偽値
 * （isGate/gateCandidate/pairs/aiHubRegistered）を判定・変更・推測することは一切せず、
 * パスを`/`で分割してネストし、既存フラグを合計するだけ（buildDirectoryRollupと同種の集計）。
 *
 * ★repo.directoriesではなくrepo.nodesから組む。directoriesは「ファイルを直接含む
 * ディレクトリ」しか持たず、中間ディレクトリ（例: app/apiにファイルが無くapp/api/lookupにだけ
 * ある場合のapi）が欠落する（実データで確認済み）。
 *
 * ★この関数はモジュールスコープの外部参照を一切持たない自己完結関数にする。
 * クライアントサイドJSへ`${buildTree.toString()}`として文字列埋め込みするため
 * （変数・import・他関数の参照があると埋め込み先でReferenceErrorになる）。
 *
 * @param {Array<{path:string, name:string, isGate:boolean, gateCandidate:boolean, pairs:object|null, aiHubRegistered:boolean|null}>} nodes
 * @returns {object} ルートディレクトリノード
 */
function buildTree(nodes) {
  function emptyAgg() { return { files: 0, gate: 0, gateCandidate: 0, pairs: 0, aiHub: 0 }; }
  function newDir(name, path) {
    return { kind: 'dir', name, path, dirs: new Map(), files: [], agg: emptyAgg() };
  }
  const root = newDir('', '');

  for (const n of (Array.isArray(nodes) ? nodes : [])) {
    const parts = String(n.path || '').split('/').filter(Boolean);
    if (parts.length === 0) continue;
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!cur.dirs.has(seg)) {
        cur.dirs.set(seg, newDir(seg, cur.path ? cur.path + '/' + seg : seg));
      }
      cur = cur.dirs.get(seg);
    }
    cur.files.push(n);
  }

  function aggregate(dir) {
    for (const f of dir.files) {
      dir.agg.files++;
      if (f.isGate) dir.agg.gate++;
      if (f.gateCandidate) dir.agg.gateCandidate++;
      if (f.pairs) dir.agg.pairs++;
      if (f.aiHubRegistered === true) dir.agg.aiHub++;
    }
    for (const child of dir.dirs.values()) {
      aggregate(child);
      dir.agg.files += child.agg.files;
      dir.agg.gate += child.agg.gate;
      dir.agg.gateCandidate += child.agg.gateCandidate;
      dir.agg.pairs += child.agg.pairs;
      dir.agg.aiHub += child.agg.aiHub;
    }
  }
  aggregate(root);

  function sortRec(dir) {
    dir.files.sort((a, b) => a.name.localeCompare(b.name));
    dir.dirs = new Map([...dir.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    for (const child of dir.dirs.values()) sortRec(child);
  }
  sortRec(root);

  return root;
}

/**
 * ★公開データを読み込むだけの静的HTML（フォルダツリー表示 UI）を生成する。
 * データ本体はmap-data.jsonから取得し、HTML自身には解析結果の値を埋め込まない
 * （生成のたびに差分が肥大化しない・「生成物・手編集禁止」という既存パターンに合わせる）。
 */
function renderHtml() {
  return `<!-- 生成物・手編集禁止。正本はgithub/配下の実コード。再生成は npm run hub:architecture-map -->
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>Architecture Map — 今あるコードの現在地</title>
<style>
${TREE_VIEW_CSS}
  body { font-family: system-ui, sans-serif; max-width: 1000px; margin: 2rem auto; padding: 0 1rem; color: #222; background: #fff; }
  h1 { font-size: 1.4rem; }
  .intro { color: #444; font-size: 0.92rem; line-height: 1.7; margin: 0.6rem 0 1rem; }
  .meta { color: #666; font-size: 0.85rem; margin-bottom: 1.2rem; }
  .meta.stale { color: #b00; font-weight: bold; }
  .toolbar { display: flex; gap: 0.6rem; margin-bottom: 0.8rem; }
  .toolbar button { font-size: 0.82rem; padding: 0.3rem 0.7rem; border: 1px solid #ccc; border-radius: 5px;
    background: #fafafa; cursor: pointer; }
  .toolbar button:hover { background: #eee; }
  .legend { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.8rem 0 1.5rem; font-size: 0.8rem; }
  .legend .chip { margin-left: 0; }
  .legend-note { color: #666; }
  .empty-note { color: #888; font-style: italic; font-size: 0.85rem; }
  .disclaimer { color: #888; font-size: 0.78rem; margin-top: 2rem; border-top: 1px solid #eee; padding-top: 0.8rem; line-height: 1.6; }

  /* --- Architecture Map固有: リポ単位のラッパー・チップの色・ファイル詳細 --- */
  .repo { margin-bottom: 1.6rem; border: 1px solid #e2e2e2; border-radius: 8px; padding: 0.8rem 1rem; overflow-x: auto; }
  .repo-head { font-size: 1rem; font-weight: 700; margin-bottom: 0.3rem; }
  .repo-head .count { font-weight: normal; color: #888; font-size: 0.82rem; }
  .chip-gate { color: #6a1b9a; border-color: #6a1b9a; background: #f3e5f5; }
  .chip-canonical { color: #1b5e20; border-color: #1b5e20; background: #e8f5e9; }
  .chip-copy { color: #a05a00; border-color: #a05a00; background: #fff3e0; }
  .chip-aihub { color: #0d47a1; border-color: #0d47a1; background: #e3f2fd; }
  .chip-guess-gate, .chip-platform { color: #6a4b7c; border-color: #6a4b7c; }

  .file-detail { background: #fafafa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 0.8rem 1rem; margin: 0.3rem 0 0.6rem 1.6rem; white-space: normal; }
  .file-detail dt { font-weight: 600; margin-top: 0.5rem; font-size: 0.82rem; color: #555; }
  .file-detail dd { margin: 0.15rem 0 0; font-size: 0.86rem; }

  @media (max-width: 600px) {
    .repo { padding: 0.6rem 0.7rem; }
  }
</style>
</head>
<body>
<h1>🗺 Architecture Map — 今あるコードの現在地</h1>
<p class="intro">
  コードの構造を変えるための図ではありません。<b>今のコードから機械的に生成した「現在地」</b>です。
  図とコードが食い違ったら、正しいのはコードです。この図は毎回コードから作り直します。
</p>
<div id="meta" class="meta">読み込み中…</div>

<div class="toolbar">
  <button type="button" id="expand-all">すべて開く</button>
  <button type="button" id="collapse-all">すべて閉じる</button>
</div>

<div class="legend">
  <span class="chip fact chip-canonical">正本</span><span class="legend-note">PAIRS canonical・同期関係の基準（再利用推奨の意味ではありません）</span>
  <span class="chip fact chip-copy">同期対象</span><span class="legend-note">PAIRS copy</span>
  <span class="chip fact chip-aihub">ai-hub</span><span class="legend-note">ai-hub登録済み</span>
  <span class="chip fact chip-gate">Gate</span><span class="legend-note">事実（正本 check-gates-are-wired.mjs の判定基準に一致）</span>
  <span class="chip guess chip-guess-gate">Gate候補(推測)</span><span class="legend-note">ファイル名の命名規則のみ・確定情報ではありません</span>
</div>
<p class="legend-note" style="font-size:0.78rem;margin-top:-0.6rem">実線・塗り＝事実（機械的に確認済み） ／ 破線・白抜き＝推測（heuristic、断定ではありません）</p>

<div id="content"></div>

<p class="disclaimer">
  ここに表示されるのはGitHub上で公開（Public）と確認できたリポジトリのうち、working treeが
  クリーン（未コミット変更なし）なものだけです。ファイルも<code>git ls-files</code>で追跡されている
  ものだけに絞っています。untrackedファイル・未コミット変更・非公開リポジトリの名前や構造は
  一切この画面に出しません。「似ているから同じ部品」という自動判定はしていません（v1では意図的に
  入れていません）。<b>Gate・platform固有は「事実（正本の判定基準に一致）」と「推測（ファイル名からの
  heuristic）」を明確に分けて表示しています</b>。正本の色分けは正しさの保証ではなく、既存データからの
  機械的な事実表示です。
</p>

<script>
(function () {
  const contentEl = document.getElementById('content');
  const metaEl = document.getElementById('meta');

  // ★buildTree: generate-architecture-map.mjs の同名関数をそのまま文字列埋め込みしたもの。
  // 表示用データ整形のみ（isGate/gateCandidate/pairs等の判定・変更・推測は一切しない）。
  ${buildTree.toString()}

  fetch('./map-data.json', { cache: 'no-store' })
    .then((r) => r.json())
    .then((data) => {
      renderMeta(data);
      renderRepos(data);
    })
    .catch((e) => {
      contentEl.innerHTML = '<p class="empty-note">map-data.json を読み込めませんでした: ' + escapeHtml(String(e)) + '</p>';
    });

  document.getElementById('expand-all').addEventListener('click', () => {
    contentEl.querySelectorAll('details').forEach((d) => { d.open = true; });
  });
  document.getElementById('collapse-all').addEventListener('click', () => {
    contentEl.querySelectorAll('details').forEach((d, i) => { d.open = i === 0; }); // ルートだけ残す
  });

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderMeta(data) {
    const genAt = data.generatedAt ? new Date(data.generatedAt) : null;
    const genStr = genAt ? genAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) + ' (JST)' : '不明';
    const ageDays = genAt ? Math.floor((Date.now() - genAt.getTime()) / 86400000) : null;
    const stale = ageDays !== null && ageDays > 30;
    metaEl.className = 'meta' + (stale ? ' stale' : '');
    metaEl.innerHTML =
      '最終更新: <b>' + genStr + '</b>' +
      (ageDays !== null ? '（' + ageDays + '日前' + (stale ? ' — 30日超・古い可能性があります' : '') + '）' : '') +
      ' / 生成時間: ' + (data.generationMs ?? '不明') + 'ms' +
      ' / 公開リポ ' + (data.repos ? data.repos.length : 0) + '件' +
      '（PUBLIC候補 ' + (data.publicCandidateCount ?? '不明') + '件 のうち、' +
      '未コミット変更ありで除外 ' + (data.excludedDirtyTrueCount ?? 0) + '件・' +
      'dirty判定不能で除外 ' + (data.excludedDirtyUnknownCount ?? 0) + '件）';
  }

  /** ★事実/推測チップを組み立てる。1つの要素に混同させない（属性ごとに別チップ）。 */
  function nodeChips(n) {
    const chips = [];
    if (n.pairs && n.pairs.role === 'canonical') chips.push('<span class="chip fact chip-canonical">正本</span>');
    if (n.pairs && n.pairs.role === 'copy') chips.push('<span class="chip fact chip-copy">同期対象</span>');
    if (n.aiHubRegistered === true) chips.push('<span class="chip fact chip-aihub">ai-hub</span>');
    if (n.isGate) chips.push('<span class="chip fact chip-gate">Gate</span>');
    if (n.gateCandidate) chips.push('<span class="chip guess chip-guess-gate">Gate候補(推測)</span>');
    if (n.platformHint) chips.push('<span class="chip guess chip-platform">' + escapeHtml(n.platformHint) + '(推測)</span>');
    return chips.join('');
  }

  /** ★ディレクトリの部分木集計チップ（0件は出さない）。 */
  function dirChips(agg) {
    const chips = [];
    if (agg.gate) chips.push('<span class="chip fact chip-gate">Gate ' + agg.gate + '</span>');
    if (agg.gateCandidate) chips.push('<span class="chip guess chip-guess-gate">Gate候補 ' + agg.gateCandidate + '(推測)</span>');
    if (agg.pairs) chips.push('<span class="chip fact chip-canonical">PAIRS ' + agg.pairs + '</span>');
    if (agg.aiHub) chips.push('<span class="chip fact chip-aihub">ai-hub ' + agg.aiHub + '</span>');
    return chips.join('');
  }

  const AUTO_EXPAND_MAX_FILES = 300;

  function renderDirNode(dir, depth, autoOpen) {
    const openAttr = autoOpen ? ' open' : '';
    const childDirs = [...dir.dirs.values()].map((d) => '<li class="dir">' + renderDirNode(d, depth + 1, autoOpen) + '</li>').join('');
    const childFiles = dir.files.map((f) => renderFileNode(f)).join('');
    return '<details' + openAttr + '><summary><span class="fold"></span>' + escapeHtml(dir.name) +
      '<span class="dircount">(' + dir.agg.files + ')</span>' + dirChips(dir.agg) + '</summary>' +
      '<ul>' + childDirs + childFiles + '</ul></details>';
  }

  function renderFileNode(n) {
    return '<li class="file"><span class="file-row" data-file="' + escapeHtml(n.path) + '">📄 ' +
      escapeHtml(n.name) + nodeChips(n) + '</span><div class="file-detail-slot"></div></li>';
  }

  function renderRepos(data) {
    if (!data.repos || data.repos.length === 0) {
      contentEl.innerHTML = '<p class="empty-note">公開対象のリポジトリがありません。</p>';
      return;
    }
    contentEl.innerHTML = data.repos.map((repo) => {
      const tree = buildTree(repo.nodes || []);
      const autoOpen = repo.fileCount <= AUTO_EXPAND_MAX_FILES;
      const headStr = repo.head ? repo.head.slice(0, 8) : '不明';
      const dirtyNote = repo.dirty === true ? ' <span class="chip guess chip-platform">未コミット変更あり</span>' : '';
      // ★ルートdirノード自体は描画せず、直下の子(ディレクトリ・ファイル)だけを並べる。
      //   repo-headの見出しとツリールートが「rolex」を二重表示するのを避けるため。
      const childDirs = [...tree.dirs.values()].map((d) => '<li class="dir">' + renderDirNode(d, 1, autoOpen) + '</li>').join('');
      const childFiles = tree.files.map((f) => renderFileNode(f)).join('');
      return '<section class="repo" data-repo="' + escapeHtml(repo.name) + '">' +
        '<div class="repo-head">📦 ' + escapeHtml(repo.name) +
        '<span class="count"> ' + repo.fileCount + 'ファイル / HEAD ' + headStr + '</span>' + dirtyNote + '</div>' +
        '<div class="tree"><ul>' + childDirs + childFiles + '</ul></div>' +
        '</section>';
    }).join('');

    contentEl.querySelectorAll('.file-row').forEach((row) => {
      row.addEventListener('click', () => {
        const repoName = row.closest('.repo').dataset.repo;
        const repo = data.repos.find((r) => r.name === repoName);
        renderFileDetail(repo, row.dataset.file, row);
      });
    });
  }

  function renderFileDetail(repo, filePath, rowEl) {
    // ★同時に開く詳細は1件だけ（多重展開の防止）。
    contentEl.querySelectorAll('.file-detail-slot').forEach((slot) => { slot.innerHTML = ''; });
    const node = repo.nodes.find((n) => n.path === filePath);
    const slot = rowEl.nextElementSibling;
    if (!node || !slot) return;
    const dependsOn = repo.edges.filter((e) => e.from === filePath).map((e) => e.to);
    const referencedBy = repo.edges.filter((e) => e.to === filePath).map((e) => e.from);
    slot.innerHTML =
      '<div class="file-detail"><dl>' +
      '<dt>パス</dt><dd>' + escapeHtml(node.path) + '</dd>' +
      '<dt>Gate（事実）</dt><dd>' + (node.isGate ? 'はい（正本 check-gates-are-wired.mjs の判定基準に一致）' : 'いいえ') + '</dd>' +
      '<dt>Gate候補（推測）</dt><dd>' + (node.gateCandidate ? 'check-*.js / verify-*.js の命名規則のみ一致。実際にGateとして配線されているかは未確認' : 'なし') + '</dd>' +
      '<dt>PAIRS</dt><dd>' + (node.pairs ? escapeHtml(node.pairs.role) + '（' + escapeHtml(node.pairs.label) + '）' : 'なし') + '</dd>' +
      '<dt>ai-hub登録</dt><dd>' + (node.aiHubRegistered === true ? 'あり' : (node.aiHubRegistered === false ? 'なし' : '未計測（ai-hub不在で生成）')) + '</dd>' +
      '<dt>platform推測</dt><dd>' + (node.platformHint ? escapeHtml(node.platformHint) + '（ファイル名からの推測）' : 'なし') + '</dd>' +
      '<dt>依存先（import）</dt><dd>' + (dependsOn.length ? dependsOn.map(escapeHtml).join('<br>') : 'なし') + '</dd>' +
      '<dt>参照元（このファイルをimportしている）</dt><dd>' + (referencedBy.length ? referencedBy.map(escapeHtml).join('<br>') : 'なし') + '</dd>' +
      '</dl></div>';
  }
})();
</script>
</body>
</html>
`;
}

export { buildArchitectureMap, buildPublicView, annotateNodes, renderHtml };

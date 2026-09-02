/**
 * architecture-map-core.mjs — 「今あるコードの現在地」をfsだけから機械的に集計する純関数群。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ 何をするか（読む側の理解）
 *   github/ 配下の全リポジトリを対象に、①各リポのHEAD/dirty状態（スナップショット情報）
 *   ②templates/scripts/配下等のファイル間import関係 ③PAIRS（check-drift.mjsの正本/コピー表）
 *   ④ai-hub/index.jsonへの登録有無 ⑤Gate（check-系/verify-系ファイル）の有無、を機械的に集める。
 *
 * ■ ★このファイルが判定しないこと（過信を防ぐ）
 *   ・「似ているから同じ責務」という類似度判定はしない（v1では意図的に入れない。
 *     import構造が似ているだけでは責務が同じとは限らないため、誤判定で人間・AIを
 *     迷わせるリスクの方が大きいと判断した）
 *   ・PAIRSのcanonicalを「再利用コンポーネント」とは呼ばない。PAIRSは「同期関係における
 *     正本」を表す表であり、再利用推奨を意味しない。呼び出し側の表示文言もこれに従うこと
 *   ・platform固有の判定はファイル名の命名規則によるheuristicであり確定情報ではない
 *     （verify-ios-* / verify-android-* 等のprefixで推測するだけ）
 *   ・公開可否の判定はしない（visibility取得は architecture-map-visibility.mjs の責務。
 *     このファイルは「解析対象すべて」を扱い、「公開してよいか」は関与しない）
 *
 * ■ ★車輪の再発明をしない
 *   fs walk・除外ディレクトリ・プロジェクト発見ロジックは scripts/lib/hub-kit-matrix.mjs の
 *   walkFiles/discoverProjects/EXCLUDED_DIRS/EXCLUDED_PROJECTSをそのままimportして使う
 *   （2026-09-02、walkFilesをexport化。コピーを作らない）。
 * ───────────────────────────────────────────────────────────────────────────
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { walkFiles, EXCLUDED_DIRS } from './hub-kit-matrix.mjs';
import { GATE_RE as CANONICAL_GATE_RE } from '../../templates/diagnostics/check-gates-are-wired.mjs';

const MAX_FILE_BYTES = 512 * 1024;
/** ★正規表現ベースのimport抽出。動的import/requireは拾えない（check-gates-are-wired.mjsと同じ限界）。 */
const IMPORT_RE = /(?:^|\n)\s*import\s+(?:[\s\S]*?from\s+)?['"](\.[^'"]+)['"]/g;
const REQUIRE_RE = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;

/** ★platform固有のheuristic判定に使うprefix一覧。命名規則からの推測であり確定情報ではない。 */
const PLATFORM_PREFIXES = [
  { prefix: 'verify-ios-', platform: 'ios' },
  { prefix: 'check-ios-', platform: 'ios' },
  { prefix: 'verify-android-', platform: 'android' },
  { prefix: 'check-android-', platform: 'android' },
  { prefix: 'android-', platform: 'android' },
  { prefix: 'chrome-', platform: 'chrome' },
  { prefix: 'cws-', platform: 'chrome' },
];

/**
 * ★git snapshot情報（repo/head/dirty）を取得する。取れなければnull（0埋め・空文字埋めしない）。
 * @param {string} repoDir
 * @returns {{head: string, dirty: boolean}|null}
 */
export function gitSnapshot(repoDir) {
  if (!existsSync(join(repoDir, '.git'))) return null;
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoDir, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: repoDir, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore']
    });
    return { head, dirty: status.trim().length > 0 };
  } catch {
    return null;
  }
}

/**
 * ★このリポジトリでGit管理下にある（＝コミット済みでGitHubにpush済みの可能性がある）
 * ファイルの相対パス集合を取得する。取れなければnull。
 *
 * ★なぜ要るか（2026-09-02、公開Mapのソース分離）:
 *   `walkFiles`はローカルの作業ツリーをそのまま歩くため、untrackedファイル・
 *   gitignore対象外の一時ファイル・秘密のメモ等も含まれうる。GitHub visibility=PUBLICは
 *   「pushされた内容が公開されている」ことしか意味せず、ローカルの未追跡状態まで
 *   公開してよいわけではない。公開Mapを作る側は、必ずこの集合で絞り込んでから使うこと。
 * @param {string} repoDir
 * @returns {Set<string>|null} POSIX区切りの相対パス集合
 */
export function gitTrackedFiles(repoDir) {
  if (!existsSync(join(repoDir, '.git'))) return null;
  try {
    const out = execFileSync('git', ['ls-files'], {
      cwd: repoDir, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore']
    });
    return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean).map((p) => p.split('\\').join('/')));
  } catch {
    return null;
  }
}

/**
 * ★1ファイルからimport/require先の相対パスを抽出する（正規表現ベース、AST不使用）。
 * @param {string} filePath
 * @returns {string[]} 相対パス文字列のまま返す（呼び出し側で解決する）
 */
export function extractRelativeImports(filePath) {
  if (!/\.(mjs|js|cjs|ts|tsx)$/.test(filePath)) return [];
  let content;
  try {
    const stat = statSync(filePath);
    if (stat.size > MAX_FILE_BYTES) return [];
    content = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const specs = new Set();
  for (const re of [IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) specs.add(m[1]);
  }
  return [...specs];
}

/**
 * ★相対import文字列を、実在する絶対パスへ解決する。拡張子省略・index.mjs省略を試す。
 * 解決できなければnull（推測で埋めない）。
 * @param {string} fromFile 解決の基準となるファイルの絶対パス
 * @param {string} spec import文字列（例: './lib/instrument-core.mjs'）
 * @returns {string|null}
 */
export function resolveImportSpec(fromFile, spec) {
  const base = join(dirname(fromFile), spec);
  const candidates = [base, `${base}.mjs`, `${base}.js`, join(base, 'index.mjs'), join(base, 'index.js')];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/**
 * ★命名規則からplatform固有候補を推測する（heuristic、確定情報ではない）。
 * @param {string} fileName
 * @returns {string|null}
 */
export function guessPlatform(fileName) {
  for (const { prefix, platform } of PLATFORM_PREFIXES) {
    if (fileName.startsWith(prefix)) return platform;
  }
  return null;
}

/** ★.js版のcheck-系/verify-系ファイル名パターン（heuristic専用、正本GATE_REの対象外）。 */
const GATE_JS_HEURISTIC_RE = /^(check|verify)-.*\.js$/;

/**
 * ★Gate判定を「事実」と「推測」に分けて返す（2026-09-02、事実と推測を混ぜないための修正）。
 *
 * 正本 templates/diagnostics/check-gates-are-wired.mjs の GATE_RE（.mjsのみ）に一致 → isGate:true。
 * これは「check-gates-are-wired.mjsが実際にGateとして扱う」という★事実。
 *
 * ファイル名が `check-*.js` / `verify-*.js` の命名規則に一致するだけ → gateCandidate:true。
 * これは「Gateかもしれないという★推測」にすぎない。正本のGATE_REは.mjsしか見ないため、
 * .jsファイルは（他リポでは実際にGateとして機能していても）check-gates-are-wired.mjs自身は
 * 検出しない。この区別を1つの真偽値へ合流させると「ファイル名だけで実際に配線されている」と
 * 誤って断定することになるため、v1では意図的に分離したまま返す。
 * @param {string} fileName
 * @returns {{isGate: boolean, gateCandidate: boolean, classification: 'fact'|'heuristic'|null}}
 */
export function classifyGate(fileName) {
  if (CANONICAL_GATE_RE.test(fileName)) {
    return { isGate: true, gateCandidate: false, classification: 'fact' };
  }
  if (GATE_JS_HEURISTIC_RE.test(fileName)) {
    return { isGate: false, gateCandidate: true, classification: 'heuristic' };
  }
  return { isGate: false, gateCandidate: false, classification: null };
}

/**
 * ★1リポジトリを解析し、ファイルノード・import辺・Gate候補を集める。
 * @param {string} repoDir リポジトリの絶対パス
 * @param {string} repoName
 * @returns {{nodes: object[], edges: object[], errors: string[]}}
 */
export function scanRepoStructure(repoDir, repoName) {
  const { files, errors } = walkFiles(repoDir);
  const codeFiles = files.filter((f) => /\.(mjs|js|cjs|ts|tsx)$/.test(f));
  const nodes = codeFiles.map((f) => {
    const relPath = relative(repoDir, f).split('\\').join('/');
    const name = basename(f);
    const gate = classifyGate(name);
    return {
      path: relPath,
      name,
      isGate: gate.isGate,
      gateCandidate: gate.gateCandidate,
      gateClassification: gate.classification,
      platformHint: guessPlatform(name)
    };
  });

  const edges = [];
  for (const f of codeFiles) {
    const relFrom = relative(repoDir, f).split('\\').join('/');
    for (const spec of extractRelativeImports(f)) {
      const resolved = resolveImportSpec(f, spec);
      if (!resolved) continue;
      const relTo = relative(repoDir, resolved).split('\\').join('/');
      if (relTo.startsWith('..')) continue; // ★リポ外への相対importは辺にしない
      edges.push({ from: relFrom, to: relTo });
    }
  }

  return { nodes, edges, errors };
}

/**
 * ★PAIRS（check-drift.mjs由来）から、このリポ内のファイルがcanonicalかcopyかを判定する。
 * canonicalは「同期関係における正本」であり「再利用コンポーネント」ではない（呼び出し側の表示に反映すること）。
 * @param {Array<{label:string, canonical:string, copies:string[]}>} pairs
 * @param {string} absFilePath
 * @returns {{role: 'canonical'|'copy', label: string}|null}
 */
export function findPairsRole(pairs, absFilePath) {
  for (const pair of pairs) {
    if (pair.canonical === absFilePath) return { role: 'canonical', label: pair.label };
    if ((pair.copies || []).includes(absFilePath)) return { role: 'copy', label: pair.label };
  }
  return null;
}

export { EXCLUDED_DIRS };

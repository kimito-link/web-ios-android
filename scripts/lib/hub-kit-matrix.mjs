#!/usr/bin/env node
/**
 * hub-kit-matrix.mjs — 「出荷事故ゲート導入マトリクス」のスキャン純関数群。
 *
 * 設計: _docs/kit-gate-adoption-matrix-DESIGN.md（Fable設計・司令塔裏取り済み、2026-08-31）
 *
 * github/ 配下の各プロジェクトが、web-ios-androidキットの出荷事故ゲート9項目を
 * どれだけ導入しているかを、実ファイルシステムをスキャンして判定する。
 *
 * ★fsだけに依存する純関数群（HTML生成の知識を持たない）。
 *   generate-hub-dashboard.mjs から呼ばれる。selftestで毒フィクスチャを
 *   一時ディレクトリに作って単体で叩けるよう、main()と密結合させない。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

/** ゲート定義。表示順もこの順。 */
export const GATES = [
  { id: 'ios-splash', label: '①iOS splash', file: 'verify-ios-splash-not-default.mjs', appliesTo: (p) => p.hasCapacitor },
  { id: 'android-splash', label: '②And splash', file: 'verify-android-splash-not-default.mjs', appliesTo: (p) => p.hasCapacitor },
  { id: 'android-signing', label: '③署名config', file: 'verify-android-signing-config.mjs', appliesTo: (p) => p.hasAndroidDir || p.hasTwa },
  { id: 'webdir', label: '④webDir', file: 'verify-webdir-consistency.mjs', appliesTo: (p) => p.hasCapacitor },
  { id: 'signing-path', label: '⑤署名パス', file: 'verify-signing-material-path.mjs', appliesTo: (p) => p.hasAndroidDir || p.hasTwa },
  { id: 'tracked-imports', label: '⑥add忘れ', file: 'check-tracked-imports.mjs', appliesTo: () => true },
  { id: 'app-config-schema', label: '⑦config schema', file: 'verify-app-config-schema.mjs', appliesTo: (p) => p.isKitTarget },
  { id: 'assetlinks', label: '⑧assetlinks', file: 'verify-assetlinks-published.mjs', appliesTo: (p) => p.hasAndroidDir || p.hasTwa },
  {
    id: 'instrument-core', label: '⑨計器import', file: null,
    importRe: /from\s+['"][^'"]*instrument-core(?:\.mjs)?['"]|require\(\s*['"][^'"]*instrument-core/,
    appliesTo: () => true,
  },
];

/** walk中に刈り取るディレクトリ名（★.claude丸ごと除外＝worktree二重カウント対策）。 */
export const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.claude', '.next', 'dist', 'build', 'out',
  'coverage', 'Pods', 'DerivedData', '.gradle', '.expo', 'vendor',
]);

/** マトリクスの行に載せない（キット自身・横断ハブ）。★載せると全ゲート導入済に見える偽の全緑になる。 */
export const EXCLUDED_PROJECTS = new Set(['web-ios-android', 'ai-hub']);

const MAX_DEPTH = 7;
const MAX_MJS_BYTES = 1024 * 1024;

function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

/**
 * プロジェクト配下を1回だけ歩き、basenameとその絶対パスの一覧を集める。
 * ★シンボリックリンクは辿らない（ループ防止）。
 */
function walkFiles(rootDir) {
  const files = [];
  const errors = [];
  function walk(dir, depth) {
    if (depth > MAX_DEPTH) return;
    const entries = safeReaddir(dir);
    if (entries === null) {
      errors.push(`読み取り不可: ${dir}`);
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }
  walk(rootDir, 0);
  return { files, errors };
}

/**
 * プラットフォームプロファイルを検出する（対象外判定の土台）。
 * @param {string} projectDir
 * @returns {{hasCapacitor:boolean, hasExpo:boolean, hasTwa:boolean, hasIosDir:boolean, hasAndroidDir:boolean, hasAppConfig:boolean, isKitTarget:boolean}}
 */
export function detectProfile(projectDir) {
  const hasCapacitor = ['capacitor.config.ts', 'capacitor.config.js', 'capacitor.config.json']
    .some((f) => existsSync(join(projectDir, f)));
  const hasAppConfig = existsSync(join(projectDir, 'app.config.json'));
  const hasIosDir = existsSync(join(projectDir, 'ios'));
  const hasAndroidDir = existsSync(join(projectDir, 'android'));

  let hasTwa = existsSync(join(projectDir, 'twa-manifest.json'));
  if (!hasTwa) {
    const androidDir = join(projectDir, 'android');
    if (existsSync(androidDir)) {
      const entries = safeReaddir(androidDir) || [];
      hasTwa = entries.some((e) => e.name === 'twa-manifest.json');
    }
  }

  let hasExpo = false;
  const pkgPath = join(projectDir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      hasExpo = Object.keys(deps).some((k) => k === 'expo' || k.startsWith('expo-'));
    } catch { /* 壊れたpackage.jsonはExpo判定なしとして続行 */ }
  }
  if (!hasExpo) {
    const appJsonPath = join(projectDir, 'app.json');
    if (existsSync(appJsonPath)) {
      try {
        const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'));
        hasExpo = !!appJson.expo;
      } catch { /* noop */ }
    }
  }

  const isKitTarget = hasCapacitor || hasTwa || hasIosDir || hasAndroidDir || hasAppConfig;

  return { hasCapacitor, hasExpo, hasTwa, hasIosDir, hasAndroidDir, hasAppConfig, isKitTarget };
}

/**
 * github/ 直下から「マトリクス行候補」を発見する（浅い探索・depth<=2相当）。
 * @param {string} githubRoot
 * @param {{include?: string[], exclude?: string[]}} [overrides]
 * @returns {{projectNames: string[], skippedDirs: string[]}}
 */
export function discoverProjects(githubRoot, overrides = {}) {
  const entries = safeReaddir(githubRoot) || [];
  const candidates = [];
  const skipped = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (EXCLUDED_PROJECTS.has(name)) continue;
    if ((overrides.exclude || []).includes(name)) continue;

    const dir = join(githubRoot, name);
    const profile = detectProfile(dir);
    if (profile.isKitTarget || profile.hasExpo) {
      candidates.push(name);
    } else {
      skipped.push(name);
    }
  }

  for (const inc of overrides.include || []) {
    if (!candidates.includes(inc) && existsSync(join(githubRoot, inc))) {
      candidates.push(inc);
    }
  }

  candidates.sort((a, b) => a.localeCompare(b));
  return { projectNames: candidates, skippedDirs: skipped };
}

/**
 * 1プロジェクトの9ゲートを判定する。
 * @param {string} projectDir
 * @param {ReturnType<typeof detectProfile>} profile
 * @returns {{cells: Record<string, {state: 'ok'|'missing'|'na'|'unknown', provenance: 'scan'}>, errors: string[]}}
 */
export function scanProjectGates(projectDir, profile) {
  const { files, errors } = walkFiles(projectDir);
  const basenames = new Set(files.map((f) => basename(f)));
  const cells = {};

  for (const gate of GATES) {
    if (!gate.appliesTo(profile)) {
      cells[gate.id] = { state: 'na', provenance: 'scan' };
      continue;
    }

    if (gate.file) {
      cells[gate.id] = { state: basenames.has(gate.file) ? 'ok' : 'missing', provenance: 'scan' };
      continue;
    }

    // instrument-core: .mjsファイルの中身をimport文で判定。
    let found = false;
    let readError = false;
    for (const f of files) {
      if (!f.endsWith('.mjs')) continue;
      if (basename(f) === 'instrument-core.mjs') continue; // 自分自身は除外
      try {
        const stat = statSync(f);
        if (stat.size > MAX_MJS_BYTES) continue;
        const content = readFileSync(f, 'utf8');
        if (gate.importRe.test(content)) { found = true; break; }
      } catch {
        readError = true;
      }
    }
    cells[gate.id] = { state: found ? 'ok' : (readError && errors.length ? 'unknown' : 'missing'), provenance: 'scan' };
  }

  return { cells, errors };
}

/**
 * overrides JSON を読み込む。reason/evidence欠落があれば例外（fail-closed）。
 * @param {string} path
 * @returns {{include: string[], exclude: string[], cells: Array<{project:string, gate:string, state:string, reason:string, evidence:string}>}}
 */
export function loadOverrides(path) {
  if (!existsSync(path)) {
    return { include: [], exclude: [], cells: [] };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    const err = new Error(`hub-matrix-overrides.json のJSONが壊れています: ${e.message}`);
    err.overrideConfigBroken = true;
    throw err;
  }
  const cells = Array.isArray(raw.cells) ? raw.cells : [];
  for (const c of cells) {
    if (!c.reason || !c.evidence) {
      const err = new Error(
        `hub-matrix-overrides.json の上書きに reason/evidence が欠落しています: ${JSON.stringify(c)}`
      );
      err.overrideConfigBroken = true;
      throw err;
    }
    if (!['ok', 'missing', 'na'].includes(c.state)) {
      const err = new Error(`hub-matrix-overrides.json の state が不正です: ${JSON.stringify(c)}`);
      err.overrideConfigBroken = true;
      throw err;
    }
  }
  return {
    include: Array.isArray(raw.include) ? raw.include : [],
    exclude: Array.isArray(raw.exclude) ? raw.exclude : [],
    cells,
  };
}

/**
 * マトリクス全体をスキャンする（メイン入口）。
 * @param {string} githubRoot
 * @param {string} overridesPath
 * @returns {object} matrix.json の中身そのもの
 */
export function scanKitMatrix(githubRoot, overridesPath) {
  const overrides = loadOverrides(overridesPath); // 壊れていればここで throw（呼び出し側でfail-closed）
  const { projectNames, skippedDirs } = discoverProjects(githubRoot, overrides);

  const scanErrors = [];
  const projects = projectNames.map((name) => {
    const dir = join(githubRoot, name);
    const profile = detectProfile(dir);

    if (profile.hasExpo && !profile.hasCapacitor && !profile.hasTwa) {
      return {
        name,
        profile,
        cells: Object.fromEntries(GATES.map((g) => [g.id, { state: 'na', provenance: 'scan' }])),
        score: { ok: 0, applicable: 0 },
        rowNote: 'Expo/React Native構成（Capacitor/TWA未使用）のため対象外',
      };
    }

    const { cells, errors } = scanProjectGates(dir, profile);
    if (errors.length) scanErrors.push(...errors.map((e) => `${name}: ${e}`));

    // overrides適用（このプロジェクト・このゲートに一致するものだけ上書き）。
    for (const c of overrides.cells) {
      if (c.project === name && cells[c.gate]) {
        cells[c.gate] = { state: c.state, provenance: 'override', reason: c.reason, evidence: c.evidence };
      }
    }

    const applicableCells = Object.values(cells).filter((c) => c.state !== 'na');
    const okCells = applicableCells.filter((c) => c.state === 'ok');

    return {
      name,
      profile,
      cells,
      score: { ok: okCells.length, applicable: applicableCells.length },
      rowNote: null,
    };
  });

  const totals = {};
  for (const gate of GATES) {
    let ok = 0, applicable = 0;
    for (const p of projects) {
      const cell = p.cells[gate.id];
      if (!cell || cell.state === 'na') continue;
      applicable++;
      if (cell.state === 'ok') ok++;
    }
    totals[gate.id] = { ok, applicable };
  }

  return {
    generatedAt: new Date(0).toISOString(), // 呼び出し側で実時刻に差し替え
    scannedFrom: 'github/ 直下ディレクトリの実ファイルスキャン',
    available: true,
    gates: GATES.map((g) => ({ id: g.id, file: g.file, label: g.label })),
    projects,
    totals,
    scan: { skippedDirs, errors: scanErrors },
  };
}

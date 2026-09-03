#!/usr/bin/env node
/**
 * rollout-plan.mjs — 登録済みコンポーネントを、github/配下の全gitリポジトリに対して
 * read-onlyで適用可否判定（Applicability）し、JSON planを出力する。
 *
 * ★観測専用。ファイルコピー・自動修正・rollout apply・書き込みは一切行わない。
 * ★対象repo一覧は ai-hub/index.json ではなく、github/直下のgitリポジトリを直接列挙する
 *   （index.jsonは知見の索引であり、プロジェクト一覧を持っていないことを実データで確認済み）。
 * ★discoverProjects()（出荷Gate Matrix専用、isKitTarget||hasExpoのみ候補化）は使わない。
 *   純静的HTMLサイトが分母から消えるため、component-rollout.mjsのdiscoverSiteTargets()を使う。
 * ★UNKNOWNをNOT_APPLICABLEへ丸めない。分母は常にsiteTargets総数のまま保持する。
 *
 * ★scannerの一般ロジック（component-rollout.mjs）だけでは判断できない例外（fixture/生成物/
 *   署名鍵置き場等、実サイトでないと人間確認で分かったケース）は、名前パターンをscanner側に
 *   追加し続けない。rollout-overrides.json に reason+evidence必須の薄いoverrideとして記録し、
 *   このファイルが機械スキャン結果の上に適用する（2026-09-03、7件を実物確認して初導入）。
 *
 * 使い方: node scripts/rollout-plan.mjs [--github-root <path>] [--out <path>]
 */
import { readdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { scanRepoApplicability, detectAdoption, loadComponentMeta } from './lib/component-rollout.mjs';

const OVERRIDES_PATH = resolve(import.meta.dirname, 'rollout-overrides.json');

/**
 * rollout-overrides.json を読む。無ければ空（overrideは任意機能）。
 * @returns {{overrides: Array<object>, pageExclusions: Array<object>}}
 */
function loadOverrides() {
  if (!existsSync(OVERRIDES_PATH)) return { overrides: [], pageExclusions: [] };
  const data = JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8'));
  return { overrides: data.overrides || [], pageExclusions: data.pageExclusions || [] };
}

/**
 * このproject::siteRootで確認済みのページ除外だけを絞り込む。
 * 他プロジェクトの同名パスへは一般化しない（GPT指摘の方針を厳守）。
 */
function pageExclusionsFor(pageExclusions, componentId, project, siteRoot) {
  return pageExclusions
    .filter((ex) => ex.component === componentId && ex.project === project && ex.siteRoot === siteRoot)
    .map((ex) => ({ glob: ex.glob, path: ex.path }));
}

/**
 * 機械スキャン結果にoverrideを適用する。overrideはstate/reasonを上書きし、
 * evidenceとoverriddenFromMachineState（元の機械判定）を記録する。
 */
function applyOverride(target, componentId, overrides) {
  const match = overrides.find(
    (o) => o.component === componentId && o.project === target.project && o.siteRoot === target.siteRoot
  );
  if (!match) return target;
  return {
    ...target,
    applicability: match.state,
    reason: [match.reason],
    override: { evidence: match.evidence, machineState: target.applicability },
  };
}

const COMPONENT_REGISTRY = [
  { id: 'ui/site-chrome', componentJsonPath: 'templates/web/site-chrome/component.json' },
];

/**
 * github/直下のgitリポジトリ名を列挙する（.gitディレクトリの有無だけで判定）。
 * @param {string} githubRoot
 * @returns {string[]}
 */
function listGitRepositories(githubRoot) {
  const entries = readdirSync(githubRoot, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => existsSync(join(githubRoot, name, '.git')))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * @param {string} githubRoot
 * @returns {object} plan JSON（component単位でまとめた結果の配列）
 */
export function buildRolloutPlan(githubRoot) {
  const repoNames = listGitRepositories(githubRoot);
  const { overrides, pageExclusions } = loadOverrides();
  const componentPlans = [];

  for (const component of COMPONENT_REGISTRY) {
    const componentJsonPath = resolve(githubRoot, 'web-ios-android', component.componentJsonPath);
    const targets = [];
    let siteTargetCount = 0;

    for (const repoName of repoNames) {
      const repoDir = join(githubRoot, repoName);
      const results = scanRepoApplicability(repoDir, [
        { id: component.id, componentJsonPath },
      ]);

      for (const r of results) {
        siteTargetCount += 1;
        const target = {
          project: repoName,
          siteRoot: r.relativePath,
          applicability: r.state,
          facts: r.facts,
          reason: buildReason(r.state, r.facts, r.relativePath),
        };
        targets.push({ ...applyOverride(target, component.id, overrides), _absoluteSiteRoot: r.siteRoot });
      }
    }

    // ★確定APPLIESのみadoption計測（read-only）。web-ios-android::siteも特別扱いせず
    //   同じdetectorで測る（GPT指摘: 「導入済みだからCURRENT」のハードコード禁止）。
    const componentMeta = loadComponentMeta(componentJsonPath);
    if (componentMeta?.canonicalSource) {
      // component.json は "templates/web/site-chrome/core/" のようなリポジトリ相対パスを持つ。
      // ここで絶対パスへ解決し、detectAdoption()のCanonical hash比較で使う。
      componentMeta.adoption = componentMeta.adoption || {};
      componentMeta.adoption.canonicalSourceDir = resolve(githubRoot, 'web-ios-android', componentMeta.canonicalSource);
    }
    for (const target of targets) {
      if (target.applicability !== 'APPLIES') continue;
      const exclusions = pageExclusionsFor(pageExclusions, component.id, target.project, target.siteRoot);
      const { adoption, evidence } = detectAdoption(target._absoluteSiteRoot, componentMeta, exclusions);
      target.adoption = adoption;
      target.adoptionEvidence = evidence;
    }
    for (const target of targets) delete target._absoluteSiteRoot;

    const summary = {
      repositories: repoNames.length,
      siteTargets: siteTargetCount,
      applies: targets.filter((t) => t.applicability === 'APPLIES').length,
      notApplicable: targets.filter((t) => t.applicability === 'NOT_APPLICABLE').length,
      unknown: targets.filter((t) => t.applicability === 'UNKNOWN').length,
      adoption: {
        current: targets.filter((t) => t.adoption === 'CURRENT').length,
        missing: targets.filter((t) => t.adoption === 'MISSING').length,
        drifted: targets.filter((t) => t.adoption === 'DRIFTED').length,
        unknown: targets.filter((t) => t.adoption === 'UNKNOWN').length,
      },
    };

    componentPlans.push({ component: component.id, summary, targets });
  }

  return componentPlans;
}

// ★機械的に確実とは言えないが、実サイトでない可能性がある命名パターン（2026-09-03実データで
//   発見: test/fixtures, prerendered, ios-signing, _extracted_zip等）。除外はしない
//   （過剰な自動判定は今のフェーズの方針に反する）。APPLIESのまま、reasonに注記だけ加えて
//   人間/Claudeが個別に確認できるようにする。
const NEEDS_REVIEW_PATTERNS = [/test/i, /fixture/i, /prerendered/i, /signing/i, /_extracted/i, /legacy/i, /mock/i, /demo/i];

/** 判定理由を人間が読める形にする（APPLIESでも要確認の注記を出す。判定根拠を隠さない）。 */
function buildReason(state, facts, siteRoot) {
  const reasons = [];
  if (state === 'UNKNOWN') {
    if (facts['staticHtml.multiPage'] === null) reasons.push('staticHtml.multiPage: 読み取り不能');
    if (facts['staticHtml.buildless'] === null) reasons.push('staticHtml.buildless: package.json解析不能');
  }
  if (state === 'NOT_APPLICABLE') {
    if (facts['staticHtml.multiPage'] === false) reasons.push(`HTML ${facts.htmlCount}枚（複数ページ条件を満たさない）`);
    if (facts['staticHtml.buildless'] === false) reasons.push('フレームワーク検出（ビルドレス条件を満たさない）');
    if (facts['browserExtension.uiContext'] === true) reasons.push('manifest.jsonがこのHTMLをブラウザ拡張UI(popup/options/devtools等)として参照している（除外条件browserExtension.uiContext）');
  }
  if (state === 'APPLIES' && NEEDS_REVIEW_PATTERNS.some((re) => re.test(siteRoot))) {
    reasons.push(`要確認: パス名"${siteRoot}"はテスト/ビルド成果物/一時ファイルの可能性（自動除外はしていない）`);
  }
  return reasons;
}

function main() {
  const args = process.argv.slice(2);
  const githubRootArgIdx = args.indexOf('--github-root');
  const githubRoot = githubRootArgIdx >= 0 ? resolve(args[githubRootArgIdx + 1]) : resolve(import.meta.dirname, '..', '..');
  const outArgIdx = args.indexOf('--out');
  const outPath = outArgIdx >= 0 ? resolve(args[outArgIdx + 1]) : null;

  const plan = buildRolloutPlan(githubRoot);
  const json = JSON.stringify(plan, null, 2);

  if (outPath) {
    writeFileSync(outPath, json);
    console.log(`[rollout-plan] 書き出し: ${outPath}`);
  } else {
    console.log(json);
  }

  for (const p of plan) {
    console.error(`[rollout-plan] ${p.component}: repositories=${p.summary.repositories} siteTargets=${p.summary.siteTargets} APPLIES=${p.summary.applies} NOT_APPLICABLE=${p.summary.notApplicable} UNKNOWN=${p.summary.unknown}`);
    console.error(`[rollout-plan] ${p.component} adoption(APPLIES内訳): CURRENT=${p.summary.adoption.current} MISSING=${p.summary.adoption.missing} DRIFTED=${p.summary.adoption.drifted} UNKNOWN=${p.summary.adoption.unknown}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('rollout-plan.mjs')) {
  main();
}

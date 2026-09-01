#!/usr/bin/env node
// 複数のビューポート幅で実ブラウザ(Playwright)を巡回し、横スクロール・要素はみ出し・
// テキスト省略を機械的に検出するゲート。
//
// 移植元: malwarecheck.site/scripts/check-responsive.mjs
//         malwarecheck.site/scripts/check-header.mjs
//   （2026-08-31、council-fable「逆輸入候補」調査で発見・輸入・大幅汎用化）
//
// ★このキットとの棲み分け（車輪の再発明をしない）:
//   verify-responsive-design.mjs は「CSSの静的解析」（固定px幅・overflow-x欠如等の
//   崩れやすいパターンを先取り）で、実ブラウザでどう見えるかは判定しない設計
//   （responsive-checkスキル/Playwrightに委ねる、と同スクリプトのコメントに明記済み）。
//   このゲートはまさにそのPlaywright実測部分——「本物のブラウザで実測して崩れを
//   機械的に判定する、CIで自動実行できるスクリプト」を担う。responsive-checkスキルは
//   AIが対話的にチェックする手順であり恒久検査ではないため、このゲートで補完する。
//
// ★移植元の実測知見（そのまま踏襲）:
//   - 1024ちょうどと1040の両方を測る: ヘッドフル環境ではスクロールバー(約17px)で
//     innerWidthが1024を割り、境界判定が偽赤/偽緑になる。両方で通ることを求める。
//   - truncateは溢れを黙って隠すので行数だけでは気づけない。scrollWidthと実幅を
//     比較して省略を検出する（1440pxで56px/必要178pxの省略を見逃した実績あり）。
//
// ★移植元との違い（汎用化のための一般化）:
//   移植元はmalwarecheck.site固有の「診断フォームを実走させる」「糸マップ(ChainNode)を
//   見る」「MAIN_NAVの5項目ラベルを検証する」というドメインロジックを含んでいた。
//   このゲートは汎用的な3検査（横スクロール・要素はみ出し・テキスト省略）に絞り、
//   対象URL・幅リスト・ナビ排他性検査の要否を設定ファイルから受け取る形にした。
//   プロジェクト固有のUI検査（診断結果の表示確認等）は、このゲートの出力を土台に
//   別スクリプトで追加すること。
//
// 使い方:
//   node scripts/verify-responsive-runtime.mjs http://localhost:3000
//   node scripts/verify-responsive-runtime.mjs http://localhost:3000 --config responsive.config.json
//   node scripts/verify-responsive-runtime.mjs --selftest
//
// config.jsonの形式（省略時は既定値を使う）:
// {
//   "widths": [320, 360, 390, 640, 768, 1024, 1040, 1100, 1200, 1280, 1440],
//   "checkNavExclusive": true,          // header内nav/hamburgerの排他性を見るか
//   "navBreakpoint": 1024,              // この幅以上でnavが可視であるべき
//   "waitForSelector": null             // 計測前に待つセレクタ(省略可)
// }
//
// 終了コード（instrument-core の3値規約）:
//   0 = 崩れなし / 1 = 崩れ検出（測れた上での赤） / 2 = 測れなかった（ページ到達不可）
import fs from 'node:fs';
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';

const DEFAULT_WIDTHS = [320, 360, 390, 640, 768, 1024, 1040, 1100, 1200, 1280, 1440];

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/**
 * ★判定の本体（純関数・ブラウザに触らない＝テストしやすい）。
 * 1幅ぶんの実測結果を受け取り、崩れ判定を行う。
 * @param {number} width
 * @param {{docW:number, winW:number, over:string[], navVisible?:boolean, burgerVisible?:boolean, navBreakpoint?:number, truncated?: {selector:string}[]}} measured
 * @param {{checkNavExclusive: boolean, navBreakpoint: number}} opts
 * @returns {{ok: boolean, issues: string[]}}
 */
export function judgeOneWidth(width, measured, opts) {
  const issues = [];

  // 横スクロール検出
  if (measured.docW > measured.winW) {
    issues.push(`${width}px で横スクロール ${measured.docW - measured.winW}px`);
  }
  // はみ出し要素検出
  if (measured.over && measured.over.length) {
    issues.push(`${width}px ではみ出し要素 ${measured.over.length}件: ${measured.over.slice(0, 3).join(', ')}`);
  }
  // テキスト省略検出（truncateは行数だけでは気づけない）
  if (measured.truncated && measured.truncated.length) {
    issues.push(`${width}px でテキストが省略されている: ${measured.truncated.map((t) => t.selector).join(', ')}`);
  }
  // ナビ/ハンバーガーの排他性検出
  if (opts.checkNavExclusive && typeof measured.navVisible === 'boolean' && typeof measured.burgerVisible === 'boolean') {
    if (measured.navVisible && measured.burgerVisible) {
      issues.push(`${width}px でナビとハンバーガーが両方可視（排他であるべき）`);
    }
    if (!measured.navVisible && !measured.burgerVisible) {
      issues.push(`${width}px でナビとハンバーガーが両方不可視（どちらか出ているべき）`);
    }
    const wantNav = width >= opts.navBreakpoint;
    if (wantNav && !measured.navVisible) issues.push(`${width}px でナビが出ていない（${opts.navBreakpoint}px以上はナビ表示のはず）`);
    if (!wantNav && measured.navVisible) issues.push(`${width}px でナビが出てしまっている（${opts.navBreakpoint}px未満はハンバーガーのはず）`);
  }

  return { ok: issues.length === 0, issues };
}

/**
 * 全幅の実測結果を集約してProbeResultにする（純関数）。
 * @param {{width:number, measured:object}[]} allMeasurements
 * @param {{checkNavExclusive: boolean, navBreakpoint: number}} opts
 * @param {{reachable: boolean}} context
 * @returns {import('./lib/instrument-core.mjs').ProbeResult[]}
 */
export function judgeResponsiveRuntime(allMeasurements, opts, context) {
  if (!context.reachable) {
    return [{
      probe: 'レスポンシブ実測検査',
      verdict: 'inconclusive',
      detail: '対象ページに到達できませんでした',
      howToFix: 'URLが正しいか、開発サーバーが起動しているか確認してください'
    }];
  }

  const allIssues = [];
  for (const { width, measured } of allMeasurements) {
    const { issues } = judgeOneWidth(width, measured, opts);
    allIssues.push(...issues);
  }

  if (allIssues.length > 0) {
    return [{
      probe: 'レスポンシブ実測検査',
      verdict: 'fail',
      evidence: { 検査幅数: allMeasurements.length, 検出件数: allIssues.length },
      detail: `実ブラウザで崩れを検出しました: ${allIssues.slice(0, 8).join(' / ')}${allIssues.length > 8 ? ` 他${allIssues.length - 8}件` : ''}`,
      howToFix: '検出された幅・症状を元にCSSを直し、全幅で再検証してください'
    }];
  }

  return [{
    probe: 'レスポンシブ実測検査',
    verdict: 'pass',
    evidence: { 検査幅数: allMeasurements.length }
  }];
}

// ── selftest（★毒→赤、ブラウザ非依存） ──────────────────────────────────
function selftest() {
  const opts = { checkNavExclusive: true, navBreakpoint: 1024 };

  const cases = [
    {
      name: '毒1: ページに到達できない（測れなかった）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeResponsiveRuntime([], opts, { reachable: false })) === EXIT.INCONCLUSIVE
    },
    {
      name: '毒2: 横スクロールが発生している（赤）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const m = [{ width: 375, measured: { docW: 400, winW: 375, over: [] } }];
        return computeExitCode(judgeResponsiveRuntime(m, opts, { reachable: true })) === EXIT.FAIL;
      }
    },
    {
      name: '毒3: はみ出し要素がある（赤）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const m = [{ width: 375, measured: { docW: 375, winW: 375, over: ['DIV.card'] } }];
        return computeExitCode(judgeResponsiveRuntime(m, opts, { reachable: true })) === EXIT.FAIL;
      }
    },
    {
      name: '毒4: テキストが省略されている（赤）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const m = [{ width: 1440, measured: { docW: 1440, winW: 1440, over: [], truncated: [{ selector: 'header a span' }] } }];
        return computeExitCode(judgeResponsiveRuntime(m, opts, { reachable: true })) === EXIT.FAIL;
      }
    },
    {
      name: '毒5: ナビとハンバーガーが両方可視（排他違反、赤）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const m = [{ width: 1100, measured: { docW: 1100, winW: 1100, over: [], navVisible: true, burgerVisible: true } }];
        return computeExitCode(judgeResponsiveRuntime(m, opts, { reachable: true })) === EXIT.FAIL;
      }
    },
    {
      name: '毒6: 1024px境界でナビが出るべきなのに出ていない（赤）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const m = [{ width: 1024, measured: { docW: 1024, winW: 1024, over: [], navVisible: false, burgerVisible: true } }];
        return computeExitCode(judgeResponsiveRuntime(m, opts, { reachable: true })) === EXIT.FAIL;
      }
    },
    {
      name: '毒なし: 全て正常なら緑（誤検知しない）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const m = [
          { width: 375, measured: { docW: 375, winW: 375, over: [], navVisible: false, burgerVisible: true } },
          { width: 1280, measured: { docW: 1280, winW: 1280, over: [], navVisible: true, burgerVisible: false } },
        ];
        return computeExitCode(judgeResponsiveRuntime(m, opts, { reachable: true })) === EXIT.PASS;
      }
    },
  ];

  const { ok, fails } = runSelfTest(cases);
  if (!ok) {
    console.error('🔴 selftest 失敗:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log(`✅ selftest 合格（${cases.length}件: 横スクロール・はみ出し・省略・ナビ排他性の検知と誤検知なしを確認）`);
  process.exit(EXIT.PASS);
}

// ── 実行（実ブラウザが要るのでselftest以外はPlaywrightに依存） ──────────
if (process.argv.includes('--selftest')) {
  selftest();
}

const BASE = process.argv[2];
if (!BASE || BASE.startsWith('--')) {
  console.error('[responsive-runtime] FAIL  対象URLが必須です: node verify-responsive-runtime.mjs <url> [--config path]');
  process.exit(EXIT.INCONCLUSIVE);
}

const configPath = arg('--config', null);
let config = { widths: DEFAULT_WIDTHS, checkNavExclusive: false, navBreakpoint: 1024, waitForSelector: null };
if (configPath) {
  try {
    config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
  } catch (e) {
    console.error(`[responsive-runtime] FAIL  --config ${configPath} の読み込みに失敗しました: ${e.message}`);
    process.exit(EXIT.INCONCLUSIVE);
  }
}

let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch {
  console.log('[responsive-runtime] 🟡 @playwright/test が見つかりません（測れませんでした）');
  console.log('  → 測れるようにするには: npm install -D @playwright/test && npx playwright install chromium');
  process.exit(EXIT.INCONCLUSIVE);
}

let reachable = true;
const allMeasurements = [];
let browser;
try {
  browser = await chromium.launch();
  for (const width of config.widths) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (config.waitForSelector) {
        await page.locator(config.waitForSelector).first().waitFor({ state: 'visible', timeout: 15000 });
      }
      const measured = await page.evaluate((checkNav) => {
        const docW = document.documentElement.scrollWidth;
        const winW = window.innerWidth;
        // ★祖先でクリップされている要素は数えない(2026-09-01・偽の赤から)。
        //
        // 【何が起きたか】soushin-suggest.link に当てたところ、11幅すべてで
        //   DIV.thx-wipe が「はみ出し」として報告された。しかし実測すると
        //   ★docW === winW で【横スクロールは1pxも起きていなかった】。
        //   真因: この要素は transform: translateX(±105%) でアニメーションする
        //   演出用の帯で、親が overflow:hidden で刈っている(親側のCSSに
        //   「ここで刈らないと375px幅で横スクロールが285px発生する」と
        //   実測コメント付きで書かれていた＝既に正しく対処済みだった)。
        //
        // 【なぜ止めるか】★偽の赤は「毎回赤い検査」を作り、誰も読まなくなる。
        //   このキットの掟(件数のラチェットと同じ考え方)に反する。
        //   ⟹ 祖先に overflow の刈り取りがあるものは、画面外へ出ていても
        //      利用者には見えず、横スクロールも起こさないので除外する。
        const isClipped = (el) => {
          let a = el.parentElement;
          while (a && a !== document.documentElement) {
            const ov = getComputedStyle(a);
            if (ov.overflowX !== 'visible' || ov.overflowY !== 'visible') return true;
            a = a.parentElement;
          }
          return false;
        };
        const over = [];
        for (const e of document.querySelectorAll('body *')) {
          const r = e.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.right > winW + 1 || r.left < -1) {
            if (isClipped(e)) continue;   // ★刈られている＝実害なし
            over.push(`${e.tagName}.${(e.className || '').toString().slice(0, 48)}`);
          }
        }
        const truncated = [];
        for (const e of document.querySelectorAll('h1, h2, h3, header a span, [class*="title"], [class*="name"]')) {
          if (e.scrollWidth > e.getBoundingClientRect().width + 1) {
            truncated.push({ selector: `${e.tagName}.${(e.className || '').toString().slice(0, 32)}` });
          }
        }
        let navVisible, burgerVisible;
        if (checkNav) {
          const header = document.querySelector('header');
          const nav = header?.querySelector('nav');
          const burger = header?.querySelector('button');
          const vis = (el) => !!el && el.getBoundingClientRect().width > 0;
          navVisible = vis(nav);
          burgerVisible = vis(burger);
        }
        return { docW, winW, over: [...new Set(over)].slice(0, 5), truncated: truncated.slice(0, 5), navVisible, burgerVisible };
      }, config.checkNavExclusive);
      allMeasurements.push({ width, measured });
    } finally {
      await ctx.close();
    }
  }
} catch (e) {
  reachable = false;
  console.error(`[responsive-runtime] ページへの到達に失敗しました: ${e.message}`);
} finally {
  if (browser) await browser.close();
}

const results = judgeResponsiveRuntime(allMeasurements, { checkNavExclusive: config.checkNavExclusive, navBreakpoint: config.navBreakpoint }, { reachable });
const code = computeExitCode(results);
console.log(formatProbeReport(results, { label: 'responsive-runtime' }));
if (code === EXIT.FAIL) {
  for (const r of results.filter((x) => x.verdict === 'fail')) {
    console.error(`::error::${r.detail}`);
  }
}
process.exit(code);

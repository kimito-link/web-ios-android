#!/usr/bin/env node
/**
 * verify-all.mjs — ★このキットの検査を1本で全部走らせる入口。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか（2026-08-29）
 *
 *   検査が12本あるのに、それを束ねる入口が【1つも無かった】。
 *   ＝★全部を覚えている人だけが全部走らせられる状態。
 *   人は必ず忘れるので、これは時間の問題で破綻する。
 *   実際この日、進化台帳は★43コミットのあいだ一度も走っていなかった。
 *
 * ■ ★なぜ「&& で全部繋ぐ」ではないのか（これを間違えると害になる）
 *
 *   素朴に `a && b && c` で繋ぐと、1本でも赤いとそこで止まり、
 *   ★後ろの検査が「走らなかったのか、緑だったのか」区別できなくなる。
 *   さらにこのキットには★常時赤になりうる検査がある（下記）。
 *   入口が毎回赤だと、人は必ず見なくなる（オオカミ少年）。
 *
 *   ⟹ ★全部走らせてから、種類ごとに束ねる。
 *
 * ■ ★2種類に分ける（これがこの入口の設計の全部）
 *
 *   ゲート  … 赤なら【直すまで進んではいけない】もの。
 *             例: 検査が登録表から漏れている / selftest が毒で赤くならない。
 *             ★これらは「壊れている」ではなく「守りが効いていない」＝放置は危険。
 *
 *   レポート… 赤でも【止めない】もの。読んで判断するためのもの。
 *             例: 配布先リポとの割れ。★割れること自体は正常（各リポが独自に育つ）。
 *             異常なのは★割れたまま誰も気づかないことなので、数字を出すのが仕事。
 *             ここをゲートにすると、他リポを直すまでこのリポの作業が止まる
 *             ＝★他人の事情で自分が止まる。それは正しくない。
 *
 * ■ 終了コード（土台の3値規約に従う）
 *   0 = ゲート全緑 / 1 = ゲートに赤 / ★2 = ゲートが1本も測れなかった
 *   ★レポートの赤は終了コードに影響しない（画面には必ず出す）。
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 使い方:
 *   node scripts/verify-all.mjs
 *   node scripts/verify-all.mjs --selftest
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/**
 * ★package.json から `*:selftest` を全部拾う（手で書かない）。
 *
 * ■ ★なぜ自動で拾うのか（2026-08-29 に実測して方針を変えた）
 *   最初この表を【手で書いた】。その直後に数えたら
 *   ★すでに10件が漏れていた（context / instrument / security:score /
 *   responsive / claims / config:schema / assetlinks / links / splash / hub:page）。
 *   ＝**書いたその日のうちに穴が開いた**。
 *
 *   同じ日に PAIRS（手書き）で22件、run.mjs の CHECKS（手書き）でも
 *   同型の穴を見つけている。★手で書く表は必ず穴が開く、を3回続けて実証した。
 *   ⟹ ★拾えるものは拾う。人の記憶を仕組みの前提にしない。
 *
 * ★selftest を門にする理由: 「毒を入れても赤くならない検査」は
 *   静かに全部通す＝守りが効いていないのに緑に見える。最も危険な状態。
 *
 * @param {Record<string,string>} scripts package.json の scripts
 * @returns {Array<{kind:string,label:string,cmd:string[]}>}
 */
export function selftestTasks(scripts) {
  const s = scripts && typeof scripts === 'object' ? scripts : {};
  return Object.keys(s)
    .filter((k) => k.endsWith(':selftest') && k !== 'verify:selftest')
    .sort()
    .map((k) => ({
      kind: 'gate',
      label: `★検知器の自己検査: ${k.replace(/:selftest$/, '')}`,
      /*
       * ★Windows では `npm` は npm.cmd なので execFileSync('npm') は ENOENT。
       *   実際にこれで★16本すべてが赤になり、危うく「実害16件」と報告しかけた
       *   （個別に走らせると全部緑だった＝私が作った偽の赤）。
       *   ⟹ npm を介さず、script の中身をそのまま実行する。
       */
      cmd: parseScript(s[k])
    }))
    .filter((t) => t.cmd.length > 0);
}

/**
 * ★npm script の中身をコマンド配列にする。
 *
 * ★`&&` で複数繋いだ script は「最初の1本だけ」にしない。
 *   途中だけ走らせて緑にすると、走っていない後半を緑と読ませることになる。
 *   ⟹ シェル経由で丸ごと走らせる（`&&` の意味を保つ）。
 *
 * @param {string} cmdline
 * @returns {string[]} execFileSync に渡す [file, ...args]。解釈できなければ []
 */
export function parseScript(cmdline) {
  const line = typeof cmdline === 'string' ? cmdline.trim() : '';
  if (line === '') return [];
  // ★シェルの機能（&& など）を使うものは、シェルに任せる。
  if (/&&|\|\||[|><]/.test(line)) {
    return process.platform === 'win32'
      ? ['cmd', '/d', '/s', '/c', line]
      : ['sh', '-c', line];
  }
  // 単純な `node x.mjs --flag` はそのまま分解して直接実行（シェルを挟まない）。
  const parts = line.split(/\s+/);
  return parts.length ? parts : [];
}

/**
 * ★明示的に走らせるもの（selftest 以外）。kind でゲートとレポートを分ける。
 *
 * ★selftest は上の selftestTasks() が自動で拾うので、ここには書かない
 *   （二重に走らせない・書き忘れが起きない）。
 */
export const TASKS = Object.freeze([
  // ── ゲート（赤なら止める）─────────────────────────────────
  {
    kind: 'gate', label: '検査が走らせる表から漏れていないか',
    cmd: ['node', 'templates/diagnostics/check-runner-registers-all.mjs', '.']
  },
  {
    kind: 'gate', label: '配った実体が割れ検査に登録されているか',
    cmd: ['node', '_docs/instruments/check-drift-coverage.mjs']
  },
  {
    kind: 'gate', label: '進化台帳（実測値が記録されているか）',
    cmd: ['node', 'scripts/check-improvement.mjs', '--check']
  },
  {
    kind: 'gate', label: '検査が実際に走った記録があるか',
    cmd: ['node', 'scripts/check-instrument-ran.mjs', '--check']
  },
  {
    kind: 'gate', label: '公開ダッシュボードの鮮度',
    cmd: ['node', 'scripts/check-hub-page-freshness.mjs', '--root', '.', '--data', 'site/hub/hub-data.json']
  },
  // ★検知器の自己検査（毒で赤くなるか）は selftestTasks() が package.json から
  //   全部拾う。ここに手で書くと★書き忘れる（実測: 書いた直後に10件漏れていた）。
  // ── レポート（赤でも止めない）─────────────────────────────
  {
    kind: 'report', label: '配布先リポとの割れ（★放置日数つき）',
    cmd: ['node', '_docs/instruments/check-drift.mjs']
  },
  {
    kind: 'report', label: 'このリポ自身の診断キット',
    cmd: ['node', 'templates/diagnostics/run.mjs', '.']
  }
]);

/**
 * ★純粋な判定。走らせた結果から終了コードを決める。
 *
 * @param {Array<{kind:string, code:number}>} results
 * @returns {{exit:number, gateFail:number, gateInconclusive:number, reportFail:number}}
 */
export function decideExit(results) {
  const rs = Array.isArray(results) ? results : [];
  const gates = rs.filter((r) => r && r.kind === 'gate');
  const reports = rs.filter((r) => r && r.kind === 'report');
  const gateFail = gates.filter((r) => r.code === 1).length;
  const gateInconclusive = gates.filter((r) => r.code === 2).length;
  const reportFail = reports.filter((r) => r.code !== 0).length;

  // ★ゲートが1本も無い＝測れていない。緑にしない。
  if (gates.length === 0) {
    return { exit: EXIT.INCONCLUSIVE, gateFail, gateInconclusive, reportFail };
  }
  if (gateFail > 0) return { exit: EXIT.FAIL, gateFail, gateInconclusive, reportFail };
  // ★全ゲートが「測れなかった」なら緑にしない。
  if (gateInconclusive === gates.length) {
    return { exit: EXIT.INCONCLUSIVE, gateFail, gateInconclusive, reportFail };
  }
  return { exit: EXIT.PASS, gateFail, gateInconclusive, reportFail };
}

// ---- 実行 ------------------------------------------------------------------

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain && process.argv.includes('--selftest')) {
  /** @type {Array<{name:string, ok:() => boolean}>} */
  const cases = [
    {
      name: '★ゲートが赤なら全体も赤',
      ok: () => decideExit([{ kind: 'gate', code: 1 }, { kind: 'gate', code: 0 }]).exit === EXIT.FAIL
    },
    {
      name: '★レポートが赤でも全体は止めない',
      ok: () => decideExit([{ kind: 'gate', code: 0 }, { kind: 'report', code: 1 }]).exit === EXIT.PASS
    },
    {
      name: '★ゲートが1本も無ければ緑にしない(測れていない)',
      ok: () => decideExit([{ kind: 'report', code: 0 }]).exit === EXIT.INCONCLUSIVE
    },
    {
      name: '★全ゲートが「測れなかった」なら緑にしない',
      ok: () => decideExit([{ kind: 'gate', code: 2 }, { kind: 'gate', code: 2 }]).exit === EXIT.INCONCLUSIVE
    },
    {
      name: '★一部が測れなくても、測れた分が緑なら通す(常時赤にしない)',
      ok: () => decideExit([{ kind: 'gate', code: 0 }, { kind: 'gate', code: 2 }]).exit === EXIT.PASS
    },
    {
      name: '★空の結果を緑にしない',
      ok: () => decideExit([]).exit === EXIT.INCONCLUSIVE && decideExit(null).exit === EXIT.INCONCLUSIVE
    },
    {
      name: '★走らせる表が空でないこと(0本を緑にしない型の再発防止)',
      ok: () => TASKS.length > 0 && TASKS.some((t) => t.kind === 'gate')
    },
    /*
     * ★以下は selftest の自動収集を守る（ここが壊れると、検知器が
     *   1本も走っていないのに緑になる＝今日いちばん避けたい状態）。
     */
    {
      name: '★package.json の *:selftest を拾う',
      ok: () => selftestTasks({ 'a:selftest': 'x', 'b:selftest': 'y', c: 'z' }).length === 2
    },
    {
      name: '★自分自身(verify:selftest)は拾わない(無限再帰の防止)',
      ok: () => selftestTasks({ 'verify:selftest': 'x' }).length === 0
    },
    {
      name: '★拾ったものは全部ゲートになる(レポート扱いにして見逃さない)',
      ok: () => selftestTasks({ 'a:selftest': 'x' }).every((t) => t.kind === 'gate')
    },
    {
      name: '★selftest が無ければ0本を返す(架空の緑を作らない)',
      ok: () => selftestTasks({ build: 'x' }).length === 0
    },
    {
      name: '★壊れた入力で throw しない',
      ok: () => selftestTasks(null).length === 0 && selftestTasks('x').length === 0
    },
    {
      name: '★実際の package.json から1本以上拾えている(配線が生きている)',
      ok: () => {
        const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
        return selftestTasks(pkg.scripts).length > 0;
      }
    },
    /*
     * ★以下は「私が作った偽の赤」の再発防止（2026-08-29 に実際に踏んだ）。
     *   npm を execFileSync で直接呼んで Windows で ENOENT → 16本が全部赤になり、
     *   危うく実害16件と報告しかけた。★実際は個別に走らせると全部緑だった。
     */
    {
      name: '★npm を介さない(Windows で npm は npm.cmd ＝ ENOENT になる)',
      ok: () => selftestTasks({ 'a:selftest': 'node x.mjs --selftest' })
        .every((t) => t.cmd[0] !== 'npm')
    },
    {
      name: '★単純なコマンドはシェルを挟まず直接実行する',
      ok: () => {
        const c = parseScript('node x.mjs --selftest');
        return c[0] === 'node' && c.includes('--selftest');
      }
    },
    {
      name: '★`&&` で繋いだ script を最初の1本だけにしない(後半を緑と誤読させない)',
      ok: () => {
        const c = parseScript('node a.mjs && node b.mjs');
        return c.join(' ').includes('a.mjs') && c.join(' ').includes('b.mjs');
      }
    },
    {
      name: '★空の script からコマンドを作らない(空振りを緑にしない)',
      ok: () => parseScript('').length === 0 && parseScript(null).length === 0
        && selftestTasks({ 'a:selftest': '' }).length === 0
    }
  ];

  const failed = cases.filter((c) => { try { return !c.ok(); } catch { return true; } });
  if (failed.length) {
    console.error('[verify-all] ★selftest 失敗（束ね方が効いていません）:');
    for (const f of failed) console.error(`  - ${f.name}`);
    process.exit(EXIT.FAIL);
  }
  console.log(`[verify-all] selftest OK（${cases.length}件・ゲートは止める / レポートは止めない / 0本を緑にしない）`);
  process.exit(EXIT.PASS);
}

if (isMain) {
  /** @type {Array<{kind:string, label:string, code:number}>} */
  const results = [];

  // ★selftest は package.json から自動で拾う（手で書かない＝書き忘れない）。
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  const selftests = selftestTasks(pkg.scripts);
  if (selftests.length === 0) {
    // ★1本も拾えないのは「selftest が無い」のではなく【拾えていない】疑い。
    console.log('[verify-all] 🟡 selftest を1本も拾えませんでした(★緑ではありません)。');
    console.log('    → package.json の scripts に `*:selftest` があるか確認してください。');
  }
  const all = [...selftests, ...TASKS];

  for (const t of all) {
    let code = 0;
    let out = '';
    try {
      out = execFileSync(t.cmd[0], t.cmd.slice(1), {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000
      });
    } catch (e) {
      code = typeof e.status === 'number' ? e.status : 1;
      out = String(e.stdout || '') + String(e.stderr || '');
    }
    results.push({ kind: t.kind, label: t.label, code });

    const mark = code === 0 ? '✅' : code === 2 ? '🟡' : '🔴';
    const tag = t.kind === 'gate' ? '[門]' : '[報]';
    console.log(`\n${tag} ${mark} ${t.label}`);
    // ★出力は捨てない。赤の理由が読めないと直せない。
    const lines = out.split('\n').filter((l) => l.trim() !== '');
    for (const l of lines.slice(0, code === 0 ? 2 : 40)) console.log('    ' + l);
    if (code === 0 && lines.length > 2) console.log(`    …(緑なので ${lines.length - 2} 行省略)`);
  }

  const d = decideExit(results);
  console.log('\n' + '─'.repeat(60));
  console.log(`[verify-all] 門: ${results.filter((r) => r.kind === 'gate').length}本 `
    + `(赤 ${d.gateFail} / 測れず ${d.gateInconclusive}) `
    + `｜ 報: ${results.filter((r) => r.kind === 'report').length}本 (赤 ${d.reportFail})`);

  if (d.exit === EXIT.PASS && d.reportFail > 0) {
    console.log('[verify-all] ✅ 門は全緑。★ただしレポートに赤があります（上を読んでください）。');
    console.log('    ★レポートの赤は止めませんが、放置すると「見えているのに誰も直さない」状態になります。');
  } else if (d.exit === EXIT.PASS) {
    console.log('[verify-all] ✅ 門は全緑・レポートも赤なし。');
  } else if (d.exit === EXIT.FAIL) {
    console.log('[verify-all] 🔴 門に赤があります。★直すまで進まないでください。');
  } else {
    console.log('[verify-all] 🟡 門を測れませんでした(★緑ではありません)。');
  }
  console.log('[verify-all] ★この入口が判定しないこと: 製品が正しく動くかは見ません（検査の健全性だけ）。');

  process.exit(d.exit);
}

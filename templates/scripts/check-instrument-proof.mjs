#!/usr/bin/env node
/**
 * check-instrument-proof.mjs — ★README §6 未解決#2・#3への答え。「所有」ではなく「証明」を見る門番。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ 何を判定するか
 *   `.instrument-proof.json`（証明3点台帳、record-instrument-proof.mjsが書く）を読み、
 *   各検査が「実対象で緑になったことがある」「実対象で赤になったことがある」
 *   「その両方が現在のソースで観測されている」の3点を満たすかを見る。
 *
 *   ★判定ロジック本体は lib/instrument-proof.mjs の judgeProof()（純関数）。
 *   このファイルは「台帳を読み、対象を並べ、結果をまとめる」だけの薄い門番。
 *
 * ■ ★PRE-FLIGHT証拠の判定（2026-09-02追加、証明3点とは別軸）
 *   `changedFiles`（POST-FLIGHT証拠、record側がGitから自動記録）が付いているエントリ、
 *   つまり★この拡張が入った後に record-instrument-proof.mjs が書いた記録に限り、
 *   `preflightSearchPath`（ai-hub検索を実行した証拠）が伴っているかを追加で見る。
 *   ★changedFilesが無い古いエントリ（この拡張前の記録）はこの軸の判定対象から外す
 *   （新フィールドが無いという理由だけで既存の正常な証明履歴を壊さないため）。
 *   この軸はinconclusiveのみで、fail/passの集約exitには混ぜない設計は据え置き
 *   （下記--checkの出力で別枠として表示するのみ）。
 *
 * ■ ★何を判定しないか（限界の明記）
 *   ・台帳の記録が本当に実対象からの実行結果か（record-instrument-proof.mjsを
 *     手で叩けば偽装できる＝check-instrument-ran.mjsのstampと同じ限界）
 *   ・検査ロジックそのものの正しさ（各検査の--selftestの仕事）
 *   ・preflightSearchPathが指すログの中身（存在確認だけ。record側の責務）
 *
 * ■ 使い方
 *   node scripts/check-instrument-proof.mjs --check [対象リポ]
 *   node scripts/check-instrument-proof.mjs --check --name scripts/verify-security-score.mjs [対象リポ]
 *   node scripts/check-instrument-proof.mjs --selftest
 *
 * ■ 終了コード（3値規約）
 *   0 = 全対象が証明3点を満たす / 1 = 台帳がJSONとして壊れている / 2 = 証明不足がある
 * ───────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';
import { judgeProof, judgePreflight, codeOnly, hashSource } from './lib/instrument-proof.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(startDir, '..');
}

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
function opt(name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
const VALUE_OPTIONS = new Set(['--name']);
const positional = argv.find((arg, index) => !arg.startsWith('-') && !VALUE_OPTIONS.has(argv[index - 1]));

const ROOT = positional ? resolve(positional) : findRepoRoot(HERE);
const PROOF_FILE = join(ROOT, '.instrument-proof.json');

function readProof(file = PROOF_FILE) {
  if (!existsSync(file)) return { checks: {} }; // ★台帳が無い＝まだ一度も記録していない(壊れているのとは別)
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return j && typeof j === 'object' && j.checks && typeof j.checks === 'object' ? j : { checks: {} };
  } catch {
    return null; // ★壊れている（無いのと区別する）
  }
}

/**
 * ★対象スクリプトの「いま」のソースからhashを計算する。読めなければnull。
 * これを台帳に記録された sourceHash と突き合わせて「直した後も緑が観測されたか」を判定する
 * （ここを台帳の値そのままにすると判定が自己参照になり、常にpassしてしまう＝意味を失う）。
 */
function currentSourceHash(scriptRelPath) {
  const abs = resolve(ROOT, scriptRelPath);
  if (!existsSync(abs)) return null;
  try {
    return hashSource(codeOnly(readFileSync(abs, 'utf8')));
  } catch {
    return null;
  }
}

/* ── --selftest ─────────────────────────────────────────────── */
if (has('--selftest')) {
  const { ok, fails } = runSelfTest([
    {
      name: '★記録が無いのを緑にしない',
      poison: () => {}, restore: () => {},
      isRed: () => judgeProof(undefined, 'h1').verdict === 'inconclusive'
    },
    {
      name: '★ソース変更後に緑が無ければ緑にしない',
      poison: () => {}, restore: () => {},
      isRed: () => judgeProof(
        { lastRealGreen: { commit: 'a', at: new Date().toISOString(), sourceHash: 'old' } },
        'new'
      ).verdict === 'inconclusive'
    },
    {
      name: '★90日超えて一度も赤を経験していなければ緑にしない（掟⑪の機械化）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const nowMs = Date.parse('2026-09-02T00:00:00Z');
        const oldGreen = new Date(nowMs - 91 * 86400000).toISOString();
        return judgeProof(
          { lastRealGreen: { commit: 'a', at: oldGreen, sourceHash: 'h1' } },
          'h1',
          { nowMs }
        ).verdict === 'inconclusive';
      }
    },
    {
      name: '★緑・赤ともに現hashで観測済みなら緑になる（誤検知しない）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const nowMs = Date.parse('2026-09-02T00:00:00Z');
        const recentGreen = new Date(nowMs - 1 * 86400000).toISOString();
        return judgeProof(
          {
            lastRealGreen: { commit: 'a', at: recentGreen, sourceHash: 'h1' },
            lastRealRed: { commit: 'b', at: recentGreen, sourceHash: 'h1' }
          },
          'h1',
          { nowMs }
        ).verdict === 'pass';
      }
    },
    {
      name: '★90日以内なら赤未経験でも緑になる（誤検知しない）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const nowMs = Date.parse('2026-09-02T00:00:00Z');
        const recentGreen = new Date(nowMs - 10 * 86400000).toISOString();
        return judgeProof(
          { lastRealGreen: { commit: 'a', at: recentGreen, sourceHash: 'h1' } },
          'h1',
          { nowMs }
        ).verdict === 'pass';
      }
    },
    {
      name: '★台帳が無いのを壊れているのと混同しない（無い=inconclusive記録なし扱い、壊れている=fail）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const missing = readProof(join(HERE, '__does-not-exist__.json'));
        return missing !== null && typeof missing.checks === 'object';
      }
    },
    {
      name: '★changedFiles(POST-FLIGHT証拠)が無い旧エントリはPRE-FLIGHT判定の対象外(null)にする（既存記録を壊さない）',
      poison: () => {}, restore: () => {},
      isRed: () => judgePreflight({ lastRealGreen: { commit: 'a', at: new Date().toISOString(), sourceHash: 'h1' } }) === null
    },
    {
      name: '★changedFilesはあるがpreflightSearch(receipt)が無ければinconclusive',
      poison: () => {}, restore: () => {},
      isRed: () => judgePreflight({ changedFiles: ['x.mjs'] })?.verdict === 'inconclusive'
    },
    {
      name: '★pathだけあってreceipt本体が無ければpassにしない（ログが消えた後にpassし続ける事故の防止）',
      poison: () => {}, restore: () => {},
      isRed: () => judgePreflight({
        changedFiles: ['x.mjs'],
        preflightSearchPath: '.log' // ★元ログの場所を示す文字列だけがある状態を模擬
      })?.verdict === 'inconclusive'
    },
    {
      name: '★preflightSearch(receipt)があればpass（元ログが無くても検証できる）',
      poison: () => {}, restore: () => {},
      isRed: () => judgePreflight({
        changedFiles: ['x.mjs'],
        preflightSearch: { cmd: 'find', at: new Date().toISOString(), tag: ['x'], sig: null, exitCode: 0, hits: 1 }
        // ★preflightSearchPathを意図的に付けない＝元ログが既に無い状態を模擬してもpassすること
      })?.verdict === 'pass'
    }
  ]);
  if (!ok) {
    console.error('[check-instrument-proof] ★selftest 失敗(検知器が効いていません):');
    for (const f of fails) console.error('  - ' + f);
    process.exit(EXIT.FAIL);
  }
  console.log('[check-instrument-proof] selftest OK(記録なし/ソース変更後未緑/90日赤未経験 を緑にしない・★直近の両観測は誤検知しない)');
  process.exit(EXIT.PASS);
}

/* ── --check ────────────────────────────────────────────────── */
const proof = readProof();
if (proof === null) {
  console.error(`[check-instrument-proof] 🔴 台帳がJSONとして壊れています: ${PROOF_FILE}`);
  console.error('   → 直し方: .instrument-proof.json を消して、record-instrument-proof.mjs で作り直す');
  process.exit(EXIT.FAIL);
}

const names = has('--name')
  ? [opt('--name')]
  : Object.keys(proof.checks);

if (names.length === 0) {
  console.log('[check-instrument-proof] 🟡 台帳に記録が1件もありません（★まだ record-instrument-proof.mjs を一度も実行していないだけかもしれません）');
  process.exit(EXIT.INCONCLUSIVE);
}

const results = names.map((name) => {
  const entry = proof.checks[name];
  const hash = currentSourceHash(name);
  if (!hash) {
    return {
      probe: `検査の証明3点: ${name}`, verdict: 'inconclusive', evidence: null,
      detail: `対象スクリプトを読めません（${name}）。移動・削除された可能性があります`,
      howToFix: '台帳のキー(スクリプトの相対パス)と実ファイルの場所が一致しているか確認する',
      limitation: '★このスクリプト自体が実行できるかは見ません。実在と読めるかだけを見ます'
    };
  }
  const base = judgeProof(entry, hash);
  return { ...base, probe: `検査の証明3点: ${name}` };
});

console.log(formatProbeReport(results, { label: 'check-instrument-proof' }));
for (const r of results) {
  if (r.verdict !== 'pass') {
    console.log(`   → この検査は「所有(exit 2を持つ)」ではなく「証明(実対象で赤緑を観測した記録)」で判定しています。限界: 台帳への書き込み自体が偽装可能`);
  }
}

// ★PRE-FLIGHT証拠は証明3点(judgeProof)とは別軸の判定だが、★最終的な完了可否には合流させる。
//   changedFilesが無い(この拡張前の)旧形式エントリはjudgePreflightがnullを返すため対象外のまま
//   （既存の証明履歴を壊さない）。changedFilesがある新形式エントリだけ、この軸の結果を
//   results（=computeExitCodeが見る配列）へ加える。「表示するだけで完了扱いを止めない」を避けるため。
//   新しいexit code体系は増やさない（EXIT.PASS/FAIL/INCONCLUSIVEをそのまま使う）。
const preflightResults = names
  .map((name) => ({ name, r: judgePreflight(proof.checks[name]) }))
  .filter((x) => x.r !== null);
if (preflightResults.length > 0) {
  console.log('\n--- PRE-FLIGHT証拠（新形式の記録のみ・結果は下の完了判定に合流します） ---');
  for (const { name, r } of preflightResults) {
    const mark = r.verdict === 'pass' ? '✓' : '?';
    const msg = r.verdict === 'pass'
      ? `検索receiptあり(${r.evidence.検索日時} / ${r.evidence.条件} / ${r.evidence.件数}件)`
      : r.detail;
    console.log(`${mark} ${name}: ${msg}`);
  }
  results.push(...preflightResults.map(({ name, r }) => ({ ...r, probe: `${r.probe}: ${name}` })));
}

process.exit(computeExitCode(results));

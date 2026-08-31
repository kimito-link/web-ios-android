#!/usr/bin/env node
// コミットメッセージの「根治した」宣言に実機確認の根拠が伴っているかを検査するゲート。
//
// 移植元: tsuioku-no-kirameki.com/scripts/check-root-cause-claim.mjs
//   （2026-08-31、council-fable「逆輸入候補」調査で発見・輸入）
//
// ★移植元の実績(2026-08-04・docs/handoff/ROOT-CAUSE-CLAIM-RULE.md):
//   90日で164回「根治」を宣言しながら、同じ症状が41回再発していた。
//   規則を文書に書くだけでは注意力頼みになり、必ず破られる（実際、
//   「推測で直す前に測る」という規律は既にあったのに守れていなかった）。
//   なので機械に見張らせる。
//
// ★重要な設計（移植元が自分で踏んだ地雷）: 「実測値を引用している」だけでは足りない。
//   修正【前】の実測を引用しても「根治」を名乗れてしまう素朴な検査では、
//   修正【後】に症状が消えたことは未確認のまま通ってしまった。
//   よって認めるのは「修正後に症状が消えたことを示す語」だけに絞る。
//
// 何をするか:
//   コミットメッセージに「根治」等の宣言語が含まれ、かつ修正後の実機確認を示す
//   根拠語が書かれていなければ、エラーにして書き直させる。
//
// 根拠として認めるもの（いずれか1つ）:
//   ・修正後に症状が消えたことを示す語（既定: 症状消失・症状が消え・再発しない等）
//   ・「未確認」と自ら明記している（=根治を名乗っていない扱い）
//
// 使い方:
//   node scripts/verify-root-cause-claim.mjs                 # 直近コミットを検査
//   node scripts/verify-root-cause-claim.mjs <commit-msg-file>
//   node scripts/verify-root-cause-claim.mjs --config words.json  # 語彙をプロジェクト固有に上書き
//   node scripts/verify-root-cause-claim.mjs --selftest
//
// --configのJSON形式（省略時は既定の日本語ワードリストを使う）:
//   { "claimWords": [...], "evidenceWords": [...], "hedgeWords": [...] }
//
// 終了コード（instrument-core の3値規約）:
//   0 = 根治宣言なし、または根拠あり / 1 = 根拠なき根治宣言（測れた上での赤） / 2 = 測れなかった（メッセージ取得失敗）
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';

/** 「根治した」と主張する語。これがあると検査対象になる。 */
const DEFAULT_CLAIM_WORDS = ['根治', '真因を特定', '完全に直', '解決しました', '直りました'];

/** 修正後の実機確認を示す語だけを根拠として認める（修正前の実測では足りない）。 */
const DEFAULT_EVIDENCE_WORDS = [
  '症状消失', '症状が消え', '再発しない', '修正後の実測', '適用後の実測',
  '反映後に確認', '実機で確認済み', '実機確認済み'
];

/** 未確認を自ら明示していれば、根治の主張とみなさない。 */
const DEFAULT_HEDGE_WORDS = ['未確認', '効くはず', '仮説', '見込み', '検証待ち', '要確認'];

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/**
 * ★判定の本体（純関数・fsに触らない＝テストしやすい）。
 * @param {string} messageBody コメント行(#)を除いたコミットメッセージ本文
 * @param {{claimWords: string[], evidenceWords: string[], hedgeWords: string[]}} words
 * @returns {import('./lib/instrument-core.mjs').ProbeResult[]}
 */
export function judgeRootCauseClaim(messageBody, words) {
  const body = String(messageBody || '');
  const claimed = words.claimWords.filter((w) => body.includes(w));

  if (claimed.length === 0) {
    return [{
      probe: '根治宣言の根拠検査',
      verdict: 'pass',
      evidence: { 判定: '根治を名乗っていない' }
    }];
  }

  const hedged = words.hedgeWords.filter((w) => body.includes(w));
  if (hedged.length > 0) {
    return [{
      probe: '根治宣言の根拠検査',
      verdict: 'pass',
      evidence: { 宣言語: claimed[0], 併記された留保語: hedged[0] }
    }];
  }

  const evidence = words.evidenceWords.filter((w) => body.includes(w));
  if (evidence.length > 0) {
    return [{
      probe: '根治宣言の根拠検査',
      verdict: 'pass',
      evidence: { 宣言語: claimed[0], 根拠語: evidence[0] }
    }];
  }

  return [{
    probe: '根治宣言の根拠検査',
    verdict: 'fail',
    evidence: { 宣言語: claimed[0] },
    detail: `「${claimed[0]}」と書いていますが、修正後に症状が消えたことを示す根拠がありません`,
    howToFix: '確認済みなら実測値を本文に書く（例: 「実機実測: 描画77回/件→1.2回/件・症状消失を確認」）。未確認なら「効くはず(未確認)」「仮説」等に書き換えてください'
  }];
}

// ── selftest（★毒→赤） ──────────────────────────────────────────────────
function selftest() {
  const words = { claimWords: DEFAULT_CLAIM_WORDS, evidenceWords: DEFAULT_EVIDENCE_WORDS, hedgeWords: DEFAULT_HEDGE_WORDS };

  const cases = [
    {
      name: '毒なし: 根治を名乗っていなければpass（誤検知しない）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeRootCauseClaim('typoを修正', words)) === EXIT.PASS
    },
    {
      name: '毒1: 根拠なく「根治」を名乗っている（赤）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeRootCauseClaim('バグを根治した', words)) === EXIT.FAIL
    },
    {
      name: '毒2: 修正前の実測値だけでは通さない（赤のまま、移植元が実際に踏んだ地雷）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeRootCauseClaim('根治した。修正前の描画回数は77回/件だった', words)) === EXIT.FAIL
    },
    {
      name: '毒なし: 修正後の実測（症状消失）が書かれていればpass',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeRootCauseClaim('根治した。修正後の実測で症状消失を確認', words)) === EXIT.PASS
    },
    {
      name: '毒なし: 未確認と自己明記していればpass（留保語で回避可能）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeRootCauseClaim('根治のはず（未確認）', words)) === EXIT.PASS
    },
  ];

  const { ok, fails } = runSelfTest(cases);
  if (!ok) {
    console.error('🔴 selftest 失敗:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log(`✅ selftest 合格（${cases.length}件: 根拠なき宣言の検知・修正前実測との区別・留保語での回避を確認）`);
  process.exit(EXIT.PASS);
}

// ── 実行 ────────────────────────────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
  selftest();
}

let words = { claimWords: DEFAULT_CLAIM_WORDS, evidenceWords: DEFAULT_EVIDENCE_WORDS, hedgeWords: DEFAULT_HEDGE_WORDS };
const configPath = arg('--config', null);
if (configPath) {
  try {
    const custom = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    words = {
      claimWords: custom.claimWords || DEFAULT_CLAIM_WORDS,
      evidenceWords: custom.evidenceWords || DEFAULT_EVIDENCE_WORDS,
      hedgeWords: custom.hedgeWords || DEFAULT_HEDGE_WORDS,
    };
  } catch (e) {
    console.error(`[root-cause-claim] FAIL  --config ${configPath} の読み込みに失敗しました: ${e.message}`);
    process.exit(EXIT.INCONCLUSIVE);
  }
}

const positional = process.argv.slice(2).find((a, i, arr) => !a.startsWith('--') && arr[i - 1] !== '--config');

let msg;
try {
  msg = positional
    ? fs.readFileSync(positional, 'utf8')
    : execSync('git log -1 --pretty=%B', { encoding: 'utf8' });
} catch (e) {
  console.log(`[root-cause-claim] 🟡 コミットメッセージを取得できませんでした（測れませんでした）: ${e.message}`);
  process.exit(EXIT.INCONCLUSIVE);
}

// コメント行(#)を除く
const body = msg.split(/\r?\n/).filter((l) => !l.trimStart().startsWith('#')).join('\n');

const results = judgeRootCauseClaim(body, words);
const code = computeExitCode(results);
console.log(formatProbeReport(results, { label: 'root-cause-claim' }));
if (code === EXIT.FAIL) {
  for (const r of results.filter((x) => x.verdict === 'fail')) {
    console.error(`::error::${r.detail}`);
  }
}
process.exit(code);

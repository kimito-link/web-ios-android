#!/usr/bin/env node
/**
 * screen-duplicate-clusters-with-jev.mjs — ★near-duplicatesクラスタの統合要否を、
 * Jev（TypeSafe AI）へ一次スクリーニングとして投げる、オプトイン専用のPoCスクリプト。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★何をするか
 *   check-near-duplicates.mjs（判定ロジックは一切変更しない・importして再利用）が検出した
 *   クラスタごとに、該当ファイルの該当行を抜き出してJev APIへ送り、
 *   「この2つのコード片は同じ責務を持ち、1つの実装に統合すべきか」をScore型で問う。
 *
 * ■ ★何をしないか（重要）
 *   ・**判定を確定させない。** Jevの出力はHEURISTIC（推測）に留まる。DECLARED判定は
 *     人間/AIがCANONICAL CHECK13項目（_docs/DESIGN-canonical-boundary-rules.md）を
 *     通してから行う。このスクリプトはその判定を代行しない。
 *   ・**既存Gate群に配線されていない。** run-instruments.mjs等からは呼ばれない、
 *     手動実行専用のオプトインツール。
 *   ・**.decision-receipts.json / Gate結果に一切書き込まない。** 副作用ゼロ。
 *   ・**低confidenceのクラスタは何も提示しない。** ノイズとして握りつぶす
 *     （Jev公式の"Confidence-gated routing"パターンに準拠）。
 *
 * ■ ★TYPESAFE_API_KEYの扱い
 *   環境変数からのみ読む。ファイルに書かない・ログに残さない・出力に含めない。
 *   ~/.claude/CLAUDE.md「トークン・鍵の受け渡しはクリップボード経由」節の手順で取得する。
 *
 * ■ 詳細: docs/ai-workflows/JEV-DUPLICATE-SCREENING-HOWTO.md
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 使い方:
 *   TYPESAFE_API_KEY=<key> node screen-duplicate-clusters-with-jev.mjs [対象ディレクトリ]
 *   node screen-duplicate-clusters-with-jev.mjs --selftest
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  isGeneratedFile,
  extractNormalizedLines,
  buildWindows,
  judgeNearDuplicates,
} from './check-near-duplicates.mjs';

const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });
const TARGET_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.html'];
const EXCLUDED = /(^|\/)(node_modules|vendor|third_party|dist|build|out|_backup|\.min\.)/;

const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const CONTEXT_LINES = 15; // クラスタ開始行の前後に足す文脈行数

const HIGH_CONFIDENCE = 0.75;
const LOW_CONFIDENCE = 0.5;

/**
 * ★クラスタが指す各ファイルの該当行（前後に文脈を足した範囲）を抜き出す。
 * 純粋関数（fsに触らない、抜き出し元の行配列を渡す設計）。
 *
 * @param {{files:string[], startLines:Record<string,number>, lineCount:number}} cluster
 * @param {Record<string,string[]>} fileLinesMap path -> 元の行配列（1-indexed想定でindex 0がダミー）
 * @returns {{path:string, excerpt:string}[]}
 */
export function buildClusterExcerpts(cluster, fileLinesMap) {
  const out = [];
  for (const path of cluster.files || []) {
    const lines = fileLinesMap[path];
    if (!Array.isArray(lines)) continue;
    const start = Math.max(1, (cluster.startLines?.[path] || 1) - CONTEXT_LINES);
    const end = Math.min(lines.length, (cluster.startLines?.[path] || 1) + cluster.lineCount + CONTEXT_LINES);
    const excerpt = lines.slice(start - 1, end).join('\n');
    out.push({ path, excerpt: `// ${path} (lines ${start}-${end})\n${excerpt}` });
  }
  return out;
}

/**
 * ★1クラスタ分のJevリクエストボディを組み立てる（純粋関数、fetchはしない）。
 * @param {{path:string, excerpt:string}[]} excerpts
 * @returns {object}
 */
export function buildJevRequestBody(excerpts) {
  const state = excerpts.map((e) => e.excerpt).join('\n\n---\n\n');
  return {
    state,
    model: 'jev-latest',
    questions: {
      should_merge: {
        type: 'score',
        instructions: 'このコード片たちは同じ責務を持ち、1つの実装に統合すべきか',
        criteria: [
          '明確に別の責務・統合すべきでない',
          '判断が分かれる・条件次第',
          '明確に同じ責務・統合すべき',
        ],
      },
      difference_kind: {
        type: 'choice',
        instructions: 'コード片の差分の性質は何か',
        criteria: {
          values_only: '値・定数・文字列などの違いのみで、構造は同一',
          feature_block: '片方にだけ存在する機能ブロックがある',
          structural: '同じ目的だが構造・アルゴリズムが異なる',
        },
      },
    },
  };
}

/**
 * ★Jev APIレスポンスから、提示用の1行サマリと分類（high/medium/low）を作る（純粋関数）。
 * @param {object} answers Jev APIの`answers`フィールド
 * @returns {{tier:'high'|'medium'|'low', summary:string}}
 */
export function summarizeJevAnswer(answers) {
  const score = answers?.should_merge;
  const choice = answers?.difference_kind;
  if (!score || typeof score.score !== 'number' || typeof score.confidence !== 'number') {
    return { tier: 'low', summary: '（応答形式が不正でスクリーニングできませんでした）' };
  }
  const confidence = score.confidence;
  const tier = confidence >= HIGH_CONFIDENCE ? 'high' : confidence >= LOW_CONFIDENCE ? 'medium' : 'low';
  const diffLabel = choice?.choice ? `差分: ${choice.choice}` : '差分: 不明';
  const scoreLabel = score.score.toFixed(2);
  return {
    tier,
    summary: `should_merge=${scoreLabel} confidence=${confidence.toFixed(2)} / ${diffLabel}`,
  };
}

// ── selftest（★毒→赤。fetchは行わず、純粋関数だけを検証する） ──────────────
function runSelftest() {
  const fails = [];

  // ① クラスタからの文脈付き抜粋が正しく作れる
  {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const cluster = { files: ['a.js'], startLines: { 'a.js': 20 }, lineCount: 12 };
    const excerpts = buildClusterExcerpts(cluster, { 'a.js': lines });
    if (excerpts.length !== 1) fails.push('★抜粋件数が1件でない');
    if (!excerpts[0].excerpt.includes('a.js')) fails.push('★抜粋にファイル名が入っていない');
    if (!excerpts[0].excerpt.includes('line 20')) fails.push('★クラスタ開始行が抜粋に含まれない');
  }

  // ② リクエストボディがJev API仕様（state/model/questions）を満たす
  {
    const body = buildJevRequestBody([{ path: 'a.js', excerpt: 'const I = 0;' }]);
    if (typeof body.state !== 'string' || body.state.length === 0) fails.push('★stateが空');
    if (body.model !== 'jev-latest') fails.push('★modelがjev-latestでない');
    if (!body.questions.should_merge || body.questions.should_merge.type !== 'score') {
      fails.push('★should_mergeがscore型でない');
    }
    if (!Array.isArray(body.questions.should_merge.criteria) || body.questions.should_merge.criteria.length < 2) {
      fails.push('★should_mergeのcriteriaが2件未満（API仕様違反）');
    }
    if (!body.questions.difference_kind || body.questions.difference_kind.type !== 'choice') {
      fails.push('★difference_kindがchoice型でない');
    }
  }

  // ③ 高/中/低confidenceの分類が閾値通り
  {
    const high = summarizeJevAnswer({
      should_merge: { type: 'score', score: 2.1, confidence: 0.9 },
      difference_kind: { type: 'choice', choice: 'values_only' },
    });
    if (high.tier !== 'high') fails.push('★confidence0.9がhighにならない');

    const medium = summarizeJevAnswer({
      should_merge: { type: 'score', score: 1.0, confidence: 0.6 },
    });
    if (medium.tier !== 'medium') fails.push('★confidence0.6がmediumにならない');

    const low = summarizeJevAnswer({
      should_merge: { type: 'score', score: 0.2, confidence: 0.3 },
    });
    if (low.tier !== 'low') fails.push('★confidence0.3がlowにならない');
  }

  // ④ 応答が壊れていてもthrowせずlow扱いにする（fail-closed）
  {
    const r1 = summarizeJevAnswer(null);
    if (r1.tier !== 'low') fails.push('★null応答をlowにしない');
    const r2 = summarizeJevAnswer({});
    if (r2.tier !== 'low') fails.push('★空応答をlowにしない');
  }

  if (fails.length) {
    console.error('[screen-duplicate-clusters-with-jev] ★selftest 失敗:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log(
    '[screen-duplicate-clusters-with-jev] ✅ selftest 合格'
    + '（4件: 抜粋生成/リクエスト形式/confidence分類/fail-closed）',
  );
  process.exit(EXIT.PASS);
}

/**
 * ★Jev APIへ1クラスタ分のリクエストを送る（副作用あり、fetch本体）。
 * @param {object} body buildJevRequestBodyの戻り値
 * @param {string} apiKey
 * @returns {Promise<object>} レスポンスJSON
 */
async function callJev(body, apiKey) {
  const res = await fetch(TYPESAFE_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jev API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// ── 実行 ────────────────────────────────────────────────────────────────
const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain && process.argv.includes('--selftest')) runSelftest();

if (isMain) {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    console.error('[screen-duplicate-clusters-with-jev] 🟡 TYPESAFE_API_KEY が未設定です。');
    console.error('  → ~/.claude/CLAUDE.md「トークン・鍵の受け渡しはクリップボード経由」節を参照。');
    process.exit(EXIT.INCONCLUSIVE);
  }

  const argDir = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const root = resolve(argDir || process.cwd());

  let tracked;
  try {
    tracked = execFileSync(
      'git',
      ['ls-files', ...TARGET_EXTENSIONS.map((ext) => `*${ext}`)],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    ).split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (e) {
    console.error('[screen-duplicate-clusters-with-jev] 🟡 git ls-files を実行できませんでした。');
    console.error(`  → 理由: ${e && e.message}`);
    process.exit(EXIT.INCONCLUSIVE);
  }

  const scannable = tracked.filter((p) => !EXCLUDED.test(p));
  const files = [];
  const fileLinesMap = {};

  for (const p of scannable) {
    let src;
    try { src = readFileSync(join(root, p), 'utf8'); } catch { continue; }
    if (isGeneratedFile(src)) continue;
    fileLinesMap[p] = src.replace(/\r\n/g, '\n').split('\n');
    const normLines = extractNormalizedLines(src);
    const windows = buildWindows(normLines);
    if (windows.length > 0) files.push({ path: p, windows });
  }

  const result = judgeNearDuplicates(files, null);
  if (result.verdict === 'inconclusive') {
    console.error(`[screen-duplicate-clusters-with-jev] 🟡 測れませんでした: ${result.reason}`);
    process.exit(EXIT.INCONCLUSIVE);
  }

  if (result.clusters.length === 0) {
    console.log('[screen-duplicate-clusters-with-jev] クラスタが0件のため、スクリーニング対象がありません。');
    process.exit(EXIT.PASS);
  }

  console.log(`[screen-duplicate-clusters-with-jev] クラスタ ${result.clusters.length} 件をJevへ送信...`);

  const rows = [];
  for (const cluster of result.clusters) {
    const excerpts = buildClusterExcerpts(cluster, fileLinesMap);
    if (excerpts.length < 2) continue;
    const body = buildJevRequestBody(excerpts);
    try {
      const res = await callJev(body, apiKey);
      const { tier, summary } = summarizeJevAnswer(res.answers);
      rows.push({ cluster, tier, summary, usage: res.usage });
    } catch (e) {
      console.error(`  🟡 クラスタ (${cluster.files.join(' ≈ ')}) の送信に失敗: ${e && e.message}`);
    }
  }

  const tierIcon = { high: '🟢', medium: '🟡', low: null };
  const tierLabel = { high: '高confidence', medium: '中confidence' };
  let totalInputTokens = 0;
  let shown = 0;

  for (const row of rows.sort((a, b) => (b.tier === 'high') - (a.tier === 'high'))) {
    if (row.usage?.input_tokens) totalInputTokens += row.usage.input_tokens;
    if (row.tier === 'low') continue; // ★低confidenceは握りつぶす
    shown++;
    const note = row.tier === 'high' ? '（要確認・先に見る）' : '（確信度は低め）';
    console.log(
      `  ${tierIcon[row.tier]} [${tierLabel[row.tier]}] ${row.cluster.files.join(' ≈ ')} ${note}`,
    );
    console.log(`     ${row.summary}`);
  }

  if (shown === 0) {
    console.log('  （全クラスタが低confidenceのため、提示すべき候補はありません）');
  }

  console.log(
    `[screen-duplicate-clusters-with-jev] 完了（推定入力トークン合計: ${totalInputTokens}）。`
    + ' この結果はHEURISTICです。DECLARED判定はCANONICAL CHECK（13項目）を通してから行ってください。',
  );
  console.log('  → _docs/PILOT-LOG-jev-duplicate-screening.md に結果を記録してください。');

  process.exit(EXIT.PASS);
}

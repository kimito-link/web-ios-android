#!/usr/bin/env node
/**
 * check-instrument-ran.mjs — ★4つ目の状態「検査がそもそも走っていない」を見る。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るのか（実損の記録・これが設計の出発点）
 *   3値規約（0=合格 / 1=赤 / 2=測れなかった）には★4つ目の状態がある:
 *   ★**そもそも走っていない**。
 *
 *   実測（soushin-suggest.link・自リポの履歴）:
 *     ★8/8  実測値を1つ書き間違え、★8日間ラチェットが赤のまま
 *     ★8/17 コミット時に走らせ忘れ、★また赤のまま
 *     → ★どちらも「値が悪化した」ではなく★**検査が走っていなかった**
 *     → ★入口ゲートだったので、赤の間★プローブが1本も走っていなかった
 *
 *   ★「赤いまま放置できる検査」は、緑と同じくらい危険。
 *
 * ■ ★なぜ検査の内側では解けないか（設計の核心）
 *   ★走らなかった検査は**何も出力しない**。
 *   出力が無いことは、検査自身には観測できない（動いていないのだから）。
 *   → ★**外に記録を置き、常に前へ進むもの（＝コミット）と突き合わせる**しかない。
 *
 * ■ 仕組み（3つだけ）
 *   1. 検査が緑になったら `--stamp <名前>` で ★記録（コミットSHA＋時刻）を残す
 *   2. この検査が「記録のSHA」と「いまのHEAD」の★距離（コミット数）を見る
 *   3. 距離が閾値を超えていたら ★**走っていない**と鳴らす
 *
 * ■ ★fail ではなく inconclusive(2) で鳴らす
 *   「走っていない」は【測っていない】のであって【悪化した】のではない。
 *   ★ここを赤にすると "とりあえず stamp を打って黙らせる" 動機を作る
 *     ＝ 台帳を強制して嘘の数字を招いたのと同じ失敗（規約③と同型）。
 *
 * ■ ★この検査が判定しないこと（限界の明記）
 *   ・stamp が【本当に緑だったとき】に打たれたかは見ない
 *     → ★だから stamp は**検査が緑を返した経路からのみ**呼ぶこと。
 *       手で打てば当然だませる。★これは「うっかり」を捕まえる仕掛けであって、
 *       ★意図的な回避を防ぐものではない。
 *   ・検査の中身が正しいかは見ない（それは各検査の --selftest の仕事）
 *
 * ■ 使い方
 *   node scripts/check-instrument-ran.mjs --stamp improvement   ★緑のときに記録
 *   node scripts/check-instrument-ran.mjs --check               ★放置を検出
 *   node scripts/check-instrument-ran.mjs --check --max-commits 20
 *   node scripts/check-instrument-ran.mjs --check --max-days 14
 *   node scripts/check-instrument-ran.mjs --selftest            ★毒→赤を確認
 *
 * ■ ★配線の例（緑のときだけ記録が残る形にする）
 *   "check:improvement": "node scripts/check-improvement.mjs --check && node scripts/check-instrument-ran.mjs --stamp improvement"
 *   ★`&&` が要。赤なら stamp は打たれない＝放置すると距離が開いて鳴る。
 *
 * ■ ★2026-08-25追加: 「時間の経過」もOR条件で見る
 *   commit距離だけを見る設計は意図的（上記コメント参照: 時刻はCIスケジュール・
 *   タイムゾーンに左右されるが、commitは単調増加で信頼できる）。★この判断は変えない。
 *   ただし「commitはほとんど無いが、何週間も誰も触っていない」ケース
 *   （長期休暇・優先度低下等）は距離だけでは捕まらない。★distance と ★日数、
 *   ★どちらか一方でも閾値を超えたら「走っていない」と鳴らす（OR条件）。
 *   日数は stamp 時に記録済みの `at`（ISO8601）を使う。時刻そのものの信頼性への
 *   懸念（上記）は、★distanceとのOR併用によって「日数だけで判定を決めない」ことで
 *   吸収する（距離が近ければ、多少の時刻のブレがあっても誤って鳴らない）。
 *
 * ■ 終了コード（3値規約）
 *   0 = 走っている / 1 = 記録が壊れている / ★2 = ★走っていない（緑ではない）
 * ───────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * ★リポジトリのrootを探す（1つ上固定にしない）。
 *
 * ★2026-08-25発見の実損: このファイルは通常「アプリ側リポの scripts/」に
 *   コピーされる前提で「1つ上=root」と決め打っていた。ところが★このキット
 *   自身のルートから直接実行すると、実体は templates/scripts/ にあるため
 *   1つ上は templates/ になり、STAMP_FILE が templates/.instrument-ran.json という
 *   ★別ファイルに書かれる。stampコマンドは「✅ 記録しました」と出力する一方、
 *   リポ直下の .instrument-ran.json は一切更新されない★沈黙の書き込み先ズレだった
 *   （このスクリプト自身が「走っていない」を検出する仕組みなのに、
 *   自分の記録先を取り違えると本末転倒）。
 * ★.git の有無で探す(package.jsonは「消費アプリのroot」にも「このキット自身のroot」
 *   にも両方存在し区別できないため、リポジトリの境界として信頼できる.gitを使う)。
 * @returns {string}
 */
function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break; // ★ドライブ直下まで来た(それ以上は上がれない)
    dir = parent;
  }
  // ★.git が見つからなくても「1つ上」というこれまでの既定へfallback(挙動を壊さない)。
  return resolve(startDir, '..');
}

const ROOT = findRepoRoot(HERE);
const STAMP_FILE = join(ROOT, '.instrument-ran.json');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
function opt(name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

/** ★何コミット離れたら「走っていない」とみなすか。 */
const DEFAULT_MAX_COMMITS = 10;
/** ★何日経ったら「走っていない」とみなすか（★未指定=null=日数では判定しない。既存動作を壊さない）。 */
const DEFAULT_MAX_DAYS = null;

/**
 * git を呼ぶ。★失敗は null（0やfalseにしない）。
 * ★stderr は捨てる: 存在しないSHAの確認など「失敗が正常な問い合わせ」があり、
 *   git の fatal: がそのまま出ると★読み手が本物の異常と誤読する。
 */
function git(args, cwd = ROOT) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8', cwd, timeout: 15000, stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
}

function readStamps(file = STAMP_FILE) {
  if (!existsSync(file)) return {};
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch {
    return null; // ★壊れている（空と区別する）
  }
}

/**
 * ★記録と HEAD の距離を測る。
 * @returns {{distance:number|null, reason?:string}} ★測れなければ null（0にしない）
 */
function distanceFrom(sha, cwd = ROOT) {
  if (!sha) return { distance: null, reason: '記録にコミットSHAがありません' };
  const exists = git(['cat-file', '-e', sha + '^{commit}'], cwd);
  if (exists === null) return { distance: null, reason: `記録のコミット ${sha.slice(0, 8)} がこのリポに見つかりません` };
  const out = git(['rev-list', '--count', sha + '..HEAD'], cwd);
  if (out === null) return { distance: null, reason: 'HEAD からの距離を数えられませんでした' };
  const n = Number(out);
  return Number.isFinite(n) ? { distance: n } : { distance: null, reason: '距離が数値になりません' };
}

/**
 * ★記録された `at`（ISO8601）から経過日数を測る。
 * ★Date.now() を直接使わず nowMs を引数化＝selftestが「今日の日付」に依存しない
 *   （実行するたびに結果が変わる毒は、掟「状態に依存しない毒にする」に反する）。
 * @returns {number|null} ★測れなければ null（0にしない）
 */
function daysSince(iso, nowMs) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((nowMs - t) / (1000 * 60 * 60 * 24));
}

/** ★判定の本体（selftest から直接呼べるよう純関数に寄せる）。 */
function judge({ stamps, name, maxCommits, maxDays = null, nowMs = Date.now(), cwd = ROOT }) {
  if (stamps === null) {
    return {
      probe: '検査の実行', verdict: 'fail', evidence: null,
      detail: '記録ファイルが壊れています（JSONとして読めません）',
      howToFix: `.instrument-ran.json を消して、検査を1回緑で通す`
    };
  }
  const rec = stamps[name];
  if (!rec) {
    return {
      probe: '検査の実行', verdict: 'inconclusive', evidence: null,
      detail: `「${name}」が一度も走った記録がありません（★走っていないだけかもしれません）`,
      howToFix: `検査を緑で通す（配線: "... --check && node scripts/check-instrument-ran.mjs --stamp ${name}"）`,
      limitation: '★記録の有無だけを見ます。検査の中身が正しいかは見ません'
    };
  }
  const { distance, reason } = distanceFrom(rec.commit, cwd);
  if (distance === null) {
    return {
      probe: '検査の実行', verdict: 'inconclusive', evidence: null,
      detail: `「${name}」の記録を突き合わせられません: ${reason}`,
      howToFix: '検査を1回緑で通して記録を作り直す',
      limitation: '★git のあるリポでのみ測れます'
    };
  }
  const days = daysSince(rec.at, nowMs);
  const commitStale = distance > maxCommits;
  // ★maxDaysが未指定(null)なら日数では判定しない＝呼び出し元が明示しない限り既存動作のまま。
  const dayStale = maxDays != null && days !== null && days > maxDays;

  if (commitStale || dayStale) {
    const reasons = [];
    if (commitStale) reasons.push(`${distance}コミット(閾値${maxCommits})`);
    if (dayStale) reasons.push(`${days}日(閾値${maxDays}日)`);
    return {
      probe: '検査の実行', verdict: 'inconclusive',
      evidence: {
        検査: name, 最後に緑: rec.commit.slice(0, 8),
        経過コミット: distance, コミット閾値: maxCommits,
        経過日数: days, 日数閾値: maxDays
      },
      detail: `★「${name}」が${reasons.join(' / ')}のあいだ緑になっていません（★悪化ではなく【走っていない】疑い）`,
      howToFix: `検査を走らせる。赤で止まっているなら★それを直す（★放置された赤は緑と同じくらい危険）`,
      limitation: '★手で stamp を打てばだませます。うっかりを捕まえる仕掛けであって、意図的な回避は防ぎません'
    };
  }
  return {
    probe: '検査の実行', verdict: 'pass',
    evidence: {
      検査: name, 最後に緑: rec.commit.slice(0, 8),
      経過コミット: distance, コミット閾値: maxCommits,
      経過日数: days, 日数閾値: maxDays
    },
    limitation: '★走ったことだけを見ます。検査の中身が正しいかは見ません'
  };
}

/* ── --selftest ─────────────────────────────────────────────── */
if (has('--selftest')) {
  const { ok, fails } = runSelfTest([
    {
      name: '★記録が無いのを緑にしない',
      poison: () => {}, restore: () => {},
      isRed: () => judge({ stamps: {}, name: 'nope', maxCommits: 10 }).verdict === 'inconclusive'
    },
    {
      name: '★壊れた記録を緑にしない',
      poison: () => {}, restore: () => {},
      isRed: () => judge({ stamps: null, name: 'x', maxCommits: 10 }).verdict === 'fail'
    },
    {
      name: '★存在しないコミットを緑にしない',
      poison: () => {}, restore: () => {},
      isRed: () => judge({
        stamps: { x: { commit: '0'.repeat(40) } }, name: 'x', maxCommits: 10
      }).verdict === 'inconclusive'
    },
    {
      name: '★距離が閾値を超えたら鳴る',
      poison: () => {}, restore: () => {},
      isRed: () => {
        // ★実リポの古いコミットを使う（合成しない＝状態に依存しない毒）
        const old = git(['rev-list', '--max-count=1', '--skip=30', 'HEAD']);
        if (!old) return true; // ★履歴が浅いリポでは判定不能→毒として成立させない
        return judge({ stamps: { x: { commit: old } }, name: 'x', maxCommits: 1 }).verdict === 'inconclusive';
      }
    },
    {
      name: '★直近で走っていれば緑になる（誤検知しない）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const head = git(['rev-parse', 'HEAD']);
        if (!head) return true;
        return judge({ stamps: { x: { commit: head } }, name: 'x', maxCommits: 10 }).verdict === 'pass';
      }
    },
    {
      // ★2026-08-25追加: 日数がOR条件で効くか。
      //   commit距離は0（誤検知の余地なし）でも、記録時刻が古ければ鳴ること。
      //   nowMsを固定して渡す＝実行日に依存しない毒（状態に依存しない毒にする、の掟）。
      name: '★commit距離は近くても日数超過なら鳴る（OR条件）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const head = git(['rev-parse', 'HEAD']);
        if (!head) return true;
        const fixedNow = Date.parse('2026-08-25T00:00:00Z');
        const oldAt = '2026-08-01T00:00:00Z'; // 24日前
        return judge({
          stamps: { x: { commit: head, at: oldAt } }, name: 'x',
          maxCommits: 999, maxDays: 14, nowMs: fixedNow
        }).verdict === 'inconclusive';
      }
    },
    {
      name: '★日数が閾値内なら誤検知しない（--max-daysを渡しても）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const head = git(['rev-parse', 'HEAD']);
        if (!head) return true;
        const fixedNow = Date.parse('2026-08-25T00:00:00Z');
        const recentAt = '2026-08-20T00:00:00Z'; // 5日前
        return judge({
          stamps: { x: { commit: head, at: recentAt } }, name: 'x',
          maxCommits: 999, maxDays: 14, nowMs: fixedNow
        }).verdict === 'pass';
      }
    },
    {
      name: '★--max-days未指定(null)なら日数がどれだけ古くても日数では鳴らない（既存動作を壊さない）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const head = git(['rev-parse', 'HEAD']);
        if (!head) return true;
        const fixedNow = Date.parse('2026-08-25T00:00:00Z');
        const veryOldAt = '2020-01-01T00:00:00Z';
        return judge({
          stamps: { x: { commit: head, at: veryOldAt } }, name: 'x',
          maxCommits: 999, maxDays: null, nowMs: fixedNow
        }).verdict === 'pass';
      }
    }
  ]);
  if (!ok) {
    console.error('[check-instrument-ran] ★selftest 失敗(検知器が効いていません):');
    for (const f of fails) console.error('  - ' + f);
    process.exit(EXIT.FAIL);
  }
  console.log('[check-instrument-ran] selftest OK(記録なし/壊れ/迷子SHA を緑にしない / ★放置で鳴る / ★直近は誤検知しない / ★日数もOR条件で鳴る・未指定なら影響しない)');
  process.exit(EXIT.PASS);
}

/* ── --stamp: ★緑のときだけ呼ばれる想定 ──────────────────────── */
const stampName = opt('--stamp');
if (stampName) {
  const head = git(['rev-parse', 'HEAD']);
  if (!head) {
    // ★git が無い環境では記録しない（嘘の記録を作らない）
    console.log('[check-instrument-ran] 🟡 git が使えないため記録しません（★測れませんでした）');
    process.exit(EXIT.INCONCLUSIVE);
  }
  const cur = readStamps() || {};
  cur[stampName] = { commit: head, at: new Date().toISOString() };
  mkdirSync(dirname(STAMP_FILE), { recursive: true });
  writeFileSync(STAMP_FILE, JSON.stringify(cur, null, 2) + '\n');
  console.log(`[check-instrument-ran] ✅ 記録: ${stampName} @ ${head.slice(0, 8)}`);
  process.exit(EXIT.PASS);
}

/* ── --check ────────────────────────────────────────────────── */
const maxCommits = Number(opt('--max-commits') || DEFAULT_MAX_COMMITS);
const maxDaysOpt = opt('--max-days');
const maxDays = maxDaysOpt != null ? Number(maxDaysOpt) : DEFAULT_MAX_DAYS;
const stamps = readStamps();
const names = has('--name')
  ? [opt('--name')]
  : (stamps && Object.keys(stamps).length ? Object.keys(stamps) : ['improvement']);

const results = names.map((n) => judge({
  stamps, name: n,
  maxCommits: Number.isFinite(maxCommits) ? maxCommits : DEFAULT_MAX_COMMITS,
  maxDays: (maxDays != null && Number.isFinite(maxDays)) ? maxDays : null
}));
console.log(formatProbeReport(results, { label: 'check-instrument-ran' }));
process.exit(computeExitCode(results));

#!/usr/bin/env node
/**
 * record-improvement.mjs — ★実測値を台帳に書き足す【1本の口】。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ「口」を1本に決めるのか（これが50年の肝）
 *   仕組みは3層に割れる:
 *     ① 規約(不変)    … 3値exit / 過去最良比較 / 方向は宣言する
 *     ② 判定(純関数)  … lib/improvement-ledger.mjs（★依存ゼロ・移植はコピー1回）
 *     ③ 収集(使い捨て)… ★誰が値を書くか ← **ここだけ腐る前提**で作る
 *
 *   ★呼び手（フック / スキル / CI / 50年後の別の何か）は必ず変わる。
 *   ★変わってよいように、**契約はこのコマンド1本**に閉じる。
 *   呼び手が死んでも口が残っていれば、次の道具を繋ぐだけで済む。
 *
 * ■ ★フックに置かない（実測にもとづく却下）
 *   ★フックで生成物を書くと、その追記は**いま送ろうとしている変更に入らない**＝順序事故。
 *   （tsuioku は同じ型を既に踏んでいる。生成物の再生成は git add の【後】では永久にズレる。）
 *
 * ■ ★自動で書けるのは「リポの中だけで完結する」指標に限る
 *   ✅ ビルド成果物のサイズ / 検査の本数 / 依存の数 … 毎回同じ条件で測れる
 *   ★実機の部品数・起動所要・通信の速さ            … 版ごとに条件が違う
 *   ★条件の違う数字を過去最良比較に載せると、★比べてはいけないものを比べることになる。
 *   → 実機依存の指標は **--metric で手で書く**（source 必須）。
 *
 * ■ ★自動測定は【アプリの表】が決める（キットは測り方を持たない）
 *   improvement-metrics.mjs の各指標に `auto` を書くと、この口が測る:
 *     auto: { kind: 'file-size-kb', path: 'dist/bundle.js' }
 *     auto: { kind: 'file-count',   glob: 'scripts/*.mjs' }
 *     auto: { kind: 'command-number', cmd: ['node','scripts/x.mjs','--count'] }
 *   ★測れなければ **null**（0として書かない）。
 *
 * ■ 使い方
 *   node scripts/record-improvement.mjs --auto             ★自動で測れる指標を記録
 *   node scripts/record-improvement.mjs --auto --dry-run   書かずに見るだけ
 *   node scripts/record-improvement.mjs --metric bundle-kb --value 1360 --source "..."
 *   node scripts/record-improvement.mjs --selftest         ★毒→赤を確認
 *
 * ■ 終了コード（3値規約）
 *   0 = 書いた / 1 = ★書けなかった(不正な入力など) / ★2 = 測れなかった
 * ───────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, writeFileSync, statSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { EXIT, runSelfTest } from './lib/instrument-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const HISTORY = join(ROOT, 'scripts/improvement-history.mjs');
const METRICS = join(ROOT, 'scripts/improvement-metrics.mjs');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
function opt(name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

/** 現在の版（package.json が正本）。無ければ null（★勝手に版を作らない）。 */
function currentVersion() {
  const p = join(ROOT, 'package.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')).version || null;
}

/**
 * ★宣言された `auto` の指示どおりに測る。★測れなければ null（0を返さない）。
 * @param {{kind?:string, path?:string, glob?:string, cmd?:string[]}} spec
 * @returns {number|null}
 */
function measureAuto(spec) {
  if (!spec || typeof spec !== 'object') return null;
  try {
    if (spec.kind === 'file-size-kb') {
      const p = join(ROOT, String(spec.path || ''));
      if (!existsSync(p)) return null; // ★測れなかった（0ではない）
      return Math.round(statSync(p).size / 1024);
    }
    if (spec.kind === 'file-count') {
      const g = String(spec.glob || '');
      const dir = join(ROOT, dirname(g));
      if (!existsSync(dir)) return null;
      const pat = g.split('/').pop() || '';
      const re = new RegExp('^' + pat.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
      const n = readdirSync(dir).filter((f) => re.test(f)).length;
      return n === 0 ? null : n; // ★0件は「測れなかった」と区別が付かない
    }
    if (spec.kind === 'command-number') {
      if (!Array.isArray(spec.cmd) || spec.cmd.length === 0) return null;
      const [bin, ...rest] = spec.cmd;
      const exe = bin === 'node' ? process.execPath : bin;
      const out = execFileSync(exe, rest, { encoding: 'utf8', timeout: 60000, cwd: ROOT });
      const m = String(out).trim().match(/-?\d+(\.\d+)?/);
      if (!m) return null;
      const v = Number(m[0]);
      return Number.isFinite(v) ? v : null;
    }
  } catch {
    return null; // ★失敗は「測れなかった」。0にしない
  }
  return null;
}

/** 台帳に既にその (version, metric) があるか。 */
function alreadyRecorded(text, version, metric) {
  const re = new RegExp(
    "version:\\s*'" + String(version).replace(/\./g, '\\.') + "',\\s*metric:\\s*'" + metric + "'"
  );
  return re.test(text);
}

/** ★台帳の末尾 `]);` の直前に1件足す。 */
function appendRecord(text, rec) {
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const noteLine = rec.note ? ",\n    note: '" + esc(rec.note) + "'" : '';
  const block =
    '  Object.freeze({\n'
    + "    version: '" + esc(rec.version) + "', metric: '" + esc(rec.metric) + "', value: " + rec.value + ',\n'
    + "    source: '" + esc(rec.source) + "'" + noteLine + '\n'
    + '  })';
  const idx = text.lastIndexOf(']);');
  if (idx < 0) return null; // ★形が違う＝書かない（壊さない）
  const head = text.slice(0, idx).replace(/\s*$/, '');
  const sep = /Object\.freeze\(\{/.test(head) ? ',\n' : '\n';
  return head + sep + block + '\n]);\n';
}

/** 1件を検証して書く。★戻り値は3値＋skip。 */
function record(rec, { dryRun = false, file = HISTORY, metrics = [] } = {}) {
  const spec = metrics.find((m) => m && m.id === rec.metric);
  if (!spec) {
    return {
      verdict: 'fail',
      detail: '宣言に無い指標: ' + rec.metric,
      howToFix: 'improvement-metrics.mjs に、その指標と【どちらが良いか(better)】を先に宣言する'
    };
  }
  // ★測れなかった値を 0 として書かない（Number(null)===0 の穴）
  if (typeof rec.value !== 'number' || !Number.isFinite(rec.value)) {
    return {
      verdict: 'inconclusive',
      detail: rec.metric + ' を測れませんでした',
      howToFix: '測定できる状態にしてから再実行する（★0として記録してはいけません）'
    };
  }
  if (!rec.source) {
    return {
      verdict: 'fail',
      detail: rec.metric + ' に source がありません',
      howToFix: '★どこで測ったかを書く。後から検算できない数字は台帳に載せない'
    };
  }
  if (!existsSync(file)) {
    return { verdict: 'inconclusive', detail: '台帳がありません: ' + file, howToFix: 'キットの improvement-history.mjs をコピーする' };
  }
  const text = readFileSync(file, 'utf8');
  if (alreadyRecorded(text, rec.version, rec.metric)) {
    return { verdict: 'skip', detail: rec.version + ' の ' + rec.metric + ' は記録済み' };
  }
  const next = appendRecord(text, rec);
  if (next === null) {
    return {
      verdict: 'fail',
      detail: '台帳の形が想定と違います',
      howToFix: 'improvement-history.mjs の末尾が `]);` で終わっているか確認する'
    };
  }
  if (!dryRun) writeFileSync(file, next);
  return { verdict: 'wrote', detail: rec.version + ' の ' + spec.label + ' = ' + rec.value + spec.unit };
}

/* ── --selftest: ★毒を食わせ、赤が出ることを確認する ─────────────── */
if (has('--selftest')) {
  const tmp = join(HERE, '.record-selftest.tmp.mjs');
  const seed = 'export const IMPROVEMENT_HISTORY = Object.freeze([\n]);\n';
  const T = [{ id: 'sf-x', label: 'テスト指標', better: 'lower', unit: 'ms' }];
  const cleanup = () => { try { rmSync(tmp, { force: true }); } catch { /* best-effort */ } };

  const { ok, fails } = runSelfTest([
    {
      name: '宣言に無い指標を拒む',
      poison: () => writeFileSync(tmp, seed),
      restore: cleanup,
      isRed: () => record({ version: '9.9.9', metric: '★存在しない指標', value: 1, source: 's' },
        { dryRun: true, file: tmp, metrics: T }).verdict === 'fail'
    },
    {
      name: '★測れなかった値を0として書かない',
      poison: () => writeFileSync(tmp, seed),
      restore: cleanup,
      isRed: () => record({ version: '9.9.9', metric: 'sf-x', value: null, source: 's' },
        { dryRun: true, file: tmp, metrics: T }).verdict === 'inconclusive'
    },
    {
      name: '★source の無い数字を拒む',
      poison: () => writeFileSync(tmp, seed),
      restore: cleanup,
      isRed: () => record({ version: '9.9.9', metric: 'sf-x', value: 1, source: '' },
        { dryRun: true, file: tmp, metrics: T }).verdict === 'fail'
    },
    {
      name: '★台帳の形が違えば書かない(壊さない)',
      poison: () => writeFileSync(tmp, 'export const IMPROVEMENT_HISTORY = [];\n'),
      restore: cleanup,
      isRed: () => record({ version: '9.9.9', metric: 'sf-x', value: 1, source: 's' },
        { dryRun: true, file: tmp, metrics: T }).verdict === 'fail'
    },
    {
      name: '★測れなかった自動測定が null を返す(0にしない)',
      poison: () => {}, restore: () => {},
      isRed: () => measureAuto({ kind: 'file-size-kb', path: '★存在しないファイル.js' }) === null
        && measureAuto({ kind: 'file-count', glob: '★無いディレクトリ/*.mjs' }) === null
    }
  ]);

  if (!ok) {
    console.error('[record-improvement] ★selftest 失敗(検知器が効いていません):');
    for (const f of fails) console.error('  - ' + f);
    process.exit(EXIT.FAIL);
  }
  console.log('[record-improvement] selftest OK(未宣言を拒む / ★0を書かない / source必須 / 壊さない)');
  process.exit(EXIT.PASS);
}

/* ── 本番: 指標テーブルを読む ────────────────────────────────── */
if (!existsSync(METRICS) || !existsSync(HISTORY)) {
  console.log('[record-improvement] 🟡 台帳がありません（★測れませんでした）');
  console.log('  → 直し方: キットの improvement-metrics.mjs / improvement-history.mjs をコピーする');
  process.exit(EXIT.INCONCLUSIVE);
}
const metricsMod = await import('file://' + METRICS.split('\\').join('/'));
const metrics = Array.isArray(metricsMod.IMPROVEMENT_METRICS) ? metricsMod.IMPROVEMENT_METRICS : [];

const version = currentVersion();
if (!version) {
  console.log('[record-improvement] 🟡 版が分かりません（package.json に version がない）');
  process.exit(EXIT.INCONCLUSIVE);
}

const dryRun = has('--dry-run');
const results = [];

if (has('--auto')) {
  const autos = metrics.filter((m) => m && m.auto);
  if (autos.length === 0) {
    console.log('[record-improvement] 🟡 自動で測れる指標が宣言されていません（★測れませんでした）');
    console.log('  → 直し方: improvement-metrics.mjs の指標に auto: { kind: ... } を足す');
    console.log('  → ★実機に依存する指標は自動にしない。--metric で手で書く');
    process.exit(EXIT.INCONCLUSIVE);
  }
  for (const m of autos) {
    const value = measureAuto(m.auto);
    // ★[auto] を前置する。手書きと見分けの付かない印は印ではない（tsuioku の実損）。
    const source = '[auto] ' + (m.auto.path || m.auto.glob || (m.auto.cmd || []).join(' ') || m.id);
    results.push({ metric: m.id, ...record({ version, metric: m.id, value, source }, { dryRun, metrics }) });
  }
} else {
  const metric = opt('--metric');
  const valueRaw = opt('--value');
  const source = opt('--source');
  if (!metric || valueRaw === null) {
    console.error('[record-improvement] 使い方: --metric <id> --value <数> --source "どこで測ったか"');
    console.error('                      または --auto / --selftest');
    process.exit(EXIT.FAIL);
  }
  const value = Number(valueRaw);
  results.push({
    metric,
    ...record(
      { version, metric, value: Number.isFinite(value) ? value : null, source: source || '', note: opt('--note') || '' },
      { dryRun, metrics }
    )
  });
}

let exit = EXIT.PASS;
for (const r of results) {
  const mark = r.verdict === 'wrote' ? '✅' : r.verdict === 'skip' ? '・' : r.verdict === 'fail' ? '🔴' : '🟡';
  console.log(`[record-improvement] ${mark} ${r.detail}${dryRun && r.verdict === 'wrote' ? '（--dry-run: 書いていません）' : ''}`);
  if (r.howToFix) console.log('   → 直し方: ' + r.howToFix);
  if (r.verdict === 'fail') exit = EXIT.FAIL;
  else if (r.verdict === 'inconclusive' && exit === EXIT.PASS) exit = EXIT.INCONCLUSIVE;
}
process.exit(exit);

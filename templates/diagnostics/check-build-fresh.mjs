#!/usr/bin/env node
/**
 * check-build-fresh.mjs — ★配る実体が、ソースより古くないことを見る。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか(2026-09-01・実損。soushin-suggest.link で同じ日に2回)
 *
 *   常駐ツールがキーボードを奪う不具合が出た。直した。
 *   ★ところが【コードは直っていた】のに再発した。実体はこうだった:
 *
 *       dist/soushin-suggest.ahk  15:22  ← 修正済み
 *       dist/soushin-suggest.exe  14:59  ← ★古い。修正が入っていない
 *
 *   ★ビルドが無言で失敗していた。製品が常駐したまま exe を掴んでいたため
 *   出力を書けず、こう出して終わっていた:
 *
 *       '...dist\soushin-suggest.exe' にアクセスできません
 *
 *   ★エラーで止まらないので、古い成果物がそのまま残る。
 *   「ビルドした」と思ったまま【修正前の実体】を配る/起動することになる。
 *
 * ■ ★これは AutoHotkey 固有の話ではない
 *
 *   同じ形は、成果物を作るどのプロジェクトでも起きる:
 *     ・ファイルがロックされていて上書きできなかった
 *     ・ビルドが途中で落ちたが終了コードを見ていなかった
 *     ・別ディレクトリへ出力していて、配る場所は古いままだった
 *
 *   ★共通するのは【ソース側の検査は全部緑なのに、配る実体だけが古い】こと。
 *   ソースを守る検査をいくら足しても、この区間は塞がらない。
 *
 * ■ 何を赤にするか
 *
 *   成果物(dist/ build/ out/ 等)の中の実体が、
 *   ★対応するソースより【古い】とき。
 *
 * ■ ★なぜ中身(ハッシュ)で突き合わせないのか
 *
 *   成果物は圧縮・最適化・バンドルを経るため、★中身から元のソースを
 *   復元できないことが多い(exe への埋め込み、minify、tree-shaking)。
 *   「この成果物はどのソースから作られたか」を後から突き合わせる術がない。
 *   ⟹ ★時刻の前後関係が、汎用に読める唯一の手がかりになる。
 *
 *   ★だから「古くない」しか言えない。同じ時刻でも中身が違う可能性は残る。
 *   ★【明らかに古い】だけを止める。それでも 2026-09-01 の2回目は止まる。
 *
 * ■ ★この検査が判定しないこと
 *
 *   ・成果物の中身が正しいか   … 復元できないので原理的に無理
 *   ・配布物(zip 等)が最新か   … 配布の検査は別
 *   ・ビルドが成功したか       … 成功しても古い場所へ出していれば同じこと
 *
 * ■ 3値の終了コード
 *   0 = 合格 / 1 = ★古い(ビルドが要る) / 2 = ★測れなかった
 *
 * 使い方:
 *   node check-build-fresh.mjs [対象ディレクトリ]
 *   node check-build-fresh.mjs --selftest
 */

import { existsSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ★ソースが置かれる場所。ここの最新時刻を「作られた元」の基準にする。
const SRC_DIRS = ['src', 'lib', 'app', 'source'];

// ★配る実体が置かれる場所。
const OUT_DIRS = ['dist', 'build', 'out'];

// ★成果物とみなす拡張子。設定ファイルやログを拾わないよう絞る。
const ARTIFACT_EXT = ['.exe', '.app', '.apk', '.aab', '.ipa', '.dll', '.so', '.dylib', '.wasm'];

// ★読まないディレクトリ。ここを見ると【出荷しないファイル】で誤判定する
//   (2026-09-01 に check-hotkey-scope で実際に偽陽性6件を出した)。
const SKIP_DIRS = new Set([
  'node_modules', '.git',
  'tmp', 'temp', '.tmp',
  'dist-demo', 'demo',
  'backup', 'archive', '_old',
  'coverage', 'vendor',
]);

// ★版番号入りのファイル名は【過去版のコピー】。配る実体ではない。
const OLD_VERSION_FILE = /-v\d+\.\d+/;

/**
 * ★判定の本体。I/O から切り離す(selftest が実ファイルなしで校正できるように)。
 *   引数は時刻(ミリ秒)だけ。null は「測れなかった」を表す。
 *
 * ★null を 0 へ丸めないこと。丸めると「測れなかった」が
 *   「1970年＝とても古い」に化けて、測定不能が赤に混ざる。
 */
export function judgeFreshness({ artifactTime, artifactName, sourceTime, sourceName }) {
  if (artifactTime === null || artifactTime === undefined) {
    return { verdict: 'unmeasurable', reason: '成果物が見つからない(まだビルドしていない)' };
  }
  if (sourceTime === null || sourceTime === undefined) {
    return { verdict: 'unmeasurable', reason: 'ソースが見つからない(比べる相手がいない)' };
  }
  if (artifactTime < sourceTime) {
    return {
      verdict: 'stale',
      reason: `${artifactName} がソースより古い`,
      artifactName, sourceName,
      artifactTime, sourceTime,
    };
  }
  return { verdict: 'ok', reason: `${artifactName} はソースより新しい`, artifactName };
}

/** ディレクトリを歩いて、条件に合う最新ファイルの {time, name} を返す。無ければ null。 */
function newestFile(dir, accept) {
  if (!existsSync(dir)) return null;
  let best = null;
  const walk = (d) => {
    let ents = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(join(d, e.name));
        continue;
      }
      if (OLD_VERSION_FILE.test(e.name)) continue;   // ★過去版のコピーは対象外
      if (!accept(e.name)) continue;
      let st;
      try { st = statSync(join(d, e.name)); } catch { continue; }
      const t = st.mtimeMs;
      if (best === null || t > best.time) best = { time: t, name: e.name };
    }
  };
  walk(dir);
  return best;
}

export function scanProject(root) {
  if (!root || !existsSync(root)) {
    return { ok: false, skip: false, reason: `対象が見つからない: ${root}` };
  }

  const artifact = OUT_DIRS
    .map((d) => newestFile(join(root, d), (n) => ARTIFACT_EXT.some((x) => n.endsWith(x))))
    .filter(Boolean)
    .sort((a, b) => b.time - a.time)[0] || null;

  if (!artifact) {
    // ★成果物を作らないプロジェクトには当たらない。強制しない(このキットの掟)。
    return { ok: false, skip: true, reason: '配る実体(exe/app/apk 等)が無い' };
  }

  // ★中間生成物も「ソース」として数える(2026-09-01・実測でこれが無いと毒を見逃した)。
  //
  // 【何を見落としたか】src/ とだけ比べる版を作ったが、実損を再現した毒
  //   (exe を 23分前へ)を【緑のまま通した】。実データはこうだった:
  //     src/030-input.ahk        15:22   ← これとだけ比べていた
  //     dist/soushin-suggest.ahk 16:11   ← ★中間生成物。ここが最新だった
  //     dist/soushin-suggest.exe 15:48   ← 毒。src より新しいので緑に見えた
  //
  // ★多段ビルド(src → 中間 → 実体)では、実体の直前の入力と比べないと
  //   「古い」を検出できない。src だけでは足りない。
  const INTERMEDIATE_EXT = ['.ahk', '.js', '.mjs', '.css', '.html', '.json', '.wasm'];
  const intermediate = OUT_DIRS
    .map((d) => newestFile(join(root, d), (n) =>
      INTERMEDIATE_EXT.some((x) => n.endsWith(x)) && !ARTIFACT_EXT.some((x) => n.endsWith(x))))
    .filter(Boolean)
    .sort((a, b) => b.time - a.time)[0] || null;

  const source = [
    ...SRC_DIRS.map((d) => newestFile(join(root, d), () => true)),
    intermediate,
  ].filter(Boolean).sort((a, b) => b.time - a.time)[0] || null;

  if (!source) {
    return { ok: false, skip: true, reason: 'ソースディレクトリ(src/lib/app)が無い' };
  }

  const r = judgeFreshness({
    artifactTime: artifact.time, artifactName: artifact.name,
    sourceTime: source.time, sourceName: source.name,
  });
  return { ok: true, skip: false, result: r };
}

const fmt = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

function runSelftest() {
  const fails = [];
  const T0 = 1000000, T1 = 2000000, T2 = 3000000;

  // (1) ★正の対照: 成果物が新しければ緑
  {
    const r = judgeFreshness({ artifactTime: T2, artifactName: 'a.exe', sourceTime: T1, sourceName: 's.ts' });
    if (r.verdict !== 'ok') fails.push('★新しい成果物を緑にできない: ' + r.reason);
  }

  // (2) ★実損の再現(2026-09-01 の2回目): 成果物だけ古い
  {
    const r = judgeFreshness({ artifactTime: T0, artifactName: 'a.exe', sourceTime: T1, sourceName: 's.ts' });
    if (r.verdict !== 'stale') fails.push('★古い成果物を赤にできない(実損が素通りする)');
  }

  // (3) ★同時刻は赤にしない(ビルド直後は同じになりうる。誤爆すると人が検査を切る)
  {
    const r = judgeFreshness({ artifactTime: T1, artifactName: 'a.exe', sourceTime: T1, sourceName: 's.ts' });
    if (r.verdict !== 'ok') fails.push('★同時刻を誤って赤にしている(ビルド直後に誤爆する)');
  }

  // (4) ★測れないを緑にしない(成果物が無い)
  {
    const r = judgeFreshness({ artifactTime: null, artifactName: '', sourceTime: T1, sourceName: 's.ts' });
    if (r.verdict !== 'unmeasurable') fails.push('★成果物の不在を測定不能にできない');
  }

  // (5) ★負の対照: ソースが無い場合も測定不能(緑にしない)
  {
    const r = judgeFreshness({ artifactTime: T1, artifactName: 'a.exe', sourceTime: null, sourceName: '' });
    if (r.verdict !== 'unmeasurable') fails.push('★ソースの不在を測定不能にできない');
  }

  // (6) ★null を 0 へ丸めていないこと。丸めると測定不能が赤に化ける。
  {
    const r = judgeFreshness({ artifactTime: null, artifactName: '', sourceTime: 0, sourceName: 's.ts' });
    if (r.verdict !== 'unmeasurable') fails.push('★null を 0 と混同している(測定不能が赤に化ける)');
  }

  // ───────────────────────────────────────────────────────────────────
  // ★(7)(8) は実ディレクトリで対にして測る。片側だけだと
  //   「何も見ない検査」が緑で通る。
  // ───────────────────────────────────────────────────────────────────

  // (7) ★正の対照: dist の exe が src より古ければ、実ツリーでも赤にできる
  {
    const dir = mkdtempSync(join(tmpdir(), 'nl-bf-stale-'));
    mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'src', 'a.ts'), 'x');
    writeFileSync(join(dir, 'dist', 'app.exe'), 'x');
    // ★exe を1時間前にする(今日の実損の形)
    const past = Date.now() / 1000 - 3600;
    utimesSync(join(dir, 'dist', 'app.exe'), past, past);
    const r = scanProject(dir);
    if (!(r.ok === true && r.result.verdict === 'stale')) {
      fails.push('★実ツリーで古い成果物を赤にできない: ' + JSON.stringify(r));
    }
  }

  // (8) ★負の対照: 同じツリーで exe を新しくすれば緑(＝常に赤ではない)
  {
    const dir = mkdtempSync(join(tmpdir(), 'nl-bf-fresh-'));
    mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'src', 'a.ts'), 'x');
    const past = Date.now() / 1000 - 3600;
    utimesSync(join(dir, 'src', 'a.ts'), past, past);
    writeFileSync(join(dir, 'dist', 'app.exe'), 'x');
    const r = scanProject(dir);
    if (!(r.ok === true && r.result.verdict === 'ok')) {
      fails.push('★新しい成果物まで赤にしている(常に赤＝使い物にならない): ' + JSON.stringify(r));
    }
  }

  // (9) ★成果物を作らないプロジェクトは skip(対象外。合格ではない)
  {
    const dir = mkdtempSync(join(tmpdir(), 'nl-bf-noart-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), 'x');
    const r = scanProject(dir);
    if (!(r.ok === false && r.skip === true)) {
      fails.push('★成果物なしを skip 扱いにできていない: ' + JSON.stringify(r));
    }
  }

  // (10) ★出荷しない場所(tmp/)の成果物は読まない
  {
    const dir = mkdtempSync(join(tmpdir(), 'nl-bf-tmp-'));
    mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'dist'));
    mkdirSync(join(dir, 'dist', 'tmp'));
    writeFileSync(join(dir, 'src', 'a.ts'), 'x');
    writeFileSync(join(dir, 'dist', 'tmp', 'old.exe'), 'x');
    const past = Date.now() / 1000 - 3600;
    utimesSync(join(dir, 'dist', 'tmp', 'old.exe'), past, past);
    const r = scanProject(dir);
    if (!(r.ok === false && r.skip === true)) {
      fails.push('★tmp/配下(出荷対象外)の成果物を読んでしまっている: ' + JSON.stringify(r));
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // ★(11)(12) 多段ビルド(src → 中間 → 実体)。
  //   ★この対が無い版を実際に作り、実損の毒を【緑のまま通した】。
  //   src とだけ比べると、中間生成物の方が新しいときに見逃す。
  // ─────────────────────────────────────────────────────────────────────

  // (11) ★正の対照: 実体が【中間生成物】より古ければ赤(src より新しくても)
  {
    const dir = mkdtempSync(join(tmpdir(), 'nl-bf-multi-'));
    mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'dist'));
    const now = Date.now() / 1000;
    writeFileSync(join(dir, 'src', 'a.ahk'), 'x');
    utimesSync(join(dir, 'src', 'a.ahk'), now - 3600, now - 3600);   // src: 1時間前
    writeFileSync(join(dir, 'dist', 'bundle.ahk'), 'x');             // 中間: 今
    writeFileSync(join(dir, 'dist', 'app.exe'), 'x');
    utimesSync(join(dir, 'dist', 'app.exe'), now - 1800, now - 1800); // 実体: 30分前
    // ★exe は src より新しいが、中間生成物より古い ⟹ 赤でなければならない
    const r = scanProject(dir);
    if (!(r.ok === true && r.result.verdict === 'stale')) {
      fails.push('★中間生成物より古い実体を見逃している(多段ビルドで実損が素通りする): ' + JSON.stringify(r));
    }
  }

  // (12) ★負の対照: 実体が中間生成物より新しければ緑(常に赤ではない)
  {
    const dir = mkdtempSync(join(tmpdir(), 'nl-bf-multi-ok-'));
    mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'dist'));
    const now = Date.now() / 1000;
    writeFileSync(join(dir, 'src', 'a.ahk'), 'x');
    utimesSync(join(dir, 'src', 'a.ahk'), now - 3600, now - 3600);
    writeFileSync(join(dir, 'dist', 'bundle.ahk'), 'x');
    utimesSync(join(dir, 'dist', 'bundle.ahk'), now - 1800, now - 1800);
    writeFileSync(join(dir, 'dist', 'app.exe'), 'x');                // 実体が一番新しい
    const r = scanProject(dir);
    if (!(r.ok === true && r.result.verdict === 'ok')) {
      fails.push('★正しい順序の多段ビルドを赤にしている: ' + JSON.stringify(r));
    }
  }

  if (fails.length > 0) {
    console.error('[check-build-fresh] ✗ selftest NG');
    fails.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('[check-build-fresh] selftest OK(新しい=緑 / 古い=赤 / 同時刻は緑 / 不在は測定不能 / nullを0に丸めない / 実ツリーで赤と緑を対で確認 / 出荷対象外は読まない / ★多段ビルドの中間生成物も見る)');
  process.exit(0);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) return runSelftest();

  const dir = args.find((a) => !a.startsWith('--')) || process.cwd();
  console.log(`[check-build-fresh] ${new Date().toISOString()}`);

  const res = scanProject(dir);

  if (res.skip) {
    console.log(`[check-build-fresh] skip: ${res.reason}。`);
    console.log('  → ★対象外です。合格ではありません。');
    process.exit(0);
  }
  if (!res.ok) {
    console.error(`[check-build-fresh] ★測れませんでした: ${res.reason}`);
    process.exit(2);
  }

  const r = res.result;
  if (r.verdict === 'ok') {
    console.log(`[check-build-fresh] ✅ 合格(${r.artifactName} はソースより新しい)`);
    process.exit(0);
  }
  if (r.verdict === 'unmeasurable') {
    console.error(`[check-build-fresh] ★測れませんでした: ${r.reason}`);
    console.error('  → これは「異常なし」ではありません。');
    process.exit(2);
  }

  console.error('[check-build-fresh] 🔴 NG: 配る実体がソースより古い');
  console.error(`  成果物: ${r.artifactName}  ${fmt(r.artifactTime)}`);
  console.error(`  ソース: ${r.sourceName}  ${fmt(r.sourceTime)}`);
  console.error('');
  console.error('  → ★今この実体を配る/起動すると【修正前のもの】が動きます。');
  console.error('  → ★ビルドが無言で失敗していないか確かめてください。');
  console.error('     成果物が起動中だとファイルを掴んで上書きできず、');
  console.error('     ★エラーを出しても止まらずに古い実体が残ります(2026-09-01 実損)。');
  console.error('     先にプロセスを止めてから、もう一度ビルドしてください。');
  process.exit(1);
}

main();

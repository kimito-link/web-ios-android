#!/usr/bin/env node
/**
 * check-drift-coverage.mjs — ★「割れの検査に登録し忘れた実体」を見つける。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか（2026-08-28 に実際に踏んだ）
 *
 *   check-drift.mjs は「登録された実体」だけを比較する。登録は【手で書く】。
 *   ⟹ ★書き忘れた実体は、割れても永久に鳴らない。
 *
 *   実損: キット自身の `scripts/lib/instrument-core.mjs` が未登録のまま、
 *   正本より 12行 古い土台で動いていた。しかもそれを import している
 *   キットの検査が4本あった（＝配る側が古い土台で自分を検査していた）。
 *   「★配る側が自分で使っていない仕組みは、渡された側も使わない」の再発。
 *
 *   さらに `best-trust.biz` は【偶然いま一致しているだけ】で未登録だった。
 *   次に正本が動いた瞬間、無言で割れる時限爆弾になっていた。
 *
 * ■ ★設計の要点
 *
 *   ① 表そのものを検査対象にする
 *      人が書く表は必ず書き忘れる。だから「表に載っているか」を機械に見させる。
 *      （MEMORY: オプトインの台帳は必ず死ぬ／機械が見ている所だけが動く）
 *
 *   ② ★走査0件を緑にしない
 *      「未登録0件」と「そもそも探していない」は別物。
 *      探し先が消えた・globが壊れた等で0件になったら exit 2（測れなかった）。
 *      （MEMORY: 0が正常なセルは特に危険／観測ゼロなら出さない、は最悪）
 *
 *   ③ ★既知の除外は「数」で固定する
 *      個別に名前で除外すると、除外リストが増え続けて誰も見なくなる。
 *      上限を超えたら赤にして、★増えたことに必ず気づく形にする。
 *      （MEMORY: 未登録の数をテストで固定する）
 *
 *   ④ ★fail ではなく inconclusive にしない
 *      未登録は「測れなかった」ではなく【守られていない】という測れた事実。
 *      ただし上限内なら pass（既知の残債として数を固定してある）。
 *
 * ■ この検査が判定しないこと
 *   ★登録されている実体の中身が正しいかは見ない（それは check-drift の仕事）。
 *   ★「配るべきか」も判断しない。あくまで「配ったのに表に無い」を見つけるだけ。
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 使い方:
 *   node _docs/instruments/check-drift-coverage.mjs            # 未登録を探す
 *   node _docs/instruments/check-drift-coverage.mjs --selftest # ★毒で赤くなるか
 *   exit 0 = 未登録なし(or 既知の残債内) / 1 = 未登録が上限超え / ★2 = 探せなかった
 */

import { readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PAIRS } from './check-drift.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = resolve(HERE, '../..');
const GH_ROOT = resolve(KIT_ROOT, '..');

const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });

/**
 * ★探す対象のファイル名。PAIRS に載っている正本の名前から自動で作る。
 *   ハードコードすると、新しい計器を配ったときにここが追随せず穴が開く。
 */
export function watchedFileNames(pairs) {
  const names = new Set();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    if (p && typeof p.canonical === 'string') names.add(basename(p.canonical));
  }
  return names;
}

/**
 * ★PAIRS に登録済みの実パス（正本 + コピー）を集める。
 */
export function registeredPaths(pairs) {
  const set = new Set();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    if (!p) continue;
    if (typeof p.canonical === 'string') set.add(resolve(p.canonical));
    for (const c of Array.isArray(p.copies) ? p.copies : []) {
      if (typeof c === 'string') set.add(resolve(c));
    }
  }
  return set;
}

/**
 * ★意図的に登録しないもの。理由をここに書く（書けないなら除外してはいけない）。
 *
 * ★名前で除外したうえで、さらに「数」でも縛る（下の KNOWN_UNREGISTERED_MAX）。
 *   名前だけの除外リストは増え続けて誰も読まなくなるため。
 */
export const EXCLUDED = Object.freeze([
  {
    // github/splash/ … 2026-08-24 で止まった git 管理外の作業ディレクトリ。
    // README §1 が「集約ランナー run-splash-gates.mjs は 2026-08-25 に廃止済み・
    // 復活させないこと」と明記しているのに、そのファイルが現存している＝残骸。
    // ★追随させる対象ではないので登録しない。整理は別作業。
    match: (p) => p.split(/[\\/]/).includes('splash'),
    why: 'git管理外の残骸（README が廃止済みと明記した実体が現存）'
  },
  {
    // node_modules は配布物ではない。
    match: (p) => p.split(/[\\/]/).includes('node_modules'),
    why: '依存パッケージ（配布した実体ではない）'
  },
  {
    // <repo>-deploy-<sha> … デプロイ時に作られる git 管理外の使い捨て複製。
    // ★元リポを登録していれば足りる。複製を登録すると、消えるたびに🟡が出る。
    match: (p) => /-deploy-[0-9a-f]{6,}([\\/]|$)/.test(p),
    why: 'デプロイ用の使い捨て複製（git管理外・元リポを登録済み）'
  },
  {
    /*
     * 署名ゲート verify-android-signing-config.mjs
     *
     * ★check-drift.mjs 側が【意図的に】copies を空にしている（2026-08-24 の判断）:
     *   実コードは同一だが import パスだけ違う（キットは ./lib、
     *   プロダクトは scripts/app 配下なので ../lib）。
     *   行比較はこの1行を「割れ」と見なすので、登録すると★常に赤になる
     *   ＝オオカミ少年になり、本物の赤が埋もれる。
     *
     * ★だから「登録漏れ」ではない。ただし手で同期している＝黙って割れうるので、
     *   ここに理由を残す。★直すなら先にパスの持ち方を揃えること。
     *   （実際に6リポへ配られている: kimitolink-linktree / malwarecheck.site /
     *     resend.kimito-link.com / sakkino.link / surechigai-romi.link ほか）
     */
    match: (p) => basename(p) === 'verify-android-signing-config.mjs',
    why: '★import パス差で常に割れる（check-drift 側が意図的に対象外。手で同期）'
  },
  {
    /*
     * tsuioku-no-kirameki.com/scripts/check-tracked-imports.mjs
     *
     * ★【別実装】なので行比較の対象にしない（2026-08-29・実測して判断）。
     *   正本 340行 / tsuioku 79行。判定ロジックを src/lib/trackedImports.js へ
     *   切り出し、★専用テストまで持っている。実測で緑（782ファイル・未追跡0件）。
     *   ＝壊れて放置されていたのではなく、リファクタされた別系統。
     *   ★正本で上書きすると、切り出した構造とテストが壊れる。
     *
     * ★宿題: tsuioku 側に --selftest が無い（毒で赤くなるか未確認）。
     *   それは tsuioku 側で足す。ここに戻すのは構造を揃える判断をしたときだけ。
     */
    match: (p) => /tsuioku-no-kirameki\.com[\\/]scripts[\\/]check-tracked-imports\.mjs$/.test(p),
    why: '★別実装（ロジックを src/lib/ へ切り出し・専用テストあり・実測で緑）'
  }
]);

/** ★除外の上限。増えたら赤くする（黙って増えるのを止める）。 */
export const KNOWN_UNREGISTERED_MAX = 0;

/**
 * ★github/ 直下のリポを走査して、監視対象のファイル名を持つ実体を全部見つける。
 *
 * @param {string} ghRoot
 * @param {Set<string>} names
 * @returns {string[]} 見つかった実パス
 */
export function scanForInstruments(ghRoot, names) {
  /** @type {string[]} */
  const found = [];
  if (!existsSync(ghRoot)) return found;

  // ★深さを絞る: <repo>/**/lib/ か <repo>/**/diagnostics/ か <repo>/**/scripts/ の下に居る想定。
  //   全再帰すると node_modules で時間を溶かす（実測で数分かかる）。
  const walk = (dir, depth) => {
    if (depth > 5) return;
    /** @type {string[]} */
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.git' || name.startsWith('.')) continue;
      const full = join(dir, name);
      /** @type {import('node:fs').Stats} */
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        walk(full, depth + 1);
      } else if (names.has(name)) {
        found.push(resolve(full));
      }
    }
  };
  walk(ghRoot, 0);
  return found;
}

/**
 * ★純粋な判定。走査結果と登録済みを突き合わせる。
 *
 * @param {string[]} found 走査で見つかった実パス
 * @param {Set<string>} registered PAIRS に載っているパス
 * @returns {{verdict:'pass'|'fail'|'inconclusive', evidence?:object, unregistered:string[], detail?:string}}
 */
export function judgeCoverage(found, registered) {
  // ★走査0件は「未登録なし」ではない。探せていない。
  if (!Array.isArray(found) || found.length === 0) {
    return {
      verdict: 'inconclusive',
      unregistered: [],
      detail: '★走査で1件も見つかりませんでした（未登録0件ではなく、探せていません）'
    };
  }
  const reg = registered instanceof Set ? registered : new Set();
  const unregistered = found.filter((p) => !reg.has(resolve(p)));
  const excluded = unregistered.filter((p) => EXCLUDED.some((e) => e.match(p)));
  const remaining = unregistered.filter((p) => !EXCLUDED.some((e) => e.match(p)));

  if (remaining.length > KNOWN_UNREGISTERED_MAX) {
    return {
      verdict: 'fail',
      evidence: { 走査: found.length, 登録済み: found.length - unregistered.length, 未登録: remaining.length, 除外: excluded.length },
      unregistered: remaining
    };
  }
  return {
    verdict: 'pass',
    evidence: { 走査: found.length, 登録済み: found.length - unregistered.length, 未登録: remaining.length, 除外: excluded.length },
    unregistered: remaining
  };
}

// ---- 実行 ------------------------------------------------------------------

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain && process.argv.includes('--selftest')) {
  const P = [{ canonical: '/x/lib/core.mjs', copies: ['/y/lib/core.mjs'] }];
  /** @type {Array<{name:string, ok:() => boolean}>} */
  const cases = [
    {
      name: '★走査0件を緑にしない（未登録なしと区別する）',
      ok: () => judgeCoverage([], new Set()).verdict === 'inconclusive'
    },
    {
      name: '★未登録があれば赤くなる（見逃さない）',
      ok: () => judgeCoverage(['/z/lib/core.mjs'], new Set()).verdict === 'fail'
    },
    {
      name: '★全部登録済みなら緑',
      ok: () => judgeCoverage([resolve('/y/lib/core.mjs')], registeredPaths(P)).verdict === 'pass'
    },
    {
      name: '★除外対象(splash)は未登録に数えない',
      ok: () => judgeCoverage([resolve('/gh/splash/lib/core.mjs')], new Set()).verdict === 'pass'
    },
    {
      name: '★監視するファイル名は PAIRS から作る（ハードコードしない）',
      ok: () => watchedFileNames(P).has('core.mjs') && watchedFileNames([]).size === 0
    },
    {
      name: '★壊れた入力で throw しない',
      ok: () => judgeCoverage(null, null).verdict === 'inconclusive'
        && registeredPaths(null).size === 0
    }
  ];

  const failed = cases.filter((c) => { try { return !c.ok(); } catch { return true; } });
  if (failed.length > 0) {
    console.error('[check-drift-coverage] ★selftest 失敗（検知器が効いていません）:');
    for (const f of failed) console.error(`  - ${f.name}`);
    process.exit(EXIT.FAIL);
  }
  console.log(`[check-drift-coverage] selftest OK（${cases.length}件・走査0を緑にしない / 未登録で赤くなる）`);
  process.exit(EXIT.PASS);
}

if (isMain) {
  const names = watchedFileNames(PAIRS);
  if (names.size === 0) {
    console.error('[check-drift-coverage] 🟡 監視対象のファイル名が0件のため探せませんでした(★緑ではありません)。');
    console.error('[check-drift-coverage] → check-drift.mjs の PAIRS が読めているか確認してください。');
    process.exit(EXIT.INCONCLUSIVE);
  }

  const found = scanForInstruments(GH_ROOT, names);
  const r = judgeCoverage(found, registeredPaths(PAIRS));

  /*
   * ★--count: 未登録の本数だけを1行で返す（進化台帳の auto 測定用）。
   *   ★測れなかったとき(走査0件)は数字を出さず exit 2。
   *     0 を返すと「未登録なし」と読まれる＝★測れなかったを緑に混ぜる最悪の形。
   */
  if (process.argv.includes('--count')) {
    if (r.verdict === 'inconclusive') process.exit(EXIT.INCONCLUSIVE);
    console.log(String(r.unregistered.length));
    process.exit(EXIT.PASS);
  }

  const mark = r.verdict === 'pass' ? '✅' : r.verdict === 'fail' ? '🔴' : '🟡';

  console.log(`[check-drift-coverage] ${mark} 割れ検査への登録 — ${r.verdict}`);
  if (r.evidence) console.log('  根拠: ' + JSON.stringify(r.evidence, null, 0));
  if (r.detail) console.log('  ' + r.detail);

  if (r.unregistered.length > 0) {
    console.log('  ★配っているのに割れ検査に登録されていない実体:');
    for (const p of r.unregistered) {
      console.log('    ' + p.split(GH_ROOT).join('').replace(/^[\\/]+/, ''));
    }
    console.log('  → 直し方: check-drift.mjs の PAIRS の copies に上のパスを足す。');
    console.log('    ★登録しない判断をしたなら EXCLUDED に理由を書く（理由が書けないなら登録する）。');
  }
  console.log('  → この検査の限界: ★登録されているかだけを見ます。'
    + '中身が正しいか・配るべきかは判定しません。'
    + `★走査は github/ 直下から深さ5まで（node_modules と隠しディレクトリは見ません）。`);

  process.exit(r.verdict === 'fail' ? EXIT.FAIL : r.verdict === 'inconclusive' ? EXIT.INCONCLUSIVE : EXIT.PASS);
}

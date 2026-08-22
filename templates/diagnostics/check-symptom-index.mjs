#!/usr/bin/env node
/**
 * check-symptom-index.mjs — ★「症状の言葉」で原因索引を引けるかを数える。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★これが「共有するほど不具合が減る」の心臓部
 *
 *   ユーザーの目標:
 *     「これを共有すれば原因が分かる」を共有するほど不具合がなくなり進化していく
 *
 *   ★実測で分かった、成立していない理由(2026-08-23):
 *     アプリ側 : symptomVerdicts.js に ★症状ID が7件
 *                (panel-black / status-slow / thumb-white ...)
 *     索引側   : ai-hub/index.json に 40件・triggers(実文言) 245件
 *     ★繋がり : 7つの症状IDで索引を引くと【全部「該当なし」】
 *
 *   ⟹ ★症状の言葉と、原因の索引が、別々の語彙で暮らしている。
 *     これが「共有しても原因が分からない」の正体だった。
 *
 * ■ ★何をすれば環が回るか
 *     ① 症状が起きる → 症状IDが出る（既にある）
 *     ② 共有テキストに症状IDを載せる
 *     ③ 受け手が索引を引く → 既知原因に当たる
 *     ④ 原因が分かったら、その症状IDを索引に登録する
 *     ⑤ ★次の人は③で当たる ＝ 往復が1回減る
 *   ★⑤が「共有するほど減る」の実体。索引が育つのは④のときだけ。
 *
 * ■ ★④は人がやる＝放っておくと必ず死ぬ
 *   このキットの実損: 手で書く登録簿は3ヶ月で登録1件のまま死んだ。
 *   ⟹ ★「登録して」と頼まない。★登録されていない症状の数を機械が数える。
 *     症状IDはコードにある。triggers は index.json にある。★両方とも機械が読める。
 *
 * ■ ★強制しない(このキットの掟)
 *   「登録しないと赤」にすると、通すためだけの★空の登録が入る。
 *   ⟹ ベースライン＋ラチェット。★増えたときだけ赤。減らすのは自由。
 *
 * ■ 3値の終了コード
 *   0 = 合格 / 1 = ★測れた上での赤(未登録が増えた) / 2 = ★測れなかった
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 使い方:
 *   node check-symptom-index.mjs --symptoms <症状定義.js> --index <index.json>
 *   node check-symptom-index.mjs --selftest
 */

import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * ★ここを超えて「索引に無い症状」が増えたら赤。
 *   ★既定は0。新しいキットは症状も索引も空から始まるので、
 *   ★症状を足したら索引にも足す、が最初から守られる。
 *   既に症状がある既存プロジェクトに後付けするときだけ、実測値まで上げてよい。
 */
export const DEFAULT_UNINDEXED_MAX = 0;

/**
 * 症状の言葉を索引キーに正規化する。
 *
 * ★両側を同じ関数に通す。片側だけ正規化すると永久に一致しない
 *   (＝「比較には両辺の起点を揃える」)。
 *
 * @param {string} s
 * @returns {string}
 */
export function normalizeSignature(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')      // 空白とアンダースコアはハイフンに寄せる
    .replace(/[^\p{L}\p{N}-]/gu, '') // 記号を落とす(日本語は残す)
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * ソースから症状IDを拾う。
 *
 * ★実行せずに読む(import すると副作用が走るため)。
 * @param {string} src
 * @returns {string[]}
 */
export function extractSymptomIds(src) {
  const s = String(src || '');
  const ids = [...s.matchAll(/\bid:\s*'([a-z0-9][a-z0-9-]*)'/g)].map((m) => m[1]);
  return [...new Set(ids)];
}

/**
 * 索引(index.json の中身)から triggers を集める。
 * @param {unknown} indexJson
 * @returns {Set<string>}
 */
export function collectIndexedSignatures(indexJson) {
  const j = /** @type {any} */ (indexJson) || {};
  const entries = Array.isArray(j.entries) ? j.entries : Array.isArray(j.items) ? j.items : [];
  /** @type {Set<string>} */
  const out = new Set();
  for (const e of entries) {
    for (const t of (e && Array.isArray(e.triggers) ? e.triggers : [])) {
      const n = normalizeSignature(t);
      if (n) out.add(n);
    }
  }
  return out;
}

/**
 * @typedef {object} SymptomIndexVerdict
 * @property {boolean} measured ★測れたか(測れなければ結論を出さない)
 * @property {string[]} unindexed 索引に無い症状ID
 * @property {number} total 症状IDの総数
 * @property {number} hitRate 索引に有る割合(0..1)
 * @property {string} reason
 */

/**
 * @param {object} input
 * @param {string} [input.symptomSrc] 症状定義のソース
 * @param {unknown} [input.indexJson] 索引JSON
 * @returns {SymptomIndexVerdict}
 */
export function judgeSymptomIndex(input) {
  const src = input?.symptomSrc;
  if (typeof src !== 'string' || src.length === 0) {
    return { measured: false, unindexed: [], total: 0, hitRate: 0, reason: '★症状定義が読めません' };
  }
  const ids = extractSymptomIds(src);
  if (ids.length === 0) {
    // ★症状が0件＝「異常なし」ではない。読み方が変わった可能性がある。
    return { measured: false, unindexed: [], total: 0, hitRate: 0, reason: '★症状IDが1件も見つかりません' };
  }
  if (!input?.indexJson || typeof input.indexJson !== 'object') {
    return { measured: false, unindexed: [], total: ids.length, hitRate: 0, reason: '★索引が読めません' };
  }
  const indexed = collectIndexedSignatures(input.indexJson);
  const unindexed = ids.filter((id) => !indexed.has(normalizeSignature(id)));
  const hitRate = (ids.length - unindexed.length) / ids.length;
  return {
    measured: true,
    unindexed,
    total: ids.length,
    hitRate,
    reason: `症状 ${ids.length} 件中 ${ids.length - unindexed.length} 件が索引にあります`
  };
}

/** ★自分自身を毒で試す。 */
function runSelftest() {
  const fails = [];

  // ① 正規化が両側で効くこと
  if (normalizeSignature('  Panel_Black ') !== 'panel-black') fails.push('★正規化が効いていない');

  // ② 症状IDを拾えること
  const src = "const A={id:'panel-black'};const B={id:'status-slow'};";
  if (extractSymptomIds(src).length !== 2) fails.push('★症状IDを拾えない');

  // ③ ★索引に有る/無いを正しく分けること
  const idx = { entries: [{ triggers: ['Panel Black'] }] };
  const v = judgeSymptomIndex({ symptomSrc: src, indexJson: idx });
  if (!v.measured) fails.push('★測れたのに測れないと言う');
  if (v.unindexed.join() !== 'status-slow') fails.push('★未登録の判定が違う: ' + v.unindexed.join());
  if (Math.abs(v.hitRate - 0.5) > 1e-9) fails.push('★ヒット率が違う: ' + v.hitRate);

  // ④ ★測れないときに「合格」と言わないこと(0件を緑にしない)
  if (judgeSymptomIndex({ symptomSrc: 'const x=1;', indexJson: idx }).measured) {
    fails.push('★症状0件を測れたことにしている');
  }
  if (judgeSymptomIndex({ symptomSrc: src, indexJson: null }).measured) {
    fails.push('★索引が無いのに測れたことにしている');
  }
  if (judgeSymptomIndex(/** @type {any} */ (null)).measured) fails.push('★null を測れたことにしている');

  // ⑤ ★全部登録済みなら未登録0
  const all = { entries: [{ triggers: ['panel-black', 'status-slow'] }] };
  if (judgeSymptomIndex({ symptomSrc: src, indexJson: all }).unindexed.length !== 0) {
    fails.push('★全部登録済みなのに未登録を出す');
  }

  if (fails.length) {
    console.error('[check-symptom-index] ★selftest 失敗:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log(
    '[check-symptom-index] selftest OK'
    + '(正規化が両側に効く / 未登録を数える / ★0件を緑にしない / 索引が無いなら測れないと言う)'
  );
  process.exit(0);
}

function argOf(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  if (process.argv.includes('--selftest')) return runSelftest();

  const symptomsPath = argOf('--symptoms');
  const indexPath = argOf('--index');
  const max = Number(argOf('--max') ?? DEFAULT_UNINDEXED_MAX);

  if (!symptomsPath || !indexPath) {
    console.error('[check-symptom-index] ★測れませんでした: --symptoms と --index が要ります');
    console.error('  例: node check-symptom-index.mjs --symptoms src/lib/symptomVerdicts.js --index ../ai-hub/index.json');
    process.exit(2);
  }
  if (!existsSync(symptomsPath) || !existsSync(indexPath)) {
    console.error(`[check-symptom-index] ★測れませんでした: ファイルが見つかりません`);
    console.error(`  症状: ${symptomsPath} ${existsSync(symptomsPath) ? '' : '★無い'}`);
    console.error(`  索引: ${indexPath} ${existsSync(indexPath) ? '' : '★無い'}`);
    process.exit(2);
  }

  let indexJson;
  try {
    indexJson = JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch (e) {
    console.error(`[check-symptom-index] ★測れませんでした: 索引が壊れています (${e.message})`);
    process.exit(2);
  }

  const v = judgeSymptomIndex({ symptomSrc: readFileSync(symptomsPath, 'utf8'), indexJson });
  if (!v.measured) {
    console.error(`[check-symptom-index] ★測れませんでした: ${v.reason}`);
    process.exit(2);
  }

  const pct = Math.round(v.hitRate * 100);
  console.log(`[check-symptom-index] 症状 ${v.total} 件 / 索引ヒット ${pct}% / 未登録 ${v.unindexed.length} 件`);
  for (const id of v.unindexed) console.log(`  ⚪ ${id}`);

  if (v.unindexed.length > max) {
    console.error(`[check-symptom-index] 🔴 索引に無い症状が ${max} 件を超えました(${v.unindexed.length} 件)。`);
    console.error('  → 直し方: 原因が分かった症状は ai-hub の triggers に症状IDを足す。');
    console.error('    ★そうすると【次に同じ症状を見た人】が索引で当てられる＝往復が1回減る。');
    console.error('  → ★この検査が判定しないこと: 索引の中身が正しいかは見ません。');
    console.error('    間違った原因を登録すれば、間違った所へ誘導します(正しさは人が確かめる)。');
    process.exit(1);
  }

  console.log(`[check-symptom-index] ✅ 合格(未登録 ${v.unindexed.length}/${max} 件)。`);
  process.exit(0);
}

main();

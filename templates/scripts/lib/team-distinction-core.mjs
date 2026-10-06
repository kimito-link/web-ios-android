// @ts-check
/**
 * team-distinction-core.mjs — 同一 Team のアプリ同士が「別アプリに見えるか」の判定（純関数）。
 *
 * 位置づけ: Apple の判定の再現ではない。公式の寄与要因（同型のメタデータ・重なる機能）を
 * 提出前に自己点検する。閾値は設計書 §C2 の初期値（大手の説明文 5-gram 重複の中央値 0.003〜0.012、
 * 自社 S×D の実測最大 0.034 から置いた）。
 * 設計: _docs/DESIGN-apple-4-3a-spam-response-2026-10-06.md §C2（③機能の交わり・⑤メタデータの型）
 *
 * fs に触らない。入力はオブジェクト。CLI（verify-team-distinction.mjs）が読み込む。
 */
import { normalizeForMatch } from './distinction-checks.mjs';

export const DEFAULT_THRESHOLDS = Object.freeze({
  /** 説明文の 5-gram Jaccard。これ以上は fail */
  jaccardFail: 0.1,
  /** これ以上は warn */
  jaccardWarn: 0.03,
  ngram: 5,
});

/** 法務・定型の共通句。重なっていても「型が同じ」の証拠にしない（共通辞書）。 */
export const DEFAULT_BOILERPLATE = Object.freeze([
  'アプリ内課金はありません',
  'アプリ内課金・サブスクリプションはありません',
  'アプリ内課金・サブスクはありません',
  'プライバシーポリシー',
  '利用規約',
  'お問い合わせ',
]);

/**
 * 比較用に整える: NFKC・小文字化・定型句除去・空白と記号を除去。
 * @param {unknown} text
 * @param {readonly string[]} [boilerplate]
 */
export function normalizeForNgram(text, boilerplate = DEFAULT_BOILERPLATE) {
  let s = String(text ?? '').normalize('NFKC').toLowerCase();
  for (const b of boilerplate) {
    const nb = String(b).normalize('NFKC').toLowerCase();
    if (nb) s = s.split(nb).join('');
  }
  return s.replace(/[\s\p{P}\p{S}■□●○◆◇▼▲・、。]/gu, '');
}

/**
 * 文字 n-gram の集合（コードポイント単位）。
 * @param {string} s
 * @param {number} n
 */
export function ngramSet(s, n) {
  const cps = [...s];
  const out = new Set();
  if (cps.length < n) return out;
  for (let i = 0; i <= cps.length - n; i++) out.add(cps.slice(i, i + n).join(''));
  return out;
}

/**
 * Jaccard 係数。どちらかが空なら null（測れない。0 と区別する）。
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number | null}
 */
export function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return null;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** @param {unknown} text */
function firstSentenceOf(text) {
  const n = String(text ?? '').replace(/\r\n/g, '\n').trimStart();
  const cut = n.search(/。|\n/);
  if (cut === -1) return n.trim();
  return n[cut] === '。' ? n.slice(0, cut + 1).trim() : n.slice(0, cut).trim();
}

/**
 * coreFeatures の交わり（正規化後の完全一致）。
 * @param {string[]} a
 * @param {string[]} b
 */
export function featureOverlap(a, b) {
  const nb = new Set((b || []).map((x) => normalizeForMatch(x).toLowerCase()));
  return (a || []).filter((x) => nb.has(normalizeForMatch(x).toLowerCase()));
}

/**
 * @typedef {{
 *   name: string,
 *   distinction?: { oneLiner?: string, coreFeatures?: string[], sharedFoundation?: string[] } | null,
 *   descriptionText?: string | null,
 *   releaseNotesText?: string | null,
 * }} TeamApp
 * @typedef {{ status: 'ok'|'warn'|'fail'|'unmeasured', check: string, pair: string, detail: string }} Finding
 */

/**
 * 全ペアを点検する。
 * @param {TeamApp[]} apps
 * @param {Partial<typeof DEFAULT_THRESHOLDS> & { boilerplate?: readonly string[] }} [opts]
 * @returns {Finding[]}
 */
export function analyzeTeam(apps, opts = {}) {
  const th = { ...DEFAULT_THRESHOLDS, ...opts };
  const boiler = opts.boilerplate ?? DEFAULT_BOILERPLATE;
  /** @type {Finding[]} */
  const out = [];
  for (let i = 0; i < apps.length; i++) {
    for (let j = i + 1; j < apps.length; j++) {
      const A = apps[i];
      const B = apps[j];
      const pair = `${A.name} × ${B.name}`;

      // ③ 機能の交わり（宣言どうし）
      if (A.distinction && B.distinction) {
        const overlap = featureOverlap(A.distinction.coreFeatures || [], B.distinction.coreFeatures || []);
        if (overlap.length > 0) {
          out.push({
            status: 'fail',
            check: 'core-features-overlap',
            pair,
            detail: `coreFeatures が重なる: ${overlap.join(' / ')}（共通の基盤は sharedFoundation に出し、売りにする機能は別にする）`,
          });
        } else {
          out.push({ status: 'ok', check: 'core-features-overlap', pair, detail: 'coreFeatures の交わりなし' });
        }
        // 1文の完全一致
        const oa = normalizeForMatch(A.distinction.oneLiner);
        const ob = normalizeForMatch(B.distinction.oneLiner);
        if (oa && oa === ob) {
          out.push({ status: 'fail', check: 'oneliner-identical', pair, detail: 'distinction.oneLiner が同一' });
        }
      } else {
        out.push({
          status: 'unmeasured',
          check: 'core-features-overlap',
          pair,
          detail: `distinction 未宣言: ${[!A.distinction && A.name, !B.distinction && B.name].filter(Boolean).join(', ')}（測れない）`,
        });
      }

      // ⑤ メタデータの型（説明文の 5-gram Jaccard）
      const ja = ngramSet(normalizeForNgram(A.descriptionText, boiler), th.ngram);
      const jb = ngramSet(normalizeForNgram(B.descriptionText, boiler), th.ngram);
      const jac = jaccard(ja, jb);
      if (jac == null) {
        out.push({ status: 'unmeasured', check: 'description-jaccard', pair, detail: '説明文が無い/短すぎて測れない' });
      } else if (jac >= th.jaccardFail) {
        out.push({ status: 'fail', check: 'description-jaccard', pair, detail: `説明文の ${th.ngram}-gram Jaccard=${jac.toFixed(3)}（>=${th.jaccardFail}）` });
      } else if (jac >= th.jaccardWarn) {
        out.push({ status: 'warn', check: 'description-jaccard', pair, detail: `説明文の ${th.ngram}-gram Jaccard=${jac.toFixed(3)}（>=${th.jaccardWarn}）` });
      } else {
        out.push({ status: 'ok', check: 'description-jaccard', pair, detail: `説明文の ${th.ngram}-gram Jaccard=${jac.toFixed(3)}` });
      }

      // リリースノート冒頭文の完全一致
      const fa = normalizeForMatch(firstSentenceOf(A.releaseNotesText));
      const fb = normalizeForMatch(firstSentenceOf(B.releaseNotesText));
      if (fa && fb) {
        if (fa === fb) {
          out.push({ status: 'fail', check: 'release-notes-first-sentence', pair, detail: 'リリースノートの冒頭1文が同一' });
        } else {
          // 冒頭の型（「はじめまして。『…』の最初のリリースです」）を括弧内を伏せて比べる
          const shape = (s) => s.replace(/『[^』]*』|「[^」]*」/g, '＊');
          if (shape(firstSentenceOf(A.releaseNotesText)) === shape(firstSentenceOf(B.releaseNotesText))) {
            out.push({ status: 'fail', check: 'release-notes-first-sentence', pair, detail: 'リリースノート冒頭1文が、名称部分以外は同一の型' });
          }
        }
      }
    }
  }
  return out;
}

/**
 * 終了コード（instrument-core の3値規約）。fail があれば 1、fail が無く unmeasured があれば 2、それ以外 0。
 * @param {Finding[]} findings
 */
export function exitCodeFor(findings) {
  if (findings.some((f) => f.status === 'fail')) return 1;
  if (findings.some((f) => f.status === 'unmeasured')) return 2;
  return 0;
}

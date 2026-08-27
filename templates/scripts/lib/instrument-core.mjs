/**
 * instrument-core.mjs — ★検査・計器の共通土台（キット同梱・依存ゼロ・純Node）。
 *
 * ★このファイル1つをコピーすれば、web-ios-androidキットを使っていない
 *   他のプロジェクトでもそのまま動く（外部ライブラリへの依存なし）。
 *   取得先: https://github.com/kimito-link/web-ios-android/blob/main/templates/scripts/lib/instrument-core.mjs
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★何を解決するか
 *   検査が「合格 / 不合格」の2値しか答えられないと、
 *   ★**何も測っていないのに合格**と出る。これは赤より危険（機能しているように見える）。
 *
 *   このリポでも 2026-08-17 に実際に踏んだ:
 *     audit-native-cta.mjs を引数なしで実行 → 何も走査せず「✅ 0件」と表示
 *     ＝ 偽の緑（commit fc3a8e3 で個別に対処）。
 *   ★同じ穴は別の検査でも開く。だから土台側で塞ぐ。
 *
 * ■ 終了コードの約束（3値）
 *   0 = 合格（★根拠つき） / 1 = 測れた上での赤 / ★2 = 測れなかった
 *   ★2 を 0 と同じ「緑」に数えないこと。
 *
 * ■ 収穫元（実運用で効いている先例・すべて実ファイルで確認）
 *   - soushin-suggest.link/scripts/blank-map.mjs:17    3値規約の明文化
 *   - kimitolink-linktree/scripts/lib/diag-core.mjs:18 ★根拠なき pass を降格
 *   - soushin-suggest.link/scripts/blank-map.mjs:556   --selftest（毒→赤）
 *   - ai-hub/bin/ci-audit.mjs:212  「N件監査できなかった」を緑と判定しない
 *   - soushin-suggest.link/scripts/check-boundaries.ps1:132
 *       赤のとき3行（何が / 直し方 / ★この検査の限界）
 *
 * ■ ★「限界の明記」がなぜ要るか（実損の記録）
 *   soushin-suggest.link/_docs/PAINT-CHAIN-INSTRUMENT-DESIGN.md:
 *     計器が「可視先頭2行 × 左240px」しか測っていないのに全体の数字と解釈され、
 *     ★**会議の全メンバーが前提を誤り、立てた論の大半が無効になった**。
 *   → 計器は「自分が何を測っていないか」を出力に書く。
 *
 * ■ 使い方（最小）
 *   import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from ./lib/instrument-core.mjs;
 *   const results = [{ probe: 何を測ったか, verdict: pass, evidence: { 走査: n } }];
 *   console.log(formatProbeReport(results));
 *   process.exit(computeExitCode(results));
 *   ★evidence が空だと pass は自動で inconclusive に降格する（根拠なき緑を作らない）。
 * ───────────────────────────────────────────────────────────────────────────
 */

/** ★終了コードの約束。★このファイルをコピーすれば、web-ios-androidキットを
 *  使っていない他のリポジトリでもそのまま同じ規約で使える(依存ゼロ・純Node)。 */
/**
 * ★証拠が「いつ測ったものか」を見て、古ければ印を付ける閾値（ミリ秒）。
 *
 * ★収穫元: surechigai-romi.link/scripts/lib/instrument-core.mjs（2026-08-27 に正本へ取り込み）。
 *   ★合格そのものは取り消さない。「古い」は「無効」ではない。
 *   ただし★古い緑を新しい緑と同じ見た目にはしない（経過秒を必ず出す）。
 */
const STALE_MS = 60 * 1000;

export const EXIT = Object.freeze({
  /** 合格。★根拠(evidence)を伴うときだけ名乗れる。 */
  PASS: 0,
  /** 測れた上での赤。直すべきものがある。 */
  FAIL: 1,
  /** ★測れなかった。**緑ではない**。0 と同じに扱ってはいけない。 */
  INCONCLUSIVE: 2
});

/**
 * @typedef {'pass'|'fail'|'inconclusive'} Verdict
 */

/**
 * @typedef {object} ProbeResult
 * @property {string} probe 何を測ったか(人が読む名前)
 * @property {Verdict} verdict
 * @property {Record<string, unknown>|null} evidence ★根拠。pass を名乗るなら必須
 * @property {string} [detail] 赤のときの説明(何が起きたか)
 * @property {string} [howToFix] ★直し方(何をすれば緑になるか)
 * @property {string} [limitation] ★この検査が判定しないこと(過信を防ぐ)
 */

/**
 * ★根拠なき pass を inconclusive へ降格する(fail-closed の最小実装)。
 *
 * ★収穫元: `kimitolink-linktree/scripts/lib/diag-core.mjs:18`。
 * ★このリポで実際に起きた事故と同型:
 *   「カウンタ0を『起きなかった』と読んだが、真実は『一度も測っていなかった』」
 *   ([[zero-count-may-mean-unmeasured-2026-08-04]])。
 *   ＝ **0件で緑**を出す検査は、測っていない場合と区別が付かない。
 *
 * @param {ProbeResult} raw
 * @returns {ProbeResult}
 */
export function normalizeProbeResult(raw) {
  const evidence =
    raw && raw.evidence && typeof raw.evidence === 'object' ? { ...raw.evidence } : null;
  let verdict = raw?.verdict;

  // ★根拠が無い pass は名乗らせない。
  if (verdict === 'pass' && (!evidence || Object.keys(evidence).length === 0)) {
    verdict = 'inconclusive';
  }
  if (verdict !== 'pass' && verdict !== 'fail' && verdict !== 'inconclusive') {
    verdict = 'inconclusive';
  }

  // ★証拠に verifiedAt があれば、古さを測って印を付ける（合格は取り消さない）。
  if (evidence && typeof evidence.verifiedAt === 'string') {
    const at = Date.parse(evidence.verifiedAt);
    if (!Number.isNaN(at) && Date.now() - at > STALE_MS) {
      evidence.stale = true;
      evidence.staleSec = Math.round((Date.now() - at) / 1000);
    }
  }

  return {
    probe: String(raw?.probe || '(無名)'),
    verdict,
    evidence,
    detail: raw?.detail || '',
    howToFix: raw?.howToFix || '',
    limitation: raw?.limitation || ''
  };
}

/**
 * 複数の結果から終了コードを決める。
 *
 * ★優先順は fail > inconclusive > pass。
 *   ＝ ★**1件でも「測れなかった」があれば緑にしない**
 *   (`ai-hub/bin/ci-audit.mjs:212` の「N件を監査できなかった＝緑と判定しない」と同じ)。
 *
 * @param {ProbeResult[]} results
 * @returns {number} EXIT のいずれか
 */
export function computeExitCode(results) {
  const list = Array.isArray(results) ? results.map(normalizeProbeResult) : [];
  if (list.length === 0) return EXIT.INCONCLUSIVE; // ★何も測っていない＝緑ではない
  if (list.some((r) => r.verdict === 'fail')) return EXIT.FAIL;
  if (list.some((r) => r.verdict === 'inconclusive')) return EXIT.INCONCLUSIVE;
  return EXIT.PASS;
}

/**
 * 人が読む出力にする。
 *
 * ★赤のときは3行を必ず出す(収穫元 `check-boundaries.ps1:132`):
 *   1. 何がどうなったか
 *   2. ★直し方(逃げ道も正規化する。「上げてよい。ただし理由を書け」)
 *   3. ★**この検査が判定しないこと**(過信を防ぐ)
 *
 * @param {ProbeResult[]} results
 * @param {{ label?: string }} [opts]
 * @returns {string}
 */
export function formatProbeReport(results, opts = {}) {
  const list = Array.isArray(results) ? results.map(normalizeProbeResult) : [];
  const label = opts.label ? `[${opts.label}] ` : '';
  const lines = [];

  const fails = list.filter((r) => r.verdict === 'fail');
  const unk = list.filter((r) => r.verdict === 'inconclusive');
  const pass = list.filter((r) => r.verdict === 'pass');

  for (const r of fails) {
    lines.push(`${label}🔴 ${r.probe}${r.detail ? ': ' + r.detail : ''}`);
    if (r.howToFix) lines.push(`   → 直し方: ${r.howToFix}`);
    if (r.limitation) lines.push(`   → この検査が判定しないこと: ${r.limitation}`);
  }
  for (const r of unk) {
    // ★「測れなかった」は緑と並べない。何が足りないかを書く。
    lines.push(`${label}🟡 ${r.probe}: 測れませんでした(緑ではありません)`);
    if (r.detail) lines.push(`   → ${r.detail}`);
    if (r.howToFix) lines.push(`   → 測れるようにするには: ${r.howToFix}`);
  }
  if (!fails.length && !unk.length) {
    const ev = pass.length ? `(根拠あり ${pass.length}件)` : '';
    lines.push(`${label}✅ 合格 ${ev}`);
    // ★古い証拠での合格は、経過時間を必ず出す（新しい緑と見分けが付かなくしない）。
    for (const r of pass) {
      if (r.evidence?.stale) {
        lines.push(
          `${label}⏳ ${r.probe}: ★${r.evidence.staleSec}秒前の証拠です（今の状態ではありません）`
        );
      }
    }
  }
  return lines.join('\n');
}

/**
 * ★毒を食わせて「赤くなるか」を確かめる(selftest の共通形)。
 *
 * ★収穫元: `soushin-suggest.link/scripts/blank-map.mjs:556`。
 *   このリポでは私が**毎回手で変異テストをしていた**が、手作業は忘れる。
 *   ★仕掛けの生死は「サボると赤くなるか」だけで決まるので、
 *     **検知器自身が赤くなれること**を機械で確かめる。
 *
 * ★必ず finally で原状復帰する(復帰しないと本体を壊す)。
 * ★収穫元の失敗記録も踏まえる: 「特定の項目が todo である前提」に依存した
 *   selftest は、その項目を実装した瞬間に壊れた。**状態に依存しない毒**にすること。
 *
 * @param {{ name: string, poison: () => void, restore: () => void, isRed: () => boolean }[]} cases
 * @returns {{ ok: boolean, fails: string[] }}
 */
export function runSelfTest(cases) {
  /** @type {string[]} */
  const fails = [];
  for (const c of Array.isArray(cases) ? cases : []) {
    let red = false;
    try {
      c.poison();
      red = !!c.isRed();
    } catch (e) {
      fails.push(`${c.name}: 毒の注入で例外 (${e && e.message})`);
      continue;
    } finally {
      // ★何があっても戻す。
      try { c.restore(); } catch { /* 復帰失敗は下で検出される */ }
    }
    if (!red) fails.push(`${c.name}: ★毒を入れても赤にならなかった(検知が効いていない)`);
  }
  return { ok: fails.length === 0, fails };
}

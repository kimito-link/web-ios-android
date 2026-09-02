/**
 * instrument-proof.mjs — ★検査の「exit 2を持っているか」の代わりに何を見るか（README §6 未解決#2・#3の解）。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★何を解決するか
 *   README.md §6 に2つの未解決の問いがあった:
 *     #2「exit 2を持っているか」の代わりに何を見れば正しさに近づくか
 *     #3 直した検査が実機で緑のままか（12本が未測定）
 *
 *   掟②（`check-instrument-ran.mjs`の実測）が示す通り、「exit 2を持っているか」は
 *   ★所有（grepで見つかる）でしかなく、行動（実際に赤・緑の両方を経験したか）の
 *   証明にはならない。壊れていた3本のうち2本はexit 2を持っていたのに守れていなかった。
 *
 *   ★答え: 所有の代わりに「行動の証明3点」を見る。
 *     1. 実対象で赤になったことがある（lastRealRed） ─ 検知が本当に効くか
 *     2. 実対象で緑になったことがある（lastRealGreen） ─ 誤検知しないか
 *     3. 直近のソース変更後にその両方が観測されている（sourceHash一致） ─ #3の機械化
 *
 *   ★「直した検査が実機で緑のままか」は「直した後に実機の緑が観測されたか」に
 *   言い換えられる。ソースのハッシュが変わった瞬間、過去の緑を無効化することで
 *   機械的に測れる（`check-instrument-ran.mjs`が「4つ目の状態=走っていない」を
 *   同じ発想＝外に記録を置き常に前へ進むものと突き合わせる、で解いたのと同型）。
 *
 * ■ ★fail ではなく inconclusive(2) で鳴らす
 *   証明が足りないのは「測れていない」であって「壊れた」ではない
 *   （`check-instrument-ran.mjs`と同じ判断・掟⑥と同型）。fail は台帳が
 *   JSONとして壊れているときだけ。
 *
 * ■ ★所有だけでは検知の生死は分からない（README掟⑪の機械化）
 *   一度も赤になったことがない検査は「守られている」のか「一度も試されていない
 *   （＝壊れているものが来ても気づけない）」のか区別が付かない。実測で90日を超えて
 *   一度も実対象の赤を経験していなければ、それを inconclusive として明示する
 *   （「毒の設計が要る」という宿題を可視化するだけで、自動で毒を作ったりはしない
 *   ＝掟③「毒が本当に入ったか確認してから読む」に反しない。毒の設計は人が行う）。
 *
 * ■ 台帳の形式（.instrument-proof.json・リポ直下）
 *   {
 *     "schemaVersion": 1,
 *     "checks": {
 *       "scripts/verify-security-score.mjs": {
 *         "lastRealGreen": { "commit": "...", "at": "ISO8601", "sourceHash": "ab12..." },
 *         "lastRealRed":   { "commit": "...", "at": "ISO8601", "sourceHash": "ab12...", "detail": "..." }
 *       }
 *     }
 *   }
 *
 * ■ ★コメント除去の正規化は「配布境界」をまたがない
 *   `_docs/instruments/check-drift.mjs`（このキット自身専用・templates/配下ではない
 *   ＝配布先リポジトリには存在しない）の `codeOnly()` と同じロジックを、ここでも
 *   `codeOnly()` として持つ（意図的な重複・車輪の再発明ではない）。
 *   このファイル（`templates/scripts/lib/`）は配布物のため、配布先に存在しない
 *   ファイルへの import 依存を作ると配布先で壊れる。`instrument-core.mjs` と同じ
 *   「依存ゼロ・コピー1枚で動く」原則を優先し、2箇所で同じ正規化を独立に持つ。
 *   ★どちらかを変えたら、もう片方も見て揃える（自動同期の仕組みは無い）。
 * ───────────────────────────────────────────────────────────────────────────
 */
import { createHash } from 'node:crypto';

/**
 * ★コメント・文字列内は触らず、行コメント/ブロックコメント/空行だけ落とす。
 * `_docs/instruments/check-drift.mjs` の同名関数と同一ロジック（上記コメント参照）。
 * @param {string} text
 * @returns {string}
 */
export function codeOnly(text) {
  const noBlock = String(text || '').replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .filter((l) => l.trim() !== '')
    .map((l) => l.trimEnd())
    .join('\n');
}

/**
 * ★正規化済みソーステキストからハッシュを計算する（純関数）。
 * コメント除去は呼び出し側の責任（この import 内の `codeOnly()` を使う）。
 * @param {string} normalizedSourceText
 * @returns {string}
 */
export function hashSource(normalizedSourceText) {
  return createHash('sha256').update(String(normalizedSourceText || ''), 'utf8').digest('hex');
}

/**
 * @typedef {object} ProofEvent
 * @property {string} commit
 * @property {string} at ISO8601
 * @property {string} sourceHash
 * @property {string} [detail]
 */

/**
 * @typedef {object} ProofEntry
 * @property {ProofEvent} [lastRealGreen]
 * @property {ProofEvent} [lastRealRed]
 */

/**
 * ★証明3点の判定本体（純関数・fsに触らない＝テストしやすい）。
 *
 * @param {ProofEntry|undefined|null} entry 台帳の該当エントリ（無ければ undefined）
 * @param {string} currentSourceHash いま実行しているソースのhash
 * @param {{ nowMs?: number, staleGreenDays?: number, neverRedDays?: number }} [opts]
 * @returns {import('./instrument-core.mjs').ProbeResult}
 */
export function judgeProof(entry, currentSourceHash, opts = {}) {
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  // ★90日: README掟⑪の実測（計器100個・改善ゼロ）と揃え、日常のコミット速度なら
  //   何度か実対象を通過するはずの長さとして採用。呼び出し側で上書き可能。
  const neverRedDays = Number.isFinite(opts.neverRedDays) ? opts.neverRedDays : 90;

  if (!entry) {
    return {
      probe: '検査の証明3点',
      verdict: 'inconclusive',
      evidence: null,
      detail: '一度も実対象で走った記録がありません（★測っていないだけかもしれません）',
      howToFix: 'run-instruments.mjs 経由で実行し、report を record-instrument-proof.mjs に渡す',
      limitation: '★記録の有無だけを見ます。検査の中身が正しいかは見ません'
    };
  }

  const green = entry.lastRealGreen || null;
  const red = entry.lastRealRed || null;
  const hash = String(currentSourceHash || '');

  // ★#3の機械化: ソースが変わった後に緑が観測されていなければ、
  //   「直した後に実機で緑になった」証拠が無い＝緑ではない。
  if (!green || green.sourceHash !== hash) {
    return {
      probe: '検査の証明3点',
      verdict: 'inconclusive',
      evidence: green ? { 記録済みhash: green.sourceHash, 現在hash: hash } : null,
      detail: green
        ? '検査のソースを変更した後、実対象で緑になった記録がありません'
        : '実対象で緑になった記録が一度もありません',
      howToFix: 'run-instruments.mjs を通し、この検査が pass で終わるところまで確認する',
      limitation: '★ソースの一致はハッシュのみで見ます。挙動が同じでも1文字違えば別扱いです'
    };
  }

  // ★掟⑪の機械化: 一度も赤を経験していない検査は「守られている」か
  //   「試されていない」か区別が付かない。
  if (!red || red.sourceHash !== hash) {
    const greenAgeDays = Math.floor((nowMs - Date.parse(green.at)) / 86400000);
    if (!Number.isFinite(greenAgeDays) || greenAgeDays >= neverRedDays) {
      return {
        probe: '検査の証明3点',
        verdict: 'inconclusive',
        evidence: {
          最後に緑: green.commit ? green.commit.slice(0, 8) : null,
          緑からの日数: Number.isFinite(greenAgeDays) ? greenAgeDays : null,
          閾値日数: neverRedDays
        },
        detail: `${neverRedDays}日以上、実対象でこの検査が赤になったことがありません`
          + '（★悪いことではありませんが、検知が本当に効くかは未確認です）',
        howToFix: '意図的に壊れた状態を作って赤になるか確認する（selftestとは別に、実対象での毒の設計が要る）',
        limitation: '★赤の不在は「安全」の証拠ではなく「試されていない」の疑いです'
      };
    }
  }

  return {
    probe: '検査の証明3点',
    verdict: 'pass',
    evidence: {
      最後に緑: green.commit ? green.commit.slice(0, 8) : null,
      緑の時刻: green.at,
      最後に赤: red && red.sourceHash === hash && red.commit ? red.commit.slice(0, 8) : '(このhashでは未観測)',
      現在hash: hash.slice(0, 12)
    },
    limitation: '★実対象で赤・緑の両方を観測した記録があることだけを見ます。'
      + '検査ロジックそのものの正しさはselftestの責任です'
  };
}

/**
 * ★report（run-instruments.mjsの--report出力）1件の結果から、台帳を更新した新しい台帳を返す（純関数）。
 *
 * ★inconclusiveは記録しない（測れなかったを証明に混ぜない・掟⑤と同型）。
 *
 * @param {Record<string, ProofEntry>} checks 現在の台帳（checks部分）
 * @param {{ script: string, verdict: 'pass'|'fail'|'inconclusive' }} resultItem
 * @param {{ commit: string, at: string, sourceHash: string, detail?: string }} context
 * @returns {Record<string, ProofEntry>}
 */
export function applyProofUpdate(checks, resultItem, context) {
  const base = checks && typeof checks === 'object' ? { ...checks } : {};
  if (!resultItem || !resultItem.script) return base;
  if (resultItem.verdict !== 'pass' && resultItem.verdict !== 'fail') return base; // ★inconclusiveは書かない

  const key = String(resultItem.script);
  const prevEntry = base[key] || {};
  const event = {
    commit: String(context.commit || ''),
    at: String(context.at || new Date().toISOString()),
    sourceHash: String(context.sourceHash || '')
  };
  if (resultItem.verdict === 'fail' && context.detail) event.detail = String(context.detail);

  const nextEntry = { ...prevEntry };
  if (resultItem.verdict === 'pass') nextEntry.lastRealGreen = event;
  if (resultItem.verdict === 'fail') nextEntry.lastRealRed = event;

  base[key] = nextEntry;
  return base;
}

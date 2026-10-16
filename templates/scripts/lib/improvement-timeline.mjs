/**
 * improvement-timeline.mjs — ★「何が起きて・何をして・数字がどう動いたか」を1本の時系列にする純ロジック。
 *
 * ─────────────────────────────────────────────────
 * ■ なぜ要るか（2026-10-16、本人の要望:「何が起きて、なにをやったら改善したか・悪くなったか判断したい」）
 *   既存の台帳（improvement-ledger.mjs / improvement-history.mjs）は「数字が過去最良より悪くなったか」を
 *   判定できる。しかし行は version / metric / value / source だけで、★その数字を動かした【変更】が
 *   どこにも結び付いていない。実測: このキット自身の台帳は 8行・版は 0.1.0〜0.1.2 の3つだけ、
 *   コミットは 540件超。版が粗いので「どの変更で動いたか」が台帳からは分からない。
 *
 * ■ どう解くか（★台帳のスキーマは変えない＝配布先約45リポのコピーを更新しなくて済む）
 *   台帳の各行を【最初に書き足したコミット】を git から逆引きする。行はコードの変更と同じコミットで
 *   書き足される運用（record-improvement は commit 前に書く）なので、そのコミットが「この数字を測ったときの
 *   変更」を表す。前回の測定のコミット〜今回の測定のコミットの範囲が「その間にやったこと」になる。
 *   「何が起きたか」は、行に event があればそれ、無ければ note、それも無ければコミットの題。
 *
 * ■ ★この出力が言わないこと（過信を防ぐ）
 *   ・範囲内の変更の【全部】が原因とは限らない。★相関であって因果の証明ではない。
 *   ・コミットが特定できない行（未コミット・git なし）は★変更を推測で割り当てない（空にして理由を出す）。
 *   ・指標が未宣言／測れていない行は「改善」とも「悪化」とも言わない（改善の台帳と同じ掟）。
 *
 * ■ 設計の掟
 *   ・★判定は improvement-ledger.mjs の judgeImprovement を使う（方向は宣言から。数字から推測しない）。
 *   ・★git には触らない。コミット情報と変更一覧は【呼び手が関数で渡す】（テストできる・git なしでも動く）。
 *   ・依存ゼロ（improvement-ledger.mjs だけ）。移植はこの2ファイルのコピーで足りる。
 * ─────────────────────────────────────────────────
 */
import { judgeImprovement } from './improvement-ledger.mjs';

/** 台帳の行を見つけるための正規表現（record-improvement の書式 `version: 'x', metric: 'y'` に合わせる）。 */
const ROW_KEY = /version:\s*'([^']*)',\s*metric:\s*'([^']*)'/;

/**
 * `git log --reverse --format=%x1e%H%x1f%aI%x1f%s -p -- <台帳>` の出力から、
 * 「各 (version, metric) を最初に書き足したコミット」を取り出す。
 *
 * ★最初の出現を採る: 後から書式直しなどで同じ行が再登場しても、測定の時点を動かさない。
 * ★追加行（先頭が `+`、`+++` は除く）だけを見る。削除行や文脈行は数えない。
 *
 * @param {string} text git log の出力
 * @returns {Map<string, {sha:string, short:string, date:string, subject:string}>} key = `${version}\u0000${metric}`
 */
export function parseIntroducedRows(text) {
  /** @type {Map<string, {sha:string, short:string, date:string, subject:string}>} */
  const out = new Map();
  for (const rec of String(text || '').split('\u001e')) {
    if (!rec.trim()) continue;
    const nl = rec.indexOf('\n');
    const head = (nl >= 0 ? rec.slice(0, nl) : rec).split('\u001f');
    const sha = (head[0] || '').trim();
    if (!sha) continue;
    const info = { sha, short: sha.slice(0, 7), date: (head[1] || '').trim(), subject: (head[2] || '').trim() };
    const body = nl >= 0 ? rec.slice(nl + 1) : '';
    for (const line of body.split('\n')) {
      if (!line.startsWith('+') || line.startsWith('+++')) continue;
      const m = line.match(ROW_KEY);
      if (!m) continue;
      const key = `${m[1]}\u0000${m[2]}`;
      if (!out.has(key)) out.set(key, info);
    }
  }
  return out;
}

/** @param {unknown} v @returns {number|null} 数値だけ受ける（Number(null)===0 の穴を塞ぐ）。 */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * @typedef {object} TimelineEntry
 * @property {string} version
 * @property {number} value
 * @property {number|null} before 直前の測定値（初回は null）
 * @property {string|null} beforeVersion
 * @property {'improved'|'regressed'|'same'|'unknown'|'baseline'} direction
 * @property {boolean} accepted ★悪化だが note で理由が書かれている（過去最良は据え置き＝緩めていない）
 * @property {string} source
 * @property {string} note
 * @property {string} event 何が起きたか（行の event → note → コミットの題 の順）
 * @property {{sha:string, short:string, date:string, subject:string}|null} commit この行を台帳に書き足したコミット
 * @property {string[]} changes 前回の測定〜今回の測定の間にやったこと（コミットの題）
 * @property {boolean} traceable 変更を特定できたか（★false のとき changes を推測で埋めていない）
 */

/**
 * 台帳を指標ごとの時系列にし、各測定に「起きたこと」「やったこと」「前後の判定」を付ける。
 *
 * @param {object} args
 * @param {ReadonlyArray<{version?:string, metric?:string, value?:unknown, source?:string, note?:string, event?:string}>|null|undefined} args.history
 * @param {ReadonlyArray<{id:string, label:string, better:'lower'|'higher', unit:string}>} args.metrics
 * @param {(version:string, metric:string)=>({sha:string, short:string, date:string, subject:string}|null)} [args.commitOf] 行→コミット
 * @param {(fromSha:string, toSha:string)=>string[]} [args.changesBetween] 範囲内のコミットの題
 * @returns {{ metrics: {id:string, label:string, unit:string, better:string|null, entries:TimelineEntry[]}[],
 *            summary: {improved:number, regressed:number, accepted:number, same:number, unknown:number, baseline:number, untraceable:number} }}
 */
export function buildTimeline({ history, metrics, commitOf, changesBetween }) {
  const order = [];
  /** @type {Map<string, object[]>} */
  const byMetric = new Map();
  for (const raw of Array.isArray(history) ? history : []) {
    const row = raw && typeof raw === 'object' ? raw : {};
    const id = String(row.metric || '');
    if (!id || num(row.value) === null) continue; // ★測れていない行は載せない（0として扱わない）
    if (!byMetric.has(id)) { byMetric.set(id, []); order.push(id); }
    byMetric.get(id).push(row);
  }

  const summary = { improved: 0, regressed: 0, accepted: 0, same: 0, unknown: 0, baseline: 0, untraceable: 0 };
  const out = [];
  for (const id of order) {
    const spec = (Array.isArray(metrics) ? metrics : []).find((m) => m && String(m.id) === id) || null;
    /** @type {TimelineEntry[]} */
    const entries = [];
    let prev = null;
    let prevCommit = null;
    for (const row of byMetric.get(id)) {
      const version = String(row.version || '');
      const value = /** @type {number} */ (num(row.value));
      const commit = typeof commitOf === 'function' ? (commitOf(version, id) || null) : null;
      const note = typeof row.note === 'string' ? row.note.trim() : '';

      /** @type {TimelineEntry['direction']} */
      let direction = 'baseline';
      if (prev) {
        direction = judgeImprovement({ metric: id, before: prev.value, after: value }, metrics).direction;
      }
      const accepted = direction === 'regressed' && note !== '';

      let changes = [];
      let traceable = false;
      if (prev && commit && prevCommit && typeof changesBetween === 'function') {
        changes = changesBetween(prevCommit.sha, commit.sha) || [];
        traceable = true;
      } else if (!prev && commit) {
        traceable = true; // 初回は比較元が無い。変更の範囲は定義しない（空が正しい）。
      }

      entries.push({
        version, value,
        before: prev ? prev.value : null,
        beforeVersion: prev ? prev.version : null,
        direction, accepted,
        source: String(row.source || ''),
        note,
        event: (typeof row.event === 'string' && row.event.trim()) || note || (commit ? commit.subject : ''),
        commit, changes, traceable
      });

      summary[direction] += 1;
      if (accepted) summary.accepted += 1;
      if (prev && !traceable) summary.untraceable += 1;
      prev = { value, version };
      prevCommit = commit || prevCommit; // ★コミット不明の行をまたいでも、直近に分かっていた測定を比較元にする
    }
    out.push({
      id,
      label: spec ? spec.label : id,
      unit: spec ? spec.unit : '',
      better: spec ? spec.better : null,
      entries
    });
  }
  return { metrics: out, summary };
}

const VERDICT = {
  improved: '✅ 改善',
  regressed: '🔴 悪化',
  same: '⚪ 変化なし',
  unknown: '⚪ 判定できず',
  baseline: '・ 初回の測定'
};

/** Markdown の表セルに入れても崩れないようにする。 */
function cell(s) {
  return String(s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * 時系列を人が読む Markdown にする。
 * @param {ReturnType<typeof buildTimeline>} tl
 * @param {{limit?:number, maxChanges?:number}} [opts]
 * @returns {string}
 */
export function renderTimelineMarkdown(tl, { limit = 0, maxChanges = 5 } = {}) {
  const s = tl.summary;
  const lines = [];
  lines.push('# 改善のタイムライン（何が起きて・何をして・数字がどう動いたか）');
  lines.push('');
  lines.push('> 実測値の台帳と、各行を台帳に書き足したコミット（git）を突き合わせたものです。');
  lines.push('> ★「やったこと」は前回の測定〜今回の測定の間の変更の一覧で、**全部が原因とは限りません**（相関であって因果の証明ではない）。');
  lines.push('> ★コミットを特定できない行は、変更を推測で割り当てず空にして理由を出しています。');
  lines.push('');
  lines.push(`改善 ${s.improved} / 悪化 ${s.regressed}（うち理由つきで許容 ${s.accepted}） / 変化なし ${s.same} / 判定できず ${s.unknown} / 初回 ${s.baseline}`
    + (s.untraceable ? ` / ★変更を特定できなかった測定 ${s.untraceable}` : ''));

  if (tl.metrics.length === 0) {
    lines.push('');
    lines.push('まだ実測値の記録がありません（★指標を宣言して、record-improvement で記録してください）。');
    return lines.join('\n');
  }

  for (const m of tl.metrics) {
    const dir = m.better === 'lower' ? '小さいほど良い' : m.better === 'higher' ? '大きいほど良い' : '★未宣言（方向が決まらない）';
    lines.push('');
    lines.push(`## ${m.label}（${dir}${m.unit ? '・' + m.unit : ''}）`);
    lines.push('');
    lines.push('| 版 | 前 → 後 | 判定 | 起きたこと | やったこと（この測定までのコミット） |');
    lines.push('|---|---|---|---|---|');
    const shown = limit > 0 ? m.entries.slice(-limit) : m.entries;
    for (const e of shown) {
      const arrow = e.before === null ? `${e.value}${m.unit}` : `${e.before}${m.unit} → ${e.value}${m.unit}`;
      const verdict = e.direction === 'regressed' && e.accepted ? '🟡 悪化（理由つきで許容）' : VERDICT[e.direction];
      let did;
      if (e.direction === 'baseline') did = e.commit ? `（初回。${e.commit.short}）` : '（初回）';
      else if (!e.traceable) did = '★変更を特定できません（コミットが分からない／未コミットの測定）';
      else if (e.changes.length === 0) did = '（間にコミットなし）';
      else {
        const head = e.changes.slice(0, maxChanges).join(' / ');
        did = e.changes.length > maxChanges ? `${head} …ほか${e.changes.length - maxChanges}件` : head;
      }
      lines.push(`| ${cell(e.version)} | ${cell(arrow)} | ${verdict} | ${cell(e.event)} | ${cell(did)} |`);
    }
    if (limit > 0 && m.entries.length > limit) lines.push(`\n（古い ${m.entries.length - limit} 件は省略。--limit 0 で全件）`);
  }
  return lines.join('\n');
}

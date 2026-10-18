// @ts-check
/**
 * loop-run-core.mjs — 自己改善ループのランナー（loop-run.mjs）の判断部分（純関数）。
 *
 * 役割: 「今回、AIに提案を書かせるか」を決める。IO（コマンド実行・ファイル）は loop-run.mjs。設計: _docs/DESIGN-self-improvement-loop-2026-10-18.md §2・§4 部品5・§8。
 * 判断の原則:
 *   - 症状（verdict が fail か warn）が1つも無ければ、AIを呼ばない（コストも、無駄な提案も出さない）。unmeasured だけでは症状とは見なさない（件数は報告する）
 *   - 同じ症状の組み合わせ（署名）の提案が、すでに台帳にあれば、重複として止める。ただし「効果なし（no_effect）」になったものだけは、直らなかったので新しい提案を許す
 *   - 判断は機械が決める。AIの出力や人間の記憶に頼らない
 * 限界: 署名は症状IDの集合だけ。同じIDでも原因が違う可能性は見ない（人間が state を消すか --force で再提案させる）。
 */
import { stateOf } from './loop-ledger-core.mjs';

/** 症状と見なす verdict。 */
export const SYMPTOM_VERDICTS = Object.freeze(['fail', 'warn']);

/**
 * 症状カードの集合の署名（症状IDをソートして連結）。症状が無ければ空文字。
 * @param {Array<Record<string, any>>} cards
 */
export function symptomSignature(cards) {
  return cards.filter((c) => SYMPTOM_VERDICTS.includes(c.verdict)).map((c) => String(c.id)).sort().join('+');
}

/**
 * @param {{ cards: Array<Record<string, any>>, ledger: Array<Record<string, any>>, state: { bySignature?: Record<string, string> }, force?: boolean }} p
 * @returns {{ action: 'propose' | 'no-symptoms' | 'skip-duplicate', signature: string, reason: string, proposal?: string }}
 */
export function decideAction({ cards, ledger, state, force = false }) {
  const signature = symptomSignature(cards);
  if (signature === '') {
    const unm = cards.filter((c) => c.verdict === 'unmeasured').length;
    return { action: 'no-symptoms', signature, reason: unm > 0 ? `症状なし（測れていないカードが${unm}枚ある。緑ではない）` : '症状なし' };
  }
  const prior = state.bySignature?.[signature];
  if (prior && !force) {
    const st = stateOf(ledger, prior);
    if (st !== 'no_effect') {
      return { action: 'skip-duplicate', signature, proposal: prior, reason: `同じ症状の提案がある（${prior}・状態: ${st ?? '台帳に無い'}）` };
    }
  }
  return { action: 'propose', signature, reason: prior ? `前の提案（${prior}）は効果なし。新しく提案する` : '新しい症状の組み合わせ' };
}

/**
 * 人間向けの受信箱（INBOX.md）に追記する1件。URL・本文・データは載せず、提案書の場所と症状IDだけ。
 * @param {{ at: string, project: string, action: string, reason: string, proposalPath?: string, signature: string }} p
 */
export function formatInboxEntry({ at, project, action, reason, proposalPath, signature }) {
  const lines = [`## ${at} ${project}: ${action}`, `- 理由: ${reason}`];
  if (signature) lines.push(`- 症状: ${signature}`);
  if (proposalPath) lines.push(`- 提案書: ${proposalPath}`, '- 次: 読んで、承認・却下・保留を **自分のターミナルで** 台帳に記録する（record-loop-decision.mjs --decision approved|rejected|deferred --by human:<名前> --reason "…"）');
  return lines.join('\n') + '\n\n';
}

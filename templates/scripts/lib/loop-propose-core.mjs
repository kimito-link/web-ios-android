// @ts-check
/**
 * loop-propose-core.mjs — 自己改善ループ第5歩（ローカルAIに提案書を書かせる）の純関数部分。
 *
 * 役割: プロンプトの組み立て・モデル出力の整形・ヘッダーの機械付与・ローカル宛て以外の拒否。IO（HTTP・ファイル）は loop-propose.mjs。
 *   設計: _docs/DESIGN-self-improvement-loop-2026-10-18.md §2-3・§3（外部AIへは渡さない）・§4 部品5。
 * 設計判断: **機械でできる部分は機械に任せる**。提案書のヘッダー（schema・proposal・project・cards・writer）はこのコードが付け、
 *   モデルには5つの節の本文だけを書かせる（ヘッダーの書き間違いで落ちる率をゼロにする。検査 proposal-format-core が最後に全体を確かめる）。
 * 守ること: (1) 送り先は 127.0.0.1 / localhost / [::1] だけ（assertLocalUrl・外へ出る経路を構造的に作らない）
 *   (2) AIには症状カード（検査済みの数値だけ）以外を渡さない (3) モデルの出力は「仮説」。検査を通っても内容が正しいとは限らない。
 */
import { SECTIONS } from './proposal-format-core.mjs';

/** 送り先がローカルであることを保証する。違えば例外（fail-closed）。 @param {string} url */
export function assertLocalUrl(url) {
  /** @type {URL} */
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error('送り先のURLが読めない');
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('送り先がローカル(127.0.0.1)ではない。外部へは送らない');
  }
  return u;
}

const SYSTEM = [
  'あなたは、プログラムの不具合の原因を調べる助手です。症状カード（機械が集めた数値）だけを根拠に、提案書の本文を日本語のMarkdownで書きます。',
  '守ること:',
  '- 出力は、次の5つの見出しだけをこの順で書く: ' + SECTIONS.map((s) => `## ${s}`).join(' / ') + '。ほかの見出し・前置き・あとがき・コードブロックの囲みは書かない。',
  '- 観測には、症状カードにある数字だけを使う。カードにない数字を作らない。',
  '- 原因仮説は「- 」で始まる項目にし、各項目に【確証】か【推測】のどちらかの印を付け、「確度: 高/中/低」と「反証: （それが違うと分かる実験）」を必ず書く。',
  '- 【確証】は、カードの数値で直接言えることだけ。その項目に「根拠: card:<カードのid>」を書く。それ以外は【推測】にする。',
  '- 版の提案には「- 変更: （1行だけ。1つの変更）」「- 触るファイル候補: …」「- やらないこと: …」を書く。変更を2つ以上書かない。',
  '- 個人名・メールアドレス・URL・鍵・コメントの内容は、書かない（カードにも無いはずです）。',
].join('\n');

/** 用語集（症状IDの意味など、プロジェクトが持つ固定の説明）の上限。データではなく知識なので、カードとは別に渡す。 */
export const MAX_GLOSSARY_BYTES = 4096;
/** 用語集に入れてはいけない形（秘密・メール）。個人のデータを知識に紛れさせない。 */
const GLOSSARY_BAD = [/sk-[A-Za-z0-9]{8,}/, /\bBearer\s+\S+/i, /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(KEY|TOKEN|SECRET|PASSWORD)\b/, /[^\s@]+@[^\s@]+\.[^\s@]+/];

/** 用語集を検査する。問題があれば例外（値は出さない）。 @param {string} text */
export function assertGlossary(text) {
  if (Buffer.byteLength(text) > MAX_GLOSSARY_BYTES) throw new Error('用語集が大きすぎる');
  if (GLOSSARY_BAD.some((re) => re.test(text))) throw new Error('用語集に秘密・メールらしき形がある');
}

/**
 * @param {{ cards: Array<Record<string, any>>, glossary?: string }} p
 * @returns {{ system: string, user: string }}
 */
export function buildPrompt({ cards, glossary }) {
  if (glossary) assertGlossary(glossary);
  const ids = cards.map((c) => c.id).join(', ');
  const skeleton = [
    '## 症状', '（何が起きているかを1〜2文）', '',
    '## 観測', '（カードの数字だけを使って事実を書く）', '',
    '## 原因仮説',
    '- 【推測】（原因の仮説）。確度: 中。反証: （この実験で違うと分かる）',
    '- 【確証】（カードの数値で直接言えること）。確度: 高。根拠: card:' + (cards[0]?.id ?? '<id>') + '。反証: （…）', '',
    '## 版の提案', '- 変更: （1つだけ）', '- 触るファイル候補: （ファイルやモジュール名）', '- やらないこと: （今回触らない範囲）', '',
    '## 検証手順', '（直ったかを、どの実測で確かめるか）',
  ].join('\n');
  const user = [
    ...(glossary ? ['このプロジェクトの用語集（症状IDの意味。固定の説明で、データではありません）:', glossary.trim(), ''] : []),
    `症状カード（id: ${ids}）:`,
    '```json',
    JSON.stringify(cards, null, 2),
    '```',
    '',
    '次の型に沿って、提案書の本文だけを書いてください（括弧の説明は置き換える）:',
    skeleton,
  ].join('\n');
  return { system: SYSTEM, user };
}

/**
 * モデルの生の出力から、提案書の本文（"## 症状" から先）を取り出す。思考ブロック・コードの囲み・前置きを落とす。
 * @param {string} raw
 */
export function extractBody(raw) {
  let t = String(raw ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/g, '');
  t = t.replace(/^```(?:markdown|md)?\s*\n/gm, '').replace(/^```\s*$/gm, '');
  const i = t.search(/^## 症状\s*$/m);
  return (i === -1 ? t : t.slice(i)).trim();
}

/**
 * ヘッダー（機械が付ける）＋本文で提案書を組む。
 * @param {{ proposalId: string, project: string, cardIds: string[], writer: string, body: string }} p
 */
export function assembleProposal({ proposalId, project, cardIds, writer, body }) {
  return ['schema: 1', `proposal: ${proposalId}`, `project: ${project}`, `cards: ${cardIds.join(', ')}`, `writer: ${writer}`, '', body, ''].join('\n');
}

/** モデル名を writer 欄に載せられる形にする（`ai:` + 英数と . _ -）。 @param {string} model */
export function writerOf(model) {
  return 'ai:' + String(model).replace(/[^A-Za-z0-9_.-]/g, '-').replace(/^-+/, '').slice(0, 63);
}

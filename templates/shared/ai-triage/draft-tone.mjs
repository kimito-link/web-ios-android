#!/usr/bin/env node
/**
 * draft-tone.mjs — 返信下書き生成のトーン定義。外部依存ゼロ。
 *
 * 抽出元: henshin-hisho/backend/src/draft-gen.js の `DRAFT_TONE_INSTRUCTIONS` / `pickTone`。
 * 同一定義（日本語の指示文まで完全一致）が gmail-secretary-extension/sw/features/gmail-inbox/
 * draft-gen.js（`GMAIL_DRAFT_TONE_INSTRUCTIONS`）にも別々にコピーされ、コピー後に片方だけ
 * 修正が入って乖離が進んでいた（2026-09-08発見。詳細は
 * web-ios-android/_docs/DESIGN-ai-triage-shared-module-2026-09-08.md）。
 *
 * プロンプト構築本体（buildDraftPrompt等）はaccountPolicy等の各リポジトリ固有ロジックと
 * 密結合しているため共通化の対象外。このIssueのスコープでは import への差し替えは行わない。
 */

export const DRAFT_TONE_INSTRUCTIONS = Object.freeze({
  polite: '丁寧に',
  firm: 'はっきり強めに、ただし攻撃的にしない',
  calm: '冷静に感情を抑えて',
  casual: 'いつもの砕けた調子で'
});

/**
 * 未知の値・未指定は既定の 'polite' にフォールバックする。
 *
 * @param {string} value
 * @returns {'polite' | 'firm' | 'calm' | 'casual'}
 */
export function pickTone(value) {
  return Object.prototype.hasOwnProperty.call(DRAFT_TONE_INSTRUCTIONS, value) ? value : 'polite';
}

/** ★自分自身を毒（未知の値・undefined等）で試す。サボると赤くなることを確かめる。 */
function runSelftest() {
  const fails = [];

  // ① 既知のトーンはそのまま通ること
  for (const tone of Object.keys(DRAFT_TONE_INSTRUCTIONS)) {
    if (pickTone(tone) !== tone) fails.push(`★既知のトーン ${tone} を通せない`);
  }

  // ② 未知の値は 'polite' にフォールバックすること
  if (pickTone('angry') !== 'polite') fails.push('★未知の値をpoliteにフォールバックできない');
  if (pickTone(undefined) !== 'polite') fails.push('★undefinedをpoliteにフォールバックできない');
  if (pickTone('') !== 'polite') fails.push('★空文字をpoliteにフォールバックできない');

  // ③ 定義がfreezeされていて書き換えられないこと(呼び出し元が誤って書き換える事故を防ぐ)
  if (!Object.isFrozen(DRAFT_TONE_INSTRUCTIONS)) fails.push('★DRAFT_TONE_INSTRUCTIONSがfreezeされていない');

  // ④ 4種類の定義内容が変わっていないこと(移植元との一致確認)
  const expected = {
    polite: '丁寧に',
    firm: 'はっきり強めに、ただし攻撃的にしない',
    calm: '冷静に感情を抑えて',
    casual: 'いつもの砕けた調子で'
  };
  for (const [tone, label] of Object.entries(expected)) {
    if (DRAFT_TONE_INSTRUCTIONS[tone] !== label) fails.push(`★${tone}の指示文が移植元と一致しない`);
  }

  if (fails.length) {
    console.error('[draft-tone] ★selftest 失敗:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log('[draft-tone] selftest OK(4トーン一致/未知の値のフォールバック/freeze済み)');
  process.exit(0);
}

if (process.argv.includes('--selftest')) {
  runSelftest();
}

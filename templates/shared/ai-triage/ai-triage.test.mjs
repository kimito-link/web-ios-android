// templates/shared/ai-triage/ai-triage.test.mjs
//
// json-repair.mjs と draft-tone.mjs の動作確認テスト。
// 何を守るか:
//   1. 正常なJSON・前後に説明文やコードフェンスがついたJSON・途中で切れたJSONの修復と抽出が正しく動くこと
//   2. isRescueNeeded が failed または repaired+unknown のときだけ true を返すこと
//   3. DRAFT_TONE_INSTRUCTIONS が凍結(freeze)されており、pickTone が既知の4トーンだけを通し未知の入力は polite に倒すこと
//   4. 2つの共有ファイルが外部依存ゼロ（import 文を含まない）の契約を守っていること

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  scanJsonFragment,
  closeOpenJsonStructures,
  canParseJson,
  repairCandidate,
  repairTruncatedJson,
  extractTriageJson,
  isRescueNeeded
} from './json-repair.mjs';
import {
  DRAFT_TONE_INSTRUCTIONS,
  pickTone
} from './draft-tone.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));

test('scanJsonFragment: 文字列の状態・未閉じ括弧のスタック・カンマ位置を追跡する', () => {
  const s1 = scanJsonFragment('{"a": [1, 2');
  assert.equal(s1.inString, false);
  assert.deepEqual(s1.stack, ['{', '[']);
  assert.equal(s1.commas.length, 1);

  const s2 = scanJsonFragment('{"a": "hello, \\"world');
  assert.equal(s2.inString, true);
  assert.deepEqual(s2.stack, ['{']);
  assert.deepEqual(s2.commas, [], '文字列内のカンマは数えない');
});

test('closeOpenJsonStructures: 未閉じの文字列と括弧を閉じる', () => {
  assert.equal(closeOpenJsonStructures('{"a":"hello'), '{"a":"hello"}');
  assert.equal(closeOpenJsonStructures('{"a":[1,{"b":"x'), '{"a":[1,{"b":"x"}]}');
});

test('canParseJson: JSONとして読めるか判定する', () => {
  assert.equal(canParseJson('{"ok":true}'), true);
  assert.equal(canParseJson('{"ok":'), false);
  assert.equal(canParseJson('not json'), false);
});

test('repairCandidate / repairTruncatedJson: 末尾カンマやコロンで切れたJSONを修復する', () => {
  const trailingComma = '{"category":"support","priority":"normal",';
  const r1 = repairCandidate(trailingComma);
  assert.equal(canParseJson(r1), true);
  assert.deepEqual(JSON.parse(r1), { category: 'support', priority: 'normal' });

  const trailingColon = '{"category":"support","priority":';
  const r2 = repairTruncatedJson(trailingColon);
  assert.notEqual(r2, null);
  assert.deepEqual(JSON.parse(r2), { category: 'support' });

  const truncatedInValue = '{"category":"support","summary":"途中で切れた要';
  const r3 = repairTruncatedJson(truncatedInValue);
  assert.notEqual(r3, null);
  assert.deepEqual(JSON.parse(r3), { category: 'support', summary: '途中で切れた要' });

  assert.equal(repairTruncatedJson('completely broken {{{ :'), null);
});

test('extractTriageJson: 正常・前後ノイズ付き・途中切れ・失敗の4パターンを処理する', () => {
  const clean = extractTriageJson('{"category":"support","priority":"high"}');
  assert.equal(clean.status, 'ok');
  assert.deepEqual(clean.data, { category: 'support', priority: 'high' });

  const fenced = extractTriageJson('```json\n{"category":"invoice"}\n```\n補足説明');
  assert.equal(fenced.status, 'ok');
  assert.deepEqual(fenced.data, { category: 'invoice' });

  const truncated = extractTriageJson('{"category":"legal","riskLevel":"high","summary":"途中');
  assert.equal(truncated.status, 'repaired');
  assert.equal(truncated.data.category, 'legal');
  assert.equal(truncated.data.riskLevel, 'high');
  assert.equal(truncated.data.summary, '途中');

  assert.deepEqual(extractTriageJson(''), { data: {}, status: 'failed' });
  assert.deepEqual(extractTriageJson('JSONが含まれない応答'), { data: {}, status: 'failed' });
});

test('isRescueNeeded: failed または repaired かつ unknown のときだけ true を返す', () => {
  assert.equal(isRescueNeeded({ parseStatus: 'failed', category: 'support' }), true);
  assert.equal(isRescueNeeded({ parseStatus: 'repaired', category: 'unknown' }), true);
  assert.equal(isRescueNeeded({ parseStatus: 'repaired', category: 'support' }), false);
  assert.equal(isRescueNeeded({ parseStatus: 'ok', category: 'unknown' }), false);
  assert.equal(isRescueNeeded({}), false);
});

test('DRAFT_TONE_INSTRUCTIONS / pickTone: 4種のトーン定義とフォールバック', () => {
  assert.equal(Object.isFrozen(DRAFT_TONE_INSTRUCTIONS), true);
  assert.deepEqual(DRAFT_TONE_INSTRUCTIONS, {
    polite: '丁寧に',
    firm: 'はっきり強めに、ただし攻撃的にしない',
    calm: '冷静に感情を抑えて',
    casual: 'いつもの砕けた調子で'
  });

  assert.equal(pickTone('polite'), 'polite');
  assert.equal(pickTone('firm'), 'firm');
  assert.equal(pickTone('calm'), 'calm');
  assert.equal(pickTone('casual'), 'casual');
  assert.equal(pickTone('unknown_tone'), 'polite');
  assert.equal(pickTone('toString'), 'polite', 'Object.prototype のプロパティ名に騙されない');
  assert.equal(pickTone(undefined), 'polite');
  assert.equal(pickTone(null), 'polite');
});

test('外部依存ゼロ契約: json-repair.mjs と draft-tone.mjs に import 文が無い', () => {
  for (const name of ['json-repair.mjs', 'draft-tone.mjs']) {
    const src = readFileSync(`${HERE}${name}`, 'utf8');
    const codeLines = src
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('//'));
    for (const line of codeLines) {
      assert.equal(/\bimport\b/.test(line), false, `${name} に import 文が含まれています: ${line}`);
    }
  }
});

#!/usr/bin/env node
/**
 * json-repair.mjs — AI応答のJSONが途中で切れた場合に修復する、外部依存ゼロの純粋関数群。
 *
 * 抽出元: henshin-hisho/backend/src/triage.js（scanJsonFragment〜extractTriageJson）。
 * 同一ロジックが gmail-secretary-extension/sw/features/gmail-inbox/triage.js にも
 * 別々にコピーされ、コピー後に片方だけバグ修正・機能追加が入って乖離が進んでいた
 * （2026-09-08発見。詳細は web-ios-android/_docs/DESIGN-ai-triage-shared-module-2026-09-08.md）。
 * 各リポジトリの実行環境（Cloudflare Workers / Chrome拡張 service worker）の
 * どちらからも import できるよう、外部依存を持たない純粋関数のみを置く契約。
 *
 * このIssueのスコープでは import への差し替えは行わない（別Issue）。
 */

/**
 * テキストをスキャンし、文字列内かどうか・開いたまま閉じられていない
 * `{`/`[` のスタック・トップレベルのカンマ位置一覧を返す。
 *
 * @param {string} text
 * @returns {{ inString: boolean, stack: string[], commas: number[] }}
 */
export function scanJsonFragment(text) {
  let inString = false;
  let escaped = false;
  const stack = [];
  const commas = [];

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' && stack[stack.length - 1] === '{') stack.pop();
    else if (ch === ']' && stack[stack.length - 1] === '[') stack.pop();
    else if (ch === ',') commas.push(i);
  }
  return { inString, stack, commas };
}

/**
 * 開いたままの文字列・構造（`{`/`[`）を閉じて返す。
 *
 * @param {string} text
 * @returns {string}
 */
export function closeOpenJsonStructures(text) {
  let repaired = String(text || '').replace(/[ \t\r\n]+$/, '');
  let state = scanJsonFragment(repaired);
  if (state.inString) repaired += '"';
  state = scanJsonFragment(repaired);
  while (state.stack.length) repaired += state.stack.pop() === '{' ? '}' : ']';
  return repaired;
}

/**
 * `JSON.parse` が通るかどうかだけを真偽値で返す。
 *
 * @param {string} text
 * @returns {boolean}
 */
export function canParseJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 末尾のカンマ・コロンなど、閉じる前に邪魔になる断片を落としてから閉じる。
 *
 * @param {string} fragment
 * @returns {string}
 */
export function repairCandidate(fragment) {
  let repaired = String(fragment || '').replace(/[ \t\r\n]+$/, '');
  const state = scanJsonFragment(repaired);
  if (!state.inString) {
    const trimmed = repaired.replace(/[ \t\r\n]+$/, '');
    if (trimmed.endsWith(',')) {
      repaired = trimmed.slice(0, -1).replace(/[ \t\r\n]+$/, '');
    } else if (trimmed.endsWith(':')) {
      const lastComma = state.commas[state.commas.length - 1];
      if (Number.isFinite(lastComma)) repaired = repaired.slice(0, lastComma).replace(/[ \t\r\n]+$/, '');
    }
  }
  return closeOpenJsonStructures(repaired);
}

/**
 * 途中で切れたJSON断片を、末尾のトップレベルカンマまで巻き戻しながら
 * パース可能になるまで繰り返し修復を試みる。
 *
 * @param {string} fragment
 * @returns {string | null} 修復に成功した文字列。諦めた場合は null。
 */
export function repairTruncatedJson(fragment) {
  let candidate = String(fragment || '');
  for (let i = 0; i < 12; i += 1) {
    const repaired = repairCandidate(candidate);
    if (canParseJson(repaired)) return repaired;
    const state = scanJsonFragment(candidate);
    const lastComma = state.commas[state.commas.length - 1];
    if (!Number.isFinite(lastComma) || lastComma <= 0) break;
    candidate = candidate.slice(0, lastComma);
  }
  return null;
}

/**
 * AIの応答文字列からJSONオブジェクトを取り出す。素直にパースできればそのまま、
 * だめなら末尾の `}` までの切り出し、それでもだめなら {@link repairTruncatedJson} で
 * 修復してから返す。
 *
 * @param {string} value
 * @returns {{ data: object, status: 'ok' | 'repaired' | 'failed' }}
 */
export function extractTriageJson(value) {
  const raw = String(value || '').trim();
  if (!raw) return { data: {}, status: 'failed' };
  const start = raw.indexOf('{');
  if (start < 0) return { data: {}, status: 'failed' };

  try {
    return { data: JSON.parse(raw), status: 'ok' };
  } catch {
    const end = raw.lastIndexOf('}');
    if (end > start) {
      try {
        return { data: JSON.parse(raw.slice(start, end + 1)), status: 'ok' };
      } catch {
        // Try truncated JSON repair below.
      }
    }
  }

  const repaired = repairTruncatedJson(raw.slice(start));
  if (repaired !== null) {
    try {
      return { data: JSON.parse(repaired), status: 'repaired' };
    } catch {
      // Fall through.
    }
  }
  return { data: {}, status: 'failed' };
}

/** ★自分自身を毒（途中で切れたJSON等）で試す。サボると赤くなることを確かめる。 */
function runSelftest() {
  const fails = [];

  // ① 正常なJSONはそのまま通ること
  {
    const { data, status } = extractTriageJson('{"a":1,"b":"x"}');
    if (status !== 'ok' || data.a !== 1 || data.b !== 'x') fails.push('★正常なJSONを ok で通せない');
  }

  // ② 文字列が途中で切れたケース(閉じ引用符・閉じ括弧が無い)
  {
    const { data, status } = extractTriageJson('{"category":"support","summary":"問い合わせ内容を確認し');
    if (status !== 'repaired' || data.category !== 'support') fails.push('★途中で切れた文字列値を復元できない');
  }

  // ③ 配列の途中、末尾カンマで切れたケース
  {
    const { data, status } = extractTriageJson('{"warnings":["a","b",');
    if (status !== 'repaired' || !Array.isArray(data.warnings) || data.warnings.length !== 2) {
      fails.push('★末尾カンマ付き配列を復元できない');
    }
  }

  // ④ キーの後、コロンで切れたケース(値が無い)
  {
    const repaired = repairCandidate('{"a":1,"b":');
    if (!canParseJson(repaired)) fails.push('★コロンで切れた断片を復元できない');
  }

  // ⑤ 前後に説明文が付いたケース(コードフェンス等)は先頭の { から拾う
  {
    const { data, status } = extractTriageJson('```json\n{"a":1}\n```');
    if (status !== 'ok' || data.a !== 1) fails.push('★前後の説明文を剥がせない');
  }

  // ⑥ 空文字・{ を含まない入力は failed になること(暴走して例外を投げない)
  {
    if (extractTriageJson('').status !== 'failed') fails.push('★空文字を failed にできない');
    if (extractTriageJson('no json here').status !== 'failed') fails.push('★{ を含まない入力を failed にできない');
  }

  // ⑦ scanJsonFragment が文字列内の { や , を構造として誤認しないこと
  {
    const { stack, commas } = scanJsonFragment('{"a":"x,{y"}');
    if (stack.length !== 0 || commas.length !== 0) fails.push('★文字列内の記号を構造だと誤認している');
  }

  if (fails.length) {
    console.error('[json-repair] ★selftest 失敗:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log('[json-repair] selftest OK(正常系/途中切断/前後説明文/空入力のいずれも想定通り)');
  process.exit(0);
}

if (process.argv.includes('--selftest')) {
  runSelftest();
}

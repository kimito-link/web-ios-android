#!/usr/bin/env node
// PreToolUse(AskUserQuestion) ガード。非ブロッキング警告のみ(fail-open)。
//
// CLAUDE.md「あらゆる調査を尽くす」節(2026-09-24確立)は、AskUserQuestionで
// 選択肢を出す前にGrep/Glob/WebFetch/WebSearch/Agentで調査したかを自問せよ
// と定める。だがこれは文章のルールのままで、機械検査が伴っていなかった
// (このキット自身の実損: Cloudflareトークン操作を拒否された際、代替手段を
// 1つも試さず即座に人間へ判断を投げ返した)。
//
// このhookは「調査ツールを呼んだ回数」という客観的事実だけを検出する
// (call-before-ask heuristic。詳細: ../../_docs/DESIGN-claude-md-decay-2026-09-24.md)。
// 「調査の質」「本当に調べ尽くしたか」は意味判断であり検出できない
// (偽陽性: 無関係な調査を数回叩けば通過する。偽陰性: 正当に「事実として
// 存在しない」と判断した質問でも、調査回数が少なければ警告が出る)。
// この限界ゆえブロックしない — permissionDecisionは常にallowで、
// statusMessageで気づきを促すだけに留める。
//
// ★2026-09-28追加: 設計方針キーワード検査(soushin-suggest.link実損)。
//   CLAUDE.md「選択肢を出して止まらない」節は、「CVR/LTV最大化」「100年
//   メンテナンスのいらない設計」を**自分で判断に迷ったときに使う判定基準**
//   として定めている。ところが実損では、この基準そのもの（「100年後安心
//   できる設計」）をAskUserQuestionの選択肢ラベルとして人間に提示していた
//   ——判定基準を、判定基準を使って自分で決めるべき場面で、選択肢に
//   すり替えてしまった。これは「選択肢の文言に設計方針キーワードが
//   含まれるか」という客観的事実（文字列マッチ）で検出できる。
//   意味判断（「本当にユーザーの決定が必要か」）は検出できないが、
//   このキーワード自体が選択肢に出てくること自体が強いシグナルであるため、
//   「無理に自動化しない」対象ではなく機械化する（指摘を受けて即日実装）。
const DESIGN_PRINCIPLE_KEYWORDS = [
  '100年', 'CVR', 'LTV', 'メンテナンスフリー', 'メンテナンスのいらない',
];

import { readFileSync, existsSync } from 'node:fs';

const RESEARCH_TOOLS = new Set(['Grep', 'Glob', 'WebFetch', 'WebSearch', 'Agent', 'Task']);
const LOOKBACK_TOOL_USES = 20;

function normalizeWindowsPath(p) {
  if (process.platform !== 'win32' || typeof p !== 'string') return p;
  const m = /^\/([a-zA-Z])\/(.*)$/.exec(p);
  if (m) return `${m[1]}:\\${m[2].replace(/\//g, '\\')}`;
  return p;
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// transcriptの末尾からさかのぼり、直近N回のtool_use名を集める。
// AskUserQuestion自身の呼び出しはまだtranscriptに記録されていない
// (これから呼ばれる番なので)、そのまま末尾から数えればよい。
function collectRecentToolNames(transcriptPathRaw, limit) {
  const transcriptPath = normalizeWindowsPath(transcriptPathRaw);
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  let raw;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return [];
  }

  const names = [];
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0 && names.length < limit; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const content = entry && entry.message ? entry.message.content : null;
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0 && names.length < limit; j--) {
      const block = content[j];
      if (block && block.type === 'tool_use' && typeof block.name === 'string') {
        names.push(block.name);
      }
    }
  }
  return names;
}

// AskUserQuestionのtool_inputから、question・header・options[].label・
// options[].descriptionのテキストを全て集め、設計方針キーワードを含むかを見る。
// 大文字小文字は区別しない(CVR/LTVは英字表記されうるため)。
function extractQuestionTexts(toolInput) {
  const texts = [];
  const questions = toolInput && Array.isArray(toolInput.questions) ? toolInput.questions : [];
  for (const q of questions) {
    if (typeof q.question === 'string') texts.push(q.question);
    if (typeof q.header === 'string') texts.push(q.header);
    const options = Array.isArray(q.options) ? q.options : [];
    for (const o of options) {
      if (typeof o.label === 'string') texts.push(o.label);
      if (typeof o.description === 'string') texts.push(o.description);
    }
  }
  return texts;
}

function findDesignPrincipleKeyword(texts) {
  for (const text of texts) {
    for (const keyword of DESIGN_PRINCIPLE_KEYWORDS) {
      if (text.toUpperCase().includes(keyword.toUpperCase())) return keyword;
    }
  }
  return null;
}

function main() {
  const stdin = readStdin();
  let input;
  try {
    input = JSON.parse(stdin);
  } catch {
    process.exit(0);
  }

  if (input.tool_name !== 'AskUserQuestion') {
    process.exit(0);
  }

  const messages = [];

  // 検査1: 設計方針キーワードが選択肢に紛れ込んでいないか（調査の有無を問わず常に見る）。
  const questionTexts = extractQuestionTexts(input.tool_input);
  const matchedKeyword = findDesignPrincipleKeyword(questionTexts);
  if (matchedKeyword) {
    messages.push(
      '★この質問の選択肢/説明文に設計方針キーワード「' + matchedKeyword + '」が含まれています。' +
      'CLAUDE.md「選択肢を出して止まらない」節は、CVR/LTV最大化・100年メンテナンスのいらない設計を' +
      '「自分で判断に迷ったときに、確認を取らず自分で決める判定基準」と定めています。' +
      '判定基準そのものを選択肢として人間に投げるのは、この基準の趣旨と逆です' +
      '（2026-09-28、soushin-suggest.linkの実損）。'
    );
  }

  // 検査2: 直近に調査ツールを呼んだか（call-before-ask heuristic）。
  const recentNames = collectRecentToolNames(input.transcript_path, LOOKBACK_TOOL_USES);
  const hasResearch = recentNames.some((name) => RESEARCH_TOOLS.has(name));
  if (!hasResearch) {
    messages.push(
      '★直近' + LOOKBACK_TOOL_USES + '回のツール呼び出しにGrep/Glob/WebFetch/WebSearch/Agentが見当たりません。' +
      'CLAUDE.md「あらゆる調査を尽くす」の4項目を確認しましたか（調べようがない事実だけを聞く場面なら無視してよい）。'
    );
  }

  if (messages.length === 0) {
    process.exit(0);
  }

  // 非ブロッキング: permissionDecisionは明示的にallow、systemMessageで
  // モデルのコンテキストへ警告を注入する(statusMessageはスピナー表示用の
  // 別フィールドで、モデルには渡らない — 実装前にclaude-code-guideサブ
  // エージェントで公式仕様を裏取り済み)。
  // fail-open — このhook自体が壊れていても質問をブロックしてはいけない。
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      systemMessage: messages.join(' '),
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main();

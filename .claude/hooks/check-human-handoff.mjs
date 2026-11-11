#!/usr/bin/env node
// PreToolUse ガード（拒否・fail-open）: 人に「コマンドを貼って実行して」「画面を送って」と頼む文を、
// 理由の一行なしでは送らせない。正本: docs/ai-rules/08_NO_HUMAN_HANDS.md §2・§6。
// もう1つ（2026-11-11）: 人への返信に .md/.txt を添付するのを「ファイルにする理由:」なしでは通さない（同 §3.6）。
//
// なぜ要るか（2026-11-10 りんく「極力人間の手を使わないルールが守られていない気がする」）:
//   ルール本文（08・CLAUDE.md 核の ★★★）は 10/28 からあるのに、プロジェクトのスレッドが
//   Git Bash に貼るコマンド（wrangler deploy / wrangler login / 拡張入れ替え）や「画面を送って」
//   「PC で tsuioku を最新にしてから会議を動かして」を何度も頼んだ。そのスレッドは Remote Control で
//   PC のコマンドを自分で走らせられた。
//   原因: 既存の機械検査は AskUserQuestion（check-ask-preceded-by-research）と git 管理の .cmd
//   （check-human-script-no-wait）しか見ておらず、プロジェクトのスレッドが人に話す道
//   （mcp__hearthbot__post_message ほか）には何も無かった。文章のルールは「人に頼む瞬間」に読まれない。
//
// 判定するのは形だけ: 「人に手作業を頼む言い回し」があり、かつ「人に頼む理由:」の一行が無い → 拒否。
//   理由の中身が本当か（本当に AI ではできなかったか）は意味判断なので検出しない。書いた理由が記録に残る
//   ＝後から検査できる、までが限界（08 §6）。
// 無効化: 環境変数 HUMAN_HANDOFF_CHECK_OFF=1。壊れた入力・想定外の形は通す（fail-open）。

import { readFileSync } from 'node:fs';

export const WATCHED_TOOLS = new Set([
  'AskUserQuestion',
  'mcp__hearthbot__post_message',
  'mcp__hearthbot__request_decision',
  'mcp__hearthbot__post_widget',
  'mcp__hearthbot__edit_message',
]);

// 黒い画面・PC での実行を指す言葉
const TERMINAL_RE = /(Git ?Bash|PowerShell|ターミナル|コマンドプロンプト|黒い画面|cmd\.exe|\.cmd\b|wrangler|npm (run|i|install)|npx |git (pull|push|checkout|fetch|clone)|node [\w./-]+\.m?js)/i;
// 人に手を動かしてもらう依頼の言い回し
const ASK_RE = /(貼って|貼り付けて|コピペして|打って|入力して|叩いて|実行して|走らせて|動かして|最新にして|Enter ?(キー)?を?押して|エンターを?押して)(ください|下さい|ほしい|欲しい|もらえ|いただけ|くれ|ね|。|$)/i;
// 画面を送ってもらう依頼（これ単独で依頼とみなす）
const SCREEN_RE = /(スクショ|スクリーンショット|画面|黒い画面の(中身|最後|下))を?(撮って|とって|送って|貼って|見せて|教えて)/;
export const REASON_RE = /人に頼む理由[:：]\s*\S/;

// 人に渡す返信へテキストのファイルを添付するとき（docs/ai-rules/08_NO_HUMAN_HANDS.md §3.6、2026-11-11）。
// 貼る文・手順・設定値はチャットのコードブロックで渡す。ファイルにする理由の一行があれば通す。
export const FILE_REASON_RE = /ファイルにする理由[:：]\s*\S/;
const TEXT_FILE_RE = /\.(md|markdown|txt)$/i;

/** attached_outputs の中の、テキストのファイル（.md / .txt）の ref を返す。無ければ []。 */
export function findTextFileAttachments(toolInput) {
  const outs = toolInput && Array.isArray(toolInput.attached_outputs) ? toolInput.attached_outputs : [];
  return outs
    .filter((o) => o && o.kind === 'file' && typeof o.ref === 'string' && TEXT_FILE_RE.test(o.ref))
    .map((o) => o.ref);
}

/** tool_input の中の文字列を全部集める（ツールごとの形の違いを気にしない）。 */
export function collectTexts(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectTexts(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectTexts(v, out);
  return out;
}

/** 「」で括った引用は「言及」なので外す（例: 「貼って」と頼むのをやめる）。 */
function stripQuotes(text) {
  return text.replace(/「[^」]*」/g, '');
}

/** 人に手作業を頼む文を見つけたら、その文を返す。無ければ null。 */
export function findHumanHandoff(texts) {
  const all = texts.join('\n');
  const hasCodeBlock = /```[\s\S]*?```/.test(all);
  const body = stripQuotes(all.replace(/```[\s\S]*?```/g, ' [code] '));
  const sentences = body.split(/[。\n]/);
  for (const s of sentences) {
    if (SCREEN_RE.test(s)) return s.trim();
    if (ASK_RE.test(s) && (TERMINAL_RE.test(s) || (hasCodeBlock && /\[code\]|これ|下の|次の|以下/.test(s)))) return s.trim();
  }
  return null;
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.exit(0);
  }
  if (process.env.HUMAN_HANDOFF_CHECK_OFF === '1') process.exit(0);
  if (!input || !WATCHED_TOOLS.has(input.tool_name)) process.exit(0);

  const texts = collectTexts(input.tool_input);

  const files = findTextFileAttachments(input.tool_input);
  if (files.length > 0 && !texts.some((t) => FILE_REASON_RE.test(t))) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          '人に渡す返信にテキストのファイル（' + files.join(', ').slice(0, 120) + '）を添付しているので止めました。' +
          'docs/ai-rules/08_NO_HUMAN_HANDS.md §3.6: 貼る文・手順・設定値・まとめは、ファイルにせず返信の中のコードブロック（```）で渡す。' +
          'ファイルにするのは AI どうしの引き継ぎ・正本の設計書だけ（作ってよいが、人への返信には使う部分をコードブロックで写す）。' +
          'それでも添付するなら（長すぎて返信に入らない・本人がファイルを名指しした等）、本文に「ファイルにする理由: …」を一行書いて送り直す。',
      },
    }));
    process.exit(0);
  }

  if (texts.some((t) => REASON_RE.test(t))) process.exit(0);
  const hit = findHumanHandoff(texts);
  if (!hit) process.exit(0);

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        '人に手作業を頼む文なので止めました（該当: 「' + hit.slice(0, 80) + '」）。' +
        'docs/ai-rules/08_NO_HUMAN_HANDS.md §2 の順に、まず自分でやる: ' +
        '(1) もう保管されていないか (2) 公式API/CLI/MCPで書き込みまで通るか実際に叩く ' +
        '(3) PCで走らせるコマンド（git pull・npm・wrangler・拡張の入れ替え等）は、クラウドのスレッドなら ' +
        'mcp__hearthbot__start_remote_control（Remote Control）で自分で実行する／フォルダ接続があれば device_* で読む・書く ' +
        '(4) 画面は自分でスクリーンショット（computer_*）を撮る・状態ファイルを読む。' +
        '人に残すのは、本人のログイン画面での操作・鍵の発行・課金・OKの一言だけ。' +
        'それでも頼むなら、文の中に「人に頼む理由: <§2のどこでだめだったか>」を一行書いて送り直す。',
    },
  }));
  process.exit(0);
}

if (process.argv[1]?.endsWith('check-human-handoff.mjs')) main();

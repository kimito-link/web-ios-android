#!/usr/bin/env node
// PreToolUse(Bash) ガード。★非ブロッキングの警告ではなく、**外向き・取り消せない操作の前で止める**。
//
// ■ なぜ要るか（2026-10-06、本人の指摘「CLAUDE.md が形だけで機能していない気がします」の実測）
//   このキットの hook は、Edit/Write 前の CLAUDE.md 既読チェック（require-claude-md-read）を除き、
//   すべて「気づきを注入するだけ」の非ブロッキング警告だった。実際にこの設計は破られた:
//   - UserPromptSubmit の「このセッションは N 日前に開始・正本が更新されている」警告（warn-long-running-session）は、
//     13 日続いたセッションで毎ターン出ていたのに、一度も CLAUDE.md を読み直す行動に繋がらなかった。
//   - そのセッションは、.agent/coord.md の write_lock（Main-Write Pause）を取らずに、3 リポの main へ
//     PR をマージした。Gate1 の diff-check が赤のままマージした（「Gate を迂回して成功扱いにしない」違反）。
//   ＝「読む」ことも「手順を踏む」ことも、**外向きの操作の直前に機械で確かめなければ守られない**。
//
// ■ 何を止めるか（Bash の中の、次のいずれか。引用符の中・heredoc の本文は除いて判定する）
//   git push / gh pr merge / gh workflow run|enable / gh secret set / gh release create|edit|delete /
//   gh api -X POST|PUT|PATCH|DELETE / vercel --prod|deploy / wrangler deploy|publish|secret put / npm publish
//
// ■ 止める条件（すべて「事実」だけを見る。意味判断はしない）
//   1. cwd のリポの CLAUDE.md を、このセッションで**現在の内容のまま全文 Read していない**
//      （セッション開始後に更新されていても止まる＝古い指示書のまま外へ出さない）
//   2. cwd のリポに .agent/coord.md があるのに、このセッションで一度も触れていない
//      （並列セッション協調プロトコル: coord を読まずに commit/push/main 更新をしてはいけない）
//   3. gh pr merge で、対象 PR のチェックに失敗がある
//      （Gate を迂回して成功扱いにしない）。どうしても通すなら、**ユーザーがチャットで明示的に承認した後に限り**
//      コマンドへ GATE_BYPASS_APPROVED_BY_USER="<承認の中身>" を付ける。無断で付けるのは虚偽申告。
//
// ■ ★判定しないこと（過信しない）
//   - CLAUDE.md を読んだ「内容を理解して従ったか」。coord を読んだ「内容を踏まえたか」。
//   - bash -c "..." のように引用符の中に隠された操作、他のツール（MCP・Agent 経由）での外向き操作。
//   - 全文 Read は「見た」までの証拠。読んでも破る可能性は残る（だから他の hook・検査が別にある）。
//
// ■ fail-open の範囲: 入力が壊れている／transcript が読めない／リポが無い／CLAUDE.md が無い場合は止めない
//   （hook 自体の不具合でセッションを止めない）。ただし「読んだ形跡が無い」は止める側（fail-closed）。
//
// 標準入力(JSON): session_id, transcript_path, tool_name, tool_input.command, cwd

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  findFullReadHash,
  findRepoRoot,
  normalizeWindowsPath,
  readStdin,
  sha256,
  transcriptTouchedPath,
} from './lib/transcript-reads.mjs';

export const RISKY_PATTERNS = [
  { id: 'git push', re: /(^|[\s;&|(])git\s+(?:-C\s+\S+\s+)?push\b(?![^\n;&|]*--dry-run)/ },
  { id: 'gh pr merge', re: /(^|[\s;&|(])gh\s+pr\s+merge\b/ },
  { id: 'gh workflow run/enable', re: /(^|[\s;&|(])gh\s+workflow\s+(?:run|enable)\b/ },
  { id: 'gh secret set', re: /(^|[\s;&|(])gh\s+secret\s+set\b/ },
  { id: 'gh release', re: /(^|[\s;&|(])gh\s+release\s+(?:create|edit|delete)\b/ },
  { id: 'gh api (変更系)', re: /(^|[\s;&|(])gh\s+api\b[^\n;&|]*(?:-X|--method)[\s=]*(?:POST|PUT|PATCH|DELETE)\b/i },
  { id: 'vercel deploy', re: /(^|[\s;&|(])(?:npx\s+)?vercel\b[^\n;&|]*(?:--prod\b|\bdeploy\b)/ },
  { id: 'wrangler deploy', re: /(^|[\s;&|(])(?:npx\s+)?wrangler\s+(?:deploy|publish|secret\s+put|pages\s+deploy)\b/ },
  { id: 'npm publish', re: /(^|[\s;&|(])npm\s+publish\b/ },
];

// heredoc の本文と、引用符の中身を落とす。コミットメッセージや PR 本文に「gh pr merge」と書いてあるだけで
// 止めない（誤検知を減らす）。★引用符に隠された本物の操作（bash -c "..."）は見逃す（上の「判定しないこと」）。
export function stripQuotedAndHeredocs(cmd) {
  let s = String(cmd ?? '');
  // heredoc: <<'EOF' / <<EOF / <<-EOF ... 終端行
  s = s.replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g, '<<HEREDOC');
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""');
  s = s.replace(/'[^']*'/g, "''");
  return s;
}

export function detectRisky(cmd) {
  const s = stripQuotedAndHeredocs(cmd);
  return RISKY_PATTERNS.filter((p) => p.re.test(s)).map((p) => p.id);
}

/** gh pr merge の対象 PR 番号とリポ(-R)を取り出す。取れなければ null。 */
export function parsePrMerge(cmd) {
  const s = stripQuotedAndHeredocs(cmd);
  const m = /gh\s+pr\s+merge\b([^\n;&|]*)/.exec(s);
  if (!m) return null;
  const rest = m[1];
  const num = /(?:^|\s)(\d+)(?=\s|$)/.exec(rest);
  const repo = /(?:-R|--repo)[\s=]+([\w.-]+\/[\w.-]+)/.exec(rest);
  return { number: num ? num[1] : null, repo: repo ? repo[1] : null };
}

/** チェック結果(gh pr checks --json name,bucket)から、失敗している名前を返す。 */
export function failingChecks(checks) {
  if (!Array.isArray(checks)) return [];
  return checks.filter((c) => c && (c.bucket === 'fail' || c.state === 'FAILURE')).map((c) => String(c.name || '(無名)'));
}

function fetchChecks(pr) {
  // 検証用: 環境変数で結果を差し込める（実 gh・ネットワーク無しでテストするため）。
  if (process.env.GUARD_TEST_CHECKS_JSON) {
    try {
      return JSON.parse(process.env.GUARD_TEST_CHECKS_JSON);
    } catch {
      return null;
    }
  }
  try {
    const args = ['pr', 'checks'];
    if (pr.number) args.push(pr.number);
    if (pr.repo) args.push('-R', pr.repo);
    args.push('--json', 'name,bucket,state');
    const out = execFileSync('gh', args, { encoding: 'utf8', timeout: 8000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out);
  } catch (e) {
    // gh pr checks は失敗チェックがあると exit 1 でも stdout に JSON を出す。拾えるなら拾う。
    try {
      if (e && typeof e.stdout === 'string' && e.stdout.trim().startsWith('[')) return JSON.parse(e.stdout);
    } catch {
      /* fallthrough */
    }
    return null; // 取れない＝止めない（fail-open。ネットワーク不通で全マージが止まるのを避ける）
  }
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    process.exit(0);
  }
  if (!input || input.tool_name !== 'Bash') process.exit(0);
  const cmd = input.tool_input && typeof input.tool_input.command === 'string' ? input.tool_input.command : '';
  if (!cmd) process.exit(0);

  const risky = detectRisky(cmd);
  if (risky.length === 0) process.exit(0);

  const cwd = normalizeWindowsPath(input.cwd) || process.cwd();
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) process.exit(0);

  const reasons = [];

  // 1. CLAUDE.md を現在の内容のまま全文 Read したか
  const claudeMdPath = join(repoRoot, 'CLAUDE.md');
  if (existsSync(claudeMdPath)) {
    let currentHash = null;
    try {
      currentHash = sha256(readFileSync(claudeMdPath, 'utf8'));
    } catch {
      currentHash = null;
    }
    if (currentHash) {
      const lastReadHash = findFullReadHash(input.transcript_path, resolve(claudeMdPath));
      if (lastReadHash !== currentHash) {
        reasons.push(
          (lastReadHash === null
            ? 'このセッションで CLAUDE.md を全文 Read していません。'
            : 'CLAUDE.md が、このセッションで最後に Read した後に更新されています。') +
            ` ${claudeMdPath} を Read してください（長い場合は offset/limit で分けて全行を）。`
        );
      }
    }
  }

  // 2. coord.md に触れたか（並列セッション協調プロトコル）
  const coordPath = join(repoRoot, '.agent', 'coord.md');
  if (existsSync(coordPath) && !transcriptTouchedPath(input.transcript_path, '.agent/coord.md')) {
    reasons.push(
      `${coordPath} にこのセッションで一度も触れていません。write_lock と他セッションの files を読み、` +
        '自分の session 行を書いてから進めてください（並列セッション協調プロトコル）。'
    );
  }

  // 3. gh pr merge: チェックに失敗が無いか（Gate を迂回して成功扱いにしない）
  if (risky.includes('gh pr merge') && !/GATE_BYPASS_APPROVED_BY_USER\s*=/.test(cmd)) {
    const pr = parsePrMerge(cmd);
    if (pr) {
      const failing = failingChecks(fetchChecks(pr));
      if (failing.length > 0) {
        reasons.push(
          `この PR のチェックに失敗があります: ${failing.join(', ')}。直してからマージしてください。` +
            'ユーザーがチャットで明示的にバイパスを承認した場合に限り、コマンドの先頭に ' +
            'GATE_BYPASS_APPROVED_BY_USER="<承認の中身>" を付けてください（無断で付けるのは虚偽申告）。'
        );
      }
    }
  }

  if (reasons.length === 0) process.exit(0);

  deny(
    `外向き・取り消せない操作（${risky.join(' / ')}）の前に、CLAUDE.md が求める手順が踏まれていません:\n- ` +
      reasons.join('\n- ') +
      '\n（このガードは .claude/hooks/guard-external-actions.mjs。「読んだか・触れたか・チェックが緑か」という事実だけを見ます）'
  );
}

// import（テスト）時は main を走らせない。
const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main();

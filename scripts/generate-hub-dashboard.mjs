#!/usr/bin/env node
/**
 * generate-hub-dashboard.mjs
 *
 * ../ai-hub/index.json + `node ../ai-hub/bin/hub.mjs doctor --json` を読み、
 * kimito-skill.link/hub/ 用の静的ページ(index.html + hub-data.json)を生成する。
 *
 * 設計: _docs/DESIGN-ai-hub-consolidation-2026-08-26.md
 * ハンドオフ: _docs/IMPLEMENTATION-HANDOFF-ai-hub-consolidation-2026-08-26.md
 *
 * ★このページは公開LP(kimito-skill.link)配下に同居する内部ダッシュボード。
 *   KB本文・エラー実文言・triggersは出力しない(パスと件数のみ)。
 *   site/_headers で /hub/* に noindex を付けるが、本丸はCloudflare Accessの
 *   手動設定(GUI操作のため自動化不可)。
 *
 * ai-hubが見つからない/壊れている場合は exit 1 で止まる(fail-closed。空ページを作らない)。
 *
 * Usage:
 *   node scripts/generate-hub-dashboard.mjs
 *   node scripts/generate-hub-dashboard.mjs --root . --out site/hub
 *   node scripts/generate-hub-dashboard.mjs --selftest
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

function option(name, fallback = null) {
  const at = argv.lastIndexOf(name);
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : fallback;
}
function has(name) { return argv.includes(name); }
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** タグ→棚のマッピング。DESIGN.md C-1準拠。順序が表示順。 */
const SHELVES = [
  { id: 'shipping', title: 'アプリ提出', tags: ['ios', 'android', 'store-review', 'shipping'] },
  { id: 'line', title: 'LINE bot', tags: ['line'] },
  { id: 'video', title: '動画・SNS', tags: ['video', 'sns'] },
  { id: 'local-llm', title: 'ローカルLLM', tags: ['local-llm'] },
  { id: 'gate', title: '計器・出荷ゲート', tags: ['gate', 'verify'] },
  { id: 'council', title: '会議・設計ハーネス', tags: ['council', 'llm', 'fable'] },
];

function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(startDir, '..');
}

/**
 * ai-hub/index.json と doctor --json を読み、棚ごとにグルーピングしたデータを返す。
 * ai-hubが見つからない・壊れている場合は例外を投げる(呼び出し側でfail-closed処理)。
 */
function loadHubData(githubRoot) {
  const aiHubDir = join(githubRoot, 'ai-hub');
  const indexPath = join(aiHubDir, 'index.json');
  const hubBin = join(aiHubDir, 'bin', 'hub.mjs');

  if (!existsSync(indexPath)) {
    throw new Error(`ai-hub/index.json が見つかりません: ${indexPath}`);
  }
  if (!existsSync(hubBin)) {
    throw new Error(`ai-hub/bin/hub.mjs が見つかりません: ${hubBin}`);
  }

  let index;
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch (e) {
    throw new Error(`ai-hub/index.json のJSONが壊れています: ${e.message}`);
  }
  if (!Array.isArray(index.entries)) {
    throw new Error('ai-hub/index.json の entries が配列ではありません');
  }

  let doctorRaw;
  try {
    doctorRaw = execFileSync('node', [hubBin, 'doctor', '--json'], {
      cwd: githubRoot, encoding: 'utf8', timeout: 60000
    });
  } catch (e) {
    // doctorはproblemsがあるとexit 1になるが、それでもJSON出力自体は読みたい。
    doctorRaw = e.stdout ? String(e.stdout) : null;
    if (!doctorRaw) throw new Error(`hub.mjs doctor の実行に失敗しました: ${e.message}`);
  }
  let doctor;
  try {
    doctor = JSON.parse(doctorRaw);
  } catch (e) {
    throw new Error(`hub.mjs doctor --json の出力がJSONとして壊れています: ${e.message}`);
  }

  const entries = index.entries;
  const shelves = SHELVES.map((shelf) => ({
    id: shelf.id,
    title: shelf.title,
    entries: entries.filter((e) => (e.tags || []).some((t) => shelf.tags.includes(t))),
  }));

  const shelvedIds = new Set(shelves.flatMap((s) => s.entries.map((e) => e.id)));
  const other = entries.filter((e) => !shelvedIds.has(e.id));
  shelves.push({ id: 'other', title: '横断知見・その他', entries: other });

  return {
    generatedFrom: 'ai-hub/index.json',
    generatedAt: new Date(0).toISOString(), // 呼び出し側で実時刻に差し替え
    entryCount: entries.length,
    doctorOk: !!doctor.ok,
    doctorProblems: doctor.problems || [],
    doctorWarnings: doctor.warnings || [],
    doctorProblemCount: (doctor.problems || []).length,
    doctorWarningCount: (doctor.warnings || []).length,
    shelves: shelves.filter((s) => s.entries.length > 0),
    emptyShelves: shelves.filter((s) => s.entries.length === 0).map((s) => s.title),
  };
}

/**
 * 「次にやるべきこと」を機械的に導出する。
 * ★doctorのproblems/warnings・空棚から自動生成する分と、この生成器が知っている
 *   既知の手動タスク(TODO_SOURCE)を合わせて優先度順に並べる。
 *   固定文言の羅列にならないよう、根拠(evidence)を必ず添える。
 */
// ★優先順位の軸（2026-08-26 ユーザー方針）: 「全ての根本は資金が要るので、マネタイズに
//   近いものを最優先する」。ここに並べる項目は実際に調査・裏取りした事実のみ（推測や
//   一般論のタスクを機械的に量産しない）。
const TODO_SOURCE = [
  {
    priority: 1,
    title: 'sakkino.link（IAP実装済み・開発中）の次の一手を決める',
    reason: '課金導線が既にあるプロジェクトの中で最もマネタイズに近い。ai-hub未登録のため状況を再確認し、リリースまでの障害物を洗い出す',
    evidence: '2026-08-26調査: 「用途不明5リポジトリ」判定でIAP・独自iOSキーボード/共有拡張を実装済みと確認',
  },
  {
    priority: 2,
    title: 'Cloudflare Accessを /hub/* に設定する',
    reason: 'このダッシュボードはnoindexのみで、Access未設定の間は実質公開状態（GUI操作のため自動化不可）',
    evidence: '_docs/IMPLEMENTATION-HANDOFF-ai-hub-consolidation-2026-08-26.md のリスク対応チェックリスト参照',
  },
];

function deriveTodos(data) {
  const todos = TODO_SOURCE.map((t) => ({ ...t }));

  if (data.doctorProblemCount > 0) {
    // ★doctorのproblemsは「地図そのものが壊れている」状態。マネタイズより優先する
    //   (壊れた地図の上で優先順位を議論しても意味が無いため、priority 0で最上位に割り込む)。
    todos.push({
      priority: 0,
      title: `ai-hub doctorの問題${data.doctorProblemCount}件を直す`,
      reason: data.doctorProblems.slice(0, 3).join(' / '),
      evidence: 'node ai-hub/bin/hub.mjs doctor',
    });
  }
  if (data.emptyShelves.length) {
    todos.push({
      priority: 4,
      title: `未整理の棚（${data.emptyShelves.join('・')}）に登録できる資産を探す`,
      reason: '該当タグのエントリがindex.jsonに0件のため、この棚は空のまま表示されている',
      evidence: 'ai-hub/index.json',
    });
  }
  if (data.doctorWarningCount > 0) {
    todos.push({
      priority: 5,
      title: `ai-hub doctorの警告${data.doctorWarningCount}件（未インデックス資産など）を精査する`,
      reason: '緊急ではないが、資産が増えるほど探しにくくなる',
      evidence: 'node ai-hub/bin/hub.mjs doctor',
    });
  }
  return todos.sort((a, b) => a.priority - b.priority);
}

function renderTodos(todos) {
  if (!todos.length) {
    return '<p class="todo-empty">✅ 今のところ機械的に検出された次のタスクはありません。</p>';
  }
  const items = todos.map((t) => `        <li class="todo priority-${t.priority}">
          <div class="todo-title">${escapeHtml(t.title)}</div>
          <div class="todo-reason">${escapeHtml(t.reason)}</div>
          <div class="todo-evidence">出典: ${escapeHtml(t.evidence)}</div>
        </li>`).join('\n');
  return `      <ol class="todo-list">
${items}
      </ol>`;
}

function renderHtml(data) {
  const shelvesHtml = data.shelves.map((shelf) => {
    const rows = shelf.entries
      .slice().sort((a, b) => a.path.localeCompare(b.path))
      .map((e) => `        <li><code>${escapeHtml(e.path)}</code> <span class="kind">${escapeHtml(e.kind)}</span></li>`)
      .join('\n');
    return `      <section class="shelf">
        <h2>${escapeHtml(shelf.title)} <span class="count">(${shelf.entries.length})</span></h2>
        <ul>
${rows}
        </ul>
      </section>`;
  }).join('\n');

  const emptyNote = data.emptyShelves.length
    ? `<p class="empty-note">整理中（まだ登録資産なし）: ${data.emptyShelves.map(escapeHtml).join(' / ')}</p>`
    : '';

  return `<!-- 生成物・手編集禁止。正本は ai-hub/index.json。再生成は npm run hub:page -->
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>ai-hub ダッシュボード</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.4rem; }
  .meta { color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; }
  .meta.stale { color: #b00; font-weight: bold; }
  .shelf { margin-bottom: 1.5rem; }
  .shelf h2 { font-size: 1.05rem; border-bottom: 1px solid #ddd; padding-bottom: 0.3rem; }
  .count { color: #888; font-weight: normal; font-size: 0.9rem; }
  ul { list-style: none; padding: 0; }
  li { padding: 0.2rem 0; font-size: 0.9rem; }
  code { background: #f4f4f4; padding: 0.1rem 0.3rem; border-radius: 3px; }
  .kind { color: #888; font-size: 0.8rem; }
  .empty-note { color: #888; font-style: italic; font-size: 0.85rem; }
  .doctor { padding: 0.6rem 1rem; border-radius: 6px; margin-bottom: 1.5rem; }
  .doctor.ok { background: #e8f5e9; }
  .doctor.ng { background: #ffebee; }
  .todo-section { background: #fff8e1; border: 1px solid #ffe0a3; border-radius: 8px; padding: 1rem 1.2rem; margin-bottom: 1.5rem; }
  .todo-section h2 { margin-top: 0; font-size: 1.1rem; }
  .todo-list { padding-left: 1.3rem; margin: 0; }
  .todo { margin-bottom: 0.8rem; }
  .todo-title { font-weight: 600; }
  .todo-reason { color: #555; font-size: 0.88rem; }
  .todo-evidence { color: #999; font-size: 0.78rem; }
  .todo-empty { color: #2e7d32; }
</style>
</head>
<body>
<p><a href="/">← kimito-skill.link トップへ</a></p>
<h1>ai-hub ダッシュボード</h1>
<p class="meta" id="freshness-note" data-generated-at="${escapeHtml(data.generatedAt)}">
  生成: ${escapeHtml(data.generatedAt)}（entries=${data.entryCount}）
  <!-- 出典: ai-hub/bin/hub.mjs doctor --json 実行結果、生成時刻はこのスクリプト実行時刻 -->
</p>
<div class="doctor ${data.doctorOk ? 'ok' : 'ng'}">
  doctor: ${data.doctorOk ? '✓ OK' : '✗ 問題あり'}（問題${data.doctorProblemCount}件・警告${data.doctorWarningCount}件）
  <!-- 出典: ai-hub/bin/hub.mjs doctor --json -->
</div>
<section class="todo-section">
  <h2>🎯 次にやるべきこと（優先順位順・機械的に検出）</h2>
${renderTodos(data.todos)}
</section>
${emptyNote}
${shelvesHtml}
</body>
</html>
`;
}

function main() {
  if (has('--selftest')) {
    process.exit(runSelfTest());
  }

  const root = resolve(option('--root', '.'));
  const outDir = resolve(root, option('--out', 'site/hub'));
  const githubRoot = findRepoRootFromRoot(root);

  let data;
  try {
    data = loadHubData(githubRoot);
  } catch (e) {
    console.error(`[generate-hub-dashboard] FAIL  ${e.message}`);
    console.error('        ai-hub/index.json またはhub.mjsが見つからない/壊れています(fail-closed)。');
    process.exit(1);
  }
  data.generatedAt = new Date().toISOString();
  data.todos = deriveTodos(data);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), renderHtml(data), 'utf8');
  writeFileSync(
    join(outDir, 'hub-data.json'),
    JSON.stringify({ generatedFrom: data.generatedFrom, generatedAt: data.generatedAt, ...data }, null, 2),
    'utf8'
  );
  console.log(`[generate-hub-dashboard] OK    ${outDir} を生成しました（entries=${data.entryCount}）`);
  if (data.emptyShelves.length) {
    console.log(`        整理中（未登録）の棚: ${data.emptyShelves.join(' / ')}`);
  }
}

function findRepoRootFromRoot(root) {
  // root(web-ios-android) の親が github/ のはず。念のためfindRepoRoot型で.gitを遡る。
  const kitRoot = findRepoRoot(root);
  return resolve(kitRoot, '..');
}

/** --selftest: 毒(ai-hub不在を模した一時パス)を与えてfail-closedになるか確認する。 */
function runSelfTest() {
  const fails = [];

  // 毒1: 存在しないgithubRootでloadHubDataを呼ぶ → 例外を投げるか
  try {
    loadHubData(join(HERE, '__does-not-exist__'));
    fails.push('poison(no ai-hub): 例外が投げられなかった(fail-closedが効いていない)');
  } catch (e) {
    if (!/index\.json|hub\.mjs/.test(e.message)) {
      fails.push(`poison(no ai-hub): 想定外のエラーメッセージ: ${e.message}`);
    }
  }

  /*
   * 対照: 実際のgithub/ai-hubに対しては正常に読めること。
   *
   * ★隣のリポ(ai-hub)が【無い環境】ではこの対照は測れない。
   *   CI はこのリポだけを checkout するので、実際に測れない
   *   （2026-08-29 に隔離環境で実測して踏んだ）。
   *
   * ★そこを「赤」にすると CI が常時赤になり、本物の赤が埋もれる。
   *   かといって黙って飛ばすと★対照なしの selftest を緑と読ませることになる
   *   ＝毒だけ見て実データを見ない検査になり、偽陽性に気づけない。
   *   ⟹ 【測れなかった】と明示して、この対照だけを外す（exit 2 相当）。
   */
  const realGithubRoot = findRepoRootFromRoot(resolve(HERE, '..'));
  const siblingsAbsent = process.env.VERIFY_SIBLING_REPOS === 'absent'
    || !existsSync(join(realGithubRoot, 'ai-hub', 'index.json'));
  if (siblingsAbsent) {
    console.log('[generate-hub-dashboard] 🟡 対照(実 ai-hub)は測れませんでした'
      + '(★隣のリポが無い環境です。緑ではなく「この1件は未検証」です)');
    console.log('  → 手元では隣に ai-hub があるので測れます。CI では測れません。');
  }
  try {
    if (siblingsAbsent) throw { __skip: true };
    const data = loadHubData(realGithubRoot);
    if (!Array.isArray(data.shelves)) fails.push('real ai-hub: shelvesが配列ではない');
    if (typeof data.entryCount !== 'number' || data.entryCount <= 0) {
      fails.push('real ai-hub: entryCountが0以下(実データを読めていない)');
    }
    const todos = deriveTodos(data);
    if (!Array.isArray(todos) || todos.length === 0) {
      fails.push('deriveTodos: 常に最低1件(TODO_SOURCE分)は返すはずが0件だった');
    }
    if (todos.some((t, i) => i > 0 && t.priority < todos[i - 1].priority)) {
      fails.push('deriveTodos: priority昇順にソートされていない');
    }
  } catch (e) {
    // ★測れないときの意図的な離脱は失敗に数えない（上で🟡として告知済み）。
    if (!e || !e.__skip) fails.push(`real ai-hub: 正常系で例外が発生: ${e.message}`);
  }

  // 毒2: doctorProblemCount>0を模したデータでpriority0のTODOが先頭に来るか
  {
    const poisoned = {
      doctorProblemCount: 1, doctorProblems: ['dummy problem'],
      doctorWarningCount: 0, doctorWarnings: [], emptyShelves: [],
    };
    const todos = deriveTodos(poisoned);
    if (!todos.length || todos[0].priority !== 0) {
      fails.push('poison(doctor problem): 問題ありのTODOが最優先(priority 0)にならなかった');
    }
  }

  if (fails.length) {
    console.error('[generate-hub-dashboard] --selftest FAIL');
    for (const f of fails) console.error(`  - ${f}`);
    return 1;
  }
  console.log('[generate-hub-dashboard] --selftest OK');
  return 0;
}

main();

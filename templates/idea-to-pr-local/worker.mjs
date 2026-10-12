#!/usr/bin/env node
// @ts-check
/**
 * worker.mjs — 常駐PC側のワーカー。GitHub Issue（ai-task ラベル）を拾い、Claude Code（claude -p）で実装し、
 * PR を作り、あとでそのPRのチェック結果を「機械的に」確かめて Issue に事実を書く。
 *
 * ■ 使い方（Windows のタスクスケジューラから10分おきに起動する想定。常駐プロセスにしない）
 *   node worker.mjs --once            # 1周だけ回して終わる（既定）
 *   node worker.mjs --dry-run         # 何も変更せず「何を拾うか・なぜ拾わないか」だけ表示
 *   node worker.mjs --verify-only     # 作業はせず、PR のチェック確認だけ行う
 *   node worker.mjs --status          # 直近の実行回数・所要時間・結果の内訳
 *   node worker.mjs --selftest        # わざと壊した入力で赤になることを確かめる
 *   --config <path>                   # 設定ファイル（既定: ./idea-pipeline.config.json → ~/.idea-pipeline/config.json）
 *
 * ■ なぜ常駐ループではなく「1周で終わる」にしたか
 *   単一プロセスが際限なく肥大する事故がある（Claude Desktop が120GB超になった実例）。
 *   1周で終わらせてスケジューラが起動し直せば、リークも固まりも次の周回に持ち越さない。
 *   二重起動はロックファイルで防ぐ。
 *
 * ■ 安全設計（詳細は README の「脅威モデル」）
 *   - Issue 本文はこのPCのAIへの命令になる。だから (1) 許可した作者かつ書き込み権限者の Issue だけ拾う
 *     (2) claude に許可するツールを絞る（git push・gh・ネットワーク無し） (3) 差分に触ってはいけない場所が
 *     あれば push しない (4) push と PR 作成は claude ではなくこのスクリプトが行う（ブランチは ai/issue-N のみ・
 *     force 無し・マージしない）。
 *   - ★(4) は、グローバルの外向き操作ガード（guard-external-actions）を迂回する経路でもある。
 *     ガードは「AI が CLAUDE.md を読んだか」を見るが、この経路では push するのが AI ではなく決め打ちの
 *     スクリプトで、行き先・ブランチ・差分の検査が上の (1)(3)(4) で固定されているため、別の安全装置に置き換えている。
 *   - 課金: ANTHROPIC_API_KEY が環境にあると claude は API の従量課金に切り替わる。子プロセスの環境から外す。
 *
 * ■ ★判定しないこと
 *   Issue の内容が妥当か／PR のコードが正しいか／サブスク枠の残量。人が PR を見て決める。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FORBIDDEN_PATHS,
  LABELS,
  branchNameFor,
  buildPrompt,
  computeVerdict,
  dailyCapReached,
  findForbiddenPaths,
  isSafePushBranch,
  redact,
  selectCandidates,
  summarizeRuns,
} from './lib/pipeline-core.mjs';
import { fetchPrFacts, findPrNumberForIssue } from './lib/pr-facts.mjs';
import {
  ackText,
  askText,
  buildWorkIssue,
  findPendingAsk,
  parseInboxMarker,
  pickByOrdinal,
  reportText,
  resolveTargetRepos,
  selectNewInboxComments,
} from './lib/inbox-core.mjs';

const DEFAULTS = Object.freeze({
  repos: {},
  allowedAuthors: [],
  maxRunsPer24h: 5,
  maxTurns: 40,
  workTimeoutMinutes: 30,
  maxChangedFiles: 50,
  keepFailedWorktrees: true,
  verifyGraceMinutes: 15,
  // 受付 Issue（Grok に普通に話した依頼を、コメントとして受け取る窓口）。空なら受付は使わない。
  // 各要素: { repo: "owner/name", issue: 番号, defaultTarget?: "owner/name", processExisting?: boolean }
  inboxes: [],
  siteAliases: {}, // 台帳に無いドメイン → リポ。例: { "kimito-skill.link": "owner/web-ios-android" }
  ledgerPath: '', // 全リポ台帳（best-trust/data/repositories.json）。サイト名→リポの照合に使う。空なら別名表だけ
  maxIntakePerPass: 5,
  claudeCommand: ['claude'],
  ghCommand: ['gh'],
  gitCommand: ['git'],
  stateDir: path.join(os.homedir(), '.idea-pipeline'),
  forbiddenPaths: DEFAULT_FORBIDDEN_PATHS,
  // claude に許す道具。push・gh・ネットワーク・任意コマンドは無い。足す前に README の脅威モデルを読むこと。
  allowedTools: [
    'Read', 'Write', 'Edit', 'Glob', 'Grep',
    'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)',
    'Bash(npm test:*)', 'Bash(npm run test:*)', 'Bash(npm run lint:*)', 'Bash(npm run typecheck:*)',
    'Bash(npx tsc:*)', 'Bash(npx vitest:*)',
  ],
});

/** @param {string} p */
const expandHome = (p) => (typeof p === 'string' && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

/**
 * 設定を読む。壊れていたら例外（fail-closed。黙って既定で動かさない）。
 * @param {string|undefined} explicitPath
 */
export function loadConfig(explicitPath) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [explicitPath, process.env.IDEA_PIPELINE_CONFIG, path.join(here, 'idea-pipeline.config.json'), path.join(os.homedir(), '.idea-pipeline', 'config.json')].filter(Boolean);
  const found = candidates.find((c) => fs.existsSync(/** @type {string} */ (c)));
  if (!found) throw new Error('設定ファイルが見つからない。idea-pipeline.config.example.json をコピーして作ること。探した場所: ' + candidates.join(' / '));
  const raw = JSON.parse(fs.readFileSync(/** @type {string} */ (found), 'utf8'));
  const cfg = { ...DEFAULTS, ...raw };
  cfg.stateDir = expandHome(cfg.stateDir);
  cfg.repos = Object.fromEntries(Object.entries(cfg.repos || {}).map(([k, v]) => [k, { ...v, path: expandHome(/** @type {any} */ (v).path) }]));
  validateConfig(cfg);
  return cfg;
}

/** @param {any} cfg */
export function validateConfig(cfg) {
  const errs = [];
  if (!cfg.repos || Object.keys(cfg.repos).length === 0) errs.push('repos が空');
  for (const [name, r] of Object.entries(cfg.repos || {})) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(name)) errs.push(`repos のキーが owner/name 形式ではない: ${name}`);
    if (!r || typeof r.path !== 'string' || !fs.existsSync(r.path)) errs.push(`repos.${name}.path が存在しない`);
  }
  if (!Array.isArray(cfg.allowedAuthors) || cfg.allowedAuthors.length === 0) errs.push('allowedAuthors が空（誰の Issue も拾わない設定になってしまう）');
  if (!Number.isFinite(cfg.maxRunsPer24h) || cfg.maxRunsPer24h <= 0) errs.push('maxRunsPer24h が正の数ではない');
  for (const [i, b] of (Array.isArray(cfg.inboxes) ? cfg.inboxes : []).entries()) {
    if (!b || !/^[\w.-]+\/[\w.-]+$/.test(String(b.repo)) || !Number.isInteger(b.issue) || b.issue <= 0) errs.push(`inboxes[${i}] が { repo: "owner/name", issue: 正の整数 } の形ではない`);
    if (b && b.defaultTarget && !(b.defaultTarget in (cfg.repos || {}))) errs.push(`inboxes[${i}].defaultTarget が repos に無い（作業できないリポは既定の対象にできない）`);
  }
  if (cfg.inboxes !== undefined && !Array.isArray(cfg.inboxes)) errs.push('inboxes が配列ではない');
  if (cfg.ledgerPath && !fs.existsSync(expandHome(cfg.ledgerPath))) errs.push(`ledgerPath が存在しない: ${cfg.ledgerPath}`);
  // 空や相対パスのままだと、状態ファイル（ロック・実行記録・作業ツリー）が起動した場所に散らばる
  if (typeof cfg.stateDir !== 'string' || !path.isAbsolute(cfg.stateDir)) errs.push('stateDir が絶対パスではない');
  if (!Number.isFinite(cfg.maxTurns) || cfg.maxTurns <= 0 || !Number.isFinite(cfg.workTimeoutMinutes) || cfg.workTimeoutMinutes <= 0) errs.push('maxTurns / workTimeoutMinutes が正の数ではない');
  if (errs.length) throw new Error('設定が不正: ' + errs.join(' / '));
}

/** Windows では npm/npx 等が .cmd で、shell 無しだと起動できない（EINVAL）。設定由来の固定コマンドだけに使う。 */
const NEEDS_SHELL = new Set(['npm', 'npx', 'pnpm', 'yarn']);

/**
 * コマンド配列を実行する。シェルを挟まない（引数に Issue 由来の文字列が混ざっても解釈されない）。
 * @param {string[]} cmd 先頭が実行ファイル
 * @param {string[]} args
 * @param {{cwd?:string, input?:string, timeoutMs?:number, env?:NodeJS.ProcessEnv}} [opts]
 */
export function exec(cmd, args, opts = {}) {
  const [bin, ...pre] = cmd;
  const shell = process.platform === 'win32' && NEEDS_SHELL.has(bin);
  const r = spawnSync(bin, [...pre, ...args], {
    cwd: opts.cwd,
    input: opts.input,
    encoding: 'utf8',
    timeout: opts.timeoutMs,
    env: opts.env || process.env,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    shell,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error ? String(r.error.message || r.error) : '', timedOut: Boolean(r.error && /** @type {any} */ (r.error).code === 'ETIMEDOUT') };
}

/**
 * パイプラインを作る。exec と now を差し替えられる（統合テストで偽の gh/claude を使うため）。
 * @param {{cfg:any, exec?:typeof exec, now?:()=>number, dryRun?:boolean, log?:(m:string)=>void}} deps
 */
export function createPipeline(deps) {
  // 設定に無い項目は既定値で補う（loadConfig を通さずに直接呼ぶ場合も、項目の追加で落ちないように）
  const cfg = { ...DEFAULTS, ...deps.cfg };
  const run = deps.exec || exec;
  const now = deps.now || (() => Date.now());
  const dryRun = Boolean(deps.dryRun);
  const log = deps.log || ((m) => console.log(`[${new Date(now()).toISOString()}] ${redact(m)}`));

  const stateDir = cfg.stateDir;
  const runsPath = path.join(stateDir, 'runs.jsonl');
  const lockPath = path.join(stateDir, 'lock.json');
  const pausePath = path.join(stateDir, 'PAUSE');

  const gh = (args, o = {}) => run(cfg.ghCommand, args, o);
  const git = (cwd, args, o = {}) => run(cfg.gitCommand, args, { cwd, ...o });

  /** @param {string[]} args */
  function ghJson(args) {
    const r = gh(args);
    if (r.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(' ')} が失敗: ${redact(r.stderr || r.error).slice(0, 300)}`);
    try {
      return JSON.parse(r.stdout || 'null');
    } catch {
      throw new Error(`gh ${args.slice(0, 3).join(' ')} の出力が JSON ではない`);
    }
  }

  function readRuns() {
    try {
      return fs.readFileSync(runsPath, 'utf8').split('\n').filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  /** @param {object} entry */
  function appendRun(entry) {
    if (dryRun) return;
    fs.mkdirSync(stateDir, { recursive: true });
    fs.appendFileSync(runsPath, JSON.stringify({ ts: new Date(now()).toISOString(), ...entry }) + '\n');
  }

  /** 二重起動を防ぐ。3時間以上前のロックは、落ちた周回の残りとみなして奪う。 */
  function acquireLock() {
    fs.mkdirSync(stateDir, { recursive: true });
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: now() }));
      fs.closeSync(fd);
      return true;
    } catch {
      try {
        const st = fs.statSync(lockPath);
        if (now() - st.mtimeMs > 3 * 3600 * 1000) {
          fs.rmSync(lockPath, { force: true });
          return acquireLock();
        }
      } catch { /* 競合したら諦める */ }
      return false;
    }
  }
  const releaseLock = () => { try { fs.rmSync(lockPath, { force: true }); } catch { /* 無視 */ } };

  // ───────── GitHub 操作（dry-run では書き込まない） ─────────
  const ghWrite = (args) => {
    if (dryRun) { log(`(dry-run) gh ${args.join(' ').slice(0, 120)}`); return { status: 0, stdout: '', stderr: '', error: '' }; }
    return gh(args);
  };
  const addLabel = (repo, n, label) => ghWrite(['api', '-X', 'POST', `repos/${repo}/issues/${n}/labels`, '-f', `labels[]=${label}`]);
  const removeLabel = (repo, n, label) => ghWrite(['api', '-X', 'DELETE', `repos/${repo}/issues/${n}/labels/${encodeURIComponent(label)}`]);
  const comment = (repo, n, body) => ghWrite(['api', '-X', 'POST', `repos/${repo}/issues/${n}/comments`, '-f', `body=${redact(body).slice(0, 60000)}`]);

  function defaultBranch(repo) {
    const r = ghJson(['api', `repos/${repo}`]);
    if (!r || typeof r.default_branch !== 'string') throw new Error('既定ブランチが取れなかった');
    return r.default_branch;
  }

  // ───────── 受付 Issue（Grok に普通に話した依頼の窓口。判断は lib/inbox-core.mjs） ─────────
  /** 書き込み＋結果の JSON を返す（Issue の作成で番号が要る）。dry-run では書かず null。 */
  function ghWriteJson(args) {
    if (dryRun) { log(`(dry-run) gh ${args.join(' ').slice(0, 120)}`); return null; }
    return ghJson(args);
  }

  /** 台帳（サイト名→リポの照合用）。無ければ null（別名表だけで照合する）。 */
  function loadLedger() {
    if (cfg.ledger) return cfg.ledger;
    if (!cfg.ledgerPath) return null;
    try {
      return JSON.parse(fs.readFileSync(expandHome(cfg.ledgerPath), 'utf8'));
    } catch (e) {
      log(`台帳を読めない（別名表だけで照合する）: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  const inboxStatePath = (b) => path.join(stateDir, `inbox-${b.repo.replace('/', '__')}-${b.issue}.json`);
  function readInboxLastId(b) {
    try { return Number(JSON.parse(fs.readFileSync(inboxStatePath(b), 'utf8')).lastCommentId); } catch { return null; }
  }
  function saveInboxLastId(b, id) {
    if (dryRun) return;
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(inboxStatePath(b), JSON.stringify({ lastCommentId: id }));
  }

  /**
   * 作業用 Issue が受付から作られたものなら、結果を受付 Issue にも書く（Grok がそのスレッドを読んで人に報告する）。
   * 失敗しても本筋（作業・確認）を止めない。
   * @param {any} issue @param {string} repo @param {Parameters<typeof reportText>[0]['kind']} kind
   * @param {{prUrl?:string, detail?:string, sha?:string}} [extra]
   */
  function notifyInbox(issue, repo, kind, extra = {}) {
    try {
      const ref = issue && parseInboxMarker(issue.body);
      if (!ref) return;
      comment(ref.repo, ref.issue, reportText({ kind, title: issue.title || '', workRef: `${repo}#${issue.number}`, ...extra }));
    } catch (e) {
      log(`受付への報告に失敗（本筋は続ける）: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** 受付 Issue の新しいコメントを依頼として取り込む。1コメント＝1つの作業用 Issue。 */
  function intakeInbox(b) {
    const comments = ghJson(['api', `repos/${b.repo}/issues/${b.issue}/comments?per_page=100`]);
    const all = Array.isArray(comments) ? comments : [];
    let lastId = readInboxLastId(b);
    if (lastId === null) {
      // 初回。受付に昔から付いているコメントを依頼として一斉に実行しない（長く使われている Issue を指定した場合の事故を防ぐ）
      lastId = b.processExisting ? 0 : all.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0);
      saveInboxLastId(b, lastId);
      log(`受付 ${b.repo}#${b.issue}: 初回。${b.processExisting ? '既存のコメントも処理する' : `既存のコメント（〜${lastId}）は処理せず、これ以降を処理する`}`);
    }
    const { requests, skipped } = selectNewInboxComments(all, { allowedAuthors: cfg.allowedAuthors, lastId });
    for (const s of skipped) if (dryRun) log(`(dry-run) 受付のコメント ${s.id} は拾わない: ${s.reason}`);
    // 拾わなかったコメントも「見た」ことにして、次回以降は評価し直さない
    const maxSeen = all.reduce((m, c) => (Number(c.id) > lastId ? Math.max(m, Number(c.id)) : m), lastId);
    const workable = Object.keys(cfg.repos);
    let done = 0;
    for (const req of requests) {
      if (done >= cfg.maxIntakePerPass) { log('受付: 1周の上限に達したので残りは次回'); return; }
      done++;
      const commentUrl = `https://github.com/${b.repo}/issues/${b.issue}#issuecomment-${req.id}`;
      const resolveOpts = { ledger: loadLedger(), aliases: cfg.siteAliases, workableRepos: workable, defaultTarget: b.defaultTarget };
      // 直前に worker が「どれですか」と聞き返していたなら、この依頼はその返事。元の依頼とつなげて読む（声で「1番」「アプリ本体のほう」とだけ答えられるように）
      const pending = findPendingAsk(all, req.id);
      let text = req.body;
      let result = resolveTargetRepos(req.body, resolveOpts);
      if (pending) {
        text = `${pending.originBody}\n${req.body}`;
        const picked = pickByOrdinal(req.body, pending.candidates);
        if (picked) {
          result = workable.some((r) => r.toLowerCase() === picked.toLowerCase())
            ? { status: 'one', repo: picked, candidates: [picked], hosts: [] }
            : { status: 'not_workable', candidates: [picked], hosts: [] };
        } else if (result.status !== 'one') {
          result = resolveTargetRepos(text, resolveOpts);
        }
        log('受付 ' + req.id + ': 聞き返し（コメント ' + pending.askCommentId + '）への返事として、元の依頼（' + pending.originId + '）とつなげて読んだ → ' + result.status);
      }
      if (result.status !== 'one' || !result.repo) {
        log(`受付 ${req.id}: 対象が決まらない（${result.status}）→ 聞き返す`);
        saveInboxLastId(b, req.id);
        comment(b.repo, b.issue, askText({ commentId: req.id, result }));
        appendRun({ kind: 'intake', repo: b.repo, issue: b.issue, outcome: `ask_${result.status}` });
        continue;
      }
      const w = buildWorkIssue({ text, commentUrl, inbox: { repo: b.repo, issue: b.issue, commentId: req.id } });
      const created = ghWriteJson(['api', '-X', 'POST', `repos/${result.repo}/issues`, '-f', `title=${redact(w.title)}`, '-f', `body=${redact(w.body)}`, '-f', `labels[]=${LABELS.task}`]);
      if (dryRun) { log(`(dry-run) 受付 ${req.id} → ${result.repo} に作業用 Issue を作る予定`); continue; }
      if (!created || !Number.isInteger(created.number)) throw new Error('作業用 Issue の作成結果が読めなかった');
      // 先に「ここまで処理した」を記録する（作成後に落ちても、同じ依頼から二重に Issue を作らない）
      saveInboxLastId(b, req.id);
      const labelled = Array.isArray(created.labels) && created.labels.some((l) => (typeof l === 'string' ? l : l && l.name) === LABELS.task);
      comment(b.repo, b.issue, labelled
        ? ackText({ commentId: req.id, repo: result.repo, issueNumber: created.number, issueUrl: created.html_url || `https://github.com/${result.repo}/issues/${created.number}` })
        : `<!-- idea-pipeline:ack comment=${req.id} -->\n依頼から管理番号 #${created.number} を作りましたが、作業開始の目印（ラベル）が付かず、作業を始められません。あなたの確認が必要です。`);
      appendRun({ kind: 'intake', repo: result.repo, issue: created.number, outcome: labelled ? 'issue_created' : 'issue_created_without_label', inboxComment: req.id });
      log(`受付 ${req.id}: ${result.repo}#${created.number} を作った`);
    }
    if (maxSeen > lastId) saveInboxLastId(b, Math.max(maxSeen, readInboxLastId(b) ?? 0));
  }

  // ───────── 失敗の記録 ─────────
  /** いま作業中の Issue（fail が受付へ報告するため）。 */
  let currentIssue = null;
  function fail(repo, n, reason, extra = {}) {
    log(`#${n} 失敗: ${reason}`);
    removeLabel(repo, n, LABELS.working);
    addLabel(repo, n, LABELS.failed);
    comment(repo, n, `❌ 自動実装は止まりました。\n\n理由: ${reason}\n\n（人の確認が必要です。再実行したいときは \`${LABELS.failed}\` ラベルを外してください。）`);
    appendRun({ kind: 'work', repo, issue: n, outcome: 'failed', reason: redact(reason).slice(0, 300), ...extra });
    // 受付へは短く。理由の後半（この PC の作業ツリーのパス等）は書かない
    if (currentIssue && currentIssue.number === n) notifyInbox(currentIssue, repo, 'failed', { detail: String(reason).split('\n\n')[0].slice(0, 300) });
  }

  // ───────── 作業の周回 ─────────
  /**
   * @param {string} repo
   * @param {{path:string, gateCommand?:string[], installCommand?:string[]}} rc
   * @param {any} issue
   */
  function processIssue(repo, rc, issue) {
    const n = issue.number;
    const t0 = now();
    let branch;
    try {
      branch = branchNameFor(n);
    } catch (e) {
      return fail(repo, n, String(e instanceof Error ? e.message : e));
    }
    if (!isSafePushBranch(branch)) return fail(repo, n, `作業ブランチ名が安全でない: ${branch}`);

    let base;
    try {
      base = defaultBranch(repo);
    } catch (e) {
      return fail(repo, n, String(e instanceof Error ? e.message : e));
    }

    const remoteHas = git(rc.path, ['ls-remote', '--heads', 'origin', branch]);
    if (remoteHas.status !== 0) return fail(repo, n, `リモートの確認に失敗: ${redact(remoteHas.stderr).slice(0, 200)}`);
    if (remoteHas.stdout.trim()) return fail(repo, n, `ブランチ ${branch} が既にリモートにある（上書きしない）`);

    if (dryRun) {
      log(`(dry-run) #${n} 「${issue.title}」を ${repo} の ${base} から ${branch} で実装する予定`);
      return;
    }

    addLabel(repo, n, LABELS.working);
    comment(repo, n, `🛠 着手します（ブランチ \`${branch}\`・最大 ${cfg.maxTurns} ターン）。結果はこの Issue に書きます。`);
    appendRun({ kind: 'work', repo, issue: n, outcome: 'started' });

    const fetch = git(rc.path, ['fetch', 'origin', base]);
    if (fetch.status !== 0) return fail(repo, n, `git fetch に失敗: ${redact(fetch.stderr).slice(0, 200)}`);

    const wt = path.join(stateDir, 'work', `${repo.replace('/', '__')}-${n}-${now()}`);
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    const add = git(rc.path, ['worktree', 'add', '-b', branch, wt, `origin/${base}`]);
    if (add.status !== 0) return fail(repo, n, `worktree の作成に失敗: ${redact(add.stderr).slice(0, 200)}`);

    let keep = false;
    /** @param {string} reason @param {object} [extra] */
    const failKeep = (reason, extra = {}) => {
      keep = Boolean(cfg.keepFailedWorktrees);
      fail(repo, n, keep ? `${reason}\n\n作業途中の内容はこの PC に残してあります: \`${wt}\`` : reason, { durationMs: now() - t0, ...extra });
    };

    try {
      if (rc.installCommand && rc.installCommand.length) {
        const ins = run(rc.installCommand, [], { cwd: wt, timeoutMs: 20 * 60 * 1000 });
        if (ins.status !== 0) return failKeep(`依存のインストールに失敗: ${redact(ins.stderr || ins.error).slice(0, 300)}`);
      }

      // ── claude を実行。課金が API に切り替わらないよう、キー類を環境から外す ──
      const childEnv = { ...process.env };
      for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) delete childEnv[k];
      const prompt = buildPrompt({ repo, number: n, title: issue.title || '', body: issue.body || '', branch });
      const cl = run(
        cfg.claudeCommand,
        ['-p', '--output-format', 'json', '--max-turns', String(cfg.maxTurns), '--allowedTools', cfg.allowedTools.join(',')],
        { cwd: wt, input: prompt, timeoutMs: cfg.workTimeoutMinutes * 60 * 1000, env: childEnv }
      );
      if (cl.timedOut) return failKeep(`claude が ${cfg.workTimeoutMinutes} 分で終わらなかった（中断した）`);
      /** @type {any} */
      let out = null;
      try { out = JSON.parse(cl.stdout); } catch { /* 下で扱う */ }
      const meta = { numTurns: out && out.num_turns, claudeMs: out && out.duration_ms, denials: out && Array.isArray(out.permission_denials) ? out.permission_denials.length : undefined };
      if (cl.status !== 0 || !out) return failKeep(`claude の実行に失敗（exit=${cl.status}）: ${redact(cl.stderr || cl.error || cl.stdout).slice(0, 300)}`, meta);
      const summary = redact(String(out.result || '')).slice(0, 4000);
      if (out.is_error || (out.subtype && out.subtype !== 'success')) {
        return failKeep(`claude が正常に終わらなかった（${out.subtype || 'error'}）。最後の出力: ${summary.slice(0, 600)}`, meta);
      }
      if (/^\s*BLOCKED:/m.test(summary)) return failKeep(`claude が実装を止めた: ${summary.slice(0, 800)}`, meta);

      // ── 結果の検査（claude の自己申告を信じず、git の実物を見る） ──
      const cnt = git(wt, ['rev-list', '--count', `origin/${base}..HEAD`]);
      if (cnt.status !== 0 || !(Number(cnt.stdout.trim()) > 0)) {
        const dirty = git(wt, ['status', '--porcelain']).stdout.trim();
        return failKeep(dirty ? 'コミットが無い（未コミットの変更が残っている）' : '変更が1件も無い', meta);
      }
      const names = git(wt, ['diff', '--name-only', `origin/${base}...HEAD`]);
      const files = names.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      if (names.status !== 0 || files.length === 0) return failKeep('変更ファイルの一覧が取れなかった', meta);
      const forbidden = findForbiddenPaths(files, cfg.forbiddenPaths);
      if (forbidden.length) return failKeep(`触ってはいけない場所が差分に含まれていた（push しない）: ${forbidden.join(', ')}`, meta);
      if (files.length > cfg.maxChangedFiles) return failKeep(`差分が大きすぎる（${files.length} ファイル > ${cfg.maxChangedFiles}）`, meta);
      const dirtyAfter = git(wt, ['status', '--porcelain']).stdout.trim();

      // ── ゲート（任意）。ワーカー自身が実行して結果を事実として残す ──
      let gateLine = '未実行（このリポにゲートの設定が無い）';
      if (rc.gateCommand && rc.gateCommand.length) {
        const g = run(rc.gateCommand, [], { cwd: wt, timeoutMs: 20 * 60 * 1000 });
        if (g.status !== 0) return failKeep(`ゲート（${rc.gateCommand.join(' ')}）が失敗: ${redact(g.stdout + g.stderr).slice(-600)}`, meta);
        gateLine = `成功（${rc.gateCommand.join(' ')}）`;
      }

      // ── push と PR 作成。行き先は ai/issue-N のみ・force 無し・マージしない ──
      const push = git(wt, ['push', 'origin', `${branch}:${branch}`]);
      if (push.status !== 0) return failKeep(`push に失敗: ${redact(push.stderr).slice(0, 300)}`, meta);
      const stat = git(wt, ['diff', '--stat', `origin/${base}...HEAD`]).stdout.trim().split('\n').slice(-12).join('\n');
      const body = [
        `Closes #${n}`,
        '',
        '## 何を・なぜ（Claude Code の最終報告。人が確かめるまで鵜呑みにしないこと）',
        summary,
        '',
        '## このワーカーが機械的に確かめたこと',
        `- コミット数: ${cnt.stdout.trim()}／変更ファイル: ${files.length}（触ってはいけない場所: なし）`,
        `- ワーカー側のゲート: ${gateLine}`,
        dirtyAfter ? '- ⚠ 作業ツリーに未コミットの変更が残っていた（PR には含まれていない）' : '- 未コミットの変更: なし',
        '',
        '```',
        stat,
        '```',
        '',
        '> 自動生成の PR です。**マージは人が確認してから**。チェックが通っても「正しい」とは限りません。',
      ].join('\n');
      const pr = gh(['pr', 'create', '-R', repo, '--base', base, '--head', branch, '--title', `AI: ${String(issue.title || '').slice(0, 80)}`, '--body', redact(body)]);
      if (pr.status !== 0) return failKeep(`PR の作成に失敗（ブランチ ${branch} は push 済み）: ${redact(pr.stderr).slice(0, 300)}`, meta);
      const prUrl = pr.stdout.trim().split('\n').pop();

      removeLabel(repo, n, LABELS.working);
      addLabel(repo, n, LABELS.prOpen);
      comment(repo, n, `📝 PR を作りました: ${prUrl}\n\nまだ「完了」ではありません。PR のチェック結果を確かめたら、この Issue に事実を書きます。マージは人の確認待ちです。`);
      appendRun({ kind: 'work', repo, issue: n, outcome: 'pr_created', durationMs: now() - t0, pr: prUrl, files: files.length, ...meta });
      notifyInbox(issue, repo, 'pr_created', { prUrl });
      log(`#${n} PR 作成: ${prUrl}`);
    } finally {
      if (!keep) {
        git(rc.path, ['worktree', 'remove', '--force', wt]);
        git(rc.path, ['branch', '-D', branch]);
      }
    }
  }

  // ───────── 事実確認の周回 ─────────
  /** @param {string} repo @param {any} issue */
  function verifyIssue(repo, issue) {
    const n = issue.number;
    const prNum = findPrNumberForIssue(ghJson, repo, n);
    if (prNum === null) {
      log(`#${n} PR が見つからない（${branchNameFor(n)}）`);
      return;
    }
    const facts = fetchPrFacts(ghJson, repo, prNum);
    const pr = facts.pr;
    const sha = facts.headSha;
    if (!sha) return;
    if (pr.state === 'closed' && !pr.merged) {
      removeLabel(repo, n, LABELS.prOpen);
      addLabel(repo, n, LABELS.failed);
      comment(repo, n, `⚠ PR #${prNum} はマージされずに閉じられました。この Issue の自動実装は未完了です。`);
      notifyInbox(issue, repo, 'pr_closed');
      appendRun({ kind: 'verify', repo, issue: n, outcome: 'pr_closed' });
      return;
    }
    const v = computeVerdict({ state: pr.state, merged: pr.merged === true, headSha: sha }, facts.checkRuns, facts.status);
    const marker = `<!-- idea-pipeline:verify sha=${sha.slice(0, 12)} verdict=${v.verdict} -->`;

    const terminal = v.verdict === 'success' || v.verdict === 'failure';
    const createdMs = Date.parse(pr.created_at || '');
    const graceOver = Number.isFinite(createdMs) && now() - createdMs > cfg.verifyGraceMinutes * 60 * 1000;
    if (!terminal && !(graceOver && (v.verdict === 'no_checks' || v.verdict === 'no_effective_checks'))) {
      log(`#${n} PR #${prNum} の判定は ${v.verdict}（まだ確定しない）`);
      return;
    }
    const c = ghJson(['api', `repos/${repo}/issues/${n}/comments?per_page=50`]);
    if (Array.isArray(c) && c.some((x) => String(x.body || '').includes(marker))) return; // 同じ事実は1回だけ書く

    const counts = `成功 ${v.counts.success}／失敗 ${v.counts.failure}／実行中 ${v.counts.pending}／スキップ ${v.counts.skipped}`;
    const merged = v.merged ? 'マージ済み' : '未マージ（人のレビュー待ち）';
    if (v.verdict === 'success') {
      comment(repo, n, `${marker}\n✅ 機械確認: PR #${prNum}（${sha.slice(0, 7)}）のチェックは全て成功 — ${counts}。${merged}。\n\n※「チェックが通った」は「内容が正しい」ではありません。マージ前に人が差分を確認してください。`);
      removeLabel(repo, n, LABELS.prOpen);
      addLabel(repo, n, LABELS.verified);
      notifyInbox(issue, repo, 'verified', { prUrl: pr.html_url, sha: sha.slice(0, 7) });
    } else if (v.verdict === 'failure') {
      comment(repo, n, `${marker}\n❌ 機械確認: PR #${prNum}（${sha.slice(0, 7)}）のチェックに失敗があります — ${counts}。\n${v.reasons.map((r) => `- ${r}`).join('\n')}\n\n${merged}。修正が必要です。`);
      removeLabel(repo, n, LABELS.prOpen);
      addLabel(repo, n, LABELS.checkFailed);
      notifyInbox(issue, repo, 'check_failed', { prUrl: pr.html_url, sha: sha.slice(0, 7), detail: v.reasons.join('／').slice(0, 300) });
    } else {
      comment(repo, n, `${marker}\n❔ 未確認: PR #${prNum}（${sha.slice(0, 7)}）は、${v.reasons.join('／') || v.verdict}。「成功」とは言えません。${merged}。`);
      notifyInbox(issue, repo, 'unverified', { prUrl: pr.html_url, sha: sha.slice(0, 7) });
    }
    appendRun({ kind: 'verify', repo, issue: n, outcome: v.verdict, pr: prNum });
  }

  // ───────── 1周 ─────────
  /** @param {{verifyOnly?:boolean}} [o] */
  function runOnce(o = {}) {
    if (fs.existsSync(pausePath)) {
      log(`PAUSE ファイルがあるので何もしない（${pausePath}）。再開するにはこのファイルを消す。`);
      return { ok: true, paused: true };
    }
    if (!acquireLock()) {
      log('別の周回が動いている（ロックあり）。何もしない。');
      return { ok: true, locked: true };
    }
    try {
      // 0. 受付（Grok に普通に話した依頼を、作業用 Issue にして「わかりました」と返す）。claude は使わないので回数上限の対象外
      for (const b of cfg.inboxes) {
        try { intakeInbox(b); } catch (e) { log(`受付 ${b.repo}#${b.issue} で例外: ${e instanceof Error ? e.message : e}`); }
      }
      for (const [repo, rc] of Object.entries(cfg.repos)) {
        // 1. 事実確認（PR を作った Issue のチェック結果を確かめて書く）
        try {
          const open = ghJson(['api', `repos/${repo}/issues?state=open&labels=${LABELS.prOpen}&per_page=50`]);
          for (const issue of Array.isArray(open) ? open : []) {
            if (issue.pull_request) continue;
            try { verifyIssue(repo, issue); } catch (e) { log(`#${issue.number} 確認で例外: ${e instanceof Error ? e.message : e}`); }
          }
        } catch (e) {
          log(`${repo} 確認パスで例外: ${e instanceof Error ? e.message : e}`);
        }
        if (o.verifyOnly) continue;

        // 2. 作業（1周につき最大1件。コストと事故の範囲を絞る）
        if (dailyCapReached(readRuns(), now(), cfg.maxRunsPer24h)) {
          log(`${repo}: 24時間の上限（${cfg.maxRunsPer24h}回）に達したので着手しない`);
          continue;
        }
        let issues;
        try {
          issues = ghJson(['api', `repos/${repo}/issues?state=open&labels=${LABELS.task}&per_page=100`]);
        } catch (e) {
          log(`${repo} Issue 一覧の取得に失敗: ${e instanceof Error ? e.message : e}`);
          continue;
        }
        const { candidates, skipped } = selectCandidates(issues, { allowedAuthors: cfg.allowedAuthors });
        for (const s of skipped) if (dryRun) log(`(dry-run) #${s.number} は拾わない: ${s.reason}`);
        if (candidates.length === 0) {
          log(`${repo}: 拾う Issue は無い`);
          continue;
        }
        currentIssue = candidates[0];
        try { processIssue(repo, rc, candidates[0]); } finally { currentIssue = null; }
      }
      return { ok: true };
    } finally {
      releaseLock();
    }
  }

  return { runOnce, readRuns, processIssue, verifyIssue };
}

// ───────── --selftest（配布境界の都合で instrument-core を import せず、ここだけで完結させる） ─────────
function selftest() {
  const fails = [];
  const check = (name, cond) => { if (!cond) fails.push(name); };
  const issue = (o = {}) => ({ number: 1, labels: [{ name: LABELS.task }], user: { login: 'me' }, author_association: 'OWNER', ...o });
  check('許可外の作者を拾う（毒）', selectCandidates([issue({ user: { login: 'x' } })], { allowedAuthors: ['me'] }).candidates.length === 0);
  check('外部権限の作者を拾う（毒）', selectCandidates([issue({ author_association: 'NONE' })], { allowedAuthors: ['me'] }).candidates.length === 0);
  check('処理済みを拾い直す（毒）', selectCandidates([issue({ labels: [{ name: LABELS.task }, { name: LABELS.working }] })], { allowedAuthors: ['me'] }).candidates.length === 0);
  check('正当な Issue を拾えない（誤検知）', selectCandidates([issue()], { allowedAuthors: ['me'] }).candidates.length === 1);
  check('workflows の変更を見逃す（毒）', findForbiddenPaths(['.github/workflows/a.yml']).length === 1);
  check('普通のファイルを禁じる（誤検知）', findForbiddenPaths(['src/a.ts']).length === 0);
  check('トークンを伏せない（毒）', !redact('ghp_' + 'a'.repeat(36)).includes('ghp_a'));
  check('main への push を許す（毒）', !isSafePushBranch('main'));
  check('チェック0件を成功にする（毒）', computeVerdict({ merged: false }, [], null).verdict !== 'success');
  check('スキップだけを成功にする（毒）', computeVerdict({ merged: false }, [{ status: 'completed', conclusion: 'skipped' }], null).verdict !== 'success');
  check('失敗を成功で隠す（毒）', computeVerdict({ merged: false }, [{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'failure' }], null).verdict === 'failure');
  check('壊れた上限で動く（毒）', dailyCapReached([], Date.now(), NaN) === true);
  check('PR 不明を成功にする（毒）', computeVerdict(null, [], null).verdict === 'unknown');
  // 受付（Grok に普通に話した依頼）
  const cm = (o = {}) => ({ id: 5, body: '依頼', user: { login: 'me' }, author_association: 'OWNER', ...o });
  check('許可外の作者の受付コメントを拾う（毒）', selectNewInboxComments([cm({ user: { login: 'x' } })], { allowedAuthors: ['me'], lastId: 0 }).requests.length === 0);
  check('worker 自身の返事を依頼として拾い直す（毒）', selectNewInboxComments([cm({ body: ackText({ commentId: 1, repo: 'o/r', issueNumber: 1, issueUrl: 'u' }) })], { allowedAuthors: ['me'], lastId: 0 }).requests.length === 0);
  check('正当な受付コメントを拾えない（誤検知）', selectNewInboxComments([cm()], { allowedAuthors: ['me'], lastId: 0 }).requests.length === 1);
  check('サイトが無い依頼の対象を勝手に決める（毒）', resolveTargetRepos('直して', { workableRepos: ['o/r'] }).status !== 'one');
  check('作業できないリポを対象にする（毒）', resolveTargetRepos('a.example.com', { workableRepos: ['o/r'], aliases: { 'a.example.com': 'o/other' } }).status !== 'one');
  if (fails.length) {
    console.error('❌ selftest 失敗:\n' + fails.map((f) => '  - ' + f).join('\n'));
    process.exit(1);
  }
  console.log('✅ selftest: 作者の限定・差分の検査・秘密の伏せ・成功判定・回数上限の毒入力で、すべて想定どおり止まった');
  process.exit(0);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return selftest();
  const ci = argv.indexOf('--config');
  const cfg = loadConfig(ci >= 0 ? argv[ci + 1] : undefined);
  const p = createPipeline({ cfg, dryRun: argv.includes('--dry-run') });
  if (argv.includes('--status')) {
    const s = summarizeRuns(p.readRuns(), Date.now());
    console.log(JSON.stringify({ ...s, cap: cfg.maxRunsPer24h, note: 'サブスク枠の残量は測れない。回数と所要時間だけ。' }, null, 2));
    return;
  }
  p.runOnce({ verifyOnly: argv.includes('--verify-only') });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    main();
  } catch (e) {
    console.error('worker: ' + redact(e instanceof Error ? e.message : String(e)));
    process.exit(2);
  }
}

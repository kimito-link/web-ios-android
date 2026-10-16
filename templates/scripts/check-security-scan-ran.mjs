#!/usr/bin/env node
/**
 * check-security-scan-ran.mjs — ★公開前に「いまのコードに対して」Claude Security のスキャンを走らせたかを確かめる。
 *
 * ─────────────────────────────────────────────────
 * ■ なぜ要るか（2026-10-16、公開前の最低4問 docs/ai-rules/01_CORE_RULES.md §5-1 の実行手段）
 *   Anthropic 公式の Claude Security プラグイン（`/claude-security`、anthropics/claude-plugins-official、
 *   v0.12.0 で確認）は、アーキテクチャの把握・脅威モデル・全コンポーネントの探索・各指摘の独立検証までを
 *   Claude Code のセッション内で行う。車輪の再発明をしない（CLAUDE.md 基準②）ので、4問の②③
 *   （認可の穴・他人データの穴）を調べる第一の手段はこのプラグインにする。
 *   ★ただし「走らせた」という事実は人の記憶に頼ると腐る。スキャンは結果ディレクトリ
 *     `CLAUDE-SECURITY-<時刻>/` に刻印 `CLAUDE-SECURITY-REVISION-<sha12>[-dirty].json` を残す
 *     （どのコミットを調べたか・重大度ごとの件数が入っている）ので、それを機械で読む。
 *
 * ■ 判定（客観的事実だけ。★指摘の中身や網羅性の妥当さは見ない＝意味判断）
 *   0 = いまの HEAD に対するスキャンがあり、CRITICAL / HIGH が 0 件
 *   1 = 測れた上での赤: いまの HEAD に対するスキャンに CRITICAL / HIGH が残っている
 *   2 = ★測れなかった（これは「安全」ではない）:
 *         ・スキャンの刻印が無い（一度も走らせていない／結果ディレクトリを消した）
 *         ・最後のスキャンが HEAD より古い（それ以後のコミットは未スキャン）
 *   ★「走らせていない」を赤にしない（改善台帳の規約③と同じ。赤にすると、通すためだけに形だけ走らせる
 *     動機を作る）。ただし緑にもしない＝exit 2 で鳴らし続ける。
 *
 * ■ 注意（過信を防ぐ）
 *   ・スキャンは非決定的（同じコードでも指摘が変わる）。★「0件」は「安全」の証明ではない。
 *     SAST・依存の脆弱性検査・コードレビューの代わりではなく補完（公式 README の記述）。
 *   ・結果ディレクトリは自前の .gitignore を持つ＝コミットされない。この検査は【手元の作業ツリー】を見る。
 *   ・スキャン対象は自分のコード。信頼できないリポジトリは sandbox-runtime の中で（公式の推奨）。
 *   ・実行のたびに時間とトークンの確認が出る。公開前・大きな変更の後に絞って走らせる。
 *
 * ■ 使い方
 *   node check-security-scan-ran.mjs [対象リポのディレクトリ]   # 省略時は cwd
 *   node check-security-scan-ran.mjs --selftest                 # 毒→赤／正→緑
 *   （スキャンの導入: /plugin install claude-security@claude-plugins-official → /reload-plugins → /claude-security）
 * ─────────────────────────────────────────────────
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STAMP_RE = /^CLAUDE-SECURITY-REVISION-.+\.json$/;

// ---- 純ロジック（fs/git非依存・単体テスト可） --------------------------------

/**
 * 刻印 JSON（render_report.py が書くもの）から、判定に要る事実だけを取り出す。
 * ★形が想定と違えば null（読めなかった＝測れなかった。0件として扱わない）。
 * @param {unknown} json
 * @returns {{commit:string, dirty:boolean, at:string, mode:string, effort:string,
 *            critical:number, high:number, medium:number, low:number, total:number}|null}
 */
export function readStamp(json) {
  if (!json || typeof json !== 'object') return null;
  const j = /** @type {Record<string, any>} */ (json);
  const commit = j.revision && typeof j.revision === 'object' ? j.revision.commit : null;
  const f = j.findings && typeof j.findings === 'object' ? j.findings : null;
  if (typeof commit !== 'string' || !/^[0-9a-f]{7,40}$/i.test(commit) || !f) return null;
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const critical = n(f.critical), high = n(f.high), medium = n(f.medium), low = n(f.low), total = n(f.total);
  if (critical === null || high === null) return null; // ★件数が読めない刻印を「0件」にしない
  return {
    commit: commit.toLowerCase(),
    dirty: j.revision.dirty !== false, // ★false と明記されたときだけクリーン（公式のファイル名規則と同じ）
    at: typeof j.generated_at === 'string' ? j.generated_at : '',
    mode: typeof j.mode === 'string' ? j.mode : '',
    effort: typeof j.effort === 'string' ? j.effort : String(j.effort ?? ''),
    critical, high, medium: medium ?? 0, low: low ?? 0, total: total ?? critical + high + (medium ?? 0) + (low ?? 0)
  };
}

/**
 * @param {{stamp: ReturnType<typeof readStamp>|null, head: string|null, behind: number|null}} input
 *   behind = 刻印のコミットから HEAD までのコミット数（刻印のコミットが履歴に無ければ null）
 * @returns {{exit:0|1|2, lines:string[]}}
 */
export function judge({ stamp, head, behind }) {
  if (!stamp) {
    return { exit: 2, lines: [
      '🟡 Claude Security のスキャン結果（刻印）が見つかりません。★「安全」ではなく【測れていません】。',
      '   → 直し方: `/claude-security`（初回は `/plugin install claude-security@claude-plugins-official` → `/reload-plugins`）。',
      '   → 公開前・大きな変更の後に走らせる。実行のたびに時間とトークンの確認が出る。'
    ] };
  }
  const short = stamp.commit.slice(0, 7);
  const counts = `CRITICAL ${stamp.critical} / HIGH ${stamp.high} / MEDIUM ${stamp.medium} / LOW ${stamp.low}`;
  const dirtyNote = stamp.dirty ? '（未コミットの変更を含むスキャン）' : '';
  const mode = stamp.mode ? ` モード=${stamp.mode}` : '';
  if (behind === null || head === null) {
    return { exit: 2, lines: [
      `🟡 最後のスキャン(${short})が、いまの履歴のどこに当たるか分かりません（別ブランチ／履歴が浅い）。★測れていません。`,
      `   最後のスキャン: ${counts}${mode}${dirtyNote}`
    ] };
  }
  if (behind > 0) {
    return { exit: 2, lines: [
      `🟡 最後のスキャン(${short})より後に ${behind} コミットあります。★いまのコードは未スキャンです（測れていません）。`,
      `   最後のスキャン: ${counts}${mode}${dirtyNote}`,
      '   → 直し方: 変更の差分だけなら `/claude-security scan my branch at high`。公開前は全体を。'
    ] };
  }
  if (stamp.critical > 0 || stamp.high > 0) {
    return { exit: 1, lines: [
      `🔴 いまのコード(${short})のスキャンに、重大な指摘が残っています: ${counts}${mode}${dirtyNote}`,
      '   → 直し方: CLAUDE-SECURITY-<時刻>/CLAUDE-SECURITY-RESULTS.md を読み、直す。`/claude-security` の「Suggest patches」で修正案(patch)を作れる（適用は自分で）。',
      '   ★指摘は各1件が独立検証を通ったもの。「誤検知だろう」で外さず、根拠を確かめてから判断する。'
    ] };
  }
  return { exit: 0, lines: [
    `✅ いまのコード(${short})に対するスキャンあり。重大な指摘なし: ${counts}${mode}${dirtyNote}`,
    '   ★「0件」は安全の証明ではない（スキャンは非決定的）。SAST・依存検査・レビューの代わりではなく補完。'
  ] };
}

// ---- I/O（直接実行時のみ） ------------------------------------------------------

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** 結果ディレクトリ直下の刻印のうち、最新（generated_at、無ければ更新時刻）のもの。 */
function latestStamp(root) {
  const found = [];
  let dirs = [];
  try { dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && /^CLAUDE-SECURITY-/.test(d.name)); } catch { /* */ }
  for (const d of dirs) {
    let files = [];
    try { files = readdirSync(join(root, d.name)).filter((f) => STAMP_RE.test(f)); } catch { /* */ }
    for (const f of files) {
      try {
        const stamp = readStamp(JSON.parse(readFileSync(join(root, d.name, f), 'utf8')));
        if (stamp) found.push(stamp);
      } catch { /* 壊れた刻印は無視（読めなかった＝見つからなかった側に倒す） */ }
    }
  }
  found.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return found[0] || null;
}

function run(argv) {
  const target = resolve(argv.slice(2).find((a) => !a.startsWith('--')) || process.cwd());
  const stamp = latestStamp(target);
  let head = null, behind = null;
  try {
    head = git(['rev-parse', 'HEAD'], target).toLowerCase();
    if (stamp) {
      try { behind = Number(git(['rev-list', '--count', `${stamp.commit}..HEAD`], target)); } catch { behind = null; }
      if (stamp.commit.length >= 40 && stamp.commit === head) behind = 0;
    }
  } catch { head = null; }
  const r = judge({ stamp, head, behind });
  for (const l of r.lines) (r.exit === 1 ? console.error : console.log)(`[check-security-scan-ran] ${l}`);
  return r.exit;
}

// ---- selftest（★終了コードだけでなく、期待した理由で赤/黄になるかを見る） ----------------

function selftest() {
  const fails = [];
  const expect = (name, cond) => { if (!cond) fails.push(name); };
  const stampJson = (commit, f, dirty = false) => ({
    generated_at: '2026-10-16T00:00:00+00:00', mode: 'codebase', effort: 'high',
    revision: { commit, dirty }, findings: { total: f.c + f.h, critical: f.c, high: f.h, medium: 0, low: 0 }
  });

  // 純ロジック
  expect('刻印なし→2', judge({ stamp: null, head: 'a'.repeat(40), behind: null }).exit === 2);
  const clean = readStamp(stampJson('a'.repeat(40), { c: 0, h: 0 }));
  expect('HEADでクリーン→0', judge({ stamp: clean, head: 'a'.repeat(40), behind: 0 }).exit === 0);
  const bad = readStamp(stampJson('a'.repeat(40), { c: 0, h: 2 }));
  expect('HEADでHIGH残り→1', judge({ stamp: bad, head: 'a'.repeat(40), behind: 0 }).exit === 1);
  expect('HEADより古い→2（件数が0でも緑にしない）', judge({ stamp: clean, head: 'b'.repeat(40), behind: 3 }).exit === 2);
  expect('履歴に無いコミット→2', judge({ stamp: clean, head: 'b'.repeat(40), behind: null }).exit === 2);
  expect('件数が読めない刻印は null（0件扱いしない）', readStamp({ revision: { commit: 'a'.repeat(40) }, findings: {} }) === null);
  expect('commit が無い刻印は null', readStamp({ findings: { critical: 0, high: 0 } }) === null);
  expect('dirty:false だけがクリーン', readStamp(stampJson('a'.repeat(40), { c: 0, h: 0 }, false))?.dirty === false
    && readStamp({ ...stampJson('a'.repeat(40), { c: 0, h: 0 }), revision: { commit: 'a'.repeat(40) } })?.dirty === true);

  // 実git: 一時リポで end-to-end
  const self = fileURLToPath(import.meta.url);
  const tmp = mkdtempSync(join(tmpdir(), 'scan-ran-selftest-'));
  try {
    const g = (a) => spawnSync('git', a, { cwd: tmp, encoding: 'utf8' });
    g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@example.com']); g(['config', 'user.name', 't']);
    writeFileSync(join(tmp, 'a.txt'), '1\n'); g(['add', '.']); g(['commit', '-q', '-m', 'one']);
    const sha = g(['rev-parse', 'HEAD']).stdout.trim();
    const run1 = () => spawnSync('node', [self, tmp], { encoding: 'utf8' });
    expect('実git: スキャン無し→exit 2', run1().status === 2);
    const dir = join(tmp, 'CLAUDE-SECURITY-20261016T000000Z'); mkdirSync(dir);
    writeFileSync(join(dir, `CLAUDE-SECURITY-REVISION-${sha.slice(0, 12)}.json`), JSON.stringify(stampJson(sha, { c: 0, h: 0 })));
    expect('実git: HEADでクリーン→exit 0', run1().status === 0);
    writeFileSync(join(dir, `CLAUDE-SECURITY-REVISION-${sha.slice(0, 12)}.json`), JSON.stringify(stampJson(sha, { c: 1, h: 0 })));
    const red = run1();
    expect('実git: HEADでCRITICAL→exit 1', red.status === 1);
    expect('実git: 赤の理由に件数が出る', /CRITICAL 1/.test(red.stderr || ''));
    writeFileSync(join(tmp, 'a.txt'), '2\n'); g(['add', '.']); g(['commit', '-q', '-m', 'two']);
    expect('実git: コミットが進んだら未スキャン→exit 2', run1().status === 2);
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  if (fails.length > 0) {
    console.error(`[check-security-scan-ran] selftest 失敗 ${fails.length} 件:`);
    for (const f of fails) console.error(`  ✗ ${f}`);
    return 1;
  }
  console.log('[check-security-scan-ran] selftest OK（刻印なし→黄／HEADでクリーン→緑／重大残り→赤／古い→黄）。');
  return 0;
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) process.exit(process.argv.includes('--selftest') ? selftest() : run(process.argv));

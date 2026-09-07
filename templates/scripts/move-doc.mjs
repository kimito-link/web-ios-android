#!/usr/bin/env node
/**
 * ファイルを移動し、その旧パスへの参照を横断的に書き換え、ゼロ確認まで行う。
 *
 * 【なぜ要るか】github直下の `fujisan-clean`→`compass` 等のリネームで、
 *   移動だけして参照を直さない事故が複数回起きた
 *   （web-ios-android/CLAUDE.md や kimitolink-linktree/CLAUDE.md に
 *   実在しない旧パス `AI汎用ルール/` が2026-09-07時点でも残っていた）。
 *   `grep -rn` の手作業は漏れる。棚卸し→移動→書き換え→ゼロ確認を
 *   1コマンドに固定し、機械にやらせる。
 *
 * 【責務は4段階】--apply が無ければ1段目（棚卸し表示）だけで終わる（既定dry-run・fail-closed）。
 *   1. 棚卸し: 表記ゆれ4種（相対パス/絶対パス/github/形式/ベース名のみ）で全参照を洗い出す
 *   2. 移動: 対象が git 追跡下なら `git mv`、そうでなければ `fs.renameSync`
 *   3. 書き換え: 1で見つけた行を新パスに置換（index.jsonはJSONとしてparseして書き換える）
 *   4. ゼロ確認: 1を再実行し、スタブ以外のヒットが0件か、続けて hub.mjs doctor が緑かを見る
 *
 * 使い方:
 *   node move-doc.mjs --from <path> --to <path>                 棚卸し結果だけ表示（dry-run）
 *   node move-doc.mjs --from <path> --to <path> --apply          実際に移動・書き換え
 *   node move-doc.mjs --from <path> --to <path> --apply --stub   旧パスに移動先を示す1行ファイルを残す
 *   node move-doc.mjs --selftest                                 検査自体が壊れていないか確かめる
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, renameSync, mkdirSync, appendFileSync, rmSync, mkdtempSync } from "node:fs";
import { join, resolve, dirname, relative, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const apply = args.includes("--apply");
const stub = args.includes("--stub");
const selftest = args.includes("--selftest");

function argVal(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

/** 除外するディレクトリ。増やすときは理由をコメントで残すこと */
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".expo", ".expo-check",
  "playwright-report", "test-results", "qa-results", ".next", "coverage",
  // ★github直下の一時退避・バックアップ置き場。恒久参照ではないので検索しても意味が薄く、
  //   大量のクローン/バックアップを舐めて全走査が5分を超える原因になっていた（2026-09-07実測）
  "_backups", "_pending-deletion-review", "_enforcement-test", ".claude_backup_tsuioku",
]);

/**
 * 検索から除外するファイル（理由コメント必須。緩めすぎると漏れが起きる）
 * ★`ai-hub/history/` と `site/learnings/` は「過去にその名前が存在した事実」を書いた
 *   記録なので、旧パスへの言及が残っているのが正しい状態（設計書D-1）。
 * ★`site/hub/hub-data.json`（他の`site/hub/*.json`含む）は`ai-hub/index.json`から
 *   `npm run hub:page`で生成される生成物。テキスト置換で直接書き換えると正本(index.json)と
 *   生成物が食い違う「正本が2つ」状態になる。移動後は`npm run hub:page`で再生成すること
 *   （2026-09-07実運用で誤って直接書き換えてしまい、git checkoutで復元した実損あり）。
 */
const EXCLUDE_PATH_PATTERNS = [
  /[\\/]ai-hub[\\/]history[\\/]/,
  /[\\/]site[\\/]learnings[\\/]/,
  /[\\/]site[\\/]hub[\\/].*\.json$/,
];

const TEXT_EXT = new Set([".md", ".json", ".mjs", ".js", ".ts", ".yml", ".yaml", ".txt", ".sh", ".ps1"]);
const BINARY_LIKE = new Set([".zip", ".png", ".jpg", ".jpeg", ".gif", ".pdf", ".ico", ".woff", ".woff2", ".ttf"]);

function isTextFile(name) {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = name.slice(dot).toLowerCase();
  if (BINARY_LIKE.has(ext)) return false;
  return TEXT_EXT.has(ext);
}

/**
 * ディレクトリを再帰的に歩いてテキストファイルのパス一覧を返す（ドット始まりディレクトリは除外）。
 * ★`scripts/lib/hub-kit-matrix.mjs`の`walkFiles()`と同じ責務（再帰walk＋除外ディレクトリ）を持つが、
 *   意図的な複製（KEEP_SEPARATE、2026-09-07のCANONICAL CHECKでDECLARED）。
 *   `templates/scripts/`は配布先（他プロジェクト）にそのままコピーされる前提のファイルで、
 *   `scripts/lib/`（web-ios-androidキット自身専用、配布されない）をimportできない配布境界がある
 *   （`record-decision-receipt.mjs`の`findRepoRoot`と同型の既存パターン）。加えてこの`walk`は
 *   「テキスト拡張子のファイルだけ収集する」点が`walkFiles`（全ファイル収集）と異なる。
 *   Decision Receipt: `.decision-receipts.json`参照。
 */
function walk(dir, out = [], depth = 0) {
  if (depth > 12) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      walk(full, out, depth + 1);
    } else if (isTextFile(e.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * `~/.claude` 配下は、スキル・エージェント定義とCLAUDE.mdだけをピンポイントで見る。
 * ★以前は walk() が `.claude` 全体を再帰していたため、`.claude/projects`
 *   （Claude Codeのセッション履歴。実測2.2GB・約3000ファイル）まで全文検索対象になり、
 *   長時間ハングしかねない性能欠陥があった（2026-09-07発見、未実行のため実害なし）。
 *   参照書き換えが意味を持つのは「AIが読みに行く設定ファイル」だけなので、
 *   `skills/*​/SKILL.md`・`agents/**`・直下の`CLAUDE.md`に限定して個別に読む。
 */
function findClaudeConfigFiles(homeClaudeDir) {
  const out = [];
  if (!existsSync(homeClaudeDir)) return out;

  const claudeMd = join(homeClaudeDir, "CLAUDE.md");
  if (existsSync(claudeMd)) out.push(claudeMd);

  const skillsDir = join(homeClaudeDir, "skills");
  if (existsSync(skillsDir)) {
    let skillDirs;
    try {
      skillDirs = readdirSync(skillsDir, { withFileTypes: true });
    } catch {
      skillDirs = [];
    }
    for (const d of skillDirs) {
      if (!d.isDirectory()) continue;
      const skillMd = join(skillsDir, d.name, "SKILL.md");
      if (existsSync(skillMd)) out.push(skillMd);
    }
  }

  const agentsDir = join(homeClaudeDir, "agents");
  if (existsSync(agentsDir)) out.push(...walk(agentsDir));

  return out;
}

/**
 * 1つの from パスに対する検索パターン（表記ゆれ4種）を作る。
 * basename・スラッシュ/バックスラッシュ両対応・github直下相対パス。
 *
 * ★各needleに種類タグ(kind)を付ける。書き換え時に「相対パス表記だった行は
 *   新しい相対パスに、絶対パス表記だった行は新しい絶対パスに」と書き分けるため
 *   （元々は全needleを一律で絶対パス置換していたため、`../web-ios-android/docs/ai-workflows/COUNCIL-HOWTO.md`のような
 *   相対参照が書き換え後に絶対パス文字列に化けてしまう不具合があった。2026-09-07発見）。
 */
function buildPatterns(fromPath) {
  const basename = fromPath.split(/[\\/]/).pop();
  const unixRel = `../${basename}`;
  const winSepFrom = fromPath.replace(/\//g, "\\");
  const unixSepFrom = fromPath.replace(/\\/g, "/");
  const raw = [
    { kind: "relative", value: unixRel },
    { kind: "relative", value: `github/${basename}` },
    { kind: "relative", value: `github\\${basename}` },
    { kind: "absolute", value: unixSepFrom },
    { kind: "absolute", value: winSepFrom },
    { kind: "basename", value: basename },
  ];
  const seen = new Set();
  const tagged = [];
  for (const n of raw) {
    if (seen.has(n.value)) continue;
    seen.add(n.value);
    tagged.push(n);
  }
  return {
    basename,
    needles: tagged.map((n) => n.value),
    tagged,
  };
}

/**
 * 置換先の「表記」をneedleの種類に応じて作る。
 * relative/basename由来のneedleには新しい相対パス（githubRoot基準の `../` 形式）、
 * absolute由来のneedleには新しい絶対パスを充てる。
 */
function replacementFor(kind, toPath, githubRoot) {
  if (kind === "absolute") return toPath;
  const rel = relative(githubRoot, resolve(toPath)).split(sep).join("/");
  return `../${rel}`;
}

/** 1ファイルの中で、各needleが出現する行番号一覧を返す */
function findHitsInFile(filePath, needles) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const lines = text.split("\n");
  const hits = [];
  for (const needle of needles) {
    lines.forEach((line, i) => {
      if (line.includes(needle)) hits.push({ line: i + 1, needle, text: line.trim().slice(0, 160) });
    });
  }
  return hits;
}

function isExcludedPath(p) {
  return EXCLUDE_PATH_PATTERNS.some((re) => re.test(p));
}

/**
 * 棚卸し本体。githubRoot・homeClaudeDir・indexJsonPath を検索対象にする。
 * 戻り値: { file, hits: [{line, needle, text}] }[]
 *
 * `strictPathOnly: true` を渡すと、basename単体のneedleを検索対象から外す。
 * ★basenameは新パスの末尾にも必ず含まれる（ファイル名を変えていない限り）ため、
 *   basename単体で「参照が残っていないか」を検証すると、正しく書き換わった
 *   新しいパス文字列自身に誤ヒットして永遠に0件にならない。ゼロ確認（Step 4）は
 *   「旧パスの完全な表記（相対/絶対/github形式）」だけを見る必要がある。
 *   一方、棚卸し（Step 1、参照を見つける用途）ではbasename単体の言及も
 *   拾いたいので、そちらは既定のまま（strictPathOnly未指定）にする。
 */
function inventory({ githubRoot, homeClaudeDir, fromPath, excludeFiles = [], strictPathOnly = false }) {
  const { needles: allNeedles, tagged: allTagged, basename } = buildPatterns(fromPath);
  const tagged = strictPathOnly ? allTagged.filter((t) => t.kind !== "basename") : allTagged;
  const needles = tagged.map((t) => t.value);
  const targets = [];
  if (existsSync(githubRoot)) targets.push(...walk(githubRoot));
  if (homeClaudeDir) targets.push(...findClaudeConfigFiles(homeClaudeDir));

  const excludeSet = new Set(excludeFiles.map((f) => resolve(f)));
  const results = [];
  for (const file of targets) {
    if (isExcludedPath(file)) continue;
    // 自分自身（移動元/移動先ファイル）はここでは対象外
    if (resolve(file) === resolve(fromPath)) continue;
    if (excludeSet.has(resolve(file))) continue;
    const hits = findHitsInFile(file, needles);
    if (hits.length > 0) results.push({ file, hits });
  }
  // ★戻り値のtagged/needlesは常にフィルタなし（書き換え処理はbasenameも書き換える必要があるため）。
  //   strictPathOnlyはこの関数内部の「検索対象」だけに効かせる。
  return { results, needles: allNeedles, tagged: allTagged, basename };
}

/** index.json の path フィールドを対象に書き換える（テキスト置換ではなくJSONとして） */
function rewriteIndexJson(indexJsonPath, fromPath, toPath, githubRoot) {
  if (!existsSync(indexJsonPath)) return { changed: 0 };
  const raw = readFileSync(indexJsonPath, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { changed: 0, error: "index.json parse失敗" };
  }
  const fromRel = relative(githubRoot, resolve(fromPath)).split(sep).join("/");
  const toRel = relative(githubRoot, resolve(toPath)).split(sep).join("/");
  let changed = 0;
  const entries = Array.isArray(data.entries) ? data.entries : Array.isArray(data) ? data : [];
  for (const entry of entries) {
    if (entry && typeof entry.path === "string" && entry.path === fromRel) {
      entry.path = toRel;
      changed++;
    }
  }
  if (changed > 0) {
    writeFileSync(indexJsonPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  }
  return { changed };
}

/**
 * テキストファイル内の各needleを、その種類(kind)に応じた置換文字列に置き換える。
 * `tagged`は buildPatterns() が返す [{kind, value}] 配列。
 *
 * ★逐次置換（needleごとに順番に`split().join()`する）ではなく、
 *   元テキストに対する全needleのマッチ位置を**先に一括で**確定してから、
 *   後ろから前へ文字列を組み立てる。逐次方式だと、ある needle を置換した
 *   結果の文字列（例: 新しい絶対パス）に別の needle（例: basename）が
 *   偶然再マッチしてしまい、`../repoB/docs/../repoB/docs/...`のような
 *   カスケード置換が起きる（basenameは新パスの末尾にも必ず含まれるため。2026-09-07実測）。
 *   マッチ位置を先に確定すれば、置換後の文字列が再び走査されることはない。
 *   複数needleが重なる場合は「より長い（＝具体的な）needle」を優先する。
 */
function rewriteFile(filePath, tagged, toPath, githubRoot) {
  const text = readFileSync(filePath, "utf8");
  const sorted = [...tagged].sort((a, b) => b.value.length - a.value.length);

  // 1. 元テキストに対する全マッチ位置を集める（長いneedle優先、重複区間は除外）
  const matches = []; // {start, end, kind, value}
  for (const { kind, value } of sorted) {
    if (!value) continue;
    let idx = 0;
    while (true) {
      const found = text.indexOf(value, idx);
      if (found < 0) break;
      const end = found + value.length;
      const overlaps = matches.some((m) => found < m.end && end > m.start);
      if (!overlaps) matches.push({ start: found, end, kind, value });
      idx = found + 1;
    }
  }
  if (matches.length === 0) return false;

  // 2. 開始位置の昇順に並べ、非マッチ区間はそのまま・マッチ区間だけ置換後文字列にする
  matches.sort((a, b) => a.start - b.start);
  let result = "";
  let cursor = 0;
  for (const m of matches) {
    result += text.slice(cursor, m.start);
    result += replacementFor(m.kind, toPath, githubRoot);
    cursor = m.end;
  }
  result += text.slice(cursor);

  writeFileSync(filePath, result, "utf8");
  return true;
}

function isGitTracked(filePath) {
  try {
    const dir = dirname(filePath);
    execFileSync("git", ["ls-files", "--error-unmatch", filePath], { cwd: dir, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function out(obj, code) {
  if (asJson) {
    console.log(JSON.stringify(obj, null, 2));
  } else {
    console.log(obj.summary);
    if (obj.detail) console.log(obj.detail);
  }
  process.exit(code);
}

// ── --selftest ──────────────────────────────────────────
if (selftest) {
  const tmp = mkdtempSync(join(tmpdir(), "move-doc-selftest-"));
  try {
    const githubRoot = join(tmp, "github");
    const repoA = join(githubRoot, "repoA");
    const repoB = join(githubRoot, "repoB");
    mkdirSync(repoA, { recursive: true });
    mkdirSync(repoB, { recursive: true });

    const fromFile = join(githubRoot, "SOME-HOWTO.md");
    writeFileSync(fromFile, "# 中身\n");

    // 表記ゆれ4種をrepoA/CLAUDE.mdに埋め込む
    writeFileSync(join(repoA, "CLAUDE.md"), [
      "相対パス: ../SOME-HOWTO.md を読め",
      "github形式: github/SOME-HOWTO.md",
      "絶対パス: " + join(githubRoot, "SOME-HOWTO.md"),
      "ベース名のみ: SOME-HOWTO.mdを参照",
    ].join("\n"));

    // 除外対象（ai-hub/history配下）は拾わないことを確認
    const historyDir = join(githubRoot, "ai-hub", "history");
    mkdirSync(historyDir, { recursive: true });
    writeFileSync(join(historyDir, "log.md"), "かつて SOME-HOWTO.md という名前だった\n");

    const indexJsonPath = join(githubRoot, "ai-hub", "index.json");
    writeFileSync(indexJsonPath, JSON.stringify({ entries: [{ id: "x", path: "SOME-HOWTO.md" }] }, null, 2));

    const toFile = join(repoB, "docs", "SOME-HOWTO.md");

    const failures = [];

    // 1. 棚卸し: repoA/CLAUDE.mdの4種を検出し、history配下は除外されること
    const { results } = inventory({ githubRoot, homeClaudeDir: null, fromPath: fromFile });
    const claudeMdHit = results.find((r) => r.file === join(repoA, "CLAUDE.md"));
    if (!claudeMdHit || claudeMdHit.hits.length < 4) {
      failures.push(`✗ 棚卸し: repoA/CLAUDE.mdで表記ゆれ4種すべて検出できていない（検出${claudeMdHit?.hits.length ?? 0}件）`);
    }
    const historyHit = results.find((r) => r.file.includes(join("ai-hub", "history")));
    if (historyHit) {
      failures.push("✗ 棚卸し: ai-hub/history配下を除外できていない");
    }

    // 2. 移動
    mkdirSync(dirname(toFile), { recursive: true });
    renameSync(fromFile, toFile);
    if (existsSync(fromFile) || !existsSync(toFile)) {
      failures.push("✗ 移動: renameSyncが期待通り動作していない");
    }

    // 3. 書き換え
    const { tagged } = buildPatterns(fromFile);
    rewriteFile(join(repoA, "CLAUDE.md"), tagged, toFile, githubRoot);
    const { changed } = rewriteIndexJson(indexJsonPath, fromFile, toFile, githubRoot);
    if (changed !== 1) {
      failures.push(`✗ index.json書き換え: 1件変更されるはずが${changed}件だった`);
    }
    const afterText = readFileSync(join(repoA, "CLAUDE.md"), "utf8");
    // ★「SOME-HOWTO.mdという文字列が消えているか」ではなく「旧パス表記が残っていないか」を見る。
    //   新パスもファイル名としてSOME-HOWTO.mdを含むのは正常（basenameを変えていないため）。
    const oldFormsRemain = [
      "../SOME-HOWTO.md",
      "github/SOME-HOWTO.md",
      fromFile, // 旧絶対パス
    ].some((needle) => afterText.includes(needle));
    if (oldFormsRemain) {
      failures.push("✗ 書き換え: repoA/CLAUDE.mdに旧パス表記が残っている");
    }
    // ★不具合1の再発防止: 相対パス由来の参照(`../SOME-HOWTO.md`)は、書き換え後も
    //   絶対パスではなく新しい相対パス(`../repoB/docs/SOME-HOWTO.md`)になっていること
    const relLine = afterText.split("\n").find((l) => l.startsWith("相対パス:"));
    if (!relLine || relLine.includes(tmp) || !relLine.includes("../repoB/docs/SOME-HOWTO.md")) {
      failures.push(`✗ 書き換え: 相対パス参照が新しい相対パスになっていない（実際: ${relLine}）`);
    }
    // 絶対パス由来の参照は、書き換え後も絶対パスになっていること
    const absLine = afterText.split("\n").find((l) => l.startsWith("絶対パス:"));
    if (!absLine || !absLine.includes(toFile)) {
      failures.push(`✗ 書き換え: 絶対パス参照が新しい絶対パスになっていない（実際: ${absLine}）`);
    }
    // ベース名のみの言及も、新しい相対パスの言及に置き換わっていること（basenameそのまま残存ではない）
    const bareLine = afterText.split("\n").find((l) => l.startsWith("ベース名のみ:"));
    if (!bareLine || bareLine === "ベース名のみ: SOME-HOWTO.mdを参照" || !bareLine.includes("../repoB/docs/SOME-HOWTO.md")) {
      failures.push(`✗ 書き換え: ベース名のみの言及が新しいパスに置き換わっていない（実際: ${bareLine}）`);
    }

    // 4. ゼロ確認: 旧パス(fromFile)のneedleでもう一度inventoryして0件になること（history除く）
    const { results: after } = inventory({
      githubRoot,
      homeClaudeDir: null,
      fromPath: fromFile,
      excludeFiles: [toFile],
      strictPathOnly: true,
    });
    const remaining = after.filter((r) => !r.file.includes(join("ai-hub", "history")));
    if (remaining.length > 0) {
      failures.push(`✗ ゼロ確認: 旧パスへの参照が${remaining.length}ファイルに残っている（${remaining.map((r) => r.file).join(", ")}）`);
    }

    // ★不具合2の再発防止: ~/.claude/projects（セッション履歴、実運用で2.2GB）配下は
    //   検索対象にならないこと。擬似的な.claudeディレクトリを作って確認する。
    const fakeHomeClaudeDir = join(tmp, "fake-home", ".claude");
    const fakeProjectsDir = join(fakeHomeClaudeDir, "projects", "huge-session");
    mkdirSync(fakeProjectsDir, { recursive: true });
    writeFileSync(join(fakeProjectsDir, "transcript.jsonl"), "SOME-HOWTO.md への言及\n");
    const fakeSkillsDir = join(fakeHomeClaudeDir, "skills", "some-skill");
    mkdirSync(fakeSkillsDir, { recursive: true });
    writeFileSync(join(fakeSkillsDir, "SKILL.md"), "参照: ../SOME-HOWTO.md\n");
    const claudeFiles = findClaudeConfigFiles(fakeHomeClaudeDir);
    if (claudeFiles.some((f) => f.includes(join("projects", "huge-session")))) {
      failures.push("✗ .claude探索: projects配下（セッション履歴）まで検索してしまっている");
    }
    if (!claudeFiles.some((f) => f.endsWith(join("skills", "some-skill", "SKILL.md")))) {
      failures.push("✗ .claude探索: skills/*/SKILL.mdが検出できていない");
    }

    if (failures.length > 0) {
      out({ summary: `✗ selftest 失敗（${failures.length}件）`, detail: failures.join("\n") }, 1);
    }
    out({ summary: "✓ selftest 合格: 棚卸し・移動・書き換え・ゼロ確認のいずれも期待通り" }, 0);
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

// ── 本番 ────────────────────────────────────────────────
const fromArg = argVal("--from");
const toArg = argVal("--to");

if (!fromArg || !toArg) {
  out({ summary: "✗ 使い方: node move-doc.mjs --from <path> --to <path> [--apply] [--stub]" }, 2);
}

const fromPath = resolve(fromArg);
const toPath = resolve(toArg);

if (!existsSync(fromPath)) {
  out({ summary: `✗ 移動元が存在しない: ${fromPath}` }, 2);
}
if (existsSync(toPath)) {
  out({ summary: `✗ 移動先に既にファイルがある: ${toPath}` }, 2);
}

// githubRootの推定: fromPathを親に遡って「ai-hub」ディレクトリを含む階層を探す
function findGithubRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "ai-hub")) && existsSync(join(dir, "ai-hub", "index.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const githubRoot = findGithubRoot(dirname(fromPath)) ?? findGithubRoot(process.cwd());
if (!githubRoot) {
  out({ summary: "✗ githubルート（ai-hub/index.jsonを含む階層）が見つからない" }, 2);
}

const homeClaudeDir = process.env.USERPROFILE ? join(process.env.USERPROFILE, ".claude") : null;
const indexJsonPath = join(githubRoot, "ai-hub", "index.json");

// 1. 棚卸し
const { results, tagged, basename } = inventory({ githubRoot, homeClaudeDir, fromPath });

console.log(`棚卸し: ${basename} への参照を検索`);
console.log(`  検索対象: ${githubRoot}${homeClaudeDir ? " + " + homeClaudeDir : ""}`);
if (results.length === 0) {
  console.log("  ヒット: 0件（他からの参照は見つからなかった）");
} else {
  console.log(`  ヒット: ${results.length}ファイル`);
  for (const r of results) {
    console.log(`    ${r.file}`);
    for (const h of r.hits.slice(0, 5)) {
      console.log(`      L${h.line}: ${h.text}`);
    }
  }
}

if (!apply) {
  out({ summary: `\n(dry-run。実際に移動するには --apply を付ける)` }, 0);
}

// 2. 移動
mkdirSync(dirname(toPath), { recursive: true });
const tracked = isGitTracked(fromPath);
if (tracked) {
  try {
    execFileSync("git", ["mv", fromPath, toPath], { cwd: dirname(fromPath) });
  } catch {
    renameSync(fromPath, toPath);
  }
} else {
  renameSync(fromPath, toPath);
}
console.log(`\n移動: ${fromPath} → ${toPath}${tracked ? " (git mv)" : ""}`);

if (stub) {
  const deleteAfter = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  writeFileSync(fromPath, `moved to ${toPath}\nRemove after ${deleteAfter}.\n`, "utf8");
  const logPath = join(githubRoot, "ai-hub", "history", "moves.log");
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${new Date().toISOString()} ${fromPath} -> ${toPath} (stub until ${deleteAfter})\n`, "utf8");
  console.log(`スタブ作成: ${fromPath}（削除予定 ${deleteAfter}）`);
}

// 3. 書き換え
// ★index.jsonはrewriteIndexJson()専用（entry.pathフィールドだけをJSONとして書き換える）。
//   rewriteFile()の対象に含めると、テキスト置換がbasename等でpath文字列の一部にヒットし、
//   JSONとしての正しい書き換えの前に壊してしまう（2026-09-07実運用で発見）。
const indexJsonResolved = resolve(indexJsonPath);
let rewrittenFiles = 0;
for (const r of results) {
  if (resolve(r.file) === indexJsonResolved) continue;
  if (rewriteFile(r.file, tagged, toPath, githubRoot)) rewrittenFiles++;
}
const { changed: indexChanged } = rewriteIndexJson(indexJsonPath, fromPath, toPath, githubRoot);
console.log(`書き換え: ${rewrittenFiles}ファイル（+ index.json ${indexChanged}件）`);

// 4. ゼロ確認
// ★旧パス(fromPath)のneedle群でもう一度検索する（toPathのneedleで探すと、
//   basenameが新パスの末尾に必ず含まれるため新パス自身に誤ヒットしてしまう）。
//   新パス(toPath)自身とstubファイル(fromPath)は除外して見る。
const { results: remaining } = inventory({
  githubRoot,
  homeClaudeDir,
  fromPath,
  excludeFiles: [toPath],
  strictPathOnly: true,
});
const remainingNonStub = remaining.filter((r) => resolve(r.file) !== resolve(fromPath));

let doctorOk = true;
let doctorOutput = "";
try {
  doctorOutput = execFileSync("node", [join(githubRoot, "ai-hub", "bin", "hub.mjs"), "doctor"], {
    cwd: githubRoot,
    encoding: "utf8",
  });
} catch (e) {
  doctorOk = false;
  doctorOutput = e.stdout ?? String(e);
}

if (remainingNonStub.length > 0 || !doctorOk) {
  const detail = [
    "",
    remainingNonStub.length > 0 ? `旧パスへの参照が${remainingNonStub.length}ファイルに残っている:` : "",
    ...remainingNonStub.map((r) => `  ${r.file}`),
    !doctorOk ? "hub.mjs doctor が失敗した:" : "",
    !doctorOk ? doctorOutput : "",
  ].filter(Boolean).join("\n");
  out(
    { summary: "✗ ゼロ確認に失敗: 移動は済んだが参照が残っている（緑にしない）", detail },
    1,
  );
}

out({ summary: `✓ 完了: ${basename} を移動し、参照${rewrittenFiles}件を書き換え、ゼロ確認に合格した` }, 0);

#!/usr/bin/env node
/**
 * AI向け指示書（CLAUDE.md 等）が「実体を失っていないか」を検査する。
 *
 * 【なぜ要るか】2026-09-03、この検査を手で行ったところ CLAUDE.md が既に腐っていた。
 *   CLAUDE.md は最上位の指示として、次の3つを「使うこと」と命じていた:
 *     - fal_upload_helper.py        → ★このリポに存在しない
 *     - local_fal_upload.py         → ★このリポに存在しない
 *     - .env に書かれたキー          → ★.env が存在しない
 *   ★誰も気づかなかった。CIも赤にならない。ドキュメントの嘘は沈黙して腐る。
 *
 *   指示書は「人が書いて人が守る」ものなので、書いた人がいなくなると腐る。
 *   だからこの検査が要る。★人に気をつけさせるのではなく、機械に落とさせる。
 *
 * 【何を見るか】指示書の中の「実在を検証できる主張」だけを見る。
 *   散文（思想・方針・トーン）は検証不能なので触らない。
 *     1. `docs/FOO.md` のようなリポ内パス参照
 *     2. `foo.py` / `foo.mjs` のようなスクリプト名の言及
 *     3. `pnpm xxx` のような npm script の呼び出し
 *   ★「使うこと」と書かれた実体が消えていたら赤。
 *
 * 【3値で返す】0=合格 / 1=測れた上での赤 / 2=測れなかった
 *
 * 使い方:
 *   node scripts/check-doc-rot.mjs             CLAUDE.md を検査
 *   node scripts/check-doc-rot.mjs --json      JSON で出す
 *   node scripts/check-doc-rot.mjs --selftest  検査自体が壊れていないか確かめる
 *   node scripts/check-doc-rot.mjs --file X.md 対象を指定する
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const selftest = args.includes("--selftest");
const fileIdx = args.indexOf("--file");

/**
 * 検査対象のリポ。第1引数で指定できる（省略時は cwd）。
 * ★キット同梱版は「他リポを見に行く」のが本来の使い方なので、
 *   自分の置き場所ではなく対象ディレクトリを基準にする。
 */
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--file");
const ROOT = resolve(positional[0] ?? process.cwd());

/** 既定の検査対象。増やすときはここに足す */
const DEFAULT_TARGETS = ["CLAUDE.md"];

/**
 * 除外するパターン。
 * ★ここを緩めすぎると「いつも緑」になる。足すときは理由をコメントで残すこと。
 */
const IGNORE_MENTION = [
  // 一般名詞としてのファイル名。実体を指していない
  /^package\.json$/,
  /^tsconfig\.json$/,
  /^index\.(ts|tsx|js)$/,
  // 他リポの正本（このリポには無くて当然）
  /^AI_HARNESS_OPERATION\.md$/,
  /^TOKEN_SAVING_POLICY\.md$/,
];

/**
 * リポ内パス参照 `docs/FOO.md` `scripts/foo.mjs` 等
 *
 * ★このリポの外を指すものは検証しない（誤検知になるため）:
 *   - `../other-repo/...` … 他リポの正本を指すのは正しい書き方
 *   - `node_modules/...`   … 依存が持つファイル。リポ管理外
 *   ★誤検知する計器は、やがて無視される。無視される計器は無いのと同じ。
 */
function extractPaths(text) {
  const found = new Map();
  const re = /(?<![A-Za-z0-9_./-])((?:docs|scripts|lib|components|features|server|app|shared|drizzle|_docs)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const p = m[1].replace(/[).,:]+$/, "");
    if (p.includes("node_modules/")) continue;
    if (!found.has(p)) found.set(p, indexToLine(text, m.index));
  }
  return [...found].map(([value, line]) => ({ kind: "path", value, line }));
}

/**
 * スクリプト名の言及 `foo.py` `bar.mjs`（パス無しで名前だけ書かれているもの）
 *
 * ★日本語文中では前後に助詞が直に付く（`fal_upload_helper.pyやlocal_fal_upload.pyも参照`）。
 *   \b は「英数字とそれ以外の境界」なので、隣が日本語だと境界と見なされず取りこぼす。
 *   よって前後とも「英数字・ハイフン・ドットでないこと」を否定先読み/後読みで見る。
 *   実際 CLAUDE.md:67 の2件がこれで検出漏れした（2026-09-03）。selftest に固定済み。
 */
function extractMentions(text) {
  const found = new Map();
  // ★直前にパス区切りが付くもの（`../ai-hub/bin/hub.mjs`）はパス扱い＝ここでは拾わない。
  //   他リポを指す相対パスを「名前だけ」で探すと必ず誤検知する（2026-09-03 linktree で実測）。
  const re = /(?<![A-Za-z0-9_.\/-])([A-Za-z0-9_-]+\.(?:py|mjs|cjs|sh|ps1|bat))(?![A-Za-z0-9_-])/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    if (IGNORE_MENTION.some((r) => r.test(name))) continue;
    // ★同じ名前が複数行に出るなら全行を持つ。1行だけ報告すると直し漏れる
    if (!found.has(name)) found.set(name, []);
    found.get(name).push(indexToLine(text, m.index));
  }
  return [...found].map(([value, lines]) => ({ kind: "mention", value, line: lines[0], lines }));
}

/** npm script の呼び出し `pnpm check` `pnpm run foo` */
function extractScripts(text) {
  const found = new Map();
  const re = /\bpnpm\s+(?:run\s+)?([a-z][a-z0-9:-]*)\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    // pnpm 自体のサブコマンドは npm script ではない
    if (["install", "add", "remove", "dlx", "exec", "why", "up", "store"].includes(name)) continue;
    if (!found.has(name)) found.set(name, indexToLine(text, m.index));
  }
  return [...found].map(([value, line]) => ({ kind: "script", value, line }));
}

function indexToLine(text, index) {
  return text.slice(0, index).split("\n").length;
}

/** リポ内のどこかにその名前のファイルがあるか（node_modules 等は除く） */
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".expo", ".expo-check",
  "playwright-report", "test-results", "qa-results", ".next", "coverage",
]);

let fileNameIndex = null;
function buildFileNameIndex() {
  const names = new Set();
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        walk(join(dir, e.name), depth + 1);
      } else {
        names.add(e.name);
      }
    }
  };
  walk(ROOT, 0);
  return names;
}

function loadScriptNames() {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    return new Set(Object.keys(pkg.scripts ?? {}));
  } catch {
    return null;
  }
}

/** 1件の主張が生きているかを判定する */
function verify(claim, ctx) {
  if (claim.kind === "path") {
    return existsSync(resolve(ROOT, claim.value));
  }
  if (claim.kind === "mention") {
    if (fileNameIndex === null) fileNameIndex = buildFileNameIndex();
    return fileNameIndex.has(claim.value);
  }
  if (claim.kind === "script") {
    if (ctx.scriptNames === null) return true; // 測れないものは赤にしない
    return ctx.scriptNames.has(claim.value);
  }
  return true;
}

const LABEL = {
  path: "リポ内パス",
  mention: "スクリプト名",
  script: "pnpm script",
};

/**
 * ★「無いこと」を報告している行は、腐りではない。
 *
 * 腐り検査の結果そのものを書いた文書（会議資料・調査記録・この検査のコメント）は、
 * 実在しない名前を**意図的に**載せる。それを赤にすると:
 *   ・資料が永久に赤のままになる
 *   ・やがて「この検査はいつも赤いから見なくていい」になる
 * ★誤検知する計器は、無視される。無視される計器は無いのと同じ。
 *
 * 実在しないと明言している行・表・引用は、主張として数えない。
 */
// ★ファイル名に紛れうる語（absent / missing 等）は入れない。
//   検体名や実ファイル名に含まれると、不在の報告でない行まで免除されて
//   **本物の腐りを見逃す**。実際 selftest がそれを捕まえた（2026-09-03）。
const ABSENCE_MARKERS = [
  /存在しない/, /実在しない/, /見つからない/, /無くて当然/, /死んだ参照/, /腐って/, /腐り/,
  /が無い/, /が消え/, /NXDOMAIN/, /検出漏れ/, /取りこぼ/, /誤検知/,
];

/** その行が「無いこと」を語っているか */
function isAbsenceLine(text, line) {
  const lines = text.split("\n");
  const target = lines[line - 1] ?? "";
  if (ABSENCE_MARKERS.some((r) => r.test(target))) return true;
  // 表の行は直前の見出し・説明にだけ「存在しない」と書かれることがある
  if (/^\s*\|/.test(target)) {
    for (let i = line - 2; i >= 0 && i >= line - 4; i--) {
      const prev = lines[i] ?? "";
      if (/^\s*\|/.test(prev) || /^\s*$/.test(prev)) continue;
      if (ABSENCE_MARKERS.some((r) => r.test(prev))) return true;
      break;
    }
  }
  return false;
}

/** `pnpm xxx` `pnpm <name>` のような書式見本。実在する必要がない */
const PLACEHOLDER_SCRIPT = /^(xxx+|yyy+|zzz+|foo|bar|baz|name|script|command|なんとか)$/;

function inspect(text, ctx) {
  const claims = [...extractPaths(text), ...extractMentions(text), ...extractScripts(text)];
  const live = claims.filter((c) => {
    if (c.kind === "script" && PLACEHOLDER_SCRIPT.test(c.value)) return false;
    // 出現箇所が「すべて」不在の報告なら、主張として数えない
    const lines = c.lines ?? [c.line];
    return !lines.every((l) => isAbsenceLine(text, l));
  });
  const dead = live.filter((c) => !verify(c, ctx));
  return { total: live.length, dead };
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

// ── --selftest: この検査が本当に赤を出せるかを確かめる ──────────
//
// ★計器そのものが壊れていて「いつも緑」になるのが一番危ない。
//   実在しない実体を指す文書を人工的に作り、それを赤と判定できるかを見る。
if (selftest) {
  // ★selftest は「この検査が赤を出せるか」だけを見る。対象リポの中身に依存させない。
  //   （依存させると、置かれたリポ次第で selftest が落ちる＝計器が信用できなくなる）
  fileNameIndex = new Set(["check-doc-rot.mjs"]);
  const ctx = { scriptNames: new Set() };
  const cases = [
    {
      name: "存在しないリポ内パス",
      text: "詳細は docs/THIS-DOES-NOT-EXIST-9x7.md を読むこと。",
      expectDead: 1,
    },
    {
      name: "存在しないスクリプト名（★実際に CLAUDE.md が踏んでいた形）",
      text: "アップロードは fal_upload_helper_absent_9x7.py を使うこと",
      expectDead: 1,
    },
    {
      name: "存在しない pnpm script",
      text: "`pnpm this-script-does-not-exist-9x7` を実行する",
      expectDead: 1,
    },
    {
      // ★2026-09-03 に実際に取りこぼした形。\b では日本語の直前で境界にならない
      name: "スクリプト名の直後に日本語が続く（助詞つき）",
      text: "absent_helper_9x7.pyやabsent_other_9x7.mjsも参照。",
      expectDead: 2,
    },
    {
      // ★このファイル自身を指す。どのリポに置かれても必ず実在する参照
      name: "生きている参照は赤にしない",
      text: "検査本体は check-doc-rot.mjs である",
      expectDead: 0,
    },
    {
      // ★2026-09-03 linktree で誤検知した形。他リポの正本を指すのは正しい書き方
      name: "他リポを指す相対パスは赤にしない",
      text: "`node ../ai-hub/bin/absent_9x7.mjs find --tag x` を実行する",
      expectDead: 0,
    },
    {
      // ★同上。依存が持つファイルはリポ管理外
      name: "node_modules 配下は赤にしない",
      text: "verify at `node_modules/next/dist/server/lib/absent_9x7.js`",
      expectDead: 0,
    },
    {
      // ★2026-09-03、この検査を会議資料にかけて誤検知した形。
      //   腐りを報告する文書は、実在しない名前を意図的に載せる
      name: "「存在しない」と報告している行は赤にしない",
      text: "`absent_9x7.py` を使えと書いてあるが、★このリポに存在しない。",
      expectDead: 0,
    },
    {
      // ★上の緩和が効きすぎて本物を見逃さないことを確かめる（対の検査）
      name: "同じ名前でも、不在を語らない行にあれば赤にする",
      text: "アップロードは absent_9x7.py を使ってください",
      expectDead: 1,
    },
    {
      name: "書式見本の pnpm は赤にしない",
      text: "`pnpm xxx` のような npm script の呼び出し",
      expectDead: 0,
    },
  ];

  const failures = [];
  for (const c of cases) {
    const { dead } = inspect(c.text, { ...ctx, scriptNames: ctx.scriptNames });
    if (dead.length !== c.expectDead) {
      failures.push(`  ✗ ${c.name}: 死んだ参照 ${c.expectDead} 件を期待したが ${dead.length} 件だった`);
    }
  }

  if (failures.length > 0) {
    out(
      {
        summary: `✗ selftest 失敗: この検査は壊れている（${failures.length}/${cases.length} 件）`,
        detail: failures.join("\n"),
      },
      1,
    );
  }
  out({ summary: `✓ selftest 合格: ${cases.length} 件すべてで期待どおり判定できた` }, 0);
}

// ── 本番の検査 ────────────────────────────────────────
const targets = fileIdx >= 0 ? [args[fileIdx + 1]] : DEFAULT_TARGETS;
const ctx = { scriptNames: loadScriptNames() };
const results = [];
let measured = 0;

for (const t of targets) {
  const abs = resolve(ROOT, t);
  if (!existsSync(abs)) {
    results.push({ file: t, error: "対象ファイルが無い" });
    continue;
  }
  measured++;
  const text = readFileSync(abs, "utf8");
  const { total, dead } = inspect(text, ctx);
  results.push({ file: t, total, dead });
}

if (measured === 0) {
  out(
    {
      summary: "△ 測れなかった: 検査対象が1つも見つからない",
      detail: results.map((r) => `  ${r.file}: ${r.error}`).join("\n"),
      results,
    },
    2, // ★測れなかった。合格にも不合格にもしない
  );
}

const allDead = results.flatMap((r) => (r.dead ?? []).map((d) => ({ ...d, file: r.file })));
const totalClaims = results.reduce((a, r) => a + (r.total ?? 0), 0);

if (allDead.length > 0) {
  const detail = [
    "",
    "指示書が「使え」と書いている実体が見つからない:",
    "",
    ...allDead.map((d) => {
      const where = d.lines && d.lines.length > 1 ? d.lines.join(",") : d.line;
      return `  ✗ ${d.file}:${where}  [${LABEL[d.kind]}] ${d.value}`;
    }),
    "",
    "★どちらかを行うこと:",
    "  - 実体を復活させる（消したのが誤りだった場合）",
    "  - 指示書から該当箇所を消す（実体が不要になった場合）",
    "★放置すると、次に読むAIが存在しないものを使おうとして詰まる。",
  ].join("\n");

  out(
    {
      summary: `✗ 指示書が腐っている: ${allDead.length} 件の死んだ参照（検証した主張 ${totalClaims} 件中）`,
      detail,
      results,
    },
    1,
  );
}

out(
  {
    summary: `✓ 指示書は生きている: ${totalClaims} 件の主張すべてに実体がある（${targets.join(", ")}）`,
    results,
  },
  0,
);

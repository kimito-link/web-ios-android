#!/usr/bin/env node
/**
 * Expo の `entry-<hash>.js` を、中身のハッシュで名前を付け直す（内容アドレス化）。
 *
 * ■ ★なぜ要るか（2026-10-04、doin の本番で実損）
 *   Expo(Metro) の entry のファイル名のハッシュは、**entry が参照する非同期ルートのチャンク名を
 *   含まない**。ルートのチャンク（例: sign-in）だけを変えると、チャンクの名前は変わるのに、
 *   entry は **名前が同じまま中身だけ変わる**（新しいチャンク名を参照する）。
 *   ところが `/_expo/static/js/*` は `Cache-Control: immutable`（1年）で配信している。
 *   → CDN（Cloudflare）とブラウザが **古い entry を1年間掴み続け**、古いチャンクを読み続ける。
 *      修正を本番に出しても、ユーザーには届かない。再デプロイしても直らない。
 *      （実測: オリジンの entry は sign-in-826f… を参照、Cloudflare は同名の古い entry を HIT で返し
 *       sign-in-e785… を参照。古いチャンクはオリジンから消えるので、いずれ画面が壊れる）
 *
 * ■ 直し方
 *   entry を `entry-<中身の sha256 先頭32桁>.js` に改名し、HTML の参照を書き換える。
 *   中身が変われば名前が変わる → `immutable` のままで安全。同じ中身なら同じ名前（再現可能）。
 *
 * ■ 使い方（ビルド直後に実行する）
 *   node scripts/content-address-entry.mjs dist
 *   node scripts/content-address-entry.mjs --selftest     ← 毒を入れて赤を確認
 *
 * ■ 終了コード: 0 = 完了 / 1 = 失敗（entry が見つからない・参照が書き換わらない等。★緑にしない）
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const JS_DIR = "_expo/static/js/web";
const ENTRY_RE = /^entry-([0-9a-f]{32})\.js$/;

function sha256Prefix(buf) {
  return createHash("sha256").update(buf).digest("hex").slice(0, 32);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/**
 * dist 内の entry を内容アドレス化する。
 * @returns {{ from: string, to: string, rewritten: string[] }}
 */
export function contentAddressEntry(distDir) {
  const jsDir = join(distDir, JS_DIR);
  if (!existsSync(jsDir)) throw new Error(`${JS_DIR} が見つかりません: ${distDir}`);
  const entries = readdirSync(jsDir).filter((n) => ENTRY_RE.test(n));
  if (entries.length !== 1) throw new Error(`entry-*.js がちょうど1つ必要です（見つかった数: ${entries.length}）`);

  const from = entries[0];
  const body = readFileSync(join(jsDir, from));
  const to = `entry-${sha256Prefix(body)}.js`;
  if (from === to) return { from, to, rewritten: [] };

  // 参照を書き換えるのは HTML だけ（実測: entry を参照するのは HTML のみ）。
  // ★念のため JS / JSON にも残っていないかを後で検査する（残っていたら失敗にする）。
  const files = walk(distDir);
  const rewritten = [];
  for (const f of files) {
    if (!/\.html?$/.test(f)) continue;
    const text = readFileSync(f, "utf8");
    if (!text.includes(from)) continue;
    writeFileSync(f, text.split(from).join(to));
    rewritten.push(relative(distDir, f).replace(/\\/g, "/"));
  }
  if (rewritten.length === 0) throw new Error(`${from} を参照する HTML がありません（書き換え先が無い＝何かがおかしい）`);

  renameSync(join(jsDir, from), join(jsDir, to));

  // 検査: 旧名がどこにも残っていない（HTML / JS / JSON）。残っていると 404 になる。
  const leftovers = walk(distDir)
    .filter((f) => /\.(html?|js|json|txt|webmanifest)$/.test(f))
    .filter((f) => readFileSync(f, "utf8").includes(from))
    .map((f) => relative(distDir, f).replace(/\\/g, "/"));
  if (leftovers.length > 0) throw new Error(`旧い entry 名が残っています: ${leftovers.join(", ")}`);

  return { from, to, rewritten };
}

function selftest() {
  const root = mkdtempSync(join(tmpdir(), "entry-selftest-"));
  const mk = (entryBody, htmlRef) => {
    const d = mkdtempSync(join(root, "d-"));
    mkdirSync(join(d, JS_DIR), { recursive: true });
    const old = "entry-" + "a".repeat(32) + ".js";
    writeFileSync(join(d, JS_DIR, old), entryBody);
    writeFileSync(join(d, "sign-in.html"), `<script src="/${JS_DIR}/${htmlRef ?? old}" defer></script>`);
    writeFileSync(join(d, "index.html"), `<script src="/${JS_DIR}/${old}" defer></script>`);
    return { d, old };
  };
  let ok = true;
  const check = (name, cond) => { console.log(`${cond ? "✓" : "✗"} ${name}`); if (!cond) ok = false; };

  // 1) 名前が中身で決まり、HTML が追従する
  const a = mk("console.log('A')");
  const ra = contentAddressEntry(a.d);
  check("改名され、全HTMLが新名を指す", ra.to !== ra.from && readFileSync(join(a.d, "index.html"), "utf8").includes(ra.to) && readFileSync(join(a.d, "sign-in.html"), "utf8").includes(ra.to));
  check("旧名のファイルは残らない", !existsSync(join(a.d, JS_DIR, a.old)) && existsSync(join(a.d, JS_DIR, ra.to)));

  // 2) 中身が違えば名前が違う（古い entry を掴み続ける事故の再発防止の核）
  const b = mk("console.log('B')");
  check("中身が違えば名前が違う", contentAddressEntry(b.d).to !== ra.to);
  // 3) 同じ中身なら同じ名前（再現可能）
  const a2 = mk("console.log('A')");
  check("同じ中身なら同じ名前", contentAddressEntry(a2.d).to === ra.to);

  // 4) 毒: entry を参照する HTML が無ければ失敗（緑にしない）
  const p1 = mk("x");
  rmSync(join(p1.d, "index.html")); rmSync(join(p1.d, "sign-in.html"));
  let threw = false; try { contentAddressEntry(p1.d); } catch { threw = true; }
  check("毒: 参照するHTMLが無ければ失敗する", threw);
  // 5) 毒: entry が複数あれば失敗
  const p2 = mk("x");
  writeFileSync(join(p2.d, JS_DIR, "entry-" + "b".repeat(32) + ".js"), "y");
  threw = false; try { contentAddressEntry(p2.d); } catch { threw = true; }
  check("毒: entry が複数なら失敗する", threw);
  // 6) 毒: JS に旧名が残っていれば失敗
  const p3 = mk("x");
  writeFileSync(join(p3.d, JS_DIR, "other-" + "c".repeat(32) + ".js"), `import("./entry-${"a".repeat(32)}.js")`);
  threw = false; try { contentAddressEntry(p3.d); } catch { threw = true; }
  check("毒: 旧名が JS に残っていれば失敗する", threw);

  rmSync(root, { recursive: true, force: true });
  console.log(ok ? "selftest OK" : "selftest FAILED");
  return ok ? 0 : 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const arg = process.argv[2];
  if (arg === "--selftest") process.exit(selftest());
  const dist = arg ?? "dist";
  try {
    const r = contentAddressEntry(dist);
    console.log(r.from === r.to ? `entry は既に内容アドレス: ${r.to}` : `entry: ${r.from} → ${r.to}（HTML ${r.rewritten.length} 件を更新）`);
  } catch (e) {
    console.error("✖ content-address-entry:", e.message);
    process.exit(1);
  }
}

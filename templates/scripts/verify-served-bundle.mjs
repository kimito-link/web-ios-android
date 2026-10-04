#!/usr/bin/env node
/**
 * デプロイ後に「本番が配信している JS が、いまビルドしたものと同じか」を確かめる。
 *
 * ■ ★なぜ要るか（2026-10-04、doin の本番で実損）
 *   デプロイは完了・本番のコミットも一致（/version.json も /api/health も緑）なのに、
 *   CDN（Cloudflare）が **同名の古い entry を immutable で返し続け**、修正が本番に届いていなかった。
 *   既存の「本番のコミットが main と同じか」の計器（check-deploy-freshness）は緑のまま。
 *   ＝ **コミットの一致と、配信されるバイトの一致は別**。この計器は後者を見る。
 *
 * ■ 何を見るか
 *   指定したページの HTML から <script src> を拾い、各ファイルについて
 *   「本番から取ったバイトの sha256」と「ビルド出力（.vercel/output/static）の同名ファイルの sha256」を比べる。
 *   さらに、拾った JS が参照するチャンク名（`name-<32桁hex>.js`）も同様に比べる（1段）。
 *
 * ■ 測っていないもの（過信を防ぐ）
 *   - ページの HTML 自体と画像・CSS は見ない（JS だけ）。
 *   - 指定していないページの JS は見ない。
 *   - 動的 import の2段目以降のチャンクは見ない（entry が参照する1段まで）。
 *
 * ■ 使い方
 *   node scripts/verify-served-bundle.mjs <baseUrl> <localStaticDir> <path> [<path> ...]
 *   例: node scripts/verify-served-bundle.mjs https://doin.kimito.link .vercel/output/static / /sign-in/ /lp/
 *   node scripts/verify-served-bundle.mjs --selftest     ← ★毒を入れて赤を確認
 *   Cloudflare 等の伝播待ちのため、不一致なら最大5回（15秒間隔）やり直す。
 *
 * ■ 終了コード: 0 = 全て一致 / 1 = 不一致あり（★緑にしない）/ 2 = 測れなかった（取得失敗・対象なし）
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
// Expo のチャンク名は `+not-found-<hash>.js` や `[id]-<hash>.js`（動的ルート）のように + [ ] ( ) を含む。
const CHUNK_RE = /[A-Za-z0-9_$+()[\]-]+-[0-9a-f]{32}\.js/g;
// Vercel がエッジで注入するスクリプト（/_vercel/speed-insights 等）はビルド出力に無いのが正常。
const PLATFORM_PREFIXES = ["/_vercel/"];

async function get(url) {
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** 1回分の検査。{ checked, mismatches, errors } を返す。 */
export async function verifyOnce(baseUrl, localDir, paths) {
  const base = baseUrl.replace(/\/$/, "");
  const checked = [];
  const mismatches = [];
  const errors = [];
  const seen = new Set();

  async function compare(urlPath) {
    if (seen.has(urlPath)) return null;
    seen.add(urlPath);
    if (PLATFORM_PREFIXES.some((p) => urlPath.startsWith(p))) return null; // 比較対象外（測らない）
    const local = join(localDir, urlPath.replace(/^\//, ""));
    if (!existsSync(local)) { errors.push(`ビルド出力に無い: ${urlPath}`); return null; }
    let served;
    try { served = await get(base + encodeURI(urlPath)); } catch (e) { errors.push(String(e.message)); return null; }
    const same = sha(served) === sha(readFileSync(local));
    checked.push(urlPath);
    if (!same) mismatches.push(urlPath);
    return served;
  }

  for (const p of paths) {
    let html;
    try { html = (await get(base + p)).toString("utf8"); } catch (e) { errors.push(String(e.message)); continue; }
    const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+\.js)"/g)].map((m) => m[1]).filter((s) => s.startsWith("/"));
    for (const src of srcs) {
      const served = await compare(src);
      if (!served) continue;
      const dir = src.slice(0, src.lastIndexOf("/") + 1);
      for (const name of new Set(served.toString("utf8").match(CHUNK_RE) ?? [])) await compare(dir + name);
    }
  }
  return { checked, mismatches, errors };
}

export async function verify(baseUrl, localDir, paths, { retries = 5, waitMs = 15000 } = {}) {
  let last;
  for (let i = 1; i <= retries; i++) {
    last = await verifyOnce(baseUrl, localDir, paths);
    if (last.mismatches.length === 0 && last.errors.length === 0 && last.checked.length > 0) return { ok: true, ...last, attempt: i };
    if (i < retries) await new Promise((r) => setTimeout(r, waitMs));
  }
  return { ok: false, ...last, attempt: retries };
}

async function selftest() {
  const root = mkdtempSync(join(tmpdir(), "served-selftest-"));
  const built = join(root, "built");
  const served = join(root, "served");
  for (const d of [built, served]) mkdirSync(join(d, "_expo/static/js/web"), { recursive: true });
  const entry = "entry-" + "a".repeat(32) + ".js";
  const chunk = "sign-in-" + "b".repeat(32) + ".js";
  const html = `<script src="/_expo/static/js/web/${entry}" defer></script>`;
  const entryBody = `import("./${chunk}")`;
  for (const d of [built, served]) {
    writeFileSync(join(d, "index.html"), html);
    writeFileSync(join(d, "_expo/static/js/web", entry), entryBody);
    writeFileSync(join(d, "_expo/static/js/web", chunk), "console.log('new')");
  }
  const server = createServer((req, res) => {
    const p = join(served, decodeURIComponent((req.url || "/").split("?")[0]).replace(/\/$/, "/index.html"));
    if (existsSync(p) && !p.endsWith("served")) { res.end(readFileSync(p)); } else { res.statusCode = 404; res.end("nf"); }
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let ok = true;
  const check = (name, cond) => { console.log(`${cond ? "✓" : "✗"} ${name}`); if (!cond) ok = false; };

  let r = await verify(base, built, ["/"], { retries: 1 });
  check("一致していれば合格（entry とそれが参照するチャンクの2件を比較）", r.ok && r.checked.length === 2);

  // 実損の再現: 名前に + や [ ] を含むチャンク、プラットフォーム注入のスクリプト
  const plus = "+not-found-" + "d".repeat(32) + ".js";
  const dyn = "[id]-" + "e".repeat(32) + ".js";
  for (const d of [built, served]) {
    writeFileSync(join(d, "_expo/static/js/web", plus), "console.log('nf')");
    writeFileSync(join(d, "_expo/static/js/web", dyn), "console.log('dyn')");
    writeFileSync(join(d, "_expo/static/js/web", entry), `import("./${chunk}");import("./${plus}");import("./${dyn}")`);
    writeFileSync(join(d, "index.html"), html + '<script src="/_vercel/speed-insights/script.js" defer></script>');
  }
  r = await verify(base, built, ["/"], { retries: 1 });
  check("+ や [ ] を含むチャンク名も比べる（+not-found / [id]）", r.ok && r.checked.some((c) => c.includes("+not-found")) && r.checked.some((c) => c.includes("[id]")));
  check("プラットフォーム注入の /_vercel/ は比較対象外（ビルド出力に無くても失敗にしない）", r.ok && !r.checked.some((c) => c.startsWith("/_vercel/")));
  for (const d of [built, served]) writeFileSync(join(d, "_expo/static/js/web", entry), entryBody);

  // 毒1: 配信側の entry だけが古い内容（CDN が古い entry を返す事故）
  writeFileSync(join(served, "_expo/static/js/web", entry), `import("./sign-in-${"c".repeat(32)}.js")`);
  r = await verify(base, built, ["/"], { retries: 1 });
  check("毒: 配信される entry が古ければ失敗する", !r.ok && r.mismatches.some((m) => m.endsWith(entry)));
  writeFileSync(join(served, "_expo/static/js/web", entry), entryBody);

  // 毒2: 配信側のチャンクが違う
  writeFileSync(join(served, "_expo/static/js/web", chunk), "console.log('OLD')");
  r = await verify(base, built, ["/"], { retries: 1 });
  check("毒: 配信されるチャンクが違えば失敗する", !r.ok && r.mismatches.some((m) => m.endsWith(chunk)));
  writeFileSync(join(served, "_expo/static/js/web", chunk), "console.log('new')");

  // 毒3: 取得できない・対象なしは緑にしない
  r = await verify(base, built, ["/no-such-page/"], { retries: 1 });
  check("毒: ページが取れなければ失敗する（緑にしない）", !r.ok);

  server.close();
  rmSync(root, { recursive: true, force: true });
  console.log(ok ? "selftest OK" : "selftest FAILED");
  return ok ? 0 : 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const [a, b, ...rest] = process.argv.slice(2);
  if (a === "--selftest") process.exit(await selftest());
  if (!a || !b || rest.length === 0) {
    console.error("使い方: node scripts/verify-served-bundle.mjs <baseUrl> <localStaticDir> <path> [<path> ...]");
    process.exit(2);
  }
  const r = await verify(a, b, rest);
  if (r.ok) {
    console.log(`✓ 配信されている JS はビルドと一致（${r.checked.length} 件、試行 ${r.attempt} 回目）`);
    process.exit(0);
  }
  for (const m of r.mismatches) console.error(`✖ 不一致（本番が古い/別のものを配信）: ${m}`);
  for (const e of r.errors) console.error(`✖ 測れなかった: ${e}`);
  process.exit(r.mismatches.length > 0 ? 1 : 2);
}

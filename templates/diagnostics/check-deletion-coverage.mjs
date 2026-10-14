#!/usr/bin/env node
/**
 * check-deletion-coverage.mjs — ★退会時の「削除漏れ」を機械で止める（配布用）。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ なぜ要るか（2026-10-12・kimito.link の実損）
 *
 *   退会削除は「消す対象を**手で並べる**」実装になりがちで、新しい保存先を足したときに
 *   足し忘れる。kimito.link は削除ファイル自身に
 *     「★足し忘れると、退会しても個人データが残る」
 *   と**警告コメントを書いていた**のに、その後に足された健康記録のキー
 *   （TTL 約460日）が漏れた。
 *
 *   ★**検査していない規範は守られない。** コメントでは防げない。
 *
 * ■ 何を測るか（2つの保存方式に対応）
 *
 *   --mode redis  … ソース中の「userId/username を鍵に含む Redis キー」の接頭辞を集め、
 *                   削除ファイルがその接頭辞に触れているかを照合する。
 *   --mode sql    … スキーマ中の「ユーザーを指す列を持つテーブル」を集め、
 *                   削除ファイルがそのテーブル名に触れているかを照合する。
 *                   （drizzle の `export const x = pgTable/mysqlTable/sqliteTable` を想定）
 *
 *   どちらも問いは同じ: **ユーザー別の保存先が、退会の削除に入っているか。**
 *
 * ■ ★意図的に「消さない」もの
 *   消さない判断は正当にありうる（別サービスのデータ・法的保存義務・報酬台帳など）。
 *   その場合は --exclude で宣言する。★ただし**削除ファイルに理由が書かれていること**まで
 *   検査する（理由の無い除外は、ただの抜け道になるため）。
 *
 * ■ ★この検査が判定しないこと（過信を防ぐ）
 *   ・**消すべきかは判定しない。** 見るのは「判断した形跡があるか」だけ。
 *   ・**実際に消えたかは見ない。** それは削除処理のユニットテストの仕事。
 *   ・名前の一致しか見ない。同じ名前で別の形のデータを足した場合は見逃す。
 *
 * ■ 使い方
 *   node check-deletion-coverage.mjs --mode redis \
 *     --deletion lib/account-deletion.ts --scan lib --scan app \
 *     --exclude partner:referredBy --exclude exosome:sync
 *
 *   node check-deletion-coverage.mjs --mode sql \
 *     --deletion modules/encounter/db/account-deletion.ts --scan drizzle/schema
 *
 *   node check-deletion-coverage.mjs --selftest
 *
 * ■ 終了コード
 *   0 = 根拠つき合格 / 1 = 測れた上での赤 / 2 = ★測れなかった（**緑ではない**）
 * ───────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });

const SKIP_DIRS = new Set([
  'node_modules', '.next', '.git', '.vercel', 'dist', 'build', '.expo', '.claude', 'coverage',
]);

/**
 * ★Redis キーに見えるが個人データではないもの（既定の除外）。
 *   kimito.link で実際に誤検知した2種。配布先でも同じ形が出る。
 */
const DEFAULT_NON_KEY_PREFIXES = Object.freeze([
  'https', 'http',       // URL（`https://...${username}`）
  'dashboard-user',      // Next.js の revalidateTag（Redis キーではない）
]);

/** ユーザーを指す識別子の名前。配布先で違えば --id-name で足す。 */
const DEFAULT_ID_NAMES = Object.freeze([
  'userId', 'username', 'u', 'clerkUserId', 'openId', 'uid',
]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/.(ts|tsx|js|mjs)$/.test(p) && !/(?:.(test|spec).|.d.ts$)/.test(p)) out.push(p);
  }
  return out;
}

/**
 * Redis モード: `prefix:...${userId}...` の接頭辞を集める。
 * @returns {Map<string, Set<string>>} prefix -> 見つかったファイル
 */
export function collectRedisPrefixes(files, readFile, opts = {}) {
  const idNames = opts.idNames ?? DEFAULT_ID_NAMES;
  const nonKeys = new Set(opts.nonKeyPrefixes ?? DEFAULT_NON_KEY_PREFIXES);
  const re = new RegExp('`([a-z][a-z0-9-]*):[^`]*\\$\\{\\s*(?:' + idNames.map(escapeRe).join('|') + ')\\b[^`]*`', 'g');
  const found = new Map();
  for (const f of files) {
    let src;
    try { src = readFile(f); } catch { continue; }
    for (const m of src.matchAll(re)) {
      const prefix = m[1];
      if (nonKeys.has(prefix)) continue;
      if (!found.has(prefix)) found.set(prefix, new Set());
      found.get(prefix).add(f);
    }
  }
  return found;
}

/**
 * SQL モード: ユーザーを指す列を持つテーブル名を集める。
 * drizzle の `export const <name> = pgTable(` 等を1単位として、
 * 次のテーブル定義までの間にユーザー識別子の列があれば対象とみなす。
 */
export function collectUserTables(files, readFile, opts = {}) {
  const idNames = opts.idNames ?? ['userId', 'senderId', 'reporterId', 'blockerId', 'ownerId', 'clerkUserId'];
  const idRe = new RegExp('\\b(?:' + idNames.map(escapeRe).join('|') + ')\\b');
  const found = new Map();
  for (const f of files) {
    let src;
    try { src = readFile(f); } catch { continue; }
    const lines = src.split('\n');
    let current = null;
    for (const line of lines) {
      const def = line.match(/export const (\w+)\s*=\s*\w*[Tt]able\(/);
      if (def) { current = def[1]; continue; }
      if (current && idRe.test(line)) {
        if (!found.has(current)) found.set(current, new Set());
        found.get(current).add(f);
        current = null; // 1テーブル1回で足りる
      }
    }
  }
  return found;
}

/**
 * 削除ファイルがその名前に**削除として**触れているか。
 *
 * ★sql モードが「名前がファイルのどこかにあるか」だけを見ていたため、
 *   **import 文を拾って緑になる**穴があった（2026-10-14 に実測で発見）。
 *   `await db.delete(notifications)...` の行を消しても、
 *   `import { notifications }` が残っているので**合格のまま**だった。
 *   ★「ファイル内に語がある」で判定する門番は偽の緑を出す、という既知の型。
 *
 * → sql は **`delete(名前)` の形**を見る。書き方の揺れ（`.delete( x )`、
 *   `deleteFrom(x)`、`del(x)`）は許すが、**import だけでは通らない**。
 *   ★除外宣言（`--exclude`）は別経路で見るので、ここを緩める必要はない。
 */
/**
 * 正規表現に埋め込む前にメタ文字を無害化する。
 * ★これが無いと、名前に . や ( を含むものが来たとき**判定が狂う**。
 *   検査器が「漏れているのに緑」を出しうるので、ここは落とせない。
 */
export function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isCovered(name, deletionSource, mode) {
  if (mode === 'redis') return deletionSource.includes(`${name}:`);
  // `delete(name)` / `deleteFrom(name)` / `del(name)`（空白は許す）
  return new RegExp(`\\b(?:delete|deleteFrom|del)\\s*\\(\\s*${escapeRe(name)}\\b`).test(deletionSource);
}

/** 覆われておらず、除外宣言もされていないもの。 */
export function findMissing(found, deletionSource, exclusions, mode) {
  const excluded = new Set(exclusions.map((e) => (mode === 'redis' ? e.split(':')[0] : e)));
  const missing = [];
  for (const [name, files] of found) {
    if (isCovered(name, deletionSource, mode)) continue;
    if (excluded.has(name)) continue;
    missing.push({ name, files: [...files] });
  }
  return missing;
}

/** ★除外は「削除ファイルに理由が書かれている」ことまで確かめる。 */
export function findUndocumentedExclusions(deletionSource, exclusions) {
  return exclusions.filter((e) => !deletionSource.includes(e));
}

// ───────────────────────── selftest ─────────────────────────

function runSelftest() {
  const fails = [];
  const check = (name, got, want) => { if (got !== want) fails.push(`${name}: 期待 ${want} / 実際 ${got}`); };

  const DELETION = [
    '`ai:profile:${userId}:*`',
    'partner:referredBy は消さない（報酬台帳のため）',
    'await db.delete(locations).where(eq(locations.userId, userId));',
  ].join('\n');

  // --- redis モード
  const rFiles = ['a.ts'];
  const rSrc = '`ai:profile:${userId}:x` `ouen:oshi:${userId}` `https://x.com/${username}`';
  const rFound = collectRedisPrefixes(rFiles, () => rSrc);
  check('redis: URL を拾わない', rFound.has('https'), false);
  check('redis: 2種を検出', rFound.size, 2);
  check('redis: 覆われていない ouen を赤にする',
    findMissing(rFound, DELETION, [], 'redis').some((m) => m.name === 'ouen'), true);
  check('redis: 除外すれば通る',
    findMissing(rFound, DELETION, ['ouen:oshi'], 'redis').length, 0);

  // --- sql モード
  const sSrc = [
    'export const locations = pgTable("locations", {',
    '  userId: integer("userId"),',
    '});',
    'export const secrets = pgTable("secrets", {',
    '  userId: integer("userId"),',
    '});',
    'export const config = pgTable("config", {',
    '  key: text("key"),',
    '});',
  ].join('\n');
  const sFound = collectUserTables(['s.ts'], () => sSrc);
  check('sql: ユーザー列の無いテーブルは拾わない', sFound.has('config'), false);
  check('sql: 2テーブルを検出', sFound.size, 2);
  check('sql: 覆われている locations は赤にしない',
    findMissing(sFound, DELETION, [], 'sql').some((m) => m.name === 'locations'), false);
  check('sql: 覆われていない secrets は赤',
    findMissing(sFound, DELETION, [], 'sql').some((m) => m.name === 'secrets'), true);

  // ★2026-10-14 に実測で見つけた穴の再現。
  //   判定が「名前がファイルのどこかにあるか」だったため、**import 文を拾って緑**になった。
  //   doin-challenge で `await db.delete(notifications)...` を消しても
  //   `import { notifications }` が残っているので合格のままだった。
  const IMPORT_ONLY = [
    'import { locations, secrets } from "../../drizzle/schema";',
    'await db.delete(locations).where(eq(locations.userId, userId));',
  ].join('\n');
  check('★import しているだけのテーブルを「削除済み」と数えない',
    findMissing(sFound, IMPORT_ONLY, [], 'sql').some((m) => m.name === 'secrets'), true);
  check('同じファイルで実際に delete しているものは通る',
    findMissing(sFound, IMPORT_ONLY, [], 'sql').some((m) => m.name === 'locations'), false);
  check('★書き方の揺れを許す（deleteFrom / 空白）',
    isCovered('secrets', 'await db.deleteFrom( secrets ).execute();', 'sql'), true);
  check('★コメントに名前があるだけでは通さない',
    isCovered('secrets', '// secrets は消さない', 'sql'), false);

  // --- ★正規表現のメタ文字（名前に . や ( が入っても判定が狂わないこと）
  check('★メタ文字を含む名前が別物に誤マッチしない',
    isCovered('a.b', 'delete(axb)', 'sql'), false);
  check('★メタ文字を含む名前そのものは一致する',
    isCovered('a.b', 'delete(a.b)', 'sql'), true);

  // --- ★除外の理由
  check('★理由の無い除外を赤にする',
    findUndocumentedExclusions(DELETION, ['ouen:oshi']).length, 1);
  check('理由のある除外は通る',
    findUndocumentedExclusions(DELETION, ['partner:referredBy']).length, 0);

  if (fails.length > 0) {
    console.error('[check-deletion-coverage] ★selftest 失敗:');
    for (const f of fails) console.error('  - ' + f);
    process.exit(EXIT.FAIL);
  }
  console.log('[check-deletion-coverage] ✅ selftest 合格（15件: redis 3 / sql 8 / メタ文字 2 / 除外の理由 2）');
  process.exit(EXIT.PASS);
}

// ───────────────────────── main ─────────────────────────

function argsOf(flag) {
  return process.argv.map((a, i) => (a === flag ? process.argv[i + 1] : null)).filter(Boolean);
}

function main() {
  if (process.argv.includes('--selftest')) return runSelftest();

  const mode = argsOf('--mode')[0] ?? 'redis';
  const deletionPath = argsOf('--deletion')[0];
  const scanDirs = argsOf('--scan');
  const exclusions = argsOf('--exclude');
  const idNames = argsOf('--id-name');

  if (mode !== 'redis' && mode !== 'sql') {
    console.error(`[check-deletion-coverage] 🟡 --mode は redis か sql（受け取った: ${mode}）`);
    process.exit(EXIT.INCONCLUSIVE);
  }
  if (!deletionPath || scanDirs.length === 0) {
    console.error('[check-deletion-coverage] 🟡 --deletion と --scan が要る（測れていない。緑ではない）');
    process.exit(EXIT.INCONCLUSIVE);
  }

  let deletionSource;
  try {
    deletionSource = readFileSync(deletionPath, 'utf8');
  } catch (e) {
    console.error(`[check-deletion-coverage] 🟡 削除ファイルを読めない: ${deletionPath} (${e.message})`);
    process.exit(EXIT.INCONCLUSIVE);
  }

  const files = scanDirs.flatMap((d) => walk(d));
  const read = (f) => readFileSync(f, 'utf8');
  const opts = idNames.length > 0 ? { idNames } : {};
  const found = mode === 'redis'
    ? collectRedisPrefixes(files, read, opts)
    : collectUserTables(files, read, opts);

  // ★0件を緑にしない（走査が壊れていても「漏れなし」に見えてしまう）
  if (found.size === 0) {
    console.error(
      `[check-deletion-coverage] 🟡 ユーザー別の保存先を1つも検出できなかった` +
      `（走査が壊れている疑い。--scan=${scanDirs.join(',')} / files=${files.length}）`
    );
    process.exit(EXIT.INCONCLUSIVE);
  }

  const missing = findMissing(found, deletionSource, exclusions, mode);
  const undocumented = findUndocumentedExclusions(deletionSource, exclusions);

  if (missing.length === 0 && undocumented.length === 0) {
    console.log(
      `[check-deletion-coverage] ✅ 合格（${mode} / ${found.size} 件すべてが削除対象か、理由つきの除外）\n` +
      `   検出: ${[...found.keys()].sort().join(', ')}`
    );
    process.exit(EXIT.PASS);
  }

  console.error('[check-deletion-coverage] 🔴 退会しても残る疑いがあります');
  for (const m of missing) {
    console.error(`   - ${m.name} が削除に入っていない（${m.files.slice(0, 3).join(', ')}）`);
  }
  for (const e of undocumented) {
    console.error(`   - 除外 ${e} の理由が ${deletionPath} に書かれていない`);
  }
  console.error(
    `   → 直し方: 消すなら削除処理に足す。消さないなら ${deletionPath} に理由を書き、--exclude にも足す`
  );
  console.error('   → この検査が判定しないこと: 消すべきかどうか／実際に消えたか（それは削除処理のテスト）');
  process.exit(EXIT.FAIL);
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main();

#!/usr/bin/env node
/**
 * check-auth-domains-allowed.mjs — ★アプリ内ログインが外部ブラウザへ飛ぶのを止める（配布用）。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ なぜ要るか（2026-10-16・ゆっくりエクソソームの実損）
 *
 *   Capacitor の `server.allowNavigation` に**無い**ドメインへ遷移すると、
 *   iOS は WebView の外（外部 Safari）を開く。ログインは認証プロバイダの
 *   ドメインへ遷移するので、そこが抜けていると
 *   **「ログインを押した瞬間にアプリの外へ出る」**。
 *
 *   外に出た先は Origin が付かない素のアクセスになるため、Clerk の FAPI は
 *   `{"errors":[{"message":"Unauthorized request"}]}` を返す。
 *   利用者から見ると「ログインしているのに弾かれる」「ウェブとアプリが
 *   ごっちゃ」という体験になる。
 *
 *   ★これは **App Store Guideline 4（#4「ログインで外部ブラウザに飛ぶ」）の
 *   却下理由そのもの**でもある。kimito.link は 2026-06-30 に実際に却下され、
 *   その対策として許可リストを 11 件まで増やして直した。
 *
 *   ★にもかかわらず、**その学びが他リポへ配られていなかった**。
 *   2026-10-16 の実測では、Clerk ログインを持つアプリ 3 本のうち
 *   **2 本（exosome・voice）が 2 件しか許可しておらず**、同じ却下理由を
 *   抱えたままだった。⟹ **コメントや前例では防げない。検査にする。**
 *
 * ■ 何を測るか
 *
 *   「そのアプリが**使っている**ログイン手段のドメインが、
 *     `allowNavigation` に入っているか」だけを見る。
 *
 *   使っていない手段は要求しない（Google を出さないアプリに
 *   accounts.google.com を強要しない）。★過剰な要求をする検査は、
 *   無視されるようになって死ぬ。
 *
 * ■ ★この検査が判定しないこと（過信を防ぐ）
 *   ・**ログインが成功するかは見ない。** 見るのは「外部ブラウザへ出ない設定か」だけ。
 *   ・**Android は見ない。** 外部ブラウザへ出る挙動は iOS 固有の問題。
 *   ・設定ファイルを読むだけで、**実機の挙動は測っていない**。
 *
 * ■ 3値で返す
 *   0 = 根拠つき合格 / 1 = 測れた赤 / ★2 = 測れなかった（緑ではない）
 *
 * ■ 使い方
 *   node check-auth-domains-allowed.mjs --config capacitor.config.ts --scan src --scan www
 *   node check-auth-domains-allowed.mjs --selftest
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });

/**
 * ログイン手段 → それを使うときに遷移するドメイン。
 *
 * ★`detect` は「そのアプリがこの手段を使っているか」をソースから見分ける印。
 *   印が出たときだけ `domains` を要求する。
 */
export const AUTH_PROVIDERS = Object.freeze([
  {
    id: 'clerk-custom',
    label: 'Clerk（カスタムドメイン）',
    // clerk.example.com のような Frontend API ドメインを直接読む
    detectRe: /['"`](clerk\.[a-z0-9.-]+\.[a-z]{2,})['"`]/i,
    domainsFrom: (m) => [m[1]],
  },
  {
    id: 'clerk-dev',
    label: 'Clerk（開発インスタンス）',
    detectRe: /\.clerk\.accounts\.dev/i,
    domains: ['*.clerk.accounts.dev'],
  },
  {
    id: 'x',
    label: 'X（Twitter）ログイン',
    // oauth_x / strategy:'oauth_x' / x.com への遷移
    detectRe: /oauth_x|oauth_twitter|['"`]https?:\/\/(?:x|twitter)\.com/i,
    domains: ['x.com', 'twitter.com'],
  },
  {
    id: 'apple',
    label: 'Sign in with Apple',
    detectRe: /oauth_apple|appleid\.apple\.com/i,
    domains: ['appleid.apple.com'],
  },
]);

/** `allowNavigation: [...]` の中身を読む。読めなければ null（＝測れなかった）。 */
export function parseAllowNavigation(configSrc) {
  const src = String(configSrc || '');
  const m = src.match(/allowNavigation\s*:\s*\[([\s\S]*?)\]/);
  if (!m) return null;
  const out = [];
  for (const raw of m[1].split(',')) {
    const t = raw.trim().replace(/\/\/.*$/, '').trim();
    const q = t.match(/^['"`]([^'"`]+)['"`]$/);
    if (q) out.push(q[1]);
  }
  return out;
}

/** `server.url` のホスト名を読む（自分自身は常に許可されているべき）。 */
export function parseServerHost(configSrc) {
  const m = String(configSrc || '').match(/url\s*:\s*['"`]https?:\/\/([^/'"`]+)/);
  return m ? m[1] : null;
}

/**
 * 許可リストが対象ドメインを覆っているか。
 * `*.example.com` は `a.example.com` を覆う。★`example.com` 自身は覆わない（仕様どおり）。
 */
export function isAllowed(domain, allowList) {
  const d = String(domain).toLowerCase();
  return (allowList || []).some((raw) => {
    const p = String(raw).toLowerCase().trim();
    if (p === d) return true;
    if (p.startsWith('*.')) {
      const base = p.slice(2);
      return d === base || d.endsWith('.' + base);
    }
    return false;
  });
}

/** ソース全文から「使っているログイン手段」と必要ドメインを割り出す。 */
export function detectRequired(sourceText) {
  const text = String(sourceText || '');
  const required = [];
  for (const p of AUTH_PROVIDERS) {
    const m = text.match(p.detectRe);
    if (!m) continue;
    const domains = p.domainsFrom ? p.domainsFrom(m) : p.domains;
    for (const d of domains) required.push({ domain: d, by: p.label });
  }
  // 同じドメインを複数の手段が要求しても1件にまとめる
  const seen = new Set();
  return required.filter((r) => (seen.has(r.domain) ? false : seen.add(r.domain)));
}

export function judge({ allowList, required, serverHost }) {
  if (allowList === null) {
    return {
      verdict: 'inconclusive',
      reason: 'capacitor.config から allowNavigation を読めませんでした',
      missing: [],
    };
  }
  // ★ログイン手段を1つも見つけられなかった = 検査が機能していない疑い。
  //   「ログインが無いアプリ」と区別できないので、緑にしない。
  if (!required || required.length === 0) {
    return {
      verdict: 'inconclusive',
      reason: 'ログイン手段を1つも見つけられませんでした（走査対象が違う可能性）',
      missing: [],
    };
  }
  const missing = required.filter((r) => !isAllowed(r.domain, allowList));
  // 自分自身が許可されていないのは別種の壊れ方なので、見つけたら報告する
  if (serverHost && !isAllowed(serverHost, allowList)) {
    missing.push({ domain: serverHost, by: '自分自身（server.url）' });
  }
  return {
    verdict: missing.length === 0 ? 'pass' : 'fail',
    evidence: {
      許可リスト: allowList.length,
      要求: required.length,
      配信元: serverHost || '(不明)',
    },
    missing,
  };
}

/* ───────────────────────── 以下は CLI ───────────────────────── */

const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.html', '.json']);

function readAll(dir, acc = [], depth = 0) {
  if (depth > 6) return acc;
  let names = [];
  try { names = readdirSync(dir); } catch { return acc; }
  for (const name of names) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const abs = join(dir, name);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) readAll(abs, acc, depth + 1);
    else if (TEXT_EXT.has(extname(name))) {
      try { acc.push(readFileSync(abs, 'utf8')); } catch { /* 読めないものは飛ばす */ }
    }
  }
  return acc;
}

function runSelfTest() {
  const fails = [];
  const check = (name, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      fails.push(`${name}: 期待 ${JSON.stringify(want)} / 実際 ${JSON.stringify(got)}`);
    }
  };

  // --- 許可判定 ---
  check('完全一致は許可', isAllowed('x.com', ['x.com']), true);
  check('ワイルドカードは下位を覆う', isAllowed('clerk.kimito.link', ['*.kimito.link']), true);
  check('ワイルドカードは基底も覆う', isAllowed('kimito.link', ['*.kimito.link']), true);
  check('★無関係は覆わない', isAllowed('evil.com', ['*.kimito.link']), false);
  check('★部分一致で誤許可しない', isAllowed('notkimito.link', ['*.kimito.link']), false);

  // --- 設定の読み取り ---
  check('allowNavigation を読める',
    parseAllowNavigation("allowNavigation: [\n 'a.com',\n '*.b.com',\n]"), ['a.com', '*.b.com']);
  check('★読めなければ null', parseAllowNavigation('なにもない'), null);
  check('server.url のホストを読める',
    parseServerHost("server: { url: 'https://exosome.kimito.link' }"), 'exosome.kimito.link');

  // --- 使っている手段の検出 ---
  check('Clerk カスタムドメインを検出',
    detectRequired("var API = 'clerk.kimito.link';").map((r) => r.domain), ['clerk.kimito.link']);
  check('X ログインを検出',
    detectRequired("strategy: 'oauth_x'").map((r) => r.domain), ['x.com', 'twitter.com']);
  check('★使っていない手段は要求しない',
    detectRequired("console.log('hello')").length, 0);

  // --- 判定 ---
  check('★欠けていれば赤',
    judge({ allowList: ['a.com'], required: [{ domain: 'x.com', by: 'X' }] }).verdict, 'fail');
  check('揃っていれば緑',
    judge({ allowList: ['x.com'], required: [{ domain: 'x.com', by: 'X' }] }).verdict, 'pass');
  check('★読めなければ緑にしない',
    judge({ allowList: null, required: [{ domain: 'x.com', by: 'X' }] }).verdict, 'inconclusive');
  check('★手段ゼロは緑にしない',
    judge({ allowList: ['a.com'], required: [] }).verdict, 'inconclusive');
  check('★配信元が許可されていなければ赤',
    judge({ allowList: ['x.com'], required: [{ domain: 'x.com', by: 'X' }], serverHost: 'me.com' }).verdict, 'fail');

  // --- ★実損の再現（2026-10-16 の exosome をそのまま入れて赤くなるか） ---
  const exosomeCfg = "server: { url: 'https://exosome.kimito.link', allowNavigation: ['exosome.kimito.link', '*.exosome.kimito.link'] }";
  const exosomeSrc = "var CLERK_FRONTEND_API = 'clerk.kimito.link';";
  const real = judge({
    allowList: parseAllowNavigation(exosomeCfg),
    required: detectRequired(exosomeSrc),
    serverHost: parseServerHost(exosomeCfg),
  });
  check('★実損(exosome)を再現して赤になる', real.verdict, 'fail');
  check('★その欠落は clerk.kimito.link', real.missing.map((m) => m.domain), ['clerk.kimito.link']);

  if (fails.length > 0) {
    console.error('[check-auth-domains-allowed] ★selftest 失敗（検知器が効いていません）:');
    for (const f of fails) console.error('  - ' + f);
    process.exit(EXIT.FAIL);
  }
  console.log('[check-auth-domains-allowed] ✅ selftest 合格（18件: 許可判定5 / 読取3 / 検出3 / 判定5 / 実損の再現2）');
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return runSelfTest();

  const valueOf = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };
  const valuesOf = (flag) => argv.reduce((a, v, i) => (v === flag && argv[i + 1] ? a.concat(argv[i + 1]) : a), []);

  const configPath = valueOf('--config') || 'capacitor.config.ts';
  const scanDirs = valuesOf('--scan');

  if (!existsSync(configPath)) {
    // ★Capacitor アプリでないリポは「対象外」であって合格ではない。
    console.error(`[check-auth-domains-allowed] 🟡 ${configPath} がありません（Capacitor アプリではない？）`);
    process.exit(EXIT.INCONCLUSIVE);
  }

  let configSrc = '';
  try {
    configSrc = readFileSync(configPath, 'utf8');
  } catch (e) {
    console.error('[check-auth-domains-allowed] 🟡 設定を読めませんでした: ' + ((e && e.message) || e));
    process.exit(EXIT.INCONCLUSIVE);
  }

  const dirs = scanDirs.length ? scanDirs : ['src', 'www', 'app', 'js'];
  const texts = dirs.filter(existsSync).flatMap((d) => readAll(d));
  if (texts.length === 0) {
    console.error('[check-auth-domains-allowed] 🟡 走査できるソースがありません（--scan を指定してください）');
    process.exit(EXIT.INCONCLUSIVE);
  }

  const r = judge({
    allowList: parseAllowNavigation(configSrc),
    required: detectRequired(texts.join('\n')),
    serverHost: parseServerHost(configSrc),
  });

  if (r.verdict === 'inconclusive') {
    console.error('[check-auth-domains-allowed] 🟡 ' + r.reason);
    process.exit(EXIT.INCONCLUSIVE);
  }
  if (r.verdict === 'fail') {
    console.error('[check-auth-domains-allowed] 🔴 ログインがアプリの外へ出ます（allowNavigation に不足）:');
    for (const m of r.missing) console.error(`    - ${m.domain}   ← ${m.by}`);
    console.error('  → 直し方: capacitor.config の server.allowNavigation に上記を足す。');
    console.error('    ★放置すると「ログインを押すと外部ブラウザが開く」App Store Guideline 4 の');
    console.error('      却下理由になります（kimito.link は 2026-06-30 に実際に却下されました）。');
    process.exit(EXIT.FAIL);
  }
  console.log('[check-auth-domains-allowed] ✅ 合格（' + JSON.stringify(r.evidence) + '）');
  console.log('  → この検査が判定しないこと: ★ログインが成功するかは見ません。外部ブラウザへ出ない設定かだけです。');
  process.exit(EXIT.PASS);
}

main();

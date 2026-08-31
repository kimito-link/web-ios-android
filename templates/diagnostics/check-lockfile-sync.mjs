#!/usr/bin/env node
// check-lockfile-sync.mjs — package.json と lockfile(package-lock.json)の依存関係の不一致を検出する。
//
// 原理: package.json の dependencies/devDependencies に書かれた各パッケージ名が、
//   package-lock.json の packages テーブル(npm v7+形式)に存在するかを静的比較する。
//   lockfile 更新忘れ(package.json だけ編集して npm install し忘れた/コミットし忘れた)は
//   ローカルでは動いてしまう(node_modules は残っている)が、git clone 直後(CI/Vercel)で
//   `npm ci` すると lockfile 基準で解決されるため、そこで初めて壊れる。
//
// 対応: npm の package-lock.json(lockfileVersion 2/3、packages形式)と pnpm-lock.yaml。
//   yarn.lock は対象外。
//
// ───────────────────────────────────────────────────────────────────────────
// ★2026-08-27: 「対象外(skip)」を exit 0（緑）で返していたのを exit 2 に変えた。
//
//   【実損】surechigai-romi.link は pnpm 運用（pnpm-lock.yaml がある）。
//     この検査は package-lock.json しか見ないので
//     「package-lock.json が無い(skip)」と表示して ★exit 0 を返していた。
//     ＝ ★**一度も照合していないのに緑**。
//     「調べて問題なし」と「そもそも調べていない」が区別できていなかった。
//
//   【なぜ fail(1) ではなく inconclusive(2) か】
//     pnpm を使うのは正しい選択であって、製品の不具合ではない。
//     赤にすると常時赤になり、本物の赤が埋もれる（オオカミ少年）。
//     ★「測れなかった」は 2。0 と混ぜないことだけが重要。
//
//   ★掟: 件数0の緑こそ最も危険。
//
// ★2026-08-28: pnpm を「実際に照合する」ようにした（surechigai-romi.link から取り込み）。
//
//   【なぜ足りなかったか】上の exit 2 化は正しいが、それだけだと
//     pnpm リポは**永久に測れないまま**になり、実際に毎回デプロイが止まった。
//     surechigai 側のコミット(e3c7ce93)の言葉:
//       ★「緑をやめるだけでは足りない。測れるようにして初めて意味を持つ」
//
//   【取り込みにあたって変えた点】
//     向こうは pnpm の照合ロジックが実行ブロック(isMain)の中に直書きで、
//     ★毒を食わせて確かめることができなかった（テストも無かった）。
//     こちらでは npm 側と同じく**純関数に切り出し**、--selftest で検証する。
//     ＝ 掟②「exit 2 を持っていることは正しさの保証にならない」への対処。
// ───────────────────────────────────────────────────────────────────────────
//
// 使い方:
//   node diagnostics/check-lockfile-sync.mjs [対象ディレクトリ]  # 省略時はcwd
//   node diagnostics/check-lockfile-sync.mjs --selftest          # ★毒を入れて赤くなるか
//   exit 0 = 整合(照合できた) / exit 1 = 不一致検出(fail-closed) / ★exit 2 = 照合できなかった

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TARGET_DIR = resolve(process.argv[2] || process.cwd());

// ---- 純ロジック(fs非依存・単体テスト可) ----------------------------------

/** @param {Record<string,string>} deps @param {Record<string,unknown>} lockPackages
 *  @returns {string[]} lockfileに存在しない依存名の一覧 */
export function findMissingFromLock(deps, lockPackages) {
  const names = Object.keys(deps || {});
  const packages = lockPackages || {};
  const missing = [];
  for (const name of names) {
    const hasEntry = Object.prototype.hasOwnProperty.call(packages, `node_modules/${name}`);
    if (!hasEntry) missing.push(name);
  }
  return missing;
}

/**
 * pnpm-lock.yaml に依存名が現れるかを見る。
 *
 * ★YAML パーサを足さないのは、依存を増やさないため（この検査は依存ゼロで動く）。
 *   名前の「有無」を見るだけなら行頭のキーを拾えば足りる。
 *
 * ★pnpm-lock.yaml での依存名の現れ方（surechigai-romi.link が実測して合わせた）:
 *     importers 配下 … 「      vitest:」（★インデントは可変。実測で6桁だった）
 *     packages 配下  … 「  '@vitest/expect@2.1.9':」や「  vitest@2.1.9:」
 *
 * ★インデントを2桁と決め打ちしたら vitest を「無い」と誤検知した（自分で作った偽陽性。
 *   実際は34箇所に存在した）。→ 行頭の空白は数えず、名前の直後が ' か @ か : であることだけを見る。
 *
 * @param {Record<string,string>} deps
 * @param {string} lockText pnpm-lock.yaml の生テキスト
 * @returns {string[]} lockfile に見当たらない依存名の一覧
 */
export function findMissingFromPnpmLock(deps, lockText) {
  const names = Object.keys(deps || {});
  const text = typeof lockText === 'string' ? lockText : '';
  const inLock = (/** @type {string} */ name) => {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp("(^|\\n)\\s*'?" + esc + "('|@|:)").test(text);
  };
  return names.filter((n) => !inLock(n));
}

// ---- I/O(直接実行時のみ) ------------------------------------------------------

// process.argv[1] を file:// URL に正規化して比較する(node標準の url.pathToFileURL)。
// 手作りのパス文字列比較はWindowsでスラッシュ方向/ドライブレターの大小差により一致せず
// isMain=false のまま exit 0 で抜ける偽陽性を生む(check-tracked-imports.mjs と同じ既知の罠)。
const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;

/*
 * ── --selftest: ★毒を食わせ、赤が出ることを確認する ──────────────────────
 *
 * ★なぜ要るか（掟②）: 「exit 2 を持っているか」は正しさの保証にならない。
 *   実際、取り込み元(surechigai)はこの pnpm 分岐を手動の変異テストでしか
 *   確かめておらず、機械が繰り返し確認する手段が無かった。
 *
 * ★ここで毒として入れるのは「ざる検知器」になる典型3つ:
 *   ① 依存があるのに lockfile が空 → 見逃したら赤くなれない検知器
 *   ② 依存0件 → ★「一致」と言ってはいけない（件数0の緑）
 *   ③ インデントが深い実データ形 → ★過去に vitest を誤検知した形（偽陽性の再発防止）
 */
if (isMain && process.argv.includes('--selftest')) {
  /** @type {Array<{name:string, ok:() => boolean}>} */
  const cases = [
    {
      name: '★依存があるのに lockfile に無ければ検出する(見逃さない)',
      ok: () => findMissingFromPnpmLock({ vitest: '^2.0.0', zod: '^3.0.0' }, '').length === 2
    },
    {
      name: '★lockfile にあれば検出しない(誤検知しない)',
      ok: () => findMissingFromPnpmLock({ vitest: '^2.0.0' }, "packages:\n  vitest@2.1.9:\n").length === 0
    },
    {
      name: '★インデントが深くても見つける(2桁決め打ちで vitest を誤検知した実損の再発防止)',
      ok: () => findMissingFromPnpmLock({ vitest: '^2.0.0' }, 'importers:\n  .:\n    devDependencies:\n      vitest:\n        specifier: ^2.0.0\n').length === 0
    },
    {
      name: '★スコープ付きパッケージを引用符付きキーで見つける',
      ok: () => findMissingFromPnpmLock({ '@vitest/expect': '^2.0.0' }, "packages:\n  '@vitest/expect@2.1.9':\n").length === 0
    },
    {
      name: '★名前が別語の一部でしかないときは「有る」と言わない',
      ok: () => findMissingFromPnpmLock({ vite: '^5.0.0' }, "packages:\n  vitest@2.1.9:\n").length === 1
    },
    {
      name: '★npm 側: lockfile に無い依存を検出する',
      ok: () => findMissingFromLock({ zod: '^3.0.0' }, {}).length === 1
    },
    {
      name: '★npm 側: lockfile にあれば検出しない',
      ok: () => findMissingFromLock({ zod: '^3.0.0' }, { 'node_modules/zod': {} }).length === 0
    },
    {
      name: '★壊れた入力で throw しない(検知器が落ちたら測れない)',
      ok: () => findMissingFromPnpmLock(null, null).length === 0
        && findMissingFromLock(null, null).length === 0
    }
  ];

  const failed = cases.filter((c) => {
    try { return !c.ok(); } catch { return true; }
  });

  if (failed.length > 0) {
    console.error('[check-lockfile-sync] ★selftest 失敗（検知器が効いていません）:');
    for (const f of failed) console.error(`  - ${f.name}`);
    process.exit(1);
  }
  console.log(`[check-lockfile-sync] selftest OK（${cases.length}件・毒で赤くなる / 誤検知しない / 0件を緑にしない）`);
  process.exit(0);
}

if (isMain) {
  const pkgPath = join(TARGET_DIR, 'package.json');
  const lockPath = join(TARGET_DIR, 'package-lock.json');

  if (!existsSync(pkgPath)) {
    console.error('[check-lockfile-sync] 🟡 package.json が無いため照合できませんでした(★緑ではありません)。');
    console.error('[check-lockfile-sync] → Node プロジェクトのルートで実行してください。');
    process.exit(2);
  }
  // ★pnpm 運用のリポでも実際に照合する（2026-08-28・surechigai-romi.link から取り込み）。
  //   package-lock.json が無いだけで exit 2 にすると、pnpm リポは永久に測れない。
  //   npm リポには影響しない（package-lock.json がある限りこの分岐に入らない）。
  const pnpmLockPath = join(TARGET_DIR, 'pnpm-lock.yaml');
  if (!existsSync(lockPath) && existsSync(pnpmLockPath)) {
    const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const lockText = readFileSync(pnpmLockPath, 'utf8');
    const allDeps = { ...(pkgJson.dependencies || {}), ...(pkgJson.devDependencies || {}) };
    const names = Object.keys(allDeps);
    // ★1件も依存が無いのに「一致」と言わない（件数0の緑こそ最も危険）。
    if (names.length === 0) {
      console.error('[check-lockfile-sync] 🟡 依存が0件のため照合できませんでした(★緑ではありません)。');
      process.exit(2);
    }
    const notInLock = findMissingFromPnpmLock(allDeps, lockText);
    if (notInLock.length > 0) {
      console.error(`[check-lockfile-sync] package.json にあるが pnpm-lock.yaml に見当たらない依存 ${notInLock.length} 件:`);
      for (const n of notInLock) console.error(`  - ${n}`);
      console.error('[check-lockfile-sync] 対処: `pnpm install` で lockfile を更新→ pnpm-lock.yaml をコミット。');
      console.error('[check-lockfile-sync] ★この検査が判定しないこと: 版の一致は見ません（名前の有無だけ）。');
      process.exit(1);
    }
    console.log(`[check-lockfile-sync] OK(pnpm・依存 ${names.length} 件・lockfile に無いもの 0 件)。`);
    console.log('[check-lockfile-sync] ★この検査が判定しないこと: 版の一致は見ません（名前の有無だけ）。');
    process.exit(0);
  }

  if (!existsSync(lockPath)) {
    console.error('[check-lockfile-sync] 🟡 lockfile が無いため照合できませんでした(★緑ではありません)。');
    console.error('[check-lockfile-sync] → npm なら npm install、pnpm なら pnpm install を実行してください。');
    console.error('[check-lockfile-sync] ★この検査が判定しないこと: yarn.lock は見ません。');
    process.exit(2);
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (!lock.packages) {
    console.error('[check-lockfile-sync] 🟡 lockfileVersion 1形式のため照合できませんでした(★緑ではありません)。');
    console.error('[check-lockfile-sync] → npm install で lockfileVersion 2/3 に更新してください。');
    process.exit(2);
  }

  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const missing = findMissingFromLock(deps, lock.packages);

  if (missing.length > 0) {
    console.error(`[check-lockfile-sync] package.jsonにあるがlockfileに無い依存 ${missing.length} 件:`);
    for (const name of missing) console.error(`  - ${name}`);
    console.error('[check-lockfile-sync] 対処: `npm install` を実行しlockfileを更新→ package-lock.json をコミット。');
    process.exit(1);
  }
  console.log(`[check-lockfile-sync] OK(依存 ${Object.keys(deps).length} 件・lockfile不一致 0 件)。`);
}

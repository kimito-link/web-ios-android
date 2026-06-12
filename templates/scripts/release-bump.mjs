#!/usr/bin/env node
// 移植元: Exosome/scripts/release-bump.mjs
//
// 1 操作で 3 プラットフォームのバージョンを一括 bump する。
// app.config.json を SSOT とする運用: SW キャッシュ名の prefix だけは「アプリ固有」かつ
// ファイル内文字列なので、ハードコードせず env SW_CACHE_PREFIX か app.config.json の
// identity.shortName から導出する(下記参照)。それ以外の固有値は持たない。
//
// 更新対象(存在するものだけ。レイアウト依存のオプション項目は無ければ警告してスキップ):
//   1. package.json    -> "version": "x.y.z"            (常に)
//   2. <android-twa>/app/build.gradle -> versionCode +1, versionName "x.y.z" (常に)
//   3. sw.js           -> CACHE_NAME prefix + 連番 +1   (PWA を使うとき)
//   4. index.html      -> <meta name="app-version">     (アプリ内表示があるとき)
//   5. app.js          -> DEFAULT_APP_VERSION           (同上)
//   6. app-latest.json -> ios/android                   (アプリ内更新通知を使うとき)
//   7. CHANGELOG.md    -> release-notes/CURRENT-ja.txt から追記
//   8. release-history/<x.y.z>.json -> リリース証跡の雛形
//
// Usage:
//   node scripts/release-bump.mjs <new-version>
//   node scripts/release-bump.mjs --patch       (auto bump patch, e.g. 2.3.14 -> 2.3.15)
//   node scripts/release-bump.mjs --minor       (2.3.14 -> 2.4.0)
//   node scripts/release-bump.mjs --major       (2.3.14 -> 3.0.0)
//   node scripts/release-bump.mjs --no-changelog
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfg } from './lib/app-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const PKG = path.join(REPO, 'package.json');
const GRADLE = path.join(REPO, 'android-twa', 'app', 'build.gradle');
const SW = path.join(REPO, 'sw.js');
const CHANGELOG = path.join(REPO, 'CHANGELOG.md');
const NOTES = path.join(REPO, 'release-notes', 'CURRENT-ja.txt');
const INDEX_HTML = path.join(REPO, 'index.html');
const APP_JS = path.join(REPO, 'app.js');
const APP_LATEST = path.join(REPO, 'app-latest.json');

// SW キャッシュ名の prefix。優先順:
//   1. env SW_CACHE_PREFIX
//   2. app.config.json identity.shortName から導出(小文字 + "-cache-v")
//   3. fallback "app-cache-v"
// 例: shortName="NekoDiary" → "nekodiary-cache-v<N>"
const SW_CACHE_PREFIX =
  process.env.SW_CACHE_PREFIX ||
  (() => {
    const shortName = cfg('identity.shortName');
    if (shortName) {
      return `${String(shortName).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-cache-v`;
    }
    return 'app-cache-v';
  })();

const args = process.argv.slice(2);
const skipChangelog = args.includes('--no-changelog');
const bumpKind = args.find((a) => ['--patch', '--minor', '--major'].includes(a));
const explicit = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));

if (!bumpKind && !explicit) {
  console.error('Usage: node scripts/release-bump.mjs <x.y.z> | --patch | --minor | --major [--no-changelog]');
  process.exit(2);
}

function bump(curr, kind) {
  const [maj, min, pat] = curr.split('.').map(Number);
  if (kind === '--patch') return `${maj}.${min}.${pat + 1}`;
  if (kind === '--minor') return `${maj}.${min + 1}.0`;
  if (kind === '--major') return `${maj + 1}.0.0`;
  return curr;
}

const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
const fromVersion = pkg.version;
const toVersion = explicit || bump(fromVersion, bumpKind);

if (toVersion === fromVersion) {
  console.error(`Refusing to bump: ${fromVersion} -> ${toVersion} is identical.`);
  process.exit(2);
}

console.log(`Version: ${fromVersion} -> ${toVersion}`);

pkg.version = toVersion;
fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
console.log(`  package.json updated`);

// build.gradle は Android を出すなら必須。無いときは警告してスキップ。
if (fs.existsSync(GRADLE)) {
  let gradle = fs.readFileSync(GRADLE, 'utf8');
  const codeMatch = gradle.match(/(versionCode\s+)(\d+)/);
  if (!codeMatch) {
    throw new Error('Could not find versionCode in android-twa/app/build.gradle');
  }
  const oldCode = Number(codeMatch[2]);
  const newCode = oldCode + 1;
  gradle = gradle.replace(/(versionCode\s+)\d+/, `$1${newCode}`);
  gradle = gradle.replace(/(versionName\s+)"[^"]*"/, `$1"${toVersion}"`);
  fs.writeFileSync(GRADLE, gradle);
  console.log(`  build.gradle updated (versionCode ${oldCode} -> ${newCode}, versionName ${toVersion})`);
} else {
  console.warn('  [warn] android-twa/app/build.gradle が無いためスキップ(Android を出さない構成)');
}

// 以下はレイアウト依存のオプション項目。ファイルが「無い」ならスキップ。
// ファイルは「ある」のにパターン不一致なら throw(黙ってズレ続けるのを防ぐ)。
if (fs.existsSync(SW)) {
  let sw = fs.readFileSync(SW, 'utf8');
  // prefix を正規表現に流用(特殊文字をエスケープ)。CACHE_NAME = '<prefix><N>' を想定。
  const escaped = SW_CACHE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const swRe = new RegExp(`(CACHE_NAME\\s*=\\s*'${escaped})(\\d+)(')`);
  const swMatch = sw.match(swRe);
  if (swMatch) {
    const oldCacheN = Number(swMatch[2]);
    const newCacheN = oldCacheN + 1;
    sw = sw.replace(swMatch[0], `${swMatch[1]}${newCacheN}${swMatch[3]}`);
    fs.writeFileSync(SW, sw);
    console.log(`  sw.js cache version ${oldCacheN} -> ${newCacheN} (prefix="${SW_CACHE_PREFIX}")`);
  } else {
    console.warn(
      `  [warn] sw.js: CACHE_NAME = '${SW_CACHE_PREFIX}<N>' パターンに一致せず。` +
        `prefix が違う場合は env SW_CACHE_PREFIX で指定するか、このブロックを調整してください。`,
    );
  }
} else {
  console.warn('  [warn] sw.js が無いためスキップ(PWA 未使用の構成)');
}

if (fs.existsSync(INDEX_HTML)) {
  let indexHtml = fs.readFileSync(INDEX_HTML, 'utf8');
  const metaRe = /(<meta\s+name="app-version"\s+content=")[^"]*(">)/;
  if (metaRe.test(indexHtml)) {
    indexHtml = indexHtml.replace(metaRe, `$1${toVersion}$2`);
    fs.writeFileSync(INDEX_HTML, indexHtml);
    console.log(`  index.html app-version meta -> ${toVersion}`);
  } else {
    console.warn('  [warn] index.html に <meta name="app-version"> が無いためスキップ');
  }
}

if (fs.existsSync(APP_JS)) {
  let appJs = fs.readFileSync(APP_JS, 'utf8');
  const defaultVerRe = /(const DEFAULT_APP_VERSION = ')[^']*(';)/;
  if (defaultVerRe.test(appJs)) {
    appJs = appJs.replace(defaultVerRe, `$1${toVersion}$2`);
    fs.writeFileSync(APP_JS, appJs);
    console.log(`  app.js DEFAULT_APP_VERSION -> ${toVersion}`);
  } else {
    console.warn('  [warn] app.js に DEFAULT_APP_VERSION が無いためスキップ');
  }
}

if (fs.existsSync(APP_LATEST)) {
  const latest = JSON.parse(fs.readFileSync(APP_LATEST, 'utf8'));
  latest.ios = toVersion;
  latest.android = toVersion;
  fs.writeFileSync(APP_LATEST, JSON.stringify(latest, null, 2) + '\n');
  console.log(`  app-latest.json ios/android -> ${toVersion}`);
}

if (!skipChangelog && fs.existsSync(NOTES)) {
  const notes = fs.readFileSync(NOTES, 'utf8').replace(/\r\n/g, '\n').trim();
  if (!fs.existsSync(CHANGELOG)) {
    fs.writeFileSync(
      CHANGELOG,
      `# Changelog\n\n## ${toVersion} - ${new Date().toISOString().slice(0, 10)}\n\n${notes}\n`,
    );
  } else {
    const existing = fs.readFileSync(CHANGELOG, 'utf8');
    const header = `## ${toVersion} - ${new Date().toISOString().slice(0, 10)}\n\n${notes}\n\n`;
    if (existing.startsWith('# ')) {
      const [first, ...rest] = existing.split('\n\n');
      fs.writeFileSync(CHANGELOG, [first, header.trimEnd(), rest.join('\n\n')].join('\n\n') + '\n');
    } else {
      fs.writeFileSync(CHANGELOG, header + existing);
    }
  }
  console.log(`  CHANGELOG.md updated`);
}

// リリース履歴の雛形(5年運用視点。「いつ何を見て GO したか」の証跡)。
const RELEASE_HISTORY_DIR = path.join(REPO, 'release-history');
try {
  if (!fs.existsSync(RELEASE_HISTORY_DIR)) {
    fs.mkdirSync(RELEASE_HISTORY_DIR, { recursive: true });
  }
  const historyPath = path.join(RELEASE_HISTORY_DIR, `${toVersion}.json`);
  let notesText = '';
  if (fs.existsSync(NOTES)) {
    notesText = fs.readFileSync(NOTES, 'utf8').replace(/\r\n/g, '\n').trim();
  }
  const skeleton = {
    version: toVersion,
    bumped_from: fromVersion,
    bumped_at: new Date().toISOString(),
    release_notes: notesText,
    // 以下は release workflow が完了時に追記する想定(手動で埋めても良い):
    gate_blackscreen_check_run_id: null,
    gate_blackscreen_check_result: null,
    gate_blackscreen_luma: null,
    released_at: null,
    released_git_sha: null,
    released_by: null,
  };
  fs.writeFileSync(historyPath, JSON.stringify(skeleton, null, 2) + '\n');
  console.log(`  release-history/${toVersion}.json (雛形を生成。release workflow / 手動で埋めて使う)`);
} catch (e) {
  const msg = (e && e.message ? e.message : String(e)).slice(0, 80);
  console.warn(`  [warn] release-history 雛形生成に失敗: ${msg}`);
}

console.log(`\nDone. Next:`);
console.log(`  git add -A`);
console.log(`  git commit -m "release: ${toVersion}"`);
console.log(`  git push        # iOS / Android workflows trigger automatically`);

#!/usr/bin/env node
// 同一 Team のアプリ同士が「別アプリに見えるか」を、姉妹リポを横断して点検する（4.3(a) の自己点検）。
//
// 位置づけ: ★Apple の判定の再現ではありません。公式の寄与要因（同型のメタデータ・重なる機能）を、
//   提出前に自分で点検するだけです。1リポの CI には姉妹が無いので、ここは姉妹リポを並べて読みます。
//   設計: _docs/DESIGN-apple-4-3a-spam-response-2026-10-06.md §C2（③機能の交わり・⑤メタデータの型）
//
// 見るもの: 各アプリの app.config.json の distinction（coreFeatures / oneLiner）、
//   store-assets/appstore/description-ja*.txt、release-notes/CURRENT-ja.txt。
// 見ないもの（未実装・設計の②④）: コード同一率(jscpd)・スクショの知覚ハッシュ。それらは別の道具で補う。
//   ★distinction が未宣言のアプリは「測れない」（緑にしない）。
//
// 使い方:
//   node templates/scripts/verify-team-distinction.mjs --root <リポ群の親ディレクトリ> [--repos a,b,c] [--team-id <ID>]
//   node templates/scripts/verify-team-distinction.mjs --selftest
//
// 終了コード（instrument-core の3値）: 0=合格 / 1=測れた上での赤 / 2=測れなかった項目あり（fail は無い）
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeTeam, exitCodeFor } from './lib/team-distinction-core.mjs';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const C = { red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', dim: '\x1b[2m', reset: '\x1b[0m' };

function readIfExists(p) {
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  } catch {
    return null;
  }
}

/** 1リポ分を読む。app.config.json が無ければ null。 */
export function loadTeamApp(repoDir) {
  const raw = readIfExists(path.join(repoDir, 'app.config.json'));
  if (raw == null) return null;
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch {
    return { name: path.basename(repoDir), broken: true };
  }
  const apDir = path.join(repoDir, 'store-assets', 'appstore');
  let desc = null;
  if (fs.existsSync(apDir)) {
    const names = fs.readdirSync(apDir).filter((f) => /^description-.*\.txt$/i.test(f));
    const ja = names.find((f) => /^description-ja/i.test(f)) || names[0];
    if (ja) desc = readIfExists(path.join(apDir, ja));
  }
  return {
    name: cfg.identity?.displayName || path.basename(repoDir),
    teamId: cfg.stores?.appleTeamId ?? null,
    distinction: cfg.distinction ?? null,
    descriptionText: desc,
    releaseNotesText: readIfExists(path.join(repoDir, 'release-notes', 'CURRENT-ja.txt')),
  };
}

function print(findings) {
  for (const f of findings) {
    const mark =
      f.status === 'ok' ? `${C.green}✓` : f.status === 'warn' ? `${C.yellow}!` : f.status === 'fail' ? `${C.red}✗` : `${C.dim}?`;
    console.log(`${mark}${C.reset} [${f.check}] ${f.pair} — ${f.detail}`);
  }
}

function selftest() {
  const mk = (name, features, one, desc, notes) => ({
    name,
    distinction: { oneLiner: one, coreFeatures: features },
    descriptionText: desc,
    releaseNotesText: notes,
  });
  const A = mk(
    'アプリA',
    ['位置の記録', '図鑑', 'すれ違い'],
    'AはXの人柄つきで場所を記録するアプリです',
    '足あとを残して市区町村の図鑑を埋めるアプリです。同じ場所を通った人と時間差ですれ違えます。',
    'はじめまして。『アプリA』の最初のリリースです。',
  );
  const B = mk(
    'アプリB',
    ['ライブ参加表明', '全国マップ', '応援ランキング'],
    'Bはライブの参加予定を全国マップに集めるアプリです',
    '推しのライブへの参加予定を表明して、全国の仲間と応援ランキングを競えるアプリです。',
    '今回は全国マップの見やすさを改善しました。',
  );
  const cases = [
    ['別物の2本は fail なし', exitCodeFor(analyzeTeam([A, B])) === 0],
    [
      '【毒】機能が重なれば fail',
      analyzeTeam([A, { ...B, distinction: { ...B.distinction, coreFeatures: ['位置の記録', '全国マップ', '応援ランキング'] } }]).some(
        (f) => f.check === 'core-features-overlap' && f.status === 'fail',
      ),
    ],
    [
      '【毒】説明文が同一なら fail',
      analyzeTeam([A, { ...B, descriptionText: A.descriptionText }]).some((f) => f.check === 'description-jaccard' && f.status === 'fail'),
    ],
    [
      '【毒】リリースノート冒頭が名称以外同型なら fail',
      analyzeTeam([A, { ...B, releaseNotesText: 'はじめまして。『アプリB』の最初のリリースです。' }]).some(
        (f) => f.check === 'release-notes-first-sentence' && f.status === 'fail',
      ),
    ],
    ['distinction 未宣言は「測れない」(2)で、緑にしない', exitCodeFor(analyzeTeam([A, { name: 'アプリC' }])) === 2],
  ];
  let bad = 0;
  for (const [name, pass] of cases) {
    console.log(`${pass ? `${C.green}✓` : `${C.red}✗`}${C.reset} ${name}`);
    if (!pass) bad++;
  }
  if (bad) {
    console.error(`❌ selftest 失敗 ${bad}件`);
    process.exit(1);
  }
  console.log(`✅ selftest 合格（${cases.length}件: 別物は緑／重なり・同一・同型は赤／未宣言は測れない）`);
}

function main() {
  if (process.argv.includes('--selftest')) return selftest();
  const root = arg('--root', null);
  if (!root) {
    console.error('--root <リポ群の親ディレクトリ> が必要です（例: github/）。');
    process.exit(2);
  }
  const only = (arg('--repos', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const teamId = arg('--team-id', null);
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && (only.length === 0 || only.includes(e.name)))
    .map((e) => path.join(root, e.name));
  const apps = [];
  for (const d of dirs) {
    const a = loadTeamApp(d);
    if (!a) continue;
    if (a.broken) {
      console.error(`app.config.json を読めない: ${d}（測れない）`);
      process.exit(2);
    }
    if (teamId && a.teamId && a.teamId !== teamId) continue;
    apps.push(a);
  }
  if (apps.length < 2) {
    console.error(`[verify-team-distinction] 比較対象が ${apps.length} 本しか無い（★緑ではありません。一度も比べていません）`);
    process.exit(2);
  }
  const findings = analyzeTeam(apps);
  print(findings);
  const code = exitCodeFor(findings);
  console.log('');
  console.log(
    code === 0
      ? `${C.green}[verify-team-distinction] ✅ 合格（${apps.length}本・全ペア）${C.reset}`
      : code === 1
        ? `${C.red}[verify-team-distinction] 🔴 赤あり${C.reset}`
        : `${C.yellow}[verify-team-distinction] 🟡 測れなかった項目あり（★緑ではありません）${C.reset}`,
  );
  console.log('★この検査が判定しないこと: コード同一率・スクショの類似・Apple が実際にどう見るか。distinction が正直に書かれているかも見ません。');
  process.exit(code);
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) main();

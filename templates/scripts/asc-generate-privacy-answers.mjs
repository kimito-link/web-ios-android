#!/usr/bin/env node
// App Store Connect「App のプライバシー」（プライバシー栄養ラベル）に人間が ASC UI で
// 入力すべき内容を、Google Play の data-safety.csv から機械的に導出したチェックリストとして出力する。
//
// ─────────────────────────────────────────────────────────────────────────
// ■ なぜ要るか（2026-09-14, doin-challenge.com 実損）
//
//   新規アプリの初回提出が submit 段階で 409 APP_DATA_USAGES_REQUIRED で連続失敗した。
//   真因は ASC の「アプリのプライバシー」が一度も回答されていなかったこと
//   （_docs/FIRST-SUBMISSION-blockers.md B8）。Android には
//   play-generate-data-safety-csv.mjs / play-fill-data-safety.mjs という自動化が
//   既にあるのに、iOS 側には同等の仕組みが無かった（Android にある自動化が iOS に無い）。
//
//   実際に doin-challenge.com の ASC UI へ手作業で24回答した内容は、
//   既に作成済みの Play 用 store-assets/play/data-safety.csv から機械的に
//   導出できるものだった（用途・ユーザー紐づけ・トラッキングの3問とも、
//   Play 側の回答から一意に決まった）。
//
// ■ ★これは自動入力ツールではない（意図的な設計）
//
//   _docs/apple-reject-knowledge-base.md に記録済みの通り、App Privacy の
//   dataUsage 系は標準 JWT API には無く、iris API + web セッション cookie でしか
//   認証できない（asc-readonly-checks.mjs checkAppPrivacyPublished のコメント参照）。
//   ここを自動化しようとすると「10回ハマる」と明記されている。
//   **このスクリプトが出すのは人間が ASC UI に入力するためのチェックリストだけ**。
//   API を叩いて自動入力しようとしない。
//
// ■ 何をするか
//
//   1. store-assets/play/data-safety.csv を読み、TRUE になっている
//      PSL_DATA_TYPES_* 行から「収集しているデータタイプ」を洗い出す。
//   2. 既知の Play→Apple マッピング表（下記 KNOWN_MAPPINGS）にあるものだけ、
//      Apple 側のデータタイプ名・3問の回答（用途 / ユーザ紐づけ / トラッキング）を
//      根拠つきで出力する。
//   3. マッピング表に無い PSL_ タイプが TRUE なら「未対応・要手動判断」と明記する
//      （抜け漏れを暗黙に無視しない。4基準①「足りない項目は未実装と明記」）。
//   4. package.json から広告・計測SDKを検出し、1つでもあれば
//      「トラッキング=いいえ と答えてはいけない」と警告する（誤申告防止）。
//
// 使い方:
//   node scripts/asc-generate-privacy-answers.mjs
//     [--csv <path>]           既定: store-assets/play/data-safety.csv
//     [--out <path>]           既定: _docs/asc-privacy-answers-generated.md
//     [--json]                 markdown の代わりに JSON を stdout に出す
//
// 入力が無い場合（store-assets/play/data-safety.csv が無い）はエラー終了する
// （このスクリプトの前提そのものが崩れるため、warn ではなく fail）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

// ----------------------------------------------------------------------------
// KNOWN_MAPPINGS — Google Play data-safety の PSL_ データタイプ → Apple App Privacy
// のデータタイプへの対応表。
//
// ★実測の出典: doin-challenge.com（2026-09-14, ascAppId 6808515868）の初回提出で
// 実際に ASC UI へ手作業で入力し、正しく受理された8データタイプのうち7つがここに
// 含まれる（残り1つは Sentry の有無から独立に導出する診断カテゴリ、下記参照）。
//
// 各エントリの意味:
//   applePath   : ASC UI 上でのカテゴリ > データタイプの表記
//   purpose     : Apple の「用途」選択肢のうち、Play 側の回答から導ける既定値
//                 （Play に「アカウント管理」という独立カテゴリは無いため、
//                 Apple 側に統合されている場合は "アプリの機能" に寄せる）
//   linkedNote  : 「ユーザーに紐づくか」を判定する根拠の説明（機械的に決め打ちしない。
//                 アカウント基盤の有無を利用側に確認させる）
//   trackingDefault: Play 側で Shared/Advertising が空欄なら「いいえ」が既定だが、
//                 これは呼び出し側で SDK 検出結果と突き合わせて上書きされる
// ----------------------------------------------------------------------------
const KNOWN_MAPPINGS = {
  PSL_NAME: {
    applePath: '連絡先情報 > 名前',
    purpose: 'アプリの機能',
    linkedNote: 'アカウント基盤（例: Clerk 等）に紐づく値であれば「はい」',
  },
  PSL_EMAIL: {
    applePath: '連絡先情報 > メールアドレス',
    purpose: 'アプリの機能',
    linkedNote: 'アカウント基盤に紐づく値であれば「はい」',
  },
  PSL_USER_ACCOUNT: {
    applePath: 'ID > ユーザID',
    purpose: 'アプリの機能',
    linkedNote: 'ユーザーIDそのものなので通常「はい」',
  },
  PSL_USER_GENERATED_CONTENT: {
    applePath: 'ユーザコンテンツ > その他のユーザコンテンツ',
    purpose: 'アプリの機能',
    linkedNote: 'アカウントに紐づいた投稿・入力内容であれば「はい」',
  },
  PSL_IN_APP_SEARCH_HISTORY: {
    applePath: '使用状況データ > 検索履歴',
    purpose: 'アプリの機能',
    linkedNote: 'Play 側で「ユーザーが選択可能」(optional)なら任意入力データ。' +
      'アカウントに紐づけて保存していなければ「いいえ」の余地あり（実装を確認すること）',
  },
  PSL_USER_INTERACTION: {
    applePath: '使用状況データ > 製品の操作',
    purpose: 'アプリの機能',
    linkedNote: 'アカウントに紐づけて分析していれば「はい」、匿名集計のみなら「いいえ」の余地あり',
  },
  PSL_APPS_ON_DEVICE: {
    applePath: '該当なし（Appleにこの分類は存在しない。使用状況データへの計上を検討）',
    purpose: '要手動判断',
    linkedNote: '未対応: Apple 側に直接対応するカテゴリが無い。ASC UI で類似カテゴリを手動選定すること',
  },
  PSL_OTHER_APP_ACTIVITY: {
    applePath: '使用状況データ > その他の使用状況データ',
    purpose: '要手動判断',
    linkedNote: '内容次第で紐づくか変わる。実装を確認してから回答すること',
  },
  PSL_CRASH_LOGS: {
    applePath: '診断 > クラッシュデータ',
    purpose: 'アプリの機能',
    linkedNote: 'Sentry 等のクラッシュレポートSDKがあれば該当。個人と紐づけていなければ「いいえ」の余地あり',
    sdkDerived: true,
  },
  PSL_PERFORMANCE_DIAGNOSTICS: {
    applePath: '診断 > パフォーマンスデータ',
    purpose: 'アプリの機能',
    linkedNote: 'Sentry 等のパフォーマンス計測SDKがあれば該当',
    sdkDerived: true,
  },
};

// このスクリプトが「収集している」と判定するための、Play CSV 上の行の条件:
//   1行目の列0が PSL_DATA_TYPES_* で、Response value が TRUE。
const DATA_TYPES_ROW_PREFIX = 'PSL_DATA_TYPES_';

// 既知の広告・計測SDK（1つでも package.json に見つかれば「トラッキング=いいえ」を警告する）。
// ★Sentry はクラッシュ/パフォーマンス診断であり広告トラッキングではないため、ここには含めない。
const TRACKING_SDK_PATTERNS = [
  { name: 'Google AdMob', pattern: /admob|react-native-google-mobile-ads|@react-native-firebase\/admob/i },
  { name: 'Firebase Analytics', pattern: /@react-native-firebase\/analytics|firebase\/analytics/i },
  { name: 'PostHog', pattern: /posthog/i },
  { name: 'Amplitude', pattern: /amplitude/i },
  { name: 'AppsFlyer', pattern: /appsflyer/i },
  { name: 'Facebook/Meta SDK', pattern: /react-native-fbsdk|facebook-android-sdk|FBSDKCoreKit/i },
  { name: 'Mixpanel', pattern: /mixpanel/i },
  { name: 'Segment', pattern: /@segment\/analytics|analytics-react-native/i },
];

function parseArgs(argv) {
  const out = { csv: null, out: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--csv') out.csv = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--json') out.json = true;
  }
  return out;
}

// data-safety.csv は Play Console 由来（クオート内カンマを含む）なので単純 split(',') は使わない。
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/\r\n/g, '\n');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}

function detectCollectedDataTypes(csvRows) {
  // 1行目はヘッダ。列: [questionId, responseId, value, requirement, label]
  const collected = [];
  for (const r of csvRows.slice(1)) {
    const [questionId, responseId, value] = r;
    if (!questionId || !questionId.startsWith(DATA_TYPES_ROW_PREFIX)) continue;
    if (String(value).trim().toUpperCase() !== 'TRUE') continue;
    if (!responseId) continue;
    collected.push(responseId.trim());
  }
  return [...new Set(collected)];
}

function detectTrackingSdks(pkg) {
  if (!pkg) return [];
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const names = Object.keys(deps);
  const hits = [];
  for (const { name, pattern } of TRACKING_SDK_PATTERNS) {
    if (names.some((n) => pattern.test(n))) hits.push(name);
  }
  return hits;
}

function detectDiagnosticsSdk(pkg) {
  if (!pkg) return false;
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  return Object.keys(deps).some((n) => /@sentry\//i.test(n) || /^sentry/i.test(n));
}

export function buildAnswerPlan({ csvText, pkg }) {
  const csvRows = parseCsv(csvText);
  const collectedTypes = detectCollectedDataTypes(csvRows);
  const trackingSdks = detectTrackingSdks(pkg);
  const hasDiagnosticsSdk = detectDiagnosticsSdk(pkg);

  const answered = [];
  const unmapped = [];

  for (const psl of collectedTypes) {
    const mapping = KNOWN_MAPPINGS[psl];
    if (!mapping) {
      unmapped.push(psl);
      continue;
    }
    if (mapping.sdkDerived && psl !== 'PSL_CRASH_LOGS' && psl !== 'PSL_PERFORMANCE_DIAGNOSTICS') {
      // 予約(現状 KNOWN_MAPPINGS に他の sdkDerived エントリは無いが、将来の拡張で
      // 「SDK検出が前提のマッピング」を安全に無効化できるようガードしておく。
      continue;
    }
    if ((psl === 'PSL_CRASH_LOGS' || psl === 'PSL_PERFORMANCE_DIAGNOSTICS') && !hasDiagnosticsSdk) {
      // Play 側で TRUE でも、実装に診断SDKが見当たらなければ根拠不明。手動確認へ回す。
      unmapped.push(`${psl} (診断SDK未検出。実装を確認してから回答すること)`);
      continue;
    }
    const trackingAnswer = trackingSdks.length > 0
      ? { value: '要確認', note: `広告/計測SDK検出済み(${trackingSdks.join(', ')})につき「いいえ」と機械的に断定しない` }
      : { value: 'いいえ', note: 'Play側でShared/Advertisingが空欄、かつ既知の広告/計測SDK未検出' };
    answered.push({
      psl,
      applePath: mapping.applePath,
      purpose: mapping.purpose,
      linkedNote: mapping.linkedNote,
      tracking: trackingAnswer,
    });
  }

  return {
    collectedTypes,
    answered,
    unmapped,
    trackingSdks,
    hasDiagnosticsSdk,
  };
}

function renderMarkdown(plan, { csvPath }) {
  const lines = [];
  lines.push('# App Store Connect「アプリのプライバシー」入力チェックリスト（自動生成）');
  lines.push('');
  lines.push(`- 生成元: \`${csvPath}\``);
  lines.push(`- 生成日時: ${new Date().toISOString()}`);
  lines.push('- ★これは自動入力ツールではない。ASC UI に人間が入力するための下書きである');
  lines.push('  （API での自動書き込みは`_docs/apple-reject-knowledge-base.md`により原理的に不可と実測済み）');
  lines.push('- 出力後は必ず ASC UI「アプリのプライバシー」で実際の実装と突き合わせてから入力し、');
  lines.push('  最後に右上「公開」を押すこと（保存だけでは審査に出せない。B8）');
  lines.push('');

  if (plan.trackingSdks.length) {
    lines.push('## ⚠️ 警告: 広告/計測SDKを検出');
    lines.push('');
    lines.push(`検出: ${plan.trackingSdks.join(', ')}`);
    lines.push('');
    lines.push('これらが1つでもあるデータタイプについて、機械的に「トラッキング=いいえ」と');
    lines.push('答えてはいけない。実際にそのSDKがこのデータタイプをトラッキング目的で使っているか、');
    lines.push('実装を確認してから回答すること（誤申告は Apple 審査での却下・アカウント停止リスク）。');
    lines.push('');
  }

  lines.push('## 回答案（根拠つき）');
  lines.push('');
  if (!plan.answered.length) {
    lines.push('（該当データタイプなし）');
  }
  for (const a of plan.answered) {
    lines.push(`### ${a.applePath}`);
    lines.push('');
    lines.push(`- Play側の元データタイプ: \`${a.psl}\``);
    lines.push(`- 用途（收集理由）: **${a.purpose}**`);
    lines.push(`- ユーザーに紐づくか: ${a.linkedNote}`);
    lines.push(`- トラッキングに使用: **${a.tracking.value}**（${a.tracking.note}）`);
    lines.push('');
  }

  if (plan.unmapped.length) {
    lines.push('## ⚠️ 未対応・要手動判断（マッピング表に無い、または根拠不十分）');
    lines.push('');
    lines.push('以下は data-safety.csv 側で「収集している」と回答されているが、');
    lines.push('このスクリプトの対応表（KNOWN_MAPPINGS）に含まれていないか、機械的な根拠が');
    lines.push('不十分なため自動生成を見送った。ASC UI で該当するデータタイプを手動確認すること:');
    lines.push('');
    for (const u of plan.unmapped) lines.push(`- ${u}`);
    lines.push('');
  }

  lines.push('## 所要時間の目安');
  lines.push('');
  lines.push('データタイプ1つあたり3問（用途 / ユーザーに紐づくか / トラッキング）で');
  lines.push('画面を6回遷移する。8タイプで実測約40分（_docs/FIRST-SUBMISSION-blockers.md B8参照）。');
  lines.push('');

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const csvPath = path.resolve(REPO, args.csv || 'store-assets/play/data-safety.csv');
  const outPath = path.resolve(REPO, args.out || '_docs/asc-privacy-answers-generated.md');
  const pkgPath = path.join(REPO, 'package.json');

  if (!fs.existsSync(csvPath)) {
    console.error(
      `[asc-generate-privacy-answers] ${path.relative(REPO, csvPath)} が無い。` +
      'このスクリプトは Play の data-safety.csv を前提にしているため、先に' +
      ' play-generate-data-safety-csv.mjs を実行するか、Play Console から手動エクスポートすること。',
    );
    process.exit(1);
  }

  const csvText = fs.readFileSync(csvPath, 'utf8');
  const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : null;

  const plan = buildAnswerPlan({ csvText, pkg });

  if (args.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const md = renderMarkdown(plan, { csvPath: path.relative(REPO, csvPath) });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`[asc-generate-privacy-answers] wrote ${path.relative(REPO, outPath)}`);
  console.log(`  収集データタイプ: ${plan.collectedTypes.length}件（対応表あり: ${plan.answered.length}件, 要手動判断: ${plan.unmapped.length}件）`);
  if (plan.trackingSdks.length) {
    console.log(`  ⚠️ 広告/計測SDK検出: ${plan.trackingSdks.join(', ')} — トラッキング回答は自動で「いいえ」にしていない`);
  }
}

// --- selftest -----------------------------------------------------------------
function runSelftest() {
  const failing = [];
  const check = (label, cond) => { if (!cond) failing.push(label); };

  // 毒1: doin-challenge.com 実データと同型のCSV(簡略版) → 既知7タイプが全て検出されること。
  const sampleCsv = [
    'Question ID (machine readable),Response ID (machine readable),Response value,Answer requirement,Human-friendly question label',
    'PSL_DATA_TYPES_PERSONAL,PSL_NAME,TRUE,MULTIPLE_CHOICE,Personal info / Name',
    'PSL_DATA_TYPES_PERSONAL,PSL_EMAIL,TRUE,MULTIPLE_CHOICE,Personal info / Email address',
    'PSL_DATA_TYPES_PERSONAL,PSL_USER_ACCOUNT,TRUE,MULTIPLE_CHOICE,Personal info / User IDs',
    'PSL_DATA_TYPES_APP_ACTIVITY,PSL_USER_INTERACTION,TRUE,MULTIPLE_CHOICE,App activity / App interactions',
    'PSL_DATA_TYPES_APP_ACTIVITY,PSL_IN_APP_SEARCH_HISTORY,TRUE,MULTIPLE_CHOICE,App activity / In-app search history',
    'PSL_DATA_TYPES_APP_ACTIVITY,PSL_USER_GENERATED_CONTENT,TRUE,MULTIPLE_CHOICE,App activity / Other user-generated content',
    'PSL_DATA_TYPES_APP_PERFORMANCE,PSL_CRASH_LOGS,TRUE,MULTIPLE_CHOICE,App performance / Crash logs',
    'PSL_DATA_TYPES_PERSONAL,PSL_PHONE,FALSE,MULTIPLE_CHOICE,Personal info / Phone number',
  ].join('\n');
  const pkgWithSentry = { dependencies: { '@sentry/node': '^10.0.0' } };
  const plan1 = buildAnswerPlan({ csvText: sampleCsv, pkg: pkgWithSentry });
  check('毒1: PSL_PHONE(FALSE)は収集扱いにしない', !plan1.collectedTypes.includes('PSL_PHONE'));
  check('毒1: 7タイプ検出', plan1.collectedTypes.length === 7);
  check('毒1: 7タイプ全てがKNOWN_MAPPINGSで解決', plan1.answered.length === 7);
  check('毒1: crash logsはSentry検出で解決される', plan1.answered.some((a) => a.psl === 'PSL_CRASH_LOGS'));
  check('毒1: 未対応0件', plan1.unmapped.length === 0);
  check('毒1: 広告SDK無しでトラッキング=いいえ', plan1.answered.every((a) => a.tracking.value === 'いいえ'));

  // 毒2: 診断SDKが無いのにcrash logsがTRUE → 機械的に断定せず unmapped へ回す。
  const plan2 = buildAnswerPlan({
    csvText: [
      'Question ID (machine readable),Response ID (machine readable),Response value,Answer requirement,Human-friendly question label',
      'PSL_DATA_TYPES_APP_PERFORMANCE,PSL_CRASH_LOGS,TRUE,MULTIPLE_CHOICE,App performance / Crash logs',
    ].join('\n'),
    pkg: {},
  });
  check('毒2: 診断SDK未検出のcrash logsは未対応扱い', plan2.unmapped.some((u) => u.includes('PSL_CRASH_LOGS')));
  check('毒2: 未対応があるのでanswered=0', plan2.answered.length === 0);

  // 毒3: マッピング表に無いPSL_タイプ → 断定せず unmapped(誤った緑を出さない)。
  const plan3 = buildAnswerPlan({
    csvText: [
      'Question ID (machine readable),Response ID (machine readable),Response value,Answer requirement,Human-friendly question label',
      'PSL_DATA_TYPES_HEALTH_AND_FITNESS,PSL_HEALTH,TRUE,MULTIPLE_CHOICE,Health and fitness / Health info',
    ].join('\n'),
    pkg: {},
  });
  check('毒3: 未知のPSL_HEALTHはunmapped', plan3.unmapped.includes('PSL_HEALTH'));

  // 毒4: 広告SDKが1つでもあれば「いいえ」を機械的に出さず「要確認」にする(誤申告防止)。
  const plan4 = buildAnswerPlan({
    csvText: [
      'Question ID (machine readable),Response ID (machine readable),Response value,Answer requirement,Human-friendly question label',
      'PSL_DATA_TYPES_PERSONAL,PSL_NAME,TRUE,MULTIPLE_CHOICE,Personal info / Name',
    ].join('\n'),
    pkg: { dependencies: { 'react-native-google-mobile-ads': '^1.0.0' } },
  });
  check('毒4: AdMob検出でトラッキング=要確認', plan4.answered[0]?.tracking.value === '要確認');
  check('毒4: trackingSdksにAdMobが載る', plan4.trackingSdks.includes('Google AdMob'));

  // 毒5: 空CSV(ヘッダのみ) → 例外にならず0件で完走(fail-closedだが誤爆しない)。
  const plan5 = buildAnswerPlan({
    csvText: 'Question ID (machine readable),Response ID (machine readable),Response value,Answer requirement,Human-friendly question label',
    pkg: null,
  });
  check('毒5: 空CSVで0件・例外なし', plan5.collectedTypes.length === 0 && plan5.answered.length === 0);

  if (failing.length) {
    console.error(`[asc-generate-privacy-answers --selftest] FAIL: ${failing.join(', ')}`);
    process.exit(1);
  }
  console.log('[asc-generate-privacy-answers --selftest] PASS (5 checks)');
  process.exit(0);
}

// ★ファイル名の endsWith 判定は、templates/README.md の手順でコピー先が別名に
//   なった場合に壊れる（実測: /tmp へコピーして検証した際に isMain が false のまま
//   沈黙した）。import.meta.url との一致で判定する（check-shared-parts-used.mjs と同じ方式）。
const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain && process.argv.includes('--selftest')) runSelftest();
else if (isMain) await main();

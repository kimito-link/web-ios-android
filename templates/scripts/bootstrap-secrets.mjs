#!/usr/bin/env node
/**
 * bootstrap-secrets.mjs — ストア申請に必要な GitHub Secrets を一括登録する（web-ios-android キット）
 *
 * 背景（市場の空白）:
 *   ストア申請パイプラインで「人間しかできない」とされる初期セットアップのうち、
 *   ①ASCアプリ枠作成 / ②Play新規アプリ作成 / ④SIWA設定 は Apple/Google 側に API が無く突破不可。
 *   だが ③「証明書・APIキー等 12個の Secret を手で1つずつ GitHub に登録」は自動化できる。
 *   このスクリプトが、ローカルに置いた鍵ファイル群を読んで base64 化し、`gh secret set` で
 *   一括登録する。人間の「12回の手登録」を「1コマンド」に縮める。
 *   （app-config.mjs が設計意図として "secret bootstrap" を挙げていた未実装枠を埋める。）
 *
 * 安全方針:
 *   - 鍵の中身は一切標準出力に出さない（base64もログに出さない）。出すのは「登録した/しなかった」だけ。
 *   - 既定は --dry-run 相当の確認表示。実際に登録するには --apply を明示する（事故防止）。
 *   - 鍵ファイルは「鍵ディレクトリ」に置く運用。リポジトリにコミットしない（.gitignore 前提）。
 *   - gh CLI 認証（gh auth status）と対象リポジトリは app.config.json の ownership から決める。
 *
 * 使い方:
 *   1. 鍵ディレクトリ（既定 ./.secrets-local/）に下記ファイル名で鍵を置く（あるものだけでOK）。
 *   2. `node scripts/bootstrap-secrets.mjs`            # 何が登録されるか確認（ドライ）
 *   3. `node scripts/bootstrap-secrets.mjs --apply`    # 実際に gh secret set
 *
 * オプション:
 *   --apply            実際に登録する（無いと確認のみ）
 *   --dir <path>       鍵ディレクトリ（既定 ./.secrets-local）
 *   --repo <o/r>       対象リポジトリ（既定 app.config.json の ownership.githubOrg/githubRepo）
 *   --only <NAME,...>  指定 Secret だけ登録
 *   -h, --help
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { loadAppConfig, getProjectRoot } from './lib/app-config.mjs';

const ROOT = getProjectRoot();

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean' },
    dir: { type: 'string' },
    repo: { type: 'string' },
    only: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (values.help) {
  console.log(
    [
      'bootstrap-secrets: ストア申請用 GitHub Secrets を鍵ファイルから一括登録する。',
      '',
      '  既定は確認のみ（ドライ）。実登録は --apply を付ける。',
      '  鍵ディレクトリ（既定 ./.secrets-local）に下記ファイルを置く（あるものだけでOK）:',
      '',
      ...SPECS_FOR_HELP(),
      '',
      'オプション: --apply / --dir <path> / --repo <owner/repo> / --only <NAME,...>',
    ].join('\n'),
  );
  process.exit(0);
}

/**
 * Secret 定義。
 *  - name: GitHub Secret 名（release-pipeline-playbook §5 に対応）
 *  - file: 鍵ディレクトリ内のファイル名（複数候補は配列、先頭から探す）
 *  - encode: 'base64'（バイナリ鍵）/ 'text'（そのままテキスト）/ 'value'（config 由来の固定値）
 *  - value: encode='value' のとき app.config から引く関数
 *  - required: 申請の最低限に必須か（warn 表示用）
 */
function buildSpecs(config) {
  const teamId = config?.stores?.appleTeamId || '';
  return [
    // iOS（9個 / playbook §5.1）
    { name: 'APPLE_TEAM_ID', encode: 'value', value: () => teamId, required: true },
    { name: 'APPSTORE_CONNECT_KEY_ID', file: ['ASC_KEY_ID.txt'], encode: 'text', required: true,
      note: 'ASC Team API Key の Key ID（10文字）。ファイルに文字列で。' },
    { name: 'APPSTORE_CONNECT_ISSUER_ID', file: ['ASC_ISSUER_ID.txt'], encode: 'text', required: true,
      note: 'ASC API の Issuer ID（UUID）。' },
    { name: 'APPSTORE_CONNECT_API_KEY_P8_BASE64', file: ['AuthKey.p8', 'asc_api_key.p8'], encode: 'base64', required: true,
      note: 'ASC Team API Key の .p8（一度しか落とせない）。' },
    { name: 'IOS_DIST_CERT_CER_BASE64', file: ['distribution.cer'], encode: 'base64', required: true,
      note: 'Apple Distribution 証明書（DER 形式 .cer）。' },
    { name: 'IOS_DIST_PRIVATE_KEY_PEM_BASE64', file: ['distribution_private.key', 'distribution_private.pem'], encode: 'base64', required: true,
      note: '上記証明書の秘密鍵（PEM）。CI で .p12 を再生成する split material 方式。' },
    { name: 'IOS_DIST_CERT_PASSWORD', file: ['IOS_DIST_CERT_PASSWORD.txt'], encode: 'text', required: true,
      note: 'CI が生成する .p12 の export password（任意の強いパスフレーズ）。' },
    { name: 'IOS_APPSTORE_PROFILE_BASE64', file: ['AppStore.mobileprovision'], encode: 'base64', required: true,
      note: 'App Store 用 Provisioning Profile（.mobileprovision）。' },
    // Android（3個 / playbook §5.2）
    { name: 'GOOGLE_PLAY_SA_JSON_BASE64', file: ['service-account.json', 'play-service-account.json'], encode: 'base64', required: true,
      note: 'Google Play Service Account の JSON。' },
    { name: 'ANDROID_KEYSTORE_BASE64', file: ['android-upload-key.jks', 'upload-key.jks'], encode: 'base64', required: true,
      note: 'Android upload key（.jks）。create-android-keystore.ps1 で生成可。' },
    { name: 'ANDROID_KEYSTORE_PROPERTIES', file: ['keystore.properties'], encode: 'text', required: true,
      note: 'keystore.properties の中身（base64 でなくテキスト・BOM混入注意）。' },
    // 審査用デモアカウント（X 専用ログイン等で審査に必要なとき）
    { name: 'IOS_REVIEW_DEMO_USERNAME', file: ['IOS_REVIEW_DEMO_USERNAME.txt'], encode: 'text', required: false,
      note: '審査用デモアカウントのユーザー名（必要なアプリのみ）。' },
    { name: 'IOS_REVIEW_DEMO_PASSWORD', file: ['IOS_REVIEW_DEMO_PASSWORD.txt'], encode: 'text', required: false,
      note: '審査用デモアカウントのパスワード（必要なアプリのみ）。' },
    // Cloudflare Pages（独自ドメイン接続を使うアプリのみ・CI用）
    { name: 'CLOUDFLARE_API_TOKEN', file: ['CLOUDFLARE_API_TOKEN.txt'], encode: 'text', required: false,
      note: 'CI（GitHub Actions）でのCloudflare Pagesデプロイ・ドメイン接続用。ローカル初回セットアップは' +
        ' wrangler login のOAuthを使うため不要（cloudflare-auth.mjs）。失効時は' +
        ' _docs/cloudflare-workers-token-expiry-knowledge-base.md 参照。' },
  ];
}

// --help 用の簡易一覧（config 不要で名前とファイルだけ）。
function SPECS_FOR_HELP() {
  return buildSpecs({}).map((s) => {
    const f = s.encode === 'value' ? '(app.config から自動)' : `[${(s.file || []).join(' | ') || '—'}]`;
    return `  ${s.name.padEnd(36)} ${f}`;
  });
}

function header(t) { const b = '='.repeat(64); console.log(`\n${b}\n  ${t}\n${b}`); }

/** gh CLI が使えるか・認証済みか確認。 */
function ensureGh() {
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'pipe' });
  } catch {
    console.error('  FAIL  gh CLI が未認証/未インストールです。`gh auth login` を先に実行してください。');
    process.exit(1);
  }
}

/** 鍵ディレクトリ内で最初に存在するファイルを返す（無ければ null）。 */
function resolveFile(dir, candidates) {
  for (const c of candidates || []) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function main() {
  const config = loadAppConfig();
  const owner = config?.ownership?.githubOrg;
  const repoName = config?.ownership?.githubRepo;
  const repo = values.repo || (owner && repoName ? `${owner}/${repoName}` : null);
  if (!repo) {
    console.error('  FAIL  対象リポジトリが不明です。--repo owner/repo を指定するか app.config.json の ownership を埋めてください。');
    process.exit(1);
  }

  const dir = path.resolve(ROOT, values.dir || '.secrets-local');
  const apply = !!values.apply;
  const onlyset = values.only ? new Set(values.only.split(',').map((s) => s.trim())) : null;
  const specs = buildSpecs(config).filter((s) => !onlyset || onlyset.has(s.name));

  header(`bootstrap-secrets ${apply ? '(APPLY=実登録)' : '(DRY=確認のみ)'} — repo ${repo}`);
  console.log(`  鍵ディレクトリ: ${dir}`);
  if (!fs.existsSync(dir)) {
    console.error(`  FAIL  鍵ディレクトリがありません: ${dir}\n        ここに鍵ファイルを置いてから再実行してください（--help で一覧）。`);
    process.exit(1);
  }
  if (apply) ensureGh();

  let willSet = 0; let missingRequired = 0; let skipped = 0;
  for (const spec of specs) {
    let payload = null;
    let source = '';
    if (spec.encode === 'value') {
      const v = spec.value();
      if (v) { payload = v; source = 'app.config'; }
    } else {
      const file = resolveFile(dir, spec.file);
      if (file) {
        const buf = fs.readFileSync(file);
        payload = spec.encode === 'base64' ? buf.toString('base64') : buf.toString('utf8').replace(/^﻿/, '');
        source = path.basename(file);
      }
    }

    if (payload == null) {
      if (spec.required) { console.log(`  --    ${spec.name.padEnd(36)} 未配置（必須）${spec.note ? ' … ' + spec.note : ''}`); missingRequired++; }
      else { console.log(`  skip  ${spec.name.padEnd(36)} 未配置（任意）`); skipped++; }
      continue;
    }

    if (!apply) {
      console.log(`  set?  ${spec.name.padEnd(36)} ← ${source}`); // 中身は出さない
      willSet++;
      continue;
    }

    try {
      // gh secret set NAME --repo owner/repo は「値」を引数に取らず標準入力から読む。
      // --body <値> のようにコマンドライン引数に秘密を渡すと、失敗時に execFileSync の
      // エラーメッセージへ実行コマンド全体（＝秘密の値）がそのまま載ってログに残る事故を招く
      // （実例: resend で githubRepo 誤りにより全件失敗し、証明書秘密鍵等が露出した）。
      execFileSync('gh', ['secret', 'set', spec.name, '--repo', repo], {
        input: payload,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      console.log(`  OK    ${spec.name.padEnd(36)} ← ${source}`);
      willSet++;
    } catch (e) {
      // stderr だけを見せる。stdout/エラーオブジェクトには起動コマンド全体が乗ることがあるため使わない。
      const stderrText = e && e.stderr ? String(e.stderr).trim().split('\n')[0] : '(詳細不明)';
      console.error(`  FAIL  ${spec.name.padEnd(36)} 登録失敗: ${stderrText}`);
    }
  }

  header('まとめ');
  console.log(`  ${apply ? '登録' : '登録予定'}: ${willSet} 個 / 未配置(必須): ${missingRequired} 個 / 任意スキップ: ${skipped} 個`);
  if (!apply) {
    console.log('  実際に登録するには再度 --apply を付けて実行してください:');
    console.log('    node scripts/bootstrap-secrets.mjs --apply');
  }
  if (apply && willSet > 0) {
    console.log(`\n  ${dir} 配下の鍵ファイルは GitHub Secrets に登録済みです。`);
    console.log('  ローカルの平文コピーは攻撃対象を増やすだけなので、安全な場所（暗号化ボリューム等）へ');
    console.log('  移動するか削除を検討してください（.jks/.p8/.mobileprovision 等は失うと再発行が必要）。');
  }
  if (missingRequired > 0) {
    console.log('\n  ※ 未配置(必須)がある間は CI のリリースが失敗します。鍵を用意して再実行してください。');
    console.log('    鍵の作り方: _docs/release-pipeline-playbook.md §6（Apple/Google のファースト・タイム・セットアップ）。');
  }
  // 自動化の限界も正直に示す（市場の空白の外側＝Apple/Google 制約で手動が残る部分）。
  console.log('\n  なおこのスクリプトで消えるのは「Secret の手登録」だけです。次は API で自動化できません（手動）:');
  console.log('   - App Store Connect でアプリ枠を新規作成（Apple に作成 API なし）');
  console.log('   - Google Play Console で新アプリ作成＋Service Account 権限付与');
  console.log('   - Sign in with Apple の Services ID / Key 作成（Apple GUI 必須）');
}

main();

#!/usr/bin/env node
/**
 * deploy-cloudflare-pages.mjs — Cloudflare Pagesへデプロイする（web-ios-android キット）
 *
 * 背景（LP先行→ドメイン接続 MVP の一部）:
 *   `npx wrangler pages deploy` の薄いラップ。認証は先に cloudflare-auth.mjs で確立済みの
 *   Wranglerセッション（ローカル）または CLOUDFLARE_API_TOKEN 環境変数（CI）に委ねる。
 *   このスクリプト自身は認証を行わない（責務を分離する）。
 *
 *   設計: _docs/DESIGN-lp-first-domain-connect-2026-07-13.md
 *
 * 使い方:
 *   node templates/scripts/deploy-cloudflare-pages.mjs --dir <出力ディレクトリ>
 *   node templates/scripts/deploy-cloudflare-pages.mjs --dry-run   # 何もしない・設定確認のみ
 *
 * オプション:
 *   --dir <path>          デプロイするビルド出力ディレクトリ（既定: './dist'）
 *   --project <name>      Cloudflare Pagesのプロジェクト名（既定: app.config.json の web.deploy.projectName）
 *   --dry-run             実際にはデプロイしない（コマンドの組み立てだけ確認）
 *   --verify-path <path>  デプロイ後の反映確認に使う相対パス（既定: 'index.html'）
 *   --no-verify           デプロイ後の反映確認をスキップする（既定は確認する）
 *
 * ★デプロイ後の反映確認（2026-09-10追加）:
 *   line-botセッションからの報告（2026-09-09実損）を受けて追加した。
 *   `wrangler pages deploy` は成功終了するが、実際にはpreview環境にしか
 *   アップロードされておらず、本番（カスタムドメイン）は古いバージョンを
 *   配信し続けるケースが2種類確認されている:
 *     ①ブランチ不一致（--branch未指定でwranglerがgitからmasterを推測した等）
 *     ②CDNエッジキャッシュ（本キット自身で2026-09-10実測。--branch一致でも
 *       カスタムドメインだけ古いレスポンスをキャッシュし続けた）
 *   どちらも「デプロイ成功ログ」だけでは判別できない（★基準③「完膚なきまでの
 *   裏取り」の実践）。wranglerの直接デプロイURL（*.pages.dev、preview扱いにならず
 *   常に最新）と、カスタムドメイン（あれば）から同じファイルを取得し、
 *   中身が一致するかをSHA-256で比較する。不一致ならexit 1（fail-closed）。
 *   直接デプロイURLが取得できない・カスタムドメイン未設定の場合は検証をスキップし、
 *   その旨を明示する（測れなかったことを緑にしない）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { cfg, getProjectRoot } from './lib/app-config.mjs';

const ROOT = getProjectRoot();

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    project: { type: 'string' },
    branch: { type: 'string' },
    'dry-run': { type: 'boolean' },
    'verify-path': { type: 'string' },
    'no-verify': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (values.help) {
  console.log(
    [
      'deploy-cloudflare-pages: `npx wrangler pages deploy` のラップ。',
      '',
      '  認証はしない（先に cloudflare-auth.mjs を実行しておくこと）。',
      '',
      'オプション: --dir <path> / --project <name> / --branch <name> / --dry-run /',
      '           --verify-path <path> / --no-verify',
      '',
      '  --branch は既定 main。Pages の本番ブランチと一致させること。',
      '  一致しないと preview 扱いになり、成功ログが出るのに本番が更新されない。',
      '',
      '  デプロイ後、直接デプロイURL(*.pages.dev)とカスタムドメインから',
      '  --verify-path（既定 index.html）を取得し、中身が一致するか確認する。',
      '  一致しない場合はexit 1（成功ログが出ていても本番未反映を検出する）。',
      '  --no-verify でスキップできる。',
    ].join('\n'),
  );
  process.exit(0);
}

function header(t) { const b = '='.repeat(64); console.log(`\n${b}\n  ${t}\n${b}`); }

async function main() {
  const projectName = values.project || cfg('web.deploy.projectName');
  const dir = path.resolve(ROOT, values.dir || './dist');
  const dryRun = !!values['dry-run'];

  header(`deploy-cloudflare-pages ${dryRun ? '(DRY-RUN)' : ''}`);

  if (!projectName) {
    console.error('  FAIL  Cloudflare Pagesのプロジェクト名が不明です。');
    console.error('        app.config.json の web.deploy.projectName を設定するか --project を指定してください。');
    process.exit(1);
  }

  console.log(`  プロジェクト: ${projectName}`);
  console.log(`  出力ディレクトリ: ${dir}`);

  if (!dryRun && !fs.existsSync(dir)) {
    console.error(`  FAIL  出力ディレクトリが存在しません: ${dir}`);
    console.error('        先にビルドを実行してください。');
    process.exit(1);
  }

  // ★--branch は必ず明示する（2026-09-09 追加）。
  //
  //   付けないと wrangler がローカルの git からブランチ名を推測する。
  //   CI では 'master' が送られることがあり、Cloudflare Pages の本番ブランチ
  //   （通常 main）と一致しないと **プレビュー扱い** になる。
  //
  //   このとき wrangler は成功終了するため、
  //   「デプロイは success なのに本番URLが更新されない」という、
  //   原因の分かりにくい形で現れる。
  //   実例: line-bot の管理画面が数時間これに費やした（本番は古いチャンクを
  //   配信し続け、新しいビルドは 404 だった）。
  //
  //   既定は 'main'。本番ブランチが違うプロジェクトは --branch で上書きする。
  const branch = values.branch || 'main';
  const args = [
    'wrangler', 'pages', 'deploy', dir,
    '--project-name', projectName,
    '--branch', branch,
  ];
  console.log(`  ブランチ: ${branch}`);
  console.log(`  実行コマンド: npx ${args.join(' ')}`);

  if (dryRun) {
    console.log('  DRY   実際のデプロイは行いません。');
    return;
  }

  const { ok, deployUrl } = await runWrangler(args);
  if (!ok) {
    console.error('  FAIL  デプロイに失敗しました。');
    console.error('        認証切れの場合は cloudflare-auth.mjs を再実行してください。');
    process.exit(1);
  }
  console.log('  OK    デプロイが完了しました。');

  if (values['no-verify']) {
    console.log('  SKIP  --no-verify のため反映確認は行いません。');
    return;
  }

  const customDomain = cfg('web.deploy.customDomain');
  const verifyPath = values['verify-path'] || 'index.html';
  console.log(`\n  反映確認: ${verifyPath} を直接デプロイURLとカスタムドメインから取得して比較します…`);
  const verify = await verifyDeployment({ deployUrl, customDomain, verifyPath });
  if (verify.verdict === 'pass') {
    console.log(`  OK    ${verify.detail}`);
  } else if (verify.verdict === 'inconclusive') {
    console.log(`  ?     測れませんでした: ${verify.detail}`);
  } else {
    console.error(`  FAIL  ${verify.detail}`);
    process.exit(1);
  }
}

/**
 * @returns {Promise<{ok: boolean, deployUrl: string|null}>}
 *   deployUrl は wrangler の出力から抽出した直接デプロイURL（*.pages.dev）。
 *   見つからなければnull（古いwranglerバージョン等で出力形式が変わった場合、
 *   反映確認を測れなかった扱いにするための目印）。
 */
function runWrangler(args) {
  return new Promise((resolve) => {
    // ★2026-08-26修正: Windowsでは npx は npx.cmd(バッチファイル)であり、
    //   shell:true 無しの spawn('npx', ...) は ENOENT で即失敗する(実機で発見。
    //   デプロイ失敗の実エラーではなく、コマンドが起動すらしていなかった)。
    //   argsは固定パターン(wrangler pages deploy <dir> --project-name <name>)のみで
    //   ユーザー入力を直接シェル解釈させる経路にはならないため、shell:trueで許容する。
    //
    // ★出力はリアルタイム表示しつつキャプチャする（2026-09-10追加）。
    //   stdio:'inherit'のままだと反映確認用の直接デプロイURLを取得できないため、
    //   pipeへ変更し、受け取った断片をprocess.stdout/stderrへ即座に書き戻す
    //   （ユーザーから見える出力の体験は変えない）。
    const child = spawn('npx', args, { shell: process.platform === 'win32' });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { out += chunk; process.stderr.write(chunk); });
    child.on('close', (code) => {
      const m = out.match(/https:\/\/[a-z0-9]+\.[a-z0-9-]+\.pages\.dev/i);
      resolve({ ok: code === 0, deployUrl: m ? m[0] : null });
    });
    child.on('error', () => resolve({ ok: false, deployUrl: null }));
  });
}

/**
 * デプロイ後の反映確認。直接デプロイURL（常に最新・preview扱いにならない）と
 * カスタムドメインから同じ相対パスを取得し、SHA-256で中身が一致するか比較する。
 *
 * ★リトライする理由（2026-09-10実測）: CDNエッジキャッシュの伝播には一過性の
 *   遅延があり、デプロイ直後の1回だけの比較では「まだ伝播していないだけ」を
 *   「本当に未反映」と誤検知しうる。本キット自身の実測では15秒待っても
 *   直らなかった例（＝キャッシュバスターが無いのが根本原因で、待っても
 *   直らないケース）と、10秒程度で伝播したケースの両方があるため、
 *   一定回数リトライしてから確定するfail-closed設計にする。
 *
 * @returns {Promise<{verdict: 'pass'|'fail'|'inconclusive', detail: string}>}
 */
async function verifyDeployment({ deployUrl, customDomain, verifyPath, retries = 3, retryDelayMs = 5000 }) {
  if (!deployUrl) {
    return { verdict: 'inconclusive', detail: '直接デプロイURLをwranglerの出力から取得できませんでした（出力形式が変わった可能性）' };
  }
  if (!customDomain) {
    return { verdict: 'inconclusive', detail: 'app.config.json の web.deploy.customDomain が未設定のため、カスタムドメインとの比較をスキップしました' };
  }

  const hash = (buf) => createHash('sha256').update(buf).digest('hex');
  const fetchBody = async (url) => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, buf: Buffer.from(await res.arrayBuffer()) };
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const deployRes = await fetchBody(`${deployUrl.replace(/\/$/, '')}/${verifyPath}`);
  if (!deployRes.ok) {
    return { verdict: 'inconclusive', detail: `直接デプロイURLから ${verifyPath} を取得できませんでした（HTTP ${deployRes.status}）` };
  }
  const deployHash = hash(deployRes.buf);

  let lastCustomHash = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const customRes = await fetchBody(`https://${customDomain}/${verifyPath}`);
    if (!customRes.ok) {
      return { verdict: 'inconclusive', detail: `カスタムドメインから ${verifyPath} を取得できませんでした（HTTP ${customRes.status}）` };
    }
    lastCustomHash = hash(customRes.buf);
    if (lastCustomHash === deployHash) {
      return { verdict: 'pass', detail: `${verifyPath} の中身が一致しました（${deployHash.slice(0, 12)}…、${attempt}回目で確認）` };
    }
    if (attempt < retries) {
      console.log(`  ...   不一致（${attempt}/${retries}回目）。CDN伝播待ちの可能性があるため ${retryDelayMs / 1000}秒待って再確認します。`);
      await sleep(retryDelayMs);
    }
  }

  return {
    verdict: 'fail',
    detail: `${verifyPath} の中身が一致しません（直接デプロイURL: ${deployHash.slice(0, 12)}… / カスタムドメイン: ${lastCustomHash?.slice(0, 12)}…、${retries}回リトライ後も不一致）。デプロイは成功したが本番(${customDomain})に未反映です。CDNキャッシュ（クエリ無しURLに長時間TTLが付いていないか）かブランチ不一致を疑ってください。`,
  };
}

main();

#!/usr/bin/env node
/**
 * distribute-clerk-keys.mjs — Clerk共通鍵の複数サービス配布
 *
 * kimito.link共通アカウント(Clerk方式A・インスタンス共有)の鍵を、姉妹サービス
 * (Vercel/Render/静的)へ配るたびに人間が手作業でコピペしている問題を解消する。
 * 「1コマンドで全サービスに配る」CLI。
 *
 * 設計書: ../../clerk-key-distribution-SPEC.md（実装引き継ぎH節に着手手順あり）
 * 地図  : ../../clerk-key-distribution-MAP.md（既存資産調査・CANONICAL CHECK判定）
 *
 * CANONICAL CHECK判定: KEEP_SEPARATE(新規実装)。
 *   bootstrap-secrets.mjs(GitHub Secrets専用)・setup-clerk-x-oauth.mjs(Vercelのみ)
 *   とは責務が異なるため兄弟実装とした。ブランドプリセット解決ロジックは
 *   lib/brand-preset.mjs へ切り出して両方から共有する(ESTABLISH_REHOME)。
 *
 * 使い方:
 *   node templates/scripts/distribute-clerk-keys.mjs                  # ドライラン(既定)
 *   node templates/scripts/distribute-clerk-keys.mjs --apply          # 実際に配布
 *   node templates/scripts/distribute-clerk-keys.mjs --only Voice     # 特定サービスだけ
 *   node templates/scripts/distribute-clerk-keys.mjs --selftest       # 毒テスト
 *   node templates/scripts/distribute-clerk-keys.mjs --json           # JSON出力
 *
 * 秘密の実値の渡し方(CLAUDE.md「クリップボード経由」節・bootstrap-secrets.mjsと同型):
 *   鍵ディレクトリ(既定 ./.secrets-local/)に sourceKeyRef と同名のファイルを置くか、
 *   同名の環境変数として渡す。--source <path> で鍵ディレクトリを明示できる。
 *   例: sourceKeyRef "sharedSecretKeyEnv" が解決する env名(KIMITO_CLERK_SECRET_KEY等)の
 *       実値を .secrets-local/KIMITO_CLERK_SECRET_KEY.txt に置く、または
 *       環境変数 KIMITO_CLERK_SECRET_KEY として渡す。
 *   配布先のAPIトークン(RENDER_API_TOKEN / VERCEL_API_TOKEN)も同様にプロセス環境変数で渡す。
 *   鍵の値は標準出力に一切出さない(bootstrap-secrets.mjsの設計を踏襲)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadAppConfig, getProjectRoot } from './lib/app-config.mjs';
import { resolveBrandContext } from './lib/brand-preset.mjs';
import { selectAdapter } from './lib/hosting-env-adapters.mjs';
import {
  selectDistributionTargets,
  buildDistributionPlan,
  judgeRegistration,
  judgeEffectiveness,
} from './lib/clerk-key-distribution-core.mjs';
import { computeExitCode, formatProbeReport, runSelfTest, withRetryOnTimeout, EXIT } from './lib/instrument-core.mjs';

const ROOT = getProjectRoot();

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean' },
    redeploy: { type: 'boolean' },
    wait: { type: 'string', default: '300' },
    only: { type: 'string' },
    source: { type: 'string' },
    json: { type: 'boolean' },
    selftest: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (values.help) {
  console.log(
    [
      'distribute-clerk-keys: Clerk共通鍵を複数サービス(Vercel/Render/静的)へ配布する。',
      '',
      '  既定はドライラン。実配布は --apply を付ける。',
      '  鍵の実値は .secrets-local/<sourceKeyRef相当のenv名>.txt またはプロセス環境変数で渡す。',
      '',
      'オプション:',
      '  --apply           実際に書き込む(無いとドライラン)',
      '  --redeploy        配布後に対象サービスを再デプロイする(既定off)',
      '  --wait <seconds>  --redeploy時のデプロイ完了待ちの上限秒(既定300)',
      '  --only <name>     siblingServices[].nameで絞り込む',
      '  --source <path>   鍵ディレクトリ(既定 ./.secrets-local)',
      '  --json            結果をJSON出力',
      '  --selftest        毒テストを実行する',
    ].join('\n'),
  );
  process.exit(0);
}

/** 鍵ディレクトリ・環境変数からキーの実値を読む(bootstrap-secrets.mjsと同じ優先順)。 */
function makeKeyResolver(secretsDir) {
  return function resolveKeyValue(envName) {
    if (!envName) return null;
    if (process.env[envName]) return process.env[envName];
    const filePath = path.join(secretsDir, `${envName}.txt`);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8').trim().replace(/^﻿/, '');
    }
    return null;
  };
}

/** sourceKeyRef(brand-preset.mjsのフィールド名)を実際のenv名へ変換する。 */
function refToEnvName(brandCtx, sourceKeyRef) {
  if (sourceKeyRef === 'sharedPubKeyEnv') return brandCtx.sharedPubKeyEnv;
  if (sourceKeyRef === 'sharedSecretKeyEnv') return brandCtx.sharedSecretKeyEnv;
  // ブランドプリセットの固定フィールド以外は、そのままenv名として扱う
  // (将来sourceKeyRefが直接env名を指すケースにも対応できるようにするため)。
  return sourceKeyRef;
}

/**
 * 1サービス分の配布を実行する(--applyが無ければprobeのみ)。
 * @returns {Promise<object[]>} instrument-core形式の結果配列
 */
async function distributeToService(service, adapter, brandCtx, resolveKeyValue, apply) {
  const results = [];
  const plan = buildDistributionPlan(service, (ref) => resolveKeyValue(refToEnvName(brandCtx, ref)));

  for (const item of plan.plan) {
    const envName = item.envName;

    if (apply) {
      if (!item.hasValue) {
        results.push(
          judgeRegistration({ envName, probeOk: false, exists: false, probeError: `実値が見つかりません(env ${refToEnvName(brandCtx, item.sourceKeyRef)} または .secrets-local/を確認)` }),
        );
        continue;
      }
      const value = resolveKeyValue(refToEnvName(brandCtx, item.sourceKeyRef));
      const writeResult = await withRetryOnTimeout(() => adapter.write(envName, value), 15000);
      if (writeResult?.timedOut) {
        results.push(judgeRegistration({ envName, probeOk: false, exists: false, probeError: '書き込みがタイムアウトしました' }));
        continue;
      }
      if (!writeResult.ok) {
        results.push(judgeRegistration({ envName, probeOk: true, exists: false, probeError: writeResult.error }));
        continue;
      }
    }

    // 第1層: 登録確認(--applyの有無に関わらず、現状を必ず読み直す)
    const probeResult = await withRetryOnTimeout(() => adapter.probe(envName), 15000);
    if (probeResult?.timedOut) {
      results.push(judgeRegistration({ envName, probeOk: false, exists: false, probeError: '登録確認がタイムアウトしました' }));
      continue;
    }
    results.push(judgeRegistration({ envName, probeOk: probeResult.ok, exists: !!probeResult.exists, probeError: probeResult.error }));

    // 第2層: 効果確認(verify契約があるときのみ、公開エンドポイントを実際に叩く)
    const hasVerifyContract = !!item.verify?.endpoint;
    if (!hasVerifyContract) {
      results.push(judgeEffectiveness({ envName, hasVerifyContract: false }));
      continue;
    }
    try {
      const fetchOnce = () => fetch(item.verify.endpoint, { signal: AbortSignal.timeout(8000) }).then((r) => r.json());
      const body = await withRetryOnTimeout(fetchOnce, 8000);
      if (body?.timedOut) {
        results.push(judgeEffectiveness({ envName, hasVerifyContract: true, fetched: false, timedOut: true }));
        continue;
      }
      const value = item.verify.jsonPath
        ? item.verify.jsonPath.replace(/^\$\./, '').split('.').reduce((o, k) => o?.[k], body)
        : body;
      const matched = typeof value === 'string' && item.verify.expectedPrefix
        ? value.startsWith(item.verify.expectedPrefix)
        : !!value;
      results.push(judgeEffectiveness({ envName, hasVerifyContract: true, fetched: true, matched }));
    } catch (e) {
      results.push(judgeEffectiveness({ envName, hasVerifyContract: true, fetched: false, error: e?.message }));
    }
  }

  return results;
}

async function main() {
  if (values.selftest) {
    process.exit(await runSelftest());
  }

  const config = loadAppConfig();
  const brandCtx = resolveBrandContext(config);
  const secretsDir = path.resolve(ROOT, values.source || '.secrets-local');
  const resolveKeyValue = makeKeyResolver(secretsDir);
  const onlyName = values.only || null;

  const targets = selectDistributionTargets(config.siblingServices, onlyName);

  if (targets.length === 0) {
    // G節<要確認>3: 空配列の扱い。設定漏れの可能性が高いのでinconclusive(緑ではない)とする。
    // ★siblingServices自体が0件のプロジェクト(hosting/sharedKeys未設定)まで赤くすると
    //   このキットの大多数のプロジェクトで無意味な失敗を量産するため、FAILにはしない。
    const r = [{
      probe: '配布対象の選定',
      verdict: 'inconclusive',
      evidence: null,
      detail: onlyName
        ? `--only ${onlyName} に一致し、かつ hosting/sharedKeys が設定された siblingServices がありません`
        : 'hosting/sharedKeys が設定された siblingServices がありません',
      howToFix: 'app.config.json の siblingServices[].hosting / sharedKeys を設定してください(clerk-key-distribution-SPEC.md B節)',
      limitation: 'このチェックは設定の有無だけを見る。値の正しさは見ない',
    }];
    console.log(values.json ? JSON.stringify(r, null, 2) : formatProbeReport(r));
    process.exit(computeExitCode(r));
  }

  const allResults = [];
  for (const service of targets) {
    let adapter;
    try {
      adapter = selectAdapter(service.hosting, {
        renderToken: process.env.RENDER_API_TOKEN,
        vercelToken: process.env.VERCEL_API_TOKEN,
        vercelTeamId: process.env.VERCEL_TEAM_ID,
      });
    } catch (e) {
      allResults.push({
        probe: `${service.name}: アダプタの初期化`,
        verdict: 'fail',
        evidence: { service: service.name },
        detail: e?.message,
        howToFix: 'app.config.jsonのhosting設定、または対象トークン(RENDER_API_TOKEN/VERCEL_API_TOKEN)の環境変数を確認してください',
        limitation: 'このチェックは設定の有無だけを見る',
      });
      continue;
    }

    if (!values.apply) {
      const plan = buildDistributionPlan(service, (ref) => resolveKeyValue(refToEnvName(brandCtx, ref)));
      console.log(`\n[DRY] ${service.name} (${service.hosting.provider}):`);
      for (const item of plan.plan) {
        console.log(`  - ${item.envName} ← ${item.sourceKeyRef} : ${item.hasValue ? '値あり' : '値なし(未配置)'}`);
      }
      continue;
    }

    const serviceResults = await distributeToService(service, adapter, brandCtx, resolveKeyValue, values.apply);
    allResults.push(...serviceResults);
  }

  if (!values.apply) {
    console.log('\n実際に配布するには --apply を付けて再実行してください。');
    process.exit(EXIT.INCONCLUSIVE); // ドライランは「測っていない」ので緑を名乗らない
  }

  console.log(values.json ? JSON.stringify(allResults, null, 2) : formatProbeReport(allResults));
  process.exit(computeExitCode(allResults));
}

/** --selftest: 毒テスト(clerk-key-distribution-SPEC.md D節 8ケースの一部を実装)。 */
async function runSelftest() {
  const cases = [
    {
      name: '存在しないrenderServiceIdはFAILになる',
      poison: () => {},
      restore: () => {},
      isRed: () => {
        try {
          selectAdapter({ provider: 'render' }, { renderToken: 'dummy' });
          return false; // エラーが飛ばなかった=検知が効いていない
        } catch {
          return true;
        }
      },
    },
    {
      name: '存在しないvercelProjectIdはFAILになる',
      poison: () => {},
      restore: () => {},
      isRed: () => {
        try {
          selectAdapter({ provider: 'vercel' }, { vercelToken: 'dummy' });
          return false;
        } catch {
          return true;
        }
      },
    },
    {
      name: '未知のproviderはFAILになる',
      poison: () => {},
      restore: () => {},
      isRed: () => {
        try {
          selectAdapter({ provider: 'unknown-provider' }, {});
          return false;
        } catch {
          return true;
        }
      },
    },
    {
      name: 'Renderトークン未設定はFAILになる',
      poison: () => {},
      restore: () => {},
      isRed: () => {
        try {
          selectAdapter({ provider: 'render', renderServiceId: 'srv-xxx' }, {});
          return false;
        } catch {
          return true;
        }
      },
    },
    {
      name: 'judgeRegistration: probeOk=falseはinconclusive(failでもpassでもない)',
      poison: () => {},
      restore: () => {},
      isRed: () => {
        const r = judgeRegistration({ envName: 'X', probeOk: false, exists: false, probeError: 'timeout' });
        return r.verdict === 'inconclusive';
      },
    },
    {
      name: 'judgeRegistration: exists=falseはFAIL',
      poison: () => {},
      restore: () => {},
      isRed: () => {
        const r = judgeRegistration({ envName: 'X', probeOk: true, exists: false });
        return r.verdict === 'fail';
      },
    },
    {
      name: 'judgeEffectiveness: verify契約なしはPASS(対象外として扱う)',
      poison: () => {},
      restore: () => {},
      isRed: () => {
        const r = judgeEffectiveness({ envName: 'X', hasVerifyContract: false });
        return r.verdict === 'pass';
      },
    },
    {
      name: 'judgeEffectiveness: matched=falseはinconclusive(反映待ち)',
      poison: () => {},
      restore: () => {},
      isRed: () => {
        const r = judgeEffectiveness({ envName: 'X', hasVerifyContract: true, fetched: true, matched: false });
        return r.verdict === 'inconclusive';
      },
    },
    {
      name: 'selectDistributionTargets: hosting未設定のサービスは対象外',
      poison: () => {},
      restore: () => {},
      isRed: () => {
        const targets = selectDistributionTargets([{ name: 'NoHosting', sharedKeys: [{ envName: 'X', sourceKeyRef: 'Y' }] }]);
        return targets.length === 0;
      },
    },
    {
      name: 'selectDistributionTargets: sharedKeys未設定のサービスは対象外',
      poison: () => {},
      restore: () => {},
      isRed: () => {
        const targets = selectDistributionTargets([{ name: 'NoKeys', hosting: { provider: 'render', renderServiceId: 's' } }]);
        return targets.length === 0;
      },
    },
  ];

  const { ok, fails } = runSelfTest(cases);
  if (ok) {
    console.log(`✅ selftest 全${cases.length}件パス`);
    return EXIT.PASS;
  }
  console.log(`🔴 selftest 失敗:\n${fails.map((f) => `  - ${f}`).join('\n')}`);
  return EXIT.FAIL;
}

main().catch((e) => {
  console.error(`FAIL 予期しないエラー: ${e?.stack || e}`);
  process.exit(EXIT.FAIL);
});

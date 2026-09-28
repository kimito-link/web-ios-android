// clerk-key-distribution-core.mjs — Clerk共通鍵配布の純関数群（副作用なし）。
//
// distribute-clerk-keys.mjs から呼ばれる。ネットワークI/O・ファイルI/Oを含まず、
// 「配布計画をどう組み立てるか」「結果をどう3値判定するか」だけを担当する
// (clerk-key-distribution-SPEC.md A節「テスト容易性のため分離」)。
//
// 3値exit規約は templates/scripts/lib/instrument-core.mjs に委譲する
// (車輪の再発明をしない・CLAUDE.md基準②)。

import { normalizeProbeResult } from './instrument-core.mjs';

/**
 * @typedef {object} SiblingService
 * @property {string} name
 * @property {{provider: string, vercelProjectId?: string, renderServiceId?: string, environment?: string}} [hosting]
 * @property {{envName: string, sourceKeyRef: string, verify?: {endpoint?: string, jsonPath?: string, expectedPrefix?: string}}[]} [sharedKeys]
 */

/**
 * app.config.json の siblingServices から、実際に配布対象となる
 * (hosting も sharedKeys も両方設定されている)サービスだけを抽出する。
 * --only フィルタも適用する。
 *
 * @param {SiblingService[]} siblingServices
 * @param {string|null} onlyName --only オプションの値(nullなら絞り込みなし)
 * @returns {SiblingService[]}
 */
export function selectDistributionTargets(siblingServices, onlyName = null) {
  const list = Array.isArray(siblingServices) ? siblingServices : [];
  return list.filter((s) => {
    if (onlyName && s.name !== onlyName) return false;
    if (!s.hosting || !s.hosting.provider) return false;
    if (!Array.isArray(s.sharedKeys) || s.sharedKeys.length === 0) return false;
    return true;
  });
}

/**
 * 配布計画を1件分組み立てる(実行はしない、計画の記述のみ)。
 * @param {SiblingService} service
 * @param {(sourceKeyRef: string) => string|null} resolveKeyValue sourceKeyRefから実値を引く関数
 * @returns {{ service: string, provider: string, plan: { envName: string, sourceKeyRef: string, hasValue: boolean, verify?: object }[] }}
 */
export function buildDistributionPlan(service, resolveKeyValue) {
  const plan = (service.sharedKeys || []).map((sk) => ({
    envName: sk.envName,
    sourceKeyRef: sk.sourceKeyRef,
    hasValue: !!resolveKeyValue(sk.sourceKeyRef),
    verify: sk.verify,
  }));
  return { service: service.name, provider: service.hosting.provider, plan };
}

/**
 * 第1層(登録確認)の結果を3値判定に変換する。
 * @param {{ envName: string, probeOk: boolean, exists: boolean, probeError?: string }} params
 */
export function judgeRegistration({ envName, probeOk, exists, probeError }) {
  if (!probeOk) {
    return normalizeProbeResult({
      probe: `${envName} の登録確認`,
      verdict: 'inconclusive',
      evidence: null,
      detail: probeError || '登録状況を取得できませんでした',
      howToFix: 'ネットワーク・トークンの権限を確認し、再実行してください',
      limitation: 'このチェックは「キーが存在するか」だけを見る。値が正しいかはverify()側の第2層で見る',
    });
  }
  if (!exists) {
    return normalizeProbeResult({
      probe: `${envName} の登録確認`,
      verdict: 'fail',
      evidence: { envName, exists: false },
      detail: '配布先に環境変数が見つかりません',
      howToFix: '--apply を付けて再実行し、書き込みが成功するか確認してください',
      limitation: 'このチェックは「キーが存在するか」だけを見る。値が正しいかはverify()側の第2層で見る',
    });
  }
  return normalizeProbeResult({
    probe: `${envName} の登録確認`,
    verdict: 'pass',
    evidence: { envName, exists: true, verifiedAt: new Date().toISOString() },
    limitation: 'このチェックは「キーが存在するか」だけを見る。値が正しいかはverify()側の第2層で見る',
  });
}

/**
 * 第2層(効果確認・公開エンドポイント経由)の結果を3値判定に変換する。
 * verify契約(endpoint)が無いサービスは「検証不能」ではなく「対象外」として
 * inconclusiveにもfailにもしない(仕様なので当然の状態)。
 *
 * @param {{ envName: string, hasVerifyContract: boolean, fetched: boolean, matched?: boolean, timedOut?: boolean, error?: string }} params
 */
export function judgeEffectiveness({ envName, hasVerifyContract, fetched, matched, timedOut, error }) {
  if (!hasVerifyContract) {
    return normalizeProbeResult({
      probe: `${envName} の反映確認`,
      verdict: 'pass',
      evidence: { envName, skipped: true, reason: 'sharedKeys[].verify契約が未設定' },
      limitation: '公開エンドポイント契約(verify)が無いため、登録確認(第1層)のみで判定した。反映まで確認したい場合はapp.config.jsonにverifyを追加する',
    });
  }
  if (timedOut) {
    return normalizeProbeResult({
      probe: `${envName} の反映確認`,
      verdict: 'inconclusive',
      evidence: null,
      detail: '公開エンドポイントへの問い合わせがタイムアウトしました(2回試行)',
      howToFix: '対象サービスが起動しているか確認し、再実行してください。デプロイ直後は伝播待ちの可能性があります',
      limitation: 'このチェックはendpointの応答内容だけを見る。サービス自体の健全性は見ない',
    });
  }
  if (!fetched) {
    return normalizeProbeResult({
      probe: `${envName} の反映確認`,
      verdict: 'inconclusive',
      evidence: null,
      detail: error || '公開エンドポイントから応答を取得できませんでした',
      howToFix: '再デプロイが必要な可能性があります(--redeployオプション)。手動でendpointを確認してください',
      limitation: 'このチェックはendpointの応答内容だけを見る。サービス自体の健全性は見ない',
    });
  }
  if (!matched) {
    return normalizeProbeResult({
      probe: `${envName} の反映確認`,
      verdict: 'inconclusive',
      evidence: { envName, matched: false },
      detail: '登録は成功しましたが、公開エンドポイントの値がまだ期待値と一致しません(反映待ちの可能性)',
      howToFix: '再デプロイ(--redeploy)を行うか、時間を置いて再実行してください',
      limitation: '環境変数の変更が実行中プロセスに反映されているかは、再デプロイが必要な場合がある(サービスの実装依存)',
    });
  }
  return normalizeProbeResult({
    probe: `${envName} の反映確認`,
    verdict: 'pass',
    evidence: { envName, matched: true, verifiedAt: new Date().toISOString() },
    limitation: '公開エンドポイントの返り値のプレフィックス一致のみを見る。値全体の正しさまでは保証しない',
  });
}

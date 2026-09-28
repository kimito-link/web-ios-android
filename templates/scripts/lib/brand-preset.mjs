// brand-preset.mjs — ブランドプリセット解決の共通ロジック（キット同梱・依存ゼロ・純Node）。
//
// 移植元: setup-clerk-x-oauth.mjs（77-126行目、2026-09-28切り出し時点）。
// Clerk + X OAuth 用に書かれたロジックだったが、Clerk共通鍵の複数サービス配布
// （distribute-clerk-keys.mjs）でも同じ「app.config.json の auth.brandPreset から
// templates/auth/brands/<brand>.json を探して読み、方式A/Bを判定し、共有鍵の
// env名を解決する」処理が要る。CLAUDE.md基準②「車輪の再発明をしない」・
// 非交渉ルール6番「共通化すべきロジックをプロジェクト固有コードへコピーしない」
// に従い、ここへ切り出して両方から呼ぶ（ESTABLISH_REHOME判定、
// clerk-key-distribution-SPEC.md A節参照）。
//
// ★setup-clerk-x-oauth.mjs 側もこのモジュールを import するよう改修済み。
//   ロジックが2箇所に分岐した状態を残さない（CLAUDE.md「基準⑥ 2箇所目を
//   書く前に立ち止まる」）。

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * app.config.json の auth.brandPreset からブランドプリセットJSONを探して読む。
 * 呼び出し元（templates/scripts/ に置かれる場合、プロジェクトへ丸ごとコピー
 * される場合の両方）に対応するため、複数の候補パスを探索する
 * （setup-clerk-x-oauth.mjs の既存挙動をそのまま踏襲）。
 *
 * @param {string} presetName auth.brandPreset の値（空文字なら null を返す）
 * @returns {object|null} プリセットJSON、見つからなければ null
 */
export function loadBrandPreset(presetName) {
  if (!presetName) return null;
  const presetCandidates = [
    resolve(__dirname, '..', 'auth', 'brands', `${presetName}.json`),
    resolve(process.cwd(), 'templates', 'auth', 'brands', `${presetName}.json`),
    resolve(process.cwd(), 'auth', 'brands', `${presetName}.json`),
  ];
  const presetPath = presetCandidates.find((p) => existsSync(p));
  if (!presetPath) return null;
  return JSON.parse(readFileSync(presetPath, 'utf8'));
}

/**
 * app.config.json の auth ブロック + 解決済みプリセットから、方式A/B判定と
 * 共有鍵のenv名までをまとめて解決する。
 *
 * ★方式A（shareInstanceAcrossApps）: 全アプリが同じClerkインスタンスを共有する。
 *   各アプリは自前のpk_live/sk_liveを作らず、ブランドの共有鍵を使う。
 * ★方式B: 各アプリが独立したClerkインスタンスを持つ。
 *
 * @param {{auth?: object}} config app.config.json をパースしたオブジェクト
 * @returns {{
 *   mode: 'A'|'B',
 *   preset: object|null,
 *   presetName: string,
 *   resolvedClerkDomain: string,
 *   sharedPubKeyEnv: string,
 *   sharedSecretKeyEnv: string,
 * }}
 */
export function resolveBrandContext(config) {
  const auth = config?.auth ?? {};
  const presetName = auth.brandPreset ?? '';
  const preset = loadBrandPreset(presetName);

  const shareInstance =
    auth.shareInstanceAcrossApps ?? preset?.clerk?.shareInstanceAcrossApps ?? false;
  const mode = shareInstance ? 'A' : 'B';

  // 方式A: ブランド共有インスタンスのドメイン(親=preset.clerk.customDomain)を必ず使う。
  // 方式B: アプリ固有の clerkCustomDomain を優先。
  const resolvedClerkDomain =
    mode === 'A'
      ? preset?.clerk?.customDomain || auth.clerkCustomDomain || ''
      : auth.clerkCustomDomain || preset?.clerk?.customDomain || '';

  // 方式Aで各アプリが受け取るブランド共有鍵のenv名。
  const sharedPubKeyEnv = preset?.clerk?.sharedInstancePublishableKeyEnv ?? '';
  const sharedSecretKeyEnv = preset?.clerk?.sharedInstanceSecretKeyEnv ?? '';

  return {
    mode,
    preset,
    presetName,
    resolvedClerkDomain,
    sharedPubKeyEnv,
    sharedSecretKeyEnv,
  };
}

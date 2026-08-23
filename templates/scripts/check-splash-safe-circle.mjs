#!/usr/bin/env node
/**
 * scripts/check-splash-safe-circle.mjs
 *
 * ★ネイティブ起動画面のロゴが「Android の円形マスクで切れないか」を機械で確かめる。
 *
 * ■ なぜ必要か（2026-08-23 実害）
 *   起動画面に **ネイビーの円** が出ていた。他アプリは綺麗に出るのにこれだけ違った。
 *
 *   真因: expo-splash-screen は 288dp キャンバスに画像を中央合成し、
 *   **背景はプラグインが敷く**（@expo/prebuild-config の withAndroidSplashImages.js）。
 *   そこへ「背景を焼き込んだ不透過の正方形」を渡すと 288dp 全面が埋まり、
 *   ★Android 12+ が**円形にトリミング**して「色の付いた円」になる。
 *
 *   実測: 旧素材は絵柄 bbox 287x287dp・半対角 202.9dp。
 *         ★安全円の半径は 96.0dp（Android 公式: 288dp キャンバス・直径192dp）。
 *         https://developer.android.com/develop/ui/views/launch/splash-screen
 *
 * ■ ★この検査が守ること
 *   1. `image` が**透過PNG**であること（不透過だと必ず円に切られる）
 *   2. 絵柄が**安全円の内側**に収まること（imageWidth を上げすぎると切れる）
 *
 * ■ ★見ないこと（限界）
 *   iOS 側は Storyboard で円形マスクが無いため対象外。
 *   実機の見え方そのもの（色の好み・大きさの好み）は判定しない。
 *
 * 終了コード: 0=合格 / 1=測れた上での赤 / 2=測れなかった
 *
 * 使い方:
 *   node scripts/check-splash-safe-circle.mjs
 *   node scripts/check-splash-safe-circle.mjs --selftest
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { EXIT, computeExitCode, formatProbeReport } from "./lib/instrument-core.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Android 公式: 288dp キャンバスに直径192dp の円。半径は 96dp。 */
export const CANVAS_DP = 288;
export const SAFE_RADIUS_DP = 96;

/** PNG の IHDR から幅・高さ・カラータイプを読む（依存を増やさない）。 */
export function readPngHeader(buf) {
  if (!buf || buf.length < 26) return null;
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf.readUInt8(25), // 6=RGBA, 4=GrayAlpha, 3=Palette, 2=RGB, 0=Gray
  };
}

/** アルファチャンネルを持つカラータイプか。 */
export function hasAlphaChannel(colorType) {
  return colorType === 4 || colorType === 6;
}

/**
 * 絵柄の半対角が安全円に収まるか。
 *
 * @param {number} bboxWdp 絵柄の幅(dp)
 * @param {number} bboxHdp 絵柄の高さ(dp)
 */
export function fitsInSafeCircle(bboxWdp, bboxHdp) {
  const half = Math.hypot(bboxWdp, bboxHdp) / 2;
  return { half, fits: half <= SAFE_RADIUS_DP };
}

/* ── --selftest: 毒→赤 を機械で確認 ─────────────────────────── */
function selfTest() {
  const cases = [
    {
      name: "★不透過(RGB)を透過と判定しない",
      run: () => hasAlphaChannel(2) === false && hasAlphaChannel(6) === true,
    },
    {
      name: "★安全円をはみ出す絵柄を通さない",
      // 旧素材の実測値 287x287dp → 半対角 202.9dp
      run: () => fitsInSafeCircle(287, 287).fits === false,
    },
    {
      name: "収まる絵柄は通す",
      // 現在の実測値 103x91dp → 半対角 68.5dp
      run: () => fitsInSafeCircle(103, 91).fits === true,
    },
    {
      name: "PNG でないものをヘッダとして読まない",
      run: () => readPngHeader(Buffer.from("not a png")) === null,
    },
  ];
  const fails = [];
  for (const c of cases) {
    let ok = false;
    try {
      ok = c.run() === true;
    } catch (e) {
      fails.push(`${c.name}: 例外 (${e && e.message})`);
      continue;
    }
    if (!ok) fails.push(`${c.name}: ★期待どおりに動かなかった`);
  }
  if (fails.length) {
    console.error("[check-splash-safe-circle --selftest] 🔴 検査自体が壊れています:");
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log(`[check-splash-safe-circle --selftest] ✅ ${cases.length}件すべて期待どおり。`);
  process.exit(EXIT.PASS);
}

if (process.argv.includes("--selftest")) selfTest();

/* ── 本体 ─────────────────────────────────────────────────── */
const SRC = join(ROOT, "assets/images/splash-icon.png");
const results = [];

if (!existsSync(SRC)) {
  results.push({
    probe: "起動画面ロゴ",
    verdict: "inconclusive",
    evidence: null,
    detail: "assets/images/splash-icon.png が見つかりません",
    howToFix: "pnpm brand:icons で生成する",
  });
} else {
  const head = readPngHeader(readFileSync(SRC));
  if (!head) {
    results.push({
      probe: "起動画面ロゴ",
      verdict: "inconclusive",
      evidence: null,
      detail: "PNG として読めません",
      howToFix: "pnpm brand:icons で作り直す",
    });
  } else if (!hasAlphaChannel(head.colorType)) {
    results.push({
      probe: "起動画面ロゴの透過",
      verdict: "fail",
      evidence: { 寸法: `${head.width}x${head.height}`, colorType: head.colorType },
      detail:
        "★背景が焼き込まれています（アルファチャンネルがありません）。" +
        "このまま出すと Android 12+ が円形に切り、「色の付いた円」になります",
      howToFix:
        "scripts/sync-brand-icons.py の compose_splash_logo() で作る" +
        "（背景は app.config.ts の backgroundColor に任せる）",
      limitation: "iOS は円形マスクが無いため対象外",
    });
  } else {
    results.push({
      probe: "起動画面ロゴの透過",
      verdict: "pass",
      evidence: { 寸法: `${head.width}x${head.height}`, 透過: "あり" },
      limitation: "iOS は円形マスクが無いため対象外。実機の見え方は判定しない",
    });
  }
}

console.log(formatProbeReport(results, { label: "check-splash-safe-circle" }));
process.exit(computeExitCode(results));

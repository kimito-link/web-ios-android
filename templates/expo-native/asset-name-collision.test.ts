/**
 * Android の release ビルドが `Duplicate resources` で落ちるのを防ぐ。
 *
 * Android は assets を drawable リソースに変換するとき、
 * **拡張子を落としてパス区切りを _ にした名前**をリソース名にする。
 *   assets/images/logos/kimitolink-logo.webp → assets_images_logos_kimitolinklogo
 *   assets/images/logos/kimitolink-logo.jpg  → assets_images_logos_kimitolinklogo  ← 衝突
 *
 * そのため同じディレクトリに拡張子だけ違う同名画像があると、
 * `mergeReleaseResources` が Duplicate resources で失敗する。
 * Web/iOS では起きないので、Play に出すまで気づけない（2026-08-11 実障害）。
 *
 * さらに Metro は assets/ 配下を**参照の有無に関わらず**バンドルするため、
 * 「どこからも import していない画像」でも衝突要因になる。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ASSETS_DIR = path.join(process.cwd(), "assets");
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("Android のリソース名衝突", () => {
  it("拡張子だけ違う同名画像が存在しない", () => {
    const files = walk(ASSETS_DIR).filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()));

    // 「拡張子を除いたパス」でグループ化する
    const byStem = new Map<string, string[]>();
    for (const f of files) {
      const stem = f.slice(0, -path.extname(f).length);
      const list = byStem.get(stem) ?? [];
      list.push(path.relative(process.cwd(), f).replace(/\\/g, "/"));
      byStem.set(stem, list);
    }

    const collisions = [...byStem.values()].filter((v) => v.length > 1);
    expect(
      collisions,
      `Android の release ビルドが Duplicate resources で落ちます。` +
        `どちらか一方だけ残してください:\n` +
        collisions.map((c) => `  - ${c.join(" / ")}`).join("\n"),
    ).toEqual([]);
  });
});

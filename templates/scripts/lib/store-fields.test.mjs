import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectStoreTargets, diffKnown, evaluateStoreFields, extractPageLabels, isFieldFilled } from "./store-fields.mjs";

const inventory = JSON.parse(readFileSync(new URL("./store-fields.json", import.meta.url), "utf8"));
const io = (files = {}, dirs = {}) => ({ fileNonEmpty: (p) => Boolean(files[p]), listDir: (d) => dirs[d] ?? null });

describe("対応表（store-fields.json）", () => {
  it("3つのストアの欄に id・label・level・has がそろっている", () => {
    for (const store of ["appstore", "play", "cws"]) {
      const ids = new Set();
      for (const f of inventory.stores[store].fields) {
        expect(f.id && f.label && f.has, `${store}.${f.id}`).toBeTruthy();
        expect(["required", "cvr", "when"]).toContain(f.level);
        expect(ids.has(f.id), `${store}.${f.id} が重複`).toBe(false);
        ids.add(f.id);
      }
    }
  });
  it("りんくに言われた欄（ヘッダ・検索結果・iPhone Duo）が CVR の欄として入っている", () => {
    const ids = inventory.stores.appstore.fields.filter((f) => f.level === "cvr").map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["creativeHeader", "creativeSearch", "screenshotsIphoneDuo"]));
  });
});

describe("isFieldFilled", () => {
  it("ファイル・フォルダ・設定値のどれでも見られる", () => {
    expect(isFieldFilled({ has: { files: ["a.txt"] } }, { io: io({ "a.txt": 1 }) })).toBe(true);
    expect(isFieldFilled({ has: { files: ["a.txt"] } }, { io: io() })).toBe(false);
    expect(isFieldFilled({ has: { dirs: ["s"], min: 2 } }, { io: io({}, { s: ["1.png", "notes.md"] }) })).toBe(false);
    expect(isFieldFilled({ has: { dirs: ["s"], min: 2 } }, { io: io({}, { s: ["1.png", "2.jpg"] }) })).toBe(true);
    expect(isFieldFilled({ has: { config: "contact.url" } }, { config: { contact: { url: "<TODO>" } }, io: io() })).toBe(false);
    expect(isFieldFilled({ has: { config: ["contact.url", "identity.domain"] } }, { config: { identity: { domain: "x.jp" } }, io: io() })).toBe(true);
  });
});

describe("evaluateStoreFields / detectStoreTargets", () => {
  it("ヘッダ画像が無ければ空きとして出る", () => {
    const rows = evaluateStoreFields(inventory, { targets: ["appstore"], io: io() });
    expect(rows.find((r) => r.id === "creativeHeader")).toMatchObject({ filled: false, level: "cvr", fill: "screen" });
  });
  it("出すストアを app.config と置いてあるフォルダから推定し、env が最優先", () => {
    expect(detectStoreTargets({ config: { stores: { ascAppId: "123", playPackageName: "a.b" } } })).toEqual(["appstore", "play"]);
    expect(detectStoreTargets({ hasPath: (p) => p === "manifest.json" })).toEqual(["cws"]);
    expect(detectStoreTargets({ config: { stores: { ascAppId: "123" } }, envTargets: "cws" })).toEqual(["cws"]);
  });
});

describe("欄が増えたことに気づく", () => {
  it("仕様ページの HTML コメント（Apple の端末の区切り）も拾い、増えたら差分に出る", () => {
    const before = { labels: extractPageLabels("<h3>iPhone</h3><!-- iPhone 16 -->") };
    const after = { labels: extractPageLabels("<h3>iPhone</h3><!-- iPhone 16 --><!-- iPhone Duo -->") };
    expect(diffKnown(before, after)).toMatchObject({ changed: true, added: { labels: ["iPhone Duo"] } });
    expect(diffKnown(after, after).changed).toBe(false);
  });
  it("文の切れ端（小文字だけの語）は欄の名前として拾わない", () => {
    expect(extractPageLabels("<b>after</b><b>least 1</b><b>iPhone</b>")).toEqual(["iPhone"]);
  });
});

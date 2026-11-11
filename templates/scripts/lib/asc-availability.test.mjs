import { describe, expect, it } from "vitest";
import { buildCreateAvailabilityBody, ensureAllTerritoriesAvailable } from "./asc-availability.mjs";

/** 呼ばれた順を記録する ASC API の替え玉。 */
function fakeApi(routes) {
  const calls = [];
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    for (const [key, handler] of routes) {
      if (`${method} ${path}`.startsWith(key)) return handler(body);
    }
    throw new Error(`${method} ${path} -> 500: unexpected`);
  };
  api.calls = calls;
  return api;
}

describe("ensureAllTerritoriesAvailable", () => {
  it("配信設定が無い（404）なら、全地域で新しく作る（2026-11-10 Kimito Link Voice の実損）", async () => {
    const api = fakeApi([
      ["GET /v1/apps/1/appAvailabilityV2", () => { throw new Error("GET /v1/apps/1/appAvailabilityV2 -> 404: {}"); }],
      ["GET /v1/territories", () => ({ data: [{ id: "JPN" }, { id: "USA" }] })],
      ["POST /v2/appAvailabilities", () => ({ data: { id: "av1" } })],
    ]);
    const r = await ensureAllTerritoriesAvailable(api, "1");
    expect(r).toEqual({ set: true, created: true, territories: 2 });
    const post = api.calls.find((c) => c.method === "POST");
    expect(post.body.included).toHaveLength(2);
    expect(post.body.included.every((i) => i.attributes.available === true)).toBe(true);
  });

  it("404 以外の失敗は隠さない", async () => {
    const api = fakeApi([
      ["GET /v1/apps/1/appAvailabilityV2", () => { throw new Error("GET ... -> 401: {}"); }],
    ]);
    await expect(ensureAllTerritoriesAvailable(api, "1")).rejects.toThrow(/401/);
  });

  it("止まっている地域だけ配信に戻す", async () => {
    const api = fakeApi([
      ["GET /v1/apps/1/appAvailabilityV2", () => ({ data: { id: "av1" } })],
      ["GET /v2/appAvailabilities/av1/territoryAvailabilities", () => ({
        data: [
          { id: "ta-jpn", attributes: { available: true } },
          { id: "ta-usa", attributes: { available: false } },
        ],
      })],
      ["PATCH /v1/territoryAvailabilities/ta-usa", () => ({})],
      ["PATCH /v1/appAvailabilities/av1", () => ({})],
    ]);
    const r = await ensureAllTerritoriesAvailable(api, "1");
    expect(r.turnedOn).toBe(1);
    expect(api.calls.some((c) => c.path.includes("ta-jpn"))).toBe(false);
  });

  it("全地域が配信中なら何も変えない", async () => {
    const api = fakeApi([
      ["GET /v1/apps/1/appAvailabilityV2", () => ({ data: { id: "av1" } })],
      ["GET /v2/appAvailabilities/av1/territoryAvailabilities", () => ({
        data: [{ id: "ta-jpn", attributes: { available: true } }],
      })],
    ]);
    const r = await ensureAllTerritoriesAvailable(api, "1");
    expect(r.set).toBe(false);
    expect(api.calls.every((c) => c.method === "GET")).toBe(true);
  });
});

describe("buildCreateAvailabilityBody", () => {
  it("関係の id と included の id が対になる", () => {
    const body = buildCreateAvailabilityBody("1", ["JPN"]);
    expect(body.data.relationships.territoryAvailabilities.data[0].id).toBe(body.included[0].id);
    expect(body.included[0].relationships.territory.data.id).toBe("JPN");
  });
});

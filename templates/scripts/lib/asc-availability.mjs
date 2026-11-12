// 配信地域(App Availability)の自動設定。
//
// 背景: 審査に通っても配信地域が0件だと実機で「この国または地域では入手できません」
// になる(docs/TROUBLESHOOTING.md参照)。これまで asc-readonly-checks.mjs の
// checkTerritoriesConfigured は「0件を検出して警告する」だけで、実際の設定はASC UIで
// 手動だった。ここではその警告を自動修復に格上げする。
//
// エンドポイント: v1 availableTerritories は deprecated。
//   GET  /v1/apps/{id}/appAvailabilityV2                      → appAvailability の id を得る
//   PATCH /v1/appAvailabilities/{availabilityId}               → availableInNewTerritories を立てる
// availableInNewTerritories=true にすると、既存の全territory + Appleが将来追加する新territory
// にも自動追随して配信される(個々のterritoryIdを列挙するより堅牢)。
//
// 冪等: 全地域が available=true なら何もしない。配信設定が無ければ POST /v2/appAvailabilities で作る。

// ★404 は「配信設定がまだ1つも無い」という意味（新しく作ったアプリ）。失敗ではないので null を返す。
//   2026-11-10 の Kimito Link Voice 初回提出で、ここが 404 を例外として投げ、配信地域が空のまま
//   審査に通った。結果、承認後に「App Store の配信から削除されました」と出て公開されなかった。
async function getAppAvailabilityId(api, appId) {
  try {
    const avail = await api('GET', `/v1/apps/${appId}/appAvailabilityV2`);
    return avail?.data?.id || null;
  } catch (e) {
    if (/-> 404:/.test(String(e?.message))) return null;
    throw e;
  }
}

async function listTerritoryAvailabilities(api, availabilityId) {
  const out = [];
  let url = `/v2/appAvailabilities/${availabilityId}/territoryAvailabilities?limit=200&fields[territoryAvailabilities]=available`;
  while (url) {
    const page = await api('GET', url);
    out.push(...(page?.data || []));
    url = page?.links?.next || null;
  }
  return out;
}

async function listAllTerritoryIds(api) {
  const ids = [];
  let url = '/v1/territories?limit=200';
  while (url) {
    const page = await api('GET', url);
    ids.push(...(page?.data || []).map((t) => t.id));
    url = page?.links?.next || null;
  }
  return ids;
}

/** 配信設定を新しく作る本文。全地域を available=true で並べる（純粋関数・テスト対象）。 */
export function buildCreateAvailabilityBody(appId, territoryIds) {
  const local = (id) => `\${territory-${id}}`;
  return {
    data: {
      type: 'appAvailabilities',
      attributes: { availableInNewTerritories: true },
      relationships: {
        app: { data: { type: 'apps', id: appId } },
        territoryAvailabilities: {
          data: territoryIds.map((id) => ({ type: 'territoryAvailabilities', id: local(id) })),
        },
      },
    },
    included: territoryIds.map((id) => ({
      type: 'territoryAvailabilities',
      id: local(id),
      attributes: { available: true },
      relationships: { territory: { data: { type: 'territories', id } } },
    })),
  };
}

/**
 * 全地域で配信される状態にする。冪等。
 *   - 配信設定が無い（404）→ 全地域で新しく作る
 *   - あるが available=false の地域がある → その地域を true にする
 *   - 全部 true → 何もしない
 */
export async function ensureAllTerritoriesAvailable(api, appId) {
  const availabilityId = await getAppAvailabilityId(api, appId);
  if (!availabilityId) {
    const territoryIds = await listAllTerritoryIds(api);
    if (territoryIds.length === 0) throw new Error('territories が0件（API の応答が想定外）');
    console.log(`  no availability yet; creating for ${territoryIds.length} territories`);
    await api('POST', '/v2/appAvailabilities', buildCreateAvailabilityBody(appId, territoryIds));
    return { set: true, created: true, territories: territoryIds.length };
  }

  const rows = await listTerritoryAvailabilities(api, availabilityId);
  const off = rows.filter((r) => r?.attributes?.available === false);
  if (rows.length > 0 && off.length === 0) {
    console.log(`  territory availability already configured (${rows.length} territories); nothing to do`);
    return { set: false, territories: rows.length };
  }

  console.log(`  turning on ${off.length} territories (of ${rows.length})`);
  for (const r of off) {
    await api('PATCH', `/v1/territoryAvailabilities/${r.id}`, {
      data: { type: 'territoryAvailabilities', id: r.id, attributes: { available: true } },
    });
  }
  await api('PATCH', `/v1/appAvailabilities/${availabilityId}`, {
    data: { type: 'appAvailabilities', id: availabilityId, attributes: { availableInNewTerritories: true } },
  }).catch((e) => console.log(`  WARN: availableInNewTerritories の設定に失敗: ${String(e.message).slice(0, 200)}`));
  return { set: true, territories: rows.length, turnedOn: off.length };
}

/**
 * social-followers.mjs — X(Twitter)/YouTubeのフォロワー・登録者数を取得する。
 *
 * 設計: _docs/DESIGN-revenue-bottleneck-dashboard-2026-09-08.md §F-3
 * ★kimitolink-linktree/lib/server/x-followers.ts のClerk依存実装を、
 * Clerk無し(アプリ本人のBearerトークン直叩き)の形に薄く移植した。
 *
 * マッピングは環境変数(§F-3): X_BEARER_TOKEN__<product-id>、
 * YOUTUBE_API_KEY + YOUTUBE_CHANNEL_ID__<product-id>。
 */

/** 環境変数名に使えるよう product id をサニタイズする(ハイフン→アンダースコア、大文字化)。 */
function envKey(productId) {
  return productId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/**
 * @param {string} productId
 * @returns {Promise<{ ok:true, followers:number } | { ok:false, error:string } | null>} nullは未設定(任意機能なのでfail-closedにしない)
 */
export async function fetchXFollowers(productId) {
  const token = process.env[`X_BEARER_TOKEN__${envKey(productId)}`];
  if (!token) return null;

  try {
    // 自分のユーザーIDをまず引く(/2/users/me)。
    const meRes = await fetch('https://api.twitter.com/2/users/me?user.fields=public_metrics', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meText = await meRes.text();
    if (!meRes.ok) {
      return { ok: false, error: `GET /2/users/me -> ${meRes.status}: ${meText.slice(0, 300)}` };
    }
    const me = JSON.parse(meText);
    const followers = me?.data?.public_metrics?.followers_count;
    if (typeof followers !== 'number') {
      return { ok: false, error: 'public_metrics.followers_count が取得できませんでした' };
    }
    return { ok: true, followers };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * @param {string} productId
 * @returns {Promise<{ ok:true, subscribers:number } | { ok:false, error:string } | null>}
 */
export async function fetchYouTubeSubscribers(productId) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const channelId = process.env[`YOUTUBE_CHANNEL_ID__${envKey(productId)}`];
  if (!apiKey || !channelId) return null;

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/channels');
    url.searchParams.set('part', 'statistics');
    url.searchParams.set('id', channelId);
    url.searchParams.set('key', apiKey);
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `GET /youtube/v3/channels -> ${res.status}: ${text.slice(0, 300)}` };
    }
    const j = JSON.parse(text);
    const stats = j.items?.[0]?.statistics;
    if (!stats || stats.hiddenSubscriberCount) {
      return { ok: false, error: 'subscriberCount が非公開、またはチャンネルが見つかりません' };
    }
    return { ok: true, subscribers: Number(stats.subscriberCount) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

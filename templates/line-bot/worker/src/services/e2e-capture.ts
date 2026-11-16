/**
 * LINEシミュレーション（本番のままの通し確認・E2E）の部品。
 * 正本の説明: docs/ai-rules/12_LINE_SIMULATION.md ／ 使い方: templates/line-bot/e2e/README.md
 * 出典: kimito-link/linebot apps/worker/src/services/e2e-capture.ts（2026-10-14〜11-16、本番E2E 39/39 で実証）
 *
 * 決めた「偽の利用者ID」（env.E2E_USER_ID）からの webhook だけ、
 *   - 出口: LINE への返信・push を送らず、D1 の e2e_capture に「送るはずだったもの」を記録する
 *   - 入口の穴埋め: LINE にしか無いもの（ファイル・画像の中身）を、D1 の e2e_files に置いた中身へ差し替える
 * 実在の人（ID が完全一致しない人）には、どちらも一切効かない。
 * テーブルは migrations/002_e2e.sql。
 */
import type { LineClient } from '../line-sdk/client.js';

/** LINE へ「送る」メソッド名。ここに無い送信メソッドを LineClient に足したら、ここにも足す（足し忘れると本物が飛ぶ）。 */
const SEND_METHODS = new Set([
  'replyMessage', 'replyTextMessage', 'replyFlexMessage',
  'pushMessage', 'pushTextMessage', 'pushFlexMessage',
  'multicast', 'broadcast', 'narrowcast',
]);

const LINE_USER_ID = /^U[0-9a-f]{32}$/;

/** 設定済みの偽の利用者IDと「完全一致」のときだけ true。未設定・形が違う設定値なら常に false（fail-closed）。 */
export function isE2eUser(userId: string | null | undefined, e2eUserId: string | null | undefined): boolean {
  return Boolean(userId && e2eUserId && LINE_USER_ID.test(e2eUserId) && userId === e2eUserId);
}

export async function appendCapture(db: D1Database, entry: { method: string; args: unknown[] }): Promise<void> {
  await db
    .prepare('INSERT INTO e2e_capture (id, method, payload, created_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), entry.method, JSON.stringify(entry.args), new Date().toISOString())
    .run();
}

/**
 * LINE への送信を記録に置き換えた LineClient を返す。読み取り（getProfile 等）は偽の値。
 * ★偽の利用者からのイベントにだけ使う。Proxy なので LineClient にメソッドが増えても壊れないが、
 *   「送る」メソッドが増えたら SEND_METHODS に足すこと。
 */
export function captureLineClient(real: LineClient, db: D1Database): LineClient {
  return new Proxy(real, {
    get(target, prop, recv) {
      const name = String(prop);
      if (SEND_METHODS.has(name)) {
        return async (...args: unknown[]) => {
          await appendCapture(db, { method: name, args });
          return {};
        };
      }
      if (name === 'getProfile') {
        return async (userId: string) => ({ userId, displayName: 'E2Eテスト', pictureUrl: undefined, statusMessage: undefined });
      }
      if (name === 'showLoadingAnimation') return async () => ({});
      return Reflect.get(target, prop, recv);
    },
  });
}

/**
 * LINE の content API（api-data.line.me）からの取り出しだけを差し替える fetch。
 * messageId が `e2e-file:<名前>` のとき、D1 の e2e_files（base64）を返す。それ以外は本物の fetch へ素通し。
 * ★偽の利用者からのイベントにだけ渡すこと。D1 に書ける者しか中身を置けないので、外から悪用できない。
 */
export function e2eFileFetch(db: D1Database, realFetch: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const m = url.match(/^https:\/\/api-data\.line\.me\/v2\/bot\/message\/e2e-file(?:%3A|:)([A-Za-z0-9._-]{1,40})\/content(\/transcoding)?$/);
    if (!m) return realFetch(input, init);
    // 動画・音声の「変換できた？」の問い合わせには、いつも「できた」と答える
    if (m[2]) return new Response(JSON.stringify({ status: 'succeeded' }), { headers: { 'content-type': 'application/json' } });
    const row = await db
      .prepare('SELECT content_type, body_base64 FROM e2e_files WHERE name = ?')
      .bind(m[1])
      .first<{ content_type: string | null; body_base64: string }>();
    if (!row) return new Response('not found', { status: 404 });
    const bytes = Uint8Array.from(atob(row.body_base64), (c) => c.charCodeAt(0));
    return new Response(bytes, { headers: { 'content-type': row.content_type || 'application/octet-stream' } });
  }) as typeof fetch;
}

/** 予約済みのドメイン（.invalid）宛てには、どんな場合もメールを送らない（E2E でメール送信がある Bot 用）。 */
export function isNeverSendAddress(to: string | null | undefined): boolean {
  return (to ?? '').split(',').some((a) => /\.invalid\s*>?\s*$/i.test(a.trim()));
}

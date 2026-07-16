import { Hono } from 'hono';
import { verifySignature } from '../line-sdk/webhook.js';
import type { WebhookRequestBody, WebhookEvent } from '../line-sdk/webhook.js';
import { LineClient } from '../line-sdk/client.js';
import { runGroqSupportPipeline } from '../services/groq-pipeline.js';
import type { Env } from '../index.js';

const webhook = new Hono<Env>();

// 署名検証前の未認証リクエストに対する防御(#104と同種)。LINEのwebhookボディは
// 小さい(events配列)ため、1MiBあれば連続イベントのバーストにも十分。
const MAX_WEBHOOK_BODY_SIZE = 1024 * 1024;
const LINE_SIGNATURE_LENGTH = 44; // HMAC-SHA256 + base64

const FALLBACK_REPLY_TEXT =
  'すみません、うまく応答できませんでした。少し時間をおいて、もう一度お試しください。';

interface FriendRow {
  id: string;
  line_user_id: string;
  ai_reply_mode: string;
}

async function ensureFriend(db: D1Database, lineClient: LineClient, userId: string): Promise<FriendRow> {
  const existing = await db
    .prepare('SELECT id, line_user_id, ai_reply_mode FROM friends WHERE line_user_id = ?')
    .bind(userId)
    .first<FriendRow>();
  if (existing) return existing;

  let profile: { displayName?: string; pictureUrl?: string; statusMessage?: string } | null = null;
  try {
    profile = await lineClient.getProfile(userId);
  } catch (err) {
    // 署名検証済みwebhookはこのuserIdの実在を証明済み。プロフィール取得が一時的に
    // 失敗しても、friendレコード自体は作成してイベント処理を継続する。
    console.error('[webhook] failed to get profile for', userId, err);
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO friends (id, line_user_id, display_name, picture_url, status_message)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, profile?.displayName ?? null, profile?.pictureUrl ?? null, profile?.statusMessage ?? null)
    .run();

  return { id, line_user_id: userId, ai_reply_mode: 'bot' };
}

async function logMessage(
  db: D1Database,
  friendId: string,
  direction: 'incoming' | 'outgoing',
  content: string,
  source?: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, source)
       VALUES (?, ?, ?, 'text', ?, ?)`,
    )
    .bind(crypto.randomUUID(), friendId, direction, content, source ?? null)
    .run();
}

webhook.post('/webhook', async (c) => {
  const contentLengthHeader = c.req.header('Content-Length');
  if (contentLengthHeader) {
    const declared = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BODY_SIZE) {
      return c.json({ status: 'too_large' }, 413);
    }
  }

  const rawBody = await c.req.text();
  const rawBodyByteLength = new TextEncoder().encode(rawBody).byteLength;
  if (rawBodyByteLength > MAX_WEBHOOK_BODY_SIZE) {
    return c.json({ status: 'too_large' }, 413);
  }

  const signature = c.req.header('X-Line-Signature') ?? '';
  if (signature.length !== LINE_SIGNATURE_LENGTH) {
    console.error('[webhook] missing or malformed LINE signature');
    return c.json({ status: 'ok' }, 200);
  }

  // JSON.parseの前に検証する。攻撃者が作ったボディをパーサーに絶対渡さないため。
  const valid = await verifySignature(c.env.LINE_CHANNEL_SECRET, rawBody, signature);
  if (!valid) {
    console.error('[webhook] invalid LINE signature');
    return c.json({ status: 'ok' }, 200);
  }

  let body: WebhookRequestBody;
  try {
    body = JSON.parse(rawBody) as WebhookRequestBody;
  } catch {
    console.error('[webhook] failed to parse body');
    return c.json({ status: 'ok' }, 200);
  }

  // replyTokenの60秒失効に対する残り時間駆動（llm-chain.ts）の起点。
  const receivedAt = Date.now();
  const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
  const db = c.env.DB;

  // LINEは~1秒以内のレスポンスを要求する。処理は非同期化してwaitUntilに逃がす。
  const processingPromise = (async () => {
    for (const event of body.events) {
      try {
        await handleEvent(db, lineClient, event, c.env.GROQ_API_KEY, receivedAt, c.env.GEMINI_API_KEY, c.env.AI);
      } catch (err) {
        console.error('[webhook] error handling event:', err instanceof Error ? err.stack : String(err));
      }
    }
  })();

  c.executionCtx.waitUntil(processingPromise);

  return c.json({ status: 'ok' }, 200);
});

async function handleEvent(
  db: D1Database,
  lineClient: LineClient,
  event: WebhookEvent,
  groqApiKey: string | undefined,
  receivedAt: number,
  geminiApiKey: string | undefined,
  workersAi: Ai | undefined,
): Promise<void> {
  const userId = event.source.type === 'user' ? event.source.userId : undefined;
  if (!userId) return;

  if (event.type === 'follow') {
    await ensureFriend(db, lineClient, userId);
    return;
  }

  if (event.type !== 'message' || event.message?.type !== 'text' || !event.replyToken) return;

  const incomingText = event.message.text ?? '';
  const friend = await ensureFriend(db, lineClient, userId);
  await logMessage(db, friend.id, 'incoming', incomingText);

  // ai_reply_mode='human' の間はAIが割り込まない(担当者がLINE公式アカウント管理画面から
  // 直接返信する運用を想定)。既知の罠: GROQがエスカレーション判定した後、誰かが
  // 手動でbotに戻し忘れると無言化したように見える。運用側で定期的に確認すること。
  if (friend.ai_reply_mode === 'human') return;

  let replyTokenConsumed = false;
  // replyToken失効（発行から約60秒）対策の送信保険。45秒以内かつ未消費なら
  // replyMessageを試み、失敗（トークン失効・二重消費等）した場合はpushMessageに
  // 切り替える。pushMessageはreplyTokenを必要とせずいつでも届くため、これが
  // 効くケースは従来なら「例外を握りつぶして完全に無言化」していたはずの経路
  // （line-harness-oss 2026-07-17 Fable設計「無応答ゼロ化アーキテクチャ」）。
  const safeSendText = async (text: string, source: string): Promise<void> => {
    const withinDeadline = !replyTokenConsumed && Date.now() - receivedAt < 45_000;
    if (withinDeadline) {
      try {
        await lineClient.replyMessage(event.replyToken!, [{ type: 'text', text }]);
        replyTokenConsumed = true;
        await logMessage(db, friend.id, 'outgoing', text, source);
        return;
      } catch (err) {
        console.warn('[safe-send] replyMessage failed, falling back to pushMessage', err instanceof Error ? err.message : String(err));
      }
    }
    await lineClient.pushTextMessage(friend.line_user_id, text);
    await logMessage(db, friend.id, 'outgoing', text, source);
  };

  if (!groqApiKey && !geminiApiKey && !workersAi) {
    console.error('[webhook] no LLM provider configured (GROQ_API_KEY/GEMINI_API_KEY/AI binding all missing)');
    await safeSendText(FALLBACK_REPLY_TEXT, 'fallback');
    return;
  }

  try {
    const result = await runGroqSupportPipeline({
      db,
      apiKey: groqApiKey,
      geminiApiKey,
      workersAi,
      receivedAt,
      friendId: friend.id,
      incomingText,
    });

    if (result.kind === 'canned' || result.kind === 'reply') {
      await safeSendText(result.text, result.kind === 'canned' ? 'groq_canned' : 'groq_reply');
    } else if (result.kind === 'escalate') {
      await db
        .prepare(`UPDATE friends SET ai_reply_mode = 'human', updated_at = ? WHERE id = ?`)
        .bind(new Date().toISOString(), friend.id)
        .run();
      // エスカレーション時は無言にしない。result.text（[ESCALATE]除去後の本文）が空でも、
      // ユーザーには必ず「担当者につなぐ」ことが分かる一言を返す。これが無いと
      // ai_reply_mode='human'への切替えだけが起きて「既読無視」に見える
      // （line-harness-oss 2026-07-16 実障害: 会話が続いた末にテキスト無しでエスカレートし、
      // 以降そのユーザーへのAI応答が完全に止まった）。
      const escalationNotice = result.text || 'ちょっと待っててね、中の人につなぐね。';
      await safeSendText(escalationNotice, 'groq_reply');
    } else {
      // fail_closed
      await safeSendText(result.escalationText, 'groq_reply');
    }
  } catch (err) {
    // runGroqSupportPipeline自体が想定外の例外を投げた場合の最終防衛線。
    // ここで無言のままcatchすると「何を送っても無反応」バグになる(既知の実障害)。
    // 必ず固定の詫び文言だけは返す（safeSendTextがreplyToken失効時もpushで届ける）。
    console.error('[webhook] groq pipeline failed', err instanceof Error ? err.stack : String(err));
    try {
      await safeSendText(FALLBACK_REPLY_TEXT, 'fallback');
    } catch (replyErr) {
      console.error('[webhook] fallback reply also failed', replyErr instanceof Error ? replyErr.stack : String(replyErr));
    }
  }
}

export default webhook;

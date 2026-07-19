import { Hono } from 'hono';
import { verifySignature } from '../line-sdk/webhook.js';
import type { WebhookRequestBody, WebhookEvent } from '../line-sdk/webhook.js';
import { LineClient } from '../line-sdk/client.js';
import { runGroqSupportPipeline } from '../services/groq-pipeline.js';
import { getBotConfig } from '../services/bot-config.js';
import { describeImage } from '../services/vision-describe.js';
import { describeVideo, describeAudio } from '../services/media-describe.js';
import { fetchAndStoreIncomingImage } from '../services/incoming-image.js';
import { fetchAndStoreIncomingMedia } from '../services/incoming-media.js';
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
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, source)
       VALUES (?, ?, ?, 'text', ?, ?)`,
    )
    .bind(id, friendId, direction, content, source ?? null)
    .run();
  return id;
}

async function logMediaMessage(
  db: D1Database,
  friendId: string,
  messageType: 'image' | 'video' | 'audio',
  content: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, source)
       VALUES (?, ?, 'incoming', ?, ?, 'user')`,
    )
    .bind(id, friendId, messageType, content)
    .run();
  return id;
}

async function updateMediaMessageContent(db: D1Database, logId: string, content: string): Promise<void> {
  try {
    await db.prepare(`UPDATE messages_log SET content = ? WHERE id = ?`).bind(content, logId).run();
  } catch (err) {
    console.error('[webhook] media content UPDATE failed', err);
  }
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
  const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;

  // LINEは~1秒以内のレスポンスを要求する。処理は非同期化してwaitUntilに逃がす。
  const processingPromise = (async () => {
    for (const event of body.events) {
      try {
        await handleEvent(db, lineClient, event, {
          groqApiKey: c.env.GROQ_API_KEY,
          receivedAt,
          geminiApiKey: c.env.GEMINI_API_KEY,
          workersAi: c.env.AI,
          r2: c.env.IMAGES,
          workerUrl,
          channelAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
        });
      } catch (err) {
        console.error('[webhook] error handling event:', err instanceof Error ? err.stack : String(err));
      }
    }
  })();

  c.executionCtx.waitUntil(processingPromise);

  return c.json({ status: 'ok' }, 200);
});

interface HandleEventOptions {
  groqApiKey: string | undefined;
  receivedAt: number;
  geminiApiKey: string | undefined;
  workersAi: Ai | undefined;
  /** 画像・動画・音声認識用。未設定ならメディア認識は静かにスキップされる。 */
  r2: R2Bucket | undefined;
  workerUrl: string;
  channelAccessToken: string;
}

async function handleEvent(
  db: D1Database,
  lineClient: LineClient,
  event: WebhookEvent,
  opts: HandleEventOptions,
): Promise<void> {
  const { groqApiKey, receivedAt, geminiApiKey, workersAi, r2, workerUrl, channelAccessToken } = opts;
  const userId = event.source.type === 'user' ? event.source.userId : undefined;
  if (!userId) return;

  if (event.type === 'follow') {
    await ensureFriend(db, lineClient, userId);
    return;
  }

  if (event.type !== 'message' || !event.replyToken) return;

  // 画像・動画・音声（テキスト以外）はここで完結させ、以降のテキスト専用フローには
  // 進ませない（line-harness-oss本体からの移植。2026-07-17/19画像・動画・音声認識機能）。
  if (event.message?.type === 'image' || event.message?.type === 'video' || event.message?.type === 'audio') {
    await handleMediaMessage(db, lineClient, event, userId, opts);
    return;
  }

  if (event.message?.type !== 'text') return;

  const incomingText = event.message.text ?? '';
  const friend = await ensureFriend(db, lineClient, userId);
  const incomingLogId = await logMessage(db, friend.id, 'incoming', incomingText);

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
      excludeLogId: incomingLogId,
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

/**
 * 画像・動画・音声の受信処理（line-harness-oss本体からの移植。2026-07-17/19
 * 画像・動画・音声認識機能）。
 *
 * 2段方式: ①バイナリ取得→R2保存→describe（客観的な説明文を得る）
 *         ②説明文を「あなたらしく反応してください」という指示付きでテキスト
 *           パイプラインに渡し、人格・KB・履歴・エスカレーション判定をそのまま使う。
 *
 * describe失敗（未対応フォーマット・サイズ超過・タイムアウト等）は現状の
 * `[画像]`/`[動画]`/`[音声]`ラベル記録のみに静かに戻る（fail-closed、返信なし）。
 */
async function handleMediaMessage(
  db: D1Database,
  lineClient: LineClient,
  event: WebhookEvent,
  userId: string,
  opts: HandleEventOptions,
): Promise<void> {
  const { groqApiKey, receivedAt, geminiApiKey, workersAi, r2, workerUrl, channelAccessToken } = opts;
  const messageType = event.message!.type as 'image' | 'video' | 'audio';
  const lineMessageId = event.message!.id;
  const friend = await ensureFriend(db, lineClient, userId);

  if (friend.ai_reply_mode === 'human') {
    await logMediaMessage(db, friend.id, messageType, `[${messageType === 'image' ? '画像' : messageType === 'video' ? '動画' : '音声'}]`);
    return;
  }

  let replyTokenConsumed = false;
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

  if (!lineMessageId || !r2) {
    // R2未設定（wrangler.tomlに[[r2_buckets]]が無い等）はメディア認識機能自体が
    // 使えない状態。ラベルのみ記録して静かに終える（fail-closed）。
    await logMediaMessage(db, friend.id, messageType, `[${messageType === 'image' ? '画像' : messageType === 'video' ? '動画' : '音声'}]`);
    return;
  }

  let contentUrl: string | undefined;
  let bytes: ArrayBuffer | undefined;
  let contentType: string | undefined;
  let previewUrl: string | undefined;
  const label = messageType === 'image' ? '画像' : messageType === 'video' ? '動画' : '音声';
  let fallbackLabel = `[${label}]`;

  if (messageType === 'image') {
    const refs = await fetchAndStoreIncomingImage({
      r2,
      workerUrl,
      channelAccessToken,
      accountId: 'default',
      messageId: lineMessageId,
    });
    if (refs) {
      contentUrl = refs.originalContentUrl;
      previewUrl = refs.previewImageUrl;
      bytes = refs.bytes;
      contentType = refs.contentType;
    }
  } else {
    const { refs, failureReason } = await fetchAndStoreIncomingMedia({
      r2,
      workerUrl,
      channelAccessToken,
      accountId: 'default',
      messageId: lineMessageId,
      kind: messageType,
    });
    if (refs) {
      contentUrl = refs.originalContentUrl;
      bytes = refs.bytes;
      contentType = refs.contentType;
    } else if (failureReason) {
      // 失敗理由をmessages_logのcontentフォールバックに残す（ユーザーには見えない
      // DB上のログのみ）。console.errorしか見られない環境でもD1クエリだけで
      // 実測content-type等を確認できるようにする。
      fallbackLabel = `${fallbackLabel} (${failureReason})`;
    }
  }

  const initialContent = contentUrl
    ? JSON.stringify({ originalContentUrl: contentUrl, previewImageUrl: previewUrl })
    : fallbackLabel;
  const logId = await logMediaMessage(db, friend.id, messageType, initialContent);

  if (!bytes || !contentType) return; // 取得失敗。ラベル記録のみで静かに終える（fail-closed）。

  const config = getBotConfig();
  if (!groqApiKey && !geminiApiKey && !workersAi) return;

  try {
    let description: string | null = null;
    if (messageType === 'image') {
      if (!config.llm.vision?.enabled) return;
      description = await describeImage({
        bytes,
        contentType,
        publicImageUrl: contentUrl,
        publicUrlUnreachable: /localhost|127\.0\.0\.1/.test(workerUrl),
        vision: config.llm.vision,
        groqApiKey,
        geminiApiKey,
        receivedAt,
      });
    } else if (messageType === 'video') {
      if (!config.llm.video?.enabled) return;
      description = await describeVideo({ bytes, contentType, config: config.llm.video, geminiApiKey, receivedAt });
    } else {
      if (!config.llm.audio?.enabled) return;
      description = await describeAudio({ bytes, contentType, config: config.llm.audio, geminiApiKey, receivedAt });
    }

    if (!description) return; // describe失敗（チェーン全滅・サイズ超過等）→静かに終える。

    await updateMediaMessageContent(
      db,
      logId,
      JSON.stringify({ originalContentUrl: contentUrl, previewImageUrl: previewUrl, visionSummary: description }),
    );

    const result = await runGroqSupportPipeline({
      db,
      apiKey: groqApiKey,
      geminiApiKey,
      workersAi,
      receivedAt,
      friendId: friend.id,
      // 「〇〇の内容を報告せよ」という指示に読めるメタ記法を避け、ユーザーが
      // メディアを見せてきたという会話的な状況として渡す。カギ括弧のメタ記法だと
      // LLMがpersonaを離れて客観描写タスクだと誤認識し、素っ気ない説明文をそのまま
      // 返す事故が起きた（line-harness-oss 2026-07-18実障害の教訓）。
      incomingText: `（${label}を送ってきました。内容は次の通りです: ${description}）この${label}を見て、あなたらしく反応してください。`,
      cachePolicy: 'skip',
      excludeLogId: logId,
    });

    if (result.kind === 'canned' || result.kind === 'reply') {
      await safeSendText(result.text, result.kind === 'canned' ? 'groq_canned' : 'groq_reply');
    } else if (result.kind === 'escalate') {
      await db
        .prepare(`UPDATE friends SET ai_reply_mode = 'human', updated_at = ? WHERE id = ?`)
        .bind(new Date().toISOString(), friend.id)
        .run();
      const escalationNotice = result.text || 'ちょっと待っててね、中の人につなぐね。';
      await safeSendText(escalationNotice, 'groq_reply');
    } else {
      await safeSendText(result.escalationText, 'groq_reply');
    }
  } catch (err) {
    console.error('[webhook] media describe/pipeline failed', err instanceof Error ? err.stack : String(err));
    // describe/パイプライン失敗時は無言のまま（画像等と同じfail-closed。テキストと違い
    // 「送ったこと自体は記録済み」なので詫び文言の強制送信はしない設計を踏襲）。
  }
}

export default webhook;

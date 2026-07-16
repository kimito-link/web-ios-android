import { getBotConfig } from './bot-config.js';

/** Normalize user text for cache key lookup. */
export function normalizeQuestion(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function hashQuestion(normalized: string): Promise<string> {
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_PATTERN = /\d{2,4}[-\s]?\d{2,4}[-\s]?\d{3,4}/;

/** Canonical FAQ-style questions only; skip personal / error-context messages. */
export function isCacheableQuestion(text: string): boolean {
  const normalized = normalizeQuestion(text);
  if (normalized.length < 4 || normalized.length > 120) return false;
  if (EMAIL_PATTERN.test(text)) return false;
  if (PHONE_PATTERN.test(text)) return false;
  if (/エラー|error|例外|failed|失敗|出ました|表示され|できません|動かない/i.test(text)) return false;
  if (/api[_-]?key|token|password|パスワード|シークレット|secret/i.test(text)) return false;
  return true;
}

function jstNow(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '');
}

export async function lookupCachedAnswer(db: D1Database, question: string): Promise<string | null> {
  const config = getBotConfig();
  if (!config.cache.enabled) return null;

  const normalized = normalizeQuestion(question);
  const questionHash = await hashQuestion(normalized);
  const now = jstNow();

  const row = await db
    .prepare(
      `SELECT answer FROM llm_response_cache
       WHERE question_hash = ? AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(questionHash, now)
    .first<{ answer: string }>();

  return row?.answer ?? null;
}

export async function saveCachedAnswer(db: D1Database, question: string, answer: string): Promise<void> {
  const config = getBotConfig();
  if (!config.cache.enabled || !isCacheableQuestion(question)) return;

  const normalized = normalizeQuestion(question);
  const questionHash = await hashQuestion(normalized);
  const now = new Date();
  const expires = new Date(now.getTime() + config.cache.ttlHours * 60 * 60 * 1000);

  await db
    .prepare(
      `INSERT INTO llm_response_cache
       (id, question_hash, question_normalized, answer, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), questionHash, normalized, answer, jstNow(), expires.toISOString())
    .run();
}

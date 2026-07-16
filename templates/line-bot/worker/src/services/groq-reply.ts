export const ESCALATION_MARKER = '[ESCALATE]';

export type GroqReplyKind = 'reply' | 'escalate' | 'fail_closed';

export interface GroqReplyResult {
  kind: GroqReplyKind;
  text?: string;
}

// Groq単体へのHTTP呼び出し本体は llm-providers.ts の callGroq() に統合済み
// （2026-07-17 Fable設計「無応答ゼロ化アーキテクチャ」。line-harness-oss本体からの
// 移植。旧 generateGroqReply は llm-chain.ts の generateLlmReplyWithFallback が
// Groq/Gemini/Workers AIのチェーンとして置き換えた）。このファイルには
// ESCALATION_MARKER 定数と会話履歴の組み立てのみ残す。

const MAX_HISTORY_MESSAGES = 6;

export async function buildGroqHistory(
  db: D1Database,
  friendId: string,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const rows = await db
    .prepare(
      `SELECT direction, content, message_type FROM messages_log
       WHERE friend_id = ? AND message_type = 'text'
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(friendId, MAX_HISTORY_MESSAGES)
    .all<{ direction: string; content: string; message_type: string }>();

  return rows.results
    .reverse()
    .map((row) => ({
      role: row.direction === 'incoming' ? ('user' as const) : ('assistant' as const),
      content: row.content,
    }));
}

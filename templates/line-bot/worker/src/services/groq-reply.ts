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

/**
 * image/video/audio行のcontent JSONを履歴用テキストに変換する（line-harness-oss本体
 * からの移植、画像・動画・音声認識機能）。visionSummaryがあれば`[画像: <説明>]`等、
 * 無ければ（describe失敗行・旧ラベル文字列行）`[画像]`等にフォールバックする。
 */
function mediaRowToHistoryText(content: string, messageType: string): string {
  const label = messageType === 'image' ? '画像' : messageType === 'video' ? '動画' : '音声';
  try {
    const parsed = JSON.parse(content) as { visionSummary?: string };
    return parsed.visionSummary ? `[${label}: ${parsed.visionSummary}]` : `[${label}]`;
  } catch {
    return `[${label}]`;
  }
}

export async function buildGroqHistory(
  db: D1Database,
  friendId: string,
  excludeLogId?: string,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  // excludeLogId: 呼び出し元がこの受信を処理する前にmessages_logへ既にINSERT/UPDATE
  // 済みの「今回自身の行」のid。指定しないと直近履歴の末尾に今回分が紛れ込み、
  // 呼び出し側が別途渡すincomingText（画像のvision説明+人格指示などの実際の
  // LLM向けテキスト）と食い違ったまま履歴の方が優先されてしまう
  // （line-harness-oss 2026-07-19実障害の修正を移植: 画像に無機質な客観描写だけを
  // 返す不具合の根本原因）。
  const rows = excludeLogId
    ? await db
        .prepare(
          `SELECT direction, content, message_type FROM messages_log
           WHERE friend_id = ? AND message_type IN ('text', 'image', 'video', 'audio') AND id != ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .bind(friendId, excludeLogId, MAX_HISTORY_MESSAGES)
        .all<{ direction: string; content: string; message_type: string }>()
    : await db
        .prepare(
          `SELECT direction, content, message_type FROM messages_log
           WHERE friend_id = ? AND message_type IN ('text', 'image', 'video', 'audio')
           ORDER BY created_at DESC LIMIT ?`,
        )
        .bind(friendId, MAX_HISTORY_MESSAGES)
        .all<{ direction: string; content: string; message_type: string }>();

  return rows.results
    .reverse()
    .map((row) => ({
      role: row.direction === 'incoming' ? ('user' as const) : ('assistant' as const),
      content: row.message_type === 'text' ? row.content : mediaRowToHistoryText(row.content, row.message_type),
    }));
}

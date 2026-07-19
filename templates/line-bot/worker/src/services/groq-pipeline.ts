import { lookupCachedAnswer, saveCachedAnswer, isCacheableQuestion } from './llm-cache.js';
import { searchKbArticles, formatKbContext, incrementGroqUsage, isGroqBudgetExceeded } from './kb-search.js';
import { buildGroqHistory } from './groq-reply.js';
import { generateLlmReplyWithFallback } from './llm-chain.js';
import { buildSystemPrompt, matchCannedResponse, getFailClosedEscalationText } from './knowledge-pack.js';

export type GroqPipelineResult =
  | { kind: 'canned'; text: string; source: 'canned' | 'cache' }
  | { kind: 'reply'; text: string }
  | { kind: 'escalate'; text?: string }
  | { kind: 'fail_closed'; escalationText: string };

export interface GroqPipelineParams {
  db: D1Database;
  /** 1番手(Groq)のAPIキー。省略時はGroq段をスキップし、チェーンの後段のみ試す。 */
  apiKey?: string;
  /** 2番手(Gemini)のAPIキー。省略時はGemini段をスキップする。 */
  geminiApiKey?: string;
  /** 3番手(Cloudflare Workers AI)のバインディング。省略時はWorkers AI段をスキップする。 */
  workersAi?: Ai;
  /** webhook受信時刻(ms epoch)。チェーンの残り時間駆動スキップに使う。 */
  receivedAt: number;
  friendId: string;
  incomingText: string;
  /**
   * 'skip'指定でlookupCachedAnswer/saveCachedAnswerの両方を無効化する。画像/動画/音声の
   * describe結果は1回性が高く、誤ってキャッシュされると「別の画像/動画/音声の答えを返す」
   * 事故になるため（line-harness-oss本体からの移植）。
   */
  cachePolicy?: 'normal' | 'skip';
  /**
   * 呼び出し元が本メッセージを処理する前にmessages_logへ既にINSERT/UPDATE済みの
   * 「今回自身の行」のid。buildGroqHistoryに渡して履歴から除外し、incomingTextと
   * 履歴末尾の内容が食い違ったまま履歴側が優先される事故を防ぐ（line-harness-oss
   * 2026-07-19実障害の修正を移植）。
   */
  excludeLogId?: string;
}

/**
 * Tier1 cache → Tier1.5 canned → Tier2 RAG+LLMチェーン pipeline。
 * Fail-closed: 例外やAPIエラー時は必ず escalationText を返す。
 * 2026-07-17: 単一Groq依存から Groq→Gemini→Workers AI の無応答ゼロ化チェーンに
 * 変更（line-harness-oss本体からの移植。Fable設計「無応答ゼロ化アーキテクチャ」）。
 */
export async function runGroqSupportPipeline(params: GroqPipelineParams): Promise<GroqPipelineResult> {
  const { db, apiKey, geminiApiKey, workersAi, receivedAt, friendId, incomingText, cachePolicy = 'normal', excludeLogId } = params;
  const cacheSkip = cachePolicy === 'skip';

  if (await isGroqBudgetExceeded(db)) {
    await incrementGroqUsage(db, 'escalations');
    return { kind: 'fail_closed', escalationText: getFailClosedEscalationText() };
  }

  const cached = cacheSkip ? null : await lookupCachedAnswer(db, incomingText);
  if (cached) {
    await incrementGroqUsage(db, 'cache_hits');
    return { kind: 'canned', text: cached, source: 'cache' };
  }

  const canned = matchCannedResponse(incomingText);
  if (canned) {
    if (!cacheSkip && isCacheableQuestion(incomingText)) {
      await saveCachedAnswer(db, incomingText, canned);
    }
    return { kind: 'canned', text: canned, source: 'canned' };
  }

  const kbHits = await searchKbArticles(db, incomingText);
  const kbContext = formatKbContext(kbHits);
  const systemPrompt = buildSystemPrompt(kbContext);
  const history = await buildGroqHistory(db, friendId, excludeLogId);

  await incrementGroqUsage(db, 'groq_calls');

  const groqResult = await generateLlmReplyWithFallback({
    systemPrompt,
    messages: history,
    incomingText,
    receivedAt,
    groqApiKey: apiKey,
    geminiApiKey,
    workersAi,
  });

  if (groqResult.kind === 'fail_closed') {
    await incrementGroqUsage(db, 'escalations');
    return { kind: 'fail_closed', escalationText: getFailClosedEscalationText() };
  }

  if (groqResult.kind === 'escalate') {
    await incrementGroqUsage(db, 'escalations');
    return { kind: 'escalate', text: groqResult.text };
  }

  const text = groqResult.text!;
  if (!cacheSkip && isCacheableQuestion(incomingText)) {
    await saveCachedAnswer(db, incomingText, text);
  }

  return { kind: 'reply', text };
}

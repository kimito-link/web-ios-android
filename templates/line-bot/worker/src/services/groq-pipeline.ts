import { lookupCachedAnswer, saveCachedAnswer, isCacheableQuestion } from './llm-cache.js';
import { searchKbArticles, formatKbContext, incrementGroqUsage, isGroqBudgetExceeded } from './kb-search.js';
import { generateGroqReply, buildGroqHistory } from './groq-reply.js';
import { buildSystemPrompt, matchCannedResponse, getFailClosedEscalationText } from './knowledge-pack.js';

export type GroqPipelineResult =
  | { kind: 'canned'; text: string; source: 'canned' | 'cache' }
  | { kind: 'reply'; text: string }
  | { kind: 'escalate'; text?: string }
  | { kind: 'fail_closed'; escalationText: string };

export interface GroqPipelineParams {
  db: D1Database;
  apiKey: string;
  friendId: string;
  incomingText: string;
}

/**
 * Tier1 cache → Tier1.5 canned → Tier2 RAG+Groq pipeline.
 * Fail-closed: 例外やAPIエラー時は必ず escalationText を返す。他プロバイダへのフォールバックはしない
 * （コスト優先の設計方針。line-harness-oss の実戦知見を踏襲）。
 */
export async function runGroqSupportPipeline(params: GroqPipelineParams): Promise<GroqPipelineResult> {
  const { db, apiKey, friendId, incomingText } = params;

  if (await isGroqBudgetExceeded(db)) {
    await incrementGroqUsage(db, 'escalations');
    return { kind: 'fail_closed', escalationText: getFailClosedEscalationText() };
  }

  const cached = await lookupCachedAnswer(db, incomingText);
  if (cached) {
    await incrementGroqUsage(db, 'cache_hits');
    return { kind: 'canned', text: cached, source: 'cache' };
  }

  const canned = matchCannedResponse(incomingText);
  if (canned) {
    if (isCacheableQuestion(incomingText)) {
      await saveCachedAnswer(db, incomingText, canned);
    }
    return { kind: 'canned', text: canned, source: 'canned' };
  }

  const kbHits = await searchKbArticles(db, incomingText);
  const kbContext = formatKbContext(kbHits);
  const systemPrompt = buildSystemPrompt(kbContext);
  const history = await buildGroqHistory(db, friendId);

  await incrementGroqUsage(db, 'groq_calls');

  const groqResult = await generateGroqReply({ apiKey, systemPrompt, messages: history, incomingText });

  if (groqResult.kind === 'fail_closed') {
    await incrementGroqUsage(db, 'escalations');
    return { kind: 'fail_closed', escalationText: getFailClosedEscalationText() };
  }

  if (groqResult.kind === 'escalate') {
    await incrementGroqUsage(db, 'escalations');
    return { kind: 'escalate', text: groqResult.text };
  }

  const text = groqResult.text!;
  if (isCacheableQuestion(incomingText)) {
    await saveCachedAnswer(db, incomingText, text);
  }

  return { kind: 'reply', text };
}

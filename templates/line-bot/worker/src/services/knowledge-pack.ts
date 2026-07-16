import personaMd from '../../../knowledge-pack/persona.md';
import guardrailsMd from '../../../knowledge-pack/guardrails.md';
import greetingTxt from '../../../knowledge-pack/canned/greeting.txt';
import escalationTxt from '../../../knowledge-pack/canned/escalation.txt';

/**
 * knowledge-pack/*.md, canned/*.txt を読み、システムプロンプト・定型応答を組み立てる。
 * persona.md / guardrails.md はキャラの人格・禁止事項。canned/ はキーワード完全一致の定型応答。
 * 新しいアプリを作るときは knowledge-pack/ の中身だけ書き換える（このファイルは無改変）。
 */

const CANNED_RESPONSES: Record<string, string> = {
  こんにちは: greetingTxt,
  はじめまして: greetingTxt,
};

export function buildSystemPrompt(kbContext: string): string {
  const base = `${personaMd}\n\n${guardrailsMd}`;
  if (!kbContext) return base;
  return `${base}\n\n## 参考資料\n${kbContext}`;
}

export function matchCannedResponse(text: string): string | null {
  const trimmed = text.trim();
  return CANNED_RESPONSES[trimmed] ?? null;
}

export function getFailClosedEscalationText(): string {
  return escalationTxt;
}

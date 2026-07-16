import botConfigJson from '../../../bot.config.json';

export interface BotLlmChainStage {
  provider: 'groq' | 'gemini' | 'workers-ai';
  model: string;
  timeoutMs: number;
}

export interface BotLlmConfig {
  provider: 'groq';
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
  dailyCallBudget: number;
  /**
   * 無応答ゼロ化チェーン（2026-07-17 Fable設計、line-harness-oss本体からの移植）。
   * 未指定なら下の getBotConfig() が旧来の単一プロバイダ設定
   * （provider/model/timeoutMs）から1段チェーンを合成するため、既存の
   * bot.config.json をそのまま使っているアプリの後方互換を壊さない。
   */
  chain: BotLlmChainStage[];
}

export interface BotCacheConfig {
  enabled: boolean;
  ttlHours: number;
}

export interface BotRetrievalConfig {
  topK: number;
  minScore: number;
}

export interface BotConfig {
  llm: BotLlmConfig;
  cache: BotCacheConfig;
  retrieval: BotRetrievalConfig;
}

type RawBotLlmConfig = Omit<BotLlmConfig, 'chain'> & { chain?: BotLlmChainStage[] };

type RawBotConfig = {
  llm: RawBotLlmConfig;
  cache?: Partial<BotCacheConfig>;
  retrieval?: Partial<BotRetrievalConfig>;
};

/** Runtime config from bot.config.json (app-specific values live there, not in code). */
export function getBotConfig(): BotConfig {
  const raw = botConfigJson as RawBotConfig;

  // chain 未指定時は、旧来の単一プロバイダ設定(provider/model/timeoutMs)から
  // 1段チェーンを合成する（既存の bot.config.json を壊さないための後方互換）。
  const chain: BotLlmChainStage[] = raw.llm.chain ?? [
    { provider: raw.llm.provider, model: raw.llm.model, timeoutMs: raw.llm.timeoutMs },
  ];

  return {
    llm: { ...raw.llm, chain },
    cache: {
      enabled: raw.cache?.enabled ?? true,
      ttlHours: raw.cache?.ttlHours ?? 72,
    },
    retrieval: {
      topK: raw.retrieval?.topK ?? 3,
      minScore: raw.retrieval?.minScore ?? 0,
    },
  };
}

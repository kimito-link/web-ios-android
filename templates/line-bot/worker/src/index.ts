import { Hono } from 'hono';
import webhook from './routes/webhook.js';

export interface Env {
  Bindings: {
    DB: D1Database;
    LINE_CHANNEL_ACCESS_TOKEN: string;
    LINE_CHANNEL_SECRET: string;
    GROQ_API_KEY: string;
    // 無応答ゼロ化チェーンの2番手(services/llm-chain.ts)。未設定ならGemini段は
    // 静かにスキップされる。2026-07-17 Fable設計「無応答ゼロ化アーキテクチャ」。
    GEMINI_API_KEY?: string;
    // 無応答チェーンの3番手（Worker内バインディング。外部egressが無く障害
    // ドメインが独立）。wrangler.tomlの[ai] bindingで注入される。
    AI?: Ai;
  };
}

const app = new Hono<Env>();

app.get('/', (c) => c.text('ok'));
app.route('/', webhook);

export default app;

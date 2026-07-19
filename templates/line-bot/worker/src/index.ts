import { Hono } from 'hono';
import webhook from './routes/webhook.js';
import images from './routes/images.js';

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
    // 画像・動画・音声認識機能（2026-07-17/19追加、line-harness-oss本体からの移植）。
    // 受信メディアの保存とdescribe用公開URLの発行に使う。wrangler.tomlの
    // [[r2_buckets]] bindingで注入される。未設定ならメディア認識は静かにスキップされる。
    IMAGES?: R2Bucket;
    WORKER_URL?: string;
  };
}

const app = new Hono<Env>();

app.get('/', (c) => c.text('ok'));
app.route('/', webhook);
app.route('/', images);

export default app;

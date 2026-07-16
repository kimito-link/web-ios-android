import { Hono } from 'hono';
import webhook from './routes/webhook.js';

export interface Env {
  Bindings: {
    DB: D1Database;
    LINE_CHANNEL_ACCESS_TOKEN: string;
    LINE_CHANNEL_SECRET: string;
    GROQ_API_KEY: string;
  };
}

const app = new Hono<Env>();

app.get('/', (c) => c.text('ok'));
app.route('/', webhook);

export default app;

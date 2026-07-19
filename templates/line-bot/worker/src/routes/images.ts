import { Hono } from 'hono';
import type { Env } from '../index.js';

const images = new Hono<Env>();

// GET /images/:key — 受信画像・動画・音声の配信（公開、認証なし）。
// incoming-image.ts/incoming-media.tsが保存したオブジェクトを、visionモデルの
// 公開URLフォールバック用・ユーザーへの折り返し表示用に配信する
// （line-harness-oss本体からの移植）。
images.get('/images/:key', async (c) => {
  if (!c.env.IMAGES) return c.json({ success: false, error: 'not_configured' }, 503);
  const key = c.req.param('key');
  const object = await c.env.IMAGES.get(key);

  if (!object) {
    return c.json({ success: false, error: 'not_found' }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.etag);

  return new Response(object.body, { headers });
});

export default images;

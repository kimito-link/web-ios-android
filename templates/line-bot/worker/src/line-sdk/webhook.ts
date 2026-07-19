/**
 * Verifies the X-Line-Signature header using HMAC-SHA256.
 * Must be called before processing any webhook event.
 */
export async function verifySignature(
  channelSecret: string,
  body: string,
  signature: string,
): Promise<boolean> {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(body));

  const bytes = new Uint8Array(signatureBytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const computedBase64 = btoa(binary);

  return computedBase64 === signature;
}

export interface WebhookEvent {
  type: string;
  replyToken?: string;
  source: { type: string; userId?: string };
  // idはLINE Content API（画像・動画・音声のバイナリ取得）に必須（2026-07-17/19追加）。
  message?: { type: string; text?: string; id?: string };
}

export interface WebhookRequestBody {
  events: WebhookEvent[];
}

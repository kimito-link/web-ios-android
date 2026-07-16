const LINE_API_BASE = 'https://api.line.me';

export interface UserProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
}

export interface TextMessage {
  type: 'text';
  text: string;
}

/** LINE Messaging API の最小クライアント（reply/push/profile取得のみ）。 */
export class LineClient {
  constructor(private readonly channelAccessToken: string) {}

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${LINE_API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.channelAccessToken}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LINE API error: ${res.status} ${res.statusText} — ${text}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    return contentType.includes('application/json') ? res.json() : undefined;
  }

  async getProfile(userId: string): Promise<UserProfile> {
    return this.request('GET', `/v2/bot/profile/${encodeURIComponent(userId)}`) as Promise<UserProfile>;
  }

  async replyMessage(replyToken: string, messages: TextMessage[]): Promise<void> {
    await this.request('POST', '/v2/bot/message/reply', { replyToken, messages });
  }

  async pushTextMessage(to: string, text: string): Promise<void> {
    await this.request('POST', '/v2/bot/message/push', { to, messages: [{ type: 'text', text }] });
  }
}

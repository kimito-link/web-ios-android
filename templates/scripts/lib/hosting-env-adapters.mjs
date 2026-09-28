// hosting-env-adapters.mjs — Clerk等の共有鍵を配布先ホスティングへ書き込む
// アダプタ群（vercel / render / static）。distribute-clerk-keys.mjs から呼ばれる。
//
// 各アダプタは共通インターフェース { probe, write, verify } を実装する:
//   - probe(): 現在の登録状況を読む(副作用なし)。{ ok, exists, error } を返す
//   - write(key, value): 環境変数を書き込む(--applyのときだけ呼ばれる)。{ ok, error } を返す
//   - verify(key, expectedPrefix): 書き込み後、実際に登録されているかを読み直して
//     先頭一致で確認する(第1層検証)。実値そのものは返さない/ログに出さない
//
// ★秘密値の扱い(clerk-key-distribution-SPEC.md C節): このモジュールはMCP経由ではなく
//   各サービスの公式REST APIをNode fetchで直接叩く。値はこのプロセス内の変数として
//   しか扱われず、AIセッションのトランスクリプトには乗らない
//   (CLAUDE.md「★★『認証トークン』と『投入する秘密値』は別物」節と同型の配慮)。
//
// ★Render特有の地雷(2026-09-28、公式ドキュメントで確認): `PUT /services/{id}/env-vars`は
//   「リクエストに含まれない環境変数は削除される」設計。他の環境変数を巻き込んで消さない
//   よう、write()は必ず事前にGETで既存一覧を取得し、対象キーだけをマージしてPUTする。
//   これを飛ばすと「Clerk鍵を配ったら他の環境変数が全部消えた」という重大事故になる。

/**
 * @typedef {{ ok: boolean, exists?: boolean, value?: string, error?: string }} ProbeOutcome
 * @typedef {{ ok: boolean, error?: string }} WriteOutcome
 * @typedef {{ ok: boolean, matched?: boolean, error?: string }} VerifyOutcome
 */

/**
 * fetchの薄いラッパー。タイムアウトと共通エラー整形のみ担当。
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} [timeoutMs]
 */
async function fetchJson(url, init, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* JSONでない応答 */ }
    return { status: res.status, ok: res.ok, json, text };
  } finally {
    clearTimeout(timer);
  }
}

// ── Render ──────────────────────────────────────────────────────────

/**
 * @param {{ serviceId: string, token: string }} opts
 */
export function renderAdapter({ serviceId, token }) {
  const base = `https://api.render.com/v1/services/${serviceId}/env-vars`;
  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  /** 既存の環境変数一覧を全ページ取得する(ページネーション対応)。 */
  async function listAll() {
    const items = [];
    let cursor = '';
    for (let page = 0; page < 20; page++) {
      const url = cursor ? `${base}?cursor=${encodeURIComponent(cursor)}&limit=100` : `${base}?limit=100`;
      const res = await fetchJson(url, { headers: authHeaders });
      if (!res.ok) return { ok: false, error: `GET ${res.status}: ${res.text?.slice(0, 200)}` };
      const rows = Array.isArray(res.json) ? res.json : [];
      for (const row of rows) {
        if (row?.envVar?.key) items.push(row.envVar);
      }
      if (rows.length < 100) break;
      cursor = rows[rows.length - 1]?.cursor || '';
      if (!cursor) break;
    }
    return { ok: true, items };
  }

  return {
    async probe(key) {
      const r = await listAll();
      if (!r.ok) return { ok: false, error: r.error };
      const found = r.items.find((e) => e.key === key);
      return { ok: true, exists: !!found, value: found?.value };
    },

    async write(key, value) {
      // ★地雷対策: PUTは配列に含まれない既存キーを削除する。必ず既存一覧を
      //   先に取得し、対象キーだけ上書き/追加してPUTする(他のenvを巻き込まない)。
      const existing = await listAll();
      if (!existing.ok) return { ok: false, error: `既存一覧の取得に失敗: ${existing.error}` };
      const merged = existing.items.filter((e) => e.key !== key);
      merged.push({ key, value });
      const res = await fetchJson(base, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(merged),
      });
      if (!res.ok) return { ok: false, error: `PUT ${res.status}: ${res.text?.slice(0, 200)}` };
      return { ok: true };
    },

    async verify(key, expectedPrefix) {
      const r = await this.probe(key);
      if (!r.ok) return { ok: false, error: r.error };
      if (!r.exists) return { ok: true, matched: false };
      if (!expectedPrefix) return { ok: true, matched: true };
      return { ok: true, matched: typeof r.value === 'string' && r.value.startsWith(expectedPrefix) };
    },
  };
}

// ── Vercel ──────────────────────────────────────────────────────────

/**
 * @param {{ projectId: string, token: string, teamId?: string, environment?: 'production'|'preview'|'development' }} opts
 */
export function vercelAdapter({ projectId, token, teamId, environment = 'production' }) {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  const listUrl = `https://api.vercel.com/v9/projects/${projectId}/env${qs}`;
  const createUrl = `https://api.vercel.com/v10/projects/${projectId}/env${qs}${qs ? '&' : '?'}upsert=true`;
  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  return {
    async probe(key) {
      const res = await fetchJson(listUrl, { headers: authHeaders });
      if (!res.ok) return { ok: false, error: `GET ${res.status}: ${res.text?.slice(0, 200)}` };
      const envs = Array.isArray(res.json?.envs) ? res.json.envs : [];
      const found = envs.find((e) => e.key === key && (e.target || []).includes(environment));
      // ★Vercelは読み取りAPIでも値を復号して返さない設計(decrypted: falseのまま)。
      //   登録有無だけをここで返し、値の中身が要る検証はverify()側でも同じ制約を受ける。
      return { ok: true, exists: !!found };
    },

    async write(key, value) {
      const res = await fetchJson(createUrl, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ key, value, type: 'encrypted', target: [environment] }),
      });
      if (!res.ok) return { ok: false, error: `POST ${res.status}: ${res.text?.slice(0, 200)}` };
      return { ok: true };
    },

    async verify(key) {
      // ★Vercelは暗号化済み環境変数の値を平文で返さない(decrypted: false)ため、
      //   expectedPrefixでの先頭一致検証はできない。登録有無の確認までが限界
      //   (この限界はclerk-key-distribution-SPEC.md D節・instrument-coreの
      //   limitationフィールドで明示する)。
      const r = await this.probe(key);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, matched: r.exists };
    },
  };
}

// ── static（配布対象外） ────────────────────────────────────────────

/**
 * 静的サイト(公開鍵をビルド時埋め込みするタイプ)向けのno-opアダプタ。
 * clerk-key-distribution-MAP.md 未確定点3・SPEC.md C節で「対象外」と確定済み。
 */
export function staticAdapter() {
  return {
    async probe() {
      return { ok: true, exists: false, error: '静的サイトはビルド時埋め込みのため配布対象外(no-op)' };
    },
    async write() {
      return { ok: true, error: '静的サイトは配布対象外のため書き込みをスキップした(no-op)' };
    },
    async verify() {
      return { ok: true, matched: true, error: '静的サイトは配布対象外のため検証をスキップした(no-op)' };
    },
  };
}

/**
 * siblingServices[].hosting.provider からアダプタを選択する。
 * @param {{ provider: string, vercelProjectId?: string, renderServiceId?: string, environment?: string }} hosting
 * @param {{ vercelToken?: string, renderToken?: string, vercelTeamId?: string }} creds
 */
export function selectAdapter(hosting, creds) {
  switch (hosting?.provider) {
    case 'render':
      if (!hosting.renderServiceId) throw new Error('hosting.renderServiceId が未設定です');
      if (!creds.renderToken) throw new Error('Renderの認証トークンが未設定です(環境変数等で渡してください)');
      return renderAdapter({ serviceId: hosting.renderServiceId, token: creds.renderToken });
    case 'vercel':
      if (!hosting.vercelProjectId) throw new Error('hosting.vercelProjectId が未設定です');
      if (!creds.vercelToken) throw new Error('Vercelの認証トークンが未設定です(環境変数等で渡してください)');
      return vercelAdapter({
        projectId: hosting.vercelProjectId,
        token: creds.vercelToken,
        teamId: creds.vercelTeamId,
        environment: hosting.environment || 'production',
      });
    case 'static':
      return staticAdapter();
    default:
      throw new Error(`未知のhosting.provider: ${hosting?.provider}`);
  }
}

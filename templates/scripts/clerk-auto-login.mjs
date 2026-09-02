#!/usr/bin/env node
/**
 * clerk-auto-login.mjs
 *
 * ★人の手を使わずに「ログイン済みの状態」を作る。
 *
 * これが無いと、録画・E2E・スクショ撮影のたびに
 *   人がブラウザを開いて X/Google でログインする
 * という工程が挟まる。CI でも回せず、夜間バッチにもできない。
 *
 * ── 何ができるか ────────────────────────────────────
 *
 *   import { autoLogin } from "./clerk-auto-login.mjs";
 *   await page.goto(BASE);          // 認証不要のページでよい
 *   const { user } = await autoLogin(page);
 *   // → 以降、そのユーザーとしてログイン済み
 *
 *   headless で動く。patchright も永続プロファイルも要らない。
 *
 * ── 仕組み ────────────────────────────────────────
 *
 * Clerk の Backend API で「サインイン用トークン（sign-in token）」を発行し、
 * ブラウザ側で `signIn.create({ strategy: "ticket", ticket })` に渡す。
 * 認証情報（パスワード・OAuth の往復）を一切使わずにセッションが張れる。
 *
 *   1. POST /v1/sign_in_tokens { user_id }              （サーバー側）
 *   2. window.Clerk.client.signIn.create({ strategy:"ticket", ticket })
 *   3. window.Clerk.setActive({ session: createdSessionId })
 *
 * ★実測（2026-09-02・doin-challenge.com の本番）:
 *     signIn結果: { ok: true, status: "complete" }
 *     ログイン後: window.Clerk.user が入り「Xでログイン」が消えた
 *
 * ── なぜ公式の @clerk/testing ではないか ──────────────
 *
 * @clerk/testing の clerk.signIn() は identifier（メールアドレス）で
 * ユーザーを指す設計。★**X/Apple ログインのユーザーにはメールアドレスが無い**
 * ことがあり（実測）、その場合は使えない。
 *
 *     id=user_xxx  email=(無し)  外部連携=oauth_x  パスワード=false
 *
 * user_id で直接指せる sign-in token 方式なら、メールもパスワードも要らない。
 * 依存パッケージも増えない（fetch だけ）。
 *
 * ── 使う前に ──────────────────────────────────────
 *
 *   .env.local に CLERK_SECRET_KEY が要る（Clerk Dashboard の Secret Key）。
 *   ★DEMO_X_USERNAME を、このアプリの公式アカウントに書き換えること。
 *
 * ── ★安全のための約束（必ず守る）──────────────────────
 *
 * CLERK_SECRET_KEY はユーザーを作れる強い鍵。このモジュールは:
 *   - 読み取りとトークン発行しかしない。ユーザーを作らない・消さない
 *   - トークンの寿命は既定10分（Clerkの既定は30日。長く残さない）
 *   - トークンの値をログに出さない
 *   - ★実在の利用者を勝手に使わない（下の pickUser のコメント参照。事故あり）
 */
import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(ROOT, ".env.local") });

const CLERK_API = "https://api.clerk.com/v1";

/**
 * デモ・録画に使う X アカウント。
 * ★このサービスの**公式アカウント**の username を入れる。
 *   実在の一般利用者を巻き込まないため、ここを既定にする。
 */
const DEMO_X_USERNAME = "CHANGE_ME";  // ★このアプリの公式アカウントの username に変える

/**
 * 環境変数の値を正規化する。
 * ★この案件では .env の値にクォートと \r\n が混入していた実績がある。
 *   そのまま Authorization ヘッダに入れると 401 になり、原因が分かりにくい。
 */
function cleanKey(v) {
  return String(v ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\r\\n|\\n|\\r/g, "")
    .replace(/[\r\n]/g, "")
    .trim();
}

export function getSecretKey() {
  const key = cleanKey(process.env.CLERK_SECRET_KEY);
  if (!key) {
    throw new Error(
      "CLERK_SECRET_KEY が無い。.env.local に設定してください（値はコミットしないこと）"
    );
  }
  return key;
}

async function clerkFetch(path, init = {}) {
  const res = await fetch(`${CLERK_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Clerk API ${path} が ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * 録画・検証に使うユーザーを1人選ぶ。
 *
 * ★★ 実在の利用者を勝手に選ばない。★★
 *
 *   2026-09-02、ここで「最新の oauth_x ユーザー」を自動で選ぶ実装にしたところ、
 *   **実在の他人のアカウントとしてログインし、その人の表示名で録画してしまった**
 *   （韓国語の表示名がデモ動画に写り込み、作者の指摘で発覚）。
 *
 *   これは単なる見た目の問題ではない:
 *     - 他人のアカウントに成り代わってセッションを張っている
 *     - その人の名前・アイコンが動画に残り、外部に出れば個人情報の流出になる
 *     - 録画の副作用（既読・通知・履歴）がその人のデータに書き込まれうる
 *
 *   → **明示的にデモ用と分かるユーザーだけ**を対象にする。
 *     該当が無ければ止まる。勝手に代役を立てない。
 *
 * @param {object} opts
 * @param {string} [opts.userId]  使うユーザーを明示（最優先）。自分のアカウント等
 * @param {boolean} [opts.allowAnyUser]  ★既定 false。true にすると実在ユーザーからも選ぶ。
 *                                       他人が写ってよい場面でしか使わないこと
 */
export async function pickUser({ userId, allowAnyUser = false } = {}) {
  if (userId) {
    return clerkFetch(`/users/${userId}`);
  }

  const users = await clerkFetch(`/users?limit=100&order_by=-created_at`);

  // ★このサービスの公式アカウントを最優先で使う（作者の指定・2026-09-02）。
  //   デモに写っても自然で、外部に見せても問題がない。
  //   ここを決め打ちにしておかないと「その時いちばん新しい人」が選ばれ、
  //   実在の利用者を巻き込む（実際に一度やってしまった）。
  const official = users.find((u) =>
    (u.external_accounts ?? []).some((a) => a.username === DEMO_X_USERNAME)
  );
  if (official) return official;

  // デモ用と明示されたユーザーだけを拾う。
  // username / 氏名 / メールのどれかに demo・test・e2e が入っているもの。
  const isDemoUser = (u) => {
    const hay = [
      u.username,
      u.first_name,
      u.last_name,
      ...(u.email_addresses ?? []).map((e) => e.email_address),
      ...(u.public_metadata ? [JSON.stringify(u.public_metadata)] : []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return /(demo|test|e2e|sample|dummy)/.test(hay) || hay.includes("デモ");
  };

  const demo = users.find(isDemoUser);
  if (demo) return demo;

  if (!allowAnyUser) {
    throw new Error(
      [
        "デモ用ユーザーが見つからない。★実在の利用者を勝手には使いません。",
        "",
        "  次のどれかをしてください:",
        "    a) --user-id user_xxx で、自分のアカウントを明示する",
        "    b) username に demo / test を含むユーザーを1つ作る",
        "",
        "  （他人のアカウントで録ると、その人の名前とアイコンが動画に残ります）",
      ].join("\n")
    );
  }

  const any = users[0];
  if (!any) throw new Error("ユーザーが1人もいない");
  console.warn(
    "[warn] ★実在の利用者を使っています。名前やアイコンが写ります: " + describeUser(any)
  );
  return any;
}

/** 人が読める名前（ログ用）。X ユーザーはメールが無いので username を優先する。 */
export function describeUser(u) {
  const name =
    u.username ||
    [u.first_name, u.last_name].filter(Boolean).join(" ") ||
    u.email_addresses?.[0]?.email_address ||
    "(名前なし)";
  const providers = (u.external_accounts ?? []).map((a) => a.provider).join(",") || "なし";
  return `${name} (${u.id.slice(0, 14)}… / 連携=${providers})`;
}

/**
 * サインイン用トークンを発行する。
 * ★既定の寿命は10分。既定値(30日)のまま長く残さない。
 */
export async function createSignInToken(userId, expiresInSeconds = 600) {
  const t = await clerkFetch("/sign_in_tokens", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, expires_in_seconds: expiresInSeconds }),
  });
  return t.token;
}

/**
 * 開いているページを、そのユーザーとしてログインさせる。
 *
 * ★呼ぶ前に、アプリのページを開いておくこと（window.Clerk が要る）。
 *   認証が要らないページでよい。
 *
 * @returns {Promise<{userId:string, username:string|null}>} ログイン後の状態
 */
export async function signInWithTicket(page, ticket, { timeout = 30_000 } = {}) {
  await page.waitForFunction(() => !!window.Clerk, { timeout }).catch(() => {
    throw new Error("window.Clerk が現れない。アプリのページを開いてから呼ぶこと");
  });

  const result = await page.evaluate(async (t) => {
    try {
      if (!window.Clerk.loaded) await window.Clerk.load();
      const si = await window.Clerk.client.signIn.create({ strategy: "ticket", ticket: t });
      if (si.status !== "complete") return { ok: false, status: si.status };
      await window.Clerk.setActive({ session: si.createdSessionId });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 300) };
    }
  }, ticket);

  if (!result.ok) {
    throw new Error(
      `ticket でのサインインに失敗: ${result.error ?? `status=${result.status}`}`
    );
  }

  // ★「呼べた」ではなく「ログインできている」ことを確かめてから返す。
  //   この案件では過去に、判定を間接シグナルに頼って偽陽性を出した事故がある。
  //   window.Clerk.user が入っているかどうかは中間状態が無く、確実。
  await page.waitForFunction(() => !!window.Clerk?.user, { timeout: 15_000 }).catch(() => {
    throw new Error("サインインは通ったが window.Clerk.user が入らない");
  });

  return page.evaluate(() => ({
    userId: window.Clerk.user.id,
    username: window.Clerk.user.username ?? null,
  }));
}

/**
 * 一括: ユーザーを選び、トークンを発行し、ページをログイン状態にする。
 * 呼ぶ側はこれ1つでよい。
 */
export async function autoLogin(page, opts = {}) {
  const user = await pickUser(opts);
  const ticket = await createSignInToken(user.id, opts.expiresInSeconds);
  const state = await signInWithTicket(page, ticket);
  return { user, state };
}

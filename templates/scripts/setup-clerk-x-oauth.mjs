#!/usr/bin/env node
/**
 * setup-clerk-x-oauth.mjs
 *
 * Clerk + X(Twitter) OAuth セットアップ補助スクリプト
 *
 * やること:
 *   1. app.config.json から設定値を読んでチェックリストを表示
 *   2. --write-env フラグで .env.local に必要キーのひな形を書き込む
 *   3. --write-vercel フラグで Vercel 環境変数を一括登録 (vercel env add)
 *
 * 使い方:
 *   # プロジェクトルートで実行
 *   node templates/scripts/setup-clerk-x-oauth.mjs
 *   node templates/scripts/setup-clerk-x-oauth.mjs --write-env
 *   node templates/scripts/setup-clerk-x-oauth.mjs --write-vercel
 *
 * 前提:
 *   - app.config.json に auth.clerkCustomDomain と auth.xCallbackUrl が設定済み
 *   - .env.local に CLERK_SECRET_KEY, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY などが設定済み
 *     (--write-env は未記入の行のひな形だけを追記する)
 *   - Vercel CLI (vercel) が PATH に入っていること (--write-vercel 時のみ)
 *
 * ============================================================
 * 【X Developer Portal で必要な手作業】
 *   https://developer.twitter.com/en/portal/dashboard
 *   → 該当アプリ → Settings → User authentication settings
 *   → Callback URI / Redirect URL に auth.xCallbackUrl の値を追加
 *
 * 【Clerk Dashboard で必要な手作業】
 *   https://dashboard.clerk.com → Configure → SSO connections → X(Twitter)
 *   → Client ID / Client Secret を入力
 *   → Scopes: users.read, tweet.read, offline.access のみ (tweet.write は絶対NG)
 * ============================================================
 */

import { readFileSync, existsSync, appendFileSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const WRITE_ENV = args.includes("--write-env");
const WRITE_VERCEL = args.includes("--write-vercel");

// ── カラーユーティリティ ──────────────────────────
const c = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};
const ok = (msg) => console.log(`${c.green}✅ ${msg}${c.reset}`);
const warn = (msg) => console.log(`${c.yellow}⚠️  ${msg}${c.reset}`);
const err = (msg) => console.log(`${c.red}❌ ${msg}${c.reset}`);
const info = (msg) => console.log(`${c.cyan}ℹ️  ${msg}${c.reset}`);
const title = (msg) => console.log(`\n${c.bold}${msg}${c.reset}`);

// ── app.config.json を読む ─────────────────────────
const configPath = resolve(process.cwd(), "app.config.json");
if (!existsSync(configPath)) {
  err("app.config.json が見つかりません。プロジェクトルートで実行してください。");
  process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, "utf8"));
const auth = config.auth ?? {};
const identity = config.identity ?? {};
const domain = identity.productionDomain ?? "";

// ── ブランドプリセットを解決する ─────────────────
// auth.brandPreset があれば templates/auth/brands/<brand>.json を読み、
// 個別キー(clerkCustomDomain / xCallbackUrl / requiredXScopes)が未設定なら
// プリセット値で補完する。app.config.json 側の明示値が常に優先。
let preset = null;
const presetName = auth.brandPreset ?? "";
if (presetName) {
  // このスクリプトは templates/scripts/ に置かれるが、プロジェクトに丸ごと
  // コピーされる場合もある。両方を探索する。
  const presetCandidates = [
    resolve(__dirname, "..", "auth", "brands", `${presetName}.json`),
    resolve(process.cwd(), "templates", "auth", "brands", `${presetName}.json`),
    resolve(process.cwd(), "auth", "brands", `${presetName}.json`),
  ];
  const presetPath = presetCandidates.find((p) => existsSync(p));
  if (presetPath) {
    preset = JSON.parse(readFileSync(presetPath, "utf8"));
  }
}

// ── 方式 A(インスタンス共有) / B(各アプリ独立) を判定 ──
// app.config.json の auth.shareInstanceAcrossApps が最優先、無ければプリセット値。
const shareInstance =
  auth.shareInstanceAcrossApps ?? preset?.clerk?.shareInstanceAcrossApps ?? false;
const MODE = shareInstance ? "A" : "B";

// プリセット由来の Clerk ドメイン / scope を解決(個別指定が優先)
// 方式A: ブランド共有インスタンスのドメイン(親=preset.clerk.customDomain)を必ず使う。
//        各アプリ固有の clerkCustomDomain は無視する(全アプリが同じインスタンスだから)。
// 方式B: アプリ固有の clerkCustomDomain を優先。
const resolvedClerkDomain =
  MODE === "A"
    ? preset?.clerk?.customDomain || auth.clerkCustomDomain || ""
    : auth.clerkCustomDomain || preset?.clerk?.customDomain || "";
const callbackTemplate =
  preset?.callbackUrlTemplate || "https://{clerkDomain}/v1/oauth_callback";
// 方式A: Callback も共有インスタンスのドメイン(resolvedClerkDomain)で統一する。
//        アプリ固有の auth.xCallbackUrl は方式Bでのみ尊重する。
const resolvedCallbackUrl =
  MODE === "A"
    ? callbackTemplate.replace("{clerkDomain}", resolvedClerkDomain)
    : auth.xCallbackUrl ||
      (resolvedClerkDomain
        ? callbackTemplate.replace("{clerkDomain}", resolvedClerkDomain)
        : "");
const resolvedScopes =
  (auth.requiredXScopes && auth.requiredXScopes.length
    ? auth.requiredXScopes
    : preset?.xOAuth?.requiredScopes) ?? [];
const forbiddenScopes = preset?.xOAuth?.forbiddenScopes ?? ["tweet.write"];

// 方式A で各アプリが受け取るブランド共有鍵の env 名
const sharedPubKeyEnv = preset?.clerk?.sharedInstancePublishableKeyEnv ?? "";
const sharedSecretKeyEnv = preset?.clerk?.sharedInstanceSecretKeyEnv ?? "";

title("━━━ Clerk + X OAuth セットアップチェッカー ━━━");
info(`対象アプリ: ${identity.displayName ?? "(未設定)"}`);
info(`本番ドメイン: ${domain || "(未設定)"}`);
if (presetName) {
  if (preset) {
    ok(`ブランドプリセット: ${presetName} (${preset.displayName ?? presetName}) を読み込みました`);
  } else {
    err(
      `ブランドプリセット "${presetName}" が見つかりません。\n` +
      `   → templates/auth/brands/${presetName}.json を作成してください(手本: kimito-link.json)。`
    );
  }
}
if (MODE === "A") {
  ok(
    `認証方式: A (Clerk インスタンス共有)\n` +
    `   → このアプリは ${preset?.displayName ?? presetName ?? "ブランド"} の Clerk(${resolvedClerkDomain})・ユーザーDB を共有します。\n` +
    `   → 自前の pk_live は作らず、共有鍵(${sharedPubKeyEnv || "未設定"})を使います。`
  );
} else {
  ok(
    `認証方式: B (各アプリ独立)\n` +
    `   → このアプリは独自の Clerk インスタンスを持ち、X アプリ(Client ID/Secret)だけ共有します。`
  );
}

// ── 1. auth ブロックの存在確認 ────────────────────
title("【1】app.config.json — auth ブロック");

if (!auth.provider) {
  err("auth.provider が未設定です。app.config.json に auth ブロックを追加してください。");
} else {
  ok(`provider: ${auth.provider}`);
}

const clerkDomain = resolvedClerkDomain;
if (!clerkDomain) {
  warn(
    "Clerk カスタムドメインが未解決です(auth.clerkCustomDomain もプリセットも空)。\n" +
    "   → Clerk Dashboard > Domains > Add domain で\n" +
    `   → clerk.${domain} を設定してから app.config.json の auth.clerkCustomDomain に書く\n` +
    "   → またはブランドプリセット(auth.brandPreset)を使う。\n" +
    "   → 本番デプロイ前に必須です。"
  );
} else {
  ok(`Clerk カスタムドメイン: ${clerkDomain}`);
}

const callbackUrl = resolvedCallbackUrl;
if (!callbackUrl) {
  warn("X Callback URL が未解決です。auth.xCallbackUrl かプリセット+clerkCustomDomain を設定してください。");
} else {
  ok(`X Callback URL(本番): ${callbackUrl}`);
}

const scopes = resolvedScopes;
const violatingScopes = scopes.filter((s) => forbiddenScopes.includes(s));
if (violatingScopes.length > 0) {
  err(
    `requiredXScopes に禁止スコープ(${violatingScopes.join(", ")})が含まれています！\n` +
    "   → Clerk Dashboard の X SSO connections → Scopes から外してください。\n" +
    "   → これが残ると X の authorize 画面でループします（kimito.link で実証済みの罠）。"
  );
} else {
  ok(`X Scopes: ${scopes.join(", ") || "(空=Clerkデフォルト)"} ｜ 禁止: ${forbiddenScopes.join(", ")}`);
}

// ── 2. .env.local の確認 ──────────────────────────
title("【2】.env.local — 環境変数");

const envPath = resolve(process.cwd(), ".env.local");
const envExists = existsSync(envPath);
let envContent = envExists ? readFileSync(envPath, "utf8") : "";

const requiredEnvKeys = [
  "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
];

// Expo Router か Next.js かを判定
const isNext = existsSync(resolve(process.cwd(), "next.config.js")) ||
               existsSync(resolve(process.cwd(), "next.config.mjs")) ||
               existsSync(resolve(process.cwd(), "next.config.ts"));

if (isNext) {
  // Next.js 用キー名に差し替え
  requiredEnvKeys.length = 0;
  requiredEnvKeys.push(
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
    "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
    "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
    "NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL",
    "NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL",
    "NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL",
    "NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL",
  );
}

const missingKeys = [];
for (const key of requiredEnvKeys) {
  const hasKey = envContent.includes(`${key}=`);
  if (hasKey) {
    const line = envContent.split("\n").find((l) => l.startsWith(`${key}=`));
    const val = line?.split("=").slice(1).join("=").trim();
    if (!val || val === "..." || val.includes("<")) {
      warn(`${key} は存在しますが値が空かプレースホルダーです`);
      missingKeys.push(key);
    } else {
      ok(`${key} = ✓`);
    }
  } else {
    err(`${key} が .env.local に見つかりません`);
    missingKeys.push(key);
  }
}

// 方式A: 公開鍵/秘密鍵にはブランド共有インスタンスの pk_live/sk_live を入れる
if (MODE === "A") {
  const pubKeyName = requiredEnvKeys.find((k) => /PUBLISHABLE_KEY/.test(k));
  const pubLine = envContent.split("\n").find((l) => l.startsWith(`${pubKeyName}=`));
  const pubVal = pubLine?.split("=").slice(1).join("=").trim() ?? "";
  if (pubVal && pubVal.startsWith("pk_test_")) {
    warn(
      `方式A なのに ${pubKeyName} が pk_test_(開発鍵)です。\n` +
      `   → 方式A は ${preset?.displayName ?? "ブランド"} の Clerk 本番インスタンスを共有します。\n` +
      `   → 共有鍵 ${sharedPubKeyEnv || "(プリセット未設定)"} の pk_live_ を ${pubKeyName} に入れてください。\n` +
      `   → 本番鍵は ${resolvedClerkDomain} の Clerk Dashboard > API keys から取得。`
    );
  } else if (pubVal && pubVal.startsWith("pk_live_")) {
    ok(`方式A: ${pubKeyName} は pk_live_(本番共有鍵)です ✓`);
  }
  info(
    `方式A の鍵の入手元: 共有 env ${sharedPubKeyEnv || "(未設定)"} / ${sharedSecretKeyEnv || "(未設定)"}\n` +
    `   → ブランド管理者が一度 pk_live_/sk_live_ を配布すれば、各アプリは同じ値を使う。`
  );
}

// --write-env: 不足キーをひな形として追記
if (WRITE_ENV && missingKeys.length > 0) {
  title("【2b】.env.local にひな形を追記します...");
  const lines = [
    "",
    "# ── Clerk + X OAuth (setup-clerk-x-oauth.mjs が追記) ──",
  ];
  for (const key of missingKeys) {
    lines.push(`${key}=`);
  }
  appendFileSync(envPath, lines.join("\n") + "\n");
  ok(".env.local に追記しました。値を Clerk Dashboard からコピーして入力してください。");
} else if (missingKeys.length > 0) {
  info("--write-env フラグで .env.local へのひな形追記ができます");
}

// ── 開発インスタンスの Callback を publishable key から推定 ──
// Clerk の pk_test_ は base64(<instance-domain>$) を含む。デコードすると
// complete-bullfrog-23.clerk.accounts.dev のような開発ドメインが得られる。
// 開発環境でログインを試すと X にはこのドメインの Callback が渡るため、
// X Developer Portal に一時登録しないと「アクセスを許可できません」で弾かれる
// (今回のセッションで実証した罠)。
function devCallbackFromPublishableKey(content) {
  const line = content
    .split("\n")
    .find((l) => /CLERK_PUBLISHABLE_KEY=/.test(l) && l.includes("pk_test_"));
  if (!line) return "";
  const val = line.split("=").slice(1).join("=").trim();
  const b64 = val.replace(/^pk_test_/, "");
  try {
    const decoded = Buffer.from(b64, "base64").toString("utf8").replace(/\$$/, "");
    if (decoded.endsWith(".clerk.accounts.dev")) {
      return `https://${decoded}/v1/oauth_callback`;
    }
  } catch {
    /* デコード不能なら無視 */
  }
  return "";
}
const devCallbackUrl = devCallbackFromPublishableKey(envContent);

// ── 3. X Developer Portal 手作業チェックリスト ───
title("【3】X Developer Portal — 手作業チェックリスト");
if (MODE === "A") {
  // 方式A: 全アプリが同じ Clerk インスタンスを使うので、Callback は親ドメイン1個だけ。
  // それは既にブランド初回設定で登録済み。新アプリ追加時に X 側でやることは無い。
  console.log(`
  URL: https://developer.twitter.com/en/portal/dashboard

  ✅ 方式A(インスタンス共有)では、X 側で新たにやることは基本ありません。
     全アプリが同じ Clerk(${resolvedClerkDomain})を通るため、Callback は1個で足ります:
        ${callbackUrl || `https://clerk.${domain}/v1/oauth_callback`}
     これはブランド初回設定で登録済みのはず。開発用 accounts.dev Callback も不要。

  □ (初回のみ) 上記 Callback が X Developer Portal に登録されているか確認
  □ (初回のみ) App permissions: Read / Scopes に ${forbiddenScopes.join("・")} が無いこと
  □ 2個目以降のアプリでは X 側の作業なし → 【4】【5】へ進む
`);
} else {
  console.log(`
  URL: https://developer.twitter.com/en/portal/dashboard

  □ 対象アプリを選択 → Settings → User authentication settings
  □ App permissions: Read (tweet.write は付けない)
  □ Type of App: Web App, Automated App or Bot
  □ Callback URI / Redirect URL に以下を「すべて」追加 (1字でも違うと弾かれる):
      [本番]   ${callbackUrl || `https://clerk.${domain}/v1/oauth_callback`}${
        devCallbackUrl
          ? `\n      [開発]   ${devCallbackUrl}\n               ↑ pk_test_ でローカル検証する間だけ必要。本番のみなら不要。`
          : "\n      [開発]   https://<開発インスタンス>.clerk.accounts.dev/v1/oauth_callback\n               ↑ pk_test_ でローカル検証する場合のみ。本番のみなら不要。"
      }
  □ Website URL: https://${domain}
  □ Terms of service URL: ${config.contact?.termsUrl ?? `https://${domain}/terms`}
  □ Privacy policy URL: ${config.contact?.privacyUrl ?? `https://${domain}/privacy`}
  □ Save → Client ID と Client Secret をコピーしておく${
    preset?.xOAuth?.sharedApp
      ? `\n\n  ※ このブランド(${preset.displayName ?? presetName})は X アプリを共有します。\n     既存の Kimito ブランド用 X アプリに上記 Callback を「追加」するだけ。\n     新規 X アプリは作らない(同意画面のロゴ・名前がブランド統一される)。`
      : ""
  }
`);
}

// ── 4. Clerk Dashboard 手作業チェックリスト ──────
title("【4】Clerk Dashboard — 手作業チェックリスト");
if (MODE === "A") {
  // 方式A: ブランドの Clerk インスタンスは初回に1度だけ設定すれば、以降のアプリは
  // 設定不要(同じインスタンスを使うだけ)。各アプリでやるのは鍵をコピーするだけ。
  console.log(`
  URL: https://dashboard.clerk.com → ${preset?.displayName ?? "ブランド"}の共有インスタンス(${resolvedClerkDomain})

  ✅ 方式A では、2個目以降のアプリで Clerk の設定作業はありません。
     下記はブランド初回(1回だけ)の設定。完了済みなら鍵を控えるだけでOK。

  □ (初回のみ) SSO connections → X(Twitter) → Enable / Use custom credentials: ON
  □ (初回のみ) Client ID/Secret(env ${preset?.xOAuth?.clientIdEnv ?? "X_OAUTH_CLIENT_ID"} / ${preset?.xOAuth?.clientSecretEnv ?? "X_OAUTH_CLIENT_SECRET"})
  □ (初回のみ) Scopes: ${(resolvedScopes.length ? resolvedScopes : ["users.read", "tweet.read", "offline.access"]).join("  ")} (${forbiddenScopes.join("/")} は付けない)
  □ (初回のみ) Domains → Custom domain: ${resolvedClerkDomain} を設定し DNS CNAME を通す

  □ (各アプリ) API keys から pk_live_ / sk_live_ を控える
     → 各アプリの env(${sharedPubKeyEnv || "共有公開鍵"} / ${sharedSecretKeyEnv || "共有秘密鍵"})に同じ値を入れる
`);
} else {
  console.log(`
  URL: https://dashboard.clerk.com

  □ 対象プロジェクト（${identity.displayName ?? "このアプリ"}）を選択
  □ Configure → SSO connections → X(Twitter) → Enable for sign-up and sign-in
  □ Use custom credentials: ON
  □ Client ID: (X Developer Portal でコピーした値 / env ${preset?.xOAuth?.clientIdEnv ?? "X_OAUTH_CLIENT_ID"})
  □ Client Secret: (X Developer Portal でコピーした値 / env ${preset?.xOAuth?.clientSecretEnv ?? "X_OAUTH_CLIENT_SECRET"})
  □ Scopes: ${(resolvedScopes.length ? resolvedScopes : ["users.read", "tweet.read", "offline.access"]).join("  ")}  (${forbiddenScopes.join("/")} は絶対追加しない)
  □ Save

  □ Domains → Custom domain: ${clerkDomain || `clerk.${domain}`}
     ※ 本番デプロイ前に必須。DNS CNAME を Clerk の指示通りに設定すること。
`);
}

// ── 5. Vercel 環境変数 ────────────────────────────
title("【5】Vercel — 環境変数チェックリスト");
const vercelProject = config.ownership?.vercelProjectName ?? "";
console.log(`
  プロジェクト: ${vercelProject || "(app.config.json の ownership.vercelProjectName を設定)"}`);

const vercelEnvKeys = isNext
  ? [
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (pk_live_ で始まる本番鍵)",
      "CLERK_SECRET_KEY (sk_live_ で始まる本番鍵)",
      "NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in/",
      "NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up/",
      "NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL=/dashboard/",
      "NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL=/dashboard/",
      "NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard/",
      "NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard/",
    ]
  : [
      "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY (pk_live_ で始まる本番鍵)",
      "CLERK_SECRET_KEY (sk_live_ で始まる本番鍵)",
    ];

for (const k of vercelEnvKeys) {
  console.log(`  □ ${k}`);
}
console.log(`
  ※ dev 鍵 (pk_test_ / sk_test_) を本番 Vercel に入れないこと！
    → X authorize がループして戻ってこなくなる（kimito.link で実証済みの罠）
`);

// --write-vercel: vercel CLI で一括登録
if (WRITE_VERCEL) {
  title("【5b】Vercel CLI で環境変数を登録します...");
  warn("値は .env.local から読みます。本番鍵 (pk_live_) が入っているか事前確認してください。");
  if (!envExists) {
    err(".env.local が見つかりません。先に --write-env で作成してください。");
  } else {
    const envLines = envContent.split("\n").filter((l) => {
      const key = l.split("=")[0];
      return requiredEnvKeys.includes(key);
    });
    for (const line of envLines) {
      const [key, ...rest] = line.split("=");
      const val = rest.join("=").trim();
      if (!val || val.startsWith("#")) continue;
      try {
        const cmd = `echo "${val}" | vercel env add ${key} production`;
        execSync(cmd, { stdio: "inherit" });
        ok(`Vercel に ${key} を登録しました`);
      } catch {
        err(`Vercel への ${key} 登録が失敗しました。手動で登録してください。`);
      }
    }
  }
}

// ── 6. まとめ ─────────────────────────────────────
title("━━━ 完了後の動作確認手順 ━━━");
console.log(`
  1. vercel --prod でデプロイ
  2. https://${domain} を開いてログインボタンをタップ
  3. X の認証画面が開く → ログイン → アプリに戻る
  4. 戻ってこない / ループする → 下記を確認:
       - Callback URL が X Portal に登録されているか (半角スペース・末尾スラッシュに注意)
       - Clerk の Scopes に tweet.write が混入していないか
       - Vercel の鍵が pk_live_ / sk_live_ になっているか (pk_test_ ならダメ)
       - Clerk カスタムドメインの DNS が反映されているか (最大 48h)
`);

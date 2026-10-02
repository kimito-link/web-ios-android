/**
 * KimitoLinkRedirect — /auth/kimito-link（ログイン案内）の中継部品
 *
 * ★出典: 旧Expo版 app/auth/kimito-link.tsx（ログイン済み→トップ／未ログイン→auto=x付きsign-in）。
 *
 * ★設計（1000年後も壊れないための要点）:
 *   1. 判定は純関数 resolveKimitoLinkRedirect に分離（__tests__ で検証済み）。
 *   2. Clerk 読み込み完了まで動かない。動くのは1回だけ（useRef ガード）＝ループしない。
 *   3. 移動は window.location.replace（通常の画面遷移）。"/" は旧Expo側の管轄で
 *      Next.js ルーターの外にあるため、router.replace だと境界をまたぐ soft navigation で壊れる。
 *   4. 行き先は固定パスのみ（外部入力なし）。
 *   5. JS・Clerk が失敗しても、画面に出ている手動リンクで先へ進める
 *      （壊れ方の上限を「自動で進まないだけ」に固定する）。
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { authBrandConfig } from "@/lib/auth-brand.config";
import { SIGN_IN_AUTO_X_HREF } from "@/lib/auth-routes";
import { resolveKimitoLinkRedirect } from "@/lib/kimito-link-redirect";

/** この秒数たっても自動で進めなかったら、手動リンクを強調する。 */
const SLOW_NOTICE_MS = 8000;

export function KimitoLinkRedirect() {
  const { isLoaded, isSignedIn } = useUser();
  const firedRef = useRef(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (firedRef.current) return;
    const decision = resolveKimitoLinkRedirect(
      { isLoaded, isSignedIn },
      { home: authBrandConfig.afterAuthPath, signIn: SIGN_IN_AUTO_X_HREF },
    );
    if (decision.action === "wait") return;
    firedRef.current = true;
    window.location.replace(decision.to);
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), SLOW_NOTICE_MS);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-900 px-6 text-center text-white"
      aria-live="polite"
    >
      <div
        aria-hidden
        className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white"
      />
      <p className="text-sm font-bold text-white/85">X に接続中…</p>
      <p className={slow ? "text-sm text-white" : "text-xs text-white/60"}>
        自動で進まないときは{" "}
        <a href={SIGN_IN_AUTO_X_HREF} className="font-semibold underline underline-offset-2">
          こちらから X でログイン
        </a>
      </p>
    </main>
  );
}

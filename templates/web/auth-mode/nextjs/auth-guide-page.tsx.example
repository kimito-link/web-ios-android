/**
 * app/(auth)/auth/kimito-link/page.tsx — ログイン案内の中継ページ
 *
 * ★出典: 旧Expo版 app/auth/kimito-link.tsx。アプリ内のログイン案内導線
 *   （lib/navigation/app-routes.ts の LOGIN_GUIDE）の行き先。
 *   ログイン状況を見て「トップ」か「auto=x 付き sign-in」へ振り分けるだけで、
 *   自前の認証処理は持たない（CLERK_X_LOGIN_PLAYBOOK §1: 認証は Clerk 標準に任せる）。
 *
 * ★(auth) route group 配下に置く理由: ClerkProvider（layout.tsx）が必要なため。
 *   URL には (auth) は出ない（/auth/kimito-link/）。
 */
import type { Metadata } from "next";
import { KimitoLinkRedirect } from "@/components/KimitoLinkRedirect";

export const metadata: Metadata = {
  title: "ログインへ進みます",
  // ★認証ページは検索結果に出さない。
  robots: { index: false, follow: false },
};

export default function KimitoLinkAuthGuidePage() {
  return <KimitoLinkRedirect />;
}

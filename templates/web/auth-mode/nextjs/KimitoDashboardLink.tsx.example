/**
 * KimitoDashboardLink — 本家マイページ（https://kimito.link/dashboard/）への導線（React 版）。
 *
 * ★出典: kimitolink-linktree/components/HeaderNav.tsx（ログイン中だけ「マイページ」→ /dashboard/）
 *   と HeaderNavAuth.tsx（Clerk の isLoaded を待ってから出す）。姉妹サービス向けに https:// から始まる完全なURLにし、
 *   Clerk SDK 差（@clerk/nextjs / @clerk/clerk-expo / clerk-js）を吸収するため、
 *   ログイン状態は props で受ける（この部品は Clerk を import しない＝素の React）。
 *
 * ★なぜ要るか（2026-10-05）: 本家のダッシュボードは共通アカウントの拠点で、姉妹ごとの利用状況
 *   カードがある。姉妹4サービスは利用状況の書き込み（/api/hub/summary）まで実装済みなのに、
 *   見に行く入口が無かった。
 *
 * ★設計:
 *   1. 判定は純関数 resolveKimitoDashboardLink（Vanilla JS 版 kimito-dashboard-link.js と同じ契約）。
 *      読み込み前は null（何も出さない・レイアウトも占めない）／未ログインは null／ログイン中だけ描く。
 *   2. 本家の sign-in へは送らない（本家は signInForceRedirectUrl=/dashboard/ で姉妹へ戻れない。
 *      nextjs/README.md 地雷4）。未ログイン時の導線は各サービス自身の sign-in に任せる。
 *   3. 行き先は https のみ・クエリ無し。外れた値は既定 URL に戻す。
 *   4. 描く要素は差し替え可（`as`）。Expo(React Native) では <a> が使えないので、
 *      Linking.openURL を呼ぶ Pressable 等を渡す。既定は <a rel="noopener">。
 *
 * 使い方（Next.js, @clerk/nextjs）:
 *   const { isLoaded, isSignedIn } = useUser();
 *   <KimitoDashboardLink isLoaded={isLoaded} isSignedIn={isSignedIn} className="..." />
 *
 * 使い方（Expo, @clerk/clerk-expo）:
 *   const { isLoaded, isSignedIn } = useAuth();
 *   <KimitoDashboardLink isLoaded={isLoaded} isSignedIn={isSignedIn} as={ExternalLinkButton} />
 *   （ExternalLinkButton は { href, children } を受け取り Linking.openURL(href) する自前部品）
 *
 * ★置き場所: ログイン後の画面（マイページ・ヘッダー右上）。LP には置かない。
 */
"use client";

import type { ElementType, ReactNode } from "react";

export const KIMITO_DASHBOARD_HREF = "https://kimito.link/dashboard/";
export const KIMITO_DASHBOARD_LABEL = "kimito.link マイページ";

export type KimitoDashboardLinkState = {
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
};

export type KimitoDashboardLinkOptions = {
  href?: string;
  label?: string;
};

export type KimitoDashboardLinkDecision =
  | { action: "wait" }
  | { action: "clear" }
  | { action: "render"; href: string; label: string };

/** https のみ・クエリ/フラグメント無し。Vanilla JS 版 isAcceptableHref と同じ契約。 */
export function isAcceptableKimitoDashboardHref(href: unknown): href is string {
  if (typeof href !== "string" || href === "") return false;
  if (!/^https:\/\//.test(href)) return false;
  if (href.includes("?") || href.includes("#")) return false;
  return true;
}

/** 純関数。副作用なし。Vanilla JS 版 resolveKimitoDashboardLink と同じ契約。 */
export function resolveKimitoDashboardLink(
  state: KimitoDashboardLinkState,
  opts: KimitoDashboardLinkOptions = {},
): KimitoDashboardLinkDecision {
  if (!state.isLoaded) return { action: "wait" };
  if (!state.isSignedIn) return { action: "clear" };
  const href = isAcceptableKimitoDashboardHref(opts.href) ? opts.href : KIMITO_DASHBOARD_HREF;
  const label =
    typeof opts.label === "string" && opts.label.trim() !== "" ? opts.label.trim() : KIMITO_DASHBOARD_LABEL;
  return { action: "render", href, label };
}

export type KimitoDashboardLinkProps = KimitoDashboardLinkState &
  KimitoDashboardLinkOptions & {
    className?: string;
    /** 描く要素。既定 "a"。Expo では Linking.openURL する部品を渡す。{ href, rel, className, children } を受ける。 */
    as?: ElementType;
    /** 文言の代わりに任意の子要素（アイコン付き等）を出したいとき。 */
    children?: ReactNode;
  };

export function KimitoDashboardLink({
  isLoaded,
  isSignedIn,
  href,
  label,
  className,
  as: Component = "a",
  children,
}: KimitoDashboardLinkProps) {
  const decision = resolveKimitoDashboardLink({ isLoaded, isSignedIn }, { href, label });
  if (decision.action !== "render") return null;
  return (
    <Component
      href={decision.href}
      rel="noopener"
      className={className}
      data-kimito-dashboard-anchor=""
    >
      {children ?? decision.label}
    </Component>
  );
}

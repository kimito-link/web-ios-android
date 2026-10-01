/**
 * AutoAdvanceToX — Xワンタップログイン（Next.js + Clerk 版の金型）
 *
 * ★出典: kimitolink-linktree/components/AutoAdvanceToX.tsx
 *   2026-10-01 に本番実機でコンソールエラー0・ちらつき無しを確認した実装。
 *
 * ★設計の核（CLERK_X_LOGIN_PLAYBOOK.md §1・§4.1）:
 *   click を **奪わない**（authenticateWithRedirect 直呼び・自前 sso-callback は禁止。
 *   db0032a で本番ログインを壊した手法そのもの）。標準 <SignIn/> が描画した
 *   X ボタンへ **本物の click を1回送るだけ**。壊れ方の上限が「改善ゼロ」に固定される
 *   （自動clickが失敗しても、通常の選択モーダルがそのまま残る）。
 *
 * ★使い方: `?auto=x` 付きで sign-in を開くと発火する。
 *   例: /sign-in/?redirect_url=%2Fdashboard%2F&auto=x
 *
 * ★ブランド依存は auth-brand.config.ts に外出し済み。このファイルは原則そのまま使える。
 *
 * ★Expo/React Native では使えない（next/image と @clerk/nextjs に依存）。
 *   Expo 版は surechigai-romi.link/components/auth/auto-advance-to-x.tsx を見る
 *   （Platform 分岐・ネイティブシェル除外ガードを内蔵）。
 */
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useUser } from "@clerk/nextjs";
// ★ブランド依存はこの1ファイルに集約してある。パスは自プロジェクトに合わせる。
import { authBrandConfig } from "@/lib/auth-brand.config";

const AUTO_PARAM = "auto";
const AUTO_VALUE = "x";
const COOLDOWN_KEY = "auth-mode:auto-x-last-fired-at";
const COOLDOWN_MS = 3000;
const TIMEOUT_MS = 9000;
const POLL_MS = 120;

const X_BUTTON_SELECTOR = [
  ".cl-socialButtonsBlockButton__x",
  ".cl-socialButtonsIconButton__x",
  ".cl-socialButtonsBlockButton__twitter",
  ".cl-socialButtonsIconButton__twitter",
].join(", ");

function hasAutoXParam() {
  const url = new URL(window.location.href);
  return url.searchParams.get(AUTO_PARAM) === AUTO_VALUE;
}

function isSsoCallbackPath() {
  return window.location.pathname.includes("/sso-callback");
}

function isWithinCooldown() {
  try {
    const raw = sessionStorage.getItem(COOLDOWN_KEY);
    if (!raw) return false;
    const last = Number(raw);
    if (!Number.isFinite(last)) return false;
    return Date.now() - last < COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markFiredNow() {
  try {
    sessionStorage.setItem(COOLDOWN_KEY, String(Date.now()));
  } catch {
    // no-op
  }
}

function removeAutoXParam() {
  const url = new URL(window.location.href);
  if (url.searchParams.get(AUTO_PARAM) !== AUTO_VALUE) return;

  url.searchParams.delete(AUTO_PARAM);
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`
  );
}

function resolveClickableTarget(candidate: HTMLElement): HTMLElement | null {
  const target =
    candidate.closest<HTMLElement>("button, a, [role='button']") ?? candidate;
  if (target.getAttribute("aria-disabled") === "true") return null;
  if (target instanceof HTMLButtonElement && target.disabled) return null;
  return target;
}

/**
 * Xボタンを探す。まずCSSセレクタ、次にフォールバック。
 * ★CSSセレクタはClerkの非公開内部クラス名で将来変わりうる。一致しない場合は
 *   aria-label/data-provider/textContent等を正規表現で総当たりする
 *   （surechigai-romi.link由来の改善還流、正本: ai-generic-rules/CLERK_X_LOGIN_PLAYBOOK.md §4.1）。
 */
function findClickableXButton(): HTMLElement | null {
  const matched = document.querySelector<HTMLElement>(X_BUTTON_SELECTOR);
  if (matched) {
    const direct = resolveClickableTarget(matched);
    if (direct) return direct;
  }

  const candidates = document.querySelectorAll<HTMLElement>(
    "button, a, [role='button']"
  );
  for (const candidate of candidates) {
    const target = resolveClickableTarget(candidate);
    if (!target) continue;
    const hay = [
      target.getAttribute("data-provider") ?? "",
      target.getAttribute("aria-label") ?? "",
      target.getAttribute("data-localization-key") ?? "",
      target.getAttribute("class") ?? "",
      target.className ?? "",
      target.textContent ?? "",
    ]
      .join(" ")
      .toLowerCase();
    if (/twitter|\bx\b|__x\b|\boauth_x\b/.test(hay)) return target;
  }

  return null;
}

/**
 * auto=x の制御（Clerk 非接触・標準 X ボタンへ click するだけ）。
 */
export function AutoAdvanceToX() {
  const { isLoaded, isSignedIn } = useUser();
  const [showOverlay, setShowOverlay] = useState(false);

  useEffect(() => {
    if (!hasAutoXParam() || isSsoCallbackPath()) {
      setShowOverlay(false);
      return;
    }
    if (isLoaded && isSignedIn) {
      setShowOverlay(false);
      return;
    }

    setShowOverlay(true);

    if (isWithinCooldown()) {
      const t = window.setTimeout(() => setShowOverlay(false), 400);
      return () => window.clearTimeout(t);
    }

    if (!isLoaded) return;

    let didClick = false;
    let observer: MutationObserver | null = null;
    const intervalId = window.setInterval(tryClick, POLL_MS);
    const timeoutId = window.setTimeout(giveUp, TIMEOUT_MS);

    function cleanupTimers() {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
      observer?.disconnect();
      observer = null;
    }

    function giveUp() {
      cleanupTimers();
      setShowOverlay(false);
      // ★サイレント失敗の可視化（Clerkの内部クラス名変更でCSSセレクタ・
      //   フォールバック両方が外れた場合の検知用）。ユーザー体験は変えず
      //   通常の選択モーダルへ戻すのみ（正本§4.1「壊れ方の上限を改善ゼロに固定」）。
      if (typeof console !== "undefined" && console.warn) {
        console.warn(
          "[AutoAdvanceToX] Xボタンが見つからずタイムアウトしました。通常の選択モーダルのまま表示します。Clerkの内部クラス名が変わった可能性があります。"
        );
      }
    }

    function tryClick() {
      if (didClick) return;

      const button = findClickableXButton();
      if (!button) return;

      didClick = true;
      markFiredNow();
      removeAutoXParam();
      cleanupTimers();
      button.click();
    }

    observer = new MutationObserver(tryClick);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["aria-disabled", "class", "disabled"],
      childList: true,
      subtree: true,
    });
    tryClick();

    return () => {
      didClick = true;
      cleanupTimers();
    };
  }, [isLoaded, isSignedIn]);

  if (!showOverlay) return null;

  const { image, backgroundClass, accentClass, headline, subline, sensitiveNotice } =
    authBrandConfig.autoAdvance;

  return (
    <div
      role="status"
      aria-live="assertive"
      className={`fixed inset-0 z-2147483646 flex flex-col items-center justify-center gap-6 px-8 text-center text-white ${backgroundClass}`}
    >
      {/* ★画像は任意。設定で null にすれば描画しない（画像を持たないサービスでも動く）。 */}
      {image ? (
        <Image
          src={image.src}
          alt={image.alt}
          width={image.width}
          height={image.height}
          priority
          className="h-32 w-32 animate-bounce object-contain drop-shadow-xl"
        />
      ) : null}
      <div>
        <p className="text-2xl font-extrabold leading-snug">{headline}</p>
        <p className="mt-3 text-base font-medium text-white/85">{subline}</p>
        {sensitiveNotice ? (
          <p className="mt-2 text-sm font-medium text-white/70">{sensitiveNotice}</p>
        ) : null}
      </div>
      <div
        aria-hidden
        className="h-1.5 w-40 overflow-hidden rounded-full bg-white/25"
      >
        <div
          className={`h-full w-1/2 animate-[autoAdvance_1.1s_ease-in-out_infinite] rounded-full ${accentClass}`}
        />
      </div>
      <style>{`@keyframes autoAdvance{0%{transform:translateX(-120%)}100%{transform:translateX(260%)}}`}</style>
    </div>
  );
}

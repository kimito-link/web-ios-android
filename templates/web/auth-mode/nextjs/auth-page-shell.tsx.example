/**
 * AuthPageShell — サインイン／サインアップ共通レイアウト（金型・骨組みのみ）
 *
 * ★出典: kimitolink-linktree/components/AuthPageShell.tsx
 *
 * ★★ここは「丸写ししない」部分です。
 *   出典の実物は 8 つの自社コンポーネント（AuthPageIntro / AuthRedirectNotice /
 *   AuthHandoffOverlay / AutoXReturnNotice / AddXAccountNotice /
 *   AuthBrowserSessionNotice / InAppBrowserNotice / AuthSupportNotice）に依存し、
 *   合計 795 行ある。これは kimito の文言・キャラ・導線に強く結びついた UI なので、
 *   そのまま輸入しても他サービスでは意味を成さない。
 *
 *   **移植すべきは「配置の順序」と「なぜその順序か」**（下記 ★ 印）。
 *   中身のカードは自サービスのものに差し替える。slot を null にすれば消える。
 *
 * ★移植して価値がある知見（実損に基づく・順序を変えないこと）:
 *   1. Clerk カードを**ファーストビュー最上部**に置く。遷移予告は**その下**。
 *      （予告を上に置くとボタンが押し下げられ、体感速度が落ちる）
 *   2. モバイルは CTA を先、説明は後（order-1 / order-2）。lg 以上で左右2カラム。
 *   3. preconnect は Clerk の FAPI と X に張る（認可画面への遷移を速める）。
 *   4. ★`<SignIn/>` 本体には触らない。注意書きは**外側に添える**だけ
 *      （CLERK_X_LOGIN_PLAYBOOK §1-1。中を書き換えると本番ログインが壊れる）。
 */
import type { ReactNode } from "react";
import { authBrandConfig } from "@/lib/auth-brand.config";

type AuthPageShellProps = {
  variant: "sign-in" | "sign-up";
  /** Clerk の <SignIn/> / <SignUp/> を入れる。 */
  children: ReactNode;

  /* ── 以下はすべて任意。自サービスのカードを差し込む。null なら出ない ── */

  /** 左カラム（lg以上）/ CTA の下（モバイル）に出る説明。 */
  intro?: ReactNode;
  /** ★Clerk カードより上に出す警告（アプリ内ブラウザ等）。安全上の警告はここ。 */
  noticesAboveCard?: ReactNode;
  /** ★Clerk カードより下に出す遷移予告・サポート導線（押し下げを避けるため下）。 */
  noticesBelowCard?: ReactNode;
  /** Clerk カード内ヘッダー（「パスワード不要」等の安心表示）。 */
  cardHeader?: ReactNode;
  /** 外部認可へ飛ぶ一瞬に出すフルスクリーン演出。 */
  handoffOverlay?: ReactNode;
};

export function AuthPageShell({
  children,
  intro = null,
  noticesAboveCard = null,
  noticesBelowCard = null,
  cardHeader = null,
  handoffOverlay = null,
}: AuthPageShellProps) {
  return (
    <>
      {handoffOverlay}
      {/* ★認可画面への遷移を速める。自サービスの FAPI ドメインに合わせる。 */}
      <link rel="preconnect" href={`https://${authBrandConfig.clerkFrontendApiDomain}`} />
      <link rel="preconnect" href="https://x.com" />
      <link rel="dns-prefetch" href="https://api.x.com" />

      <main className="min-h-screen">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-stretch gap-8 px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-10 lg:flex-row lg:items-start lg:justify-center lg:gap-12 lg:py-14">
          {/* ★モバイルは CTA を先に見せる（order-2＝説明は下）。lg 以上で左カラム。 */}
          <div className="order-2 flex w-full justify-center lg:order-1 lg:max-w-xl lg:flex-1 lg:justify-end">
            {intro}
          </div>

          <div className="order-1 flex w-full flex-col items-center gap-4 lg:order-2 lg:max-w-md lg:flex-1 lg:sticky lg:top-8">
            {/* ★安全上の警告だけはカードより上（押し下げても出す価値がある）。 */}
            {noticesAboveCard}

            <div className="w-full max-w-md overflow-hidden rounded-4xl border bg-white/95 shadow-xs">
              {cardHeader}
              {/* ★<SignIn/> はここ。中身に触らない。 */}
              <div className="p-3 sm:p-4">{children}</div>
            </div>

            {/* ★遷移予告・サポートはカードの「下」。上に置くとボタンが押し下がる。 */}
            {noticesBelowCard}
          </div>
        </div>
      </main>
    </>
  );
}

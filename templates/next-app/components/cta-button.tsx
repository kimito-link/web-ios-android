/**
 * 汎用 CTA ボタン。全プロジェクト共通の「問い合わせ/LINE/ストア導線」ボタンを金型化。
 * variant で見た目、external で新規タブ＋rel を切替。依存ゼロ。
 */
import type { ReactNode } from "react";

export interface CtaButtonProps {
  href: string;
  children: ReactNode;
  variant?: "primary" | "outline" | "line";
  external?: boolean;
  className?: string;
}

const VARIANTS: Record<NonNullable<CtaButtonProps["variant"]>, string> = {
  primary: "bg-brand-accent text-white shadow-lg hover:opacity-90",
  outline: "border-2 border-brand text-brand hover:bg-brand/5",
  // LINE ブランドカラー（公式緑）。CVR の主導線用。
  line: "bg-[#06C755] text-white shadow-lg hover:opacity-90",
};

export function CtaButton({
  href,
  children,
  variant = "primary",
  external = false,
  className = "",
}: CtaButtonProps) {
  const externalProps = external
    ? { target: "_blank", rel: "noopener noreferrer" }
    : {};
  return (
    <a
      href={href}
      {...externalProps}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-8 py-3.5 text-base font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </a>
  );
}

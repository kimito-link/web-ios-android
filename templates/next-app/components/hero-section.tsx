/**
 * 汎用 Hero セクション。partnership_program_website の HeroSection を金型化
 * （Radix 依存を外し、Tailwind だけで実装）。バッジ・タイトル・説明・CTA・信頼バッジを
 * すべて Props で差し替えられるので、複数 LP で使い回せる。
 */
import type { ReactNode } from "react";

export interface TrustBadge {
  icon?: ReactNode;
  label: string;
}

export interface HeroSectionProps {
  /** 小さなラベル（例「無料診断」）。省略可。 */
  badgeText?: string;
  badgeIcon?: ReactNode;
  /** JSX 可（改行や強調を入れられる）。 */
  title: ReactNode;
  description: ReactNode;
  /** 主要 CTA。href とラベルを渡すと既定ボタンを描画。 */
  ctaHref?: string;
  ctaLabel?: string;
  /** CTA の直後に差し込むスロット（補足リンク等）。 */
  afterCta?: ReactNode;
  trustBadges?: TrustBadge[];
  /** 背景クラスの上書き（グラデ等）。 */
  className?: string;
}

export function HeroSection({
  badgeText,
  badgeIcon,
  title,
  description,
  ctaHref,
  ctaLabel,
  afterCta,
  trustBadges,
  className = "",
}: HeroSectionProps) {
  return (
    <section className={`px-6 py-20 text-center ${className}`}>
      <div className="mx-auto max-w-3xl">
        {badgeText && (
          <span className="mb-6 inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-4 py-1.5 text-sm font-semibold text-brand">
            {badgeIcon}
            {badgeText}
          </span>
        )}
        <h1 className="font-mincho text-3xl font-bold leading-tight text-ink sm:text-4xl md:text-5xl">
          {title}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-ink-muted sm:text-lg">
          {description}
        </p>
        {ctaHref && ctaLabel && (
          <div className="mt-8">
            <a
              href={ctaHref}
              className="inline-flex items-center justify-center rounded-full bg-brand-accent px-8 py-3.5 text-base font-bold text-white shadow-lg transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
            >
              {ctaLabel}
            </a>
          </div>
        )}
        {afterCta && <div className="mt-4 text-sm text-ink-muted">{afterCta}</div>}
        {trustBadges && trustBadges.length > 0 && (
          <ul className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-ink-muted">
            {trustBadges.map((b, i) => (
              <li key={i} className="inline-flex items-center gap-1.5">
                {b.icon}
                {b.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

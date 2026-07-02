/**
 * 汎用 FAQ セクション。partnership_program_website の FaqSection を金型化。
 * variant で「accordion（<details> で開閉）」/「static（常時展開）」を切替。
 * 依存ゼロ（Radix 不使用）。JSON-LD は buildFaqJsonLd() を別途 <JsonLd/> に渡す。
 */
import type { ReactNode } from "react";

export interface FaqItem {
  question: string;
  answer: ReactNode;
}

export interface FaqSectionProps {
  title?: string;
  items: FaqItem[];
  variant?: "accordion" | "static";
  className?: string;
}

export function FaqSection({
  title = "よくある質問",
  items,
  variant = "accordion",
  className = "",
}: FaqSectionProps) {
  return (
    <section className={`px-6 py-16 ${className}`}>
      <div className="mx-auto max-w-2xl">
        <h2 className="font-mincho text-2xl font-bold text-ink sm:text-3xl">{title}</h2>
        <div className="mt-8 divide-y divide-black/10">
          {items.map((item, i) =>
            variant === "accordion" ? (
              <details key={i} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-ink">
                  {item.question}
                  <span className="shrink-0 text-ink-muted transition group-open:rotate-180">▾</span>
                </summary>
                <div className="mt-3 text-sm leading-relaxed text-ink-muted">{item.answer}</div>
              </details>
            ) : (
              <div key={i} className="py-4">
                <p className="text-base font-semibold text-ink">{item.question}</p>
                <div className="mt-2 text-sm leading-relaxed text-ink-muted">{item.answer}</div>
              </div>
            ),
          )}
        </div>
      </div>
    </section>
  );
}

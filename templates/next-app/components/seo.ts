/**
 * SEO ヘルパ（Next.js App Router / Metadata API 版）。
 *
 * partnership_program_website の SEOHead.tsx（Vite/React・useEffect で DOM を直接
 * いじる実装）を、Next.js App Router の作法へ移植したもの。App Router では
 * meta / OGP / canonical は Metadata オブジェクトで宣言し（useEffect でいじらない）、
 * JSON-LD は Server Component で <script> 描画する。だから 2 本に分ける:
 *
 *   1. buildMetadata()  → generateMetadata() が返す Metadata（title/OGP/canonical）
 *   2. buildXxxJsonLd() → <JsonLd data={...} /> に渡す構造化データオブジェクト
 *
 * 設計で効いているポイント（partnership の知見）:
 *   - og:title を SEO title と分離できる（CVR コピー用。LINE は先頭20〜25字で折返す）
 *   - Service/Article/WebPage の 3 type を機械可読化（AggregateRating / WarrantyPromise /
 *     Offer.minPrice / ContactPoint まで）
 *
 * 会社固有値（組織名・ロゴ・sameAs・siteUrl）は app.config.json から
 * setup-new-app.mjs が {{...}} に流し込む前提。
 */
import type { Metadata } from "next";

const SITE_URL = "https://{{productionDomain}}".replace(/\/$/, "");
const SITE_NAME = "{{displayName}}";
const DEFAULT_OG_IMAGE = "/images/og-default.png";

const ORGANIZATION = {
  "@type": "Organization",
  name: "{{organizationName}}",
  url: SITE_URL,
  logo: {
    "@type": "ImageObject",
    url: `${SITE_URL}/images/logo-type.png`,
  },
} as const;

function abs(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http")) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

export interface BuildMetadataInput {
  title: string;
  description: string;
  /** サイト内パス（例 "/price/"）。canonical と og:url に使う。 */
  path: string;
  /** og:title を SEO title と分けたいとき。未指定なら title を流用。 */
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  type?: "website" | "article";
  keywords?: string[];
  noindex?: boolean;
}

/** generateMetadata() から返す Metadata を組み立てる。 */
export function buildMetadata(input: BuildMetadataInput): Metadata {
  const {
    title,
    description,
    path,
    ogTitle,
    ogDescription,
    ogImage = DEFAULT_OG_IMAGE,
    type = "website",
    keywords,
    noindex,
  } = input;

  const url = abs(path);
  const image = abs(ogImage);
  const resolvedOgTitle = ogTitle ?? title;
  const resolvedOgDescription = ogDescription ?? description;

  return {
    title,
    description,
    keywords,
    alternates: { canonical: url },
    robots: noindex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      type,
      locale: "ja_JP",
      siteName: SITE_NAME,
      url,
      title: resolvedOgTitle,
      description: resolvedOgDescription,
      images: [{ url: image, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: resolvedOgTitle,
      description: resolvedOgDescription,
      images: [image],
    },
  };
}

/** 汎用 WebPage の JSON-LD。 */
export function buildWebPageJsonLd(input: { title: string; description: string; path: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: input.title,
    description: input.description,
    url: abs(input.path),
    publisher: ORGANIZATION,
    inLanguage: "ja",
  };
}

export interface ServiceJsonLdInput {
  serviceName: string;
  description: string;
  path: string;
  ogImage?: string;
  /** 価格（文字列表記。例 "9800"） */
  servicePrice?: string;
  /** 最低価格（円）。Offer.priceSpecification に使う。 */
  serviceMinPrice?: number;
  serviceCategory?: string;
  /** 保証期間（日）。ISO 8601 duration（P30D）で入る。 */
  warrantyDays?: number;
  /** 問い合わせ URL（LINE 等）。ContactPoint/CommunicateAction に使う。 */
  contactUrl?: string;
  aggregateRating?: { ratingValue: number; reviewCount: number; bestRating?: number };
}

/** Service の JSON-LD（Offer.minPrice / WarrantyPromise / AggregateRating を機械可読化）。 */
export function buildServiceJsonLd(input: ServiceJsonLdInput) {
  const image = abs(input.ogImage ?? DEFAULT_OG_IMAGE);
  const offer =
    input.servicePrice || input.serviceMinPrice
      ? {
          "@type": "Offer",
          ...(input.servicePrice ? { price: input.servicePrice } : {}),
          ...(input.serviceMinPrice
            ? {
                priceSpecification: {
                  "@type": "UnitPriceSpecification",
                  minPrice: input.serviceMinPrice,
                  priceCurrency: "JPY",
                },
              }
            : {}),
          priceCurrency: "JPY",
          ...(input.warrantyDays
            ? {
                warranty: {
                  "@type": "WarrantyPromise",
                  durationOfWarranty: `P${input.warrantyDays}D`,
                },
              }
            : {}),
        }
      : undefined;

  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: input.serviceName,
    description: input.description,
    url: abs(input.path),
    image: { "@type": "ImageObject", url: image },
    provider: ORGANIZATION,
    ...(input.contactUrl
      ? {
          potentialAction: {
            "@type": "CommunicateAction",
            target: input.contactUrl,
          },
        }
      : {}),
    ...(offer ? { offers: offer } : {}),
    ...(input.serviceCategory ? { serviceType: input.serviceCategory } : {}),
    areaServed: { "@type": "Country", name: "Japan" },
    ...(input.aggregateRating
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: input.aggregateRating.ratingValue,
            reviewCount: input.aggregateRating.reviewCount,
            bestRating: input.aggregateRating.bestRating ?? 5,
            worstRating: 1,
          },
        }
      : {}),
  };
}

export interface ArticleJsonLdInput {
  title: string;
  description: string;
  path: string;
  ogImage?: string;
  publishedDate: string;
  modifiedDate?: string;
  author?: string;
  keywords?: string[];
}

/** Article の JSON-LD。 */
export function buildArticleJsonLd(input: ArticleJsonLdInput) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: input.description,
    url: abs(input.path),
    image: abs(input.ogImage ?? DEFAULT_OG_IMAGE),
    datePublished: input.publishedDate,
    dateModified: input.modifiedDate ?? input.publishedDate,
    author: { "@type": "Organization", name: input.author ?? ORGANIZATION.name, url: SITE_URL },
    publisher: ORGANIZATION,
    mainEntityOfPage: { "@type": "WebPage", "@id": abs(input.path) },
    inLanguage: "ja",
    ...(input.keywords ? { keywords: input.keywords.join(", ") } : {}),
  };
}

/** FAQ の JSON-LD（FaqSection と併用。AI 検索/リッチリザルト対策）。 */
export function buildFaqJsonLd(items: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.question,
      acceptedAnswer: { "@type": "Answer", text: it.answer },
    })),
  };
}

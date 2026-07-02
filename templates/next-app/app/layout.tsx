import type { Metadata } from "next";
import { Noto_Sans_JP, Shippori_Mincho } from "next/font/google";
import "./globals.css";

// 本文＝ゴシック / 見出し＝明朝。CSS 変数として globals.css の @theme に接続する。
const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-noto-sans-jp",
  display: "swap",
});
const shipporiMincho = Shippori_Mincho({
  weight: ["500", "700"],
  subsets: ["latin"],
  variable: "--font-shippori-mincho",
  display: "swap",
});

// サイト共通メタデータ。個別ページは generateMetadata / SEOHead ヘルパ（components/seo.ts）で上書き。
export const metadata: Metadata = {
  metadataBase: new URL("https://{{productionDomain}}"),
  title: {
    default: "{{displayName}}",
    template: "%s | {{displayName}}",
  },
  description: "{{shortDescription}}",
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: "{{displayName}}",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${notoSansJP.variable} ${shipporiMincho.variable}`}>
      <body>{children}</body>
    </html>
  );
}

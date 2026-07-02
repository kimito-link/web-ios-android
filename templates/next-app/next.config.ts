import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

// 金型 next.config。kimitolink-linktree / malwarecheck.site の実運用設定を集約。
// {{...}} プレースホルダは setup-new-app.mjs が app.config.json の値で置換する想定
// （remotePatterns の clerk 系ホストは Clerk 使用時のみ有効。未使用でも無害）。

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  // 正規 URL は末尾スラッシュ付きに統一（ASO/被リンクの重複回避）。
  trailingSlash: true,
  // OG/Twitter 画像の規約ファイル（/opengraph-image）はスラッシュ無しで出力される。
  // trailingSlash:true だと 308→/opengraph-image/ にリダイレクトされ、308 を追わない
  // クローラーや <img> がリダイレクト応答を画像として読み失敗＝カードに画像が出ない。
  // これで「リダイレクトしない」だけにして、スラッシュ無し URL でも直接 200(image/png) を返す。
  skipTrailingSlashRedirect: true,
  // "X-Powered-By: Next.js" を隠す（指紋を減らす）。
  poweredByHeader: false,
  // 開発時の HMR / 内部アセットはオリジンでガードされる。localhost も併記しないと
  // http://localhost:3000 が「真っ白」になることがある。
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  images: {
    // avif も許可してクライアント対応時はより小さい avif を配信（非対応 UA は webp/元画像へ）。
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      // X(Twitter) アバター/画像（Clerk の X SSO を使う場合に表示）。
      { protocol: "https", hostname: "pbs.twimg.com", pathname: "/**" },
      { protocol: "https", hostname: "abs.twimg.com", pathname: "/**" },
      // Clerk のユーザーアバター（Clerk 使用時のみ実際に読み込まれる）。
      { protocol: "https", hostname: "img.clerk.com", pathname: "/**" },
      { protocol: "https", hostname: "images.clerk.dev", pathname: "/**" },
    ],
  },
  async headers() {
    // 認証ページは絶対にキャッシュしない（セッション取り違え防止）。
    const noStoreHeaders = [
      { key: "Cache-Control", value: "private, no-store, no-cache, must-revalidate, max-age=0" },
      { key: "Pragma", value: "no-cache" },
      { key: "Expires", value: "0" },
    ];
    return [
      { source: "/sign-in/:path*", headers: noStoreHeaders },
      { source: "/sign-up/:path*", headers: noStoreHeaders },
      // 静的アセットは内容不変なので長期 immutable（HTML/認証は対象外）。
      {
        source: "/images/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      // 代表的なセキュリティヘッダ（malwarecheck / reviewcheck 準拠）。
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);

// 役割: App Store 版ローカライズ(ja)に送る description / keywords / promotionalText 等の属性を決める純関数。
// なぜ要るか: 以前は「前の版の値 > リポの store-assets/appstore/*.txt」の順で、改名・訴求変更をした版でも
//   旧キーワード・旧説明文が新版にそのまま入った(malwarecheck 2026-10-18)。リポのファイルがある項目は
//   ファイルを正とし、無い項目だけ前の版→今の版の順で引き継ぐ。whatsNew は従来通り(更新版のみ送る)。
// 使い方: appstore-submit.mjs の ensureLocalization から呼ぶ。複製元は malwarecheck.site/scripts/lib/ と同内容。

export function resolveLocalizationAttrs({ copy, ja, files = {}, urls = {}, whatsNew, includeWhatsNew }) {
  const pick = (key, ...rest) => files[key] || copy?.attributes?.[key] || ja?.attributes?.[key] || rest.find(Boolean);
  return {
    description: pick('description'),
    keywords: pick('keywords'),
    marketingUrl: copy?.attributes?.marketingUrl || ja?.attributes?.marketingUrl || urls.marketingUrl,
    supportUrl: copy?.attributes?.supportUrl || ja?.attributes?.supportUrl || urls.supportUrl,
    promotionalText: pick('promotionalText') || undefined,
    ...(includeWhatsNew ? { whatsNew } : {}),
  };
}

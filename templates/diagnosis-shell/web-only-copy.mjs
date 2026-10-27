// Web の提案面だけで使う案内文。
// なぜ要るか: アプリと拡張の読み込み経路に、人へ勧める案内文を載せないため、このファイルだけに分ける。
// アプリと拡張の入口（extension/popup.html）からは import しない。

export const WEB_ONLY_COPY = Object.freeze({
  pricing: { ja: '料金を見る', en: 'See pricing' },
  line: { ja: 'LINEで担当者に相談する', en: 'Talk with us on LINE' },
});

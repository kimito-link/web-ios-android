// Web の提案面だけで使う案内文。
// なぜ要るか: アプリと拡張の読み込み経路に、人へ勧める案内文を載せないため、このファイルだけに分ける。
// アプリと拡張の入口（extension/popup.html）からは import しない。

export const WEB_ONLY_COPY = Object.freeze({
  reason: {
    relevance: {
      ja: '今見ているのは、このドメインを今測った結果です。点とひとことは、この端末の中にだけあります。',
      en: 'What you see is the result measured for this domain just now. The score and the short note stay on this device.',
    },
    benefit: {
      ja: '開いているあいだに、直すかこのままにするかを、画面の言葉のまま決められます。',
      en: 'While it is open, you can decide whether to fix something or leave it, using the words already on the screen.',
    },
    acting: {
      ja: '次に見る日と、どこを見るかは上に残っています。カレンダーやこの端末の知らせは、その日にもう一度開くためだけです。',
      en: 'The next check date and what to look at stay above. The calendar and an on-device reminder only help you open it again that day.',
    },
    waiting: {
      ja: 'このページはサイトそのものを直しません。閉じても、測った結果は今のままです。次の確認日まで、画面の外では何も変わりません。',
      en: 'This page does not change the site. Closing it leaves the measured result as it is. Until the next check date, nothing outside this screen changes it.',
    },
  },
  pricingLead: {
    ja: '料金のページでは、何に払うかを項目ごとに読めます。見るだけでは申し込みになりません。',
    en: 'The pricing page lists what each amount pays for. Opening it does not submit an order.',
  },
  pricing: { ja: '料金の中身を見る', en: 'See what the price includes' },
  lineLead: {
    ja: 'この結果を人に聞くなら、今の点数とドメインを自分で送れます。このページは結果を自動では送りません。LINEは、その会話を置く場所です。使わなくても、結果はこの画面に残ります。聞く相手は運営の株式会社ベストトラストです。',
    en: 'If you want to ask a person about this result, you can send the score and the domain yourself. This page does not send the result. LINE is only a place for that conversation. You can skip it and keep the result on this screen. The operator is 株式会社ベストトラスト.',
  },
  line: { ja: 'LINEで、今の結果について聞く（任意）', en: 'Ask about this result on LINE (optional)' },
  offersHeading: {
    ja: '同じときに、一緒にあると楽なもの',
    en: 'Something that fits the same moment',
  },
  offersNote: {
    ja: '結果を見たあとに、渡された実在の選択だけを出します。選ばなくても結果はそのままです。この画面は代金を足しません。',
    en: 'After the result, only a real option that was passed in is shown. Skipping it leaves the result as it is. This screen does not add a charge.',
  },
  sharerLine: { ja: '共有者のLINE', en: 'Sharer LINE' },
});

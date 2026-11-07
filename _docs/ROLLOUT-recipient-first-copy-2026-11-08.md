# 相手の得から書く案内の棚卸し

今の到達点: このリポジトリの Web 面だけを変えた。他のリポジトリは変更していない。マージ、デプロイ、ストア提出、メッセージ送信はしていない。

次に読むもの: 書き方の正本は [`../docs/ai-rules/09_RECIPIENT_FIRST_COPY.md`](../docs/ai-rules/09_RECIPIENT_FIRST_COPY.md)。診断シェルの使い方は [`../templates/diagnosis-shell/README.md`](../templates/diagnosis-shell/README.md)。

## このリポジトリで変えた面

| 面 | 状態 | 何を変えたか |
|---|---|---|
| `templates/diagnosis-shell/` の Web 描画 | 実装済み | 結果のあとで、自分ごと、得られること、今と後、任意の料金リンクと LINE。補完は呼び出し側が実在の料金とリンクを渡したときだけ |
| `site/lp/index.html` | 実装済み | 無料の一次診断を任意のメールにした。継続運用とアプリ内課金は、表にある額のまま任意。Web を包む方法は、速さ・ログイン・課金が不要なときの軽い道 |
| `docs/ai-rules/09_RECIPIENT_FIRST_COPY.md` | 実装済み | 全プログラムで使う書き方 |
| アプリ / 拡張の描画 | 変更なし（出さない） | 紹介・有料・LINE は出さない。テストで固定 |
| Stripe 購入完了メールの送信本文 | 変更なし | コメントアウトの関連案内も、送られる HTML は変えていない |
| LINE のステップ配信と発信ルーティンの送る文 | 変更なし | 配信の本文は動かしていない |
| 価格、課金処理、ストアのリリース定義 | 変更なし | LP の JSON-LD の 0 / 30000 / 300000 円はそのまま |

## このリポジトリの中で、補完として置いたもの

置いた位置は、料金の表を読んだあとである。これは「支払いを見た直後の方が買いやすい」という仮説にもとづく位置で、その仮説はページには書いていない。

| 主の用事 | 任意の二つ目 | 一文 | 料金の出所 | 見送り |
|---|---|---|---|---|
| 構築・ストア提出 | 継続運用 | 構築を頼むと証明書とストア規約の更新が残るので、継続運用を足すと、その更新を同じ運用の中で任せられます。 | 同じページの表。¥30,000 / 月。構築費とは別 | 構築だけでも受け、更新作業は依頼元に戻る。アカウントは依頼元名義 |
| ウェブで代金を受けているサービスのアプリ化 | アプリ内課金の設定 | ウェブでいま受けている支払いを、ストアのアプリからも受け取れるようにします。 | 同じページの表。+¥100,000。自動加算なし。合計の自動計算はしない | 課金が無ければ不要。構築だけの依頼はできる |

精密診断（¥30,000、60分）は、一次診断を深くしたもので、同じ用事の二つ目ではない。ボタンは足していない。

無料の一次診断は、まだ頼む前の軽い道である。メールだけでは契約も課金も始まらない。

## 変えていない既存の導線

| 場所 | 何があるか | 今回 |
|---|---|---|
| `templates/stripe-checkout-email/functions/api/stripe-webhook.ts.template` | 購入後のダウンロード案内。関連案内は HTML コメントの中 | 送信文は未変更。有効化に必要な実在の商品 URL と料金は、この金型だけでは決まらない |
| `templates/web/app-download-section.html` | ストアの公式バッジ。ネイティブ実行時は出さない。文面に「完全無料・登録不要」とある | 有料の二つ目は、このファイルの中に実在しないので足していない |
| `docs/LINE-HARNESS-OPERATION-GUIDE.md` | 友だち追加後の5通。行き先は `https://kimito-link.com/utilized-multiple-ways/`、`https://kimito-link.com/`、`https://kimito-link.com/kobou/` | 配信本文は未変更 |
| `docs/DISTRIBUTION-ROUTINE.md` | 発信の型。合言葉と LINE は1種類。金額を書かない、という既存の決まり | 送る文は未変更 |
| 診断シェルの見本 `check-page.html` | `https://line.me/R/ti/p/@example` と `/price/` | 例示のまま。継続運用の額は載せていない |

## 名前と、このリポジトリで確認できた URL

依頼文にあった名前と、ファイルに書いてあった参照を分ける。下の URL は、この作業で他リポジトリを変更したという意味ではない。

| 依頼にあった名前 | このリポジトリでの確認 | 確認できた URL | 次にやること |
|---|---|---|---|
| WEB健康診断 | 公開名は「君斗りんくのWEBサイト健康診断」。`site/assets/data/api-projects.json` と `site/assets/data/showcase.json` | https://github.com/kimito-link/web-health-check-app 、https://app.web-health-check.link/ 、https://web-health-check-app.vercel.app | そのリポジトリの Web 結果画面に、このシェルの Web 文面を載せる。アプリと拡張には載せるな。LINE の URL がその設定に実在するときだけ LINE を出す |
| マルウェアチェック.site | ショーケースの公開名は「サイト侵害チェック」。GitHub の PR URL が `_docs/apple-account-inventory-2026-10-18.md` にある | https://malwarecheck.site/ 、https://malwarecheck.site/check/ （`site/index.html`）、https://github.com/kimito-link/malwarecheck.site/pull/165 | 同上。ストア審査中とショーケースにあるので、ストア面の文面は変えない |
| AIの健康診断 | フォルダ名 `ai-health-check.link` と表示名が `_docs/MAP-github-root-cleanup-2026-09-08.md` にある | GitHub の URL はこのリポジトリの検索では見つかっていない | URL と、Web に実在する料金を開いてから文面を書く |
| 口コミチェック.jp | `api-projects.json` | https://github.com/kimito-link/reviewcheck.jp 、https://reviewcheck-jp.vercel.app | Web の結果と料金ページだけ。料金の数値はそちらの実装を見て写す |
| サジェスト汚染チェッカー | 名称は `_docs/MAP-github-root-cleanup-2026-09-08.md` などにある。`_docs/DESIGN-two-channel-acquisition-strategy-2026-09-01.md` の金額は目安で、確定価格ではない | 公開のリポジトリ URL は、このリポジトリの検索では見つかっていない | 目安の金額ではボタンを作らない |
| リバースハック | ショーケースに公開サイトとストア URL。フォルダ名 `partnership_program_website` は別の記述で、同一 URL とは書いていない | https://partner.reverse-re-birth-hack.com/ 、https://apps.apple.com/jp/app/id6769407908 、https://play.google.com/store/apps/details?id=com.reversehack.partner | Web だけ。ストアの説明文には LINE も料金の勧誘も足さない |
| 君斗りんく | 上記の WEB 健康診断の公開名の一部。独立した別 URL は、この表の健康診断の行と分けて確認できていない | 健康診断の行を参照 | 別商品として扱わない |
| line-bot と LP | このリポジトリの `templates/line-bot/` と `site/line-bot-hub/`。実証名は `line-harness-oss` と ai-shain.link | https://kimito-skill.link/line-bot-hub/ 、https://kimito-skill.link/line-bot/ 、https://kimito-skill.link/line-bot-features/ | 開発者向けの説明ページに、利用者登録の勧誘は足していない。配信本文は未変更 |
| kimito.link | ショーケースでは審査中 | https://kimito.link/ | 公開 Web の既存導線を見てから。ストア面は対象外 |
| 返信サジェスト | `henshin-hisho` は「AI返信秘書」。`reply-copilot-openrouter-v2` はパス名だけ | https://github.com/kimito-link/henshin-hisho 。返信サジェストの GitHub URL は未確認 | 同名と決めつけず、開いたリポジトリの Web だけを対象にする |
| kimito-Link-Voice | `_docs/instruments/check-drift.mjs` のパス | 公開 URL は未確認 | URL がファイルにあることを確認してから |
| bestprice | `api-projects.json` | https://github.com/kimito-link/bestprice 、https://bestprice-ten.vercel.app | 判定のあとにある実在の発送手順だけを、そのリポジトリで確認してから補完にする。このリポジトリの発信文は変えていない |
| best-trust.biz | メール `info@best-trust.biz`。フォルダ名は drift の記述 | https のサイト URL は、この作業ではファイルから写していない | 公開 URL を開いてから法人サイトの文面を見る |
| partnership | フォルダ名 `partnership_program_website` | 上のリバースハックの公開 URL とは、ファイル上は結んでいない | フォルダの remote を見てから Web だけを対象にする |
| 送信サジェスト | ショーケース。依頼名の一覧には無いが、同じ公開データの中にある | https://soushin-suggest.link/ 、https://soushin-suggest.link/check-shindan-version/ | 買い切りの料金は Stripe 金型の README が ¥980 と書いている。メール本文は未変更。補完は、そのリポジトリに実在する関連商品があるときだけ |

この表に無いプログラムへ、この PR はファイルを置いていない。

## 根拠として使ったもの / 使わなかったもの

使ったもの:

- 診断シェルの実装。結果は端末内、次の確認は画面の日付、サーバープッシュはしない（`templates/diagnosis-shell/README.md`）。
- LP の既存の表。一次診断は無料、精密診断は ¥30,000、構築は ¥300,000〜、アプリ内課金は +¥100,000、継続運用は ¥30,000 / 月（`site/lp/index.html`）。
- 契約終了時はアクセス権を外す、アカウントは依頼元名義、という既存の FAQ。

使わなかったもの:

- 60秒で分かること。測った記録がこのページに無かったので、その言い方は外した。
- ショーケースの「4+」は、今回の新しい文面には使っていない。既存の表示はそのまま。
- サジェスト汚染の設計メモにある金額。確定価格ではなかった。
- 配信数、登録率、値引き、残数。この作業の文面には書いていない。

## 残作業

1. 上の表で URL があるプログラムの Web だけを、そのリポジトリで開く。
2. そのプログラムに実在する料金と、同じ用事を楽にする二つ目があるかを、そのリポジトリの画面で確認する。無ければ書かない。
3. アプリ、拡張、ストア説明には、この案内をコピーしない。
4. 配信シナリオと購入メールは、補完の URL と既存料金が揃ってから文面を差し替える。差し替えるまで送らない。

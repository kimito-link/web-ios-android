# 12_LINE_SIMULATION — LINE Bot の挙動を、スマホなしで本番のまま確かめる（全 LINE Bot 共通）

> **今の到達点: 採用（2026-11-16）。** 出典: kimito-link/linebot（2026-10-14〜11-16、PR #258 ほか）。本番E2E 39/39 で実証済み。
> 役割: 「スマホで押して確かめて」と人に頼む前に、AI が自分で LINE の利用者になって本番の Bot を確かめる型を1か所に置く。
> 使い方: LINE Bot を直した・足したら、人に頼む前にこれを回す。入れ方・部品は [`templates/line-bot/e2e/README.md`](../../templates/line-bot/e2e/README.md)。
> 関連: [08_NO_HUMAN_HANDS.md](08_NO_HUMAN_HANDS.md) §2 の4番（AI が自分で見て・読んで・続ける）の LINE 版／
> [04_SELF_VERIFICATION.md](04_SELF_VERIFICATION.md)（「動くはず」で報告しない）／
> [11_NO_REGRESSION.md](11_NO_REGRESSION.md)（台本＝消えたら困る機能の一覧として毎回通す）。

## 0. 一言でいうと

**LINE Bot の確認は、人のスマホではなく「偽の利用者」で本番に話しかけて、返事を記録から読む。**
人に「LINEで押してみて」「スマホで送ってみて」と頼む確認の大半は、これで置き換えられる。

## 1. 決まり

1. LINE Bot の挙動（文字を送る・ボタンを押す・ファイルや画像を送る・友だち追加）を確かめるときは、まず LINEシミュレーションを使う。
   人に頼むのは、これで再現できないもの（LINE アプリ自体の表示崩れ・通知の鳴り方・本物の決済など）だけ。そのときは
   08 の「人に頼む理由: …」に「LINEシミュレーションで再現できない: <何が>」と書く。
2. LINE の確認で画面操作（computer-use）を考える前に、これを先に使う。
   プロジェクトのスレッドからの computer-use は、チャットで許可しても即 `user_denied` になった（2026-11-16 実測）。
3. 新しい LINE Bot を作る・既存の Bot に機能を足すときは、部品（§2）を入れ、台本に1項目足す。台本は「消えたら困る機能の一覧」として毎回ぜんぶ通す。
4. 報告は「何項目中いくつ通ったか」と Actions の結果の URL を添える（例: 39/39）。

## 2. しくみ（3つの部品）

| 部品 | 何をするか | 実体 |
|---|---|---|
| ① 偽の利用者ID（入口） | 本番に「E2E 用の偽の利用者ID」を1つ決めて設定値に持つ。スクリプトはこのIDを送り主にしたイベントを作り、チャネルシークレットで署名（`x-line-signature`）して本番 webhook に POST する。LINE のサーバーから届いたものと見分けがつかないので、本番の受付処理がそのまま動く | `templates/line-bot/e2e/line-sim.mjs`（`post`/`say`/`tap`/`follow`/`sendFile`） |
| ② 送信の記録（出口） | 偽の利用者に関わる返信・push は LINE に送らず、D1 に「送るはずだったもの」として記録する。プロフィール取得なども偽の値を返す。スクリプトは記録を読み、本文・ボタンの文字・postback・URL を取り出して確かめる | `e2e-capture.ts` の `captureLineClient`（LineClient を Proxy で包むだけ） |
| ③ LINE 側にしか無いものの差し替え | ファイル・画像の中身は LINE の content API（`api-data.line.me`）からしか取り出せず、本人のトークでしか作れない。偽の利用者のときだけ、messageId が `e2e-file:<名前>` の取り出しを D1 に置いた中身（base64）に差し替える。ほかに「LINE にしか無いもの」が出たら同じく足す | `e2e-capture.ts` の `e2eFileFetch`（依存注入の `fetch` に渡すだけ） |

AI の回答・データ保存・課金リンク・持ち主への通知まで、本番の処理を1行も変えずに通る。

## 3. 安全の決まり（外さない）

- 差し替え・記録は「設定済みの偽の利用者ID」と**完全一致**のときだけ。実在の人には一切効かない。未設定・形が違う設定値なら誰にも効かない（fail-closed）。
- 差し替える中身を置けるのは D1 に書ける者だけ＝外から悪用できない。署名は本物のチャネルシークレットで作る（webhook の検証は緩めない）。
- お支払いは実行しない（リンクに正しい印がつくかだけ見る）。メールを送る Bot は宛先を `.invalid` にし、送信の手前で必ず止める。
- 終わったら、作ったもの・知識・記録・置いた中身を**必ず finally で**消す。始める前にも消す。
- E2E は1本ずつ順番に走らせる（記録の置き場所が共有のため。GitHub Actions の `concurrency` で直列化、`cancel-in-progress: false`）。
- チャネルシークレットは GitHub Secrets から渡し、ログに出さない（`::add-mask::`）。新しく secret を入れるのは「戻せない操作」なので本人の OK の後。

## 4. 実例（linebot の分身E2E、39項目）

LP → 相談LINEでメニュー選択 → 分身を作る → 文章を送る → 設定ページで決まりを保存 → 10万字の貼り付け →
CSV(Shift_JIS)・Markdown・Excel・Word・PowerPoint を送る → テストで質問して答えを確認 → 公開・共有リンク →
お支払いリンク → 別の人として共有リンクから話す → 答えられない質問が持ち主へ届く → 会話をやめる。
実体（kimito-link/linebot）: `.github/workflows/e2e-bunshin.yml`（workflow_dispatch）・`scripts/e2e-bunshin.mjs`・`scripts/fixtures/bunshin/`・
`apps/worker/src/services/e2e-capture.ts`・`apps/worker/src/services/pptx-text.ts`。

## 5. 地雷

- **ボタンの文字は `action.label` にあり `text` には出ない**。記録から確かめるときは label も拾う（`line-sim.mjs` の `texts()` は `L:`・`PB:`・`URI:`・`[altText]` に平らにする）。
- **Workers AI の toMarkdown は PowerPoint（.pptx）・.doc・.ppt・.rtf・.odp に非対応**（[公式の対応表](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/supported-formats/)）。
  .pptx は ZIP なので `DecompressionStream('deflate-raw')` で自前で読める（`templates/line-bot/worker/src/services/pptx-text.ts`）。
- **Excel が書き出す日本語 CSV は Shift_JIS**。Workers は `compatibility_flags` に `text_decoder_cjk_decoder` を入れれば `TextDecoder('shift_jis')` が使える。
- **本番と同じ実行エンジン（workerd）で部品だけ試すなら miniflare**。本番と同じ `compatibility_date` / flags を渡し、バンドルしたコードを `script` で渡す（`scriptPath` に `..` を含むパスだと起動しない）。
- **バイナリの試験ファイルは `.gitattributes` で `-text`**（`eol=lf` の正規化で化けて、変換失敗の誤った赤になる）。
- **LINE への送信を `fetch` で直接書いている所は記録に乗らない**（本物が飛ぶ）。送信は LineClient 経由にそろえる。
- **プロジェクトのスレッドからの computer-use は即 `user_denied`**（チャットで許可しても）。LINE の確認はこのシミュレーションが先。

## 6. 測り方（文章だけにしない）

- `check-human-handoff` hook（`.claude/hooks/`）が、「スマホ／LINE で押して・送って・確かめて」と人に頼む文を、理由の一行なしでは止める（2026-11-16）。
- 部品の試験: `templates/line-bot/worker/src/services/e2e-capture.test.ts`（完全一致だけ効く・送信は本物を呼ばない・置いていない名前は404）。
- 送る側の道具の自己試験: `node templates/line-bot/e2e/line-sim.mjs --selftest`。

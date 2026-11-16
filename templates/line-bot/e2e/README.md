# templates/line-bot/e2e/ — LINEシミュレーション（スマホなしで本番のまま確かめる型）

決まりと理由の正本は [`docs/ai-rules/12_LINE_SIMULATION.md`](../../../docs/ai-rules/12_LINE_SIMULATION.md)。ここは「入れ方」だけ。
出典: kimito-link/linebot（2026-10-14〜11-16、PR #258 ほか）。本番E2E 39/39 で実証済み。

## 何ができるか

利用者が LINE でやること（文字を送る・ボタンを押す・ファイルや画像を送る・友だち追加）を、
スマホも PC の LINE アプリも使わずに**本番の Worker へそのまま**流し、Bot が返すはずだった返信・push を
**実在の人に届けずに記録して**中身を確かめる。AI の回答・データ保存・課金リンク・持ち主への通知まで、本番の処理を通す。

## 中身

| ファイル | 役割 |
|---|---|
| [`../worker/src/services/e2e-capture.ts`](../worker/src/services/e2e-capture.ts) | Worker 側の部品。`isE2eUser`（完全一致だけ）・`captureLineClient`（送信→記録）・`e2eFileFetch`（LINE の中身→置いたもの） |
| [`../worker/src/services/e2e-capture.test.ts`](../worker/src/services/e2e-capture.test.ts) | 上の部品の試験（vitest） |
| [`../migrations/002_e2e.sql`](../migrations/002_e2e.sql) | 記録 `e2e_capture` と置き場所 `e2e_files` |
| [`line-sim.mjs`](line-sim.mjs) | 送る側の道具。署名して POST → 記録を読む → `check` → `report`。`node line-sim.mjs --selftest` |
| [`e2e-scenario.example.mjs`](e2e-scenario.example.mjs) | 台本のひな型（友だち追加→質問→ボタン→ファイル） |
| [`e2e-line.yml.template`](e2e-line.yml.template) | GitHub Actions（workflow_dispatch・1本ずつ直列） |
| [`../worker/src/services/pptx-text.ts`](../worker/src/services/pptx-text.ts) | ついで: PowerPoint の文字を自前で読む（Workers AI の toMarkdown は .pptx 非対応） |

このキットの `templates/line-bot/worker` には、もう配線してある（`routes/webhook.ts` で偽の利用者のときだけ差し替え）。

## 入れ方（このキットから作った Bot）

1. 偽の利用者IDを決める（実在しないID。ランダムで作る）:
   `node -e "console.log('U'+require('crypto').randomBytes(16).toString('hex'))"`
2. Worker に渡す: `npx wrangler secret put E2E_USER_ID`（秘密ではないが、このキットは `[vars]` を置かない決まり）。
3. D1 に表を作る: `npx wrangler d1 execute {{shortName}}-line-db --remote --file=migrations/002_e2e.sql`
4. `e2e/` 一式を導入先の `line-bot/e2e/` にコピーし、`e2e-scenario.example.mjs` を `e2e-line.mjs` にして Bot に合わせて書く。
   試験ファイルは `e2e/fixtures/` に置く。
5. `e2e-line.yml.template` を `.github/workflows/e2e-line.yml` に置き、`{{shortName}}` を置換。
   GitHub の Variables に `LINE_WEBHOOK_URL`・`LINE_E2E_USER_ID`、Secrets に `LINE_CHANNEL_SECRET`（`CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ACCOUNT_ID` はデプロイ用と共用）。
   ★secret を入れるのは「戻せない操作」なので、AI は本人の OK の一言をもらってから `gh secret set` する（値は保管済みのものを取り出すだけ）。
6. `.gitattributes` に `line-bot/e2e/fixtures/** -text`（バイナリの試験ファイルを改行の正規化で壊さない）。
7. デプロイ後に workflow を走らせる（`gh workflow run e2e-line.yml`）。結果は Actions の Summary に ✅/❌ で出る。

## 入れ方（このキットから作っていない、ほかの LINE Bot）

1. 偽の利用者IDを設定値に足し、webhook の入口で `isE2eUser(event.source.userId, env.E2E_USER_ID)` のときだけ
   `captureLineClient(lineClient, db)` を使う。★LINE への送信を `fetch` で直接書いている所があれば、そこも LineClient 経由にする（記録に乗らず本物が飛ぶ）。
2. LINE にしか無いもの（`api-data.line.me` のファイルの中身など）の取り出しを、`fetch` を引数で渡せる形（依存注入）にし、偽の利用者のときだけ `e2eFileFetch(db)` を渡す。
   ほかに「LINE にしか無いもの」が出たら、同じく偽の利用者のときだけ差し替える部品を足す。
3. 記録の置き場所は、表を足せないなら既存の設定表の1行でもよい（linebot は `account_settings` の `__e2e__` 行に追記している）。
4. 以降は上の 4〜7 と同じ。

## 安全の決まり（外さない）

- 差し替え・記録は「設定済みの偽の利用者ID」と**完全一致**のときだけ。未設定・形が違えば誰にも効かない（`isE2eUser` が fail-closed）。
- 差し替える中身を置けるのは D1 に書ける者だけ＝外から悪用できない。署名も本物のチャネルシークレットで作るので、webhook の検証はそのまま。
- お支払いは押さない（リンクに正しい印がつくかだけ見る）。メールを送る Bot は宛先を `.invalid` にし、`isNeverSendAddress` で必ず止める。
- 終わったら、作ったもの・記録・置いた中身を**必ず finally で**消す。始める前にも消して前回の残りを掃除する。
- 1本ずつ順番に走らせる（記録の置き場所が共有。workflow の `concurrency`）。

## 地雷（踏んだもの）

- **ボタンの文字は `action.label` にあり `text` には出ない**。`texts()` は `L:`（label）・`PB:`（postback）・`URI:`・`[altText]` に平らにする。
- **Workers AI の toMarkdown は .pptx・.doc・.ppt・.rtf・.odp 非対応**（[公式の対応表](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/supported-formats/)）。.pptx は ZIP なので `pptx-text.ts`（`DecompressionStream('deflate-raw')`）で読む。
- **Excel が書き出す日本語 CSV は Shift_JIS**。`wrangler.toml` の `compatibility_flags` に `text_decoder_cjk_decoder` を入れると `new TextDecoder('shift_jis')` が使える。
- **バイナリの試験ファイルは `.gitattributes` で `-text`**。`eol=lf` の正規化で xlsx・pptx が壊れ、「変換できない」と誤った赤になる。
- **部品だけ本番と同じエンジン（workerd）で試すなら miniflare**。本番と同じ `compatibilityDate` / `compatibilityFlags` を渡し、バンドルしたコードを `script` で渡す（`scriptPath` に `..` を含むと起動しない）。
- **動画・音声は「変換できた？」の問い合わせ（`/content/transcoding`）が先に来る**。`e2eFileFetch` はいつも「できた」と答える。
- **LINE の確認で画面操作（computer-use）を考える前に、まずこれ**。プロジェクトのスレッドからの computer-use は、チャットで許可しても即 `user_denied` になった（2026-11-16）。

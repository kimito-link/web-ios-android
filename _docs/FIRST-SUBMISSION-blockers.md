# 初回提出ブロッカー全リスト（iOS / Android）— 順番に必ず出る

> **新規アプリの「いちばん最初の1回」だけ**踏む詰まりを、**実際に出た順番**で並べた実戦記録。
> malwarecheck.site の iOS 初回提出（2026-07-01・`com.reversehack.malwarecheck`）で
> `WAITING_FOR_REVIEW` に到達するまでに踏んだ全ブロッカーを一般化したもの。
>
> 2回目以降は `release-pipeline-playbook.md` §7（push 一発）で済む。**初回だけ**ここを上から潰す。
> 各項目に「症状（CIログの文言）」「原因」「直し方」を書いた。grep しやすいよう英語エラーも残す。

---

## 使い方

新規アプリで `ios-appstore-release.yml`（dry_run なし＝本番）を初めて回すと、
**ビルドは通っても "Submit App Store version for review" が必須項目不足で何度も 409 で落ちる。**
Apple は「足りないものを1つずつ」しか教えてくれないので、下記を**上から順に**先回りで埋めておくと
リトライ回数を最小化できる。理想は「初回提出の前にこのチェックリストを全部 ✓」。

> 💡 **dry_run を先に通す**: 本番提出の前に `-f dry_run=true` でビルド〜IPA生成だけ検証する
> （Apple に何も送らない）。ビルド系の詰まり（B1〜B5）はここで全部潰せる。提出系（B6〜B8）は
> dry_run では出ない（提出をスキップするため）ので、本番1回目で順に出る。

---

## 前提: デベロッパー登録は両ストアで完了済み（2026-07-06 時点・確定事実）

> ⚠️ **AI へ: 毎回「Apple/Google のデベロッパー登録が必要では？」と聞かないこと。両方とも登録・審査完了済みで、実際に複数アプリを配信中。** これはブロッカーではない。以下は確定事実。

**Apple Developer / App Store Connect**（Apple Developer Program 登録済み・年会費支払い済み）:
- App Store Connect に **8アプリ登録済み**で稼働中。「配信準備完了(Ready for Distribution)」の実績あり:
  リバースハック(iOS 1.0.17)、富士山コンパス(iOS 2.4.16)、ゆっくりエクソソーム(iOS 0.1.1)、
  kimito.link(iOS 0.1.1)、君斗りんくのWEBサイト健康診断(iOS 1.0.0)、リバースハックWEB健康診断(iOS 1.0.1)、
  CC/BCC再送信(iOS 1.0.0 審査待ち)、マルウェアチェック.site(iOS 0.1.0 審査待ち)。
- ⇒ Apple Team は確立済み。新規アプリは App Store Connect で App レコードを1つ作り `ascAppId` を採番するだけ。

**Google Play Console**（Android デベロッパー確認要件を満たし済み）:
- **組織アカウント名 `kimito-link`**（アカウント ID: **6880871170619890401**）。
- 「すべてのアプリの登録が完了し、Android デベロッパーの確認要件を満たしています」表示済み。
- **8アプリ登録済み**で稼働中。製品版(Production)配信の実績あり:
  富士山コンパス(`com.kimito.link.fujisanco...`, 製品版・70インストール)、
  リバースハック(`com.reversehack.partner`, 製品版)、君斗りんくのWEBサイト健康診断(製品版)、
  ゆっくりエクソソーム(`com.kimito.link.yukkuriex...`, 製品版)、ほか内部テスト/審査中が複数。
- ⇒ Play 開発者アカウントは確立済み。新規アプリは Play Console でアプリを1つ作り採番するだけ。

**したがって新規アプリ(surechigai 等)で「実際にビルドが通れば提出できる」状態**。残るのは各アプリ固有の:
`ascAppId`(App Store Connect の App 採番) / `playAppId`(Play Console のアプリ採番) / 署名鍵の紐付け(B1/B4/B7系) /
このドキュメントの B1〜B8 の技術ブロッカー。**アカウント登録そのものは済んでいる。**

> パッケージIDの命名: 既存は `com.kimito.link.<app>` 系 と `com.reversehack.<app>` 系が混在。
> surechigai は `com.surechigairomi.app`(app.config.json)で採る予定 — 既存の命名規則とは別系統な点に注意
> （必要なら `com.kimito.link.surechigai` へ寄せるか要判断。ただしパッケージIDは配信後変更不可）。

---

## A. ビルド系ブロッカー（dry_run で検出できる）

### B1. `APPLE_TEAM_ID` が空で登録されている
- **症状**: `Validate required secrets` ステップで `Missing required secrets: APPLE_TEAM_ID`。
- **原因**: Team ID を `security cms`（macOS 専用）で取ろうとして Windows で空になり、空のまま `gh secret set` した。
- **直し方**: 配布証明書から openssl で取る。
  ```bash
  openssl x509 -inform DER -in distribution.cer -noout -subject
  # 出力の OU=XXXXXXXXXX（10桁）が Team ID
  echo -n "XXXXXXXXXX" | gh secret set APPLE_TEAM_ID --repo <owner/repo>
  ```

### B2. `pnpm-lock.yaml` が古い（モノレポに mobile を足した後）
- **症状**: `Install dependencies` で `ERR_PNPM_OUTDATED_LOCKFILE ... not up to date with apps/mobile/package.json`。
- **原因**: `apps/mobile/package.json` に Capacitor 依存を足したのに lockfile を更新していない。CI は `--frozen-lockfile`。
- **直し方**: `pnpm install --lockfile-only` → commit。

### B3. スプラッシュ生成スクリプトがコピー元のロゴパスを参照している
- **症状**: `Generate or reuse 1024 app icon + splash` で `Error: logo not found: .../client/public/logo-reversehack.png`。
- **原因**: `generate-capacitor-splash.mjs` の `LOGO_SRC` が**コピー元アプリ**のパス（Vite 系 `client/public/...`）のままハードコード。新アプリは Next.js 系 `apps/web/public/...` 等で構成が違う。
- **直し方**: ロゴ候補を配列で複数フォールバックにし、新アプリの実パス（作成済みアイコン
  `store-assets/source/icon-source-1024.png` を第一候補に）を入れる。背景色も新アプリのブランド色に。
- **教訓**: コピー元のスクリプトには「コピー元固有のハードコードパス」が必ず残る。新アプリの
  ディレクトリ構成（client/ か apps/web/ か）に合わせて grep して洗う。

### B4. Export IPA で「Provisioning profile doesn't include signing certificate」
- **症状**: `Export IPA` で `error: exportArchive Provisioning profile "..." doesn't include signing certificate "Apple Distribution: ..."`、exit 70。
- **原因**: アカウントに**配布証明書が複数**あると、Profile に紐付けた証明書と、署名に使う証明書
  （Secret の `.cer`）が食い違う。Profile を「期限が最新の証明書」で自動作成すると、Secret の
  証明書と別物になりがち。
- **直し方**: Profile を作るとき、**Secret の `.cer` のシリアルに一致する証明書**を選ぶ。
  ```bash
  openssl x509 -inform DER -in distribution.cer -noout -serial
  # serial=0EB4EBA4...（openssl は先頭ゼロ付き）
  CERT_SERIAL="0EB4EBA4..." node scripts/asc-create-profile.mjs   # シリアル一致で Profile 作成
  ```
- **罠**: openssl は serial を**先頭ゼロパディング付き**で出すが、ASC API は**先頭ゼロを落として**保持する
  （`0EB4EB...` vs `EB4EB...`）。シリアル比較は**先頭ゼロを除いて**行うこと。

### B5. `@playwright/test` が依存に無い（スクショ自動撮影が落ちる）
- **症状**: `Capture App Store screenshot` で `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "playwright" not found`、exit 254。
- **原因**: `capture-appstore-screenshots.mjs` は `@playwright/test` を import するが、新アプリの依存に無い。
- **直し方**: `pnpm add -w -D @playwright/test` → commit。CI の `pnpm exec playwright install --with-deps chromium` が効くようになる。

---

## B. 提出系ブロッカー（本番1回目で順に出る・dry_run では出ない）

> ここからは "Submit App Store version for review" ステップ内の `appstore-submit.mjs` が
> 出すエラー。**Apple は1つずつしか教えない**ので、下記を**事前に全部**埋めておくと一発で通る。

### B6. 審査連絡先の電話番号が無効
- **症状**: `POST /v1/appStoreReviewDetails -> 409 ENTITY_ERROR.ATTRIBUTE.INVALID`、
  `detail: The phone number must be in a valid format. Preface with '+' followed by country code`。
- **原因**: `app.config.json` の `contact.phoneE164` がプレースホルダ（`+81 90 0000 0000` 等）のまま。
  Apple は偽番号を弾く。
- **直し方**: **実在する番号**を E.164 形式で Secret に。
  ```bash
  echo -n "+81 90 1234 5678" | gh secret set IOS_REVIEW_CONTACT_PHONE --repo <owner/repo>
  ```
  （`IOS_REVIEW_CONTACT_PHONE` は app.config の値を上書きする。審査員専用・非公開）。

### B7. `contentRightsDeclaration` が未設定
- **症状**: `POST /v1/reviewSubmissionItems -> 409 STATE_ERROR.ENTITY_STATE_INVALID`、
  associatedErrors に `ENTITY_ERROR.ATTRIBUTE.REQUIRED: You must provide a value for the attribute 'contentRightsDeclaration'`。
- **原因**: app 本体の「コンテンツ配信権（第三者コンテンツを含むか）」が未宣言。`asc-create-app.mjs` の
  appInfo PATCH では設定されない（別属性）。**ASC UI で設定しても反映されないことがある**。
- **直し方**: API で app リソースに直接 PATCH するのが確実。
  ```bash
  node scripts/asc-set-content-rights.mjs   # DOES_NOT_USE_THIRD_PARTY_CONTENT を PATCH /v1/apps/{id}
  ```

### B8. App プライバシー（データ収集の回答）が未「公開」
- **症状**: `POST /v1/reviewSubmissionItems -> 409`、associatedErrors に
  `/v1/appDataUsages/: Answers to what data your app collects and how it's used are needed.
  You must have published answers to your app's data usages.`
- **原因**: App プライバシーの「データ収集の質問」と「プライバシーポリシーURL」が未完了、
  または**回答したが「公開（Publish）」していない**。保存だけでは反映されない。
- **直し方**（ASC UI 手動・API は構造が複雑なので UI 推奨）:
  1. ASC → アプリ → 左メニュー **「アプリのプライバシー」**。
  2. データ収集: 個人を特定・追跡しないツールなら **「データを収集していません」**。
  3. **プライバシーポリシーURL** を入力（例 `https://<domain>/privacy/`・ページが実在すること）。
  4. **右上の「公開」ボタンを必ず押す**（"published answers" が要件＝保存だけでは不可）。
  5. 「○分前に公開済み」と出れば OK。

---

## C. Android（Play）提出系ブロッカー — 「枠さえ作ればスムーズ」は嘘だった

> 以前このファイルは「Android は Play のアプリ枠さえ作ればスムーズ」と締めていたが、
> malwarecheck.site の Android 初回提出（2026-07-01・`com.reversehack.malwarecheck`）で
> **枠作成後に2つの詰まりを踏んだ**。どちらも「掲載情報が一切反映されない／審査に送信できない」
> という致命的な見た目になるのに、原因がUIやログからは分かりにくい。次アプリで必ず再発する。

### C1. スクショが8枚を超えて edit ごと破棄される（掲載情報が全部消える）
- **症状**: `play-fill-listing.mjs` のログで graphics のアップロード自体は成功（icon/featureGraphic/
  screenshots が `-> https://lh3...` を返す）しているのに、最後の
  `POST /edits/{id}:validate -> 403: "This app has more than 8 screenshots for language ja-JP." PERMISSION_DENIED`
  で落ちる。catch で `edits DELETE` するので **edit ごと破棄され、アイコン・掲載文・グラフィック・
  スクショが全部反映されない**。Play Console の一覧ではアイコンがデフォルトの緑ロボットのまま＝
  「サムネイルがない」に見える。
- **原因**: capture ステップが 6.5" と 6.7" の**両サイズを出すと 1 言語 10 枚**になる。Play の
  phoneScreenshots は **1 言語あたり最大 8 枚**。超過すると validate が弾く。
- **ミスリードの罠**: エラーは 403 PERMISSION_DENIED で返るので、soft-fail が
  「Service Account に CAN_MANAGE_PUBLIC_LISTING 権限が無い」と誤って報告する。**実際は権限では
  なくスクショ枚数**。403 の message を見分けること（"more than N screenshots" は権限問題ではない）。
- **直し方**: `play-fill-listing.mjs` で phoneScreenshots を **8枚に slice**（キット版は
  `PLAY_MAX_PHONE_SCREENSHOTS=8` で実装済み・超過分はログに出す）。さらにキット版は
  `isContentLimit403()` で「枚数超過などの content-limit 403」を権限 soft-fail から除外し、
  真因を大きく出すようにした。**capture 側で 8 枚以内に絞る**のも併用推奨。

### C2. 「審査に送信」ボタンがグレーアウトして押せない（DRAFT を編集し直すと解ける）
- **症状**: 掲載情報・コンテンツ・データセーフティを全部埋めても、「公開の概要（publishing）」の
  **「審査のためにアプリを送信」ボタンがグレーアウト**。「審査のために変更を送信するには、アプリ
  ダッシュボードで必要な手順を完了してください」と出る。ダッシュボードは iOS 風の完了チェックが
  無く、何が足りないのか分かりにくい。
- **原因**: production トラックの **DRAFT リリースが「後で確認するために保存」状態**のまま
  （AAB は乗っているが、リリースが「確認済み」に確定していない）。play-publish.mjs が
  changesNotSentForReview で draft フォールバックした結果、リリースがレビュー未確定で止まる。
- **直し方**（UI 手順・自動化不可）:
  1. **テストとリリース → 製品版 → 「リリースを編集」**（既存 DRAFT を開く。"新しいリリースを作成"
     ではない）。
  2. 内容（App Bundle テーブルに version が載っている・リリースノートがある）を確認して **「次へ」**。
  3. 「プレビューして確認する」画面で **「保存」**（この時点ではまだ提出ではない）。
  4. ダイアログ「[公開の概要] に移動しますか?」→ **「概要に移動」**。
  5. 公開の概要に戻ると **「N件の変更を審査に送信」ボタンが有効化**されている。これを押す。
- **⚠️ レビュー画面の「リリースでエラーが検出されました」に驚かない**: 実体は
  **警告1件＝「App Bundle に難読化解除ファイル(ProGuard mapping)がありません」**であることが多い。
  **Capacitor / TWA は minify しないので該当なし＝無害・提出をブロックしない**。「エラー」表記だが
  エラー0件・警告1件で送信できる。

### Android 内部 ID の取得（Play Console SPA が直リンクを弾くとき）
- Play Console は `.../app/<appId>/publishing` 等の**直 URL 遷移をアプリ一覧に弾く**ことがある。
  一度アプリ行をクリックして `.../app/<appId>/app-dashboard` に着地すれば、以後 URL の `<appId>`
  （例 `4974258818391969379`）や production の `tracks/<trackId>` が取れる。SPA は本文更新が遅延する
  ので、クリック後は 2〜3 秒待ってからスクショで確認する。
- 一覧のアイコンがデフォルト表示でも**実際は反映済みのことがある**（キャッシュ）。ダッシュボード
  右上のアプリ名横アイコンで正しい素材が出ていれば反映済み。

### Android クイックチェック（送信できた証拠）
- 「N件の変更を審査に送信」→確認ダイアログ「変更を審査に送信」を押すと、公開の概要の見出しが
  **「審査にまだ送信されていない変更」→「審査中の変更」に変わる**（＝送信成功のサイン）。
  同時に「一般的な問題のクイックチェックを実行する（残り約 N 分）」バーが出て、**完了すると自動で
  本審査キューへ**投入される。審査は通常 7 日以内。

---

## まとめ: 初回提出チェックリスト（提出の「前」に全部 ✓）

```
ビルド系（dry_run で検証）
[ ] B1 APPLE_TEAM_ID は実値（openssl で .cer の OU から取得）
[ ] B2 pnpm-lock.yaml 更新済み（mobile 依存追加後）
[ ] B3 splash スクリプトのロゴパスが新アプリ用
[ ] B4 Provisioning Profile が Secret の .cer と同一証明書（CERT_SERIAL 指定）
[ ] B5 @playwright/test を依存に追加

提出系（本番1回目で出る・事前に埋める）
[ ] B6 IOS_REVIEW_CONTACT_PHONE は実番号
[ ] B7 contentRightsDeclaration を API 設定（asc-set-content-rights.mjs）
[ ] B8 App プライバシー: データ収集回答 + privacyURL を入力して「公開」

ASC UI 手動が要る項目（API で効かない）
[ ] カテゴリ（プライマリ・必要ならセカンダリ）
[ ] 年齢制限指定（質問に答えて 4+ 等を確定）
[ ] サブタイトル（30字以内・ASO 効く）
[ ] コンテンツ配信権（B7 で API 設定できれば UI 不要）
[ ] App プライバシー公開（B8）

Android（Play）— ビルドは iOS の共通修正が効いてスムーズだが、掲載/送信で詰まる
[ ] C1 phoneScreenshots は 8枚以内（超過で edit ごと破棄・掲載情報が全消え）
[ ] C2 送信ボタンがグレーなら 製品版 DRAFT を「リリースを編集→次へ→保存→概要に移動」で有効化
[ ] レビュー画面の「エラー検出」＝実体は ProGuard mapping 無し警告（Capacitor/TWA は無害）
[ ] アプリのコンテンツ11項目（google-play-submission-playbook.md §2）は API 無し＝手入力
[ ] 最後の「審査に送信」は Play Console UI（WF は冪等スキップで止まる＝仕様）
```

> iOS はこれらを埋めれば `appstore-submit.mjs` が
> `PATCH submitted=true` → `final state=WAITING_FOR_REVIEW` を出して**審査キューに入る**。
>
> Android（`android-play-release.yml`）は **ビルド〜AAB アップロードまでは** iOS の共通修正が
> 効いてスムーズ。ただし**掲載情報の反映（C1）と審査送信（C2）で詰まる**ので上記 C セクションを
> 潰すこと。Play 固有の初回手順の全体像は `google-play-submission-playbook.md`。

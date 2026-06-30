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
```

> これらを埋めれば、`appstore-submit.mjs` が
> `PATCH submitted=true` → `final state=WAITING_FOR_REVIEW` を出して**審査キューに入る**。
>
> Android（`android-play-release.yml`）は iOS と違い、Play のアプリ枠さえ作れば
> dry_run 成功 → 本番 Publish までスムーズ（iOS で踏んだ共通修正が効くため）。
> Play 固有の初回手順は `google-play-submission-playbook.md`。

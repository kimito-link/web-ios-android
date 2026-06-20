# 3 プラットフォーム同時リリース・パイプライン（汎用プレイブック）

このドキュメントは、Web / iOS / Android の 3 プラットフォームへ **`git push` 一発で同時にリリース送出する仕組み** を、別アプリでもコピペ + 数値置換で再現するための手順書。

Fujisan Compass で実際に動作検証済みの構成を、アプリ非依存に一般化したもの。

---

## 0. このドキュメントの読み方

### AI（Cursor / Codex 等）向け

- 「他のアプリにも同じパイプラインを入れて」という指示が来たら、**この章を上から順に実行する**。
- 各節に「やること」「コピペ元ファイル」「アプリごとに置換する箇所」が書いてある。判断が必要なときは §8（設計判断と落とし穴）を先に読む。
- ファイル全体の方針はリポジトリ root の `AGENTS.md` を読む。

### 人間向け

- §6（ファースト・タイム・セットアップ）を上から潰していけば、新規アプリで初日に最初のリリースまで持っていける。
- 2 回目以降の運用は §7 だけ見れば足りる。

---

## 1. 全体像

```
release-notes/CURRENT-ja.txt    <-- 1 ファイルで「次回見せる新機能」を書く
            │
            ├─► npm run release:bump  -- patch|minor|major or x.y.z
            │       ├─ package.json (version)
            │       ├─ <android-twa>/app/build.gradle (versionCode +1, versionName)
            │       ├─ sw.js (CACHE_NAME を +1)  ← PWA を使っているとき
            │       └─ CHANGELOG.md  に追記
            │
            └─► git commit + git push (main)
                    │
                    ├─► Web: Vercel / Netlify / 他 が main を自動デプロイ
                    ├─► GitHub Actions: ios-appstore-release.yml
                    │     1. xcodebuild archive → IPA export
                    │     2. App Store Connect API に upload
                    │     3. AppStoreVersion を ensure（無ければ作成）
                    │     4. ja localization に whatsNew を自動入力
                    │     5. build を link
                    │     6. レビュー連絡先を直近の READY_FOR_SALE 版から複製
                    │     7. reviewSubmission を作成 + submitted=true
                    │     ※ すでに WAITING_FOR_REVIEW などの状態なら
                    │       無条件にスキップして workflow を success 終了
                    └─► GitHub Actions: android-play-release.yml
                          1. Gradle で signed AAB ビルド
                          2. Service Account 経由で Play API に upload
                          3. production track に completed リリース作成
                          4. changesNotSentForReview=false で commit → 即レビュー
```

「**人間が触るのは `release-notes/CURRENT-ja.txt` だけ**」を目指している。

---

## 2. 必須前提条件

このパイプラインを採用する前に、以下が揃っていることを前提にしている。揃っていなければ §6 で揃える。

| カテゴリ | 必要なもの |
| --- | --- |
| Apple | Apple Developer Program に有効加入。Team ID / App Bundle ID 確定済み。App Store Connect でアプリ初版が登録済み（最初の手動リリースを 1 度通している） |
| Apple | App Store Connect の **Team API Key**（Personal Key ではない）と、対応する `.p8` |
| Apple | Distribution 証明書（`.cer` + 秘密鍵）と、App Store 用 Provisioning Profile |
| Google | Google Play Console にアプリ登録済み。プロダクション・トラックに 1 度以上手動 push 済み |
| Google | GCP プロジェクトに **Google Play Android Developer API** が有効化されていて、Service Account の JSON が手元にある |
| Google | Service Account が Play Console 側で「リリース管理者」相当の権限で招待済み |
| Android | Upload key の `.jks` と `keystore.properties` が手元にある |
| GitHub | リポジトリで Actions が有効。Settings に Secrets を追加できる権限 |
| Web | `main` への push を自動デプロイする web ホスティング（Vercel など） |

---

## 3. リポジトリに置くファイル

### 3.1 単一ソース

| パス | 役割 |
| --- | --- |
| `release-notes/CURRENT-ja.txt` | 次回リリースの「新機能」テキスト（ja-JP）。常に最新版だけ |
| `release-notes/README.md` | 編集ルール（500 文字上限など） |

### 3.2 スクリプト（汎用、ほぼコピペで使える）

| パス | 役割 |
| --- | --- |
| `scripts/lib/asc-api.mjs` | App Store Connect API の薄いラッパ（ES256 JWT、findApp / listVersions / findBuildByVersion など） |
| `scripts/lib/play-api.mjs` | Google Play Developer API のラッパ（RS256 JWT → OAuth2 access token、editsClient、AAB upload） |
| `scripts/appstore-submit.mjs` | iOS リリース・スクリプト本体（メタデータ自動入力 + 審査提出） |
| `scripts/play-publish.mjs` | Android リリース・スクリプト本体（AAB upload + リリース作成 + 審査提出） |
| `scripts/release-bump.mjs` | バージョンと SW キャッシュ番号を一括 bump |
| `scripts/bootstrap-secrets.mjs` | `.secrets-local/` の鍵ファイルを base64 化して GitHub Secrets に一括登録（§5.2.5） |

### 3.3 GitHub Actions ワークフロー

| パス | 役割 |
| --- | --- |
| `.github/workflows/ios-appstore-release.yml` | macOS runner で iOS をビルドして審査まで送る |
| `.github/workflows/android-play-release.yml` | Ubuntu runner で AAB をビルドして審査まで送る |

### 3.4 ドキュメント

| パス | 役割 |
| --- | --- |
| `_docs/release-one-click.md` | プロジェクト固有の運用手順（このアプリ専用） |
| `_docs/release-pipeline-playbook.md` | このファイル（汎用版） |

### 3.5 npm scripts（`package.json` の `scripts` に追加）

```json
{
  "release:bump": "node scripts/release-bump.mjs",
  "release:bump:patch": "node scripts/release-bump.mjs --patch",
  "release:bump:minor": "node scripts/release-bump.mjs --minor",
  "release:bump:major": "node scripts/release-bump.mjs --major",
  "release:play": "node scripts/play-publish.mjs",
  "release:play:draft": "node scripts/play-publish.mjs --draft",
  "release:play:status": "node scripts/play-publish.mjs --status",
  "release:appstore:submit": "node scripts/appstore-submit.mjs"
}
```

---

## 4. アプリごとに置き換える値

スクリプトとワークフローは **環境変数で上書き可能** に作ってあるので、コードを書き換えるよりも env で制御するのが基本。

### 4.1 環境変数（CI / ローカル両方）

| 変数 | 用途 | 例 |
| --- | --- | --- |
| `APP_BUNDLE_ID` | iOS Bundle ID | `com.example.myapp` |
| `PLAY_PACKAGE_NAME` | Android パッケージ名 | `com.example.myapp` |
| `PLAY_TRACK` | Play のトラック | `production` / `internal` |
| `PLAY_AAB_PATH` | ビルド成果物の場所 | `android-twa/app/build/outputs/bundle/release/app-release.aab` |
| `IOS_BUILD_NUMBER` | CFBundleVersion（CI では `GITHUB_RUN_NUMBER` を流す） | `42` |

### 4.2 コード上の固定値（書き換える前提のもの）

| 場所 | 何を書き換えるか |
| --- | --- |
| `scripts/appstore-submit.mjs` 冒頭 `BUNDLE_ID` のデフォルト | アプリの Bundle ID |
| `scripts/play-publish.mjs` 冒頭 `PACKAGE` のデフォルト | アプリのパッケージ名 |
| `scripts/release-bump.mjs` の SW キャッシュ regex | `'fuji-direction-v(\d+)'` の prefix を新しいプロジェクト用に変える。SW を使っていなければそのブロックを削除 |
| `.github/workflows/ios-appstore-release.yml` の `env: APP_BUNDLE_ID` / `APP_NAME` | アプリの値に |
| `.github/workflows/android-play-release.yml` の `env: PLAY_PACKAGE_NAME` | アプリの値に |
| `package.json` の `version` | 開始バージョン |
| `<android-twa>/app/build.gradle` の `applicationId` / `versionCode` / `versionName` | アプリの値に |

> 慣習として、**iOS の Bundle ID と Android のパッケージ名は揃える**（例: 両方 `com.example.myapp`）。揃えなくても動くが、`scripts/release-bump.mjs` 内の名前空間管理が楽。

---

## 5. GitHub Secrets 一覧

### 5.1 iOS（9 個）

| Secret 名 | 中身 |
| --- | --- |
| `APPLE_TEAM_ID` | Apple Developer の 10 文字 Team ID |
| `APPSTORE_CONNECT_KEY_ID` | Team API Key の Key ID |
| `APPSTORE_CONNECT_ISSUER_ID` | API の Issuer ID（UUID） |
| `APPSTORE_CONNECT_API_KEY_P8_BASE64` | `.p8` を base64 化したもの |
| `IOS_DIST_CERT_CER_BASE64` | 配布証明書 (`.cer` の DER) を base64 化したもの |
| `IOS_DIST_PRIVATE_KEY_PEM_BASE64` | 配布証明書の秘密鍵 (PEM) を base64 化したもの |
| `IOS_DIST_CERT_PASSWORD` | 上記から CI で生成する `.p12` の export password |
| `IOS_APPSTORE_PROFILE_BASE64` | App Store 用 Provisioning Profile (`.mobileprovision`) を base64 化したもの |
| `IOS_DIST_CERT_P12_BASE64` *(任意)* | 直接 `.p12` を渡したいとき。空でも `_CER_` と `_PRIVATE_KEY_` があれば動く |

### 5.2 Android（3 個）

| Secret 名 | 中身 |
| --- | --- |
| `GOOGLE_PLAY_SA_JSON_BASE64` | Service Account JSON を base64 化したもの |
| `ANDROID_KEYSTORE_BASE64` | `android-upload-key.jks` を base64 化したもの |
| `ANDROID_KEYSTORE_PROPERTIES` | `keystore.properties` の中身そのまま（**base64 ではなくテキスト**） |

### 5.2.5 一括登録（推奨・手で1個ずつ入れない）

鍵ファイルを `.secrets-local/`（コミット禁止・gitignore 済み）に置けば、`bootstrap-secrets.mjs` が
全部を base64 化して `gh secret set` で一括登録する。**人間の「12回の手登録」を1コマンドに縮める。**

```bash
node scripts/bootstrap-secrets.mjs            # 何が登録されるか確認（ドライ・鍵の中身は出さない）
node scripts/bootstrap-secrets.mjs --apply    # 実際に gh secret set
node scripts/bootstrap-secrets.mjs --help     # 置くべきファイル名の一覧
```

`APPLE_TEAM_ID` は `app.config.json` の `stores.appleTeamId` から自動で入る。
これで自動化できないのは Apple/Google 側に API が無い 3 点だけ（ASC アプリ枠作成 / Play 新規アプリ作成 /
Sign in with Apple の Services ID・Key 作成）。それ以外の Secret 手登録はこのスクリプトで消える。

### 5.3 base64 化の作り方（PowerShell・手動で作りたいとき）

```powershell
# Apple .p8
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Apple\AuthKey_XXXXXXXXXX.p8")) | Set-Clipboard

# Apple .cer (DER)
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Apple\distribution.cer")) | Set-Clipboard

# Apple private key (.pem)
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Apple\distribution_private.key")) | Set-Clipboard

# Apple .mobileprovision
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Apple\MyApp_App_Store.mobileprovision")) | Set-Clipboard

# Android keystore
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\.android\android-upload-key.jks")) | Set-Clipboard

# Google Play Service Account JSON
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\GooglePlay\service-account.json")) | Set-Clipboard
```

### 5.4 base64 化の作り方（macOS / Linux）

```bash
# macro: base64 -i FILE | pbcopy   (macOS)
# macro: base64 -w0 FILE | xclip -selection clipboard  (Linux)
base64 -i ~/Apple/AuthKey_XXXX.p8 | pbcopy
```

---

## 6. ファースト・タイム・セットアップ手順

### 6.1 Apple 側

1. Apple Developer → Certificates, Identifiers & Profiles で **Apple Distribution 証明書** を作成
   - Windows なら openssl で CSR を作って upload。秘密鍵 (PEM) は **絶対に消さない**
   - ダウンロードした `.cer` と組で 2 ファイルを保管
2. 同じ画面で **App ID** を作成。Bundle ID は `com.example.myapp` の形式
3. **Provisioning Profile** を `Distribution > App Store` で作成し、上記証明書と App ID を紐付け
4. App Store Connect → My Apps で **アプリ登録**（最初の 1 回は手動でリリースまで通す。これで App Review 連絡先などが確定する）
5. App Store Connect → Users and Access → **Integrations** タブ → Team Keys → **Generate API Key**
   - Access: `App Manager` 以上
   - 発行された `.p8` をダウンロード（**一度しか落とせない**）
   - Key ID と Issuer ID をメモ

### 6.2 Google 側

1. Google Play Console にアプリを作成し、プロダクション・トラックに 1 度手動でリリース通す
2. [Google Cloud Console](https://console.cloud.google.com/) で新規プロジェクト作成
3. APIs & Services → Library → **Google Play Android Developer API** を有効化
4. APIs & Services → Credentials → Create Credentials → **Service Account** を作成
   - Roles はとりあえず空で OK（Play Console 側で権限を渡すので）
   - Keys タブ → Add Key → JSON で発行 → ダウンロード
5. Play Console → Users and permissions → Invite new user
   - メールに Service Account の `client_email` を貼る
   - App permissions で対象アプリを選び、「**Releases**」「**Store presence**」あたりに admin 権限
6. キーストアを準備（既存の `android-upload-key.jks` があるならそのまま使う）

### 6.3 リポジトリ側

1. このプレイブックの §3 のファイルをコピーしてくる
2. §4 の置換値をすべて入れる
3. §5 の Secrets を登録（鍵を `.secrets-local/` に置いて `node scripts/bootstrap-secrets.mjs --apply` ＝ §5.2.5）
4. 動作確認：
   - `release-notes/CURRENT-ja.txt` に何か書く
   - `npm run release:bump:patch`
   - `git commit -am "release: 0.1.0"`
   - `git push`
   - GitHub Actions の両ワークフローが Pass することを確認

### 6.4 動作確認時のチェックポイント

| ポイント | OK の証拠 |
| --- | --- |
| iOS: archive → IPA export | Run の `Verify IPA CFBundleShortVersionString` ステップが通る |
| iOS: ASC への upload | Run の `Upload IPA to App Store Connect` ステップが通る |
| iOS: 提出スクリプト | App Store Connect の対象バージョンが「審査待ち」になる |
| Android: AAB ビルド | Run の `Build release AAB` ステップが通る |
| Android: Play 認証 | Run の `Restore Service Account JSON` で `SA JSON parsed OK` が出る |
| Android: 提出 | Play Console のアップデート状況が「審査中」になる |

---

## 7. 標準のリリース手順（毎回やる作業）

```bash
# 1) リリースノートを書き換える
notepad release-notes/CURRENT-ja.txt   # macOS なら $EDITOR

# 2) バージョンを bump
npm run release:bump:patch   # 1.2.3 -> 1.2.4
# またはマイナー / メジャー
npm run release:bump:minor   # 1.2.3 -> 1.3.0
npm run release:bump:major   # 1.2.3 -> 2.0.0
# または明示
node scripts/release-bump.mjs 2.0.0

# 3) コミット + push
git add -A
git commit -m "release: 1.2.4"
git push
```

これで Web / iOS / Android が全部審査ラインに乗る。**1 操作で 3 ストア**。

---

## 8. 設計判断と落とし穴

ここを読まずに改造すると壊しやすい部分。

### 8.1 「審査中ステートではスクリプトを早めに止める」

- 一度審査に出したバージョンに別ビルドを link し直すと App Store Connect が拒否する／レビューを混乱させる。
- `scripts/appstore-submit.mjs` は **build を待つ前に** `listVersions` で対象 marketing version を取得し、`WAITING_FOR_REVIEW` / `IN_REVIEW` / `READY_FOR_SALE` などの状態なら即 return する。
- これにより同じ marketing version で何度 push しても TestFlight にビルドが追加されるだけで、審査の流れを邪魔しない。
- 早めに止めることで **30 分のポーリングが無駄に走らない**（実測：30 分タイムアウト → 1 秒バイパス）。

### 8.2 Google Play の `commit` は `changesNotSentForReview=false` が必須

- 2024+ の挙動として、`/edits/{id}:commit` を呼ぶときにこのクエリパラメータを付けないと、status: `completed` のリリースを作っていても **下書きのまま審査に送信されない**。
- `scripts/play-publish.mjs` は submit モードで自動的にこれを付けている。draft モードのときは付けない。

### 8.3 iOS で必要なのは Team API Key（Personal API Key ではない）

- altool は Personal API Key で 401 を返す。
- App Store Connect → Users and Access → **Integrations タブ** → Team Keys から作ること。**Users タブ**側のキーは Personal Key で、altool で動かない。

### 8.4 macOS の `security import` と OpenSSL 3.x で生成した `.p12` は相性が悪い

- Windows + OpenSSL 3.x で `openssl pkcs12 -export` した `.p12` が、macOS の `security import` で MAC verification failed することがある。
- そのため証明書 (`.cer`) と秘密鍵 (PEM) を **別々の Secret** にして、CI 側で macOS の openssl を使って `.p12` を再生成する **split material 方式** にしている。
- どうしても `.p12` を直接渡したい場合は `IOS_DIST_CERT_P12_BASE64` を使うが、上記の事情があるので非推奨。

### 8.5 Apple は iOS 26 SDK 以降を要求（2026/4 以降）

- GitHub-hosted runner には複数の Xcode が同居しているので、`/Applications/Xcode_26*.app` を選んで `xcode-select` で切り替えるステップが必須。
- 将来 SDK 要求が iOS 27 以降に上がったときも、ワークフローの Xcode 選択 step を変えるだけで追従できる。

### 8.6 Android `keystore.properties` は BOM 付き UTF-8 だと Gradle が NPE

- Windows のメモ帳で保存すると BOM が混入しがち。`build.gradle` 側で BOM 除去している。
- Secret に登録するときは BOM が混ざらないように注意。`Set-Clipboard` 経由のテキストコピーなら基本は安全。

### 8.7 path filter で「再走らせなくていいワークフロー」をトリガーしないようにする

- iOS スクリプト（`scripts/appstore-submit.mjs` など）の修正で **Android workflow が再走らない** ようにするには、Android workflow の `paths` フィルタを `scripts/play-*` 系だけに絞る。
- 逆に共通ライブラリ（`scripts/lib/asc-api.mjs`）の修正は両方トリガーしてもよい場合と、片方だけにしたい場合がある。設計判断で決める。

### 8.8 build 番号は `GITHUB_RUN_NUMBER` を使う

- 連続 push で衝突しないように、CFBundleVersion は CI run 番号を使う。
- `GITHUB_RUN_NUMBER` が 1 以下のとき（手動でローカルから走らせるとき等）は **Unix 時刻にフォールバック** する処理を入れる。

### 8.9 ASC API のフィルタにソートは効かない

- `?sort=-createdDate` を付けると 400 エラー。
- ソートしたい場合は client 側で `Date.parse(uploadedDate)` でソートする。

### 8.10 ASC API の build エンティティは `attributes.processingState` を見る

- API レスポンスの shape は `{ id, type, attributes: { processingState, version, ... }, relationships: {...} }`。
- 直接 `build.processingState` を読むと undefined になる。`scripts/lib/asc-api.mjs` の `findBuildByVersion` / `listRecentBuilds` で **必ず normalize** する。

### 8.11 idempotent に書く

- 同じ marketing version に対して 2 回スクリプトが走っても壊れないように、すべての state-changing 操作を「存在チェック → なければ POST、あれば PATCH」のパターンで書く。
- 特にローカリゼーションと review detail は再実行で 409 が出やすい。

### 8.12 ASC の build 待ちはタイムアウトを長めに

- Apple の build processing は通常 5〜15 分だが、混雑時は 30 分以上かかることも。
- スクリプトのデフォルトは 30 分ポーリング。失敗時は workflow を再 run することで解決する設計。

### 8.13 App Store メタデータに他社プラットフォーム名は **絶対** 入れない（Guideline 2.3.10）

- iOS の `whatsNew` / `description` / `keywords` に `Android` / `Google Play` / `Play Store` / `Galaxy Store` / `Amazon Appstore` などが入っているとレビュアーは **必ず Reject する**（実体験：v2.3.14 で Reject）。
- 「iOS / Android / Web を 2.x.x に統一しました」のような **クロスプラットフォーム言及**もダメ。`Web` 単体は許容（Apple にとって競合プラットフォームではない）。
- `release-notes/CURRENT-ja.txt` は両ストア共通ソースなので、**プラットフォーム中立な書き方**に固定する。
- スクリプト側の防御：`scripts/appstore-submit.mjs` は API 投入前に禁止語を文字列スキャンし、ヒットしたら throw。Apple 側で 4xx を喰らってからログを見るのではなく **アップロード前に弾く**。

### 8.14 却下バージョンは「削除」ではなく「versionString 書き換え」で復旧

- Apple の API は `DELETE /v1/appStoreVersions/{id}` を **ローンチ済みアプリでは事実上拒否する**。同時に複数の `STATE_ERROR` が返る：
  - `A version cannot be deleted if any build is attached`（ビルドが紐付いている）
  - `The last version of an app cannot be deleted`（最後の版）
  - `Only the first version of any platform can be deleted`（初版以外不可）
- 単純な「却下されたら削除して再作成」は詰む。**App Store Connect の UI の "Fix and Resubmit" を API で再現**する：
  1. `PATCH /v1/reviewSubmissions/{id}` で `canceled=true`（フィールド名が `cancellationRequested` のときもあるので両方フォールバック）として、却下時の `UNRESOLVED_ISSUES` 提出を取り下げる。
  2. `PATCH /v1/appStoreVersions/{id}` で `versionString` を新 marketing 値に書き換える（**同じ id を再利用**）。
  3. 通常フロー：localization PATCH（whatsNew 上書き）→ build link 張り替え → review detail コピー → 新しい reviewSubmission を作成 → `submitted=true` PATCH。
- これで「却下 → bump → push」が **App Store Connect の UI を一切触らずに** 完結する。
- **状態を 3 分類して扱う**こと。混ぜると事故る：
  - **DEVELOPER_TURN**（`REJECTED` / `METADATA_REJECTED` / `DEVELOPER_REJECTED` / `INVALID_BINARY`）→ 自動で書き換え OK。
  - **APPLE_TURN**（`WAITING_FOR_REVIEW` / `IN_REVIEW` / `PENDING_*_RELEASE` / `PROCESSING_FOR_APP_STORE`）→ **絶対に触らない**。レビュー中の本番版を CI が cancel すると致命事故。
  - **SHIPPED**（`READY_FOR_SALE` / `PREORDER_READY_FOR_SALE` / `REPLACED_WITH_NEW_VERSION`）→ 触らない。

### 8.15 Google Play 側も完全に冪等にする（同 versionCode 再 push 対策）

- Google Play は同じ `versionCode` を 2 回アップロードすると 403 `Version code N has already been used` で蹴る。
- リリースノート修正だけのコミットを再 push したときに workflow が落ちる UX は許容しない。次の順で冪等にする：
  1. `POST /edits` で edit を開いた直後、`GET /edits/{id}/tracks/{TRACK}` で現在の release を確認。
  2. 同 versionCode が既にいて **ja-JP リリースノートが完全一致** → `DELETE /edits/{id}` で edit を捨てて即 exit 0（no-op）。
  3. 同 versionCode が既にいるが notes が違う → AAB アップロードを **スキップ**して notes のみ更新 → commit。
  4. 同 versionCode が無い → 通常の upload + commit。
  5. 念のため `uploadBundle` が `403 already been used` を返したら、(3) と同じ動きにフォールバック。
- 8.11 の「idempotent」と同じ精神だが、Play 側は **アップロード前にトラックを GET する** のがミソ。

---

## 9. デバッグ手順

### 9.1 ワークフロー失敗時の確認順

1. **GitHub Actions の Run ログ** — 失敗ステップの ##error メッセージを最初に読む
2. **App Store Connect / Play Console の UI** — API ではなく実際の状態を確認
3. **ローカルで同じスクリプトを直接実行** — env をセットして `node scripts/...` を走らせる。ローカルなら標準出力をすぐ見られる
4. **API を直接叩く** — `curl` や付属の inspect スクリプトで API の生レスポンスを確認

### 9.2 ローカル実行用 env のひな形（PowerShell）

```powershell
# iOS
$env:APP_BUNDLE_ID = "com.example.myapp"
$env:APPSTORE_CONNECT_KEY_ID = "XXXXXXXXXX"
$env:APPSTORE_CONNECT_ISSUER_ID = "00000000-0000-0000-0000-000000000000"
$env:APPSTORE_CONNECT_API_KEY_P8_PATH = "$HOME\Apple\AuthKey_XXXX.p8"
node scripts/appstore-submit.mjs

# Android
$env:PLAY_PACKAGE_NAME = "com.example.myapp"
$env:GOOGLE_PLAY_SA_JSON_PATH = "$HOME\GooglePlay\service-account.json"
$env:PLAY_AAB_PATH = "android-twa/app/build/outputs/bundle/release/app-release.aab"
node scripts/play-publish.mjs --status   # 読み取りだけ。本番には影響しない
```

### 9.3 「動いたかどうか」の最終確認

| プラットフォーム | 確認 URL |
| --- | --- |
| iOS | https://appstoreconnect.apple.com/apps |
| Android | https://play.google.com/console/u/0/developers |
| Web | デプロイ先の URL（Vercel ダッシュボード等） |

---

## 10. 参考リンク

- [App Store Connect API Reference](https://developer.apple.com/documentation/appstoreconnectapi)
- [Google Play Developer API Reference](https://developers.google.com/android-publisher/api-ref/rest)
- [GitHub Actions: macos-latest runner images](https://github.com/actions/runner-images#available-images)
- [`@bubblewrap/cli` (Android TWA)](https://github.com/GoogleChromeLabs/bubblewrap)
- [`@capacitor/cli` (iOS native shell)](https://capacitorjs.com/docs/getting-started)

---

## 11. このパイプラインを別アプリに移植するときのチェックリスト

```
[ ] § 2 の前提条件を満たしている
[ ] § 3 のファイルを全部コピーした
[ ] § 4 の置換値をすべて新アプリ用に変えた
[ ] § 5 の Secrets を登録した（鍵を .secrets-local/ に置いて bootstrap-secrets.mjs --apply ＝ §5.2.5。iOS 9 + Android 3 = 12 個）
[ ] § 6.4 の動作確認チェックポイントが全部 OK
[ ] § 8 の落とし穴を読んで、自分のアプリ固有の事情と照合した
[ ] _docs/release-one-click.md に「このアプリ専用の運用メモ」を書いた
[ ] AGENTS.md からこのプレイブックへリンクを張った
```

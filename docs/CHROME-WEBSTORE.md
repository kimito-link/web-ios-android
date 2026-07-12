# Chrome 拡張機能：申請を自動化する（Chrome Web Store API）

> iOS / Android と同じように、**Chrome 拡張機能もコマンド2つで申請できます**。
> 「zipを作る → アップロード → 審査提出」まで自動化。審査の合否だけは Google が決めます。
> （実際にこの手順で `君斗りんくのWEBサイト健康診断` v8.6.71 を申請成功した記録ベース）

---

## できること / できないこと

| やること | 自動化 |
|---|---|
| zip 作成（拡張をパッケージ化） | ✅ コマンド1つ |
| アップロード（新バージョン差し替え） | ✅ コマンド1つ |
| 審査へ提出（公開申請） | ✅ コマンド1つ |
| 審査の通過 | ❌ Google の処理（数時間〜数日待つ） |
| 初回の拡張アイテム新規作成 | ❌ 最初の1回だけストアで手動 |

iOS の「配信地域」、Android の「審査送信」と同じで、**最後の合否は人間/Google 側**。そこまでの手作業を消すのが目的。

---

## 全体像：4つの値を1ファイルに入れれば、以降は2コマンド

### ★ 推奨：Node 版（Windows + Git Bash で固まらない）

```bash
npm run publish:cws         # zip作成 → アップロード → 検証待ち → 審査提出（全自動）
# 事前確認だけしたいとき:
npm run publish:cws:check   # ID/権限の検証だけ（読み取り専用・提出しない）
npm run publish:cws:upload  # アップロードのみ（下書き確認・提出しない）
```

> **なぜ Node 版が正本か（罠⑤）**：PowerShell 版（`.ps1`）は、ユーザーの PowerShell プロファイル
> （`Microsoft.PowerShell_profile.ps1`）にパースエラーがあると巻き込まれて **0バイトの空 zip** を作り、
> 申請が静かに失敗する。日本語パス（`デスクトップ`）の文字化けも誘発する。Node 版は外部依存ゼロ・
> PowerShell 非経由で、zip 生成も Node の zlib で自前実装しているため、この事故が起きない。詳細は罠⑤。

### 旧：PowerShell 版（プロファイルがクリーンな環境向け）

```powershell
.\build-zip.ps1      # 拡張を zip にパッケージ化
.\publish-cws.ps1    # アップロード → 確認 → 審査提出
```

どちらの版も、`.env.cws` に **4つの値** を1回だけ用意すれば動きます。

| 値 | どこで取る |
|---|---|
| `CWS_ITEM_ID` | ストアの拡張URL末尾の32文字（既に公開済みなら確定済み） |
| `CWS_CLIENT_ID` | Google Cloud の OAuthクライアント |
| `CWS_CLIENT_SECRET` | 同上 |
| `CWS_REFRESH_TOKEN` | 初回だけ手作業で取得（一番のハマりどころ。下記） |

---

## 初回セットアップ（一度だけ・約15分）

### 手順0：前提
- 拡張が**すでに一度ストアに登録されている**こと（アイテムIDがある）。
  - まだなら、初回だけ [デベロッパーダッシュボード](https://chrome.google.com/webstore/devconsole) で手動アップロードして「アイテム」を作る。
  - 以降の**更新申請**はこのスクリプトで自動化できる。

### 手順1：Chrome Web Store API を有効化
1. https://console.cloud.google.com/ にログイン（拡張を登録したGoogleアカウントで）
2. プロジェクトを選ぶ／作る
3. 「APIとサービス」→「ライブラリ」→ `Chrome Web Store API` を検索 →「有効にする」

### 手順2：OAuth 同意画面
1. 「APIとサービス」→「OAuth同意画面」→ User Type「**外部**」で作成
2. アプリ名など最低限を入力
3. **テストユーザーに自分のメールを追加**（これを忘れると手順4でトークンが取れない）

### 手順3：OAuth クライアントID（★種類が超重要）
1. 「認証情報」→「認証情報を作成」→「OAuthクライアントID」
2. アプリの種類：**「デスクトップ アプリ」**を選ぶ
   - ⚠️ **「Chrome 拡張機能」を選ばないこと！** スクリプトが動かなくなる（後述の罠①）
3. できた **クライアントID** と **クライアントシークレット** を控える（JSONダウンロード推奨）

### 手順4：リフレッシュトークンを取得（一番のハマりどころ）
1. 下記URLの `CLIENT_ID` を自分のものに置換してブラウザで開く：
   ```
   https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&access_type=offline&prompt=consent&redirect_uri=urn:ietf:wg:oauth:2.0:oob&client_id=CLIENT_ID
   ```
2. 「このアプリは確認されていません」→「詳細」→「（アプリ名）に移動」→「許可」
3. 表示された**認証コード**（`4/0A...` や `4/1A...` で始まる長い文字列）を**全部コピー**
4. すぐに（数分で失効するので急いで）コードをトークンに交換：
   ```powershell
   Invoke-RestMethod -Method Post -Uri "https://oauth2.googleapis.com/token" -Body @{
     client_id     = "CLIENT_ID"
     client_secret = "CLIENT_SECRET"
     code          = "AUTH_CODE"
     grant_type    = "authorization_code"
     redirect_uri  = "urn:ietf:wg:oauth:2.0:oob"
   } | Select-Object refresh_token
   ```
5. 出てきた **refresh_token**（`1//...`）を控える。これは長期間有効。

### 手順5：`.env.cws` を作る
```
CWS_CLIENT_ID=...
CWS_CLIENT_SECRET=...
CWS_REFRESH_TOKEN=1//...
CWS_ITEM_ID=...
```
> `.env.cws` は **`.gitignore` に必ず追加**。秘密情報なので絶対にコミット/共有しない。

---

## 申請のたびにやること

1. コード修正 → `manifest.json`（＋必要なら表示用バージョン）を bump
2. zip 作成：`.\build-zip.ps1`
3. アップロード＋審査提出：`.\publish-cws.ps1`
   - 下書き確認だけ：`.\publish-cws.ps1 -UploadOnly`
   - 確認プロンプトを飛ばす：`.\publish-cws.ps1 -Yes`

成功すると `審査提出 完了: status=OK` が出る。あとは Google の審査メールを待つだけ。

---

## ⚠️ 実際に踏んだ罠（これを知らないと詰まる）

### 罠①：OAuthクライアントの種類が「Chrome 拡張機能」だと動かない
- 直感的に「Chrome 拡張だから Chrome拡張機能タイプ？」と選びがちだが**間違い**。
- 正解は **「デスクトップ アプリ」**。スクリプト（CLI）から使う認証だから。
- アイテムID（`hceblj...`）を使うのは**申請の時**で、**OAuthクライアント作成時には不要**。混同しやすい。

### 罠②：認証コードが `invalid_grant: Bad Request` になる
原因は2つのどちらか：
- **コードの貼り間違い／不完全コピー**：認証コードは100文字以上ある。途中で切れていると失敗。
  - ガイド文の中の `4/0A...` のような**例文の断片**を誤ってコピーしないよう注意。
- **コードの期限切れ**：認証コードは数分で失効。出たら**すぐ**交換する。
- → どちらも、認可URLをもう一度開いて**新しいコードを取り直せば**OK（何度でも取れる）。

### 罠③：JSONダウンロードが落ちない / シークレットが画面に出ない
- 新しい Google Cloud のUIでは、シークレットは**作成直後しか平文表示されない**ことがある。
- 後から見たいときは「クライアント」→該当クライアント→「**JSONをダウンロード**」。
- それでも落ちなければ「**シークレットを追加**」で新しいシークレットをその場で作って控える。

### 罠④：審査が却下される（バッジ語・リモートコード）
- **「無料」「Free」「Premium」等の語**を名前/説明/画像に入れると却下されることがある。
- **CDN等の外部コードを実行時に読む**と「リモートコード」違反で却下（MV3）。ライブラリは `vendor/` に同梱。
- zip に `vendor/`（同梱ライブラリ）が**入っているか**を毎回確認（抜けると却下＋機能死）。

### 罠⑤：PowerShell 版が「空 zip」を作って静かに失敗する（Windows + Git Bash）★実際に踏んだ
**症状**：`npm run zip:cws`（PowerShell の `build-zip.ps1` / `make-zip.ps1`）を回すと、赤いパースエラーが
大量に出たあと `ZIP_CREATED ... (0 bytes)` という **0バイトの zip** が作られ、続く publish が
`ERROR: zip がありません` で止まる。

**原因**：PowerShell は起動時に**ユーザープロファイル**（`Microsoft.PowerShell_profile.ps1`）を読み込む。
そこに構文エラー（閉じ括弧/終端引用符の欠落など）があると、その後に流す `.ps1` まで一緒に
パース段階で壊れ、スクリプト内の変数（`$items` / `$dst`）が空になり `Compress-Archive` が空 zip を吐く。
さらに日本語パス（`デスクトップ`）が `繝・せ繧ｯ繝医ャ繝�` に化け、パス解決も失敗する。

**対処（恒久）**：**PowerShell を経由しない Node 版を使う**。zip 生成を PowerShell の `Compress-Archive` から
Node の `zlib`（外部依存なし）に置き換えた `build-zip-node.mjs` / `publish-cws-node.mjs` を用意済み。
`npm run publish:cws` がそれを呼ぶ。これでプロファイル汚染・日本語パスの両方の事故が消える。

> グローバル運用ルール（`AI_HARNESS_OPERATION.md`）の「Windows シェルは Git Bash 優先・PowerShell の
> インライン実行を避ける」と同じ理由。**PowerShell に処理を投げる npm スクリプトは地雷**だと考える。

### 罠⑥：アップロード検証ポーリングが `uploadState=NOT_FOUND` のまま SUCCESS に遷移しない★実際に踏んだ
**症状**：`publish-cws-node.mjs` を実行すると、`[2/3] ZIP アップロード中...` で `uploadState=IN_PROGRESS`
まで進むのに、直後のポーリング（`GET items/{id}?projection=DRAFT`）が5秒おきに `uploadState=NOT_FOUND`
を返し続け、3分のタイムアウトで `ERROR: 3分待っても検証が完了しませんでした` になる。再アップロードしても同じ。

**原因**：サーバー側のアップロード自体は正常に処理済みだが、`?projection=DRAFT` の GET エンドポイントが
一時的に古い/存在しない状態を返す（Google API 側の不整合。再現条件は未特定）。`crxVersion` は
正しいバージョンを指しているのに `uploadState` だけ `NOT_FOUND` になる。

**確認方法（実機で踏んだ手順）**：ポーリングを諦めた後、`publish`（`POST items/{id}/publish`）を
**ポーリングの成否に関わらず直接叩いてみる**と `status=OK` で審査提出が通った。つまりポーリングAPIの
応答だけを信頼して「アップロード失敗」と判定するのは誤り。

**対処（恒久・2026-07-10 実装済み）**：`publish-cws-node.mjs` はポーリングがタイムアウトしても
`process.exit(1)` で止めず、そのまま publish を試行し、その結果（成功 or Google が返す具体的な
エラーメッセージ）で最終判断するように変更した。publish 自体が失敗すれば従来通りエラーで停止するため、
不正な公開にはならない。

---

## ✅ Chrome 公開チェックリスト

- [ ] `manifest.json` の version を bump した
- [ ] zip に `vendor/`（同梱ライブラリ）が含まれている
- [ ] 名前/説明/画像に禁止語（無料/Free/Premium 等）が無い
- [ ] 外部CDNを実行時に読んでいない（リモートコード違反回避）
- [ ] `npm run publish:cws:check` で `✅ ID 正しく権限あり` を確認（提出前の権限チェック）
- [ ] `npm run publish:cws` で `審査提出 完了: status=OK` を確認（PowerShell 版は罠⑤に注意）
- [ ] 審査メール（数時間〜数日）を待つ → 承認後ストアに反映

---

## 💡 覚えておく3つのこと

1. **OAuthクライアントは「デスクトップ アプリ」**：Chrome拡張機能タイプではない（罠①）
2. **認証コードは使い捨て＆短命**：出たらすぐ交換、失敗したら取り直せばいい（罠②）
3. **3プラットフォーム共通**：iOS=配信地域 / Android=審査送信 / Chrome=審査提出。
   どれも「自動化できるのは提出まで、合否は審査側」という同じ構図。

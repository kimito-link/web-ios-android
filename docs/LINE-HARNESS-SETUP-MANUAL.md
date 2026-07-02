# LINE Harness セットアップマニュアル

> **対象**: Kimito-Link Project LINE公式アカウント（@kimitolink）
> **作成日**: 2026-06-24
> **ツール**: [LINE Harness OSS](https://github.com/Shudesu/line-harness-oss)（v0.15.0）

---

## 0. 前提条件

| 必要なもの | 確認方法 |
|---|---|
| Node.js 22 以上 | `node -v` → v22.15.0 ✅ |
| pnpm | `pnpm -v` → 10.28.2 ✅ |
| Cloudflare アカウント（無料枠OK） | [dash.cloudflare.com](https://dash.cloudflare.com/) にログインできる ✅ |
| LINE 公式アカウント（認証済み） | @kimitolink ✅ |
| LINE Developers Console アクセス | [developers.line.biz](https://developers.line.biz/console/) にログインできる |

---

## 1. LINE Developers Console での API 設定

### 1-1. Messaging API の有効化

1. [LINE Official Account Manager](https://manager.line.biz/) にログイン
2. 左メニュー「設定」→「**Messaging API**」をクリック
3. 「**Messaging API を利用する**」ボタンをクリック
4. プロバイダー名: `Kimito-Link`（新規作成 or 既存を選択）
5. 利用規約に同意 → 確定

> **注意**: プロバイダーは後から変更できません。既に他のプロジェクトで使っているプロバイダーがあれば、そこに追加するか新規作成するか選べます。

### 1-2. チャネルアクセストークンの発行

1. [LINE Developers Console](https://developers.line.biz/console/) にログイン
2. プロバイダー「Kimito-Link」→ **Messaging API チャネル** をクリック
3. **「基本設定」タブ**:
   - **チャネルID** → メモ（任意）
   - **チャネルシークレット** → メモ帳にコピー ⚠️ 必須
4. **「Messaging API」タブ**:
   - 下にスクロール → 「**チャネルアクセストークン（長期）**」
   - 「**発行**」ボタンをクリック → メモ帳にコピー ⚠️ 必須

> **この2つの値は CLI セットアップで入力します**:
> - チャネルシークレット（Channel Secret）
> - チャネルアクセストークン（Channel Access Token）

### 1-3. LINE Login チャネルの作成（LIFF フォーム用）

LINE Harness のフォーム機能（LIFF）には LINE Login チャネルが必要です。

1. LINE Developers Console → プロバイダー「Kimito-Link」
2. 「**新規チャネル作成**」をクリック
3. チャネルタイプ: **LINE Login**
4. 以下を入力:
   - アプリ名: `Kimito-Link Login`
   - 説明: `Kimito-Link フォーム連携用`
   - アプリタイプ: **ウェブアプリ**
   - メールアドレス: 登録済みのもの
5. チャネルを作成
6. 作成後、チャネルのステータスを「**公開**」に変更

> **チャネルID**をメモしておく（CLI で入力する場合あり）

### 1-4. 応答設定の変更

LINE Official Account Manager に戻ります。

1. 左メニュー「設定」→「**応答設定**」
2. **応答メッセージ**: **オフ** に変更（LINE Harness が Webhook で応答するため、二重返信を防止）
3. **Webhook**: **オン** に変更
4. チャットモード: **チャット** → オン

---

## 2. LINE Harness CLI セットアップ

### 2-1. CLI の実行

PowerShell またはターミナルで以下を実行:

```powershell
npx create-line-harness
```

### 2-2. CLI の対話に回答する

CLI が対話形式で質問してきます。以下の順で回答します:

| 質問 | 入力する値 |
|---|---|
| Cloudflare 認証 | ブラウザが開くので「Allow」をクリック |
| プロジェクト名 | `kimitolink`（任意の英数字） |
| LINE Channel Secret | Step 1-2 でコピーした値 |
| LINE Channel Access Token | Step 1-2 でコピーした値 |
| LINE Login Channel ID | Step 1-3 でコピーした値 |
| 管理者メールアドレス | あなたのメールアドレス |
| 管理者パスワード | 管理画面ログイン用のパスワード |

### 2-3. CLI が自動で行うこと

- ✅ Cloudflare D1 データベース作成
- ✅ スキーマ・マイグレーション適用
- ✅ Worker デプロイ（Webhook 受信 + API）
- ✅ 管理画面（Next.js 15）を Cloudflare Pages にデプロイ
- ✅ LIFF アプリ自動作成
- ✅ Owner ユーザー作成

### 2-4. 完了時に表示される情報

CLI が完了すると、以下の URL が表示されます:

```
✅ セットアップ完了

Worker URL:  https://kimitolink.workers.dev
管理画面:    https://kimitolink-admin.pages.dev
Webhook URL: https://kimitolink.workers.dev/webhook
```

> **これらの URL はメモしておいてください。**

---

## 3. Webhook URL の設定

### 3-1. LINE Developers Console で設定

1. [LINE Developers Console](https://developers.line.biz/console/) にログイン
2. Messaging API チャネル → 「**Messaging API**」タブ
3. 「**Webhook設定**」セクション:
   - Webhook URL: `https://kimitolink.workers.dev/webhook`
   - 「**更新**」をクリック
4. 「**検証**」ボタンをクリック → **「成功」** が表示されれば OK
5. 「**Webhookの利用**」→ **オン** に切替

---

## 4. 管理画面の初期設定

### 4-1. ログイン

1. ブラウザで管理画面を開く: `https://kimitolink-admin.pages.dev`
2. CLI で設定したメールアドレスとパスワードでログイン
3. ダッシュボードが表示されれば成功

### 4-2. 動作確認

#### 友だち追加テスト

1. 自分の LINE アプリで `@kimitolink` を検索 → 友だち追加
2. 管理画面の「友だち一覧」に自分が表示されるか確認
3. あいさつメッセージが LINE に届くか確認

> **既に友だちの場合**: 一度ブロック → ブロック解除 すると `follow` イベントが再発火します

#### 自動返信テスト

1. 管理画面で自動返信ルールを作成:
   - キーワード: `テスト`
   - 返信: `🎉 テスト成功！Kimito-Link の LINE が動いています`
2. LINE から `テスト` と送信
3. 自動返信が返ってくれば OK

---

## 5. トラブルシューティング

### Webhook 検証が失敗する

- Worker が正常にデプロイされているか確認: `https://kimitolink.workers.dev` にアクセス
- Cloudflare ダッシュボードで Worker のステータスを確認
- 数分待ってから再度検証（デプロイ直後は反映に時間がかかることがある）

### 友だち追加しても管理画面に表示されない

- Webhook が「オン」になっているか確認
- 応答メッセージが「オフ」になっているか確認
- Worker のログを Cloudflare ダッシュボードで確認

### CLI が途中でエラーになる

- Node.js のバージョンが 22 以上か確認: `node -v`
- pnpm がインストールされているか確認: `pnpm -v`
- ネットワーク接続を確認
- `npx create-line-harness` を再実行

### 二重返信が来る

- LINE Official Account Manager の「応答設定」→ 応答メッセージが「オフ」になっているか確認
- AI チャットボットが「オフ」になっているか確認

---

## 6. 参考リンク

- [LINE Harness GitHub](https://github.com/Shudesu/line-harness-oss)
- [LINE Harness セットアップ動画](https://youtu.be/DiRuGaeq1sM)
- [LINE Developers Console](https://developers.line.biz/console/)
- [LINE Official Account Manager](https://manager.line.biz/)
- [Cloudflare Dashboard](https://dash.cloudflare.com/)

---

*partnership_program_website の LINE 実装（`server/_core/line.ts`）を参考にシナリオ設計。運用ガイドは `LINE-HARNESS-OPERATION-GUIDE.md` を参照。*

# LINE Harness 運用ガイド — Kimito-Link

> **対象**: Kimito-Link Project LINE公式アカウント（@kimitolink）
> **管理画面**: `https://<your-name>-admin.pages.dev`
> **目的**: グッズ販売・アプリDL・ロゴ利用 → LTV最大化

---

## 1. リッチメニュー設計

### Kimito-Link 用メニュー（6分割）

| 枠 | アイコン | ラベル | アクション | UTM |
|---|---|---|---|---|
| 1 | 🎨 | ロゴを使う | URL → kimito-link.com のロゴ利用ガイド | `utm_source=line&utm_medium=rich_menu&utm_content=logo` |
| 2 | 🛒 | グッズ | URL → グッズ販売ページ | `utm_source=line&utm_medium=rich_menu&utm_content=goods` |
| 3 | 📱 | アプリ | URL → ストアリンク出し分けページ | `utm_source=line&utm_medium=rich_menu&utm_content=app_dl` |
| 4 | 💬 | 相談する | postback → `flow=consult&stage=initial` | — |
| 5 | 📋 | 活用術 | URL → /utilized-multiple-ways/ | `utm_source=line&utm_medium=rich_menu&utm_content=utilized` |
| 6 | 🏠 | 工房 | URL → /kobou/ | `utm_source=line&utm_medium=rich_menu&utm_content=kobou` |

### 管理画面での設定手順

1. 管理画面 → 「リッチメニュー」セクション
2. 「新規作成」をクリック
3. テンプレート: **6分割**（2行3列）
4. 各枠にラベル・アクション・画像を設定
5. 「デフォルトに設定」をオンにして保存

---

## 2. ステップ配信シナリオ

### 友だち追加シナリオ（LTV最大化）

友だち追加を起点に、5通のステップメッセージを自動配信します。

#### ステップ 1: 即時配信 — あいさつ + ロゴ紹介

```
友だち追加ありがとうございます！Kimito-Link Project です 🎉

クリエイターとファンをつなぐ Kimito-Link のロゴは、
「クリエイターを大事にする意思」のシンボルです。

👇 ロゴの使い方・ダウンロードはこちら
https://kimito-link.com/utilized-multiple-ways/?utm_source=line&utm_medium=step&utm_content=step1_logo

気になることがあれば、いつでもメッセージをどうぞ！
```

#### ステップ 2: 1日後 — グッズ紹介

```
こんにちは！Kimito-Link です。

Kimito-Link のキャラクター「りんく」「こん太」「たぬ姉」の
グッズを取り揃えています 🎁

👇 グッズ一覧はこちら
[グッズページURL]?utm_source=line&utm_medium=step&utm_content=step2_goods

お気に入りが見つかりますように！
```

#### ステップ 3: 3日後 — アプリDL

```
Kimito-Link のアプリはもうダウンロードされましたか？📱

アプリならいつでもサクッとアクセスできます。

🍎 iPhone: [App Store URL]
▶️ Android: [Play Store URL]

※ まだ審査中の場合はWebサイトをご利用ください
https://kimito-link.com/?utm_source=line&utm_medium=step&utm_content=step3_app
```

#### ステップ 4: 7日後 — 活用術

```
Kimito-Link を使いこなすコツをご紹介します 📋

✅ 名刺にロゴを入れる
✅ ポートフォリオに活用する
✅ Before/After で見せる

👇 活用術まとめ
https://kimito-link.com/utilized-multiple-ways/?utm_source=line&utm_medium=step&utm_content=step4_tips
```

#### ステップ 5: 14日後 — 工房サービス

```
Kimito-Link にはクリエイター向けの工房サービスもあります 🏠

名刺デザイン、ポートフォリオ制作など、
クリエイターの活動をサポートします。

👇 工房サービスの詳細
https://kimito-link.com/kobou/?utm_source=line&utm_medium=step&utm_content=step5_kobou

ご質問はいつでもこちらのLINEからどうぞ！
```

### 管理画面での設定手順

1. 管理画面 → 「シナリオ」セクション
2. 「新規シナリオ」をクリック
3. トリガー: **友だち追加**
4. 各ステップを追加:
   - delay: 即時 / 1日 / 3日 / 7日 / 14日
   - メッセージ内容: 上記のテキストをコピー
5. シナリオを「有効」にして保存

---

## 3. 自動返信キーワード

### キーワード設定一覧

| キーワード（部分一致） | 返信メッセージ |
|---|---|
| `ロゴ`, `使い方`, `利用`, `ダウンロード` | ロゴ利用ガイドのリンクとダウンロード方法 |
| `グッズ`, `商品`, `購入`, `買` | グッズ一覧ページへのリンク |
| `アプリ`, `ダウンロード`, `DL`, `インストール` | iOS/Android ストアリンク |
| `相談`, `問い合わせ`, `質問` | 「ご相談ありがとうございます。担当者が確認して返信します」+ オペレーター通知 |
| `活用`, `名刺`, `ポートフォリオ` | 活用術ページへのリンク |
| `工房`, `制作`, `デザイン` | 工房サービス紹介 |
| `料金`, `価格`, `費用` | 料金一覧ページへのリンク |

### 管理画面での設定手順

1. 管理画面 → 「自動返信」セクション
2. 「新規ルール」をクリック
3. マッチタイプ: **部分一致**
4. キーワードと返信メッセージを設定
5. 保存

---

## 4. タグ設計

### 推奨タグ一覧

| カテゴリ | タグ名 | 条件 |
|---|---|---|
| **流入** | `source_line_rich_menu` | リッチメニューからのアクセス |
| **流入** | `source_line_step` | ステップ配信からのアクセス |
| **流入** | `source_organic` | 検索流入 |
| **意図** | `intent_logo_use` | ロゴ利用に興味 |
| **意図** | `intent_goods_purchase` | グッズ購入に興味 |
| **意図** | `intent_app_download` | アプリDLに興味 |
| **意図** | `intent_consult` | 相談・問い合わせ |
| **ステージ** | `stage_friend_added` | 友だち追加済み |
| **ステージ** | `stage_engaged` | メッセージやり取りあり |
| **ステージ** | `stage_purchased` | グッズ購入済み |
| **ステージ** | `stage_logo_user` | ロゴ利用者 |

---

## 5. 分析ダッシュボード

### 見るべき指標

| 指標 | 意味 | 目標 |
|---|---|---|
| 友だち数（累計） | 総リーチ | 増加トレンド |
| ブロック率 | 配信の質 | 10%未満 |
| ステップ完走率 | シナリオの効果 | 60%以上 |
| リッチメニュークリック率 | メニューの効果 | 各枠 5%以上 |
| グッズページ遷移数 | 販売導線の効果 | — |
| アプリDLリンククリック数 | DL導線の効果 | — |

---

## 6. MCP Server 連携（Claude Code）

LINE Harness には MCP Server が同梱されています。Claude Code から自然言語で操作可能です。

### よく使うコマンド例

```
# 未返信の会話を確認
「未返信の会話を一覧して」

# シナリオの作成
「友だち追加したら3日後にグッズ紹介を送るシナリオを作って」

# ブロードキャスト
「全員にイベント告知を送って」（要ユーザー確認）

# タグ付け
「昨日友だち追加した人に source_organic タグをつけて」
```

### 設定方法

Claude Code の MCP 設定に以下を追加:

```json
{
  "mcpServers": {
    "line-harness": {
      "command": "npx",
      "args": ["@line-harness/mcp-server"],
      "env": {
        "LINE_HARNESS_API_URL": "https://kimitolink.workers.dev",
        "LINE_HARNESS_API_KEY": "<管理画面で発行したAPIキー>"
      }
    }
  }
}
```

---

## 7. 日常運用チェックリスト

### 毎日

- [ ] 管理画面で未返信の会話を確認
- [ ] 新規友だち追加を確認

### 毎週

- [ ] ステップ配信の完走率を確認
- [ ] ブロック率を確認
- [ ] リッチメニューのクリック状況を確認

### 月次

- [ ] 配信通数を確認（コミュニケーションプランは月200通）
- [ ] シナリオの効果を見直し
- [ ] 新しいキーワード応答のニーズがないか確認

---

## 8. partnership_program_website からの知見

partnership_program_website の LINE 実装で得た教訓：

1. **二重返信に注意**: Manager の応答メッセージとWebhookの自動返信が重複しないよう、Manager側はオフにする
2. **リッチメニューの正本**: API で設定したリッチメニューが正本。Manager 画面に表示されないことがある
3. **UTM は必ずつける**: 流入経路の分析に必須
4. **人間介入のタイミング**: 自動返信で解決しない相談は、管理画面のオペレーターチャットで1:1対応
5. **ステップ配信は押し付けない**: 有益な情報→ 行動提案の順。煽らない

---

*セットアップ手順は `LINE-HARNESS-SETUP-MANUAL.md` を参照。*

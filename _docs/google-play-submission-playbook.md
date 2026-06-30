# Google Play 提出 追体験プレイブック — TWA アプリを審査に出すまで

kimito.link を **Google Play の production 審査に出すまで**を一次情報で記録したもの。
TWA(Bubblewrap) プロジェクト生成 → AAB ビルド → Play Console の必須申告11項目 → 審査送信、の
全工程を「次のアプリで追体験して最短で通す」ために残す。

関連の正本:
- `templates/android-twa/README.md` — TWA プロジェクト生成手順の正本
- `_docs/release-pipeline-playbook.md` — Web/iOS/Android 同時リリース・パイプライン
- `_docs/apple-reject-knowledge-base.md` — iOS 側の却下ナレッジ（Android 申告と整合させる基準）。
  **スクショ自動化の正本でもある**: §2.3「kimito ケーススタディ」に、OAuth専用ログイン
  (Clerk×X)は Playwright/CDP で認証スクショを自動取得できない(X/Cloudflare/Chrome の bot 対策で
  全滅)＝**公開ページだけでスクショを構成する**方式(`scripts/capture-public-screenshots.mjs` 原型)
  が解、と記録。Play のスクショも同じく公開ページ方式で撮れば storageState/デモ垢ログイン不要。

> ⚠️ 申告（データセーフティ・コンテンツレーティング・対象年齢）は**法的な意味を持つ回答**。
> 下の値は「X ログインのリンクまとめアプリ（課金なし・広告なし・Vercel Analytics のみ）」の
> 実態に基づく。別アプリでは自分のアプリのデータ収集実態に合わせて読み替えること。

---

## 0. 全体像（つまずきポイントの地図）

```
本番 PWA manifest 配信   ← 無いと bubblewrap init が始まらない（最初のブロッカー）
  ↓
bubblewrap で android-twa/ 生成   ← 対話CLIが鬼門。winpty で TTY を与える
  ↓ packageId 罠（ドメイン逆順を自動採用するので是正必須）
署名注入 → AAB ビルド → Play へ upload（WF）   ← ここまでは自動化済み
  ↓
internal トラック配信   ← 初回 WF で通る
  ↓
production = draft で止まる   ← API では3項目を埋められない（下記）
  ↓
Play Console で 11項目を手入力   ← ここが本プレイブックの主題
  ↓
クイックチェック（自動・約12分）→ 自動で審査送信
```

**API 自動化の限界**：production の `App content / Data safety / Content rating` 等は
Google Play Developer API では設定できず、**Play Console の Web UI でしか入力できない**
（iOS の App Privacy が ASC 手動公開なのと同じ構造）。`play-publish.mjs` は production で
`changesNotSentForReview` を検知したら自動で **draft フォールバック**して AAB だけ乗せる設計なので、
11項目を埋める前に WF を回しても空振りにはならない（draft で待てる）。

---

## 1. TWA プロジェクト生成（bubblewrap）の実戦メモ

最初に本番が **PWA manifest** を配信していること（`https://<domain>/manifest.webmanifest` が
HTML でなく JSON を返す）。Next App Router なら `app/manifest.ts` を置くだけ。`name/short_name/
icons(192,512,maskable)/start_url/display:standalone/theme_color` を満たす。アイコンは正方形
1024 master から sharp で 192/512 を生成し **LFS 非追跡**で `public/icons/` に置く（LFS だと
Vercel が配信を壊す）。

**bubblewrap 対話CLIの突破法（最重要・再利用可）**：
init/update の Inquirer プロンプトは**真の TTY を要求**する。非インタラクティブシェルや
パイプ（`yes ''` / `printf '\n'`）では固まる、または入力がテキストフィールドに混入して壊れる。
CI(Actions)でも `updateConfig` が「JDKを自分で入れる?(Y/n)」で標準入力待ち→exit 130。

→ **Git Bash の `winpty` で TTY を与えて、node でフルパス実行する**:
```
yes '' | winpty -Xallow-non-tty \
  "/c/Program Files/nodejs/node.exe" \
  "<npm-cache>/_npx/<hash>/node_modules/@bubblewrap/cli/bin/bubblewrap.js" \
  init --manifest=https://<domain>/manifest.webmanifest --directory=./android-twa
```
- winpty は PATH 解決しないので **node も bubblewrap.js も絶対パス**で渡す（`npx` 直叩きは
  `winpty: error: cannot start 'npx': Not found in PATH`）。
- ローカルに `~/.bubblewrap/`（config.json＋portable-jdk17＋android_sdk）が既存なら JDK
  プロンプトは出ない。無ければ Android Studio 同梱 JDK(jbr) のパスを `.bubblewrap-config.json` に。

**packageId 罠（必ず確認）**：bubblewrap init は manifest URL のドメイン（例 `kimito.link`）を
**逆順にして `link.kimito.twa` を自動採用**し、手書きの twa-manifest.json `packageId` を上書きする
（Enter 連打で誤承認される）。正しい applicationId（例 `com.kimito.link.linktree`）に直すには
twa-manifest.json の packageId を修正して **`bubblewrap update`**（app/・Java パッケージ dir・
AndroidManifest を再生成）。最後に `grep -rln '<wrong.id>' android-twa` で残存ゼロを確認。

その他の確定手順：
- init/update 直後に **必ず** `node scripts/android-patch-signing.mjs`（signingConfig 注入。
  忘れると無署名 AAB → Play 拒否）。
- `update` は versionCode を +1 するので、初回提出は twa-manifest.json と app/build.gradle の
  versionName/versionCode を `1.0.0`/`1` に戻す。
- 署名鍵は**既存の正本を使う**（`.secrets-local/android-upload-key.jks` 等。Secrets 登録済みなら
  それと同一の鍵）。**新規生成すると Play App Signing の鍵と不一致で詰む**（既存アプリを更新不能）。
- コミット対象は `android-twa/`（app/・gradle・twa-manifest.json）。鍵(.jks)・keystore.properties・
  build/・.gradle/ は `.gitignore`（`gitignore.snippet` 参照）。`git check-ignore` で鍵除外を確認。

**CIで生成したいとき**：対話CLIがローカルで詰まるなら、JDK/SDK 完備の Actions で `init` を回す
使い捨て WF を作り、生成物（鍵・build を除く）を artifact 化 → 展開コミット、も有効。ただし
Actions でも `updateConfig`/`init` のプロンプトに `n`＋実JDKパス＋…を流し込む必要があり、
結局 TTY 問題と戦う。**ローカル winpty が一番速い**というのが実戦の結論。

---

## 2. Play Console 必須申告 11項目（追体験チェックリスト）

internal 配信後、production を出すと draft で止まる。Play Console →（アプリ）→ **ダッシュボードの
セットアップ手順**、または **ポリシーとプログラム → アプリのコンテンツ** から各項目を埋める。
**直リンク URL は Play Console の SPA が必ずアプリ一覧に弾く**ので、サイドバー/カードから辿ること。

各項目を保存すると「[公開の概要] に移動しますか?」と聞かれる → **全部終わるまで「後で行う」**。

| # | 項目 | kimito.link の答え | 注意 |
| --- | --- | --- | --- |
| 1 | プライバシーポリシー | URL = `https://<domain>/privacy/` | 既存の privacy ページ |
| 2 | 広告 | **広告は含まれていません** | 広告SDKなし・Vercel Analytics は広告でない |
| 3 | ログインの詳細（旧アプリのアクセス権） | **アクセス制限あり** → 「+詳細を追加」でデモ垢登録 | 下記 §3 |
| 4 | コンテンツのレーティング（IARC） | カテゴリ=その他全て / 暴力・性的・薬物等すべて**いいえ** / **オンラインコンテンツ=はい** | 結果=全年齢(L)。下記 §4 |
| 5 | ターゲットユーザー | **13〜15 / 16〜17 / 18歳以上**（13歳以上の全層） | 子供向けにしない（X は13+）。13+のみなら子供向け質問は自動スキップ |
| 6 | データセーフティ | 下記 §5（一番長い） | 法的申告。最重要 |
| 7 | 広告ID(AAID) | **使用しない** | TWA に広告SDKなし |
| 8 | 行政アプリ | **いいえ** | 政府機関と無関係 |
| 9 | 金融取引機能 | 最下部「**このアプリは金融取引機能を提供していません**」 | チェックボックス羅列。該当なし |
| 10 | 健康 | 最下部「**アプリに健康関連の機能はない**」 | 同上 |
| 11 | アプリのカテゴリ＋連絡先（ストアの設定） | カテゴリ=**ソーシャル** / 連絡先メール・ウェブサイトは既存 | これだけ「アプリのコンテンツ」でなく「ストアの設定」側 |

全部埋めると「アプリのコンテンツ」の**要注意が 0** になり、「公開の概要」で送信可能に。

### §3 ログインの詳細（デモ垢）
「アプリの一部にアクセス制限がありますか?」→ **はい**（X SSO ログイン必須）。「+詳細を追加」で
名前=`Reviewer demo account` / ユーザー名=`<X のログインID>` / パスワード=`<現在のパスワード>`。
**最下部の必須チェック**「このログイン情報で全機能を制限なく利用できます」を入れないと保存が弾かれる。
※ パスワードは**現在有効なもの**（審査官が実際にログインする。古いと却下）。iOS のデモ垢と同じ。

### §4 コンテンツレーティング（IARC）の判断
- メール=連絡先、カテゴリ=「その他のすべてのアプリの種類」（双方向チャットが無いので「ソーシャル/
  コミュニケーション」を選ぶと余計な UGC 設問が出て不整合）、IARC 利用規約に同意。
- アンケート：ダウンロード済みコンテンツ/暴力/性的/言葉/規制物質/年齢制限製品＝すべて**いいえ**。
  **オンラインコンテンツ=はい**（本人の X 投稿表示＋外部リンク誘導＝事前審査されない動的/外部
  コンテンツがある。litlink/linktree 系の正直な申告。過小申告は審査リスク）。
- 「その他」5問（位置情報共有/デジタル購入/暗号報酬・NFT/ブラウザ・検索エンジン/ニュース・教育）＝
  すべて**いいえ**。結果は **L=すべての年齢層**（iOS Age Rating 全 NONE と整合）。
- 全問回答後に **「次へ」がグレーなら「保存」を先に押す**と確定して「次へ」が有効化される（UIの癖）。

### §5 データセーフティ（最長・最重要）
5ステップ：①概要 ②収集とセキュリティ ③データの種類 ④使用と処理 ⑤プレビュー。
- **②** 収集する=**はい**（共有はしない）。転送時の暗号化=**はい**(HTTPS)。アカウント作成方法=
  **OAuth**（X/Apple/Google ログイン）。「アカウント削除用 URL」=`https://<domain>/privacy/`。
- **③ データの種類**（カテゴリ別アコーディオン。集めるものだけチェック）：
  - 個人情報 → **名前・メールアドレス・ユーザーID**（X/Clerk）。
  - アプリのアクティビティ → **アプリのインタラクション数**（Vercel Analytics の匿名ページビュー）。
  - 位置情報/財務/健康/メッセージ/写真/音声/連絡先/デバイスID 等は**集めない**＝チェックしない。
- **④ 使用と処理**（各データの → を開いて目的設定）：
  - 名前/メール/ユーザーID = 収集（共有なし）・一時処理**いいえ**・**必須**・目的=**アプリの機能**。
  - インタラクション数 = 収集（共有なし）・一時処理いいえ・**任意（ユーザー選択可）**・目的=**分析**。
- **⑤ プレビュー**：「第三者と共有されるデータはありません」を確認して**保存**。
- iOS App Privacy（名前・メール / アプリの機能 / 関連付けあり / トラッキングなし）と整合する。

---

## 3. 送信（最後）

11項目すべて保存 → 「公開の概要」→ 変更一覧が「審査にまだ送信されていない変更」に並ぶ。
「審査のためにアプリを送信」ボタンは最初グレーで、上に「一般的な問題のクイックチェックを実行する
（残り約N分）」が出る。説明文どおり **チェック完了（約10〜15分）で自動的に審査へ送信される**ので、
ボタンを手で押す必要はない（押せるなら押してもよい）。送信後は Google の審査（数時間〜数日）→
通れば production で一般公開。

**direct-link が効かない / SPA が重い**：Play Console はスクショ取得が30秒タイムアウトしたり
サイドバーが折り畳まれたりする。`bubblewrap`/`gh` で自動化できる所は自動化し、Console の手入力は
腰を据えて一項目ずつやる。ブラウザ自動操作で代行する場合は、申告（データ収集・年齢）の保存は
**事実に基づくこと**を都度確認しながら進める。

---

## 4. 次アプリ向け TL;DR
1. `app/manifest.ts` で PWA manifest 配信（LFS 非追跡アイコン）。
2. `winpty` で bubblewrap init → packageId を是正して `update` → `android-patch-signing.mjs`。
3. version を 1.0.0/1 に戻して `android-twa/` をコミット（鍵は .gitignore）。
4. `android-play-release.yml`（track=internal）で配信実績 → track=production は draft で待つ。
5. Play Console で上表 11項目を入力（**API では不可**）。データセーフティが最長。
6. クイックチェック完了で自動審査送信。iOS の App Privacy 手動公開と同じ「Web UI 必須」枠。

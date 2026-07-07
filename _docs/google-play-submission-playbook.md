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
production = draft で止まる   ← API では多くの項目を埋められない（下記）
  ↓
Play Console で 必須申告を手入力   ← ここが本プレイブックの主題
  ↓
「製品版リリースの作成」画面で 手動「次へ→審査に送信」   ← ★最後はUI必須（WFは止まる）
  ↓
クイックチェック（自動・約12〜15分）→ 自動で審査キュー投入
```

**API 自動化の限界（2026-06 kimito 実体験で確定した境界線）**：
- **Data safety だけは API/スクリプトで送れる**（実績あり）。CSV決定を生成 → Publisher API で
  送信、で `DONE` まで自動化できた（`play-generate-data-safety-csv.mjs` / `play-fill-data-safety.mjs`
  / `lib/play-data-safety-template.json`。キット正本化候補）。
- **App content / Content rating（IARC）は Google が API を出していない**＝**初回だけ手入力必須**
  （自動化不可・確定）。iOS の App Privacy が ASC 手動公開なのと同じ構造。
- **最後の「審査に送信」も Web UI 必須**（下記 §3）。`play-publish.mjs` は **冪等設計**で、同一
  versionCode＋同一 notes が既にトラックにいると `[skip] Nothing to do` で早期 return するため、
  WF を何度回しても **production への昇格・審査送信は進まない**。AAB を乗せる所までが WF の仕事で、
  審査送信は人間が Console で押す。これを「WF が止まった」と誤解しないこと（仕様）。

`play-publish.mjs` は production で `changesNotSentForReview` を検知したら自動で **draft
フォールバック**して AAB だけ乗せる設計なので、申告を埋める前に WF を回しても空振りにはならない
（draft で待てる）。**ただし draft のまま止まると審査送信ボタンがグレーになる**ので、最後は
UI で DRAFT を確認・確定する必要がある（§3・`FIRST-SUBMISSION-blockers.md` C2）。

**掲載情報の自動入力（`play-fill-listing.mjs`）の落とし穴**: 掲載文・アイコン・グラフィック・
スクショを API で入れられるが、**phoneScreenshots は 1 言語 8 枚まで**。capture が 6.5"/6.7"
両サイズを出して 10 枚になると `edits:validate` が `403 "more than 8 screenshots"` で落ち、
**edit ごと破棄されて掲載情報が丸ごと消える**（アイコンがデフォルト表示のまま＝一見「サムネイル
無し」）。しかも 403 なので soft-fail が「権限が原因」とミスリードする。キット版は 8 枚キャップ＋
content-limit 403 の判別を実装済み。詳細は `FIRST-SUBMISSION-blockers.md` C1。

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

## 3. 送信（最後）— ★ここで詰まりやすい（2026-06〜07 実体験）

WF では審査送信されない（§0参照）。最後は必ず **Play Console UI でリリースを「次へ→審査に送信」**。
順序は次の2段階。

> **このプレイブックは元は TWA(Bubblewrap/kimito.link)前提**だが、§2〜§3 の Play Console 手順は
> **Capacitor アプリ（malwarecheck.site / apps/mobile）でも全く同じ**。違うのは AAB の作り方だけ
> （bubblewrap ではなく `npx cap add android` → Gradle。`android-play-release.yml` の Capacitor 版）。
> パッケージ名・掲載情報・11項目申告・審査送信の手順は共通。

> **既に production に DRAFT リリースがある場合（play-publish が draft フォールバック済み）**は、
> 「新しいリリースを作成」ではなく **「リリースを編集」** で既存 DRAFT を開く（下の①はどちらの
> 入口でも同じ画面に着く）。malwarecheck では WF が versionCode=2 の DRAFT を先に作っていたので
> 「リリースを編集」経由だった。**送信ボタンがグレーアウトしていたら、この DRAFT を開いて
> 「次へ→（レビュー画面）→保存→[公開の概要]に移動」を一度通す**とボタンが有効化される
> （＝DRAFT を「確認済み」に確定する必要がある。保存だけの draft のままだと送信できない）。
> 詳細は `FIRST-SUBMISSION-blockers.md` C2。

### ① 「製品版リリースの作成」画面（テストとリリース → 製品版 → 新しいリリースを作成／既存なら「リリースを編集」）
- AAB は WF が既に乗せているので、この画面の **App Bundle テーブルに version 1 (1.0.0) が載っている**
  ことを確認する。
- ⚠️ **罠：上の「ここにアップロードする App Bundle をドロップしてください」枠が空に見えて焦る**が、
  これは*追加で別の bundle を足したい人向けの入力欄*。下のテーブルに既存 bundle があれば
  **アップロードは不要・枠は空のままでよい**。「uploadする内容がない」のは正常。
- リリース名（=versionCode の `1` 等）とリリースノート(ja-JP)が入っていることを確認。
- 「アプリの完全性」=自動保護オン・Google Play 署名 OK を確認。
- 下にスクロールして **右下「次へ」** を押す（押せない＝グレーなら必須項目が空。リリースノート等を埋める）。

### ② 「プレビューして確認する」画面 → 審査送信
- 内容プレビューを確認 → **「審査のためにアプリを送信」（または「リリースの公開を開始」）** を押す。
- ⚠️ 上部に **「リリースでエラーが検出されました」** と赤く出ても、「もっと見る」で開くと実体は
  **警告1件＝「App Bundle に難読化解除ファイル(ProGuard mapping)がありません」**なことが多い。
  **Capacitor / TWA は minify しないので該当なし・無害・提出をブロックしない**（エラー0件・警告1件で
  送信できる）。ここで手が止まりやすいので覚えておく。
- Capacitor 版でこの画面に「保存」しかない場合は、まず「保存」→ダイアログ「[公開の概要]に移動」で
  公開の概要へ。そこで **「N件の変更を審査に送信」** が有効化されるので押す（→確認ダイアログ
  「変更を審査に送信」）。§3 ③ の状態遷移で送信成功を確認する。

### ①.5 製品版だけの必須項目: 配信国/地域（内部テストには無い罠・2026-07 henshin 実体験）
「テストとリリース → 製品版」のレビュー画面で
**「🔴 このトラックの国または地域が選択されていません。このリリースを公開するには、国または地域を
追加してください」** という本物の赤エラーが出て「保存」がグレーになることがある。ProGuard 警告
（②の「無害な誤検知」）とは別物で、これは**対処が必須**な本物のエラー。
- 直し方: テストとリリース → 製品版 → **「国/地域」タブ** → 「国/地域を追加」→ 国名（例:日本）で
  検索してチェック → 保存。
- 内部テストトラックでは配信国選択が不要なため初見になりやすい。production では必須。

### ①.6 広告ID(AAID)申告は §2 の「広告」宣言（項目2）とは別物・審査送信の直前ダイアログで出る
§2 の11項目で「広告」を**いいえ**にしていても、審査送信を試みると別の確認ダイアログ
**「🔴 1件の問題が検出されました / 広告 IDの申告が不完全です / Android 13以降をターゲットとする
すべてのデベロッパーは、アプリで広告 ID を使用しているかどうかを申告する必要があります」**が出る。
- 直し方: 「申告を完了する」→ 「アプリで広告 IDを使用していますか？」→ 広告SDK未使用なら**いいえ**
  → 保存。Capacitor/TWA の殻アプリは広告SDKを持たないので常に「いいえ」。
- Android 13(API 33)以降の**独立した必須申告**。§2 項目7（広告ID(AAID)＝使用しない）と趣旨は
  同じだが、**確認導線が別ダイアログとして審査送信の直前に割り込む**点が罠。

### ③ 送信後の「公開の概要」での状態遷移（送信できた証拠）
1. 押した直後は上部に **「一般的な問題のクイックチェックを実行する（残り約 N 分）」** のバー。
   説明文に「チェックが完了するとすぐに審査のために送信されます」とあり、**約12〜15分の自動チェック後に
   自動で審査キューへ**入る（このバーが出ていれば送信操作は成功している）。
2. チェック完了後、バーが消えて **「変更内容は現在審査中です。アプリの審査時に他の問題が見つかる
   ことがあります。」** に変わる ＝ **正式に審査キューに入った最終サイン**。ここまで来たら人の操作は終了。
3. 以後は Google の審査（数時間〜数日、初回は長め）→ 承認で production 一般公開（「完全公開を開始」を
   選んでいれば日本で自動公開）。指摘ならメールで来るので修正して再送信。

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
5. **掲載情報も API で入る**（`play-fill-listing.mjs`＝掲載文/アイコン/フィーチャーグラフィック/
   スクショ）。⚠️ **スクショは 8 枚まで**（超過すると edit ごと破棄・掲載情報が全消え＝キット版は
   8枚キャップ済み）。**Data safety も自動化できる**（`play-generate-data-safety-csv.mjs`→
   `play-fill-data-safety.mjs`、Publisher API 送信で `DONE`）。**App content / Content rating は
   API 無し＝手入力必須**。※ これら play-fill-* はキット `templates/scripts/` に還元済み。
6. **最後の「次へ→審査に送信」は Play Console UI でやる**（WF は冪等スキップで止まる＝仕様）。
   「製品版リリースの作成」画面でアップロード枠が空でも、テーブルに bundle があれば追加不要。
   **送信ボタンがグレーなら、製品版 DRAFT を「リリースを編集→次へ→保存→[公開の概要]に移動」で
   確定**するとボタンが有効化される（C2）。レビュー画面の「エラー検出」は ProGuard mapping 無しの
   警告で無害。
7. 送信後「クイックチェック（約12〜15分）」→ 見出しが「審査中の変更」に変われば審査投入完了。
   iOS の App Privacy 手動公開と同じ「Web UI 必須」枠。
8. **Capacitor でも同じ**：§2〜§3 の Console 手順は TWA/Capacitor 共通。違うのは AAB の作り方だけ
   （`npx cap add android`→Gradle vs bubblewrap）。
9. **製品版は配信国/地域の選択が必須**（内部テストには無い）。レビュー画面の赤エラー
   「国または地域が選択されていません」は「国/地域」タブで追加すれば消える（①.5）。
10. **広告ID(AAID)申告は §2 の「広告」宣言と別ダイアログ**で審査送信の直前に出る
    （「広告 IDの申告が不完全です」）。「申告を完了する」→ 広告SDK無しなら「いいえ」（①.6）。
11. **ストア一覧のアイコンは配信済みビルドのキャッシュ**。新アイコンのビルドを審査に出しても、
    承認・配信されるまで一覧は旧アイコンのまま＝「反映されてない」と焦らない。実際に差し替わって
    いるか確認したいときは審査待ちビルドの実アイコンを直接見る（詳細 `FIRST-SUBMISSION-blockers.md` C7）。

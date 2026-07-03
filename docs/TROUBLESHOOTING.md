# 公開後・提出後のトラブルシューティング

> 「審査に通った＝ユーザーがダウンロードできる」ではありません。
> 承認と公開のあいだに、もう一歩あります。実際のリリースで踏んだ罠と、その直し方をまとめます。

---

## 🍎 iOS：承認されたのに「この国または地域では入手できません」

### こんな症状
App Store の審査は通って「販売準備完了（READY_FOR_SALE）」なのに、
iPhone の App Store で **「このアプリは現在、この国または地域では入手できません」** と出てDLできない。

### 原因
**配信地域（App Availability）が設定されていない**（0地域）。
審査の合否と「どの国で配信するか」は**別の設定**です。新規アプリで地域を指定していないと、
承認されても誰もダウンロードできません。

### 直し方（2分）
1. [App Store Connect](https://appstoreconnect.apple.com) → アプリを選択
2. 「**価格および配信状況**」を開く
3. 「アプリの配信状況」→「**配信状況の設定**」
4. 「**すべての国または地域**」を選んで確定
5. 反映は **最大24時間**（多くは数時間以内）

> 💡 「全世界」でも日本語アプリで問題ありません。後から絞り込めます。

---

## 🍎 iOS：起動時にCapacitorの青い「×」ロゴが出る（自分のロゴにならない）

### こんな症状
アプリを起動した瞬間のスプラッシュ画面が、自分で指定したロゴではなく
**Capacitorのデフォルト（白背景に青い×のようなロゴ）** のまま。

### 原因
`ios/` フォルダはgitにコミットしない運用（金型の原則）のため、CIが毎回 `cap add ios` で
新規生成します。このとき**Capacitorデフォルトのスプラッシュ画像が必ず入ります**。
そして `@capacitor/assets generate` に `icon-only.png` しか渡していないと、
**アイコンだけ生成されてスプラッシュは生成されません**（エラーも警告も出ない）。
結果、デフォルトの青ロゴがそのままApp Storeに出荷されます。

### 直し方（自動化を直す。手で画像を差し替えない）
1. スプラッシュのマスター画像（2732×2732）を生成して `store-assets/` にコミットする
2. CIワークフローで `assets/splash.png` としてコピーし、`@capacitor/assets generate` に渡す
3. 生成後に `Splash.imageset` の sha256 が**生成前から変わったこと**を確認し、
   変わっていなければビルドを失敗させる（配信前ゲート＝直接証拠化）

実装例：Exosome の `.github/workflows/ios-appstore-release.yml` 「Generate icons + splash」ステップ。

> 🦝 たぬ姉「ローカルの `ios/` フォルダの画像を手で直しても、**CIは毎回作り直すから意味ないよ**。直すのはワークフローの方！」

---

## 🍎 iOS：「このバージョンの新機能」が絵文字で409エラー

### こんな症状
審査提出の自動化が `409 ENTITY_ERROR.ATTRIBUTE.INVALID.INVALID_CHARACTERS` で失敗。
`What's New in This Version can't contain the following character(s): 🐢, 🌱` のようなメッセージ。

### 原因
**App Store Connect は「このバージョンの新機能（whatsNew）」に絵文字を許可しません。**
一方、Google Play のリリースノートは絵文字OK。同じリリースノートを両ストアで
使い回すと、iOS側だけ提出に失敗します。

### 直し方
リリースノートのファイルからは絵文字を消さず（Play側はそのまま使える）、
**iOS提出スクリプト側で絵文字を自動除去**します。
実装例：Exosome の `scripts/appstore-submit.mjs` の `stripDisallowedEmoji()`
（`\p{Extended_Pictographic}` ＋ ZWJ/異体字セレクタ/肌色修飾子を除去）。

---

## 🍎 iOS：写真・カメラの説明文（Purpose Strings）でリジェクト

### こんな症状
Guideline **5.1.1(ii)** でリジェクト。「カメラ／写真へのアクセスの説明が不十分」。

### 直し方
説明文に **「使い道 ＋ 具体例 ＋ 端末内に保存 ＋ 外部送信しない」** を全部書きます。

❌ ダメな例：「写真へのアクセスに使います」
✅ 良い例：
> 「肌の状態を記録するため、撮影またはライブラリから選んだ写真を使います。
> 写真は端末内にのみ保存され、外部サーバーには送信されません。」

これで**再提出して一発承認**できた実績があります。

---

## 🍎 iOS：`appInfoLocalization` の更新が `ATTRIBUTE.NOT_ALLOWED` で失敗

### こんな症状
審査提出の自動化が `409 ENTITY_ERROR.ATTRIBUTE.NOT_ALLOWED` で失敗。
`appInfoLocalizations` の**更新（PATCH）**でだけ起きる（新規作成のPOSTは通る）。

### 原因
ASC APIは `appInfoLocalizations` の **PATCH に `locale` 属性を含めると拒否**します。
`locale` は作成（POST）時にしか設定できない属性で、更新時は送ってはいけません。
name/subtitle/privacyPolicyUrl等と同じ `attrs` オブジェクトをPOSTにもPATCHにも
使い回すコードだと、うっかりPATCHにも `locale` が乗ってしまいます。

### 直し方
PATCH直前に `locale` をオブジェクトから分割除去する。
実装例：`scripts/appstore-submit.mjs` の `ensureAppInfoLocalization()`。
```js
const { locale: _locale, ...patchAttrs } = attrs;
await api('PATCH', `/v1/appInfoLocalizations/${loc.id}`, {
  data: { type: 'appInfoLocalizations', id: loc.id, attributes: patchAttrs },
});
```

> 🦝 たぬ姉「POSTとPATCHで送っていいフィールドが違うのはASC APIあるある。
> 使い回すオブジェクトは要注意だよ！」

---

## 🍎 iOS：初回提出が土壇場で `STATE_ERROR.APP_DATA_USAGES_REQUIRED`（409）

### こんな症状
ビルド・アップロード・スクショ・age rating・カテゴリまで全部自動で通ったのに、
**最後の「審査へ提出」の一歩手前**で `409 STATE_ERROR.APP_DATA_USAGES_REQUIRED` が出て失敗。
`associatedErrors` に `/v1/appDataUsages/` が出ているのが目印。

### 原因
「App のプライバシー」（データ収集の申告＝プライバシー栄養ラベル）が
**App Store Connect の Web UI で未公開**。
この `dataUsages` は Apple の制限で **Web session 専用**であり、
CIが使うJWT（APIキー）認証では読み書きできません。自動化スクリプトは
`[7d] Ensure privacy` ステップで検出だけしてWARNを出し、fail-softで
submitへ進む設計になっています（実装：`ensurePrivacyPublished()` 相当のブロック）。
つまり**この1項目だけは自動化できず、必ず人間がGUIで公開する必要がある**。

### 直し方（人間の作業・2〜3分）
1. [App Store Connect](https://appstoreconnect.apple.com) → アプリ → 「App のプライバシー」
2. 「データタイプ」の「編集」から、実際に収集しているデータ種別だけチェック
   （例：メールアドレス／メールまたはテキストメッセージ／ユーザID など。
   使っていない電話番号・位置情報・写真等はチェックしない）
3. 各データ種別ごとに聞かれる3問に実態通り回答：
   - 用途 → 広告/アナリティクス目的で使っていなければ「**アプリの機能**」のみ
   - ユーザの個人情報に関連付けられるか → アカウントに紐づくなら「**はい**」
   - トラッキング目的で使うか → 広告ネットワーク等と共有していなければ「**いいえ**」
4. 最後に **「公開」** ボタンを押す（下書き保存だけでは不十分）
5. 公開後にCIを再実行すれば通る

> ⚠️ 「収集しない」で嘘の申告をしない。OAuthログインやメール送信機能があるアプリは
> 大抵メールアドレス等を収集している。実態と違う申告は Guideline 5.1.1/5.1.2 で
> 審査リジェクトの典型パターンになる。

---

## ⚙️ CI：`workflow_dispatch` の手動再実行と直前のpushが衝突してキャンセルされる

### こんな症状
`gh workflow run` で手動再実行した直後に、直前のgit pushで自動起動していた別のrunが
（あるいは逆に、手動runの方が）**理由もなく `cancelled` になる**。
`gh run cancel` で片方を止めたつもりが、実は残したかった方が消えていた、ということも起きる。

### 原因
同じ concurrency group（同一ワークフロー・同一ブランチ）に対して
push トリガーと workflow_dispatch トリガーがほぼ同時に走ると、
GitHub Actions が古い方（または `cancel-in-progress` 設定次第で新しい方）を
自動キャンセルする。手動での `gh run cancel` 発行タイミングと重なると、
意図と逆のrunが残ることがある。

### 直し方
- pushした直後は**手動 `workflow_dispatch` を追い打ちで撃たない**
  （push側のrunが自動で起動するのを待つ）
- 再実行が必要なら、まず `gh run list --workflow=<file> --limit 5` で
  **現在アクティブなrunが本当に1本だけか**を確認してから待つ
- 複数走ってしまったら、キャンセル操作の直後にもう一度 `gh run list` で
  「意図した方が生きているか」を必ず確認する（キャンセルして終わりにしない）

---

## 🤖 Android：TWA(bubblewrap)ではアプリ内課金(IAP)が組み込めない

### こんな症状
Android版に Google Play Billing（アプリ内課金）を実装しようとしたら、
`android-twa/` プロジェクトにネイティブの購入プラグインを追加する方法が見つからない。

### 原因
**TWA(Trusted Web Activity/bubblewrap)は「WebサイトをそのままAndroidアプリ化する」軽量ラッパー**で、
ネイティブコードを持たない設計。Google Play Billingのようなネイティブ機能をアプリに
組み込む余地が原理的にない。iOSのCapacitorアプリと足並みを揃えたつもりで
「Androidだけ軽量なTWAのまま」進めていると、IAP実装フェーズで詰む。

### 直し方
IAPが必要なら最初から **Capacitor** で `android/` プロジェクトを生成する
（`android-twa/` は使わない）。`templates/workflows/android-play-release.yml` は
Capacitor版に統一済み。IAPが不要な単純なWebラップだけで良いアプリは、
引き続きTWA(bubblewrap)の方が軽量なので、そちらを選んでよい
（`setup-new-app.mjs` が両方の選択肢を案内する）。

> 🦝 たぬ姉「TWAとCapacitorはどっちも『Webサイトをアプリにする』手段だけど、
> ネイティブ機能が要るかどうかで選ぶものが変わるよ。課金が絡むなら最初からCapacitor！」

---

## 🤖 IAP：存在しないプラグイン名をコードにハードコードしてしまう罠

### こんな症状
`iap-billing.js`（クライアント購入コード）が `window.Capacitor.Plugins.InAppPurchases`
のような特定のプラグインを参照しているが、`npm install` しようとすると
パッケージが見つからない・そもそもnpmに存在しない。

### 原因
「いかにもありそうな名前」（例: `@capacitor-community/in-app-purchases`）を
実在確認せずに実装で仮置きしてしまい、そのまま忘れられるパターン。
実際に2026年時点で確認したところ、このパッケージ名はnpm/GitHubに存在せず、
2020年の提案issueが未実装のまま放置されたものだった。IAPの実機結線を
後回し（P5後半等）にしていると、この手のプラグイン名ミスが長期間気づかれずに残る。

### 直し方
IAPプラグインを選ぶ前に、実装前チェックリストとして毎回確認する：
1. npm/GitHubで実際に存在するか（`npm view <package>` や検索で確認、憶測で書かない）
2. アクティブにメンテされているか（最終公開日・Issue対応状況）
3. **サーバー側の検証方式と噛み合うか** — 自前サーバーでストアAPIへ直接
   `purchaseToken`/レシートを検証する設計なら、プラグインが生のトークンを
   露出するか確認する。RevenueCat等の「購入から検証・エンタイトルメント管理まで
   自社バックエンドで完結させる」タイプのSDKは、生のpurchaseTokenを
   意図的にラップして見せないことがある（RevenueCat公式コミュニティで
   スタッフが "the purchase token isn't exposed through RevenueCat's APIs" と明言）。
   既存の自前検証資産を活かしたいなら、生トークンをそのまま返す
   `@capgo/native-purchases` のような直結型プラグインの方が噛み合う。

---

## 🤖 Android：「審査にまだ送信されていない」のまま進まない

### こんな症状
Play Console で AAB はアップロード済み、製品版リリースも作ったのに、
ステータスが **「審査にまだ送信されていない」** から変わらない。

### 原因
リリースは作られているけれど、**最後の「審査用に送信」ボタンが押されていない**だけ。

### 直し方
- **GUI**：Play Console → リリース → 製品版 → 「**審査用に送信**」
- **自動化**：`PLAY_TRACK=production node scripts/play-publish.mjs --submit`
  - データセーフティ等の必須項目が未入力なら、安全のため自動で「下書き保存」に切り替わり、
    誤って審査送信されないようになっています。

---

## 🤖 Android：「すべてのバンドルに署名が必要」エラー

### 切り分け方法
```bash
# 1. AABが署名されているか（UPLOAD.RSA / UPLOAD.SF が出ればOK）
unzip -l app-release.aab | grep -iE "META-INF/.*\.(RSA|SF)"

# 2. アップロード鍵の指紋が Play Console の登録値と一致するか
keytool -list -v -keystore upload-key.jks -alias upload | grep SHA256
```

### よくある原因
- `build.gradle` に署名設定がない
  → `signingConfigs { release { ... } }` と
    `buildTypes { release { signingConfig signingConfigs.release } }` の**両方**が必要
- 署名なしのAABをアップロードしている → 上のコマンドで `RSA/SF` が出なければ未署名

---

## 🧩 Chrome：申請の自動化で詰まる（OAuthまわり）

詳細は `docs/CHROME-WEBSTORE.md` に。よく詰まる2点だけ：

- **OAuthクライアントの種類**：「Chrome 拡張機能」ではなく **「デスクトップ アプリ」** を選ぶ。
  間違えるとスクリプトが認証できない。
- **`invalid_grant: Bad Request`**：認証コードの**貼り間違い／不完全コピー**か**期限切れ**（数分で失効）。
  認可URLを開き直して新しいコードを取り直せばOK。
- **却下回避**：名前/説明/画像に「無料/Free/Premium」を入れない。外部CDNを実行時に読まない（vendor/ に同梱）。

---

## ✅ 公開後チェックリスト（承認メールが来たら）

- [ ] **iOS**：配信地域が設定済みか（未設定だとDL不可）
- [ ] **iOS**：実機の App Store 検索／直リンク `apps.apple.com/jp/app/idXXXXXXXX` でDL確認
- [ ] **Android**：製品版が「審査に送信済み」か（リリース作成だけで止まっていないか）
- [ ] **Chrome**：`publish-cws.ps1` で `status=OK` を確認（審査提出済みか）
- [ ] 反映には時差あり（iOS配信網：〜数時間、検索ヒット：〜24時間、Chrome審査：〜数日）
- [ ] 公開できたら、関係者にストアURLを共有 🎉

---

## 💡 覚えておく3つのこと

1. **承認 ≠ 公開**：iOSは「配信地域」、Androidは「審査送信」という別ステップがある
2. **反映には時差**：緑チェックが付いても、実機でDLできるまで数時間〜24時間かかる
3. **困ったらAIに**：エラー画面をスクショして「これ直して」と渡せば、たいてい解決します

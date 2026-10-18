# Apple 開発者アカウントのアプリ棚卸し（2026-10-18・ASCの実データ）

> **今の到達点: 棚卸し完了（事実の一覧）。「どのアプリを残す／止めるか」の判断は未実施（事業判断＝本人）。**
> 取り方: App Store Connect API の読み取り専用呼び出し（`GET /v1/apps` と各アプリの `appStoreVersions`）。認証は `kimitolink-linktree/.secrets-local` の ASC 鍵（前のセッションと同じ置き場）。**鍵の値はどこにも出していない。書き込みは一切していない。**
> 背景: [`apple-account-termination-risk.md`](apple-account-termination-risk.md)（アカウントが終了されると、中の全アプリが止まる）。関連: [`DESIGN-apple-4-3a-spam-response-2026-10-06.md`](DESIGN-apple-4-3a-spam-response-2026-10-06.md)。

## 一覧（ASC に実在する12本・同一アカウント）
| # | アプリ名 | bundleId | ASC ID | 最新バージョンの状態 | ソースの場所（実在確認） |
|---|---|---|---|---|---|
| 1 | ゆっくりエクソソーム | com.kimito.link.yukkuriexosome | 6775201794 | 0.2.0 販売中 | yukkuri-exosome.link |
| 2 | 君斗りんくの動員ちゃれんじ（D） | com.kimito.link.doinchallenge | 6808515868 | 1.0.0 **審査待ち** | doin-challenge.com |
| 3 | 君斗りんくのすれ違ひ通信（S） | com.kimito.link.surechigai | 6796909175 | 1.0.0 **却下（REJECTED）** | surechigai-romi.link |
| 4 | Kimito Link Voice | com.kimito.link.voice | 6809058070 | 1.0.0 **提出準備中（未提出）** | kimito-Link-Voice |
| 5 | リバースハック WEB健康診断 | com.reversehack.webhealth | 6780161483 | 1.1.1 販売中 | web-health-check-app（`app.config.reverse-hack.json`） |
| 6 | マルウェアチェック.site | com.reversehack.malwarecheck | 6785846826 | 0.1.1（API上は販売中の版）／**App Store の画面では「App Storeから削除済み」** | malwarecheck.site |
| 7 | kimito.link | com.kimito.link.linktree | 6782380276 | 0.1.5 販売中 | kimitolink-linktree |
| 8 | CC/BCC再送信 - 君斗りんくのAI返信サジェスト | com.kimito.link.resend | 6786996042 | 1.0.1 販売中 | resend.kimito-link.com-（末尾ハイフンまでがフォルダ名） |
| 9 | 君斗りんくのWEBサイト健康診断 | com.kimito.link.webhealthcheck | 6779860644 | 1.0.2 販売中 | web-health-check-app |
| 10 | 君斗りんくのAI返信秘書 | jp.besttrust.henshinhisho | 6787949833 | 1.0.0 販売中 | henshin-hisho/ios-app |
| 11 | リバースハック | com.reversehack.partner | 6769407908 | 1.0.17 販売中 | partnership_program_website |
| 12 | 富士山コンパス | com.kimito.link.fujisancompass | 6760695314 | 2.4.16 販売中 | compass |

（販売中 = `READY_FOR_SALE`。表のバージョンは各アプリの最新の1件。**注意: API の `appStoreState` は「版の状態」で、アプリ自体が App Store から削除されているかは映らない**。#6 は API 上は販売中の版だが、App Store Connect の画面では「App Storeから削除済み」。削除済みのアプリが他にもないかは、画面で確認が要る。）

**契約（2026-10-18・Apple Developer の画面）: Apple Developer Program License Agreement（発効日 2026-10-14）は、Account Holder（takashi kobayashi・組織 BEST TRUST K.K.・年間登録料 ¥12,980・更新日 2027-03-17）が同意日 2026-10-18 で同意済み。** 同じ日の朝の App Store Connect には「同意が必要」の警告が出ていたが、その後に同意された。更新・新規提出は、契約の面では可能な状態。

## 分かったこと
1. **12本すべてが、1つの ASC アカウントに載っている**（1つの API キーが12本を見られる）。記録上の開発チームIDは `8922HQ842P`（`app.config.json` 6本で確認。Voice と partner は config にチームIDの記載なし）。→ [終了リスク](apple-account-termination-risk.md)の**影響範囲は12本全部**。
2. **bundleId の名前空間が3つ**: `com.kimito.link.*`（8本）・`com.reversehack.*`（3本: webhealth・malwarecheck・partner）・`jp.besttrust.*`（1本: henshinhisho）。ブランドが複数あっても、**Apple から見れば同じアカウント**。
3. **今まさに動いているもの**: S は却下済み、D は審査待ち、Voice は未提出。S・D が 4.3(a)（スパム）の対象だった経緯は[設計書](DESIGN-apple-4-3a-spam-response-2026-10-06.md)のとおり。
4. **同じコードベースの2つの名前**: 「リバースハック WEB健康診断」(#5) と「君斗りんくのWEBサイト健康診断」(#9) は、同じ `web-health-check-app` から2つの名前で出ている。**4.3(a) が名指しする「同型のアプリ」の形そのもの**（設計書もこのリスクを認識して T0 で凍結している）。2本とも販売中なので、**今すぐ却下されているわけではない**が、アカウント単位の終了リスクの観点では、棚卸しで最初に目に入る束。
5. **ASC にあってリポの走査（`app.config.json`）では見えなかったもの**（#8 resend・#10 henshinhisho・#12 compass）は、別の場所（`resend.kimito-link.com-`・`henshin-hisho/ios-app`・`compass`）にソースがあった。「リポに config が無い＝アプリが無い」ではない。逆に、`sakkino.link` は config に bundleId があるが **ASC には無い**（未作成）。

## 未確認・やっていないこと
- ~~アカウントの種別（個人／組織）は未確認~~ → **確定: 組織（BEST TRUST K.K.、チームID 8922HQ842P）**。Apple Developer のフォームの「組織」欄で確認（2026-10-18・サインイン済みの Chrome）。GitHub 側の `kimito-link` が User アカウントであることとは別の話。
- 各アプリの**実際のダウンロード数・収益・直近の更新日**は未取得（棚卸しの材料にはなるが、今回は状態と所在までに留めた）。
- **どのアプリを残す／止めるかは決めていない**（事業判断）。判断材料として足りないのは、上のダウンロード数・収益と、各アプリの事業上の位置づけ。
- 「12本」は、この日の ASC の API の返答。ASC に出ない（削除済み・別アカウントの）アプリは含まない。

## マルウェアチェック.site を再び出すときの名前の案（2026-10-18・本人の発案: 「不正アクセス侵害チェック」のような名前）
- **現状（App Store Connect の画面）**: 「このアプリは App Store の配信から削除されました。『価格および配信状況』で再度追加してください」。v0.1.1 は「配信準備完了」。**審査で落ちたのではなく、配信から外してある状態**（外した経緯の記録は見つからなかった）。
- **名前の衝突**: 日本の App Store で「不正アクセス侵害チェック」「不正アクセスチェック」「侵害チェック」「不正アクセス 侵害 チェック」を検索 → **同名のアプリは0件**。長さは12文字（上限30）。
- **論点は機能との一致（審査 2.3）**: このアプリは、URL を入れて**Webサイトの**マルウェア感染疑い・改ざん疑い・不審なリダイレクト等を調べる（README）。利用者自身のアカウントへの「不正アクセス」を検知するものではない。「不正アクセス侵害チェック」は**機能より広い名前**で、審査の指摘にも、「断定しない」方針にも、合わない恐れがある。
- **推奨案**: 名前=「**サイト侵害チェック**」（9文字）、サブタイトル=「改ざん・不正アクセスの痕跡を点検」（検索語の「不正アクセス」はサブタイトルに入れる）。
- **名前を変えて出すときの手順と前提（私は実行していない）**: ①新しいバージョン（0.1.2 など）で、名前・サブタイトル・アプリ内表示名（表示名・スクショ・説明文）を揃えて更新 ②**4.3(a) の対応で決めた「他アプリの新規提出の凍結」の解除が先**（[設計書](DESIGN-apple-4-3a-spam-response-2026-10-06.md) §ゲート・解除は本人の判断）③~~Account Holder が使用許諾契約に同意~~ → **済み（2026-10-18）**④`lint-pre-submission.mjs` の CHECK 24〜30（4.3(a) の点検）を通す ⑤ドメイン名「マルウェアチェック.site」と名前がずれる点は、LP の表記と合わせるか別途判断。

## マルウェアチェックの再提出の準備（2026-10-18・[malwarecheck.site#165](https://github.com/kimito-link/malwarecheck.site/pull/165) マージ済み）
- iOS アプリ名を「サイト侵害チェック」に変更し、4.3(a) の区別軸（`distinction`）と `store-assets/team-apps.json` を宣言。**キット最新の lint-pre-submission（CHECK 24〜32）が全て通る**。このリポの iOS 提出ワークフローは push トリガーが無効（手動実行のみ）なので、マージしても提出は走らない。
- **出していない**: ASC への書き込み・名前の更新・「価格および配信状況」からの再追加は未実施。残るのは、凍結の解除の判断（本人）と、ASC での名前・サブタイトル・キーワードの更新と再追加（本人の合図があれば準備できる）。

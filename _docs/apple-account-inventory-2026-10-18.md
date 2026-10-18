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
| 6 | マルウェアチェック.site | com.reversehack.malwarecheck | 6785846826 | 0.1.1 販売中 | malwarecheck.site |
| 7 | kimito.link | com.kimito.link.linktree | 6782380276 | 0.1.5 販売中 | kimitolink-linktree |
| 8 | CC/BCC再送信 - 君斗りんくのAI返信サジェスト | com.kimito.link.resend | 6786996042 | 1.0.1 販売中 | resend.kimito-link.com-（末尾ハイフンまでがフォルダ名） |
| 9 | 君斗りんくのWEBサイト健康診断 | com.kimito.link.webhealthcheck | 6779860644 | 1.0.2 販売中 | web-health-check-app |
| 10 | 君斗りんくのAI返信秘書 | jp.besttrust.henshinhisho | 6787949833 | 1.0.0 販売中 | henshin-hisho/ios-app |
| 11 | リバースハック | com.reversehack.partner | 6769407908 | 1.0.17 販売中 | partnership_program_website |
| 12 | 富士山コンパス | com.kimito.link.fujisancompass | 6760695314 | 2.4.16 販売中 | compass |

（販売中 = `READY_FOR_SALE`。表のバージョンは各アプリの最新の1件。直近3件の状態は、すべて販売中のものは販売中だった。）

## 分かったこと
1. **12本すべてが、1つの ASC アカウントに載っている**（1つの API キーが12本を見られる）。記録上の開発チームIDは `8922HQ842P`（`app.config.json` 6本で確認。Voice と partner は config にチームIDの記載なし）。→ [終了リスク](apple-account-termination-risk.md)の**影響範囲は12本全部**。
2. **bundleId の名前空間が3つ**: `com.kimito.link.*`（8本）・`com.reversehack.*`（3本: webhealth・malwarecheck・partner）・`jp.besttrust.*`（1本: henshinhisho）。ブランドが複数あっても、**Apple から見れば同じアカウント**。
3. **今まさに動いているもの**: S は却下済み、D は審査待ち、Voice は未提出。S・D が 4.3(a)（スパム）の対象だった経緯は[設計書](DESIGN-apple-4-3a-spam-response-2026-10-06.md)のとおり。
4. **同じコードベースの2つの名前**: 「リバースハック WEB健康診断」(#5) と「君斗りんくのWEBサイト健康診断」(#9) は、同じ `web-health-check-app` から2つの名前で出ている。**4.3(a) が名指しする「同型のアプリ」の形そのもの**（設計書もこのリスクを認識して T0 で凍結している）。2本とも販売中なので、**今すぐ却下されているわけではない**が、アカウント単位の終了リスクの観点では、棚卸しで最初に目に入る束。
5. **ASC にあってリポの走査（`app.config.json`）では見えなかったもの**（#8 resend・#10 henshinhisho・#12 compass）は、別の場所（`resend.kimito-link.com-`・`henshin-hisho/ios-app`・`compass`）にソースがあった。「リポに config が無い＝アプリが無い」ではない。逆に、`sakkino.link` は config に bundleId があるが **ASC には無い**（未作成）。

## 未確認・やっていないこと
- **アカウントの種別（個人／組織）と、登録名義は未確認**（ASC API からは取れない。GitHub 側の `kimito-link` が User アカウントであることは記録済みだが、Apple 側は別）。
- 各アプリの**実際のダウンロード数・収益・直近の更新日**は未取得（棚卸しの材料にはなるが、今回は状態と所在までに留めた）。
- **どのアプリを残す／止めるかは決めていない**（事業判断）。判断材料として足りないのは、上のダウンロード数・収益と、各アプリの事業上の位置づけ。
- 「12本」は、この日の ASC の API の返答。ASC に出ない（削除済み・別アカウントの）アプリは含まない。

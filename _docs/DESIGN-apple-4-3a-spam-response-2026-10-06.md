# 設計: App Store 4.3(a) スパム却下（Extended Review・除名リスク）への対応

> **状態: 設計完了・実装は T0（凍結）のみ実施済み（2026-10-06）。** 本人決定: 「おすすめで進める」「リバースハック版は出せる形にして出す」（B3 を差し替え済み）。 設計=Fable（3段構え手順2）／素材=無料会議5体＋全アプリ棚卸し＋法令調査／裏取り・訂正=司令塔。
> 進捗・PR は実装ハンドオフ §7。入口: このファイル → 実装は [`IMPLEMENTATION-HANDOFF-apple-4-3a-spam-response-2026-10-06.md`](IMPLEMENTATION-HANDOFF-apple-4-3a-spam-response-2026-10-06.md) → 観測の原本は [`DESIGN-apple-4-3a-spam-response-2026-10-06-evidence.md`](DESIGN-apple-4-3a-spam-response-2026-10-06-evidence.md)。
> 却下の経緯・ASC 提出 ID はエビデンス側と `.agent/coord.md` の ALERT（cc-doin-apple-4-3a-reject）にある。

## 0. 司令塔の検証メモ（Fable の設計を実ファイルで確認した結果）

確認できたもの（実在・内容一致）: S の `components/molecules/login-success-modal.tsx:39`・`encouragement-modal.tsx:35` の「動員ちゃれんじへようこそ！」、`components/providers/clerk-root-provider.tsx` の `<LoginSuccessModalWrapper />`、`modules/encounter/core/category.ts` の `CATEGORY_IDS`、`app/(tabs)/events.tsx`、`modules/event/api/participation.ts`、`app/premium.tsx`、`api/revenuecat-webhook.ts`、`lib/navigation/app-routes.ts`、S/D の `capacitor.config.json` 残骸、D の `store-assets/screenshot-plan.json` の `"/lp"` と文字化け「仯首」、S・D・yukkuri・web-health の `ios-appstore-release.yml` の `on.push.paths`、`asc-review-poll.yml` の `RETRY_ACTIONS`（S・金型とも）、キット側の lint/分類器/金型/スキーマ（`additionalProperties:false`）の各パス、`lint-pre-submission.mjs` の既存 CHECK は 23 まで、KB §4.3 が 514-520 行、`classifyRejection` に 4.3 原文を通すと `UNKNOWN / manual-review`（実行して確認）、jscpd 5.4.0（2026-09-30 更新）・imghash 1.1.4 が npm に実在。

**Fable の設計から訂正した点（実測で食い違った）**

1. **「GitHub Organization 変数 `STORE_SUBMISSION_FREEZE`」は使えない。** `kimito-link` は Organization ではなく **User アカウント**（`gh api users/kimito-link` → `type: User`、`orgs/kimito-link/actions/variables` は 404）。→ 凍結スイッチは §B4 の代替（キット公開リポ内の `store-submission-freeze.json` を CI が実行時に取得）に差し替えた。
2. `server/account-deletion.ts` は存在しない。実際のアカウント削除は `modules/encounter/db/account-deletion.ts`・`modules/encounter/core/account-deletion-confirm.ts`・`components/mypage/delete-account-control.tsx`、削除案内 URL は `app.config.json` の `contact.dataDeletionUrl`（`https://surechigai.kimito.link/deletion`）。
3. web-health-check-app の RH 向け workflow は5本ではなく **6本**（`android-play-release-reverse-hack` / `mobile-bootstrap-reverse-hack` / `play-listing-reverse-hack` / `play-setup-production-reverse-hack` / `play-status-reverse-hack` / `play-submit-review-reverse-hack`）。
4. ★新たな罠: web-health の `ios-appstore-release.yml` は `on.push.paths` に **`app.config.reverse-hack.json` と `store-assets/reverse-hack/**` を含む**。T1 で `_status` を書き換えるだけで iOS 提出が起動し得る → **T0（workflow 無効化）が先、T1 はその後**。
5. yukkuri には `ios-release-now.yml` もあるが `workflow_dispatch` のみ（push 経路は `ios-appstore-release.yml` の1本）。

**未確認のまま残るもの（断定しない。実装時に確認）**

| # | 未確認 | 確認方法 |
|---|---|---|
| U1 | Apple が実際にどの画面・文字列を「類似」と見たか（取得不能） | Resolution Center で「該当画面・要素を指摘してください」と求める |
| U2 | S・D の `ios-appstore-release.yml` が 4.3 却下後（S: 9-23 以降、D: 10-4 以降）の push（ちらつき修正 PR #73/#77/#78 等）で**再提出まで走っていないか** | `gh run list -w ios-appstore-release`、`node scripts/asc-review-check.mjs` の `appStoreState` |
| U3（解決: 実装済み・2026-10-06） | S の iOS ログインに Sign in with Apple が実際に出ているか（config は `siwaEnabled:false`、共有 Clerk 側で Apple 有効なら出る） | 実機/シミュレータで `/sign-in` を目視 |
| U4 | S の `locations.note`（140字）・`users.hitokoto` に通報導線があるか／利用規約に出会い目的禁止があるか | `Grep 通報|report`、規約実物 |
| U5 | 「再提出すると appeal が閉じる」（公式は「1提出につき appeal 1回」まで確認、閉じる条件は未再確認。Apple ID ログイン要で取得不能） | App Review に電話で確認 |
| U6（解決: 通る・ASC は12本） | ASC `GET /v1/apps` を無フィルタで全件取得できるか（`asc-api.mjs:56 findApp` は `filter[bundleId]` 付き） | creds のある環境で1回 |
| U7（解決: 5 config とも赤だった→T2 で解消） | S・D のリポで `verify-app-config-schema.mjs` が走っているか（S の config にはスキーマ外キーがある疑い） | `pnpm check` ログ |
| U8 | 健康診断2本の実 DL 数（評価0は確認済み） | ASC Sales Report |
| U9 | 君斗りんく版 WEB健康診断の Play 再提出（9-14）の結果 | Play Console |
| U10 | D のバイナリに S 名義（「すれ違」）が混入していないか（S→D は走査済み、逆は未） | `Grep すれ違|surechigai` を D の app/components/lib で |
| U11（解決: S・D とも IAP/サブスク 0 件） | S の RevenueCat/StoreKit 商品が ASC に登録されているか | ASC > App 内課金 |

---

## A. 状況の再構成

### A-1. なぜ却下されたか — 確度つき上位要因

Apple が見た画面は未取得（U1）。以下は観測から説明力の高い順に並べた**自己診断であり、Apple の判定の再現ではない**。

| 順 | 要因 | 確度 | 根拠 | 仕分け |
|---|---|---|---|---|
| 1 | **S のバイナリに D 名義の UI・文言が出荷されている** | 高（主観70%） | `login-success-modal.tsx:39` の「動員ちゃれんじへようこそ！」が `clerk-root-provider.tsx` 経由でログイン後動線に載る。`encouragement-modal.tsx:35` も同文言。`constants/goal-types.ts`「動員」、`modules/event/core/status.ts`「双方から利用する」。却下文の "similar binary" に文字どおり当たる唯一の観測。他アプリの実行時文字列は Hermes バンドルでも残る | **直す** |
| 2 | **S の「集まり」＝ D の中核（参加表明＋都道府県＋X シェア）の簡略移植** | 高（60%） | `modules/event/api/participation.ts:4`「doin-challenge 参加表明の簡略版」、`app/(tabs)/events.tsx`、S のスクショ slot4 が「集まり」。コンセプト面で2本が重なる | **S から外して D へ一本化** |
| 3 | **スクショが「使用中の画面」でない・空・同じ額装** | 中〜高（60%） | D の `screenshot-plan.json` slot1 が `/lp`（マーケLP）。S は `authTabs:[]` で実データ無し。両方 `frame-appstore-screenshots.mjs` の同一デザイン。Apple 2.3.3「show the app in use」（2026-10-05 更新） | **直す** |
| 4 | **メタデータの「型」が同じ** | 中（40%） | リリースノート冒頭が両方「はじめまして。『君斗りんくの○○』の最初のリリースです」。`businessModel.summaryJa` が同構文 | **型を割る** |
| 5 | 同一 Team に未公開テンプレ製が続けて出た（S 9-23 却下→D 10-4 提出）＋公開済み双子（健康診断） | 推測（30%） | 却下文の寄与要因 "multiple similar apps using a repackaged app template" | 順序と双子で対処 |
| 6 | 共通基盤（Clerk+X・tRPC・UI部品・法務画面）＝ 到達コード一致 S 7.3%／D 4.5% | 低 | 楽天45本・LINE42本等が同一ID基盤で並ぶ実測。4.3(a) 公式文は「同一アプリの複数 Bundle ID」で共通基盤を挙げていない | **触らない** |
| 7 | キャラクター・アイコン様式 | 対象外（本人方針） | 大手も共通ブランド枠を許容 | **触らない** |

### A-2. 共通ID基盤は問題ではない — その線引き

- **根拠**: 大手実測で、同一アカウント・同一ID基盤でも機能が別物なら説明文 5-gram 重複の中央値は 0.003〜0.012 で並存している。4.3(a) の公式例は都市/チーム/大学ごとの「同一アプリ」分割で、共通ログイン・共通UI部品は「同一アプリ」の証拠にならない。
- **それでも危ない線**（3つが同時に成り立つと公式の例に近づく）: (1) 骨格が同型 (2) 外から見える区別軸が無い（対象者・題材・役割が説明文冒頭・スクショ・名称から読めない） (3) 片方に他方の名義・機能が物理的に混入。
- S×D は (1)(3) が成立し (2) が弱い。健康診断の双子は (1)(2) が成立し**公式の例に最も近い**。

---

## B. 判断（保留なし）

### B1. S（すれ違ひ通信）: 軽い形を採る

**決定**: 「投稿・写真・金銭なし。固定カテゴリで属性の合う人を見つけ、X へ送る」。本人が `surechigai-romi.link/docs/category-meetup-navi-MAP.md`・`-SPEC.md` で確定済みで、`modules/encounter/core/category.ts` に `CATEGORY_IDS` 8件（`yuzuriai`/`oshi_katsu`/`seichi`/`haishin`/`drive`/`camp`/`gourmet`/`onsen`）が**実装済み**。依頼文の「ジモティ的」は、`docs/user-needs-council-2026-09-08.md` の結論どおり**「ジモティの弱点（相手の人柄が分からない・連絡が絶たれる）を外から補う」**と読み、掲示板・譲渡・取引を持つ重い形は捨てる。

**重い形を捨てる理由**（CVR/LTV と 100年メンテフリーの両軸で負ける）:
- 1.2（UGC 安全装置）・古物営業法の個別判断・電気通信事業法（DM）・出会い系規制・特商法・4.3(b)（dating は飽和カテゴリ）が全部乗る。実ユーザー0（総8人・全員知人）でモデレーション運営を永久に抱えるのは 100年設計の逆。
- 4.3(a) 対策としての利得（別カテゴリになる）より、UGC の新規審査リスクが上回る（会議の批判役・法令調査の所見）。
- MAU 約1000万のジモティと同じ土俵に立つ見込みが無い。軽い形は既に設計・実装済みで、重い形は既存資産を捨てる。

**再提出 MVP（これ以上足さない）**
1. **D の痕跡を到達コードから除去**: `login-success-modal.tsx`（D 由来文言を S 固有に書き換える、または `clerk-root-provider.tsx` の `<LoginSuccessModalWrapper />` 呼び出しを外す）、`encouragement-modal.tsx:35`、`constants/goal-types.ts`・`constants/event-categories.ts`（「集まり」削除で不要）、`components/organisms/tutorial-overlay/previews.tsx` の `@deprecated レガシー doin-challenge 用` 4件。コメント中の言及は出荷されないが検査（C2-①）で warn 対象にして徐々に消す。
2. **「集まり」を S から外し D へ一本化**: `app/(tabs)/events.tsx` のルートとタブ登録（`app/(tabs)/_layout.tsx`）、`components/events/**`、`modules/event/**`、`lib/events/event-invite.ts`、`server/routers/index.ts` の event ルーター登録を到達不能にする。**DB テーブル（`eventParticipations` 等、実データ10件・直近2ヶ月0件）は消さない**（退会削除経路を壊さない）。スクショ slot4（集まり）は差し替え。SPEC の「カテゴリは集まりにも付ける」は「プロフィール＋足あとの2箇所」に縮む → SPEC を更新する。
3. **コンセプトを1文で言える形にする**（C1 の `distinction.oneLiner`）。例「同じ場所を通った人を、X の人柄つきで見つけるすれ違い記録アプリ」。説明文冒頭・スクショ slot1・リリースノート冒頭をこの1文で揃える。
4. **スクショ5枚を実データで撮り直す**: 本人アカウントの足あと175件・図鑑・すれ違い5件・カテゴリ「さがす」（`app/(tabs)/zukan.tsx`）。`authTabs` でログイン後画面を撮る（`capture-appstore-screenshots.mjs` は対応済み・fail-closed）。slot1 は使用中画面（LP 不可）。
5. **premium 残骸の整合**: `app/premium.tsx`・`api/revenuecat-webhook.ts`・`lib/navigation/app-routes.ts` の PREMIUM を到達不能にするか、`hasInAppPurchase` を実態に合わせる。**既定は到達不能化**（商品が無いなら課金 UI を出荷しない。3.1.1 の芽も消える）。U11 で最終決定。
6. **「会いに行く」（SPEC の B）は再提出に含めない**（位置情報の用途が変わり審査申告のやり直しになる。通ってから別版で）。

**規制・ガイドラインの当てはめ（軽い形で効くもの）**

| 論点 | 軽い形での判定 | 対処 |
|---|---|---|
| 1.2 UGC | 投稿機能は無いが `locations.note`（140字）と `users.hitokoto` は UGC。moderation 付き保存は実在 | 通報・ブロック・連絡先の3点を U4 で確認。無ければ**メモの他人表示を再提出では止める**（自分向けメモだけなら 1.2 対象外に近い）。既存ブロック（`listLivePresenceForViewer` の除外）は流用 |
| 4.8 | X ログインのみなら Sign in with Apple 相当が必須。2026-08 に 4.8 で実際に却下済み | U3 で確認。出ていなければ共有 Clerk で Apple を有効化（KB §4.8 戦略A）。`siwaEnabled`/`thirdPartyProvidersOnIos` を実態に合わせる（C2-⑦の対象） |
| 5.1.1(v) | 中核（チェックイン・軌跡・図鑑）は X 非依存 → SIWA で満たす。X トークンは Clerk がサーバー側に持つ（審査官解釈は未確認） | **S のサーバーがユーザーの X トークンで X API を呼ばない**ことを設計上の約束にする（`twitterUserCache` の `followersCount` 等を表示に使わない。表示は @handle・アバター・X プロフィールへのリンクのみ）。アカウント削除は実装済み（`modules/encounter/db/account-deletion.ts` ほか、`contact.dataDeletionUrl`） |
| 古物営業法 | 出品・入札・手数料なし → 対象外 | 「ゆずり合い」カテゴリは**属性ラベル**であり譲渡の掲示ではないと規約・説明文に明記 |
| 電気通信事業法 | アプリ内 DM なし（X へ委譲） | 現状維持 |
| 出会い系規制 | 交際募集カテゴリなし | 規約に「異性との出会い目的の利用禁止」を置く（U4） |
| X Developer Policy | スコア化・プロファイリング禁止 | SPEC の「交わりの数以上の相性スコアを作らない」を維持。X 由来情報は本人連携のハンドル・アバター・リンクだけ |
| 位置情報 | 他人に見せるのは市区町村／500m グリッド。座標配信を増やさない | 再提出では B を含めないので新規申告なし |

**既存レコードの扱い（新規は除外）**: Bundle ID `com.kimito.link.surechigai`・ASC `6796909175` をそのまま使う。Google Play は**公開済み**（`surechigai-romi.link/_docs/parity/FACTS-surechigai.md`、HTTP 200・対照404）なので、転換は**既存アプリの更新**として両ストアに出す。`app.config.json` の `playAppId:""` は誤記 → 直す。却下履歴は消さない・隠さない。

### B2. D（動員ちゃれんじ）: ブラッシュアップだけでは足りない。「イベント参加表明の唯一の持ち主」にする

- **一本化**: S から「集まり」を外す（B1-2）ことで、Team 内でイベント参加表明・都道府県マップ・X シェアは D だけになる。D 側の実装変更は不要。「別機能に見える」の実体はここで作る。
- D から S 名義を除去（U10 で走査。`screenshot-plan.json` の `_README` の出典言及は出荷されない）。
- **スクショ3枚を作り直す**: slot1 `/lp` を使用中画面へ。全国マップが西日本しか描画されない不具合は**製品バグとして先に直す**（撮り直しても壊れた地図が写る）。参加者0の空状態は撮らない。`framedCaptions` slot2 の `sub` の文字化け「仯首」を直す。
- **メタデータの型を割る**: `release-notes/CURRENT-ja.txt` 冒頭を S と違う構文に、説明文冒頭1文を `distinction.oneLiner`（例「推しのライブへの参加予定を、全国マップに集めて見える化する主催者とファンのための応援アプリ」）に。章立ても S と変える。
- **順序**: S の結果を見てから提出（B4）。D に `asc-review-poll.yml` は無いが、`push` トリガーは S と同じ構成で生きている。
- D のドメインロジック（チャレンジ・ランキング・実績・DM・チケット）はそのまま。「使いやすくする」改修は提出と切り離し、通った後に通常更新で出す。

### B3. 健康診断の双子: 両方残す。リバースハック版は「別アプリとして出せる形」に作り替えて出す（本人決定 2026-10-06）

> **本人の決定**: 当初案（RH 版を販売停止して君斗りんく版へ一本化）は採らない。「リバースハック版は出せる形にして出すのがいい」。以下がその設計。
> 販売停止案は**フォールバック**として残す（下の撤退条件を満たせなかったとき）。

- **なぜ「そのまま2本並べる」はだめか**: 現状は同一リポ・同一コード・同一説明構造で、公式の例（同一アプリの複数 Bundle ID）に最も近い。名称・ブランド色・相談先だけの違いでは区別軸にならない。無い区別軸を説明文に書くのは不実表示になるので、**実際に機能の中身を割る**。
- **区別軸（題材×対象者）**。既に実体のある違いに乗る（捏造しない）:
  - **リバースハック版**＝「**風評・評判**に困っている経営者・店舗向け」。カテゴリ BUSINESS（現行どおり）、相談導線は RH（`partner.reverse-re-birth-hack.com`）。結果画面の主役は検索評判（検索候補のネガ語・電話番号の風評検知など）。サイト安全は補助として後ろに置く。
  - **君斗りんく版**＝「**サイトの管理者・制作担当**向けの技術健診」。カテゴリ UTILITIES（現行どおり）。主役は SSL・DNS・メール設定・表示速度・セキュリティ・WordPress・SEO。評判は補助。
  - 共通部分（入力フォーム・診断エンジン・Clerk 認証・法務画面）は `distinction.sharedFoundation` に宣言する。
- **作り方**: 既に brand 切替の仕組みがある（`scripts/apply-app-brand.mjs`・`scripts/ci-resolve-brand.mjs`・`NEXT_PUBLIC_SITE_BRAND`・`app.config.reverse-hack.json`）。これを「見た目の色替え」から「**画面構成・結果の並び・タブ・文言・スクショ・説明文を brand ごとに別物にする**」ところまで広げる。具体は実装時に `src/` を読んで決める（設計では機能の細部を決めない＝過剰設計を避ける）。
- **出せる形の合格条件（機械判定）**: C1 の `distinction` を両 config に書き、C2 の検査が緑になること。
  - ③ `coreFeatures` の交わり: 診断エンジン共通分は `sharedFoundation` に出し、`coreFeatures`（その版が売りにする機能）は**交わり∅**。
  - ⑤ 説明文・リリースノートの 5-gram Jaccard <0.10（<0.03 が望ましい）、先頭文は完全一致しない。
  - ④ スクショは raw で姉妹と知覚ハッシュが近くない（結果画面の並びが別なので自然に離れる）。
  - 説明文冒頭1文＝`oneLiner` が各版の対象者を限定している（例 RH: 「検索での評判の悪化に悩む経営者・店舗向けに、会社名・店名の風評を約1分で診断」）。
- **撤退条件（フォールバック＝販売停止して一本化）**: 上の合格条件を満たす機能分割が小さな改修で作れない場合、または S/D の再提出後も 4.3(a) が続いて Team 全体が危険と判断された場合。販売停止は削除ではなく Remove from Sale。RH 向け workflow（6本）と `app.config.reverse-hack.json` を台帳として残す。
- **提出順序**: RH 版（と君斗りんく版の説明文調整）は**S・D の判定が出た後**。区別軸の宣言と検査が緑になるまで提出しない（今の同一状態のまま更新を出すと、Extended Review 中に類似の根拠を足すだけ）。公開済み・評価0・DL 実数未確認（U8）なので、作り替えた版は通常の更新（バージョンを上げる）として出す。
- **最悪ケース**: 分割しても Apple が同じアプリと見る可能性は残る（効果は推測）。その場合は撤退条件の販売停止へ。作り替えの工数は無駄になるが、`distinction` と検査の金型は他アプリに再利用できる。
- 君斗りんく版の Play「不完全な機能」否承認（9-08、`namespace≠applicationId`）は 4.3 と独立の製品バグ。U9 を確認し、未解決なら先に直す。

### B4. 提出順序・凍結の実務・返信の組み立て

**凍結（即日・提出より先）**
1. **自動提出の口を全部閉じる**。実測した口は次の4つ:
   - S・D の `ios-appstore-release.yml` `on.push.paths`（`app.config.json`/`package.json`/`release-notes/CURRENT-ja.txt`/`lib/auth/**`/`components/providers/**` 等）。
   - yukkuri の同ファイルは `src/**` でも起動（最も敏感）。web-health は `app.config.reverse-hack.json`・`store-assets/**` 等。
   - S の `asc-review-poll.yml` の自動 dispatch（`RETRY_ACTIONS`＝`rebuild-and-resubmit`/`retry-after-metadata-fix`/`retry-with-fresh-screenshots`）。4.3 原文は現行分類器で `UNKNOWN` なので今は再提出されないが、構造的に塞がれていない。
   - **即日の応急処置**: 各 `ios-appstore-release.yml` を `gh workflow disable`（または GitHub UI）で無効化してから、`push:` トリガーを外す PR を出す（★このファイル自身が `push.paths` に入っているので、**無効化してから**変更を push する）。
   - **恒久スイッチ（Fable 案の org 変数は不可＝§0 訂正1）→ 単一の凍結ファイル**: キットの公開リポ（`kimito-link/web-ios-android`、PUBLIC を確認済み）に `store-submission-freeze.json`（`{"frozen":true,"reason":"…","since":"…"}`）を置き、各リポの `checks` ジョブ先頭と `asc-review-poll.yml` の dispatch 直前で `curl -fsS --max-time 10 https://raw.githubusercontent.com/kimito-link/web-ios-android/main/store-submission-freeze.json` を取得する。`frozen:true` なら exit 1。**取得失敗も exit 1（fail-closed）**。`workflow_dispatch` の `override_freeze_reason` が非空のときだけ通す。金型（`templates/workflows/ios-appstore-release.yml`・`asc-review-poll.yml`）に入れて配る。スイッチは1つ・各リポに個別フラグを作らない。（raw の CDN キャッシュ数分の遅延は許容。）
2. **U2 を確認**: 却下後に走った run と ASC 上の S・D の `appStoreState`。WAITING_FOR_REVIEW 等が残っていれば ASC UI で手動キャンセルして意図しない再提出を止める。
3. 他アプリ（kimito.link 本体・Voice・yukkuri・malwarecheck・resend・健康診断）の新規提出は C1/C2 のゲートが配線されるまで凍結。

**提出順序**

| 順 | 何を | 条件 | 最悪ケースと分岐 |
|---|---|---|---|
| 0 | 凍結・yukkuri の申告矛盾（E）修正 | 即日 | — |
| 0.5 | （欠番。当初の RH 版販売停止は本人決定で撤回。フォールバックとして B3 に残す） | — | — |
| 1 | **S を再提出**（B1 MVP 全部）。Resolution Center に「変えた事実」を列挙して返信してから新ビルド | C2 の自己点検（他アプリ名義0件・スクショ実画面・説明文冒頭一致・残骸0）が緑 | 再び 4.3(a) → **3回目を盲目で出さない**。Resolution Center で該当画面の指摘を求め、電話相談／予約相談（公式・Webex 30分）。appeal は「類似が無いのに却下された」と言える状態（S の清掃後）に限る。1提出1回、追加情報要求には先に答える。appeal 中は再提出しない（U5） |
| 2 | **D を再提出**（B2） | S の判定が出てから。S が通れば「同一 Team で別コンセプトとして承認済み」を reviewer notes に正直に書ける | D だけ落ちたら D 固有の問題（スクショ・地図バグ）として S と同じ分岐 |
| 2.5 | **健康診断2本（RH 版の作り替え版＋君斗りんく版の説明文調整）を更新として提出**（B3） | S・D の判定が出てから。`distinction` と C2 検査が緑 | 4.3 が続くなら撤退条件（販売停止）へ |
| 3 | 他アプリの凍結解除 | `distinction` 宣言と C2 ゲートが各リポで緑 | — |

**「正直に言える事実」の組み立て**（KB「実際に通った Resolution Center 返信文」A 原則＝短く・条文引用・事実のみ・政策を論じない、に従う）
- 書けるのは**実行済みの変更**だけ。順序は「直す→検査で緑→返信を書く→提出」。直す前に「直した」と書かない。
- 要素（S の例）: (1) 2本は同じ会社が同じ社内基盤（共通ログイン＝kimito.link アカウント、UI 部品）で作った**別目的のアプリ**であること（楽天ID等との比較は政策論になるので書かない）。(2) S に残っていた D 向けのログイン後モーダル文言と、D と重なるイベント参加表明機能を**削除した**こと。(3) スクショを使用中の実画面に差し替えたこと。(4) S の中核（位置の記録・軌跡・市区町村図鑑・時間差すれ違い・固定カテゴリで探して X へ送る）と D の中核（ライブ参加表明・都道府県マップ・応援ランキング）を各1文で対比。(5) 「他に類似と見られた要素があれば具体的に教えてほしい」。
- 書かないこと: 「テンプレではない」の断定（社内共通基盤は事実として存在する）、別会社・別事業者の装い、Bundle ID や名称を変えて再提出する予定、未実装の計画。
- 投稿は人手（API 未公開）。文面はリポに保存（S の `docs/appstore-reply-2026-08-05.md` 型）してから貼る。返信だけでは再審査は始まらない。

---

## C. 100年メンテナンスフリーの再発防止設計（金型としてキットから配る）

### C1. 「区別軸の宣言」— 採用（薄く）

大手実測の共通点（説明文冒頭に対象限定の1文・アプリ固有のキャプション）は「別アプリである」と外から読める最小の形で、宣言→一致検査は機械化できる客観事実に落ちる。**グリフ（アイコン中央の図）の検査は採らない**（アイコン様式は本人方針で論点外、画像の意味判定は機械化できない）。

**スキーマ**: 別ファイルではなく `app.config.json` に `distinction` を追加（単一真実源の原則）。`app.config.schema.json` は `additionalProperties:false` なのでスキーマへの追記が必須。U7 のとおり既存 config は未知キーを持つ疑いがあり、`distinction` 追加と同時に既存の未知キー（`shortDescription`・`iosPublished`・`lineUrl`・`lineId`・`faviconSource`・`wordmarkSource`・`xOAuthSharedApp`・`clerkProxyUrl`・`loginRequired`・`playVersionCode`・`android`・`_status` 等、実際の一覧は実装時に `verify-app-config-schema` で出して確定する）を**正式登録**し、検証ゲートが本当に緑になる状態を作る。

```jsonc
"distinction": {
  "oneLiner":     "同じ場所を通った人を、Xの人柄つきで見つける すれ違い記録アプリ", // 説明文の先頭1文と完全一致を要求
  "audience":     "移動の記録を残したい人／同じ場所に縁のある人を探したい人",
  "subject":      "場所・移動の記録",
  "coreFeatures": ["チェックイン・軌跡", "市区町村の図鑑", "時間差すれ違い", "固定カテゴリで探す→Xへ"], // 3〜6件。同一Team内で交わり禁止
  "notThisApp":   ["イベント参加表明（動員ちゃれんじの領分）", "DM", "投稿・写真", "金銭のやりとり"],
  "sharedFoundation": ["clerk+x-login(kimito-link)", "ui-kit", "trpc", "legal-screens"], // 意図的な共通部分の宣言（審査ノートの根拠にも使う）
  "sharedFoundationPaths": ["lib/auth/**", "components/providers/**", "components/ui/**", "components/legal/**"], // 重複率検査の除外
  "allowedSiblingMentions": []
}
```

- 必須化の段階: スキーマ上は optional → `lint-pre-submission.mjs` の新 CHECK で「`stores.ascAppId` が設定済み（＝App Store に出すアプリ）なのに `distinction` が無い」を **fail**。既存アプリを一斉に壊さず、提出時だけ fail-closed（検査できないときは通さない）になる。
- 一致検査（同リポ内・creds 不要・既存 lint に追加。既存は CHECK 23 まで → **24 から**）:
  - CHECK 24 `distinction-present`
  - CHECK 25 `distinction-matches-description`: `store-assets/appstore/description-*.txt` の先頭段落に `oneLiner` が完全一致で含まれる（説明文がリポに無いアプリは skip でなく fail）。`release-notes/CURRENT-ja.txt` の先頭文が `oneLiner` か `coreFeatures` の語を1つ以上含む。
  - CHECK 26 `distinction-matches-screenshots`: `store-assets/screenshot-plan.json` の `framedCaptions` 全体で `coreFeatures` の語が2件以上出現。`framedCaptions` のキー集合＝`publicPages[].slot` ∪ `authTabs[].slot`（D の配列バグ型を検出）。
- 交わり検査（Team 横断）は C2 の別スクリプト。

### C2. 提出前検査の項目・閾値・偽陽性対策・置き場所

**位置づけ**: 「Apple の判定の再現」ではなく「既知の寄与要因の自己点検」。閾値は社内実測（S/D の数字・大手中央値）から置いた初期値で、基本は**ラチェット**（増えたら赤・減らすのは自由）。終了コードは `templates/scripts/lib/instrument-core.mjs` の3値（0 合格／1 測れた上で赤／2 測れなかった。**2 は緑ではない**）。

**置き場所の原則**: 同リポだけで判定できるものは `lint-pre-submission.mjs`（各リポの `checks` ジョブで既に走る）。**姉妹リポが要るものは新設 `templates/scripts/verify-team-distinction.mjs`**（1リポの CI には姉妹が無いため）。キット側の `templates/workflows/scheduled-quality-check.yml` に週次で配線し、各提出前は手動実行を前提にする（実行の記録は `record-instrument-proof.mjs` の証明台帳に乗せる）。

| # | 検査 | 測り方 | 閾値（初期値） | 偽陽性対策 | fail-closed | 場所 |
|---|---|---|---|---|---|---|
| ① | 他アプリ名義の混入 | 到達コード（`app/ components/ lib/ modules/ hooks/ constants/`）の文字列リテラルに、同 Team 他アプリの `displayName`/`shortName`/`productionDomain`/`bundleId` が出る。名義の正本は ASC `GET /v1/apps` を `asc-list-team-apps.mjs`（新設）で `store-assets/team-apps.json` にキャッシュ。コメント除去は `check-tracked-imports.mjs` の `blankOutComments`（実在確認済み）を再利用 | 文字列リテラル中 **0件**。コメント中は warn | `distinction.allowedSiblingMentions` の名称は許可。`team-apps.json` が無ければ **2（測れない）で止める** | fail | lint CHECK 27 |
| ② | 到達コードの同一率 | **jscpd**（5.4.0・2026-09-30 更新）で2リポ横断 `--min-tokens 50 --reporters json`。既存 `templates/diagnostics/check-near-duplicates.mjs` は単一リポ内用なので流用せず KEEP_SEPARATE（`record-decision-receipt.mjs` で記録） | `app/`（画面）同士の重複 **0%**（現状バイト一致0）。それ以外はベースライン＋ラチェット（初期値 S 7.3%／D 4.5%、増えたら赤） | 生成物・`sharedFoundationPaths` を除外 | ラチェット赤＝fail | verify-team-distinction |
| ③ | 機能マニフェストの重なり | `distinction.coreFeatures` の pairwise 交わり。補助として `app/(tabs)/*.tsx` のファイル名集合一致率 | 交わり ∅。タブ名一致率 >50% は warn | 語の表記揺れは正規化（全角半角・空白） | fail | verify-team-distinction |
| ④ | スクショが実画面か | (a) `publicPages[].path` がマーケ系（`/lp`・`/landing`・`/about` 等）→ fail。(b) 撮影済み PNG の知覚ハッシュ（imghash 1.1.4 または blockhash 系。`sharp` は既存依存）で姉妹アプリとの Hamming 距離。(c) 空状態の疑い: `sharp().stats()` で支配色面積 | (b) 姉妹と距離 ≤ 8/64 → fail、同一アプリ内 ≤ 4/64 → warn。(c) 単色面積 >85% → warn | **額装前の raw（`ios-screenshots/`）で比較**（額装が距離を縮める）。(c) はダークテーマの誤検知があるので warn 止まり | (a)(b) fail、(c) warn | (a) lint CHECK 28／(b)(c) verify-team-distinction |
| ⑤ | メタデータの型の重なり | 説明文・リリースノート・`summaryJa` の 5-gram Jaccard（公開済みは iTunes Lookup API で本番文面も比較）。先頭文の完全一致 | 姉妹間 **>0.10 fail／>0.03 warn**（大手中央値 0.003〜0.012、S×D 実測最大 0.034） | 法務定型句（「アプリ内課金なし」等）は共通辞書で除外 | fail/warn | verify-team-distinction |
| ⑥ | 残骸設定 | Expo prebuild（`app.config.ts` あり／`expo` 依存）なのに `capacitor.config.json` が存在 | 存在＝fail | — | fail | lint CHECK 29。副作用: 現行 lint の `readCapacitorAppId()` と CHECK 2/9/18 は残骸の `server.url` を読んで無関係な判定を出しているので、残骸を消すとそれらは skip に変わる（正しい状態） |
| ⑦ | 公開状態と config の食い違い | `stores.playAppId` 空 ↔ `play.google.com/store/apps/details?id=<package>` が 200（対照404法）。`stores.iosPublished` ↔ iTunes Lookup。`hasInAppPurchase:false` ↔ 課金系依存・ファイルの存在。`auth.loginRequired:true` ↔ `summaryJa` の「登録なし」。`siwaEnabled:false` ↔ `thirdPartyProvidersOnIos` 非空（4.8） | いずれも不一致＝fail（`loginRequired`↔文言は語彙ヒューリスティックなので warn） | ネットワーク不可なら 2 | fail | lint CHECK 30（ネット要。`asc-readonly-checks.mjs` と同じ「creds/ネットが無ければ skip、あれば fail」の型） |

**分類器の拡張**（`templates/scripts/lib/asc-rejection-classify.mjs`）: `PATTERNS` の**先頭**に 4.3 用（`/4\.3|spam|similar binary|repackaged|template/i` → `manual-review-no-retry`）を追加（SCREENSHOT の `/misleading|inaccurate/` より先に評価されるように）。同様に 4.2 用。`asc-review-poll.yml` の `RETRY_ACTIONS` には絶対に入れない。理由: 4.3/4.2 の自動再提出は却下文の "repeatedly submit" そのもの。

### C3. 運営ルール

1. **新アプリ追加のゲート**: `setup-new-app.mjs` が `distinction` 無しでは `app.config.json` を受理しない。release workflow の `checks` で lint CHECK 24〜30 が走る（配線漏れは `check-gates-are-wired.mjs` で検出）。
2. **台帳の正本は ASC／公開 API**: `asc-list-team-apps.mjs`（新設）と iTunes Lookup・Play 公開 URL の実測を週次で取り、Team のアプリ台帳（bundleId・状態・最終提出・`distinction.oneLiner`）として出す。ローカル `app.config.json` の `playAppId`/`iosPublished` は台帳との食い違いを検査される側（⑦）。
3. **公開済みアプリの定期自己監査**: 週次で ⑤（本番説明文の 5-gram）と ③（宣言の交わり）を全 Team アプリ pairwise に回す。赤が出たら凍結ファイルを自動で `frozen:true` にする（解除は人間）。
4. **提出回数の規律**: 同一バージョンで却下→再提出は**1回まで自動化**（4.3/4.2 以外）。2回目の却下で人間接触（画面の具体的指摘を求める／電話／予約相談）を必須にし、3回目を出さない。機械化できる（`asc-review-check.mjs` が同一 `versionString` の REJECTED 回数を数えて `RETRY_ACTIONS` を無効化）。
5. **凍結スイッチは1つ**（B4 の `store-submission-freeze.json`）。

---

## D. 捨てた案と理由

| 案 | 捨てる理由 |
|---|---|
| 新規 Bundle ID／新規 ASC レコードで出し直す | 公式の寄与要因（複数の類似アプリ）を増やす行為。通った1次事例無し。本人方針で除外 |
| 別開発者アカウントに分割 | リンクされた2アカウントで本体まで終了予告の事例。DPLA 上の不実表示リスク。KB §4.3 の「クライアント別開発者アカウント」助言は撤回（F） |
| 見た目（キャラ・アイコン・配色）だけ変える | 公開事例で未解決のまま繰り返したパターン。本人も論点外と明言 |
| S と D を1アプリに統合し IAP/設定で出し分け | 2本は別コンセプト（場所の記録 vs イベント動員）で 4.3(a) の例（同一アプリの地域版）に当たらない。Play は S が公開済み・D 未公開でパッケージ名も別。既存レビュー・評価が混ざる。利得が無い |
| 機能フラグでビルド時に機能セットを切り替える | 骨格が同じなら見た目に出ない（会議の批判役の指摘どおり）。共有モジュールが両方に焼かれる原因を温存する |
| ジモティ型の重い形（掲示板・譲渡・取引） | B1。1.2/古物/電通法/出会い系/特商法を実ユーザー0で背負う |
| X 投稿の分析で「人柄スコア」 | X Developer Policy の禁止用途（プロファイリング・スコア化）に近い。SPEC も「相性スコアを作らない」で確定済み |
| 健康診断を統合して IAP で出し分け | 売るものが無いのに IAP 設計を抱える過剰設計。4.2.6 回避の主張は根拠なし |
| 健康診断の RH 版を即販売停止（Fable 当初案） | 本人決定で撤回（出せる形に作り替えて出す）。販売停止は撤退条件のフォールバックとして B3 に残す |
| 「Apple の判定を再現する」類似度モデル | 公式記述が無く検証不能。検査は自己点検と位置づける（C2） |
| appeal を最初に出す | S にはこちらに直すべき事実（混入・スクショ）がある。事実が無い状態の appeal は「追加情報要求に先に答える」（公式）に反する |
| GitHub Organization 変数を凍結スイッチにする | `kimito-link` は User アカウントで Organization 変数が無い（§0 訂正1） |
| 会議の「最後は新規バンドルIDで appeal」案 | 審査回避。除外済み |

## E. 地雷と回避策

| 地雷 | 事実 | 回避 |
|---|---|---|
| **凍結中の自動提出** | S・D の `on.push.paths` に `components/providers/**`・`lib/auth/**`・`package.json`・`app.config.json`・`release-notes/CURRENT-ja.txt`。10-05 にちらつき修正 PR（S #73、D #77/#78）が main に入っている | U2 を最初に確認。workflow を無効化してから paths を触る（paths に自分自身が入っている） |
| yukkuri の `src/**` トリガー | Web を直すだけで iOS 提出が走る | 凍結対象に含める。解除時は paths を S/D 型に狭める |
| web-health の `app.config.reverse-hack.json` | push.paths に入っており、編集が提出を起動し得る | T0（workflow 無効化・**実施済み**）の後に編集（§0 訂正4）。作り替え版の提出は workflow を再有効化する時（T1） |
| yukkuri の申告矛盾 | `auth.loginRequired:true`（2026-09-09 変更）なのに `businessModel.summaryJa` が「アカウント登録・課金・第三者コンテンツ一切なし」 | 次の提出前に summaryJa/説明文を実態へ。C2-⑦ の恒久検査対象 |
| S の課金コード矛盾 | `app/premium.tsx`・`api/revenuecat-webhook.ts`・`drizzle/schema/premium.ts`・`lib/navigation/app-routes.ts` が実在、`hasInAppPurchase:false` | U11 を見て、商品が無ければ到達不能化。あれば config を true にして ASC の IAP 審査を同時に受ける |
| WebView 殻の 4.2 | `kimitolink-linktree/capacitor.config.ts` と `kimito-Link-Voice/capacitor.config.ts` が `server.url` で自社サイトを指す。KB §4.2 の「ハイブリッド最大の脅威」 | 凍結中は触らない。解除後の更新時に `distinction` 宣言＋ネイティブ専用機能2つ以上（KB §4.2 レシピ）を満たしてから |
| 残骸 `capacitor.config.json` が lint を誤らせる | S・D 両方に存在し `server.url` を持つ。CHECK 2/9/18 がそれを読む | C2-⑥。削除後に CHECK 群が skip になるのは正常 |
| スキーマ検証の未知キー | U7。`distinction` 追加で初めて `verify-app-config-schema.mjs` を本気で走らせると既存 config が赤になる | 既存キーをスキーマへ正式登録してから `distinction` を入れる（1つの PR） |
| D の地図描画バグ | 全国マップが西日本のみ・ラベル欠け | スクショ前に製品バグとして修正。壊れた画面を撮り直しても 2.3.3 を満たさない |
| 「集まり」除去と実データ | S の events 10件・参加表明テーブルは本人の実データ | UI とルーターだけ外す。テーブルは残す |
| SPEC との整合 | `category-meetup-navi-SPEC.md` は集まりにもカテゴリを付ける前提 | SPEC に「集まりは D へ一本化（2026-10-06 判断）」を追記。MAP（事実記録）は触らない |
| Play 側の連動 | S は Play 公開済み。転換版は Play にも同一パッケージで更新として出る。場所メモの他人表示を続けるなら Play の UGC 要件（規約同意・通報・ブロック）も対象 | B1 の 1.2 対処を Play にも適用。Data Safety は位置の用途が変わらない限り更新不要 |
| Resolution Center 投稿は手作業 | API 無し | 文面はリポに保存してから貼る。送信前チェックリスト（新ビルド・スクショ差し替え・notes 更新・再提出ボタン）を踏む |
| 君斗りんく版の Play 否承認 | 9-08「不完全な機能」、原因は `namespace≠applicationId` | U9。4.3 とは独立。未解決なら RH 版停止と同時に直す |
| 並列セッション | S・D の `.agent/coord.md` は 10-05 時点 FREE、open PR（S #72、D #71/#72） | ハンドオフの coord 手順 |
| ★共有ファイルの審査用パスフレーズ | `resend.kimito-link.com-/HANDOFF-appstore-51-and-21.md` に審査用パスフレーズらしき値（棚卸しエージェント報告。本文に再掲しない） | 公開リポなら要確認（未確認） |

## F. 正本KB（`_docs/apple-reject-knowledge-base.md`）への書き戻し案

対象箇所は実在確認済み（§4.3 = 514-520 行、早見表 = 65-79 行付近、審査前チェックリスト「メタデータ」= 824 行、返信原則 A = 620 行）。書き方は `_docs/KNOWLEDGE-CARRYOVER-RULES.md` に従う（症状の文言を要約しない・原因・直し方・実戦の出典1行）。

1. **§4.3 の前提を訂正**（現行: 「WebView wrapper の "1コードベースで brand-B の URL を指すだけ" が標的。Apple は asset hash / framework signature / Info.plist 形状で clustering する。対処: マルチテナント化 / クライアント別開発者アカウント / 機能セットを本当に差別化」）
   - 追記: **Expo prebuild のネイティブアプリでも食らう**（S 2026-09-23・D 2026-10-04）。Apple の文言を原文のまま: "shares a similar binary, metadata, and/or concept as apps submitted to the App Store by you or other developers, with only minor differences" ／寄与要因 "Creating and submitting multiple similar apps using a repackaged app template" ／ Extended Review・"face removal from the Apple Developer Program"。
   - 「asset hash / framework signature / Info.plist 形状で clustering」は**根拠が無いので「推測」と明記するか削る**。
   - **「クライアント別開発者アカウント」助言を撤回**。理由: 公式寄与要因に「複数アカウントにまたがる類似アプリ」があり、リンクされた2アカウントで本体まで終了予告となった公開事例がある。代替: 「同一 Team で区別軸を宣言し、他アプリ名義の混入0・スクショ実画面・説明文の型を割る（C1/C2）」。
   - 事実として分かったこと（断定できる範囲のみ）: 到達コード一致率 7.3%/4.5% という低さでも却下される／他アプリの文言がログイン後動線に出荷されていた／提出スクショにマーケLP・空状態・描画崩れがあった／同一 Team に説明文構造が同一の公開済み双子がある。**どれが決め手かは Apple 未回答（U1）**。
2. **却下パターン早見表に2行追加**: S 1.0.0／D 1.0.0 とも 4.3(a)。原因は推測順位付き。**再提出結果は未検証**（空欄のまま、通ったら埋める）。
3. **審査前チェックリスト「メタデータ」に追加**: 説明文の先頭1文＝`distinction.oneLiner`／他アプリ名義の文字列0件（CHECK 27）／スクショは raw の知覚ハッシュで姉妹アプリと一致しない／リリースノート冒頭文が姉妹アプリと同一でない／`capacitor.config.json` 残骸なし（Expo）／公開状態と `stores.*` の一致。
4. **返信原則 A に1項追加**: 4.3(a)/4.2 は**自動再提出しない**。2回目の却下で人間接触（画面の具体的指摘を求める・電話・予約相談）。appeal は1提出1回、追加情報要求には先に答える（公式）。
5. **ai-hub への収穫**: `hub.mjs find --tag spam` / `--sig "4.3"` は設計時点で該当なし。`ai-hub/index.json` に triggers＝上記 Apple 原文の2フレーズを持つエントリを追加し `hub.mjs doctor` で検証（harvester エージェントの掟）。

## G. 実装の分割

実行手順・完了判定・ブランチ方針は [`IMPLEMENTATION-HANDOFF-apple-4-3a-spam-response-2026-10-06.md`](IMPLEMENTATION-HANDOFF-apple-4-3a-spam-response-2026-10-06.md) に書いた。タスク一覧（T0〜T12）と依存・優先度はそちらが正本。

---

*設計=Fable 5.1（2026-10-06・コード/ファイル変更なし）。司令塔が実ファイルで確認し、§0 の5点を訂正した。会議（無料クラウド5体）は素材として使い、結論はFableの設計＋実測に依る。*

# AIへの指示書（このテンプレの使い方）

> 👤 人間が最初に読むのは [`START-HERE.md`](START-HERE.md)（小学生〜90歳でもわかる超やさしい版）。
> 🤖 AI（あなた）はこの CLAUDE.md を読んでから作業する。

## このキットは何か（一言定義）

**AI開発の総合ルール（正本）と、ストア申請自動化のひな型を束ねた「横断開発基盤」。**
①アプリ提出自動化キット（本項以下、このファイルの主題）と、
②kimito-skill.linkの玄関＝`../ai-hub`横断知見ダッシュボードへの窓口、の2役を持つ。
**①だけを見て「ストア申請ツール」と思わないこと**（2026-09-01: 実際にAIが繰り返しai-hubを
見落とし、既存の共通実装を重複実装した事故を受けて、この節を最上部に移動した）。

## セッション開始時の必須アクション（この順で・作業に入る前に）

1. `Read ../CLAUDE.md`（横断の入口。正本1つ・コピー散らさないの原則を再確認）
2. `Read ../ai-hub/CLAUDE.md`（正本ポインタの所在。find/doctor/harvestコマンドを確認）
3. 何かを新規実装する前は必ず
   `node ../ai-hub/bin/hub.mjs find --tag <関連タグ>` または `--sig "<関連キーワード>"`
   を実行し、**同じものが既に他プロジェクトに無いか確認する**（`docs/ai-rules/01_CORE_RULES.md`
   「同機能の重複実装をしない」の実行手段はこれ）。ヒット0は正常（fail-closedでexit 1が返るだけ）。
4. 非自明な地雷を踏んで解決したら、終わる前に`ai-hub`のharvestの掟に従って書き戻す
   （`ai-hub/CLAUDE.md`「harvestの掟」節）。**「良い場所に書いてある」だけでは次のAIは読みに来ない**。
   書き戻すところまでが作業の完了。

## 実装着手前の非交渉ルール（NON-NEGOTIABLE、2026-09-02追記）

Deep Research（大企業向けマイクロサービス基盤の調査）を検討した際、Backstage・Pact Broker・
OTel/SLO運用のような新しい基盤は**このキットの規模には過剰**と判断し不採用にした。だが1点だけ、
「AIが調べずに新しく作る→重複する→片方だけ直す→ドリフトする→別の場所が壊れる」という事故を
防ぐ**行動順序の明文化**は、新しい仕組みを増やさずに**既存の仕組みを正しい順番で使わせるだけ**
なので採用する。実装（コードを書く・ファイルを変更する）を始める前に、必ずこの順で確認する:

1. **既存実装を検索する** — `Grep`/`Glob`で対象領域の既存コードを探す
2. **`ai-hub`で共通部品を確認する** — `node ../ai-hub/bin/hub.mjs find --tag <関連タグ>` / `--sig "<キーワード>"`（「セッション開始時の必須アクション」3番目と同じコマンド。実装着手の直前にもう一度確認する）
2.5. **CANONICAL CHECKを通す** — 既存候補が見つかったら「それを信じてよいか」を判定する
   （同じ責務か・同じ意味か・置き場所は適切か・依存方向は逆転していないか）。判定結果は
   REUSE / ESTABLISH_REHOME / CONTRACT / SYNC / KEEP_SEPARATE / LOCAL の6種類のいずれかで、
   詳細な定義・判定基準は正本 [`_docs/DESIGN-canonical-boundary-rules.md`](_docs/DESIGN-canonical-boundary-rules.md)
   を参照する（本文をここへコピーしない）。新規source fileを含む変更は、判定結果を
   `record-decision-receipt.mjs` で記録すること（`templates/diagnostics/check-decision-receipt.mjs`
   が記録の有無を機械検査する）
3. **同等機能があれば新規実装しない** — 見つかったら再利用・薄い拡張に倒す。「速いから」で複製しない
4. **PAIRS / drift対象を確認する** — 正本とコピーの関係にあるファイルを変更するとき、
   [`_docs/instruments/check-drift.mjs`](_docs/instruments/check-drift.mjs) の `PAIRS` に登録済みか見る。
   未登録の新規コピーを作るなら、そこにも追記する
5. **変更による影響範囲を確認してから編集する** — 呼び出し元・配布先（`templates/`配下は複数プロジェクトへ配られる前提）を把握してから触る
6. **共通化すべきロジックをプロジェクト固有コードへコピーしない** — ただし**配布境界をまたぐ場合は例外**（`templates/scripts/`は配布先に存在しないファイルをimportできない。この場合は「意図的な複製」と明記し、`PAIRS`または同等のコメントで同期対象と分かるようにする。2026-09-02の証明3点台帳実装で実際に踏んだ判断）
7. **既存設計を回避するための一時的な近似実装を作らない** — 手を抜いた代替は基準④「最高品質」違反
8. **Gateを無効化・迂回して成功扱いにしない** — `--no-verify`等でチェックを飛ばさない
9. **変更後は対象Gateをすべて実行する** — 該当する `templates/scripts/run-instruments.mjs`（またはプロジェクト固有の検査群）を実行し、[`templates/diagnostics/check-gates-are-wired.mjs`](templates/diagnostics/check-gates-are-wired.mjs) で配線漏れも確認する
10. **Gate失敗時は対症療法ではなく根本原因を修正する** — 症状を消すのではなく、なぜ起きたかまで遡る（冒頭「設計方針」の「100年メンテナンスのいらない設計＝根本解決」そのもの）

迷ったら、**「新しく作る」より先に「既に存在しないか」を調査する**。

この10項目は新しい基盤ではなく、既にあるものを正しい順で使わせる入口にすぎない:
`ai-hub`＝既存資産カタログ／`PAIRS`＝同期契約／各`check-*.mjs`＝警察／`run-instruments.mjs`等のGate＝裁判所／
[証明3点台帳](_docs/instruments/README.md)（`instrument-proof.mjs`・2026-09-02実装）＝判決記録、という役割分担で読むと分かりやすい。

## AI特有の認知の癖と対処（2026-09-07追記）

上の10項目は「何を確認するか」の手順だが、こちらは「なぜAIがその手順を飛ばしがちか」という
一段深い話。人間ならまず犯さない失敗の型をディープリサーチで調査し、このキット自身の実損
（`site/learnings/`に記録済み）で裏取りして5類型に確定した。新しい基盤・新しいGateは増やさない
——上の10項目を実行するときに、自分がどの癖に該当しやすいかを自覚するための地図として使う。

1. **ゼロコスト・コピペ症候群**: 人間はタイピング量・将来の面倒さで無意識に統合したくなるが、
   AIは2箇所目を書く心理的抵抗がゼロ。基準⑤⑥⑦（共通化サイン）は主にこの癖への対処。
2. **既視感なきタスク遂行**: 各タスクを独立文脈として処理し、「前にも見た気がする」という
   直感が働かない。`templates/diagnostics/check-near-duplicates.mjs`はこの欠如を機械で補う道具。
3. **推論で検証を代替する**: 「コードを読んで筋が通る」で実行時の確認を省略する。基準③
   「完膚なきまでの裏取り」・[`_docs/runtime-truth-verification-knowledge-base.md`](_docs/runtime-truth-verification-knowledge-base.md)はこの癖への対処。
4. **性善説の登録簿依存**: 「文書に書いた」「登録した」を「機能している」と同一視する。
   証明3点台帳・各`check-*.mjs`が「確認した証拠」を機械検査するのはこの癖への対処。
5. **「似ている」の解像度が粗い**: 表層的な類似・非類似だけで即断し、設計意図まで遡らない。
   `check-shared-parts-used.mjs`（事実＝同名関数）と`check-near-duplicates.mjs`（推測＝似た塊）を
   意図的に分離しているのはこの癖への対処——解像度の粗い1つの検査に混ぜない。

対処の基本形はどの類型も同じ: **「たぶん大丈夫」を機械検査に置き換える**。文章のルールを
増やすだけでは効かない（実例は`site/learnings/`の「証拠が無ければ完了扱いにできない仕組みにした話」
「文章のルールを機械検証可能な台帳へ格上げした記録」参照）。

## このリポの2つの役割（2026-08-26追記）
①アプリ提出自動化キット（本項以下、このファイルの主題）②kimito-skill.linkの玄関——`site/hub/`が`../ai-hub/index.json`を読んで生成する横断知見ダッシュボード（`npm run hub:page`）。横断知見の正本は常に`../ai-hub`。このリポはai-hubを動かさず窓口を被せるだけ（設計: `_docs/DESIGN-ai-hub-consolidation-2026-08-26.md`）。

### ★別プロジェクトからこの心臓部（CLAUDE.md）に知見を書き戻すときの作法（2026-09-01追記）
このCLAUDE.mdは全プロジェクトが従う設計の心臓部。他リポで得た横断知見（例: あるアプリでIAPを実装して分かった型・地雷）を、次の人が調査し直さずに済むようここへ書き戻すのは正しい運用（「知見は書き戻す」の実践）。ただし越境時は次を守る:
- **このリポは別のClaudeセッションが管理していることがある。** 触る前に `ListAgents` で `web-ios-android-*` セッションの有無を確認する。居るなら **mainへ直接コミットしない**（そのセッションの未コミット作業と衝突する）。追記だけ残して `git add` はせず、`SendMessage` でそのセッションに「どこに何を追記したか・不要なら破棄可」を伝え、コミットとWeb反映は委ねる。
- **CLAUDE.mdはGitHubリポジトリ経由でWeb公開されている**（kimito-link/web-ios-androidはpublic）。`git push`した時点で誰でも閲覧できる状態になるので、秘密・未確定の内容は書かない。
  - ★`kimito-skill.link/hub/`（横断知見ダッシュボード）はCLAUDE.mdの中身ではなく `../ai-hub/index.json` から生成される別経路。CLAUDE.mdへの追記が自動でそちらに出るわけではない（連動していると誤解しないこと）。
- 書くのは**実在確認済みのパスだけ**（引き継ぎ文に存在しないパスを書くと次の人が詰まる）。

## このテンプレは何をするものか

**1つのテンプレで Chrome拡張・Web・iOS・Android の4つにアプリを自動展開する。**
ユーザーは [`app.config.json`](app.config.json) に「アプリの情報（＝〇〇）」を書くだけ。
あとは自動化（GitHub Actions / 各種CLI）が、ビルド〜ストア提出までやる。

各プラットフォームとも「**提出までを自動化、合否は審査側**」という同じ構図：
- **Web** = Vercel 自動デプロイ
- **iOS** = App Store 自動リリース（配信地域の設定だけ手動）
- **Android** = Google Play 自動リリース（審査送信が最後の手動）
- **Chrome** = Chromeウェブストア API で審査提出

---

## AIへの依頼の受け方

ユーザーが「このフォルダで 〇〇 というアプリを作って」と言ったら：

1. **まず [`app.config.json`](app.config.json) を一緒に埋める。**
   `<...>` のプレースホルダを、ユーザーに必要な情報を聞きながら埋める。
   わからない項目（ストアID等）は、まだ無ければ空のまま進めてよい。
2. **どのプラットフォームに出すか確認する。** 4つ全部か、一部か。
   - Chrome拡張を出さないなら `app.config.json` の `chrome.enabled` を false に。
3. **自動化スクリプト/CI/TWA は `templates/` に同梱済み。** そこからコピーして使う（後述）。
4. **品質ルールは「AI汎用ルール」に従う**（後述）。

---

## 自動化の実体はキット同梱（`templates/` から使う）

iOS/Android/Web/Chrome の自動化スクリプト・CI・TWA は **`templates/` に同梱済み**。
参照元プロジェクトへの手コピーは不要になった。新しいアプリを作るときは、`templates/` から
コピーして `app.config.json` の値に置換するだけ。詳しい手順とコピー先は
[`templates/README.md`](templates/README.md) を読む。

| 欲しい自動化 | キット内の場所 | 出典（金型の元） |
|---|---|---|
| **iOS/Android リリースCI** | `templates/workflows/`（ios/android release・poll・lint・cert-expiry。Android cert-expiryは2026-08-25新設でapple-cert-expiry.ymlの対） | `partnership_program_website` / `fujisan-clean`（Android cert-expiryはこのキット自身） |
| **iOS/Android リリーススクリプト** | `templates/scripts/*.mjs`（appstore-submit / play-publish / asc-* / lint-pre-submission / generate-store-assets 等）＋ `templates/scripts/lib/` | `partnership_program_website`（一部 `Exosome` と同一） |
| **Android TWA（mac 不要）** | `templates/android-twa/`（twa-manifest・署名注入・Windows用 ps1） | `Exosome` / `partnership_program_website` |
| **Capacitor 設定の金型** | `templates/capacitor/capacitor.config.template.ts` | `partnership` / 富士山 / `Exosome`（server.url 連動型） |
| **Web→アプリDL導線の金型** | `templates/web/`（公式バッジ取得・出し分け・Smart App Banner・CSS・iOS Universal Links金型=`apple-app-site-association.example`） | `Exosome`（実装・ブラウザ検証済み）／Universal Linksはこのキット自身（2026-08-25新設。Android版`assetlinks.json.example`の対） |
| **出荷事故ゲート** | `templates/scripts/verify-ios-splash-not-default.mjs`／`verify-android-splash-not-default.mjs`（Capacitorデフォルトスプラッシュ防止）／`verify-android-signing-config.mjs`（未署名AAB防止）／`verify-webdir-consistency.mjs`（capacitor.config.tsのwebDirとCI生成先の不一致防止＝原則8）／`verify-signing-material-path.mjs`（署名鍵の配置パス不一致防止＝原則9）／`check-tracked-imports.mjs`（**新規ファイルのadd忘れ検出**=git clone直後でもimportが全解決するかをgit ls-filesだけで検査）／`verify-app-config-schema.mjs`（**壊れたapp.config.jsonの素通り防止**=ajvでapp.config.schema.jsonと照合。2026-08-25新設）／`verify-assetlinks-published.mjs`（**assetlinks.json未配信・package_name不一致の検出**=本番URLへの実fetchで疎通確認。2026-08-25新設）／`verify-twa-signing-matches-assetlinks.mjs`（**TWAのアドレスバーが消えない事故の検出**=Play App Signing が再署名した【配布される】署名が assetlinks.json に載っているかを androidpublisher の generatedApks[].certificateSha256Hash で照合。★Google の Digital Asset Links API も keytool も bubblewrap も adb もこの不一致は検出できない。2026-09-05新設）。CI から呼ぶ | `Exosome`（CI で実証）／tracked-importsは `tsuioku-no-kirameki.com`（Vercel全デプロイ失敗の実事故から実装・実証）／webdir-consistencyとsigning-material-pathは`kimito resend`（2026-07-04実戦、`_docs/CAPACITOR-GOLDEN-RULES.md`原則8・9）／app-config-schemaはこのキット自身（2026-08-25の計器抜け漏れ調査で発見・実装） |
| **AI自己検証（計器）の思想** | [`docs/ai-rules/04_SELF_VERIFICATION.md`](docs/ai-rules/04_SELF_VERIFICATION.md) — 製品自身に計器（挙動の自己申告）を埋め込み、AIが人間の目視なしで検証ループを回す6パターン（fail-soft/provenance・メタ診断=診断計器自体の網羅性契約テスト、を2026-07-16追加）。**新しいアプリを作るとき設計段階で読む** | `tsuioku-no-kirameki.com`（診断817秒→5ms・遅延実測等で実証） |
| **計器の完全版（全文脈→検証→進化）** | [`_docs/instruments/CONTEXT-EVOLUTION.md`](_docs/instruments/CONTEXT-EVOLUTION.md) — 全追跡ファイル・Gitが表示する未追跡ファイル、Git全履歴、現在の変更、指示書、確定/却下/未確定の判断を出典つきで1枚化。`context-engine.mjs` と `run-instruments.mjs` をコードごと配布 | このキット自身（2026-08-24から自己利用） |
| **各プログラム本体の診断・進化進捗ページ** | [`_docs/instruments/SHINDAN-VERSION-PAGE.md`](_docs/instruments/SHINDAN-VERSION-PAGE.md) — 新規アプリごとに本体URLの `/check-shindan-version/` を作り、導入・実測・履歴・公開の進捗と4状態、根拠、次の一手を表示。`setup-new-app` と Next.js `prebuild` から自動更新 | このキット自身（同じページを生成して自己利用） |
| **プライバシーページ生成** | `templates/scripts/generate-privacy-page.mjs`（健康/Play 必須の公開URL・API非依存） | `Exosome` |
| **設定の単一真実源** | `app.config.schema.json`（identity/stores/brand/contact/auth/businessModel/ownership の JSON Schema） | `Exosome` |
| **却下対応KB（Fable学習素材）** | `_docs/apple-reject-knowledge-base.md` | `partnership_program_website/_docs/` |
| **初回提出ブロッカー全リスト** | `_docs/FIRST-SUBMISSION-blockers.md`（新アプリの「最初の1回」だけ順番に踏むiOS/Android詰まり8個＋ASC UI手動項目。症状=CIログ文言・原因・直し方） | `malwarecheck.site`（iOS初回提出 2026-07 実戦） |
| **Web→アプリDL導線 知見KB** | `_docs/web-to-app-install-best-practices.md` | `Exosome`（ディープリサーチ確証分） |
| **Clerk X OAuth ログイン無人E2E検証 KB** | `_docs/clerk-x-oauth-e2e-verification-playbook.md`（ログイン判定偽陽性・1タップ導線URL食い違い・タイムアウト時証跡収集・Windows spawn罠・Xレート制限、の5事故と直し方） | `surechigai-romi-link` 2026-07-04実戦 |
| **Chrome 申請自動化（★審査送信まで全自動）** | （このフォルダ内）`scripts/chrome/`（`build-zip.ps1` / `publish-cws.ps1` / Node版 `*-node.mjs`）。**正本KB = [`_docs/chrome-web-store-submission-playbook.md`](_docs/chrome-web-store-submission-playbook.md)**。★**CWSの提出は「人間がダッシュボードで押すしかない」は誤り**＝管理画面はブラウザ自動操作が全面ブロックされるが、公式 Publish API があるので `--publish` で審査送信まで自動。**Playとは境界が逆**（Playは掲載情報まで自動だが審査送信だけUI必須／CWSは審査送信が自動で掲載文だけ手動）。2026-08-03にAIがこれを誤解しuserに3回「できません」と言った事故あり | `dns-osint-pro`（ps1実運用）／`tsuioku-no-kirameki.com`（Node版 `scripts/cws-publish.mjs`・v0.1.1244 提出実証） |
| **LINE公式アカウントAI社員bot** | `templates/line-bot/`（Cloudflare Workers + D1、GROQ AI応答。fail-closed設計・詳細は同梱README）。移植判断は [`_docs/LINE-BOT-EXTRACTION-NOTES.md`](_docs/LINE-BOT-EXTRACTION-NOTES.md) | `line-harness-oss`（ai-shain.link実運用分。CRM機能を除去し単一アプリ用に最小化） |
| **知見の書き戻しルール** | [`_docs/KNOWLEDGE-CARRYOVER-RULES.md`](_docs/KNOWLEDGE-CARRYOVER-RULES.md) — 却下対応・初見エラーの解決を、次のアプリのAIが読み返せる形でKBに追記する手順 | — |
| **「直したのに変わらない」調査KB** | [`_docs/runtime-truth-verification-knowledge-base.md`](_docs/runtime-truth-verification-knowledge-base.md) — コードを読んだ推論で原因を3回誤特定し、`fetch`ラップの実測1回で解決した実戦。①送信中身を丸ごと捕獲②入力と出力を並べて後処理の書き換えを見る③定数の重複定義を疑う。「上位モデルに変える」「読み込みを丁寧にする」が効かなかった記録も含む | `reply-copilot-openrouter-v2` 2026-07-30実戦 |
| **共有部品が「あるのに使われない」KB** | [`_docs/shared-parts-duplication-knowledge-base.md`](_docs/shared-parts-duplication-knowledge-base.md) — 同じ画面部品が3実装に割れ、**一度直したバグが別画面では直っていなかった**実戦。★重複禁止のルールは既に3箇所にあり、それでも守られなかった＝文章を足しても解決しない（検査していない規範は守られない）。★「重複を直す話」と「症状を直す話」は別物（司令塔が実際に誤診した記録つき）。統合すべきでない違い（Ctrl+F/HTML保存/印刷のため全件描画する等）の見分け方も収録 | `reply-copilot-openrouter-v2` 2026-09-01実戦 |
| **ネイティブ(Expo prebuild)版** | [`templates/expo-native/`](templates/expo-native/README.md) — WebView に頼らずネイティブとして両ストアに出す金型。**選ぶ理由の第一は「軽さ」**（WebView は JS を実行時パースするので Capacitor↔ネイティブの差は秒の世界。Hermes の事前コンパイルで構造的に消える）。副次的に OAuth の制約（Google の WebView 拒否・Apple の iOS17 封鎖）も解ける。**TWA / Capacitor / Expo の選び分け**と踏んだ地雷4件（versionCode 固定・署名判定の正規表現誤検知・拡張子違いの同名画像・Play のストア言語）を README に集約 | `surechigai-romi-link` iOS 2026-08-07 移行 / Android 2026-08-11 内部テスト配信 |

> ※ 「出典」は金型の元になった実プロジェクト（読み取り専用・触らない）。
> キットを使うときは出典を見に行く必要はない。`templates/` のファイルをコピーして使う。
> ※ コピーするときは、アプリ固有の値（displayName / bundleId / ascAppId / ドメイン /
> playPackageName / Team ID 等）を必ず `app.config.json` の値に置き換える。ハードコードしない。
> 多くのスクリプトは `app.config.json` を SSOT として自動で読むので、CI の `<...>` を埋めれば足りる。

---

## AIへのお願い（守ること）

- **設計方針（2026-09-01 確立）: CVR/LTV最大化 × 100年メンテナンスのいらない設計（＝根本解決）。**
  何を作る・直すときも、最後にこの2つに照らして判断する。**判断が割れたときはこの2つを優先し、
  ユーザーに選択肢を出して止まらない**（このリポの担当AIとしての既定の振る舞い）:
  - **CVR/LTV最大化**: ユーザーが目的（アプリ公開・情報を得る・迷いなく次の一手が分かる）に
    到達する率と、使い続ける理由を最大化する。内部の都合（実装のしやすさ）を優先して、
    ユーザーが見る画面・触る導線・理解のしやすさを犠牲にしない。
    - ★**「商品の品質」より「売り方（伝わり方）の品質」がCVRを決める**（2026-09-01追記）。
      中身が優れていても、それが伝わる形になっていなければ選ばれない。逆に、
      伝わり方が優れていれば、中身の差は埋まる。実装・機能の良し悪しだけで
      満足せず、**それが実際にユーザーへ届く形（言葉・見た目・導線）になっているか**
      まで自分の責任範囲として見る。このキット自身がこの原則の実例そのもの
      （実装はあるが伝わっていなかった一連の事故と修正は [`learnings/`](site/learnings/index.html) 参照）。
      - **出典**: 「プロの凄腕マーケター、キリタのラジオ」（ひっとこクソ太郎氏）。
        ★冒頭の自己紹介そのものが **「商品の品質より売り方の品質をチェックする男」**。
        番組の問題提起（要旨）:
        > 明らかに「そんな商品・サービスやばいだろ」というものが売れている。
        > 自分たちの方が明らかにいいものを作っているはずなのに、
        > なぜあちらのやばい商品がめちゃくちゃ売れているのか。
        ★**誤読しないこと**: これは「中身は手を抜いていい」という話ではない。**逆**。
        いいものを作ったなら、**伝わる形にするところまでやらないと、存在しないのと同じ**。
        中身で勝っているときほど、この差で負けるのが一番もったいない。
  - **100年メンテナンスのいらない設計＝根本解決**: 症状を一時的に消す近道
    （対症療法・自前の脆い判定ロジック・ハードコードした一覧・抜け漏れのあるチェック）を
    選ばない。**なぜ起きたかの根本原因まで遡って直す**。後から見た人・未来の自分・
    別のAIが同じ調査・同じ手間を繰り返さずに済む形にする。
  この2つを実現するための具体的な手段が、次の4つの基準。
- **新しい機能・検査を作るときの4つの基準（2026-08-25 確立）。**
  何かを新しく実装するとき、この4つを満たしてから「できました」と報告する:
  1. **抜け漏れなく完璧に**: 対象の全項目を洗い出してから作る。「主要なものだけ」で
     止めない。移植元・仕様書・公式基準がある場合はその**全項目リスト**と実装を突き合わせ、
     足りない項目は「未実装」と明記する（暗黙に省略しない）。
  2. **車輪の再発明をしない**: 既に業界標準・公式ツール・公式APIがある領域は、
     自前でロジックを再実装せず、可能な限りそちらに乗る（例: セキュリティヘッダー診断なら
     Mozilla Observatory / OWASP Secure Headers Project、依存脆弱性なら `npm audit` 等）。
     自前実装は「標準ツールが無い／使えない領域を埋める先取りチェック」に限定し、
     その旨をコメントに明記する。
  3. **完膚なきまでの裏取り**: 実装した検査・機能は、実際に動かして結果を確認してから
     完了と報告する。「動くはず」で終わらせない。可能なら実サイト・実データに対して
     実行し、想定通りの判定になることを確認する（[reality-checker](../CLAUDE.md) エージェントに
     委任してもよい）。
     ★**「編集した」「コミットした」は「反映された」ではない**（2026-09-01 実損）。
     `site/`を編集してコミットまで済ませ「反映しました」と報告したが、**pushしておらず
     本番(kimito-skill.link)は無変更のまま**だった。ユーザーが実際に本番を開いて
     初めて発覚。ローカルファイルの編集・ローカルプレビューでの確認・コミットは、
     どれも「本番に出ている」ことの証拠にならない。site/配下やLP、公開ドキュメント等
     **人が実際に見るものを変更したときは、`git push`まで完了し、可能なら本番URLを
     開いて（`WebFetch`や`navigate`で）変更が実際に見えることまで確認してから完了と
     報告する**。「コミットした」で止めるのは「テストが緑」で止めて実機を見ないのと同じ
     手抜きである。
     ★★**さらに、`git push`だけでも本番に反映されるとは限らない**（同日、上記の直後に発覚した
     第2の実損）。`site/`はGit連携の自動デプロイではなく、`npm run deploy:site`
     （`hub:page`→`shindan:update`→Cloudflare Pagesへのdeployを順に実行するスクリプト、
     `package.json`参照）を**手動実行して初めてkimito-skill.linkに反映される**。push後は
     必ずこのコマンドを実行し、本番URLをブラウザで開いて確認する。認証は事前にWranglerの
     ログインセッションが必要（`templates/scripts/deploy-cloudflare-pages.mjs`は認証を
     行わない設計）。
     ★**数値・実績を書くときは、必ず出典（KB・git履歴・実測コマンドの出力）に紐付ける**
     （2026-08-25 確立）。「実際に9つのアプリへ当てたところ無傷は1つだけ」のような
     具体的な実績主張を、実測ログもKBの記録も無いまま書いてLPに載せてしまった事故が
     実際にあった（ユーザー指摘で発覚・削除）。「〜という実績があります」「実例：〜」
     と書く前に、その数字を出したコマンド・ファイル・日付を1つでも挙げられるか自問する。
     挙げられない具体的な数字は、断定せず一般的な説明に言い換える（「よくあるのは〜」
     「〜することがあります」等）か、実際にコマンドを実行してその場で数字を作る。
     `npm run claims:provenance` で `site/**/*.html` 全体を対象に、出典コメント
     （`<!-- 出典: ... -->`）の無い数値主張を機械的にスクリーニングできる
     （`verify-claims-coverage.mjs` はLPの`data-claim`9件専用の別物）。
     数値・実績を書いたら実行し、出典コメントを添えてから完了と報告する。
  4. **最高品質**: 手を抜いた近似実装で済ませず、既存の計器規約
     （[`_docs/instruments/HANDOFF-new-app.md`](_docs/instruments/HANDOFF-new-app.md) の3値exit・
     selftest・fail-closed）に沿った、他のアプリにも配布できる水準で作る。
  5. **共有部品は「このプロジェクトだけ」で閉じない（2026-09-01確立）**: ヘッダー・フッター・
     人物表示（アイコン・ID・名前）・診断計器・レビュー体制など、**複数プロジェクトで
     繰り返し必要になる部品**を新規実装するときは、まず`templates/`配下（このキット）と
     `ai-hub/bin/hub.mjs find --tag <topic>`（横断知見の正本）を見て、既に金型・実装が
     無いか確認する。無ければその場限りで終わらせず、**`templates/`へ一般化して格上げする**
     （キット固有の値を設定として外出しし、他プロジェクトが再利用できる形にする）。
     ★実損（2026-09-01）: web-ios-androidキット自身の`site/`には共通ヘッダー・フッターの
     実装（`site/scripts/site-chrome.js`）が既にあったが、`templates/`へ格上げされていな
     かったため、別プロジェクト（line-bot/apps/lp配下の複数LP）が新規サイトを作る際に
     再利用できず、ページごとにヘッダー・フッターを個別実装する事故が実際に起きた。
     `kimito-skill.link`（このキット）は個々のプロジェクトの1つではなく、**全プロジェクトが
     従う設計の心臓部**であるべき場所。ここに実装がある＝全プロジェクトから使える、では
     ない。`templates/`に格上げして初めて他プロジェクトから見える。
     （実装: [`templates/web/site-chrome/`](templates/web/site-chrome/README.md)）
  6. **同一プロジェクト内でも、2箇所目を書く前に立ち止まる（2026-09-02確立）**: 基準⑤は
     「複数プロジェクトをまたぐ再利用」の話だが、**同じリポジトリ内の複数ファイルにまたがる
     部品**でも同じ判断が要る。UIコンポーネント・CSS・共通ロジックを2つ目の場所へ書こうと
     したら、その前に「1つ目の実装を呼び出せないか」を必ず検討する。呼び出せるなら
     `scripts/lib/`（Node生成スクリプトが共有するコンポーネント）や
     `site/assets/css/common.css`（静的HTMLページ群が共有するスタイル）のような、
     **役割ごとに決まった共有置き場**へ切り出してから両方から使う。「後で共通化すればいい」
     と先送りしない（今回は同じ会話内で2箇所目を書いた直後に指摘され、事後修正になった）。
     ★実損（2026-09-02）: Architecture Map（`generate-architecture-map.mjs`）にフォルダ
     ツリー表示のCSS（`.tree`/`.chip`、接続線・事実推測チップの描画）を実装した直後、
     同じ日の同じ会話の中で`/hub/`ダッシュボード（`generate-hub-dashboard.mjs`）にも
     同じ視覚表現が必要になり、**共通化を検討せずCSSをもう一度手で書いた**。結果、
     `.repo`ラッパーの有無・`white-space:nowrap`の有無等で2箇所が微妙にズレた。
     指摘を受けて`scripts/lib/tree-view-component.mjs`（`TREE_VIEW_CSS`）へ切り出し、
     両方の生成スクリプトからimportする形に修正した。★このキット自身が1日かけて
     「実装着手前に既存資産を検索する」ルールをCLAUDE.mdへ積み上げていた、まさにその日に
     同じキットの実装作業で違反した。ルールを書くことと実行中に自分の書いたルールを
     思い出すことは別問題であり、**「これは前にも書いた気がする」と一瞬でも思ったら、
     grepしてから2箇所目を書く**。
  7. **「同じ画面が複数箇所に増える」のは、たいてい共通化のサイン（2026-09-05確立）**:
     基準⑤⑥は「気づいたら共通化する」話だが、**気づく前段階として、次のような状態が
     見えたら共通化を疑う**、という具体的な見分け方を明文化する。
     - 同じ種類のデータ取り込み元・連携先（例: Chatwork・ココナラ・ランサーズ・ChatGPT・X等）が
       増えるたびに、似た形の画面・カード・集計ロジックを毎回新しく書いている
     - 1つのプロジェクトの中で、同じ役割のUIパーツ（カード・ボタン・ダイアログ等）が
       ファイルごとに少しずつ違う実装で何度も出てくる
     - 「これ、前にも同じような画面を作った気がする」という感覚が、実装中に一瞬でもよぎる
     ★見分けたら取る行動は基準⑤⑥と同じ（`templates/`や`scripts/lib/`等、役割ごとに決まった
     共有置き場へ切り出してから両方・全部から呼ぶ）。★この節が付け足すのは「見分け方」だけで、
     「どう直すか」は増やさない——直し方を複数用意すると、どちらで直すか毎回また悩む種になる。
     ★実例（2026-09-04、`kimitolink-linktree`のX投稿から確認・裏取り済み）: 複数の外部
     プラットフォーム（Chatwork・ココナラ・ランサーズ・ChatGPT・X等）からの返信サジェスト
     データを1つの画面に集約する機能で、`components/`ディレクトリ（120件超のUIコンポーネント
     ファイル）に共通パーツをまとめて再利用する設計になっていた。開発者自身が「共通化された
     ものはシートで管理はもちろんソースコードもcomponentsとして管理すれば車輪の再発明や
     共通部分の使いまわしができる」とX上で説明していた通り、**連携先が増えるほど「同じ形の
     画面を毎回新しく書く」誘惑が強くなるからこそ、最初から共通置き場を決めておく価値が
     大きい**、という基準⑤⑥の生きた実例。
     ★機械検出: `templates/diagnostics/check-near-duplicates.mjs`（`npm run diagnostics`で走る。2026-09-07追加）。
- **作業開始時に全文脈を取る。** `npm run context` で `.instrument-context.md` を作り、指示書・現在の変更・過去の却下案の出典を確認してから直す。作業後は、証拠がある結果だけを `npm run context:record -- ...` で `confirmed` / `rejected` として戻し、まだ推測なら `pending` にする。秘密候補の本文は取らない。
- **知見は書き戻す。** 却下対応や初見のエラーを解決したら、[`_docs/KNOWLEDGE-CARRYOVER-RULES.md`](_docs/KNOWLEDGE-CARRYOVER-RULES.md) に従って該当KBに追記する。読むだけで終わらせない。
- アプリ固有の設定は必ず [`app.config.json`](app.config.json) から読む。ハードコードしない。
- **品質ルールは「AI汎用ルール」に従う**（`../AI汎用ルール/` または同梱の `docs/ai-rules/`）。
  特に: URLはディレクトリ形式 / index.html を出さない / www統一 / http→https 301 / canonical明示。
- Chrome申請は [`docs/CHROME-WEBSTORE.md`](docs/CHROME-WEBSTORE.md) を参照（OAuthは「デスクトップアプリ」型・認証コードは短命）。
- iOS/Android/Chrome のGUI操作が必要なときは、**自動化できないことを明示**してユーザーに手順を伝える。
- トラブルは [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)、課金税務は [`docs/TAX-SETUP.md`](docs/TAX-SETUP.md)。
- **アプリ内課金(IAP・サブスク)の実装はこのキット本体には型が無い。** 実装の型は既存プロジェクトにある（ゼロから作らない・毎回調査し直さない）。
  - **PHP原型（Capacitor server.url型 + @capgo/native-purchases・App Store Server API/通知検証の完成品）**: `../resend.kimito-link.com/app/services/apple_client.php`（Apple）/ `google_client.php`（Google）/ `public/assets/iap-billing.js`（クライアント）/ 事業者手順は `../resend.kimito-link.com/SETUP-iap-activation.md`（商品ID命名・ストアGUI・審査必須要件を網羅）。
  - **Next.js(TS)移植の実例**: `../malwarecheck.site/apps/web/lib/apple/appStoreClient.ts`（★手書きJWS/証明書検証は移植せず Apple公式 `@apple/app-store-server-library` を使う）/ 通知受け `apps/web/app/api/apple/notifications/route.ts` / 購入UI `apps/web/components/MonitorIapButton.tsx`。設計は `../malwarecheck.site/_docs/defender-asymmetry-prognosis-DESIGN.md` の続き。
  - ★地雷: server.url型はプラグインJSが自動注入されないので Web側に配線が要る。CIは `cap copy` でなく **`cap sync`** にしないとプラグインのPodが入らず「コードはあるのに動かない」になる。IAP追加は「無料アプリ(3.1.3(f)免除)申告」との矛盾になるので審査申告の変更が要る。
- **キャラ（りんく/こん太/たぬ姉）で親しみやすく。** ユーザー向けの説明は、専門用語を避け、
  小学生〜90歳でもわかる言葉で。りんく=案内役、こん太=背中を押す、たぬ姉=注意点を教える。
- **暴走（同じ単語・文の無限繰り返し）を見つけたら即座に会話を打ち切る（2026-09-04追記）。**
  チャットの応答本文で同じ単語・短いフレーズが数十〜数百回連続する現象（例:「count count count …」）は
  LLM一般に知られる退行的な出力ループであり、ツール呼び出しのスピン（`../AI汎用ルール/docs/policies/AI_HARNESS_OPERATION.md`
  §1が正本）とは別種。**待っても自然には止まらない**ため、気づいた側（人間・別セッションの
  どちらでも）がその場で入力を止め、新しいメッセージ（別の話題でもよい）を送って会話をリセットする。
  同じセッションを励ましたり指摘したりして継続させようとしない（暴走中の出力に対する追加指示は
  同じ穴にさらに積み上がるだけで効かない）。直前の指示内容やコンテキストの偏り（同じ語を含む
  資料を大量に読ませた直後等）が引き金になりやすいという説はあるが、確定した回避策ではないため
  「原因はこれ」と決めつけて対策しない。実害が大きい場合（大量のファイル書き込み等）は該当プロセスを
  停止し、直前のコミット/保存点との差分を確認してから復旧する。

---

## ★Webの独自ドメイン接続は1コマンド（2026-09-04 追記・characterlive から書き戻し）

**Cloudflare のドメインを Vercel に向ける作業を自動化した。管理画面を人が開かない。**

> 発端（ユーザーの言葉）:**「なんか毎回トークン発行する作業があるの大変　おわりにできない？」**
> 実際 `characterlive.link` の公開時、**A レコード 1 本**を足すためだけに人の手が要り、そこで止まった。

```bash
node ../ai-hub/bin/domain-connect.mjs <domain>          # A/CNAME を設定
node ../ai-hub/bin/domain-connect.mjs <domain> --check   # 今の状態を見るだけ
```
実体: `github/ai-hub/bin/domain-connect.mjs`（横断ツールなので正本は ai-hub 側）

### ★1回だけやること（以後ずっと自動）
Cloudflare → マイプロフィール → APIトークン → **トークンを作成**
→ テンプレート **「ゾーンDNSを編集する」** → ゾーンリソース **すべてのゾーン**
→ 環境変数 **`CLOUDFLARE_DNS_TOKEN`** に入れる。★値はここに書かない（このリポは public）。

★**既存の `CLOUDFLARE_API_TOKEN` では動かない**（実測）。
　ゾーン一覧は 21 件見えるのに、DNS 操作だけ `10000: Authentication error` で弾かれる。
　**「見えている＝編集できる」ではない。** ツールがこの理由を画面に出すので迷わない。

### ★ネームサーバーは Cloudflare のまま変えない
Vercel の NS に移せば DNS 作業は消えるが、**他ドメインで Cloudflare の機能を使っているので不可**。
A レコードを足すだけにする。

### 覚えておく値（毎回調べ直さない）
| 何 | 値 |
|---|---|
| Vercel の A レコード | `76.76.21.21` |
| www の CNAME | `cname.vercel-dns.com` |
| プロキシ(オレンジ雲) | ★**必ず OFF**。ON だと Vercel の証明書発行が通らない |

### ★★Cloudflareのトークンは「用途ごとに権限が独立している」（2026-09-05 line-bot から書き戻し）

**同じ症状を3回踏んだので、ここに一般化して置く。**

上の DNS の話は特殊事情ではない。**Cloudflare の権限は機能ごとに完全に分かれていて、
1つの権限が他に波及しない。** 実測した例:

| やりたいこと | 要る権限 | ★これでは通らない |
|---|---|---|
| DNSレコードを足す | Zone → DNS → Edit | Zone→Read（見えるだけ） |
| メール受信を設定 | Zone → **Email Routing Rules** → Edit | Zone→DNS→Edit を持っていても**不可** |
| ページに鍵をかける | Account → Access: Apps and Policies → Edit | 他のAccount権限では**不可** |
| Workerを一覧する | Account → Workers Scripts → Read | — |

**★「ゾーンが21件見えている」は、そのゾーンに何かできる保証にならない。**
実測（2026-09-05, kimitotalk.link）:
```
見えるゾーン: 21件           ← Zone→Read はある
Worker: 8件                  ← Workers Scripts→Read もある
Access アプリ: 0件（触れる） ← Access→Edit もある
✗ Email Routing — 10000: Authentication error   ← ここだけ無い
```

**対処**: 足りない権限**だけ**を既存トークンに追記する。
新しく作り直さない（作り直すと GitHub Secrets 等の再登録が発生して事故る）。
→ ダッシュボード → マイプロフィール → APIトークン → 対象トークンの **Edit** →
　 Permissions に1行足す → Save。**値は変わらないので再登録は不要。**

### ★★トークンは「手元に持ってこない」で済むことが多い（2026-09-05）

GitHub Secrets のトークンは**読み出せない**（設計上そうなっている）。
しかし **workflow の中では使える**ので、設定作業を workflow に置けば
**値を誰の目にも触れさせずに**実行できる。クリップボード経由すら要らない。

実例: `line-bot/.github/workflows/cloudflare-setup.yml` +
`line-bot/scripts/cloudflare-setup.mjs`
- `mode=check` … 何ができるかを読み取るだけ（★変更しない）
- `mode=email-routing` / `mode=access` … 実際に設定する

★**いきなり設定を変えず、必ず check から**。権限不足がその場で分かるので、
「設定したつもりが効いていない」を作らない。
★エラー本文にトークンが混ざり得るので、出力前に必ず伏せる（redact）。

### ★同時に踏んだ罠（`vercel.json` はコメント不可）
`vercel.json` に `"//"` でコメントを書くと **デプロイが落ちる**:
`Invalid vercel.json - should NOT have additional property`
→ 設定の理由は**別ファイル**に残す（実例: `characterlive/DEPLOY.md`）。
　特に `/src/*.js` の `Content-Type: text/javascript` は、間違えると
　ES モジュールが実行されず**画面が真っ白**になるので、理由を残す価値が高い。

## ⚠️ 公開でハマりやすいポイント（実体験ベース）

`docs/TROUBLESHOOTING.md` に詳細。要点：

- **iOS「承認 ≠ 公開」**：審査が通っても「配信地域」が未設定だとDLできない（最大24h反映）
- **Android「リリース作成 ≠ 審査送信」**：最後の「審査用に送信」を忘れがち
- **Chrome OAuth**：クライアントは「デスクトップアプリ」型／認証コードは数分で失効
- **反映には時差**：緑チェックが付いても実機DLまで数時間〜24時間

---

## フォルダ構成（現状）

```
START-HERE.md        ← 👤 人間はまずここ（キャラ解説・超やさしい）
CLAUDE.md            ← 🤖 AIはここ（この指示書）
app.config.json      ← ⭐ アプリ情報を書く紙（〇〇を入れる）
docs/                ← 手順書・トラブル対処・税務・Chrome申請
templates/           ← ⭐ 自動化の金型（scripts / workflows / android-twa / capacitor）
  scripts/           ←   iOS/Android リリーススクリプト＋lib/
  workflows/         ←   GitHub Actions（release / poll / lint / cert-expiry）
  android-twa/       ←   mac 不要 Android（TWA）一式
  web/               ←   Web→アプリDL導線（公式バッジ・出し分け・Smart App Banner）
  README.md          ←   コピー手順とコピー先マッピング
_docs/               ← キット内部資産（却下KB・設計メモ。サイトには出ない）
scripts/chrome/      ← Chrome申請の自動化スクリプト
site/                ← 紹介サイト＋キャラ画像
```

> iOS/Android/Web の自動化はすべて `templates/` に同梱済み。`templates/README.md` の
> マッピングに従ってコピーし、`app.config.json` の値で置換する。

> 🌐 **「〈機能ページ〉の内容をLPにも反映させて」と言われたら、必ず先に
> [`site/LP-SYNC.md`](site/LP-SYNC.md) を読む。** 機能ページ↔LP(`site/index.html`)の
> 対応表・stepテンプレート・反映手順がまとまっている。AI指示ボックス
> （`.ai-box-slot`）は `site/assets/data/ai-instructions.json` が正本で、
> そこを直せば全ページに自動反映されLP側のHTMLは触らなくていい（詳細は同ファイル参照）。

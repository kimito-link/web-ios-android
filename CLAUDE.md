# AIへの指示書（このテンプレの使い方）

> 👤 人間が最初に読むのは [`START-HERE.md`](START-HERE.md)（小学生〜90歳でもわかる超やさしい版）。
> 🤖 AI（あなた）はこの CLAUDE.md を読んでから作業する。

---

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
| **iOS/Android リリースCI** | `templates/workflows/`（ios/android release・poll・lint・cert-expiry） | `partnership_program_website` / `fujisan-clean` |
| **iOS/Android リリーススクリプト** | `templates/scripts/*.mjs`（appstore-submit / play-publish / asc-* / lint-pre-submission / generate-store-assets 等）＋ `templates/scripts/lib/` | `partnership_program_website`（一部 `Exosome` と同一） |
| **Android TWA（mac 不要）** | `templates/android-twa/`（twa-manifest・署名注入・Windows用 ps1） | `Exosome` / `partnership_program_website` |
| **Capacitor 設定の金型** | `templates/capacitor/capacitor.config.template.ts` | `partnership` / 富士山 / `Exosome`（server.url 連動型） |
| **Web→アプリDL導線の金型** | `templates/web/`（公式バッジ取得・出し分け・Smart App Banner・CSS） | `Exosome`（実装・ブラウザ検証済み） |
| **出荷事故ゲート** | `templates/scripts/verify-ios-splash-not-default.mjs`（Capacitorデフォルトスプラッシュ防止）／`verify-android-signing-config.mjs`（未署名AAB防止）／`check-tracked-imports.mjs`（**新規ファイルのadd忘れ検出**=git clone直後でもimportが全解決するかをgit ls-filesだけで検査）。CI から呼ぶ | `Exosome`（CI で実証）／tracked-importsは `tsuioku-no-kirameki.com`（Vercel全デプロイ失敗の実事故から実装・実証） |
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
| **ネイティブ(Expo prebuild)版** | [`templates/expo-native/`](templates/expo-native/README.md) — WebView に頼らずネイティブとして両ストアに出す金型。**選ぶ理由の第一は「軽さ」**（WebView は JS を実行時パースするので Capacitor↔ネイティブの差は秒の世界。Hermes の事前コンパイルで構造的に消える）。副次的に OAuth の制約（Google の WebView 拒否・Apple の iOS17 封鎖）も解ける。**TWA / Capacitor / Expo の選び分け**と踏んだ地雷4件（versionCode 固定・署名判定の正規表現誤検知・拡張子違いの同名画像・Play のストア言語）を README に集約 | `surechigai-romi-link` iOS 2026-08-07 移行 / Android 2026-08-11 内部テスト配信 |

> ※ 「出典」は金型の元になった実プロジェクト（読み取り専用・触らない）。
> キットを使うときは出典を見に行く必要はない。`templates/` のファイルをコピーして使う。
> ※ コピーするときは、アプリ固有の値（displayName / bundleId / ascAppId / ドメイン /
> playPackageName / Team ID 等）を必ず `app.config.json` の値に置き換える。ハードコードしない。
> 多くのスクリプトは `app.config.json` を SSOT として自動で読むので、CI の `<...>` を埋めれば足りる。

---

## AIへのお願い（守ること）

- **作業開始時に全文脈を取る。** `npm run context` で `.instrument-context.md` を作り、指示書・現在の変更・過去の却下案の出典を確認してから直す。作業後は、証拠がある結果だけを `npm run context:record -- ...` で `confirmed` / `rejected` として戻し、まだ推測なら `pending` にする。秘密候補の本文は取らない。
- **知見は書き戻す。** 却下対応や初見のエラーを解決したら、[`_docs/KNOWLEDGE-CARRYOVER-RULES.md`](_docs/KNOWLEDGE-CARRYOVER-RULES.md) に従って該当KBに追記する。読むだけで終わらせない。
- アプリ固有の設定は必ず [`app.config.json`](app.config.json) から読む。ハードコードしない。
- **品質ルールは「AI汎用ルール」に従う**（`../AI汎用ルール/` または同梱の `docs/ai-rules/`）。
  特に: URLはディレクトリ形式 / index.html を出さない / www統一 / http→https 301 / canonical明示。
- Chrome申請は [`docs/CHROME-WEBSTORE.md`](docs/CHROME-WEBSTORE.md) を参照（OAuthは「デスクトップアプリ」型・認証コードは短命）。
- iOS/Android/Chrome のGUI操作が必要なときは、**自動化できないことを明示**してユーザーに手順を伝える。
- トラブルは [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)、課金税務は [`docs/TAX-SETUP.md`](docs/TAX-SETUP.md)。
- **キャラ（りんく/こん太/たぬ姉）で親しみやすく。** ユーザー向けの説明は、専門用語を避け、
  小学生〜90歳でもわかる言葉で。りんく=案内役、こん太=背中を押す、たぬ姉=注意点を教える。

---

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

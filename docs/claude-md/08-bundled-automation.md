> CLAUDE.md から移した節です。この中の backtick のパスはリポジトリ直下からの相対です。

## 自動化の実体はキット同梱（`templates/` から使う）

iOS/Android/Web/Chrome の自動化スクリプト・CI・TWA は **`templates/` に同梱済み**。
参照元プロジェクトへの手コピーは不要になった。新しいアプリを作るときは、`templates/` から
コピーして `app.config.json` の値に置換するだけ。詳しい手順とコピー先は
[`templates/README.md`](../../templates/README.md) を読む。

| 欲しい自動化 | キット内の場所 | 出典（金型の元） |
|---|---|---|
| **iOS/Android リリースCI** | `templates/workflows/`（ios/android release・poll・lint・cert-expiry。Android cert-expiryは2026-08-25新設でapple-cert-expiry.ymlの対） | `partnership_program_website`（Android cert-expiryはこのキット自身。旧出典`fujisan-clean`は2026-09-08時点で消失済み・LINE接続不具合により削除されたと確認、実証元としては失効） |
| **iOS/Android リリーススクリプト** | `templates/scripts/*.mjs`（appstore-submit / play-publish / asc-* / lint-pre-submission / generate-store-assets 等）＋ `templates/scripts/lib/` | `partnership_program_website`（一部 `yukkuri-exosome.link` と同一） |
| **Android TWA（mac 不要）** | `templates/android-twa/`（twa-manifest・署名注入・Windows用 ps1） | `yukkuri-exosome.link` / `partnership_program_website` |
| **Capacitor 設定の金型** | `templates/capacitor/capacitor.config.template.ts` | `partnership` / 富士山 / `yukkuri-exosome.link`（server.url 連動型） |
| **Web→アプリDL導線の金型** | `templates/web/`（公式バッジ取得・出し分け・Smart App Banner・CSS・iOS Universal Links金型=`apple-app-site-association.example`） | `yukkuri-exosome.link`（実装・ブラウザ検証済み）／Universal Linksはこのキット自身（2026-08-25新設。Android版`assetlinks.json.example`の対） |
| **kimito.link共通アカウント: ちらつきゼロ認証モード金型** | [`templates/web/auth-mode/`](../../templates/web/auth-mode/README.md)（ペイント前・同期の`data-auth`確定スニペット・CSS契約・cookie解析契約テスト。★`__client_uat`は必ずexec-loop/matchAllで全件走査、`String#match`単体は複数cookie併置で誤判定する） | `yukkuri-exosome.link`（MVP確定・実証済み 2026-09-29）／`surechigai-romi.link`（統合済み） |
| **出荷事故ゲート** | `templates/scripts/verify-ios-splash-not-default.mjs`／`verify-android-splash-not-default.mjs`（Capacitorデフォルトスプラッシュ防止）／`verify-android-signing-config.mjs`（未署名AAB防止）／`verify-webdir-consistency.mjs`（capacitor.config.tsのwebDirとCI生成先の不一致防止＝原則8）／`verify-signing-material-path.mjs`（署名鍵の配置パス不一致防止＝原則9）／`check-tracked-imports.mjs`（**新規ファイルのadd忘れ検出**=git clone直後でもimportが全解決するかをgit ls-filesだけで検査）／`verify-app-config-schema.mjs`（**壊れたapp.config.jsonの素通り防止**=ajvでapp.config.schema.jsonと照合。2026-08-25新設）／`verify-assetlinks-published.mjs`（**assetlinks.json未配信・package_name不一致の検出**=本番URLへの実fetchで疎通確認。2026-08-25新設）／`verify-twa-signing-matches-assetlinks.mjs`（**TWAのアドレスバーが消えない事故の検出**=Play App Signing が再署名した【配布される】署名が assetlinks.json に載っているかを androidpublisher の generatedApks[].certificateSha256Hash で照合。★Google の Digital Asset Links API も keytool も bubblewrap も adb もこの不一致は検出できない。2026-09-05新設）。CI から呼ぶ | `yukkuri-exosome.link`（CI で実証）／tracked-importsは `tsuioku-no-kirameki.com`（Vercel全デプロイ失敗の実事故から実装・実証）／webdir-consistencyとsigning-material-pathは`kimito resend`（2026-07-04実戦、`_docs/CAPACITOR-GOLDEN-RULES.md`原則8・9）／app-config-schemaはこのキット自身（2026-08-25の計器抜け漏れ調査で発見・実装） |
| **AI自己検証（計器）の思想** | [`docs/ai-rules/04_SELF_VERIFICATION.md`](../../docs/ai-rules/04_SELF_VERIFICATION.md) — 製品自身に計器（挙動の自己申告）を埋め込み、AIが人間の目視なしで検証ループを回す6パターン（fail-soft/provenance・メタ診断=診断計器自体の網羅性契約テスト、を2026-07-16追加）。**新しいアプリを作るとき設計段階で読む** | `tsuioku-no-kirameki.com`（診断817秒→5ms・遅延実測等で実証） |
| **画面を人に渡すときの作法** | [`docs/ai-rules/05_HANDING_SCREEN_TO_HUMAN.md`](../../docs/ai-rules/05_HANDING_SCREEN_TO_HUMAN.md) — 自動化を途中で人へ渡す場面（画像認証・ログイン・決済・本人確認）の渡し方。★「開きました」と言う前に**ウィンドウが実際に見えているか座標で確認する**（X=-32000 は最小化＝どのモニタにも無い）。位置は起動時に指定する（後から復元しても戻る）。タイムアウトで閉じない。人にやらせる操作は3つ以内 | `ai-shain-worker`（2026-09-11、LINE公式アカウント作成で確立。最小化された窓を「開いたはず」と案内してユーザーを探させた実事故から） |
| **計器の完全版（全文脈→検証→進化）** | [`_docs/instruments/CONTEXT-EVOLUTION.md`](../../_docs/instruments/CONTEXT-EVOLUTION.md) — 全追跡ファイル・Gitが表示する未追跡ファイル、Git全履歴、現在の変更、指示書、確定/却下/未確定の判断を出典つきで1枚化。`context-engine.mjs` と `run-instruments.mjs` をコードごと配布 | このキット自身（2026-08-24から自己利用） |
| **各プログラム本体の診断・進化進捗ページ** | [`_docs/instruments/SHINDAN-VERSION-PAGE.md`](../../_docs/instruments/SHINDAN-VERSION-PAGE.md) — 新規アプリごとに本体URLの `/check-shindan-version/` を作り、導入・実測・履歴・公開の進捗と4状態、根拠、次の一手を表示。`setup-new-app` と Next.js `prebuild` から自動更新 | このキット自身（同じページを生成して自己利用） |
| **プライバシーページ生成** | `templates/scripts/generate-privacy-page.mjs`（健康/Play 必須の公開URL・API非依存） | `yukkuri-exosome.link` |
| **設定の単一真実源** | `app.config.schema.json`（identity/stores/brand/contact/auth/businessModel/ownership の JSON Schema） | `yukkuri-exosome.link` |
| **却下対応KB（Fable学習素材）** | `_docs/apple-reject-knowledge-base.md` | `partnership_program_website/_docs/` |
| **初回提出ブロッカー全リスト** | `_docs/FIRST-SUBMISSION-blockers.md`（新アプリの「最初の1回」だけ順番に踏むiOS/Android詰まり8個＋ASC UI手動項目。症状=CIログ文言・原因・直し方） | `malwarecheck.site`（iOS初回提出 2026-07 実戦） |
| **Web→アプリDL導線 知見KB** | `_docs/web-to-app-install-best-practices.md` | `yukkuri-exosome.link`（ディープリサーチ確証分） |
| **Clerk X OAuth ログイン無人E2E検証 KB** | `_docs/clerk-x-oauth-e2e-verification-playbook.md`（ログイン判定偽陽性・1タップ導線URL食い違い・タイムアウト時証跡収集・Windows spawn罠・Xレート制限、の5事故と直し方） | `surechigai-romi-link` 2026-07-04実戦 |
| **Chrome 申請自動化（★審査送信まで全自動）** | （このフォルダ内）`scripts/chrome/`（`build-zip-node.mjs` / `publish-cws-node.mjs`）。**正本KB = [`_docs/chrome-web-store-submission-playbook.md`](../../_docs/chrome-web-store-submission-playbook.md)**。★**CWSの提出は「人間がダッシュボードで押すしかない」は誤り**＝管理画面はブラウザ自動操作が全面ブロックされるが、公式 Publish API があるので `--publish` で審査送信まで自動。**Playとは境界が逆**（Playは掲載情報まで自動だが審査送信だけUI必須／CWSは審査送信が自動で掲載文だけ手動）。2026-08-03にAIがこれを誤解しuserに3回「できません」と言った事故あり | `dns-osint-pro`（ps1実運用）／`tsuioku-no-kirameki.com`（Node版 `../tsuioku-no-kirameki.com/scripts/cws-publish.mjs`・v0.1.1244 提出実証） |
| **LINE公式アカウントAI社員bot** | `templates/line-bot/`（Cloudflare Workers + D1、GROQ AI応答。fail-closed設計・詳細は同梱README）。移植判断は [`_docs/LINE-BOT-EXTRACTION-NOTES.md`](../../_docs/LINE-BOT-EXTRACTION-NOTES.md) | `line-harness-oss`（ai-shain.link実運用分。CRM機能を除去し単一アプリ用に最小化） |
| **知見の書き戻しルール** | [`_docs/KNOWLEDGE-CARRYOVER-RULES.md`](../../_docs/KNOWLEDGE-CARRYOVER-RULES.md) — 却下対応・初見エラーの解決を、次のアプリのAIが読み返せる形でKBに追記する手順 | — |
| **「直したのに変わらない」調査KB** | [`_docs/runtime-truth-verification-knowledge-base.md`](../../_docs/runtime-truth-verification-knowledge-base.md) — コードを読んだ推論で原因を3回誤特定し、`fetch`ラップの実測1回で解決した実戦。①送信中身を丸ごと捕獲②入力と出力を並べて後処理の書き換えを見る③定数の重複定義を疑う。「上位モデルに変える」「読み込みを丁寧にする」が効かなかった記録も含む | `reply-copilot-openrouter-v2` 2026-07-30実戦 |
| **共有部品が「あるのに使われない」KB** | [`_docs/shared-parts-duplication-knowledge-base.md`](../../_docs/shared-parts-duplication-knowledge-base.md) — 同じ画面部品が3実装に割れ、**一度直したバグが別画面では直っていなかった**実戦。★重複禁止のルールは既に3箇所にあり、それでも守られなかった＝文章を足しても解決しない（検査していない規範は守られない）。★「重複を直す話」と「症状を直す話」は別物（司令塔が実際に誤診した記録つき）。統合すべきでない違い（Ctrl+F/HTML保存/印刷のため全件描画する等）の見分け方も収録 | `reply-copilot-openrouter-v2` 2026-09-01実戦 |
| **ネイティブ(Expo prebuild)版** | [`templates/expo-native/`](../../templates/expo-native/README.md) — WebView に頼らずネイティブとして両ストアに出す金型。**選ぶ理由の第一は「軽さ」**（WebView は JS を実行時パースするので Capacitor↔ネイティブの差は秒の世界。Hermes の事前コンパイルで構造的に消える）。副次的に OAuth の制約（Google の WebView 拒否・Apple の iOS17 封鎖）も解ける。**TWA / Capacitor / Expo の選び分け**と踏んだ地雷4件（versionCode 固定・署名判定の正規表現誤検知・拡張子違いの同名画像・Play のストア言語）を README に集約 | `surechigai-romi-link` iOS 2026-08-07 移行 / Android 2026-08-11 内部テスト配信 |
| **思いつき→Issue→自動実装→PR（スマホから開発を回す）** | `templates/workflows/idea-to-pr.yml` — スマホのGrok等にAIチャットで思いつき・不具合報告を投げる → GrokのGitHubコネクター（2026-05のxAI Connectors。OAuth接続でGitHubを直接読み書き）でこのリポにIssueを起票 → 公式`anthropics/claude-code-action`が自動起動しClaude Codeが実装 → PR作成、まで人がPCを開かずに通す。Claude GitHub Appのインストールと`CLAUDE_CODE_OAUTH_TOKEN`（既定・サブスク利用枠、追加課金なし）または`ANTHROPIC_API_KEY`（従量課金）のSecret登録が必要。既定では`ai-task`ラベル付きIssueだけ対象（誰でもIssueを開けるリポでの暴発防止）。mainへの自動マージはしない（PRは必ず人が確認） | 公式`anthropics/claude-code-action`（[Claude Code GitHub Actions公式ドキュメント](https://code.claude.com/docs/en/github-actions)） |

> ※ 「出典」は金型の元になった実プロジェクト（読み取り専用・触らない）。
> キットを使うときは出典を見に行く必要はない。`templates/` のファイルをコピーして使う。
> ※ コピーするときは、アプリ固有の値（displayName / bundleId / ascAppId / ドメイン /
> playPackageName / Team ID 等）を必ず `app.config.json` の値に置き換える。ハードコードしない。
> 多くのスクリプトは `app.config.json` を SSOT として自動で読むので、CI の `<...>` を埋めれば足りる。

---


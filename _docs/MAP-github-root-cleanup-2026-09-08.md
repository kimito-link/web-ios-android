# github直下 整理整頓マップ（2026-09-08時点）

司令塔が2回のExplore調査＋Plan mode時点の調査で裏取りした事実だけをまとめる。
提案・実行はまだしていない。このマップを見ながら1件ずつ最終判断する。

## A. 統合済み・旧リポの後片付けが必要（実測で確認済み）★2026-09-08完了

以下3件は**ローカル削除＋GitHub Archive化を実行済み**（`Negative-suggestion-checker`・
`dns-osint-pro-ver2.0`はGitHub側`isArchived: true`確認済み。`reviewcheck.jp-kenshin`は
GitHub上に対応リポ自体が存在せずローカルクローンのみだったためローカル削除のみ）。

| 旧リポ | 正本 | 根拠 |
|---|---|---|
| `Negative-suggestion-checker` | `web-health-check-app/extension/` | README冒頭に2026-09-03付の統合案内あり。manifest.json/popup.jsの差分は名称・ロゴ・ハッシュタグのみ（8行）で診断ロジックは完全共通と実測確認 |
| `dns-osint-pro-ver2.0` | 同上 | 同上（同じ拡張の別ブランド版） |
| `reviewcheck.jp-kenshin` | `reviewcheck.jp` | git remoteが両方とも同一の`kimito-link/reviewcheck.jp.git`を指す重複クローン。README/DESIGN.md完全一致。kenshin側の最終実質コミットは2026-07-07で以降は自動コミットのみ。未コミット変更は軽微1件 |

**片付け方の選択肢**（まだ未決定）:
- ローカル削除＋GitHub側もArchive化
- ローカル削除のみ（GitHub側は残す）
- `.claude/worktrees`配下（各8〜9個、2026-02時点の開発初期ブランチ残骸と確認済み）だけ先に掃除

## B. 台帳（best-trust/data/repositories.json）の記述が古い・欠落している

| リポジトリ | 現在のnote | 実態（判明した事実） |
|---|---|---|
| `ai-health-check.link` | 「AIの健康診断」 | `reviewcheck.jp`のAI診断エンジンを独立ドメインに切り出した派生。README「測定ロジックは一切コピーせず、reviewcheck本番APIを越境fetch」と明記。出自が台帳未記載 |
| `linebot`（localPath: `line-bot`） | 「LIFFアプリ。どの製品の構成要素か未確認」 | git remoteが`fork`/`shudesu`/`upstream`で`line-harness-oss.git`を指すフォーク。台帳には`line-harness-oss`が別途confirmedエントリとして存在し、統合検討漏れの疑い |

## C. 別物として残してよい（役割が違うだけで正常な分離と確認済み）

| グループ | 役割分担 | 根拠 |
|---|---|---|
| `best-trust` / `best-trust.biz` | corporate-root（台帳・意思決定記録）/ corporate-site（公開Webサイト） | 台帳の`roles`定義通り。役割文書と実態が一致 |
| `ai-shain-worker` / `ai-shain.link` | ワーカー実装（LINE/Issue経由でClaude Code非対話実行）/ 静的LP（マーケティングサイト、バックエンドなし） | 両方生きているリポ（最終コミット2026-09-03・2026-08-19）。`ai-shain.link/docs/ARCHITECTURE-personal-ai-employee-first.md`に関係性が明記済み |
| `web-health-check-app` / `web-health-check.link` | アプリ本体（Next.js、拡張・iOS/Android・ストア申請のSSOT）/ LP専業（Astro、疎結合） | 両方生きている（最終コミット2026-09-07・2026-09-03、web-health-check.linkは未コミット0件でクリーン） |

## D. unclassified 14件 ★2026-09-08 fork/upstream関係の全件チェック完了

`resend-app`・`reply-copilot-v8`・`works`はローカル未クローンのため対象外。
`Negative-suggestion-checker`は削除済みのため対象外。残り9件（`soushin-suggest.link`・
`Target-List-maker`・`traffic-seo`・`discordai`・`VeniceUncensored`・`localclaudcode`・
`nagano_giin_complete_guide`・`characterlive`・`bestprice`）は`git remote -v`で確認した
ところ、いずれも`origin`のみでkimito-linkオーナーを指しており、`linebot`のような
「APIのisForkは正しいが、ローカルremoteに他オーナーへの参照が隠れている」パターンは
無かった。**追加のfork関係はlinebot以外に無いと確認できた（カテゴリB完了）。**

### 元のunclassified一覧（README冒頭のみ確認、重複記述なし）

`resend-app` / `reply-copilot-v8` / `soushin-suggest.link` / `Target-List-maker` /
`traffic-seo` / `discordai` / `VeniceUncensored` / `localclaudcode` / `works` /
`nagano_giin_complete_guide` / `characterlive` / `bestprice`

→ 統合すべき兆候は見つからなかったが、README冒頭しか見ていないため「重複無し」の確証度は低い。
　`linebot`同様、git remoteのfork/upstream関係を全件チェックすれば追加で見つかる可能性がある
　（今回は`linebot`を調べていて偶然見つかった。他13件は未チェック）。

## E. Plan mode時点の削除候補14ファイル ★2026-09-08完了

`ALA-tsuruhashi-business-*` / `IMPLEMENTATION-HANDOFF-aidiag-affiliate-monitor-2026-07-08.md` /
`IMPLEMENTATION-HANDOFF-monitor-ishikawa-2026-07-08.md` / `KIMITO-LINK-HUB-STRATEGY-*` /
`ai-prompt-templates-skillify-DESIGN.md` / `purchase-funnel-*`(3枚) / `x-to-threads-*`(3枚) /
`汎用送信マクロ-*` を削除。削除前に`ai-hub doctor`で参照ゼロを確認。

★削除作業中に**Aのリポジトリ削除（dns-osint-pro-ver2.0）で見落としていた参照切れ**を発見・修正した:
`ai-hub/index.json`の`kb-extension-popup-perf-fixes`エントリが
`dns-osint-pro-ver2.0/docs/POPUP-PERF-2026-06-05.md`を指したままだった
（Aの削除時は`grep -l`でindex.json内の文字列一致だけを見て「参照ゼロ」と判断しており、
`doctor`のJSON全文の`problems`配列を見ていなかったのが原因）。幸い同じファイルが
統合先`web-health-check-app/extension/docs/`に既に移動済みだったため、pathを
書き換えるだけで解決した。**教訓: リポジトリ削除前の参照確認は`grep`ではなく
必ず`node ai-hub/bin/hub.mjs doctor --json`の`ok`値と`problems`配列を見ること。**

## F. 第2弾の削除（2026-09-08、実地調査で完了済みと確認したもの） ★完了

- `nicolivelog-extension-investigation.zip`（21MB）: 2026-04時点の開発初期スナップショット。
  現在の`tsuioku-no-kirameki.com`にgit管理下で実質同一内容がv0.1.1507まで発展済みと確認し削除
- `clibor-mobile-DESIGN.md`・`-IMPLEMENTATION-HANDOFF.md`: `sakkino.link`としてFlutter本体・
  iOS/Androidネイティブキーボードまで実装済みと確認し削除
- `council-upgrade-2026-07-03-handoff.md`・`decision-2026-07-01.md`: 文書内に「実装完了」と
  明記、`meeting.mjs`に反映済みと確認し削除
- `OKF-meeting-notes.md`: 2026-06-14付の経緯記録、後続実装（ai-generic-rules等）に繋がった
  決着済み文書として削除
- `ouenmovie-business-MAP.md`・`-SPEC.md`: 7/30付の事業化検討文書。`ouenmovie`は既に
  実運用フェーズ（HANDOFF・STATUS・リリースノート多数）に移行済みと確認し削除

削除前に全件`ai-hub doctor`で参照ゼロ（未登録）を確認済み。削除後も`ok: true`のまま。

## 残っている未決定事項（現役と判定・触っていない）

- `ai-reply-draft-tool-DESIGN.md`・`-IMPLEMENTATION-HANDOFF.md`: 実装先は`ai-business-secretary`
  に移動済みだが、設計思想の経緯文書として価値がある可能性。削除は保留
- `best-trust-brand-strategy-DESIGN.md`・`-IMPLEMENTATION-HANDOFF.md`: 思想は`best-trust`の
  READMEに反映済みだがADR未作成の継続文書。削除は保留
- `KIMITO-CLERK-UNIFICATION-PLAN.md`: 一部リポジトリ（surechigai-romi.link）は実装済みだが、
  他リポジトリ（kimitolink-linktree等）への展開未確認。現役文書として保留
- `ANTI-SLOP-ADOPTION-ASSESSMENT.md`: 判定不能（追加調査が必要）
- `HANDOFF-cloudflare-workers-ai.md`・`HANDOFF-hatsunote-mcp.md`・`HANDOFF-kioku-mcp.md`:
  ai-hub/index.json登録済みのため削除不可。github直下配置のままでよいかは未検討
- `linebot`とline-harness-ossの関係は「参考・派生元の可能性」と台帳に記録済みだが、
  統合・整理するかどうかは本人確認待ち（勝手に判断しない）

A〜Fは完了。github直下の当面の整理整頓はここで一区切り。

## G. 第3弾（2026-09-08、Plan mode経由） ★一部完了

★**教訓（今回の最重要発見）**: 前回Plan mode（Step 5）で`.claude_backup_tsuioku/`は
「削除してよい」とユーザー確定済みだったが、**このセッションで実行し忘れたまま
別の調査を続けていた**。複数セッション・複数の確認ラウンドにまたがるタスクでは、
確定済みの判断が後続の作業で見落とされるリスクがあると判明。対策として、Plan modeの
計画ファイル冒頭に「確定済みで動かさない事実」の一覧表を置き、以後の質問をスキップする
運用に変更した（`C:\Users\info\.claude\plans\cached-stirring-umbrella.md`参照）。

### 完了

- `.claude_backup_tsuioku/`（4.2GB）: 前回確定済みの削除を実行（実行し忘れの解消）
- `codex/`（234MB）: `package.json`に`@openai/codex`依存が1つあるだけの空プロジェクト、
  234MBは全てnode_modules。削除
- `henshin-hisho-lp-deploy/`（3.5MB）: 中身は`.gitignore`と`.vercel`キャッシュのみ。
  実体のソース（`privacy.html`含む）は`henshin-hisho/ios-app/www/`側にあり、現役プロジェクト
  `gmail-secretary-extension`（Chrome Web Store申請済み）はそちらを参照していると確認済み。削除

削除前後で`ai-hub doctor`の`ok: true`を確認済み。

### 判定保留（依存確認が先に要る）★2026-09-08 Step Bで判定完了

- `nicolive-dl-master/`（3.2GB）: ツール本体（`nicolive_dl/`パッケージ、pyproject.toml等）と
  mp4動画2本（702MB＋2.48GB）は同一ディレクトリに混在しているが、**分離は技術的に可能**と
  確認（動画を除去してもツールの動作に影響しない）。実削除はまだ実行していない
  （動画データの要否は本人確認が要る）
- `gmail-secretary-extension/`（278MB）: **保持確定**。`henshin-hisho`（アプリ本体）と
  同じ製品の別レイヤー（Gmail連携用Chrome拡張）と確認。両方生きている現役プロジェクト
- `tegiwai-video/`（372MB）: キャラクター素材（konta/link/tanunee）は`ouenmovie`と共通だが、
  成果物は「手技（調理段取り支援）」という別ジャンルの単発企画。完成品`final_output.mp4`
  以降の追加開発の形跡なし＝**企画として完了済み**。素材（raw_*.rgb等）の破棄は本人確認要

### 小粒13件の判定結果 ★2026-09-08完了

| 対象 | 判定 |
|---|---|
| `appium/`(42MB) | Android実機スモークテスト。独立、重複なし |
| `hacking-tool/`(3.8MB) | 外部OSS(`hackingtool`)のクローン。自作物ではない |
| `manus/`(91KB) | 個人の法務案件記録（楽天カード紛争）。プロジェクトではない。削除するなら本人確認要 |
| `splash/`(53KB) | **削除完了**。README「2026-08-24統合済み・もう更新しない」と明記、統合先`web-ios-android/templates/scripts/`に主要ファイル実在確認済み |
| `telegram-todo-ai/`(20MB) | Telegramボット。独立、重複なし |
| `_enforcement-test/`(12MB) | stylelint検証用の使い捨てリポ |
| `surechigai-romi.link-deploy-886aeff/`(61MB) | **削除完了**。独立リポではなく`surechigai-romi.link`のgit worktree残骸と確認（`git worktree remove`で正しく除去） |
| `kimi-no-oto/`(34MB) | 「君の音」音声→オルゴール変換ツール。独立、重複なし |
| `kimito-link-yukkuri-douga/`(3.4KB) | キミトリンク3マスコットのゆっくり動画企画（`ouenmovie`とは別企画） |
| `resend-kimito-link-review/`(39MB) | **削除完了**。独立リポではなく`resend.kimito-link.com-`のgit worktree残骸（参照先`.git`が壊れていたため`Remove-Item`＋`git worktree prune`で除去。副次的に別のprunable worktree`review-clone`も一緒に整理された） |
| `surechigai-nico/`(16MB) | **保持確定**。台帳に`classification: confirmed`・`product: surechigai-nico`（すれちがいライト）として正式登録済みの独立現行プロダクト |
| `yukkuri/`(7.4MB) | 「ゆっくりメーカー」台本生成Webツール。`yukkuri-exosome.link`とは別物 |
| `デルタもん/`(19KB) | 単発コラボ企画ページ（HTML1枚）。役目を終えていれば削除候補 |

削除前後で`ai-hub doctor`の`ok: true`を確認済み。

## H. `_pending-deletion-review/`（2.9GB、7件） ★2026-09-08完了・ディレクトリごと削除

`git merge-base --is-ancestor`による実測比較で、7件中6件は本体リポジトリの祖先コミットに
**完全一致**（失われる情報なし）と確認。1件（`hosino-romi`）だけ、別プロジェクトへの
未pushな差分を含んでいたが、そのプロジェクト自体が現在使われていないと確認され、
push不要のまま削除で確定した。

| 対象 | サイズ | 判定根拠 |
|---|---|---|
| `kimito-link-clone` | 506MB | HEAD(`376c200`)は本体`kimito-link`(`a52e128`)の祖先。ローカル専用ブランチの内容も本体に既に反映済み |
| `kimito-link-fresh` | 701MB | `kimito-link-clone`と同一コミット。未コミット差分は軽微かつ本体で既に先行 |
| `kimito-link-github-download` | 345MB | git実体なしのZIPスナップショット。同系統の古いスナップショット |
| `compass-temp-clone` | 40MB | HEAD(`6f6323b`)は本体`compass`(`0d0aa04`)の祖先と`merge-base`で確認、未コミット変更なし |
| `gpthisho-admin-api-backup-20260713-052940` | 35KB | 本体`ai-business-secretary`が同日中にこのバックアップを内包しさらに先行 |
| `web-health-check-lp` | 182MB | HEAD(`000f57b`)は本体`web-health-check.link`の祖先と確認。**台帳`repositories.json`の同名エントリの実体だったと判明**、noteを更新済み（best-trust側commit `51c9773`） |
| `hosino-romi` | 1.2GB | 大半はnode_modules等の再生成可能物。`surechigai-lite-handoff/`サブフォルダは本体ではなく別プロジェクト`surechigai-nico`（現在不使用の前身プロジェクト）のワーキングコピーで、未コミット差分6ファイルがあったが、push不要と確認しそのまま削除 |

削除前後で`ai-hub doctor`の`ok: true`を確認済み。`_pending-deletion-review/`ディレクトリ
自体も空になったため削除した。

## I. 第4弾: 台帳ドリフト修正＋孤立ファイル整理＋ai-shain導線の食い違い記録 ★2026-09-08完了

「フォルダを探すのに時間がかかる」という指摘の核心を再調査した結果、問題の一部は
**台帳（`best-trust/data/repositories.json`）が実態を反映していないこと**だったと判明。

### Step 1: 孤立ファイル削除（完了）

- github直下の`qa-results`: `surechigai-romi.link`・`doin-challenge.com`の
  `save-auth-state.mjs`等が本来出力すべき場所（各リポジトリ内、現在も稼働中）とは別に
  取り残された孤立コピーと確認し削除
- `Kali`: Kali Linuxとは無関係、AutoHotkeyの単発診断スクリプト1本のみと確認し削除

### Step 2: 台帳ドリフト修正（完了、best-trust commit `ce67c71`）

- `dns-osint-pro-ver2.0`: 削除・Archive化済みの実態に合わせ`isArchived: true`・
  `localPath: null`へ修正
- `gmail-secretary-extension`: `henshin-hisho`と同一製品と確認済みなのに未登録だったため
  `product: "henshin-hisho-gmail"`で新規登録
- `ouenmovie`: 稼働中プロダクトなのに未登録だったため新規登録
- `yukkuri`・`kimito-link-yukkuri-douga`・`kimi-no-oto`・`デルタもん`・`tegiwai-video`:
  `unclassified`で新規登録（総エントリ数44→53件）

### Step 3: ai-shain.link/ai-shain-worker導線の食い違い（記録のみ・要注意）

フォルダ統合の技術的必然性は無いと再確認したが、以下の**プロダクト課題**を発見:
- LPのCTAが「ChatGPT起点の4ステップ」を謳っているが、実装済みなのは
  LINE/GitHub Issue起点のフローのみ（ARCHITECTURE-personal-ai-employee-first.mdに
  「ChatGPT入口は未着手」と明記）
- GitHub PATが2026-08-14失効予定と明記されており、現在（9/8）既に失効している可能性
- 直近15コミットが`ai-shain.link`側で全て動画デモ制作関連に向いており、AI社員本体・
  導線改善への言及が無い
- これはフォルダ整理の対象ではなくプロダクト改修が必要な課題。対応するなら別途
  ai-shain.link/ai-shain-worker担当セッションで検討する

### Step 4: `sakkino.link`（要再検証・記録のみ）

以前「Cliborモバイル化の実装先（Flutter本体＋iOS/Androidネイティブキーボード）」と
判定していたが、READMEは"A new Flutter project."というデフォルトのまま放置されており、
この判定の根拠がREADME上では裏付けられないと判明。`lib/`等の実装コード自体を見た
再検証が必要（今回のスコープ外、次回持ち越し）。

## J. 第5弾: 残存Markdown4件削除＋henshin-hisho/gmail-secretary-extension共通化設計 ★2026-09-08完了

「実態は、コピペで連携されなかったりしたんですよね」というユーザー指摘をきっかけに、
`ai-business-secretary`と`henshin-hisho`を調べたところ、両者自体は別物だったが、
**`henshin-hisho`と`gmail-secretary-extension`の間に`triage.js`・`draft-gen.js`の
コピペ由来の重複コードがあり、コピー後に別々に進化して乖離していた**という実害を発見。

### Step 1: Markdown4件削除（完了）

- `ai-reply-draft-tool-DESIGN.md`・`-IMPLEMENTATION-HANDOFF.md`: 実装先
  `ai-business-secretary/scripts/`に該当ファイル実在確認、削除
- `best-trust-brand-strategy-DESIGN.md`・`-IMPLEMENTATION-HANDOFF.md`: 正本は
  `best-trust.biz/docs/`に存在、git履歴で実装完了確認済み、削除

削除前に`ai-hub doctor`で参照ゼロを確認済み。`ANTI-SLOP-ADOPTION-ASSESSMENT.md`・
`KIMITO-CLERK-UNIFICATION-PLAN.md`は現役と再確認し保持。`HANDOFF-*`3件は
index.json登録済みのため今回は据え置き。

### Step 2: 共通ロジック抽出の設計（設計完了、実装は次チャット）

`triage.js`のJSON修復関数群（`scanJsonFragment`等7関数）と`draft-gen.js`の
トーン定義（`DRAFT_TONE_INSTRUCTIONS`）が両リポジトリで一字一句近い形でコピーされ、
片方だけバグ修正（Gemma系モデル空白ループ対策）・機能追加（日次利用制限）が入り、
もう片方だけ別の機能（accountPolicy会社ポリシー）が入るという乖離を実測確認。
`risk-gate.js`は送信ゲートとDOM挿入ゲートという別責務と判明し共通化対象外。

設計方針（案A採用）: `web-ios-android/templates/shared/ai-triage/`に純粋関数のみの
共有モジュールを新設し、既存の`rollout-workflow.mjs`で両リポジトリへPR配布。
`check-drift.mjs`のPAIRSにも登録し今後の乖離を機械検知できるようにする。

- 設計書: `_docs/DESIGN-ai-triage-shared-module-2026-09-08.md`
- 実装ハンドオフ: `_docs/IMPLEMENTATION-HANDOFF-ai-triage-shared-module-2026-09-08.md`

## K. 第7弾: 新顔16件の調査＋removalバックアップ確保 ★2026-09-08一部完了

**状態: removalのバックアップ確保は完了。軽量5件の削除は本人確認待ち（未実行）。**

github直下がスクリーンショットで82項目確認され、A〜Jで扱っていない「新顔」16件が
見つかった。Exploreエージェントで全件調査済み（司令塔が実測裏取り）。

### 完了: removalのバックアップ確保（実行済み）

`removal/`（Google評判総合コンサルパックLP＋提案書PDF/PPTX）は、GitHub上に
`kimito-link/removal`リポジトリの箱だけ存在し**一度もpushされず空（`isEmpty: true`）**、
ローカルにも`.git`が無い状態だった＝PCが壊れたら本体が消えるリスクがあった。
`.gitignore`に`node_modules/`を追加（既存の`.env*.local`・`.vercel`除外は妥当と確認）した
上でgit init→初回コミット→push。GitHub側`isEmpty: false`・`defaultBranchRef: main`を
実測確認済み（コミット`0db2893`）。

### 判定済み・現役なので触らない（7件＋姉妹プロジェクト1件）

`compass`（富士山コンパスPWA）・`kimito-Link-Voice`（声優マッチング、直近コミット
2026-09-07）・`kimito-link-reply-suggest`（AI返信サジェストv7.5.0、直近2026-09-07）・
`kimitolink-linktree`（リンクまとめ、直近2026-09-08＝本日）・`patents`（特許出願管理
ハブ）・`pincers`（Google口コミ成果報酬LP、直近2026-05-26で停滞気味）・`rolex`
（ロレックス応募補助アプリ、自動応募ではなく入力補助のみと確認）は、いずれもgit
remoteが`kimito-link`オーナーを指す独立現役プロジェクトで重複なしと確認済み。
`tsuioku-no-kiroku`（AI外部記憶MCP）は`tsuioku-no-kirameki.com`（ニコ生配信コメント
拡張）とREADME内に「姉妹作」と明記されており別プロダクト、重複ではない。

### 削除完了（本人確認済み・実行済み）

以下5件は使い捨て・実験残骸と判定（依存ゼロ、合計約130KB）し、本人確認を得て削除した:
`Qwen3.6-35B-A3B`（ローカルLLMセットアップ残骸）・`_handoff_line_webhook.txt`
（2026-08-27付の使い捨て引き継ぎメモ）・`check_projects.sh`（調査用シェルスクリプト）・
`claude-token-saving-council.json`（会議ログ）・`grok-build`（未コミットの実験用
サンドボックス）。削除前後で`ai-hub doctor`の`ok: true`・`problems: []`を確認済み。

`_backups/`（3.6MB、`kimitolink-line-line-fix-20260817.bundle`）は
`_handoff_line_webhook.txt`と関連する**本番修復用バックアップ**のため保持推奨
（削除候補には含めない）。`knowledge/`（4KB、`context/working-rules.md`）は
現役の参照用ドキュメント置き場のため削除候補ではない。

## L. 第8弾: ドキュメント/実態のズレ是正3件 + Antigravity実装担い手化 ★2026-09-08完了

**状態: 完了・各リポジトリへpush済み。** 「まだ散らかっている」「抜け漏れが多すぎる」という
繰り返しの指摘を受け、`ai-shain.link`/`ai-shain-worker`、`web-health-check.link`/
`web-health-check-app`の2ペアをExploreエージェントで再調査した。

**結論: フォルダ分割そのものは適切**（LP/アプリ本体という技術的分離に合理性あり）。
「散らかって見える」の正体は、ドキュメントと実態のズレ・旧リポの残骸放置だった。

### Step 1: web-health-check-app/extension の旧リポ残骸削除（完了、コミット`7ca3827`）

`extension/`のgit remoteに`ext-kimito → ../dns-osint-pro-ver2.0`という、**第7弾までに
削除済みの旧リポジトリへのローカルパス参照が残っていた**。`package.json`の`name`も
`"dns-osint-pro-ver2.0"`のまま、`docs/00_INDEX.md`も「dns-osint-pro-ver2.0プロジェクトの
詳細ドキュメント」を名乗っていた。`SESSION_START.md`は「作業日: 2025年1月27日」
「作業場所: `\\wsl$\Ubuntu\home\info\projects\dns-osint-pro-ver2.0`」という、
1年半以上前の旧WSL環境向け引き継ぎメモで、直近コミット（v8.6.158）と全く整合しなかった。

削除した26件: `HANDOVER_2026-05-13_*.md`(3件)・`SESSION_START.md`・
`DOCUMENT_STRUCTURE.md`・`WSL_WORKFLOW.md`・`OPEN_WSL_PROJECT.md`・
`CONTRIBUTING.md`・`CONTRIBUTORS.md`・`create-zip-v8.0.0〜v8.6.30.ps1`(13件、
現行は`build-zip.ps1`)・`STORE_DESCRIPTION_v8.0.4.md`・`RELEASE_NOTES_v8.0.3.md`・
`docs/00_INDEX.md`・`copy-files.ps1`（存在しない旧パスへコピーする無効スクリプト）。
`package.json`の`name`/`repository`/`bugs`/`homepage`も実リポジトリに修正、
git remote `ext-kimito`も削除。CI（`.github/workflows/`）からの参照ゼロを確認済み。

### Step 2: web-health-check-app/README.md の現状更新（完了、Step 1と同時push）

「Phase 0完了、診断機能はPhase 2以降」という記述のまま放置されていたのを、実態
（v8.6.158稼働中、2ブランド×4プラットフォームのSSOT、CLAUDE.mdの「100年設計」節に
準拠した構成説明）に全面更新。既存の`docs/handoff/`（P0〜P5まで実在確認済み）への
案内も追加。

### Step 3: ai-shain.link/chatwork と ai-shain-worker の関係を再調査（完了）

★**当初の前提が調査で覆った**: Explore調査時点では「同じ機能（Chatwork自動化）の
別実装」と判定していたが、実際に`ai-shain-worker/tests/chatwork-*.spec.js`と
`HANDOFF-chatwork-video.md`を読んだところ、これは**LP用デモ録画作成のための実験
コード**であり、しかも「本番LPに第三者の個人情報を公開する事故」（動画11秒地点で
氏名・所属・顔写真・招待リンクのトークンが判読できる状態）を起こして**方針自体が
撤回済み**（代替の`ouenmovie/chatwork-intro/`自作図解方式へ移行済み）と判明した。

一本化ではなく、撤回済み実験コードの削除が正しい対応と判断（本人確認済み）。
`ai-shain-worker`から10件のspec.js＋関連生成物8件（`.auth/chatwork-state.json`・
`dist/chatwork-*.mp4`等）を削除（コミット`1b98dab`）。`ai-shain.link/chatwork/`
（CDP接続・5関門・承認カード付き、2026-08-17実装）は本番運用中と確認し触っていない。

`ai-shain.link`ルート直下に散らばっていた`CODEX-HANDOFF-*.md`(10件)・
`FABLE-DESIGN-*.md`(9件)、計19ファイルは`docs/`配下へ移動（`git mv`、内容変更なし、
コミット`2977d12`）。

★教訓: Explore調査結果（サブエージェントの要約）を鵜呑みにせず、実装の中身
（`HANDOFF-chatwork-video.md`のような経緯文書）まで司令塔が読み直したことで、
「重複だから一本化」という誤った対応を避けられた。**「同じ名前・同じ対象システムを
触っている」だけでは重複と断定しない**——実際に何をしているか・現在も有効な方針かを
確認してから対応方針を決める。

### Step 4: Antigravityを実装担い手として正式化（完了、新規ファイル）

Google製・VSCodeベースのagentic IDE「Antigravity」（このPCに`.antigravity-ide`として
インストール済み、2026-09-05まで使用実績あり）を、council-fableの「手順3: 実装は
別モデル」の選択肢として正式化した。

既存2実例から書式を抽出:
- 依頼プロンプトの書式（`sakkino.link/ANTIGRAVITY-CI-PROMPT.md`）: 作業ディレクトリ
  明示→正本を読ませる→案件固有の差分→やること→絶対にやらないこと（実行系の禁止）→
  人間にしかできない関門→検証基準
- 知見レポートの書式（`kimitolink-linktree/docs/AI_ANTIGRAVITY_REPORT.md`）:
  ❌アンチパターン（過去）→✅解決策（現在）→AIへの指示、次の保守担当AI向け

新設: [`docs/ai-workflows/ANTIGRAVITY-HOWTO.md`](../docs/ai-workflows/ANTIGRAVITY-HOWTO.md)。
[`FABLE-3STEP-HOWTO.md`](../docs/ai-workflows/FABLE-3STEP-HOWTO.md)の「手順3」から
橋渡し1行を追加済み。今回は方針とHOWTOの正本化まで、個別プロジェクトでの実装作業
そのものは次回以降。

## 現時点のまとめ

A〜Lまで完了。github直下の重複リポジトリ・散らばったMarkdown・調査残骸・台帳
ドリフト・空リポジトリ放置・軽量残骸・ドキュメント実態ズレの整理整頓は一区切り。
残っているのは以下のみ:
- `linebot`とline-harness-ossの統合要否（本人確認待ち、台帳に記録済み）
- `nicolive-dl-master`・`tegiwai-video`内の重いバイナリ（動画・素材データ）の要否確認
- `manus`等の小粒項目の最終削除判断（本人確認が望ましい）
- `sakkino.link`の実装内容の要再検証
- **henshin-hisho/gmail-secretary-extension共通モジュール化の実装**（設計・ハンドオフ完了、
  次チャットで別モデルが実装）
- **Antigravityでの個別実装作業**（HOWTO正本化のみ完了、実際の委任作業は次回以降）
- 本セッション終盤にユーザーからノートPC（BESTTRUST、Panasonic CFFV5-1）・iPad Air (M3)・
  もう1台のデスクトップPCの情報提供があった。マルチデバイス構成の全体整理は次回以降
  （今回のスコープには含めていない）

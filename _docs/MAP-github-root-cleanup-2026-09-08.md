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

### `_pending-deletion-review/`（2.9GB、ユーザー同席が必須・今回未着手）

直下7件: `kimito-link-clone`(506MB)・`kimito-link-fresh`(701MB)・`kimito-link-github-download`(345MB)・
`hosino-romi`(1.2GB)・`compass-temp-clone`(40MB)・`gpthisho-admin-api-backup-20260713-052940`(35KB)・
`web-health-check-lp`(182MB)。中身を1つずつ画面共有しながら判断する（推測で重複と決めない）。

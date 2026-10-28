<!--
  web-ios-android をプロジェクトで管理するための引き継ぎ。
  正本フォーマット: CLAUDE.md「デスクトップ／ノートPC・複数AI共通の開発継続ルール」節
  ＋ templates/handoff/handoff.md.example。
  役割: 「作業の中身そのもの」（状態・原因・変更・テスト・次の一手）。
  ロック調整(.agent/coord.md)とは別物。
  新しいスレッド/セッションは、まずこの1枚と _docs/DESIGN-overall-design-council-2026-10-21.md を読む。
-->

# Handoff — web-ios-android（AI開発総合ルール正本＋ストア申請自動化キット）

STATUS: 進行中（複数スレッド。下の「開いているスレッド」参照）
ROOT_CAUSE: -（バグ修正ではなく「全体設計の会議→実装」と派生タスク群）
LAST_WORKED_ON: 2026-10-21T03:10:00Z
WORKED_BY: claude-cloud（Opus／session_01F4N5YRVNWo4Cg2PpW96tjB）／ブランチ claude/charming-knuth-is4kx6
MACHINE_NOTES: ★このセッションはクラウド（/home/user）。ここからは deploy 不可（`../ai-hub` 無し・Cloudflare/Wrangler 認証無し・wrangler 無し）＝本番反映と `~/.claude/skills/` の読取りは PC 側でしかできない。

## このプロジェクトは何か（1行）
AI開発の総合ルール（CLAUDE.md＝設計の心臓部）と、Chrome拡張/Web/iOS/Android のストア申請自動化キットを束ねた横断開発基盤。設計方針 = 事業指標の最大化（北極星 LTV÷CPA・正本 docs/ai-rules/07_GROWTH_METRICS.md） × 100年メンテナンスフリー（コード構成は 01_CORE_RULES §2-1） × 商品インパクト。

## 開いているスレッド（プロジェクトのスレッドに割るならこの単位）

### スレA: PR #101「全体設計 会議バックログ P0–P10＋デザイン名前翻訳プロンプト」
- 状態: **open・CI緑・mergeable_state: clean**（コンフリクト無し）。レビュー/マージ待ち（人の確認）。
- URL: https://github.com/kimito-link/web-ios-android/pull/101 （base: main / head: claude/charming-knuth-is4kx6 / 13 commits・27 files・+1582/-90）
- 内容: P0 ratchet予算hook／P2 dispatcher不採用＋既存check-hooks-wiredにnpm配線／P3 結末台帳(冪等・fail-open・末尾64KiB走査)／P4 配信HTML宣言検査＋lp/をunlisted宣言／P5 _preamble単一注入／P6 否定形hint-box是正／P7 warn-long-running 1回/セッション／P9 FABLE ハンドオフ契約／P10 JIT三層設計／追加: DESIGN-NAMING-PROMPT.md。
- NEXT_ACTION: ①人がレビュー→マージ ②**PC側で本番反映**: `git checkout claude/charming-knuth-is4kx6 && git pull && npx wrangler login（初回のみ）&& npm run deploy:site`。終わったらクラウドセッションに「done」と伝えれば本番URLのマーカー（_preamble・unlisted・composeCopyText・「じゃないよ」消失）を再取得して確認する。
- 監視: 作成セッションが `subscribe_pr_activity` で #101 を見張り中（CI/レビュー/マージのイベントで起床）。安全網チェックインも armed（約50分→以降4時間間隔・変化無しなら静かに再アーム）。

### スレB: appstore-preview-video スキルの格上げ（★ブロック中）
- 目的: 個人設定 `~/.claude/skills/appstore-preview-video/SKILL.md`（261行・git管理外）を repo の `.claude/skills/` へ格上げし共有化。前例 self-verification と同型（precedence Enterprise>Personal>Project ＝ **両方に置く・personalは消さない**）。
- 確定済みの手順（再設計しない）: ①repo に `.claude/skills/appstore-preview-video/SKILL.md` を作成（personal版の内容そのまま）②`_docs/instruments/check-drift.mjs` の PAIRS に self-verification(L660-663)と同型エントリ追加（canonical=repo側・copies=homedir側）③`node _docs/instruments/check-drift.mjs` で登録確認 → commit/push（同ブランチ＝PR #101 に乗る）。
- **BLOCKER**: 261行の SKILL.md 本文がクラウドに無い（`find /` で不在を確認済み・PC固有）。**ユーザーが本文をペースト/添付したら即実行**。でっち上げはしない。

### スレC: 人の手を使わない全体設計（2026-10-28）
- 本人指示「全体設計として人間の手は使わない設計で」。正本 `docs/ai-rules/08_NO_HUMAN_HANDS.md`＋CLAUDE.md 冒頭★★★＋設計決定書「人の手を使わない」節。
- 状態: 規則と棚卸しを下書きPR（ブランチ claude/project-thread-r1yp3s）。NEXT_ACTION: マージ後、人に渡すスクリプトの金型（状態ファイル・Enter待ちなし・再開可・英数字 .cmd）を `templates/` に作り、機械検査へ。

### 据え置き（意図的・順序原則。蒸し返さない）
- P1 バッチ2(これ以上): 核が 370/450 で余裕＝追加移設は churn。
- P8（commit-verification を block 昇格）: P3 台帳に deny 実データ0件＝FP率が出ないため、データが溜まるまで保留。

## FILES_CHANGED（PR #101・主なもの）
`.claude/hooks/`（check-claude-md-budget-ratchet / guard-external-actions / require-claude-md-read / check-ask-preceded-by-research / warn-long-running-session ＋ lib/outcome-ledger-core・record-outcome と各 .test.mjs）／`scripts/verify-served-html-declared.mjs`／`.served-html-baseline.json`／`site/`（index.html・scripts/ai-box.js・assets/data/ai-instructions.json・sitemap/sitemap-manifest.json）／`docs/ai-workflows/`（FABLE-3STEP-HOWTO・DESIGN-NAMING-PROMPT）／`_docs/DESIGN-overall-design-council-2026-10-21.md`・`DESIGN-jit-injection-three-tier-2026-10-21.md`／`CLAUDE.md`（核 431→370）・`package.json`。

## CHANGES（一言）
会議の裁定を P0–P10 で実装（新基盤を増やさず既存hook/検査/HOWTOを正しい順で接続）＋デザイン名前翻訳プロンプト正本化。100年設計の自己監査で P3 の無限肥大リスクを末尾走査で根治。

## TESTS_RUN / TEST_RESULT
`npx vitest run .claude/hooks/ site/scripts/`＝緑／各 `--selftest`（served-declared・hooks-wired 等）＝OK／`check-claude-md-budget.mjs`＝核370/450 OK／CI(verify.yml: `npm run verify`)＝**success**。★既知の pre-existing（本件無関係・このcloneの生成物欠落）: `templates/expo-native/asset-name-collision.test.ts`(assets未生成)・`verify-internal-links` の `/hub/status/`。CI(verify.yml)はvitestを走らせないのでCIは緑。

## REMAINING_RISKS
- 本番反映(deploy)未実施＝公開サイトは旧版のまま（PC側 deploy 必須）。
- スレB は本文待ちで未着手。
- P3 の FP率データはこれから蓄積（P8 はそれ待ち）。

## 継続の作法（新スレッドが最初に読むもの）
1. この `handoff.md`。
2. `_docs/DESIGN-overall-design-council-2026-10-21.md`（各項目 ✅/⏸ と根拠＝status正本）。
3. 並列で動くなら `.agent/coord.md`（ロック）。commit/push 前に必ず読む。
4. 外向き操作(push/merge/deploy)の前は guard-external-actions hook の条件（CLAUDE.md全文Read・coord接触・PRチェック緑）を満たす。

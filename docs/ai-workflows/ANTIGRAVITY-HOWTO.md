# Antigravity 活用HOWTO — 正本

**状態: 方針確定・実例2パターンから抽出済み。2026-10-21 に役割分担・守りの設定を更新（段階1=文書・橋渡し・鍵は完了／段階2=`agy` 自動呼び出しは PC で未確認）。**
今後Antigravityに実装作業を委ねるときはこの1枚を読み、書式を流用する。コピーは作らない（散らすと同期がずれて事故る）。

- 設計: 司令塔。日付: 2026-09-08
- きっかけ: ユーザーが有料契約しているAntigravity（Google製・VSCodeベースのagentic IDE）を
  実装作業の担い手として正式にこのキットへ組み込みたいという要望。既に複数プロジェクトで
  実績があったが、書式が正本化されていなかった
- 保存先の相互参照: 本ファイル（Antigravity専用） ← [`FABLE-3STEP-HOWTO.md`](FABLE-3STEP-HOWTO.md)
  の「手順3: 実装は別モデル」から参照される（Antigravityはこの「別モデル」の選択肢の1つ）

## 用語（この文書だけで通じる略称の説明）

- **Antigravity**: Google製のVSCodeベースagentic IDE。このPCには`.antigravity-ide`として
  インストール済み（2026-09-08時点で直近使用実績あり）。対話的にファイルを見ながら
  試行錯誤できる点が、バッチ的な「次チャット」との違い
- **council-fable**: 無料マルチLLM会議→Fable(claude-fable-5-1)設計→実装ハンドオフ、の
  3段構えワークフロー（[`FABLE-3STEP-HOWTO.md`](FABLE-3STEP-HOWTO.md)が正本）。Antigravityは
  この「手順3: 実装」を担う選択肢の1つ

## 2026-10 時点の事実（公式ドキュメントで確認、2026-10-21）

9月時点の前提（「IDE に人が貼るしかない」「Opus 4.6/Sonnet 4.6」）は古くなった。出典は各行のリンク。

| 項目 | 事実 |
|---|---|
| コマンドライン版 | `agy` がある。`agy -p "..."` で1回実行して終わる（headless）。`--model <slug>`・`--output-format json`（`status`/`response`/`usage`）・失敗時は非0終了。slug は `agy models` で見る（[headless](https://antigravity.google/docs/cli/headless/)） |
| 読むルール | `AGENTS.md`・`GEMINI.md`・`.agents/rules/*.md` だけ。**CLAUDE.md は読まない**。触るファイルの階層からワークスペースのルートまで遡って読む。全体用は `~/.gemini/AGENTS.md`。1ファイル24KB・常時ルール合計2万トークンまで（[rules](https://antigravity.google/docs/rules/)） |
| モデル（Pro・有料・トライアル以外） | Claude Opus 5.5 / Sonnet 5.5（Thinking）、Gemini 4 Argon（**IDE では使えず、アプリと CLI のみ**）、Gemini 3.8 Flash。**Opus 4.6・Sonnet 4.6・GPT-OSS 120B は 2026-11-02 に廃止**（[models](https://antigravity.google/docs/models/)） |
| 使用枠 | 「Gemini」と「Claude・GPT」の2つの財布。それぞれ5時間ごと＋週ごとの上限。**Claude Code の週間上限とは別**。超過は「AI Credit Overages」（Never/Always）で AI クレジット払い（[plans](https://antigravity.google/docs/plans/)）。残りは `/usage` |
| Turbo | モデルではなく**権限の設定**。サンドボックス無し・コマンド無制限・全ファイル書き込み可（[permissions](https://antigravity.google/docs/permissions/)） |
| 権限 | `~/.gemini/antigravity-cli/settings.json` の `permissions.allow/ask/deny`（書式 `command(...)` 等、優先は Deny > Ask > Allow）。headless では Ask は自動で拒否され、終了コードは0のまま（[permissions](https://antigravity.google/docs/permissions/)・[headless](https://antigravity.google/docs/cli/headless/)） |
| 検証向け機能 | `/browser <task>`（ブラウザ担当の子エージェントで画面確認）、`/planning`、`/goal`（[CLI reference](https://antigravity.google/docs/cli/reference/)） |

## 役割分担（2026-10-21 りんくさん承認・段階導入）

Claude の週間上限は「判断・検品・外へ出す操作」だけに使い、手を動かす仕事は Google 側の2つの財布へ回す。
使い分けの軸は「人手が要るか」から「どの財布が空いていて、どれだけ賢さが要るか」へ移る（`agy` 自動呼び出しが PC で通ったら完全に移る）。

| 担当 | 任せる | 任せない | 財布 |
|---|---|---|---|
| Claude Code（司令塔） | 切り分け・引き継ぎ書・戻った差分を**実際に動かして**検品・push/PR/マージ/デプロイ | 大きな実装そのもの | Claude 週間上限 |
| Fable | 設計だけ（[`FABLE-3STEP-HOWTO.md`](FABLE-3STEP-HOWTO.md)） | コード | Claude 週間上限 |
| Antigravity × Claude Opus 5.5 | 判断が要る重い実装＋テストまで一貫 | push・デプロイ・秘密の登録 | Google「Claude・GPT」 |
| Antigravity × Claude Sonnet 5.5 | 中くらいの実装・定型修正・テスト追加。Opus 枠切れの代わり | 同上 | Google「Claude・GPT」 |
| Antigravity × Gemini 4 Argon | Claude と違う頭脳としての設計レビュー・反対意見、`/browser` で画面確認、大きなコードの読み通し（アプリか CLI で） | 同上 | Google「Gemini」 |
| Antigravity × Gemini 3.8 Flash | 文章・ドキュメント・軽い一括修正。Grok/Qwen の枠切れ時の退路 | 判断が要る仕事 | Google「Gemini」 |
| GPT-OSS 120B | 使わない（2026-11-02 廃止） | — | — |

## 引き継ぎの流れ（新しい形式は作らない）

1. **Claude Code が引き継ぎ書を書く**: 下の「実例1」の7項目＋[`FABLE-3STEP-HOWTO.md`](FABLE-3STEP-HOWTO.md)「ハンドオフ契約」（事実・ゴール・制約は渡す／未確証の見立ては渡さない・冒頭1文）＋機械判定できる完了チェックリスト＋**使うモデル名**。
2. **Antigravity を専用ブランチで動かす**: 今は本人が引き継ぎ書のパスを貼る。段階2では Claude Code が `agy -p` で自動で呼ぶ。
3. **Antigravity は commit で止まる**: push 等は下の「鍵」で拒否。終わったら `handoff.md` の STATUS・TESTS_RUN・TEST_RESULT・REMAINING_RISKS を埋める（リポ直下の [`AGENTS.md`](../../AGENTS.md) がそう指示する）。
4. **Claude Code が検品して外へ出す**: 差分を読むだけでなく実行する。ここで初めて `guard-external-actions` 等の hook が効く。
5. **設計が割れたら Argon に反対意見を出させる**: 同じ事実を渡して「この設計の一番弱い所は」と聞き、Claude Code か Fable が裁定する。

## 守りの設定（Turbo のままでは危ない）

Claude Code の hook（`.claude/hooks/`）は Antigravity には効かない。Turbo のままだと Antigravity は**キットのルールを知らず、`git push` もデプロイも止まらない**。次の2つで塞ぐ。

1. **ルールの橋渡し**: リポ直下の [`AGENTS.md`](../../AGENTS.md)（CLAUDE.md を core:end まで読め・外向き操作禁止・ハンドオフ契約・handoff.md へ報告、の入口だけ）。
   ほかのリポにも効かせるため、**PC の `~/.gemini/AGENTS.md` にも同じ内容を置く**（パスは `../web-ios-android/CLAUDE.md` に読み替える）。PC ローカルで git に載らないので、新しい PC では手で足す。
2. **鍵（拒否リスト）**: `~/.gemini/antigravity-cli/settings.json` に次を入れる（Deny は Allow より優先＝Turbo でも止まる想定）。

```json
{
  "permissions": {
    "deny": [
      "command(git push)",
      "command(gh pr merge)",
      "command(gh secret)",
      "command(gh workflow)",
      "command(gh release)",
      "command(vercel)",
      "command(wrangler deploy)",
      "command(npm run deploy:site)",
      "command(npm publish)"
    ]
  }
}
```

- ★公式ドキュメントには `git push` を**拒否**する例が無い（許可の例 `command(git push)` / `unsandboxed(git push)` はある）。書式どおりなので効くはずだが、**PC で実際に `git push` させて弾かれるのを確かめるまでは「未確認」**。IDE・アプリの Turbo にこの CLI 設定が効くかも未確認。
- 「AI Credit Overages」は **Never** のままにする（自動で呼ぶ以上、枠切れで止まる方が安全。`ai-generic-rules/docs/policies/COST_SAFETY_POLICY.md` と同じ考え方）。

## 段階2: Claude Code から自動で呼ぶ（PC で未確認・未実装）

PC で次の3点を確かめてから、`tools/dispatch.py` に `--brain agy` を足す（headless・`--output-format json`・`--model`）。

1. `agy` が入っているか（`agy --version`）、`agy models` に Claude Opus 5.5 / Sonnet 5.5 の slug があるか
2. 上の拒否リストで `git push` が実際に弾かれるか
3. headless で書き込みとテスト実行を許すための `permissions.allow`（例: `write_file(src/)`・`command(regex:npm run (build|lint|test))`）がジョブ方式の worktree で通るか

通ったら、[`MULTI-BRAIN-HOWTO.md`](MULTI-BRAIN-HOWTO.md) §1c と `CLAUDE.md`「セッション開始時の必須アクション」5番の「本人の確認を待ってから本人が手動で投げる」を「司令塔が `--brain agy` で投げる」に改める。

## Antigravityを使う場面（次チャット/別モデルとの使い分け）

| 状況 | 選ぶもの |
|---|---|
| 実装ハンドオフ1枚で完結する、バッチ的な作業 | 次チャット/別モデル（`FABLE-3STEP-HOWTO.md`のまま） |
| IDE上でファイルを見ながら試行錯誤したい、対話的な配線作業 | **Antigravity** |
| 既存キット（web-ios-android）の手順書を読み込ませて横展開する作業 | **Antigravity**（実績あり、下記参照） |

## 実例1: 依頼プロンプトの書式（`sakkino.link/ANTIGRAVITY-CI-PROMPT.md`が実例）

Antigravityに貼るプロンプトは、以下の構成にすると欠落なく伝わる:

1. **作業ディレクトリを明示**（絶対パス）。何のプロジェクトかを1〜2文で要約
2. **正本の場所を最初に読ませる**（このキットなら`_docs/release-pipeline-playbook.md`等、
   案件が依拠する既存ドキュメント一式へのパスを列挙し「必ず先に読むこと」と明記）
3. **この案件の特殊事情**（キットの標準パターンとの差分。ここを外すと壊れる、という警告付き）
4. **やること**（AIで完結できる範囲を番号付きで具体的に）
5. **絶対にやらないこと**（実行系の禁止——push・実際の外部提出・secret登録の実行等、
   人間の承認が要る操作を明記）
6. **人間にしかできない関門**（Antigravityにやらせず「手順書に落とすだけ」と明記する）
7. **検証・完了報告の基準**（何をもって完了とするか、機械的に判定できる形で）

## 実例2: 知見レポートの書式（`kimitolink-linktree/docs/AI_ANTIGRAVITY_REPORT.md`が実例）

Antigravityが実装作業中に見つけた「一般的な静的解析では検知できないアンチパターン」を、
次にこのプロジェクトを保守するAI（Cursor・GitHub Copilot・Claude Code等）向けに書き残す形式:

```markdown
## N. 見出し（テーマ名）

### ❌ アンチパターン（過去）
（具体的に何が問題だったかをコード付きで）

### ✅ アンチグラビティの解決策（現在）
（修正後のコードと、なぜそれが正しいか）

> **AIへの指示**: 以降、〇〇は絶対に使用しないでください。代わりに〜。
```

**対象読者**は冒頭に明記する（「今後このプロジェクトを保守・開発するすべてのAIアシスタント」）。

## 使うときの注意

- Antigravityへの依頼プロンプトも、実装ハンドオフと同様に**司令塔が実在パス・コマンドを
  裏取りしてから渡す**（Fableの設計と同じく、Antigravityの出力も鵜呑みにせず検証する）
- Antigravity側で見つかった知見（実例2の形式）は、案件固有のプロジェクト内`docs/`に置く。
  横断的に価値がある知見（複数プロジェクトで再発する類のもの）は、通常の「知見は書き戻す」
  運用（`../ai-hub/CLAUDE.md`のharvestの掟）に従い`ai-hub`側へharvestする

## 実績

- **2026-07-08、ai-health-check.link PR #8**: council-fableの3段構えで会議→Fable設計まで
  終えたあと、実装ハンドオフ1枚をAntigravityに渡したら完走し、Claudeが実機検証してPR化
  するところまで到達した（`FABLE-3STEP-HOWTO.md`の実績セクションに記録済み）。ハンドオフに
  「機械的な完了判定チェックリスト」を付ける形式が有効だったのはこのときの実証
- **sakkino.link**: CI配線・ストア提出フェーズの配線作業をAntigravityに委任する依頼書
  （`ANTIGRAVITY-CI-PROMPT.md`）を作成。実行系（push・提出・secret登録）は明確に除外し、
  配線とdry-runまでに限定する書き方をした
- **kimitolink-linktree**: Next.js App Router特有のHydration/SSRF系アンチパターンを
  Antigravityが修正した際、次の保守担当AI向けに知見レポート2本
  （`AI_ANTIGRAVITY_REPORT.md`・`AI_ANTIGRAVITY_REPORT_2.md`）を残した

---
*2026-09-08作成／既存2実例（sakkino.linkの依頼プロンプト、kimitolink-linktreeの知見レポート）
から書式を抽出して正本化。`FABLE-3STEP-HOWTO.md`と対の関係（設計はFable／実装の選択肢の1つがAntigravity）。*

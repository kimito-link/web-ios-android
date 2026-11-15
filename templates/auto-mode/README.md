# auto mode に「本人の言葉」を先に入れておく（2026-11-16）

りんくの全体ルール「人間に確認を求めない」（2026-11-16、CLAUDE.md 核「確認なしでやってよいこと」表・プロジェクト指示7番）を、
Claude Code の**自動の安全確認（auto mode の分類器）**にも届けるためのひな型。

## なぜ要るか

- 11/15、会議名簿の PR（tsuioku #650）はチェックが全部緑だったのに、PC の Claude Code が auto mode の
  既定ルール **Merge Without Review**（人のレビュー前のマージを止める）で止まり、「マージして」の一言をりんくに頼んだ。
- auto mode は CLAUDE.md やプロジェクト指示を「本人の許可」として読まない。読むのは会話の中の本人の言葉と、
  **`~/.claude/settings.json` の `autoMode`** だけ（公式: https://code.claude.com/docs/en/auto-mode-config ）。
  ★リポの `.claude/settings.json` の `autoMode` は**読まれない**（公式に明記）。だからユーザー設定に入れる。

## 何を入れるか（[`rules.json`](rules.json)）

- `environment`: github.com/kimito-link の全リポを「本人の・信頼できるリポ」とする
- `allow`:
  1. チェックが全部終わって失敗ゼロの PR のマージは、本人の常設の許可がある（名簿・docs・hook・設定の PR も含む）。
     赤・実行中・`--admin`/force・ブランチ保護の迂回は含めない
  2. 作業ブランチの push・PR の作成/更新/準備完了、マージで動く無料の自動デプロイは同じ許可で進める
- **既定の決まりは `"$defaults"` で全部残す**。お金・削除・secret・ストア提出・外への投稿は既定どおり止まる（本人の例外のまま）。

## 入れ方

```
node templates/auto-mode/install.mjs          # ~/.claude/settings.json に足す（.bak-auto-mode を作ってから）
claude auto-mode config                       # 入ったか確かめる（kimito-link standing rule の文が見える）
```

- 何度走らせても同じ（marker `[kimito-link standing rule]` の古い文は入れ替える）。
- 置き場所: 会社PC（besttrust）・レッツノート（besttrust-note）・クラウドの「デフォルト」環境（setup script が main から取って走らせる）。
- ★**PC では AI が自分で入れられない**（2026-11-16 実測）。AI が install.mjs を走らせると、チャットでりんくが操作と場所を名指しして
  承認した後でも、auto mode が「Undermining Oversight（監督を弱める操作）」で必ず拒否した（会社PC・クラウドとも）。
  だから PC では、りんくが PowerShell で次の1行を1回だけ実行する（会社PC・レッツノートは 11/16 実行済み）。AI は承認を集め直さず、この1行を渡す。

  ```
  $d="$env:USERPROFILE\.claude\auto-mode"; mkdir -Force $d | Out-Null; $b="https://raw.githubusercontent.com/kimito-link/web-ios-android/main/templates/auto-mode"; curl.exe -fsSL "$b/install.mjs" -o "$d\install.mjs"; curl.exe -fsSL "$b/rules.json" -o "$d\rules.json"; node "$d\install.mjs"
  ```

  入ったかの確認（読むだけ）は AI が Remote Control で `claude auto-mode config` を読めば通る。
- クラウドは「デフォルト」環境の setup script が新しいコンテナで install.mjs を走らせる（人の操作なし）。

## 守らせる側

- `.claude/hooks/check-human-handoff.mjs`: 人に確認・許可・選択を求める文と選択肢カード（request_decision・AskUserQuestion）を、
  「確認が要る理由: お金／消す／戻せない／自動の安全確認」の一行なしでは拒否する。

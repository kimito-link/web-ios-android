# frontend-design スキルの取り込み（2026-10-31）

> **今の到達点: 取り込み済み（下書きPR・りんくのOK待ち）。** マージ後、各PCの `~/.claude/skills/frontend-design/` へコピーすれば全プロジェクトで効く。

## 何をしたか

- きっかけ: りんくが X の投稿（Anthropic 公式「Frontend Design」スキル、`npx skills add github.com/anthropics/skills --skill frontend-design`）を見て「全体にいれて」。
- 投稿は二次情報なので、公式リポ本体 `https://github.com/anthropics/skills` の `skills/frontend-design/` を直接取得して中身を読んだ
  （取得時の公式 HEAD: `ca45fc496a3436251f191354091d557da31c15b5`）。
- 中身は `SKILL.md`（文章の指示だけ・71行）と `LICENSE.txt`（Apache License 2.0）の2ファイル。**実行されるスクリプト・外部への通信・hook は含まない**ことを確認した。
- 置き場所: [`.claude/skills/frontend-design/`](../.claude/skills/frontend-design/SKILL.md)。**無改変**（ライセンス表示を保つため・公式更新を差し替えだけで取り込むため）。
- このリポ流の読み替えは SKILL.md に書き込まず、CLAUDE.md（核）と AGENTS.md に書いた。

## スキルの要点（日本語）

1. 作る前に、題材・見る人・画面の役目を決める。
2. 方向性を小さな設計表にする: 色4〜6（名前つきhex）・書体と役割・配置（ASCIIの下書き）・原則。
3. その設計を「似た依頼なら誰でも出しそうな型」と比べ、ありがちな部分を直してから書く。
   ありがちな型の例: クリーム地＋テラコッタ、黒地＋蛍光1色、新聞風の細罫、同じ角丸カードの並び＋薄い影＋グラデ、
   全見出しの上の大文字ラベル・「A · B · C」・ボタン末尾の「→」。
4. 見せ場は1か所に絞る。動きは1回の演出に絞る。スマホ対応・キーボード操作・動きを減らす設定への配慮は黙って満たす。
5. 文言は使う人の言葉で。ボタンは何が起きるかを書く。エラーは謝らず、何が起きてどう直すかを書く。
6. 作ったら自分でスクリーンショットを撮って見直す。

## このリポ流の読み替え（CLAUDE.md 核に記載）

- スキルの「方向性をクライアントに確認する」→ **自分で決めて作り、決めた方向と理由を報告する**（人の手を使わない設計・08_NO_HUMAN_HANDS）。
- 各リポのブランド規定（`docs/brand/LOGO-RULES.md`・キャラ・既存のデザイン部品）が勝つ。スキル自身も「依頼の言葉が常に勝つ」と書いている。
- 既存の [`DESIGN-NAMING-PROMPT.md`](../docs/ai-workflows/DESIGN-NAMING-PROMPT.md)（曖昧な依頼をデザイン用語に翻訳して3方向を出す）とは役割が違う。
  あちらは「方向を言葉にする」、こちらは「方向を設計表にして、ありがちさを点検してから作る」。併用してよい。

## 全プロジェクトに効かせる仕組み

- Claude Code: `github/CLAUDE.md` が `@web-ios-android/CLAUDE.md` を読み込むので、CLAUDE.md 核の1節は全プロジェクトに届く。
  スキル自体を自動で呼ばせるには、各PCの `~/.claude/skills/frontend-design/SKILL.md`（Personal スキル）に置く。
  repo（正本）と ~（コピー）のずれは `_docs/instruments/check-drift.mjs` の PAIRS が見張る（`--strict-copies` で未配置も赤）。
- Codex / Antigravity / Cursor: このリポの `AGENTS.md` に同じ一節を書いた。

## 公式が更新されたとき

```bash
curl -sS -o .claude/skills/frontend-design/SKILL.md   https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md
curl -sS -o .claude/skills/frontend-design/LICENSE.txt https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/LICENSE.txt
git diff .claude/skills/frontend-design/   # 中身を読んでから取り込む（スクリプトや外部通信が増えていないか）
```
差し替え後、各PCの `~/.claude/skills/frontend-design/` をそろえ、`node _docs/instruments/check-drift.mjs --strict-copies` で確認する。

## 未確認・次にやること

- 各PCの `~/.claude/skills/frontend-design/` への配置（マージ後）。
- 実際にLPを1枚このスキルで作って、出来を確かめる（効き目の裏取り）。

# anything-frontend-art-direction スキルの取り込み（2026-11-23）

> **今の到達点: 取り込み済み（PR）。** 各PCへは `node templates/hooks-relay/install.mjs` がスキル一式を `~/.claude/skills/` へ写す（AI が Remote Control で走らせる）。

## きっかけと特定

- りんくが X の投稿（「実在作品と制作理由を判断材料に与えて、AIの似たようなUIを減らす」）を見て「全体のデザイン改善になるならいれて」。
- 投稿のリンクは途中で切れていたので GitHub を検索して特定: **`RNA4219/anything-frontend-art-direction`**（MIT・★79・2026-11-23 時点）。
  同じ作者の `anything-frontend-product-design` は同日作成で中身がほぼ空（README と骨組みだけ）なので見送り。中身が育ったら再評価する。

## 中身（読んで確かめたこと）

- 日本語のスキル。SKILL.md（入口と相談→資料の表）＋ references/ 17本（配色・書体・構図・描画・a11y・フォーム・性能・HCI研究・世界の作品案内）＋ checklists/ 4本＋ templates/ 11個（ブラウザー標準機能の小さなHTML見本）＋ data/typography（247作品・292記録の書体事例。CSV と SQLite）。
- 核の考え方: 新しい画面は、**近い役割の実在作品を自分で探し、制作者が理由を書いた原文と実物の画面を両方見て**から決める。全体の方向は「同じ中身で、字・地・線・画像の関係が違う2案」で比べる。色や下線だけの差では方向を比べたことにしない。見本の図が取れなければ「未確認」と書く。
- 安全: 実行されるスクリプト・hook・外部への通信は無い（`curl`・鍵・`eval` 等を検索して該当なし）。リンクは各仕様・制作記録への参照だけ。

## frontend-design との関係（重複ではなく補完）

| | frontend-design（Anthropic公式） | anything-frontend-art-direction |
|---|---|---|
| 主な問い | 方向を設計表（色・書体・配置・原則）にし、ありがちな型と比べて直す | その方向の**根拠**を実在作品と制作者の理由から取る・採否の条件で詰める |
| 強い所 | 「紫グラデ・角丸カード」等のAIっぽさの点検、見せ場を1か所に | 和文と欧文の書体選び・2案比較の採用条件・a11y/フォーム/性能の仕様出典 |
| 言語 | 英語 | 日本語（このリポの利用者・画面に合う） |

→ 両方を通す。順番は frontend-design で方向 → anything-frontend で根拠と書体・採用条件 → 作ってスクショで見直す。ブランド規定（LOGO-RULES・キャラ）が両方に勝つのは同じ。
衝突する指示は無い（anything-frontend の「好みが分かれるなら明記」は、自分で決めて理由を報告するこのリポの決まりと両立する）。

## 置き方（無改変・一部だけ）

- `.claude/skills/anything-frontend-art-direction/` に、上流コミット `f5df625` の SKILL.md・LICENSE・NOTICE.md・sources.md・references/・checklists/・templates/・data/ を無改変で置いた（約1.4MB）。
- 外したもの: examples/（画像・音源・書体を埋め込んだ作例 約6MB）・docs/（見本画像）・README.*。SKILL.md と references から参照されておらず判断に要らないため。記録は同フォルダの `UPSTREAM.md`（このリポで足した唯一のファイル）。

## 全プロジェクトに効かせる仕組み（根本の直し）

- 以前は repo の `.claude/skills/` を各PCの `~/.claude/skills/` へ写す仕組みが無く、frontend-design も「マージ後に各PCへ配置」が手作業の残りのままだった。
- `templates/hooks-relay/install.mjs` が、hook の配線と一緒に **repo の全スキルを `~/.claude/skills/` へ写す**ようにした（何度走らせても同じ結果・その PC だけの個人スキルには触らない）。新しいスキルを repo に足しても、install を走らせ直すだけで全PCにそろう。
- ずれの見張り: `_docs/instruments/check-drift.mjs` の PAIRS に SKILL.md と UPSTREAM.md を登録（上流を差し替えると UPSTREAM.md が変わるので、参照資料ごと古いままの PC も赤になる）。
- Codex / Antigravity 向けには AGENTS.md に同じ一節。

## 上流が更新されたとき（AI がやる）

```bash
git clone --depth 1 https://github.com/RNA4219/anything-frontend-art-direction /tmp/afad
# 中身を読む（スクリプト・外部通信・hook が増えていないか）。増えていたら取り込まずに理由を書く
cp -r /tmp/afad/{SKILL.md,LICENSE,NOTICE.md,sources.md,references,checklists,templates,data} .claude/skills/anything-frontend-art-direction/
# UPSTREAM.md のコミットと日付を書き替える → PR → マージ後、各PCで node templates/hooks-relay/install.mjs（Remote Control）
node _docs/instruments/check-drift.mjs --strict-copies
```

## 未確認・次にやること

- 会社PC・レッツノートで install.mjs を走らせ直して `~/.claude/skills/` にそろえる（PC がつながったときに AI が Remote Control で）。
- 実際に LP を1枚この2スキルで作り直して、効き目を確かめる。

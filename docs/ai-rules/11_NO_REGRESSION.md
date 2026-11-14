# 11_NO_REGRESSION — AI の修正で、元々動いていた機能を消さない（全プロジェクト共通）

> **今の到達点: 採用（2026-11-14）。CLAUDE.md 冒頭「★★AIの修正で元々動いていた機能を消さない」の正本。**
> 役割: 「バグを直して」と頼まれた AI が、関係ない機能（ログイン・検索・設定など）を落としたまま出すのを、**人が気づく前に機械で止める**。
> なぜ要るか: 本人指示（2026-11-14 りんく「これがおこらないようにして」「サイト全体で」）。
> 「AI にバグを直してと頼んだら、自信満々で出したコードで、元々動いていた別の機能が3つ消えた（ログイン・検索・設定）」という事故が広く共有された。
> AI は直す対象のファイルを丸ごと書き直しがちで、そのとき関係ない部分を落とす。本人は「直った」の報告しか見ないので、消えたことに気づくのは利用者が先になる。
> 関連: [01_CORE_RULES.md](01_CORE_RULES.md) §2-1（根本原因を直す）／[04_SELF_VERIFICATION.md](04_SELF_VERIFICATION.md)（動かして確かめてから報告）／
> [08_NO_HUMAN_HANDS.md](08_NO_HUMAN_HANDS.md)（人に「動くか見て」と頼まない＝機械が見る）。

## 0. 一言でいうと

**直すのは頼まれた所だけ。消すなら名前を書く。消えたら困る機能は一覧にして、毎回ぜんぶ機械で確かめる。**
文章のルールだけでは、書き直す瞬間の AI には読まれない。だから3か所（書く前・出す前・main に入る前）で機械が止める。

## 1. 決まり（AI がやること）

1. **直す前に、消えたら困る機能を一覧にする。** リポ直下の `features.json`（§3）に、ログイン・検索・設定・決済などの入口を書く。
   無いリポで作業するときは、最初の修正の PR で作る（そのリポの主な画面とボタンを、コードと本番を見て自分で拾う。人に聞かない）。
2. **直す範囲を最小にする。** 頼まれた所だけを変える。ファイルを丸ごと書き直さない。整理・改名・ついでの直しは別の PR に分ける。
3. **消すなら名前を書く。** 頼まれて消すものは、コミットメッセージか PR 本文に1件ずつ書く:
   ```
   消してよい: LoginButton（理由: 新しいログイン画面に置き換えたため）
   ```
   `消してよい:` / `削除OK:` / `Removes:` のどれでもよい。まとめて全部を通す書き方は無い（抜け道になるため）。
4. **テストを消さない・止めない。** 落ちるテストを `.skip` / `.only` / `xit` で黙らせたり消したりしない。テストが正しくて実装が違うなら実装を直す。
   テストの方が古いなら、何が変わったかを PR に書いて、3 と同じく名前を宣言する。
5. **新しい機能を作ったら一覧に足す。** 次の AI がそれを守れるように、`features.json` に入口を足すところまでが作業。
6. **直した後は、一覧とテストを全部通してから報告する。** 「直した所が動いた」だけで「直りました」と言わない。
   `node templates/diagnostics/check-features-alive.mjs .`（本番・プレビューがあれば `--smoke <URL>`）と、そのリポのテスト・E2E を走らせ、結果を報告に書く。

## 2. 機械が止める3か所

| いつ | 何が | 何を見るか | 止め方 |
|---|---|---|---|
| commit・push・PR 作成の直前 | hook [`guard-unrequested-removal.mjs`](../../.claude/hooks/guard-unrequested-removal.mjs)（PreToolUse(Bash)） | 差分から「消えたもの」（下の表）を拾い、コマンドの中のメッセージ・PR 本文と、これまでのコミットメッセージに宣言があるか | **拒否**。消えたものの一覧と直し方を返す |
| PR を開いた・更新した・本文を直した | CI [`no-regression.yml`](../../.github/workflows/no-regression.yml)（他リポへは [`templates/workflows/no-regression.yml`](../../templates/workflows/no-regression.yml)） | 同じ判定を PR 全体に＋`features.json` の目印が全部残っているか | **赤**（チェックが赤の PR はマージしない＝CLAUDE.md の表） |
| 週1・手動 | 同じ CI | `features.json` の smoke のページが本番で開けるか | **赤**（通知が飛ぶ） |

「消えたもの」とみなすもの（[`check-unrequested-removal.mjs`](../../templates/diagnostics/check-unrequested-removal.mjs)）:

| 種類 | 例 |
|---|---|
| コード・画面・テストのファイルが消えた（名前の変更は除く） | `app/settings/page.tsx` |
| テストが消えた／`.skip`・`.only`・`xit` で止めた | `it('ログインできる')` |
| 公開している関数・部品が消え、差分のどこにも出直していない（別ファイルへ移しただけなら通る） | `export function search` |
| 画面の目印が消え、出直していない | `data-testid="login"`・`id="search"`・`href="/settings"`・`path: '/settings'` |
| 大きな削除（1ファイルで80行以上消し、足した行の3倍より多い） | 丸ごと書き直して半分以下になった |
| `features.json` の目印の文字列を含む行が消えた | 何でも |

このリポの過去200件のコミットに当てた実測（2026-11-14）: 引っかかったのは3件で、3件とも本当に消していた（生成物の追跡停止・関数の削除・hook の書き直し）。
ふつうの修正・文書の変更・名前の変更では出ない。

## 3. `features.json` の形

```json
{
  "features": [
    {
      "name": "ログイン",
      "anchors": [ { "file": "src/components/Header.tsx", "contains": "data-testid=\"login\"" } ],
      "smoke":   [ { "path": "/login", "contains": "ログイン" } ]
    }
  ]
}
```

- `anchors` … そのファイルがあり、その文字列を含むこと（コードの中に入口が残っているか）。消えにくく、機能に固有の文字列を選ぶ（`data-testid`・ルート・関数名）。
- `smoke` … `--smoke <URL>` を付けたときだけ、そのページが 200 で返り、その文字列を含むこと（本番・プレビューで開けるか）。
- 例: このリポの [`features.json`](../../features.json)。

## 4. 入れ方（各リポ・全サービス）

1. AI のセッション（PC・クラウド）: hook と判定スクリプトを同じフォルダ（`~/.claude/hooks/`）に置き、`~/.claude/settings.json` の
   PreToolUse(Bash) に `node ~/.claude/hooks/guard-unrequested-removal.mjs` を足す。これで**どのリポで作業しても** commit・push の前に効く。
2. 各リポの CI: [`templates/workflows/no-regression.yml`](../../templates/workflows/no-regression.yml) を `.github/workflows/` に置き、`features.json` を作る。
   判定スクリプトは web-ios-android（公開リポ）から毎回取ってくる（各リポに写さない＝割れない）。
3. 各リポの診断キット（`templates/diagnostics/run.mjs`）にも2本とも入っている。

## 5. 判定しないこと（機械の限界）

- **消さずに中身を書き換えて壊したもの**は拾えない（ボタンは残っているが押しても動かない）。それはテスト・E2E の仕事なので、§1-6 のとおり全部走らせる。
- `features.json` に**書いていない機能**は見ない。だから §1-1・§1-5 で一覧を育てる。
- 名前の一致しか見ない。別名で出直したものは「消えた」と出る（宣言すれば通る）。
- 宣言の理由が本当かは見ない。書いた事実がコミット・PR に残る＝後から検査できる、までが限界。
- 判定スクリプトの自己検査: `node templates/diagnostics/check-unrequested-removal.mjs --selftest`・`check-features-alive.mjs --selftest`（`npm run verify` が毎回走らせる）。

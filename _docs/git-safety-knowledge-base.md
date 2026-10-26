<!-- 役割: git の破壊的操作(とくに `git reset --hard`)で未コミット変更を巻き込み消失させた実損の記録と教訓。
     使い方: CLAUDE.md「並列セッション協調プロトコル／やってはいけないこと」の reset 規範の EVIDENCE。
     reset --hard を打つ前に読み返す。なぜ要るか: 核(CLAUDE.md)には規範3段だけを残し、事例本文はここへ移設した
     (核の予算を守る・2026-10-21 全体設計会議 P1)。 -->

# git 破壊的操作の実損と教訓（git-safety）

## `git reset --hard <離れたSHA>` で無関係な未コミット変更を巻き込み消失（2026-09-28・kimitolink-linktree）

### 規範（CLAUDE.md 核に残した3段・実行前に必ず踏む）
1. **`reset --hard` を打つ前に必ず `git status --short` を実行**し、今から消える対象に見覚えのない変更が
   1件でも無いか目で確認する。1件でもあれば `reset --hard` を使わない。
2. **「1コミットだけ戻したい」なら `HEAD~1` のような HEAD 相対で指定する**（`origin/main` 等の離れた SHA を
   漠然と指定しない——自分のコミットが今 HEAD から何個目かを数えられないなら、そもそも広範囲 reset をする資格がない）。
3. **`main` を origin 相当に揃えたいだけなら、`reset --hard` ではなく `git stash`（未コミット変更を退避）
   →`git pull --ff-only`→必要なら `git stash pop`** を使う。「未コミット変更がある状態で `reset --hard` を
   検討している」こと自体が既に危険信号。

### 実損の詳細
やりたいことが「自分がついさっき作った1コミットだけを戻す」でも、面倒くさがって `git reset --hard origin/main`
のような**離れた SHA への広範囲 reset** を使うと、**その瞬間の作業ツリーにあった、自分が関知していない
未コミット変更まで巻き込んで消える**。

実損: `git branch <退避用>` で自分のコミットを退避した直後、続けて `git reset --hard origin/main` を実行し、
無関係な3ファイル（`council/HANDOFF-ogp-and-app.md`・`../kimitolink-linktree/scripts/design-council.mjs`・
`templates-app/android-twa/README.md`。いずれも `git add` 前の未コミット変更で、他セッションかユーザー本人の作業）を消した。
**未コミットの変更は git add もコミットもしていない限り、通常の git 操作では復元不可能**
（stash していない・commit していない working tree 差分は reflog にも残らない）。

### なぜ coord や機械検査で防げないか
これは「相手の作業ブランチを勝手に reset する」の1つ上の層の教訓——**同じセッション内の自分の操作でも、
作業ツリーの現況（`git status`）を見ずに広範囲 reset を打てば同じ事故になる**。coord の `files` 宣言は
「意図して触る対象」しか書かないため、この種の巻き込み事故は coord の仕組みだけでは防げない。
機械検査も困難——「これから実行する git コマンドが安全か」は任意のシェルコマンド文字列の意味解釈が要り、
CLAUDE.md「新しいルールを書いたら機械検査化を検討する」節の基準2番（自然言語判断が絡む）に該当する。
フックで `git reset --hard` をパターンマッチして警告する案は false positive が多く実用性が低いため不採用。
**唯一の対処は上記3段の手順を徹底すること**。

出典: 2026-09-28 実損（`kimitolink-linktree` セッション）。CLAUDE.md「並列セッション協調プロトコル」から移設（2026-10-21・P1）。

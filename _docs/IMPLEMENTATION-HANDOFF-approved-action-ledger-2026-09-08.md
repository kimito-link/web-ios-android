# 実装ハンドオフ: 確定アクションのセッション境界引き継ぎ（Approved-Action Ledger）

- 設計: Fable。裏取り: 司令塔（既存コードの関数名・行番号を実際にgrep/Readで確認済み）
- 日付: 2026-09-08
- この1枚だけで着手できる粒度。実装は行っていない（次チャット/別モデルの仕事）

## A. 読む順

1. 本ファイル
2. `_docs/DESIGN-approved-action-ledger-2026-09-08.md`（設計全文、A〜G節）
3. `templates/scripts/context-engine.mjs`（拡張対象本体。特に以下を実際に読む）
   - 30行目: `VALID_STATUS`（現在`confirmed`/`rejected`/`pending`の3値）
   - 42-52行目: `positionalRoot()`と`takesValue`セット
   - 160行目・186行目: `join(root, ...)`の使用箇所（地雷G-1の実物）
   - 197行目以降: `validateLedger(root, ledger)`
   - 238行目以降: `collectContext(root, ledgerRel)`
   - `renderReport`・`printCheck`・`verdict`・`runSelfTest`の各関数（後方の行、Read時に検索）
4. `templates/scripts/check-instrument-ran.mjs`（INCONCLUSIVE判定・`--stamp`パターンの参考）
5. `~/.claude/hooks/require-claude-md-read.mjs`と`~/.claude/settings.json`（フックの配線）
6. `web-ios-android/.claude/hooks/require-claude-md-read.mjs`（リポ内コピー、地雷G-4）

## B. スコープ（MVP、設計書E節に対応）

作るのは以下のみ。C-5（フック拡張）・完了報告の機械化は次段に回す。

1. `context-engine.mjs`に`approved`ステータスを追加（C-1）
2. `renderReport`/`printCheck`/`verdict`の先頭表示・INCONCLUSIVE判定（C-2）
3. Plan modeファイル走査による転記漏れ検出（C-4）
4. `~/.claude/CLAUDE.md`に計画ファイルの表の型を追記（C-3、5行以内）
5. selftestへの毒7件追加（設計書D-3参照）

**やらないこと（MVPのスコープ外）**:
- フック拡張（C-5、Bash matcher追加・`--open-actions`呼び出し）は次段
- TodoWriteとの連携は作らない（設計書F節で却下済み）
- 完了報告の自動機械化（Stopフック等）は次段

## C. 着手手順

### C-1. `VALID_STATUS`拡張と`approved`スキーマ

1. `VALID_STATUS`に`'approved'`を追加:
   ```js
   const VALID_STATUS = new Set(['confirmed', 'rejected', 'pending', 'approved']);
   ```
2. `validateLedger(root, ledger)`（197行目付近）に、`status === 'approved'`のときの
   専用バリデーションを追加:
   - `row.action`オブジェクトが必須。`row.action.kind`は`'delete'|'move'|'edit'|'command'`
     のいずれか
   - `kind === 'delete'`または`'edit'`または`'command'`のとき`row.action.target`必須
   - `kind === 'move'`のとき`row.action.target`（from）と`row.action.to`の両方必須
   - `row.source`必須。`file:<path>:<line>`または`transcript:<session_id>`の形式
   - `row.approvedAt`必須（ISO8601文字列）
   - **既存の「pending以外はevidence必須」ルールから`approved`を除外する**
     （`approved`はまだ実行されていないので証拠が無いのが正しい状態）
3. `approved`行を閉じる`confirmed`行（`supersedes`で参照）は、証拠に
   `absent:<path>`（新設）または`commit:`のいずれかを最低1つ含むこと。`command:`のみ
   では拒否する。バリデーションロジックに追加

### C-2. `absent:`証拠型の新設

証拠文字列の先頭が`absent:`のとき、続くパスに対して`!existsSync(resolve(root, path))`を
検証する（存在しないことを確認する。他の`file:`/`commit:`とは逆方向の検証）。
**`resolve`を使うこと（`join`ではない。地雷G-1）**。

### C-3. `collectContext`への物理プローブ追加

`collectContext(root, ledgerRel)`（238行目付近）で、台帳を読んだ後、activeな
`approved`行それぞれについて:
- `kind === 'delete'`: `existsSync(resolve(root, target))`で存在確認。存在すれば
  「未実行」、存在しなければ「実行済みの疑い・台帳未閉」（どちらも非緑データとして
  結果オブジェクトに含める）
- `kind === 'move'`: from/toの存在パターンで3分岐（設計書C-2参照）
- `kind === 'edit'`/`'command'`: 物理プローブなし、「判定不能」として記録

### C-4. Plan modeファイル走査（転記漏れ検出）

`collectContext`に新しい収集ステップを追加:
1. `homedir()/.claude/plans/*.md`を列挙（`os.homedir()`のimportが必要）
2. `--plans-dir`オプションで上書き可能にする（`positionalRoot()`の`takesValue`に追加）
3. mtimeが直近30日以内、かつファイル本文（`readFileSync`）に`'★確定アクション'`を
   含むものだけ開く
4. その見出し直後のMarkdown表をパースし、`(操作, 対象, 承認日, 状態)`の行を抽出
5. 各表行の`(kind, 正規化target)`を、台帳のactiveな`approved`/`confirmed`/`rejected`行と
   突き合わせる。対応する台帳行が無ければ「転記漏れ」として記録
6. 表が無いが破壊語彙（`削除`/`rm `/`Remove-Item`/`移動`/`force push`等）を含む計画
   ファイルは「⚪推測」として別カテゴリで記録（事実検査と混ぜない）

パス正規化: `\`→`/`、ドライブ文字小文字化、末尾`/`除去、を比較前に両辺へ適用する
軽量関数を用意する（地雷G-2）。

### C-5. `--action` `--target` `--to` `--source`のCLI追加

`positionalRoot()`の`takesValue`セット（42-46行目）に以下を追加:
```js
'--action', '--target', '--to', '--source', '--plans-dir'
```
**これを忘れると値がルートパスと誤認される（地雷G-3、`check-instrument-ran.mjs`が
実際に踏んだ型と同種）。**

`--record`実行時、これらのCLI引数から`action`/`source`/`approvedAt`（現在時刻）を
組み立てて台帳に追記するロジックを実装する。

### C-6. `renderReport`/`printCheck`/`verdict`の先頭表示

1. `renderReport`の出力冒頭（既存の「## 1. 文脈の網羅性」相当のセクションより前）に
   「## 0. ★最優先・未実行の確定アクション」を挿入
2. C-3・C-4で集めた「開いているapproved行」「転記漏れ」を一覧表示。ゼロ件なら
   「開いている確定アクションはありません（台帳N行・計画ファイルM件と突き合わせ済み）」
   と件数付きで明記（設計書D-1）
3. `printCheck`（`--check`実行時の標準出力）にも同じ内容を最初に出す
4. `verdict`関数: activeな`approved`行または転記漏れが1件でもあれば`EXIT.INCONCLUSIVE`
   を返す（`EXIT.FAIL`にしない。理由は設計書D-2）

### C-7. selftestへの毒7件追加

`runSelfTest`に以下のケースを追加（設計書D-3のリストそのまま）:
1. `approved`に`action`無し→バリデーションエラーで拒否
2. `delete`で対象が実在するテストフォルダを用意→open判定
3. `delete`で対象が存在しない→未閉判定
4. 計画ファイルに表行あり・台帳に対応行無し→転記漏れ検出
5. `command:`だけで`approved`行を閉じようとする→拒否
6. `absent:`証拠が実際には存在するファイルを指す→拒否
7. 表ゼロ・台帳ゼロ・plans dir読み取り成功→緑（根拠件数つき）

### C-8. `~/.claude/CLAUDE.md`への追記

設計書C-3の表の型（見出し`★確定アクション`＋4列表）と、5行以内の運用説明を追記する。
実際に追記する前に、既存の`~/.claude/CLAUDE.md`の該当セクション構成を`Read`で確認し、
自然な位置（例: 「コンテキスト圧縮で残すもの」節の近く）を選ぶこと。

## D. 動作確認

1. `node templates/scripts/context-engine.mjs --selftest`で新規7ケース含め全緑
2. 実際に`--record --status approved --action delete --target <テスト用の実在パス> --source "file:test.md:1"`を実行し、台帳に正しく追記されることを確認
3. `--check`を実行し、「## 0」セクションに未実行アクションが表示され、`verdict`が
   INCONCLUSIVEになることを確認
4. テスト用パスを実際に削除してから`--record --status confirmed --supersedes <id> --evidence absent:<path>`で閉じ、`--check`が緑に戻ることを確認
5. `~/.claude/plans/`に「★確定アクション」表を含むテスト用計画ファイルを置き、台帳に
   転記していない状態で`--check`を実行し、「転記漏れ」が検出されることを確認

## E. 機械的な完了判定

- [ ] `--selftest`が新規ケース含め全緑
- [ ] D-2〜D-5の手動確認が全て期待通りの結果
- [ ] `~/.claude/CLAUDE.md`に表の型が追記され、実在パス参照が全て確認済み
- [ ] 既存の`--check`/`--write`の従来動作（`confirmed`/`rejected`/`pending`の3状態）が
      壊れていないこと（後方互換性、既存の`.instrument-context.md`実例で再確認）

## F. 地雷（設計書G節の再掲、実装時に必ず踏まえる）

1. `join(root, ref)`は絶対パスを連結する。新設箇所は必ず`resolve(root, ref)`を使う
2. Windowsパス正規化を比較前に必ず通す
3. `positionalRoot()`のtakesValueに新オプションを追加し忘れると沈黙のバグになる
4. フックの正本は2箇所（`~/.claude/hooks/`と`web-ios-android/.claude/hooks/`）。
   今回のMVPスコープではフック自体は触らないが、次段でC-5に着手する際に必ず両方確認する
5. `approved`のevidence免除を`confirmed`へ波及させない
6. 計画ファイルの表は正本ではない（追加方向の同期のみ、削除は同期しない）

## G. 関連ファイル（実在確認済み・司令塔が実測）

- `web-ios-android/templates/scripts/context-engine.mjs`（拡張対象）
- `web-ios-android/templates/scripts/check-instrument-ran.mjs`（INCONCLUSIVEパターンの参考）
- `~/.claude/hooks/require-claude-md-read.mjs`（次段C-5の対象、今回は触らない）
- `~/.claude/CLAUDE.md`（C-3追記対象）
- `_docs/DESIGN-approved-action-ledger-2026-09-08.md`（設計全文）

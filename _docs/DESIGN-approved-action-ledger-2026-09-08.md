# 設計: 確定アクションのセッション境界引き継ぎ（Approved-Action Ledger）

- 設計: Fable（claude-fable-5-1）。既存コード（`context-engine.mjs`・`check-instrument-ran.mjs`・
  `require-claude-md-read.mjs`）を実際に読んで書かれている
- 裏取り: 司令塔が`VALID_STATUS`・`join(root, ref)`・`positionalRoot`・`collectContext`・
  `validateLedger`の実在をgrepで確認済み。フックが`~/.claude/hooks/`と
  `web-ios-android/.claude/hooks/`の2箇所に実在することも確認済み（Fable指摘の地雷4と一致）
- 日付: 2026-09-08 ／ council-fableワークフローの手順2の産物
- 素材: 無料マルチLLM会議5体（groq/gpt-oss-120b・nvidia/nemotron-3-ultra-550b・
  groq/qwen3.8-27b・local/qwen3.5:9b・cloudflare/gpt-oss-20b、design分類）

## きっかけ（実際に起きた事故）

github直下整理整頓作業で、前回のPlan modeセッションで「`.claude_backup_tsuioku`は
削除してよい」とユーザーが確定回答したのに、次のセッションでその確定事項を実行し忘れた
まま別の調査を続けてしまった。CLAUDE.mdの「AI特有の認知の癖」5類型のどれにも直接該当
しない、**セッション境界で確定情報が機械の読めない場所（計画ファイルの自然文）に
埋もれて落ちた**、という別種の問題と特定。

---

## 0. 位置づけ（5類型と重ねない）

5類型は「1セッションの内側」で起きる判断の歪みだが、今回は「セッション境界で情報が
落ちた」構造の問題。対処は認知の矯正ではなく、**「確定を機械が読める器に落とし、
次のセッションの最初の書き込みの前に必ず目に入る経路を作る」**という配管の話。
CLAUDE.mdに類型⑥は足さない（自覚すれば防げる話に見えてしまうため）。

## A. 理想の体験フロー

**ユーザー視点**: Plan modeで「削除してよい」と答えたら、以降どのセッションでも同じ
ことを二度聞かれない。次のセッションが別の話題から始まっても、AIが最初の書き込みを
する前に「未実行の確定アクションが1件あります」と自分で言い出す。

**AI視点**:
1. Plan mode中、破壊的操作を含む計画は計画ファイル先頭に固定形式の表を置く（C-3）
2. 承認直後、台帳に転記する（`npm run context:record`）。忘れても次のセッションの
   機械検査が「表はあるのに台帳に無い」を検出する
3. 次のセッション開始、最初のEdit/Write/Bashが既存フックに止められ、未実行アクションが
   deny理由にそのまま列挙される
4. 実行したら証拠つきで閉じる（`--status confirmed --evidence absent:<path>`）
5. TodoWriteは「このセッションで何をやるか」の細分化にだけ使う。正本は台帳

## B. 統合アーキ（3コンポーネント＋既存配線）

```
[Plan mode]                        [通常セッション]
計画ファイル ~/.claude/plans/*.md   scripts/context-evolution.json（正本・git管理）
  └ 先頭「★確定アクション」表 ──①転記──▶ status: approved の行
        │                                      │
        │  ②突き合わせ（転記漏れ検出）          │ ③物理プローブ（存在/不在）
        ▼                                      ▼
   context-engine.mjs  --record / --check / --open-actions(新設)
        │  verdict: approved行あり ⇒ INCONCLUSIVE、緑にしない
        │  renderReport: 「## 0. ★最優先」を先頭に出す
        ▼
   既存フック require-claude-md-read.mjs（PreToolUse: Edit|Write|NotebookEdit、+Bash）
        │  approved行 or 転記漏れあり ⇒ 台帳既読(ハッシュ一致)まで deny
        │  deny理由に行を列挙
        ▼
   AI が実行 → --record --status confirmed --supersedes --evidence absent:/commit:
```

- **コンポーネント1（器）**: 台帳`context-evolution.json`に`approved`状態と`action`形を
  足す。計画ファイルの表は「人間が承認した入口」であって正本ではない（グローバル
  ディレクトリ・非バージョン管理・自然文混在・検証なし、の4点で正本に不適）
- **コンポーネント2（門番＝読ませる）**: `context-engine.mjs`の出力先頭化とfail-closed判定、
  既存フックの拡張
- **コンポーネント3（転記の強制＝記録を善意に依存させない）**: 計画ファイル表↔台帳の
  突き合わせ。ExitPlanModeフックの入力形式は未確認のためそれに依存せず、
  **ファイル同士の突き合わせ**で実現する

新しい常駐・DB・基盤はゼロ。触るのは既存2ファイルとCLAUDE.mdの運用ルールのみ。

## C. 具体機構

### C-1. 台帳スキーマ拡張（context-engine.mjs）

- `VALID_STATUS`（現在`confirmed`/`rejected`/`pending`の3値、行30で実在確認済み）に
  `approved`を追加。**意味を混ぜない**: `confirmed`=「実行し証拠で確認した」、
  `approved`=「人間が承認済み・未実行」
- `approved`行の必須フィールド（`validateLedger`、行197に追加）:
  - `action.kind`: `delete`/`move`/`edit`/`command`のいずれか
  - `action.target`: パス（`move`は`action.to`も必須）
  - `source`: 承認の出所。`file:<計画ファイル絶対パス>:<行>`または`transcript:<session_id>`
  - `approvedAt`: ISO8601
  - `evidence`は不要（未実行なので証拠が無いのが正しい。既存の「pending以外はevidence
    必須」ルールに`approved`を例外として加える）
- 閉じ方: 既存の`supersedes`をそのまま使う。`approved`行を閉じる`confirmed`行は
  機械検証可能な証拠を最低1つ含むこと（`file:`/`commit:`/新設`absent:`）。
  `command:`だけでは閉じられない
- 新設evidence型`absent:<path>`: **存在しないこと**を検証する（`existsSync`がfalseで
  なければエラー）。`delete`の閉じ証拠はこれ。`move`は`absent:<from>` + `file:<to>`
- `--record`のCLI追加: `--action <kind>` `--target <path>` `--to <path>` `--source <ref>`。
  `positionalRoot()`（行42）の`takesValue`に必ず追加すること（地雷G-3参照）

### C-2. 出力先頭化と判定（context-engine.mjs）

- `renderReport`: 「## 1. 文脈の網羅性」の前に「## 0. ★最優先・未実行の確定アクション」を
  挿入。ゼロ件のときは「開いている確定アクションはありません（台帳N行・計画ファイルM件と
  突き合わせ済み）」と根拠を明記
- `printCheck`: 同じ内容を最初の行に出す
- `verdict`: activeな`approved`行が1件でもあれば**INCONCLUSIVE**（FAILにしない。理由は
  `check-instrument-ran.mjs`と同じ——赤にすると「とりあえず閉じて黙らせる」動機を作る）
- 物理プローブ（`collectContext`、行238に追加）:
  - `delete`: target存在→「未実行」／不在→「実行済みの疑い・台帳未閉」（どちらも非緑）
  - `move`: from存在&to不在→未実行／from不在&to存在→台帳未閉／それ以外→不整合
  - `edit`/`command`: 物理プローブなし。閉じ証拠`commit:`を要求
- 軽量subcommand`--open-actions --json`（新設）: ファイル地図・Git全履歴を走らせず、
  台帳と計画ファイル表だけを読んで開いている行を返す（フックからの高頻度呼び出し用）

### C-3. 計画ファイルの型（Plan modeで人間が破壊的操作を確定する場面の固定形式）

```markdown
## ★確定アクション（人間が承認済み・未実行。最初に読む。再質問しない）
| 操作 | 対象 | 承認日 | 状態 |
|---|---|---|---|
| delete | C:/Users/info/OneDrive/デスクトップ/Resilio/github/.claude_backup_tsuioku/ | 2026-09-07 | 未実行 |
```

- 見出し`★確定アクション`と列見出し4つが機械契約。パーサはこの見出し直後の表だけ読む
- 対象は絶対パスかgithub直下からの相対
- 「状態」は`未実行`/`実行済`/`取消`
- この型は`~/.claude/CLAUDE.md`（グローバル）に置く。計画ファイルはグローバルなので
  リポ側CLAUDE.mdだけでは届かない

### C-4. 転記漏れ検出（コンポーネント3の実体）

`collectContext`に計画ファイル走査を追加:
- 対象: `~/.claude/plans/*.md`（`--plans-dir`で上書き可）。mtimeが直近30日以内、かつ
  本文に`★確定アクション`を含むファイルだけ開く
- 各表行を`(kind, 正規化target)`にして台帳のactiveな`approved`/`confirmed`/`rejected`行と
  突き合わせる。**台帳に対応行が無い表行**＝転記漏れ→INCONCLUSIVE、メッセージに転記用の
  `--record`コマンドをそのまま出す
- 表が無いが破壊語彙（削除・rm・Remove-Item・移動・force push等）を含む計画ファイル→
  ⚪warning（推測ベース、事実検査と混ぜない）

これで「AIが記録することを忘れる」は事故ではなく**検出される状態**になる。記録の入口は
Plan modeで必ず書く計画ファイルそのもの（ユーザー承認と同時に成立する）で、台帳への
転記は忘れても拾われる。

### C-5. 既存フック拡張（読ませる側の強制）

`require-claude-md-read.mjs`に判定を1段足す（別ファイルにしない）:
1. リポrootに`context-engine.mjs`が無ければスキップ（キット未導入リポは対象外）
2. あれば`--open-actions --json`を子プロセスで呼ぶ
3. 開いている行または転記漏れが1件以上→台帳を**現在のハッシュのまま**Readした記録が
   transcriptに無ければdeny。`findLatestReadHash`をそのまま再利用
4. deny理由に行を列挙（最大5件、残りは件数）
5. matcherに`Bash`を追加する（Edit/Writeを使わずBashだけで作業を進める経路を塞ぐ）

既読が成立すれば書き込みは通す（実行は強制しない）。`npm run context`のverdictは閉じる
までINCONCLUSIVEのまま＝完了報告で必ず残件として出る。

## D. 偽陽性・偽陰性潰し（fail-closed 2種）

### D-1. 「確定事項が無い」を「異常なし」と誤認しない
- 台帳ファイル自体が無い→既にINCONCLUSIVE（維持）
- 台帳はあるが`approved`ゼロ件→それだけでは緑にしない。**計画ファイル走査の結果と
  併せて**「表行ゼロ かつ 台帳ゼロ」のときだけ緑。走査できなかったらINCONCLUSIVE
- 緑のメッセージには必ず根拠の件数を出す

### D-2. 「検査が走っていない」を「緑」と誤認しない
- `npm run context`が緑を返した経路にだけ`check-instrument-ran.mjs --stamp context`を
  `&&`で配線する（`check:improvement`と同じ形）
- 主経路はフックなので「走っていない」が起きるのはcontext-engineを手で呼ぶ経路だけ
- フック内で子プロセスが失敗した（例外・タイムアウト）ときは**スキップせずdeny**
  （通す側に倒すと、台帳が壊れたときに事故がそのまま再現する）

### D-3. 物理状態と台帳の矛盾を緑にしない
- `approved` + 対象が既に無い→「実行済みの疑い・未閉」（非緑、黙って実行して記録し
  忘れたケースを拾う）
- `absent:`証拠を付けた`confirmed`行で対象が実在する→validateLedgerエラー（嘘の閉じ方を
  拒否）
- selftest毒: ①`approved`にaction無し→拒否 ②delete対象実在→open ③delete対象不在→未閉
  ④表行あり台帳無し→転記漏れ ⑤`command:`だけでapproved閉じる→拒否 ⑥`absent:`が実在
  ファイル→拒否 ⑦表ゼロ・台帳ゼロ・plans dir読めた→緑

## E. MVP（1つだけ作るなら）

**`context-engine.mjs`の`approved`状態＋先頭表示＋INCONCLUSIVE判定＋計画ファイル表の
突き合わせ（C-1・C-2・C-4）。1ファイル・依存追加なし。**

理由: 事故の直接原因は「確定が機械の読めない場所にあり、読む経路が無かった」の1点。
この1ファイルで「機械が読める器」「先頭に出す」「転記忘れの検出」「閉じるまで緑に
しない」の4つが揃い、`npm run context`を作業開始時に打つ既存ルールに乗るだけで効く。
フック拡張（C-5）は「`npm run context`を打ち忘れる」経路を塞ぐ第2段で、次に回せる。

## F. 捨てた案と理由

| 案 | 捨てた理由 |
|---|---|
| `pending_actions.jsonl`の新設 | 台帳が2つになり、既存`context-evolution.json`の検証（id重複・supersedes・証拠実在）を複製することになる |
| TodoWriteとの双方向同期 | TodoWriteはフックからも台帳からも書けず、同期は結局AIの善意で行われる＝設計が同じ穴に落ちる |
| 確定事項の自動実行 | 地雷マップ違反。人が見ずに走らせる設計は作らない |
| ExitPlanModeフックでの自動転記 | フック入力に計画本文が入るか未確認。確認できたら任意の強化として後付け可能だが、MVPをそれに依存させるとファイル突き合わせより脆い |
| Bash破壊コマンド門番（approved行が無いrmをdeny） | 塞ぐのは「承認なしの実行」という別リスク。今回の事故（承認済みの未実行）には効かない |
| 承認行の有効期限（N日で自動失効） | 失効＝「忘れてよい」を仕組みが認めることになり、事故の再生産 |
| CLAUDE.mdの類型⑥として追加 | 認知の癖ではなく配管の欠落。5類型と並べると「自覚すれば防げる」話に見えてしまう |

## G. 地雷と回避策（実装時）

1. **`join(root, ref)`は絶対パスを連結する**: `validateLedger`の`file:`検証は`join`を
   使っている（行160・186で実在確認済み）。計画ファイル（`C:\Users\info\.claude\plans\...`）を
   `source`に書くと`C:\repo\C:\Users\...`になり常に「無い」と判定される。`absent:`/
   `source`/`action.target`は`resolve(root, ref)`を使う
2. **Windowsパス正規化**: `\`と`/`、ドライブ文字の大小、末尾`/`の有無を正規化してから
   比較する
3. **`positionalRoot()`のtakesValue**: 新オプションを追加しないと、値がルートパスとして
   拾われ台帳が別ディレクトリに書かれる「沈黙の書き込み先ズレ」が再発する
4. **フックの正本は2箇所にある**: `~/.claude/hooks/require-claude-md-read.mjs`（配線されて
   いる実体）と`web-ios-android/.claude/hooks/require-claude-md-read.mjs`（リポ内コピー、
   実在確認済み）。片方だけ直すとドリフトする。`check-drift.mjs`の`PAIRS`に登録するか、
   1本化する判断を先にする
5. **フックのコスト**: Edit/Write/Bashのたびに子プロセスを起動する。`--open-actions`は
   ファイル地図・Git全履歴を絶対に走らせない。計画ファイルはmtimeと文字列検索で先に絞る
6. **フックのdenyは既読で解除、実行では解除しない**: 「実行するまで書き込み禁止」に
   すると別作業が全部止まり、AIが台帳を雑に閉じる動機になる
7. **`approved`のevidence免除を`confirmed`へ波及させない**: `confirmed`は従来どおり必須
8. **計画ファイルの表を正本にしない**: 表→台帳は追加方向のみ、削除は同期しない
9. **Plan mode中に`--record`が打てるかは未確認**: 実装時に一度試して結果を
   `CONTEXT-EVOLUTION.md`に書く
10. **完了報告ルールの配線**: MVPではCLAUDE.mdの運用ルールとして置き、効かなければ
    機械化する

### 追記先（実在パス、司令塔確認済み）
- `web-ios-android/templates/scripts/context-engine.mjs`（C-1・C-2・C-4・selftest）
- `~/.claude/hooks/require-claude-md-read.mjs`と`~/.claude/settings.json`（C-5）
- `~/.claude/CLAUDE.md`（C-3の表の型、5行）
- `web-ios-android/CLAUDE.md`「並列セッション協調プロトコル」の直後に
  「セッション境界の引き継ぎ」節（10行以内、正本は`_docs/instruments/CONTEXT-EVOLUTION.md`へ）
- `package.json`: `context`スクリプトに`&& node scripts/check-instrument-ran.mjs --stamp context`

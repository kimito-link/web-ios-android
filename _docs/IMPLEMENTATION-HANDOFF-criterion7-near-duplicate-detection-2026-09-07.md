# 実装ハンドオフ: 基準⑦の機械検出（check-near-duplicates.mjs）

> 設計書: [`DESIGN-criterion7-near-duplicate-detection-2026-09-07.md`](DESIGN-criterion7-near-duplicate-detection-2026-09-07.md)（必読、この1枚だけでは判断根拠が分からない）
> このハンドオフ1枚だけで着手できる粒度にしてある。実装は次チャット/別モデルでよい。

## スコープ（これだけやる。設計書Dの「含めないもの」は絶対にやらない）

1. `templates/diagnostics/check-near-duplicates.mjs` を新規作成
2. `templates/diagnostics/run.mjs` の `CHECKS` に1エントリ追加
3. `--selftest` で設計書C-5の8件が全部通ることを確認
4. キット自身と `reply-copilot-openrouter-v2` で実測し、期待通りの塊が出ることを確認（設計書C-6）
5. 設計書C-7の文書更新（README・diagnostics.json・CLAUDE.md・09-02文書・KB・Decision Receipt）

## 着手手順

### ブランチ
```
git checkout -b feat/check-near-duplicates
```

### 1. 既存の類似検査を読んでスタイルを揃える

先に読む（実装のテンプレートにする）:
- `templates/diagnostics/check-shared-parts-used.mjs`（3値exit・declares機構・selftestの書き方）
- `templates/diagnostics/run.mjs`（`CHECKS`配列の登録形式、`(skip)`文字列の扱い）
- `templates/diagnostics/README.md`（一覧表の書式）

### 2. `check-near-duplicates.mjs` を書く

設計書C-1〜C-5の通り。TDDで進める（selftestを先に8ケース書いてから実装）。

**入力**: 対象ディレクトリ（省略時はカレントの`git ls-files`全体）、`--baseline N`、`--selftest`
**出力**: exit 0（合格）/ 1（赤、count > baseline）/ 2（測れなかった）
**依存**: `node:crypto`と`node:child_process`（`git ls-files`実行用）のみ。npm installしない。

定数は設計書C-1の通り固定する（`MIN_LINES=12`、窓k=5、`MAX_LINE_LENGTH=500`）。実装中に「この定数だと拾えない/拾いすぎる」と感じても、まずはこの値で進めて、C-6の実測結果を見てから司令塔に相談する（勝手にknob化しない — 設計書F-9で明示的に禁止）。

### 3. `run.mjs`に登録

```js
// 既存のCHECKS配列に追加するイメージ（実際のキー名は既存エントリの形式に合わせる）
{
  name: 'check-near-duplicates',
  script: 'check-near-duplicates.mjs',
  declares: { nearDupBaseline: '--baseline' },
}
```

登録直後に`npm run diagnostics`を実行し、`check-runner-registers-all`と`check-gates-are-wired`が
赤くならないことを確認する。

### 4. selftest確認

```bash
node templates/diagnostics/check-near-duplicates.mjs --selftest
```
設計書C-5の8ケースが全部pass。1つでもfailなら実装ミス。

### 5. 実測（完了条件・C-6）

```bash
# キット自身
cd web-ios-android
node templates/diagnostics/check-near-duplicates.mjs .
# → 何らかの塊が出ることを確認（findRepoRootは閾値未満で出ない可能性あり、それは正常）

# reply-copilot-openrouter-v2（2026-09-01実損の現場）
cd ../reply-copilot-openrouter-v2
node ../web-ios-android/templates/diagnostics/check-near-duplicates.mjs .
# → 同じ画面部品の3実装がクラスタとして出ることを確認
```

**どちらかで期待通りの塊が出なければ、実装を見直す。「動いたはず」で完了報告しない**
（`reality-checker`エージェントへの委任も検討可）。

初回baselineは、この実測で出た件数をそのまま`diagnostics.json`に書く（0决め打ち禁止、設計書F-6）。

### 6. 文書更新（設計書C-7）

- [ ] `templates/diagnostics/README.md` — 検査一覧に1行追加
- [ ] `diagnostics.json`（キット自身のルート） — `"nearDupBaseline": <実測値>`
- [ ] `CLAUDE.md` 基準⑦の末尾 — 「機械検出: `templates/diagnostics/check-near-duplicates.mjs`（`npm run diagnostics`で走る）」の1行だけ追加。それ以上書かない
- [ ] `_docs/DESIGN-shared-parts-baseline-2026-09-02.md` G節末尾 — 「2026-09-07: 基準⑦（別名・少し違う実装の検出）は本設計の範囲外と判明し、`DESIGN-criterion7-near-duplicate-detection-2026-09-07.md`で別検査として設計した」の1行
- [ ] `_docs/shared-parts-duplication-knowledge-base.md` 119行 — 「未実装・要検討」→ 実装済みである旨に更新
- [ ] `_docs/shared-parts-duplication-knowledge-base.md` 133-135行 — 「未検証」→ C-6の実測結果（何件のクラスタが出たか）に更新
- [ ] Decision Receipt記録: `node templates/scripts/record-decision-receipt.mjs --decision KEEP_SEPARATE --reason "事実(同名重複)と推測(似た塊)を混ぜない、測定の前提条件が違う"`（実際のCLI引数は`record-decision-receipt.mjs`のヘルプで確認）

### 7. Gate一式を実行してから完了報告

```bash
npm run diagnostics
node templates/diagnostics/check-decision-receipt.mjs
node templates/diagnostics/check-gates-are-wired.mjs
```
全部緑になってから、初めて「完了」と報告する。

## 機械的な完了判定（次の人・別モデルがこれだけ見れば分かる）

- [ ] `check-near-duplicates.mjs`が存在し`--selftest`で8ケース全pass
- [ ] `run.mjs`に登録され`npm run diagnostics`から呼ばれる
- [ ] キット自身とreply-copilot-openrouter-v2で実測済み、期待した塊が出ている
- [ ] baselineは実測値（0決め打ちではない）
- [ ] 上記6つの文書が全部更新済み
- [ ] Decision Receiptが記録済み
- [ ] `npm run diagnostics` / `check-decision-receipt.mjs` / `check-gates-are-wired.mjs` が全部緑

## 地雷（設計書Fの要約、実装中に踏みやすい順）

1. `run.mjs`の出力に`(skip)`という文字列を含めるとスキップ扱いになる。ログメッセージに気をつける。
2. `templates/diagnostics/`配下は`../scripts/lib`をimportしない。正規化ロジックは`check-near-duplicates.mjs`内に自己完結で書く。
3. `site/hub/`配下の生成HTMLで大量の偽陽性が出たら、検査側に除外パスを足すのではなく、ジェネレータ側に生成物マーカーコメントを1行足す。
4. CRLFは正規化前に除去（Windows環境でハッシュが一致しなくなる）。
5. selftest・run.mjs登録・Decision Receiptは同じコミットに入れる（バラすと中間状態でGateが赤になる）。

## 非スコープ（やらない。設計書Eで却下済み）

- jscpd等の外部ライブラリ導入
- AST解析
- Architecture Mapへの可視化
- CSS対応
- CLIオプションでの閾値変更（`--min-lines`等）
- 09-02設計（check-shared-parts-used.mjs）の手順2〜4の実装 — 別バックログ

## 参考: 今回のお題が生まれた経緯

2026-09-04、CLAUDE.mdに基準⑦を追記した際、2026-09-02に既にFableが近いお題
（`findRepoRoot`の7箇所重複を発端にした共通化検出）を設計済みだったことが判明。
2つの設計を混同しないよう、本ハンドオフは新規検査の実装だけをスコープにしている。

# 実装ハンドオフ: 共有部品配置規約のMVP（check-shared-parts-used.mjs拡張）

設計書: [`_docs/DESIGN-shared-parts-baseline-2026-09-02.md`](DESIGN-shared-parts-baseline-2026-09-02.md)
（council-fable 3段構えの産物。設計=Fable / 裏取り=司令塔）

この1枚だけで着手できる粒度で書く。**Architecture Map・`/hub/`への表示は今回のスコープ外**
（設計書E節「検査が先、可視化は後」）。今回作るのは`check-shared-parts-used.mjs`の拡張のみ。

## スコープ（MVPのみ）

1. `--shared-dir`を複数回受け付けるようにする
2. `judgeSharedPartsUsed`の`duplicates`各要素に`bodyMatch`（`identical`/`different`/`unmeasured`）を追加
3. ラチェット対象を`identical`のみに変更（`different`は表示のみ、ラチェットに含めない）
4. selftestに毒3件追加
5. キット自身の`diagnostics.json`の`sharedDir`を配列化
6. `npm run diagnostics`で実際に効くことを確認

**含まない**: Architecture Mapへの`sharedRole`注釈、`/hub/`への表示列、`findRepoRoot`の実際の
切り出し・PAIRS登録（これらは設計書のMVPの次の一歩②③④。別セッションで進める）。

## 読む順

1. [`_docs/DESIGN-shared-parts-baseline-2026-09-02.md`](DESIGN-shared-parts-baseline-2026-09-02.md)
   のC-1・C-2・D-2・E節
2. [`templates/diagnostics/check-shared-parts-used.mjs`](../templates/diagnostics/check-shared-parts-used.mjs)
   全文（既存実装。ヘッダーコメントに既知の偽陽性の記録あり）
3. [`templates/diagnostics/run.mjs`](../templates/diagnostics/run.mjs)の`declares`まわり
4. [`templates/scripts/lib/instrument-proof.mjs`](../templates/scripts/lib/instrument-proof.mjs)の
   `codeOnly`（83行目）・`hashSource`（99行目）

## 着手手順

1. ブランチを切る（例: `fix/shared-parts-body-hash`）
2. `check-shared-parts-used.mjs`の引数パース部分（現状219-222行目付近、`process.argv.indexOf('--shared-dir')`）
   を、複数回出現する`--shared-dir`を全て集める形に変更。既定値（`shared`/`common`/`lib/shared`）の
   フォールバック挙動は変えない
3. `run.mjs`の`declares: { sharedDir: '--shared-dir' }`が、`diagnostics.json`の`sharedDir`が配列の
   ときに複数フラグへ展開するよう修正（現状の展開ロジックを確認してから、配列対応を追加）
4. `judgeSharedPartsUsed`内で、同名定義が見つかったとき:
   - 共有dir側の定義本体と、外側の定義本体をそれぞれ抽出（`function name(`から中括弧深さ0まで）
   - 抽出できたら`codeOnly()`→`hashSource()`で比較。一致なら`bodyMatch: 'identical'`、不一致なら`'different'`
   - 抽出に失敗したら`bodyMatch: 'unmeasured'`（例外を投げない、fail-closedで確定判定を避ける）
   - `codeOnly`/`hashSource`は`templates/scripts/lib/instrument-proof.mjs`からimport
     （同じ`templates/diagnostics/`→`templates/scripts/lib/`のimportが配布先で解決するか、
     `check-drift-coverage.mjs`のPAIRS/copiesとArchitecture Mapのedgesで確認してから進める。
     解決しないなら`templates/diagnostics/`側にも同名関数を意図的複製し、PAIRSへ登録する）
5. ラチェット判定を`identical`件数のみに変更。`counts: { identical, different, declared }`を出力に追加
6. selftestに3件追加:
   - 本体が完全一致する2定義 → `bodyMatch: 'identical'`になること
   - 本体が異なる2定義（同名・別実装） → `bodyMatch: 'different'`になり、ラチェットに含まれないこと
   - `function f(opts = {}) { ... }`のようなデフォルト引数を持つ関数 → 中括弧カウントで誤爆せず、
     抽出に失敗するなら`unmeasured`として扱われること（過去の中括弧カウントバグの再発防止）
7. `diagnostics.json`の`sharedDir`を`["scripts/lib", "templates/scripts/lib"]`に変更
8. `node templates/diagnostics/check-shared-parts-used.mjs --selftest`を実行、全件パス確認
9. `npm run diagnostics`を実行し、**`findRepoRoot`が実際に`identical`の重複として検出されること**を
   確認する（`scripts/check-instrument-ran.mjs:88`と`scripts/lib/repo-root.mjs:17`の組が対象）。
   検出されなければ実装が効いていないので、この時点では完了報告しない
10. `templates/scripts/check-gates-are-wired.mjs`等、既存gateも通ることを確認
11. コミット・push

## 機械的完了判定

- [ ] `node templates/diagnostics/check-shared-parts-used.mjs --selftest` が全件パス（既存7件＋新規3件）
- [ ] `npm run diagnostics` 実行時、`findRepoRoot`の`identical`重複が出力に含まれる
- [ ] `--shared-dir`を2回渡すテストが手動で通る（`node templates/diagnostics/check-shared-parts-used.mjs --shared-dir scripts/lib --shared-dir templates/scripts/lib`）
- [ ] `different`（同名別実装、例: `_docs/instruments/check-drift.mjs:368`の`findRepoRoot`）がラチェットに
      カウントされていないこと
- [ ] `git diff`でこのハンドオフに書かれていないファイル（Architecture Map・`/hub/`関連）が
      変更されていないこと（スコープ厳守）

## 地雷（設計書G節から抜粋・実装時に踏みやすい順）

1. **本文切り出しの中括弧カウントは過去に実際にバグった実績がある**（デフォルト引数`opts = {}`の
   `{}`を本体開始と誤認した）。失敗時は必ず`unmeasured`に倒し、`identical`にも`different`にも
   入れない。selftestの毒テスト（着手手順6の3件目）で固定すること
2. **`different`をラチェットに含めない**。含めると「通すためだけの嘘の統合」を誘発する
3. **`templates/diagnostics/`から`templates/scripts/lib/`への相対importが配布先で解決するか未確認**。
   実装前に確認する（着手手順4参照）
4. **キット自身の`diagnostics.json`を先に直す**（着手手順7）。後回しにすると、実装した検査が
   キット自身で偽陽性を出したまま「見本」を名乗ることになる
5. **Architecture Map・`/hub/`には手を出さない**。今回のスコープはMVP（検査本体）のみ。
   可視化は別セッションの「次の一歩③④」

## 非自明だった事実（次のAIが再調査しなくて済むように）

- `scripts/lib/repo-root.mjs`のコメント「配布先で自己完結が必須のため意図的な重複を維持」は
  事実と矛盾している。`templates/scripts/check-instrument-ran.mjs`・`check-instrument-proof.mjs`・
  `record-instrument-proof.mjs`は全て既に`./lib/instrument-core.mjs`（および一部は`./lib/instrument-proof.mjs`）
  をimportしており、「自己完結が必須」という前提は既に崩れている。次の一歩②（`findRepoRoot`の
  `templates/scripts/lib/`への切り出し）を実施する際は、このコメントごと修正すること
- `findRepoRoot`という名前の関数は7箇所に存在するが、`_docs/instruments/check-drift.mjs:368`のものは
  引数が`filePath`（ファイルパスを受けて見つからなければ`null`を返す）で契約が異なる別実装。
  これは`different`として扱われるべきで、`identical`の重複としてカウントしてはならない
- `scripts/generate-hub-dashboard.mjs:530`の`findRepoRootFromRoot`は名前が似ているが別責務
  （`github/`ルートを返す）の関数で、今回の`findRepoRoot`重複問題とは無関係

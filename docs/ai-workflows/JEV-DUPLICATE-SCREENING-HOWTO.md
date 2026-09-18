# Jev（TypeSafe AI）による重複クラスタ一次スクリーニング — HOWTO（PoC）

> **今の到達点: 設計完了・PoC実装完了・運用実績はまだ0件。**
> `_docs/PILOT-LOG-jev-duplicate-screening.md`に3〜5件貯まるまで、CLAUDE.mdへは追記しない
> （`ai-hub/kb/external-decision-surface-governance.md`の`observation`層として扱う）。

## これは何か

`templates/diagnostics/check-near-duplicates.mjs`が検出する「似た行の塊（クラスタ）」に対して、
**「これは統合すべきか」という一次判定**を、Jev（TypeSafe AI社のSystem One Model）という
外部APIに投げて、confidence付きのヒントとして受け取る仕組み。

★**判定そのものではない。** 最終判断（CANONICAL CHECK・DECLARED決定）は今まで通り
人間/AIが行う。Jevの出力は「どのクラスタを先に見るべきか」という優先順位付けにしか使わない。

## なぜ作ったか

`check-near-duplicates.mjs`のコード内コメントに、以前からこう明記されている:

> ★この検査が判定しないこと（ここが最重要）
> **統合すべきかは判定しない。** 塊が見つかったからといって共通化が正しいとは限らない。

この空白は今まで意図的に埋められていなかった（`_docs/DESIGN-canonical-boundary-rules.md`
379-381行目に「文字列重複を自動検出するGateは作らない」という明示的な既存決定があるため）。

Jevは文字列一致ではなく、コードの意味内容を読んだ確率的判定（Choice/Score+confidence）を
返す。「文字列一致→即断定」という、既存決定が禁じている短絡とは技術的に別物であり、
以下の3条件を守れば矛盾なく導入できる（`_docs/DESIGN-jev-duplicate-screening-2026-09-18.md`
相当の検討はこのファイル内に集約し、別文書は作らない）:

1. Jevの出力は常に**Evidence StatusのHEURISTIC**として扱う（FACTにもDECLAREDにも直結させない）
2. 「文字列/構造が一致している」という機械的事実（`check-near-duplicates.mjs`の出力）と、
   「意味的に同じ責務か」というJevの判定は**別の行として書く**
3. 最終DECLARED判定は既存通り人間/AIが行い、`record-decision-receipt.mjs`に記録する。
   Jevの出力自体を`.decision-receipts.json`へ書き込む主体にしない

## 使い方

### 0. 前提: APIキーの取得（本人が行う。代行しない）

TypeSafe AI（`https://console.typesafe.ai`）でGoogleログインしてウェイトリストに登録し、
アクセス許可が下りたらAPIキーを発行する。取得したキーは`~/.claude/CLAUDE.md`
「トークン・鍵の受け渡しはクリップボード経由」節の手順で、`TYPESAFE_API_KEY`環境変数として
その場のBashに渡す（ファイルに書かない・コミットしない）。

### 1. 通常通りnear-duplicatesを実行してクラスタを見る

```bash
node templates/diagnostics/check-near-duplicates.mjs
```

### 2. 検出されたクラスタをJevでスクリーニングする（オプトイン）

```bash
TYPESAFE_API_KEY="<クリップボード経由で取得した値>" \
  node templates/diagnostics/screen-duplicate-clusters-with-jev.mjs
```

- **既存Gate群（`run-instruments.mjs`等）には配線されていない**。手動実行専用。
- 実行しても`.decision-receipts.json`・Gate結果には一切書き込まない（副作用ゼロ）。
- 出力は「どのクラスタをどの順で見るべきか」という提示のみ:

```
[screen-duplicate-clusters-with-jev] クラスタ 3件をJevへ送信...
  🟢 [高confidence 0.87] site-chrome.js ≈ site-chrome.template.js（要確認・先に見る）
  🟡 [中confidence 0.62] a.mjs ≈ b.mjs（確信度は低め）
  （低confidenceのクラスタは表示しない）
```

### 3. 人間/AIがCANONICAL CHECK13項目で最終判定する

`_docs/DESIGN-canonical-boundary-rules.md`の手順に従い、Jevが提示したクラスタから
優先的に見る。判定結果（REUSE/ESTABLISH_REHOME/CONTRACT/SYNC/KEEP_SEPARATE/LOCAL）は
`record-decision-receipt.mjs`で記録する（変更なし）。

### 4. 判定が正しかったかをPILOT-LOGに記録する

`_docs/PILOT-LOG-jev-duplicate-screening.md`に、Jevの判定・confidenceと、最終的な
CANONICAL CHECKの結果を突き合わせて1件ずつ記録する。3〜5件貯まった時点で、
精度・コスト・運用負荷を踏まえて常用するか・拡張するか・打ち切るかを判断する。

## コスト目安

1クラスタあたり概算3,000〜6,000入力トークン ≈ $0.00013〜$0.00025（0.02〜0.04円）。
出力は無料想定。キットの規模感（検出クラスタは数件〜数十件オーダー）なら
月間コストは実質無視できる水準。ただしEarly Access段階のため料金体系が変わる可能性がある
（実行のたびに`usage`フィールドで実測トークン数を確認すること）。

## やらないこと（このPoCのスコープ外）

- CANONICAL CHECK13項目全体のJev化（新規実装のたび毎回発生するため影響範囲が大きい。見送り）
- `reality-checker`エージェントへのJev組み込み（「evidenceのみで成立」という設計思想と
  確率的判定は相性が悪いため、却下寄り）
- 既存Gate群への配線（オプトイン専用に留める）
- CLAUDE.mdへの新規ルール追記（PILOT-LOGで運用実績が数件貯まってから検討する）
- `_docs/DESIGN-canonical-boundary-rules.md`本文の変更（正本は変更せず、このHOWTOから
  片方向で参照するのみ）

## 関連ファイル

- 判定対象を出す既存Gate: [`templates/diagnostics/check-near-duplicates.mjs`](../../templates/diagnostics/check-near-duplicates.mjs)
- スクリーニング実行スクリプト: [`templates/diagnostics/screen-duplicate-clusters-with-jev.mjs`](../../templates/diagnostics/screen-duplicate-clusters-with-jev.mjs)
- 最終判定の正本: [`_docs/DESIGN-canonical-boundary-rules.md`](../../_docs/DESIGN-canonical-boundary-rules.md)（本文は変更しない）
- 運用実績ログ: [`_docs/PILOT-LOG-jev-duplicate-screening.md`](../../_docs/PILOT-LOG-jev-duplicate-screening.md)
- 外部知見の段階的格上げポリシー: `../../ai-hub/kb/external-decision-surface-governance.md`
- Jev公式ドキュメント: https://docs.typesafe.ai

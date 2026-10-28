# hands-free-runner — 人に渡す黒い画面のひな型

> **今の到達点: 採用（2026-10-28）。** 正本の決まり: [`docs/ai-rules/08_NO_HUMAN_HANDS.md`](../../docs/ai-rules/08_NO_HUMAN_HANDS.md) §4。
> 検査: [`templates/diagnostics/check-human-script-no-wait.mjs`](../diagnostics/check-human-script-no-wait.mjs)（`npm run diagnostics` に登録済み）。

## 何のためか

どうしても人の1タップが要る作業（本番の鍵の「発行」→コピー など）を、ダブルクリック1回の黒い画面で渡すときの骨組み。
これを使えば、次の4つが最初から守られる。

| 決まり | このひな型でどうなるか |
|---|---|
| Enter 待ち・pause を置かない | 待つのは `waitForClipboard`（コピーしたら自動で進む）か `waitForFile` だけ |
| 状態をファイルに書く | 段ごとに `~/.ai-runs/<名前>/state.json` と `log.txt` を書く。AI はフォルダ接続か Remote Control でそれを読む |
| 何度ダブルクリックしても途中から | 済んだ段は `state.json` に残り、次は飛ばす。止まった段から続く |
| `.cmd` は英数字だけ | `start.cmd.example` は英数字だけ。日本語の案内は `.mjs` が出す |

★秘密（コピーされた鍵）は状態ファイルにもログにも書かない。段の中の変数にだけ持つ（試験で確かめている）。

## 使い方

1. `runner.mjs` と `example.mjs` をコピーし、`example.mjs` の段（`steps`）を作業に合わせて書き替える。
   名前（`name`）は英小文字・数字・ハイフンだけ。これが状態フォルダの名前になる。
2. `start.cmd.example` を `<英数字の名前>.cmd` にしてデスクトップ等に置く（中身の `.mjs` のパスを合わせる）。
3. 人に頼むのは「ダブルクリック」と、残る1タップ（直リンクつき）だけ。画面に何が出たかは AI が `state.json` で見る。

`state.json` の中身（AI が見る場所）:

```jsonc
{
  "status": "waiting_human",          // new / running / waiting_human / failed / done
  "step": "receive-key",
  "stepTitle": "新しい鍵を受け取る",
  "waiting": { "what": "開いたページで「発行」を押して…", "url": "https://…" },
  "error": null,
  "done": { "…済んだ段": { "at": "…", "result": { "length": 40 } } },
  "updatedAt": "…"
}
```

## 先にコピーしてから起動し直す流れ

`waitForClipboard(pattern)` は既定で「始めた時点の中身」を無視する（前の古い鍵を拾わないため）。
コピー済みの値をそのまま受け取りたい段は `{ acceptExisting: true }` を付ける（2026-10-28、コピー済みなのに Enter 待ちで止まった実損）。

## 試験

```
node templates/hands-free-runner/runner.test.mjs     # npm run hands-free-runner:selftest
```

## このひな型が判定しないこと

そもそも人に渡さずに済まなかったか（公式 API で発行まで通らないか等）は意味の判断なので、08 の5段で先に確かめる。

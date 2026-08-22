# LP（site/index.html）と機能ページの同期ルール（AIが読む1枚）

> ★このファイルの目的: 「〈機能ページ〉の内容をLPにも反映させて」とだけ言われたとき、
> AIが毎回ゼロから構成を考え直さずに、機械的に正しい場所へ正しい形で反映できるようにする。
> （2026-08-22、何度も同じ指示を出させてしまった反省から新設）

---

## 0. 対応表（機能ページ → LPのどこに出ているか）

| 機能ページ | LP (`site/index.html`) 内の対応箇所 | 種別 |
|---|---|---|
| `features/health-check/`（けんこう診断・診断キット・常時診断・進化台帳・★4つ目の状態を1本化したページ） | `<!-- ⑥ -->` `<!-- ⑥.3 -->` `<!-- ⑥.5 -->` の3つの `.step.step-bonus`（`steps-grid` 内） | step 3個 |
| ★4つ目の状態（見張り役そのものが動いていないことの検出） | ★新しいstepは作らず `⑥.5` の `.step-detail` 内に段落を追加（進化台帳の一部として説明する） | stepの中の1段落 |
| 同上のAI指示（diagnostics / health-check / always-on-diagnostics / improvement-ledger） | `⑥.5` の直後にある `.ai-box-slot` 3個 | AI指示スロット（データ駆動） |
| `line-bot/`（LINE無応答ゼロ化） | `<!-- ⑧ -->` の `.step.step-bonus` 内、`.step-detail` 内の1段落 | stepの中の1段落 |
| `line-bot-features/`（画像・動画・音声認識） | 同上、`.step-detail` 内の別の1段落 | stepの中の1段落 |
| 同上2つのAI指示（line-bot / line-bot-features） | `apps/` 側の一覧に集約（LP本体には出していない） | — |
| `troubleshooting/`（つまずいたら） | `<!-- ⑤ -->` の `.step.step-bonus`（却下対応） | step 1個 |
| `learnings/`（実証知見） | `<!-- ⑦ -->` の `.step.step-bonus` | step 1個 |

★**「診断」に関するものは全部 `features/health-check/` 1ページに統合済み**（2026-08-22、
`features/diagnostics/` を統合して廃止）。新しい診断系の話が増えても、
**別ページは作らず** `features/health-check/` にセクションを追加し、LP側は既存の
⑥系stepを直すか、どうしても別テーマなら新しいstepを1つ追加する。

---

## 1. LPの `.step.step-bonus` テンプレート（コピーして使う）

LPの「やらなくていいけど、知っておくと安心」ゾーン（`.steps-grid` 内）は、
すべて次の形の繰り返し。新しい機能ページをLPに載せるときはこの形をコピーする。

```html
<!-- ⑨ 見出し（おまけ） -->
<div class="step step-bonus">
  <div class="step-top">
    <div class="step-circle">🔥</div>                 <!-- 絵文字1つ -->
    <div class="step-main">
      <h3>短い見出し<span class="badge-bonus">🎁 おまけ・安心材料</span></h3>
      <p class="one-line">1行で「何が嬉しいか」</p>
    </div>
    <div class="step-char">
      <img src="images/tanunee-smile.png" alt="たぬ姉">  <!-- たぬ姉 or りんく -->
      <span>たぬ姉</span>
    </div>
  </div>
  <div class="illust illust-green" style="flex-direction:column; gap:10px; align-items:stretch;">
    <div style="display:flex; align-items:center; justify-content:center; gap:8px; flex-wrap:wrap;">
      <div class="fbox"><span class="fi">🤒</span>状態1</div>
      <div class="farr">→</div>
      <div class="fbox ok"><span class="fi">🔧</span>結果</div>
    </div>
    <div style="text-align:center; font-size:0.75rem; color:#aaa;">1行の補足</div>
  </div>
  <button class="toggle-btn" onclick="toggle(this)">▼ くわしく見る</button>
  <div class="step-detail">
    2〜4文の説明。機能ページの「体調メモ」的な導入部を、専門用語を削って要約する。
    <div class="tip">💡 実例・数字（機能ページにある実測値をそのまま転記）。
    くわしくは <a href="features/xxx/" style="color:#667eea; font-weight:700;">◯◯のページ</a> へ。</div>
  </div>
</div>
```

★守ること:
- **絵文字キャラは「たぬ姉」= 注意点・安全性の話、「りんく」= 前向き・成長の話**で使い分ける
  （既存stepの割り当てを踏襲する。厳密な規則ではないが、混ぜるとキャラの一貫性が崩れる）。
- `.step-detail` の中身は機能ページの丸ごとコピーではない。**LPは要約、機能ページが本編**。
  詳しい表（`.ledger-table` 等）や複数の `.rule-box` はLPに持ち込まない。
- 実例・数字（「817秒→0.005秒」等）は機能ページと**同じ数字**を使う。LP側で丸めたり
  誇張したりしない（実測値の改ざんは信頼を一度で失う）。

---

## 2. AI指示ボックス（`.ai-box-slot`）はLPを直さなくても自動反映される

`assets/data/ai-instructions.json` が正本。`scripts/ai-box.js` が実行時に読んで
`<div class="ai-box-slot" data-ai-key="...">` へ描画する。

★**手順書のパスが変わった／指示文の文面を直したいだけなら、`ai-instructions.json` を
1箇所直せば、LPを含む全ページに自動で反映される。LP側のHTMLは触らなくていい。**

新しい機能ページを追加してAI指示ボックスも出したい場合だけ、次の2箇所を触る:
1. `ai-instructions.json` に新しいキーを追加（`order` / `page` / `indexLabel` / `title` / `text` / `note`）
2. LPの `.ai-box-slot` 群の並び（現在 `⑥.5` の直後）に
   `<div class="ai-box-slot" data-ai-key="新キー" data-ai-data-path="assets/data/ai-instructions.json"></div>`
   を1行追加

★同じ `page` を持つキーが複数あっても、「AIへの指示 一覧」（フッター直前・`site-chrome.js` が
自動挿入）では代表1件だけが表示される。**1機能ページ＝複数キーでも一覧は1行**になる設計なので、
指示文を分けたいがために別ページを作る必要はない。

---

## 3. 「〈機能ページ〉の内容をLPにも反映させて」と言われたときの手順

1. 対応表（0章）でLPのどのstepに当たるか確認する。まだ無ければ「1章」のテンプレートで新設する。
2. 機能ページの最新の説明・数字を読み、**要約**して `.step-detail` に反映する
   （丸ごとコピーしない。上の「守ること」参照）。
3. AI指示の文面だけが変わったのであれば、`ai-instructions.json` を直すだけで足りる
   （LP側のHTML変更は不要。2章参照）。
4. `apps/index.html` のカード文言も、機能ページの説明が大きく変わったなら合わせて見直す
   （`site/apps/index.html` の `.card` 群）。
5. `site/sitemap/sitemap-manifest.json` の該当行のラベルも実態とズレていないか確認する。
6. プレビューサーバー（`.claude/launch.json` の `site` 設定）で実際にレンダリングを確認してから
   コミットする（`.ai-box` にエラー文言が出ていないか、`.step-detail` のリンク先が正しいか）。

★**新しい機能ページを作るとき**は、最初から対応表（0章）に1行追記しておく。
次に「LPにも反映して」と言われたとき、この表を読むだけで迷わず動けるようにするため。

# 診断画面が開かないときに測る — 実測の最後の手段

> ★これは「計器が壊れた/重すぎて開かない」ときに、★**それでも数字を取る**ための手順。
> 規約は [`IMPROVEMENT-RULES.md`](IMPROVEMENT-RULES.md)、書き方は [`HANDOFF-new-app.md`](HANDOFF-new-app.md)。

---

## 0. ★なぜこの1枚が要るのか

計器は「アプリが重い」ときにこそ読みたい。
★**ところが重いときは、その計器の画面自体が開かない。**

```
ユーザー: 「診断が重くて開かないです」
```

★これは実際に起きた（`tsuioku-no-kirameki.com` 2026-08-22）。
★**計器を作れば作るほど、一番必要な瞬間に読めなくなる**という構造的な弱点がある。

★ここで「速報を貼ってください」と頼むと、★**ユーザーが開けないものを頼む**ことになる。
開発者（AI）が自分で測るしかない。

---

## 1. ★大原則: 症状の出ている画面で測らない

★重い画面をさらに操作すると、★**測定が症状を悪化させる**
（`tsuioku` は「測定タブ自身が症状を作った」を実際に踏んでいる）。

```
✗ ユーザーの画面で診断を開かせる     → 開かない・さらに重くなる
✅ ★別インスタンスで【同じ規模を再現】して測る
```

★**再現に必要なのは「実データ」ではなく「実規模」**であることが多い。
今回の例なら「857人ぶんのタイル」を合成すれば足りた。

---

## 2. 手順（Chrome拡張の例・他でも同じ形）

### ① 出荷物を別インスタンスに読ませる

```
mcp__chrome-devtools__install_extension { path: "<repo>/extension" }
mcp__chrome-devtools__new_page { url: "chrome-extension://<id>/popup.html" }
```

★ユーザーのブラウザとは**別プロセス**なので、症状を悪化させない。

### ② ★まず基準値（何もしていない状態）を取る

```js
() => ({ domTotal: document.getElementsByTagName('*').length })
// → 1,100
```

★**基準が無い数字は読めない。** 先に取る。

### ③ 症状の規模を合成して、同じ数字を取る

```js
() => {
  const before = document.getElementsByTagName('*').length;
  // ★実物と同じクラス構成でN個作る（CSSが効く形にすること）
  for (let i = 0; i < 857; i++) lane.appendChild(makeCell());
  const after = document.getElementsByTagName('*').length;
  return { before, after, added: after - before, perTile: (after - before) / 857 };
}
// → 1,100 → 5,385 / perTile 5
```

### ④ ★「効いているはずの対策」が本当に効くか、CSS規則を直接読む

★これが今回いちばん効いた。

```js
() => {
  const out = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }  // ★別オリジンは読めない
    for (const r of rules) if ((r.selectorText||'').includes('対象ID')) out.push({ sel: r.selectorText, css: r.style.cssText });
  }
  return out;
}
```

★結果:
```
#...Tanu > .cell:nth-child(n+25)[data-thumb="0"] { gap:0; padding-right:0 }
#...Tanu > .cell:nth-child(n+25)[data-thumb="0"] .avatar { width:22px; height:22px }
```
⟹ ★**この規則は「小さくする」だけで、枚数は1枚も減らさない。**
　 「LODを入れたから大丈夫」という思い込みが、★規則の実文で否定された。

### ⑤ 器の制約を読む（伸びる方向を決めているもの）

```js
() => { const cs = getComputedStyle(el); return { display: cs.display, flexWrap: cs.flexWrap, maxHeight: cs.maxHeight, overflow: cs.overflow }; }
// → flex / wrap / none / auto
```
⟹ ★`wrap` かつ `max-height:none` ＝ **下に無限に伸びる**。上限が無ければ画面を突き抜ける。

---

## 3. ★測れなかったときは「測れなかった」と言う

今回、★**高さ(px)は測れなかった**。素の popup では親が `display:none` で、
レイアウト文脈が実機と違うため。

```
laneH: 0  ← ★これは「高さ0」ではなく【測れていない】
```

★ここで 0 を「異常なし」と読むと誤診になる（3値規約の `inconclusive`）。
★**測れた事実（DOM数・CSS規則・器の制約）だけで結論を出し、
　 測れなかったこと（実際の高さ）は測れなかったと書く。**

---

## 4. ★この方法の限界（必ず添えること）

```
・別インスタンス＝ユーザーの storage・タブ構成・拡張の組み合わせは再現していない
・「ここで再現した＝実機の原因」ではない
・レイアウトは文脈依存。素のページでは実機と違う値が出る
```

★それでも★**「上限が無い」「規則が枚数を減らさない」は実装の事実**なので、
　 環境に関係なく成立する。★**環境に依存しない事実から先に確定させる**のが要点。

---

## 5. まとめ（次に困ったときの順番）

```
1. ユーザーの画面では測らない（悪化させる）
2. 別インスタンスに出荷物を読ませる
3. ★基準値を先に取る
4. 症状の規模を合成する
5. ★「効いているはずの対策」の実文を読む ← 思い込みはここで壊れる
6. 器の制約（wrap / max-height / cap）を読む
7. ★測れなかったものは「測れなかった」と書く
```

★**「速報を貼ってください」と頼む前に、この7手を試すこと。**

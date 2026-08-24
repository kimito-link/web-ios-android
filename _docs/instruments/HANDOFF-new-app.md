# 新しいアプリに計器を入れるとき（AI が読む1枚）

> ★この1枚だけで着手できる粒度で書いてあります。
> 思想の背景は [`README.md`](README.md)、根っこの思想は
> [`../../docs/ai-rules/04_SELF_VERIFICATION.md`](../../docs/ai-rules/04_SELF_VERIFICATION.md)。
>
> ★**web-ios-androidキットを使っていないプロジェクトでも、この1枚だけ読めば同じ手順で使えます。**
> `scripts/lib/instrument-core.mjs`（依存ゼロ・純Node）を
> [ここから直接取得](https://github.com/kimito-link/web-ios-android/blob/main/templates/scripts/lib/instrument-core.mjs)
> して、自分のプロジェクトの `scripts/lib/` 等にコピーしてから読み進めてください。

---

## 0. ★最初に結論（これだけ守れば事故らない）

```
★検査は「合格 / 不合格」の2値で書かない。必ず3値にする。
   0 = 合格
   1 = 測れた上での赤
 ★2 = 測れなかった   ← ★これを 0 と同じ緑に数えない
```

★**「何も測っていないのに合格」は、赤より危険**です。
壊れていることに**誰も気づけない**（機能しているように見える）。

★このキット自身が 2026-08-17 に踏みました:

```
audit-native-cta.mjs を引数なしで実行
  → 何も走査せず「✅ 0件」と表示  ＝ ★偽の緑（commit fc3a8e3 で対処）
```

### ★作業を始める前に「全文脈の入口」を作る

計器を1本ずつ入れる前に、次の4ファイルも `templates/scripts/` から `scripts/` へコピーします。

```
context-engine.mjs          … 全ファイル・全Git履歴・現在の差分・判断台帳を1枚へ集約
context-evolution.json      … 確定 / 却下 / 未確定の判断を証拠つきで残す台帳
run-instruments.mjs         … 途中が黄/赤でも止まらず、全計器を最後まで測る入口
generate-shindan-version.mjs … 本体の /check-shindan-version/ を生成・更新
```

```bash
node scripts/context-engine.mjs --write .instrument-context.md
node scripts/run-instruments.mjs --deep --report .instrument-report.json
node scripts/generate-shindan-version.mjs
```

詳しい規約は [`CONTEXT-EVOLUTION.md`](CONTEXT-EVOLUTION.md) と
[`SHINDAN-VERSION-PAGE.md`](SHINDAN-VERSION-PAGE.md)。
★会話だけにある判断は自動取得できません。検証後の結果を `--record` で台帳へ戻して、
次のAIが同じ地雷を踏まないところまでが1回の作業です。

---

## 1. いつ使うか

| 場面 | 使うか |
|---|---|
| 出荷前に何かを検査するスクリプトを書く | ★**必ず使う** |
| 「〜が正しく設定されているか」を確かめる | ★**必ず使う** |
| CI / husky から呼ぶゲートを作る | ★**必ず使う** |
| 1回きりの調査スクリプト | 任意（ただし3値は守ると楽） |

---

## 2. 使い方（コピーして書き換えるだけ）

`scripts/lib/instrument-core.mjs` は**依存ゼロ・純Node**です。
web-ios-androidキットには同梱済み。それ以外のプロジェクトでは上記リンクからコピーしてください。

```js
#!/usr/bin/env node
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';

const SELFTEST = process.argv.includes('--selftest');

function probe() {
  const files = findTargets();            // ★あなたの検査対象

  // ★対象が0件なら「合格」ではない。測れなかった。
  if (files.length === 0) {
    return {
      probe: '〜の検査',
      verdict: 'inconclusive',
      detail: '対象が1件も見つかりませんでした',
      howToFix: '対象のパスを確かめる。まだ作っていないなら、それは正常'
    };
  }

  const bad = files.filter(isBad);
  if (bad.length) {
    return {
      probe: '〜の検査',
      verdict: 'fail',
      evidence: { 検査: files.length, 違反: bad.length },   // ★数字を必ず出す
      detail: `違反: ${bad.join(', ')}`,
      howToFix: '★読んだ人がそのまま直せる文にする（逃げ道も書く）',
      limitation: '★この検査が判定しないこと（過信を防ぐ）'
    };
  }
  return {
    probe: '〜の検査',
    verdict: 'pass',
    evidence: { 検査: files.length, 違反: 0 },              // ★これが無いと自動降格
    limitation: '★〜は見ていません'
  };
}
```

### ★`evidence` を書き忘れると、勝手に `inconclusive` に落ちます

```js
// normalizeProbeResult の実装（instrument-core.mjs:82）
if (verdict === 'pass' && (!evidence || Object.keys(evidence).length === 0)) {
  verdict = 'inconclusive';   // ★根拠なき緑は名乗らせない
}
```

★**これは仕様です。** 「何件を検査して何件が違反だったか」を言えない緑は、
緑として扱いません（fail-closed の最小実装）。

### 出力と終了コード

```js
console.log(formatProbeReport([r], { label: 'check-〜' }));
process.exit(computeExitCode([r]));
```

★`computeExitCode` は **fail > inconclusive > pass** の優先順。
★**結果が0件なら `INCONCLUSIVE`**（何も測っていないので緑にしない）。

---

## 3. ★`--selftest` を必ず付ける（これが無いと仕掛けは死にます）

★**仕掛けの生死は「サボると赤くなるか」だけで決まります。**
検知器が壊れていても、誰も気づかなければ永久に緑です。

```js
if (SELFTEST) {
  const { ok, fails } = runSelfTest([
    {
      name: '違反を検知する',
      poison: () => writeFileSync(tmp, '★わざと違反した中身'),
      restore: () => rmSync(tmp, { force: true }),   // ★finally で必ず戻る
      isRed: () => probe().verdict === 'fail'
    },
    {
      name: '★0件を緑にしない',
      poison: () => {}, restore: () => {},
      isRed: () => probeWithNoTargets().verdict === 'inconclusive'
    }
  ]);
  if (!ok) { fails.forEach((f) => console.error('  - ' + f)); process.exit(EXIT.FAIL); }
  console.log('selftest OK');
  process.exit(EXIT.PASS);
}
```

### ★毒は「状態に依存しないもの」にする

★収穫元の失敗記録: 「特定の項目が todo である前提」に依存した selftest は、
★**その項目を実装した瞬間に壊れました**。

---

## 4. ★★一番踏みやすい罠：「毒を入れた」と「毒が入った」は別物

★追憶は 2026-08-21 に**この穴を2回**踏み、★**空振りした毒で「緑」を読みかけました**。

```
検知器を壊して赤を確認しようとしたら「✅ OK」
  → ★置換が空振りしていて、毒が1文字も入っていなかった
  → 毒が入っていないのだから当然緑。それを「合格」と読みかけた
```

★**手順として固定してください:**

```bash
# 1. 毒を入れる（★置換が0件ならエラーで落ちるようにする）
node -e "... if(s===before){console.error('★POISON DID NOT APPLY');process.exit(9);}"

# 2. ★毒が入ったことを grep で数えて確認する
grep -c 'POISONED' target.mjs        # ← ★1 以上であること

# 3. それから赤かどうかを見る
node target.mjs --selftest; echo "exit=$?"   # ★1 なら検知器は生きている

# 4. 復元して緑に戻ることを確認
```

★送信サジェスト側は `Invoke-WithPoison` というヘルパにして、
★**置換が0件なら即エラー**にしました。作った当日に**作者自身の間違った置換**を止めています。

---

## 5. ★やってはいけないこと（実損つき）

### ✗ 名前だけを見る検査を書く

```js
// ★悪い例
hasGuard: /Assert-Measured/.test(code)
```

★**名前を変えて黙らせることを誘います＝有害。**

実損（追憶・2026-08-21）:
```
audit-gates.mjs が raw（コメント込み）を見ていた
  → ★コメントに「直し方」と書くだけで ✔ が取れた
  → 実コードだけを見るよう修正 → 5/13本 → 11/13本 が赤に
  ＝ ★6本が偽の緑だった
```

→ ★**形（SHAPE）を見る。** 実コードだけを対象にする（コメント・文字列は除く）。

### ✗ 「exit 2 を持っているか」で正しさを判定する

★実測（送信サジェスト・2026-08-21）: 壊れていた3本のうち★**2本は exit 2 を持っていた**。
★所有の検査は**入口**でしかありません。

### ✗ 「測れなかった」を表す値を判定式に素通しさせる

| 穴 | 結果 |
|---|---|
| `-1`（測れなかった）が `-le 0` を通る | ★偽の**赤** |
| `null` が `Number()` で `0` になる | ★偽の**緑** |

★追憶は `Number(null) === 0` を**1日に4回**踏みました。
→ `typeof v === 'number'` で明示的に弾く。★**判定より前に「測れたか」を確かめる**。

### ✗ 一括強制のゲートにする

```
✗「書かないと赤」   → 強制すると【嘘の数字】が入る
✅「間違って書くと赤」 → ★ベースライン＋ラチェット
```

★このキットで死んだ仕掛けは全部「一度に全部直せ」と迫るものでした。
★既存の借金は許容し、**新規だけ赤**にする。

---

## 6. ★方向は数字から推測しない（数値を追うなら必読）

「小さいほど良い」を既定にすると事故ります。実データ（追憶の changelog 1,349版）:

```
100% → 0%     ★改善（エラー率が消えた）
2回 → 13回    ★改善（描画が動くようになった）
3秒 → 12秒    ★改善（取りこぼしを無くした）
```

★決め打っていたら、この3件を**全部「退化」と誤判定**していました。

→ ★数値を追うなら [**IMPROVEMENT-RULES.md**](IMPROVEMENT-RULES.md) を先に読んでください。
＝ ★**正しく直した人を止める**。検査への信頼は一度で消えます。

→ 方向は**指標ごとに宣言**する（`better: 'lower' | 'higher'`）。

---

## 7. 完了の判定（機械で確かめられること）

```bash
node scripts/〜.mjs --selftest ; echo "exit=$?"   # ★0 であること
# ★毒を入れて 1 になり、復元で 0 に戻ること（4章の手順で）
node _docs/instruments/check-drift.mjs            # 土台が割れていないか
node scripts/generate-shindan-version.mjs --selftest
# ★本体の /check-shindan-version/ が開き、未計測を完了に数えていないこと
```

★**チェックリストを人の善意で運用しない。** 検査が赤くなる形にしてください。

---

## 8. ★4つ目の状態「そもそも走っていない」（★2026-08-22 実装済み）

> ★3値規約には**4つ目の状態**があります: 「そもそも走っていない」。

実測（送信サジェスト・自リポの履歴）:
```
★8/8  : 実測値を1つ書き間違え、8日間ラチェットが赤のまま
★8/17 : コミット時に走らせ忘れ、また赤のまま
   → ★どちらも「値が悪化した」ではなく「検査が走っていなかった」
   → ★入口ゲートだったので、赤の間プローブが1本も走っていなかった
```

★**「赤いまま放置できる検査」は、緑と同じくらい危険**です。

### ★解き方（`check-instrument-ran.mjs`）

★走らなかった検査は**何も出力しない**。出力が無いことは検査自身には観測できない
（動いていないのだから）。→ ★**外に記録を置き、常に前へ進むもの（コミット）と突き合わせる**。

```bash
# ★配線: && で繋ぐ。赤なら stamp は打たれない＝放置すると距離が開いて鳴る
node scripts/check-improvement.mjs --check && node scripts/check-instrument-ran.mjs --stamp improvement

# 放置の検出（既定: 10コミット）
node scripts/check-instrument-ran.mjs --check
```

実地確認（2026-08-22）: ★検査を走らせずに12コミット重ねる →
`🟡 「improvement」が 12 コミットのあいだ緑になっていません` / ★**exit 2**。
走らせ直すと緑に戻る。

★**fail(1) ではなく inconclusive(2)** にしてある。「走っていない」は【測っていない】
のであって【悪化した】のではない。★赤にすると "とりあえず stamp を打って黙らせる"
動機を作る（台帳を強制して嘘の数字を招いたのと同じ失敗）。

### ★この仕掛けの限界（承知の上で使ってください）

★**手で `--stamp` を打てばだませます。** これは「うっかり」を捕まえる仕掛けであって、
★意図的な回避を防ぐものではありません。だから stamp は★**検査が緑を返した経路からのみ**
呼んでください（上の `&&`）。

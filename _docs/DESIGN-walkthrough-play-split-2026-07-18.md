# 設計: walkthrough/play/index.html の分割方針

> 3段構え（会議ハーネス→Fable設計→実装ハンドオフ）の手順2の産物。
> 設計＝Fable（claude-fable-5）／裏取り＝司令塔（Claude、Sonnet 5）／2026-07-18。
> 前セッションの引き継ぎ: [`HANDOFF-walkthrough-play-split-2026-07-17.md`](./HANDOFF-walkthrough-play-split-2026-07-17.md)

## 結論（先に一言）

**分割は見送る。ただし「何もしない見送り」ではなく、単一ページのままページ内構造化を強化する「見送り・強化型」を採る。**

裏取り済みの事実（司令塔が実ファイルで確認済み）:
- `walkthrough/play/index.html` は現在、**サイト内で唯一 BreadcrumbList JSON-LD も視覚パンくずも無いページ**。兄弟ページ `walkthrough/ios/index.html`（1〜31行目）は BreadcrumbList JSON-LD + `common.css?v=1` を既に本番で持つ確立済みパターン。
- `walkthrough/play/`・`walkthrough/chrome/`・`walkthrough/index.html` は `BreadcrumbList` grep 済み → ios/・chrome/・indexは有り、**play/だけ無い**ことを確認済み。
- サイト内から `play/#step-N` への内部ディープリンクはゼロ（流入は全て `walkthrough/play/` ルート宛て）。
- `scripts/verify-internal-links.mjs` は `href`/`src` 両方を実在検証する（画像パス切れも拾う）。

## A. 理想の体験フロー

読者は Play Console を別タブに開きながら本ページを**作業伴走マニュアル**として上から舐める。howto/の読者（4トピックのうち必要な1つだけ読む）と違い、**play/の読者は100%が step-0〜6 を全部・順番に・1セッションで消費する**。ページ内でのページ遷移は発生させず、Console側タブとの往復だけで完結させるのが理想。

## B. 統合アーキ（採用方針と理由）

判断基準は「読者の1訪問あたり消費単位（visit unit）」。

| | howto/（分割済み） | walkthrough/play/（今回） |
|---|---|---|
| コンテンツ性質 | 独立4トピック | 単一連続ワークフロー |
| visit unit | 1トピック（全体の約1/4） | **全工程（=ページ全体）** |
| 分割の効果 | 読まない3/4を省略できる＝読者の得 | 結局全ページを踏む＝節約ゼロ、遷移コストだけ純増 |

分割が正当化されるのは「visit unit ＜ ページ」のときのみ。play/はどの境界で切っても読者の利益が発生しない（②「先に③へ進んでよい」、③の警告が⑥⑦を参照、⑤の赤エラー解説が⑥を参照、`#step-help`が④⑤⑥⑦を参照、という密結合構造のため）。

会議の批判役（gpt-oss-120b）の「遷移コストを定量評価せず分割最適と言うな」という指摘は、このページに関しては定性的に決着する: 全読者が全ページを踏む構造では遷移コストの期待値は必ず正、便益は0。

### コンポーネント4つの役割分担
1. **ページ本体** — step-0〜7 / step-help の文言・スクショは一切動かさない。
2. **構造化データ層（head内）** — `@graph` に HowTo（8 HowToStep、各 `url` は `#step-N` フラグメント）＋ BreadcrumbList を追加。
3. **ナビ層（視覚）** — ios/と同一マークアップで視覚パンくずを追加、common.cssを同じ位置に読込。
4. **CI検証層** — `verify-internal-links.mjs` に RULE 4（play予約id）を追加。JSON-LDのフラグメントURLは絶対URLで検証対象外のため、`id="step-N"`の生存をfail-closedで保証する唯一の機構。

## C. 具体機構

変更ファイルは2つのみ（新規ページ・リダイレクトJSは作らない）。

### C-1. `site/walkthrough/play/index.html` — head にJSON-LD＋common.css追加
15行目`<link rel="icon">`の直後・`<style>`の前に、HowTo（8 HowToStep、`step-help`は含めない＝工程でなくトラブルシュートのため）＋BreadcrumbList（第3要素`"Google Play Console"`、ios/の`"App Store Connect"`と同形式）の`@graph`と`<link rel="stylesheet" href="../../assets/css/common.css?v=1">`を追加。

### C-2. 視覚パンくず＋footer衝突ガード
- 234行目`<a class="top-link">`直後にios/と同一パターンの`<nav class="breadcrumb">`を追加。top-linkは`../` （追体験トップ）に変更。
- **footer衝突ガード必須**: common.cssの`footer{background:#1a1a2e;...}`とplay/のインラインfooterスタイルが衝突し濃紺フッター帯が出る。インライン`<style>`末尾に`.wrap footer{background:transparent;color:inherit;text-align:left;padding:18px 0 0;}`を追加。同じ穴がios/にも潜在（別コミットで推奨）。

### C-3. `scripts/verify-internal-links.mjs` — RULE 4（play予約id）
RULE 3ブロック直後に、`step-0`〜`step-7`・`step-help`の実在をfail-closedで検証するブロックを追加（詳細はFableの設計原文参照）。

### C-4. 検証コマンド
```
node scripts/verify-internal-links.mjs
node scripts/verify-claims-coverage.mjs
```
JSON-LD構文はGoogleリッチリザルトテストで本番URL投入し目視確認。

## D. ページ遷移コストの緩和策（批判役への回答）

緩和策は「発生させない」こと自体。分割＋要点サマリ複製等の緩和策は、claims.json同期問題と同種の「二重管理ドリフト」を新規に生む。既に (1) 冒頭roadmap、(2) 各step末尾のstep-next誘導、(3) scroll-behavior:smooth、(4) `#step-help`からの逆引きアンカー、の4つの現在地装置が入っており、1157行で装置ゼロだった旧howto/とは条件が違う。

## E. MVP（最初に作る最小スコープ）

1コミットで完結:
1. `walkthrough/play/index.html`: JSON-LD＋common.css読込＋視覚パンくず＋top-link修正＋footerガード1行
2. `verify-internal-links.mjs`: RULE 4追加
3. 検証実行＋ブラウザ目視（パンくず表示・フッター白背景・画像表示）

**MVPに入れないもの**: 進捗バー/スクロールスパイ（過剰設計）、ios/のfooterガード（別コミット推奨）、chrome/へのHowTo横展開（Search Console反応を見てから）。

## F. 捨てた案と理由

- **9分割（step単位）**: 最小ページは24行、ボイラープレートが約250行/ページ。thin content化して逆効果。即却下。
- **3〜4分割（会議で最有力だった案）**: (1) visit unit論で便益ゼロ・遷移コスト純増。(2) 提案境界が本文の相互参照と矛盾（②③・③⑥⑦・step-helpの4ページ跨り逆引きが解消不能）。(3) システム境界（step-4前後）での分割は地雷5（③→④→⑤の前後関係維持）が禁じる。
- **Hub & Spoke**: 冒頭roadmapが既にゼロ遷移でハブ相当を提供済み。
- **単一＋分割ページ併存**: 二重管理ドリフトのリスクで却下。
- **完全な現状維持**: BreadcrumbList欠落という実在の穴があり、改善ゼロとは別物。「見送り・強化型」に倒した。

## G. 地雷と回避策（最終チェックリスト）

1. claims-box・claims.jsonには一切触れない（`verify-claims-coverage.mjs`は現状維持で緑のはず）。
2. 予約id（RULE 4）でfail-closed保証。内部ディープリンクは元々ゼロで外部ブックマークも壊れない。
3. common.css読込は必ずインライン`<style>`より前。footer衝突ガード1行を忘れると濃紺フッター帯が出る＝実装後に目視必須。
4. ③→④→⑤の前後関係は本文無変更のため保存される。JSON-LDのtextにも明記済み。
5. step-5の順番厳守はmini-stepsのリスト無変更＋JSON-LD textに「…の順で」を明文化。
6. 画像パスはファイル移動ゼロのためリスク自体が消滅。`verify-internal-links.mjs`はsrcも検証するのでタイポもCIで落ちる。
7. guide/（id構造なしで見送り）とplay/（id構造ありだが visit unit=ページ全体で見送り）は論拠が別だが判断は一貫。**今後の分割判断基準は「id構造の有無」でなく「読者の1訪問あたり消費単位がページより小さいか」に統一する**（知見の書き戻し対象）。
8. JSON-LDのHowToStep urlはcanonical（`https://web-ios-android.vercel.app/walkthrough/play/`）＋フラグメントで統一。相対URL・www付き・vercelプレビューURLを混ぜない。
9. `common.css?v=1`は既存と同じv=1を使う（common.css自体は変更しないため）。

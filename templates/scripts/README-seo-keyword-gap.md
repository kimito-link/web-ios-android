# 検索語1つ → ページ1枚（seo-keyword-gap）

サービスのサイトの SEO を強めるときの共通の手順と道具（2026-11-11）。

## 考え方

「Search Console のキーワード1つにつき、Google が上位に出す理由のあるページを1枚作る」。
検索した人が知りたいことに、そのページだけで答え切る。1ページで何語も取りにいかない。

1. **検索語を集める**
   - Search Console のデータがあれば本命: 「表示回数はあるのに 8 位より下」のクエリ（見られているのに選ばれていない）。
   - 無いとき（新しいサイト・AI から Search Console に入れないとき）は、Google の検索候補（オートコンプリート）で
     「人が実際に打つ言葉」を広げる。無料・登録不要。
2. **サイトのページと突き合わせる** — sitemap.xml の各ページの title と h1 に、検索語の語がすべて入っているか。
   入っていなければ GAP（受けるページが無い）。
3. **GAP のうち、商品と合うものだけページにする** — 商品に無い機能の検索語（例: 目覚まし機能が無いのに「推しの声 目覚まし」）は作らない。
   中身と食い違うページは、検索から来た人の信用を落とす。
4. **既にある中身で答えられるなら、新しく作らず題名と説明文を合わせる**（例: exosome の `/treatment/choose/` を
   「エクソソーム点滴は危険？」に）。ページを増やすより速く、取り合いも起きない。
5. 1枚ごとに: title・description・canonical・h1 を検索語に合わせる／FAQ があれば FAQPage の構造化データ／
   sitemap に載せる／関連ページから1本リンクを張る。

## 道具

```bash
# Search Console が無いとき（検索候補で広げる）
node templates/scripts/seo-keyword-gap.mjs --base https://malwarecheck.site \
  --seed "ホームページ 改ざん" --seed "マルウェア チェック"

# Search Console の CSV があるとき（検索パフォーマンス → クエリ → エクスポート）
node templates/scripts/seo-keyword-gap.mjs --base https://reviewcheck.jp --gsc queries.csv
```

- 出力の最初に「サイトマップにあるのに開けないページ」が出たら、先に直す（2026-11-11 reviewcheck で 404 が3件見つかった）。
- `--json` で JSON。終了コード 2 は「sitemap が読めない／検索語が0件」——比べていないのに「GAP なし」と見せないため。
- 判定は title と h1 だけ（本文は見ない）。題名と見出しに無い語では検索結果で選ばれにくいので、そこに合わせる。
- 純粋な判定は `lib/seo-keyword-gap-core.mjs`（テスト: `lib/seo-keyword-gap-core.test.mjs`）。

## Search Console をAIが直接読むには

いまは AI から Search Console に入る道が無い（公式の接続先が無く、届くメールにも検索語は載らない）。
Search Console API をサービスアカウントで読む形にすれば以後は人の手が要らないが、鍵の発行は人の仕事
（[08_NO_HUMAN_HANDS.md](../../docs/ai-rules/08_NO_HUMAN_HANDS.md)）。それまでは検索候補で回す。

## 2026-11-11 に回した結果（最初の1周）

| サイト | やったこと |
|---|---|
| reviewcheck.jp | 「口コミ 返信 例文」のページ／sitemap の 404 を3件外す（PR #47） |
| malwarecheck.site | 「ホームページ 改ざん」のページ／sitemap の漏れ4件（PR #242） |
| voice.kimito.link | robots.txt・sitemap.xml・canonical が無かったので足す（PR #89） |
| surechigai.kimito.link | 「聖地巡礼 記録 アプリ」のページ（PR #111） |
| exosome.kimito.link | 「エクソソーム 点滴 危険」に既存ページの題名を合わせる（PR #48） |

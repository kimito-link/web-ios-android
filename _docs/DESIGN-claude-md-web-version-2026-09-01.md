# 設計: kimito-skill.link を「CLAUDE.mdのWeb版」として成立させる構造改修

設計=Fable（claude-fable-5） / 素材収集=マルチLLM会議3体（統括役1体はタイムアウト） / 統合・裏取り=司令塔
日付: 2026-09-01 ／ 3段構えワークフロー（council-fable）の手順2産物

## 発端

kimito-skill.linkは「このサイトはCLAUDE.md（AI開発の総合ルール）の可視化です」という主張をヒーローに
掲げているが、実際には知見が追加されるたびにAIエージェントがsite/learnings/index.html等へカードを
1つずつ追記するだけで、人間もAIも「どこに何が増えたか」を確認できない構造になっていた。ユーザーが
新規カードを探せず「いったいどこにあるの？」と質問し、「そもそもいまのように人間が確認できなければ
AIも人間も確認漏れが出て当然では？」と構造上の欠陥を指摘。「会議して人間もAIがみても確認できる
claude.mdのWEB版ってことで」と、この問題自体をcouncil-fableで検討するよう依頼された。

## 前提の確定（司令塔による実測）

| 事実 | 検証結果 |
|---|---|
| learnings/はh2が16個・idを持つのは1つのみ(`multi-session`) | 確認済み（grep実測） |
| llms.txtのCanonical pagesにlearnings/が無い | 確認済み（実ファイル読み取り） |
| 「このページの地図」パターンが今日の別会議で実装済み | 確認済み（`site/index.html`の`<nav id="page-map">`） |
| `scroll-margin-top: 72px`が既存パターンの値 | 確認済み（`site/index.html:400`） |
| `verify-all.mjs`はpackage.jsonの`*:selftest`を自動収集する | 確認済み（`scripts/verify-all.mjs:54-79`） |

## 会議の結論とFableの裁定

会議3体中2体が実質回答（統括役はタイムアウト）。批判役(gpt-oss-120b)は発散役の「GitHub Actions
でビルド」「Lunr.js検索」案を**ビルドツールなし制約への違反**として却下——これをFableも支持した。
ただし批判役自身の代替案（`<script type="text/markdown">`によるクライアント変換）はFableが**棄却**
した。理由: 非JS読者（AIクローラー）に本文が見えなくなり、今日確立した「静的HTMLが唯一の構造情報」
原則と正面衝突するため。

## 裁定（「Web版」を名乗る要件の確定）

「Markdownの自動ミラー」ではなく、以下4条件を満たすことと定義する：

1. 全知見に恒久アドレスがある（アンカーid）
2. 全体の地図が静的HTMLで存在する（非JS読者にも見える）
3. 新着が時間軸で追える（最近の更新ブロック）
4. 1〜3の整合が機械検査されている（検査していない規範は守られない、を実証済みのキット自身のKBに従う）

本文の同期は従来どおり人手（AIエージェントの追記）で行い、**構造の破れだけを機械が止める**。

## B. 統合アーキテクチャ（新規・変更4点）

| # | コンポーネント | 種別 | 役割 |
|---|---|---|---|
| ① | learnings/の「このページの地図」 | 変更 | `site/index.html`のpage-mapパターンを再利用。全h2にid付与＋アンカー×役割1行の静的nav |
| ② | 「最近の更新」ブロック | 変更 | 地図の直上。日付降順・最大10行、人手追記 |
| ③ | `scripts/verify-learnings-map.mjs` | 新規 | h2のid漏れ・地図の載せ漏れ・空リンクを検出。`:selftest`でverify-allに自動編入 |
| ④ | `site/llms.txt` | 変更 | Canonical pagesにlearnings/を追加＋CLAUDE.md本体との正本序列を明記 |

正本は増えない：知見本文の正本はCLAUDE.md、learnings/はその読み物版、地図はlearnings/自身の目次、
llms.txtは入口のポインタのみ（地図の複製はしない）。

## C. 具体機構

### C-1. アンカーid命名規則
- 小文字英数字とハイフンのみ、2〜4語のケバブケース。絵文字・日本語・連番は禁止
- 主題を表す（例: `north-star`, `ios-appstore`, `ai-maze`）
- **公開後は改名・削除しない**（外部からのディープリンクを壊すため）。既存の`multi-session`はそのまま維持

### C-2. HTML構造（h1直下、上から順に）

```html
<!-- 最近の更新：新着を時間軸で追うための人手管理リスト。
     カード追記時に必ず1行足す。最大10行・古い行から削除。 -->
<section class="recent-updates" id="recent-updates" aria-label="最近の更新">
  <div class="page-map-title">📅 最近の更新</div>
  <ul>
    <li><time datetime="2026-09-01">2026-09-01</time> <a href="#ai-maze">「AIと迷路を歩いている感」の話</a> を追加</li>
  </ul>
</section>

<!-- このページの地図：全カードの静的インデックス。site/index.htmlのpage-mapと同パターン。
     非JS読者(AIクローラー)にはこれが唯一の全体構造情報。静的HTMLのまま維持すること。 -->
<nav class="page-map" id="page-map" aria-label="このページの地図">
  <div class="page-map-title">🗺 このページの地図</div>
  <ul>
    <li><a href="#north-star">北極星（ブレない原則）</a><span>全プラットフォーム共通の設計原則</span></li>
    <!-- …全16件、h2と1対1 -->
  </ul>
</nav>
```

- 「最近の更新」を地図より**上**に置く（今回の困りごとは「新着が探せない」であり最頻用途を最短距離に）
- 既存カードの本文・並び順は変更しない（並べ替えはgit差分を巨大化させる。時間軸の要求は
  「最近の更新」ブロックが担う）
- `.page-map`系CSSと`scroll-margin-top: 72px`を対象全idへ`<style>`内に追加

### C-3. verify-learnings-map.mjs（新規）
- RULE 1: 全`<h2>`がidを持つ
- RULE 2: 全h2のidが`#page-map`内のリンクに載っている
- RULE 3: `#page-map`・`#recent-updates`内の全アンカーが実在するidを指す
- RULE 4: `#recent-updates`の各行が`<time datetime>`を持ち日付降順である
- 依存ゼロ・Node標準API・3値exit（0=緑/1=検出/2=検査自体の失敗）・`--selftest`つき
- package.jsonに`verify:learnings-map`と`verify:learnings-map:selftest`を追加
  （selftestはverify-allが自動収集するため個別登録不要）

### C-4. llms.txtの変更
Canonical pagesへ1行追加：
```
- Verified field notes (index of all incident cards): https://kimito-skill.link/learnings/
```
「Two roles」直後に正本序列を3行追加：
```
The master copy of the rules is CLAUDE.md in the repository
(https://github.com/kimito-link/web-ios-android). This site is its
human/AI-readable rendition; when they disagree, CLAUDE.md wins.
An agent working inside a checkout reads CLAUDE.md first, not this file.
```
learnings/の個別カード一覧はllms.txtに書かない（地図の正本を2つにしないため）。

### C-5. カード追加時の運用手順（learnings/末尾にHTMLコメントで埋め込む）
1. `<h2 id="新id">`でカードを書く（C-1の命名規則、既存idと非重複）
2. `#page-map`に1行足す
3. `#recent-updates`の**先頭**に1行足す。10行超過分は末尾を削る
4. `npm run verify:learnings-map` → `npm run verify:links` を実行し緑を確認
5. `git push`後、`npm run deploy:site`実行→本番URLを開いて反映確認してから完了報告

## D. MVP
**①learnings/の地図＋全h2へのid付与＋最近の更新ブロック**を先に。③（検査）は同じセッション内で
到達することを強く推奨（検査を欠いたまま運用開始すると地図は必ず腐り始めるため）。

## E. 捨てた案と理由

| 案 | 理由 |
|---|---|
| GitHub ActionsでMarkdown→HTML自動ビルド | ビルドツールなし制約に違反 |
| Lunr.js等のクライアント検索 | npm依存導入＝依存ゼロ制約違反。Ctrl+F＋地図で現状規模には十分 |
| `<script type="text/markdown">`+クライアントJS変換 | 非JS読者に本文が不可視になり「静的HTMLが唯一の構造情報」原則と衝突 |
| Living Protocol（versioned node＋patchレビュー） | 静的サイトへの過剰設計 |
| git logから「最近の変更」を自動生成 | コミットメッセージは読者向けの文ではなくメタデータ不足。人手2行追記の方が総コスト低・品質高 |
| sitemap-manifest.json方式（JSON+JS描画の目次） | 非JS読者に地図が不可視になる（既存sitemapの負債を増殖させる）。正本もHTML/JSONに割れる |
| learnings/本文カードの日付順並べ替え | git差分が巨大化。時間軸要求は「最近の更新」で満たせる |
| llms.txtに全カード一覧を掲載 | 地図の正本が2つになり必ずずれる。ポインタ1行に留める |

## F. 地雷と回避策

- 地図とh2のずれ → ③がfail-closedで検知、selftestがverify-allに自動編入されるため検査自体の形骸化も防止
- id改名による外部リンク破壊 → 公開後不変の規約をページ内コメントに明記
- stickyヘッダーでアンカー着地位置が隠れる → 全対象idに`scroll-margin-top: 72px`
- 「コミット・push≠反映」 → C-5手順5に`npm run deploy:site`実行と本番URL目視を固定
- verify-internal-links.mjs RULE 2との衝突 → 地図のアンカーとid付与は同一コミットで
- 「最近の更新」の無限成長 → 最大10行・末尾削除の規約
- `site/sitemap/`がJS描画で非JS読者に不可視（既存負債） → 本改修のスコープ外。別タスクとして記録
- learnings/のpage-map用CSSは各ページ自己完結の現行流儀に従いインラインのまま（共通化しない）

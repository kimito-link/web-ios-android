# clerk-ja/ — 素の clerk-js サイトの「ログイン画面の日本語化＋見た目」

## 何のためのものか
共有 Clerk（kimito.link）のログインカードは、そのままだと英語で、見出しが
**「Sign in to kimitolink-linktree」**（共有 Clerk の Application 名）になる。これを日本語にし、
見出しをサービスごとに上書きし、X を主役にした見た目に揃える。

★Dashboard で Application 名を直すと kimito.link 本体と姉妹全サービスの見出しが変わるので、
　サービスごとの上書きは各サイトの localization 側で行う（この金型）。

## 使い方（素の clerk-js の静的サイト）
1. `clerk-ui-options.js.example` を `clerk-ui-options.js` として **無改変で** コピーする
2. `gen-clerk-ja-localization.mjs.example` を `scripts/gen-clerk-ja-localization.mjs` としてコピーし、
   `OUT_REL` を直し、devDependency に `@clerk/localizations` を足して、`node scripts/gen-clerk-ja-localization.mjs`
   で `clerk-ja-JP.generated.js` を生成してコミットする（手で編集しない）
3. Clerk SDK を読み込む前に、設定と2ファイルを読み、`Clerk.load` に渡す:
   ```js
   window.KimitoClerkUiConfig = { serviceName: 'サービス名' };   // ← サイト固有の値はこれだけ
   // clerk-ja-JP.generated.js → clerk-ui-options.js の順に <script> で読み込んだ後:
   Clerk.load(window.KimitoClerkUiOptions.buildClerkLoadOptions());
   ```
   SDK と並行して遅延読み込みし、失敗したら `{}` を渡す（標準の英語画面のまま・ログインは動く）。
4. `clerk-ui-options.test.mjs.example` を test/ にコピーし、パスと `SERVICE_NAME` を直す
5. キットの `_docs/instruments/check-drift.mjs` の PAIRS にコピー先を追記する

## Expo / Next.js など素の clerk-js でない場合
- Next.js: `<ClerkProvider localization appearance>` が効く（surechigai の `lib/clerk-localization.ts` 等）
- Expo(@clerk/expo 3.0.1): ClerkProvider の localization は渡らない → `__internal_updateProps({ options: { localization } })`
  （doin の `lib/clerk-ui-options.ts`。詳細は ai-hub の KB `clerk-expo-web-localization-internal-updateprops`）

## 罠
- 禁止語ゲート（diff-check）は差分の前後3行の既存コードも見る。生成物（公式の日本語データ）には
  禁止語が含まれうる。ゲートのあるリポに入れるときは、生成物をゲート対象外にするか事前に確認する
- ゲストがページを開いただけで関所（`YEStorage.set` 等）がログインを開くサイトでは、このモーダルが
  毎回出る。日本語化はそこでも効く

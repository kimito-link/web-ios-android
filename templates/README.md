# templates/ — Capacitor 連動型アプリの金型

このディレクトリは、`app.config.json` を埋めれば iOS/Android アプリを作れるようにするための
**金型(実証済みテンプレート)**。リバースハック(partnership)/ 富士山 / Exosome で実際に
ストア配信されている server.url リモート読込型の構成を、アプリ非依存に一般化したもの。

> ⚠️ まず [`../_docs/CAPACITOR-GOLDEN-RULES.md`](../_docs/CAPACITOR-GOLDEN-RULES.md) を読むこと。
> 黒画面を二度と起こさない6原則。これを破ると富士山の2ヶ月の轍を踏む。

## 中身

| パス | 役割 | アプリ固有値の扱い |
| --- | --- | --- |
| `capacitor/capacitor.config.template.ts` | Capacitor 設定の金型(server.url 連動型) | `{{bundleId}}` 等を app.config.json の値に置換 |
| `scripts/patch-ios-launch-dark.mjs` | iOS 起動フラッシュ対策(2点だけ・独自VC無し) | **無改変で使える**(背景色 #0A0A0F 固定) |
| `workflows/ios-shell-guardrail.yml` | 独自ネイティブ注入の再混入を CI で赤にするガード | 無改変(禁止パターンはアプリ非依存に一般化済み) |

## 使い方(連動型アプリを新規に作る)

1. アプリのリポジトリで `app.config.json` を埋める(identity / brand / contact / businessModel)。
2. `capacitor.config.template.ts` の `{{...}}` を app.config.json の値に置換して
   そのリポの `capacitor.config.ts` を作る。
   - `{{bundleId}}` = identity.bundleId / `{{displayName}}` = identity.displayName
   - `{{iosScheme}}` = identity.iosScheme / `{{productionDomain}}` = identity.productionDomain
   - `{{rootDomain}}` = productionDomain のルート(例: app.example.com → example.com)
   - `{{backgroundColorARGB}}` = 起動下地色 ARGB8(金型実績は `#0A0A0FFF`)
3. `scripts/patch-ios-launch-dark.mjs` と `workflows/ios-shell-guardrail.yml` をリポにコピー。
4. `@capacitor/{cli,core,ios,android}` を devDependencies に追加。
5. `npm install` → `npx cap add ios` / `npx cap add android`(Xcode / Android SDK が要る)。
6. 配信前に輝度ゲート(`ios-blackscreen-check.yml`)を通す → リリース CI で配信。

## 実証済みの参照アプリ(金型の出どころ)

- `../../partnership_program_website` — 金型本体(リバースハック)。capacitor.config.json は server.url、patch は2点だけ。
- `../../fujisan-clean` — 黒画面を2ヶ月かけて解決した記録(`_docs/POSTMORTEM-ios-blackscreen.md` / `AGENTS.md`)。**触らない**(解決済み・安定)。
- `../../Exosome` — server.url 連動型の最小実物。

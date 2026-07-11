# Capacitor 連動型(server.url)アプリの金型 — 黒画面とCI地雷を二度と起こさない10原則

> このキットで iOS/Android アプリを作るときの **中核ルール**。
> 富士山コンパス(fujisan)が 2026-03〜05 に iOS 起動黒画面の「修正」を **10回以上配信して毎回外し**、
> 約2ヶ月を消耗した末に確立した知見を、アプリ非依存に一般化したもの。
> **新規アプリは最初からこの金型に乗れば、その2ヶ月を1日も繰り返さずに済む。**

---

## 方式: server.url リモート読込型(連動型)

このキットの標準は **「本番Webを WebView で丸ごと読む連動型」**。
- Web は Vercel 等に常時デプロイ済み。iOS/Android は `server.url` でその本番URLを表示するだけの薄いネイティブ殻。
- **Web を更新すれば、アプリ(連動型)にも即反映される**。アプリ用に作り分けない。
- 実証アプリ: リバースハック(`partnership_program_website`)/ Exosome / 富士山(解決後)。

> ⚠️ バンドル型(`webDir` に静的同梱、server.url 無し)も Capacitor の選択肢だが、
> Web更新が自動反映されず二重管理になる。**このキットの標準は連動型**。バンドル型にするなら明確な理由を持つこと。

---

## 真因の教訓(なぜ黒画面が起きたか)

富士山の黒画面の真因は **server.url 方式でも dist 同梱方式でもなかった**(両方で黒だった=戦略は無罪)。
真犯人は **富士山独自の `FujisanBridgeViewController` を `Main.storyboard` に注入し、`customClass`/`customModule` が矛盾して WKWebView が一度も生成されなかった**こと。

→ **教訓: アプリ独自のネイティブ実装(VC / UIWindow オーバーレイ / AppDelegate 注入)を足すな。動く金型(リバースハック)と同型に保て。**

---

## 守るべき10原則(AGENTS.md にも転記すること)

1. **「作り分けない」を最優先する**。動く金型アプリ(リバースハック=`partnership_program_website`)と同型に保つ。アプリ独自の VC / UIWindow / AppDelegate 注入を **二度と入れない**。ネイティブ重装備は server.url リモート構成では過剰。

2. **`capacitor.config.ts` を唯一の真実の源とする**。CI で「config が無ければヒアドキュメントで fallback 生成」のようなロジックを **書かない**(重要設定を欠いた殻が黙って配信される時限爆弾になる)。測る殻と配信する殻を一致させる。

3. **iOS の patch スクリプトは最小に**。金型(`patch-ios-launch-dark.mjs`)がするのは **2点だけ**:
   - Info.plist `UIUserInterfaceStyle=Dark`(起動の白フラッシュ防止)
   - LaunchScreen.storyboard の背景色をブランド背景色に
   WebView 下地は `capacitor.config` の `backgroundColor` が担当。**これより増やさない**。増やすなら「金型アプリにも同じ修正を入れるべきか」を先に問う。
   - 🔴**背景色は「スプラッシュ画像の地色」と必ず一致させる**(白/黒フラッシュ根絶の肝)。不一致だと、
     スプラッシュが `launchAutoHide` で消えた後〜`server.url` 読込完了までの間、下地色がむき出しで見える。
     **kimito 実例(2026-07-02)**: スプラッシュは青地#00427B+白ロゴなのに `backgroundColor` が白#FFFFFFFF
     → 実機で「開いた瞬間まっ白」。原因は「アプリが白基調だから白背景」という誤判断(スプラッシュは青地なのに)。
     背景色4箇所(root/ios/android/plugins.SplashScreen)を #00427B に揃えて解消。`launchShowDuration` は
     全リポ標準の1500のまま(伸ばすと審査で起動が遅いと見られる)。**背景色を決めるときはテーマの明暗でなく
     "スプラッシュ画像の地色"を見る。**

4. **`ios/` `android/` は git にコミットしない**(`.gitignore`)。CI で `npx cap copy` の都度新生成。古い人手調整が CI に持ち越されないように。

5. **配信前ゲートを必ず通す**。`ios-blackscreen-check.yml` を実 server_url モードで実行し、シミュレータ輝度 **≥16(正常≈21)** を確認してから配信する。**推測で配信しない**(過去に10回以上外して大消耗した)。

6. **Verify は「ファイル存在」でなく「壊したい挙動が無いこと」を見る**。過去の事故は「`test -f <独自VC>.swift` で存在確認する Verify が、配線が壊れていても緑を返した」。**`! test -f` で独自実装の不在を強制**し、CI ガードレール(`ios-shell-guardrail.yml`)で独自 VC/UIWindow の再混入を機械的に赤にする。

7. **アイコン/スプラッシュは store-assets のマスターから CI が毎回生成し、「差し替わったこと」をハッシュで確認する**。原則4(`ios/` 非コミット)の帰結として、`cap add ios` が置く **Capacitor デフォルトの青い×ロゴが毎ビルド復活する**。`@capacitor/assets generate` は `icon-only.png` だけでは**アイコンしか生成せず、スプラッシュは生成しない**(silent skip)。→ ①スプラッシュマスター(2732×2732)を `store-assets/` にコミット ②CI で `assets/splash.png` として渡す ③生成後に**Contents.json が実際に参照する画像**が全て存在し、かつ生成前(=デフォルト)のハッシュ集合に1つも含まれないことを確認し、ダメならビルドを赤にする(直接証拠ゲート)。
   ⚠️ 固定ファイル名のハッシュ比較は不可: `@capacitor/assets` は旧ファイル(`splash-2732x2732.png`)を上書きせず、**新ファイル名(`Default@1x~universal~anyany.png` 等)で書いて Contents.json を差し替える**。検証は常に「出荷時に参照されるもの」基準で行う。実装例: Exosome `.github/workflows/ios-appstore-release.yml` の「Generate icons + splash」(2026-06、デフォルトスプラッシュ出荷事故の再発防止。初版ゲートはこの罠で正しく赤になり、罠の存在自体を発見した)。

8. **`capacitor.config.ts` の `webDir` と、CI がその場所に何を作るかを一致させる**。この金型は `dist/public` を
   運用標準にする(「Prepare webDir」ステップがここにフォールバック用stubを生成する。かつてあった
   `copy-web-to-www.mjs`(`src/`→`www/`ミラー)は未使用のまま設計だけ残っていた死んだコードだったので削除済み)。
   **kimito resend実戦(2026-07-04)**: `webDir: 'www'`のまま7回連続でAndroidビルドが失敗していた。
   真因は`cap copy android`が`www/`を探すのに`Prepare webDir`は`dist/public`にしか作らない不一致で、
   `capacitor.config.json`の書き込みが失敗し`capacitor.settings.gradle`が生成されずGradleが
   `Could not read script capacitor.settings.gradle`で落ちる、という3階層先のエラーとして現れた
   (根本原因から遠いエラーメッセージで出るので気づきにくい)。**新規アプリを作るときは
   `capacitor.config.ts`の`webDir`とワークフローの`Prepare webDir`が同じパスを指しているか
   最初に目視確認すること**。
9. **署名鍵ファイルは、それを読む Gradle 設定と同じ相対パス基準に置く**。`android-patch-signing.mjs`が
   注入する`storeFile("../android-upload-key.jks")`は`android/app/build.gradle`からの相対解決＝
   **`android/`直下**を指す。CIの`Restore signing material`ステップはここ(`android/android-upload-key.jks`・
   `android/keystore.properties`)に書くこと。リポジトリルートに書くと`signReleaseBundle`が
   「file doesn't exist」で落ちる(2026-07-04 resend実戦で発見・修正)。
10. **金型から新規アプリへセットアップする際、ワークフローが参照する全スクリプトが実際にコピーされたか確認する**。
    `play-fill-data-safety.mjs`(+ 対の`play-generate-data-safety-csv.mjs`・`lib/play-data-safety-template.json`)は
    金型には実装済みなのに、resendのセットアップ時にコピーが漏れており、ワークフローだけが呼び続けて
    `MODULE_NOT_FOUND`でリリースパイプライン全体を毎回落としていた(2026-07-04 resend実戦で発見)。
    「未実装」ではなく「セットアップ時のコピー漏れ」だった点に注意 — 金型を見て真っ先に疑うべきは
    実装の有無ではなくコピー漏れ。恒久対策として、ワークフロー側は`if [ -f <script> ]`で存在チェックして
    スキップ可能にしてあるので、CSV運用を使わない(Data SafetyをPlay Console UIで手入力する)アプリは
    このスクリプト群をコピーしなくても支障なく動く。CSV自動投入を使いたいアプリは3ファイルをコピーすること。

---

## 真因にたどり着いた手法(再現用)

1. **推測で配信しない。事実を1つ取りに行く**。Mac 無し環境でも `xcrun simctl spawn booted log stream`(GitHub Actions の macOS runner)で「WKWebView ログが出ているか」を実測できる。
2. **測りたくても測れない状態を先に解消する**(CIのCapacitorバージョン整合・シミュレータ機種をUDID動的選択・システムログのartifact化)。これが全進展の土台。
3. **1人で推測を重ねず、複数観点で並列に独立調査**(構造=storyboard/pbxproj実ダンプ / 比較=動く金型アプリと全diff / 歴史=git log時系列)。
4. **動く金型(リバースハック)と何が違うかを必ず確認**。このアプリだけがしている独自実装を疑う。

---

## 関連ファイル(キット内 + 参照元)

- 金型アプリ(連動型の正解): `../partnership_program_website`(capacitor.config.json は server.url、patch は2点だけ)
- 解決の記録: `../fujisan-clean/_docs/POSTMORTEM-ios-blackscreen.md`(2ヶ月の苦闘と真因の全記録)
- 6原則の原典: `../fujisan-clean/AGENTS.md`「iOS Capacitor シェル運用の原則」
- リリース移植手順: `../fujisan-clean/_docs/release-pipeline-playbook.md`(git push 一発で3ストア配信)
- CIガード現物: `../fujisan-clean/.github/workflows/ios-shell-guardrail.yml` / `ios-blackscreen-check.yml`

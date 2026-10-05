# エミュレータ/シミュレータでAIが動作確認する（実機なし・ズレゼロ）— 正本

> **この1枚が唯一の正本。** コピーを作らない。各リポからはこのフルパスを参照する1行だけ置く。
> 目的: 「iOS/Androidの動作確認をAIがやればズレのないものができる」を実体化する。
> 人間に「実機で見て」「スクショ送って」と頼む前に、AI が PC 上のエミュレータ/シミュレータを
> 端から端まで操作して目視確認する。物理端末を待たない・後から見返せる証拠（スクショ）が残る。
>
> 実証: 2026-09-28 malwarecheck の Android 端末あんしん健診。物理端末なしで
> 「カードの出し分け・自作Capacitorプラグインが実機で値を返す・弱点時のLINE相談導線」を確認し、
> 修正すべき不具合ゼロを実画面で確定した。

## いつ使うか
`web-ios-android/CLAUDE.md`「確認環境の優先順（固定）」の**2番目**。
1(PC上のブラウザ=Browser pane)で足りない「ネイティブ固有の挙動・出し分け・ネイティブプラグイン」を
確認するとき。3(USB実機)・4(CI)・5(人が外で操作)より先にここを試す。

## 前提の確認（最初に1回）
```bash
# Android SDK / emulator / adb があるか
ls "$LOCALAPPDATA/Android/Sdk"                       # build-tools emulator platform-tools ... があればOK
"$LOCALAPPDATA/Android/Sdk/emulator/emulator.exe" -list-avds   # 既存AVD名を確認
"$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe" devices     # 接続中の端末
```
- AVD が無ければ Android Studio の Device Manager で1つ作る（Play Store イメージ推奨＝WebView が新しい）。
- iOS は **macOS + Xcode が要る**（Windows 不可）。Windows PC では iOS シミュレータは動かせないので、
  iOS のネイティブ確認は CI（Mac ランナー）に回す（優先順4）。**ただし本キットは server.url 連動型なので、
  iOS でも「画面の中身」の大半は Browser pane（優先順1）で確認できる**。iOS シミュレータが要るのは
  iOS 固有のネイティブUI・審査地雷（スプラッシュ・1.1.6誤読等）を目視するときだけ。

## Android の手順（実証済みレシピ・Capacitor server.url 型）

### 1. エミュレータをバックグラウンド起動
```bash
SDK="$LOCALAPPDATA/Android/Sdk"
nohup "$SDK/emulator/emulator.exe" -avd <AVD名> -no-snapshot -no-audio -no-boot-anim \
  -gpu swiftshader_indirect >/tmp/emu.log 2>&1 &
# 起動に30〜90秒。boot完了は sys.boot_completed が 1 になるまで待つ:
"$SDK/platform-tools/adb.exe" wait-for-device
"$SDK/platform-tools/adb.exe" shell getprop sys.boot_completed   # 1 なら準備OK
```

### 2. デバッグAPKをビルド（cap add → device系プラグイン → 自作patch → gradle）
```bash
cd apps/mobile
pnpm install --filter <mobileパッケージ名>        # @capacitor/device 等を入れる
mkdir -p www; [ -f www/index.html ] || echo '<!doctype html>...' > www/index.html
# ★android/ が中途半端に残っていると cap add がスキップされ gradlew が生成されない。
#   作り直すときは node -e "require('fs').rmSync('android',{recursive:true,force:true})" で消してから:
[ -d android ] || npx cap add android
npx cap sync android                              # ★cap copy でなく sync（新プラグインを登録）
node ../../scripts/android-patch-*.mjs 2>/dev/null || true   # 自作ネイティブプラグインの注入patchがあれば
cd android
# ★日本語パス対策（このPCは …/デスクトップ/… 配下）。無いと gradle が path check で落ちる:
grep -q overridePathCheck gradle.properties || echo "android.overridePathCheck=true" >> gradle.properties
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk" ANDROID_SDK_ROOT="$LOCALAPPDATA/Android/Sdk"
./gradlew :app:assembleDebug -x lint --console=plain    # 3〜4分。BUILD SUCCESSFUL を確認
```

### 3. install → 起動
```bash
SDK="$LOCALAPPDATA/Android/Sdk"
APK=$(find app/build/outputs/apk/debug -name "*.apk" | head -1)
"$SDK/platform-tools/adb.exe" install -r "$APK"          # Success を確認
"$SDK/platform-tools/adb.exe" shell monkey -p <appId> -c android.intent.category.LAUNCHER 1
sleep 12   # server.url 型は本番Webの読み込みを待つ
```

### 4. AIが操作して目視（tap / swipe / text → screencap → Readで画像を見る）
```bash
SDK="$LOCALAPPDATA/Android/Sdk"
ADB="$SDK/platform-tools/adb.exe"
# スクショを撮ってスクラッチパッドに保存し、Read ツールで画像として見る
"$ADB" exec-out screencap -p > "<scratchpad>/emu-01.png"
# 操作: 座標はスクショ実寸(例1080x2400)基準。Readの表示は縮小されるので
#   「Multiply coordinates by N」の係数で実寸へ戻してから tap する。
"$ADB" shell input tap <x> <y>
"$ADB" shell input swipe <x1> <y1> <x2> <y2> <ms>       # スクロール
"$ADB" shell input text 'https://example.com'          # フォーム入力（日本語は別途IME必要）
```
- **必ず Read ツールで各スクショを画像として見る**（テキスト抽出だけで済ませない）。数値計算と
  見た目が食い違う事故（ロゴ切れ等）を防ぐため、判断は「実際の画面」で行う（CLAUDE.md 実損の教訓）。
- 出し分けの確認は「出るはずの画面で出る」と「出ないはずの画面で出ない」の**両方**を撮る。
  （例: Android限定機能は Android エミュで出て、iOS では門番が出る、の両方を証拠化）

### 5. 後片付け
```bash
"$SDK/platform-tools/adb.exe" emu kill        # エミュレータ停止
# apps/mobile/android/ は生成物（.gitignore 済のはず）。gradle.properties の overridePathCheck は
# ローカルビルド専用でコミットしない（CIのパスはASCIIなので不要）。
```

## iOS の手順（macOS 上のとき）
Windows では不可（→ CI の Mac ランナーへ）。macOS 上なら:
```bash
npx cap add ios && npx cap sync ios
xcrun simctl boot "iPhone 15"                  # or 一覧: xcrun simctl list devices
xcrun simctl install booted <path/to/App.app>
xcrun simctl launch booted <appId>
xcrun simctl io booted screenshot ios-01.png   # → Read で見る
# 操作は Simulator.app を computer-use で、または XCUITest。server.url 型なら中身はBrowser paneで足りる。
```
★iOS 固有の審査地雷（1.1.6 端末スキャン誤読・デフォルトスプラッシュ）は、この目視 or CI ゲートで潰す。
Android限定機能を iOS に出さない設計なら、**iOS シミュレータでは「出ないことの確認」を撮る**。

## Android 実機で PWA(WebAPK) の起動を測る
ホーム画面に追加した PWA の「開いた直後の約1秒」に、色の違う画面が何回出るかを録画で見る。
エミュレータではなく **USB 接続した実機**で撮る（WebAPK の起動画面は OS と Chrome の組み合わせで決まるため）。
```bash
# 変更前に1回、変更後にもう1回。同じ手順で撮って比べる
ANDROID_SERIAL=<adb devices の端末> bash templates/scripts/measure-webapk-launch.sh https://example.com/ before --out ./qa/evidence/launch
```
- WebAPK の入れ直し（Chrome のメニュー →「ホーム画面に追加」→「インストール」）→ 起動の録画 → `ffmpeg` で
  タイル画像（`<label>-tiles.png`）と明るさの変化点（`<label>-y.txt`）まで自動。タイルは Read で見る。
- 前提: adb・ffmpeg・python が使えること／Chrome が**日本語 UI**（メニューの文言で探す）。
  端末の `org.chromium.webapk*` を最初に**全部消す**。
- ★録画・タイル・`ui-<label>.xml` に端末の個人の内容が映りうる。確認後に消し、コミットしない。
- Git Bash では `MSYS_NO_PATHCONV=1` と `pwd -W` が要る（スクリプトが設定する）。
- 色の数値（アイコンの無い上部帯の平均 RGB など）は、このスクリプトは出さない。タイルを見て、必要ならフレームから別途出す。
- 実機で動かして確認したのは surechigai の WebAPK（moto g64y 5G／Android 15／Chrome 154）の1例だけ。
  判断と実測値は `_docs/DESIGN-pwa-launch-screen-2026-10-05.md`。

## 地雷（実証で踏んだもの）
1. **cap add のスキップ**: android/ が中途半端に残っていると `[ -d android ] || cap add` が add を飛ばし、
   `cap sync` だけ走って **gradlew が生成されない**。作り直しは android/ を完全削除してから cap add。
2. **日本語パスで gradle 落ち**: `Your project path contains non-ASCII characters`。
   → gradle.properties に `android.overridePathCheck=true`（ローカル専用・コミットしない）。
3. **cap copy と cap sync の違い**: 新しいネイティブプラグインは copy では登録されない。必ず sync。
4. **自作ネイティブプラグインの MainActivity 注入**: Capacitor 標準の MainActivity は
   `public class MainActivity extends BridgeActivity {}`（onCreate override 無しの空クラス）。
   `super.onCreate` を正規表現で探す注入 patch は**空クラスで外れる**ので、空クラスには onCreate override を
   丸ごと足す分岐を持たせる（この事故は dry_run CI で検出→修正した実績あり）。
5. **screencap の座標**: Read の表示は縮小。tap 座標は必ず実寸へ戻す（係数はReadが「Multiply by N」で明示）。
6. **boot 待ち**: install/操作の前に `wait-for-device` ＋ `getprop sys.boot_completed`=1 を確認。
   起動途中に install すると失敗する。
7. **server.url 型の読み込み待ち**: 起動直後は本番Webのロード中。sleep で待ってから撮る。

## 原則
- 「実機で見て」と人間に頼む前に、必ずここ（エミュレータ/シミュレータ）を試す。
- 判断は**実際のスクショ**で行う（計算・推測で「大丈夫」と言わない＝基準③裏取り）。
- 証拠（スクショ）はスクラッチパッドに残し、報告に反映する。後から見返せない確認をしない。

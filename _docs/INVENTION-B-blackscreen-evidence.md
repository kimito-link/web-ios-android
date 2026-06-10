# 発明B: 配信前ゲートの「直接証拠化」— 組込手順

発明会議(golden-pattern-inventions-council, total 37・全会一致採用)で採択した、
黒画面ゲートの**唯一の発明**。`ios-blackscreen-check.yml` は既に simlog(log stream)を
取得しているのに、配信可否を**輝度(luma)だけ**で判定し、ログの直接証拠を捨てている。
発明Bは「WKWebView が生成されたか / server.url にHTTPが飛んだか」を判定に**補強情報**として
足す。富士山 POSTMORTEM 行26「WKWebViewログ0行・HTTP0行＝WKWebView未生成」=
人間が真因を確定させた決め手そのものをゲート化する(原則5「推測で配信しない」強化)。

> ⚠️ **これは「金型を1枚薄く強化する層」であって、別系統のCIを作るものではない**(発明C=
> 製造機化は reject)。富士山は解決済み・触らない。**新規アプリ(dns-osint 等)が Phase2 で
> 輝度ゲートを富士山/partnership からコピーする時に、下記3点を足す**。

## 必要ファイル

`templates/scripts/ios-sim-logscan.mjs`(本キット同梱・無改変で使える)を、輝度ゲートを
持つリポの `scripts/` にコピーするだけ。Node 単体で動く純ロジック(Mac不要でテスト可能)。

## 既存 ios-blackscreen-check.yml への3点の追加(luma判定は不変・exit握らせない)

### 設計の絶対条件(会議の全会一致ガード・厳守)
1. **luma を判定主軸に据え置く。** 赤/緑を決めるのは今まで通り luma(`steps.bscheck.outcome`)。
   logscan は exit を握らない(常に exit 0)。
2. **ログは2用途のみ**: (1) luma赤のときの真因ラベル (2) luma緑だが痕跡ゼロのときの疑義warning。
3. **不在(negative)で即断しない。** 出現は確実なシグナル、不在は取りこぼし/タイミングで起こりうる。
   総ログ行数が極小なら不在判定を無効化(観測失敗とバグ無しを区別)。← logscan が内部で処理。
4. **HTTPホストは固定文字列でなく config.ts の server.url から動的取得**(値ズレ空振り防止)。

### 追加1: simlog 抽出ステップ(既存の「Stop log capture & extract」)の直後に挿入

```yaml
      - name: Scan log for direct WKWebView/HTTP evidence (発明B)
        if: always()
        id: logscan
        run: |
          set +e
          # server.url のホストを capacitor.config.ts から動的抽出(固定文字列にしない)
          HOST=$(node -e "const s=require('fs').readFileSync('capacitor.config.ts','utf8'); const m=s.match(/url:\s*['\"]https?:\/\/([^'\"\/]+)/); process.stdout.write(m?m[1]:'')")
          SERVER_URL_HOST="$HOST" LUMA_OUTCOME="${{ steps.bscheck.outcome }}" \
            node scripts/ios-sim-logscan.mjs logs/ios-blackscreen/simlog.txt
```

### 追加2: 最終判定ステップ(「Fail step if black-screen check failed」)をラベル付きに

exit 条件は **luma のまま不変**。logscan の結果は error メッセージの**ラベル**にするだけ:

```yaml
      - name: Fail step if black-screen check failed
        if: steps.bscheck.outcome == 'failure'
        run: |
          if [ "${{ steps.logscan.outputs.webview }}" = "false" ] && [ "${{ steps.logscan.outputs.http }}" = "false" ] && [ "${{ steps.logscan.outputs.loglines }}" -ge 30 ]; then
            echo "::error::黒画面 確度【高】: 輝度赤 かつ WKWebView未生成・server.url不達(POSTMORTEM行26と同一シグネチャ)。"
          else
            echo "::error::Black-screen check reported black; simlog/suspects/screenshot を確認。"
          fi
          exit 1
```

### 追加3: 偽緑(luma緑だが痕跡ゼロ)の疑義 warning(緑のまま・止めない)

```yaml
      - name: Warn on green-without-evidence (発明B)
        if: steps.bscheck.outcome == 'success' && steps.logscan.outputs.webview == 'false' && steps.logscan.outputs.loglines >= '30'
        run: echo "::warning::輝度は緑だが WKWebView 生成ログ無し。偽緑(lumaフリーク)の可能性。simlog を目視確認推奨(配信は止めない)。"
```

## 検証(Node単体・Mac不要)

`ios-sim-logscan.mjs` は simlog を食わせるだけでテストできる:
- 黒画面(WKWebView無+luma赤) → `[error] 黒画面 確度【高】` / exit 0
- 正常(WKWebView+HTTP有+luma緑) → `[notice] 整合` / exit 0
- 偽緑(WKWebView無+luma緑) → `[warning] 偽緑の可能性`(止めない) / exit 0

## なぜ luma を捨てて logscan 単独にしないのか

luma(輝度)は「画面が実際に明るいか」の最終結果を測る。logscan(ログ)は「WebView を作ろうと
したか」の過程を測る。**両方が揃って初めて確信できる**。logscan 単独だと、ログが出ても描画が
黒いケース(CSS全黒等)を見逃す。luma を主軸に、logscan を真因ラベル/疑義検出の補助にするのが
最も堅い(会議の全会一致設計)。

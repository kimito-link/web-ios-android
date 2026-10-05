#!/usr/bin/env bash
# measure-webapk-launch.sh — Android 実機で PWA(WebAPK) を入れ直し、起動を録画して、
# 起動画面の段階を並べた画像（タイル）と明るさの変化点を出す。
#
# 目的: 「ホーム画面に追加した PWA を開いた直後の約1秒に、色の違う画面が何回出るか」を
#       目視ではなく録画のフレームで見る。変更の前後を同じ手順で撮って比べる。
#
# 使い方:
#   bash measure-webapk-launch.sh <url> <label> [--out <dir>]
#   例: ANDROID_SERIAL=XXXXXXXX bash measure-webapk-launch.sh https://example.com/ before --out ./qa/evidence/launch
#
# 環境変数:
#   ANDROID_SERIAL  対象の端末。未指定なら `adb devices` の最初の端末。
#   ADB             adb の場所。未指定なら PATH の adb、無ければ $LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe
#
# 出力（--out の中。既定はカレント）:
#   <label>-launch.mp4  起動の録画
#   <label>-tiles.png   起動直後 1.1 秒を 30fps で切り、画面の上から62%を 11x3 のタイルに並べた画像
#   <label>-y.txt       フレームごとの明るさ(YAVG)。標準出力にも変化点を出す
#   ui-<label>.xml      Chrome のメニュー操作に使った画面の XML（★個人情報が映りうる。下記）
#
# 前提:
#   - USB 接続した Android 実機（USB デバッグ有効）。adb / ffmpeg / python（python3 でも可）が使える
#   - 端末の Chrome が【日本語 UI】であること。メニュー操作を画面の文字で探すため、次の文言に依存する:
#       「Google Chrome の設定」「ホーム画面に追加」「インストール」
#     英語 UI など文言が違う端末では "not found" で止まる（その場合は find_center の文言を直す）
#   - 端末にすでに入っている org.chromium.webapk* を【全部アンインストールする】（このスクリプトの最初の処理）。
#     他の PWA を入れている端末では注意
#
# ★個人情報: 端末の画面にメッセージ等が映っていることがある。録画・タイル画像・ui-*.xml は
#   中身を確認したら不要なものを消す。リポジトリにコミットしない。
#
# Windows の Git Bash では:
#   - adb.exe に /sdcard/... を渡すとパス変換で壊れるため MSYS_NO_PATHCONV=1 が要る（このスクリプトが設定する）
#   - ffmpeg(.exe) に渡す出力先は Windows 形式が要るため `pwd -W` を使う（無い環境では pwd にフォールバック）
#
# 出典: surechigai-romi.link の起動画面の調査（2026-10-05）。設計記録は _docs/DESIGN-pwa-launch-screen-2026-10-05.md。
# 実機での動作確認は surechigai の WebAPK（moto g64y 5G / Android 15 / Chrome 154）で行った1例のみ。
set -euo pipefail
export MSYS_NO_PATHCONV=1

URL="${1:-}"; LABEL="${2:-}"
[ -n "$URL" ] && [ -n "$LABEL" ] || { echo "usage: bash $0 <url> <label> [--out <dir>]" >&2; exit 2; }
shift 2
OUT="."
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:-}"; [ -n "$OUT" ] || { echo "--out needs a directory" >&2; exit 2; }; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
mkdir -p "$OUT"
OUT_ABS="$(cd "$OUT" && { pwd -W 2>/dev/null || pwd; })"

# adb の場所
if [ -n "${ADB:-}" ]; then :
elif command -v adb >/dev/null 2>&1; then ADB="adb"
elif [ -n "${LOCALAPPDATA:-}" ] && [ -x "$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe" ]; then ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
else echo "adb が見つからない（PATH か ADB 環境変数で指定）" >&2; exit 1; fi

# python の場所
if command -v python >/dev/null 2>&1; then PY=python
elif command -v python3 >/dev/null 2>&1; then PY=python3
else echo "python が見つからない" >&2; exit 1; fi

# 対象の端末
S="${ANDROID_SERIAL:-}"
if [ -z "$S" ]; then
  S=$("$ADB" devices | tr -d '\r' | awk 'NR>1 && $2=="device" {print $1; exit}')
fi
[ -n "$S" ] || { echo "端末が見つからない（adb devices を確認。ANDROID_SERIAL で指定も可）" >&2; exit 1; }
echo "== 端末: $S"

UI="$OUT_ABS/ui-$LABEL.xml"

dump() { "$ADB" -s "$S" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; "$ADB" -s "$S" pull /sdcard/ui.xml "$UI" >/dev/null 2>&1; }
# find_center <text か content-desc の完全一致> [nth(0始まり。既定0。-1で最後)] → "x y"（中心）を出力。見つからなければ空
find_center() {
  "$PY" - "$UI" "$1" "${2:-0}" <<'PYEOF'
import re,sys
x=open(sys.argv[1],encoding='utf-8').read(); want=sys.argv[2]; nth=int(sys.argv[3])
hits=[]
for m in re.finditer(r'<node([^>]*)>',x):
    a=m.group(1)
    t=re.search(r' text="([^"]*)"',a); cd=re.search(r'content-desc="([^"]*)"',a); b=re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',a)
    if b and ((t and t.group(1)==want) or (cd and cd.group(1)==want)):
        x1,y1,x2,y2=map(int,b.groups()); hits.append(((x1+x2)//2,(y1+y2)//2))
if hits:
    h=hits[nth] if -len(hits)<=nth<len(hits) else hits[0]; print(h[0],h[1])
PYEOF
}
tap() { "$ADB" -s "$S" shell input tap "$1" "$2"; sleep 2; }

echo "== 既存の WebAPK を消す"
for p in $("$ADB" -s "$S" shell pm list packages | tr -d '\r' | grep -o 'org.chromium.webapk[^ ]*' || true); do "$ADB" -s "$S" uninstall "$p" >/dev/null 2>&1 || true; done
"$ADB" -s "$S" shell input keyevent KEYCODE_WAKEUP; "$ADB" -s "$S" shell input keyevent KEYCODE_HOME; sleep 1

echo "== Chrome で開く: $URL"
"$ADB" -s "$S" shell am force-stop com.android.chrome; sleep 1
"$ADB" -s "$S" shell am start -a android.intent.action.VIEW -d "$URL" com.android.chrome >/dev/null; sleep 10

echo "== メニュー → ホーム画面に追加 → インストール"
dump; c=$(find_center "Google Chrome の設定"); [ -n "$c" ] || { echo "menu button not found" >&2; exit 1; }; tap $c
dump; c=$(find_center "ホーム画面に追加"); [ -n "$c" ] || { echo "'ホーム画面に追加' not found" >&2; exit 1; }; tap $c
dump; c=$(find_center "インストール" 0); [ -n "$c" ] || { echo "'インストール' chip not found" >&2; exit 1; }; tap $c; sleep 1
dump; c=$(find_center "インストール" -1); [ -n "$c" ] || { echo "'インストール' confirm not found" >&2; exit 1; }; tap $c
sleep 12
PKG=$("$ADB" -s "$S" shell pm list packages | tr -d '\r' | grep -o 'org.chromium.webapk[^ ]*' | head -1 || true)
[ -n "$PKG" ] || { echo "WebAPK が入らなかった" >&2; exit 1; }
echo "WebAPK: $PKG"

echo "== 起動を録画"
"$ADB" -s "$S" shell am force-stop "$PKG"; "$ADB" -s "$S" shell am force-stop com.android.chrome; "$ADB" -s "$S" shell input keyevent KEYCODE_HOME; sleep 2
( "$ADB" -s "$S" shell screenrecord --bit-rate 12000000 --time-limit 9 /sdcard/launch.mp4 >/dev/null 2>&1 & )
sleep 1.5
"$ADB" -s "$S" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 11
"$ADB" -s "$S" pull /sdcard/launch.mp4 "$OUT_ABS/$LABEL-launch.mp4" >/dev/null
"$ADB" -s "$S" shell rm -f /sdcard/launch.mp4 /sdcard/ui.xml

echo "== 後片付け（WebAPK を消す・ホームへ）"
"$ADB" -s "$S" shell am force-stop "$PKG"; "$ADB" -s "$S" uninstall "$PKG" >/dev/null; "$ADB" -s "$S" shell input keyevent KEYCODE_HOME

echo "== 解析"
# 明るさの変化点（起動の瞬間を見つける）。ffmpeg のフィルタは Windows のドライブ文字の ':' を嫌うので out に cd して相対で書く
( cd "$OUT_ABS" && ffmpeg -v error -y -i "$LABEL-launch.mp4" -fps_mode passthrough -vf "scale=48:-1,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=$LABEL-y.txt" -f null - 2>/dev/null ) || true
START=$("$PY" - "$OUT_ABS/$LABEL-y.txt" <<'PYEOF'
import re,sys
t=open(sys.argv[1]).read()
pts=[(float(a),float(b)) for a,b in re.findall(r'pts_time:([\d.]+)\s*\nlavfi.signalstats.YAVG=([\d.]+)',t)]
prev=None; first=None
for tm,y in pts:
    if prev is not None and abs(y-prev)>6 and first is None: first=tm
    prev=y
print(max(0.0,(first or 1.0)-0.3))
PYEOF
)
ffmpeg -v error -y -ss "$START" -t 1.1 -i "$OUT_ABS/$LABEL-launch.mp4" -fps_mode passthrough -vf "fps=30,crop=iw:ih*0.62:0:0,scale=150:-1,tile=11x3" -frames:v 1 "$OUT_ABS/$LABEL-tiles.png"
echo "tiles: $OUT_ABS/$LABEL-tiles.png (start=${START}s)"
# 明るさの変化点を数値でも出す
"$PY" - "$OUT_ABS/$LABEL-y.txt" <<'PYEOF'
import re,sys
t=open(sys.argv[1]).read()
pts=[(float(a),float(b)) for a,b in re.findall(r'pts_time:([\d.]+)\s*\nlavfi.signalstats.YAVG=([\d.]+)',t)]
prev=None
print("明るさの変化点:")
for tm,y in pts:
    if prev is None or abs(y-prev)>6: print(f"  {tm:5.2f}s Y={y:6.1f}")
    prev=y
PYEOF
echo "★録画・タイル・ui-$LABEL.xml に個人の内容が映っていないか確認し、不要なら消す"

#!/usr/bin/env bash
# create-issue.sh — GitHub API で Issue を作る（フォームの「送信」操作を使わず、スクリプトで確定させる）。
#
# 使い方:
#   GH_TOKEN=<トークン> ./create-issue.sh -R owner/repo -t "タイトル" -b "本文"
#   echo "本文" | GH_TOKEN=<トークン> ./create-issue.sh -R owner/repo -t "タイトル"      # 本文は標準入力でも可
#   ./create-issue.sh -R owner/repo -t "タイトル" -b "本文" --dry-run                    # 送らず、送る内容だけ表示
#   オプション: -l ラベル（カンマ区切り。既定 ai-task）
#
# 出力（標準出力に JSON 1行）と終了コード:
#   0 = 作れた（ラベルも付いた）        {"ok":true,"number":12,"url":"https://github.com/…/issues/12","labels":["ai-task"]}
#   1 = 作れなかった（HTTP エラー等）    {"ok":false,"http":403,"message":"…"}
#   2 = 使い方が間違い／道具が足りない／トークン未設定
#   3 = Issue は作れたが、ラベルが付かなかった（★ワーカーは ai-task が無い Issue を拾わない。気づけるよう別コードにした）
#
# ■ トークン（GH_TOKEN）
#   - 必要な権限: 対象リポジトリの Issues: Read and write（fine-grained PAT。リポジトリを1つに絞ること）。
#   - ★チャットに貼らない・ファイルに書かない・コミットしない。環境変数か GitHub Secrets 経由で渡す。
#   - ラベルを付けるには対象リポジトリへの書き込み権限が要る（権限が足りないとラベルだけ黙って無視される → 終了コード 3）。
#   - このスクリプトはトークンを画面・ログに出さず、curl のコマンドライン（ps で見える）にも載せない
#     （一時ファイル経由で渡し、終了時に消す）。
#
# ■ 道具: curl と、JSON を安全に組み立てる道具のどれか1つ（jq → node → python3 の順に探す。無ければ終了コード 2）。
#   本文に引用符・改行・日本語が入っても壊れないよう、文字列連結で JSON を作らない。
set -euo pipefail

REPO=""; TITLE=""; BODY=""; LABELS="ai-task"; DRY=0; BODY_SET=0
while [ $# -gt 0 ]; do
  case "$1" in
    -R|--repo) REPO="${2:-}"; shift 2 ;;
    -t|--title) TITLE="${2:-}"; shift 2 ;;
    -b|--body) BODY="${2:-}"; BODY_SET=1; shift 2 ;;
    -l|--labels) LABELS="${2:-}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "不明な引数: $1" >&2; exit 2 ;;
  esac
done

if ! [[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then echo "-R owner/repo が必要（形式が不正）" >&2; exit 2; fi
if [ -z "$TITLE" ]; then echo "-t タイトルが必要" >&2; exit 2; fi
if [ "$BODY_SET" -eq 0 ] && [ ! -t 0 ]; then BODY="$(cat)"; fi

# 接続先。テスト用に 127.0.0.1 / localhost だけ差し替えられる（本物のトークンを別ホストへ送らせないため、それ以外は無視）。
API_BASE="https://api.github.com"
if [ -n "${IDEA_TEST_API_BASE:-}" ]; then
  case "$IDEA_TEST_API_BASE" in
    http://127.0.0.1:*|http://localhost:*) API_BASE="$IDEA_TEST_API_BASE" ;;
    *) echo "IDEA_TEST_API_BASE は 127.0.0.1 / localhost のみ許可" >&2; exit 2 ;;
  esac
fi

# JSON 道具を選ぶ
if command -v jq >/dev/null 2>&1; then TOOL=jq
elif command -v node >/dev/null 2>&1; then TOOL=node
elif command -v python3 >/dev/null 2>&1; then TOOL=python3
else echo "jq / node / python3 のどれかが必要（JSON を安全に組み立てるため）" >&2; exit 2; fi

# 値は環境変数経由で渡す（引数に埋め込まない＝引用符・改行・$ で壊れない）
build_payload() {
  case "$TOOL" in
    jq) jq -n --arg t "$TITLE" --arg b "$BODY" --arg l "$LABELS" '{title:$t, body:$b, labels:($l|split(",")|map(select(length>0)))}' ;;
    node) T="$TITLE" B="$BODY" L="$LABELS" node -e 'process.stdout.write(JSON.stringify({title:process.env.T,body:process.env.B,labels:process.env.L.split(",").filter(Boolean)}))' ;;
    python3) T="$TITLE" B="$BODY" L="$LABELS" python3 -c 'import json,os;print(json.dumps({"title":os.environ["T"],"body":os.environ["B"],"labels":[x for x in os.environ["L"].split(",") if x]},ensure_ascii=False))' ;;
  esac
}
# レスポンスから値を取る: field は number / html_url / message / labels（labels は名前をカンマ区切り）
pick() {
  local file="$1" field="$2"
  case "$TOOL" in
    jq) case "$field" in labels) jq -r '[.labels[]?.name]|join(",")' "$file" ;; *) jq -r ".$field // empty" "$file" ;; esac ;;
    node) F="$file" K="$field" node -e 'const j=JSON.parse(require("fs").readFileSync(process.env.F,"utf8"));const k=process.env.K;process.stdout.write(k==="labels"?(j.labels||[]).map(l=>l.name).join(","):String(j[k]??""))' ;;
    python3) F="$file" K="$field" python3 -c 'import json,os;j=json.load(open(os.environ["F"],encoding="utf-8"));k=os.environ["K"];print(",".join(l["name"] for l in j.get("labels",[])) if k=="labels" else j.get(k,""),end="")' ;;
  esac
}
# JSON 文字列として出す（出力用）
jstr() { case "$TOOL" in jq) jq -Rn --arg s "$1" '$s' ;; node) S="$1" node -e 'process.stdout.write(JSON.stringify(process.env.S))' ;; python3) S="$1" python3 -c 'import json,os;print(json.dumps(os.environ["S"],ensure_ascii=False),end="")' ;; esac; }

PAYLOAD="$(build_payload)"

if [ "$DRY" -eq 1 ]; then
  echo "(dry-run) POST $API_BASE/repos/$REPO/issues"
  echo "$PAYLOAD"
  exit 0
fi

if [ -z "${GH_TOKEN:-}" ]; then echo "GH_TOKEN が未設定（チャットに貼らず、環境変数か Secrets で渡す）" >&2; exit 2; fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
umask 077
printf 'Authorization: Bearer %s\n' "$GH_TOKEN" > "$TMP/hdr"
printf '%s' "$PAYLOAD" > "$TMP/payload.json"

HTTP="$(curl -sS -o "$TMP/resp.json" -w '%{http_code}' -X POST \
  -H @"$TMP/hdr" \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  -H 'Content-Type: application/json; charset=utf-8' \
  --data-binary @"$TMP/payload.json" \
  "$API_BASE/repos/$REPO/issues" || true)"

if [ "$HTTP" != "201" ]; then
  MSG="$(pick "$TMP/resp.json" message 2>/dev/null || true)"
  [ -z "$MSG" ] && MSG="(応答なし／JSON ではない)"
  # トークンらしき文字列は応答に含まれない想定だが、念のため伏せる
  MSG="$(printf '%s' "$MSG" | sed -E 's/(ghp_|gho_|ghs_|github_pat_)[A-Za-z0-9_]+/[伏せた]/g')"
  printf '{"ok":false,"http":%s,"message":%s}\n' "${HTTP:-0}" "$(jstr "$MSG")"
  exit 1
fi

NUMBER="$(pick "$TMP/resp.json" number)"
URL="$(pick "$TMP/resp.json" html_url)"
GOT="$(pick "$TMP/resp.json" labels)"
printf '{"ok":true,"number":%s,"url":%s,"labels":%s}\n' "$NUMBER" "$(jstr "$URL")" "$(jstr "$GOT")"

# 要求したラベルが全部付いたか（付いていないと、ワーカーは拾わない）
IFS=',' read -r -a WANT <<< "$LABELS"
for w in "${WANT[@]}"; do
  [ -z "$w" ] && continue
  case ",$GOT," in *",$w,"*) ;; *) echo "警告: ラベル '$w' が付いていない（権限不足の可能性）。ワーカーはこの Issue を拾いません。" >&2; exit 3 ;; esac
done
exit 0

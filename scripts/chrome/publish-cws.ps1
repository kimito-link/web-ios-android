# Chrome Web Store 公開スクリプト (アップロード + 審査提出)
# 君斗りんくのWEBサイト健康診断 & OSINT Helper
#
# ★コンソールの無い環境（CI・AIハーネス・タスクスケジューラ）で【固まって返ってこない】
#   のを止める。Invoke-RestMethod は進捗バーを描こうとするが、描く先が無いと待ち続ける。
#   実測: 既定=返ってこない / 抑止あり=402ms(1KB)・669ms(1.5MB)。
#   ★審査提出が「無反応で止まった」ように見える事故の原因になる。
$ProgressPreference = 'SilentlyContinue'
#
# Chrome Web Store API v1.1 で zip をアップロードし、審査に提出する。
# iOS の Transporter / Android の Play Developer API に相当。審査の「通過」は
# Google 側の処理なので自動化対象外 (提出までを自動化する)。
#
# 前提:
#   - .env.cws に認証情報 (PUBLISH-SETUP.md の手順で取得)
#   - store-assets\dns-osint-pro-v<version>.zip が存在 (.\build-zip.ps1 で作成)
#
# 使い方:
#   .\publish-cws.ps1              # アップロード → 確認 → 審査提出
#   .\publish-cws.ps1 -UploadOnly  # アップロードのみ (提出しない。下書き確認用)
#   .\publish-cws.ps1 -Yes         # 確認プロンプトを省略 (CI 用)

param(
    [switch]$UploadOnly,
    [switch]$Yes
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
# 拡張ルート(manifest.json のある場所)へ移動。dist/ や .env.cws はそこ基準。
$root = Get-Location
while (-not (Test-Path (Join-Path $root "manifest.json")) -and $root.Path -ne $root.Drive.Root) {
    $root = Split-Path $root -Parent
}
if (-not (Test-Path (Join-Path $root "manifest.json"))) {
    Write-Host "ERROR: manifest.json が見つかりません。拡張のルートで実行してください。" -ForegroundColor Red
    exit 1
}
Set-Location $root

# --- .env.cws 読み込み(拡張ルート優先、無ければ scripts/chrome のもの) ---
$envFile = ".env.cws"
if (-not (Test-Path $envFile) -and (Test-Path (Join-Path $PSScriptRoot ".env.cws"))) {
    $envFile = Join-Path $PSScriptRoot ".env.cws"
}
if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: .env.cws がありません。" -ForegroundColor Red
    Write-Host "  Copy-Item scripts\chrome\.env.cws.example .env.cws  して値を埋めてください (手順は docs\CHROME-WEBSTORE.md)。" -ForegroundColor Yellow
    exit 1
}
$cfg = @{}
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#') { return }
    if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.+?)\s*$') { $cfg[$matches[1]] = $matches[2] }
}
foreach ($k in 'CWS_CLIENT_ID','CWS_CLIENT_SECRET','CWS_REFRESH_TOKEN','CWS_ITEM_ID') {
    if (-not $cfg[$k] -or $cfg[$k] -match 'xxxx') {
        Write-Host "ERROR: $envFile の $k が未設定です。" -ForegroundColor Red
        exit 1
    }
}

# --- zip 特定 (manifest の version) ---
# build-zip.ps1 の出力 dist\<name>-v<version>.zip を探す(汎用テンプレ)。
$manifest = Get-Content "manifest.json" -Raw | ConvertFrom-Json
$version = $manifest.version
$name = ($manifest.name -replace '[^\w\-]', '') -replace '^_+', ''
if (-not $name) { $name = "extension" }
$zipPath = "dist\$name-v$version.zip"
if (-not (Test-Path $zipPath)) {
    # フォールバック: dist 内の同 version zip を拾う
    $alt = Get-ChildItem "dist\*-v$version.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($alt) { $zipPath = $alt.FullName }
}
if (-not (Test-Path $zipPath)) {
    Write-Host "ERROR: $zipPath が見つかりません。先に .\build-zip.ps1 を実行してください。" -ForegroundColor Red
    exit 1
}
Write-Host "対象: $zipPath (v$version)" -ForegroundColor Cyan

# --- 1. refresh_token → access_token ---
Write-Host "[1/3] アクセストークン取得..." -ForegroundColor Yellow
$tokenResp = Invoke-RestMethod -Method Post -Uri "https://oauth2.googleapis.com/token" -Body @{
    client_id     = $cfg['CWS_CLIENT_ID']
    client_secret = $cfg['CWS_CLIENT_SECRET']
    refresh_token = $cfg['CWS_REFRESH_TOKEN']
    grant_type    = "refresh_token"
}
$accessToken = $tokenResp.access_token
if (-not $accessToken) { Write-Host "ERROR: アクセストークン取得失敗" -ForegroundColor Red; exit 1 }
$headers = @{ Authorization = "Bearer $accessToken"; "x-goog-api-version" = "2" }

# --- 2. zip アップロード (PUT items/{id}) ---
Write-Host "[2/3] zip アップロード中..." -ForegroundColor Yellow
$itemId = $cfg['CWS_ITEM_ID']
$zipBytes = [System.IO.File]::ReadAllBytes((Resolve-Path $zipPath))
$uploadResp = Invoke-RestMethod -Method Put `
    -Uri "https://www.googleapis.com/upload/chromewebstore/v1.1/items/$itemId" `
    -Headers $headers -Body $zipBytes
if ($uploadResp.uploadState -eq "FAILURE") {
    Write-Host "ERROR: アップロード失敗:" -ForegroundColor Red
    $uploadResp.itemError | ForEach-Object { Write-Host "  - $($_.error_detail)" -ForegroundColor Red }
    exit 1
}
Write-Host "  アップロード OK (uploadState=$($uploadResp.uploadState))" -ForegroundColor Green

if ($UploadOnly) {
    Write-Host "-UploadOnly 指定のため審査提出はしません。ダッシュボードで下書きを確認してください。" -ForegroundColor Cyan
    exit 0
}

# --- 3. 審査提出 (POST items/{id}/publish) ---
if (-not $Yes) {
    Write-Host ""
    Write-Host "次に審査へ提出します (公開申請)。過去の却下歴 (Blue Argon=リモートコード / Red Nickel=禁止語) に" -ForegroundColor Yellow
    Write-Host "該当しない zip であることを確認済みですか？ vendor/ 同梱・禁止語なしが前提です。" -ForegroundColor Yellow
    $ans = Read-Host "審査提出する場合は 'yes' と入力"
    if ($ans -ne "yes") { Write-Host "中止しました (アップロードは完了済み。手動で提出も可)。" -ForegroundColor Cyan; exit 0 }
}
Write-Host "[3/3] 審査提出中..." -ForegroundColor Yellow
$publishResp = Invoke-RestMethod -Method Post `
    -Uri "https://www.googleapis.com/chromewebstore/v1.1/items/$itemId/publish" `
    -Headers $headers
Write-Host "========================================" -ForegroundColor Green
Write-Host "審査提出 完了: status=$($publishResp.status -join ', ')" -ForegroundColor Green
if ($publishResp.statusDetail) { $publishResp.statusDetail | ForEach-Object { Write-Host "  $_" -ForegroundColor Cyan } }
Write-Host "Google の審査結果はメール / ダッシュボードで確認 (数時間〜数日)。" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Green

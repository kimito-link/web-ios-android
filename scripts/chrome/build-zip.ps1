# Chrome 拡張 ZIP作成スクリプト(汎用テンプレ)
#
# manifest.json から version を自動取得し、拡張のファイル一式を zip にパッケージ化する。
# どの拡張でも使えるよう、同梱対象は manifest.json と同じ階層の主要ファイル/ディレクトリを
# 自動で拾う(node_modules・.git・store-assets 等の不要物は除外)。
#
# 使い方(拡張のルートで実行):
#   .\build-zip.ps1
# 出力: dist\<拡張名>-v<version>.zip
#
# ★ MV3 の注意: 外部CDNを実行時に読むと「リモートコード」違反で却下される。
#   ライブラリは vendor/ 等に同梱し、それごと zip に入れること(下記の同梱対象に含まれる)。

param([string]$OutDir = "dist")

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
# scripts/chrome/ から拡張ルートを推定(必要に応じて調整)。manifest.json のある場所を探す。
$root = Get-Location
while (-not (Test-Path (Join-Path $root "manifest.json")) -and $root.Path -ne $root.Drive.Root) {
    $root = Split-Path $root -Parent
}
if (-not (Test-Path (Join-Path $root "manifest.json"))) {
    Write-Host "ERROR: manifest.json が見つかりません。拡張のルートで実行してください。" -ForegroundColor Red
    exit 1
}
Set-Location $root

$manifest = Get-Content "manifest.json" -Raw | ConvertFrom-Json
$version = $manifest.version
$name = ($manifest.name -replace '[^\w\-]', '') -replace '^_+', ''
if (-not $name) { $name = "extension" }

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
$zipName = Join-Path $OutDir "$name-v$version.zip"
$tempDir = ".\temp-zip-v$version"

Write-Host "Chrome拡張 ZIP作成: $name v$version" -ForegroundColor Cyan
if (Test-Path $tempDir) { Remove-Item -Path $tempDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

# 同梱対象: ルート直下のファイル/ディレクトリから不要物を除外して全部入れる。
$exclude = @('node_modules', '.git', '.github', 'dist', 'store-assets', $OutDir, (Split-Path $tempDir -Leaf), '.vscode', '.idea', 'test', 'tests')
Get-ChildItem -Path $root -Force | Where-Object {
    $exclude -notcontains $_.Name -and $_.Name -notlike '.env*' -and $_.Name -notlike '*.zip' -and $_.Name -notlike 'temp-zip-*'
} | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $tempDir -Recurse -Force
}

# vendor/ が存在するのに zip に入っていなければ警告(MV3 リモートコード対策の要)
if ((Test-Path (Join-Path $root "vendor")) -and -not (Test-Path (Join-Path $tempDir "vendor"))) {
    Write-Host "WARN: vendor/ が同梱されていません。MV3 で却下される恐れ。" -ForegroundColor Yellow
}

if (Test-Path $zipName) { Remove-Item -Path $zipName -Force }
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipName -Force
Remove-Item -Path $tempDir -Recurse -Force

$sizeMB = [math]::Round((Get-Item $zipName).Length / 1MB, 2)
Write-Host "完了: $zipName ($sizeMB MB)" -ForegroundColor Green
Write-Host "次: .\scripts\chrome\publish-cws.ps1 でアップロード+審査提出" -ForegroundColor Cyan

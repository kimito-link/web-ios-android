<#
.SYNOPSIS
  Android TWA の Release AAB をビルドする。
.DESCRIPTION
  金型（無改変で使える）。出どころ: partnership_program_website/scripts/build-android-aab.ps1
  - JAVA_HOME 未設定時は ../.bubblewrap-config.json の jdkPath（JDK 17）を使う。
  - clean は OneDrive のロックで失敗しがちなので既定でスキップ。-Clean で実施。
  - 事前に scripts/android-patch-signing.mjs が走って署名ブロックが注入済みであること
    （bubblewrap init/update の直後に実行する。未注入だと無署名 AAB → Play 拒否）。
  - 生成物: android-twa/app/build/outputs/bundle/release/app-release.aab
           android-twa/app/build/outputs/bundle/release/app-release-mapping.txt
.EXAMPLE
  pwsh scripts/build-android-aab.ps1
  pwsh scripts/build-android-aab.ps1 -Clean
#>

[CmdletBinding()]
param(
  [switch]$Clean
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$twaDir   = Join-Path $repoRoot "android-twa"

if (-not (Test-Path $twaDir)) {
  throw "android-twa ディレクトリが見つかりません: $twaDir（先に bubblewrap init を実行）"
}

# JAVA_HOME 検出
if (-not $env:JAVA_HOME -or -not (Test-Path (Join-Path $env:JAVA_HOME "bin\java.exe"))) {
  $bubbleConf = Join-Path $repoRoot ".bubblewrap-config.json"
  if (Test-Path $bubbleConf) {
    $conf = Get-Content $bubbleConf -Raw | ConvertFrom-Json
    if ($conf.jdkPath -and (Test-Path (Join-Path $conf.jdkPath "bin\java.exe"))) {
      $env:JAVA_HOME = $conf.jdkPath
      Write-Host "[android-bundle] JAVA_HOME を .bubblewrap-config.json から設定: $env:JAVA_HOME"
    }
  }
}
if (-not $env:JAVA_HOME) {
  throw "JAVA_HOME が未設定です。JDK 17 をインストールするか .bubblewrap-config.json の jdkPath を設定してください。"
}
$env:Path = (Join-Path $env:JAVA_HOME "bin") + [IO.Path]::PathSeparator + $env:Path

Push-Location $twaDir
try {
  & ".\gradlew.bat" --stop | Out-Null
  if ($Clean) {
    Write-Host "[android-bundle] clean 実行..."
    & ".\gradlew.bat" clean
    if ($LASTEXITCODE -ne 0) { throw "clean 失敗 ($LASTEXITCODE)" }
  }
  Write-Host "[android-bundle] bundleRelease 実行..."
  & ".\gradlew.bat" bundleRelease --no-daemon
  if ($LASTEXITCODE -ne 0) { throw "bundleRelease 失敗 ($LASTEXITCODE)" }

  $aab = Join-Path $twaDir "app\build\outputs\bundle\release\app-release.aab"
  if (-not (Test-Path $aab)) { throw "AAB が出力されていません: $aab" }
  Write-Host "[android-bundle] OK : $aab"

  # mapping.txt をリリース成果物の隣にコピー（Play Console の ReTrace 用）
  $mappingSrc = Join-Path $twaDir "app\build\outputs\mapping\release\mapping.txt"
  $mappingDst = Join-Path $twaDir "app\build\outputs\bundle\release\app-release-mapping.txt"
  if (Test-Path $mappingSrc) {
    Copy-Item -Force $mappingSrc $mappingDst
    Write-Host "[android-bundle] mapping : $mappingDst"
  } else {
    Write-Warning "mapping.txt が見つかりませんでした（minifyEnabled=true でも条件次第で出ない場合あり）。"
  }
} finally {
  Pop-Location
}

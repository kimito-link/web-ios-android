<#
.SYNOPSIS
  .secrets-local/android-upload-key.jks の SHA256 fingerprint を表示する。
.DESCRIPTION
  金型（無改変で使える）。出どころ: partnership_program_website/scripts/print-android-fingerprint.ps1
  TWA/Capacitor どちらの Android 構成でも共用。
  Digital Asset Links（本番サイトの /.well-known/assetlinks.json）に貼る値を確認するためのもの
  （TWA構成のみ必要。Capacitor構成では通常不要）。
  - 製品版に出している場合は、Play Console の「アプリの署名」→「アプリ署名鍵証明書」の SHA256 を使うこと
    （Play App Signing が有効な場合、ローカルの upload key とは別の指紋になる）。
#>

[CmdletBinding()]
param(
  [string]$Alias = "upload"
)

$ErrorActionPreference = "Stop"
$repoRoot   = Resolve-Path (Join-Path $PSScriptRoot "..")
$secretsDir = Join-Path $repoRoot ".secrets-local"
$jks       = Join-Path $secretsDir "android-upload-key.jks"
$propsFile = Join-Path $secretsDir "keystore.properties"

if (-not (Test-Path $jks))       { throw "鍵がありません: $jks（create-android-keystore.ps1 で作成）" }
if (-not (Test-Path $propsFile)) { throw "$propsFile がありません" }

# keytool 検出
$keytool = $null
if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME "bin\keytool.exe"))) {
  $keytool = Join-Path $env:JAVA_HOME "bin\keytool.exe"
} else {
  $bubbleConf = Join-Path $repoRoot ".bubblewrap-config.json"
  if (Test-Path $bubbleConf) {
    $conf = Get-Content $bubbleConf -Raw | ConvertFrom-Json
    if ($conf.jdkPath -and (Test-Path (Join-Path $conf.jdkPath "bin\keytool.exe"))) {
      $keytool = Join-Path $conf.jdkPath "bin\keytool.exe"
    }
  }
}
if (-not $keytool) { throw "keytool が見つかりません" }

# storePassword 抽出（BOM 対応）
$raw = [IO.File]::ReadAllText($propsFile, [Text.UTF8Encoding]::new($true))
$store = ($raw -split "`r?`n" | Where-Object { $_ -match '^\s*storePassword\s*=' } | Select-Object -First 1)
if (-not $store) { throw "storePassword が読めません" }
$storePass = ($store -split '=', 2)[1].Trim()

Write-Host "=== keytool -list -v ==="
& $keytool -list -v -keystore $jks -alias $Alias -storepass $storePass

Write-Host ""
Write-Host "上の 'SHA256' 行（XX:XX:...）の値を、本番デプロイ前に下記へ反映してください:"
Write-Host "  本番サイトの /.well-known/assetlinks.json"
Write-Host "  -> sha256_cert_fingerprints[0]"
Write-Host "（Play App Signing 有効時は Play Console の『アプリ署名鍵証明書』SHA256 を使う）"

<#
.SYNOPSIS
  Android アップロード用キーストア（android-upload-key.jks）と keystore.properties を作成する。
.DESCRIPTION
  金型。出どころ: partnership_program_website/scripts/create-android-keystore.ps1
  - 既存ファイルがある場合は上書きしない（誤消失防止＝鍵を失うとアプリ更新不能になるため）。
  - keytool は JAVA_HOME か .bubblewrap-config.json の jdkPath（JDK 17 同梱）を使う。
  - 出力先: android-twa/android-upload-key.jks, android-twa/keystore.properties
  - DistinguishedName（証明書のCN等）は引数で渡す。app.config.json の ownership.organization /
    contact 名から組み立てるか、-DistinguishedName で明示する。プレースホルダのまま実行しないこと。
  ★この jks は各アプリで固有。キット間でコピーしない。生成後は安全な場所にバックアップする。
.EXAMPLE
  pwsh scripts/create-android-keystore.ps1 -DistinguishedName "CN=<運営者名>, O=<会社名>, L=Tokyo, C=JP" -StorePassword "********"
#>

[CmdletBinding()]
param(
  [string]$Alias = "upload",
  # 証明書の識別名。app.config.json の ownership.organization 等から組み立てて渡すこと。
  [string]$DistinguishedName = "CN=<運営者名>, O=<会社名>, L=Tokyo, C=JP",
  [int]$ValidityDays = 10000,
  # 非対話実行用（CI / 自動化）。指定すると Read-Host を使わない。
  [string]$StorePassword,
  [string]$KeyPassword
)

$ErrorActionPreference = "Stop"
$repoRoot  = Resolve-Path (Join-Path $PSScriptRoot "..")
$twaDir    = Join-Path $repoRoot "android-twa"
$jks       = Join-Path $twaDir "android-upload-key.jks"
$propsFile = Join-Path $twaDir "keystore.properties"

if ($DistinguishedName -match '<') {
  throw "DistinguishedName がプレースホルダのままです。-DistinguishedName 'CN=..., O=..., L=Tokyo, C=JP' を指定してください。"
}
if (Test-Path $jks)       { throw "既に存在します: $jks（消失リスクのため自動上書きしません）" }
if (Test-Path $propsFile) { throw "既に存在します: $propsFile（消失リスクのため自動上書きしません）" }

# keytool 探索
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
if (-not $keytool) { throw "keytool が見つかりません。JDK 17 をインストールしてください。" }

if ($StorePassword) {
  $storePlain = $StorePassword
  $keyPlain   = if ($KeyPassword) { $KeyPassword } else { $StorePassword }
  Write-Host "[create-android-keystore] 非対話モード（-StorePassword 指定）"
} else {
  $store = Read-Host -AsSecureString "ストアパスワード（store password）を入力"
  $key   = Read-Host -AsSecureString "鍵パスワード（key password）を入力（store と同じで OK）"
  $storePlain = [System.Net.NetworkCredential]::new("", $store).Password
  $keyPlain   = [System.Net.NetworkCredential]::new("", $key).Password
}

if ($storePlain.Length -lt 6) {
  throw "store password は 6 文字以上必要です（keytool の制約）"
}

& $keytool -genkeypair `
  -v `
  -keystore $jks `
  -alias $Alias `
  -keyalg RSA -keysize 2048 -validity $ValidityDays `
  -storepass $storePlain -keypass $keyPlain `
  -dname $DistinguishedName

if ($LASTEXITCODE -ne 0) { throw "keytool 失敗 ($LASTEXITCODE)" }

# keystore.properties を BOM なし UTF-8 で書く（BOM 付きだと Gradle が NPE）
$content = @(
  "storePassword=$storePlain",
  "keyPassword=$keyPlain",
  "keyAlias=$Alias"
) -join "`n"

[IO.File]::WriteAllText($propsFile, $content, [Text.UTF8Encoding]::new($false))

Write-Host "[create-android-keystore] OK"
Write-Host "  jks   : $jks"
Write-Host "  props : $propsFile"
Write-Host ""
Write-Host "次は: scripts/print-android-fingerprint.ps1 でローカル鍵の SHA256 を確認、"
Write-Host "Play Console アップロード後は『アプリの署名』の SHA256 を"
Write-Host "本番サイトの /.well-known/assetlinks.json に反映してください。"
Write-Host ""
Write-Host "⚠️ この jks と keystore.properties は絶対に commit しない（.gitignore へ）。失うとアプリ更新不能。バックアップ必須。"

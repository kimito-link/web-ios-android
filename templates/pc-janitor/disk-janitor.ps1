# disk-janitor.ps1 - keep drive C from filling up with leftovers of AI sessions.
# Comments are English only (Japanese comments break under Shift-JIS PowerShell).
#
# What grows without limit on this PC (measured 2026-11-28, C free 98GB -> 8.6GB in 10 days):
#   - git worktrees under github\_worktrees\<repo>\<task>  (each has its own node_modules)
#   - throw-away clones / worktrees under C:\tmp
#   - %TEMP% (playwright profiles, compare outputs, installers)
# Nothing removed this way is lost: a worktree/clone is removed ONLY when
#   (1) git status is clean (no modified / untracked files),
#   (2) every commit reachable from it exists on a remote (rev-list --not --remotes == 0),
#   (3) no stash (full clones), and
#   (4) it was not touched for MinAgeDays.
# Anything else is kept and listed in the report. Non-git folders in C:\tmp are only reported.
#
# Usage:
#   pwsh -File disk-janitor.ps1            # dry run, prints what would be removed
#   pwsh -File disk-janitor.ps1 -Apply     # remove
# Writes a JSON report to $ReportPath and pops up a warning when C free < AlertFreeGB.

param(
  [switch]$Apply,
  [int]$MinAgeDays = 3,
  [int]$TempAgeDays = 2,
  [int]$AlertFreeGB = 40,
  [string]$GithubRoot = '',
  [string[]]$TmpRoots = @('C:\tmp'),
  [string]$ReportPath = '',
  [switch]$NoPopup
)

$ErrorActionPreference = 'Continue'
$now = Get-Date
if (-not $GithubRoot) { $GithubRoot = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Resilio\github' }
if (-not $ReportPath) { $ReportPath = Join-Path $env:USERPROFILE 'claude-ops\disk-janitor.last.json' }

function Get-FreeGB { [math]::Round((Get-PSDrive C).Free / 1GB, 1) }

function Get-DirBytes([string]$p) {
  (Get-ChildItem -LiteralPath $p -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
}

function Get-LastTouch([string]$p) {
  # newest write time among the folder itself and its direct children (cheap proxy for "in use")
  $t = (Get-Item -LiteralPath $p -Force).LastWriteTime
  Get-ChildItem -LiteralPath $p -Force -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Name -ne 'node_modules' -and $_.LastWriteTime -gt $t) { $t = $_.LastWriteTime }
  }
  $t
}

function Remove-JunctionsFirst([string]$p) {
  # A junction (e.g. node_modules linked to the main checkout) must be unlinked, never recursed,
  # otherwise the recursive delete empties the link target (real loss seen 2026-10-05).
  Get-ChildItem -LiteralPath $p -Recurse -Force -Directory -Attributes ReparsePoint -ErrorAction SilentlyContinue |
    ForEach-Object { try { [System.IO.Directory]::Delete($_.FullName, $false) } catch { cmd /c rmdir "$($_.FullName)" 2>$null } }
}

function Remove-Tree([string]$p) {
  Remove-JunctionsFirst $p
  cmd /c rmdir /s /q "$p" 2>$null
  -not (Test-Path -LiteralPath $p)
}

function Test-GitSafeToDrop([string]$p) {
  # returns $null when safe, otherwise the reason to keep it
  $st = git -C $p status --porcelain 2>$null
  if ($LASTEXITCODE -ne 0) { return 'git status failed' }
  if ($st) { return "uncommitted ($(@($st).Count) files)" }
  $isWorktree = Test-Path -LiteralPath (Join-Path $p '.git') -PathType Leaf
  # worktree: only its HEAD matters (branches are shared with the main checkout)
  # full clone: every local branch must already be on a remote
  if ($isWorktree) { $n = git -C $p rev-list --count HEAD --not --remotes 2>$null }
  else { $n = git -C $p rev-list --count --branches HEAD --not --remotes 2>$null }
  if ($LASTEXITCODE -ne 0) { return 'rev-list failed' }
  if ([int]$n -gt 0) { return "unpushed commits ($n)" }
  if (-not $isWorktree) {
    $stash = git -C $p stash list 2>$null
    if ($stash) { return 'has stash' }
  }
  return $null
}

$removed = New-Object System.Collections.Generic.List[object]
$kept = New-Object System.Collections.Generic.List[object]
$freeBefore = Get-FreeGB

function Invoke-Candidate([string]$p, [string]$kind) {
  $age = [int]($now - (Get-LastTouch $p)).TotalDays
  $isGit = Test-Path -LiteralPath (Join-Path $p '.git')
  $reason = $null
  if ($age -lt $MinAgeDays) { $reason = "recent ($age d)" }
  elseif (-not $isGit) { $reason = 'not a git checkout (report only)' }
  else { $reason = Test-GitSafeToDrop $p }
  $gb = [double][math]::Round([double](Get-DirBytes $p) / 1GB, 2)
  if ($reason) { $kept.Add([pscustomobject]@{ path = $p; gb = $gb; age = $age; reason = $reason }); return }
  $ok = $true
  if ($Apply) {
    $isWorktree = Test-Path -LiteralPath (Join-Path $p '.git') -PathType Leaf
    if ($isWorktree) {
      $common = git -C $p rev-parse --path-format=absolute --git-common-dir 2>$null
      Remove-JunctionsFirst $p
      if ($common) { git --git-dir "$common" worktree remove --force "$p" 2>$null | Out-Null }
      if (Test-Path -LiteralPath $p) { $ok = Remove-Tree $p }
      if ($common) { git --git-dir "$common" worktree prune 2>$null | Out-Null }
    } else {
      $ok = Remove-Tree $p
    }
  }
  if ($ok) { $removed.Add([pscustomobject]@{ path = $p; gb = $gb; age = $age; kind = $kind }) }
  else { $kept.Add([pscustomobject]@{ path = $p; gb = $gb; age = $age; reason = 'delete failed (in use?)' }) }
}

# 1) worktrees under github\_worktrees\<repo>\<task>
$wtRoot = Join-Path $GithubRoot '_worktrees'
if (Test-Path -LiteralPath $wtRoot) {
  Get-ChildItem -LiteralPath $wtRoot -Directory -Force | ForEach-Object {
    Get-ChildItem -LiteralPath $_.FullName -Directory -Force | ForEach-Object { Invoke-Candidate $_.FullName 'worktree' }
  }
}

# 2) C:\tmp and other scratch roots
foreach ($r in $TmpRoots) {
  if (Test-Path -LiteralPath $r) {
    Get-ChildItem -LiteralPath $r -Directory -Force | ForEach-Object { Invoke-Candidate $_.FullName 'tmp' }
  }
}

# 3) %TEMP% entries older than TempAgeDays (temp by definition; locked files are skipped).
#    'claude' holds live session task outputs, so it is left alone.
$tempGB = 0
Get-ChildItem -LiteralPath $env:TEMP -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt $now.AddDays(-$TempAgeDays) -and $_.Name -ne 'claude' } |
  ForEach-Object {
    $b = if ($_.PSIsContainer) { Get-DirBytes $_.FullName } else { $_.Length }
    $tempGB += $b / 1GB
    if ($Apply) {
      if ($_.PSIsContainer) { Remove-Tree $_.FullName | Out-Null } else { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
    }
  }

# 4) package-manager caches (re-downloadable)
if ($Apply) {
  if (Get-Command pnpm -ErrorAction SilentlyContinue) { pnpm store prune 2>$null | Out-Null }
  if (Get-Command npm -ErrorAction SilentlyContinue) { npm cache clean --force 2>$null | Out-Null }
}

$freeAfter = Get-FreeGB
# build plain arrays first: a pipeline inside the [pscustomobject]@{} literal throws
# "Argument types do not match" and left the report as null (seen 2026-11-28)
$keptArr = [object[]]($kept.ToArray() | Sort-Object gb -Descending)
$removedArr = [object[]]$removed.ToArray()
$report = [pscustomobject]@{
  at = $now.ToString('s'); apply = [bool]$Apply
  freeBeforeGB = $freeBefore; freeAfterGB = $freeAfter
  removedGB = [math]::Round((($removed | Measure-Object gb -Sum).Sum) + $tempGB, 1)
  removedCount = $removed.Count; tempGB = [math]::Round($tempGB, 1)
  kept = $keptArr
  removed = $removedArr
}
New-Item -ItemType Directory -Force -Path (Split-Path $ReportPath) | Out-Null
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ReportPath -Encoding utf8

"C free: $freeBefore GB -> $freeAfter GB  (dirs $($removed.Count) = $([math]::Round((($removed | Measure-Object gb -Sum).Sum),1)) GB, temp $([math]::Round($tempGB,1)) GB, apply=$([bool]$Apply))"
"kept (largest first):"
$kept | Sort-Object gb -Descending | Select-Object -First 15 | Format-Table -AutoSize | Out-String -Width 250

if (-not $NoPopup -and $freeAfter -lt $AlertFreeGB) {
  $msg = "Drive C free space is low: $freeAfter GB (threshold $AlertFreeGB GB). Report: $ReportPath"
  (New-Object -ComObject WScript.Shell).Popup($msg, 0, 'disk-janitor', 0x30) | Out-Null
}

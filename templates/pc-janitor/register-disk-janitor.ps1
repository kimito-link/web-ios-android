# register-disk-janitor.ps1 - install disk-janitor.ps1 as a daily scheduled task.
# English comments only. Copies the script to an ASCII path (%USERPROFILE%\claude-ops) because
# scheduled tasks + Japanese paths are a known breakage on this PC.
param(
  [string]$At = '04:30',
  [string]$TaskName = 'ClaudeDiskJanitor'
)
$dest = Join-Path $env:USERPROFILE 'claude-ops'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'disk-janitor.ps1') -Destination (Join-Path $dest 'disk-janitor.ps1') -Force

$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $pwsh) { $pwsh = (Get-Command powershell).Source }
$taskArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dest\disk-janitor.ps1`" -Apply"
$action = New-ScheduledTaskAction -Execute $pwsh -Argument $taskArgs
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Remove clean+pushed AI worktrees/clones, old temp, warn when C is low' -Force | Out-Null
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State

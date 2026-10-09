# register-task.ps1 - Register worker.mjs as a Windows Task Scheduler job that runs every N minutes.
#
# NOTE: Comments in this file are English only on purpose. Windows PowerShell can misread
# a UTF-8 .ps1 file containing Japanese as Shift-JIS and break the script (known pitfall in this kit).
#
# Default behaviour is SAFE: it only PRINTS what it would do. Nothing is registered until you pass -Apply.
#
#   .\register-task.ps1                          # show the command (no change)
#   .\register-task.ps1 -Apply                   # register (runs only while you are logged on)
#   .\register-task.ps1 -Apply -EveryMinutes 15  # change the interval
#   .\register-task.ps1 -Remove                  # delete the task
#
# The task runs "node worker.mjs --once" (one pass, then exit). It does NOT keep a process resident,
# so a leak or a hang cannot carry over to the next pass. A lock file prevents overlapping runs.
# Pause everything without touching the scheduler: create the file  <stateDir>\PAUSE  (delete it to resume).
param(
  [string]$WorkerPath = (Join-Path $PSScriptRoot 'worker.mjs'),
  [string]$ConfigPath = '',
  [int]$EveryMinutes = 10,
  [switch]$Apply,
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$taskName = 'idea-pipeline-worker'

if ($Remove) {
  schtasks /Delete /TN $taskName /F
  exit $LASTEXITCODE
}

if ($EveryMinutes -lt 5 -or $EveryMinutes -gt 1440) { throw 'EveryMinutes must be between 5 and 1440' }
if (-not (Test-Path $WorkerPath)) { throw "worker.mjs not found: $WorkerPath" }
$node = (Get-Command node -ErrorAction Stop).Source

$argLine = '"' + (Resolve-Path $WorkerPath).Path + '" --once'
if ($ConfigPath -ne '') { $argLine += ' --config "' + (Resolve-Path $ConfigPath).Path + '"' }
$tr = '"' + $node + '" ' + $argLine

Write-Host "Task name : $taskName"
Write-Host "Interval  : every $EveryMinutes minutes"
Write-Host "Command   : $tr"
Write-Host 'Runs as   : the current user, only while logged on (no stored password)'

if (-not $Apply) {
  Write-Host ''
  Write-Host 'Dry run only. Re-run with -Apply to register.'
  exit 0
}

# Make sure the ANTHROPIC_API_KEY user-level variable is not set: with it, claude bills the API instead of the subscription.
$userKey = [Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY', 'User')
if ($userKey) { Write-Warning 'ANTHROPIC_API_KEY is set at user level. worker.mjs removes it for the child process, but remove it unless you need it elsewhere.' }

schtasks /Create /SC MINUTE /MO $EveryMinutes /TN $taskName /TR $tr /F
exit $LASTEXITCODE

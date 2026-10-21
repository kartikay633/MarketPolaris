# Wide-universe study (ml/WIDE_PROTOCOL.md, amendments 1, 1b and 1c), after the candles, the twenty-year
# extension and NSE's corporate actions are collected: board meetings (results calendar), then the
# development runs for risk and ranking, then the single holdout evaluation with the gates.
# Runs at below-normal priority; logs go to data/pulse-wide/train.log. A finished step is not repeated.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$py = Join-Path $root '.venv-pulse\Scripts\python.exe'
$log = Join-Path $root 'data\pulse-wide\train.log'
$env:PYTHONUTF8 = '1'
$reports = Join-Path $root 'data\pulse-wide\reports'
(Get-Process -Id $PID).PriorityClass = 'BelowNormal'

# Ask Windows not to sleep while this script runs (ES_CONTINUOUS | ES_SYSTEM_REQUIRED); the request
# ends with the process, so no power setting is changed.
Add-Type -Namespace Polaris -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
[void][Polaris.Power]::SetThreadExecutionState([uint32]'0x80000001')

# v4's nightly job (22:00, Mon-Fri) has priority. Training is long and memory-hungry, so on a weekday
# evening it starts only after that job (22:40 at the earliest), and never while it runs.
function WaitForNightlyJob {
  while ($true) {
    $now = Get-Date
    $weekday = $now.DayOfWeek -notin 'Saturday', 'Sunday'
    $beforeJob = $weekday -and $now.TimeOfDay -ge [TimeSpan]'17:00' -and $now.TimeOfDay -lt [TimeSpan]'22:40'
    $running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'pulse-daily' }
    if (-not $beforeJob -and -not $running) { return }
    Start-Sleep -Seconds 60
  }
}

# A board-meeting collection already finished (or still running from an earlier start) is not repeated.
function BoardMeetingsDone {
  $status = Join-Path $root 'data\pulse-wide\news-history\status.json'
  while (Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match 'news_history' -and $_.CommandLine -match 'pulse-wide' }) { Start-Sleep -Seconds 30 }
  (Test-Path $status) -and ((Get-Content $status -Raw | ConvertFrom-Json).finishedAt)
}

function DevDone($kind) {
  $file = Join-Path $reports "wide-dev-$kind.json"
  (Test-Path $file) -and ((Get-Content $file -Raw | ConvertFrom-Json).complete)
}

function Step($name, [string[]]$arguments, [switch]$model) {
  if ($model) { WaitForNightlyJob }
  Add-Content $log "[$(Get-Date -Format s)] > $name" -Encoding UTF8
  # cmd appends the bytes as Python writes them (UTF-8); PowerShell 5.1's own redirect would write UTF-16.
  cmd /c "`"$py`" -W ignore $($arguments -join ' ') >> `"$log`" 2>&1"
  if ($LASTEXITCODE -ne 0) { Add-Content $log "[$(Get-Date -Format s)] < $name failed ($LASTEXITCODE)" -Encoding UTF8; exit $LASTEXITCODE }
  Add-Content $log "[$(Get-Date -Format s)] < $name ok" -Encoding UTF8
}

if (-not (BoardMeetingsDone)) { Step 'board meetings' @('-m', 'ml.news_history', 'collect', '--data-dir', 'data/pulse-wide', '--only', 'board-meetings') }
if (-not (DevDone 'risk')) { Step 'risk development' @('-m', 'ml.wide', 'dev', 'risk') -model }
if (-not (DevDone 'rank')) { Step 'ranking development' @('-m', 'ml.wide', 'dev', 'rank') -model }
if (-not (Test-Path (Join-Path $reports 'wide-final.json'))) { Step 'final holdout evaluation' @('-m', 'ml.wide', 'final') -model }
Add-Content $log "[$(Get-Date -Format s)] wide study finished" -Encoding UTF8

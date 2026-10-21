# Wide-universe study (ml/WIDE_PROTOCOL.md), after `node scripts/pulse-wide.js collect`:
# NSE board meetings (results calendar), then ranking and risk training on data/pulse-wide,
# then the pre-registered gates. Runs at below-normal priority; logs go to data/pulse-wide/run.log.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$py = Join-Path $root '.venv-pulse\Scripts\python.exe'
$log = Join-Path $root 'data\pulse-wide\run.log'
(Get-Process -Id $PID).PriorityClass = 'BelowNormal'

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

function Step($name, [string[]]$arguments) {
  if ($name -like '*train*' -or $name -eq 'gates') { WaitForNightlyJob }
  Add-Content $log "[$(Get-Date -Format s)] > $name"
  & $py @arguments *>> $log
  if ($LASTEXITCODE -ne 0) { Add-Content $log "[$(Get-Date -Format s)] < $name failed ($LASTEXITCODE)"; exit $LASTEXITCODE }
  Add-Content $log "[$(Get-Date -Format s)] < $name ok"
}

if (-not (BoardMeetingsDone)) { Step 'board meetings' @('-m', 'ml.news_history', 'collect', '--data-dir', 'data/pulse-wide', '--only', 'board-meetings') }
Step 'rank train' @('-m', 'ml.rank', 'train', '--data-dir', 'data/pulse-wide')
Step 'risk train' @('-m', 'ml.risk', 'train', '--data-dir', 'data/pulse-wide')
Step 'gates' @('-m', 'ml.wide_compare', '--core', 'data/pulse', '--wide', 'data/pulse-wide')
Add-Content $log "[$(Get-Date -Format s)] wide study finished"

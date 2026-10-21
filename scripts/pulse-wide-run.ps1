# Wide-universe study (ml/WIDE_PROTOCOL.md), after `node scripts/pulse-wide.js collect`:
# NSE board meetings (results calendar), then ranking and risk training on data/pulse-wide,
# then the pre-registered gates. Runs at below-normal priority; logs go to data/pulse-wide/run.log.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$py = Join-Path $root '.venv-pulse\Scripts\python.exe'
$log = Join-Path $root 'data\pulse-wide\run.log'
(Get-Process -Id $PID).PriorityClass = 'BelowNormal'

# v4's nightly job (22:00, Mon-Fri) has priority: training waits for it rather than competing for memory.
function WaitForNightlyJob {
  while ($true) {
    $t = (Get-Date).TimeOfDay
    $window = $t -ge [TimeSpan]'21:50' -and $t -le [TimeSpan]'22:40'
    $running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'pulse-daily' }
    if (-not $window -and -not $running) { return }
    Start-Sleep -Seconds 60
  }
}

function Step($name, [string[]]$arguments) {
  if ($name -like '*train*' -or $name -eq 'gates') { WaitForNightlyJob }
  Add-Content $log "[$(Get-Date -Format s)] > $name"
  & $py @arguments *>> $log
  if ($LASTEXITCODE -ne 0) { Add-Content $log "[$(Get-Date -Format s)] < $name failed ($LASTEXITCODE)"; exit $LASTEXITCODE }
  Add-Content $log "[$(Get-Date -Format s)] < $name ok"
}

Step 'board meetings' @('-m', 'ml.news_history', 'collect', '--data-dir', 'data/pulse-wide', '--only', 'board-meetings')
Step 'rank train' @('-m', 'ml.rank', 'train', '--data-dir', 'data/pulse-wide')
Step 'risk train' @('-m', 'ml.risk', 'train', '--data-dir', 'data/pulse-wide')
Step 'gates' @('-m', 'ml.wide_compare', '--core', 'data/pulse', '--wide', 'data/pulse-wide')
Add-Content $log "[$(Get-Date -Format s)] wide study finished"

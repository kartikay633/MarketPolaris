# Wide-universe study (ml/WIDE_PROTOCOL.md), after `node scripts/pulse-wide.js collect`:
# NSE board meetings (results calendar), then ranking and risk training on data/pulse-wide,
# then the pre-registered gates. Runs at below-normal priority; logs go to data/pulse-wide/run.log.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$py = Join-Path $root '.venv-pulse\Scripts\python.exe'
$log = Join-Path $root 'data\pulse-wide\run.log'
(Get-Process -Id $PID).PriorityClass = 'BelowNormal'

function Step($name, [string[]]$arguments) {
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

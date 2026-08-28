param(
  [string]$ProjectRoot = "C:\Users\USER\Documents\RiftBound_Online",
  [string]$DataRoot = "C:\Users\USER\Documents\RiftBound_Online_training_29655896329\data\ai"
)

$ErrorActionPreference = "Stop"
$monitorRoot = Join-Path $DataRoot "monitor"
$statePath = Join-Path $monitorRoot "hourly-state.json"
$historyPath = Join-Path $monitorRoot "hourly-history.jsonl"
$alertPath = Join-Path $monitorRoot "needs-repair.json"
New-Item -ItemType Directory -Path $monitorRoot -Force | Out-Null

function Read-JsonFile([string]$Path) {
  try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json }
  catch { return $null }
}

function Write-JsonAtomic([string]$Path, $Value) {
  $temporary = "$Path.tmp-$PID-$([DateTime]::UtcNow.Ticks)"
  $Value | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $temporary -Encoding utf8
  $delays = @(10, 25, 50, 100, 200, 400, 800)
  for ($attempt = 0; ; $attempt += 1) {
    try {
      Move-Item -LiteralPath $temporary -Destination $Path -Force
      return
    } catch {
      if ($attempt -ge $delays.Count) {
        Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
        throw
      }
      Start-Sleep -Milliseconds $delays[$attempt]
    }
  }
}

function Get-TrainingProcesses {
  @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match '^node' -and $_.CommandLine -match 'train-neural-ai|ai-selfplay-worker-process'
  })
}

$now = Get-Date
$status = Read-JsonFile (Join-Path $DataRoot "status.json")
$progress = Read-JsonFile (Join-Path $DataRoot "progress\latest.json")
$previous = Read-JsonFile $statePath
$processes = Get-TrainingProcesses
$parent = @($processes | Where-Object { $_.CommandLine -match 'train-neural-ai' }) | Select-Object -First 1
$workerProcesses = @($processes | Where-Object { $_.CommandLine -match 'ai-selfplay-worker-process' })
$totalWorkerCpu = 0.0
foreach ($worker in $workerProcesses) {
  $process = Get-Process -Id $worker.ProcessId -ErrorAction SilentlyContinue
  if ($process) { $totalWorkerCpu += [double]$process.CPU }
}

$completed = if ($null -ne $progress.completedGames) { [int]$progress.completedGames } elseif ($null -ne $status.completedGames) { [int]$status.completedGames } else { 0 }
$target = if ($null -ne $progress.targetGames) { [int]$progress.targetGames } elseif ($null -ne $status.games) { [int]$status.games } else { 0 }
$progressUpdatedAt = if ($progress.updatedAt) { [datetime]$progress.updatedAt } elseif ($status.updatedAt) { [datetime]$status.updatedAt } else { $now }
$heartbeatAgeMinutes = [math]::Round(($now - $progressUpdatedAt).TotalMinutes, 1)
$cpuAdvanced = $null -eq $previous -or $totalWorkerCpu -ge ([double]$previous.totalWorkerCpuSeconds + 30)
$gamesAdvanced = $null -eq $previous -or $completed -gt [int]$previous.completedGames
$terminal = $status.state -in @("idle", "complete") -and $completed -ge $target
$errored = $status.state -eq "error"
$missingParent = -not $terminal -and -not $parent
$stalled = -not $terminal -and $parent -and $heartbeatAgeMinutes -ge 90 -and -not $cpuAdvanced -and -not $gamesAdvanced

$latestFailure = Get-ChildItem -LiteralPath (Join-Path $DataRoot "failures") -File -Filter "generation-*.json" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
$failure = if ($latestFailure) { Read-JsonFile $latestFailure.FullName } else { $null }
$failureSignature = if ($failure) {
  $raw = "{0}|{1}|{2}" -f $failure.error.name, $failure.error.message, $failure.error.stack
  $bytes = [Text.Encoding]::UTF8.GetBytes($raw)
  ([Security.Cryptography.SHA256]::Create().ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join ''
} else { $null }

$sameFailureAttempts = if ($failureSignature -and $previous.failureSignature -eq $failureSignature) { [int]$previous.sameFailureAttempts } else { 0 }
$restarted = $false
$needsRepair = $false
$restartReason = $null
if ($errored -or $stalled) {
  $restartReason = if ($errored) { "error" } elseif ($missingParent) { "missing-parent" } else { "stalled" }
  # Engine exceptions and genuine stalls require diagnosis and a tested code
  # fix. Restarting the same deterministic workload would only repeat them.
  $needsRepair = $true
} elseif ($missingParent) {
  $restartReason = "missing-parent"
  if ($sameFailureAttempts -lt 1) {
    foreach ($process in $processes) {
      try { Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop } catch {}
    }
    $node = (Get-Command node -ErrorAction Stop).Source
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $outLog = Join-Path $DataRoot "logs\training-watchdog-$stamp.out.log"
    $errLog = Join-Path $DataRoot "logs\training-watchdog-$stamp.err.log"
    $arguments = @(
      "scripts/train-neural-ai.mjs",
      "--data-dir", ('"' + $DataRoot + '"'),
      "--generations", "1", "--games", "160", "--workers", "4", "--processes", "8",
      "--max-actions", "1200", "--seed", "20260719", "--evolve-decks", "false",
      "--epochs", "8", "--learning-rate", "0.00015",
      "--early-stopping-patience", "2", "--minimum-score-improvement", "0.001",
      "--epoch-evaluation-games", "20", "--epoch-evaluation-max-actions", "800"
    )
    Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $ProjectRoot `
      -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden | Out-Null
    $sameFailureAttempts += 1
    $restarted = $true
  } else { $needsRepair = $true }
}

$snapshot = [ordered]@{
  checkedAt = $now.ToString("o")
  state = $status.state
  completedGames = $completed
  targetGames = $target
  progressUpdatedAt = $progressUpdatedAt.ToString("o")
  heartbeatAgeMinutes = $heartbeatAgeMinutes
  parentRunning = [bool]$parent
  workerCount = $workerProcesses.Count
  totalWorkerCpuSeconds = [math]::Round($totalWorkerCpu, 1)
  gamesAdvanced = $gamesAdvanced
  cpuAdvanced = $cpuAdvanced
  errored = $errored
  stalled = $stalled
  restarted = $restarted
  restartReason = $restartReason
  failurePath = $latestFailure.FullName
  failureSignature = $failureSignature
  sameFailureAttempts = $sameFailureAttempts
  needsRepair = $needsRepair
}
Write-JsonAtomic $statePath $snapshot
($snapshot | ConvertTo-Json -Compress -Depth 16) | Add-Content -LiteralPath $historyPath -Encoding utf8
if ($needsRepair) { Write-JsonAtomic $alertPath $snapshot }
elseif (Test-Path -LiteralPath $alertPath) { Remove-Item -LiteralPath $alertPath -Force }

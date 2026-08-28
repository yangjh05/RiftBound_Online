param(
    [Parameter(Mandatory = $true)]
    [int]$TrainingProcessId,

    [Parameter(Mandatory = $true)]
    [string]$RepositoryRoot,

    [Parameter(Mandatory = $true)]
    [string]$DataDirectory,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedEngineFingerprint,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedBootstrapDatasetKey,

    [switch]$AllowLegacyStopCorrelation,

    [string]$ExpectedLegacyStopRequestedAt,

    [switch]$PreflightOnly,

    [string]$CompatibleEvaluatorBootstrapKey,

    [string]$CompatibleCollectionFingerprint,

    [string]$CompatibleCollectionKey,

    [string]$CompatibleRuntimeFingerprint,

    [string]$CompatibleEvaluatorRuntimeFingerprint,

    [ValidateRange(1, 32)]
    [int]$Processes = 12,

    [ValidateRange(1, 32)]
    [int]$EvaluatorActionAuditProcesses = 16,

    [ValidateRange(1, 4)]
    [int]$EvaluatorCandidateProcesses = 4,

    [ValidateRange(2147483648, 17179869184)]
    [long]$EvaluatorCandidateMemoryReserveBytes = 4294967296,

    [ValidateRange(1073741824, 8589934592)]
    [long]$EvaluatorCandidateEstimatedMemoryBytes = 1879048192,

    [ValidateRange(4096, 16384)]
    [int]$ParentNodeHeapMb = 8192,

    [string]$ActionEvidenceProtocol,

    [ValidateRange(10, 120)]
    [int]$HealthVerificationMinutes = 60,

    [string]$EvaluatorBootstrapMigrationRolePolicy =
        "observed-holdouts-to-training-development-v1"
)

$ErrorActionPreference = "Stop"

$repositoryPath = [System.IO.Path]::GetFullPath($RepositoryRoot)
$dataPath = [System.IO.Path]::GetFullPath(
    [System.IO.Path]::Combine($repositoryPath, $DataDirectory)
)
$statusPath = [System.IO.Path]::Combine($dataPath, "status.json")
$progressPath = [System.IO.Path]::Combine(
    $dataPath,
    "progress",
    "latest.json"
)
$stopRequestPath = [System.IO.Path]::Combine(
    $dataPath,
    "stop-after-current-games.request.json"
)
$monitorPath = [System.IO.Path]::Combine($dataPath, "monitor")
$handoffLogPath = [System.IO.Path]::Combine(
    $monitorPath,
    "safe-restart-handoff.log"
)
$lockPath = [System.IO.Path]::Combine(
    $monitorPath,
    "safe-restart-handoff.lock"
)

New-Item -ItemType Directory -Path $monitorPath -Force | Out-Null

function Write-HandoffLog {
    param([string]$Message)

    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -LiteralPath $handoffLogPath -Value $line -Encoding UTF8
}

try {
    $lockStream = [System.IO.File]::Open(
        $lockPath,
        [System.IO.FileMode]::OpenOrCreate,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
    )
} catch {
    Write-HandoffLog "Another safe-restart handoff owns the exclusive lock."
    exit 10
}

$handoffId = [guid]::NewGuid().ToString("D")
$lockStream.SetLength(0)
$lockWriter = New-Object System.IO.StreamWriter(
    $lockStream,
    [System.Text.UTF8Encoding]::new($false),
    1024,
    $true
)
$lockWriter.Write(
    (@{
        handoffId = $handoffId
        processId = $PID
        targetProcessId = $TrainingProcessId
        dataPath = $dataPath
        acquiredAt = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json -Compress)
)
$lockWriter.Flush()
$lockStream.Flush()

function Get-TrainingProcess {
    Get-CimInstance Win32_Process -Filter "ProcessId = $TrainingProcessId" `
        -ErrorAction SilentlyContinue
}

function Read-JsonFile {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }
    try {
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Normalize-DataPath {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $null
    }
    $candidate = $Value.Trim().Trim('"')
    if (-not [System.IO.Path]::IsPathRooted($candidate)) {
        $candidate = [System.IO.Path]::Combine($repositoryPath, $candidate)
    }
    return [System.IO.Path]::GetFullPath($candidate).
        TrimEnd(
            [System.IO.Path]::DirectorySeparatorChar,
            [System.IO.Path]::AltDirectorySeparatorChar
        ).
        ToUpperInvariant()
}

function Get-ProcessDataPath {
    param([string]$CommandLine)

    $match = [regex]::Match(
        [string]$CommandLine,
        '(?:^|\s)--data-dir(?:=|\s+)(?:"(?<quoted>[^"]+)"|(?<plain>\S+))',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    if (-not $match.Success) {
        return $null
    }
    $value = if ($match.Groups["quoted"].Success) {
        $match.Groups["quoted"].Value
    } else {
        $match.Groups["plain"].Value
    }
    return Normalize-DataPath $value
}

function Get-MatchingRunProcess {
    $expectedDataPath = Normalize-DataPath $dataPath
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -match "^node(\.exe)?$" -and
            $_.CommandLine -match "scripts[\\/]train-neural-ai\.mjs" -and
            (Get-ProcessDataPath $_.CommandLine) -eq $expectedDataPath
        }
}

function Get-DescendantProcessIds {
    param([int]$RootProcessId)

    $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $pending = [System.Collections.Generic.Queue[int]]::new()
    $seen = [System.Collections.Generic.HashSet[int]]::new()
    $pending.Enqueue($RootProcessId)
    while ($pending.Count -gt 0) {
        $parentId = $pending.Dequeue()
        foreach ($process in $processes | Where-Object {
            [int]$_.ParentProcessId -eq $parentId
        }) {
            $childId = [int]$process.ProcessId
            if ($seen.Add($childId)) {
                $pending.Enqueue($childId)
            }
        }
    }
    return @($seen)
}

function Get-EngineFingerprint {
    $program = @"
import { computeEngineFingerprint } from './scripts/training-safety.mjs';
console.log(computeEngineFingerprint());
"@
    Push-Location $repositoryPath
    try {
        $value = (& $nodePath --input-type=module -e $program).Trim()
        if ($LASTEXITCODE -ne 0) {
            throw "Engine fingerprint process exited with code $LASTEXITCODE."
        }
        return $value
    } finally {
        Pop-Location
    }
}

function Get-PipelineCodeHash {
    $relativePaths = @(
        "scripts/train-neural-ai.mjs",
        "scripts/evaluator-bootstrap.mjs",
        "scripts/evaluator-bootstrap-stage-handoff.mjs",
        "scripts/evaluator-bootstrap-stage-process.mjs",
        "scripts/evaluator-bootstrap-index.mjs",
        "scripts/evaluator-early-diagnostic.mjs",
        "scripts/evaluator-bootstrap-restart-preflight.mjs",
        "scripts/migrate-compatible-evaluator-bootstrap.mjs",
        "scripts/detached-action-audit-coordinator.mjs",
        "scripts/ai-action-audit-worker-process.mjs",
        "scripts/ai-selfplay-process-pool.mjs",
        "scripts/ai-selfplay-worker-process.mjs",
        "scripts/ai-selfplay-result-handoff.mjs",
        "scripts/action-audit-rescue.mjs",
        "src/ai/rollout.mjs",
        "src/ai/neural/model.mjs",
        "src/ai/neural/trainer.mjs",
        "src/ai/neural/evaluator-architecture.mjs",
        "src/ai/neural/structured-evidence.mjs",
        "src/ai/neural/action-ranking-reference.mjs",
        "src/ai/neural/evaluator-certification.mjs"
    )
    $manifest = foreach ($relativePath in $relativePaths) {
        $absolutePath = [System.IO.Path]::Combine(
            $repositoryPath,
            $relativePath
        )
        if (-not (Test-Path -LiteralPath $absolutePath)) {
            throw "Pipeline file is missing: $relativePath"
        }
        $fileHash = (Get-FileHash -LiteralPath $absolutePath -Algorithm SHA256).
            Hash.ToLowerInvariant()
        "$relativePath`0$fileHash"
    }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes(
            [string]::Join("`n", $manifest)
        )
        return (
            [System.BitConverter]::ToString($sha.ComputeHash($bytes)).
                Replace("-", "").
                ToLowerInvariant()
        )
    } finally {
        $sha.Dispose()
    }
}

function Get-EvaluatorBootstrapRestartPreflight {
    param(
        [string]$SourceDatasetKey,
        [string]$TargetEngineFingerprint,
        [int]$ParentProcessId
    )

    $scriptPath = [System.IO.Path]::Combine(
        $repositoryPath,
        "scripts",
        "evaluator-bootstrap-restart-preflight.mjs"
    )
    $output = & $nodePath $scriptPath `
        --data-dir $dataPath `
        --source-dataset-key $SourceDatasetKey `
        --target-engine-fingerprint $TargetEngineFingerprint `
        --parent-process-id ([string]$ParentProcessId)
    if ($LASTEXITCODE -ne 0) {
        throw "Evaluator bootstrap restart preflight failed."
    }
    return (($output -join "`n") | ConvertFrom-Json)
}

function Get-CompatibleCollectionRestartPreflight {
    param(
        [int]$Generation,
        [string]$TargetEngineFingerprint,
        [string]$VerifiedSourceFingerprint
    )

    $scriptPath = [System.IO.Path]::Combine(
        $repositoryPath,
        "scripts",
        "compatible-collection-restart-preflight.mjs"
    )
    $preflightArguments = @(
        $scriptPath,
        "--data-dir", $dataPath,
        "--generation", [string]$Generation,
        "--target-engine-fingerprint", $TargetEngineFingerprint
    )
    if (-not [string]::IsNullOrWhiteSpace($VerifiedSourceFingerprint)) {
        $preflightArguments += @(
            "--verified-source-fingerprint",
            $VerifiedSourceFingerprint
        )
    }
    $output = & $nodePath $preflightArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Compatible collection restart preflight failed."
    }
    return (($output -join "`n") | ConvertFrom-Json)
}

function Stop-NewProcessForContractViolation {
    param(
        [System.Diagnostics.Process]$Process,
        [string]$Reason
    )

    Write-HandoffLog $Reason
    if ($Process -and -not $Process.HasExited) {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    }
    exit 11
}

$trainingProcess = Get-TrainingProcess
if (-not $trainingProcess) {
    Write-HandoffLog "Target training process already exited; no handoff was started."
    exit 0
}

$targetDataPath = Get-ProcessDataPath $trainingProcess.CommandLine
if ($targetDataPath -ne (Normalize-DataPath $dataPath)) {
    Write-HandoffLog "Target process data directory does not match the requested run."
    exit 3
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
$initialFingerprint = Get-EngineFingerprint
if ($initialFingerprint -ne $ExpectedEngineFingerprint) {
    Write-HandoffLog (
        "Engine fingerprint mismatch before stop: expected={0}, actual={1}" -f
        $ExpectedEngineFingerprint,
        $initialFingerprint
    )
    exit 3
}
$initialPipelineCodeHash = Get-PipelineCodeHash
$preProgress = Read-JsonFile $progressPath
$preRunId = [string]$preProgress.runId
$minimumAcceptedGames = [int]$preProgress.acceptedGames
$preActionEvidenceProtocol =
    [string]$preProgress.actionEvidenceProtocol.contract
$preActionEvidenceProtocolHash =
    [string]$preProgress.actionEvidenceProtocol.protocolHash
if ([string]::IsNullOrWhiteSpace($ActionEvidenceProtocol)) {
    $ActionEvidenceProtocol = if (
        [string]::IsNullOrWhiteSpace($preActionEvidenceProtocol)
    ) {
        "legacy-compatible"
    } else {
        $preActionEvidenceProtocol
    }
}
$validActionEvidenceProtocols = @(
    "legacy-compatible",
    "precommitted-continuation-action-evidence-v1"
)
if ($validActionEvidenceProtocols -notcontains $ActionEvidenceProtocol) {
    throw "Unknown action-evidence protocol: $ActionEvidenceProtocol"
}
if (-not [string]::IsNullOrWhiteSpace($preActionEvidenceProtocol) -and
    $ActionEvidenceProtocol -ne $preActionEvidenceProtocol) {
    throw (
        "A safe handoff cannot silently change the action-evidence protocol. " +
        "Use a separately preflighted migration for that transition."
    )
}
$collectionRestartPreflight = Get-CompatibleCollectionRestartPreflight `
    -Generation ([int]$preProgress.generation) `
    -TargetEngineFingerprint $initialFingerprint `
    -VerifiedSourceFingerprint $CompatibleRuntimeFingerprint
$explicitCollectionCompatibility =
    -not [string]::IsNullOrWhiteSpace($CompatibleCollectionFingerprint) -or
    -not [string]::IsNullOrWhiteSpace($CompatibleCollectionKey)
if ($explicitCollectionCompatibility) {
    if ([string]::IsNullOrWhiteSpace($CompatibleCollectionFingerprint) -or
        [string]::IsNullOrWhiteSpace($CompatibleCollectionKey)) {
        Write-HandoffLog (
            "Compatible PPO collection migration requires both source fingerprint and collection key."
        )
        exit 3
    }
    if ($collectionRestartPreflight.sourceExists -ne $true) {
        Write-HandoffLog (
            "Compatible PPO collection source does not exist. " +
            "Refusing to stop and silently recollect 160 games."
        )
        exit 3
    }
    $actualCollectionFingerprint =
        [string]$collectionRestartPreflight.sourceEngineFingerprint
    $actualCollectionKey =
        [string]$collectionRestartPreflight.sourceCollectionKey
    if ($CompatibleCollectionFingerprint -ne $actualCollectionFingerprint -or
        $CompatibleCollectionKey -ne $actualCollectionKey) {
        Write-HandoffLog (
            "Compatible PPO collection source mismatch. " +
            "expectedKey={0}, suppliedKey={1}, " +
            "expectedFingerprint={2}, suppliedFingerprint={3}" -f
            $actualCollectionKey,
            $CompatibleCollectionKey,
            $actualCollectionFingerprint,
            $CompatibleCollectionFingerprint
        )
        exit 3
    }
    if ($collectionRestartPreflight.compatible -ne $true) {
        Write-HandoffLog (
            "Existing PPO collection compatibility was not verified: {0}. " +
            "Refusing to stop and silently recollect 160 games." -f
            [string]$collectionRestartPreflight.reason
        )
        exit 3
    }
} elseif ($collectionRestartPreflight.sourceExists -eq $true) {
    if ($collectionRestartPreflight.compatible -ne $true) {
        Write-HandoffLog (
            "Existing PPO collection cannot be safely reused: {0}. " +
            "Refusing to stop and silently recollect 160 games." -f
            [string]$collectionRestartPreflight.reason
        )
        exit 3
    }
    $CompatibleCollectionFingerprint =
        [string]$collectionRestartPreflight.sourceEngineFingerprint
    $CompatibleCollectionKey =
        [string]$collectionRestartPreflight.sourceCollectionKey
    Write-HandoffLog (
        "Automatically bound compatible PPO collection. key={0}, fingerprint={1}, proof={2}" -f
        $CompatibleCollectionKey,
        $CompatibleCollectionFingerprint,
        [string]$collectionRestartPreflight.reason
    )
}
$restartPreflight = Get-EvaluatorBootstrapRestartPreflight `
    -SourceDatasetKey $ExpectedBootstrapDatasetKey `
    -TargetEngineFingerprint $initialFingerprint `
    -ParentProcessId $TrainingProcessId
if ([int]$restartPreflight.sourceCommittedGames -lt $minimumAcceptedGames) {
    Write-HandoffLog (
        "Evaluator source has fewer committed games than progress: committed={0}, progress={1}" -f
        [int]$restartPreflight.sourceCommittedGames,
        $minimumAcceptedGames
    )
    exit 3
}
$expectedLaunchBootstrapDatasetKey =
    [string]$restartPreflight.targetDatasetKey
$migrationRequired = $restartPreflight.migrationRequired -eq $true
if ($migrationRequired) {
    $sourceFingerprint = [string]$restartPreflight.sourceEngineFingerprint
    if ([string]::IsNullOrWhiteSpace($CompatibleEvaluatorBootstrapKey)) {
        $CompatibleEvaluatorBootstrapKey = $ExpectedBootstrapDatasetKey
    }
    if ([string]::IsNullOrWhiteSpace(
        $CompatibleEvaluatorRuntimeFingerprint
    )) {
        $CompatibleEvaluatorRuntimeFingerprint = $sourceFingerprint
    }
    if ($CompatibleEvaluatorBootstrapKey -ne $ExpectedBootstrapDatasetKey -or
        $CompatibleEvaluatorRuntimeFingerprint -ne $sourceFingerprint) {
        Write-HandoffLog (
            "Evaluator migration source mismatch. expectedKey={0}, suppliedKey={1}, expectedFingerprint={2}, suppliedFingerprint={3}" -f
            $ExpectedBootstrapDatasetKey,
            $CompatibleEvaluatorBootstrapKey,
            $sourceFingerprint,
            $CompatibleEvaluatorRuntimeFingerprint
        )
        exit 3
    }
    if ($restartPreflight.targetStateExists -eq $true) {
        $targetMigration = $restartPreflight.targetCompatibilityMigration
        $validExistingTarget = $targetMigration -and
            [string]$targetMigration.fromDatasetKey -eq
                $ExpectedBootstrapDatasetKey -and
            [string]$targetMigration.fromEngineFingerprint -eq
                $sourceFingerprint -and
            [string]$targetMigration.toEngineFingerprint -eq
                $initialFingerprint -and
            [string]$targetMigration.holdoutRolePolicy -eq
                $EvaluatorBootstrapMigrationRolePolicy -and
            [int]$targetMigration.migratedGames -ge $minimumAcceptedGames
        if (-not $validExistingTarget) {
            Write-HandoffLog (
                "Target evaluator dataset already exists without a complete verified migration: {0}" -f
                $expectedLaunchBootstrapDatasetKey
            )
            exit 3
        }
    }
}
Write-HandoffLog (
    "Restart preflight passed. sourceKey={0}, sourceFingerprint={1}, targetKey={2}, targetFingerprint={3}, committedGames={4}, migrationRequired={5}" -f
    $ExpectedBootstrapDatasetKey,
    [string]$restartPreflight.sourceEngineFingerprint,
    $expectedLaunchBootstrapDatasetKey,
    $initialFingerprint,
    [int]$restartPreflight.sourceCommittedGames,
    $migrationRequired
)
if ($PreflightOnly) {
    [ordered]@{
        safeToStop = $true
        sourceDatasetKey = $ExpectedBootstrapDatasetKey
        sourceEngineFingerprint =
            [string]$restartPreflight.sourceEngineFingerprint
        sourceCommittedGames =
            [int]$restartPreflight.sourceCommittedGames
        targetDatasetKey = $expectedLaunchBootstrapDatasetKey
        targetEngineFingerprint = $initialFingerprint
        migrationRequired = $migrationRequired
        compatibleEvaluatorBootstrapKey =
            $CompatibleEvaluatorBootstrapKey
        compatibleEvaluatorRuntimeFingerprint =
            $CompatibleEvaluatorRuntimeFingerprint
        compatibleCollectionFingerprint = $CompatibleCollectionFingerprint
        compatibleCollectionKey = $CompatibleCollectionKey
        compatibleCollectionProof =
            [string]$collectionRestartPreflight.reason
        pipelineCodeHash = $initialPipelineCodeHash
    } | ConvertTo-Json
    exit 0
}
$ownedChildProcessIds = @(Get-DescendantProcessIds $TrainingProcessId)

$request = Read-JsonFile $stopRequestPath
if (-not $request) {
    $request = [ordered]@{
        handoffId = $handoffId
        requestedAt = (Get-Date).ToUniversalTime().ToString("o")
        reason = "reload-action-audit-yield-improvements"
        requestedBy = "restart-run-c-after-safe-stop.ps1"
        targetProcessId = $TrainingProcessId
        expectedEngineFingerprint = $ExpectedEngineFingerprint
        expectedBootstrapDatasetKey = $ExpectedBootstrapDatasetKey
        pipelineCodeHash = $initialPipelineCodeHash
    }
    $request |
        ConvertTo-Json |
        Set-Content -LiteralPath $stopRequestPath -Encoding UTF8
    Write-HandoffLog (
        "Requested a game-boundary stop. handoffId={0}, targetPid={1}" -f
        $handoffId,
        $TrainingProcessId
    )
} elseif (-not $AllowLegacyStopCorrelation) {
    Write-HandoffLog "A stop request already exists and cannot be correlated to this handoff."
    exit 3
} else {
    if (-not [string]::IsNullOrWhiteSpace([string]$request.handoffId)) {
        $handoffId = [string]$request.handoffId
    }
    Write-HandoffLog (
        "Adopting the explicitly approved legacy stop request. targetPid={0}, handoffId={1}" -f
        $TrainingProcessId,
        $handoffId
    )
}

while (Get-TrainingProcess) {
    Start-Sleep -Seconds 15
}
Write-HandoffLog "The original training parent exited."

$childDrainDeadline = (Get-Date).AddMinutes(3)
do {
    $remainingOwnedChildren = @(
        $ownedChildProcessIds | Where-Object {
            Get-Process -Id $_ -ErrorAction SilentlyContinue
        }
    )
    if ($remainingOwnedChildren.Count -eq 0) {
        break
    }
    Start-Sleep -Seconds 5
} while ((Get-Date) -lt $childDrainDeadline)
if ($remainingOwnedChildren.Count -gt 0) {
    Write-HandoffLog (
        "Old evaluator process tree did not drain; restart was not launched. PIDs={0}" -f
        ($remainingOwnedChildren -join ",")
    )
    exit 3
}

$deadline = (Get-Date).AddMinutes(3)
$status = $null
do {
    $status = Read-JsonFile $statusPath
    if ($status -and
        $status.state -eq "interrupted" -and
        $status.resumable -eq $true) {
        break
    }
    Start-Sleep -Seconds 5
} while ((Get-Date) -lt $deadline)

if (-not $status -or
    $status.state -ne "interrupted" -or
    $status.resumable -ne $true) {
    $state = if ($status) { [string]$status.state } else { "unreadable" }
    Write-HandoffLog "No resumable interrupted state was observed. state=$state"
    exit 2
}

$correlated = [string]$status.stopHandoffId -eq $handoffId
if (-not $correlated -and $AllowLegacyStopCorrelation) {
    $correlated =
        -not [string]::IsNullOrWhiteSpace($ExpectedLegacyStopRequestedAt) -and
        [string]$status.stopRequestedAt -eq $ExpectedLegacyStopRequestedAt
}
if (-not $correlated) {
    Write-HandoffLog (
        "Interrupted status is not correlated to this stop request. statusHandoffId={0}" -f
        [string]$status.stopHandoffId
    )
    exit 3
}

$interruptedAcceptedGames = [int]$status.acceptedBootstrapGames
if ($interruptedAcceptedGames -gt 0) {
    if ($interruptedAcceptedGames -lt $minimumAcceptedGames) {
        Write-HandoffLog (
            "Interrupted status lost accepted games: before={0}, interrupted={1}" -f
            $minimumAcceptedGames,
            $interruptedAcceptedGames
        )
        exit 3
    }
    $minimumAcceptedGames = $interruptedAcceptedGames
}

$interruptedBootstrapKey = [string]$status.evaluatorBootstrapDatasetKey
if (-not [string]::IsNullOrWhiteSpace($interruptedBootstrapKey) -and
    $interruptedBootstrapKey -ne $ExpectedBootstrapDatasetKey) {
    Write-HandoffLog (
        "Bootstrap key mismatch: expected={0}, actual={1}" -f
        $ExpectedBootstrapDatasetKey,
        $interruptedBootstrapKey
    )
    exit 3
}
if ([string]::IsNullOrWhiteSpace($interruptedBootstrapKey) -and
    [string]::IsNullOrWhiteSpace($CompatibleEvaluatorBootstrapKey)) {
    Write-HandoffLog (
        "Interrupted before opening a bootstrap dataset and no compatible evaluator source was supplied."
    )
    exit 3
}

$launchFingerprint = Get-EngineFingerprint
$launchPipelineCodeHash = Get-PipelineCodeHash
if ($launchFingerprint -ne $initialFingerprint -or
    $launchPipelineCodeHash -ne $initialPipelineCodeHash) {
    Write-HandoffLog (
        "Code changed while the handoff was waiting. fingerprintChanged={0}, pipelineChanged={1}" -f
        ($launchFingerprint -ne $initialFingerprint),
        ($launchPipelineCodeHash -ne $initialPipelineCodeHash)
    )
    exit 3
}

$remainingStopRequest = Read-JsonFile $stopRequestPath
if ($remainingStopRequest) {
    $sameStopRequest = (
        -not [string]::IsNullOrWhiteSpace([string]$request.handoffId) -and
        [string]$remainingStopRequest.handoffId -eq [string]$request.handoffId
    ) -or (
        -not [string]::IsNullOrWhiteSpace([string]$request.requestedAt) -and
        [string]$remainingStopRequest.requestedAt -eq
            [string]$request.requestedAt
    )
    if (-not $sameStopRequest) {
        Write-HandoffLog (
            "A new uncorrelated stop request appeared before relaunch; restart was not launched."
        )
        exit 3
    }
    Remove-Item -LiteralPath $stopRequestPath -Force
    Write-HandoffLog "Removed the correlated completed stop request before relaunch."
}
if (Test-Path -LiteralPath $stopRequestPath) {
    Write-HandoffLog "Stop request still exists immediately before relaunch."
    exit 3
}

if ($migrationRequired) {
    $launchTargetStatePath = [System.IO.Path]::Combine(
        $dataPath,
        "evaluator-bootstrap",
        $expectedLaunchBootstrapDatasetKey,
        "bootstrap-state.json"
    )
    $launchTargetState = Read-JsonFile $launchTargetStatePath
    if ($launchTargetState) {
        $launchTargetMigration = $launchTargetState.compatibilityMigration
        $validLaunchTarget = $launchTargetMigration -and
            [string]$launchTargetMigration.fromDatasetKey -eq
                $ExpectedBootstrapDatasetKey -and
            [string]$launchTargetMigration.fromEngineFingerprint -eq
                $CompatibleEvaluatorRuntimeFingerprint -and
            [string]$launchTargetMigration.toEngineFingerprint -eq
                $initialFingerprint -and
            [string]$launchTargetMigration.holdoutRolePolicy -eq
                $EvaluatorBootstrapMigrationRolePolicy -and
            [int]$launchTargetMigration.migratedGames -ge
                $minimumAcceptedGames
        if (-not $validLaunchTarget) {
            Write-HandoffLog (
                "Target evaluator migration does not include every game committed at the stop boundary."
            )
            exit 3
        }
    }
}

$duplicate = Get-MatchingRunProcess
if ($duplicate) {
    $duplicateIds = ($duplicate | ForEach-Object ProcessId) -join ","
    Write-HandoffLog "A matching Run C parent already exists. PID=$duplicateIds"
    exit 0
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stdoutPath = [System.IO.Path]::Combine(
    $monitorPath,
    "safe-restart-$timestamp.out.log"
)
$stderrPath = [System.IO.Path]::Combine(
    $monitorPath,
    "safe-restart-$timestamp.err.log"
)
$arguments = @(
    "--max-old-space-size=$ParentNodeHeapMb",
    "--expose-gc",
    "scripts/train-neural-ai.mjs",
    "--run-contract", "C",
    "--data-dir", $DataDirectory,
    "--generations", "1",
    "--games", "160",
    "--workers", "4",
    "--processes", [string]$Processes,
    "--max-actions", "1200",
    "--seed", "20260726",
    "--evolve-decks", "false",
    "--epochs", "8",
    "--learning-rate", "0.00015",
    "--early-stopping-patience", "2",
    "--minimum-epochs-before-early-stopping", "6",
    "--minimum-score-improvement", "0.001",
    "--epoch-evaluation-games", "40",
    "--epoch-evaluation-max-actions", "800",
    "--final-epoch-confirmation-games", "40",
    "--final-epoch-audit-games", "104",
    "--evaluation-games", "40",
    "--evaluation-max-actions", "1200",
    "--evaluator-action-audit-processes", [string]$EvaluatorActionAuditProcesses,
    "--evaluator-candidate-processes", [string]$EvaluatorCandidateProcesses,
    "--evaluator-candidate-memory-reserve-bytes",
        [string]$EvaluatorCandidateMemoryReserveBytes,
    "--evaluator-candidate-estimated-memory-bytes",
        [string]$EvaluatorCandidateEstimatedMemoryBytes,
    "--evaluator-action-evidence-protocol", $ActionEvidenceProtocol,
    "--evaluator-action-audit-detach-after-games", "320",
    "--evaluator-bootstrap-continue-until-complete", "true",
    "--handoff-id", $handoffId
)
if (-not [string]::IsNullOrWhiteSpace($preActionEvidenceProtocolHash)) {
    $arguments += @(
        "--expected-evaluator-action-evidence-protocol-hash",
        $preActionEvidenceProtocolHash
    )
}
if ($CompatibleCollectionFingerprint -or $CompatibleCollectionKey) {
    if (-not $CompatibleCollectionFingerprint -or
        -not $CompatibleCollectionKey) {
        throw (
            "Compatible collection migration requires both the source fingerprint and collection key."
        )
    }
    $arguments += @(
        "--compatible-collection-fingerprint",
        $CompatibleCollectionFingerprint,
        "--compatible-collection-key",
        $CompatibleCollectionKey,
        "--verified-compatible-collection-migration", "true"
    )
}
if ($CompatibleEvaluatorBootstrapKey -or
    $CompatibleEvaluatorRuntimeFingerprint) {
    $evaluatorSourceFingerprint = if (
        $CompatibleEvaluatorRuntimeFingerprint
    ) {
        $CompatibleEvaluatorRuntimeFingerprint
    } else {
        $CompatibleRuntimeFingerprint
    }
    if (-not $CompatibleEvaluatorBootstrapKey -or
        -not $evaluatorSourceFingerprint) {
        throw (
            "Compatible evaluator migration requires both dataset key and evaluator runtime fingerprint."
        )
    }
    $arguments += @(
        "--compatible-evaluator-bootstrap-key",
        $CompatibleEvaluatorBootstrapKey,
        "--compatible-evaluator-runtime-fingerprint",
        $evaluatorSourceFingerprint,
        "--verified-compatible-runtime-migration", "true",
        "--evaluator-bootstrap-migration-role-policy",
        $EvaluatorBootstrapMigrationRolePolicy
    )
}
if ($CompatibleRuntimeFingerprint) {
    $arguments += @(
        "--compatible-runtime-fingerprint",
        $CompatibleRuntimeFingerprint,
        "--verified-compatible-runtime-migration", "true"
    )
}
if ([int]$preProgress.trainingIteration -gt 0) {
    $arguments += @(
        "--retry-iteration",
        [string][int]$preProgress.trainingIteration
    )
}

$newProcess = Start-Process `
    -FilePath $nodePath `
    -ArgumentList $arguments `
    -WorkingDirectory $repositoryPath `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru

Write-HandoffLog (
    "Started the resumed Run C. PID={0}, pipelineHash={1}" -f
    $newProcess.Id,
    $initialPipelineCodeHash
)

$healthDeadline = (Get-Date).AddMinutes($HealthVerificationMinutes)
$heartbeatUpdates = [System.Collections.Generic.HashSet[string]]::new()
$healthConfirmed = $false
function Test-LiveBootstrapContract {
    param([string]$DatasetKey)

    if ([string]::IsNullOrWhiteSpace($DatasetKey) -or
        $DatasetKey -ne $expectedLaunchBootstrapDatasetKey) {
        return $false
    }
    if (-not $migrationRequired) {
        return $true
    }
    $migratedStatePath = [System.IO.Path]::Combine(
        $dataPath,
        "evaluator-bootstrap",
        $DatasetKey,
        "bootstrap-state.json"
    )
    $migratedState = Read-JsonFile $migratedStatePath
    return $migratedState -and
        [string]$migratedState.compatibilityMigration.fromDatasetKey -eq
            $CompatibleEvaluatorBootstrapKey -and
        [string]$migratedState.compatibilityMigration.fromEngineFingerprint -eq
            $CompatibleEvaluatorRuntimeFingerprint -and
        [string]$migratedState.compatibilityMigration.toEngineFingerprint -eq
            $initialFingerprint -and
        [string]$migratedState.compatibilityMigration.holdoutRolePolicy -eq
            $EvaluatorBootstrapMigrationRolePolicy -and
        [int]$migratedState.compatibilityMigration.migratedGames -ge
            $minimumAcceptedGames
}
function Test-LiveCollectionContract {
    $generationDirectory = "generation-{0:D5}" -f
        [int]$preProgress.generation
    $manifestPath = [System.IO.Path]::Combine(
        $dataPath,
        "resume",
        $generationDirectory,
        "manifest.json"
    )
    $manifest = Read-JsonFile $manifestPath
    if (-not $manifest -or
        [string]$manifest.engineFingerprint -ne $initialFingerprint) {
        return $false
    }
    if ([string]::IsNullOrWhiteSpace($CompatibleCollectionFingerprint)) {
        return $true
    }
    if ([string]$CompatibleCollectionFingerprint -eq $initialFingerprint -and
        [string]$manifest.collectionKey -eq $CompatibleCollectionKey) {
        return $true
    }
    return $manifest.compatibilityMigration -and
        [string]$manifest.compatibilityMigration.fromCollectionKey -eq
            $CompatibleCollectionKey -and
        [string]$manifest.compatibilityMigration.toCollectionKey -eq
            [string]$manifest.collectionKey -and
        [string]$manifest.compatibilityMigration.fromEngineFingerprint -eq
            $CompatibleCollectionFingerprint -and
        [string]$manifest.compatibilityMigration.toEngineFingerprint -eq
            $initialFingerprint
}
while ((Get-Date) -lt $healthDeadline) {
    Start-Sleep -Seconds 10
    $newProcess.Refresh()
    if ($newProcess.HasExited) {
        Write-HandoffLog (
            "Resumed Run C exited during health verification. exitCode={0}, stderr={1}" -f
            $newProcess.ExitCode,
            $stderrPath
        )
        exit 4
    }
    $liveStatus = Read-JsonFile $statusPath
    if ($liveStatus -and $liveStatus.state -eq "error") {
        Stop-NewProcessForContractViolation `
            -Process $newProcess `
            -Reason "Resumed Run C entered an error state."
    }
    $liveProgress = Read-JsonFile $progressPath
    if (-not $liveProgress -or
        [string]$liveProgress.runId -eq $preRunId) {
        continue
    }
    $liveBootstrapKey = [string]$liveProgress.evaluatorBootstrapDatasetKey
    $liveActionEvidenceProtocol =
        [string]$liveProgress.actionEvidenceProtocol.contract
    $liveActionEvidenceProtocolHash =
        [string]$liveProgress.actionEvidenceProtocol.protocolHash
    $protocolObservable =
        -not [string]::IsNullOrWhiteSpace($liveActionEvidenceProtocol) -or
        [string]$liveProgress.stage -eq "evaluator-bootstrap"
    if ($ActionEvidenceProtocol -eq "legacy-compatible") {
        if (-not [string]::IsNullOrWhiteSpace(
            $liveActionEvidenceProtocolHash
        )) {
            Stop-NewProcessForContractViolation `
                -Process $newProcess `
                -Reason "Resumed Run C unexpectedly enabled a new action-evidence protocol."
        }
    } elseif (-not $protocolObservable) {
        continue
    } elseif ($liveActionEvidenceProtocol -ne $ActionEvidenceProtocol -or
        (-not [string]::IsNullOrWhiteSpace(
            $preActionEvidenceProtocolHash
        ) -and
        $liveActionEvidenceProtocolHash -ne
            $preActionEvidenceProtocolHash)) {
        Stop-NewProcessForContractViolation `
            -Process $newProcess `
            -Reason "Resumed Run C did not preserve the frozen action-evidence protocol hash."
    }
    $validBootstrapContract = Test-LiveBootstrapContract $liveBootstrapKey
    $validCollectionContract = Test-LiveCollectionContract
    if ($liveProgress.evaluatorBootstrapDatasetKey -and
        -not $validBootstrapContract) {
        if ($migrationRequired -and
            [string]$liveProgress.stage -eq
                "evaluator-bootstrap-compatible-migration") {
            continue
        }
        Stop-NewProcessForContractViolation `
            -Process $newProcess `
            -Reason "Resumed Run C opened an unverified evaluator-bootstrap dataset."
    }
    $acceptedGamesProperty = $liveProgress.PSObject.Properties["acceptedGames"]
    if ($acceptedGamesProperty -and
        [int]$liveProgress.acceptedGames -lt $minimumAcceptedGames) {
        Stop-NewProcessForContractViolation `
            -Process $newProcess `
            -Reason "Resumed Run C reported fewer accepted games than the handoff baseline."
    }
    if ($liveProgress.updatedAt) {
        [void]$heartbeatUpdates.Add([string]$liveProgress.updatedAt)
    }
    $childWorkers = @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.ParentProcessId -eq $newProcess.Id -and
                $_.Name -match "^node(\.exe)?$"
            }
    )
    $sameDataset = $validBootstrapContract
    $resumedCount = $acceptedGamesProperty -and
        [int]$liveProgress.acceptedGames -ge $minimumAcceptedGames
    $advancedPastBootstrap = [string]$liveProgress.stage -ne
        "evaluator-bootstrap"
    if ($validCollectionContract -and
        $sameDataset -and
        $resumedCount -and
        $heartbeatUpdates.Count -ge 2 -and
        ($childWorkers.Count -gt 0 -or $advancedPastBootstrap)) {
        $healthConfirmed = $true
        Write-HandoffLog (
            "Resume health verified. PID={0}, acceptedGames={1}, heartbeatUpdates={2}, childWorkers={3}, ppoCollection={4}" -f
            $newProcess.Id,
            [int]$liveProgress.acceptedGames,
            $heartbeatUpdates.Count,
            $childWorkers.Count,
            $CompatibleCollectionKey
        )
        break
    }
}

if (-not $healthConfirmed) {
    Write-HandoffLog (
        "Resume process is alive but did not satisfy the full health contract within {0} minutes. PID={1}" -f
        $HealthVerificationMinutes,
        $newProcess.Id
    )
    exit 5
}

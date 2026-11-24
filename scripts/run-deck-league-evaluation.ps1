param([string]$Directory='data/ai/deck-league-20261007',[ValidateSet('preflight','run','once')][string]$Mode='run')
$ErrorActionPreference='Stop'
$taskProject=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $taskProject
$taskLeague=(Resolve-Path -LiteralPath $Directory).Path
$taskPointer=Get-Content -LiteralPath (Join-Path $taskLeague 'execution-active.json') -Raw | ConvertFrom-Json
$taskExecution=[IO.Path]::GetFullPath((Join-Path $taskLeague $taskPointer.directory))
if(!$taskExecution.StartsWith($taskLeague+[IO.Path]::DirectorySeparatorChar)){throw 'Execution directory outside league.'}
$env:TF_NUM_INTRAOP_THREADS='1'
$env:TF_NUM_INTEROP_THREADS='1'
$env:OMP_NUM_THREADS='1'
$env:RIFTBOUND_TF_BACKEND='tensorflow'
$env:RIFTBOUND_AI_PROCESS_PRIORITY='normal'
$env:RIFTBOUND_AI_PROCESS_PRIORITY_FILE=Join-Path $taskProject 'data/ai/process-priority.json'
$env:NODE_OPTIONS='--require="'+(Join-Path $taskLeague 'runtime/scripts/tf-node-compat.cjs').Replace('\','/')+'" --require="'+(Join-Path $taskLeague 'runtime/scripts/ai-training-priority.cjs').Replace('\','/')+'"'
& 'C:\Program Files\nodejs\node.exe' --expose-gc --max-old-space-size=8192 (Join-Path $taskExecution 'run-deck-league-evaluation.mjs') (Join-Path $taskExecution 'evaluation-lane.json') $Mode
exit $LASTEXITCODE

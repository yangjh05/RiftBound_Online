param([string]$Directory='data/ai/deck-league-20261007',[ValidateSet('preflight','run')][string]$Mode='run')
$ErrorActionPreference='Stop'
$taskProject=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $taskProject
$taskLeague=(Resolve-Path -LiteralPath $Directory).Path
$env:TF_NUM_INTRAOP_THREADS='1'
$env:TF_NUM_INTEROP_THREADS='1'
$env:OMP_NUM_THREADS='1'
$env:RIFTBOUND_TF_BACKEND='tensorflow'
$env:RIFTBOUND_AI_PROCESS_PRIORITY='normal'
$env:RIFTBOUND_AI_PROCESS_PRIORITY_FILE=Join-Path $taskProject 'data/ai/process-priority.json'
$env:NODE_OPTIONS='--require="'+(Join-Path $taskLeague 'runtime/scripts/tf-node-compat.cjs').Replace('\','/')+'" --require="'+(Join-Path $taskLeague 'runtime/scripts/ai-training-priority.cjs').Replace('\','/')+'"'
$taskExecution=Join-Path $taskLeague 'execution'
$taskExecutionPointer=Join-Path $taskLeague 'execution-active.json'
if(Test-Path -LiteralPath $taskExecutionPointer){
  $taskExecution=[IO.Path]::GetFullPath((Join-Path $taskLeague ((Get-Content -LiteralPath $taskExecutionPointer -Raw | ConvertFrom-Json).directory)))
  if(!$taskExecution.StartsWith($taskLeague+[IO.Path]::DirectorySeparatorChar)){throw 'Execution directory outside league.'}
}
& 'C:\Program Files\nodejs\node.exe' --expose-gc --max-old-space-size=8192 (Join-Path $taskExecution 'train-deck-league.mjs') (Join-Path $taskLeague 'config.json') $Mode
exit $LASTEXITCODE

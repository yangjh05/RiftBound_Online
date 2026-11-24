param([string]$Directory='data/ai/deck-league-individual-20261011-r2',[ValidateSet('preflight','run','once')][string]$Mode='run')
$ErrorActionPreference='Stop'
$taskProject=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $taskProject
$taskStudy=(Resolve-Path -LiteralPath $Directory).Path
function Get-TaskArtifactHash([string]$Path){
  $taskHasher=[Security.Cryptography.SHA256]::Create()
  $taskStream=[IO.File]::OpenRead($Path)
  try{return [BitConverter]::ToString($taskHasher.ComputeHash($taskStream)).Replace('-','').ToLowerInvariant()}
  finally{$taskStream.Dispose();$taskHasher.Dispose()}
}
$taskPointer=Get-Content -LiteralPath (Join-Path $taskStudy 'execution-active.json') -Raw | ConvertFrom-Json
if((Get-TaskArtifactHash $taskPointer.path) -ne $taskPointer.sha256){throw 'Execution pointer changed.'}
$taskExecution=Get-Content -LiteralPath $taskPointer.path -Raw | ConvertFrom-Json
foreach($taskArtifact in $taskExecution.evaluationExecutionFiles){if((Get-TaskArtifactHash $taskArtifact.path) -ne $taskArtifact.sha256){throw 'Evaluation execution changed.'}}
$env:TF_NUM_INTRAOP_THREADS='1'
$env:TF_NUM_INTEROP_THREADS='1'
$env:OMP_NUM_THREADS='1'
$env:RIFTBOUND_TF_BACKEND='tensorflow'
$env:RIFTBOUND_AI_PROCESS_PRIORITY='normal'
$env:RIFTBOUND_AI_PROCESS_PRIORITY_FILE=Join-Path $taskProject 'data/ai/process-priority.json'
$env:NODE_OPTIONS='--require="'+(Join-Path $taskStudy 'runtime/scripts/tf-node-compat.cjs').Replace('\','/')+'" --require="'+(Join-Path $taskStudy 'runtime/scripts/ai-training-priority.cjs').Replace('\','/')+'"'
& 'C:\Program Files\nodejs\node.exe' --expose-gc --max-old-space-size=8192 (Join-Path $taskExecution.evaluationExecutionDirectory 'run-deck-league-evaluation.mjs') (Join-Path (Split-Path $taskPointer.path -Parent) 'evaluation-lane.json') $Mode
exit $LASTEXITCODE

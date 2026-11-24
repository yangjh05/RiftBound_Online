param([string]$Directory='data/ai/deck-league-individual-20261011-r2',[ValidateSet('preflight','run','test','replay-ready')][string]$Mode='run',[string]$Profile='')
$ErrorActionPreference='Stop'
$taskProject=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $taskProject
$taskStudy=(Resolve-Path -LiteralPath $Directory).Path
$env:TF_NUM_INTRAOP_THREADS='1'
$env:TF_NUM_INTEROP_THREADS='1'
$env:OMP_NUM_THREADS='1'
$env:RIFTBOUND_TF_BACKEND='tensorflow'
$env:RIFTBOUND_AI_PROCESS_PRIORITY='normal'
$env:RIFTBOUND_AI_PROCESS_PRIORITY_FILE=Join-Path $taskProject 'data/ai/process-priority.json'
$env:RIFTBOUND_CONSTRAINED_RUNTIME=Join-Path $taskStudy 'runtime'
$env:NODE_OPTIONS='--require="'+(Join-Path $taskStudy 'runtime/scripts/tf-node-compat.cjs').Replace('\','/')+'" --require="'+(Join-Path $taskStudy 'runtime/scripts/ai-training-priority.cjs').Replace('\','/')+'"'
if($Mode -eq 'test') {
  & 'C:\Program Files\nodejs\node.exe' --test tests/individual-policy-learning.test.mjs tests/transactional-policy-learning.test.mjs tests/constrained-runtime-compatibility.test.mjs
} else {
  $taskArguments=@('--expose-gc','--max-old-space-size=8192',(Join-Path $taskProject 'scripts/run-individual-deck-study.mjs'),$taskStudy,$Mode)
  if($Profile){if($Mode -ne 'replay-ready'){throw 'Profile scope requires replay-ready mode.'};$taskArguments+=$Profile}
  & 'C:\Program Files\nodejs\node.exe' @taskArguments
}
exit $LASTEXITCODE

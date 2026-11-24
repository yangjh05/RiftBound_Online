param([string]$Directory='data/ai/deck-league-transactional-20261008',[ValidateSet('preflight','run','test')][string]$Mode='run')
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
  & 'C:\Program Files\nodejs\node.exe' --test tests/transactional-policy-learning.test.mjs tests/constrained-runtime-compatibility.test.mjs
} else {
  & 'C:\Program Files\nodejs\node.exe' --expose-gc --max-old-space-size=8192 (Join-Path $taskProject 'scripts/run-transactional-deck-study.mjs') $taskStudy $Mode
}
exit $LASTEXITCODE

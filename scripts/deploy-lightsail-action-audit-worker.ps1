param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9_.@-]+$')]
  [string]$HostAlias,

  [ValidateRange(1, 65535)]
  [int]$Port = 22,

  [string]$IdentityFile,

  [ValidatePattern('^/[A-Za-z0-9._/-]+$')]
  [string]$InstallRoot = '/home/ubuntu/riftbound-audit',

  [ValidateRange(1, 2)]
  [int]$MaximumWorkers = 2,

  [string]$ConfigurationFile,

  [switch]$SkipSwap
)

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(ValueFromRemainingArguments = $true)][object[]]$Arguments
  )
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE."
  }
}

$ErrorActionPreference = 'Stop'
if ($InstallRoot.Contains('..')) {
  throw 'InstallRoot cannot contain a parent-directory segment.'
}
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$resolvedIdentityFile = $null
if ($IdentityFile) {
  $resolvedIdentityFile = (Resolve-Path -LiteralPath $IdentityFile).Path
}
$timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmss')
$releaseRoot = "$InstallRoot/releases/$timestamp"
$remoteArchive = "/tmp/riftbound-action-audit-$timestamp.tar.gz"
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "riftbound-action-audit-$timestamp"
$localArchive = Join-Path $temporaryRoot 'runtime.tar.gz'
New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null

$sshArguments = @(
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=15',
  '-p', [string]$Port
)
$scpArguments = @(
  '-q',
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=15',
  '-P', [string]$Port
)
if ($resolvedIdentityFile) {
  $sshArguments += @('-i', $resolvedIdentityFile)
  $scpArguments += @('-i', $resolvedIdentityFile)
}

try {
  Push-Location $workspaceRoot
  try {
    Invoke-Native -Command 'tar.exe' -Arguments @(
      '-czf', $localArchive,
      'package.json',
      'package-lock.json',
      'src',
      'scripts',
      'assets/vendor/tensorflow/tf.fesm.min.js'
    )
  } finally {
    Pop-Location
  }

  Invoke-Native -Command 'ssh' -Arguments ($sshArguments + @(
    $HostAlias,
    "mkdir -p '$releaseRoot' '$InstallRoot/runtime'"
  ))
  Invoke-Native -Command 'scp' -Arguments ($scpArguments + @(
    $localArchive,
    "${HostAlias}:$remoteArchive"
  ))

  if (-not $SkipSwap) {
$swapCommand = @'
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  if [ ! -f /swapfile ]; then sudo fallocate -l 2G /swapfile; fi
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
fi
if ! grep -q '^/swapfile ' /etc/fstab; then
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
'@
    $swapCommand = $swapCommand.Replace("`r`n", "`n")
    Invoke-Native -Command 'ssh' -Arguments ($sshArguments + @(
      $HostAlias,
      $swapCommand
    ))
  }

  $installCommand = @"
set -eu
if [ ! -x /snap/bin/node ]; then
  sudo snap install node --classic --channel=20/stable
fi
export PATH=/snap/bin:`$PATH
node_major=`$(node --version | sed 's/^v//' | cut -d. -f1)
if [ "`$node_major" -lt 20 ]; then
  echo 'Node.js 20 or newer is required.' >&2
  exit 1
fi
tar -xzf '$remoteArchive' -C '$releaseRoot'
cd '$releaseRoot'
NODE_OPTIONS=--max-old-space-size=512 npm ci --omit=dev
node --check scripts/ai-action-audit-remote-host.mjs
node --check scripts/ai-action-audit-worker-process.mjs
ln -sfn '$releaseRoot' '$InstallRoot/current.next'
mv -Tf '$InstallRoot/current.next' '$InstallRoot/current'
rm -f '$remoteArchive'
node --input-type=module -e \"import('./scripts/ai-action-audit-runtime-fingerprint.mjs').then(async m => console.log(await m.actionAuditRuntimeFingerprint(process.cwd())))\"
free -h
"@
  $installCommand = $installCommand.Replace("`r`n", "`n")
  Invoke-Native -Command 'ssh' -Arguments ($sshArguments + @(
    $HostAlias,
    $installCommand
  ))

  if (-not $ConfigurationFile) {
    $ConfigurationFile = Join-Path $workspaceRoot '.env.action-audit-remote'
  }
  $configurationLines = @(
    "RIFTBOUND_ACTION_AUDIT_REMOTE_HOST=$HostAlias",
    "RIFTBOUND_ACTION_AUDIT_REMOTE_PROJECT_ROOT=$InstallRoot/current",
    "RIFTBOUND_ACTION_AUDIT_REMOTE_RUNTIME_ROOT=$InstallRoot/runtime",
    "RIFTBOUND_ACTION_AUDIT_REMOTE_MAX_WORKERS=$MaximumWorkers",
    "RIFTBOUND_ACTION_AUDIT_REMOTE_PORT=$Port",
    'RIFTBOUND_ACTION_AUDIT_REMOTE_MINIMUM_FREE_MEMORY_MB=250',
    'RIFTBOUND_ACTION_AUDIT_REMOTE_WORKER_HEADROOM_MB=256',
    'RIFTBOUND_ACTION_AUDIT_REMOTE_NODE_HEAP_MB=384',
    'RIFTBOUND_ACTION_AUDIT_REMOTE_TRANSFER_TIMEOUT_SECONDS=600',
    'RIFTBOUND_ACTION_AUDIT_REMOTE_REQUEST_TIMEOUT_MINUTES=360',
    'RIFTBOUND_ACTION_AUDIT_REMOTE_SESSION_TTL_HOURS=24'
  )
  if ($resolvedIdentityFile) {
    $configurationLines += "RIFTBOUND_ACTION_AUDIT_REMOTE_IDENTITY_FILE=$resolvedIdentityFile"
  }
  [IO.File]::WriteAllLines(
    [IO.Path]::GetFullPath($ConfigurationFile),
    $configurationLines,
    [Text.UTF8Encoding]::new($false)
  )

  Write-Host ''
  Write-Host 'Lightsail action-audit runtime deployment completed.'
  Write-Host "Local coordinator configuration: $ConfigurationFile"
  Write-Host 'It will be loaded automatically on the next safe training restart.'
} catch {
  $cleanupReleaseArguments = $sshArguments + @(
    $HostAlias,
    'rm', '-rf', $releaseRoot
  )
  $cleanupArchiveArguments = $sshArguments + @(
    $HostAlias,
    'rm', '-f', $remoteArchive
  )
  & ssh @cleanupReleaseArguments 2>$null | Out-Null
  & ssh @cleanupArchiveArguments 2>$null | Out-Null
  throw
} finally {
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}

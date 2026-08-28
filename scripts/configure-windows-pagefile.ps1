param(
    [ValidateRange(8192, 65536)]
    [int]$InitialSizeMb = 16384,

    [ValidateRange(16384, 65536)]
    [int]$MaximumSizeMb = 32768,

    [string]$ResultPath
)

$ErrorActionPreference = "Stop"

if ($MaximumSizeMb -lt $InitialSizeMb) {
    throw "MaximumSizeMb must be greater than or equal to InitialSizeMb."
}

$principal = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $principal.IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)) {
    throw "Administrator privileges are required to configure the page file."
}

$computerSystem = Get-CimInstance Win32_ComputerSystem
$automaticBefore = [bool]$computerSystem.AutomaticManagedPagefile
$pagefileName = "C:\pagefile.sys"
$initialSizeValue = [uint32]$InitialSizeMb
$maximumSizeValue = [uint32]$MaximumSizeMb

function Find-PageFileSetting {
    param(
        [string]$Name,
        [int]$Attempts = 1
    )

    for ($attempt = 0; $attempt -lt $Attempts; $attempt += 1) {
        $setting = @(Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue) |
            Where-Object { $_.Name -ieq $Name } |
            Select-Object -First 1
        if ($setting) {
            return $setting
        }
        if ($attempt + 1 -lt $Attempts) {
            Start-Sleep -Milliseconds 200
        }
    }
    return $null
}

function Set-PageFileSize {
    param(
        [Microsoft.Management.Infrastructure.CimInstance]$Setting,
        [uint32]$InitialSize,
        [uint32]$MaximumSize
    )

    Set-CimInstance `
        -InputObject $Setting `
        -Property @{
            InitialSize = $InitialSize
            MaximumSize = $MaximumSize
        } |
        Out-Null
}

try {
    if ($automaticBefore) {
        Set-CimInstance `
            -InputObject $computerSystem `
            -Property @{ AutomaticManagedPagefile = $false } |
            Out-Null
    }

    # Disabling automatic management can cause Windows to materialize the
    # current page-file setting asynchronously, so always query afterwards.
    $pagefile = Find-PageFileSetting -Name $pagefileName -Attempts 5
    if ($pagefile) {
        Set-PageFileSize `
            -Setting $pagefile `
            -InitialSize $initialSizeValue `
            -MaximumSize $maximumSizeValue
    } else {
        try {
            New-CimInstance `
                -ClassName Win32_PageFileSetting `
                -Property @{
                    Name = $pagefileName
                    InitialSize = $initialSizeValue
                    MaximumSize = $maximumSizeValue
                } |
                Out-Null
        } catch {
            # Windows may create the setting between our lookup and create.
            # Treat ResourceExists as a race only when the target now exists.
            $pagefile = Find-PageFileSetting -Name $pagefileName -Attempts 5
            if (-not $pagefile) {
                throw
            }
            Set-PageFileSize `
                -Setting $pagefile `
                -InitialSize $initialSizeValue `
                -MaximumSize $maximumSizeValue
        }
    }

    $configuredPagefile = Find-PageFileSetting -Name $pagefileName -Attempts 5
    if (-not $configuredPagefile -or
        [uint32]$configuredPagefile.InitialSize -ne $initialSizeValue -or
        [uint32]$configuredPagefile.MaximumSize -ne $maximumSizeValue) {
        throw "The configured page-file size could not be verified."
    }

    $result = [ordered]@{
        version = 1
        success = $true
        pagefile = $pagefileName
        initialSizeMb = $InitialSizeMb
        maximumSizeMb = $MaximumSizeMb
        restartRequired = $true
        configuredAt = (Get-Date).ToUniversalTime().ToString("o")
    }
} catch {
    if ($automaticBefore) {
        try {
            $currentSystem = Get-CimInstance Win32_ComputerSystem
            Set-CimInstance `
                -InputObject $currentSystem `
                -Property @{ AutomaticManagedPagefile = $true } |
                Out-Null
        } catch {}
    }
    $result = [ordered]@{
        version = 1
        success = $false
        error = $_.Exception.Message
        configuredAt = (Get-Date).ToUniversalTime().ToString("o")
    }
    if ($ResultPath) {
        $result | ConvertTo-Json | Set-Content -LiteralPath $ResultPath -Encoding UTF8
    }
    throw
}

if ($ResultPath) {
    $result | ConvertTo-Json | Set-Content -LiteralPath $ResultPath -Encoding UTF8
}
$result | ConvertTo-Json

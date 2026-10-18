# Used only by --ci-offline on a disposable GitHub-hosted Windows runner.
# The fixture creates this executable copy before calling Block and launches it
# only after the active outbound rule has been checked. Cleanup also handles a
# workflow step timeout: stop that exact executable before removing its rule.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Block', 'Cleanup')]
    [string]$Action,
    [string]$Program
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or
    $env:RUNNER_OS -ne 'Windows' -or $env:GITHUB_RUN_ID -notmatch '^\d+$' -or
    $env:GITHUB_RUN_ATTEMPT -notmatch '^\d+$' -or -not $env:RUNNER_TEMP) {
    throw 'CI firewall isolation is restricted to a GitHub-hosted Windows job.'
}
$ruleName = "NewsTerminal-v05-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"

function Assert-OwnedProgram([string]$Candidate) {
    if (-not $Candidate) { throw 'The owned executable path is required.' }
    $full = [IO.Path]::GetFullPath($Candidate)
    $temporaryRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\', '/') + '\'
    $parentName = [IO.Path]::GetFileName([IO.Path]::GetDirectoryName($full))
    if (-not $full.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($full) -ne 'v05-native-app.exe' -or
        $parentName -notmatch '^v05-native-[A-Za-z0-9]+$') {
        throw 'Refusing a program outside the fresh native fixture directory.'
    }
    return $full
}

$existing = @(Get-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -ErrorAction SilentlyContinue)
if ($Action -eq 'Cleanup') {
    if ($existing.Count -eq 0) {
        @{ ruleName = $ruleName; removed = $false; reason = 'No owned rule remains' } | ConvertTo-Json -Compress
        return
    }
    if ($existing.Count -ne 1) { throw 'Expected exactly one owned CI firewall rule.' }
    $filters = @($existing[0] | Get-NetFirewallApplicationFilter)
    if ($filters.Count -ne 1) { throw 'Expected exactly one owned program filter.' }
    $ownedProgram = Assert-OwnedProgram $filters[0].Program
    $ownedProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'v05-native-app.exe'" |
        Where-Object { $_.ExecutablePath -eq $ownedProgram })
    foreach ($ownedProcess in $ownedProcesses) {
        & taskkill.exe /PID $ownedProcess.ProcessId /T /F | Out-Null
    }
    $remaining = @(Get-CimInstance Win32_Process -Filter "Name = 'v05-native-app.exe'" |
        Where-Object { $_.ExecutablePath -eq $ownedProgram })
    if ($remaining.Count) { throw 'Owned app remains alive; retaining its outbound block.' }
    $existing[0] | Remove-NetFirewallRule
    @{ ruleName = $ruleName; program = $ownedProgram; removed = $true
       stoppedProcessIds = @($ownedProcesses | ForEach-Object { $_.ProcessId }) } | ConvertTo-Json -Compress
    return
}

$ownedProgram = Assert-OwnedProgram $Program
if (-not (Test-Path -LiteralPath $ownedProgram -PathType Leaf)) { throw 'Owned executable does not exist.' }
if ($existing.Count) { throw 'Refusing to replace an existing CI firewall rule.' }
if ((Get-Service MpsSvc).Status -ne 'Running') { throw 'Windows Firewall service is not running.' }
$firewallProfiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore)
if ($firewallProfiles.Count -ne 3 -or @($firewallProfiles | Where-Object {
    $_.Enabled -ne 'True' -or $_.AllowLocalFirewallRules -eq 'False'
}).Count) {
    throw 'Native CI requires enabled firewall profiles that accept local rules; no profile settings are changed.'
}
try {
    New-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -DisplayName $ruleName -Direction Outbound -Action Block -Profile Any -Enabled True -Program $ownedProgram | Out-Null
    $active = @(Get-NetFirewallRule -PolicyStore ActiveStore -Name $ruleName)
    $activeFilters = @($active | Get-NetFirewallApplicationFilter)
    if ($active.Count -ne 1 -or $active[0].Enabled -ne 'True' -or
        $active[0].Direction -ne 'Outbound' -or $active[0].Action -ne 'Block' -or
        $activeFilters.Count -ne 1 -or $activeFilters[0].Program -ne $ownedProgram) {
        throw 'The exact owned executable outbound block is not active.'
    }
} catch {
    Get-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    throw
}
@{ ruleName = $ruleName; program = $ownedProgram; action = 'Block'; direction = 'Outbound'
   profiles = @($firewallProfiles | ForEach-Object { $_.Name }); activeBeforeLaunch = $true } | ConvertTo-Json -Compress

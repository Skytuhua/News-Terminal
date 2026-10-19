# Only the installed-application gate on a disposable GitHub-hosted job may
# mutate state here. Paths and identities are fixed, never arbitrary arguments.
[CmdletBinding()]
param([Parameter(Mandatory = $true)]
    [ValidateSet('Preflight', 'BeforeInstall', 'Installed', 'Block', 'BeforeUninstall', 'Uninstalled', 'Cleanup')]
    [string]$Action)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or
    $env:RUNNER_OS -ne 'Windows' -or [IntPtr]::Size -ne 8 -or
    $env:GITHUB_RUN_ID -notmatch '^\d+$' -or $env:GITHUB_RUN_ATTEMPT -notmatch '^\d+$' -or
    $env:GITHUB_SHA -notmatch '^[0-9a-f]{40}$' -or -not $env:RUNNER_TEMP -or -not $env:GITHUB_WORKSPACE) {
    throw 'Installed acceptance is restricted to a disposable GitHub-hosted Windows x64 job.'
}
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$runDirectory = Join-Path $env:RUNNER_TEMP "NewsTerminal install $env:GITHUB_RUN_ID $env:GITHUB_RUN_ATTEMPT"
$installDirectory = Join-Path $runDirectory 'News Terminal'
$application = Join-Path $installDirectory 'news-terminal.exe'
$ownerFile = Join-Path $runDirectory 'owner.json'
$ruleName = "NewsTerminal-install-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\News Terminal'
$manufacturerKey = 'HKCU:\Software\newsterminal\News Terminal'
$roamingData = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'com.newsterminal.desktop'
$localData = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'com.newsterminal.desktop'
$shortcutPaths = @(
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'News Terminal.lnk')
    (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'News Terminal.lnk')
    (Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'News Terminal.lnk')
    (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'News Terminal.lnk')
)

function Assert-NoReparse([string]$Path) {
    $candidate = [IO.Path]::GetFullPath($Path)
    while ($candidate) {
        if (Test-Path -LiteralPath $candidate) {
            $item = Get-Item -Force -LiteralPath $candidate
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Refusing a reparse point: $candidate"
            }
        }
        $candidate = [IO.Path]::GetDirectoryName($candidate)
    }
}
foreach ($path in @($runDirectory, $env:GITHUB_WORKSPACE, $roamingData, $localData) + $shortcutPaths) {
    Assert-NoReparse $path
}

function SameNameProcesses {
    @(Get-CimInstance Win32_Process -Filter "Name = 'news-terminal.exe'" |
        ForEach-Object { @{ pid = [int]$_.ProcessId; path = $_.ExecutablePath } })
}

function Runtime {
    $runtimeId = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    foreach ($key in @("HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$runtimeId",
                       "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$runtimeId")) {
        if (Test-Path -LiteralPath $key) {
            $value = (Get-Item -LiteralPath $key).GetValue('pv', '')
            $parsed = $null
            if ([version]::TryParse([string]$value, [ref]$parsed) -and $parsed -gt [version]'0.0.0.0') {
                @{ registryKey = $key; version = [string]$value }
            }
        }
    }
}

function Registration {
    if (-not (Test-Path -LiteralPath $uninstallKey)) { return @{ exists = $false } }
    $item = Get-Item -LiteralPath $uninstallKey
    @{ exists = $true; displayName = $item.GetValue('DisplayName', '')
       version = $item.GetValue('DisplayVersion', ''); publisher = $item.GetValue('Publisher', '')
       installLocation = $item.GetValue('InstallLocation', ''); uninstallString = $item.GetValue('UninstallString', '')
       mainBinaryName = $item.GetValue('MainBinaryName', '') }
}

function ManufacturerLocation {
    if (Test-Path -LiteralPath $manufacturerKey) { return (Get-Item -LiteralPath $manufacturerKey).GetValue('', '') }
    return $null
}

function Shortcuts {
    $shell = New-Object -ComObject WScript.Shell
    try {
        foreach ($path in $shortcutPaths) {
            $present = Test-Path -LiteralPath $path -PathType Leaf
            $target = $null
            $arguments = $null
            if ($present) {
                $link = $shell.CreateShortcut($path)
                try { $target = $link.TargetPath; $arguments = $link.Arguments }
                finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($link) }
            }
            @{ path = $path; exists = $present; target = $target; arguments = $arguments }
        }
    } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
}

function Read-Owner {
    if (-not (Test-Path -LiteralPath $ownerFile -PathType Leaf)) { throw 'The owned installation journal is missing.' }
    $owner = Get-Content -Raw -LiteralPath $ownerFile | ConvertFrom-Json
    if ($owner.schemaVersion -ne 1 -or $owner.runId -ne $env:GITHUB_RUN_ID -or
        $owner.runAttempt -ne $env:GITHUB_RUN_ATTEMPT -or $owner.sourceHead -ne $env:GITHUB_SHA -or
        $owner.runDirectory -ne $runDirectory -or $owner.preflightPassed -ne $true -or
        $owner.applicationSha256 -notmatch '^[0-9a-f]{64}$' -or
        $owner.uninstallerSha256 -notmatch '^[0-9a-f]{64}$' -or
        $owner.installerSha256 -notmatch '^[0-9a-f]{64}$' -or
        $owner.version -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$') {
        throw 'The installation journal does not belong to this job and identity.'
    }
    return $owner
}

if ($Action -eq 'Preflight' -or $Action -eq 'BeforeInstall') {
    if ($Action -eq 'BeforeInstall') { $null = Read-Owner }
    $collisions = @()
    $ownedPath = @()
    if ($Action -eq 'Preflight') { $ownedPath += $runDirectory }
    foreach ($path in $ownedPath + @($roamingData, $localData,
        (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'News Terminal')) + $shortcutPaths +
        @($uninstallKey, $manufacturerKey, 'HKCU:\Software\WOW6432Node\newsterminal\News Terminal',
          'HKLM:\Software\newsterminal\News Terminal', 'HKLM:\Software\WOW6432Node\newsterminal\News Terminal')) {
        if (Test-Path -LiteralPath $path) { $collisions += $path }
    }
    foreach ($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
        if (Test-Path -LiteralPath $key) {
            foreach ($entry in Get-ChildItem -LiteralPath $key) {
                if ($entry.PSChildName -eq 'News Terminal' -or $entry.GetValue('DisplayName', '') -eq 'News Terminal') {
                    $collisions += $entry.Name
                }
            }
        }
    }
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    if ((Test-Path -LiteralPath $runKey) -and $null -ne (Get-Item -LiteralPath $runKey).GetValue('News Terminal', $null)) {
        $collisions += 'Existing News Terminal autostart registration'
    }
    if (Get-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -ErrorAction SilentlyContinue) {
        $collisions += 'Existing owned-name firewall rule'
    }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $os = Get-CimInstance Win32_OperatingSystem
    @{ collisions = @($collisions | Sort-Object -Unique); sameNameProcesses = @(SameNameProcesses)
       runtime = @(Runtime); interactive = [Environment]::UserInteractive; sessionId = (Get-Process -Id $PID).SessionId
       userSid = $identity.User.Value; administrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
       os = $os.Caption; osVersion = $os.Version; osBuild = $os.BuildNumber
       image = $env:ImageOS; imageVersion = $env:ImageVersion; dataDirectory = $roamingData; localDataDirectory = $localData
       runDirectory = $runDirectory; installDirectory = $installDirectory } | ConvertTo-Json -Depth 5 -Compress
    return
}

if ($Action -eq 'Cleanup' -and -not (Test-Path -LiteralPath $ownerFile)) {
    if (Get-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -ErrorAction SilentlyContinue) {
        throw 'An owned-name firewall rule exists without an ownership journal; refusing to remove it.'
    }
    @{ passed = $true; ruleRemoved = $true; stoppedProcessIds = @(); remainingProcessIds = @(); reason = 'No installation journal was created' } |
        ConvertTo-Json -Compress
    return
}
$owner = Read-Owner

if ($Action -eq 'Installed' -or $Action -eq 'BeforeUninstall' -or $Action -eq 'Uninstalled') {
    $processes = @(SameNameProcesses)
    if ($Action -eq 'BeforeUninstall' -and $processes.Count) {
        throw 'Refusing uninstall while any same-name application process exists; NSIS could kill it.'
    }
    @{ registration = (Registration); manufacturerLocation = (ManufacturerLocation); shortcuts = @(Shortcuts)
       sameNameProcesses = $processes; runtime = @(Runtime)
       installDirectoryExists = (Test-Path -LiteralPath $installDirectory)
       applicationExists = (Test-Path -LiteralPath $application -PathType Leaf) } | ConvertTo-Json -Depth 5 -Compress
    return
}

if ($Action -eq 'Block') {
    if (@(SameNameProcesses).Count) { throw 'An application appeared before installed launch; refusing to continue.' }
    if (-not (Test-Path -LiteralPath $application -PathType Leaf) -or
        (Get-FileHash -Algorithm SHA256 -LiteralPath $application).Hash -ne $owner.applicationSha256) {
        throw 'Installed application identity changed before firewall isolation.'
    }
    if (Get-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -ErrorAction SilentlyContinue) {
        throw 'Refusing to replace an existing firewall rule.'
    }
    if ((Get-Service MpsSvc).Status -ne 'Running') { throw 'Windows Firewall is not running.' }
    $profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore)
    if ($profiles.Count -ne 3 -or @($profiles | Where-Object { $_.Enabled -ne 'True' -or $_.AllowLocalFirewallRules -eq 'False' }).Count) {
        throw 'Enabled firewall profiles that accept local rules are required; no profiles are changed.'
    }
    New-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -DisplayName $ruleName -Direction Outbound -Action Block -Profile Any -Enabled True -Program $application | Out-Null
    $rules = @(Get-NetFirewallRule -PolicyStore ActiveStore -Name $ruleName)
    $filters = @($rules | Get-NetFirewallApplicationFilter)
    if ($rules.Count -ne 1 -or $rules[0].Enabled -ne 'True' -or $rules[0].Direction -ne 'Outbound' -or
        $rules[0].Action -ne 'Block' -or $filters.Count -ne 1 -or $filters[0].Program -ne $application) {
        throw 'The installed application outbound block is not active.'
    }
    @{ ruleName = $ruleName; program = $application; activeBeforeLaunch = $true; scope = 'Installed parent executable only' } |
        ConvertTo-Json -Compress
    return
}

# A timeout fallback can stop only journaled processes at the exact owned paths.
# It never invokes the name-based NSIS process killer or removes user data.
$candidates = @()
if ($owner.appPid) { $candidates += @{ pid = $owner.appPid; path = $application; hash = $owner.applicationSha256 } }
if ($owner.commandPid) {
    if ($owner.commandKind -eq 'install') {
        $path = Join-Path $env:GITHUB_WORKSPACE "src-tauri\target\release\bundle\nsis\News Terminal_$($owner.version)_x64-setup.exe"
        $hash = $owner.installerSha256
    } elseif ($owner.commandKind -eq 'uninstall') {
        $path = Join-Path $runDirectory 'owned-uninstall.exe'
        $hash = $owner.uninstallerSha256
    } else { throw 'Unsupported owned command kind.' }
    $candidates += @{ pid = $owner.commandPid; path = $path; hash = $hash }
}
$stopped = @()
foreach ($candidate in $candidates) {
    $pidNumber = [int]$candidate.pid
    if ($pidNumber -le 0) { throw 'Invalid journaled process ID.' }
    $child = Get-CimInstance Win32_Process -Filter "ProcessId = $pidNumber"
    if ($child) {
        if ($child.ExecutablePath -ne $candidate.path -or -not (Test-Path -LiteralPath $candidate.path -PathType Leaf) -or
            (Get-FileHash -Algorithm SHA256 -LiteralPath $candidate.path).Hash -ne $candidate.hash) {
            throw "Refusing unrelated or changed process $pidNumber."
        }
        $stopped += $pidNumber
        & taskkill.exe /PID $pidNumber /T /F | Out-Null
    }
}
$remaining = @(Get-CimInstance Win32_Process -Filter "Name = 'news-terminal.exe'" |
    Where-Object { $_.ExecutablePath -eq $application } | ForEach-Object { [int]$_.ProcessId })
foreach ($candidate in $candidates) {
    if (Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$candidate.pid)" |
        Where-Object { $_.ExecutablePath -eq $candidate.path }) { $remaining += [int]$candidate.pid }
}
$remaining = @($remaining | Sort-Object -Unique)
$removed = $false
if ($remaining.Count -eq 0) {
    $rules = @(Get-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -ErrorAction SilentlyContinue)
    if ($rules.Count -gt 1) { throw 'More than one owned firewall rule exists.' }
    if ($rules.Count -eq 1) {
        $filters = @($rules | Get-NetFirewallApplicationFilter)
        if ($filters.Count -ne 1 -or $filters[0].Program -ne $application) { throw 'Refusing an unrelated firewall filter.' }
        $rules | Remove-NetFirewallRule
    }
    $removed = @(Get-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -ErrorAction SilentlyContinue).Count -eq 0
}
@{ passed = ($remaining.Count -eq 0 -and $stopped.Count -eq 0 -and $removed)
   ruleRemoved = $removed; stoppedProcessIds = @($stopped); remainingProcessIds = $remaining
   preservedDataDirectory = $roamingData; retainedJournal = $ownerFile } | ConvertTo-Json -Compress

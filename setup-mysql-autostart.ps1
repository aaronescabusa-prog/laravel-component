#Requires -Version 5.1
<#
.SYNOPSIS
    Makes the XAMPP MySQL that this project needs start automatically at logon.

.DESCRIPTION
    Two problems are fixed here:

    1. MySQL80 and MySQL267 are Windows services set to start AUTOMATICALLY and
       both are configured for port 3306. The `eventease` database this project
       uses lives in XAMPP's own datadir, not in either service's datadir, so a
       service winning port 3306 at boot means the app connects to a server that
       has no `eventease` database. They are set to MANUAL so they never take
       the port automatically. MANUAL (not DISABLED) keeps them startable by
       hand if you ever need them.

    2. XAMPP's mysqld is started as a scheduled task at logon, running as you
       rather than as LocalSystem, which is what MySQL recommends and what the
       datadir permissions expect.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\setup-mysql-autostart.ps1

.EXAMPLE
    .\setup-mysql-autostart.ps1 -Remove    # undo everything this script did
#>

[CmdletBinding()]
param(
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$MySqlExe  = 'C:\xampp\mysql\bin\mysqld.exe'
$MySqlIni  = 'C:\xampp\mysql\bin\my.ini'
$DataDir   = 'C:\xampp\mysql\data'
$TaskName  = 'XAMPP MySQL'
$Services  = @('MySQL80', 'MySQL267')

# ----------------------------------------------------------------- elevation

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)

if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Administrator rights are required. Re-launching with elevation...' -ForegroundColor Yellow
    Write-Host 'Accept the UAC prompt to continue.' -ForegroundColor Yellow

    $arguments = @(
        '-NoProfile'
        '-ExecutionPolicy', 'Bypass'
        '-File', ('"{0}"' -f $PSCommandPath)
    )

    if ($Remove) { $arguments += '-Remove' }

    try {
        Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Verb RunAs
    } catch {
        Write-Host "Elevation was declined, so nothing was changed. Re-run as Administrator to continue." -ForegroundColor Red
        exit 1
    }

    exit 0
}

# ------------------------------------------------------------------- preflight

if (-not $Remove) {
    Write-Host "`nChecking prerequisites..." -ForegroundColor Cyan

    if (-not (Test-Path -LiteralPath $MySqlExe)) {
        Write-Host "Cannot find $MySqlExe" -ForegroundColor Red
        Write-Host 'This script targets the XAMPP MySQL install at C:\xampp\mysql.' -ForegroundColor Red
        exit 1
    }

    if (-not (Test-Path -LiteralPath $DataDir)) {
        Write-Host "Cannot find the data directory $DataDir" -ForegroundColor Red
        exit 1
    }

    # Guard against pointing this at the wrong data: the project database must
    # actually live where we are about to start the server from.
    if (-not (Test-Path -LiteralPath (Join-Path $DataDir 'eventease'))) {
        Write-Host "The 'eventease' database was not found in $DataDir." -ForegroundColor Red
        Write-Host 'Refusing to continue: this looks like the wrong MySQL install.' -ForegroundColor Red
        exit 1
    }

    Write-Host "  mysqld   : $MySqlExe" -ForegroundColor Green
    Write-Host "  config   : $MySqlIni" -ForegroundColor Green
    Write-Host "  datadir  : $DataDir (contains 'eventease')" -ForegroundColor Green
}

# --------------------------------------------------------------------- remove

if ($Remove) {
    Write-Host "`nRemoving scheduled task..." -ForegroundColor Cyan

    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

    if ($task) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "  removed '$TaskName'" -ForegroundColor Green
    } else {
        Write-Host "  '$TaskName' not present, nothing to remove" -ForegroundColor DarkGray
    }

    Write-Host "`nRestoring automatic startup for MySQL services..." -ForegroundColor Cyan

    foreach ($name in $Services) {
        $service = Get-Service -Name $name -ErrorAction SilentlyContinue

        if ($service) {
            Set-Service -Name $name -StartupType Automatic
            Write-Host "  $name -> Automatic" -ForegroundColor Green
        }
    }

    Write-Host "`nUndone. MySQL will no longer start automatically with Windows." -ForegroundColor Cyan
    Write-Host 'XAMPP Control Panel still works as before.' -ForegroundColor DarkGray
    exit 0
}

# --------------------------------------------------------- stop the conflicts

Write-Host "`n1/3  Stopping the unused MySQL services from starting automatically..." -ForegroundColor Cyan

foreach ($name in $Services) {
    $service = Get-Service -Name $name -ErrorAction SilentlyContinue

    if (-not $service) {
        Write-Host "  $name not installed, skipping" -ForegroundColor DarkGray
        continue
    }

    if ($service.Status -eq 'Running') {
        Write-Host "  $name is running; stopping it to free port 3306" -ForegroundColor Yellow
        Stop-Service -Name $name -Force
    }

    Set-Service -Name $name -StartupType Manual
    Write-Host "  $name -> Manual" -ForegroundColor Green
}

# -------------------------------------------------------------- create the task

Write-Host "`n2/3  Creating the logon task for XAMPP's MySQL..." -ForegroundColor Cyan

$action = New-ScheduledTaskAction -Execute $MySqlExe -Argument "--defaults-file=`"$MySqlIni`""

# Run as the interactive user, not as LocalSystem: MySQL does not recommend
# running as LocalSystem, and the datadir files belong to this account.
$principalSettings = New-ScheduledTaskPrincipal `
    -UserId $identity.Name `
    -LogonType Interactive `
    -RunLevel Limited

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principalSettings `
    -Settings $settings `
    -Description 'Starts the XAMPP MySQL server that the EventEase project uses (port 3306).' `
    -Force | Out-Null

Write-Host "  created '$TaskName'" -ForegroundColor Green

# ------------------------------------------------------------------- start now

Write-Host "`n3/3  Starting MySQL and verifying..." -ForegroundColor Cyan

$running = Get-Process -Name mysqld -ErrorAction SilentlyContinue

if ($running) {
    Write-Host "  mysqld already running (PID $($running.Id -join ', '))" -ForegroundColor DarkGray
} else {
    Start-Process -FilePath $MySqlExe -ArgumentList "--defaults-file=`"$MySqlIni`"" -WindowStyle Hidden

    # Wait for the port rather than assuming it came up instantly.
    $ready = $false
    foreach ($attempt in 1..20) {
        Start-Sleep -Seconds 1
        if (Test-NetConnection -ComputerName 127.0.0.1 -Port 3306 -InformationLevel Quiet -WarningAction SilentlyContinue) {
            $ready = $true
            break
        }
    }

    if ($ready) {
        Write-Host '  port 3306 is accepting connections' -ForegroundColor Green
    } else {
        Write-Host '  MySQL did not open port 3306 in time. Check the XAMPP error log.' -ForegroundColor Red
        exit 1
    }
}

Write-Host "`nDone." -ForegroundColor Cyan
Write-Host 'MySQL now starts automatically when you log in, as you, using the XAMPP data directory.' -ForegroundColor Green
Write-Host 'MySQL80 and MySQL267 will no longer take port 3306 at boot.' -ForegroundColor Green
Write-Host ''
Write-Host 'To undo, run:  .\setup-mysql-autostart.ps1 -Remove' -ForegroundColor DarkGray

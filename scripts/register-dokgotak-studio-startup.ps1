$ErrorActionPreference = "Stop"

$TaskName = "Dokgotak Studio Local Server"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$StartScript = Join-Path $PSScriptRoot "start-dokgotak-studio.ps1"

$Action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`"" `
  -WorkingDirectory $ProjectRoot

$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Description "Start Dokgotak Studio local server at Windows logon." `
  -Force | Out-Null

$IsServerRunning = Get-NetTCPConnection `
  -LocalPort 3000 `
  -State Listen `
  -ErrorAction SilentlyContinue

if (-not $IsServerRunning) {
  Start-ScheduledTask -TaskName $TaskName
}

Write-Host "Dokgotak Studio startup task registered."
Write-Host "Local address: http://localhost:3000/"

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$StartScript = Join-Path $PSScriptRoot "start-dokgotak-studio.ps1"
$StartupFolder = [Environment]::GetFolderPath("Startup")
$LauncherPath = Join-Path $StartupFolder "Dokgotak Studio Local Server.vbs"

$EscapedStartScript = $StartScript.Replace('"', '""')
$Launcher = @"
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""$EscapedStartScript""", 0, False
"@

Set-Content -LiteralPath $LauncherPath -Value $Launcher -Encoding ASCII

Write-Host "Dokgotak Studio startup launcher installed."
Write-Host $LauncherPath
Write-Host "Local address: http://localhost:3000/"

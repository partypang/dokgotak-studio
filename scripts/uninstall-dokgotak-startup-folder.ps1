$ErrorActionPreference = "Stop"

$StartupFolder = [Environment]::GetFolderPath("Startup")
$LauncherPath = Join-Path $StartupFolder "Dokgotak Studio Local Server.vbs"

if (Test-Path -LiteralPath $LauncherPath) {
  Remove-Item -LiteralPath $LauncherPath -Force
  Write-Host "Dokgotak Studio startup launcher removed."
} else {
  Write-Host "Dokgotak Studio startup launcher was not installed."
}

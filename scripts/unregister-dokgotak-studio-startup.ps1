$ErrorActionPreference = "Stop"

$TaskName = "Dokgotak Studio Local Server"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Dokgotak Studio startup task removed."
} else {
  Write-Host "Dokgotak Studio startup task was not registered."
}

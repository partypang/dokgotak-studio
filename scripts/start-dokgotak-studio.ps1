$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$LocalConfigRoot = Join-Path $ProjectRoot ".dokgotak-local\xdg.config"
New-Item -ItemType Directory -Force -Path $LocalConfigRoot | Out-Null

$env:BROWSER = "none"
$env:XDG_CONFIG_HOME = $LocalConfigRoot
$env:DOKGOTAK_STUDIO_DATA_DIR = Join-Path $ProjectRoot ".dokgotak-local"

$NpmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
& $NpmCommand run dev:raw

param([switch]$ImportImages,[ValidateSet('daily','full')][string]$Profile='daily')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'local-http.ps1')
Set-Location (Split-Path -Parent $PSScriptRoot)
# Normal restarts reuse installed images. Request an import after rebuilding,
# or let first-time setup import when no deployment has been rendered yet.
$taskImport=$ImportImages -or !(Test-Path 'infra/k8s/local/generated/resources.json')
./scripts/kubernetes-up.ps1 -Profile $Profile -SkipImageImport:(!$taskImport)
foreach($taskPath in @('/','/platform/health/core','/platform/health/capture','/platform/health/rates','/platform/health/analytics','/platform/health/notifications')){
  $taskReady=$false
  for($taskAttempt=0;$taskAttempt -lt 15;$taskAttempt++){
    try {
      Invoke-WebRequest @taskHttpOptions -Uri ('http://127.0.0.1:30080'+$taskPath) -TimeoutSec 5 | Out-Null
      $taskReady=$true
      break
    } catch { Start-Sleep -Seconds 2 }
  }
  if(!$taskReady){throw "Startup is incomplete: $taskPath is not reachable through the browser endpoint."}
}
Write-Output 'Ledgerline ready: http://localhost:30080. Use this script after restarting Docker Desktop; do not start the whole Compose group.'

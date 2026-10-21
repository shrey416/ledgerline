$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if(Test-Path infra/k8s/local/generated/forwards.json){
  foreach($taskForward in @(Get-Content infra/k8s/local/generated/forwards.json -Raw | ConvertFrom-Json)){
    $taskProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$($taskForward.pid)"
    if($taskProcess.Name -eq 'kubectl.exe' -and $taskProcess.CommandLine -match 'port-forward' -and $taskProcess.CommandLine -match 'ledgerline-local'){Stop-Process -Id $taskForward.pid -ErrorAction SilentlyContinue}
  }
}
kubectl --context docker-desktop -n ledgerline-local scale deployment --all --replicas=0
if($LASTEXITCODE -ne 0){throw 'Could not stop the local application deployments'}
kubectl --context docker-desktop -n ledgerline-local delete daemonset fluent-bit --ignore-not-found
if($LASTEXITCODE -ne 0){throw 'Could not stop the local log agent'}
python scripts/select-monitoring-targets.py compose
Write-Output 'Kubernetes workloads stopped; data is preserved. Run ./scripts/local-up.ps1 -NoBuild.'


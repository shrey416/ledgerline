param([switch]$SkipBuild)
$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if(!$SkipBuild){
  npm run build
  if($LASTEXITCODE -ne 0){throw 'Frontend build failed.'}
  ./scripts/package-cached-runtime.ps1 -SkipCompile -Services web,notifications
}
$taskProfile=if(Test-Path infra/local/runtime-profile.json){(Get-Content infra/local/runtime-profile.json | ConvertFrom-Json).profile}else{'daily'}
$taskCompose=@('--env-file','infra/local/.env','-f','compose.yaml')
if($taskProfile -eq 'daily'){$taskCompose+=@('-f','compose.daily.yaml')}
docker compose @taskCompose up -d --no-deps keycloak blackbox grafana
if($LASTEXITCODE -ne 0){throw 'Identity/exporter update failed.'}
./scripts/refresh-local-endpoints.ps1
python scripts/render-local-kubernetes.py $taskProfile
if($LASTEXITCODE -ne 0){throw 'Local manifest render failed.'}
# Apply only the gateway configuration and tracing profile. No finance data is changed.
$taskRendered=Get-Content infra/k8s/local/generated/resources.json -Raw | ConvertFrom-Json
$taskResources=@($taskRendered.items | Where-Object {($_.kind -eq 'ConfigMap' -and $_.metadata.name -eq 'gateway') -or ($_.kind -eq 'Secret' -and $_.metadata.name -eq 'core-finance')})
if($taskResources.Count -ne 2){throw 'Expected gateway/tracing resources were not rendered.'}
$taskUpdate='infra/k8s/local/generated/ui-polish-update.json'
@{apiVersion='v1';kind='List';items=$taskResources} | ConvertTo-Json -Depth 30 | Set-Content $taskUpdate -Encoding utf8
kubectl --context docker-desktop -n ledgerline-local apply -f $taskUpdate
if($LASTEXITCODE -ne 0){throw 'Gateway/tracing configuration apply failed.'}
kubectl --context docker-desktop -n ledgerline-local rollout restart deployment/gateway deployment/core-finance
if($LASTEXITCODE -ne 0){throw 'Gateway/tracing restart failed.'}
python scripts/select-monitoring-targets.py kubernetes $taskProfile
Invoke-RestMethod -NoProxy -Method Post http://localhost:9090/-/reload | Out-Null
./scripts/deploy-workbench.ps1 -SkipBuild -Services web,notifications
foreach($taskService in @('gateway','core-finance')){
  kubectl --context docker-desktop -n ledgerline-local rollout status "deployment/$taskService" --timeout=180s
  if($LASTEXITCODE -ne 0){throw "Rollout failed: $taskService"}
}
./scripts/kubernetes-forward.ps1
Write-Output 'UI, SMTP timeout and monitoring fixes deployed. http://localhost:30080'

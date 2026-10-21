param([switch]$SkipBuild,[ValidateSet('core-finance','web','notifications')][string[]]$Services=@('core-finance','web'))
$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if(!$SkipBuild){
  docker compose --env-file infra/local/.env build @Services
  if($LASTEXITCODE -ne 0){throw 'Account application build failed.'}
}
# Refresh identity theme mounts without restarting domain services or databases.
$taskCompose=@('--env-file','infra/local/.env','-f','compose.yaml')
if((Test-Path 'infra/local/runtime-profile.json') -and (Get-Content infra/local/runtime-profile.json | ConvertFrom-Json).profile -eq 'daily'){$taskCompose+=@('-f','compose.daily.yaml')}
docker compose @taskCompose up -d --no-deps keycloak
if($LASTEXITCODE -ne 0){throw 'Identity service update failed.'}
$taskNode=(kubectl --context docker-desktop --request-timeout=30s get nodes -o json | ConvertFrom-Json).items[0].metadata.name
if(!$taskNode){throw 'Docker Desktop Kubernetes node unavailable.'}
./scripts/refresh-local-endpoints.ps1
$taskGenerated='infra/k8s/local/generated'
New-Item -ItemType Directory -Force $taskGenerated | Out-Null
$taskKeycloakID=docker compose --env-file infra/local/.env ps -q keycloak
$taskKeycloakIP=(docker inspect $taskKeycloakID | ConvertFrom-Json)[0].NetworkSettings.Networks.'ledgerline-local'.IPAddress
if(!$taskKeycloakIP){throw 'Identity service network address is unavailable.'}
$taskEndpoint=Join-Path $taskGenerated 'identity-endpoint.json'
@{apiVersion='discovery.k8s.io/v1';kind='EndpointSlice';metadata=@{name='keycloak';namespace='ledgerline-local';labels=@{'kubernetes.io/service-name'='keycloak';'endpointslice.kubernetes.io/managed-by'='ledgerline-local-renderer'}};addressType='IPv4';ports=@(@{name='p8080';port=8080;protocol='TCP'});endpoints=@(@{addresses=@($taskKeycloakIP);conditions=@{ready=$true}})} | ConvertTo-Json -Depth 8 | Set-Content $taskEndpoint
kubectl --context docker-desktop --request-timeout=30s apply -f $taskEndpoint
if($LASTEXITCODE -ne 0){throw 'Identity endpoint refresh failed.'}
$taskArchive=Join-Path $taskGenerated 'workbench-images.tar'
$taskImages=@($Services | ForEach-Object {"ledgerline/${_}:dev"})
docker save --platform linux/amd64 -o $taskArchive @taskImages
if($LASTEXITCODE -ne 0){throw 'Image export failed.'}
docker cp $taskArchive "${taskNode}:/var/ledgerline-workbench-images.tar"
if($LASTEXITCODE -ne 0){throw 'Image transfer failed.'}
docker exec $taskNode ctr -n k8s.io images import /var/ledgerline-workbench-images.tar
if($LASTEXITCODE -ne 0){throw 'Image import failed.'}
$taskWebApplied=$false
if($Services -contains 'web' -and (Test-Path (Join-Path $taskGenerated 'resources.json'))){
  $taskRendered=Get-Content (Join-Path $taskGenerated 'resources.json') -Raw | ConvertFrom-Json
  $taskWebResources=@($taskRendered.items | Where-Object {($_.kind -eq 'ConfigMap' -and $_.metadata.name -eq 'web-runtime') -or ($_.kind -eq 'Deployment' -and $_.metadata.name -eq 'web')})
  if($taskWebResources.Count -eq 2){
    $taskWebDeployment=$taskWebResources | Where-Object {$_.kind -eq 'Deployment'}
    $taskWebDeployment.spec.template.metadata | Add-Member -NotePropertyName annotations -NotePropertyValue @{'ledgerline.io/reload'=[DateTimeOffset]::UtcNow.ToString('o')} -Force
    $taskWebManifest=Join-Path $taskGenerated 'web-runtime-update.json'
    @{apiVersion='v1';kind='List';items=$taskWebResources} | ConvertTo-Json -Depth 40 | Set-Content $taskWebManifest -Encoding utf8
    kubectl --context docker-desktop --request-timeout=30s apply -f $taskWebManifest
    if($LASTEXITCODE -ne 0){throw 'Web runtime configuration apply failed.'}
    $taskWebApplied=$true
  }
}
foreach($taskService in $Services){
  if($taskService -ne 'web' -or !$taskWebApplied){kubectl --context docker-desktop --request-timeout=30s -n ledgerline-local rollout restart "deployment/$taskService"}
  if($LASTEXITCODE -ne 0){throw "Restart failed: $taskService"}
  kubectl --context docker-desktop --request-timeout=30s -n ledgerline-local rollout status "deployment/$taskService" --timeout=300s
  if($LASTEXITCODE -ne 0){throw "Rollout failed: $taskService. See pod events; do not restart unrelated services."}
}
$taskReady=$false
for($taskAttempt=0;$taskAttempt -lt 12;$taskAttempt++){
  try{Invoke-RestMethod -NoProxy 'http://127.0.0.1:8180/realms/ledgerline/.well-known/openid-configuration' -TimeoutSec 5 | Out-Null;$taskReady=$true;break}catch{Start-Sleep -Seconds 5}
}
if(!$taskReady){throw 'Identity startup has not completed. Run configure-local-auth.ps1 once it is ready.'}
./scripts/configure-local-auth.ps1
./scripts/kubernetes-forward.ps1
Write-Output 'Account workbench deployed: http://localhost:30080. SMTP settings were preserved.'

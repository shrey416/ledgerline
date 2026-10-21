param([ValidateSet('daily','full','stop')][string]$Profile='daily',[switch]$InfrastructureOnly)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'local-http.ps1')
Set-Location (Split-Path -Parent $PSScriptRoot)
$taskCompose=@('--env-file','infra/local/.env','-f','compose.yaml')
if(!(Test-Path 'infra/local/.env')){throw 'Initialize local secrets with scripts/local-up.ps1 first.'}
# Only project resources are touched. Preserve all volumes and user data.
$taskContexts=kubectl config get-contexts -o name 2>$null
if(!$InfrastructureOnly -and $taskContexts -contains 'docker-desktop'){
  $taskDeployments=kubectl --context docker-desktop --request-timeout=15s -n ledgerline-local get deployment -o name
  if($LASTEXITCODE -ne 0){throw 'Could not inspect Ledgerline pods. Resolve cluster access before running Compose.'}
  if($taskDeployments){
    kubectl --context docker-desktop --request-timeout=15s -n ledgerline-local scale deployment --all --replicas=0
    if($LASTEXITCODE -ne 0){throw 'Could not stop duplicate Ledgerline pods.'}
  }
  $taskLogAgent=kubectl --context docker-desktop --request-timeout=15s -n ledgerline-local get daemonset fluent-bit --ignore-not-found -o name
  if($taskLogAgent){kubectl --context docker-desktop --request-timeout=15s -n ledgerline-local patch daemonset fluent-bit --type merge -p '{"spec":{"template":{"spec":{"nodeSelector":{"ledgerline-runtime":"paused"}}}}}'}
}
if($Profile -eq 'stop'){
  docker compose @taskCompose stop
  if($LASTEXITCODE -ne 0){throw 'Ledgerline stop failed.'}
  Write-Output 'Ledgerline stopped. Database volumes are retained.'
  exit
}
if($InfrastructureOnly){
  # Kubernetes owns the application. Do not briefly start a second copy of
  # every domain service before stopping it again during cluster startup.
  docker compose @taskCompose stop core-finance capture-automation rates-realtime analytics notifications gateway web
  if($LASTEXITCODE -ne 0){throw 'Could not stop duplicate Compose application containers.'}
}
if($Profile -eq 'daily'){
  docker compose @taskCompose stop elasticsearch kibana logstash tempo connect object-storage
  if($LASTEXITCODE -ne 0){throw 'Could not pause the heavy observability tools.'}
  $taskCompose+=@('-f','compose.daily.yaml')
}
python scripts/select-monitoring-targets.py compose $Profile
if($LASTEXITCODE -ne 0){throw 'Monitoring target update failed.'}
$taskInfrastructure=@('postgres','mongodb','redis','clickhouse','cassandra','kafka','keycloak','mailpit')
Write-Output 'Starting databases and authentication before monitoring to reduce cold-start contention...'
docker compose @taskCompose up -d --no-deps @taskInfrastructure
if($LASTEXITCODE -ne 0){throw 'Infrastructure startup failed.'}
docker compose @taskCompose up -d mongo-init
if($LASTEXITCODE -ne 0){throw 'Mongo replica-set initialization failed.'}
$taskMonitoring=@('prometheus','grafana','alertmanager','blackbox','postgres-exporter','redis-exporter','cadvisor','otel-collector')
if($Profile -eq 'full'){$taskMonitoring+=@('elasticsearch','logstash','kibana','tempo','connect','object-storage')}
docker compose @taskCompose up -d --no-deps @taskMonitoring
if($LASTEXITCODE -ne 0){throw 'Monitoring startup failed.'}
@{profile=$Profile} | ConvertTo-Json | Set-Content infra/local/runtime-public.json
if(!$InfrastructureOnly){
  docker compose @taskCompose up -d --no-deps core-finance capture-automation rates-realtime analytics notifications gateway web
  if($LASTEXITCODE -ne 0){throw 'Application startup failed.'}
}
Set-Content .env.local ('LEDGERLINE_GATEWAY_URL=http://127.0.0.1:'+$(if($Profile -eq 'daily'){'30088'}else{'8088'}))
$taskReady=$false
for($taskAttempt=0;$taskAttempt -lt 12;$taskAttempt++){
  try{Invoke-RestMethod @taskHttpOptions 'http://127.0.0.1:8180/realms/ledgerline/.well-known/openid-configuration' -TimeoutSec 3 | Out-Null;$taskReady=$true;break}catch{Start-Sleep -Seconds 3}
}
if($taskReady){./scripts/configure-local-auth.ps1}
else{Write-Warning 'Keycloak is still starting. Run scripts/configure-local-auth.ps1 when ready.'}
@{profile=$Profile} | ConvertTo-Json | Set-Content infra/local/runtime-profile.json
if($InfrastructureOnly){Write-Output "Ledgerline $Profile infrastructure started; continuing Kubernetes application startup."}
else{Write-Output "Ledgerline $Profile profile started. App: $(if($Profile -eq 'daily'){'http://localhost:30080'}else{'http://localhost:8080'}). Grafana: http://localhost:3000."}

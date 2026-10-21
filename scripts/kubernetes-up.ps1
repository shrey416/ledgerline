param([switch]$SkipImageImport,[ValidateSet('daily','full')][string]$Profile='daily')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'local-http.ps1')
$taskRoot=Split-Path -Parent $PSScriptRoot
Set-Location $taskRoot
$taskEnv=Join-Path $taskRoot 'infra/local/.env'
if(!(Test-Path $taskEnv)){throw 'Start ./scripts/local-up.ps1 first.'}
./scripts/runtime-profile.ps1 -Profile $Profile -InfrastructureOnly
$taskContext='docker-desktop'
$taskNodes=kubectl --context $taskContext get nodes -o json | ConvertFrom-Json
if($LASTEXITCODE -ne 0){throw 'Docker Desktop Kubernetes is unavailable.'}
$taskNode=$taskNodes.items[0].metadata.name
# Docker Desktop kind provisioner: infrastructure runs once, shared with application pods.
$taskInspection=docker inspect $taskNode | ConvertFrom-Json
if($LASTEXITCODE -ne 0){throw 'This local script requires Docker Desktop kind provisioning. See docs/observability.md.'}
if(!$taskInspection[0].NetworkSettings.Networks.'ledgerline-local'){
  docker network connect ledgerline-local $taskNode
  if($LASTEXITCODE -ne 0){throw 'Could not connect the local cluster node to the project network.'}
}
$taskInspection=docker inspect $taskNode | ConvertFrom-Json
$taskNodeIP=$taskInspection[0].NetworkSettings.Networks.'ledgerline-local'.IPAddress
$taskNetwork=@{node=$taskNode;nodeIP=$taskNodeIP;infrastructure=@{}}
$taskInfrastructure=@('postgres','mongodb','redis','clickhouse','cassandra','kafka','keycloak','otel-collector','mailpit')
if($Profile -eq 'full'){$taskInfrastructure+=@('logstash')}
foreach($taskService in $taskInfrastructure){
  $taskID=docker compose --env-file $taskEnv ps -q $taskService
  if(!$taskID){throw "Missing infrastructure container $taskService"}
  $taskContainer=docker inspect $taskID | ConvertFrom-Json
  $taskNetwork.infrastructure[$taskService]=$taskContainer[0].NetworkSettings.Networks.'ledgerline-local'.IPAddress
}
$taskGenerated=Join-Path $taskRoot 'infra/k8s/local/generated'
New-Item -ItemType Directory -Force $taskGenerated | Out-Null
$taskNetwork | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $taskGenerated 'network.json') -Encoding utf8
if(!$SkipImageImport){
  $taskImages=@('ledgerline/core-finance:dev','ledgerline/capture-automation:dev','ledgerline/rates-realtime:dev','ledgerline/analytics:dev','ledgerline/notifications:dev','ledgerline/web:dev','envoyproxy/envoy:v1.33-latest','otel/opentelemetry-collector-contrib:0.127.0')
  $taskArchive=Join-Path $taskGenerated 'images.tar'
  docker save --platform linux/amd64 -o $taskArchive @taskImages
  if($LASTEXITCODE -ne 0){throw 'Image export failed.'}
  docker cp $taskArchive "${taskNode}:/var/ledgerline-images.tar"
  if($LASTEXITCODE -ne 0){throw 'Image transfer failed.'}
  docker exec $taskNode ctr -n k8s.io images import /var/ledgerline-images.tar
  if($LASTEXITCODE -ne 0){throw 'Kubernetes image import failed.'}
}
python scripts/render-local-kubernetes.py $Profile
if($LASTEXITCODE -ne 0){throw 'Manifest rendering failed.'}
# runtime-profile already stopped duplicate Compose application containers.
kubectl --context $taskContext apply -f (Join-Path $taskGenerated 'resources.json')
if($LASTEXITCODE -ne 0){throw 'Kubernetes apply failed.'}
if(!$SkipImageImport){
  kubectl --context $taskContext -n ledgerline-local rollout restart deployment/core-finance deployment/capture-automation deployment/rates-realtime deployment/analytics deployment/notifications deployment/gateway deployment/web
  if($LASTEXITCODE -ne 0){throw 'Application restart failed.'}
}
foreach($taskService in @('core-finance','capture-automation','rates-realtime','analytics','notifications','gateway','web','kube-state-metrics')){
  kubectl --context $taskContext -n ledgerline-local rollout status "deployment/$taskService" --timeout=180s
  if($LASTEXITCODE -ne 0){throw "Rollout failed: $taskService"}
}
if($Profile -eq 'full'){kubectl --context $taskContext -n ledgerline-local rollout status daemonset/fluent-bit --timeout=180s}
if($LASTEXITCODE -ne 0){throw 'Log collection daemon rollout failed.'}
python scripts/select-monitoring-targets.py kubernetes
if($LASTEXITCODE -ne 0){throw 'Monitoring target update failed.'}
./scripts/kubernetes-forward.ps1
try { Invoke-RestMethod @taskHttpOptions -Method Post 'http://127.0.0.1:9090/-/reload' -TimeoutSec 10 | Out-Null }
catch { Write-Warning 'Prometheus reload failed; application access is available. Check the Prometheus container.' }
Write-Output 'Kubernetes is ready. Open http://localhost:30080; verify with ./scripts/verify-stack.ps1 -Mode kubernetes.'


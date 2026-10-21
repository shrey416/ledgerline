$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$taskPorts=@{postgres=@(5432);mongodb=@(27017);redis=@(6379);clickhouse=@(8123);cassandra=@(9042);kafka=@(9092);keycloak=@(8080);'otel-collector'=@(4317,4318);logstash=@(8080);mailpit=@(1025)}
$taskLogstash=docker compose --env-file infra/local/.env ps -q logstash
if(!$taskLogstash){$taskPorts.Remove('logstash')}
$taskServices=@($taskPorts.Keys)
$taskIds=@(docker compose --env-file infra/local/.env ps -q @taskServices)
if($LASTEXITCODE -ne 0 -or $taskIds.Count -ne $taskServices.Count){throw 'Start the required infrastructure containers before refreshing endpoints.'}
$taskContainers=docker inspect @taskIds | ConvertFrom-Json
if($LASTEXITCODE -ne 0){throw 'Infrastructure inspection failed.'}
$taskResources=@()
$taskGenerated='infra/k8s/local/generated'
New-Item -ItemType Directory -Force $taskGenerated | Out-Null
$taskNetworkPath=Join-Path $taskGenerated 'network.json'
$taskNetwork=if(Test-Path $taskNetworkPath){Get-Content $taskNetworkPath -Raw | ConvertFrom-Json}else{$null}
foreach($taskService in $taskServices){
  $taskContainer=@($taskContainers | Where-Object {$_.Config.Labels.'com.docker.compose.service' -eq $taskService})[0]
  $taskIP=$taskContainer.NetworkSettings.Networks.'ledgerline-local'.IPAddress
  if(!$taskIP){throw "Missing project network address: $taskService"}
  if($taskNetwork){$taskNetwork.infrastructure | Add-Member -NotePropertyName $taskService -NotePropertyValue $taskIP -Force}
  $taskResources+=@{apiVersion='discovery.k8s.io/v1';kind='EndpointSlice';metadata=@{name=$taskService;namespace='ledgerline-local';labels=@{'kubernetes.io/service-name'=$taskService;'endpointslice.kubernetes.io/managed-by'='ledgerline-local-renderer'}};addressType='IPv4';ports=@($taskPorts[$taskService] | ForEach-Object {@{name="p$_";port=$_;protocol='TCP'}});endpoints=@(@{addresses=@($taskIP);conditions=@{ready=$true}})}
}
$taskManifest=Join-Path $taskGenerated 'endpoints.json'
@{apiVersion='v1';kind='List';items=$taskResources} | ConvertTo-Json -Depth 10 | Set-Content $taskManifest -Encoding utf8
kubectl --context docker-desktop --request-timeout=30s apply -f $taskManifest
if($LASTEXITCODE -ne 0){throw 'Endpoint refresh failed.'}
if($taskNetwork){
  $taskNode=docker inspect $taskNetwork.node | ConvertFrom-Json
  if($LASTEXITCODE -ne 0){throw 'Local Kubernetes node inspection failed.'}
  $taskNetwork.nodeIP=$taskNode[0].NetworkSettings.Networks.'ledgerline-local'.IPAddress
  if(!$taskNetwork.nodeIP){throw 'Reconnect the local Kubernetes node with kubernetes-up.ps1.'}
  $taskNetwork | ConvertTo-Json -Depth 8 | Set-Content $taskNetworkPath -Encoding utf8
  # Docker can assign a new cluster-node IP after a restart. Refresh file-based
  # Prometheus discovery only when it is already monitoring the Kubernetes mode.
  $taskMonitoring='observability/prometheus/application-targets.json'
  if(Test-Path $taskMonitoring){
    $taskTargets=Get-Content $taskMonitoring -Raw | ConvertFrom-Json
    if(@($taskTargets | Where-Object {$_.labels.environment -eq 'kubernetes'}).Count){
      python scripts/select-monitoring-targets.py kubernetes
      if($LASTEXITCODE -ne 0){throw 'Monitoring discovery refresh failed.'}
    }
  }
}
Write-Output 'Refreshed infrastructure endpoints after Docker network changes. No application deployments or secrets were changed.'

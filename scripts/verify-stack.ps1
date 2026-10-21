param([ValidateSet('compose','kubernetes')][string]$Mode='compose')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
Set-Location $taskRoot
$taskBase=if($Mode -eq 'kubernetes'){'http://127.0.0.1:30080'}else{'http://127.0.0.1:8080'}
$taskEvidence=@{mode=$Mode;checkedAt=(Get-Date).ToUniversalTime().ToString('o');services=@();dashboards=@()}
foreach($taskService in @('core','capture','rates','analytics','notifications')){
  $taskResult=$null
  for($taskAttempt=0;$taskAttempt -lt 5;$taskAttempt++){
    try{$taskResult=Invoke-RestMethod -NoProxy "$taskBase/platform/health/$taskService" -TimeoutSec 10;break}
    catch{if($taskAttempt -eq 4){throw};Start-Sleep -Seconds 3}
  }
  if($taskResult.status -notin @('up','UP')){throw "Readiness failed: $taskService"}
  $taskEvidence.services+=@{name=$taskService;status=$taskResult.status}
  Write-Output "READY $taskService"
}
$taskHtml=Invoke-WebRequest -NoProxy $taskBase -TimeoutSec 10
if($taskHtml.StatusCode -ne 200 -or $taskHtml.Content -notmatch 'root'){throw 'Frontend unavailable'}
$taskMetrics=Invoke-RestMethod -NoProxy 'http://127.0.0.1:9090/api/v1/query?query=sum(up%7Bjob%3D%22ledgerline-services%22%7D)'
if([double]$taskMetrics.data.result[0].value[1] -ne 5){throw 'Prometheus must scrape all five services. Allow 15 seconds after a rollout.'}
$taskEvidence.scrapedServices=5
$taskResources=Invoke-RestMethod -NoProxy 'http://127.0.0.1:9090/api/v1/query?query=count(container_memory_working_set_bytes%7Bname!%3D%22%22%7D)'
if(!$taskResources.data.result -or [double]$taskResources.data.result[0].value[1] -lt 5){throw 'Real container resource series are missing.'}
$taskEvidence.resourceContainers=[int]$taskResources.data.result[0].value[1]
$taskHealth=Invoke-RestMethod -NoProxy 'http://127.0.0.1:9090/api/v1/query?query=sum(probe_success%7Bjob%3D%22service-readiness%22%7D)'
if([double]$taskHealth.data.result[0].value[1] -ne 5){throw 'Readiness probes are not all healthy.'}
$taskDashboards=Invoke-RestMethod -NoProxy 'http://127.0.0.1:3000/api/search?tag=ledgerline'
if($taskDashboards.Count -lt 7){throw 'Expected seven provisioned Grafana dashboards'}
$taskEvidence.dashboards=@($taskDashboards | ForEach-Object {$_.title})
$taskLogs=Invoke-RestMethod -NoProxy 'http://127.0.0.1:9200/ledgerline-logs-*/_count'
if($taskLogs.count -lt 1){throw 'No application logs indexed'}
$taskEvidence.indexedLogs=$taskLogs.count
$taskTrace=Invoke-RestMethod -NoProxy 'http://127.0.0.1:3200/api/search?limit=100'
if($taskTrace.traces.Count -lt 1){throw 'No exported traces found'}
$taskEvidence.recentTraces=$taskTrace.traces.Count
$taskKibana=Invoke-RestMethod -NoProxy 'http://127.0.0.1:5601/api/saved_objects/dashboard/ledgerline-logs'
if($taskKibana.id -ne 'ledgerline-logs'){throw 'Kibana dashboard missing'}
if($Mode -eq 'kubernetes'){
  $taskLogBody=@{query=@{term=@{'kubernetes.namespace_name.keyword'='ledgerline-local'}}} | ConvertTo-Json -Depth 5
  $taskPodLogs=Invoke-RestMethod -NoProxy -Method Post 'http://127.0.0.1:9200/ledgerline-logs-*/_count' -ContentType 'application/json' -Body $taskLogBody
  if($taskPodLogs.count -lt 1){throw 'No Kubernetes-tagged logs indexed.'}
  $taskEvidence.kubernetesLogs=$taskPodLogs.count
  foreach($taskName in @('core-finance','capture-automation','rates-realtime','analytics','notifications')){
    $taskFilter=@{query=@{bool=@{filter=@(@{term=@{'kubernetes.namespace_name.keyword'='ledgerline-local'}},@{term=@{service_name=$taskName}})}}} | ConvertTo-Json -Depth 8
    $taskServiceLogs=Invoke-RestMethod -NoProxy -Method Post 'http://127.0.0.1:9200/ledgerline-logs-*/_count' -ContentType 'application/json' -Body $taskFilter
    if($taskServiceLogs.count -lt 1){throw "No Kubernetes application logs for $taskName"}
  }
  $taskPods=kubectl --context docker-desktop -n ledgerline-local get pods -o json | ConvertFrom-Json
  $taskEvidence.pods=@($taskPods.items | ForEach-Object {@{name=$_.metadata.name;ready=@($_.status.containerStatuses | Where-Object ready).Count;containers=$_.spec.containers.Count}})
  foreach($taskPod in $taskEvidence.pods){if($taskPod.ready -ne $taskPod.containers){throw "Pod not fully ready: $($taskPod.name)"}}
}
$taskEvidence | ConvertTo-Json -Depth 8 | Set-Content 'implementation/runtime-evidence.json' -Encoding utf8
Write-Output "VERIFIED $Mode | 5 service metrics | $($taskEvidence.dashboards.Count) dashboards | $($taskEvidence.indexedLogs) logs | $($taskEvidence.recentTraces) recent traces"


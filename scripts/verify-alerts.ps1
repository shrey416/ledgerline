param([ValidateSet('compose','kubernetes')][string]$Mode='compose')
$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$taskInitial=Invoke-RestMethod -NoProxy 'http://127.0.0.1:8025/api/v1/messages'
$taskInitialIds=@($taskInitial.messages | ForEach-Object {$_.ID})
try {
  if($Mode -eq 'kubernetes'){kubectl --context docker-desktop -n ledgerline-local scale deployment rates-realtime --replicas=0}
  else {docker compose --env-file infra/local/.env stop rates-realtime}
  if($LASTEXITCODE -ne 0){throw 'Could not start the local failure drill'}
  $taskFired=$false;$taskEmail=$false
  for($taskAttempt=0;$taskAttempt -lt 60;$taskAttempt++){
    $taskAlerts=Invoke-RestMethod -NoProxy 'http://127.0.0.1:9090/api/v1/alerts'
    $taskFired=@($taskAlerts.data.alerts | Where-Object {$_.labels.service -eq 'rates-realtime' -and $_.state -eq 'firing'}).Count -gt 0
    $taskInbox=Invoke-RestMethod -NoProxy 'http://127.0.0.1:8025/api/v1/messages'
    $taskEmail=@($taskInbox.messages | Where-Object {$_.ID -notin $taskInitialIds -and $_.Subject -match 'FIRING' -and $_.Subject -match 'rates-realtime'}).Count -gt 0
    if($taskFired -and $taskEmail){break}
    Start-Sleep -Seconds 3
  }
  if(!$taskFired -or !$taskEmail){throw 'Failure drill did not produce both a firing alert and captured email'}
  Write-Output 'VERIFIED actual service failure -> firing Prometheus alert -> Alertmanager -> Mailpit email.'
} finally {
  if($Mode -eq 'kubernetes'){
    kubectl --context docker-desktop -n ledgerline-local scale deployment rates-realtime --replicas=1
    kubectl --context docker-desktop -n ledgerline-local rollout status deployment/rates-realtime --timeout=120s
  } else {docker compose --env-file infra/local/.env start rates-realtime}
  if($LASTEXITCODE -ne 0){Write-Error 'The rates service needs manual restoration.'}
}


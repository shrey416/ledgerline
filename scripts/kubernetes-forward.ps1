$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$taskGenerated=Join-Path (Get-Location) 'infra/k8s/local/generated'
New-Item -ItemType Directory -Force $taskGenerated | Out-Null
$taskForwards=@()
if(Test-Path (Join-Path $taskGenerated 'forwards.json')){
  $taskSavedForwards=Get-Content (Join-Path $taskGenerated 'forwards.json') -Raw | ConvertFrom-Json
  $taskForwards=@($taskSavedForwards | Where-Object {$_.service -in @('web','gateway') -and $_.pid})
}
foreach($taskForward in @(@{service='web';port=30080},@{service='gateway';port=30088})){
  $taskListening=Get-NetTCPConnection -State Listen -LocalPort $taskForward.port -ErrorAction SilentlyContinue
  # A bound forward can still target the pod just replaced by a rollout.
  foreach($taskListenerPID in @($taskListening.OwningProcess | Select-Object -Unique)){
    if(!$taskListenerPID){continue}
    $taskOwner=Get-CimInstance Win32_Process -Filter "ProcessId=$taskListenerPID" -ErrorAction SilentlyContinue
    if($taskOwner.Name -eq 'kubectl.exe' -and $taskOwner.CommandLine -match 'docker-desktop' -and $taskOwner.CommandLine -match 'ledgerline-local' -and $taskOwner.CommandLine -match "port-forward.*service/$($taskForward.service)"){
      Stop-Process -Id $taskListenerPID -Force
      Start-Sleep -Milliseconds 150
      $taskListening=Get-NetTCPConnection -State Listen -LocalPort $taskForward.port -ErrorAction SilentlyContinue
    }
  }
  if($taskListening){Write-Output "Port $($taskForward.port) already has a listener; leaving it in place.";continue}
  $taskProcess=Start-Process -FilePath (Get-Command kubectl).Source -ArgumentList @('--context','docker-desktop','-n','ledgerline-local','port-forward',"service/$($taskForward.service)","$($taskForward.port):8080",'--address','localhost') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskGenerated "$($taskForward.service)-forward.log") -RedirectStandardError (Join-Path $taskGenerated "$($taskForward.service)-forward-error.log")
  $taskForwards=@($taskForwards | Where-Object {$_.service -ne $taskForward.service})
  $taskForwards+=@{pid=$taskProcess.Id;service=$taskForward.service;port=$taskForward.port}
}
if($taskForwards.Count){ConvertTo-Json -InputObject @($taskForwards) -Depth 4 | Set-Content (Join-Path $taskGenerated 'forwards.json')}
Set-Content .env.local 'LEDGERLINE_GATEWAY_URL=http://127.0.0.1:30088'
Write-Output 'Local Kubernetes forwards started: web 30080, development gateway 30088. Re-run after a pod restart if a connection closes.'


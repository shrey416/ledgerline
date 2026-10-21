param([ValidateSet('compose','kubernetes')][string]$Mode='kubernetes')
$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if(!(Test-Path infra/local/email.env)){throw 'Configure infra/local/email.env first.'}
if($Mode -eq 'compose'){
  $taskCompose=@('--env-file','infra/local/.env','-f','compose.yaml')
  if((Test-Path 'infra/local/runtime-profile.json') -and (Get-Content infra/local/runtime-profile.json | ConvertFrom-Json).profile -eq 'daily'){$taskCompose+=@('-f','compose.daily.yaml')}
  docker compose @taskCompose up -d --no-deps --force-recreate notifications
  if($LASTEXITCODE -ne 0){throw 'SMTP settings remain saved; notification recreation failed.'}
}else{
  # Send credentials through a temporary ignored manifest, never CLI arguments or stdout.
  $taskGenerated='infra/k8s/local/generated'
  New-Item -ItemType Directory -Force $taskGenerated | Out-Null
  $taskEmail=@{}
  Get-Content infra/local/email.env | ForEach-Object {if($_ -match '^([A-Z_]+)=(.*)$'){$taskEmail[$Matches[1]]=$Matches[2]}}
  $taskPatch=Join-Path $taskGenerated 'email-patch.json'
  try{
    @{stringData=$taskEmail} | ConvertTo-Json -Depth 4 | Set-Content $taskPatch -Encoding utf8
    kubectl --context docker-desktop --request-timeout=30s -n ledgerline-local patch secret notifications --type merge --patch-file $taskPatch
    if($LASTEXITCODE -ne 0){throw 'SMTP settings remain saved; applying the notification secret failed.'}
  }finally{Remove-Item -LiteralPath $taskPatch -ErrorAction SilentlyContinue}
  kubectl --context docker-desktop --request-timeout=30s -n ledgerline-local rollout restart deployment/notifications
  if($LASTEXITCODE -ne 0){throw 'Notification restart failed. The SMTP file remains saved.'}
  kubectl --context docker-desktop --request-timeout=30s -n ledgerline-local rollout status deployment/notifications --timeout=180s
  if($LASTEXITCODE -ne 0){throw 'Notification rollout failed. Credentials remain saved; inspect pod events and logs without printing the Secret.'}
}
Write-Output 'SMTP settings applied to notifications only. No other application services were restarted.'

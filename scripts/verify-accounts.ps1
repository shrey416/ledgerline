param([string]$Base='http://127.0.0.1:30080')
$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
function Get-AccountToken([string]$Username,[string]$Password){
  $taskClock=[Diagnostics.Stopwatch]::StartNew()
  $taskToken=(Invoke-RestMethod -NoProxy -Method Post 'http://127.0.0.1:8180/realms/ledgerline/protocol/openid-connect/token' -Body @{grant_type='password';client_id='ledgerline-local';username=$Username;password=$Password} -TimeoutSec 30).access_token
  Write-Host "Fixture sign-in: $($taskClock.ElapsedMilliseconds) ms"
  return $taskToken
}
$taskHeaders=@{Authorization="Bearer $(Get-AccountToken 'notification-check' 'local-check-only')"}
$taskOther=@{Authorization="Bearer $(Get-AccountToken 'demo' 'local-demo-only')"}
$taskUrl="$Base/api/v1/core/me/workbench"
$taskClock=[Diagnostics.Stopwatch]::StartNew()
$taskBefore=Invoke-RestMethod -NoProxy $taskUrl -Headers $taskHeaders -TimeoutSec 30
Write-Host "Initial workbench load: $($taskClock.ElapsedMilliseconds) ms"
$taskOtherBefore=Invoke-RestMethod -NoProxy $taskUrl -Headers $taskOther -TimeoutSec 30
$taskName="Account verification $([guid]::NewGuid().ToString('N').Substring(0,8))"
$taskNext=$taskBefore.workspaces | ConvertTo-Json -Depth 15 | ConvertFrom-Json
$taskNext[0].name=$taskName
$taskCommand=@{revision=$taskBefore.revision;requestId=[guid]::NewGuid().ToString();workspaces=@($taskNext)}
$taskSaved=$null
try{
  $taskClock.Restart()
  $taskSaved=Invoke-RestMethod -NoProxy -Method Put $taskUrl -Headers $taskHeaders -ContentType 'application/json' -Body ($taskCommand | ConvertTo-Json -Depth 20) -TimeoutSec 30
  Write-Host "Workbench save: $($taskClock.ElapsedMilliseconds) ms"
  if($taskSaved.revision -ne $taskBefore.revision+1 -or $taskSaved.workspaces[0].name -ne $taskName){throw 'Account save failed.'}
  $taskReplay=Invoke-RestMethod -NoProxy -Method Put $taskUrl -Headers $taskHeaders -ContentType 'application/json' -Body ($taskCommand | ConvertTo-Json -Depth 20) -TimeoutSec 30
  if($taskReplay.revision -ne $taskSaved.revision){throw 'Replay wrote twice.'}
  $taskRead=Invoke-RestMethod -NoProxy $taskUrl -Headers $taskHeaders -TimeoutSec 30
  if($taskRead.workspaces[0].name -ne $taskName){throw 'Reload persistence failed.'}
  $taskOtherAfter=Invoke-RestMethod -NoProxy $taskUrl -Headers $taskOther -TimeoutSec 30
  if($taskOtherAfter.revision -ne $taskOtherBefore.revision -or $taskOtherAfter.workspaces[0].name -eq $taskName){throw 'User isolation failed.'}
  $taskCommand.requestId=[guid]::NewGuid().ToString()
  $taskConflict=Invoke-WebRequest -NoProxy -Method Put $taskUrl -Headers $taskHeaders -ContentType 'application/json' -Body ($taskCommand | ConvertTo-Json -Depth 20) -SkipHttpErrorCheck -TimeoutSec 30
  if($taskConflict.StatusCode -ne 409){throw 'Stale revision was not rejected.'}
  $taskCommand.revision=$taskSaved.revision
  $taskCommand.workspaces[0].transactions=@(@{id='invalid-check';kind='expense';merchant='Check';amount='-1';date='2026-10-08';account='Main account';category='Other';note='';reviewed=$true})
  $taskInvalid=Invoke-WebRequest -NoProxy -Method Put $taskUrl -Headers $taskHeaders -ContentType 'application/json' -Body ($taskCommand | ConvertTo-Json -Depth 20) -SkipHttpErrorCheck -TimeoutSec 30
  if($taskInvalid.StatusCode -ne 422){throw 'Invalid finance data accepted.'}
  $taskAnonymous=Invoke-WebRequest -NoProxy $taskUrl -SkipHttpErrorCheck -TimeoutSec 30
  if($taskAnonymous.StatusCode -ne 401){throw 'Anonymous data access was accepted.'}
  Write-Output 'PASS: account save, reload, idempotent replay, two-user isolation, stale-write rejection, validation and anonymous rejection.'
}finally{
  if($taskSaved){
    Invoke-RestMethod -NoProxy -Method Put $taskUrl -Headers $taskHeaders -ContentType 'application/json' -Body (@{revision=$taskSaved.revision;requestId=[guid]::NewGuid().ToString();workspaces=$taskBefore.workspaces} | ConvertTo-Json -Depth 20) -TimeoutSec 30 | Out-Null
  }
}

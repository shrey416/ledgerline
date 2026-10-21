param([ValidateSet('compose','kubernetes')][string]$Mode='compose',[string]$BaseUrl='')
$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$taskBase=if($BaseUrl){$BaseUrl}elseif($Mode -eq 'kubernetes'){'http://127.0.0.1:30080'}else{'http://127.0.0.1:8080'}
# Isolated local fixture account: never changes the normal demo user's preferences.
$taskToken=Invoke-RestMethod -NoProxy -Method Post 'http://127.0.0.1:8180/realms/ledgerline/protocol/openid-connect/token' -Body @{grant_type='password';client_id='ledgerline-local';username='notification-check';password='local-check-only'} -TimeoutSec 30
$taskHeaders=@{Authorization="Bearer $($taskToken.access_token)"}
$taskURL="$taskBase/api/v1/notifications/workspaces/personal"
function Send-Check($path,$method,$body){Invoke-RestMethod -NoProxy -Uri ($taskURL+$path) -Method $method -Headers $taskHeaders -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 10) -TimeoutSec 30}
$taskInitial=Invoke-RestMethod -NoProxy $taskURL -Headers $taskHeaders -TimeoutSec 30
if($taskInitial.emailMode -ne 'local-inbox'){throw 'This verifier must only run against local Mailpit delivery.'}
$taskNonce=[guid]::NewGuid().ToString('N')
$taskEmail="check-$taskNonce@example.test"
$taskPrefs=@{email=$taskEmail;enabled=$true;leadDays=3;timezone='UTC'}
Send-Check '/preferences' Put $taskPrefs | Out-Null
Send-Check '/verification' Post @{} | Out-Null
$taskVerification=$null
for($taskAttempt=0;$taskAttempt -lt 10;$taskAttempt++){
  $taskMail=Invoke-RestMethod -NoProxy 'http://127.0.0.1:8025/api/v1/messages' -TimeoutSec 30
  $taskVerification=$taskMail.messages | Where-Object {@($_.To | ForEach-Object {$_.Address}) -contains $taskEmail -and $_.Subject -eq 'Verify your Ledgerline reminder email'} | Select-Object -First 1
  if($taskVerification){break};Start-Sleep -Milliseconds 500
}
if(!$taskVerification){throw 'Verification email was not captured.'}
$taskMessage=Invoke-RestMethod -NoProxy "http://127.0.0.1:8025/api/v1/message/$($taskVerification.ID)" -TimeoutSec 30
if($taskMessage.Text -notmatch '\b(\d{6})\b'){throw 'No verification code found.'}
$taskCode=$Matches[1]
try{Send-Check '/verification/confirm' Post @{code='000000'} | Out-Null;throw 'Wrong verification code was accepted.'}catch{if($_.Exception.Response.StatusCode.value__ -ne 400){throw}}
$taskCooldown=Invoke-WebRequest -NoProxy ($taskURL+'/verification') -Method Post -Headers $taskHeaders -ContentType 'application/json' -Body '{}' -SkipHttpErrorCheck
if($taskCooldown.StatusCode -ne 429){throw 'Verification resend cooldown was not enforced.'}
Send-Check '/verification/confirm' Post @{code=$taskCode} | Out-Null
Send-Check '/test' Post @{} | Out-Null
$taskDay=Get-Date -Format 'yyyy-MM-dd'
$taskItem=@{id="check-$taskNonce";name="Runtime renewal $taskNonce";amount='123.45';due=$taskDay;kind='subscription';state='open'}
Send-Check '/commitments' Put @{items=@($taskItem)} | Out-Null
$taskDelivered=$false
for($taskAttempt=0;$taskAttempt -lt 16;$taskAttempt++){
  $taskInbox=Invoke-RestMethod -NoProxy $taskURL -Headers $taskHeaders -TimeoutSec 30
  $taskNotice=$taskInbox.inbox | Where-Object {$_.commitmentId -eq $taskItem.id -and $_.delivery -eq 'sent'} | Select-Object -First 1
  if($taskNotice){$taskDelivered=$true;break}
  Start-Sleep -Seconds 2
}
if(!$taskDelivered){throw 'Scheduled reminder was not delivered.'}
Send-Check "/inbox/$($taskNotice.id)" Patch @{} | Out-Null
Send-Check '/commitments' Put @{items=@($taskItem)} | Out-Null
Start-Sleep -Seconds 17
$taskMail=Invoke-RestMethod -NoProxy 'http://127.0.0.1:8025/api/v1/messages' -TimeoutSec 30
$taskRenewals=@($taskMail.messages | Where-Object {@($_.To | ForEach-Object {$_.Address}) -contains $taskEmail -and $_.Subject -eq "Subscription renewal: $($taskItem.name)"})
if($taskRenewals.Count -ne 1){throw 'Repeated source sync duplicated the renewal email.'}
$taskAnonymous=Invoke-WebRequest -NoProxy $taskURL -SkipHttpErrorCheck -TimeoutSec 30
if($taskAnonymous.StatusCode -ne 401){throw 'Anonymous notification access was not rejected.'}
$taskOther=Invoke-RestMethod -NoProxy -Method Post 'http://127.0.0.1:8180/realms/ledgerline/protocol/openid-connect/token' -Body @{grant_type='password';client_id='ledgerline-local';username='demo';password='local-demo-only'} -TimeoutSec 30
$taskIsolated=Invoke-RestMethod -NoProxy $taskURL -Headers @{Authorization="Bearer $($taskOther.access_token)"} -TimeoutSec 30
if($taskIsolated.inbox.id -contains $taskNotice.id){throw 'Cross-user notification isolation failed.'}
$taskPrefs.enabled=$false
Send-Check '/preferences' Put $taskPrefs | Out-Null
Write-Output 'VERIFIED recipient verification, SMTP test, scheduled renewal, durable inbox/read state, repeat-sync deduplication, anonymous rejection and cross-user isolation. Test emails captured only in Mailpit.'


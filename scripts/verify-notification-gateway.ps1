# Regression: SMTP taking longer than five seconds must still work through Envoy.
# Uses a dedicated fixture account and Mailpit only. Never sends through Gmail.
$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$taskGenerated=Join-Path (Get-Location) 'infra/k8s/local/generated'
$taskBackend='ledgerline-mail-regression'
$taskGateway='ledgerline-mail-gateway-regression'
$taskProxy=Join-Path $taskGenerated 'delayed-smtp.mjs'
$taskEnvoy=Join-Path $taskGenerated 'mail-regression-envoy.yaml'
@'
import net from 'node:net';
net.createServer(client => {
  const upstream=net.connect(1025,process.env.SMTP_TEST_UPSTREAM);
  client.pipe(upstream);
  upstream.once('data', greeting => {
    upstream.pause();
    setTimeout(() => { if (!client.destroyed) {client.write(greeting); upstream.pipe(client); upstream.resume();} },7000);
  });
  upstream.on('error',()=>client.destroy());
  client.on('error',()=>upstream.destroy());
  client.on('close',()=>upstream.destroy());
}).listen(1026,'127.0.0.1');
await import('/app/src/server.js');
'@ | Set-Content $taskProxy -Encoding utf8
(Get-Content infra/local/envoy.yaml -Raw).Replace('address: notifications,','address: ledgerline-mail-regression,') | Set-Content $taskEnvoy -Encoding utf8
$taskHeaders=$null
$taskInitial=$null
$taskURL='http://127.0.0.1:30092/api/v1/notifications/workspaces/personal'
try {
  $taskMailpitIP=docker inspect ledgerline-mailpit-1 --format '{{(index .NetworkSettings.Networks "ledgerline-local").IPAddress}}'
  if(!$taskMailpitIP){throw 'Mailpit address unavailable.'}
  docker run -d --name $taskBackend --network ledgerline-local --memory 256m --cpus 0.5 -e CASSANDRA_HOSTS=cassandra -e CASSANDRA_DC=datacenter1 -e SMTP_HOST=127.0.0.1 -e SMTP_PORT=1026 -e SMTP_LOCAL_ONLY=true -e "SMTP_TEST_UPSTREAM=$taskMailpitIP" -e OIDC_ISSUER=http://localhost:8180/realms/ledgerline -e OIDC_JWKS=http://keycloak:8080/realms/ledgerline/protocol/openid-connect/certs -e OTEL_SDK_DISABLED=true -v "${taskProxy}:/tmp/delayed-smtp.mjs:ro" ledgerline/notifications:dev node /tmp/delayed-smtp.mjs | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Mail regression service startup failed.'}
  docker run -d --name $taskGateway --network ledgerline-local --memory 96m --cpus 0.5 -p 127.0.0.1:30092:8080 -v "${taskEnvoy}:/etc/envoy/envoy.yaml:ro" envoyproxy/envoy:v1.33-latest envoy -c /etc/envoy/envoy.yaml --concurrency 2 | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Mail regression gateway startup failed.'}
  $taskToken=Invoke-RestMethod -NoProxy -Method Post http://localhost:8180/realms/ledgerline/protocol/openid-connect/token -Body @{grant_type='password';client_id='ledgerline-local';username='notification-check';password='local-check-only'} -TimeoutSec 30
  $taskHeaders=@{Authorization="Bearer $($taskToken.access_token)"}
  for($taskAttempt=0;$taskAttempt -lt 20;$taskAttempt++){
    try{$taskInitial=Invoke-RestMethod -NoProxy $taskURL -Headers $taskHeaders -TimeoutSec 8;break}catch{Start-Sleep -Seconds 2}
  }
  if(!$taskInitial){throw 'Regression service was not ready.'}
  $taskEmail='slow-smtp-'+[guid]::NewGuid().ToString('N')+'@example.test'
  $taskPrefs=@{email=$taskEmail;enabled=$false;leadDays=3;timezone='UTC'}
  Invoke-RestMethod -NoProxy ($taskURL+'/preferences') -Method Put -Headers $taskHeaders -ContentType application/json -Body ($taskPrefs | ConvertTo-Json) | Out-Null
  $taskClock=[Diagnostics.Stopwatch]::StartNew()
  $taskSent=Invoke-RestMethod -NoProxy ($taskURL+'/verification') -Method Post -Headers $taskHeaders -ContentType application/json -Body '{}' -TimeoutSec 65
  $taskClock.Stop()
  if(!$taskSent.sent -or $taskClock.Elapsed.TotalSeconds -lt 7){throw 'Slow SMTP acceptance was not exercised successfully.'}
  $taskMail=Invoke-RestMethod -NoProxy http://localhost:8025/api/v1/messages
  $taskMessage=$taskMail.messages | Where-Object {@($_.To | ForEach-Object {$_.Address}) -contains $taskEmail} | Select-Object -First 1
  if(!$taskMessage){throw 'Verification message did not reach Mailpit.'}
  $taskMessageBody=Invoke-RestMethod -NoProxy "http://localhost:8025/api/v1/message/$($taskMessage.ID)"
  if($taskMessageBody.Text -notmatch '\b(\d{6})\b'){throw 'No verification code in local message.'}
  $taskCode=$Matches[1]
  $taskWrong=Invoke-WebRequest -NoProxy ($taskURL+'/verification/confirm') -Method Post -Headers $taskHeaders -ContentType application/json -Body (@{code='000000';email=$taskEmail} | ConvertTo-Json) -SkipHttpErrorCheck
  if($taskWrong.StatusCode -ne 400){throw 'Wrong code was not rejected.'}
  $taskFormattedCode=$taskCode.Substring(0,3)+' '+$taskCode.Substring(3)
  Invoke-RestMethod -NoProxy ($taskURL+'/verification/confirm') -Method Post -Headers $taskHeaders -ContentType application/json -Body (@{code=$taskFormattedCode;email=$taskEmail} | ConvertTo-Json) | Out-Null
  # A lost HTTP success response must not turn a valid retry into a wrong-code error.
  Invoke-RestMethod -NoProxy ($taskURL+'/verification/confirm') -Method Post -Headers $taskHeaders -ContentType application/json -Body (@{code=$taskCode;email=$taskEmail} | ConvertTo-Json) | Out-Null
  $taskVerified=Invoke-RestMethod -NoProxy $taskURL -Headers $taskHeaders
  if(!$taskVerified.verified){throw 'Recipient verification was not persisted.'}
  $taskItem=@{id='runtime-'+[guid]::NewGuid().ToString('N');name='Runtime mail regression';amount='12.34';due=[DateTime]::UtcNow.ToString('yyyy-MM-dd');kind='bill';state='open'}
  Invoke-RestMethod -NoProxy ($taskURL+'/commitments') -Method Put -Headers $taskHeaders -ContentType application/json -Body (@{items=@($taskItem)} | ConvertTo-Json -Depth 5) | Out-Null
  $taskPrefs.enabled=$true
  Invoke-RestMethod -NoProxy ($taskURL+'/preferences') -Method Put -Headers $taskHeaders -ContentType application/json -Body ($taskPrefs | ConvertTo-Json) | Out-Null
  # Identical source saves must retain enqueue repair and must not duplicate mail.
  for($taskSync=0;$taskSync -lt 2;$taskSync++){
    Invoke-RestMethod -NoProxy ($taskURL+'/commitments') -Method Put -Headers $taskHeaders -ContentType application/json -Body (@{items=@($taskItem)} | ConvertTo-Json -Depth 5) | Out-Null
  }
  $taskDelivered=$false
  for($taskAttempt=0;$taskAttempt -lt 20;$taskAttempt++){
    $taskInbox=Invoke-RestMethod -NoProxy $taskURL -Headers $taskHeaders
    if(@($taskInbox.inbox | Where-Object {$_.commitmentId -eq $taskItem.id -and $_.delivery -eq 'sent'}).Count){$taskDelivered=$true;break}
    Start-Sleep -Seconds 2
  }
  if(!$taskDelivered){throw 'Scheduled reminder did not reach the durable inbox.'}
  Invoke-RestMethod -NoProxy ($taskURL+'/commitments') -Method Put -Headers $taskHeaders -ContentType application/json -Body (@{items=@($taskItem)} | ConvertTo-Json -Depth 5) | Out-Null
  $taskMail=Invoke-RestMethod -NoProxy http://localhost:8025/api/v1/messages
  $taskReminderCount=@($taskMail.messages | Where-Object {@($_.To | ForEach-Object {$_.Address}) -contains $taskEmail -and $_.Subject -eq 'Bill due: Runtime mail regression'}).Count
  if($taskReminderCount -ne 1){throw 'Repeated source sync duplicated the scheduled reminder.'}
  Write-Output "PASS: SMTP greeting delayed seven seconds; Envoy returned successful JSON after $([math]::Round($taskClock.Elapsed.TotalSeconds,1))s; wrong code rejected, formatted correct code accepted, retry accepted and verification persisted in Cassandra. No external email sent."
  Write-Output 'PASS: scheduled reminder delivered through pooled SMTP, persisted in the inbox and remained deduplicated across unchanged source syncs.'
} catch {
  docker logs $taskBackend --tail=60 2>&1 | Select-String 'SMTP provider did not accept|"level":50' | Select-Object -Last 2
  throw
} finally {
  if($taskInitial -and $taskHeaders){
    try{Invoke-RestMethod -NoProxy ($taskURL+'/commitments') -Method Put -Headers $taskHeaders -ContentType application/json -Body '{"items":[]}' | Out-Null}catch{Write-Warning 'Could not clear fixture commitments.'}
    try{Invoke-RestMethod -NoProxy ($taskURL+'/preferences') -Method Put -Headers $taskHeaders -ContentType application/json -Body ($taskInitial.preferences | ConvertTo-Json) | Out-Null}catch{Write-Warning 'Could not restore fixture preferences.'}
  }
  docker rm -f $taskGateway $taskBackend 2>$null | Out-Null
}

$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'local-http.ps1')
Set-Location (Split-Path -Parent $PSScriptRoot)
$taskSecrets=@{}
Get-Content infra/local/.env | ForEach-Object {if($_ -match '^([A-Z_]+)=(.*)$'){$taskSecrets[$Matches[1]]=$Matches[2]}}
$taskAuth=Invoke-RestMethod @taskHttpOptions -Method Post 'http://127.0.0.1:8180/realms/master/protocol/openid-connect/token' -Body @{grant_type='password';client_id='admin-cli';username='local-admin';password=$taskSecrets.KEYCLOAK_PASSWORD} -TimeoutSec 30
$taskHeaders=@{Authorization="Bearer $($taskAuth.access_token)"}
$taskClients=Invoke-RestMethod @taskHttpOptions 'http://127.0.0.1:8180/admin/realms/ledgerline/clients?clientId=ledgerline-local' -Headers $taskHeaders
$taskClient=$taskClients[0]
$taskClient.webOrigins=@('http://localhost:8080','http://localhost:30080','http://127.0.0.1:5173','http://localhost:5173','http://localhost:3001')
$taskClient.redirectUris=@($taskClient.webOrigins | ForEach-Object {"$_/*"})
$taskClient.attributes | Add-Member -NotePropertyName 'pkce.code.challenge.method' -NotePropertyValue 'S256' -Force
$taskClient.attributes | Add-Member -NotePropertyName 'post.logout.redirect.uris' -NotePropertyValue ($taskClient.redirectUris -join '##') -Force
Invoke-RestMethod @taskHttpOptions -Method Put "http://127.0.0.1:8180/admin/realms/ledgerline/clients/$($taskClient.id)" -Headers $taskHeaders -ContentType 'application/json' -Body ($taskClient | ConvertTo-Json -Depth 20) | Out-Null
Write-Output 'Configured local browser authentication with PKCE S256 and explicit local origins.'
$taskRealm=Invoke-RestMethod @taskHttpOptions 'http://127.0.0.1:8180/admin/realms/ledgerline' -Headers $taskHeaders -TimeoutSec 30
foreach($taskSetting in @{registrationAllowed=$true;registrationEmailAsUsername=$true;loginWithEmailAllowed=$true;duplicateEmailsAllowed=$false;resetPasswordAllowed=$true;verifyEmail=$true;rememberMe=$true;bruteForceProtected=$true;loginTheme='ledgerline';displayName='Ledgerline';passwordPolicy='length(12) and notUsername';ssoSessionIdleTimeout=1800;ssoSessionMaxLifespan=43200;accessTokenLifespan=300}.GetEnumerator()){
  $taskRealm | Add-Member -NotePropertyName $taskSetting.Key -NotePropertyValue $taskSetting.Value -Force
}
$taskSMTP=@{}
Get-Content infra/local/email.env | ForEach-Object {if($_ -match '^([A-Z_]+)=(.*)$'){$taskSMTP[$Matches[1]]=$Matches[2]}}
$taskFrom=$taskSMTP.SMTP_FROM
if($taskFrom -match '<([^>]+)>'){$taskFrom=$Matches[1]}
$taskRealm | Add-Member -NotePropertyName smtpServer -NotePropertyValue @{host=$taskSMTP.SMTP_HOST;port=$taskSMTP.SMTP_PORT;from=$taskFrom;fromDisplayName='Ledgerline';ssl=$taskSMTP.SMTP_SECURE;starttls=([string]($taskSMTP.SMTP_SECURE -ne 'true' -and $taskSMTP.SMTP_REQUIRE_TLS -eq 'true')).ToLower();auth=([string][bool]$taskSMTP.SMTP_USER).ToLower();user=$taskSMTP.SMTP_USER;password=$taskSMTP.SMTP_PASSWORD} -Force
Invoke-RestMethod @taskHttpOptions -Method Put 'http://127.0.0.1:8180/admin/realms/ledgerline' -Headers $taskHeaders -ContentType 'application/json' -Body ($taskRealm | ConvertTo-Json -Depth 30) -TimeoutSec 30 | Out-Null
Write-Output 'Enabled account registration, verified email, password reset, profile management and the Ledgerline login theme. SMTP credentials were not logged.'
$taskUsers=Invoke-RestMethod @taskHttpOptions 'http://127.0.0.1:8180/admin/realms/ledgerline/users?username=notification-check&exact=true' -Headers $taskHeaders -TimeoutSec 30
if($taskUsers.Count -eq 0){
  $taskUser=@{username='notification-check';enabled=$true;emailVerified=$true;email='check@ledgerline.local';firstName='Runtime';lastName='Check';credentials=@(@{type='password';value='local-check-only';temporary=$false})}
  Invoke-RestMethod @taskHttpOptions -Method Post 'http://127.0.0.1:8180/admin/realms/ledgerline/users' -Headers $taskHeaders -ContentType 'application/json' -Body ($taskUser | ConvertTo-Json -Depth 6) -TimeoutSec 30 | Out-Null
}


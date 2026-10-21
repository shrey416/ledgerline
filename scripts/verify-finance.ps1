param([ValidateSet('compose','kubernetes')][string]$Mode='compose')
$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$taskEnv='infra/local/.env'
$taskBase=if($Mode -eq 'kubernetes'){'http://127.0.0.1:30080'}else{'http://127.0.0.1:8080'}
# Development-only OIDC fixture. Real browser login is a later product phase.
$taskToken=Invoke-RestMethod -NoProxy -Method Post 'http://127.0.0.1:8180/realms/ledgerline/protocol/openid-connect/token' -Body @{grant_type='password';client_id='ledgerline-local';username='demo';password='local-demo-only'}
$taskPayload=$taskToken.access_token.Split('.')[1].Replace('-','+').Replace('_','/')
$taskPayload=$taskPayload.PadRight($taskPayload.Length+(4-$taskPayload.Length%4)%4,'=')
$taskSubject=([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($taskPayload)) | ConvertFrom-Json).sub
if($taskSubject -notmatch '^[a-f0-9-]{36}$'){throw 'Unexpected local identity subject'}
$taskWorkspace='10000000-0000-0000-0000-000000000001'
$taskAccount='20000000-0000-0000-0000-000000000001'
$taskSQL=@"
INSERT INTO workspace(id,name,currency) VALUES('$taskWorkspace','Runtime verification','INR') ON CONFLICT DO NOTHING;
INSERT INTO membership(workspace_id,oidc_subject,role) VALUES('$taskWorkspace','$taskSubject','owner') ON CONFLICT DO NOTHING;
INSERT INTO finance_account(id,workspace_id,name,currency,kind) VALUES
('$taskAccount','$taskWorkspace','Verification cash','INR','asset'),
('20000000-0000-0000-0000-000000000002','$taskWorkspace','Verification expense','INR','expense'),
('20000000-0000-0000-0000-000000000003','$taskWorkspace','Verification income','INR','income') ON CONFLICT DO NOTHING;
"@
$taskSQL | docker compose --env-file $taskEnv exec -T postgres psql -v ON_ERROR_STOP=1 -U ledgerline -d ledgerline | Out-Null
if($LASTEXITCODE -ne 0){throw 'Local fixture setup failed'}
$taskURL="$taskBase/api/v1/core/workspaces/$taskWorkspace/transactions"
$taskHeaders=@{Authorization="Bearer $($taskToken.access_token)";'Idempotency-Key'="verify-$([guid]::NewGuid())"}
$taskBody=@{kind='expense';merchant='Runtime verification';amount='123.45';effectiveDate=(Get-Date -Format 'yyyy-MM-dd');accountId=$taskAccount;category='Operations';note='Local integration test'}
$taskFirst=Invoke-RestMethod -NoProxy -Method Post $taskURL -Headers $taskHeaders -ContentType 'application/json' -Body ($taskBody | ConvertTo-Json)
$taskReplay=Invoke-RestMethod -NoProxy -Method Post $taskURL -Headers $taskHeaders -ContentType 'application/json' -Body ($taskBody | ConvertTo-Json)
if($taskFirst.replayed -or !$taskReplay.replayed -or $taskFirst.id -ne $taskReplay.id){throw 'Idempotency failed'}
$taskBody.amount='999.99'
$taskConflict=Invoke-WebRequest -NoProxy -Method Post $taskURL -Headers $taskHeaders -ContentType 'application/json' -Body ($taskBody | ConvertTo-Json) -SkipHttpErrorCheck
if($taskConflict.StatusCode -ne 409){throw 'Conflicting replay was not rejected'}
$taskDenied=Invoke-WebRequest -NoProxy "$taskBase/api/v1/core/workspaces/10000000-0000-0000-0000-000000000099/accounts" -Headers $taskHeaders -SkipHttpErrorCheck
if($taskDenied.StatusCode -ne 403){throw 'Workspace isolation failed'}
$taskAnonymous=Invoke-WebRequest -NoProxy $taskURL -SkipHttpErrorCheck
if($taskAnonymous.StatusCode -ne 401){throw 'Unauthenticated access was not rejected'}
$taskQuery="SELECT COUNT(*)=2 AND SUM(signed_amount)=0 FROM journal_line WHERE transaction_id='$($taskFirst.id)';"
$taskBalanced=$taskQuery | docker compose --env-file $taskEnv exec -T postgres psql -At -U ledgerline -d ledgerline
if($taskBalanced.Trim() -ne 't'){throw 'Ledger balance failed'}
Write-Output 'VERIFIED authenticated posting, exact balanced journal, idempotent replay, conflict rejection, tenant isolation and anonymous rejection.'


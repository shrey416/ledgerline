param([switch]$NoBuild)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location $taskRoot
$taskEnv = Join-Path $taskRoot 'infra/local/.env'
Set-Content .env.local 'LEDGERLINE_GATEWAY_URL=http://127.0.0.1:8088'
$taskEmail = Join-Path $taskRoot 'infra/local/email.env'
if(!(Test-Path $taskEmail)){Copy-Item infra/local/email.env.example $taskEmail}
$taskSecrets=@{}
if(Test-Path $taskEnv){Get-Content $taskEnv | ForEach-Object {if($_ -match '^([A-Z_]+)=(.+)$'){$taskSecrets[$Matches[1]]=$Matches[2]}}}
    foreach ($taskKey in @('POSTGRES_PASSWORD','REDIS_PASSWORD','CLICKHOUSE_PASSWORD','GRAFANA_PASSWORD','KEYCLOAK_PASSWORD','S3_PASSWORD','KIBANA_ENCRYPTION_KEY')) {
        if($taskSecrets.ContainsKey($taskKey)){continue}
        $taskBytes = [byte[]]::new(24)
        [System.Security.Cryptography.RandomNumberGenerator]::Fill($taskBytes)
        $taskSecrets[$taskKey]=[Convert]::ToHexString($taskBytes).ToLowerInvariant()
    }
Set-Content -LiteralPath $taskEnv -Value @($taskSecrets.GetEnumerator() | ForEach-Object {"$($_.Key)=$($_.Value)"}) -Encoding utf8
@{identities=@(@{name='ledgerline';credentials=@(@{accessKey='ledgerline';secretKey=$taskSecrets['S3_PASSWORD']});actions=@('Admin','Read','Write','List','Tagging')})} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskRoot 'infra/local/s3-credentials.json') -Encoding utf8
if (!$NoBuild) {
    docker compose --env-file $taskEnv build
    if ($LASTEXITCODE -ne 0) { throw 'Container build failed' }
}
@{profile='full'} | ConvertTo-Json | Set-Content infra/local/runtime-public.json
docker compose --env-file $taskEnv up -d
if ($LASTEXITCODE -ne 0) { throw 'Compose startup failed' }
python scripts/select-monitoring-targets.py compose
if ($LASTEXITCODE -ne 0) { throw 'Monitoring target update failed' }
Write-Output 'Stack started. Run ./scripts/verify-stack.ps1 after startup completes.'
Write-Output 'After Keycloak starts, run ./scripts/configure-local-auth.ps1 for browser reminder sign-in.'


param()
$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if(!(Test-Path 'infra/local/.env')){
  throw 'Local configuration is missing. This update is for an existing Ledgerline installation. Keep infra/local/.env and email.env from that installation; see UPDATE-README.md.'
}
docker info --format '{{.ServerVersion}}'
if($LASTEXITCODE -ne 0){throw 'Start Docker Desktop and wait for its Linux engine to be ready.'}
kubectl --context docker-desktop --request-timeout=15s get nodes
if($LASTEXITCODE -ne 0){throw 'Enable Kubernetes in Docker Desktop and wait for it to be ready.'}
docker compose --env-file infra/local/.env build core-finance capture-automation rates-realtime analytics notifications web
if($LASTEXITCODE -ne 0){throw 'Build failed. Resolve the error above before starting.'}
& ./scripts/start.ps1 -ImportImages

param([switch]$SkipCompile,[ValidateSet('core-finance','web','notifications')][string[]]$Services=@('core-finance','web'))
$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
# Local registry-outage fallback. Standard Dockerfiles remain the reproducible build path.
if(!$SkipCompile){
  npm run build
  if($LASTEXITCODE -ne 0){throw 'Frontend build failed.'}
  Push-Location services/core-finance
  try{mvn -B package -DskipTests;if($LASTEXITCODE -ne 0){throw 'Java build failed.'}}finally{Pop-Location}
}
foreach($taskService in $Services){
  $taskImage="ledgerline/${taskService}:dev"
  $taskContainer="ledgerline-package-$taskService-$([guid]::NewGuid().ToString('N').Substring(0,8))"
  docker create --name $taskContainer --network none $taskImage | Out-Null
  if($LASTEXITCODE -ne 0){throw "Cached runtime image unavailable: $taskImage"}
  try{
    if($taskService -eq 'core-finance'){docker cp services/core-finance/target/core-finance-0.1.0.jar "${taskContainer}:/app/app.jar"}
    elseif($taskService -eq 'notifications'){docker cp services/notifications/src/. "${taskContainer}:/app/src"}
    else{
      docker cp dist/. "${taskContainer}:/usr/share/nginx/html"
      if($LASTEXITCODE -ne 0){throw 'Web artifact packaging failed.'}
      docker cp apps/web/nginx.conf "${taskContainer}:/etc/nginx/conf.d/default.conf"
      if($LASTEXITCODE -ne 0){throw 'Web proxy configuration packaging failed.'}
      docker cp apps/web/nginx-main.conf "${taskContainer}:/etc/nginx/nginx.conf"
    }
    if($LASTEXITCODE -ne 0){throw "Artifact packaging failed: $taskService"}
    docker commit --message 'Locally compiled account workbench; cached runtime packaging' $taskContainer $taskImage | Out-Null
    if($LASTEXITCODE -ne 0){throw "Image commit failed: $taskService"}
  }finally{docker rm $taskContainer | Out-Null}
  Write-Output "Packaged $taskImage from compiled artifacts and its existing runtime."
}

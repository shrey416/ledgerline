param([string]$Sender='ledgerlinedot@gmail.com',[ValidateSet('compose','kubernetes')][string]$Mode='compose',[switch]$Apply)
$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if($Sender -notmatch '^[a-zA-Z0-9._+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$'){throw 'Provide one valid sender address.'}
$taskSecure=Read-Host 'Enter the 16-character Gmail app password (hidden, never logged)' -AsSecureString
$taskPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecure)
try {
  $taskPassword=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer).Replace(' ','')
  if($taskPassword -notmatch '^[a-zA-Z0-9]{16}$'){throw 'Expected a 16-character app password, not the account password.'}
  @('SMTP_HOST=smtp.gmail.com','SMTP_PORT=465','SMTP_SECURE=true','SMTP_REQUIRE_TLS=true',"SMTP_USER=$Sender","SMTP_PASSWORD=$taskPassword","SMTP_FROM=Ledgerline <$Sender>",'SMTP_LOCAL_ONLY=false') | Set-Content infra/local/email.env -Encoding utf8
}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer);$taskPassword=$null;$taskSecure.Dispose()}
Write-Output "Gmail configuration saved in ignored infra/local/email.env for $Sender."
if($Apply){
  ./scripts/apply-email.ps1 -Mode $Mode
  if($LASTEXITCODE -ne 0){throw 'Configuration was saved, but applying it failed.'}
}else{Write-Output "Run this script with -Mode $Mode -Apply to save and apply, or follow docs/email.md. External email sends only after the configured service is restarted."}


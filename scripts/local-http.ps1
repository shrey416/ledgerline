# Both Windows PowerShell 5.1 and PowerShell 7 can run the startup scripts.
# UseBasicParsing avoids Internet Explorer dependencies and interactive prompts.
$taskHttpOptions = @{UseBasicParsing=$true}
if((Get-Command Invoke-RestMethod).Parameters.ContainsKey('NoProxy')){
  $taskHttpOptions.NoProxy=$true
}

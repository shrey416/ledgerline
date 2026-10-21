$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskDirectory = Join-Path $taskRoot 'implementation'
New-Item -ItemType Directory -Force -Path $taskDirectory | Out-Null
$taskPriority = ''
$taskFeatures = foreach ($taskLine in Get-Content (Join-Path $taskRoot 'docs/product.md')) {
    if ($taskLine -match '^## \d+\. (P[0-3])') { $taskPriority = $Matches[1] }
    if ($taskLine -match '^\| (F\d{3}) \|') {
        $taskCells = $taskLine.Split('|')
        [pscustomobject]@{Id=$taskCells[1].Trim(); Priority=$taskPriority; Requirement=$taskCells[2].Trim(); Services=$taskCells[3].Trim(); Acceptance=$taskCells[4].Trim(); Status='not-started'; Evidence=''; Notes='Production acceptance not established'}
    }
}
$taskExisting = Join-Path $taskDirectory 'feature-status.csv'
if (Test-Path $taskExisting) {
    $taskPrevious = @{}
    Import-Csv $taskExisting | ForEach-Object { $taskPrevious[$_.Id] = $_ }
    foreach ($taskFeature in $taskFeatures) {
        if ($taskPrevious.ContainsKey($taskFeature.Id)) {
            $taskFeature.Status=$taskPrevious[$taskFeature.Id].Status
            $taskFeature.Evidence=$taskPrevious[$taskFeature.Id].Evidence
            $taskFeature.Notes=$taskPrevious[$taskFeature.Id].Notes
        }
    }
}
if (@($taskFeatures).Count -ne 108) { throw 'Expected 108 requirement rows' }
$taskFeatures | Export-Csv -NoTypeInformation -Encoding utf8 -LiteralPath $taskExisting
Write-Output '108 requirements tracked; existing evidence preserved.'


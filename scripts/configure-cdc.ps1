$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskSecrets=@{}
Get-Content (Join-Path $taskRoot 'infra/local/.env') | ForEach-Object {if($_ -match '^([A-Z_]+)=(.+)$'){$taskSecrets[$Matches[1]]=$Matches[2]}}
$taskConfig=@{
 'connector.class'='io.debezium.connector.postgresql.PostgresConnector'
 'database.hostname'='postgres';'database.port'='5432';'database.user'='ledgerline';'database.password'=$taskSecrets.POSTGRES_PASSWORD;'database.dbname'='ledgerline'
 'topic.prefix'='ledgerline';'plugin.name'='pgoutput';'slot.name'='ledgerline_outbox';'publication.name'='ledgerline_outbox';'publication.autocreate.mode'='filtered'
 'table.include.list'='public.outbox_event';'snapshot.mode'='initial';'tombstones.on.delete'='false'
 'transforms'='outbox';'transforms.outbox.type'='io.debezium.transforms.outbox.EventRouter';'transforms.outbox.route.topic.replacement'='ledgerline.finance.events'
 'transforms.outbox.table.expand.json.payload'='true'
 'key.converter'='org.apache.kafka.connect.storage.StringConverter';'value.converter'='org.apache.kafka.connect.json.JsonConverter';'value.converter.schemas.enable'='false'
}
# Never print the response: Connect echoes its credential-bearing configuration.
Invoke-RestMethod -NoProxy -Method Put 'http://127.0.0.1:8083/connectors/ledgerline-finance-outbox/config' -ContentType 'application/json' -Body ($taskConfig | ConvertTo-Json -Depth 8) | Out-Null
$taskStatus=Invoke-RestMethod -NoProxy 'http://127.0.0.1:8083/connectors/ledgerline-finance-outbox/status'
Write-Output "CDC connector: $($taskStatus.connector.state). Check task state once startup completes."


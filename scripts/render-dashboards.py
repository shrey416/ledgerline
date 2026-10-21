"""Generate provisioned dashboards using real metric and log field contracts."""
import json
from pathlib import Path
root = Path(__file__).resolve().parents[1]
output = root / "observability/grafana/dashboards"
output.mkdir(parents=True, exist_ok=True)

def panel(title, expression, index, kind="timeseries", unit="short", datasource="prometheus"):
    result = {"id":index,"title":title,"type":kind,"gridPos":{"h":8,"w":12,"x":((index-1)%2)*12,"y":((index-1)//2)*8},"datasource":{"type":"prometheus","uid":datasource},"targets":[{"refId":"A","expr":expression,"legendFormat":"{{service}} {{database}} {{instance}}"}],"fieldConfig":{"defaults":{"unit":unit},"overrides":[]},"options":{"legend":{"displayMode":"table","placement":"bottom"},"tooltip":{"mode":"multi"}}}
    if kind=="stat":
        result["targets"][0].update(instant=True,range=False)
        healthy_count=title in ('Healthy application scrape targets','Services ready with their database')
        alert=title=='Firing alerts'
        result['fieldConfig']['defaults']['thresholds']={'mode':'absolute','steps':[{'color':'green' if alert else 'red','value':None},{'color':'red' if alert else 'green','value':1 if alert or not healthy_count else 5}]}
        result["options"]={"reduceOptions":{"calcs":["lastNotNull"],"fields":"","values":False},"colorMode":"background","graphMode":"none"}
    if 'Container' in title or title in ('Working-set memory','Memory limit utilization'):result['targets'][0]['legendFormat']='{{name}}'
    return result

def write(uid,title,panels):
    value={"uid":uid,"title":title,"tags":["ledgerline"],"schemaVersion":41,"version":1,"refresh":"15s","time":{"from":"now-30m","to":"now"},"timezone":"browser","editable":False,"panels":panels,"links":[{"title":"Kibana logs","url":"http://localhost:5601/app/discover","targetBlank":True},{"title":"Alert inbox","url":"http://localhost:9093","targetBlank":True}],"templating":{"list":[]}}
    (output/f"{uid}.json").write_text(json.dumps(value,indent=2),encoding="utf-8")

write("ledgerline-overview","Ledgerline / Platform overview",[
 panel("Healthy application scrape targets","sum(up{job=\"ledgerline-services\"})",1,"stat"),
 panel("Services ready with their database","sum(probe_success{job=\"service-readiness\"})",2,"stat"),
 panel("Request rate by service","sum by(service) (rate(ledgerline_http_requests_total[5m]))",3,unit="reqps"),
 panel("Server errors per second","sum by(service) (rate(ledgerline_http_requests_total{status=~\"5..\"}[5m]))",4,unit="reqps"),
 panel("Request latency p95","histogram_quantile(0.95,sum by(le,service)(rate(ledgerline_http_request_duration_seconds_bucket[5m])))",5,unit="s"),
 panel("Dependency status","ledgerline_dependency_up",6,"stat"),
 panel("Container working memory","sum by(name)(container_memory_working_set_bytes{name!=\"\"})",7,unit="bytes"),
 panel("Firing alerts","sum(ALERTS{alertstate=\"firing\"}) or vector(0)",8,"stat")])
write("ledgerline-services","Ledgerline / Service performance",[
 panel("Requests by service/status","sum by(service,status)(rate(ledgerline_http_requests_total[5m]))",1,unit="reqps"),
 panel("Latency p50 / service","histogram_quantile(0.5,sum by(le,service)(rate(ledgerline_http_request_duration_seconds_bucket[5m])))",2,unit="s"),
 panel("Latency p99 / service","histogram_quantile(0.99,sum by(le,service)(rate(ledgerline_http_request_duration_seconds_bucket[5m])))",3,unit="s"),
 panel("Actual dependency checks","ledgerline_dependency_up",4,"stat"),
 panel("Java heap","jvm_memory_used_bytes{area=\"heap\"}",5,unit="bytes"),
 panel("Go goroutines","go_goroutines{service=\"rates-realtime\"}",6),
 panel("Node process memory","process_resident_memory_bytes{service=\"notifications\"}",7,unit="bytes"),
 panel("Outbox retained event rows (not CDC lag)","ledgerline_outbox_rows",8),
 panel("Reminder worker initialized","ledgerline_notification_worker_up",9,"stat"),
 panel("Reminder deliveries / retries / failures","sum by(outcome)(increase(ledgerline_notification_delivery_total[30m]))",10),
 panel("SMTP connection and authentication","ledgerline_notification_email_transport_up",11,"stat")])
write("ledgerline-databases","Ledgerline / Database health",[
 panel("Database TCP reachability","probe_success{job=\"databases-tcp\"}",1,"stat"),
 panel("Authenticated application DB readiness","ledgerline_dependency_up",2,"stat"),
 panel("PostgreSQL active connections","pg_stat_activity_count",3),
 panel("PostgreSQL transactions / second","rate(pg_stat_database_xact_commit{datname=\"ledgerline\"}[5m])",4),
 panel("Redis memory","redis_memory_used_bytes",5,unit="bytes"),
 panel("Redis keyspace hit rate","rate(redis_keyspace_hits_total[5m]) / clamp_min(rate(redis_keyspace_hits_total[5m])+rate(redis_keyspace_misses_total[5m]),0.001)",6,unit="percentunit"),
 panel("ClickHouse resident memory","ClickHouseAsyncMetrics_MemoryResident",7,unit="bytes"),
 panel("Probe latency by database","probe_duration_seconds{job=\"databases-tcp\"}",8,unit="s")])
write("ledgerline-containers","Ledgerline / Container resources",[
 panel("Container CPU cores","sum by(name)(rate(container_cpu_usage_seconds_total{name!=\"\"}[5m]))",1),
 panel("Working-set memory","container_memory_working_set_bytes{name!=\"\"}",2,unit="bytes"),
 panel("Memory limit utilization","container_memory_working_set_bytes{name!=\"\"} / clamp_min(container_spec_memory_limit_bytes{name!=\"\"},1)",3,unit="percentunit"),
 panel("Network receive bytes / second","sum by(name)(rate(container_network_receive_bytes_total{name!=\"\"}[5m]))",4,unit="Bps"),
 panel("Network transmit bytes / second","sum by(name)(rate(container_network_transmit_bytes_total{name!=\"\"}[5m]))",5,unit="Bps"),
 panel("Prometheus active series","prometheus_tsdb_head_series",6)])
logs={"id":1,"title":"Structured application logs — use Kibana for full filtering","type":"logs","gridPos":{"x":0,"y":0,"w":24,"h":18},"datasource":{"type":"elasticsearch","uid":"elasticsearch"},"targets":[{"refId":"A","query":"*","metrics":[{"id":"1","type":"logs"}],"bucketAggs":[]}],"options":{"showTime":True,"showLabels":True,"wrapLogMessage":True,"sortOrder":"Descending"}}
write("ledgerline-logs","Ledgerline / Logs",[logs])
write("ledgerline-traces","Ledgerline / Distributed traces",[{"id":1,"title":"Recent service traces","type":"table","gridPos":{"x":0,"y":0,"w":24,"h":16},"datasource":{"type":"tempo","uid":"tempo"},"targets":[{"refId":"A","queryType":"traceql","query":"{ resource.service.name != nil }","limit":50,"tableType":"traces"}],"options":{"showHeader":True}}])
write("ledgerline-kubernetes","Ledgerline / Kubernetes",[
 panel("Ready application pod containers",'sum by(pod)(kube_pod_container_status_ready{namespace="ledgerline-local"})',1),
 panel("Available deployment replicas",'kube_deployment_status_replicas_available{namespace="ledgerline-local"}',2),
 panel("Container restarts",'kube_pod_container_status_restarts_total{namespace="ledgerline-local"}',3),
 panel("Pod phases",'sum by(phase)(kube_pod_status_phase{namespace="ledgerline-local"})',4),
 panel("Requested container memory",'kube_pod_container_resource_requests{namespace="ledgerline-local",resource="memory"}',5,unit="bytes"),
 panel("Desired versus available replicas",'kube_deployment_spec_replicas{namespace="ledgerline-local"} - kube_deployment_status_replicas_available{namespace="ledgerline-local"}',6)])
print("Seven Grafana dashboards generated.")

# Running and observing Ledgerline locally

This development environment has exactly five domain services. Finance screens store private account-owned data in PostgreSQL, with atomic revisions/history/outbox writes; capture, rates and analytics currently provide database readiness/telemetry foundations. Java also exposes a separate authenticated, workspace-authorized posting API with balanced journals. Node/Cassandra implements private reminder preferences, verified recipients, scheduled SMTP delivery and notification history. This is not a production deployment.

## Two deployment modes

Run `./scripts/local-up.ps1` from PowerShell 7 in the repository. The script creates random local infrastructure passwords in ignored `infra/local/.env`, builds six images, and starts the complete Compose stack. First downloads are several GB; allow several minutes. Database storage persists in named volumes. Open http://localhost:8080. The development UI on http://127.0.0.1:5173 proxies `/api` and `/platform` to the gateway on port 8088.

After startup, run `python scripts/provision-observability.py`, `./scripts/configure-cdc.ps1`, `./scripts/verify-finance.ps1`, then `./scripts/verify-stack.ps1`. The verifier writes an ignored `implementation/runtime-evidence.json` containing counts/status, never credentials. Allow at least one 15-second scrape and a few seconds for trace export before verification.

For Docker Desktop Kubernetes, enable its **kind provisioner**, then run `./scripts/kubernetes-up.ps1`. This script explicitly uses context `docker-desktop`. It imports the application images into the node's containerd, connects that local node to the project Docker network, and renders selectorless Services and EndpointSlices pointing to the existing infrastructure. The application runs in Kubernetes; the databases and central monitoring run once in Compose. This local hybrid saves several GB on the current 8 GB Docker allocation. [Kubernetes supports Services with explicitly managed external EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/service/).

Each of the five domain pods contains the application plus an OpenTelemetry collector sidecar. Deployments have startup/readiness/liveness probes, CPU/memory budgets, disabled application service-account mounting, restricted capabilities and bounded shutdown. CoreDNS provides discovery; Envoy provides routing, connection/pending-request limits and unhealthy-upstream ejection. The gateway and web frontend are additional infrastructure pods. Fluent Bit is a DaemonSet, and kube-state-metrics reports pod/deployment state. Both have narrowly scoped read permissions to application pod metadata; neither reads Secrets.

Open http://localhost:30080 in Kubernetes mode. The startup script launches hidden loopback-only kubectl forwards for web (30080) and the development gateway (30088), then selects that gateway for Vite through ignored `.env.local`. Re-run `./scripts/kubernetes-forward.ps1` if a pod restart closes them; generated logs are in infra/k8s/local/generated. Run finance, notifications and stack verifiers with `-Mode kubernetes`. Re-run the Kubernetes script after recreating infrastructure containers to refresh EndpointSlice addresses. Use `-SkipImageImport` only if current images are imported.

To return to Compose, run `./scripts/kubernetes-down.ps1`, then `./scripts/local-up.ps1 -NoBuild`. No command here removes database volumes. A Kubernetes rollout can leave old pods if it fails; inspect with `kubectl --context docker-desktop -n ledgerline-local get pods` and `describe pod <name>` before restarting.

After Docker Desktop restarts, container IPs can change. Run `./scripts/refresh-local-endpoints.ps1` to refresh the ten infrastructure EndpointSlices without restarting applications or rewriting secrets; then re-run `./scripts/kubernetes-forward.ps1`. The account deployment helper calls the endpoint refresh automatically. A zombie container or WSL `0x8007274c` can require restarting Docker Desktop; that interrupts every project on its runtime. The Gmail apply helper now updates only the notification Secret/deployment, so a finance rollout cannot block saving SMTP configuration.

## Dashboards and data

| Tool | Local address | Real data displayed |
|---|---|---|
| Grafana | http://localhost:3000 | Seven provisioned dashboards: platform overview, service RED metrics, databases, containers, logs, distributed traces, Kubernetes |
| Prometheus | http://localhost:9090/targets | Five application scrape targets, five database TCP probes, five HTTP readiness probes, exporters, Envoy, container metrics and infrastructure self-metrics |
| Kibana | http://localhost:5601/app/dashboards#/view/ledgerline-logs | Indexed application logs grouped by service and severity, searchable log stream, status/trace ID filters |
| Alertmanager | http://localhost:9093 | Grouped active/resolved alerts |
| Mailpit | http://localhost:8025 | Locally captured monitoring alert emails; never sends to real users |
| Tempo | http://localhost:3200 | Trace search API; use Grafana to inspect spans |
| Keycloak | http://localhost:8180 | Development realm and API authentication fixture |
| Kafka Connect | http://localhost:8083 | Debezium outbox connector status |

Grafana permits anonymous **read-only** viewing locally. Admin user is `local-admin`; its random password is in `infra/local/.env`. Keycloak has the same admin username with its own random password. `demo / local-demo-only` is a documented development-only realm fixture used by the integration verifier. Password grants, Keycloak development mode and plaintext internal transports must be replaced before public deployment.

Application HTTP counters/histograms use `service`, `method`, bounded `route`, and `status` labels. The common metrics are `ledgerline_http_requests_total`, `ledgerline_http_request_duration_seconds_bucket`, and `ledgerline_dependency_up`. Readiness performs actual PostgreSQL/MongoDB/Redis/ClickHouse/Cassandra checks. Process metrics come from their native runtimes. Database graphs include PostgreSQL transactions/connections, Redis memory/cache hits, ClickHouse server metrics, and TCP availability for all five databases. A TCP probe is labelled as connectivity, not query correctness; the application readiness gauges provide the query checks.

RED means request rate, error rate and duration. Charts require two or more scrapes; a fresh rate chart can be empty. The outbox gauge reports **retained rows**, not replication delay or consumer lag. Reminder worker/delivery counters reflect actual initialization and dispatch outcomes. Health stats show current values and turn red on failure; alert counts turn red when firing. cAdvisor collects CPU/memory/network/OOM metrics, excluding expensive unused disk scans. Its metrics describe Docker engine containers; kube-state-metrics supplies Kubernetes readiness/restarts/requests, not per-pod CPU usage.

Compose application stdout uses the Docker GELF driver into Logstash. Kubernetes CRI logs are tailed by Fluent Bit and posted to Logstash. Logstash parses structured JSON, normalizes service/severity/status/trace IDs, and writes daily `ledgerline-logs-*` indices. Infrastructure logs remain available with `docker compose logs <service>`; the centralized pipeline covers the application, gateway, UI and Kubernetes sidecars. Application code does not log authorization headers, credentials or finance request bodies. The filter removes known parsed secret fields, but does not guarantee redaction of arbitrary raw messages: preserve the logging contract when implementing new endpoints.

OpenTelemetry traces travel application → per-pod agent (Kubernetes) → central collector → Tempo. Compose sends directly to the central collector. Gateway/downstream spans share W3C trace context. Grafana can search TraceQL and link spans to Elasticsearch logs through `trace_id`. [Grafana documents Elasticsearch trace-to-log correlation](https://grafana.com/docs/grafana/latest/datasources/tempo/configure-tempo-data-source/configure-trace-to-logs/).

Prometheus retains three days capped at 512 MB; Elasticsearch ILM deletes daily log indices after three days; Tempo retains 24 hours. Kafka retains 24 hours locally. These limits are deliberate local budgets, not production retention requirements. Grafana provisioning and Kibana setup are repeatable and source-controlled.

## Alerts and troubleshooting

Alerts cover application scrape failure, failed dependency/readiness, sustained server errors, container memory pressure and excessive active metric series. Alertmanager groups events and sends to Mailpit using SMTP on the internal network. Test with `./scripts/verify-alerts.ps1`; it temporarily stops/scales the rates service, verifies a real firing alert and captured email, and restores the service in `finally`. Never use this local failure drill against production.

If a service is unavailable, inspect its readiness result, Prometheus target error and logs by `service_name`. For a slow/error request, copy `trace_id` from Kibana and inspect it in Grafana/Tempo. If logs are missing, check Logstash startup/Elasticsearch health and Fluent Bit retry errors. GELF UDP is best-effort and can lose startup logs before Logstash is ready; durable production shipping should use disk-buffered agents with an authenticated ingest endpoint. Local Fluent Bit bounds retries and buffers to protect the machine.

Java writes journal, replay record and outbox in one PostgreSQL transaction. Debezium publishes rows to `ledgerline.finance.events`; real events were consumed from the topic. Connector credentials come from the ignored env file and are never printed. Kafka consumers, Mongo outbox relays, server-owned renewal cycles, analytical projections and gRPC contracts remain future work. Notification SMTP delivery is implemented separately; see email.md for scope and limits.

## Before hosting publicly

Current local UI/admin ports bind to loopback. MongoDB and Cassandra have no local host ports and use private development-network authentication settings. Docker network isolation does not make those settings appropriate for production. The production architecture in `docs/architecture.md` still requires authenticated database connections, TLS/mTLS, TLS ingress/OIDC browser login, network policies, secret manager, replicated operators/managed databases, backups with restore tests, image provenance/scanning and external SMTP configuration. The local stack is single-node and has no HA promise. Elastic uses its free Basic license; Grafana/Prometheus/OTel/Fluent Bit/Tempo require no paid hosted account. Review component licenses before redistribution.

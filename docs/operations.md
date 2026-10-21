# Kubernetes, observability, security and operating model

## 1. Deployment profiles and cost truth

All five services run on Kubernetes in local integration, staging and production. Docker Compose may assist isolated development but cannot be the acceptance deployment. Provide Helm charts and local `kind` configuration for repeatable cluster creation, with Windows PowerShell scripts for bootstrap and validation. Production can use managed databases or operator-managed StatefulSets; the exact database products remain mandatory in either case.

**Integration profile:** one replica per service, PostgreSQL single instance, Mongo single-node replica set, Redis single instance, ClickHouse single instance, Cassandra single node (RF1 explicitly non-HA), Kafka single broker/controller, reduced observability retention and local SMTP/object storage. Linkerd sidecars still demonstrate multi-container pods. Plan approximately 24–32GiB RAM and sufficient SSD space for a comfortable full-stack integration machine; profile actual resident/requested usage and document deviations. A staged test profile may deploy subsets in CI, but full acceptance runs all required technologies together.

**Production profile:** at least two API replicas per service, separately scaled worker roles, three fault domains, PostgreSQL primary plus replicas/failover, Mongo three-member replica set, Redis primary/replicas with Sentinel or an appropriately managed topology, Cassandra at least three nodes RF3, Kafka three brokers with quorum and replicated topics, ClickHouse replicated shards with Keeper quorum, Elasticsearch replicated logging nodes and durable object store. Count infrastructure capacity separately. Redis Sentinel and database operators are infrastructure processes, not extra application services.

Initial application replica requests/limits (starting envelopes, benchmark before launch): Java 500m/1 CPU and 768Mi/1536Mi; Python API 250m/1 CPU and 256Mi/768Mi; Python OCR worker 1/2 CPU and 768Mi/2Gi; Go 100m/500m and 128Mi/384Mi; C# 250m/1 CPU and 384Mi/1Gi; Node 200m/1 CPU and 256Mi/768Mi. Sidecar requests/limits are budgeted independently. Databases require separate measured storage/CPU/memory sizing; do not fit them into application envelopes. Enforce namespace quotas and derive minimum cluster capacity from actual Helm values plus system reserve rather than claiming a universal total.

## 2. Kubernetes resources

Namespaces: `ledgerline`, `data`, `messaging`, `observability`, `gateway-system` and mesh/control namespaces. Separation is for policy and operations, not tenant isolation by namespace. For each API: Deployment, ClusterIP Service, ServiceAccount, ConfigMap, external secret references, HPA, PodDisruptionBudget, NetworkPolicy, startup/readiness/liveness probes, ServiceMonitor/PodMonitor and Helm values. Separate API and worker Deployments can use the same service image with role arguments, retaining exactly five service codebases.

Stateful workloads use operators or managed services. Operator-managed storage needs StatefulSets, PVCs, StorageClasses, anti-affinity/topology spread, backup jobs and maintenance policies. Install supported operators after verifying Kubernetes version compatibility: CloudNativePG for PostgreSQL, maintained Mongo operator, Redis operator or documented StatefulSet/Sentinel configuration, ClickHouse operator, cass-operator/K8ssandra and Strimzi Kafka. Validate licenses, maintenance status and chart support before pinning; no unreviewed `latest` images.

Application pods contain app + Linkerd proxy; proxy metrics go directly to scrape endpoints. Fluent Bit runs as DaemonSet rather than a log sidecar per application. OTel collector runs as shared infrastructure Deployment/DaemonSet where required. Do not co-locate a database, broker and application in one pod or mount shared database volumes between services.

Use readiness for ability to serve that role: Java requires writable PostgreSQL for financial commands; Analytics reads can remain available when Kafka ingestion is delayed and disclose freshness; Node API and delivery worker have different dependency readiness. Liveness checks process health and avoids restarting all pods because a provider or database is temporarily unavailable. Startup probes allow JVM/mesh startup. Graceful shutdown stops consumers accepting work, drains in-flight requests, persists checkpoints and then exits; termination grace accommodates maximum bounded job slice.

Rolling updates `maxUnavailable: 0` for APIs with capacity reserve. PDB permits one disruption when enough replicas exist; single-replica local profiles cannot honestly guarantee uninterrupted maintenance. HPA uses CPU plus Kafka lag for workers and active SSE connections for Go, within database/provider budgets. Never scale consumers past partitions without acknowledging idle replicas. DB connection pools have global replica-aware budgets; autoscaling cannot exhaust PostgreSQL max connections.

Provide topology spread across zones/nodes, PriorityClasses for critical infrastructure and explicitly scheduled maintenance. Network policies default-deny ingress/egress with permitted DNS, gateway, mesh control, owning databases, Kafka, OTel and provider egress through restricted paths. Only gateway serves public traffic; database/admin dashboards are private.

## 3. Security and identity

Use OIDC Authorization Code + PKCE. Java contains the browser-session/OAuth client module; no extra application BFF. The frontend uses same-origin Secure HttpOnly SameSite cookies; Java keeps session records and encrypted refresh material in PostgreSQL or relies on provider session with a documented revocation path. Gateway delegates browser session verification to a Java internal auth endpoint and provides a short-lived signed internal assertion; every service validates assertion audience/expiry and obtains authoritative object/workspace scope as needed. Never trust public `X-User` headers: strip them at gateway. Internal assertion format and key rotation are part of contracts.

Gateway/Java do not become unrestricted proxies. Provider login/recovery/MFA pages can be hosted by an external identity provider; local issuer/test OIDC emulator is infrastructure. Store no application plaintext passwords. JWT bearer machine/API flows validate issuer/audience/algorithm/expiry/JWKS and use scoped permissions. User sessions require current membership for mutations. Membership removal, lost devices and revoked tokens cannot wait for an eventual analytics projection.

Role baseline: owner manages workspace and finance; administrator manages access/config with limited owner powers; finance manages bills/budgets/claims/payables; approver sees assigned permitted claims; employee sees own expenses/claims; household member sees shared scoped resources; viewer/accountant sees permitted read/export scope; auditor sees immutable scoped history. Implement capability policies plus department/project/object constraints, not a single role enum check. No self-approval even for admins where separation is required. Break-glass override is explicitly permissioned, reasoned and audited and cannot become a default bypass.

TLS at edge with certificate automation, HSTS after correct domain verification; Linkerd workload mTLS in cluster; database TLS; Kafka TLS/SASL or operator identity; encryption at rest for PVs/object store/backups and envelope encryption for provider credentials. Secrets managed by External Secrets with a cloud secret manager; Kubernetes etcd encryption and limited secret RBAC; short-lived workload credentials where possible. Rotation exercise must cover DB, webhook, provider and internal assertion keys.

SecurityContext non-root, read-only root filesystem where supported, drop capabilities, seccomp RuntimeDefault, disallow privilege escalation, isolated temp volume and constrained service account. Mesh CNI avoids broad network privileges in app init containers. Apply restricted Pod Security policy with reviewed infrastructure exceptions. Sign images, produce SBOMs, scan dependencies/images and pin digests.

Validate uploads by actual content/MIME, size/page/pixel limits and malware scanning (ClamAV infrastructure), quarantined object prefixes, short-lived signed URLs and attachment authorization on every access. URLs to providers/webhooks must block private/link-local/loopback addresses, metadata endpoints, DNS rebinding and redirect escapes; enforce egress restrictions beyond string validation. XLS/CSV export neutralizes formula injection while preserving raw numeric representation in documented machine export mode.

Rate limits per principal/workspace and provider, payload limits, CSRF, narrow CORS, CSP without arbitrary unsafe-eval, output escaping, SQL/ClickHouse parameterization and bounded rule expressions. Logs cannot contain tokens, passwords, full receipt content, full card/bank numbers or raw finance request bodies. Sensitive fields encrypted/redacted in audit where required; audit is access-controlled and separate from diagnostic logs.

## 4. Monitoring, logging and traces

Required chain:

```text
Application / mesh metrics --> Prometheus --> Grafana + Alertmanager
Structured JSON stdout --> Fluent Bit --> Logstash --> Elasticsearch --> Kibana
OpenTelemetry spans --> OTel Collector --> Grafana Tempo --> Grafana trace links
```

No second Loki log pipeline or duplicate metrics collection unless a demonstrated need exists. Logstash applies schema normalization, enrichment/redaction and routes errors; Fluent Bit provides bounded buffering/backpressure. Logging outages cannot block financial commits indefinitely. Elasticsearch ILM has short debug retention, appropriate error retention and access control. Log retention is a policy, not unlimited storage.

JSON log fields: timestamp, level, service, build/version, environment, trace_id, span_id, request_id, event_id/operation_id where relevant, route template, error code, latency and safe component. Avoid workspace IDs in unbounded Prometheus labels; tenant troubleshooting uses access-controlled logs with pseudonymous IDs. Trace logs do not sample away audit records. Prometheus labels use route templates, outcome and service rather than raw URLs/users.

Tracing crosses REST, gRPC and Kafka using W3C trace context. Async span links connect original causation to processing; span duration represents actual work and not indefinite queue residence. Baseline sampling can be 10% plus tail sampling for errors/slow operations, adjusted after volume measurement. Collector has bounded queues and retry/backpressure metrics. Tempo retention/cost is separately budgeted.

Mandatory Grafana dashboards: service overview RED metrics; infrastructure/node/PV saturation; Java JVM/GC/connection pools; Python OCR/import backlog; Go SSE/cache/provider quotas; C# ClickHouse latency/lag/reconciliation; Node notification lag/attempts/bounces; Kafka brokers/consumer lag/DLQ; CDC connector/replication slot WAL; each database health/storage/failover; authentication failures; backup/restore freshness and financial correctness reconciliations.

Mandatory metrics: http/grpc latency/error/active requests; Kafka producer failures, consumer lag and duplicate handling; outbox oldest unprocessed age; projection checkpoint lag; failed/delayed reminders; ambiguous email sends; due intent count; pending import rows; OCR duration/failure/queue age; cache hit/staleness/provider throttle; permission errors; financial posting imbalance attempts; reconciliation mismatches; export job age; backup age; certificate expiry. Alert business failures as well as CPU.

Kibana saved searches: a trace journey, notification intent/provider attempts, failed imports with row counts (not raw rows), permission denial, CDC failure and deployment regressions. Supply one documented drill: user sees failed bill save → trace ID → Grafana span → Kibana redacted logs → correct service/database cause → recovery verifies no duplicate posting.

## 5. Service objectives and load acceptance

Targets must be measured before claiming production readiness. Starting SLOs over rolling 30 days: core read/write availability 99.9%, authorized core read p95 ≤300ms under stated test load, financial command p95 ≤700ms, standard report p95 ≤2s for up to 1m facts, projection freshness p95 ≤10s/p99 ≤60s when dependencies healthy, due reminder dispatch p95 ≤60s after configured scheduled time (provider delivery time tracked separately). OCR/large import is asynchronous and gets progress, not an unrealistic instant response promise.

Benchmark scenario: 10k workspaces, 1m transactions with splits, 100k obligations, 500 active users, 50 read requests/s, 10 command requests/s, 1000 SSE connections and bursts of 100 reminders/minute. Test with realistic skew and slow reports on the chosen cluster. Also validate 100k-row import in bounded memory, with chunked confirmation and cancellation between chunks. These are launch validation workloads, not guaranteed free-hosting capacity.

Alert on multi-window error budget burn, oldest notification age >5m, projection lag >60s sustained, outbox/CDC lag, repeated imbalance attempt, backup overdue, disk headroom <20%, certificate expiry <14d and abnormal auth failures. Distinguish warning/actionable critical; alerts route to configured operator channels, never send messages during planning. Runbooks define owner, diagnosis, safe mitigation and verification.

## 6. CI/CD and rollout

Monorepo paths: `apps/web`, `services/core-finance`, `services/capture-automation`, `services/rates-realtime`, `services/analytics`, `services/notifications`, `contracts`, `infra/helm`, `infra/kind`, `observability`, `tests/e2e`, `tests/contracts`, `tests/load`, `runbooks`, `implementation`, `scripts`.

CI stages: formatting/lint/types; unit/architecture tests; contract compatibility/code generation; containerized own-DB integration tests; cross-service tests; frontend component/accessibility/build; full Kubernetes smoke/critical E2E; image/dependency/SBOM scan; Helm schema/lint/render + policy validation; publish immutable signed images and test artifacts. Tests using real mandatory databases cannot be replaced entirely by mocks or SQLite.

Deployment via Helm with immutable image versions and environment overlays; Argo CD handles GitOps sync if selected as deployment controller. Infrastructure manifests are versioned. Migrations use dedicated Jobs, advisory locks and separate privileged migration identities. Expand schema first, deploy backwards-compatible applications, backfill, verify and only later contract schema. Cassandra/ClickHouse migration strategy explicitly accounts for table rebuilds and large data. Rollback of app image does not automatically undo destructive schema changes.

Stage smoke tests verify all five API health routes, DB connectivity, real financial posting, Kafka CDC, analytic projection, test inbox/email, SSE invalidation and authorization denial. Canary rollout with error/latency/correctness gates; if no traffic-splitting setup exists, use controlled sequential rollouts and document reduced assurance. Deployment readiness is blocked by failed critical security/correctness gates.

## 7. Backups, recovery and retention

Initial objectives for committed finance data: RPO ≤15 minutes under disaster recovery, RTO ≤4 hours on provisioned recovery infrastructure. Replication improves availability but is not a backup. PostgreSQL has continuous WAL archiving + daily base backups; Mongo replica-consistent snapshots/backup tooling; Cassandra snapshot/incremental procedures with repair and schema metadata; ClickHouse backup or source replay plus retained rebuild snapshots; Redis AOF/RDB for faster recovery but no irreversible data dependence. Object storage versioning/retention and lifecycle protect receipt bytes. Kafka retention must cover recovery/rebuild windows, with archived projection bootstrap where full historical events exceed broker retention.

Do not assume replay from last seven days rebuilds years of analytics. Java exposes authorized consistent snapshot export/checkpoint for full projection bootstrap; C# loads snapshot into a new dataset epoch, then applies events after captured offsets and reconciles before activation. Mongo notification/capture state requiring historical reconstruction has dedicated backup or source snapshots, not vague “Kafka can restore it.”

Quarterly restore rehearsal to isolated namespace: recover PG/Mongo/Cassandra/object bytes, rebuild analytics/Redis, resume CDC carefully, validate external source identities and idempotency retention, compare account/journal balances and bills outstanding, and verify no delayed historical reminder flood. Disable external sends during restore until eligibility/delivery checkpoint review. Document actual measured RPO/RTO and failed steps.

Retention deletion respects business holds and jurisdiction-specific configured periods; default policy is a product setting, not a universal legal claim. Deletion includes receipts/previews/export objects, P/C/N projections, cached streams, provider tokens and application state. Backups expire according to documented lifecycle rather than claiming instantaneous selective deletion. Purge tombstones prevent replay from resurrecting deleted workspace data. Authorized hold state is propagated and verified before every destructive worker step.

## 8. Required failure demonstrations

Kill Java during post commit and retry: one journal result. Stop Kafka/CDC: financial writes persist and outbox catches up. Crash import after Java acknowledged but before Mongo checkpoint: replay does not duplicate. Flush Redis: balances/reminders unchanged; realtime resyncs. Replay ClickHouse events twice: totals identical. Pause email provider: durable backlog retries with bounded dispatch. Remove member while SSE/email queued: access denied and stream closed; send preflight suppresses. Restart Cassandra node: quorum operation behavior proven. Break FX endpoint: timestamped stale state/manual actual entry. Fill or throttle observability pipeline: finances continue and monitoring reports its own failure. Recovery test confirms every failure can be detected and diagnosed through metrics/traces/logs.

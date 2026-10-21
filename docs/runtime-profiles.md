# Desktop runtime profiles

Ledgerline keeps five domain services and five different databases in both profiles. GPU memory is not used by the application. The daily profile targets a 16 GB Windows desktop and avoids running presentation/debug tooling continuously.

## Daily Kubernetes

```powershell
./scripts/start.ps1
```

Open http://localhost:30080. Each domain pod has one application container. Web, Envoy and kube-state-metrics run in separate pods. Database containers, Keycloak, Kafka, Prometheus, Grafana, Alertmanager and exporters run once in Compose, shared through private Kubernetes Services/EndpointSlices. Compose copies of the application are stopped before pod deployment.

Run this after each Docker Desktop restart, once Kubernetes is available. Starting the entire Compose group in Docker Desktop bypasses endpoint refresh and browser forwarding, starts duplicate application services alongside Kubernetes, and reactivates the full observability stack. The startup script reuses existing cluster images, runs Compose infrastructure only, refreshes addresses, waits for pod rollout and checks the browser endpoint. Use `-ImportImages` after rebuilding images or resetting the cluster. The lower-level `kubernetes-up.ps1` still imports images by default for initial setup.

Application pods have 50m CPU requests and 500m CPU limits. Existing per-service memory limits remain bounded (Java 512 MiB, Python/C#/Node 256 MiB, Go 128 MiB). Keycloak has one CPU core and 640 MiB hard memory available to keep password authentication responsive; its heap remains 256 MiB. PostgreSQL/MongoDB/ClickHouse use half a core, Redis a quarter, Cassandra three quarters. The probe exporter uses a quarter-core, 64 MiB hard memory and a 48 MiB Go soft limit. Database CLI health checks run less frequently; application readiness continues to check actual connectivity.

Daily Cassandra uses two native allocator arenas and a 64 KiB memory-lock limit, allowing WSL to reclaim idle native pages. Its 384 MiB heap, 128 MiB direct-memory cap, 1,280 MiB hard safety limit and persistent volume are retained. The database may emit its expected startup warning that JVM memory could not be locked; this is intentional for the shared desktop. Full mode retains its original memory-lock behavior. The web server uses two workers rather than the host's entire logical-core count. [Verification and efficiency changes](verification-performance.md).

Elasticsearch, Logstash, Kibana, Tempo, Debezium Connect and object storage are stopped. Fluent Bit is unscheduled. Metrics and alerts remain available; logs can be read with `kubectl -n ledgerline-local logs deployment/<service>`. A small collector accepts and drops trace traffic to prevent exporter retry loops. The five per-pod telemetry sidecars are omitted. Log/trace dashboards retain their definitions but their backends are paused; they are not presented as live in this profile. CDC publication is paused; PostgreSQL outbox rows remain durable for the full profile.

The observed WSL working set during the daily deployment was approximately 3.7 GiB (final measurement; about 4 GB during deployment). This is a measurement, not a guaranteed machine-wide limit. Image imports and first-time JVM/database startup cause temporary spikes. Windows/browser memory use also affects available RAM. No global WSL settings, other distributions, or GPU settings are changed.

## Full Kubernetes observability

```powershell
./scripts/kubernetes-up.ps1 -Profile full
```

Restores the complete ELK/Tempo/CDC/object-storage stack, Fluent Bit, and telemetry sidecars. All seven Grafana dashboards and the Kibana dashboard remain provisioned. This profile uses more memory and is intended for observability demonstrations and integration work on this desktop. Production sizing is separate from a single-node workstation profile.

## Compose and stop commands

```powershell
./scripts/runtime-profile.ps1 -Profile daily # app 30080, gateway 30088
./scripts/runtime-profile.ps1 -Profile full  # app 8080, gateway 8088
./scripts/runtime-profile.ps1 -Profile stop # preserves all data volumes
```

Profile switches touch only Ledgerline resources. Kubernetes deployments are scaled down before Compose app containers start. Full/daily mode information is stored in ignored `infra/local/runtime-profile.json` so selective deployment and SMTP updates retain the active resource settings.

Update compiled frontend/notification images without restarting databases:

```powershell
./scripts/package-cached-runtime.ps1 -SkipCompile -Services web,notifications
./scripts/deploy-workbench.ps1 -SkipBuild -Services web,notifications
```

Compile the frontend first with `npm run build`; notification code is copied from its source directory. Cached packaging is a local development fallback. Standard Dockerfiles remain the reproducible build path. Re-run `kubernetes-forward.ps1` after replacing a forwarded pod. After a Docker network change, `refresh-local-endpoints.ps1` refreshes running infrastructure addresses, including Logstash when the full profile is active.

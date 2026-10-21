# Monitoring review — 9 October 2026

The daily profile keeps Prometheus, Grafana, Alertmanager, cAdvisor, kube-state-metrics, database exporters and HTTP/TCP probes active. Elasticsearch, Logstash, Kibana, Tempo and Fluent Bit remain paused to keep the desktop usable. Their dashboard definitions are retained for the full profile. Paused log/trace sources are not evidence of healthy or unhealthy live ingestion; this review uses current Kubernetes/container logs and the active metrics sources.

## Findings and corrections

| Finding | Evidence | Correction |
| --- | --- | --- |
| Verification request was terminated before SMTP completed | Envoy returned HTTP 504 at 5,010 ms; the browser attempted to parse `upstream request timeout` as JSON | Notification route allows 60 seconds, web proxy 70 seconds and browser 65 seconds; errors are parsed defensively and timeout copy advises checking the inbox before resending |
| All probe targets failed together | Blackbox `/metrics` timed out while the five application metric endpoints worked | Exporter now has 64 MiB hard memory, 48 MiB Go soft memory, two Go processors and a quarter-core daily CPU cap; it was recreated independently. HTTP/TCP probing uses IPv4. Readiness and five database probes recovered |
| Stopped Tempo appeared down | Static scrape target remained enabled in daily mode | Profile-aware file discovery removes Tempo only when intentionally paused and restores its target in full mode |
| Occasional Cassandra request timeouts | Notification logs reported a two-second driver deadline and scheduler storage retries | Five-second connection/read deadlines; today's partitions retain 15-second checks, older catch-up scans run every five minutes instead of every tick |
| Java trace export errors in daily mode | Spring/Micrometer continued exporting despite the generic OTEL SDK flag | Explicit Spring `management.tracing.enabled=false` and zero sampling in daily mode; full mode restores both |
| Keycloak approached its container limit | Working set exceeded 90% of the 512 MiB limit | Daily hard limit is 640 MiB while JVM heap stays capped at 256 MiB, leaving native authentication/JVM headroom |
| Cold Grafana dashboard request exceeded the short check timeout | Request cancellation produced permission-hook log warnings; a subsequent request returned the dashboard and all SMTP panels | Daily CPU allowance increased from a quarter to half a core for interactive dashboard queries; memory remains capped at 256 MiB |

New alerts cover probe-exporter availability, failed database TCP probes and SMTP connectivity. Existing service readiness, dependency, server-error and container-memory alerts remain active. The service-performance dashboard adds SMTP acceptance latency beside transport status and delivery outcomes. SMTP connection/authentication success does not prove inbox delivery.

## Verification and deployment

- Production frontend build and defensive-response regression cases pass.
- Focused desktop/mobile journeys cover sidebar collapse/drawer focus, workspace selector visibility, overall/category budgets, themed selectors, notification accessibility and readable gateway errors.
- A local SMTP proxy delays its greeting by seven seconds. Verification through the updated Envoy configuration completed after approximately eleven seconds, the message reached Mailpit, and its code verified successfully. No external email was sent during this check.
- Updates are selective: web/notification images, gateway configuration, Java tracing settings, Keycloak headroom and the probe exporter. Database volumes and real Gmail credentials are preserved.
- Post-rollout snapshot: eight pods ready with zero restarts; all 25 active Prometheus targets up; all five readiness probes, five database TCP probes and five application dependency gauges report 1. SMTP connection/authentication reports 1. No pending/firing alerts or recent errors in the checked core/notification/gateway logs. Promtool validates the configuration and nine alert rules. WSL working set measured approximately 2.9 GiB after rollout; this is a snapshot rather than a machine-wide guarantee.
- Grafana's final dashboard request completed in 2.58 seconds after its CPU adjustment; all four reminder/SMTP panels are provisioned. The final metrics check still shows 25/25 targets up and zero active alerts. The real deployed browser account journey also passes sign-in, expense save/reload, deletion and mobile bounds.

Use `./scripts/deploy-ui-polish.ps1` to build/package and apply these local Kubernetes updates. For reproducible deployment outside the workstation, use the repository Dockerfiles and production manifests rather than cached-image packaging.

After rollouts, inspect live targets at http://localhost:9090/targets and alerts at http://localhost:9093. A recreate deployment briefly produces unavailable metrics/readiness samples; investigate alerts that persist after pods are ready. Read current logs with `kubectl -n ledgerline-local logs deployment/<service> --since=15m`. Switch to the full profile when deliberately inspecting ELK/Tempo ingestion.

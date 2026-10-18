# Service foundations

Each directory is one application microservice with its exclusive database. Java has an initial authenticated bearer-token posting API and a PostgreSQL migration with balanced immutable journal entries, tenant-scoped foreign keys and transactional outbox. It currently supports INR expense/income/same-currency transfers only; workspace onboarding, full security assertions/session wiring, audit/correction flows and API integration remain Phase 1–2 work.

Node/Cassandra implements authenticated private reminder preferences, recipient verification, durable scheduling, SMTP retries and notification history. Python/MongoDB, Go/Redis and C#/ClickHouse currently provide liveness, real database readiness and telemetry, with their product APIs still to build. All service containers build and their databases have been checked in Compose and Kubernetes. See ../docs/email.md and ../implementation/status.md for tested scope and limits.

Java requires POSTGRES_URL, POSTGRES_USER, POSTGRES_PASSWORD, OIDC_ISSUER_URI and OIDC_AUDIENCE. Python requires MONGO_URL. Go requires REDIS_URL. C# requires CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD. Node requires CASSANDRA_HOSTS, CASSANDRA_DC, CASSANDRA_USER, CASSANDRA_PASSWORD. Browser still uses explicitly labeled isolated local demo data.

Containers are development foundations: exact dependency/image digest locking, observability completeness, mesh policies, migrations for non-Java services and security hardening remain required by phases.md before launch.

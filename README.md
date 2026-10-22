# Ledgerline

**Your money. Your commitments. One clear view.**

A sharp, responsive money workbench for everyday personal finances and small-business tracking, with a five-service backend and locally runnable observability.

## Features you can use today

- Account creation, verified email, sign-in, password reset, profile editing and sign-out.
- Private personal and business workspaces, saved in PostgreSQL under your account.
- Expandable desktop sidebar and mobile drawer, aligned workspace controls, light/dark themes and motion that respects reduced-motion preferences.
- Manual expenses, income and same-currency transfers with exact INR arithmetic.
- Create and edit financial accounts, opening balances, monthly summaries, an overall monthly budget, independent category limits and spending charts.
- Bills and subscriptions with due dates, recurring cadence and cancellation.
- Record a bill/subscription payment from a chosen account and date, link it to activity, and track the next recurring cycle in the same save.
- Search/filter all activity with efficient 50/100/250-row pagination, review and correct entries, export CSV/JSON and view saved revision history.
- Edit commitments, reopen cancellations and track the next monthly/yearly cycle after payment.
- Authenticated reminders, recipient email verification, lead times/timezones, scheduled SMTP delivery, inbox/read state and delivery history.
- Nine workbench screens plus matching sign-in/registration flows, light/dark themes, mobile navigation, aligned Lucide icons, themed Radix dropdowns, consistent confirmation dialogs and accessible entry forms.
- Live platform health screen linking to metrics, logs, traces and monitoring alerts.

New accounts start empty. The financial UI reads and saves account-owned PostgreSQL documents; changes commit atomically with revision history and an outbox event. Saves reject stale revisions instead of overwriting another tab. The workbench is a finance tracker; the Java service also exposes a separate immutable double-entry journal API. Editing a tracker record does not edit journal facts. Notifications use Cassandra and sync confirmed commitments while the app is open; scheduled delivery continues afterwards. Capture now suggests categories using MongoDB rules, rates fetches daily public exchange rates and caches them in Redis, and analytics generates category/type reports through ClickHouse. Currency conversion opens from the sidebar on every page and reports have a dedicated page; shared company roles, fully autonomous server-generated renewal cycles, imports and approvals remain in [phases.md](phases.md).

## Five domain services

| Service | Language | Own database |
|---|---|---|
| Core finance | Java / Spring Boot | PostgreSQL |
| Capture and automation | Python / FastAPI | MongoDB |
| Rates and realtime | Go | Redis |
| Analytics | C# / ASP.NET Core | ClickHouse |
| Notifications | Node.js / Fastify | Cassandra |

Envoy provides the API gateway and circuit limits. Kafka + Debezium publish the PostgreSQL transactional outbox. Keycloak provides development API authentication; SeaweedFS provides S3-compatible storage. These supporting tools are infrastructure, not additional domain services.

## Daily desktop mode

```powershell
./scripts/start.ps1
```

App: http://localhost:30080. Run from Windows PowerShell 5.1 or PowerShell 7 after Docker Desktop and Kubernetes are ready; wait for **Ledgerline ready** before opening the URL. Uses one container per service pod, bounded CPU/memory, and one shared set of databases. Prometheus/Grafana/alerts stay active; heavy ELK/trace/CDC tools pause. The observed WSL working set was approximately 4 GB. Use `-Profile full` for the complete observability stack. [Profiles, mode switching and stop commands](docs/runtime-profiles.md).

The notification gateway accommodates SMTP latency and reports clear delivery errors. The service dashboard includes SMTP connectivity, delivery outcomes and provider acceptance latency. [Monitoring review and fixes](docs/monitoring-review.md).

Recipient verification accepts formatted pasted codes and valid recent resends, with account/workspace isolation and clear expiry/attempt errors. Everyday optimizations include exact totals calculated once, visibility-aware polling, deduplicated reminder sync, pooled SMTP, compressed/cached static assets and bounded web workers. [Verification and performance notes](docs/verification-performance.md).

## Run locally

**Everyday startup on the configured desktop:** start Docker Desktop, wait for Kubernetes, then run `./scripts/start.ps1` from this folder and open http://localhost:30080. This runs one copy of the app, refreshes database addresses after Docker restarts, restores browser forwarding, and checks readiness. Avoid Docker Desktop's Start All for the Compose group: it also starts duplicate application containers and the heavy observability stack. Use `./scripts/start.ps1 -ImportImages` after rebuilding images or resetting the Kubernetes cluster.

Requires Docker Desktop, Compose, PowerShell 7, Python and Kubernetes enabled with Docker Desktop's kind provisioner for the Kubernetes command.

```powershell
./scripts/local-up.ps1
./scripts/configure-local-auth.ps1
python scripts/provision-observability.py
./scripts/configure-cdc.ps1
./scripts/verify-finance.ps1
./scripts/verify-notifications.ps1
./scripts/verify-stack.ps1
```

Compose app: http://localhost:8080. First startup downloads several GB and can take several minutes. Random local infrastructure passwords are generated in ignored `infra/local/.env`.

```powershell
./scripts/kubernetes-up.ps1
./scripts/verify-finance.ps1 -Mode kubernetes
./scripts/verify-notifications.ps1 -Mode kubernetes
./scripts/verify-stack.ps1 -Mode kubernetes
```

Kubernetes app: http://localhost:30080. The full profile adds an OpenTelemetry sidecar to each application pod; daily mode uses a shared collector. The gateway/UI run in pods too. Databases and central monitoring stay in Compose, shared through Kubernetes Services, to fit the local 8 GB Docker allocation. The full profile uses Fluent Bit for Kubernetes logs; kube-state-metrics reports actual pod/deployment status in both profiles. See [the running-stack guide](docs/observability.md) for mode switching, troubleshooting and production requirements.

Update just the account workbench and identity theme with `./scripts/deploy-workbench.ps1`. This builds/imports finance and web and restarts those two deployments, instead of restarting the entire application stack. If Docker Hub is unavailable, `./scripts/package-cached-runtime.ps1` compiles with installed Node/Maven and packages into the existing runtime images; then use `./scripts/deploy-workbench.ps1 -SkipBuild`.

## Connect reminders

Create an account from the welcome screen and verify its email, or use the local development account `demo / local-demo-only`. Open **Notifications**, save your recipient/lead time/timezone and verify your recipient address. In Mailpit mode, verification, test and reminder messages appear at http://localhost:8025. Gmail mode sends real email. Registration and password reset use the same SMTP sender through Keycloak.

For the chosen Gmail sender, enable 2-Step Verification and create an app password. Enter it through a hidden local prompt:

```powershell
./scripts/configure-gmail.ps1 -Mode kubernetes -Apply
```

Use `-Mode compose` when running Compose. Credentials stay in the ignored email configuration; do not put passwords in chat or frontend code. [Email setup and delivery behavior](docs/email.md).

If credentials were already saved, apply them without re-entering the password or restarting unrelated services:

```powershell
./scripts/apply-email.ps1 -Mode kubernetes
./scripts/configure-local-auth.ps1
```

## Observe it

| Tool | Address |
|---|---|
| Grafana: seven metrics/logs/traces/Kubernetes dashboards | http://localhost:3000/d/ledgerline-overview |
| Kibana: searchable application logs and dashboard | http://localhost:5601/app/dashboards#/view/ledgerline-logs |
| Prometheus: scrape targets and queries | http://localhost:9090/targets |
| Alertmanager | http://localhost:9093 |
| Mailpit: captured local alert emails | http://localhost:8025 |

Grafana allows local read-only viewing. Admin username: `local-admin`; passwords are in the ignored env file. Monitoring includes service rate/errors/latency, real database readiness, process/container resources, reminder delivery outcomes and SMTP connection/authentication health. The full profile also provides structured log search and distributed traces. SMTP health does not confirm delivery to a recipient inbox. Full-profile metrics/logs retain three days; traces retain 24 hours. Daily metrics retain one day with a 128 MB storage cap. Monitoring alerts stay in Mailpit independently of product SMTP. No paid hosted account is required.

This is a single-node development stack with loopback UI ports. Production TLS, authenticated databases, secret management, HA, backups and the remaining product features still need the gates in [phases.md](phases.md).

## Frontend development and checks

```powershell
npm ci
npm run dev
npm run build
npm test
npm run test:e2e
npm test --prefix services/notifications
```

Dev UI: http://127.0.0.1:5173. Startup scripts select its API proxy through ignored `.env.local`: Compose uses 8088; Kubernetes starts a gateway forward on 30088. React, TypeScript, Tailwind, Lucide and GSAP implement the interface. Tests cover finance rules, desktop/mobile journeys, persistence, workspace isolation, once-only payments, accessibility, icon alignment and timezone-aware reminder scheduling.

Detailed specifications: [design](design.md), [product/features](docs/product.md), [architecture](docs/architecture.md), [pages](docs/pages.md), [implementation status](implementation/status.md).

Assignment service walkthrough: [demo guide](docs/assignment-demo.md). Run `python scripts/verify-assignment-services.py` after daily startup to check the three workflows.
# Navigation update

Use **Currency converter** in the sidebar from any page to convert, swap currencies, and copy the result and rate. Open **Reports** to filter a date range, generate category totals with ClickHouse, and export CSV. `/login` and `/signup` are convenient entry URLs for the existing Keycloak authentication flow.


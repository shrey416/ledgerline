# Ledgerline implementation phases

This is the execution plan for Codex. All 108 feature requirements in `docs/product.md` remain required. Phases establish dependencies and review gates; they do not silently reduce scope. Status is evidence-based and must be updated after implementation. No MCP or Antigravity setup is needed.

## Product review: daily use and business suitability

The plan supports useful daily habits: quick expense entry, checking upcoming bills, confirming imported charges, reviewing budget availability and saving receipts. The primary interface must prioritize these five tasks. Personal users should not encounter claim policies, departments, fiscal closing or tax configuration until they select the appropriate workspace/features. Business users need the same reliable transaction model plus evidence, independent approval, reimbursement tracking and scoped access.

Verified design decisions: bills are obligations rather than spend; subscription predictions do not create financial facts; transfers and settlements do not inflate spending; refunds link to original expenses; booked rates stay historical; categorization suggestions remain editable; reminders use durable scheduling and current eligibility. These prevent common contradictions between modules. “Verification” here is a specification review, not user research or proof of production readiness. Actual usability requires the journey tests and later feedback below.

Usability gates: a new user records a basic expense with five required choices or fewer; business fields stay collapsed in personal mode; upcoming amounts and dates are visible without navigating through settings; all calculations have explanations; failed saves preserve input; mobile users can capture receipts and record spending one-handed; every major table has search/filter and useful empty states. No decorative feature may obscure actionable information.

## Phase 0 — repository and product foundation

Deliver monorepo structure, reproducible package/build commands, shared contracts and feature/page tracking. Preserve architecture and design specifications. Resolve ambiguities into explicit decisions. Add a first working frontend with the sharp ledger design and a clearly labeled isolated browser demo store. The demo establishes interaction quality and does not substitute for production persistence/authentication.

Gate: frontend installs/builds; real add/edit/archive/filter interactions persist in demo; desktop/mobile layouts are usable; money and expense/transfer semantics have tests. Service boundaries and five database ownership are documented.

## Phase 1 — five-service runtime and secured platform

Implement Java/Spring/PostgreSQL, Python/FastAPI/MongoDB, Go/Redis, C#/ASP.NET/ClickHouse and Node/TypeScript/Cassandra service images. Provide health/readiness, owning-database access, migrations, structured logs, OpenAPI and graceful termination. Kubernetes Deployments/Services/configuration/network policy and local bootstrap precede production claims. Introduce gateway/CoreDNS discovery/OIDC session/authorization and Linkerd workload identity. No extra domain service or shared database.

Gate: all five images build, real DB readiness passes on Kubernetes, authorized/unauthorized traffic tested, private services cannot be reached publicly. Secure deployment prerequisites are not bypassed by trusting arbitrary identity headers.

## Phase 2 — reliable financial core

F001–F012, F023, F030, F031. Java owns workspaces, membership, accounts, exact-decimal balanced postings, expense/income/refund/transfer/splits, historical rates, idempotency and audit. Replace frontend demo repository with generated real API client while retaining isolated demo mode. Add PostgreSQL transaction/concurrency tests and object scope checks.

Gate: repeated timed-out save cannot duplicate spend; postings balance; same/cross-currency transfers exclude principal from spend; conflicts and locked periods are explicit; real state survives process restart. Pages 01–11 fully integrated.

## Phase 3 — obligations and durable reminders

F013–F020, F027, F032–F034, F061,F062,F066,F071–F074,F095,F106. Shared recurrence model, bill payments/credits, subscriptions/trials/price history, calendar. Implement transactional outbox/CDC/Kafka, Cassandra notification intents, inbox and SMTP/SES delivery with eligibility preflight. Go SSE invalidation and quote freshness.

Gate: month ends/DST handled; paid/canceled/rescheduled reminder suppressed; partial payments correct; no predicted amount appears as posted spend; email ambiguity is recorded honestly. Pages 12–16 and 42 integrated.

## Phase 4 — budgets, goals and household planning

F021,F022,F035–F038,F064,F065,F083–F085,F091,F093,F096,F102,F108. Allocations/rollover/moves, goals, settlements and forecast assumptions. Analytics read model with deduplication and exact reconciliation. Personal dashboards prioritize next actions.

Gate: shared settlement isn't extra spend; safe-to-spend excludes overlapping commitments; forecast distinguishes estimate from actual; replayed analytics doesn't double-count. Pages 17–21 and personal reports/review integrated.

## Phase 5 — capture and lightweight automation

F024–F026,F051–F057,F063,F067–F069,F076,F079,F092,F098,F103. Python staged CSV/OFX imports, duplicate review, receipt quarantine/OCR, bank sandbox adapter, deterministic rules and recurring suggestions. User confirmation precedes financial posting. CPU limits and bounded job memory.

Gate: crash between Java commit and Mongo checkpoint replays safely; malicious attachments quarantined; user category cannot be overwritten; import counts reconcile; sandbox connection and disconnect work. Pages 34–41 integrated.

## Phase 6 — business spending controls

F039–F047,F058,F060,F081,F082,F089,F090,F097. Department/project scope, vendor directory, claims and policy snapshots, independent approvals/delegation, reimbursement tracking, tax lines and period closing. Business behavior builds on the same ledger.

Gate: no self-approval; duplicate approval can't advance twice; employee cannot view another scoped claim; payment records don't imply actual bank transfer; closing/reopening audited. Pages 22–30 and 43–44 integrated.

## Phase 7 — reporting, portability and integrations

F028,F048–F050,F075,F077,F078,F080,F094,F104. ClickHouse facts/query builder and presets, drill-down, accounting exports, signed webhooks, scoped tokens and scheduled report delivery. Freshness/checkpoint shown everywhere analytical.

Gate: ledger/export/report agree for transfers/refunds/corrections and multiple currencies; report shares reauthorize at download; webhook SSRF and signature tests pass. Pages 31–33 and 47 integrated.

## Phase 8 — privacy, accessibility and completeness

F029,F059,F070,F086–F088,F099–F101,F105,F107 plus remaining catalogue coverage. Retention holds/purge acknowledgements, consent/device controls, local draft privacy, demo/reset, help, custom preferences, recovery tooling. Audit all 48 product templates and 3 utility templates for every applicable state.

Gate: keyboard/mobile/200% zoom/both themes/reduced motion verified; deletion cannot resurrect via replay; removed member loses SSE and downloadable report access; all feature IDs have implementation/test evidence.

## Phase 9 — production validation and launch

Prometheus/Grafana/Alertmanager, Fluent Bit/Logstash/Elasticsearch/Kibana and OTel/Tempo. Infrastructure backups, rollback, secrets rotation, CI/CD, load tests, fault drills, reconciliation and restore rehearsal. Configure providers/domains only with real credentials and approved target environment.

Gate: stated SLO workload measured, restored data reconciles, image/contract/security gates pass, each feature/status row supported by evidence, all known issues disclosed. Do not label a local demo or scaffold “production ready.”

## Current execution status

**Account milestone accepted after recovery:** the user approved restarting Docker Desktop. Network endpoint refresh fixed stale database addresses. Finance/web rolled out with the account implementation and Keycloak's theme/registration/reset settings. Real two-user API isolation, persistent save/reload, replay/stale-write/invalid-data/anonymous rejection and real browser PKCE expense save/reload/deletion passed. Gmail SMTP authenticated over TLS. The log collector rollout succeeded after stale connection recovery. The eight focused desktop/mobile checks passed against the UI API fixture. These are account/core acceptance checks, not completion of the full product catalogue or proof of public production readiness.

**Account/core workbench implementation (2026-10-08):** welcome and themed identity forms, registration/email verification/password reset/profile actions, private PostgreSQL workbench per verified OIDC subject, atomic revision/history/outbox writes, stale-write rejection and request replay protection. The frontend waits for save acknowledgement; new users start empty. Added financial-account CRUD, transaction correction/deletion, commitment edits/cancellation/reopening, explicit next-cycle creation, account/workspace settings and CSV/JSON exports. Native Java and frontend builds pass. Updated UI journeys use an explicit account API fixture, with live owner-isolation/browser scripts supplied separately. Docker Hub timeouts and an unresponsive Docker Desktop/WSL runtime currently block accepting the new live deployment; WSL reported 0x8007274c. Earlier demo-suite evidence below is historical, not acceptance of the new account backend. Full catalogue and production gates remain incomplete.

**Phase 0 in progress:** eight screens, exact money rules, personal/business isolation, browser finance persistence, CSV export, responsive styling and aligned Lucide controls. Production frontend build passes; four finance tests, three reminder tests and 18 desktop/mobile browser tests pass, including automated accessibility, keyboard, mobile bounds and icon geometry checks. Root and notifications npm audits report zero vulnerabilities after dependency updates. These checks do not establish complete feature coverage or production security.

**Phase 1 in progress:** all five service images build and pass real database readiness. Compose and Docker Desktop Kubernetes runtime checks pass. Java authenticated posting, balanced journals, replay/conflict handling and tenant isolation were tested against PostgreSQL in both modes. Kafka/Debezium publish actual outbox events. Node/Cassandra reminder preferences, verification, durable scheduling, SMTP delivery and private inbox now work; Python, Go and C# product APIs remain future work.

**Phase 3/9 partial runtime evidence:** five domain pods each run an application plus OTel sidecar; gateway/web, Fluent Bit and kube-state-metrics run in pods too. Shared Compose databases/observability conserve local resources. Seven Grafana dashboards, ELK/Kibana logs, Prometheus/Alertmanager, Tempo traces, container metrics and a real failure→email→restoration drill are verified. Browser PKCE notification sign-in and reminder integration tests pass in Kubernetes. Gmail is configured through a local secure-prompt helper; the sender app password and actual external delivery are pending. See implementation/status.md and docs/email.md for exact limits. No full product or production phase is marked complete.


## UI and efficient runtime milestone — 9 Oct 2026

Implemented overall/category budget separation, themed Radix selectors, consistent confirmations, account/date payment recording with atomic next-cycle creation, 1,000-cycle history with 100 active commitments, and lazy-loaded workbench code. Keycloak controls use standard Lucide assets; validation geometry remains fixed. Notification code saves the edited recipient before sending, normalizes addresses, limits resends, conditionally claims verification attempts, cleans failed challenges, and distinguishes identity availability failures. SMTP authentication health is exported to Prometheus/Grafana.

Daily Kubernetes uses one container per domain pod and eight ready workloads. Compose application copies and heavy ELK/Tempo/CDC tools pause; full mode retains all observability integrations. See docs/runtime-profiles.md. Remaining production catalogue: server-driven reminder reconciliation, imports/categorization, team access/approvals, live FX, receipt processing and analytics. This milestone does not certify those foundations as complete product workflows.


Milestone evidence: Java build and frontend production build pass; seven finance unit cases and three reminder-rule cases pass; desktop/mobile workspace, payment and budget/dropdown journeys pass in focused runs. Live PostgreSQL account save/reload, two-user isolation, idempotent replay, stale revisions and invalid/anonymous requests pass. Real Keycloak registration/login toggles and minimum-length field geometry pass; no test account was created. Mailpit-only verification/code rejection/cooldown, scheduled delivery, deduplication, inbox and cross-user isolation pass. Gmail SMTP connection/authentication metric reports 1; this does not prove external inbox delivery. Daily Kubernetes has eight ready pods with no restarts in this rollout. Remaining feature catalogue still requires implementation and acceptance gates.

Final runtime snapshot: daily profile served by the UI, 8/8 Kubernetes pods ready, 5/5 Prometheus service targets up, and WSL working set 3.65 GiB. Heavy observability containers remain stopped.

Final deployed browser journey also passes: real PKCE sign-in, lazy workbench loading, confirmed expense save, reload persistence, themed deletion confirmation and mobile bounds.

### 9 Oct: navigation and notification gateway finish

- Delivered expandable desktop/mobile navigation, aligned workspace controls, bottom system tools, a dedicated overall-budget card and consistent reduced-motion-aware card/text/dialog transitions.
- Fixed SMTP gateway timeout and plain-text error parsing; delayed local SMTP regression verifies code delivery through Envoy.
- Restored readiness/database probes, profile-aware Tempo discovery, SMTP latency visibility and dedicated probe/mail alerts. Daily-mode Spring tracing is disabled explicitly; reminder history polling is reduced.
- Selective Kubernetes rollout has eight ready pods, 25 active metrics targets up, all ten probes succeeding and no active alerts at the recorded snapshot. ELK/Tempo remain paused in daily mode.

The remaining catalogue and production hosting gates above are unchanged; this milestone completes the requested UI/mail/observability corrections, not all roadmap features.

### 10 Oct: recipient verification and everyday efficiency

- Fixed resends invalidating recent correct codes, formatted-input truncation, confirmation retry failures and pre-authentication verification rate limits. Cassandra keeps three scoped expiring hashes with conditional cooldown/attempt updates and migration of unexpired old codes.
- Delivered single-pass exact finance totals, bounded activity pagination with all-record search/export, cached formatters, visibility-aware non-overlapping polling, unchanged-projection reminder sync, fewer conditional queue writes, pooled SMTP, compressed immutable assets and two Nginx workers.
- Daily Cassandra can reclaim idle native memory; original data volume, heap/direct-memory caps and hard limit remain intact. Docker network recovery also refreshes Prometheus discovery automatically.
- Focused checks pass: nine notification service cases, six frontend cases, six desktop/mobile journeys and actual Envoy/Cassandra/Mailpit verification including wrong-code rejection, formatted correct-code acceptance and retry persistence. External Gmail mail was not sent by the regression.
- Details and actual runtime limitations are recorded in docs/verification-performance.md. Remaining product catalogue and hosting gates are unchanged.

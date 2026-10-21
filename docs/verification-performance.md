# Verification and desktop performance — 10 October 2026

## Verification corrections

The previous implementation stored one hash per workspace: every resend replaced the previous code immediately, confirmation spent an attempt even for a correct code, and deleting a confirmed challenge made a retry after a lost response fail. The UI also truncated formatted pasted input before removing separators. All these cases are now handled explicitly.

- Cassandra `verification_sessions` stores at most three recent hashes per account/workspace, with a separate ten-minute expiry for each. Plain codes are never stored or logged.
- New hashes bind account, workspace, recipient and code. Emails name the workspace and recipient to distinguish personal and business verification messages.
- Cooldown and attempt counts use conditional writes across service replicas. Wrong guesses spend one of five attempts; correct submissions do not. Concurrent updates retry a bounded number of times. Resend does not reset a live attempt limit.
- Retried correct confirmations are idempotent until expiry. A simultaneous finance sync cannot permanently consume the valid code through a preference-version conflict.
- Unexpired codes issued by the previous deployment are read during migration. Failed SMTP submission removes only its own challenge.
- API errors distinguish missing digits, changed recipient, wrong code, expiry, exhausted attempts and cooldown. Frontend accepts pasted spaces/hyphens/fullwidth digits before applying the six-digit bound and submits the saved recipient address.
- Verification throttling runs after authentication, so different accounts behind one gateway do not share the same IP limit. The durable one-minute cooldown remains cross-replica; the three-per-hour request limit is per process. Public deployment still requires shared gateway rate limiting.
- Token refresh and commitment sync no longer overwrite unsaved notification fields. Background reads skip overlap; explicit post-write refresh waits for any earlier read and reloads the new state. Late reads from another workspace are ignored.

## Optimizations preserving behavior

| Area | Change | Behavior preserved |
|---|---|---|
| Activity | Render 50 rows by default; choose 100/250; reset page after filters change | Search, expense totals and export use all records; every page is accessible |
| Finance totals | Memoized single-pass Decimal aggregation for monthly/category spend and all account balances | Exact cents, transfer handling and exclusion of future entries from current balances |
| Formatting | Reuse currency/date formatters and a bounded 64-entry timezone formatter cache | Same currency display and DST-aware reminder time |
| Reminder sync | Sync only the reminder-owned projection; unchanged successful projections resync every five minutes | Changes sync immediately; retries, foreground catch-up and periodic repair remain |
| Background tabs | Pause browser polling when hidden/offline and resume on visibility/connectivity | Cassandra's durable reminder worker continues independently |
| Cassandra | Avoid rewriting identical preferences/source snapshots; existing non-canceled jobs skip a second conditional transaction | Enqueue repair remains after unchanged sync; canceled eligible cycles may resume; deduplication retained |
| SMTP | Bounded pool of two TLS/authenticated connections, 50 messages per connection | Same sender, TLS requirement, provider timeout, delivery metrics and retries |
| Web delivery | Gzip text assets; immutable caching only for content-hashed files; uncached runtime configuration | Updated app shell revalidates; authenticated API responses are not placed in the asset cache |
| Nginx | Two workers rather than one per host logical core | 1,024 connections per worker and horizontal pod scaling |
| Logging | Skip successful notification probes/scrapes and duplicate automatic request logs | Request/dependency metrics, application request logs and failed probes remain |
| Cassandra native memory | Daily-only two allocator arenas and 64 KiB memory-lock limit allow idle pages to be reclaimed | Same heap/direct caps, CPU budget, hard memory limit and persisted data; full profile retains original settings |
| Runtime recovery | Refresh Prometheus file discovery with Kubernetes infrastructure addresses after Docker network changes | Same dashboards, probes and alerts; Compose monitoring mode is not switched implicitly |

No database volume, account data, Gmail credential, service boundary, monitoring dashboard or application feature is removed. Existing daily/full profile behavior is retained. GPU memory is unused.

## Verification evidence

Focused service tests cover old-code-after-resend, individual expiry, formatted input, account/workspace/email isolation, concurrent cooldown reservations, wrong-attempt counting, failed-resend cleanup, old-deployment migration, timezone behavior and account-aware rate limits. Frontend checks compare exact optimized totals with the existing accounting functions and exercise reminder projections and pasted codes.

The actual Envoy → notification service → Cassandra/Mailpit regression returned success after a deliberately seven-second SMTP greeting (9.5 seconds total): a wrong code was rejected, the formatted correct code succeeded, a repeated confirmation succeeded, and verified state persisted. All test messages went to Mailpit; no external Gmail message was sent.

Docker initially was unavailable. After it resumed, stale infrastructure EndpointSlices caused database connection failures. Refreshing those addresses restored all eight application/monitoring pods. The selective rollout preserves live Gmail configuration.

Cassandra also had a real memory warning at approximately 1.12 GiB of its 1.25 GiB limit, with over 2 GiB of virtual memory locked. The daily-only adjustment removed those locked pages while retaining all data. The allocator setting is supported by [Apache Cassandra's environment configuration](https://github.com/apache/cassandra/blob/trunk/conf/cassandra-env.sh). The single-node desktop deliberately allows reclaim/swap under host pressure; production sizing and memory-lock policy remain separate.

After recovery, Cassandra measured 612.1 MiB with zero locked memory and no swap, compared with approximately 1.12 GiB before the adjustment. WSL's measured working set fell from about 4.06 GiB to 3.27 GiB. These are same-session snapshots rather than a benchmark or guaranteed ceiling. The verification regression passed again after this database restart (7.5 seconds total). Curl confirmed gzip delivery and immutable caching on hashed JavaScript assets.

The final Mailpit regression also enabled reminders, synced a due-today commitment repeatedly and confirmed exactly one SMTP message plus durable inbox delivery. This validates the optimized unchanged-save path, pooled transport and queue deduplication together. Fixture commitments and temporary containers were cleaned up afterwards.

Final health snapshot: eight Kubernetes pods ready, 25/25 Prometheus targets up, all five database-dependency gauges at 1 and Gmail connection/authentication gauge at 1. The Cassandra memory alert cleared. A trailing `ElevatedServerErrors` warning for notifications reflected six failed readiness requests during the deliberate Cassandra restart; there were no new 5xx responses in the one-minute window or notification error logs in the preceding two minutes. Its five-minute error-rate window is allowed to age out normally; alert thresholds are unchanged.

Final follow-up: the trailing warning cleared naturally. Active alerts: **0**; deployed web response: **HTTP 200**.

All six focused desktop/mobile browser checks passed across the two runs: notification accessibility, formatted code submission with saved recipient, and 123-row activity pagination/search. The mobile pagination test was corrected to await the reloaded app shell before opening navigation. The optimized Nginx configuration validates and its deployed process list contains exactly two workers.

These are targeted fixes and checks, not certification of every remaining production roadmap item. Runtime memory fluctuates with database startup, browser checks and image imports; lower repeated work is not a guarantee about total Windows memory usage.
# Null-expiry verification repair — 10 October 2026

Older Cassandra verification rows can exist with an attempts counter but no expiry timestamp. The compatibility reader previously called `getTime()` on that null value, blocking a fresh code request. It now migrates only complete, unexpired challenges with valid dates, recipient addresses and hashes; incomplete records are treated as absent. Valid older codes keep their original expiry and attempt count.

Regression coverage includes null/missing/invalid/expired dates and missing recipient/hash fields. `scripts/verify-verification-storage.mjs` reproduces an attempts-only row in real Cassandra, verifies fresh issuance and repeat confirmation, and removes its synthetic partitions. It sends no email. The gateway regression separately checks local SMTP delivery and confirmation through Mailpit.


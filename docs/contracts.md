# Contracts, data semantics and consistency tests

## 1. Global API contract

Publish OpenAPI for each service, AsyncAPI for Kafka, JSON Schemas for payloads, and protobuf definitions for internal gRPC. All APIs are versioned. Contract code generation is checked in or reproduced deterministically in CI. IDs are strings; money is a decimal string plus currency code; timestamps are RFC3339 UTC; due dates are ISO local dates with timezone separately. Unknown fields are handled according to schema compatibility policy, never silently accepted as new authorization fields.

Public prefix: `/api/v1/{core|capture|rates|analytics|notifications}`. Tenant is selected by route/header but authorized from the session and membership; it is never trusted from arbitrary body data. Every mutation requires CSRF protection when cookie-authenticated. Machine tokens use scoped bearer authentication. Each response includes request/trace ID. Lists use opaque cursor, limit capped at 200, deterministic sort tie-breaker and permission-scoped counts.

Errors use RFC 9457 problem details: type/title/status/detail/instance plus code, traceId, fieldErrors, retryable and operationId. Distinguish validation 422, invalid session 401, permission 403, missing object 404, optimistic version conflict 409, precondition missing 428, rate limit 429 and temporarily unavailable 503. Avoid revealing object existence across tenants. An accepted background operation returns 202 with status URL.

Commands require `Idempotency-Key` and payload digest. Same key + same authorized command returns original result; same key + changed payload returns conflict. Idempotency rows include tenant, actor, command type, digest, result reference/status and retention longer than supported retry window. Use stable operation IDs for imports and external callbacks. Never retry a non-idempotent command automatically. Updates include `If-Match`/version; conflict returns latest permitted version and changed-field summary for explicit merge.

## 2. Required endpoint families

Implement these resources with list/get/create/update/archive/reversal semantics appropriate to each state machine. This is an endpoint inventory, not permission to expose generic unrestricted CRUD.

| Owner | Resource groups and command actions |
|---|---|
| J | `/session`, `/workspaces`, `/members`, `/invitations`, `/permissions`, `/preferences`, `/api-tokens`, `/shares`, `/consents` |
| J | `/accounts`, `/opening-balances`, `/reconciliations`, `/account-merge-previews`, `/transactions`, `/transfers`, `/refunds`, `/reversals`, `/splits`, `/tax-lines`, `/periods` |
| J | `/categories`, `/tags`, `/merchants`, `/vendors`, `/custom-fields`, `/templates`, `/comments`, `/audit` |
| J | `/bills`, `/bill-occurrences`, `/bill-payments`, `/bill-credits`, `/subscriptions`, `/subscription-prices`, `/subscription-decisions`, `/occurrences`, `/calendar-grants` |
| J | `/budgets`, `/budget-periods`, `/allocation-moves`, `/goals`, `/goal-contributions`, `/planned-purchases`, `/shared-expenses`, `/settlements` |
| J | `/dimensions`, `/claims`, `/claim-expenses`, `/policies`, `/approval-workflows`, `/approval-tasks`, `/delegations`, `/reimbursements` |
| J | `/report-definitions`, `/report-schedules`, `/integration-enrollments`, `/notification-preferences`, `/jobs`, `/exports`, `/retention`, `/deletion-requests`, `/demo` |
| P | `/imports`, `/import-rows`, `/import-mappings`, `/import-confirmations`, `/receipts`, `/receipt-extractions`, `/attachments`, `/rules`, `/rule-tests`, `/suggestions`, `/recurring-candidates`, `/bank-syncs`, `/inbound-email` |
| G | `/currencies`, `/quotes/latest`, `/quotes/historical`, `/conversion-preview`, `/stream`, `/stream-health` |
| C | `/metrics`, `/reports/query`, `/reports/export`, `/forecast`, `/scenarios`, `/projection-status`, internal `/rebuilds` |
| N | `/inbox`, `/read-state`, `/delivery-status`, `/reminder-preview`, `/test-delivery`, `/push-subscriptions`, `/webhook-deliveries`, signed `/provider-callbacks` |

Representative commands: `POST /bills/{id}/payments`, `POST /claims/{id}/submit`, `POST /approval-tasks/{id}/approve`, `POST /subscriptions/{id}/cancel`, `POST /transactions/{id}/reverse`, `POST /imports/{id}/confirm`. Authorization runs inside the command transaction or via checked authoritative state so race-prone preflight isn't the only defense.

## 3. Example money and posting contract

```json
{
  "workspaceId": "ws_01",
  "kind": "expense",
  "effectiveDate": "2026-10-07",
  "accountId": "acct_01",
  "merchantId": "merchant_01",
  "original": {"amount": "24.99", "currency": "USD"},
  "accountAmount": {"amount": "2100.00", "currency": "INR"},
  "fxEvidence": {
    "kind": "actual_bank_amount",
    "referenceProvider": "frankfurter-v2",
    "referenceDate": "2026-10-06",
    "fetchedAt": "2026-10-07T09:10:00Z",
    "referenceRate": "83.80000000"
  },
  "splits": [
    {"categoryId": "cat_software", "amount": "20.00"},
    {"categoryId": "cat_training", "amount": "4.99"}
  ],
  "receiptIds": ["receipt_01"],
  "expectedVersion": 0
}
```

Illustrative rate and amount are test fixtures, not current market claims. Server derives final booked base and postings; client cannot inject arbitrary debit/credit lines. For an expense: debit expense allocation(s), credit funding account; income reverses economic direction; transfer debits destination/credits source and posts fee separately. Loan/credit accounting distinguishes principal, liability and interest. Tax gross/net/recoverable amounts are allocations with clear reporting treatment, not extra spend.

Balance postings in functional/base currency, with explicit FX rounding/gain/loss accounts for cross-currency differences and preserved source-currency amounts. Do not require one currency's nominal amount to equal another's. Decimal conversion uses defined precision, rounding mode (half-even default) and final currency exponent. Split remainder goes to selected residual line or stable largest-remainder rule and is shown before posting. Rounding policy is shared in cross-language golden fixtures.

Ledger reporting definitions: net spending includes expense category allocations less linked received refunds, excluding transfer principal, opening entries and goal allocations. Cash flow follows account cash movements, including transfers only when crossing selected account perimeter. Bills outstanding = gross + recorded fees - received credits - allocated payments. Approved reimbursement outstanding = approved amount - recorded reimbursements. Future prediction is never journal activity.

## 4. Core relational entities and constraints

Minimum tables: workspace, identity_profile, membership, membership_scope, invitation, preference, account, merchant, vendor, category, tag, journal_transaction, journal_line, expense_allocation, tax_line, transaction_link, financial_correction, fx_snapshot, statement_reconciliation, bill_series, bill_occurrence, bill_payment_allocation, bill_credit, subscription, subscription_price, occurrence, schedule_exception, budget, budget_period, allocation_move, goal, contribution, shared_share, settlement, dimension, claim, claim_item, policy_version, approval_stage, approval_task, approval_transition, delegation, reimbursement, comment, report_definition, report_schedule, integration_enrollment, secret_reference, reminder_preference, calendar_grant, api_token, retention_hold, job, audit_record, command_result, consumer_inbox, outbox_event.

Constraints: unique external source identity; unique series + due date + schedule version occurrence; unique command result key; claim item cannot simultaneously be in two active claims; posted journal balanced; positive allocations within allowed magnitude; bill payment/credit cannot exceed permitted balance under lock; one active approval stage; inviter cannot grant higher authority; last workspace owner preserved; foreign IDs match workspace. Soft archive metadata, immutable retained financial facts and explicit purge workflows coexist.

## 5. Mongo, Redis, ClickHouse and Cassandra models

Mongo collections: imports, import_rows, mapping_versions, receipts, extraction_versions, rule_versions, merchant_maps, suggestions, recurring_candidates, sync_runs, inbox_email, outbox. Documents store version/status, created/updated times, workspace and actor, source references and safe processing metadata. Binary content uses object storage. Indexes and schema validation are version-controlled migrations. Encrypted provider credentials live in Java; Python obtains short-lived credential material only via authenticated authorized internal operation and never logs it.

Redis keys are namespaced: `fx:{provider}:{base}:{quote}:{date}`, `fx:latest:{provider}`, `fx:lease:{provider}`, `rt:workspace:{id}:stream`, `rt:connection:{id}`, `provider:quota:{id}`. TTLs and size caps are explicit. Currency historical cache expiry can be long; realtime resume 10 minutes maximum initially. Cache eviction cannot lose authoritative operations. Never allow frontend to access Redis directly.

ClickHouse fact schema includes workspace_id, source_entity_id, source_version, event_id, deleted flag, immutable created_month, effective_date, account/category/vendor/project/department IDs, amount/currency/base amount, record type, source_updated_at and dataset_epoch. Store currency as code and decimal values as precise Decimal or integer minor units with exponent. Maintain separate fact grains (transaction, allocation, occurrence, approval transition); prevent joins that multiply totals. Dimension names can be event snapshots or versioned small projections; rename semantics stated in query mode.

Cassandra illustrative tables:

```sql
CREATE TABLE delivery_state (
  intent_id text,
  record_kind text,
  attempt_no int,
  workspace_id text,
  recipient_id text,
  state text,
  source_version bigint,
  lease_until timestamp,
  next_attempt_at timestamp,
  provider_message_id text,
  PRIMARY KEY ((intent_id), record_kind, attempt_no)
);
CREATE TABLE inbox_by_recipient_month (
  workspace_id text,
  recipient_id text,
  month text,
  created_at timestamp,
  intent_id text,
  template_key text,
  read_at timestamp,
  PRIMARY KEY ((workspace_id, recipient_id, month), created_at, intent_id)
) WITH CLUSTERING ORDER BY (created_at DESC, intent_id ASC);
```

Additional query tables cover due-retry buckets, provider-message lookups and suppression. Partition retry buckets by date/hour/shard with bounded retention. Inbox pagination bridges months using opaque cursors. Read state resides on durable primary intent plus repairable inbox copy. LWT claim transitions are on primary row, not global uniqueness across all buckets. Cassandra TTL/compaction/tombstone policy must be tested under expiry workloads.

## 6. Event envelope and catalogue

```json
{
  "eventId": "evt_01",
  "eventType": "finance.transaction.posted",
  "schemaVersion": 1,
  "workspaceId": "ws_01",
  "aggregateType": "transaction",
  "aggregateId": "tx_01",
  "aggregateVersion": 1,
  "occurredAt": "2026-10-07T09:12:00Z",
  "producer": "core-finance",
  "traceparent": "00-<trace-id>-<span-id>-01",
  "causationId": "command_01",
  "correlationId": "import_01",
  "data": {"kind": "expense", "baseAmount": "2100.00", "baseCurrency": "INR"}
}
```

Real schemas specify complete payloads; example is abbreviated. Required event families: workspace/member/preferences changed; account/category/vendor/dimension changed; transaction posted/metadata changed/reversed; bill created/updated/paid/credited/disputed; subscription created/price changed/lifecycle changed; occurrence due/rescheduled/fulfilled; reminder intent created/invalidated; budget/goal changed; claim submitted/returned/approved/rejected; reimbursement recorded; rule/suggestion changed; import progress/completed; receipt scanned/extraction completed/quarantined; integration health/sync changed; notification persisted/delivery changed; report job requested/completed/failed; retention purge requested/acknowledged and workspace deleted.

Each event lists producer, consumers, partition key, schema, PII fields, ordering assumption, retention and replay behavior in `contracts/asyncapi.yaml`. Never publish access/refresh tokens, raw attachments, full bank credentials or passwords. Store transactional consumer inbox where effects need idempotency; projection consumers reject stale source versions. Poison events go to DLQ after bounded retries, preserve original ID/payload hash/redacted error and allow authorized replay.

## 7. gRPC methods

`Authorization.CheckScope(subject, workspace, capability, objectId)` returns permitted scope/version/expiry, not a blanket allow boolean when department constraints exist. `Rates.GetQuote(base, quote, date, mode)` returns decimal rate, provenance and freshness. `Notifications.CheckEligibility(intentId, recipient, occurrence, scheduleVersion)` returns eligible/defer/suppress plus current preference snapshot. `Attachments.CheckReady` may be REST or gRPC but must validate workspace, safety state and file version. All calls authenticate workload identity, forward user intent where relevant, use deadlines and attach trace context.

## 8. State machines

Transaction: draft → posted → corrected/reversed via new posting. Metadata edits increment version and audit. Deletion of posted row prohibited.

Bill occurrence: draft → open → partially_paid → paid; open/partial can be disputed; void requires absence/reversal of allocated payment and justification; received credit modifies remaining balance. Overdue is derived from local date plus remaining amount, not independently writable status.

Subscription: trial → active → pause_scheduled/paused → active; trial/active → cancellation_requested → cancellation_confirmed/effective_canceled. Requested is not externally confirmed. Renewal status and next bill occurrence are separate. Price changes have effective dates; backdated corrections keep history.

Claim: draft → submitted → stage_review → approved → payable → partially_reimbursed → reimbursed. Review can return/reject/hold; return creates editable revision and resubmission snapshot. No stage can approve itself; policy/delegation snapshot validated at decision time. Approved original currency/base amounts cannot be silently edited.

Import: uploaded → scanning → parsing → mapping_required → review → confirming → completed/completed_with_errors; recoverable failures retain staged state; canceled before posting removes only uncommitted candidates. Receipt: uploaded → quarantine/scanning → processing → needs_review/ready → linked; extraction corrections create new version.

Delivery: pending → claimed → sent/delivered or retry_wait/unknown/failed/suppressed; provider callbacks monotonic and signature validated; delivered cannot regress to pending. Marking inbox read does not imply financial obligation paid. Jobs have queued/running/cancel_requested/completed/failed states with checkpoint and result references.

## 9. High-risk workflow examples

**Renewal reminder:** Java materializes occurrence and due intent atomically; outbox CDC publishes; Node persists deterministic intent and retry/index state; before provider call Node checks current Java eligibility; sends and records attempts; inbox invalidation reaches Go; browser refetches center. Payment after intent creation suppresses send through preflight. A payment during external send is an unavoidable race; audit records source version and timing, and message wording links to current state.

**Bill payment:** Java locks bill remaining amount and relevant account state, validates authorized source, either links a matching existing unallocated transaction or posts a new balanced one, allocates amount, advances version/audit/outbox and commits. Analytics/event updates happen later. Creating separate expense then separate bill payment without idempotent linking is prohibited.

**Approval:** Java locks current task/stage, validates membership, independent reviewer, amount scope, delegation and snapshot; persists decision and next task in one transaction; CDC triggers notifications and analytics. A duplicate approval returns completed original result; a stale opposing decision receives conflict.

**Projection correction:** update category/effective date emits higher version with complete projection fields. C# stores latest fact version; aggregates resolve version before filtering; old category/date totals decrease and new increase. Replay/duplicate/tombstone tests prove no inflation. Operational financial totals remain available from Java while analytics catches up.

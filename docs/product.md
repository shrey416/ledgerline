# Ledgerline product requirements

## 1. Product charter and scope

Build one coherent financial workspace for answering: What did I spend? What will be charged next? Can I afford it? Which charges changed? Who must approve this? Where is the receipt? Which account funded it? Ledgerline must connect these answers rather than shipping isolated modules.

Three workspace types share the same underlying model. Personal workspaces have one owner and may invite a trusted collaborator. Household workspaces support shared accounts, budgets, obligations, and settlements. Business workspaces add departments, projects, policies, claims, approval chains, accounting exports, and audit controls. Switching type changes navigation and permissions, not financial semantics. One person can belong to multiple isolated workspaces. No member can silently see another person's private workspace.

The application is a tracker and expense management tool. Every bank balance is explicitly manual, imported, or provider-synchronized with an as-of time. A bill marked paid records a real payment or an existing transaction; it never implies the application moved money. Deliver account aggregation through a provider adapter and a working sandbox integration, but production bank availability depends on region, provider contracts, credentials, and consent. Do not invent banking, tax filing, payroll, card issuing, subscription cancellation, or money movement APIs.

All features below must be implemented. P0, P1, P2, and P3 mean build order. P3 remains required. Features are ordered from foundational to lower-frequency convenience so the user can remove explicit IDs later. When external credentials are unavailable, implement the real adapter, sandbox/test integration, credential validation, and an honest unavailable state; the production connection remains blocked, not complete.

Service codes: J = Java Core Finance; P = Python Capture & Automation; G = Go Rates & Realtime; C = C# Analytics; N = Node Notifications. The first listed service owns the source of truth; additional services collaborate through contracts. UI ownership is frontend, and is implicit for every interactive feature.

## 2. P0 — core finance and everyday use

Each row is independently traceable. Acceptance in the last column is the minimum feature-specific evidence; global accessibility, security, and operational gates also apply.

| ID | Feature and required behavior | Services | Minimum acceptance |
|---|---|---|---|
| F001 | OIDC sign-in, verified email, sign-out, session expiry, recovery and MFA flows through the identity provider | J, N | Expired/revoked sessions cannot mutate; refresh works without exposing refresh tokens to JS |
| F002 | Create personal, household, business workspaces; switch workspace; configure base currency, timezone, fiscal start | J | Same user switches between isolated workspaces; unsupported base change is explained |
| F003 | Membership invitations, role assignment, removal, owner transfer, last-owner protection | J, N | Accepted invitation is scoped and single use; removed member immediately loses access |
| F004 | Manual accounts for cash, bank, credit card, wallet, savings, loan and reimbursement clearing; opening balances | J | Balance derives from postings and opening entry; currency and account type validated |
| F005 | Add/edit/archive categories, tags, merchant aliases and payment methods; prevent broken references | J, P | Archived category remains visible on history and cannot accept new entries |
| F006 | Manual expense entry with merchant, decimal amount, currency, date, account, category, tags, note and receipt | J, P, G | Required fields, amount precision and account access enforced; save creates balanced postings |
| F007 | Income entry, recurring income, refunds linked to source expense, and reversals | J | Refund reduces net spend once; refunds beyond original amount require explicit confirmation and policy |
| F008 | Same-currency and cross-currency transfers, fees, paired legs and exclusion from spending totals | J, G | Transfer does not inflate spend; fee does; both legs commit atomically |
| F009 | Split one expense across categories/projects/people with exact rounding remainder | J | Split sum equals parent amount; invalid split cannot post |
| F010 | Register with server-side search, filters, sorting, cursor pagination and saved views | J | 100k seeded entries queried without downloading full dataset; filters survive navigation |
| F011 | Transaction detail timeline, linked receipt/bill/subscription/claim, changes and reversal actions | J, P | Links stay intact; edit history shows actor and before/after fields |
| F012 | Bulk category/tag assignment, reviewed state, archive draft and export with selection count and result summary | J | Partial failures identify rows; posted financial entries are reversed rather than silently deleted |
| F013 | One-off bills with payee, due date, issue date, amount, invoice number, expected account and attachment | J, P | Duplicate invoice hint available; bill creates no spend before payment |
| F014 | Recurring bills: weekly, fortnightly, monthly, quarterly, annual and custom interval; variable estimates | J | Month end and leap year schedules produce deterministic occurrences |
| F015 | Full and partial bill payments, installment due amounts, overdue balance, payment history and transaction linking | J | Partial payment leaves remainder; concurrent payment cannot exceed outstanding without credit workflow |
| F016 | Subscription lifecycle with plan, amount, frequency, start, next renewal, trial end, account and renewal mode | J | Trial reminders and renewal occurrences generated; no automatic financial posting from prediction |
| F017 | Pause/resume/cancel subscription, cancellation effective date, notice deadline and external cancellation URL | J, N | Future reminders respect effective date; UI distinguishes requested from confirmed external cancellation |
| F018 | Shared calendar and agenda for bills, renewals, income, installments, trial ends and cancellation deadlines | J | Calendar respects workspace timezone and filter permissions; links open correct records |
| F019 | Email and in-app reminders with 7/3/1-day and due-day defaults, snooze, quiet hours and preferences | J, N | Reschedule/payment/cancellation suppress stale reminder; test email reaches test SMTP inbox |
| F020 | Home overview: actual spent, available budget, due soon, overdue, renewal changes and review queue | J, C | Cards reconcile with source data and show analytics freshness; no invented zero on outage |
| F021 | Category budgets, period allocations, carryover, spend progress and overspend alerts | J, N | Budget arithmetic correct across refunds/transfers; carryover can be positive-only or signed |
| F022 | Monthly plan with committed bills/subscriptions and safe-to-spend estimate | J, C | Formula and assumptions visible; predicted commitments never count as posted spend |
| F023 | Original and base currency display, historical transaction rate, editable actual bank conversion and fees | J, G | Latest quote changes do not rewrite settled history; rate source/time retained |
| F024 | CSV import preview, mapping, duplicate review, row errors, staged confirmation and import history | P, J | Invalid rows corrected before posting; replaying confirmed batch produces no duplicate transactions |
| F025 | Receipt upload from file/mobile camera, scan status, manual correction and secure attachment preview | P, J | Malicious/oversized files rejected; unverified extraction never posts automatically |
| F026 | Rule-based merchant normalization and category suggestions with explanation and accept/reject | P, J | Human selection outranks suggestions; deterministic input gives deterministic recommendation |
| F027 | Notification center, unread state, action links, delivery status and reminder preferences | N, J | Another workspace's message is inaccessible; unread survives refresh and replay |
| F028 | Data export and import portability for expenses, accounts, bills, subscriptions, budgets and metadata | J, P, C | Export includes original money/rates and stable IDs; own exported package can be imported without duplication |
| F029 | Accessible responsive UI, keyboard commands, loading/error/empty states and light/dark themes | All | All core flows work at 390px and keyboard-only; contrast and reduced motion pass |
| F030 | Immutable financial change audit, optimistic concurrency and operation idempotency | J | Two editors receive explicit conflict; retry after timeout returns original result |

## 3. P1 — planning, automation and business essentials

| ID | Feature and required behavior | Services | Minimum acceptance |
|---|---|---|---|
| F031 | Account reconciliation against statement closing balance; difference resolution and reconciliation history | J | Reconciled entries cannot silently change; adjustment posts with audit and explanation |
| F032 | Scheduled transaction templates, confirmation queue, duplicate protection and recurring income exceptions | J, N | Approving same occurrence twice yields one transaction |
| F033 | Subscription price/plan history, normalized monthly/annual cost and price-change alerts | J, C, N | Annual cost uses billing frequency rather than assuming monthly; historical rate retained |
| F034 | Suggest recurring streams from confirmed transactions using interval/merchant/amount heuristics | P, J | Candidate includes evidence and confidence; user accepts or dismisses; no auto-subscription creation |
| F035 | Budget templates, last-period copy, allocation move, emergency buffer and overspend rollover | J | Allocation move balances and audit identifies affected categories |
| F036 | Savings goals and sinking funds with target amount/date, contribution tracking and projected shortfall | J, C | Contributions are allocations/transfers, never a second expense |
| F037 | Cash flow forecast for 30/60/90 days with committed and estimated lines and low-balance warnings | C, J, N | Backdated edits update forecasts; unknown income isn't fabricated |
| F038 | Household shared expenses, equal/percentage/custom splits, who-paid tracking and settlement balances | J | Settlement transfer decreases debt and doesn't create new spending |
| F039 | Projects, departments, cost centers and hierarchical dimension allocation | J, C | Department-scoped reviewer sees only authorized department records |
| F040 | Expense claims with multiple expenses, receipt rules, business purpose and draft/submission lifecycle | J, P | Submitted snapshot locked; editing requires return and resubmission |
| F041 | Conditional sequential approvals by amount/department/category, delegate and escalation deadline | J, N | No self-approval; concurrent approvers cannot advance stage twice |
| F042 | Expense policies for missing receipts, amount limits, allowed categories and duplicate claims | J, P | Violations are explained; hard block and warn actions differentiated |
| F043 | Reimbursement tracking: approved, payable, recorded paid; partial reimbursement and linked clearing entries | J, N | Records payment evidence; cannot reimburse more than approved remaining amount |
| F044 | Business bill approval and payment readiness with separation of duties | J, N | Creator cannot satisfy mandated independent approval; paid state requires payment record |
| F045 | Subscription owner, team, seats purchased/used manually, renewal approver and contract attachment | J, P, C | Unused seat estimate explicitly uses manual data freshness |
| F046 | Vendor directory with contacts, tax identifier, payment terms and linked spend | J, C | Sensitive vendor fields permission-controlled; archived vendor retains historic links |
| F047 | Tax lines inclusive/exclusive, multiple labels/rates, recoverable percentage and tax summary export | J, C | Amount/tax arithmetic tested; UI states report is tracking output, not tax filing |
| F048 | Report builder with date/currency/category/account/vendor/dimension filters, comparison and drill-down | C, J | Export and on-screen totals agree; drill-down uses same authorization scope |
| F049 | Reports: spending, income, net flow, category trend, vendor concentration, renewals, budgets and claims | C | Aggregate values reconcile to ledger including reversals and refunds |
| F050 | Saved report definitions, dashboard presets and column preferences | J, C | Definitions persisted in J; C executes whitelisted query specification |
| F051 | Import CSV and OFX/QFX statement formats with canonical account mapping | P, J | Format fixtures exercised; source transaction identifiers retained |
| F052 | Bank aggregation adapter: sandbox consent, incremental sync, account mapping, disconnect and webhook handling | P, J | Sandbox end-to-end works; production state accurately reflects credentials/region support |
| F053 | Imported pending-to-posted matching and manual/imported duplicate reconciliation | P, J | Pending amount change updates candidate rather than double-posting; user can undo match |
| F054 | Receipt OCR with bounded CPU worker, merchant/date/amount extraction and low-confidence fields | P | CPU/time limits enforced; extraction accessible and human-confirmed |
| F055 | Rule builder with all/any conditions, ordered actions, dry-run preview and immutable version history | P, J | New rule shows impact before use; conflicting rules follow explicit priority |
| F056 | Merchant naming corrections and remembered mappings with personal/workspace scope | P, J | Personal mapping does not leak into another workspace |
| F057 | Search across permitted transactions, bills, subscriptions, vendors and receipts | J, P | Result limit and permission filters are server-enforced; no production data in Elastic logs |
| F058 | Comment threads and mentions on bills/claims/expenses with change context | J, N | Deleted/member-removed targets cannot receive unauthorized content |
| F059 | Dashboard updates and cross-tab synchronization through authorized SSE | G, J, N | Reconnect triggers authoritative refetch; stale message cannot corrupt local data |
| F060 | Expiring accountant/auditor access, export rights, finance role and read-only reports | J | Expiry enforced at API time; exports cannot bypass scope |

## 4. P2 — refinement, integrations and useful completeness

| ID | Feature and required behavior | Services | Minimum acceptance |
|---|---|---|---|
| F061 | Split billing cycles, renewal exceptions, end-of-month policy, holiday/weekend adjustment and grace period | J | Preview next 12 occurrences before save; local timezone never drifts after DST |
| F062 | Subscription cancellation checklist, refund/credit evidence, paused billing timeline and renewal decision notes | J, P, N | Reminder stops only for appropriate effective state; no claim of provider cancellation |
| F063 | Spend anomaly hints from rolling medians/thresholds and new-merchant flags | P, C, J | Explain baseline and exclude refunds/transfers; dismissible hints never block normal entries |
| F064 | Scenario comparisons for canceling plans or changing budget allocations | C, J | Draft scenario cannot modify real subscriptions or ledger without a separate command |
| F065 | Annual commitments view and sinking-fund recommendation for quarterly/annual bills | C, J | Forecast distinguishes price-known from amount-estimated |
| F066 | Due-date negotiation notes, invoice dispute/credit states and late fee recording | J | Disputed bill still retains liability visibility; fee entry traced |
| F067 | Duplicate invoice/receipt checks by hash and vendor/invoice/amount/date combinations | P, J | Cross-tenant hashes do not reveal other tenant files; legitimate repeats can be explained |
| F068 | Expense templates, repeat last entry, favorites and keyboard-first quick capture | J | Repeated entry gets new ID and current date; previous receipt isn't silently reused |
| F069 | Mobile receipt inbox, draft autosave and offline draft queue with conflict-safe synchronization | P, J | Offline drafts persist after refresh; clearing sign-out removes local sensitive drafts per preference |
| F070 | Mask amounts/privacy presentation mode and explicit device/local draft setting | J | Mask applies to all dashboard/list/tooltips; does not weaken API access controls |
| F071 | Notification digests, quiet hours, business-day offsets and per-category routing | J, N | Urgent security messages bypass marketing/digest controls; digest respects recipient timezone |
| F072 | Delivery bounce/suppression handling, unsubscribes and reminder test preview | N, J | Provider webhook signature verified; suppressed recipient not retried endlessly |
| F073 | Web push reminders with consent, device management and revocation | N, J | Revoked endpoint removed; sensitive amount hidden from lock screen by default |
| F074 | Calendar ICS export/subscription with revocable secret and safe event contents | J | Token rotation invalidates old feed; calendar subscription is clearly an exported read model |
| F075 | Accounting-ready CSV exports with category-to-GL mapping, tax lines and external IDs | J, C, P | Unknown mapping appears as error; stable schema documented and round-trip fixture supplied |
| F076 | Inbound receipt email via verified provider webhook with workspace-specific address and quarantine | P, J | Unknown sender and suspicious attachment held for review; inbound text treated as data |
| F077 | Outbound signed webhook integrations with subscription filters, retries, delivery log and secret rotation | N, J | Replay and SSRF protections tested; saved URL cannot target cluster/private networks |
| F078 | Workspace API tokens with scopes, expiry, rotation and use audit | J | Token digest stored; narrower scope cannot be widened by request body |
| F079 | Integration health page with last sync, cursor, rate limit, errors and reconnect action | P, J, N | Error recovery resumes from checkpoint and keeps idempotency |
| F080 | Scheduled report emails with expiry-controlled authenticated download links | J, C, N | Removed member cannot download existing report; no long-lived public data URL |
| F081 | Period closing for business, reopening with justification and locked-period adjustments | J | Closed period rejects unauthorized backdated write; adjustments reference affected entry |
| F082 | Custom fields for expenses/bills/subscriptions: text, number, date, enum and required policy | J | Field deletion archives definition without destroying old values |
| F083 | Multi-currency account overview with latest estimated valuation and historical booked totals | J, G, C | Current valuation marked estimate; historical amount unaffected by quote refresh |
| F084 | Debt/credit card minimum payment reminders and recorded interest/principal split | J, C, N | Principal isn't spend; interest is; schedule is user entered rather than lender-guaranteed |
| F085 | Installment plans attached to bills/expenses with remaining schedule and early payoff adjustment | J, C | Original purchase versus cash payment views do not double-count |
| F086 | Workspace retention controls, export-before-delete, legal retention hold and deletion progress | J, P, C, N | Active hold blocks purge; verified purge covers projections/files/backups policy and provider tokens |
| F087 | Personal privacy controls, consent history, device/session management and data download | J, P | Revoke session/token demonstrably blocks subsequent request |
| F088 | Accessibility preferences: motion, density, theme, date/number format and text scaling | J | Preferences persist and forms/tables remain usable at 200% zoom |
| F089 | Organization SSO binding and MFA enforcement through configured OIDC provider | J | Workspace policy rejects inadequately authenticated session; no custom password storage |
| F090 | Approval delegation windows, reviewer absence fallback and overdue escalation | J, N | Delegation cannot violate no-self-approval or expand permitted department scope |

## 5. P3 — lower-frequency but required conveniences

| ID | Feature and required behavior | Services | Minimum acceptance |
|---|---|---|---|
| F091 | Recurring-income variability ranges, forecast confidence labels and payroll date tracking | J, C | Range never displayed as assured cash; actual income overrides occurrence prediction |
| F092 | Expense attachments gallery, rotate preview and multi-receipt association | P, J | Source file retained; transformed preview does not replace original evidence |
| F093 | Compare subscription alternatives using manually supplied costs and terms | J, C | No fabricated product prices; effective date and user's assumptions shown |
| F094 | Annual personal summary and business management summary with auditable metric definitions | C, J | Underlying records reachable; no unexplained “AI insight” text |
| F095 | Vendor contract notice calendar and renewal ownership transfer | J, N | Member removal forces unresolved ownership task, not silent reminder loss |
| F096 | Shared wishlist/planned purchases attached to goals and budget availability | J, C | Planned purchase not spend until user records actual transaction |
| F097 | Reimbursement aging, approval turnaround and departmental budget utilization reports | C | Dates measured from persisted state transitions, not current arbitrary timestamps |
| F098 | CSV batch bill/subscription creation with preview and validation | P, J | Same import architecture handles row-level errors and duplicate recurring series |
| F099 | Recovery bin for nonfinancial drafts/metadata and undo for reversible actions | J, P | Posted reversal isn't undone by restoring a draft; recovery is tenant-scoped |
| F100 | Seeded demo workspace with reset and guided tasks isolated from real accounts | J, P, C, N | Demo reset cannot affect real workspace or send external emails |
| F101 | Help/search glossary, calculation explanations, keyboard reference and contextual onboarding | J | Help links reachable from forms; monetary metrics disclose assumptions |
| F102 | Monthly review checklist covering uncategorized spend, unpaid bills, stale rates and renewal decisions | J, P, C | Checklist follows real actionable records; resolved item disappears on refetch |
| F103 | Import reconciliation summary showing count/total by currency, accepted/rejected/duplicate rows | P, J | Counts and totals match posted rows and retained staging state |
| F104 | Per-workspace operation status center for import/export/deletion/rebuild/report jobs | J, P, C, N | Terminal errors expose useful redacted reason and safe retry action |
| F105 | Keyboard command palette with permission-aware search and actions | J, P | Unauthorized commands absent and blocked at backend even if manually invoked |
| F106 | Explicit merchant refunds pending, bill credits and subscription trial-to-paid decisions | J, N | Expected credit isn't recorded as received; trial cancellation can be confirmed separately |
| F107 | Account archive/merge tooling with preview, balance protections and stable historic references | J, P | Different-currency accounts cannot merge; no historical posting rewritten invisibly |
| F108 | Date-bound data shares for household review and business stakeholder report views | J, C | Recipient authenticates; expiry and revocation apply on every access |

## 6. Cross-feature product invariants

Use one occurrence model for bills, subscriptions, recurring income and installments. A bill is an obligation; a subscription is a recurring commercial agreement; an expense is recorded financial activity. Link them, do not collapse them into one table or count all three as spend. Calendar occurrences include a semantic type, series ID, local due date, expected amount, estimated flag, schedule version and authoritative status.

Amounts in the API are decimal strings with ISO currency codes. Persist original gross amount, tax components, actual account amount, base booked amount, rate provenance and rounding metadata. Currency precision can be zero, two, three or another supported exponent. Never assume all currencies use two decimals, and never calculate money using binary floating point. Exchange conversions are quotes until confirmed. User-supplied actual bank amounts take precedence over reference quotes.

Every posted transaction is an immutable financial fact with versioned metadata changes and reversing/correcting postings. Drafts may be deleted. A reversal is a new, balanced operation referencing the original. Locked-period correction posts in an open period with a link and explanation. Balances, spending, cash flow and tax reports each have different documented inclusion rules.

No background categorizer may overwrite a user's category. Suggestion precedence: locked/approved record; human decision; explicit pinned rule; account/vendor mapping; ordered rules; heuristic suggestion; uncategorized. Recommendations keep provenance, rule version, inputs used and confidence. Confidence is a calibrated or explicitly heuristic score, never a fabricated probability.

Cash-flow forecasts use actual account balance + confirmed scheduled income - outstanding obligations - modeled planned outflows. Forecasts expose exclusions and uncertainty. Safe-to-spend = liquid available balance - near-term outstanding commitments - emergency buffer - reserved goal allocations, with overlaps deduplicated by source linkage. Credit limits are not cash. Budget available = allocation + eligible carryover + authorized moves - net eligible spend. Household settlement affects balances/debts, not total spend.

Current-rate valuation and historical booked reporting must be separate selectable modes. Changing workspace base currency after postings starts a new reporting currency epoch with an explicit migration job and preserved old snapshots; it cannot silently rewrite facts. New reports can revalue for comparison, clearly labeled as restated estimates.

## 7. Personas and required end-to-end journeys

**Individual:** sign in, create INR workspace, add cash and bank accounts, add an expense with receipt, split groceries/household, import a statement, resolve duplicate, set food budget, add annual subscription, receive renewal email, record payment, review monthly report, export all data.

**Household:** invite partner without sharing password, agree shared versus private scope, split rent with unequal contributions, record payment, settle balance, see shared calendar, mask amounts on a shared display, revoke a former member.

**Employee:** capture receipt on phone, correct OCR, set project/business purpose, see policy issue, submit claim, answer returned review, track approved reimbursement and recorded payment.

**Finance manager:** import supplier bills, reject duplicate invoice, configure department approvals, review violations, approve payable, record partial payment, close period, export tax/GL summary, trace all changes.

**Subscription owner:** review annualized commitment, see trial deadline and price increase, confirm seat usage manually, transfer renewal responsibility, request cancellation, attach confirmation, record credit and verify future reminders stop.

**Operator:** inspect failing notification deliveries in Grafana, follow trace to redacted Kibana logs, replay safe failed work, prove no duplicate expense/reminder, restore backup to test namespace, and verify reconciliation.

## 8. Explicit integration deliverables

Ship provider interfaces plus one functioning implementation each for FX (Frankfurter v2 reference rates), bank aggregation (Plaid Sandbox adapter), email (SMTP locally and Amazon SES production adapter), inbound email (SES inbound-to-object-storage event adapter), push (Web Push), object storage (S3-compatible API), and OIDC (standards-based provider with local test issuer). Provider-specific tests use signed webhook fixtures and sandbox credentials when available.

The public FX provider publishes daily reference data, not continuous market ticks. Refresh availability on a bounded schedule and push new quotes when published. UI shows quote date, fetched-at time, provider and stale state. For genuine intraday quotes implement a second configurable paid-provider adapter with contract tests; activation requires a provider agreement and credentials. Never label daily reference data “live market price.” This requirement satisfies fresh conversion and clear historical accounting without misleading users.

Receipt OCR uses Tesseract CPU processing with file/page limits and templates/regex; category automation uses rules and merchant matching. Heavy generative AI, embeddings, chatbot advice, and autonomous financial decisions are not in this delivery. The lightweight suggestion pipeline already satisfies useful auto-tagging. A future ML adapter can follow the same suggestion contract without changing approval authority.

# Frontend sitemap, pages and manual entry

## 1. Count and routing conventions

Build **48 product page templates plus 3 utility error templates: 51 frontend templates total**. Dynamic detail IDs, settings tabs, drawers, calendar views and wizard steps do not add templates. Actual routable URLs exceed 51 because each record has its own URL. The frontend is a single React application served by a static web container; it is not a sixth business microservice.

All workspace routes are under `/w/:workspaceId`. The router validates workspace membership before rendering and services independently authorize requests. Persist filters in URL search parameters without sensitive notes/secret tokens. Settings subsection IDs are URL-addressable. A personal member cannot access business routes by typing their URL.

## 2. Product pages 01–16: identity and core activity

| # | Route / title | Contents and required actions | Services / requirements |
|---|---|---|---|
| 01 | `/sign-in` — Welcome | Compact wordmark, account sign-in, SSO organization lookup, demo entry, privacy/help links; redirects to OIDC provider, no custom password database | J; F001,F089,F100 |
| 02 | `/recovery` — Account recovery | Provider recovery initiation, email verification continuation, safe generic confirmation, back-to-sign-in; no account enumeration | J,N; F001 |
| 03 | `/auth/verify` — Verify access | MFA/provider step-up redirect or confirmation, failed/expired challenge handling, safe continuation URL validation | J; F001,F089 |
| 04 | `/onboarding` — Create workspace | Personal/household/business selection, name, base currency, timezone, fiscal start, first account, starter categories, initial recurring item and first budget; resume persisted progress | J; F002,F004,F005,F013,F016,F021 |
| 05 | `/invitations/:token` — Accept invitation | Masked workspace/role, expiry, correct signed-in user check, accept/decline and provider redirect; clear used/revoked/expired states | J,N; F003 |
| 06 | `/home` — Workspace overview | Spend/available/due/overdue ledger strip, period filters, budget bars, upcoming agenda, review queue, recent activity, integration freshness, quick Add; alerts link to exact filtered lists | J,C,G; F020,F022,F059,F102 |
| 07 | `/transactions` — Activity | Search, date/account/category/type/currency/tag/project/source filters, saved views, server table, reviewed flags, splits marker, bulk edit/export, totals by currency; Add and import | J,P,G; F006–F012,F023,F030,F047,F068 |
| 08 | `/transactions/:id` — Transaction detail | Original/account/base amounts, quote provenance, journal interpretation, splits/tax, receipt preview, linked occurrence/claim, comments/audit; edit metadata, reverse/correct, refund, duplicate | J,P,G; F007–F011,F058,F084,F085,F106 |
| 09 | `/accounts` — Accounts | Groups by type/currency, balance/as-of/source, estimated base valuation, archive state; add/manual balance correction with explanation, start connection, merge preview | J,G; F004,F083,F107 |
| 10 | `/accounts/:id` — Account detail | Balance trend, statement closing balance, account activity, pending imports, reconciliation timeline, linked bills, loan/card payment schedule; edit/archive/reconcile/adjust | J,C,P; F031,F053,F084 |
| 11 | `/accounts/:id/reconcile` — Reconcile | Statement period/balance input, selected cleared transactions, difference, candidate duplicates and explicit adjustment entry preview; finalize or abandon draft | J,P; F031,F053 |
| 12 | `/bills` — Bills | Due/overdue/paid/disputed tabs, amount-remaining table, vendor/account filters, partial payment marker, calendar shortcut; add one-off/recurring, bulk import/export | J,C; F013–F015,F044,F066,F098 |
| 13 | `/bills/:id` — Bill detail | Invoice identity, gross/tax/credits/outstanding, occurrence and installment schedules, approval status, receipts, payment records, late-fee/dispute notes, comments/history; record/link payment, apply credit, schedule edit | J,P,N; F013–F015,F044,F047,F061,F066,F085,F106 |
| 14 | `/subscriptions` — Subscriptions | Active/trial/paused/canceling/canceled table, monthly equivalent/annual commitment, next renewal, price-change flags, owner/seats; add, candidates, compare, calendar link | J,C,P; F016,F033,F034,F045,F093 |
| 15 | `/subscriptions/:id` — Subscription detail | Plan/price history, trial/notice/renewal dates, owner/team, manual seat use, contract/receipt, actual linked charges, cancellation checklist and provider link; pause/resume/cancel/transfer, change plan and scenario | J,P,C,N; F016,F017,F033,F045,F062,F064,F095,F106 |
| 16 | `/calendar` — Commitments calendar | Month/week/agenda modes, bills/subscriptions/income/trials/notices/installments filters, daily totals by currency, overdue sidebar, occurrence detail drawer; add, ICS grant management and exported feed freshness | J,G; F018,F061,F074,F091 |

## 3. Product pages 17–33: planning and business

| # | Route / title | Contents and required actions | Services / requirements |
|---|---|---|---|
| 17 | `/budgets` — Budget plan | Period/fiscal controls, assigned/unassigned/remaining totals, category table, carryover badges, upcoming commitments; allocate, move, copy period, template and buffer controls | J,C; F021,F022,F035 |
| 18 | `/budgets/:id` — Budget detail | Allocation timeline, category/subcategory breakdown, commitment overlap, spending drill-down, rollover settings and alert thresholds; move allocation and edit future targets | J,C,N; F021,F035 |
| 19 | `/goals` — Goals and funds | Target/date/progress/suggested contribution, linked account/reserve, planned purchase list, urgent shortfalls; create, contribute, archive | J,C; F036,F065,F096 |
| 20 | `/goals/:id` — Goal detail | Contribution history, target timeline, reserved money, forecast and linked purchases; record allocation/transfer contribution, adjust target and convert planned purchase to actual draft | J,C; F036,F096 |
| 21 | `/shared-balances` — Household balances | Who paid/who owes matrix, source expense splits, settle-up suggestions, settlement records; record settlement, adjust participant shares and revoke sharing | J; F038,F108 |
| 22 | `/vendors` — Vendors | Searchable directory, terms, due bills, spend totals, risk flags and owner; add/edit/archive, batch export | J,C; F046 |
| 23 | `/vendors/:id` — Vendor detail | Contact/tax fields, invoice and transaction history, subscription contracts, terms and concentration chart; add bill, update contacts and owner | J,C,P; F046,F047,F095 |
| 24 | `/claims` — Expense claims | My/team claims, draft/submitted/returned/approved/payable/paid filters, totals and missing evidence; new claim, submit selection and export | J,C; F040,F042,F043 |
| 25 | `/claims/:id` — Claim editor/detail | Business purpose, department/project, eligible expense selector, receipts, policy findings, totals by currency, frozen submission snapshot and stage timeline; save/submit/withdraw returned draft/comment | J,P; F040,F042,F058 |
| 26 | `/approvals` — Approval queue | Assigned/overdue/delegated tabs, amount/department/policy filters, clear selection totals and preview; open decision, bulk approve only individually validated records | J,N; F041,F044,F090 |
| 27 | `/approvals/:id` — Approval review | Side-by-side expense/receipt, policy violations, claim/bill/subscription source, stage history, delegate info; approve, return with mandatory reason, reject, hold and request evidence | J,P,N; F041,F044,F045,F090 |
| 28 | `/reimbursements` — Reimbursements | Approved payable amounts, employee/department, aging, recorded payment evidence, remaining balance; record partial/full payment, link transaction, export payable CSV | J,C; F043,F097 |
| 29 | `/dimensions` — Departments and projects | Tree/list with owners, active dates, cost centers, project budget and scoped reviewer; create/archive/reassign hierarchy, scope preview | J,C; F039 |
| 30 | `/policies` — Policies and workflows | Versioned receipt/amount/category/tax policies, approval stage diagram using standard primitives, delegations and period locks; edit with dry-run examples, publish effective version and reopen period with reason | J,P; F041,F042,F081,F082,F090 |
| 31 | `/reports` — Reports library | Required preset reports, saved reports, scheduled delivery status, summary tabs for forecast/annual commitment/tax/aging; open, favorite and create | C,J; F037,F048–F050,F065,F080,F094,F097 |
| 32 | `/reports/builder` — Report explorer | Whitelisted metric/group/time/currency mode/filter controls, comparison, chart/table, as-of and drill-down, scenario draft panel; save definition, schedule, CSV/PDF export and scoped share | C,J; F037,F048–F050,F064,F080,F108 |
| 33 | `/review` — Monthly review | Checklist for uncategorized/duplicates/receipt missing/unpaid/stale integration/price changes, anomaly and recurring suggestions with evidence; accept/reject/review, close review and annual summary shortcut | J,P,C; F026,F034,F063,F094,F102 |

## 4. Product pages 34–48: tools and control

| # | Route / title | Contents and required actions | Services / requirements |
|---|---|---|---|
| 34 | `/imports` — Import history | Source/file/status/row counts/totals/as-of table, saved mappings, failed job details and safe retry; new import, resume, export reconciliation | P,J; F024,F051,F098,F103 |
| 35 | `/imports/:id` — Import wizard | Upload > format/account/date/currency mapping > parse errors > duplicate review > normalization/split preview > confirm > results; step navigation and source row drill-down | P,J; F024,F051,F053,F098,F103 |
| 36 | `/receipts` — Receipt inbox | Unlinked/processing/needs review/linked/quarantined tabs, filename/merchant/amount confidence, mobile capture and inbound status; upload, attach to expense, bulk download authorized files | P,J; F025,F054,F067,F076,F092 |
| 37 | `/receipts/:id` — Receipt review | Source preview, extracted field form, confidence/provenance, duplicate candidates, source email metadata and version history; rotate view, correct, link, create expense draft or quarantine removal | P,J; F025,F054,F067,F092 |
| 38 | `/rules` — Automation rules | Priority table, scope, version, matches and active status; create, reorder, disable, clone and dry-run | P,J; F026,F055,F056 |
| 39 | `/rules/:id` — Rule editor | All/any condition groups, safe operators, proposed action list, precedence indicator, sample test input and impacted preview; save draft, publish version, rollback | P,J; F055,F056 |
| 40 | `/integrations` — Connections | Bank/email/calendar/webhook/accounting export/API integrations, status/capability matrix, region/credential prerequisites and last health; connect/disconnect/setup | P,J,N; F052,F074–F079 |
| 41 | `/integrations/:id` — Integration detail | Provider consent scope, mapped accounts, sync checkpoints, redacted delivery log, credential expiry, webhook subscription/secret rotation and capability-specific configuration; reconnect/sync/retry/revoke | P,J,N; F052,F072,F076–F079 |
| 42 | `/notifications` — Notification center | Unread/all/actionable filters, workspace-scoped timeline, urgency/intent, delivery attempts for authorized administrators; mark read, snooze, open source, preview/test preferences | N,J; F019,F027,F071–F073 |
| 43 | `/members` — People and access | Members/invitations/expiring guests/scoped shares, role matrix and department scopes; invite/revoke/change role/owner, access preview and delegation windows | J,N; F003,F060,F089,F090,F108 |
| 44 | `/audit` — Audit trail | Filter actor/entity/date/action, field diffs, linked financial reversals, export and correlation IDs; read-only detail, sensitive field redaction and immutable timeline | J; F030,F081 |
| 45 | `/settings/:section` — Workspace settings | General/currency epochs/timezone/fiscal year; categories/tags/merchants; fields/templates; budget/goal defaults; notification settings; appearance/density/localization; retention/import/export; period closing; demo reset | J,P,N,C; F002,F005,F028,F061,F068,F070,F071,F081,F082,F086,F088,F099,F100 |
| 46 | `/security` — Privacy and security | Devices/provider sessions, MFA/SSO enforcement, API tokens/scopes, consent history, masking/local draft choices, data download/deletion/hold progress; revoke/rotate/export | J,P; F070,F078,F086,F087,F089 |
| 47 | `/jobs` — Operations status | Current/recent imports, exports, reports, migrations/deletion jobs, stage/progress/failures/retries, download with authorization and expiry; safe retry/cancel where supported | J,P,C,N; F028,F080,F086,F104 |
| 48 | `/help` — Help and onboarding | Searchable calculation glossary, supported integration capabilities, keyboard guide, workflow tutorials, guided demo tasks and application version/support trace copy | J; F100,F101,F105 |

Utility templates: `/forbidden`, `/not-found` (including unknown record), `/unavailable`. These show safe navigation/retry and no sensitive record hints. Callback `/auth/callback` performs the redirect exchange and routes to a product page; it is not a separate content template.

## 5. Manual Add menu — shared across every page

Use a rectangular Add button with a Radix dropdown and command palette equivalent. Menu groups:

1. **Record activity:** Expense, Income, Transfer, Refund.
2. **Track commitments:** One-off bill, Recurring bill, Subscription, Installment plan.
3. **Plan and collaborate:** Budget allocation, Goal, Shared expense, Expense claim.
4. **Capture:** Receipt, Import statement, Vendor, Account.

Permission and workspace type determine visibility. An employee can add expense/receipt/claim but cannot add an unauthorized corporate bank account. Quick Expense defaults to current workspace, today's local date and last allowed account; default category must never overwrite intended user selection. A saved template can prefill fields but shows provenance and remains editable.

### Expense drawer

First row: transaction type and exact amount/currency. Second: merchant/vendor combobox and local effective date. Third: funding account and account debit if different currency; latest reference conversion preview with quote timestamp and manual actual rate/fee. Fourth: category, tags and expandable split editor. Fifth: receipt drop zone/camera and related bill/subscription occurrence link. Sixth: note and business-purpose/project/tax/custom fields when relevant. Footer: posting preview, Save expense, Save and add another, Cancel. Optional field values are optional per form; implementation of fields is mandatory.

Validation: positive magnitude, allowed exponent and bounds, correct account scope/currency, split total exact, posted-period rule, accessible related entity, safe receipt state, tax arithmetic and business required fields. If duplicate candidate exists, show evidence and “Use existing”/“Record separate charge” with explanation. If save times out, retain request key and resolve status before offering another save. Keyboard Ctrl/Cmd+Enter submits only when valid; Escape preserves draft decision.

### Income/refund/transfer drawers

Income: payer, amount/currency/date/account, category/source, recurrence, receipt/reference. Refund: select original transaction, total previously refunded, remaining/refund amount, destination account, date, reason and receipt; additional credit explicitly modeled. Transfer: source and destination account, source amount, destination amount for cross-currency, quote/actual conversion, fee account/category and date. Preview both legs and fee. Prohibit same-account transfers and warn overdrawn manual cash without pretending overdraft guarantees.

### Bill and recurring bill forms

Required payee, invoice/reference, issue/due date, original currency/gross amount, expected account, category and recurrence mode. Tax lines and attachment follow. Variable bill uses expected range/latest estimate and clearly awaits actual invoice amount. Recurrence editor covers interval, day/anchor, month-end policy, timezone, weekend adjustment, start/end/count and next 12 occurrence preview. Payment terms can calculate due date but user confirms it. Save bill does not post spend. Record payment action separately chooses existing transaction or creates one atomically with the allocation.

### Subscription form

Provider/plan, amount/currency, billing interval, start/next billing date, trial dates, renewal mode, cancellation notice, owner, account/category, URL and price effective date. Business panel adds department, cost center, seat counts with last-reviewed date, renewal reviewer and contract. Show normalized monthly/annual estimates with formula. Pausing/canceling requires effective date and tracks external confirmation; never imply clicking the application canceled a provider contract.

### Claim and policy forms

Claim uses page 25, not a cramped drawer. Header contains business purpose/date range/department/project. Eligible expenses table shows missing receipts, claimed status, currencies, base booking and policy flags. Selection totals are per currency plus base total. Submit freezes relevant fields/receipt versions and resolves approval chain from published policy snapshot. Return/reject requires reason; hold may be expense-level, with clear amount implications. Approval shows actual submitted snapshot rather than current edited drafts.

### Budget, goal and shared entry forms

Budget allocation: category, period, amount/base currency, rollover mode, warning thresholds and transfer source for moves. Goal: target/date/reserve/account, contribution type and purchase link. Shared expense uses normal expense plus participants and equal/percentage/exact shares; allocation remainder assigned deterministically and shown. Settlement uses dedicated transfer/clearing model with both participants and amount, not ordinary category expense.

## 6. Mandatory interaction coverage

All 48 product templates have loading, first-use empty, filtered empty, populated, permission-denied and recoverable-error paths where applicable. Detail pages handle archived/deleted/closed records. Multi-step jobs handle background completion after navigation. Tests must enter each template through deep link and through navigation, preserve back-stack/filter behavior and confirm permission-driven actions.

One global notification preference editor lives in settings and opens contextual links from notification center. One shared record attachment component serves expense/bill/subscription/claim. One amount/rate component serves every financial entry. One recurrence editor serves every occurrence producer. These reuse rules are compulsory to prevent divergent UI and duplicated business validation.

Page-level implementation evidence is maintained in `implementation/page-status.csv` with template ID, route, permission variants, data source, states implemented, component compliance and test artifact path. A template is not complete when only its main happy-path screenshot exists.

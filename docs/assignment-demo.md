# Assignment demonstration: three service workflows

On Overview, use Finance tools. These are baseline workflows, not the entire roadmap.

- Python reads category keyword rules from MongoDB, returns a category/reason, and never stores the submitted description. Try `Zomato lunch` (Dining) and `Uber ride` (Transport). The edit-entry dialog can apply the suggestion; users can override it.
- Go fetches daily rates from ExchangeRate-API and caches validated snapshots in Redis. Try 850 INR to USD; the result follows the latest fetched rates. The converter displays the provider timestamp and flags stale cached rates during outages. Conversion is a calculator; saved accounts remain INR.
- C# sends workspace transactions to a request-local ClickHouse external table and groups by category/type using Decimal aggregation. Reports show count and total INR. Transfers remain separate. No submitted financial records are retained by analytics.

API contracts:
- POST /api/v1/capture/suggest: {"description":"Zomato lunch"}
- GET /api/v1/rates/convert?from=INR&to=USD&amount=850
- POST /api/v1/analytics/report: {"entries":[{"category":"Dining","kind":"expense","amount":"125.50"}]}

The calculator/rules/report endpoints do not read another account's records. Reports only process the records explicitly submitted by the current browser. Before public hosting, add authenticated authorization, gateway rate limits and workload quotas to these baseline endpoints.
# Updated navigation

Currency conversion is available from the sidebar on every page in a modal, with both currency selectors, a swap action, and a copyable amount and rate. Reports have their own sidebar page with date filters, spending/income/net summaries, category breakdowns, and CSV export. Category suggestions remain beside the expense category field in the record editor. Conversion uses daily public rates cached in Redis.

Convenience URLs `/login` and `/signup` start the secure Keycloak flow. Keycloak's address includes the OpenID Connect protocol endpoint and state/PKCE parameters; these remain necessary for secure authentication and are not application navigation paths.


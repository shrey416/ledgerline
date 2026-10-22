# Public currency rates update

Extract this ZIP into the existing Ledgerline repository and replace matching files. It contains only the currency-rate update, its UI attribution, documentation and adjusted checks. No credentials or account data are included.

## Apply and run (PowerShell, repository root)

```powershell
docker compose --env-file infra/local/.env build rates-realtime web
.\scripts\start.ps1 -ImportImages
```

Open http://localhost:30080 and choose Currency converter in the sidebar. The first rate fetch runs at service startup; wait a few seconds before the first conversion. Internet access from the Go container is required to fetch new rates. No API key is needed.

## Commit

```powershell
git add services/rates-realtime apps/web/src/FinanceTools.tsx tests/e2e/daily-journeys.spec.ts scripts/verify-assignment-services.py README.md docs/assignment-demo.md docs/currency-rates-update.md
git commit -m "Fetch public exchange rates and cache conversions in Redis"
```

Run the commit under the actual contributor's account. No push or commit is performed by this update.

## Behavior

- Go fetches https://open.er-api.com/v6/latest/USD over HTTPS with certificate verification and a four-second HTTP timeout.
- ExchangeRate-API's open endpoint updates daily, not continuously. Provider: https://www.exchangerate-api.com/docs/free. The converter includes its required linked attribution.
- One validated USD-based snapshot powers all cross conversions for INR, USD, EUR, GBP, JPY and AED. Formula: amount * rates[to] / rates[from].
- Snapshots are stored as JSON at Redis key `ledgerline:fx:public-v1`. The previous static key is no longer read or written.
- A background worker checks once per minute and fetches when the provider's next-update timestamp has passed. Redis SET NX coordinates replicas, with a five-minute cooldown including failures.
- Requests only read Redis: clicking Convert never waits for the public API. Redis reads have a one-second timeout and no automatic retries.
- Provider status, USD base, timestamps and all supported rates are validated before replacing the cache. Non-success HTTP responses, invalid JSON, missing/nonpositive rates and excessively old data are rejected.
- API failures retain the last valid snapshot for up to seven days from its provider timestamp. The UI shows its timestamp and an offline/stale indication after its expected refresh time. No fabricated static fallback is used.
- Missing/expired rates or unavailable Redis return a JSON 503 error; amount/currency validation returns 400. Conversion does not alter saved financial entries.
- Existing response fields are preserved, with `updatedAt` (UTC timestamp), `stale` (boolean) and `source` added/updated.
- Prometheus adds `ledgerline_fx_refresh_total{result="success|provider_error|cache_error"}` and `ledgerline_fx_updated_timestamp_seconds`. Refresh outcomes are also logged as JSON through the existing logging pipeline.

## Focused verification

The Go tests cover successful provider parsing and cross conversion, malformed responses, HTTP rate limiting, missing currencies and expired snapshots. The opt-in `TestLiveProviderAndRedis` fetches the real public endpoint and round-trips its data through a disposable Redis instance; set `FX_INTEGRATION_REDIS_URL` only to a disposable test database. Existing assignment and browser checks now derive expected conversion results from the rate instead of assuming 850 INR always equals 10 USD.

# Email and notifications

Ledgerline can send bill and subscription reminders through SMTP. Local runs use Mailpit, so you can inspect the entire workflow without sending external email. The Notifications screen uses Keycloak authorization code + PKCE S256; recipient verification, preferences, synced commitments, scheduler claims and delivery history belong to Node.js/Cassandra.

## Connect reminders

1. Open Notifications and sign in with the local `demo / local-demo-only` account.
2. Enter your recipient address, lead time and IANA timezone. Save preferences.
3. Request a code. In local mode, find it at http://localhost:8025; enter it in the app.
4. Enable reminders and save. Send a test email to check the connection.

Confirmed commitments from both account-owned PostgreSQL workspaces sync while you use the app. A paid or canceled commitment cancels pending reminders after its change reaches the service. Reminders continue with the browser closed once synced. Changes made through another client are not discovered until a browser reads and syncs them. Each signed-in user's personal/business reminder projections are private; shared business roles remain roadmap work.

Delivery checks today's four job partitions every 15 seconds, scheduled for 09:00 in the selected timezone, including DST handling. Seven older days are checked at startup and every five minutes to avoid repeatedly scanning idle history. Lead times range from zero to 30 days. Already-overdue cycles are skipped; newly synced cycles whose lead time has passed can send immediately. Changing the lead time/timezone creates a new reminder identity and may produce another reminder for the same due cycle. Recording a recurring payment can create its next tracked cycle; Ledgerline does not charge accounts.

SMTP requests have a 60-second gateway deadline, a 65-second client deadline and a 70-second web-proxy deadline. Plain-text gateway failures are translated into readable UI errors. A timeout asks the user to check their inbox before retrying, because provider acceptance can race a connection failure. Codes remain hashed, short-lived and rate-limited; automatic gateway retries are not enabled for mail POSTs. `scripts/verify-notification-gateway.ps1` exercises a seven-second local SMTP delay through a temporary Envoy gateway and confirms the code from Mailpit. It uses the dedicated local fixture account and removes its temporary containers.

## Gmail / Workspace setup

Use a dedicated sender address. Enable Google 2-Step Verification and create an app password named **Ledgerline**. Some managed accounts prohibit app passwords; in that case use a Workspace SMTP relay configured by your administrator or another SMTP provider. Google describes [app passwords](https://support.google.com/accounts/answer/185833); Nodemailer documents [Gmail SMTP](https://nodemailer.com/guides/using-gmail).

Edit the ignored `infra/local/email.env` locally:

For the selected sender, `ledgerlinedot@gmail.com`, this helper prompts for the app password without echoing it:

```powershell
./scripts/configure-gmail.ps1 -Mode kubernetes -Apply
```

Use `-Mode compose` when running Compose. The helper writes the ignored file and applies the configuration; entering the password in that local terminal is the only remaining credential step.

If the password is already saved, run `./scripts/apply-email.ps1 -Mode kubernetes` to patch the notification Secret and restart **only notifications**. It does not rerun the whole Kubernetes setup or restart finance. Run `./scripts/configure-local-auth.ps1` to apply the same sender to Keycloak registration verification and password resets. A rollout failure does not erase the saved SMTP file.

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_REQUIRE_TLS=true
SMTP_USER=your-sender@gmail.com
SMTP_PASSWORD=your16characterapppassword
SMTP_FROM=Ledgerline <your-sender@gmail.com>
SMTP_LOCAL_ONLY=false
```

Replace the example values; remove spaces from the app password. The sender should match the authenticated Gmail address. Never put credentials in frontend code, commit the secret file, or paste the password into chat. Keep `SMTP_LOCAL_ONLY=true` with `SMTP_HOST=mailpit` until you want real delivery. Local-only mode rejects an external SMTP host rather than accidentally delivering email.

Apply the configuration:

```powershell
# Compose mode
docker compose --env-file infra/local/.env up -d --force-recreate notifications

# Kubernetes mode; preserves imported images and renders the updated Secret
./scripts/kubernetes-up.ps1 -SkipImageImport
```

Then verify your recipient in Notifications and send a test email. TLS is required for external SMTP. Gmail delivery has account quotas and anti-abuse checks; it is appropriate for a small deployment, while large-scale transactional delivery should use a dedicated SMTP provider. Gmail credentials and external delivery are not validated until you supply them.

## Reliability and limits

- Cassandra persists preferences and source snapshots; daily queues have four shards and bounded scans. Up to 100 commitments per workspace are accepted.
- A SHA-256 cycle identity, Cassandra lightweight transactions and global delivery claims prevent duplicate concurrent dispatch and ordinary repeated-sync emails.
- A leased worker retries SMTP failures five times with exponential backoff; exhausted deliveries appear as failed in the inbox. An SMTP timeout or a crash after acceptance can still cause duplicate delivery. SMTP cannot provide an exactly-once guarantee; a stable Message-ID helps correlation.
- Paid, canceled, removed, disabled, unverified or outdated commitments are rechecked immediately before dispatch. Already accepted email cannot be recalled.
- The worker catches up eight calendar days after downtime. Daily scans are bounded to 1,000 queue rows per shard; large installations need pagination and more shards before increasing scale.
- The inbox retains 90 days and supports mark-read. Queue records expire 90 days after scheduling time (capped at ten years); delivered claims retain 90 days. Annual commitments therefore remain queued until their reminder date. Preferences/source snapshots persist. Recipient codes expire after 10 minutes with five attempts; email requests are rate-limited per local service instance.
- Account partitioning prevents cross-user access. Business projections currently use private user ownership, not shared company membership. Rate limits are in-process, so a public multi-replica deployment also needs a shared limit at the gateway.

Metrics `ledgerline_notification_worker_up` and `ledgerline_notification_delivery_total{outcome}` appear in Grafana's Service performance dashboard. Monitoring alerts use a separate Alertmanager → Mailpit flow and never switch to Gmail just because product SMTP changes.

Run `./scripts/verify-notifications.ps1` (or `-Mode kubernetes`) for an isolated local account integration check: verification, SMTP test, scheduled renewal, inbox, repeated-sync deduplication, authentication and cross-user isolation. It refuses to run against real SMTP. Browser and pure-function tests also cover accessibility, date/timezone conversion and invalid inputs.


Verification saves the recipient currently shown in the form before requesting its code. Recipient addresses are trimmed/lowercased; resends have a durable one-minute cooldown. Up to three recent codes remain valid until their individual ten-minute expiry. Hashes are scoped to account, workspace and recipient; conditional writes protect concurrent requests and wrong-attempt counts. A failed provider submission removes only its own challenge. Correct confirmations are retryable after a lost response; formatted pasted codes are accepted. The Prometheus SMTP health gauge checks connection/authentication every ten minutes and never sends a message; successful authentication does not prove delivery to an inbox. See [verification and efficiency notes](verification-performance.md).

# Ledgerline source update — 21 October 2026

Extract the update ZIP **into the root of your existing Ledgerline Git repository** (the folder containing compose.yaml), replacing matching files. Do not create a nested Ledgerline folder. Back up any independent edits first and review `git diff` afterwards.

This is a complete source overlay, rather than a minimal diff: the original handoff archives were regenerated, so the exact earlier snapshot cannot be reconstructed reliably. Including current source ensures that all post-handoff changes are covered. There are no deletion instructions. The archive includes a SHA-256 manifest of its source files.

The ZIP excludes Git metadata, credentials, database contents, generated Kubernetes secrets, dependencies, and build output. Existing `.git`, `infra/local/.env`, `infra/local/email.env`, and Docker database volumes are preserved. Do not delete volumes or replace credentials. The ZIP alone does not transfer accounts or financial data to another computer.

## Apply and start the update

Prerequisites: Docker Desktop running Linux containers with Kubernetes enabled (the existing Docker Desktop kind setup), Python 3 available as `python`, kubectl, and the existing local environment files. Use PowerShell from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\update-and-start.ps1
```

This rebuilds all six application images, imports them into Kubernetes, and runs the existing daily-profile startup and readiness checks. First builds can take several minutes while downloading dependencies. No local Java, Go, .NET or Node installation is needed for Docker builds. Open http://localhost:30080 after startup reports ready. Use this command once after applying the ZIP; rebuilding is required to use the updated source.

## Normal start and stop

After subsequent Docker Desktop restarts, reuse the images:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

Stop Ledgerline while keeping database volumes:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\runtime-profile.ps1 -Profile stop
```

Use the scripts rather than Docker Desktop's Compose Start All button. Daily mode avoids duplicate application containers and pauses the heavier monitoring tools.

## Verify the new functionality

```powershell
python scripts/verify-assignment-services.py
```

In Overview → Finance tools, try “Zomato dinner” for a MongoDB-backed Dining suggestion, 850 INR → USD for 10 USD using static rates stored in Redis, and generate a ClickHouse category report from the current workspace transactions. See docs/assignment-demo.md for details. Currency rates are demonstration values, not live market rates.

This package carries source and startup instructions; it is not a substitute for configuring a fresh machine. Keep real SMTP credentials out of Git and ZIPs. A different machine needs its own local configuration, database setup, and email configuration.

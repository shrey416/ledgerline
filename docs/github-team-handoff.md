# Ledgerline: seven-commit GitHub handoff

## Ownership and order

The existing application has no Git repository. Use an empty GitHub repository and a **separate clean clone** so local credentials, database data and build outputs never enter the first commit. This records each person's review and integration of existing source. It does not reconstruct historical development. Each contributor should inspect, understand, check and accept the source before committing it with their own identity. Do not configure another person's name or email, share GitHub credentials, backdate commits or force-push history.

| Order | Contributor | ZIP | Commit message | Scope |
|---|---|---|---|---|
| 1 | You | `01-you-foundation-python.zip` | `chore: initialize platform and add Python capture service` | Toolchain, design, Compose, Kubernetes definitions, identity theme, observability, Python/MongoDB service |
| 2 | Parth | `02-parth-go.zip` | `feat(rates): add Go service and Redis integration` | Entire Go service |
| 3 | Sneh | `03-sneh-csharp.zip` | `feat(analytics): add C# service and ClickHouse integration` | Entire C# service |
| 4 | Dhrumil | `04-dhrumil-java.zip` | `feat(finance): add Java finance and account persistence` | Entire Java service, PostgreSQL migrations |
| 5 | Riya | `05-riya-nodejs.zip` | `feat(notifications): add verification and reminder delivery` | Entire Node.js service and its tests |
| 6 | You | `06-you-frontend.zip` | `feat(web): add finance workbench and account experience` | Frontend, Nginx, frontend unit tests and browser tests |
| 7 | You | `07-you-integration.zip` | `chore: integrate startup deployment checks and documentation` | Scripts, README, detailed docs, implementation status |

Total: **seven commits, three by you, one by each friend**. Everyone waits until the preceding person's commit is on `main`. The backend services are siblings; Go before C# is an agreed sequence rather than a code dependency. Java precedes the notifications integration and UI because it owns saved accounts/workspaces. Intermediate commits are source integration stages; the full application is runnable after stage 7. These commits do not claim that unfinished roadmap features are implemented.

## Packages and exact files

From the original project directory, generate the archives (already generated for this handoff):

```powershell
python scripts/prepare-github-handoff.py
```

The ignored `handoff` directory contains seven ZIPs, a `.files.txt` inventory for each, and `manifest.json` with every source file's SHA-256 hash and each archive's hash. ZIP contents preserve repository paths: extract directly into the clone, without creating a new folder named after the ZIP. Regenerate the packages if source files change before distribution.

Send Parth only stage 2, Sneh stage 3, Dhrumil stage 4 and Riya stage 5, plus this guide and the repository URL. Keep stages 1, 6 and 7 yourself. Each friend's package includes their service Dockerfile and dependency definition; Node includes its lockfile and tests, Java includes its migrations. Infrastructure for all five services belongs to your foundation commit. Frontend tests belong to your frontend commit; integration verification scripts belong to your integration commit.

Local `.env` files, Gmail credentials, generated Kubernetes secrets, S3 credentials, build caches, dependencies and runtime evidence are excluded. The packaging script also checks for actual locally configured password/secret values before writing archives. Development fixture credentials in source are local demonstration credentials, not production secrets; replace/disable those accounts for a public deployment. Review GitHub's secret alerts if enabled; this focused check is not a general-purpose secret scanner.

## Create the repository and invite your friends

1. On GitHub, create an empty repository called `ledgerline`. Choose visibility appropriate to your team. **Do not initialize README, license or .gitignore** because your files provide them and the sequence needs an empty history.
2. In repository Settings → Collaborators, invite all four GitHub usernames. They must accept before pushing. They should authenticate Git with their own account through Git Credential Manager or their own SSH key.
3. Use the sequential direct-to-main workflow below for this small team. If repository rules require pull requests, use the PR workflow at the end instead; don't bypass organizational branch rules.
4. Everyone configures their own real Git identity in their clone. Use an email verified on their GitHub account or the exact private commit email copied from GitHub Settings → Emails. The author email controls contribution attribution; the account used to push alone does not.

## Your first commit: foundation and Python

Replace `YOUR_GITHUB_USERNAME`, `YOUR_NAME` and `YOUR_VERIFIED_GIT_EMAIL` before running commands. The new clone below is separate from the working application. Keep the original application directory intact.

```powershell
cd C:\Users\shrey\Documents\clg
git clone https://github.com/YOUR_GITHUB_USERNAME/ledgerline.git ledgerline-github
cd ledgerline-github
git branch -M main
git config user.name "YOUR_NAME"
git config user.email "YOUR_VERIFIED_GIT_EMAIL"

Expand-Archive -LiteralPath C:\Users\shrey\Documents\clg\ledgerline\handoff\01-you-foundation-python.zip -DestinationPath . -Force

git add -- .gitignore .dockerignore .prettierignore .prettierrc.json package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts playwright.config.ts design.md phases.md compose.yaml compose.daily.yaml infra observability services/README.md services/capture-automation
git diff --cached --stat
git diff --cached --name-only
git status --short
```

Inspect the staged list: no `.env`, `email.env`, generated secrets, `node_modules`, databases or build outputs. Review the Python source and dependency list. A clean image build is a useful check for your service when Docker is available:

```powershell
docker build -t ledgerline/capture-automation:review services/capture-automation
git commit -m "chore: initialize platform and add Python capture service"
git push -u origin main
```

Now tell Parth stage 1 is pushed. Do not extract the other services or frontend into this clone yet.

## Each friend: setup once

Each person runs this on their own computer, replacing the URL and identity placeholders. The empty folder should not already contain an unrelated repository.

```powershell
git clone https://github.com/YOUR_GITHUB_USERNAME/ledgerline.git
cd ledgerline
git config user.name "YOUR_OWN_NAME"
git config user.email "YOUR_OWN_VERIFIED_GIT_EMAIL"
```

For each stage below, `Downloads` is an example location: change the ZIP path if saved elsewhere. Start only after the previous stage is pushed. Extract only your assigned archive. Make any needed corrections inside your service folder, then inspect the staged diff before committing.

### Stage 2 — Parth: Go + Redis

```powershell
git switch main
git pull --ff-only origin main
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\02-parth-go.zip" -DestinationPath . -Force
docker build -t ledgerline/rates-realtime:review services/rates-realtime
git add -- services/rates-realtime
git diff --cached --stat
git diff --cached
git commit -m "feat(rates): add Go service and Redis integration"
git push origin main
```

### Stage 3 — Sneh: C# + ClickHouse

```powershell
git switch main
git pull --ff-only origin main
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\03-sneh-csharp.zip" -DestinationPath . -Force
docker build -t ledgerline/analytics:review services/analytics
git add -- services/analytics
git diff --cached --stat
git diff --cached
git commit -m "feat(analytics): add C# service and ClickHouse integration"
git push origin main
```

### Stage 4 — Dhrumil: Java + PostgreSQL

```powershell
git switch main
git pull --ff-only origin main
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\04-dhrumil-java.zip" -DestinationPath . -Force
docker build -t ledgerline/core-finance:review services/core-finance
git add -- services/core-finance
git diff --cached --stat
git diff --cached
git commit -m "feat(finance): add Java finance and account persistence"
git push origin main
```

### Stage 5 — Riya: Node.js + Cassandra

With Node.js installed:

```powershell
git switch main
git pull --ff-only origin main
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\05-riya-nodejs.zip" -DestinationPath . -Force
Push-Location services/notifications
npm ci
npm test
Pop-Location
docker build -t ledgerline/notifications:review services/notifications
git add -- services/notifications
git diff --cached --stat
git diff --cached
git commit -m "feat(notifications): add verification and reminder delivery"
git push origin main
```

Builds need network access for base images and dependencies. They check packaging/compilation, not live database behavior. Wait for a check to pass before continuing to commit. Only Node currently has the dedicated service unit tests included in these packages; do not claim unimplemented test suites passed. The final shared stack checks validate database connections after integration.

## Your second commit: frontend

Return to **ledgerline-github**, your clean clone. Wait until Riya's commit is on GitHub.

```powershell
cd C:\Users\shrey\Documents\clg\ledgerline-github
git switch main
git pull --ff-only origin main
Expand-Archive -LiteralPath C:\Users\shrey\Documents\clg\ledgerline\handoff\06-you-frontend.zip -DestinationPath . -Force
npm ci
npm test
npm run build
git add -- apps index.html tests
git diff --cached --stat
git commit -m "feat(web): add finance workbench and account experience"
git push origin main
```

## Your third commit: integration and documentation

```powershell
git pull --ff-only origin main
Expand-Archive -LiteralPath C:\Users\shrey\Documents\clg\ledgerline\handoff\07-you-integration.zip -DestinationPath . -Force
git add -- scripts docs implementation README.md
git diff --cached --stat
git diff --cached --name-only
git commit -m "chore: integrate startup deployment checks and documentation"
git push origin main
```

Do not start a second full Docker stack from the new clone while the original stack is running. The original directory remains your configured runtime with ignored secrets. Use its startup/verification commands to check the shared application; clones do not contain Gmail credentials or local generated configuration. On another machine, follow README's first-time initialization instructions rather than copying your secret files to teammates. If corrections are needed, prefer including them in the responsible person's unpushed stage; after publishing, use an honest follow-up fix commit even if that exceeds the planned count. Never hide a known defect to preserve a commit quota.

## Verify the result

```powershell
git log --reverse --format="%h | %an <%ae> | %s" main
git shortlog -sne main
git status --short
```

Expected: seven stage commits and five distinct, correctly linked people; you have three commits and each friend one. Check the GitHub commit pages show the correct profile for each author. The ZIP inventories are exact source ownership lists. No ZIP should be added to Git: the repo needs extracted source, and `handoff/` is ignored.

If a push is rejected because someone else pushed first, do not force push. With a clean working tree, run `git pull --rebase origin main`, resolve any real conflict, and push again. The sequential schedule should avoid this.

## If branch protection requires pull requests

For each stage after the initial commit, pull latest `main`, then create a branch such as `parth/rates-service` before extracting files. Add, review and commit exactly as above, then `git push -u origin parth/rates-service`. Open a PR into `main`. The owner reviews and **squash merges**, preserving the contributor as the squash commit author (verify the resulting commit page). Wait for it to merge before the next person branches from updated main. Avoid “create a merge commit” if you need the seven-commit mainline. Do not mix direct pushes and PR merging for the same stage. Exact attribution and contribution graphs also depend on verified emails, repository visibility and GitHub rules; a commit count is not proof of work quality.

# Telegram Bot: Loyalty Rewards Point Manager

A production-ready Telegram bot for managing customer loyalty and reward points
for a business. It allows an authorized administrator to register customers,
record purchases, manually add points, redeem points, check balances, review
transaction history, view leaderboards, and export operational data.

The application is deployed as a Cloudflare Worker and uses Cloudflare D1, a
managed serverless SQL database built on SQLite. It requires no continuously
running server and is designed for secure, low-maintenance operation.

This project was originally developed for **SoulShop — Bangladesh's E-Shop**,
an online store offering digital solutions for everyday needs. The public
version retains SoulShop as its default configuration while allowing other
businesses to customize the branding, headings, taglines, and reward policy.

No AI service, paid database, custom domain, or production long polling is
required.

## Customize it for another business

All non-secret runtime branding and reward-policy settings live in
[`src/config/app-config.ts`](src/config/app-config.ts). The complete safety and
infrastructure checklist is in [`docs/CUSTOMIZATION.md`](docs/CUSTOMIZATION.md).

For example, a fork can use:

```ts
brand: {
  name: "Example Store",
  heading: "Customer Loyalty Program"
}

rewards: {
  earning: {
    spendBdt: 100,
    earnPoints: 1
  }
}
```

Runtime headings, escaped taglines, purchase calculations, help text, and the
CSV filename prefix derive from these settings. Configure the redemption rate
before production data exists; changing it later is migration-sensitive and
must not be treated as a casual presentation change.

`APP_CONFIG` does not rename the Cloudflare Worker, D1 database, Telegram bot
username, GitHub repository, npm package, public Worker URL, or Cloudflare
account configuration. Those infrastructure identifiers are intentionally
separate; follow the checklist in `docs/CUSTOMIZATION.md` if they also need to
change.

## Architecture

```text
Authorized administrator
        |
        v
Telegram Bot API
        |
        v  HTTPS POST /webhook + secret header
Cloudflare Worker (TypeScript)
        |
        +-- D1 conversation state and bounded operational receipts
        +-- D1 authoritative customer balances
        +-- D1 newest-40 detailed transactions
        +-- D1 weekly/monthly leaderboard aggregates and reset generations
        |
        v
Telegram messages and CSV documents
```

The Worker exposes:

- `GET /health`: returns only `{"status":"ok"}`.
- `POST /webhook`: accepts validated Telegram messages and callback queries.
- Other methods and routes return safe `404` or `405` responses.

The source is split into domain calculations, validated D1 repositories, atomic application services, Telegram transport and templates, workflow routing, and exports.

## Loyalty rules

- `1 point = 10,000 point units`.
- The default earning policy is `BDT 50 spent = 1 point`.
- `BDT 1 spent = 200 point units` under the default policy.
- A purchase earns `purchase BDT × 200` point units under the default policy.
- `1 point = BDT 0.25` reward value.
- The redemption policy remains `4 points = BDT 1`.
- Rounded reward BDT is `floor((point units + 20,000) / 40,000)`.
- Branding and both reward ratios are validated from `APP_CONFIG`; configured
  ratios must produce an exact supported integer point-unit conversion.
- Point balances and transaction deltas use integers only. JavaScript floating point is never the source of truth.
- Manual additions and redemptions accept up to four decimal places.
- Detailed history retains the newest 40 rows per customer across all three transaction types combined. The deterministic order is `created_at_utc DESC, id DESC`.
- Completed mutation receipts correspond to retained detail rows; a per-customer update-ID high-water mark rejects delayed updates after their bounded receipts are pruned.

Example:

```text
BDT 500 = 100,000 units = 10 points
10 points ≈ BDT 3 displayed reward value
```

Telegram displays that exact balance as `10.00 points`. All Telegram-visible
point amounts use exactly two decimal places and standard half-up rounding at
the third decimal place, with comma-grouped thousands such as `1,356.70`. The
underlying point units, calculations, parsing, leaderboard ranking, and CSV
exports retain their exact precision.

Existing balances, transactions, mutation receipts, history, and leaderboard
totals remain exactly as stored when the earning rate changes. The new rate
applies only to purchases confirmed after the new Worker is deployed. A
leaderboard week or month spanning deployment can therefore contain purchases
calculated under both earning policies. Confirmations prepared under an older
policy are rejected without mutation and must be restarted.

Purchase and manual-add results label the post-transaction total as the
`updated reward balance`; balance checks use `current reward balance`.
Redemption results separately label the redeemed amount/value and the remaining
balance/value. These customer-facing labels do not change reward calculations.

## Leaderboard rules

- Weekly periods run Monday 12:00 AM through Sunday 11:59:59.999 PM in `Asia/Dhaka`.
- Available weekly views are the running week, the previous completed week, and two weeks ago.
- Available monthly views are the running month and the previous completed month.
- `PURCHASE` and `MANUAL_ADD` contribute positive gross earned point units. `REDEEM` never changes leaderboard earnings.
- Rankings use exact `earned_point_units DESC`, then the earliest qualifying earning timestamp, then `customer_id ASC`.
- Results show normalized phone numbers, never customer names, and are limited to 10 entries.
- Display uses deterministic two-decimal rounding, while storage remains exact integer point units with four-decimal point precision.
- Weekly and monthly resets are independent. A reset starts a new generation/cutoff for only the current period; balances and detailed history do not change.

## Commands

| Command | Purpose |
|---|---|
| `/start` | Open the dashboard |
| `/purchase` | Record a purchase |
| `/addpoints` | Add fractional points manually |
| `/redeem` | Redeem fractional points |
| `/balance` | Check the latest balance |
| `/history` | View newest-first reward history |
| `/addcustomer` | Register a zero-point customer |
| `/export` | Export customers and/or transactions |
| `/leaderboard` | View weekly/monthly rankings or reset the current period |
| `/restart` | Restart the active workflow |
| `/cancel` | Cancel the active workflow |
| `/help` | Show bot instructions |

Inline-button navigation uses one active bot message where chronological order
allows it. Confirmation panels become success results after commit, while
responses following typed input are sent below that input. Telegram edit
failures use one safe send-message fallback without repeating database work.
See [the active-message workflow contract](docs/TELEGRAM-WORKFLOWS.md).

## 1. Required software

Install:

- Node.js 20 or later, including npm.
- Git.
- Visual Studio Code.
- A free Cloudflare account.
- Telegram.
- Optional: `cloudflared` for testing a local Worker through a temporary HTTPS tunnel.

Check the local tools in PowerShell:

```powershell
node --version
npm --version
git --version
```

## 2. Open and install

Open PowerShell in the project folder:

```powershell
Set-Location "D:\TG_Bot-Project"
code .
npm install
```

If PowerShell blocks `npm.ps1`, use the executable shim:

```powershell
npm.cmd install
```

Never add secrets to `package.json`, TypeScript, Wrangler configuration, or Git.

## 3. Log in to Cloudflare

This opens a browser and requires your authorization:

```powershell
npx wrangler login
npx wrangler whoami
```

The project never performs this step automatically.

## 4. Create D1

Create the production database:

```powershell
npx wrangler d1 create soulshop-rewards-db
```

Copy the generated database ID. Open `wrangler.jsonc` and replace only this placeholder:

```jsonc
"database_id": "00000000-0000-0000-0000-000000000000"
```

Keep:

```jsonc
"binding": "DB",
"database_name": "soulshop-rewards-db"
```

## 5. Apply migrations

Apply to an isolated local D1 database:

```powershell
npm run db:migrate:local
```

Inspect the local schema if needed:

```powershell
npx wrangler d1 execute soulshop-rewards-db --local --command="SELECT name, type FROM sqlite_master ORDER BY type, name;"
```

Apply to the remote D1 database only after reviewing the migration:

```powershell
npm run db:migrate:remote
```

The migrations create authoritative unbounded customers, retained transactions, conversation state, bounded processed exports and mutation/reset receipts, plus leaderboard periods/aggregates. They also add suffix/history/retention/top-10 indexes, database constraints, resumable export progress, and the workflow update-order boundary.

V2.0.4 is a Worker-only configuration and public-documentation release and adds
no D1 migration. Existing production databases must still have every migration
through `0006_bounded_operational_storage.sql` applied before deploying V2.0.4.
Follow [the V2.0.4 release runbook](docs/V2.0.4-RELEASE.md) for validation,
deployment, verification, tagging, and rollback. The older
[V2.0.3 runbook](docs/V2.0.3-RELEASE.md) remains as release history.

For V2.0.2, review [the bounded-storage hotfix runbook](docs/V2.0.2-MIGRATION.md) before any remote action. Migration `0006_bounded_operational_storage.sql` preserves unbounded customers, balances, and aggregates while bounding operational receipts. V2.0.2 removes the compound trigger that caused the V2.0.1 remote migration attempt to fail with `incomplete input`; normal transaction and completed-receipt pruning remains explicit and atomic in the Worker batch. This repository preparation did not apply the corrected migration to production or deploy the Worker.

For V2.0.0, review [the production migration runbook](docs/V2.0.0-MIGRATION.md) before any remote action. The safe order is:

1. Take and protect a full D1 backup.
2. Apply `0004_mutation_receipts_and_leaderboards.sql`, which creates structures and backfills receipts plus applicable aggregates.
3. Verify receipt/aggregate consistency.
4. Apply `0005_verify_backfill_and_prune_history.sql`; its guards abort before pruning if verification fails.
5. Deploy the matching V2.0.0 Worker only after migration verification.

Never reverse that order. Old detailed rows removed by retention cannot be reconstructed unless an external backup preserves them.

## 6. Create the Telegram bot

1. Open the verified `@BotFather` account in Telegram.
2. Run `/newbot`.
3. Choose the bot display name and username.
4. Store the token in a password manager. Do not paste it into source files.

To find your numeric Telegram user ID, use a trusted ID lookup bot, or temporarily use Telegram `getUpdates` before registering a webhook. After sending your new bot a message:

```powershell
$env:BOT_TOKEN = "PASTE_TOKEN_IN_THIS_PROCESS_ONLY"
Invoke-RestMethod -Uri ("https://api.telegram.org/bot{0}/getUpdates" -f $env:BOT_TOKEN)
```

Read `message.from.id`. `ADMIN_TELEGRAM_ID` is stored and compared as a string.

Generate a strong webhook secret:

```powershell
$SecretBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($SecretBytes)
$WebhookSecret = [Convert]::ToBase64String($SecretBytes).Replace("+", "-").Replace("/", "_").TrimEnd("=")
$WebhookSecret
```

Store it securely. Telegram sends it in `X-Telegram-Bot-Api-Secret-Token`, and the Worker requires an exact match.

## 7. Understand `.dev.vars`

`.dev.vars` is a local Wrangler development file. It is ignored by Git and is not uploaded as deployed Cloudflare secrets. Deployed secrets are encrypted values added separately with `wrangler secret put`.

Create the local file from the placeholder template:

```powershell
Copy-Item ".dev.vars.example" ".dev.vars"
code ".dev.vars"
```

Replace placeholders locally:

```dotenv
BOT_TOKEN="LOCAL_BOT_TOKEN"
ADMIN_TELEGRAM_ID="NUMERIC_TELEGRAM_USER_ID"
WEBHOOK_SECRET="RANDOM_SECRET"
PUBLIC_WORKER_URL="https://TEMPORARY-OR-DEPLOYED-HTTPS-ORIGIN"
CONVERSATION_STATE_TTL_MINUTES="30"
EXPORT_MAX_ROWS="10000"
EXPORT_MAX_BYTES="8000000"
```

Do not commit `.dev.vars`. Check:

```powershell
git check-ignore -v .dev.vars
```

## 8. Run locally

Apply local migrations first, then start Wrangler:

```powershell
npm run db:migrate:local
npm run dev
```

Health check:

```powershell
Invoke-RestMethod "http://localhost:8787/health"
```

Telegram requires public HTTPS. For optional local webhook testing, run a trusted tunnel in a second PowerShell window:

```powershell
cloudflared tunnel --url http://localhost:8787
```

Set `PUBLIC_WORKER_URL` to the temporary HTTPS origin and register it only when you intentionally want Telegram to send live updates to the local Worker. Delete that webhook after testing. Temporary tunnel URLs change and are not production addresses.

## 9. Validate before deployment

```powershell
npm run db:migrate:local
npm run typecheck
npm run lint
npm run test:run
npm run build
```

After the local migration succeeds, the remaining four checks can also be run with:

```powershell
npm run check
```

`npm run build` is a Wrangler dry run. It creates a local bundle and does not deploy.

## 10. Add production secrets

Each command prompts securely. Do not put the value on the command line:

```powershell
npx wrangler secret put BOT_TOKEN
npx wrangler secret put ADMIN_TELEGRAM_ID
npx wrangler secret put WEBHOOK_SECRET
```

The non-secret tuning defaults are already in `wrangler.jsonc`. `PUBLIC_WORKER_URL` is only needed by the local webhook setup script, not by the Worker at runtime.

## 11. Deploy to workers.dev

Review `wrangler.jsonc`, confirm the real D1 database ID, and then manually run:

```powershell
npm run deploy
```

Copy the resulting `https://soulshop-rewards.<YOUR-SUBDOMAIN>.workers.dev` URL. Verify:

```powershell
Invoke-RestMethod "https://soulshop-rewards.<YOUR-SUBDOMAIN>.workers.dev/health"
```

Deployment is deliberately never triggered by install, tests, or build.

## 12. Register the webhook and commands

Set values in the current PowerShell process. These scripts do not read `.dev.vars` automatically:

```powershell
$env:BOT_TOKEN = "YOUR_BOT_TOKEN"
$env:WEBHOOK_SECRET = "THE_SAME_SECRET_STORED_IN_CLOUDFLARE"
$env:PUBLIC_WORKER_URL = "https://soulshop-rewards.<YOUR-SUBDOMAIN>.workers.dev"
```

Inspect any existing webhook:

```powershell
npm run telegram:webhook-info
```

Register the webhook and slash commands:

```powershell
npm run telegram:set-webhook
npm run telegram:set-commands
```

These commands modify Telegram configuration and are never run automatically.

To remove the webhook while preserving pending updates:

```powershell
npm run telegram:delete-webhook
```

Clear process variables when finished:

```powershell
Remove-Item Env:BOT_TOKEN
Remove-Item Env:WEBHOOK_SECRET
Remove-Item Env:PUBLIC_WORKER_URL
```

## 13. Acceptance test every command

Using only the configured administrator account:

1. `/start` displays all dashboard actions.
2. Record Purchase, Add Points Manually, Redeem Points, Check Balance, and Customer History each show their bold operation heading above `Select a customer:`.
3. `/addcustomer` retains its existing Add New Customer prompt, normalizes a Bangladesh or E.164 number, and creates zero points.
4. `/purchase` finds the customer by four or five final digits, records BDT 50 as exactly 1 point and BDT 500 as exactly 10 points, and displays them as 1.00 and 10.00 points.
5. `/addpoints` adds a fractional value, safely displays an HTML-like note, and labels the resulting total as the updated reward balance.
6. `/redeem` rejects an amount above the balance, accepts a valid fraction, and clearly separates redeemed and remaining values.
7. `/balance` labels the latest total as the current reward balance and its rounded BDT amount as the estimated reward value.
8. `/history` shows newest-first entries in Asia/Dhaka time.
9. `/export` sends the selected CSV file(s).
10. `/leaderboard` shows the five supported period views, phone-only top-10 rankings, and independent reset confirmations.
11. Reset Current Week leaves monthly totals unchanged; Reset Current Month leaves weekly totals unchanged.
12. `/restart` drops collected values and restarts the same operation.
13. `/cancel` clears state and returns to the dashboard.
14. A different Telegram user cannot search, mutate, export, view leaderboards, or reset them.

## 14. Logs and diagnostics

View deployed Worker logs:

```powershell
npx wrangler tail soulshop-rewards
```

Logs intentionally exclude complete Telegram updates, phone numbers, notes, tokens, and secret values. Application errors sent to Telegram are sanitized.

Check webhook status:

```powershell
$env:BOT_TOKEN = "YOUR_BOT_TOKEN"
npm run telegram:webhook-info
```

## 15. Query D1

Customers:

```powershell
npx wrangler d1 execute soulshop-rewards-db `
  --remote `
  --command="SELECT * FROM customers ORDER BY created_at_utc DESC;"
```

Transactions:

```powershell
npx wrangler d1 execute soulshop-rewards-db `
  --remote `
  --command="SELECT * FROM transactions ORDER BY created_at_utc DESC, id DESC;"
```

Customer balances are the source of truth. Detailed transactions are append-only when created, then controlled retention atomically removes rows beyond the newest 40 per customer and their matching completed receipts. The customer mutation update-ID high-water mark preserves delayed-update protection. Leaderboard aggregates are independent of detailed history.

Database table and invariant details are documented in [docs/DATABASE.md](docs/DATABASE.md).

## 16. Export and backup

### Method A: Telegram CSV

Use `/export` for readable customer lists, spreadsheet analysis, operational reports, and retained transaction review. Transaction CSV contains only the newest 40 detailed rows per customer. CSV protects phone numbers and other leading formula characters from spreadsheet formula execution. Configured row and byte limits fail with a warning rather than silently truncating.

### Method B: full Wrangler D1 SQL export

Use this for schema/data preservation, disaster recovery, and complete restoration. Take this backup before applying the V2.0.0 pruning migration if older detail may ever be needed:

```powershell
New-Item -ItemType Directory -Force "backups" | Out-Null
npx wrangler d1 export soulshop-rewards-db `
  --remote `
  --output="backups/soulshop-backup-YYYY-MM-DD.sql"
```

Bash equivalent:

```bash
npx wrangler d1 export soulshop-rewards-db \
  --remote \
  --output="backups/soulshop-backup-YYYY-MM-DD.sql"
```

Backups and CSVs contain private customer phone numbers. They are ignored by Git. Never commit, publicly share, email without protection, or store them in an untrusted location.

After pruning, the live database still preserves authoritative balances,
bounded mutation receipts, mutation update-ID high-water marks, and retained leaderboard aggregates, but it cannot
reconstruct deleted detailed transactions. Only a pre-pruning external backup
can preserve that older detail.

To restore, first create and test against a separate recovery database. After verifying the target and backup:

```powershell
npx wrangler d1 execute RECOVERY_DATABASE_NAME `
  --remote `
  --file="backups/soulshop-backup-YYYY-MM-DD.sql"
```

Do not overwrite a live database casually. Confirm Cloudflare's current D1 import/restore guidance and take a fresh backup first.

## 17. Rotate secrets

Telegram token:

1. Revoke/regenerate it in `@BotFather`.
2. Run `npx wrangler secret put BOT_TOKEN`.
3. Update only the local password manager and `.dev.vars` if needed.
4. Set the new token in the current shell and re-register commands/webhook.

Webhook secret:

1. Generate a new random value.
2. Run `npx wrangler secret put WEBHOOK_SECRET`.
3. Deploy if Cloudflare indicates a new version is needed.
4. Set the same value in the current shell and run `npm run telegram:set-webhook`.

The Worker and Telegram must change together or webhook requests will receive `403`.

## 18. Troubleshooting

- **PowerShell blocks npm:** use `npm.cmd` or configure an appropriate user execution policy.
- **D1 binding error:** replace the placeholder database ID and keep the binding name `DB`.
- **`403 Forbidden` from `/webhook`:** Telegram and Cloudflare webhook secrets differ, or the header is absent.
- **`503 Service configuration is unavailable`:** one of the three required deployed secrets is missing or the administrator ID is not digits.
- **Bot buttons keep loading:** inspect Worker logs and Telegram webhook info; callback queries are normally answered before workflow work.
- **Bot receives no updates:** confirm the deployed URL ends in `/webhook`, is HTTPS, and webhook info has no recent error.
- **Unauthorized response:** `ADMIN_TELEGRAM_ID` does not exactly match `message.from.id`.
- **Customer not found by suffix:** search must be exactly four or five digits, without spaces.
- **Local data disappeared:** local D1 and remote D1 are different stores; use `--local` and `--remote` intentionally.
- **Export too large:** use the full Wrangler D1 SQL export.
- **Older history is missing:** V2.0.0 intentionally retains only 40 detailed rows per customer; check a protected pre-pruning backup if older detail is required.
- **Leaderboard period is empty after reset:** this is expected until a new purchase or manual addition is recorded for that reset generation.
- **Database conflict:** another balance update won optimistic concurrency; restart to review the latest balance.
- **Tests cannot write Wrangler logs in a restricted shell:** set `XDG_CONFIG_HOME` to a writable project directory for that process.

## 19. Git safety

The repository ignores local secrets, dependencies, Wrangler state, builds, coverage, backups, CSVs, and arbitrary SQL exports. Migration SQL remains trackable:

```powershell
git check-ignore -v .dev.vars
git check-ignore -v backups/example.sql
git check-ignore -v migrations/0001_initial_schema.sql
git status --short
```

The migration result should point to the `!migrations/**/*.sql` exception rather than being silently excluded.

## 20. Free-tier expectations

This architecture is designed for Cloudflare Workers and D1 free-tier usage and a `workers.dev` address. Cloudflare and Telegram limits can change, and no codebase can guarantee permanent free-tier capacity. Review the providers' current limits before high-volume use.

## Security summary

- One administrator ID is checked before any customer query or mutation.
- The webhook secret header is required.
- Telegram updates, callback values, D1 rows, state JSON, point inputs, and phones are validated.
- Balance, detailed transaction, applicable leaderboard totals, completed receipt, paired pruning, and the mutation high-water mark are one atomic D1 batch guarded by the expected balance.
- Retained receipts reject duplicate Telegram updates; the per-customer high-water mark rejects older updates after receipt pruning.
- Callback panels are edited in place where chronologically safe; a failed edit falls back to one new message without changing the committed business result.
- Notes and dynamic values are HTML escaped.
- CSV formula injection is neutralized.
- No real token or secret belongs in source control.

Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License status

This repository does not currently include a `LICENSE` file. The owner should
select and add an appropriate open-source license before announcing the project
as publicly reusable. No license has been chosen automatically by this release.

# Fresh Installation Guide

This is the authoritative, detailed setup guide for installing V2.0.8 in a new
Cloudflare account and connecting a new Telegram bot. Start with the project
overview and business rules in the [README](../README.md). For branding and
reward-policy changes, also read [CUSTOMIZATION.md](CUSTOMIZATION.md).

Commands that authenticate with Cloudflare, create D1 resources, apply remote
migrations, store production secrets, deploy the Worker, or register Telegram
configuration change external systems. Run them manually and only after
reviewing the corresponding step.

## Fresh installation: values to review

The checked-in `wrangler.jsonc` remains configured for the original SoulShop
installation so that its existing local deployment workflow continues to work.
Before using this project from a different Cloudflare account, review the
following values. Do not run a remote migration or deploy until every required
replacement is complete.

| Value | Required for a new owner? | Where to configure it |
|---|---:|---|
| D1 database ID | Yes | Create a D1 database in your Cloudflare account, then replace `database_id` in `wrangler.jsonc`. |
| Telegram bot token | Yes | Use your own BotFather token in local `.dev.vars` and the deployed `BOT_TOKEN` secret. |
| Administrator Telegram ID | Yes | Set your numeric ID in local `.dev.vars` and the deployed `ADMIN_TELEGRAM_ID` secret. |
| Webhook secret | Yes | Generate your own value and use the same value locally, in Cloudflare, and when registering the Telegram webhook. |
| Public Worker URL | Yes, after deployment | Use the URL returned by Wrangler as `PUBLIC_WORKER_URL` when running the Telegram setup scripts. |
| Cloudflare Worker name | Optional | Change `name` in `wrangler.jsonc`, then use the resulting Worker URL in setup and diagnostics. |
| D1 database name | Optional | Change `database_name` in `wrangler.jsonc`; also update the matching database name in `package.json` scripts and documented D1 commands. |
| Brand and reward policy | Optional | Change the non-secret settings in `src/config/app-config.ts`. |

The included D1 `database_id` is a resource identifier, not a password, API
token, or authentication credential. Possessing the ID alone does not grant
access to the database; Cloudflare still requires authenticated credentials
with permission to the owning account. Nevertheless, a new owner cannot use
the included SoulShop database and must replace its ID with the UUID returned
when creating a database in their own account.

Keep the D1 binding name as `DB`, because the Worker accesses the database as
`env.DB`. Keep the secret names `BOT_TOKEN`, `ADMIN_TELEGRAM_ID`, and
`WEBHOOK_SECRET` unchanged. Never commit the values of those secrets,
Cloudflare API tokens, account credentials, `.dev.vars`, customer data, CSV
exports, or SQL backups.

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

For a fresh Git checkout, clone the repository, select the V2.0.8 release, and
install the exact dependencies recorded in `package-lock.json`:

```powershell
git clone <YOUR_REPOSITORY_URL>
Set-Location "<CLONED_PROJECT_DIRECTORY>"
git checkout v2.0.8
code .
npm.cmd ci
```

If the project is already downloaded and checked out at V2.0.8, open PowerShell
in that directory and run:

```powershell
code .
npm.cmd ci
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

Choose a database name. Keeping `soulshop-rewards-db` requires fewer
documentation changes, but a new owner may use another name:

```powershell
$DatabaseName = "soulshop-rewards-db"
npx.cmd wrangler d1 create $DatabaseName --binding DB
```

The command creates a remote D1 database in the currently authenticated
Cloudflare account and prints its UUID. Open `wrangler.jsonc` and replace the
included SoulShop `database_id` with that UUID. Keep your own returned value;
do not copy the example ID from this repository:

```jsonc
"database_id": "YOUR_NEW_D1_DATABASE_ID" // Use the UUID returned by Wrangler.
```

Keep the application binding as `DB`. If `$DatabaseName` was changed, put the
same name in `database_name` and update both D1 migration scripts in
`package.json` before continuing:

```jsonc
"binding": "DB",
"database_name": "soulshop-rewards-db" // Or the name stored in $DatabaseName.
```

Verify the edited configuration before any remote operation:

```powershell
npx.cmd wrangler d1 info $DatabaseName
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

V2.0.6 added `0007_multi_identifier_customers.sql`. It preserves existing
customer IDs, phones, balances, retained transactions, receipts, and
leaderboards while adding WhatsApp/Telegram username aliases and rebuilding
foreign-key-dependent tables. Existing installations must take a protected D1
export before applying it, verify all copy/foreign-key checks, apply migration
`0007`, and only then deploy the matching Worker. Follow the mandatory
[V2.0.6 release guide](V2.0.6-RELEASE.md) for backup, validation, deployment,
verification, and rollback. The older
[V2.0.5 release guide](V2.0.5-RELEASE.md) remains as release history, and the
[V2.0.3 runbook](V2.0.3-RELEASE.md) remains as release history.

V2.0.7 adds `0008_allow_whatsapp_username_period.sql`. Fresh installations
apply it with all preceding migrations. Existing V2.0.6 installations must
take a protected D1 export, compare pre/post row and value totals, apply 0008
before deploying the V2.0.7 Worker, and verify foreign keys. Follow the
mandatory [V2.0.7 release guide](V2.0.7-RELEASE.md); no production migration is
performed automatically.

V2.0.8 adds no migration. Fresh installations still apply the complete chain
through `0008`; existing V2.0.7 installations must verify that `0008` is
already applied, run the local validation gates, and deploy only the matching
V2.0.8 Worker. Follow the [V2.0.8 release guide](V2.0.8-RELEASE.md).

For V2.0.2, review [the bounded-storage hotfix runbook](V2.0.2-MIGRATION.md) before any remote action. Migration `0006_bounded_operational_storage.sql` preserves unbounded customers, balances, and aggregates while bounding operational receipts. V2.0.2 removes the compound trigger that caused the V2.0.1 remote migration attempt to fail with `incomplete input`; normal transaction and completed-receipt pruning remains explicit and atomic in the Worker batch. This repository preparation did not apply the corrected migration to production or deploy the Worker.

For V2.0.0, review [the production migration runbook](V2.0.0-MIGRATION.md) before any remote action. The safe order is:

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
2. Record Purchase uses `🛍️`, and Record Purchase, Add Points Manually, Redeem Points, Check Balance, and Customer History each show their bold operation heading above `Select a customer:`.
3. Selecting phone suffix, full phone, WhatsApp username, or Telegram username search repeats the selected operation above the relevant entry copy, and customer-search screens use the compact `⬅️ Back` button.
4. `/addcustomer` asks for an initial identifier type; verify phone creation and username-only creation both start at zero points with no reward transaction. A leading username `@` is discarded while capitalization remains visible. Verify the standardized phone/WhatsApp-username/Telegram-username prompts, copied bidirectional-control cleanup, valid WhatsApp periods, Telegram period rejection, and a valid retry immediately after invalid input.
5. `/purchase` finds the customer by four or five final digits, shows the newest retained purchase or manual addition while skipping redemptions, rejects decimal BDT input, and follows the active centralized mode. Verify that every displayed purchase amount uses two decimals and Bangladeshi grouping, including `BDT 10,201.00` and `BDT 1,10,201.00`, and that a customer without eligible retained data shows `No Prior Data Found!`. Test every configured bracket boundary and floor behavior using the authoritative values in `src/config/app-config.ts`; also verify the alternative flat policy in an isolated configuration test.
6. `/addpoints` shows the same newest retained earning context, including a safely escaped manual-add reason when present, then adds a fractional value and labels the resulting total as the updated reward balance.
7. `/redeem` rejects an amount above the balance, accepts a valid fraction, and clearly separates redeemed and remaining values. Verify that `Redeem All Points` still requires confirmation and reduces an exact balance with hidden third/fourth decimal precision to `0.00` without an insufficient-balance error.
8. `/balance` labels the latest total as the current reward balance and its rounded BDT amount as the estimated reward value.
9. `/history` shows newest-first entries in Asia/Dhaka time.
10. `/export` sends the selected CSV file(s).
11. `/managecustomer` finds one D1 customer by any alias; add/change/remove each alias type, reject a same-platform duplicate, preserve capitalization-only username changes, and block removal of the final alias. Confirm balances/history/leaderboards stay unchanged and full customer-specific screens show only existing identifiers in the ordered `Customer Info:` block.
12. `/leaderboard` shows the five supported period views, identifier-aware top-10 rankings, and independent reset confirmations. Verify `WA`/`TG` username labels, primary-identifier priority, and exact `(+1 alias)`/`(+2 aliases)` indicators in both weekly and monthly views.
13. Reset Current Week leaves monthly totals unchanged; Reset Current Month leaves weekly totals unchanged.
14. `/restart` drops collected values and restarts the same operation.
15. `/cancel` clears state and returns to the dashboard.
16. Purchase, manual-add, redemption, and balance results display each closing tagline with a visible `> ` prefix; history omits them.
17. A different Telegram user cannot search, mutate, export, view leaderboards, or reset them.

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

The Record Purchase and Add Points amount-entry panels perform one read-only
lookup for the newest retained `PURCHASE` or `MANUAL_ADD`; they skip `REDEEM`.
Because only 40 detailed rows are retained per customer, a customer whose
retained rows contain only redemptions displays `No Prior Data Found!` even if
an older earning transaction once existed.

Database table and invariant details are documented in [DATABASE.md](DATABASE.md).

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
- **D1 binding error:** new owners must replace the included SoulShop database ID with the ID from their own Cloudflare account and keep the binding name `DB`.
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

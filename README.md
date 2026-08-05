# SoulShop Rewards Point System

An administrator-only Telegram bot for registering SoulShop customers, earning fractional loyalty points, redeeming points, checking balances and history, and exporting operational CSV data. It runs as a Cloudflare Worker, receives Telegram HTTPS webhooks, and stores all durable data in Cloudflare D1.

No AI service, paid database, continuously running server, custom domain, or production long polling is used.

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
        +-- D1 conversation state and idempotency
        +-- D1 customers and append-only transactions
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
- `BDT 1 spent = 125 point units`.
- A purchase earns `purchase BDT × 125` point units.
- `1 point = BDT 0.25` reward value.
- Rounded reward BDT is `floor((point units + 20,000) / 40,000)`.
- Point balances and transaction deltas use integers only. JavaScript floating point is never the source of truth.
- Manual additions and redemptions accept up to four decimal places.

Example:

```text
BDT 525 = 65,625 units = 6.5625 points
6.5625 points ≈ BDT 2 reward value
```

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
| `/restart` | Restart the active workflow |
| `/cancel` | Cancel the active workflow |
| `/help` | Show bot instructions |

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

The migrations create `customers`, `transactions`, `conversation_states`, and `processed_updates`, plus suffix/history indexes, database constraints, resumable export progress, and a workflow update-order boundary that rejects delayed updates from an older operation.

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
npm run typecheck
npm run lint
npm run test:run
npm run build
```

Or:

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
2. `/addcustomer` normalizes a Bangladesh or E.164 number and creates zero points.
3. `/purchase` finds it by four or five final digits and records BDT 525 as 6.5625 points.
4. `/addpoints` adds a fractional value and safely displays an HTML-like note.
5. `/redeem` rejects an amount above the balance and accepts a valid fraction.
6. `/balance` shows the latest point and rounded BDT values.
7. `/history` shows newest-first entries in Asia/Dhaka time.
8. `/export` sends the selected CSV file(s).
9. `/restart` drops collected values and restarts the same operation.
10. `/cancel` clears state and returns to the dashboard.
11. A different Telegram user cannot search, mutate, or export.

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

Customer balances are the source of truth; transactions are append-only audit history.

## 16. Export and backup

### Method A: Telegram CSV

Use `/export` for readable customer lists, spreadsheet analysis, operational reports, and transaction review. CSV protects phone numbers and other leading formula characters from spreadsheet formula execution. Configured row and byte limits fail with a warning rather than silently truncating.

### Method B: full Wrangler D1 SQL export

Use this for schema/data preservation, disaster recovery, and complete restoration:

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
- Customer balance and audit insertion are one atomic D1 batch guarded by an expected balance.
- Unique Telegram update IDs prevent duplicate balance changes.
- Notes and dynamic values are HTML escaped.
- CSV formula injection is neutralized.
- No real token or secret belongs in source control.

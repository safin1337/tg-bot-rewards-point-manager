# Security policy

## Reporting a vulnerability

Do not open a public issue containing a token, webhook secret, administrator
identifier, Cloudflare credential, customer phone number, note, export, backup,
or exploitable security detail. Prefer the repository's private GitHub Security
Advisory reporting channel when it is enabled. Otherwise contact the repository
owner privately and provide only the minimum sanitized reproduction needed.

Revoke or rotate any credential that may have been exposed before sharing a
report. Never attach a production D1 export or complete Telegram update.

## Supported release

Security fixes are prepared against the current `main` branch and latest
documented release. Operators should validate and deploy reviewed fixes promptly
while keeping production deployment, secrets, webhooks, and D1 operations under
manual control.

## Operational security baseline

- Restrict the bot to the configured administrator Telegram ID.
- Require the exact Telegram webhook secret header.
- Store production secrets with Cloudflare, not in Git-tracked files.
- Keep customer data, CSV exports, SQL backups, Wrangler state, and logs private.
- Review dependency, Worker, D1, and Telegram changes before deployment.
- Take and protect a backup before any approved production data migration.

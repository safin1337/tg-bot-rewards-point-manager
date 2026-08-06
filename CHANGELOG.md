# Changelog

All notable changes to the SoulShop Rewards Point System are documented in this file.

## [2.0.0] - 2026-08-05

### Transaction retention and permanent idempotency

- Retain only the newest 40 detailed transactions per customer across
  `PURCHASE`, `MANUAL_ADD`, and `REDEEM` combined, ordered deterministically by
  `created_at_utc DESC, id DESC`.
- Added compact permanent mutation receipts keyed by Telegram update ID so a
  pruned update can never change a balance or leaderboard twice.
- Extended the atomic D1 mutation boundary to include the update claim,
  expected-balance update, detailed transaction, weekly/monthly aggregates,
  completed receipt, and required per-customer pruning.
- Kept `customers.point_balance_units` authoritative. Balances and reward
  values are never recalculated from retained transaction rows.

### Weekly and monthly leaderboards

- Added the administrator-only `/leaderboard` command and dashboard action.
- Added current, previous, and two-weeks-ago weekly views plus current and
  previous monthly views using Monday-based Asia/Dhaka periods.
- Count positive `PURCHASE` and `MANUAL_ADD` point units as gross earnings;
  `REDEEM` neither adds nor subtracts leaderboard earnings.
- Rank by exact earned point units, then earliest qualifying earning timestamp,
  then customer ID. Results display normalized phone numbers only and at most
  10 customers.
- Display leaderboard points with deterministic two-decimal rounding while
  retaining exact integer point units and four-decimal internal precision.

### Independent resets and safe migration

- Added confirmation-protected, idempotent resets for the current week and
  current month. Each reset starts a new generation without changing customer
  balances, detailed transactions, or the other period type.
- Persist reset cutoffs, generations, administrator identity, and Telegram
  update IDs; rotate state tokens and bind confirmations to the period key so
  stale callbacks cannot reset a newly started period.
- Added migration `0004` to create and backfill receipts, applicable aggregates,
  and reset structures, followed by migration `0005`, which verifies receipts
  and aggregate consistency before the first approved prune.
- Detailed Telegram history and transaction CSV exports now contain only
  retained rows. Pruned detail cannot be reconstructed without an external
  backup, while balances, idempotency, and leaderboard aggregates remain
  intact.

## [1.0.0] - 2026-08-05

Initial release of the administrator-only SoulShop loyalty management bot for
Telegram, running on Cloudflare Workers with Cloudflare D1 persistence.

### Customer and reward workflows

- Added an inline Telegram dashboard and slash commands for customer
  registration, purchases, manual point additions, redemptions, balances,
  transaction history, data exports, help, restart, and cancellation.
- Added zero-balance customer registration with duplicate detection and an
  option to create a missing customer while recording a purchase or manual
  point addition.
- Added shared phone normalization for Bangladesh mobile numbers and valid
  international E.164-style numbers. Customers can be selected by a complete
  number or an indexed search using exactly the final four or five digits.
- Added deterministic, paginated customer search with up to eight results per
  page, reusable customer action buttons, and a `Search Again` path on result
  and no-match screens.
- Added purchase recording at 125 point units per BDT, equivalent to one point
  for every BDT 80 spent.
- Added fractional manual additions and redemptions with up to four decimal
  places, optional notes for manual additions, confirmation previews, and
  insufficient-balance protection.
- Added current balance views and newest-first transaction history showing
  purchase details, balance changes, reward values, notes, and timestamps in
  the Asia/Dhaka time zone. History is paginated at five entries per page.

### Reward calculations

- Store balances as integer point units, where one point equals 10,000 units,
  so floating-point values are never the source of truth.
- Recalculate the rounded reward value from the complete point-unit balance
  using `floor((pointUnits + 20,000) / 40,000)` rather than summing rounded
  transaction values.
- Validate arithmetic against JavaScript safe-integer and supported database
  integer ranges before storing a balance or transaction.

### Data exports

- Added Telegram CSV exports for customer balances, transaction history, or
  both datasets.
- Generate UTF-8 CSV files with RFC-style quoting and spreadsheet
  formula-injection protection.
- Enforce configurable row and byte limits without silently truncating data,
  and preserve delivery progress so interrupted multi-file exports can resume
  safely.

### Reliability and data integrity

- Persist customers, append-only transaction history, workflow state, and
  processed-update records in Cloudflare D1 through versioned migrations.
- Update customer balances and insert their matching audit transactions in one
  atomic D1 batch, guarded by an expected balance and a database-level
  nonnegative-balance condition.
- Prevent duplicate Telegram updates and repeated confirmations from creating
  customers, changing balances, or delivering exports more than once.
- Persist workflow state with expiration, rotate callback tokens when searches
  restart, reject stale buttons, and ignore delayed updates from an older
  operation.
- Make `/restart` clear collected values while preserving the active operation;
  `/cancel` clears the operation and returns to the dashboard.
- Validate Telegram updates, API response envelopes, D1 rows, and serialized
  workflow payloads at runtime so malformed external data fails safely.

### Security and privacy

- Restrict all bot access to one configured Telegram administrator, checked
  before customer lookup, mutation, history, or export work begins.
- Require an exact Telegram webhook secret header and expose only a minimal
  `GET /health` endpoint alongside the protected `POST /webhook` route.
- Escape dynamic Telegram HTML values, including customer notes, and return
  sanitized application errors.
- Keep bot tokens, webhook secrets, administrator IDs, customer data, logs,
  generated CSV files, SQL backups, Wrangler state, coverage, and build output
  out of source control.

### Operations and quality

- Added scripts for local and remote D1 migrations, local development,
  production dry-run builds, deployment, webhook inspection and management,
  and Telegram command registration. Production-mutating scripts run only when
  invoked explicitly.
- Added strict TypeScript, ESLint, and automated tests covering domain rules,
  D1 atomicity and idempotency, Telegram security and API handling, workflows,
  message formatting, and safe exports.

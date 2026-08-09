# Changelog

All notable changes to the SoulShop Rewards Point System are documented in this file.

## [2.0.3] - 2026-08-07

### Customer-selection context

- Added a bold, emoji-prefixed active-operation heading to the customer-selection
  panel for Record Purchase, Add Points Manually, Redeem Points, Check Balance,
  and Customer History.
- Preserved the existing Add New Customer workflow and copy without changes.
- Covered the exact five message layouts and dashboard callback transitions with
  regression tests. Slash commands and `/restart` share the same start path.

### Two-decimal Telegram point display

- All Telegram-visible point amounts now use exactly two decimal places with
  standard half-up rounding at the third decimal digit. For example, `4.123`
  displays as `4.12`, while `4.126` displays as `4.13`.
- Preserved exact integer point units and up-to-four-decimal precision for
  parsing, storage, reward calculations, leaderboard ranking, and CSV exports.
- Added rounding-boundary, message, workflow, and export regression coverage.

### Clear reward balance copy

- Replaced sentence-style reward summaries with concise label-value lines for
  purchase, manual-add, redemption, and balance results.
- Distinguished updated, current, redeemed, and remaining values while
  retaining the existing headings, Congratulations rules, and closing lines.
- Added comma grouping to Telegram point totals for easier reading without
  changing integer point units, reward rounding, or CSV precision.

### Release scope

- Added no D1 schema or data migration and changed no reward, customer, search,
  authorization, idempotency, retention, or Telegram callback rules.
- Added no new release version or tag for the two-decimal presentation change;
  it remains part of the existing V2.0.3 work.
- Updated package metadata, workflow documentation, acceptance checks, and the
  release/deployment runbook for V2.0.3.
- No production deployment, webhook change, Git push, or remote tag was performed
  during release preparation.

## [2.0.2] - 2026-08-07

### Remote D1 migration hotfix

- Corrected the unapplied `0006_bounded_operational_storage.sql` migration by
  removing its compound `CREATE TRIGGER ... BEGIN ... END` statement. Wrangler
  submitted the V2.0.1 migration through the remote D1 query endpoint, where
  that form failed with `incomplete input` and was fully rolled back.
- Preserved the exact retention target: customers remain unbounded,
  transactions remain limited to the newest 40 per customer, and completed
  mutation receipts remain limited to those corresponding retained rows.
- Kept transaction pruning and completed-receipt pruning as adjacent statements
  in the same atomic mutation batch. Existing rollback tests cover failures in
  either pruning operation, and a new regression verifies that pruning leaves
  no completed receipt without its retained transaction.
- Documented that direct manual transaction deletion is unsupported unless its
  corresponding completed receipt is removed in the same reviewed D1 batch.
- Updated package metadata, the database design, migration runbook, workflow
  version, release instructions, and permanent repository safeguards for
  V2.0.2.
- No corrected production D1 migration, Worker deployment, webhook change,
  production-secret operation, Git push, or remote tag was performed during
  this hotfix preparation.

## [2.0.1] - 2026-08-07

### Bounded operational storage

- Added migration `0006_bounded_operational_storage.sql`, which backfills a
  per-customer mutation update-ID high-water mark, removes completed receipts
  without retained transaction counterparts, adds paired-delete enforcement,
  creates retention indexes, bounds reset and processed-update receipts, and
  aborts on foreign-key violations.
- Completed mutation receipts now correspond exactly to the newest 40 retained
  transactions per customer. Transaction and receipt pruning remain inside the
  atomic balance/transaction/leaderboard/receipt mutation batch.
- Leaderboard reset receipts and eligible non-active processed updates are
  retained only when both no older than two clamped UTC calendar months and
  within the latest 40 overall, with Telegram update ID as the stable tie-breaker.
- Active five-minute processed-update leases and partial export delivery
  progress remain protected; stale processing work is reclaimable or eligible
  for cleanup.

### Active Telegram messages

- Added validated typed Telegram responses and a reusable edit-or-send fallback
  that treats `message is not modified` as successful.
- Confirmation panels now become their success results after the database work
  commits. Edit failures fall back to one new result message without repeating
  customer creation, point mutations, or leaderboard resets.
- Customer search, history pagination, customer actions, balance transitions,
  leaderboard navigation, Search Again, and callback cancellations now reuse
  the callback message. Responses following typed input remain new messages to
  preserve chronological order.
- Missing callback messages safely fall back to the administrator chat, and all
  authorized, unauthorized, stale, invalid, and duplicate callbacks are answered
  before workflow processing.

### Operations

- Updated database, migration, workflow, and permanent agent documentation for
  the bounded v2.0.1 policy. Customers remain unbounded, and retained history is
  never the source of truth for balances or leaderboards.
- No production D1 migration, Worker deployment, webhook registration, or
  production-secret operation was performed for this release preparation.

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

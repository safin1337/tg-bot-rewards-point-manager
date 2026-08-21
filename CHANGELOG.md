# Changelog

All notable changes to the Telegram Bot: Loyalty Rewards Point Manager are documented in this file.

## [2.0.8] - 2026-08-22

### Compact identity-aware leaderboards

- Kept every weekly and monthly ranking entry on one logical line while
  shortening username labels to `WA @Username` and `TG @Username`.
- Preserved the primary-identifier priority of WhatsApp number, WhatsApp
  username, then Telegram username. When a ranked customer has additional
  identifiers, the points now carry an exact `(+1 alias)` or `(+2 aliases)`
  indicator without exposing every alias or changing ranking order.
- Added direct D1, formatter, and Telegram callback regression coverage for
  phone-only, WhatsApp-only, Telegram-only, every two-identifier combination,
  all three identifiers, and both weekly and monthly views.

### Share-ready customer presentation

- Rendered every configured closing tagline with a visible `> ` prefix so
  purchase, manual-add, redemption, and balance results become WhatsApp
  blockquotes when copied and pasted. Tagline configuration, `{brand}`
  substitution, ordering, and Telegram HTML escaping remain centralized.
- Wrapped the escaped configured heading in literal `*` markers on those same
  customer-shareable messages so the title becomes bold when pasted into
  WhatsApp, while ordinary Telegram screens retain their HTML-bold heading.
- Gave purchase receipts a complete WhatsApp-ready presentation contract:
  monospace customer and transaction details, bold Congratulations and reward
  value markers, and the concise `Updated reward balance` label. Manual-add and
  balance results retain the `Current reward balance` label.
- Formatted every Telegram `Purchase Amount: BDT ...` field with exactly two
  decimals and Bangladeshi lakh/crore grouping, such as `10,201.00`,
  `1,10,201.00`, and `1,00,00,000.00`.
- Kept purchase input, D1 integer storage, reward calculations, estimated
  reward values, point formatting, and CSV values unchanged.

### Release compatibility

- Added no D1 migration, schema change, data backfill, webhook change, command
  registration change, or secret change. V2.0.8 runs on the V2.0.7 schema with
  migrations through `0008_allow_whatsapp_username_period.sql` applied.
- Updated installation, workflow, customization, database, release, and
  permanent-agent documentation for the new exact presentation contracts.
- No production deployment, remote D1 operation, commit, push, or tag was
  performed by this work.

## [2.0.7] - 2026-08-16

### Bug Fix

- Fixed valid WhatsApp and Telegram usernames copied with invisible Unicode
  bidirectional formatting characters being incorrectly rejected. Recognized
  formatting controls are now safely removed before validation, allowing valid
  usernames to be accepted without restarting the operation.
- Fixed photos and other non-text Telegram messages being rejected with an
  HTTP 400 webhook response, which could trigger repeated Telegram delivery
  attempts and delay subsequent commands. Valid non-text updates are now
  acknowledged safely without changing the active workflow.

### Platform-specific usernames

- Split WhatsApp and Telegram username validation while retaining one optional
  leading `@`, display capitalization, lowercase lookup, and independent
  case-insensitive platform namespaces.
- Added WhatsApp period support with leading, trailing, and consecutive periods
  rejected. Telegram usernames continue to reject periods.
- Added migration `0008_allow_whatsapp_username_period.sql` using a
  dependency-aware customer-table rebuild that preserves identifiers, customer
  IDs, balances, transactions, receipts, leaderboards, conversation state,
  timestamps, indexes, uniqueness, and foreign keys.

### Customer messages and prompts

- Added one shared conditional `Customer Info:` formatter for full balance,
  confirmation, success, history, existing-customer, and customer-management
  messages. Empty identifier lines and `Not provided` placeholders are omitted.
- Standardized WhatsApp number, WhatsApp username, and Telegram username input
  prompts across customer search, creation, and management while retaining
  operation headings and navigation.
- Preserved configured branding and taglines, exact reward lines, compact
  primary identifiers in lists and amount-entry panels, and the rule that
  redemption messages never contain `Congratulations`.

### Documentation and validation

- Added adjacent whole-order range comments to the configured earning brackets
  without changing policy values or runtime behavior, and removed duplicated
  bracket values from the historical V2.0.5 changelog wording.
- Updated installation, upgrade, database, username, prompt, and Customer Info
  documentation for V2.0.7.
- Added normalization, invalid-retry, platform-validation, exact-message, and
  representative pre-0008 data-preservation migration regression tests.
- Added parser, HTTP acknowledgement, notification-failure, caption-isolation,
  workflow-state, follow-up-command, and non-mutation regression tests for
  non-text Telegram updates.
- No production migration, deployment, webhook update, command registration,
  commit, push, or tag was performed by this work.

## [2.0.6] - 2026-08-14

### Multi-identifier customers

- Kept `customers.id` as the immutable customer identity while adding nullable,
  independently unique WhatsApp username and Telegram username aliases beside
  the existing WhatsApp phone alias.
- Preserved entered username capitalization for Telegram and CSV display while
  making search and uniqueness case-insensitive. One optional leading `@` is
  discarded; accepted username characters are `A-Z`, `a-z`, `0-9`, and `_`,
  with a 64-character maximum.
- Added exact WhatsApp-username and Telegram-username search to every customer
  operation. Phone suffix and normalized full-phone search remain available.
- Added `/managecustomer` and dashboard/customer-action entry points for adding,
  changing, and removing current aliases. The final alias cannot be removed.
- Updated `/addcustomer` so a new zero-point customer can start with any one of
  the three alias types. Existing reward rules and zero-transaction creation
  behavior are unchanged.

### Concurrency and data safety

- Added conditional identifier updates bound to the exact value displayed at
  confirmation time. A concurrent change is rejected as stale instead of being
  overwritten; no `identity_version` column or identity-history table is used.
- Added database-level case-insensitive uniqueness, phone/suffix consistency,
  and at-least-one-identifier constraints. Duplicate aliases are rejected and
  customers are never merged automatically.
- Added migration `0007_multi_identifier_customers.sql`. It preserves customer
  IDs, balances, transactions, mutation receipts, leaderboard aggregates, and
  conversation state while rebuilding every table whose foreign key depends on
  `customers`. Copy and foreign-key guards abort the migration on inconsistency.
- Identity edits never create reward transactions and never recalculate or
  rewrite balances, retained history, receipts, or leaderboard totals.

### Exports, documentation, and validation

- Added WhatsApp and Telegram username columns to customer and transaction CSV
  exports and identifier-aware labels to messages and leaderboards.
- Added a V2.0.6 release runbook with mandatory pre-migration backup and
  post-migration integrity checks. No production migration, deployment,
  webhook registration, or command registration was performed by this work.
- Expanded domain, repository, workflow, migration, stale-state, duplicate,
  last-alias, retry, and reward-preservation tests.

## [2.0.5] - 2026-08-13

### Centralized earning modes

- Added a master `rewards.earning.mode` switch in `APP_CONFIG` with `"flat"`
  and `"bracketed"` options. V2.0.5 activates the bracketed whole-order policy;
  the alternative flat policy remains available through the centralized
  configuration.
- Added configurable whole-order earning brackets defined in
  `src/config/app-config.ts`. This is not a progressive slab calculation.
- Added the independent `pointFloorProtection` switch. When enabled, each
  later bracket inherits the highest award at preceding boundaries so spending
  more never reduces earned points; when disabled, the selected bracket rate
  applies without protection.

### Exact arithmetic and deployment safety

- Preserved positive whole-number BDT purchase input and continued rejecting
  decimals, zero, negatives, whitespace, and other invalid formats.
- Added integer-only rational earning calculations that round half-up once to
  four-decimal point-unit precision before storage. Telegram continues to
  display point amounts with its separate two-decimal half-up rule.
- Expanded the earning-policy fingerprint to cover the active mode, policy ID,
  rate or bracket boundaries, floor state, and rounding policy. Pending
  confirmations created under a different policy are rejected before mutation.
- Existing balances, completed transactions, history, reward snapshots,
  leaderboard totals, mutation receipts, and redemption behavior are not
  recalculated or rewritten. No D1 migration or data backfill is required.

### Customer-search context and copy

- Added `Selected Operation: {emoji} {operation}` above both second-level
  customer-number prompts so the active workflow remains visible after choosing
  `Search by Last Digits` or `Enter Full Number`.
- Changed the suffix prompt to `Enter the last 4 or 5 digits of the WhatsApp
  No.` followed by `Telegram / WhatsApp Username are not accepted`.
- Changed the full-number prompt to `Enter the full WhatsApp number.` followed
  by `Spaces and hyphens are accepted.`.
- Replaced the Record Purchase cart emoji with `🛍️` across the dashboard,
  operation headings, customer actions, and current documentation.

### Latest earning transaction context

- Record Purchase and Add Points amount-entry panels now show the customer's
  newest retained `PURCHASE` or `MANUAL_ADD` transaction while skipping newer
  `REDEEM` entries.
- Added the Asia/Dhaka transaction time, two-decimal earned points, purchase
  amount for purchases, and HTML-escaped reason for manual additions when one
  exists. Customers without an eligible retained entry show
  `No Prior Data Found!`.
- The lookup is read-only and bounded by the existing newest-40 transaction
  retention. It adds no table, column, migration, backfill, or production-data
  rewrite.

### Back navigation

- Added a tokenized `Back` action below the first operation level while keeping
  `Cancel` as the operation exit to the dashboard.
- Customer-number prompts and results use the compact `⬅️ Back` label and
  return to Search Options; amount and note confirmations return to their
  preceding input step; customer creation confirmation returns to number entry.
- Back transitions preserve the active operation, clear values collected after
  the destination, rotate the state token, and make prior Confirm/Search/Back
  buttons stale without creating a customer or reward mutation.
- Updated the project-local Wrangler development dependency to 4.123.0.

### Documentation and validation

- Updated the README, customization, database, installation, Telegram workflow,
  release, and permanent-agent guidance for both earning modes and their safety
  boundaries.
- Added configuration validation and regression coverage for flat compatibility,
  all bracket boundaries, half-up four-decimal storage, floor enabled/disabled,
  recursive floors, non-progressive behavior, help text, stale-policy
  protection, and active-mode-independent test fixtures.
- No Git branch, commit, tag, push, GitHub release, Cloudflare deployment,
  webhook registration, remote D1 operation, or production-secret change was
  performed during build preparation.

## [2.0.4] - 2026-08-10

### Exact full-balance redemption

- Added a `Redeem All Points` button to the redemption amount prompt while
  preserving manual entry for partial redemptions.
- The button reads the selected customer's exact integer point balance from D1
  and prepares the existing confirmation step. It does not derive the amount
  from the rounded two-decimal Telegram display.
- Preserved callback acknowledgement, active-operation and token validation,
  customer-ID authority, expected-balance conflict protection, atomic mutation,
  idempotency, and the requirement to confirm before points are changed.
- Added callback-size and end-to-end regression coverage using a balance whose
  hidden four-decimal precision displays as `1,300.70` and is redeemed exactly
  to zero.
- Kept the project at V2.0.4. No D1 schema migration, data rewrite, reward-rate
  change, remote database operation, deployment, or Git operation was required
  or performed for this maintenance change.

### Public-friendly configuration

- Repositioned the project as a reusable, production-ready Telegram loyalty
  and reward-point manager with a new public README introduction while
  preserving attribution to the original SoulShop — Bangladesh's E-Shop build.
- Added `src/config/app-config.ts` as the non-secret runtime source for the
  brand name, application heading, independently editable taglines, and reward
  policy.
- Added `{brand}` placeholder substitution, escaped configurable Telegram HTML,
  and safe brand-derived CSV filename prefixes with a deterministic fallback.
- Documented the infrastructure identifiers that remain separate from runtime
  branding and added a public security-reporting policy.

### Reward policy and deployment safety

- Changed the default future-purchase earning policy from BDT 80 = 1 point to
  BDT 50 = 1 point, derived as exactly 200 integer point units per BDT.
- Kept the redemption policy unchanged at 4 points = BDT 1 (1 point = BDT
  0.25) and preserved the existing half-up reward rounding rule.
- Added integer-only configuration validation that rejects non-exact or
  unsupported point-unit ratios. Runtime help text now derives from the same
  validated policy.
- Bound purchase confirmations to the earning-policy identifier used for their
  displayed calculation. A pre-deployment stale confirmation is acknowledged,
  cleared, and rejected before any customer, transaction, leaderboard, or
  mutation-receipt write.
- Existing balances, historical transactions, reward snapshots, mutation
  receipts, and leaderboard totals remain unchanged. New purchases use the new
  policy, so an active week or month can contain purchases from both policies.
- Added no D1 migration, backfill, data rewrite, or infrastructure rename.

### Documentation and validation

- Added `docs/CUSTOMIZATION.md` with branding, tagline, earning-policy,
  redemption-migration, infrastructure, privacy, and local-testing guidance.
- Added `docs/V2.0.4-RELEASE.md` with reviewed branch, pull-request, deployment,
  live-verification, tagging, and rollback procedures.
- Anchored the generated-export ignore rule to `/exports/` so the required
  `src/exports/export-service.ts` source is included in public clones while
  generated CSV exports remain ignored.
- Updated database/workflow documentation and permanent agent rules to keep
  branding and configurable rates centralized, integer-safe, escaped, and
  compatible with the exact Telegram message contracts.
- Added regression coverage for default and alternative branding, placeholder
  substitution, Telegram HTML escaping, filename slugs, exact/invalid reward
  ratios, generated help text, the new purchase rate, and stale confirmation
  rejection without mutation.
- No commit, push, merge, tag, production deployment, webhook registration,
  secret change, or remote D1 operation was performed during release
  preparation.

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

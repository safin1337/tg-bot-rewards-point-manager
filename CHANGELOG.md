# Changelog

All notable changes to the SoulShop Rewards Point System are documented in this file.

## [Unreleased]

### Fixed

- Prevented delayed Telegram messages and callbacks from an older workflow from
  continuing or replacing a newer operation. The active operation now persists
  its starting Telegram update ID, and the controller rejects updates at or
  below that boundary. Migration `0003_workflow_update_order.sql` adds the
  required `operation_started_update_id` column without changing prior
  migrations or existing balances and transaction history.
- Strengthened mutation validation so purchase point units must equal
  `purchaseAmountBdt * 125`, point-unit values and Telegram update IDs must be
  safe integers, and balance-changing operations cannot accept invalid or
  nonpositive amounts.
- Strengthened runtime validation for data read from D1 and conversation
  `payload_json`. Customer, transaction, state, timestamp, normalized-phone,
  suffix, balance, reward snapshot, and transaction-sign invariants are now
  checked instead of being trusted through TypeScript assertions.
- Preserved atomic balance and history updates and added a real local-D1
  insertion-failure test. A forced transaction insert failure now proves that
  the associated customer balance update rolls back, while stale and
  concurrent expected balances fail without overwriting newer data.
- Prevented duplicate confirmations from changing a balance or inserting a
  transaction more than once by retaining database uniqueness and replay
  checks through the complete confirmation workflow.
- Made interrupted exports recoverable by allowing a stale `PROCESSING` claim
  to be reclaimed after its lease expires while preserving delivery progress.
- Validated Telegram API response envelopes at runtime. Malformed JSON,
  missing results, `ok: false` responses, and non-success HTTP responses now
  fail safely without exposing the bot token or Telegram API URL.
- Hardened webhook setup by parsing `PUBLIC_WORKER_URL` as a URL and requiring
  a credential-free HTTPS origin with no path, query string, or fragment.
- Enforced repository-owned pagination limits: customer suffix search returns
  at most eight deterministic results per page and history returns at most five
  records per page. Invalid suffixes and page indexes are rejected before D1 is
  queried.
- Required confirmation callbacks to match the active operation type, retained
  customer ID as the authoritative selection value, and removed the duplicate
  SoulShop heading from `/cancel` responses.

### Tests

- Added real-D1 coverage for transaction-insertion rollback, duplicate update
  IDs, insufficient redemption balance, stale expected balances, and a
  concurrent-style balance conflict.
- Added workflow coverage for delayed updates, duplicate confirmations,
  four-digit suffix selection, the required `Taking entry` prompt, immediate
  searchability of newly created customers, and the BDT 525 purchase case.
- Added Telegram client tests for malformed and unsuccessful API envelopes.
- Verified the 20-point balance / 8-point redemption case, exact branded
  message line breaks and taglines, CSV formula protection, and export recovery.

### Validation

- Applied migrations `0001` through `0003` to an empty local D1 database and
  confirmed that the foreign-key check returned no violations.
- Passed strict TypeScript checking and ESLint.
- Passed 179 automated tests across 8 test files.
- Passed the Wrangler production dry-run build at 96.50 KiB upload size and
  18.79 KiB gzip size.
- Reported zero dependency vulnerabilities and confirmed that local secrets,
  exports, backups, Wrangler state, coverage, and build output remain ignored.
- No Worker deployment, production database mutation, real webhook
  registration, or real-secret use occurred during this repair pass.

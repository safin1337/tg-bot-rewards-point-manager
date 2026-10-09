# V2.1.0 Customer Merging and Splitting

## Administrator Workflow

1. Open Manage Customer Identities (`/managecustomer`).
2. Select the customer whose ID should remain, usually the WhatsApp-number account.
3. Add the WhatsApp or Telegram username belonging to the other account.
4. Review both customer IDs, identifiers, balances, and the combined balance.
5. Choose Confirm Merge only after verifying both records belong to the same person.

A 100-point phone account and a 200-point username account become one
300-point account. Entering an owned phone while managing a username account
also supports merging; the selected account always survives. Back rotates the
token and returns to identity management; Cancel exits without merging.

The merge confirmation warns that a later split resets every resulting account
to zero and does not restore old balances. To separate identities, select the
account in Manage Customer Identities and choose `Split and Reset Points`.
Review the identities and points to erase, then `Confirm Split and Reset`.

## Split and Reset Policy

A split makes each current identifier a separate zero-point customer. A phone,
WhatsApp username, and Telegram username become three accounts; two identifiers
become two. This also works for multi-identifier accounts that were created by
adding aliases, without a prior merge. Single-identifier customers cannot split.

The existing ID keeps the phone when present, otherwise the WhatsApp username,
along with all retained transaction history, reward receipts, creation IDs, and
merge redirects. Detached usernames receive new IDs with no reward transaction
or old history. All resulting accounts keep the original test classification.
Every resulting balance and rounded reward value starts at zero, and the original
account's leaderboard earnings across retained periods are cleared. Existing
lifetime redemption snapshots remain unchanged: points erased by a split are
not redeemed points. Future purchases, Quick Buy, manual additions, redemption,
and identity changes use the usual pipelines.

This is a fresh start, not restoration of pre-merge accounts. Both confirmations
explain the consequence. The split confirmation shows the current balance to
erase and account count. Back/Cancel never reset balances.

Migration `0011_customer_splits.sql` creates durable split receipts. The reset,
identity separation, new accounts, leaderboard deletion, high-water marks,
other-workflow invalidation, snapshot validation, and integrity check share one
atomic batch. Failure rolls back all changes. The active confirmation remains
until success delivery, and concurrent/delayed retries reuse the receipt instead
of creating another account or erasing subsequent earnings. Keep these receipts;
they are independent of newest-40 reward receipts. Ordinary alias removal is
unchanged and does not reset points or create a separated customer.

Accounts must have the same test classification and complementary identity
slots. Two different phones, two WhatsApp usernames, or two Telegram usernames
block merging; no identifier is silently overwritten. Normal and test accounts
cannot be merged. Two test accounts remain a test account with the configured
analytics exclusions. Existing identity uniqueness and last-identifier rules
continue to apply after merging.

## Feature Dependencies

| Feature | After merging |
| --- | --- |
| Balance and reward BDT | Exact units are added and reward BDT is recalculated once. |
| Purchase and manual points | Normal earning policy and mutation pipeline use the surviving ID. |
| Quick Buy | The normalized WhatsApp number finds the combined account; no replacement customer is created. |
| Redemption / Redeem All | The surviving exact balance is authoritative; normal confirmation and expected-balance checks apply. |
| History / earning-entry context | Both retained histories move to the surviving ID. The newest 40 remain, and latest-earning lookup still skips redemptions. |
| Weekly/monthly leaderboards | Earnings combine only for matching period type, period key, and reset generation. Earliest earning time remains the tie-breaker. |
| Leaderboard resets | Existing period generations and reset receipts are unchanged. Old generations cannot reappear in current rankings. |
| Dashboard | Included exact units stay the same; the included customer count decreases by one. |
| Lifetime redemption | Existing cumulative snapshots are unchanged. Future redemptions use the normal classification rules. |
| CSV exports | One customer row contains all identities; retained transactions reference the surviving ID. |
| Later identity edits | All identifiers belong to the surviving account and can be edited using the existing rules. |

Historical balances before/after transactions remain exactly as recorded on
their original accounts. Merging does not invent an earning/redemption
transaction or rewrite old financial snapshots into a continuous combined
balance. The merge receipt records the consolidation separately.

Leaderboards use gross earned units in their original time periods, never the
combined current balance. Expired periods are pruned using the existing policy:
current/previous month and current/two previous weeks. Redemption does not
subtract leaderboard earnings. Merging creates no new qualifying earning.

## Atomicity and Retries

One D1 batch validates both customer snapshots and the exact active workflow,
claims the merge token, moves history/receipts, combines leaderboard rows,
updates earlier merge redirects, invalidates other selected workflows, removes
the absorbed customer, updates the surviving balance/aliases/high-water mark,
and prunes combined transactions and receipts. Any database failure rolls back
the entire batch. Unsafe balance or leaderboard sums also prevent a merge.

The surviving high-water mark advances through the merge update. Retained
reward receipts still return their original snapshots on retry. Pruned delayed
reward updates cannot apply again. Old identity/classification writes must
still match their active state. Ordinary lookup by a removed customer ID returns
no customer; stale workflows cannot silently switch accounts.

`customer_merge_receipts` keeps one small durable row per absorbed customer.
It preserves the source's creation-update ID so replaying an old creation
cannot create a second customer after its identifier changes. Subsequent
merges redirect earlier receipts to the latest surviving ID. Do not manually
prune these redirects as if they were newest-40 reward receipts.

Success is displayed after commit. Confirmation state stays until Telegram's
edit or send fallback succeeds. A retry after delivery failure reads the merge
receipt and cannot add points twice. A changed/expired workflow or changed
customer snapshot requires a new preview.

## Installation and Upgrade

The V2.1.0 Worker requires `migrations/0010_customer_merges.sql` and
`migrations/0011_customer_splits.sql`. These additive migrations create the
receipt tables without changing existing customer,
transaction, leaderboard, lifetime snapshot, or workflow data.

Local verification:

```powershell
npm.cmd run db:migrate:local
npm.cmd run check
git check-ignore -v .dev.vars
git check-ignore -v migrations/0001_initial_schema.sql
git status --short
```

Before a separately authorized production rollout, protect a full D1 backup,
apply migrations 0010 and 0011 to the intended production database, verify existing
business rows/balances are unchanged and `PRAGMA foreign_key_check;` returns
no rows, then deploy the matching Worker. Test the merge with controlled
accounts and verify balance, phone/username lookup, history, leaderboard, and
CSV output. Local tests and the deployment dry run do not verify production.

The migrations are compatible with the previous Worker. Reverting Worker code
does not undo completed merges or splits. Use Split and Reset Points for the
supported zero-balance separation policy. Restoring original balances instead
requires reviewed data restoration from protected backup, including all dependent
records; do not recreate an absorbed row or subtract points manually.

## Regression Coverage

`tests/customer-merge.test.ts` covers exact merging, all identifier lookups,
history and exports, period/generation isolation, retention/high-water marks,
post-merge Quick Buy and reward mutations, later identity edits, test-account
behavior, chained redirects, concurrent confirmation, rollback, stale workflow
and customer races, delivery retries, safe arithmetic, and migration preservation.
Existing workflow tests also cover the owned-identifier preview.

Split tests cover two/three identities, username-only accounts, test classification,
preserved history/receipts/lifetime totals, cleared leaderboards, subsequent earnings,
redemption, Quick Buy, identity edits, remerging, snapshot/workflow races, rollback,
concurrent confirmation, migration preservation, and delivery retries.

D1's batch rollback contract is documented in
[Cloudflare's D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

## Local Verification (2026-10-04)

- `npm.cmd run db:migrate:local`: migration 0010 applied successfully locally.
- `npm.cmd run check`: typecheck, lint, 15 test files / 485 tests, and the
  Wrangler deployment dry run passed.
- `.dev.vars` remains ignored; migrations remain trackable. Tracked-path checks
  found no secret files, CSV exports, backups, Wrangler state, coverage, or
  build output.
- No production migration, deployment, webhook change, commit, or push was
  performed. Production behavior remains unverified until an authorized rollout.

## Split Verification (2026-10-09)

- Migration 0011 applied successfully to local D1.
- Full `npm.cmd run check` passed: typecheck, lint, 15 test files / 495 tests,
  and Wrangler deployment dry run. Git whitespace and ignored-artifact checks passed.
- Split/reset behavior, warning screens, history/lifetime preservation, retries,
  rollback, concurrent confirmation, and post-split operations were validated.
- No remote migration, deployment, commit, tag, or push was performed.

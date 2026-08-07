# SoulShop V2.0.2 database design

## Sources of truth

`customers` is unbounded. `customers.point_balance_units` is the only source
of truth for an available point balance, and `rounded_reward_bdt` is
recalculated from the total with
`floor((pointUnits + 20,000) / 40,000)` after every mutation.

Detailed `transactions` and operational receipt rows never reconstruct
balances or leaderboards. `leaderboard_aggregates` is the independent source
for leaderboard totals.

## Exact retention matrix

| Data | Retention |
|---|---|
| `customers` | Unbounded |
| `transactions` | Latest 40 per customer across `PURCHASE`, `MANUAL_ADD`, and `REDEEM` combined |
| completed `mutation_receipts` | The receipts corresponding to those retained latest 40 transactions per customer |
| `leaderboard_reset_receipts` | Both within two UTC calendar months and within the latest 40 overall |
| eligible non-active `processed_updates` | Both within two UTC calendar months and within the latest 40 overall |
| actively leased `processed_updates` | Preserved until the five-minute processing lease becomes stale |
| leaderboard weeks | Current plus two previous weeks |
| leaderboard months | Current plus previous month |

The two-calendar-month cutoff subtracts two months from the current UTC date
and time and clamps the day to the last valid day of the target month. For
example, `2026-08-31T12:34:56.789Z` produces
`2026-06-30T12:34:56.789Z`, and `2024-04-30T00:00:00.000Z` produces
`2024-02-29T00:00:00.000Z`. Rows strictly before the cutoff are deleted; a row
exactly at the cutoff remains age-eligible. Latest-40 ordering uses the UTC
timestamp descending and Telegram update ID descending as the stable
tie-breaker.

## Transactions and completed mutation receipts

Transaction retention order is `created_at_utc DESC, id DESC`. Mutation
creation remains append-only, after which the same atomic D1 batch:

1. claims the Telegram update ID;
2. conditionally updates the expected customer balance and mutation update-ID
   high-water mark;
3. inserts the detailed transaction;
4. updates applicable weekly/monthly aggregates;
5. completes the mutation receipt;
6. deletes transactions beyond position 40 and their matching completed
   receipts;
7. prunes obsolete leaderboard periods; and
8. runs a retention/integrity guard.

The adjacent transaction-pruning and completed-receipt-pruning statements
enforce paired deletion inside the same atomic D1 batch. Any transaction or
receipt pruning failure rolls back the balance, detailed row, aggregates,
receipt completion, and all pruning. Processing receipts are not deleted by
normal completed-receipt pruning. Claims are created and completed in one
atomic D1 batch, so an active claim is uncommitted and cannot be observed by
cleanup; migration `0006` removes only abandoned committed `PROCESSING` rows
left by older or manually altered data.

Migration `0006` intentionally creates no compound SQLite trigger because
Wrangler remote migrations submit SQL through the D1 query endpoint, where the
V2.0.1 trigger form failed with `incomplete input`. Direct manual deletion from
`transactions` is therefore unsupported unless the corresponding completed
`mutation_receipts` are deleted in the same reviewed D1 batch. Normal bot
mutations always perform both pruning statements atomically.

`customers.latest_mutation_telegram_update_id` is backfilled during migration
and advances atomically with each balance mutation. A retained receipt handles
an exact retry and returns the stored snapshots. After an old transaction and
receipt are pruned, the high-water mark rejects that delayed update instead of
allowing it to mutate the balance again.

History pages and transaction CSV exports contain only retained detail. A
protected pre-pruning external backup is the only way to preserve older
detailed history.

## Leaderboard aggregates and reset receipts

Weekly keys are Monday dates in `Asia/Dhaka`; monthly keys are `YYYY-MM`.
Only `PURCHASE` and `MANUAL_ADD` increment exact integer gross-earned units.
`REDEEM` never changes leaderboard totals. Ranking order remains:

1. `earned_point_units DESC`;
2. `first_qualifying_earning_at_utc ASC`; and
3. `customer_id ASC`.

A reset atomically increments only the selected current period generation and
removes obsolete aggregates for that generation. Reset receipt cleanup runs in
the reset batch, changes no leaderboard total or generation, and enforces the
two-calendar-month/latest-40 intersection described above.

## Processed Telegram updates and exports

`processed_updates` uses a five-minute `PROCESSING` lease. A lease at or newer
than the lease boundary is active and cannot be deleted or reclaimed. A
strictly older lease is stale and may be reclaimed; stale processing rows are
also eligible for bounded cleanup.

`COMPLETED`, `FAILED`, and stale `PROCESSING` rows are eligible non-active
records. Cleanup retains only the newest 40 age-eligible rows. Claim,
completion, and failure paths run cleanup using the same captured UTC clock.
Reclaiming a failed or stale export preserves `export_progress`, so an accepted
document is not resent when a later document fails.

## Relationships and indexes

- Transactions, mutation receipts, and aggregates reference unbounded
  customers with restrictive deletes.
- Aggregates reference periods with `ON DELETE CASCADE`.
- Customer suffix, transaction history, leaderboard ranking, mutation receipt,
  reset receipt, and processed-update cleanup paths have matching indexes.
- Retention queries use deterministic timestamp/update-ID or timestamp/row-ID
  ordering.

Run `PRAGMA foreign_key_check;` after migration and restoration. Any returned
row is a release blocker. Retention row counts above their policy boundaries
are also release blockers.

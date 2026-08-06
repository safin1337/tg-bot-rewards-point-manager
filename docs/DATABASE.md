# SoulShop V2.0.0 database design

## Sources of truth

`customers.point_balance_units` is the only source of truth for an available
point balance. `customers.rounded_reward_bdt` is recalculated from that total
with `floor((pointUnits + 20,000) / 40,000)` after each mutation.

Detailed `transactions` rows are not used to reconstruct balances or
leaderboards. They are operational history snapshots retained under the
newest-40 policy.

## Detailed transaction retention

Each customer retains at most 40 detailed rows total across `PURCHASE`,
`MANUAL_ADD`, and `REDEEM`. Newest rows are selected by:

1. `created_at_utc DESC`
2. `id DESC`

Insertion remains append-only during mutation creation. The same atomic D1
batch then deletes only that customer's rows after position 40. A final guard
requires the completed receipt to exist and the customer row count to be at
most 40; otherwise the whole mutation rolls back.

History pages and transaction CSV exports therefore contain retained detail
only. Deleted detail cannot be recreated from balances or aggregates.

## Permanent mutation receipts

`mutation_receipts.telegram_update_id` is the permanent unique identity of a
completed balance mutation. A receipt stores:

- customer and mutation type;
- signed point-unit delta;
- before/after point balances;
- before/after rounded reward values;
- rounded transaction reward value;
- completion timestamp.

Receipts do not reference detailed transaction IDs, so pruning cannot break
them. A replay returns the stored snapshots plus the customer's current
authoritative balance without applying the mutation or leaderboard increments
again.

The mutation batch performs, in order, the receipt claim, conditional balance
update, detailed insertion, applicable leaderboard updates, receipt
completion, pruning, period retention cleanup, and final invariant guard.
D1 rolls the entire batch back if a statement fails.

## Leaderboard periods and aggregates

`leaderboard_periods` identifies a `WEEK` or `MONTH` by an Asia/Dhaka calendar
key and stores its active reset generation. Weekly keys are Monday dates such
as `2026-08-03`; monthly keys are `YYYY-MM`.

`leaderboard_aggregates` is keyed by period type, period key, generation, and
customer. It stores exact positive integer point units and the first qualifying
earning timestamp. The top-10 index follows the complete ranking order:

1. `earned_point_units DESC`
2. `first_qualifying_earning_at_utc ASC`
3. `customer_id ASC`

Only `PURCHASE` and `MANUAL_ADD` increment aggregates. `REDEEM` does not add or
subtract gross earnings. Current plus two previous weeks and current plus one
previous month are queryable; older periods are excluded and removed during
normal aggregate maintenance.

## Reset generations

`leaderboard_reset_receipts` permanently records the Telegram update ID,
administrator ID, period type/key, resulting generation, and UTC reset time.
A reset atomically increments only the selected current period's generation
and removes obsolete aggregates from older generations of that period.

Transactions and balances are not changed. The other period type is not
changed. The first qualifying earning after reset creates the first aggregate
for the new generation, so both totals and tie-break timestamps restart.

Reset confirmation state stores the targeted period key. If the Dhaka week or
month changes before confirmation, the callback is rejected instead of
resetting the newly running period.

## Relationships and indexes

- Detailed transactions, mutation receipts, and aggregates reference
  `customers` with restrictive deletes.
- Aggregates reference their period with `ON DELETE CASCADE`, allowing safe
  removal of obsolete period data.
- Receipt lookup is primary-key based; a customer/time index supports audit
  diagnostics.
- `idx_leaderboard_top10` constrains ranking reads to one period and generation.
- Existing suffix and newest-history indexes remain unchanged.

Run `PRAGMA foreign_key_check;` after migration and restoration. Any returned
row is a release blocker.


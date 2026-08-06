CREATE TABLE _v2_retention_migration_guard (
  missing_count INTEGER NOT NULL CHECK (missing_count = 0)
);

INSERT INTO _v2_retention_migration_guard (missing_count)
SELECT COUNT(*)
FROM transactions AS transaction_row
LEFT JOIN mutation_receipts AS receipt
  ON receipt.telegram_update_id = transaction_row.telegram_update_id
WHERE receipt.telegram_update_id IS NULL
   OR receipt.customer_id != transaction_row.customer_id
   OR receipt.mutation_type != transaction_row.transaction_type
   OR receipt.status != 'COMPLETED';

WITH qualifying AS (
  SELECT
    'WEEK' AS period_type,
    date(
      created_at_utc,
      '+6 hours',
      '-' || ((CAST(strftime('%w', created_at_utc, '+6 hours') AS INTEGER) + 6) % 7) || ' days'
    ) AS period_key,
    customer_id,
    points_delta_units,
    created_at_utc
  FROM transactions
  WHERE transaction_type IN ('PURCHASE', 'MANUAL_ADD')
  UNION ALL
  SELECT
    'MONTH' AS period_type,
    strftime('%Y-%m', created_at_utc, '+6 hours') AS period_key,
    customer_id,
    points_delta_units,
    created_at_utc
  FROM transactions
  WHERE transaction_type IN ('PURCHASE', 'MANUAL_ADD')
), expected AS (
  SELECT
    period_type,
    period_key,
    customer_id,
    SUM(points_delta_units) AS earned_point_units,
    MIN(created_at_utc) AS first_qualifying_earning_at_utc
  FROM qualifying
  WHERE (
    period_type = 'WEEK'
    AND period_key IN (
      date('now', '+6 hours', '-' || ((CAST(strftime('%w', 'now', '+6 hours') AS INTEGER) + 6) % 7) || ' days'),
      date('now', '+6 hours', '-' || ((CAST(strftime('%w', 'now', '+6 hours') AS INTEGER) + 6) % 7) || ' days', '-7 days'),
      date('now', '+6 hours', '-' || ((CAST(strftime('%w', 'now', '+6 hours') AS INTEGER) + 6) % 7) || ' days', '-14 days')
    )
  ) OR (
    period_type = 'MONTH'
    AND period_key IN (
      strftime('%Y-%m', 'now', '+6 hours'),
      strftime('%Y-%m', 'now', '+6 hours', 'start of month', '-1 month')
    )
  )
  GROUP BY period_type, period_key, customer_id
), mismatches AS (
  SELECT expected.*
  FROM expected
  LEFT JOIN leaderboard_aggregates AS aggregate_row
    ON aggregate_row.period_type = expected.period_type
   AND aggregate_row.period_key = expected.period_key
   AND aggregate_row.generation = 0
   AND aggregate_row.customer_id = expected.customer_id
  WHERE aggregate_row.customer_id IS NULL
     OR aggregate_row.earned_point_units != expected.earned_point_units
     OR aggregate_row.first_qualifying_earning_at_utc != expected.first_qualifying_earning_at_utc
)
INSERT INTO _v2_retention_migration_guard (missing_count)
SELECT COUNT(*) FROM mismatches;

DELETE FROM transactions
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY customer_id
        ORDER BY created_at_utc DESC, id DESC
      ) AS retention_position
    FROM transactions
  )
  WHERE retention_position > 40
);

DROP TABLE _v2_retention_migration_guard;


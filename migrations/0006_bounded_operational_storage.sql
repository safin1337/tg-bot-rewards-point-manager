ALTER TABLE customers
ADD COLUMN latest_mutation_telegram_update_id INTEGER
CHECK (
  latest_mutation_telegram_update_id IS NULL
  OR (
    typeof(latest_mutation_telegram_update_id) = 'integer'
    AND latest_mutation_telegram_update_id >= 0
  )
);

UPDATE customers
SET latest_mutation_telegram_update_id = (
  SELECT MAX(receipt.telegram_update_id)
  FROM mutation_receipts AS receipt
  WHERE receipt.customer_id = customers.id
    AND receipt.status = 'COMPLETED'
);

DELETE FROM mutation_receipts
WHERE status = 'COMPLETED'
  AND NOT EXISTS (
    SELECT 1
    FROM transactions AS transaction_row
    WHERE transaction_row.telegram_update_id = mutation_receipts.telegram_update_id
      AND transaction_row.customer_id = mutation_receipts.customer_id
      AND transaction_row.transaction_type = mutation_receipts.mutation_type
  );

-- A mutation claim is created and completed inside one D1 batch. An active
-- claim is therefore uncommitted and cannot be observed here; any committed
-- PROCESSING row was abandoned by older or manually altered data.
DELETE FROM mutation_receipts
WHERE status = 'PROCESSING';

-- Normal retention deletes old transactions and their corresponding completed
-- receipts as adjacent statements in the same atomic D1 batch. Keep this
-- migration free of compound trigger statements so Wrangler can apply it
-- through the remote D1 migration query endpoint.

CREATE INDEX idx_mutation_receipts_customer_completed
  ON mutation_receipts(
    customer_id,
    status,
    completed_at_utc DESC,
    telegram_update_id DESC
  );

CREATE INDEX idx_leaderboard_reset_retention
  ON leaderboard_reset_receipts(reset_at_utc DESC, telegram_update_id DESC);

CREATE INDEX idx_processed_updates_retention
  ON processed_updates(processed_at_utc DESC, telegram_update_id DESC);

WITH retention_clock AS (
  SELECT printf(
    '%s-%02dT%sZ',
    strftime('%Y-%m', 'now', 'start of month', '-2 months'),
    MIN(
      CAST(strftime('%d', 'now') AS INTEGER),
      CAST(strftime('%d', 'now', 'start of month', '-1 month', '-1 day') AS INTEGER)
    ),
    strftime('%H:%M:%f', 'now')
  ) AS cutoff_utc
), retained AS (
  SELECT telegram_update_id
  FROM leaderboard_reset_receipts, retention_clock
  WHERE reset_at_utc >= cutoff_utc
  ORDER BY reset_at_utc DESC, telegram_update_id DESC
  LIMIT 40
)
DELETE FROM leaderboard_reset_receipts
WHERE telegram_update_id NOT IN (SELECT telegram_update_id FROM retained);

WITH retention_clock AS (
  SELECT
    printf(
      '%s-%02dT%sZ',
      strftime('%Y-%m', 'now', 'start of month', '-2 months'),
      MIN(
        CAST(strftime('%d', 'now') AS INTEGER),
        CAST(strftime('%d', 'now', 'start of month', '-1 month', '-1 day') AS INTEGER)
      ),
      strftime('%H:%M:%f', 'now')
    ) AS cutoff_utc,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes') AS stale_processing_before_utc
), eligible AS (
  SELECT update_row.telegram_update_id, update_row.processed_at_utc
  FROM processed_updates AS update_row, retention_clock
  WHERE update_row.status != 'PROCESSING'
     OR update_row.processed_at_utc < stale_processing_before_utc
), retained AS (
  SELECT eligible.telegram_update_id
  FROM eligible, retention_clock
  WHERE eligible.processed_at_utc >= cutoff_utc
  ORDER BY eligible.processed_at_utc DESC, eligible.telegram_update_id DESC
  LIMIT 40
)
DELETE FROM processed_updates
WHERE telegram_update_id IN (SELECT telegram_update_id FROM eligible)
  AND telegram_update_id NOT IN (SELECT telegram_update_id FROM retained);

CREATE TABLE _v201_foreign_key_guard (
  violation_count INTEGER NOT NULL CHECK (violation_count = 0)
);

INSERT INTO _v201_foreign_key_guard (violation_count)
SELECT COUNT(*) FROM pragma_foreign_key_check;

DROP TABLE _v201_foreign_key_guard;

-- Durable redirects preserve creation idempotency after a customer is merged.
-- One row per absorbed customer; these are not reward mutation receipts.
CREATE TABLE customer_merge_receipts (
  token TEXT PRIMARY KEY CHECK (length(token) BETWEEN 6 AND 16),
  source_customer_id INTEGER NOT NULL UNIQUE CHECK (source_customer_id > 0),
  original_target_customer_id INTEGER NOT NULL CHECK (original_target_customer_id > 0),
  target_customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  source_creation_update_id INTEGER UNIQUE,
  telegram_update_id INTEGER NOT NULL UNIQUE CHECK (telegram_update_id >= 0),
  target_balance_units INTEGER NOT NULL CHECK (target_balance_units >= 0),
  source_balance_units INTEGER NOT NULL CHECK (source_balance_units >= 0),
  merged_balance_units INTEGER NOT NULL CHECK (
    typeof(merged_balance_units) = 'integer'
    AND merged_balance_units = target_balance_units + source_balance_units
    AND merged_balance_units <= 9007199254740991
  ),
  completed_at_utc TEXT NOT NULL,
  valid_guard INTEGER NOT NULL CHECK (valid_guard = 1),
  CHECK (source_customer_id != original_target_customer_id)
);

CREATE INDEX idx_customer_merge_target ON customer_merge_receipts(target_customer_id);

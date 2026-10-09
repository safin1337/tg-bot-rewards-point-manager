-- Split resets are administrative actions, not purchases or redemptions.
CREATE TABLE customer_split_receipts (
  token TEXT PRIMARY KEY CHECK (length(token) BETWEEN 6 AND 16),
  customer_id INTEGER NOT NULL CHECK (customer_id > 0),
  telegram_update_id INTEGER NOT NULL UNIQUE CHECK (
    typeof(telegram_update_id) = 'integer' AND telegram_update_id >= 0
  ),
  erased_point_units INTEGER NOT NULL CHECK (
    typeof(erased_point_units) = 'integer' AND erased_point_units >= 0
    AND erased_point_units <= 9007199254740991
  ),
  account_count INTEGER NOT NULL CHECK (account_count IN (2, 3)),
  completed_at_utc TEXT NOT NULL,
  valid_guard INTEGER NOT NULL CHECK (valid_guard = 1)
);

ALTER TABLE customers ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(is_test) = 'integer' AND is_test IN (0, 1));

CREATE INDEX idx_customers_is_test ON customers(is_test, id);

CREATE TABLE lifetime_redemption_snapshots (
  telegram_update_id INTEGER PRIMARY KEY CHECK (
    typeof(telegram_update_id) = 'integer' AND telegram_update_id >= 0
  ),
  redemption_count INTEGER NOT NULL UNIQUE CHECK (
    typeof(redemption_count) = 'integer'
    AND redemption_count > 0
    AND redemption_count <= 9007199254740991
  ),
  redeemed_point_units INTEGER NOT NULL CHECK (
    typeof(redeemed_point_units) = 'integer'
    AND redeemed_point_units > 0
    AND redeemed_point_units <= 9007199254740991
  ),
  cumulative_redeemed_point_units INTEGER NOT NULL CHECK (
    typeof(cumulative_redeemed_point_units) = 'integer'
    AND cumulative_redeemed_point_units > 0
    AND cumulative_redeemed_point_units <= 9007199254740991
  ),
  recorded_at_utc TEXT NOT NULL
);

CREATE INDEX idx_lifetime_redemption_snapshots_newest
  ON lifetime_redemption_snapshots(redemption_count DESC);

-- Existing redemptions belong only to disposable test accounts, so V2.0.9
-- intentionally starts the business lifetime totals at zero without backfill.

ALTER TABLE conversation_states RENAME TO conversation_states_v208;

CREATE TABLE conversation_states (
  administrator_telegram_id TEXT PRIMARY KEY,
  active_operation TEXT NOT NULL CHECK (
    active_operation IN (
      'PURCHASE', 'MANUAL_ADD', 'REDEEM', 'BALANCE', 'HISTORY',
      'ADD_CUSTOMER', 'MANAGE_CUSTOMER', 'MANAGE_TEST_ACCOUNT',
      'EXPORT', 'LEADERBOARD'
    )
  ),
  current_step TEXT NOT NULL,
  selection_mode TEXT CHECK (
    selection_mode IS NULL
    OR selection_mode IN (
      'PHONE_SUFFIX', 'PHONE_FULL', 'WHATSAPP_USERNAME', 'TELEGRAM_USERNAME'
    )
  ),
  selected_customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  search_query TEXT CHECK (
    search_query IS NULL OR length(search_query) BETWEEN 1 AND 64
  ),
  search_page INTEGER NOT NULL DEFAULT 0 CHECK (search_page >= 0),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  expires_at_utc TEXT NOT NULL,
  operation_started_update_id INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(operation_started_update_id) = 'integer'
    AND operation_started_update_id >= 0
  )
);

INSERT INTO conversation_states (
  administrator_telegram_id, active_operation, current_step, selection_mode,
  selected_customer_id, search_query, search_page, payload_json,
  created_at_utc, updated_at_utc, expires_at_utc, operation_started_update_id
)
SELECT
  administrator_telegram_id, active_operation, current_step, selection_mode,
  selected_customer_id, search_query, search_page, payload_json,
  created_at_utc, updated_at_utc, expires_at_utc, operation_started_update_id
FROM conversation_states_v208;

DROP TABLE conversation_states_v208;
CREATE INDEX idx_conversation_states_expiry ON conversation_states(expires_at_utc);

CREATE TABLE _v209_foreign_key_guard (
  violation_count INTEGER NOT NULL CHECK (violation_count = 0)
);

INSERT INTO _v209_foreign_key_guard (violation_count)
SELECT COUNT(*) FROM pragma_foreign_key_check;

DROP TABLE _v209_foreign_key_guard;

PRAGMA defer_foreign_keys = ON;
PRAGMA legacy_alter_table = ON;

ALTER TABLE customers RENAME TO customers_v205;

CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  whatsapp_number TEXT UNIQUE
    CHECK (
      whatsapp_number IS NULL
      OR (
        length(whatsapp_number) BETWEEN 8 AND 16
        AND substr(whatsapp_number, 1, 1) = '+'
        AND length(substr(whatsapp_number, 2)) BETWEEN 7 AND 15
        AND substr(whatsapp_number, 2) NOT GLOB '*[^0-9]*'
      )
    ),
  phone_last4 TEXT
    CHECK (
      phone_last4 IS NULL
      OR (length(phone_last4) = 4 AND phone_last4 NOT GLOB '*[^0-9]*')
    ),
  phone_last5 TEXT
    CHECK (
      phone_last5 IS NULL
      OR (length(phone_last5) = 5 AND phone_last5 NOT GLOB '*[^0-9]*')
    ),
  whatsapp_username TEXT COLLATE NOCASE UNIQUE
    CHECK (
      whatsapp_username IS NULL
      OR (
        length(whatsapp_username) BETWEEN 1 AND 64
        AND whatsapp_username NOT GLOB '*[^A-Za-z0-9_]*'
      )
    ),
  telegram_username TEXT COLLATE NOCASE UNIQUE
    CHECK (
      telegram_username IS NULL
      OR (
        length(telegram_username) BETWEEN 1 AND 64
        AND telegram_username NOT GLOB '*[^A-Za-z0-9_]*'
      )
    ),
  point_balance_units INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(point_balance_units) = 'integer' AND point_balance_units >= 0),
  rounded_reward_bdt INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(rounded_reward_bdt) = 'integer' AND rounded_reward_bdt >= 0),
  creation_telegram_update_id INTEGER UNIQUE,
  latest_mutation_telegram_update_id INTEGER
    CHECK (
      latest_mutation_telegram_update_id IS NULL
      OR (
        typeof(latest_mutation_telegram_update_id) = 'integer'
        AND latest_mutation_telegram_update_id >= 0
      )
    ),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  CHECK (
    (
      whatsapp_number IS NULL
      AND phone_last4 IS NULL
      AND phone_last5 IS NULL
    )
    OR (
      whatsapp_number IS NOT NULL
      AND phone_last4 = substr(whatsapp_number, -4)
      AND phone_last5 = substr(whatsapp_number, -5)
    )
  ),
  CHECK (
    whatsapp_number IS NOT NULL
    OR whatsapp_username IS NOT NULL
    OR telegram_username IS NOT NULL
  )
);

INSERT INTO customers (
  id, whatsapp_number, phone_last4, phone_last5,
  whatsapp_username, telegram_username,
  point_balance_units, rounded_reward_bdt,
  creation_telegram_update_id, latest_mutation_telegram_update_id,
  created_at_utc, updated_at_utc
)
SELECT
  id, whatsapp_number, phone_last4, phone_last5,
  NULL, NULL,
  point_balance_units, rounded_reward_bdt,
  creation_telegram_update_id, latest_mutation_telegram_update_id,
  created_at_utc, updated_at_utc
FROM customers_v205;

CREATE TABLE _v206_customer_copy_guard (
  mismatch_count INTEGER NOT NULL CHECK (mismatch_count = 0)
);

INSERT INTO _v206_customer_copy_guard (mismatch_count)
SELECT COUNT(*)
FROM (
  SELECT
    id, whatsapp_number, phone_last4, phone_last5,
    point_balance_units, rounded_reward_bdt,
    creation_telegram_update_id, latest_mutation_telegram_update_id,
    created_at_utc, updated_at_utc
  FROM customers_v205
  EXCEPT
  SELECT
    id, whatsapp_number, phone_last4, phone_last5,
    point_balance_units, rounded_reward_bdt,
    creation_telegram_update_id, latest_mutation_telegram_update_id,
    created_at_utc, updated_at_utc
  FROM customers
);

INSERT INTO _v206_customer_copy_guard (mismatch_count)
SELECT COUNT(*)
FROM (
  SELECT
    id, whatsapp_number, phone_last4, phone_last5,
    point_balance_units, rounded_reward_bdt,
    creation_telegram_update_id, latest_mutation_telegram_update_id,
    created_at_utc, updated_at_utc
  FROM customers
  EXCEPT
  SELECT
    id, whatsapp_number, phone_last4, phone_last5,
    point_balance_units, rounded_reward_bdt,
    creation_telegram_update_id, latest_mutation_telegram_update_id,
    created_at_utc, updated_at_utc
  FROM customers_v205
);

DROP TABLE _v206_customer_copy_guard;

-- SQLite rewrites foreign-key targets when a referenced table is renamed.
-- Rebuild every direct dependent table before removing the old customer table
-- so all retained rows continue to reference the canonical customers table.
ALTER TABLE transactions RENAME TO transactions_v205;

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('PURCHASE', 'MANUAL_ADD', 'REDEEM')),
  purchase_amount_bdt INTEGER,
  points_delta_units INTEGER NOT NULL CHECK (
    typeof(points_delta_units) = 'integer'
    AND (
      (transaction_type IN ('PURCHASE', 'MANUAL_ADD') AND points_delta_units > 0)
      OR (transaction_type = 'REDEEM' AND points_delta_units < 0)
    )
  ),
  balance_before_units INTEGER NOT NULL
    CHECK (typeof(balance_before_units) = 'integer' AND balance_before_units >= 0),
  balance_after_units INTEGER NOT NULL CHECK (
    typeof(balance_after_units) = 'integer'
    AND balance_after_units >= 0
    AND balance_after_units = balance_before_units + points_delta_units
  ),
  rounded_reward_before_bdt INTEGER NOT NULL
    CHECK (typeof(rounded_reward_before_bdt) = 'integer' AND rounded_reward_before_bdt >= 0),
  rounded_reward_after_bdt INTEGER NOT NULL
    CHECK (typeof(rounded_reward_after_bdt) = 'integer' AND rounded_reward_after_bdt >= 0),
  transaction_reward_rounded_bdt INTEGER NOT NULL
    CHECK (typeof(transaction_reward_rounded_bdt) = 'integer' AND transaction_reward_rounded_bdt >= 0),
  note TEXT CHECK (note IS NULL OR (length(note) BETWEEN 1 AND 500)),
  telegram_update_id INTEGER NOT NULL UNIQUE,
  created_at_utc TEXT NOT NULL,
  CHECK (
    (transaction_type = 'PURCHASE' AND purchase_amount_bdt IS NOT NULL
      AND typeof(purchase_amount_bdt) = 'integer' AND purchase_amount_bdt > 0)
    OR (transaction_type != 'PURCHASE' AND purchase_amount_bdt IS NULL)
  )
);

INSERT INTO transactions (
  id, customer_id, transaction_type, purchase_amount_bdt, points_delta_units,
  balance_before_units, balance_after_units, rounded_reward_before_bdt,
  rounded_reward_after_bdt, transaction_reward_rounded_bdt, note,
  telegram_update_id, created_at_utc
)
SELECT
  id, customer_id, transaction_type, purchase_amount_bdt, points_delta_units,
  balance_before_units, balance_after_units, rounded_reward_before_bdt,
  rounded_reward_after_bdt, transaction_reward_rounded_bdt, note,
  telegram_update_id, created_at_utc
FROM transactions_v205;
DROP TABLE transactions_v205;
CREATE INDEX idx_transactions_customer ON transactions(customer_id);
CREATE INDEX idx_transactions_created_at ON transactions(created_at_utc DESC, id DESC);
CREATE INDEX idx_transactions_customer_newest
  ON transactions(customer_id, created_at_utc DESC, id DESC);

ALTER TABLE mutation_receipts RENAME TO mutation_receipts_v205;

CREATE TABLE mutation_receipts (
  telegram_update_id INTEGER PRIMARY KEY CHECK (
    typeof(telegram_update_id) = 'integer' AND telegram_update_id >= 0
  ),
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  mutation_type TEXT NOT NULL CHECK (mutation_type IN ('PURCHASE', 'MANUAL_ADD', 'REDEEM')),
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED')),
  points_delta_units INTEGER NOT NULL CHECK (
    typeof(points_delta_units) = 'integer'
    AND (
      (mutation_type IN ('PURCHASE', 'MANUAL_ADD') AND points_delta_units > 0)
      OR (mutation_type = 'REDEEM' AND points_delta_units < 0)
    )
  ),
  balance_before_units INTEGER NOT NULL CHECK (
    typeof(balance_before_units) = 'integer' AND balance_before_units >= 0
  ),
  balance_after_units INTEGER NOT NULL CHECK (
    typeof(balance_after_units) = 'integer'
    AND balance_after_units >= 0
    AND balance_after_units = balance_before_units + points_delta_units
  ),
  rounded_reward_before_bdt INTEGER NOT NULL CHECK (
    typeof(rounded_reward_before_bdt) = 'integer' AND rounded_reward_before_bdt >= 0
  ),
  rounded_reward_after_bdt INTEGER NOT NULL CHECK (
    typeof(rounded_reward_after_bdt) = 'integer' AND rounded_reward_after_bdt >= 0
  ),
  transaction_reward_rounded_bdt INTEGER NOT NULL CHECK (
    typeof(transaction_reward_rounded_bdt) = 'integer'
    AND transaction_reward_rounded_bdt >= 0
  ),
  completed_at_utc TEXT NOT NULL
);

INSERT INTO mutation_receipts (
  telegram_update_id, customer_id, mutation_type, status, points_delta_units,
  balance_before_units, balance_after_units, rounded_reward_before_bdt,
  rounded_reward_after_bdt, transaction_reward_rounded_bdt, completed_at_utc
)
SELECT
  telegram_update_id, customer_id, mutation_type, status, points_delta_units,
  balance_before_units, balance_after_units, rounded_reward_before_bdt,
  rounded_reward_after_bdt, transaction_reward_rounded_bdt, completed_at_utc
FROM mutation_receipts_v205;
DROP TABLE mutation_receipts_v205;
CREATE INDEX idx_mutation_receipts_customer
  ON mutation_receipts(customer_id, completed_at_utc DESC, telegram_update_id DESC);
CREATE INDEX idx_mutation_receipts_customer_completed
  ON mutation_receipts(
    customer_id,
    status,
    completed_at_utc DESC,
    telegram_update_id DESC
  );

ALTER TABLE leaderboard_aggregates RENAME TO leaderboard_aggregates_v205;

CREATE TABLE leaderboard_aggregates (
  period_type TEXT NOT NULL,
  period_key TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (typeof(generation) = 'integer' AND generation >= 0),
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  earned_point_units INTEGER NOT NULL CHECK (
    typeof(earned_point_units) = 'integer'
    AND earned_point_units > 0
    AND earned_point_units <= 9007199254740991
  ),
  first_qualifying_earning_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  PRIMARY KEY (period_type, period_key, generation, customer_id),
  FOREIGN KEY (period_type, period_key)
    REFERENCES leaderboard_periods(period_type, period_key) ON DELETE CASCADE
);

INSERT INTO leaderboard_aggregates (
  period_type, period_key, generation, customer_id, earned_point_units,
  first_qualifying_earning_at_utc, updated_at_utc
)
SELECT
  period_type, period_key, generation, customer_id, earned_point_units,
  first_qualifying_earning_at_utc, updated_at_utc
FROM leaderboard_aggregates_v205;
DROP TABLE leaderboard_aggregates_v205;
CREATE INDEX idx_leaderboard_top10 ON leaderboard_aggregates(
  period_type,
  period_key,
  generation,
  earned_point_units DESC,
  first_qualifying_earning_at_utc ASC,
  customer_id ASC
);

ALTER TABLE conversation_states RENAME TO conversation_states_v205;

CREATE TABLE conversation_states (
  administrator_telegram_id TEXT PRIMARY KEY,
  active_operation TEXT NOT NULL CHECK (
    active_operation IN (
      'PURCHASE', 'MANUAL_ADD', 'REDEEM', 'BALANCE', 'HISTORY',
      'ADD_CUSTOMER', 'MANAGE_CUSTOMER', 'EXPORT', 'LEADERBOARD'
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
  administrator_telegram_id,
  active_operation,
  current_step,
  CASE selection_mode
    WHEN 'SUFFIX' THEN 'PHONE_SUFFIX'
    WHEN 'FULL_NUMBER' THEN 'PHONE_FULL'
    ELSE NULL
  END,
  selected_customer_id,
  search_digits,
  search_page,
  payload_json,
  created_at_utc,
  updated_at_utc,
  expires_at_utc,
  operation_started_update_id
FROM conversation_states_v205;

DROP TABLE conversation_states_v205;
CREATE INDEX idx_conversation_states_expiry ON conversation_states(expires_at_utc);

DROP TABLE customers_v205;

CREATE INDEX idx_customers_phone_last4 ON customers(phone_last4, id);
CREATE INDEX idx_customers_phone_last5 ON customers(phone_last5, id);
CREATE INDEX idx_customers_whatsapp_username
  ON customers(whatsapp_username COLLATE NOCASE, id);
CREATE INDEX idx_customers_telegram_username
  ON customers(telegram_username COLLATE NOCASE, id);
CREATE INDEX idx_customers_created_at ON customers(created_at_utc DESC, id DESC);

PRAGMA legacy_alter_table = OFF;

CREATE TABLE _v206_foreign_key_guard (
  violation_count INTEGER NOT NULL CHECK (violation_count = 0)
);

INSERT INTO _v206_foreign_key_guard (violation_count)
SELECT COUNT(*) FROM pragma_foreign_key_check;

DROP TABLE _v206_foreign_key_guard;

PRAGMA foreign_keys = ON;

CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  whatsapp_number TEXT NOT NULL UNIQUE
    CHECK (
      length(whatsapp_number) BETWEEN 8 AND 16
      AND substr(whatsapp_number, 1, 1) = '+'
      AND length(substr(whatsapp_number, 2)) BETWEEN 7 AND 15
      AND substr(whatsapp_number, 2) NOT GLOB '*[^0-9]*'
    ),
  phone_last4 TEXT NOT NULL
    CHECK (length(phone_last4) = 4 AND phone_last4 NOT GLOB '*[^0-9]*'),
  phone_last5 TEXT NOT NULL
    CHECK (length(phone_last5) = 5 AND phone_last5 NOT GLOB '*[^0-9]*'),
  point_balance_units INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(point_balance_units) = 'integer' AND point_balance_units >= 0),
  rounded_reward_bdt INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(rounded_reward_bdt) = 'integer' AND rounded_reward_bdt >= 0),
  creation_telegram_update_id INTEGER UNIQUE,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE INDEX idx_customers_phone_last4 ON customers(phone_last4, id);
CREATE INDEX idx_customers_phone_last5 ON customers(phone_last5, id);
CREATE INDEX idx_customers_created_at ON customers(created_at_utc DESC, id DESC);

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
  balance_after_units INTEGER NOT NULL
    CHECK (
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

CREATE INDEX idx_transactions_customer ON transactions(customer_id);
CREATE INDEX idx_transactions_created_at ON transactions(created_at_utc DESC, id DESC);
CREATE INDEX idx_transactions_customer_newest
  ON transactions(customer_id, created_at_utc DESC, id DESC);

CREATE TABLE conversation_states (
  administrator_telegram_id TEXT PRIMARY KEY,
  active_operation TEXT NOT NULL CHECK (
    active_operation IN ('PURCHASE', 'MANUAL_ADD', 'REDEEM', 'BALANCE', 'HISTORY', 'ADD_CUSTOMER', 'EXPORT')
  ),
  current_step TEXT NOT NULL,
  selection_mode TEXT CHECK (selection_mode IS NULL OR selection_mode IN ('SUFFIX', 'FULL_NUMBER')),
  selected_customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  selected_whatsapp_number TEXT,
  search_digits TEXT CHECK (
    search_digits IS NULL
    OR (length(search_digits) IN (4, 5) AND search_digits NOT GLOB '*[^0-9]*')
  ),
  search_page INTEGER NOT NULL DEFAULT 0 CHECK (search_page >= 0),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  expires_at_utc TEXT NOT NULL
);

CREATE INDEX idx_conversation_states_expiry ON conversation_states(expires_at_utc);

CREATE TABLE processed_updates (
  telegram_update_id INTEGER PRIMARY KEY,
  update_type TEXT NOT NULL CHECK (
    update_type IN ('ADD_CUSTOMER', 'PURCHASE', 'MANUAL_ADD', 'REDEEM', 'EXPORT')
  ),
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  processed_at_utc TEXT NOT NULL
);

CREATE INDEX idx_processed_updates_processed_at
  ON processed_updates(processed_at_utc DESC);

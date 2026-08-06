PRAGMA defer_foreign_keys = ON;

ALTER TABLE conversation_states RENAME TO conversation_states_v1;

CREATE TABLE conversation_states (
  administrator_telegram_id TEXT PRIMARY KEY,
  active_operation TEXT NOT NULL CHECK (
    active_operation IN (
      'PURCHASE', 'MANUAL_ADD', 'REDEEM', 'BALANCE', 'HISTORY',
      'ADD_CUSTOMER', 'EXPORT', 'LEADERBOARD'
    )
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
  expires_at_utc TEXT NOT NULL,
  operation_started_update_id INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(operation_started_update_id) = 'integer'
    AND operation_started_update_id >= 0
  )
);

INSERT INTO conversation_states (
  administrator_telegram_id, active_operation, current_step, selection_mode,
  selected_customer_id, selected_whatsapp_number, search_digits, search_page,
  payload_json, created_at_utc, updated_at_utc, expires_at_utc,
  operation_started_update_id
)
SELECT
  administrator_telegram_id, active_operation, current_step, selection_mode,
  selected_customer_id, selected_whatsapp_number, search_digits, search_page,
  payload_json, created_at_utc, updated_at_utc, expires_at_utc,
  operation_started_update_id
FROM conversation_states_v1;

DROP TABLE conversation_states_v1;
CREATE INDEX idx_conversation_states_expiry ON conversation_states(expires_at_utc);

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

CREATE INDEX idx_mutation_receipts_customer
  ON mutation_receipts(customer_id, completed_at_utc DESC, telegram_update_id DESC);

INSERT INTO mutation_receipts (
  telegram_update_id, customer_id, mutation_type, status, points_delta_units,
  balance_before_units, balance_after_units, rounded_reward_before_bdt,
  rounded_reward_after_bdt, transaction_reward_rounded_bdt, completed_at_utc
)
SELECT
  telegram_update_id, customer_id, transaction_type, 'COMPLETED', points_delta_units,
  balance_before_units, balance_after_units, rounded_reward_before_bdt,
  rounded_reward_after_bdt, transaction_reward_rounded_bdt, created_at_utc
FROM transactions;

CREATE TABLE leaderboard_periods (
  period_type TEXT NOT NULL CHECK (period_type IN ('WEEK', 'MONTH')),
  period_key TEXT NOT NULL CHECK (
    (period_type = 'WEEK' AND length(period_key) = 10)
    OR (period_type = 'MONTH' AND length(period_key) = 7)
  ),
  current_generation INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(current_generation) = 'integer' AND current_generation >= 0
  ),
  reset_at_utc TEXT,
  updated_at_utc TEXT NOT NULL,
  PRIMARY KEY (period_type, period_key)
);

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

CREATE INDEX idx_leaderboard_top10 ON leaderboard_aggregates(
  period_type,
  period_key,
  generation,
  earned_point_units DESC,
  first_qualifying_earning_at_utc ASC,
  customer_id ASC
);

CREATE TABLE leaderboard_reset_receipts (
  telegram_update_id INTEGER PRIMARY KEY CHECK (
    typeof(telegram_update_id) = 'integer' AND telegram_update_id >= 0
  ),
  period_type TEXT NOT NULL CHECK (period_type IN ('WEEK', 'MONTH')),
  period_key TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (typeof(generation) = 'integer' AND generation >= 0),
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED')),
  reset_at_utc TEXT NOT NULL,
  administrator_telegram_id TEXT NOT NULL CHECK (
    length(administrator_telegram_id) > 0
    AND administrator_telegram_id NOT GLOB '*[^0-9]*'
  )
);

CREATE INDEX idx_leaderboard_reset_period
  ON leaderboard_reset_receipts(period_type, period_key, generation DESC);

WITH qualifying_periods AS (
  SELECT 'WEEK' AS period_type, period_key
  FROM (
    SELECT date(
      created_at_utc,
      '+6 hours',
      '-' || ((CAST(strftime('%w', created_at_utc, '+6 hours') AS INTEGER) + 6) % 7) || ' days'
    ) AS period_key
    FROM transactions
    WHERE transaction_type IN ('PURCHASE', 'MANUAL_ADD')
  )
  WHERE period_key IN (
    date('now', '+6 hours', '-' || ((CAST(strftime('%w', 'now', '+6 hours') AS INTEGER) + 6) % 7) || ' days'),
    date('now', '+6 hours', '-' || ((CAST(strftime('%w', 'now', '+6 hours') AS INTEGER) + 6) % 7) || ' days', '-7 days'),
    date('now', '+6 hours', '-' || ((CAST(strftime('%w', 'now', '+6 hours') AS INTEGER) + 6) % 7) || ' days', '-14 days')
  )
  UNION
  SELECT 'MONTH' AS period_type, period_key
  FROM (
    SELECT strftime('%Y-%m', created_at_utc, '+6 hours') AS period_key
    FROM transactions
    WHERE transaction_type IN ('PURCHASE', 'MANUAL_ADD')
  )
  WHERE period_key IN (
    strftime('%Y-%m', 'now', '+6 hours'),
    strftime('%Y-%m', 'now', '+6 hours', 'start of month', '-1 month')
  )
)
INSERT INTO leaderboard_periods (
  period_type, period_key, current_generation, reset_at_utc, updated_at_utc
)
SELECT
  period_type,
  period_key,
  0,
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM qualifying_periods;

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
), retained AS (
  SELECT * FROM qualifying
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
)
INSERT INTO leaderboard_aggregates (
  period_type, period_key, generation, customer_id, earned_point_units,
  first_qualifying_earning_at_utc, updated_at_utc
)
SELECT
  period_type,
  period_key,
  0,
  customer_id,
  SUM(points_delta_units),
  MIN(created_at_utc),
  MAX(created_at_utc)
FROM retained
GROUP BY period_type, period_key, customer_id;


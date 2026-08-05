ALTER TABLE conversation_states
ADD COLUMN operation_started_update_id INTEGER NOT NULL DEFAULT 0
CHECK (
  typeof(operation_started_update_id) = 'integer'
  AND operation_started_update_id >= 0
);

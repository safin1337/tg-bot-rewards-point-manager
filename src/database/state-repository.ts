import type { ConversationState, Operation, StatePayload, WorkflowStep } from "../types/models";
import { addMinutesIso, nowIso } from "../utils/time";
import { mapConversationState } from "./validation";

export const newStateToken = (): string => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(36).padStart(2, "0")).join("").slice(0, 10);
};

export class StateRepository {
  constructor(
    private readonly db: D1Database,
    private readonly ttlMinutes: number
  ) {}

  async get(adminId: string): Promise<{ state: ConversationState | null; expired: boolean }> {
    const row = await this.db
      .prepare("SELECT * FROM conversation_states WHERE administrator_telegram_id = ?")
      .bind(adminId)
      .first();
    if (row === null) return { state: null, expired: false };
    const state = mapConversationState(row);
    if (new Date(state.expiresAtUtc).getTime() <= Date.now()) {
      await this.clear(adminId);
      return { state: null, expired: true };
    }
    return { state, expired: false };
  }

  async start(
    adminId: string,
    operation: Operation,
    firstStep: WorkflowStep,
    operationStartedUpdateId: number
  ): Promise<ConversationState> {
    if (!Number.isSafeInteger(operationStartedUpdateId) || operationStartedUpdateId < 0) {
      throw new Error("Invalid workflow update ID.");
    }
    const now = nowIso();
    const payload: StatePayload = { token: newStateToken() };
    await this.db
      .prepare(
        `INSERT INTO conversation_states (
           administrator_telegram_id, operation_started_update_id,
           active_operation, current_step, selection_mode,
           selected_customer_id, search_query, search_page,
           payload_json, created_at_utc, updated_at_utc, expires_at_utc
         ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, 0, ?, ?, ?, ?)
         ON CONFLICT(administrator_telegram_id) DO UPDATE SET
           operation_started_update_id = excluded.operation_started_update_id,
           active_operation = excluded.active_operation,
           current_step = excluded.current_step,
           selection_mode = NULL,
           selected_customer_id = NULL,
           search_query = NULL,
           search_page = 0,
           payload_json = excluded.payload_json,
           created_at_utc = excluded.created_at_utc,
           updated_at_utc = excluded.updated_at_utc,
           expires_at_utc = excluded.expires_at_utc`
      )
      .bind(
        adminId,
        operationStartedUpdateId,
        operation,
        firstStep,
        JSON.stringify(payload),
        now,
        now,
        addMinutesIso(now, this.ttlMinutes)
      )
      .run();
    const result = await this.get(adminId);
    if (result.state === null) throw new Error("State creation failed.");
    return result.state;
  }

  async save(state: ConversationState): Promise<ConversationState> {
    const now = nowIso();
    const result = await this.db
      .prepare(
        `UPDATE conversation_states SET
           active_operation = ?, current_step = ?, selection_mode = ?,
           selected_customer_id = ?, search_query = ?, search_page = ?,
           payload_json = ?, updated_at_utc = ?, expires_at_utc = ?
         WHERE administrator_telegram_id = ?`
      )
      .bind(
        state.activeOperation,
        state.currentStep,
        state.selectionMode,
        state.selectedCustomerId,
        state.searchQuery,
        state.searchPage,
        JSON.stringify(state.payload),
        now,
        addMinutesIso(now, this.ttlMinutes),
        state.administratorTelegramId
      )
      .run();
    if (result.meta.changes !== 1) throw new Error("State update failed.");
    const stored = await this.get(state.administratorTelegramId);
    if (stored.state === null) throw new Error("State update failed.");
    return stored.state;
  }

  async clear(adminId: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM conversation_states WHERE administrator_telegram_id = ?")
      .bind(adminId)
      .run();
  }
}

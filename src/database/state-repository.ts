import type { ConversationState, Operation, StatePayload, WorkflowStep } from "../types/models";
import { addMinutesIso, nowIso } from "../utils/time";
import { mapConversationState } from "./validation";

export const newStateToken = (): string => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(36).padStart(2, "0")).join("").slice(0, 10);
};

export interface StateLookup {
  state: ConversationState | null;
  expired: boolean;
}

export class StateRepository {
  constructor(
    private readonly db: D1Database,
    private readonly ttlMinutes: number
  ) {}

  async get(adminId: string): Promise<StateLookup> {
    const row = await this.db
      .prepare("SELECT * FROM conversation_states WHERE administrator_telegram_id = ?")
      .bind(adminId)
      .first();
    if (row === null) return { state: null, expired: false };
    const state = mapConversationState(row);
    if (new Date(state.expiresAtUtc).getTime() <= Date.now()) {
      const cleared = await this.clearIfCurrent(state);
      return cleared ? { state: null, expired: true } : this.get(adminId);
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
    const row = await this.db.prepare(
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
           expires_at_utc = excluded.expires_at_utc
         WHERE conversation_states.operation_started_update_id <= excluded.operation_started_update_id
         RETURNING *`
      ).bind(
        adminId,
        operationStartedUpdateId,
        operation,
        firstStep,
        JSON.stringify(payload),
        now,
        now,
        addMinutesIso(now, this.ttlMinutes)
      ).first();
    if (row === null) throw new Error("A newer workflow operation is already active.");
    const stored = mapConversationState(row);
    if (
      stored.operationStartedUpdateId !== operationStartedUpdateId
      || stored.activeOperation !== operation
      || stored.currentStep !== firstStep
    ) {
      throw new Error("A newer workflow operation is already active.");
    }
    return stored;
  }

  async save(state: ConversationState): Promise<ConversationState> {
    const nextUpdatedAtMs = Math.max(Date.now(), new Date(state.updatedAtUtc).getTime() + 1);
    const nextUpdatedAtUtc = new Date(nextUpdatedAtMs).toISOString();
    const expiresAtUtc = addMinutesIso(nextUpdatedAtUtc, this.ttlMinutes);
    const payloadJson = JSON.stringify(state.payload);
    const row = await this.db.prepare(
        `UPDATE conversation_states SET
           active_operation = ?, current_step = ?, selection_mode = ?,
           selected_customer_id = ?, search_query = ?, search_page = ?,
           payload_json = ?, updated_at_utc = ?, expires_at_utc = ?
         WHERE administrator_telegram_id = ?
           AND operation_started_update_id = ?
           AND updated_at_utc = ?
         RETURNING *`
      ).bind(
        state.activeOperation,
        state.currentStep,
        state.selectionMode,
        state.selectedCustomerId,
        state.searchQuery,
        state.searchPage,
        payloadJson,
        nextUpdatedAtUtc,
        expiresAtUtc,
        state.administratorTelegramId,
        state.operationStartedUpdateId,
        state.updatedAtUtc
      ).first();
    if (row === null) {
      throw new Error("Conversation state changed before this transition completed.");
    }
    const stored = mapConversationState(row);
    if (
      stored.administratorTelegramId !== state.administratorTelegramId
      || stored.operationStartedUpdateId !== state.operationStartedUpdateId
      || stored.activeOperation !== state.activeOperation
      || stored.currentStep !== state.currentStep
      || stored.selectionMode !== state.selectionMode
      || stored.selectedCustomerId !== state.selectedCustomerId
      || stored.searchQuery !== state.searchQuery
      || stored.searchPage !== state.searchPage
      || row.payload_json !== payloadJson
      || stored.createdAtUtc !== state.createdAtUtc
      || stored.updatedAtUtc !== nextUpdatedAtUtc
      || stored.expiresAtUtc !== expiresAtUtc
    ) {
      throw new Error("Conversation state changed before this transition completed.");
    }
    return stored;
  }

  async clear(adminId: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM conversation_states WHERE administrator_telegram_id = ?")
      .bind(adminId)
      .run();
  }

  async clearIfCurrent(state: ConversationState): Promise<boolean> {
    const result = await this.db.prepare(
      `DELETE FROM conversation_states
       WHERE administrator_telegram_id = ?
         AND operation_started_update_id = ?
         AND updated_at_utc = ?`
    ).bind(
      state.administratorTelegramId,
      state.operationStartedUpdateId,
      state.updatedAtUtc
    ).run();
    return result.meta.changes === 1;
  }
}

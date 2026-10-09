import type { ConversationState } from "../types/models";
import { customerMergeFingerprint } from "../domain/customer-merge";
import { customerSplitAccountCount } from "../domain/customer-split";
import { assertSafeNonnegativeInteger } from "../domain/rewards";
import { DomainError } from "../domain/errors";
import { CustomerRepository } from "./customer-repository";

export interface CustomerSplitResult {
  erasedPointUnits: number;
  accountCount: number;
  duplicate: boolean;
}

export class CustomerSplitRepository {
  constructor(private readonly db: D1Database) {}

  private async replay(state: ConversationState): Promise<CustomerSplitResult | null> {
    const row = await this.db.prepare(`SELECT erased_point_units, account_count
      FROM customer_split_receipts WHERE token = ? AND customer_id = ?`)
      .bind(state.payload.token, state.selectedCustomerId).first();
    if (row === null) return null;
    if (typeof row.erased_point_units !== "number"
      || (row.account_count !== 2 && row.account_count !== 3)) {
      throw new Error("Invalid customer split receipt.");
    }
    assertSafeNonnegativeInteger(row.erased_point_units);
    return { erasedPointUnits: row.erased_point_units, accountCount: row.account_count, duplicate: true };
  }

  async split(state: ConversationState, updateId: number): Promise<CustomerSplitResult> {
    assertSafeNonnegativeInteger(updateId);
    if (state.activeOperation !== "MANAGE_CUSTOMER" || state.currentStep !== "CONFIRM_CUSTOMER_SPLIT"
      || state.selectedCustomerId === null || state.payload.splitFingerprint === undefined) {
      throw new DomainError("IDENTIFIER_STALE", "The split confirmation is incomplete. Start again.");
    }
    const prior = await this.replay(state);
    if (prior !== null) return prior;
    const customers = new CustomerRepository(this.db);
    const customer = await customers.findById(state.selectedCustomerId);
    if (customer === null || await customerMergeFingerprint(customer) !== state.payload.splitFingerprint
      || updateId <= Math.max(customer.latestMutationTelegramUpdateId ?? -1, state.operationStartedUpdateId)) {
      throw new DomainError("IDENTIFIER_STALE", "The customer changed after the split was prepared. Review and try again.");
    }
    const count = customerSplitAccountCount(customer);
    const timestamp = new Date().toISOString();
    // Keep the primary identifier on the existing ID, preserving its history and redirects.
    const phone = customer.whatsappNumber;
    const wa = phone === null ? customer.whatsappUsername : null;
    const tg = phone === null && wa === null ? customer.telegramUsername : null;
    const statements: D1PreparedStatement[] = [this.db.prepare(
      `INSERT INTO customer_split_receipts (token, customer_id, telegram_update_id,
        erased_point_units, account_count, completed_at_utc, valid_guard)
       VALUES (?, ?, ?, ?, ?, ?, CASE WHEN
         EXISTS (SELECT 1 FROM customers WHERE id = ? AND point_balance_units = ?
           AND rounded_reward_bdt = ? AND whatsapp_number IS ?
           AND whatsapp_username IS ? COLLATE BINARY AND telegram_username IS ? COLLATE BINARY
           AND is_test = ? AND latest_mutation_telegram_update_id IS ?
           AND creation_telegram_update_id IS ? AND created_at_utc = ? AND updated_at_utc = ?)
         AND EXISTS (SELECT 1 FROM conversation_states WHERE administrator_telegram_id = ?
           AND operation_started_update_id = ? AND updated_at_utc = ?
           AND active_operation = 'MANAGE_CUSTOMER' AND current_step = 'CONFIRM_CUSTOMER_SPLIT'
           AND selected_customer_id = ? AND payload_json = ? AND expires_at_utc > ?)
         THEN 1 ELSE 0 END)`
    ).bind(state.payload.token, customer.id, updateId, customer.pointBalanceUnits, count, timestamp,
      customer.id, customer.pointBalanceUnits, customer.roundedRewardBdt, customer.whatsappNumber,
      customer.whatsappUsername, customer.telegramUsername, customer.isTest ? 1 : 0,
      customer.latestMutationTelegramUpdateId, customer.creationTelegramUpdateId,
      customer.createdAtUtc, customer.updatedAtUtc, state.administratorTelegramId,
      state.operationStartedUpdateId, state.updatedAtUtc, customer.id, JSON.stringify(state.payload), timestamp),
    this.db.prepare(`UPDATE customers SET whatsapp_username = ?, telegram_username = ?,
      point_balance_units = 0, rounded_reward_bdt = 0, latest_mutation_telegram_update_id = ?,
      updated_at_utc = ? WHERE id = ?`).bind(wa, tg, updateId, timestamp, customer.id),
    this.db.prepare("DELETE FROM leaderboard_aggregates WHERE customer_id = ?").bind(customer.id),
    this.db.prepare(`DELETE FROM conversation_states WHERE selected_customer_id = ?
      AND NOT (administrator_telegram_id = ? AND operation_started_update_id = ? AND updated_at_utc = ?)`)
      .bind(customer.id, state.administratorTelegramId, state.operationStartedUpdateId, state.updatedAtUtc)];

    const detached: readonly ["whatsapp_username" | "telegram_username", string | null][] = [
      ["whatsapp_username", customer.whatsappUsername === wa ? null : customer.whatsappUsername],
      ["telegram_username", customer.telegramUsername === tg ? null : customer.telegramUsername]
    ];
    for (const [column, value] of detached) {
      if (value === null) continue;
      statements.push(this.db.prepare(`INSERT INTO customers (${column}, is_test,
        point_balance_units, rounded_reward_bdt, latest_mutation_telegram_update_id,
        created_at_utc, updated_at_utc) VALUES (?, ?, 0, 0, ?, ?, ?)`)
        .bind(value, customer.isTest ? 1 : 0, updateId, timestamp, timestamp));
    }
    statements.push(this.db.prepare(`UPDATE customer_split_receipts SET valid_guard = CASE WHEN
      (SELECT COUNT(*) FROM customers WHERE latest_mutation_telegram_update_id = ?
        AND point_balance_units = 0 AND rounded_reward_bdt = 0 AND is_test = ?
        AND (id = ? OR (whatsapp_username IS NOT NULL AND whatsapp_username IS ? COLLATE BINARY)
          OR (telegram_username IS NOT NULL AND telegram_username IS ? COLLATE BINARY))) = ?
      AND NOT EXISTS (SELECT 1 FROM leaderboard_aggregates WHERE customer_id = ?)
      THEN 1 ELSE 0 END WHERE token = ?`)
      .bind(updateId, customer.isTest ? 1 : 0, customer.id, customer.whatsappUsername,
        customer.telegramUsername, count, customer.id, state.payload.token));
    try {
      await this.db.batch(statements);
    } catch (error: unknown) {
      const duplicate = await this.replay(state);
      if (duplicate !== null) return duplicate;
      const current = await customers.findById(customer.id);
      const active = await this.db.prepare(`SELECT 1 FROM conversation_states
        WHERE administrator_telegram_id = ? AND updated_at_utc = ? AND operation_started_update_id = ?
          AND expires_at_utc > ?`).bind(state.administratorTelegramId, state.updatedAtUtc,
        state.operationStartedUpdateId, new Date().toISOString()).first();
      if (active === null || current === null
        || await customerMergeFingerprint(current) !== state.payload.splitFingerprint) {
        throw new DomainError("IDENTIFIER_STALE", "The customer or workflow changed before the split completed. Start again.");
      }
      throw error;
    }
    return { erasedPointUnits: customer.pointBalanceUnits, accountCount: count, duplicate: false };
  }
}

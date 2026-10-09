import type { ConversationState, Customer } from "../types/models";
import { customerMergeFingerprint, mergedCustomerBalance } from "../domain/customer-merge";
import { DomainError } from "../domain/errors";
import { assertSafeNonnegativeInteger, roundRewardBdt } from "../domain/rewards";
import { CustomerRepository } from "./customer-repository";
import { LeaderboardRepository } from "./leaderboard-repository";
import { MutationReceiptRepository } from "./mutation-receipt-repository";
import { TransactionRepository } from "./transaction-repository";

export interface CustomerMergeResult {
  customer: Customer;
  mergedBalanceUnits: number;
  duplicate: boolean;
}

const snapshotPredicate = `id = ? AND point_balance_units = ? AND rounded_reward_bdt = ?
  AND whatsapp_number IS ? AND whatsapp_username IS ? COLLATE BINARY
  AND telegram_username IS ? COLLATE BINARY AND is_test = ?
  AND latest_mutation_telegram_update_id IS ? AND creation_telegram_update_id IS ?
  AND created_at_utc = ? AND updated_at_utc = ?`;

const snapshotValues = (customer: Customer): (number | string | null)[] => [
  customer.id, customer.pointBalanceUnits, customer.roundedRewardBdt,
  customer.whatsappNumber, customer.whatsappUsername, customer.telegramUsername,
  customer.isTest ? 1 : 0, customer.latestMutationTelegramUpdateId,
  customer.creationTelegramUpdateId, customer.createdAtUtc, customer.updatedAtUtc
];

export class CustomerMergeRepository {
  constructor(private readonly db: D1Database) {}

  private async replay(state: ConversationState): Promise<CustomerMergeResult | null> {
    const row = await this.db.prepare(
      `SELECT target_customer_id, merged_balance_units FROM customer_merge_receipts
       WHERE token = ? AND original_target_customer_id = ? AND source_customer_id = ?`
    ).bind(state.payload.token, state.selectedCustomerId, state.payload.mergeSourceCustomerId).first();
    if (row === null) return null;
    const id = row.target_customer_id;
    const balance = row.merged_balance_units;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || typeof balance !== "number") {
      throw new Error("Invalid customer merge receipt.");
    }
    assertSafeNonnegativeInteger(balance);
    const customer = await new CustomerRepository(this.db).findById(id);
    if (customer === null) throw new Error("Merged customer is missing.");
    return { customer, mergedBalanceUnits: balance, duplicate: true };
  }

  async merge(state: ConversationState, telegramUpdateId: number): Promise<CustomerMergeResult> {
    assertSafeNonnegativeInteger(telegramUpdateId);
    if (state.activeOperation !== "MANAGE_CUSTOMER" || state.currentStep !== "CONFIRM_CUSTOMER_MERGE"
      || state.selectedCustomerId === null || state.payload.mergeSourceCustomerId === undefined
      || state.payload.mergeTargetFingerprint === undefined || state.payload.mergeSourceFingerprint === undefined) {
      throw new DomainError("IDENTIFIER_STALE", "The merge confirmation is incomplete. Start again.");
    }
    const prior = await this.replay(state);
    if (prior !== null) return prior;
    const customers = new CustomerRepository(this.db);
    const target = await customers.findById(state.selectedCustomerId);
    const source = await customers.findById(state.payload.mergeSourceCustomerId);
    if (target === null || source === null
      || await customerMergeFingerprint(target) !== state.payload.mergeTargetFingerprint
      || await customerMergeFingerprint(source) !== state.payload.mergeSourceFingerprint
      || telegramUpdateId <= Math.max(target.latestMutationTelegramUpdateId ?? -1,
        source.latestMutationTelegramUpdateId ?? -1, state.operationStartedUpdateId)) {
      throw new DomainError("IDENTIFIER_STALE", "A customer changed after the merge was prepared. Review and try again.");
    }
    const balance = mergedCustomerBalance(target, source);
    const timestamp = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      // A CHECK failure aborts the batch if either snapshot or the active workflow changed.
      this.db.prepare(
        `INSERT INTO customer_merge_receipts (
           token, source_customer_id, original_target_customer_id, target_customer_id,
           source_creation_update_id, telegram_update_id, target_balance_units,
           source_balance_units, merged_balance_units, completed_at_utc, valid_guard
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN
           EXISTS (SELECT 1 FROM customers WHERE ${snapshotPredicate})
           AND EXISTS (SELECT 1 FROM customers WHERE ${snapshotPredicate})
           AND EXISTS (SELECT 1 FROM conversation_states WHERE administrator_telegram_id = ?
             AND operation_started_update_id = ? AND updated_at_utc = ?
             AND current_step = 'CONFIRM_CUSTOMER_MERGE' AND payload_json = ?
             AND expires_at_utc > ?)
           THEN 1 ELSE 0 END)`
      ).bind(state.payload.token, source.id, target.id, target.id, source.creationTelegramUpdateId,
        telegramUpdateId, target.pointBalanceUnits, source.pointBalanceUnits, balance, timestamp,
        ...snapshotValues(target), ...snapshotValues(source), state.administratorTelegramId,
        state.operationStartedUpdateId, state.updatedAtUtc, JSON.stringify(state.payload), timestamp),
      new LeaderboardRepository(this.db).retentionStatement(new Date(timestamp)),
      this.db.prepare(
        `INSERT INTO leaderboard_aggregates (period_type, period_key, generation, customer_id,
           earned_point_units, first_qualifying_earning_at_utc, updated_at_utc)
         SELECT period_type, period_key, generation, ?, earned_point_units,
           first_qualifying_earning_at_utc, ? FROM leaderboard_aggregates WHERE customer_id = ?
         ON CONFLICT(period_type, period_key, generation, customer_id) DO UPDATE SET
           earned_point_units = leaderboard_aggregates.earned_point_units + excluded.earned_point_units,
           first_qualifying_earning_at_utc = MIN(leaderboard_aggregates.first_qualifying_earning_at_utc,
             excluded.first_qualifying_earning_at_utc), updated_at_utc = excluded.updated_at_utc`
      ).bind(target.id, timestamp, source.id),
      this.db.prepare("DELETE FROM leaderboard_aggregates WHERE customer_id = ?").bind(source.id),
      this.db.prepare("UPDATE transactions SET customer_id = ? WHERE customer_id = ?").bind(target.id, source.id),
      this.db.prepare("UPDATE mutation_receipts SET customer_id = ? WHERE customer_id = ?").bind(target.id, source.id),
      this.db.prepare("UPDATE customer_merge_receipts SET target_customer_id = ? WHERE target_customer_id = ?")
        .bind(target.id, source.id),
      this.db.prepare(
        `DELETE FROM conversation_states WHERE selected_customer_id IN (?, ?)
         AND NOT (administrator_telegram_id = ? AND operation_started_update_id = ? AND updated_at_utc = ?)`
      ).bind(target.id, source.id, state.administratorTelegramId, state.operationStartedUpdateId, state.updatedAtUtc),
      this.db.prepare("DELETE FROM customers WHERE id = ?").bind(source.id),
      this.db.prepare(
        `UPDATE customers SET whatsapp_number = ?, phone_last4 = ?, phone_last5 = ?,
           whatsapp_username = ?, telegram_username = ?, point_balance_units = ?, rounded_reward_bdt = ?,
           latest_mutation_telegram_update_id = ?, updated_at_utc = ? WHERE id = ?`
      ).bind(target.whatsappNumber ?? source.whatsappNumber, target.phoneLast4 ?? source.phoneLast4,
        target.phoneLast5 ?? source.phoneLast5, target.whatsappUsername ?? source.whatsappUsername,
        target.telegramUsername ?? source.telegramUsername, balance, roundRewardBdt(balance),
        telegramUpdateId, timestamp, target.id),
      new TransactionRepository(this.db).pruneStatement(target.id),
      new MutationReceiptRepository(this.db).pruneCompletedStatement(target.id),
      this.db.prepare(
        `UPDATE customer_merge_receipts SET valid_guard = CASE WHEN
           NOT EXISTS (SELECT 1 FROM customers WHERE id = ?)
           AND EXISTS (SELECT 1 FROM customers WHERE id = ? AND point_balance_units = ?
             AND latest_mutation_telegram_update_id = ?)
           AND (SELECT COUNT(*) FROM transactions WHERE customer_id = ?) <= 40
           AND (SELECT COUNT(*) FROM mutation_receipts WHERE customer_id = ?) <= 40
           AND NOT EXISTS (SELECT 1 FROM mutation_receipts AS r WHERE r.customer_id = ?
             AND (r.status != 'COMPLETED' OR NOT EXISTS (SELECT 1 FROM transactions AS t
               WHERE t.telegram_update_id = r.telegram_update_id AND t.customer_id = r.customer_id
                 AND t.transaction_type = r.mutation_type)))
           THEN 1 ELSE 0 END WHERE token = ?`
      ).bind(source.id, target.id, balance, telegramUpdateId, target.id, target.id, target.id, state.payload.token)
    ];
    try {
      await this.db.batch(statements);
    } catch (error: unknown) {
      const duplicate = await this.replay(state);
      if (duplicate !== null) return duplicate;
      const currentTarget = await customers.findById(target.id);
      const currentSource = await customers.findById(source.id);
      const active = await this.db.prepare(`SELECT 1 FROM conversation_states
        WHERE administrator_telegram_id = ? AND operation_started_update_id = ? AND updated_at_utc = ?
          AND expires_at_utc > ?`).bind(state.administratorTelegramId, state.operationStartedUpdateId,
        state.updatedAtUtc, new Date().toISOString()).first();
      if (currentTarget === null || currentSource === null
        || active === null
        || await customerMergeFingerprint(currentTarget) !== state.payload.mergeTargetFingerprint
        || await customerMergeFingerprint(currentSource) !== state.payload.mergeSourceFingerprint) {
        throw new DomainError("IDENTIFIER_STALE", "A customer changed before the merge completed. Review and try again.");
      }
      throw error;
    }
    const result = await this.replay(state);
    if (result === null) throw new Error("Customer merge receipt is missing.");
    return { ...result, duplicate: false };
  }
}

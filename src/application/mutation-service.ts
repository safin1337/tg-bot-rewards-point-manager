import { DomainError } from "../domain/errors";
import {
  assertSafeNonnegativeInteger,
  purchaseToPointUnits,
  roundRewardBdt,
  safeBalanceAfter
} from "../domain/rewards";
import type { Customer, TransactionType } from "../types/models";
import { nowIso } from "../utils/time";
import { CustomerRepository } from "../database/customer-repository";
import { TransactionRepository } from "../database/transaction-repository";

export interface MutationInput {
  customerId: number;
  type: TransactionType;
  pointUnits: number;
  purchaseAmountBdt: number | null;
  note: string | null;
  telegramUpdateId: number;
  expectedBalanceUnits: number;
}

export interface MutationResult {
  customer: Customer;
  balanceBeforeUnits: number;
  balanceAfterUnits: number;
  roundedRewardBeforeBdt: number;
  roundedRewardAfterBdt: number;
  transactionRewardRoundedBdt: number;
  duplicate: boolean;
}

export class RewardMutationService {
  private readonly customers: CustomerRepository;
  private readonly transactions: TransactionRepository;

  constructor(private readonly db: D1Database) {
    this.customers = new CustomerRepository(db);
    this.transactions = new TransactionRepository(db);
  }

  async mutate(input: MutationInput): Promise<MutationResult> {
    assertSafeNonnegativeInteger(input.pointUnits);
    assertSafeNonnegativeInteger(input.expectedBalanceUnits);
    if (input.pointUnits === 0) {
      throw new DomainError("INVALID_POINTS", "Points must be greater than zero.");
    }
    if (!Number.isSafeInteger(input.telegramUpdateId) || input.telegramUpdateId < 0) {
      throw new DomainError("UNSAFE_INTEGER", "The Telegram update ID is outside the supported range.");
    }
    if (input.type === "PURCHASE") {
      if (
        input.purchaseAmountBdt === null
        || purchaseToPointUnits(input.purchaseAmountBdt) !== input.pointUnits
      ) {
        throw new DomainError("INVALID_PURCHASE", "Purchase points must match the purchase amount.");
      }
    } else if (input.purchaseAmountBdt !== null) {
      throw new DomainError("INVALID_PURCHASE", "Only purchase transactions may include a purchase amount.");
    }

    const prior = await this.transactions.findByUpdateId(input.telegramUpdateId);
    if (prior !== null) {
      const existingCustomer = await this.customers.findById(prior.customerId);
      if (existingCustomer === null) throw new Error("Recorded customer is missing.");
      return {
        customer: existingCustomer,
        balanceBeforeUnits: prior.balanceBeforeUnits,
        balanceAfterUnits: prior.balanceAfterUnits,
        roundedRewardBeforeBdt: prior.roundedRewardBeforeBdt,
        roundedRewardAfterBdt: prior.roundedRewardAfterBdt,
        transactionRewardRoundedBdt: prior.transactionRewardRoundedBdt,
        duplicate: true
      };
    }

    const customer = await this.customers.findById(input.customerId);
    if (customer === null) throw new Error("Customer not found.");
    if (customer.pointBalanceUnits !== input.expectedBalanceUnits) {
      throw new DomainError("BALANCE_CONFLICT", "The balance changed. Please review and try again.");
    }

    const signedDelta = input.type === "REDEEM" ? -input.pointUnits : input.pointUnits;
    const after = safeBalanceAfter(customer.pointBalanceUnits, signedDelta);
    const roundedAfter = roundRewardBdt(after);
    const transactionReward = roundRewardBdt(input.pointUnits);
    const timestamp = nowIso();

    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            `UPDATE customers SET
               point_balance_units = ?, rounded_reward_bdt = ?, updated_at_utc = ?
             WHERE id = ? AND point_balance_units = ? AND point_balance_units + ? >= 0`
          )
          .bind(
            after,
            roundedAfter,
            timestamp,
            customer.id,
            customer.pointBalanceUnits,
            signedDelta
          ),
        this.db
          .prepare(
            `INSERT INTO transactions (
               customer_id, transaction_type, purchase_amount_bdt, points_delta_units,
               balance_before_units, balance_after_units, rounded_reward_before_bdt,
               rounded_reward_after_bdt, transaction_reward_rounded_bdt, note,
               telegram_update_id, created_at_utc
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE changes() = 1`
          )
          .bind(
            customer.id,
            input.type,
            input.purchaseAmountBdt,
            signedDelta,
            customer.pointBalanceUnits,
            after,
            customer.roundedRewardBdt,
            roundedAfter,
            transactionReward,
            input.note,
            input.telegramUpdateId,
            timestamp
          )
      ]);
      if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
        throw new DomainError("BALANCE_CONFLICT", "The balance changed. Please review and try again.");
      }
    } catch (error: unknown) {
      const duplicate = await this.transactions.findByUpdateId(input.telegramUpdateId);
      if (duplicate !== null) return this.mutate(input);
      throw error;
    }

    const updated = await this.customers.findById(customer.id);
    if (updated === null) throw new Error("Updated customer is missing.");
    return {
      customer: updated,
      balanceBeforeUnits: customer.pointBalanceUnits,
      balanceAfterUnits: after,
      roundedRewardBeforeBdt: customer.roundedRewardBdt,
      roundedRewardAfterBdt: roundedAfter,
      transactionRewardRoundedBdt: transactionReward,
      duplicate: false
    };
  }
}

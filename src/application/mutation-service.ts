import { DomainError } from "../domain/errors";
import {
  assertSafeNonnegativeInteger,
  purchaseToPointUnits,
  roundRewardBdt,
  safeBalanceAfter
} from "../domain/rewards";
import type { Customer, TransactionType } from "../types/models";
import { leaderboardPeriodKey } from "../domain/leaderboard";
import { CustomerRepository } from "../database/customer-repository";
import { LeaderboardRepository } from "../database/leaderboard-repository";
import { MutationReceiptRepository } from "../database/mutation-receipt-repository";
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
  private readonly receipts: MutationReceiptRepository;
  private readonly leaderboards: LeaderboardRepository;

  constructor(
    private readonly db: D1Database,
    private readonly clock: () => Date = () => new Date()
  ) {
    this.customers = new CustomerRepository(db);
    this.transactions = new TransactionRepository(db);
    this.receipts = new MutationReceiptRepository(db);
    this.leaderboards = new LeaderboardRepository(db, clock);
  }

  private async resultFromReceipt(updateId: number): Promise<MutationResult | null> {
    const receipt = await this.receipts.findCompleted(updateId);
    if (receipt === null) return null;
    const customer = await this.customers.findById(receipt.customerId);
    if (customer === null) throw new Error("Recorded customer is missing.");
    return {
      customer,
      balanceBeforeUnits: receipt.balanceBeforeUnits,
      balanceAfterUnits: receipt.balanceAfterUnits,
      roundedRewardBeforeBdt: receipt.roundedRewardBeforeBdt,
      roundedRewardAfterBdt: receipt.roundedRewardAfterBdt,
      transactionRewardRoundedBdt: receipt.transactionRewardRoundedBdt,
      duplicate: true
    };
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

    const prior = await this.resultFromReceipt(input.telegramUpdateId);
    if (prior !== null) return prior;

    const customer = await this.customers.findById(input.customerId);
    if (customer === null) throw new Error("Customer not found.");
    if (customer.pointBalanceUnits !== input.expectedBalanceUnits) {
      throw new DomainError("BALANCE_CONFLICT", "The balance changed. Please review and try again.");
    }

    const signedDelta = input.type === "REDEEM" ? -input.pointUnits : input.pointUnits;
    const after = safeBalanceAfter(customer.pointBalanceUnits, signedDelta);
    const roundedAfter = roundRewardBdt(after);
    const transactionReward = roundRewardBdt(input.pointUnits);
    const recordedAt = this.clock();
    const timestamp = recordedAt.toISOString();
    const earning = input.type === "PURCHASE" || input.type === "MANUAL_ADD";
    const weeklyPeriodKey = earning ? leaderboardPeriodKey("WEEK", recordedAt) : null;
    const monthlyPeriodKey = earning ? leaderboardPeriodKey("MONTH", recordedAt) : null;
    const receiptValues = {
      telegramUpdateId: input.telegramUpdateId,
      customerId: customer.id,
      mutationType: input.type,
      pointsDeltaUnits: signedDelta,
      balanceBeforeUnits: customer.pointBalanceUnits,
      balanceAfterUnits: after,
      roundedRewardBeforeBdt: customer.roundedRewardBdt,
      roundedRewardAfterBdt: roundedAfter,
      transactionRewardRoundedBdt: transactionReward,
      completedAtUtc: timestamp
    };

    const statements: D1PreparedStatement[] = [
      this.receipts.claimStatement(receiptValues),
      this.customers.balanceUpdateStatement(
        customer.id,
        customer.pointBalanceUnits,
        signedDelta,
        after,
        roundedAfter,
        timestamp
      ),
      this.transactions.insertStatement({
        customerId: customer.id,
        transactionType: input.type,
        purchaseAmountBdt: input.purchaseAmountBdt,
        pointsDeltaUnits: signedDelta,
        balanceBeforeUnits: customer.pointBalanceUnits,
        balanceAfterUnits: after,
        roundedRewardBeforeBdt: customer.roundedRewardBdt,
        roundedRewardAfterBdt: roundedAfter,
        transactionRewardRoundedBdt: transactionReward,
        note: input.note,
        telegramUpdateId: input.telegramUpdateId,
        createdAtUtc: timestamp
      })
    ];
    if (earning) {
      statements.push(
        ...this.leaderboards.earningStatements(customer.id, input.pointUnits, timestamp)
      );
    }
    statements.push(
      this.receipts.completeStatement({
        telegramUpdateId: input.telegramUpdateId,
        customerId: customer.id,
        mutationType: input.type,
        balanceAfterUnits: after,
        completedAtUtc: timestamp,
        weeklyPeriodKey,
        monthlyPeriodKey
      }),
      this.transactions.pruneStatement(customer.id),
      this.leaderboards.retentionStatement(recordedAt),
      this.receipts.retentionGuardStatement(receiptValues)
    );

    try {
      const results = await this.db.batch(statements);
      if (
        results[0]?.meta.changes !== 1
        || results[1]?.meta.changes !== 1
        || results[2]?.meta.changes !== 1
      ) {
        throw new DomainError("BALANCE_CONFLICT", "The balance changed. Please review and try again.");
      }
    } catch (error: unknown) {
      const duplicate = await this.resultFromReceipt(input.telegramUpdateId);
      if (duplicate !== null) return duplicate;
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

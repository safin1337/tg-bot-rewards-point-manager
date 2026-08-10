import { DomainError } from "../domain/errors";
import { APP_RUNTIME_CONFIG } from "../config/app-config";
import { formatPointUnits } from "../domain/points";
import { CustomerRepository } from "../database/customer-repository";
import { TransactionRepository } from "../database/transaction-repository";
import { createCsv, utf8Size } from "../utils/csv";
import { dhakaDate, formatDhakaDateTime } from "../utils/time";

export interface ExportFile {
  filename: string;
  contents: string;
}

export class ExportService {
  private readonly customers: CustomerRepository;
  private readonly transactions: TransactionRepository;

  constructor(
    db: D1Database,
    private readonly maxRows: number,
    private readonly maxBytes: number
  ) {
    this.customers = new CustomerRepository(db);
    this.transactions = new TransactionRepository(db);
  }

  private assertSize(contents: string): void {
    if (utf8Size(contents) > this.maxBytes) {
      throw new DomainError("EXPORT_TOO_LARGE", "The export is too large for Telegram.");
    }
  }

  async customersCsv(): Promise<ExportFile> {
    if (await this.customers.countAllUpTo(this.maxRows) > this.maxRows) {
      throw new DomainError("EXPORT_TOO_LARGE", "The customer export exceeds the configured row limit.");
    }
    const customers = await this.customers.listAll(this.maxRows + 1);
    const contents = createCsv(
      [
        "customer_id", "whatsapp_number", "current_points", "point_balance_units",
        "rounded_reward_bdt", "created_at_utc", "created_at_dhaka", "updated_at_utc",
        "updated_at_dhaka"
      ],
      customers.map((customer) => [
        customer.id,
        customer.whatsappNumber,
        formatPointUnits(customer.pointBalanceUnits),
        customer.pointBalanceUnits,
        customer.roundedRewardBdt,
        customer.createdAtUtc,
        formatDhakaDateTime(customer.createdAtUtc),
        customer.updatedAtUtc,
        formatDhakaDateTime(customer.updatedAtUtc)
      ])
    );
    this.assertSize(contents);
    return { filename: `${APP_RUNTIME_CONFIG.brand.filenameSlug}-customers-${dhakaDate()}.csv`, contents };
  }

  async transactionsCsv(): Promise<ExportFile> {
    if (await this.transactions.countAllUpTo(this.maxRows) > this.maxRows) {
      throw new DomainError("EXPORT_TOO_LARGE", "The transaction export exceeds the configured row limit.");
    }
    const transactions = await this.transactions.listAll(this.maxRows + 1);
    const contents = createCsv(
      [
        "transaction_id", "customer_id", "whatsapp_number", "transaction_type",
        "purchase_amount_bdt", "points_delta", "points_delta_units", "balance_before",
        "balance_before_units", "balance_after", "balance_after_units",
        "rounded_reward_before_bdt", "rounded_reward_after_bdt",
        "transaction_reward_rounded_bdt", "note", "telegram_update_id",
        "created_at_utc", "created_at_dhaka"
      ],
      transactions.map((transaction) => [
        transaction.id,
        transaction.customerId,
        transaction.whatsappNumber,
        transaction.transactionType,
        transaction.purchaseAmountBdt,
        `${transaction.pointsDeltaUnits > 0 ? "+" : ""}${formatPointUnits(transaction.pointsDeltaUnits)}`,
        transaction.pointsDeltaUnits,
        formatPointUnits(transaction.balanceBeforeUnits),
        transaction.balanceBeforeUnits,
        formatPointUnits(transaction.balanceAfterUnits),
        transaction.balanceAfterUnits,
        transaction.roundedRewardBeforeBdt,
        transaction.roundedRewardAfterBdt,
        transaction.transactionRewardRoundedBdt,
        transaction.note,
        transaction.telegramUpdateId,
        transaction.createdAtUtc,
        formatDhakaDateTime(transaction.createdAtUtc)
      ])
    );
    this.assertSize(contents);
    return { filename: `${APP_RUNTIME_CONFIG.brand.filenameSlug}-transactions-${dhakaDate()}.csv`, contents };
  }
}

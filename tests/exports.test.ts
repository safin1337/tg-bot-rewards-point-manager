import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { RewardMutationService } from "../src/application/mutation-service";
import { CustomerRepository } from "../src/database/customer-repository";
import { normalizePhone } from "../src/domain/phone";
import { ExportService } from "../src/exports/export-service";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM processed_updates"),
    env.DB.prepare("DELETE FROM conversation_states"),
    env.DB.prepare("DELETE FROM leaderboard_reset_receipts"),
    env.DB.prepare("DELETE FROM leaderboard_aggregates"),
    env.DB.prepare("DELETE FROM leaderboard_periods"),
    env.DB.prepare("DELETE FROM transactions"),
    env.DB.prepare("DELETE FROM mutation_receipts"),
    env.DB.prepare("DELETE FROM customers")
  ]);
});

describe("Telegram CSV export service", () => {
  it("generates every required customer and transaction column without secrets", async () => {
    const repository = new CustomerRepository(env.DB);
    const created = await repository.createZeroBalance(
      normalizePhone("01712345678"),
      1,
      "2026-07-29T09:30:00.000Z"
    );
    await new RewardMutationService(env.DB).mutate({
      customerId: created.customer.id,
      type: "MANUAL_ADD",
      pointUnits: 12_500,
      purchaseAmountBdt: null,
      note: "=PRIVATE",
      telegramUpdateId: 2,
      expectedBalanceUnits: 0
    });
    const service = new ExportService(env.DB, 100, 1_000_000);
    const customerFile = await service.customersCsv();
    const transactionFile = await service.transactionsCsv();

    expect(customerFile.filename).toMatch(/^soulshop-customers-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(customerFile.contents).toContain(
      "customer_id,whatsapp_number,current_points,point_balance_units,rounded_reward_bdt,created_at_utc,created_at_dhaka,updated_at_utc,updated_at_dhaka"
    );
    expect(customerFile.contents).toContain("'+8801712345678");

    expect(transactionFile.filename).toMatch(/^soulshop-transactions-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(transactionFile.contents).toContain("transaction_id,customer_id,whatsapp_number,transaction_type");
    expect(transactionFile.contents).toContain("points_delta_units");
    expect(transactionFile.contents).toContain("telegram_update_id,created_at_utc,created_at_dhaka");
    expect(transactionFile.contents).toContain("'=PRIVATE");
    for (const secretName of ["BOT_TOKEN", "WEBHOOK_SECRET", "ADMIN_TELEGRAM_ID", "payload_json"]) {
      expect(customerFile.contents).not.toContain(secretName);
      expect(transactionFile.contents).not.toContain(secretName);
    }
  });

  it("fails safely instead of silently truncating row or byte limits", async () => {
    await new CustomerRepository(env.DB).createZeroBalance(
      normalizePhone("01712345678"),
      1,
      new Date().toISOString()
    );
    await expect(new ExportService(env.DB, 0, 1_000_000).customersCsv()).rejects.toThrow(/row limit/i);
    await expect(new ExportService(env.DB, 100, 10).customersCsv()).rejects.toThrow(/too large/i);
  });
});

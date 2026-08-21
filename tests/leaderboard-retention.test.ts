import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { RewardMutationService } from "../src/application/mutation-service";
import { CustomerRepository } from "../src/database/customer-repository";
import { LeaderboardRepository } from "../src/database/leaderboard-repository";
import { MutationReceiptRepository } from "../src/database/mutation-receipt-repository";
import { TransactionRepository } from "../src/database/transaction-repository";
import { ExportService } from "../src/exports/export-service";
import {
  formatLeaderboardPointUnits,
  leaderboardPeriodKey,
  leaderboardPeriods
} from "../src/domain/leaderboard";
import { normalizePhone } from "../src/domain/phone";
import { normalizeUsername } from "../src/domain/customer-identity";
import { roundRewardBdt } from "../src/domain/rewards";
import { leaderboardMessage } from "../src/telegram/messages";
import type { Customer, LeaderboardEntry, TransactionType } from "../src/types/models";

const ADMIN_ID = "123456789";
const CURRENT_AT = new Date("2026-08-05T09:00:00.000Z");
const CURRENT_ISO = CURRENT_AT.toISOString();

const customers = () => new CustomerRepository(env.DB);
const transactions = () => new TransactionRepository(env.DB);
const leaderboards = (at = CURRENT_AT) => new LeaderboardRepository(env.DB, () => at);

const clearDatabase = async (): Promise<void> => {
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
};

const createCustomer = async (suffix: number, updateId: number): Promise<Customer> => {
  const local = `017${String(suffix).padStart(8, "0")}`;
  return (await customers().createZeroBalance(normalizePhone(local), updateId, CURRENT_ISO)).customer;
};

const mutate = async (
  service: RewardMutationService,
  customer: Customer,
  updateId: number,
  expectedBalanceUnits: number,
  pointUnits: number,
  type: TransactionType = "MANUAL_ADD"
) => service.mutate({
  customerId: customer.id,
  type,
  pointUnits,
  purchaseAmountBdt: type === "PURCHASE" ? 50 : null,
  note: null,
  telegramUpdateId: updateId,
  expectedBalanceUnits
});

beforeEach(clearDatabase);

describe("newest-40 detailed transaction retention", () => {
  it("keeps transactions 2 through 41, resolves equal timestamps by ID, and preserves balance", async () => {
    const customer = await createCustomer(1, 1);
    const service = new RewardMutationService(env.DB, () => CURRENT_AT);
    let balance = 0;
    for (let index = 1; index <= 41; index += 1) {
      await mutate(service, customer, 1_000 + index, balance, 100);
      balance += 100;
      if (index === 39 || index === 40) {
        const boundary = await env.DB.prepare(
          `SELECT
             (SELECT COUNT(*) FROM transactions WHERE customer_id = ?) AS transaction_count,
             (SELECT COUNT(*) FROM mutation_receipts
              WHERE customer_id = ? AND status = 'COMPLETED') AS receipt_count`
        ).bind(customer.id, customer.id).first<{
          transaction_count: number;
          receipt_count: number;
        }>();
        expect(boundary).toEqual({ transaction_count: index, receipt_count: index });
      }
    }

    const rows = await env.DB.prepare(
      `SELECT id, telegram_update_id FROM transactions
       WHERE customer_id = ? ORDER BY created_at_utc DESC, id DESC`
    ).bind(customer.id).all<{ id: number; telegram_update_id: number }>();
    expect(rows.results).toHaveLength(40);
    expect(rows.results.map((row) => row.telegram_update_id)).toEqual(
      Array.from({ length: 40 }, (_, index) => 1_041 - index)
    );
    expect(await transactions().findByUpdateId(1_001)).toBeNull();

    const stored = await customers().findById(customer.id);
    expect(stored).toMatchObject({
      pointBalanceUnits: 4_100,
      roundedRewardBdt: roundRewardBdt(4_100)
    });
    expect(await new MutationReceiptRepository(env.DB).findCompleted(1_001)).toBeNull();
    expect((await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM mutation_receipts WHERE customer_id = ? AND status = 'COMPLETED'"
    ).bind(customer.id).first<{ count: number }>())?.count).toBe(40);
  });

  it("caps PURCHASE, MANUAL_ADD, and REDEEM together and leaves another customer untouched", async () => {
    const first = await createCustomer(2, 2);
    const second = await createCustomer(3, 3);
    const service = new RewardMutationService(env.DB, () => CURRENT_AT);
    let balance = 0;
    for (let index = 0; index < 41; index += 1) {
      const type: TransactionType = index % 3 === 0
        ? "PURCHASE"
        : index % 3 === 1
          ? "MANUAL_ADD"
          : "REDEEM";
      const units = type === "REDEEM" ? 5_000 : 10_000;
      await mutate(service, first, 2_000 + index, balance, units, type);
      balance += type === "REDEEM" ? -units : units;
    }
    await mutate(service, second, 3_000, 0, 10_000);

    const firstRows = await env.DB.prepare(
      "SELECT transaction_type FROM transactions WHERE customer_id = ?"
    ).bind(first.id).all<{ transaction_type: string }>();
    const secondRows = await env.DB.prepare(
      "SELECT telegram_update_id FROM transactions WHERE customer_id = ?"
    ).bind(second.id).all<{ telegram_update_id: number }>();
    expect(firstRows.results).toHaveLength(40);
    expect(new Set(firstRows.results.map((row) => row.transaction_type))).toEqual(
      new Set(["PURCHASE", "MANUAL_ADD", "REDEEM"])
    );
    expect(secondRows.results).toEqual([{ telegram_update_id: 3_000 }]);
  });

  it("keeps history pagination deterministic and makes exports naturally use retained rows", async () => {
    const customer = await createCustomer(4, 4);
    const service = new RewardMutationService(env.DB, () => CURRENT_AT);
    let balance = 0;
    for (let index = 0; index < 41; index += 1) {
      await mutate(service, customer, 4_000 + index, balance, 100);
      balance += 100;
    }
    const collected: number[] = [];
    for (let page = 0; page < 8; page += 1) {
      const result = await transactions().listForCustomer(customer.id, page);
      collected.push(...result.transactions.map((row) => row.telegramUpdateId));
      expect(result.hasNext).toBe(page < 7);
    }
    expect(collected).toEqual(Array.from({ length: 40 }, (_, index) => 4_040 - index));
    expect(await transactions().countAllUpTo(100)).toBe(40);
    expect((await transactions().listAll(100)).map((row) => row.telegramUpdateId)).not.toContain(4_000);
    const csv = (await new ExportService(env.DB, 100, 1_000_000).transactionsCsv()).contents;
    expect(csv).not.toContain(",4000,2026-");
    expect(csv).toContain(",4040,2026-");
  });

  it("rejects a pruned delayed update through the customer high-water mark", async () => {
    const customer = await createCustomer(5, 5);
    const service = new RewardMutationService(env.DB, () => CURRENT_AT);
    const firstInput = {
      customerId: customer.id,
      type: "MANUAL_ADD" as const,
      pointUnits: 100,
      purchaseAmountBdt: null,
      note: null,
      telegramUpdateId: 5_000,
      expectedBalanceUnits: 0
    };
    await service.mutate(firstInput);
    let balance = 100;
    for (let index = 1; index <= 40; index += 1) {
      await mutate(service, customer, 5_000 + index, balance, 100);
      balance += 100;
    }
    expect(await transactions().findByUpdateId(5_000)).toBeNull();
    const period = leaderboardPeriods("WEEK", CURRENT_AT)[0];
    if (period === undefined) throw new Error("Missing current week.");
    const before = await leaderboards().list(period);
    await expect(service.mutate(firstInput)).rejects.toThrow(/older than/i);
    const after = await leaderboards().list(period);
    expect((await customers().findById(customer.id))?.pointBalanceUnits).toBe(balance);
    expect(after).toEqual(before);
    expect((await transactions().listAll(100))).toHaveLength(40);
  });
});

describe("mutation atomicity with receipts, leaderboards, and pruning", () => {
  it("applies concurrent duplicate mutation attempts exactly once", async () => {
    const customer = await createCustomer(6, 6);
    const service = new RewardMutationService(env.DB, () => CURRENT_AT);
    const input = {
      customerId: customer.id,
      type: "MANUAL_ADD" as const,
      pointUnits: 10_000,
      purchaseAmountBdt: null,
      note: null,
      telegramUpdateId: 6_000,
      expectedBalanceUnits: 0
    };
    const results = await Promise.all([service.mutate(input), service.mutate(input)]);
    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
    expect((await customers().findById(customer.id))?.pointBalanceUnits).toBe(10_000);
    expect(await transactions().countAllUpTo(10)).toBe(1);
    const week = leaderboardPeriods("WEEK", CURRENT_AT)[0];
    const month = leaderboardPeriods("MONTH", CURRENT_AT)[0];
    if (week === undefined || month === undefined) throw new Error("Missing current periods.");
    expect((await leaderboards().list(week))[0]?.earnedPointUnits).toBe(10_000);
    expect((await leaderboards().list(month))[0]?.earnedPointUnits).toBe(10_000);
  });

  it.each([
    ["receipt", "mutation_receipts", "BEFORE INSERT"],
    ["leaderboard", "leaderboard_aggregates", "BEFORE INSERT"]
  ])("rolls back balance, transaction, receipt, and leaderboard on %s failure", async (_name, table, timing) => {
    const customer = await createCustomer(7, 7);
    const trigger = `force_${table}_failure`;
    await env.DB.prepare(
      `CREATE TRIGGER ${trigger} ${timing} ON ${table}
       BEGIN SELECT RAISE(ABORT, 'forced failure'); END`
    ).run();
    try {
      await expect(mutate(
        new RewardMutationService(env.DB, () => CURRENT_AT),
        customer,
        7_000,
        0,
        10_000
      )).rejects.toThrow();
    } finally {
      await env.DB.prepare(`DROP TRIGGER ${trigger}`).run();
    }
    expect((await customers().findById(customer.id))?.pointBalanceUnits).toBe(0);
    expect(await transactions().countAllUpTo(10)).toBe(0);
    expect(await new MutationReceiptRepository(env.DB).findCompleted(7_000)).toBeNull();
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM leaderboard_aggregates")
      .first<{ count: number }>())?.count).toBe(0);
  });

  it("rolls back the 41st complete mutation when required pruning fails", async () => {
    const customer = await createCustomer(8, 8);
    const service = new RewardMutationService(env.DB, () => CURRENT_AT);
    let balance = 0;
    for (let index = 0; index < 40; index += 1) {
      await mutate(service, customer, 8_000 + index, balance, 100);
      balance += 100;
    }
    await env.DB.prepare(
      `CREATE TRIGGER force_pruning_failure BEFORE DELETE ON transactions
       BEGIN SELECT RAISE(ABORT, 'forced pruning failure'); END`
    ).run();
    try {
      await expect(mutate(service, customer, 8_040, balance, 100)).rejects.toThrow();
    } finally {
      await env.DB.prepare("DROP TRIGGER force_pruning_failure").run();
    }
    expect((await customers().findById(customer.id))?.pointBalanceUnits).toBe(balance);
    expect(await transactions().countAllUpTo(100)).toBe(40);
    expect(await new MutationReceiptRepository(env.DB).findCompleted(8_040)).toBeNull();
    const week = leaderboardPeriods("WEEK", CURRENT_AT)[0];
    if (week === undefined) throw new Error("Missing current week.");
    expect((await leaderboards().list(week))[0]?.earnedPointUnits).toBe(balance);
  });

  it("rolls back the 41st complete mutation when corresponding receipt pruning fails", async () => {
    const customer = await createCustomer(81, 81);
    const service = new RewardMutationService(env.DB, () => CURRENT_AT);
    let balance = 0;
    for (let index = 0; index < 40; index += 1) {
      await mutate(service, customer, 81_000 + index, balance, 100);
      balance += 100;
    }
    await env.DB.prepare(
      `CREATE TRIGGER force_receipt_pruning_failure
       BEFORE DELETE ON mutation_receipts
       BEGIN SELECT RAISE(ABORT, 'forced receipt pruning failure'); END`
    ).run();
    try {
      await expect(mutate(service, customer, 81_040, balance, 100)).rejects.toThrow();
    } finally {
      await env.DB.prepare("DROP TRIGGER force_receipt_pruning_failure").run();
    }
    expect((await customers().findById(customer.id))?.pointBalanceUnits).toBe(balance);
    expect(await transactions().countAllUpTo(100)).toBe(40);
    expect(await new MutationReceiptRepository(env.DB).findCompleted(81_040)).toBeNull();
    expect((await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM mutation_receipts WHERE customer_id = ?"
    ).bind(customer.id).first<{ count: number }>())?.count).toBe(40);
    const week = leaderboardPeriods("WEEK", CURRENT_AT)[0];
    if (week === undefined) throw new Error("Missing current week.");
    expect((await leaderboards().list(week))[0]?.earnedPointUnits).toBe(balance);
  });
});

describe("Dhaka leaderboard periods, ranking, and display", () => {
  it.each([
    ["2026-08-02T17:59:59.999Z", "2026-07-27", "2026-08"],
    ["2026-08-02T18:00:00.000Z", "2026-08-03", "2026-08"],
    ["2026-07-31T17:59:59.999Z", "2026-07-27", "2026-07"],
    ["2026-07-31T18:00:00.000Z", "2026-07-27", "2026-08"],
    ["2025-12-31T18:00:00.000Z", "2025-12-29", "2026-01"]
  ])("derives Dhaka keys at %s", (iso, week, month) => {
    const at = new Date(iso);
    expect(leaderboardPeriodKey("WEEK", at)).toBe(week);
    expect(leaderboardPeriodKey("MONTH", at)).toBe(month);
  });

  it("counts purchase and manual additions but never changes gross earnings for redemption", async () => {
    const customer = await createCustomer(9, 9);
    const service = new RewardMutationService(env.DB, () => CURRENT_AT);
    await mutate(service, customer, 9_000, 0, 10_000, "PURCHASE");
    await mutate(service, customer, 9_001, 10_000, 12_345);
    await mutate(service, customer, 9_002, 22_345, 5_000, "REDEEM");
    const week = leaderboardPeriods("WEEK", CURRENT_AT)[0];
    const month = leaderboardPeriods("MONTH", CURRENT_AT)[0];
    if (week === undefined || month === undefined) throw new Error("Missing current periods.");
    expect((await leaderboards().list(week))[0]?.earnedPointUnits).toBe(22_345);
    expect((await leaderboards().list(month))[0]?.earnedPointUnits).toBe(22_345);
    expect((await customers().findById(customer.id))?.pointBalanceUnits).toBe(17_345);
  });

  it("orders exact ties by first qualifying time and then customer ID", async () => {
    const first = await createCustomer(10, 10);
    const second = await createCustomer(11, 11);
    const third = await createCustomer(12, 12);
    const early = new Date("2026-08-04T00:00:00.000Z");
    const late = new Date("2026-08-04T01:00:00.000Z");
    await mutate(new RewardMutationService(env.DB, () => early), first, 10_000, 0, 10_000);
    await mutate(new RewardMutationService(env.DB, () => late), second, 10_001, 0, 10_000);
    await mutate(new RewardMutationService(env.DB, () => early), third, 10_002, 0, 10_000);
    const week = leaderboardPeriods("WEEK", CURRENT_AT)[0];
    if (week === undefined) throw new Error("Missing current week.");
    expect((await leaderboards().list(week)).map((entry) => entry.customerId)).toEqual([
      first.id, third.id, second.id
    ]);
  });

  it("returns only the deterministic top 10", async () => {
    for (let index = 0; index < 12; index += 1) {
      const customer = await createCustomer(100 + index, 11_000 + index);
      await mutate(
        new RewardMutationService(env.DB, () => CURRENT_AT),
        customer,
        12_000 + index,
        0,
        (index + 1) * 10_000
      );
    }
    const week = leaderboardPeriods("WEEK", CURRENT_AT)[0];
    if (week === undefined) throw new Error("Missing current week.");
    const entries = await leaderboards().list(week);
    expect(entries).toHaveLength(10);
    expect(entries.map((entry) => entry.earnedPointUnits)).toEqual(
      Array.from({ length: 10 }, (_, index) => (12 - index) * 10_000)
    );
  });

  it.each([
    ["WEEK", "Weekly", "03 Aug 2026 — 09 Aug 2026"],
    ["MONTH", "Monthly", "August 2026"]
  ] as const)("formats every identity combination on the %s leaderboard", (type, title, label) => {
    const entries: LeaderboardEntry[] = [
      {
        customerId: 1,
        whatsappNumber: "+8801712345678",
        whatsappUsername: null,
        telegramUsername: null,
        earnedPointUnits: 70_000,
        firstQualifyingEarningAtUtc: CURRENT_ISO
      },
      {
        customerId: 2,
        whatsappNumber: null,
        whatsappUsername: "Soul.Shop",
        telegramUsername: null,
        earnedPointUnits: 60_000,
        firstQualifyingEarningAtUtc: CURRENT_ISO
      },
      {
        customerId: 3,
        whatsappNumber: null,
        whatsappUsername: null,
        telegramUsername: "SoulShop_User",
        earnedPointUnits: 50_000,
        firstQualifyingEarningAtUtc: CURRENT_ISO
      },
      {
        customerId: 4,
        whatsappNumber: "+8801712345679",
        whatsappUsername: "Phone.WA",
        telegramUsername: null,
        earnedPointUnits: 40_000,
        firstQualifyingEarningAtUtc: CURRENT_ISO
      },
      {
        customerId: 5,
        whatsappNumber: "+8801712345680",
        whatsappUsername: null,
        telegramUsername: "Phone_TG",
        earnedPointUnits: 30_000,
        firstQualifyingEarningAtUtc: CURRENT_ISO
      },
      {
        customerId: 6,
        whatsappNumber: null,
        whatsappUsername: "WA.Primary",
        telegramUsername: "TG_Secondary",
        earnedPointUnits: 20_000,
        firstQualifyingEarningAtUtc: CURRENT_ISO
      },
      {
        customerId: 7,
        whatsappNumber: "+8801712345681",
        whatsappUsername: "All.WA",
        telegramUsername: "All_TG",
        earnedPointUnits: 10_000,
        firstQualifyingEarningAtUtc: CURRENT_ISO
      }
    ];
    const text = leaderboardMessage({ type, key: type === "WEEK" ? "2026-08-03" : "2026-08", label, running: true }, entries);
    expect(formatLeaderboardPointUnits(12_345)).toBe("1.23");
    expect(formatLeaderboardPointUnits(12_350)).toBe("1.24");
    expect(text).toBe(
      `🏆 <b>SoulShop ${title} Leaderboard</b>\n${label} — Running\n\n`
      + "1st · +8801712345678 — 7.00 pts\n"
      + "2nd · WA @Soul.Shop — 6.00 pts\n"
      + "3rd · TG @SoulShop_User — 5.00 pts\n"
      + "4th · +8801712345679 — 4.00 pts (+1 alias)\n"
      + "5th · +8801712345680 — 3.00 pts (+1 alias)\n"
      + "6th · WA @WA.Primary — 2.00 pts (+1 alias)\n"
      + "7th · +8801712345681 — 1.00 pts (+2 aliases)"
    );
    expect(12_345).toBe(12_345);
  });

  it("returns phone, WhatsApp username, and Telegram username fields from D1 rankings", async () => {
    const repository = customers();
    const allIdentifiers = await createCustomer(13, 13);
    const withWhatsapp = await repository.changeIdentifier(
      allIdentifiers.id,
      "WHATSAPP_USERNAME",
      null,
      { type: "WHATSAPP_USERNAME", username: normalizeUsername("WHATSAPP_USERNAME", "All.WA") },
      CURRENT_ISO
    );
    const withAll = await repository.changeIdentifier(
      allIdentifiers.id,
      "TELEGRAM_USERNAME",
      null,
      { type: "TELEGRAM_USERNAME", username: normalizeUsername("TELEGRAM_USERNAME", "All_TG") },
      CURRENT_ISO
    );
    expect(withWhatsapp.changed).toBe(true);
    expect(withAll.changed).toBe(true);

    const whatsappOnly = (await repository.createZeroBalance(
      { type: "WHATSAPP_USERNAME", username: normalizeUsername("WHATSAPP_USERNAME", "Only.WA") },
      14,
      CURRENT_ISO
    )).customer;
    const telegramOnly = (await repository.createZeroBalance(
      { type: "TELEGRAM_USERNAME", username: normalizeUsername("TELEGRAM_USERNAME", "Only_TG") },
      15,
      CURRENT_ISO
    )).customer;

    const service = new RewardMutationService(env.DB, () => CURRENT_AT);
    await mutate(service, withAll.customer, 13_000, 0, 30_000);
    await mutate(service, whatsappOnly, 14_000, 0, 20_000);
    await mutate(service, telegramOnly, 15_000, 0, 10_000);

    const periods = [
      leaderboardPeriods("WEEK", CURRENT_AT)[0],
      leaderboardPeriods("MONTH", CURRENT_AT)[0]
    ];
    for (const period of periods) {
      if (period === undefined) throw new Error("Missing current leaderboard period.");
      const entries = await leaderboards().list(period);
      expect(entries).toEqual([
        expect.objectContaining({
          customerId: withAll.customer.id,
          whatsappNumber: withAll.customer.whatsappNumber,
          whatsappUsername: "All.WA",
          telegramUsername: "All_TG"
        }),
        expect.objectContaining({
          customerId: whatsappOnly.id,
          whatsappNumber: null,
          whatsappUsername: "Only.WA",
          telegramUsername: null
        }),
        expect.objectContaining({
          customerId: telegramOnly.id,
          whatsappNumber: null,
          whatsappUsername: null,
          telegramUsername: "Only_TG"
        })
      ]);
    }
  });

  it("rejects a leaderboard entry without any customer identity", () => {
    expect(() => leaderboardMessage({
      type: "MONTH",
      key: "2026-08",
      label: "August 2026",
      running: true
    }, [{
      customerId: 99,
      whatsappNumber: null,
      whatsappUsername: null,
      telegramUsername: null,
      earnedPointUnits: 10_000,
      firstQualifyingEarningAtUtc: CURRENT_ISO
    }])).toThrow(/no identifier/i);
  });

  it("serves current, previous, and two-weeks-ago windows while excluding obsolete periods", async () => {
    const currentCustomer = await createCustomer(20, 20);
    const previousCustomer = await createCustomer(21, 21);
    const oldCustomer = await createCustomer(22, 22);
    await mutate(
      new RewardMutationService(env.DB, () => new Date("2026-07-20T06:00:00.000Z")),
      oldCustomer,
      20_000,
      0,
      10_000
    );
    await mutate(
      new RewardMutationService(env.DB, () => new Date("2026-07-30T06:00:00.000Z")),
      previousCustomer,
      20_001,
      0,
      20_000
    );
    await mutate(
      new RewardMutationService(env.DB, () => CURRENT_AT),
      currentCustomer,
      20_002,
      0,
      30_000
    );
    const repository = leaderboards();
    const weeks = leaderboardPeriods("WEEK", CURRENT_AT);
    const months = leaderboardPeriods("MONTH", CURRENT_AT);
    expect(await Promise.all(weeks.map((period) => repository.list(period))))
      .toEqual(expect.arrayContaining([
        [expect.objectContaining({ customerId: currentCustomer.id })],
        [expect.objectContaining({ customerId: previousCustomer.id })],
        [expect.objectContaining({ customerId: oldCustomer.id })]
      ]));
    expect((await repository.list(months[0] ?? (() => { throw new Error("Missing month"); })()))[0]?.customerId)
      .toBe(currentCustomer.id);
    expect((await repository.list(months[1] ?? (() => { throw new Error("Missing month"); })()))[0]?.customerId)
      .toBe(previousCustomer.id);
    await expect(repository.list({
      type: "WEEK",
      key: "2026-07-13",
      label: "obsolete",
      running: false
    })).rejects.toThrow(/outside the retained window/i);
  });
});

describe("independent current-period leaderboard resets", () => {
  it("resets weekly independently, preserves monthly/history/balance, and counts later earnings", async () => {
    const customer = await createCustomer(30, 30);
    const service = new RewardMutationService(env.DB, () => CURRENT_AT);
    await mutate(service, customer, 30_000, 0, 20_000);
    const repository = leaderboards();
    const week = leaderboardPeriods("WEEK", CURRENT_AT)[0];
    const month = leaderboardPeriods("MONTH", CURRENT_AT)[0];
    if (week === undefined || month === undefined) throw new Error("Missing current periods.");
    const reset = await repository.resetCurrent("WEEK", week.key, 30_001, ADMIN_ID);
    expect(reset.duplicate).toBe(false);
    expect(await repository.list(week)).toEqual([]);
    expect((await repository.list(month))[0]?.earnedPointUnits).toBe(20_000);
    expect((await customers().findById(customer.id))?.pointBalanceUnits).toBe(20_000);
    expect(await transactions().countAllUpTo(10)).toBe(1);

    const later = new Date("2026-08-06T09:00:00.000Z");
    await mutate(new RewardMutationService(env.DB, () => later), customer, 30_002, 20_000, 5_000);
    expect((await repository.list(week))[0]?.earnedPointUnits).toBe(5_000);
    expect((await repository.list(week))[0]?.firstQualifyingEarningAtUtc).toBe(later.toISOString());
    expect((await repository.list(month))[0]?.earnedPointUnits).toBe(25_000);
    expect(await transactions().countAllUpTo(10)).toBe(2);
  });

  it("resets monthly independently and leaves weekly and previous completed periods available", async () => {
    const previous = await createCustomer(31, 31);
    const current = await createCustomer(32, 32);
    await mutate(
      new RewardMutationService(env.DB, () => new Date("2026-07-30T06:00:00.000Z")),
      previous,
      31_000,
      0,
      10_000
    );
    await mutate(new RewardMutationService(env.DB, () => CURRENT_AT), current, 31_001, 0, 20_000);
    const repository = leaderboards();
    const week = leaderboardPeriods("WEEK", CURRENT_AT)[0];
    const months = leaderboardPeriods("MONTH", CURRENT_AT);
    const currentMonth = months[0];
    const previousMonth = months[1];
    if (week === undefined || currentMonth === undefined || previousMonth === undefined) {
      throw new Error("Missing leaderboard periods.");
    }
    await repository.resetCurrent("MONTH", currentMonth.key, 31_002, ADMIN_ID);
    expect(await repository.list(currentMonth)).toEqual([]);
    expect((await repository.list(week))[0]?.earnedPointUnits).toBe(20_000);
    expect((await repository.list(previousMonth))[0]?.customerId).toBe(previous.id);
    expect((await customers().findById(current.id))?.pointBalanceUnits).toBe(20_000);
  });

  it("makes repeated reset IDs idempotent and rejects a confirmation after the period changes", async () => {
    const week = leaderboardPeriods("WEEK", CURRENT_AT)[0];
    if (week === undefined) throw new Error("Missing current week.");
    const repository = leaderboards();
    expect((await repository.resetCurrent("WEEK", week.key, 32_000, ADMIN_ID)).duplicate).toBe(false);
    expect((await repository.resetCurrent("WEEK", week.key, 32_000, ADMIN_ID)).duplicate).toBe(true);
    const generation = await env.DB.prepare(
      "SELECT current_generation FROM leaderboard_periods WHERE period_type = 'WEEK' AND period_key = ?"
    ).bind(week.key).first<{ current_generation: number }>();
    expect(generation?.current_generation).toBe(1);

    const later = new LeaderboardRepository(env.DB, () => new Date("2026-08-10T00:00:00.000Z"));
    await expect(later.resetCurrent("WEEK", week.key, 32_001, ADMIN_ID)).rejects.toThrow(/period changed/i);
  });

  it("rolls back a reset generation when the completed reset receipt cannot be stored", async () => {
    const customer = await createCustomer(33, 33);
    await mutate(new RewardMutationService(env.DB, () => CURRENT_AT), customer, 33_000, 0, 10_000);
    const week = leaderboardPeriods("WEEK", CURRENT_AT)[0];
    if (week === undefined) throw new Error("Missing current week.");
    await env.DB.prepare(
      `CREATE TRIGGER force_reset_receipt_failure
       BEFORE UPDATE ON leaderboard_reset_receipts
       BEGIN SELECT RAISE(IGNORE); END`
    ).run();
    try {
      await expect(leaderboards().resetCurrent("WEEK", week.key, 33_001, ADMIN_ID)).rejects.toThrow();
    } finally {
      await env.DB.prepare("DROP TRIGGER force_reset_receipt_failure").run();
    }
    const period = await env.DB.prepare(
      "SELECT current_generation FROM leaderboard_periods WHERE period_type = 'WEEK' AND period_key = ?"
    ).bind(week.key).first<{ current_generation: number }>();
    expect(period?.current_generation).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM leaderboard_reset_receipts")
      .first<{ count: number }>())?.count).toBe(0);
    expect((await leaderboards().list(week))[0]?.earnedPointUnits).toBe(10_000);
  });
});

describe("V2 migration invariants", () => {
  it("keeps completed receipts aligned with retained transactions without a schema trigger", async () => {
    const customer = await createCustomer(40, 40);
    const schemaTrigger = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?"
    ).bind("transactions_delete_completed_receipt").first<{ name: string }>();
    expect(schemaTrigger).toBeNull();

    const service = new RewardMutationService(env.DB, () => CURRENT_AT);
    let balance = 0;
    for (let index = 0; index < 41; index += 1) {
      await mutate(service, customer, 40_000 + index, balance, 100);
      balance += 100;
    }

    const orphaned = await env.DB.prepare(
      `SELECT receipt.telegram_update_id
       FROM mutation_receipts AS receipt
       LEFT JOIN transactions AS transaction_row
         ON transaction_row.telegram_update_id = receipt.telegram_update_id
        AND transaction_row.customer_id = receipt.customer_id
        AND transaction_row.transaction_type = receipt.mutation_type
       WHERE receipt.status = 'COMPLETED'
         AND transaction_row.id IS NULL`
    ).all<{ telegram_update_id: number }>();
    expect(orphaned.results).toEqual([]);
    expect(await new MutationReceiptRepository(env.DB).findCompleted(40_000)).toBeNull();
    expect(await transactions().findByUpdateId(40_000)).toBeNull();
    expect((await customers().findById(customer.id))?.pointBalanceUnits).toBe(balance);
  });

  it("passes foreign-key checks with all V2 tables", async () => {
    const rows = await env.DB.prepare("PRAGMA foreign_key_check").all();
    expect(rows.results).toEqual([]);
  });
});

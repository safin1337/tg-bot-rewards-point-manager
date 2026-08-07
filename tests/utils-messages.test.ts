import { describe, expect, it } from "vitest";
import { createCsv, csvCell, safeCsvText } from "../src/utils/csv";
import { escapeHtml } from "../src/utils/html";
import { dhakaDate, formatDhakaDateTime } from "../src/utils/time";
import {
  addCustomerSuccessMessage,
  balanceMessage,
  historyMessage,
  manualAddSuccessMessage,
  purchaseSuccessMessage,
  redemptionSuccessMessage
} from "../src/telegram/messages";
import {
  historyKeyboard,
  noResultsKeyboard,
  resultsKeyboard
} from "../src/telegram/keyboards";
import type { Customer, RewardTransaction } from "../src/types/models";

const customer: Customer = {
  id: 1,
  whatsappNumber: "+8801712345678",
  phoneLast4: "5678",
  phoneLast5: "45678",
  pointBalanceUnits: 65_625,
  roundedRewardBdt: 2,
  creationTelegramUpdateId: 1,
  latestMutationTelegramUpdateId: 100,
  createdAtUtc: "2026-07-29T09:30:00.000Z",
  updatedAtUtc: "2026-07-29T09:30:00.000Z"
};

const transaction: RewardTransaction = {
  id: 1,
  customerId: 1,
  transactionType: "PURCHASE",
  purchaseAmountBdt: 525,
  pointsDeltaUnits: 65_625,
  balanceBeforeUnits: 0,
  balanceAfterUnits: 65_625,
  roundedRewardBeforeBdt: 0,
  roundedRewardAfterBdt: 2,
  transactionRewardRoundedBdt: 2,
  note: "<private & note>",
  telegramUpdateId: 10,
  createdAtUtc: "2026-07-29T09:30:00.000Z"
};

describe("CSV security and correctness", () => {
  it("quotes commas, quotes, and line breaks using RFC-style escaping", () => {
    expect(csvCell('hello, "world"\nnext')).toBe('"hello, ""world""\nnext"');
  });

  it.each(["=SUM(A1:A2)", "+8801712345678", "-1", "@cmd"])(
    "neutralizes spreadsheet formula input %s",
    (value) => expect(safeCsvText(value)).toBe(`'${value}`)
  );

  it("produces UTF-8 BOM CSV with CRLF and escaped values", () => {
    const csv = createCsv(["phone", "note"], [["+8801712345678", "a,b"], ["x", "line\nbreak"]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("'+8801712345678");
    expect(csv).toContain('"a,b"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("escapes Telegram HTML", () => {
    expect(escapeHtml('<tag attr="x">&')).toBe("&lt;tag attr=&quot;x&quot;&gt;&amp;");
  });
});

describe("time formatting", () => {
  it("displays UTC in Asia/Dhaka without manual offset logic", () => {
    expect(formatDhakaDateTime("2026-07-29T09:30:00.000Z")).toBe("29 Jul 2026, 03:30 PM");
  });

  it("uses an ISO-shaped Asia/Dhaka export date", () => {
    expect(dhakaDate(new Date("2026-07-29T20:30:00.000Z"))).toBe("2026-07-30");
  });
});

describe("required branded messages", () => {
  it("purchase includes headline, Congratulations, exact line break, and all taglines", () => {
    const message = purchaseSuccessMessage(customer, 525, 65_625);
    expect(message).toContain("Purchase Successfully Recorded");
    expect(message).toContain("Congratulations");
    expect(message).toContain("balance is 6.5625 points,\nwith a reward value of ≈ BDT 2.");
    expect(message).toContain("Buy More to Earn More\nThank you for purchasing from us\nBest Wishes from SoulShop");
  });

  it("manual addition omits an absent Reason line and escapes a present note", () => {
    expect(manualAddSuccessMessage(customer, 10_000, null)).not.toContain("Reason:");
    expect(manualAddSuccessMessage(customer, 10_000, "<reason>")).toContain("Reason: &lt;reason&gt;");
  });

  it("redemption has both required line breaks and never congratulates", () => {
    const message = redemptionSuccessMessage(customer, 10_000, 0);
    expect(message).not.toContain("Congratulations");
    expect(message).toContain("redeemed 1 points,\nwith a reward value");
    expect(message).toContain("balance is 6.5625 points,\nwith a remaining reward value");
    expect(message).toContain("Best Wishes from SoulShop");
  });

  it("balance preserves the mandatory balance/reward line break", () => {
    expect(balanceMessage(customer)).toContain("balance is 6.5625 points,\nwith a reward value");
  });

  it("zero-point customer success contains no reward transaction claim", () => {
    const zero = { ...customer, pointBalanceUnits: 0, roundedRewardBdt: 0 };
    expect(addCustomerSuccessMessage(zero)).toContain("Current Points: 0 points");
  });

  it("history keeps its heading, omits closing taglines, and formats details safely", () => {
    const message = historyMessage(customer, [transaction], 0);
    expect(message).toContain("Customer Reward History");
    expect(message).toContain("29 Jul 2026, 03:30 PM");
    expect(message).toContain("PURCHASE: +6.5625 points");
    expect(message).toContain("Purchase Amount: BDT 525");
    expect(message).toContain("Note: &lt;private &amp; note&gt;");
    expect(message).not.toContain("Buy More to Earn More");
    expect(message).not.toContain("Thank you for purchasing from us");
    expect(message).not.toContain("Best Wishes from SoulShop");
  });

  it("history omits purchase amount and note when not applicable", () => {
    const redeem = { ...transaction, transactionType: "REDEEM" as const, purchaseAmountBdt: null, note: null };
    const message = historyMessage(customer, [redeem], 0);
    expect(message).not.toContain("Purchase Amount:");
    expect(message).not.toContain("Note:");
  });
});

describe("search and history keyboards", () => {
  it("limits result UI to supplied eight records and always includes Search Again", () => {
    const customers = Array.from({ length: 8 }, (_, index) => ({
      ...customer,
      id: index + 1,
      whatsappNumber: `+880171234${String(index).padStart(4, "0")}`
    }));
    const keyboard = resultsKeyboard(customers, "abcdef", 0, true);
    expect(keyboard.inline_keyboard.filter((row) => row[0]?.callback_data.startsWith("sel:"))).toHaveLength(8);
    expect(keyboard.inline_keyboard.flat().map((button) => button.text)).toContain("🔄 Search Again");
    expect(keyboard.inline_keyboard.flat().map((button) => button.text)).not.toContain("⬅️ Previous");
    expect(keyboard.inline_keyboard.flat().map((button) => button.text)).toContain("Next ➡️");
  });

  it("shows Search Again after no matches", () => {
    expect(noResultsKeyboard("abcdef").inline_keyboard.flat().map((button) => button.text))
      .toContain("🔄 Search Again");
  });

  it("validates history pagination controls by construction", () => {
    const first = historyKeyboard("abcdef", 0, true).inline_keyboard.flat().map((button) => button.text);
    const last = historyKeyboard("abcdef", 2, false).inline_keyboard.flat().map((button) => button.text);
    expect(first).not.toContain("⬅️ Previous");
    expect(first).toContain("Next ➡️");
    expect(last).toContain("⬅️ Previous");
    expect(last).not.toContain("Next ➡️");
  });
});

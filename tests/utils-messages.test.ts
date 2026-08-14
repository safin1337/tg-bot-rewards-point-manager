import { describe, expect, it } from "vitest";
import { createCsv, csvCell, safeCsvText } from "../src/utils/csv";
import { escapeHtml } from "../src/utils/html";
import { dhakaDate, formatDhakaDateTime } from "../src/utils/time";
import { normalizeUsername } from "../src/domain/customer-identity";
import {
  addCustomerSuccessMessage,
  balanceMessage,
  earningEntryPromptMessage,
  fullNumberSearchPrompt,
  historyMessage,
  manualAddSuccessMessage,
  purchaseSuccessMessage,
  redemptionSuccessMessage,
  selectionMessage,
  suffixSearchPrompt
} from "../src/telegram/messages";
import {
  customerActionsKeyboard,
  historyKeyboard,
  missingCustomerKeyboard,
  noResultsKeyboard,
  resultsKeyboard
} from "../src/telegram/keyboards";
import type { Customer, RewardTransaction } from "../src/types/models";

const customer: Customer = {
  id: 1,
  whatsappNumber: "+8801712345678",
  whatsappUsername: null,
  telegramUsername: null,
  phoneLast4: "5678",
  phoneLast5: "45678",
  pointBalanceUnits: 65_625,
  roundedRewardBdt: 2,
  creationTelegramUpdateId: 1,
  latestMutationTelegramUpdateId: 100,
  createdAtUtc: "2026-07-29T09:30:00.000Z",
  updatedAtUtc: "2026-07-29T09:30:00.000Z"
};

describe("username normalization", () => {
  it("removes one leading @, preserves display capitalization, and lowers only lookup", () => {
    expect(normalizeUsername(" @Safin_Ahmed ")).toEqual({
      display: "Safin_Ahmed",
      lookup: "safin_ahmed"
    });
  });

  it.each(["@", "@@safin", "safin-ahmed", "safin ahmed", "a".repeat(65)])(
    "rejects invalid username %s",
    (username) => {
      expect(() => normalizeUsername(username)).toThrow(/username/i);
    }
  );
});

const customerWithLargeBalance: Customer = {
  ...customer,
  pointBalanceUnits: 13_567_000,
  roundedRewardBdt: 339
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

const latestPurchase: RewardTransaction = {
  ...transaction,
  purchaseAmountBdt: 550,
  pointsDeltaUnits: 110_000,
  balanceAfterUnits: 110_000,
  createdAtUtc: "2026-08-10T12:27:00.000Z"
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
  it.each([
    ["PURCHASE", "🛍️ <b>Record Purchase</b>"],
    ["MANUAL_ADD", "➕ <b>Add Points Manually</b>"],
    ["REDEEM", "🎁 <b>Redeem Points</b>"],
    ["BALANCE", "💰 <b>Check Balance</b>"],
    ["HISTORY", "📜 <b>Customer History</b>"]
  ] as const)("identifies the %s operation on its customer-selection panel", (operation, heading) => {
    expect(selectionMessage(operation)).toBe(
      `🏆 <b>SoulShop Rewards Point System</b>\n\n${heading}\n\nSelect a customer:`
    );
  });

  it.each([
    ["PURCHASE", "🛍️ Record Purchase"],
    ["MANUAL_ADD", "➕ Add Points Manually"],
    ["REDEEM", "🎁 Redeem Points"],
    ["BALANCE", "💰 Check Balance"],
    ["HISTORY", "📜 Customer History"]
  ] as const)("identifies the selected %s operation on both phone prompts", (operation, label) => {
    expect(suffixSearchPrompt(operation)).toBe(
      `Selected Operation: ${label}\n\n`
      + "Enter the last 4 or 5 digits of the WhatsApp No.\n"
      + "Telegram / WhatsApp Username are not accepted"
    );
    expect(fullNumberSearchPrompt(operation)).toBe(
      `Selected Operation: ${label}\n\n`
      + "Enter the full WhatsApp number.\n"
      + "Spaces and hyphens are accepted."
    );
  });

  it("shows the latest purchase above the purchase amount prompt", () => {
    expect(earningEntryPromptMessage(customer, "PURCHASE", latestPurchase)).toBe(
      "✅ <b>Taking entry for +8801712345678</b>\n\n"
      + "Latest Transaction:\n"
      + "<b>10 Aug 2026, 06:27 PM</b>\n"
      + "PURCHASE: +11.00 points\n"
      + "Purchase Amount: BDT 550\n\n"
      + "Enter the purchase amount in BDT."
    );
  });

  it("shows an escaped manual-add reason above the Add Points prompt", () => {
    const manualAddition: RewardTransaction = {
      ...latestPurchase,
      transactionType: "MANUAL_ADD",
      purchaseAmountBdt: null,
      note: "<campaign & bonus>"
    };
    expect(earningEntryPromptMessage(customer, "MANUAL_ADD", manualAddition)).toBe(
      "✅ <b>Taking entry for +8801712345678</b>\n\n"
      + "Latest Transaction:\n"
      + "<b>10 Aug 2026, 06:27 PM</b>\n"
      + "MANUAL_ADD: +11.00 points\n"
      + "Reason: &lt;campaign &amp; bonus&gt;\n\n"
      + "Enter the number of points you want to add."
    );
  });

  it("shows the exact no-prior-data fallback for a new customer", () => {
    expect(earningEntryPromptMessage(customer, "PURCHASE", null)).toBe(
      "✅ <b>Taking entry for +8801712345678</b>\n\n"
      + "Latest Transaction:\n"
      + "No Prior Data Found!\n\n"
      + "Enter the purchase amount in BDT."
    );
  });

  it("rejects a redemption passed to the latest earning formatter", () => {
    expect(() => earningEntryPromptMessage(customer, "PURCHASE", {
      ...latestPurchase,
      transactionType: "REDEEM",
      purchaseAmountBdt: null,
      pointsDeltaUnits: -10_000
    })).toThrow(/cannot be a redemption/i);
  });

  it("purchase includes headline, Congratulations, updated balance labels, and all taglines", () => {
    const message = purchaseSuccessMessage(customerWithLargeBalance, 525, 65_625);
    expect(message).toContain("Purchase Successfully Recorded");
    expect(message).toContain("Congratulations");
    expect(message).toContain("Points Earned: 6.56 points");
    expect(message).toContain(
      "Your updated reward balance: 1,356.70 points\nEstimated reward value: BDT 339"
    );
    expect(message).toContain("Buy More to Earn More\nThank you for purchasing from us\nBest Wishes from SoulShop");
  });

  it("manual addition omits an absent Reason line and escapes a present note", () => {
    const message = manualAddSuccessMessage(customerWithLargeBalance, 10_000, null);
    expect(message).toContain("Points Added: 1.00 points");
    expect(message).toContain(
      "Your updated reward balance: 1,356.70 points\nEstimated reward value: BDT 339"
    );
    expect(message).not.toContain("Reason:");
    expect(manualAddSuccessMessage(customerWithLargeBalance, 10_000, "<reason>"))
      .toContain("Reason: &lt;reason&gt;");
  });

  it("redemption uses the exact redeemed and remaining labels and never congratulates", () => {
    const message = redemptionSuccessMessage(customerWithLargeBalance, 250_000, 6);
    expect(message).not.toContain("Congratulations");
    expect(message).toContain(
      "Reward amount redeemed: 25.00 points\nEquivalent reward value: BDT 6\n\n"
      + "Your remaining reward balance: 1,356.70 points\nEstimated remaining value: BDT 339"
    );
    expect(message).toContain("Best Wishes from SoulShop");
  });

  it("balance uses the exact current balance labels", () => {
    expect(balanceMessage(customerWithLargeBalance)).toContain(
      "Your current reward balance: 1,356.70 points\nEstimated reward value: BDT 339"
    );
  });

  it("zero-point customer success contains no reward transaction claim", () => {
    const zero = { ...customer, pointBalanceUnits: 0, roundedRewardBdt: 0 };
    expect(addCustomerSuccessMessage(zero)).toContain("Current Points: 0.00 points");
  });

  it("history keeps its heading, omits closing taglines, and formats details safely", () => {
    const message = historyMessage(customer, [transaction], 0);
    expect(message).toContain("Customer Reward History");
    expect(message).toContain("29 Jul 2026, 03:30 PM");
    expect(message).toContain("Current Points: 6.56 points");
    expect(message).toContain("PURCHASE: +6.56 points");
    expect(message).toContain("Balance Before: 0.00 points");
    expect(message).toContain("Balance After: 6.56 points");
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

  it("uses the compact Back label on customer-search navigation", () => {
    const labels = [
      ...resultsKeyboard([customer], "abcdef", 0, false).inline_keyboard.flat(),
      ...noResultsKeyboard("abcdef").inline_keyboard.flat(),
      ...historyKeyboard("abcdef", 0, false).inline_keyboard.flat(),
      ...missingCustomerKeyboard("abcdef").inline_keyboard.flat()
    ].map((button) => button.text);
    expect(labels.filter((label) => label === "⬅️ Back")).toHaveLength(4);
    expect(labels).not.toContain("⬅️ Back to Search Options");
  });

  it("uses the shopping-bags emoji for Record Purchase customer actions", () => {
    expect(customerActionsKeyboard("abcdef").inline_keyboard.flat()).toContainEqual({
      text: "🛍️ Record Purchase",
      callback_data: "act:P:abcdef"
    });
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

import { describe, expect, it } from "vitest";
import { createCsv, csvCell, safeCsvText } from "../src/utils/csv";
import { escapeHtml } from "../src/utils/html";
import { dhakaDate, formatDhakaDateTime } from "../src/utils/time";
import { formatPurchaseAmountBdt } from "../src/utils/bdt";
import { normalizeUsername } from "../src/domain/customer-identity";
import {
  addCustomerSuccessMessage,
  addCustomerConfirmationMessage,
  balanceMessage,
  createCustomerForOperationConfirmationMessage,
  customerInfoBlock,
  earningEntryPromptMessage,
  fullNumberSearchPrompt,
  historyMessage,
  identifierInputPromptText,
  identityChangeConfirmationMessage,
  identityChangeSuccessMessage,
  identityRemoveConfirmationMessage,
  manualAddSuccessMessage,
  manageCustomerMessage,
  purchaseSuccessMessage,
  redemptionSuccessMessage,
  selectionMessage,
  suffixSearchPrompt,
  unsupportedNonTextMessage,
  existingCustomerMessage,
  usernameSearchPrompt
} from "../src/telegram/messages";
import { pointConfirmation, purchaseConfirmation } from "../src/workflows/common";
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

describe("non-text informational message", () => {
  it("uses the configured escaped heading and exact safe instruction", () => {
    expect(unsupportedNonTextMessage()).toBe(
      "🏆 <b>SoulShop Rewards Point System</b>\n\n"
      + "⚠️ Images and other non-text messages are not supported. "
      + "Please send text, use the available buttons, or use /cancel."
    );
  });
});

describe("username normalization", () => {
  it("removes copied directional controls and one leading @ while preserving capitalization", () => {
    expect(normalizeUsername("WHATSAPP_USERNAME", "\u2066 @Safin_Ahmed \u2069")).toEqual({
      display: "Safin_Ahmed",
      lookup: "safin_ahmed"
    });
  });

  it("removes every recognized bidirectional formatting control wherever copied", () => {
    const controls = "\u061C\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069";
    expect(normalizeUsername("TELEGRAM_USERNAME", `${controls}@Example${controls}_User${controls}`))
      .toEqual({ display: "Example_User", lookup: "example_user" });
  });

  it.each(["\u200Bhidden", "hidden\u2060", "emoji🙂", "two words", "@@safin", "\u2066\u2069"])(
    "rejects unsupported or empty cleaned username %s",
    (username) => expect(() => normalizeUsername("WHATSAPP_USERNAME", username)).toThrow(/WhatsApp username/i)
  );

  it.each(["safin.ahmed", "Safin_Ahmed", "safin_a.ahmed01"])(
    "accepts valid WhatsApp username %s",
    (username) => expect(normalizeUsername("WHATSAPP_USERNAME", username).display).toBe(username)
  );

  it.each([".safin", "safin.", "safin..ahmed", "safin-ahmed", "a".repeat(65)])(
    "rejects invalid WhatsApp username %s",
    (username) => expect(() => normalizeUsername("WHATSAPP_USERNAME", username)).toThrow(/WhatsApp username/i)
  );

  it("keeps platform rules separate by rejecting periods for Telegram", () => {
    expect(() => normalizeUsername("TELEGRAM_USERNAME", "safin.ahmed"))
      .toThrow(/Telegram username/i);
  });
});

const customerWithLargeBalance: Customer = {
  ...customer,
  pointBalanceUnits: 13_567_000,
  roundedRewardBdt: 339
};

const customerWithAllIdentifiers: Customer = {
  ...customerWithLargeBalance,
  whatsappUsername: "Example_Name",
  telegramUsername: "Telegram_Name"
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

describe("Bangladeshi purchase-amount presentation", () => {
  it.each([
    [1, "1.00"],
    [999, "999.00"],
    [1_000, "1,000.00"],
    [10_201, "10,201.00"],
    [99_999, "99,999.00"],
    [100_000, "1,00,000.00"],
    [110_201, "1,10,201.00"],
    [9_999_999, "99,99,999.00"],
    [10_000_000, "1,00,00,000.00"]
  ])("formats BDT %d as %s", (amount, expected) => {
    expect(formatPurchaseAmountBdt(amount)).toBe(expected);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid display input %s",
    (amount) => expect(() => formatPurchaseAmountBdt(amount)).toThrow(/positive safe integer/i)
  );
});

describe("required branded messages", () => {
  it.each([
    ["PURCHASE", "🛍️ <b>Record Purchase</b>"],
    ["MANUAL_ADD", "➕ <b>Add Points Manually</b>"],
    ["REDEEM", "🎁 <b>Redeem Points</b>"],
    ["BALANCE", "💰 <b>Check Balance</b>"],
    ["HISTORY", "📜 <b>Customer History</b>"],
    ["MANAGE_CUSTOMER", "🪪 <b>Manage Customer Identities</b>"]
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
    ["HISTORY", "📜 Customer History"],
    ["MANAGE_CUSTOMER", "🪪 Manage Customer Identities"]
  ] as const)("identifies the selected %s operation on all identifier prompts", (operation, label) => {
    expect(suffixSearchPrompt(operation)).toBe(
      `Selected Operation: ${label}\n\n`
      + "Enter the last 4 or 5 digits of the WhatsApp No.\n"
      + "Telegram / WhatsApp Username are not accepted"
    );
    expect(fullNumberSearchPrompt(operation)).toBe(
      `Selected Operation: ${label}\n\n`
      + "Enter the customer's WhatsApp number:\n"
      + "Spaces and hyphen are accepted."
    );
    expect(usernameSearchPrompt(operation, "WHATSAPP_USERNAME")).toBe(
      `Selected Operation: ${label}\n\nEnter the customer's WhatsApp username:`
    );
    expect(usernameSearchPrompt(operation, "TELEGRAM_USERNAME")).toBe(
      `Selected Operation: ${label}\n\nEnter the customer's Telegram username:`
    );
  });

  it("defines the three standardized identifier instructions exactly", () => {
    expect(identifierInputPromptText("WHATSAPP_PHONE")).toBe(
      "Enter the customer's WhatsApp number:\nSpaces and hyphen are accepted."
    );
    expect(identifierInputPromptText("WHATSAPP_USERNAME"))
      .toBe("Enter the customer's WhatsApp username:");
    expect(identifierInputPromptText("TELEGRAM_USERNAME"))
      .toBe("Enter the customer's Telegram username:");
  });

  it("formats conditional Customer Info in fixed order and escapes every value", () => {
    expect(customerInfoBlock({
      whatsappNumber: "+8801712345678",
      whatsappUsername: "Example_Name",
      telegramUsername: "Telegram_Name"
    })).toBe(
      "Customer Info:\n"
      + "WhatsApp Number: +8801712345678\n"
      + "WhatsApp Username: @Example_Name\n"
      + "Telegram Username: @Telegram_Name"
    );
    expect(customerInfoBlock({
      whatsappNumber: null,
      whatsappUsername: "Name_With_<tag>",
      telegramUsername: null
    })).toBe("Customer Info:\nWhatsApp Username: @Name_With_&lt;tag&gt;");
    expect(() => customerInfoBlock({
      whatsappNumber: null,
      whatsappUsername: null,
      telegramUsername: null
    })).toThrow(/no identifier/i);
  });

  it("uses the full Customer Info block across customer-specific messages", () => {
    const expected = "Customer Info:\n"
      + "WhatsApp Number: +8801712345678\n"
      + "WhatsApp Username: @Example_Name\n"
      + "Telegram Username: @Telegram_Name";
    const purchaseMessage = purchaseSuccessMessage(customerWithAllIdentifiers, 500, 100_000);
    const messages = [
      balanceMessage(customerWithAllIdentifiers),
      purchaseConfirmation(customerWithAllIdentifiers, 500, 100_000),
      pointConfirmation(customerWithAllIdentifiers, "MANUAL_ADD", 10_000, null),
      manualAddSuccessMessage(customerWithAllIdentifiers, 10_000, null),
      pointConfirmation(customerWithAllIdentifiers, "REDEEM", 10_000, null),
      redemptionSuccessMessage(customerWithAllIdentifiers, 10_000, 0),
      historyMessage(customerWithAllIdentifiers, [], 0),
      addCustomerSuccessMessage(customerWithAllIdentifiers),
      existingCustomerMessage(customerWithAllIdentifiers),
      manageCustomerMessage(customerWithAllIdentifiers),
      identityChangeConfirmationMessage(customerWithAllIdentifiers, "WHATSAPP_USERNAME", "Next_Name"),
      identityRemoveConfirmationMessage(customerWithAllIdentifiers, "TELEGRAM_USERNAME"),
      identityChangeSuccessMessage(customerWithAllIdentifiers, "TELEGRAM_USERNAME", false, false)
    ];
    for (const message of messages) {
      expect(message).toContain(expected);
      expect(message).not.toContain("Not provided");
    }
    expect(purchaseMessage).toContain(
      "`Customer Info:`\n"
      + "`WhatsApp Number: +8801712345678`\n"
      + "`WhatsApp Username: @Example_Name`\n"
      + "`Telegram Username: @Telegram_Name`"
    );
    expect(purchaseMessage).not.toContain("Not provided");
  });

  it("uses Customer Info for both new-customer confirmation paths", () => {
    const identifier = {
      type: "WHATSAPP_USERNAME" as const,
      username: normalizeUsername("WHATSAPP_USERNAME", "Example.Name")
    };
    expect(addCustomerConfirmationMessage(identifier))
      .toContain("Customer Info:\nWhatsApp Username: @Example.Name");
    expect(createCustomerForOperationConfirmationMessage(identifier))
      .toContain("Customer Info:\nWhatsApp Username: @Example.Name");
  });

  it("shows the latest purchase above the purchase amount prompt", () => {
    expect(earningEntryPromptMessage(customer, "PURCHASE", latestPurchase)).toBe(
      "✅ <b>Taking entry for +8801712345678</b>\n\n"
      + "Latest Transaction:\n"
      + "<b>10 Aug 2026, 06:27 PM</b>\n"
      + "PURCHASE: +11.00 points\n"
      + "Purchase Amount: BDT 550.00\n\n"
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

  it("renders the exact WhatsApp-formatted purchase receipt", () => {
    const message = purchaseSuccessMessage(customerWithLargeBalance, 110_201, 65_625);
    expect(message).toBe(
      "*🏆 SoulShop Rewards Point System*\n\n"
      + "✅ Purchase Successfully Recorded\n"
      + "`Customer Info:`\n"
      + "`WhatsApp Number: +8801712345678`\n"
      + "`Purchase Amount: BDT 1,10,201.00`\n"
      + "`Points Earned: 6.56 points`\n\n"
      + "*🎉 Congratulations!*\n\n"
      + "Updated reward balance: 1,356.70 points\n"
      + "Estimated reward value: *BDT 339*\n\n"
      + "&gt; Buy More to Earn More\n"
      + "&gt; Thank you for purchasing from us\n"
      + "&gt; Best Wishes from SoulShop"
    );
  });

  it("manual addition omits an absent Reason line and escapes a present note", () => {
    const message = manualAddSuccessMessage(customerWithLargeBalance, 10_000, null);
    expect(message).toContain("Points Added: 1.00 points");
    expect(message).toContain(
      "Current reward balance: 1,356.70 points\nEstimated reward value: BDT 339"
    );
    expect(message).not.toContain("Reason:");
    expect(manualAddSuccessMessage(customerWithLargeBalance, 10_000, "<reason>"))
      .toContain("Reason: &lt;reason&gt;");
  });

  it("renders a WhatsApp-ready bold heading and quoted taglines on every shareable message", () => {
    const expectedClosing = "&gt; Buy More to Earn More\n"
      + "&gt; Thank you for purchasing from us\n"
      + "&gt; Best Wishes from SoulShop";
    const messages = [
      purchaseSuccessMessage(customerWithLargeBalance, 525, 10_000),
      manualAddSuccessMessage(customerWithLargeBalance, 10_000, null),
      redemptionSuccessMessage(customerWithLargeBalance, 10_000, 0),
      balanceMessage(customerWithLargeBalance)
    ];
    for (const message of messages) {
      expect(message.startsWith("*🏆 SoulShop Rewards Point System*\n")).toBe(true);
      expect(message.endsWith(expectedClosing)).toBe(true);
      expect(message).not.toContain("🏆 <b>SoulShop Rewards Point System</b>");
    }
  });

  it("redemption uses the exact redeemed and remaining labels and never congratulates", () => {
    const message = redemptionSuccessMessage(customerWithLargeBalance, 250_000, 6);
    expect(message).not.toContain("Congratulations");
    expect(message).toContain(
      "Reward amount redeemed: 25.00 points\nEquivalent reward value: BDT 6\n\n"
      + "Your remaining reward balance: 1,356.70 points\nEstimated remaining value: BDT 339"
    );
    expect(message).toContain("&gt; Best Wishes from SoulShop");
  });

  it("balance uses the exact current balance labels", () => {
    expect(balanceMessage(customerWithLargeBalance)).toContain(
      "Current reward balance: 1,356.70 points\nEstimated reward value: BDT 339"
    );
  });

  it("uses Bangladeshi grouping in purchase confirmation without changing calculations", () => {
    const message = purchaseConfirmation(customer, 10_201, 127_513);
    expect(message).toContain("Purchase Amount: BDT 10,201.00");
    expect(message).toContain("Points Earned: 12.75 points");
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
    expect(message).toContain("Purchase Amount: BDT 525.00");
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

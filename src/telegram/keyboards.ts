import type { LeaderboardPeriod } from "../domain/leaderboard";
import type { Customer, LeaderboardPeriodType } from "../types/models";
import { customerPrimaryLabel } from "../domain/customer-identity";
import type { InlineKeyboardMarkup } from "./types";

export const dashboardKeyboard = (): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [
      { text: "🛍️ Record Purchase", callback_data: "begin:P" },
      { text: "➕ Add Points Manually", callback_data: "begin:M" }
    ],
    [
      { text: "🎁 Redeem Points", callback_data: "begin:R" },
      { text: "💰 Check Balance", callback_data: "begin:B" }
    ],
    [
      { text: "📜 Customer History", callback_data: "begin:H" },
      { text: "👤 Add New Customer", callback_data: "begin:A" }
    ],
    [{ text: "🪪 Manage Customer Identities", callback_data: "begin:U" }],
    [
      { text: "🏅 Leaderboard", callback_data: "begin:L" },
      { text: "📤 Export Data", callback_data: "begin:E" }
    ],
    [{ text: "ℹ️ Help", callback_data: "help" }]
  ]
});

export const cancelKeyboard = (): InlineKeyboardMarkup => ({
  inline_keyboard: [[{ text: "❌ Cancel", callback_data: "cancel" }]]
});

export type BackDestination = "s" | "f" | "a" | "n" | "u" | "i" | "c";

const backButton = (
  token: string,
  destination: BackDestination,
  text = "⬅️ Back"
) => ({ text, callback_data: `back:${destination}:${token}` });

export const backCancelKeyboard = (
  token: string,
  destination: BackDestination,
  backText = "⬅️ Back"
): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [backButton(token, destination, backText)],
    [{ text: "❌ Cancel", callback_data: "cancel" }]
  ]
});

export const redeemAmountKeyboard = (token: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [{ text: "💯 Redeem All Points", callback_data: `redeemall:${token}` }],
    [backButton(token, "s", "⬅️ Back to Customer Search")],
    [{ text: "❌ Cancel", callback_data: "cancel" }]
  ]
});

export const selectionKeyboard = (token: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [{ text: "🔎 WhatsApp Last 4/5 Digits", callback_data: `mode:s:${token}` }],
    [{ text: "☎️ Full WhatsApp Number", callback_data: `mode:f:${token}` }],
    [{ text: "💬 WhatsApp Username", callback_data: `mode:w:${token}` }],
    [{ text: "✈️ Telegram Username", callback_data: `mode:t:${token}` }],
    [{ text: "❌ Cancel", callback_data: "cancel" }]
  ]
});

export const resultsKeyboard = (
  customers: readonly Customer[],
  token: string,
  page: number,
  hasNext: boolean
): InlineKeyboardMarkup => {
  const rows = customers.map((customer) => [
    { text: customerPrimaryLabel(customer), callback_data: `sel:${token}:${customer.id}` }
  ]);
  const pagination = [];
  if (page > 0) pagination.push({ text: "⬅️ Previous", callback_data: `pg:${token}:${page - 1}` });
  if (hasNext) pagination.push({ text: "Next ➡️", callback_data: `pg:${token}:${page + 1}` });
  if (pagination.length > 0) rows.push(pagination);
  rows.push([{ text: "🔄 Search Again", callback_data: `again:${token}` }]);
  rows.push([backButton(token, "s")]);
  rows.push([{ text: "❌ Cancel", callback_data: "cancel" }]);
  return { inline_keyboard: rows };
};

export const noResultsKeyboard = (token: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [{ text: "🔄 Search Again", callback_data: `again:${token}` }],
    [backButton(token, "s")],
    [{ text: "❌ Cancel", callback_data: "cancel" }]
  ]
});

export const confirmKeyboard = (
  token: string,
  confirmText: string,
  backDestination: "a" | "n"
): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [{ text: confirmText, callback_data: `confirm:${token}` }],
    [backButton(token, backDestination)],
    [{ text: "❌ Cancel", callback_data: "cancel" }]
  ]
});

export const createForOperationKeyboard = (token: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [{ text: "✅ Create and Continue", callback_data: `create:${token}` }],
    [backButton(token, "s", "⬅️ Back to Search Methods")],
    [{ text: "❌ Cancel", callback_data: "cancel" }]
  ]
});

export const addCustomerConfirmKeyboard = (token: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [{ text: "✅ Confirm Customer", callback_data: `confirm:${token}` }],
    [backButton(token, "c")],
    [{ text: "❌ Cancel", callback_data: "cancel" }]
  ]
});

export const skipNoteKeyboard = (token: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [{ text: "⏭️ Skip Note", callback_data: `skip:${token}` }],
    [backButton(token, "a", "⬅️ Back to Point Amount")],
    [{ text: "❌ Cancel", callback_data: "cancel" }]
  ]
});

export const historyKeyboard = (
  token: string,
  page: number,
  hasNext: boolean
): InlineKeyboardMarkup => {
  const navigation = [];
  if (page > 0) navigation.push({ text: "⬅️ Previous", callback_data: `hist:${token}:${page - 1}` });
  if (hasNext) navigation.push({ text: "Next ➡️", callback_data: `hist:${token}:${page + 1}` });
  const rows = navigation.length > 0 ? [navigation] : [];
  rows.push([{ text: "🔄 Search Again", callback_data: `again:${token}` }]);
  rows.push([{ text: "👤 Customer Actions", callback_data: `actions:${token}` }]);
  rows.push([backButton(token, "s")]);
  rows.push([{ text: "❌ Cancel", callback_data: "cancel" }]);
  return { inline_keyboard: rows };
};

export const customerActionsKeyboard = (token: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [
      { text: "🛍️ Record Purchase", callback_data: `act:P:${token}` },
      { text: "➕ Add Points Manually", callback_data: `act:M:${token}` }
    ],
    [
      { text: "🎁 Redeem Points", callback_data: `act:R:${token}` },
      { text: "💰 Check Balance", callback_data: `act:B:${token}` }
    ],
    [{ text: "📜 View History", callback_data: `act:H:${token}` }],
    [{ text: "🪪 Manage Identities", callback_data: `act:U:${token}` }],
    [{ text: "❌ Cancel", callback_data: "cancel" }]
  ]
});

export const existingCustomerKeyboard = (token: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [{ text: "Select Customer", callback_data: `actions:${token}` }],
    [{ text: "⌨️ Enter Another Identifier", callback_data: `another:${token}` }],
    [{ text: "❌ Cancel", callback_data: "cancel" }]
  ]
});

export const missingCustomerKeyboard = (token: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [{ text: "🔄 Search Again", callback_data: `again:${token}` }],
    [backButton(token, "s")],
    [{ text: "❌ Cancel", callback_data: "cancel" }]
  ]
});

export const addCustomerIdentityKeyboard = (token: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [{ text: "☎️ WhatsApp Phone", callback_data: `newid:p:${token}` }],
    [{ text: "💬 WhatsApp Username", callback_data: `newid:w:${token}` }],
    [{ text: "✈️ Telegram Username", callback_data: `newid:t:${token}` }],
    [{ text: "❌ Cancel", callback_data: "cancel" }]
  ]
});

export const manageCustomerKeyboard = (customer: Customer, token: string): InlineKeyboardMarkup => {
  const rows = [
    [{
      text: `${customer.whatsappNumber === null ? "➕ Add" : "✏️ Change"} WhatsApp Phone`,
      callback_data: `idedit:p:${token}`
    }],
    [{
      text: `${customer.whatsappUsername === null ? "➕ Add" : "✏️ Change"} WhatsApp Username`,
      callback_data: `idedit:w:${token}`
    }],
    [{
      text: `${customer.telegramUsername === null ? "➕ Add" : "✏️ Change"} Telegram Username`,
      callback_data: `idedit:t:${token}`
    }]
  ];
  if (customer.whatsappNumber !== null) {
    rows.push([{ text: "🗑️ Remove WhatsApp Phone", callback_data: `idremove:p:${token}` }]);
  }
  if (customer.whatsappUsername !== null) {
    rows.push([{ text: "🗑️ Remove WhatsApp Username", callback_data: `idremove:w:${token}` }]);
  }
  if (customer.telegramUsername !== null) {
    rows.push([{ text: "🗑️ Remove Telegram Username", callback_data: `idremove:t:${token}` }]);
  }
  rows.push([backButton(token, "s", "⬅️ Back to Customer Search")]);
  rows.push([{ text: "❌ Cancel", callback_data: "cancel" }]);
  return { inline_keyboard: rows };
};

export const identityChangeConfirmKeyboard = (token: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [{ text: "✅ Confirm Identifier", callback_data: `idconfirm:${token}` }],
    [backButton(token, "i", "⬅️ Back to Identity Management")],
    [{ text: "❌ Cancel", callback_data: "cancel" }]
  ]
});

export const identityRemoveConfirmKeyboard = (token: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [{ text: "✅ Confirm Removal", callback_data: `idremoveconfirm:${token}` }],
    [backButton(token, "i", "⬅️ Back to Identity Management")],
    [{ text: "❌ Cancel", callback_data: "cancel" }]
  ]
});

export const exportKeyboard = (token: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [{ text: "👥 Customer Balances", callback_data: `export:${token}:c` }],
    [{ text: "📜 Transaction History", callback_data: `export:${token}:t` }],
    [{ text: "📦 Complete Export", callback_data: `export:${token}:a` }],
    [{ text: "❌ Cancel", callback_data: "cancel" }]
  ]
});

export const leaderboardMenuKeyboard = (token: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [{ text: "📅 Weekly Leaderboard", callback_data: `lb:w:${token}` }],
    [{ text: "🗓️ Monthly Leaderboard", callback_data: `lb:m:${token}` }],
    [{ text: "⚠️ Reset Current Week", callback_data: `lbr:w:${token}` }],
    [{ text: "⚠️ Reset Current Month", callback_data: `lbr:m:${token}` }],
    [{ text: "❌ Cancel", callback_data: "cancel" }]
  ]
});

export const leaderboardPeriodsKeyboard = (
  type: LeaderboardPeriodType,
  periods: readonly LeaderboardPeriod[],
  token: string
): InlineKeyboardMarkup => ({
  inline_keyboard: [
    ...periods.map((period, index) => [{
      text: `${period.running ? "▶️" : "✅"} ${period.label}`,
      callback_data: `lbv:${type === "WEEK" ? "w" : "m"}:${index}:${token}`
    }]),
    [{ text: "⬅️ Leaderboard Menu", callback_data: `lb:back:${token}` }],
    [{ text: "❌ Cancel", callback_data: "cancel" }]
  ]
});

export const leaderboardResultKeyboard = (
  type: LeaderboardPeriodType,
  periodIndex: number,
  token: string
): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [{
      text: "🔄 Refresh",
      callback_data: `lbv:${type === "WEEK" ? "w" : "m"}:${periodIndex}:${token}`
    }],
    [{ text: "⬅️ Leaderboard Menu", callback_data: `lb:back:${token}` }],
    [{ text: "❌ Cancel", callback_data: "cancel" }]
  ]
});

export const leaderboardResetKeyboard = (
  type: LeaderboardPeriodType,
  token: string
): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [{
      text: "✅ Confirm Reset",
      callback_data: `lbc:${type === "WEEK" ? "w" : "m"}:${token}`
    }],
    [{ text: "❌ Cancel", callback_data: "cancel" }]
  ]
});

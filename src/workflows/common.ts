import { formatPointUnitsForDisplay } from "../domain/points";
import { roundRewardBdt, safeBalanceAfter } from "../domain/rewards";
import type { ConversationState, Customer, Operation } from "../types/models";
import {
  cancelKeyboard,
  exportKeyboard,
  historyKeyboard,
  leaderboardMenuKeyboard,
  resultsKeyboard,
  selectionKeyboard
} from "../telegram/keyboards";
import { BRAND, historyMessage, leaderboardMenuMessage, selectionMessage } from "../telegram/messages";
import { escapeHtml } from "../utils/html";
import type { WorkflowContext } from "./context";
import { editOrSendFallback, type ActiveMessageTarget } from "../telegram/active-message";
import type { InlineKeyboardMarkup } from "../telegram/types";

const display = async (
  context: WorkflowContext,
  chatId: number,
  text: string,
  replyMarkup: InlineKeyboardMarkup | undefined,
  target: ActiveMessageTarget | null
): Promise<void> => {
  if (target === null) {
    await context.telegram.sendMessage(chatId, text, {
      ...(replyMarkup === undefined ? {} : { replyMarkup })
    });
    return;
  }
  await editOrSendFallback(context.telegram, target, text, replyMarkup);
};

export const operationFromCode = (code: string): Operation | null => {
  switch (code) {
    case "P": return "PURCHASE";
    case "M": return "MANUAL_ADD";
    case "R": return "REDEEM";
    case "B": return "BALANCE";
    case "H": return "HISTORY";
    case "A": return "ADD_CUSTOMER";
    case "E": return "EXPORT";
    case "L": return "LEADERBOARD";
    default: return null;
  }
};

export const firstStepFor = (operation: Operation) =>
  operation === "ADD_CUSTOMER"
    ? "AWAIT_ADD_CUSTOMER_NUMBER" as const
    : operation === "EXPORT"
      ? "SELECT_EXPORT" as const
      : operation === "LEADERBOARD"
        ? "LEADERBOARD_MENU" as const
      : "SELECT_MODE" as const;

export const startOperation = async (
  context: WorkflowContext,
  adminId: string,
  chatId: number,
  operation: Operation,
  updateId: number,
  target: ActiveMessageTarget | null = null
): Promise<ConversationState> => {
  const state = await context.states.start(adminId, operation, firstStepFor(operation), updateId);
  if (operation === "ADD_CUSTOMER") {
    await display(
      context,
      chatId,
      `${BRAND}\n\n➕ <b>Add New Customer</b>\n\nEnter the customer's WhatsApp number.\nSpaces and hyphens are accepted.`,
      cancelKeyboard(),
      target
    );
  } else if (operation === "EXPORT") {
    await display(
      context,
      chatId,
      `${BRAND}\n\n📤 <b>Export Data</b>\n\nSelect the data you want to export:`,
      exportKeyboard(state.payload.token),
      target
    );
  } else if (operation === "LEADERBOARD") {
    await display(
      context,
      chatId,
      leaderboardMenuMessage(),
      leaderboardMenuKeyboard(state.payload.token),
      target
    );
  } else {
    await display(
      context,
      chatId,
      selectionMessage(operation),
      selectionKeyboard(state.payload.token),
      target
    );
  }
  return state;
};

export const promptAfterSelection = async (
  context: WorkflowContext,
  state: ConversationState,
  customer: Customer,
  chatId: number,
  target: ActiveMessageTarget | null = null
): Promise<void> => {
  const base = `✅ Taking entry for ${escapeHtml(customer.whatsappNumber)}`;
  if (state.activeOperation === "PURCHASE") {
    await context.states.save({
      ...state,
      currentStep: "AWAIT_PURCHASE_AMOUNT",
      selectedCustomerId: customer.id,
      selectedWhatsappNumber: customer.whatsappNumber,
      payload: { token: state.payload.token }
    });
    await display(context, chatId, `${base}\n\nEnter the purchase amount in BDT.`, cancelKeyboard(), target);
    return;
  }
  if (state.activeOperation === "MANUAL_ADD") {
    await context.states.save({
      ...state,
      currentStep: "AWAIT_POINT_AMOUNT",
      selectedCustomerId: customer.id,
      selectedWhatsappNumber: customer.whatsappNumber,
      payload: { token: state.payload.token }
    });
    await display(
      context,
      chatId,
      `${base}\n\nEnter the number of points you want to add.`,
      cancelKeyboard(),
      target
    );
    return;
  }
  if (state.activeOperation === "REDEEM") {
    await context.states.save({
      ...state,
      currentStep: "AWAIT_POINT_AMOUNT",
      selectedCustomerId: customer.id,
      selectedWhatsappNumber: customer.whatsappNumber,
      payload: { token: state.payload.token }
    });
    await display(
      context,
      chatId,
      `${base}\n\nCurrent Points: ${formatPointUnitsForDisplay(customer.pointBalanceUnits)} points\nCurrent Reward Value: ≈ BDT ${customer.roundedRewardBdt}\n\nEnter the number of points you want to redeem.`,
      cancelKeyboard(),
      target
    );
    return;
  }
  if (state.activeOperation === "BALANCE") {
    const { balanceMessage } = await import("../telegram/messages");
    await context.states.clear(state.administratorTelegramId);
    await display(context, chatId, balanceMessage(customer), undefined, target);
    return;
  }
  if (state.activeOperation === "HISTORY") {
    const saved = await context.states.save({
      ...state,
      currentStep: "SHOW_HISTORY",
      selectedCustomerId: customer.id,
      selectedWhatsappNumber: customer.whatsappNumber,
      searchPage: 0,
      payload: { token: state.payload.token }
    });
    await showHistory(context, saved, customer, chatId, 0, target);
  }
};

export const showSearchResults = async (
  context: WorkflowContext,
  state: ConversationState,
  chatId: number,
  page: number,
  target: ActiveMessageTarget | null = null
): Promise<void> => {
  if (state.searchDigits === null) throw new Error("Search state is incomplete.");
  const result = await context.customers.searchBySuffix(state.searchDigits, page);
  const saved = await context.states.save({
    ...state,
    currentStep: "SHOW_RESULTS",
    searchPage: page,
    selectedCustomerId: null,
    selectedWhatsappNumber: null
  });
  if (result.customers.length === 0) {
    const { noResultsKeyboard } = await import("../telegram/keyboards");
    await display(
      context,
      chatId,
      `${BRAND}\n\nNo customer was found ending in ${escapeHtml(state.searchDigits)}.`,
      noResultsKeyboard(saved.payload.token),
      target
    );
    return;
  }
  await display(
    context,
    chatId,
    `🔎 <b>Matching Customers</b>\n\nSelect the customer you are looking for:`,
    resultsKeyboard(result.customers, saved.payload.token, page, result.hasNext),
    target
  );
};

export const showHistory = async (
  context: WorkflowContext,
  state: ConversationState,
  customer: Customer,
  chatId: number,
  page: number,
  target: ActiveMessageTarget | null = null
): Promise<void> => {
  const result = await context.transactions.listForCustomer(customer.id, page);
  const saved = await context.states.save({ ...state, currentStep: "SHOW_HISTORY", searchPage: page });
  await display(
    context,
    chatId,
    historyMessage(customer, result.transactions, page),
    historyKeyboard(saved.payload.token, page, result.hasNext),
    target
  );
};

export const purchaseConfirmation = (
  customer: Customer,
  amount: number,
  units: number
): string => {
  const after = safeBalanceAfter(customer.pointBalanceUnits, units);
  return `${BRAND}

<b>Confirm Purchase</b>

Customer: ${escapeHtml(customer.whatsappNumber)}
Purchase Amount: BDT ${amount}
Points Earned: ${formatPointUnitsForDisplay(units)} points
Previous Points: ${formatPointUnitsForDisplay(customer.pointBalanceUnits)} points
New Points: ${formatPointUnitsForDisplay(after)} points
Previous Reward Value: ≈ BDT ${customer.roundedRewardBdt}
New Reward Value: ≈ BDT ${roundRewardBdt(after)}`;
};

export const pointConfirmation = (
  customer: Customer,
  operation: "MANUAL_ADD" | "REDEEM",
  units: number,
  note: string | null
): string => {
  const after = safeBalanceAfter(customer.pointBalanceUnits, operation === "REDEEM" ? -units : units);
  return `${BRAND}

<b>Confirm ${operation === "REDEEM" ? "Redemption" : "Manual Point Addition"}</b>

Customer: ${escapeHtml(customer.whatsappNumber)}
Points ${operation === "REDEEM" ? "to Redeem" : "to Add"}: ${formatPointUnitsForDisplay(units)} points${note === null ? "" : `\nReason: ${escapeHtml(note)}`}
Previous Points: ${formatPointUnitsForDisplay(customer.pointBalanceUnits)} points
New Points: ${formatPointUnitsForDisplay(after)} points
Previous Reward Value: ≈ BDT ${customer.roundedRewardBdt}
New Reward Value: ≈ BDT ${roundRewardBdt(after)}`;
};

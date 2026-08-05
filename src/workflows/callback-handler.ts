import { DomainError } from "../domain/errors";
import { normalizePhone } from "../domain/phone";
import { formatPointUnits } from "../domain/points";
import { newStateToken } from "../database/state-repository";
import {
  cancelKeyboard,
  customerActionsKeyboard,
  dashboardKeyboard,
  confirmKeyboard,
} from "../telegram/keyboards";
import {
  BRAND,
  addCustomerSuccessMessage,
  helpMessage,
  manualAddSuccessMessage,
  purchaseSuccessMessage,
  redemptionSuccessMessage
} from "../telegram/messages";
import type { ConversationState } from "../types/models";
import { escapeHtml } from "../utils/html";
import {
  operationFromCode,
  pointConfirmation,
  promptAfterSelection,
  showHistory,
  showSearchResults,
  startOperation
} from "./common";
import type { WorkflowContext } from "./context";

const stale = async (context: WorkflowContext, chatId: number): Promise<void> => {
  await context.telegram.sendMessage(
    chatId,
    `${BRAND}\n\n⚠️ This button is stale or does not match the current operation. Use /restart or /cancel.`
  );
};

const stateForToken = async (
  context: WorkflowContext,
  adminId: string,
  chatId: number,
  token: string
): Promise<ConversationState | null> => {
  const result = await context.states.get(adminId);
  if (result.state === null) {
    await context.telegram.sendMessage(
      chatId,
      result.expired
        ? `${BRAND}\n\n⏱️ This operation expired. Please start again.`
        : `${BRAND}\n\n⚠️ There is no active operation. Use /start.`
    );
    return null;
  }
  if (result.state.payload.token !== token) {
    await stale(context, chatId);
    return null;
  }
  return result.state;
};

const selectMatchesCurrentSearch = (state: ConversationState, phone: string): boolean => {
  if (state.searchDigits === null) return false;
  return phone.endsWith(state.searchDigits);
};

const confirmMutation = async (
  context: WorkflowContext,
  state: ConversationState,
  chatId: number,
  updateId: number
): Promise<void> => {
  if (
    state.selectedCustomerId === null
    || state.payload.pointUnits === undefined
    || state.payload.expectedBalanceUnits === undefined
  ) {
    await stale(context, chatId);
    return;
  }
  const type = state.currentStep === "CONFIRM_PURCHASE"
    ? "PURCHASE"
    : state.currentStep === "CONFIRM_MANUAL_ADD"
      ? "MANUAL_ADD"
      : state.currentStep === "CONFIRM_REDEEM"
        ? "REDEEM"
        : null;
  if (type === null) {
    await stale(context, chatId);
    return;
  }
  if (state.activeOperation !== type) {
    await stale(context, chatId);
    return;
  }
  try {
    const result = await context.mutations.mutate({
      customerId: state.selectedCustomerId,
      type,
      pointUnits: state.payload.pointUnits,
      purchaseAmountBdt: type === "PURCHASE" ? state.payload.purchaseAmountBdt ?? null : null,
      note: type === "MANUAL_ADD" ? state.payload.note ?? null : null,
      telegramUpdateId: updateId,
      expectedBalanceUnits: state.payload.expectedBalanceUnits
    });
    await context.states.clear(state.administratorTelegramId);
    if (result.duplicate) {
      await context.telegram.sendMessage(
        chatId,
        `${BRAND}\n\nℹ️ This confirmation was already processed.\n\nCurrent Points: ${formatPointUnits(result.customer.pointBalanceUnits)} points\nCurrent Reward Value: ≈ BDT ${result.customer.roundedRewardBdt}`
      );
      return;
    }
    if (type === "PURCHASE") {
      if (state.payload.purchaseAmountBdt === undefined) throw new Error("Purchase state is incomplete.");
      await context.telegram.sendMessage(
        chatId,
        purchaseSuccessMessage(result.customer, state.payload.purchaseAmountBdt, state.payload.pointUnits)
      );
    } else if (type === "MANUAL_ADD") {
      await context.telegram.sendMessage(
        chatId,
        manualAddSuccessMessage(result.customer, state.payload.pointUnits, state.payload.note ?? null)
      );
    } else {
      await context.telegram.sendMessage(
        chatId,
        redemptionSuccessMessage(result.customer, state.payload.pointUnits, result.transactionRewardRoundedBdt)
      );
    }
  } catch (error: unknown) {
    if (error instanceof DomainError && (error.code === "BALANCE_CONFLICT" || error.code === "INSUFFICIENT_BALANCE")) {
      await context.states.clear(state.administratorTelegramId);
      await context.telegram.sendMessage(
        chatId,
        `${BRAND}\n\n⚠️ The balance changed or is insufficient. No points were changed. Please start the operation again.`
      );
      return;
    }
    throw error;
  }
};

const handleExport = async (
  context: WorkflowContext,
  state: ConversationState,
  chatId: number,
  updateId: number,
  choice: string
): Promise<void> => {
  if (state.currentStep !== "SELECT_EXPORT" || !["c", "t", "a"].includes(choice)) {
    await stale(context, chatId);
    return;
  }
  const claimed = await context.idempotency.claim(updateId, "EXPORT");
  if (!claimed) {
    await context.telegram.sendMessage(chatId, `${BRAND}\n\nℹ️ This export request was already processed.`);
    return;
  }
  try {
    let progress = await context.idempotency.getExportProgress(updateId);
    if (
      (choice === "c" || choice === "a")
      && progress !== "CUSTOMERS_SENT"
      && progress !== "BOTH_SENT"
    ) {
      const file = await context.exports.customersCsv();
      await context.telegram.sendDocument(chatId, file.filename, file.contents, "SoulShop customer balances");
      progress = choice === "a" ? "CUSTOMERS_SENT" : "BOTH_SENT";
      await context.idempotency.setExportProgress(updateId, progress);
    }
    if (
      (choice === "t" || choice === "a")
      && progress !== "TRANSACTIONS_SENT"
      && progress !== "BOTH_SENT"
    ) {
      const file = await context.exports.transactionsCsv();
      await context.telegram.sendDocument(chatId, file.filename, file.contents, "SoulShop transaction history");
      progress = "BOTH_SENT";
      await context.idempotency.setExportProgress(updateId, progress);
    }
    await context.idempotency.complete(updateId);
    await context.states.clear(state.administratorTelegramId);
    await context.telegram.sendMessage(chatId, `${BRAND}\n\n✅ Export sent successfully.`);
  } catch (error: unknown) {
    await context.idempotency.fail(updateId);
    if (error instanceof DomainError && error.code === "EXPORT_TOO_LARGE") {
      await context.telegram.sendMessage(
        chatId,
        `${BRAND}\n\n⚠️ The export is too large for Telegram. No data was silently truncated.\n\nUse the Wrangler D1 export method documented in README.md.`
      );
      return;
    }
    throw error;
  }
};

export const handleCallback = async (
  context: WorkflowContext,
  adminId: string,
  chatId: number,
  updateId: number,
  data: string
): Promise<void> => {
  if (data === "help") {
    await context.telegram.sendMessage(chatId, helpMessage());
    return;
  }
  if (data === "cancel") {
    await context.states.clear(adminId);
    await context.telegram.sendMessage(
      chatId,
      `${BRAND}\n\n✅ The current operation was cancelled.\n\nWelcome to the SoulShop rewards management dashboard.`,
      { replyMarkup: dashboardKeyboard() }
    );
    return;
  }

  let match = /^begin:([PMRBAHE])$/.exec(data);
  if (match?.[1] !== undefined) {
    const operation = operationFromCode(match[1]);
    if (operation === null) return stale(context, chatId);
    await startOperation(context, adminId, chatId, operation, updateId);
    return;
  }

  match = /^mode:([sf]):([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const state = await stateForToken(context, adminId, chatId, match[2]);
    if (state === null || !["SELECT_MODE", "SHOW_RESULTS", "AWAIT_FULL_NUMBER"].includes(state.currentStep)) return;
    if (state.activeOperation === "ADD_CUSTOMER" || state.activeOperation === "EXPORT") {
      await stale(context, chatId);
      return;
    }
    const suffix = match[1] === "s";
    await context.states.save({
      ...state,
      currentStep: suffix ? "AWAIT_SEARCH" : "AWAIT_FULL_NUMBER",
      selectionMode: suffix ? "SUFFIX" : "FULL_NUMBER",
      selectedCustomerId: null,
      selectedWhatsappNumber: null,
      searchDigits: null,
      searchPage: 0
    });
    await context.telegram.sendMessage(
      chatId,
      suffix
        ? "Enter the last 4 or 5 digits of the customer's WhatsApp number."
        : "Enter the customer's complete WhatsApp number.\nSpaces and hyphens are accepted.",
      { replyMarkup: cancelKeyboard() }
    );
    return;
  }

  match = /^again:([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined) {
    const state = await stateForToken(context, adminId, chatId, match[1]);
    if (state === null || state.activeOperation === "ADD_CUSTOMER" || state.activeOperation === "EXPORT") return;
    await context.states.save({
      ...state,
      currentStep: "AWAIT_SEARCH",
      selectionMode: "SUFFIX",
      selectedCustomerId: null,
      selectedWhatsappNumber: null,
      searchDigits: null,
      searchPage: 0,
      payload: { token: newStateToken() }
    });
    await context.telegram.sendMessage(
      chatId,
      "Enter the last 4 or 5 digits of the customer's WhatsApp number.",
      { replyMarkup: cancelKeyboard() }
    );
    return;
  }

  match = /^pg:([A-Za-z0-9_-]{6,16}):(\d{1,6})$/.exec(data);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const state = await stateForToken(context, adminId, chatId, match[1]);
    const page = Number(match[2]);
    if (state === null || state.currentStep !== "SHOW_RESULTS" || !Number.isSafeInteger(page)) {
      await stale(context, chatId);
      return;
    }
    await showSearchResults(context, state, chatId, page);
    return;
  }

  match = /^sel:([A-Za-z0-9_-]{6,16}):(\d{1,15})$/.exec(data);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const state = await stateForToken(context, adminId, chatId, match[1]);
    const id = Number(match[2]);
    if (state === null || state.currentStep !== "SHOW_RESULTS" || !Number.isSafeInteger(id)) {
      await stale(context, chatId);
      return;
    }
    const customer = await context.customers.findById(id);
    if (customer === null || !selectMatchesCurrentSearch(state, customer.whatsappNumber)) {
      await stale(context, chatId);
      return;
    }
    await promptAfterSelection(context, state, customer, chatId);
    return;
  }

  match = /^create:([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined) {
    const state = await stateForToken(context, adminId, chatId, match[1]);
    if (
      state === null
      || state.currentStep !== "CONFIRM_CREATE_FOR_OPERATION"
      || state.payload.pendingPhone === undefined
      || (state.activeOperation !== "PURCHASE" && state.activeOperation !== "MANUAL_ADD")
    ) {
      await stale(context, chatId);
      return;
    }
    const phone = normalizePhone(state.payload.pendingPhone);
    const created = await context.customers.createZeroBalance(phone, updateId, new Date().toISOString());
    await promptAfterSelection(context, state, created.customer, chatId);
    return;
  }

  match = /^another:([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined) {
    const state = await stateForToken(context, adminId, chatId, match[1]);
    if (state === null || state.activeOperation !== "ADD_CUSTOMER") return;
    await context.states.save({
      ...state,
      currentStep: "AWAIT_ADD_CUSTOMER_NUMBER",
      selectedCustomerId: null,
      selectedWhatsappNumber: null,
      payload: { token: newStateToken() }
    });
    await context.telegram.sendMessage(
      chatId,
      `${BRAND}\n\nEnter the customer's WhatsApp number.\nSpaces and hyphens are accepted.`,
      { replyMarkup: cancelKeyboard() }
    );
    return;
  }

  match = /^skip:([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined) {
    const state = await stateForToken(context, adminId, chatId, match[1]);
    if (
      state === null
      || state.currentStep !== "AWAIT_NOTE"
      || state.activeOperation !== "MANUAL_ADD"
      || state.selectedCustomerId === null
      || state.payload.pointUnits === undefined
    ) {
      await stale(context, chatId);
      return;
    }
    const customer = await context.customers.findById(state.selectedCustomerId);
    if (customer === null) {
      await stale(context, chatId);
      return;
    }
    const payloadWithoutNote = {
      token: state.payload.token,
      pointUnits: state.payload.pointUnits,
      ...(state.payload.expectedBalanceUnits === undefined
        ? {}
        : { expectedBalanceUnits: state.payload.expectedBalanceUnits })
    };
    const saved = await context.states.save({
      ...state,
      currentStep: "CONFIRM_MANUAL_ADD",
      payload: payloadWithoutNote
    });
    await context.telegram.sendMessage(
      chatId,
      pointConfirmation(customer, "MANUAL_ADD", state.payload.pointUnits, null),
      { replyMarkup: confirmKeyboard(saved.payload.token, "✅ Confirm Point Addition") }
    );
    return;
  }

  match = /^confirm:([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined) {
    const state = await stateForToken(context, adminId, chatId, match[1]);
    if (state === null) return;
    if (state.currentStep === "CONFIRM_ADD_CUSTOMER" && state.payload.pendingPhone !== undefined) {
      const phone = normalizePhone(state.payload.pendingPhone);
      const result = await context.customers.createZeroBalance(phone, updateId, new Date().toISOString());
      await context.states.clear(adminId);
      if (result.created) {
        await context.telegram.sendMessage(chatId, addCustomerSuccessMessage(result.customer));
      } else {
        await context.telegram.sendMessage(
          chatId,
          `${BRAND}\n\nℹ️ This customer confirmation was already processed.\n\nCustomer: ${escapeHtml(result.customer.whatsappNumber)}`
        );
      }
      return;
    }
    await confirmMutation(context, state, chatId, updateId);
    return;
  }

  match = /^hist:([A-Za-z0-9_-]{6,16}):(\d{1,6})$/.exec(data);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const state = await stateForToken(context, adminId, chatId, match[1]);
    const page = Number(match[2]);
    if (
      state === null
      || state.currentStep !== "SHOW_HISTORY"
      || state.selectedCustomerId === null
      || !Number.isSafeInteger(page)
    ) {
      await stale(context, chatId);
      return;
    }
    const customer = await context.customers.findById(state.selectedCustomerId);
    if (customer === null) return stale(context, chatId);
    await showHistory(context, state, customer, chatId, page);
    return;
  }

  match = /^actions:([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined) {
    const state = await stateForToken(context, adminId, chatId, match[1]);
    if (state === null || state.selectedCustomerId === null) return stale(context, chatId);
    await context.telegram.sendMessage(chatId, `${BRAND}\n\nSelect a customer action:`, {
      replyMarkup: customerActionsKeyboard(state.payload.token)
    });
    return;
  }

  match = /^act:([PMRBH]):([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const state = await stateForToken(context, adminId, chatId, match[2]);
    const operation = operationFromCode(match[1]);
    if (state === null || operation === null || state.selectedCustomerId === null) return stale(context, chatId);
    const customer = await context.customers.findById(state.selectedCustomerId);
    if (customer === null) return stale(context, chatId);
    const next: ConversationState = {
      ...state,
      operationStartedUpdateId: updateId,
      activeOperation: operation,
      currentStep: "SELECT_MODE",
      searchDigits: null,
      searchPage: 0,
      payload: { token: newStateToken() }
    };
    await context.states.save(next);
    await promptAfterSelection(context, next, customer, chatId);
    return;
  }

  match = /^export:([A-Za-z0-9_-]{6,16}):([cta])$/.exec(data);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const state = await stateForToken(context, adminId, chatId, match[1]);
    if (state === null) return;
    await handleExport(context, state, chatId, updateId, match[2]);
    return;
  }

  await context.telegram.sendMessage(
    chatId,
    `${BRAND}\n\n⚠️ This button is malformed or no longer supported. Use /restart or /cancel.`
  );
};

import { DomainError } from "../domain/errors";
import { normalizePhone } from "../domain/phone";
import { leaderboardPeriods } from "../domain/leaderboard";
import { EARNING_POLICY_ID } from "../domain/rewards";
import { newStateToken } from "../database/state-repository";
import {
  backCancelKeyboard,
  cancelKeyboard,
  customerActionsKeyboard,
  dashboardKeyboard,
  confirmKeyboard,
  leaderboardMenuKeyboard,
  leaderboardPeriodsKeyboard,
  leaderboardResetKeyboard,
  leaderboardResultKeyboard,
  selectionKeyboard,
  skipNoteKeyboard
} from "../telegram/keyboards";
import {
  BRAND,
  BRAND_NAME_HTML,
  addCustomerSuccessMessage,
  fullNumberSearchPrompt,
  helpMessage,
  leaderboardMenuMessage,
  leaderboardMessage,
  leaderboardResetConfirmationMessage,
  leaderboardResetSuccessMessage,
  manualAddSuccessMessage,
  purchaseSuccessMessage,
  redemptionSuccessMessage,
  selectionMessage,
  suffixSearchPrompt
} from "../telegram/messages";
import type { ConversationState, LeaderboardPeriodType } from "../types/models";
import { editOrSendFallback, type ActiveMessageTarget } from "../telegram/active-message";
import type { InlineKeyboardMarkup } from "../telegram/types";
import {
  operationFromCode,
  pointConfirmation,
  promptAfterSelection,
  showHistory,
  showSearchResults,
  startOperation
} from "./common";
import type { WorkflowContext } from "./context";

const display = async (
  context: WorkflowContext,
  target: ActiveMessageTarget,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> => {
  await editOrSendFallback(context.telegram, target, text, replyMarkup);
};

const stale = async (context: WorkflowContext, target: ActiveMessageTarget): Promise<void> => {
  await display(
    context,
    target,
    `${BRAND}\n\n⚠️ This button is stale or does not match the current operation. Use /restart or /cancel.`
  );
};

const stateForToken = async (
  context: WorkflowContext,
  adminId: string,
  target: ActiveMessageTarget,
  token: string
): Promise<ConversationState | null> => {
  const result = await context.states.get(adminId);
  if (result.state === null) {
    await display(
      context,
      target,
      result.expired
        ? `${BRAND}\n\n⏱️ This operation expired. Please start again.`
        : `${BRAND}\n\n⚠️ There is no active operation. Use /start.`
    );
    return null;
  }
  if (result.state.payload.token !== token) {
    await stale(context, target);
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
  target: ActiveMessageTarget,
  updateId: number
): Promise<void> => {
  if (
    state.selectedCustomerId === null
    || state.payload.pointUnits === undefined
    || state.payload.expectedBalanceUnits === undefined
  ) {
    await stale(context, target);
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
    await stale(context, target);
    return;
  }
  if (state.activeOperation !== type) {
    await stale(context, target);
    return;
  }
  if (type === "PURCHASE" && state.payload.earningPolicyId !== EARNING_POLICY_ID) {
    await context.states.clear(state.administratorTelegramId);
    await display(
      context,
      target,
      `${BRAND}\n\n⚠️ The reward policy changed after this purchase was calculated. No points were changed. Please restart the purchase from the dashboard.`,
      dashboardKeyboard()
    );
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
    if (type === "PURCHASE") {
      if (state.payload.purchaseAmountBdt === undefined) throw new Error("Purchase state is incomplete.");
      await display(
        context,
        target,
        purchaseSuccessMessage(result.customer, state.payload.purchaseAmountBdt, state.payload.pointUnits)
      );
    } else if (type === "MANUAL_ADD") {
      await display(
        context,
        target,
        manualAddSuccessMessage(result.customer, state.payload.pointUnits, state.payload.note ?? null)
      );
    } else {
      await display(
        context,
        target,
        redemptionSuccessMessage(result.customer, state.payload.pointUnits, result.transactionRewardRoundedBdt)
      );
    }
    await context.states.clear(state.administratorTelegramId);
  } catch (error: unknown) {
    if (error instanceof DomainError && (error.code === "BALANCE_CONFLICT" || error.code === "INSUFFICIENT_BALANCE")) {
      await context.states.clear(state.administratorTelegramId);
      await display(
        context,
        target,
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
  target: ActiveMessageTarget,
  updateId: number,
  choice: string
): Promise<void> => {
  if (state.currentStep !== "SELECT_EXPORT" || !["c", "t", "a"].includes(choice)) {
    await stale(context, target);
    return;
  }
  const claimed = await context.idempotency.claim(updateId, "EXPORT");
  if (!claimed) {
    await display(context, target, `${BRAND}\n\nℹ️ This export request was already processed.`);
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
      await context.telegram.sendDocument(
        target.chatId,
        file.filename,
        file.contents,
        `${BRAND_NAME_HTML} customer balances`
      );
      progress = choice === "a" ? "CUSTOMERS_SENT" : "BOTH_SENT";
      await context.idempotency.setExportProgress(updateId, progress);
    }
    if (
      (choice === "t" || choice === "a")
      && progress !== "TRANSACTIONS_SENT"
      && progress !== "BOTH_SENT"
    ) {
      const file = await context.exports.transactionsCsv();
      await context.telegram.sendDocument(
        target.chatId,
        file.filename,
        file.contents,
        `${BRAND_NAME_HTML} transaction history`
      );
      progress = "BOTH_SENT";
      await context.idempotency.setExportProgress(updateId, progress);
    }
    await context.idempotency.complete(updateId);
    await display(context, target, `${BRAND}\n\n✅ Export sent successfully.`);
    await context.states.clear(state.administratorTelegramId);
  } catch (error: unknown) {
    await context.idempotency.fail(updateId);
    if (error instanceof DomainError && error.code === "EXPORT_TOO_LARGE") {
      await display(
        context,
        target,
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
  data: string,
  messageId: number | null
): Promise<void> => {
  const target: ActiveMessageTarget = { chatId, messageId };
  if (data === "help") {
    await display(context, target, helpMessage());
    return;
  }
  if (data === "cancel") {
    await context.states.clear(adminId);
    await display(
      context,
      target,
      `${BRAND}\n\n✅ The current operation was cancelled.\n\nWelcome to the ${BRAND_NAME_HTML} rewards management dashboard.`,
      dashboardKeyboard()
    );
    return;
  }

  let match = /^begin:([PMRBAHEL])$/.exec(data);
  if (match?.[1] !== undefined) {
    const operation = operationFromCode(match[1]);
    if (operation === null) return stale(context, target);
    await startOperation(context, adminId, chatId, operation, updateId, target);
    return;
  }

  match = /^lb:(w|m):([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const state = await stateForToken(context, adminId, target, match[2]);
    if (state === null || state.activeOperation !== "LEADERBOARD" || state.currentStep !== "LEADERBOARD_MENU") {
      await stale(context, target);
      return;
    }
    const type: LeaderboardPeriodType = match[1] === "w" ? "WEEK" : "MONTH";
    const periods = leaderboardPeriods(type);
    const saved = await context.states.save({
      ...state,
      currentStep: type === "WEEK" ? "LEADERBOARD_WEEKLY" : "LEADERBOARD_MONTHLY",
      payload: { token: state.payload.token }
    });
    await display(
      context,
      target,
      `${BRAND}\n\nSelect a ${type === "WEEK" ? "weekly" : "monthly"} leaderboard period:`,
      leaderboardPeriodsKeyboard(type, periods, saved.payload.token)
    );
    return;
  }

  match = /^lbv:(w|m):(\d):([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
    const state = await stateForToken(context, adminId, target, match[3]);
    const type: LeaderboardPeriodType = match[1] === "w" ? "WEEK" : "MONTH";
    const expectedStep = type === "WEEK" ? "LEADERBOARD_WEEKLY" : "LEADERBOARD_MONTHLY";
    const index = Number(match[2]);
    const periods = leaderboardPeriods(type);
    const period = periods[index];
    if (
      state === null
      || state.activeOperation !== "LEADERBOARD"
      || state.currentStep !== expectedStep
      || !Number.isSafeInteger(index)
      || period === undefined
    ) {
      await stale(context, target);
      return;
    }
    const entries = await context.leaderboards.list(period);
    await display(
      context,
      target,
      leaderboardMessage(period, entries),
      leaderboardResultKeyboard(type, index, state.payload.token)
    );
    return;
  }

  match = /^lb:back:([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined) {
    const state = await stateForToken(context, adminId, target, match[1]);
    if (
      state === null
      || state.activeOperation !== "LEADERBOARD"
      || state.currentStep === "CONFIRM_LEADERBOARD_RESET"
    ) {
      await stale(context, target);
      return;
    }
    const saved = await context.states.save({
      ...state,
      currentStep: "LEADERBOARD_MENU",
      payload: { token: state.payload.token }
    });
    await display(
      context,
      target,
      leaderboardMenuMessage(),
      leaderboardMenuKeyboard(saved.payload.token)
    );
    return;
  }

  match = /^lbr:(w|m):([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const state = await stateForToken(context, adminId, target, match[2]);
    if (state === null || state.activeOperation !== "LEADERBOARD" || state.currentStep !== "LEADERBOARD_MENU") {
      await stale(context, target);
      return;
    }
    const type: LeaderboardPeriodType = match[1] === "w" ? "WEEK" : "MONTH";
    const period = leaderboardPeriods(type)[0];
    if (period === undefined) throw new Error("Current leaderboard period is unavailable.");
    const saved = await context.states.save({
      ...state,
      currentStep: "CONFIRM_LEADERBOARD_RESET",
      payload: {
        token: newStateToken(),
        leaderboardResetType: type,
        leaderboardResetPeriodKey: period.key
      }
    });
    await display(
      context,
      target,
      leaderboardResetConfirmationMessage(type, period.label),
      leaderboardResetKeyboard(type, saved.payload.token)
    );
    return;
  }

  match = /^lbc:(w|m):([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const state = await stateForToken(context, adminId, target, match[2]);
    const type: LeaderboardPeriodType = match[1] === "w" ? "WEEK" : "MONTH";
    if (
      state === null
      || state.activeOperation !== "LEADERBOARD"
      || state.currentStep !== "CONFIRM_LEADERBOARD_RESET"
      || state.payload.leaderboardResetType !== type
      || state.payload.leaderboardResetPeriodKey === undefined
    ) {
      await stale(context, target);
      return;
    }
    const current = leaderboardPeriods(type)[0];
    if (current === undefined || current.key !== state.payload.leaderboardResetPeriodKey) {
      await context.states.clear(adminId);
      await stale(context, target);
      return;
    }
    const result = await context.leaderboards.resetCurrent(
      type,
      state.payload.leaderboardResetPeriodKey,
      updateId,
      adminId
    );
    await display(
      context,
      target,
      leaderboardResetSuccessMessage(type, result.period.label, result.duplicate),
      dashboardKeyboard()
    );
    await context.states.clear(adminId);
    return;
  }

  match = /^back:([sfanu]):([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const destination = match[1];
    const state = await stateForToken(context, adminId, target, match[2]);
    if (state === null) return;
    const nextToken = newStateToken();

    if (destination === "s") {
      const allowedSteps = [
        "AWAIT_SEARCH",
        "AWAIT_FULL_NUMBER",
        "SHOW_RESULTS",
        "SHOW_HISTORY",
        "AWAIT_PURCHASE_AMOUNT",
        "AWAIT_POINT_AMOUNT"
      ];
      if (
        !allowedSteps.includes(state.currentStep)
        || state.activeOperation === "ADD_CUSTOMER"
        || state.activeOperation === "EXPORT"
        || state.activeOperation === "LEADERBOARD"
      ) {
        await stale(context, target);
        return;
      }
      const saved = await context.states.save({
        ...state,
        currentStep: "SELECT_MODE",
        selectionMode: null,
        selectedCustomerId: null,
        selectedWhatsappNumber: null,
        searchDigits: null,
        searchPage: 0,
        payload: { token: nextToken }
      });
      await display(
        context,
        target,
        selectionMessage(state.activeOperation),
        selectionKeyboard(saved.payload.token)
      );
      return;
    }

    if (destination === "f") {
      if (
        state.currentStep !== "CONFIRM_CREATE_FOR_OPERATION"
        || (state.activeOperation !== "PURCHASE" && state.activeOperation !== "MANUAL_ADD")
      ) {
        await stale(context, target);
        return;
      }
      const saved = await context.states.save({
        ...state,
        currentStep: "AWAIT_FULL_NUMBER",
        selectionMode: "FULL_NUMBER",
        selectedCustomerId: null,
        selectedWhatsappNumber: null,
        searchDigits: null,
        searchPage: 0,
        payload: { token: nextToken }
      });
      await display(
        context,
        target,
        fullNumberSearchPrompt(state.activeOperation),
        backCancelKeyboard(saved.payload.token, "s")
      );
      return;
    }

    if (destination === "u") {
      if (state.activeOperation !== "ADD_CUSTOMER" || state.currentStep !== "CONFIRM_ADD_CUSTOMER") {
        await stale(context, target);
        return;
      }
      await context.states.save({
        ...state,
        currentStep: "AWAIT_ADD_CUSTOMER_NUMBER",
        selectionMode: null,
        selectedCustomerId: null,
        selectedWhatsappNumber: null,
        searchDigits: null,
        searchPage: 0,
        payload: { token: nextToken }
      });
      await display(
        context,
        target,
        `${BRAND}\n\n➕ <b>Add New Customer</b>\n\nEnter the customer's WhatsApp number.\nSpaces and hyphens are accepted.`,
        cancelKeyboard()
      );
      return;
    }

    if (destination === "n") {
      if (
        state.activeOperation !== "MANUAL_ADD"
        || state.currentStep !== "CONFIRM_MANUAL_ADD"
        || state.selectedCustomerId === null
        || state.payload.pointUnits === undefined
        || state.payload.expectedBalanceUnits === undefined
      ) {
        await stale(context, target);
        return;
      }
      const saved = await context.states.save({
        ...state,
        currentStep: "AWAIT_NOTE",
        payload: {
          token: nextToken,
          pointUnits: state.payload.pointUnits,
          expectedBalanceUnits: state.payload.expectedBalanceUnits
        }
      });
      await display(
        context,
        target,
        `${BRAND}\n\nEnter an optional note (maximum 500 characters), or tap Skip Note.`,
        skipNoteKeyboard(saved.payload.token)
      );
      return;
    }

    const amountStepMatches =
      (state.activeOperation === "PURCHASE" && state.currentStep === "CONFIRM_PURCHASE")
      || (state.activeOperation === "REDEEM" && state.currentStep === "CONFIRM_REDEEM")
      || (state.activeOperation === "MANUAL_ADD" && state.currentStep === "AWAIT_NOTE");
    if (!amountStepMatches || state.selectedCustomerId === null) {
      await stale(context, target);
      return;
    }
    const customer = await context.customers.findById(state.selectedCustomerId);
    if (customer === null) {
      await stale(context, target);
      return;
    }
    await promptAfterSelection(
      context,
      { ...state, payload: { token: nextToken } },
      customer,
      chatId,
      target
    );
    return;
  }

  match = /^mode:([sf]):([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const state = await stateForToken(context, adminId, target, match[2]);
    if (
      state === null
      || ![
        "SELECT_MODE",
        "SHOW_RESULTS",
        "AWAIT_FULL_NUMBER",
        "CONFIRM_CREATE_FOR_OPERATION"
      ].includes(state.currentStep)
    ) return;
    if (
      state.activeOperation === "ADD_CUSTOMER"
      || state.activeOperation === "EXPORT"
      || state.activeOperation === "LEADERBOARD"
    ) {
      await stale(context, target);
      return;
    }
    const suffix = match[1] === "s";
    const saved = await context.states.save({
      ...state,
      currentStep: suffix ? "AWAIT_SEARCH" : "AWAIT_FULL_NUMBER",
      selectionMode: suffix ? "SUFFIX" : "FULL_NUMBER",
      selectedCustomerId: null,
      selectedWhatsappNumber: null,
      searchDigits: null,
      searchPage: 0,
      payload: { token: newStateToken() }
    });
    await display(
      context,
      target,
      suffix
        ? suffixSearchPrompt(state.activeOperation)
        : fullNumberSearchPrompt(state.activeOperation),
      backCancelKeyboard(saved.payload.token, "s")
    );
    return;
  }

  match = /^again:([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined) {
    const state = await stateForToken(context, adminId, target, match[1]);
    if (
      state === null
      || state.activeOperation === "ADD_CUSTOMER"
      || state.activeOperation === "EXPORT"
      || state.activeOperation === "LEADERBOARD"
    ) return;
    const saved = await context.states.save({
      ...state,
      currentStep: "AWAIT_SEARCH",
      selectionMode: "SUFFIX",
      selectedCustomerId: null,
      selectedWhatsappNumber: null,
      searchDigits: null,
      searchPage: 0,
      payload: { token: newStateToken() }
    });
    await display(
      context,
      target,
      suffixSearchPrompt(state.activeOperation),
      backCancelKeyboard(saved.payload.token, "s")
    );
    return;
  }

  match = /^pg:([A-Za-z0-9_-]{6,16}):(\d{1,6})$/.exec(data);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const state = await stateForToken(context, adminId, target, match[1]);
    const page = Number(match[2]);
    if (state === null || state.currentStep !== "SHOW_RESULTS" || !Number.isSafeInteger(page)) {
      await stale(context, target);
      return;
    }
    await showSearchResults(context, state, chatId, page, target);
    return;
  }

  match = /^sel:([A-Za-z0-9_-]{6,16}):(\d{1,15})$/.exec(data);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const state = await stateForToken(context, adminId, target, match[1]);
    const id = Number(match[2]);
    if (state === null || state.currentStep !== "SHOW_RESULTS" || !Number.isSafeInteger(id)) {
      await stale(context, target);
      return;
    }
    const customer = await context.customers.findById(id);
    if (customer === null || !selectMatchesCurrentSearch(state, customer.whatsappNumber)) {
      await stale(context, target);
      return;
    }
    await promptAfterSelection(context, state, customer, chatId, target);
    return;
  }

  match = /^create:([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined) {
    const state = await stateForToken(context, adminId, target, match[1]);
    if (
      state === null
      || state.currentStep !== "CONFIRM_CREATE_FOR_OPERATION"
      || state.payload.pendingPhone === undefined
      || (state.activeOperation !== "PURCHASE" && state.activeOperation !== "MANUAL_ADD")
    ) {
      await stale(context, target);
      return;
    }
    const phone = normalizePhone(state.payload.pendingPhone);
    const created = await context.customers.createZeroBalance(phone, updateId, new Date().toISOString());
    await promptAfterSelection(context, state, created.customer, chatId, target);
    return;
  }

  match = /^another:([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined) {
    const state = await stateForToken(context, adminId, target, match[1]);
    if (state === null || state.activeOperation !== "ADD_CUSTOMER") return;
    await context.states.save({
      ...state,
      currentStep: "AWAIT_ADD_CUSTOMER_NUMBER",
      selectedCustomerId: null,
      selectedWhatsappNumber: null,
      payload: { token: newStateToken() }
    });
    await display(
      context,
      target,
      `${BRAND}\n\nEnter the customer's WhatsApp number.\nSpaces and hyphens are accepted.`,
      cancelKeyboard()
    );
    return;
  }

  match = /^skip:([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined) {
    const state = await stateForToken(context, adminId, target, match[1]);
    if (
      state === null
      || state.currentStep !== "AWAIT_NOTE"
      || state.activeOperation !== "MANUAL_ADD"
      || state.selectedCustomerId === null
      || state.payload.pointUnits === undefined
    ) {
      await stale(context, target);
      return;
    }
    const customer = await context.customers.findById(state.selectedCustomerId);
    if (customer === null) {
      await stale(context, target);
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
    await display(
      context,
      target,
      pointConfirmation(customer, "MANUAL_ADD", state.payload.pointUnits, null),
      confirmKeyboard(saved.payload.token, "✅ Confirm Point Addition", "n")
    );
    return;
  }

  match = /^redeemall:([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined) {
    const state = await stateForToken(context, adminId, target, match[1]);
    if (state === null) return;
    if (
      state.activeOperation !== "REDEEM"
      || state.currentStep !== "AWAIT_POINT_AMOUNT"
      || state.selectedCustomerId === null
    ) {
      await stale(context, target);
      return;
    }
    const customer = await context.customers.findById(state.selectedCustomerId);
    if (customer === null) {
      await stale(context, target);
      return;
    }
    if (customer.pointBalanceUnits === 0) {
      await display(
        context,
        target,
        `${BRAND}\n\n⚠️ This customer has no points available to redeem.`,
        backCancelKeyboard(state.payload.token, "s", "⬅️ Back to Customer Search")
      );
      return;
    }
    const saved = await context.states.save({
      ...state,
      currentStep: "CONFIRM_REDEEM",
      payload: {
        token: state.payload.token,
        pointUnits: customer.pointBalanceUnits,
        expectedBalanceUnits: customer.pointBalanceUnits
      }
    });
    await display(
      context,
      target,
      pointConfirmation(customer, "REDEEM", customer.pointBalanceUnits, null),
      confirmKeyboard(saved.payload.token, "✅ Confirm Redemption", "a")
    );
    return;
  }

  match = /^confirm:([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined) {
    const state = await stateForToken(context, adminId, target, match[1]);
    if (state === null) return;
    if (state.currentStep === "CONFIRM_ADD_CUSTOMER" && state.payload.pendingPhone !== undefined) {
      const phone = normalizePhone(state.payload.pendingPhone);
      const result = await context.customers.createZeroBalance(phone, updateId, new Date().toISOString());
      await display(context, target, addCustomerSuccessMessage(result.customer));
      await context.states.clear(adminId);
      return;
    }
    await confirmMutation(context, state, target, updateId);
    return;
  }

  match = /^hist:([A-Za-z0-9_-]{6,16}):(\d{1,6})$/.exec(data);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const state = await stateForToken(context, adminId, target, match[1]);
    const page = Number(match[2]);
    if (
      state === null
      || state.currentStep !== "SHOW_HISTORY"
      || state.selectedCustomerId === null
      || !Number.isSafeInteger(page)
    ) {
      await stale(context, target);
      return;
    }
    const customer = await context.customers.findById(state.selectedCustomerId);
    if (customer === null) return stale(context, target);
    await showHistory(context, state, customer, chatId, page, target);
    return;
  }

  match = /^actions:([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined) {
    const state = await stateForToken(context, adminId, target, match[1]);
    if (state === null || state.selectedCustomerId === null) return stale(context, target);
    await display(
      context,
      target,
      `${BRAND}\n\nSelect a customer action:`,
      customerActionsKeyboard(state.payload.token)
    );
    return;
  }

  match = /^act:([PMRBH]):([A-Za-z0-9_-]{6,16})$/.exec(data);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const state = await stateForToken(context, adminId, target, match[2]);
    const operation = operationFromCode(match[1]);
    if (state === null || operation === null || state.selectedCustomerId === null) return stale(context, target);
    const customer = await context.customers.findById(state.selectedCustomerId);
    if (customer === null) return stale(context, target);
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
    await promptAfterSelection(context, next, customer, chatId, target);
    return;
  }

  match = /^export:([A-Za-z0-9_-]{6,16}):([cta])$/.exec(data);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const state = await stateForToken(context, adminId, target, match[1]);
    if (state === null) return;
    await handleExport(context, state, target, updateId, match[2]);
    return;
  }

  await display(
    context,
    target,
    `${BRAND}\n\n⚠️ This button is malformed or no longer supported. Use /restart or /cancel.`
  );
};

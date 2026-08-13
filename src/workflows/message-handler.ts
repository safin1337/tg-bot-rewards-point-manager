import { DomainError } from "../domain/errors";
import { normalizePhone, validateSearchDigits } from "../domain/phone";
import { formatPointUnitsForDisplay, parsePointUnits, parsePurchaseAmount } from "../domain/points";
import { EARNING_POLICY_ID, purchaseToPointUnits, safeBalanceAfter } from "../domain/rewards";
import {
  addCustomerConfirmKeyboard,
  backCancelKeyboard,
  cancelKeyboard,
  createForOperationKeyboard,
  confirmKeyboard,
  existingCustomerKeyboard,
  missingCustomerKeyboard,
  skipNoteKeyboard
} from "../telegram/keyboards";
import { BRAND, existingCustomerMessage } from "../telegram/messages";
import { escapeHtml } from "../utils/html";
import type { ConversationState } from "../types/models";
import { pointConfirmation, promptAfterSelection, purchaseConfirmation, showSearchResults } from "./common";
import type { WorkflowContext } from "./context";

const friendlyDomainError = (error: DomainError): string => {
  if (error.code === "POINT_PRECISION") return "⚠️ Points may have no more than four decimal places.";
  if (error.code === "INSUFFICIENT_BALANCE") return "⚠️ This customer does not have enough points.";
  return `⚠️ ${escapeHtml(error.message)}`;
};

const handleFullPhone = async (
  context: WorkflowContext,
  state: ConversationState,
  chatId: number,
  text: string
): Promise<void> => {
  let phone;
  try {
    phone = normalizePhone(text);
  } catch (error: unknown) {
    if (!(error instanceof DomainError)) throw error;
    await context.telegram.sendMessage(chatId, `${BRAND}\n\n${friendlyDomainError(error)}`, {
      replyMarkup: backCancelKeyboard(state.payload.token, "s", "⬅️ Back to Search Options")
    });
    return;
  }
  const customer = await context.customers.findByPhone(phone.normalized);
  if (customer !== null) {
    await promptAfterSelection(context, state, customer, chatId);
    return;
  }
  if (state.activeOperation === "PURCHASE" || state.activeOperation === "MANUAL_ADD") {
    const saved = await context.states.save({
      ...state,
      currentStep: "CONFIRM_CREATE_FOR_OPERATION",
      selectedCustomerId: null,
      selectedWhatsappNumber: phone.normalized,
      payload: { token: state.payload.token, pendingPhone: phone.normalized }
    });
    await context.telegram.sendMessage(
      chatId,
      `${BRAND}\n\nCustomer Not Found\n\nCreate ${escapeHtml(phone.normalized)} with zero points and continue?`,
      { replyMarkup: createForOperationKeyboard(saved.payload.token) }
    );
    return;
  }
  await context.telegram.sendMessage(
    chatId,
    `${BRAND}\n\n⚠️ Customer Not Found\n\nNo customer is registered as ${escapeHtml(phone.normalized)}.`,
    { replyMarkup: missingCustomerKeyboard(state.payload.token) }
  );
};

const handleAddCustomerNumber = async (
  context: WorkflowContext,
  state: ConversationState,
  chatId: number,
  text: string
): Promise<void> => {
  let phone;
  try {
    phone = normalizePhone(text);
  } catch (error: unknown) {
    if (!(error instanceof DomainError)) throw error;
    await context.telegram.sendMessage(chatId, `${BRAND}\n\n${friendlyDomainError(error)}`, {
      replyMarkup: cancelKeyboard()
    });
    return;
  }
  const existing = await context.customers.findByPhone(phone.normalized);
  if (existing !== null) {
    const saved = await context.states.save({
      ...state,
      selectedCustomerId: existing.id,
      selectedWhatsappNumber: existing.whatsappNumber,
      payload: { token: state.payload.token }
    });
    await context.telegram.sendMessage(chatId, existingCustomerMessage(existing), {
      replyMarkup: existingCustomerKeyboard(saved.payload.token)
    });
    return;
  }
  const saved = await context.states.save({
    ...state,
    currentStep: "CONFIRM_ADD_CUSTOMER",
    selectedCustomerId: null,
    selectedWhatsappNumber: phone.normalized,
    payload: { token: state.payload.token, pendingPhone: phone.normalized }
  });
  await context.telegram.sendMessage(
    chatId,
    `${BRAND}\n\n<b>Confirm New Customer</b>\n\nCustomer: ${escapeHtml(phone.normalized)}\nStarting Points: 0.00 points\nStarting Reward Value: ≈ BDT 0`,
    { replyMarkup: addCustomerConfirmKeyboard(saved.payload.token) }
  );
};

export const handleStateMessage = async (
  context: WorkflowContext,
  state: ConversationState,
  chatId: number,
  text: string
): Promise<void> => {
  if (state.currentStep === "AWAIT_SEARCH") {
    let digits: string;
    try {
      digits = validateSearchDigits(text);
    } catch (error: unknown) {
      if (!(error instanceof DomainError)) throw error;
      await context.telegram.sendMessage(chatId, `${BRAND}\n\n${friendlyDomainError(error)}`, {
        replyMarkup: backCancelKeyboard(state.payload.token, "s", "⬅️ Back to Search Options")
      });
      return;
    }
    const saved = await context.states.save({
      ...state,
      searchDigits: digits,
      searchPage: 0,
      selectedCustomerId: null,
      selectedWhatsappNumber: null
    });
    await showSearchResults(context, saved, chatId, 0);
    return;
  }

  if (state.currentStep === "AWAIT_FULL_NUMBER") {
    await handleFullPhone(context, state, chatId, text);
    return;
  }

  if (state.currentStep === "AWAIT_ADD_CUSTOMER_NUMBER") {
    await handleAddCustomerNumber(context, state, chatId, text);
    return;
  }

  if (state.currentStep === "AWAIT_PURCHASE_AMOUNT") {
    if (state.selectedCustomerId === null) throw new Error("Selected customer is missing.");
    let amount: number;
    let units: number;
    try {
      amount = parsePurchaseAmount(text);
      units = purchaseToPointUnits(amount);
    } catch (error: unknown) {
      if (!(error instanceof DomainError)) throw error;
      await context.telegram.sendMessage(chatId, `${BRAND}\n\n${friendlyDomainError(error)}`, {
        replyMarkup: backCancelKeyboard(state.payload.token, "s", "⬅️ Back to Customer Search")
      });
      return;
    }
    const customer = await context.customers.findById(state.selectedCustomerId);
    if (customer === null) throw new Error("Customer not found.");
    safeBalanceAfter(customer.pointBalanceUnits, units);
    const saved = await context.states.save({
      ...state,
      currentStep: "CONFIRM_PURCHASE",
      payload: {
        token: state.payload.token,
        purchaseAmountBdt: amount,
        pointUnits: units,
        earningPolicyId: EARNING_POLICY_ID,
        expectedBalanceUnits: customer.pointBalanceUnits
      }
    });
    await context.telegram.sendMessage(chatId, purchaseConfirmation(customer, amount, units), {
      replyMarkup: confirmKeyboard(saved.payload.token, "✅ Confirm Purchase", "a")
    });
    return;
  }

  if (state.currentStep === "AWAIT_POINT_AMOUNT") {
    if (state.selectedCustomerId === null) throw new Error("Selected customer is missing.");
    let units: number;
    try {
      units = parsePointUnits(text);
    } catch (error: unknown) {
      if (!(error instanceof DomainError)) throw error;
      await context.telegram.sendMessage(chatId, `${BRAND}\n\n${friendlyDomainError(error)}`, {
        replyMarkup: backCancelKeyboard(state.payload.token, "s", "⬅️ Back to Customer Search")
      });
      return;
    }
    const customer = await context.customers.findById(state.selectedCustomerId);
    if (customer === null) throw new Error("Customer not found.");
    if (state.activeOperation === "REDEEM") {
      try {
        safeBalanceAfter(customer.pointBalanceUnits, -units);
      } catch (error: unknown) {
        if (!(error instanceof DomainError)) throw error;
        await context.telegram.sendMessage(
          chatId,
          `${BRAND}\n\n⚠️ Insufficient point balance.\n\nAvailable: ${formatPointUnitsForDisplay(customer.pointBalanceUnits)} points`,
          {
            replyMarkup: backCancelKeyboard(
              state.payload.token,
              "s",
              "⬅️ Back to Customer Search"
            )
          }
        );
        return;
      }
      const saved = await context.states.save({
        ...state,
        currentStep: "CONFIRM_REDEEM",
        payload: {
          token: state.payload.token,
          pointUnits: units,
          expectedBalanceUnits: customer.pointBalanceUnits
        }
      });
      await context.telegram.sendMessage(chatId, pointConfirmation(customer, "REDEEM", units, null), {
        replyMarkup: confirmKeyboard(saved.payload.token, "✅ Confirm Redemption", "a")
      });
      return;
    }
    if (state.activeOperation !== "MANUAL_ADD") throw new Error("Unexpected point operation.");
    await context.states.save({
      ...state,
      currentStep: "AWAIT_NOTE",
      payload: {
        token: state.payload.token,
        pointUnits: units,
        expectedBalanceUnits: customer.pointBalanceUnits
      }
    });
    await context.telegram.sendMessage(
      chatId,
      `${BRAND}\n\nEnter an optional note (maximum 500 characters), or tap Skip Note.`,
      { replyMarkup: skipNoteKeyboard(state.payload.token) }
    );
    return;
  }

  if (state.currentStep === "AWAIT_NOTE") {
    const note = text.trim();
    if (note.length === 0 || note.length > 500) {
      await context.telegram.sendMessage(
        chatId,
        `${BRAND}\n\n⚠️ Enter a note from 1 to 500 characters, or tap Skip Note.`,
        { replyMarkup: skipNoteKeyboard(state.payload.token) }
      );
      return;
    }
    if (state.selectedCustomerId === null || state.payload.pointUnits === undefined) {
      throw new Error("Manual addition state is incomplete.");
    }
    const customer = await context.customers.findById(state.selectedCustomerId);
    if (customer === null) throw new Error("Customer not found.");
    const saved = await context.states.save({
      ...state,
      currentStep: "CONFIRM_MANUAL_ADD",
      payload: { ...state.payload, note }
    });
    await context.telegram.sendMessage(
      chatId,
      pointConfirmation(customer, "MANUAL_ADD", state.payload.pointUnits, note),
      { replyMarkup: confirmKeyboard(saved.payload.token, "✅ Confirm Point Addition", "n") }
    );
    return;
  }

  await context.telegram.sendMessage(
    chatId,
    `${BRAND}\n\nPlease use one of the buttons for the current step, or use /restart or /cancel.`,
    { replyMarkup: cancelKeyboard() }
  );
};

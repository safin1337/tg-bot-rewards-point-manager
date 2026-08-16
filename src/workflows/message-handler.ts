import { DomainError } from "../domain/errors";
import { normalizePhone, validateSearchDigits } from "../domain/phone";
import {
  customerIdentifierValue,
  identifierDisplayValue,
  identifierInputValue,
  identifierTypeLabel,
  normalizeUsername,
  type CustomerIdentifierInput,
  type CustomerIdentifierType
} from "../domain/customer-identity";
import { formatPointUnitsForDisplay, parsePointUnits, parsePurchaseAmount } from "../domain/points";
import { EARNING_POLICY_ID, purchaseToPointUnits, safeBalanceAfter } from "../domain/rewards";
import { newStateToken } from "../database/state-repository";
import {
  addCustomerConfirmKeyboard,
  backCancelKeyboard,
  cancelKeyboard,
  createForOperationKeyboard,
  confirmKeyboard,
  existingCustomerKeyboard,
  identityChangeConfirmKeyboard,
  manageCustomerKeyboard,
  missingCustomerKeyboard,
  skipNoteKeyboard
} from "../telegram/keyboards";
import {
  BRAND,
  addCustomerConfirmationMessage,
  createCustomerForOperationConfirmationMessage,
  existingCustomerMessage,
  identityChangeConfirmationMessage,
  manageCustomerMessage
} from "../telegram/messages";
import { escapeHtml } from "../utils/html";
import type { ConversationState } from "../types/models";
import { pointConfirmation, promptAfterSelection, purchaseConfirmation, showSearchResults } from "./common";
import type { WorkflowContext } from "./context";

const friendlyDomainError = (error: DomainError): string => {
  if (error.code === "POINT_PRECISION") return "⚠️ Points may have no more than four decimal places.";
  if (error.code === "INSUFFICIENT_BALANCE") return "⚠️ This customer does not have enough points.";
  return `⚠️ ${escapeHtml(error.message)}`;
};

const parseIdentifier = (
  type: CustomerIdentifierType,
  text: string
): CustomerIdentifierInput => type === "WHATSAPP_PHONE"
  ? { type, phone: normalizePhone(text) }
  : { type, username: normalizeUsername(type, text) };

const handleExactIdentifier = async (
  context: WorkflowContext,
  state: ConversationState,
  chatId: number,
  text: string
): Promise<void> => {
  const type = state.selectionMode === "PHONE_FULL"
    ? "WHATSAPP_PHONE"
    : state.selectionMode === "WHATSAPP_USERNAME"
      ? "WHATSAPP_USERNAME"
      : state.selectionMode === "TELEGRAM_USERNAME"
        ? "TELEGRAM_USERNAME"
        : null;
  if (type === null) throw new Error("Exact identifier search mode is missing.");
  let identifier: CustomerIdentifierInput;
  try {
    identifier = parseIdentifier(type, text);
  } catch (error: unknown) {
    if (!(error instanceof DomainError)) throw error;
    await context.telegram.sendMessage(chatId, `${BRAND}\n\n${friendlyDomainError(error)}`, {
      replyMarkup: backCancelKeyboard(state.payload.token, "s")
    });
    return;
  }
  const customer = await context.customers.findByIdentifier(identifier);
  if (customer !== null) {
    await promptAfterSelection(context, state, customer, chatId);
    return;
  }
  if (state.activeOperation === "PURCHASE" || state.activeOperation === "MANUAL_ADD") {
    const saved = await context.states.save({
      ...state,
      currentStep: "CONFIRM_CREATE_FOR_OPERATION",
      selectedCustomerId: null,
      payload: {
        token: state.payload.token,
        pendingIdentifierType: type,
        pendingIdentifierValue: identifierInputValue(identifier)
      }
    });
    await context.telegram.sendMessage(
      chatId,
      createCustomerForOperationConfirmationMessage(identifier),
      { replyMarkup: createForOperationKeyboard(saved.payload.token) }
    );
    return;
  }
  await context.telegram.sendMessage(
    chatId,
    `${BRAND}\n\n⚠️ Customer Not Found\n\nNo customer is registered with that ${escapeHtml(identifierTypeLabel(type).toLowerCase())}.`,
    { replyMarkup: missingCustomerKeyboard(state.payload.token) }
  );
};

const handleAddCustomerIdentifier = async (
  context: WorkflowContext,
  state: ConversationState,
  chatId: number,
  text: string
): Promise<void> => {
  const type = state.currentStep === "AWAIT_ADD_CUSTOMER_NUMBER"
    ? "WHATSAPP_PHONE"
    : state.payload.pendingIdentifierType;
  if (type === undefined) throw new Error("New-customer identifier type is missing.");
  let identifier: CustomerIdentifierInput;
  try {
    identifier = parseIdentifier(type, text);
  } catch (error: unknown) {
    if (!(error instanceof DomainError)) throw error;
    await context.telegram.sendMessage(chatId, `${BRAND}\n\n${friendlyDomainError(error)}`, {
      replyMarkup: cancelKeyboard()
    });
    return;
  }
  const existing = await context.customers.findByIdentifier(identifier);
  if (existing !== null) {
    const saved = await context.states.save({
      ...state,
      selectedCustomerId: existing.id,
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
    payload: {
      token: state.payload.token,
      pendingIdentifierType: type,
      pendingIdentifierValue: identifierInputValue(identifier)
    }
  });
  await context.telegram.sendMessage(
    chatId,
    addCustomerConfirmationMessage(identifier),
    { replyMarkup: addCustomerConfirmKeyboard(saved.payload.token) }
  );
};

const handleManagedIdentifier = async (
  context: WorkflowContext,
  state: ConversationState,
  chatId: number,
  text: string
): Promise<void> => {
  if (state.selectedCustomerId === null || state.payload.pendingIdentifierType === undefined) {
    throw new Error("Customer identity state is incomplete.");
  }
  const type = state.payload.pendingIdentifierType;
  let identifier: CustomerIdentifierInput;
  try {
    identifier = parseIdentifier(type, text);
  } catch (error: unknown) {
    if (!(error instanceof DomainError)) throw error;
    await context.telegram.sendMessage(chatId, `${BRAND}\n\n${friendlyDomainError(error)}`, {
      replyMarkup: backCancelKeyboard(state.payload.token, "i", "⬅️ Back to Identity Management")
    });
    return;
  }
  const customer = await context.customers.findById(state.selectedCustomerId);
  if (customer === null) throw new DomainError("IDENTIFIER_STALE", "The selected customer no longer exists.");
  const owner = await context.customers.findByIdentifier(identifier);
  if (owner !== null && owner.id !== customer.id) {
    const saved = await context.states.save({
      ...state,
      currentStep: "MANAGE_CUSTOMER",
      payload: { token: newStateToken() }
    });
    await context.telegram.sendMessage(
      chatId,
      `${BRAND}\n\n⚠️ That ${escapeHtml(identifierTypeLabel(type).toLowerCase())} already belongs to Customer #${owner.id}.\n\nNo records were merged or changed.\n\n${manageCustomerMessage(customer).replace(`${BRAND}\n\n`, "")}`,
      { replyMarkup: manageCustomerKeyboard(customer, saved.payload.token) }
    );
    return;
  }
  const requested = identifierInputValue(identifier);
  const current = customerIdentifierValue(customer, type);
  if (current === requested) {
    const saved = await context.states.save({
      ...state,
      currentStep: "MANAGE_CUSTOMER",
      payload: { token: newStateToken() }
    });
    await context.telegram.sendMessage(
      chatId,
      `${BRAND}\n\nℹ️ This customer already uses ${escapeHtml(identifierDisplayValue(type, requested))}.\n\n${manageCustomerMessage(customer).replace(`${BRAND}\n\n`, "")}`,
      { replyMarkup: manageCustomerKeyboard(customer, saved.payload.token) }
    );
    return;
  }
  const saved = await context.states.save({
    ...state,
    currentStep: "CONFIRM_IDENTITY_CHANGE",
    payload: {
      token: state.payload.token,
      pendingIdentifierType: type,
      pendingIdentifierValue: requested,
      expectedIdentifierValue: current
    }
  });
  await context.telegram.sendMessage(
    chatId,
    identityChangeConfirmationMessage(customer, type, requested),
    { replyMarkup: identityChangeConfirmKeyboard(saved.payload.token) }
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
        replyMarkup: backCancelKeyboard(state.payload.token, "s")
      });
      return;
    }
    const saved = await context.states.save({
      ...state,
      searchQuery: digits,
      searchPage: 0,
      selectedCustomerId: null,
    });
    await showSearchResults(context, saved, chatId, 0);
    return;
  }

  if (state.currentStep === "AWAIT_FULL_NUMBER") {
    await handleExactIdentifier(context, state, chatId, text);
    return;
  }

  if (state.currentStep === "AWAIT_ADD_CUSTOMER_NUMBER") {
    await handleAddCustomerIdentifier(context, state, chatId, text);
    return;
  }

  if (state.currentStep === "AWAIT_ADD_CUSTOMER_IDENTITY") {
    await handleAddCustomerIdentifier(context, state, chatId, text);
    return;
  }

  if (state.currentStep === "AWAIT_IDENTITY_VALUE") {
    await handleManagedIdentifier(context, state, chatId, text);
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

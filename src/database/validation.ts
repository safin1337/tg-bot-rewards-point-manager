import type {
  ConversationState,
  Customer,
  LeaderboardEntry,
  LeaderboardPeriodType,
  MutationReceipt,
  Operation,
  RewardTransaction,
  StatePayload,
  TransactionType,
  WorkflowStep
} from "../types/models";
import type { CustomerIdentifierType } from "../domain/customer-identity";

type Row = Record<string, unknown>;

const objectRow = (value: unknown): Row => {
  if (typeof value !== "object" || value === null) throw new Error("Invalid database result.");
  return value as Row;
};

const stringField = (row: Row, key: string): string => {
  const value = row[key];
  if (typeof value !== "string") throw new Error("Invalid database result.");
  return value;
};

const nullableStringField = (row: Row, key: string): string | null => {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("Invalid database result.");
  return value;
};

const integerField = (row: Row, key: string): number => {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error("Invalid database result.");
  return value;
};

const nullableIntegerField = (row: Row, key: string): number | null => {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error("Invalid database result.");
  return value;
};

const nullableNonnegativeIntegerField = (row: Row, key: string): number | null => {
  const value = nullableIntegerField(row, key);
  if (value !== null && value < 0) throw new Error("Invalid database result.");
  return value;
};

const nullablePositiveIntegerField = (row: Row, key: string): number | null => {
  const value = nullableIntegerField(row, key);
  if (value !== null && value <= 0) throw new Error("Invalid database result.");
  return value;
};

const nonnegativeIntegerField = (row: Row, key: string): number => {
  const value = integerField(row, key);
  if (value < 0) throw new Error("Invalid database result.");
  return value;
};

const positiveIntegerField = (row: Row, key: string): number => {
  const value = integerField(row, key);
  if (value <= 0) throw new Error("Invalid database result.");
  return value;
};

const isoUtcField = (row: Row, key: string): string => {
  const value = stringField(row, key);
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new Error("Invalid database timestamp.");
  }
  return value;
};

const nullableNormalizedPhoneField = (row: Row, key: string): string | null => {
  const value = nullableStringField(row, key);
  if (value !== null && !/^\+[1-9]\d{6,14}$/.test(value)) {
    throw new Error("Invalid database phone.");
  }
  return value;
};

const nullableUsernameField = (row: Row, key: string): string | null => {
  const value = nullableStringField(row, key);
  if (value !== null && (value.length > 64 || !/^[A-Za-z0-9_]+$/.test(value))) {
    throw new Error("Invalid database username.");
  }
  return value;
};

const OPERATIONS: readonly Operation[] = [
  "PURCHASE", "MANUAL_ADD", "REDEEM", "BALANCE", "HISTORY", "ADD_CUSTOMER", "EXPORT",
  "LEADERBOARD", "MANAGE_CUSTOMER"
];
const STEPS: readonly WorkflowStep[] = [
  "SELECT_MODE", "AWAIT_SEARCH", "SHOW_RESULTS", "AWAIT_FULL_NUMBER",
  "CONFIRM_CREATE_FOR_OPERATION", "AWAIT_ADD_CUSTOMER_NUMBER", "CONFIRM_ADD_CUSTOMER",
  "AWAIT_PURCHASE_AMOUNT", "CONFIRM_PURCHASE", "AWAIT_POINT_AMOUNT", "AWAIT_NOTE",
  "CONFIRM_MANUAL_ADD", "CONFIRM_REDEEM", "SHOW_HISTORY", "SELECT_EXPORT",
  "LEADERBOARD_MENU", "LEADERBOARD_WEEKLY", "LEADERBOARD_MONTHLY",
  "CONFIRM_LEADERBOARD_RESET", "SELECT_ADD_CUSTOMER_IDENTITY",
  "AWAIT_ADD_CUSTOMER_IDENTITY", "MANAGE_CUSTOMER", "AWAIT_IDENTITY_VALUE",
  "CONFIRM_IDENTITY_CHANGE", "CONFIRM_IDENTITY_REMOVE"
];
const TRANSACTION_TYPES: readonly TransactionType[] = ["PURCHASE", "MANUAL_ADD", "REDEEM"];
const LEADERBOARD_PERIOD_TYPES: readonly LeaderboardPeriodType[] = ["WEEK", "MONTH"];

const enumField = <T extends string>(row: Row, key: string, values: readonly T[]): T => {
  const value = stringField(row, key);
  if (!values.includes(value as T)) throw new Error("Invalid database result.");
  return value as T;
};

const parsePayload = (json: string): StatePayload => {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new Error("Invalid conversation state.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid conversation state.");
  }
  const row = value as Row;
  if (typeof row.token !== "string" || !/^[A-Za-z0-9_-]{6,16}$/.test(row.token)) {
    throw new Error("Invalid conversation state.");
  }
  const payload: StatePayload = { token: row.token };
  for (const key of ["purchaseAmountBdt", "pointUnits", "expectedBalanceUnits"] as const) {
    const field = row[key];
    if (field !== undefined) {
      if (typeof field !== "number" || !Number.isSafeInteger(field) || field < 0) {
        throw new Error("Invalid conversation state.");
      }
      payload[key] = field;
    }
  }
  if (row.earningPolicyId !== undefined) {
    if (
      typeof row.earningPolicyId !== "string"
      || !/^earning:[A-Za-z0-9:._,|*-]+$/.test(row.earningPolicyId)
      || row.earningPolicyId.length > 500
    ) {
      throw new Error("Invalid conversation state.");
    }
    payload.earningPolicyId = row.earningPolicyId;
  }
  if (row.note !== undefined) {
    if (typeof row.note !== "string" || row.note.length === 0 || row.note.length > 500) {
      throw new Error("Invalid conversation state.");
    }
    payload.note = row.note;
  }
  if (row.pendingPhone !== undefined) {
    if (typeof row.pendingPhone !== "string" || !/^\+[1-9]\d{6,14}$/.test(row.pendingPhone)) {
      throw new Error("Invalid conversation state.");
    }
    payload.pendingPhone = row.pendingPhone;
  }
  if (row.pendingIdentifierType !== undefined) {
    const types: readonly CustomerIdentifierType[] = [
      "WHATSAPP_PHONE", "WHATSAPP_USERNAME", "TELEGRAM_USERNAME"
    ];
    if (
      typeof row.pendingIdentifierType !== "string"
      || !types.includes(row.pendingIdentifierType as CustomerIdentifierType)
    ) {
      throw new Error("Invalid conversation state.");
    }
    payload.pendingIdentifierType = row.pendingIdentifierType as CustomerIdentifierType;
  }
  if (row.pendingIdentifierValue !== undefined) {
    if (
      typeof row.pendingIdentifierValue !== "string"
      || row.pendingIdentifierValue.length === 0
      || row.pendingIdentifierValue.length > 64
    ) {
      throw new Error("Invalid conversation state.");
    }
    payload.pendingIdentifierValue = row.pendingIdentifierValue;
  }
  if (row.expectedIdentifierValue !== undefined) {
    if (
      row.expectedIdentifierValue !== null
      && (
        typeof row.expectedIdentifierValue !== "string"
        || row.expectedIdentifierValue.length === 0
        || row.expectedIdentifierValue.length > 64
      )
    ) {
      throw new Error("Invalid conversation state.");
    }
    payload.expectedIdentifierValue = row.expectedIdentifierValue;
  }
  if (row.leaderboardResetType !== undefined) {
    if (
      typeof row.leaderboardResetType !== "string"
      || !LEADERBOARD_PERIOD_TYPES.includes(row.leaderboardResetType as LeaderboardPeriodType)
    ) {
      throw new Error("Invalid conversation state.");
    }
    payload.leaderboardResetType = row.leaderboardResetType as LeaderboardPeriodType;
  }
  if (row.leaderboardResetPeriodKey !== undefined) {
    if (
      typeof row.leaderboardResetPeriodKey !== "string"
      || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(row.leaderboardResetPeriodKey)
    ) {
      throw new Error("Invalid conversation state.");
    }
    payload.leaderboardResetPeriodKey = row.leaderboardResetPeriodKey;
  }
  if (
    (payload.leaderboardResetType === undefined) !== (payload.leaderboardResetPeriodKey === undefined)
  ) {
    throw new Error("Invalid conversation state.");
  }
  return payload;
};

export const mapCustomer = (value: unknown): Customer => {
  const row = objectRow(value);
  const whatsappNumber = nullableNormalizedPhoneField(row, "whatsapp_number");
  const phoneLast4 = nullableStringField(row, "phone_last4");
  const phoneLast5 = nullableStringField(row, "phone_last5");
  const whatsappUsername = nullableUsernameField(row, "whatsapp_username");
  const telegramUsername = nullableUsernameField(row, "telegram_username");
  if (
    (whatsappNumber === null
      ? phoneLast4 !== null || phoneLast5 !== null
      : phoneLast4 !== whatsappNumber.slice(-4) || phoneLast5 !== whatsappNumber.slice(-5))
    || (whatsappNumber === null && whatsappUsername === null && telegramUsername === null)
  ) {
    throw new Error("Invalid database phone suffix.");
  }
  return {
    id: positiveIntegerField(row, "id"),
    whatsappNumber,
    phoneLast4,
    phoneLast5,
    whatsappUsername,
    telegramUsername,
    pointBalanceUnits: nonnegativeIntegerField(row, "point_balance_units"),
    roundedRewardBdt: nonnegativeIntegerField(row, "rounded_reward_bdt"),
    creationTelegramUpdateId: nullableNonnegativeIntegerField(row, "creation_telegram_update_id"),
    latestMutationTelegramUpdateId: nullableNonnegativeIntegerField(
      row,
      "latest_mutation_telegram_update_id"
    ),
    createdAtUtc: isoUtcField(row, "created_at_utc"),
    updatedAtUtc: isoUtcField(row, "updated_at_utc")
  };
};

export const mapTransaction = (value: unknown): RewardTransaction => {
  const row = objectRow(value);
  const transactionType = enumField(row, "transaction_type", TRANSACTION_TYPES);
  const purchaseAmountBdt = nullablePositiveIntegerField(row, "purchase_amount_bdt");
  const pointsDeltaUnits = integerField(row, "points_delta_units");
  const balanceBeforeUnits = nonnegativeIntegerField(row, "balance_before_units");
  const balanceAfterUnits = nonnegativeIntegerField(row, "balance_after_units");
  const note = nullableStringField(row, "note");
  if (
    (transactionType === "REDEEM" ? pointsDeltaUnits >= 0 : pointsDeltaUnits <= 0)
    || balanceBeforeUnits + pointsDeltaUnits !== balanceAfterUnits
    || (transactionType === "PURCHASE"
      ? purchaseAmountBdt === null || purchaseAmountBdt <= 0
      : purchaseAmountBdt !== null)
    || (note !== null && (note.length === 0 || note.length > 500))
  ) {
    throw new Error("Invalid database transaction.");
  }
  return {
    id: positiveIntegerField(row, "id"),
    customerId: positiveIntegerField(row, "customer_id"),
    transactionType,
    purchaseAmountBdt,
    pointsDeltaUnits,
    balanceBeforeUnits,
    balanceAfterUnits,
    roundedRewardBeforeBdt: nonnegativeIntegerField(row, "rounded_reward_before_bdt"),
    roundedRewardAfterBdt: nonnegativeIntegerField(row, "rounded_reward_after_bdt"),
    transactionRewardRoundedBdt: nonnegativeIntegerField(row, "transaction_reward_rounded_bdt"),
    note,
    telegramUpdateId: nonnegativeIntegerField(row, "telegram_update_id"),
    createdAtUtc: isoUtcField(row, "created_at_utc")
  };
};

export const mapMutationReceipt = (value: unknown): MutationReceipt => {
  const row = objectRow(value);
  const mutationType = enumField(row, "mutation_type", TRANSACTION_TYPES);
  const status = stringField(row, "status");
  const pointsDeltaUnits = integerField(row, "points_delta_units");
  const balanceBeforeUnits = nonnegativeIntegerField(row, "balance_before_units");
  const balanceAfterUnits = nonnegativeIntegerField(row, "balance_after_units");
  if (
    status !== "COMPLETED"
    || (mutationType === "REDEEM" ? pointsDeltaUnits >= 0 : pointsDeltaUnits <= 0)
    || balanceBeforeUnits + pointsDeltaUnits !== balanceAfterUnits
  ) {
    throw new Error("Invalid mutation receipt.");
  }
  return {
    telegramUpdateId: nonnegativeIntegerField(row, "telegram_update_id"),
    customerId: positiveIntegerField(row, "customer_id"),
    mutationType,
    pointsDeltaUnits,
    balanceBeforeUnits,
    balanceAfterUnits,
    roundedRewardBeforeBdt: nonnegativeIntegerField(row, "rounded_reward_before_bdt"),
    roundedRewardAfterBdt: nonnegativeIntegerField(row, "rounded_reward_after_bdt"),
    transactionRewardRoundedBdt: nonnegativeIntegerField(row, "transaction_reward_rounded_bdt"),
    completedAtUtc: isoUtcField(row, "completed_at_utc")
  };
};

export const mapLeaderboardEntry = (value: unknown): LeaderboardEntry => {
  const row = objectRow(value);
  return {
    customerId: positiveIntegerField(row, "customer_id"),
    whatsappNumber: nullableNormalizedPhoneField(row, "whatsapp_number"),
    whatsappUsername: nullableUsernameField(row, "whatsapp_username"),
    telegramUsername: nullableUsernameField(row, "telegram_username"),
    earnedPointUnits: positiveIntegerField(row, "earned_point_units"),
    firstQualifyingEarningAtUtc: isoUtcField(row, "first_qualifying_earning_at_utc")
  };
};

export const mapConversationState = (value: unknown): ConversationState => {
  const row = objectRow(value);
  const rawMode = nullableStringField(row, "selection_mode");
  if (
    rawMode !== null
    && rawMode !== "PHONE_SUFFIX"
    && rawMode !== "PHONE_FULL"
    && rawMode !== "WHATSAPP_USERNAME"
    && rawMode !== "TELEGRAM_USERNAME"
  ) {
    throw new Error("Invalid conversation state.");
  }
  const administratorTelegramId = stringField(row, "administrator_telegram_id");
  const searchQuery = nullableStringField(row, "search_query");
  if (
    !/^[1-9]\d*$/.test(administratorTelegramId)
    || (searchQuery !== null && (searchQuery.length === 0 || searchQuery.length > 64))
  ) {
    throw new Error("Invalid conversation state.");
  }
  return {
    administratorTelegramId,
    operationStartedUpdateId: nonnegativeIntegerField(row, "operation_started_update_id"),
    activeOperation: enumField(row, "active_operation", OPERATIONS),
    currentStep: enumField(row, "current_step", STEPS),
    selectionMode: rawMode,
    selectedCustomerId: nullablePositiveIntegerField(row, "selected_customer_id"),
    searchQuery,
    searchPage: nonnegativeIntegerField(row, "search_page"),
    payload: parsePayload(stringField(row, "payload_json")),
    createdAtUtc: isoUtcField(row, "created_at_utc"),
    updatedAtUtc: isoUtcField(row, "updated_at_utc"),
    expiresAtUtc: isoUtcField(row, "expires_at_utc")
  };
};

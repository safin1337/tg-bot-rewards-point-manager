export type TransactionType = "PURCHASE" | "MANUAL_ADD" | "REDEEM";
export type LeaderboardPeriodType = "WEEK" | "MONTH";

export interface Customer {
  id: number;
  whatsappNumber: string | null;
  phoneLast4: string | null;
  phoneLast5: string | null;
  whatsappUsername: string | null;
  telegramUsername: string | null;
  pointBalanceUnits: number;
  roundedRewardBdt: number;
  creationTelegramUpdateId: number | null;
  latestMutationTelegramUpdateId: number | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface RewardTransaction {
  id: number;
  customerId: number;
  transactionType: TransactionType;
  purchaseAmountBdt: number | null;
  pointsDeltaUnits: number;
  balanceBeforeUnits: number;
  balanceAfterUnits: number;
  roundedRewardBeforeBdt: number;
  roundedRewardAfterBdt: number;
  transactionRewardRoundedBdt: number;
  note: string | null;
  telegramUpdateId: number;
  createdAtUtc: string;
}

export interface MutationReceipt {
  telegramUpdateId: number;
  customerId: number;
  mutationType: TransactionType;
  pointsDeltaUnits: number;
  balanceBeforeUnits: number;
  balanceAfterUnits: number;
  roundedRewardBeforeBdt: number;
  roundedRewardAfterBdt: number;
  transactionRewardRoundedBdt: number;
  completedAtUtc: string;
}

export interface LeaderboardEntry {
  customerId: number;
  whatsappNumber: string | null;
  whatsappUsername: string | null;
  telegramUsername: string | null;
  earnedPointUnits: number;
  firstQualifyingEarningAtUtc: string;
}

export type Operation =
  | "PURCHASE"
  | "MANUAL_ADD"
  | "REDEEM"
  | "BALANCE"
  | "HISTORY"
  | "ADD_CUSTOMER"
  | "MANAGE_CUSTOMER"
  | "EXPORT"
  | "LEADERBOARD";

export type SelectionMode =
  | "PHONE_SUFFIX"
  | "PHONE_FULL"
  | "WHATSAPP_USERNAME"
  | "TELEGRAM_USERNAME";

export type WorkflowStep =
  | "SELECT_MODE"
  | "AWAIT_SEARCH"
  | "SHOW_RESULTS"
  | "AWAIT_FULL_NUMBER"
  | "CONFIRM_CREATE_FOR_OPERATION"
  | "AWAIT_ADD_CUSTOMER_NUMBER"
  | "CONFIRM_ADD_CUSTOMER"
  | "SELECT_ADD_CUSTOMER_IDENTITY"
  | "AWAIT_ADD_CUSTOMER_IDENTITY"
  | "MANAGE_CUSTOMER"
  | "AWAIT_IDENTITY_VALUE"
  | "CONFIRM_IDENTITY_CHANGE"
  | "CONFIRM_IDENTITY_REMOVE"
  | "AWAIT_PURCHASE_AMOUNT"
  | "CONFIRM_PURCHASE"
  | "AWAIT_POINT_AMOUNT"
  | "AWAIT_NOTE"
  | "CONFIRM_MANUAL_ADD"
  | "CONFIRM_REDEEM"
  | "SHOW_HISTORY"
  | "SELECT_EXPORT"
  | "LEADERBOARD_MENU"
  | "LEADERBOARD_WEEKLY"
  | "LEADERBOARD_MONTHLY"
  | "CONFIRM_LEADERBOARD_RESET";

export interface StatePayload {
  token: string;
  purchaseAmountBdt?: number;
  pointUnits?: number;
  earningPolicyId?: string;
  note?: string;
  expectedBalanceUnits?: number;
  pendingPhone?: string;
  pendingIdentifierType?: CustomerIdentifierType;
  pendingIdentifierValue?: string;
  expectedIdentifierValue?: string | null;
  leaderboardResetType?: LeaderboardPeriodType;
  leaderboardResetPeriodKey?: string;
}

export interface ConversationState {
  administratorTelegramId: string;
  operationStartedUpdateId: number;
  activeOperation: Operation;
  currentStep: WorkflowStep;
  selectionMode: SelectionMode | null;
  selectedCustomerId: number | null;
  searchQuery: string | null;
  searchPage: number;
  payload: StatePayload;
  createdAtUtc: string;
  updatedAtUtc: string;
  expiresAtUtc: string;
}
import type { CustomerIdentifierType } from "../domain/customer-identity";

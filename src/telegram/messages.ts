import {
  APP_CONFIG,
  deriveAppConfiguration,
  type AppConfiguration
} from "../config/app-config";
import { formatPointUnitsForDisplay } from "../domain/points";
import { formatLeaderboardPointUnits, type LeaderboardPeriod } from "../domain/leaderboard";
import type { Customer, LeaderboardEntry, LeaderboardPeriodType, Operation, RewardTransaction } from "../types/models";
import { escapeHtml } from "../utils/html";
import { formatDhakaDateTime } from "../utils/time";

export interface TelegramBranding {
  brandNameHtml: string;
  headingHtml: string;
  taglinesHtml: string;
}

export const telegramBrandingFromConfig = (config: AppConfiguration): TelegramBranding => {
  const runtime = deriveAppConfiguration(config);
  return {
    brandNameHtml: escapeHtml(runtime.brand.name),
    headingHtml: `🏆 <b>${escapeHtml(runtime.brand.fullHeading)}</b>`,
    taglinesHtml: runtime.brand.taglines.map(escapeHtml).join("\n")
  };
};

const TELEGRAM_BRANDING = telegramBrandingFromConfig(APP_CONFIG);

export const BRAND_NAME_HTML = TELEGRAM_BRANDING.brandNameHtml;
export const BRAND = TELEGRAM_BRANDING.headingHtml;
export const TAGLINES = TELEGRAM_BRANDING.taglinesHtml;

export const dashboardMessage = (): string =>
  `${BRAND}\n\nWelcome to the ${BRAND_NAME_HTML} rewards management dashboard.`;

type CustomerSelectionOperation = Exclude<Operation, "ADD_CUSTOMER" | "EXPORT" | "LEADERBOARD">;

const CUSTOMER_SELECTION_OPERATIONS = {
  PURCHASE: { emoji: "🛍️", label: "Record Purchase" },
  MANUAL_ADD: { emoji: "➕", label: "Add Points Manually" },
  REDEEM: { emoji: "🎁", label: "Redeem Points" },
  BALANCE: { emoji: "💰", label: "Check Balance" },
  HISTORY: { emoji: "📜", label: "Customer History" }
} satisfies Readonly<Record<CustomerSelectionOperation, { emoji: string; label: string }>>;

const customerSelectionHeading = (operation: CustomerSelectionOperation): string => {
  const details = CUSTOMER_SELECTION_OPERATIONS[operation];
  return `${details.emoji} <b>${details.label}</b>`;
};

export const selectionMessage = (operation: CustomerSelectionOperation): string =>
  `${BRAND}\n\n${customerSelectionHeading(operation)}\n\nSelect a customer:`;

const selectedOperationMessage = (
  operation: CustomerSelectionOperation,
  prompt: string
): string => {
  const details = CUSTOMER_SELECTION_OPERATIONS[operation];
  return `Selected Operation: ${details.emoji} ${details.label}\n\n${prompt}`;
};

export const suffixSearchPrompt = (operation: CustomerSelectionOperation): string =>
  selectedOperationMessage(
    operation,
    "Enter the last 4 or 5 digits of the WhatsApp No.\nTelegram / WhatsApp Username are not accepted"
  );

export const fullNumberSearchPrompt = (operation: CustomerSelectionOperation): string =>
  selectedOperationMessage(
    operation,
    "Enter the full WhatsApp number.\nSpaces and hyphens are accepted."
  );

const gcd = (left: bigint, right: bigint): bigint => {
  let a = left;
  let b = right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
};

const exactDecimalOrFraction = (numerator: number, denominator: number): string => {
  const divisor = gcd(BigInt(numerator), BigInt(denominator));
  const reducedNumerator = BigInt(numerator) / divisor;
  const reducedDenominator = BigInt(denominator) / divisor;
  let remainder = reducedDenominator;
  let twos = 0;
  let fives = 0;
  while (remainder % 2n === 0n) {
    twos += 1;
    remainder /= 2n;
  }
  while (remainder % 5n === 0n) {
    fives += 1;
    remainder /= 5n;
  }
  if (remainder !== 1n) return `${reducedNumerator}/${reducedDenominator}`;
  const scale = Math.max(twos, fives);
  const scaled = reducedNumerator * (10n ** BigInt(scale)) / reducedDenominator;
  if (scale === 0) return String(scaled);
  const digits = String(scaled).padStart(scale + 1, "0");
  const decimal = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return decimal.replace(/0+$/, "").replace(/\.$/, "");
};

export const helpMessageFromConfig = (config: AppConfiguration): string => {
  const runtime = deriveAppConfiguration(config);
  const branding = telegramBrandingFromConfig(config);
  const earning = runtime.rewards.earning;
  const formatBdt = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const earningHelp = earning.mode === "flat"
    ? `enter a positive whole-number BDT amount; every BDT ${earning.flat.spendBdt} earns ${earning.flat.earnPoints} ${earning.flat.earnPoints === 1 ? "point" : "points"}`
    : `enter a positive whole-number BDT amount; whole-order brackets apply (${earning.bracketed.brackets
      .map((bracket, index) => {
        const previousMax = index === 0
          ? 0
          : earning.bracketed.brackets[index - 1]?.maxPurchaseBdt ?? 0;
        const range = bracket.maxPurchaseBdt === null
          ? `BDT ${formatBdt(previousMax + 1)} and above`
          : `BDT ${formatBdt(previousMax + 1)}-${formatBdt(bracket.maxPurchaseBdt)}`;
        return `${range}: every BDT ${bracket.spendBdt} earns ${bracket.earnPoints} ${bracket.earnPoints === 1 ? "point" : "points"}`;
      })
      .join("; ")}); point-floor protection is ${earning.bracketed.pointFloorProtection ? "enabled" : "disabled"}`;
  const redemptionPointLabel = runtime.rewards.redemption.points === 1 ? "point" : "points";
  const redemptionVerb = runtime.rewards.redemption.points === 1 ? "equals" : "equal";
  const valuePerPoint = exactDecimalOrFraction(
    runtime.rewards.redemption.valueBdt,
    runtime.rewards.redemption.points
  );
  return `${branding.headingHtml}

<b>Help</b>

• /addcustomer — register a zero-point customer.
• For purchase, points, redemption, balance, or history, search with exactly the final 4 or 5 phone digits or enter the complete number.
• Spaces and supported hyphens are accepted in complete phone numbers.
• /purchase — ${earningHelp}. Any fractional points resulting from the calculation are retained and rounded half-up to four decimal places before storage.
• /addpoints — add a positive value with up to four decimal places and an optional note.
• /redeem — enter a positive value with up to four decimal places, or use Redeem All Points to select the exact stored balance; confirmation is still required.
• Telegram point amounts display with two decimals using standard half-up rounding.
• Stored point units retain exact precision: 1 point = 10,000 point units.
• ${runtime.rewards.redemption.points} ${redemptionPointLabel} ${redemptionVerb} BDT ${runtime.rewards.redemption.valueBdt} reward value. Equivalently, 1 point equals BDT ${valuePerPoint}.
• Displayed BDT reward values are rounded half-up using the existing reward rule.
• /balance — show the latest points and rounded reward value.
• /history — show newest transactions first.
• /export — send customer and/or transaction CSV files.
• /leaderboard — view weekly/monthly gross earned points or reset the current period.
• /cancel — cancel the active operation.
• /restart — restart the active operation from its first step.`;
};

export const helpMessage = (): string => helpMessageFromConfig(APP_CONFIG);

export const leaderboardMenuMessage = (): string => `${BRAND}

🏅 <b>Leaderboard</b>

Choose a weekly or monthly view, or reset the current period.`;

export const leaderboardMessage = (
  period: LeaderboardPeriod,
  entries: readonly LeaderboardEntry[]
): string => {
  const title = period.type === "WEEK" ? "Weekly" : "Monthly";
  const lines = entries.length === 0
    ? ["No qualifying points have been earned in this period."]
    : entries.map((entry, index) => {
      const rank = index + 1;
      const ordinal = rank === 1 ? "1st" : rank === 2 ? "2nd" : rank === 3 ? "3rd" : `${rank}th`;
      return `${ordinal} ${escapeHtml(entry.whatsappNumber)} — ${formatLeaderboardPointUnits(entry.earnedPointUnits)} points`;
    });
  return `🏆 <b>${BRAND_NAME_HTML} ${title} Leaderboard</b>
${escapeHtml(period.label)} — ${period.running ? "Running" : "Completed"}

${lines.join("\n")}`;
};

export const leaderboardResetConfirmationMessage = (
  type: LeaderboardPeriodType,
  periodLabel: string
): string => `${BRAND}

⚠️ <b>Reset Current ${type === "WEEK" ? "Weekly" : "Monthly"} Leaderboard?</b>

Period: ${escapeHtml(periodLabel)}

All points earned before this reset will be removed from the current ${type === "WEEK" ? "weekly" : "monthly"} ranking.
Customer balances and transaction history will not be changed.`;

export const leaderboardResetSuccessMessage = (
  type: LeaderboardPeriodType,
  periodLabel: string,
  duplicate: boolean
): string => `${BRAND}

${duplicate ? "ℹ️ This reset was already processed." : `✅ Current ${type === "WEEK" ? "weekly" : "monthly"} leaderboard reset successfully.`}

Period: ${escapeHtml(periodLabel)}
Customer balances and transaction history were not changed.`;

export const balanceMessage = (customer: Customer): string => `${BRAND}

🔍 <b>Reward Point Balance</b>

Customer: ${escapeHtml(customer.whatsappNumber)}

🎉 Congratulations!

Your current reward balance: ${formatPointUnitsForDisplay(customer.pointBalanceUnits)} points
Estimated reward value: BDT ${customer.roundedRewardBdt}

${TAGLINES}`;

export const purchaseSuccessMessage = (customer: Customer, amount: number, earned: number): string => `${BRAND}

✅ <b>Purchase Successfully Recorded</b>

Customer: ${escapeHtml(customer.whatsappNumber)}
Purchase Amount: BDT ${amount}
Points Earned: ${formatPointUnitsForDisplay(earned)} points

🎉 Congratulations!

Your updated reward balance: ${formatPointUnitsForDisplay(customer.pointBalanceUnits)} points
Estimated reward value: BDT ${customer.roundedRewardBdt}

${TAGLINES}`;

export const manualAddSuccessMessage = (customer: Customer, units: number, note: string | null): string => `${BRAND}

✅ <b>Reward Points Successfully Added</b>

Customer: ${escapeHtml(customer.whatsappNumber)}
Points Added: ${formatPointUnitsForDisplay(units)} points${note === null ? "" : `\nReason: ${escapeHtml(note)}`}

🎉 Congratulations!

Your updated reward balance: ${formatPointUnitsForDisplay(customer.pointBalanceUnits)} points
Estimated reward value: BDT ${customer.roundedRewardBdt}

${TAGLINES}`;

export const redemptionSuccessMessage = (
  customer: Customer,
  redeemedUnits: number,
  redeemedRewardBdt: number
): string => `${BRAND}

✅ <b>Reward Points Successfully Redeemed</b>

Customer: ${escapeHtml(customer.whatsappNumber)}

Reward amount redeemed: ${formatPointUnitsForDisplay(redeemedUnits)} points
Equivalent reward value: BDT ${redeemedRewardBdt}

Your remaining reward balance: ${formatPointUnitsForDisplay(customer.pointBalanceUnits)} points
Estimated remaining value: BDT ${customer.roundedRewardBdt}

${TAGLINES}`;

export const addCustomerSuccessMessage = (customer: Customer): string => `${BRAND}

✅ <b>Customer Successfully Added</b>

Customer: ${escapeHtml(customer.whatsappNumber)}
Current Points: 0.00 points
Current Reward Value: ≈ BDT 0

This customer can now be found using the last 4 or 5 digits.

`;

export const existingCustomerMessage = (customer: Customer): string => `${BRAND}

⚠️ This customer is already registered.

Customer: ${escapeHtml(customer.whatsappNumber)}
Current Points: ${formatPointUnitsForDisplay(customer.pointBalanceUnits)} points
Current Reward Value: ≈ BDT ${customer.roundedRewardBdt}`;

const transactionLabel = (transaction: RewardTransaction): string => {
  const signed = transaction.pointsDeltaUnits > 0
    ? `+${formatPointUnitsForDisplay(transaction.pointsDeltaUnits)}`
    : formatPointUnitsForDisplay(transaction.pointsDeltaUnits);
  return `${transaction.transactionType}: ${signed} points`;
};

export const historyMessage = (
  customer: Customer,
  transactions: readonly RewardTransaction[],
  page: number
): string => {
  const items = transactions.length === 0
    ? "No reward transactions have been recorded for this customer yet."
    : transactions.map((transaction) => {
      const details = [
        `<b>${escapeHtml(formatDhakaDateTime(transaction.createdAtUtc))}</b>`,
        transactionLabel(transaction),
        ...(transaction.purchaseAmountBdt === null ? [] : [`Purchase Amount: BDT ${transaction.purchaseAmountBdt}`]),
        `Balance Before: ${formatPointUnitsForDisplay(transaction.balanceBeforeUnits)} points`,
        `Balance After: ${formatPointUnitsForDisplay(transaction.balanceAfterUnits)} points`,
        `Reward Value After: ≈ BDT ${transaction.roundedRewardAfterBdt}`,
        ...(transaction.note === null ? [] : [`Note: ${escapeHtml(transaction.note)}`])
      ];
      return details.join("\n");
    }).join("\n\n");
  return `${BRAND}

📜 <b>Customer Reward History</b>

Customer: ${escapeHtml(customer.whatsappNumber)}
Current Points: ${formatPointUnitsForDisplay(customer.pointBalanceUnits)} points
Current Reward Value: ≈ BDT ${customer.roundedRewardBdt}
📄 Page: ${page + 1}/8

${items}

📄 Page: ${page + 1}/8`;
};

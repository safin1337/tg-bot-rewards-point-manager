import { formatPointUnitsForDisplay } from "../domain/points";
import { formatLeaderboardPointUnits, type LeaderboardPeriod } from "../domain/leaderboard";
import type { Customer, LeaderboardEntry, LeaderboardPeriodType, Operation, RewardTransaction } from "../types/models";
import { escapeHtml } from "../utils/html";
import { formatDhakaDateTime } from "../utils/time";

export const BRAND = "🏆 <b>SoulShop Rewards Point System</b>";
export const TAGLINES = "Buy More to Earn More\nThank you for purchasing from us\nBest Wishes from SoulShop";

export const dashboardMessage = (): string =>
  `${BRAND}\n\nWelcome to the SoulShop rewards management dashboard.`;

type CustomerSelectionOperation = Exclude<Operation, "ADD_CUSTOMER" | "EXPORT" | "LEADERBOARD">;

const CUSTOMER_SELECTION_HEADINGS = {
  PURCHASE: "🛒 <b>Record Purchase</b>",
  MANUAL_ADD: "➕ <b>Add Points Manually</b>",
  REDEEM: "🎁 <b>Redeem Points</b>",
  BALANCE: "💰 <b>Check Balance</b>",
  HISTORY: "📜 <b>Customer History</b>"
} satisfies Readonly<Record<CustomerSelectionOperation, string>>;

export const selectionMessage = (operation: CustomerSelectionOperation): string =>
  `${BRAND}\n\n${CUSTOMER_SELECTION_HEADINGS[operation]}\n\nSelect a customer:`;

export const helpMessage = (): string => `${BRAND}

<b>Help</b>

• /addcustomer — register a zero-point customer.
• For purchase, points, redemption, balance, or history, search with exactly the final 4 or 5 phone digits or enter the complete number.
• Spaces and supported hyphens are accepted in complete phone numbers.
• /purchase — every BDT 80 earns 1 point; fractional points are retained.
• /addpoints — add a positive value with up to four decimal places and an optional note.
• /redeem — redeem a positive value with up to four decimal places, never more than the balance.
• Telegram point amounts display with two decimals using standard half-up rounding; exact four-decimal precision is retained.
• Reward value is points × BDT 0.25 and the displayed BDT value is rounded half-up.
• /balance — show the latest points and rounded reward value.
• /history — show newest transactions first.
• /export — send customer and/or transaction CSV files.
• /leaderboard — view weekly/monthly gross earned points or reset the current period.
• /cancel — cancel the active operation.
• /restart — restart the active operation from its first step.

BDT 525 = 6.56 displayed points
Reward value ≈ BDT 2`;

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
  return `🏆 <b>SoulShop ${title} Leaderboard</b>
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

Your current reward point balance is ${formatPointUnitsForDisplay(customer.pointBalanceUnits)} points,
with a reward value of ≈ BDT ${customer.roundedRewardBdt}.

${TAGLINES}`;

export const purchaseSuccessMessage = (customer: Customer, amount: number, earned: number): string => `${BRAND}

✅ <b>Purchase Successfully Recorded</b>

Customer: ${escapeHtml(customer.whatsappNumber)}
Purchase Amount: BDT ${amount}
Points Earned: ${formatPointUnitsForDisplay(earned)} points

🎉 Congratulations!

Your current reward point balance is ${formatPointUnitsForDisplay(customer.pointBalanceUnits)} points,
with a reward value of ≈ BDT ${customer.roundedRewardBdt}.

${TAGLINES}`;

export const manualAddSuccessMessage = (customer: Customer, units: number, note: string | null): string => `${BRAND}

✅ <b>Reward Points Successfully Added</b>

Customer: ${escapeHtml(customer.whatsappNumber)}
Points Added: ${formatPointUnitsForDisplay(units)} points${note === null ? "" : `\nReason: ${escapeHtml(note)}`}

🎉 Congratulations!

Your current reward point balance is ${formatPointUnitsForDisplay(customer.pointBalanceUnits)} points,
with a reward value of ≈ BDT ${customer.roundedRewardBdt}.

${TAGLINES}`;

export const redemptionSuccessMessage = (
  customer: Customer,
  redeemedUnits: number,
  redeemedRewardBdt: number
): string => `${BRAND}

✅ <b>Reward Points Successfully Redeemed</b>

Customer: ${escapeHtml(customer.whatsappNumber)}

You have redeemed ${formatPointUnitsForDisplay(redeemedUnits)} points,
with a reward value of ≈ BDT ${redeemedRewardBdt}.

Your remaining reward point balance is ${formatPointUnitsForDisplay(customer.pointBalanceUnits)} points,
with a remaining reward value of ≈ BDT ${customer.roundedRewardBdt}.

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

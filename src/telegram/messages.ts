import { formatPointUnits } from "../domain/points";
import type { Customer, RewardTransaction } from "../types/models";
import { escapeHtml } from "../utils/html";
import { formatDhakaDateTime } from "../utils/time";

export const BRAND = "🏆 <b>SoulShop Rewards Point System</b>";
export const TAGLINES = "Buy More to Earn More\nThank you for purchasing from us\nBest Wishes from SoulShop";

export const dashboardMessage = (): string =>
  `${BRAND}\n\nWelcome to the SoulShop rewards management dashboard.`;

export const selectionMessage = (): string => `${BRAND}\n\nSelect a customer:`;

export const helpMessage = (): string => `${BRAND}

<b>Help</b>

• /addcustomer — register a zero-point customer.
• For purchase, points, redemption, balance, or history, search with exactly the final 4 or 5 phone digits or enter the complete number.
• Spaces and supported hyphens are accepted in complete phone numbers.
• /purchase — every BDT 80 earns 1 point; fractional points are retained.
• /addpoints — add a positive value with up to four decimal places and an optional note.
• /redeem — redeem a positive value with up to four decimal places, never more than the balance.
• Reward value is points × BDT 0.25 and the displayed BDT value is rounded half-up.
• /balance — show the latest points and rounded reward value.
• /history — show newest transactions first.
• /export — send customer and/or transaction CSV files.
• /cancel — cancel the active operation.
• /restart — restart the active operation from its first step.

BDT 525 = 6.5625 points
6.5625 points ≈ BDT 2 reward value`;

export const balanceMessage = (customer: Customer): string => `${BRAND}

🔍 <b>Reward Point Balance</b>

Customer: ${escapeHtml(customer.whatsappNumber)}

🎉 Congratulations!

Your current reward point balance is ${formatPointUnits(customer.pointBalanceUnits)} points,
with a reward value of ≈ BDT ${customer.roundedRewardBdt}.

${TAGLINES}`;

export const purchaseSuccessMessage = (customer: Customer, amount: number, earned: number): string => `${BRAND}

✅ <b>Purchase Successfully Recorded</b>

Customer: ${escapeHtml(customer.whatsappNumber)}
Purchase Amount: BDT ${amount}
Points Earned: ${formatPointUnits(earned)} points

🎉 Congratulations!

Your current reward point balance is ${formatPointUnits(customer.pointBalanceUnits)} points,
with a reward value of ≈ BDT ${customer.roundedRewardBdt}.

${TAGLINES}`;

export const manualAddSuccessMessage = (customer: Customer, units: number, note: string | null): string => `${BRAND}

✅ <b>Reward Points Successfully Added</b>

Customer: ${escapeHtml(customer.whatsappNumber)}
Points Added: ${formatPointUnits(units)} points${note === null ? "" : `\nReason: ${escapeHtml(note)}`}

🎉 Congratulations!

Your current reward point balance is ${formatPointUnits(customer.pointBalanceUnits)} points,
with a reward value of ≈ BDT ${customer.roundedRewardBdt}.

${TAGLINES}`;

export const redemptionSuccessMessage = (
  customer: Customer,
  redeemedUnits: number,
  redeemedRewardBdt: number
): string => `${BRAND}

✅ <b>Reward Points Successfully Redeemed</b>

Customer: ${escapeHtml(customer.whatsappNumber)}

You have redeemed ${formatPointUnits(redeemedUnits)} points,
with a reward value of ≈ BDT ${redeemedRewardBdt}.

Your remaining reward point balance is ${formatPointUnits(customer.pointBalanceUnits)} points,
with a remaining reward value of ≈ BDT ${customer.roundedRewardBdt}.

${TAGLINES}`;

export const addCustomerSuccessMessage = (customer: Customer): string => `${BRAND}

✅ <b>Customer Successfully Added</b>

Customer: ${escapeHtml(customer.whatsappNumber)}
Current Points: 0 points
Current Reward Value: ≈ BDT 0

This customer can now be found using the last 4 or 5 digits.

`;

export const existingCustomerMessage = (customer: Customer): string => `${BRAND}

⚠️ This customer is already registered.

Customer: ${escapeHtml(customer.whatsappNumber)}
Current Points: ${formatPointUnits(customer.pointBalanceUnits)} points
Current Reward Value: ≈ BDT ${customer.roundedRewardBdt}`;

const transactionLabel = (transaction: RewardTransaction): string => {
  const signed = transaction.pointsDeltaUnits > 0
    ? `+${formatPointUnits(transaction.pointsDeltaUnits)}`
    : formatPointUnits(transaction.pointsDeltaUnits);
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
        `Balance Before: ${formatPointUnits(transaction.balanceBeforeUnits)} points`,
        `Balance After: ${formatPointUnits(transaction.balanceAfterUnits)} points`,
        `Reward Value After: ≈ BDT ${transaction.roundedRewardAfterBdt}`,
        ...(transaction.note === null ? [] : [`Note: ${escapeHtml(transaction.note)}`])
      ];
      return details.join("\n");
    }).join("\n\n");
  return `${BRAND}

📜 <b>Customer Reward History</b>

Customer: ${escapeHtml(customer.whatsappNumber)}
Current Points: ${formatPointUnits(customer.pointBalanceUnits)} points
Current Reward Value: ≈ BDT ${customer.roundedRewardBdt}
Page: ${page + 1}

${items}

${TAGLINES}`;
};

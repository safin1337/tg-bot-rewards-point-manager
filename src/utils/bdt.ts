export const formatPurchaseAmountBdt = (value: number): string => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Purchase amount must be a positive safe integer.");
  }

  const digits = String(value);
  if (digits.length <= 3) return `${digits}.00`;

  const finalThree = digits.slice(-3);
  const leading = digits.slice(0, -3);
  const groupedLeading = leading.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${groupedLeading},${finalThree}.00`;
};

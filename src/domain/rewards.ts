import { DomainError } from "./errors";

export const POINT_UNITS_PER_POINT = 10_000;
export const POINT_UNITS_PER_BDT = 125;
export const POINT_UNITS_PER_REWARD_BDT = 40_000;
export const SQLITE_MAX_INTEGER = 9_007_199_254_740_991;

export const assertSafeNonnegativeInteger = (value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0 || value > SQLITE_MAX_INTEGER) {
    throw new DomainError("UNSAFE_INTEGER", "The value is outside the supported safe range.");
  }
};

export const purchaseToPointUnits = (purchaseAmountBdt: number): number => {
  if (!Number.isSafeInteger(purchaseAmountBdt) || purchaseAmountBdt <= 0) {
    throw new DomainError("INVALID_PURCHASE", "Enter a positive whole-number purchase amount in BDT.");
  }
  if (purchaseAmountBdt > Math.floor(SQLITE_MAX_INTEGER / POINT_UNITS_PER_BDT)) {
    throw new DomainError("UNSAFE_INTEGER", "The purchase amount is too large.");
  }
  const result = purchaseAmountBdt * POINT_UNITS_PER_BDT;
  assertSafeNonnegativeInteger(result);
  return result;
};

export const roundRewardBdt = (pointUnits: number): number => {
  assertSafeNonnegativeInteger(pointUnits);
  if (pointUnits > SQLITE_MAX_INTEGER - POINT_UNITS_PER_REWARD_BDT / 2) {
    throw new DomainError("UNSAFE_INTEGER", "The point balance is too large.");
  }
  return Math.floor((pointUnits + POINT_UNITS_PER_REWARD_BDT / 2) / POINT_UNITS_PER_REWARD_BDT);
};

export const safeBalanceAfter = (balance: number, delta: number): number => {
  assertSafeNonnegativeInteger(balance);
  if (!Number.isSafeInteger(delta)) {
    throw new DomainError("UNSAFE_INTEGER", "The point change is outside the supported safe range.");
  }
  const next = balance + delta;
  if (!Number.isSafeInteger(next) || next > SQLITE_MAX_INTEGER) {
    throw new DomainError("UNSAFE_INTEGER", "The resulting balance is outside the supported safe range.");
  }
  if (next < 0) {
    throw new DomainError("INSUFFICIENT_BALANCE", "The customer does not have enough points.");
  }
  return next;
};

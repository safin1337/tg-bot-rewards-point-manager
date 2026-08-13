import {
  APP_RUNTIME_CONFIG,
  type RuntimeEarningConfiguration
} from "../config/app-config";
import { DomainError } from "./errors";

export const POINT_UNITS_PER_POINT = 10_000;
export const POINT_UNITS_PER_REWARD_BDT = APP_RUNTIME_CONFIG.rewards.redemption.pointUnitsPerRewardBdt;
export const EARNING_POLICY_ID = APP_RUNTIME_CONFIG.rewards.earning.policyId;
export const SQLITE_MAX_INTEGER = 9_007_199_254_740_991;

export const assertSafeNonnegativeInteger = (value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0 || value > SQLITE_MAX_INTEGER) {
    throw new DomainError("UNSAFE_INTEGER", "The value is outside the supported safe range.");
  }
};

const halfUpPointUnits = (
  purchaseAmountBdt: number,
  spendBdt: number,
  earnPoints: number
): number => {
  const numerator = BigInt(purchaseAmountBdt) * BigInt(earnPoints) * BigInt(POINT_UNITS_PER_POINT);
  const denominator = BigInt(spendBdt);
  const result = (numerator * 2n + denominator) / (denominator * 2n);
  if (result <= 0n || result > BigInt(SQLITE_MAX_INTEGER)) {
    throw new DomainError("UNSAFE_INTEGER", "The purchase amount is too large.");
  }
  return Number(result);
};

export const purchaseToPointUnitsForPolicy = (
  purchaseAmountBdt: number,
  earning: RuntimeEarningConfiguration
): number => {
  if (!Number.isSafeInteger(purchaseAmountBdt) || purchaseAmountBdt <= 0) {
    throw new DomainError("INVALID_PURCHASE", "Enter a positive whole-number purchase amount in BDT.");
  }
  if (earning.mode === "flat") {
    return halfUpPointUnits(
      purchaseAmountBdt,
      earning.flat.spendBdt,
      earning.flat.earnPoints
    );
  }
  const bracket = earning.bracketed.brackets.find(
    (candidate) => candidate.maxPurchaseBdt === null || purchaseAmountBdt <= candidate.maxPurchaseBdt
  );
  if (bracket === undefined) throw new Error("The earning brackets are incomplete.");
  const calculated = halfUpPointUnits(purchaseAmountBdt, bracket.spendBdt, bracket.earnPoints);
  return earning.bracketed.pointFloorProtection
    ? Math.max(calculated, bracket.protectedFloorUnits)
    : calculated;
};

export const purchaseToPointUnits = (purchaseAmountBdt: number): number =>
  purchaseToPointUnitsForPolicy(purchaseAmountBdt, APP_RUNTIME_CONFIG.rewards.earning);

export const roundRewardBdt = (pointUnits: number): number => {
  assertSafeNonnegativeInteger(pointUnits);
  const units = BigInt(pointUnits);
  const unitsPerRewardBdt = BigInt(POINT_UNITS_PER_REWARD_BDT);
  return Number((units * 2n + unitsPerRewardBdt) / (unitsPerRewardBdt * 2n));
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

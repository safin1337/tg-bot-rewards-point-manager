import { DomainError } from "./errors";
import { POINT_UNITS_PER_POINT, SQLITE_MAX_INTEGER, assertSafeNonnegativeInteger } from "./rewards";

export const parsePointUnits = (input: string): number => {
  if (/^\d+\.\d{5,}$/.test(input)) {
    throw new DomainError("POINT_PRECISION", "Enter points with no more than four decimal places.");
  }
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(input);
  if (!match) {
    throw new DomainError("INVALID_POINTS", "Enter a positive point value with up to four decimal places.");
  }
  const wholeText = match[1];
  const fractionText = match[2] ?? "";
  if (wholeText === undefined) {
    throw new DomainError("INVALID_POINTS", "Enter a valid point value.");
  }
  const whole = Number(wholeText);
  if (!Number.isSafeInteger(whole) || whole > Math.floor(SQLITE_MAX_INTEGER / POINT_UNITS_PER_POINT)) {
    throw new DomainError("UNSAFE_INTEGER", "The point value is too large.");
  }
  const fraction = Number(fractionText.padEnd(4, "0") || "0");
  const units = whole * POINT_UNITS_PER_POINT + fraction;
  if (!Number.isSafeInteger(units) || units <= 0 || units > SQLITE_MAX_INTEGER) {
    throw new DomainError(units === 0 ? "INVALID_POINTS" : "UNSAFE_INTEGER", units === 0
      ? "Points must be greater than zero."
      : "The point value is too large.");
  }
  return units;
};

export const formatPointUnits = (units: number): string => {
  const negative = units < 0;
  const absolute = Math.abs(units);
  assertSafeNonnegativeInteger(absolute);
  const whole = Math.floor(absolute / POINT_UNITS_PER_POINT);
  const fraction = String(absolute % POINT_UNITS_PER_POINT).padStart(4, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
};

export const formatPointUnitsForDisplay = (units: number): string => {
  const negative = units < 0;
  const absolute = Math.abs(units);
  assertSafeNonnegativeInteger(absolute);
  const unitsPerHundredth = POINT_UNITS_PER_POINT / 100;
  const completeHundredths = Math.floor(absolute / unitsPerHundredth);
  const roundedHundredths = completeHundredths
    + (absolute % unitsPerHundredth >= unitsPerHundredth / 2 ? 1 : 0);
  const whole = Math.floor(roundedHundredths / 100);
  const fraction = String(roundedHundredths % 100).padStart(2, "0");
  const sign = negative && roundedHundredths !== 0 ? "-" : "";
  return `${sign}${whole}.${fraction}`;
};

export const parsePurchaseAmount = (input: string): number => {
  if (!/^\d+$/.test(input)) {
    throw new DomainError("INVALID_PURCHASE", "Enter a positive whole-number purchase amount in BDT.");
  }
  const value = Number(input);
  if (!Number.isSafeInteger(value) || value <= 0) {
    if (value === 0) {
      throw new DomainError("INVALID_PURCHASE", "Enter a purchase amount greater than zero.");
    }
    throw new DomainError("UNSAFE_INTEGER", "The purchase amount is too large.");
  }
  return value;
};

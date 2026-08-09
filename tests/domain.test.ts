import { describe, expect, it } from "vitest";
import { DomainError } from "../src/domain/errors";
import { cleanPhoneInput, normalizePhone, validateSearchDigits } from "../src/domain/phone";
import {
  formatPointUnits,
  formatPointUnitsForDisplay,
  parsePointUnits,
  parsePurchaseAmount
} from "../src/domain/points";
import {
  purchaseToPointUnits,
  roundRewardBdt,
  safeBalanceAfter,
  SQLITE_MAX_INTEGER
} from "../src/domain/rewards";

describe("reward calculations", () => {
  it.each([
    [1, 125, "0.0125"],
    [60, 7_500, "0.75"],
    [80, 10_000, "1"],
    [100, 12_500, "1.25"],
    [525, 65_625, "6.5625"]
  ])("converts BDT %i exactly", (bdt, units, points) => {
    expect(purchaseToPointUnits(bdt)).toBe(units);
    expect(formatPointUnits(units)).toBe(points);
  });

  it.each([
    [65_625, 2],
    [136_000, 3],
    [140_000, 4],
    [152_500, 4]
  ])("rounds %i point units half-up", (units, expected) => {
    expect(roundRewardBdt(units)).toBe(expected);
  });

  it("recalculates reward from the total instead of summing transaction rounding", () => {
    expect(roundRewardBdt(20_000) + roundRewardBdt(20_000)).toBe(2);
    expect(roundRewardBdt(40_000)).toBe(1);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER])("rejects unsafe purchase input %s", (value) => {
    expect(() => purchaseToPointUnits(value)).toThrow(DomainError);
  });

  it("prevents unsafe and negative balances", () => {
    expect(() => safeBalanceAfter(0, -1)).toThrow(/enough points/i);
    expect(() => safeBalanceAfter(SQLITE_MAX_INTEGER, 1)).toThrow(/safe range/i);
  });
});

describe("point parsing and formatting", () => {
  it.each([
    ["5", 50_000],
    ["5.5", 55_000],
    ["1.25", 12_500],
    ["6.5625", 65_625],
    ["0.0001", 1]
  ])("parses %s directly into integer units", (input, units) => {
    expect(parsePointUnits(input)).toBe(units);
  });

  it.each(["0", "-1", "1.", ".5", "1,25", "abc", "NaN", "Infinity", " 5"])(
    "rejects malformed point value %s",
    (input) => expect(() => parsePointUnits(input)).toThrow(DomainError)
  );

  it("distinguishes excessive decimal precision", () => {
    expect(() => parsePointUnits("1.23456")).toThrow(
      expect.objectContaining({ code: "POINT_PRECISION" })
    );
  });

  it.each([
    [50_000, "5"],
    [55_000, "5.5"],
    [12_500, "1.25"],
    [65_625, "6.5625"],
    [1, "0.0001"],
    [-80_000, "-8"]
  ])("formats %i without scientific notation", (units, expected) => {
    const formatted = formatPointUnits(units);
    expect(formatted).toBe(expected);
    expect(formatted).not.toMatch(/e/i);
  });

  it.each([
    [41_200, "4.12"],
    [41_230, "4.12"],
    [41_249, "4.12"],
    [41_250, "4.13"],
    [41_260, "4.13"],
    [45_000, "4.50"],
    [10_000, "1.00"],
    [49, "0.00"],
    [50, "0.01"],
    [-49, "0.00"],
    [-41_250, "-4.13"],
    [2_883_625, "288.36"],
    [SQLITE_MAX_INTEGER, "900719925474.10"]
  ])("formats %i point units for two-decimal display", (units, expected) => {
    expect(formatPointUnitsForDisplay(units)).toBe(expected);
  });

  it.each([["525", 525], ["0001", 1]])("parses whole BDT %s", (input, expected) => {
    expect(parsePurchaseAmount(input)).toBe(expected);
  });

  it.each(["0", "-1", "1.5", "1.", "abc", " 5"])("rejects invalid BDT %s", (input) => {
    expect(() => parsePurchaseAmount(input)).toThrow(DomainError);
  });
});

describe("phone cleaning and normalization", () => {
  it.each([
    ["+20 10 63240739", "+201063240739"],
    ["+880 1874-734769", "+8801874734769"],
    ["+27 60 830 5954", "+27608305954"],
    ["01712 345-678", "+8801712345678"],
    ["8801712345678", "+8801712345678"],
    ["+8801712345678", "+8801712345678"]
  ])("normalizes %s", (input, expected) => {
    expect(normalizePhone(input).normalized).toBe(expected);
  });

  it("removes tabs, line breaks, Unicode whitespace, and every supported dash", () => {
    const input = "+880\t17\n12\u00A0345-\u201067\u20118\u20129\u20130\u20141\u22122";
    expect(cleanPhoneInput(input)).toBe("+88017123456789012");
  });

  it.each(["", "   ", "+880abc", "01712(345)678", "12+345678", "++201063240739"])(
    "rejects invalid characters in %s",
    (input) => expect(() => normalizePhone(input)).toThrow(DomainError)
  );

  it.each(["01212345678", "0171234567", "+8801212345678", "+880171234567"])(
    "rejects invalid Bangladesh number %s",
    (input) => expect(() => normalizePhone(input)).toThrow(DomainError)
  );

  it.each(["+201063240739", "+27608305954", "+14155552671"])(
    "accepts practical E.164 number %s",
    (input) => expect(normalizePhone(input).normalized).toBe(input)
  );

  it("generates indexed suffixes", () => {
    expect(normalizePhone("+8801712344567")).toMatchObject({ last4: "4567", last5: "44567" });
  });

  it.each(["1234", "12345"])("accepts valid search digits %s", (input) => {
    expect(validateSearchDigits(input)).toBe(input);
  });

  it.each(["123", "123456", "12 34", "abcd", "+1234"])("rejects invalid search %s", (input) => {
    expect(() => validateSearchDigits(input)).toThrow(DomainError);
  });
});

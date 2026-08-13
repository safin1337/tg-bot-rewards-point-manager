import { describe, expect, it } from "vitest";
import {
  APP_CONFIG,
  APP_RUNTIME_CONFIG,
  createBrandFilenameSlug,
  deriveAppConfiguration,
  type AppConfiguration,
  type EarningMode
} from "../src/config/app-config";
import { helpMessageFromConfig, telegramBrandingFromConfig } from "../src/telegram/messages";

const customizedConfig = {
  brand: {
    name: "Example & Sons <Store>",
    heading: "Customer Loyalty Program",
    taglines: [
      "Welcome to {brand}",
      "A separately editable line",
      "<b>Not Telegram markup</b>"
    ]
  },
  rewards: {
    earning: {
      ...APP_CONFIG.rewards.earning,
      mode: "flat",
      flat: {
        policyId: "example-flat-v1",
        spendBdt: 100,
        earnPoints: 1
      }
    },
    redemption: { points: 4, valueBdt: 1 }
  }
} as const satisfies AppConfiguration;

const expectedConfiguredPolicyId = (mode: EarningMode): string => mode === "flat"
  ? "earning:flat:flat-50-v1:50:1:round-half-up-4"
  : "earning:bracketed:bracketed-50-60-70-80-100-v1:floor-on:" +
    "2000,50,1|4000,60,1|6000,70,1|25000,80,1|infinite,100,1:" +
    "round-half-up-4";

describe("central application configuration", () => {
  it("retains SoulShop as the default brand and generates its heading and closing line", () => {
    expect(APP_CONFIG.brand.name).toBe("SoulShop");
    expect(APP_RUNTIME_CONFIG.brand.fullHeading).toBe("SoulShop Rewards Point System");
    expect(APP_RUNTIME_CONFIG.brand.taglines).toEqual([
      "Buy More to Earn More",
      "Thank you for purchasing from us",
      "Best Wishes from SoulShop"
    ]);
  });

  it("supports an alternative brand, heading, placeholder, and independently editable taglines", () => {
    const runtime = deriveAppConfiguration(customizedConfig);
    expect(runtime.brand.fullHeading).toBe("Example & Sons <Store> Customer Loyalty Program");
    expect(runtime.brand.taglines).toEqual([
      "Welcome to Example & Sons <Store>",
      "A separately editable line",
      "<b>Not Telegram markup</b>"
    ]);
  });

  it("allows the application heading to change independently of the default brand", () => {
    const runtime = deriveAppConfiguration({
      ...APP_CONFIG,
      brand: { ...APP_CONFIG.brand, heading: "Customer Loyalty Program" }
    });
    expect(runtime.brand.fullHeading).toBe("SoulShop Customer Loyalty Program");
  });

  it("escapes every configurable branding value before Telegram HTML insertion", () => {
    const branding = telegramBrandingFromConfig(customizedConfig);
    expect(branding.headingHtml).toBe(
      "🏆 <b>Example &amp; Sons &lt;Store&gt; Customer Loyalty Program</b>"
    );
    expect(branding.taglinesHtml).toContain("Welcome to Example &amp; Sons &lt;Store&gt;");
    expect(branding.taglinesHtml).toContain("&lt;b&gt;Not Telegram markup&lt;/b&gt;");
    expect(branding.taglinesHtml).not.toContain("<Store>");
    expect(branding.taglinesHtml).not.toContain("<b>Not Telegram markup</b>");
  });

  it.each([
    ["SoulShop", "soulshop"],
    ["Example Store", "example-store"],
    ["Example & Sons <Store>", "example-sons-store"],
    ["বাংলা", "loyalty-rewards"]
  ])("creates a safe filename slug for %s", (brand, expected) => {
    expect(createBrandFilenameSlug(brand)).toBe(expected);
  });

  it("derives both policies and follows the mode selected in APP_CONFIG", () => {
    expect(APP_RUNTIME_CONFIG.rewards.earning).toMatchObject({
      mode: APP_CONFIG.rewards.earning.mode,
      flat: {
        policyId: "flat-50-v1",
        spendBdt: 50,
        earnPoints: 1
      },
      bracketed: {
        policyId: "bracketed-50-60-70-80-100-v1",
        pointFloorProtection: true
      }
    });
    expect(APP_RUNTIME_CONFIG.rewards.earning.policyId).toBe(
      expectedConfiguredPolicyId(APP_RUNTIME_CONFIG.rewards.earning.mode)
    );
    expect(APP_RUNTIME_CONFIG.rewards.redemption).toMatchObject({
      points: 4,
      valueBdt: 1,
      pointUnitsPerRewardBdt: 40_000
    });
  });

  it("derives recursive point floors from the configured bracket boundaries", () => {
    expect(APP_RUNTIME_CONFIG.rewards.earning.bracketed.brackets).toEqual([
      { maxPurchaseBdt: 2_000, spendBdt: 50, earnPoints: 1, protectedFloorUnits: 0 },
      { maxPurchaseBdt: 4_000, spendBdt: 60, earnPoints: 1, protectedFloorUnits: 400_000 },
      { maxPurchaseBdt: 6_000, spendBdt: 70, earnPoints: 1, protectedFloorUnits: 666_667 },
      { maxPurchaseBdt: 25_000, spendBdt: 80, earnPoints: 1, protectedFloorUnits: 857_143 },
      { maxPurchaseBdt: null, spendBdt: 100, earnPoints: 1, protectedFloorUnits: 3_125_000 }
    ]);
  });

  it.each([
    { policyId: "bad id", spendBdt: 50, earnPoints: 1 },
    { policyId: "flat", spendBdt: 0, earnPoints: 1 },
    { policyId: "flat", spendBdt: 50, earnPoints: 0 },
    { policyId: "flat", spendBdt: 1.5, earnPoints: 1 },
    { policyId: "flat", spendBdt: 1, earnPoints: Number.MAX_SAFE_INTEGER }
  ])("rejects an invalid or unsupported flat policy", (flat) => {
    const invalid: AppConfiguration = {
      ...APP_CONFIG,
      rewards: {
        ...APP_CONFIG.rewards,
        earning: { ...APP_CONFIG.rewards.earning, flat }
      }
    };
    expect(() => deriveAppConfiguration(invalid)).toThrow();
  });

  it("rejects unordered, bounded-final, and early-unbounded bracket sets", () => {
    const invalidBracketSets = [
      [
        { maxPurchaseBdt: 2_000, spendBdt: 50, earnPoints: 1 },
        { maxPurchaseBdt: 2_000, spendBdt: 60, earnPoints: 1 },
        { maxPurchaseBdt: null, spendBdt: 100, earnPoints: 1 }
      ],
      [{ maxPurchaseBdt: 2_000, spendBdt: 50, earnPoints: 1 }],
      [
        { maxPurchaseBdt: null, spendBdt: 50, earnPoints: 1 },
        { maxPurchaseBdt: null, spendBdt: 100, earnPoints: 1 }
      ]
    ] as const;
    for (const brackets of invalidBracketSets) {
      const invalid: AppConfiguration = {
        ...APP_CONFIG,
        rewards: {
          ...APP_CONFIG.rewards,
          earning: {
            ...APP_CONFIG.rewards.earning,
            bracketed: { ...APP_CONFIG.rewards.earning.bracketed, brackets }
          }
        }
      };
      expect(() => deriveAppConfiguration(invalid)).toThrow();
    }
  });

  it("rejects a malformed non-array bracket configuration", () => {
    const invalid = {
      ...APP_CONFIG,
      rewards: {
        ...APP_CONFIG.rewards,
        earning: {
          ...APP_CONFIG.rewards.earning,
          bracketed: {
            ...APP_CONFIG.rewards.earning.bracketed,
            brackets: "not-an-array"
          }
        }
      }
    } as unknown as AppConfiguration;
    expect(() => deriveAppConfiguration(invalid)).toThrow(/brackets must be an array/i);
  });

  const configForMode = (mode: "flat" | "bracketed"): AppConfiguration => ({
    ...APP_CONFIG,
    rewards: {
      ...APP_CONFIG.rewards,
      earning: { ...APP_CONFIG.rewards.earning, mode }
    }
  });

  const earningPolicyId = (config: AppConfiguration): string =>
    deriveAppConfiguration(config).rewards.earning.policyId;

  it("changes the active fingerprint when the mode changes", () => {
    expect(earningPolicyId(configForMode("flat"))).not.toBe(
      earningPolicyId(configForMode("bracketed"))
    );
  });

  it("changes the flat fingerprint when the active flat rate changes", () => {
    const base = configForMode("flat");
    const changed: AppConfiguration = {
      ...base,
      rewards: {
        ...base.rewards,
        earning: {
          ...base.rewards.earning,
          flat: { ...base.rewards.earning.flat, spendBdt: 60 }
        }
      }
    };
    expect(earningPolicyId(changed)).not.toBe(earningPolicyId(base));
  });

  it("changes the bracketed fingerprint when an active bracket or floor changes", () => {
    const base = configForMode("bracketed");
    const floorChanged: AppConfiguration = {
      ...base,
      rewards: {
        ...base.rewards,
        earning: {
          ...base.rewards.earning,
          bracketed: {
            ...base.rewards.earning.bracketed,
            pointFloorProtection: !base.rewards.earning.bracketed.pointFloorProtection
          }
        }
      }
    };
    const bracketChanged: AppConfiguration = {
      ...base,
      rewards: {
        ...base.rewards,
        earning: {
          ...base.rewards.earning,
          bracketed: {
            ...base.rewards.earning.bracketed,
            brackets: base.rewards.earning.bracketed.brackets.map((bracket, index) =>
              index === 1 ? { ...bracket, spendBdt: 61 } : bracket
            )
          }
        }
      }
    };
    expect(earningPolicyId(floorChanged)).not.toBe(earningPolicyId(base));
    expect(earningPolicyId(bracketChanged)).not.toBe(earningPolicyId(base));
  });

  it("does not change the fingerprint when only the inactive policy changes", () => {
    const flatBase = configForMode("flat");
    const inactiveBracketChanged: AppConfiguration = {
      ...flatBase,
      rewards: {
        ...flatBase.rewards,
        earning: {
          ...flatBase.rewards.earning,
          bracketed: {
            ...flatBase.rewards.earning.bracketed,
            pointFloorProtection: !flatBase.rewards.earning.bracketed.pointFloorProtection
          }
        }
      }
    };
    const bracketedBase = configForMode("bracketed");
    const inactiveFlatChanged: AppConfiguration = {
      ...bracketedBase,
      rewards: {
        ...bracketedBase.rewards,
        earning: {
          ...bracketedBase.rewards.earning,
          flat: { ...bracketedBase.rewards.earning.flat, spendBdt: 60 }
        }
      }
    };
    expect(earningPolicyId(inactiveBracketChanged)).toBe(earningPolicyId(flatBase));
    expect(earningPolicyId(inactiveFlatChanged)).toBe(earningPolicyId(bracketedBase));
  });

  it("generates help text from the active customized flat policy", () => {
    const help = helpMessageFromConfig(customizedConfig);
    expect(help).toContain("positive whole-number BDT amount");
    expect(help).toContain("every BDT 100 earns 1 point");
    expect(help).toContain("rounded half-up to four decimal places before storage");
    expect(help).toContain("4 points equal BDT 1 reward value");
    expect(help).toContain("1 point equals BDT 0.25");
    expect(help).toContain("1 point = 10,000 point units");
    expect(help).toContain("Example &amp; Sons &lt;Store&gt; Customer Loyalty Program");
  });

  it("generates bracket and floor status from the active bracketed policy", () => {
    const bracketed: AppConfiguration = {
      ...APP_CONFIG,
      rewards: {
        ...APP_CONFIG.rewards,
        earning: { ...APP_CONFIG.rewards.earning, mode: "bracketed" }
      }
    };
    const help = helpMessageFromConfig(bracketed);
    expect(help).toContain("whole-order brackets apply");
    expect(help).toContain("BDT 1-2,000: every BDT 50 earns 1 point");
    expect(help).toContain("BDT 2,001-4,000: every BDT 60 earns 1 point");
    expect(help).toContain("BDT 25,001 and above: every BDT 100 earns 1 point");
    expect(help).toContain("point-floor protection is enabled");
  });
});

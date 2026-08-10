import { describe, expect, it } from "vitest";
import {
  APP_CONFIG,
  APP_RUNTIME_CONFIG,
  createBrandFilenameSlug,
  deriveAppConfiguration,
  type AppConfiguration
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
    earning: { spendBdt: 100, earnPoints: 1 },
    redemption: { points: 4, valueBdt: 1 }
  }
} as const satisfies AppConfiguration;

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

  it("derives the default earning and redemption policies using exact point units", () => {
    expect(APP_RUNTIME_CONFIG.rewards.earning).toMatchObject({
      spendBdt: 50,
      earnPoints: 1,
      pointUnitsPerBdt: 200
    });
    expect(APP_RUNTIME_CONFIG.rewards.redemption).toMatchObject({
      points: 4,
      valueBdt: 1,
      pointUnitsPerRewardBdt: 40_000
    });
  });

  it("rejects an earning ratio that cannot produce exact point units per BDT", () => {
    const invalid = {
      ...APP_CONFIG,
      rewards: {
        ...APP_CONFIG.rewards,
        earning: { spendBdt: 3, earnPoints: 1 }
      }
    } satisfies AppConfiguration;
    expect(() => deriveAppConfiguration(invalid)).toThrow(/exact whole-number point-unit conversion/i);
  });

  it.each([
    { spendBdt: 0, earnPoints: 1 },
    { spendBdt: 50, earnPoints: 0 },
    { spendBdt: 1.5, earnPoints: 1 },
    { spendBdt: 1, earnPoints: Number.MAX_SAFE_INTEGER }
  ])("rejects an invalid or unsupported earning ratio $spendBdt:$earnPoints", (earning) => {
    const invalid = {
      ...APP_CONFIG,
      rewards: { ...APP_CONFIG.rewards, earning }
    } satisfies AppConfiguration;
    expect(() => deriveAppConfiguration(invalid)).toThrow();
  });

  it("generates help text from the customized integer policy", () => {
    const help = helpMessageFromConfig(customizedConfig);
    expect(help).toContain("every BDT 100 earns 1 point");
    expect(help).toContain("4 points equal BDT 1 reward value");
    expect(help).toContain("1 point equals BDT 0.25");
    expect(help).toContain("1 point = 10,000 point units");
    expect(help).toContain("Example &amp; Sons &lt;Store&gt; Customer Loyalty Program");
  });
});

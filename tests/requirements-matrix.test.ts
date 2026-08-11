import { describe, expect, it } from "vitest";
import { extractCommand } from "../src/workflows/command-handler";
import {
  dashboardKeyboard,
  redeemAmountKeyboard,
  selectionKeyboard
} from "../src/telegram/keyboards";
import { helpMessage } from "../src/telegram/messages";

describe("registered command routing", () => {
  it.each([
    "start",
    "purchase",
    "addpoints",
    "redeem",
    "balance",
    "history",
    "addcustomer",
    "export",
    "leaderboard",
    "restart",
    "cancel",
    "help"
  ])("extracts /%s including bot-addressed variants", (command) => {
    expect(extractCommand(`/${command}`)).toBe(command);
    expect(extractCommand(`/${command}@SoulShopRewardsBot argument`)).toBe(command);
  });
});

describe("help requirement matrix", () => {
  it.each([
    "/addcustomer",
    "final 4 or 5",
    "complete number",
    "Spaces and supported hyphens",
    "every BDT 50 earns 1 point",
    "fractional points",
    "/addpoints",
    "/redeem",
    "Redeem All Points",
    "rounded half-up",
    "/balance",
    "/history",
    "/export",
    "/leaderboard",
    "/cancel",
    "/restart",
    "display with two decimals using standard half-up rounding",
    "Stored point units retain exact precision: 1 point = 10,000 point units",
    "4 points equal BDT 1 reward value",
    "1 point equals BDT 0.25"
  ])("documents %s", (requiredText) => {
    expect(helpMessage()).toContain(requiredText);
  });
});

describe("Telegram callback size and dashboard actions", () => {
  it("keeps every static callback within Telegram's 64-byte limit", () => {
    const callbacks = [
      ...dashboardKeyboard().inline_keyboard.flat(),
      ...selectionKeyboard("abcdefghij").inline_keyboard.flat(),
      ...redeemAmountKeyboard("abcdefghijklmnop").inline_keyboard.flat()
    ].map((button) => button.callback_data);
    for (const callback of callbacks) {
      expect(new TextEncoder().encode(callback).byteLength).toBeLessThanOrEqual(64);
    }
  });

  it("offers an exact-balance Redeem All Points action", () => {
    expect(redeemAmountKeyboard("abcdefghij").inline_keyboard.flat()).toContainEqual({
      text: "💯 Redeem All Points",
      callback_data: "redeemall:abcdefghij"
    });
  });

  it.each([
    "🛒 Record Purchase",
    "➕ Add Points Manually",
    "🎁 Redeem Points",
    "💰 Check Balance",
    "📜 Customer History",
    "👤 Add New Customer",
    "📤 Export Data",
    "🏅 Leaderboard",
    "ℹ️ Help"
  ])("shows dashboard action %s", (label) => {
    expect(dashboardKeyboard().inline_keyboard.flat().map((button) => button.text)).toContain(label);
  });
});

import { describe, expect, it } from "vitest";
import commands from "../scripts/telegram-commands.json";
import { extractCommand } from "../src/workflows/command-handler";
import {
  backCancelKeyboard,
  confirmKeyboard,
  dashboardKeyboard,
  toolsKeyboard,
  redeemAmountKeyboard,
  selectionKeyboard
} from "../src/telegram/keyboards";
import { helpMessage } from "../src/telegram/messages";

describe("registered command routing", () => {
  it.each([
    "start",
    "purchase",
    "quickbuy",
    "addpoints",
    "redeem",
    "balance",
    "history",
    "addcustomer",
    "managecustomer",
    "testaccounts",
    "export",
    "leaderboard",
    "restart",
    "cancel",
    "help",
    "tools"
  ])("extracts /%s including bot-addressed variants", (command) => {
    expect(extractCommand(`/${command}`)).toBe(command);
    expect(extractCommand(`/${command}@SoulShopRewardsBot argument`)).toBe(command);
  });
});

describe("visible Telegram command menu", () => {
  it("registers only the compact v2.0.10 command list", () => {
    expect(commands.map(({ command }) => command)).toEqual([
      "start",
      "purchase",
      "quickbuy",
      "redeem",
      "testaccounts",
      "tools",
      "restart",
      "cancel"
    ]);
    expect(new Set(commands.map(({ command }) => command)).size).toBe(commands.length);
    for (const { command, description } of commands) {
      expect(command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(description.length).toBeGreaterThan(0);
      expect(description.length).toBeLessThanOrEqual(256);
    }
  });
});

describe("help requirement matrix", () => {
  it.each([
    "/addcustomer",
    "/managecustomer",
    "/testaccounts",
    "WhatsApp username",
    "Telegram username",
    "final 4 or 5",
    "complete number",
    "Spaces and supported hyphens",
    "every BDT 50 earns 1 point",
    "positive whole-number BDT amount",
    "rounded half-up to four decimal places before storage",
    "fractional points",
    "/addpoints",
    "/quickbuy",
    "/redeem",
    "Redeem All Points",
    "rounded half-up",
    "/balance",
    "/history",
    "/export",
    "/leaderboard",
    "/help",
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
      ...redeemAmountKeyboard("abcdefghijklmnop").inline_keyboard.flat(),
      ...backCancelKeyboard("abcdefghijklmnop", "s").inline_keyboard.flat(),
      ...confirmKeyboard("abcdefghijklmnop", "✅ Confirm", "a").inline_keyboard.flat()
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

  it("offers tokenized Back alongside Cancel below the first operation level", () => {
    expect(backCancelKeyboard("abcdefghij", "s").inline_keyboard.flat()).toEqual([
      { text: "⬅️ Back", callback_data: "back:s:abcdefghij" },
      { text: "❌ Cancel", callback_data: "cancel" }
    ]);
  });

  it.each([
    "🛍️ Record Purchase",
    "🎁 Redeem Points",
    "💰 Check Balance",
    "📜 Customer History",
    "👤 Add New Customer",
    "🏅 Leaderboard",
    "⚙️ More Tools"
  ])("shows dashboard action %s", (label) => {
    expect(dashboardKeyboard().inline_keyboard.flat().map((button) => button.text)).toContain(label);
  });

  it.each([
    "🪪 Manage Customer Identities",
    "🧪 Manage Test Accounts",
    "➕ Add Points Manually",
    "📤 Export Data",
    "ℹ️ Help",
    "⬅️ Back to Dashboard"
  ])("shows tools action %s", (label) => {
    expect(toolsKeyboard().inline_keyboard.flat().map((button) => button.text)).toContain(label);
  });
});

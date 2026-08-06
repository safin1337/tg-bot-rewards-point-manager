import { botToken, telegramCall } from "./telegram-api.mjs";

const commands = [
  { command: "start", description: "Open the SoulShop rewards dashboard" },
  { command: "purchase", description: "Record a customer purchase" },
  { command: "addpoints", description: "Add customer points manually" },
  { command: "redeem", description: "Redeem customer points" },
  { command: "balance", description: "Check customer reward balance" },
  { command: "history", description: "View customer reward history" },
  { command: "addcustomer", description: "Register a customer with zero points" },
  { command: "export", description: "Export customer and transaction data" },
  { command: "leaderboard", description: "View or reset reward leaderboards" },
  { command: "restart", description: "Restart the current operation" },
  { command: "cancel", description: "Cancel the current operation" },
  { command: "help", description: "Show bot instructions" }
];

await telegramCall(botToken(), "setMyCommands", { commands });
console.log("Telegram commands registered.");

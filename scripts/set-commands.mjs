import { botToken, telegramCall } from "./telegram-api.mjs";

const commands = [
  { command: "start", description: "Open the rewards dashboard" },
  { command: "purchase", description: "Record a customer purchase" },
  { command: "balance", description: "Check customer reward balance" },
  { command: "redeem", description: "Redeem customer points" },
  { command: "leaderboard", description: "View or reset reward leaderboards" },
  { command: "history", description: "View customer reward history" },
  { command: "addcustomer", description: "Register a customer with zero points" },
  { command: "tools", description: "Open administrator tools" },
  { command: "restart", description: "Restart the current operation" },
  { command: "cancel", description: "Cancel the current operation" }
];

await telegramCall(botToken(), "setMyCommands", { commands });
console.log("Telegram commands registered.");

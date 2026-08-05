import { botToken, telegramCall } from "./telegram-api.mjs";

await telegramCall(botToken(), "deleteWebhook", { drop_pending_updates: false });
console.log("Telegram webhook removed. Pending updates were preserved.");

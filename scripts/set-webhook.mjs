import { botToken, requiredEnvironment, telegramCall } from "./telegram-api.mjs";

let workerUrl;
try {
  workerUrl = new URL(requiredEnvironment("PUBLIC_WORKER_URL"));
} catch {
  throw new Error("PUBLIC_WORKER_URL must be an HTTPS origin without a path.");
}
if (
  workerUrl.protocol !== "https:"
  || workerUrl.username !== ""
  || workerUrl.password !== ""
  || workerUrl.pathname !== "/"
  || workerUrl.search !== ""
  || workerUrl.hash !== ""
) {
  throw new Error("PUBLIC_WORKER_URL must be an HTTPS origin without credentials, query, fragment, or path.");
}

await telegramCall(botToken(), "setWebhook", {
  url: `${workerUrl.origin}/webhook`,
  secret_token: requiredEnvironment("WEBHOOK_SECRET"),
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: false
});
console.log("Telegram webhook registered.");

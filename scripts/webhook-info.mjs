import { botToken, telegramCall } from "./telegram-api.mjs";

const info = await telegramCall(botToken(), "getWebhookInfo");
const safeInfo = {
  url: info.url,
  has_custom_certificate: info.has_custom_certificate,
  pending_update_count: info.pending_update_count,
  last_error_date: info.last_error_date,
  last_error_message: info.last_error_message,
  max_connections: info.max_connections,
  allowed_updates: info.allowed_updates
};
console.log(JSON.stringify(safeInfo, null, 2));

import { dashboardKeyboard } from "../telegram/keyboards";
import { BRAND, BRAND_NAME_HTML, dashboardMessage, helpMessage } from "../telegram/messages";
import type { Operation } from "../types/models";
import type { WorkflowContext } from "./context";
import { startOperation } from "./common";

const COMMAND_OPERATIONS: Readonly<Record<string, Operation>> = {
  purchase: "PURCHASE",
  addpoints: "MANUAL_ADD",
  redeem: "REDEEM",
  balance: "BALANCE",
  history: "HISTORY",
  addcustomer: "ADD_CUSTOMER",
  managecustomer: "MANAGE_CUSTOMER",
  export: "EXPORT",
  leaderboard: "LEADERBOARD"
};

export const extractCommand = (text: string): string | null => {
  const match = /^\/([a-z]+)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.exec(text.trim());
  return match?.[1]?.toLowerCase() ?? null;
};

export const handleCommand = async (
  context: WorkflowContext,
  adminId: string,
  chatId: number,
  command: string,
  updateId: number
): Promise<boolean> => {
  if (command === "start") {
    await context.states.clear(adminId);
    await context.telegram.sendMessage(chatId, dashboardMessage(), { replyMarkup: dashboardKeyboard() });
    return true;
  }
  if (command === "help") {
    await context.telegram.sendMessage(chatId, helpMessage());
    return true;
  }
  if (command === "cancel") {
    await context.states.clear(adminId);
    await context.telegram.sendMessage(
      chatId,
      `${BRAND}\n\n✅ The current operation was cancelled.\n\nWelcome to the ${BRAND_NAME_HTML} rewards management dashboard.`,
      { replyMarkup: dashboardKeyboard() }
    );
    return true;
  }
  if (command === "restart") {
    const current = await context.states.get(adminId);
    if (current.state === null) {
      await context.telegram.sendMessage(
        chatId,
        current.expired
          ? `${BRAND}\n\n⏱️ The previous operation expired. Please start again.`
          : dashboardMessage(),
        { replyMarkup: dashboardKeyboard() }
      );
    } else {
      await context.telegram.sendMessage(chatId, `${BRAND}\n\n🔄 The operation has been restarted.`);
      await startOperation(context, adminId, chatId, current.state.activeOperation, updateId);
    }
    return true;
  }
  const operation = COMMAND_OPERATIONS[command];
  if (operation !== undefined) {
    await startOperation(context, adminId, chatId, operation, updateId);
    return true;
  }
  return false;
};

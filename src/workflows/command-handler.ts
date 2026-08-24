import { dashboardKeyboard, toolsKeyboard } from "../telegram/keyboards";
import { BRAND, dashboardMessage, helpMessage, toolsMenuMessage } from "../telegram/messages";
import type { Operation } from "../types/models";
import type { WorkflowContext } from "./context";
import { showDashboard, startOperation } from "./common";

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
    await showDashboard(context, chatId);
    return true;
  }
  if (command === "tools") {
    await context.states.clear(adminId);
    await context.telegram.sendMessage(chatId, toolsMenuMessage(), { replyMarkup: toolsKeyboard() });
    return true;
  }
  if (command === "help") {
    await context.telegram.sendMessage(chatId, helpMessage());
    return true;
  }
  if (command === "cancel") {
    await context.states.clear(adminId);
    const summary = await context.dashboard.summary();
    const dashboard = dashboardMessage(summary).replace(`${BRAND}\n\n`, "");
    await context.telegram.sendMessage(
      chatId,
      `${BRAND}\n\n✅ The current operation was cancelled.\n\n${dashboard}`,
      { replyMarkup: dashboardKeyboard() }
    );
    return true;
  }
  if (command === "restart") {
    const current = await context.states.get(adminId);
    if (current.state === null) {
      if (current.expired) {
        await context.telegram.sendMessage(
          chatId,
          `${BRAND}\n\n⏱️ The previous operation expired. Please start again.`
        );
      }
      await showDashboard(context, chatId);
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

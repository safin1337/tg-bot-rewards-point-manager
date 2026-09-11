import { readFile } from "node:fs/promises";
import { botToken, telegramCall } from "./telegram-api.mjs";

const parsedCommands = JSON.parse(await readFile(
  new URL("./telegram-commands.json", import.meta.url),
  "utf8"
));

if (
  !Array.isArray(parsedCommands)
  || parsedCommands.length === 0
  || parsedCommands.some((entry) => (
    typeof entry !== "object"
    || entry === null
    || Array.isArray(entry)
    || typeof entry.command !== "string"
    || !/^[a-z0-9_]{1,32}$/.test(entry.command)
    || typeof entry.description !== "string"
    || entry.description.length < 1
    || entry.description.length > 256
  ))
  || new Set(parsedCommands.map((entry) => entry.command)).size !== parsedCommands.length
) {
  throw new Error("scripts/telegram-commands.json contains an invalid Telegram command list.");
}

await telegramCall(botToken(), "setMyCommands", { commands: parsedCommands });
console.log("Telegram commands registered.");

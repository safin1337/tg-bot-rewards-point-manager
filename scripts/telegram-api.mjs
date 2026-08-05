const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required in the local process environment.`);
  }
  return value;
};

export const botToken = () => required("BOT_TOKEN");
export const requiredEnvironment = required;

export const telegramCall = async (token, method, payload = {}) => {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json();
  if (!response.ok || result?.ok !== true) {
    throw new Error(`Telegram rejected ${method}. Check your local values and try again.`);
  }
  return result.result;
};

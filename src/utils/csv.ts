const FORMULA_PREFIX = /^[=+\-@]/;

export const safeCsvText = (value: string): string =>
  FORMULA_PREFIX.test(value) ? `'${value}` : value;

export const csvCell = (value: string | number | null): string => {
  if (value === null) return "";
  const raw = typeof value === "number" ? String(value) : safeCsvText(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
};

export const createCsv = (
  headers: readonly string[],
  rows: readonly (readonly (string | number | null)[])[]
): string => {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
};

export const utf8Size = (value: string): number => new TextEncoder().encode(value).byteLength;

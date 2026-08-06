const DHAKA_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dhaka",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true
});

const DHAKA_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Dhaka",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export const nowIso = (): string => new Date().toISOString();

export const addMinutesIso = (iso: string, minutes: number): string =>
  new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

export const subtractUtcCalendarMonthsClamped = (date: Date, months: number): Date => {
  if (!Number.isSafeInteger(months) || months < 0 || Number.isNaN(date.getTime())) {
    throw new Error("Invalid calendar-month calculation.");
  }
  const targetMonthStart = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() - months,
    1,
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds()
  ));
  const targetMonthLastDay = new Date(Date.UTC(
    targetMonthStart.getUTCFullYear(),
    targetMonthStart.getUTCMonth() + 1,
    0
  )).getUTCDate();
  targetMonthStart.setUTCDate(Math.min(date.getUTCDate(), targetMonthLastDay));
  return targetMonthStart;
};

export const formatDhakaDateTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return DHAKA_FORMATTER.format(date).replace(/\b(am|pm)\b/gi, (part) => part.toUpperCase());
};

export const dhakaDate = (date = new Date()): string => {
  const parts = DHAKA_DATE_FORMATTER.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};

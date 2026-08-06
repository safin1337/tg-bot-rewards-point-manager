import { assertSafeNonnegativeInteger, POINT_UNITS_PER_POINT, SQLITE_MAX_INTEGER } from "./rewards";
import type { LeaderboardPeriodType } from "../types/models";

const DHAKA_CALENDAR = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Dhaka",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const WEEK_DATE_LABEL = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
  year: "numeric"
});

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
] as const;

export interface LeaderboardPeriod {
  type: LeaderboardPeriodType;
  key: string;
  label: string;
  running: boolean;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const dhakaCalendarDate = (date: Date): CalendarDate => {
  if (Number.isNaN(date.getTime())) throw new Error("Invalid leaderboard timestamp.");
  const parts = DHAKA_CALENDAR.formatToParts(date);
  const numberPart = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    if (value === undefined || !/^\d+$/.test(value)) throw new Error("Invalid Dhaka calendar date.");
    return Number(value);
  };
  return { year: numberPart("year"), month: numberPart("month"), day: numberPart("day") };
};

const calendarUtc = ({ year, month, day }: CalendarDate): Date =>
  new Date(Date.UTC(year, month - 1, day, 12));

const dateKey = (date: Date): string => date.toISOString().slice(0, 10);

const weekKeyForCalendarDate = (calendarDate: CalendarDate): string => {
  const date = calendarUtc(calendarDate);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return dateKey(date);
};

const shiftWeekKey = (key: string, weeks: number): string => {
  const date = new Date(`${key}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid weekly period key.");
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return dateKey(date);
};

const shiftMonthKey = (key: string, months: number): string => {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (match?.[1] === undefined || match[2] === undefined) throw new Error("Invalid monthly period key.");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + months, 1, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const leaderboardPeriodKey = (type: LeaderboardPeriodType, at: Date): string => {
  const calendarDate = dhakaCalendarDate(at);
  return type === "WEEK"
    ? weekKeyForCalendarDate(calendarDate)
    : `${calendarDate.year}-${String(calendarDate.month).padStart(2, "0")}`;
};

export const leaderboardPeriodLabel = (type: LeaderboardPeriodType, key: string): string => {
  if (type === "MONTH") {
    const match = /^(\d{4})-(\d{2})$/.exec(key);
    if (match?.[1] === undefined || match[2] === undefined) throw new Error("Invalid monthly period key.");
    const monthIndex = Number(match[2]) - 1;
    const name = MONTH_NAMES[monthIndex];
    if (name === undefined) throw new Error("Invalid monthly period key.");
    return `${name} ${match[1]}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error("Invalid weekly period key.");
  const start = new Date(`${key}T12:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${WEEK_DATE_LABEL.format(start)} — ${WEEK_DATE_LABEL.format(end)}`;
};

export const leaderboardPeriods = (
  type: LeaderboardPeriodType,
  at = new Date()
): LeaderboardPeriod[] => {
  const current = leaderboardPeriodKey(type, at);
  const count = type === "WEEK" ? 3 : 2;
  return Array.from({ length: count }, (_, offset) => {
    const key = type === "WEEK"
      ? shiftWeekKey(current, -offset)
      : shiftMonthKey(current, -offset);
    return { type, key, label: leaderboardPeriodLabel(type, key), running: offset === 0 };
  });
};

export const retainedLeaderboardKeys = (at = new Date()): {
  weeks: readonly [string, string, string];
  months: readonly [string, string];
} => {
  const weeks = leaderboardPeriods("WEEK", at).map((period) => period.key);
  const months = leaderboardPeriods("MONTH", at).map((period) => period.key);
  const week0 = weeks[0];
  const week1 = weeks[1];
  const week2 = weeks[2];
  const month0 = months[0];
  const month1 = months[1];
  if (
    week0 === undefined || week1 === undefined || week2 === undefined
    || month0 === undefined || month1 === undefined
  ) {
    throw new Error("Leaderboard retention window could not be calculated.");
  }
  return { weeks: [week0, week1, week2], months: [month0, month1] };
};

export const formatLeaderboardPointUnits = (units: number): string => {
  assertSafeNonnegativeInteger(units);
  if (units > SQLITE_MAX_INTEGER - 50) throw new Error("Leaderboard total is outside the display range.");
  const hundredths = Math.floor((units + 50) / (POINT_UNITS_PER_POINT / 100));
  const whole = Math.floor(hundredths / 100);
  const fraction = String(hundredths % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
};


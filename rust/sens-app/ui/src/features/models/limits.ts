import type { LimitWindow, Overage } from "../../ipc/types";
import { units } from "../../shared/copy";
import { seconds } from "../../shared/format.js";
import { localeNow } from "../../shared/i18n";
import { t } from "./copy";

export interface Reading {
  seen: number;
  status: string;
  window: string;
  overage: Overage | null;
  windows: Record<string, LimitWindow>;
}

export type Level = "" | "warn" | "over";

export interface Row {
  key: string;
  name: string;
  share: number;
  percent: string;
  level: Level;
  resets: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const STALE = 10 * MINUTE;
const NEAR = 0.75;
const FIVE_HOUR = "five_hour";
const SEVEN_DAY = "seven_day";
const SPANS = [FIVE_HOUR, SEVEN_DAY];

export const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function partsOf(key: string) {
  const span = SPANS.find((one) => key === one || key.startsWith(`${one}_`)) ?? "";
  const rest = span ? key.slice(span.length + 1) : "";
  return { span, family: capital(rest.split("_").filter(Boolean).join(" ")) };
}

function nameOf(key: string) {
  const { span, family } = partsOf(key);
  if (span === FIVE_HOUR) return family ? t.fiveHourOf(family) : t.fiveHour;
  if (span === SEVEN_DAY) return family ? t.weeklyOf(family) : t.weekly;
  return capital(key.split("_").filter(Boolean).join(" "));
}

function order(key: string) {
  const { span, family } = partsOf(key);
  const at = SPANS.indexOf(span);
  return [at < 0 ? SPANS.length : at, family ? 1 : 0] as const;
}

const byOrder = ([one]: [string, LimitWindow], [other]: [string, LimitWindow]) => {
  const [a, b] = [order(one), order(other)];
  return a[0] - b[0] || a[1] - b[1] || one.localeCompare(other);
};

const dayOf = (at: Date) => new Intl.DateTimeFormat(localeNow(), { weekday: "short" }).format(at);
const timeOf = (at: Date) => new Intl.DateTimeFormat(localeNow(), { hour: "numeric", minute: "2-digit" }).format(at);
const dayTimeOf = (at: Date, recent: boolean) => new Intl.DateTimeFormat(localeNow(), recent ? { weekday: "short", hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(at);

function spanOf(millis: number) {
  const minutes = Math.max(1, Math.ceil(millis / MINUTE));
  return minutes < 60 ? units.minutes(minutes, 0) : units.hours(Math.floor(minutes / 60), minutes % 60);
}

export const workedFor = (millis: number): string => seconds(Math.round(millis / 1000) * 1000);

function resetsSaid(ends: number, now: number) {
  if (ends - now < DAY) return t.resetsIn(spanOf(ends - now));
  const at = new Date(ends);
  return t.resetsOn(dayOf(at), timeOf(at));
}

const flagged = (reading: Reading, key: string, status: string) => reading.window === key && reading.status === status;

function rowOf(reading: Reading, key: string, window: LimitWindow, now: number): Row {
  const ends = (window.resetsAt ?? 0) * 1000;
  const passed = ends > 0 && ends <= now;
  const known = typeof window.utilization === "number";
  const rejected = !passed && (flagged(reading, key, "rejected") || (known && window.utilization! >= 1));
  const share = passed ? 0 : known ? Math.max(0, window.utilization!) : rejected ? 1 : 0;
  const level: Level = rejected ? "over" : !passed && (flagged(reading, key, "allowed_warning") || share >= NEAR) ? "warn" : "";
  const resets = passed ? t.alreadyReset : ends ? resetsSaid(ends, now) : "";
  return {
    key,
    name: nameOf(key),
    share: Math.min(1, share),
    percent: known || passed ? t.percent(Math.round(share * 100)) : "",
    level,
    resets: rejected ? [t.reached, resets].filter(Boolean).join(" · ") : resets,
  };
}

export const rowsOf = (reading: Reading | null, now = Date.now()) =>
  reading ? Object.entries(reading.windows).sort(byOrder).map(([key, window]) => rowOf(reading, key, window, now)) : [];

const WEIGHT: Record<Level, number> = { "": 0, warn: 1, over: 2 };

const worst = (rows: { level: Level }[]): Level => rows.reduce<Level>((most, row) => (WEIGHT[row.level] > WEIGHT[most] ? row.level : most), "");

export function tightest(reading: Reading | null, now = Date.now()) {
  const rows = rowsOf(reading, now).filter((row) => row.percent);
  return rows.reduce<Row | undefined>((most, row) => (!most || WEIGHT[row.level] > WEIGHT[most.level] || (row.level === most.level && row.share > most.share) ? row : most), undefined);
}

export function usedSaid(row: Row) {
  const { span, family } = partsOf(row.key);
  if (span === FIVE_HOUR && !family) return t.usedFiveHour(row.percent);
  if (span === SEVEN_DAY) return family ? t.usedWeekOf(row.percent, family) : t.usedWeek(row.percent);
  return t.usedOf(row.percent, row.name);
}

export function overageOf(reading: Reading | null): { text: string; level: Level } | null {
  const overage = reading?.overage;
  if (!overage?.using) return null;
  if (overage.status === "rejected") return { text: t.overageOut, level: "over" };
  if (overage.status === "allowed_warning") return { text: t.overageNear, level: "warn" };
  return { text: t.overageOn, level: "" };
}

export function asOf(reading: Reading | null, now = Date.now()) {
  if (!reading || now - reading.seen < STALE) return "";
  const at = new Date(reading.seen);
  if (at.toDateString() === new Date(now).toDateString()) return t.asOf(timeOf(at));
  return t.asOfDay(dayTimeOf(at, now - reading.seen < WEEK - DAY));
}

export const planLevel = (reading: Reading | null, now = Date.now()) => worst([...rowsOf(reading, now), overageOf(reading) ?? { level: "" as Level }]);

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Day-typed values (Prisma `@db.Date`) are stored as UTC midnight of the intended
// calendar day (see todayDate). Always format them in UTC so the rendered day
// matches the stored day in every viewer timezone — using the local zone would
// pull a UTC-midnight date back to the previous calendar day west of UTC.
export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Today's calendar day as UTC midnight. We read the *local* Y/M/D (the day the
// user is actually living) and stamp it at UTC midnight so Prisma writes that
// exact day to a `@db.Date` column. Building a local-midnight Date instead would
// serialize to the previous UTC day for any timezone ahead of UTC.
export function todayDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function isPastCutoff(cutoffTime: string, timezone: string): boolean {
  const [hours, minutes] = cutoffTime.split(":").map(Number);
  const now = new Date();
  const cutoff = new Date();
  cutoff.setHours(hours, minutes, 0, 0);
  return now > cutoff;
}

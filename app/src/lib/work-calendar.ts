// Shared work-calendar grid math. Buckets tasks into a trailing 5-week,
// Monday-start grid of worked-vs-planned hours. Used by the Profile page and the
// personal Dashboard so both render the identical <WorkCalendar> without dup.

export type CalCell = { date: string; planned: number; worked: number; future: boolean };
export type WeekPoint = { start: string; planned: number; worked: number };

// Calendar spans the trailing 5 Monday-start weeks (35 cells).
export const CAL_WEEKS = 5;

type CalTask = { date: Date; estimatedHours: number | null; actualHours: number | null };

// Monday starting the trailing 5-week grid ending in the current week. Callers
// use it to scope the DB query before feeding the rows to buildCalendar.
export function calendarGridStart(today: Date): Date {
  const dowMon = (utcDow(today) + 6) % 7; // 0 = Monday
  const gridEnd = addDays(today, 6 - dowMon); // Sunday of the current week
  return addDays(gridEnd, -(CAL_WEEKS * 7 - 1)); // Monday, 5 weeks back
}

// Build the calendar grid + weekly rollups from tasks whose `date` falls within
// (or before) the grid range. `today` is a @db.Date value at UTC midnight.
export function buildCalendar(tasks: CalTask[], today: Date): { calendar: CalCell[]; weeks: WeekPoint[]; gridStart: Date } {
  const gridStart = calendarGridStart(today);

  const byDay = new Map<string, { planned: number; worked: number }>();
  for (const t of tasks) {
    const k = ymd(t.date);
    const e = byDay.get(k) ?? { planned: 0, worked: 0 };
    e.planned += t.estimatedHours ?? 0;
    e.worked += t.actualHours ?? 0;
    byDay.set(k, e);
  }

  const todayKey = ymd(today);
  const calendar: CalCell[] = [];
  for (let i = 0; i < CAL_WEEKS * 7; i++) {
    const key = ymd(addDays(gridStart, i));
    const e = byDay.get(key);
    calendar.push({ date: key, planned: round1(e?.planned ?? 0), worked: round1(e?.worked ?? 0), future: key > todayKey });
  }

  const weeks: WeekPoint[] = [];
  for (let w = 0; w < CAL_WEEKS; w++) {
    const cells = calendar.slice(w * 7, w * 7 + 7);
    if (cells.every((c) => c.future)) continue;
    weeks.push({
      start: cells[0].date,
      planned: round1(cells.reduce((s, c) => s + c.planned, 0)),
      worked: round1(cells.reduce((s, c) => s + c.worked, 0)),
    });
  }

  return { calendar, weeks, gridStart };
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Calendar day (UTC) of a @db.Date value — dates are stored at UTC midnight, so
// bucket on the UTC day to match how the day was planned.
export function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Weekday of a @db.Date (UTC): 0 = Sunday … 6 = Saturday.
function utcDow(date: Date): number {
  return new Date(`${date.toISOString().slice(0, 10)}T00:00:00Z`).getUTCDay();
}

// Timeline ranges for the Insights page. The team/member views default to a
// rolling window, but a manager (or member) can pick a named period — this week,
// last month, last 3 months — or a custom from/to span. All arithmetic is on the
// UTC calendar day, matching how `@db.Date` values are stored (UTC midnight, see
// todayDate in lib/utils) so a picked day maps to the exact stored day.

export type RangeKey =
  | "this-week"
  | "last-week"
  | "this-month"
  | "last-month"
  | "last-3-months"
  | "custom";

export const RANGE_PRESETS: { key: Exclude<RangeKey, "custom">; label: string }[] = [
  { key: "this-week", label: "This week" },
  { key: "last-week", label: "Last week" },
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "last-3-months", label: "Last 3 months" },
];

// Default period when no range is selected. "This month" is the clearest current
// period; users wanting more history pick a longer preset.
export const DEFAULT_RANGE: RangeKey = "this-month";

export type ResolvedRange = {
  key: RangeKey;
  label: string;
  start: Date; // UTC midnight of the first included day (inclusive)
  end: Date; // UTC midnight of the last included day (inclusive)
  endExclusive: Date; // UTC midnight of the day AFTER end — use with `lt` for both @db.Date and datetime columns
  days: number; // inclusive day count in the span
  from: string; // YYYY-MM-DD of start, for custom inputs / display
  to: string; // YYYY-MM-DD of end
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

// Monday-based start of the ISO week containing `d`.
function startOfWeek(d: Date): Date {
  const dow = d.getUTCDay(); // 0=Sun … 6=Sat
  const sinceMonday = (dow + 6) % 7;
  return addDays(d, -sinceMonday);
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

// Parse a YYYY-MM-DD string to a UTC-midnight Date, or null if malformed.
function parseYmd(s: string | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Guard against overflow (e.g. 2026-02-31 rolling into March).
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

function span(key: RangeKey, label: string, start: Date, end: Date): ResolvedRange {
  const endExclusive = addDays(end, 1);
  const days = Math.round((endExclusive.getTime() - start.getTime()) / MS_PER_DAY);
  return { key, label, start, end, endExclusive, days, from: ymd(start), to: ymd(end) };
}

// Resolve the requested range against `today` (UTC midnight). Unknown or invalid
// input falls back to DEFAULT_RANGE so a bad URL never crashes the page.
export function resolveRange(
  params: { range?: string; from?: string; to?: string },
  today: Date,
): ResolvedRange {
  const key = (params.range ?? DEFAULT_RANGE) as RangeKey;

  switch (key) {
    case "this-week": {
      return span(key, "This week", startOfWeek(today), today);
    }
    case "last-week": {
      const start = addDays(startOfWeek(today), -7);
      return span(key, "Last week", start, addDays(start, 6));
    }
    case "this-month": {
      return span(key, "This month", startOfMonth(today), today);
    }
    case "last-month": {
      const thisMonth = startOfMonth(today);
      const start = new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - 1, 1));
      return span(key, "Last month", start, addDays(thisMonth, -1));
    }
    case "last-3-months": {
      // Current month plus the two before it — a trailing three-calendar-month window.
      const thisMonth = startOfMonth(today);
      const start = new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - 2, 1));
      return span(key, "Last 3 months", start, today);
    }
    case "custom": {
      const from = parseYmd(params.from);
      const to = parseYmd(params.to);
      if (from && to) {
        const [lo, hi] = from.getTime() <= to.getTime() ? [from, to] : [to, from];
        return span("custom", `${ymd(lo)} → ${ymd(hi)}`, lo, hi);
      }
      // Incomplete custom range — fall back to the default preset.
      return resolveRange({ range: DEFAULT_RANGE }, today);
    }
    default:
      return resolveRange({ range: DEFAULT_RANGE }, today);
  }
}

// Bucket size (days) for trend sparklines so short and long spans both yield a
// readable number of points: daily for ≤2 weeks, weekly to ~6 weeks, else ~12 points.
export function trendBucketDays(days: number): number {
  if (days <= 14) return 1;
  if (days <= 45) return 7;
  return Math.ceil(days / 12);
}

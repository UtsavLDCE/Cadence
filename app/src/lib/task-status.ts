export type TaskStatus = "TODO" | "IN_PROGRESS" | "HOLD" | "DONE";

export const TASK_STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "HOLD", "DONE"];

export const STATUS_META: Record<
  TaskStatus,
  { label: string; badge: string; dot: string; hex: string }
> = {
  TODO: {
    label: "To Do",
    badge: "bg-gray-100 text-gray-600",
    dot: "bg-gray-400",
    hex: "#8a93a6",
  },
  IN_PROGRESS: {
    label: "In Progress",
    badge: "bg-amber-100 text-amber-700",
    dot: "bg-amber-500",
    hex: "#f5a623",
  },
  HOLD: {
    label: "Hold",
    badge: "bg-violet-100 text-violet-700",
    dot: "bg-violet-500",
    hex: "#9b7bd4",
  },
  DONE: {
    label: "Done",
    badge: "bg-emerald-100 text-emerald-700",
    dot: "bg-emerald-500",
    hex: "#2bb673",
  },
};

export type DeferralCause = "INTERRUPTED" | "UNDERESTIMATED" | "BLOCKED" | "DEPRIORITIZED" | "OTHER";

export const DEFERRAL_CAUSES: DeferralCause[] = [
  "INTERRUPTED",
  "UNDERESTIMATED",
  "BLOCKED",
  "DEPRIORITIZED",
  "OTHER",
];

export const DEFERRAL_CAUSE_META: Record<DeferralCause, { label: string }> = {
  INTERRUPTED: { label: "Interrupted" },
  UNDERESTIMATED: { label: "Underestimated" },
  BLOCKED: { label: "Blocked" },
  DEPRIORITIZED: { label: "Deprioritized" },
  OTHER: { label: "Other" },
};

export function fmtHours(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${Number.isInteger(n) ? n : n.toFixed(1)}h`;
}

// Planning priority — three tiers. `rank` orders highest-priority first so a day
// plan / queue can sort by it (HIGH=0 sorts above LOW=2).
export type Priority = "HIGH" | "MEDIUM" | "LOW";

export const PRIORITIES: Priority[] = ["HIGH", "MEDIUM", "LOW"];

export const PRIORITY_META: Record<
  Priority,
  { label: string; badge: string; dot: string; rank: number }
> = {
  HIGH: { label: "High", badge: "bg-primary-soft text-primary", dot: "bg-primary", rank: 0 },
  MEDIUM: { label: "Medium", badge: "bg-amber-100 text-amber-700", dot: "bg-amber-500", rank: 1 },
  LOW: { label: "Low", badge: "bg-gray-100 text-gray-500", dot: "bg-gray-400", rank: 2 },
};

// Rank for a possibly-missing priority, defaulting to MEDIUM so stale or partial
// data never throws while sorting.
function priorityRank(p: Priority | null | undefined): number {
  return (p && PRIORITY_META[p]?.rank) ?? PRIORITY_META.MEDIUM.rank;
}

// Stable comparator: highest priority first; callers chain their own tiebreaker.
export function byPriority<T extends { priority: Priority }>(a: T, b: T): number {
  return priorityRank(a.priority) - priorityRank(b.priority);
}

// Validate an untrusted priority value from a request body, defaulting to null
// when absent/invalid so callers can fall back to the schema default.
export function parsePriority(value: unknown): Priority | null {
  return typeof value === "string" && (PRIORITIES as readonly string[]).includes(value)
    ? (value as Priority)
    : null;
}

// A realistic single-day capacity. Planning estimated effort beyond this means
// the day is over-committed — surfaced as a nudge, not a hard block.
export const WORKDAY_HOURS = 8;

// Planning accuracy = how close estimates were to reality, measured ONLY over
// completed work (an in-progress task has partial actuals and would always read
// as "under"). Signed both ways so it's honest in both directions:
//   actual < estimated  -> overestimated (budgeted more time than it took)
//   actual > estimated  -> underestimated (work ran longer than planned)
// Tone is neutral, not pass/fail — over-delivering isn't a failure.
export type PlanningTone = "ok" | "over" | "under" | "none";

export function planningAccuracy(estimated: number, actual: number): {
  variance: number;
  pct: number | null;
  label: string;
  tone: PlanningTone;
} {
  const variance = Math.round((actual - estimated) * 10) / 10;
  const pct = estimated > 0 ? Math.round((actual / estimated) * 100) : null;

  if (estimated === 0 && actual === 0) {
    return { variance: 0, pct: null, label: "No completed work yet", tone: "none" };
  }
  if (Math.abs(variance) < 0.5) {
    return { variance, pct, label: "On target", tone: "ok" };
  }
  if (variance > 0) {
    return { variance, pct, label: `Underestimated by ${fmtHours(variance)}`, tone: "under" };
  }
  return { variance, pct, label: `Overestimated by ${fmtHours(Math.abs(variance))}`, tone: "over" };
}

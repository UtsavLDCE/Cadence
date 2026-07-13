export type TaskStatus = "TODO" | "IN_PROGRESS" | "HOLD" | "DONE";

export const TASK_STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "HOLD", "DONE"];

export const STATUS_META: Record<
  TaskStatus,
  { label: string; badge: string; dot: string; hex: string }
> = {
  TODO: {
    label: "To Do",
    badge: "bg-[#f0ece5] text-[#6b665f]",
    dot: "bg-[#9c9186]",
    hex: "#9c9186",
  },
  IN_PROGRESS: {
    label: "In Progress",
    badge: "bg-[#eaf1f8] text-[#3a6ea5]",
    dot: "bg-[#3a6ea5]",
    hex: "#3a6ea5",
  },
  HOLD: {
    label: "Hold",
    badge: "bg-[#eae6fb] text-[#6a5acd]",
    dot: "bg-[#6a5acd]",
    hex: "#6a5acd",
  },
  DONE: {
    label: "Done",
    badge: "bg-[#e9f4ec] text-[#3f8a5b]",
    dot: "bg-[#3f8a5b]",
    hex: "#3f8a5b",
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

// Render hours to 10-minute precision. Sub-hour values show as minutes (e.g.
// 0.1667 -> "10m") so the finer step on the effort inputs isn't flattened to a
// misleading "0.2h". Whole hours stay "2h"; mixed show "1h 30m".
export function fmtHours(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const totalMin = Math.round(n * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// Planning priority — three tiers. `rank` orders highest-priority first so a day
// plan / queue can sort by it (HIGH=0 sorts above LOW=2).
export type Priority = "HIGH" | "MEDIUM" | "LOW";

export const PRIORITIES: Priority[] = ["HIGH", "MEDIUM", "LOW"];

export const PRIORITY_META: Record<
  Priority,
  { label: string; badge: string; dot: string; rank: number }
> = {
  HIGH: { label: "High", badge: "bg-[#fbe4de] text-[#c0392b]", dot: "bg-[#c0392b]", rank: 0 },
  MEDIUM: { label: "Medium", badge: "bg-[#f0ece5] text-[#6b665f]", dot: "bg-[#9c9186]", rank: 1 },
  LOW: { label: "Low", badge: "bg-[#e9f4ec] text-[#3f8a5b]", dot: "bg-[#3f8a5b]", rank: 2 },
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

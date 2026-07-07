import type { TaskStatus, WorkType, DeferralCause, Priority } from "@prisma/client";
import { WORKDAY_HOURS, planningAccuracy, type PlanningTone } from "@/lib/task-status";

// ---------------------------------------------------------------------------
// Productivity-leak analytics. Pure functions over plain rows so they're easy to
// reason about and unit-test; the /insights server page feeds them DB rows.
//
// Two families of signal:
//   1. Derivable now from existing columns (estimate drift, firefighting,
//      deferral causes, chronic carryover, WIP concurrency, utilization).
//   2. Derivable only from TaskStatusEvent, which started logging on 2026-07-01,
//      so cycle time / blocked time / rework accrue going forward (a member with
//      no recent transitions reads as "no data yet", not zero).
// ---------------------------------------------------------------------------

// Trailing window (days, inclusive of today) that trend signals are measured over.
export const INSIGHTS_WINDOW_DAYS = 30;

export type InsightTaskRow = {
  id: string;
  userId: string;
  title: string;
  status: TaskStatus;
  workType: WorkType;
  unplanned: boolean; // explicitly logged as off-plan work (the honest firefighting signal)
  priority: Priority;
  estimatedHours: number | null;
  actualHours: number | null;
  date: string; // ISO
  completedAt: string | null; // ISO
  deferredToDate: string | null; // ISO — set => this row is a deferred original
  deferredFromDate: string | null; // ISO — set => this row is a carry-forward copy
  deferralCause: DeferralCause | null;
  categoryId: string | null;
};

export type InsightEventRow = {
  taskId: string;
  userId: string;
  from: TaskStatus | null;
  to: TaskStatus;
  at: string; // ISO
  blockedOn?: string | null; // set on HOLD transitions — who/which team it waits on
  note?: string | null; // set on HOLD transitions — why it's blocked
};

// --- 1. Estimate vs actual accuracy -----------------------------------------
// Measured over DONE tasks that carry both an estimate and a logged actual.
export type EstimateAccuracy = {
  sampleSize: number;
  estimatedHours: number;
  actualHours: number;
  variance: number; // actual - estimated
  pct: number | null; // actual / estimated * 100
  label: string;
  tone: PlanningTone;
};

export function estimateAccuracy(tasks: InsightTaskRow[]): EstimateAccuracy {
  const done = tasks.filter(
    (t) => t.status === "DONE" && t.estimatedHours != null && t.actualHours != null,
  );
  const est = done.reduce((s, t) => s + (t.estimatedHours ?? 0), 0);
  const act = done.reduce((s, t) => s + (t.actualHours ?? 0), 0);
  const a = planningAccuracy(est, act);
  return {
    sampleSize: done.length,
    estimatedHours: Math.round(est * 10) / 10,
    actualHours: Math.round(act * 10) / 10,
    variance: a.variance,
    pct: a.pct,
    label: a.label,
    tone: a.tone,
  };
}

// --- 2. Firefighting ratio ---------------------------------------------------
// Share of effort that went to unplanned work. A task is "unplanned" when it's
// flagged INTERRUPTION or it was completed on a day it wasn't planned for
// (completedAt's day differs from its planned date). Effort uses actualHours,
// falling back to estimate so newly-logged interruptions still count.
export type Firefighting = {
  unplannedHours: number;
  unplannedCount: number; // number of unplanned items — so zero-hour logs still count as visible
  totalHours: number;
  ratioPct: number | null;
  interruptionLogCount: number; // separate Interruption-model entries in window
};

// A single unplanned item, for the browsable member-facing list.
export type FireItem = {
  id: string;
  title: string;
  date: string; // ISO — the day it was logged against
  hours: number; // effort attributed (actual, falling back to estimate)
};

function effortOf(t: InsightTaskRow): number {
  return t.actualHours ?? t.estimatedHours ?? 0;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function isUnplanned(t: InsightTaskRow): boolean {
  if (t.unplanned) return true; // explicit flag — the authoritative signal
  if (t.workType === "INTERRUPTION") return true; // legacy proxy, kept for pre-flag rows
  if (t.status === "DONE" && t.completedAt && dayKey(t.completedAt) !== dayKey(t.date)) return true;
  return false;
}

// The live (non-deferred-original) unplanned tasks, most recent first — the
// backing data for both the firefighting ratio and the browsable list.
function liveUnplanned(tasks: InsightTaskRow[]): InsightTaskRow[] {
  return tasks.filter((t) => !t.deferredToDate && isUnplanned(t));
}

export function firefightingItems(tasks: InsightTaskRow[]): FireItem[] {
  return liveUnplanned(tasks)
    .map((t) => ({ id: t.id, title: t.title, date: t.date, hours: effortOf(t) }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function firefighting(tasks: InsightTaskRow[], interruptionLogCount: number): Firefighting {
  // Exclude deferred audit originals so effort isn't double-counted against the copy.
  const live = tasks.filter((t) => !t.deferredToDate);
  const total = live.reduce((s, t) => s + effortOf(t), 0);
  const un = live.filter(isUnplanned);
  const unplanned = un.reduce((s, t) => s + effortOf(t), 0);
  return {
    unplannedHours: Math.round(unplanned * 10) / 10,
    unplannedCount: un.length,
    totalHours: Math.round(total * 10) / 10,
    ratioPct: total > 0 ? Math.round((unplanned / total) * 100) : null,
    interruptionLogCount,
  };
}

// --- 3. Deferral cause patterns ---------------------------------------------
// Count of deferred-original rows in the window, grouped by cause.
export type DeferralBreakdown = {
  total: number;
  byCause: Record<DeferralCause, number>;
  topCause: DeferralCause | null;
};

const CAUSES: DeferralCause[] = ["INTERRUPTED", "UNDERESTIMATED", "BLOCKED", "DEPRIORITIZED", "OTHER"];

export function deferralBreakdown(tasks: InsightTaskRow[]): DeferralBreakdown {
  const byCause = Object.fromEntries(CAUSES.map((c) => [c, 0])) as Record<DeferralCause, number>;
  let total = 0;
  for (const t of tasks) {
    if (!t.deferredToDate) continue;
    total++;
    if (t.deferralCause) byCause[t.deferralCause]++;
  }
  let topCause: DeferralCause | null = null;
  for (const c of CAUSES) if (byCause[c] > 0 && (topCause === null || byCause[c] > byCause[topCause])) topCause = c;
  return { total, byCause, topCause };
}

// --- 6. Chronic carryover ---------------------------------------------------
// deferredFromDate stores a date, not a task id, so exact chains aren't linkable.
// Proxy: the same task title deferred more than once in the window = compounding
// slip. Returns the worst offenders (title + slip count), sorted desc.
export type ChronicSlip = { title: string; slips: number };

export function chronicCarryover(tasks: InsightTaskRow[]): ChronicSlip[] {
  const counts = new Map<string, { title: string; slips: number }>();
  for (const t of tasks) {
    if (!t.deferredToDate) continue;
    const key = t.title.trim().toLowerCase();
    const e = counts.get(key) ?? { title: t.title.trim(), slips: 0 };
    e.slips++;
    counts.set(key, e);
  }
  return [...counts.values()].filter((e) => e.slips >= 2).sort((a, b) => b.slips - a.slips);
}

// --- 8. WIP concurrency (snapshot) ------------------------------------------
// How many live tasks a person is holding open right now. High IN_PROGRESS =
// context-switching thrash; HOLD = stalled work.
export type WipSnapshot = { inProgress: number; onHold: number };

// Threshold above which concurrent in-progress work reads as thrash.
export const WIP_THRESHOLD = 3;

export function wipSnapshot(tasks: InsightTaskRow[]): WipSnapshot {
  const live = tasks.filter((t) => !t.deferredToDate);
  return {
    inProgress: live.filter((t) => t.status === "IN_PROGRESS").length,
    onHold: live.filter((t) => t.status === "HOLD").length,
  };
}

// --- 4. Utilization -----------------------------------------------------------
// Logged effort vs planned effort over the window. Under-logging (logged ≪
// planned) means planned time evaporated into untracked work / meetings / idle.
export type Utilization = {
  loggedHours: number;
  plannedHours: number;
  pct: number | null; // logged / planned
};

export function utilization(tasks: InsightTaskRow[]): Utilization {
  const live = tasks.filter((t) => !t.deferredToDate);
  const logged = live.reduce((s, t) => s + (t.actualHours ?? 0), 0);
  const planned = live.reduce((s, t) => s + (t.estimatedHours ?? 0), 0);
  return {
    loggedHours: Math.round(logged * 10) / 10,
    plannedHours: Math.round(planned * 10) / 10,
    pct: planned > 0 ? Math.round((logged / planned) * 100) : null,
  };
}

// --- 5 & 7. Flow metrics from the status-event log --------------------------
// cycle time  = hours from first IN_PROGRESS to the DONE that follows it.
// blocked time = cumulative hours a task sat in HOLD.
// reopens      = transitions out of DONE (from=DONE, to!=DONE) — rework churn.
export type FlowMetrics = {
  sampleSize: number; // tasks with a completed cycle
  avgCycleHours: number | null;
  avgBlockedHours: number | null;
  reopens: number;
};

const HOURS = 1000 * 60 * 60;

export function flowMetrics(events: InsightEventRow[]): FlowMetrics {
  const byTask = new Map<string, InsightEventRow[]>();
  for (const e of events) {
    const arr = byTask.get(e.taskId) ?? [];
    arr.push(e);
    byTask.set(e.taskId, arr);
  }

  let cycleSum = 0;
  let cycleCount = 0;
  let blockedSum = 0;
  let blockedCount = 0;
  let reopens = 0;

  for (const evs of byTask.values()) {
    const sorted = [...evs].sort((a, b) => a.at.localeCompare(b.at));
    let firstInProgress: number | null = null;
    let holdEnteredAt: number | null = null;
    let taskBlocked = 0;
    let sawHold = false;

    for (const e of sorted) {
      const t = new Date(e.at).getTime();
      if (e.to === "IN_PROGRESS" && firstInProgress === null) firstInProgress = t;
      if (e.from === "DONE" && e.to !== "DONE") reopens++;

      // Blocked-time accounting: opening on HOLD, closing on the next transition.
      if (e.to === "HOLD") {
        holdEnteredAt = t;
        sawHold = true;
      } else if (holdEnteredAt !== null) {
        taskBlocked += t - holdEnteredAt;
        holdEnteredAt = null;
      }

      if (e.to === "DONE" && firstInProgress !== null) {
        cycleSum += t - firstInProgress;
        cycleCount++;
        firstInProgress = null; // reset so a reopen->redo measures a fresh cycle
      }
    }

    if (sawHold) {
      blockedSum += taskBlocked;
      blockedCount++;
    }
  }

  return {
    sampleSize: cycleCount,
    avgCycleHours: cycleCount ? Math.round((cycleSum / cycleCount / HOURS) * 10) / 10 : null,
    avgBlockedHours: blockedCount ? Math.round((blockedSum / blockedCount / HOURS) * 10) / 10 : null,
    reopens,
  };
}

// --- Blocked dependencies (cross-team leak) ---------------------------------
// The single leak a task tracker usually can't see: work stalled waiting on
// someone else. Every HOLD transition can name who/which team it's waiting on;
// grouping those names surfaces the dependencies that repeatedly cost the team
// time (e.g. "waiting on Platform ×5"). Names are grouped case-insensitively but
// displayed in their first-seen form. Recent examples carry the "why" note.
export type BlockedDependency = {
  blockedOn: string;
  count: number;
  lastReason: string | null;
  lastAt: string; // ISO of most recent HOLD on this dependency
};

export function blockedDependencies(events: InsightEventRow[]): BlockedDependency[] {
  const byKey = new Map<string, BlockedDependency>();
  for (const e of events) {
    if (e.to !== "HOLD") continue;
    const raw = (e.blockedOn ?? "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { blockedOn: raw, count: 1, lastReason: e.note ?? null, lastAt: e.at });
    } else {
      existing.count++;
      if (e.at > existing.lastAt) {
        existing.lastAt = e.at;
        existing.lastReason = e.note ?? null;
      }
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
}

// --- Category breakdown -------------------------------------------------------
// Where the team's effort actually goes, split by task category (Meeting, Client
// Call, Cross-Team, R&D, …). This is the direct answer to "where does the time
// go": it makes the meetings / cross-team / interruption load that a raw task
// count hides visible and comparable. Effort uses actualHours, falling back to
// estimate so freshly-logged work still counts. Deferred originals are excluded.
export type CategorySlice = { id: string | null; name: string; hours: number; pct: number };

export function categoryBreakdown(
  tasks: Pick<InsightTaskRow, "deferredToDate" | "actualHours" | "estimatedHours" | "categoryId">[],
  names: Map<string, string>,
): CategorySlice[] {
  const byCat = new Map<string | null, number>();
  for (const t of tasks) {
    if (t.deferredToDate) continue;
    const h = t.actualHours ?? t.estimatedHours ?? 0;
    if (h <= 0) continue;
    const key = t.categoryId ?? null;
    byCat.set(key, (byCat.get(key) ?? 0) + h);
  }
  const total = [...byCat.values()].reduce((s, h) => s + h, 0);
  return [...byCat.entries()]
    .map(([id, hours]) => ({
      id,
      name: id ? (names.get(id) ?? "Unknown") : "Uncategorized",
      hours: Math.round(hours * 10) / 10,
      pct: total > 0 ? Math.round((hours / total) * 100) : 0,
    }))
    .sort((a, b) => b.hours - a.hours);
}

// --- Trends (direction, not just level) -------------------------------------
// A single "44% utilization" is meaningless without direction — is that normal,
// or down from 70%? These bucket the window into weeks and re-run the level
// metrics per bucket so the UI can draw a sparkline. Empty buckets read as null
// (a gap in the line) rather than 0, so sparse data doesn't lie as a crash.
export type TrendPoint = number | null;
export type Trends = {
  bucketDays: number;
  utilization: TrendPoint[]; // logged/planned % per bucket
  firefighting: TrendPoint[]; // unplanned effort % per bucket
  drift: TrendPoint[]; // actual/estimated % over completed work per bucket
};

// Epoch-day index for a YYYY-MM-DD… ISO string (UTC calendar day).
function epochDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / (1000 * 60 * 60 * 24));
}

export function computeTrends(
  tasks: InsightTaskRow[],
  windowStartISO: string,
  windowDays = INSIGHTS_WINDOW_DAYS,
  bucketDays = 7,
): Trends {
  const start = epochDay(windowStartISO);
  const bucketCount = Math.max(1, Math.ceil(windowDays / bucketDays));
  const buckets: InsightTaskRow[][] = Array.from({ length: bucketCount }, () => []);
  for (const t of tasks) {
    const idx = Math.floor((epochDay(t.date) - start) / bucketDays);
    if (idx >= 0 && idx < bucketCount) buckets[idx].push(t);
  }
  return {
    bucketDays,
    utilization: buckets.map((b) => (b.length ? utilization(b).pct : null)),
    firefighting: buckets.map((b) => (b.length ? firefighting(b, 0).ratioPct : null)),
    drift: buckets.map((b) => (b.length ? estimateAccuracy(b).pct : null)),
  };
}

// --- Per-member roll-up ------------------------------------------------------
export type MemberInsights = {
  id: string;
  name: string | null;
  email: string | null;
  team: string | null;
  estimate: EstimateAccuracy;
  fire: Firefighting;
  fireItems: FireItem[]; // the actual unplanned tasks behind `fire`, for a browsable list
  deferral: DeferralBreakdown;
  chronic: ChronicSlip[];
  wip: WipSnapshot;
  util: Utilization;
  flow: FlowMetrics;
  blocked: BlockedDependency[];
};

export type MemberSource = {
  id: string;
  name: string | null;
  email: string | null;
  team: string | null;
  tasks: InsightTaskRow[]; // window tasks for this member
  wipTasks: InsightTaskRow[]; // current live tasks (snapshot, any date)
  events: InsightEventRow[]; // status events for this member's tasks in window
  interruptionLogCount: number;
};

export function buildMemberInsights(m: MemberSource): MemberInsights {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    team: m.team,
    estimate: estimateAccuracy(m.tasks),
    fire: firefighting(m.tasks, m.interruptionLogCount),
    fireItems: firefightingItems(m.tasks),
    deferral: deferralBreakdown(m.tasks),
    chronic: chronicCarryover(m.tasks),
    wip: wipSnapshot(m.wipTasks),
    util: utilization(m.tasks),
    flow: flowMetrics(m.events),
    blocked: blockedDependencies(m.events),
  };
}

// --- Team roll-up (headline numbers for the top strip) ----------------------
export type TeamInsights = {
  windowDays: number;
  memberCount: number;
  // Team-wide estimate drift and firefighting, plus counts of people tripping
  // each leak threshold so a manager sees "who needs a look" at a glance.
  estimate: EstimateAccuracy;
  fire: Firefighting;
  totalReopens: number;
  totalDeferrals: number;
  chronicCount: number; // people with >=1 chronically-slipping task
  overloadedWip: number; // people over the WIP threshold
  capacityHours: number; // memberCount * WORKDAY_HOURS (one workday's worth)
  blocked: BlockedDependency[]; // cross-team dependencies the team waits on
};

export function buildTeamInsights(
  members: MemberInsights[],
  allTasks: InsightTaskRow[],
  allEvents: InsightEventRow[],
  windowDays: number = INSIGHTS_WINDOW_DAYS,
): TeamInsights {
  const estimate = estimateAccuracy(allTasks);
  const fire = firefighting(
    allTasks,
    members.reduce((s, m) => s + m.fire.interruptionLogCount, 0),
  );
  return {
    windowDays,
    memberCount: members.length,
    estimate,
    fire,
    totalReopens: flowMetrics(allEvents).reopens,
    totalDeferrals: members.reduce((s, m) => s + m.deferral.total, 0),
    chronicCount: members.filter((m) => m.chronic.length > 0).length,
    overloadedWip: members.filter((m) => m.wip.inProgress >= WIP_THRESHOLD).length,
    capacityHours: members.length * WORKDAY_HOURS,
    blocked: blockedDependencies(allEvents),
  };
}

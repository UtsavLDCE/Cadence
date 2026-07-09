"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { CategorySelect, useCategories, categoryName, type Category } from "@/components/category-select";
import { TagInput, TagBadges, useTags, type Tag } from "@/components/tag-input";
import {
  TASK_STATUSES,
  STATUS_META,
  fmtHours,
  WORKDAY_HOURS,
  planningAccuracy,
  DEFERRAL_CAUSES,
  DEFERRAL_CAUSE_META,
  PRIORITIES,
  PRIORITY_META,
  byPriority,
  type TaskStatus,
  type DeferralCause,
  type Priority,
} from "@/lib/task-status";

// The member's day moves through three phases. The hero uses this to orient them
// ("what do I do right now?") and the stepper shows where they are.
const STEPS = [
  { key: "plan", label: "Plan" },
  { key: "execute", label: "Do the work" },
  { key: "wrap", label: "Wrap up" },
] as const;
const STEP_ORDER = ["plan", "execute", "wrap"] as const;

// A dated time-entry against a task (date = the day the work happened). The task's
// actualHours is the server-maintained sum of these.
type WorkLog = {
  id: string;
  date: string;
  hours: number;
  note: string | null;
  createdAt: string;
};

type Task = {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  workType: "FOCUS" | "INTERRUPTION";
  priority: Priority;
  estimatedHours: number | null;
  actualHours: number | null;
  categoryId: string | null;
  tags: Tag[];
  deferredToDate: string | null;
  deferralCause: DeferralCause | null;
  deferralNote: string | null;
  // Present on today's task rows (loaded with the page). Optional so the many
  // other places that build a Task locally (promote/carry results) don't need it.
  workLogs?: WorkLog[];
};

type QueueItem = {
  id: string;
  title: string;
  notes: string | null;
  priority: Priority;
  estimatedHours: number | null;
  assignedById: string | null;
};

// An overdue task carries its planned `date` so we can show how late it is, plus
// `locked` (its original day's plan was submitted) so we only offer a rename when
// PATCH /api/tasks/:id would accept a title change.
type OverdueTask = Task & { date: string; locked: boolean };

export function TasksClient({
  initialTasks,
  initialQueue,
  initialOverdue,
  cutoffTime,
  initialSubmitted,
  userName,
  isAdmin,
  isManager,
}: {
  initialTasks: Task[];
  initialQueue: QueueItem[];
  initialOverdue: OverdueTask[];
  cutoffTime: string;
  initialSubmitted: boolean;
  userName: string | null;
  isAdmin: boolean;
  // Managers/admins can remove a task even after the day's plan is locked, matching
  // the DELETE /api/tasks/:id override. Members must defer a locked task instead.
  isManager: boolean;
}) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue);
  const [overdue, setOverdue] = useState<OverdueTask[]>(initialOverdue);
  const [title, setTitle] = useState("");
  const [estimate, setEstimate] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [category, setCategory] = useState<string | null>(null);
  const [newTags, setNewTags] = useState<Tag[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Team-wide category vocabulary (Meeting, Client Call, R&D, …), extensible inline.
  const { categories, createCategory } = useCategories();
  // Team-wide free-form tag vocabulary, extensible inline. Many per task.
  const { tags: allTags, createTag } = useTags();

  const [submitted, setSubmitted] = useState(initialSubmitted);
  const [submitting, setSubmitting] = useState(false);

  // "Today's goal" is the checklist of tasks the user commits to for the day.
  // While planning, they can uncheck any task; unchecked ones are moved to the
  // backlog queue at submit instead of being locked into the day. This set holds
  // the task ids that are currently unchecked (deselected).
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  // Which task the "Up next" hero is pointed at. Null = follow the automatic pick
  // (in-progress, else highest priority). Set when the user skips to another task
  // so they can start any task from the hero, not just the auto-selected one.
  const [focusOverrideId, setFocusOverrideId] = useState<string | null>(null);

  // Time-of-day greeting. Set after mount so server/client render match (the
  // server's clock could differ from the viewer's), avoiding a hydration warning.
  // Greeting + header date label are read from the viewer's clock, so they're set
  // after mount (server/client time can differ) to avoid a hydration mismatch.
  const [clock, setClock] = useState<{ greeting: string; dateLabel: string }>({ greeting: "", dateLabel: "" });
  useEffect(() => {
    const d = new Date();
    const h = d.getHours();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only client clock; must run post-hydration
    setClock({
      greeting: h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening",
      dateLabel: d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase(),
    });
  }, []);
  const { greeting, dateLabel } = clock;

  const heroName = userName ? userName.split(" ")[0] : "";

  // Local calendar day as YYYY-MM-DD, matching the server's todayDate() (which
  // reads local Y/M/D and stamps UTC midnight). Used as the default/upper bound
  // for backdating logged work.
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // Toggle a task's membership in today's goal. Unchecked tasks are moved to the
  // queue at submit; re-checking keeps them in today.
  function toggleGoalItem(id: string) {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Earliest day a task can be moved to: tomorrow (local).
  const minMoveDate = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 1);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${dd}`;
  })();

  // Submit today's goal: moves any unchecked task to the backlog queue, then
  // freezes the remaining task list for the day. Irreversible.
  async function submitPlan() {
    if (submitted) return;
    const plannable = tasks.filter((t) => !t.deferredToDate);
    const toQueue = plannable.filter((t) => deselected.has(t.id));
    const keeping = plannable.filter((t) => !deselected.has(t.id));
    if (keeping.length === 0) {
      setError("Keep at least one task in today's goal before submitting.");
      return;
    }
    const confirmMsg = toQueue.length
      ? `Submit today's goal? ${toQueue.length} unchecked ${toQueue.length === 1 ? "task moves" : "tasks move"} to your queue, and the rest are locked for the day — you can still update status, effort, and notes, or move a task to another day.`
      : "Submit today's goal? After this you can't add, remove, or re-estimate tasks. You can still update status, effort, and notes, or move a task to another day.";
    if (!window.confirm(confirmMsg)) return;

    setSubmitting(true);
    setError(null);

    // Move each unchecked task to the queue before locking the day. Bail on the
    // first failure so we never lock a plan that only half-emptied.
    for (const t of toQueue) {
      const res = await fetch(`/api/tasks/${t.id}/to-queue`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setSubmitting(false);
        setError(d.error || "Couldn't move a task to the queue. Try again.");
        return;
      }
      const item = await res.json();
      setTasks((prev) => prev.filter((x) => x.id !== t.id));
      setQueue((prev) => [...prev, item]);
    }

    const res = await fetch("/api/day-plan", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submit: true }),
    });
    setSubmitting(false);
    if (res.ok) {
      setSubmitted(true);
      setDeselected(new Set());
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to submit today's goal.");
    }
  }

  // Move/defer a task to a future day. Before submit it's a plain move and the
  // task leaves today's list. After submit it's a deferral: a reason is required,
  // the original stays on today marked "Deferred →", and a copy carries forward.
  async function move(id: string, date: string, cause?: DeferralCause, note?: string) {
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, deferralCause: cause, deferralNote: note }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.original?.deferredToDate) {
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...data.original } : t)));
      } else {
        setTasks((prev) => prev.filter((t) => t.id !== id));
      }
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to move task.");
    }
  }

  // Order the day's list so attention flows top-down: live work you still act on
  // first (highest priority first), then finished work, then deferred audit rows
  // at the very bottom. Within each group, byPriority keeps the ranking and the
  // stable sort preserves creation order inside a tier.
  const groupRank = (t: Task) => (t.deferredToDate ? 2 : t.status === "DONE" ? 1 : 0);
  const orderedTasks = [...tasks].sort((a, b) => {
    const g = groupRank(a) - groupRank(b);
    return g !== 0 ? g : byPriority(a, b);
  });
  const completedTasks = orderedTasks.filter((t) => !t.deferredToDate && t.status === "DONE");
  const deferredTasks = orderedTasks.filter((t) => t.deferredToDate);
  const totalEstimate = tasks.reduce((s, t) => s + (t.estimatedHours ?? 0), 0);
  const totalActual = tasks.reduce((s, t) => s + (t.actualHours ?? 0), 0);
  const doneTasks = tasks.filter((t) => t.status === "DONE");
  const doneCount = doneTasks.length;
  // Share of estimated effort already logged — fills the dark "Today's goal" bar.
  const effortPct = totalEstimate > 0 ? Math.min(100, Math.round((totalActual / totalEstimate) * 100)) : 0;
  const overBy = totalEstimate - WORKDAY_HOURS;

  // Planning accuracy for today — estimate-vs-actual over completed tasks only.
  const estDone = doneTasks.reduce((s, t) => s + (t.estimatedHours ?? 0), 0);
  const actDone = doneTasks.reduce((s, t) => s + (t.actualHours ?? 0), 0);
  const accuracy = planningAccuracy(estDone, actDone);
  const overplanned = overBy > 0;

  // Actionable = live tasks still to do (deferred originals are audit rows).
  // The focus task is the one thing to work on right now: whatever's already in
  // progress, otherwise the highest-priority remaining task.
  const actionable = orderedTasks.filter((t) => !t.deferredToDate && t.status !== "DONE");
  const remaining = actionable.length;
  // Estimated effort still ahead of you today — a focus nudge in the "execute" hero.
  const remainingHours = actionable.reduce((s, t) => s + (t.estimatedHours ?? 0), 0);
  // A manual override wins (the user skipped to this one), but only while it's
  // still actionable — once it's done or moved, fall back to the automatic pick.
  const overrideFocus = focusOverrideId
    ? actionable.find((t) => t.id === focusOverrideId)
    : undefined;
  const focusTask = submitted
    ? overrideFocus ?? actionable.find((t) => t.status === "IN_PROGRESS") ?? actionable[0]
    : undefined;
  const focusIndex = focusTask ? actionable.findIndex((t) => t.id === focusTask.id) : -1;

  // Point the hero at the next/previous actionable task, wrapping around the list,
  // so any task can be brought into focus and started from the hero.
  function skipFocus(dir: 1 | -1) {
    if (actionable.length < 2 || focusIndex < 0) return;
    const next = actionable[(focusIndex + dir + actionable.length) % actionable.length];
    setFocusOverrideId(next.id);
  }

  // Which guided state the hero shows. Drives both the copy and the stepper.
  const heroState: "plan-empty" | "plan-ready" | "execute" | "wrap" | "locked-empty" =
    !submitted
      ? tasks.length === 0
        ? "plan-empty"
        : "plan-ready"
      : tasks.length === 0
        ? "locked-empty"
        : remaining === 0
          ? "wrap"
          : "execute";
  const phase: (typeof STEP_ORDER)[number] = heroState.startsWith("plan")
    ? "plan"
    : heroState === "wrap"
      ? "wrap"
      : "execute";

  // Headline shown in the dark "Today's goal" hero, per guided state.
  const heroHeadline =
    heroState === "plan-empty"
      ? "Let’s plan your day"
      : heroState === "plan-ready"
        ? "Ready to start? Lock in your plan."
        : heroState === "execute"
          ? focusTask
            ? focusTask.title
            : "Keep the momentum going"
          : heroState === "wrap"
            ? "🎉 You cleared today’s plan!"
            : "Your day is locked";

  // Today's goal as a checklist of the tasks you've lined up. Uncheck any you're
  // not committing to today — they move to your queue when you submit.
  const plannableTasks = tasks.filter((t) => !t.deferredToDate);
  const goalChecklist = plannableTasks.length > 0 && (
    <div className="mt-4">
      <p className="text-xs font-medium text-[#6b665f]">
        Today&apos;s goal{" "}
        <span className="font-normal text-[#b0a99e]">— uncheck anything you&apos;re not committing to; it moves to your queue</span>
      </p>
      <div className="mt-2 space-y-1.5">
        {plannableTasks.map((t) => {
          const on = !deselected.has(t.id);
          return (
            <label key={t.id} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggleGoalItem(t.id)}
                className="h-4 w-4 rounded border-[#ddd8d0] accent-[#e0533a] focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
              />
              <span className={cn("text-sm break-words", on ? "text-[#2c2925]" : "text-[#b0a99e] line-through")}>
                {t.title}
              </span>
              {t.estimatedHours != null && (
                <span className="text-xs text-[#b0a99e] shrink-0">· {fmtHours(t.estimatedHours)}</span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    const est = Number(estimate);
    if (estimate === "" || !Number.isFinite(est) || est <= 0) {
      setError("Add an effort estimate (in hours) before adding a task.");
      return;
    }
    setAdding(true);
    setError(null);
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t, estimatedHours: est, priority, categoryId: category, tagIds: newTags.map((tag) => tag.id) }),
    });
    if (res.ok) {
      const created = await res.json();
      setTasks((prev) => [...prev, created]);
      setTitle("");
      setEstimate("");
      setPriority("MEDIUM");
      setCategory(null);
      setNewTags([]);
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to add task.");
    }
    setAdding(false);
  }

  // Log unplanned work that already happened: creates a task already marked DONE.
  // No estimate needed, and it works even after the plan is locked — that's how
  // an interruption that came up mid-day gets onto the record. An optional past
  // `date` backdates it to log work missed on an earlier day.
  async function logDone(
    title: string,
    actualHours: number | null,
    categoryId: string | null,
    tagIds: string[],
    date: string,
    notes: string | null,
  ): Promise<boolean> {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // This panel is the dedicated off-plan/firefighting path, so set the
      // explicit `unplanned` flag — the honest signal the insights Firefighting
      // metric reads (isUnplanned). Without it, same-day and backdated unplanned
      // logs count as neither planned nor firefighting and stay invisible.
      body: JSON.stringify({ title, status: "DONE", unplanned: true, actualHours, categoryId, tagIds, date, notes }),
    });
    if (res.ok) {
      const created = await res.json();
      // Only surfaces in today's list when it actually landed on today; a
      // backdated log belongs to a past day and won't appear here.
      if (typeof created.date === "string" && created.date.slice(0, 10) === todayStr) {
        setTasks((prev) => [...prev, created]);
      }
      return true;
    }
    const d = await res.json().catch(() => ({}));
    setError(d.error || "Failed to log unplanned work.");
    return false;
  }

  // `extra` carries fields that aren't columns on Task (e.g. holdReason /
  // blockedOn captured on a HOLD transition) — sent to the API but kept out of
  // the optimistic Task state.
  async function patch(id: string, body: Partial<Task>, extra?: Record<string, unknown>) {
    // optimistic
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...body } : t)));
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...extra }),
    });
  }

  // Tags are a relation, not a scalar, so they need their own path: mirror the full
  // tag objects locally but send just the ids to the server (which replaces the set).
  async function setTaskTags(id: string, next: Tag[]) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, tags: next } : t)));
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagIds: next.map((tag) => tag.id) }),
    });
  }

  async function remove(id: string) {
    // Optimistic remove, but keep the prior list so a rejected delete (e.g. a
    // locked-plan guard) can be rolled back instead of silently dropping the row.
    const prev = tasks;
    setError(null);
    setTasks((cur) => cur.filter((t) => t.id !== id));
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setTasks(prev);
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to delete task.");
    }
  }

  async function addToQueue(title: string, estimatedHours: number | null, priority: Priority) {
    const res = await fetch("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, estimatedHours, priority }),
    });
    if (res.ok) {
      const created = await res.json();
      setQueue((prev) => [...prev, created]);
      return true;
    }
    return false;
  }

  async function patchQueue(id: string, body: Partial<QueueItem>) {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...body } : q)));
    await fetch(`/api/queue/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function removeQueue(id: string) {
    setQueue((prev) => prev.filter((q) => q.id !== id));
    await fetch(`/api/queue/${id}`, { method: "DELETE" });
  }

  // Move a backlog item into today's plan: the server creates the DailyTask and
  // deletes the queue item; we mirror that locally.
  async function promote(id: string) {
    const res = await fetch(`/api/queue/${id}/promote`, { method: "POST" });
    if (res.ok) {
      const created = await res.json();
      setQueue((prev) => prev.filter((q) => q.id !== id));
      setTasks((prev) => [...prev, created]);
    }
  }

  // Rename an overdue task in place. Its optimistic state lives in `overdue`
  // (not `tasks`), so it needs its own patch path. Only exposed for unlocked
  // overdue rows, matching the PATCH /api/tasks/:id title guard.
  async function patchOverdue(id: string, body: Partial<Task>) {
    setOverdue((prev) => prev.map((t) => (t.id === id ? { ...t, ...body } : t)));
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // Bring an overdue task forward into today's plan. The server either moves it
  // (if its original day was never locked) or copies it forward (if that day was
  // submitted, leaving the original as a deferred record). Either way we get back
  // the task that now lives on today.
  async function carry(id: string) {
    const res = await fetch(`/api/tasks/${id}/carry`, { method: "POST" });
    if (res.ok) {
      const created = await res.json();
      setOverdue((prev) => prev.filter((t) => t.id !== id));
      setTasks((prev) => [...prev, created]);
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to bring this task forward.");
    }
  }

  // Append a dated time-entry to a task. The server re-sums the task's actualHours
  // (worklog is the source of truth once used), so we fold both the new entry and
  // the returned actualHours back into local state.
  async function logWork(taskId: string, hours: number, note: string, date: string) {
    const res = await fetch(`/api/tasks/${taskId}/worklog`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours, note: note || undefined, date }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Couldn't log this work. Try again.");
      return false;
    }
    const { entry, actualHours } = await res.json();
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, actualHours, workLogs: [entry, ...(t.workLogs ?? [])] }
          : t,
      ),
    );
    return true;
  }

  // Remove a time-entry and mirror the server's re-summed actualHours.
  async function deleteWorkLog(taskId: string, logId: string) {
    const prev = tasks;
    setTasks((cur) =>
      cur.map((t) =>
        t.id === taskId ? { ...t, workLogs: (t.workLogs ?? []).filter((w) => w.id !== logId) } : t,
      ),
    );
    const res = await fetch(`/api/tasks/${taskId}/worklog/${logId}`, { method: "DELETE" });
    if (!res.ok) {
      setTasks(prev);
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Couldn't remove this entry.");
      return;
    }
    const { actualHours } = await res.json();
    setTasks((cur) => cur.map((t) => (t.id === taskId ? { ...t, actualHours } : t)));
  }

  return (
    <div className="space-y-5">
      {overplanned && (
        <div className="flex items-start gap-3 bg-[#fdf7ec] border border-[#f0e2c4] text-[#a8791f] rounded-xl px-4 py-3 text-sm">
          <span className="mt-0.5 text-base leading-none">⚠️</span>
          <div>
            <p className="font-semibold">You&apos;re overplanning.</p>
            <p className="text-[#c08a2d]">
              You&apos;ve planned <span className="font-medium">{fmtHours(totalEstimate)}</span> of work, but a day only holds about {WORKDAY_HOURS}h.
              That&apos;s {fmtHours(overBy)} more than you can realistically do — trim a task or move it to another day.
            </p>
          </div>
        </div>
      )}

      {/* Header — title, date, and the Plan → Do → Wrap phase indicator */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-[#1c1a17] leading-none">My Day</h1>
          <div className="mono text-xs tracking-[0.06em] text-[#b0a99e] mt-1.5">
            {dateLabel}
            {dateLabel && " · "}CUTOFF {cutoffTime}
          </div>
        </div>
        {/* Phase pills mirror the guided state and advance automatically as the day
            moves plan → execute → wrap, so they read as status, not navigation. */}
        <div className="flex gap-2">
          {STEPS.map((s, i) => {
            const active = s.key === phase;
            const passed = STEP_ORDER.indexOf(phase) > i;
            return (
              <div
                key={s.key}
                className={cn(
                  "flex items-center gap-2 border border-[#ece8e1] rounded-[10px] px-3.5 py-2 text-[13px]",
                  active ? "bg-primary-soft text-primary font-semibold" : "bg-white text-[#9c968d] font-medium",
                )}
              >
                <span
                  className={cn(
                    "mono w-[18px] h-[18px] rounded-full inline-flex items-center justify-center text-[11px] shrink-0",
                    active ? "bg-primary text-white" : passed ? "bg-[#3f8a5b] text-white" : "bg-[#eee9e1] text-[#b0a99e]",
                  )}
                >
                  {passed ? "✓" : i + 1}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main split: focused work column + supporting sidebar */}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-[22px] items-start">
        <div className="min-w-0 flex flex-col gap-4">

          {/* Dark "Today's goal" hero — orients the member and shows effort logged */}
          <div className="bg-[#1c1a17] rounded-2xl p-5 sm:p-6">
            {greeting && (
              <p className="text-xs text-[#8f887e] mb-2">
                {greeting}
                {heroName ? `, ${heroName}` : ""}.
              </p>
            )}
            <div className="mono text-[11px] tracking-[0.14em] uppercase text-[#8f887e]">
              {heroState === "execute" ? "Up next" : "Today’s goal"}
            </div>
            <div className="text-[18px] font-medium leading-snug mt-2 text-white break-words">{heroHeadline}</div>
            {tasks.length > 0 && (
              <div className="flex items-center gap-3.5 mt-4">
                <div className="flex-1 h-1.5 rounded-full bg-[#2c2925] overflow-hidden">
                  <div className="h-full bg-primary bar-fill" style={{ width: `${effortPct}%` }} />
                </div>
                <span className="mono text-xs text-[#cfc8bd] whitespace-nowrap">{effortPct}% of planned effort logged</span>
              </div>
            )}
          </div>

          {/* Phase guidance + actions — the paragraph and buttons for the current state */}
          <div className="bg-white rounded-2xl border border-[#ece8e1] p-5">
            {heroState === "plan-empty" && (
              <p className="text-sm text-[#9c968d]">
                Start by adding the tasks you&apos;ll focus on today — pull from{" "}
                <span className="font-medium text-[#4a453e]">your queue</span>, bring forward{" "}
                <span className="font-medium text-[#4a453e]">overdue work</span>, or add something new below. When the list looks right, lock it in.
              </p>
            )}

            {heroState === "plan-ready" && (
              <>
                <p className="text-sm text-[#9c968d]">
                  You&apos;ve lined up <span className="font-medium text-[#4a453e]">{tasks.length} {tasks.length === 1 ? "task" : "tasks"}</span> for about{" "}
                  <span className="font-medium text-[#4a453e]">{fmtHours(totalEstimate || null)}</span>. Once you submit, the list is locked for the day —
                  you can still update status, effort, and notes, or move a task to another day.
                </p>
                {overplanned && (
                  <p className="text-sm text-[#c08a2d] mt-2">
                    ⚠️ That&apos;s {fmtHours(overBy)} over a ~{WORKDAY_HOURS}h day. Consider trimming or moving a task before you start.
                  </p>
                )}
                {goalChecklist}
                <button
                  type="button"
                  onClick={submitPlan}
                  disabled={submitting}
                  className="mt-4 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-semibold text-sm px-5 py-2.5 rounded-lg transition-colors"
                >
                  {submitting ? "Submitting…" : "Submit & start my day →"}
                </button>
              </>
            )}

            {heroState === "execute" && (
              <>
                <p className="text-sm text-[#9c968d]">
                  {doneCount} of {tasks.length} done · {fmtHours(totalActual || null)} logged ·{" "}
                  <span className="font-medium text-[#4a453e]">{remaining} {remaining === 1 ? "task" : "tasks"} to go</span>
                  {remainingHours > 0 && <> · ≈{fmtHours(remainingHours)} of work left</>}.
                </p>
                {focusTask && (
                  <div className="mt-4 flex items-center gap-3 flex-wrap">
                    {focusTask.status === "IN_PROGRESS" ? (
                      <button
                        type="button"
                        // One-tap done: if no actual is logged yet, default it to the
                        // estimate so effort data stays dense without extra typing.
                        onClick={() =>
                          patch(focusTask.id, {
                            status: "DONE",
                            ...(focusTask.actualHours == null && focusTask.estimatedHours != null
                              ? { actualHours: focusTask.estimatedHours }
                              : {}),
                          })
                        }
                        className="bg-[#3f8a5b] hover:bg-[#357a4f] text-white font-semibold text-sm px-5 py-2.5 rounded-lg transition-colors"
                      >
                        Mark done ✓
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => patch(focusTask.id, { status: "IN_PROGRESS" })}
                        className="bg-primary hover:bg-primary-hover text-white font-semibold text-sm px-5 py-2.5 rounded-lg transition-colors"
                      >
                        Start this task →
                      </button>
                    )}
                    <span className="text-xs text-[#b0a99e]">
                      {focusTask.status === "IN_PROGRESS"
                        ? focusTask.actualHours == null && focusTask.estimatedHours != null
                          ? `In progress · marks done and logs ${fmtHours(focusTask.estimatedHours)}`
                          : "In progress · your current focus"
                        : overrideFocus
                          ? "Picked to start next"
                          : "Highest priority left — start here"}
                    </span>

                    {/* Skip the hero to another task so you can start any task from
                        here, not just the auto-selected one. */}
                    {actionable.length > 1 && (
                      <div className="flex items-center gap-1 ml-auto">
                        <button
                          type="button"
                          onClick={() => skipFocus(-1)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg border border-[#ece8e1] text-[#9c968d] hover:border-primary hover:text-primary transition-colors"
                          title="Previous task"
                        >
                          ←
                        </button>
                        <span className="text-xs text-[#b0a99e] tabular-nums px-1" title="Position in your remaining tasks">
                          {focusIndex + 1} of {actionable.length}
                        </span>
                        <button
                          type="button"
                          onClick={() => skipFocus(1)}
                          className="text-xs font-medium text-[#6b665f] hover:text-primary flex items-center gap-1 rounded-lg border border-[#ece8e1] hover:border-primary px-2.5 h-7 transition-colors"
                          title="Skip to the next task"
                        >
                          Next task →
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {heroState === "wrap" && (
              <p className="text-sm text-[#9c968d]">
                All {tasks.length} {tasks.length === 1 ? "task" : "tasks"} done · {fmtHours(totalActual || null)} logged.
                Did something unplanned come up? Log it below so your day reflects what really happened.
              </p>
            )}

            {heroState === "locked-empty" && (
              <p className="text-sm text-[#9c968d]">
                No tasks were planned for today. If work comes up, log it below as you go so it&apos;s on the record.
              </p>
            )}
          </div>

      {/* Add task — set the morning plan (hidden once the plan is locked) */}
      {!submitted && (
      <form onSubmit={addTask} className="bg-white rounded-xl border border-[#ece8e1] p-4 flex flex-col sm:flex-row gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What will you work on today?"
          className="flex-1 border border-[#ece8e1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
        />
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority)}
          title="Priority"
          className="border border-[#ece8e1] rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_META[p].label}</option>
          ))}
        </select>
        <CategorySelect
          categories={categories}
          value={category}
          onChange={setCategory}
          onCreate={createCategory}
          className="sm:w-44"
        />
        <TagInput
          value={newTags}
          onChange={setNewTags}
          suggestions={allTags}
          onCreate={createTag}
          className="sm:w-48"
        />
        <div className="flex items-center gap-1">
          <input
            type="number"
            min="0.5"
            step="0.5"
            required
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            placeholder="Est.*"
            title="An effort estimate is required"
            className="w-20 border border-[#ece8e1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
          />
          <span className="text-sm text-[#b0a99e]">h</span>
        </div>
        <button
          type="submit"
          disabled={adding || !title.trim() || estimate === "" || Number(estimate) <= 0}
          className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-medium text-sm px-5 py-2 rounded-lg transition-colors"
        >
          {adding ? "Adding…" : "Add task"}
        </button>
      </form>
      )}

      {error && <p className="text-sm text-primary">{error}</p>}

      {/* Today's plan — the day's task list, grouped live → completed → deferred */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-sm font-semibold text-[#1c1a17]">Today&apos;s plan{submitted ? " · locked" : ""}</span>
          <span className="mono text-xs text-[#b0a99e]">{doneCount} of {tasks.length} done</span>
        </div>
      {tasks.length === 0 ? (
        <div className="text-center py-12 text-[#b0a99e] bg-white rounded-xl border border-dashed border-[#ece8e1]">
          <p className="text-lg">No tasks yet.</p>
          <p className="text-sm mt-1">Add the goals you want to achieve today.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {actionable.length > 0 && (
            <div className="space-y-2">
              {actionable.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onPatch={patch}
                  onRemove={remove}
                  onMove={move}
                  submitted={submitted}
                  canDeleteLocked={isManager}
                  minMoveDate={minMoveDate}
                  isFocus={task.id === focusTask?.id}
                  onFocus={submitted ? setFocusOverrideId : undefined}
                  categories={categories}
                  onCreateCategory={createCategory}
                  allTags={allTags}
                  onCreateTag={createTag}
                  onSetTags={setTaskTags}
                  onLogWork={logWork}
                  onDeleteWorkLog={deleteWorkLog}
                  todayStr={todayStr}
                />
              ))}
            </div>
          )}

          {completedTasks.length > 0 && (
            <div className="space-y-2">
              <SectionDivider label="Completed" count={completedTasks.length} tone="emerald" />
              {completedTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onPatch={patch}
                  onRemove={remove}
                  onMove={move}
                  submitted={submitted}
                  canDeleteLocked={isManager}
                  minMoveDate={minMoveDate}
                  categories={categories}
                  onCreateCategory={createCategory}
                  allTags={allTags}
                  onCreateTag={createTag}
                  onSetTags={setTaskTags}
                  onLogWork={logWork}
                  onDeleteWorkLog={deleteWorkLog}
                  todayStr={todayStr}
                />
              ))}
            </div>
          )}

          {deferredTasks.length > 0 && (
            <div className="space-y-2">
              <SectionDivider label="Deferred" count={deferredTasks.length} tone="amber" />
              {deferredTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onPatch={patch}
                  onRemove={remove}
                  onMove={move}
                  submitted={submitted}
                  canDeleteLocked={isManager}
                  minMoveDate={minMoveDate}
                  categories={categories}
                  onCreateCategory={createCategory}
                  allTags={allTags}
                  onCreateTag={createTag}
                  onSetTags={setTaskTags}
                  onLogWork={logWork}
                  onDeleteWorkLog={deleteWorkLog}
                  todayStr={todayStr}
                />
              ))}
            </div>
          )}
        </div>
      )}
      </div>

          {/* Came up unplanned — log off-plan work; also the record of why the plan slipped */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-sm font-semibold text-[#1c1a17]">Came up unplanned</span>
              <span className="text-xs text-[#b0a99e]">shows why the plan slipped</span>
            </div>
            <UnplannedWork onLog={logDone} todayStr={todayStr} categories={categories} onCreateCategory={createCategory} allTags={allTags} onCreateTag={createTag} />
          </div>
        </div>

        {/* Supporting sidebar — context that feeds the plan without competing with it. */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-[74px]">
          {/* Today at a glance — the day's headline numbers */}
          <div className="bg-white rounded-2xl border border-[#ece8e1] p-[18px]">
            <div className="text-[13px] font-semibold text-[#1c1a17] mb-3.5">Today at a glance</div>
            <div className="grid grid-cols-2 gap-3">
              <Glance label="PLANNED" value={String(tasks.length)} />
              <Glance label="DONE" value={String(doneCount)} sub={`/${tasks.length || 0}`} />
              <Glance label="EST EFFORT" value={fmtHours(totalEstimate || null)} />
              <Glance label="ACTUAL" value={fmtHours(totalActual || null)} accent />
            </div>
          </div>

          {/* Planning accuracy — estimate vs actual on completed tasks. Admin-only. */}
          {isAdmin && (
            <div className="bg-white rounded-2xl border border-[#ece8e1] p-[18px]">
              <p className="text-[13px] font-semibold text-[#1c1a17]">Planning accuracy</p>
              {accuracy.tone === "none" ? (
                <p className="text-xs text-[#9c968d] leading-relaxed mt-1.5">
                  Finish a task and log its actual hours to see how your estimate compared.
                </p>
              ) : (
                <>
                  <p className="text-xs text-[#9c968d] mt-1.5">
                    Estimated {fmtHours(estDone)} · Actual {fmtHours(actDone)} on completed work
                  </p>
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <span
                      className={cn(
                        "text-xs font-medium rounded px-2 py-0.5",
                        accuracy.tone === "ok" ? "bg-[#e9f4ec] text-[#357a4f]" : "bg-[#fdf7ec] text-[#c08a2d]",
                      )}
                    >
                      {accuracy.tone === "under" && "⚠ "}
                      {accuracy.label}
                    </span>
                    {accuracy.pct !== null && <span className="text-xs text-[#b0a99e]">{accuracy.pct}% of estimate</span>}
                  </div>
                </>
              )}
            </div>
          )}
      {/* Personal queue — overdue work from earlier days and parked backlog in one
          prioritizable list. Both carry into today when ready; overdue rows stay
          visible after submit as a read-only reference (carry is blocked server-side
          once the day is locked). */}
      <QueueSection
        queue={queue}
        overdue={overdue}
        onAdd={addToQueue}
        onPatch={patchQueue}
        onRemove={removeQueue}
        onPromote={promote}
        onCarry={carry}
        onPatchOverdue={patchOverdue}
        locked={submitted}
      />
        </aside>
      </div>

      <p className="text-xs text-[#b0a99e] text-center">
        Cutoff for the day&apos;s plan is {cutoffTime}. Set estimates in the morning, update actual effort when you wrap up.
      </p>
    </div>
  );
}

// Capture unplanned work that already happened — a quick task added straight as
// DONE. Replaces the old Interruptions page: when something pulls you off-plan,
// log it here so the day's record (and the manager view) reflects reality.
function UnplannedWork({
  onLog,
  todayStr,
  categories,
  onCreateCategory,
  allTags,
  onCreateTag,
}: {
  onLog: (title: string, actualHours: number | null, categoryId: string | null, tagIds: string[], date: string, notes: string | null) => Promise<boolean>;
  todayStr: string;
  categories: Category[];
  onCreateCategory: (name: string) => Promise<Category | null>;
  allTags: Tag[];
  onCreateTag: (name: string) => Promise<Tag | null>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [hours, setHours] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [date, setDate] = useState(todayStr);
  const [busy, setBusy] = useState(false);
  // Confirmation after a backdated log, since it won't appear in today's list.
  const [note, setNote] = useState<string | null>(null);

  const backdated = date !== "" && date !== todayStr;

  function reset() {
    setTitle("");
    setNotes("");
    setHours("");
    setCategory(null);
    setTags([]);
    setDate(todayStr);
  }

  function close() {
    reset();
    setOpen(false);
  }

  // Close the dialog on Escape, and lock body scroll while it's open so the
  // page behind doesn't move under the overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    const h = hours === "" ? null : Number(hours);
    const ok = await onLog(
      t,
      Number.isFinite(h as number) ? h : null,
      category,
      tags.map((tag) => tag.id),
      date || todayStr,
      notes.trim() || null,
    );
    setBusy(false);
    if (ok) {
      setNote(
        backdated
          ? `Logged to ${new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })} — it won't show in today's list.`
          : null,
      );
      close();
    }
  }

  const fieldCls = "w-full border border-[#ece8e1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#e0533a55]";
  const labelCls = "block text-xs font-medium text-[#6b665f] mb-1";

  return (
    <div className="space-y-1.5">
      {note && (
        <p className="text-xs text-[#3f8a5b] flex items-center gap-1 px-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#3f8a5b]" />
          {note}
        </p>
      )}
      <button
        type="button"
        onClick={() => { setNote(null); setOpen(true); }}
        className="w-full text-left bg-white rounded-xl border border-dashed border-[#ece8e1] px-4 py-3 text-sm text-[#9c968d] hover:border-primary hover:text-primary transition-colors"
      >
        ⚡ Something unplanned come up — today or an earlier day? Log it as done →
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-[#1c1a17]/40 backdrop-blur-sm overflow-y-auto"
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <form
            onSubmit={submit}
            role="dialog"
            aria-modal="true"
            aria-label="Log unplanned work"
            className="w-full max-w-lg my-8 bg-white rounded-2xl border border-[#ece8e1] shadow-xl p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-[#1c1a17]">⚡ Log unplanned work</h2>
                <p className="text-xs text-[#b0a99e] mt-1">
                  A meeting, client call, cross-team discussion, or anything off-plan you already
                  finished. Logged as done on the day you pick — default today, or backdate it to
                  catch up on a missed earlier day.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="shrink-0 text-[#b0a99e] hover:text-[#6b665f] text-xl leading-none px-1"
              >
                ×
              </button>
            </div>

            <div>
              <label className={labelCls}>What did you end up doing?</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Ad-hoc client call about the launch"
                autoFocus
                className={fieldCls}
              />
            </div>

            <div>
              <label className={labelCls}>Notes / details (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="Add any context — what came up, what you decided, follow-ups…"
                className={cn(fieldCls, "resize-y min-h-[5rem]")}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Category</label>
                <CategorySelect
                  categories={categories}
                  value={category}
                  onChange={setCategory}
                  onCreate={onCreateCategory}
                  className="w-full"
                />
              </div>
              <div>
                <label className={labelCls}>Time spent (optional)</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    placeholder="Hours"
                    className={cn(fieldCls, "flex-1")}
                  />
                  <span className="text-sm text-[#b0a99e]">h</span>
                </div>
              </div>
            </div>

            <div>
              <label className={labelCls}>Tags (optional)</label>
              <TagInput
                value={tags}
                onChange={setTags}
                suggestions={allTags}
                onCreate={onCreateTag}
                className="w-full"
              />
            </div>

            <div>
              <label className={labelCls}>Day this happened</label>
              <input
                type="date"
                value={date}
                max={todayStr}
                onChange={(e) => setDate(e.target.value)}
                title="Day this happened — today or earlier"
                className={cn(
                  fieldCls,
                  backdated && "border-primary text-primary",
                )}
              />
              {backdated && (
                <p className="text-xs text-primary mt-1">
                  Backdated — this won&apos;t appear in today&apos;s list, but it&apos;s on the record for that day.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={close}
                className="text-sm text-[#9c968d] hover:text-[#4a453e] px-3 py-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !title.trim()}
                className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-medium text-sm px-5 py-2 rounded-lg transition-colors"
              >
                {busy ? "Saving…" : backdated ? "Log as done" : "Add as done"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// Whole days between an overdue task's planned day and today (UTC basis, since
// the date is a @db.Date stored at UTC midnight).
function overdueDaysLate(iso: string): number {
  const planned = new Date(iso);
  const today = new Date();
  const utcToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(1, Math.round((utcToday - planned.getTime()) / 86400000));
}

function OverdueRow({
  t,
  onCarry,
  onPatch,
  daysLate,
  locked,
}: {
  t: OverdueTask;
  onCarry: (id: string) => Promise<void>;
  onPatch: (id: string, body: Partial<Task>) => void;
  daysLate: number;
  locked: boolean;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(t.title);

  function saveTitle() {
    const trimmed = titleDraft.trim();
    setEditingTitle(false);
    if (!trimmed || trimmed === t.title) { setTitleDraft(t.title); return; }
    onPatch(t.id, { title: trimmed });
  }

  function cancelTitle() {
    setTitleDraft(t.title);
    setEditingTitle(false);
  }

  return (
    <div className="border border-[#f8f0dd] bg-[#fdf7ec]/40 rounded-lg p-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-start gap-2">
        <div className="w-full min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {editingTitle ? (
              <span className="flex items-center gap-1 flex-1 min-w-[10rem]">
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); saveTitle(); }
                    if (e.key === "Escape") { e.preventDefault(); cancelTitle(); }
                  }}
                  aria-label="Edit task title"
                  className="flex-1 min-w-0 text-sm font-medium text-[#1c1a17] border border-[#ece8e1] rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
                />
                <button type="button" onClick={saveTitle} title="Save title" className="text-xs font-medium text-primary hover:opacity-80 shrink-0">Save</button>
                <button type="button" onClick={cancelTitle} title="Cancel" className="text-xs text-[#b0a99e] hover:text-[#6b665f] shrink-0">Cancel</button>
              </span>
            ) : (
              <>
                <p className="text-sm font-medium text-[#1c1a17] break-words">{t.title}</p>
                {/* Rename — offered only when the task's original day was never locked,
                    since the API rejects title edits on a submitted day. */}
                {!t.locked && (
                  <button
                    type="button"
                    onClick={() => { setTitleDraft(t.title); setEditingTitle(true); }}
                    title="Edit title"
                    aria-label="Edit task title"
                    className="text-[#ddd8d0] hover:text-primary shrink-0 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                )}
              </>
            )}
            <span className={cn("text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0", PRIORITY_META[t.priority].badge)}>
              {PRIORITY_META[t.priority].label}
            </span>
            <span className="text-[10px] font-semibold text-[#c08a2d] bg-[#f8f0dd] rounded px-1.5 py-0.5 shrink-0">
              {daysLate}d overdue
            </span>
          </div>
          <p className="text-xs text-[#b0a99e] mt-0.5">Est. {fmtHours(t.estimatedHours)}</p>
        </div>
        {/* Priority is editable even on a locked day (PATCH allows it), so an overdue
            task can be reprioritized within the merged list before pulling it forward. */}
        <select
          value={t.priority}
          onChange={(e) => onPatch(t.id, { priority: e.target.value as Priority })}
          title="Priority"
          className="text-xs border border-[#ece8e1] rounded-lg px-2 py-1.5 bg-white shrink-0 focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_META[p].label}</option>
          ))}
        </select>
        {!locked && (
          <button
            type="button"
            onClick={() => onCarry(t.id)}
            className="bg-primary hover:bg-primary-hover text-white font-medium text-xs px-3 py-1.5 rounded-lg transition-colors shrink-0"
            title="Bring this into today's goal"
          >
            Add to today →
          </button>
        )}
      </div>
    </div>
  );
}

// A unified backlog entry: either an overdue task pulled forward from an earlier
// day, or a parked queue item. Both carry a `priority`, so they sort into one
// prioritizable list.
type QueueEntry =
  | { kind: "overdue"; priority: Priority; task: OverdueTask }
  | { kind: "queue"; priority: Priority; item: QueueItem };

function QueueSection({
  queue,
  overdue,
  onAdd,
  onPatch,
  onRemove,
  onPromote,
  onCarry,
  onPatchOverdue,
  locked,
}: {
  queue: QueueItem[];
  overdue: OverdueTask[];
  onAdd: (title: string, estimatedHours: number | null, priority: Priority) => Promise<boolean>;
  onPatch: (id: string, body: Partial<QueueItem>) => void;
  onRemove: (id: string) => void;
  onPromote: (id: string) => void;
  onCarry: (id: string) => Promise<void>;
  onPatchOverdue: (id: string, body: Partial<Task>) => void;
  locked: boolean;
}) {
  const [title, setTitle] = useState("");
  const [estimate, setEstimate] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Overdue work and parked backlog merge into one list sorted by priority.
  // Highest-priority first; within a tier, overdue outranks backlog since it's
  // already late.
  const entries: QueueEntry[] = [
    ...overdue.map((task) => ({ kind: "overdue" as const, priority: task.priority, task })),
    ...queue.map((item) => ({ kind: "queue" as const, priority: item.priority, item })),
  ].sort((a, b) => {
    const p = byPriority(a, b);
    if (p !== 0) return p;
    if (a.kind !== b.kind) return a.kind === "overdue" ? -1 : 1;
    return 0;
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    const est = Number(estimate);
    if (estimate === "" || !Number.isFinite(est) || est <= 0) {
      setError("Add an effort estimate (in hours) before queuing this.");
      return;
    }
    setAdding(true);
    setError(null);
    const ok = await onAdd(t, est, priority);
    if (ok) {
      setTitle("");
      setEstimate("");
      setPriority("MEDIUM");
    }
    setAdding(false);
  }

  return (
    <div className="bg-white rounded-xl border border-[#ece8e1] p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-[#1c1a17]">My queue</h2>
        <p className="text-xs text-[#b0a99e]">
          {overdue.length > 0
            ? "Overdue work from earlier days and parked backlog, ranked by priority. Add any of it to today’s plan when you’re ready."
            : "Park future work here, then add it to today’s plan when you’re ready."}
        </p>
      </div>

      {/* Stacked layout: this form lives in the narrow sidebar, so title takes its own
          row and the controls share a second row rather than squeezing onto one line. */}
      <form onSubmit={submit} className="flex flex-col gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Something to do later…"
          className="border border-[#ece8e1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
        />
        <div className="flex items-center gap-2">
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
            title="Priority"
            className="border border-[#ece8e1] rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{PRIORITY_META[p].label}</option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="0.5"
              step="0.5"
              required
              value={estimate}
              onChange={(e) => setEstimate(e.target.value)}
              placeholder="Est.*"
              title="An effort estimate is required"
              className="w-20 border border-[#ece8e1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
            />
            <span className="text-sm text-[#b0a99e]">h</span>
          </div>
          <button
            type="submit"
            disabled={adding || !title.trim() || estimate === "" || Number(estimate) <= 0}
            className="border border-[#ddd8d0] hover:bg-[#f6f4f1] disabled:opacity-50 text-[#4a453e] font-medium text-sm px-4 py-2 rounded-lg transition-colors ml-auto whitespace-nowrap"
          >
            {adding ? "Adding…" : "Add to queue"}
          </button>
        </div>
      </form>

      {error && <p className="text-sm text-primary">{error}</p>}

      {entries.length === 0 ? (
        <p className="text-sm text-[#b0a99e] text-center py-4">Your queue is empty.</p>
      ) : (
        <div className="space-y-2">
          {entries.map((e) =>
            e.kind === "overdue" ? (
              <OverdueRow
                key={`o-${e.task.id}`}
                t={e.task}
                onCarry={onCarry}
                onPatch={onPatchOverdue}
                daysLate={overdueDaysLate(e.task.date)}
                locked={locked}
              />
            ) : (
              <QueueRow key={`q-${e.item.id}`} item={e.item} onPatch={onPatch} onRemove={onRemove} onPromote={onPromote} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function QueueRow({
  item,
  onPatch,
  onRemove,
  onPromote,
}: {
  item: QueueItem;
  onPatch: (id: string, body: Partial<QueueItem>) => void;
  onRemove: (id: string) => void;
  onPromote: (id: string) => void;
}) {
  const [notes, setNotes] = useState(item.notes ?? "");
  const [notesOpen, setNotesOpen] = useState(Boolean(item.notes));
  const [estimate, setEstimate] = useState(item.estimatedHours?.toString() ?? "");
  const [promoting, setPromoting] = useState(false);
  // Inline title edit — a backlog item has no day-lock, so renaming is always
  // allowed (PATCH /api/queue/:id accepts a title change unconditionally).
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(item.title);

  // A manager-assigned item may arrive without an estimate. The member must set
  // one before it can move into today's goal (the promote endpoint enforces it).
  const needsEstimate = item.estimatedHours == null || item.estimatedHours <= 0;

  function saveTitle() {
    const trimmed = titleDraft.trim();
    setEditingTitle(false);
    if (!trimmed || trimmed === item.title) { setTitleDraft(item.title); return; }
    onPatch(item.id, { title: trimmed });
  }

  function cancelTitle() {
    setTitleDraft(item.title);
    setEditingTitle(false);
  }

  function saveNotes() {
    const trimmed = notes.trim();
    if (trimmed === (item.notes ?? "")) return;
    onPatch(item.id, { notes: trimmed === "" ? null : trimmed });
  }

  function saveEstimate() {
    const trimmed = estimate.trim();
    if (trimmed === "") return; // can't unset; leave as-is
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0 || n === item.estimatedHours) return;
    onPatch(item.id, { estimatedHours: n });
  }

  return (
    <div className="border border-[#f2eee7] rounded-lg p-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-start gap-2">
        <div className="w-full min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {editingTitle ? (
              <span className="flex items-center gap-1 flex-1 min-w-[10rem]">
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); saveTitle(); }
                    if (e.key === "Escape") { e.preventDefault(); cancelTitle(); }
                  }}
                  aria-label="Edit backlog item title"
                  className="flex-1 min-w-0 text-sm font-medium text-[#1c1a17] border border-[#ece8e1] rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
                />
                <button type="button" onClick={saveTitle} title="Save title" className="text-xs font-medium text-primary hover:opacity-80 shrink-0">Save</button>
                <button type="button" onClick={cancelTitle} title="Cancel" className="text-xs text-[#b0a99e] hover:text-[#6b665f] shrink-0">Cancel</button>
              </span>
            ) : (
              <>
                <p className="text-sm font-medium text-[#1c1a17] break-words">{item.title}</p>
                <button
                  type="button"
                  onClick={() => { setTitleDraft(item.title); setEditingTitle(true); }}
                  title="Edit title"
                  aria-label="Edit backlog item title"
                  className="text-[#ddd8d0] hover:text-primary shrink-0 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              </>
            )}
            <span className={cn("text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0", PRIORITY_META[item.priority].badge)}>
              {PRIORITY_META[item.priority].label}
            </span>
            {item.assignedById && (
              <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0 bg-blue-100 text-blue-700" title="Assigned by your manager">
                Assigned
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-xs text-[#b0a99e]">Est.</span>
            <input
              type="number"
              min="0.5"
              step="0.5"
              value={estimate}
              onChange={(e) => setEstimate(e.target.value)}
              onBlur={saveEstimate}
              placeholder="—"
              title={needsEstimate ? "Set an estimate before adding this to today" : "Effort estimate (hours)"}
              className={cn(
                "w-14 rounded px-1.5 py-0.5 text-xs border focus:outline-none focus:ring-2 focus:ring-[#e0533a55]",
                needsEstimate ? "border-amber-300 bg-[#fdf7ec]" : "border-[#ece8e1]",
              )}
            />
            <span className="text-xs text-[#b0a99e]">h</span>
            {needsEstimate && (
              <span className="text-[10px] font-medium text-[#c08a2d] ml-1">Set an estimate to add it to today</span>
            )}
          </div>
        </div>
        <select
          value={item.priority}
          onChange={(e) => onPatch(item.id, { priority: e.target.value as Priority })}
          title="Priority"
          className="text-xs border border-[#ece8e1] rounded-lg px-2 py-1.5 bg-white shrink-0 focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_META[p].label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={async () => {
            setPromoting(true);
            await onPromote(item.id);
          }}
          disabled={promoting || needsEstimate}
          className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-medium text-xs px-3 py-1.5 rounded-lg transition-colors shrink-0"
          title={needsEstimate ? "Add an estimate before moving this into today" : "Move this into today's plan"}
        >
          {promoting ? "Adding…" : "Add to today →"}
        </button>
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          className="text-xs text-[#ddd8d0] hover:text-primary shrink-0"
          title="Remove from queue"
        >
          ✕
        </button>
      </div>

      {notesOpen ? (
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          rows={2}
          maxLength={2000}
          placeholder="Add context or detail for later…"
          className="w-full border border-[#ece8e1] rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
        />
      ) : (
        <button
          type="button"
          onClick={() => setNotesOpen(true)}
          className="self-start text-xs text-[#b0a99e] hover:text-primary"
        >
          + Add note
        </button>
      )}
    </div>
  );
}

// A task's work log: dated time-entries + an inline add form. Lets a single task
// accumulate effort across multiple days; the task's actualHours is the sum the
// server maintains (shown here as the total). Allowed even on a locked day, since
// logging effort is time-tracking, not plan-changing.
function WorkLogPanel({
  task,
  entries,
  onLogWork,
  onDeleteWorkLog,
  todayStr,
}: {
  task: Task;
  entries: WorkLog[];
  onLogWork: (taskId: string, hours: number, note: string, date: string) => Promise<boolean>;
  onDeleteWorkLog: (taskId: string, logId: string) => void;
  todayStr: string;
}) {
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayStr);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const h = Number(hours);
    if (hours.trim() === "" || !Number.isFinite(h) || h <= 0) {
      setError("Enter the hours worked (greater than 0).");
      return;
    }
    setAdding(true);
    setError(null);
    const ok = await onLogWork(task.id, h, note.trim(), date || todayStr);
    setAdding(false);
    if (ok) {
      setHours("");
      setNote("");
      setDate(todayStr);
    }
  }

  return (
    <div className="bg-[#f6f4f1] border border-[#f2eee7] rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-[#6b665f]">🕒 Work log</span>
        {task.actualHours != null && (
          <span className="text-[11px] text-[#b0a99e] tabular-nums">{fmtHours(task.actualHours)} total</span>
        )}
      </div>

      {entries.length > 0 && (
        <div className="flex flex-col gap-1">
          {entries.map((w) => (
            <div key={w.id} className="flex items-center gap-2 text-xs">
              <span className="text-[#9c968d] tabular-nums w-14 shrink-0">{fmtMoveDate(w.date)}</span>
              <span className="font-medium text-[#2c2925] tabular-nums w-12 shrink-0">{fmtHours(w.hours)}</span>
              {w.note && <span className="text-[#9c968d] truncate flex-1 min-w-0" title={w.note}>{w.note}</span>}
              <button
                type="button"
                onClick={() => onDeleteWorkLog(task.id, w.id)}
                className="text-[#ddd8d0] hover:text-primary shrink-0 ml-auto"
                title="Remove this entry"
                aria-label="Remove work-log entry"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <input
            type="number"
            min="0.25"
            step="0.25"
            max="24"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="Hrs"
            aria-label="Hours worked"
            className="w-16 border border-[#ece8e1] rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
          />
          <span className="text-xs text-[#b0a99e]">h</span>
        </div>
        <input
          type="date"
          max={todayStr}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Day the work happened"
          className="border border-[#ece8e1] rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="What did you work on? (optional)"
          aria-label="Work-log note"
          className="flex-1 min-w-[8rem] border border-[#ece8e1] rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
        />
        <button
          type="submit"
          disabled={adding || hours.trim() === "" || Number(hours) <= 0}
          className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-medium text-xs px-3 py-1 rounded-lg transition-colors shrink-0"
        >
          {adding ? "Logging…" : "Log"}
        </button>
      </form>

      {error && <p className="text-xs text-primary">{error}</p>}
    </div>
  );
}

// Short date label for a deferral target, e.g. "Jun 27". The value is a `@db.Date`
// (UTC midnight), so format in UTC to render the stored calendar day everywhere.
function fmtMoveDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

// A single "Today at a glance" metric — mono label + big mono number, with an
// optional muted suffix (e.g. the "/2" in "1/2") and an amber accent for actuals.
function Glance({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.08em] text-[#b0a99e]">{label}</div>
      <div className={cn("mono text-xl font-semibold mt-0.5", accent ? "text-[#c08a2d]" : "text-[#1c1a17]")}>
        {value}
        {sub && <span className="text-[#c7c0b6]">{sub}</span>}
      </div>
    </div>
  );
}

// Quiet section header + hairline rule that separates a task group (Completed,
// Deferred) from the live list above it, with a count so the size is legible.
function SectionDivider({ label, count, tone }: { label: string; count: number; tone: "emerald" | "amber" }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className={cn("text-xs font-semibold uppercase tracking-wide", tone === "emerald" ? "text-[#3f8a5b]" : "text-amber-600")}>
        {label}
      </span>
      <span className="text-[11px] text-[#b0a99e] tabular-nums">{count}</span>
      <div className="flex-1 h-px bg-[#f2eee7]" />
    </div>
  );
}

function TaskRow({
  task,
  onPatch,
  onRemove,
  onMove,
  submitted,
  canDeleteLocked,
  minMoveDate,
  isFocus,
  onFocus,
  categories,
  onCreateCategory,
  allTags,
  onCreateTag,
  onSetTags,
  onLogWork,
  onDeleteWorkLog,
  todayStr,
}: {
  task: Task;
  onPatch: (id: string, body: Partial<Task>, extra?: Record<string, unknown>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, date: string, cause?: DeferralCause, note?: string) => void;
  submitted: boolean;
  // When true (manager/admin), the delete control stays available on a locked day.
  canDeleteLocked?: boolean;
  minMoveDate: string;
  isFocus?: boolean;
  onFocus?: (id: string) => void;
  categories: Category[];
  onCreateCategory: (name: string) => Promise<Category | null>;
  allTags: Tag[];
  onCreateTag: (name: string) => Promise<Tag | null>;
  onSetTags: (id: string, next: Tag[]) => void;
  onLogWork: (taskId: string, hours: number, note: string, date: string) => Promise<boolean>;
  onDeleteWorkLog: (taskId: string, logId: string) => void;
  todayStr: string;
}) {
  const catName = categoryName(categories, task.categoryId);
  const [tagsOpen, setTagsOpen] = useState(false);
  // Inline title edit — only offered while the plan is unlocked, matching the
  // PATCH /api/tasks/:id guard that rejects title changes on a locked day.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [actual, setActual] = useState(task.actualHours?.toString() ?? "");
  const [notes, setNotes] = useState(task.notes ?? "");
  const [notesOpen, setNotesOpen] = useState(Boolean(task.notes));
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDate, setMoveDate] = useState("");
  const [moveCause, setMoveCause] = useState<DeferralCause | "">("");
  const [moveNote, setMoveNote] = useState("");
  // HOLD-reason capture: putting a task on hold opens an inline panel to record
  // why and who/which team it's waiting on, so blocked time becomes a diagnosable
  // cross-team-dependency signal instead of a silent stall.
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [holdBlockedOn, setHoldBlockedOn] = useState("");
  const done = task.status === "DONE";
  // Once a task has work-log entries, actualHours is the server-maintained sum of
  // them — the manual "Actual" field defers to the log so the two can't disagree.
  const workLogs = task.workLogs ?? [];
  const hasLog = workLogs.length > 0;
  const [logOpen, setLogOpen] = useState(false);

  function confirmHold() {
    onPatch(task.id, { status: "HOLD" }, { holdReason: holdReason.trim(), blockedOn: holdBlockedOn.trim() });
    setHoldOpen(false);
    setHoldReason("");
    setHoldBlockedOn("");
  }

  function saveNotes() {
    const trimmed = notes.trim();
    if (trimmed === (task.notes ?? "")) return; // unchanged
    onPatch(task.id, { notes: trimmed === "" ? null : trimmed });
  }

  function saveTitle() {
    const trimmed = titleDraft.trim();
    setEditingTitle(false);
    // Empty or unchanged: discard the edit and restore the current title.
    if (!trimmed || trimmed === task.title) {
      setTitleDraft(task.title);
      return;
    }
    onPatch(task.id, { title: trimmed });
  }

  function cancelTitle() {
    setTitleDraft(task.title);
    setEditingTitle(false);
  }

  // A deferred original is an immutable record of what was planned but slipped —
  // render it as a muted audit row rather than an editable task.
  if (task.deferredToDate) {
    return (
      <div className="bg-[#f6f4f1] rounded-xl border border-dashed border-[#ece8e1] p-4 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-[#9c968d] break-words flex-1 min-w-0">{task.title}</p>
          <span className="text-xs font-medium text-[#c08a2d] bg-[#f8f0dd] rounded px-2 py-0.5 shrink-0">
            Deferred → {fmtMoveDate(task.deferredToDate)}
          </span>
          {task.deferralCause && (
            <span className="text-xs font-medium text-[#6b665f] bg-[#ece8e1] rounded px-2 py-0.5 shrink-0">
              {DEFERRAL_CAUSE_META[task.deferralCause].label}
            </span>
          )}
          {catName && (
            <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0 bg-indigo-100 text-indigo-700">
              {catName}
            </span>
          )}
          <TagBadges tags={task.tags} />
        </div>
        <p className="text-xs text-[#b0a99e]">Est. {fmtHours(task.estimatedHours)} · planned today, carried forward.</p>
        {task.deferralNote && (
          <p className="text-xs text-[#9c968d] bg-white border border-[#f2eee7] rounded-md px-2.5 py-1.5 whitespace-pre-wrap break-words">
            {task.deferralNote}
          </p>
        )}
      </div>
    );
  }

  const moveDisabled = !moveDate || (submitted && !moveCause);

  return (
    <div
      className={cn(
        "bg-white rounded-xl border p-4 flex flex-col gap-3",
        isFocus && !done ? "border-primary ring-2 ring-[#e0533a33]" : done ? "border-emerald-200" : "border-[#ece8e1]"
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isFocus && !done && (
              <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0 bg-primary text-white">
                Focus
              </span>
            )}
            {editingTitle ? (
              <span className="flex items-center gap-1 flex-1 min-w-[10rem]">
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); saveTitle(); }
                    if (e.key === "Escape") { e.preventDefault(); cancelTitle(); }
                  }}
                  aria-label="Edit task title"
                  className="flex-1 min-w-0 text-sm font-medium text-[#1c1a17] border border-[#ece8e1] rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
                />
                <button
                  type="button"
                  onClick={saveTitle}
                  title="Save title"
                  className="text-xs font-medium text-primary hover:opacity-80 shrink-0"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={cancelTitle}
                  title="Cancel"
                  className="text-xs text-[#b0a99e] hover:text-[#6b665f] shrink-0"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <>
                <p className={cn("text-sm font-medium text-[#1c1a17] break-words", done && "line-through text-[#b0a99e]")}>
                  {task.title}
                </p>
                {/* Edit title — offered only while the plan is unlocked, since the
                    API rejects title changes once the day is submitted. */}
                {!submitted && (
                  <button
                    type="button"
                    onClick={() => { setTitleDraft(task.title); setEditingTitle(true); }}
                    title="Edit title"
                    aria-label="Edit task title"
                    className="text-[#ddd8d0] hover:text-primary shrink-0 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                )}
              </>
            )}
            <span className={cn("text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0", PRIORITY_META[task.priority].badge)}>
              {PRIORITY_META[task.priority].label}
            </span>
            {catName && (
              <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0 bg-indigo-100 text-indigo-700">
                {catName}
              </span>
            )}
            <TagBadges tags={task.tags} />
          </div>
          <p className="text-xs text-[#b0a99e] mt-0.5">
            Est. {fmtHours(task.estimatedHours)}
            {task.actualHours != null && <> · Actual {fmtHours(task.actualHours)}</>}
          </p>
        </div>

        {/* Category — what kind of work this is; adjustable any time */}
        <CategorySelect
          categories={categories}
          value={task.categoryId}
          onChange={(id) => onPatch(task.id, { categoryId: id })}
          onCreate={onCreateCategory}
          className="shrink-0 sm:w-36 text-xs"
        />

        {/* Priority — adjustable any time, so you can re-rank as the day shifts */}
        <select
          value={task.priority}
          onChange={(e) => onPatch(task.id, { priority: e.target.value as Priority })}
          title="Priority"
          className="text-xs border border-[#ece8e1] rounded-lg px-2 py-1.5 bg-white shrink-0 focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_META[p].label}</option>
          ))}
        </select>

        {/* Status segmented control */}
        <div className="flex rounded-lg border border-[#ece8e1] overflow-hidden shrink-0">
          {TASK_STATUSES.map((s) => {
            const active = task.status === s;
            const meta = STATUS_META[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  // Entering HOLD opens the reason panel instead of firing the
                  // patch immediately; every other transition is direct.
                  if (s === "HOLD" && task.status !== "HOLD") {
                    setHoldOpen(true);
                    return;
                  }
                  setHoldOpen(false);
                  // One-tap done: default actual to the estimate when none is
                  // logged, so marking done also captures effort in a single tap.
                  if (
                    s === "DONE" &&
                    task.actualHours == null &&
                    task.estimatedHours != null &&
                    actual.trim() === ""
                  ) {
                    setActual(String(task.estimatedHours));
                    onPatch(task.id, { status: "DONE", actualHours: task.estimatedHours });
                    return;
                  }
                  onPatch(task.id, { status: s });
                }}
                className={cn(
                  "px-2.5 py-1.5 text-xs font-medium transition-colors",
                  active ? `${meta.badge}` : "text-[#9c968d] hover:bg-[#f6f4f1]"
                )}
              >
                {meta.label}
              </button>
            );
          })}
        </div>

        {/* Actual effort. When a work log exists, actualHours is its sum and this
            becomes a read-only total (edit effort via the log below instead). */}
        {hasLog ? (
          <div
            className="flex items-center gap-1 shrink-0 text-xs text-[#9c968d]"
            title="Total from your work log — edit effort by adding or removing entries below"
          >
            <span className="font-medium text-[#4a453e] tabular-nums">{fmtHours(task.actualHours)}</span>
            <span className="text-[#b0a99e]">logged</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 shrink-0">
            <input
              type="number"
              min="0"
              step="0.5"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              onBlur={() =>
                onPatch(task.id, { actualHours: actual === "" ? null : Number(actual) })
              }
              placeholder="Actual"
              className="w-16 border border-[#ece8e1] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
              title="Actual effort spent (hours)"
            />
            <span className="text-xs text-[#b0a99e]">h</span>
            {/* One-tap: copy the estimate into actual when nothing's logged yet. */}
            {task.estimatedHours != null && actual.trim() === "" && (
              <button
                type="button"
                onClick={() => {
                  setActual(String(task.estimatedHours));
                  onPatch(task.id, { actualHours: task.estimatedHours });
                }}
                className="text-[11px] text-[#b0a99e] hover:text-primary whitespace-nowrap"
                title={`Log ${fmtHours(task.estimatedHours)} (your estimate) as actual`}
              >
                = est
              </button>
            )}
          </div>
        )}

        {/* Focus — point the hero's "Up next" at this task so it can be started
            from the top. Hidden for the task that's already in focus and for done
            work; only available in execute mode (onFocus passed for live rows). */}
        {onFocus && !done && !isFocus && (
          <button
            type="button"
            onClick={() => onFocus(task.id)}
            className="flex items-center gap-1 text-xs font-medium text-[#b0a99e] hover:text-primary border border-[#ece8e1] hover:border-primary rounded-lg px-2 py-1 shrink-0 transition-colors"
            title="Focus this task in “Up next”"
          >
            ◎ Focus
          </button>
        )}

        {/* Move/defer to another day (a done task is achieved — nothing to defer) */}
        {!(submitted && done) && (
          <button
            type="button"
            onClick={() => setMoveOpen((o) => !o)}
            className={cn("text-xs shrink-0", moveOpen ? "text-primary" : "text-[#ddd8d0] hover:text-primary")}
            title={submitted ? "Defer to another day" : "Move to another day"}
          >
            ⇄
          </button>
        )}

        {/* Delete — the owner while the plan is unlocked, plus managers/admins at
            any time (they bypass the day-lock, matching DELETE /api/tasks/:id).
            Deleting from a locked plan is confirmed since it drops committed work. */}
        {(!submitted || canDeleteLocked) && (
          <button
            type="button"
            onClick={() => {
              if (
                submitted &&
                !window.confirm(`Delete "${task.title}"? This removes it from the locked plan and can't be undone.`)
              )
                return;
              onRemove(task.id);
            }}
            className="text-xs text-[#ddd8d0] hover:text-primary shrink-0"
            title={submitted ? "Delete task (manager override)" : "Delete task"}
          >
            ✕
          </button>
        )}
      </div>

      {/* Move / defer picker */}
      {moveOpen && (
        <div className="flex flex-col gap-2 bg-[#f6f4f1] border border-[#f2eee7] rounded-lg p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-[#9c968d]">{submitted ? "Defer to" : "Move to"}</span>
            <input
              type="date"
              min={minMoveDate}
              value={moveDate}
              onChange={(e) => setMoveDate(e.target.value)}
              className="border border-[#ece8e1] rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
            />
            {submitted && (
              <select
                value={moveCause}
                onChange={(e) => setMoveCause(e.target.value as DeferralCause | "")}
                className="border border-[#ece8e1] rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
                title="Reason for deferring (required)"
              >
                <option value="">Reason…*</option>
                {DEFERRAL_CAUSES.map((c) => (
                  <option key={c} value={c}>{DEFERRAL_CAUSE_META[c].label}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() =>
                !moveDisabled &&
                onMove(task.id, moveDate, submitted ? (moveCause as DeferralCause) : undefined, submitted ? moveNote.trim() || undefined : undefined)
              }
              disabled={moveDisabled}
              className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-medium text-xs px-3 py-1 rounded-lg transition-colors"
            >
              {submitted ? "Defer" : "Move"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMoveOpen(false);
                setMoveDate("");
                setMoveCause("");
                setMoveNote("");
              }}
              className="text-xs text-[#b0a99e] hover:text-[#6b665f]"
            >
              Cancel
            </button>
          </div>
          {submitted && (
            <>
              <textarea
                value={moveNote}
                onChange={(e) => setMoveNote(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Optional: add detail for your manager (what got in the way?)…"
                className="w-full border border-[#ece8e1] rounded-lg px-3 py-2 text-xs resize-y focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
              />
              <p className="text-xs text-[#b0a99e]">
                This task stays on today&apos;s record as deferred, so your manager sees what was planned vs. done — and why.
              </p>
            </>
          )}
        </div>
      )}

      {/* HOLD-reason capture — why this stalled and who it's waiting on */}
      {holdOpen && (
        <div className="flex flex-col gap-2 bg-violet-50 border border-[#eae6fb] rounded-lg p-3">
          <p className="text-xs font-medium text-violet-800">Putting this on hold — what&apos;s it waiting on?</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={holdBlockedOn}
              onChange={(e) => setHoldBlockedOn(e.target.value)}
              maxLength={120}
              placeholder="Waiting on… (person / team, e.g. Platform team, QA, client)"
              className="flex-1 border border-violet-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
          <textarea
            value={holdReason}
            onChange={(e) => setHoldReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Optional: what exactly is blocking it?"
            className="w-full border border-violet-200 rounded-lg px-3 py-2 text-xs resize-y bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={confirmHold}
              className="bg-violet-600 hover:bg-[#6a5acd] text-white font-medium text-xs px-3 py-1 rounded-lg transition-colors"
            >
              Put on hold
            </button>
            <button
              type="button"
              onClick={() => {
                setHoldOpen(false);
                setHoldReason("");
                setHoldBlockedOn("");
              }}
              className="text-xs text-[#b0a99e] hover:text-[#6b665f]"
            >
              Cancel
            </button>
            <span className="text-[11px] text-[#6a5acd]">Naming the blocker turns stalled time into a signal your manager can act on.</span>
          </div>
        </div>
      )}

      {/* Tags — free-form labels, editable any time (allowed even on a locked day) */}
      {tagsOpen ? (
        <TagInput
          value={task.tags}
          onChange={(next) => onSetTags(task.id, next)}
          suggestions={allTags}
          onCreate={onCreateTag}
        />
      ) : (
        <button
          type="button"
          onClick={() => setTagsOpen(true)}
          className="self-start text-xs text-[#b0a99e] hover:text-primary"
        >
          {task.tags.length > 0 ? "🏷 Edit tags" : "+ Add tags"}
        </button>
      )}

      {/* Work log — dated time-entries so a task can accrue effort across days.
          Opens by default when entries already exist so the history is visible. */}
      {logOpen || hasLog ? (
        <WorkLogPanel
          task={task}
          entries={workLogs}
          onLogWork={onLogWork}
          onDeleteWorkLog={onDeleteWorkLog}
          todayStr={todayStr}
        />
      ) : (
        <button
          type="button"
          onClick={() => setLogOpen(true)}
          className="self-start text-xs text-[#b0a99e] hover:text-primary"
        >
          🕒 Log work
        </button>
      )}

      {/* Notes — progress/context the manager can see */}
      {notesOpen ? (
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          rows={2}
          maxLength={2000}
          placeholder="Add a note or progress update for your manager…"
          className="w-full border border-[#ece8e1] rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
        />
      ) : (
        <button
          type="button"
          onClick={() => setNotesOpen(true)}
          className="self-start text-xs text-[#b0a99e] hover:text-primary"
        >
          + Add note
        </button>
      )}
    </div>
  );
}
